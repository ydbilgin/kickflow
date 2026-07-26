# KickFlow — VOD Chat Replay Synchronization Design

Date: 2026-07-26

## Problem

KickFlow's own-chat mode treats every channel route as a live session. On a route such as
`/{channel}/videos/{videoId}`, it resolves the channel's current chatroom, backfills the latest
channel history without a timestamp, and opens the live Pusher subscription. The result is that a
past broadcast displays whatever is being said in the channel now instead of the chat that
belonged to the watched moment.

Kick's native VOD chat does not use the live socket. A browser trace against Hype VOD
`019f9a7a-a9f0-76a9-873c-705f620bfcc9` established the current contract:

- `GET https://web.kick.com/api/v1/channels/{channelId}/videos` returns the matching VOD's
  `start_time`.
- Chat replay calls
  `GET https://web.kick.com/api/v1/chat/{channelId}/history?start_time={timestamp}`.
- The timestamp is `VOD start_time + video.currentTime`.
- Normal playback advances the requested timestamp in five-second steps.
- Pausing stops the periodic requests.
- Seeking issues an immediate request for the new timestamp even while paused.

## Approved Behavior

VOD chat timing must behave like native Kick while retaining KickFlow's own rendering:

- Never subscribe to live Pusher channels on a VOD route.
- Initially show chat for the VOD's current playback position.
- During playback, add replay messages in five-second windows.
- While paused, do not advance chat.
- On forward or backward seek, clear the old replay window and immediately load the new position.
- Moving between live, VOD, and another VOD on the same channel must restart the chat session.
- If replay metadata or replay history cannot be loaded, fail open to Kick's native VOD chat.
  Live chat must never be used as a VOD fallback.

## Considered Approaches

### 1. Force native mode on VOD routes

This gives correct synchronization with little code, but discards the explicitly selected
KickFlow chat view and its rendering behavior.

### 2. Mirror Kick's native replay DOM

This preserves native timing, but duplicates a React-owned and virtualized DOM. The repository
already has evidence that this class of integration is fragile across remounts and React updates.

### 3. Implement the native replay transport in KickFlow

This is the selected approach. It uses Kick's own metadata and history endpoints while keeping
KickFlow's normalized message/render pipeline. It is deterministic, testable, and does not couple
the overlay to native React row structure.

## Architecture

### Page session context

Replace slug-only navigation identity with a parsed session context:

- `live:{slug}` for normal channel routes, including the channel's videos listing.
- `vod:{slug}:{videoId}` for `/{slug}/videos/{videoId}`.

The slug remains the owner-facing channel identity, but the full session key controls teardown and
restart. This fixes same-channel transitions that the current `slug === currentSlug` guard ignores.

### VOD metadata

Add a small metadata resolver that:

1. fetches `https://web.kick.com/api/v1/channels/{channelId}/videos`;
2. validates the response as an array;
3. selects the exact URL `videoId`;
4. validates and parses `start_time`;
5. returns an explicit success/error result.

The route's VOD id is the identity source; title, list position, and DOM presentation are not used.

### Timestamped history

Extend the existing history fetcher with an optional `startTime` argument. Live callers continue
to use the unchanged URL without a query. VOD callers use an ISO timestamp in the `start_time`
query parameter. Existing normalization, chronological sorting, retries, timeouts, and response
validation remain shared.

### Replay controller

Create a lifecycle-scoped controller with injected callbacks:

- Resolve metadata once.
- Observe the current `#video-player`, including element replacement.
- Quantize normal playback to five-second buckets.
- Request the current bucket immediately on initial bind, `seeked`, and playback resume.
- Do not request advancing buckets while paused.
- Serialize requests and retain at most one latest queued bucket.
- Increment an epoch on seek so a response from the old position cannot render after the reset.
- Treat a successful empty response as a ready replay source.
- Report metadata/history failure to the owner so the overlay can fail open to native chat.

The controller does not own DOM or message storage. It only emits `onReset`, `onMessages`,
`onReady`, and `onUnavailable`.

### Own-chat integration

For a live context, keep the existing history backfill plus Pusher path.

For a VOD context:

- construct the same store, registry, render queue, overlay, settings panel, and rendering helpers;
- do not construct `PusherClient`;
- on replay reset, clear pending render work, the store, registry, rendered message/event rows, and
  the new-message pill;
- enqueue replay messages through the existing `enqueueOnce` path;
- mark the overlay replay source ready after each successful response, including an empty one;
- fail open to native VOD chat on unavailable metadata/history.

The overlay needs a replay-ready entry point and a replay-reset-safe pending-queue clear operation.
These are narrow additions; live takeover semantics remain unchanged.

### Native-chat integration

On VOD routes, native mode already has the correct replay UI. KickFlow must not open its background
live Pusher connection there. It may still initialize its settings/panel shell, but the native
replay remains the only chat source.

## Error Handling

- Metadata HTTP, shape, missing-id, and invalid-time errors are terminal for the KickFlow replay
  session and restore native chat.
- History retains the existing transient retry policy for rate limits and server errors.
- A terminal or exhausted replay-history result restores native chat.
- Responses from an earlier seek epoch are ignored.
- Session disposal makes all callbacks inert and releases video listeners/timers.
- No error path is allowed to instantiate the live socket for a VOD.

## Test Strategy

Automated coverage:

- route parsing and distinct live/VOD session keys;
- same-channel live-to-VOD and VOD-to-VOD restart identity;
- metadata response validation and exact VOD selection;
- timestamp construction and URL encoding;
- initial replay request;
- five-second playback buckets;
- pause suppression;
- immediate paused seek request;
- reset-before-new-window behavior;
- stale response suppression after seek;
- successful empty-window readiness;
- replay failure fail-open;
- explicit proof that VOD paths never instantiate/connect `PusherClient`;
- regression coverage for unchanged live history and live Pusher behavior.

Verification gate:

- targeted VOD/chat tests;
- full `npm test`;
- `npm run typecheck`;
- `npm run build`;
- real-browser check on the captured Hype VOD near 07:13, comparing requested replay timestamps
  and visible messages with native Kick.

## Non-goals

- Recovering chat messages that Kick's stored VOD history no longer contains.
- Replaying historical moderation events from Pusher.
- Changing the visual design of KickFlow chat.
- Adding a separate VOD/native setting.
