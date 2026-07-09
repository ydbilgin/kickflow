import { logger } from '../shared/logger';
import { featureFlags } from './feature-flags';
import { applyPreservedMarking } from './message-view';
import type { BanEventPayload, DeleteEventPayload } from './pusher-client';
import type { ChatDomRegistry, ChatIntegrityStore } from './message-store';
import type { NativeChatAugmenter } from './native-augment';

export interface BanGuardDeps {
  store: ChatIntegrityStore;
  augmenter?: NativeChatAugmenter;
  registry?: ChatDomRegistry;
}

/** The store is the single source of truth; Mode B updates native rows through the augmenter,
 * while Mode A updates already-rendered own rows through the DOM registry. */
export function handleUserBanned(payload: BanEventPayload, deps: BanGuardDeps): void {
  const messages = deps.store.markUserBanned(payload.userId, {
    permanent: payload.permanent,
    durationMin: payload.durationMin,
    bannedBy: payload.bannedBy,
  });
  if (messages.length === 0) return;

  let updatedCount = 0;
  for (const message of messages) {
    if (deps.augmenter) {
      deps.augmenter.markById(message.id);
      updatedCount++;
      continue;
    }
    const element = deps.registry?.getElementForMessageId(message.id);
    if (!element) continue;
    applyPreservedMarking(element, message);
    updatedCount++;
  }
  deps.augmenter?.seedBannedGhosts(messages.map((message) => message.id));
  logger.debug('ban-guard: updated', updatedCount, 'message(s) for user', payload.userId,
    payload.permanent === false ? `(timeout ${payload.durationMin ?? '?'}m by ${payload.bannedBy ?? '?'})` : '(ban)');
}

/** Delete events are always delivered here (the pusher-client gate was removed); this decides
 * what to do based on featureFlags.showDeletedMessages:
 *  - ON  → preserve the message in place, struck-through, with its ORIGINAL text.
 *  - OFF → do nothing; Kick's native delete handling stands. */
export function handleMessageDeleted(payload: DeleteEventPayload, deps: BanGuardDeps): void {
  const { messageId } = payload;
  if (featureFlags.showDeletedMessages) {
    const message = deps.store.markMessageDeleted(messageId, {
      aiModerated: payload.aiModerated,
      deletedBy: payload.deletedBy,
      violatedRules: payload.violatedRules,
    });
    if (!message) return;
    if (deps.augmenter) {
      deps.augmenter.markById(messageId);
    } else {
      const element = deps.registry?.getElementForMessageId(messageId);
      if (element) applyPreservedMarking(element, message);
    }
    logger.debug('ban-guard: struck-through deleted message', messageId, payload.aiModerated ? '(AI)' : '(mod)');
    return;
  }

  if (deps.registry) {
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
}
