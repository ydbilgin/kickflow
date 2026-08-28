// Separates two things that look identical in a log: a Kick anchor that genuinely stopped
// matching, and a probe that never gave the anchor a chance to exist.
//
// native-bar retries 20 x 250 ms ~= 5 s from mount. Kick mounts the control bar on pointer
// movement over the player, and an automated run never moves a pointer there — so the warning
// added in `ddf1826` may be reporting the harness, not the product. The question that actually
// matters to a user is not "did it warn" but "did KickFlow's own buttons mount", so this measures
// THAT, twice on one page load: once with no pointer interaction, then again after hovering.
//
// Run: node tests/playwright/native-bar-hover-probe.mjs [channelSlug]

import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = path.resolve('.');
const OUTPUT_DIR = path.join(REPO, 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'native-bar-hover-probe.json');
const PROFILE_DIR = process.env.KICK_PROFILE_DIR ?? path.join(OUTPUT_DIR, 'native-bar-hover-profile');
const CHANNEL = process.argv[2] ?? 'absi';

// Every control KickFlow injects into Kick's native bar (src/content/player/native-bar.ts).
const KICKFLOW_CONTROL_IDS = [
  'kickflow-rewind-controls',
  'kickflow-catchup-controls',
  'kickflow-speed-controls',
  'kickflow-screenshot-controls',
];

async function resolveChromium() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.split('-')[1]) - Number(left.split('-')[1]));
  return path.join(root, dirs[0], 'chrome-win64', 'chrome.exe');
}

const report = { channel: CHANNEL, warnings: [], beforeHover: null, afterHover: null, fatal: null };

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  executablePath: await resolveChromium(),
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  viewport: { width: 1600, height: 900 },
  locale: 'tr-TR',
  args: [
    '--mute-audio',
    '--disable-blink-features=AutomationControlled',
    '--window-position=-3000,-3000',
    '--window-size=1600,900',
    `--disable-extensions-except=${REPO}`,
    `--load-extension=${REPO}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => undefined });
  const mute = () => { for (const m of document.querySelectorAll?.('video, audio') ?? []) { m.muted = true; m.volume = 0; } };
  setInterval(mute, 500);
});

const page = context.pages()[0] ?? (await context.newPage());
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'warning' && /KickFlow/i.test(text)) report.warnings.push(text.slice(0, 200));
});

const measure = (ids) => page.evaluate((controlIds) => {
  const video = document.querySelector('#video-player');
  const wrapper = video?.parentElement ?? null;
  const bar = wrapper?.querySelector('div.z-controls.bottom-0')
    ?? Array.from(wrapper?.querySelectorAll('div.z-controls') ?? []).find((b) => b.querySelector('button'))
    ?? null;
  return {
    playerPresent: Boolean(video),
    controlBarPresent: Boolean(bar),
    barButtonCount: bar ? bar.querySelectorAll('button').length : 0,
    captionButtonPresent: Boolean(document.querySelector('button[data-testid="video-player-closed-captions"]')),
    mountedControls: controlIds.filter((id) => document.getElementById(id) !== null),
  };
}, ids);

try {
  await page.goto(`https://kick.com/${CHANNEL}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#video-player', { timeout: 45_000 }).catch(() => {});

  // PHASE 1 — no pointer interaction at all. This is what every previous automated run did, and
  // it is well past native-bar's ~5 s retry budget.
  await page.waitForTimeout(20_000);
  report.beforeHover = await measure(KICKFLOW_CONTROL_IDS);

  // PHASE 2 — hold the pointer over the player the way a viewer would, then re-measure. If the
  // controls appear now, the warning was about the harness; if they stay missing, it is real.
  const box = await page.locator('#video-player').first().boundingBox().catch(() => null);
  for (let tick = 0; tick < 24; tick++) {
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2 + (tick % 2 === 0 ? 6 : -6),
        box.y + box.height / 2 + (tick % 2 === 0 ? 4 : -4),
      ).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  report.afterHover = await measure(KICKFLOW_CONTROL_IDS);
} catch (error) {
  report.fatal = String(error).slice(0, 400);
} finally {
  await context.close().catch(() => {});
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}
