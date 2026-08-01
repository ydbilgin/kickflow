# VOD Chat Elapsed Timestamps — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-26-vod-chat-elapsed-timestamps-design.md`

## 1. Add failing formatter tests

- Create focused tests for `00:00:00`, the captured `07:13:10` fixture, fractional seconds,
  durations over 24 hours, invalid input, and messages before the VOD start.
- Run only the new test file and confirm it fails because the formatter does not exist.

## 2. Implement the pure formatter

- Add a small chat timestamp module.
- Preserve total elapsed hours without `Date`-based 24-hour wrapping.
- Return an empty string for invalid or negative offsets.
- Re-run the focused formatter tests.

## 3. Add failing renderer and replay-handoff tests

- Add a message-view test showing that an injected timestamp is rendered verbatim while the
  default live path still produces local `HH:MM`.
- Add a render-queue test proving its optional timestamp formatter reaches the DOM.
- Extend VOD replay tests so the validated metadata start time accompanies delivered messages.
- Extend the own-VOD bootstrap integration test to render the captured message and assert
  `07:13:10`, not `04:25`.
- Run the focused tests and confirm the new expectations fail before implementation.

## 4. Wire the VOD start time through rendering

- Extend the replay message callback with the validated `startTimeMs`.
- Store it in the VOD session's lifecycle-local bootstrap state before enqueueing messages.
- Add an optional timestamp formatter to `RenderQueue`.
- Let `buildMessageElement` accept injected display text without changing the message model.
- Supply the elapsed formatter only in VOD own-chat sessions.
- Leave live and native-chat behavior unchanged.

## 5. Automated verification

- Run the focused timestamp, message-view, render-queue, replay, and bootstrap tests.
- Run `npm run typecheck`.
- Run the complete `npm test` suite.
- Run `npm run build`.
- Run whitespace and staged secret checks.

## 6. Live browser verification

- Reload the unpacked extension on the captured Hype VOD.
- Seek to `07:13:10`.
- Record native Kick's timestamp for `omercanturk: yardımcı fulle`.
- Switch to KickFlow own chat and verify the same row also shows `07:13:10`.
- Verify `04:25` is no longer used for that replay row.

## 7. Ship and handoff

- Commit the implementation and regression tests.
- Update ignored local `STATUS.md` with the root cause, live proof, test totals, and commit
  hashes.
- Confirm the tracked worktree is clean.
