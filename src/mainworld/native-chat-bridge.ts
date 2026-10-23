import {
  NATIVE_CHAT_EVENT, isPublicChatChannel, parseNativePublication, record,
  type NativeChatSignal,
} from '../shared/native-chat';

const BRIDGE_SLOT = Symbol.for('kickflow.native-chat-bridge.v1');
// Accept a single region label, never an arbitrary subdomain or a hostname suffix.
const REALTIME_HOST = /^realtime\.[a-z0-9]+(?:-[a-z0-9]+)*\.platform\.kick\.com$/;

export function isKickRealtimeUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' && !(raw instanceof URL)) return false;
  try {
    const url = new URL(String(raw));
    return url.protocol === 'wss:' && REALTIME_HOST.test(url.hostname)
      && !url.username && !url.password && !url.port
      && url.pathname === '/connection/websocket';
  } catch { return false; }
}

function findDescriptor(start: object | null, key: PropertyKey): PropertyDescriptor | undefined {
  for (let proto = start; proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/** Observe incoming public publications only. Never inspect send(), auth or connect replies.
 *
 * 2026-10-20: the bridge no longer replaces the
 * WebSocket constructor. A Proxy construct trap put this file on top of the stack of EVERY socket
 * Kick opens, so Chrome attributed each failed Kick handshake ("WebSocket connection to
 * wss://websockets.kick.com/viewer/v1/connect ... failed", measured 2026-10-20 at native-chat.js:171)
 * to the extension's error list. Kick's realtime client registers its message handler right after
 * construction (onmessage or addEventListener), so the bridge attaches there instead; the socket
 * is created by Kick's own frame and its failures stay Kick's. */
export function installNativeChatBridge(target: Window & Pick<typeof globalThis, 'WebSocket'> = window): () => void {
  const state = target as typeof target & Partial<Record<symbol, () => void>>;
  const existing = state[BRIDGE_SLOT];
  if (existing) return existing;
  const proto = target.WebSocket.prototype as WebSocket;
  const ownAdd = Object.getOwnPropertyDescriptor(proto, 'addEventListener');
  const baseAdd = findDescriptor(proto, 'addEventListener')?.value as WebSocket['addEventListener'];
  const ownOnMessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
  const onMessageDescriptor = findDescriptor(proto, 'onmessage');
  const cleanups = new Set<() => void>();
  const seen = new WeakSet<object>();
  let nextSocketId = 0;
  let disposed = false;
  const publish = (signal: NativeChatSignal): void => {
    if (!disposed) target.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: signal }));
  };
  const observe = (socket: WebSocket): void => {
    if (disposed || seen.has(socket)) return;
    seen.add(socket);
    let url: unknown;
    try { url = socket.url; } catch { return; }
    if (!isKickRealtimeUrl(url)) return;
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
      socket.removeEventListener('message', onMessage as EventListener);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onClose);
      cleanups.delete(cleanup);
    };
    const onClose = (): void => {
      publish({ kind: 'unavailable', socketId });
      cleanup();
    };
    cleanups.add(cleanup);
    baseAdd.call(socket, 'message', onMessage as EventListener);
    baseAdd.call(socket, 'close', onClose);
    baseAdd.call(socket, 'error', onClose);
  };
  Object.defineProperty(proto, 'addEventListener', {
    configurable: true,
    writable: true,
    enumerable: ownAdd?.enumerable ?? false,
    value: function addEventListener(this: WebSocket, ...args: Parameters<WebSocket['addEventListener']>) {
      observe(this);
      return baseAdd.apply(this, args);
    },
  });
  const setOnMessage = onMessageDescriptor?.set;
  if (setOnMessage && onMessageDescriptor?.configurable !== false) {
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: onMessageDescriptor.enumerable,
      get: onMessageDescriptor.get,
      set(this: WebSocket, value: unknown) {
        observe(this);
        setOnMessage.call(this, value);
      },
    });
  }
  const restore = (key: 'addEventListener' | 'onmessage', own: PropertyDescriptor | undefined): void => {
    if (own) Object.defineProperty(proto, key, own);
    else delete (proto as unknown as Record<string, unknown>)[key];
  };
  const teardown = (): void => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    restore('addEventListener', ownAdd);
    if (setOnMessage && onMessageDescriptor?.configurable !== false) restore('onmessage', ownOnMessage);
    if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
  };
  state[BRIDGE_SLOT] = teardown;
  return teardown;
}
