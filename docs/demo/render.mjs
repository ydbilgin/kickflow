// Renders docs/demo/scene.html to docs/demo.gif, frame by frame, with no screen recording.
// Every frame is a pure function of time: the page exposes window.DEMO = { width, height, duration, fps }
// and window.renderAt(seconds). This script steps the clock, screenshots each frame in a headless
// Chromium, then lets ffmpeg build an optimised GIF (palette per file, no dithering noise).
//
// Usage (from the repository root):
//   node docs/demo/render.mjs                 -> docs/demo.gif
//   node docs/demo/render.mjs --sheet         -> also docs/demo/contact-sheet.png (not committed)
//   node docs/demo/render.mjs --mp4           -> also docs/demo.mp4
// Needs Node 18+, the "playwright" package (npm install --no-save playwright) and ffmpeg on PATH.
// Optional environment: DEMO_CHROMIUM=<path to a Chromium or chrome-headless-shell>, FFMPEG=<path>,
// DEMO_PLAYWRIGHT_FROM=<folder whose node_modules holds playwright>.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

// Playwright is found next to this repository (npm install --no-save playwright), or in the folder named by
// DEMO_PLAYWRIGHT_FROM (any folder whose node_modules holds playwright).
let chromium;
try {
  const from = path.join(process.env.DEMO_PLAYWRIGHT_FROM || process.cwd(), 'package.json');
  ({ chromium } = createRequire(from)('playwright'));
} catch {
  console.error('The "playwright" package is missing. Run: npm install --no-save playwright');
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.DEMO_CHROMIUM ? { executablePath: process.env.DEMO_CHROMIUM } : {}),
});
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.route(/^https?:/, (route) => route.abort());   // the scene is fully offline
await page.goto(pathToFileURL(path.join(here, 'scene.html')).href);
await page.evaluate(() => document.fonts.ready);
const demo = await page.evaluate(() => window.DEMO);
await page.setViewportSize({ width: demo.width, height: demo.height });

const frames = mkdtempSync(path.join(tmpdir(), 'demo-frames-'));
const count = Math.round(demo.duration * demo.fps);
for (let i = 0; i < count; i += 1) {
  await page.evaluate((t) => window.renderAt(t), i / demo.fps);
  await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`) });
}
await browser.close();
console.log(`rendered ${count} frames at ${demo.width}x${demo.height}, ${demo.fps} fps`);

const input = ['-y', '-loglevel', 'error', '-framerate', String(demo.fps), '-i', path.join(frames, 'f%04d.png')];
const run = (extra) => {
  const result = spawnSync(ffmpeg, [...input, ...extra], { stdio: 'inherit' });
  if (result.status !== 0) { console.error(`ffmpeg failed (${result.status})`); process.exit(3); }
};

const gif = path.resolve(here, '..', 'demo.gif');
run(['-filter_complex',
  '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
  '-loop', '0', gif]);
console.log(`wrote ${gif} (${(statSync(gif).size / 1048576).toFixed(2)} MB)`);

if (args.has('--mp4')) {
  const mp4 = path.resolve(here, '..', 'demo.mp4');
  run(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', mp4]);
  console.log(`wrote ${mp4}`);
}
if (args.has('--sheet')) {
  // One frame per second in a grid, to check every shot by eye before publishing.
  const sheet = path.join(here, 'contact-sheet.png');
  const columns = 4;
  const rows = Math.ceil(demo.duration / columns);
  run(['-vf', `fps=1,scale=${Math.round(demo.width / 2)}:-1,tile=${columns}x${rows}:padding=6:color=white`,
    '-frames:v', '1', sheet]);
  console.log(`wrote ${sheet}`);
}
rmSync(frames, { recursive: true, force: true });
