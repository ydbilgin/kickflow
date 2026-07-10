import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideCatchup, initLiveCatchup, isLiveStream, type CatchupAction } from '../../src/content/player/live-catchup';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
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
  /** Live edge = seekable.end (measured on Kick's current player 2026-07-10). `liveEdge` sets the
   * seekable window [0, liveEdge]; duration:Infinity latches detectLive via the fast path. */
  function mountLivePlayer(
    currentTime: number,
    liveEdge = 20,
    opts: { duration?: number; liveButtonText?: string } = {},
  ): { video: HTMLVideoElement; lifecycle: Lifecycle; bar: HTMLElement } {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      duration: { configurable: true, value: opts.duration ?? Infinity },
      currentTime: { configurable: true, value: currentTime, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[0, liveEdge]]) },
      seekable: { configurable: true, value: fakeTimeRanges([[0, liveEdge]]), writable: true },
      playbackRate: { configurable: true, value: 1, writable: true },
      paused: { configurable: true, value: false },
    });
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const live = document.createElement('button');
    live.textContent = opts.liveButtonText ?? 'LIVE';
    bar.append(live);
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const lifecycle = new Lifecycle();
    initLiveCatchup(lifecycle);
    return { video, lifecycle, bar };
  }

  function setSeekable(video: HTMLVideoElement, start: number, end: number): void {
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: fakeTimeRanges([[start, end]]),
    });
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

  it('turns amber with a -Xsn suffix in place when behind (seekable.end), and back at the edge', () => {
    const { video, lifecycle } = mountLivePlayer(19.5, 20);
    video.dispatchEvent(new Event('timeupdate'));
    video.currentTime = 0;
    video.dispatchEvent(new Event('timeupdate'));

    const button = findCanliButton();
    expect(button.textContent).toBe('CANLI -20sn');
    expect(button.classList.contains('kickflow-player-btn--behind')).toBe(true);
    expect(video.playbackRate).toBe(1.5); // auto catch-up engages alongside the label

    video.currentTime = 19.5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(button.textContent).toBe('CANLI');
    expect(button.classList.contains('kickflow-player-btn--behind')).toBe(false);
    expect(video.playbackRate).toBe(1);
    lifecycle.dispose();
  });

  it('computes behind from seekable.end, NOT the buffered trail (the real Kick bug)', () => {
    const { video, lifecycle } = mountLivePlayer(84, 100);
    // Kick trails the buffer ~1.5s behind the playhead even when 16s behind live; seekable.end
    // is the true live edge. behind must come from seekable.end (100), not buffered.end (85.5).
    Object.defineProperty(video, 'buffered', { configurable: true, value: fakeTimeRanges([[0, 85.5]]) });
    setSeekable(video, 0, 100);
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().textContent).toBe('CANLI -16sn');
    lifecycle.dispose();
  });

  it('keeps catching up after the control bar hides (live latch is bar-independent)', () => {
    // Real Kick reports FINITE duration, so live is confirmed via the native go-to-live button.
    // When the mouse leaves the player Kick removes that button — the latch must keep us "live".
    const { video, bar, lifecycle } = mountLivePlayer(1700, 2585, {
      duration: 2585,
      liveButtonText: 'Canlı Yayına Geç',
    });
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().classList.contains('kickflow-player-btn--behind')).toBe(true);

    // Bar auto-hides: Kick's native live button disappears. detectLive must stay latched.
    bar.querySelector('button')?.remove();
    video.currentTime = 1750;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().textContent).toBe('CANLI -14dk');
    lifecycle.dispose();
  });

  it('latches live via growing seekable.end even with no live button and finite duration', () => {
    const { video, bar, lifecycle } = mountLivePlayer(90, 100, { duration: 3600 });
    bar.querySelector('button')?.remove(); // no live control at all
    setSeekable(video, 0, 100);
    video.dispatchEvent(new Event('timeupdate'));
    // Not yet latched (first sample); no catch-up.
    expect(video.playbackRate).toBe(1);

    setSeekable(video, 0, 101); // seekable.end grew -> live confirmed
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);
    lifecycle.dispose();
  });

  it('resets the live latch when Kick swaps the video element', async () => {
    const { video, lifecycle } = mountLivePlayer(0, 20);
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);

    const replacement = document.createElement('video');
    replacement.id = 'video-player';
    Object.defineProperties(replacement, {
      duration: { configurable: true, value: Infinity },
      currentTime: { configurable: true, value: 29, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[0, 30]]) },
      seekable: { configurable: true, value: fakeTimeRanges([[0, 30]]) },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    video.replaceWith(replacement);
    await Promise.resolve();
    await Promise.resolve();
    replacement.dispatchEvent(new Event('timeupdate'));

    try {
      expect(replacement.playbackRate).toBe(1);
      expect(findCanliButton().textContent).toBe('CANLI');

      replacement.currentTime = 0;
      replacement.dispatchEvent(new Event('timeupdate'));
      expect(replacement.playbackRate).toBe(1.5);
      expect(findCanliButton().textContent).toBe('CANLI -30sn');
    } finally {
      lifecycle.dispose();
    }
  });

  it('clears the live latch when the same video element starts a new media load', () => {
    const { video, lifecycle } = mountLivePlayer(0, 20);
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);

    // New media on the same element: loadstart resets catch-up + latch; a fresh at-edge frame is 1x.
    video.currentTime = 19.5;
    setSeekable(video, 0, 20);
    video.dispatchEvent(new Event('loadstart'));
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1);
    expect(findCanliButton().textContent).toBe('CANLI');
    lifecycle.dispose();
  });

  it('switches the behind label to minutes past 99s so it cannot overflow the fixed width', () => {
    const { video, lifecycle } = mountLivePlayer(0, 300);
    video.dispatchEvent(new Event('timeupdate'));
    expect(findCanliButton().textContent).toBe('CANLI -5dk');
    lifecycle.dispose();
  });

  it('clicking the button seeks to the seekable live edge', () => {
    const { video, lifecycle } = mountLivePlayer(0, 20);
    video.dispatchEvent(new Event('timeupdate'));

    findCanliButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(20);
    lifecycle.dispose();
  });

  it('clicking CANLI seeks to seekable.end (true live), not the trailing buffered edge', () => {
    const { video, lifecycle } = mountLivePlayer(84, 100);
    Object.defineProperty(video, 'buffered', { configurable: true, value: fakeTimeRanges([[0, 85.5]]) });
    setSeekable(video, 0, 100);
    video.dispatchEvent(new Event('timeupdate'));

    findCanliButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(100);
    lifecycle.dispose();
  });

  it('keeps the connected CANLI button stateful after the native bar drops its group', async () => {
    vi.useFakeTimers();
    const { video, lifecycle } = mountLivePlayer(19.5, 20);
    video.dispatchEvent(new Event('timeupdate'));

    const originalButton = findCanliButton();
    const group = document.getElementById('kickflow-catchup-controls') as HTMLElement;
    group.remove();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('kickflow-catchup-controls')).toBe(group);
    expect(findCanliButton()).toBe(originalButton);

    video.currentTime = 5;
    video.dispatchEvent(new Event('timeupdate'));

    expect(originalButton.textContent).toBe('CANLI -15sn');
    lifecycle.dispose();
  });
});
