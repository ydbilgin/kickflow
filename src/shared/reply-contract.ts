/** Local composer selection only. This bridge has no send or network operation. */
export const REPLY_REQUEST_EVENT = 'kickflow:select-reply-v1';
export const REPLY_RESULT_ATTRIBUTE = 'data-kickflow-reply-result';
export const NATIVE_CHAT_EDITOR = '[data-testid="chat-input"][contenteditable="true"]';

export interface NativeReplyMessage {
  id: string;
  chatroom_id: number;
  content: string;
  type: 'message' | 'reply';
  created_at: string;
  sender: {
    id: number;
    username: string;
    slug: string;
    identity: { color: string; badges: Array<{ type?: string; count?: number }> };
  };
  thread_parent_id?: string | null;
  metadata?: {
    original_sender: { id: number | null; username: string | null };
    original_message: { id: string | null; content: string | null };
  };
}

export interface ReplyRequest { sessionKey: string; message: NativeReplyMessage }
export type ChatReplyBlock = 'followers_only' | 'subscribers_only' | 'login_required' | 'rules_required' | 'no_editor';
export type ReplyResult = 'selected' | 'unavailable' | 'wrong-room' | 'invalid-target' | ChatReplyBlock;

export const NATIVE_CHAT_FOOTER = '#chatroom-footer';

function shownInPage(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if ((node as HTMLElement).hidden || getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** The chat footer the viewer is looking at.
 * Measured 2026-11-22 (Next 16.4.5, React 19.3 canary): after an in-page channel change
 * (a sidebar or search link, no page load) Kick keeps the previous channel's whole chatroom
 * mounted under a `display: none !important` wrapper, so the page holds two #chatroom-footer
 * blocks, each with an editable chat-input. Only the rendered one belongs to the current route.
 * Several rendered footers stay ambiguous (null): never guess between visible peers. */
export function liveChatFooter(root: Document = document): Element | null {
  const footers = [...root.querySelectorAll(NATIVE_CHAT_FOOTER)];
  if (footers.length <= 1) return footers[0] ?? null;
  const shown = footers.filter(shownInPage);
  return shown.length === 1 ? shown[0]! : null;
}

/** Only describe an observed native lock. Mode labels alone do not block a usable editor. */
export function nativeChatReplyBlock(root: Document = document): ChatReplyBlock | null {
  const footer = liveChatFooter(root);
  if (!footer || footer.querySelector(NATIVE_CHAT_EDITOR)) return null;
  const text = (footer.textContent ?? '').toLocaleLowerCase('tr-TR');
  if (/kurallar[ıi].*kabul|accept.*(?:chat )?rules|agree.*rules/.test(text)) return 'rules_required';
  if (/giriş yap|oturum aç|log ?in|sign in/.test(text)) return 'login_required';
  if (/abonelere özel|yalnızca aboneler|subscriber[s]?[- ]only/.test(text)) return 'subscribers_only';
  if (/takipçilere özel|yalnızca takipçiler|follower[s]?[- ]only/.test(text)) return 'followers_only';
  return 'no_editor';
}

/** Project rather than forwarding arbitrary page/event properties. */
export function parseReplyRequest(raw: unknown): ReplyRequest | null {
  if (typeof raw !== 'string' || raw.length > 40_000) return null;
  try {
    const value = JSON.parse(raw) as ReplyRequest;
    const message = value?.message;
    const sender = message?.sender;
    if (typeof value.sessionKey !== 'string' || value.sessionKey.length > 150
      || !message || typeof message.id !== 'string' || !message.id || message.id.length > 200
      || !Number.isSafeInteger(message.chatroom_id) || message.chatroom_id <= 0
      || typeof message.content !== 'string' || message.content.length > 10_000
      || !['message', 'reply'].includes(message.type) || typeof message.created_at !== 'string'
      || !sender || !Number.isSafeInteger(sender.id) || sender.id <= 0
      || typeof sender.username !== 'string' || !sender.username || sender.username.length > 100
      || typeof sender.slug !== 'string' || typeof sender.identity?.color !== 'string'
      || !Array.isArray(sender.identity.badges)
      || (message.thread_parent_id != null && (typeof message.thread_parent_id !== 'string' || message.thread_parent_id.length > 200))) return null;
    const clean: NativeReplyMessage = {
      id: message.id, chatroom_id: message.chatroom_id, content: message.content,
      type: message.type, created_at: message.created_at,
      sender: { id: sender.id, username: sender.username, slug: sender.slug,
        identity: { color: sender.identity.color, badges: sender.identity.badges.slice(0, 30).map(badge => ({
          ...(typeof badge?.type === 'string' ? { type: badge.type } : {}),
          ...(typeof badge?.count === 'number' ? { count: badge.count } : {}),
        })) } },
      thread_parent_id: message.thread_parent_id ?? null,
    };
    if (message.metadata) {
      const { original_sender: originalSender, original_message: originalMessage } = message.metadata;
      if (!originalSender || !originalMessage
        || (originalSender.username !== null && typeof originalSender.username !== 'string')
        || (originalSender.id !== null && !Number.isSafeInteger(originalSender.id))
        || (originalMessage.id !== null && typeof originalMessage.id !== 'string')
        || (originalMessage.content !== null && typeof originalMessage.content !== 'string')) return null;
      clean.metadata = {
        original_sender: { id: originalSender.id, username: originalSender.username },
        original_message: { id: originalMessage.id, content: originalMessage.content },
      };
    }
    return { sessionKey: value.sessionKey, message: clean };
  } catch { return null; }
}
