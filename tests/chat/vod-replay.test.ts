import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import type { ChatMessage } from '../../src/content/chat/message-store';
import {
  VodChatReplayController,
  fetchVodMetadataResult,
  type VodChatReplayCallbacks,
  type VodChatReplayDependencies,
} from '../../src/content/chat/vod-replay';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const VOD_START = '2026-07-25T18:12:38Z';

/** A message whose own timestamp sits `offsetSeconds` into the VOD. */
function messageAt(id: string, offsetSeconds: number): ChatMessage {
  return {
    ...message(id),
    createdAt: new Date(Date.parse(VOD_START) + offsetSeconds * 1_000).toISOString(),
  };
}

function message(id: string): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content: id,
    type: 'message',
    createdAt: VOD_START,
    sender: {
      id: 1,
      username: 'user',
      slug: 'user',
      identity: { color: '', badges: [], badgesV2: [] },
    },
  };
}

function controllableVideo(): {
  video: HTMLVideoElement;
  setPaused(value: boolean): void;
} {
  const video = document.createElement('video');
  video.id = 'video-player';
  let paused = true;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => paused,
  });
  return {
    video,
    setPaused: (value) => {
      paused = value;
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setupController(
  fetchHistory: ReturnType<typeof vi.fn>,
  callbacks: Partial<VodChatReplayCallbacks> = {},
): {
  lifecycle: Lifecycle;
  video: HTMLVideoElement;
  setPaused(value: boolean): void;
  controller: VodChatReplayController;
  onReset: ReturnType<typeof vi.fn>;
  onMessages: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onUnavailable: ReturnType<typeof vi.fn>;
} {
  const lifecycle = new Lifecycle();
  const { video, setPaused } = controllableVideo();
  const onReset = vi.fn();
  const onMessages = vi.fn();
  const onReady = vi.fn();
  const onUnavailable = vi.fn();
  const dependencies: VodChatReplayDependencies = {
    fetchMetadata: vi.fn().mockResolvedValue({
      status: 'success',
      startTimeMs: Date.parse('2026-07-25T18:12:38Z'),
    }),
    fetchHistory,
    observeVideo: (_lifecycle, callback) => callback(video),
  };
  const controller = new VodChatReplayController(
    lifecycle,
    24783370,
    '019f9a7a-a9f0-76a9-873c-705f620bfcc9',
    { onReset, onMessages, onReady, onUnavailable, ...callbacks },
    dependencies,
  );
  return {
    lifecycle,
    video,
    setPaused,
    controller,
    onReset,
    onMessages,
    onReady,
    onUnavailable,
  };
}

describe('fetchVodMetadataResult', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects the exact VOD and validates its start time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      data: [
        { id: 'other', start_time: '2026-07-24T18:00:00Z' },
        {
          id: 'target',
          start_time: '2026-07-25T18:12:38Z',
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVodMetadataResult(24783370, 'target')).resolves.toEqual({
      status: 'success',
      startTimeMs: Date.parse('2026-07-25T18:12:38Z'),
    });
    expect(fetchMock.mock.calls[0]?.[0])
      .toBe('https://web.kick.com/api/v1/channels/24783370/videos');
  });

  it('rejects missing ids, malformed times, malformed bodies, and HTTP failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: [{ id: 'other', start_time: '2026-07-25T18:12:38Z' }] }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'target', start_time: 'not-a-date' }] }))
      .mockResolvedValueOnce(response(200, { data: {} }))
      .mockResolvedValueOnce(response(404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVodMetadataResult(1, 'target')).resolves.toMatchObject({ status: 'error', reason: 'missing-video' });
    await expect(fetchVodMetadataResult(1, 'target')).resolves.toMatchObject({ status: 'error', reason: 'invalid-start-time' });
    await expect(fetchVodMetadataResult(1, 'target')).resolves.toMatchObject({ status: 'error', reason: 'invalid-response' });
    await expect(fetchVodMetadataResult(1, 'target')).resolves.toMatchObject({ status: 'error', reason: 'http' });
  });
});

describe('VodChatReplayController', () => {
  it('tracks five-second playback buckets, pauses, and immediately resets on a paused seek', async () => {
    const fetchHistory = vi.fn().mockResolvedValue({ status: 'success', messages: [] });
    const setup = setupController(fetchHistory);

    await setup.controller.start();
    await flushAsync();
    // The fetch anchors one bucket AHEAD, because Kick returns the window ENDING at start_time.
    expect(fetchHistory).toHaveBeenLastCalledWith(24783370, '2026-07-25T18:12:43.000Z');

    setup.setPaused(false);
    setup.video.currentTime = 4.9;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    expect(fetchHistory).toHaveBeenCalledTimes(1);

    setup.video.currentTime = 5.1;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    expect(fetchHistory).toHaveBeenLastCalledWith(24783370, '2026-07-25T18:12:48.000Z');

    setup.setPaused(true);
    setup.video.currentTime = 10.2;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    expect(fetchHistory).toHaveBeenCalledTimes(2);

    setup.video.dispatchEvent(new Event('seeking'));
    setup.video.currentTime = 60;
    setup.video.dispatchEvent(new Event('seeked'));
    await flushAsync();
    expect(setup.onReset).toHaveBeenCalledTimes(1);
    expect(fetchHistory).toHaveBeenLastCalledWith(24783370, '2026-07-25T18:13:43.000Z');
    setup.lifecycle.dispose();
  });

  it('drops an old in-flight window after seek and renders only the new epoch', async () => {
    let releaseOld!: (value: { status: 'success'; messages: ChatMessage[] }) => void;
    const oldResult = new Promise<{ status: 'success'; messages: ChatMessage[] }>((resolve) => {
      releaseOld = resolve;
    });
    const fetchHistory = vi
      .fn()
      .mockReturnValueOnce(oldResult)
      .mockResolvedValueOnce({ status: 'success', messages: [message('new-window')] });
    const setup = setupController(fetchHistory);

    await setup.controller.start();
    setup.video.dispatchEvent(new Event('seeking'));
    setup.video.currentTime = 120;
    setup.video.dispatchEvent(new Event('seeked'));
    releaseOld({ status: 'success', messages: [message('old-window')] });
    await flushAsync();
    await flushAsync();

    expect(setup.onMessages).toHaveBeenCalledTimes(1);
    expect(setup.onMessages).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'new-window' })],
      Date.parse('2026-07-25T18:12:38Z'),
    );
    expect(setup.onReady).toHaveBeenCalledTimes(1);
    setup.lifecycle.dispose();
  });

  it('releases a fetched window at the rate the playhead reaches it, not in one lump', async () => {
    const fetchHistory = vi.fn().mockResolvedValue({
      status: 'success',
      messages: [messageAt('at-1s', 1), messageAt('at-3s', 3), messageAt('at-9s', 9)],
    });
    const setup = setupController(fetchHistory);

    setup.setPaused(false);
    setup.video.currentTime = 2;
    await setup.controller.start();
    await flushAsync();

    // Only the message the playhead has already passed is on screen.
    expect(setup.onMessages.mock.calls.flatMap(([messages]) => messages.map((m: ChatMessage) => m.id)))
      .toEqual(['at-1s']);

    setup.video.currentTime = 4;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    expect(setup.onMessages.mock.calls.flatMap(([messages]) => messages.map((m: ChatMessage) => m.id)))
      .toEqual(['at-1s', 'at-3s']);

    setup.video.currentTime = 9.5;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    expect(setup.onMessages.mock.calls.flatMap(([messages]) => messages.map((m: ChatMessage) => m.id)))
      .toEqual(['at-1s', 'at-3s', 'at-9s']);
    setup.lifecycle.dispose();
  });

  it('never re-releases a message an overlapping later window repeats', async () => {
    const fetchHistory = vi.fn().mockResolvedValue({
      status: 'success',
      messages: [messageAt('a', 1), messageAt('b', 6)],
    });
    const setup = setupController(fetchHistory);

    setup.setPaused(false);
    setup.video.currentTime = 2;
    await setup.controller.start();
    await flushAsync();

    // Crossing into the next bucket re-fetches a window that still contains 'a'.
    setup.video.currentTime = 7;
    setup.video.dispatchEvent(new Event('timeupdate'));
    await flushAsync();
    await flushAsync();

    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(setup.onMessages.mock.calls.flatMap(([messages]) => messages.map((m: ChatMessage) => m.id)))
      .toEqual(['a', 'b']);
    setup.lifecycle.dispose();
  });

  it('drops held messages on seek so a new position never shows the old window', async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValueOnce({ status: 'success', messages: [messageAt('future', 300)] })
      .mockResolvedValue({ status: 'success', messages: [messageAt('after-seek', 601)] });
    const setup = setupController(fetchHistory);

    setup.setPaused(false);
    setup.video.currentTime = 1;
    await setup.controller.start();
    await flushAsync();
    expect(setup.onMessages).not.toHaveBeenCalled();

    setup.video.dispatchEvent(new Event('seeking'));
    setup.video.currentTime = 605;
    setup.video.dispatchEvent(new Event('seeked'));
    await flushAsync();
    await flushAsync();

    expect(setup.onMessages.mock.calls.flatMap(([messages]) => messages.map((m: ChatMessage) => m.id)))
      .toEqual(['after-seek']);
    setup.lifecycle.dispose();
  });

  it('marks a successful empty window ready and fails open on metadata/history errors', async () => {
    const success = setupController(vi.fn().mockResolvedValue({ status: 'success', messages: [] }));
    await success.controller.start();
    await flushAsync();
    // An empty window has nothing to place on the playback timeline, so the renderer is never
    // called — readiness is what the empty result actually proves.
    expect(success.onMessages).not.toHaveBeenCalled();
    expect(success.onReady).toHaveBeenCalledTimes(1);
    success.lifecycle.dispose();

    const metadataFailure = setupController(vi.fn());
    const failingDependencies: VodChatReplayDependencies = {
      fetchMetadata: vi.fn().mockResolvedValue({ status: 'error', reason: 'missing-video' }),
      fetchHistory: vi.fn(),
      observeVideo: vi.fn(),
    };
    const failureController = new VodChatReplayController(
      metadataFailure.lifecycle,
      1,
      'missing',
      {
        onReset: metadataFailure.onReset,
        onMessages: metadataFailure.onMessages,
        onReady: metadataFailure.onReady,
        onUnavailable: metadataFailure.onUnavailable,
      },
      failingDependencies,
    );
    await failureController.start();
    expect(metadataFailure.onUnavailable).toHaveBeenCalledTimes(1);
    metadataFailure.lifecycle.dispose();

    const historyFailure = setupController(vi.fn().mockResolvedValue({
      status: 'error',
      reason: 'terminal-http',
      statusCode: 404,
    }));
    await historyFailure.controller.start();
    await flushAsync();
    expect(historyFailure.onUnavailable).toHaveBeenCalledTimes(1);
    historyFailure.lifecycle.dispose();
  });
});
