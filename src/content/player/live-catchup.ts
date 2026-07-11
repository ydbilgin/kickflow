import { logger } from '../shared/logger';
import { findLiveButton, getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { bindVideoElementListener, observeVideoElement } from './video-element';
import {
  NORMAL_PLAYBACK_RATE,
  ensurePlayerStateLoaded,
  getPlayerState,
  setManualRate,
  setPlayerPlaybackRate,
  subscribePlayerState,
} from './player-state';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-catchup-controls';

const CATCHUP_PLAYBACK_RATE = 1.5;
const BEHIND_THRESHOLD_SECONDS = 3;
const CAUGHT_UP_THRESHOLD_SECONDS = 1.5;

// Behind-live sanity bound, not a product cap. Kick's HLS state can report bogus media
// boundaries during rebuffering; never drive catch-up behavior from those readings.
const MAX_PLAUSIBLE_BEHIND_SECONDS = 12 * 60 * 60;
const LIVE_DURATION_SENTINEL_SECONDS = 2 ** 30;

export type CatchupAction =
  | { kind: 'none' }
  | { kind: 'setRate'; rate: number }
  | { kind: 'manualDropToNormal' };

export function decideCatchup(input: {
  mode: 'auto' | 'manual';
  manualRate: number;
  catchingUp: boolean;
  behindBy: number;
  behindPlausible: boolean;
}): CatchupAction {
  if (!input.behindPlausible) return { kind: 'none' };

  if (input.mode === 'manual') {
    if (
      input.manualRate > NORMAL_PLAYBACK_RATE &&
      input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS
    ) {
      return { kind: 'manualDropToNormal' };
    }
    return { kind: 'none' };
  }

  if (!input.catchingUp && input.behindBy > BEHIND_THRESHOLD_SECONDS) {
    return { kind: 'setRate', rate: CATCHUP_PLAYBACK_RATE };
  }
  if (input.catchingUp && input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
    return { kind: 'setRate', rate: NORMAL_PLAYBACK_RATE };
  }
  return { kind: 'none' };
}

/** Fast-path live check for players that report an infinite/sentinel duration. Kick's CURRENT
 * player reports a FINITE, growing duration (measured 2026-07-10), so this returns false there —
 * the stateful `makeLiveDetector` below handles that case bar-independently. Kept pure/exported
 * for the Infinity-reporting case and existing tests. */
export function isLiveStream(video: HTMLVideoElement): boolean {
  return video.duration === Infinity || video.duration >= LIVE_DURATION_SENTINEL_SECONDS;
}

/** Kick switches between two live-player regimes: current finite duration/seekable media-time
 * positions, and classic HLS where duration=Infinity and seekable.end is a 2^30 sentinel.
 * Sane readings are the finite-regime live-edge candidates; sentinel/absurd readings must
 * never reach a seek target or catch-up distance. */
function saneLiveEdge(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value >= LIVE_DURATION_SENTINEL_SECONDS) return null;
  return value;
}

function seekableLiveEdge(video: HTMLVideoElement): number | null {
  const s = video.seekable;
  if (!s.length) return null;
  return saneLiveEdge(s.end(s.length - 1));
}

function durationLiveEdge(video: HTMLVideoElement): number | null {
  return saneLiveEdge(video.duration);
}

function bufferedLiveEdge(video: HTMLVideoElement): number | null {
  let furthest: number | null = null;
  for (let index = 0; index < video.buffered.length; index++) {
    const end = saneLiveEdge(video.buffered.end(index));
    if (end !== null && (furthest === null || end > furthest)) furthest = end;
  }
  return furthest;
}

/**
 * Kick normally reports both seekable.end and finite duration at the live edge. A DVR reload
 * can shrink seekable to the newly loaded window near currentTime while duration remains the
 * stream's growing media position, so use the furthest sane reading for catch-up only.
 * Go-live remains seekable-based: it must seek to a currently addressable DVR endpoint.
 */
export function catchupLiveEdge(video: HTMLVideoElement): number | null {
  const seekable = seekableLiveEdge(video);
  const duration = durationLiveEdge(video);
  // Keep the finite regime exactly as before: buffered is considered only after BOTH prior
  // sources are unusable (Infinity/sentinel). In that regime the IVS probe showed buffered.end
  // stays 7-8 seconds ahead after a deep in-buffer rewind, so it is a usable live-edge proxy.
  if (seekable === null) return duration ?? bufferedLiveEdge(video);
  if (duration === null) return seekable;
  return Math.max(seekable, duration);
}

/** Event-driven and rebound across video-element swaps. Catch-up uses the furthest sane
 * live-edge reading, while live detection remains separately latched and fail-closed. */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('live-catchup: #video-player not found, skipping');
    return;
  }

  let catchingUp = false;
  let liveButtonEl: HTMLButtonElement | null = null;
  let lastLiveLabel = '';

  // Live detection must NOT depend on the control bar: Kick auto-hides it (and its go-to-live
  // button) when the mouse leaves the player, and `findLiveButton()` would then go null and
  // wrongly flip us to "not live", stopping catch-up (owner-observed 2026-07-10). Latch live
  // once confirmed — via Infinity duration, OR the live control seen while the bar IS visible,
  // OR (bar-independent) `seekable.end` growing over time (it advances on live, fixed on VOD).
  // Reset the latch only on a real media change (loadstart / <video> swap).
  let liveLatched = false;
  let lastSeekEnd: number | null = null;
  const detectLive = (current: HTMLVideoElement): boolean => {
    if (liveLatched) return true;
    if (isLiveStream(current) || findLiveButton() !== null) {
      liveLatched = true;
      return true;
    }
    const end = seekableLiveEdge(current);
    if (end !== null) {
      if (lastSeekEnd !== null && end > lastSeekEnd + 0.5) {
        liveLatched = true;
        return true;
      }
      lastSeekEnd = end;
    }
    return false;
  };

  /** ≥100s the seconds form ("-3600sn") would overflow the button's fixed min-width and
   * shove the controls to its right — switch to minutes, which stays within 2-3 chars. */
  const formatBehind = (roundedSeconds: number): string =>
    roundedSeconds > 99 ? `-${Math.round(roundedSeconds / 60)}dk` : `-${roundedSeconds}sn`;

  /** The single "CANLI" button doubles as the behind-live indicator: at the edge it is a
   * quiet red-dot pill, when behind it turns amber and appends "-Xsn" in place (no extra
   * indicator element appearing/disappearing, so nothing to its right ever shifts). */
  const setLiveButtonState = (behindSeconds: number | null): void => {
    if (!liveButtonEl) return;
    const behind = behindSeconds !== null;
    const rounded = behind ? Math.max(0, Math.round(behindSeconds)) : 0;
    liveButtonEl.classList.toggle('kickflow-player-btn--behind', behind);
    const label = behind ? `CANLI ${formatBehind(rounded)}` : 'CANLI';
    if (label === lastLiveLabel) return;
    lastLiveLabel = label;
    liveButtonEl.textContent = label;
    liveButtonEl.setAttribute(
      'aria-label',
      behind ? `Canlı yayına dön, ${rounded} saniye geridesin` : 'Canlı yayına dön',
    );
  };

  const resetAutoPlaybackRate = (current = getVideoElement()): void => {
    catchingUp = false;
    if (current && getPlayerState().mode === 'auto') {
      setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
    }
  };

  const resetMediaTracking = (current: HTMLVideoElement | null): void => {
    liveLatched = false;
    lastSeekEnd = null;
    resetAutoPlaybackRate(current);
    setLiveButtonState(null);
  };

  const goLive = (): void => {
    // The live edge is seekable.end (not buffered.end, which trails the playhead). Seeking the
    // <video> to seekable.end returns to live; if seekable is unreadable, delegate to Kick's own
    // "Canlı Yayına Geç" control (owner-confirmed working) as a fallback.
    const current = getVideoElement();
    const edge = current ? seekableLiveEdge(current) : null;
    if (current && edge !== null) {
      try {
        current.currentTime = edge;
        if (getPlayerState().mode === 'auto') resetAutoPlaybackRate(current);
        if (current.paused) void current.play().catch(() => undefined);
        return;
      } catch (error) {
        logger.warn('live-catchup: go-live seek failed', error);
      }
    }
    findLiveButton()?.click();
    if (getPlayerState().mode === 'auto') resetAutoPlaybackRate();
  };

  const onTimeUpdate = (event: Event): void => {
    const current = event.currentTarget;
    if (!(current instanceof HTMLVideoElement)) return;
    const playerState = getPlayerState();

    const live = detectLive(current);
    const liveEdgeSec = catchupLiveEdge(current);
    const behindBy = liveEdgeSec === null ? null : liveEdgeSec - current.currentTime;

    if (!live) {
      if (catchingUp) resetAutoPlaybackRate(current);
      setLiveButtonState(null);
      return;
    }

    if (liveEdgeSec === null || behindBy === null) {
      if (catchingUp) resetAutoPlaybackRate(current);
      setLiveButtonState(null);
      return;
    }

    const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
    // Behind-live is shown in BOTH modes (unlike the old catch-up-only indicator): "how far
    // behind am I" is orthogonal to whether auto catch-up is doing anything about it.
    setLiveButtonState(plausible && behindBy > BEHIND_THRESHOLD_SECONDS ? behindBy : null);

    if (playerState.mode === 'manual') {
      catchingUp = false;
      const action = decideCatchup({
        mode: playerState.mode,
        manualRate: playerState.manualRate,
        catchingUp,
        behindBy,
        behindPlausible: plausible,
      });
      if (action.kind === 'manualDropToNormal') {
        setManualRate(NORMAL_PLAYBACK_RATE);
        setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
      }
      return;
    }

    if (!plausible) {
      if (catchingUp) resetAutoPlaybackRate(current);
      return;
    }

    const action = decideCatchup({
      mode: playerState.mode,
      manualRate: playerState.manualRate,
      catchingUp,
      behindBy,
      behindPlausible: plausible,
    });

    const shouldMaintainCatchupRate =
      (action.kind === 'setRate' && action.rate === CATCHUP_PLAYBACK_RATE)
      || (catchingUp && behindBy > CAUGHT_UP_THRESHOLD_SECONDS);
    if (shouldMaintainCatchupRate) {
      const startedCatchingUp = !catchingUp;
      catchingUp = true;
      // Kick can reset playbackRate to 1x during an in-DVR seek/rebuffer without a media load.
      // Reconcile every auto-mode tick while hysteresis says we are catching up; the setter's
      // equality guard avoids writing (and thus fighting Kick) when the rate is already 1.5x.
      setPlayerPlaybackRate(current, CATCHUP_PLAYBACK_RATE);
      if (startedCatchingUp) {
        logger.debug('live-catchup: behind by', behindBy.toFixed(1), 's, speeding up');
      }
    } else if (action.kind === 'setRate' && action.rate === NORMAL_PLAYBACK_RATE) {
      resetAutoPlaybackRate(current);
      logger.debug('live-catchup: caught up, resetting playback rate');
    }
  };

  bindVideoElementListener(lifecycle, 'timeupdate', onTimeUpdate);
  bindVideoElementListener(lifecycle, 'loadstart', (event) => {
    const current = event.currentTarget;
    if (current instanceof HTMLVideoElement) resetMediaTracking(current);
  });
  let currentVideo: HTMLVideoElement | null = video;
  observeVideoElement(lifecycle, (current) => {
    if (current === currentVideo) return;
    if (currentVideo && getPlayerState().mode === 'auto') {
      setPlayerPlaybackRate(currentVideo, NORMAL_PLAYBACK_RATE);
    }
    currentVideo = current;
    resetMediaTracking(current);
  });
  lifecycle.add(() => {
    resetAutoPlaybackRate();
  });
  lifecycle.add(subscribePlayerState(() => {
    if (getPlayerState().mode === 'manual') catchingUp = false;
  }));

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group';

    const live = document.createElement('button');
    live.type = 'button';
    live.className = 'kickflow-player-btn kickflow-player-btn--live';
    live.title = 'Canlı yayına dön';
    liveButtonEl = live;
    lastLiveLabel = '';
    setLiveButtonState(null);

    // Plain listener tied to the rebuilt button node; native-bar re-renders drop the
    // node and its closure together, avoiding session-long listener accumulation.
    live.addEventListener('click', goLive);

    group.append(live);
    return group;
  });

  void ensurePlayerStateLoaded();
}
