import { logger } from '../shared/logger';
import { buildMessageElement } from './message-view';
import { isNearBottom } from './dom-window';
import type { ChatDomRegistry, ChatMessage } from './message-store';

const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH_SIZE = 50;

export interface RenderQueueOptions {
  getContainer: () => HTMLElement | null;
  registry: ChatDomRegistry;
  onFlush?: (appended: HTMLElement[], wasAtBottom: boolean) => void;
}

export class RenderQueue {
  private pending: ChatMessage[] = [];
  private timerId: number | null = null;
  private disposed = false;

  constructor(private readonly options: RenderQueueOptions) {}

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
    const batch = this.pending;
    this.pending = [];

    window.requestAnimationFrame(() => {
      if (this.disposed) return;
      const container = this.options.getContainer();
      if (!container) {
        logger.warn('render-queue: container not found, dropping batch of', batch.length);
        return;
      }
      const wasAtBottom = isNearBottom(container);
      const fragment = document.createDocumentFragment();
      const appended: HTMLElement[] = [];
      for (const message of batch) {
        const element = buildMessageElement(message);
        this.options.registry.register(element, message);
        fragment.appendChild(element);
        appended.push(element);
      }
      container.appendChild(fragment);
      this.options.onFlush?.(appended, wasAtBottom);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pending = [];
  }
}
