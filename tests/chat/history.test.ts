import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHistoryBackfill, fetchChatHistory } from '../../src/content/chat/history';
import { normalizeMessage } from '../../src/content/chat/pusher-client';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function rawMessage(id: string, createdAt: string): unknown {
  return {
    id,
    chatroom_id: 1,
    content: id,
    type: 'message',
    created_at: createdAt,
    sender: {
      id: 7,
      username: 'user7',
      slug: 'user7',
      identity: { color: '', badges: [], badges_v2: [] },
    },
  };
}

describe('fetchChatHistory', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a transient 429 and returns the successful backfill', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200, {
        data: {
          messages: [
            rawMessage('later', '2026-01-01T00:00:02Z'),
            rawMessage('earlier', '2026-01-01T00:00:01Z'),
          ],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchChatHistory(123);
    await vi.advanceTimersByTimeAsync(800);
    const messages = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://web.kick.com/api/v1/chat/123/history');
    expect(messages.map((message) => message.id)).toEqual(['earlier', 'later']);
  });
});

describe('ChatHistoryBackfill', () => {
  it('queues another fetch when a reconnect occurs during an in-flight backfill', async () => {
    let releaseFirst: ((messages: NonNullable<ReturnType<typeof normalizeMessage>>[]) => void) | null = null;
    const fetchHistory = vi
      .fn()
      .mockImplementationOnce(() => new Promise<NonNullable<ReturnType<typeof normalizeMessage>>[]>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValueOnce([normalizeMessage(rawMessage('reconnect', '2026-01-01T00:00:02Z'))!]);
    const received: string[][] = [];
    const backfill = new ChatHistoryBackfill(123, {
      isDisposed: () => false,
      onMessages: (messages) => received.push(messages.map((message) => message.id)),
    }, fetchHistory);

    backfill.request();
    backfill.request(); // a reconnect before the first history response arrives
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    releaseFirst?.([normalizeMessage(rawMessage('initial', '2026-01-01T00:00:01Z'))!]);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchHistory).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([['initial'], ['reconnect']]);
  });
});
