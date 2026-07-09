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

interface MediaRange {
  start: number;
  end: number;
}

function saneRanges(ranges: TimeRanges): MediaRange[] {
  const result: MediaRange[] = [];
  for (let index = 0; index < ranges.length; index++) {
    const start = saneBoundary(ranges.start(index));
    const end = saneBoundary(ranges.end(index));
    if (start === null || end === null || end < start) continue;
    result.push({ start, end });
  }
  return result;
}

function firstFiniteStartWithFiniteEnd(ranges: TimeRanges): number | null {
  for (let index = 0; index < ranges.length; index++) {
    const start = saneBoundary(ranges.start(index));
    const end = saneBoundary(ranges.end(index));
    if (start !== null && end !== null) return start;
  }
  return null;
}

/** Live edge = the furthest BUFFERED (actually playable) position — mirrors Mo'Kick's player,
 * which clamps forward/"go live" to `buffered.end`, never `seekable.end`. Always a sane finite
 * value near currentTime, so it is immune to the bogus `seekable.end` sentinel. */
export function liveEdge(video: HTMLVideoElement): number | null {
  const ranges = saneRanges(video.buffered);
  return ranges.length > 0 ? ranges[ranges.length - 1].end : null;
}

/** How far BACK a seek may go. Kick reports `seekable.start(0) === 0` even when that is
 * only a bogus sentinel below the playable buffer; `buffered.start(0)` is the real floor
 * that keeps rewind targets inside media the player can actually decode. */
export function seekFloor(video: HTMLVideoElement): number {
  const bufferedStart = saneRanges(video.buffered)[0]?.start;
  if (bufferedStart !== undefined) return bufferedStart;

  const invertedBufferedStart = firstFiniteStartWithFiniteEnd(video.buffered);
  if (invertedBufferedStart !== null) return invertedBufferedStart;

  const seekableStart = saneRanges(video.seekable)[0]?.start;
  if (seekableStart !== undefined) return seekableStart;

  return 0;
}

/** Shared by this file's inline buttons and rewind-hotkeys.ts's arrow keys. Clamps to
 * [seekFloor, liveEdge]: both ends prefer the playable buffered range, avoiding Kick's
 * bogus `seekable` sentinels so seeks can't catapult outside media the player can decode. */
export function clampSeekTarget(video: HTMLVideoElement, delta: number): number {
  const target = video.currentTime + delta;
  const bufferedRanges = saneRanges(video.buffered);
  if (bufferedRanges.length > 0) {
    for (const range of bufferedRanges) {
      if (target >= range.start && target <= range.end) return target;
    }

    const first = bufferedRanges[0];
    const last = bufferedRanges[bufferedRanges.length - 1];
    if (target < first.start) return first.start;
    if (target > last.end) return last.end;

    for (let index = 1; index < bufferedRanges.length; index++) {
      const previous = bufferedRanges[index - 1];
      const next = bufferedRanges[index];
      if (target <= previous.end || target >= next.start) continue;
      if (delta < 0) return previous.end;
      if (delta > 0) return next.start;
      return target - previous.end <= next.start - target ? previous.end : next.start;
    }
  }

  const floor = seekFloor(video);
  const edge = liveEdge(video) ?? target;
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const REWIND_PATHS = ['M13 6l-6 6 6 6', 'M19 6l-6 6 6 6'];
const FORWARD_PATHS = ['M11 6l6 6-6 6', 'M5 6l6 6-6 6'];

function createChevronIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const pathData of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
  }
  return svg;
}

function createStepLabel(): HTMLSpanElement {
  const label = document.createElement('span');
  label.textContent = String(STEP_SECONDS);
  return label;
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
    logger.debug('rewind-controls: #video-player not found, skipping');
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
    rewind.append(createChevronIcon(REWIND_PATHS), createStepLabel());
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
    forward.append(createStepLabel(), createChevronIcon(FORWARD_PATHS));
    forward.title = `${STEP_SECONDS} sn ileri (→)`;
    forward.setAttribute('aria-label', `${STEP_SECONDS} saniye ileri sar`);

    // Attached directly to the button (not routed through Lifecycle): these buttons get
    // rebuilt by native-bar.ts's ensure() whenever Kick's control bar re-renders and drops
    // them, and a Lifecycle-routed listener would keep the OLD button + closure alive
    // (referenced by a disposer) until the whole session tears down, accumulating across
    // repeated re-renders. A plain listener is GC'd along with the button node itself the
    // moment it's removed (by Kick or by us on remount/teardown) — nothing accumulates.
    rewind.addEventListener('click', () => {
      const current = getVideoElement();
      if (current) seekBy(current, -STEP_SECONDS);
    });
    forward.addEventListener('click', () => {
      const current = getVideoElement();
      if (current) seekBy(current, STEP_SECONDS);
    });
    live.addEventListener('click', () => {
      const current = getVideoElement();
      if (current) goLive(current);
    });

    seekPill.append(rewind, forward);
    group.append(seekPill, live);
    return group;
  });
}
