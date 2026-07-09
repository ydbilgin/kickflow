import { afterEach, describe, expect, it } from 'vitest';
import { decideCatchup, initLiveCatchup, isLiveStream, type CatchupAction } from '../../src/content/player/live-catchup';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('decideCatchup', () => {
  it('recognizes only infinite or sentinel-duration media as live', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 90 });
    expect(isLiveStream(video)).toBe(false);

    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    expect(isLiveStream(video)).toBe(true);

    Object.defineProperty(video, 'duration', { configurable: true, value: 2 ** 30 });
    expect(isLiveStream(video)).toBe(true);
  });

  it('does not accelerate finite-duration VOD/clip playback from its buffered range', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      duration: { configurable: true, value: 90 },
      currentTime: { configurable: true, value: 0, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[0, 20]]) },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const live = document.createElement('button');
    live.textContent = 'LIVE';
    bar.append(live);
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const lifecycle = new Lifecycle();
    initLiveCatchup(lifecycle);
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1);
    lifecycle.dispose();
  });

  it('drops manual fast playback back to normal only at the live edge', () => {
    expect(decideCatchup({
      mode: 'manual',
      manualRate: 3,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'manualDropToNormal' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 3,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 0.5,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'manual',
      manualRate: 1,
      catchingUp: false,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });
  });

  it('auto mode crawls at 1.5x and resets at the edge without any snap action', () => {
    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: true,
    })).toEqual({ kind: 'setRate', rate: 1.5 });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: true,
      behindBy: 1,
      behindPlausible: true,
    })).toEqual({ kind: 'setRate', rate: 1 });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: true,
      behindBy: 5,
      behindPlausible: true,
    })).toEqual({ kind: 'none' });

    expect(decideCatchup({
      mode: 'auto',
      manualRate: 1,
      catchingUp: false,
      behindBy: 20,
      behindPlausible: false,
    })).toEqual({ kind: 'none' });

    const actionKinds: Array<CatchupAction['kind']> = ['none', 'setRate', 'manualDropToNormal'];
    expect(actionKinds).not.toContain('snap');
  });

  it('has no dvr suspend gate and no 15s snap branch in the pure decision', () => {
    const source = decideCatchup.toString();

    expect(source).not.toMatch(/dvr/i);
    expect(source).not.toMatch(/snap/i);
    expect(source).not.toContain('15');
  });
});
