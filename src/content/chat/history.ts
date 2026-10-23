import { logger } from '../shared/logger';
import { normalizeMessage } from './pusher-client';
import type { ChatMessage } from './message-store';

export interface OutageBoundary {
  readonly lastId: string;
  readonly lastAt: number;
  readonly messagesPerMs: number | null;
}

export function captureOutage(messages: readonly ChatMessage[]): OutageBoundary | null {
  const sample = messages.filter((m) => !m.systemEvent && Number.isFinite(Date.parse(m.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-25);
  const last = sample[sample.length - 1];
  if (!last) return null;
  const lastAt = Date.parse(last.createdAt);
  const span = lastAt - Date.parse(sample[0].createdAt);
  return { lastId: last.id, lastAt, messagesPerMs: span > 0 ? (sample.length - 1) / span : null };
}

/** Drop history outside the retained window. Estimate missing messages using the measured
 * pre-outage rate; a zero estimate still marks one reconnect boundary. */
export function planBackfill(
  history: readonly ChatMessage[], oldestShown: number | null, outage: OutageBoundary | null,
): { messages: ChatMessage[]; gap: { at: number; count: number | null; seconds: number } | null } {
  const sorted = [...history].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let gap = outage && sorted.length > 0 ? { at: outage.lastAt + 1, count: 0 as number | null, seconds: 0 } : null;
  if (outage && sorted.length > 0 && !sorted.some((m) => m.id === outage.lastId)) {
    const first = sorted.find((m) => Date.parse(m.createdAt) > outage.lastAt);
    if (first) {
      const elapsed = Date.parse(first.createdAt) - outage.lastAt;
      const expected = outage.messagesPerMs === null ? null : elapsed * outage.messagesPerMs;
      // One ordinary inter-message interval is not a hole, particularly on quiet channels.
      if (Date.parse(sorted[0].createdAt) > outage.lastAt && (expected === null ? elapsed > 3000 : expected > 2)) {
        gap = { at: outage.lastAt + 1, count: expected === null ? null : Math.max(1, Math.round(expected) - 1),
          seconds: Math.max(1, Math.round(elapsed / 1000)) };
      }
    }
  }
  return { messages: sorted.filter((m) => oldestShown === null || Date.parse(m.createdAt) >= oldestShown), gap };
}

export const historyUrl = (channelId: number, startTime?: string): string => {
  const base = `https://web.kick.com/api/v1/chat/${channelId}/history`;
  if (!startTime) return base;
  return `${base}?${new URLSearchParams({ start_time: startTime }).toString()}`;
};
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

export async function fetchChatHistoryResult(
  channelId: number,
  startTime?: string,
): Promise<ChatHistoryResult> {
  for (let attempt = 0; attempt < HISTORY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), HISTORY_FETCH_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(historyUrl(channelId, startTime), {
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
