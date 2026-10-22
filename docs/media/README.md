# Fixture media

I captured these four screenshots and the short GIF in headless Chromium from offline fixtures using KickFlow's production message renderer, styles, and player controls. The player shell is based on the repository's player-bar fixture; the names user1 through user8 come from the synthetic chat-message helper. The background is a generated canvas, not a real stream. All chat text and clock values are synthetic.

- `overview.png`: the complete fixture, with chat context and player controls.
- `chat-context.png`: preserved deletions, a timeout, mention and reply highlights.
- `chat-gifts.png`: the production gifted-subscription row after expanding recipients.
- `player-speed.png`: the production playback-speed menu in the synthetic player.
- `popup-en.png`, `popup-tr.png`: the real `popup.html` (2026-10-22 layout) rendered with a stubbed `chrome` API and made-up session numbers.
- `chat-and-player.gif`: recipient expansion, a real rewind-button click against a synthetic clock, the playback-speed menu, and a return to the fixture's live edge. Five frames, 8.2 seconds, looping.

All HTTP and HTTPS requests were blocked, no chat connection was started, and no account was used. These are component demonstrations, not evidence of current live-site compatibility.
