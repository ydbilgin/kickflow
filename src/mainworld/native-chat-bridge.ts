import {
  NATIVE_CHAT_EVENT, isPublicChatChannel, parseNativePublication, record,
  type NativeChatSignal,
} from '../shared/native-chat';

const BRIDGE_SLOT = Symbol.for('kickflow.native-chat-bridge.v1');
// Both regional endpoints were measured on native Kick on 2026-10-13. Keep exact
// hosts: accepting a suffix or arbitrary URL would observe unrelated sockets.
const REALTIME_HOSTS = new Set([
  'realtime.us-east-1.platform.kick.com',
  'realtime.us-west-2.platform.kick.com',
]);

export function isKickRealtimeUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' && !(raw instanceof URL)) return false;
  try {
    const url = new URL(String(raw));
    return url.protocol === 'wss:' && REALTIME_HOSTS.has(url.hostname)
      && url.pathname === '/connection/websocket';
  } catch { return false; }
}

/** Observe incoming public publications only. Never inspect send(), auth or connect replies. */
export function installNativeChatBridge(target: Window & Pick<typeof globalThis, 'WebSocket'> = window): () => void {
  const state = target as typeof target & Partial<Record<symbol, () => void>>;
  const existing = state[BRIDGE_SLOT];
  if (existing) return existing;
  const original = target.WebSocket;
  const cleanups = new Set<() => void>();
  let nextSocketId = 0;
  let disposed = false;
  const publish = (signal: NativeChatSignal): void => {
    if (!disposed) target.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: signal }));
  };
  const wrapped = new Proxy(original, {
    construct(ctor, args, newTarget) {
      const socket = Reflect.construct(ctor, args, newTarget) as WebSocket;
      if (!isKickRealtimeUrl(args[0]) || disposed) return socket;
      const socketId = ++nextSocketId;
      const onMessage = (event: MessageEvent): void => {
        if (disposed || typeof event.data !== 'string') return;
        // Centrifuge can delimit several JSON protocol replies with newlines.
        for (const raw of event.data.split('\n')) {
          const publication = parseNativePublication(raw);
          if (publication) {
            publish({ kind: 'publication', socketId, publication });
            continue;
          }
          try {
            const push = record(record(JSON.parse(raw))?.push);
            if (push?.unsubscribe && isPublicChatChannel(push.channel)) {
              publish({ kind: 'unavailable', socketId, channel: push.channel });
            }
          } catch { /* Malformed/control traffic never crosses the boundary. */ }
        }
      };
      const cleanup = (): void => {
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onClose);
        cleanups.delete(cleanup);
      };
      const onClose = (): void => {
        publish({ kind: 'unavailable', socketId });
        cleanup();
      };
      cleanups.add(cleanup);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onClose);
      return socket;
    },
  });
  target.WebSocket = wrapped;
  const teardown = (): void => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    if (target.WebSocket === wrapped) target.WebSocket = original;
    if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
  };
  state[BRIDGE_SLOT] = teardown;
  return teardown;
}
