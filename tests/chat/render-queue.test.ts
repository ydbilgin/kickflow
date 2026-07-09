import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderQueue } from '../../src/content/chat/render-queue';
import { ChatDomRegistry, type ChatMessage } from '../../src/content/chat/message-store';

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
});
