import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUserCardElement, configureUserCardSession, mapUserCardResponse, openUserCard } from '../../src/content/chat/user-card';

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

  it('renders only HTTPS Kick-hosted profile images', () => {
    const model = {
      username: 'Alice', slug: 'alice', profilePic: 'https://files.kick.com/avatar.png', role: null,
      verified: false, bio: null, followers: null, createdAt: '-', followingSince: '-',
      subscribedFor: '-', badges: [],
    };

    expect(buildUserCardElement(model).querySelector<HTMLImageElement>('.kickflow-user-card__avatar')?.src)
      .toBe('https://files.kick.com/avatar.png');
    expect(buildUserCardElement({ ...model, profilePic: 'https://tracker.example/avatar.png' })
      .querySelector('.kickflow-user-card__avatar')).toBeNull();
    expect(buildUserCardElement({ ...model, profilePic: 'data:image/svg+xml,<svg></svg>' })
      .querySelector('.kickflow-user-card__avatar')).toBeNull();
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

  it('middle-clicking the card title opens the profile in a new tab (autoscroll-guarded)', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('https://kick.com/alice');
      expect(this.target).toBe('_blank');
      expect(this.isConnected).toBe(false);
    });
    const card = buildUserCardElement({
      username: 'Alice', slug: 'alice', profilePic: null, role: null, verified: false, bio: null,
      followers: null, createdAt: '-', followingSince: '-', subscribedFor: '-', badges: [],
    });
    const name = card.querySelector<HTMLElement>('.kickflow-user-card__name');
    expect(name).not.toBeNull();

    // Middle-press default (Chrome autoscroll) must be cancelled or auxclick never fires live.
    const middleDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    name?.dispatchEvent(middleDown);
    expect(middleDown.defaultPrevented).toBe(true);

    name?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(click).toHaveBeenCalledOnce();

    // Plain left-click must stay free (the header is the drag handle) — no tab, no card.
    name?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(click).toHaveBeenCalledOnce();

    // Ctrl-left-click is the other new-tab gesture.
    name?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('opens the card channel link through a detached new-tab anchor, not a popup window', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('https://kick.com/alice');
      expect(this.target).toBe('_blank');
      expect(this.rel).toBe('noopener noreferrer');
      expect(this.isConnected).toBe(false);
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const card = buildUserCardElement({
      username: 'alice', slug: 'alice', profilePic: null, role: null, verified: false, bio: null,
      followers: null, createdAt: '-', followingSince: '-', subscribedFor: '-', badges: [],
    });

    card.querySelector<HTMLAnchorElement>('.kickflow-user-card__link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
});
