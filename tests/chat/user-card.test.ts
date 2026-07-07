import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureUserCardSession, mapUserCardResponse, openUserCard } from '../../src/content/chat/user-card';

describe('user-card', () => {
  afterEach(() => {
    configureUserCardSession(null);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('maps card + channel fields (avatar/bio/followers/verified) without exposing a level field', () => {
    const model = mapUserCardResponse({
      username: 'alice',
      slug: 'alice',
      profile_pic: '', // empty on the card endpoint -> falls back to the channel avatar
      is_moderator: true,
      created_at: '2024-01-11T12:00:00Z',
      following_since: null,
      subscribed_for: 18,
      badges_v2: [{ text: 'VIP' }],
    }, {
      followers_count: 12345,
      verified: true,
      user: { profile_pic: 'https://kick.com/channel-avatar.png', bio: 'merhaba dünya' },
    }, 'fallback', 'fallback');

    expect(model.username).toContain('alice');
    expect(model.role).toBe('mod');
    expect(model.createdAt).toContain('2024');
    expect(model.followingSince).toBe('takip etmiyor');
    expect(model.subscribedFor).toBe('18 ay abone');
    expect(model.badges[0]?.text).toBe('VIP');
    expect(model.profilePic).toBe('https://kick.com/channel-avatar.png');
    expect(model.bio).toBe('merhaba dünya');
    expect(model.followers).toContain('12');
    expect(model.verified).toBe(true);
    expect(JSON.stringify(model).toLowerCase()).not.toContain('level');
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
