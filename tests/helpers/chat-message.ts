import type { ArchivedMessage } from '../../src/content/chat/user-message-archive';
import type { ChatMessage, ChatSystemEvent, ReplyContext } from '../../src/content/chat/message-store';

export interface ChatMessageFixtureOptions {
  userId?: number;
  content?: string;
  createdAt?: string;
  systemEvent?: ChatSystemEvent;
  replyContext?: ReplyContext;
}

export function chatMessage(id: string, options: ChatMessageFixtureOptions = {}): ChatMessage {
  const userId = options.userId ?? 1;
  return {
    id,
    chatroomId: 1,
    content: options.content ?? id,
    type: 'message',
    createdAt: options.createdAt ?? new Date().toISOString(),
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    systemEvent: options.systemEvent,
    replyContext: options.replyContext,
    preserved: false,
  };
}

export function archivedMessage(
  id: string,
  options: Partial<Omit<ArchivedMessage, 'id'>> = {},
): ArchivedMessage {
  return {
    id,
    userId: options.userId ?? 1,
    at: options.at ?? Date.parse('2026-08-01T12:00:00.000Z'),
    replyTo: options.replyTo ?? null,
    text: options.text ?? id,
    deleted: options.deleted ?? false,
  };
}
