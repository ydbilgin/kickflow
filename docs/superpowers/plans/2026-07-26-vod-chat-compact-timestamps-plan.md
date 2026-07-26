# Native-Style Compact VOD Chat Timestamps — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-26-vod-chat-compact-timestamps-design.md`

## 1. Encode the native boundary as failing tests

- Change the zero/sub-hour expectations from `HH:MM:SS` to `MM:SS`.
- Add exact assertions for `00:05`, `01:05`, `05:05`, `59:59`, and `01:00:00`.
- Keep the existing multi-hour, fractional-second, invalid, and pre-start coverage.
- Run the focused formatter test and confirm the old unconditional-hour implementation fails.

## 2. Implement the numeric shape rule

- Keep the existing validation and elapsed-component calculation.
- Return `MM:SS` when total elapsed hours are zero.
- Return `HH:MM:SS` when total elapsed hours are one or greater.
- Do not modify replay transport, message data, rendering injection, or live timestamp code.

## 3. Automated verification

- Run the focused formatter test.
- Run timestamp-adjacent renderer, render-queue, replay-controller, and bootstrap tests.
- Run TypeScript typecheck, the complete Vitest suite, and the production build.
- Run whitespace and staged secret checks.

## 4. Live native-parity verification

- Reload the unpacked build on the captured Hype VOD.
- At approximately five minutes, compare native and KickFlow timestamp shapes and confirm both use
  `05:xx` with no leading `00:`.
- Recheck `07:13:10` to prove the one-hour-plus form did not regress.

## 5. Ship

- Commit the formatter and regression-test update.
- Add the evidence, test totals, and commit hashes to ignored local `CURRENT_STATUS.md`.
- Confirm the tracked worktree is clean.
