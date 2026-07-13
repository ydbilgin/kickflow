import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import { formatHotkeyKey, getHotkeyBinding, subscribeHotkeyBindings } from './hotkey-registry';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-rewind-controls';
const STEP_SECONDS = 10;
const MAX_CROSS_RANGE_GAP_SECONDS = 30;

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

  // Prefer the SEEKABLE range as the clamp bounds. Measured on Kick's current player
  // (2026-07-10): `seekable` is the real DVR window (seekable.end ≈ live edge, accurate) and
  // the server re-loads ANY seekable position even if not yet buffered — so ⏪10 must be able
  // to cross PAST buffered.start into the DVR window (owner request). `saneRanges` filters the
  // old 2^30 sentinel, so a player that still reports a bogus `seekable` falls through to the
  // buffered-range logic below (the pre-2026-07-10 safe behavior — no catapult).
  const seekableRanges = saneRanges(video.seekable);
  // A fresh live join may initially expose only a short (including exactly 10s) DVR window.
  // It remains authoritative when it contains the current playhead, and seeking its start asks
  // Kick to reload that unbuffered DVR position. Requiring a window wider than one step made
  // both the pill and Left-arrow fall back to buffered.start and appear to do nothing after F5.
  // Requiring the current playhead to be in the range rejects stale preload ranges elsewhere.
  const dvr = seekableRanges.find(
    (range) => video.currentTime >= range.start && video.currentTime <= range.end,
  );
  if (dvr) {
    return Math.min(Math.max(target, dvr.start), dvr.end);
  }

  const bufferedRanges = saneRanges(video.buffered);
  if (bufferedRanges.length > 0) {
    for (const range of bufferedRanges) {
      if (target >= range.start && target <= range.end) return target;
    }

    const first = bufferedRanges[0];
    const last = bufferedRanges[bufferedRanges.length - 1];
    if (target < first.start) return first.start;
    if (target > last.end) return last.end;

    const currentRange = bufferedRanges.find(
      (range) => video.currentTime >= range.start && video.currentTime <= range.end,
    );
    for (let index = 1; index < bufferedRanges.length; index++) {
      const previous = bufferedRanges[index - 1];
      const next = bufferedRanges[index];
      if (target <= previous.end || target >= next.start) continue;
      // Joining a live stream can briefly leave a tiny preload range near zero alongside the
      // actual DVR range. A short seek into that large discontinuity must stay at the edge of
      // the range being played, never jump across the stale range to the broadcast start.
      if (next.start - previous.end > MAX_CROSS_RANGE_GAP_SECONDS) {
        if (delta < 0 && currentRange === next) return next.start;
        if (delta > 0 && currentRange === previous) return previous.end;
      }
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
 * live to work on Kick (seeking -30s kept the stream playing). Both clamp ends come from
 * buffered, NOT seekable: Kick's seekable can report a bogus sentinel (~2^30) that would
 * otherwise catapult the seek. No need to touch Kick's own (unconfirmed) native seek-bar
 * DOM at all. The go-live button lives in live-catchup.ts (merged with the behind-live
 * indicator); this group is only the ⏪10|10⏩ seek pill. */
export function initRewindControls(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('rewind-controls: #video-player not found, skipping');
    return;
  }

  let rewindButton: HTMLButtonElement | null = null;
  let forwardButton: HTMLButtonElement | null = null;
  const updateHotkeyTitles = (): void => {
    const rewindHotkey = getHotkeyBinding('rewind');
    const forwardHotkey = getHotkeyBinding('forward');
    if (rewindButton) rewindButton.title = `${STEP_SECONDS} sn geri${rewindHotkey.enabled ? ` (${formatHotkeyKey(rewindHotkey.key)})` : ''}`;
    if (forwardButton) forwardButton.title = `${STEP_SECONDS} sn ileri${forwardHotkey.enabled ? ` (${formatHotkeyKey(forwardHotkey.key)})` : ''}`;
  };
  lifecycle.add(subscribeHotkeyBindings(updateHotkeyTitles));

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group kickflow-player-group--lead';

    const seekPill = document.createElement('span');
    seekPill.className = 'kickflow-seek-pill';

    const rewind = document.createElement('button');
    rewind.type = 'button';
    rewind.className = 'kickflow-player-btn kickflow-seek-pill__btn';
    rewind.append(createChevronIcon(REWIND_PATHS), createStepLabel());
    rewind.setAttribute('aria-label', `${STEP_SECONDS} saniye geri sar`);

    const forward = document.createElement('button');
    forward.type = 'button';
    forward.className = 'kickflow-player-btn kickflow-seek-pill__btn';
    forward.append(createStepLabel(), createChevronIcon(FORWARD_PATHS));
    forward.setAttribute('aria-label', `${STEP_SECONDS} saniye ileri sar`);
    rewindButton = rewind;
    forwardButton = forward;
    updateHotkeyTitles();

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

    seekPill.append(rewind, forward);
    group.append(seekPill);
    return group;
  });
}
