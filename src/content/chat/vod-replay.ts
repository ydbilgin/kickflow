import { observeVideoElement } from '../player/video-element';
import type { Lifecycle } from '../shared/lifecycle';
import { logger } from '../shared/logger';
import {
  fetchChatHistoryResult,
  type ChatHistoryResult,
} from './history';
import type { ChatMessage } from './message-store';

const REPLAY_BUCKET_SECONDS = 5;

/** A message whose own timestamp cannot be read has no place on the playback timeline, so it is
 * released with the first pass instead of being held back forever. */
const IMMEDIATE_OFFSET_MS = Number.NEGATIVE_INFINITY;

/** Consecutive buckets overlap, so released ids must be remembered to keep a repeat off the
 * screen. Kick timestamps are second-granular and a busy second holds many distinct messages, so
 * a timestamp watermark cannot do this job — only identity can. The set is trimmed to half on
 * overflow: an id older than the last few thousand can no longer be repeated by any window. */
const RELEASED_ID_CAP = 4_000;

interface PacedMessage {
  readonly message: ChatMessage;
  /** Milliseconds from the VOD's start — the playback position this message belongs to. */
  readonly offsetMs: number;
}

/** Splits messages the playhead has already reached from the ones still ahead of it. Pure so the
 * pacing rule is testable without a video element. Both halves keep their timestamp order. */
export function partitionDueMessages(
  pending: readonly PacedMessage[],
  playbackMs: number,
): { due: PacedMessage[]; rest: PacedMessage[] } {
  const due: PacedMessage[] = [];
  const rest: PacedMessage[] = [];
  for (const entry of pending) {
    if (entry.offsetMs <= playbackMs) due.push(entry);
    else rest.push(entry);
  }
  return { due, rest };
}

export type VodMetadataResult =
  | { status: 'success'; startTimeMs: number }
  | {
      status: 'error';
      reason: 'http' | 'network' | 'invalid-response' | 'missing-video' | 'invalid-start-time';
      statusCode?: number;
    };

export interface VodChatReplayCallbacks {
  onReset(): void;
  onMessages(messages: readonly ChatMessage[], startTimeMs: number): void;
  onReady(): void;
  onUnavailable(): void;
}

type MetadataFetcher = (channelId: number, videoId: string) => Promise<VodMetadataResult>;
type ReplayHistoryFetcher = (channelId: number, startTime: string) => Promise<ChatHistoryResult>;
type VideoObserver = (
  lifecycle: Lifecycle,
  callback: (video: HTMLVideoElement | null) => void,
) => void;

export interface VodChatReplayDependencies {
  fetchMetadata?: MetadataFetcher;
  fetchHistory?: ReplayHistoryFetcher;
  observeVideo?: VideoObserver;
}

interface ReplayRequest {
  bucketSeconds: number;
  epoch: number;
}

const videosUrl = (channelId: number): string =>
  `https://web.kick.com/api/v1/channels/${channelId}/videos`;

/** Resolves the exact URL VOD. Titles and list positions are intentionally ignored because both
 * are mutable/presentation-owned while the route id and API id are stable identities. */
export async function fetchVodMetadataResult(
  channelId: number,
  videoId: string,
): Promise<VodMetadataResult> {
  try {
    const response = await fetch(videosUrl(channelId), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return { status: 'error', reason: 'http', statusCode: response.status };
    }

    const json = (await response.json()) as { data?: unknown };
    if (!Array.isArray(json?.data)) {
      return { status: 'error', reason: 'invalid-response' };
    }
    const match = json.data.find((item) => {
      if (!item || typeof item !== 'object') return false;
      return (item as { id?: unknown }).id === videoId;
    }) as { start_time?: unknown } | undefined;
    if (!match) return { status: 'error', reason: 'missing-video' };
    if (typeof match.start_time !== 'string') {
      return { status: 'error', reason: 'invalid-start-time' };
    }
    const startTimeMs = Date.parse(match.start_time);
    if (!Number.isFinite(startTimeMs)) {
      return { status: 'error', reason: 'invalid-start-time' };
    }
    return { status: 'success', startTimeMs };
  } catch (error) {
    logger.info('vod-replay: metadata fetch threw', error);
    return { status: 'error', reason: 'network' };
  }
}

/** Drives KickFlow's own renderer from Kick's VOD history endpoint. It deliberately knows
 * nothing about DOM rows or stores: seek reset and render ownership stay with bootstrap, while
 * this class owns only video time → serialized replay-window requests. */
export class VodChatReplayController {
  private readonly fetchMetadata: MetadataFetcher;
  private readonly fetchHistory: ReplayHistoryFetcher;
  private readonly observeVideo: VideoObserver;
  private startTimeMs: number | null = null;
  private video: HTMLVideoElement | null = null;
  private epoch = 0;
  private lastRequestedBucket: number | null = null;
  private queuedRequest: ReplayRequest | null = null;
  private requestRunning = false;
  private seekPending = false;
  private started = false;
  private unavailable = false;
  /** Fetched but not yet reached by the playhead, oldest first. */
  private pending: PacedMessage[] = [];
  private readonly pendingIds = new Set<string>();
  /** Ids already handed to the renderer, insertion-ordered so the cap can evict the oldest. */
  private readonly releasedIds = new Set<string>();

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly channelId: number,
    private readonly videoId: string,
    private readonly callbacks: VodChatReplayCallbacks,
    dependencies: VodChatReplayDependencies = {},
  ) {
    this.fetchMetadata = dependencies.fetchMetadata ?? fetchVodMetadataResult;
    this.fetchHistory = dependencies.fetchHistory ?? fetchChatHistoryResult;
    this.observeVideo = dependencies.observeVideo ?? observeVideoElement;
    lifecycle.add(() => this.unbindVideo());
  }

  async start(): Promise<void> {
    if (this.started || this.lifecycle.isDisposed) return;
    this.started = true;
    const metadata = await this.fetchMetadata(this.channelId, this.videoId);
    if (this.lifecycle.isDisposed) return;
    if (metadata.status === 'error') {
      logger.info('vod-replay: metadata unavailable', metadata.reason);
      this.markUnavailable();
      return;
    }

    this.startTimeMs = metadata.startTimeMs;
    this.observeVideo(this.lifecycle, this.bindVideo);
  }

  private readonly bindVideo = (video: HTMLVideoElement | null): void => {
    if (video === this.video || this.lifecycle.isDisposed || this.unavailable) return;
    const replacingVideo = this.video !== null;
    this.unbindVideo();
    this.video = video;
    if (!video) return;

    video.addEventListener('timeupdate', this.handleTimeUpdate);
    video.addEventListener('play', this.handlePlay);
    video.addEventListener('seeking', this.handleSeeking);
    video.addEventListener('seeked', this.handleSeeked);

    if (replacingVideo) this.beginSeekReset();
    this.queueCurrentPosition(true);
  };

  private unbindVideo(): void {
    if (!this.video) return;
    this.video.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('seeking', this.handleSeeking);
    this.video.removeEventListener('seeked', this.handleSeeked);
    this.video = null;
  }

  private readonly handleTimeUpdate = (): void => {
    if (this.video?.paused !== false) return;
    this.releaseDueMessages();
    this.queueCurrentPosition(false);
  };

  private readonly handlePlay = (): void => {
    this.releaseDueMessages();
    this.queueCurrentPosition(false);
  };

  private readonly handleSeeking = (): void => {
    if (this.seekPending) return;
    this.seekPending = true;
    this.beginSeekReset();
  };

  private readonly handleSeeked = (): void => {
    if (!this.seekPending) this.beginSeekReset();
    this.seekPending = false;
    this.queueCurrentPosition(true);
  };

  private beginSeekReset(): void {
    this.epoch += 1;
    this.lastRequestedBucket = null;
    this.queuedRequest = null;
    this.pending = [];
    this.pendingIds.clear();
    this.releasedIds.clear();
    this.callbacks.onReset();
  }

  /** Buffers a fetched bucket on the playback timeline. Kick returns a whole window at once; the
   * playhead — not the fetch — decides when each message appears, so replay flows at the rate the
   * chat actually had instead of arriving in one lump per bucket. */
  private acceptMessages(messages: readonly ChatMessage[]): void {
    if (this.startTimeMs === null) return;
    let added = false;
    for (const message of messages) {
      if (this.pendingIds.has(message.id) || this.releasedIds.has(message.id)) continue;
      const parsedAt = Date.parse(message.createdAt);
      const offsetMs = Number.isFinite(parsedAt)
        ? parsedAt - this.startTimeMs
        : IMMEDIATE_OFFSET_MS;
      this.pending.push({ message, offsetMs });
      this.pendingIds.add(message.id);
      added = true;
    }
    if (added) this.pending.sort((left, right) => left.offsetMs - right.offsetMs);
    this.releaseDueMessages();
  }

  private releaseDueMessages(): void {
    if (this.pending.length === 0 || this.startTimeMs === null) return;
    const currentTime = this.video?.currentTime;
    if (currentTime === undefined || !Number.isFinite(currentTime)) return;

    const { due, rest } = partitionDueMessages(this.pending, currentTime * 1_000);
    if (due.length === 0) return;
    this.pending = rest;
    for (const entry of due) {
      this.pendingIds.delete(entry.message.id);
      this.releasedIds.add(entry.message.id);
    }
    this.trimReleasedIds();
    this.callbacks.onMessages(due.map((entry) => entry.message), this.startTimeMs);
  }

  private trimReleasedIds(): void {
    if (this.releasedIds.size <= RELEASED_ID_CAP) return;
    const target = RELEASED_ID_CAP / 2;
    for (const id of this.releasedIds) {
      if (this.releasedIds.size <= target) break;
      this.releasedIds.delete(id);
    }
  }

  private queueCurrentPosition(force: boolean): void {
    if (
      this.lifecycle.isDisposed
      || this.unavailable
      || this.startTimeMs === null
      || !this.video
      || !Number.isFinite(this.video.currentTime)
    ) {
      return;
    }
    const bucketSeconds = Math.max(
      0,
      Math.floor(this.video.currentTime / REPLAY_BUCKET_SECONDS) * REPLAY_BUCKET_SECONDS,
    );
    if (!force && bucketSeconds === this.lastRequestedBucket) return;
    this.lastRequestedBucket = bucketSeconds;
    this.queuedRequest = { bucketSeconds, epoch: this.epoch };
    void this.drainRequests();
  }

  private async drainRequests(): Promise<void> {
    if (this.requestRunning || this.unavailable || this.lifecycle.isDisposed) return;
    this.requestRunning = true;
    try {
      while (this.queuedRequest && !this.unavailable && !this.lifecycle.isDisposed) {
        const request = this.queuedRequest;
        this.queuedRequest = null;
        // Kick's history endpoint returns the messages ENDING at `start_time` (measured: asking
        // for 16:39:19 returns 16:39:15 → 16:39:19). Anchoring at the bucket's START would
        // therefore only ever return chat the playhead has already passed, which is why the whole
        // window was due the instant it arrived. Anchoring one bucket AHEAD fetches the next five
        // seconds, and the pacer releases each message as playback reaches it.
        const startTime = new Date(
          this.startTimeMs! + (request.bucketSeconds + REPLAY_BUCKET_SECONDS) * 1_000,
        ).toISOString();
        const result = await this.fetchHistory(this.channelId, startTime);
        if (this.lifecycle.isDisposed || request.epoch !== this.epoch) continue;
        if (result.status === 'error') {
          logger.info('vod-replay: history unavailable', result.reason);
          this.markUnavailable();
          return;
        }
        this.acceptMessages(result.messages);
        this.callbacks.onReady();
      }
    } finally {
      this.requestRunning = false;
      if (this.queuedRequest && !this.unavailable && !this.lifecycle.isDisposed) {
        void this.drainRequests();
      }
    }
  }

  private markUnavailable(): void {
    if (this.unavailable || this.lifecycle.isDisposed) return;
    this.unavailable = true;
    this.queuedRequest = null;
    this.callbacks.onUnavailable();
  }
}
