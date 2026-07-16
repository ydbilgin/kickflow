import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHistoryBackfill, fetchChatHistory, fetchChatHistoryResult } from '../../src/content/chat/history';
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

  it('distinguishes a legitimate empty history from a terminal response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: { messages: [] } }))
      .mockResolvedValueOnce(response(404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChatHistoryResult(123)).resolves.toEqual({ status: 'success', messages: [] });
    await expect(fetchChatHistoryResult(123)).resolves.toMatchObject({ status: 'error', reason: 'terminal-http' });
  });

  it('preserves reply context from a realistic history message with stringified metadata', async () => {
    const historyReply = {
      id: 'e007f390-e69b-4f60-bd0c-1e827ce6efc9',
      chatroom_id: 25314085,
      content: 'ATAM',
      type: 'reply',
      created_at: '2026-07-16T21:04:37+00:00',
      sender: {
        id: 27903497,
        username: 'Prof_AmoLocus',
        slug: 'prof-amolocus',
        identity: {
          color: '#FFFFFF',
          badges: [{ type: 'subscriber', text: 'Subscriber', count: 4, sort_order: 9 }],
          badges_v2: [{
            name: 'level', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/28_x.png',
            metadata: { level: 28 }, selected: true, sort_order: 1,
          }],
        },
      },
      metadata: JSON.stringify({
        original_message: { id: 'parent-uuid', content: 'MUSTAFA KEMAL ATATÜRK' },
        original_sender: { id: 7424588, username: 'Alcheyham' },
        message_ref: '1784235877280',
      }),
      thread_parent_id: 'parent-uuid',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, {
      data: { messages: [historyReply] },
    })));

    const messages = await fetchChatHistory(25602397);

    expect(messages[0]?.replyContext).toMatchObject({
      replyToUser: 'Alcheyham',
      replyToText: 'MUSTAFA KEMAL ATATÜRK',
      replyToMessageId: 'parent-uuid',
    });
  });

  it('aborts a hung attempt and reports exhaustion after bounded retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchChatHistoryResult(123);
    await vi.advanceTimersByTimeAsync(6_000 + 800 + 6_000 + 1_600 + 6_000);

    await expect(pending).resolves.toMatchObject({ status: 'error', reason: 'exhausted' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
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

  it('surfaces success-empty and terminal states independently from message delivery', async () => {
    const onMessages = vi.fn();
    const onResult = vi.fn();
    const backfill = new ChatHistoryBackfill(123, {
      isDisposed: () => false,
      onMessages,
      onResult,
    }, vi.fn().mockResolvedValue({ status: 'success', messages: [] }));

    backfill.request();
    await Promise.resolve();
    await Promise.resolve();

    expect(onMessages).toHaveBeenCalledWith([]);
    expect(onResult).toHaveBeenCalledWith({ status: 'success', messages: [] });
  });
});
