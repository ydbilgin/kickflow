import { logger } from '../shared/logger';
import { MESSAGE_CLASS, PRESERVED_CLASS } from './message-view';
import type { ChatDomRegistry } from './message-store';

export const MAX_NON_PRESERVED_NODES = 200;
// Headroom while the user is scrolled up (paused): the DOM is allowed to grow much larger
// before we shed anything, so the message they scrolled up to read is never yanked out from
// under them. Still bounded so a long raid can't grow the list without limit.
// Invariant: ChatIntegrityStore's GLOBAL_CAPACITY (message-store.ts) must stay >= this value —
// otherwise a row still visible in the paused DOM can fall out of the store and can no longer
// be preserved on ban/delete. If this changes, re-check GLOBAL_CAPACITY too.
export const MAX_NON_PRESERVED_NODES_PAUSED = 600;
const BOTTOM_THRESHOLD_PX = 60;

export function isNearBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
}

interface RowResizeObserver {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}

export interface ScrollFollowControllerOptions {
  onPinnedChange?: (pinned: boolean) => void;
  /** Injectable because ResizeObserver is not available in jsdom. Returning null disables
   * row-size observation while retaining the scroll-intent state machine. */
  createResizeObserver?: (callback: () => void) => RowResizeObserver | null;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

/** Owns one chat list's follow state. A scroll event alone is not proof of user intent: browser
 * scroll anchoring, our own scrollTop assignment, and late image sizing can all emit one. Pause
 * only after an explicit upward input (wheel/key/scrollbar drag), while still allowing any trip
 * back to the bottom to resume following. */
export class ScrollFollowController {
  private pinned = true;
  private disposed = false;
  private programmaticScroll = false;
  private lastScrollTop: number;
  private programmaticClearFrame: number | null = null;
  private readonly observedRows = new Set<HTMLElement>();
  private readonly resizeObserver: RowResizeObserver | null;
  private readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ScrollFollowControllerOptions = {},
  ) {
    this.lastScrollTop = container.scrollTop;
    this.scheduleFrame = options.scheduleFrame ?? ((callback) => window.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
    const createResizeObserver = options.createResizeObserver
      ?? ((callback: () => void) => new ResizeObserver(callback));
    this.resizeObserver = createResizeObserver(this.handleRowsResized);

    container.addEventListener('scroll', this.handleScroll);
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  /** Snap through one marked programmatic-scroll window. Explicit user intent always wins, even
   * if the user starts scrolling upward before the browser delivers our synthetic scroll event. */
  scrollToBottom(): void {
    if (this.disposed) return;
    this.setPinned(true);
    this.programmaticScroll = true;
    this.container.scrollTop = this.container.scrollHeight;
    this.lastScrollTop = this.container.scrollTop;
    if (this.programmaticClearFrame !== null) this.cancelFrame(this.programmaticClearFrame);
    this.programmaticClearFrame = this.scheduleFrame(() => {
      this.programmaticClearFrame = null;
      this.programmaticScroll = false;
    });
  }

  /** Observe direct message rows rather than the fixed-height scroll container: a scroller's
   * content box does not resize when an image inside it gains height, but its row does. */
  observeRows(rows: readonly HTMLElement[]): void {
    if (this.disposed || !this.resizeObserver) return;
    this.pruneObservedRows();
    for (const row of rows) {
      if (row.parentElement !== this.container || this.observedRows.has(row)) continue;
      this.observedRows.add(row);
      this.resizeObserver.observe(row);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.container.removeEventListener('scroll', this.handleScroll);
    if (this.programmaticClearFrame !== null) this.cancelFrame(this.programmaticClearFrame);
    this.resizeObserver?.disconnect();
    this.observedRows.clear();
  }

  private readonly handleScroll = (): void => {
    if (this.disposed) return;
    const movedUp = this.container.scrollTop < this.lastScrollTop;
    this.lastScrollTop = this.container.scrollTop;
    if (isNearBottom(this.container)) {
      this.setPinned(true);
      return;
    }

    // One upward offset delta covers wheel, keyboard, touch, and scrollbar input. Our own writes
    // only move downward; content growth leaves the offset unchanged or raises it via anchoring.
    if (this.programmaticScroll && !movedUp) return;
    if (!movedUp) return;

    this.programmaticScroll = false;
    this.setPinned(false);
  };

  private readonly handleRowsResized = (): void => {
    if (this.disposed) return;
    this.pruneObservedRows();
    if (this.pinned) this.scrollToBottom();
  };

  private setPinned(pinned: boolean): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    this.options.onPinnedChange?.(pinned);
  }

  private pruneObservedRows(): void {
    if (!this.resizeObserver) return;
    for (const row of this.observedRows) {
      if (row.parentElement === this.container) continue;
      this.resizeObserver.unobserve(row);
      this.observedRows.delete(row);
    }
  }
}

export function trimMessageWindow(
  container: HTMLElement,
  registry: ChatDomRegistry,
  maxNodes: number = MAX_NON_PRESERVED_NODES,
): void {
  const messages = (Array.from(container.children) as HTMLElement[]).filter((child) =>
    child.classList.contains(MESSAGE_CLASS)
  );
  const nonPreserved = messages.filter((child) => !child.classList.contains(PRESERVED_CLASS));
  const overflow = nonPreserved.length - maxNodes;
  if (overflow <= 0) return;

  let removedHeight = 0;
  for (let i = 0; i < overflow; i++) {
    const node = nonPreserved[i];
    removedHeight += node.offsetHeight;
    registry.forget(node);
    container.removeChild(node);
  }
  if (removedHeight > 0) {
    container.scrollTop -= removedHeight;
  }
  logger.debug('dom-window: trimmed', overflow, 'node(s)');
}

export interface ScrollFollowDecision {
  scrollToBottom: boolean;
  trimCap: number;
  showPill: boolean;
}

/** Given whether the list is currently pinned to the bottom and how many rows this flush
 * appended, decide follow behavior. Pinned → snap to bottom + normal trim, hide pill. Paused
 * (user scrolled up) → do NOT snap, do NOT trim from the top (only a high safety cap so the
 * message the user is reading is never yanked), and surface the "new messages" pill. */
export function decideScrollFollow(stickToBottom: boolean, appendedCount: number): ScrollFollowDecision {
  if (stickToBottom) {
    return { scrollToBottom: true, trimCap: MAX_NON_PRESERVED_NODES, showPill: false };
  }
  return { scrollToBottom: false, trimCap: MAX_NON_PRESERVED_NODES_PAUSED, showPill: appendedCount > 0 };
}
