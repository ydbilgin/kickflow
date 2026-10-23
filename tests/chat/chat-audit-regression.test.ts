import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { RenderQueue } from '../../src/content/chat/render-queue';
import { ChatDomRegistry, type ChatMessage } from '../../src/content/chat/message-store';
import { PusherClient } from '../../src/content/chat/pusher-client';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { NATIVE_CHAT_EVENT } from '../../src/shared/native-chat';
import { setLang } from '../../src/content/shared/i18n';

let lifecycle: Lifecycle;
let mount: ChatOverlayMount;
class Observer { observe(): void {} unobserve(): void {} disconnect(): void {} }
const message = (id: string, second: number): ChatMessage => ({
  id, chatroomId: 1, content: id, type: 'message',
  createdAt: new Date(Date.UTC(2026, 9, 23, 0, 0, second)).toISOString(),
  sender: { id: 7, username: 'fixture', slug: 'fixture', identity: { color: '', badges: [], badgesV2: [] } },
  preserved: false,
});
beforeEach(() => {
  setLang('tr');
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 480, width: 320, height: 480, toJSON: () => ({}),
  });
  document.body.innerHTML = '<div id="channel-content" style="position:relative;z-index:300"><div id="chatroom-messages"></div></div>';
  lifecycle = new Lifecycle();
  mount = new ChatOverlayMount(lifecycle);
});
afterEach(() => {
  lifecycle.dispose(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('audit steps 1–3 and 5', () => {
  it('step 6: one visible failure offers a single retry while native chat remains available', () => {
    const retry = vi.fn(); mount.setRetryHandler(retry);
    mount.showFailure(); mount.showFailure();
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.root.querySelectorAll('[data-kickflow-chat-status="failed"]')).toHaveLength(1);
    const button = mount.root.querySelector('button')!;
    expect(button.textContent).toBe('Tekrar dene'); button.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('step 7: connection status is docked after the list rather than inside its scroll area', () => {
    mount.setPrimaryReady(); mount.setReconnecting();
    expect(mount.ownList.querySelector('[data-kickflow-chat-status]')).toBeNull();
    expect(mount.root.lastElementChild?.getAttribute('data-kickflow-chat-status')).toBe('reconnecting');
  });

  it.each(['menu', 'dialog', 'emote-picker'])('step 1: yields to an overlapping native %s', (kind) => {
    mount.setPrimaryReady(); expect(mount.state).toBe('active');
    const surface = document.createElement('div');
    if (kind === 'emote-picker') surface.dataset.testid = kind;
    else surface.setAttribute('role', kind);
    document.body.append(surface); mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    surface.remove(); mount.syncNow(); expect(mount.state).toBe('active');
  });
  it('step 1: lives in Kick stacking context and falls back when another surface wins the paint check', () => {
    expect(mount.root.parentElement?.id).toBe('channel-content');
    const hit = vi.fn(() => mount.ownList);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    hit.mockReturnValue(document.getElementById('chatroom-messages')!);
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
  });

  it('step 2: default native source opens no legacy socket and only reports a disconnect on native loss', () => {
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', class extends EventTarget {
      constructor() { super(); socket(); }
      readyState = 1;
      send(): void {}
      close(): void {}
    });
    const onDisconnected = vi.fn(); const onUnavailable = vi.fn();
    const client = new PusherClient(1, 2, { onMessage: vi.fn(), onUserBanned: vi.fn(),
      onDisconnected, onPrimarySubscriptionUnavailable: onUnavailable });
    lifecycle.add(() => client.dispose()); client.connect();
    expect(socket).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: { kind: 'publication', socketId: 1,
      publication: { channel: 'chatrooms.1.v2', event: 'App\\Events\\ChatMessageEvent',
        data: { id: 'live', chatroom_id: 1, content: 'hello', sender: { id: 7, username: 'fixture' } } } } }));
    window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: { kind: 'unavailable', socketId: 1 } }));
    vi.advanceTimersByTime(3000);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  it('step 3: non-empty history renders and activates before any live frame', () => {
    const queue = new RenderQueue({ getContainer: () => mount.getRenderContainer(), registry: new ChatDomRegistry(),
      onFlush: (rows) => mount.noteContentAppended(rows) });
    lifecycle.add(() => queue.dispose()); mount.setProbing();
    queue.enqueue(message('history', 1));
    vi.advanceTimersByTime(500);
    expect(mount.ownList.querySelector('[data-message-id="history"]')).not.toBeNull();
    expect(mount.state).toBe('active');
  });

  it('step 5: late backfill inserts between existing rows by createdAt', () => {
    mount.setPrimaryReady();
    const queue = new RenderQueue({ getContainer: () => mount.getRenderContainer(), registry: new ChatDomRegistry(),
      onFlush: (rows) => mount.noteContentAppended(rows) });
    lifecycle.add(() => queue.dispose());
    queue.enqueue(message('one', 1)); queue.enqueue(message('three', 3));
    vi.advanceTimersByTime(500);
    queue.enqueue(message('two', 2)); vi.advanceTimersByTime(500);
    expect([...mount.ownList.querySelectorAll<HTMLElement>('[data-message-id]')].map((e) => e.dataset.messageId))
      .toEqual(['one', 'two', 'three']);
  });
});
