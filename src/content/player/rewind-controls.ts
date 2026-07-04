import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-rewind-controls';
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
    'height:30px',
    'min-width:34px',
    'padding:0 8px',
    'margin:0 2px',
    'border:none',
    'background:transparent',
    'color:inherit',
    'font:inherit',
    'font-weight:600',
    'font-size:12px',
    'line-height:1',
    'cursor:pointer',
    'border-radius:4px',
  ].join(';');
}

/** Injected inline into Kick's native control bar, right after the LIVE button
 * (MoKick-style) — deliberately NOT a floating overlay. A floating overlay was tried
 * first and rejected: it sits outside the bar Kick itself re-renders and manages (e.g.
 * on fullscreen toggle), so it either gets left behind/misplaced or has to duplicate
 * Kick's own re-render handling anyway — inline injection into the real bar (via
 * native-bar.ts) sidesteps that entirely and gets Kick's own hover/fullscreen behavior
 * "for free" since the buttons are genuine bar children.
 *
 * Seeks via #video-player's own currentTime within its seekable (DVR) range — confirmed
 * live to work on Kick (seeking -30s kept the stream playing, seekable reports an
 * effectively unbounded DVR window). No need to touch Kick's own (unconfirmed) native
 * seek-bar DOM at all. */
export function initRewindControls(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('rewind-controls: #video-player not found, skipping');
    return;
  }

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.style.cssText = 'display:inline-flex;align-items:center;';

    const rewind = document.createElement('button');
    rewind.type = 'button';
    rewind.textContent = `⏪ ${STEP_SECONDS}`;
    rewind.title = `${STEP_SECONDS} sn geri`;
    styleButton(rewind);

    const live = document.createElement('button');
    live.type = 'button';
    live.textContent = 'CANLI';
    live.title = 'Canlı yayına dön';
    styleButton(live);

    const forward = document.createElement('button');
    forward.type = 'button';
    forward.textContent = `${STEP_SECONDS} ⏩`;
    forward.title = `${STEP_SECONDS} sn ileri`;
    styleButton(forward);

    lifecycle.addEventListener(rewind, 'click', () => seekBy(video, -STEP_SECONDS));
    lifecycle.addEventListener(forward, 'click', () => seekBy(video, STEP_SECONDS));
    lifecycle.addEventListener(live, 'click', () => goLive(video));

    group.append(rewind, live, forward);
    return group;
  });
}
