import { logger } from './logger';

export type Disposer = () => void;

/** Cleanup registry so a torn-down session (channel switch) reliably releases every
 * timer, listener and socket it opened, instead of relying on scattered manual cleanup. */
export class Lifecycle {
  private disposers: Disposer[] = [];
  private disposed = false;

  add(disposer: Disposer): void {
    if (this.disposed) {
      disposer();
      return;
    }
    this.disposers.push(disposer);
  }

  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  setTimeout(handler: () => void, timeoutMs: number): void {
    const id = window.setTimeout(handler, timeoutMs);
    this.add(() => window.clearTimeout(id));
  }

  setInterval(handler: () => void, intervalMs: number): void {
    const id = window.setInterval(handler, intervalMs);
    this.add(() => window.clearInterval(id));
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let disposer: Disposer | undefined;
    while ((disposer = this.disposers.pop())) {
      try {
        disposer();
      } catch (error) {
        logger.error('lifecycle disposer threw', error);
      }
    }
  }
}
