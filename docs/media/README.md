# Media

## `kickflow-demo.gif` (README hero), a real recording

The unmodified extension build (`manifest.json` + `dist/` from this repository) running in Playwright's
Chromium against `docs/demo/fixture/channel.html`, a local page that imitates the Kick channel layout. It is
not kick.com and uses no Kick logos or assets. Requests to kick.com are answered from the fixture folder, Kick's
realtime chat socket is simulated, and everything else is blocked, so nothing reaches the network.

- **Real:** KickFlow's content scripts, its chat list, the *deleted* / *timeout* labels, the moderator-action
  rows, the player controls (the rewind click is a real click), and the popup with its live session numbers.
- **Simulated:** the page, the synthetic gradient video, the users, messages and moderator actions.
- **Added after capture:** the caption strip, a drawn mouse pointer at the position the script really used
  (headless Chromium paints none), and the popup panel placed over the page. Headless Chromium cannot click the
  toolbar icon, so the popup is opened as a tab and its "active tab" lookup is pointed at the demo tab.

Re-record with `node docs/demo/fixture/capture.mjs` (needs ffmpeg and a Playwright Chromium; see the file header).

## Component pictures

Captured in headless Chromium from offline fixtures that use KickFlow's production message renderer, styles
and player controls. The player shell is based on the repository's player-bar fixture; the names user1 through
user8 come from the synthetic chat-message helper. The background is a generated canvas, not a real stream. All
chat text and clock values are synthetic.

- `overview.png`: the complete fixture, with chat context and player controls.
- `chat-context.png`: preserved deletions, a timeout, mention and reply highlights.
- `chat-gifts.png`: the production gifted-subscription row after expanding recipients.
- `player-speed.png`: the production playback-speed menu in the synthetic player.
- `popup-en.png`, `popup-tr.png`: the real `popup.html` (2026-10-22 layout) rendered with a stubbed `chrome`
  API and made-up session numbers.
- `chat-and-player.gif`: recipient expansion, a real rewind-button click against a synthetic clock, the
  playback-speed menu, and a return to the fixture's live edge.

All HTTP and HTTPS requests were blocked, no chat connection was started, and no account was used. These are
component demonstrations, not evidence of current live-site compatibility.

## `social-preview.svg` / `.png`

The repository's social card (1280x640). The chat panel on the right is a crop of a frame from
`kickflow-demo.gif`.
