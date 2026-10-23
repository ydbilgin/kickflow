import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/live-scroll-2026-10-18.json';
import { ScrollFollowController, decideScrollFollow } from '../../src/content/chat/dom-window';
import { buildMessageElement } from '../../src/content/chat/message-view';
import { chatMessage } from '../helpers/chat-message';

function setup() {
  const container = document.createElement('div');
  const metrics = { ...fixture.scroll };
  for (const input of fixture.messages) {
    const message = chatMessage(input.id, { content: input.content });
    message.sender.username = input.username;
    container.append(buildMessageElement(message));
  }
  Object.defineProperties(container, {
    scrollHeight: { get: () => metrics.scrollHeight },
    clientHeight: { get: () => metrics.clientHeight },
    scrollTop: { get: () => metrics.scrollTop, set: value => { metrics.scrollTop = value; } },
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    metrics.scrollTop = Math.max(0, (options.top ?? 0) - metrics.clientHeight);
  });
  Object.defineProperty(container, 'scrollTo', { value: scrollTo });
  let resized = () => {};
  const controller = new ScrollFollowController(container, {
    createResizeObserver: callback => {
      resized = callback;
      return { observe() {}, unobserve() {}, disconnect() {} };
    },
    getScrollFollowBehavior: () => 'smooth',
    scheduleFrame: () => 1,
    cancelFrame() {},
  });
  controller.observeRows([...container.children] as HTMLElement[]);
  return { container, metrics, scrollTo, controller, resize: () => resized() };
}

describe('live own-list wheel intent (2026-10-18)', () => {
  it('pauses before an emote resize or queued append can hide the upward scroll event', () => {
    const { container, metrics, scrollTo, controller, resize } = setup();
    try {
      controller.scrollToBottom('smooth');
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: fixture.wheelDeltaY }));
      // Browser default scroll precedes its queued scroll event. A ResizeObserver/queue
      // callback in that gap used to replace lastScrollTop and resume following the bottom.
      metrics.scrollTop += fixture.wheelDeltaY;
      const readingTop = metrics.scrollTop;
      resize();
      const append = decideScrollFollow(controller.isPinned, 1, true);
      if (append.scrollToBottom) controller.scrollToBottom(append.scrollBehavior);
      container.dispatchEvent(new Event('scroll'));
      expect(controller.isPinned).toBe(false);
      expect(metrics.scrollTop).toBe(readingTop);
      // The second call cancels the browser's in-flight smooth animation at the
      // current offset, before the default wheel scroll lands.
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenLastCalledWith({top: fixture.scroll.scrollTop, behavior: 'instant'});
      expect(append.showPill).toBe(true);
      expect(container.querySelectorAll('img.kickflow-emote')).toHaveLength(3);
      controller.scrollToBottom();
      expect(controller.isPinned).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it.each([
    { deltaY: 650 }, { deltaY: 0, deltaX: -650 }, { deltaY: -650, ctrlKey: true },
  ])('keeps following for downward, horizontal and zoom gestures: %j', input => {
    const { container, controller } = setup();
    try {
      container.dispatchEvent(new WheelEvent('wheel', input));
      expect(controller.isPinned).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it('does not pause an empty list and removes the wheel listener on disposal', () => {
    const { container, metrics, controller } = setup();
    metrics.scrollHeight = metrics.clientHeight;
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -650 }));
    expect(controller.isPinned).toBe(true);
    metrics.scrollHeight = fixture.scroll.scrollHeight;
    controller.dispose();
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -650 }));
    expect(controller.isPinned).toBe(true);
  });
});
