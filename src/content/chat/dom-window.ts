import { logger } from '../shared/logger';
import { MESSAGE_CLASS, PRESERVED_CLASS } from './message-view';
import type { ChatDomRegistry } from './message-store';

export const MAX_NON_PRESERVED_NODES = 200;
// Headroom while the user is scrolled up (paused): the DOM is allowed to grow much larger
// before we shed anything, so the message they scrolled up to read is never yanked out from
// under them. Still bounded so a long raid can't grow the list without limit.
// Invariant: ChatIntegrityStore's GLOBAL_CAPACITY (message-store.ts) must stay >= this value —
// otherwise a row still visible in the paused DOM can fall out of the store and can no longer
// be preserved on ban/delete. If this changes, re-check GLOBAL_CAPACITY too.
export const MAX_NON_PRESERVED_NODES_PAUSED = 600;
const BOTTOM_THRESHOLD_PX = 60;

export function isNearBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
}

export function trimMessageWindow(
  container: HTMLElement,
  registry: ChatDomRegistry,
  maxNodes: number = MAX_NON_PRESERVED_NODES,
): void {
  const messages = (Array.from(container.children) as HTMLElement[]).filter((child) =>
    child.classList.contains(MESSAGE_CLASS)
  );
  const nonPreserved = messages.filter((child) => !child.classList.contains(PRESERVED_CLASS));
  const overflow = nonPreserved.length - maxNodes;
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

export interface ScrollFollowDecision {
  scrollToBottom: boolean;
  trimCap: number;
  showPill: boolean;
}

/** Given whether the list is currently pinned to the bottom and how many rows this flush
 * appended, decide follow behavior. Pinned → snap to bottom + normal trim, hide pill. Paused
 * (user scrolled up) → do NOT snap, do NOT trim from the top (only a high safety cap so the
 * message the user is reading is never yanked), and surface the "new messages" pill. */
export function decideScrollFollow(stickToBottom: boolean, appendedCount: number): ScrollFollowDecision {
  if (stickToBottom) {
    return { scrollToBottom: true, trimCap: MAX_NON_PRESERVED_NODES, showPill: false };
  }
  return { scrollToBottom: false, trimCap: MAX_NON_PRESERVED_NODES_PAUSED, showPill: appendedCount > 0 };
}
