// Current native 44px clipping shelf, offline/ad transitions, and immutable video geometry.
// Uses production source and styles; no live request is replaced or treated as a live ad.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),out=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'output/player-bughunt');mkdirSync(out,{recursive:true});
const boot=readFileSync(root+'/src/content/bootstrap.ts','utf8');
 const css=boot.match(/const css = `([\s\S]*?)`;\s*adoptedStyleSheet/)?.[1]?.replaceAll('${OVERLAY_ROOT_ID}','kickflow-chat-overlay').replaceAll('${OWN_LIST_ID}','kickflow-message-list').replace(/\$\{[A-Za-z0-9_ ()*+.-]+\}/g,'0');assert.ok(css);
const bundle=await build({stdin:{contents:`import {Lifecycle} from './src/content/shared/lifecycle';import {initControlsVisibility} from './src/content/player/controls-visibility'; const life=new Lifecycle();initControlsVisibility(life);window.dispose=()=>life.dispose();`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',target:'chrome120'});
const browser=await chromium.launch({headless:true,executablePath:process.env.KICKFLOW_TEST_CHROMIUM});const checks=[];
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.setContent(`<style>${css} body{margin:0} #wrapper{position:relative;width:1000px;aspect-ratio:16/9;background:#161c17} #video-player{width:100%;aspect-ratio:16/9} .shelf{position:absolute;bottom:0;height:44px;width:100%;overflow:hidden}.z-controls.bottom-0{position:absolute;bottom:0;display:flex;align-items:center;width:100%;height:80px;box-sizing:border-box}button{height:44px;width:44px}</style><div id="wrapper"><video id="video-player"></video><div class="shelf"><div class="z-controls bottom-0"><button id="pause">II</button><button id="camera">S</button></div></div></div>`);
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'paused',{configurable:true,value:false});});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // Let the browser's initial viewport resize settle before testing the bottom reveal.
 // Production intentionally clears visibility on a resize; the first frame is a setup event.
 await page.mouse.move(500,250);await page.screenshot({path:out+'/fixture-initial.png'});
 const bounds=await page.locator('#wrapper').boundingBox();console.log(JSON.stringify({initial:await page.locator('#wrapper').getAttribute('data-kickflow-controls'),bounds}));
 const videoRect=()=>page.locator('#video-player').evaluate(video=>{const r=video.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
 const before=await videoRect();
 await page.evaluate(()=>{window.trace=[];for(const type of ['pointermove','pointerout','play','pause','visibilitychange'])document.addEventListener(type,e=>window.trace.push({type,x:e.clientX,y:e.clientY,target:e.target.outerHTML?.slice(0,150),related:e.relatedTarget?.outerHTML?.slice(0,150),inside:document.querySelector('#wrapper').contains(e.relatedTarget),state:document.querySelector('#wrapper').dataset.kickflowControls}),true);for(const type of ['resize','blur'])window.addEventListener(type,()=>window.trace.push({type}));});
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height-12);
 console.log(JSON.stringify(await page.evaluate(()=>({trace:window.trace,state:document.querySelector('#wrapper').dataset.kickflowControls,hit:document.elementFromPoint(500,550)?.outerHTML.slice(0,250),rect:document.querySelector('#wrapper').getBoundingClientRect().toJSON()}))));
 await page.screenshot({path:out+'/fixture-pointer.png'});
 await page.waitForFunction(()=>document.querySelector('#wrapper').dataset.kickflowControls==='shown',null,{timeout:5000});
 const shown=await videoRect();assert.deepEqual(shown,before,'video rectangle must not move or resize when controls show');checks.push('video rectangle unchanged after bottom reveal');
 const hit=await page.locator('#camera').evaluate(b=>{const r=b.getBoundingClientRect();return [r.top+4,r.top+r.height/2,r.bottom-4].every(y=>b.contains(document.elementFromPoint(r.x+r.width/2,y)));});
 assert.equal(hit,true,'current 44px native shelf does not clip the customized bar buttons');checks.push('current 44px native shelf does not clip the customized bar buttons');
 await page.screenshot({path:out+'/native-shelf-hit-test.png'});
 await page.mouse.move(500,250);await page.waitForFunction(()=>document.querySelector('#wrapper').dataset.kickflowControls==='hidden');
 const hiddenRect=await videoRect();assert.deepEqual(hiddenRect,before,'video rectangle must not move or resize when controls hide');checks.push('video rectangle unchanged after idle hide');
 const sizes=await page.evaluate(()=>({video:document.querySelector('video').getBoundingClientRect().height,wrapper:document.querySelector('#wrapper').getBoundingClientRect().height,padding:getComputedStyle(document.querySelector('video')).paddingBottom}));
 assert.ok(sizes.video<=600&&sizes.wrapper<=600,'intrinsic video height stays bounded after hiding');assert.equal(sizes.padding,'0px');checks.push('intrinsic video height stays bounded after hiding');
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'paused',{configurable:true,value:true});v.dispatchEvent(new Event('emptied'));document.querySelector('.bottom-0').innerHTML='<button id="retry">Retry</button>';});
 await page.waitForFunction(()=>document.querySelector('#wrapper').dataset.kickflowControls==='shown');assert.equal(await page.locator('#retry').isVisible(),true);checks.push('offline empty media exposes retry control');
 await page.screenshot({path:out+'/offline-retry-shown.png'});
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'paused',{configurable:true,value:false});v.dispatchEvent(new Event('play'));document.querySelector('.bottom-0').innerHTML='<button id="ad-volume">Ad volume</button>';});
 await page.mouse.move(500,550);assert.equal(await page.locator('#ad-volume').isVisible(),true);await page.mouse.move(0,700);await page.waitForFunction(()=>document.querySelector('#wrapper').dataset.kickflowControls==='hidden');checks.push('ad-player bar replacement recovers and hides');
 await page.screenshot({path:out+'/ad-fixture-hidden.png'});
 console.log(JSON.stringify({tests:checks.length,exit:0,checks,sizes,videoRects:{before,shown,hidden:hiddenRect}}));
}finally{await browser.close();}
