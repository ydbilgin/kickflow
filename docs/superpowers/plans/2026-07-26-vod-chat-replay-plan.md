# KickFlow — VOD Chat Replay Implementation Plan

Date: 2026-07-26

## 1. Lock the route contract with tests

- Add pure route-context parsing coverage for live routes, video listings, VOD routes, malformed
  VOD routes, and reserved top-level paths.
- Replace navigation's slug-only equality with full session-key equality.
- Preserve `currentSlug` for status and settings restarts.

## 2. Add timestamp-aware history and metadata tests

- Extend history tests to assert URL behavior with and without `start_time`.
- Add fixtures for valid video metadata, missing VOD id, invalid `start_time`, malformed body, and
  HTTP failure.
- Implement the metadata resolver only after the new tests fail.

## 3. Build the replay controller test-first

- Use fake video elements, fake timers, and injected fetch functions.
- Cover initial load, five-second buckets, pause, resume, seek while paused, stale-response
  suppression, empty results, and failure.
- Reuse the shared video-element observer so player replacement is handled consistently.

## 4. Integrate with own chat

- Split the current own-chat transport setup into live and VOD branches after channel resolution.
- Add render-queue pending clear and replay reset cleanup.
- Add replay readiness to the overlay without changing live readiness.
- Prove through an integration test that a VOD session does not create a live Pusher client.

## 5. Guard native mode

- Skip the background live Pusher client in native mode when the context is VOD.
- Keep native Kick replay visible and retain the settings/panel shell.

## 6. Verify and ship

- Run targeted tests during development.
- Run full typecheck, test, and build gates.
- Load the unpacked extension in an isolated headed browser.
- Compare KickFlow and native replay near 07:13 on the same Hype VOD and exercise paused seek.
- Commit the implementation with a focused message.
- Add the commit hash, gate results, and concise behavior summary to `STATUS.md`.
