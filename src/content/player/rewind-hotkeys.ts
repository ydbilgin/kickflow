import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { clampSeekTarget } from './rewind-controls';
import type { Lifecycle } from '../shared/lifecycle';

const SEEK_STEP_SECONDS = 5;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

/** Kick has no native arrow-key seek. Best-effort against #video-player's own
 * currentTime — the one confirmed-stable selector — rather than Kick's (unconfirmed)
 * native rewind seek-bar DOM. Clamped to the same [seekFloor, liveEdge] range as
 * rewind-controls.ts's inline buttons (shared clampSeekTarget) — the floor preserves DVR
 * rewind (`seekable.start(0)` can be > 0) while the ceiling is the buffered live edge, so a
 * seek can neither run before the DVR start nor catapult past what is actually playable.
 * Fails gracefully if the video element is gone. */
export function initRewindHotkeys(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('rewind-hotkeys: #video-player not found, skipping');
    return;
  }

  const onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (isTypingTarget(keyboardEvent.target)) return;
    if (keyboardEvent.key !== 'ArrowLeft' && keyboardEvent.key !== 'ArrowRight') return;

    const direction = keyboardEvent.key === 'ArrowLeft' ? -1 : 1;
    try {
      const target = clampSeekTarget(video, direction * SEEK_STEP_SECONDS);
      video.currentTime = target;
      logger.debug('rewind-hotkeys: seeked to', target);
    } catch (error) {
      logger.warn('rewind-hotkeys: seek failed', error);
    }
  };

  lifecycle.addEventListener(document, 'keydown', onKeyDown);
}
