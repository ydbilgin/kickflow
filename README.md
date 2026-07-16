# KickFlow

A personal-use Chrome MV3 companion for Kick.com that keeps moderated chat readable and adds practical live-player controls.

## Features

- **Preserved chat context.** Banned, timed-out, and deleted messages remain visible with their original text, moderation state, moderator attribution when available, and a session-scoped **Kaldırılanlar** (Removed) log.
- **Richer chat events.** Subscriptions, gifted subs, Kicks, host/raid activity, and chat-mode changes appear as compact event rows. Kick's native pinned-message and poll stack remains visible alongside them.
- **Gift recipient names.** A single gift names its recipient inline. Bulk gifts show three names plus a clickable **ve N kişi daha** control that expands the remaining known recipients in place.
- **Player quality of life.** KickFlow selects the highest available quality, catches up to live at a flat 1.5×, adds ±10-second seek controls, exposes a **CANLI** go-live button, supports frame capture and playback-speed controls, and offers opt-in auto-theater mode.
- **Settings where you need them.** Navbar and chat-footer buttons open a two-pane Turkish dashboard for **Kaldırılanlar / Genel / Sohbet / Oynatıcı / Kısayollar / Hakkında**, with per-feature switches and rebindable hotkeys.
- **Fresh sidebar state.** Followed and recommended channel live status and viewer counts refresh without a full page reload.

### Moderation context and system events

![Offline component render showing preserved moderation rows and KickFlow system events](docs/screenshots/chat-preservation-and-events.png)

Deleted and timed-out messages retain their original text; the event feed uses the same production renderer and styles.

### Gift recipients: collapsed and expanded

![Offline component render showing single and bulk gift recipients in the collapsed state](docs/screenshots/gift-recipients-collapsed.png)

![Offline component render showing a bulk gift after all known recipients are expanded](docs/screenshots/gift-recipients-expanded.png)

These screenshots were generated in headless Chromium from the real TypeScript component modules and CSS, using offline fixture data—no Kick page or account session was opened.

<!-- TODO: owner to add a live screenshot of the player control bar -->

## Install (unpacked)

### Release build

1. Download [`kickflow-v0.2.0.zip`](https://github.com/ydbilgin/kickflow/releases/download/v0.2.0/kickflow-v0.2.0.zip) and extract it.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json` and `dist/`.

### Build from source

Requires Node.js and npm.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's root folder. Re-run `npm run build` and reload the extension after source changes.

## Hotkeys

Defaults are enabled and can be rebound or disabled from **Kısayollar**:

| Action | Default |
| --- | --- |
| Seek back 10 seconds | `←` |
| Seek forward 10 seconds | `→` |
| Capture the current frame | `S` |
| Return to live | `L` |

Hotkeys are ignored while typing in an input or editor.

## Tech

Chrome Manifest V3 · TypeScript · esbuild · Vitest + jsdom

## Status

KickFlow is a personal project, provided as-is and not published on the Chrome Web Store. It depends on Kick's DOM and public event interfaces, so site changes may require updates. Not affiliated with Kick.
