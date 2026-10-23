// Geometry gate for Kick's control bar. Renders the REAL player controls and the REAL
// bootstrap.ts stylesheet inside a fixture that reproduces Kick's desktop shell, then sweeps the
// viewport and asserts, at every width, the criteria the VISUAL DESIGN rule demands:
//
//   1. no two sibling controls in the bar intersect;
//   2. every control's rect is inside the bar's rect;
//   3. KickFlow NEVER moves a control Kick owns — every Kick rect is identical to the rect it
//      has when KickFlow's cluster is absent (this is the assertion that catches the defect the
//      ruling documents: below ~1190px our cluster pushed Kick's theatre/fullscreen/cog past an
//      overflow-hidden ancestor, where they cannot be clicked at all);
//   4. every KickFlow control is reachable — mounted in the bar, or a row of the overflow menu;
//   5. fullscreen is the terminal control of Kick's right group.
//
// Every number is read from getBoundingClientRect() of a REAL element. Nothing here imports a
// width, padding or min-width constant that production CSS also owns, so the fixture cannot
// validate itself. The fixture's Kick-side geometry is a dated data snapshot
// (docs/RULING_kick_ui_layout.md §7.2) and the live probe
// `tests/playwright/native-bar-hover-probe.mjs` is what keeps it honest.
//
// Usage: node tests/playwright/player-bar-visual.mjs [--vod] [--flat] [--bright] [--shots] [--output-dir=<directory>] [--report=<file.json>]
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDirArg = process.argv.find((a) => a.startsWith('--output-dir='));
const outDir = outDirArg ? path.resolve(outDirArg.slice('--output-dir='.length)) : path.join(root, 'output', 'playwright');
const recordedPlayer = process.argv.includes('--vod');
// --flat measures the fallback with the cinema strip off; --shots also writes the design moments.
const flatBar = process.argv.includes('--flat');
const designShots = process.argv.includes('--shots');
// --bright puts a near-white picture with burned-in chat text under the bar (his 2026-10-21
// screenshot: a bright stream, "zu..fg: b..." text behind pause and mute) and adds the
// readability assertion (6): every enabled control's glyph keeps 4.5:1 against what is behind it.
const brightPicture = process.argv.includes('--bright');
const entry = path.join(root, 'tests', 'playwright', 'player-bar-harness-entry.ts');
const bundle = path.join(outDir, 'player-bar-harness-entry.js');
const pageFile = path.join(outDir, 'player-bar-harness.html');

// The shell the fixture reproduces, measured live 2026-09-05 (ruling §7.1): a collapsed 56px
// sidebar rail and a 340px chat column flank the player, so bar width = viewport - 396.
const SIDEBAR_PX = 56;
const CHAT_PX = 340;
const SHELL_CHROME_PX = SIDEBAR_PX + CHAT_PX;
// Bar widths the ruling names: 612 (the 1024px viewport floor) up to 1600 in 8px steps.
const SWEEP_MIN_BAR = 612;
const SWEEP_MAX_BAR = 1600;
const SWEEP_STEP = 8;
// Widths the brief names explicitly, in viewport terms. 800 and 960 are below Kick's own
// desktop-bar floor (lg = 1024) and are swept anyway: nothing we do may make them worse.
const NAMED_VIEWPORTS = [1400, 1280, 1190, 1100, 1024, 960, 800];
// A width wide enough that nothing collapses, used for the native-parity assertions.
const PARITY_VIEWPORT = 1600;
const VIEWPORT_HEIGHT = 420;

function sweepViewports() {
  const widths = new Set(NAMED_VIEWPORTS);
  for (let bar = SWEEP_MIN_BAR; bar <= SWEEP_MAX_BAR; bar += SWEEP_STEP) widths.add(bar + SHELL_CHROME_PX);
  widths.add(PARITY_VIEWPORT);
  return [...widths].sort((a, b) => a - b);
}

// A bright stream with burned-in chat. It must be the video's poster, not a wrapper
// background: this makes the overlay readable against picture content. 2026-10-22.
const BURNED_CHAT_SVG = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120">'
  + '<g font-family="Segoe UI, sans-serif" font-size="15" font-weight="700">'
  + '<text x="14" y="62" fill="#3cff70">zu..fg:</text><text x="72" y="62" fill="#ffffff">bu akşam yayın çok iyi</text>'
  + '<text x="14" y="86" fill="#ffd84a">mert_42:</text><text x="84" y="86" fill="#ffffff">KEKW sonunda geldi</text>'
  + '<text x="14" y="110" fill="#7fd0ff">ayse.k:</text><text x="74" y="110" fill="#ffffff">sesi biraz aç</text></g></svg>');
const BRIGHT_PICTURE_CSS = `
  .player-wrapper { background: #0b0e0f !important; }
  .player-wrapper::before { display: none !important; }
`;

async function writeHarnessPage() {
  await fs.mkdir(outDir, { recursive: true });
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'iife', target: ['chrome110'], logLevel: 'silent' });

  const bootstrapSource = await fs.readFile(path.join(root, 'src', 'content', 'bootstrap.ts'), 'utf8');
  const cssMatch = bootstrapSource.match(/const css = `([\s\S]*?)`;\s*adoptedStyleSheet = installStyleSheet/);
  if (!cssMatch) throw new Error('Could not extract KickFlow CSS');
  const barOrderSource = await fs.readFile(path.join(root, 'src', 'content', 'player', 'bar-order.ts'), 'utf8');
  const barOrderMatch = barOrderSource.match(/const BAR_ORDER_RULE = '([^']+)'/);
  if (!barOrderMatch) throw new Error('Could not extract fullscreen bar-order rule');

  // Only the player-control rules matter here, but the placeholder sweep must still run over the
  // whole sheet: an unreplaced ${...} voids its entire declaration block and would silently
  // remove styles from the screenshot (the trap recorded for the other harnesses).
  const contentCss = cssMatch[1]
    .replaceAll('${OVERLAY_ROOT_ID}', 'kickflow-chat-overlay')
    .replaceAll('${PINNED_MESSAGE_HOST_ID}', 'kickflow-pinned-message-host')
    .replaceAll('${OWN_LIST_ID}', 'kickflow-message-list')
    .replace(/\$\{[A-Za-z0-9_ ()*+.-]+\}/g, '0');

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  /* Tailwind preflight, which Kick ships. Without it the fixture's padded bar grows past its
     own container and the "control escapes the bar" assertion can never fire. */
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; background: #0b0b0c; font-family: 'Inter','Segoe UI',system-ui,sans-serif;
    overflow-x: hidden; }
  /* Kick's desktop shell: rail + player column + chat column. min-width:0 is what lets the
     player column actually shrink with the viewport instead of pushing a page scrollbar. */
  .page-shell { display: flex; flex-direction: row; width: 100%; }
  .sidebar { flex: none; width: ${SIDEBAR_PX}px; height: 300px; background: #101114; }
  .chat-column { flex: none; width: ${CHAT_PX}px; height: 300px; background: #0e0f12; }
  .player-column { flex: 1 1 auto; min-width: 0; overflow: hidden; }
  /* Kick's nearest clipping ancestor is an overflow-hidden box (ruling §7.2): a control pushed
     past the bar is not merely ugly there, it is unreachable. The fixture keeps that box. */
  .player-wrapper { position: relative; width: 100%; height: 300px; overflow: hidden; background:
    radial-gradient(60% 70% at 70% 30%, #8a6a3c 0%, rgba(138,106,60,0) 70%),
    radial-gradient(50% 60% at 25% 60%, #2f5a8a 0%, rgba(47,90,138,0) 70%),
    linear-gradient(180deg, #2a3140 0%, #1a1f29 60%, #11141b 100%); }
  /* A bright sponsor band at the bottom of the picture: the case the cinema strip exists for. */
  .player-wrapper::before { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 52px;
    background: linear-gradient(90deg, #e0407a, #f0a020, #40c0e0, #8040e0); opacity: .85; }
  #video-player { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* Kick's real bar: absolute bottom-0 left-0 flex w-full flex-row items-center justify-between */
  .native-bar { position: absolute; bottom: 0; left: 0; display: flex; width: 100%;
    flex-direction: row; align-items: center; justify-content: space-between;
    padding: 0 8px; color: #fff;
    background: linear-gradient(0deg, rgba(0,0,0,.75), rgba(0,0,0,0)); }
  /* flex flex-row items-center gap-2 lg:gap-0 */
  .native-cluster { display: flex; flex-direction: row; align-items: center; gap: 0; }
  /* ButtonIcon size:xl variant:link, plus Kick's own shrink-0 grow-0 on every bar button */
  .native-btn { appearance: none; border: 0; margin: 0; padding: 0; cursor: pointer;
    flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 4px;
    background: transparent; color: #fff; font: inherit; font-size: 14px; font-weight: 600;
    transition: all .14s ease; }
  .native-btn:active { transform: scale(0.95); }
  .native-btn svg { width: 20px; height: 20px; fill: currentColor; display: block; }
  .native-text-btn { width: auto; padding: 0 8px; }
  .native-live { gap: 5px; }
  .native-time { flex: none; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;
    padding: 0 8px; }
  /* Kick's own utility declarations, copied VERBATIM from its stylesheet 2026-08-05. The seek
     bar carries these classes so it inherits Kick's exact geometry and colour; they are placed
     BEFORE our sheet because in production ours is adopted and therefore later in the cascade,
     and a harness that reversed that would hide real overrides. */
  .absolute{position:absolute}
  .-top-7{top:-1.75rem}
  .left-0{left:0}
  .bottom-0{bottom:0}
  .h-5{height:1.25rem}
  .h-1{height:.25rem}
  .h-full{height:100%}
  .w-full{width:100%}
  .size-4{width:1rem;height:1rem}
  .rounded-full{border-radius:9999px}
  .bg-subtle\\/50{background-color:#929ea680}
  .bg-green-500{--tw-bg-opacity:1;background-color:rgba(83, 252, 24, var(--tw-bg-opacity,1))}
  .bg-primary-base{--tw-bg-opacity:1;background-color:rgba(83, 252, 24, var(--tw-bg-opacity,1))}
  ${brightPicture ? BRIGHT_PICTURE_CSS : ''}
  ${contentCss}
</style><style id="kickflow-bar-order">${barOrderMatch[1]}</style></head><body><script>${await fs.readFile(bundle, 'utf8')}</script></body></html>`;

  await fs.writeFile(pageFile, html, 'utf8');
}

/** One in-page measurement. Everything it returns is a real rect; the only inputs are DOM ids. */
const PROBE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const bar = document.querySelector('.native-bar');
  const ourGroups = () => Array.from(bar.querySelectorAll('[id^="kickflow-"]'))
    .filter((el) => !['absolute', 'fixed'].includes(getComputedStyle(el).position)); // 2026-10-21: groups are position:relative (plate), the seek bar absolute
  const kickControls = () => Array.from(bar.querySelectorAll('.native-btn, .native-time'));
  const name = (el) => el.id
    || el.getAttribute('data-testid')
    || (el.classList.contains('native-time') ? 'native-time' : `native:${el.textContent.trim() || 'icon'}`);

  // Kick's controls are keyed by DOM index as well as name: three of them are icon-only with no
  // testid (play, volume, the settings cog), so a name alone is not a unique key and a baseline
  // lookup by name would silently compare the wrong two rects.
  const barRect = rect(bar);
  const video = document.querySelector('#video-player');
  const pictureBottom = video.getBoundingClientRect().bottom - parseFloat(getComputedStyle(video).paddingBottom || '0');
  const tracks = Array.from(bar.querySelectorAll('[role="slider"], .kickflow-seek-bar, [class*="group/seekbar"]'))
    .map(el => el.getBoundingClientRect()).filter(r => r.height > 0);
  const controlsTop = Math.min(bar.getBoundingClientRect().top, ...tracks.map(r => r.top));
  const mounted = ourGroups().map((el) => ({ id: el.id, ...rect(el) }));
  const kick = kickControls().map((el, index) => ({ id: `${index}:${name(el)}`, ...rect(el) }));
  const rightGroup = bar.querySelectorAll('.native-cluster')[1];
  const rightButtons = Array.from(rightGroup.querySelectorAll('button')).map((el) => ({ id: name(el), ...rect(el) }));
  const fullscreen = rect(bar.querySelector('button[data-testid="video-player-fullscreen"]'));

  // Reachability: open the overflow menu, read which controls are rows in it, close it again.
  const overflowButton = document.querySelector('#kickflow-overflow-controls button');
  let menuRows = [];
  let menuButtons = 0;
  if (overflowButton) {
    overflowButton.click();
    const menu = document.querySelector('.kickflow-overflow-menu');
    if (menu) {
      menuRows = Array.from(menu.querySelectorAll('[id^="kickflow-"]')).map((el) => el.id);
      menuButtons = menu.querySelectorAll('button').length;
    }
    overflowButton.click();
  }

  // Baseline: what Kick's own controls measure when KickFlow's cluster is not in the bar at all.
  // display:none removes them from the flow exactly as absence would, and no observer of ours
  // watches attributes on these nodes, so nothing re-plans behind the measurement.
  const hidden = ourGroups();
  for (const el of hidden) el.style.display = 'none';
  void bar.getBoundingClientRect();
  const kickBaseline = kickControls().map((el, index) => ({ id: `${index}:${name(el)}`, ...rect(el) }));
  for (const el of hidden) el.style.display = '';
  void bar.getBoundingClientRect();

  const mountedButtons = mounted.reduce((n, m) => n + document.getElementById(m.id).querySelectorAll('button').length, 0);
  const clusters = Array.from(bar.querySelectorAll('.native-cluster')).map((el) => ({ id: 'cluster', ...rect(el) }));

  return {
    barRect,
    pictureBottom,
    controlsTop,
    mounted,
    kick,
    kickBaseline,
    rightButtons,
    fullscreenRight: fullscreen.right,
    clusters,
    overflowPresent: Boolean(overflowButton),
    menuRows,
    // The overflow button itself is a KickFlow control but not one of the collapsible four.
    mountedButtons: mountedButtons - (overflowButton ? 1 : 0),
    menuButtons,
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
};

const COLLAPSIBLE_IDS = [
  'kickflow-rewind-controls',
  'kickflow-catchup-controls',
  'kickflow-speed-controls',
  'kickflow-screenshot-controls',
];
// Four groups carry six buttons: rewind has two; capture has screenshot and local clip.
const KICKFLOW_BUTTON_COUNT = 6;
const TOLERANCE_PX = 0.5;

function intersect(a, b) {
  return a.x < b.right - TOLERANCE_PX && b.x < a.right - TOLERANCE_PX
    && a.y < b.bottom - TOLERANCE_PX && b.y < a.bottom - TOLERANCE_PX;
}

function overlapSize(a, b) {
  return { width: Math.min(a.right, b.right) - Math.max(a.x, b.x),
    height: Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) };
}

/** Every failure this can report is a criterion from the ruling §3.1 acceptance list. */
function evaluateWidth(width, probe) {
  const failures = [];
  const boxes = [...probe.mounted, ...probe.kick];
  const baselineById = new Map(probe.kickBaseline.map((b) => [b.id, b]));
  const nativeBaselineIntersections = [];
  for (let i = 0; i < probe.kickBaseline.length; i++) {
    for (let j = i + 1; j < probe.kickBaseline.length; j++) {
      const a = probe.kickBaseline[i];
      const b = probe.kickBaseline[j];
      if (intersect(a, b)) nativeBaselineIntersections.push({ controls: [a.id, b.id], ...overlapSize(a, b) });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!intersect(boxes[i], boxes[j])) continue;
      const baselineA = baselineById.get(boxes[i].id);
      const baselineB = baselineById.get(boxes[j].id);
      // Compare native overlap to native overlap at this exact width, just as native escapes
      // below are compared with their measured baseline. Recorded players expose more native
      // chrome: at 800px Kick overlaps its own time/PiP controls even with KickFlow absent.
      // Record that defect; any new/worsened native overlap or ANY KickFlow overlap still fails.
      if (baselineA && baselineB && intersect(baselineA, baselineB)) {
        const original = overlapSize(baselineA, baselineB);
        const current = overlapSize(boxes[i], boxes[j]);
        if (current.width <= original.width + TOLERANCE_PX && current.height <= original.height + TOLERANCE_PX) continue;
      }
      failures.push(`sibling controls intersect: ${boxes[i].id} x ${boxes[j].id}`);
    }
  }

  const escaped = boxes.filter((b) => b.x < probe.barRect.x - TOLERANCE_PX || b.right > probe.barRect.right + TOLERANCE_PX);
  const escapedBaseline = new Set(probe.kickBaseline
    .filter((b) => b.x < probe.barRect.x - TOLERANCE_PX || b.right > probe.barRect.right + TOLERANCE_PX)
    .map((b) => b.id));
  // A Kick control that already escapes with KickFlow absent is Kick's own overflow at a width
  // below its desktop floor, and is not this gate's to fix. Ours escaping is always our defect.
  const ourEscapes = escaped.filter((b) => !escapedBaseline.has(b.id));
  if (ourEscapes.length) {
    failures.push(`control escapes the bar: ${ourEscapes.map((b) => `${b.id}@${Math.round(b.right)}>${Math.round(probe.barRect.right)}`).join(', ')}`);
  }

  const displaced = probe.kick
    .map((b) => ({ id: b.id, delta: Math.round(b.x - (baselineById.get(b.id)?.x ?? b.x)) }))
    .filter((d) => Math.abs(d.delta) > TOLERANCE_PX);
  if (displaced.length) {
    failures.push(`KickFlow displaced Kick's own controls: ${displaced.map((d) => `${d.id}+${d.delta}px`).join(', ')}`);
  }

  const reachable = new Set([...probe.mounted.map((m) => m.id).filter((id) => COLLAPSIBLE_IDS.includes(id)), ...probe.menuRows]);
  const unreachable = COLLAPSIBLE_IDS.filter((id) => !reachable.has(id));
  // Below the width where even the overflow button does not fit, KickFlow mounts nothing at all
  // and the hotkeys are the route (ruling §3.1 degradation). That is a recorded state, not a
  // silent hiding: the sweep reports it per width.
  const mountedNothing = probe.mounted.length === 0;
  if (unreachable.length && !mountedNothing) {
    failures.push(`control hidden with no route: ${unreachable.join(', ')}`);
  }
  const buttonsReachable = probe.mountedButtons + probe.menuButtons;
  if (!mountedNothing && buttonsReachable !== KICKFLOW_BUTTON_COUNT) {
    failures.push(`reachable KickFlow buttons = ${buttonsReachable}, expected ${KICKFLOW_BUTTON_COUNT}`);
  }

  const maxRight = Math.max(...probe.rightButtons.map((b) => b.right));
  if (Math.abs(probe.fullscreenRight - maxRight) > TOLERANCE_PX) {
    failures.push(`fullscreen is not terminal: ${Math.round(probe.fullscreenRight)} vs max ${Math.round(maxRight)}`);
  }

  if (probe.docScrollWidth > probe.innerWidth + TOLERANCE_PX) {
    failures.push(`page grew a horizontal scrollbar: scrollWidth ${probe.docScrollWidth} > ${probe.innerWidth}`);
  }

  return { width, barWidth: Math.round(probe.barRect.w), failures, nativeBaselineIntersections,
    mountedNothing, mounted: probe.mounted.map((m) => m.id), collapsed: probe.menuRows };
}

/** Native-parity checks; they are width-independent, so they run once at a width where the whole
 * cluster is mounted. Kept from the pre-sweep harness — a defect fix may not regress them. */
const PARITY_PROBE = () => {
  const bar = document.querySelector('.native-bar');
  const nativeBox = document.querySelector('.native-btn').getBoundingClientRect().height;
  const ours = Array.from(bar.querySelectorAll('.kickflow-player-btn, .kickflow-speed-btn')).map((el) => ({
    cls: el.className,
    h: el.getBoundingClientRect().height,
    bg: getComputedStyle(el).backgroundColor,
    leftBorder: getComputedStyle(el).borderLeftWidth,
  }));
  const icons = Array.from(bar.querySelectorAll('.kickflow-player-btn:not(.kickflow-player-btn--live) svg')).map((s) => {
    const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), stroke: getComputedStyle(s).stroke };
  });

  // FINAL design 2026-10-18: the behind-live chip is the LAST item of our cluster, so it needs no
  // reserved width; the sweep below runs both with it hidden and with it showing.
  const chipGroup = document.getElementById('kickflow-catchup-controls');
  const widths = { chipGroup: chipGroup ? chipGroup.getBoundingClientRect().width : null };

  const nativeGroups = Array.from(bar.querySelectorAll('.native-cluster')).map((el) => Math.round(el.getBoundingClientRect().width));
  return { nativeBox, ours, icons, widths, nativeGroups };
};

function evaluateParity(parity) {
  const failures = [];
  const wrongHeight = parity.ours.filter((b) => Math.abs(b.h - parity.nativeBox) > TOLERANCE_PX).map((b) => `${b.cls}@${b.h}`);
  if (wrongHeight.length) failures.push(`our control height != native ${parity.nativeBox}px: ${wrongHeight.join(', ')}`);
  const chipped = parity.ours.filter((b) => b.bg !== 'rgba(0, 0, 0, 0)').map((b) => `${b.cls}:${b.bg}`);
  if (chipped.length) failures.push(`our control still paints a resting chip background: ${chipped.join(', ')}`);
  const striped = parity.ours.filter((b) => parseFloat(b.leftBorder) > 0).map((b) => b.cls);
  if (striped.length) failures.push(`side-stripe border present: ${striped.join(', ')}`);
  const badIcons = parity.icons.filter((i) => i.w !== 20 || i.h !== 20 || i.stroke !== 'none');
  if (badIcons.length) failures.push(`icons are not native 20px filled: ${JSON.stringify(badIcons)}`);
  // Parity runs with the fixture 4 s behind live, so the chip must be showing there.
  if (!(parity.widths.chipGroup > 0)) failures.push(`behind-live chip not shown while behind: ${JSON.stringify(parity.widths)}`);
  return failures;
}

await writeHarnessPage();

const reportArg = process.argv.find((a) => a.startsWith('--report='));
const browser = await chromium.launch({
  ...(process.env.KICK_BROWSER_EXECUTABLE ? { executablePath: process.env.KICK_BROWSER_EXECUTABLE } : {}),
  headless: true,
  args: ['--mute-audio', '--window-position=-3000,-3000'],
});
const ctx = await browser.newContext({ viewport: { width: PARITY_VIEWPORT, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 2 });
const tab = await ctx.newPage();
const errors = [];
tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
tab.on('pageerror', (e) => errors.push(String(e)));
const query = [recordedPlayer ? 'vod' : '', flatBar ? 'flat' : ''].filter(Boolean).join('&');
await tab.goto(`file://${pageFile.replaceAll('\\', '/')}${query ? `?${query}` : ''}`);
await tab.waitForSelector('#kickflow-rewind-controls');
if (brightPicture) await tab.evaluate((chat) => {
  const scene = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fff6e8"/><rect y="680" width="1280" height="40" fill="#fff"/><image x="0" y="600" width="420" height="120" href="data:image/svg+xml,' + chat + '"/></svg>';
  document.querySelector('#video-player').poster = 'data:image/svg+xml,' + encodeURIComponent(scene);
}, BURNED_CHAT_SVG);
await tab.waitForTimeout(250);

const parity = await tab.evaluate(PARITY_PROBE);
const parityFailures = evaluateParity(parity);

const wrapper = tab.locator('.player-wrapper');
await wrapper.screenshot({ path: path.join(outDir, 'player-bar-live.png') });
await tab.evaluate(() => window.kickflowShowBehind(true));
await tab.waitForTimeout(150);
await wrapper.screenshot({ path: path.join(outDir, 'player-bar-behind.png') });
await tab.evaluate(() => window.kickflowShowBehind(false));


// At the live edge the chip takes no room at all (FINAL design: "no second LIVE").
const chipAtEdge = await tab.evaluate(() => document.getElementById('kickflow-catchup-controls')?.getBoundingClientRect().width ?? null);
if (chipAtEdge !== 0) parityFailures.push(`behind-live chip takes ${chipAtEdge}px at the live edge, expected 0`);

const results = [];
// Two sweeps: at the live edge (chip hidden) and 4 s behind (chip showing, the wider plate).
for (const behind of [false, true]) {
  await tab.evaluate((on) => window.kickflowShowBehind(on), behind);
  for (const width of sweepViewports()) {
    await tab.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await tab.waitForTimeout(180);
    const probe = await tab.evaluate(PROBE);
    const result = evaluateWidth(width, probe);
    result.behind = behind;
    results.push(result);
    if (NAMED_VIEWPORTS.includes(width)) {
      await wrapper.screenshot({ path: path.join(outDir, `player-bar-${width}${behind ? '-behind' : ''}.png`) });
    }
  }
}
await tab.evaluate(() => window.kickflowShowBehind(false));
await tab.setViewportSize({ width: PARITY_VIEWPORT, height: VIEWPORT_HEIGHT });

// 6. Readability on a bright stream (--bright). For each enabled control in the bar, the glyphs
// are made transparent, the bar is photographed, and the 95th-percentile luminance of what is
// left behind the control (picture + Kick's gradient + whatever we paint) is compared with the
// control's own text colour. WCAG 1.4.3: 4.5:1. Disabled controls (our dim 10 s forward) are
// exempt, as WCAG exempts inactive controls. Nothing here reads a colour our CSS declares for the
// backdrop: the number comes from the pixels.
const readability = [];
{
  const READABILITY_WIDTHS = [1400, 1024];
  for (const behind of [false, true]) {
    await tab.evaluate((on) => window.kickflowShowBehind(on), behind);
    for (const width of READABILITY_WIDTHS) {
      await tab.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await tab.waitForTimeout(200);
      await wrapper.screenshot({ path: path.join(outDir, `${brightPicture ? 'bright' : 'dark'}-player-bar-${width}${behind ? '-behind' : ''}.png`) });
      const controls = await tab.evaluate(() => {
        const bar = document.querySelector('.native-bar');
        const lum = (rgb) => {
          const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => Number(v) / 255)
            .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        return Array.from(bar.querySelectorAll('.native-btn, .native-time, .kickflow-player-btn, .kickflow-speed-btn'))
          .filter((el) => !el.closest('.kickflow-overflow-menu') && !el.classList.contains('kickflow-player-btn--dim'))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0)
          .map(({ el, r }) => ({
            name: el.id || el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent.trim() || el.className.split(' ')[0],
            x: r.x, y: r.y, w: r.width, h: r.height,
            textLum: lum(getComputedStyle(el).color),
          }));
      });
      // Native text buttons transition all properties for 140ms. Disable transitions
      // before hiding glyphs so their fading white pixels cannot count as background.
      const hideGlyphs = await tab.addStyleTag({ content: '.native-bar, .native-bar * { transition: none !important; color: transparent !important; } .native-bar svg * { fill: transparent !important; }' });
      await tab.waitForTimeout(60);
      const png = await tab.screenshot({ type: 'png' });
      const measured = await tab.evaluate(async ({ data, boxes }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx2d = canvas.getContext('2d');
        ctx2d.drawImage(img, 0, 0);
        const scale = img.naturalWidth / window.innerWidth;
        const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return boxes.map((b) => {
          // The glyph area: the middle of the box (a 44px button draws a 20px icon in its centre).
          const x0 = Math.round((b.x + b.w * 0.25) * scale); const x1 = Math.round((b.x + b.w * 0.75) * scale);
          const y0 = Math.round((b.y + b.h * 0.25) * scale); const y1 = Math.round((b.y + b.h * 0.75) * scale);
          const px = ctx2d.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
          const values = [];
          for (let i = 0; i < px.length; i += 4) values.push(0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]));
          values.sort((a, c) => a - c);
          const backLum = values[Math.floor(values.length * 0.95)] ?? 0;
          const ratio = (Math.max(b.textLum, backLum) + 0.05) / (Math.min(b.textLum, backLum) + 0.05);
          return { name: b.name, backLum: Number(backLum.toFixed(3)), ratio: Number(ratio.toFixed(2)) };
        });
      }, { data: png.toString('base64'), boxes: controls });
      await hideGlyphs.evaluate((node) => node.remove());
      const low = measured.filter((m) => m.ratio < 4.5);
      readability.push({ width, behind, measured });
      if (low.length) parityFailures.push(`unreadable on a ${brightPicture ? 'bright' : 'dark'} picture at ${width}px${behind ? ' behind' : ''}: ${low.map((m) => `${m.name} ${m.ratio}:1`).join(', ')}`);
    }
  }
  await tab.evaluate(() => window.kickflowShowBehind(false));
  await tab.setViewportSize({ width: PARITY_VIEWPORT, height: VIEWPORT_HEIGHT });
}

if (designShots) {
  // The design's moments, for a human side by side with FINAL/player-bar.html. Not evidence, and
  // taken AFTER the sweep: the player is made taller here so the speed menu fits in the picture.
  await tab.addStyleTag({ content: '.player-wrapper, .sidebar, .chat-column { height: 470px !important; }' });
  await tab.setViewportSize({ width: PARITY_VIEWPORT, height: 520 });
  await tab.waitForTimeout(250);
  const shot = (name) => wrapper.screenshot({ path: path.join(outDir, `moment-${name}.png`) });
  await shot('live-edge');
  await tab.evaluate(() => window.kickflowShowBehind(true));
  await tab.waitForTimeout(150);
  await shot('behind-catching-up');
  await tab.evaluate(() => window.kickflowShowBehind(false));
  await tab.waitForTimeout(100);
  // As in the sketch: 1.5x picked by hand, menu open again with focus on it.
  await tab.click('#kickflow-speed-controls button');
  await tab.waitForTimeout(120);
  await tab.click('.kickflow-speed-menu__item:nth-child(6)');
  await tab.waitForTimeout(120);
  await tab.click('#kickflow-speed-controls button');
  await tab.waitForTimeout(150);
  await tab.keyboard.press('ArrowLeft');
  await tab.keyboard.press('ArrowRight');
  await shot('speed-menu');
  await tab.keyboard.press('Escape');
  await tab.click('#kickflow-speed-controls button');
  await tab.waitForTimeout(120);
  await tab.click('.kickflow-speed-menu__auto');
  await tab.waitForTimeout(100);
  await tab.evaluate(() => window.kickflowMoment('ripple'));
  await tab.evaluate(() => window.kickflowMoment('toast'));
  await tab.waitForTimeout(160);
  await shot('ripple-and-toast');
  await tab.waitForTimeout(2600);
  await tab.setViewportSize({ width: 1040, height: 520 });
  await tab.waitForTimeout(250);
  const more = await tab.$('#kickflow-overflow-controls button');
  if (more) {
    await more.click();
    await tab.waitForTimeout(150);
  }
  await shot('narrow-more-menu');
  if (more) await more.click();
  await tab.setViewportSize({ width: PARITY_VIEWPORT, height: VIEWPORT_HEIGHT });
}

const failed = results.filter((r) => r.failures.length);
// Where the plan changes: the widths a human would want to look at, and the evidence that the
// collapse order really is screenshot -> speed -> rewind pair -> CANLI.
const transitions = results.filter((r, i) => i === 0
  || r.mounted.join() !== results[i - 1].mounted.join()
  || r.collapsed.join() !== results[i - 1].collapsed.join());
const firstFailure = failed[0];
const report = {
  playerMode: recordedPlayer ? 'recorded-without-native-live' : 'live',
  bar: flatBar ? 'flat (floatingStrip off)' : 'cinema strip (floatingStrip on, the default)',
  shell: { sidebar: SIDEBAR_PX, chat: CHAT_PX },
  nativeGroupWidths: parity.nativeGroups,
  widths: results.length,
  named: results.filter((r) => NAMED_VIEWPORTS.includes(r.width)),
  transitions,
  firstFailingViewport: firstFailure?.width ?? null,
  firstFailure: firstFailure ?? null,
  failingViewports: failed.map((r) => `${r.width}${r.behind ? ' (behind)' : ''}`),
  nativeBaselineOverlapViewports: results.filter((r) => r.nativeBaselineIntersections.length)
    .map((r) => ({ width: r.width, intersections: r.nativeBaselineIntersections })),
  mountsNothingBelow: results.find((r) => !r.mountedNothing)?.width ?? null,
  parityFailures,
  readability,
  consoleErrors: errors,
};
if (reportArg) await fs.writeFile(reportArg.slice('--report='.length), JSON.stringify(report, null, 1), 'utf8');
console.log(JSON.stringify(report, null, 1));

await browser.close();
const total = failed.length + parityFailures.length + errors.length;
if (total > 0) {
  console.error(`FAIL: ${failed.length} of ${results.length} widths, ${parityFailures.length} parity, ${errors.length} console`);
  for (const r of failed.slice(0, 6)) console.error(` - ${r.width}px${r.behind ? ' behind' : ''} (bar ${r.barWidth}px): ${r.failures.join(' | ')}`);
  for (const f of parityFailures) console.error(` - parity: ${f}`);
  for (const e of errors) console.error(` - console: ${e}`);
  process.exit(1);
}
console.log(`player-bar-visual: 0 failures across ${results.length} widths`);
