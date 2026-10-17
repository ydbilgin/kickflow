import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { featureFlags } from '../chat/feature-flags';
import { clampSeekTarget } from './rewind-controls';
import { captureScreenshot } from './screenshot';
import { goLiveNow } from './live-catchup';
import { findHotkeyAction, isHotkeyCaptureActive } from './hotkey-registry';
import type { Lifecycle } from '../shared/lifecycle';

// 10s to match the inline ⏪/⏩ buttons (rewind-controls.ts STEP_SECONDS) so keyboard and
// click seek the same amount.
const SEEK_STEP_SECONDS = 10;

// A held arrow key auto-repeats ~30-60×/s. Executing a seek on every repeat is a seek-abort
// storm (each new currentTime write aborts the previous reload); throttling repeat-driven seeks
// to one per this interval turns "hold ArrowLeft" into a smooth ~65s-of-rewind-per-second sweep
// that matches dragging Kick's native seek-bar far back. A single (non-repeat) press is never
// throttled, and a throttled repeat is still consumed (see onKeyDown) so it never leaks to Kick's
// page-level arrow handler — the whole reason this listener runs at capture phase.
const REPEAT_SEEK_MIN_INTERVAL_MS = 150;

export function isTypingTarget(target: EventTarget | null): boolean {
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

/** Arrow handling is consumed at document-capture phase before Kick or the browser can apply a
 * second arrow action. This makes the shared clamp the only currentTime write for a keypress,
 * avoiding a competing native handler sending the player to stream start. Best-effort against #video-player's own
 * currentTime — the one confirmed-stable selector — rather than Kick's (unconfirmed)
 * native rewind seek-bar DOM. Clamped to the same [seekFloor, liveEdge] range as
 * rewind-controls.ts's inline buttons (shared clampSeekTarget) — the floor preserves DVR
 * rewind (`seekable.start(0)` can be > 0) while the ceiling is the buffered live edge, so a
 * seek can neither run before the DVR start nor catapult past what is actually playable.
 * Fails gracefully if the video element is gone. */
export function initRewindHotkeys(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('rewind-hotkeys: #video-player not found, skipping');
    return;
  }

  let lastSeekAt = 0;
  const onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (isHotkeyCaptureActive()) return;
    if (isTypingTarget(keyboardEvent.target)) return;
    if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return;
    const action = findHotkeyAction(keyboardEvent.key);
    if (!action) return;

    try {
      let handled = false;
      if ((action === 'rewind' || action === 'forward') && featureFlags.rewindControls) {
        const current = getVideoElement();
        if (!current) return;
        // Throttle auto-repeat only; a real single press always seeks. A throttled repeat still
        // falls through to the consume block below (handled = true), so it never reaches Kick.
        const now = Date.now();
        if (keyboardEvent.repeat && now - lastSeekAt < REPEAT_SEEK_MIN_INTERVAL_MS) {
          handled = true;
        } else {
          const direction = action === 'rewind' ? -1 : 1;
          const target = clampSeekTarget(current, direction * SEEK_STEP_SECONDS);
          current.currentTime = target;
          lastSeekAt = now;
          logger.debug('rewind-hotkeys: seeked to', target);
          handled = true;
        }
      } else if (action === 'screenshot' && featureFlags.screenshot) {
        handled = captureScreenshot();
      } else if (action === 'goLive' && featureFlags.liveCatchup) {
        handled = goLiveNow();
      }
      if (!handled) return;

      // `preventDefault()` alone does not stop page-level handlers. Capture plus immediate stop
      // gives every configured KickFlow action one authoritative execution path.
      keyboardEvent.preventDefault();
      keyboardEvent.stopImmediatePropagation();
    } catch (error) {
      logger.warn('rewind-hotkeys: action failed', action, error);
    }
  };

  lifecycle.addEventListener(document, 'keydown', onKeyDown, true);
}
