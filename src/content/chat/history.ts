import { logger } from '../shared/logger';
import { normalizeMessage } from './pusher-client';
import type { ChatMessage } from './message-store';

const historyUrl = (channelId: number): string => `https://web.kick.com/api/v1/chat/${channelId}/history`;
const HISTORY_MAX_ATTEMPTS = 3;
const HISTORY_RETRY_BASE_MS = 800;
export const HISTORY_FETCH_ATTEMPT_TIMEOUT_MS = 6_000;

export type ChatHistoryResult =
  | { status: 'success'; messages: ChatMessage[] }
  | { status: 'error'; reason: 'terminal-http' | 'invalid-response' | 'exhausted'; statusCode?: number };

export interface ChatHistoryBackfillCallbacks {
  isDisposed(): boolean;
  onMessages(messages: readonly ChatMessage[]): void;
  onResult?(result: ChatHistoryResult): void;
}

type HistoryFetcher = (channelId: number) => Promise<ChatMessage[] | ChatHistoryResult>;

/** Serializes history requests triggered by initial connection and later reconnects. A reconnect
 * that happens while a fetch is in flight queues exactly one follow-up request, so it cannot
 * create a permanent socket-outage gap or an unbounded fetch fan-out. */
export class ChatHistoryBackfill {
  private running = false;
  private requested = false;

  constructor(
    private readonly channelId: number,
    private readonly callbacks: ChatHistoryBackfillCallbacks,
    private readonly fetchHistory: HistoryFetcher = fetchChatHistoryResult,
  ) {}

  request(): void {
    this.requested = true;
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.requested && !this.callbacks.isDisposed()) {
        this.requested = false;
        const fetched = await this.fetchHistory(this.channelId);
        const result: ChatHistoryResult = Array.isArray(fetched)
          ? { status: 'success', messages: fetched }
          : fetched;
        if (this.callbacks.isDisposed()) continue;
        this.callbacks.onResult?.(result);
        if (result.status === 'success') this.callbacks.onMessages(result.messages);
      }
    } finally {
      this.running = false;
      if (this.requested && !this.callbacks.isDisposed()) void this.run();
    }
  }
}

/** Compatibility array API used by callers that only need rows. New readiness code consumes the
 * result API below so a valid empty history is not confused with a failed request. */
export async function fetchChatHistory(channelId: number): Promise<ChatMessage[]> {
  const result = await fetchChatHistoryResult(channelId);
  return result.status === 'success' ? result.messages : [];
}

export async function fetchChatHistoryResult(channelId: number): Promise<ChatHistoryResult> {
  for (let attempt = 0; attempt < HISTORY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), HISTORY_FETCH_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(historyUrl(channelId), {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.debug('history: fetch failed, status', response.status);
        const transient = response.status === 429 || response.status >= 500;
        if (!transient) return { status: 'error', reason: 'terminal-http', statusCode: response.status };
      } else {
        const json = (await response.json()) as { data?: { messages?: unknown[] } };
        const raw = json?.data?.messages;
        if (!Array.isArray(raw)) return { status: 'error', reason: 'invalid-response' };

        const messages: ChatMessage[] = [];
        for (const item of raw) {
          const message = normalizeMessage(item);
          if (message) messages.push(message);
        }
        if (raw.length > 0 && messages.length === 0) {
          return { status: 'error', reason: 'invalid-response' };
        }
        messages.sort((a, b) => {
          const ta = Date.parse(a.createdAt);
          const tb = Date.parse(b.createdAt);
          return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
        });
        logger.debug('history: backfilled', messages.length, 'messages');
        return { status: 'success', messages };
      }
    } catch (error) {
      logger.info('history: fetch threw', error);
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (attempt < HISTORY_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, HISTORY_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  logger.debug('history: fetch exhausted retries');
  return { status: 'error', reason: 'exhausted' };
}
