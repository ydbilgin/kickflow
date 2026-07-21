import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { buildMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import { configureUserCardSession, openUserCard } from '../../src/content/chat/user-card';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { hexToRgb, rgbToHsl } from '../../src/content/chat/message-highlight';

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
  setLang('tr');

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
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 1 });
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
    callbacks.onSubscription({ chatroomId: 15250312, username: 'subscriber', months: 1 });
    const capturedRecipients = [
      'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
      'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
    ];
    callbacks.onGiftedSubscriptions({
      chatroomId: 15250312,
      correlationId: '340002752601361',
      giftedUsernames: capturedRecipients,
      gifterUsername: 'cozy_mert',
      giftCount: 10,
    });
    callbacks.onHost({ chatroomId: 15250312, hostUsername: 'raider', numberViewers: 16, optionalMessage: null });

    expect(store.getMessagesInArrivalOrder().map((message) => message.systemEvent?.kind)).toEqual([
      'subscription',
      'gifted-subscription',
      'host',
    ]);
    // The recipient list must survive the payload → system-event conversion (it used to be dropped).
    expect(store.getMessagesInArrivalOrder()[1]?.systemEvent).toEqual({
      kind: 'gifted-subscription',
      username: 'cozy_mert',
      giftCount: 10,
      giftedUsernames: capturedRecipients,
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
        'selin_demo', 'arda_fake', 'masal_test', 'efe_mock', 'duru_sample',
        'can_demo', 'zeynep_fake', 'emir_test', 'ada_mock', 'bora_sample', 'nehir_demo',
        'kerem_fake', 'ilay_test', 'mira_mock', 'alp_sample', 'ece_demo', 'kaan_fake',
        'lara_test', 'mete_mock', 'naz_sample', 'baran_demo', 'peri_fake', 'oyku_test',
        'oyku_test', 'tuna_mock', 'tuna_mock', 'sena_sample', 'sena_sample',
      ],
      gifterUsername: 'cozy_mert',
      giftCount: 28,
    };

    callbacks.onGiftedSubscriptions(capturedGift);
    callbacks.onGiftedSubscriptions(capturedGift);

    expect(store.getMessagesInArrivalOrder()).toHaveLength(1);
    expect(store.getMessagesInArrivalOrder()[0]?.id).toBe('gift:5389830:340002752602494');
  });

  it('matches native by suppressing the captured renewal SubscriptionEvent', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = true;

    callbacks.onSubscription({ chatroomId: 25951243, username: 's4drazam1', months: 9 });

    const rows = store.getMessagesInArrivalOrder();
    expect(rows).toHaveLength(0);
    expect(rows.some((message) => message.systemEvent?.kind === 'gifted-subscription')).toBe(false);
  });

  it('still creates the native-compatible row for a first-month SubscriptionEvent', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showSubscriptions = true;

    callbacks.onSubscription({ chatroomId: 25951243, username: 'first_month', months: 1 });

    expect(store.getMessagesInArrivalOrder()[0]?.systemEvent).toEqual({
      kind: 'subscription',
      username: 'first_month',
      months: 1,
    });
  });

  it('creates one kicks row with the captured sender, amount, and optional fields', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showKicks = true;

    callbacks.onKicksGifted({
      giftTransactionId: '340003001122334',
      senderUsername: 'TallSkydiver',
      amount: 500,
      giftName: 'Rage Quit',
      senderMessage: 'gg wp',
    });

    const rows = store.getMessagesInArrivalOrder();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('kicks:340003001122334');
    expect(rows[0]?.systemEvent).toEqual({
      kind: 'kicks',
      username: 'TallSkydiver',
      amount: 500,
      giftName: 'Rage Quit',
      senderMessage: 'gg wp',
    });
  });

  it('dedupes a replayed kicks frame by its gift_transaction_id', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showKicks = true;
    const captured = {
      giftTransactionId: '340003001122334',
      senderUsername: 'TallSkydiver',
      amount: 500,
      giftName: 'Rage Quit',
      senderMessage: null,
    };

    callbacks.onKicksGifted(captured);
    callbacks.onKicksGifted(captured);

    expect(store.getMessagesInArrivalOrder()).toHaveLength(1);
  });

  it('does not ingest kicks rows when showKicks is off', () => {
    const store = new ChatIntegrityStore();
    const callbacks = bootstrap.createSystemEventCallbacks((message) => {
      store.addMessage(message);
    });
    featureFlags.showKicks = false;

    callbacks.onKicksGifted({
      giftTransactionId: 'txn-off',
      senderUsername: 'TallSkydiver',
      amount: 500,
      giftName: null,
      senderMessage: null,
    });

    expect(store.getMessagesInArrivalOrder()).toEqual([]);
    featureFlags.showKicks = true;
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

  it('applyFlagChange handles and persists all event boolean keys, including reserved native polls', () => {
    storageSet.mockClear();

    bootstrap.applyFlagChange('showSubscriptions', false);
    bootstrap.applyFlagChange('showGiftedSubs', false);
    bootstrap.applyFlagChange('showKicks', false);
    bootstrap.applyFlagChange('showPolls', false);
    bootstrap.applyFlagChange('showHostRaid', false);
    bootstrap.applyFlagChange('showModeChanges', false);

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(false);
    expect(featureFlags.showKicks).toBe(false);
    expect(featureFlags.showPolls).toBe(false);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showModeChanges).toBe(false);
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showSubscriptions: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showGiftedSubs: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showKicks: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showPolls: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showHostRaid: false });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_showModeChanges: false });
  });

  it('loads all persisted event boolean overrides', async () => {
    storageGet.mockResolvedValue({
      kf_flag_showSubscriptions: false,
      kf_flag_showGiftedSubs: true,
      kf_flag_showKicks: false,
      kf_flag_showPolls: false,
      kf_flag_showHostRaid: false,
      kf_flag_showModeChanges: true,
      kf_flag_showChattersBadges: false,
    });
    featureFlags.showSubscriptions = true;
    featureFlags.showGiftedSubs = false;
    featureFlags.showKicks = true;
    featureFlags.showPolls = true;
    featureFlags.showHostRaid = true;
    featureFlags.showModeChanges = false;
    featureFlags.showChattersBadges = true;

    await bootstrap.applySavedFlags();

    expect(featureFlags.showSubscriptions).toBe(false);
    expect(featureFlags.showGiftedSubs).toBe(true);
    expect(featureFlags.showKicks).toBe(false);
    expect(featureFlags.showPolls).toBe(false);
    expect(featureFlags.showHostRaid).toBe(false);
    expect(featureFlags.showModeChanges).toBe(true);
    expect(featureFlags.showChattersBadges).toBe(false);
  });

  it('includes all event values in the popup status flag payload', () => {
    featureFlags.showSubscriptions = false;
    featureFlags.showGiftedSubs = true;
    featureFlags.showKicks = false;
    featureFlags.showPolls = true;
    featureFlags.showHostRaid = false;
    featureFlags.showModeChanges = false;

    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      showSubscriptions: false,
      showGiftedSubs: true,
      showKicks: false,
      showPolls: true,
      showHostRaid: false,
      showModeChanges: false,
    });
  });

  it('starts, stops, and recreates Active Chatters badges through the shared flag mutator', () => {
    const priorFlag = featureFlags.showChattersBadges;
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const preserved: ChatMessage = {
      id: 'chatter-removed', chatroomId: 1, content: 'removed evidence', type: 'message', createdAt: '',
      sender: {
        id: 42, username: 'Session_User', slug: 'session-user',
        identity: { color: '', badges: [], badgesV2: [] },
      },
      preserved: false,
    };
    store.addMessage(preserved);
    store.markMessageDeleted(preserved.id);
    document.body.innerHTML = `
      <div class="absolute inset-0 z-popover">
        <section class="bg-surface-base flex size-full min-h-0 flex-col overflow-hidden text-white">
          <header class="border-outline-decorative flex h-[50px] shrink-0 items-center border-b p-1.5">
            <h2 class="min-w-0 flex-1 text-center text-base font-bold leading-6">Active chatters</h2>
          </header>
          <div class="shrink-0 p-3"><label class="relative block min-w-0">
            <span class="sr-only">Search active chatters</span>
            <input aria-label="Search active chatters" class="h-8 pl-11 pr-3 text-base" type="search">
          </label></div>
          <div class="min-h-0 flex-1" data-radix-scroll-area-root=""><div class="pb-6">
            <div class="border-outline-decorative divide-outline-decorative flex flex-col divide-y border-t">
              <div class="accordion-item" data-state="open"><div data-state="open">
                <ul class="flex list-none flex-col overflow-hidden p-0">
                  <li class="block"><button class="betterhover:hover:bg-surface-highest flex h-auto w-full justify-start gap-4 p-2 text-left font-normal text-white" type="button">
                    <div class="relative size-6 shrink-0 rounded-full"><img alt="" class="size-full rounded-full" src="https://files.kick.com/avatar.webp"></div>
                    <span class="min-w-0 flex-1 truncate text-base font-normal leading-6">Session_User</span>
                  </button></li>
                </ul>
              </div></div>
            </div>
          </div></div>
        </section>
      </div>`;
    const panel = new RemovedMessagesPanel(lifecycle, store, () => ({
      slug: 'channel', chatroomId: 1, active: true, reason: 'test', pusherConnected: true,
      lastBanAt: null, messageCount: 1, preservedCount: 1, bannedCount: 0, deletedCount: 1,
      ghostAnchored: 0, ghostPendingNoAnchor: 0, ghostStrip: 0, ghostEvicted: 0,
    }));

    try {
      bootstrap.applyFlagChange('showChattersBadges', false);
      bootstrap.initActiveChattersBadgesSession(lifecycle, store, panel);
      expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();

      bootstrap.applyFlagChange('showChattersBadges', true);
      expect(document.querySelector('.kickflow-active-chatters-badge')?.textContent).toContain('kaldırıldı');
      expect(storageSet).toHaveBeenCalledWith({ kf_flag_showChattersBadges: true });
      expect(bootstrap.getPopupFeatureFlags().showChattersBadges).toBe(true);

      bootstrap.applyFlagChange('showChattersBadges', false);
      expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();

      bootstrap.applyFlagChange('showChattersBadges', true);
      expect(document.querySelector('.kickflow-active-chatters-badge')).not.toBeNull();
    } finally {
      lifecycle.dispose();
      featureFlags.showChattersBadges = priorFlag;
      document.body.replaceChildren();
    }
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
    for (const key of ['captionGuard', 'rewindControls', 'liveCatchup', 'qualityLock', 'screenshot', 'speedControls'] as const) {
      bootstrap.applyFlagChange(key, false);
      expect(featureFlags[key]).toBe(false);
      expect(storageSet).toHaveBeenCalledWith({ [`kf_flag_${key}`]: false });
      expect(bootstrap.getPopupFeatureFlags()[key]).toBe(false);
    }

    storageGet.mockResolvedValue({
      kf_flag_captionGuard: true,
      kf_flag_rewindControls: true,
      kf_flag_liveCatchup: true,
      kf_flag_qualityLock: true,
      kf_flag_screenshot: true,
      kf_flag_speedControls: true,
    });
    await bootstrap.applySavedFlags();
    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      captionGuard: true,
      rewindControls: true,
      liveCatchup: true,
      qualityLock: true,
      screenshot: true,
      speedControls: true,
    });
  });

  it('sanitizes, persists, restores, and reports moderator and VIP frame colors', async () => {
    storageSet.mockClear();

    bootstrap.applyFlagChange('modFrameColor', '#53FC18');
    bootstrap.applyFlagChange('vipFrameColor', '#000080');

    const modRgb = hexToRgb(featureFlags.modFrameColor)!;
    const modHsl = rgbToHsl(modRgb.r, modRgb.g, modRgb.b);
    const vipRgb = hexToRgb(featureFlags.vipFrameColor)!;
    const vipHsl = rgbToHsl(vipRgb.r, vipRgb.g, vipRgb.b);
    expect(modHsl.h < 90 || modHsl.h > 120).toBe(true);
    expect(vipHsl.l).toBeGreaterThanOrEqual(55);
    expect(vipHsl.l).toBeLessThanOrEqual(82);
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_modFrameColor: featureFlags.modFrameColor });
    expect(storageSet).toHaveBeenCalledWith({ kf_flag_vipFrameColor: featureFlags.vipFrameColor });
    expect(bootstrap.getPopupFeatureFlags()).toMatchObject({
      modFrameColor: featureFlags.modFrameColor,
      vipFrameColor: featureFlags.vipFrameColor,
    });

    storageGet.mockResolvedValue({
      kf_flag_modFrameColor: '#000080',
      kf_flag_vipFrameColor: '#53FC18',
    });
    await bootstrap.applySavedFlags();

    const restoredModRgb = hexToRgb(featureFlags.modFrameColor)!;
    const restoredModHsl = rgbToHsl(restoredModRgb.r, restoredModRgb.g, restoredModRgb.b);
    const restoredVipRgb = hexToRgb(featureFlags.vipFrameColor)!;
    const restoredVipHsl = rgbToHsl(restoredVipRgb.r, restoredVipRgb.g, restoredVipRgb.b);
    expect(restoredModHsl.l).toBeGreaterThanOrEqual(55);
    expect(restoredModHsl.l).toBeLessThanOrEqual(82);
    expect(restoredVipHsl.h < 90 || restoredVipHsl.h > 120).toBe(true);
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
    for (const key of ['captionGuard', 'rewindControls', 'liveCatchup', 'qualityLock', 'screenshot', 'speedControls'] as const) {
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
    bootstrap.applyFlagChange('captionGuard', false);
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
