import { describe, expect, it, vi } from 'vitest';
import {
  attachScrollFollowHover,
  MAX_NON_PRESERVED_NODES,
  MAX_NON_PRESERVED_NODES_PAUSED,
  READER_SCROLL_EVENT,
  ScrollFollowController,
  USER_SCROLL_INPUT_WINDOW_MS,
  decideScrollFollow,
  isNearBottom,
  trimMessageWindow,
} from '../../src/content/chat/dom-window';
import { MESSAGE_CLASS, PRESERVED_CLASS } from '../../src/content/chat/message-view';
import { ChatDomRegistry } from '../../src/content/chat/message-store';
import { jumpToMessage } from '../../src/content/chat/message-jump';
import { OWN_LIST_ID } from '../../src/content/chat/overlay-mount';

function buildContainer(nonPreservedCount: number, preservedCount = 0): HTMLElement {
  const container = document.createElement('div');
  for (let i = 0; i < preservedCount; i++) {
    const node = document.createElement('div');
    node.className = `${MESSAGE_CLASS} ${PRESERVED_CLASS}`;
    container.appendChild(node);
  }
  for (let i = 0; i < nonPreservedCount; i++) {
    const node = document.createElement('div');
    node.className = MESSAGE_CLASS;
    container.appendChild(node);
  }
  return container;
}

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

function mockScrollMetrics(container: HTMLElement, initial: ScrollMetrics): ScrollMetrics {
  const metrics = { ...initial };
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight));
      },
    },
  });
  return metrics;
}

/** A reader's key press: an upward offset change only pauses following after real input. */
function userKey(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
}

describe('isNearBottom', () => {
  it('treats an empty, non-overflowing list as pinned', () => {
    const container = document.createElement('div');
    mockScrollMetrics(container, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });

    expect(isNearBottom(container)).toBe(true);
  });
});

describe('ScrollFollowController', () => {
  it('lands the first nonempty viewport immediately before honoring smooth follow', () => {
    const container = buildContainer(0);
    const metrics = mockScrollMetrics(container, { scrollHeight: 250, clientHeight: 250, scrollTop: 0 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });

    controller.scrollToBottom(); // Empty hover-idle follow must not consume startup.
    container.append(buildContainer(1).firstElementChild!);
    metrics.scrollHeight = 1_000;
    controller.scrollToBottom('smooth');
    expect(metrics.scrollTop).toBe(750);
    expect(scrollTo).not.toHaveBeenCalled();

    metrics.scrollHeight = 1_300;
    controller.scrollToBottom('smooth');
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_300, behavior: 'smooth' });
    controller.dispose();
  });

  it('waits for a nonzero viewport to consume the first content landing', () => {
    const container = buildContainer(1);
    const metrics = mockScrollMetrics(container, { scrollHeight: 0, clientHeight: 0, scrollTop: 0 });
    let notifyResize: (() => void) | undefined;
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
      getScrollFollowBehavior: () => 'smooth',
    });
    controller.observeRows(Array.from(container.children) as HTMLElement[]);
    controller.scrollToBottom();
    notifyResize?.();
    scrollTo.mockClear();

    metrics.clientHeight = 250;
    metrics.scrollHeight = 1_000;
    notifyResize?.();
    expect(metrics.scrollTop).toBe(750);
    expect(scrollTo).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('lands a replacement content window immediately but preserves smooth follow through trims', () => {
    const container = buildContainer(2);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 0 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }),
    });
    controller.observeRows(Array.from(container.children) as HTMLElement[]);
    controller.scrollToBottom('smooth');

    container.firstElementChild!.remove();
    const retainedAppend = buildContainer(1).firstElementChild as HTMLElement;
    container.append(retainedAppend);
    controller.observeRows([retainedAppend]);
    controller.scrollToBottom('smooth');
    expect(scrollTo).toHaveBeenCalledOnce();
    scrollTo.mockClear();

    container.replaceChildren();
    const resetRow = buildContainer(1).firstElementChild as HTMLElement;
    container.append(resetRow);
    metrics.scrollHeight = 1_300;
    controller.observeRows([resetRow]);
    controller.scrollToBottom('smooth');
    expect(metrics.scrollTop).toBe(1_050);
    expect(scrollTo).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('gives a remounted controller its own instant landing on existing content', () => {
    const container = buildContainer(1);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 0 });
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    const first = new ScrollFollowController(container, { createResizeObserver: () => null });
    first.scrollToBottom('smooth');
    first.dispose();
    metrics.scrollTop = 0;
    const second = new ScrollFollowController(container, { createResizeObserver: () => null });
    second.scrollToBottom('smooth');
    expect(metrics.scrollTop).toBe(750);
    expect(scrollTo).not.toHaveBeenCalled();
    second.dispose();
  });

  it('stays pinned through rapid initial growth and an intermediate non-user scroll event', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });

    metrics.scrollHeight = 1_200;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);

    controller.scrollToBottom();
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);
    expect(metrics.scrollTop).toBe(900);
    controller.dispose();
  });

  it('ignores programmatic scroll events, pauses for explicit upward input, and resumes at bottom', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const pinnedChanges: boolean[] = [];
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => null,
      onPinnedChange: (pinned) => pinnedChanges.push(pinned),
    });

    controller.scrollToBottom();
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);

    userKey();
    metrics.scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(false);
    expect(decideScrollFollow(controller.isPinned, 2).showPill).toBe(true);

    metrics.scrollTop = 750;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);
    expect(decideScrollFollow(controller.isPinned, 2).showPill).toBe(false);
    expect(pinnedChanges).toEqual([false, true]);
    controller.dispose();
  });

  it('does not let a pending programmatic guard swallow immediate upward user input', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 0 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });

    controller.scrollToBottom();
    userKey();
    metrics.scrollTop = 200;
    container.dispatchEvent(new Event('scroll'));

    expect(controller.isPinned).toBe(false);
    controller.dispose();
  });

  it('recognizes an upward scrollbar drag from the press and the scrollTop direction', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => null,
      scheduleFrame: (callback) => { callback(0); return 1; },
    });

    // A scrollbar press reaches the list as pointerdown; the drag itself only moves scrollTop.
    container.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    metrics.scrollTop = 400;
    container.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('pointerup'));

    expect(controller.isPinned).toBe(false);
    expect(metrics.scrollTop).toBe(400);
    controller.dispose();
  });

  it('keeps following when its own row removal moves the offset up and nobody gave input', () => {
    // Geometry captured in the 2026-11-10 long soak: 13 expired preserved rows were removed above
    // a pinned list; scroll anchoring moved the offset 537 px up and left it 65 px from the
    // bottom, which the old handler read as the reader scrolling up. It stayed paused (650 rows).
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 9_086, clientHeight: 568, scrollTop: 0 });
    const pinnedChanges: boolean[] = [];
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => null,
      onPinnedChange: (pinned) => pinnedChanges.push(pinned),
    });
    controller.scrollToBottom();
    expect(metrics.scrollTop).toBe(8_518);

    metrics.scrollHeight = 8_614;
    metrics.scrollTop = 7_981;
    container.dispatchEvent(new Event('scroll'));

    expect(controller.isPinned).toBe(true);
    expect(pinnedChanges).toEqual([]);
    expect(metrics.scrollTop).toBe(8_046);
    expect(decideScrollFollow(controller.isPinned, 3).showPill).toBe(false);
    controller.dispose();
  });

  it('counts an upward offset change as the reader only within the input window', () => {
    let now = 10_000;
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null, now: () => now });
    controller.scrollToBottom();

    userKey();
    now += USER_SCROLL_INPUT_WINDOW_MS + 1;
    metrics.scrollTop = 400;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);
    expect(metrics.scrollTop).toBe(750);

    userKey();
    now += USER_SCROLL_INPUT_WINDOW_MS - 1;
    metrics.scrollTop = 400;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(false);
    controller.dispose();
  });

  it('keeps a jump the reader asked for from outside the list (user card, removed panel)', () => {
    // 2026-11-16: jumpToMessage scrolls the own list from a click outside it; without this signal the
    // upward move had no input and the pinned list snapped straight back to the bottom.
    let now = 0;
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null, now: () => now });
    controller.scrollToBottom();

    container.dispatchEvent(new Event(READER_SCROLL_EVENT));
    now += 300;
    metrics.scrollTop = 200;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(false);
    expect(metrics.scrollTop).toBe(200);
    controller.dispose();
  });

  it('treats middle-button autoscroll as reader input until the next press', () => {
    let now = 0;
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null, now: () => now });
    controller.scrollToBottom();

    container.dispatchEvent(new MouseEvent('pointerdown', { button: 1 }));
    now += 10_000;
    metrics.scrollTop = 500;
    container.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(false);
    controller.dispose();
  });

  it('does not read the offset before a trim when nobody gave input', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });
    controller.scrollToBottom();
    let reads = 0;
    const base = Object.getOwnPropertyDescriptor(container, 'scrollTop')!;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => { reads++; return base.get!.call(container); },
      set: (value: number) => base.set!.call(container, value),
    });
    let readsBeforeMutate = -1;
    controller.preserveScrollIntent(() => { readsBeforeMutate = reads; metrics.scrollHeight = 1_100; });
    expect(readsBeforeMutate).toBe(0);
    controller.dispose();
  });

  it('reasserts the bottom when an observed row grows while pinned', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    let notifyResize: (() => void) | undefined;
    const observe = vi.fn();
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe, unobserve: vi.fn(), disconnect: vi.fn() };
      },
    });
    controller.observeRows([row]);

    metrics.scrollHeight = 1_300;
    notifyResize?.();

    expect(observe).toHaveBeenCalledWith(row);
    expect(metrics.scrollTop).toBe(1_050);
    expect(controller.isPinned).toBe(true);
    controller.dispose();
  });

  it('keeps the active smooth behavior when an observed row grows while hovered', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const smoothScroll = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: smoothScroll });
    let notifyResize: (() => void) | undefined;
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
      getScrollFollowBehavior: () => 'smooth',
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    controller.observeRows([row]);
    controller.scrollToBottom();

    metrics.scrollHeight = 1_300;
    notifyResize?.();

    expect(smoothScroll).toHaveBeenCalledWith({ top: 1_300, behavior: 'smooth' });
    controller.dispose();
  });

  it('suppresses a resize follow that matches an unsettled target and behavior', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 500 });
    const smoothScroll = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: smoothScroll });
    let notifyResize: (() => void) | undefined;
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
      getScrollFollowBehavior: () => 'smooth',
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    controller.observeRows([row]);

    controller.scrollToBottom();
    metrics.scrollTop = 500;
    controller.scrollToBottom('smooth');
    notifyResize?.();

    expect(smoothScroll).toHaveBeenCalledTimes(1);
    expect(smoothScroll).toHaveBeenCalledWith({ top: 1_000, behavior: 'smooth' });

    metrics.scrollTop = 750;
    container.dispatchEvent(new Event('scrollend'));
    notifyResize?.();

    expect(smoothScroll).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('retains a resize follow when the unsettled bottom target changes', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 500 });
    const smoothScroll = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: smoothScroll });
    let notifyResize: (() => void) | undefined;
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
      getScrollFollowBehavior: () => 'smooth',
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    controller.observeRows([row]);

    controller.scrollToBottom();
    metrics.scrollTop = 500;
    controller.scrollToBottom('smooth');
    metrics.scrollHeight = 1_300;
    notifyResize?.();

    expect(smoothScroll).toHaveBeenNthCalledWith(1, { top: 1_000, behavior: 'smooth' });
    expect(smoothScroll).toHaveBeenNthCalledWith(2, { top: 1_300, behavior: 'smooth' });
    controller.dispose();
  });

  it('retains a resize follow when the unsettled behavior changes', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 500 });
    const smoothScroll = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: smoothScroll });
    let notifyResize: (() => void) | undefined;
    let behavior: 'auto' | 'smooth' = 'smooth';
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
      getScrollFollowBehavior: () => behavior,
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    controller.observeRows([row]);

    controller.scrollToBottom();
    metrics.scrollTop = 500;
    controller.scrollToBottom('smooth');
    behavior = 'auto';
    notifyResize?.();

    expect(smoothScroll).toHaveBeenCalledTimes(1);
    expect(metrics.scrollTop).toBe(750);
    controller.dispose();
  });

  it('does not move the reading position when an observed row grows while paused', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    container.append(row);
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 500 });
    let notifyResize: (() => void) | undefined;
    const controller = new ScrollFollowController(container, {
      createResizeObserver: (callback) => {
        notifyResize = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      },
    });
    controller.observeRows([row]);
    userKey();
    metrics.scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));

    metrics.scrollHeight = 1_300;
    notifyResize?.();

    expect(controller.isPinned).toBe(false);
    expect(metrics.scrollTop).toBe(300);
    controller.dispose();
  });

  it('disconnects on teardown and a new channel session starts pinned', () => {
    const firstContainer = document.createElement('div');
    const firstMetrics = mockScrollMetrics(firstContainer, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const disconnect = vi.fn();
    const first = new ScrollFollowController(firstContainer, {
      createResizeObserver: () => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect }),
    });
    userKey();
    firstMetrics.scrollTop = 300;
    firstContainer.dispatchEvent(new Event('scroll'));
    expect(first.isPinned).toBe(false);
    first.dispose();

    firstMetrics.scrollTop = 100;
    firstContainer.dispatchEvent(new Event('scroll'));
    const secondContainer = document.createElement('div');
    mockScrollMetrics(secondContainer, { scrollHeight: 250, clientHeight: 250, scrollTop: 0 });
    const second = new ScrollFollowController(secondContainer, { createResizeObserver: () => null });

    expect(disconnect).toHaveBeenCalledOnce();
    expect(second.isPinned).toBe(true);
    second.dispose();
  });
});

describe('decideScrollFollow', () => {
  // Literal caps on purpose (not the imported constants) so this test actually catches
  // someone silently changing 200 -> X or 600 -> Y instead of just mirroring the source.
  it('pinned to bottom: snaps to bottom, normal trim cap, no pill', () => {
    expect(decideScrollFollow(true, 5)).toEqual({
      scrollToBottom: true,
      scrollBehavior: 'auto',
      trimCap: 200,
      showPill: false,
    });
  });

  it('paused (scrolled up) with rows appended: no snap, paused trim cap, shows pill', () => {
    expect(decideScrollFollow(false, 5)).toEqual({
      scrollToBottom: false,
      scrollBehavior: 'auto',
      trimCap: 600,
      showPill: true,
    });
  });

  it('paused with no rows appended: no pill', () => {
    expect(decideScrollFollow(false, 0).showPill).toBe(false);
  });

  it('uses smooth behavior only for a pinned hovered list', () => {
    expect(decideScrollFollow(true, 1, true)).toEqual({
      scrollToBottom: true,
      scrollBehavior: 'smooth',
      trimCap: 200,
      showPill: false,
    });
  });

  it('uses the supplied hovered behavior while pinned and hovered', () => {
    expect(decideScrollFollow(true, 1, true, 'auto')).toEqual({
      scrollToBottom: true,
      scrollBehavior: 'auto',
      trimCap: 200,
      showPill: false,
    });
    expect(decideScrollFollow(true, 1, false, 'auto').scrollBehavior).toBe('auto');
  });
});

describe('attachScrollFollowHover', () => {
  it('moves own-list hover to the row under a stationary pointer after incoming rows shift the list', async () => {
    const container = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.className = second.className = 'kickflow-message';
    container.append(first, second);
    document.body.append(container);
    let hit: Element = first;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });
    const hover = attachScrollFollowHover(container, controller);
    try {
      container.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 250 }));
      expect(first.hasAttribute('data-kickflow-pointer-row')).toBe(true);
      hit = second;
      second.style.transform = 'translateY(32px)';
      // The re-hit runs on an animation frame; a fixed 30 ms wait failed once on a loaded host
      // (2026-11-11), so wait for the frame instead of for a guess at its timing.
      await vi.waitFor(() => expect(second.hasAttribute('data-kickflow-pointer-row')).toBe(true));
      expect(first.hasAttribute('data-kickflow-pointer-row')).toBe(false);
      hit = first;
      container.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(first.hasAttribute('data-kickflow-pointer-row')).toBe(true));
      expect(second.hasAttribute('data-kickflow-pointer-row')).toBe(false);
      container.dispatchEvent(new Event('pointerleave'));
      expect(first.hasAttribute('data-kickflow-pointer-row')).toBe(false);
    } finally {
      hover.dispose();
      controller.dispose();
      container.remove();
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('tracks one pointer listener pair and exposes transition hooks', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const smoothScroll = vi.fn((options: ScrollToOptions) => {
      container.scrollTop = options.top ?? 0;
    });
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: smoothScroll });
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => null,
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    const hoverChanges: boolean[] = [];
    const onPointerLeave = vi.fn();
    const hover = attachScrollFollowHover(container, controller, {
      onHoverChange: (hovered) => hoverChanges.push(hovered),
      onPointerLeave,
    });

    try {
      const initialDecision = hover.decide(1);
      hover.apply(initialDecision);
      expect(initialDecision.scrollBehavior).toBe('auto');
      expect(metrics.scrollTop).toBe(750);

      container.dispatchEvent(new Event('pointerenter'));
      const hoveredDecision = hover.decide(1);
      hover.apply(hoveredDecision);

      expect(hoveredDecision.scrollToBottom).toBe(false);
      expect(hoveredDecision.showPill).toBe(true);
      expect(hoveredDecision.trimCap).toBe(MAX_NON_PRESERVED_NODES_PAUSED);
      expect(smoothScroll).not.toHaveBeenCalled();

      container.dispatchEvent(new Event('pointerleave'));
      const restoredDecision = hover.decide(1);
      hover.apply(restoredDecision);
      expect(restoredDecision).toEqual({
        scrollToBottom: true,
        scrollBehavior: 'auto',
        trimCap: 200,
        showPill: false,
      });
      expect(hoverChanges).toEqual([true, false]);
      expect(onPointerLeave).toHaveBeenCalledOnce();
      expect(metrics.scrollTop).toBe(750);
    } finally {
      hover.dispose();
      controller.dispose();
    }
  });

  it('resumes the selected hovered behavior after the aim hold expires', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    Object.defineProperty(container, 'scrollTo', {
      configurable: true,
      value: vi.fn((options: ScrollToOptions) => {
        container.scrollTop = options.top ?? 0;
      }),
    });
    const controller = new ScrollFollowController(container, {
      createResizeObserver: () => null,
      scheduleFrame: () => 1,
      cancelFrame: vi.fn(),
    });
    let hoveredBehavior: 'auto' | 'smooth' = 'smooth';
    const hover = attachScrollFollowHover(container, controller, {
      getHoveredBehavior: () => hoveredBehavior,
    });

    try {
      container.dispatchEvent(new Event('pointerenter'));
      expect(hover.decide(1).scrollToBottom).toBe(false);
      vi.advanceTimersByTime(2_001);
      expect(hover.decide(1).scrollBehavior).toBe('smooth');
      hoveredBehavior = 'auto';
      expect(hover.decide(1).scrollBehavior).toBe('auto');
    } finally {
      hover.dispose();
      controller.dispose();
      vi.useRealTimers();
    }
  });
});

describe('trimMessageWindow', () => {
  it('measures every removed row before mutating layout and retains the reading offset', () => {
    const container = buildContainer(5, 1);
    container.scrollTop = 100;
    const reads: number[] = [];
    for (const node of Array.from(container.children)) {
      vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
        reads.push(container.childElementCount);
        return { height: 12.25 } as DOMRect;
      });
    }
    trimMessageWindow(container, new ChatDomRegistry(), 2);
    expect(reads).toEqual([6, 6, 6]);
    expect(container.scrollTop).toBe(63.25);
    expect(container.firstElementChild?.classList.contains(PRESERVED_CLASS)).toBe(true);
  });

  it('trims non-preserved nodes down to the default cap', () => {
    const container = buildContainer(MAX_NON_PRESERVED_NODES + 50);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry);

    expect(container.querySelectorAll(`.${MESSAGE_CLASS}`)).toHaveLength(MAX_NON_PRESERVED_NODES);
  });

  it('trims down to a custom cap', () => {
    const container = buildContainer(20);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry, 5);

    expect(container.querySelectorAll(`.${MESSAGE_CLASS}`)).toHaveLength(5);
  });

  it('never trims preserved nodes, even under a low custom cap', () => {
    const container = buildContainer(20, 10);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry, 5);

    expect(container.querySelectorAll(`.${PRESERVED_CLASS}`)).toHaveLength(10);
    expect(container.querySelectorAll(`.${MESSAGE_CLASS}:not(.${PRESERVED_CLASS})`)).toHaveLength(5);
  });

  it('keeps the current reading window intact below the paused safety cap', () => {
    const container = buildContainer(300, 5);
    const registry = new ChatDomRegistry();
    const rowBeingRead = container.children[150];

    trimMessageWindow(container, registry, MAX_NON_PRESERVED_NODES_PAUSED);

    expect(container.contains(rowBeingRead)).toBe(true);
    expect(container.querySelectorAll(`.${MESSAGE_CLASS}`)).toHaveLength(305);
  });

  it('calls registry.forget for each removed node', () => {
    const container = buildContainer(20);
    const registry = new ChatDomRegistry();
    const forgetSpy = vi.spyOn(registry, 'forget');

    trimMessageWindow(container, registry, 5);

    expect(forgetSpy).toHaveBeenCalledTimes(15);
  });
});

describe('jumpToMessage', () => {
  it('tells the own list that the reader asked for the scroll before it moves', () => {
    const own = document.createElement('div'); own.id = OWN_LIST_ID;
    const row = document.createElement('div'); row.dataset.messageId = 'm-1';
    const order: string[] = [];
    row.scrollIntoView = vi.fn(() => { order.push('scroll'); });
    own.append(row); document.body.append(own);
    own.addEventListener(READER_SCROLL_EVENT, () => order.push('reader'));
    expect(jumpToMessage('m-1', document.createElement('span'))).toBe(true);
    expect(order).toEqual(['reader', 'scroll']);
    own.remove();
  });
});
