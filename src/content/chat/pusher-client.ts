import { logger } from '../shared/logger';
import { featureFlags } from './feature-flags';
import type { ChatBadge, ChatMessage, PinnedMessage, ReplyContext } from './message-store';

// Confirmed live 2026-07-04 (Playwright capture on kick.com, channel "allissag"):
// pusher:subscribe frames carried "auth":"" (empty) — the channel is genuinely public,
// no signature required for a second, independent, read-only connection.
const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';

const CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';
const USER_BANNED_EVENT = 'App\\Events\\UserBannedEvent';
const SUBSCRIPTION_EVENT = 'App\\Events\\SubscriptionEvent';
const CHANNEL_SUBSCRIPTION_EVENT = 'App\\Events\\ChannelSubscriptionEvent';
const GIFTED_SUBSCRIPTIONS_EVENT = 'GiftedSubscriptionsEvent';
const KICKS_GIFTED_EVENT = 'KicksGifted';
const STREAM_HOST_EVENT = 'App\\Events\\StreamHostEvent';
const PINNED_MESSAGE_CREATED_EVENT = 'App\\Events\\PinnedMessageCreatedEvent';
const CHATROOM_UPDATED_EVENT = 'App\\Events\\ChatroomUpdatedEvent';
// Event NAME confirmed from Mo'Kick's shipping source (chatroomCore binds
// `MessageDeletedEvent`) — the earlier `ChatMessageDeletedEvent` guess was wrong, which is
// why deleted-message preservation never fired. Kick nests the deleted message's id under
// `message.id`; the top-level `id` is the deletion event's OWN id, so message.id is read
// first (falling back to id for resilience).
const MESSAGE_DELETED_EVENT = 'App\\Events\\MessageDeletedEvent';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const LIVENESS_IDLE_MS = 2 * 60 * 1000;
const LIVENESS_PROBE_TIMEOUT_MS = 30 * 1000;
const LIVENESS_CHECK_INTERVAL_MS = 30 * 1000;
const CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS = 10 * 1000;
export const PRIMARY_SUBSCRIPTION_CONFIRM_TIMEOUT_MS = 10 * 1000;
export const PUSHER_ESTABLISHMENT_TIMEOUT_MS = 12 * 1000;

export interface BanEventPayload {
  userId: number;
  username?: string;
  /** true = permanent ban, false = timeout. null when the payload didn't say. */
  permanent: boolean | null;
  /** Timeout length in minutes (only meaningful when permanent === false). */
  durationMin: number | null;
  /** Moderator who issued it, if the payload carried it. */
  bannedBy: string | null;
  /** ISO expiry (timeouts), if present. */
  expiresAt: string | null;
}

export interface DeleteEventPayload {
  messageId: string;
  /** true = removed by Kick's AI moderation, false = by a human mod, null = payload didn't say.
   * Live-captured public payloads have not carried a human-mod username so far; keep deletedBy
   * nullable and best-effort in case Kick adds one. */
  aiModerated: boolean | null;
  /** Human moderator who deleted the message, if present. */
  deletedBy: string | null;
  /** Rules the AI flagged (e.g. ["hate"]); empty for human-mod deletes. */
  violatedRules: string[];
}

export interface SubscriptionEventPayload {
  chatroomId: number;
  username: string;
  months: number;
}

export interface ChannelSubscriptionEventPayload {
  userIds: number[];
  username: string;
  channelId: number;
}

export interface GiftedSubscriptionsEventPayload {
  chatroomId: number;
  correlationId: string;
  giftedUsernames: string[];
  gifterUsername: string;
  giftCount: number;
}

export interface KicksGiftedEventPayload {
  giftTransactionId: string;
  senderUsername: string;
  amount: number;
  giftName: string | null;
  senderMessage: string | null;
}

export interface HostEventPayload {
  chatroomId: number;
  hostUsername: string;
  numberViewers: number;
  optionalMessage: string | null;
}

export interface ChatroomUpdatedEventPayload {
  chatroomId: number;
  slowMode: { enabled: boolean; messageInterval: number };
  followersMode: { enabled: boolean; minDuration: number };
  subscribersMode: { enabled: boolean };
  emotesMode: { enabled: boolean };
}

export interface PusherClientCallbacks {
  onMessage: (message: ChatMessage) => void;
  onUserBanned: (payload: BanEventPayload) => void;
  onMessageDeleted?: (payload: DeleteEventPayload) => void;
  onSubscription?: (payload: SubscriptionEventPayload) => void;
  onGiftedSubscriptions?: (payload: GiftedSubscriptionsEventPayload) => void;
  onKicksGifted?: (payload: KicksGiftedEventPayload) => void;
  onHost?: (payload: HostEventPayload) => void;
  onPinnedMessage?: (payload: PinnedMessage) => void;
  onChatroomUpdated?: (payload: ChatroomUpdatedEventPayload) => void;
  onUnknownEvent?: (eventName: string, rawData: unknown) => void;
  /** Fired on pusher:connection_established (before subscribe completes) — used only for
   * status reporting; the socket may still fail to subscribe to a private/invalid channel. */
  onConnected?: () => void;
  /** Fired only after chatrooms.{id}.v2 confirms, or a validated event proves that exact
   * subscription is delivering. This—not the socket handshake—is live chat readiness. */
  onPrimarySubscriptionReady?: () => void;
  /** Transport/readiness failures are explicit so own-mode can fail open immediately. */
  onPrimarySubscriptionUnavailable?: (reason: PusherReadinessFailure) => void;
  /** Fired on socket close (before reconnect is scheduled) — status reporting only. */
  onDisconnected?: () => void;
}

export type PusherReadinessFailure =
  | 'constructor-error'
  | 'handshake-timeout'
  | 'socket-error'
  | 'server-error'
  | 'subscription-error'
  | 'subscription-timeout';

/** Badge shape on the message payload wasn't pinned down to a strict schema in the
 * spec — normalize defensively, keeping only the fields message-view.ts needs and
 * dropping anything unrecognized rather than failing the whole message.
 * Covers both shapes Kick sends: role badges in `badges` ({type,text,count,active,sort_order}, no
 * image) and global/level badges in `badges_v2`
 * ({name,image_url,selected,metadata.level,sort_order}). */
function normalizeBadge(raw: unknown): ChatBadge {
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  const meta = (data.metadata ?? null) as Record<string, unknown> | null;
  return {
    type: typeof data.type === 'string' ? data.type : undefined,
    name: typeof data.name === 'string' ? data.name : undefined,
    text: typeof data.text === 'string' ? data.text : undefined,
    count: typeof data.count === 'number' ? data.count : undefined,
    imageUrl: typeof data.image_url === 'string' ? data.image_url : undefined,
    level: meta && typeof meta.level === 'number' ? meta.level : undefined,
    active: typeof data.active === 'boolean' ? data.active : undefined,
    selected: typeof data.selected === 'boolean' ? data.selected : undefined,
    sortOrder: typeof data.sort_order === 'number' ? data.sort_order : undefined,
  };
}

function normalizeBadges(raw: unknown): ChatBadge[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBadge);
}

function normalizeMetadata(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractReplyContext(
  raw: Record<string, unknown>,
  md: Record<string, unknown> | null,
): ReplyContext | undefined {
  if (!md) return undefined;

  const originalSender = md.original_sender;
  const originalMessage = md.original_message;
  if (!originalSender && !originalMessage) return undefined;

  let replyToUser: string | null = null;
  let replyToUserId: number | null = null;
  if (typeof originalSender === 'string' && originalSender) {
    replyToUser = originalSender;
  } else if (originalSender && typeof originalSender === 'object') {
    const sender = originalSender as Record<string, unknown>;
    replyToUser = typeof sender.username === 'string' && sender.username ? sender.username : null;
    replyToUserId = typeof sender.id === 'number' ? sender.id : null;
  }

  let replyToText: string | null = null;
  let replyToMessageId: string | null = null;
  if (typeof originalMessage === 'string' && originalMessage) {
    replyToText = originalMessage;
  } else if (originalMessage && typeof originalMessage === 'object') {
    const message = originalMessage as Record<string, unknown>;
    replyToText =
      typeof message.content === 'string' && message.content ? message.content :
      typeof message.message === 'string' && message.message ? message.message :
      null;
    replyToMessageId = typeof message.id === 'string' ? message.id : null;
  }

  if (!replyToUser && !replyToText) return undefined;
  return {
    replyToUser,
    replyToText,
    replyToMessageId,
    replyToUserId,
    threadParentId: typeof raw.thread_parent_id === 'string' ? raw.thread_parent_id : null,
  };
}

function extractCelebrationContext(metadata: Record<string, unknown> | null): ChatMessage['celebration'] {
  const raw = metadata?.celebration;
  if (!raw || typeof raw !== 'object') return undefined;
  const celebration = raw as Record<string, unknown>;
  const totalMonths = celebration.total_months;
  if (
    celebration.type !== 'subscription_renewed'
    || typeof totalMonths !== 'number'
    || !Number.isSafeInteger(totalMonths)
    || totalMonths <= 0
  ) return undefined;
  return { type: 'subscription_renewed', totalMonths };
}

// Defensive: `ChatMessageEvent` is only the empirically-captured "regular message" shape.
// Kick may emit other payloads under the same event name (e.g. a system message with
// sender: null, or a reshaped field). Since native chat is already hidden by the time
// these arrive, a throw here would silently freeze the own renderer — so validate the
// required fields and drop (return null) anything malformed instead of trusting the cast.
export function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sender = r.sender;
  if (!sender || typeof sender !== 'object') return null;
  const s = sender as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.content !== 'string') return null;
  if (typeof s.id !== 'number' || typeof s.username !== 'string') return null;

  const identity = (s.identity ?? null) as Record<string, unknown> | null;
  // Pusher supplies metadata as an object; /messages/history serializes the same object as JSON.
  // Normalize once so both transport paths preserve meaning-changing reply/celebration fields.
  const metadata = normalizeMetadata(r.metadata);
  const replyContext = extractReplyContext(r, metadata);
  const celebration = extractCelebrationContext(metadata);
  return {
    id: r.id,
    chatroomId: typeof r.chatroom_id === 'number' ? r.chatroom_id : 0,
    content: r.content,
    type: typeof r.type === 'string' ? r.type : 'message',
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    sender: {
      id: s.id,
      username: s.username,
      displayName: typeof s.display_name === 'string' ? s.display_name : undefined,
      slug: typeof s.slug === 'string' ? s.slug : '',
      identity: {
        color: identity && typeof identity.color === 'string' ? identity.color : '',
        badges: normalizeBadges(identity?.badges),
        badgesV2: normalizeBadges(identity?.badges_v2),
      },
    },
    ...(celebration ? { celebration } : {}),
    ...(replyContext ? { replyContext } : {}),
    preserved: false,
  };
}

function coerceNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value) return value;
  return null;
}

/** banned_by may be a bare username string or a {username} object. */
function extractBannedBy(data: Record<string, unknown>): string | null {
  const bb = data.banned_by ?? data.bannedBy ?? data.banned_by_user;
  if (typeof bb === 'string') return bb;
  if (bb && typeof bb === 'object' && typeof (bb as Record<string, unknown>).username === 'string') {
    return (bb as Record<string, unknown>).username as string;
  }
  return null;
}

function extractActorName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return firstString(data.username, data.slug, data.name);
}

function extractDeletedBy(data: Record<string, unknown>): string | null {
  return (
    extractActorName(data.deleted_by) ??
    extractActorName(data.deletedBy) ??
    extractActorName(data.moderator) ??
    extractActorName(data.moderator_user) ??
    extractActorName(data.deleted_by_user) ??
    extractActorName(data.user_deleted_by)
  );
}

/** UserBannedEvent — live-captured shape: {id, user:{id,username}, banned_by:{username}, permanent,
 * duration}. Only user identification is required; permanent / duration / banned_by / expires_at are
 * extracted defensively (present on real bans, may be absent) so the row can show BANLANDI (perma)
 * vs TIMEOUT <süre> + the moderator. Accepts both flat {user_id,username} and nested {user:{...}}. */
export function normalizeBanPayload(raw: unknown): BanEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  let userId: number | undefined;
  let username: string | undefined;
  if (typeof data.user_id === 'number') {
    userId = data.user_id;
    username = typeof data.username === 'string' ? data.username : undefined;
  } else if (data.user && typeof data.user === 'object') {
    const user = data.user as Record<string, unknown>;
    if (typeof user.id === 'number') {
      userId = user.id;
      username = typeof user.username === 'string' ? user.username : undefined;
    }
  }
  if (userId === undefined) return null;

  return {
    userId,
    username,
    permanent: typeof data.permanent === 'boolean' ? data.permanent : null,
    durationMin: coerceNum(data.duration) ?? coerceNum(data.duration_min) ?? coerceNum(data.duration_in_minutes),
    bannedBy: extractBannedBy(data),
    expiresAt: firstString(data.expires_at, data.banned_until, data.expiresAt),
  };
}

export function normalizeDeletePayload(raw: unknown): DeleteEventPayload | null {
  const data = raw as
    | { id?: unknown; message?: { id?: unknown }; aiModerated?: unknown; violatedRules?: unknown }
    | null;
  const rawId = data?.message?.id ?? data?.id;
  const messageId = typeof rawId === 'string' ? rawId : undefined;
  if (!messageId) return null;
  const aiModerated = typeof data?.aiModerated === 'boolean' ? data.aiModerated : null;
  const deletedBy = data && typeof data === 'object' ? extractDeletedBy(data as Record<string, unknown>) : null;
  const violatedRules = Array.isArray(data?.violatedRules)
    ? data.violatedRules.filter((rule): rule is string => typeof rule === 'string')
    : [];
  return { messageId, aiModerated, deletedBy, violatedRules };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function normalizeSubscriptionPayload(raw: unknown): SubscriptionEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isPositiveInteger(data.chatroom_id)) return null;
  if (typeof data.username !== 'string' || !data.username.trim()) return null;
  if (!isPositiveInteger(data.months)) return null;
  return { chatroomId: data.chatroom_id, username: data.username, months: data.months };
}

export function normalizeChannelSubscriptionPayload(raw: unknown): ChannelSubscriptionEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isPositiveInteger(data.channel_id)) return null;
  if (typeof data.username !== 'string' || !data.username.trim()) return null;
  if (!Array.isArray(data.user_ids) || data.user_ids.length === 0 || !data.user_ids.every(isPositiveInteger)) return null;
  return {
    userIds: data.user_ids,
    username: data.username,
    channelId: data.channel_id,
  };
}

/** Modern gift event captured on chatroom_{chatroomId} on 2026-07-14. Unlike
 * ChannelSubscriptionEvent, this shape explicitly identifies the gifter and recipients and
 * carries a stable purchase correlation id. gifted_total is the purchase/event count;
 * gifter_total is cumulative and intentionally not used for the row. */
export function normalizeGiftedSubscriptionsPayload(raw: unknown): GiftedSubscriptionsEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isPositiveInteger(data.chatroom_id)) return null;
  if (typeof data.correlation_id !== 'string' || !data.correlation_id.trim()) return null;
  if (typeof data.gifter_username !== 'string' || !data.gifter_username.trim()) return null;
  if (
    !Array.isArray(data.gifted_usernames) ||
    data.gifted_usernames.length === 0 ||
    !data.gifted_usernames.every((username) => typeof username === 'string' && username.trim())
  ) return null;
  if (!isPositiveInteger(data.gifted_total)) return null;

  return {
    chatroomId: data.chatroom_id,
    correlationId: data.correlation_id,
    giftedUsernames: data.gifted_usernames,
    gifterUsername: data.gifter_username,
    giftCount: data.gifted_total,
  };
}

/** KicksGifted on channel_{channelId} — captured live 2026-07-14.
 * Validates gift_transaction_id (non-empty string), sender.id (positive int),
 * sender.username (non-empty string), and gift.amount (finite positive integer). */
export function normalizeKicksGiftedPayload(raw: unknown): KicksGiftedEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.gift_transaction_id !== 'string' || !data.gift_transaction_id.trim()) return null;

  const sender = data.sender;
  if (!sender || typeof sender !== 'object') return null;
  const s = sender as Record<string, unknown>;
  if (!isPositiveInteger(s.id)) return null;
  if (typeof s.username !== 'string' || !s.username.trim()) return null;

  const gift = data.gift;
  if (!gift || typeof gift !== 'object') return null;
  const g = gift as Record<string, unknown>;
  if (!isPositiveInteger(g.amount)) return null;

  return {
    giftTransactionId: data.gift_transaction_id,
    senderUsername: s.username,
    amount: g.amount,
    giftName: typeof g.name === 'string' && g.name.trim() ? g.name : null,
    senderMessage: typeof data.message === 'string' && data.message.trim() ? data.message : null,
  };
}

export function normalizeHostPayload(raw: unknown): HostEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isPositiveInteger(data.chatroom_id)) return null;
  if (typeof data.host_username !== 'string' || !data.host_username.trim()) return null;

  const numberViewers = data.number_viewers == null ? 0 : data.number_viewers;
  if (typeof numberViewers !== 'number' || !Number.isSafeInteger(numberViewers) || numberViewers < 0) return null;

  const optionalMessage = data.optional_message == null ? null : data.optional_message;
  if (typeof optionalMessage !== 'string' && optionalMessage !== null) return null;

  return {
    chatroomId: data.chatroom_id,
    hostUsername: data.host_username,
    numberViewers,
    optionalMessage,
  };
}

export function normalizePinnedMessagePayload(raw: unknown): PinnedMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const message = normalizeMessage(data.message);
  if (!message || !isPositiveInteger(message.chatroomId)) return null;

  const durationSeconds = coerceNum(data.duration);
  if (durationSeconds === null || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) return null;

  if (!data.pinnedBy || typeof data.pinnedBy !== 'object') return null;
  const pinnedBy = data.pinnedBy as Record<string, unknown>;
  if (!isPositiveInteger(pinnedBy.id)) return null;
  if (typeof pinnedBy.username !== 'string' || !pinnedBy.username.trim()) return null;
  if (typeof pinnedBy.slug !== 'string') return null;

  return {
    message,
    durationSeconds,
    pinnedBy: {
      id: pinnedBy.id,
      username: pinnedBy.username,
      slug: pinnedBy.slug,
    },
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function modeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function normalizeChatroomUpdatedPayload(raw: unknown): ChatroomUpdatedEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isPositiveInteger(data.id)) return null;

  const slowMode = modeRecord(data.slow_mode);
  const followersMode = modeRecord(data.followers_mode);
  const subscribersMode = modeRecord(data.subscribers_mode);
  const emotesMode = modeRecord(data.emotes_mode);
  if (!slowMode || !followersMode || !subscribersMode || !emotesMode) return null;
  if (typeof slowMode.enabled !== 'boolean' || !isNonNegativeInteger(slowMode.message_interval)) return null;
  if (typeof followersMode.enabled !== 'boolean' || !isNonNegativeInteger(followersMode.min_duration)) return null;
  if (typeof subscribersMode.enabled !== 'boolean' || typeof emotesMode.enabled !== 'boolean') return null;

  return {
    chatroomId: data.id,
    slowMode: { enabled: slowMode.enabled, messageInterval: slowMode.message_interval },
    followersMode: { enabled: followersMode.enabled, minDuration: followersMode.min_duration },
    subscribersMode: { enabled: subscribersMode.enabled },
    emotesMode: { enabled: emotesMode.enabled },
  };
}

type GiftSubscriptionState = 'idle' | 'pending' | 'active' | 'unavailable';
type PrimarySubscriptionState = 'idle' | 'pending' | 'active';

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
  private livenessTimer: number | null = null;
  private livenessProbeTimer: number | null = null;
  private lastFrameAt = 0;
  private awaitingLivenessReply = false;
  private establishmentTimer: number | null = null;
  private primarySubscriptionTimer: number | null = null;
  private primarySubscriptionState: PrimarySubscriptionState = 'idle';
  private giftSubscriptionTimer: number | null = null;
  private giftSubscriptionState: GiftSubscriptionState = 'idle';
  private kicksSubscriptionTimer: number | null = null;
  private kicksSubscriptionState: GiftSubscriptionState = 'idle';

  constructor(
    private readonly chatroomId: number,
    private readonly channelId: number,
    private readonly callbacks: PusherClientCallbacks
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.teardownSocket();

    let socket: WebSocket;
    try {
      socket = new WebSocket(PUSHER_URL);
    } catch (error) {
      logger.warn('pusher-client: WebSocket construction failed', error);
      this.callbacks.onPrimarySubscriptionUnavailable?.('constructor-error');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.startLivenessWatchdog();
    const isCurrentSocket = (): boolean => !this.disposed && this.socket === socket;
    this.establishmentTimer = window.setTimeout(() => {
      this.establishmentTimer = null;
      if (!isCurrentSocket()) return;
      logger.warn('pusher-client: connection establishment timed out; reconnecting');
      this.failCurrentConnection('handshake-timeout');
    }, PUSHER_ESTABLISHMENT_TIMEOUT_MS);

    socket.addEventListener('message', (event) => {
      if (!isCurrentSocket()) return;
      this.noteFrameActivity();
      this.handleRawMessage(event.data);
    });

    socket.addEventListener('close', () => {
      // A close/message task from a replaced or disposed socket can run after a SPA session
      // changes. It must not mutate the new session's status or schedule a stray reconnect.
      if (!isCurrentSocket()) return;
      this.socket = null;
      this.stopLivenessWatchdog();
      this.clearReadinessTimers();
      this.clearGiftSubscriptionTimer();
      this.clearKicksSubscriptionTimer();
      this.primarySubscriptionState = 'idle';
      this.giftSubscriptionState = 'idle';
      this.kicksSubscriptionState = 'idle';
      this.callbacks.onDisconnected?.();
      this.scheduleReconnect();
    });

    socket.addEventListener('error', (event) => {
      if (!isCurrentSocket()) return;
      logger.debug('pusher-client: socket error', event);
      this.failCurrentConnection('socket-error');
    });
  }

  private subscribe(): void {
    if (this.send({
      event: 'pusher:subscribe',
      data: { auth: '', channel: this.primaryChannelName },
    })) {
      this.primarySubscriptionState = 'pending';
      this.clearPrimarySubscriptionTimer();
      this.primarySubscriptionTimer = window.setTimeout(() => {
        this.primarySubscriptionTimer = null;
        if (this.primarySubscriptionState !== 'pending') return;
        logger.warn('pusher-client: primary chatroom subscription was not confirmed; reconnecting', this.primaryChannelName);
        this.failCurrentConnection('subscription-timeout');
      }, PRIMARY_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
    }
    // Retain the legacy channel as a read-only observation/compatibility path. It does not
    // control gifted-subscription availability and its ChannelSubscriptionEvent is not shown.
    this.send({
      event: 'pusher:subscribe',
      data: { auth: '', channel: this.legacyChannelName },
    });
    if (this.send({
      event: 'pusher:subscribe',
      data: { auth: '', channel: this.giftChannelName },
    })) {
      this.giftSubscriptionState = 'pending';
      this.clearGiftSubscriptionTimer();
      this.giftSubscriptionTimer = window.setTimeout(() => {
        this.giftSubscriptionTimer = null;
        if (this.giftSubscriptionState !== 'pending') return;
        this.giftSubscriptionState = 'unavailable';
        logger.warn(
          'pusher-client: gift channel subscription was not confirmed; gifted subscriptions disabled',
          this.giftChannelName,
        );
      }, CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
    }
    // channel_{channelId} (underscore) is a distinct public channel from channel.{channelId}
    // (dot); it carries paid Kicks gifts. Its own lifecycle mirrors the gift channel so an
    // unconfirmed/failed subscription only disables Kicks rows, never the primary chat.
    if (this.send({
      event: 'pusher:subscribe',
      data: { auth: '', channel: this.kicksChannelName },
    })) {
      this.kicksSubscriptionState = 'pending';
      this.clearKicksSubscriptionTimer();
      this.kicksSubscriptionTimer = window.setTimeout(() => {
        this.kicksSubscriptionTimer = null;
        if (this.kicksSubscriptionState !== 'pending') return;
        this.kicksSubscriptionState = 'unavailable';
        logger.warn(
          'pusher-client: kicks channel subscription was not confirmed; kicks gifts disabled',
          this.kicksChannelName,
        );
      }, CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
    }
  }

  private get legacyChannelName(): string {
    return `channel.${this.channelId}`;
  }

  private get giftChannelName(): string {
    return `chatroom_${this.chatroomId}`;
  }

  private get kicksChannelName(): string {
    return `channel_${this.channelId}`;
  }

  private get primaryChannelName(): string {
    return `chatrooms.${this.chatroomId}.v2`;
  }

  private clearEstablishmentTimer(): void {
    if (this.establishmentTimer === null) return;
    window.clearTimeout(this.establishmentTimer);
    this.establishmentTimer = null;
  }

  private clearPrimarySubscriptionTimer(): void {
    if (this.primarySubscriptionTimer === null) return;
    window.clearTimeout(this.primarySubscriptionTimer);
    this.primarySubscriptionTimer = null;
  }

  private clearReadinessTimers(): void {
    this.clearEstablishmentTimer();
    this.clearPrimarySubscriptionTimer();
  }

  private confirmPrimarySubscription(): void {
    if (this.primarySubscriptionState === 'active') return;
    this.clearPrimarySubscriptionTimer();
    this.primarySubscriptionState = 'active';
    this.reconnectAttempt = 0;
    this.callbacks.onPrimarySubscriptionReady?.();
  }

  private confirmPrimaryFromValidatedFrame(channel: string | undefined): void {
    if (channel === this.primaryChannelName) this.confirmPrimarySubscription();
  }

  private rejectPrimarySubscription(payload: unknown): void {
    logger.warn(
      'pusher-client: primary chatroom subscription failed; reconnecting',
      this.primaryChannelName,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    );
    this.failCurrentConnection('subscription-error');
  }

  private clearGiftSubscriptionTimer(): void {
    if (this.giftSubscriptionTimer === null) return;
    window.clearTimeout(this.giftSubscriptionTimer);
    this.giftSubscriptionTimer = null;
  }

  private confirmGiftSubscription(): void {
    this.clearGiftSubscriptionTimer();
    this.giftSubscriptionState = 'active';
  }

  private rejectGiftSubscription(payload: unknown): void {
    this.clearGiftSubscriptionTimer();
    this.giftSubscriptionState = 'unavailable';
    logger.warn(
      'pusher-client: gift channel subscription failed; gifted subscriptions disabled',
      this.giftChannelName,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    );
  }

  private clearKicksSubscriptionTimer(): void {
    if (this.kicksSubscriptionTimer === null) return;
    window.clearTimeout(this.kicksSubscriptionTimer);
    this.kicksSubscriptionTimer = null;
  }

  private confirmKicksSubscription(): void {
    this.clearKicksSubscriptionTimer();
    this.kicksSubscriptionState = 'active';
  }

  private rejectKicksSubscription(payload: unknown): void {
    this.clearKicksSubscriptionTimer();
    this.kicksSubscriptionState = 'unavailable';
    logger.warn(
      'pusher-client: kicks channel subscription failed; kicks gifts disabled',
      this.kicksChannelName,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    );
  }

  private send(payload: unknown): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  private startLivenessWatchdog(): void {
    this.stopLivenessWatchdog();
    this.lastFrameAt = Date.now();
    this.livenessTimer = window.setInterval(() => this.checkConnectionLiveness(), LIVENESS_CHECK_INTERVAL_MS);
  }

  private stopLivenessWatchdog(): void {
    if (this.livenessTimer !== null) {
      window.clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
    if (this.livenessProbeTimer !== null) {
      window.clearTimeout(this.livenessProbeTimer);
      this.livenessProbeTimer = null;
    }
    this.awaitingLivenessReply = false;
  }

  private noteFrameActivity(): void {
    this.lastFrameAt = Date.now();
    if (this.awaitingLivenessReply) {
      this.awaitingLivenessReply = false;
      if (this.livenessProbeTimer !== null) {
        window.clearTimeout(this.livenessProbeTimer);
        this.livenessProbeTimer = null;
      }
    }
  }

  private checkConnectionLiveness(): void {
    if (this.disposed || !this.socket || this.awaitingLivenessReply) return;
    if (Date.now() - this.lastFrameAt < LIVENESS_IDLE_MS) return;
    if (this.socket.readyState !== WebSocket.OPEN || !this.send({ event: 'pusher:ping', data: {} })) {
      this.reconnectAfterLivenessFailure();
      return;
    }
    this.awaitingLivenessReply = true;
    this.livenessProbeTimer = window.setTimeout(() => {
      this.livenessProbeTimer = null;
      if (!this.awaitingLivenessReply) return;
      logger.warn('pusher-client: liveness probe timed out; reconnecting');
      this.reconnectAfterLivenessFailure();
    }, LIVENESS_PROBE_TIMEOUT_MS);
  }

  private reconnectAfterLivenessFailure(): void {
    if (this.disposed || !this.socket) return;
    const socket = this.socket;
    this.stopLivenessWatchdog();
    this.clearReadinessTimers();
    this.clearGiftSubscriptionTimer();
    this.clearKicksSubscriptionTimer();
    this.primarySubscriptionState = 'idle';
    this.giftSubscriptionState = 'idle';
    this.kicksSubscriptionState = 'idle';
    // Detach before close so its eventual close event cannot schedule a second reconnect.
    this.socket = null;
    try {
      socket.close();
    } catch {
      // already closing/closed — the scheduled reconnect below is still the recovery path
    }
    this.callbacks.onDisconnected?.();
    this.scheduleReconnect();
  }

  private handleRawMessage(raw: string): void {
    let frame: { event?: string; channel?: string; data?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch (error) {
      logger.warn('pusher-client: failed to parse frame', error);
      return;
    }

    const eventName = frame.event;
    if (!eventName) return;

    if (eventName === 'pusher:connection_established') {
      this.clearEstablishmentTimer();
      this.subscribe();
      this.callbacks.onConnected?.();
      return;
    }
    if (eventName === 'pusher:ping') {
      this.send({ event: 'pusher:pong', data: {} });
      return;
    }
    if (eventName === 'pusher:error') {
      // Pusher error frames carry {code, message}. Stringify so the code is readable in the
      // console (was logging a bare object → "[object Object]"). Typically transient — e.g. a
      // per-IP connection/rate limit when many tabs/clients hit the same public app — and the
      // reconnect/heartbeat logic recovers; a single normal connection does not see these.
      const data = this.parseInnerData(frame.data);
      logger.debug('pusher-client: server error frame', typeof data === 'string' ? data : JSON.stringify(data));
      this.failCurrentConnection('server-error');
      return;
    }
    if (eventName === 'pusher_internal:subscription_succeeded') {
      if (frame.channel === this.primaryChannelName) this.confirmPrimarySubscription();
      if (frame.channel === this.giftChannelName) this.confirmGiftSubscription();
      if (frame.channel === this.kicksChannelName) this.confirmKicksSubscription();
      return;
    }
    if (eventName === 'pusher:subscription_error') {
      if (frame.channel === this.primaryChannelName) {
        this.rejectPrimarySubscription(this.parseInnerData(frame.data));
        return;
      }
      if (frame.channel === this.giftChannelName) this.rejectGiftSubscription(this.parseInnerData(frame.data));
      if (frame.channel === this.kicksChannelName) this.rejectKicksSubscription(this.parseInnerData(frame.data));
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
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onMessage(message);
        return;
      }
      case USER_BANNED_EVENT: {
        if (featureFlags.debugLogging) {
          logger.debug('pusher-client: raw UserBannedEvent payload', payload);
        }
        const normalized = normalizeBanPayload(payload);
        if (normalized) {
          this.confirmPrimaryFromValidatedFrame(frame.channel);
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
        // Live-captured shape: {id, message:{id}, aiModerated, violatedRules:[...]}. aiModerated
        // distinguishes an AI-moderation delete (with the flagged rule) from a human-mod delete.
        const normalized = normalizeDeletePayload(payload);
        if (!normalized) return;
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onMessageDeleted?.(normalized);
        return;
      }
      case SUBSCRIPTION_EVENT: {
        const normalized = normalizeSubscriptionPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: SubscriptionEvent payload did not match the captured shape', payload);
          return;
        }
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onSubscription?.(normalized);
        return;
      }
      case CHANNEL_SUBSCRIPTION_EVENT: {
        const normalized = normalizeChannelSubscriptionPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: ChannelSubscriptionEvent payload did not match the captured shape', payload);
          return;
        }
        // This is a generic subscription notification, not a gift event. Real 2026-07-14
        // captures show it co-firing with SubscriptionEvent for self/ordinary subscriptions,
        // while explicit gifts arrive separately as GiftedSubscriptionsEvent. It intentionally
        // has no presentation callback, preventing one action from becoming gift + sub rows.
        if (featureFlags.debugLogging) {
          logger.debug('pusher-client: non-presentational ChannelSubscriptionEvent', normalized);
        }
        return;
      }
      case GIFTED_SUBSCRIPTIONS_EVENT: {
        if (frame.channel !== this.giftChannelName) return;
        if (this.giftSubscriptionState === 'unavailable') return;
        const normalized = normalizeGiftedSubscriptionsPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: GiftedSubscriptionsEvent payload did not match the captured shape', payload);
          return;
        }
        // Receiving the event proves chatroom_{id} is live if its confirmation frame was delayed.
        if (frame.channel === this.giftChannelName) this.confirmGiftSubscription();
        this.callbacks.onGiftedSubscriptions?.(normalized);
        return;
      }
      case KICKS_GIFTED_EVENT: {
        // Paid Kicks gifts arrive on channel_{channelId} only. Ignore look-alikes on other
        // channels and stay silent once the subscription proved unavailable.
        if (frame.channel !== this.kicksChannelName) return;
        if (this.kicksSubscriptionState === 'unavailable') return;
        const normalized = normalizeKicksGiftedPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: KicksGifted payload did not match the captured shape', payload);
          return;
        }
        // Receiving the event proves channel_{channelId} is live if its confirmation was delayed.
        this.confirmKicksSubscription();
        this.callbacks.onKicksGifted?.(normalized);
        return;
      }
      case STREAM_HOST_EVENT: {
        const normalized = normalizeHostPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: StreamHostEvent payload did not match the captured shape', payload);
          return;
        }
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onHost?.(normalized);
        return;
      }
      case PINNED_MESSAGE_CREATED_EVENT: {
        const normalized = normalizePinnedMessagePayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: PinnedMessageCreatedEvent payload did not match the captured shape', payload);
          return;
        }
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onPinnedMessage?.(normalized);
        return;
      }
      case CHATROOM_UPDATED_EVENT: {
        const normalized = normalizeChatroomUpdatedPayload(payload);
        if (!normalized) {
          logger.warn('pusher-client: ChatroomUpdatedEvent payload did not match the captured shape', payload);
          return;
        }
        this.confirmPrimaryFromValidatedFrame(frame.channel);
        this.callbacks.onChatroomUpdated?.(normalized);
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
      logger.debug('pusher-client: failed to parse inner data', error);
      return null;
    }
  }

  private failCurrentConnection(reason: PusherReadinessFailure): void {
    if (this.disposed) return;
    const socket = this.socket;
    this.socket = null;
    this.stopLivenessWatchdog();
    this.clearReadinessTimers();
    this.clearGiftSubscriptionTimer();
    this.clearKicksSubscriptionTimer();
    this.primarySubscriptionState = 'idle';
    this.giftSubscriptionState = 'idle';
    this.kicksSubscriptionState = 'idle';
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closing/closed — reconnect scheduling below remains authoritative
      }
    }
    this.callbacks.onPrimarySubscriptionUnavailable?.(reason);
    if (socket) this.callbacks.onDisconnected?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private teardownSocket(): void {
    this.stopLivenessWatchdog();
    this.clearReadinessTimers();
    this.clearGiftSubscriptionTimer();
    this.clearKicksSubscriptionTimer();
    this.primarySubscriptionState = 'idle';
    this.giftSubscriptionState = 'idle';
    this.kicksSubscriptionState = 'idle';
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
