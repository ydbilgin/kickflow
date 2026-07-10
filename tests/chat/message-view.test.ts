import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendBadges, appendParsedContent, buildMessageElement, buildPinnedMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import { ROLE_BADGE_ASSETS } from '../../src/content/chat/badge-assets';
import type { ChatMessage, PinnedMessage } from '../../src/content/chat/message-store';

function message(
  slug: string,
  identity?: Partial<ChatMessage['sender']['identity']>,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'm1',
    chatroomId: 1,
    content: 'hello',
    type: 'message',
    createdAt: '',
    sender: {
      id: 1,
      username: 'Alice',
      slug,
      identity: { color: '', badges: [], badgesV2: [], ...identity },
    },
    preserved: false,
    ...overrides,
  };
}

describe('message-view safe rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setSubscriberBadges([]);
    document.body.innerHTML = '';
  });

  it('renders parsed emotes, mentions, links, and script-looking text safely', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'hi [emote:123:kek] @Bob, http://x.y <script>alert(1)</script>');

    const emote = parent.querySelector<HTMLImageElement>('img.kickflow-emote');
    expect(emote?.src).toBe('https://files.kick.com/emotes/123/fullsize');
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');
    expect(mention?.textContent).toBe('@Bob');
    expect(mention?.getAttribute('role')).toBe('link');
    expect(mention?.tabIndex).toBe(0);
    expect(mention?.classList.contains('kickflow-mention--link')).toBe(true);
    expect(parent.textContent).toContain('@Bob, http://x.y');
    expect(parent.querySelector<HTMLAnchorElement>('a.kickflow-link')?.href).toBe('http://x.y/');
    expect(parent.textContent).toContain('<script>alert(1)</script>');
    expect(parent.querySelector('script')).toBeNull();
  });

  it('renders a subscription event row with singular/plural wording and safe user text', () => {
    const unsafeUsername = '<img src=x onerror=alert(1)>';
    const firstMonth = buildMessageElement(message('', undefined, {
      id: 'sub:1:first:1',
      type: 'subscription',
      systemEvent: { kind: 'subscription', username: unsafeUsername, months: 1 },
    }));
    const renewal = buildMessageElement(message('', undefined, {
      id: 'sub:1:renewal:2',
      type: 'subscription',
      systemEvent: { kind: 'subscription', username: '***REMOVED***', months: 5 },
    }));

    expect(firstMonth.classList.contains('kickflow-event-row')).toBe(true);
    expect(firstMonth.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⭐');
    expect(firstMonth.querySelector('.kickflow-event-row__username')?.textContent).toBe(unsafeUsername);
    expect(firstMonth.textContent).toBe(`⭐${unsafeUsername} abone oldu`);
    expect(firstMonth.querySelector('img')).toBeNull();
    expect(renewal.textContent).toBe('⭐***REMOVED*** 5 ay abone oldu');
  });

  it('renders a gifted-subscription event row with a safe username and count', () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:***REMOVED***:1',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: '***REMOVED***<script>', giftCount: 3 },
    }));

    expect(row.classList.contains('kickflow-event-row--gifted-subscription')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('🎁');
    expect(row.querySelector('.kickflow-event-row__username')?.textContent).toBe('***REMOVED***<script>');
    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('3');
    expect(row.textContent).toBe('🎁***REMOVED***<script> 3 kişiye abonelik hediye etti');
    expect(row.querySelector('script')).toBeNull();
  });

  it('renders host rows with safe user text, Turkish viewer formatting, and a viewerless fallback', () => {
    const unsafeUsername = '<img src=x onerror=alert(1)>';
    const withViewers = buildMessageElement(message('', undefined, {
      id: 'host:1:unsafe:1',
      type: 'host',
      systemEvent: {
        kind: 'host',
        username: unsafeUsername,
        numberViewers: 12_345,
        optionalMessage: '<script>alert(2)</script>',
      },
    }));
    const withoutViewers = buildMessageElement(message('', undefined, {
      id: 'host:1:viewerless:2',
      type: 'host',
      systemEvent: {
        kind: 'host',
        username: 'Mr_Jelal',
        numberViewers: 0,
        optionalMessage: null,
      },
    }));

    expect(withViewers.classList.contains('kickflow-event-row--host')).toBe(true);
    expect(withViewers.querySelector('.kickflow-event-row__icon')?.textContent).toBe('📡');
    expect(withViewers.querySelector('.kickflow-event-row__username')?.textContent).toBe(unsafeUsername);
    expect(withViewers.querySelector('.kickflow-event-row__count')?.textContent).toBe('12.345');
    expect(withViewers.textContent).toBe(`📡${unsafeUsername} 12.345 izleyiciyle host etti`);
    expect(withViewers.querySelector('img, script')).toBeNull();
    expect(withoutViewers.textContent).toBe('📡Mr_Jelal host etti');
    expect(withoutViewers.querySelector('.kickflow-event-row__count')).toBeNull();
  });

  it('renders a mode system row with its settings icon and safe text', () => {
    const unsafeText = 'Yavaş mod açıldı (5sn)<script>alert(1)</script>';
    const row = buildMessageElement(message('', undefined, {
      id: 'mode:1:slow_mode:1',
      type: 'mode',
      systemEvent: { kind: 'mode', mode: 'slow_mode', text: unsafeText },
    }));

    expect(row.classList.contains('kickflow-event-row--mode')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⚙');
    expect(row.querySelector('.kickflow-event-row__text')?.textContent).toBe(unsafeText);
    expect(row.querySelector('script')).toBeNull();
  });

  it('builds the sticky pin with normal badges/content parsing and ID-scoped dismiss', () => {
    const onDismiss = vi.fn();
    const onToggleCollapse = vi.fn();
    const pinned: PinnedMessage = {
      message: message('botrix', { badges: [{ type: 'moderator', text: 'Moderator' }] }, {
        id: 'pin-1',
        content: 'bak [emote:123:kek] @Bob <script>alert(1)</script>',
        sender: {
          id: 1,
          username: '<img src=x onerror=alert(1)>',
          slug: 'botrix',
          identity: { color: '#75FD46', badges: [{ type: 'moderator', text: 'Moderator' }], badgesV2: [] },
        },
      }),
      durationSeconds: 1200,
      pinnedBy: { id: 2, username: '<svg onload=alert(1)>', slug: 'moderator' },
    };

    const banner = buildPinnedMessageElement(pinned, false, onDismiss, onToggleCollapse);
    expect(banner.dataset.pinId).toBe('pin-1');
    expect(banner.querySelector('.kickflow-pinned-message__username')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(banner.querySelector('.kickflow-pinned-message__actor')?.textContent).toBe('<svg onload=alert(1)> sabitledi');
    expect(banner.querySelector('.kickflow-badge-icon')).not.toBeNull();
    expect(banner.querySelector('.kickflow-emote')).not.toBeNull();
    expect(banner.querySelector('.kickflow-mention')?.textContent).toBe('@Bob');
    expect(banner.querySelector('.kickflow-pinned-message__content')?.textContent).toContain('<script>alert(1)</script>');
    expect(banner.querySelector('script, svg')).toBeNull();
    expect(banner.querySelector('.kickflow-pinned-message__collapse')).not.toBeNull();

    banner.querySelector<HTMLButtonElement>('.kickflow-pinned-message__dismiss')?.click();
    expect(onDismiss).toHaveBeenCalledWith('pin-1');
    banner.querySelector<HTMLButtonElement>('.kickflow-pinned-message__collapse')?.click();
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('builds a collapsed pin bar without the body or dismiss button and expands on click', () => {
    const onDismiss = vi.fn();
    const onToggleCollapse = vi.fn();
    const pinned: PinnedMessage = {
      message: message('botrix', {}, { id: 'pin-1' }),
      durationSeconds: 1200,
      pinnedBy: { id: 2, username: 'mod', slug: 'moderator' },
    };

    const banner = buildPinnedMessageElement(pinned, true, onDismiss, onToggleCollapse);

    expect(banner.classList.contains('kickflow-pinned-message--collapsed')).toBe(true);
    expect(banner.textContent).toBe('📌');
    expect(banner.querySelector('.kickflow-pinned-message__body')).toBeNull();
    expect(banner.querySelector('.kickflow-pinned-message__dismiss')).toBeNull();
    expect(banner.querySelector('.kickflow-pinned-message__header')).toBeNull();

    banner.click();
    expect(onToggleCollapse).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('opens a mention slug in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @Bob_123!');
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');

    mention?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(parent.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('opens a mention user card on plain left-click', async () => {
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @NoSuchUserProbably');
    document.body.appendChild(parent);

    parent.querySelector<HTMLElement>('.kickflow-mention')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 20, clientY: 30 }));
    await Promise.resolve();

    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('NoSuchUserProbably');
    expect(document.querySelector<HTMLAnchorElement>('.kickflow-user-card__link')?.href)
      .toBe('https://kick.com/nosuchuserprobably');
  });

  it('keeps mention Space activation from bubbling into page-level hotkeys', async () => {
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @NoSuchUserProbably');
    document.body.appendChild(parent);
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    mention?.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('NoSuchUserProbably');
  });

  it('renders non-numeric emote ids as text', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, '[emote:abc:kek]');

    expect(parent.querySelector('img.kickflow-emote')).toBeNull();
    expect(parent.textContent).toBe('[emote:abc:kek]');
  });

  it('does not anchor javascript scheme text', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'javascript:alert(1)');

    expect(parent.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(parent.textContent).toBe('javascript:alert(1)');
  });

  it('falls back to badge text for untrusted image hosts', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ text: 'VIP', imageUrl: 'https://evil.example/badge.png' }]);

    expect(parent.querySelector('img')).toBeNull();
    expect(parent.querySelector('.kickflow-badge-text')?.textContent).toBe('VIP');
  });

  it('renders safe username slugs as an interactive span (NOT a router-recognizable anchor)', () => {
    const row = buildMessageElement(message('alice_123'));

    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    // Deliberately a <span role="link">, not <a href> — so Kick's SPA click router can't classify
    // it and navigate the page. We handle left-click (card) / modified-click (new tab) ourselves.
    expect(username?.tagName).toBe('SPAN');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.tabIndex).toBe(0);
    expect(username?.classList.contains('kickflow-message__username--link')).toBe(true);
    expect(username?.textContent).toBe('Alice');
    expect(row.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('opens a safe username in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const row = buildMessageElement(message('alice_123'));
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(row.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('keeps username keyboard activation from bubbling into page-level hotkeys', async () => {
    const row = buildMessageElement(message('alice_123'));
    document.body.appendChild(row);
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    username?.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('Alice');
  });

  it('does not link unsafe username slugs', () => {
    const row = buildMessageElement(message('../evil'));

    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    expect(username?.tagName).toBe('SPAN');
    expect(username?.textContent).toBe('Alice');
    expect(row.querySelector('a[href*="evil"]')).toBeNull();
  });

  it('renders reply context above the message using text nodes only', () => {
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: {
        replyToUser: 'ZehoG',
        replyToText: '<script>alert(1)</script> hello',
        replyToMessageId: 'orig-1',
        replyToUserId: 2,
        threadParentId: 'orig-1',
      },
    }));

    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');
    expect(reply?.textContent).toContain('ZehoG: <script>alert(1)</script> hello isimli kullanıcıya yanıt veriyor');
    expect(reply?.querySelector('.kickflow-message__reply-user')?.textContent).toBe('ZehoG');
    expect(reply?.querySelector<HTMLElement>('.kickflow-message__reply-user')?.title).toBe('ZehoG');
    expect(reply?.querySelector('.kickflow-message__reply-separator')?.textContent).toBe(': ');
    expect(reply?.querySelector('.kickflow-message__reply-snippet')?.textContent).toBe('<script>alert(1)</script> hello');
    expect(reply?.querySelector<HTMLElement>('.kickflow-message__reply-snippet')?.title).toBe('<script>alert(1)</script> hello');
    expect(reply?.querySelector('.kickflow-message__reply-label')?.textContent).toBe(' isimli kullanıcıya yanıt veriyor');
    expect(reply?.querySelector('script')).toBeNull();
    expect(row.firstElementChild).toBe(reply);
  });

  it('renders an authentic Kick SVG for a moderator role badge, with a tooltip', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'moderator' }]);

    const img = parent.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    expect(img?.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(img?.title).toBe(ROLE_BADGE_ASSETS.moderator.label);
    expect(img?.title).toBe('Moderatör');
  });

  it('renders a level image (`badges_v2`) BEFORE an authentic role asset (`badges`), in sort_order', () => {
    const row = buildMessageElement(message('alice_123', {
      badges: [{ type: 'moderator', text: 'Moderator', sortOrder: 4 }],
      badgesV2: [{ name: 'level', imageUrl: 'https://ext.cdn.kick.com/chat/badges/1_x.png', level: 1, sortOrder: 1 }],
    }));

    const badgeContainer = row.querySelector('.kickflow-message__badges');
    const icons = Array.from(badgeContainer?.querySelectorAll<HTMLImageElement>('img.kickflow-badge-icon') ?? []);

    // sortOrder 1 (level) < sortOrder 4 (moderator) — the level image must come first.
    expect(icons).toHaveLength(2);
    expect(icons[0].src).toBe('https://ext.cdn.kick.com/chat/badges/1_x.png');
    expect(icons[0].title).toBe('1. Seviye');
    expect(icons[1].src.startsWith('data:image/svg+xml')).toBe(true);
    expect(icons[1].title).toBe('Moderatör');
  });

  it('resolves the channel subscriber badge by month count and renders it as a real image', () => {
    setSubscriberBadges([
      { months: 1, src: 'https://files.kick.com/channel_subscriber_badges/1/original' },
      { months: 6, src: 'https://files.kick.com/channel_subscriber_badges/6/original' },
    ]);
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'subscriber', count: 12 }]);

    const img = parent.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    expect(img?.src).toBe('https://files.kick.com/channel_subscriber_badges/6/original');
    expect(img?.title).toContain('Abone');
    expect(img?.title).toContain('12 ay');
  });

  it('falls back to a subscriber chip when no channel subscriber-badge context is set', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'subscriber', count: 14 }]);

    const chip = parent.querySelector<HTMLElement>('.kickflow-badge-role');
    expect(parent.querySelector('img')).toBeNull();
    expect(chip).not.toBeNull();
    expect(chip?.title).toContain('Abone');
    expect(chip?.querySelector('.kickflow-badge-role__count')?.textContent).toBe('14');
  });

  it('renders a broadcaster fallback chip with its Turkish label as the tooltip', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'broadcaster' }]);

    const chip = parent.querySelector<HTMLElement>('.kickflow-badge-role');
    expect(chip).not.toBeNull();
    expect(chip?.title).toBe('Yayıncı');
  });

  it('falls back to badge text (with a tooltip) for an unknown role type', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'weird', text: 'Weird' }]);

    const span = parent.querySelector<HTMLElement>('.kickflow-badge-text');
    expect(parent.querySelector('.kickflow-badge-role')).toBeNull();
    expect(span?.textContent).toBe('Weird');
    expect(span?.title).toBe('Weird');
  });
});
