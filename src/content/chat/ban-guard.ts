import { logger } from '../shared/logger';
import { featureFlags } from './feature-flags';
import { applyPreservedMarking } from './message-view';
import type { BanEventPayload } from './pusher-client';
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
export function handleUserBanned(payload: BanEventPayload, deps: BanGuardDeps): void {
  const messages = deps.store.markUserBanned(payload.userId, {
    permanent: payload.permanent,
    durationMin: payload.durationMin,
    bannedBy: payload.bannedBy,
  });
  if (messages.length === 0) return;

  let updatedCount = 0;
  for (const message of messages) {
    const element = deps.registry.getElementForMessageId(message.id);
    if (!element) continue; // not rendered yet — buildMessageElement will mark it
    applyPreservedMarking(element, message);
    updatedCount++;
  }
  logger.debug('ban-guard: updated', updatedCount, 'message(s) for user', payload.userId,
    payload.permanent === false ? `(timeout ${payload.durationMin ?? '?'}m by ${payload.bannedBy ?? '?'})` : '(ban)');
}

/** Delete events are always delivered here (the pusher-client gate was removed); this decides
 * what to do based on featureFlags.showDeletedMessages:
 *  - ON  → preserve the message in place, struck-through, with its ORIGINAL text (KickFlow's
 *          value-add over Kick's "Deleted by a moderator" placeholder).
 *  - OFF → mimic native deletion: drop the row + forget the message. Because KickFlow renders
 *          its OWN list (native never sees the delete), doing nothing would leave the deleted
 *          text visible as a normal row (cx review 2). A message already preserved for another
 *          reason (a ban strike-through) is left untouched — a ban must not be silently removed. */
export function handleMessageDeleted(messageId: string, deps: BanGuardDeps): void {
  if (featureFlags.showDeletedMessages) {
    const message = deps.store.markMessageDeleted(messageId);
    if (!message) return;
    const element = deps.registry.getElementForMessageId(messageId);
    if (!element) return; // not rendered yet — buildMessageElement will mark it
    applyPreservedMarking(element, message);
    logger.debug('ban-guard: struck-through deleted message', messageId);
    return;
  }

  // showDeletedMessages OFF — remove the row unless it's already preserved (banned).
  const existing = deps.store.getMessageById(messageId);
  if (existing?.preserved) return;
  const element = deps.registry.getElementForMessageId(messageId);
  if (element) {
    deps.registry.forget(element);
    element.remove();
  }
  deps.store.removeMessage(messageId);
  logger.debug('ban-guard: removed deleted message (showDeletedMessages off)', messageId);
}
