import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';

// Per-flush callers (getRenderContainer, noteContentAppended) must not re-measure the page for every
// batch of chat rows while own chat is active and was verified moments ago. 2026-11-08.

const resizeCallbacks: ResizeObserverCallback[] = [];
const mutationCallbacks: MutationCallback[] = [];
class StubResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class StubMutationObserver {
  constructor(callback: MutationCallback) { mutationCallbacks.push(callback); }
  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] { return []; }
}

function rect(width = 320, height = 480, left = 10, top = 20): DOMRect {
  return { width, height, left, top, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function setup(): { mount: ChatOverlayMount; lifecycle: Lifecycle; anchor: HTMLElement; measure: ReturnType<typeof vi.fn> } {
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  const measure = vi.fn(() => rect());
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(measure);
  document.body.append(anchor);
  const lifecycle = new Lifecycle();
  const mount = new ChatOverlayMount(lifecycle);
  mount.setPrimaryReady();
  expect(mount.state).toBe('active');
  return { mount, lifecycle, anchor, measure };
}

function appendRow(mount: ChatOverlayMount, id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kickflow-message';
  row.textContent = id;
  mount.ownList.append(row);
  return row;
}

describe('ChatOverlayMount hot path', () => {
  beforeEach(() => {
    setLang('tr');
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.stubGlobal('MutationObserver', StubMutationObserver);
    document.documentElement.classList.remove('kickflow-chat-active');
    resizeCallbacks.length = 0;
    mutationCallbacks.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.classList.remove('kickflow-chat-active');
  });

  it('measures the page once for a burst of flushes, then again after the freshness window', () => {
    const { mount, lifecycle, measure } = setup();
    mount.noteContentAppended([appendRow(mount, 'first')]);
    measure.mockClear();
    for (let i = 0; i < 60; i++) {
      const row = appendRow(mount, `row-${i}`);
      expect(mount.getRenderContainer()).toBe(mount.ownList);
      mount.noteContentAppended([row]);
    }
    expect(measure.mock.calls.length).toBeLessThanOrEqual(1);
    expect(mount.state).toBe('active');

    vi.advanceTimersByTime(400);
    measure.mockClear();
    mount.getRenderContainer();
    expect(measure.mock.calls.length).toBeGreaterThan(0);
    lifecycle.dispose();
  });

  it('a resize signal inside the freshness window forces a full check on the next flush', () => {
    const { mount, lifecycle, measure } = setup();
    mount.noteContentAppended([appendRow(mount, 'first')]);
    mount.getRenderContainer();
    measure.mockClear();
    mount.getRenderContainer();
    expect(measure).not.toHaveBeenCalled();

    measure.mockClear();
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    // The resize signal itself verifies from scratch, ignoring the freshness window.
    expect(measure.mock.calls.length).toBeGreaterThan(0);
    lifecycle.dispose();
  });

  it('losing the anchor inside the freshness window still falls back to native chat at once', () => {
    const { mount, lifecycle, anchor } = setup();
    mount.noteContentAppended([appendRow(mount, 'first')]);
    mount.getRenderContainer();
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(true);

    anchor.remove();
    const record = { type: 'childList', target: document.body, addedNodes: [], removedNodes: [anchor] } as unknown as MutationRecord;
    for (const callback of mutationCallbacks) callback([record], {} as MutationObserver);
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.getRenderContainer()).toBeNull();
    lifecycle.dispose();
  });

  it('does not take the shortcut after a fallback', () => {
    const { mount, lifecycle, measure } = setup();
    mount.failOpen('test');
    measure.mockClear();
    mount.getRenderContainer();
    expect(measure.mock.calls.length).toBeGreaterThan(0);
    lifecycle.dispose();
  });

  it('a blocked page does not flip the page-wide active class on every retry', () => {
    const { mount, lifecycle } = setup();
    mount.noteContentAppended([appendRow(mount, 'first')]);
    const blocker = document.createElement('section');
    blocker.setAttribute('role', 'dialog');
    blocker.innerHTML = '<button>Unrelated confirmation</button>';
    vi.spyOn(blocker, 'getBoundingClientRect').mockReturnValue(rect());
    document.body.append(blocker);
    mount.syncNow();
    expect(mount.state).toBe('fallback');

    const add = vi.spyOn(document.documentElement.classList, 'add');
    for (let i = 0; i < 20; i++) {
      mount.noteContentAppended([appendRow(mount, `blocked-${i}`)]);
      mount.getRenderContainer();
      mount.syncNow();
    }
    expect(add).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.state).toBe('fallback');

    blocker.remove();
    mount.syncNow();
    expect(mount.state).toBe('active');
    lifecycle.dispose();
  });
});
