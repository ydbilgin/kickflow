import { logger } from '../shared/logger';
import { findControlBar, getVideoElement } from '../shared/selectors';
import { mountIntoControlBarRoot } from './native-bar';
import { bindVideoElementListener, observeVideoElement } from './video-element';
import { clampSeekTarget, liveEdge, seekFloor } from './rewind-controls';
import type { Lifecycle } from '../shared/lifecycle';

const CONTROLS_ID = 'kickflow-seek-bar';

/**
 * Kick renders its own green seek bar ONLY when the player store holds `sources.dvr`
 * (bundle 2026-08-05: `type === "livestream" && sources.dvr ? <VideoSeekbar/> : null`). That
 * data arrives from a channel-videos query which is not even enabled until roughly two minutes
 * after the stream started, and is disabled outright on one of Kick's feature-flag branches, so
 * on a live channel the bar is intermittently absent for the whole session — reproduced on a
 * clean browser with no extensions at all.
 *
 * This draws the same bar from the same numbers so the reader always has one. Kick's own class
 * names are applied first, which makes it pixel-identical for free while Kick's stylesheet
 * defines them; `KICK_FALLBACK` holds the values those classes currently resolve to (read out
 * of Kick's CSS the same day) for the case where they stop resolving.
 */
const KICK_CLASSES = {
  root: 'group/seekbar absolute -top-7 left-0 h-5 w-full',
  track: 'bg-subtle/50 absolute bottom-0 left-0 h-1 w-full',
  range: 'absolute h-full bg-green-500',
  thumb: 'bg-primary-base absolute size-4 rounded-full',
} as const;

/** What the classes above resolve to in Kick's stylesheet today. Only used when they do not. */
export const KICK_FALLBACK = {
  topOffsetPx: -28,
  heightPx: 20,
  trackHeightPx: 4,
  thumbSizePx: 16,
  trackColor: '#929ea680',
  rangeColor: '#53fc18',
  thumbColor: '#53fc18',
} as const;

/**
 * 0..1 position of the playhead inside the addressable window, which is [seekFloor, liveEdge] —
 * the same bounds the rewind buttons obey, so the bar can never advertise a position the click
 * cannot reach. Returns null when there is no usable window, which is the signal to show nothing
 * rather than a bar pinned at either end.
 *
 * There is deliberately no separate "loaded" track: that window IS the buffered range, so a
 * loaded indicator would be full width at every instant and carry no information.
 */
export function computePlayedRatio(video: HTMLVideoElement): number | null {
  const edge = liveEdge(video);
  if (edge === null) return null;
  const floor = seekFloor(video);
  const span = edge - floor;
  if (!(span > 0)) return null;
  const ratio = (video.currentTime - floor) / span;
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/** Where a click at `ratio` across the bar should land, expressed as a delta so the seek runs
 * through `clampSeekTarget` and inherits its direction and magnitude guards. */
export function seekDeltaForRatio(video: HTMLVideoElement, ratio: number): number | null {
  const edge = liveEdge(video);
  if (edge === null) return null;
  const floor = seekFloor(video);
  const span = edge - floor;
  if (!(span > 0)) return null;
  const target = floor + span * (ratio < 0 ? 0 : ratio > 1 ? 1 : ratio);
  return target - video.currentTime;
}

/** True when Kick is already drawing its own seek bar and the reader does not need ours. A bar
 * that exists but has collapsed to nothing does not count as drawn. */
export function isNativeSeekBarVisible(root: ParentNode): boolean {
  for (const candidate of root.querySelectorAll('[class*="group/seekbar"]')) {
    if (candidate.id === CONTROLS_ID) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

const UNPAINTED = new Set(['', 'rgba(0, 0, 0, 0)', 'transparent']);

/**
 * True once the probe has been able to run, whether or not it found paint. Returns false while
 * the element is still detached: a disconnected node resolves to no computed paint at all, and
 * treating that as "Kick's classes are gone" would latch the fallback on permanently.
 */
export function probeKickClassesResolved(root: HTMLElement, range: HTMLElement): boolean {
  if (!range.isConnected) return false;
  // One probe rather than a permanent duplicate rule set: our own stylesheet is adopted, so it
  // sits AFTER Kick's in the cascade and any property we also declare would beat the utility
  // class we are trying to inherit. Tagging the root instead keeps Kick's values winning in the
  // normal case and only paints our measured copies when nothing resolved.
  const painted = !UNPAINTED.has(getComputedStyle(range).backgroundColor);
  root.classList.toggle('kickflow-seek-bar--fallback', !painted);
  if (!painted) {
    logger.debug('seek-bar: Kick utility classes did not resolve, using measured fallback');
  }
  return true;
}

/**
 * Draws a seek bar into Kick's control bar whenever Kick is not drawing its own, and seeks
 * through the shared clamp when clicked. Mode-independent and flag-free: it renders from the
 * media element alone.
 */
export function initSeekBar(lifecycle: Lifecycle): void {
  if (!getVideoElement()) {
    logger.debug('seek-bar: #video-player not found, skipping');
    return;
  }

  let rootEl: HTMLElement | null = null;
  let rangeEl: HTMLElement | null = null;
  let thumbEl: HTMLElement | null = null;
  let fallbackProbed = false;

  const render = (): void => {
    const root = rootEl;
    const range = rangeEl;
    const thumb = thumbEl;
    if (!root || !range || !thumb) return;

    const bar = findControlBar();
    if (bar && isNativeSeekBarVisible(bar)) {
      root.hidden = true;
      return;
    }

    const video = getVideoElement();
    const played = video ? computePlayedRatio(video) : null;
    if (played === null) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    if (!fallbackProbed) fallbackProbed = probeKickClassesResolved(root, range);
    const playedPercent = `${(played * 100).toFixed(2)}%`;
    range.style.width = playedPercent;
    thumb.style.left = playedPercent;
  };

  const seekToPointer = (event: PointerEvent): void => {
    const root = rootEl;
    const video = getVideoElement();
    if (!root || !video) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;
    const delta = seekDeltaForRatio(video, (event.clientX - rect.left) / rect.width);
    if (delta === null) return;
    try {
      video.currentTime = clampSeekTarget(video, delta);
    } catch (error) {
      logger.warn('seek-bar: seek failed', error);
    }
    render();
  };

  bindVideoElementListener(lifecycle, 'timeupdate', render);
  bindVideoElementListener(lifecycle, 'progress', render);
  bindVideoElementListener(lifecycle, 'loadstart', render);
  observeVideoElement(lifecycle, render);

  mountIntoControlBarRoot(lifecycle, CONTROLS_ID, () => {
    const root = document.createElement('div');
    root.className = `${KICK_CLASSES.root} kickflow-seek-bar`;
    root.hidden = true;

    const track = document.createElement('div');
    track.className = `${KICK_CLASSES.track} kickflow-seek-bar__track`;

    const range = document.createElement('div');
    range.className = `${KICK_CLASSES.range} kickflow-seek-bar__range`;

    const thumb = document.createElement('div');
    thumb.className = `${KICK_CLASSES.thumb} kickflow-seek-bar__thumb`;

    track.append(range);
    root.append(track, thumb);

    rootEl = root;
    rangeEl = range;
    thumbEl = thumb;
    fallbackProbed = false;

    // Plain listener on the rebuilt node, matching the other player controls: native-bar drops
    // and rebuilds this element on Kick re-renders, and a lifecycle-routed listener would keep
    // every superseded node alive until teardown.
    root.addEventListener('pointerdown', seekToPointer);
    render();
    return root;
  });
}
