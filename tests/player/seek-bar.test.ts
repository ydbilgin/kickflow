import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computePlayedRatio,
  initSeekBar,
  isNativeSeekBarVisible,
  probeKickClassesResolved,
  seekDeltaForRatio,
} from '../../src/content/player/seek-bar';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';

beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

function makeVideo(currentTime: number, buffered: [number, number][]): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: currentTime, writable: true },
    buffered: { configurable: true, value: fakeTimeRanges(buffered), writable: true },
    seekable: { configurable: true, value: fakeTimeRanges([[0, 2 ** 30]]), writable: true },
    duration: { configurable: true, value: Infinity },
  });
  return video;
}

/** jsdom performs no layout, so every rect is zero. Anything that reasons about on-screen size
 * has to be told what the box is, or the test proves nothing about the real page. */
function stubRect(el: Element, width: number, height: number, left = 0): void {
  el.getBoundingClientRect = () => ({
    x: left, y: 0, left, top: 0, right: left + width, bottom: height,
    width, height, toJSON: () => ({}),
  }) as DOMRect;
}

describe('computePlayedRatio', () => {
  it('places the playhead inside the addressable [seekFloor, liveEdge] window', () => {
    expect(computePlayedRatio(makeVideo(130, [[100, 160]]))).toBeCloseTo(0.5, 5);
    expect(computePlayedRatio(makeVideo(100, [[100, 160]]))).toBe(0);
    expect(computePlayedRatio(makeVideo(160, [[100, 160]]))).toBe(1);
  });

  it('clamps rather than reporting a position outside the bar', () => {
    expect(computePlayedRatio(makeVideo(40, [[100, 160]]))).toBe(0);
    expect(computePlayedRatio(makeVideo(400, [[100, 160]]))).toBe(1);
  });

  it('reports nothing when there is no window to draw', () => {
    expect(computePlayedRatio(makeVideo(0, []))).toBeNull();
    expect(computePlayedRatio(makeVideo(10, [[10, 10]]))).toBeNull();
  });

  it('measures the furthest buffered range, not a stale near-zero preload', () => {
    // The stale-preload shape that catapulted seeks in round 11: the real window is the far one.
    expect(computePlayedRatio(makeVideo(130, [[0, 2], [100, 160]]))).toBeCloseTo(0.8125, 4);
  });
});

describe('seekDeltaForRatio', () => {
  it('converts a click position into a delta from the current playhead', () => {
    const video = makeVideo(130, [[100, 160]]);
    expect(seekDeltaForRatio(video, 0.5)).toBeCloseTo(0, 5);
    expect(seekDeltaForRatio(video, 0)).toBeCloseTo(-30, 5);
    expect(seekDeltaForRatio(video, 1)).toBeCloseTo(30, 5);
  });

  it('clamps an out-of-range ratio to the window instead of seeking past it', () => {
    const video = makeVideo(130, [[100, 160]]);
    expect(seekDeltaForRatio(video, -3)).toBeCloseTo(-30, 5);
    expect(seekDeltaForRatio(video, 9)).toBeCloseTo(30, 5);
  });

  it('returns nothing when there is no window', () => {
    expect(seekDeltaForRatio(makeVideo(0, []), 0.5)).toBeNull();
  });
});

describe('isNativeSeekBarVisible', () => {
  function seekbarNode(id?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'group/seekbar absolute -top-7 left-0 h-5 w-full';
    if (id) el.id = id;
    document.body.append(el);
    return el;
  }

  it('sees Kick’s own drawn bar', () => {
    stubRect(seekbarNode(), 800, 20);
    expect(isNativeSeekBarVisible(document)).toBe(true);
  });

  it('never counts our own bar as Kick’s', () => {
    stubRect(seekbarNode('kickflow-seek-bar'), 800, 20);
    expect(isNativeSeekBarVisible(document)).toBe(false);
  });

  it('does not count a bar that is mounted but collapsed to nothing', () => {
    stubRect(seekbarNode(), 0, 0);
    expect(isNativeSeekBarVisible(document)).toBe(false);
  });
});

describe('probeKickClassesResolved', () => {
  function pair(): { root: HTMLElement; range: HTMLElement } {
    const root = document.createElement('div');
    const range = document.createElement('div');
    root.append(range);
    return { root, range };
  }

  it('refuses to judge a detached element, so the fallback cannot latch on at build time', () => {
    const { root, range } = pair();
    expect(probeKickClassesResolved(root, range)).toBe(false);
    expect(root.classList.contains('kickflow-seek-bar--fallback')).toBe(false);
  });

  it('falls back when the utility class paints nothing', () => {
    const { root, range } = pair();
    document.body.append(root);
    expect(probeKickClassesResolved(root, range)).toBe(true);
    expect(root.classList.contains('kickflow-seek-bar--fallback')).toBe(true);
  });

  it('leaves Kick’s own values alone when the class did resolve', () => {
    const { root, range } = pair();
    range.style.backgroundColor = 'rgb(83, 252, 24)';
    document.body.append(root);
    expect(probeKickClassesResolved(root, range)).toBe(true);
    expect(root.classList.contains('kickflow-seek-bar--fallback')).toBe(false);
  });
});

describe('initSeekBar', () => {
  function mountPlayer(currentTime: number, buffered: [number, number][]): {
    video: HTMLVideoElement; bar: HTMLElement; lifecycle: Lifecycle;
  } {
    const wrapper = document.createElement('div');
    const video = makeVideo(currentTime, buffered);
    video.id = 'video-player';
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const live = document.createElement('button');
    live.textContent = 'LIVE';
    bar.append(live);
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const lifecycle = new Lifecycle();
    initSeekBar(lifecycle);
    return { video, bar, lifecycle };
  }

  const findBar = (): HTMLElement =>
    document.getElementById('kickflow-seek-bar') as HTMLElement;

  it('mounts into the control bar itself, not among the buttons', () => {
    const { bar, lifecycle } = mountPlayer(130, [[100, 160]]);
    const seekBar = findBar();
    expect(seekBar).not.toBeNull();
    expect(seekBar.parentElement).toBe(bar);
    // Kick's own bar carries these; parity depends on them surviving the build.
    expect(seekBar.className).toContain('group/seekbar');
    expect(seekBar.querySelector('.kickflow-seek-bar__range')?.className).toContain('bg-green-500');
    lifecycle.dispose();
  });

  it('renders the playhead position as the green range width', () => {
    const { video, lifecycle } = mountPlayer(130, [[100, 160]]);
    video.dispatchEvent(new Event('timeupdate'));
    const range = findBar().querySelector('.kickflow-seek-bar__range') as HTMLElement;
    expect(findBar().hidden).toBe(false);
    expect(range.style.width).toBe('50%'); // the CSSOM normalises our 2dp string
    lifecycle.dispose();
  });

  it('stays out of the way while Kick is drawing its own bar', () => {
    const { video, bar, lifecycle } = mountPlayer(130, [[100, 160]]);
    const native = document.createElement('div');
    native.className = 'group/seekbar absolute -top-7 left-0 h-5 w-full';
    stubRect(native, 800, 20);
    bar.append(native);

    video.dispatchEvent(new Event('timeupdate'));
    expect(findBar().hidden).toBe(true);

    native.remove();
    video.dispatchEvent(new Event('timeupdate'));
    expect(findBar().hidden).toBe(false);
    lifecycle.dispose();
  });

  it('hides itself when there is no addressable window rather than pinning to an end', () => {
    const { video, lifecycle } = mountPlayer(0, []);
    video.dispatchEvent(new Event('timeupdate'));
    expect(findBar().hidden).toBe(true);
    lifecycle.dispose();
  });

  it('seeks through the shared clamp when clicked', () => {
    const { video, lifecycle } = mountPlayer(130, [[100, 160]]);
    const seekBar = findBar();
    stubRect(seekBar, 400, 20);

    seekBar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
    // 25% across a [100,160] window = 115s, and the clamp permits it: backwards, within range.
    expect(video.currentTime).toBeCloseTo(115, 5);
    lifecycle.dispose();
  });

  it('is removed with its lifecycle', () => {
    const { lifecycle } = mountPlayer(130, [[100, 160]]);
    expect(findBar()).not.toBeNull();
    lifecycle.dispose();
    expect(findBar()).toBeNull();
  });
});
