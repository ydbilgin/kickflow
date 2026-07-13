import { afterEach, describe, expect, it, vi } from 'vitest';
import { initQualityLock } from '../../src/content/player/quality-lock';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function setupPlayer(): HTMLButtonElement {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  const gear = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M25.7-test-gear');
  svg.append(path);
  gear.append(svg);
  bar.append(live, gear);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return gear;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('quality-lock lifecycle', () => {
  it('does not select a quality after its channel lifecycle is disposed mid-menu wait', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('chrome', {
      runtime: { id: 'kickflow-test' },
      storage: { local: { get: vi.fn(async () => ({ 'kickflow.qualityPreference': 'highest' })), set: vi.fn() } },
    });
    const gear = setupPlayer();
    const quality = document.createElement('button');
    quality.setAttribute('role', 'menuitemradio');
    quality.textContent = '1080p60';
    const selected = vi.fn();
    quality.addEventListener('click', selected);
    gear.addEventListener('click', () => document.body.append(quality));
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(1800 + 60);
    expect(quality.isConnected).toBe(true);
    lifecycle.dispose();
    await vi.advanceTimersByTimeAsync(260);

    expect(selected).not.toHaveBeenCalled();
  });
});
