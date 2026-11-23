# Drawn explainers

`docs/media/explain-chat.gif` and `docs/media/explain-player.gif` are drawn, not recorded. Each page here paints
any moment of its film when asked (`window.renderAt(seconds)`), and `render.mjs` steps through it frame by frame
in a headless Chromium, then lets ffmpeg turn the frames into an optimised GIF. No page is loaded from the
network and no screen is captured.

| Film | Page | What it shows |
|---|---|---|
| `chat` | `chat.html` | The same chat with and without KickFlow while a moderator deletes a message and times someone out. |
| `player` | `player.html` | Left / Right, S and L against a drawing of the stream's buffer. |

## Re-render

From the repository root:

```sh
npm ci                      # Playwright is a dev dependency
npx playwright install chromium
node docs/explain/render.mjs chat --sheet
node docs/explain/render.mjs player --sheet
```

`--sheet` also writes `contact-sheet-<film>.png` here (one frame per second, git-ignored) for a quick look;
`--mp4` writes an MP4 beside the GIF. Needs ffmpeg on `PATH`. Optional environment variables:
`DEMO_CHROMIUM` (a Chromium or chrome-headless-shell), `FFMPEG`, `DEMO_PLAYWRIGHT_FROM` (a folder whose
`node_modules` holds Playwright).

## Changing a film

Words, timing and the sequence of messages or key presses live in the `TIMELINE` block at the top of each
page's script; colours are in the `C` object below it. Keep each GIF under about 3 MB.
