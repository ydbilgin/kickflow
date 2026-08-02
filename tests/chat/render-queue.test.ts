import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachScrollFollowHover,
  ScrollFollowController,
  decideScrollFollow,
  trimMessageWindow,
} from '../../src/content/chat/dom-window';
import { HoverReleaseMeter } from '../../src/content/chat/hover-meter';
import { RenderQueue } from '../../src/content/chat/render-queue';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';

function message(id: string): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content: 'queued message',
    type: 'message',
    createdAt: new Date().toISOString(),
    sender: {
      id: 1,
      username: 'user',
      slug: 'user',
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('RenderQueue', () => {
  it('meters ten hovered rows at one row per interval and cancels its wake-up on dispose', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      releasePolicy: meter,
      now: () => Date.now(),
    });

    for (let i = 0; i < 10; i++) queue.enqueue(message(`metered-${i}`));
    vi.advanceTimersByTime(0);
    expect(container.childElementCount).toBe(1);
    vi.advanceTimersByTime(249);
    expect(container.childElementCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(container.childElementCount).toBe(2);
    vi.advanceTimersByTime(250 * 8);
    expect(container.childElementCount).toBe(10);

    expect(vi.getTimerCount()).toBe(0);
    queue.enqueue(message('dispose-wakeup'));
    expect(vi.getTimerCount()).toBe(1);
    queue.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports the pending count as metered rows enter and leave the queue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);
    const pendingCounts: number[] = [];
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      releasePolicy: meter,
      now: () => Date.now(),
      onPendingChange: (pendingCount) => pendingCounts.push(pendingCount),
    });

    queue.enqueue(message('pending-1'));
    queue.enqueue(message('pending-2'));
    queue.enqueue(message('pending-3'));
    vi.advanceTimersByTime(250 * 3);

    expect(pendingCounts).toEqual([1, 2, 3, 2, 1, 0]);
    expect(queue.pendingCount).toBe(0);
    queue.dispose();
  });

  it('does not let MAX_BATCH_SIZE eager flush bypass the metered policy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      releasePolicy: meter,
      now: () => Date.now(),
    });

    for (let i = 0; i < 50; i++) queue.enqueue(message(`eager-metered-${i}`));
    expect(container.childElementCount).toBe(1);
    vi.advanceTimersByTime(249);
    expect(container.childElementCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(container.childElementCount).toBe(2);
    queue.dispose();
  });

  it('meters and flushes the own-list backlog through the existing pointer hooks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const ownList = document.createElement('div');
    ownList.id = 'kickflow-message-list';
    document.body.append(ownList);
    const follow = new ScrollFollowController(ownList, { createResizeObserver: () => null });
    const meter = new HoverReleaseMeter();
    let queue: RenderQueue | null = null;
    const hover = attachScrollFollowHover(ownList, follow, {
      onHoverChange: (hovered) => {
        meter.setMetered(hovered && follow.isPinned);
        queue?.wake();
      },
      onPointerLeave: () => queue?.flushPending(),
    });
    const visibleIds = new Set<string>();
    queue = new RenderQueue({
      getContainer: () => ownList,
      registry: new ChatDomRegistry(),
      releasePolicy: meter,
      now: () => Date.now(),
      shouldRender: (nextMessage) => visibleIds.has(nextMessage.id),
    });

    try {
      ownList.dispatchEvent(new Event('pointerenter'));
      for (const id of ['own-1', 'own-2']) {
        visibleIds.add(id);
        queue.enqueue(message(id));
      }
      vi.advanceTimersByTime(0);
      expect(ownList.childElementCount).toBe(1);
      vi.advanceTimersByTime(249);
      expect(ownList.childElementCount).toBe(1);
      vi.advanceTimersByTime(1);
      expect(ownList.childElementCount).toBe(2);

      const deleted = message('deleted-while-waiting');
      visibleIds.add(deleted.id);
      queue.enqueue(deleted);
      visibleIds.delete(deleted.id);
      vi.advanceTimersByTime(250);
      expect(ownList.querySelector('[data-message-id="deleted-while-waiting"]')).toBeNull();

      for (const id of ['own-3', 'own-4']) {
        visibleIds.add(id);
        queue.enqueue(message(id));
      }
      ownList.dispatchEvent(new Event('pointerleave'));
      expect(ownList.childElementCount).toBe(4);
    } finally {
      hover.dispose();
      follow.dispose();
      queue.dispose();
    }
  });

  it('passes a session timestamp formatter to rendered message rows', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      formatTimestamp: () => '07:13:10',
    });

    queue.enqueue(message('vod-timestamp'));
    vi.advanceTimersByTime(250);

    expect(container.querySelector('.kickflow-message__time')?.textContent).toBe('07:13:10');
    queue.dispose();
  });

  it('retains a batch while the guarded mount is unavailable and renders it after recovery', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    let available = false;
    const queue = new RenderQueue({
      getContainer: () => available ? container : null,
      registry: new ChatDomRegistry(),
    });

    queue.enqueue(message('mount-gap'));
    vi.advanceTimersByTime(250);
    expect(container.childElementCount).toBe(0);

    available = true;
    vi.advanceTimersByTime(250);
    expect(container.textContent).toContain('queued message');
    queue.dispose();
  });

  it('renders a store-backed host event only once when the same synthetic id is received twice', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const store = new ChatIntegrityStore();
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
    });
    const event = message('host:1:user:1');
    event.systemEvent = {
      kind: 'host',
      username: 'user',
      numberViewers: 16,
      optionalMessage: null,
    };

    if (store.addMessage(event)) queue.enqueue(event);
    if (store.addMessage(event)) queue.enqueue(event);
    vi.advanceTimersByTime(250);

    expect(container.querySelectorAll('[data-message-id="host:1:user:1"]')).toHaveLength(1);
    queue.dispose();
  });

  it('does not render a message removed while it waits for the batch flush', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    let tracked = true;
    const onFlush = vi.fn();
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      shouldRender: () => tracked,
      onFlush,
    });

    queue.enqueue(message('deleted-before-flush'));
    tracked = false; // mirrors a delete event removing the store entry before the 250ms batch flush
    vi.advanceTimersByTime(250);

    expect(container.childElementCount).toBe(0);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('drops pending rows when a VOD seek resets the replay window', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
    });

    queue.enqueue(message('old-vod-window'));
    queue.clearPending();
    vi.runAllTimers();

    expect(container.childElementCount).toBe(0);
    queue.dispose();
  });

  it('uses a timer fallback while hidden instead of leaving a batch behind a suspended animation frame', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const animationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', animationFrame);
    const container = document.createElement('div');
    document.body.append(container);
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
    });

    queue.enqueue(message('hidden-tab-message'));
    vi.runAllTimers();

    expect(animationFrame).not.toHaveBeenCalled();
    expect(container.textContent).toContain('queued message');
    queue.dispose();
  });

  it('keeps a hidden-tab bulk flush pinned when the tab becomes visible again', () => {
    vi.useFakeTimers();
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const container = document.createElement('div');
    let scrollTop = 0;
    Object.defineProperties(container, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => Math.max(100, container.childElementCount * 20) },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, container.scrollHeight - container.clientHeight));
        },
      },
    });
    document.body.append(container);
    const registry = new ChatDomRegistry();
    const follow = new ScrollFollowController(container, { createResizeObserver: () => null });
    const queue = new RenderQueue({
      getContainer: () => container,
      registry,
      onFlush: (appended) => {
        const decision = decideScrollFollow(follow.isPinned, appended.length);
        trimMessageWindow(container, registry, decision.trimCap);
        if (decision.scrollToBottom) follow.scrollToBottom();
      },
    });

    for (let i = 0; i < 10; i++) queue.enqueue(message(`hidden-bulk-${i}`));
    vi.runAllTimers();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(container.childElementCount).toBe(10);
    expect(scrollTop).toBe(100);
    expect(follow.isPinned).toBe(true);
    queue.dispose();
    follow.dispose();
  });
});
