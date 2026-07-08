import { logger } from '../shared/logger';
import { normalizeMessage } from './pusher-client';
import type { ChatMessage } from './message-store';

const historyUrl = (channelId: number): string => `https://web.kick.com/api/v1/chat/${channelId}/history`;
const HISTORY_MAX_ATTEMPTS = 3;
const HISTORY_RETRY_BASE_MS = 800;

export async function fetchChatHistory(channelId: number): Promise<ChatMessage[]> {
  for (let attempt = 0; attempt < HISTORY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(historyUrl(channelId), { headers: { accept: 'application/json' } });
      if (!response.ok) {
        logger.debug('history: fetch failed, status', response.status);
        const transient = response.status === 429 || response.status >= 500;
        if (!transient) return [];
      } else {
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
      }
    } catch (error) {
      logger.info('history: fetch threw', error);
    }

    if (attempt < HISTORY_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, HISTORY_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  logger.debug('history: fetch exhausted retries');
  return [];
}
