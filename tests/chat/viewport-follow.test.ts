import { describe, expect, it, vi } from 'vitest';
import { attachScrollFollowHover, ScrollFollowController } from '../../src/content/chat/dom-window';

function fixture() {
  const list = document.createElement('div');
  const row = document.createElement('div');
  list.append(row);
  const metrics = { height: 1200, viewport: 500, top: 700 };
  Object.defineProperties(list, {
    scrollHeight: { get: () => metrics.height },
    clientHeight: { get: () => metrics.viewport },
    scrollTop: { get: () => metrics.top, set: (n: number) => {
      metrics.top = Math.max(0, Math.min(n, metrics.height - metrics.viewport));
    } },
  });
  let resize = () => {};
  const targets = new Set<Element>();
  const follow = new ScrollFollowController(list, {
    createResizeObserver: callback => {
      resize = callback;
      return { observe: target => { targets.add(target); },
        unobserve: target => { targets.delete(target); }, disconnect: () => targets.clear() };
    },
    scheduleFrame: () => 1,
    cancelFrame: vi.fn(),
  });
  follow.observeRows([row]);
  // Establish the instant startup landing before testing later follow/cancellation.
  follow.scrollToBottom();
  return { list, row, metrics, follow, targets, resize: (target: Element) => {
    if (targets.has(target)) resize();
  } };
}

describe('own chat viewport follow regressions', () => {
  it('resumes hover-only follow after an anchor-preserving DOM trim', () => {
    const f = fixture(), hover = attachScrollFollowHover(f.list, f.follow);
    try {
      f.list.dispatchEvent(new Event('pointerenter'));
      f.follow.preserveScrollIntent(() => {f.metrics.height -= 200; f.metrics.top -= 200;});
      f.list.dispatchEvent(new Event('scroll'));
      f.metrics.height += 500;
      f.list.dispatchEvent(new Event('pointerleave'));
      expect(f.follow.isPinned).toBe(true);
      expect(f.metrics.top).toBe(1_000);
    } finally { hover.dispose(); f.follow.dispose(); }
  });

  it('captures pending upward user input before a trim instead of repinning on leave', () => {
    const f = fixture(), hover = attachScrollFollowHover(f.list, f.follow);
    try {
      f.list.dispatchEvent(new Event('pointerenter'));
      // Scrollbar/keyboard offset changed, but its browser scroll event is still queued.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
      f.metrics.top = 400;
      f.follow.preserveScrollIntent(() => {f.metrics.height -= 200; f.metrics.top -= 200;});
      f.list.dispatchEvent(new Event('scroll'));
      f.list.dispatchEvent(new Event('pointerleave'));
      expect(f.follow.isPinned).toBe(false);
      expect(f.metrics.top).toBe(200);
    } finally { hover.dispose(); f.follow.dispose(); }
  });

  it('holds through message growth and late row resize, then resumes on idle without another append', () => {
    vi.useFakeTimers();
    const f = fixture(), hover = attachScrollFollowHover(f.list, f.follow);
    try {
      f.list.dispatchEvent(new Event('pointerenter'));
      f.metrics.height += 800;
      hover.apply(hover.decide(20));
      f.resize(f.row);
      expect(f.metrics.top).toBe(700);
      vi.advanceTimersByTime(1_800);
      // Continued aiming extends the hold before the original deadline.
      f.list.dispatchEvent(new MouseEvent('pointermove', {clientX: 10, clientY: 20}));
      vi.advanceTimersByTime(400);
      expect(f.metrics.top).toBe(700);
      vi.advanceTimersByTime(1_601);
      expect(f.metrics.top).toBe(1_500);
      expect(f.follow.isPinned).toBe(true);
    } finally { hover.dispose(); f.follow.dispose(); vi.useRealTimers(); }
  });

  it('cancels an in-flight smooth scroll on hover before a press', () => {
    const f = fixture(), scrollTo = vi.fn();
    f.list.scrollTo = scrollTo;
    f.follow.scrollToBottom('smooth');
    const hover = attachScrollFollowHover(f.list, f.follow);
    try {
      f.list.dispatchEvent(new Event('pointerenter'));
      expect(scrollTo).toHaveBeenLastCalledWith({top: 700, behavior: 'instant'});
      f.metrics.height += 100;
      f.resize(f.row);
      expect(f.metrics.top).toBe(700);
      expect(f.follow.isPinned).toBe(false);
      f.list.dispatchEvent(new Event('pointerleave'));
      expect(f.metrics.top).toBe(800);
    } finally { hover.dispose(); f.follow.dispose(); }
  });

  it('keeps a held press still when the hover idle deadline expires', () => {
    vi.useFakeTimers();
    const f = fixture(), frames: FrameRequestCallback[] = [];
    f.follow.dispose();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {frames.push(callback); return frames.length;});
    // Use the browser frame boundary to assert release happens after the click task.
    const follow = new ScrollFollowController(f.list, {createResizeObserver: () => null});
    const hover = attachScrollFollowHover(f.list, follow);
    try {
      f.list.dispatchEvent(new Event('pointerenter'));
      f.list.dispatchEvent(new MouseEvent('pointerdown', {button: 0}));
      f.metrics.height += 100;
      vi.advanceTimersByTime(2_001);
      expect(follow.isPinned).toBe(false);
      expect(f.metrics.top).toBe(700);
      document.dispatchEvent(new Event('pointerup'));
      expect(f.metrics.top).toBe(700);
      for (const callback of frames.splice(0)) callback(0);
      expect(f.metrics.top).toBe(800);
    } finally { hover.dispose(); follow.dispose(); f.follow.dispose(); raf.mockRestore(); vi.useRealTimers(); }
  });

  it('does not treat touch entry as a hover hold and releases a mouse hold on blur', () => {
    const f = fixture(), hover = attachScrollFollowHover(f.list, f.follow);
    try {
      const touch = new Event('pointerenter');
      Object.defineProperty(touch, 'pointerType', {value: 'touch'});
      f.list.dispatchEvent(touch);
      expect(f.follow.isPinned).toBe(true);
      f.list.dispatchEvent(new Event('pointerenter'));
      f.metrics.height += 100;
      window.dispatchEvent(new Event('blur'));
      expect(f.follow.isPinned).toBe(true);
      expect(f.metrics.top).toBe(800);
    } finally { hover.dispose(); f.follow.dispose(); }
  });

  it('follows a slow-mode/emote/reply viewport shrink with unchanged message rows', () => {
    const f = fixture();
    f.metrics.viewport = 345;
    f.resize(f.list);
    expect(f.metrics.top).toBe(855);
    expect(f.follow.isPinned).toBe(true);
    f.follow.dispose();
    expect(f.targets.size).toBe(0);
  });

  it('keeps a paused reader in place through a viewport shrink and a new message', () => {
    const f = fixture();
    const hover = attachScrollFollowHover(f.list, f.follow);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
    f.metrics.top = 250;
    f.list.dispatchEvent(new Event('scroll'));
    f.metrics.viewport = 345;
    f.resize(f.list);
    f.metrics.height += 70;
    hover.apply(hover.decide(1));
    f.resize(f.row);
    expect(f.follow.isPinned).toBe(false);
    expect(f.metrics.top).toBe(250);
    hover.dispose();
    f.follow.dispose();
  });

  it('keeps following after a late image expands the last row', () => {
    const f = fixture();
    f.metrics.height += 180;
    f.resize(f.row);
    expect(f.metrics.top).toBe(880);
    f.follow.dispose();
  });

  // 2026-11-11: two wheel-intent tests that repeated live-scroll.regression.test.ts:44 were removed.
  it.each(['zoom', 'prevented'])('ignores a %s wheel gesture that will not scroll the list', kind => {
    const f = fixture();
    const event = new WheelEvent('wheel', { deltaY: -40, ctrlKey: kind === 'zoom', cancelable: true });
    if (kind === 'prevented') event.preventDefault();
    f.list.dispatchEvent(event);
    expect(f.follow.isPinned).toBe(true);
    f.follow.dispose();
  });

  it('cancels a newly started smooth follow even while its offset is still zero', () => {
    const f = fixture();
    f.metrics.top = 0;
    const scrollTo = vi.fn();
    f.list.scrollTo = scrollTo;
    f.follow.scrollToBottom('smooth');
    f.list.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    expect(f.follow.isPinned).toBe(false);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    f.follow.dispose();
  });
});
