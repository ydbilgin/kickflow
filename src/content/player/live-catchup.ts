import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { bindVideoElementListener } from './video-element';
import { liveEdge } from './rewind-controls';
import {
  NORMAL_PLAYBACK_RATE,
  ensurePlayerStateLoaded,
  getPlayerState,
  setAutoMode,
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

/** Event-driven off the init-time video element. The live edge is the furthest buffered
 * playback position; seekable.end/video.duration are deliberately not used. */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('live-catchup: #video-player not found, skipping');
    return;
  }

  let catchingUp = false;
  let lastDisplayedSeconds = -1;
  let indicatorEl: HTMLButtonElement | null = null;
  let toggleEl: HTMLButtonElement | null = null;

  const hideIndicator = (): void => {
    if (!indicatorEl) return;
    indicatorEl.style.display = 'none';
    lastDisplayedSeconds = -1;
  };

  const setIndicatorBehindBy = (behindBy: number): void => {
    if (!indicatorEl) return;
    const rounded = Math.max(0, Math.round(behindBy));
    indicatorEl.style.display = '';
    if (rounded !== lastDisplayedSeconds) {
      lastDisplayedSeconds = rounded;
      indicatorEl.textContent = `YETİŞİLİYOR -${rounded}sn`;
      indicatorEl.title = 'Canlı yayına dön';
      indicatorEl.setAttribute('aria-label', `Canlı yayına dön, ${rounded} saniye geridesin`);
    }
  };

  const resetAutoPlaybackRate = (current = getVideoElement()): void => {
    catchingUp = false;
    if (current && getPlayerState().mode === 'auto') {
      setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
    }
  };

  const updateToggleVisual = (): void => {
    if (!toggleEl) return;
    const enabled = getPlayerState().mode === 'auto';
    toggleEl.classList.toggle('kickflow-player-toggle--on', enabled);
    toggleEl.setAttribute('aria-pressed', String(enabled));
    toggleEl.title = enabled
      ? 'Canlıya otomatik yetişme: AÇIK — kapatmak için tıkla'
      : 'Canlıya otomatik yetişme: KAPALI — açmak için tıkla';
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

    if (playerState.mode === 'manual') {
      catchingUp = false;
      hideIndicator();
      const liveEdge = getLiveEdgeSeconds(current);
      if (liveEdge === null) return;
      const behindBy = liveEdge - current.currentTime;
      const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
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

    const liveEdge = getLiveEdgeSeconds(current);
    if (liveEdge === null) {
      if (catchingUp) resetAutoPlaybackRate(current);
      hideIndicator();
      return;
    }

    const behindBy = liveEdge - current.currentTime;
    const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
    if (!plausible) {
      if (catchingUp) resetAutoPlaybackRate(current);
      hideIndicator();
      return;
    }

    if (behindBy > BEHIND_THRESHOLD_SECONDS) {
      setIndicatorBehindBy(behindBy);
    } else {
      hideIndicator();
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
    updateToggleVisual();
    if (getPlayerState().mode === 'manual') {
      catchingUp = false;
      hideIndicator();
    }
  }));

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group kickflow-catchup-group';

    const indicator = document.createElement('button');
    indicator.type = 'button';
    indicator.className = 'kickflow-catchup-indicator';
    indicator.style.display = 'none';
    indicatorEl = indicator;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'kickflow-player-toggle';
    toggle.textContent = 'OTO';
    toggleEl = toggle;
    updateToggleVisual();

    // Plain listeners are tied to these rebuilt button nodes; native-bar re-renders drop the
    // nodes and their closures together, avoiding session-long listener accumulation.
    indicator.addEventListener('click', goLive);
    toggle.addEventListener('click', () => {
      const current = getVideoElement();
      if (getPlayerState().mode === 'auto') {
        setManualRate(NORMAL_PLAYBACK_RATE);
        if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
        catchingUp = false;
        hideIndicator();
      } else {
        setAutoMode();
        if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
      }
      updateToggleVisual();
    });

    group.append(indicator, toggle);
    return group;
  });

  void ensurePlayerStateLoaded().then(updateToggleVisual);
}
