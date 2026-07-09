import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { bindVideoElementListener } from './video-element';
import { liveEdge } from './rewind-controls';
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

function getLiveEdgeSeconds(video: HTMLVideoElement): number | null {
  return liveEdge(video);
}

/** Kick's live HLS player reports an infinite duration or a large finite sentinel, while
 * VODs and clips expose their actual finite duration. Buffered ranges alone therefore
 * cannot distinguish a DVR/live edge from ordinary VOD buffering. */
export function isLiveStream(video: HTMLVideoElement): boolean {
  return video.duration === Infinity || video.duration >= LIVE_DURATION_SENTINEL_SECONDS;
}

/** Event-driven off the init-time video element. The live edge is the furthest buffered
 * playback position; seekable.end/video.duration are deliberately not used. */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('live-catchup: #video-player not found, skipping');
    return;
  }

  let catchingUp = false;
  let liveButtonEl: HTMLButtonElement | null = null;
  let lastLiveLabel = '';

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

  const goLive = (): void => {
    const current = getVideoElement();
    if (!current) return;
    const edge = getLiveEdgeSeconds(current);
    if (edge === null) return;
    try {
      current.currentTime = edge;
      if (getPlayerState().mode === 'auto') {
        resetAutoPlaybackRate(current);
      }
      if (current.paused) void current.play().catch(() => undefined);
    } catch (error) {
      logger.warn('live-catchup: go-live failed', error);
    }
  };

  const onTimeUpdate = (event: Event): void => {
    const current = event.currentTarget;
    if (!(current instanceof HTMLVideoElement)) return;
    const playerState = getPlayerState();

    if (!isLiveStream(current)) {
      if (catchingUp) resetAutoPlaybackRate(current);
      setLiveButtonState(null);
      return;
    }

    const liveEdge = getLiveEdgeSeconds(current);
    if (liveEdge === null) {
      if (catchingUp) resetAutoPlaybackRate(current);
      setLiveButtonState(null);
      return;
    }

    const behindBy = liveEdge - current.currentTime;
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

    if (action.kind === 'setRate' && action.rate === CATCHUP_PLAYBACK_RATE) {
      catchingUp = true;
      setPlayerPlaybackRate(current, action.rate);
      logger.debug('live-catchup: behind by', behindBy.toFixed(1), 's, speeding up');
    } else if (action.kind === 'setRate' && action.rate === NORMAL_PLAYBACK_RATE) {
      resetAutoPlaybackRate(current);
      logger.debug('live-catchup: caught up, resetting playback rate');
    }
  };

  bindVideoElementListener(lifecycle, 'timeupdate', onTimeUpdate);
  lifecycle.add(resetAutoPlaybackRate);
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
