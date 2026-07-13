import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage, type PinnedMessage } from '../../src/content/chat/message-store';
import { buildMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import { configureUserCardSession, openUserCard } from '../../src/content/chat/user-card';
import { Lifecycle } from '../../src/content/shared/lifecycle';

type BootstrapModule = typeof import('../../src/content/bootstrap');

const originalFlags = { ...featureFlags };
const storageGet = vi.fn(async (): Promise<Record<string, unknown>> => ({}));
const storageSet = vi.fn(async (): Promise<void> => undefined);
const addMessageListener = vi.fn();
let bootstrap: BootstrapModule;

beforeAll(async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(window, 'setInterval').mockReturnValue(1);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'kickflow-test',
      onMessage: { addListener: addMessageListener },
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
      },
    },
  });

  bootstrap = await import('../../src/content/bootstrap');
  await Promise.resolve();
  await Promise.resolve();
});

afterAll(() => {
  Object.assign(featureFlags, originalFlags);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bootstrap event display flags', () => {
  it('keeps disabled event types out of the store and enqueues them once re-enabled', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    }, 15250312);

    featureFlags.showSubscriptions = false;
    featureFlags.showGiftedSubs = false;
    featureFlags.showHostRaid = false;
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 5 });
    callbacks.onChannelSubscription({ channelId: 15462911, username: 'gifter', userIds: [1, 2], giftCount: 2 });
    callbacks.onHost({ chatroomId: 15250312, hostUsername: 'raider', numberViewers: 16, optionalMessage: null });
    expect(store.getMessagesInArrivalOrder()).toEqual([]);

    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = true;
    featureFlags.showHostRaid = true;
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 5 });
    callbacks.onChannelSubscription({ channelId: 15462911, username: 'gifter', userIds: [1, 2], giftCount: 2 });
    callbacks.onHost({ chatroomId: 15250312, hostUsername: 'raider', numberViewers: 16, optionalMessage: null });

    expect(store.getMessagesInArrivalOrder().map((message) => message.systemEvent?.kind)).toEqual([
      'subscription',
      'gifted-subscription',
      'host',
    ]);
  });

  it('keeps the first mode snapshot silent, diffs all changed modes, and dedupes identical state', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    }, 25314085);
    featureFlags.showModeChanges = true;

    callbacks.onChatroomUpdated({
      chatroomId: 25314085,
      slowMode: { enabled: false, messageInterval: 0 },
      followersMode: { enabled: false, minDuration: 0 },
      subscribersMode: { enabled: false },
      emotesMode: { enabled: true },
    });
    expect(store.getMessagesInArrivalOrder()).toEqual([]);

    const changed = {
      chatroomId: 25314085,
      slowMode: { enabled: true, messageInterval: 5 },
      followersMode: { enabled: true, minDuration: 31 },
      subscribersMode: { enabled: true },
      emotesMode: { enabled: false },
    };
    callbacks.onChatroomUpdated(changed);
    callbacks.onChatroomUpdated(changed);
    callbacks.onChatroomUpdated({
      chatroomId: 25314085,
      slowMode: { enabled: false, messageInterval: 0 },
      followersMode: { enabled: false, minDuration: 0 },
      subscribersMode: { enabled: false },
      emotesMode: { enabled: true },
    });

    expect(store.getMessagesInArrivalOrder().map(({ id, systemEvent }) => ({ id, systemEvent }))).toEqual([
      {
        id: 'mode:25314085:slow_mode:1',
        systemEvent: { kind: 'mode', mode: 'slow_mode', text: 'Yavaş mod açıldı (5sn)' },
      },
      {
        id: 'mode:25314085:followers_mode:2',
        systemEvent: { kind: 'mode', mode: 'followers_mode', text: 'Sadece takipçi modu açıldı (31dk)' },
      },
      {
        id: 'mode:25314085:subscribers_mode:3',
        systemEvent: { kind: 'mode', mode: 'subscribers_mode', text: 'Sadece abone modu açıldı' },
      },
      {
        id: 'mode:25314085:emotes_mode:4',
        systemEvent: { kind: 'mode', mode: 'emotes_mode', text: 'Sadece emote modu kapandı' },
      },
      {
        id: 'mode:25314085:slow_mode:5',
        systemEvent: { kind: 'mode', mode: 'slow_mode', text: 'Yavaş mod kapandı' },
      },
      {
        id: 'mode:25314085:followers_mode:6',
        systemEvent: { kind: 'mode', mode: 'followers_mode', text: 'Sadece takipçi modu kapandı' },
      },
      {
        id: 'mode:25314085:subscribers_mode:7',
        systemEvent: { kind: 'mode', mode: 'subscribers_mode', text: 'Sadece abone modu kapandı' },
      },
      {
        id: 'mode:25314085:emotes_mode:8',
        systemEvent: { kind: 'mode', mode: 'emotes_mode', text: 'Sadece emote modu açıldı' },
      },
    ]);
  });

  it('updates mode baseline while disabled and only announces later changes after re-enable', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    }, 1);
    const state = (slow: boolean, subscribers: boolean) => ({
      chatroomId: 1,
      slowMode: { enabled: slow, messageInterval: slow ? 10 : 0 },
      followersMode: { enabled: false, minDuration: 0 },
      subscribersMode: { enabled: subscribers },
      emotesMode: { enabled: false },
    });

    featureFlags.showModeChanges = false;
    callbacks.onChatroomUpdated(state(false, false));
    callbacks.onChatroomUpdated(state(true, false));
    featureFlags.showModeChanges = true;
    callbacks.onChatroomUpdated(state(true, false));
    expect(store.getMessagesInArrivalOrder()).toEqual([]);

    callbacks.onChatroomUpdated(state(true, true));
    expect(store.getMessagesInArrivalOrder().map((item) => item.systemEvent)).toEqual([
      { kind: 'mode', mode: 'subscribers_mode', text: 'Sadece abone modu açıldı' },
    ]);
  });

  it('renders one active pin, dismisses only its id, shows a new id, and obeys the global flag', () => {
    const host = document.createElement('div');
    const onShow = vi.fn();
    const controller = bootstrap.createPinnedMessageController(host, onShow);
    const pin = (id: string, content: string): PinnedMessage => ({
      message: {
        id,
        chatroomId: 1,
        content,
        type: 'message',
        createdAt: '',
        sender: {
          id: 2,
          username: 'sender',
          slug: 'sender',
          identity: { color: '', badges: [], badgesV2: [] },
        },
        preserved: false,
      },
      durationSeconds: 1200,
      pinnedBy: { id: 3, username: 'moderator', slug: 'moderator' },
    });

    featureFlags.showPinnedMessage = true;
    controller.onPinnedMessage(pin('pin-1', 'first'));
    controller.onPinnedMessage(pin('pin-1', 'duplicate'));
    expect(host.querySelectorAll('.kickflow-pinned-message')).toHaveLength(1);
    expect(onShow).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('first');
    expect(host.textContent).not.toContain('duplicate');

    host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__dismiss')?.click();
    expect(host.childElementCount).toBe(0);
    controller.onPinnedMessage(pin('pin-2', 'second'));
    expect(host.textContent).toContain('second');

    featureFlags.showPinnedMessage = false;
    controller.refresh();
    controller.onPinnedMessage(pin('pin-3', 'hidden'));
    expect(host.childElementCount).toBe(0);
  });

  it('applyFlagChange handles and persists all five event boolean keys', () => {
    storageSet.mockClear();

    bootstrap.applyFlagChange('showSubscriptions', false);
    bootstrap.applyFlagChange('showGiftedSubs', false);
    bootstrap.applyFlagChange('showHostRaid', false);
    bootstrap.applyFlagChange('showPinnedMessage', false);
    bootstrap.applyFlagChange('showModeChanges', false);

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(false);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showPinnedMessage).toBe(false);
    expect(featureFlags.showModeChanges).toBe(false);
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showSubscriptions: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showGiftedSubs: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showHostRaid: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showPinnedMessage: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showModeChanges: false });
  });

  it('loads all five persisted boolean overrides', async () => {
    storageGet.mockResolvedValue({
      kf_flag_showSubscriptions: false,
      kf_flag_showGiftedSubs: true,
      kf_flag_showHostRaid: false,
      kf_flag_showPinnedMessage: false,
      kf_flag_showModeChanges: true,
    });
    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = false;
    featureFlags.showHostRaid = true;
    featureFlags.showPinnedMessage = true;
    featureFlags.showModeChanges = false;

    await bootstrap.applySavedFlags();

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(true);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showPinnedMessage).toBe(false);
    expect(featureFlags.showModeChanges).toBe(true);
  });

  it('includes all five values in the popup status flag payload', () => {
    featureFlags.showSubscriptions = false;
    featureFlags.showGiftedSubs = true;
    featureFlags.showHostRaid = false;
    featureFlags.showPinnedMessage = true;
    featureFlags.showModeChanges = false;

    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      showSubscriptions: false,
      showGiftedSubs: true,
      showHostRaid: false,
      showPinnedMessage: true,
      showModeChanges: false,
    });
  });

  it('deduplicates popup moderation counts across list, ghost, and panel copies', () => {
    document.body.innerHTML = `
      <div class="kickflow-preserved kickflow-banned" data-message-id="same"></div>
      <div class="kickflow-preserved kickflow-banned" data-kickflow-mid="same"></div>
      <div class="kickflow-preserved kickflow-banned" data-kickflow-ghost-mid="same"></div>
      <div class="kickflow-preserved kickflow-deleted" data-kickflow-ghost-mid="deleted"></div>
    `;

    expect(bootstrap.countUniqueStatusMessages('.kickflow-preserved')).toBe(2);
    expect(bootstrap.countUniqueStatusMessages('.kickflow-banned')).toBe(1);
    expect(bootstrap.countUniqueStatusMessages('.kickflow-deleted')).toBe(1);
    document.body.replaceChildren();
  });

  it('keeps a normally retained Mode-A row when its preservation expires', () => {
    const registry = new ChatDomRegistry();
    let store!: ChatIntegrityStore;
    store = new ChatIntegrityStore({
      onPreservedEvicted: (message) => bootstrap.reconcileOwnPreservedEviction(message, store, registry),
    });
    const message: ChatMessage = {
      id: 'ttl-row', chatroomId: 1, content: 'still retained', type: 'message', createdAt: '',
      sender: { id: 7, username: 'alice', slug: 'alice', identity: { color: '', badges: [], badgesV2: [] } },
      preserved: false,
    };
    store.addMessage(message);
    store.markMessageDeleted(message.id, { deletedBy: 'mod' });
    const row = buildMessageElement(message);
    registry.register(row, message);
    document.body.append(row);

    store.sweepExpiredPreserved(Date.now() + 10 * 60 * 1000 + 1);

    expect(store.getMessageById(message.id)).toBe(message);
    expect(row.isConnected).toBe(true);
    expect(row.classList.contains('kickflow-preserved')).toBe(false);
    expect(row.querySelector('.kickflow-status-label, .kickflow-mod-label')).toBeNull();
    expect(registry.getElementForMessageId(message.id)).toBe(row);
    row.remove();
  });

  it('configures user cards and clears prior subscriber-badge assets in native mode', async () => {
    const priorMode = featureFlags.chatMode;
    featureFlags.chatMode = 'native';
    document.body.innerHTML = '<div id="chatroom-messages"><div class="no-scrollbar"></div></div>';
    setSubscriberBadges([{ months: 1, src: 'https://files.kick.com/old-channel-badge.png' }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    const lifecycle = new Lifecycle();

    try {
      bootstrap.initChatIntegrity('current-channel', lifecycle);
      const subscriber = buildMessageElement({
        id: 'subscriber', chatroomId: 1, content: 'hello', type: 'message', createdAt: '',
        sender: {
          id: 8, username: 'subscriber', slug: 'subscriber',
          identity: { color: '', badges: [{ type: 'subscriber', count: 12 }], badgesV2: [] },
        },
        preserved: false,
      });
      expect(subscriber.querySelector('.kickflow-badge-icon')).toBeNull();
      expect(subscriber.querySelector('.kickflow-badge-role')).not.toBeNull();

      await openUserCard('alice', 'Alice', 10, 10);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://kick.com/api/v2/channels/current-channel/users/alice',
        { headers: { accept: 'application/json' } },
      );
    } finally {
      lifecycle.dispose();
      configureUserCardSession(null);
      setSubscriberBadges([]);
      featureFlags.chatMode = priorMode;
      fetchSpy.mockRestore();
      document.body.replaceChildren();
    }
  });
});
