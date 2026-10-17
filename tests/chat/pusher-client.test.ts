import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PusherClient,
  normalizeBanPayload,
  normalizeChatroomUpdatedPayload,
  normalizeChannelSubscriptionPayload,
  normalizeDeletePayload,
  normalizeGiftedSubscriptionsPayload,
  normalizeKicksGiftedPayload,
  normalizeHostPayload,
  normalizeMessage,
  normalizePinnedMessagePayload,
  normalizeSubscriptionPayload,
} from '../../src/content/chat/pusher-client';

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];
  closeCalls = 0;

  constructor(_url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
  }
}

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
              selected: true,
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
        selected: true,
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

  it('parses the stringified metadata shape returned by Kick history', () => {
    const message = normalizeMessage({
      id: 'e007f390-e69b-4f60-bd0c-1e827ce6efc9',
      chatroom_id: 25314085,
      content: 'ATAM',
      type: 'reply',
      created_at: '2026-07-16T21:04:37+00:00',
      sender: {
        id: 27903497,
        username: 'Prof_AmoLocus',
        slug: 'prof-amolocus',
        identity: {
          color: '#FFFFFF',
          badges: [{ type: 'subscriber', text: 'Subscriber', count: 4, sort_order: 9 }],
          badges_v2: [{
            name: 'level',
            badge_type: 'global',
            image_url: 'https://ext.cdn.kick.com/chat/badges/28_x.png',
            metadata: { level: 28 },
            selected: true,
            sort_order: 1,
          }],
        },
      },
      metadata: JSON.stringify({
        original_message: {
          id: 'e70e63e9-dccd-4540-8fd5-8aab8bf588aa',
          chatroom_id: 25314085,
          content: 'MUSTAFA KEMAL ATATÜRK',
          type: 'message',
          sender: { id: 7424588, username: 'Alcheyham', slug: 'alcheyham' },
        },
        original_sender: { id: 7424588, username: 'Alcheyham', slug: 'alcheyham' },
        message_ref: '1784235877280',
      }),
      thread_parent_id: 'e70e63e9-dccd-4540-8fd5-8aab8bf588aa',
    });

    expect(message?.replyContext).toEqual({
      replyToUser: 'Alcheyham',
      replyToText: 'MUSTAFA KEMAL ATATÜRK',
      replyToMessageId: 'e70e63e9-dccd-4540-8fd5-8aab8bf588aa',
      replyToUserId: 7424588,
      threadParentId: 'e70e63e9-dccd-4540-8fd5-8aab8bf588aa',
    });
  });

  it('threads real subscription-renewal celebration metadata into the message model', () => {
    const message = normalizeMessage({
      id: 'be911675-50cd-491d-84c4-cfda2502c277',
      chatroom_id: 25951243,
      content: 'Oooo 32. ay gelmiş',
      type: 'celebration',
      created_at: '2026-07-14T19:23:58+00:00',
      sender: {
        id: 28329441,
        username: 'ErenCekic02',
        slug: 'erencekic02',
        identity: {
          color: '#31D6C2',
          badges: [{ type: 'subscriber', text: 'Subscriber', count: 32, sort_order: 9 }],
          badges_v2: [{
            name: 'level', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/20_x.png',
            metadata: { level: 20 }, selected: true, sort_order: 1,
          }],
        },
      },
      metadata: {
        celebration: {
          id: 'chceleb_01KXGZF48ZJBEZYQJRT9W5DMWC',
          type: 'subscription_renewed',
          total_months: 32,
          created_at: '2026-07-14T18:50:42.335677Z',
        },
      },
    });

    expect(message?.celebration).toEqual({ type: 'subscription_renewed', totalMonths: 32 });
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

  it('normalizes live-captured subscription payloads and rejects malformed fields', () => {
    expect(normalizeSubscriptionPayload({
      chatroom_id: 15250312,
      username: 'violet_demo',
      months: 5,
    })).toEqual({ chatroomId: 15250312, username: 'violet_demo', months: 5 });

    expect(normalizeSubscriptionPayload({ chatroom_id: 1, username: 'user', months: '5' })).toBeNull();
    expect(normalizeSubscriptionPayload({ chatroom_id: 1, username: '', months: 1 })).toBeNull();
    expect(normalizeSubscriptionPayload({ chatroom_id: 1, username: 'user', months: 0 })).toBeNull();
  });

  it('normalizes ChannelSubscriptionEvent as a non-gift subscription observation', () => {
    expect(normalizeChannelSubscriptionPayload({
      user_ids: [86178773],
      username: 's4drazam1',
      channel_id: 26239555,
    })).toEqual({
      userIds: [86178773],
      username: 's4drazam1',
      channelId: 26239555,
    });

    expect(normalizeChannelSubscriptionPayload({ user_ids: [], username: 'user', channel_id: 1 })).toBeNull();
    expect(normalizeChannelSubscriptionPayload({ user_ids: [1, '2'], username: 'user', channel_id: 1 })).toBeNull();
    expect(normalizeChannelSubscriptionPayload({ user_ids: [1], username: 2, channel_id: 1 })).toBeNull();
  });

  it('normalizes a real modern multi-gift payload with explicit gifter, recipients, and count', () => {
    expect(normalizeGiftedSubscriptionsPayload({
      chatroom_id: 5389830,
      correlation_id: '340002752601361',
      gifted_usernames: [
        'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
        'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
      ],
      gifter_username: 'cozy_mert',
      gifted_total: 10,
      gifter_total: 927,
      chunk_details: null,
    })).toEqual({
      chatroomId: 5389830,
      correlationId: '340002752601361',
      giftedUsernames: [
        'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
        'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
      ],
      gifterUsername: 'cozy_mert',
      giftCount: 10,
    });

    expect(normalizeGiftedSubscriptionsPayload({
      chatroom_id: 1,
      correlation_id: '',
      gifted_usernames: ['recipient'],
      gifter_username: 'gifter',
      gifted_total: 1,
    })).toBeNull();
    expect(normalizeGiftedSubscriptionsPayload({
      chatroom_id: 1,
      correlation_id: 'purchase',
      gifted_usernames: [],
      gifter_username: 'gifter',
      gifted_total: 1,
    })).toBeNull();
    expect(normalizeGiftedSubscriptionsPayload({
      chatroom_id: 1,
      correlation_id: 'purchase',
      gifted_usernames: ['recipient'],
      gifter_username: 'gifter',
      gifted_total: '1',
    })).toBeNull();
  });

  it('normalizes a real captured KicksGifted payload and rejects malformed ones', () => {
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: '340003001122334',
      message: 'gg wp',
      sender: {
        id: 27183991,
        username: 'TallSkydiver',
        username_color: '#FF9D00',
        profile_picture: 'https://files.kick.com/images/user/27183991/profile.webp',
      },
      gift: {
        gift_id: 7,
        name: 'Rage Quit',
        amount: 500,
        type: 'kicks',
        tier: 'tier_1',
        character_limit: 200,
        pinned_time: 600000000000,
      },
      created_at: '2026-07-14T22:00:00Z',
      expires_at: '2026-07-14T22:10:00Z',
    })).toEqual({
      giftTransactionId: '340003001122334',
      senderUsername: 'TallSkydiver',
      amount: 500,
      giftName: 'Rage Quit',
      senderMessage: 'gg wp',
    });

    // Optional secondary fields collapse to null when absent/blank; the row still validates.
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: 'txn-2',
      message: '   ',
      sender: { id: 5, username: 'Solo' },
      gift: { amount: 25 },
    })).toEqual({
      giftTransactionId: 'txn-2',
      senderUsername: 'Solo',
      amount: 25,
      giftName: null,
      senderMessage: null,
    });

    // Missing / empty transaction id
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: '',
      sender: { id: 5, username: 'Solo' },
      gift: { amount: 25 },
    })).toBeNull();
    // Invalid sender id (non-positive)
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: 'txn-3',
      sender: { id: 0, username: 'Solo' },
      gift: { amount: 25 },
    })).toBeNull();
    // Missing sender username
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: 'txn-4',
      sender: { id: 5, username: '' },
      gift: { amount: 25 },
    })).toBeNull();
    // Non-integer / non-positive amount
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: 'txn-5',
      sender: { id: 5, username: 'Solo' },
      gift: { amount: 12.5 },
    })).toBeNull();
    expect(normalizeKicksGiftedPayload({
      gift_transaction_id: 'txn-6',
      sender: { id: 5, username: 'Solo' },
      gift: { amount: 0 },
    })).toBeNull();
  });

  it('normalizes host payloads with nullable messages and optional viewer counts', () => {
    expect(normalizeHostPayload({
      chatroom_id: 25314085,
      optional_message: null,
      number_viewers: 16,
      host_username: 'Mr_Jelal',
    })).toEqual({
      chatroomId: 25314085,
      hostUsername: 'Mr_Jelal',
      numberViewers: 16,
      optionalMessage: null,
    });

    expect(normalizeHostPayload({
      chatroom_id: 25314085,
      optional_message: 'Hoş geldiniz!',
      number_viewers: 24,
      host_username: 'another_host',
    })).toEqual({
      chatroomId: 25314085,
      hostUsername: 'another_host',
      numberViewers: 24,
      optionalMessage: 'Hoş geldiniz!',
    });

    expect(normalizeHostPayload({
      chatroom_id: 25314085,
      host_username: 'viewerless_host',
    })).toEqual({
      chatroomId: 25314085,
      hostUsername: 'viewerless_host',
      numberViewers: 0,
      optionalMessage: null,
    });
  });

  it('rejects malformed host payload fields', () => {
    expect(normalizeHostPayload(null)).toBeNull();
    expect(normalizeHostPayload({ chatroom_id: 0, host_username: 'host' })).toBeNull();
    expect(normalizeHostPayload({ chatroom_id: 1, host_username: '' })).toBeNull();
    expect(normalizeHostPayload({ chatroom_id: 1, host_username: 'host', number_viewers: '16' })).toBeNull();
    expect(normalizeHostPayload({ chatroom_id: 1, host_username: 'host', number_viewers: -1 })).toBeNull();
    expect(normalizeHostPayload({ chatroom_id: 1, host_username: 'host', optional_message: 42 })).toBeNull();
  });

  it('normalizes the live-captured pinned-message payload through the normal message path', () => {
    const normalized = normalizePinnedMessagePayload({
      message: {
        id: 'pin-uuid',
        chatroom_id: 25314085,
        content: 'hello [emote:123:kek]',
        type: 'message',
        created_at: '2026-07-10T16:00:00Z',
        sender: {
          id: 10,
          username: 'BotRix',
          slug: 'botrix',
          identity: { color: '#75FD46', badges: [{ type: 'moderator' }], badges_v2: [] },
        },
      },
      duration: '1200',
      pinnedBy: { id: 11, username: 'Cainethedark', slug: 'cainethedark', identity: {} },
    });

    expect(normalized).toMatchObject({
      message: {
        id: 'pin-uuid',
        chatroomId: 25314085,
        content: 'hello [emote:123:kek]',
        sender: { username: 'BotRix', identity: { badges: [{ type: 'moderator' }] } },
      },
      durationSeconds: 1200,
      pinnedBy: { id: 11, username: 'Cainethedark', slug: 'cainethedark' },
    });
    expect(normalizePinnedMessagePayload({ duration: '1200', pinnedBy: { id: 1, username: 'mod', slug: 'mod' } })).toBeNull();
    expect(normalizePinnedMessagePayload({ message: normalized?.message, duration: 'nope', pinnedBy: { id: 1, username: 'mod', slug: 'mod' } })).toBeNull();
  });

  it('normalizes the four captured chatroom modes and rejects partial/malformed state', () => {
    expect(normalizeChatroomUpdatedPayload({
      id: 25314085,
      slow_mode: { enabled: true, message_interval: 5 },
      subscribers_mode: { enabled: false },
      followers_mode: { enabled: true, min_duration: 31 },
      emotes_mode: { enabled: false },
      advanced_bot_protection: { enabled: true },
    })).toEqual({
      chatroomId: 25314085,
      slowMode: { enabled: true, messageInterval: 5 },
      subscribersMode: { enabled: false },
      followersMode: { enabled: true, minDuration: 31 },
      emotesMode: { enabled: false },
    });
    expect(normalizeChatroomUpdatedPayload({ id: 1 })).toBeNull();
    expect(normalizeChatroomUpdatedPayload({
      id: 1,
      slow_mode: { enabled: true, message_interval: '5' },
      subscribers_mode: { enabled: false },
      followers_mode: { enabled: true, min_duration: 31 },
      emotes_mode: { enabled: false },
    })).toBeNull();
  });
});

describe('PusherClient lifecycle', () => {
  function establishPrimary(socket: FakeWebSocket, chatroomId = 1): void {
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher_internal:subscription_succeeded',
        channel: `chatrooms.${chatroomId}.v2`,
        data: '{}',
      }),
    }));
  }

  it('does not treat the socket handshake as live readiness and reconnects on primary error or timeout', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onConnected = vi.fn();
    const onPrimarySubscriptionReady = vi.fn();
    const onPrimarySubscriptionUnavailable = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onConnected,
      onPrimarySubscriptionReady,
      onPrimarySubscriptionUnavailable,
    });
    client.connect();
    const first = FakeWebSocket.instances[0]!;
    first.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));

    expect(onConnected).toHaveBeenCalledOnce();
    expect(onPrimarySubscriptionReady).not.toHaveBeenCalled();
    first.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher:subscription_error',
        channel: 'chatrooms.1.v2',
        data: JSON.stringify({ status: 403 }),
      }),
    }));
    expect(onPrimarySubscriptionUnavailable).toHaveBeenCalledWith('subscription-error');
    expect(first.closeCalls).toBe(1);

    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    vi.advanceTimersByTime(10_000);
    expect(onPrimarySubscriptionUnavailable).toHaveBeenLastCalledWith('subscription-timeout');
    expect(second.closeCalls).toBe(1);
    client.dispose();
  });

  it('recovers from a constructor throw, an opening-handshake timeout, and a server error', () => {
    vi.useFakeTimers();
    const onPrimarySubscriptionUnavailable = vi.fn();
    class ThrowOnceWebSocket extends FakeWebSocket {
      static attempts = 0;
      constructor(url: string) {
        if (ThrowOnceWebSocket.attempts++ === 0) throw new Error('constructor failed');
        super(url);
      }
    }
    vi.stubGlobal('WebSocket', ThrowOnceWebSocket);
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onPrimarySubscriptionUnavailable,
    });
    client.connect();
    expect(onPrimarySubscriptionUnavailable).toHaveBeenCalledWith('constructor-error');

    vi.advanceTimersByTime(1_000);
    const opening = FakeWebSocket.instances[0]!;
    vi.advanceTimersByTime(12_000);
    expect(onPrimarySubscriptionUnavailable).toHaveBeenLastCalledWith('handshake-timeout');
    expect(opening.closeCalls).toBe(1);

    vi.advanceTimersByTime(2_000);
    const serverError = FakeWebSocket.instances[1]!;
    serverError.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    serverError.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:error', data: JSON.stringify({ code: 4201 }) }),
    }));
    expect(onPrimarySubscriptionUnavailable).toHaveBeenLastCalledWith('server-error');
    expect(serverError.closeCalls).toBe(1);
    client.dispose();
  });

  it('confirms primary readiness only for its exact subscription or a validated exact-channel frame', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onPrimarySubscriptionReady = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onPrimarySubscriptionReady,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher_internal:subscription_succeeded',
        channel: 'channel.2',
        data: '{}',
      }),
    }));
    expect(onPrimarySubscriptionReady).not.toHaveBeenCalled();

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\ChatMessageEvent',
        channel: 'chatrooms.1.v2',
        data: JSON.stringify({
          id: 'proof', content: 'ready', created_at: '', chatroom_id: 1,
          sender: { id: 1, username: 'u', slug: 'u' },
        }),
      }),
    }));
    expect(onPrimarySubscriptionReady).toHaveBeenCalledOnce();
    client.dispose();
  });

  it('ignores a queued socket message after disposal', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onMessage = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage,
      onUserBanned: vi.fn(),
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');

    client.dispose();
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\ChatMessageEvent',
        data: JSON.stringify({
          id: 'late-message',
          content: 'late',
          sender: { id: 1, username: 'user', slug: 'user' },
        }),
      }),
    }));

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('keeps only the replacement session live across rapid mode and channel lifecycle changes', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const staleMessages = vi.fn();
    const currentMessages = vi.fn();
    const first = new PusherClient(1, 2, {
      onMessage: staleMessages,
      onUserBanned: vi.fn(),
    });
    first.connect();
    const staleSocket = FakeWebSocket.instances[0]!;
    establishPrimary(staleSocket, 1);
    first.dispose();

    const replacement = new PusherClient(3, 4, {
      onMessage: currentMessages,
      onUserBanned: vi.fn(),
    });
    replacement.connect();
    const currentSocket = FakeWebSocket.instances[1]!;
    establishPrimary(currentSocket, 3);
    const frame = (channel: string, id: string) => JSON.stringify({
      event: 'App\\Events\\ChatMessageEvent',
      channel,
      data: JSON.stringify({
        id, content: id, created_at: '', chatroom_id: 3,
        sender: { id: 1, username: 'u', slug: 'u' },
      }),
    });
    staleSocket.dispatchEvent(new MessageEvent('message', { data: frame('chatrooms.1.v2', 'stale') }));
    currentSocket.dispatchEvent(new MessageEvent('message', { data: frame('chatrooms.3.v2', 'current') }));

    expect(staleSocket.closeCalls).toBe(1);
    expect(currentSocket.closeCalls).toBe(0);
    expect(staleMessages).not.toHaveBeenCalled();
    expect(currentMessages).toHaveBeenCalledWith(expect.objectContaining({ id: 'current' }));
    replacement.dispose();
  });

  it('probes an idle connection and stays connected when any frame arrives in reply', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onDisconnected = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onDisconnected,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');
    establishPrimary(socket);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(socket.sent).toContain(JSON.stringify({ event: 'pusher:ping', data: {} }));

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:pong', data: {} }),
    }));
    vi.advanceTimersByTime(30_000);

    expect(onDisconnected).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.dispose();
  });

  it('reconnects when an idle probe receives no reply', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onDisconnected = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onDisconnected,
    });
    client.connect();
    establishPrimary(FakeWebSocket.instances[0]!);

    vi.advanceTimersByTime(2 * 60 * 1000 + 30_000);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    client.dispose();
  });

  it('suppresses the exact captured ChannelSubscriptionEvent/SubscriptionEvent overlap as one self-sub', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onSubscription = vi.fn();
    const onGiftedSubscriptions = vi.fn();
    const client = new PusherClient(25951243, 26239555, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onSubscription,
      onGiftedSubscriptions,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');
    establishPrimary(socket, 25951243);

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\ChannelSubscriptionEvent',
        channel: 'channel.26239555',
        data: '{"user_ids":[86178773],"username":"s4drazam1","channel_id":26239555}',
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\SubscriptionEvent',
        channel: 'chatrooms.25951243.v2',
        data: '{"chatroom_id":25951243,"username":"s4drazam1","months":9}',
      }),
    }));

    expect(onSubscription).toHaveBeenCalledOnce();
    expect(onSubscription).toHaveBeenCalledWith({ chatroomId: 25951243, username: 's4drazam1', months: 9 });
    expect(onGiftedSubscriptions).not.toHaveBeenCalled();
    client.dispose();
  });

  it('subscribes to all four product channels and routes a modern gift explicitly', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onSubscription = vi.fn();
    const onGiftedSubscriptions = vi.fn();
    const onHost = vi.fn();
    const onPinnedMessage = vi.fn();
    const onChatroomUpdated = vi.fn();
    const client = new PusherClient(15250312, 15462911, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onSubscription,
      onGiftedSubscriptions,
      onHost,
      onPinnedMessage,
      onChatroomUpdated,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.15250312.v2' } },
      { event: 'pusher:subscribe', data: { auth: '', channel: 'channel.15462911' } },
      { event: 'pusher:subscribe', data: { auth: '', channel: 'chatroom_15250312' } },
      { event: 'pusher:subscribe', data: { auth: '', channel: 'channel_15462911' } },
    ]);

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher_internal:subscription_succeeded',
        channel: 'chatroom_15250312',
        data: '{}',
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\PinnedMessageCreatedEvent',
        channel: 'chatrooms.15250312.v2',
        data: JSON.stringify({
          message: {
            id: 'pin-1',
            chatroom_id: 15250312,
            content: 'pinned',
            type: 'message',
            created_at: '2026-07-10T16:00:00Z',
            sender: { id: 4, username: 'BotRix', slug: 'botrix', identity: { color: '#75FD46', badges: [], badges_v2: [] } },
          },
          duration: '1200',
          pinnedBy: { id: 5, username: 'moderator', slug: 'moderator' },
        }),
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\ChatroomUpdatedEvent',
        channel: 'chatrooms.15250312.v2',
        data: JSON.stringify({
          id: 15250312,
          slow_mode: { enabled: true, message_interval: 5 },
          subscribers_mode: { enabled: false },
          followers_mode: { enabled: true, min_duration: 31 },
          emotes_mode: { enabled: false },
        }),
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\SubscriptionEvent',
        channel: 'chatrooms.15250312.v2',
        data: JSON.stringify({ chatroom_id: 15250312, username: 's4drazam1', months: 9 }),
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\ChannelSubscriptionEvent',
        channel: 'channel.15462911',
        data: JSON.stringify({ user_ids: [86178773], username: 's4drazam1', channel_id: 15462911 }),
      }),
    }));
    expect(onSubscription).toHaveBeenCalledOnce();
    expect(onSubscription).toHaveBeenCalledWith({ chatroomId: 15250312, username: 's4drazam1', months: 9 });
    expect(onGiftedSubscriptions).not.toHaveBeenCalled();

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'GiftedSubscriptionsEvent',
        channel: 'chatroom_15250312',
        data: JSON.stringify({
          chatroom_id: 15250312,
          correlation_id: '340002752601361',
          gifted_usernames: [
            'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
            'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
          ],
          gifter_username: 'cozy_mert',
          gifted_total: 10,
          gifter_total: 927,
          chunk_details: null,
        }),
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'App\\Events\\StreamHostEvent',
        channel: 'chatrooms.15250312.v2',
        data: JSON.stringify({
          chatroom_id: 15250312,
          optional_message: null,
          number_viewers: 16,
          host_username: 'Mr_Jelal',
        }),
      }),
    }));

    expect(onGiftedSubscriptions).toHaveBeenCalledOnce();
    expect(onGiftedSubscriptions).toHaveBeenCalledWith({
      chatroomId: 15250312,
      correlationId: '340002752601361',
      giftedUsernames: [
        'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
        'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
      ],
      gifterUsername: 'cozy_mert',
      giftCount: 10,
    });
    expect(onHost).toHaveBeenCalledOnce();
    expect(onHost).toHaveBeenCalledWith({
      chatroomId: 15250312,
      hostUsername: 'Mr_Jelal',
      numberViewers: 16,
      optionalMessage: null,
    });
    expect(onPinnedMessage).toHaveBeenCalledOnce();
    expect(onPinnedMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ id: 'pin-1', content: 'pinned' }),
      durationSeconds: 1200,
      pinnedBy: { id: 5, username: 'moderator', slug: 'moderator' },
    }));
    expect(onChatroomUpdated).toHaveBeenCalledWith({
      chatroomId: 15250312,
      slowMode: { enabled: true, messageInterval: 5 },
      subscribersMode: { enabled: false },
      followersMode: { enabled: true, minDuration: 31 },
      emotesMode: { enabled: false },
    });
    client.dispose();
  });

  it('logs a gift-channel subscription error and skips modern gift events gracefully', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onGiftedSubscriptions = vi.fn();
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onGiftedSubscriptions,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher:subscription_error',
        channel: 'chatroom_1',
        data: JSON.stringify({ status: 403, message: 'denied' }),
      }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'GiftedSubscriptionsEvent',
        channel: 'chatroom_1',
        data: JSON.stringify({
          chatroom_id: 1,
          correlation_id: 'purchase-1',
          gifted_usernames: ['recipient'],
          gifter_username: 'gifter',
          gifted_total: 1,
        }),
      }),
    }));

    expect(warn).toHaveBeenCalledWith(
      '[KickFlow]',
      'pusher-client: gift channel subscription failed; gifted subscriptions disabled',
      'chatroom_1',
      '{"status":403,"message":"denied"}',
    );
    expect(onGiftedSubscriptions).not.toHaveBeenCalled();
    client.dispose();
  });

  it('logs and disables gifted subscriptions when channel confirmation never arrives', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new PusherClient(1, 2, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onGiftedSubscriptions: vi.fn(),
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher_internal:subscription_succeeded',
        channel: 'chatrooms.1.v2',
        data: '{}',
      }),
    }));
    vi.advanceTimersByTime(10_000);

    expect(warn).toHaveBeenCalledWith(
      '[KickFlow]',
      'pusher-client: gift channel subscription was not confirmed; gifted subscriptions disabled',
      'chatroom_1',
    );
    client.dispose();
  });

  it('routes a KicksGifted event on channel_{channelId} and ignores leaderboard updates', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onKicksGifted = vi.fn();
    const client = new PusherClient(15250312, 15462911, {
      onMessage: vi.fn(),
      onUserBanned: vi.fn(),
      onKicksGifted,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('missing fake socket');

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
    }));
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'pusher_internal:subscription_succeeded',
        channel: 'channel_15462911',
        data: '{}',
      }),
    }));

    // Leaderboard state on the same channel must never become a Kicks row.
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'KicksLeaderboardUpdated',
        channel: 'channel_15462911',
        data: JSON.stringify({ leaderboard: [{ username: 'TallSkydiver', amount: 500 }] }),
      }),
    }));
    expect(onKicksGifted).not.toHaveBeenCalled();

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'KicksGifted',
        channel: 'channel_15462911',
        data: JSON.stringify({
          gift_transaction_id: '340003001122334',
          message: 'gg wp',
          sender: { id: 27183991, username: 'TallSkydiver', username_color: '#FF9D00' },
          gift: { gift_id: 7, name: 'Rage Quit', amount: 500, type: 'kicks', tier: 'tier_1' },
          created_at: '2026-07-14T22:00:00Z',
          expires_at: '2026-07-14T22:10:00Z',
        }),
      }),
    }));

    expect(onKicksGifted).toHaveBeenCalledOnce();
    expect(onKicksGifted).toHaveBeenCalledWith({
      giftTransactionId: '340003001122334',
      senderUsername: 'TallSkydiver',
      amount: 500,
      giftName: 'Rage Quit',
      senderMessage: 'gg wp',
    });
    client.dispose();
  });
});
