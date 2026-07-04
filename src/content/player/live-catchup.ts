import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-catchup-controls';
const TOGGLE_STORAGE_KEY = 'kickflow.catchupEnabled';

// Hard cap — playbackRate never exceeds this, and the deadband below ramps it back to
// 1.0x cleanly once near live, instead of oscillating. This is the exact fix for MoKick's
// reported "keeps speeding up" bug (no cap, no deadband).
const CATCHUP_PLAYBACK_RATE = 1.5;
const NORMAL_PLAYBACK_RATE = 1.0;
const BEHIND_THRESHOLD_SECONDS = 3;
const CAUGHT_UP_THRESHOLD_SECONDS = 1.5;
// Sanity bound on "behind-live", NOT a product cap: some HLS states (observed live during
// rebuffering, 2026-07-04) report `seekable.end` as a sentinel (~2^30 ≈ 34 years) or
// Infinity. Without this guard, behindBy becomes astronomically large, the module thinks
// you are years behind live, pins playback at 1.5x forever, and renders garbage like
// "-1073741819sn" — the exact runaway-speedup failure the cap/deadband exist to prevent.
// A live DVR window is never remotely this large, so anything beyond this is a bad reading.
const MAX_PLAUSIBLE_BEHIND_SECONDS = 12 * 60 * 60;

// Live edge = the furthest BUFFERED playback position, deliberately NOT `seekable.end`.
// This mirrors Mo'Kick's proven implementation (videoPlayerCore/submodules/adaptiveSpeed.js
// uses `video.buffered.end(buffered.length - 1)`) and fixes the ROOT CAUSE of the
// "-1073741819sn" runaway: Kick's HLS `seekable.end` can report a sentinel (~2^30) or
// Infinity in some states (observed live during rebuffering, 2026-07-04), whereas
// `buffered.end` is always a sane finite value near currentTime. The MAX_PLAUSIBLE_BEHIND
// guard in onTimeUpdate stays as defense-in-depth.
function getLiveEdgeSeconds(video: HTMLVideoElement): number | null {
  const buffered = video.buffered;
  if (buffered.length === 0) return null;
  return buffered.end(buffered.length - 1);
}

async function loadToggleState(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(TOGGLE_STORAGE_KEY);
    const value = stored[TOGGLE_STORAGE_KEY];
    return typeof value === 'boolean' ? value : true;
  } catch (error) {
    logger.warn('live-catchup: failed to read toggle preference, defaulting to on', error);
    return true;
  }
}

function saveToggleState(enabled: boolean): void {
  chrome.storage.local.set({ [TOGGLE_STORAGE_KEY]: enabled }).catch((error: unknown) => {
    logger.warn('live-catchup: failed to persist toggle preference', error);
  });
}

/** Purely event-driven off the video element's own `timeupdate` — no polling. Fully
 * isolated from the chat render pipeline: no shared scheduler/state with chat/*.
 * Adds a visible "YETİŞİLİYOR -Xsn" indicator and an on/off toggle, injected into the
 * native control bar next to rewind-controls.ts's buttons (default: on). */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('live-catchup: #video-player not found, skipping');
    return;
  }

  let enabled = true;
  let catchingUp = false;
  let lastDisplayedSeconds = -1;
  let indicatorEl: HTMLElement | null = null;
  let toggleEl: HTMLButtonElement | null = null;

  const resetPlaybackRate = (): void => {
    catchingUp = false;
    if (video.playbackRate !== NORMAL_PLAYBACK_RATE) video.playbackRate = NORMAL_PLAYBACK_RATE;
  };

  // DOM writes only happen when the displayed integer-second value actually changes,
  // not on every timeupdate tick (which fires several times a second).
  const setIndicatorText = (text: string | null): void => {
    if (!indicatorEl) return;
    indicatorEl.style.display = text ? '' : 'none';
    if (text) indicatorEl.textContent = text;
  };

  const updateToggleVisual = (): void => {
    if (!toggleEl) return;
    // Text stays "OTO"; state is shown by the --on modifier (green when active, dim when off).
    toggleEl.classList.toggle('kickflow-player-toggle--on', enabled);
    toggleEl.setAttribute('aria-pressed', String(enabled));
    toggleEl.title = enabled
      ? 'Canlıya otomatik yetişme: AÇIK — kapatmak için tıkla'
      : 'Canlıya otomatik yetişme: KAPALI — açmak için tıkla';
  };

  const onTimeUpdate = (): void => {
    const liveEdge = getLiveEdgeSeconds(video);
    if (liveEdge === null) {
      // No readable buffered range (source churn/rebuffering): stand down rather than
      // leaving a stale 1.5x speed-up or indicator hanging until the next valid tick.
      if (catchingUp) resetPlaybackRate();
      if (lastDisplayedSeconds !== -1) {
        setIndicatorText(null);
        lastDisplayedSeconds = -1;
      }
      return;
    }

    const behindBy = liveEdge - video.currentTime;

    // Treat a disabled toggle and an implausible (bogus/non-finite) reading identically:
    // stand down — reset any active speed-up and hide the indicator — rather than acting
    // on a garbage live-edge value.
    const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
    if (!enabled || !plausible) {
      if (catchingUp) resetPlaybackRate();
      if (lastDisplayedSeconds !== -1) {
        setIndicatorText(null);
        lastDisplayedSeconds = -1;
      }
      return;
    }

    if (!catchingUp && behindBy > BEHIND_THRESHOLD_SECONDS) {
      catchingUp = true;
      video.playbackRate = CATCHUP_PLAYBACK_RATE;
      logger.debug('live-catchup: behind by', behindBy.toFixed(1), 's, speeding up');
    } else if (catchingUp && behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
      resetPlaybackRate();
      logger.debug('live-catchup: caught up, resetting playback rate');
    }

    if (catchingUp) {
      const rounded = Math.max(0, Math.round(behindBy));
      if (rounded !== lastDisplayedSeconds) {
        lastDisplayedSeconds = rounded;
        setIndicatorText(`YETİŞİLİYOR -${rounded}sn`);
      }
    } else if (lastDisplayedSeconds !== -1) {
      setIndicatorText(null);
      lastDisplayedSeconds = -1;
    }
  };

  lifecycle.addEventListener(video, 'timeupdate', onTimeUpdate);
  lifecycle.add(resetPlaybackRate);

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.style.cssText = 'display:inline-flex;align-items:center;';

    const indicator = document.createElement('span');
    indicator.className = 'kickflow-catchup-indicator';
    indicator.style.display = 'none';
    indicatorEl = indicator;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'kickflow-player-toggle';
    toggle.textContent = 'OTO';
    toggleEl = toggle;
    updateToggleVisual();

    // Attached directly to the button (not routed through Lifecycle) — see
    // rewind-controls.ts for why: native-bar.ts's ensure() rebuilds this button whenever
    // Kick's control bar re-renders and drops it, and a Lifecycle-routed listener would
    // keep the OLD button + closure alive until the whole session tears down.
    toggle.addEventListener('click', () => {
      enabled = !enabled;
      updateToggleVisual();
      saveToggleState(enabled);
      if (!enabled) resetPlaybackRate();
    });

    group.append(indicator, toggle);
    return group;
  });

  void loadToggleState().then((stored) => {
    enabled = stored;
    updateToggleVisual();
  });
}
