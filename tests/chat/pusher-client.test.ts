import { describe, expect, it } from 'vitest';
import {
  normalizeBanPayload,
  normalizeDeletePayload,
  normalizeMessage,
} from '../../src/content/chat/pusher-client';

describe('pusher-client normalizers', () => {
  it('normalizes valid messages and rejects missing required fields', () => {
    expect(normalizeMessage({
      id: 'm1',
      chatroom_id: 4,
      content: 'hello',
      type: 'message',
      created_at: '2026-01-01T00:00:00Z',
      sender: {
        id: 9,
        username: 'bob',
        slug: 'bob',
        identity: {
          color: '#fff',
          badges: [{ type: 'sub', text: 'Sub', count: 2, image_url: 'https://kick.com/a.png' }],
          badges_v2: [{ type: 'vip', text: 'VIP' }],
        },
      },
    })).toMatchObject({
      id: 'm1',
      chatroomId: 4,
      content: 'hello',
      sender: {
        id: 9,
        identity: {
          badges: [{ type: 'sub', text: 'Sub', count: 2, imageUrl: 'https://kick.com/a.png' }],
          badgesV2: [{ type: 'vip', text: 'VIP' }],
        },
      },
      preserved: false,
    });

    expect(normalizeMessage({ sender: { id: 1, username: 'u' }, content: 'x' })).toBeNull();
    expect(normalizeMessage({ id: 'm', sender: { id: 1, username: 'u' } })).toBeNull();
    expect(normalizeMessage({ id: 'm', content: 'x' })).toBeNull();
  });

  it('normalizes flat and nested ban payloads', () => {
    expect(normalizeBanPayload({
      user_id: 7,
      username: 'flat',
      permanent: false,
      duration: '15',
      banned_by: 'mod1',
    })).toEqual({
      userId: 7,
      username: 'flat',
      permanent: false,
      durationMin: 15,
      bannedBy: 'mod1',
      expiresAt: null,
    });

    expect(normalizeBanPayload({
      user: { id: 8, username: 'nested' },
      banned_by: { username: 'mod2' },
      permanent: true,
      duration_min: 20,
      expires_at: '2026-01-01T00:20:00Z',
    })).toEqual({
      userId: 8,
      username: 'nested',
      permanent: true,
      durationMin: 20,
      bannedBy: 'mod2',
      expiresAt: '2026-01-01T00:20:00Z',
    });

    expect(normalizeBanPayload({ permanent: true })).toBeNull();
  });

  it('normalizes deleted-message payloads with message.id before top-level id', () => {
    expect(normalizeDeletePayload({
      id: 'event-id',
      message: { id: 'message-id' },
      aiModerated: true,
      violatedRules: ['spam', 1, 'hate'],
    })).toEqual({
      messageId: 'message-id',
      aiModerated: true,
      violatedRules: ['spam', 'hate'],
    });

    expect(normalizeDeletePayload({
      id: 'top-level-id',
      aiModerated: false,
    })).toEqual({
      messageId: 'top-level-id',
      aiModerated: false,
      violatedRules: [],
    });

    expect(normalizeDeletePayload({ aiModerated: true })).toBeNull();
  });
});
