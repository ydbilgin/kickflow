import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPreservedMarking, buildMessageElement } from '../../src/content/chat/message-view';
import { chatMessage } from '../helpers/chat-message';

afterEach(() => document.body.replaceChildren());

function mounted(id = 'target-message') {
  const onReply = vi.fn();
  const message = chatMessage(id, { content: 'the exact original', userId: 42 });
  const row = buildMessageElement(message, { onReply });
  document.body.append(row);
  return { message, row, onReply, button: row.querySelector<HTMLButtonElement>('.kickflow-message__reply-action') };
}

describe('starting a reply from a KickFlow row', () => {
  it('has an accessible native button independently of the native virtualized row', () => {
    const { button } = mounted();
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.type).toBe('button');
    expect(button!.getAttribute('aria-label')).toContain('user42');
    expect(document.querySelector('#chatroom-messages')).toBeNull();
  });

  it('selects the clicked message, not the newest message or the reply preview parent', () => {
    const first = mounted('first');
    const second = mounted('second');
    expect(first.button).not.toBeNull();
    first.button!.click();
    expect(first.onReply).toHaveBeenCalledOnce();
    expect(first.onReply.mock.calls[0][0]).toMatchObject({ id: 'first', chatroomId: 1, content: 'the exact original' });
    expect(second.onReply).not.toHaveBeenCalled();
  });

  it('captures the target at render time instead of reading a recycled or mutated row', () => {
    const fixture = mounted('original');
    fixture.message.id = 'recycled';
    fixture.message.content = 'replacement';
    fixture.message.sender.username = 'another-user';
    fixture.row.dataset.messageId = 'recycled';
    expect(fixture.button).not.toBeNull();
    fixture.button!.click();
    expect(fixture.onReply.mock.calls[0][0]).toMatchObject({ id: 'original', content: 'the exact original', sender: { username: 'user42' } });
  });

  it('restores the action after a render replacement', () => {
    const fixture = mounted();
    const replacement = buildMessageElement(fixture.message, { onReply: fixture.onReply });
    fixture.row.replaceWith(replacement);
    const button = replacement.querySelector<HTMLButtonElement>('.kickflow-message__reply-action');
    expect(button).not.toBeNull();
    button!.click();
    expect(fixture.onReply).toHaveBeenCalledOnce();
  });

  it('keeps the reply preview separate from the new reply action', () => {
    const onReply = vi.fn();
    const row = buildMessageElement(chatMessage('child', { replyContext: {
      replyToMessageId: 'parent', replyToUser: 'parentUser', replyToUserId: 7,
      replyToText: 'parent text', threadParentId: 'thread-root',
    } }), { onReply });
    document.body.append(row);
    const button = row.querySelector<HTMLButtonElement>('.kickflow-message__reply-action');
    expect(button).not.toBeNull();
    button!.click();
    expect(onReply.mock.calls[0][0].id).toBe('child');
    expect(row.querySelector('.kickflow-message__reply-context')).not.toBeNull();
  });

  it('never adds a reply action to preserved messages or a read-only renderer', () => {
    const message = chatMessage('removed');
    message.preserved = true;
    expect(buildMessageElement(message, { onReply: vi.fn() }).querySelector('.kickflow-message__reply-action')).toBeNull();
    expect(buildMessageElement(chatMessage('vod')).querySelector('.kickflow-message__reply-action')).toBeNull();
  });

  it('removes a rendered action when moderation preserves the message later', () => {
    const fixture = mounted(); expect(fixture.button).not.toBeNull();
    fixture.message.preserved = true;
    applyPreservedMarking(fixture.row, fixture.message);
    expect(fixture.row.querySelector('.kickflow-message__reply-action')).toBeNull();
    expect(fixture.row.classList.contains('kickflow-message--can-reply')).toBe(false);
  });
});
