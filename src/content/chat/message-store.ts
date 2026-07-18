export interface ChatBadge {
  type?: string;      // role badges (old array): moderator/vip/broadcaster/verified/subscriber/...
  name?: string;      // badges_v2 label: 'level' / 'GoldenK'
  text?: string;      // human label from old array ('Moderator', 'Verified channel')
  count?: number;     // subscriber / sub_gifter count (months / gifts)
  imageUrl?: string;  // badges_v2 image_url (or a resolved subscriber image)
  level?: number;     // badges_v2 metadata.level
  active?: boolean;   // role-badge visibility; user-card responses retain inactive badges
  selected?: boolean; // badges_v2 visibility choice; Kick keeps unselected badges in the payload
  sortOrder?: number; // Kick's sort_order — for stable ordering across both arrays
}

/** A channel's own custom subscriber-tier image, keyed by the month threshold it unlocks at
 * (from `GET /api/v2/channels/{slug}` → `subscriber_badges`). Resolved against a subscriber
 * badge's `count` (months subscribed) in message-view.ts. */
export interface SubscriberBadge { readonly months: number; readonly src: string; }

/** Kick sends role badges in `badges` (no image) and global/level badges in `badges_v2` (with
 * image_url). They are disjoint, but user-card responses retain inactive role badges and
 * badges_v2 retains owned badges whose user-facing `selected` flag is false; native chat
 * suppresses both. Merge visible entries, dedup by (type||name)+count, and sort by Kick's
 * sort_order ascending so the row matches native order. */
export function mergeIdentityBadges(identity: { badges: ChatBadge[]; badgesV2: ChatBadge[] }): ChatBadge[] {
  const out: ChatBadge[] = [];
  const seen = new Set<string>();
  const visibleBadges = identity.badges.filter((badge) => badge.active !== false);
  const visibleBadgesV2 = identity.badgesV2.filter((badge) => badge.selected !== false);
  for (const badge of [...visibleBadges, ...visibleBadgesV2]) {
    const key = (badge.type ?? badge.name ?? '') + ':' + (badge.count ?? '');
    // Badges with neither `type` nor `name` have no reliable identity to dedupe on — keep them
    // unconditionally so the text fallback in appendBadges still has something to render.
    if (key !== ':') {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(badge);
  }
  return out.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
}

export interface ChatMessageSender {
  id: number;
  username: string;
  displayName?: string;
  slug: string;
  identity: {
    color: string;
    badges: ChatBadge[];
    badgesV2: ChatBadge[];
  };
}

/** Identity comparison is deliberately narrow. Kick slugs and usernames are case-insensitive,
 * but punctuation is meaningful (`name-with-dash` and `name_with_dash` are not interchangeable). */
export function normalizeChatIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export type PreservedReason = 'banned' | 'deleted';

export interface ReplyContext {
  replyToUser: string | null;
  replyToText: string | null;
  replyToMessageId?: string | null;
  replyToUserId?: number | null;
  threadParentId?: string | null;
}

export interface CelebrationContext {
  type: 'subscription_renewed';
  totalMonths: number;
}

/** Non-moderatable rows emitted by Kick's chat event streams. They still travel through
 * the normal store/render queue so ordering, trimming, scroll-follow, and id de-duping stay shared. */
export type ChatSystemEvent =
  | { kind: 'subscription'; username: string; months: number }
  | { kind: 'gifted-subscription'; username: string; giftCount: number; giftedUsernames: string[] }
  | { kind: 'kicks'; username: string; amount: number; giftName: string | null; senderMessage: string | null }
  | { kind: 'host'; username: string; numberViewers: number; optionalMessage: string | null }
  | { kind: 'mode'; mode: ChatroomModeKey; text: string };

export type ChatroomModeKey = 'slow_mode' | 'followers_mode' | 'subscribers_mode' | 'emotes_mode';

export interface PinnedBy {
  id: number;
  username: string;
  slug: string;
}

/** Normalized transport payload retained for Pusher protocol coverage. Pin presentation remains
 * native to Kick and is never stored in or rendered by KickFlow's own scrolling chat ring. */
export interface PinnedMessage {
  message: ChatMessage;
  durationSeconds: number;
  pinnedBy: PinnedBy;
}

/** Moderation detail attached to a preserved message so the row can distinguish a permanent
 * BANLANDI from a TIMEOUT (with its duration) and name the moderator. */
export interface PreservedMeta {
  /** true = permanent ban, false = timeout, null/undefined = unknown. */
  permanent?: boolean | null;
  /** Timeout length in minutes (timeouts only). */
  durationMin?: number | null;
  /** Moderator who issued the ban/timeout, if known. */
  bannedBy?: string | null;
  /** Deletes: true = AI moderation, false = human mod, null/undefined = unknown. */
  aiModerated?: boolean | null;
  /** Deletes: moderator who deleted the message, if Kick's payload carries one. */
  deletedBy?: string | null;
  /** Deletes: AI-flagged rules (e.g. ["hate"]). */
  violatedRules?: string[];
}

export interface ChatMessage {
  id: string;
  seq?: number;
  chatroomId: number;
  content: string;
  type: string;
  createdAt: string;
  sender: ChatMessageSender;
  systemEvent?: ChatSystemEvent;
  celebration?: CelebrationContext;
  replyContext?: ReplyContext;
  preserved: boolean;
  preservedReason?: PreservedReason;
  preservedMeta?: PreservedMeta;
  /** Local wall-clock timestamp of the moderation event that made this message preserved. */
  preservedAt?: number;
}

// Invariant: every message currently rendered in Mode A's DOM must still be retrievable from
// this store (so a visible-but-scrolled-up row can still be preserved on ban/delete). Mode A's
// paused DOM cap is MAX_NON_PRESERVED_NODES_PAUSED (dom-window.ts, currently 600) — keep
// GLOBAL_CAPACITY comfortably above it (margin covers preserved messages interleaved in the
// recency ring, which still occupy ring slots). If either constant changes, re-check the other.
export const GLOBAL_CAPACITY = 800;
const PER_USER_CAPACITY = 30;
const PRESERVED_CAPACITY = 50;
const PRESERVED_TTL_MS = 10 * 60 * 1000;

/** Dairesel buffer / circular ring buffer with a fixed capacity. */
export class LimitedQueue<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('LimitedQueue capacity must be greater than zero');
    }
  }

  /** Pushes an item; returns the item evicted from the front, if the queue was full. */
  push(item: T): T | undefined {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      return this.items.shift();
    }
    return undefined;
  }

  toArray(): readonly T[] {
    return this.items.slice();
  }

  includes(item: T): boolean {
    return this.items.includes(item);
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/** DOM node <-> message association for Mode A's own-rendered rows. WeakMap is used in the
 * element->message direction so detached nodes can still be GC'd; callers clean the Map indexes
 * with forget() when rows are trimmed or removed. */
export class ChatDomRegistry {
  private readonly messageByElement = new WeakMap<HTMLElement, ChatMessage>();
  private readonly elementByMessageId = new Map<string, HTMLElement>();
  private readonly elementsByUserId = new Map<number, Set<HTMLElement>>();

  register(element: HTMLElement, message: ChatMessage): void {
    this.messageByElement.set(element, message);
    this.elementByMessageId.set(message.id, element);
    if (message.systemEvent) return;
    let set = this.elementsByUserId.get(message.sender.id);
    if (!set) {
      set = new Set();
      this.elementsByUserId.set(message.sender.id, set);
    }
    set.add(element);
  }

  getMessage(element: HTMLElement): ChatMessage | undefined {
    return this.messageByElement.get(element);
  }

  getElementForMessageId(messageId: string): HTMLElement | undefined {
    return this.elementByMessageId.get(messageId);
  }

  getElementsForUser(userId: number): HTMLElement[] {
    const set = this.elementsByUserId.get(userId);
    return set ? Array.from(set) : [];
  }

  forget(element: HTMLElement): void {
    const message = this.messageByElement.get(element);
    if (!message) return;
    this.elementByMessageId.delete(message.id);
    if (message.systemEvent) return;
    const set = this.elementsByUserId.get(message.sender.id);
    if (set) {
      set.delete(element);
      if (set.size === 0) this.elementsByUserId.delete(message.sender.id);
    }
  }

  clear(): void {
    this.elementByMessageId.clear();
    this.elementsByUserId.clear();
  }
}

export interface ChatIntegrityStoreOptions {
  /** Called whenever a preserved (banned/deleted) message stops being preserved — either
   * evicted by the 50-entry preserved cap or expired by the TTL sweep. */
  onPreservedEvicted?: (message: ChatMessage) => void;
}

interface PendingDelete {
  id: string;
  meta: PreservedMeta;
}

export class ChatIntegrityStore {
  readonly messageById = new Map<string, ChatMessage>();
  readonly messagesByUserId = new Map<number, Set<string>>();

  private readonly global = new LimitedQueue<ChatMessage>(GLOBAL_CAPACITY);
  // Separate pinned sub-collection, exempt from the eviction below. Without this, a fast
  // chat would silently evict the very messages this extension exists to preserve.
  // Bounded on two axes so it can never grow without bound itself: capacity (50, via
  // LimitedQueue) AND age (PRESERVED_TTL_MS, via sweepExpiredPreserved).
  private readonly preserved = new LimitedQueue<ChatMessage>(PRESERVED_CAPACITY);
  private readonly perUserQueues = new Map<number, LimitedQueue<ChatMessage>>();
  // When showDeletedMessages is off, the row leaves messageById so a pending render is dropped.
  // Keep a bounded id tombstone so a reconnect/history replay cannot resurrect it, and so an old
  // object still draining from the ordinary rings can never collide with a replacement id.
  private readonly removedMessageIds = new Set<string>();
  private readonly removedMessageIdOrder = new LimitedQueue<string>(GLOBAL_CAPACITY);
  // A live delete can race the initial history response. Retain its metadata until that message
  // arrives so the stale history snapshot is born preserved instead of flashing as a normal row.
  private readonly pendingDeletedById = new Map<string, PendingDelete>();
  private readonly pendingDeleteOrder = new LimitedQueue<PendingDelete>(GLOBAL_CAPACITY);
  private nextSeq = 1;

  constructor(private readonly options: ChatIntegrityStoreOptions = {}) {}

  /** Adds a message once. The boolean lets callers avoid queueing a duplicate id for render. */
  addMessage(message: ChatMessage): boolean {
    if (this.messageById.has(message.id) || this.removedMessageIds.has(message.id)) return false;
    message.seq ??= this.nextSeq++;
    this.messageById.set(message.id, message);
    if (!message.systemEvent) {
      this.indexByUser(message);

      let perUserQueue = this.perUserQueues.get(message.sender.id);
      if (!perUserQueue) {
        perUserQueue = new LimitedQueue<ChatMessage>(PER_USER_CAPACITY);
        this.perUserQueues.set(message.sender.id, perUserQueue);
      }
      const evictedFromUser = perUserQueue.push(message);
      if (evictedFromUser) this.forget(evictedFromUser);
    }

    const evictedGlobally = this.global.push(message);
    if (evictedGlobally) this.forget(evictedGlobally);
    const pendingDelete = this.pendingDeletedById.get(message.id);
    if (pendingDelete && !message.systemEvent) {
      this.pendingDeletedById.delete(message.id);
      this.preserveMessage(message, 'deleted', pendingDelete.meta);
    }
    return true;
  }

  private indexByUser(message: ChatMessage): void {
    let ids = this.messagesByUserId.get(message.sender.id);
    if (!ids) {
      ids = new Set();
      this.messagesByUserId.set(message.sender.id, ids);
    }
    ids.add(message.id);
  }

  /** Preserved messages must survive normal ring-buffer eviction (see the preserved
   * sub-collection above) — only forget non-preserved messages here. */
  private forget(message: ChatMessage): void {
    if (message.preserved) return;
    this.messageById.delete(message.id);
    if (message.systemEvent) return;
    const ids = this.messagesByUserId.get(message.sender.id);
    if (ids) {
      ids.delete(message.id);
      if (ids.size === 0) {
        this.messagesByUserId.delete(message.sender.id);
        // A one-message chatter can leave the global ring while their per-user queue still
        // retains the same object. Keeping that now-unreachable queue forever makes this map
        // grow with every unique chatter in a long-running channel session.
        this.perUserQueues.delete(message.sender.id);
      }
    }
  }

  /** Only messages still tracked at ban time can be preserved: the per-user last ~30
   * and whatever is still inside the global 500-message/200-DOM-node window. Anything
   * already evicted before the ban event arrives is gone — this is NOT full chat-history
   * recovery, only a "don't lose what's still on screen or just off-screen" safety net. */
  getMessagesByUserId(userId: number): ChatMessage[] {
    const ids = this.messagesByUserId.get(userId);
    if (!ids) return [];
    const result: ChatMessage[] = [];
    for (const id of ids) {
      const message = this.messageById.get(id);
      if (message) result.push(message);
    }
    return result;
  }

  getMessageById(messageId: string): ChatMessage | undefined {
    return this.messageById.get(messageId);
  }

  getMessageSeq(messageId: string): number | undefined {
    return this.messageById.get(messageId)?.seq;
  }

  /** Fully drop a non-preserved message from the index, used by own-render mode when
   * showDeletedMessages is off and KickFlow must mimic native row removal itself. */
  removeMessage(messageId: string): void {
    const message = this.messageById.get(messageId);
    if (message?.preserved) return;
    this.rememberRemovedMessageId(messageId);
    this.pendingDeletedById.delete(messageId);
    if (!message) return;
    this.messageById.delete(messageId);
    if (message.systemEvent) return;
    const ids = this.messagesByUserId.get(message.sender.id);
    if (ids) {
      ids.delete(messageId);
      if (ids.size === 0) {
        this.messagesByUserId.delete(message.sender.id);
        this.perUserQueues.delete(message.sender.id);
      }
    }
  }

  private rememberRemovedMessageId(messageId: string): void {
    if (this.removedMessageIds.has(messageId)) return;
    this.removedMessageIds.add(messageId);
    const evicted = this.removedMessageIdOrder.push(messageId);
    if (evicted) this.removedMessageIds.delete(evicted);
  }

  isPreservedBanned(messageId: string): boolean {
    const message = this.messageById.get(messageId);
    return message?.preserved === true && message.preservedReason === 'banned';
  }

  getMessagesInArrivalOrder(): ChatMessage[] {
    return Array.from(this.messageById.values()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  markUserBanned(userId: number, meta: PreservedMeta = {}): ChatMessage[] {
    const messages = this.getMessagesByUserId(userId);
    for (const message of messages) {
      this.preserveMessage(message, 'banned', meta);
    }
    return messages;
  }

  markMessageDeleted(messageId: string, meta: PreservedMeta = {}): ChatMessage | undefined {
    const message = this.messageById.get(messageId);
    if (!message) {
      this.rememberPendingDelete(messageId, meta);
      return undefined;
    }
    if (message.systemEvent) return undefined;
    this.preserveMessage(message, 'deleted', meta);
    return message;
  }

  private rememberPendingDelete(messageId: string, meta: PreservedMeta): void {
    const existing = this.pendingDeletedById.get(messageId);
    if (existing) {
      existing.meta = this.mergePreservedMeta(existing.meta, meta);
      return;
    }
    const pending: PendingDelete = { id: messageId, meta: this.mergePreservedMeta(undefined, meta) };
    this.pendingDeletedById.set(messageId, pending);
    const evicted = this.pendingDeleteOrder.push(pending);
    if (evicted && this.pendingDeletedById.get(evicted.id) === evicted) {
      this.pendingDeletedById.delete(evicted.id);
    }
  }

  private preserveMessage(message: ChatMessage, reason: PreservedReason, meta: PreservedMeta = {}): void {
    if (message.preserved) {
      message.preservedMeta = this.mergePreservedMeta(message.preservedMeta, meta);
      // A ban carries stronger preservation semantics than a prior single-message delete. Do not
      // let a later delete downgrade a ban, but do retain both events' useful metadata.
      if (reason === 'banned' && message.preservedReason !== 'banned') {
        message.preservedReason = 'banned';
        message.preservedAt = Date.now();
      }
      return;
    }
    message.preserved = true;
    message.preservedReason = reason;
    message.preservedMeta = this.mergePreservedMeta(undefined, meta);
    // Retention is about how long the extension promised to preserve a moderation event, not
    // how long ago the original chatter sent the message.
    message.preservedAt = Date.now();

    const evicted = this.preserved.push(message);
    if (evicted) {
      // The 50-cap must actually act on eviction, or nothing ever un-preserves and
      // preserved nodes/objects grow without bound during a ban wave (the target
      // scenario this extension is built for).
      this.unpreserve(evicted);
    }
  }

  private unpreserve(message: ChatMessage): void {
    message.preserved = false;
    message.preservedReason = undefined;
    message.preservedMeta = undefined;
    message.preservedAt = undefined;
    // A preserved message may still be inside both ordinary retention rings. Keep it indexed so
    // another ban/delete can preserve the same row again; only messages already evicted from a
    // normal ring need to leave the indexes now.
    if (!this.isRetainedInNormalRings(message)) this.forget(message);
    this.options.onPreservedEvicted?.(message);
  }

  private isRetainedInNormalRings(message: ChatMessage): boolean {
    return this.global.includes(message)
      && this.perUserQueues.get(message.sender.id)?.includes(message) === true;
  }

  /** Keeps richer moderation details that arrive in a later event, without replacing known
   * details with null/empty placeholders from a thinner payload. */
  private mergePreservedMeta(existing: PreservedMeta | undefined, incoming: PreservedMeta): PreservedMeta {
    const merged: PreservedMeta = { ...existing };
    if (incoming.permanent != null) merged.permanent = incoming.permanent;
    if (incoming.durationMin != null) merged.durationMin = incoming.durationMin;
    if (incoming.bannedBy != null) merged.bannedBy = incoming.bannedBy;
    if (incoming.aiModerated != null) merged.aiModerated = incoming.aiModerated;
    if (incoming.deletedBy != null) merged.deletedBy = incoming.deletedBy;
    if (incoming.violatedRules && incoming.violatedRules.length > 0) {
      merged.violatedRules = incoming.violatedRules;
    }
    return merged;
  }

  /** Cheap TTL sweep (O(<=50); meant to run on a slow interval from bootstrap.ts) so a
   * message doesn't stay preserved forever just because fewer than 50 more
   * preservations happened after it. */
  sweepExpiredPreserved(now: number = Date.now()): void {
    const survivors: ChatMessage[] = [];
    let expiredCount = 0;

    for (const message of this.preserved.toArray()) {
      // `preservedAt` is set on every new preservation. The createdAt fallback only supports
      // objects that predate this field during a running extension upgrade.
      const preservedAt = message.preservedAt ?? Date.parse(message.createdAt);
      const age = Number.isNaN(preservedAt) ? 0 : now - preservedAt;
      if (age > PRESERVED_TTL_MS) {
        expiredCount++;
        this.unpreserve(message);
      } else {
        survivors.push(message);
      }
    }

    if (expiredCount === 0) return;
    this.preserved.clear();
    for (const survivor of survivors) this.preserved.push(survivor);
  }

  getPreserved(): readonly ChatMessage[] {
    return this.preserved.toArray();
  }

  /** Returns preserved evidence for one canonical Kick slug. The returned array is detached from
   * the bounded queue, so callers cannot mutate store membership. */
  getPreservedForSlug(slug: string): ChatMessage[] {
    const normalizedSlug = normalizeChatIdentity(slug);
    if (!normalizedSlug) return [];
    return this.preserved.toArray().filter(
      (message) => normalizeChatIdentity(message.sender.slug) === normalizedSlug,
    );
  }

  /** The native Active Chatters row renders `username` but keeps `slug` only as a React key. Use
   * the exact session-known username solely to recover a canonical slug, and fail closed if the
   * preserved ledger maps that username to more than one slug. */
  resolvePreservedSlugForUsername(username: string): string | null {
    const normalizedUsername = normalizeChatIdentity(username);
    if (!normalizedUsername) return null;

    const slugs = new Map<string, string>();
    for (const message of this.preserved.toArray()) {
      if (normalizeChatIdentity(message.sender.username) !== normalizedUsername) continue;
      const normalizedSlug = normalizeChatIdentity(message.sender.slug);
      if (normalizedSlug) slugs.set(normalizedSlug, message.sender.slug.trim());
    }
    return slugs.size === 1 ? slugs.values().next().value ?? null : null;
  }

  reset(): void {
    this.messageById.clear();
    this.messagesByUserId.clear();
    this.perUserQueues.clear();
    this.global.clear();
    this.preserved.clear();
    this.removedMessageIds.clear();
    this.removedMessageIdOrder.clear();
    this.pendingDeletedById.clear();
    this.pendingDeleteOrder.clear();
    this.nextSeq = 1;
  }
}
