import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import {
  ANCHOR_SPECS,
  collectKickAnchorEvidence,
  evaluateKickAnchorResults,
  summarizeAnchorResults,
} from './kick-anchor-checks.mjs';
import { loadProductionAnchors } from './kick-anchor-loader.mjs';

const repoRoot = path.resolve('.');
const outputDir = path.join(repoRoot, 'output', 'playwright');
// The profile carries the login, and a login is what makes the session-gated anchors checkable at
// all (drops, rewards, the daily-reward CTA, chat history). Default stays logged-out and
// disposable; point KICK_PROFILE_DIR at the owner's durable profile for a logged-in run.
// ONE Chromium profile directory admits ONE browser process — never run two probes against the
// same profile concurrently, or the second hangs with no browser at all.
const profileDir = process.env.KICK_PROFILE_DIR
  ?? path.join(outputDir, 'kick-anchor-probe-profile');
const reportPath = path.join(outputDir, 'kick-anchor-probe.json');
const execFileAsync = promisify(execFile);
const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

// A hardcoded default channel silently decides whether this probe measures anything at all: the
// first two live runs landed on an OFFLINE channel, so every player anchor came back
// NOT_CHECKABLE and the run proved nothing. Measured 2026-08-28.
//
// So the default is DISCOVERED: Kick's public livestreams endpoint, read through `curl` because
// kick.com's WAF blocks Node's own fetch at the TLS/JA3 level while plain curl succeeds (project
// memory: kickflow-kick-automation-waf-block). One request, read-only, no session.
async function resolveLiveChannel() {
  const { stdout } = await execFileAsync('curl.exe', [
    '-s', '--max-time', '20',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      + ' (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'https://kick.com/stream/livestreams/tr?page=1&limit=10&sort=desc',
  ], { maxBuffer: 8 * 1024 * 1024 });
  const streams = JSON.parse(stdout)?.data ?? [];
  const slug = streams.map((stream) => stream?.channel?.slug).find((value) => SLUG_PATTERN.test(value ?? ''));
  if (!slug) throw new Error('No live channel could be resolved; pass a channel slug as argv[2]');
  return slug;
}

const channel = process.argv[2] ?? await resolveLiveChannel();

if (!SLUG_PATTERN.test(channel)) {
  throw new Error('channelSlug must contain only letters, digits, underscore, or hyphen');
}

async function resolveChromium() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.split('-')[1]) - Number(left.split('-')[1]));
  if (directories.length === 0) throw new Error('No Playwright Chromium installation was found');
  return {
    revision: directories[0],
    executablePath: path.join(root, directories[0], 'chrome-win64', 'chrome.exe'),
  };
}

function extractChatContents(payload, destination) {
  const visit = (value, depth = 0) => {
    if (!value || depth > 6) return;
    if (typeof value === 'string') {
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {
        // Ordinary strings are leaves.
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'content' && typeof child === 'string') {
        destination.add(child.slice(0, 500));
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(payload);
}

function emptyEvidence(observations) {
  return {
    chat: { root: false, list: false, row: false, rowAttributes: [], content: false, group: false, reactProperty: null, reactKey: null, contents: observations.chatContents, renderedImages: [], nearbyCandidates: [], listChildren: [] },
    player: { video: false, wrapper: false, bottomBar: false, fallbackBar: false, zControlClasses: [], buttons: [], caption: false, captionPaths: [], captionIconMatchIndexes: [], textTrackCount: 0, videoCandidates: [], theaterTokenMatches: [], theaterShortcutMatches: [], theaterState: null },
    navbar: { navbars: [], dailyRewardCount: 0, videoSources: [] },
    panels: { activePanel: false, activeSearchAnywhere: false, activeSearch: false, activeRow: false, activeUsername: false, drops: 0, rewards: 0 },
    network: { webSockets: observations.webSockets, requests: observations.requests },
  };
}

const anchorLoad = await loadProductionAnchors(repoRoot);
const webSockets = new Set();
const chatContents = new Set();
const requests = new Map();
let context = null;
let chromiumRevision = null;
let fatal = null;
let evidence = null;

try {
  const chromiumInstall = await resolveChromium();
  chromiumRevision = chromiumInstall.revision;
  // WAF countermeasures copied from quality-lock-round101-probe.mjs. Do not add userAgent:
  // mismatched UA and Sec-CH-UA values are themselves an automation signal on Kick.
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromiumInstall.executablePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1600, height: 900 },
    locale: 'tr-TR',
    args: [
      '--mute-audio',
      '--disable-blink-features=AutomationControlled',
      '--window-position=-3000,-3000',
      '--window-size=1600,900',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => undefined });
    const mute = () => {
      for (const media of document.querySelectorAll?.('video, audio') ?? []) {
        media.muted = true;
        media.volume = 0;
      }
    };
    setInterval(mute, 500);
  });

  const page = context.pages()[0] ?? await context.newPage();
  let resolvedChannelId = null;
  let inspectedJsonResponses = 0;
  page.on('response', async (response) => {
    if (resolvedChannelId !== null || inspectedJsonResponses >= 50) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;
    inspectedJsonResponses += 1;
    try {
      const value = await response.json();
      const queue = [value];
      for (let index = 0; index < queue.length && index < 200; index++) {
        const item = queue[index];
        if (!item || typeof item !== 'object') continue;
        if (!Array.isArray(item) && typeof item.id === 'number' && typeof item.chatroom?.id === 'number') {
          resolvedChannelId = item.id;
          break;
        }
        queue.push(...(Array.isArray(item) ? item : Object.values(item)).filter((child) => child && typeof child === 'object'));
      }
    } catch {
      // Response bodies can be unavailable/streaming. That only makes ID-dependent checks NC/MISS.
    }
  });
  page.on('websocket', (socket) => {
    webSockets.add(socket.url());
    socket.on('framereceived', (event) => extractChatContents(event.payload, chatContents));
  });

  // Exactly one navigation per run. No homepage discovery and no retry loop.
  await page.goto(`https://kick.com/${channel}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(anchorLoad.values.videoPlayer ?? 'video', { timeout: 45_000 }).catch(() => {});
  // Kick mounts the control bar only on pointer movement OVER THE PLAYER. `mouse.move(8, 8)` is
  // the top-left of the viewport — the navbar, not the player — so the bar never mounted and the
  // cog, the LIVE label and both z-controls anchors came back MISS on a healthy live page
  // (measured 2026-08-28). Reveal it the way production does: `quality-lock.ts:revealControlBar`
  // dispatches pointermove/mousemove/mouseover on the player wrapper. Do both — the real pointer
  // over the player's centre, and the same synthetic events on the wrapper.
  const videoSelector = anchorLoad.values.videoPlayer ?? '#video-player';
  const revealControlBar = async () => {
    const playerBox = await page.locator(videoSelector).first().boundingBox().catch(() => null);
    if (playerBox) {
      await page.mouse.move(playerBox.x + playerBox.width / 2, playerBox.y + playerBox.height / 2).catch(() => {});
    }
    await page.evaluate((selector) => {
      const wrapper = document.querySelector(selector)?.parentElement;
      if (!wrapper) return;
      for (const type of ['pointermove', 'mousemove', 'mouseover']) {
        wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
      }
    }, videoSelector).catch(() => {});
    await page.waitForTimeout(400);
  };

  await revealControlBar();
  await page.waitForTimeout(12_000);

  if (resolvedChannelId !== null) {
    for (const key of ['chatHistoryBaseUrl', 'chatHistoryStartTimeUrl']) {
      const sample = anchorLoad.values[key];
      if (typeof sample !== 'string') continue;
      const url = sample.replace('123456', String(resolvedChannelId));
      const result = await page.evaluate(async (target) => {
        try {
          const response = await fetch(target, { headers: { accept: 'application/json' } });
          return { status: response.status };
        } catch {
          return { status: 0 };
        }
      }, url);
      requests.set(url, { url, status: result.status });
    }
  }

  // Reveal AGAIN, immediately before measuring. Kick hides the control bar after a few seconds of
  // pointer inactivity, so a reveal that happens before the 12 s settle above is long gone by the
  // time evidence is collected — measured 2026-08-28: five control-bar anchors reported MISS on a
  // healthy live page for exactly this reason. The reveal must be adjacent to the measurement.
  await revealControlBar();

  evidence = await page.evaluate(collectKickAnchorEvidence, {
    anchors: anchorLoad.values,
    observations: {
      webSockets: [...webSockets],
      requests: [...requests.values()],
      chatContents: [...chatContents],
    },
  });
} catch (error) {
  fatal = error instanceof Error ? error.message : String(error);
} finally {
  await context?.close().catch(() => {});
}

const observations = {
  webSockets: [...webSockets],
  requests: [...requests.values()],
  chatContents: [...chatContents],
};
const results = evaluateKickAnchorResults(anchorLoad, evidence ?? emptyEvidence(observations));
const counts = summarizeAnchorResults(results);
const report = {
  generatedAt: new Date().toISOString(),
  channel,
  chromium: chromiumRevision,
  fatal,
  results,
  counts,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const result of results) {
  const value = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  console.log(`${result.status.padEnd(13)} ${result.id.padEnd(38)} ${result.where} = ${value}`);
}
console.log(`MATCH ${counts.MATCH} / MISS ${counts.MISS} / UNLOADABLE ${counts.UNLOADABLE} / NOT_CHECKABLE ${counts.NOT_CHECKABLE}`);
process.exitCode = counts.MISS === 0 && counts.UNLOADABLE === 0 ? 0 : 1;

// Keep the expected registry visible even if a future refactor accidentally returns fewer rows.
if (results.length !== ANCHOR_SPECS.length) process.exitCode = 1;
