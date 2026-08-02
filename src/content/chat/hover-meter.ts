export const HOVER_RELEASE_INTERVAL_MS = 250; // Kick's bundle sets nextReleaseAt to Date.now() + 250.
export const HOVER_METER_BACKLOG_CAP = 200; // 200 rows is 50 seconds of metered backlog and bounds queued memory without dropping rows.

const INITIAL_NEXT_RELEASE_AT_MS = 0;
const NO_ROWS_RELEASED = 0;
const ONE_ROW_RELEASED = 1;
const NO_DELAY_MS = 0;

export interface HoverMeterResult {
  readonly admittedRows: number;
  readonly releaseAll: boolean;
  readonly nextReleaseAt: number;
  readonly delayMs: number | null;
}

/** Pure release calculation. It has no DOM, timer, or wall-clock dependency; the caller supplies
 * the current time and carries the returned next-release state. */
export function measureHoverMeter(
  pendingRows: number,
  metered: boolean,
  nowMs: number,
  nextReleaseAt: number,
): HoverMeterResult {
  if (pendingRows <= 0) {
    return {
      admittedRows: NO_ROWS_RELEASED,
      releaseAll: false,
      nextReleaseAt,
      delayMs: null,
    };
  }

  if (!metered) {
    return {
      admittedRows: pendingRows,
      releaseAll: true,
      nextReleaseAt,
      delayMs: null,
    };
  }

  if (pendingRows > HOVER_METER_BACKLOG_CAP) {
    return {
      admittedRows: pendingRows,
      releaseAll: true,
      nextReleaseAt: nowMs + HOVER_RELEASE_INTERVAL_MS,
      delayMs: NO_DELAY_MS,
    };
  }

  const delayMs = Math.max(NO_DELAY_MS, nextReleaseAt - nowMs);
  if (delayMs > NO_DELAY_MS) {
    return {
      admittedRows: NO_ROWS_RELEASED,
      releaseAll: false,
      nextReleaseAt,
      delayMs,
    };
  }

  return {
    admittedRows: ONE_ROW_RELEASED,
    releaseAll: false,
    nextReleaseAt: nowMs + HOVER_RELEASE_INTERVAL_MS,
    delayMs: NO_DELAY_MS,
  };
}

export interface RenderReleaseDecision {
  readonly maxRows: number;
  readonly releaseAll: boolean;
}

export interface RenderReleasePolicy {
  release(pendingRows: number, nowMs: number): RenderReleaseDecision;
  timeUntilNextRelease(pendingRows: number, nowMs: number): number | null;
}

/** Adapts the pure meter to the RenderQueue policy boundary. The queue owns all timers; this
 * object only owns the hover interval state and performs scalar calculations. */
export class HoverReleaseMeter implements RenderReleasePolicy {
  private metered = false;
  private nextReleaseAt = INITIAL_NEXT_RELEASE_AT_MS;

  setMetered(metered: boolean): void {
    this.metered = metered;
  }

  release(pendingRows: number, nowMs: number): RenderReleaseDecision {
    const result = measureHoverMeter(pendingRows, this.metered, nowMs, this.nextReleaseAt);
    this.nextReleaseAt = result.nextReleaseAt;
    return { maxRows: result.admittedRows, releaseAll: result.releaseAll };
  }

  timeUntilNextRelease(pendingRows: number, nowMs: number): number | null {
    // The queue arms one timer for this remaining delay; it does not reproduce Kick's 80 ms poll.
    return measureHoverMeter(pendingRows, this.metered, nowMs, this.nextReleaseAt).delayMs;
  }
}

/** Keeps existing RenderQueue callers, including VOD replay, on their original unmetered path. */
export const UNMETERED_RELEASE_POLICY: RenderReleasePolicy = {
  release(pendingRows): RenderReleaseDecision {
    return { maxRows: pendingRows, releaseAll: true };
  },
  timeUntilNextRelease(): number | null {
    return null;
  },
};
