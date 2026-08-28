// Opens a VISIBLE Chromium on the owner's durable Kick profile so HE can log in by hand, then
// confirms the login and exits. Claude never types a credential here — the script only opens the
// window, waits, and verifies.
//
// This window is deliberately on-screen: it is a window the owner asked for, which is the one
// exception to "no window ever reaches the owner's screen".
//
// Run:  node tests/playwright/kick-owner-login.mjs
// Then: $env:KICK_PROFILE_DIR = "<repo>\output\playwright\kickflow-owner-profile"
//       node tests/playwright/kick-anchor-probe.mjs

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const repoRoot = path.resolve('.');
const profileDir = process.env.KICK_PROFILE_DIR
  ?? path.join(repoRoot, 'output', 'playwright', 'kickflow-owner-profile');
const WAIT_MINUTES = Number(process.env.KICK_LOGIN_WAIT_MINUTES ?? 12);

async function resolveChromium() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.split('-')[1]) - Number(left.split('-')[1]));
  if (directories.length === 0) throw new Error('No Playwright Chromium installation was found');
  return path.join(root, directories[0], 'chrome-win64', 'chrome.exe');
}

// Playwright's BUNDLED Chromium is not the browser the owner uses, and it differs from real Chrome
// in ways a login flow can notice: no branded Sec-CH-UA (`Chromium` / `Not;A=Brand` instead of
// `Google Chrome`), no Widevine, a build number that never matches a shipped Chrome release. Real
// Chrome via `channel: 'chrome'` removes that whole class of doubt, and it still runs in OUR OWN
// profile directory — the owner's tabs, session and scroll position are never touched.
// The 429 on /mobile/login is IP/browser-scoped (measured 2026-08-20 and again 2026-08-28), so a
// fresh exit IP clears it. KICK_PROXY takes a SOCKS5 URL — e.g. an SSH dynamic tunnel to the
// owner's own Frankfurt box: `ssh -i <key> -D 1080 -N ubuntu@<host>` then
// KICK_PROXY=socks5://127.0.0.1:1080. DNS is resolved through the proxy too, so the browser and
// its lookups agree on one exit.
const proxyServer = process.env.KICK_PROXY ?? null;

async function launch() {
  const shared = {
    headless: false,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    // `--disable-extensions` and `--enable-automation` are Playwright defaults; the second is the
    // flag that makes Chrome announce itself as automated.
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    viewport: null,
    // NEVER set the `userAgent` option here: it rewrites the UA string but not the Sec-CH-UA
    // client hints, and that mismatch is itself a bot signal that the LOGIN path does not survive
    // (reading pages does). Measured 2026-08-20.
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1500,950',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };
  try {
    const context = await chromium.launchPersistentContext(profileDir, { ...shared, channel: 'chrome' });
    return { context, browser: 'real Chrome (channel: chrome)' };
  } catch (error) {
    console.log(`Real Chrome unavailable (${String(error).split('\n')[0]}) — falling back to bundled Chromium.`);
    const context = await chromium.launchPersistentContext(profileDir, {
      ...shared,
      executablePath: await resolveChromium(),
    });
    return { context, browser: 'bundled Chromium' };
  }
}

const { context, browser } = await launch();
console.log(`Browser: ${browser}`);
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => undefined });
});

const page = context.pages()[0] ?? (await context.newPage());

// "Bilinmeyen hata" is what Kick RENDERS; it is not what happened. The status code separates the
// three causes that look identical on screen: 429 = rate limited (IP/browser-scoped, measured
// 2026-08-20 — wait, do not retry), 403 = the WAF refused the request as automated, 419/422 =
// CSRF or validation. Without this the next session guesses again.
const authFailures = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!/login|auth|token|signin|session/i.test(url)) return;
  const status = response.status();
  if (status < 400) return;
  let body = '';
  try {
    body = (await response.text()).slice(0, 200).replace(/\s+/g, ' ');
  } catch {
    body = '(body unavailable)';
  }
  const line = `${status} ${response.request().method()} ${url} :: ${body}`;
  authFailures.push(line);
  console.log(`AUTH FAILURE >> ${line}`);
});

/** A `kick_session` cookie is NOT a login, and neither is the absence of a "Giriş Yap" string —
 * a logged-out browser satisfies both. Ask an authenticated endpoint for the account's own
 * username instead. */
async function loggedInAs() {
  return page.evaluate(async () => {
    try {
      const response = await fetch('/api/v1/user', { headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      const body = await response.json();
      return body?.username ?? body?.user?.username ?? null;
    } catch {
      return null;
    }
  }).catch(() => null);
}

try {
  // VERIFY THE EXIT IP BEFORE THE OWNER TYPES ANYTHING. A proxy that silently fails open would put
  // the login back on the rate-limited address and extend the block for nothing, and we would not
  // know until it failed again.
  if (proxyServer) {
    const exitIp = await page.goto('https://ifconfig.me/ip', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .then(() => page.evaluate(() => document.body.innerText.trim()))
      .catch(() => null);
    if (!exitIp) throw new Error(`Proxy ${proxyServer} did not resolve an exit IP — refusing to continue.`);
    console.log(`Proxy: ${proxyServer}  ->  exit IP ${exitIp}`);
  }

  await page.goto('https://kick.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const existing = await loggedInAs();
  if (existing) {
    console.log(`ALREADY LOGGED IN as ${existing} — profile: ${profileDir}`);
  } else {
    console.log(`WAITING FOR LOGIN (up to ${WAIT_MINUTES} min). Log in in the open window.`);
    const deadline = Date.now() + WAIT_MINUTES * 60_000;
    let username = null;
    while (!username && Date.now() < deadline) {
      await page.waitForTimeout(5_000);
      username = await loggedInAs();
    }
    console.log(username
      ? `LOGGED IN as ${username} — profile: ${profileDir}`
      : 'NOT LOGGED IN — the wait expired. Nothing was typed by the script.');
  }
} finally {
  if (authFailures.length > 0) {
    console.log('\n--- DIAGNOSIS (what Kick actually returned, not what it rendered) ---');
    for (const failure of authFailures) console.log(failure);
    const statuses = new Set(authFailures.map((failure) => failure.slice(0, 3)));
    if (statuses.has('429')) {
      console.log('VERDICT: 429 = RATE LIMITED, IP/browser-scoped, NOT bot detection and NOT the '
        + 'Chrome build. Stop retrying — each attempt extends it. Wait ~30 min or change the VPN exit, '
        + 'then ONE attempt.');
    } else if (statuses.has('403')) {
      console.log('VERDICT: 403 = the WAF refused the request as automated. Chrome build / launch '
        + 'flags are in play here — this is the bot-detection case.');
    } else {
      console.log('VERDICT: neither 429 nor 403 — read the status above; this is a CSRF/validation '
        + 'or server-side failure, not a fingerprint problem.');
    }
  } else {
    console.log('\nNo failing auth response was observed.');
  }
  await context.close().catch(() => {});
}
