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

export type ScrollFollowBehavior = 'auto' | 'smooth';

interface UnsettledFollowRequest {
  readonly bottomTarget: number;
  readonly behavior: ScrollFollowBehavior;
}

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
  getScrollFollowBehavior?: () => ScrollFollowBehavior;
  /** Injectable because ResizeObserver is not available in jsdom. Returning null disables
   * row-size observation while retaining the scroll-intent state machine. */
  createResizeObserver?: (callback: () => void) => RowResizeObserver | null;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

/** Owns one chat list's follow state. Upward wheel intent pauses before a queued append or
 * image resize can mask the browser's pending scroll event. Offset changes also cover
 * keyboard/scrollbar input; returning to the bottom resumes following. */
export class ScrollFollowController {
  private pinned = true;
  private disposed = false;
  private programmaticScroll = false;
  private lastScrollTop: number;
  private programmaticClearFrame: number | null = null;
  private unsettledFollow: UnsettledFollowRequest | null = null;
  private pointerHeld = false;
  private pointerReleaseFrame: number | null = null;
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
    // Composer, native events and panel resizing can change the viewport without changing
    // any message row. Retain the same pin intent through those changes as through images.
    this.resizeObserver?.observe(container);

    container.addEventListener('scroll', this.handleScroll);
    container.addEventListener('scrollend', this.handleScrollEnd);
    container.addEventListener('wheel', this.handleWheel, { passive: true });
    container.addEventListener('pointerdown', this.handlePointerDown);
    document.addEventListener('pointerup', this.handlePointerRelease);
    document.addEventListener('pointercancel', this.handlePointerRelease);
    window.addEventListener('blur', this.handlePointerRelease);
  }

  get isPinned(): boolean {
    return this.pinned && !this.pointerHeld;
  }

  /** Snap through one marked programmatic-scroll window. Explicit user intent always wins, even
   * if the user starts scrolling upward before the browser delivers our synthetic scroll event. */
  scrollToBottom(behavior: ScrollFollowBehavior = 'auto'): void {
    if (this.disposed || this.pointerHeld) return;
    this.setPinned(true);
    this.programmaticScroll = true;
    const top = this.container.scrollHeight;
    if (behavior === 'smooth' && typeof this.container.scrollTo === 'function') {
      this.unsettledFollow = { bottomTarget: this.bottomTarget, behavior };
      this.container.scrollTo({ top, behavior });
    } else {
      this.unsettledFollow = null;
      this.container.scrollTop = top;
    }
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
    this.container.removeEventListener('scrollend', this.handleScrollEnd);
    this.container.removeEventListener('wheel', this.handleWheel);
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    document.removeEventListener('pointerup', this.handlePointerRelease);
    document.removeEventListener('pointercancel', this.handlePointerRelease);
    window.removeEventListener('blur', this.handlePointerRelease);
    if (this.programmaticClearFrame !== null) this.cancelFrame(this.programmaticClearFrame);
    if (this.pointerReleaseFrame !== null) this.cancelFrame(this.pointerReleaseFrame);
    this.resizeObserver?.disconnect();
    this.observedRows.clear();
  }

  /** Keep a pressed username, link or selection under the pointer until its click completes.
   * A hover meter still releases rows, and smooth follow used to move the target between
   * pointerdown and pointerup. Retain the user's prior follow intent rather than repinning
   * someone who had already wheeled up. */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.disposed) return;
    if (this.pointerReleaseFrame !== null) this.cancelFrame(this.pointerReleaseFrame);
    this.pointerReleaseFrame = null;
    this.pointerHeld = true;
    if (this.unsettledFollow && typeof this.container.scrollTo === 'function') {
      this.container.scrollTo({ top: this.container.scrollTop, behavior: 'instant' });
    }
    this.unsettledFollow = null;
  };

  private readonly handlePointerRelease = (): void => {
    if (!this.pointerHeld || this.disposed) return;
    // The native click follows pointerup in the same input task. Resume after that click,
    // so no synchronous resize delivery can steal its target.
    if (this.pointerReleaseFrame !== null) return;
    this.pointerReleaseFrame = this.scheduleFrame(() => {
      this.pointerReleaseFrame = null;
      if (this.disposed || !this.pointerHeld) return;
      this.pointerHeld = false;
      if (this.pinned) {
        this.options.onPinnedChange?.(true);
        this.scrollToBottom();
      }
    });
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.disposed || event.defaultPrevented || event.ctrlKey || event.deltaY >= 0
      || this.container.scrollHeight <= this.container.clientHeight
      || (this.container.scrollTop <= 0 && !this.unsettledFollow)) return;
    // Input arrives before the resulting scroll event. Pause now so an intervening render
    // or ResizeObserver delivery cannot pull the reader back down or restart smooth follow.
    if (this.unsettledFollow && typeof this.container.scrollTo === 'function') {
      this.container.scrollTo({ top: this.container.scrollTop, behavior: 'instant' });
    }
    this.programmaticScroll = false;
    this.unsettledFollow = null;
    this.setPinned(false);
  };

  private readonly handleScroll = (): void => {
    if (this.disposed) return;
    const movedUp = this.container.scrollTop < this.lastScrollTop;
    this.lastScrollTop = this.container.scrollTop;
    if (isNearBottom(this.container) && (this.pinned || !movedUp)) {
      this.setPinned(true);
      return;
    }

    // One upward offset delta covers wheel, keyboard, touch, and scrollbar input. Our own writes
    // only move downward; content growth leaves the offset unchanged or raises it via anchoring.
    if (this.programmaticScroll && !movedUp) return;
    if (!movedUp) return;

    this.programmaticScroll = false;
    this.unsettledFollow = null;
    this.setPinned(false);
  };

  private readonly handleScrollEnd = (): void => {
    if (this.disposed || !this.unsettledFollow) return;
    if (this.container.scrollTop >= this.unsettledFollow.bottomTarget) {
      this.unsettledFollow = null;
    }
  };

  private readonly handleRowsResized = (): void => {
    if (this.disposed) return;
    this.pruneObservedRows();
    if (this.isPinned) {
      const behavior = this.options.getScrollFollowBehavior?.() ?? 'auto';
      if (this.unsettledFollow?.bottomTarget === this.bottomTarget
        && this.unsettledFollow.behavior === behavior) return;
      this.scrollToBottom(behavior);
    }
  };

  private get bottomTarget(): number {
    return Math.max(0, this.container.scrollHeight - this.container.clientHeight);
  }

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
    removedHeight += nonPreserved[i].getBoundingClientRect().height;
  }
  // Finish layout reads before removing anything, and keep fractional CSS pixels: summing
  // rounded offsetHeight values makes a paused reader drift during a large trim.
  const scrollTop = container.scrollTop;
  for (let i = 0; i < overflow; i++) {
    const node = nonPreserved[i];
    registry.forget(node);
    container.removeChild(node);
  }
  if (removedHeight > 0) {
    container.scrollTop = scrollTop - removedHeight;
  }
  logger.debug('dom-window: trimmed', overflow, 'node(s)');
}

export interface ScrollFollowDecision {
  scrollToBottom: boolean;
  scrollBehavior: ScrollFollowBehavior;
  trimCap: number;
  showPill: boolean;
}

/** Given whether the list is currently pinned to the bottom and how many rows this flush
 * appended, decide follow behavior. Pinned → snap to bottom + normal trim, hide pill. Paused
 * (user scrolled up) → do NOT snap, do NOT trim from the top (only a high safety cap so the
 * message the user is reading is never yanked), and surface the "new messages" pill. */
export function decideScrollFollow(
  stickToBottom: boolean,
  appendedCount: number,
  isHovered = false,
  hoveredBehavior: ScrollFollowBehavior = 'smooth',
): ScrollFollowDecision {
  if (stickToBottom) {
    return {
      scrollToBottom: true,
      scrollBehavior: isHovered ? hoveredBehavior : 'auto',
      trimCap: MAX_NON_PRESERVED_NODES,
      showPill: false,
    };
  }
  return {
    scrollToBottom: false,
    scrollBehavior: 'auto',
    trimCap: MAX_NON_PRESERVED_NODES_PAUSED,
    showPill: appendedCount > 0,
  };
}

export interface ScrollFollowHoverOptions {
  onHoverChange?: (hovered: boolean) => void;
  onPointerLeave?: () => void;
  /** Behavior used while the pointer is over the list. Defaults to browser smooth. */
  getHoveredBehavior?: () => ScrollFollowBehavior;
}

export interface ScrollFollowHoverWiring {
  readonly isHovered: boolean;
  decide(appendedCount: number): ScrollFollowDecision;
  apply(decision: ScrollFollowDecision): void;
  dispose(): void;
}

/** Adds one pointer-state listener pair and transition hooks around the pure follow decision. */
export function attachScrollFollowHover(
  container: HTMLElement,
  follow: ScrollFollowController,
  options: ScrollFollowHoverOptions = {},
): ScrollFollowHoverWiring {
  let hovered = false;
  let pointer: { x: number; y: number } | null = null;
  let pointerRow: HTMLElement | null = null;
  let hoverFrame: number | null = null;

  const markRow = (row: HTMLElement | null): void => {
    if (row === pointerRow && (!row || row.isConnected)) return;
    pointerRow?.removeAttribute('data-kickflow-pointer-row');
    pointerRow = row;
    row?.setAttribute('data-kickflow-pointer-row', '');
  };
  const refreshRow = (): void => {
    if (!pointer || !container.isConnected) { markRow(null); return; }
    const hit = document.elementFromPoint(pointer.x, pointer.y);
    const row = hit?.closest<HTMLElement>(`.${MESSAGE_CLASS}`) ?? null;
    markRow(row?.parentElement === container ? row : null);
  };
  const scheduleRowRefresh = (): void => {
    if (!pointer || hoverFrame !== null) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = null;
      refreshRow();
    });
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') { pointer = null; markRow(null); return; }
    pointer = { x: event.clientX, y: event.clientY };
    refreshRow();
  };
  const clearPointerRow = (): void => {
    pointer = null;
    markRow(null);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') clearPointerRow();
  };
  const rowObserver = new MutationObserver(scheduleRowRefresh);
  rowObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('scroll', scheduleRowRefresh);
  window.addEventListener('blur', clearPointerRow);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const onPointerEnter = (): void => {
    hovered = true;
    options.onHoverChange?.(true);
  };

  const onPointerLeave = (): void => {
    clearPointerRow();
    hovered = false;
    options.onHoverChange?.(false);
    options.onPointerLeave?.();
  };

  container.addEventListener('pointerenter', onPointerEnter);
  container.addEventListener('pointerleave', onPointerLeave);

  return {
    get isHovered(): boolean {
      return hovered;
    },
    decide(appendedCount: number): ScrollFollowDecision {
      return decideScrollFollow(
        follow.isPinned,
        appendedCount,
        hovered,
        options.getHoveredBehavior?.() ?? 'smooth',
      );
    },
    apply(decision: ScrollFollowDecision): void {
      if (!decision.scrollToBottom) return;
      follow.scrollToBottom(decision.scrollBehavior);
    },
    dispose(): void {
      if (hoverFrame !== null) window.cancelAnimationFrame(hoverFrame);
      rowObserver.disconnect();
      clearPointerRow();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('scroll', scheduleRowRefresh);
      window.removeEventListener('blur', clearPointerRow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      container.removeEventListener('pointerenter', onPointerEnter);
      container.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
