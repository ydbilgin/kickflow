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
  return { list, row, metrics, follow, targets, resize: (target: Element) => {
    if (targets.has(target)) resize();
  } };
}

describe('own chat viewport follow regressions', () => {
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

  it('lets upward wheel intent beat a queued resize or incoming message before scroll delivery', () => {
    const f = fixture();
    f.follow.scrollToBottom();
    f.list.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    const hover = attachScrollFollowHover(f.list, f.follow);
    f.metrics.height += 90;
    hover.apply(hover.decide(1));
    f.resize(f.row);
    expect(f.follow.isPinned).toBe(false);
    expect(f.metrics.top).toBe(700);
    hover.dispose();
    f.follow.dispose();
  });

  it('cancels smooth follow when upward wheel input occurs before any offset changes', () => {
    const f = fixture();
    const scrollTo = vi.fn();
    f.list.scrollTo = scrollTo;
    f.follow.scrollToBottom('smooth');
    f.list.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: 'instant' });
    expect(f.follow.isPinned).toBe(false);
    f.follow.dispose();
  });

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
