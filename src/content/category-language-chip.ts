import type { Lifecycle } from './shared/lifecycle';
import { onlyChatMutations } from './shared/coalesce';
import { safeStorageGet, safeStorageSet } from './shared/extension-context';
import { t } from './shared/i18n';
import {
  CATEGORY_LANGUAGE_EVENT, CATEGORY_LANGUAGE_RESULT_ATTRIBUTE, TURKISH,
  hasLanguage, isCategoryLivePath, withLanguage,
} from '../shared/category-language';

/** "Türkçe" shortcut beside Kick's Dil filter on every /category/<slug> live list (request
 * 2026-11-24). It drives Kick's own filter: the URL `languages` list through Kick's router (MAIN
 * bridge), and if that does not take, the Türkçe checkbox in Kick's Dil popover. The last state
 * is remembered and re-applied when Kick's in-page navigation opens a category without it. */

export const CATEGORY_TURKISH_KEY = 'kf_categoryTurkish';
export const LANG_FILTER_BUTTON_SELECTOR = '#livestream_filter_by, [data-testid="content-lang-filter-button"]';
const CHIP_ID = 'kickflow-lang-chip-tr';
const STYLE_ID = 'kickflow-lang-chip-style';
/** The language's own name: the chip says Türkçe whatever KickFlow's interface language is. */
const LABEL = 'Türkçe';
const ROUTER_WAIT_MS = 1_200;
const POPOVER_WAIT_MS = 1_500;

const CSS = `
.kickflow-lang-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:6px 12px;border:0;border-radius:4px;
  font:600 14px/1 Inter,"Inter Fallback",system-ui,sans-serif;white-space:nowrap;cursor:pointer;user-select:none;
  background:rgba(83,88,99,.4);color:#fff;transition:background-color .15s,color .15s}
.kickflow-lang-chip:hover{background:rgba(83,88,99,.6)}
.kickflow-lang-chip:focus-visible{outline:2px solid #53fc18;outline-offset:2px}
.kickflow-lang-chip[aria-pressed="true"]{background:#53fc18;color:#000}
.kickflow-lang-chip[aria-pressed="true"]:hover{background:#4ae014}
.kickflow-lang-chip[data-busy="true"]{opacity:.7;cursor:progress}
.kickflow-lang-chip__mark{display:none;font-size:12px}
.kickflow-lang-chip[aria-pressed="true"] .kickflow-lang-chip__mark{display:inline}
`;

export interface CategoryLanguageDeps {
  /** Asks the MAIN-world bridge; resolves true when Kick's URL then carries the wanted state.
   * `aborted` turns true when the page left the category the run started on (review T-1). */
  viaRouter(chip: HTMLButtonElement, url: string, on: boolean, aborted?: () => boolean): Promise<boolean>;
  /** Clicks Kick's own Türkçe checkbox in the Dil popover. */
  viaPopover(filterButton: HTMLElement, on: boolean, aborted?: () => boolean): Promise<boolean>;
  wait(ms: number): Promise<void>;
  /** Whether an event is the viewer's own input (tests stand in for the browser's isTrusted). */
  trusted?(event: Event): boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const never = (): boolean => false;

/** Polls `test` for up to `ms`; gives up early (false) once `aborted` says the run is stale. */
async function until(test: () => boolean, ms: number, wait: (ms: number) => Promise<void>, aborted: () => boolean = never): Promise<boolean> {
  const step = 100;
  for (let spent = 0; spent <= ms; spent += step) {
    if (aborted()) return false;
    if (test()) return true;
    await wait(step);
  }
  return !aborted() && test();
}

function popoverCheckbox(): HTMLElement | null {
  return document.getElementById(`language-${TURKISH}`);
}

/** Kick's Dil button. Kick can leave an old or hidden copy in the DOM after an in-page change
 * (seen for the chat in 865248c): a rendered, not hidden copy wins; else the first not hidden. */
export function findLanguageFilterButton(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(LANG_FILTER_BUTTON_SELECTOR))
    .filter((el) => !el.closest('[hidden], [aria-hidden="true"]'));
  return all.find((el) => el.getClientRects().length > 0) ?? all[0] ?? null;
}

export const defaultDeps: CategoryLanguageDeps = {
  async viaRouter(chip, url, on, aborted = never) {
    chip.removeAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE);
    chip.dispatchEvent(new CustomEvent(CATEGORY_LANGUAGE_EVENT, { bubbles: true, composed: true, detail: url }));
    if (chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE) !== 'ok') return false;
    // A refused or cancelled replace ends the wait at once (review T-6).
    const failed = (): boolean => aborted() || chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE) === 'failed';
    const done = await until(() => hasLanguage(window.location.search) === on, ROUTER_WAIT_MS, this.wait, failed);
    return done;
  },
  async viaPopover(filterButton, on, aborted = never) {
    const wasOpen = filterButton.getAttribute('aria-expanded') === 'true';
    if (!wasOpen) filterButton.click();
    // Kick re-renders the Dil button ("Dil" <-> "Dil 1"): close the one on the page now.
    const close = (): void => {
      if (wasOpen) return;
      const current = findLanguageFilterButton() ?? filterButton;
      if (current.getAttribute('aria-expanded') === 'true') current.click();
    };
    const found = await until(() => popoverCheckbox() !== null, POPOVER_WAIT_MS, this.wait, aborted);
    const box = popoverCheckbox();
    // No Türkçe box (or the page moved on): nothing was clicked, so there is nothing to wait for.
    if (!found || !box || aborted()) {
      close();
      return false;
    }
    if ((box.getAttribute('aria-checked') === 'true') !== on) box.click();
    const done = await until(() => hasLanguage(window.location.search) === on, POPOVER_WAIT_MS, this.wait, aborted);
    close();
    return done;
  },
  wait: sleep,
  trusted: (event) => event.isTrusted,
};

/** How long after the viewer's own click or key in Kick's Dil popover a lost or gained `tr` in
 * the URL counts as their decision (review T-2). Kick writes the URL on the click itself. */
const OWN_CHANGE_WINDOW_MS = 4_000;
/** Kick drops `languages` on its own in-page links (also to the same category). The remembered
 * filter is put back at most this many times per category entry, so we never fight Kick. */
const MAX_REAPPLY_PER_ENTRY = 2;

/** Inside Kick's Dil control: the button, a language checkbox, or the popover holding them. */
function inLanguageControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(`${LANG_FILTER_BUTTON_SELECTOR}, [id^="language-"]`)) return true;
  const layer = target.closest('[role="dialog"], [data-radix-popper-content-wrapper], [role="listbox"], [role="menu"]');
  return !!layer?.querySelector('[id^="language-"]');
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function createChip(onClick: () => void): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = CHIP_ID;
  chip.className = 'kickflow-lang-chip';
  chip.setAttribute('data-kickflow-lang', TURKISH);
  chip.setAttribute('aria-pressed', 'false');
  const mark = document.createElement('span');
  mark.className = 'kickflow-lang-chip__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '✓';
  const text = document.createElement('span');
  text.textContent = LABEL;
  chip.append(mark, text);
  chip.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
  return chip;
}

export interface CategoryLanguageController {
  refresh(): void;
  /** Resolves when no apply is running (tests). */
  idle(): Promise<void>;
  readonly remembered: boolean;
}

export async function initCategoryLanguageChip(
  lifecycle: Lifecycle,
  deps: CategoryLanguageDeps = defaultDeps,
): Promise<CategoryLanguageController> {
  const stored = await safeStorageGet(CATEGORY_TURKISH_KEY);
  let remembered = stored[CATEGORY_TURKISH_KEY] === true;
  const inert: CategoryLanguageController = { refresh() {}, idle: async () => {}, get remembered() { return remembered; } };
  // The site lifecycle can end (or the page unload) while storage answers.
  if (lifecycle.isDisposed || typeof document === 'undefined' || !document.body) return inert;
  const isTrusted = deps.trusted ?? ((event: Event) => event.isTrusted);
  let chip: HTMLButtonElement | null = null;
  /** Category path whose entry has been handled (re-apply happens once per entry). */
  let enteredPath: string | null = null;
  /** URL Turkish state last seen on enteredPath, to notice changes made in Kick's own Dil popover. */
  let seenOn: boolean | null = null;
  let reapplied = 0;
  let busy: Promise<void> | null = null;
  let frame = 0;
  let lastOwnInput = Number.NEGATIVE_INFINITY;

  const remember = (on: boolean): void => {
    if (remembered === on) return;
    remembered = on;
    void safeStorageSet({ [CATEGORY_TURKISH_KEY]: on });
  };

  const paint = (): void => {
    if (!chip) return;
    const on = hasLanguage(window.location.search);
    const pressed = on ? 'true' : 'false';
    if (chip.getAttribute('aria-pressed') !== pressed) chip.setAttribute('aria-pressed', pressed);
    const title = t(on ? 'category.turkish_on' : 'category.turkish_off');
    if (chip.title !== title) chip.title = title;
    const busyValue = busy ? 'true' : 'false';
    if (chip.getAttribute('data-busy') !== busyValue) chip.setAttribute('data-busy', busyValue);
  };

  /** Resolves true when the URL reached `on` on the category the run started on. */
  const apply = (on: boolean): Promise<boolean> => {
    if (busy) return busy.then(() => false);
    const runPath = window.location.pathname;
    // Review T-1: a run belongs to the category it started on. Leaving it (Kick's in-page
    // navigation) ends the run before its next step, so it never sends the viewer back.
    const aborted = (): boolean => lifecycle.isDisposed || window.location.pathname !== runPath;
    let reached = false;
    const run = async (): Promise<void> => {
      const filter = findLanguageFilterButton();
      if (!chip || !filter || hasLanguage(window.location.search) === on) return;
      const url = withLanguage(runPath, window.location.search, on);
      const router = async (): Promise<boolean> => deps.viaRouter(chip!, url, on, aborted);
      const popover = async (): Promise<boolean> => {
        const current = findLanguageFilterButton();
        return current ? deps.viaPopover(current, on, aborted) : false;
      };
      // Turning on: the router adds `languages` and Kick's list follows (live, 2026-11-24).
      // Turning off: Kick keeps its own selection when the parameter merely disappears (measured:
      // URL empty, "Dil 1" and Turkish cards stayed), so only its own checkbox turns it off; the
      // router would clear the URL and leave the chip grey over a still Turkish list (review T-3).
      for (const step of on ? [router, popover] : [popover]) {
        if (aborted()) return;
        let done = false;
        try { done = await step(); } catch { done = false; }
        if (done) { reached = !aborted(); return; }
      }
    };
    const current: Promise<boolean> = run().then(() => reached, () => false).finally(() => {
      busy = null;
      if (window.location.pathname === runPath && isCategoryLivePath(runPath)) seenOn = hasLanguage(window.location.search);
      paint();
      // An entry that arrived while this run held `busy` is handled now.
      schedule();
    });
    busy = current.then(() => undefined);
    paint();
    return current;
  };

  const onChipClick = (): void => {
    if (busy) return;
    const next = !hasLanguage(window.location.search);
    // Stored only once Kick's URL really took the new state (review T-3).
    void apply(next).then((reached) => { if (reached) remember(next); });
  };

  const noteOwnInput = (event: Event): void => {
    if (isTrusted(event) && inLanguageControl(event.target)) lastOwnInput = Date.now();
  };

  let observing = false;
  const observer = new MutationObserver((records) => { if (!onlyChatMutations(records)) schedule(); });
  /** Review T-8: the page-wide observer runs only on a category list, not under a live stream. */
  const syncObserver = (onCategory: boolean): void => {
    if (onCategory && !observing) {
      observer.observe(document.body, { childList: true, subtree: true });
      observing = true;
    } else if (!onCategory && observing) {
      observer.disconnect();
      observing = false;
    }
  };

  const refresh = (): void => {
    frame = 0;
    if (lifecycle.isDisposed || typeof window === 'undefined') return;
    const path = window.location.pathname;
    const onCategory = isCategoryLivePath(path);
    syncObserver(onCategory);
    const filter = onCategory ? findLanguageFilterButton() : null;
    if (!filter || !filter.parentElement) {
      chip?.remove();
      if (!onCategory && !busy) { enteredPath = null; seenOn = null; }
      return;
    }
    ensureStyle();
    chip ??= createChip(onChipClick);
    if (filter.nextElementSibling !== chip) filter.insertAdjacentElement('afterend', chip);
    const on = hasLanguage(window.location.search);
    if (busy) {
      // The running apply's finally schedules this refresh again; the entry waits for it.
      paint();
      return;
    }
    if (enteredPath !== path) {
      enteredPath = path;
      seenOn = on;
      reapplied = 0;
      if (remembered && !on) void apply(true);
    } else if (seenOn !== null && seenOn !== on) {
      seenOn = on;
      if (Date.now() - lastOwnInput <= OWN_CHANGE_WINDOW_MS) {
        // Changed in Kick's own Dil popover on this page: that is the state to remember now.
        remember(on);
      } else if (remembered && !on && reapplied < MAX_REAPPLY_PER_ENTRY) {
        // Review T-2: Kick dropped the parameter itself (a link to this same category, or its
        // router finishing an in-page change). Not the viewer's choice: put it back.
        reapplied += 1;
        void apply(true);
      }
    }
    paint();
  };

  function schedule(): void {
    if (lifecycle.isDisposed || frame || typeof window === 'undefined') return;
    frame = window.requestAnimationFrame(refresh);
  }

  // Review T-4: a change in another tab (or the side panel) is the remembered state here too.
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== 'local' || !changes || !(CATEGORY_TURKISH_KEY in changes)) return;
    remembered = changes[CATEGORY_TURKISH_KEY]?.newValue === true;
  };
  try { chrome.storage?.onChanged?.addListener(onStorage); } catch { /* context gone */ }
  lifecycle.add(() => { try { chrome.storage?.onChanged?.removeListener(onStorage); } catch { /* context gone */ } });

  document.addEventListener('click', noteOwnInput, true);
  document.addEventListener('keydown', noteOwnInput, true);
  lifecycle.addEventListener(window, 'kickflow:locationchange', schedule);
  lifecycle.addEventListener(window, 'popstate', schedule);
  lifecycle.add(() => {
    document.removeEventListener('click', noteOwnInput, true);
    document.removeEventListener('keydown', noteOwnInput, true);
    observer.disconnect();
    observing = false;
    if (frame) window.cancelAnimationFrame(frame);
    chip?.remove();
    chip = null;
    document.getElementById(STYLE_ID)?.remove();
  });
  refresh();

  return {
    refresh,
    idle: async () => { while (busy) await busy; },
    get remembered() { return remembered; },
  };
}
