import { describe, expect, it } from 'vitest';
import {
  MOD_ACTION_BURST_MAX_MS,
  MOD_ACTION_BURST_WINDOW_MS,
  MOD_ACTION_NOTICE_VICTIM_CAP,
  ModActionFeed,
  type ModAction,
  type ModActionNotice,
} from '../../src/content/chat/mod-action-feed';

function action(at: number, overrides: Partial<ModAction> = {}): ModAction {
  return {
    kind: 'ban',
    moderator: 'mod',
    victim: `victim-${at}`,
    messageId: `message-${at}`,
    durationMin: null,
    at,
    ...overrides,
  };
}

function victim(name: string, messageId: string | null): { name: string; messageId: string | null } {
  return { name, messageId };
}

function createFeed(
  now: () => number,
  notices: ModActionNotice[],
  updated: ModActionNotice[],
): ModActionFeed {
  return new ModActionFeed({
    now,
    onNotice: (notice) => notices.push(notice),
    onNoticeUpdated: (notice) => updated.push(notice),
  });
}

describe('ModActionFeed', () => {
  it('collapses same-moderator bans inside the sliding burst window', () => {
    let now = 1_000;
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => now, notices, updated);

    feed.push(action(now));
    now += 1_000;
    feed.push(action(now));

    expect(notices).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ count: 2, messageId: null, firstAt: 1_000, lastAt: 2_000 });
  });

  it('opens a second notice after the burst window closes', () => {
    const notices: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, []);

    feed.push(action(0));
    feed.push(action(MOD_ACTION_BURST_WINDOW_MS * 2));

    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.count)).toEqual([1, 1]);
  });

  it('collapses a fast purge without exceeding the victim cap', () => {
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, updated);

    for (let index = 0; index < 40; index++) feed.push(action(index * 100));

    expect(notices).toHaveLength(1);
    expect(updated).toHaveLength(39);
    const latest = updated[updated.length - 1];
    expect(latest).toMatchObject({ count: 40 });
    expect(latest?.victims).toHaveLength(MOD_ACTION_NOTICE_VICTIM_CAP);
  });

  it('uses the hard ceiling to split a steady drip', () => {
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, updated);

    for (let at = 0; at <= MOD_ACTION_BURST_MAX_MS + MOD_ACTION_BURST_WINDOW_MS + 1_000; at += 4_000) {
      feed.push(action(at));
    }

    expect(notices).toHaveLength(2);
    const firstNoticeUpdates = updated.filter((notice) => notice.firstAt === 0);
    expect(firstNoticeUpdates[firstNoticeUpdates.length - 1]?.count).toBe(8);
    expect(updated[updated.length - 1]?.count).toBe(2);
    expect(updated).toHaveLength(8);
  });

  it('does not collapse different moderators or different action kinds', () => {
    const notices: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, []);

    feed.push(action(0, { moderator: 'mod-a' }));
    feed.push(action(1_000, { moderator: 'mod-b' }));
    feed.push(action(2_000, { moderator: 'mod-b', kind: 'delete' }));

    expect(notices).toHaveLength(3);
  });

  it('drops the single jump target as soon as a notice collapses', () => {
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, updated);

    feed.push(action(0));
    expect(notices[0]?.messageId).toBe('message-0');
    feed.push(action(1_000));

    expect(updated[0]?.messageId).toBeNull();
  });

  it('counts repeated victims without duplicating their names', () => {
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, updated);

    feed.push(action(0, { victim: 'same-user' }));
    feed.push(action(1_000, { victim: 'same-user' }));

    expect(updated[0]).toMatchObject({ count: 2, victims: [victim('same-user', 'message-0')] });
  });

  it('keeps each distinct victim message id when a burst collapses', () => {
    const notices: ModActionNotice[] = [];
    const updated: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, updated);

    feed.push(action(0, { victim: 'first', messageId: 'first-message' }));
    feed.push(action(1_000, { victim: 'second', messageId: 'second-message' }));

    expect(updated[0]?.victims).toEqual([
      victim('first', 'first-message'),
      victim('second', 'second-message'),
    ]);
  });

  it('keeps notice identifiers monotonic and clears the open notice', () => {
    const notices: ModActionNotice[] = [];
    const feed = createFeed(() => 0, notices, []);

    feed.push(action(0));
    feed.clear();
    feed.push(action(10_000));

    expect(notices[1]?.id).not.toBe(notices[0]?.id);
    feed.dispose();
    feed.push(action(20_000));
    expect(notices).toHaveLength(2);
  });
});
