import { describe, expect, it } from 'vitest';
import { clampSeekTarget, liveEdge, seekFloor } from '../../src/content/player/rewind-controls';
import { fakeVideo } from '../helpers/timeRanges';

const SENTINEL = 2 ** 30;

describe('rewind-controls media boundaries', () => {
  it('uses the last sane buffered end as the live edge', () => {
    expect(liveEdge(fakeVideo({ buffered: [[6, 44]] }))).toBe(44);
    expect(liveEdge(fakeVideo({ buffered: [[6, 44], [45, SENTINEL]] }))).toBe(44);
    expect(liveEdge(fakeVideo({ buffered: [] }))).toBeNull();
    expect(liveEdge(fakeVideo({ buffered: [[6, SENTINEL]] }))).toBeNull();
    expect(liveEdge(fakeVideo({ buffered: [[6, Infinity]] }))).toBeNull();
  });

  it('prefers buffered start over bogus seekable zero sentinel for seek floor', () => {
    const video = fakeVideo({
      buffered: [[6, 44]],
      seekable: [[0, SENTINEL]],
    });

    expect(seekFloor(video)).toBe(6);
    expect(seekFloor(fakeVideo({ buffered: [[0, SENTINEL], [20, 44]], seekable: [[0, SENTINEL]] }))).toBe(20);
  });

  it('falls back to seekable start and then zero for seek floor', () => {
    expect(seekFloor(fakeVideo({ seekable: [[12, 44]] }))).toBe(12);
    expect(seekFloor(fakeVideo())).toBe(0);
  });

  it('clamps seek targets to the playable floor and live edge', () => {
    const video = fakeVideo({
      buffered: [[6, 44]],
      seekable: [[0, SENTINEL]],
      currentTime: 10,
    });

    expect(clampSeekTarget(video, -30)).toBe(6);
    expect(clampSeekTarget(video, 100)).toBe(44);
  });

  it('lets a rewind cross past buffered.start into a sane seekable DVR window (real Kick)', () => {
    // Kick's current player (measured 2026-07-10): seekable is the real DVR [0, 2585] and the
    // server re-loads any seekable position even if not buffered. A ⏪10 from a rewound spot must
    // reach into the DVR, not clamp to the small buffered window's start.
    const video = fakeVideo({
      buffered: [[1700, 1736]],
      seekable: [[0, 2585]],
      currentTime: 1703,
    });

    expect(clampSeekTarget(video, -10)).toBe(1693); // crosses past buffered.start (1700)
    expect(clampSeekTarget(video, -3000)).toBe(0); // clamped to the DVR floor
    expect(clampSeekTarget(video, 10_000)).toBe(2585); // clamped to the live edge (seekable.end)
  });

  it('snaps directional seeks out of gaps between buffered ranges', () => {
    expect(clampSeekTarget(fakeVideo({
      buffered: [[0, 10], [20, 30]],
      currentTime: 21,
    }), -10)).toBe(10);

    expect(clampSeekTarget(fakeVideo({
      buffered: [[0, 10], [20, 30]],
      currentTime: 9,
    }), 10)).toBe(20);
  });

  it('keeps a short rewind in the current playable range when an early preload range is stale', () => {
    const video = fakeVideo({
      buffered: [[0, 2], [100, 160]],
      currentTime: 105,
    });

    expect(clampSeekTarget(video, -10)).toBe(100);
  });

  it('keeps a short forward seek in the current playable range across a stale future gap', () => {
    const video = fakeVideo({
      buffered: [[100, 160], [300, 360]],
      currentTime: 155,
    });

    expect(clampSeekTarget(video, 10)).toBe(160);
  });

  it('guards against inverted floor/live-edge bounds', () => {
    const video = fakeVideo({
      buffered: [[10, 8]],
      currentTime: 9,
    });

    expect(clampSeekTarget(video, 0)).toBe(10);
  });
});
