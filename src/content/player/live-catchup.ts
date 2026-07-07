import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
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
const MAX_REASONABLE_MEDIA_SECONDS = 24 * 60 * 60;

function saneBoundary(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_MEDIA_SECONDS ? value : null;
}

function getLiveEdgeSeconds(video: HTMLVideoElement): number | null {
  const buffered = video.buffered;
  if (buffered.length === 0) return null;
  return saneBoundary(buffered.end(buffered.length - 1));
}

/** Event-driven off the init-time video element. The live edge is the furthest buffered
 * playback position; seekable.end/video.duration are deliberately not used. */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('live-catchup: #video-player not found, skipping');
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

  const resetAutoPlaybackRate = (): void => {
    catchingUp = false;
    if (getPlayerState().mode === 'auto') {
      setPlayerPlaybackRate(video, NORMAL_PLAYBACK_RATE);
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
    const edge = getLiveEdgeSeconds(video);
    if (edge === null) return;
    try {
      video.currentTime = edge;
      if (getPlayerState().mode === 'auto') {
        resetAutoPlaybackRate();
      }
      if (video.paused) void video.play().catch(() => undefined);
    } catch (error) {
      logger.warn('live-catchup: go-live failed', error);
    }
  };

  const onTimeUpdate = (): void => {
    const playerState = getPlayerState();

    if (playerState.mode === 'manual') {
      catchingUp = false;
      hideIndicator();
      const liveEdge = getLiveEdgeSeconds(video);
      if (liveEdge === null) return;
      const behindBy = liveEdge - video.currentTime;
      const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
      if (
        playerState.manualRate > NORMAL_PLAYBACK_RATE &&
        plausible &&
        behindBy <= CAUGHT_UP_THRESHOLD_SECONDS
      ) {
        setManualRate(NORMAL_PLAYBACK_RATE);
        setPlayerPlaybackRate(video, NORMAL_PLAYBACK_RATE);
      }
      return;
    }

    const liveEdge = getLiveEdgeSeconds(video);
    if (liveEdge === null) {
      if (catchingUp) resetAutoPlaybackRate();
      hideIndicator();
      return;
    }

    const behindBy = liveEdge - video.currentTime;
    const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
    if (!plausible) {
      if (catchingUp) resetAutoPlaybackRate();
      hideIndicator();
      return;
    }

    if (behindBy > BEHIND_THRESHOLD_SECONDS) {
      setIndicatorBehindBy(behindBy);
    } else {
      hideIndicator();
    }

    if (!catchingUp && behindBy > BEHIND_THRESHOLD_SECONDS) {
      catchingUp = true;
      setPlayerPlaybackRate(video, CATCHUP_PLAYBACK_RATE);
      logger.debug('live-catchup: behind by', behindBy.toFixed(1), 's, speeding up');
    } else if (catchingUp && behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
      resetAutoPlaybackRate();
      logger.debug('live-catchup: caught up, resetting playback rate');
    }
  };

  lifecycle.addEventListener(video, 'timeupdate', onTimeUpdate);
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
      if (getPlayerState().mode === 'auto') {
        setManualRate(NORMAL_PLAYBACK_RATE);
        setPlayerPlaybackRate(video, NORMAL_PLAYBACK_RATE);
        catchingUp = false;
        hideIndicator();
      } else {
        setAutoMode();
        setPlayerPlaybackRate(video, NORMAL_PLAYBACK_RATE);
      }
      updateToggleVisual();
    });

    group.append(indicator, toggle);
    return group;
  });

  void ensurePlayerStateLoaded().then(updateToggleVisual);
}
