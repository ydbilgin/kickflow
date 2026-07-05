import { logger } from '../shared/logger';
import { normalizeMessage } from './pusher-client';
import type { ChatMessage } from './message-store';

// Confirmed live 2026-07-05 (network capture on kick.com): this is the endpoint native chat
// loads its backlog from. Host is web.kick.com (v1), and the id is the CHANNEL id
// (chatroom.channel_id / the channel's own `id`), NOT the Pusher chatroom id — the chatroom id
// returns an empty list here. web.kick.com CORS-allows the kick.com origin (the native page,
// on kick.com, makes exactly this cross-subdomain request), so the content-script fetch works
// without host_permissions. Each history message carries the same `sender` shape as a Pusher
// ChatMessageEvent, so normalizeMessage handles it unchanged.
const historyUrl = (channelId: number): string => `https://web.kick.com/api/v1/chat/${channelId}/history`;

/** Fetch recent chat backlog so the overlay opens WITH history instead of empty (native chat
 * shows it; hiding native would otherwise wipe it). Returns oldest-first. Best-effort: any
 * failure returns [] and the overlay simply starts from live messages. */
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
    // Chat flows oldest→newest (top→bottom). The endpoint's order isn't guaranteed, so sort
    // by created_at ascending; unparseable timestamps sink to the top (treated as oldest).
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
