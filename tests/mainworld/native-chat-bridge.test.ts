import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeChatBridge, isKickRealtimeUrl } from '../../src/mainworld/native-chat-bridge';
import { NATIVE_CHAT_EVENT, parseNativePublication, type NativeChatSignal } from '../../src/shared/native-chat';

class NativeSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly url: string;
  readonly readyState = 1;
  constructor(url: string) { super(); this.url = url; }
  send(): void { /* No network in this fixture. */ }
  close(): void { this.dispatchEvent(new Event('close')); }
}
const url = 'wss://realtime.us-east-1.platform.kick.com/connection/websocket';
const rawMessage = {
  id: 'public-message', content: 'A public fixture', chatroom_id: 1,
  sender: { id: 2, username: 'fixture', slug: 'fixture' },
};
function frame(data: unknown = rawMessage, channel = 'chatrooms.1.v2', event = 'App\\Events\\ChatMessageEvent'): string {
  return JSON.stringify({ push: { channel, pub: {
    data: { event, data: JSON.stringify(data), token: 'discarded-field' },
    tags: { event },
  } } });
}
let uninstall: (() => void) | undefined;
afterEach(() => { uninstall?.(); uninstall = undefined; vi.unstubAllGlobals(); });

describe('public native socket boundary', () => {
  it('parses the observed push/pub/data envelope and preserves supported message context', () => {
    const publication = parseNativePublication(frame({
      ...rawMessage,
      metadata: JSON.stringify({ original_sender: { id: 3, username: 'reply' }, original_message: { id: 'reply-id', content: 'Original' } }),
      sender: { ...rawMessage.sender, identity: { color: '#123456', badges: [{ type: 'moderator', token: 'discarded-field' }] } },
    }));
    expect(publication).toMatchObject({ channel: 'chatrooms.1.v2', event: 'App\\Events\\ChatMessageEvent', data: {
      metadata: { original_sender: { id: 3, username: 'reply' } }, sender: { identity: { badges: [{ type: 'moderator' }] } },
    } });
    expect(JSON.stringify(publication)).not.toContain('discarded-field');
  });

  it.each([
    '{"id":1,"connect":{"token":"discarded-field"}}',
    '{"push":{"channel":"private-user.1","pub":{"data":{"event":"App\\\\Events\\\\ChatMessageEvent","data":"{}"}}}}',
    frame(rawMessage, 'chatrooms.1.v2', 'SomeUnknownEvent'),
    frame(rawMessage, 'chatrooms.1.v2.extra'),
    frame(rawMessage, 'chatrooms.0.v2'),
    'not JSON',
    'null',
  ])('does not publish control, private or malformed traffic: %s', (raw) => {
    expect(parseNativePublication(raw)).toBeNull();
  });

  it('projects supported fields and drops session/token fields at every nested boundary', () => {
    const clean = parseNativePublication(frame({
      ...rawMessage, token: 'discarded-field', auth: { key: 'discarded-field' },
      sender: { ...rawMessage.sender, session: 'discarded-field', identity: { token: 'discarded-field', badges_v2: [{ name: 'level', metadata: { level: 3, token: 'discarded-field' } }] } },
      metadata: { token: 'discarded-field', original_sender: { id: 4, username: 'reply', session: 'discarded-field' } },
    }));
    expect(clean).not.toBeNull();
    expect(JSON.stringify(clean)).not.toContain('discarded-field');
    expect(clean!.data.content).toBe(rawMessage.content);
  });

  it('observes only the actual realtime endpoint and does not change socket identity or send', () => {
    vi.stubGlobal('WebSocket', NativeSocket);
    const received: NativeChatSignal[] = [];
    const receive = (e: Event): void => { received.push((e as CustomEvent<NativeChatSignal>).detail); };
    window.addEventListener(NATIVE_CHAT_EVENT, receive);
    uninstall = installNativeChatBridge();
    const socket = new WebSocket(url);
    expect(socket).toBeInstanceOf(NativeSocket);
    expect(socket).toBeInstanceOf(WebSocket);
    expect(WebSocket.OPEN).toBe(1);
    expect(socket.send).toBe(NativeSocket.prototype.send);
    const other = new WebSocket('wss://websockets.kick.com/viewer/v1/connect');
    other.dispatchEvent(new MessageEvent('message', { data: frame() }));
    socket.dispatchEvent(new MessageEvent('message', { data: '{"id":1,"connect":{"token":"discarded-field"}}\n' + frame() }));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'publication', socketId: 1 });
    socket.close();
    expect(received[1]).toEqual({ kind: 'unavailable', socketId: 1 });
    uninstall(); uninstall = undefined;
    socket.dispatchEvent(new MessageEvent('message', { data: frame() }));
    expect(received).toHaveLength(2);
    expect(window.WebSocket).toBe(NativeSocket);
    window.removeEventListener(NATIVE_CHAT_EVENT, receive);
  });

  it('matches the endpoint exactly without keeping its query parameters', () => {
    expect(isKickRealtimeUrl(url + '?ignored=value')).toBe(true);
    expect(isKickRealtimeUrl(url.replace('us-east-1', 'us-west-2'))).toBe(true);
    expect(isKickRealtimeUrl(url.replace('us-east-1', 'unknown-region'))).toBe(false);
    expect(isKickRealtimeUrl(url.replace('kick.com', 'kick.com.invalid'))).toBe(false);
    expect(isKickRealtimeUrl(url.replace('wss:', 'ws:'))).toBe(false);
    expect(isKickRealtimeUrl(url + '/other')).toBe(false);
  });

  it('preserves supported deletion-actor names without forwarding extra actor fields', () => {
    const clean = parseNativePublication(frame({
      message: { id: 'deleted-fixture' },
      deleted_by: { name: 'Fixture moderator', token: 'discarded-field' },
    }, 'chatrooms.1.v2', 'App\\Events\\MessageDeletedEvent'));
    expect(clean?.data.deleted_by).toEqual({ name: 'Fixture moderator' });
  });

  it('reports exact public-channel unsubscribe and removes handlers on teardown', () => {
    vi.stubGlobal('WebSocket', NativeSocket);
    const received: NativeChatSignal[] = [];
    const receive = (e: Event): void => { received.push((e as CustomEvent<NativeChatSignal>).detail); };
    window.addEventListener(NATIVE_CHAT_EVENT, receive);
    uninstall = installNativeChatBridge();
    const socket = new WebSocket(url);
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ push: { channel: 'private-user.1', unsubscribe: { code: 1 } } }) }));
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ push: { channel: 'chatrooms.1.v2', unsubscribe: { code: 1 } } }) }));
    expect(received).toEqual([{ kind: 'unavailable', socketId: 1, channel: 'chatrooms.1.v2' }]);
    uninstall(); uninstall = undefined;
    socket.close();
    expect(received).toHaveLength(1);
    window.removeEventListener(NATIVE_CHAT_EVENT, receive);
  });

  it('reuses one hook when the entry is loaded twice, including already-observed sockets', () => {
    vi.stubGlobal('WebSocket', NativeSocket);
    const received: NativeChatSignal[] = [];
    const receive = (e: Event): void => { received.push((e as CustomEvent<NativeChatSignal>).detail); };
    window.addEventListener(NATIVE_CHAT_EVENT, receive);
    uninstall = installNativeChatBridge();
    const constructor = window.WebSocket;
    const socket = new WebSocket(url);
    const repeatedTeardown = installNativeChatBridge();
    expect(repeatedTeardown).toBe(uninstall);
    expect(window.WebSocket).toBe(constructor);
    socket.dispatchEvent(new MessageEvent('message', { data: frame() }));
    expect(received).toHaveLength(1);
    window.removeEventListener(NATIVE_CHAT_EVENT, receive);
  });
});
