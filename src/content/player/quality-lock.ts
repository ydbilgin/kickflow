import { logger } from '../shared/logger';
import { findControlBar, getVideoElement } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

// Kick stores the active stream quality in sessionStorage and resets it to "Auto" every
// session (confirmed prior art: github.com/firatmelih/kick-anti-auto-quality). Writing
// this key is the primary, lightest mechanism — far more reliable than scanning/clicking
// an unconfirmed settings menu, and it's what the UI fallback below exists to back up,
// not replace.
const SESSION_STORAGE_KEY = 'stream_quality';
const HIGHEST_QUALITY_GUESS = '1080p60';

const PREFERENCE_STORAGE_KEY = 'kickflow.qualityPreference';

const UI_FALLBACK_DELAY_MS = 1500;
const MENU_WAIT_TIMEOUT_MS = 1200;
const MENU_POLL_INTERVAL_MS = 50;

function applySessionStorageQuality(): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, HIGHEST_QUALITY_GUESS);
    logger.debug('quality-lock: wrote sessionStorage', SESSION_STORAGE_KEY, '=', HIGHEST_QUALITY_GUESS);
  } catch (error) {
    logger.warn('quality-lock: sessionStorage write failed', error);
  }
}

/** Preference is currently always "highest" — persisted for forward-compatibility with a
 * future settings UI, not read back to change behavior yet. */
async function ensurePreferenceStored(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PREFERENCE_STORAGE_KEY);
    if (!(PREFERENCE_STORAGE_KEY in stored)) {
      await chrome.storage.local.set({ [PREFERENCE_STORAGE_KEY]: 'highest' });
    }
  } catch (error) {
    logger.warn('quality-lock: preference read/write failed (non-fatal)', error);
  }
}

function isQualityLikeText(text: string): boolean {
  return /\d{3,4}p|auto|source/i.test(text);
}

function parseQualityRank(text: string): number {
  if (/source/i.test(text)) return 100000; // Source, if present, always outranks numeric labels
  const match = text.match(/(\d{3,4})p/i);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function findQualityMenuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], li, button')
  ).filter((el) => isQualityLikeText(el.textContent ?? ''));
}

/** Async-waits for menu items to actually appear (MutationObserver-style poll bounded by
 * a timeout) rather than assuming a fixed delay is enough for the menu to have rendered. */
function waitForMenuItems(lifecycle: Lifecycle, timeoutMs: number): Promise<HTMLElement[]> {
  return new Promise((resolve) => {
    const immediate = findQualityMenuItems();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }

    const deadline = Date.now() + timeoutMs;
    const poll = (): void => {
      const items = findQualityMenuItems();
      if (items.length > 0 || Date.now() >= deadline) {
        resolve(items);
        return;
      }
      lifecycle.setTimeout(poll, MENU_POLL_INTERVAL_MS);
    };
    lifecycle.setTimeout(poll, MENU_POLL_INTERVAL_MS);
  });
}

function findRightControlCluster(): HTMLElement | null {
  const bar = findControlBar();
  if (!bar) return null;
  const children = Array.from(bar.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  return children.length > 0 ? children[children.length - 1] : null;
}

function closeAnyOpenMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** Best-effort, single-shot UI fallback. Kick's settings/quality button is icon-only with
 * no aria-label anywhere in the bar (confirmed live), so it can't be targeted directly.
 * Rather than clicking every button in the right-hand cluster to "probe" for a menu —
 * which risks misfiring unrelated controls like fullscreen or captions — this tries
 * exactly ONE heuristic candidate (the cluster's second-to-last button, a common
 * settings-before-fullscreen placement) and, if no quality-like menu appears, backs out
 * via Escape and gives up quietly. Only ever runs once per session — see
 * scheduleUiFallbackOnce in initQualityLock. */
async function tryUiFallback(lifecycle: Lifecycle): Promise<void> {
  const cluster = findRightControlCluster();
  if (!cluster) return;

  const buttons = Array.from(cluster.querySelectorAll<HTMLButtonElement>('button'));
  if (buttons.length === 0) return;

  const candidate = buttons.length >= 2 ? buttons[buttons.length - 2] : buttons[buttons.length - 1];
  candidate.click();

  const items = await waitForMenuItems(lifecycle, MENU_WAIT_TIMEOUT_MS);
  if (items.length === 0) {
    closeAnyOpenMenu();
    logger.warn('quality-lock: UI fallback found no quality menu, backed out');
    return;
  }

  let best: HTMLElement | null = null;
  let bestRank = -1;
  for (const item of items) {
    const text = item.textContent ?? '';
    if (/auto/i.test(text) && !/source/i.test(text)) continue;
    const rank = parseQualityRank(text);
    if (rank > bestRank) {
      bestRank = rank;
      best = item;
    }
  }

  if (!best) {
    closeAnyOpenMenu();
    logger.warn('quality-lock: UI fallback menu had no non-Auto option');
    return;
  }

  const chosen = best;
  chosen.click();
  window.setTimeout(() => {
    const confirmed =
      chosen.getAttribute('aria-checked') === 'true' ||
      chosen.getAttribute('data-state') === 'checked' ||
      chosen.getAttribute('data-state') === 'active';
    logger.debug('quality-lock: UI fallback selected', chosen.textContent, confirmed ? '(confirmed)' : '(unconfirmed)');
  }, 150);
}

/** Event-driven only, no polling loops: applies once on mount and again on every
 * `loadstart` (Kick resets stream_quality to Auto on every new source load). The
 * sessionStorage write is silent/cheap so it's safe to repeat; the UI fallback visibly
 * opens a menu, so it only ever runs once per session regardless of how many times
 * `loadstart` fires.
 *
 * Does NOT attempt the HLS `currentLevel` API — that needs the page's own hls.js
 * instance, which an isolated-world content script cannot reach without a MAIN-world
 * bridge. Possible phase-2 improvement if that instance is ever confirmed reachable. */
export function initQualityLock(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('quality-lock: #video-player not found, skipping');
    return;
  }

  void ensurePreferenceStored();

  let uiFallbackAttempted = false;
  const scheduleUiFallbackOnce = (): void => {
    if (uiFallbackAttempted) return;
    uiFallbackAttempted = true;
    lifecycle.setTimeout(() => {
      void tryUiFallback(lifecycle).catch((error: unknown) => {
        logger.warn('quality-lock: UI fallback threw, giving up', error);
      });
    }, UI_FALLBACK_DELAY_MS);
  };

  const apply = (): void => {
    applySessionStorageQuality();
    scheduleUiFallbackOnce();
  };

  apply();
  lifecycle.addEventListener(video, 'loadstart', apply);
}
