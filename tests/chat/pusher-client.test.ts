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

  it('normalizes a real Kick-shaped payload: role badges in `badges`, level in `badges_v2`', () => {
    const message = normalizeMessage({
      id: 'm2',
      chatroom_id: 4,
      content: 'hello',
      type: 'message',
      created_at: '2026-01-01T00:00:00Z',
      sender: {
        id: 10,
        username: 'carol',
        slug: 'carol',
        identity: {
          color: '#fff',
          badges: [
            { type: 'moderator', text: 'Moderator', sort_order: 4 },
            { type: 'verified', text: 'Verified channel', sort_order: 10 },
          ],
          badges_v2: [
            {
              name: 'level',
              badge_type: 'global',
              image_url: 'https://ext.cdn.kick.com/chat/badges/33_x.png',
              metadata: { level: 33 },
              sort_order: 1,
            },
          ],
        },
      },
    });

    expect(message?.sender.identity.badges).toEqual([
      { type: 'moderator', text: 'Moderator', sortOrder: 4 },
      { type: 'verified', text: 'Verified channel', sortOrder: 10 },
    ]);
    expect(message?.sender.identity.badgesV2).toEqual([
      {
        name: 'level',
        imageUrl: 'https://ext.cdn.kick.com/chat/badges/33_x.png',
        level: 33,
        sortOrder: 1,
      },
    ]);
  });

  it('extracts real Kick reply context from metadata.original_sender and metadata.original_message', () => {
    const message = normalizeMessage({
      id: '72faefda-d095-4a8f-a146-7e9b7c491908',
      chatroom_id: 19769178,
      content: 'harbi yaaaa',
      type: 'reply',
      created_at: '2026-07-09T12:30:35+00:00',
      sender: {
        id: 26305632,
        username: '4Umbra1',
        slug: '4umbra1',
        identity: { color: '#E9113C', badges: [], badges_v2: [] },
      },
      metadata: {
        original_sender: { id: 50668393, username: 'ZehoG' },
        original_message: {
          id: '8957918e-cbad-48b2-a196-44a18740317a',
          content: 'yav korusanızağğğğ',
        },
        message_ref: '1783600235812',
      },
      thread_parent_id: '8957918e-cbad-48b2-a196-44a18740317a',
    });

    expect(message?.replyContext).toEqual({
      replyToUser: 'ZehoG',
      replyToText: 'yav korusanızağğğğ',
      replyToMessageId: '8957918e-cbad-48b2-a196-44a18740317a',
      replyToUserId: 50668393,
      threadParentId: '8957918e-cbad-48b2-a196-44a18740317a',
    });
  });

  it('does not treat metadata.message_ref alone as reply context', () => {
    const message = normalizeMessage({
      id: 'cb79a89e-745a-4dfc-8e42-bf26ec8dca8b',
      chatroom_id: 19769178,
      content: '[emote:4148074:HYPERCLAP]',
      type: 'message',
      created_at: '2026-07-09T12:29:14+00:00',
      sender: {
        id: 7291201,
        username: 'Estelihan',
        slug: 'estelihan',
        identity: { color: '#55FFC7', badges: [], badges_v2: [] },
      },
      metadata: { message_ref: '1783600154188' },
    });

    expect(message?.replyContext).toBeUndefined();
  });

  it('does not extract empty object original_message.content as reply text', () => {
    const message = normalizeMessage({
      id: 'reply-empty-content',
      chatroom_id: 19769178,
      content: 'reply body',
      type: 'reply',
      created_at: '2026-07-09T12:30:35+00:00',
      sender: {
        id: 26305632,
        username: '4Umbra1',
        slug: '4umbra1',
        identity: { color: '#E9113C', badges: [], badges_v2: [] },
      },
      metadata: {
        original_sender: { id: 50668393, username: 'ZehoG' },
        original_message: { id: 'orig-empty', content: '' },
      },
      thread_parent_id: 'orig-empty',
    });

    expect(message?.replyContext).toMatchObject({
      replyToUser: 'ZehoG',
      replyToText: null,
      replyToMessageId: 'orig-empty',
    });
  });

  it('drops reply context when original_message is only an empty string', () => {
    const message = normalizeMessage({
      id: 'reply-empty-string',
      chatroom_id: 19769178,
      content: 'reply body',
      type: 'reply',
      created_at: '2026-07-09T12:30:35+00:00',
      sender: {
        id: 26305632,
        username: '4Umbra1',
        slug: '4umbra1',
        identity: { color: '#E9113C', badges: [], badges_v2: [] },
      },
      metadata: { original_message: '' },
    });

    expect(message?.replyContext).toBeUndefined();
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
      deletedBy: null,
      violatedRules: ['spam', 'hate'],
    });

    expect(normalizeDeletePayload({
      id: 'top-level-id',
      aiModerated: false,
    })).toEqual({
      messageId: 'top-level-id',
      aiModerated: false,
      deletedBy: null,
      violatedRules: [],
    });

    expect(normalizeDeletePayload({
      message: { id: 'message-id-with-mod' },
      aiModerated: false,
      deleted_by: { username: 'modname' },
    })).toEqual({
      messageId: 'message-id-with-mod',
      aiModerated: false,
      deletedBy: 'modname',
      violatedRules: [],
    });

    expect(normalizeDeletePayload({ aiModerated: true })).toBeNull();
  });
});
