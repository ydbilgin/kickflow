import { logger } from '../shared/logger';
import { buildMessageElement } from './message-view';
import { isNearBottom } from './dom-window';
import {
  UNMETERED_RELEASE_POLICY,
  type RenderReleasePolicy,
} from './hover-meter';
import type { ChatDomRegistry, ChatMessage } from './message-store';

const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH_SIZE = 50;
const HIDDEN_FLUSH_DELAY_MS = 0;
const MOUNT_RETRY_DELAY_MS = 250;

export interface RenderQueueOptions {
  getContainer: () => HTMLElement | null;
  registry: ChatDomRegistry;
  /** Controls how many pending rows may enter the DOM during one render pass. */
  releasePolicy?: RenderReleasePolicy;
  /** Injectable clock for release-policy decisions and deterministic queue tests. */
  now?: () => number;
  /** Injectable timer boundary for deterministic queue tests. */
  scheduleTimer?: (callback: () => void, delayMs: number) => number;
  cancelTimer?: (timerId: number) => void;
  /** Re-check that a queued message is still eligible immediately before it reaches the DOM.
   * Moderation events can remove a message from the store during the batching interval. */
  shouldRender?: (message: ChatMessage) => boolean;
  /** Overrides the default live wall-clock label for session-specific sources such as VOD replay. */
  formatTimestamp?: (message: ChatMessage) => string;
  /** Opens the removed-message panel from a multi-victim moderator-action event row. */
  onOpenRemovedPanel?: () => void;
  /** Reports the exact number of rows still waiting behind the release policy. */
  onPendingChange?: (pendingCount: number) => void;
  onFlush?: (appended: HTMLElement[], wasAtBottom: boolean) => void;
}

export class RenderQueue {
  private pending: ChatMessage[] = [];
  private timerId: number | null = null;
  private frameId: number | null = null;
  private frameUsesTimeout = false;
  private forceUnmeteredOnNextRender = false;
  private disposed = false;
  private readonly releasePolicy: RenderReleasePolicy;
  private readonly now: () => number;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => number;
  private readonly cancelTimer: (timerId: number) => void;

  constructor(private readonly options: RenderQueueOptions) {
    this.releasePolicy = options.releasePolicy ?? UNMETERED_RELEASE_POLICY;
    this.now = options.now ?? Date.now;
    this.scheduleTimer = options.scheduleTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancelTimer = options.cancelTimer ?? ((timerId) => window.clearTimeout(timerId));
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(message: ChatMessage): void {
    if (this.disposed) return;
    this.pending.push(message);
    this.notifyPendingChange();
    if (this.pending.length >= MAX_BATCH_SIZE) {
      this.flush();
      return;
    }
    this.schedulePendingWork(false);
  }

  /** Re-evaluates a pending batch after hover or pin state changes without adding another timer
   * owner. A metered queue can wake immediately; an unmetered queue retains the normal batch. */
  wake(): void {
    if (this.disposed || this.pending.length === 0) return;
    this.cancelScheduledTimer();
    this.schedulePendingWork(false);
  }

  /** Releases every pending row without applying metering. Pointer-leave calls this only after
   * its hover transition has disabled the injected meter. */
  flushPending(): void {
    if (this.disposed || this.pending.length === 0) return;
    this.cancelScheduledTimer();
    this.scheduleRender(true);
  }

  /** A VOD seek invalidates every row captured for the previous playback window, including rows
   * still waiting for the 250ms batch. Cancel scheduled work as well as clearing the array so an
   * old animation-frame callback cannot race the reset. */
  clearPending(): void {
    const hadPending = this.pending.length > 0;
    this.pending = [];
    if (hadPending) this.notifyPendingChange();
    this.cancelScheduledTimer();
    if (this.frameId !== null) {
      if (this.frameUsesTimeout) this.cancelTimer(this.frameId);
      else window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.frameUsesTimeout = false;
    }
    this.forceUnmeteredOnNextRender = false;
  }

  private flush(): void {
    this.cancelScheduledTimer();
    if (this.pending.length === 0) return;
    this.scheduleRender();
  }

  private readonly handleVisibilityChange = (): void => {
    if (!document.hidden || this.frameId === null || this.frameUsesTimeout) return;
    window.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.scheduleRender();
  };

  private scheduleRender(forceUnmetered = false): void {
    if (this.disposed || this.pending.length === 0) return;
    if (forceUnmetered) this.forceUnmeteredOnNextRender = true;
    if (this.frameId !== null) return;
    const render = (): void => {
      this.frameId = null;
      this.frameUsesTimeout = false;
      const forceForThisRender = this.forceUnmeteredOnNextRender;
      this.forceUnmeteredOnNextRender = false;
      this.renderNextBatch(forceForThisRender);
    };
    if (document.hidden) {
      this.frameUsesTimeout = true;
      this.frameId = this.scheduleTimer(render, HIDDEN_FLUSH_DELAY_MS);
    } else {
      this.frameUsesTimeout = false;
      // Test harnesses and browser shims may invoke RAF synchronously. Do not overwrite the
      // callback's `frameId = null` with the returned id after it already rendered.
      let renderedSynchronously = false;
      const id = window.requestAnimationFrame(() => {
        renderedSynchronously = true;
        render();
      });
      if (!renderedSynchronously) this.frameId = id;
    }
  }

  private renderNextBatch(forceUnmetered: boolean): void {
    if (this.disposed || this.pending.length === 0) return;
    const container = this.options.getContainer();
    if (!container) {
      logger.debug('render-queue: guarded container unavailable; retaining', this.pending.length, 'queued rows');
      if (this.timerId === null) {
        this.timerId = this.scheduleTimer(() => {
          this.timerId = null;
          this.scheduleRender(forceUnmetered);
        }, MOUNT_RETRY_DELAY_MS);
      }
      return;
    }
    const decision = forceUnmetered
      ? { maxRows: this.pending.length, releaseAll: true }
      : this.releasePolicy.release(this.pending.length, this.now());
    if (decision.maxRows <= 0) {
      this.schedulePendingWork(false);
      return;
    }

    const batchSize = Math.min(this.pending.length, decision.maxRows, MAX_BATCH_SIZE);
    const batch = this.pending.splice(0, batchSize);
    this.notifyPendingChange();
    const wasAtBottom = isNearBottom(container);
    const fragment = document.createDocumentFragment();
    const appended: HTMLElement[] = [];
    for (const message of batch) {
      if (this.options.shouldRender && !this.options.shouldRender(message)) continue;
      try {
        const timestampText = this.options.formatTimestamp?.(message);
        const element = buildMessageElement(message, {
          timestampText,
          onOpenRemovedPanel: this.options.onOpenRemovedPanel,
        });
        this.options.registry.register(element, message);
        fragment.appendChild(element);
        appended.push(element);
      } catch (error) {
        logger.error('render-queue: row render failed', message.id, error);
      }
    }
    if (appended.length > 0) {
      container.appendChild(fragment);
      try {
        this.options.onFlush?.(appended, wasAtBottom);
      } catch (error) {
        logger.error('render-queue: flush callback failed', error);
      }
    }
    if (this.pending.length === 0) return;
    if (decision.releaseAll) this.scheduleRender(true);
    else this.schedulePendingWork(true);
  }

  private schedulePendingWork(afterRender: boolean): void {
    if (this.disposed || this.pending.length === 0 || this.frameId !== null || this.timerId !== null) return;
    const delayMs = this.releasePolicy.timeUntilNextRelease(this.pending.length, this.now());
    if (delayMs !== null) {
      this.timerId = this.scheduleTimer(() => {
        this.timerId = null;
        this.scheduleRender();
      }, delayMs);
      return;
    }
    if (afterRender) {
      this.scheduleRender();
      return;
    }
    this.timerId = this.scheduleTimer(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private cancelScheduledTimer(): void {
    if (this.timerId === null) return;
    this.cancelTimer(this.timerId);
    this.timerId = null;
  }

  private notifyPendingChange(): void {
    try {
      this.options.onPendingChange?.(this.pending.length);
    } catch (error) {
      logger.error('render-queue: pending-count callback failed', error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearPending();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
