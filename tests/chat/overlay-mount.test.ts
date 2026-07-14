import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function rect(width = 320, height = 480, left = 10, top = 20): DOMRect {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function addAnchor(width = 320, height = 480): HTMLElement {
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(width, height));
  document.body.append(anchor);
  return anchor;
}

function addOwnRow(mount: ChatOverlayMount, id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kickflow-message';
  row.dataset.messageId = id;
  row.textContent = id;
  mount.ownList.append(row);
  return row;
}

describe('ChatOverlayMount takeover readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    document.documentElement.classList.remove('kickflow-chat-active');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.classList.remove('kickflow-chat-active');
    document.documentElement.classList.remove('kickflow-pin-surface-active');
  });

  it('shows a mirrored pin while probing without hiding native messages', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.pinnedMessageHost.append(document.createElement('div'));
    mount.pinVisibilityChanged();

    expect(mount.state).toBe('probing');
    expect(mount.root.style.display).not.toBe('none');
    expect(mount.ownList.style.display).toBe('none');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(document.documentElement.classList.contains('kickflow-pin-surface-active')).toBe(true);
    lifecycle.dispose();
  });

  it('retains native visibility after a pin is dismissed with zero own rows', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.pinnedMessageHost.append(document.createElement('div'));
    mount.pinVisibilityChanged();
    mount.pinnedMessageHost.replaceChildren();
    mount.pinVisibilityChanged();

    expect(mount.root.style.display).toBe('none');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(document.documentElement.classList.contains('kickflow-pin-surface-active')).toBe(false);
    lifecycle.dispose();
  });

  it('does not activate from a row appended to an off-document root', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.root.remove();
    const row = addOwnRow(mount, 'off-document');
    mount.noteContentAppended([row]);

    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.state).not.toBe('active');
    lifecycle.dispose();
  });

  it('repairs a removed own list without leaving a broken active class', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'ready');
    mount.noteContentAppended([row]);
    expect(mount.state).toBe('active');

    mount.ownList.remove();
    mount.syncNow();

    expect(mount.ownList.parentElement).toBe(mount.root);
    expect(mount.ownList.isConnected).toBe(true);
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('selects the visible duplicate anchor instead of the first zero-sized match', () => {
    addAnchor(0, 0);
    const visible = addAnchor(360, 500);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'visible-anchor');
    mount.noteContentAppended([row]);

    expect(mount.selectedAnchor).toBe(visible);
    expect(mount.state).toBe('active');
    expect(mount.root.style.width).toBe('360px');
    lifecycle.dispose();
  });

  it('fails open across an anchor gap and reactivates only when readiness can be re-proven', () => {
    const anchor = addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'survives-gap');
    mount.noteContentAppended([row]);
    expect(mount.state).toBe('active');

    anchor.remove();
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    const replacement = addAnchor(400, 520);
    mount.syncNow();
    expect(mount.selectedAnchor).toBe(replacement);
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('activates a legitimate empty chat only with primary readiness and a visible status row', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();

    expect(mount.state).toBe('active');
    expect(mount.ownList.querySelector('[data-kickflow-chat-status]')?.textContent).toContain('Bağlandı');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('fails open at the initial no-content deadline and can recover on later primary readiness', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.initialNoContentDeadline();

    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('keeps rows plus a reconnecting status during grace, then fails open and recovers', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'existing-row');
    mount.noteContentAppended([row]);
    mount.setReconnecting();

    expect(mount.state).toBe('active');
    expect(mount.ownList.querySelector('[data-kickflow-chat-status]')?.textContent).toContain('Yeniden');
    mount.setPrimaryUnavailable('grace-expired');
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('does not reuse stale row readiness after the final visible row is removed', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'last-row');
    mount.noteContentAppended([row]);
    row.remove();
    mount.syncNow();

    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    lifecycle.dispose();
  });

  it('enforces the direct active-class invariant and fails open when content is absent', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    document.documentElement.classList.add('kickflow-chat-active');
    mount.root.style.display = '';
    mount.ownList.style.display = '';

    expect(mount.assertActiveInvariant()).toBe(false);
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.state).toBe('fallback');
    lifecycle.dispose();
  });

  it('leaves one invariant-safe overlay after rapid own/native/own plus channel replacement', () => {
    addAnchor();
    const firstLifecycle = new Lifecycle();
    const first = new ChatOverlayMount(firstLifecycle);
    first.setProbing();
    const firstRow = addOwnRow(first, 'first-channel');
    first.noteContentAppended([firstRow]);

    firstLifecycle.dispose();
    const nativeLifecycle = new Lifecycle();
    nativeLifecycle.dispose();
    const secondLifecycle = new Lifecycle();
    const second = new ChatOverlayMount(secondLifecycle);
    second.setProbing();
    second.setPrimaryReady();

    expect(document.querySelectorAll('[id="kickflow-chat-overlay"]')).toHaveLength(1);
    expect(second.assertActiveInvariant()).toBe(true);
    secondLifecycle.dispose();
  });
});
