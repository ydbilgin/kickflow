// Local-only geometry regression gate. Uses production mount, queue, scroll controller and CSS.
// Native shell: read-only kick.com/serhatarslan DOM observation, 2026-10-22.
// Run from the repo: node tests/playwright/chat-layout.mjs --output=<absolute directory>
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = process.cwd();
const out = path.resolve(process.argv.find(x => x.startsWith('--output='))?.slice(9) ?? 'output/playwright/chat-layout');
await fs.mkdir(out, { recursive: true });
const source = await fs.readFile(path.join(root, 'src/content/bootstrap.ts'), 'utf8');
const block = source.match(/const css = `([\s\S]*?)`;\s*adoptedStyleSheet = installStyleSheet/);
assert.ok(block, 'Production CSS must be present');
const constants = Object.fromEntries([...source.matchAll(/const (\w+) = '([^']+)'/g)].map(m => [m[1], m[2]]));
const css = block[1].replace(/\$\{(\w+)\}/g, (_, key) => {
  // Match the existing player geometry gate: unrelated highlight alpha tokens are zeroed.
  return constants[key] ?? '0';
});
await build({ entryPoints: [path.join(root, 'tests/playwright/chat-layout-harness-entry.ts')],
  bundle: true, format: 'iife', outfile: path.join(out, 'harness.js'), logLevel: 'silent' });
const nativeHoverBundle = await build({
  stdin: { contents: `import {Lifecycle} from './src/content/shared/lifecycle';
    import {ChatIntegrityStore} from './src/content/chat/message-store';
    import {NativeChatAugmenter} from './src/content/chat/native-augment';
    const lifecycle = new Lifecycle(); new NativeChatAugmenter(lifecycle, new ChatIntegrityStore());
    window.disposeNativeHoverFixture = () => lifecycle.dispose();`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'iife', write: false, target: 'chrome120', logLevel: 'silent',
});
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#171b1d;color:#efeff1;font:14px 'Segoe UI',sans-serif}
#panel{position:absolute;right:0;top:0;width:398px;height:100vh;display:flex;flex-direction:column;background:#0b0e0f}
header{height:42px;flex:none;padding:12px;text-align:center;border-bottom:1px solid #303536}
#body{position:relative;flex:1;min-height:0;overflow:hidden}
#chatroom-messages{height:100%;overflow:auto;position:relative}
.absolute{position:absolute}.w-full{width:100%}#events{top:0;z-index:40;background:#28312a}
#footer{flex:none;background:#0b0e0f;position:relative;z-index:40;padding:8px 16px}
#slow,#emotes,#reply{height:0;overflow:hidden}#input{height:50px;border:2px solid #efeff1;border-radius:5px;padding:12px}
#send-message-button{display:block;margin:8px 0 0 auto;background:#53fc18;border:0;padding:8px 20px;border-radius:4px}
${css}</style><div id="panel"><header>KickFlow chat layout harness</header><div id="body"><div id="events" class="absolute w-full"></div><div id="chatroom-messages"><div>Native fallback chat</div></div></div><div id="footer"><div id="reply">Replying to laureth</div><div id="slow">◴ Yavaş mod aktif</div><div id="emotes">🟢 🐸 🟢 🐸 🟢 🐸 🟢 🐸 🟢</div><div id="input" contenteditable="true">Bir mesaj gönderin</div><button id="send-message-button">Gönder</button></div></div><script src="harness.js"></script>`;
await fs.writeFile(path.join(out, 'harness.html'), html);
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.KICKFLOW_TEST_CHROMIUM, args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 650, height: 800 } });
const failures = [], tests = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function settle() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function fresh() {
  await page.goto(pathToFileURL(path.join(out, 'harness.html')).href);
  await page.waitForFunction(() => document.querySelectorAll('#kickflow-message-list .kickflow-message').length === 61);
  await settle();
}
async function geometry() {
  return page.evaluate(() => {
    const list = document.getElementById('kickflow-message-list');
    const last = list.querySelector('.kickflow-message:last-child');
    return { bottom: last.getBoundingClientRect().bottom, top: last.getBoundingClientRect().top,
      listBottom: list.getBoundingClientRect().bottom, listTop: list.getBoundingClientRect().top,
      footerTop: document.getElementById('footer').getBoundingClientRect().top,
      gap: list.scrollHeight - list.clientHeight - list.scrollTop,
      pinned: window.chatHarness.follow.isPinned, scrollTop: list.scrollTop };
  });
}
async function visible() {
  const g = await geometry();
  assert.ok(g.bottom <= Math.min(g.listBottom, g.footerTop) + 1 && g.top >= g.listTop - 1, JSON.stringify(g));
  assert.ok(g.gap <= 1, `Not at bottom: ${JSON.stringify(g)}`);
  return g;
}
async function nativeHoverFixture() {
  await page.setViewportSize({ width: 650, height: 800 });
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><style>
    body{margin:0;background:#0b0e0f;color:#efeff1;font:14px Arial}
    #chatroom-messages{position:absolute;top:100px;left:100px;width:400px;height:500px;overflow:hidden}
    .no-scrollbar{height:100%;overflow:auto;position:relative}
    [data-index]{position:absolute;left:0;right:0;height:40px}
    .group{position:relative;height:40px;padding:0 8px}
    .w-full{height:40px;width:100%;border-radius:8px;padding:10px;box-sizing:border-box}
    .group:hover>.w-full{background-color:rgb(37,40,44)}
    .action{position:absolute;right:0;bottom:0;display:none;width:36px;height:36px;background:#383b42}
    .group:hover>.action{display:flex}
    .action button{width:36px;height:36px;background:transparent;color:white;border:0;cursor:pointer}
    #reply-card{position:absolute;top:620px;left:100px;background:#2b3032;padding:10px}
    ${css}
  </style><div id="chatroom-messages"><div class="no-scrollbar">
    <div data-index="1" id="row-a" style="top:100px"><div class="group"><div class="w-full"><button class="username">alpha</button>: first message</div><div class="action"><button aria-label="Yanıtla"><svg data-ds-icon="ArrowCurveLeft"></svg></button></div></div></div>
    <div data-index="2" id="row-b" style="top:140px"><div class="group"><div class="w-full"><button class="username">beta</button>: incoming message</div><div class="action"><button aria-label="Yanıtla"><svg data-ds-icon="ArrowCurveLeft"></svg></button></div></div></div>
  </div></div><div id="reply-card" hidden>Replying to beta <button id="cancel-reply">Cancel</button><button id="send-reply">Send</button></div><script>
    for(const button of document.querySelectorAll('.action button'))button.addEventListener('click',()=>{document.getElementById('reply-card').hidden=false});
    for(const id of ['cancel-reply','send-reply'])document.getElementById(id).addEventListener('click',()=>{document.getElementById('reply-card').hidden=true});
  </script>`);
  await page.addScriptTag({ content: nativeHoverBundle.outputFiles[0].text });
  await settle();
}
async function test(name, fn) {
  try { await fresh(); const measurements = await fn(); tests.push({ name, status: 'PASS', measurements }); }
  catch (error) { tests.push({ name, status: 'FAIL', error: error.message }); failures.push(name); }
}
try {
  await test('slow mode and emote row leave newest message fully visible', async () => {
    await page.evaluate(() => { document.getElementById('slow').style.height = '24px'; document.getElementById('emotes').style.height = '28px'; });
    await settle();
    await page.screenshot({ path: path.join(out, 'slow-mode-emotes.png') });
    return visible();
  });
  await test('reply insertion and removal preserve bottom pin', async () => {
    for (const height of ['64px', '0px', '120px']) {
      await page.evaluate(height => { document.getElementById('reply').style.height = height; }, height);
      await settle(); await visible();
    }
  });
  await test('pinned native event stack and poll resize preserve visible newest row', async () => {
    for (const height of ['85px', '165px', '0px']) {
      await page.evaluate(height => { const e = document.getElementById('events'); e.style.height = height; e.textContent = height === '0px' ? '' : 'Native pinned message / poll'; }, height);
      await settle(); await visible();
    }
  });
  await test('panel height and width changes preserve bottom pin', async () => {
    for (const viewport of [{width:650,height:620},{width:450,height:900},{width:650,height:800}]) {
      await page.setViewportSize(viewport); await settle(); await visible();
    }
    await page.evaluate(() => { document.getElementById('panel').style.width = '270px'; });
    await settle(); return visible();
  });
  await test('late image expansion and collapse preserve bottom pin', async () => {
    await page.evaluate(() => {
      const img = new Image(); img.id = 'late-image'; img.style.display = 'block';
      document.querySelector('#kickflow-message-list .kickflow-message:last-child').append(img);
      img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="180"><rect width="200" height="180" fill="green"/></svg>');
    });
    await page.waitForFunction(() => document.getElementById('late-image').naturalHeight === 180);
    await settle(); await visible();
    await page.evaluate(() => document.getElementById('late-image').remove());
    await settle(); return visible();
  });
  await test('new message does not pull a reader who scrolled up', async () => {
    await page.evaluate(() => { const l = document.getElementById('kickflow-message-list'); l.scrollTop -= 300; });
    await settle(); const before = await geometry(); assert.equal(before.pinned, false);
    await page.evaluate(() => { window.chatHarness.append('New incoming message while paused'); document.getElementById('reply').style.height = '64px'; });
    await page.waitForFunction(() => document.querySelectorAll('#kickflow-message-list .kickflow-message').length === 62);
    await settle(); const after = await geometry();
    assert.equal(after.pinned, false); assert.equal(after.scrollTop, before.scrollTop);
    await page.screenshot({ path: path.join(out, 'paused-reader.png') });
    return { before, after };
  });
  await test('incoming messages follow when pinned', async () => {
    await page.evaluate(() => window.chatHarness.append('Newest incoming message'));
    await page.waitForFunction(() => document.querySelectorAll('#kickflow-message-list .kickflow-message').length === 62);
    await settle(); return visible();
  });
  await test('popup content has a bounded reachable scroll area at 600px', async () => {
    await page.setViewportSize({ width: 372, height: 600 });
    // Suppress extension-only scripts, preserving the exact production HTML and CSS.
    const popup = (await fs.readFile(path.join(root, 'popup.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '');
    await page.setContent(popup);
    const before = await page.evaluate(() => ({ bodyHeight: document.body.getBoundingClientRect().height,
      scrollHeight: document.body.scrollHeight, viewport: innerHeight }));
    await page.screenshot({ path: path.join(out, 'popup-top.png') });
    await page.evaluate(() => { document.body.scrollTop = document.body.scrollHeight; });
    const lastBottom = await page.locator('.hint').evaluate(e => e.getBoundingClientRect().bottom);
    await page.screenshot({ path: path.join(out, 'popup-bottom.png') });
    assert.ok(before.bodyHeight <= 600, JSON.stringify(before));
    assert.ok(lastBottom <= 600, `Last setting remains clipped at ${lastBottom}`);
    return { ...before, lastBottom };
  });
  await test('paused safety-cap trimming preserves the visible row and its pixel offset', async () => {
    await page.evaluate(() => {
      const list = window.chatHarness.mount.ownList;
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
      list.scrollTop = 0;
    });
    await settle();
    assert.equal(await page.evaluate(() => window.chatHarness.follow.isPinned), false);
    await page.evaluate(() => { for (let i = 0; i < 439; i++) window.chatHarness.append('Paused history ' + i); });
    await page.waitForFunction(() => window.chatHarness.mount.ownList.childElementCount === 500);
    const before = await page.evaluate(() => {
      const list = window.chatHarness.mount.ownList, row = list.children[300];
      row.id = 'reading-anchor'; list.scrollTop = row.offsetTop;
      return { top: row.getBoundingClientRect().top, scrollTop: list.scrollTop };
    });
    await settle();
    await page.evaluate(() => { for (let i = 0; i < 200; i++) window.chatHarness.append('Incoming capped burst ' + i); });
    await page.waitForFunction(() => window.chatHarness.mount.ownList.childElementCount === 600);
    await settle();
    const after = await page.evaluate(() => ({ top: document.getElementById('reading-anchor').getBoundingClientRect().top,
      scrollTop: window.chatHarness.mount.ownList.scrollTop, pinned: window.chatHarness.follow.isPinned,
      rows: window.chatHarness.mount.ownList.childElementCount }));
    assert.equal(after.pinned, false);
    assert.equal(after.rows, 600);
    assert.ok(Math.abs(after.top - before.top) <= 1, JSON.stringify({ before, after }));
    await page.screenshot({ path: path.join(out, 'paused-safety-cap.png') });
    return { before, after };
  });
  await test('native reply follows the actual row when new messages shift beneath a stationary pointer', async () => {
    await nativeHoverFixture();
    await page.mouse.move(250, 220);
    assert.equal(await page.locator('#row-a').getAttribute('data-kickflow-pointer-row'), '');
    assert.equal(await page.locator('#row-a .action').isVisible(), true);
    await page.screenshot({ path: path.join(out, 'native-reply-before-shift.png') });
    await page.evaluate(() => {
      document.getElementById('row-a').style.top = '60px';
      document.getElementById('row-b').style.top = '100px';
    });
    await settle();
    const state = await page.evaluate(() => ({
      hit: document.elementFromPoint(250, 220)?.closest('[data-index]')?.id,
      aMarked: document.getElementById('row-a').hasAttribute('data-kickflow-pointer-row'),
      bMarked: document.getElementById('row-b').hasAttribute('data-kickflow-pointer-row'),
      aAction: getComputedStyle(document.querySelector('#row-a .action')).display,
      bAction: getComputedStyle(document.querySelector('#row-b .action')).display,
      aBackground: getComputedStyle(document.querySelector('#row-a .w-full')).backgroundColor,
      bBackground: getComputedStyle(document.querySelector('#row-b .w-full')).backgroundColor,
    }));
    assert.equal(state.hit, 'row-b', JSON.stringify(state));
    assert.equal(state.aMarked, false, JSON.stringify(state));
    assert.equal(state.bMarked, true, JSON.stringify(state));
    assert.equal(state.aAction, 'none', JSON.stringify(state));
    assert.equal(state.bAction, 'flex', JSON.stringify(state));
    assert.equal(state.aBackground, 'rgba(0, 0, 0, 0)', JSON.stringify(state));
    assert.notEqual(state.bBackground, 'rgba(0, 0, 0, 0)', JSON.stringify(state));
    await page.screenshot({ path: path.join(out, 'native-reply-after-shift.png') });
    await page.locator('#row-b .action button').click();
    assert.equal(await page.locator('#reply-card').isVisible(), true);
    await page.locator('#cancel-reply').click();
    assert.equal(await page.locator('#reply-card').isVisible(), false);
    await page.mouse.move(250, 220);
    await page.locator('#row-b .action button').click();
    assert.equal(await page.locator('#reply-card').isVisible(), true);
    await page.locator('#send-reply').click();
    assert.equal(await page.locator('#reply-card').isVisible(), false);
    assert.equal(await page.locator('#row-b').getAttribute('data-kickflow-pointer-row'), null);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('#row-b .action').isVisible(), false);
    return state;
  });
  await test('native reply keyboard focus survives while Escape and blur clear the marked row', async () => {
    await nativeHoverFixture();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.closest('[data-index]')?.id);
    assert.equal(focused, 'row-a');
    assert.equal(await page.locator('#row-a .action').isVisible(), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.querySelector('svg[data-ds-icon="ArrowCurveLeft"]') !== null), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#row-a .action').isVisible(), false);
    await page.mouse.move(250, 220);
    assert.equal(await page.locator('#row-a .action').isVisible(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.locator('#row-a .action').isVisible(), false);
    return { focused };
  });
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ total: tests.length, passed: tests.length - failures.length, failed: failures.length, tests, errors }, null, 2));
  for (const t of tests) console.log(`${t.status}: ${t.name}${t.error ? `: ${t.error}` : ''}`);
  console.log(`Tests: ${tests.length}, passed: ${tests.length - failures.length}, failed: ${failures.length}`);
}
process.exitCode = failures.length ? 1 : 0;
