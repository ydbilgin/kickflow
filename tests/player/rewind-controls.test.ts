import { describe, expect, it } from 'vitest';
import { clampSeekTarget, liveEdge, seekFloor } from '../../src/content/player/rewind-controls';
import { fakeVideo } from '../helpers/timeRanges';

const SENTINEL = 2 ** 30;

describe('rewind-controls media boundaries', () => {
  it('uses the last sane buffered end as the live edge', () => {
    expect(liveEdge(fakeVideo({ buffered: [[6, 44]] }))).toBe(44);
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

  it('guards against inverted floor/live-edge bounds', () => {
    const video = fakeVideo({
      buffered: [[10, 8]],
      currentTime: 9,
    });

    expect(clampSeekTarget(video, 0)).toBe(10);
  });
});
