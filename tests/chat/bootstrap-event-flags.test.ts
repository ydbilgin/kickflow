import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
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
    });

    featureFlags.showSubscriptions = false;
    featureFlags.showGiftedSubs = false;
    featureFlags.showHostRaid = false;
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 5 });
    callbacks.onGiftedSubscriptions({
      chatroomId: 15250312,
      correlationId: 'disabled-gift',
      giftedUsernames: ['one', 'two'],
      gifterUsername: 'gifter',
      giftCount: 2,
    });
    callbacks.onHost({ chatroomId: 15250312, hostUsername: 'raider', numberViewers: 16, optionalMessage: null });
    expect(store.getMessagesInArrivalOrder()).toEqual([]);

    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = true;
    featureFlags.showHostRaid = true;
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 5 });
    callbacks.onGiftedSubscriptions({
      chatroomId: 15250312,
      correlationId: '340002752601361',
      giftedUsernames: [
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
      ],
      gifterUsername: '***REMOVED***',
      giftCount: 10,
    });
    callbacks.onHost({ chatroomId: 15250312, hostUsername: 'raider', numberViewers: 16, optionalMessage: null });

    expect(store.getMessagesInArrivalOrder().map((message) => message.systemEvent?.kind)).toEqual([
      'subscription',
      'gifted-subscription',
      'host',
    ]);
    expect(store.getMessagesInArrivalOrder()[1]?.systemEvent).toEqual({
      kind: 'gifted-subscription',
      username: '***REMOVED***',
      giftCount: 10,
    });
  });

  it('dedupes a repeated modern gift frame by its captured correlation id', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showGiftedSubs = true;
    const capturedGift = {
      chatroomId: 5389830,
      correlationId: '340002752602494',
      giftedUsernames: [
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
        '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***', '***REMOVED***',
      ],
      gifterUsername: '***REMOVED***',
      giftCount: 28,
    };

    callbacks.onGiftedSubscriptions(capturedGift);
    callbacks.onGiftedSubscriptions(capturedGift);

    expect(store.getMessagesInArrivalOrder()).toHaveLength(1);
    expect(store.getMessagesInArrivalOrder()[0]?.id).toBe('gift:5389830:340002752602494');
  });

  it('creates one subscribed row and no gift row for the captured self-sub fixture', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = true;

    callbacks.onSubscription({ chatroomId: 25951243, username: 's4drazam1', months: 9 });

    const rows = store.getMessagesInArrivalOrder();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.systemEvent).toEqual({ kind: 'subscription', username: 's4drazam1', months: 9 });
    expect(rows.some((message) => message.systemEvent?.kind === 'gifted-subscription')).toBe(false);
  });

  it('keeps the first mode snapshot silent, diffs all changed modes, and dedupes identical state', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
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
    });
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

  it('applyFlagChange handles and persists all four event boolean keys', () => {
    storageSet.mockClear();

    bootstrap.applyFlagChange('showSubscriptions', false);
    bootstrap.applyFlagChange('showGiftedSubs', false);
    bootstrap.applyFlagChange('showHostRaid', false);
    bootstrap.applyFlagChange('showModeChanges', false);

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(false);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showModeChanges).toBe(false);
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showSubscriptions: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showGiftedSubs: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showHostRaid: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showModeChanges: false });
  });

  it('loads all four persisted boolean overrides', async () => {
    storageGet.mockResolvedValue({
      kf_flag_showSubscriptions: false,
      kf_flag_showGiftedSubs: true,
      kf_flag_showHostRaid: false,
      kf_flag_showModeChanges: true,
    });
    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = false;
    featureFlags.showHostRaid = true;
    featureFlags.showModeChanges = false;

    await bootstrap.applySavedFlags();

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(true);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showModeChanges).toBe(true);
  });

  it('includes all four values in the popup status flag payload', () => {
    featureFlags.showSubscriptions = false;
    featureFlags.showGiftedSubs = true;
    featureFlags.showHostRaid = false;
    featureFlags.showModeChanges = false;

    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      showSubscriptions: false,
      showGiftedSubs: true,
      showHostRaid: false,
      showModeChanges: false,
    });
  });

  it('persists, loads, and reports the auto-theater flag through the shared flag path', async () => {
    storageSet.mockClear();
    featureFlags.autoTheater = false;

    bootstrap.applyFlagChange('autoTheater', true);
    expect(featureFlags.autoTheater).toBe(true);
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_autoTheater: true });
    expect(bootstrap.getPopupFeatureFlags().autoTheater).toBe(true);

    storageGet.mockResolvedValue({ kf_flag_autoTheater: false });
    await bootstrap.applySavedFlags();
    expect(featureFlags.autoTheater).toBe(false);
  });

  it('persists, loads, and reports every newly toggleable player feature', async () => {
    storageSet.mockClear();
    for (const key of ['rewindControls', 'liveCatchup', 'qualityLock', 'screenshot', 'speedControls'] as const) {
      bootstrap.applyFlagChange(key, false);
      expect(featureFlags[key]).toBe(false);
      expect(storageSet).toHaveBeenCalledWith({ [`kf_flag_${key}`]: false });
      expect(bootstrap.getPopupFeatureFlags()[key]).toBe(false);
    }

    storageGet.mockResolvedValue({
      kf_flag_rewindControls: true,
      kf_flag_liveCatchup: true,
      kf_flag_qualityLock: true,
      kf_flag_screenshot: true,
      kf_flag_speedControls: true,
    });
    await bootstrap.applySavedFlags();
    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      rewindControls: true,
      liveCatchup: true,
      qualityLock: true,
      screenshot: true,
      speedControls: true,
    });
  });

  it('live OFF tears down each mounted player surface and ON remounts it without restarting chat', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const nativeLive = document.createElement('button');
    nativeLive.textContent = 'LIVE';
    bar.append(nativeLive);
    wrapper.append(video, bar);
    document.body.append(wrapper);
    for (const key of ['rewindControls', 'liveCatchup', 'qualityLock', 'screenshot', 'speedControls'] as const) {
      featureFlags[key] = true;
    }
    const lifecycle = new Lifecycle();
    bootstrap.initPlayerQolSession(lifecycle);

    expect(document.getElementById('kickflow-rewind-controls')).not.toBeNull();
    expect(document.getElementById('kickflow-catchup-controls')).not.toBeNull();
    expect(document.getElementById('kickflow-speed-controls')).not.toBeNull();
    expect(document.getElementById('kickflow-screenshot-controls')).not.toBeNull();

    bootstrap.applyFlagChange('rewindControls', false);
    bootstrap.applyFlagChange('liveCatchup', false);
    bootstrap.applyFlagChange('screenshot', false);
    bootstrap.applyFlagChange('speedControls', false);
    bootstrap.applyFlagChange('qualityLock', false);
    expect(document.querySelector('[id^="kickflow-"][id$="-controls"]')).toBeNull();

    bootstrap.applyFlagChange('rewindControls', true);
    expect(document.getElementById('kickflow-rewind-controls')).not.toBeNull();

    lifecycle.dispose();
    document.body.replaceChildren();
  });

  it('uses one deduplicated live snapshot for the popup bridge and dashboard provider', () => {
    document.body.innerHTML = `
      <div id="chatroom-messages"><div data-index="1"></div><div data-index="2"></div></div>
      <div class="kickflow-preserved kickflow-banned" data-message-id="same"></div>
      <div class="kickflow-preserved kickflow-banned" data-kickflow-mid="same"></div>
      <div class="kickflow-preserved kickflow-banned" data-kickflow-ghost-mid="same"></div>
      <div class="kickflow-preserved kickflow-banned" data-kickflow-removed-mid="same"></div>
      <div class="kickflow-preserved kickflow-deleted" data-kickflow-ghost-mid="deleted"></div>
      <div class="kickflow-preserved kickflow-deleted" data-kickflow-removed-mid="deleted"></div>
    `;

    expect(bootstrap.countUniqueStatusMessages('.kickflow-preserved')).toBe(2);
    expect(bootstrap.countUniqueStatusMessages('.kickflow-banned')).toBe(1);
    expect(bootstrap.countUniqueStatusMessages('.kickflow-deleted')).toBe(1);
    const snapshot = bootstrap.getLiveStatusSnapshot();
    expect(snapshot).toMatchObject({
      messageCount: 2,
      preservedCount: 2,
      bannedCount: 1,
      deletedCount: 1,
      ghostAnchored: 0,
      ghostPendingNoAnchor: 0,
      ghostEvicted: 0,
    });

    const listener = addMessageListener.mock.calls[0]?.[0] as (
      message: { type: string },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => void;
    expect(listener).toBeTypeOf('function');
    let bridgeResponse: unknown;
    listener(
      { type: 'kickflow:getStatus' },
      {} as chrome.runtime.MessageSender,
      (response) => { bridgeResponse = response; },
    );
    expect(bridgeResponse).toMatchObject(snapshot);
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

  it('bounds and aborts every hung channel-resolution attempt before returning native fallback', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));

    try {
      const pending = bootstrap.resolveChannel('hung-channel');
      await vi.advanceTimersByTimeAsync(6_000 + 800 + 6_000 + 1_600 + 6_000);

      await expect(pending).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });
});
