import {findPlayerWrapper,getVideoElement} from '../shared/selectors';
import {t,type MessageKey} from '../shared/i18n';
import {formatHotkeyKey,getHotkeyBinding} from './hotkey-registry';
import {CLIP_SECONDS,createCaptureNamer,createLocalClip,showCaptureStatus,type LocalClipTextKey} from './bar-shared.js';

// The recorder, the preview and the status line live in bar-shared.js (2026-10-29) so a
// fallback player bar records the same 15 s clip. This module binds them to Kick's player,
// KickFlow's words and the screenshot hotkey.
export {CLIP_SECONDS};

const nameCapture=createCaptureNamer();
export function captureFilename(extension:string):string {return nameCapture(location.pathname,extension);}
const playerHost=():Element|null=>document.fullscreenElement??findPlayerWrapper();
export function captureStatus(text:string):void {showCaptureStatus(playerHost(),text);}
function clipTitle(recording:boolean):string {
  if(recording)return t('player.clip_stop');
  const binding=getHotkeyBinding('screenshot');
  return t('player.clip_record')+(binding.enabled?` (Shift+${formatHotkeyKey(binding.key)})`:'');
}
const WORDS:Record<LocalClipTextKey,MessageKey>={
  clip_stop:'player.clip_stop',clip_record:'player.clip_record',clip_preview:'player.clip_preview',
  clip_save:'player.clip_save',clip_ready:'player.clip_ready',clip_recording:'player.clip_recording',
  clip_unsupported:'player.clip_unsupported',capture_no_frame:'player.capture_no_frame',
  capture_failed:'player.capture_failed',close:'common.close',
};
const words=(key:LocalClipTextKey):string=>t(WORDS[key]);
const clip=createLocalClip({
  getVideo:()=>getVideoElement() as (HTMLVideoElement&{captureStream?:()=>MediaStream})|null,
  getHost:playerHost,
  filename:captureFilename,
  text:words,
  title:clipTitle,
});
export function refreshLocalClipButtons():void {clip.refreshButtons();}
export function closeClipPreview():void {clip.closePreview();}
export function cancelLocalClip():void {clip.cancel();}
/** Records the next 15 seconds of the playing picture, locally. No Kick account/API request. */
export function toggleLocalClip():boolean {return clip.toggle();}
export function createLocalClipButton():HTMLButtonElement {return clip.createButton();}
