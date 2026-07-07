import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { clampSeekTarget } from './rewind-controls';
import type { Lifecycle } from '../shared/lifecycle';

// 10s to match the inline ⏪/⏩ buttons (rewind-controls.ts STEP_SECONDS) so keyboard and
// click seek the same amount.
const SEEK_STEP_SECONDS = 10;

function isTypingTarget(target: EventTarget | null): boolean {
  let element: HTMLElement | null =
    target instanceof HTMLElement ? target
    : target instanceof Node ? target.parentElement
    : null;

  while (element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role')?.toLowerCase();
    const testId = element.getAttribute('data-testid')?.toLowerCase() ?? '';
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      role === 'textbox' ||
      element.hasAttribute('data-lexical-editor') ||
      testId.includes('chat') ||
      element.isContentEditable
    ) {
      return true;
    }
    element = element.parentElement;
  }

  return false;
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
      keyboardEvent.preventDefault();
      logger.debug('rewind-hotkeys: seeked to', target);
    } catch (error) {
      logger.warn('rewind-hotkeys: seek failed', error);
    }
  };

  lifecycle.addEventListener(document, 'keydown', onKeyDown);
}
