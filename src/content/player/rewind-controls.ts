import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { dispatchManualSeek, setDvrSuspended } from './player-state';
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

/** How far BACK a seek may go. Kick reports `seekable.start(0) === 0` even when that is
 * only a bogus sentinel below the playable buffer; `buffered.start(0)` is the real floor
 * that keeps rewind targets inside media the player can actually decode. */
export function seekFloor(video: HTMLVideoElement): number {
  const buffered = video.buffered;
  if (buffered.length > 0) {
    const start = saneBoundary(buffered.start(0));
    if (start !== null) return start;
  }
  const seekable = video.seekable;
  if (seekable.length > 0) {
    const start = saneBoundary(seekable.start(0));
    if (start !== null) return start;
  }
  return 0;
}

/** Shared by this file's inline buttons and rewind-hotkeys.ts's arrow keys. Clamps to
 * [seekFloor, liveEdge]: both ends prefer the playable buffered range, avoiding Kick's
 * bogus `seekable` sentinels so seeks can't catapult outside media the player can decode. */
export function clampSeekTarget(video: HTMLVideoElement, delta: number): number {
  const target = video.currentTime + delta;
  const floor = seekFloor(video);
  const edge = liveEdge(video) ?? target;
  const ceil = Math.max(floor, edge); // guard against inversion if edge somehow < floor
  return Math.min(Math.max(target, floor), ceil);
}

function seekBy(video: HTMLVideoElement, delta: number): void {
  try {
    const target = clampSeekTarget(video, delta);
    video.currentTime = target;
    dispatchManualSeek();
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
    setDvrSuspended(false);
    if (video.paused) void video.play().catch(() => undefined);
  } catch (error) {
    logger.warn('rewind-controls: go-live failed', error);
  }
}

// Stroke-based double-chevron « / » glyphs (styled via CSS: fill:none; stroke:currentColor) —
// a clean "<<" / ">>" look, a native-looking alternative to the multicolor ⏪/⏩ emoji which
// render inconsistently across platforms. Static, trusted markup (no interpolation) → innerHTML
// is safe here.
const ICON_REWIND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/></svg>';
const ICON_FORWARD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/></svg>';

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
    group.className = 'kickflow-player-group';

    const seekPill = document.createElement('span');
    seekPill.className = 'kickflow-seek-pill';

    const rewind = document.createElement('button');
    rewind.type = 'button';
    rewind.className = 'kickflow-player-btn kickflow-seek-pill__btn';
    rewind.innerHTML = `${ICON_REWIND}<span>${STEP_SECONDS}</span>`;
    rewind.title = `${STEP_SECONDS} sn geri (←)`;
    rewind.setAttribute('aria-label', `${STEP_SECONDS} saniye geri sar`);

    const live = document.createElement('button');
    live.type = 'button';
    live.className = 'kickflow-player-btn kickflow-player-btn--live';
    live.textContent = 'CANLI';
    live.title = 'Canlı yayına dön';
    live.setAttribute('aria-label', 'Canlı yayına dön');

    const forward = document.createElement('button');
    forward.type = 'button';
    forward.className = 'kickflow-player-btn kickflow-seek-pill__btn';
    forward.innerHTML = `<span>${STEP_SECONDS}</span>${ICON_FORWARD}`;
    forward.title = `${STEP_SECONDS} sn ileri (→)`;
    forward.setAttribute('aria-label', `${STEP_SECONDS} saniye ileri sar`);

    // Attached directly to the button (not routed through Lifecycle): these buttons get
    // rebuilt by native-bar.ts's ensure() whenever Kick's control bar re-renders and drops
    // them, and a Lifecycle-routed listener would keep the OLD button + closure alive
    // (referenced by a disposer) until the whole session tears down, accumulating across
    // repeated re-renders. A plain listener is GC'd along with the button node itself the
    // moment it's removed (by Kick or by us on remount/teardown) — nothing accumulates.
    rewind.addEventListener('click', () => seekBy(video, -STEP_SECONDS));
    forward.addEventListener('click', () => seekBy(video, STEP_SECONDS));
    live.addEventListener('click', () => goLive(video));

    seekPill.append(rewind, forward);
    group.append(seekPill, live);
    return group;
  });
}
