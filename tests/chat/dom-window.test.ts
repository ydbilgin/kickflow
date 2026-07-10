import { describe, expect, it, vi } from 'vitest';
import {
  MAX_NON_PRESERVED_NODES,
  MAX_NON_PRESERVED_NODES_PAUSED,
  ScrollFollowController,
  decideScrollFollow,
  isNearBottom,
  trimMessageWindow,
} from '../../src/content/chat/dom-window';
import { MESSAGE_CLASS, PRESERVED_CLASS } from '../../src/content/chat/message-view';
import { ChatDomRegistry } from '../../src/content/chat/message-store';

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

describe('isNearBottom', () => {
  it('treats an empty, non-overflowing list as pinned', () => {
    const container = document.createElement('div');
    mockScrollMetrics(container, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });

    expect(isNearBottom(container)).toBe(true);
  });
});

describe('ScrollFollowController', () => {
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
    metrics.scrollTop = 200;
    container.dispatchEvent(new Event('scroll'));

    expect(controller.isPinned).toBe(false);
    controller.dispose();
  });

  it('recognizes an upward scrollbar drag from the scrollTop direction alone', () => {
    const container = document.createElement('div');
    const metrics = mockScrollMetrics(container, { scrollHeight: 1_000, clientHeight: 250, scrollTop: 750 });
    const controller = new ScrollFollowController(container, { createResizeObserver: () => null });

    metrics.scrollTop = 400;
    container.dispatchEvent(new Event('scroll'));

    expect(controller.isPinned).toBe(false);
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
      trimCap: 200,
      showPill: false,
    });
  });

  it('paused (scrolled up) with rows appended: no snap, paused trim cap, shows pill', () => {
    expect(decideScrollFollow(false, 5)).toEqual({
      scrollToBottom: false,
      trimCap: 600,
      showPill: true,
    });
  });

  it('paused with no rows appended: no pill', () => {
    expect(decideScrollFollow(false, 0).showPill).toBe(false);
  });
});

describe('cap constants', () => {
  it('MAX_NON_PRESERVED_NODES is 200 and MAX_NON_PRESERVED_NODES_PAUSED is 600', () => {
    expect(MAX_NON_PRESERVED_NODES).toBe(200);
    expect(MAX_NON_PRESERVED_NODES_PAUSED).toBe(600);
  });
});

describe('trimMessageWindow', () => {
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
