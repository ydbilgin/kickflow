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

// How many UNKNOWN (path-prefix didn't match) buttons a single attempt may press. Each such
// press is a guess, so the count is deliberately small: the trailing icon-only slot is the
// gear on every bar layout seen so far, and a second candidate only covers Kick appending
// one more icon-only control beside it.
const MAX_UNKNOWN_PROBES_PER_ATTEMPT = 2;

// A quality row's label like "1080p60" / "720p60" / "480p". EXACT match deliberately excludes
// "Auto" AND login-gated rows, whose textContent has a trailing badge (e.g. the observed
// "1080p60Giriş gerekli" when logged out) — so "highest" means highest ACTUALLY selectable.
const PURE_RESOLUTION = /^(\d{3,4})p(60)?$/i;

// The settings/quality gear is icon-only (no aria-label) and carries no data-testid, while
// every neighbouring Kick control does (video-player-pip/clip/theatre-mode/fullscreen).
//
// THESE CONSTANTS ROT, AND THEY HAVE TWICE IN EIGHT DAYS. Measured live: 'M25.7' died some
// time before 2026-08-20, 'M16.759' died before 2026-08-28 — each time quality-lock gave up
// on every page load and the player stayed on Auto. So the path prefix is now only a FAST
// PATH, newest first, never the only way in: findQualityGearCandidates() falls back to the
// bar's structure and applyHighestQualityOnce() confirms a candidate by what its menu
// CONTAINS, which is the one property Kick cannot silently redraw.
// Evidence: output/playwright/quality-gear-detector-probe.json (2026-08-20),
// output/playwright/quality-lock-round101-probe.json (2026-08-28).
export const KNOWN_GEAR_PATH_PREFIXES = ['M17.5 8.333', 'M16.759', 'M25.7'] as const;
/** The currently-live cog prefix — the first one tried. */
export const GEAR_PATH_PREFIX = KNOWN_GEAR_PATH_PREFIXES[0];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const firstPathD = (button: Element): string => button.querySelector('svg path')?.getAttribute('d') || '';

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

type GearCandidate = { button: HTMLButtonElement; via: 'known-path' | 'trailing-icon' };

/** A button that identifies itself — to a human or to a test — and therefore is NOT the
 * icon-only settings cog: every one of Kick's own side-effect controls (PiP, clip, theatre,
 * fullscreen, seek, go-live) is labelled or test-id'd, and so is the LIVE badge. */
function isIdentified(button: HTMLButtonElement): boolean {
  return button.hasAttribute('data-testid')
    || (button.getAttribute('aria-label') || '').trim() !== ''
    || (button.textContent || '').trim() !== '';
}

/**
 * Gear candidates in the order they should be tried.
 *
 * 1. Any button whose cog path matches a KNOWN prefix — free and side-effect-free.
 * 2. Otherwise the bar's TRAILING icon-only buttons, right to left. The constraint that makes
 *    this safe is positional: a candidate must sit AFTER the last identified button in the
 *    bar. On the live bar that leaves exactly the cog — play/pause and volume are icon-only
 *    too, but they lead the bar, so they can never be reached. Our own injected controls
 *    (`[id^="kickflow-"]`, e.g. the AUTO speed menu and the screenshot button) are excluded
 *    outright: pressing one would open OUR menu and read it as Kick's.
 */
export function findQualityGearCandidates(): GearCandidate[] {
  const bar = findControlBar();
  if (!bar) return [];
  const buttons = Array.from(bar.querySelectorAll('button'))
    .filter((b) => !b.closest('[id^="kickflow-"]'));

  const candidates: GearCandidate[] = [];
  const seen = new Set<HTMLButtonElement>();
  for (const button of buttons) {
    if (KNOWN_GEAR_PATH_PREFIXES.some((prefix) => firstPathD(button).startsWith(prefix))) {
      candidates.push({ button, via: 'known-path' });
      seen.add(button);
    }
  }

  let lastIdentified = -1;
  buttons.forEach((button, index) => {
    if (isIdentified(button)) lastIdentified = index;
  });
  for (let i = buttons.length - 1; i > lastIdentified; i--) {
    const button = buttons[i];
    if (seen.has(button) || !button.querySelector('svg')) continue;
    candidates.push({ button, via: 'trailing-icon' });
    seen.add(button);
  }
  return candidates;
}

function resolutionScore(text: string): number {
  const m = text.match(PURE_RESOLUTION);
  return m ? parseInt(m[1], 10) * 10 + (m[2] ? 1 : 0) : -1;
}

/**
 * The radio rows THIS press opened — never every `[role="menuitemradio"]` on the page.
 *
 * KickFlow's own playback-speed control (`speed-controls.ts`, the `AUTO ▾` item in the same
 * bar) renders rows with the same role. A document-wide query read those as the quality menu,
 * scored every row -1 and gave up. Rows that already existed before the press are therefore
 * excluded, and when the fresh rows sit inside a `[role="menu"]` container the whole menu is
 * read from that container.
 */
function menuRowsOpenedBy(before: ReadonlySet<Element>): HTMLElement[] {
  const fresh = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    .filter((row) => !before.has(row));
  const container = fresh[0]?.closest('[role="menu"]');
  return container ? Array.from(container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) : fresh;
}

/** Closes a menu only when the rows we opened are still on the page. Without the guard,
 * dispatch fires a synthetic Escape on `document` with no menu to close, which is
 * indistinguishable from the user's own Escape to any of Kick's own document-level listeners. */
function closeMenu(openedRows: readonly HTMLElement[]): void {
  if (!openedRows.some((row) => row.isConnected)) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

type ApplyResult = 'set' | 'already' | 'skip';

let reportedDiscoveredPath: string | null = null;

/** Says, once per page, that the shipped prefixes are stale and what the live cog now draws,
 * so the fast path can be restored instead of silently relying on the structural fallback. */
function reportDiscoveredGear(button: HTMLButtonElement): void {
  const d = firstPathD(button).slice(0, 40);
  if (!d || reportedDiscoveredPath === d) return;
  reportedDiscoveredPath = d;
  logger.warn(
    `quality-lock: the quality gear was found STRUCTURALLY, not by icon — Kick has redrawn the cog again. `
    + `Add this prefix to KNOWN_GEAR_PATH_PREFIXES in src/content/player/quality-lock.ts: "${d}"`,
  );
}

/** One attempt: reveal bar → press gear candidates until one opens a menu that really holds
 * resolution rows → click the highest pure-resolution option. A candidate whose menu is not
 * the quality menu is closed again and abandoned, so a wrong guess has no lasting effect. */
async function applyHighestQualityOnce(isDisposed: () => boolean): Promise<ApplyResult> {
  if (isDisposed()) return 'skip';
  revealControlBar();
  await sleep(60);
  if (isDisposed()) return 'skip';

  const candidates = findQualityGearCandidates();
  if (candidates.length === 0) return 'skip';

  let unknownProbes = 0;
  for (const { button, via } of candidates) {
    if (via === 'trailing-icon') {
      if (unknownProbes >= MAX_UNKNOWN_PROBES_PER_ATTEMPT) break;
      unknownProbes += 1;
    }

    const before = new Set<Element>(document.querySelectorAll('[role="menuitemradio"]'));
    press(button);
    await sleep(MENU_RENDER_MS);
    const rows = menuRowsOpenedBy(before);
    if (isDisposed()) {
      closeMenu(rows);
      return 'skip';
    }

    let best: HTMLElement | null = null;
    let bestScore = -1;
    let bestChecked = false;
    for (const row of rows) {
      const s = resolutionScore((row.textContent || '').trim());
      if (s <= bestScore) continue;
      bestScore = s;
      best = row;
      bestChecked = row.getAttribute('aria-checked') === 'true';
    }

    if (!best) {
      // Not the quality menu (or nothing opened at all) — undo and try the next candidate.
      closeMenu(rows);
      continue;
    }
    if (via === 'trailing-icon') reportDiscoveredGear(button);
    if (bestChecked) {
      closeMenu(rows);
      return 'already';
    }
    press(best);
    await sleep(60);
    closeMenu(rows);
    return 'set';
  }
  return 'skip';
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
  // WARN, not debug. This is exactly the "missing player selector" class the logger's own
  // policy keeps visible without a flag — and it is why a stale icon path went unnoticed for
  // weeks: giving up was logged at a level nobody sees by default.
  logger.warn(
    `quality-lock: gave up after ${MAX_ATTEMPTS} attempts — no button in the control bar opened a `
    + `quality menu. Neither KNOWN_GEAR_PATH_PREFIXES (${KNOWN_GEAR_PATH_PREFIXES.join(', ')}) nor the `
    + `trailing icon-only fallback in src/content/player/quality-lock.ts matched Kick's settings cog.`,
  );
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
