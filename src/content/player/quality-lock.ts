import { logger } from '../shared/logger';
import { onlyChatMutations } from '../shared/coalesce';
import { getVideoElement, findControlBar, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';
import { bindVideoElementListener, observeVideoElement } from './video-element';
import { QUALITY_PROBE_TRIGGER_ATTRIBUTE } from './controls-visibility';
import { featureFlags } from '../chat/feature-flags';
import { subscribeLang, t } from '../shared/i18n';
import { mountIntoControlBar } from './native-bar';
import { PlayerMenu } from './player-menu';
import {
  type QualityWords,
  createQualityButton,
  fillQualityMenu,
  isAutoQualityLabel,
  normalizeQualityMode,
  paintQualityChip,
  pickQuality,
  qualityModeLabel,
  qualityRenditions,
  qualityScore,
} from './bar-shared.js';

// Kick's IVS READY handler reads sessionStorage.stream_quality as a numeric height, but
// its play path clears saved heights >=1080 (saved player bundle, 2026-10-17). A guessed
// fixed height therefore cannot lock the highest rendition across sources. Drive the native
// menu instead: it exposes the available renditions and persists a valid selection itself.
// Keep automatic inspections invisible and read back Kick's own persistence acknowledgement
// when available. Never seed a guessed height or reload/seek the video to change quality.
//
// Quality design B (2026-10-29): the choice is featureFlags.qualityMode, picked from a chip
// in KickFlow's plate. 'best' selects the highest selectable row (the old behaviour), 'saver'
// the highest row at or below 480p, an exact label that row, and 'auto' Kick's own Auto row.
// Every row is selected the same way, by the same hidden press; which row is bar-shared.js
// pickQuality, the rule a fallback player bar applies to its hls.js levels.
//
// Always highest (2026-11-24): design B stored every pick, also one made in Kick's own menu,
// as qualityMode, so one 720p pick opened every later stream at 720p. With featureFlags.qualityAlwaysBest (default on) each channel opens at 'best' and a
// pick, from Kick's menu or the chip, is held in memory for that stream only: it survives a
// source reload on the same channel and is gone with the channel's player session. Off is the
// stored design-B choice.

const CONTROLS_ID = 'kickflow-quality-controls';
/** A synthetic click that follows a viewer's key or pointer this closely is Radix turning the
 * viewer's Enter/Space into a click on the row; nothing of ours runs outside a hidden probe. */
const VIEWER_INPUT_WINDOW_MS = 1000;
const APPLY_DELAY_MS = 1800;   // let the player + control bar settle after a source load
const READY_DELAY_MS = 100;
const MENU_RENDER_MS = 260;    // wait for the Radix quality menu to render after opening
const MAX_MENU_RENDER_WAITS = 4;
const RETRY_DELAY_MS = 1300;
const MAX_ATTEMPTS = 5;
const MAX_CONTROL_REARMS = 2;
// IVS may refresh its rendition list without a loadstart or a new control bar. A saved
// height acknowledges a selection, not the current list. Re-read healthy visible players
// at this low frequency; failed inspections still stop after the bounded retry budget.
// 2026-11-11: each recheck opens Kick's menu under a page-wide observer for ~1 s, so the
// interval backs off while nothing changes (30 s, 60 s, ... up to 10 min) and returns to 30 s
// when a recheck sees a different list or checked row, on a new source and on a new choice.
// A video size that no longer matches the held rendition rechecks sooner (at most every 30 s).
const RENDITION_RECHECK_MS = 30_000;
const RENDITION_RECHECK_MAX_MS = 10 * 60_000;
const RESIZE_RECHECK_DELAY_MS = 2_000;
// Review K-1 (2026-11-24): a pick in Kick's own gear menu is applied by Kick itself. Our check
// waits until its menu has closed instead of reopening it 100 ms later, mid close animation.
const NATIVE_PICK_SETTLE_MS = 1_500;

// How many UNKNOWN (path-prefix didn't match) buttons a single attempt may press. Each such
// press is a guess, so the count is deliberately small: the trailing icon-only slot is the
// gear on every bar layout seen so far, and a second candidate only covers Kick appending
// one more icon-only control beside it.
const MAX_UNKNOWN_PROBES_PER_ATTEMPT = 2;

// Row labels are read by bar-shared.js qualityScore: an EXACT "1080p60" / "480p" match, which
// excludes "Auto" AND login-gated rows, whose textContent has a trailing badge (the observed
// "1080p60Giriş gerekli" when logged out) — so "highest" means highest ACTUALLY selectable.

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
  if (findControlBar()) return;
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

type ApplyResult = 'set' | 'already' | 'skip' | 'defer';

interface NativeAcknowledgement { saved: string }

function nativeSavedQuality(): string | null {
  try { return sessionStorage.getItem('stream_quality'); } catch { return null; }
}

let nextProbe = 0;

/** Conceal only a menu created by this inspection. Mutation callbacks run before paint,
 * including when Radix mounts its portal asynchronously. Existing viewer menus are never
 * marked. Retain the mask through dismissal so the native exit animation cannot flash. */
function concealInspection(button: HTMLButtonElement, before: ReadonlySet<Element>): () => void {
  const id = String(++nextProbe);
  const existingMenus = new Set(Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).filter(visibleNativeRow));
  const marked = new Set<HTMLElement>();
  const style = document.createElement('style');
  style.textContent = `[data-kickflow-quality-probe="${id}"] { visibility: hidden !important; pointer-events: none !important; animation: none !important; transition: none !important; }`;
  (document.head ?? document.documentElement).append(style);
  const conceal = (): void => {
    for (const row of menuRowsOpenedBy(button, before)) {
      const menu = row.closest<HTMLElement>('[role="menu"]') ?? row;
      if (existingMenus.has(menu) || marked.has(menu)) continue;
      menu.setAttribute('data-kickflow-quality-probe', id);
      marked.add(menu);
    }
  };
  // Chat rows arrive many times a second; a batch made only of chat-scroller changes cannot hold
  // the portal menu, so it skips the two document-wide menu queries (2026-11-11).
  const observer = new MutationObserver((records) => {
    if (onlyChatMutations(records)) return;
    conceal();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const menu of marked) menu.removeAttribute('data-kickflow-quality-probe');
    style.remove();
  };
}

// Controllers are recreated on SPA channel/session changes; diagnose once per document.
const warnedDocuments = new WeakSet<Document>();

/** What one inspection saw in Kick's quality menu: the selectable renditions and the row that
 * is checked once the inspection is done. Feeds the chip and its "Other resolutions" fold. */
interface NativeObservation { renditions: string[]; checked: string | null }

const rowText = (row: Element): string => (row.textContent || '').trim();
const rowDisabled = (row: Element): boolean => row.matches(':disabled, [aria-disabled="true"], [data-disabled]');

/** One attempt: reveal bar → press gear candidates until one opens a menu that really holds
 * resolution rows → click the row `mode` selects (bar-shared.js pickQuality). A candidate whose
 * menu is not the quality menu is closed again and abandoned, so a wrong guess has no lasting
 * effect. */
async function applyQualityOnce(
  mode: string,
  isDisposed: () => boolean,
  acknowledge: (ack: NativeAcknowledgement) => void,
  observe: (seen: NativeObservation) => void,
): Promise<ApplyResult> {
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
    // An open menu belongs to the viewer. Do not select, conceal or dismiss it.
    if (rows.length || button.getAttribute('aria-expanded') === 'true') return 'defer';
    const restoreInspection = concealInspection(button, before);
    // Mark the trigger before pressing it: the controls presenter must not read this hidden
    // inspection's aria-expanded as a viewer-opened menu and reveal the bar.
    button.setAttribute(QUALITY_PROBE_TRIGGER_ATTRIBUTE, '');
    try {
      press(button);
      for (let wait = 0; wait < MAX_MENU_RENDER_WAITS; wait++) {
        await sleep(MENU_RENDER_MS);
        rows = menuRowsOpenedBy(button, before);
        if (rows.length || isDisposed()) break;
      }
      if (isDisposed()) return 'skip';

      const enabled = rows.filter((row) => !rowDisabled(row));
      const labels = enabled.map(rowText);
      if (!labels.some((label) => qualityScore(label) >= 0)) continue; // finally dismisses it.
      logger.debug('quality-lock: native quality menu found via', via);
      const renditions = qualityRenditions(labels);
      const checkedRow = rows.find((row) => row.getAttribute('aria-checked') === 'true');
      const pick = pickQuality(mode, labels);
      // 'auto' is Kick's own Auto row; a menu without one has nothing to change.
      const target = pick === -1
        ? enabled.find((row) => isAutoQualityLabel(rowText(row)))
        : pick === null ? undefined : enabled[pick];
      if (!target) {
        observe({ renditions, checked: checkedRow ? rowText(checkedRow) : null });
        return 'already';
      }
      const height = qualityModeLabel(rowText(target))?.match(/^(\d+)p/)?.[1];
      if (target.getAttribute('aria-checked') === 'true') {
        observe({ renditions, checked: rowText(target) });
        if (height && nativeSavedQuality() === height) acknowledge({ saved: height });
        return 'already';
      }
      const savedBefore = nativeSavedQuality();
      press(target);
      await sleep(60);
      observe({ renditions, checked: rowText(target) });
      const savedAfter = nativeSavedQuality();
      // Kick persists numeric heights from its native selection handler. A changed value
      // acknowledges this selection; a stale saved height proves nothing about this source.
      // Auto persists no height: the next attempt confirms it by reading aria-checked.
      if (height && savedAfter === height && savedAfter !== savedBefore) acknowledge({ saved: savedAfter });
      return 'set';
    } finally {
      closeMenu(rows);
      await sleep(MENU_RENDER_MS);
      restoreInspection();
      button.removeAttribute(QUALITY_PROBE_TRIGGER_ATTRIBUTE);
    }
  }
  return 'skip';
}

async function applyWithRetries(
  mode: string,
  isDisposed: () => boolean,
  reportFailure: (message: string) => void,
  confirmed: (ack: NativeAcknowledgement) => void,
  observe: (seen: NativeObservation) => void,
): Promise<'verified' | 'defer' | 'failed'> {
  const progress: { acknowledgement: NativeAcknowledgement | null } = { acknowledgement: null };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Bail if the session was torn down mid-loop (SPA channel switch): otherwise a stale
    // run would keep revealing/clicking the NEW channel's player menu — racing the fresh
    // session's own quality-lock and causing spurious menu flashes.
    if (isDisposed()) return 'failed';
    const result = await applyQualityOnce(mode, isDisposed, (ack) => { progress.acknowledgement = ack; }, observe)
      .catch(() => 'skip' as ApplyResult);
    if (isDisposed()) return 'failed';
    if (result === 'defer') return 'defer';
    // A synthetic press is not proof: READY can reset Auto and React may reject an
    // early press. Confirm a new persistence acknowledgement or inspect aria-checked.
    if (result === 'already') {
      if (progress.acknowledgement) confirmed(progress.acknowledgement);
      logger.debug('quality-lock:', result, `(attempt ${attempt})`);
      return 'verified';
    }
    await sleep(RETRY_DELAY_MS);
    if (isDisposed()) return 'failed';
    // Read back after READY's reset window instead of reopening the menu just to inspect
    // it. If Kick resets persistence, the bounded native-menu retry still runs.
    if (progress.acknowledgement && nativeSavedQuality() === progress.acknowledgement.saved) {
      confirmed(progress.acknowledgement);
      return 'verified';
    }
    progress.acknowledgement = null;
  }
  if (isDisposed()) return 'failed';
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
    return 'failed';
  }
  logger.debug('quality-lock: native menu confirmation exhausted', { candidates: findQualityGearCandidates().length });
  const what = mode === 'best' ? 'highest quality' : `quality "${mode}"`;
  reportFailure(`quality-lock: ${what} could not be confirmed; keeping the current selection.`);
  return 'failed';
}

// --- The choice: chip, menu, and the viewer's own picks in Kick's menu ----------------------

const modeListeners = new Set<() => void>();

/** Called by the flag mutator after featureFlags.qualityMode or qualityAlwaysBest changed (chip,
 * settings, another tab): every live controller re-applies at once instead of at its next 30 s recheck. */
export function notifyQualityModeChanged(): void {
  for (const listener of modeListeners) listener();
}

/** Hands a pick to the one flag mutator (bootstrap applyFlagChange), the same route the
 * settings panel uses, so it is stored, mirrored for the fallback bar and re-applied once. */
function requestQualityMode(mode: string): void {
  window.dispatchEvent(new CustomEvent('kickflow:setFlag', { detail: { key: 'qualityMode', value: mode } }));
}

/** The mode a row of Kick's own quality menu stands for, or null when the row is not in a
 * quality menu (KickFlow's speed menu has an "Auto" row too), is one of our hidden
 * inspections, or is not selectable. */
export function qualityModeFromNativeRow(row: Element): string | null {
  if (row.closest('[id^="kickflow-"], .kickflow-player-menu, [data-kickflow-quality-probe]')) return null;
  const menu = row.closest('[role="menu"]');
  if (!menu) return null;
  const labels = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map(rowText);
  if (!labels.some((label) => qualityScore(label) >= 0)) return null;
  const text = rowText(row);
  if (isAutoQualityLabel(text)) return 'auto';
  if (qualityScore(text) === Number.MAX_SAFE_INTEGER) return 'best';
  return normalizeQualityMode(qualityModeLabel(text));
}

function qualityWords(): QualityWords {
  return {
    title: t('player.quality'),
    chip: t('player.quality'),
    subBest: t('player.quality_sub_best'),
    subAuto: t('player.auto'),
    subSaver: t('player.quality_sub_saver'),
    best: t('player.quality_best'),
    bestHint: (current) => (current ? t('player.quality_best_hint_now', { label: current }) : t('player.quality_best_hint')),
    auto: t('player.quality_auto'),
    autoHint: t('player.quality_auto_hint'),
    saver: t('player.quality_saver'),
    saverHint: t('player.quality_saver_hint'),
    more: t('player.quality_more'),
  };
}

const storedMode = (): string => normalizeQualityMode(featureFlags.qualityMode) ?? 'best';

/** What a pick becomes while "always highest" is on: null (no pick, play 'best') for 'best' and
 * for the top rendition on offer, which 'best' selects anyway; otherwise the pick itself.
 * `renditions` are the short labels last seen in Kick's menu, highest first. */
export function streamPickFor(mode: string, renditions: readonly string[]): string | null {
  return mode === 'best' || (renditions.length > 0 && mode === renditions[0]) ? null : mode;
}

/** Reconcile live and recorded sources from their actual native quality rows. Healthy players
 * recheck their lists; unsuccessful passes stop after at most MAX_ATTEMPTS inspections. */
export function initQualityLock(
  lifecycle: Lifecycle,
  /** Whether an event is the viewer's own input (tests stand in for the browser's isTrusted). */
  isTrusted: (event: Event) => boolean = (event) => event.isTrusted,
): void {
  let running = false;
  let pending = false;
  let timer: number | undefined;
  let recheckTimer: number | undefined;
  let generation = 0;
  let interactionVersion = 0;
  let currentVideo: HTMLVideoElement | null = null;
  let controlsObserver: MutationObserver | null = null;
  let lastGear: HTMLButtonElement | undefined;
  let controlRearms = 0;
  let acknowledgement: NativeAcknowledgement | null = null;
  const readinessSeen = new Set<string>();
  // Last seen in Kick's menu: the renditions on offer and the checked row's text.
  let renditions: string[] = [];
  let checkedText: string | null = null;
  let chip: HTMLButtonElement | null = null;
  // The viewer's pick for this stream while "always highest" is on; never stored.
  let streamPick: string | null = null;
  const currentMode = (): string => (featureFlags.qualityAlwaysBest ? streamPick ?? 'best' : storedMode());
  // Until then, a mode change comes from a pick in Kick's own menu (see NATIVE_PICK_SETTLE_MS).
  let nativePickUntil = 0;
  /** A pick from the chip's menu or Kick's own: this stream only, or the stored choice. A chip
   * pick equal to the current choice still re-applies it (review K-5: "En iyi görüntü" after a
   * failed opening pass must not be swallowed); a native pick needs no second press. */
  const choose = (next: string, from: 'chip' | 'native'): void => {
    if (from === 'native') nativePickUntil = Date.now() + NATIVE_PICK_SETTLE_MS;
    if (!featureFlags.qualityAlwaysBest) {
      if (next !== currentMode()) requestQualityMode(next);
      else if (from === 'chip') applyModeChange();
      return;
    }
    const pick = streamPickFor(next, renditions);
    if (pick === streamPick && from === 'native') return;
    streamPick = pick;
    applyModeChange();
  };
  const reportFailure = (message: string): void => {
    if (warnedDocuments.has(document)) return;
    warnedDocuments.add(document);
    // Retaining the native selection is a safe fallback, including an HD trial/login
    // gate, a delayed menu or an unavailable rendition. The viewer has nothing to repair.
    logger.debug(message);
  };
  // Backoff state for the rendition recheck (see RENDITION_RECHECK_MS).
  let recheckDelay = RENDITION_RECHECK_MS;
  let observedSignature: string | null = null;
  let observationChanged = false;
  let comparedObservation = false;
  let lastResizeRecheck = Number.NEGATIVE_INFINITY;
  const resetRecheckBackoff = (): void => {
    recheckDelay = RENDITION_RECHECK_MS;
    observedSignature = null;
    observationChanged = false;
    comparedObservation = false;
  };
  const scheduleRenditionRecheck = (delayMs: number = recheckDelay): void => {
    window.clearTimeout(recheckTimer);
    recheckTimer = window.setTimeout(() => {
      recheckTimer = undefined;
      if (lifecycle.isDisposed || !currentVideo) return;
      const active = document.activeElement;
      if (document.visibilityState === 'hidden'
        || active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        scheduleRenditionRecheck(delayMs);
        return;
      }
      acknowledgement = null;
      request();
    }, delayMs);
  };
  /** After a pass: a recheck that saw the same list and checked row doubles the next delay. */
  const scheduleNextRecheck = (result: 'verified' | 'defer'): void => {
    if (result === 'verified') {
      // Only a recheck that compared against an earlier look and found it identical backs off.
      recheckDelay = observationChanged || !comparedObservation
        ? RENDITION_RECHECK_MS
        : Math.min(recheckDelay * 2, RENDITION_RECHECK_MAX_MS);
      observationChanged = false;
      comparedObservation = false;
    }
    scheduleRenditionRecheck(recheckDelay);
  };
  const noteObservation = (seen: NativeObservation): void => {
    const signature = `${seen.renditions.join('|')}#${seen.checked ?? ''}`;
    if (observedSignature !== null) {
      comparedObservation = true;
      if (observedSignature !== signature) observationChanged = true;
    }
    observedSignature = signature;
  };
  /** A held rendition does not change the video size. A size that no longer matches the checked
   * row (Kick reset the choice, or the rendition went away) rechecks soon instead of waiting. */
  const recheckOnSizeChange = (): void => {
    if (lifecycle.isDisposed || running || currentMode() === 'auto' || !checkedText) return;
    const held = qualityModeLabel(checkedText)?.match(/^(\d+)p/)?.[1];
    const height = getVideoElement()?.videoHeight;
    if (!held || !height || String(height) === held) return;
    const now = Date.now();
    if (now - lastResizeRecheck < RENDITION_RECHECK_MS) return;
    lastResizeRecheck = now;
    recheckDelay = RENDITION_RECHECK_MS;
    scheduleRenditionRecheck(RESIZE_RECHECK_DELAY_MS);
  };
  const drain = (): void => {
    timer = undefined;
    if (lifecycle.isDisposed || running || !pending || !currentVideo) return;
    pending = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (acknowledgement && nativeSavedQuality() === acknowledgement.saved) return;
    running = true;
    const startedGeneration = generation;
    const startedVideo = currentVideo;
    const startedInteraction = interactionVersion;
    void applyWithRetries(
      currentMode(),
      () => lifecycle.isDisposed || generation !== startedGeneration || interactionVersion !== startedInteraction || getVideoElement() !== startedVideo,
      reportFailure,
      (ack) => { acknowledgement = ack; },
      (seen) => {
        if (lifecycle.isDisposed || generation !== startedGeneration) return;
        renditions = seen.renditions;
        checkedText = seen.checked;
        // A pick made before the list was known may be the top rendition: that is 'best'.
        if (streamPick !== null && renditions.length > 0 && streamPick === renditions[0]) streamPick = null;
        noteObservation(seen);
        paintChip();
      },
    ).then((result) => {
      if (result !== 'failed' && !lifecycle.isDisposed && generation === startedGeneration) scheduleNextRecheck(result);
    }).finally(() => {
      running = false;
      if (pending && !lifecycle.isDisposed && timer === undefined) request();
    });
  };
  const request = (ready = false): void => {
    if (lifecycle.isDisposed || !currentVideo) return;
    pending = true;
    if (ready && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (timer === undefined && !running) timer = window.setTimeout(drain, ready || currentVideo.readyState >= 1 ? READY_DELAY_MS : APPLY_DELAY_MS);
  };
  const resetSource = (): void => {
    generation += 1;
    window.clearTimeout(recheckTimer);
    recheckTimer = undefined;
    acknowledgement = null;
    readinessSeen.clear();
    controlRearms = 0;
    checkedText = null;
    resetRecheckBackoff();
    paintChip();
    request();
  };

  // --- The chip (design B): what plays now, and the choice; it opens the three-choice menu.
  const currentLabel = (): string | null => {
    const held = checkedText ? qualityModeLabel(checkedText) : null;
    if (held && currentMode() !== 'auto') return held;
    const height = getVideoElement()?.videoHeight;
    return height ? `${height}p` : null;
  };
  function paintChip(): void {
    if (!chip) return;
    const words = qualityWords();
    // An exact pick held for this stream only says so; a stored exact pick has no short word.
    if (featureFlags.qualityAlwaysBest && streamPick) words.subExact = t('player.quality_sub_stream');
    paintQualityChip(chip, currentMode(), currentLabel(), words);
  }
  const qualityMenu = new PlayerMenu({
    className: 'kickflow-quality-menu',
    fill: (root) => fillQualityMenu(root, {
      mode: currentMode(),
      current: currentLabel(),
      renditions,
      words: qualityWords(),
      onPick: (mode) => {
        qualityMenu.close();
        choose(mode, 'chip');
      },
    }),
    initialFocus: (root) => root.querySelector<HTMLElement>('[aria-checked="true"]'),
  });
  // Review K-3: with the quality button off, "always highest" still runs this controller, chipless.
  if (featureFlags.qualityLock) mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group';
    const button = createQualityButton();
    // Direct listener: native-bar.ts moves this same node between Kick's re-rendered bars.
    button.addEventListener('click', () => qualityMenu.toggle(button));
    group.append(button);
    chip = button;
    paintChip();
    return group;
  });
  lifecycle.add(() => qualityMenu.close());
  lifecycle.add(subscribeLang(() => {
    paintChip();
    qualityMenu.close();
  }));
  bindVideoElementListener(lifecycle, 'resize', () => {
    paintChip();
    recheckOnSizeChange();
  });

  function applyModeChange(): void {
    acknowledgement = null;
    resetRecheckBackoff();
    // A pass still applying the previous choice is abandoned; the new one starts at once.
    if (running) interactionVersion += 1;
    paintChip();
    // Kick applies a pick from its own menu itself: check once that menu has closed.
    if (Date.now() < nativePickUntil) scheduleRenditionRecheck(Math.max(0, nativePickUntil - Date.now()));
    else request(true);
  }
  /** A flag changed (the stored choice, or "always highest" itself). A stream pick belongs to
   * "always highest": switching that off hands the choice back to the stored one. */
  const onModeChange = (): void => {
    if (!featureFlags.qualityAlwaysBest) streamPick = null;
    applyModeChange();
  };
  modeListeners.add(onModeChange);
  lifecycle.add(() => modeListeners.delete(onModeChange));

  // A pick in Kick's own gear menu becomes the choice (for this stream while "always highest"
  // is on, else the stored one), so the two menus never fight. Radix
  // turns Enter/Space on a row into an untrusted click, hence the short input window.
  let lastViewerInput = 0;
  const noteViewerInput = (event: Event): void => {
    if (isTrusted(event)) lastViewerInput = Date.now();
  };
  const adoptViewerPick = (event: Event): void => {
    if (!isTrusted(event) && Date.now() - lastViewerInput > VIEWER_INPUT_WINDOW_MS) return;
    const row = event.target instanceof Element ? event.target.closest('[role="menuitemradio"]') : null;
    const mode = row ? qualityModeFromNativeRow(row) : null;
    if (!row || !mode) return;
    // Review K-1: the clicked row is what Kick now plays. Before the first inspection the
    // renditions come from this very menu, so a pick of the top row is 'best', not a hold.
    if (renditions.length === 0) {
      const labels = Array.from(row.closest('[role="menu"]')?.querySelectorAll('[role="menuitemradio"]') ?? [])
        .filter((item) => !rowDisabled(item)).map(rowText);
      renditions = qualityRenditions(labels);
    }
    if (mode === 'auto' || qualityModeLabel(rowText(row))) checkedText = rowText(row);
    if (mode !== currentMode()) choose(mode, 'native');
    else paintChip();
  };
  document.addEventListener('pointerup', noteViewerInput, true);
  document.addEventListener('keydown', noteViewerInput, true);
  document.addEventListener('click', adoptViewerPick, true);
  lifecycle.add(() => {
    document.removeEventListener('pointerup', noteViewerInput, true);
    document.removeEventListener('keydown', noteViewerInput, true);
    document.removeEventListener('click', adoptViewerPick, true);
  });

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
        acknowledgement = null;
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
      request(true);
    });
  }
  const resumeAfterEditing = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) request();
  };
  document.addEventListener('focusout', resumeAfterEditing);
  const interruptInspection = (event: Event): void => {
    if (!event.isTrusted || !running) return;
    interactionVersion += 1;
    pending = true;
  };
  document.addEventListener('pointerdown', interruptInspection, true);
  document.addEventListener('keydown', interruptInspection, true);
  lifecycle.add(() => {
    document.removeEventListener('focusout', resumeAfterEditing);
    document.removeEventListener('pointerdown', interruptInspection, true);
    document.removeEventListener('keydown', interruptInspection, true);
    window.clearTimeout(timer);
    window.clearTimeout(recheckTimer);
    controlsObserver?.disconnect();
    pending = false;
  });
}
