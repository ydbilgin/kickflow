import { logger } from '../shared/logger';
import { MESSAGE_CLASS, PRESERVED_CLASS } from './message-view';
import type { ChatDomRegistry } from './message-store';

const MAX_NON_PRESERVED_NODES = 200;
const BOTTOM_THRESHOLD_PX = 60;

export function isNearBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
}

export function trimMessageWindow(container: HTMLElement, registry: ChatDomRegistry): void {
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
