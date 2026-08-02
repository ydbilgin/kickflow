import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { LayoutWatchdog } from './shared/layout-watchdog';
import { SELECTORS, getVideoElement } from './shared/selectors';
import { whenElementPresent } from './shared/dom-observers';
import { isExtensionContextValid, safeStorageGet, safeStorageSet } from './shared/extension-context';
import { loadLang, t } from './shared/i18n';
import { featureFlags, setFeatureFlag, type FeatureFlags } from './chat/feature-flags';
import { getStatus, setStatus, resetStatus, type KickFlowStatusSnapshot } from './status';
import {
  ChatDomRegistry,
  ChatIntegrityStore,
  type ChatMessage,
  type ChatroomModeKey,
  type SubscriberBadge,
} from './chat/message-store';
import { handleUserBanned, handleMessageDeleted } from './chat/ban-guard';
import {
  PusherClient,
  type ChatroomUpdatedEventPayload,
  type GiftedSubscriptionsEventPayload,
  type HostEventPayload,
  type KicksGiftedEventPayload,
  type SubscriptionEventPayload,
} from './chat/pusher-client';
import { NativeChatAugmenter, getActiveNativeChatGhostStats, reconcileActiveNativeChat } from './chat/native-augment';
import { ActiveChattersBadgesController } from './chat/active-chatters-badges';
import { RemovedMessagesPanel } from './chat/removed-panel';
import { initAutoClaimDrops, syncAutoClaimDropsFlag } from './chat/drops-auto-claim';
import { ModActionFeed, type ModAction, type ModActionNotice } from './chat/mod-action-feed';
import { FooterToggleButton } from './chat/footer-toggle';
import { NavbarSettingsButton } from './chat/navbar-settings';
import { RenderQueue } from './chat/render-queue';
import { ScrollFollowController, trimMessageWindow, decideScrollFollow } from './chat/dom-window';
import { ChatHistoryBackfill } from './chat/history';
import { ChatOverlayMount } from './chat/overlay-mount';
import {
  parseChatSessionContext,
  type ChatSessionContext,
} from './chat/session-context';
import { VodChatReplayController } from './chat/vod-replay';
import { formatVodReplayTimestamp } from './chat/timestamp';
import { CARD_MAX_HEIGHT_INSET_PX, configureUserCardSession, configureUserMessageArchive } from './chat/user-card';
import { UserMessageArchive } from './chat/user-message-archive';
import { USER_MESSAGE_TIME_COLUMN_PX } from './chat/user-message-list';
import { buildMessageElement, clearPreservedMarking, setSubscriberBadges } from './chat/message-view';
import { jumpToMessage } from './chat/message-jump';
import {
  refreshMessageHighlights,
  setHighlightStore,
  syncHighlightCssVars,
} from './chat/message-highlight-apply';
import { sanitizeHighlightColor, ROLE_BAR_ALPHA, ROLE_BAR_WIDTH_PX, ROLE_FILL_ALPHA } from './chat/message-highlight';
import { invalidateOwnerIdentityCache } from './chat/owner-identity';
import { initQualityLock } from './player/quality-lock';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';
import { initRewindControls } from './player/rewind-controls';
import { deactivateSpeedControls, initSpeedControls } from './player/speed-controls';
import { initScreenshot } from './player/screenshot';
import { initAutoTheater, syncAutoTheaterFlag } from './player/auto-theater';
import { initCaptionGuard } from './player/caption-guard';
import { shareNativeBarMountManager } from './player/native-bar';
import {
  HOTKEY_ACTIONS,
  getHotkeyBindings,
  loadHotkeyBindings,
  resetHotkeyBindings,
  updateHotkeyBinding,
  type HotkeyAction,
  type HotkeyBinding,
} from './player/hotkey-registry';

const STYLE_ID = 'kickflow-styles';
const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const OWN_LIST_ID = 'kickflow-message-list';
const PRESERVED_SWEEP_INTERVAL_MS = 60_000;
const NAVIGATION_POLL_INTERVAL_MS = 400;
const CHANNEL_RESOLUTION_ATTEMPT_TIMEOUT_MS = 6_000;
const INITIAL_NO_CONTENT_FALLBACK_MS = 15_000;
const PRIMARY_RECONNECT_GRACE_MS = 12_000;

const BOOLEAN_FLAG_KEYS = [
  'showDeletedMessages',
  'preserveBansInline',
  'debugLogging',
  'showSubscriptions',
  'showGiftedSubs',
  'showKicks',
  'showPolls',
  'showHostRaid',
  'showModeChanges',
  'showChattersBadges',
  'showUserMessages',
  'showModActions',
  'autoTheater',
  'captionGuard',
  'rewindControls',
  'liveCatchup',
  'qualityLock',
  'screenshot',
  'speedControls',
  'autoClaimDrops',
  'mentionHighlightEnabled',
  'modFrameEnabled',
  'vipFrameEnabled',
] as const;

type BooleanFlagKey = (typeof BOOLEAN_FLAG_KEYS)[number];

const HIGHLIGHT_COLOR_FLAG_KEYS = [
  'mentionHighlightColor',
  'modFrameColor',
  'vipFrameColor',
] as const;

type HighlightColorFlagKey = (typeof HIGHLIGHT_COLOR_FLAG_KEYS)[number];

const PLAYER_FEATURE_KEYS = [
  'captionGuard',
  'rewindControls',
  'liveCatchup',
  'qualityLock',
  'screenshot',
  'speedControls',
] as const;

type PlayerFeatureFlagKey = (typeof PLAYER_FEATURE_KEYS)[number];

function isPlayerFeatureFlagKey(key: string): key is PlayerFeatureFlagKey {
  return (PLAYER_FEATURE_KEYS as readonly string[]).includes(key);
}

function isBooleanFlagKey(key: string): key is BooleanFlagKey {
  return (BOOLEAN_FLAG_KEYS as readonly string[]).includes(key);
}

function isHighlightColorFlagKey(key: string): key is HighlightColorFlagKey {
  return (HIGHLIGHT_COLOR_FLAG_KEYS as readonly string[]).includes(key);
}

interface SystemEventCallbacks {
  onSubscription: (payload: SubscriptionEventPayload) => void;
  onGiftedSubscriptions: (payload: GiftedSubscriptionsEventPayload) => void;
  onKicksGifted: (payload: KicksGiftedEventPayload) => void;
  onHost: (payload: HostEventPayload) => void;
  onChatroomUpdated: (payload: ChatroomUpdatedEventPayload) => void;
  onModAction: (notice: ModActionNotice) => void;
  onModActionUpdated: (notice: ModActionNotice) => void;
}

/** Builds Mode A's system-event callbacks. Display toggles gate ingestion, so turning one off
 * only drops future events; rows already rendered remain until the normal message-window trim. */
export function createSystemEventCallbacks(
  enqueueOnce: (message: ChatMessage) => void,
  updateSystemEvent: (message: ChatMessage) => void = enqueueOnce,
): SystemEventCallbacks {
  let systemEventSequence = 0;
  let previousChatroomState: ChatroomUpdatedEventPayload | null = null;

  const createSystemEventMessage = (
    id: string,
    eventChatroomId: number,
    systemEvent: NonNullable<ChatMessage['systemEvent']>,
  ): ChatMessage => ({
    id,
    chatroomId: eventChatroomId,
    content: '',
    type: systemEvent.kind,
    createdAt: new Date().toISOString(),
    sender: {
      id: 0,
      username: 'username' in systemEvent ? systemEvent.username : '',
      slug: '',
      identity: { color: '', badges: [], badgesV2: [] },
    },
    systemEvent,
    preserved: false,
  });

  return {
    onSubscription: (payload) => {
      // Kick's native handler presents only the first-month SubscriptionEvent. Renewals arrive
      // with months > 1 but are represented by ChatMessageEvent celebration cards instead.
      if (payload.months > 1) return;
      if (!featureFlags.showSubscriptions) return;
      const sequence = ++systemEventSequence;
      enqueueOnce(createSystemEventMessage(
        `sub:${payload.chatroomId}:${encodeURIComponent(payload.username)}:${payload.months}:${sequence}`,
        payload.chatroomId,
        { kind: 'subscription', username: payload.username, months: payload.months },
      ));
    },
    onGiftedSubscriptions: (payload) => {
      if (!featureFlags.showGiftedSubs) return;
      enqueueOnce(createSystemEventMessage(
        `gift:${payload.chatroomId}:${encodeURIComponent(payload.correlationId)}`,
        payload.chatroomId,
        {
          kind: 'gifted-subscription',
          username: payload.gifterUsername,
          giftCount: payload.giftCount,
          giftedUsernames: payload.giftedUsernames,
        },
      ));
    },
    onKicksGifted: (payload) => {
      if (!featureFlags.showKicks) return;
      // gift_transaction_id is the stable id → store id-dedup suppresses reconnect/replay.
      // The KicksGifted payload carries no chatroom id (it rides channel_{channelId}); the
      // store never filters system rows by chatroom, so 0 is a safe non-identifying value.
      enqueueOnce(createSystemEventMessage(
        `kicks:${encodeURIComponent(payload.giftTransactionId)}`,
        0,
        {
          kind: 'kicks',
          username: payload.senderUsername,
          amount: payload.amount,
          giftName: payload.giftName,
          senderMessage: payload.senderMessage,
        },
      ));
    },
    onHost: (payload) => {
      if (!featureFlags.showHostRaid) return;
      const sequence = ++systemEventSequence;
      enqueueOnce(createSystemEventMessage(
        `host:${payload.chatroomId}:${encodeURIComponent(payload.hostUsername)}:${sequence}`,
        payload.chatroomId,
        {
          kind: 'host',
          username: payload.hostUsername,
          numberViewers: payload.numberViewers,
          optionalMessage: payload.optionalMessage,
        },
      ));
    },
    onChatroomUpdated: (payload) => {
      const previous = previousChatroomState;
      previousChatroomState = payload;
      if (!previous || previous.chatroomId !== payload.chatroomId) return;

      const changes: Array<{ mode: ChatroomModeKey; text: string }> = [];
      if (
        previous.slowMode.enabled !== payload.slowMode.enabled ||
        (payload.slowMode.enabled && previous.slowMode.messageInterval !== payload.slowMode.messageInterval)
      ) {
        changes.push({
          mode: 'slow_mode',
          text: payload.slowMode.enabled
            ? t('event.mode.slow_on', { n: payload.slowMode.messageInterval })
            : t('event.mode.slow_off'),
        });
      }
      if (
        previous.followersMode.enabled !== payload.followersMode.enabled ||
        (payload.followersMode.enabled && previous.followersMode.minDuration !== payload.followersMode.minDuration)
      ) {
        changes.push({
          mode: 'followers_mode',
          text: payload.followersMode.enabled
            ? payload.followersMode.minDuration > 0
              ? t('event.mode.followers_on_minutes', { n: payload.followersMode.minDuration })
              : t('event.mode.followers_on')
            : t('event.mode.followers_off'),
        });
      }
      if (previous.subscribersMode.enabled !== payload.subscribersMode.enabled) {
        changes.push({
          mode: 'subscribers_mode',
          text: payload.subscribersMode.enabled ? t('event.mode.subscribers_on') : t('event.mode.subscribers_off'),
        });
      }
      if (previous.emotesMode.enabled !== payload.emotesMode.enabled) {
        changes.push({
          mode: 'emotes_mode',
          text: payload.emotesMode.enabled ? t('event.mode.emotes_on') : t('event.mode.emotes_off'),
        });
      }
      if (!featureFlags.showModeChanges) return;

      for (const change of changes) {
        const sequence = ++systemEventSequence;
        enqueueOnce(createSystemEventMessage(
          `mode:${payload.chatroomId}:${change.mode}:${sequence}`,
          payload.chatroomId,
          { kind: 'mode', mode: change.mode, text: change.text },
        ));
      }
    },
    onModAction: (notice) => {
      if (!featureFlags.showModActions) return;
      enqueueOnce(createSystemEventMessage(
        `mod-action:${notice.id}`,
        0,
        {
          kind: 'mod-action',
          actionKind: notice.kind,
          moderator: notice.moderator,
          durationMin: notice.durationMin,
          victims: notice.victims,
          count: notice.count,
        },
      ));
    },
    onModActionUpdated: (notice) => {
      if (!featureFlags.showModActions) return;
      updateSystemEvent(createSystemEventMessage(
        `mod-action:${notice.id}`,
        0,
        {
          kind: 'mod-action',
          actionKind: notice.kind,
          moderator: notice.moderator,
          durationMin: notice.durationMin,
          victims: notice.victims,
          count: notice.count,
        },
      ));
    },
  };
}

const CHATROOM_ID_MAX_ATTEMPTS = 3;
const CHATROOM_ID_RETRY_BASE_MS = 800;

interface ResolvedChannel {
  /** Pusher chatroom id — used for the live `chatrooms.{id}.v2` subscription. */
  chatroomId: number;
  /** Channel id — used for the web.kick.com history backfill (differs from chatroomId). */
  channelId: number;
  /** Channel's custom subscriber-tier images, sorted by months ASC; [] if the channel has none. */
  subscriberBadges: SubscriberBadge[];
}

export async function resolveChannel(slug: string): Promise<ResolvedChannel | null> {
  // Same-origin credentials (the fetch default — no explicit `credentials: 'omit'`): the content
  // script runs ON https://kick.com/*, so this is the user's OWN browser calling the site it's
  // already logged into, exactly like the page's own API calls. Cloudflare 429s/challenges
  // anonymous (credentials-stripped) requests far more readily — that was silently dropping chat
  // integrity into native fallback (Mo'Kick fetches this same endpoint with credentials too).
  // NOT a secret leak: no token crosses to a third party; the global no-secret-in-git rule is
  // about committing credentials, which is unrelated. 429/5xx are transient → back off + retry;
  // any other non-OK status is terminal. On total failure the fail-safe keeps native chat.
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  for (let attempt = 0; attempt < CHATROOM_ID_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CHANNEL_RESOLUTION_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.ok) {
        const json = (await response.json()) as {
          id?: number;
          chatroom?: { id?: number; channel_id?: number };
          subscriber_badges?: Array<{ months?: number; badge_image?: { src?: string } }>;
        };
        const chatroomId = json.chatroom?.id;
        if (typeof chatroomId !== 'number') return null;
        const channelId =
          typeof json.id === 'number' ? json.id
          : typeof json.chatroom?.channel_id === 'number' ? json.chatroom.channel_id
          : chatroomId;
        const subscriberBadges: SubscriberBadge[] = Array.isArray(json.subscriber_badges)
          ? json.subscriber_badges
              .map((b) => ({ months: Number(b?.months), src: typeof b?.badge_image?.src === 'string' ? b.badge_image.src : '' }))
              .filter((b) => Number.isFinite(b.months) && b.src)
              .sort((a, b) => a.months - b.months)
          : [];
        return { chatroomId, channelId, subscriberBadges };
      }
      const transient = response.status === 429 || response.status >= 500;
      if (transient) {
        logger.warn('bootstrap: channel lookup failed for', slug, 'status', response.status, '(retrying)');
      } else {
        logger.info('bootstrap: channel lookup failed for', slug, 'status', response.status, '(terminal)');
        return null;
      }
    } catch (error) {
      logger.warn('bootstrap: channel lookup threw', error, '(retrying)');
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (attempt < CHATROOM_ID_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHATROOM_ID_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  logger.warn('bootstrap: channel lookup exhausted retries for', slug, '- native chat stays visible');
  return null;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Images use `display: inline-block !important` + an explicit px height. Kick's page is built
  // with Tailwind, whose preflight reset applies `img { display: block; height: auto }` globally.
  style.textContent = `
    #${OVERLAY_ROOT_ID} { display: flex; flex-direction: column; overflow: hidden; }
    #${OWN_LIST_ID} {
      flex: 1 1 auto; min-height: 0; padding: 6px 10px; overflow-y: auto; height: auto; box-sizing: border-box;
      font-size: var(--chatroom-font-size, 13px); line-height: 1.5; color: #efeff1;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.16) transparent;
    }
    #${OWN_LIST_ID} .kickflow-message {
      display: block; padding: var(--chatroom-message-spacing, 3px) 5px; border-radius: 6px;
      word-break: break-word; overflow-wrap: anywhere;
    }
    #${OWN_LIST_ID} .kickflow-message:not(.kickflow-event-row):hover { background: rgba(255,255,255,0.06); }
    #${OWN_LIST_ID} .kickflow-message__time {
      display: var(--chatroom-timestamps-display, inline); color: #adadb8;
      font-size: calc(var(--chatroom-font-size, 13px) - 2px); font-weight: 600;
      margin-right: 4px; font-variant-numeric: tabular-nums;
    }
    #${OWN_LIST_ID} .kickflow-message__time:empty { display: none; }
    #${OWN_LIST_ID} .kickflow-message__identity {
      display: inline-flex; min-width: 0; flex-wrap: nowrap; align-items: baseline;
    }
    #${OWN_LIST_ID} .kickflow-message__badges:empty { display: none; }
    #${OWN_LIST_ID} .kickflow-message__badges {
      display: inline-flex; align-items: center; align-self: center; gap: 4px;
      padding-right: 4px;
    }
    #${OWN_LIST_ID} .kickflow-message__username {
      font-weight: 700; color: inherit; text-decoration: none;
    }
    #${OWN_LIST_ID} .kickflow-message__username--link,
    .kickflow-event-row__identity--link { cursor: pointer; }
    #${OWN_LIST_ID} .kickflow-message__username--link:hover,
    .kickflow-event-row__identity--link:hover { text-decoration: underline; }
    #${OWN_LIST_ID} .kickflow-message__separator {
      display: inline-flex; color: inherit; font-weight: 700;
    }
    #${OWN_LIST_ID} .kickflow-message__content { color: #efeff1; line-height: 1.55; }
    #${OWN_LIST_ID} .kickflow-event-row {
      display: flex; align-items: baseline; gap: 0; margin: 2px 0;
      border-left: 2px solid rgba(83,252,24,0.7);
      background: rgba(83,252,24,0.07); color: #d8f7ce;
    }
    #${OWN_LIST_ID} .kickflow-event-row--gifted-subscription {
      border-left-color: rgba(255,176,32,0.8);
      background: rgba(255,176,32,0.08); color: #ffe0a3;
    }
    #${OWN_LIST_ID} .kickflow-event-row--celebration {
      align-items: flex-start; border-left-color: rgba(83,252,24,0.9);
      background: rgba(83,252,24,0.1);
    }
    #${OWN_LIST_ID} .kickflow-event-row--celebration .kickflow-event-row__body,
    #${OWN_LIST_ID} .kickflow-celebration__headline,
    #${OWN_LIST_ID} .kickflow-celebration__message { display: block; min-width: 0; }
    #${OWN_LIST_ID} .kickflow-celebration__headline { font-weight: 600; }
    #${OWN_LIST_ID} .kickflow-celebration__message {
      margin-top: 3px; padding: 2px 4px; border-radius: 3px;
      background: rgba(0,0,0,0.16); color: #efeff1;
    }
    #${OWN_LIST_ID} .kickflow-celebration__author { font-weight: 700; }
    #${OWN_LIST_ID} .kickflow-event-row--host {
      border-left-color: rgba(70,169,255,0.85);
      background: rgba(70,169,255,0.09); color: #b9ddff;
    }
    #${OWN_LIST_ID} .kickflow-event-row--mode {
      border-left-color: rgba(168,139,250,0.85);
      background: rgba(168,139,250,0.09); color: #ddd0ff;
    }
    #${OWN_LIST_ID} .kickflow-event-row__icon { flex: none; margin-right: 5px; }
    #${OWN_LIST_ID} .kickflow-event-row__username,
    #${OWN_LIST_ID} .kickflow-event-row__count,
    #${OWN_LIST_ID} .kickflow-event-row__recipient { font-weight: 700; color: inherit; }
    #${OWN_LIST_ID} .kickflow-event-row__more {
      cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
    }
    #${OWN_LIST_ID} .kickflow-event-row__more:hover { opacity: 0.85; }
    #${OWN_LIST_ID} .kickflow-message__reply-context {
      display: flex; align-items: center; width: 100%; min-width: 0; margin-bottom: 4px;
      color: rgba(255,255,255,0.55); font-size: 11px; font-weight: 500;
      white-space: nowrap; overflow: hidden;
      border-left: 2px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.035);
      border-radius: 4px; padding: 1px 6px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"] { cursor: pointer; }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"]:hover {
      background: rgba(255,255,255,0.075);
    }
    #${OWN_LIST_ID} .kickflow-message--jump-highlight {
      outline: 2px solid rgba(83,252,24,0.95); outline-offset: 1px;
      box-shadow: 0 0 0 4px rgba(83,252,24,0.22), 0 0 16px rgba(83,252,24,0.35);
    }
    /* Highlight colors: CSS vars are synchronized from their feature flags. */
    #${OWN_LIST_ID} {
      --kf-hl-outline: rgba(255,201,77,0.95);
      --kf-hl-fill: rgba(255,201,77,0.13);
      --kf-hl-fill-only: rgba(255,201,77,0.18);
      --kf-mod-bar: rgba(20,184,166,${ROLE_BAR_ALPHA});
      --kf-mod-fill: rgba(20,184,166,${ROLE_FILL_ALPHA});
      --kf-vip-bar: rgba(236,72,153,${ROLE_BAR_ALPHA});
      --kf-vip-fill: rgba(236,72,153,${ROLE_FILL_ALPHA});
    }
    #${OWN_LIST_ID} .kickflow-message--mention-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight),
    #${OWN_LIST_ID} .kickflow-message--reply-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight) {
      outline: 2px solid var(--kf-hl-outline); outline-offset: 1px;
    }
    #${OWN_LIST_ID} .kickflow-message--mention-me.kickflow-message--hl-fill,
    #${OWN_LIST_ID} .kickflow-message--reply-me.kickflow-message--hl-fill {
      background-color: var(--kf-hl-fill);
    }
    /* fill-only mode uses the slightly stronger tint */
    #${OWN_LIST_ID} .kickflow-message--hl-fill:not(.kickflow-message--hl-frame) {
      background-color: var(--kf-hl-fill-only);
    }
    /* Role bars: left accent always; faint tint only with role-fill (yields to personal fill). */
    #${OWN_LIST_ID} .kickflow-message--role-mod {
      border-left: ${ROLE_BAR_WIDTH_PX}px solid var(--kf-mod-bar);
    }
    #${OWN_LIST_ID} .kickflow-message--role-mod.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-mod-fill);
    }
    #${OWN_LIST_ID} .kickflow-message--role-vip {
      border-left: ${ROLE_BAR_WIDTH_PX}px solid var(--kf-vip-bar);
    }
    #${OWN_LIST_ID} .kickflow-message--role-vip.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-vip-fill);
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context--to-me {
      border-left-color: var(--kf-hl-outline);
      color: rgba(255,255,255,0.72);
    }
    #${OWN_LIST_ID} .kickflow-message__reply-me-mark {
      display: inline-block; margin-right: 4px; color: var(--kf-hl-outline); font-size: 11px;
    }
    /* Panel: highlight style segments + color swatches */
    .kickflow-panel__settings-row--stack {
      display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      min-height: 0; padding: 12px 0; border-bottom: 1px solid oklch(0.27 0.01 150);
      cursor: default;
    }
    .kickflow-panel__segmented {
      display: inline-flex; flex: none; align-self: flex-start; gap: 2px; padding: 2px;
      border: 1px solid oklch(0.34 0.01 150); border-radius: 8px; background: oklch(0.22 0.012 150);
    }
    .kickflow-panel__segment {
      appearance: none; border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer;
      background: transparent; color: oklch(0.72 0.01 150);
      font: 600 11px/1 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-panel__segment--active {
      background: oklch(0.86 0.24 145 / .16); color: oklch(0.92 0.007 150);
    }
    .kickflow-panel__role-colors {
      display: flex; flex-direction: column; gap: 8px;
      padding: 10px 0; border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__role-colors > summary {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px;
      list-style: none; cursor: pointer; color: oklch(0.92 0.007 150);
      font: 600 12px/1.3 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-panel__role-colors > summary::-webkit-details-marker { display: none; }
    .kickflow-panel__role-colors > summary:focus-visible {
      outline: 2px solid oklch(0.86 0.24 145 / .55); outline-offset: 2px; border-radius: 4px;
    }
    .kickflow-panel__role-colors-copy {
      display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 160px;
    }
    .kickflow-panel__role-colors-desc {
      color: oklch(0.68 0.01 150); font: 400 11px/1.35 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-panel__role-color-dots {
      display: inline-flex; align-items: center; gap: 6px; flex: none;
    }
    .kickflow-panel__role-color-dot {
      width: 10px; height: 10px; border-radius: 999px;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35);
    }
    .kickflow-panel__role-colors[open] > summary {
      margin-bottom: 4px;
    }
    .kickflow-panel__role-colors .kickflow-panel__settings-row--stack {
      border-bottom-color: oklch(0.27 0.01 150 / .55);
    }
    .kickflow-panel__swatches {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    }
    .kickflow-panel__swatch {
      appearance: none; width: 22px; height: 22px; padding: 0; border-radius: 999px; cursor: pointer;
      border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35);
    }
    .kickflow-panel__swatch--active { border-color: #fff; }
    .kickflow-panel__swatch-custom {
      position: relative; width: 22px; height: 22px; border-radius: 999px; overflow: hidden;
      border: 2px dashed oklch(0.50 0.01 150); cursor: pointer;
    }
    .kickflow-panel__swatch-custom input {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0;
    }
    .kickflow-panel__identity-input {
      width: min(220px, 100%); height: 34px; padding: 0 10px;
      background: oklch(0.22 0.012 150); color: oklch(0.93 0.007 150);
      border: 1px solid oklch(0.34 0.01 150); border-radius: 8px;
      font: 600 12px/1 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-panel__identity-note {
      margin: 0; color: oklch(0.72 0.08 85); font-size: 11px; line-height: 1.4;
    }
    .kickflow-panel__color-warn {
      margin: 0; color: oklch(0.75 0.14 55); font-size: 11px; line-height: 1.35;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context--miss {
      animation: kickflow-reply-miss 0.5s ease;
    }
    @keyframes kickflow-reply-miss {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-3px); }
      40%, 80% { transform: translateX(3px); }
    }
    #${OWN_LIST_ID} .kickflow-message__reply-icon {
      display: inline-block; flex: none; width: 13px; margin-right: 4px; font-size: 11px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-text {
      display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator { flex: none; }
    #${OWN_LIST_ID} .kickflow-message__reply-user {
      flex: 0 1 auto; min-width: 0; max-width: 38%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator { white-space: pre; }
    #${OWN_LIST_ID} .kickflow-message__reply-snippet {
      display: inline-block; min-width: 0; flex: 1 1 auto;
      overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-user { font-weight: 700; color: rgba(255,255,255,0.72); }
    #${OWN_LIST_ID} .kickflow-preserved { opacity: 0.6; }
    #${OWN_LIST_ID} .kickflow-preserved .kickflow-message__content { text-decoration: line-through; }
    html.kickflow-chat-active #chatroom-messages > * { visibility: hidden !important; }
    .kickflow-scroll-pill {
      position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 20;
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 14px; border: 0; border-radius: 999px;
      background: #53fc18; color: #0b0e0f; cursor: pointer;
      font-family: 'Inter','Segoe UI',system-ui,sans-serif; font-size: 12px; font-weight: 700;
      line-height: 1; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.45);
      transition: background .14s ease, transform .1s ease;
    }
    .kickflow-scroll-pill:hover { background: #45e00f; }
    .kickflow-scroll-pill:active { transform: translateX(-50%) scale(0.95); }
    .kickflow-user-card {
      position: fixed; z-index: 2147483647; width: 320px; padding: 12px;
      box-sizing: border-box; display: flex; flex-direction: column; gap: 10px;
      max-height: calc(100vh - ${CARD_MAX_HEIGHT_INSET_PX}px);
      border: 1px solid rgba(255,255,255,0.13); border-radius: 10px;
      background: oklch(0.19 0.008 260 / 0.985); color: #efeff1;
      box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 16px 40px rgba(0,0,0,0.52);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif; font-size: 12px;
      animation: kickflow-card-in 160ms cubic-bezier(0.25, 1, 0.5, 1) both;
    }
    .kickflow-user-card--instant { animation: none; }
    @keyframes kickflow-card-in {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to   { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .kickflow-user-card { animation: none; } }
    .kickflow-user-card__header { display: flex; align-items: center; gap: 10px; padding-right: 22px; cursor: move; user-select: none; }
    .kickflow-user-card__avatar {
      display: block; width: 44px; height: 44px; border-radius: 50%; object-fit: cover;
      background: rgba(255,255,255,0.08); flex: none;
    }
    .kickflow-user-card__title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .kickflow-user-card__nameRow { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .kickflow-user-card__nameRow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kickflow-user-card__name { cursor: pointer; }
    .kickflow-user-card__name:hover { text-decoration: underline; }
    .kickflow-user-card__verified { color: #53fc18; font-size: 11px; flex: none; }
    .kickflow-user-card__role { color: #53fc18; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .kickflow-user-card__close {
      position: absolute; top: 5px; right: 6px; width: 20px; height: 20px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 5px; background: rgba(255,255,255,0.08); color: #d0d0d8;
      font-size: 15px; line-height: 1; cursor: pointer;
    }
    .kickflow-user-card__close:hover { background: rgba(233,17,60,0.7); color: #fff; }
    .kickflow-user-card__bio {
      color: #c7c7d1; font-size: 11px; line-height: 1.45; margin: 0;
      max-height: 56px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    }
    .kickflow-user-card__facts {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
      padding: 9px 10px; border-radius: 8px; background: rgba(255,255,255,0.035);
    }
    .kickflow-user-card__field { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .kickflow-user-card__key {
      color: #8b8b93; font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-card__value {
      color: #efeff1; font-size: 12px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-card__badges { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; }
    .kickflow-user-messages {
      display: flex; flex-direction: column; min-height: 0;
      padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);
    }
    .kickflow-user-messages__toggle {
      appearance: none; width: 100%; display: flex; align-items: center; gap: 8px; flex: none;
      padding: 0 0 6px; border: 0; background: transparent; color: #adadb8; cursor: pointer;
      font: 700 9px/1.4 'Inter','Segoe UI',system-ui,sans-serif; letter-spacing: 0.05em;
      text-transform: uppercase; text-align: left;
    }
    .kickflow-user-messages__toggle:hover { color: #efeff1; }
    .kickflow-user-messages__toggle:focus-visible { outline: 2px solid #53fc18; outline-offset: 2px; border-radius: 3px; }
    .kickflow-user-messages__title { min-width: 0; flex: 1; }
    .kickflow-user-messages__count {
      min-width: 16px; padding: 1px 6px; border-radius: 999px;
      background: rgba(255,255,255,0.08); color: #adadb8; text-align: center;
      font-size: 10px; letter-spacing: 0; font-variant-numeric: tabular-nums;
    }
    .kickflow-user-messages__body {
      flex: 1 1 auto; min-height: 0; max-height: 260px; overflow-y: auto; padding-right: 4px;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.16) transparent;
    }
    .kickflow-user-messages__row {
      display: block; min-width: 0; padding: 5px 6px; border-radius: 6px;
      color: #efeff1; cursor: pointer; line-height: 1.45;
      word-break: break-word; overflow-wrap: anywhere;
      transition: background 120ms ease;
    }
    .kickflow-user-messages__row + .kickflow-user-messages__row {
      box-shadow: 0 -1px 0 rgba(255,255,255,0.05);
    }
    .kickflow-user-messages__row:hover,
    .kickflow-user-messages__row:focus-visible { outline: none; background: rgba(255,255,255,0.06); }
    .kickflow-user-messages__row:focus-visible { box-shadow: 0 0 0 2px rgba(83,252,24,0.75); }
    .kickflow-user-messages__row--deleted .kickflow-user-messages__text {
      text-decoration: line-through; color: #9a9aa4;
    }
    .kickflow-user-messages__reply {
      display: flex; align-items: baseline; gap: 4px; min-width: 0;
      margin: 0 0 2px ${USER_MESSAGE_TIME_COLUMN_PX}px;
      color: #8b8b93; font-size: 10px; line-height: 1.35;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-messages__reply > * { flex: none; }
    .kickflow-user-messages__replyIcon { opacity: 0.7; }
    .kickflow-user-messages__replyUser { color: #adadb8; font-weight: 600; }
    .kickflow-user-messages__replyText {
      min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis;
    }
    /* Same box-then-image pattern as the chat's own reply snippet: sizing lives on the wrapper, and
       the absolutely-positioned image follows it. Overriding the image alone would fight the
       line-box-neutral emote geometry that own-mode rows depend on. */
    .kickflow-user-messages__reply .kickflow-emote-box {
      width: 14px; height: 14px; vertical-align: -3px; margin: 0 1px;
    }
    .kickflow-user-messages__reply .kickflow-emote {
      width: 14px !important; height: 14px !important;
    }
    .kickflow-user-messages__line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .kickflow-user-messages__time {
      flex: none; width: ${USER_MESSAGE_TIME_COLUMN_PX}px; color: #7c7c86;
      font-size: 10px; font-variant-numeric: tabular-nums;
    }
    .kickflow-user-messages__text { min-width: 0; flex: 1; }
    .kickflow-user-messages__empty,
    .kickflow-user-messages__note {
      color: #8b8b93; font-size: 10px; line-height: 1.45;
    }
    .kickflow-user-messages__empty { padding: 4px 6px 2px; }
    .kickflow-user-messages__note { flex: none; padding: 7px 6px 0; }
    .kickflow-user-messages--collapsed .kickflow-user-messages__body,
    .kickflow-user-messages--collapsed .kickflow-user-messages__empty,
    .kickflow-user-messages--collapsed .kickflow-user-messages__note { display: none; }
    .kickflow-user-card__link {
      display: inline-block; color: #66bfff; text-decoration: none; font-size: 11px;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .kickflow-user-card__link:hover { text-decoration: underline; }
    .kickflow-badge-icon {
      display: inline-block !important; height: 18px !important; width: 18px !important;
    }
    .kickflow-badge-text { font-size: 10px; font-weight: 700; opacity: 0.75; }
    .kickflow-badge-role {
      display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      min-width: 18px; height: 18px; padding: 0 3px;
      border-radius: 4px; color: #fff; font-size: 9px; font-weight: 800; line-height: 1;
      gap: 1px;
    }
    .kickflow-badge-role__count { font-size: 8px; font-weight: 700; }
    #${OWN_LIST_ID} .kickflow-message__badges .kickflow-badge-icon {
      width: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
      height: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
    }
    #${OWN_LIST_ID} .kickflow-message__badges .kickflow-badge-role {
      min-width: calc(var(--chatroom-font-size, 13px) * (18 / 13));
      height: calc(var(--chatroom-font-size, 13px) * (18 / 13));
    }
    .kickflow-emote-box {
      position: relative; display: inline-block;
      width: 24px; height: 24px; vertical-align: middle; margin: 0 2px;
    }
    .kickflow-emote {
      position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      display: block !important; width: 24px !important; height: 24px !important;
    }
    #${OWN_LIST_ID} .kickflow-emote-box {
      width: calc(var(--chatroom-font-size, 13px) * (28 / 13)); height: 1.2em;
      margin: 0 1px;
    }
    #${OWN_LIST_ID} .kickflow-emote {
      width: calc(var(--chatroom-font-size, 13px) * (28 / 13)) !important;
      height: calc(var(--chatroom-font-size, 13px) * (28 / 13)) !important;
    }
    /* Reply snippets keep a compact 16px box even though ordinary message emotes scale with
       Kick's chat-size token. */
    #${OWN_LIST_ID} .kickflow-message__reply-snippet .kickflow-emote-box {
      width: 16px; height: 16px; vertical-align: -4px; margin: 0 1px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-snippet .kickflow-emote {
      width: 16px !important; height: 16px !important;
    }
    .kickflow-mention { color: #53fc18; font-weight: 600; }
    .kickflow-mention--link { cursor: pointer; }
    .kickflow-mention--link:hover { text-decoration: underline; }
    .kickflow-link { color: #66bfff; text-decoration: underline; }
    .kickflow-status-label {
      display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
      font-size: 9px; font-weight: 800; letter-spacing: 0.03em; vertical-align: middle;
      text-decoration: none; text-transform: uppercase;
    }
    .kickflow-status-label--banned { background: rgba(233,17,60,0.92); color: #fff; }
    .kickflow-status-label--timeout { background: rgba(230,147,43,0.92); color: #fff; }
    .kickflow-status-label--deleted { background: rgba(156,122,30,0.92); color: #fff; }
    .kickflow-active-chatters-badge {
      flex: none; min-width: auto; height: 18px; margin-left: auto; padding: 0 6px;
      border: 1px solid rgba(230,147,43,0.45); border-radius: 999px;
      background: rgba(156,122,30,0.30); color: #ffd27a; cursor: pointer;
      font-size: 9px; font-weight: 800; letter-spacing: 0.02em; text-transform: none;
    }
    .kickflow-active-chatters-badge:hover { background: rgba(230,147,43,0.38); color: #fff; }
    .kickflow-active-chatters-badge:focus-visible { outline: 2px solid #53fc18; outline-offset: 1px; }
    .kickflow-mod-label { margin-left: 5px; font-size: 10px; font-weight: 600; opacity: 0.7; }
    .kickflow-preserved { position: relative; }
    .kickflow-original-content {
      margin-left: 6px; color: #efeff1; opacity: 0.6; text-decoration: line-through;
      word-break: break-word; overflow-wrap: anywhere;
    }
    /* Preserved (deleted/banned) rows: hide the native content entirely — Kick may leave the
       original text OR swap in a "Deleted by a moderator" placeholder — and show our stored copy. */
    .kickflow-native-content-dimmed { display: none !important; }
    .kickflow-preserved-username { font-weight: 600; }
    .kickflow-preserved-username--link { cursor: pointer; }
    .kickflow-preserved-username--link:hover { text-decoration: underline; }
    .kickflow-ghost-block {
      display: block; margin: 3px 0 0 18px; padding-left: 8px;
      border-left: 2px solid rgba(233,17,60,0.55);
    }
    .kickflow-ghost-row {
      display: block; padding: 2px 0; color: #efeff1; opacity: 0.78;
      font-size: 13px; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere;
    }
    .kickflow-ghost-row__time { margin-right: 4px; color: #8b8b93; font-size: 10px; }
    .kickflow-ghost-row__badges {
      margin-right: 4px; display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;
    }
    .kickflow-ghost-row__username { font-weight: 700; }
    .kickflow-ghost-row__username--link { cursor: pointer; }
    .kickflow-ghost-row__username--link:hover { text-decoration: underline; }
    .kickflow-ghost-row__separator { font-weight: 700; }
    .kickflow-ghost-row__content { text-decoration: line-through; opacity: 0.7; }
    .kickflow-ghost-empty { color: #8b8b93; font-size: 11px; text-align: center; padding: 22px 10px; opacity: 0.9; }

    .kickflow-event-row__victim {
      font-weight: 700; color: inherit;
    }
    .kickflow-event-row__victim-action {
      display: inline-flex; align-items: baseline; max-width: 100%; min-width: 0; flex-wrap: nowrap;
      vertical-align: baseline;
    }
    .kickflow-event-row--mod-action-bulk[role="button"] {
      cursor: pointer;
    }
    .kickflow-event-row__jump-control[role="button"],
    .kickflow-event-row__more[role="button"] {
      cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
    }
    .kickflow-event-row__jump-control[role="button"] {
      display: inline-flex; align-items: baseline; margin-left: 4px; padding: 0 2px;
      color: var(--kickflow-modaction-meta-color); text-decoration: none; vertical-align: baseline;
    }
    .kickflow-event-row__jump-control[role="button"] > [aria-hidden="true"] {
      display: inline-block; line-height: 1;
    }
    .kickflow-event-row__jump-control[role="button"]:hover {
      background: rgba(255,255,255,0.08); color: var(--kickflow-modaction-body-color);
      text-decoration: none;
    }
    .kickflow-event-row__jump-control[role="button"]:focus-visible,
    .kickflow-event-row__identity--link:focus-visible {
      outline: 2px solid currentColor; outline-offset: 2px; border-radius: 3px;
    }
    .kickflow-event-row__more[role="button"]:hover { opacity: 0.85; }
    .kickflow-event-row__victims { min-width: 0; }
    .kickflow-event-row__remainder { color: inherit; }
    .kickflow-modaction-surface {
      --kickflow-modaction-accent: oklch(0.80 0.06 265);
      --kickflow-modaction-band: color-mix(in oklch, var(--kickflow-modaction-accent) 8%, transparent);
      --kickflow-modaction-moderator-color: oklch(0.78 0.13 155);
      --kickflow-modaction-body-color: oklch(0.9 0.02 265);
      --kickflow-modaction-meta-color: oklch(0.72 0.03 265 / 0.62);
      background: var(--kickflow-modaction-band);
      color: var(--kickflow-modaction-body-color);
      border: 0;
      border-radius: 4px;
      box-shadow: none;
    }
    .kickflow-modaction-kind--ban {
      --kickflow-modaction-accent: oklch(0.64 0.19 22);
    }
    .kickflow-modaction-kind--timeout {
      --kickflow-modaction-accent: oklch(0.75 0.14 72);
    }
    .kickflow-modaction-kind--delete {
      --kickflow-modaction-accent: oklch(0.80 0.06 265);
    }
    .kickflow-event-row--mod-action {
      cursor: pointer;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__kind-tag {
      display: inline-block;
      margin-right: 6px;
      color: var(--kickflow-modaction-accent);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.07em;
      line-height: 1;
      text-transform: uppercase;
      vertical-align: middle;
      white-space: nowrap;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__moderator {
      color: var(--kickflow-modaction-moderator-color);
      font-weight: 700;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__moderator-shield {
      color: var(--kickflow-modaction-moderator-color);
      display: inline-block;
      font-weight: 700;
      margin-right: 3px;
      font-size: 0.9em;
      line-height: 1;
      vertical-align: baseline;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__victim {
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__count,
    .kickflow-event-row--mod-action .kickflow-event-row__duration,
    .kickflow-event-row--mod-action .kickflow-event-row__more,
    .kickflow-event-row--mod-action .kickflow-event-row__remainder {
      color: var(--kickflow-modaction-meta-color);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    #${OWN_LIST_ID} .kickflow-event-row--mod-action {
      align-items: baseline;
      min-width: 0;
      margin: 2px 0;
      padding: 4px 5px;
      line-height: 1.45;
      word-break: break-word;
      overflow-wrap: anywhere;
      background: var(--kickflow-modaction-band);
      color: var(--kickflow-modaction-body-color);
      border: 0;
      border-radius: 4px;
      box-shadow: none;
    }
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__moderator {
      color: var(--kickflow-modaction-moderator-color);
    }
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__count,
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__duration,
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__more,
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__remainder {
      color: var(--kickflow-modaction-meta-color);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .kickflow-modaction-block {
      --kickflow-native-content-inline-padding: 8px;
      display: block; box-sizing: border-box; flex: 0 0 auto;
      width: calc(100% + (2 * var(--kickflow-native-content-inline-padding)));
      max-width: calc(100% + (2 * var(--kickflow-native-content-inline-padding))); min-width: 0;
      margin: 3px 0 0 calc(-1 * var(--kickflow-native-content-inline-padding)); padding-left: 0;
      font: inherit;
      border: 0;
    }
    .kickflow-modaction-block .kickflow-event-row {
      display: flex; align-items: baseline; min-width: 0; margin: 0; padding: 4px 0;
      color: inherit; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere;
      background: transparent;
      border: 0;
      border-radius: 0;
    }
    .kickflow-modaction-block .kickflow-event-row__body { min-width: 0; }

    /* --- KickFlow settings dashboard: one shared body-level modal for navbar + footer. --- */
    @keyframes kickflow-dashboard-in {
      from { opacity: 0; transform: scale(.98); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes kickflow-hotkey-capture {
      0%, 100% { opacity: .62; transform: scale(.985); }
      50% { opacity: 1; transform: scale(1); }
    }
    .kickflow-panel {
      position: fixed; inset: 0; z-index: 2147483000;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: oklch(0.12 0.01 150 / 0.55); color: oklch(0.95 0.006 150);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
      line-height: 1.4; overscroll-behavior: contain;
    }
    .kickflow-panel, .kickflow-panel * { box-sizing: border-box; }
    .kickflow-panel__shell {
      width: min(760px, 92vw); height: min(620px, 82vh); max-height: 82vh;
      display: grid; grid-template-columns: 202px minmax(0, 1fr); overflow: hidden;
      border: 1px solid oklch(0.30 0.01 150); border-radius: 14px;
      background: oklch(0.17 0.012 150);
      box-shadow: 0 24px 70px oklch(0.08 0.008 150 / .64);
      animation: kickflow-dashboard-in 180ms cubic-bezier(.16,1,.3,1) both;
    }
    .kickflow-panel__rail {
      min-width: 0; display: flex; flex-direction: column; padding: 25px 16px 17px;
      border-right: 1px solid oklch(0.30 0.01 150);
      background: oklch(0.20 0.012 150);
    }
    .kickflow-panel__wordmark {
      padding: 0 10px; color: oklch(0.95 0.006 150);
      font-size: 18px; font-weight: 800; letter-spacing: -.035em;
    }
    .kickflow-panel__rail-caption {
      margin: 20px 10px 8px; color: oklch(0.65 0.01 150);
      font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    }
    .kickflow-panel__nav { display: flex; flex-direction: column; gap: 4px; }
    .kickflow-panel__nav-item {
      appearance: none; width: 100%; min-height: 38px; padding: 0 12px; border: 0; border-radius: 9px;
      background: transparent; color: oklch(0.74 0.01 150); cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      font: 600 13px/1 'Inter','Segoe UI',system-ui,sans-serif; text-align: left;
      transition: background-color 140ms ease, color 140ms ease;
    }
    .kickflow-panel__nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kickflow-panel__nav-item:hover { background: oklch(0.26 0.01 150); color: oklch(0.90 0.008 150); }
    .kickflow-panel__nav-item--active,
    .kickflow-panel__nav-item--active:hover {
      background: oklch(0.86 0.24 145 / .11); color: oklch(0.86 0.24 145);
    }
    .kickflow-panel__version {
      margin: auto 10px 0; color: oklch(0.56 0.01 150); font-size: 10px; font-variant-numeric: tabular-nums;
    }
    .kickflow-panel__main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .kickflow-panel__header {
      flex: none; display: flex; align-items: center; min-height: 65px; padding: 0 25px 0 30px;
      background: oklch(0.17 0.012 150); border-bottom: 1px solid oklch(0.30 0.01 150);
    }
    .kickflow-panel__title {
      min-width: 0; flex: 1; margin: 0; color: oklch(0.95 0.006 150);
      font-size: 18px; font-weight: 700; letter-spacing: -.015em;
    }
    .kickflow-panel__count {
      min-width: 21px; margin-left: auto; padding: 2px 6px; border: 1px solid oklch(0.86 0.24 145 / .28);
      border-radius: 999px; background: oklch(0.86 0.24 145 / .11); color: oklch(0.86 0.24 145);
      font-size: 10px; font-weight: 800; line-height: 1.35; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .kickflow-panel__btn {
      appearance: none; width: 32px; height: 32px; padding: 0; margin: 0; border: 0;
      border-radius: 8px; background: transparent; color: oklch(0.68 0.01 150); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 400; line-height: 1;
      transition: background-color 140ms ease, color 140ms ease;
    }
    .kickflow-panel__btn:hover { background: oklch(0.24 0.01 150); color: oklch(0.95 0.006 150); }
    .kickflow-panel__settings {
      min-height: 0; flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 30px 30px;
      scrollbar-color: oklch(0.34 0.01 150) transparent; scrollbar-width: thin;
    }
    .kickflow-panel__section { padding-top: 22px; }
    .kickflow-panel__section[hidden] { display: none !important; }
    .kickflow-panel__section-intro {
      max-width: 480px; margin: 0 0 28px; color: oklch(0.70 0.01 150); font-size: 12px; line-height: 1.55;
    }
    .kickflow-panel__group { margin-top: 28px; }
    .kickflow-panel__section-intro + .kickflow-panel__group { margin-top: 0; }
    .kickflow-panel__settings-title {
      display: flex; align-items: center; margin: 0 0 8px; color: oklch(0.78 0.01 150);
      font-size: 12px; font-weight: 700; letter-spacing: .01em;
    }
    .kickflow-panel__stats {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; margin: 0;
      border-top: 1px solid oklch(0.30 0.01 150);
    }
    .kickflow-panel__stat {
      min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-height: 39px; border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__stat dt { color: oklch(0.66 0.01 150); font-size: 11px; }
    .kickflow-panel__stat dd {
      min-width: 0; display: flex; align-items: center; gap: 6px; margin: 0; overflow: hidden;
      color: oklch(0.91 0.007 150); font-size: 12px; font-weight: 650;
      font-variant-numeric: tabular-nums; white-space: nowrap; text-overflow: ellipsis;
    }
    .kickflow-panel__stat dd.kickflow-panel__stat-value--missing {
      color: oklch(0.58 0.01 150); font-weight: 500;
    }
    .kickflow-panel__live-dot {
      display: inline-block; width: 7px; height: 7px; flex: none; border-radius: 50%; background: oklch(0.45 0.01 150);
    }
    .kickflow-panel__live-dot--connected { background: oklch(0.86 0.24 145); }
    .kickflow-panel__settings-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer;
    }
    .kickflow-panel__settings-row--mode {
      min-height: 58px; padding: 10px 0; border-top: 1px solid oklch(0.30 0.01 150);
      border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__settings-row--toggle {
      min-height: 59px; padding: 10px 0; border-bottom: 1px solid oklch(0.27 0.01 150);
      border-radius: 7px;
    }
    .kickflow-panel__settings-row--toggle:first-child { border-top: 1px solid oklch(0.30 0.01 150); }
    .kickflow-panel__settings-row--toggle:hover { background: oklch(0.20 0.01 150); }
    .kickflow-panel__settings-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-right: 12px; }
    .kickflow-panel__settings-label { color: oklch(0.92 0.007 150); font-size: 14px; font-weight: 500; }
    .kickflow-panel__settings-description {
      overflow: hidden; color: oklch(0.66 0.01 150); font-size: 12px; line-height: 1.35;
      white-space: nowrap; text-overflow: ellipsis;
    }
    .kickflow-panel__settings select {
      min-width: 132px; height: 36px; padding: 0 10px;
      background: oklch(0.22 0.012 150); color: oklch(0.93 0.007 150);
      border: 1px solid oklch(0.34 0.01 150); border-radius: 8px;
      font: 600 12px/1 'Inter','Segoe UI',system-ui,sans-serif; cursor: pointer;
    }
    .kickflow-panel__settings-toggle {
      appearance: none; position: relative; flex: 0 0 auto; width: 38px; height: 22px; margin: 0;
      border: 1px solid oklch(0.38 0.01 150); border-radius: 999px; background: oklch(0.28 0.012 150);
      cursor: pointer; transition: background-color 160ms ease, border-color 160ms ease;
    }
    .kickflow-panel__settings-toggle::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%;
      background: oklch(0.72 0.01 150); box-shadow: 0 1px 2px oklch(0.08 0.008 150 / .42);
      transition: transform 160ms ease, background-color 160ms ease;
    }
    .kickflow-panel__settings-toggle:checked { border-color: oklch(0.86 0.24 145); background: oklch(0.86 0.24 145); }
    .kickflow-panel__settings-toggle:checked::after { background: oklch(0.18 0.012 150); transform: translateX(16px); }
    .kickflow-panel__settings-toggle:focus-visible,
    .kickflow-panel__settings select:focus-visible,
    .kickflow-panel__nav-item:focus-visible,
    .kickflow-panel__btn:focus-visible { outline: 2px solid oklch(0.86 0.24 145); outline-offset: 2px; }
    .kickflow-panel__settings-hint {
      margin: 15px 0 0; color: oklch(0.58 0.01 150); font-size: 11px; text-align: right;
    }
    .kickflow-panel__hotkeys {
      border-top: 1px solid oklch(0.30 0.01 150);
    }
    .kickflow-panel__hotkey-row {
      display: grid; grid-template-columns: minmax(0,1fr) auto auto 38px;
      align-items: center; gap: 10px; min-height: 60px;
      border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__hotkey-label {
      overflow: hidden; color: oklch(0.92 0.007 150); font-size: 14px; font-weight: 500;
      white-space: nowrap; text-overflow: ellipsis;
    }
    .kickflow-panel__hotkey-chip {
      min-width: 42px; padding: 6px 9px; border: 1px solid oklch(0.86 0.24 145 / .32); border-radius: 7px;
      background: oklch(0.86 0.24 145 / .08); color: oklch(0.86 0.24 145);
      font: 700 11px/1.2 ui-monospace,'SFMono-Regular',Consolas,monospace; text-align: center;
    }
    .kickflow-panel__hotkey-chip--capturing {
      min-width: 94px; animation: kickflow-hotkey-capture 1.1s ease-in-out infinite;
    }
    .kickflow-panel__hotkey-change,
    .kickflow-panel__hotkey-reset {
      appearance: none; border: 1px solid oklch(0.34 0.01 150); border-radius: 7px;
      background: transparent; color: oklch(0.72 0.01 150); cursor: pointer;
      font: 600 11px/1 'Inter','Segoe UI',system-ui,sans-serif;
      transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    .kickflow-panel__hotkey-change { min-width: 68px; height: 31px; padding: 0 10px; }
    .kickflow-panel__hotkey-change:hover,
    .kickflow-panel__hotkey-reset:hover { background: oklch(0.22 0.01 150); color: oklch(0.92 0.007 150); }
    .kickflow-panel__hotkey-change--capturing { border-color: oklch(0.86 0.24 145 / .55); color: oklch(0.86 0.24 145); }
    .kickflow-panel__hotkey-footer { display: flex; align-items: center; gap: 12px; min-height: 42px; margin-top: 10px; }
    .kickflow-panel__hotkey-status { min-width: 0; flex: 1; color: oklch(0.66 0.01 150); font-size: 11px; line-height: 1.35; }
    .kickflow-panel__hotkey-reset { flex: none; height: 32px; padding: 0 11px; }
    .kickflow-panel__hotkey-change:focus-visible,
    .kickflow-panel__hotkey-reset:focus-visible { outline: 2px solid oklch(0.86 0.24 145); outline-offset: 2px; }
    .kickflow-panel__removed-list {
      border-top: 1px solid oklch(0.31 0.01 150);
      border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__filter-chip {
      align-self: flex-start; margin: 0 0 12px; padding: 5px 9px; border: 1px solid oklch(0.43 0.012 150);
      border-radius: 999px; background: oklch(0.23 0.012 150); color: oklch(0.82 0.01 150);
      cursor: pointer; font: 650 11px/1.2 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-panel__filter-chip[hidden] { display: none; }
    .kickflow-panel__filter-chip:hover { border-color: oklch(0.56 0.02 145); color: #fff; }
    .kickflow-panel__filter-chip:focus-visible { outline: 2px solid oklch(0.86 0.24 145); outline-offset: 2px; }
    .kickflow-removed-row {
      display: grid; grid-template-columns: 44px minmax(0, 1fr) minmax(104px, auto);
      align-items: start; gap: 14px; padding: 15px 2px 14px;
      border-bottom: 1px solid oklch(0.27 0.01 150);
      color: oklch(0.91 0.007 150); word-break: break-word; overflow-wrap: anywhere;
    }
    .kickflow-removed-row:last-child { border-bottom: 0; }
    .kickflow-removed-row__time {
      padding-top: 2px; color: oklch(0.65 0.01 150); font-size: 10px; font-weight: 600;
      font-variant-numeric: tabular-nums; line-height: 1.4;
    }
    .kickflow-removed-row__message { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .kickflow-removed-row__username {
      width: fit-content; color: oklch(0.94 0.007 150); font-size: 13px; font-weight: 750; line-height: 1.25;
    }
    .kickflow-removed-row__username--link { cursor: pointer; }
    .kickflow-removed-row__username--link:hover { text-decoration: underline; }
    .kickflow-removed-row__content {
      color: oklch(0.77 0.01 150); font-size: 12px; line-height: 1.5;
      text-decoration-line: line-through; text-decoration-color: oklch(0.58 0.01 150);
      text-decoration-thickness: 1px;
    }
    .kickflow-removed-row__action {
      min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 5px;
    }
    .kickflow-panel .kickflow-removed-row .kickflow-status-label {
      margin: 0; padding: 3px 7px; border: 1px solid transparent; background: transparent;
      font-size: 9px; line-height: 1.2; letter-spacing: .045em;
    }
    .kickflow-panel .kickflow-removed-row .kickflow-status-label--banned {
      border-color: oklch(0.50 0.10 25 / .42); background: oklch(0.35 0.07 25 / .52); color: oklch(0.84 0.11 25);
    }
    .kickflow-panel .kickflow-removed-row .kickflow-status-label--timeout {
      border-color: oklch(0.57 0.09 78 / .38); background: oklch(0.36 0.055 78 / .48); color: oklch(0.86 0.10 84);
    }
    .kickflow-panel .kickflow-removed-row .kickflow-status-label--deleted {
      border-color: oklch(0.43 0.012 150 / .52); background: oklch(0.26 0.012 150); color: oklch(0.76 0.01 150);
    }
    .kickflow-panel .kickflow-removed-row .kickflow-mod-label {
      max-width: 128px; margin: 0; overflow: hidden; color: oklch(0.65 0.01 150); opacity: 1;
      font-size: 10px; font-weight: 550; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap;
    }
    .kickflow-removed-empty {
      min-height: 300px; display: grid; place-items: center; padding: 28px;
      color: oklch(0.66 0.01 150); font-size: 12px; text-align: center;
    }
    .kickflow-panel__about-mark {
      margin-top: 28px; color: oklch(0.95 0.006 150); font-size: 28px; font-weight: 800; letter-spacing: -.045em;
    }
    .kickflow-panel__about-copy {
      max-width: 430px; margin: 10px 0 30px; color: oklch(0.70 0.01 150); font-size: 13px; line-height: 1.6;
    }
    .kickflow-panel__about-facts { max-width: 430px; margin: 0; border-top: 1px solid oklch(0.30 0.01 150); }
    .kickflow-panel__about-facts > div {
      display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 44px;
      border-bottom: 1px solid oklch(0.27 0.01 150);
    }
    .kickflow-panel__about-facts dt { color: oklch(0.66 0.01 150); font-size: 12px; }
    .kickflow-panel__about-facts dd { margin: 0; color: oklch(0.90 0.007 150); font-size: 12px; font-weight: 600; }
    @media (max-width: 640px) {
      .kickflow-panel { padding: 12px; }
      .kickflow-panel__shell {
        width: min(94vw, 600px); height: 82vh; grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr);
      }
      .kickflow-panel__rail {
        padding: 14px 16px 12px; border-right: 0; border-bottom: 1px solid oklch(0.30 0.01 150);
      }
      .kickflow-panel__wordmark { padding: 0 4px; font-size: 16px; }
      .kickflow-panel__rail-caption, .kickflow-panel__version { display: none; }
      .kickflow-panel__nav {
        flex-direction: row; gap: 6px; margin-top: 11px; overflow-x: auto; overscroll-behavior-inline: contain;
        scrollbar-width: none;
      }
      .kickflow-panel__nav::-webkit-scrollbar { display: none; }
      .kickflow-panel__nav-item { width: auto; min-height: 32px; flex: 0 0 auto; padding: 0 12px; border-radius: 999px; white-space: nowrap; }
      .kickflow-panel__count { margin-left: 2px; }
      .kickflow-panel__header { min-height: 56px; padding: 0 18px; }
      .kickflow-panel__settings { padding: 0 18px 24px; }
      .kickflow-panel__section { padding-top: 18px; }
      .kickflow-panel__section-intro { margin-bottom: 22px; }
      .kickflow-panel__hotkey-row { gap: 8px; }
      .kickflow-panel__settings-description { max-width: 300px; }
    }
    @media (max-width: 430px) {
      .kickflow-panel__stats { grid-template-columns: 1fr; }
      .kickflow-panel__settings-description { max-width: 205px; }
      .kickflow-panel__hotkey-chip { min-width: 36px; padding-inline: 7px; }
      .kickflow-panel__hotkey-chip--capturing { min-width: 82px; }
      .kickflow-panel__hotkey-change { min-width: 62px; padding-inline: 7px; }
      .kickflow-removed-row { grid-template-columns: 40px minmax(0, 1fr); gap: 10px; }
      .kickflow-removed-row__action {
        grid-column: 2; flex-direction: row; align-items: center; justify-content: flex-start; flex-wrap: wrap;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .kickflow-panel__shell, .kickflow-panel__hotkey-chip--capturing { animation: none; }
    }

    /* --- Footer toggle button: injected into Kick's own chat footer, next to its send/gear
       cluster (see footer-toggle.ts). Sized to match Kick's neighboring icon buttons. --- */
    .kickflow-footer-toggle {
      position: relative; appearance: none; width: 30px; height: 30px; padding: 0; margin: 0;
      border: 0; border-radius: 8px; background: transparent; color: #b5b5be; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background .14s ease, color .14s ease;
    }
    .kickflow-footer-toggle:hover { background: rgba(255,255,255,0.1); }
    .kickflow-footer-toggle--active { color: #53fc18; }
    .kickflow-footer-toggle svg { width: 16px; height: 16px; display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .kickflow-footer-toggle__badge {
      position: absolute; top: 2px; right: 2px;
      background: #e9113c; color: #fff; border-radius: 999px;
      min-width: 14px; height: 14px; padding: 0 3px;
      font-size: 9px; font-weight: 800; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }

    /* Real-navbar first-child injection: one compact KickFlow mark, no dropdown or React clone. */
    .kickflow-navbar-settings {
      appearance: none; width: 34px; height: 34px; padding: 0; margin: 0; border: 1px solid rgba(255,255,255,.10);
      border-radius: 9px; background: rgba(255,255,255,.055); color: #53fc18; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      font: 950 17px/1 'Arial Black','Segoe UI',system-ui,sans-serif; letter-spacing: -.08em;
      text-shadow: 0 0 8px rgba(83,252,24,.18); transition: background .14s ease, border-color .14s ease, transform .09s ease;
    }
    .kickflow-navbar-settings:hover { background: rgba(83,252,24,.10); border-color: rgba(83,252,24,.35); }
    .kickflow-navbar-settings:active { transform: scale(.94); }
    .kickflow-navbar-settings--active { background: rgba(83,252,24,.13); border-color: rgba(83,252,24,.45); }
    .kickflow-navbar-settings:focus-visible { outline: 2px solid #53fc18; outline-offset: 2px; }

    /* --- Player controls, injected inline into Kick's native control bar. Global classes
       (not scoped to the chat list): they live inside Kick's dark bar and are styled to sit
       flush with the native buttons while keeping fixed dimensions across re-renders. --- */
    .kickflow-player-group {
      display: inline-flex; align-items: center; gap: 5px;
      height: 32px; margin-left: 5px;
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-player-group--lead {
      margin-left: 6px; padding-left: 8px;
      border-left: 1px solid rgba(255,255,255,0.18);
    }
    .kickflow-player-btn,
    .kickflow-speed-btn {
      appearance: none;
      display: inline-flex; align-items: center; justify-content: center;
      margin: 0; border: 0; color: #fff; line-height: 1; white-space: nowrap; cursor: pointer;
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
      transition: background .14s ease, opacity .14s ease, transform .09s ease, color .14s ease;
    }
    .kickflow-player-btn {
      gap: 3px; height: 32px; min-width: 32px; padding: 0 10px; border-radius: 999px;
      background: rgba(255,255,255,0.07); opacity: 0.82; font-size: 12px; font-weight: 600;
    }
    .kickflow-player-btn:hover,
    .kickflow-speed-btn:hover {
      background: rgba(255,255,255,0.16); opacity: 1;
    }
    .kickflow-player-btn:active,
    .kickflow-speed-btn:active {
      background: rgba(255,255,255,0.24); transform: scale(0.94);
    }
    .kickflow-player-btn:focus-visible,
    .kickflow-speed-btn:focus-visible {
      outline: 2px solid #53fc18; outline-offset: 1px;
    }
    .kickflow-player-btn svg {
      width: 15px; height: 15px; display: block;
      fill: none; stroke: currentColor; stroke-width: 2.3;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .kickflow-seek-pill {
      display: inline-flex; align-items: stretch; height: 32px; overflow: hidden;
      border-radius: 999px; background: rgba(255,255,255,0.07);
    }
    .kickflow-seek-pill__btn {
      height: 32px; min-width: 49px; border-radius: 0; padding: 0 8px;
      background: transparent;
    }
    .kickflow-seek-pill__btn + .kickflow-seek-pill__btn {
      border-left: 1px solid rgba(255,255,255,0.18);
    }
    .kickflow-seek-pill__btn:active { transform: none; }
    .kickflow-player-btn--live {
      min-width: 112px; font-weight: 700; padding: 0 12px;
      font-variant-numeric: tabular-nums;
    }
    .kickflow-player-btn--live::before {
      content: ''; width: 7px; height: 7px; margin-right: 2px; border-radius: 50%;
      background: #e9113c; box-shadow: 0 0 5px rgba(233,17,60,0.7);
      transition: background .14s ease, box-shadow .14s ease;
    }
    .kickflow-player-btn--behind {
      background: rgba(255,176,32,0.14); color: #ffb020; opacity: 0.95;
    }
    .kickflow-player-btn--behind:hover { background: rgba(255,176,32,0.26); }
    .kickflow-player-btn--behind::before {
      background: #ffb020; box-shadow: 0 0 5px rgba(255,176,32,0.7);
    }
    .kickflow-speed-btn {
      height: 32px; min-width: 64px; padding: 0 12px; border-radius: 999px;
      background: rgba(255,255,255,0.07); opacity: 0.9;
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .kickflow-speed-menu {
      position: fixed; z-index: 2147483647; min-width: 128px; padding: 6px;
      border: 1px solid rgba(255,255,255,0.16); border-radius: 8px;
      background: rgba(18,20,24,0.97); color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-speed-menu__item {
      appearance: none; display: flex; align-items: center; gap: 7px;
      width: 100%; height: 30px; padding: 0 10px; border: 0; border-radius: 5px;
      background: transparent; color: #fff; cursor: pointer;
      font-size: 12px; font-weight: 700; text-align: left; font-variant-numeric: tabular-nums;
    }
    .kickflow-speed-menu__item::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%; background: transparent;
    }
    .kickflow-speed-menu__item[aria-checked="true"]::before { background: #53fc18; }
    .kickflow-speed-menu__item:hover,
    .kickflow-speed-menu__item:focus-visible {
      outline: none; background: rgba(255,255,255,0.13);
    }
    .kickflow-speed-menu__separator {
      height: 1px; margin: 5px 4px; background: rgba(255,255,255,0.14);
    }
    .kickflow-speed-warning {
      position: fixed; left: 50%; bottom: 92px; transform: translateX(-50%);
      z-index: 2147483647; padding: 7px 11px; border-radius: 6px;
      background: rgba(18,20,24,0.96); color: #ffcf66;
      border: 1px solid rgba(255,207,102,0.35); box-shadow: 0 8px 24px rgba(0,0,0,0.38);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif; font-size: 12px; font-weight: 700;
      line-height: 1; white-space: nowrap;
    }

  `;
  document.head.appendChild(style);
}

function initNativeChatIntegrity(
  context: ChatSessionContext,
  lifecycle: Lifecycle,
  panel: RemovedMessagesPanel,
): void {
  const { slug } = context;
  setSubscriberBadges([]);
  configureUserCardSession(slug);
  const archive = new UserMessageArchive();
  configureUserMessageArchive(archive);
  lifecycle.add(() => {
    configureUserMessageArchive(null);
    configureUserCardSession(null);
  });
  let augmenter: NativeChatAugmenter | null = null;
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message) => {
      augmenter?.forgetGhost(message.id);
      // A mounted native row must lose its stale strike/status immediately when the preserved
      // TTL/cap releases it; forgetGhost only covers rows that Kick removed from the list.
      augmenter?.markById(message.id);
    },
    onMessageAdded: (message) => {
      archive.add(message);
      if (message.preserved) archive.markDeleted(message.id);
    },
    onMessagePreserved: (message) => archive.markDeleted(message.id),
  });
  augmenter = new NativeChatAugmenter(lifecycle, store);
  setHighlightStore(store);
  lifecycle.add(() => setHighlightStore(null));
  syncHighlightCssVars();
  panel.setStore(store);
  lifecycle.add(() => panel.setStore(null));
  initActiveChattersBadgesSession(lifecycle, store, panel);
  new FooterToggleButton(lifecycle, panel);
  const renderNativeModAction = (notice: ModActionNotice): void => {
    augmenter?.showModActionNotice(notice, {
      onJump: jumpToChatMessage,
      onOpenPanel: () => panel.showSettings('removed'),
    });
  };
  initModActionNotificationsSession(context, lifecycle, {
    onNotice: renderNativeModAction,
    onNoticeUpdated: renderNativeModAction,
    clear: () => augmenter?.clearModActionNotices(),
  });
  lifecycle.setInterval(() => {
    store.sweepExpiredPreserved();
    archive.sweepExpired();
  }, PRESERVED_SWEEP_INTERVAL_MS);

  // Kick owns the correct timestamp-synchronized replay DOM. Background live Pusher traffic has
  // no valid role on a VOD and would pollute this session's evidence store with present-day chat.
  if (context.kind === 'vod') {
    setStatus({
      active: true,
      pusherConnected: false,
      reason: t('status.active_native_replay'),
    });
    return;
  }

  resolveChannel(slug).then((resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      setStatus({ reason: t('status.chatroom_unresolved') });
      return;
    }
    setSubscriberBadges(resolved.subscriberBadges);
    const { chatroomId, channelId } = resolved;
    setStatus({ chatroomId, reason: t('status.pusher_connecting') });
    const client = new PusherClient(chatroomId, channelId, {
      onConnected: () => {
        setStatus({ reason: t('status.socket_waiting') });
      },
      onPrimarySubscriptionReady: () => {
        setStatus({ pusherConnected: true, active: true, reason: t('status.active_native') });
      },
      onPrimarySubscriptionUnavailable: () => {
        setStatus({ pusherConnected: false, active: false, reason: t('status.subscription_waiting_native') });
      },
      onDisconnected: () => {
        setStatus({ pusherConnected: false });
      },
      onMessage: (message) => {
        store.addMessage(message);
      },
      onUserBanned: (payload) => {
        setStatus({ lastBanAt: Date.now() });
        handleUserBanned(payload, {
          store,
          augmenter,
          onModAction: (action) => pushModActionForSession(lifecycle, action),
        });
      },
      onMessageDeleted: (payload) => {
        handleMessageDeleted(payload, {
          store,
          augmenter,
          onModAction: (action) => pushModActionForSession(lifecycle, action),
        });
      },
    });
    lifecycle.add(() => {
      client.dispose();
      setStatus({ pusherConnected: false });
    });
    client.connect();
  });
}

/** Reconciles a Mode-A row after preservation expires or its 50-entry cap evicts it. A message
 * still held by the ordinary retention rings remains a normal chat row; only an object already
 * outside those rings is removed from the DOM. Exported for the integration regression test. */
export function reconcileOwnPreservedEviction(
  message: ChatMessage,
  store: ChatIntegrityStore,
  registry: ChatDomRegistry,
): void {
  const element = registry.getElementForMessageId(message.id);
  if (!element) return;
  if (store.getMessageById(message.id) === message) {
    clearPreservedMarking(element);
    return;
  }
  registry.forget(element);
  element.remove();
}

function initOwnChatIntegrity(
  context: ChatSessionContext,
  lifecycle: Lifecycle,
  panel: RemovedMessagesPanel,
): void {
  const { slug } = context;
  setSubscriberBadges([]);
  configureUserCardSession(slug);
  const archive = new UserMessageArchive();
  configureUserMessageArchive(archive);
  lifecycle.add(() => {
    configureUserMessageArchive(null);
    configureUserCardSession(null);
  });

  const registry = new ChatDomRegistry();
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message: ChatMessage) => reconcileOwnPreservedEviction(message, store, registry),
    onMessageAdded: (message) => {
      archive.add(message);
      if (message.preserved) archive.markDeleted(message.id);
    },
    onMessagePreserved: (message) => archive.markDeleted(message.id),
  });
  setHighlightStore(store);
  lifecycle.add(() => setHighlightStore(null));
  syncHighlightCssVars();
  panel.setStore(store);
  lifecycle.add(() => panel.setStore(null));
  initActiveChattersBadgesSession(lifecycle, store, panel);
  new FooterToggleButton(lifecycle, panel);

  const mount = new ChatOverlayMount(lifecycle);
  mount.setProbing();
  const ownList = mount.ownList;

  const scrollPill = document.createElement('button');
  scrollPill.type = 'button';
  scrollPill.className = 'kickflow-scroll-pill';
  scrollPill.textContent = t('chat.new_messages');
  scrollPill.style.display = 'none';
  scrollPill.style.pointerEvents = 'auto';
  const scrollFollow = new ScrollFollowController(ownList, {
    onPinnedChange: (pinned) => {
      if (pinned) scrollPill.style.display = 'none';
    },
  });
  lifecycle.add(() => scrollFollow.dispose());
  scrollPill.addEventListener('click', () => {
    scrollFollow.scrollToBottom();
    scrollPill.style.display = 'none';
  });
  mount.root.appendChild(scrollPill);
  lifecycle.add(() => scrollPill.remove());

  let vodStartTimeMs: number | null = null;
  const renderQueue = new RenderQueue({
    getContainer: () => mount.getRenderContainer(),
    registry,
    // A delete can arrive while its ChatMessageEvent is waiting in RenderQueue's 250ms batch.
    // Only render objects that this session's store still owns: this drops those removed-before-
    // flush rows and also prevents a replayed Pusher/history id from creating a duplicate row.
    shouldRender: (message) => store.getMessageById(message.id) === message,
    onOpenRemovedPanel: () => panel.showSettings('removed'),
    formatTimestamp: context.kind === 'vod'
      ? (message) => vodStartTimeMs === null
        ? ''
        : formatVodReplayTimestamp(message.createdAt, vodStartTimeMs)
      : undefined,
    onFlush: (appended /*, wasAtBottom */) => {
      mount.noteContentAppended(appended);
      if (mount.state === 'active') {
        setStatus({
          active: true,
          pusherConnected: context.kind === 'live' ? getStatus().pusherConnected : false,
          reason: context.kind === 'vod'
            ? t('status.active_vod_replay')
            : t('status.active_own'),
        });
      }

      const decision = decideScrollFollow(scrollFollow.isPinned, appended.length);
      trimMessageWindow(ownList, registry, decision.trimCap);
      scrollFollow.observeRows(appended);
      if (decision.scrollToBottom) {
        scrollFollow.scrollToBottom();
      }
      if (decision.showPill) {
        scrollPill.style.display = '';
      } else if (decision.scrollToBottom) {
        scrollPill.style.display = 'none';
      }
    },
  });
  lifecycle.add(() => renderQueue.dispose());
  lifecycle.setInterval(() => {
    store.sweepExpiredPreserved();
    archive.sweepExpired();
  }, PRESERVED_SWEEP_INTERVAL_MS);

  const enqueueOnce = (message: ChatMessage): void => {
    if (store.addMessage(message)) renderQueue.enqueue(message);
  };

  const updateSystemEvent = (message: ChatMessage): void => {
    const nextEvent = message.systemEvent;
    if (!nextEvent || nextEvent.kind !== 'mod-action') {
      enqueueOnce(message);
      return;
    }
    const existing = store.getMessageById(message.id);
    if (!existing) {
      enqueueOnce(message);
      return;
    }
    if (!existing.systemEvent || existing.systemEvent.kind !== 'mod-action') return;
    existing.systemEvent = nextEvent;
    const element = registry.getElementForMessageId(message.id);
    if (!element) return;
    const replacement = buildMessageElement(existing, {
      onOpenRemovedPanel: () => panel.showSettings('removed'),
    });
    registry.forget(element);
    element.replaceWith(replacement);
    registry.register(replacement, existing);
  };

  const systemEventCallbacks = createSystemEventCallbacks(enqueueOnce, updateSystemEvent);
  initModActionNotificationsSession(context, lifecycle, {
    onNotice: systemEventCallbacks.onModAction,
    onNoticeUpdated: systemEventCallbacks.onModActionUpdated,
    clear: () => undefined,
  });

  lifecycle.setTimeout(() => {
    mount.initialNoContentDeadline();
    if (mount.state === 'fallback') {
      setStatus({ active: false, reason: t('status.content_not_ready') });
    }
  }, INITIAL_NO_CONTENT_FALLBACK_MS);

  resolveChannel(slug).then(async (resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      mount.failOpen('channel-resolution-failed');
      setStatus({ active: false, reason: t('status.chatroom_unresolved_native') });
      return;
    }
    setSubscriberBadges(resolved.subscriberBadges);
    const { chatroomId, channelId } = resolved;
    setStatus({
      chatroomId,
      pusherConnected: false,
      reason: context.kind === 'vod'
        ? t('status.vod_replay_loading')
        : t('status.pusher_connecting'),
    });

    if (context.kind === 'vod') {
      const resetReplayWindow = (): void => {
        renderQueue.clearPending();
        store.reset();
        registry.clear();
        for (const row of ownList.querySelectorAll<HTMLElement>(
          '.kickflow-message, .kickflow-event-row',
        )) {
          row.remove();
        }
        scrollPill.style.display = 'none';
        mount.setReplayLoading();
        setStatus({
          active: mount.state === 'active',
          pusherConnected: false,
          reason: t('status.vod_replay_loading'),
        });
      };

      const replay = new VodChatReplayController(
        lifecycle,
        channelId,
        context.videoId,
        {
          onReset: resetReplayWindow,
          onMessages: (messages, startTimeMs) => {
            vodStartTimeMs = startTimeMs;
            for (const message of messages) enqueueOnce(message);
          },
          onReady: () => {
            mount.setReplayReady();
            setStatus({
              active: mount.state === 'active',
              pusherConnected: false,
              reason: t('status.active_vod_replay'),
            });
          },
          onUnavailable: () => {
            mount.failOpen('vod-replay-unavailable');
            setStatus({
              active: false,
              pusherConnected: false,
              reason: t('status.vod_replay_failed_native'),
            });
          },
        },
      );
      void replay.start();
      return;
    }

    let primaryReady = false;
    let hasPrimaryReadyOnce = false;
    let reconnectGraceTimer: number | null = null;
    const clearReconnectGrace = (): void => {
      if (reconnectGraceTimer === null) return;
      window.clearTimeout(reconnectGraceTimer);
      reconnectGraceTimer = null;
    };
    lifecycle.add(clearReconnectGrace);
    const historyBackfill = new ChatHistoryBackfill(channelId, {
      isDisposed: () => lifecycle.isDisposed,
      onMessages: (history) => {
        for (const message of history) {
          enqueueOnce(message);
        }
      },
      onResult: (result) => {
        if (result.status === 'success') {
          if (result.messages.length === 0 && !primaryReady && mount.state !== 'active') {
            setStatus({ reason: t('status.history_empty') });
          }
          return;
        }
        if (mount.state !== 'active') {
          setStatus({ reason: t('status.history_failed') });
        }
      },
    });
    // History is independent from the socket handshake. Starting it now closes the initial gap
    // even when WebSocket establishment is slow or temporarily unavailable.
    historyBackfill.request();
    const client = new PusherClient(chatroomId, channelId, {
      onConnected: () => {
        if (!getStatus().active) setStatus({ reason: t('status.socket_waiting') });
      },
      onPrimarySubscriptionReady: () => {
        primaryReady = true;
        clearReconnectGrace();
        mount.setPrimaryReady();
        setStatus({
          pusherConnected: true,
          active: mount.state === 'active',
          reason: mount.state === 'active'
            ? t('status.active_ready')
            : t('status.chatroom_ready_waiting'),
        });
        if (hasPrimaryReadyOnce) historyBackfill.request();
        hasPrimaryReadyOnce = true;
      },
      onPrimarySubscriptionUnavailable: (reason) => {
        primaryReady = false;
        clearReconnectGrace();
        mount.setPrimaryUnavailable(`primary-${reason}`);
        setStatus({
          pusherConnected: false,
          active: false,
          reason: t('status.primary_unavailable', { reason }),
        });
      },
      onDisconnected: () => {
        const keepDuringGrace = mount.state === 'active';
        primaryReady = false;
        setStatus({ pusherConnected: false });
        if (!keepDuringGrace) return;
        mount.setReconnecting();
        setStatus({ active: true, reason: t('status.reconnecting') });
        clearReconnectGrace();
        reconnectGraceTimer = window.setTimeout(() => {
          reconnectGraceTimer = null;
          if (primaryReady || lifecycle.isDisposed) return;
          mount.setPrimaryUnavailable('primary-reconnect-grace-expired');
          setStatus({ active: false, reason: t('status.reconnect_failed') });
        }, PRIMARY_RECONNECT_GRACE_MS);
      },
      onMessage: (message) => {
        enqueueOnce(message);
      },
      onSubscription: systemEventCallbacks.onSubscription,
      onGiftedSubscriptions: systemEventCallbacks.onGiftedSubscriptions,
      onKicksGifted: systemEventCallbacks.onKicksGifted,
      onHost: systemEventCallbacks.onHost,
      onChatroomUpdated: systemEventCallbacks.onChatroomUpdated,
      onUserBanned: (payload) => {
        setStatus({ lastBanAt: Date.now() });
        handleUserBanned(payload, {
          store,
          registry,
          onModAction: (action) => pushModActionForSession(lifecycle, action),
        });
      },
      onMessageDeleted: (payload) => {
        handleMessageDeleted(payload, {
          store,
          registry,
          onModAction: (action) => pushModActionForSession(lifecycle, action),
        });
      },
    });
    lifecycle.add(() => {
      client.dispose();
      setStatus({ pusherConnected: false });
    });
    client.connect();
  });
}

export function initChatIntegrity(
  context: ChatSessionContext,
  lifecycle: Lifecycle,
  panel: RemovedMessagesPanel = getSiteSettingsPanel(),
): void {
  if (featureFlags.chatMode === 'own') {
    initOwnChatIntegrity(context, lifecycle, panel);
  } else {
    initNativeChatIntegrity(context, lifecycle, panel);
  }
}

const playerFeatureInitializers: Record<PlayerFeatureFlagKey, (lifecycle: Lifecycle) => void> = {
  captionGuard: initCaptionGuard,
  rewindControls: initRewindControls,
  liveCatchup: initLiveCatchup,
  qualityLock: initQualityLock,
  screenshot: initScreenshot,
  speedControls: initSpeedControls,
};

let playerSessionLifecycle: Lifecycle | null = null;
const playerFeatureLifecycles = new Map<PlayerFeatureFlagKey, Lifecycle>();

function syncPlayerFeature(key: PlayerFeatureFlagKey): void {
  const session = playerSessionLifecycle;
  const active = playerFeatureLifecycles.get(key);
  if (!featureFlags[key] || !session || session.isDisposed) {
    active?.dispose();
    playerFeatureLifecycles.delete(key);
    return;
  }
  if (active && !active.isDisposed) return;

  const featureLifecycle = new Lifecycle();
  playerFeatureLifecycles.set(key, featureLifecycle);
  shareNativeBarMountManager(featureLifecycle, session);
  playerFeatureInitializers[key](featureLifecycle);
}

function disposePlayerFeatures(): void {
  for (const lifecycle of playerFeatureLifecycles.values()) lifecycle.dispose();
  playerFeatureLifecycles.clear();
  playerSessionLifecycle = null;
}

/** Fully independent of chat readiness — gated only on the video element, not on
 * #chatroom-messages (which can legitimately take a while, or never resolve). Each owner-facing
 * player flag owns a child lifecycle, making live OFF a real teardown rather than a CSS hide. */
export function initPlayerQolSession(lifecycle: Lifecycle): void {
  if (!getVideoElement()) {
    logger.debug('bootstrap: #video-player not present yet, player QoL module waiting');
  }

  whenElementPresent<HTMLVideoElement>(
    SELECTORS.videoPlayer,
    lifecycle,
    () => {
      playerSessionLifecycle = lifecycle;
      lifecycle.add(() => {
        if (playerSessionLifecycle === lifecycle) disposePlayerFeatures();
      });
      initAutoTheater(lifecycle);
      initRewindHotkeys(lifecycle);
      for (const key of PLAYER_FEATURE_KEYS) syncPlayerFeature(key);
    },
    { resolve: getVideoElement },
  );
}

let currentLifecycle: Lifecycle | null = null;
let currentSessionContext: ChatSessionContext | null = null;
let sessionToken = 0;
let navPollId: number | null = null;
let navigationInitialized = false;

export interface SiteLifecycleServices {
  lifecycle: Lifecycle;
  panel: RemovedMessagesPanel;
  layoutWatchdog: LayoutWatchdog | null;
}

let siteLifecycleServices: SiteLifecycleServices | null = null;

/** Creates the SPA-wide composition root once. Session navigation only swaps the store bound to
 * this panel; the navbar entry point and dashboard therefore survive channel route changes. */
export function initSiteLifecycle(): SiteLifecycleServices {
  if (siteLifecycleServices && !siteLifecycleServices.lifecycle.isDisposed) return siteLifecycleServices;

  const lifecycle = new Lifecycle();
  ensureStyles();
  const panel = new RemovedMessagesPanel(lifecycle, null, getLiveStatusSnapshot);
  new NavbarSettingsButton(lifecycle, panel);
  siteLifecycleServices = { lifecycle, panel, layoutWatchdog: null };
  return siteLifecycleServices;
}

function getSiteSettingsPanel(): RemovedMessagesPanel {
  return initSiteLifecycle().panel;
}

function disposeSiteLifecycle(): void {
  const services = siteLifecycleServices;
  siteLifecycleServices = null;
  services?.lifecycle.dispose();
}

/** Starts or stops the site-owned layout watchdog without creating it while debug logging is off. */
export function syncLayoutWatchdog(): void {
  if (!featureFlags.debugLogging) {
    siteLifecycleServices?.layoutWatchdog?.stop();
    return;
  }

  const services = siteLifecycleServices ?? initSiteLifecycle();
  if (!services.layoutWatchdog) {
    const watchdog = new LayoutWatchdog();
    services.layoutWatchdog = watchdog;
    services.lifecycle.add(() => watchdog.stop());
  }
  services.layoutWatchdog.start();
}

interface ActiveChattersBadgesContext {
  sessionLifecycle: Lifecycle;
  store: ChatIntegrityStore;
  panel: RemovedMessagesPanel;
  featureLifecycle: Lifecycle | null;
  controller: ActiveChattersBadgesController | null;
}
let activeChattersBadgesContext: ActiveChattersBadgesContext | null = null;

interface ModActionNotificationRenderer {
  onNotice: (notice: ModActionNotice) => void;
  onNoticeUpdated: (notice: ModActionNotice) => void;
  clear: () => void;
}

interface ModActionNotificationsContext {
  sessionLifecycle: Lifecycle;
  chatContext: ChatSessionContext;
  renderer: ModActionNotificationRenderer;
  featureLifecycle: Lifecycle | null;
  feed: ModActionFeed | null;
}

let activeModActionNotificationsContext: ModActionNotificationsContext | null = null;

function stopModActionNotifications(): void {
  const context = activeModActionNotificationsContext;
  if (!context) return;
  const lifecycle = context.featureLifecycle;
  context.featureLifecycle = null;
  context.feed = null;
  context.renderer.clear();
  lifecycle?.dispose();
}

function jumpToChatMessage(messageId: string, missCueElement: HTMLElement): void {
  if (jumpToMessage(messageId, missCueElement)) return;
  const nativeRow = Array.from(document.querySelectorAll<HTMLElement>('#chatroom-messages [data-kickflow-mid]'))
    .find((element) => element.dataset.kickflowMid === messageId);
  nativeRow?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function pushModActionForSession(sessionLifecycle: Lifecycle, action: ModAction): void {
  const context = activeModActionNotificationsContext;
  if (
    !context
    || context.sessionLifecycle !== sessionLifecycle
    || !context.feed
    || !featureFlags.showModActions
  ) return;
  context.feed.push(action);
}

function syncModActionNotifications(): void {
  const context = activeModActionNotificationsContext;
  if (
    !context
    || context.sessionLifecycle.isDisposed
    || context.chatContext.kind === 'vod'
    || !featureFlags.showModActions
  ) {
    stopModActionNotifications();
    return;
  }
  if (context.featureLifecycle && !context.featureLifecycle.isDisposed) return;

  const lifecycle = new Lifecycle();
  const feed = new ModActionFeed({
    onNotice: context.renderer.onNotice,
    onNoticeUpdated: context.renderer.onNoticeUpdated,
  });
  context.featureLifecycle = lifecycle;
  context.feed = feed;
  lifecycle.add(() => feed.dispose());
}

/** Owns the live-only feed and gives the flag path a real teardown boundary. */
export function initModActionNotificationsSession(
  chatContext: ChatSessionContext,
  sessionLifecycle: Lifecycle,
  renderer: ModActionNotificationRenderer,
): void {
  stopModActionNotifications();
  activeModActionNotificationsContext = null;
  if (chatContext.kind === 'vod') return;

  const context: ModActionNotificationsContext = {
    sessionLifecycle,
    chatContext,
    renderer,
    featureLifecycle: null,
    feed: null,
  };
  activeModActionNotificationsContext = context;
  sessionLifecycle.add(() => {
    if (activeModActionNotificationsContext !== context) return;
    stopModActionNotifications();
    activeModActionNotificationsContext = null;
  });
  syncModActionNotifications();
}

function stopActiveChattersBadges(): void {
  const context = activeChattersBadgesContext;
  if (!context) return;
  const lifecycle = context.featureLifecycle;
  context.featureLifecycle = null;
  context.controller = null;
  lifecycle?.dispose();
}

function syncActiveChattersBadges(): void {
  const context = activeChattersBadgesContext;
  if (!context || context.sessionLifecycle.isDisposed || !featureFlags.showChattersBadges) {
    stopActiveChattersBadges();
    return;
  }
  if (context.featureLifecycle && !context.featureLifecycle.isDisposed) return;

  ensureStyles();
  const lifecycle = new Lifecycle();
  context.featureLifecycle = lifecycle;
  context.controller = new ActiveChattersBadgesController(lifecycle, context.store, context.panel);
}

/** Registers the current session's store/panel pair so the owner-facing flag can perform a real
 * live start/stop without restarting chat or leaking evidence across channel sessions. */
export function initActiveChattersBadgesSession(
  sessionLifecycle: Lifecycle,
  store: ChatIntegrityStore,
  panel: RemovedMessagesPanel,
): void {
  stopActiveChattersBadges();
  const context: ActiveChattersBadgesContext = {
    sessionLifecycle,
    store,
    panel,
    featureLifecycle: null,
    controller: null,
  };
  activeChattersBadgesContext = context;
  sessionLifecycle.add(() => {
    if (activeChattersBadgesContext !== context) return;
    stopActiveChattersBadges();
    activeChattersBadgesContext = null;
  });
  syncActiveChattersBadges();
}

/** Named (not inline) so teardownZombie can removeEventListener it. */
function onPopstate(): void {
  window.dispatchEvent(new Event('kickflow:locationchange'));
}

function startSession(context: ChatSessionContext): void {
  const { slug } = context;
  const token = ++sessionToken;
  const panel = getSiteSettingsPanel();
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');
  configureUserCardSession(null);

  const lifecycle = new Lifecycle();
  currentLifecycle = lifecycle;

  // Player QoL and chat integrity are started concurrently and never gate each other.
  initAutoClaimDrops(lifecycle);
  initPlayerQolSession(lifecycle);

  if (!document.querySelector(SELECTORS.chatMessagesContainer)) {
    logger.debug('bootstrap:', SELECTORS.chatMessagesContainer, 'not present yet for', slug, '- chat integrity module waiting');
    setStatus({ reason: t('status.waiting_chat_panel') }); // popup parity while we observe for a late panel
  }
  whenElementPresent(SELECTORS.chatMessagesContainer, lifecycle, () => {
    if (token !== sessionToken || lifecycle.isDisposed) return;
    // chatContainer is the gate that the chat panel exists; the native augmenter then
    // observes #chatroom-messages and survives Kick replacing the inner list.
    initChatIntegrity(context, lifecycle, panel);
  });
}

function stopSession(): void {
  currentLifecycle?.dispose();
  currentLifecycle = null;
}

/** The extension context died (reload/update/disable) while this injected script kept running.
 * Nothing here can talk to the extension anymore, so this must be TERMINAL: stop the nav
 * listeners FIRST (otherwise a browser back/forward after teardown could still fire popstate ->
 * locationchange -> handlePotentialNavigation and spin up a brand-new zombie session with no
 * poller left to catch it), then stop all work and restore Kick's own UI: dispose the session
 * lifecycle (timers/observers/overlay) and un-hide native chat. The next page load injects a
 * fresh, working script. Idempotent — safe to call more than once. */
function teardownZombie(): void {
  window.removeEventListener('popstate', onPopstate);
  window.removeEventListener('kickflow:locationchange', handlePotentialNavigation);
  window.removeEventListener('kickflow:setFlag', onWindowFlagChange);
  if (navPollId !== null) {
    window.clearInterval(navPollId);
    navPollId = null;
  }
  stopSession();
  disposeSiteLifecycle();
  configureUserCardSession(null);
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.querySelector('.kickflow-panel')?.remove();
  document.getElementById('kickflow-footer-toggle')?.remove();
  document.getElementById('kickflow-navbar-settings')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');
}

/** Named so extension-reload zombie teardown can remove the page-event route too. */
function onWindowFlagChange(event: Event): void {
  const detail = (event as CustomEvent<{ key: string; value: boolean | string }>).detail;
  if (detail && typeof detail.key === 'string') applyFlagChange(detail.key, detail.value);
}

function handlePotentialNavigation(): void {
  if (!isExtensionContextValid()) {
    // Belt-and-suspenders: a queued popstate/locationchange can still fire this before
    // teardownZombie's removeEventListener above takes effect.
    teardownZombie();
    return;
  }

  const context = parseChatSessionContext(window.location.pathname);
  const previousSessionKey = currentSessionContext?.sessionKey ?? null;
  const nextSessionKey = context?.sessionKey ?? null;
  if (navigationInitialized && nextSessionKey === previousSessionKey) return;
  navigationInitialized = true;

  logger.debug('bootstrap: chat session changed', previousSessionKey, '->', nextSessionKey);
  stopSession();
  currentSessionContext = context;
  resetStatus(context?.slug ?? null);
  if (context) {
    startSession(context);
  }
}

/** Single mutator for feature flags — used by BOTH the popup (chrome message) and the in-panel
 * gear (window event), so featureFlags stays the one source of truth and side effects (reconcile
 * / session restart / persist) happen exactly once per change. */
export function applyFlagChange(key: string, value: boolean | string): void {
  if (isBooleanFlagKey(key) && typeof value === 'boolean') {
    setFeatureFlag(key, value);
    if (key === 'speedControls' && !value) deactivateSpeedControls();
    if (key === 'showDeletedMessages' || key === 'preserveBansInline') reconcileActiveNativeChat();
    if (key === 'debugLogging') {
      setDebugLogging(value);
      syncLayoutWatchdog();
    }
    if (key === 'autoTheater') syncAutoTheaterFlag();
    if (key === 'autoClaimDrops') syncAutoClaimDropsFlag();
    if (isPlayerFeatureFlagKey(key)) syncPlayerFeature(key);
    if (key === 'showChattersBadges') {
      syncActiveChattersBadges();
    }
    if (key === 'showModActions') {
      syncModActionNotifications();
    }
    if (
      key === 'mentionHighlightEnabled'
      || key === 'modFrameEnabled'
      || key === 'vipFrameEnabled'
    ) {
      refreshMessageHighlights();
      reconcileActiveNativeChat();
    }
    void safeStorageSet({ ['kf_flag_' + key]: value });
  } else if (key === 'chatMode' && (value === 'native' || value === 'own')) {
    setFeatureFlag('chatMode', value);
    void safeStorageSet({ kf_flag_chatMode: value });
    if (currentSessionContext) {
      stopSession();
      resetStatus(currentSessionContext.slug);
      startSession(currentSessionContext);
    }
  } else if (key === 'mentionHighlightStyle' && (value === 'frame' || value === 'fill' || value === 'both')) {
    setFeatureFlag('mentionHighlightStyle', value);
    void safeStorageSet({ kf_flag_mentionHighlightStyle: value });
    refreshMessageHighlights();
    reconcileActiveNativeChat();
  } else if (key === 'roleHighlightStyle' && (value === 'frame' || value === 'both')) {
    setFeatureFlag('roleHighlightStyle', value);
    void safeStorageSet({ kf_flag_roleHighlightStyle: value });
    refreshMessageHighlights();
    reconcileActiveNativeChat();
  } else if (isHighlightColorFlagKey(key) && typeof value === 'string') {
    const sanitized = sanitizeHighlightColor(value);
    setFeatureFlag(key, sanitized);
    void safeStorageSet({ ['kf_flag_' + key]: sanitized });
    refreshMessageHighlights();
    reconcileActiveNativeChat();
  } else if (key === 'manualUsername' && typeof value === 'string') {
    setFeatureFlag('manualUsername', value.trim());
    invalidateOwnerIdentityCache();
    void safeStorageSet({ kf_flag_manualUsername: value.trim() });
    refreshMessageHighlights();
    reconcileActiveNativeChat();
  }
}

export function getPopupFeatureFlags(): Omit<FeatureFlags, 'modLogPanel'> {
  return {
    chatMode: featureFlags.chatMode,
    showDeletedMessages: featureFlags.showDeletedMessages,
    preserveBansInline: featureFlags.preserveBansInline,
    debugLogging: featureFlags.debugLogging,
    showSubscriptions: featureFlags.showSubscriptions,
    showGiftedSubs: featureFlags.showGiftedSubs,
    showKicks: featureFlags.showKicks,
    showPolls: featureFlags.showPolls,
    showHostRaid: featureFlags.showHostRaid,
    showModeChanges: featureFlags.showModeChanges,
    showChattersBadges: featureFlags.showChattersBadges,
    showUserMessages: featureFlags.showUserMessages,
    showModActions: featureFlags.showModActions,
    autoTheater: featureFlags.autoTheater,
    captionGuard: featureFlags.captionGuard,
    rewindControls: featureFlags.rewindControls,
    liveCatchup: featureFlags.liveCatchup,
    qualityLock: featureFlags.qualityLock,
    screenshot: featureFlags.screenshot,
    speedControls: featureFlags.speedControls,
    autoClaimDrops: featureFlags.autoClaimDrops,
    mentionHighlightEnabled: featureFlags.mentionHighlightEnabled,
    mentionHighlightStyle: featureFlags.mentionHighlightStyle,
    mentionHighlightColor: featureFlags.mentionHighlightColor,
    roleHighlightStyle: featureFlags.roleHighlightStyle,
    modFrameEnabled: featureFlags.modFrameEnabled,
    modFrameColor: featureFlags.modFrameColor,
    vipFrameEnabled: featureFlags.vipFrameEnabled,
    vipFrameColor: featureFlags.vipFrameColor,
    manualUsername: featureFlags.manualUsername,
  };
}

/** Counts logical messages rather than DOM copies. The same preserved id can appear in the own/
 * native list, an inline ghost, and the always-mounted removed panel at the same time. */
export function countUniqueStatusMessages(selector: string): number {
  const ids = new Set<string>();
  let anonymous = 0;
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const id = element.dataset.messageId
      ?? element.dataset.kickflowMid
      ?? element.dataset.kickflowGhostMid
      ?? element.dataset.kickflowRemovedMid;
    if (id) ids.add(id);
    else anonymous++;
  });
  return ids.size + anonymous;
}

/** Single live counter snapshot consumed by both settings surfaces. Keeping this provider
 * read-only and on demand avoids a second counter definition drifting from the popup bridge. */
export function getLiveStatusSnapshot(): KickFlowStatusSnapshot {
  const ownList = document.getElementById(OWN_LIST_ID);
  return {
    ...getStatus(),
    messageCount: ownList
      ? ownList.querySelectorAll('.kickflow-message').length
      : document.querySelectorAll('#chatroom-messages [data-index]').length,
    preservedCount: countUniqueStatusMessages('.kickflow-preserved'),
    bannedCount: countUniqueStatusMessages('.kickflow-banned'),
    deletedCount: countUniqueStatusMessages('.kickflow-deleted'),
    ...getActiveNativeChatGhostStats(),
  };
}

/** Popup ↔ content-script bridge: report status + apply flag toggles. activeTab grants the
 * popup access on open. Flags persist to chrome.storage.local so a toggle survives a reload. */
function installStatusBridge(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'kickflow:getStatus') {
      sendResponse({
        ...getLiveStatusSnapshot(),
        flags: getPopupFeatureFlags(),
        hotkeys: getHotkeyBindings(),
      });
      return;
    }
    if (
      msg.type === 'kickflow:setHotkey' &&
      HOTKEY_ACTIONS.includes(msg.action as HotkeyAction) &&
      msg.patch && typeof msg.patch === 'object'
    ) {
      const patch: Partial<HotkeyBinding> = {};
      if (typeof msg.patch.enabled === 'boolean') patch.enabled = msg.patch.enabled;
      if (typeof msg.patch.key === 'string') patch.key = msg.patch.key;
      sendResponse(updateHotkeyBinding(msg.action as HotkeyAction, patch));
      return;
    }
    if (msg.type === 'kickflow:resetHotkeys') {
      sendResponse({ ok: true, bindings: resetHotkeyBindings() });
      return;
    }
    if (
      msg.type === 'kickflow:setFlag' &&
      isBooleanFlagKey(msg.key) &&
      typeof msg.value === 'boolean'
    ) {
      applyFlagChange(msg.key, msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (
      msg.type === 'kickflow:setFlag' &&
      msg.key === 'chatMode' &&
      (msg.value === 'native' || msg.value === 'own')
    ) {
      applyFlagChange(msg.key, msg.value);
      sendResponse({ ok: true });
      return;
    }
  });

  // In-panel gear (removed-panel.ts) dispatches this instead of a chrome.runtime message — same
  // applyFlagChange mutator, so featureFlags stays the one source of truth either way. Registered
  // once here (installStatusBridge runs once from main()), never per-session.
  window.addEventListener('kickflow:setFlag', onWindowFlagChange);
}

/** Load flag overrides the user set via the popup, applied before the first session starts so
 * they take effect immediately (not just after the next toggle). */
export async function applySavedFlags(): Promise<void> {
  const saved = await safeStorageGet([
    'kf_flag_chatMode',
    'kf_flag_showDeletedMessages',
    'kf_flag_preserveBansInline',
    'kf_flag_debugLogging',
    'kf_flag_showSubscriptions',
    'kf_flag_showGiftedSubs',
    'kf_flag_showKicks',
    'kf_flag_showPolls',
    'kf_flag_showHostRaid',
    'kf_flag_showModeChanges',
    'kf_flag_showChattersBadges',
    'kf_flag_showUserMessages',
    'kf_flag_showModActions',
    'kf_flag_autoTheater',
    'kf_flag_captionGuard',
    'kf_flag_rewindControls',
    'kf_flag_liveCatchup',
    'kf_flag_qualityLock',
    'kf_flag_screenshot',
    'kf_flag_speedControls',
    'kf_flag_autoClaimDrops',
    'kf_flag_mentionHighlightEnabled',
    'kf_flag_mentionHighlightStyle',
    'kf_flag_mentionHighlightColor',
    'kf_flag_roleHighlightStyle',
    'kf_flag_modFrameEnabled',
    'kf_flag_modFrameColor',
    'kf_flag_vipFrameEnabled',
    'kf_flag_vipFrameColor',
    'kf_flag_manualUsername',
  ]);
  if (saved.kf_flag_chatMode === 'native' || saved.kf_flag_chatMode === 'own') setFeatureFlag('chatMode', saved.kf_flag_chatMode);
  if (typeof saved.kf_flag_showDeletedMessages === 'boolean') setFeatureFlag('showDeletedMessages', saved.kf_flag_showDeletedMessages);
  if (typeof saved.kf_flag_preserveBansInline === 'boolean') setFeatureFlag('preserveBansInline', saved.kf_flag_preserveBansInline);
  if (typeof saved.kf_flag_debugLogging === 'boolean') setFeatureFlag('debugLogging', saved.kf_flag_debugLogging);
  if (typeof saved.kf_flag_showSubscriptions === 'boolean') setFeatureFlag('showSubscriptions', saved.kf_flag_showSubscriptions);
  if (typeof saved.kf_flag_showGiftedSubs === 'boolean') setFeatureFlag('showGiftedSubs', saved.kf_flag_showGiftedSubs);
  if (typeof saved.kf_flag_showKicks === 'boolean') setFeatureFlag('showKicks', saved.kf_flag_showKicks);
  if (typeof saved.kf_flag_showPolls === 'boolean') setFeatureFlag('showPolls', saved.kf_flag_showPolls);
  if (typeof saved.kf_flag_showHostRaid === 'boolean') setFeatureFlag('showHostRaid', saved.kf_flag_showHostRaid);
  if (typeof saved.kf_flag_showModeChanges === 'boolean') setFeatureFlag('showModeChanges', saved.kf_flag_showModeChanges);
  if (typeof saved.kf_flag_showChattersBadges === 'boolean') setFeatureFlag('showChattersBadges', saved.kf_flag_showChattersBadges);
  if (typeof saved.kf_flag_showUserMessages === 'boolean') setFeatureFlag('showUserMessages', saved.kf_flag_showUserMessages);
  if (typeof saved.kf_flag_showModActions === 'boolean') setFeatureFlag('showModActions', saved.kf_flag_showModActions);
  if (typeof saved.kf_flag_autoTheater === 'boolean') setFeatureFlag('autoTheater', saved.kf_flag_autoTheater);
  if (typeof saved.kf_flag_captionGuard === 'boolean') setFeatureFlag('captionGuard', saved.kf_flag_captionGuard);
  if (typeof saved.kf_flag_rewindControls === 'boolean') setFeatureFlag('rewindControls', saved.kf_flag_rewindControls);
  if (typeof saved.kf_flag_liveCatchup === 'boolean') setFeatureFlag('liveCatchup', saved.kf_flag_liveCatchup);
  if (typeof saved.kf_flag_qualityLock === 'boolean') setFeatureFlag('qualityLock', saved.kf_flag_qualityLock);
  if (typeof saved.kf_flag_screenshot === 'boolean') setFeatureFlag('screenshot', saved.kf_flag_screenshot);
  if (typeof saved.kf_flag_speedControls === 'boolean') setFeatureFlag('speedControls', saved.kf_flag_speedControls);
  if (typeof saved.kf_flag_autoClaimDrops === 'boolean') setFeatureFlag('autoClaimDrops', saved.kf_flag_autoClaimDrops);
  if (typeof saved.kf_flag_mentionHighlightEnabled === 'boolean') setFeatureFlag('mentionHighlightEnabled', saved.kf_flag_mentionHighlightEnabled);
  if (
    saved.kf_flag_mentionHighlightStyle === 'frame'
    || saved.kf_flag_mentionHighlightStyle === 'fill'
    || saved.kf_flag_mentionHighlightStyle === 'both'
  ) {
    setFeatureFlag('mentionHighlightStyle', saved.kf_flag_mentionHighlightStyle);
  }
  if (typeof saved.kf_flag_mentionHighlightColor === 'string') {
    setFeatureFlag('mentionHighlightColor', sanitizeHighlightColor(saved.kf_flag_mentionHighlightColor));
  }
  if (saved.kf_flag_roleHighlightStyle === 'frame' || saved.kf_flag_roleHighlightStyle === 'both') {
    setFeatureFlag('roleHighlightStyle', saved.kf_flag_roleHighlightStyle);
  }
  if (typeof saved.kf_flag_modFrameEnabled === 'boolean') setFeatureFlag('modFrameEnabled', saved.kf_flag_modFrameEnabled);
  if (typeof saved.kf_flag_modFrameColor === 'string') {
    setFeatureFlag('modFrameColor', sanitizeHighlightColor(saved.kf_flag_modFrameColor));
  }
  if (typeof saved.kf_flag_vipFrameEnabled === 'boolean') setFeatureFlag('vipFrameEnabled', saved.kf_flag_vipFrameEnabled);
  if (typeof saved.kf_flag_vipFrameColor === 'string') {
    setFeatureFlag('vipFrameColor', sanitizeHighlightColor(saved.kf_flag_vipFrameColor));
  }
  if (typeof saved.kf_flag_manualUsername === 'string') setFeatureFlag('manualUsername', saved.kf_flag_manualUsername.trim());
}

function installNavigationHooks(): void {
  let lastHref = window.location.href;
  navPollId = window.setInterval(() => {
    if (!isExtensionContextValid()) {
      teardownZombie();
      return;
    }
    const href = window.location.href;
    if (href === lastHref) return;
    lastHref = href;
    window.dispatchEvent(new Event('kickflow:locationchange'));
  }, NAVIGATION_POLL_INTERVAL_MS);
  window.addEventListener('popstate', onPopstate);
  window.addEventListener('kickflow:locationchange', handlePotentialNavigation);
}

async function main(): Promise<void> {
  await Promise.all([applySavedFlags(), loadHotkeyBindings(), loadLang()]);
  setDebugLogging(featureFlags.debugLogging);
  initSiteLifecycle();
  syncLayoutWatchdog();
  installStatusBridge();
  installNavigationHooks();
  handlePotentialNavigation();
}

void main();
