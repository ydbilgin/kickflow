# VOD Chat Elapsed Timestamps — Design

**Date:** 2026-07-26
**Status:** Approved

## Problem

KickFlow's own chat renderer formats every message's `created_at` as a local wall-clock
`HH:MM` value. On a VOD, Kick's native Chat Replay instead displays the message's elapsed
position within the recording as `HH:MM:SS`.

The mismatch was reproduced on:

- VOD: `https://kick.com/hype/videos/019f9a7a-a9f0-76a9-873c-705f620bfcc9`
- VOD start: `2026-07-25T18:12:38Z`
- Message: `omercanturk: yardımcı fulle`
- Message time: `2026-07-26T01:25:48Z`
- Native Kick timestamp: `07:13:10`
- Current KickFlow timestamp in Europe/Istanbul: `04:25`

The native value is exactly:

```text
message.created_at - vod.start_time
= 2026-07-26T01:25:48Z - 2026-07-25T18:12:38Z
= 07:13:10
```

## Goals

- Match native Kick's VOD timestamp semantics in KickFlow own-chat mode.
- Show VOD elapsed position as `HH:MM:SS`.
- Preserve the existing local `HH:MM` timestamp behavior on live channels.
- Keep the original absolute `created_at` value intact in the message model and store.
- Make timestamp behavior deterministic and independently testable.

## Non-goals

- Do not change native-chat rendering; Kick already owns its correct replay timestamps.
- Do not alter replay polling, seek behavior, or message history windows.
- Do not rewrite system-event or removed-message timestamp presentation in this change.
- Do not add a new user-facing setting.

## Considered Approaches

### 1. Inject a VOD-aware timestamp formatter — selected

Keep `ChatMessage.createdAt` unchanged. Pass a formatter from the VOD session into
`RenderQueue`, and let `buildMessageElement` use the injected display text.

This keeps time presentation separate from transport and storage, preserves live behavior, and
is easy to test without a browser.

### 2. Rewrite `createdAt` into a synthetic date

Rejected because it would corrupt the message's source timestamp and could affect sorting,
preservation expiry, removed-message evidence, and future metadata use.

### 3. Patch rendered DOM timestamps after each replay response

Rejected because it introduces a second render pass and creates seek/batching race conditions.
It also couples VOD timing to DOM selectors instead of the message render boundary.

## Design

### Pure elapsed-time formatter

Add a focused formatter that accepts:

- the message's absolute `createdAt` string;
- the VOD's absolute `startTimeMs`.

It returns:

- `HH:MM:SS` for a valid timestamp at or after the VOD start;
- an empty string for an invalid timestamp, invalid start, or a message before the VOD start.

Hours are total elapsed hours and do not wrap at 24. For example, a message 31 hours into a
recording renders as `31:02:03`. Minutes and seconds are always two digits; hours are at least
two digits.

Fractional milliseconds are floored to the containing second, matching native Kick's whole-second
display.

### Replay metadata handoff

`VodChatReplayController` already owns the validated VOD start time. Its message-delivery callback
will include that validated `startTimeMs`. Bootstrap stores it in a lifecycle-local variable before
enqueueing replay messages.

No metadata request is duplicated, and no global timestamp state is introduced.

### Render boundary

`RenderQueue` gains an optional message timestamp formatter. When present, it supplies the display
text to `buildMessageElement`; when absent, the existing local live formatter remains the default.

Bootstrap supplies the VOD formatter only for a VOD own-chat session. Live own-chat and all direct
renderer callers continue using the existing local `HH:MM` behavior.

### Lifecycle and seek behavior

The VOD start time is immutable for a session. A same-channel VOD-to-VOD navigation already creates
a new lifecycle and controller, so the formatter cannot retain the prior VOD's start time.

Seek resets continue clearing pending rows and the prior replay window. Newly fetched messages are
rendered with the same session start time and therefore show their correct elapsed positions.

## Error Handling

- Invalid `createdAt`: render no timestamp.
- Invalid VOD start time: render no elapsed timestamp.
- Message before VOD start: render no elapsed timestamp rather than a negative or wrapped value.
- Replay metadata/history failure: retain the existing fail-open behavior to native Kick Chat
  Replay.

## Tests

- Pure formatter:
  - zero offset → `00:00:00`;
  - captured Hype fixture → `07:13:10`;
  - sub-second flooring;
  - more than 24 hours;
  - invalid and pre-start inputs.
- Message renderer:
  - injected timestamp is rendered;
  - default live timestamp remains local `HH:MM`.
- Render queue/bootstrap:
  - VOD start metadata reaches rendered replay rows;
  - VOD mode still opens no KickFlow live WebSocket.
- Full gate:
  - TypeScript typecheck;
  - all Vitest tests;
  - production build;
  - staged diff/secret checks.
- Live browser verification:
  - seek the captured Hype VOD to `07:13:10`;
  - native Kick displays `07:13:10`;
  - KickFlow displays `07:13:10` for `omercanturk: yardımcı fulle`;
  - KickFlow no longer displays `04:25` for that row.
