import { logger } from '../shared/logger';
import { findPlayerWrapper, getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
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

const CONTROLS_ID = 'kickflow-speed-controls';
const MANUAL_RATES = [3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25] as const;
const STARVATION_RATE_THRESHOLD = 2.5;
const STARVATION_WINDOW_MS = 5000;
const STARVATION_WAITING_COUNT = 2;
const STARVATION_FALLBACK_RATE = 1.5;

function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}x`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function displayObservedRate(rate: number): string {
  const knownRates = [NORMAL_PLAYBACK_RATE, ...MANUAL_RATES];
  const nearest = knownRates.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
  );
  return Math.abs(nearest - rate) <= 0.03 ? formatRate(nearest) : `${rate.toFixed(2)}x`;
}

function menuHost(): Element | null {
  return document.fullscreenElement ?? findPlayerWrapper();
}

export function initSpeedControls(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('speed-controls: #video-player not found, skipping');
    return;
  }

  let buttonEl: HTMLButtonElement | null = null;
  let menuEl: HTMLDivElement | null = null;
  let menuDisposers: Array<() => void> = [];
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
    const host = menuHost();
    if (!host) return;
    clearWarning();
    const warning = document.createElement('div');
    warning.className = 'kickflow-speed-warning';
    warning.textContent = 'Buffer zorlandı; hız 1.5x oldu';
    host.append(warning);
    warningEl = warning;
    warningTimer = window.setTimeout(clearWarning, 2500);
  };

  const updateButtonVisual = (): void => {
    if (!buttonEl) return;
    const playerState = getPlayerState();
    if (playerState.mode === 'manual') {
      buttonEl.textContent = `${formatRate(playerState.manualRate)} ▾`;
      buttonEl.title = `Manuel hız: ${formatRate(playerState.manualRate)}`;
      buttonEl.setAttribute('aria-pressed', 'true');
      return;
    }

    const observedRate = getVideoElement()?.playbackRate ?? NORMAL_PLAYBACK_RATE;
    const label =
      Math.abs(observedRate - NORMAL_PLAYBACK_RATE) > 0.05 ? `⚡${displayObservedRate(observedRate)}` : 'OTO';
    buttonEl.textContent = `${label} ▾`;
    buttonEl.title = 'Oynatma hızını seç';
    buttonEl.setAttribute('aria-pressed', 'false');
  };

  const closeMenu = (): void => {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    for (const dispose of menuDisposers.splice(0)) dispose();
  };

  const addMenuListener = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, listener, options);
    menuDisposers.push(() => target.removeEventListener(type, listener, options));
  };

  const positionMenu = (menu: HTMLElement, button: HTMLElement): void => {
    const buttonRect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const left = clamp(buttonRect.left + buttonRect.width / 2 - menuWidth / 2, 8, window.innerWidth - menuWidth - 8);
    const bottom = window.innerHeight - buttonRect.top + 8;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.bottom = `${Math.round(bottom)}px`;
    menu.style.visibility = '';
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
      closeMenu();
    });
    menu.append(item);
  };

  const openMenu = (): void => {
    const button = buttonEl;
    if (!button) return;
    const host = menuHost();
    if (!host) return;

    closeMenu();

    const playerState = getPlayerState();
    const menu = document.createElement('div');
    menu.className = 'kickflow-speed-menu';
    menu.setAttribute('role', 'menu');
    menu.style.visibility = 'hidden';

    appendMenuItem(menu, '⚡ OTO', playerState.mode === 'auto', selectAuto);

    const separator = document.createElement('div');
    separator.className = 'kickflow-speed-menu__separator';
    separator.setAttribute('role', 'separator');
    menu.append(separator);

    for (const rate of MANUAL_RATES) {
      appendMenuItem(
        menu,
        formatRate(rate),
        playerState.mode === 'manual' && Math.abs(playerState.manualRate - rate) < 0.001,
        () => selectManualRate(rate),
      );
    }

    host.append(menu);
    menuEl = menu;
    positionMenu(menu, button);

    addMenuListener(
      document,
      'pointerdown',
      (event) => {
        const target = event.target;
        if (!(target instanceof Node)) {
          closeMenu();
          return;
        }
        if (menu.contains(target) || button.contains(target)) return;
        closeMenu();
      },
      true,
    );
    addMenuListener(document, 'keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Escape') closeMenu();
    });
    addMenuListener(window, 'resize', closeMenu);
    addMenuListener(document, 'fullscreenchange', closeMenu);

    const disconnectTimer = window.setInterval(() => {
      if (!button.isConnected) closeMenu();
    }, 250);
    menuDisposers.push(() => window.clearInterval(disconnectTimer));
  };

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
    if (menuEl) closeMenu();
  }));
  lifecycle.add(closeMenu);
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
    button.addEventListener('click', () => {
      if (menuEl) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    group.append(button);
    return group;
  });

  void ensurePlayerStateLoaded().then(() => {
    const playerState = getPlayerState();
    const current = getVideoElement();
    if (current && playerState.mode === 'manual') {
      setPlayerPlaybackRate(current, playerState.manualRate);
    }
    updateButtonVisual();
  });
}
