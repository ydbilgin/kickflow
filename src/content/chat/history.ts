import { logger } from '../shared/logger';
import { normalizeMessage } from './pusher-client';
import type { ChatMessage } from './message-store';

const historyUrl = (channelId: number): string => `https://web.kick.com/api/v1/chat/${channelId}/history`;

export async function fetchChatHistory(channelId: number): Promise<ChatMessage[]> {
  try {
    const response = await fetch(historyUrl(channelId), { headers: { accept: 'application/json' } });
    if (!response.ok) {
      logger.warn('history: fetch failed, status', response.status);
      return [];
    }
    const json = (await response.json()) as { data?: { messages?: unknown[] } };
    const raw = json?.data?.messages;
    if (!Array.isArray(raw)) return [];

    const messages: ChatMessage[] = [];
    for (const item of raw) {
      const message = normalizeMessage(item);
      if (message) messages.push(message);
    }
    messages.sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
    logger.debug('history: backfilled', messages.length, 'messages');
    return messages;
  } catch (error) {
    logger.warn('history: fetch threw', error);
    return [];
  }
}
