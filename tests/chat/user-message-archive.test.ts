import { describe, expect, it } from 'vitest';
import { ARCHIVE_MAX_AGE_MS, ARCHIVE_MAX_MESSAGES, ARCHIVE_PER_USER_CAP, UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { chatMessage } from '../helpers/chat-message';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const INDEXED_USER_ID = 61;
const INDEXED_USER_NAME = 'Cahitc61';
const OTHER_USER_ID = 62;
const OTHER_USER_NAME = 'other-user';

function indexedMessage(
  id: string,
  userId = INDEXED_USER_ID,
  name = INDEXED_USER_NAME,
  createdAt = new Date(NOW).toISOString(),
) {
  const base = chatMessage(id, { userId, createdAt });
  return {
    ...base,
    sender: {
      ...base.sender,
      slug: name.toLowerCase(),
      username: name,
    },
  };
}

describe('UserMessageArchive', () => {
  it('resolves sender slugs and usernames case-insensitively', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const base = chatMessage('indexed-name', {
      userId: INDEXED_USER_ID,
      createdAt: new Date(NOW).toISOString(),
    });

    archive.add({
      ...base,
      sender: {
        ...base.sender,
        slug: 'archive-slug',
        username: INDEXED_USER_NAME,
      },
    });

    expect(archive.getUserIdByName('archive-slug')).toBe(INDEXED_USER_ID);
    expect(archive.getUserIdByName('cahitc61')).toBe(INDEXED_USER_ID);
    expect(archive.getUserIdByName(' Cahitc61 ')).toBe(INDEXED_USER_ID);
  });

  it('returns null for an unknown name', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    archive.add(indexedMessage('known-name'));

    expect(archive.getUserIdByName('unknown-name')).toBeNull();
  });

  it('removes the name index when the per-user cap evicts every record', () => {
    const archive = new UserMessageArchive({ perUserCap: 0, now: () => NOW });

    archive.add(indexedMessage('per-user-eviction'));

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('removes the name index when the age cap evicts every record', () => {
    let now = 0;
    const archive = new UserMessageArchive({ maxAgeMs: 5, now: () => now });

    archive.add(indexedMessage('age-eviction', INDEXED_USER_ID, INDEXED_USER_NAME, new Date(0).toISOString()));
    now = 6;
    archive.sweepExpired();

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('removes the name index when the global cap evicts every record', () => {
    const archive = new UserMessageArchive({ maxMessages: 1, now: () => NOW });

    archive.add(indexedMessage('global-eviction'));
    archive.add(indexedMessage('global-eviction-other', OTHER_USER_ID, OTHER_USER_NAME));

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('clears the name index', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    archive.add(indexedMessage('clear-index'));
    archive.clear();

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('stores a normal message and returns it for its user', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const message = chatMessage('m1', {
      userId: 7,
      content: 'hello',
      createdAt: new Date(NOW).toISOString(),
    });

    expect(archive.add(message)).toBe(true);
    expect(archive.getByUserId(7)).toEqual([{
      id: 'm1', userId: 7, at: NOW, text: 'hello', replyTo: null, deleted: false,
    }]);
  });

  it('returns false and stores nothing for a system event', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const message = chatMessage('event', {
      systemEvent: { kind: 'subscription', username: 'user1', months: 1 },
    });

    expect(archive.add(message)).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('returns false for a duplicate id and keeps one record', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    expect(archive.add(chatMessage('same', { createdAt: new Date(NOW).toISOString() }))).toBe(true);
    expect(archive.add(chatMessage('same', { content: 'replacement', createdAt: new Date(NOW).toISOString() }))).toBe(false);
    expect(archive.size).toBe(1);
  });

  it('returns false for whitespace-only content', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    expect(archive.add(chatMessage('blank', { content: ' \n\t ' }))).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('uses parseable createdAt and falls back to the injected clock otherwise', () => {
    const fallbackAt = NOW + 1234;
    const archive = new UserMessageArchive({ now: () => fallbackAt });
    const parsedAt = NOW - 5000;

    archive.add(chatMessage('parsed', { createdAt: new Date(parsedAt).toISOString() }));
    archive.add(chatMessage('fallback', { createdAt: 'not-a-date' }));

    expect(archive.getByUserId(1).map(({ id, at }) => ({ id, at }))).toEqual([
      { id: 'parsed', at: parsedAt },
      { id: 'fallback', at: fallbackAt },
    ]);
  });

  it('returns three interleaved users in arrival order, oldest first', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('u1-a', { userId: 1, createdAt }));
    archive.add(chatMessage('u2-a', { userId: 2, createdAt }));
    archive.add(chatMessage('u1-b', { userId: 1, createdAt }));
    archive.add(chatMessage('u3-a', { userId: 3, createdAt }));
    archive.add(chatMessage('u1-c', { userId: 1, createdAt }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['u1-a', 'u1-b', 'u1-c']);
    expect(archive.getByUserId(2).map(({ id }) => id)).toEqual(['u2-a']);
    expect(archive.getByUserId(3).map(({ id }) => id)).toEqual(['u3-a']);
  });

  it('returns a copy whose array mutation does not affect the next call', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('copy', { createdAt: new Date(NOW).toISOString() }));

    const first = archive.getByUserId(1);
    first.pop();

    expect(archive.getByUserId(1)).toHaveLength(1);
  });

  it('enforces the per-user cap without evicting other users', () => {
    const archive = new UserMessageArchive({
      now: () => NOW,
      perUserCap: 3,
      maxMessages: ARCHIVE_MAX_MESSAGES,
      maxAgeMs: ARCHIVE_MAX_AGE_MS,
    });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('u1-1', { userId: 1, createdAt }));
    archive.add(chatMessage('u2-1', { userId: 2, createdAt }));
    archive.add(chatMessage('u1-2', { userId: 1, createdAt }));
    archive.add(chatMessage('u1-3', { userId: 1, createdAt }));
    archive.add(chatMessage('u1-4', { userId: 1, createdAt }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['u1-2', 'u1-3', 'u1-4']);
    expect(archive.getByUserId(2).map(({ id }) => id)).toEqual(['u2-1']);
  });

  it('enforces the global cap and removes the evicted record from its user index', () => {
    const archive = new UserMessageArchive({ maxMessages: 3, now: () => NOW });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('oldest', { userId: 10, createdAt }));
    archive.add(chatMessage('second', { userId: 20, createdAt }));
    archive.add(chatMessage('third', { userId: 30, createdAt }));
    archive.add(chatMessage('newest', { userId: 40, createdAt }));

    expect(archive.size).toBe(3);
    expect(archive.getByUserId(10)).toEqual([]);
    expect(archive.getByUserId(20).map(({ id }) => id)).toEqual(['second']);
    expect(archive.getByUserId(40).map(({ id }) => id)).toEqual(['newest']);
  });

  it('keeps the slot array bounded during sustained global-cap churn', () => {
    const createdAt = new Date(NOW).toISOString();
    const archive = new UserMessageArchive({ maxMessages: 2_000, now: () => NOW });

    for (let index = 0; index < 50_000; index += 1) {
      archive.add(chatMessage(`churn-${index}`, { userId: index % 100, createdAt }));
    }

    expect(archive.size).toBe(2_000);
    expect(archive.internalSlotCount).toBeLessThanOrEqual(2 * 2_000);
  });

  it('preserves per-user order through compaction', () => {
    const archive = new UserMessageArchive({
      maxMessages: 100,
      perUserCap: 100,
      now: () => NOW,
    });

    for (let index = 0; index < 5_000; index += 1) {
      archive.add(chatMessage(`ordered-${index}`, {
        userId: 1,
        createdAt: new Date(NOW + index).toISOString(),
      }));
    }

    expect(archive.getByUserId(1).map(({ id, at }) => ({ id, at }))).toEqual(
      Array.from({ length: 100 }, (_, offset) => {
        const index = 4_900 + offset;
        return { id: `ordered-${index}`, at: NOW + index };
      }),
    );
  });

  it('drains expired records from the head when adding a message', () => {
    let now = 0;
    const archive = new UserMessageArchive({ maxAgeMs: 5, now: () => now });

    for (let index = 0; index < 10; index += 1) {
      archive.add(chatMessage(`age-${index}`, { createdAt: new Date(index).toISOString() }));
    }

    now = 10;
    archive.add(chatMessage('age-next', { createdAt: new Date(now).toISOString() }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual([
      'age-5', 'age-6', 'age-7', 'age-8', 'age-9', 'age-next',
    ]);
    expect(archive.size).toBe(6);
  });

  it('leaves an out-of-order age straggler for the full sweep', () => {
    let now = NOW;
    const archive = new UserMessageArchive({ maxAgeMs: 1_000, now: () => now });

    archive.add(chatMessage('new-1', { createdAt: new Date(NOW).toISOString() }));
    archive.add(chatMessage('new-2', { createdAt: new Date(NOW).toISOString() }));
    archive.add(chatMessage('straggler', { createdAt: new Date(NOW - 10_000).toISOString() }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['new-1', 'new-2', 'straggler']);

    archive.sweepExpired();

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['new-1', 'new-2']);
  });

  it('leaves no index residue after heavy churn', () => {
    const createdAt = new Date(NOW).toISOString();
    const archive = new UserMessageArchive({
      maxMessages: 3,
      perUserCap: 2,
      now: () => NOW,
    });

    for (let index = 0; index < 100; index += 1) {
      archive.add(chatMessage(`indexed-${index}`, {
        userId: (index % 5) + 1,
        createdAt,
      }));
    }

    const internal = archive as unknown as {
      records: Array<{ id: string } | null>;
      slotById: Map<string, number>;
      recordsById: Map<string, unknown>;
      recordsByUserId: Map<number, unknown[]>;
    };
    for (const userId of [1, 2, 3, 4, 5]) {
      for (const record of archive.getByUserId(userId)) {
        expect(archive.add(chatMessage(record.id, { userId, createdAt }))).toBe(false);
        const slot = internal.slotById.get(record.id);
        expect(slot).toBeDefined();
        expect(internal.records[slot!]?.id).toBe(record.id);
        expect(internal.recordsById.has(record.id)).toBe(true);
      }
    }

    expect(archive.getByUserId(1)).toEqual([]);
    expect(internal.recordsByUserId.has(1)).toBe(false);
    expect(internal.recordsById.has('indexed-0')).toBe(false);
    expect(internal.slotById.has('indexed-0')).toBe(false);
    expect(archive.add(chatMessage('indexed-0', { userId: 1, createdAt }))).toBe(true);
  });

  it('sweeps records older than the age cap while keeping a newer record', () => {
    let now = 1000;
    const archive = new UserMessageArchive({ maxAgeMs: 1000, now: () => now });
    archive.add(chatMessage('old', { createdAt: new Date(0).toISOString() }));
    archive.add(chatMessage('new', { createdAt: new Date(1000).toISOString() }));
    now = 1501;

    archive.sweepExpired();

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['new']);
  });

  it('tracks truncation and resets it on clear', () => {
    const archive = new UserMessageArchive({ maxMessages: 1, now: () => NOW });
    expect(archive.truncated).toBe(false);
    archive.add(chatMessage('first', { createdAt: new Date(NOW).toISOString() }));
    archive.add(chatMessage('second', { createdAt: new Date(NOW).toISOString() }));

    expect(archive.truncated).toBe(true);
    archive.clear();
    expect(archive.truncated).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('keeps the answered message so a reply is not archived as a non-sequitur', () => {
    const archive = new UserMessageArchive();
    archive.add(chatMessage('m1', {
      content: 'bende de öyleydi',
      replyContext: { replyToUser: 'keperiks', replyToText: 'ben 3 ayda topladım', replyToMessageId: 'src' },
    }));

    expect(archive.getByUserId(1)[0]?.replyTo)
      .toEqual({ user: 'keperiks', text: 'ben 3 ayda topladım', messageId: 'src' });
  });

  it('stores no reply when either half of the quote is missing', () => {
    const archive = new UserMessageArchive();
    archive.add(chatMessage('noUser', { replyContext: { replyToUser: '  ', replyToText: 'orphan quote' } }));
    archive.add(chatMessage('noText', { replyContext: { replyToUser: 'keperiks', replyToText: null } }));

    expect(archive.getByUserId(1).map((record) => record.replyTo)).toEqual([null, null]);
  });

  it('marks a message deleted idempotently and ignores unknown ids', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('delete-me', { createdAt: new Date(NOW).toISOString() }));

    expect(archive.getByUserId(1)[0]?.deleted).toBe(false);
    archive.markDeleted('delete-me');
    archive.markDeleted('delete-me');
    archive.markDeleted('unknown');

    expect(archive.getByUserId(1)[0]?.deleted).toBe(true);
    expect(archive.size).toBe(1);
  });
});
