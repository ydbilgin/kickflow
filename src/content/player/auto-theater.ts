import { featureFlags } from '../chat/feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import { findControlBar, findPlayerWrapper, getVideoElement } from '../shared/selectors';
import { bindVideoElementListener, observeVideoElement } from './video-element';

const RETRY_DELAY_MS = 250;
const MAX_RETRIES = 20;
const TECHNICAL_THEATER_TOKEN = /(?:^|[-_:])(theat(?:er|re)|wide)(?:[-_:]|$)/i;
const THEATER_SHORTCUT = /\(\s*t\s*\)\s*$/i;

function technicalMetadata(element: Element): string[] {
  const values: string[] = [];
  for (const name of ['id', 'class', 'data-testid', 'data-control', 'data-action', 'data-icon', 'name']) {
    const value = element.getAttribute(name);
    if (value) values.push(value);
  }
  return values;
}

/** Finds Kick's native theater toggle without binding to any displayed language. Primary
 * matching uses developer-facing metadata; the fallback uses Kick's stable `(t)` keyboard
 * shortcut, which is present after every localized tooltip (English, Turkish, etc.). Everything
 * stays scoped to the active player's native control bar so unrelated page buttons cannot match. */
export function findTheaterButton(): HTMLButtonElement | null {
  const bar = findControlBar();
  if (!bar) return null;

  for (const button of bar.querySelectorAll<HTMLButtonElement>('button')) {
    if (button.closest('[id^="kickflow-"]')) continue;
    const metadata = [
      ...technicalMetadata(button),
      ...Array.from(button.querySelectorAll('svg, svg *')).flatMap(technicalMetadata),
    ];
    if (metadata.some((value) => TECHNICAL_THEATER_TOKEN.test(value))) return button;

    const accessibleLabel = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''}`.trim();
    if (THEATER_SHORTCUT.test(accessibleLabel)) return button;
  }
  return null;
}

/** Kick's page shell owns the locale-independent `data-theatre` layout state. Button state is
 * accepted as a fallback for harnesses and future player revisions that expose a proper toggle. */
export function isTheaterModeActive(button: HTMLButtonElement | null = findTheaterButton()): boolean {
  const shell = document.querySelector<HTMLElement>('[data-theatre]');
  if (shell?.getAttribute('data-theatre') === 'true') return true;
  if (!button) return false;
  if (button.getAttribute('aria-pressed') === 'true') return true;
  return ['active', 'on', 'checked'].includes(button.getAttribute('data-state') ?? '');
}

function revealControlBar(): void {
  const wrapper = findPlayerWrapper();
  if (!wrapper) return;
  for (const type of ['pointermove', 'mousemove', 'mouseover']) {
    wrapper.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
  }
}

class AutoTheaterController {
  private video: HTMLVideoElement | null = null;
  private appliedVideo: HTMLVideoElement | null = null;
  private retryTimer: number | null = null;
  private retryCount = 0;

  constructor(private readonly lifecycle: Lifecycle) {
    observeVideoElement(lifecycle, (video) => {
      if (this.video === video) return;
      this.video = video;
      this.resetAttempt();
      this.trigger();
    });
    bindVideoElementListener(lifecycle, 'loadstart', () => {
      this.resetAttempt();
      this.trigger();
    });
    lifecycle.addEventListener(window, 'kickflow:locationchange', () => {
      this.resetAttempt();
      this.trigger();
    });
    lifecycle.add(() => this.cancelRetry());
  }

  syncFlag(): void {
    if (!featureFlags.autoTheater) {
      this.cancelRetry();
      return;
    }
    this.resetAttempt();
    this.trigger();
  }

  private resetAttempt(): void {
    this.appliedVideo = null;
    this.retryCount = 0;
    this.cancelRetry();
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry(): void {
    if (!featureFlags.autoTheater || this.lifecycle.isDisposed || this.retryTimer !== null) return;
    if (this.retryCount >= MAX_RETRIES) return;
    this.retryCount++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.trigger();
    }, RETRY_DELAY_MS);
  }

  private trigger(): void {
    if (!featureFlags.autoTheater || this.lifecycle.isDisposed) return;
    const video = getVideoElement();
    if (!video) {
      this.scheduleRetry();
      return;
    }
    if (this.video !== video) {
      this.video = video;
      this.appliedVideo = null;
      this.retryCount = 0;
    }
    if (this.appliedVideo === video) return;

    const button = findTheaterButton();
    if (isTheaterModeActive(button)) {
      this.appliedVideo = video;
      this.cancelRetry();
      return;
    }
    if (!button) {
      revealControlBar();
      this.scheduleRetry();
      return;
    }

    // One click per media load. If the owner manually exits theater afterward, KickFlow does not
    // fight them; a new channel/video/loadstart is the next automatic-entry boundary.
    this.appliedVideo = video;
    this.cancelRetry();
    button.click();
  }
}

let activeController: AutoTheaterController | null = null;

export function initAutoTheater(lifecycle: Lifecycle): void {
  const controller = new AutoTheaterController(lifecycle);
  activeController = controller;
  lifecycle.add(() => {
    if (activeController === controller) activeController = null;
  });
}

/** Called by bootstrap's one shared flag mutator so enabling the setting applies immediately,
 * without waiting for a navigation or video load event. */
export function syncAutoTheaterFlag(): void {
  activeController?.syncFlag();
}
