import { logger } from '../shared/logger';
import { getVideoElement, findControlBar, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';
import { bindVideoElementListener, observeVideoElement } from './video-element';
import { safeStorageGet, safeStorageSet } from '../shared/extension-context';

// Kick's IVS READY handler reads sessionStorage.stream_quality as a numeric height, but
// its play path clears saved heights >=1080 (saved player bundle, 2026-10-17). A guessed
// fixed height therefore cannot lock the highest rendition across sources. Drive the native
// menu instead: it exposes the available renditions and persists a valid selection itself.

const PREFERENCE_STORAGE_KEY = 'kickflow.qualityPreference';
const APPLY_DELAY_MS = 1800;   // let the player + control bar settle after a source load
const MENU_RENDER_MS = 260;    // wait for the Radix quality menu to render after opening
const MAX_MENU_RENDER_WAITS = 4;
const RETRY_DELAY_MS = 1300;
const MAX_ATTEMPTS = 5;
const MAX_CONTROL_REARMS = 2;

// How many UNKNOWN (path-prefix didn't match) buttons a single attempt may press. Each such
// press is a guess, so the count is deliberately small: the trailing icon-only slot is the
// gear on every bar layout seen so far, and a second candidate only covers Kick appending
// one more icon-only control beside it.
const MAX_UNKNOWN_PROBES_PER_ATTEMPT = 2;

// A quality row's label like "1080p60" / "2160p50" / "480p". EXACT match deliberately excludes
// "Auto" AND login-gated rows, whose textContent has a trailing badge (e.g. the observed
// "1080p60Giriş gerekli" when logged out) — so "highest" means highest ACTUALLY selectable.
const PURE_RESOLUTION = /^(\d{3,4})p(?:\s*(\d{2,3})(?:\s*fps)?)?(?:\s*\((?:source|original|kaynak|orijinal)\))?$/i;
const SOURCE_LABEL = /^(source|original|kaynak|orijinal)$/i;

// Anonymous live DOM, https://kick.com/saab, 2026-10-22: the settings button
// exposes aria-haspopup="menu" and its portal menu identifies the trigger with
// aria-labelledby. Prefer those roles and structure; paths only support legacy bars.
// The captured gear still starts with M17.5 8.33; no new prefix is needed.
export const KNOWN_GEAR_PATH_PREFIXES = ['M17.5 8.33', 'M16.759', 'M25.7'] as const;
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

type GearCandidate = { button: HTMLButtonElement; via: 'menu-role' | 'known-path' | 'trailing-icon' };

/** A button that identifies itself — to a human or to a test — and therefore is NOT the
 * icon-only settings cog: every one of Kick's own side-effect controls (PiP, clip, theatre,
 * fullscreen, seek, go-live) is labelled or test-id'd, and so is the LIVE badge. */
function isIdentified(button: HTMLButtonElement): boolean {
  return button.hasAttribute('data-testid')
    || (button.getAttribute('aria-label') || '').trim() !== ''
    || (button.textContent || '').trim() !== '';
}

/** Prefer native menu semantics, then safe trailing structure, then legacy icon paths.
 * Every candidate must still expose selectable resolution rows before we act on it. */
export function findQualityGearCandidates(): GearCandidate[] {
  const bar = findControlBar();
  if (!bar) return [];
  const buttons = Array.from(bar.querySelectorAll('button'))
    .filter((b) => !b.closest('[id^="kickflow-"]')
      && !b.matches(':disabled, [aria-disabled="true"], [data-disabled]'));
  const candidates: GearCandidate[] = [];
  const seen = new Set<HTMLButtonElement>();
  const add = (button: HTMLButtonElement, via: GearCandidate['via']): void => {
    if (seen.has(button)) return;
    seen.add(button);
    candidates.push({ button, via });
  };
  for (const button of buttons) {
    if (button.getAttribute('aria-haspopup') === 'menu') add(button, 'menu-role');
  }
  let lastIdentified = -1;
  buttons.forEach((button, index) => {
    if (isIdentified(button)) lastIdentified = index;
  });
  for (let i = buttons.length - 1; i > lastIdentified; i--) {
    if (buttons[i].querySelector('svg')) add(buttons[i], 'trailing-icon');
  }
  for (const button of buttons) {
    if (KNOWN_GEAR_PATH_PREFIXES.some((prefix) => firstPathD(button).startsWith(prefix))) {
      add(button, 'known-path');
    }
  }
  return candidates;
}

function resolutionScore(text: string): number {
  if (SOURCE_LABEL.test(text)) return Number.MAX_SAFE_INTEGER;
  const m = text.match(PURE_RESOLUTION);
  return m ? parseInt(m[1], 10) * 1000 + Number(m[2] || 0) : -1;
}

function visibleNativeRow(row: HTMLElement): boolean {
  return !row.closest('[id^="kickflow-"], [hidden], [aria-hidden="true"], [data-state="closed"]');
}

/** Radix identifies its portal with aria-labelledby (and aria-controls once open).
 * Read that associated menu even if it was already open or reused the same row nodes.
 * Fresh-row fallback supports legacy bars, without reading our playback-speed menu. */
function associatedMenuRows(button: HTMLButtonElement): HTMLElement[] {
  const controlled = (button.getAttribute('aria-controls') || '').split(/\s+/);
  const menu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).find((node) =>
    visibleNativeRow(node) && ((node.id !== '' && controlled.includes(node.id))
      || (button.id !== '' && (node.getAttribute('aria-labelledby') || '').split(/\s+/).includes(button.id))),
  );
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).filter(visibleNativeRow) : [];
}

function menuRowsOpenedBy(button: HTMLButtonElement, before: ReadonlySet<Element>): HTMLElement[] {
  const associated = associatedMenuRows(button);
  if (associated.length) return associated;
  const fresh = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    .filter((row) => !before.has(row) && visibleNativeRow(row));
  const container = fresh[0]?.closest('[role="menu"]');
  return container ? Array.from(container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).filter(visibleNativeRow) : fresh;
}

/** Closes a menu only when the rows we opened are still on the page. Without the guard,
 * dispatch fires a synthetic Escape on `document` with no menu to close, which is
 * indistinguishable from the user's own Escape to any of Kick's own document-level listeners. */
function closeMenu(openedRows: readonly HTMLElement[]): void {
  if (!openedRows.some((row) => row.isConnected && visibleNativeRow(row))) return;
  // Radix handles Escape in document capture. It must not also bubble into unrelated
  // card/dashboard dismissal listeners: this automatic reconciliation is not the
  // viewer asking to close the dialog they are reading.
  (openedRows[0].closest('[role="menu"]') ?? openedRows[0])
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: false }));
}

type ApplyResult = 'set' | 'already' | 'skip';

// Controllers are recreated on SPA channel/session changes; diagnose once per document.
const warnedDocuments = new WeakSet<Document>();

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
      if (unknownProbes >= MAX_UNKNOWN_PROBES_PER_ATTEMPT) continue;
      unknownProbes += 1;
    }

    const before = new Set<Element>(document.querySelectorAll('[role="menuitemradio"]'));
    let rows = associatedMenuRows(button);
    if (rows.length === 0) {
      press(button);
      for (let wait = 0; wait < MAX_MENU_RENDER_WAITS; wait++) {
        await sleep(MENU_RENDER_MS);
        rows = menuRowsOpenedBy(button, before);
        if (rows.length || isDisposed()) break;
      }
    }
    if (isDisposed()) {
      closeMenu(rows);
      return 'skip';
    }

    let best: HTMLElement | null = null;
    let bestScore = -1;
    let bestChecked = false;
    for (const row of rows) {
      if (row.matches(':disabled, [aria-disabled="true"], [data-disabled]')) continue;
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
    logger.debug('quality-lock: native quality menu found via', via);
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

async function applyWithRetries(isDisposed: () => boolean, reportFailure: (message: string) => void): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Bail if the session was torn down mid-loop (SPA channel switch): otherwise a stale
    // run would keep revealing/clicking the NEW channel's player menu — racing the fresh
    // session's own quality-lock and causing spurious menu flashes.
    if (isDisposed()) return;
    const result = await applyHighestQualityOnce(isDisposed).catch(() => 'skip' as ApplyResult);
    if (isDisposed()) return;
    // A synthetic press is not proof of selection: READY can reset Auto afterward, and
    // React may reject an early press. Reopen after settling and require aria-checked.
    if (result === 'already') {
      logger.debug('quality-lock:', result, `(attempt ${attempt})`);
      return;
    }
    await sleep(RETRY_DELAY_MS);
  }
  if (isDisposed()) return;
  // A promotion or loading layer is not a transport bar. A later source load or gear mount
  // triggers a fresh attempt; absence of a selectable quality needs no viewer intervention.
  const renderedNativeControls = findControlBar()
    || Array.from(findPlayerWrapper()?.querySelectorAll('button') ?? [])
      .some((button) => !button.closest('[id^="kickflow-"]') && (
        button.hasAttribute('data-testid') && button.getAttribute('data-testid')!.startsWith('video-player-')
        || button.querySelector('svg[data-ds-icon="Play"], svg[data-ds-icon="Pause"]')
      ));
  if (!renderedNativeControls) {
    logger.debug('quality-lock: retries ended before the native control bar rendered');
    return;
  }
  logger.debug('quality-lock: native menu confirmation exhausted', { candidates: findQualityGearCandidates().length });
  reportFailure('quality-lock: highest quality could not be confirmed; keeping the current selection.');
}

/** Preference is currently always "highest" — persisted for forward-compat with a future
 * settings UI, not read back to change behavior yet. */
async function ensurePreferenceStored(): Promise<void> {
  const stored = await safeStorageGet(PREFERENCE_STORAGE_KEY);
  if (!(PREFERENCE_STORAGE_KEY in stored)) {
    await safeStorageSet({ [PREFERENCE_STORAGE_KEY]: 'highest' });
  }
}

/** Bounded, event-driven reconciliation for both live and recorded players. Each source gets
 * an initial pass, one pass per readiness milestone and at most two late control mounts.
 * There is no periodic retry loop; each pass has at most MAX_ATTEMPTS menu inspections. */
export function initQualityLock(lifecycle: Lifecycle): void {
  void ensurePreferenceStored();

  let running = false;
  let pending = false;
  let timer: number | undefined;
  let generation = 0;
  let currentVideo: HTMLVideoElement | null = null;
  let controlsObserver: MutationObserver | null = null;
  let lastGear: HTMLButtonElement | undefined;
  let controlRearms = 0;
  const readinessSeen = new Set<string>();
  const reportFailure = (message: string): void => {
    if (warnedDocuments.has(document)) return;
    warnedDocuments.add(document);
    // Retaining the native selection is a safe fallback, including an HD trial/login
    // gate, a delayed menu or an unavailable rendition. The viewer has nothing to repair.
    logger.debug(message);
  };
  const drain = (): void => {
    timer = undefined;
    if (lifecycle.isDisposed || running || !pending || !currentVideo) return;
    pending = false;
    running = true;
    const startedGeneration = generation;
    const startedVideo = currentVideo;
    void applyWithRetries(
      () => lifecycle.isDisposed || generation !== startedGeneration || getVideoElement() !== startedVideo,
      reportFailure,
    ).finally(() => {
      running = false;
      if (pending && !lifecycle.isDisposed && timer === undefined) request();
    });
  };
  const request = (): void => {
    if (lifecycle.isDisposed || !currentVideo) return;
    pending = true;
    if (timer === undefined && !running) timer = window.setTimeout(drain, APPLY_DELAY_MS);
  };
  const resetSource = (): void => {
    generation += 1;
    readinessSeen.clear();
    controlRearms = 0;
    request();
  };

  observeVideoElement(lifecycle, (video) => {
    controlsObserver?.disconnect();
    currentVideo = video;
    resetSource();
    lastGear = findQualityGearCandidates()[0]?.button;
    if (!video?.parentElement) return;
    // The native gear is mounted when Kick publishes its qualities. Observe only the
    // player wrapper, not chat or the portal menus our own presses create in document.body.
    controlsObserver = new MutationObserver(() => {
      const gear = findQualityGearCandidates()[0]?.button;
      if (gear && gear !== lastGear && controlRearms < MAX_CONTROL_REARMS) {
        controlRearms += 1;
        request();
      }
      lastGear = gear;
    });
    controlsObserver.observe(video.parentElement, { childList: true, subtree: true });
  });
  bindVideoElementListener(lifecycle, 'loadstart', resetSource);
  for (const type of ['loadedmetadata', 'canplay', 'playing']) {
    bindVideoElementListener(lifecycle, type, () => {
      if (readinessSeen.has(type)) return;
      readinessSeen.add(type);
      request();
    });
  }
  lifecycle.add(() => {
    window.clearTimeout(timer);
    controlsObserver?.disconnect();
    pending = false;
  });
}
