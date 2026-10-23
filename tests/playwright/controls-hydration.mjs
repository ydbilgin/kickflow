// Hydration ownership and real pointer geometry for standalone controls, 2026-10-23.
// Run from the repository root: node tests/playwright/controls-hydration.mjs --output=<directory>
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = process.cwd();
const out = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
  ?? 'output/playwright/controls-hydration');
mkdirSync(out, {recursive: true});
const bootstrap = readFileSync(join(root, 'src/content/bootstrap.ts'), 'utf8');
const block = bootstrap.match(/const css = `([\s\S]*?)`;\s*adoptedStyleSheet = installStyleSheet/);
assert.ok(block, 'Use production styles');
const constants = Object.fromEntries([...bootstrap.matchAll(/const (\w+) = '([^']+)'/g)].map(m => [m[1], m[2]]));
for (const name of ['message-highlight', 'user-message-list']) {
  for (const match of readFileSync(join(root, `src/content/chat/${name}.ts`), 'utf8')
    .matchAll(/export const (\w+) = ([\d.]+)\s*;/g)) constants[match[1]] = match[2];
}
constants.CARD_MAX_HEIGHT_INSET_PX = '16';
const css = block[1].replace(/\$\{(\w+)\}/g, (_, key) => {
  assert.notEqual(constants[key], undefined, key);
  return constants[key];
});
const bundle = await build({stdin: {resolveDir: root, loader: 'ts', contents: `
import {Lifecycle} from './src/content/shared/lifecycle';
import {FooterToggleButton} from './src/content/chat/footer-toggle';
import {NavbarSettingsButton} from './src/content/chat/navbar-settings';
window.mountControls = () => {
  const life = new Lifecycle(); window.controlLife = life;
  window.clicks = {footer: 0, navbar: 0, native: 0};
  document.querySelector('#send-message-button').onclick = () => window.clicks.native++;
  new FooterToggleButton(life, {toggle() {window.clicks.footer++;}, isOpen() {return false;}, removedCount() {return 2;}});
  new NavbarSettingsButton(life, {showSettings() {window.clicks.navbar++;}, isOpen() {return false;}});
};`}, bundle: true, format: 'iife', write: false, logLevel: 'silent'});
const browser = await chromium.launch({headless: true,
  executablePath: process.env.KICKFLOW_TEST_CHROMIUM, args: ['--mute-audio']});
const results = [], errors = [];
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const nativeMarkup = () => page.evaluate(() => ({
  footer: document.querySelector('#footer').innerHTML,
  navbar: document.querySelector('nav').innerHTML,
}));
try {
  for (const width of [320, 340, 380, 650, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({width, height: 800});
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#111;color:#eee;font:14px sans-serif}
      .flex{display:flex}.items-center{align-items:center}.gap-2{gap:8px}
      nav{height:64px;display:flex;justify-content:space-between;padding:8px}
      nav>div{min-width:16px}nav button{height:34px}
      #footer{position:absolute;bottom:8px;right:8px;display:flex;align-items:center;gap:8px}
      #footer button{height:30px} ${css}
      </style><nav><div>Kick</div><div></div><div class="flex items-center gap-2"><button>Account</button></div></nav>
      <div id="footer"><button id="native-gear">Settings</button><button id="send-message-button">Send</button></div>`);
    const before = await nativeMarkup();
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.evaluate(() => window.mountControls());
    await settle();
    assert.deepEqual(await nativeMarkup(), before, 'Mount must preserve native SSR children/text');
    const rectangles = {};
    for (const id of ['kickflow-footer-toggle', 'kickflow-navbar-settings', 'native-gear', 'send-message-button']) {
      const locator = page.locator('#' + id);
      const box = await locator.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, id);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 800, id);
      const hit = await locator.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.equal(hit, true, id + ' is reachable');
      rectangles[id] = box;
    }
    assert.ok(rectangles['kickflow-footer-toggle'].x + rectangles['kickflow-footer-toggle'].width
      <= rectangles['native-gear'].x, 'Footer slot keeps native Settings clear');
    await page.locator('#kickflow-footer-toggle').click();
    await page.locator('#kickflow-navbar-settings').click();
    await page.locator('#send-message-button').click();
    assert.deepEqual(await page.evaluate(() => window.clicks), {footer: 1, navbar: 1, native: 1});
    assert.deepEqual(await nativeMarkup(), before);
    await page.screenshot({path: join(out, `controls-${width}.png`)});
    await page.evaluate(() => window.controlLife.dispose());
    assert.equal(await page.locator('#kickflow-footer-toggle, #kickflow-navbar-settings').count(), 0);
    assert.deepEqual(await nativeMarkup(), before, 'Disposal preserves SSR children/text');
    results.push({width, passed: true, rectangles});
  }
  assert.equal(results.length, 8);
  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  results.push({passed: false, error: error.stack});
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({date: new Date().toISOString(), results, errors}, null, 2));
  await browser.close();
}
console.log(JSON.stringify({cases: results.length, passed: results.filter(r => r.passed).length, errors}));
