import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {captureFilename,cancelLocalClip,closeClipPreview,toggleLocalClip,createLocalClipButton,refreshLocalClipButtons} from '../../src/content/player/local-clip';
import {resetHotkeyBindings,updateHotkeyBinding} from '../../src/content/player/hotkey-registry';
import {captureFrame,captureScreenshot} from '../../src/content/player/screenshot';
import {initRewindHotkeys} from '../../src/content/player/rewind-hotkeys';
import {Lifecycle} from '../../src/content/shared/lifecycle';
import {featureFlags} from '../../src/content/chat/feature-flags';
let active:FakeRecorder,trackStop:ReturnType<typeof vi.fn>;
class FakeRecorder {
 static isTypeSupported=()=>true;
 state='inactive';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(){active=this;}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['video frames'],{type:'video/webm'})});this.onstop?.();}
}
beforeEach(()=>{
 resetHotkeyBindings();
 vi.useFakeTimers();document.body.innerHTML='<div><video id="video-player"></video></div>';
 vi.stubGlobal('MediaRecorder',FakeRecorder);vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:local-preview'),revokeObjectURL:vi.fn()}));
 const video=document.querySelector('video')!;trackStop=vi.fn();
 Object.defineProperties(video,{readyState:{configurable:true,value:4},videoWidth:{configurable:true,value:1920},videoHeight:{configurable:true,value:1080},paused:{configurable:true,value:false},captureStream:{configurable:true,value:()=>({getTracks:()=>[{stop:trackStop}],getVideoTracks:()=>[{}]})}});
});
afterEach(()=>{cancelLocalClip();document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('local clip stops at 15 seconds and presents a preview before any download',()=>{expect(toggleLocalClip()).toBe(true);expect(active.state).toBe('recording');expect(document.querySelector('a[download]')).toBeNull();vi.advanceTimersByTime(15000);expect(active.state).toBe('inactive');expect(trackStop).toHaveBeenCalledOnce();expect(document.querySelector('.kickflow-clip-preview video')).not.toBeNull();expect(document.querySelector('a[download]')?.getAttribute('download')).toMatch(/\.webm$/);});
it('second press stops early and creates one preview',()=>{toggleLocalClip();vi.advanceTimersByTime(1000);toggleLocalClip();expect(document.querySelectorAll('.kickflow-clip-preview')).toHaveLength(1);});
it('capture cancellation on navigation discards data and releases tracks',()=>{toggleLocalClip();cancelLocalClip();vi.advanceTimersByTime(15000);expect(trackStop).toHaveBeenCalledOnce();expect(document.querySelector('.kickflow-clip-preview')).toBeNull();});
it('closing a preview revokes its object URL',()=>{toggleLocalClip();toggleLocalClip();closeClipPreview();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');});
it('unsupported recorder produces visible feedback',()=>{vi.stubGlobal('MediaRecorder',undefined);expect(toggleLocalClip()).toBe(false);expect(document.querySelector('[role=status]')?.textContent).toContain('unavailable');});
it('undecoded or paused playback does not start recording',()=>{Object.defineProperty(document.querySelector('video'),'paused',{value:true});expect(toggleLocalClip()).toBe(false);expect(document.querySelector('[role=status]')).not.toBeNull();});
it('rapid capture names are distinct and filesystem-safe',()=>{vi.setSystemTime(new Date('2026-10-22T10:00:00.123Z'));const one=captureFilename('png'),two=captureFilename('png');expect(one).not.toBe(two);expect(one).not.toMatch(/[:/\\]/);});
it('screenshot with no decoded frame reports failure rather than false success',()=>{Object.defineProperty(document.querySelector('video'),'videoWidth',{value:0});expect(captureScreenshot()).toBe(false);expect(document.querySelector('[role=status]')).not.toBeNull();});
it('tainted screenshot canvas reports an error',()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage(){throw Error('tainted')}} as unknown as CanvasRenderingContext2D);expect(captureFrame(document.querySelector('video')!)).toBe(false);expect(document.querySelector('[role=status]')).not.toBeNull();});
it('holding screenshot key does not enqueue downloads and Shift+S starts local recording',()=>{featureFlags.screenshot=true;const life=new Lifecycle();initRewindHotkeys(life);const ctx=vi.spyOn(HTMLCanvasElement.prototype,'getContext');const repeat=new KeyboardEvent('keydown',{key:'s',repeat:true,bubbles:true,cancelable:true});document.dispatchEvent(repeat);expect(repeat.defaultPrevented).toBe(true);expect(ctx).not.toHaveBeenCalled();document.dispatchEvent(new KeyboardEvent('keydown',{key:'S',shiftKey:true,bubbles:true,cancelable:true}));expect(active.state).toBe('recording');life.dispose();});
it('clip shortcut label follows remapped screenshot binding and removes disabled shortcut',()=>{const button=createLocalClipButton();document.body.append(button);expect(button.title).toContain('Shift+S');updateHotkeyBinding('screenshot',{key:'x'});refreshLocalClipButtons();expect(button.title).toContain('Shift+X');expect(button.getAttribute('aria-label')).toBe(button.title);updateHotkeyBinding('screenshot',{enabled:false});refreshLocalClipButtons();expect(button.title).not.toContain('Shift+');});
