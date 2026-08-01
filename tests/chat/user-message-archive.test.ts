import { describe, expect, it } from 'vitest';
import { ARCHIVE_MAX_AGE_MS, ARCHIVE_MAX_MESSAGES, ARCHIVE_PER_USER_CAP, UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { chatMessage } from '../helpers/chat-message';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

describe('UserMessageArchive', () => {
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
