// Records docs/media/kickflow-demo.gif: the real, unmodified KickFlow build (manifest.json + dist/ from this
// repository) running in Playwright's Chromium against channel.html, a local page that imitates the Kick
// layout. Nothing reaches the network: kick.com page and API requests are answered from this folder, the
// realtime chat socket is simulated with Playwright's routeWebSocket, and every other request is aborted.
//
// Usage, from the repository root (run `npm run build` first if src/ changed):
//   node docs/demo/fixture/capture.mjs              -> docs/media/kickflow-demo.gif
//   node docs/demo/fixture/capture.mjs --still=<file.png>   also saves one finished frame
// Needs Node 18+, ffmpeg on PATH and a Playwright Chromium with extension support (the full "chromium"
// build, not chrome-headless-shell). Optional environment: DEMO_PLAYWRIGHT_FROM=<folder whose
// node_modules holds playwright>, DEMO_CHROMIUM=<chromium executable>, FFMPEG=<ffmpeg path>.
//
// What is real and what is not:
// - Real: the extension, its content scripts, its chat list, labels, player controls and popup.
// - Simulated: the page (channel.html), the synthetic video, the chat users and messages, the moderator
//   actions, and the channel/history API answers.
// - Added after capture: the caption strip under each frame, the drawn mouse pointer (headless Chromium
//   paints none; it is drawn where the script really moved the mouse) and the popup panel, which is a
//   screenshot of the real popup.html placed over the page. Headless Chromium cannot click the toolbar
//   icon, so the popup is opened as a tab and its "active tab" lookup is pointed at the demo tab.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const media = path.join(repo, 'docs', 'media');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const stillArg = process.argv.find((arg) => arg.startsWith('--still='))?.slice(8);

let chromium;
try {
  const from = path.join(process.env.DEMO_PLAYWRIGHT_FROM || repo, 'package.json');
  ({ chromium } = createRequire(from)('playwright'));
} catch {
  console.error('The "playwright" package is missing. Run `npm ci`, or set DEMO_PLAYWRIGHT_FROM.');
  process.exit(2);
}

const FPS = 12;
const W = 960;
const H = 540;
const CAPTION_H = 46;
const CHATROOM_ID = 2002;
const CHANNEL_ID = 1001;

// Chrome derives an unpacked extension's id from its folder path.
const extensionId = [...createHash('sha256').update(repo).digest('hex').slice(0, 32)]
  .map((c) => 'abcdefghijklmnop'[parseInt(c, 16)]).join('');

const work = mkdtempSync(path.join(tmpdir(), 'kickflow-demo-'));
const run = (args) => {
  const result = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) { console.error(`ffmpeg failed (${result.status})`); process.exit(3); }
};

// A slow, dark synthetic "stream": a drifting colour gradient, no real footage.
const video = path.join(work, 'stream.webm');
run(['-f', 'lavfi', '-i', 'gradients=s=640x360:c0=0x1f3a4c:c1=0x101b22:c2=0x2c2440:n=3:speed=0.002:d=30:r=25',
  '-c:v', 'libvpx-vp9', '-b:v', '250k', video]);

const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  ...(process.env.DEMO_CHROMIUM ? { executablePath: process.env.DEMO_CHROMIUM } : {}),
  args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`, '--mute-audio'],
});

const json = (body, extra = {}) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body), ...extra });
await context.route(/.*/, (route) => {
  const url = new URL(route.request().url());
  if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return route.continue();
  if (url.hostname === 'kick.com') {
    if (url.pathname === '/demo-channel') {
      return route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(here, 'channel.html')) });
    }
    if (url.pathname === '/demo-media/stream.webm') {
      return route.fulfill({ contentType: 'video/webm', body: readFileSync(video) });
    }
    if (url.pathname === '/api/v2/channels/demo-channel') {
      return route.fulfill(json({ id: CHANNEL_ID, chatroom: { id: CHATROOM_ID, channel_id: CHANNEL_ID }, subscriber_badges: [] }));
    }
    return route.fulfill({ status: 404, body: '' });
  }
  if (url.hostname === 'web.kick.com' && url.pathname.startsWith(`/api/v1/chat/${CHANNEL_ID}/history`)) {
    return route.fulfill(json({ data: { messages: [] } }, {
      headers: { 'access-control-allow-origin': 'https://kick.com', 'access-control-allow-credentials': 'true' },
    }));
  }
  return route.abort();
});

let socket = null;
await context.routeWebSocket(/^wss:\/\/realtime\.demo\.platform\.kick\.com\//, (ws) => { socket = ws; });

// KickFlow's own chat list ("KickFlow list" in the popup) is the mode this demo shows.
const setup = await context.newPage();
await setup.goto(`chrome-extension://${extensionId}/popup.html`);
await setup.evaluate(() => chrome.storage.local.set({ kf_flag_chatMode: 'own' }));
await setup.close();

const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://kick.com/demo-channel');
await page.waitForFunction(() => document.getElementById('kickflow-message-list'));
for (let i = 0; i < 50 && !socket; i += 1) await page.waitForTimeout(100);
if (!socket) { console.error('The demo page never opened its chat socket.'); process.exit(4); }

let sequence = 0;
const publish = (event, data, channel = `chatrooms.${CHATROOM_ID}.v2`) => socket.send(JSON.stringify({
  push: { channel, pub: { data: { event, data: JSON.stringify(data) } } },
}));
const USERS = {
  river: [11, 'river_fox', '#7fc8ff'],
  mint: [12, 'mint_owl', '#9be27a'],
  crow: [13, 'pixel_crow', '#f7a35c'],
  lynx: [14, 'quiet_lynx', '#d59cf6'],
  heron: [15, 'sunny_heron', '#f2d16b'],
};
const chat = ([id, username, color], content) => {
  const messageId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  publish('App\\Events\\ChatMessageEvent', {
    id: messageId, chatroom_id: CHATROOM_ID, content, type: 'message', created_at: new Date().toISOString(),
    sender: { id, username, slug: username, identity: { color, badges: [] } },
  });
  return messageId;
};
const MOD = { username: 'mod_sage' };

chat(USERS.river, 'good evening chat');
chat(USERS.lynx, 'that comeback in round 3 was unreal');
await page.waitForTimeout(1200);

// ---- Real-time capture of raw page frames ----
const frames = [];
let pointer = null;
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
let capturing = true;
const captureLoop = (async () => {
  while (capturing) {
    const file = path.join(work, `raw${String(frames.length).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push({ t: now(), file, pointer });
  }
})();
const at = async (seconds) => { const wait = seconds * 1000 - (Date.now() - t0); if (wait > 0) await page.waitForTimeout(wait); };
const movePointer = async (x, y) => { await page.mouse.move(x, y, { steps: 4 }); pointer = { x, y }; };

let crowId = '';
const steps = [
  [0.4, () => chat(USERS.mint, 'anyone know the song?')],
  [1.3, () => { crowId = chat(USERS.crow, 'FREE SUBS here >>> totally-legit.example'); }],
  [2.2, () => chat(USERS.heron, 'wait, what did pixel_crow post?')],
  [3.4, () => publish('App\\Events\\MessageDeletedEvent', { id: 'demo-delete-1', message: { id: crowId }, deleted_by: MOD })],
  [4.9, () => chat(USERS.mint, 'MODS ARE ASLEEP POST CAPS')],
  [6.0, () => publish('App\\Events\\UserBannedEvent', {
    id: 'demo-ban-1', user: { id: USERS.mint[0], username: USERS.mint[1], slug: USERS.mint[1] },
    banned_by: MOD, permanent: false, duration: 10,
  })],
  [7.0, () => chat(USERS.river, 'back to the game')],
  [8.2, () => movePointer(330, 395)],
  [9.0, () => movePointer(340, 398)],
  [9.6, async () => {
    const box = await page.locator('#kickflow-rewind-controls button').first().boundingBox();
    if (!box) throw new Error('KickFlow rewind control did not mount');
    const x = Math.round(box.x + box.width / 2); const y = Math.round(box.y + box.height / 2);
    await movePointer(x, y);
    await page.waitForTimeout(250);
    await page.mouse.click(x, y);
  }],
  [10.8, () => page.mouse.move(pointer.x + 1, pointer.y)],
];
for (const [time, action] of steps) { await at(time); await action(); }
await at(11.6);
capturing = false;
await captureLoop;

// ---- The real popup, reading this tab's live status ----
const popup = await context.newPage();
await popup.setViewportSize({ width: 372, height: 600 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.evaluate(() => {
  const query = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (filter) => {
    if (!(filter && filter.active && filter.currentWindow)) return query(filter);
    const self = await chrome.tabs.getCurrent();
    return (await query({})).filter((tab) => tab.id !== self?.id).slice(0, 1);
  };
});
await popup.waitForFunction(() => /\d/.test(document.body.innerText) && !document.body.innerText.includes('no active tab'));
await popup.waitForTimeout(1200);
const popupFile = path.join(work, 'popup.png');
await popup.screenshot({ path: popupFile, clip: { x: 0, y: 0, width: 372, height: 440 } });
await context.close();

// ---- Offline compositing: caption strip, drawn pointer, popup panel ----
const CAPTIONS = [
  [0, 3.3, 'Chat arrives as usual', 'Real KickFlow build on a local demo page'],
  [3.3, 5.9, 'A moderator deletes a message', 'KickFlow keeps it readable: struck through, labelled, with the moderator'],
  [5.9, 8.1, 'A 10-minute timeout', 'Every message from that user stays, marked with the timeout'],
  [8.1, 11.6, 'Player controls in the native bar', 'Rewind and forward 10 s, speed, back to live, frame capture'],
  [11.6, 15.0, 'The popup', 'Live session numbers and every switch, from the real popup.html'],
];
const END = 15.0;
const compositor = await (await chromium.launch({
  channel: 'chromium', headless: true,
  ...(process.env.DEMO_CHROMIUM ? { executablePath: process.env.DEMO_CHROMIUM } : {}),
})).newPage({ viewport: { width: W, height: H + CAPTION_H } });
await compositor.setContent(`<!doctype html><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H + CAPTION_H}px; background: #0b0d0f; font-family: Inter, system-ui, sans-serif; overflow: hidden; position: relative; }
  #frame { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
  #cap { position: absolute; left: 0; right: 0; top: ${H}px; height: ${CAPTION_H}px; display: flex; align-items: center; gap: 12px;
    padding: 0 16px; border-top: 2px solid #53fc18; color: #eef2ee; }
  #cap b { font-size: 15px; font-weight: 700; color: #53fc18; white-space: nowrap; }
  #cap span { font-size: 13.5px; color: #c9d1cb; }
  #ptr { position: absolute; width: 18px; height: 24px; display: none; filter: drop-shadow(0 1px 2px #000c); }
  #pop { position: absolute; right: 18px; top: 40px; width: 314px; display: none; border-radius: 10px; overflow: hidden;
    border: 1px solid #2b322d; box-shadow: 0 14px 40px #000d; }
  #pop img { display: block; width: 314px; }
  #dim { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: #0007; display: none; }
</style>
<img id="frame"><div id="dim"></div>
<svg id="ptr" viewBox="0 0 18 24"><path d="M1 1 L1 19 L5.5 14.8 L8.6 22 L11.6 20.7 L8.6 13.6 L14.6 13.6 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>
<div id="pop"><img></div>
<div id="cap"><b></b><span></span></div>`);
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
await compositor.evaluate((src) => { document.querySelector('#pop img').src = src; }, dataUrl(popupFile));

const outFrames = Math.round(END * FPS);
let lastRaw = '';
for (let i = 0; i < outFrames; i += 1) {
  const t = i / FPS;
  const raw = [...frames].reverse().find((frame) => frame.t <= Math.min(t, frames.at(-1).t)) ?? frames[0];
  const caption = CAPTIONS.find(([from, to]) => t >= from && t < to) ?? CAPTIONS.at(-1);
  const showPopup = t >= CAPTIONS.at(-1)[0];
  const frameSrc = raw.file === lastRaw ? null : dataUrl(raw.file);
  lastRaw = raw.file;
  await compositor.evaluate(({ frameSrc, caption, pointer, showPopup }) => {
    const frame = document.getElementById('frame');
    if (frameSrc) frame.src = frameSrc;
    document.querySelector('#cap b').textContent = caption[2];
    document.querySelector('#cap span').textContent = caption[3];
    const ptr = document.getElementById('ptr');
    ptr.style.display = pointer && !showPopup ? 'block' : 'none';
    if (pointer) { ptr.style.left = `${pointer.x - 1}px`; ptr.style.top = `${pointer.y - 1}px`; }
    document.getElementById('pop').style.display = showPopup ? 'block' : 'none';
    document.getElementById('dim').style.display = showPopup ? 'block' : 'none';
    return frame.decode?.();
  }, { frameSrc, caption, pointer: raw.pointer, showPopup });
  await compositor.screenshot({ path: path.join(work, `out${String(i).padStart(4, '0')}.png`) });
}
const finalFrame = path.join(work, `out${String(Math.round((CAPTIONS[2][1] - 0.2) * FPS)).padStart(4, '0')}.png`);
await compositor.context().browser().close();
console.log(`captured ${frames.length} raw frames in ${frames.at(-1).t.toFixed(1)} s; wrote ${outFrames} frames at ${FPS} fps`);

const gif = path.join(media, 'kickflow-demo.gif');
run(['-framerate', String(FPS), '-i', path.join(work, 'out%04d.png'), '-filter_complex',
  '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop', '0', gif]);
console.log(`wrote ${path.relative(repo, gif)} (${(statSync(gif).size / 1048576).toFixed(2)} MB)`);
if (stillArg) {
  writeFileSync(path.resolve(stillArg), readFileSync(finalFrame));
  console.log(`wrote ${stillArg}`);
}
rmSync(work, { recursive: true, force: true });
