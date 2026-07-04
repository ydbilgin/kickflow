import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-rewind-controls';
const STEP_SECONDS = 10;

// A media-time boundary (from `seekable`/`buffered`) is only trustworthy if finite and within
// a sane range. Kick's HLS `seekable.end` can report a sentinel (~2^30 ≈ 34 years) or Infinity
// during rebuffering (same root cause as live-catchup.ts's "-1073741819sn" bug). Feeding that
// into a seek target would catapult currentTime to garbage and break playback — the "CANLI"
// (go-live) button was exposed to exactly this. 24h exceeds any real Kick stream / DVR window.
const MAX_REASONABLE_MEDIA_SECONDS = 24 * 60 * 60;

function saneBoundary(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_MEDIA_SECONDS ? value : null;
}

/** Live edge = the furthest BUFFERED (actually playable) position — mirrors Mo'Kick's player,
 * which clamps forward/"go live" to `buffered.end`, never `seekable.end`. Always a sane finite
 * value near currentTime, so it is immune to the bogus `seekable.end` sentinel. */
export function liveEdge(video: HTMLVideoElement): number | null {
  const buffered = video.buffered;
  if (buffered.length === 0) return null;
  return saneBoundary(buffered.end(buffered.length - 1));
}

/** How far BACK a seek may go. Uses the DVR start (`seekable.start(0)` can be > 0) ONLY when
 * the whole seekable range is trustworthy — a bogus `seekable.end` means the range is
 * unreliable, so it falls back to the buffered start (Mo'Kick-style) rather than letting a
 * seek rewind into a range that cannot actually play. Else 0. */
export function seekFloor(video: HTMLVideoElement): number {
  const seekable = video.seekable;
  if (seekable.length > 0) {
    const start = saneBoundary(seekable.start(0));
    const end = saneBoundary(seekable.end(seekable.length - 1));
    if (start !== null && end !== null) return start;
  }
  const buffered = video.buffered;
  if (buffered.length > 0) {
    const start = saneBoundary(buffered.start(0));
    if (start !== null) return start;
  }
  return 0;
}

/** Shared by this file's inline buttons and rewind-hotkeys.ts's arrow keys. Clamps to
 * [seekFloor, liveEdge]: the floor preserves DVR rewind when seekable is trustworthy, while
 * the ceiling is the real playable live edge (`buffered.end`) — never Kick's bogus
 * `seekable.end` — so a forward seek can't catapult past what is actually playable. */
export function clampSeekTarget(video: HTMLVideoElement, delta: number): number {
  const target = video.currentTime + delta;
  const floor = seekFloor(video);
  const edge = liveEdge(video) ?? (Number.isFinite(video.duration) ? video.duration : target);
  const ceil = Math.max(floor, edge); // guard against inversion if edge somehow < floor
  return Math.min(Math.max(target, floor), ceil);
}

function seekBy(video: HTMLVideoElement, delta: number): void {
  try {
    const target = clampSeekTarget(video, delta);
    video.currentTime = target;
    logger.debug('rewind-controls: seek', delta, '-> currentTime', target);
  } catch (error) {
    logger.warn('rewind-controls: seek failed', error);
  }
}

function goLive(video: HTMLVideoElement): void {
  const edge = liveEdge(video);
  if (edge === null) return;
  try {
    video.currentTime = edge;
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
 * Seeks via #video-player's own currentTime, clamped to [seekFloor, liveEdge] — confirmed
 * live to work on Kick (seeking -30s kept the stream playing). The live-edge / go-live target
 * comes from buffered.end, NOT seekable.end: Kick's seekable.end can report a bogus sentinel
 * (~2^30) that would otherwise catapult the seek. No need to touch Kick's own (unconfirmed)
 * native seek-bar DOM at all. */
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

    // Attached directly to the button (not routed through Lifecycle): these buttons get
    // rebuilt by native-bar.ts's ensure() whenever Kick's control bar re-renders and drops
    // them, and a Lifecycle-routed listener would keep the OLD button + closure alive
    // (referenced by a disposer) until the whole session tears down, accumulating across
    // repeated re-renders. A plain listener is GC'd along with the button node itself the
    // moment it's removed (by Kick or by us on remount/teardown) — nothing accumulates.
    rewind.addEventListener('click', () => seekBy(video, -STEP_SECONDS));
    forward.addEventListener('click', () => seekBy(video, STEP_SECONDS));
    live.addEventListener('click', () => goLive(video));

    group.append(rewind, live, forward);
    return group;
  });
}
