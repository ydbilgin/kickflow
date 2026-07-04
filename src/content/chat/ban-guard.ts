import { logger } from '../shared/logger';
import { applyPreservedMarking } from './message-view';
import type { ChatDomRegistry, ChatIntegrityStore } from './message-store';

export interface BanGuardDeps {
  store: ChatIntegrityStore;
  registry: ChatDomRegistry;
}

/** Second layer only. The store is the single source of truth for preserved/banned/
 * deleted status, and message-view.ts's buildMessageElement applies that status the
 * moment a row is built (covers a ban/delete event arriving while the message is still
 * sitting in the render batch). This module's job is just to update rows that were
 * already rendered BEFORE the event arrived. */
export function handleUserBanned(userId: number, deps: BanGuardDeps): void {
  const messages = deps.store.markUserBanned(userId);
  if (messages.length === 0) return;

  let updatedCount = 0;
  for (const message of messages) {
    const element = deps.registry.getElementForMessageId(message.id);
    if (!element) continue; // not rendered yet — buildMessageElement will mark it
    applyPreservedMarking(element, message);
    updatedCount++;
  }
  logger.debug('ban-guard: updated', updatedCount, 'already-rendered message(s) for user', userId);
}

/** Best-effort — gated by featureFlags.showDeletedMessages upstream in pusher-client.ts
 * since the delete event name itself is unconfirmed. */
export function handleMessageDeleted(messageId: string, deps: BanGuardDeps): void {
  const message = deps.store.markMessageDeleted(messageId);
  if (!message) return;

  const element = deps.registry.getElementForMessageId(messageId);
  if (!element) return; // not rendered yet — buildMessageElement will mark it
  applyPreservedMarking(element, message);
  logger.debug('ban-guard: updated already-rendered deleted message', messageId);
}
