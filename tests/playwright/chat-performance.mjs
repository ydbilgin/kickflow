// Production chat performance replay, 2026-10-23. Run through low_run.py.
// node tests/playwright/chat-performance.mjs --output=<absolute folder> [--soak-seconds=600]
// Headless RAF cadence is measured; physical 144-520 Hz scanout is not emulated.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = process.cwd();
const option = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const out = path.resolve(option('output', 'output/playwright/chat-performance'));
const soakSeconds = Number(option('soak-seconds', '600'));
await fs.mkdir(out, { recursive: true });
const source = await fs.readFile(path.join(root, 'src/content/bootstrap.ts'), 'utf8');
const block = source.match(/const css = `([\s\S]*?)`;\s*adoptedStyleSheet = installStyleSheet/);
assert.ok(block, 'Use production CSS');
const constants = Object.fromEntries([...source.matchAll(/const (\w+) = '([^']+)'/g)].map(m => [m[1], m[2]]));
for (const file of ['message-highlight', 'user-message-list']) {
  const text = await fs.readFile(path.join(root, `src/content/chat/${file}.ts`), 'utf8');
  for (const match of text.matchAll(/export const (\w+) = ([\d.]+)\s*;/g)) constants[match[1]] = match[2];
}
constants.CARD_MAX_HEIGHT_INSET_PX = '16';
const css = block[1].replace(/\$\{(\w+)\}/g, (_, key) => { assert.notEqual(constants[key], undefined, key); return constants[key]; });
await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import {ChatOverlayMount} from './src/content/chat/overlay-mount';
import {ScrollFollowController, attachScrollFollowHover, trimMessageWindow} from './src/content/chat/dom-window';
import {RenderQueue} from './src/content/chat/render-queue';
import {ChatDomRegistry, ChatIntegrityStore} from './src/content/chat/message-store';
import {UserMessageArchive} from './src/content/chat/user-message-archive';
import {configureUserMessageArchive} from './src/content/chat/archive-session';
import {configureUserCardSession, openUserCard, dismissUserCard} from './src/content/chat/user-card';
import {Lifecycle} from './src/content/shared/lifecycle';
const life=new Lifecycle(), mount=new ChatOverlayMount(life), registry=new ChatDomRegistry();
const store=new ChatIntegrityStore(), archive=new UserMessageArchive(); configureUserMessageArchive(archive);
configureUserCardSession('fixture');
const follow=new ScrollFollowController(mount.ownList), hover=attachScrollFollowHover(mount.ownList,follow);
const queue=new RenderQueue({getContainer:()=>mount.getRenderContainer(),registry,onFlush(rows){
 mount.noteContentAppended(rows); const decision=hover.decide(rows.length);
 trimMessageWindow(mount.ownList,registry,decision.trimCap); follow.observeRows(rows); hover.apply(decision);
}});
let sequence=0, timer, raf, lastFrame=0, phase='idle';
const samples={};
function fresh(){return {frames:[],renders:[],longTasks:[],cardMs:[],messages:0};}
const render=queue['renderNextBatch'].bind(queue);
queue['renderNextBatch']=(...args)=>{const start=performance.now();try{return render(...args);}finally{samples[phase]?.renders.push(performance.now()-start);}};
new PerformanceObserver(list=>{for(const e of list.getEntries())samples[phase]?.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
function frame(now){if(lastFrame&&samples[phase])samples[phase].frames.push(now-lastFrame);lastFrame=now;raf=requestAnimationFrame(frame);}
raf=requestAnimationFrame(frame);
function replay(count){for(let i=0;i<count;i++){
 const n=++sequence, id=n%120+1;
 const message={id:'perf-'+n,chatroomId:1,type:'message',createdAt:new Date(1792742400000+n).toISOString(),preserved:false,
 content:n%3===0?'Message '+n+' [emote:123:Kappa] [emote:456:Wave]':'Message '+n+' with a realistic chat line and https://kick.com/fixture',
 sender:{id,username:'viewer'+id,slug:'viewer'+id,identity:{color:'#53fc18',badges:n%3===0?[{type:'moderator',text:'Moderator'}]:[],
 badgesV2:n%3===0?[{name:'level',level:20,imageUrl:'https://files.kick.com/badges/fixture.png'}]:[]}}};
 store.addMessage(message);archive.add(message);queue.enqueue(message);if(samples[phase])samples[phase].messages++;
}}
mount.setProbing();mount.setPrimaryReady(); replay(200);queue.flushPending();
Object.assign(window,{perfFixture:{mount,follow,queue,archive,start(name,rate){clearInterval(timer);phase=name;samples[name]=fresh();lastFrame=0;
 let credit=0;timer=setInterval(()=>{credit+=rate/10;const count=Math.floor(credit);credit-=count;replay(count);},100);},
 stop(){clearInterval(timer);queue.flushPending();},results(){return samples;},state(){return {rows:mount.ownList.childElementCount,archive:archive.size,
 slots:archive.internalSlotCount,pending:queue.pendingCount,pinned:follow.isPinned,scrollTop:mount.ownList.scrollTop};},
 async card(){const start=performance.now();await openUserCard('viewer1','viewer1',innerWidth-40,250,1);samples[phase].cardMs.push(performance.now()-start);},
 dismiss:dismissUserCard,dispose(){clearInterval(timer);cancelAnimationFrame(raf);queue.dispose();hover.dispose();follow.dispose();life.dispose();configureUserMessageArchive(null);}}});
` }, bundle: true, format: 'iife', outfile: path.join(out, 'harness.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'harness.html'), `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:#171b1d;color:#efeff1;font:14px 'Segoe UI',sans-serif}
#panel{position:absolute;right:0;top:0;width:398px;height:100vh;display:flex;flex-direction:column;background:#0b0e0f}
header{height:42px;flex:none;padding:12px}#body{position:relative;flex:1;min-height:0;overflow:hidden}
#chatroom-messages{height:100%;overflow:auto;position:relative}#footer{flex:none;height:100px;padding:16px;background:#0b0e0f}
#player{position:absolute;left:20px;top:80px;width:480px;height:270px;background:#000}
${css}</style><video id="player" muted autoplay playsinline></video><div id="panel"><header>KickFlow performance fixture</header>
<div id="body"><div id="chatroom-messages">Native fallback chat</div></div><div id="footer">Fixture composer</div></div><script src="harness.js"></script>`);
const browser = await chromium.launch({ headless: true, executablePath: process.env.KICKFLOW_TEST_CHROMIUM,
  args: ['--mute-audio', '--disable-background-networking'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
const errors = [], results = { started: new Date().toISOString(), fixture: { realisticRate: 5, burstRate: 200, soakRate: 100, soakSeconds,
  cadence: 'UNMEASURED until RAF samples', physicalHighRefresh: 'UNMEASURED', nativeIVS: 'UNMEASURED' }, phases: [], memory: [], errors };
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith('file:')) return route.continue();
  if (url.includes('/api/v2/')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(url.includes('/users/') ? { id: 1, username: 'viewer1', slug: 'viewer1', badges: [], created_at: '2020-01-01' } : { followers_count: 42, user: { username: 'viewer1' } }) });
  if (url.startsWith('https://files.kick.com/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#53fc18"/></svg>' });
  return route.abort();
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? null;
function summarize(s) {
  const cadence = quantile(s.frames, .5);
  const maximum = values => values.reduce((max, value) => Math.max(max, value), 0);
  return { messages: s.messages, frames: s.frames.length, frameMs: { p50: cadence, p95: quantile(s.frames, .95), p99: quantile(s.frames, .99), max: maximum(s.frames) },
    missedRafSlots: s.frames.reduce((sum, x) => sum + Math.max(0, Math.round(x / cadence) - 1), 0),
    renderCount: s.renders.length, renderMs: { p50: quantile(s.renders, .5), p95: quantile(s.renders, .95), p99: quantile(s.renders, .99), max: maximum(s.renders) },
    budgetOverruns: Object.fromEntries([144, 240, 360, 520].map(hz => [hz, { budgetMs: 1000 / hz, callbacksOverBudget: s.renders.filter(x => x > 1000 / hz).length }])),
    longTasks: s.longTasks, cardMs: s.cardMs };
}
async function save() { const temp = path.join(out, 'results.json.next'); await fs.writeFile(temp, JSON.stringify(results, null, 2)); await fs.rename(temp, path.join(out, 'results.json')); }
async function phase(name, rate, seconds, scrolling = false) {
  const trace = [];
  cdp.on('Tracing.dataCollected', collect);
  function collect(event) { for (const entry of event.value) if (['Layout', 'UpdateLayoutTree', 'FireAnimationFrame', 'Decode Image', 'DrawFrame', 'DroppedFrame'].includes(entry.name)) trace.push(entry); }
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack', transferMode: 'ReportEvents' });
  const before = await metrics();
  await page.evaluate(({ name, rate, scrolling }) => {
    window.perfFixture.start(name, rate);
    if (scrolling) {
      let up = true;
      window.scrollFixture = setInterval(() => { const list = window.perfFixture.mount.ownList;
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: up ? -120 : 120 })); list.scrollTop += up ? -120 : 120;
        if (list.scrollTop < 100) up = false; if (list.scrollTop > list.scrollHeight - list.clientHeight - 150) up = true;
      }, 100);
      window.cardFixture = setInterval(() => { void window.perfFixture.card().then(() => window.perfFixture.dismiss()); }, 2000);
    }
  }, { name, rate, scrolling });
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => { clearInterval(window.scrollFixture); clearInterval(window.cardFixture); window.perfFixture.stop(); });
  await page.waitForTimeout(300);
  const after = await metrics();
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await complete;
  cdp.off('Tracing.dataCollected', collect);
  const samples = await page.evaluate(name => window.perfFixture.results()[name], name);
  const summary = summarize(samples);
  assert.ok(summary.messages > 0 && summary.frames > 0 && summary.renderCount > 0, 'Zero-case measurement fails');
  results.phases.push({ name, rate, seconds, ...summary, state: await page.evaluate(() => window.perfFixture.state()),
    cdpDelta: Object.fromEntries(['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration', 'TaskDuration', 'ScriptDuration'].map(key => [key, after[key] - before[key]])),
    trace: { layouts: trace.filter(x => x.name === 'Layout').length, layoutsWithStacks: trace.filter(x => x.name === 'Layout' && x.args?.beginData?.stackTrace?.length).length,
      droppedFrames: trace.filter(x => x.name === 'DroppedFrame').length } });
  await fs.writeFile(path.join(out, `${name}-trace.json`), JSON.stringify({ traceEvents: trace }));
  await save(); console.log(JSON.stringify(results.phases.at(-1)));
}
try {
  await page.goto(pathToFileURL(path.join(out, 'harness.html')).href);
  await page.waitForFunction(() => window.perfFixture?.mount.state === 'active' && window.perfFixture.queue.pendingCount === 0);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); let n = 0;
    window.videoFixture = setInterval(() => { ctx.fillStyle = n++ % 2 ? '#263f29' : '#29482f'; ctx.fillRect(0, 0, 320, 180); }, 1000 / 30);
    document.getElementById('player').srcObject = canvas.captureStream(30);
  });
  await phase('realistic', 5, 20);
  await phase('burst', 200, 20);
  await phase('scroll-cards-player', 30, 20, true);
  results.video = await page.evaluate(() => { const video = document.getElementById('player'); const quality = video.getVideoPlaybackQuality();
    return { synthetic: true, currentTime: video.currentTime, totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames }; });
  await page.screenshot({ path: path.join(out, 'fixture.png') });
  if (soakSeconds > 0) {
    await page.evaluate(() => { window.perfFixture.follow.scrollToBottom(); window.perfFixture.start('soak', 100); });
    for (let elapsed = 0; elapsed <= soakSeconds; elapsed += 60) {
      if (elapsed) await page.waitForTimeout(Math.min(60, soakSeconds - elapsed + 60) * 1000);
      await cdp.send('HeapProfiler.collectGarbage');
      const m = await metrics();
      results.memory.push({ seconds: elapsed, clock: new Date().toISOString(), retainedHeapBytes: m.JSHeapUsedSize, ...await page.evaluate(() => window.perfFixture.state()) });
      await save();
    }
    await page.evaluate(() => window.perfFixture.stop());
    results.soak = summarize(await page.evaluate(() => window.perfFixture.results().soak));
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  results.exit = 0;
} catch (error) { results.exit = 1; results.failure = error.stack; process.exitCode = 1; }
finally { results.finished = new Date().toISOString(); await save(); await browser.close(); }
