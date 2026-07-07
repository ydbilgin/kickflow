import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { handleMessageDeleted, handleUserBanned } from '../../src/content/chat/ban-guard';
import type { BanEventPayload, DeleteEventPayload } from '../../src/content/chat/pusher-client';
import type { ChatMessage } from '../../src/content/chat/message-store';

function chatMessage(id: string): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content: id,
    type: 'message',
    createdAt: '',
    sender: {
      id: 3,
      username: 'u',
      slug: 'u',
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

describe('ban-guard', () => {
  const originalShowDeleted = featureFlags.showDeletedMessages;

  afterEach(() => {
    featureFlags.showDeletedMessages = originalShowDeleted;
    vi.restoreAllMocks();
  });

  it('marks every tracked message for a banned user', () => {
    const messages = [chatMessage('a'), chatMessage('b'), chatMessage('c')];
    const store = {
      markUserBanned: vi.fn(() => messages),
    };
    const augmenter = { markById: vi.fn(), seedBannedGhosts: vi.fn() };
    const payload: BanEventPayload = {
      userId: 3,
      permanent: false,
      durationMin: 10,
      bannedBy: 'mod',
      expiresAt: null,
    };

    handleUserBanned(payload, { store, augmenter } as never);

    expect(store.markUserBanned).toHaveBeenCalledWith(3, {
      permanent: false,
      durationMin: 10,
      bannedBy: 'mod',
    });
    expect(augmenter.markById).toHaveBeenCalledTimes(3);
    expect(augmenter.markById).toHaveBeenNthCalledWith(1, 'a');
    expect(augmenter.markById).toHaveBeenNthCalledWith(2, 'b');
    expect(augmenter.markById).toHaveBeenNthCalledWith(3, 'c');
    expect(augmenter.seedBannedGhosts).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('preserves deleted messages only when showDeletedMessages is on', () => {
    const payload: DeleteEventPayload = {
      messageId: 'm1',
      aiModerated: true,
      violatedRules: ['hate'],
    };
    const store = { markMessageDeleted: vi.fn(() => chatMessage('m1')) };
    const augmenter = { markById: vi.fn(), seedBannedGhosts: vi.fn() };

    featureFlags.showDeletedMessages = true;
    handleMessageDeleted(payload, { store, augmenter } as never);
    expect(store.markMessageDeleted).toHaveBeenCalledWith('m1', {
      aiModerated: true,
      violatedRules: ['hate'],
    });
    expect(augmenter.markById).toHaveBeenCalledWith('m1');

    store.markMessageDeleted.mockClear();
    augmenter.markById.mockClear();
    featureFlags.showDeletedMessages = false;
    handleMessageDeleted(payload, { store, augmenter } as never);
    expect(store.markMessageDeleted).not.toHaveBeenCalled();
    expect(augmenter.markById).not.toHaveBeenCalled();
  });
});
