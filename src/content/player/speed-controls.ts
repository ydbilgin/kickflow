import { logger } from '../shared/logger';
import { findPlayerWrapper, getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { PlayerMenu } from './player-menu';
import { bindVideoElementListener, observeVideoElement } from './video-element';
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
import { subscribeLang, t } from '../shared/i18n';

const CONTROLS_ID = 'kickflow-speed-controls';
const MANUAL_RATES = [3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25] as const;
const STARVATION_RATE_THRESHOLD = 2.5;
const STARVATION_WINDOW_MS = 5000;
const STARVATION_WAITING_COUNT = 2;
const STARVATION_FALLBACK_RATE = 1.5;

function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}x`;
}

function displayObservedRate(rate: number): string {
  const knownRates = [NORMAL_PLAYBACK_RATE, ...MANUAL_RATES];
  const nearest = knownRates.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
  );
  return Math.abs(nearest - rate) <= 0.03 ? formatRate(nearest) : `${rate.toFixed(2)}x`;
}

/** Live flag teardown path: a disabled speed feature must not leave a manual rate/state behind
 * that also prevents automatic live catch-up from resuming. Session navigation does not call
 * this, so ordinary persisted speed behavior is otherwise unchanged. */
export function deactivateSpeedControls(): void {
  const current = getVideoElement();
  if (getPlayerState().mode === 'manual') setAutoMode();
  if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
}

export function initSpeedControls(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('speed-controls: #video-player not found, skipping');
    return;
  }

  let buttonEl: HTMLButtonElement | null = null;
  let waitingEvents: number[] = [];
  let warningEl: HTMLDivElement | null = null;
  let warningTimer: number | null = null;

  const clearWarning = (): void => {
    warningEl?.remove();
    warningEl = null;
    if (warningTimer !== null) {
      window.clearTimeout(warningTimer);
      warningTimer = null;
    }
  };

  const showStarvationWarning = (): void => {
    const host = document.fullscreenElement ?? findPlayerWrapper();
    if (!host) return;
    clearWarning();
    const warning = document.createElement('div');
    warning.className = 'kickflow-speed-warning';
    warning.textContent = t('player.buffer_warning');
    host.append(warning);
    warningEl = warning;
    warningTimer = window.setTimeout(clearWarning, 2500);
  };

  const updateButtonVisual = (): void => {
    if (!buttonEl) return;
    const playerState = getPlayerState();
    if (playerState.mode === 'manual') {
      buttonEl.textContent = `${formatRate(playerState.manualRate)} ▾`;
      buttonEl.title = t('player.manual_speed', { rate: formatRate(playerState.manualRate) });
      buttonEl.setAttribute('aria-pressed', 'true');
      return;
    }

    const observedRate = getVideoElement()?.playbackRate ?? NORMAL_PLAYBACK_RATE;
    const label =
      Math.abs(observedRate - NORMAL_PLAYBACK_RATE) > 0.05 ? `⚡${displayObservedRate(observedRate)}` : t('player.auto');
    buttonEl.textContent = `${label} ▾`;
    buttonEl.title = t('player.select_speed');
    buttonEl.setAttribute('aria-pressed', 'false');
  };

  const selectAuto = (): void => {
    setAutoMode();
    const current = getVideoElement();
    if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
    updateButtonVisual();
  };

  const selectManualRate = (rate: number): void => {
    setManualRate(rate);
    const current = getVideoElement();
    if (current) setPlayerPlaybackRate(current, rate);
    updateButtonVisual();
  };

  const appendMenuItem = (menu: HTMLElement, label: string, checked: boolean, onSelect: () => void): void => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'kickflow-speed-menu__item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(checked));
    item.textContent = label;
    item.addEventListener('click', () => {
      onSelect();
      speedMenu.close();
    });
    menu.append(item);
  };

  // Hosting, positioning and every teardown path are PlayerMenu's, shared with the overflow
  // menu that hosts this very button when the bar is too narrow to hold it (bar-budget.ts).
  const speedMenu = new PlayerMenu({
    className: 'kickflow-speed-menu',
    fill: (root) => {
      const playerState = getPlayerState();
      appendMenuItem(root, `⚡ ${t('player.auto')}`, playerState.mode === 'auto', selectAuto);

      const separator = document.createElement('div');
      separator.className = 'kickflow-speed-menu__separator';
      separator.setAttribute('role', 'separator');
      root.append(separator);

      for (const rate of MANUAL_RATES) {
        appendMenuItem(
          root,
          formatRate(rate),
          playerState.mode === 'manual' && Math.abs(playerState.manualRate - rate) < 0.001,
          () => selectManualRate(rate),
        );
      }
    },
  });

  const onWaiting = (event: Event): void => {
    const current = event.currentTarget;
    if (!(current instanceof HTMLVideoElement)) return;
    if (current.playbackRate < STARVATION_RATE_THRESHOLD) {
      waitingEvents = [];
      return;
    }

    const now = Date.now();
    waitingEvents = waitingEvents.filter((timestamp) => now - timestamp <= STARVATION_WINDOW_MS);
    waitingEvents.push(now);

    if (waitingEvents.length < STARVATION_WAITING_COUNT) return;
    waitingEvents = [];
    setManualRate(STARVATION_FALLBACK_RATE);
    setPlayerPlaybackRate(current, STARVATION_FALLBACK_RATE);
    showStarvationWarning();
    logger.debug('speed-controls: high-rate playback starved, reduced to', STARVATION_FALLBACK_RATE);
  };

  bindVideoElementListener(lifecycle, 'waiting', onWaiting);
  bindVideoElementListener(lifecycle, 'ratechange', (event) => {
    const current = event.currentTarget;
    if (!(current instanceof HTMLVideoElement)) return;
    if (current.playbackRate < STARVATION_RATE_THRESHOLD) waitingEvents = [];
    updateButtonVisual();
  });
  observeVideoElement(lifecycle, (current) => {
    waitingEvents = [];
    if (current && getPlayerState().mode === 'manual') {
      setPlayerPlaybackRate(current, getPlayerState().manualRate);
    }
    updateButtonVisual();
  });
  lifecycle.add(subscribePlayerState((state, previous) => {
    const current = getVideoElement();
    updateButtonVisual();
    if (current && state.mode === 'manual') {
      setPlayerPlaybackRate(current, state.manualRate);
    } else if (current && previous.mode === 'manual') {
      setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE);
    }
    speedMenu.close();
  }));
  lifecycle.add(subscribeLang(() => {
    updateButtonVisual();
    speedMenu.close();
    if (warningEl) warningEl.textContent = t('player.buffer_warning');
  }));
  lifecycle.add(() => speedMenu.close());
  lifecycle.add(clearWarning);

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kickflow-speed-btn';
    button.setAttribute('aria-haspopup', 'menu');
    buttonEl = button;
    updateButtonVisual();

    // Direct button listener: this node is rebuilt by native-bar.ts on Kick bar re-render,
    // and the listener is collected with that node.
    button.addEventListener('click', () => speedMenu.toggle(button));

    group.append(button);
    return group;
  });

  void ensurePlayerStateLoaded().then(() => {
    if (lifecycle.isDisposed) return;
    const playerState = getPlayerState();
    const current = getVideoElement();
    if (current && playerState.mode === 'manual') {
      setPlayerPlaybackRate(current, playerState.manualRate);
    }
    updateButtonVisual();
  });
}
