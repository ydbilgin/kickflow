import type { ChatMessage } from './message-store';
import { t } from '../shared/i18n';
import { REPLY_REQUEST_EVENT, REPLY_RESULT_ATTRIBUTE, type NativeReplyMessage, nativeChatReplyBlock } from '../../shared/reply-contract';

export type ReplyAction = (message: ChatMessage, cue: HTMLButtonElement) => void;

export function snapshotReplyTarget(message: ChatMessage): ChatMessage {
  return { ...message,
    sender: { ...message.sender, identity: { ...message.sender.identity,
      badges: message.sender.identity.badges.map(badge => ({ ...badge })),
      badgesV2: message.sender.identity.badgesV2.map(badge => ({ ...badge })),
    } },
    ...(message.replyContext ? { replyContext: { ...message.replyContext } } : {}),
  };
}

export function updateReplyAvailability(cue: HTMLButtonElement) {
  const blocked = nativeChatReplyBlock(cue.ownerDocument);
  if (blocked) {
    cue.setAttribute('aria-disabled', 'true');
    cue.title = t(`chat.reply_${blocked}`);
  } else {
    cue.removeAttribute('aria-disabled');
    cue.title = cue.getAttribute('aria-label') ?? '';
  }
  return blocked;
}

/** Every non-lock failure names its own next step and carries its result code, so a
 * screenshot of the line is enough to tell which contract check failed. */
export function replyFailureText(result: string | null): string {
  if (result === null) return `${t('chat.reply_no_bridge')} [no-bridge]`;
  if (result === 'wrong-room') return `${t('chat.reply_wrong_room')} [wrong-room]`;
  return `${t('chat.reply_unavailable')} [${result}]`;
}

export function requestNativeReply(message: ChatMessage, cue: HTMLButtonElement, sessionKey: string): boolean {
  const context = message.replyContext;
  const native: NativeReplyMessage = {
    id: message.id, chatroom_id: message.chatroomId, content: message.content,
    created_at: message.createdAt, type: message.type === 'reply' ? 'reply' : 'message',
    sender: { id: message.sender.id, username: message.sender.username, slug: message.sender.slug,
      identity: { color: message.sender.identity.color,
        badges: message.sender.identity.badges.map(badge => ({ type: badge.type, count: badge.count })) } },
    thread_parent_id: context?.threadParentId ?? null,
    ...(context ? { metadata: {
      original_sender: { id: context.replyToUserId ?? null, username: context.replyToUser },
      original_message: { id: context.replyToMessageId ?? null, content: context.replyToText },
    } } : {}),
  };
  cue.removeAttribute(REPLY_RESULT_ATTRIBUTE);
  const blocked = updateReplyAvailability(cue);
  if (blocked) cue.setAttribute(REPLY_RESULT_ATTRIBUTE, blocked);
  else cue.dispatchEvent(new CustomEvent(REPLY_REQUEST_EVENT, { bubbles: true, detail: JSON.stringify({ sessionKey, message: native }) }));
  const selected = cue.getAttribute(REPLY_RESULT_ATTRIBUTE) === 'selected';
  const row = cue.closest('.kickflow-message');
  let status = row?.querySelector<HTMLElement>('.kickflow-message__reply-status');
  if (selected) status?.remove();
  else if (row) {
    if (!status) {
      status = document.createElement('span');
      status.className = 'kickflow-message__reply-status';
      status.setAttribute('role', 'status');
      row.append(status);
    }
    status.textContent = blocked ? t(`chat.reply_${blocked}`) : replyFailureText(cue.getAttribute(REPLY_RESULT_ATTRIBUTE));
  }
  return selected;
}
