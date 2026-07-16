# KickFlow

KickFlow is a personal-use Chrome extension for Kick.com. It keeps moderated chat understandable, turns important channel activity into readable rows, and adds practical controls to the live player without replacing Kick's own interface.

The project is deliberately small and local-first: Chrome Manifest V3, TypeScript, no backend, and no account automation.

## Chat context that survives moderation

KickFlow records chat messages for the active session so a ban, timeout, or moderator deletion does not erase the conversation around it.

- Deleted messages keep their original text, a **SİLİNDİ** state, and moderator attribution when the event provides it.
- Banned and timed-out users' recent messages stay in context, including duration and moderator metadata when available.
- Native-chat mode restores removed rows inline. KickFlow-chat mode renders the preserved state in its own list.
- The **Kaldırılanlar** tab is a session-scoped moderation ledger for banned, timed-out, and deleted messages.

![Preserved chat messages and system-event rows](docs/screenshots/chat-preservation-and-events.png)

_Offline component render using the production message renderer and CSS with synthetic data._

![Kaldırılanlar moderation ledger](docs/screenshots/settings-removed.png)

_Offline component render of the production settings panel with synthetic moderation data._

## System events without the noise

The chat renderer adds compact, separately styled rows for:

- new and renewing subscriptions;
- single and bulk gifted subscriptions;
- paid Kicks gifts, including amount, gift name, and sender note when present;
- host and raid activity with viewer counts;
- chat-mode changes such as slow mode.

KickFlow also reserves space for Kick's native event stack, so pinned messages, polls, goals, and pinned Kicks remain visible and interactive rather than being covered by the custom chat surface. Poll display is currently native passthrough, not a reimplemented poll UI.

<!-- TODO: owner to add a live screenshot of Kick's native pinned-message and poll stack alongside KickFlow chat. -->

## Gift recipients

A single gifted subscription names its recipient inline. Bulk gifts show the first three known recipients and a visible **ve N kişi daha** control; selecting it expands the complete known list in place. Recipient text is inserted safely as text, not HTML.

![Single and bulk gift recipients in the collapsed state](docs/screenshots/gift-recipients-collapsed.png)

_Offline component render using production code and synthetic usernames, collapsed state._

![Bulk gift recipients in the expanded state](docs/screenshots/gift-recipients-expanded.png)

_Offline component render using production code and synthetic usernames, expanded state._

## Live-player tools

KickFlow mounts one compact control cluster directly into Kick's native player bar:

- **Fixed highest quality:** opens Kick's own quality menu and selects the highest actually available resolution, excluding Auto and login-gated choices. It retries after media loads and safely does nothing when the verified menu controls are unavailable.
- **1.5× live catch-up:** temporarily accelerates playback when the stream falls behind and returns to 1× near the live edge.
- **10-second seek:** inline back/forward buttons and rebindable arrow-key actions share the same DVR-safe clamping. Holding an arrow repeats at a throttled rate for longer seeks.
- **CANLI:** shows the live-edge state or current delay and returns the player to live.
- **Frame capture:** saves the current video frame as a PNG.
- **Speed control:** switches between automatic catch-up and manual rates from 0.25× to 3×, with a buffer-safety fallback.
- **Auto-theater:** optionally enters Kick's native theater layout once per media load without fighting a later manual exit.

![KickFlow controls mounted into a synthetic native player bar](docs/screenshots/player-controls.png)

_Offline component render of the real seek, live-catch-up, speed, and screenshot modules with production CSS. The synthetic stream is 50 seconds behind, so automatic catch-up is visibly running at 1.5×._

## Settings dashboard

Navbar and chat-footer entry points open the same two-pane dashboard. Its tabs are **Genel**, **Kaldırılanlar**, **Sohbet**, **Oynatıcı**, **Kısayollar**, and **Hakkında**.

- **Genel** shows channel/session diagnostics and selects native or KickFlow chat rendering.
- **Sohbet** controls deleted-message preservation, inline ban rows, subscriptions, gifted subscriptions, Kicks, host/raid events, mode changes, and sidebar refresh.
- **Oynatıcı** controls auto-theater, seek buttons, live catch-up, highest quality, screenshots, and speed controls.
- **Kısayollar** enables, disables, and rebinds each action immediately. It prevents duplicate bindings and warns when a key overlaps with a Kick-native shortcut.
- **Hakkında** reports the extension version and platform.

![Chat feature toggles](docs/screenshots/settings-chat.png)

_Offline component render of the production **Sohbet** tab._

![Player feature toggles](docs/screenshots/settings-player.png)

_Offline component render of the production **Oynatıcı** tab._

![Rebindable hotkeys](docs/screenshots/settings-hotkeys.png)

_Offline component render of the production **Kısayollar** tab and real default bindings._

![About and version information](docs/screenshots/settings-about.png)

_Offline component render of the production **Hakkında** tab, version 0.2.0._

## Default hotkeys

| Action | Default |
| --- | --- |
| Seek back 10 seconds | `←` |
| Seek forward 10 seconds | `→` |
| Capture the current frame | `S` |
| Return to live | `L` |

Hotkeys are ignored while typing in inputs, text areas, selects, editable content, and chat editors. Ctrl/Command/Alt combinations are left alone.

## Sidebar refresh

KickFlow periodically refreshes followed and recommended channel rows using Kick's channel endpoint. It updates live indicators and viewer counts, hides confirmed-offline rows reversibly, retries transient failures, and reapplies cached state when Kick re-renders the sidebar.

<!-- TODO: owner to add a live screenshot of refreshed followed/recommended channel states. -->

## Install as an unpacked extension

### From the 0.2.0 release

1. Download [`kickflow-v0.2.0.zip`](https://github.com/ydbilgin/kickflow/releases/download/v0.2.0/kickflow-v0.2.0.zip).
2. Extract the archive.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json` and `dist/`.

### From source

Requires Node.js and npm.

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository. Rebuild and reload the extension after source changes.

## Development

```bash
npm run typecheck
npm test
npm run build
```

| Layer | Technology |
| --- | --- |
| Extension platform | Chrome Manifest V3 |
| Application code | TypeScript 5.6 |
| Bundling | esbuild 0.24 |
| Tests | Vitest 4.1 + jsdom 29 |
| UI integration | Content scripts over Kick's native DOM and public event interfaces |

The documentation screenshots are generated in headless Chromium from the real TypeScript modules and injected production CSS. All fixture identities are synthetic, and the screenshot harness never opens Kick.com.

## Scope and disclaimer

KickFlow is a personal project provided as-is. It is not published on the Chrome Web Store and is not affiliated with, endorsed by, or sponsored by Kick. Because it integrates with Kick's DOM and public event/API surfaces, site changes may require maintenance.
