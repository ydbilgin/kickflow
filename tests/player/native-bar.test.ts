import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountIntoControlBar, shareNativeBarMountManager } from '../../src/content/player/native-bar';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import * as selectors from '../../src/content/shared/selectors';

function setupPlayerBar(liveLabel = 'LIVE'): HTMLElement {
  document.body.replaceChildren();
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = liveLabel;
  bar.append(live);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return bar;
}

function setupReplacementPlayerBar(): HTMLElement {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  bar.append(live);
  wrapper.append(video, bar);
  return wrapper;
}

async function flushMountDebounce(): Promise<void> {
  await Promise.resolve();
  vi.advanceTimersByTime(150);
  await Promise.resolve();
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('native-bar mounting', () => {
  it('mounts controls when the native anchor is the Turkish behind-live label', () => {
    const bar = setupPlayerBar('Canlı Yayına Geç');
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);

    try {
      expect(mounted).not.toBeNull();
      expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    } finally {
      lifecycle.dispose();
    }
  });

  it('mounts only once and removes the injected control on lifecycle disposal', () => {
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const first = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const second = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);

    expect(first).toBe(second);
    expect(build).toHaveBeenCalledTimes(1);
    expect(bar.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);

    lifecycle.dispose();

    expect(document.getElementById('kickflow-test-controls')).toBeNull();
  });

  it('re-injects the control after the native bar drops it', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    mounted?.remove();
    await flushMountDebounce();

    expect(build).toHaveBeenCalledTimes(1);
    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);

    lifecycle.dispose();
  });

  it('remounts after rewind changes the native label to Turkish go-to-live text', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const nativeLiveButton = bar.querySelector('button') as HTMLButtonElement;

    nativeLiveButton.textContent = 'Canlı Yayına Geç';
    mounted?.remove();
    await flushMountDebounce();

    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('rebinds to a replacement player wrapper and mounts its control there', async () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const replacement = setupReplacementPlayerBar();
    document.body.firstElementChild?.replaceWith(replacement);
    await flushMountDebounce();

    expect(build).toHaveBeenCalledTimes(1);
    expect(replacement.querySelector('#kickflow-test-controls')).toBe(mounted);

    lifecycle.dispose();
  });

  it('remounts immediately during a mutation storm instead of waiting for debounce silence', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const wrapper = bar.parentElement as HTMLElement;
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    mounted?.remove();

    for (let index = 0; index < 10; index++) {
      wrapper.append(document.createElement('i'));
      await flushMutations();
      vi.advanceTimersByTime(100);
    }

    expect(document.getElementById('kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('retries a missed LIVE anchor without depending on another DOM mutation', () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const liveButton = vi.spyOn(selectors, 'findLiveButton').mockReturnValue(null);

    expect(mountIntoControlBar(lifecycle, 'kickflow-test-controls', build)).toBeNull();
    liveButton.mockRestore();

    vi.advanceTimersByTime(250);

    expect(document.getElementById('kickflow-test-controls')).not.toBeNull();
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('does not remount from a pending retry after lifecycle teardown', () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const liveButton = vi.spyOn(selectors, 'findLiveButton').mockReturnValue(null);

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    lifecycle.dispose();
    liveButton.mockRestore();
    vi.advanceTimersByTime(5000);

    expect(build).not.toHaveBeenCalled();
    expect(document.getElementById('kickflow-test-controls')).toBeNull();
  });

  it('keeps one cached group when the video element swaps inside its wrapper', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const wrapper = bar.parentElement as HTMLElement;
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const replacementVideo = document.createElement('video');
    replacementVideo.id = 'video-player';

    wrapper.querySelector('#video-player')?.replaceWith(replacementVideo);
    await flushMountDebounce();

    expect(bar.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);
    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('does not inherit stale controls during a rapid lifecycle handoff', async () => {
    const bar = setupPlayerBar();
    const firstLifecycle = new Lifecycle();
    const secondLifecycle = new Lifecycle();
    const staleBuild = vi.fn(() => document.createElement('span'));
    const freshBuild = vi.fn(() => document.createElement('span'));
    const stale = mountIntoControlBar(firstLifecycle, 'kickflow-test-controls', staleBuild);

    expect(mountIntoControlBar(secondLifecycle, 'kickflow-test-controls', freshBuild)).toBeNull();

    firstLifecycle.dispose();
    await flushMutations();

    expect(bar.querySelector('#kickflow-test-controls')).not.toBe(stale);
    expect(freshBuild).toHaveBeenCalledTimes(1);
    secondLifecycle.dispose();
  });

  it('reuses cached groups and shares one observer set across all registrations', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const ids = [
      'kickflow-rewind-controls',
      'kickflow-catchup-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
    ];
    const builds = ids.map((id) => vi.fn(() => {
      const group = document.createElement('span');
      group.textContent = id;
      return group;
    }));

    const mounted = ids.map((id, index) => mountIntoControlBar(lifecycle, id, builds[index]));

    // One manager owns three shared observers: wrapper (children), doc rebind, and the
    // theatre-attribute watch — set up once, not per registration.
    expect(observe).toHaveBeenCalledTimes(3);
    expect(Array.from(bar.children).map((child) => child.id || child.textContent)).toEqual([
      'LIVE',
      ...ids,
    ]);

    mounted.forEach((group) => group?.remove());
    await flushMutations();

    expect(ids.map((id) => document.getElementById(id))).toEqual(mounted);
    expect(builds.map((build) => build.mock.calls)).toEqual([[[]], [[]], [[]], [[]]]);

    lifecycle.dispose();

    expect(ids.map((id) => document.getElementById(id))).toEqual([null, null, null, null]);
  });

  it('shares ordered mounting across disposable feature lifecycles and removes only the disabled feature', () => {
    const bar = setupPlayerBar();
    const session = new Lifecycle();
    const rewind = new Lifecycle();
    const screenshot = new Lifecycle();
    shareNativeBarMountManager(rewind, session);
    shareNativeBarMountManager(screenshot, session);

    mountIntoControlBar(screenshot, 'kickflow-screenshot-controls', () => document.createElement('span'));
    mountIntoControlBar(rewind, 'kickflow-rewind-controls', () => document.createElement('span'));
    expect(Array.from(bar.children).map((child) => child.id || child.textContent)).toEqual([
      'LIVE',
      'kickflow-rewind-controls',
      'kickflow-screenshot-controls',
    ]);

    rewind.dispose();
    expect(document.getElementById('kickflow-rewind-controls')).toBeNull();
    expect(document.getElementById('kickflow-screenshot-controls')).not.toBeNull();
    session.dispose();
  });
});
