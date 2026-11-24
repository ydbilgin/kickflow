import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_VOLUMES_KEY,
  getLevellerState,
  initChannelVolume,
  initLoudnessLeveller,
  MAX_REMEMBERED_CHANNELS,
  RESTORE_WINDOW_MS,
  USER_INPUT_MS,
  VOLUME_WRITE_MS,
  rememberVolume,
  routableSource,
  sanitizeChannelVolumes,
  setAudioContextFactory,
} from '../../src/content/player/audio-level';
import { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeNode {
  connections: unknown[] = [];
  connect(target: unknown) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; }
}
class FakeParam { value = 0; }

function fakeContext(state: AudioContextState = 'running') {
  const destination = new FakeNode();
  const sources: FakeNode[] = [];
  const context = {
    state,
    destination,
    resume: vi.fn(async () => { context.state = 'running'; }),
    createMediaElementSource: vi.fn(() => { const node = new FakeNode(); sources.push(node); return node; }),
    createDynamicsCompressor: () => Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }),
    createGain: () => Object.assign(new FakeNode(), { gain: new FakeParam() }),
    createAnalyser: () => Object.assign(new FakeNode(), { fftSize: 1024, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.1) }),
  };
  return { context, sources };
}

function mountVideo(src = ''): HTMLVideoElement {
  document.body.innerHTML = `<div id="injected-channel-player"><div><video id="video-player"></video><button id="vol">vol</button></div></div><textarea id="chat"></textarea>`;
  const video = document.getElementById('video-player') as HTMLVideoElement;
  Object.defineProperty(video, 'currentSrc', { configurable: true, value: src });
  return video;
}

afterEach(() => {
  setAudioContextFactory(null);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('loudness leveller', () => {
  it('routes only sources Chrome can hear through Web Audio', () => {
    expect(routableSource({ currentSrc: '', crossOrigin: null }, 'https://kick.com')).toBe(true);
    expect(routableSource({ currentSrc: 'blob:https://kick.com/abc', crossOrigin: null }, 'https://kick.com')).toBe(true);
    expect(routableSource({ currentSrc: 'https://kick.com/a.mp4', crossOrigin: null }, 'https://kick.com')).toBe(true);
    expect(routableSource({ currentSrc: 'https://cdn.example/a.m3u8', crossOrigin: null }, 'https://kick.com')).toBe(false);
    expect(routableSource({ currentSrc: 'https://cdn.example/a.m3u8', crossOrigin: 'anonymous' }, 'https://kick.com')).toBe(true);
  });

  it('puts the compressor between the video and the speakers, and bypasses it when switched off', () => {
    const { context, sources } = fakeContext();
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('blob:https://kick.com/ms');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    expect(getLevellerState()).toBe('on');
    expect(sources).toHaveLength(1);
    const first = sources[0]!.connections[0] as { threshold?: FakeParam };
    expect(first.threshold?.value).toBe(-26);
    lifecycle.dispose();
    expect(sources[0]!.connections[0]).toBe(context.destination);
    expect(getLevellerState()).toBe('off');
  });

  it('a suspended audio context waits for his click instead of muting the stream', async () => {
    const { context, sources } = fakeContext('suspended');
    context.resume.mockImplementationOnce(async () => {});
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('blob:https://kick.com/ms');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    expect(getLevellerState()).toBe('waiting');
    expect(sources).toHaveLength(0);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(getLevellerState()).toBe('on');
    expect(sources).toHaveLength(1);
    lifecycle.dispose();
  });

  it('a cross-origin source without CORS is left alone (unsupported, not silenced)', () => {
    const { context, sources } = fakeContext();
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('https://cdn.example/live.m3u8');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    expect(getLevellerState()).toBe('unsupported');
    expect(sources).toHaveLength(0);
    lifecycle.dispose();
  });

  it('a browser without Web Audio degrades to unsupported', () => {
    setAudioContextFactory(() => { throw new Error('no audio'); });
    mountVideo('blob:https://kick.com/ms');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    expect(getLevellerState()).toBe('unsupported');
    lifecycle.dispose();
  });

  // 0.4.3 (2026-11-24, code review B8, B13).
  it('shows unsupported on the player once, and removes the note when switched off', () => {
    const { context } = fakeContext();
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('https://cdn.example/live.m3u8');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    const notes = document.querySelectorAll('.kickflow-leveller-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toMatch(/leveller|dengeleyici/i);
    lifecycle.dispose();
    expect(document.querySelectorAll('.kickflow-leveller-note')).toHaveLength(0);
  });

  it('an element without a source yet is routed only after it loads', () => {
    const { context, sources } = fakeContext();
    setAudioContextFactory(() => context as unknown as AudioContext);
    const video = mountVideo('');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    expect(sources).toHaveLength(0);
    expect(getLevellerState()).toBe('waiting');
    Object.defineProperty(video, 'currentSrc', { configurable: true, value: 'https://cdn.example/clip.mp4' });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(sources).toHaveLength(0);
    expect(getLevellerState()).toBe('unsupported');
    lifecycle.dispose();
  });

  it('one gesture retry (click or key, not both), one silence watcher, a limiter after the gain', async () => {
    const { context, sources } = fakeContext('suspended');
    context.resume.mockImplementationOnce(async () => {});
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('blob:https://kick.com/ms');
    const intervals = vi.spyOn(window, 'setInterval');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(sources).toHaveLength(1);
    expect(intervals.mock.calls.filter(([, ms]) => ms === 500)).toHaveLength(1);
    const compressor = sources[0]!.connections[0] as FakeNode;
    const gain = compressor.connections[0] as FakeNode;
    const limiter = gain.connections[0] as FakeNode & { ratio?: FakeParam; threshold?: FakeParam };
    expect(limiter.ratio?.value).toBe(20);
    expect(limiter.threshold?.value).toBe(-1);
    lifecycle.dispose();
  });

  it('a context Chrome suspends later is resumed on the next click, also with the switch off', async () => {
    const { context } = fakeContext();
    const listeners: Array<() => void> = [];
    Object.assign(context, { addEventListener: (type: string, fn: () => void) => { if (type === 'statechange') listeners.push(fn); } });
    setAudioContextFactory(() => context as unknown as AudioContext);
    mountVideo('blob:https://kick.com/ms');
    const lifecycle = new Lifecycle();
    initLoudnessLeveller(lifecycle);
    lifecycle.dispose();
    context.state = 'suspended';
    listeners.forEach((fn) => fn());
    expect(context.resume).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});

describe('per-channel volume', () => {
  it('stores rounded values, drops junk and keeps the newest channels', () => {
    let all = sanitizeChannelVolumes({ 'Bad Slug': { v: 1, m: false, at: 1 }, ok: { v: 2, m: false, at: 1 }, x: 'no' });
    expect(all).toEqual({});
    all = rememberVolume(all, 'Jahrein', 0.33333, false, 10);
    expect(all.jahrein).toEqual({ v: 0.333, m: false, at: 10 });
    for (let i = 0; i < MAX_REMEMBERED_CHANNELS + 5; i++) all = rememberVolume(all, `c${i}`, 0.5, false, 100 + i);
    expect(Object.keys(all)).toHaveLength(MAX_REMEMBERED_CHANNELS);
    expect(all.jahrein).toBeUndefined();
  });

  it('sets the remembered volume for this channel and stores only his own change', async () => {
    window.history.replaceState({}, '', '/jahrein');
    const store: Record<string, unknown> = { [CHANNEL_VOLUMES_KEY]: { jahrein: { v: 0.25, m: false, at: 1 } } };
    const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); });
    Object.assign(globalThis, { chrome: { runtime: { id: 'x' }, storage: { local: { get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().map((k) => [k, store[k]]))), set } } } });
    const video = mountVideo('');
    const lifecycle = new Lifecycle();
    initChannelVolume(lifecycle);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(video.volume).toBeCloseTo(0.25, 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Kick's own start-up change (no input from him) is not stored.
    video.volume = 0.9; video.dispatchEvent(new Event('volumechange'));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(set).not.toHaveBeenCalled();
    // A click in the chat does not count as his volume choice either.
    document.getElementById('chat')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    video.volume = 0.8; video.dispatchEvent(new Event('volumechange'));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(set).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0)); // our own set-back of Kick's change is done
    // His drag on the player's volume control is stored for this channel.
    document.getElementById('vol')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    video.volume = 0.6; video.dispatchEvent(new Event('volumechange'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(set).toHaveBeenCalled();
    expect((store[CHANNEL_VOLUMES_KEY] as Record<string, { v: number }>).jahrein.v).toBe(0.6);
    lifecycle.dispose();
    window.history.replaceState({}, '', '/');
  });
});

describe('per-channel volume, 0.4.3 (code review B19)', () => {
  function setup(path = '/jahrein') {
    window.history.replaceState({}, '', path);
    const store: Record<string, unknown> = { [CHANNEL_VOLUMES_KEY]: { jahrein: { v: 0.25, m: false, at: 1 } } };
    const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); });
    Object.assign(globalThis, { chrome: { runtime: { id: 'x' }, storage: { local: { get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().map((k) => [k, store[k]]))), set } } } });
    const video = mountVideo('');
    const lifecycle = new Lifecycle();
    initChannelVolume(lifecycle);
    return { store, set, video, lifecycle };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  it('a click on the player long before Kick changes the volume does not make that change his', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { set, video, lifecycle } = setup();
    await settle();
    document.getElementById('vol')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(USER_INPUT_MS + 10_000);
    video.volume = 0.05; video.dispatchEvent(new Event('volumechange'));
    vi.advanceTimersByTime(1000);
    await settle();
    expect(set).not.toHaveBeenCalled();
    lifecycle.dispose();
    window.history.replaceState({}, '', '/');
  });

  it('a change after the page moved to another channel is not written to the old one; a drag writes once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { set, store, video, lifecycle } = setup();
    await settle();
    vi.advanceTimersByTime(1); // our own start-up write is done
    document.getElementById('vol')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    for (const v of [0.5, 0.55, 0.6, 0.65]) { video.volume = v; video.dispatchEvent(new Event('volumechange')); }
    vi.advanceTimersByTime(VOLUME_WRITE_MS + 1);
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
    expect((store[CHANNEL_VOLUMES_KEY] as Record<string, { v: number }>).jahrein.v).toBe(0.65);
    window.history.replaceState({}, '', '/baskakanal');
    document.getElementById('vol')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    video.volume = 0.9; video.dispatchEvent(new Event('volumechange'));
    vi.advanceTimersByTime(VOLUME_WRITE_MS + 1);
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
    window.history.replaceState({}, '', '/');
  });

  it('Kick\'s late start-up volume is set back within the restore window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { video, lifecycle } = setup();
    await settle();
    vi.advanceTimersByTime(3000);
    video.volume = 1; video.dispatchEvent(new Event('volumechange'));
    expect(video.volume).toBeCloseTo(0.25, 3);
    vi.advanceTimersByTime(RESTORE_WINDOW_MS);
    video.volume = 0.7; video.dispatchEvent(new Event('volumechange'));
    expect(video.volume).toBeCloseTo(0.7, 3);
    lifecycle.dispose();
    window.history.replaceState({}, '', '/');
  });
});
