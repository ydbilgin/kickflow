import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserMessageList, scrollUserMessageListToLatest } from '../../src/content/chat/user-message-list';
import { archivedMessage } from '../helpers/chat-message';
import { setLang } from '../../src/content/shared/i18n';

describe('user-message-list', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders one row per message in oldest-first order with message ids', () => {
    const root = buildUserMessageList({
      messages: [
        archivedMessage('old', { at: Date.parse('2026-08-01T10:01:00.000Z') }),
        archivedMessage('new', { at: Date.parse('2026-08-01T10:02:00.000Z') }),
      ],
      truncated: false,
    });

    expect(Array.from(root.querySelectorAll('.kickflow-user-messages__row')).map((row) => row.dataset.messageId))
      .toEqual(['old', 'new']);
  });

  it('renders emote tokens as images instead of literal token text', () => {
    const root = buildUserMessageList({
      messages: [archivedMessage('emote', { text: 'hello [emote:123:name]' })],
      truncated: false,
    });

    const row = root.querySelector('.kickflow-user-messages__row');
    expect(row?.querySelector('img')).not.toBeNull();
    expect(row?.textContent).not.toContain('[emote:123:name]');
  });

  it('renders compact message content without an anchor', () => {
    const root = buildUserMessageList({
      messages: [archivedMessage('compact', { text: 'https://example.com @viewer' })],
      truncated: false,
    });

    expect(root.querySelector('.kickflow-user-messages__row a')).toBeNull();
  });

  it('marks a deleted message row with the deleted modifier', () => {
    const root = buildUserMessageList({
      messages: [archivedMessage('deleted', { deleted: true })],
      truncated: false,
    });

    expect(root.querySelector('.kickflow-user-messages__row')?.classList.contains('kickflow-user-messages__row--deleted'))
      .toBe(true);
  });

  it('renders the truncation note only when truncated', () => {
    const truncated = buildUserMessageList({ messages: [archivedMessage('m')], truncated: true });
    const complete = buildUserMessageList({ messages: [archivedMessage('m')], truncated: false });

    expect(truncated.querySelector('.kickflow-user-messages__note')).not.toBeNull();
    expect(complete.querySelector('.kickflow-user-messages__note')).toBeNull();
  });

  it('renders an empty message state without a scroller', () => {
    const root = buildUserMessageList({ messages: [], truncated: false });

    expect(root.querySelector('.kickflow-user-messages__empty')).not.toBeNull();
    expect(root.querySelector('.kickflow-user-messages__body')).toBeNull();
    expect(root.querySelector('.kickflow-user-messages__count')?.textContent).toBe('0');
  });

  // Regression: the scroll used to run inside the builder, where the element is still detached and
  // scrollHeight reads 0 — the list silently opened on the OLDEST message instead of the newest.
  it('leaves the scroller untouched at build time and scrolls to the newest row once mounted', () => {
    const root = buildUserMessageList({
      messages: [archivedMessage('a'), archivedMessage('b')],
      truncated: false,
    });
    const body = root.querySelector<HTMLElement>('.kickflow-user-messages__body');
    expect(body).not.toBeNull();
    Object.defineProperty(body, 'scrollHeight', { value: 640, configurable: true });

    expect(body?.scrollTop).toBe(0);
    document.body.appendChild(root);
    scrollUserMessageListToLatest(root);

    expect(body?.scrollTop).toBe(640);
  });

  it('scrolling a card without a message list is a no-op', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    expect(() => scrollUserMessageListToLatest(card)).not.toThrow();
  });

  it('renders the answered message above a reply, with its emotes parsed', () => {
    const root = buildUserMessageList({
      messages: [archivedMessage('m1', {
        text: 'bende de öyleydi',
        replyTo: { user: 'keperiks', text: 'ben 3 ayda topladım [emote:9:ok]', messageId: 'src' },
      })],
      truncated: false,
    });

    const reply = root.querySelector('.kickflow-user-messages__reply');
    expect(reply?.querySelector('.kickflow-user-messages__replyUser')?.textContent).toBe('keperiks');
    expect(reply?.textContent).toContain('ben 3 ayda topladım');
    expect(reply?.querySelector('img')).not.toBeNull();
    expect(reply?.querySelector('a')).toBeNull();
  });

  it('renders no reply block when the message is not a reply', () => {
    const root = buildUserMessageList({ messages: [archivedMessage('m1')], truncated: false });

    expect(root.querySelector('.kickflow-user-messages__reply')).toBeNull();
  });

  it('prints the clock once per minute instead of on every row', () => {
    const minute = Date.parse('2026-08-01T20:10:00.000Z');
    const root = buildUserMessageList({
      messages: [
        archivedMessage('a', { at: minute }),
        archivedMessage('b', { at: minute + 20_000 }),
        archivedMessage('c', { at: minute + 61_000 }),
      ],
      truncated: false,
    });

    const stamps = Array.from(root.querySelectorAll('.kickflow-user-messages__time'))
      .map((node) => node.textContent);
    expect(stamps).toHaveLength(3);
    expect(stamps[0]).not.toBe('');
    expect(stamps[1]).toBe('');
    expect(stamps[2]).not.toBe('');
    expect(stamps[2]).not.toBe(stamps[0]);
  });

  it('jumps on a left click and ignores a right click', () => {
    const ownList = document.createElement('div');
    ownList.id = 'kickflow-message-list';
    const target = document.createElement('div');
    target.dataset.messageId = 'm1';
    ownList.appendChild(target);
    document.body.appendChild(ownList);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const root = buildUserMessageList({ messages: [archivedMessage('m1')], truncated: false });
    const row = root.querySelector<HTMLElement>('.kickflow-user-messages__row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }));

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
