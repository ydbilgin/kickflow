import { describe, expect, it } from 'vitest';
import { appendBadges, appendParsedContent, buildMessageElement } from '../../src/content/chat/message-view';
import type { ChatMessage } from '../../src/content/chat/message-store';

function message(slug: string, identity?: Partial<ChatMessage['sender']['identity']>): ChatMessage {
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
  };
}

describe('message-view safe rendering', () => {
  it('renders parsed emotes, mentions, links, and script-looking text safely', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'hi [emote:123:kek] @bob http://x.y <script>alert(1)</script>');

    const emote = parent.querySelector<HTMLImageElement>('img.kickflow-emote');
    expect(emote?.src).toBe('https://files.kick.com/emotes/123/fullsize');
    expect(parent.querySelector('.kickflow-mention')?.textContent).toBe('@bob');
    expect(parent.querySelector<HTMLAnchorElement>('a.kickflow-link')?.href).toBe('http://x.y/');
    expect(parent.textContent).toContain('<script>alert(1)</script>');
    expect(parent.querySelector('script')).toBeNull();
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

  it('does not link unsafe username slugs', () => {
    const row = buildMessageElement(message('../evil'));

    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    expect(username?.tagName).toBe('SPAN');
    expect(username?.textContent).toBe('Alice');
    expect(row.querySelector('a[href*="evil"]')).toBeNull();
  });

  it('renders BOTH a role badge (from `badges`) and a level image (from `badges_v2`), in sort_order', () => {
    const row = buildMessageElement(message('alice_123', {
      badges: [{ type: 'moderator', text: 'Moderator', sortOrder: 4 }],
      badgesV2: [{ name: 'level', imageUrl: 'https://ext.cdn.kick.com/chat/badges/1_x.png', level: 1, sortOrder: 1 }],
    }));

    const badgeContainer = row.querySelector('.kickflow-message__badges');
    const levelImg = badgeContainer?.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    const modChip = badgeContainer?.querySelector<HTMLElement>('.kickflow-badge-role');

    expect(levelImg?.src).toBe('https://ext.cdn.kick.com/chat/badges/1_x.png');
    expect(modChip?.title.startsWith('Moderatör')).toBe(true);

    // sortOrder 1 (level) < sortOrder 4 (moderator) — the level image must come first.
    const children = Array.from(badgeContainer?.children ?? []);
    expect(children.indexOf(levelImg!)).toBeLessThan(children.indexOf(modChip!));
  });

  it('renders a subscriber role chip with its months count', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'subscriber', count: 14 }]);

    const chip = parent.querySelector('.kickflow-badge-role');
    expect(chip).not.toBeNull();
    expect(chip?.querySelector('.kickflow-badge-role__count')?.textContent).toBe('14');
  });

  it('falls back to badge text for an unknown role type', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'weird', text: 'Weird' }]);

    expect(parent.querySelector('.kickflow-badge-role')).toBeNull();
    expect(parent.querySelector('.kickflow-badge-text')?.textContent).toBe('Weird');
  });
});
