import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catchupLiveEdge, decideCatchup, initLiveCatchup, isLiveStream, type CatchupAction } from '../../src/content/player/live-catchup';
import { setAutoMode, setManualRate } from '../../src/content/player/player-state';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';
import { setLang } from '../../src/content/shared/i18n';

beforeEach(() => setLang('tr'));

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
    const vodButton = document.createElement('button');
    vodButton.textContent = 'Quality';
    bar.append(vodButton);
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

  it('uses buffered.end in the Infinity/sentinel regime so a rewound live player shows behind and catches up', () => {
    // Owner badge after F5: duration=Infinity, seekable.end=2^30 sentinel, but the playable
    // buffered window is [0, 46.6] and the current time is 13.4.
    const { video, lifecycle } = mountLivePlayer(13.4, 46.6);
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: fakeTimeRanges([[0, 2 ** 30]]),
    });

    expect(catchupLiveEdge(video)).toBe(46.6);
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().textContent).toBe('CANLI -33sn');
    lifecycle.dispose();
  });

  it('leaves the finite seekable/duration live-edge path unchanged even if buffered differs', () => {
    const { video, lifecycle } = mountLivePlayer(1703, 1704, {
      duration: 2585,
      liveButtonText: 'Canlı Yayına Geç',
    });
    Object.defineProperty(video, 'buffered', { configurable: true, value: fakeTimeRanges([[1702, 1704]]) });

    expect(catchupLiveEdge(video)).toBe(2585);
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().textContent).toBe('CANLI -15dk');
    lifecycle.dispose();
  });

  it('uses the finite duration live edge when a DVR rewind collapses seekable near the playhead', () => {
    // Owner reproduction: after a deep rewind Kick can reload the DVR window so seekable.end
    // lands beside currentTime, while duration remains the growing stream position/live edge.
    const { video, lifecycle } = mountLivePlayer(1703, 1704, {
      duration: 2585,
      liveButtonText: 'Canlı Yayına Geç',
    });
    Object.defineProperty(video, 'buffered', { configurable: true, value: fakeTimeRanges([[1702, 1704]]) });
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1.5);
    expect(findCanliButton().textContent).toBe('CANLI -15dk');
    expect(findCanliButton().classList.contains('kickflow-player-btn--behind')).toBe(true);
    findCanliButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(1704); // go-live still targets the seekable DVR endpoint
    lifecycle.dispose();
  });

  it('re-asserts auto catch-up after Kick resets the rate during a DVR seek, then drops only at the edge', () => {
    const { video, lifecycle } = mountLivePlayer(8174.7, 8370.8, {
      duration: 8370.8,
      liveButtonText: 'Canlı Yayına Geç',
    });

    try {
      video.dispatchEvent(new Event('timeupdate'));
      expect(video.playbackRate).toBe(1.5);

      // Owner-observed state: Kick resets the media element during a DVR seek/rebuffer, while
      // our hysteresis state remains catchingUp=true and the live edge is still 196s away.
      video.playbackRate = 1;
      video.dispatchEvent(new Event('timeupdate'));
      expect(video.playbackRate).toBe(1.5);

      // Hysteresis remains unchanged: stay fast until the 1.5s caught-up threshold, then 1x.
      video.currentTime = 8368;
      video.dispatchEvent(new Event('timeupdate'));
      expect(video.playbackRate).toBe(1.5);
      video.currentTime = 8369.4;
      video.dispatchEvent(new Event('timeupdate'));
      expect(video.playbackRate).toBe(1);

      // Manual playback is never overridden while behind.
      video.currentTime = 8174.7;
      video.playbackRate = 2;
      setManualRate(2);
      video.dispatchEvent(new Event('timeupdate'));
      expect(video.playbackRate).toBe(2);
    } finally {
      setManualRate(1);
      setAutoMode();
      lifecycle.dispose();
    }
  });

  it('does not report behind or catch up when duration and seekable agree at the live edge', () => {
    const { video, lifecycle } = mountLivePlayer(2585, 2585, {
      duration: 2585,
      liveButtonText: 'Canlı Yayına Geç',
    });
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1);
    expect(findCanliButton().textContent).toBe('CANLI');
    expect(findCanliButton().classList.contains('kickflow-player-btn--behind')).toBe(false);
    lifecycle.dispose();
  });

  it('fails closed for finite VOD even when duration and seekable are far ahead', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2585 },
      currentTime: { configurable: true, value: 1703, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[1702, 1704]]) },
      seekable: { configurable: true, value: fakeTimeRanges([[0, 1704]]) },
      playbackRate: { configurable: true, value: 1, writable: true },
    });
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const vodButton = document.createElement('button');
    vodButton.textContent = 'Quality';
    bar.append(vodButton);
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const lifecycle = new Lifecycle();
    initLiveCatchup(lifecycle);
    video.dispatchEvent(new Event('timeupdate'));

    expect(video.playbackRate).toBe(1);
    expect(document.querySelector('#kickflow-catchup-controls')).toBeNull();
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
