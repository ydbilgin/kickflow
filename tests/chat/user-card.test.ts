import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureUserCardSession, mapUserCardResponse, openUserCard } from '../../src/content/chat/user-card';

describe('user-card', () => {
  afterEach(() => {
    configureUserCardSession(null);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('maps endpoint fields without exposing a level field', () => {
    const model = mapUserCardResponse({
      username: 'alice',
      slug: 'alice',
      profile_pic: 'https://kick.com/avatar.png',
      is_moderator: true,
      created_at: '2024-01-11T12:00:00Z',
      following_since: null,
      subscribed_for: 18,
      badges_v2: [{ text: 'VIP' }],
    }, 'fallback', 'fallback');

    const text = [
      model.username,
      model.role,
      model.createdAt,
      model.followingSince,
      model.subscribedFor,
      model.badges[0]?.text,
    ].join(' ');
    expect(text).toContain('alice');
    expect(text).toContain('mod');
    expect(text).toContain('2024');
    expect(text).toContain('takip etmiyor');
    expect(text).toContain('18 ay abone');
    expect(text).toContain('VIP');
    expect(text).not.toContain('level');
  });

  it('fetches and renders card fields for left-click popovers', async () => {
    configureUserCardSession('channel');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        username: 'alice',
        slug: 'alice',
        created_at: '2024-01-11T12:00:00Z',
        following_since: '2024-02-03T12:00:00Z',
        subscribed_for: 18,
      }),
    })));

    await openUserCard('alice', 'Alice', 10, 10);

    expect(fetch).toHaveBeenCalledWith(
      'https://kick.com/api/v2/channels/channel/users/alice',
      { headers: { accept: 'application/json' } }
    );
    const card = document.querySelector<HTMLElement>('.kickflow-user-card');
    expect(card?.textContent).toContain('hesap oluşturma');
    expect(card?.textContent).toContain('takip');
    expect(card?.textContent).toContain('abonelik');
    expect(card?.textContent).toContain('18 ay abone');
    expect(card?.textContent?.toLowerCase()).not.toContain('level');
  });
});
