import { afterEach, expect, it, vi } from 'vitest';
import { attachScrollFollowHover, ScrollFollowController } from '../../src/content/chat/dom-window';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps metering when a body-level card covers chat, but flushes on a real exit', () => {
  const chat = document.createElement('div');
  const card = document.createElement('section');
  card.className = 'kickflow-user-card';
  const child = document.createElement('strong');
  card.append(child);
  document.body.append(chat, card);
  vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue({ left: 700, right: 1000, top: 100, bottom: 700 } as DOMRect);
  const follow = new ScrollFollowController(chat, { createResizeObserver: () => null });
  const flush = vi.fn();
  const transitions: boolean[] = [];
  const hover = attachScrollFollowHover(chat, follow, {
    hoverContinuationSelector: '.kickflow-user-card',
    onPointerLeave: flush,
    onHoverChange: (value) => transitions.push(value),
  });
  try {
    chat.dispatchEvent(new MouseEvent('pointerenter'));
    chat.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: child, clientX: 800, clientY: 300 }));
    expect(hover.isHovered).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 810, clientY: 310 }));
    expect(transitions).toEqual([true]);
    // The card can also extend across the video. Crossing chat's physical edge is a real exit.
    child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 650, clientY: 310 }));
    expect(hover.isHovered).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
    // Returning to the part above chat restores metering without needing a native-list enter.
    child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 810, clientY: 310 }));
    expect(hover.isHovered).toBe(true);
    child.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }));
    expect(hover.isHovered).toBe(false);
    expect(flush).toHaveBeenCalledTimes(2);
    child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 810, clientY: 310 }));
    window.dispatchEvent(new Event('blur'));
    expect(hover.isHovered).toBe(false);
    expect(flush).toHaveBeenCalledTimes(3);
    hover.dispose();
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 310 }));
    expect(flush).toHaveBeenCalledTimes(3);
  } finally { hover.dispose(); follow.dispose(); }
});

it('keeps metering across the native quick-emote strip immediately below chat', () => {
  const chat = document.createElement('div');
  const gap = document.createElement('div');
  const bar = document.createElement('div');
  bar.setAttribute('data-kickflow-native-quick-emotes', '');
  document.body.append(chat, gap, bar);
  vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue({ left: 700, right: 1000, top: 100, bottom: 700 } as DOMRect);
  const follow = new ScrollFollowController(chat, { createResizeObserver: () => null });
  const flush = vi.fn();
  const hover = attachScrollFollowHover(chat, follow, {
    hoverContinuationSelector: '.kickflow-user-card, [data-kickflow-native-quick-emotes]',
    onPointerLeave: flush,
  });
  try {
    chat.dispatchEvent(new MouseEvent('pointerenter'));
    // A physical pointer crosses the native gap before reaching the quick-emote row.
    chat.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: gap, clientX: 800, clientY: 705 }));
    expect(hover.isHovered).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    bar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 810, clientY: 720 }));
    expect(flush).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 810, clientY: 785 }));
    expect(hover.isHovered).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  } finally { hover.dispose(); follow.dispose(); }
});

it('flushes a genuine footer exit after the short gap grace', () => {
  vi.useFakeTimers();
  const chat = document.createElement('div');
  const gap = document.createElement('div');
  const bar = document.createElement('div');
  bar.setAttribute('data-kickflow-native-quick-emotes', '');
  document.body.append(chat, gap, bar);
  vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue({ left: 700, right: 1000, top: 100, bottom: 700 } as DOMRect);
  const follow = new ScrollFollowController(chat, { createResizeObserver: () => null });
  const flush = vi.fn();
  const hover = attachScrollFollowHover(chat, follow, {
    hoverContinuationSelector: '.kickflow-user-card, [data-kickflow-native-quick-emotes]',
    onPointerLeave: flush,
  });
  try {
    chat.dispatchEvent(new MouseEvent('pointerenter'));
    chat.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: gap, clientX: 800, clientY: 705 }));
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(hover.isHovered).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  } finally { hover.dispose(); follow.dispose(); }
});
