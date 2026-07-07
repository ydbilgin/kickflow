import { describe, expect, it, vi } from 'vitest';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';

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
