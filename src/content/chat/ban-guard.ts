import { logger } from '../shared/logger';
import { featureFlags } from './feature-flags';
import type { BanEventPayload, DeleteEventPayload } from './pusher-client';
import type { ChatIntegrityStore } from './message-store';
import type { NativeChatAugmenter } from './native-augment';

export interface BanGuardDeps {
  store: ChatIntegrityStore;
  augmenter: NativeChatAugmenter;
}

/** The store is the single source of truth; the native augmenter updates currently
 * mounted rows immediately and re-applies from the store when Kick re-mounts rows. */
export function handleUserBanned(payload: BanEventPayload, deps: BanGuardDeps): void {
  const messages = deps.store.markUserBanned(payload.userId, {
    permanent: payload.permanent,
    durationMin: payload.durationMin,
    bannedBy: payload.bannedBy,
  });
  if (messages.length === 0) return;

  let updatedCount = 0;
  for (const message of messages) {
    deps.augmenter.markById(message.id);
    updatedCount++;
  }
  deps.augmenter.seedBannedGhosts(messages.map((message) => message.id));
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
      violatedRules: payload.violatedRules,
    });
    if (!message) return;
    deps.augmenter.markById(messageId);
    logger.debug('ban-guard: struck-through deleted message', messageId, payload.aiModerated ? '(AI)' : '(mod)');
  }
}
