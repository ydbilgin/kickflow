import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendBadges, appendParsedContent, buildMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import { ROLE_BADGE_ASSETS } from '../../src/content/chat/badge-assets';
import type { ChatMessage } from '../../src/content/chat/message-store';

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
