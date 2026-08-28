// Round 101 (2026-08-28). Owner reports the player is on Auto again, the same symptom
// round 100 fixed by moving GEAR_PATH_PREFIX 'M25.7' -> 'M16.759'.
//
// This probe answers, in one live run:
//   1. Does the SHIPPED prefix still match a button in the live control bar?
//   2. What do the bar's buttons actually look like now (every svg path dumped)?
//   3. What quality is aria-checked after the extension has had its full retry budget?
//   4. Did quality-lock warn (the round-100 warn path) — captured from the page console?
//   5. Is anything ELSE on the page exposing [role="menuitemradio"] before the gear is
//      opened (the known speed-controls 'AUTO' collision recorded in STATUS round 100)?
//
// The extension IS loaded, so what is measured is the real shipped behaviour, not a replica.

import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = path.resolve('.');
const OUTPUT_DIR = path.join(REPO, 'output', 'playwright');
// KICK_PROFILE_DIR points this at the owner's logged-in profile. It matters here more than
// anywhere else: logged OUT, `1080p60` carries "Giriş gerekli" and is not selectable, so the
// highest row quality-lock can legally pick is 720p60 — which is why nobody had yet seen the
// feature choose 1080p60.
const PROFILE_DIR = process.env.KICK_PROFILE_DIR ?? path.join(OUTPUT_DIR, 'quality-lock-round101-profile');
const REPORT_PATH = path.join(OUTPUT_DIR, 'quality-lock-round101-probe.json');
const SHOT_PATH = path.join(OUTPUT_DIR, 'quality-lock-round101.png');
// LOADED from production, never copied. This literal used to read 'M17.5 8.333' and went stale
// the same afternoon Kick re-minified the cog — the probe then reported "shipped prefix does not
// match" about ITS OWN copy while the extension was matching fine. That is the self-validating
// fixture defect, inside the tool built to detect it.
const { loadProductionAnchors } = await import('./kick-anchor-loader.mjs');
// ALL of them, not just the newest: the extension tries every entry, so a probe that checks one
// reports "fell back to structure" whenever the live cog matches an older entry — a partial
// oracle that would misreport the very thing this probe exists to measure.
const GEAR_PATH_PREFIXES = (await loadProductionAnchors(REPO)).values.gearPathPrefixes;
const CHANNEL = process.argv[2] || null;

function resolveChromium() {
  const root = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dir = readdirSync(root)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
  return { dir, exe: path.join(root, dir, 'chrome-win64', 'chrome.exe') };
}

const report = {
  chromium: null,
  channel: null,
  shippedPrefixes: GEAR_PATH_PREFIXES,
  preOpenMenuRadios: null,
  buttons: [],
  gearFoundByShippedPrefix: null,
  qualityAfterExtension: null,
  consoleKickflow: [],
  fatal: null,
};

const { dir, exe: executablePath } = resolveChromium();
report.chromium = dir;

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  executablePath,
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
page.on('console', (msg) => {
  const text = msg.text();
  if (/kickflow|quality-lock/i.test(text)) report.consoleKickflow.push(`${msg.type()}: ${text.slice(0, 300)}`);
});

try {
  let slug = CHANNEL;
  if (!slug) {
    await page.goto('https://kick.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(10_000);
    slug = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute('href') || '').match(/^\/([a-z0-9_-]{3,25})$/i);
        if (!m) continue;
        const name = m[1].toLowerCase();
        if (['browse', 'category', 'categories', 'following', 'search', 'about', 'help', 'clips', 'shop'].includes(name)) continue;
        return name;
      }
      return null;
    });
  }
  report.channel = slug;
  await page.goto(`https://kick.com/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#video-player', { timeout: 45_000 }).catch(() => {});

  // Full retry budget: APPLY_DELAY_MS 1800 + 5 x (260 + 1300) ~= 9.6 s. Give it 18 s.
  await page.waitForTimeout(18_000);

  // Is something else already exposing quality-menu-shaped rows? (speed-controls collision)
  report.preOpenMenuRadios = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((r) => ({
      text: (r.textContent || '').trim().slice(0, 40),
      checked: r.getAttribute('aria-checked'),
    })));

  // What the control bar's buttons actually are right now.
  report.buttons = await page.evaluate(() => {
    const video = document.querySelector('#video-player');
    const wrapper = video?.parentElement ?? null;
    if (!wrapper) return [];
    for (const type of ['pointermove', 'mousemove', 'mouseover']) {
      wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
    }
    return new Promise((resolve) => setTimeout(() => {
      const bar = wrapper.querySelector('div.z-controls.bottom-0')
        || Array.from(wrapper.querySelectorAll('div.z-controls')).filter((b) => b.querySelector('button'))[0];
      if (!bar) return resolve([]);
      resolve(Array.from(bar.querySelectorAll('button')).map((b, i) => ({
        index: i,
        label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30),
        testid: b.getAttribute('data-testid'),
        firstPathD: (b.querySelector('svg path')?.getAttribute('d') || '').slice(0, 40),
      })));
    }, 1000));
  });
  report.gearFoundByShippedPrefix = report.buttons.some((b) =>
    GEAR_PATH_PREFIXES.some((prefix) => b.firstPathD.startsWith(prefix)));

  // Open the gear BY HAND (positional, probe-only) and read what is selected.
  report.qualityAfterExtension = await page.evaluate(async (prefixes) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const video = document.querySelector('#video-player');
    const wrapper = video?.parentElement ?? null;
    if (!wrapper) return { error: 'no wrapper' };
    for (const type of ['pointermove', 'mousemove', 'mouseover']) {
      wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
    }
    await sleep(400);
    const bar = wrapper.querySelector('div.z-controls.bottom-0')
      || Array.from(wrapper.querySelectorAll('div.z-controls')).filter((b) => b.querySelector('button'))[0];
    if (!bar) return { error: 'no control bar' };
    const buttons = Array.from(bar.querySelectorAll('button'));
    // Prefer the shipped prefix; if it no longer matches, fall back to any button with no
    // data-testid (every other Kick control has one) so the menu can still be read.
    let gear = buttons.find((b) => prefixes.some((prefix) =>
      (b.querySelector('svg path')?.getAttribute('d') || '').startsWith(prefix)));
    const gearBy = gear ? 'shipped-prefix' : 'fallback-no-testid';
    if (!gear) gear = buttons.filter((b) => !b.getAttribute('data-testid') && b.querySelector('svg path')).pop();
    if (!gear) return { error: 'no gear candidate' };
    const gearPath = (gear.querySelector('svg path')?.getAttribute('d') || '').slice(0, 60);
    const fire = (el, type, Ctor) => el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', pointerId: 1, button: 0 }));
    fire(gear, 'pointerdown', PointerEvent);
    fire(gear, 'mousedown', MouseEvent);
    fire(gear, 'pointerup', PointerEvent);
    fire(gear, 'mouseup', MouseEvent);
    gear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    await sleep(600);
    const rows = Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((r) => ({
      text: (r.textContent || '').trim().slice(0, 40),
      checked: r.getAttribute('aria-checked') === 'true',
    }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { gearBy, gearPath, rows };
  }, GEAR_PATH_PREFIXES);

  await page.screenshot({ path: SHOT_PATH }).catch(() => {});
} catch (err) {
  report.fatal = String(err).slice(0, 600);
} finally {
  await context.close().catch(() => {});
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}
