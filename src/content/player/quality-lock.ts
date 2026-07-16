import { logger } from '../shared/logger';
import { getVideoElement, findControlBar, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';
import { bindVideoElementListener } from './video-element';
import { safeStorageGet, safeStorageSet } from '../shared/extension-context';

// Kick migrated its player to Amazon IVS (confirmed live 2026-07-04: localStorage carries
// `amazon_ivs_device_config*`, `kick:player_device_id`). The old approach — writing
// `sessionStorage.stream_quality` (prior art: kick-anti-auto-quality) — is DEAD on IVS: the
// value is ignored and the stream stays at Auto. The IVS player's setQuality() API lives in
// the page's MAIN world and isn't reachable from an isolated content script. So the only
// content-script-viable path is what a user does by hand: open the native quality menu and
// click the highest available option. That is exactly what this module automates.

const PREFERENCE_STORAGE_KEY = 'kickflow.qualityPreference';
const APPLY_DELAY_MS = 1800;   // let the player + control bar settle after a source load
const MENU_RENDER_MS = 260;    // wait for the Radix quality menu to render after opening
const RETRY_DELAY_MS = 1300;
const MAX_ATTEMPTS = 5;

// A quality row's label like "1080p60" / "720p60" / "480p". EXACT match deliberately excludes
// "Auto" AND login-gated rows, whose textContent has a trailing badge (e.g. the observed
// "1080p60Giriş gerekli" when logged out) — so "highest" means highest ACTUALLY selectable.
const PURE_RESOLUTION = /^(\d{3,4})p(60)?$/i;

// The settings/quality gear is icon-only (no aria-label). Identify it ONLY by its cog SVG
// path — never a positional/last-button fallback: pressing the wrong control (fullscreen/
// PiP/theater) is a visible side effect that Escape can't cleanly undo. If the icon ever
// changes, this silently no-ops (safe) rather than clicking blindly.
const GEAR_PATH_PREFIX = 'M25.7';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function fire(el: Element, type: string, Ctor: typeof PointerEvent | typeof MouseEvent): void {
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', pointerId: 1, button: 0 } as PointerEventInit));
}
/** Radix menu triggers/items react to pointerdown/up (not a bare synthetic click), so a full
 * pointer+mouse+click sequence is dispatched. */
function press(el: Element): void {
  fire(el, 'pointerdown', PointerEvent);
  fire(el, 'mousedown', MouseEvent);
  fire(el, 'pointerup', PointerEvent);
  fire(el, 'mouseup', MouseEvent);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
}

/** Kick mounts the control bar on pointer movement over the player; simulate that so the gear
 * exists before we look for it. No-op if there's no player wrapper. */
function revealControlBar(): void {
  const wrapper = findPlayerWrapper();
  if (!wrapper) return;
  for (const type of ['pointermove', 'mousemove', 'mouseover']) {
    wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
  }
}

function findQualityGear(): HTMLButtonElement | null {
  const bar = findControlBar();
  if (!bar) return null;
  for (const b of bar.querySelectorAll('button')) {
    if ((b.querySelector('svg path')?.getAttribute('d') || '').startsWith(GEAR_PATH_PREFIX)) return b;
  }
  return null;
}

function resolutionScore(text: string): number {
  const m = text.match(PURE_RESOLUTION);
  return m ? parseInt(m[1], 10) * 10 + (m[2] ? 1 : 0) : -1;
}

function isQualityMenuOpen(): boolean {
  return document.querySelector('[role="menuitemradio"]') !== null;
}

/** No-ops when no quality menu is actually open. Every call site here calls this
 * unconditionally (including paths where the gear press may not have opened anything, e.g.
 * a wrong-button press or an early disposal before the menu rendered) — without this guard,
 * dispatch fires a synthetic Escape on `document` with no menu to close, which is
 * indistinguishable from the user's own Escape to any of Kick's own document-level listeners. */
function closeMenu(): void {
  if (!isQualityMenuOpen()) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

type ApplyResult = 'set' | 'already' | 'skip';

/** One attempt: reveal bar → open the gear menu → if (and only if) real quality radios
 * appeared, click the highest pure-resolution option, else abort with no side effect. */
async function applyHighestQualityOnce(isDisposed: () => boolean): Promise<ApplyResult> {
  if (isDisposed()) return 'skip';
  revealControlBar();
  await sleep(60);
  if (isDisposed()) return 'skip';
  const gear = findQualityGear();
  if (!gear) return 'skip';

  press(gear);
  await sleep(MENU_RENDER_MS);
  if (isDisposed()) {
    closeMenu();
    return 'skip';
  }

  const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
  if (radios.length === 0) {
    // Menu didn't open (or this wasn't the quality gear) — never click on further; just close.
    closeMenu();
    return 'skip';
  }

  let best: HTMLElement | null = null;
  let bestScore = -1;
  let bestChecked = false;
  for (const radio of radios) {
    const s = resolutionScore((radio.textContent || '').trim());
    if (s <= bestScore) continue;
    bestScore = s;
    best = radio;
    bestChecked = radio.getAttribute('aria-checked') === 'true';
  }

  if (!best) {
    closeMenu();
    return 'skip';
  }
  if (bestChecked) {
    closeMenu();
    return 'already';
  }
  if (isDisposed()) {
    closeMenu();
    return 'skip';
  }
  press(best);
  await sleep(60);
  closeMenu();
  return 'set';
}

async function applyWithRetries(isDisposed: () => boolean): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Bail if the session was torn down mid-loop (SPA channel switch): otherwise a stale
    // run would keep revealing/clicking the NEW channel's player menu — racing the fresh
    // session's own quality-lock and causing spurious menu flashes.
    if (isDisposed()) return;
    const result = await applyHighestQualityOnce(isDisposed).catch(() => 'skip' as ApplyResult);
    if (isDisposed()) return;
    if (result === 'set' || result === 'already') {
      logger.debug('quality-lock:', result, `(attempt ${attempt})`);
      return;
    }
    await sleep(RETRY_DELAY_MS);
  }
  logger.debug('quality-lock: highest quality could not be applied (gear/menu unavailable)');
}

/** Preference is currently always "highest" — persisted for forward-compat with a future
 * settings UI, not read back to change behavior yet. */
async function ensurePreferenceStored(): Promise<void> {
  const stored = await safeStorageGet(PREFERENCE_STORAGE_KEY);
  if (!(PREFERENCE_STORAGE_KEY in stored)) {
    await safeStorageSet({ [PREFERENCE_STORAGE_KEY]: 'highest' });
  }
}

/** Selects the channel's highest actually-available quality (excluding Auto and login-gated
 * options) by driving Kick's own quality menu — applied once the player settles, and again on
 * every `loadstart` (channel switch / Kick resetting to Auto). Guarded so overlapping triggers
 * never run concurrently. */
export function initQualityLock(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('quality-lock: #video-player not found, skipping');
    return;
  }

  void ensurePreferenceStored();

  let running = false;
  const trigger = (): void => {
    if (running) return;
    running = true;
    void applyWithRetries(() => lifecycle.isDisposed).finally(() => {
      running = false;
    });
  };

  const initialTimer = window.setTimeout(trigger, APPLY_DELAY_MS);
  lifecycle.add(() => window.clearTimeout(initialTimer));
  bindVideoElementListener(lifecycle, 'loadstart', trigger);
}
