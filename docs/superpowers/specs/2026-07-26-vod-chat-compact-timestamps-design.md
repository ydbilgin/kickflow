# Native-Style Compact VOD Chat Timestamps — Design

**Date:** 2026-07-26
**Status:** Approved

## Problem

KickFlow now calculates the correct elapsed VOD position, but it always renders three components.
This produces values such as `00:05:05`. Native Kick omits the hour component until the recording
position reaches one hour, rendering the same value as `05:05`.

## Native Evidence

The following values were collected from the native Chat Replay DOM on the captured Hype VOD:

| Elapsed position | Native label |
| ---: | ---: |
| 5 seconds | `00:05` |
| 1 minute 5 seconds | `01:05` |
| 5 minutes 5 seconds | `05:05` |
| 59 minutes 59 seconds | `59:59` |
| 1 hour 5 seconds | `01:00:05` |
| 2 hours 5 seconds | `02:00:05` |
| 7 hours 13 minutes 10 seconds | `07:13:10` |

This establishes one formatting boundary:

- elapsed time below one hour: `MM:SS`;
- elapsed time at or above one hour: `HH:MM:SS`.

## Goals

- Match native Kick's compact VOD timestamp shape.
- Preserve the already-correct absolute-to-elapsed calculation.
- Keep live-chat wall-clock timestamps unchanged.
- Cover the complete second/minute/hour boundary with deterministic tests.

## Non-goals

- Do not change VOD history polling, seek resets, message selection, or lifecycle behavior.
- Do not change native-chat DOM or timestamp visibility settings.
- Do not introduce a new preference.
- Do not alter the source `created_at` value.

## Considered Approaches

### 1. Select the shape from numeric elapsed components — selected

Calculate hours, minutes, and seconds exactly as today. If total hours are zero, return
`MM:SS`; otherwise return `HH:MM:SS`.

This keeps the native rule explicit and leaves validation, flooring, and long-duration handling in
one pure function.

### 2. Remove a leading `00:` from the completed string

Rejected because it turns a semantic duration rule into a string post-processing rule.

### 3. Use a localized duration API

Rejected because browser support and locale-dependent output would make native parity
non-deterministic.

## Detailed Behavior

- `0` seconds → `00:00`
- `5` seconds → `00:05`
- `65` seconds → `01:05`
- `305` seconds → `05:05`
- `3,599` seconds → `59:59`
- `3,600` seconds → `01:00:00`
- `25,990` seconds → `07:13:10`
- elapsed hours remain zero-padded to at least two digits;
- total hours do not wrap at 24;
- fractional milliseconds continue to floor to the containing second;
- invalid timestamps, invalid VOD start times, and pre-start messages continue to return an empty
  label.

The 24-hour-plus display cannot be observed on the 9-hour Hype fixture. Retaining total, non-wrapped
hours is the safe duration behavior and avoids the demonstrably incorrect day-wrap produced by
date-clock formatting.

## Related Logic Audit

The surrounding replay path was checked for the same class of mistake:

- seek clears pending rows and the previous replay window;
- stale in-flight responses are rejected by replay epoch;
- history windows may contain messages a few seconds before the requested position, matching
  native Kick;
- elapsed calculation uses absolute milliseconds, so timezone and daylight-saving changes do not
  affect it;
- same-channel VOD-to-VOD navigation creates a new lifecycle and start time;
- timestamp visibility continues to mirror Kick's `--chatroom-timestamps-display`;
- live sessions retain their existing local `HH:MM` label.

No additional confirmed defect was found in those paths.

## Verification

- Update formatter tests to cover every listed boundary.
- Confirm the old `00:05:05` expectation fails before the formatter change.
- Run the complete TypeScript, Vitest, and production-build gates.
- In a real browser, seek the Hype VOD to approximately `05:05` and verify:
  - native Kick labels the matching replay messages `05:xx`;
  - KickFlow labels the same messages `05:xx`;
  - KickFlow does not show a leading `00:`.
- Recheck the existing `07:13:10` fixture to prove the one-hour-plus form remains unchanged.
