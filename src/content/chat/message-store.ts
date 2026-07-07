export interface ChatBadge {
  type?: string;
  text?: string;
  count?: number;
  imageUrl?: string;
}

export interface ChatMessageSender {
  id: number;
  username: string;
  slug: string;
  identity: {
    color: string;
    badges: ChatBadge[];
    badgesV2: ChatBadge[];
  };
}

export type PreservedReason = 'banned' | 'deleted';

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
  /** Deletes: AI-flagged rules (e.g. ["hate"]). */
  violatedRules?: string[];
}

export interface ChatMessage {
  id: string;
  chatroomId: number;
  content: string;
  type: string;
  createdAt: string;
  sender: ChatMessageSender;
  preserved: boolean;
  preservedReason?: PreservedReason;
  preservedMeta?: PreservedMeta;
}

const GLOBAL_CAPACITY = 500;
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

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

export interface ChatIntegrityStoreOptions {
  /** Called whenever a preserved (banned/deleted) message stops being preserved — either
   * evicted by the 50-entry preserved cap or expired by the TTL sweep. */
  onPreservedEvicted?: (message: ChatMessage) => void;
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

  constructor(private readonly options: ChatIntegrityStoreOptions = {}) {}

  addMessage(message: ChatMessage): void {
    if (this.messageById.has(message.id)) return;
    this.messageById.set(message.id, message);
    this.indexByUser(message);

    let perUserQueue = this.perUserQueues.get(message.sender.id);
    if (!perUserQueue) {
      perUserQueue = new LimitedQueue<ChatMessage>(PER_USER_CAPACITY);
      this.perUserQueues.set(message.sender.id, perUserQueue);
    }
    const evictedFromUser = perUserQueue.push(message);
    if (evictedFromUser) this.forget(evictedFromUser);

    const evictedGlobally = this.global.push(message);
    if (evictedGlobally) this.forget(evictedGlobally);
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
    const ids = this.messagesByUserId.get(message.sender.id);
    if (ids) {
      ids.delete(message.id);
      if (ids.size === 0) this.messagesByUserId.delete(message.sender.id);
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

  markUserBanned(userId: number, meta: PreservedMeta = {}): ChatMessage[] {
    const messages = this.getMessagesByUserId(userId);
    for (const message of messages) {
      this.preserveMessage(message, 'banned', meta);
    }
    return messages;
  }

  markMessageDeleted(messageId: string, meta: PreservedMeta = {}): ChatMessage | undefined {
    const message = this.messageById.get(messageId);
    if (!message) return undefined;
    this.preserveMessage(message, 'deleted', meta);
    return message;
  }

  private preserveMessage(message: ChatMessage, reason: PreservedReason, meta: PreservedMeta = {}): void {
    if (message.preserved) return;
    message.preserved = true;
    message.preservedReason = reason;
    message.preservedMeta = meta;

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
    this.forget(message);
    this.options.onPreservedEvicted?.(message);
  }

  /** Cheap TTL sweep (O(<=50); meant to run on a slow interval from bootstrap.ts) so a
   * message doesn't stay preserved forever just because fewer than 50 more
   * preservations happened after it. */
  sweepExpiredPreserved(now: number = Date.now()): void {
    const survivors: ChatMessage[] = [];
    let expiredCount = 0;

    for (const message of this.preserved.toArray()) {
      const createdAtMs = Date.parse(message.createdAt);
      const age = Number.isNaN(createdAtMs) ? 0 : now - createdAtMs;
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

  reset(): void {
    this.messageById.clear();
    this.messagesByUserId.clear();
    this.perUserQueues.clear();
    this.global.clear();
    this.preserved.clear();
  }
}
