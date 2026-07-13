import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const playerState = vi.hoisted(() => {
  let resolveLoad!: () => void;
  const load = new Promise<void>((resolve) => {
    resolveLoad = resolve;
  });
  return {
    load,
    resolveLoad,
    mode: 'auto' as 'auto' | 'manual',
    setPlayerPlaybackRate: vi.fn(),
  };
});

vi.mock('../../src/content/player/player-state', () => ({
  NORMAL_PLAYBACK_RATE: 1,
  ensurePlayerStateLoaded: () => playerState.load,
  getPlayerState: () => ({ mode: playerState.mode, manualRate: 2 }),
  setAutoMode: vi.fn(),
  setManualRate: vi.fn(),
  setPlayerPlaybackRate: playerState.setPlayerPlaybackRate,
  subscribePlayerState: vi.fn(() => () => undefined),
}));

import { initSpeedControls } from '../../src/content/player/speed-controls';

afterEach(() => {
  document.body.replaceChildren();
});

describe('speed controls lifecycle', () => {
  it('does not apply a delayed stored rate after its SPA session is disposed', async () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    lifecycle.dispose();

    playerState.mode = 'manual';
    playerState.resolveLoad();
    await playerState.load;
    await Promise.resolve();

    expect(playerState.setPlayerPlaybackRate).not.toHaveBeenCalled();
    expect(document.getElementById('kickflow-speed-controls')).toBeNull();
  });
});
