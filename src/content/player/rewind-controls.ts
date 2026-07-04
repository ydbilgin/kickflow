import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

const OVERLAY_ID = 'kickflow-rewind-controls';
const STEP_SECONDS = 10;

function seekableEnd(video: HTMLVideoElement): number | null {
  if (video.seekable.length === 0) return null;
  return video.seekable.end(video.seekable.length - 1);
}

function seekableStart(video: HTMLVideoElement): number {
  if (video.seekable.length === 0) return 0;
  return video.seekable.start(0);
}

function seekBy(video: HTMLVideoElement, delta: number): void {
  try {
    const end = seekableEnd(video);
    const max = end ?? (Number.isFinite(video.duration) ? video.duration : video.currentTime + delta);
    const target = Math.min(Math.max(video.currentTime + delta, seekableStart(video)), max);
    video.currentTime = target;
    logger.debug('rewind-controls: seek', delta, '-> currentTime', target);
  } catch (error) {
    logger.warn('rewind-controls: seek failed', error);
  }
}

function goLive(video: HTMLVideoElement): void {
  const end = seekableEnd(video);
  if (end === null) return;
  try {
    video.currentTime = end;
    if (video.paused) void video.play().catch(() => undefined);
  } catch (error) {
    logger.warn('rewind-controls: go-live failed', error);
  }
}

function styleButton(button: HTMLButtonElement): void {
  button.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'gap:2px',
    'height:30px',
    'min-width:34px',
    'padding:0 8px',
    'border:none',
    'border-radius:6px',
    'background:rgba(20,20,20,0.72)',
    'color:#fff',
    'font:600 12px/1 system-ui,sans-serif',
    'cursor:pointer',
    'backdrop-filter:blur(2px)',
  ].join(';');
}

/** MoKick-style on-screen rewind/forward + jump-to-live buttons, overlaid on the player.
 * Seeks via #video-player's own currentTime within its seekable (DVR) range — the one
 * confirmed-stable handle. Fails gracefully if seeking isn't permitted on the live stream.
 * Arrow-key seeking (rewind-hotkeys.ts) stays as a keyboard complement. */
export function initRewindControls(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('rewind-controls: #video-player not found, skipping');
    return;
  }

  const anchor = video.parentElement;
  if (!anchor) {
    logger.warn('rewind-controls: video has no parent to anchor overlay, skipping');
    return;
  }

  if (document.getElementById(OVERLAY_ID)) return;

  // The player's parent is position:relative (Kick's `relative aspect-video` wrapper), so
  // an absolutely-positioned overlay pins to the video area without reflowing the layout.
  if (getComputedStyle(anchor).position === 'static') {
    anchor.style.position = 'relative';
  }

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    'position:absolute',
    'left:12px',
    'bottom:64px',
    'z-index:60',
    'display:flex',
    'gap:6px',
    'opacity:0.85',
    'pointer-events:auto',
  ].join(';');

  const rewind = document.createElement('button');
  rewind.type = 'button';
  rewind.textContent = `⏪ ${STEP_SECONDS}`;
  rewind.title = `${STEP_SECONDS} sn geri`;
  styleButton(rewind);

  const live = document.createElement('button');
  live.type = 'button';
  live.textContent = 'CANLI';
  live.title = "Canlı yayına dön";
  styleButton(live);
  live.style.background = 'rgba(233,17,60,0.85)';

  const forward = document.createElement('button');
  forward.type = 'button';
  forward.textContent = `${STEP_SECONDS} ⏩`;
  forward.title = `${STEP_SECONDS} sn ileri`;
  styleButton(forward);

  lifecycle.addEventListener(rewind, 'click', () => seekBy(video, -STEP_SECONDS));
  lifecycle.addEventListener(forward, 'click', () => seekBy(video, STEP_SECONDS));
  lifecycle.addEventListener(live, 'click', () => goLive(video));

  overlay.append(rewind, live, forward);
  anchor.appendChild(overlay);
  lifecycle.add(() => overlay.remove());

  logger.debug('rewind-controls: overlay attached');
}
