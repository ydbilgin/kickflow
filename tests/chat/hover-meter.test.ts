import { describe, expect, it } from 'vitest';
import {
  HOVER_METER_BACKLOG_CAP,
  HOVER_RELEASE_INTERVAL_MS,
  HoverReleaseMeter,
  measureHoverMeter,
} from '../../src/content/chat/hover-meter';

describe('measureHoverMeter', () => {
  it('admits the first row immediately after an idle gap', () => {
    expect(measureHoverMeter(1, true, 1_000, 750)).toEqual({
      admittedRows: 1,
      releaseAll: false,
      nextReleaseAt: 1_000 + HOVER_RELEASE_INTERVAL_MS,
      delayMs: 0,
    });
  });

  it('reports the remaining delay without owning a timer', () => {
    expect(measureHoverMeter(10, true, 1_100, 1_250)).toEqual({
      admittedRows: 0,
      releaseAll: false,
      nextReleaseAt: 1_250,
      delayMs: 150,
    });
  });
});

describe('HoverReleaseMeter', () => {
  it('admits a burst one row per 250 ms while metered', () => {
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);

    expect(meter.release(10, 0)).toEqual({ maxRows: 1, releaseAll: false });
    expect(meter.release(9, HOVER_RELEASE_INTERVAL_MS - 1)).toEqual({ maxRows: 0, releaseAll: false });
    expect(meter.release(9, HOVER_RELEASE_INTERVAL_MS)).toEqual({ maxRows: 1, releaseAll: false });
    expect(meter.release(8, HOVER_RELEASE_INTERVAL_MS * 2)).toEqual({ maxRows: 1, releaseAll: false });
  });

  it('releases the full backlog when unmetered after pointer leave or scroll pause', () => {
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);
    meter.release(1, 0);
    meter.setMetered(false);

    expect(meter.release(9, 1)).toEqual({ maxRows: 9, releaseAll: true });
    expect(meter.timeUntilNextRelease(9, 1)).toBeNull();
  });

  it('drains an over-cap backlog without dropping it, then resumes metering', () => {
    const meter = new HoverReleaseMeter();
    meter.setMetered(true);

    expect(meter.release(HOVER_METER_BACKLOG_CAP + 1, 0)).toEqual({
      maxRows: HOVER_METER_BACKLOG_CAP + 1,
      releaseAll: true,
    });
    expect(meter.timeUntilNextRelease(1, 0)).toBe(HOVER_RELEASE_INTERVAL_MS);
    expect(meter.release(1, HOVER_RELEASE_INTERVAL_MS)).toEqual({ maxRows: 1, releaseAll: false });
  });

  it('is unmetered when the list is not pinned', () => {
    const meter = new HoverReleaseMeter();
    meter.setMetered(false);

    expect(meter.release(4, 5_000)).toEqual({ maxRows: 4, releaseAll: true });
  });
});
