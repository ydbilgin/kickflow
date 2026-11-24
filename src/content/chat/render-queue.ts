import { logger } from '../shared/logger';
import { buildMessageElement } from './message-view';
import {
  UNMETERED_RELEASE_POLICY,
  type RenderReleasePolicy,
} from './hover-meter';
import type { ChatDomRegistry, ChatMessage } from './message-store';
import type { ReplyAction } from './reply-action';

const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH_SIZE = 50;
const MOUNT_RETRY_DELAY_MS = 250;
/** Rows a hidden tab keeps waiting for its return: the newest this many ordinary rows plus every
 * preserved (banned/deleted) row. A pinned list trims to MAX_NON_PRESERVED_NODES (dom-window.ts,
 * 200) anyway, so building older rows on return would only build rows to delete them. */
export const HIDDEN_BACKLOG_ROWS = 200;
/** A hidden backlog is compacted only when it reaches twice its target, which keeps the filter
 * amortised O(1) per message. */
const HIDDEN_COMPACT_AT = HIDDEN_BACKLOG_ROWS * 2;
/** Before the first row has ever rendered, a hidden tab still renders (on a timer, since animation
 * frames are suspended) so a chat opened in a background tab passes its startup readiness check. */
const HIDDEN_FIRST_RENDER_DELAY_MS = 0;

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
  onReply?: ReplyAction;
  /** Reports the exact number of rows still waiting behind the release policy. */
  onPendingChange?: (pendingCount: number) => void;
  /** Called after rows reach the DOM. It deliberately carries no scroll position: measuring one
   * here forced a layout before every append (2026-11-10). A caller that needs it reads it. */
  onFlush?: (appended: HTMLElement[]) => void;
}

export class RenderQueue {
  private pending: ChatMessage[] = [];
  private timerId: number | null = null;
  private frameId: number | null = null;
  private frameUsesTimeout = false;
  private forceUnmeteredOnNextRender = false;
  private disposed = false;
  /** True once any row reached the DOM. From then on a hidden tab builds no rows. */
  private hasRendered = false;
  /** True while the last render found no mount. Enqueue then waits for the mount retry instead of
   * re-filtering the whole backlog on every message (the eviction test took 28 s that way). */
  private mountUnavailable = false;
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
    if (this.parkedWhileHidden()) {
      // A hidden tab builds no rows (2026-11-11): nobody can see them, and a pinned list would trim
      // most of them before the tab returns. Keep the backlog bounded until visibilitychange.
      if (this.pending.length >= HIDDEN_COMPACT_AT) this.compactHiddenBacklog();
      return;
    }
    if (this.pending.length >= MAX_BATCH_SIZE && !this.mountUnavailable) {
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
    if (this.disposed) return;
    if (document.hidden) {
      if (this.frameId === null || this.frameUsesTimeout) return;
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
      // Parked: the backlog waits for the tab to return. Before the first render it still renders.
      if (!this.hasRendered) this.scheduleRender();
      return;
    }
    if (this.pending.length === 0) return;
    // Back in view: drop what a pinned list would trim at once, then render the rest by frames.
    this.compactHiddenBacklog();
    this.scheduleRender();
  };

  private parkedWhileHidden(): boolean {
    return this.hasRendered && document.hidden;
  }

  /** Releases evicted references and keeps preserved rows plus the newest HIDDEN_BACKLOG_ROWS. */
  private compactHiddenBacklog(): void {
    const shouldRender = this.options.shouldRender;
    const live = shouldRender ? this.pending.filter(shouldRender) : this.pending;
    let ordinary = 0;
    for (const message of live) if (!message.preserved) ordinary += 1;
    let skip = Math.max(0, ordinary - HIDDEN_BACKLOG_ROWS);
    const kept = skip === 0 ? live : live.filter((message) => {
      if (message.preserved || skip === 0) return true;
      skip -= 1;
      return false;
    });
    if (kept.length === this.pending.length) return;
    this.pending = kept;
    this.notifyPendingChange();
  }

  private scheduleRender(forceUnmetered = false): void {
    if (this.disposed || this.pending.length === 0) return;
    if (forceUnmetered) this.forceUnmeteredOnNextRender = true;
    if (this.frameId !== null) return;
    if (this.parkedWhileHidden()) return;
    const render = (): void => {
      this.frameId = null;
      this.frameUsesTimeout = false;
      const forceForThisRender = this.forceUnmeteredOnNextRender;
      this.forceUnmeteredOnNextRender = false;
      this.renderNextBatch(forceForThisRender);
    };
    if (document.hidden) {
      this.frameUsesTimeout = true;
      this.frameId = this.scheduleTimer(render, HIDDEN_FIRST_RENDER_DELAY_MS);
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
    if (this.parkedWhileHidden()) return;
    // Store eviction must also release queued references while the chat mount is absent or
    // metered; otherwise a long collapsed chat retains every message received in that gap.
    const shouldRender = this.options.shouldRender;
    if (shouldRender) {
      const retained = this.pending.filter(shouldRender);
      if (retained.length !== this.pending.length) {
        this.pending = retained;
        this.notifyPendingChange();
      }
      if (this.pending.length === 0) return;
    }
    const container = this.options.getContainer();
    this.mountUnavailable = !container;
    if (!container) {
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
    const fragment = document.createDocumentFragment();
    const appended: HTMLElement[] = [];
    for (const message of batch) {
      if (this.options.shouldRender && !this.options.shouldRender(message)) continue;
      try {
        const timestampText = this.options.formatTimestamp?.(message);
        const element = buildMessageElement(message, {
          timestampText,
          onOpenRemovedPanel: this.options.onOpenRemovedPanel,
          onReply: this.options.onReply,
        });
        element.dataset.createdAt = message.createdAt;
        this.options.registry.register(element, message);
        fragment.appendChild(element);
        appended.push(element);
      } catch (error) {
        logger.error('render-queue: row render failed', message.id, error);
      }
    }
    if (appended.length > 0) {
      this.hasRendered = true;
      // Live batches normally follow the current tail. Commit their fragment once rather
      // than re-reading and parsing the entire live child collection for every message.
      let previous = container.lastElementChild instanceof HTMLElement
        ? Date.parse(container.lastElementChild.dataset.createdAt ?? '') : -Infinity;
      const orderedTail = appended.every((element) => {
        const at = Date.parse(element.dataset.createdAt!);
        const follows = Number.isFinite(at) && at >= previous;
        previous = at;
        return follows;
      });
      if (orderedTail) {
        container.appendChild(fragment);
      } else {
        // Delayed history still belongs before live rows. Snapshot and parse existing
        // timestamps once; include each inserted row so equal timestamps stay stable.
        const ordered = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
          .map((element) => ({ element, at: Date.parse(element.dataset.createdAt ?? '') }));
        for (const element of appended) {
          const at = Date.parse(element.dataset.createdAt!);
          const index = Number.isFinite(at) ? ordered.findIndex((entry) => entry.at > at) : -1;
          container.insertBefore(element, index < 0 ? null : ordered[index].element);
          ordered.splice(index < 0 ? ordered.length : index, 0, { element, at });
        }
      }
      try {
        this.options.onFlush?.(appended);
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
