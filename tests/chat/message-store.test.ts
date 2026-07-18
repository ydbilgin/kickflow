import { describe, expect, it, vi } from 'vitest';
import { ChatIntegrityStore, GLOBAL_CAPACITY, mergeIdentityBadges, type ChatMessage } from '../../src/content/chat/message-store';
import { MAX_NON_PRESERVED_NODES_PAUSED } from '../../src/content/chat/dom-window';

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
    expect(store.addMessage(message('same', 1))).toBe(true);
    expect(store.addMessage(message('same', 1))).toBe(false);
    expect(store.messageById.size).toBe(1);

    for (let i = 0; i < 31; i++) store.addMessage(message(`u-${i}`, 2));
    expect(store.getMessageById('u-0')).toBeUndefined();
    expect(store.getMessageById('u-30')).toBeDefined();

    for (let i = 0; i < GLOBAL_CAPACITY + 1; i++) store.addMessage(message(`g-${i}`, 1000 + i));
    expect(store.getMessageById('same')).toBeUndefined();
  });

  it('releases empty per-user queues as unique chatters leave the global ring', () => {
    const store = new ChatIntegrityStore();
    for (let i = 0; i < GLOBAL_CAPACITY + 1; i++) {
      store.addMessage(message(`unique-${i}`, 10_000 + i));
    }

    const queues = (store as unknown as { perUserQueues: Map<number, unknown> }).perUserQueues;
    expect(queues.size).toBe(GLOBAL_CAPACITY);
    expect(queues.has(10_000)).toBe(false);
  });

  it('does not resurrect an explicitly removed message when history replays its id', () => {
    const store = new ChatIntegrityStore();
    const original = message('deleted', 7);
    store.addMessage(original);
    store.removeMessage(original.id);

    expect(store.getMessageById(original.id)).toBeUndefined();
    expect(store.addMessage(message('deleted', 7))).toBe(false);
    expect(store.getMessageById(original.id)).toBeUndefined();
  });

  it('applies a live delete that arrives before the initial history copy', () => {
    const store = new ChatIntegrityStore();
    expect(store.markMessageDeleted('history-race', { deletedBy: 'mod', aiModerated: false })).toBeUndefined();

    const delayedHistoryCopy = message('history-race', 7);
    expect(store.addMessage(delayedHistoryCopy)).toBe(true);
    expect(store.getMessageById(delayedHistoryCopy.id)).toMatchObject({
      preserved: true,
      preservedReason: 'deleted',
      preservedMeta: { deletedBy: 'mod', aiModerated: false },
    });
    expect(store.getPreserved()).toContain(delayedHistoryCopy);
  });

  it('stores host events for normal trimming but never indexes, bans, or preserves them as user messages', () => {
    const store = new ChatIntegrityStore();
    const event = message('host:1:user:1', 7);
    event.systemEvent = {
      kind: 'host',
      username: 'user',
      numberViewers: 16,
      optionalMessage: null,
    };
    store.addMessage(event);
    store.addMessage(message('regular', 7));

    expect(store.getMessageById(event.id)).toBe(event);
    expect(store.getMessagesByUserId(7).map(({ id }) => id)).toEqual(['regular']);
    expect(store.markUserBanned(7).map(({ id }) => id)).toEqual(['regular']);
    expect(store.markMessageDeleted(event.id)).toBeUndefined();
    expect(event.preserved).toBe(false);
    expect(store.getPreserved().map(({ id }) => id)).toEqual(['regular']);
  });

  it('exempts preserved messages from normal eviction', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('keep', 1));
    store.markUserBanned(1);

    for (let i = 0; i < GLOBAL_CAPACITY + 1; i++) store.addMessage(message(`later-${i}`, 100 + i));

    expect(store.getMessageById('keep')?.preserved).toBe(true);
  });

  it('caps preserved messages at 50 and returns the oldest preservation to normal retention', () => {
    const onPreservedEvicted = vi.fn();
    const store = new ChatIntegrityStore({ onPreservedEvicted });

    for (let i = 0; i < 51; i++) {
      store.addMessage(message(`p-${i}`, i));
      store.markUserBanned(i);
    }

    expect(store.getPreserved()).toHaveLength(50);
    expect(store.getMessageById('p-0')).toMatchObject({ preserved: false });
    expect(onPreservedEvicted).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-0' }));
  });

  it('starts the preservation TTL when moderation happens, not when the message was sent', () => {
    const onPreservedEvicted = vi.fn();
    const store = new ChatIntegrityStore({ onPreservedEvicted });
    const now = Date.now();
    store.addMessage(message('old', 1, new Date(now - 11 * 60 * 1000).toISOString()));
    store.addMessage(message('fresh', 2, new Date(now).toISOString()));
    store.markUserBanned(1);
    store.markUserBanned(2);

    store.sweepExpiredPreserved(now);

    expect(store.getMessageById('old')?.preserved).toBe(true);
    expect(store.getMessageById('fresh')?.preserved).toBe(true);
    expect(onPreservedEvicted).not.toHaveBeenCalled();

    store.sweepExpiredPreserved(now + 10 * 60 * 1000 + 1);

    expect(store.getMessageById('old')).toMatchObject({ preserved: false });
    expect(store.getMessageById('fresh')).toMatchObject({ preserved: false });
    expect(onPreservedEvicted).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
  });

  it('can re-preserve a message whose preservation expired while it remains in normal retention', () => {
    const store = new ChatIntegrityStore();
    const now = Date.now();
    store.addMessage(message('retain', 1, new Date(now - 20 * 60 * 1000).toISOString()));
    store.markMessageDeleted('retain');

    store.sweepExpiredPreserved(now + 10 * 60 * 1000 + 1);

    expect(store.getMessageById('retain')).toMatchObject({ preserved: false });
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod' });
    expect(store.getMessageById('retain')).toMatchObject({
      preserved: true,
      preservedReason: 'banned',
      preservedMeta: expect.objectContaining({ permanent: true, bannedBy: 'mod' }),
    });
  });

  it('upgrades a deleted preservation when a later ban arrives without losing deletion metadata', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('upgraded', 1));
    store.markMessageDeleted('upgraded', { deletedBy: 'delete-mod', aiModerated: false });
    store.markUserBanned(1, { permanent: true, bannedBy: 'ban-mod' });

    expect(store.getPreserved()).toHaveLength(1);
    expect(store.getMessageById('upgraded')).toMatchObject({
      preserved: true,
      preservedReason: 'banned',
      preservedMeta: {
        deletedBy: 'delete-mod',
        aiModerated: false,
        permanent: true,
        bannedBy: 'ban-mod',
      },
    });
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

  it('queries preserved entries by exact normalized canonical slug', () => {
    const store = new ChatIntegrityStore();
    const first = message('first', 1);
    first.sender.slug = '  Canonical-Slug  ';
    first.sender.username = 'Display_Name';
    const second = message('second', 2);
    second.sender.slug = 'other-slug';
    second.sender.username = 'canonical-slug';
    store.addMessage(first);
    store.addMessage(second);
    store.markUserBanned(1);
    store.markUserBanned(2);

    expect(store.getPreservedForSlug(' canonical-SLUG ')).toEqual([first]);
    expect(store.getPreservedForSlug('display_name')).toEqual([]);
    expect(store.getPreservedForSlug('   ')).toEqual([]);
  });

  it('recovers a slug from an exact normalized preserved username only when unambiguous', () => {
    const store = new ChatIntegrityStore();
    const first = message('first', 1);
    first.sender.username = 'DevletSah_Ozcan';
    first.sender.slug = 'devletsah-ozcan';
    store.addMessage(first);
    store.markUserBanned(1);

    expect(store.resolvePreservedSlugForUsername('  devletsah_ozcan ')).toBe('devletsah-ozcan');
    expect(store.resolvePreservedSlugForUsername('devletsah-ozcan')).toBeNull();

    const collision = message('collision', 2);
    collision.sender.username = 'DEVLETSAH_OZCAN';
    collision.sender.slug = 'different-slug';
    store.addMessage(collision);
    store.markUserBanned(2);
    expect(store.resolvePreservedSlugForUsername('devletsah_ozcan')).toBeNull();
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

  it('suppresses only badges_v2 entries explicitly marked unselected', () => {
    const merged = mergeIdentityBadges({
      badges: [{ type: 'subscriber', count: 1, sortOrder: 9 }],
      badgesV2: [
        { name: 'level', level: 34, selected: false, sortOrder: 1 },
        { name: 'GoldenK', selected: true, sortOrder: 2 },
        { name: 'legacy-special', sortOrder: 3 },
      ],
    });

    expect(merged.map((badge) => badge.type ?? badge.name)).toEqual([
      'GoldenK',
      'legacy-special',
      'subscriber',
    ]);
  });

  it('suppresses role badges explicitly marked inactive while keeping legacy entries', () => {
    const merged = mergeIdentityBadges({
      badges: [
        { type: 'moderator', active: true, sortOrder: 4 },
        { type: 'sub_gifter', count: 1, active: false, sortOrder: 8 },
        { type: 'subscriber', count: 5, active: false, sortOrder: 9 },
        { type: 'founder', sortOrder: 7 },
      ],
      badgesV2: [],
    });

    expect(merged.map((badge) => badge.type)).toEqual(['moderator', 'founder']);
  });
});

describe('GLOBAL_CAPACITY vs Mode A paused DOM cap', () => {
  // Regression guard: while the user is scrolled up, Mode A lets the DOM grow to
  // MAX_NON_PRESERVED_NODES_PAUSED (dom-window.ts) before trimming. Every row still visible in
  // that DOM must still be retrievable from the store, or a visible row can no longer be
  // preserved when it's banned/deleted. See the cross-referencing comments on both constants.
  it('stays >= MAX_NON_PRESERVED_NODES_PAUSED (dom-window.ts)', () => {
    expect(GLOBAL_CAPACITY).toBeGreaterThanOrEqual(MAX_NON_PRESERVED_NODES_PAUSED);
  });

  it('keeps the oldest message retrievable and preservable while a paused-cap worth of rows are in view', () => {
    const store = new ChatIntegrityStore();
    const oldestId = 'oldest';
    store.addMessage(message(oldestId, 1));
    for (let i = 1; i < MAX_NON_PRESERVED_NODES_PAUSED; i++) {
      store.addMessage(message(`m-${i}`, 1000 + i));
    }

    expect(store.getMessageById(oldestId)).toBeDefined();
    expect(store.markMessageDeleted(oldestId)?.id).toBe(oldestId);
  });
});
