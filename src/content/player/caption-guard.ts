import { logger } from '../shared/logger';
import type { Lifecycle } from '../shared/lifecycle';
import { findControlBar, findPlayerWrapper, SELECTORS } from '../shared/selectors';

/** Current Kick production key, confirmed from the public 2026-07-21 bundle export:
 * `CAPTIONS_PREFERENCE_TOKEN = "captions_enabled"`. Kick reads this boolean into its player
 * store during initialization, so a persisted `true` starts client-side SpeechRecognition as
 * soon as the video element becomes available. */
export const CAPTIONS_PREFERENCE_KEY = 'captions_enabled';

const RETRY_DELAY_MS = 250;
const MAX_RETRIES = 20;

// Current production icons (2026-07-21). Kick's active icon is one filled path; its inactive
// outline icon starts with the first path below and has three paths. Keep both the path count and
// prefix checks: an unknown future icon must safely no-op rather than risk turning captions on.
const ACTIVE_ICON_PATH_PREFIX = 'M20 17.999';
const INACTIVE_ICON_PATH_PREFIX = 'M8.99973 7.99921';

/** Prefer a semantic toggle signal if Kick adds one. The SVG signatures are the current
 * locale-independent fallback: the tooltip text changes by language and only exists on hover. */
export function getNativeCaptionState(button: HTMLButtonElement): boolean | null {
  const pressed = button.getAttribute('aria-pressed');
  if (pressed === 'true') return true;
  if (pressed === 'false') return false;

  const paths = Array.from(button.querySelectorAll<SVGPathElement>('svg path'));
  const firstPath = paths[0]?.getAttribute('d') ?? '';
  if (paths.length === 1 && firstPath.startsWith(ACTIVE_ICON_PATH_PREFIX)) return true;
  if (paths.length >= 3 && firstPath.startsWith(INACTIVE_ICON_PATH_PREFIX)) return false;
  return null;
}

function findNativeCaptionButton(): HTMLButtonElement | null {
  const button = findControlBar()?.querySelector(SELECTORS.nativeCaptionButton);
  return button instanceof HTMLButtonElement ? button : null;
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

/** Reset the native persisted preference even when it is absent or malformed. Kick's own default
 * is false; writing the explicit boolean prevents its store from restoring a previous true value. */
export function disablePersistedCaptionPreference(): void {
  try {
    window.localStorage.setItem(CAPTIONS_PREFERENCE_KEY, JSON.stringify(false));
  } catch {
    logger.debug('caption-guard: Kick localStorage unavailable; relying on the native control');
  }
}

class CaptionGuardController {
  private retryTimer: number | null = null;
  private retryCount = 0;
  private settled = false;

  constructor(private readonly lifecycle: Lifecycle) {
    // The extension currently starts at document_idle. Kick may therefore already have copied a
    // persisted true value into its in-memory player store; storage reset handles future loads,
    // while the bounded native-control pass below handles that already-hydrated race.
    disablePersistedCaptionPreference();
    lifecycle.add(() => this.cancelRetry());
    this.trigger();
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private finish(): void {
    this.settled = true;
    this.cancelRetry();
  }

  private scheduleRetry(): void {
    if (this.settled || this.lifecycle.isDisposed || this.retryTimer !== null) return;
    if (this.retryCount >= MAX_RETRIES) {
      logger.debug('caption-guard: native caption state unavailable; persisted preference reset only');
      return;
    }
    this.retryCount++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.trigger();
    }, RETRY_DELAY_MS);
  }

  private trigger(): void {
    if (this.settled || this.lifecycle.isDisposed) return;

    const button = findNativeCaptionButton();
    const state = button ? getNativeCaptionState(button) : null;
    if (state === false) {
      // Resolve once and stop observing. A later native click is an explicit current-session
      // choice and must remain usable; the next player session will reset persistence again.
      this.finish();
      return;
    }
    if (state === true && button) {
      this.finish();
      button.click();
      return;
    }

    revealControlBar();
    this.scheduleRetry();
  }
}

export function initCaptionGuard(lifecycle: Lifecycle): void {
  new CaptionGuardController(lifecycle);
}
