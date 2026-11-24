import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachScrollFollowHover,
  ScrollFollowController,
  decideScrollFollow,
  trimMessageWindow,
} from '../../src/content/chat/dom-window';
import { HoverReleaseMeter } from '../../src/content/chat/hover-meter';
import { HIDDEN_BACKLOG_ROWS, RenderQueue } from '../../src/content/chat/render-queue';
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
  it('wires the production reply action through a queued live row and a reconnect batch', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const container = document.createElement('div'); document.body.append(container);
    const onReply = vi.fn();
    const queue = new RenderQueue({ getContainer: () => container, registry: new ChatDomRegistry(), onReply });
    try {
      queue.enqueue(message('before-reconnect')); queue.flushPending();
      queue.enqueue(message('after-reconnect')); queue.flushPending();
      const buttons = container.querySelectorAll<HTMLButtonElement>('.kickflow-message__reply-action');
      expect(buttons).toHaveLength(2);
      buttons[0].click(); buttons[1].click();
      expect(onReply.mock.calls.map(call => call[0].id)).toEqual(['before-reconnect', 'after-reconnect']);
    } finally { queue.dispose(); }
  });

  it('commits an ordered live batch once and keeps existing row identity and listeners', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const container = document.createElement('div');
    document.body.append(container);
    const registry = new ChatDomRegistry();
    const queue = new RenderQueue({ getContainer: () => container, registry });
    const first = message('existing'); first.createdAt = '2026-10-23T00:00:00Z';
    queue.enqueue(first); queue.flushPending();
    const existing = container.firstElementChild!;
    const click = vi.fn(); existing.addEventListener('click', click);
    const observer = new MutationObserver(() => {}); observer.observe(container, { childList: true });
    for (let i = 0; i < 50; i++) {
      const row = message('live-' + i); row.createdAt = new Date(Date.parse(first.createdAt) + i + 1).toISOString(); queue.enqueue(row);
    }
    const additions = observer.takeRecords();
    expect(additions).toHaveLength(1);
    expect(additions[0].addedNodes.length).toBe(50);
    expect(container.firstElementChild).toBe(existing);
    existing.dispatchEvent(new Event('click')); expect(click).toHaveBeenCalledOnce();
    expect(registry.getElementForMessageId('existing')).toBe(existing);
    observer.disconnect(); queue.dispose();
  });

  it('inserts delayed and out-of-order history stably across batches', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const container = document.createElement('div');
    const queue = new RenderQueue({ getContainer: () => container, registry: new ChatDomRegistry() });
    const add = (id: string, time: string) => { const row = message(id); row.createdAt = time; queue.enqueue(row); };
    const early = '2026-10-23T00:00:01Z', late = '2026-10-23T00:00:03Z';
    add('late', late); queue.flushPending();
    add('middle', '2026-10-23T00:00:02Z'); add('early-a', early); add('early-b', early); queue.flushPending();
    add('last', '2026-10-23T00:00:04Z'); queue.flushPending();
    expect(Array.from(container.children).map(row => (row as HTMLElement).dataset.messageId)).toEqual(['early-a', 'early-b', 'middle', 'late', 'last']);
    queue.dispose();
  });

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

  it('meters after the aim hold and flushes the own-list backlog on pointer leave', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const ownList = document.createElement('div');
    ownList.id = 'kickflow-message-list';
    document.body.append(ownList);
    const meter = new HoverReleaseMeter();
    let queue: RenderQueue | null = null;
    let hover: ReturnType<typeof attachScrollFollowHover> | null = null;
    const follow = new ScrollFollowController(ownList, {
      createResizeObserver: () => null,
      onPinnedChange: pinned => {
        meter.setMetered((hover?.isHovered ?? false) && pinned);
        queue?.wake();
      },
    });
    hover = attachScrollFollowHover(ownList, follow, {
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
      expect(follow.isPinned).toBe(false);
      vi.advanceTimersByTime(2_000);
      expect(follow.isPinned).toBe(true);
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

  it('releases evicted message references while the guarded mount remains unavailable', () => {
    // Only the timers this queue uses are faked. With vitest's full fake-timer set, jsdom row
    // building took ~56 ms per row (measured 2026-11-11) and the 800-row recovery took 20-28 s,
    // which was this test's long-standing timeout; with these two faked it is ~1 ms per row.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    // Detached on purpose: jsdom row insertion into the live document grows with its size, and this
    // test is about references, not layout.
    const container = document.createElement('div');
    let available = false;
    const store = new ChatIntegrityStore();
    const onPendingChange = vi.fn();
    const queue = new RenderQueue({
      getContainer: () => available ? container : null,
      registry: new ChatDomRegistry(),
      shouldRender: nextMessage => store.getMessageById(nextMessage.id) === nextMessage,
      onPendingChange,
    });
    for (let index = 0; index < 1_000; index++) {
      const nextMessage = message(`mount-gap-${index}`);
      store.addMessage(nextMessage);
      queue.enqueue(nextMessage);
    }
    vi.advanceTimersByTime(250);

    expect(store.getMessageById('mount-gap-0')).toBeUndefined();
    const retained = store.getMessagesInArrivalOrder();
    expect(retained.length).toBeGreaterThan(0);
    expect(queue.pendingCount).toBe(retained.length);
    expect(onPendingChange).toHaveBeenLastCalledWith(retained.length);
    available = true;
    vi.advanceTimersByTime(250);
    expect(container.childElementCount).toBe(retained.length);
    expect(container.querySelector('[data-message-id="mount-gap-0"]')).toBeNull();
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

  it('renders on a timer while hidden until the first rows have landed (startup readiness)', () => {
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

  // 2026-11-11 (performance): the two tests here used to require that a hidden tab keeps building
  // rows on a timer; that was the behaviour to remove, not to keep. A hidden tab now writes
  // nothing to the DOM, holds a bounded backlog and renders the newest rows when it returns.
  it('builds no rows while the tab is hidden and renders the newest backlog when it returns', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const container = document.createElement('div');
    document.body.append(container);
    const store = new ChatIntegrityStore();
    const queue = new RenderQueue({
      getContainer: () => container,
      registry: new ChatDomRegistry(),
      shouldRender: (next) => store.getMessageById(next.id) === next,
    });
    const add = (id: string): void => {
      const next = message(id);
      if (store.addMessage(next)) queue.enqueue(next);
    };
    try {
      add('before-hide');
      vi.advanceTimersByTime(250);
      expect(container.childElementCount).toBe(1);

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      const observer = new MutationObserver(() => {});
      observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
      add('hidden-deleted');
      store.markMessageDeleted('hidden-deleted');
      for (let index = 0; index < 1_000; index++) add(`hidden-${index}`);
      vi.advanceTimersByTime(60_000);
      expect(observer.takeRecords()).toEqual([]);
      observer.disconnect();
      expect(container.childElementCount).toBe(1);
      expect(queue.pendingCount).toBeLessThan(HIDDEN_BACKLOG_ROWS * 2 + 2);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      // The newest HIDDEN_BACKLOG_ROWS ordinary rows plus the preserved (deleted) one.
      expect(container.childElementCount).toBe(1 + 1 + HIDDEN_BACKLOG_ROWS);
      expect(container.querySelector('[data-message-id="hidden-999"]')).not.toBeNull();
      expect(container.querySelector('[data-message-id="hidden-deleted"]')).not.toBeNull();
      expect(container.querySelector('[data-message-id="hidden-0"]')).toBeNull();
      expect(queue.pendingCount).toBe(0);
    } finally {
      queue.dispose();
    }
  });

  it('keeps the list pinned when a hidden-tab backlog lands on return', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
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
    const follow = new ScrollFollowController(container, { createResizeObserver: () => null, scheduleFrame: () => 0, cancelFrame: () => {} });
    const queue = new RenderQueue({
      getContainer: () => container,
      registry,
      onFlush: (appended) => {
        const decision = decideScrollFollow(follow.isPinned, appended.length);
        trimMessageWindow(container, registry, decision.trimCap);
        if (decision.scrollToBottom) follow.scrollToBottom();
      },
    });

    queue.enqueue(message('visible-first'));
    vi.advanceTimersByTime(250);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 10; i++) queue.enqueue(message(`hidden-bulk-${i}`));
    vi.advanceTimersByTime(5_000);
    expect(container.childElementCount).toBe(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(container.childElementCount).toBe(11);
    expect(scrollTop).toBe(11 * 20 - 100);
    expect(follow.isPinned).toBe(true);
    queue.dispose();
    follow.dispose();
  });

  // 2026-11-11 (performance): a pinned own-list flush may read layout only for the snap to the
  // bottom. Before 2026-11-10 every flush also measured wasAtBottom and the offset before the trim;
  // nothing failed when they were there, so this pins the read list of one flush exactly.
  it('reads layout only for the snap to the bottom when a pinned flush lands (no forced layout comes back)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const container = document.createElement('div');
    const reads: string[] = [];
    let top = 0;
    const metric = (name: string, value: () => number) => ({
      configurable: true,
      get: () => { reads.push(name); return value(); },
    });
    Object.defineProperties(container, {
      clientHeight: metric('clientHeight', () => 100),
      scrollHeight: metric('scrollHeight', () => container.childElementCount * 20),
      offsetHeight: metric('offsetHeight', () => 100),
      scrollTop: { configurable: true, get: () => { reads.push('scrollTop'); return top; }, set: (value: number) => { top = value; } },
    });
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => { reads.push('rect'); return new DOMRect(); });
    const registry = new ChatDomRegistry();
    const follow = new ScrollFollowController(container, { createResizeObserver: () => null, scheduleFrame: () => 0, cancelFrame: () => {} });
    const perFlush: string[][] = [];
    const queue = new RenderQueue({
      getContainer: () => container,
      registry,
      onFlush: (appended) => {
        const decision = decideScrollFollow(follow.isPinned, appended.length);
        follow.preserveScrollIntent(() => trimMessageWindow(container, registry, decision.trimCap, () => false));
        follow.scrollToBottom();
        perFlush.push(reads.splice(0));
      },
    });
    reads.length = 0;
    for (let i = 0; i < 300; i++) queue.enqueue(message(`layout-${i}`));
    vi.advanceTimersByTime(250);
    expect(perFlush.length).toBeGreaterThan(1);
    expect(perFlush.every((flushReads) => flushReads.join(',') === 'clientHeight,scrollHeight,scrollTop')).toBe(true);
    expect(reads).toEqual([]);
    queue.dispose();
    follow.dispose();
  });

  it('waits for the mount retry instead of re-filtering the whole backlog on every message', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    const store = new ChatIntegrityStore();
    let checks = 0;
    const queue = new RenderQueue({
      getContainer: () => null,
      registry: new ChatDomRegistry(),
      shouldRender: (next) => { checks += 1; return store.getMessageById(next.id) === next; },
    });
    for (let index = 0; index < 1_000; index++) {
      const next = message(`unmounted-${index}`);
      store.addMessage(next);
      queue.enqueue(next);
    }
    vi.advanceTimersByTime(250);
    // One filter at the 50-row batch, one at the 250 ms mount retry. Re-filtering on every message
    // cost 480,175 checks here (counted on the 2026-11-10 code); now 1,050.
    expect(checks).toBeLessThan(3_000);
    expect(queue.pendingCount).toBe(store.getMessagesInArrivalOrder().length);
    queue.dispose();
  });
});
