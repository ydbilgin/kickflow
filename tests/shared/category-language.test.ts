import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATEGORY_LANGUAGE_RESULT_ATTRIBUTE, hasLanguage, isCategoryLivePath, languagesOf, parseCategoryLanguageRequest, withLanguage,
} from '../../src/shared/category-language';
import { installCategoryLanguageBridge } from '../../src/mainworld/category-language-bridge';
import {
  CATEGORY_TURKISH_KEY, defaultDeps, initCategoryLanguageChip, type CategoryLanguageDeps,
} from '../../src/content/category-language-chip';
import { Lifecycle } from '../../src/content/shared/lifecycle';

// Kick's own filter as measured read-only on kick.com/category/valorant, 2026-11-24:
// Dil combobox #livestream_filter_by, popover checkbox button#language-tr (role=checkbox),
// URL `languages=tr` / `languages=tr,en`; in-page navigation to another category drops it.

describe('category language URL contract', () => {
  it('recognises only the live list of a category', () => {
    expect(isCategoryLivePath('/category/valorant')).toBe(true);
    expect(isCategoryLivePath('/category/just-chatting/')).toBe(true);
    expect(isCategoryLivePath('/category/valorant/clips')).toBe(false);
    expect(isCategoryLivePath('/valorant')).toBe(false);
  });

  it('reads and edits Kick’s comma list without touching sort or other languages', () => {
    expect(languagesOf('?sort=recommended&languages=tr,en')).toEqual(['tr', 'en']);
    expect(hasLanguage('?languages=en')).toBe(false);
    expect(withLanguage('/category/valorant', '?sort=recommended', true)).toBe('/category/valorant?sort=recommended&languages=tr');
    expect(withLanguage('/category/valorant', '?sort=featured&languages=en', true)).toBe('/category/valorant?sort=featured&languages=en,tr');
    expect(withLanguage('/category/valorant', '?sort=featured&languages=tr,en', false)).toBe('/category/valorant?sort=featured&languages=en');
    expect(withLanguage('/category/valorant', '?languages=tr', false)).toBe('/category/valorant');
  });

  it('lets only a category path reach the router', () => {
    expect(parseCategoryLanguageRequest('/category/valorant?languages=tr')).toBe('/category/valorant?languages=tr');
    expect(parseCategoryLanguageRequest('https://evil.example/category/x')).toBeNull();
    expect(parseCategoryLanguageRequest('//evil.example/category/x')).toBeNull();
    expect(parseCategoryLanguageRequest('/xqc')).toBeNull();
    expect(parseCategoryLanguageRequest(42)).toBeNull();
  });
});

/** Kick's Dil row and popover, shaped like the live page. The fake router writes the URL and
 * repaints the popover checkbox the way Kick does. */
function kickCategoryPage(path = '/category/valorant?sort=recommended') {
  history.replaceState(null, '', path);
  const row = document.createElement('div');
  const label = document.createElement('span'); label.textContent = 'Filtrele:';
  const dil = document.createElement('button');
  dil.id = 'livestream_filter_by'; dil.dataset.testid = 'content-lang-filter-button';
  dil.setAttribute('aria-expanded', 'false'); dil.textContent = 'Dil';
  row.append(label, dil);
  document.body.append(row);
  const popover = document.createElement('div');
  const setUrl = (url: string) => history.replaceState(null, '', url);
  dil.addEventListener('click', () => {
    const open = dil.getAttribute('aria-expanded') !== 'true';
    dil.setAttribute('aria-expanded', String(open));
    if (open) {
      const box = document.createElement('button');
      box.id = 'language-tr'; box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(hasLanguage(location.search)));
      box.addEventListener('click', () => setUrl(withLanguage(location.pathname, location.search, !hasLanguage(location.search))));
      popover.replaceChildren(box); document.body.append(popover);
    } else popover.remove();
  });
  return { dil, row, setUrl };
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const storageListeners = new Set<StorageListener>();

function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  vi.stubGlobal('chrome', {
    runtime: { id: 'fixture-extension' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, items); }),
      },
      onChanged: {
        addListener: (listener: StorageListener) => storageListeners.add(listener),
        removeListener: (listener: StorageListener) => storageListeners.delete(listener),
      },
    },
  });
  return data;
}

/** Another tab (or the side panel) writing the key. */
function otherTabWrites(key: string, value: unknown) {
  for (const listener of storageListeners) listener({ [key]: { newValue: value } }, 'local');
}

const instantWait = () => Promise.resolve();

describe('Türkçe chip on category pages', () => {
  let lifecycle: Lifecycle;
  let stopBridge: (() => void) | undefined;
  beforeEach(() => {
    lifecycle = new Lifecycle();
    // Runs the frame at once; returns 0 so the chip's `frame` guard is free again afterwards, as it
    // is in a browser where the callback runs after the id is stored.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  });
  afterEach(() => {
    lifecycle.dispose(); stopBridge?.(); stopBridge = undefined;
    delete (window as Window & { next?: unknown }).next;
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('sits right of the Dil filter and turns Kick’s Turkish filter on through Kick’s router', async () => {
    const data = storage();
    const { dil } = kickCategoryPage();
    const replace = vi.fn(async (url: string) => { history.replaceState(null, '', url); return true; });
    (window as Window & { next?: unknown }).next = { router: { replace } };
    stopBridge = installCategoryLanguageBridge();
    const controller = await initCategoryLanguageChip(lifecycle);
    const chip = dil.nextElementSibling as HTMLButtonElement;
    expect(chip?.textContent).toContain('Türkçe');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    chip.click();
    await controller.idle();
    expect(replace).toHaveBeenCalledWith('/category/valorant?sort=recommended&languages=tr', undefined, { shallow: true, scroll: false });
    expect(location.search).toBe('?sort=recommended&languages=tr');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE)).toBe('ok');
    expect(data[CATEGORY_TURKISH_KEY]).toBe(true);
    // Off goes through Kick's own checkbox first: removing the parameter alone left Kick's
    // selection (and its Turkish list) in place on the live page.
    chip.click();
    await controller.idle();
    expect(location.search).toBe('?sort=recommended');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(dil.getAttribute('aria-expanded')).toBe('false');
    expect(data[CATEGORY_TURKISH_KEY]).toBe(false);
  });

  it('falls back to Kick’s own Türkçe checkbox when the router does not take', async () => {
    storage();
    const { dil } = kickCategoryPage();
    const deps: CategoryLanguageDeps = {
      viaRouter: vi.fn(async () => false),
      viaPopover: (await import('../../src/content/category-language-chip')).defaultDeps.viaPopover,
      wait: instantWait,
    };
    const controller = await initCategoryLanguageChip(lifecycle, deps);
    (dil.nextElementSibling as HTMLButtonElement).click();
    await controller.idle();
    expect(deps.viaRouter).toHaveBeenCalled();
    expect(location.search).toBe('?sort=recommended&languages=tr');
    expect(dil.getAttribute('aria-expanded')).toBe('false');
  });

  it('re-applies the remembered filter when Kick navigates to another category without it', async () => {
    storage({ [CATEGORY_TURKISH_KEY]: true });
    kickCategoryPage('/category/valorant?languages=tr');
    const viaRouter = vi.fn(async (_chip: HTMLButtonElement, url: string) => { history.replaceState(null, '', url); return true; });
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover: vi.fn(async () => false), wait: instantWait });
    expect(viaRouter).not.toHaveBeenCalled();
    // Kick's in-page navigation: new path, parameter gone, new Dil row mounted.
    document.body.replaceChildren();
    kickCategoryPage('/category/just-chatting');
    controller.refresh();
    await controller.idle();
    expect(viaRouter).toHaveBeenCalledTimes(1);
    expect(location.search).toBe('?languages=tr');
    expect(document.querySelector('#livestream_filter_by + .kickflow-lang-chip')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('remembers a change made in Kick’s own Dil popover and does not fight it on that page', async () => {
    const data = storage({ [CATEGORY_TURKISH_KEY]: true });
    const { dil } = kickCategoryPage('/category/valorant?languages=tr');
    const viaRouter = vi.fn(async () => true);
    // jsdom marks scripted clicks untrusted; `trusted` stands in for the viewer's real click.
    const controller = await initCategoryLanguageChip(lifecycle, {
      viaRouter, viaPopover: vi.fn(async () => false), wait: instantWait, trusted: () => true,
    });
    dil.click();
    document.getElementById('language-tr')!.click();
    expect(location.search).toBe('');
    controller.refresh();
    await controller.idle();
    expect(viaRouter).not.toHaveBeenCalled();
    expect(data[CATEGORY_TURKISH_KEY]).toBe(false);
    expect(controller.remembered).toBe(false);
  });

  it('review T-2: Kick dropping the parameter itself (a link to the same category) is not the viewer turning it off', async () => {
    const data = storage({ [CATEGORY_TURKISH_KEY]: true });
    const { setUrl } = kickCategoryPage('/category/valorant?languages=tr');
    const viaRouter = vi.fn(async (_chip: HTMLButtonElement, url: string) => { history.replaceState(null, '', url); return true; });
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover: vi.fn(async () => false), wait: instantWait });
    // The viewer clicks Valorant in Kick's sidebar again: same path, `languages` gone, no Dil click.
    setUrl('/category/valorant');
    controller.refresh();
    await controller.idle();
    expect(viaRouter).toHaveBeenCalledTimes(1);
    expect(location.search).toBe('?languages=tr');
    expect(controller.remembered).toBe(true);
    expect(data[CATEGORY_TURKISH_KEY]).toBe(true);
    // Bounded: Kick dropping it again and again is put back at most twice per entry.
    for (let i = 0; i < 4; i++) {
      setUrl('/category/valorant');
      controller.refresh();
      await controller.idle();
    }
    expect(viaRouter).toHaveBeenCalledTimes(2);
    expect(controller.remembered).toBe(true);
  });

  it('review T-1: leaving the category during an apply neither sends the viewer back nor skips the new category', async () => {
    storage({ [CATEGORY_TURKISH_KEY]: true });
    kickCategoryPage('/category/valorant');
    const urls: string[] = [];
    let release: () => void = () => {};
    const viaRouter = vi.fn(async (_chip: HTMLButtonElement, url: string, _on: boolean, aborted?: () => boolean) => {
      urls.push(url);
      if (urls.length === 1) {
        // The first run stalls until the viewer has moved on; it must then give up.
        await new Promise<void>((resolve) => { release = resolve; });
        return aborted?.() ? false : true;
      }
      history.replaceState(null, '', url);
      return true;
    });
    const viaPopover = vi.fn(async () => false);
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover, wait: instantWait });
    expect(urls).toEqual(['/category/valorant?languages=tr']);
    // Kick's in-page navigation to another category while the first apply is still running.
    document.body.replaceChildren();
    kickCategoryPage('/category/counter-strike-2');
    controller.refresh();
    release();
    await controller.idle();
    await controller.idle();
    expect(viaPopover).not.toHaveBeenCalled();
    expect(urls).toEqual(['/category/valorant?languages=tr', '/category/counter-strike-2?languages=tr']);
    expect(location.pathname).toBe('/category/counter-strike-2');
    expect(location.search).toBe('?languages=tr');
  });

  it('review T-3: turning off never falls back to the router, and a failed change is not stored', async () => {
    const data = storage({ [CATEGORY_TURKISH_KEY]: true });
    kickCategoryPage('/category/valorant?languages=tr');
    const viaRouter = vi.fn(async () => true);
    const viaPopover = vi.fn(async () => false);
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover, wait: instantWait });
    const chip = document.querySelector<HTMLButtonElement>('.kickflow-lang-chip')!;
    chip.click();
    await controller.idle();
    await Promise.resolve();
    expect(viaPopover).toHaveBeenCalledTimes(1);
    expect(viaRouter).not.toHaveBeenCalled();
    expect(location.search).toBe('?languages=tr');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(data[CATEGORY_TURKISH_KEY]).toBe(true);
    expect(controller.remembered).toBe(true);
  });

  it('review T-4: a change stored by another tab is the remembered state here', async () => {
    storage();
    kickCategoryPage('/category/valorant');
    const viaRouter = vi.fn(async (_chip: HTMLButtonElement, url: string) => { history.replaceState(null, '', url); return true; });
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover: vi.fn(async () => false), wait: instantWait });
    expect(controller.remembered).toBe(false);
    otherTabWrites(CATEGORY_TURKISH_KEY, true);
    expect(controller.remembered).toBe(true);
    document.body.replaceChildren();
    kickCategoryPage('/category/just-chatting');
    controller.refresh();
    await controller.idle();
    expect(location.search).toBe('?languages=tr');
    otherTabWrites(CATEGORY_TURKISH_KEY, false);
    expect(controller.remembered).toBe(false);
    lifecycle.dispose();
    expect(storageListeners.size).toBe(0);
  });

  it('review T-5: no Türkçe box in the popover closes it at once and clicks nothing', async () => {
    storage();
    const dil = document.createElement('button');
    dil.id = 'livestream_filter_by';
    dil.setAttribute('aria-expanded', 'false');
    // A Dil popover that never offers a Türkçe box.
    dil.addEventListener('click', () => dil.setAttribute('aria-expanded', String(dil.getAttribute('aria-expanded') !== 'true')));
    document.body.append(dil);
    history.replaceState(null, '', '/category/valorant');
    const waits: number[] = [];
    const deps = { ...defaultDeps, wait: async (ms: number) => { waits.push(ms); } };
    const done = await deps.viaPopover(dil, true);
    expect(done).toBe(false);
    expect(dil.getAttribute('aria-expanded')).toBe('false');
    // Only the search for the box was waited for (1.5 s in 100 ms steps), not a second wait.
    expect(waits.length).toBeLessThanOrEqual(16);
    // A run whose page moved on stops before it clicks.
    const aborted = await deps.viaPopover(dil, true, () => true);
    expect(aborted).toBe(false);
    expect(dil.getAttribute('aria-expanded')).toBe('false');
  });

  it('review T-6: a refused or cancelled router replace is reported, and the chip stops waiting', async () => {
    const chip = document.createElement('button'); chip.className = 'kickflow-lang-chip'; document.body.append(chip);
    history.replaceState(null, '', '/category/valorant');
    (window as Window & { next?: unknown }).next = { router: { replace: vi.fn(async () => false) } };
    stopBridge = installCategoryLanguageBridge();
    const waits: number[] = [];
    const deps = { ...defaultDeps, wait: async (ms: number) => { waits.push(ms); await Promise.resolve(); } };
    expect(await deps.viaRouter(chip, '/category/valorant?languages=tr', true)).toBe(false);
    expect(chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE)).toBe('failed');
    expect(waits.length).toBeLessThan(3);
    (window as Window & { next?: unknown }).next = { router: { replace: vi.fn(() => Promise.reject(new Error('nav'))) } };
    expect(await deps.viaRouter(chip, '/category/valorant?languages=tr', true)).toBe(false);
    expect(chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE)).toBe('failed');
    delete (window as Window & { next?: unknown }).next;
    expect(await deps.viaRouter(chip, '/category/valorant?languages=tr', true)).toBe(false);
    expect(chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE)).toBe('no-router');
  });

  it('review T-7: a hidden leftover Dil button is passed over', async () => {
    storage();
    const stale = document.createElement('div'); stale.hidden = true;
    const old = document.createElement('button'); old.id = 'livestream_filter_by'; stale.append(old);
    document.body.append(stale);
    const { dil } = kickCategoryPage('/category/valorant');
    await initCategoryLanguageChip(lifecycle, { viaRouter: vi.fn(async () => true), viaPopover: vi.fn(async () => false), wait: instantWait });
    expect(old.nextElementSibling).toBeNull();
    expect(dil.nextElementSibling?.classList.contains('kickflow-lang-chip')).toBe(true);
  });

  it('review T-8: the page-wide observer runs only on a category list', async () => {
    storage();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    history.replaceState(null, '', '/xqc');
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter: vi.fn(async () => true), viaPopover: vi.fn(async () => false), wait: instantWait });
    expect(observe).not.toHaveBeenCalled();
    kickCategoryPage('/category/valorant');
    controller.refresh();
    expect(observe).toHaveBeenCalledTimes(1);
    controller.refresh();
    expect(observe).toHaveBeenCalledTimes(1);
    history.replaceState(null, '', '/xqc');
    controller.refresh();
    expect(disconnect).toHaveBeenCalled();
    expect(document.querySelector('.kickflow-lang-chip')).toBeNull();
  });

  it('stays away from pages without Kick’s Dil filter and cleans up on dispose', async () => {
    storage({ [CATEGORY_TURKISH_KEY]: true });
    const { dil } = kickCategoryPage('/category/valorant/clips');
    const viaRouter = vi.fn(async () => true);
    const controller = await initCategoryLanguageChip(lifecycle, { viaRouter, viaPopover: vi.fn(async () => false), wait: instantWait });
    expect(dil.nextElementSibling).toBeNull();
    history.replaceState(null, '', '/category/valorant?languages=tr');
    controller.refresh();
    expect(dil.nextElementSibling?.classList.contains('kickflow-lang-chip')).toBe(true);
    lifecycle.dispose();
    expect(document.querySelector('.kickflow-lang-chip')).toBeNull();
    expect(document.getElementById('kickflow-lang-chip-style')).toBeNull();
  });

  it('the MAIN bridge refuses requests that are not from the chip or not a category path', () => {
    const replace = vi.fn();
    (window as Window & { next?: unknown }).next = { router: { replace } };
    stopBridge = installCategoryLanguageBridge();
    const other = document.createElement('button'); document.body.append(other);
    other.dispatchEvent(new CustomEvent('kickflow:category-languages-v1', { bubbles: true, detail: '/category/x?languages=tr' }));
    const chip = document.createElement('button'); chip.className = 'kickflow-lang-chip'; document.body.append(chip);
    chip.dispatchEvent(new CustomEvent('kickflow:category-languages-v1', { bubbles: true, detail: '/xqc' }));
    expect(replace).not.toHaveBeenCalled();
    expect(chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE)).toBe('invalid');
  });
});
