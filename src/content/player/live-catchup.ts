import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

const CATCHUP_PLAYBACK_RATE = 1.5;
const NORMAL_PLAYBACK_RATE = 1.0;
const BEHIND_THRESHOLD_SECONDS = 3;
const CAUGHT_UP_THRESHOLD_SECONDS = 1.5;

function getLiveEdgeSeconds(video: HTMLVideoElement): number | null {
  const seekable = video.seekable;
  if (seekable.length === 0) return null;
  return seekable.end(seekable.length - 1);
}

/** Purely event-driven off the video element's own `timeupdate` — no polling. Fully
 * isolated from the chat render pipeline: no shared scheduler/state with chat/*. */
export function initLiveCatchup(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('live-catchup: #video-player not found, skipping');
    return;
  }

  let catchingUp = false;

  const onTimeUpdate = (): void => {
    const liveEdge = getLiveEdgeSeconds(video);
    if (liveEdge === null) return;

    const behindBy = liveEdge - video.currentTime;

    if (!catchingUp && behindBy > BEHIND_THRESHOLD_SECONDS) {
      catchingUp = true;
      video.playbackRate = CATCHUP_PLAYBACK_RATE;
      logger.debug('live-catchup: behind by', behindBy.toFixed(1), 's, speeding up');
    } else if (catchingUp && behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
      catchingUp = false;
      video.playbackRate = NORMAL_PLAYBACK_RATE;
      logger.debug('live-catchup: caught up, resetting playback rate');
    }
  };

  lifecycle.addEventListener(video, 'timeupdate', onTimeUpdate);
  lifecycle.add(() => {
    if (video.playbackRate !== NORMAL_PLAYBACK_RATE) video.playbackRate = NORMAL_PLAYBACK_RATE;
  });
}
