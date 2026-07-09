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

describe('merged CANLI button (go-live + behind-live indicator in one)', () => {
  function mountLivePlayer(currentTime: number): { video: HTMLVideoElement; lifecycle: Lifecycle } {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      duration: { configurable: true, value: Infinity },
      currentTime: { configurable: true, value: currentTime, writable: true },
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
    return { video, lifecycle };
  }

  function findCanliButton(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      '#kickflow-catchup-controls .kickflow-player-btn--live',
    );
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  it('mounts a single CANLI button with no separate indicator or OTO toggle', () => {
    const { lifecycle } = mountLivePlayer(19.5);
    const group = document.getElementById('kickflow-catchup-controls');
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll('button')).toHaveLength(1);
    expect(document.querySelector('.kickflow-catchup-indicator')).toBeNull();
    expect(document.querySelector('.kickflow-player-toggle')).toBeNull();
    expect(findCanliButton().textContent).toBe('CANLI');
    lifecycle.dispose();
  });

  it('turns amber with a -Xsn suffix in place when behind, and back at the edge', () => {
    const { video, lifecycle } = mountLivePlayer(0);
    video.dispatchEvent(new Event('timeupdate'));

    const button = findCanliButton();
    expect(button.textContent).toBe('CANLI -20sn');
    expect(button.classList.contains('kickflow-player-btn--behind')).toBe(true);
    expect(video.playbackRate).toBe(1.5); // auto catch-up still engages alongside the label

    video.currentTime = 19.5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(button.textContent).toBe('CANLI');
    expect(button.classList.contains('kickflow-player-btn--behind')).toBe(false);
    expect(video.playbackRate).toBe(1);
    lifecycle.dispose();
  });

  it('switches the behind label to minutes past 99s so it cannot overflow the fixed width', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      duration: { configurable: true, value: Infinity },
      currentTime: { configurable: true, value: 0, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[0, 300]]) },
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

    expect(findCanliButton().textContent).toBe('CANLI -5dk');
    lifecycle.dispose();
  });

  it('clicking the button seeks to the buffered live edge', () => {
    const { video, lifecycle } = mountLivePlayer(0);
    video.dispatchEvent(new Event('timeupdate'));

    findCanliButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(20);
    lifecycle.dispose();
  });
});
