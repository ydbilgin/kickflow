# KickFlow

A personal-use **Chrome (Manifest V3) extension for [Kick.com](https://kick.com)** that
preserves moderated chat messages and adds a set of player quality-of-life controls the
native site doesn't offer.

> Not published to the Chrome Web Store — it runs as an unpacked extension (see
> [Install](#install)). It only touches `kick.com` and requests just `storage` and
> `activeTab`.

## Features

### Chat
- **Ban / delete preservation** — when a message is removed or a user is banned, KickFlow
  keeps the message visible instead of letting it vanish, and collects everything removed
  during your session into a **"Kaldırılanlar"** (Removed) log with the moderator, action,
  and timestamp.
- **Chat events in the feed** — subscriptions, gifted subs, host/raid, pinned-message
  banner, and chat-mode changes (slow / followers / subs / emote-only) are rendered as
  tidy event rows, each individually toggleable.
- **Clickable usernames** — jump to any chatter's channel (new-tab / middle-click aware),
  including on preserved and removed rows.
- **Sticky pin banner** — mirrors Kick's pinned message with dismiss / minimize controls.

### Player
- **Fixed highest quality** — locks the stream to top resolution so it stops dropping.
- **Live catch-up** — smoothly plays at 1.5× to close the gap to the live edge, with a
  live/behind indicator and a one-click **CANLI** (go-live) button.
- **Seek controls** — `⏪10 / 10⏩` buttons plus arrow-key rewind/forward within Kick's
  available buffer.
- **Screenshot** the current frame, **speed controls**, and an opt-in **Auto Theater** mode.

### General
- **Settings dashboard** — an in-Kick panel (opened from the navbar or the chat footer)
  where every feature can be turned on/off and hotkeys rebound.
- **Sidebar refresh** — keeps the followed & recommended channel lists' viewer counts and
  live status current without a page reload.

## Install

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run build      # type-checks, then bundles to dist/
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this project's root folder (the one with
   `manifest.json`).
4. Open [kick.com](https://kick.com) — the KickFlow button appears in the navbar and the
   chat footer.

Re-run `npm run build` after pulling changes, then hit the reload icon on the extension
card.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:watch  # vitest (watch mode)
npm run build       # typecheck + esbuild bundle to dist/
```

- Source lives in `src/` (TypeScript, bundled with esbuild via `build.mjs`).
- Content runs in two worlds: `dist/content.js` (isolated) and `dist/mainworld.js` (MAIN,
  for the parts that need page-level access).
- Tests are under `tests/` and run on jsdom with Vitest.

## Notes

- Personal project — provided as-is, no warranty. It depends on Kick's DOM/APIs and may
  need updates when the site changes.
- Not affiliated with Kick.
