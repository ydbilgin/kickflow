import { observeVideoElement } from '../player/video-element';
import type { Lifecycle } from '../shared/lifecycle';
import { logger } from '../shared/logger';
import {
  fetchChatHistoryResult,
  type ChatHistoryResult,
} from './history';
import type { ChatMessage } from './message-store';

const REPLAY_BUCKET_SECONDS = 5;

export type VodMetadataResult =
  | { status: 'success'; startTimeMs: number }
  | {
      status: 'error';
      reason: 'http' | 'network' | 'invalid-response' | 'missing-video' | 'invalid-start-time';
      statusCode?: number;
    };

export interface VodChatReplayCallbacks {
  onReset(): void;
  onMessages(messages: readonly ChatMessage[]): void;
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
    this.queueCurrentPosition(false);
  };

  private readonly handlePlay = (): void => {
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
    this.callbacks.onReset();
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
        const startTime = new Date(
          this.startTimeMs! + request.bucketSeconds * 1_000,
        ).toISOString();
        const result = await this.fetchHistory(this.channelId, startTime);
        if (this.lifecycle.isDisposed || request.epoch !== this.epoch) continue;
        if (result.status === 'error') {
          logger.info('vod-replay: history unavailable', result.reason);
          this.markUnavailable();
          return;
        }
        this.callbacks.onMessages(result.messages);
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
