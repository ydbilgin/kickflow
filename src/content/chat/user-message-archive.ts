import { normalizeChatIdentity, type ChatMessage } from './message-store';

// 30_000 × 240 B = 7.2 MB heap ceiling. At the measured 3.57 msg/s busy rate the count cap binds
// first and covers 30_000 / 3.57 = 8,403 s = 2 h 20 min; at 1.00 msg/s the 3-hour age cap binds
// first at 10,800 records. ARCHIVE_PER_USER_CAP bounds a single spamming account so one user can
// never occupy the whole archive.
export const ARCHIVE_MAX_MESSAGES = 30_000;
export const ARCHIVE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const ARCHIVE_PER_USER_CAP = 500;

// This threshold is what makes compaction amortised O(1) per eviction.
const ARCHIVE_COMPACT_MIN_HEAD = 1024;

/** The message this one answered. Without it a reply reads as a non-sequitur in the list — the
 * archive is the only place that still knows what was being answered once chat has scrolled on. */
export interface ArchivedReply {
  readonly user: string;
  /** Raw content of the answered message, `[emote:...]` tokens intact. */
  readonly text: string;
  readonly messageId: string | null;
}

export interface ArchivedMessage {
  readonly id: string;
  readonly userId: number;
  /** Epoch milliseconds, taken from the message's own createdAt when parseable, else the clock. */
  readonly at: number;
  /** Raw content, `[emote:...]` tokens intact — the renderer parses them, the archive never does. */
  readonly text: string;
  readonly replyTo: ArchivedReply | null;
  /** True once a delete or ban covered this id. Set after insertion; never reverts to false. */
  deleted: boolean;
}

export interface UserMessageArchiveOptions {
  maxMessages?: number;
  maxAgeMs?: number;
  perUserCap?: number;
  /** Injected clock. Defaults to () => Date.now(). Tests MUST be able to control it. */
  now?: () => number;
}

/** Both halves are required: a reply quote with no author, or an author with no quoted text, is
 * noise rather than context, so it is stored as no reply at all. */
function readReplyTo(message: ChatMessage): ArchivedReply | null {
  const context = message.replyContext;
  const user = context?.replyToUser?.trim();
  const text = context?.replyToText;
  if (!user || !text) return null;
  return { user, text, messageId: context?.replyToMessageId ?? null };
}

export class UserMessageArchive {
  private readonly maxMessages: number;
  private readonly maxAgeMs: number;
  private readonly perUserCap: number;
  private readonly now: () => number;
  private records: (ArchivedMessage | null)[] = [];
  private head = 0;
  private liveCount = 0;
  private readonly slotById = new Map<string, number>();
  private readonly recordsById = new Map<string, ArchivedMessage>();
  private readonly recordsByUserId = new Map<number, ArchivedMessage[]>();
  private readonly userIdByName = new Map<string, number>();
  private readonly namesByUserId = new Map<number, Set<string>>();
  private wasTruncated = false;

  constructor(options: UserMessageArchiveOptions = {}) {
    this.maxMessages = Math.max(0, options.maxMessages ?? ARCHIVE_MAX_MESSAGES);
    this.maxAgeMs = options.maxAgeMs ?? ARCHIVE_MAX_AGE_MS;
    this.perUserCap = Math.max(0, options.perUserCap ?? ARCHIVE_PER_USER_CAP);
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns false when the message was rejected (duplicate id, system event, blank text). */
  add(message: ChatMessage): boolean {
    if (message.systemEvent || this.recordsById.has(message.id) || message.content.trim() === '') return false;

    const parsedAt = Date.parse(message.createdAt);
    const record: ArchivedMessage = {
      id: message.id,
      userId: message.sender.id,
      at: Number.isFinite(parsedAt) ? parsedAt : this.now(),
      text: message.content,
      replyTo: readReplyTo(message),
      deleted: false,
    };
    this.records.push(record);
    this.slotById.set(record.id, this.records.length - 1);
    this.liveCount += 1;
    this.recordsById.set(record.id, record);
    let userRecords = this.recordsByUserId.get(record.userId);
    if (!userRecords) {
      userRecords = [];
      this.recordsByUserId.set(record.userId, userRecords);
    }
    userRecords.push(record);
    this.indexSenderName(record.userId, message.sender.slug);
    this.indexSenderName(record.userId, message.sender.username);

    this.drainExpiredFromHead();
    this.enforcePerUserCap(record.userId);
    this.enforceGlobalCap();
    return true;
  }

  /** Returns the archived user's ID for a case-insensitive slug or username. */
  getUserIdByName(name: string): number | null {
    const key = normalizeChatIdentity(name);
    if (!key) return null;
    return this.userIdByName.get(key) ?? null;
  }

  /** Oldest → newest. Returns a fresh array; callers must never mutate internal state. */
  getByUserId(userId: number): ArchivedMessage[] {
    const records = this.recordsByUserId.get(userId);
    return records ? records.map((record) => ({ ...record })) : [];
  }

  /** No-op when the id is unknown. Idempotent. */
  markDeleted(messageId: string): void {
    const record = this.recordsById.get(messageId);
    if (record) record.deleted = true;
  }

  /** Drops every record older than maxAgeMs. Safe to call at any time. */
  sweepExpired(): void {
    const cutoff = this.now() - this.maxAgeMs;
    let slot = 0;
    while (slot < this.records.length) {
      const record = this.records[slot];
      if (!record) {
        slot += 1;
        continue;
      }
      if (record.at >= cutoff) {
        slot += 1;
        continue;
      }
      // Rebase the scan slot when eviction compacts the leading prefix.
      slot = Math.max(0, slot - this.evict(record) + 1);
    }
  }

  /** True once ANY record has been evicted for ANY reason (age, global cap, per-user cap). */
  get truncated(): boolean {
    return this.wasTruncated;
  }

  get size(): number {
    return this.liveCount;
  }

  /** Test-only getter for the compaction invariant test. */
  get internalSlotCount(): number {
    return this.records.length;
  }

  /** Full reset, including `truncated`. */
  clear(): void {
    this.records = [];
    this.head = 0;
    this.liveCount = 0;
    this.slotById.clear();
    this.recordsById.clear();
    this.recordsByUserId.clear();
    this.userIdByName.clear();
    this.namesByUserId.clear();
    this.wasTruncated = false;
  }

  private indexSenderName(userId: number, name: string): void {
    const key = normalizeChatIdentity(name);
    if (!key) return;

    this.userIdByName.set(key, userId);
    let names = this.namesByUserId.get(userId);
    if (!names) {
      names = new Set<string>();
      this.namesByUserId.set(userId, names);
    }
    names.add(key);
  }

  private removeUserNameIndex(userId: number): void {
    const names = this.namesByUserId.get(userId);
    if (!names) return;
    for (const name of names) {
      if (this.userIdByName.get(name) === userId) this.userIdByName.delete(name);
    }
    this.namesByUserId.delete(userId);
  }

  private drainExpiredFromHead(): void {
    const cutoff = this.now() - this.maxAgeMs;
    // An out-of-order createdAt can survive up to one sweep interval past its age cap instead of
    // dying on the next add. The periodic full sweep bounds this deliberate delay.
    while (this.head < this.records.length) {
      const record = this.records[this.head];
      if (!record) {
        this.head += 1;
        continue;
      }
      if (record.at >= cutoff) return;
      this.evict(record);
    }
  }

  private enforcePerUserCap(userId: number): void {
    const records = this.recordsByUserId.get(userId);
    if (!records) return;
    while (records.length > this.perUserCap) {
      const oldest = records[0];
      if (!oldest) return;
      this.evict(oldest);
    }
  }

  private enforceGlobalCap(): void {
    while (this.liveCount > this.maxMessages) {
      const oldest = this.records[this.head];
      if (!oldest) return;
      this.evict(oldest);
    }
  }

  private evict(record: ArchivedMessage): number {
    const slot = this.slotById.get(record.id);
    if (slot === undefined || this.records[slot] !== record) return 0;
    this.records[slot] = null;
    this.slotById.delete(record.id);
    this.recordsById.delete(record.id);

    const userRecords = this.recordsByUserId.get(record.userId);
    if (userRecords) {
      const userIndex = userRecords.indexOf(record);
      if (userIndex >= 0) userRecords.splice(userIndex, 1);
      if (userRecords.length === 0) {
        this.recordsByUserId.delete(record.userId);
        this.removeUserNameIndex(record.userId);
      }
    }
    this.liveCount -= 1;
    this.wasTruncated = true;
    return this.advanceHeadAndCompact();
  }

  private advanceHeadAndCompact(): number {
    while (this.head < this.records.length && this.records[this.head] === null) {
      this.head += 1;
    }
    if (this.head < ARCHIVE_COMPACT_MIN_HEAD || this.head * 2 < this.records.length) return 0;

    const oldHead = this.head;
    this.records = this.records.slice(oldHead);
    for (const [id, slot] of this.slotById) {
      this.slotById.set(id, slot - oldHead);
    }
    this.head = 0;
    return oldHead;
  }
}
