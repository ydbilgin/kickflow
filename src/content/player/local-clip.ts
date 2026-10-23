import {findPlayerWrapper,getVideoElement} from '../shared/selectors';
import {t} from '../shared/i18n';
import {formatHotkeyKey,getHotkeyBinding} from './hotkey-registry';

export const CLIP_SECONDS=15;
let recorder:MediaRecorder|null=null, stream:MediaStream|null=null, timeout:number|null=null;
let previewUrl:string|null=null, generation=0;
let lastStamp='',suffix=0;
export function captureFilename(extension:string):string {
  const slug=location.pathname.split('/').filter(Boolean)[0]?.replace(/[^a-z0-9_-]/gi,'')||'kick';
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');suffix=stamp===lastStamp?suffix+1:0;lastStamp=stamp;
  return `${slug}_${stamp}${suffix?`_${suffix}`:''}.${extension}`;
}
export function captureStatus(text:string):void {
  const host=document.fullscreenElement??findPlayerWrapper();if(!host)return;
  host.querySelector('.kickflow-capture-status')?.remove();
  const status=document.createElement('div');status.className='kickflow-capture-status';status.setAttribute('role','status');status.textContent=text;host.append(status);
  window.setTimeout(()=>status.remove(),4000);
}
function clipTitle():string {
  if(recorder)return t('player.clip_stop');
  const binding=getHotkeyBinding('screenshot');
  return t('player.clip_record')+(binding.enabled?` (Shift+${formatHotkeyKey(binding.key)})`:'');
}
export function refreshLocalClipButtons():void {
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-kickflow-local-clip]')) {
    b.textContent=recorder?'■':'●';b.setAttribute('aria-pressed',String(!!recorder));
    b.title=clipTitle();b.setAttribute('aria-label',b.title);
  }
}
function releaseStream():void {stream?.getTracks().forEach(track=>track.stop());stream=null;if(timeout!==null)window.clearTimeout(timeout);timeout=null;}
export function closeClipPreview():void {
  document.querySelector('.kickflow-clip-preview')?.remove();
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;
}
export function cancelLocalClip():void {
  generation++;const active=recorder;recorder=null;
  if(active&&active.state!=='inactive')active.stop();releaseStream();closeClipPreview();refreshLocalClipButtons();
}
function preview(blob:Blob):void {
  closeClipPreview();const host=document.fullscreenElement??findPlayerWrapper();if(!host)return;
  previewUrl=URL.createObjectURL(blob);const url=previewUrl,name=captureFilename('webm');
  const panel=document.createElement('section');panel.className='kickflow-clip-preview';panel.setAttribute('aria-label',t('player.clip_preview'));
  const title=document.createElement('strong');title.textContent=t('player.clip_preview');
  const video=document.createElement('video');video.src=url;video.controls=true;video.muted=true;video.preload='metadata';
  const filename=document.createElement('small');filename.textContent=name;
  const save=document.createElement('a');save.href=url;save.download=name;save.textContent=t('player.clip_save');
  const close=document.createElement('button');close.type='button';close.textContent=t('common.close');close.onclick=closeClipPreview;
  panel.append(title,video,filename,save,close);host.append(panel);captureStatus(t('player.clip_ready'));
}
/** Records the next 15 seconds of the playing picture, locally. No Kick account/API request. */
export function toggleLocalClip():boolean {
  if(recorder){if(recorder.state!=='inactive')recorder.stop();return true;}
  const video=getVideoElement() as (HTMLVideoElement&{captureStream?:()=>MediaStream})|null;
  if(!video||video.readyState<2||!video.videoWidth||video.paused){captureStatus(t('player.capture_no_frame'));return false;}
  if(typeof MediaRecorder==='undefined'||!video.captureStream){captureStatus(t('player.clip_unsupported'));return false;}
  const token=++generation;
  try {
    const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw Error('WebM unsupported');
    stream=video.captureStream();
    if(!stream.getVideoTracks().length)throw Error('No video track');
    const chunks:Blob[]=[];const active=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3_000_000});recorder=active;
    active.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    active.onstop=()=>{
      if(token!==generation)return;
      recorder=null;releaseStream();refreshLocalClipButtons();
      const blob=new Blob(chunks,{type:mime});if(blob.size)preview(blob);else captureStatus(t('player.capture_failed'));
    };
    active.onerror=()=>{cancelLocalClip();captureStatus(t('player.capture_failed'));};
    active.start();timeout=window.setTimeout(()=>{if(active.state!=='inactive')active.stop();},CLIP_SECONDS*1000);
    refreshLocalClipButtons();captureStatus(t('player.clip_recording'));return true;
  }catch {recorder=null;releaseStream();refreshLocalClipButtons();captureStatus(t('player.capture_failed'));return false;}
}
export function createLocalClipButton():HTMLButtonElement {
  const button=document.createElement('button');button.type='button';button.className='kickflow-player-btn';button.setAttribute('data-kickflow-local-clip','');
  button.textContent=recorder?'■':'●';button.title=clipTitle();button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(!!recorder));
  button.addEventListener('click',event=>{event.stopPropagation();toggleLocalClip();});return button;
}
