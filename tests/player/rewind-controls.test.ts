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

  it('rewinds 10s inside the real buffered window when seekable is the Infinity-regime sentinel', () => {
    // Owner badge after F5: duration=Infinity, buffered=[0, 46.6], seekable=[0, 2^30], cur=13.4.
    // Both the inline ⏪10 button and Left-arrow call this shared clamp.
    const video = fakeVideo({
      buffered: [[0, 46.6]],
      seekable: [[0, SENTINEL]],
      currentTime: 13.4,
    });

    const target = clampSeekTarget(video, -10);
    expect(target).toBeCloseTo(3.4, 8);
    expect(target).toBeLessThan(video.currentTime - 9);
    expect(target).toBeGreaterThan(0); // never snap the owner to broadcast start
  });

  it('keeps the finite seekable regime unchanged while crossing past buffered.start into DVR (real Kick)', () => {
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

  it('uses a valid short fresh-join DVR range for the shared ⏪10 and Left-arrow seek', () => {
    // Right after F5 Kick can expose only a 10s seekable DVR window ending at the fresh
    // playhead, while buffered starts at the playhead. It is still a real DVR range: a -10
    // target must enter it so Kick can load the unbuffered position.
    const video = fakeVideo({
      buffered: [[8174.7, 8210.8]],
      seekable: [[8165, 8175]],
      currentTime: 8174.7,
    });

    const target = clampSeekTarget(video, -10);
    expect(target).toBe(8165);
    expect(target).toBeLessThan(video.currentTime - 9);
  });

  it('snaps directional seeks out of gaps between buffered ranges', () => {
    expect(clampSeekTarget(fakeVideo({
      buffered: [[0, 10], [20, 30]],
      seekable: [[0, SENTINEL]],
      currentTime: 21,
    }), -10)).toBe(10);

    expect(clampSeekTarget(fakeVideo({
      buffered: [[0, 10], [20, 30]],
      seekable: [[0, SENTINEL]],
      currentTime: 9,
    }), 10)).toBe(20);
  });

  it('keeps a short rewind in the current playable range when an early preload range is stale', () => {
    const video = fakeVideo({
      buffered: [[0, 2], [100, 160]],
      seekable: [[0, 2]],
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

  it('suppresses a forward catapult (rewind that would snap to the near-live window) in a reload transient', () => {
    // Mid-reload transient: seekable momentarily empty, buffered = only the old near-live window,
    // playhead ~15 min behind it (a deep rewind whose position Kick is still fetching). A ⏪10 here
    // used to return first.start (5900) — a REWIND that jumps ~15 min FORWARD to near-live, which
    // the owner sees as "canlıya alıyor". The displacement invariant no-ops it; the user re-presses
    // once the picture resumes.
    const video = fakeVideo({
      buffered: [[5900, 5960]],
      seekable: [],
      currentTime: 5000,
    });

    expect(clampSeekTarget(video, -10)).toBe(5000); // stays put (was 5900 before the guard)
  });

  it('suppresses a backward catapult to broadcast start when the playhead sits in a reload gap', () => {
    // Eviction/reload nudged the playhead just below the live window, into the gap next to a stale
    // preload range near zero, while seekable is the Infinity-regime sentinel. currentRange is
    // undefined (playhead in the gap), so the round-11 guard doesn't apply and the clamp used to
    // return previous.end (2) = stream start. The invariant no-ops that teleport.
    const video = fakeVideo({
      buffered: [[0, 2], [5900, 5960]],
      seekable: [[0, SENTINEL]],
      currentTime: 5898.5,
    });

    expect(clampSeekTarget(video, -10)).toBe(5898.5); // stays put (was 2 before the guard)
  });

  it('still allows the legitimate deep-DVR rewind (invariant does not touch the seekable branch)', () => {
    // Regression pin: with a sane finite seekable DVR the owner-requested cross-past-buffered.start
    // rewind must keep working — its displacement is bounded by the seekable range so the guard is a
    // no-op here. (Same fixture as the finite-regime test above, asserted against the new guard.)
    const video = fakeVideo({
      buffered: [[1700, 1736]],
      seekable: [[0, 2585]],
      currentTime: 1703,
    });

    expect(clampSeekTarget(video, -3000)).toBe(0); // deep rewind to DVR floor, NOT suppressed
    expect(clampSeekTarget(video, -10)).toBe(1693); // normal step still crosses past buffered.start
  });

  it('never lets a rewind move the playhead forward toward live (direction invariant)', () => {
    // Playhead momentarily below a near-live buffered window (a reload transient). computeSeekTarget
    // floors a below-buffer rewind at first.start (150) — a FORWARD jump on a rewind, exactly the
    // owner's "geri sardığımda canlıya atlıyor". The direction guard no-ops it back to currentTime.
    const at130 = fakeVideo({ buffered: [[150, 160]], seekable: [[0, SENTINEL]], currentTime: 130 });
    expect(clampSeekTarget(at130, -10)).toBe(130); // never jumps forward to 150

    const at125 = fakeVideo({ buffered: [[150, 160]], seekable: [[0, SENTINEL]], currentTime: 125 });
    expect(clampSeekTarget(at125, -10)).toBe(125); // stays put, never jumps forward
  });

  it('never lets a forward-seek move the playhead backward (direction invariant, forward blip)', () => {
    // Playhead marginally past buffered.end; a +10 would have returned last.end (45), a tiny
    // BACKWARD jump on a forward press. The direction guard no-ops it.
    const video = fakeVideo({ buffered: [[35, 45]], seekable: [[0, SENTINEL]], currentTime: 45.3 });
    expect(clampSeekTarget(video, 10)).toBeCloseTo(45.3, 8);
  });
});
