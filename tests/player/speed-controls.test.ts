import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSpeedControls } from '../../src/content/player/speed-controls';
import { setAutoMode, setManualRate } from '../../src/content/player/player-state';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function setupPlayerBar(): void {
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
}

afterEach(() => {
  vi.useRealTimers();
  setAutoMode();
  document.body.replaceChildren();
});

describe('speed controls native-bar remounting', () => {
  it('keeps the speed button reference connected and updating after a native-bar remount', async () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    await Promise.resolve();

    setManualRate(1.5);
    const originalButton = document.querySelector<HTMLButtonElement>('#kickflow-speed-controls button');
    const group = document.getElementById('kickflow-speed-controls') as HTMLElement;
    expect(originalButton?.textContent).toBe('1.5x ▾');

    group.remove();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('kickflow-speed-controls')).toBe(group);
    expect(document.querySelector('#kickflow-speed-controls button')).toBe(originalButton);

    setManualRate(2);
    expect(originalButton?.textContent).toBe('2x ▾');

    lifecycle.dispose();
  });
});
