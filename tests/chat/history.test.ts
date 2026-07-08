import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchChatHistory } from '../../src/content/chat/history';

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
