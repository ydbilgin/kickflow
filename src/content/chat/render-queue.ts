import { logger } from '../shared/logger';
import { buildMessageElement } from './message-view';
import { isNearBottom } from './dom-window';
import type { ChatDomRegistry, ChatMessage } from './message-store';

const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH_SIZE = 50;
const HIDDEN_FLUSH_DELAY_MS = 0;

export interface RenderQueueOptions {
  getContainer: () => HTMLElement | null;
  registry: ChatDomRegistry;
  /** Re-check that a queued message is still eligible immediately before it reaches the DOM.
   * Moderation events can remove a message from the store during the batching interval. */
  shouldRender?: (message: ChatMessage) => boolean;
  onFlush?: (appended: HTMLElement[], wasAtBottom: boolean) => void;
}

export class RenderQueue {
  private pending: ChatMessage[] = [];
  private timerId: number | null = null;
  private frameId: number | null = null;
  private frameUsesTimeout = false;
  private disposed = false;

  constructor(private readonly options: RenderQueueOptions) {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  enqueue(message: ChatMessage): void {
    if (this.disposed) return;
    this.pending.push(message);
    if (this.pending.length >= MAX_BATCH_SIZE) {
      this.flush();
      return;
    }
    if (this.timerId === null) {
      this.timerId = window.setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.pending.length === 0) return;
    this.scheduleRender();
  }

  private readonly handleVisibilityChange = (): void => {
    if (!document.hidden || this.frameId === null || this.frameUsesTimeout) return;
    window.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.scheduleRender();
  };

  private scheduleRender(): void {
    if (this.disposed || this.frameId !== null || this.pending.length === 0) return;
    const render = (): void => {
      this.frameId = null;
      this.frameUsesTimeout = false;
      this.renderNextBatch();
    };
    if (document.hidden) {
      this.frameUsesTimeout = true;
      this.frameId = window.setTimeout(render, HIDDEN_FLUSH_DELAY_MS);
    } else {
      this.frameUsesTimeout = false;
      this.frameId = window.requestAnimationFrame(render);
    }
  }

  private renderNextBatch(): void {
    if (this.disposed || this.pending.length === 0) return;
    const batch = this.pending.splice(0, MAX_BATCH_SIZE);
    const container = this.options.getContainer();
    if (!container) {
      logger.warn('render-queue: container not found, dropping batch of', batch.length);
      this.scheduleRender();
      return;
    }
    const wasAtBottom = isNearBottom(container);
    const fragment = document.createDocumentFragment();
    const appended: HTMLElement[] = [];
    for (const message of batch) {
      if (this.options.shouldRender && !this.options.shouldRender(message)) continue;
      const element = buildMessageElement(message);
      this.options.registry.register(element, message);
      fragment.appendChild(element);
      appended.push(element);
    }
    if (appended.length > 0) {
      container.appendChild(fragment);
      this.options.onFlush?.(appended, wasAtBottom);
    }
    this.scheduleRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.frameId !== null) {
      if (this.frameUsesTimeout) window.clearTimeout(this.frameId);
      else window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.pending = [];
  }
}
