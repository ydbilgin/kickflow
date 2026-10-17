import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';

let lifecycle: Lifecycle;
let anchor: HTMLElement;
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
function row(mount: ChatOverlayMount, id: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'kickflow-message';
  item.textContent = id;
  mount.ownList.append(item);
  mount.noteContentAppended([item]);
  return item;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('MutationObserver', NoopObserver);
  anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 480,
    width: 320, height: 480, toJSON: () => ({}),
  });
  document.body.append(anchor);
  lifecycle = new Lifecycle();
});
afterEach(() => {
  lifecycle.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement.classList.remove('kickflow-chat-active');
});

describe('terminal source failure is not a layout gap', () => {
  it('does not reactivate old rows on watchdog ticks or a late history append', () => {
    const mount = new ChatOverlayMount(lifecycle);
    row(mount, 'existing');
    expect(mount.state).toBe('active');
    mount.setReconnecting();
    mount.setPrimaryUnavailable('primary-reconnect-grace-expired');
    vi.advanceTimersByTime(2000);
    row(mount, 'late-history');
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
  });

  it('still recovers a transient anchor gap without new transport proof', () => {
    const mount = new ChatOverlayMount(lifecycle);
    row(mount, 'existing');
    anchor.remove();
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    document.body.append(anchor);
    mount.syncNow();
    expect(mount.state).toBe('active');
  });

  it('accepts explicit replay readiness after an unavailable source', () => {
    const mount = new ChatOverlayMount(lifecycle);
    mount.setPrimaryUnavailable('unavailable');
    mount.setReplayReady();
    expect(mount.state).toBe('active');
  });
});
