import { logger } from '../shared/logger';
import { featureFlags } from './feature-flags';
import type { ChatBadge, ChatMessage } from './message-store';

// Confirmed live 2026-07-04 (Playwright capture on kick.com, channel "allissag"):
// pusher:subscribe frames carried "auth":"" (empty) — the channel is genuinely public,
// no signature required for a second, independent, read-only connection.
const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';

const CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';
const USER_BANNED_EVENT = 'App\\Events\\UserBannedEvent';
// Event NAME confirmed from Mo'Kick's shipping source (chatroomCore binds
// `MessageDeletedEvent`) — the earlier `ChatMessageDeletedEvent` guess was wrong, which is
// why deleted-message preservation never fired. Kick nests the deleted message's id under
// `message.id`; the top-level `id` is the deletion event's OWN id, so message.id is read
// first (falling back to id for resilience).
const MESSAGE_DELETED_EVENT = 'App\\Events\\MessageDeletedEvent';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

export interface BanEventPayload {
  userId: number;
  username?: string;
}

export interface PusherClientCallbacks {
  onMessage: (message: ChatMessage) => void;
  onUserBanned: (payload: BanEventPayload) => void;
  onMessageDeleted?: (messageId: string) => void;
  onUnknownEvent?: (eventName: string, rawData: unknown) => void;
  /** Fired on pusher:connection_established (before subscribe completes) — used only for
   * status reporting; the socket may still fail to subscribe to a private/invalid channel. */
  onConnected?: () => void;
  /** Fired on socket close (before reconnect is scheduled) — status reporting only. */
  onDisconnected?: () => void;
}

/** Badge shape on the message payload wasn't pinned down to a strict schema in the
 * spec — normalize defensively, keeping only the fields message-view.ts needs and
 * dropping anything unrecognized rather than failing the whole message. */
function normalizeBadge(raw: unknown): ChatBadge {
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  return {
    type: typeof data.type === 'string' ? data.type : undefined,
    text: typeof data.text === 'string' ? data.text : undefined,
    count: typeof data.count === 'number' ? data.count : undefined,
    imageUrl: typeof data.image_url === 'string' ? data.image_url : undefined,
  };
}

function normalizeBadges(raw: unknown): ChatBadge[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBadge);
}

// Defensive: `ChatMessageEvent` is only the empirically-captured "regular message" shape.
// Kick may emit other payloads under the same event name (e.g. a system message with
// sender: null, or a reshaped field). Since native chat is already hidden by the time
// these arrive, a throw here would silently freeze the own renderer — so validate the
// required fields and drop (return null) anything malformed instead of trusting the cast.
function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sender = r.sender;
  if (!sender || typeof sender !== 'object') return null;
  const s = sender as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.content !== 'string') return null;
  if (typeof s.id !== 'number' || typeof s.username !== 'string') return null;

  const identity = (s.identity ?? null) as Record<string, unknown> | null;
  return {
    id: r.id,
    chatroomId: typeof r.chatroom_id === 'number' ? r.chatroom_id : 0,
    content: r.content,
    type: typeof r.type === 'string' ? r.type : 'message',
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    sender: {
      id: s.id,
      username: s.username,
      slug: typeof s.slug === 'string' ? s.slug : '',
      identity: {
        color: identity && typeof identity.color === 'string' ? identity.color : '',
        badges: normalizeBadges(identity?.badges),
        badgesV2: normalizeBadges(identity?.badges_v2),
      },
    },
    preserved: false,
  };
}

/** UserBannedEvent's exact payload shape was NOT empirically captured (event name only,
 * confirmed via an existing open-source script). Accept both a flat {user_id, username}
 * shape and a nested {user: {id, username}} shape by checking which fields exist. */
function normalizeBanPayload(raw: unknown): BanEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  if (typeof data.user_id === 'number') {
    return { userId: data.user_id, username: typeof data.username === 'string' ? data.username : undefined };
  }

  const nestedUser = data.user;
  if (nestedUser && typeof nestedUser === 'object') {
    const user = nestedUser as Record<string, unknown>;
    if (typeof user.id === 'number') {
      return { userId: user.id, username: typeof user.username === 'string' ? user.username : undefined };
    }
  }

  return null;
}

/** Opens KickFlow's own, independent, read-only Pusher connection — never the page's
 * authenticated one. Reconnects on both socket drop and on being reconnect()-ed after a
 * SPA channel change (the content script's own WS dies on a real page refresh, but
 * bootstrap.ts also tears down/recreates this client whenever the channel changes without
 * a refresh). */
export class PusherClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly chatroomId: number,
    private readonly callbacks: PusherClientCallbacks
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.teardownSocket();

    const socket = new WebSocket(PUSHER_URL);
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      this.handleRawMessage(event.data);
    });

    socket.addEventListener('close', () => {
      if (this.disposed) return;
      this.callbacks.onDisconnected?.();
      this.scheduleReconnect();
    });

    socket.addEventListener('error', (event) => {
      logger.warn('pusher-client: socket error', event);
    });
  }

  private subscribe(): void {
    this.send({
      event: 'pusher:subscribe',
      data: { auth: '', channel: `chatrooms.${this.chatroomId}.v2` },
    });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private handleRawMessage(raw: string): void {
    let frame: { event?: string; data?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch (error) {
      logger.warn('pusher-client: failed to parse frame', error);
      return;
    }

    const eventName = frame.event;
    if (!eventName) return;

    if (eventName === 'pusher:connection_established') {
      this.reconnectAttempt = 0;
      this.subscribe();
      this.callbacks.onConnected?.();
      return;
    }
    if (eventName === 'pusher:ping') {
      this.send({ event: 'pusher:pong', data: {} });
      return;
    }
    if (eventName === 'pusher:error') {
      logger.warn('pusher-client: server error frame', frame.data);
      return;
    }
    if (eventName.startsWith('pusher_internal:') || eventName.startsWith('pusher:')) {
      return;
    }

    const payload = this.parseInnerData(frame.data);

    switch (eventName) {
      case CHAT_MESSAGE_EVENT: {
        if (!payload) return;
        const message = normalizeMessage(payload);
        if (!message) {
          if (featureFlags.debugLogging) {
            logger.debug('pusher-client: dropped malformed ChatMessageEvent payload', payload);
          }
          return;
        }
        this.callbacks.onMessage(message);
        return;
      }
      case USER_BANNED_EVENT: {
        if (featureFlags.debugLogging) {
          logger.debug('pusher-client: raw UserBannedEvent payload', payload);
        }
        const normalized = normalizeBanPayload(payload);
        if (normalized) {
          this.callbacks.onUserBanned(normalized);
        } else {
          logger.warn('pusher-client: UserBannedEvent payload matched neither known shape', payload);
        }
        return;
      }
      case MESSAGE_DELETED_EVENT: {
        // Always forward — the showDeletedMessages decision (preserve vs remove the row) is made
        // downstream in ban-guard. Gating here left the message visible as a normal row when the
        // flag was off, since KickFlow renders its own list and native never sees it (cx review 2).
        const data = payload as { id?: unknown; message?: { id?: unknown } } | null;
        const rawId = data?.message?.id ?? data?.id;
        const messageId = typeof rawId === 'string' ? rawId : undefined;
        if (messageId) this.callbacks.onMessageDeleted?.(messageId);
        return;
      }
      default: {
        if (featureFlags.debugLogging) {
          logger.debug('pusher-client: unknown event', eventName, JSON.stringify(payload)?.slice(0, 500));
        }
        this.callbacks.onUnknownEvent?.(eventName, payload);
      }
    }
  }

  // Pusher channel events double-encode: the outer frame's `data` is itself a JSON
  // string that must be parsed again to reach the real payload.
  private parseInnerData(data: unknown): unknown {
    if (typeof data !== 'string') return data ?? null;
    try {
      return JSON.parse(data);
    } catch (error) {
      logger.warn('pusher-client: failed to parse inner data', error);
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private teardownSocket(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        // already closing/closed — nothing to do
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.teardownSocket();
  }
}
