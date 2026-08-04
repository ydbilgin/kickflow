import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type BootstrapModule = typeof import('../../src/content/bootstrap');

const CSS = '.kickflow-probe { color: rgb(1, 2, 3); }';
let bootstrap: BootstrapModule;

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
