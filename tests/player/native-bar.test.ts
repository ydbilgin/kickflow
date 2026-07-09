import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountIntoControlBar } from '../../src/content/player/native-bar';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function setupPlayerBar(): HTMLElement {
  document.body.innerHTML = '';
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
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

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('native-bar mounting', () => {
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

    expect(build).toHaveBeenCalledTimes(2);
    expect(bar.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);

    lifecycle.dispose();
  });

  it('rebinds to a replacement player wrapper and mounts its control there', async () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const replacement = setupReplacementPlayerBar();
    document.body.firstElementChild?.replaceWith(replacement);
    await flushMountDebounce();

    expect(build).toHaveBeenCalledTimes(2);
    expect(replacement.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);

    lifecycle.dispose();
  });
});
