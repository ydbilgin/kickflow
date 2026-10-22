# The README demo film

`docs/demo.gif` is drawn, not recorded. `scene.html` is a small web page that paints any moment of the
film when asked (`window.renderAt(seconds)`), and `render.mjs` steps through it frame by frame in a headless
Chromium and lets ffmpeg turn the frames into an optimised GIF. No live Kick page, stream or account is used;
every name and message is invented.

## Re-render in one command

From the repository root (Playwright is already a dev dependency after `npm ci`):

```sh
node docs/demo/render.mjs --sheet
```

This rewrites `docs/demo.gif` and writes `docs/demo/contact-sheet.png` (one frame per second, for a quick
look; it is git-ignored). Add `--mp4` for `docs/demo.mp4` as well.

Needs Node.js 18 or newer, ffmpeg on `PATH`, and a Playwright Chromium (`npx playwright install chromium`).
Optional environment variables: `DEMO_CHROMIUM` (path to a Chromium or chrome-headless-shell),
`FFMPEG` (path to ffmpeg), `DEMO_PLAYWRIGHT_FROM` (a folder whose `node_modules` holds Playwright).

## Changing the film

- **Words and timing:** edit the `TIMELINE` block at the top of the script in `scene.html`. `CAPTIONS` holds
  each caption with its start and end second, `ROWS` the chat lines (and when one is deleted or timed out),
  `CLICKS` and `CURSOR` the rewind and live clicks, and `BEATS` when each layer (player and chat, popup, end
  card) is visible. `window.DEMO` sets size, frame rate and length.
- **The popup picture** is `docs/media/popup-en.png`, a render of the real `popup.html` with made-up status
  numbers. After a popup change, render it again (open `popup.html` with a stubbed `chrome` API, as the popup
  tests do, and save a 372 px wide screenshot at 2x), then re-render the film.
- **Chat rows and the player bar** are drawn in `scene.html` in KickFlow's style; if the real labels
  (`DELETED`, `TIMEOUT 10M`) or player buttons change, update them here too.

Open `scene.html` in a browser and call `renderAt(8)` in the console to check a single moment.
Keep the GIF under about 3 MB so GitHub shows it quickly.
