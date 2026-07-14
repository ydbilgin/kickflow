import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollFollowController, decideScrollFollow, trimMessageWindow } from '../../src/content/chat/dom-window';
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
