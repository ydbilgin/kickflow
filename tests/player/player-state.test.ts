import { afterEach, describe, expect, it, vi } from 'vitest';

async function importPlayerState() {
  vi.resetModules();
  return import('../../src/content/player/player-state');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('player-state', () => {
  it('persists and emits mode changes through the central state API', async () => {
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' }, storage: { local: { set } } });
    const playerState = await importPlayerState();
    const changes: Array<{ mode: string; previous: string }> = [];

    const unsubscribe = playerState.subscribePlayerState((state, previous) => {
      changes.push({ mode: state.mode, previous: previous.mode });
    });

    playerState.setManualRate(2);
    playerState.setAutoMode();
    unsubscribe();

    expect(playerState.getPlayerState()).toEqual({ mode: 'auto', manualRate: 2 });
    expect(changes).toEqual([
      { mode: 'manual', previous: 'auto' },
      { mode: 'auto', previous: 'manual' },
    ]);
    expect(set).toHaveBeenCalledWith({ 'kickflow.catchupEnabled': false });
    expect(set).toHaveBeenCalledWith({ 'kickflow.catchupEnabled': true });
  });

  it('applies playback rate defensively with pitch preservation enabled', async () => {
    const { setPlayerPlaybackRate } = await importPlayerState();
    const video = {
      playbackRate: 1,
      preservesPitch: false,
      webkitPreservesPitch: false,
    } as HTMLVideoElement & { webkitPreservesPitch: boolean };

    setPlayerPlaybackRate(video, 2.5);

    expect(video.playbackRate).toBe(2.5);
    expect(video.preservesPitch).toBe(true);
    expect(video.webkitPreservesPitch).toBe(true);

    setPlayerPlaybackRate(video, Number.NaN);

    expect(video.playbackRate).toBe(1);
  });
});
