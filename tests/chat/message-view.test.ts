import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendBadges, appendParsedContent, applyPreservedMarking, buildMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import type { ChatMessage } from '../../src/content/chat/message-store';
import { setLang } from '../../src/content/shared/i18n';

beforeEach(() => setLang('tr'));

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
    expect(emote?.alt).toBe('kek');
    expect(emote?.title).toBe('kek');
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

  it('uses the parsed emote name as safe alt and hover text in a regular Mode-A row', () => {
    const emoteName = '<svg onload=alert(1)>';
    const row = buildMessageElement(message('alice', undefined, {
      content: `hello [emote:456:${emoteName}]`,
    }));

    const emote = row.querySelector<HTMLImageElement>('.kickflow-message__content img.kickflow-emote');
    expect(emote?.alt).toBe(emoteName);
    expect(emote?.title).toBe(emoteName);
    expect(row.querySelector('svg')).toBeNull();
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
      systemEvent: { kind: 'subscription', username: 'violet_demo', months: 5 },
    }));

    expect(firstMonth.classList.contains('kickflow-event-row')).toBe(true);
    expect(firstMonth.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⭐');
    expect(firstMonth.querySelector('.kickflow-event-row__username')?.textContent).toBe(unsafeUsername);
    expect(firstMonth.textContent).toBe(`⭐${unsafeUsername} abone oldu`);
    expect(firstMonth.querySelector('img')).toBeNull();
    expect(renewal.textContent).toBe('⭐violet_demo 5 ay abone oldu');
  });

  it('names the single gift recipient with both usernames safe and no count capsule', () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:single',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'violet_demo<script>',
        giftCount: 1,
        giftedUsernames: ['<img src=x onerror=alert(1)>'],
      },
    }));

    expect(row.classList.contains('kickflow-event-row--gifted-subscription')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('🎁');
    expect(row.querySelector('.kickflow-event-row__username')?.textContent).toBe('violet_demo<script>');
    expect(row.querySelector('.kickflow-event-row__recipient')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(row.textContent).toBe('🎁violet_demo<script>, <img src=x onerror=alert(1)> kullanıcısına abonelik hediye etti');
    expect(row.querySelector('.kickflow-event-row__count')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('img')).toBeNull();
  });

  it('names every recipient of a small bulk gift without a remainder or hover list', () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:small-bulk',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'cozy_mert',
        giftCount: 3,
        giftedUsernames: ['nova_88', 'ayla_k', 'demir42'],
      },
    }));

    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('3');
    expect(row.textContent).toBe('🎁cozy_mert 3 kişiye abonelik hediye etti: nova_88, ayla_k, demir42');
    expect(row.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
  });

  it('caps a large bulk gift at three names and expands the rest on click (no hover dependency)', () => {
    // Real captured 10-recipient GiftedSubscriptionsEvent payload (2026-07-14).
    const names = [
      'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
      'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
    ];
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:bulk',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'cozy_mert', giftCount: 10, giftedUsernames: names },
    }));

    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('10');
    expect(row.textContent).toBe('🎁cozy_mert 10 kişiye abonelik hediye etti: nova_88, ayla_k, demir42 ve 7 kişi daha');
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(3);
    // The full list is NOT hidden in a hover-only title; it lives behind a visible affordance.
    expect(row.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    expect(more?.getAttribute('role')).toBe('button');
    expect(more?.getAttribute('tabindex')).toBe('0');

    // Click reveals every remaining KNOWN name in place; the one-shot trigger removes itself.
    more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(10);
    expect(row.querySelector('.kickflow-event-row__more')).toBeNull();
    expect(row.textContent).toBe(`🎁cozy_mert 10 kişiye abonelik hediye etti: ${names.join(', ')}`);
  });

  it('expands the bulk recipient list on Enter/Space for keyboard users', () => {
    const names = ['one', 'two', 'three', 'four', 'five', 'six'];
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:kbd',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'gifter', giftCount: 6, giftedUsernames: names },
    }));
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    more!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(6);
    expect(row.querySelector('.kickflow-event-row__more')).toBeNull();
  });

  it('collapses the expand trigger to a static count when some recipients are unnameable', () => {
    // Kick's count (20) exceeds the names it sent (5): clicking reveals the 2 hidden KNOWN names,
    // then the trigger degrades to a plain, non-interactive remainder for the 15 unknown ones.
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:mixed',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 20,
        giftedUsernames: ['one', 'two', 'three', 'four', 'five'],
      },
    }));
    expect(row.textContent).toBe('🎁gifter 20 kişiye abonelik hediye etti: one, two, three ve 17 kişi daha');
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(5);
    // Trigger is now inert text — no button role, and it left the __more class.
    const inert = row.querySelector('.kickflow-event-row__more');
    expect(inert).toBeNull();
    expect(row.textContent).toBe('🎁gifter 20 kişiye abonelik hediye etti: one, two, three, four, five ve 15 kişi daha');
  });

  it('never shows a number that contradicts the visible names when count and names disagree', () => {
    // Kick's total ahead of the names: headline keeps the total, remainder = total - shown,
    // and no hover list exists because no known name is hidden.
    const countAhead = buildMessageElement(message('', undefined, {
      id: 'gift:1:count-ahead',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 5,
        giftedUsernames: ['one', 'two', 'three'],
      },
    }));
    expect(countAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three ve 2 kişi daha');
    expect(countAhead.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();

    // Fewer names than the cap: the remainder still reconciles against the headline total.
    const oneNamed = buildMessageElement(message('', undefined, {
      id: 'gift:1:one-named',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'gifter', giftCount: 3, giftedUsernames: ['one'] },
    }));
    expect(oneNamed.textContent).toBe('🎁gifter 3 kişiye abonelik hediye etti: one ve 2 kişi daha');

    // More names than Kick's stated total: five real names outrank a smaller number.
    const namesAhead = buildMessageElement(message('', undefined, {
      id: 'gift:1:names-ahead',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 2,
        giftedUsernames: ['one', 'two', 'three', 'four', 'five'],
      },
    }));
    expect(namesAhead.querySelector('.kickflow-event-row__count')?.textContent).toBe('5');
    expect(namesAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three ve 2 kişi daha');
    // The two names beyond the cap are reachable by clicking the visible trigger, not via hover.
    expect(namesAhead.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
    namesAhead.querySelector<HTMLElement>('.kickflow-event-row__more')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(namesAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three, four, five');
  });

  it('falls back to the count-only gift row when recipients are empty or missing', () => {
    const empty = buildMessageElement(message('', undefined, {
      id: 'gift:1:empty',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'violet_demo', giftCount: 3, giftedUsernames: [] },
    }));
    expect(empty.textContent).toBe('🎁violet_demo 3 kişiye abonelik hediye etti');
    expect(empty.querySelector('.kickflow-event-row__recipients')).toBeNull();

    // A malformed producer (missing array) must degrade to the same row, never crash.
    const missing = buildMessageElement(message('', undefined, {
      id: 'gift:1:missing',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'violet_demo',
        giftCount: 3,
        giftedUsernames: undefined as unknown as string[],
      },
    }));
    expect(missing.textContent).toBe('🎁violet_demo 3 kişiye abonelik hediye etti');
  });

  it('renders a kicks row with safe user text, grouped amount, and optional fields', () => {
    const basic = buildMessageElement(message('', undefined, {
      id: 'kicks:txn-1',
      type: 'kicks',
      systemEvent: { kind: 'kicks', username: 'TallSkydiver', amount: 500, giftName: null, senderMessage: null },
    }));

    expect(basic.classList.contains('kickflow-event-row--kicks')).toBe(true);
    expect(basic.querySelector('.kickflow-event-row__icon')?.textContent).toBe('💰');
    expect(basic.querySelector('.kickflow-event-row__username')?.textContent).toBe('TallSkydiver');
    expect(basic.querySelector('.kickflow-event-row__count')?.textContent).toBe('500');
    expect(basic.textContent).toBe('💰TallSkydiver 500 KICKs hediye etti');

    const rich = buildMessageElement(message('', undefined, {
      id: 'kicks:txn-2',
      type: 'kicks',
      systemEvent: {
        kind: 'kicks',
        username: 'violet_demo<script>',
        amount: 1_234_567,
        giftName: 'Rage Quit',
        senderMessage: 'nice [emote:456:kek] <script>alert(1)</script>',
      },
    }));

    const count = rich.querySelector<HTMLElement>('.kickflow-event-row__count');
    // Large amounts are grouped for display, but the exact integer stays on the title.
    expect(count?.textContent).toBe('1.234.567');
    expect(count?.title).toBe('1234567');
    expect(rich.querySelector('.kickflow-event-row__username')?.textContent).toBe('violet_demo<script>');
    expect(rich.querySelector('.kickflow-event-row__gift')?.textContent).toBe('Rage Quit');
    // The sender message travels the same safe emote/link path as ordinary chat content.
    expect(rich.querySelector<HTMLImageElement>('.kickflow-event-row__note img.kickflow-emote')?.src)
      .toBe('https://files.kick.com/emotes/456/fullsize');
    expect(rich.textContent).toContain('<script>alert(1)</script>');
    expect(rich.querySelector('script, svg')).toBeNull();
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

  it('reconciles an existing deleted label when a later ban upgrades the message', () => {
    const item = message('alice', undefined, {
      preserved: true,
      preservedReason: 'deleted',
      preservedMeta: { aiModerated: false, deletedBy: 'delete-mod' },
    });
    const row = buildMessageElement(item);
    expect(row.classList.contains('kickflow-deleted')).toBe(true);

    item.preservedReason = 'banned';
    item.preservedMeta = { ...item.preservedMeta, permanent: true, bannedBy: 'ban-mod' };
    applyPreservedMarking(row, item);

    expect(row.classList.contains('kickflow-deleted')).toBe(false);
    expect(row.classList.contains('kickflow-banned')).toBe(true);
    expect(row.querySelectorAll('.kickflow-status-label')).toHaveLength(1);
    expect(row.querySelector('.kickflow-status-label')?.textContent).toBe('BANLANDI');
    expect(row.querySelector('.kickflow-mod-label')?.textContent).toBe('· ban-mod');
  });

  it('renders an authentic Kick SVG for a moderator role badge, with a tooltip', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'moderator' }]);

    const img = parent.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    expect(img?.src.startsWith('data:image/svg+xml')).toBe(true);
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
