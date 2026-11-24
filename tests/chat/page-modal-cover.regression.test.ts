// Reported 2026-11-19: opening drops or other screens turned the chat back into native chat.
// Measured on kick.com/euryel (0.3.28): Kick's "Ödüllerini talep et" dialog does not overlap the chat
// column, but its Radix backdrop (fixed inset-0, z-dialog) is the top element over the list, and Radix
// sets pointer-events:none on body, so the hit test there is [backdrop, html]. The paint-on-top check
// failed, own chat failed open and Kick's native chat showed until the dialog closed. An extension
// panel opened with showModal() in a shadow host did the same: the hit test there is [host, html].
// These tests keep own chat under a page-level modal and still give chat back for every other blocker.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

let lifecycle: Lifecycle;
let stack: () => Element[];
const ACTIVE = 'kickflow-chat-active';
const active = (): boolean => document.documentElement.classList.contains(ACTIVE);

function liveMount(): { mount: ChatOverlayMount; row: HTMLElement } {
  const mount = new ChatOverlayMount(lifecycle);
  const row = document.createElement('div');
  row.className = 'kickflow-message';
  row.textContent = 'merhaba';
  mount.ownList.append(row);
  stack = () => [row, mount.ownList, mount.root, document.body, document.documentElement];
  mount.noteContentAppended([row]);
  return { mount, row };
}

/** Kick's drops/rewards dialog as measured: a fixed full-viewport backdrop and a centred role=dialog,
 * both portalled straight under body, the dialog left of the chat column. */
function kickRewardsDialog(dialogBox = box(400, 100, 300, 500)): { backdrop: HTMLElement; dialog: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-dialog bg-black/75';
  backdrop.dataset.state = 'open';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.style.position = 'fixed';
  vi.spyOn(backdrop, 'getBoundingClientRect').mockReturnValue(box(0, 0, window.innerWidth, window.innerHeight));
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.dataset.state = 'open';
  dialog.style.position = 'fixed';
  dialog.innerHTML = '<h2>Ödüllerini talep et</h2><button>Görüntüle</button><button>Paylaş</button><button aria-label="Kapat">x</button>';
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(dialogBox);
  document.body.append(backdrop, dialog);
  return { backdrop, dialog };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('MutationObserver', NoopObserver);
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(box(700, 60, 320, 600));
  document.body.append(anchor);
  stack = () => [document.documentElement];
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => stack() });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => stack()[0] ?? null });
  lifecycle = new Lifecycle();
});

afterEach(() => {
  lifecycle.dispose();
  delete (document as Partial<Document>).elementsFromPoint;
  delete (document as Partial<Document>).elementFromPoint;
  document.getElementById('extension-panel-host')?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement.classList.remove(ACTIVE);
});

describe('own chat stays the chat under a page-level modal (2026-11-19)', () => {
  it('S1/S14: Kick drops/rewards dialog with its backdrop keeps own chat, no fall and no flip storm', () => {
    const { mount, row } = liveMount();
    expect(mount.state).toBe('active');
    const failOpen = vi.spyOn(mount, 'failOpen');
    const { backdrop, dialog } = kickRewardsDialog();
    // Radix sets pointer-events:none on body: only the backdrop and html are hit-testable.
    stack = () => [backdrop, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(active()).toBe(true);
    expect(mount.assertActiveInvariant()).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(failOpen).not.toHaveBeenCalled();
    expect(active()).toBe(true);
    expect(mount.root.style.display).toBe('');
    // Closing: the same rows are on screen at once.
    backdrop.remove(); dialog.remove();
    stack = () => [row, mount.ownList, mount.root, document.body, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(row.isConnected).toBe(true);
  });

  it('a backdrop and dialog still fading in (opacity 0) already count as the modal layer', () => {
    // Live 0.3.29 first build, 2026-11-19: the fade-in left the dialog at opacity 0 for ~0.3-0.7 s,
    // and own chat fell back for ~1.5 s at every opening.
    const { mount } = liveMount();
    const failOpen = vi.spyOn(mount, 'failOpen');
    const { backdrop, dialog } = kickRewardsDialog();
    backdrop.style.opacity = '0';
    dialog.style.opacity = '0';
    stack = () => [backdrop, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    expect(failOpen).not.toHaveBeenCalled();
  });

  it('recovers to own chat while the dialog is still open when it had already fallen back', () => {
    const { mount } = liveMount();
    mount.failOpen('test-earlier-fall');
    expect(active()).toBe(false);
    const { backdrop } = kickRewardsDialog();
    stack = () => [backdrop, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(active()).toBe(true);
  });

  it('a modal dialog that itself covers the list (narrow window) keeps own chat too', () => {
    const { mount } = liveMount();
    const { dialog } = kickRewardsDialog(box(650, 80, 420, 560));
    stack = () => [dialog.querySelector('h2')!, dialog, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
  });

  it('S6/S11: an open top-layer panel in a shadow host keeps own chat', () => {
    const { mount, row } = liveMount();
    const host = document.createElement('div');
    host.id = 'extension-panel-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    // jsdom has no showModal()/top layer; Chrome answers :modal for a showModal() dialog.
    const matches = Element.prototype.matches;
    vi.spyOn(dialog, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':modal' ? true : matches.call(this, selector);
    });
    shadow.append(dialog);
    document.documentElement.append(host);
    stack = () => [host, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    host.remove();
    stack = () => [row, mount.ownList, mount.root, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
  });

  it('a non-modal open dialog (show(), not showModal()) in a shadow host does not count', () => {
    const { mount } = liveMount();
    const host = document.createElement('div');
    host.id = 'extension-panel-host';
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    host.attachShadow({ mode: 'open' }).append(dialog);
    document.documentElement.append(host);
    stack = () => [host, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('fallback');
  });

  it('a shadow host whose dialog is closed is an unknown blocker: chat goes back to Kick', () => {
    const { mount } = liveMount();
    const host = document.createElement('div');
    host.id = 'extension-panel-host';
    host.attachShadow({ mode: 'open' }).append(document.createElement('dialog'));
    document.documentElement.append(host);
    stack = () => [host, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(active()).toBe(false);
  });

  it('a full-viewport fixed layer with no dialog is not a modal: chat goes back to Kick', () => {
    const { mount } = liveMount();
    const layer = document.createElement('div');
    layer.style.position = 'fixed';
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(box(0, 0, window.innerWidth, window.innerHeight));
    document.body.append(layer);
    stack = () => [layer, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('fallback');
  });

  it('a non-modal native dialog over the list (no backdrop, no aria-modal) still gives chat back', () => {
    const { mount } = liveMount();
    const menu = document.createElement('section');
    menu.setAttribute('role', 'dialog');
    menu.innerHTML = '<button>Sohbet ayarı</button>';
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(box(700, 400, 320, 200));
    document.body.append(menu);
    stack = () => [menu.firstElementChild!, menu, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('fallback');
  });

  it('a modal under our list (our list hit first) with an overlapping dialog still gives chat back', () => {
    const { mount, row } = liveMount();
    const { backdrop } = kickRewardsDialog(box(650, 80, 420, 560));
    stack = () => [row, mount.ownList, mount.root, backdrop, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('fallback');
  });

  it('transport loss under a modal still fails open', () => {
    const { mount } = liveMount();
    const { backdrop } = kickRewardsDialog();
    stack = () => [backdrop, document.documentElement];
    mount.syncNow();
    expect(mount.state).toBe('active');
    mount.setPrimaryUnavailable('socket-lost-under-modal');
    expect(mount.state).toBe('fallback');
    mount.syncNow();
    expect(mount.state).toBe('fallback');
  });
});
