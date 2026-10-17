import { afterEach, describe, expect, it, vi } from 'vitest';
import { PusherClient } from '../../src/content/chat/pusher-client';
import { installNativeChatBridge } from '../../src/mainworld/native-chat-bridge';
import { NATIVE_CHAT_EVENT, type NativeChatSignal } from '../../src/shared/native-chat';

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  constructor(readonly url: string) { super(); FakeSocket.instances.push(this); }
  send(): void { /* Passive fixture. */ }
  close(): void { this.dispatchEvent(new Event('close')); }
}
const clients: PusherClient[] = [];
let unhook: (() => void) | undefined;
afterEach(() => {
  for (const client of clients) client.dispose();
  clients.length = 0; unhook?.(); unhook = undefined;
  FakeSocket.instances = []; vi.useRealTimers(); vi.unstubAllGlobals();
});
const message = (id = 'native', room = 1) => ({
  id, chatroom_id: room, content: 'Public fixture', sender: { id: 7, username: 'fixture' },
});
function publish(data = message(), channel = 'chatrooms.1.v2', socketId = 1, event = 'App\\Events\\ChatMessageEvent'): void {
  window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, {
    detail: { kind: 'publication', socketId, publication: { channel, event, data } },
  }));
}
function signal(detail: NativeChatSignal): void { window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail })); }
function setup(room = 1, channel = 2) {
  vi.stubGlobal('WebSocket', FakeSocket);
  const callbacks = {
    onMessage: vi.fn(), onUserBanned: vi.fn(), onSubscription: vi.fn(), onConnected: vi.fn(),
    onPrimarySubscriptionReady: vi.fn(), onPrimarySubscriptionUnavailable: vi.fn(), onDisconnected: vi.fn(),
  };
  const client = new PusherClient(room, channel, callbacks);
  clients.push(client); client.connect();
  return { client, callbacks, fallback: FakeSocket.instances.at(-1)! };
}
function legacy(socket: FakeSocket, event: string, data: unknown, channel = 'chatrooms.1.v2'): void {
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event, channel, data: JSON.stringify(data) }) }));
}

describe('native and legacy live chat aggregation', () => {
  it('pauses legacy reconnects after native proof and resumes when native is lost', () => {
    vi.useFakeTimers();
    const { callbacks, fallback } = setup();
    publish();
    fallback.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(callbacks.onDisconnected).not.toHaveBeenCalled();
    signal({ kind: 'unavailable', socketId: 1 });
    expect(callbacks.onDisconnected).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('cancels a pending legacy retry when native is proven and keeps it paused until the last exact-room socket is lost', () => {
    vi.useFakeTimers();
    const { fallback } = setup();
    fallback.close();
    publish();
    publish(message('two'), 'chatrooms.1.v2', 2);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    signal({ kind: 'unavailable', socketId: 1 });
    signal({ kind: 'unavailable', socketId: 2, channel: 'chatrooms.11.v2' });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    signal({ kind: 'unavailable', socketId: 2 });
    vi.advanceTimersByTime(15_000);
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it('delivers the real native envelope through hook, boundary, client and normalizer', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    unhook = installNativeChatBridge();
    const native = new WebSocket('wss://realtime.us-east-1.platform.kick.com/connection/websocket');
    const { callbacks } = setup();
    native.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ push: { channel: 'chatrooms.1.v2', pub: {
      data: { event: 'App\\Events\\ChatMessageEvent', data: JSON.stringify(message()) }, tags: { event: 'App\\Events\\ChatMessageEvent' },
    } } }) }));
    expect(callbacks.onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'native', chatroomId: 1 }));
    expect(callbacks.onPrimarySubscriptionReady).toHaveBeenCalledOnce();
  });

  it('requires a validated exact-room live message and rejects nearby or mismatched rooms', () => {
    const { callbacks, fallback } = setup();
    legacy(fallback, 'pusher:connection_established', {});
    publish(message(), 'chatrooms.11.v2');
    publish(message('mismatch', 3));
    publish({ ...message(), sender: null } as unknown as ReturnType<typeof message>);
    publish(message(), 'channel.2');
    publish({ chatroom_id: 1, username: 'fixture', months: 2 } as unknown as ReturnType<typeof message>, 'chatrooms.1.v2', 1, 'App\\Events\\SubscriptionEvent');
    expect(callbacks.onPrimarySubscriptionReady).not.toHaveBeenCalled();
    expect(callbacks.onMessage).not.toHaveBeenCalled();
    publish();
    expect(callbacks.onPrimarySubscriptionReady).toHaveBeenCalledOnce();
  });

  it('does not let failed or reconnecting legacy Pusher override proven native delivery', () => {
    vi.useFakeTimers();
    const { callbacks, fallback } = setup();
    publish();
    legacy(fallback, 'pusher:error', { code: 4201 });
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    expect(callbacks.onDisconnected).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    legacy(FakeSocket.instances.at(-1)!, 'pusher:connection_established', {});
    expect(callbacks.onConnected).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    publish(message('second'));
    expect(callbacks.onMessage).toHaveBeenCalledTimes(2);
    signal({ kind: 'unavailable', socketId: 1 });
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    expect(callbacks.onDisconnected).toHaveBeenCalledOnce();
  });

  it('deduplicates native and legacy messages and system publications with one readiness transition', () => {
    const { callbacks, fallback } = setup();
    publish();
    legacy(fallback, 'App\\Events\\ChatMessageEvent', message());
    legacy(fallback, 'pusher_internal:subscription_succeeded', {});
    const sub = { chatroom_id: 1, username: 'fixture', months: 2 };
    publish(sub as unknown as ReturnType<typeof message>, 'chatrooms.1.v2', 1, 'App\\Events\\SubscriptionEvent');
    publish(sub as unknown as ReturnType<typeof message>, 'chatrooms.1.v2', 2, 'App\\Events\\SubscriptionEvent');
    legacy(fallback, 'App\\Events\\SubscriptionEvent', sub);
    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    expect(callbacks.onSubscription).toHaveBeenCalledOnce();
    expect(callbacks.onPrimarySubscriptionReady).toHaveBeenCalledOnce();
  });

  it('keeps delivery ready while another proven socket or legacy subscription still delivers', () => {
    const { callbacks, fallback } = setup();
    publish(); publish(message('two'), 'chatrooms.1.v2', 2);
    signal({ kind: 'unavailable', socketId: 1 });
    signal({ kind: 'unavailable', socketId: 2, channel: 'chatrooms.11.v2' });
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    legacy(fallback, 'pusher_internal:subscription_succeeded', {});
    signal({ kind: 'unavailable', socketId: 2 });
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    fallback.close();
    expect(callbacks.onDisconnected).toHaveBeenCalledOnce();
  });

  it('detaches disposed sessions and rejects stale SPA channel publications', () => {
    const old = setup(); publish(); old.client.dispose();
    const replacement = setup(3, 4);
    publish(message('stale'));
    signal({ kind: 'unavailable', socketId: 1 });
    expect(replacement.callbacks.onMessage).not.toHaveBeenCalled();
    expect(replacement.callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    publish(message('current', 3), 'chatrooms.3.v2', 2);
    expect(old.callbacks.onMessage).toHaveBeenCalledOnce();
    expect(replacement.callbacks.onMessage).toHaveBeenCalledOnce();
  });

  it('recovers native readiness after loss and does not claim readiness from an empty handshake', () => {
    const { callbacks } = setup();
    signal({ kind: 'unavailable', socketId: 99 });
    expect(callbacks.onPrimarySubscriptionReady).not.toHaveBeenCalled();
    publish();
    signal({ kind: 'unavailable', socketId: 1, channel: 'chatrooms.1.v2' });
    expect(callbacks.onPrimarySubscriptionUnavailable).not.toHaveBeenCalled();
    expect(callbacks.onDisconnected).toHaveBeenCalledOnce();
    publish(message('recovered'), 'chatrooms.1.v2', 2);
    expect(callbacks.onPrimarySubscriptionReady).toHaveBeenCalledTimes(2);
  });

  it('preserves the measured native message shape including badges and reply fields', () => {
    // Safe synthetic values; structure/channel/event were measured on Kick on 2026-10-13.
    const { callbacks } = setup(25594923, 25883235);
    publish({
      ...message('captured-shape', 25594923), type: 'reply', created_at: '2026-10-13T10:23:41Z',
      thread_parent_id: 'thread-fixture',
      sender: { id: 7, username: 'fixture', slug: 'fixture', identity: {
        color: '#123456', badges: [{ type: 'subscriber', text: 'Subscriber', count: 2, sort_order: 1 }],
        badges_v2: [{ name: 'level', image_url: 'https://example.invalid/badge.png', selected: true, metadata: { level: 3 } }],
      } },
      metadata: { message_ref: 'reference-fixture', original_sender: { id: 8, username: 'reply-fixture' }, original_message: { id: 'original-fixture', content: 'Original fixture' } },
    } as unknown as ReturnType<typeof message>, 'chatrooms.25594923.v2');
    expect(callbacks.onMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatroomId: 25594923, type: 'reply',
      sender: expect.objectContaining({ identity: expect.objectContaining({
        badges: [expect.objectContaining({ type: 'subscriber', count: 2 })],
        badgesV2: [expect.objectContaining({ name: 'level', level: 3, selected: true })],
      }) }),
      replyContext: expect.objectContaining({ replyToUser: 'reply-fixture', replyToText: 'Original fixture', threadParentId: 'thread-fixture' }),
    }));
  });
});
