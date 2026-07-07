import { describe, expect, it } from 'vitest';
import { appendBadges, appendParsedContent, buildMessageElement } from '../../src/content/chat/message-view';
import type { ChatMessage } from '../../src/content/chat/message-store';

function message(slug: string): ChatMessage {
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
      identity: { color: '', badges: [], badgesV2: [] },
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
});
