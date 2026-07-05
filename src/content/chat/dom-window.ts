import { logger } from '../shared/logger';
import { MESSAGE_CLASS, PRESERVED_CLASS } from './message-view';
import type { ChatDomRegistry } from './message-store';

const MAX_NON_PRESERVED_NODES = 200;
const BOTTOM_THRESHOLD_PX = 60;

/** Whether the container's scroll position is already at (or near) the bottom — used by
 * bootstrap.ts to decide whether to auto-stick to the new bottom after a flush, without
 * yanking the view out from under a user who's scrolled up reading history. */
export function isNearBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
}

/** Fixed-window clip — no virtualization (YAGNI at personal/single-channel scale, and it
 * would fight Kick's own layout). Trims the oldest non-preserved children once the
 * container exceeds MAX_NON_PRESERVED_NODES; preserved/banned/deleted messages are
 * exempt here (that exemption is itself bounded elsewhere — ChatIntegrityStore's 50-cap
 * + TTL sweep — so it can't grow unbounded either).
 *
 * Removing nodes from the top shifts everything below them up by their combined height;
 * scrollTop is adjusted by that amount so a user reading scrollback doesn't see the list
 * jump under them. */
export function trimMessageWindow(container: HTMLElement, registry: ChatDomRegistry): void {
  // Only message rows are trim candidates — the overlay list also holds the scroll pill (and
  // could hold other non-message UI), which must never be trimmed.
  const messages = (Array.from(container.children) as HTMLElement[]).filter((child) =>
    child.classList.contains(MESSAGE_CLASS)
  );
  const nonPreserved = messages.filter((child) => !child.classList.contains(PRESERVED_CLASS));
  const overflow = nonPreserved.length - MAX_NON_PRESERVED_NODES;
  if (overflow <= 0) return;

  let removedHeight = 0;
  for (let i = 0; i < overflow; i++) {
    const node = nonPreserved[i];
    removedHeight += node.offsetHeight;
    registry.forget(node);
    container.removeChild(node);
  }
  if (removedHeight > 0) {
    container.scrollTop -= removedHeight;
  }
  logger.debug('dom-window: trimmed', overflow, 'node(s)');
}
