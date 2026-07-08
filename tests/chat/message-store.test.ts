import { describe, expect, it, vi } from 'vitest';
import { ChatIntegrityStore, mergeIdentityBadges, type ChatMessage } from '../../src/content/chat/message-store';

function message(id: string, userId = 1, createdAt = new Date().toISOString()): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content: id,
    type: 'message',
    createdAt,
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

describe('ChatIntegrityStore', () => {
  it('dedupes by id and evicts non-preserved messages from per-user/global rings', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('same', 1));
    store.addMessage(message('same', 1));
    expect(store.messageById.size).toBe(1);

    for (let i = 0; i < 31; i++) store.addMessage(message(`u-${i}`, 2));
    expect(store.getMessageById('u-0')).toBeUndefined();
    expect(store.getMessageById('u-30')).toBeDefined();

    for (let i = 0; i < 501; i++) store.addMessage(message(`g-${i}`, 1000 + i));
    expect(store.getMessageById('same')).toBeUndefined();
  });

  it('exempts preserved messages from normal eviction', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('keep', 1));
    store.markUserBanned(1);

    for (let i = 0; i < 501; i++) store.addMessage(message(`later-${i}`, 100 + i));

    expect(store.getMessageById('keep')?.preserved).toBe(true);
  });

  it('caps preserved messages at 50 and evicts the oldest preservation', () => {
    const onPreservedEvicted = vi.fn();
    const store = new ChatIntegrityStore({ onPreservedEvicted });

    for (let i = 0; i < 51; i++) {
      store.addMessage(message(`p-${i}`, i));
      store.markUserBanned(i);
    }

    expect(store.getPreserved()).toHaveLength(50);
    expect(store.getMessageById('p-0')).toBeUndefined();
    expect(onPreservedEvicted).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-0' }));
  });

  it('sweeps expired preserved messages and keeps fresh ones', () => {
    const onPreservedEvicted = vi.fn();
    const store = new ChatIntegrityStore({ onPreservedEvicted });
    const now = Date.now();
    store.addMessage(message('old', 1, new Date(now - 11 * 60 * 1000).toISOString()));
    store.addMessage(message('fresh', 2, new Date(now).toISOString()));
    store.markUserBanned(1);
    store.markUserBanned(2);

    store.sweepExpiredPreserved(now);

    expect(store.getMessageById('old')).toBeUndefined();
    expect(store.getMessageById('fresh')?.preserved).toBe(true);
    expect(onPreservedEvicted).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
  });

  it('marks tracked user messages as banned with preservation metadata', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('a', 7));
    store.addMessage(message('b', 7));

    const preserved = store.markUserBanned(7, { permanent: false, durationMin: 5, bannedBy: 'mod' });

    expect(preserved.map((item) => item.id)).toEqual(['a', 'b']);
    expect(store.getMessageById('a')).toMatchObject({
      preserved: true,
      preservedReason: 'banned',
      preservedMeta: { permanent: false, durationMin: 5, bannedBy: 'mod' },
    });
  });
});

describe('mergeIdentityBadges', () => {
  it('keeps role badges (from `badges`) even when `badges_v2` is non-empty — the core regression', () => {
    const merged = mergeIdentityBadges({
      badges: [{ type: 'moderator', text: 'Moderator', sortOrder: 4 }],
      badgesV2: [{ name: 'level', imageUrl: 'https://ext.cdn.kick.com/x.png', level: 33, sortOrder: 1 }],
    });

    expect(merged).toHaveLength(2);
    expect(merged.some((b) => b.type === 'moderator')).toBe(true);
    expect(merged.some((b) => b.name === 'level')).toBe(true);
  });

  it('sorts the merged result by sortOrder ascending', () => {
    const merged = mergeIdentityBadges({
      badges: [{ type: 'moderator', sortOrder: 4 }],
      badgesV2: [{ name: 'level', sortOrder: 1 }],
    });

    expect(merged.map((b) => b.type ?? b.name)).toEqual(['level', 'moderator']);
  });

  it('does not duplicate a badge present in both arrays under the same type/count key', () => {
    const merged = mergeIdentityBadges({
      badges: [{ type: 'subscriber', count: 14, sortOrder: 9 }],
      badgesV2: [{ type: 'subscriber', count: 14, sortOrder: 9 }],
    });

    expect(merged).toHaveLength(1);
  });

  it('keeps a v2-only badge (only `name`) and an old-array-only badge (only `type`) both', () => {
    const merged = mergeIdentityBadges({
      badges: [{ type: 'founder', text: 'Founder', sortOrder: 6 }],
      badgesV2: [{ name: 'GoldenK', imageUrl: 'https://ext.cdn.kick.com/golden.png', sortOrder: 2 }],
    });

    expect(merged).toHaveLength(2);
    expect(merged.find((b) => b.type === 'founder')).toBeDefined();
    expect(merged.find((b) => b.name === 'GoldenK')).toBeDefined();
  });
});
