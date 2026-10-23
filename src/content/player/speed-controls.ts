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
import { getLang, subscribeLang, t } from '../shared/i18n';

const CONTROLS_ID = 'kickflow-speed-controls';
const MANUAL_RATES = [3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25] as const;
/** The menu's 3 x 3 grid reads slow to fast, left to right (FINAL design 2026-10-18). */
const GRID_RATES = [...MANUAL_RATES].reverse();
const GRID_COLUMNS = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
const STARVATION_RATE_THRESHOLD = 2.5;
const STARVATION_WINDOW_MS = 5000;
const STARVATION_WAITING_COUNT = 2;
const STARVATION_FALLBACK_RATE = 1.5;

function formatRate(rate: number): string {
  const text = Number.isInteger(rate) ? rate.toFixed(0) : String(rate);
  return `${getLang() === 'tr' ? text.replace('.', ',') : text}×`;
}

/** FINAL icons.svg #i-bolt, shown only while auto catch-up runs faster than 1x. */
function createBoltIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'kickflow-speed-btn__bolt');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6Z');
  svg.append(path);
  return svg;
}

function displayObservedRate(rate: number): string {
  const knownRates = [NORMAL_PLAYBACK_RATE, ...MANUAL_RATES];
  const nearest = knownRates.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
  );
  return Math.abs(nearest - rate) <= 0.03 ? formatRate(nearest) : formatRate(Number(rate.toFixed(2)));
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

  let lastVisual = '';
  /** "1x OTO" at rest, bolt + green rate while auto catch-up runs, a green framed rate when he
   * picked one by hand. Writes the DOM only when the visible state changes. */
  const updateButtonVisual = (): void => {
    if (!buttonEl) return;
    const playerState = getPlayerState();
    const manual = playerState.mode === 'manual';
    const observedRate = getVideoElement()?.playbackRate ?? NORMAL_PLAYBACK_RATE;
    const catching = !manual && Math.abs(observedRate - NORMAL_PLAYBACK_RATE) > 0.05;
    const rateText = manual ? formatRate(playerState.manualRate)
      : catching ? displayObservedRate(observedRate) : formatRate(NORMAL_PLAYBACK_RATE);
    const visual = `${manual ? 'm' : catching ? 'c' : 'a'}|${rateText}|${getLang()}`;
    if (visual === lastVisual) return;
    lastVisual = visual;
    const parts: Node[] = [];
    if (catching) parts.push(createBoltIcon());
    const value = document.createElement('span');
    value.className = 'kickflow-speed-btn__value';
    value.textContent = rateText;
    parts.push(value);
    if (!manual) {
      const auto = document.createElement('small');
      auto.className = 'kickflow-speed-btn__auto';
      auto.textContent = t('player.auto');
      parts.push(auto);
    }
    buttonEl.replaceChildren(...parts);
    buttonEl.classList.toggle('kickflow-speed-btn--manual', manual);
    buttonEl.classList.toggle('kickflow-speed-btn--catch', catching);
    buttonEl.setAttribute('aria-pressed', String(manual));
    const label = manual ? t('player.manual_speed', { rate: rateText })
      : catching ? t('player.speed_catching', { rate: rateText })
        : `${t('player.select_speed')}: ${rateText} ${t('player.auto')}`;
    buttonEl.title = manual || catching ? label : t('player.select_speed');
    buttonEl.setAttribute('aria-label', label);
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

  // FINAL 6.3 moment 2: title + Esc, one "catch up automatically" switch on top, then a 3 x 3
  // grid of speeds. Focus starts on the selected speed (or the switch); arrows move, Enter/Space
  // pick, Esc closes and hands focus back to the speed button. Hosting, positioning and teardown
  // are PlayerMenu's, shared with the overflow menu that hosts this button on a narrow bar.
  const speedMenu = new PlayerMenu({
    className: 'kickflow-speed-menu',
    fill: (root) => {
      const playerState = getPlayerState();
      root.setAttribute('aria-label', t('player.speed_menu_title'));

      const head = document.createElement('div');
      head.className = 'kickflow-speed-menu__head';
      const title = document.createElement('span');
      title.textContent = t('player.speed_menu_title');
      const esc = document.createElement('kbd');
      esc.className = 'kickflow-player-kbd';
      esc.textContent = 'Esc';
      head.append(title, esc);
      root.append(head);

      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'kickflow-speed-menu__auto';
      auto.setAttribute('role', 'menuitemcheckbox');
      auto.setAttribute('aria-checked', String(playerState.mode === 'auto'));
      const autoText = document.createElement('span');
      autoText.className = 'kickflow-speed-menu__auto-text';
      const autoTitle = document.createElement('b');
      autoTitle.textContent = t('player.speed_auto_title');
      const autoHint = document.createElement('small');
      autoHint.textContent = t('player.speed_auto_hint');
      autoText.append(autoTitle, autoHint);
      const knob = document.createElement('span');
      knob.className = 'kickflow-switch';
      knob.setAttribute('aria-hidden', 'true');
      auto.append(autoText, knob);
      auto.addEventListener('click', () => {
        // Auto off keeps playing at 1x by hand; Auto on hands the rate back to catch-up.
        if (getPlayerState().mode === 'auto') selectManualRate(NORMAL_PLAYBACK_RATE);
        else selectAuto();
        speedMenu.close();
      });
      root.append(auto);

      const grid = document.createElement('div');
      grid.className = 'kickflow-speed-menu__grid';
      grid.setAttribute('role', 'group');
      const items: HTMLButtonElement[] = [];
      for (const rate of GRID_RATES) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'kickflow-speed-menu__item';
        item.setAttribute('role', 'menuitemradio');
        const checked = playerState.mode === 'manual' && Math.abs(playerState.manualRate - rate) < 0.001;
        item.setAttribute('aria-checked', String(checked));
        item.textContent = formatRate(rate);
        item.addEventListener('click', () => {
          selectManualRate(rate);
          speedMenu.close();
        });
        items.push(item);
        grid.append(item);
      }
      const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLUMNS, ArrowUp: -GRID_COLUMNS };
      grid.addEventListener('keydown', (event) => {
        const index = items.indexOf(event.target as HTMLButtonElement);
        const step = steps[event.key];
        if (index < 0 || step === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const next = index + step;
        if (next < 0 && event.key === 'ArrowUp') {
          auto.focus();
          return;
        }
        items[Math.min(items.length - 1, Math.max(0, next))]?.focus();
      });
      auto.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        items[0]?.focus();
      });
      root.append(grid);

      const hint = document.createElement('div');
      hint.className = 'kickflow-speed-menu__hint';
      hint.textContent = t('player.speed_manual_hint');
      root.append(hint);
    },
    initialFocus: (root) => root.querySelector<HTMLElement>('.kickflow-speed-menu__item[aria-checked="true"]')
      ?? root.querySelector<HTMLElement>('.kickflow-speed-menu__auto'),
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
    lastVisual = '';
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
