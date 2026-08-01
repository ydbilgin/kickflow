import type { ChatMessage } from './message-store';

// 30_000 × 240 B = 7.2 MB heap ceiling. At the measured 3.57 msg/s busy rate the count cap binds
// first and covers 30_000 / 3.57 = 8,403 s = 2 h 20 min; at 1.00 msg/s the 3-hour age cap binds
// first at 10,800 records. ARCHIVE_PER_USER_CAP bounds a single spamming account so one user can
// never occupy the whole archive.
export const ARCHIVE_MAX_MESSAGES = 30_000;
export const ARCHIVE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const ARCHIVE_PER_USER_CAP = 500;

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
  private readonly records: ArchivedMessage[] = [];
  private readonly recordsById = new Map<string, ArchivedMessage>();
  private readonly recordsByUserId = new Map<number, ArchivedMessage[]>();
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
    this.recordsById.set(record.id, record);
    let userRecords = this.recordsByUserId.get(record.userId);
    if (!userRecords) {
      userRecords = [];
      this.recordsByUserId.set(record.userId, userRecords);
    }
    userRecords.push(record);

    this.evictExpired();
    this.enforcePerUserCap(record.userId);
    this.enforceGlobalCap();
    return true;
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
    this.evictExpired();
  }

  /** True once ANY record has been evicted for ANY reason (age, global cap, per-user cap). */
  get truncated(): boolean {
    return this.wasTruncated;
  }

  get size(): number {
    return this.records.length;
  }

  /** Full reset, including `truncated`. */
  clear(): void {
    this.records.length = 0;
    this.recordsById.clear();
    this.recordsByUserId.clear();
    this.wasTruncated = false;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.maxAgeMs;
    for (const record of [...this.records]) {
      if (record.at < cutoff) this.evict(record);
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
    while (this.records.length > this.maxMessages) {
      const oldest = this.records[0];
      if (!oldest) return;
      this.evict(oldest);
    }
  }

  private evict(record: ArchivedMessage): void {
    const globalIndex = this.records.indexOf(record);
    if (globalIndex < 0) return;
    this.records.splice(globalIndex, 1);
    this.recordsById.delete(record.id);

    const userRecords = this.recordsByUserId.get(record.userId);
    if (userRecords) {
      const userIndex = userRecords.indexOf(record);
      if (userIndex >= 0) userRecords.splice(userIndex, 1);
      if (userRecords.length === 0) this.recordsByUserId.delete(record.userId);
    }
    this.wasTruncated = true;
  }
}
