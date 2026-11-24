import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type BootstrapModule = typeof import('../../src/content/bootstrap');

const CSS = '.kickflow-probe { color: rgb(1, 2, 3); }';
let bootstrap: BootstrapModule;
afterAll(() => { bootstrap.initSiteLifecycle().lifecycle.dispose(); });

beforeAll(async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(window, 'setInterval').mockReturnValue(1);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test', onMessage: { addListener: vi.fn() } },
    storage: { local: { get: async () => ({}), set: async () => undefined } },
  });
  bootstrap = await import('../../src/content/bootstrap');
});

describe('installStyleSheet', () => {
  // Importing bootstrap boots it, and that boot already installed the fallback element here.
  beforeEach(() => {
    delete (document as unknown as Record<string, unknown>).adoptedStyleSheets;
    document.getElementById('kickflow-styles')?.remove();
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).adoptedStyleSheets;
    document.getElementById('kickflow-styles')?.remove();
  });

  it('adopts a constructable sheet and puts NO node in the document', () => {
    // jsdom has no adoptedStyleSheets; Chrome does, and that is the path that keeps a <style>
    // element out of the tree React hydrates.
    (document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [];

    const sheet = bootstrap.installStyleSheet(CSS);

    expect(sheet).toBeInstanceOf(CSSStyleSheet);
    expect(document.adoptedStyleSheets).toHaveLength(1);
    expect(document.getElementById('kickflow-styles')).toBeNull();
  });

  it('keeps sheets the page already adopted', () => {
    const existing = new CSSStyleSheet();
    (document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [existing];

    const sheet = bootstrap.installStyleSheet(CSS);

    expect(document.adoptedStyleSheets).toEqual([existing, sheet]);
  });

  it('falls back to one <style> element where constructable sheets are unavailable', () => {
    expect((document as unknown as Record<string, unknown>).adoptedStyleSheets).toBeUndefined();

    expect(bootstrap.installStyleSheet(CSS)).toBeNull();
    expect(bootstrap.installStyleSheet(CSS)).toBeNull();

    const elements = document.querySelectorAll('#kickflow-styles');
    expect(elements).toHaveLength(1);
    expect(elements[0]?.textContent).toBe(CSS);
  });
});

describe('style cost guard (2026-11-09)', () => {
  it('keys the behind-live seek track on an <html> marker, not on a descendant :has()', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/content/bootstrap.ts', 'utf8'); // vitest runs from apps/kickflow
    // Measured on a busy Kick page: this one rule made every style recalculation 40-90x slower.
    expect(source).not.toContain(':has(.kickflow-player-btn--behind)');
    expect(source).toContain('html[data-kickflow-behind] div.z-controls.bottom-0 .kickflow-seek-bar__track');
    expect(source).toContain('html[data-fallback-bar-behind] div.z-controls.bottom-0 .kickflow-seek-bar__track');
  });

  it('never puts a class-substring attribute selector left of a combinator', async () => {
    // [class*="x"] .y makes Chrome restyle every classed descendant on ANY class change in the page.
    const { readFileSync } = await import('node:fs');
    const sources = ['src/content/bootstrap.ts', 'src/content/shared/avatar-preview.ts', 'src/content/player/bar-order.ts']
      .map((rel) => readFileSync(rel, 'utf8'));
    for (const source of sources) {
      expect(source.match(/\[class[*^$|~]?="[^"]*"\]\s*[>+~]?\s*[.#[a-z:]/gi) ?? []).toEqual([]);
    }
  });

  it('keeps the two page-wide :has() restyles out (plate end, bar shelf)', async () => {
    // Each made every DOM insertion on the page restyle the whole document: 66 ms and 54 ms
    // per chat row in own-chat mode on a busy channel, measured 2026-11-09.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/content/bootstrap.ts', 'utf8');
    expect(source).not.toMatch(/:has\(\s*[+~]/);
    expect(source).not.toContain('div:has(> div.z-controls');
    // body:has(> x) <descendant> made every inserted chat row restyle the whole page: ~150 ms per
    // row with own chat on a busy channel, 3-8 ms without it (fresh-page A/B, 2026-11-09).
    expect(source).not.toMatch(/\b(?:html|body):has\(/);
    expect(source).toContain('.kickflow-player-group--plate-end::before');
    expect(source).toContain('[data-kickflow-controls] [data-kickflow-bar-shelf] { overflow: visible !important; }');
  });
});
