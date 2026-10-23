import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUserCardElement,
  configureUserCardSession,
  dismissUserCard,
  mapUserCardResponse,
  openUserCard,
} from '../../src/content/chat/user-card';
import { configureUserMessageArchive } from '../../src/content/chat/archive-session';
import { UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { chatMessage } from '../helpers/chat-message';
import { setLang } from '../../src/content/shared/i18n';

function archivedMessageForUser(userId: number, name: string, content: string) {
  const base = chatMessage(`${name}-${content}`, { userId, content });
  return {
    ...base,
    sender: {
      ...base.sender,
      slug: name.toLowerCase(),
      username: name,
    },
  };
}

describe('user-card', () => {
  beforeEach(() => setLang('tr'));
  function pendingProfile() {
    configureUserCardSession('channel');
    let finish!: () => void;
    const response = new Promise<{ ok: boolean }>((resolve) => { finish = () => resolve({ ok: false }); });
    vi.stubGlobal('fetch', vi.fn(() => response));
    return { pending: openUserCard('alice', 'İpek Şağrı', 900, 600, null), finish };
  }

  it('keeps a dragged loading card in its chosen place when profile data arrives', async () => {
    const { pending, finish } = pendingProfile();
    const loading = document.querySelector<HTMLElement>('.kickflow-user-card')!;
    // A drag updates the fixed offsets. The network response must not reset them to the row.
    loading.style.left = '120px';
    loading.style.top = '80px';
    finish();
    await pending;
    const card = document.querySelector<HTMLElement>('.kickflow-user-card')!;
    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('80px');
    expect(card.textContent).toContain('İpek Şağrı');
  });

  it('keeps session messages collapsed when a slow profile response replaces the card', async () => {
    const archive = new UserMessageArchive();
    archive.add(archivedMessageForUser(7, 'alice', 'already read'));
    configureUserMessageArchive(archive);
    const { pending, finish } = pendingProfile();
    document.querySelector<HTMLButtonElement>('.kickflow-user-messages__toggle')!.click();
    finish();
    await pending;
    expect(document.querySelector('.kickflow-user-messages__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.kickflow-user-messages--collapsed')).not.toBeNull();
  });

  it('keeps the reader on older session messages across profile replacement', async () => {
    const archive = new UserMessageArchive();
    archive.add(archivedMessageForUser(7, 'alice', 'already read'));
    configureUserMessageArchive(archive);
    const { pending, finish } = pendingProfile();
    const body = document.querySelector<HTMLElement>('.kickflow-user-messages__body')!;
    Object.defineProperties(body, {scrollHeight:{value:500},clientHeight:{value:100}});
    body.scrollTop = 45;
    // Chromium reports zero after the old scroll container is detached.
    Object.defineProperty(body, 'scrollTop', {get:()=>body.isConnected?45:0});
    finish();
    await pending;
    expect(document.querySelector<HTMLElement>('.kickflow-user-messages__body')?.scrollTop).toBe(45);
  });

  it('retains its observer through profile loading, reclamps on resize and disconnects on close', async () => {
    const observers: {callback:()=>void;disconnect:ReturnType<typeof vi.fn>}[] = [];
    vi.stubGlobal('ResizeObserver', class {
      disconnect=vi.fn();
      constructor(callback:()=>void){observers.push({callback,disconnect:this.disconnect});}
      observe(){}
    });
    const { pending, finish } = pendingProfile();
    finish();
    await pending;
    expect(observers).toHaveLength(1);
    expect(observers[0].disconnect).not.toHaveBeenCalled();
    const card=document.querySelector<HTMLElement>('.kickflow-user-card')!;
    card.style.top='600px';
    vi.spyOn(card,'getBoundingClientRect').mockReturnValue({x:8,y:600,left:8,top:600,width:300,height:300,right:308,bottom:900,toJSON(){}});
    observers[0].callback();
    expect(parseFloat(card.style.top)+300).toBeLessThanOrEqual(window.innerHeight-8);
    dismissUserCard();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('clamps an open card after the viewport shrinks, and removes its resize listener on close', async () => {
    const { pending, finish } = pendingProfile();
    finish();
    await pending;
    const card = document.querySelector<HTMLElement>('.kickflow-user-card')!;
    card.style.left = '850px';
    card.style.top = '500px';
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({
      x: parseFloat(card.style.left), y: parseFloat(card.style.top),
      left: parseFloat(card.style.left), top: parseFloat(card.style.top),
      width: 300, height: 200, right: 1150, bottom: 700, toJSON() {},
    }));
    vi.stubGlobal('innerWidth', 340);
    vi.stubGlobal('innerHeight', 400);
    window.dispatchEvent(new Event('resize'));
    expect(card.style.left).toBe('32px');
    expect(card.style.top).toBe('192px');
    dismissUserCard();
    card.style.left = '850px';
    window.dispatchEvent(new Event('resize'));
    expect(card.style.left).toBe('850px');
  });

  it('keeps keyboard focus through loading and restores the opener after Escape', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { pending, finish } = pendingProfile();
    expect(document.querySelector('.kickflow-user-card')?.contains(document.activeElement)).toBe(true);
    finish();
    await pending;
    const card = document.querySelector('.kickflow-user-card')!;
    expect(card.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    expect(document.querySelector('.kickflow-user-card')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not restore focus over another control the reader has selected', async () => {
    const { pending, finish } = pendingProfile();
    finish();
    await pending;
    const composer = document.createElement('button');
    document.body.append(composer);
    composer.focus();
    dismissUserCard();
    expect(document.activeElement).toBe(composer);
  });

  it('finishes with usable relationship data when the optional profile request hangs', async () => {
    vi.useFakeTimers();
    try {
      configureUserCardSession('channel');
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ok:true, json:async()=>({following_since:null, subscribed_for:3})})
        .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
      vi.stubGlobal('fetch', fetchMock);
      let settled = false;
      const pending = openUserCard('alice', 'Alice', 10, 10, null).then(()=>{settled=true;});
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(true);
      await pending;
      expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('3 ay abone');
    } finally { vi.useRealTimers(); }
  });

  it('shows unknown relationships on both the loading and failed fallback cards', async () => {
    configureUserCardSession('channel');
    let finish!: () => void;
    const response = new Promise<{ ok: boolean }>((resolve) => { finish = () => resolve({ ok: false }); });
    vi.stubGlobal('fetch', vi.fn(() => response));
    const pending = openUserCard('alice', 'Alice', 10, 10, null);
    const relationships = (): string[] => Array.from(document.querySelectorAll('.kickflow-user-card__value')).slice(-2).map((node) => node.textContent!);
    expect(relationships()).toEqual(['bilinmiyor', 'bilinmiyor']);
    finish();
    await pending;
    expect(relationships()).toEqual(['bilinmiyor', 'bilinmiyor']);
  });

  it.each(['relationship', 'profile', 'missing-fields'])('retries a partial %s card on the next click', async (failure) => {
    configureUserCardSession('channel');
    const relationship = { following_since: null, subscribed_for: 0 };
    const profile = { followers_count: 10, user: { bio: 'profile recovered' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: failure !== 'relationship', json: async () => failure === 'missing-fields' ? {} : relationship })
      .mockResolvedValueOnce({ ok: failure !== 'profile', json: async () => profile })
      .mockResolvedValueOnce({ ok: true, json: async () => relationship })
      .mockResolvedValueOnce({ ok: true, json: async () => profile });
    vi.stubGlobal('fetch', fetchMock);
    await openUserCard('alice', 'Alice', 10, 10, null);
    await openUserCard('alice', 'Alice', 10, 10, null);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('takip etmiyor');
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('profile recovered');
    await openUserCard('alice', 'Alice', 10, 10, null);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not let an old partial session evict the new session card cache', async () => {
    configureUserCardSession('old-channel');
    let finish!: () => void;
    const oldResponse = new Promise<{ ok: boolean }>((resolve) => { finish = () => resolve({ ok: false }); });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldResponse).mockReturnValueOnce(oldResponse)
      .mockResolvedValue({ ok: true, json: async () => ({ following_since: null, subscribed_for: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const oldCard = openUserCard('alice', 'Alice', 10, 10, null);
    configureUserCardSession('new-channel');
    await openUserCard('alice', 'Alice', 10, 10, null);
    finish();
    await oldCard;
    await openUserCard('alice', 'Alice', 10, 10, null);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('takip etmiyor');
  });

  afterEach(() => {
    configureUserMessageArchive(null);
    configureUserCardSession(null);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Regression: the fallback card used to pass `messages: null`, hiding the session archive exactly
  // when Kick's profile endpoint fails or rate-limits — the one case where local data is all we have.
  it('still renders the session message list when the profile fetch fails', async () => {
    configureUserCardSession('channel');
    const archive = new UserMessageArchive();
    archive.add(chatMessage('m1', { userId: 7, content: 'kayitli mesaj' }));
    configureUserMessageArchive(archive);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await openUserCard('alice', 'Alice', 10, 10, 7);

    const card = document.querySelector<HTMLElement>('.kickflow-user-card');
    expect(card?.querySelector('.kickflow-user-messages')).not.toBeNull();
    expect(card?.textContent).toContain('kayitli mesaj');
  });

  it('resolves the session message list from the clicked name when no user ID is passed', async () => {
    configureUserCardSession('channel');
    const archive = new UserMessageArchive();
    archive.add(archivedMessageForUser(61, 'Cahitc61', 'message from the target'));
    configureUserMessageArchive(archive);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await openUserCard('cahitc61', 'Cahitc61', 10, 10, null);

    const list = document.querySelector<HTMLElement>('.kickflow-user-messages');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('message from the target');
  });

  it('does not render a session message list when the clicked name is absent from the archive', async () => {
    configureUserCardSession('channel');
    const archive = new UserMessageArchive();
    archive.add(archivedMessageForUser(61, 'archived-user', 'unrelated message'));
    configureUserMessageArchive(archive);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await openUserCard('missing-user', 'Missing User', 10, 10, null);

    expect(document.querySelector('.kickflow-user-messages')).toBeNull();
  });

  it('keeps an explicitly passed user ID ahead of name lookup', async () => {
    configureUserCardSession('channel');
    const archive = new UserMessageArchive();
    archive.add(archivedMessageForUser(61, 'alice', 'name lookup message'));
    archive.add(archivedMessageForUser(62, 'other-user', 'explicit ID message'));
    configureUserMessageArchive(archive);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    await openUserCard('alice', 'Alice', 10, 10, 62);

    const list = document.querySelector<HTMLElement>('.kickflow-user-messages');
    expect(list?.textContent).toContain('explicit ID message');
    expect(list?.textContent).not.toContain('name lookup message');
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

  it('shows unknown relationships when the card endpoint has no relationship data', () => {
    const model = mapUserCardResponse({}, {}, 'alice', 'alice');
    expect(model.followingSince).toBe('bilinmiyor');
    expect(model.subscribedFor).toBe('bilinmiyor');
  });

  it('omits an explicitly unselected badges_v2 entry from the user card', () => {
    const model = mapUserCardResponse({
      username: 'laureth',
      slug: 'laureth',
      badges: [{ type: 'subscriber', text: 'Subscriber', count: 1, sort_order: 9 }],
      badges_v2: [{
        name: 'level',
        badge_type: 'global',
        image_url: 'https://ext.cdn.kick.com/chat/badges/34_x.png',
        selected: false,
        metadata: { level: 34 },
        sort_order: 1,
      }],
    }, {}, 'laureth', 'laureth');

    expect(model.badges).toEqual([expect.objectContaining({ type: 'subscriber', count: 1 })]);
  });

  it('omits inactive role badges from a real Kick user-card response', () => {
    const model = mapUserCardResponse({
      username: 'c4nkn',
      slug: 'c4nkn',
      is_moderator: true,
      badges: [
        { type: 'moderator', text: 'Moderator', active: true, sort_order: 4 },
        { type: 'vip', text: 'VIP', active: true, sort_order: 5 },
        { type: 'founder', text: 'Founder', active: true, sort_order: 7 },
        { type: 'sub_gifter', text: 'Sub Gifter', count: 1, active: false, sort_order: 8 },
        { type: 'subscriber', text: 'Subscriber', count: 5, active: false, sort_order: 9 },
      ],
      badges_v2: [{
        name: 'level',
        badge_type: 'global',
        image_url: 'https://ext.cdn.kick.com/chat/badges/14_x.png',
        selected: false,
        metadata: { level: 14 },
        sort_order: 1,
      }],
    }, {}, 'c4nkn', 'c4nkn');

    expect(model.badges.map((badge) => badge.type ?? badge.name)).toEqual([
      'moderator',
      'vip',
      'founder',
    ]);
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

    await openUserCard('alice', 'Alice', 10, 10, null);

    expect(fetch).toHaveBeenCalledWith(
      'https://kick.com/api/v2/channels/channel/users/alice',
      { headers: { accept: 'application/json' }, signal: expect.any(AbortSignal) }
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
