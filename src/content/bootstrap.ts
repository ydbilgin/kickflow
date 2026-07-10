import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { SELECTORS, getVideoElement } from './shared/selectors';
import { whenElementPresent } from './shared/dom-observers';
import { isExtensionContextValid, safeStorageGet, safeStorageSet } from './shared/extension-context';
import { featureFlags, setFeatureFlag } from './chat/feature-flags';
import { getStatus, setStatus, resetStatus } from './status';
import {
  ActivePinnedMessageState,
  ChatDomRegistry,
  ChatIntegrityStore,
  type ChatMessage,
  type ChatroomModeKey,
  type PinnedMessage,
  type SubscriberBadge,
} from './chat/message-store';
import { handleUserBanned, handleMessageDeleted } from './chat/ban-guard';
import {
  PusherClient,
  type ChatroomUpdatedEventPayload,
  type ChannelSubscriptionEventPayload,
  type HostEventPayload,
  type SubscriptionEventPayload,
} from './chat/pusher-client';
import { NativeChatAugmenter, getActiveNativeChatGhostStats, reconcileActiveNativeChat } from './chat/native-augment';
import { RemovedMessagesPanel } from './chat/removed-panel';
import { FooterToggleButton } from './chat/footer-toggle';
import { RenderQueue } from './chat/render-queue';
import { ScrollFollowController, trimMessageWindow, decideScrollFollow } from './chat/dom-window';
import { ChatHistoryBackfill } from './chat/history';
import { ChatOverlayMount } from './chat/overlay-mount';
import { configureUserCardSession } from './chat/user-card';
import { buildPinnedMessageElement, setSubscriberBadges } from './chat/message-view';
import { initQualityLock } from './player/quality-lock';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';
import { initRewindControls } from './player/rewind-controls';
import { initSpeedControls } from './player/speed-controls';
import { initScreenshot } from './player/screenshot';

const STYLE_ID = 'kickflow-styles';
const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const PINNED_MESSAGE_HOST_ID = 'kickflow-pinned-message-host';
const OWN_LIST_ID = 'kickflow-message-list';
const PRESERVED_SWEEP_INTERVAL_MS = 60_000;
const NAVIGATION_POLL_INTERVAL_MS = 400;

const BOOLEAN_FLAG_KEYS = [
  'showDeletedMessages',
  'preserveBansInline',
  'debugLogging',
  'showSubscriptions',
  'showGiftedSubs',
  'showHostRaid',
  'showPinnedMessage',
  'showModeChanges',
] as const;

type BooleanFlagKey = (typeof BOOLEAN_FLAG_KEYS)[number];

function isBooleanFlagKey(key: string): key is BooleanFlagKey {
  return (BOOLEAN_FLAG_KEYS as readonly string[]).includes(key);
}

interface SystemEventCallbacks {
  onSubscription: (payload: SubscriptionEventPayload) => void;
  onChannelSubscription: (payload: ChannelSubscriptionEventPayload) => void;
  onHost: (payload: HostEventPayload) => void;
  onChatroomUpdated: (payload: ChatroomUpdatedEventPayload) => void;
}

/** Builds Mode A's system-event callbacks. Display toggles gate ingestion, so turning one off
 * only drops future events; rows already rendered remain until the normal message-window trim. */
export function createSystemEventCallbacks(
  enqueueOnce: (message: ChatMessage) => void,
  chatroomId: number,
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
      if (!featureFlags.showSubscriptions) return;
      const sequence = ++systemEventSequence;
      enqueueOnce(createSystemEventMessage(
        `sub:${payload.chatroomId}:${encodeURIComponent(payload.username)}:${payload.months}:${sequence}`,
        payload.chatroomId,
        { kind: 'subscription', username: payload.username, months: payload.months },
      ));
    },
    onChannelSubscription: (payload) => {
      if (!featureFlags.showGiftedSubs) return;
      const sequence = ++systemEventSequence;
      enqueueOnce(createSystemEventMessage(
        `gift:${payload.channelId}:${encodeURIComponent(payload.username)}:${payload.giftCount}:${sequence}`,
        chatroomId,
        { kind: 'gifted-subscription', username: payload.username, giftCount: payload.giftCount },
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
            ? `Yavaş mod açıldı (${payload.slowMode.messageInterval}sn)`
            : 'Yavaş mod kapandı',
        });
      }
      if (
        previous.followersMode.enabled !== payload.followersMode.enabled ||
        (payload.followersMode.enabled && previous.followersMode.minDuration !== payload.followersMode.minDuration)
      ) {
        const duration = payload.followersMode.minDuration > 0 ? ` (${payload.followersMode.minDuration}dk)` : '';
        changes.push({
          mode: 'followers_mode',
          text: payload.followersMode.enabled
            ? `Sadece takipçi modu açıldı${duration}`
            : 'Sadece takipçi modu kapandı',
        });
      }
      if (previous.subscribersMode.enabled !== payload.subscribersMode.enabled) {
        changes.push({
          mode: 'subscribers_mode',
          text: payload.subscribersMode.enabled ? 'Sadece abone modu açıldı' : 'Sadece abone modu kapandı',
        });
      }
      if (previous.emotesMode.enabled !== payload.emotesMode.enabled) {
        changes.push({
          mode: 'emotes_mode',
          text: payload.emotesMode.enabled ? 'Sadece emote modu açıldı' : 'Sadece emote modu kapandı',
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
  };
}

export interface PinnedMessageController {
  onPinnedMessage: (pin: PinnedMessage) => void;
  refresh: () => void;
}

/** Own-mode pin controller: Pusher ingestion is flag-gated, while refresh lets a live global
 * toggle hide/show the current non-dismissed pin without changing its per-id dismiss state. */
export function createPinnedMessageController(
  host: HTMLElement,
  onShow: () => void = () => undefined,
): PinnedMessageController {
  const state = new ActivePinnedMessageState();
  const refresh = (): void => {
    const pin = featureFlags.showPinnedMessage ? state.getVisible() : null;
    if (!pin) {
      host.replaceChildren();
      host.style.display = 'none';
      return;
    }
    const element = buildPinnedMessageElement(
      pin,
      state.isCollapsed(),
      (pinId) => {
        if (!state.dismiss(pinId)) return;
        refresh();
      },
      () => {
        state.toggleCollapsed();
        refresh();
      },
    );
    host.replaceChildren(element);
    host.style.display = '';
    onShow();
  };

  return {
    onPinnedMessage: (pin) => {
      if (!featureFlags.showPinnedMessage || !state.setActive(pin)) return;
      refresh();
    },
    refresh,
  };
}

let refreshActivePinnedMessage: (() => void) | null = null;

const NON_CHANNEL_SLUGS = new Set([
  'video',
  'videos',
  'categories',
  'category',
  'browse',
  'search',
  'subscription',
  'subscriptions',
  'wallet',
  'dashboard',
  'settings',
  'following',
  'clips',
  'messages',
  'notifications',
  'shop',
]);

function getChannelSlugFromLocation(): string | null {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const [first] = segments;
  if (NON_CHANNEL_SLUGS.has(first.toLowerCase())) return null;
  return first;
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

async function resolveChannel(slug: string): Promise<ResolvedChannel | null> {
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
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
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
    #${PINNED_MESSAGE_HOST_ID} { flex: none; padding: 6px 10px 0; box-sizing: border-box; }
    #${OWN_LIST_ID} {
      flex: 1 1 auto; min-height: 0; padding: 6px 10px; overflow-y: auto; height: auto; box-sizing: border-box;
      font-size: 13px; line-height: 1.45; color: #efeff1;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    .kickflow-pinned-message {
      overflow: hidden; border: 1px solid rgba(255,176,32,0.55); border-radius: 7px;
      background: rgba(24,24,27,0.97); color: #efeff1;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35); font-size: 13px; line-height: 1.4;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    .kickflow-pinned-message__header {
      display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 3px 5px 3px 8px;
      background: rgba(255,176,32,0.12); color: #ffd27a;
    }
    .kickflow-pinned-message__title { font-weight: 800; }
    .kickflow-pinned-message__actor { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c8c8cf; font-size: 11px; }
    .kickflow-pinned-message--collapsed {
      min-height: 26px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
      background: rgba(255,176,32,0.12); color: #ffd27a; cursor: pointer;
    }
    .kickflow-pinned-message__collapse,
    .kickflow-pinned-message__dismiss {
      flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px;
      background: transparent; color: #c8c8cf; font: 700 18px/24px system-ui, sans-serif; cursor: pointer;
    }
    .kickflow-pinned-message__collapse { margin-left: auto; }
    .kickflow-pinned-message__collapse:hover,
    .kickflow-pinned-message__dismiss:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .kickflow-pinned-message__body { padding: 7px 9px 8px; word-break: break-word; overflow-wrap: anywhere; }
    .kickflow-pinned-message__badges:empty { display: none; }
    .kickflow-pinned-message__badges { margin-right: 3px; display: inline-flex; align-items: center; vertical-align: middle; }
    .kickflow-pinned-message__username { font-weight: 700; }
    .kickflow-pinned-message__username--link { cursor: pointer; }
    .kickflow-pinned-message__username--link:hover { text-decoration: underline; }
    .kickflow-pinned-message__separator { color: #adadb8; }
    .kickflow-pinned-message__content { color: #efeff1; }
    #${OWN_LIST_ID} .kickflow-message {
      display: block; padding: 3px 5px; border-radius: 4px;
      word-break: break-word; overflow-wrap: anywhere;
    }
    #${OWN_LIST_ID} .kickflow-message:hover { background: rgba(255,255,255,0.06); }
    #${OWN_LIST_ID} .kickflow-message__time { color: #adadb8; font-size: 11px; margin-right: 5px; }
    #${OWN_LIST_ID} .kickflow-message__badges:empty { display: none; }
    #${OWN_LIST_ID} .kickflow-message__badges {
      margin-right: 3px; display: inline-flex; align-items: center; vertical-align: middle;
    }
    #${OWN_LIST_ID} .kickflow-message__username {
      font-weight: 700; color: inherit; text-decoration: none;
    }
    #${OWN_LIST_ID} .kickflow-message__username--link { cursor: pointer; }
    #${OWN_LIST_ID} .kickflow-message__username--link:hover { text-decoration: underline; }
    #${OWN_LIST_ID} .kickflow-message__separator { color: #adadb8; }
    #${OWN_LIST_ID} .kickflow-message__content { color: #efeff1; }
    #${OWN_LIST_ID} .kickflow-event-row {
      display: flex; align-items: baseline; gap: 0; margin: 2px 0;
      border-left: 2px solid rgba(83,252,24,0.7);
      background: rgba(83,252,24,0.07); color: #d8f7ce;
    }
    #${OWN_LIST_ID} .kickflow-event-row--gifted-subscription {
      border-left-color: rgba(255,176,32,0.8);
      background: rgba(255,176,32,0.08); color: #ffe0a3;
    }
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
    #${OWN_LIST_ID} .kickflow-event-row__count { font-weight: 700; color: inherit; }
    #${OWN_LIST_ID} .kickflow-message__reply-context {
      display: flex; align-items: center; width: 100%; min-width: 0; margin-bottom: 4px;
      color: rgba(255,255,255,0.42); font-size: 11px; font-weight: 500;
      white-space: nowrap; overflow: hidden;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-icon {
      display: inline-block; flex: none; width: 13px; margin-right: 4px; font-size: 11px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-text {
      display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator,
    #${OWN_LIST_ID} .kickflow-message__reply-label {
      flex: none;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-user {
      flex: 0 1 auto; min-width: 0; max-width: 38%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator { white-space: pre; }
    #${OWN_LIST_ID} .kickflow-message__reply-snippet {
      display: inline-block; min-width: 0; flex: 1 1 auto;
      overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-user { font-weight: 700; color: rgba(255,255,255,0.58); }
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
      position: fixed; z-index: 2147483647; width: 276px; padding: 10px;
      border: 1px solid rgba(255,255,255,0.16); border-radius: 8px;
      background: rgba(18,20,24,0.98); color: #efeff1;
      box-shadow: 0 12px 34px rgba(0,0,0,0.44);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif; font-size: 12px;
    }
    .kickflow-user-card__header { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; padding-right: 20px; cursor: move; user-select: none; }
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
      color: #c7c7d1; font-size: 11px; line-height: 1.4; margin: 0 0 8px;
      max-height: 56px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    }
    .kickflow-user-card__field {
      display: flex; justify-content: space-between; gap: 10px; padding: 3px 0;
      border-top: 1px solid rgba(255,255,255,0.07);
    }
    .kickflow-user-card__key { color: #adadb8; }
    .kickflow-user-card__value { color: #fff; text-align: right; }
    .kickflow-user-card__badges { padding-top: 7px; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
    .kickflow-user-card__link {
      display: inline-block; margin-top: 8px; color: #66bfff; text-decoration: underline;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .kickflow-badge-icon {
      display: inline-block !important; height: 18px !important; width: auto !important;
      vertical-align: -4px; margin-right: 3px;
    }
    .kickflow-badge-text { font-size: 10px; font-weight: 700; margin-right: 4px; opacity: 0.75; }
    .kickflow-badge-role {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; padding: 0 3px; margin-right: 3px;
      border-radius: 4px; color: #fff; font-size: 9px; font-weight: 800; line-height: 1;
      vertical-align: -4px; gap: 1px;
    }
    .kickflow-badge-role__count { font-size: 8px; font-weight: 700; }
    .kickflow-emote {
      display: inline-block !important; height: 24px !important; width: auto !important;
      vertical-align: middle; margin: 0 2px;
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
    .kickflow-ghost-row__badges { margin-right: 3px; display: inline-flex; align-items: center; vertical-align: middle; }
    .kickflow-ghost-row__username { font-weight: 700; }
    .kickflow-ghost-row__username--link { cursor: pointer; }
    .kickflow-ghost-row__username--link:hover { text-decoration: underline; }
    .kickflow-ghost-row__separator { font-weight: 700; }
    .kickflow-ghost-row__content { text-decoration: line-through; opacity: 0.7; }
    .kickflow-ghost-empty { color: #8b8b93; font-size: 11px; text-align: center; padding: 22px 10px; opacity: 0.9; }

    /* --- "Kaldırılanlar" panel: hidden by default, opened via the footer toggle button.
       Whole header drags; ⚙ settings + × close live at its right edge. --- */
    .kickflow-panel {
      position: fixed; right: 14px; bottom: 84px; z-index: 2147483000;
      width: 330px; max-height: 60vh; display: flex; flex-direction: column;
      border-radius: 12px; background: rgba(18,19,23,0.98);
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
      overflow: hidden;
    }
    .kickflow-panel__header {
      display: flex; align-items: center; gap: 8px; padding: 9px 11px;
      cursor: move; user-select: none;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .kickflow-panel__accent {
      width: 7px; height: 7px; border-radius: 50%; flex: none;
      background: #53fc18; box-shadow: 0 0 6px rgba(83,252,24,0.7);
    }
    .kickflow-panel__title { font-weight: 800; font-size: 12px; letter-spacing: 0.02em; }
    .kickflow-panel__count {
      background: rgba(233,17,60,0.9); color: #fff; border-radius: 999px;
      padding: 0 6px; font-size: 10px; font-weight: 800; line-height: 1.6;
    }
    .kickflow-panel__spacer { flex: 1; }
    .kickflow-panel__btn {
      appearance: none; width: 22px; height: 22px; padding: 0; margin: 0; border: 0;
      border-radius: 6px; background: transparent; color: #b5b5be; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; line-height: 1;
      transition: background .14s ease, color .14s ease;
    }
    .kickflow-panel__btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .kickflow-panel__close { font-size: 16px; }
    .kickflow-panel__body { flex: 1; overflow: auto; padding: 6px 10px 9px; }
    .kickflow-panel__settings {
      padding: 8px 11px; border-top: 1px solid rgba(255,255,255,0.07);
      display: flex; flex-direction: column; gap: 8px; font-size: 11px; color: #efeff1;
    }
    .kickflow-panel__settings label { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; }
    .kickflow-panel__settings select {
      background: #1c1c20; color: #efeff1; border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px; padding: 3px 6px; font-size: 11px;
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

function initNativeChatIntegrity(slug: string, lifecycle: Lifecycle): void {
  let augmenter: NativeChatAugmenter | null = null;
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message) => augmenter?.forgetGhost(message.id),
  });
  augmenter = new NativeChatAugmenter(lifecycle, store);
  const panel = new RemovedMessagesPanel(lifecycle, store);
  new FooterToggleButton(lifecycle, panel);
  lifecycle.setInterval(() => store.sweepExpiredPreserved(), PRESERVED_SWEEP_INTERVAL_MS);

  resolveChannel(slug).then((resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      setStatus({ reason: 'chatroom-id çözülemedi' });
      return;
    }
    setSubscriberBadges(resolved.subscriberBadges);
    const { chatroomId, channelId } = resolved;
    setStatus({ chatroomId, reason: 'Pusher bağlanıyor…' });
    const client = new PusherClient(chatroomId, channelId, {
      onConnected: () => {
        setStatus({ pusherConnected: true, active: true, reason: 'aktif — native chat işaretleniyor' });
      },
      onDisconnected: () => {
        setStatus({ pusherConnected: false });
      },
      onMessage: (message) => {
        store.addMessage(message);
      },
      onUserBanned: (payload) => {
        setStatus({ lastBanAt: Date.now() });
        handleUserBanned(payload, { store, augmenter });
      },
      onMessageDeleted: (payload) => {
        handleMessageDeleted(payload, { store, augmenter });
      },
    });
    lifecycle.add(() => {
      client.dispose();
      setStatus({ pusherConnected: false });
    });
    client.connect();
  });
}

function initOwnChatIntegrity(slug: string, lifecycle: Lifecycle): void {
  configureUserCardSession(slug);
  lifecycle.add(() => configureUserCardSession(null));

  const registry = new ChatDomRegistry();
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message: ChatMessage) => {
      const element = registry.getElementForMessageId(message.id);
      if (!element) return;
      registry.forget(element);
      element.remove();
    },
  });
  const panel = new RemovedMessagesPanel(lifecycle, store);
  new FooterToggleButton(lifecycle, panel);

  const mount = new ChatOverlayMount(lifecycle);
  let activated = false;
  const pinnedMessageController = createPinnedMessageController(mount.pinnedMessageHost, () => {
    if (activated) return;
    activated = true;
    mount.activate();
    setStatus({ active: true, reason: 'aktif — sabitlenmiş mesaj gösteriliyor' });
  });
  refreshActivePinnedMessage = pinnedMessageController.refresh;
  lifecycle.add(() => {
    if (refreshActivePinnedMessage === pinnedMessageController.refresh) refreshActivePinnedMessage = null;
  });
  const ownList = mount.ownList;

  const scrollPill = document.createElement('button');
  scrollPill.type = 'button';
  scrollPill.className = 'kickflow-scroll-pill';
  scrollPill.textContent = '↓ Yeni mesajlar';
  scrollPill.style.display = 'none';
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

  const renderQueue = new RenderQueue({
    getContainer: () => ownList,
    registry,
    // A delete can arrive while its ChatMessageEvent is waiting in RenderQueue's 250ms batch.
    // Only render objects that this session's store still owns: this drops those removed-before-
    // flush rows and also prevents a replayed Pusher/history id from creating a duplicate row.
    shouldRender: (message) => store.getMessageById(message.id) === message,
    onFlush: (appended /*, wasAtBottom */) => {
      if (!activated && appended.length > 0) {
        activated = true;
        mount.activate();
        setStatus({ active: true, reason: 'aktif — kendi liste render ediliyor' });
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
  lifecycle.setInterval(() => store.sweepExpiredPreserved(), PRESERVED_SWEEP_INTERVAL_MS);

  const enqueueOnce = (message: ChatMessage): void => {
    if (store.addMessage(message)) renderQueue.enqueue(message);
  };

  resolveChannel(slug).then(async (resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      setStatus({ reason: 'chatroom-id çözülemedi — native chat' });
      return;
    }
    setSubscriberBadges(resolved.subscriberBadges);
    const { chatroomId, channelId } = resolved;
    setStatus({ chatroomId, reason: 'Pusher bağlanıyor…' });
    const historyBackfill = new ChatHistoryBackfill(channelId, {
      isDisposed: () => lifecycle.isDisposed,
      onMessages: (history) => {
        for (const message of history) {
          enqueueOnce(message);
        }
      },
    });
    const systemEventCallbacks = createSystemEventCallbacks(enqueueOnce, chatroomId);
    const client = new PusherClient(chatroomId, channelId, {
      onConnected: () => {
        setStatus({ pusherConnected: true });
        if (!getStatus().active) setStatus({ reason: 'Pusher bağlı — geçmiş yükleniyor…' });
        // Subscribe before history: messages emitted while the fetch retries are live-rendered,
        // then this backfill closes the initial/reconnect gap. Store id de-duping makes overlap
        // harmless, and ChatHistoryBackfill queues one fresh request for every reconnect.
        historyBackfill.request();
      },
      onDisconnected: () => {
        setStatus({ pusherConnected: false });
      },
      onMessage: (message) => {
        enqueueOnce(message);
      },
      onSubscription: systemEventCallbacks.onSubscription,
      onChannelSubscription: systemEventCallbacks.onChannelSubscription,
      onHost: systemEventCallbacks.onHost,
      onPinnedMessage: pinnedMessageController.onPinnedMessage,
      onChatroomUpdated: systemEventCallbacks.onChatroomUpdated,
      onUserBanned: (payload) => {
        setStatus({ lastBanAt: Date.now() });
        handleUserBanned(payload, { store, registry });
      },
      onMessageDeleted: (payload) => {
        handleMessageDeleted(payload, { store, registry });
      },
    });
    lifecycle.add(() => {
      client.dispose();
      setStatus({ pusherConnected: false });
    });
    client.connect();
  });
}

function initChatIntegrity(slug: string, lifecycle: Lifecycle): void {
  if (featureFlags.chatMode === 'own') {
    initOwnChatIntegrity(slug, lifecycle);
  } else {
    initNativeChatIntegrity(slug, lifecycle);
  }
}

/** Fully independent of chat readiness — gated only on the video element, not on
 * #chatroom-messages (which can legitimately take a while, or never resolve). */
function initPlayerQolSession(lifecycle: Lifecycle): void {
  if (!getVideoElement()) {
    logger.debug('bootstrap: #video-player not present yet, player QoL module waiting');
  }

  whenElementPresent<HTMLVideoElement>(
    SELECTORS.videoPlayer,
    lifecycle,
    () => {
      initQualityLock(lifecycle);
      initRewindHotkeys(lifecycle);
      // Mount order determines native-bar left-to-right order (see native-bar.ts): rewind
      // controls right after LIVE, then the catch-up indicator/toggle after that.
      initRewindControls(lifecycle);
      initLiveCatchup(lifecycle);
      initSpeedControls(lifecycle);
      initScreenshot(lifecycle);
    },
    { resolve: getVideoElement },
  );
}

let currentLifecycle: Lifecycle | null = null;
let currentSlug: string | null = null;
let sessionToken = 0;
let navPollId: number | null = null;

/** Named (not inline) so teardownZombie can removeEventListener it. */
function onPopstate(): void {
  window.dispatchEvent(new Event('kickflow:locationchange'));
}

function startSession(slug: string): void {
  const token = ++sessionToken;
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');
  configureUserCardSession(null);

  const lifecycle = new Lifecycle();
  currentLifecycle = lifecycle;

  ensureStyles();

  // Player QoL and chat integrity are started concurrently and never gate each other.
  initPlayerQolSession(lifecycle);

  if (!document.querySelector(SELECTORS.chatMessagesContainer)) {
    logger.debug('bootstrap:', SELECTORS.chatMessagesContainer, 'not present yet for', slug, '- chat integrity module waiting');
    setStatus({ reason: 'chat paneli bekleniyor…' }); // popup parity while we observe for a late panel
  }
  whenElementPresent(SELECTORS.chatMessagesContainer, lifecycle, () => {
    if (token !== sessionToken || lifecycle.isDisposed) return;
    // chatContainer is the gate that the chat panel exists; the native augmenter then
    // observes #chatroom-messages and survives Kick replacing the inner list.
    initChatIntegrity(slug, lifecycle);
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
  if (navPollId !== null) {
    window.clearInterval(navPollId);
    navPollId = null;
  }
  stopSession();
  configureUserCardSession(null);
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.querySelector('.kickflow-panel')?.remove();
  document.getElementById('kickflow-footer-toggle')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');
}

function handlePotentialNavigation(): void {
  if (!isExtensionContextValid()) {
    // Belt-and-suspenders: a queued popstate/locationchange can still fire this before
    // teardownZombie's removeEventListener above takes effect.
    teardownZombie();
    return;
  }

  const slug = getChannelSlugFromLocation();
  if (slug === currentSlug) return;

  logger.debug('bootstrap: channel changed', currentSlug, '->', slug);
  stopSession();
  currentSlug = slug;
  resetStatus(slug);
  if (slug) {
    void startSession(slug);
  }
}

/** Single mutator for feature flags — used by BOTH the popup (chrome message) and the in-panel
 * gear (window event), so featureFlags stays the one source of truth and side effects (reconcile
 * / session restart / persist) happen exactly once per change. */
export function applyFlagChange(key: string, value: boolean | string): void {
  if (isBooleanFlagKey(key) && typeof value === 'boolean') {
    setFeatureFlag(key, value);
    if (key === 'showDeletedMessages' || key === 'preserveBansInline') reconcileActiveNativeChat();
    if (key === 'debugLogging') setDebugLogging(value);
    if (key === 'showPinnedMessage') refreshActivePinnedMessage?.();
    void safeStorageSet({ ['kf_flag_' + key]: value });
  } else if (key === 'chatMode' && (value === 'native' || value === 'own')) {
    setFeatureFlag('chatMode', value);
    void safeStorageSet({ kf_flag_chatMode: value });
    if (currentSlug) {
      stopSession();
      resetStatus(currentSlug);
      void startSession(currentSlug);
    }
  }
}

export function getPopupFeatureFlags(): {
  chatMode: 'native' | 'own';
  showDeletedMessages: boolean;
  preserveBansInline: boolean;
  debugLogging: boolean;
  showSubscriptions: boolean;
  showGiftedSubs: boolean;
  showHostRaid: boolean;
  showPinnedMessage: boolean;
  showModeChanges: boolean;
} {
  return {
    chatMode: featureFlags.chatMode,
    showDeletedMessages: featureFlags.showDeletedMessages,
    preserveBansInline: featureFlags.preserveBansInline,
    debugLogging: featureFlags.debugLogging,
    showSubscriptions: featureFlags.showSubscriptions,
    showGiftedSubs: featureFlags.showGiftedSubs,
    showHostRaid: featureFlags.showHostRaid,
    showPinnedMessage: featureFlags.showPinnedMessage,
    showModeChanges: featureFlags.showModeChanges,
  };
}

/** Popup ↔ content-script bridge: report status + apply flag toggles. activeTab grants the
 * popup access on open. Flags persist to chrome.storage.local so a toggle survives a reload. */
function installStatusBridge(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'kickflow:getStatus') {
      const ownList = document.getElementById(OWN_LIST_ID);
      sendResponse({
        ...getStatus(),
        messageCount: ownList
          ? ownList.querySelectorAll('.kickflow-message').length
          : document.querySelectorAll('#chatroom-messages [data-index]').length,
        preservedCount: document.querySelectorAll('.kickflow-preserved').length,
        bannedCount: document.querySelectorAll('.kickflow-banned').length,
        deletedCount: document.querySelectorAll('.kickflow-deleted').length,
        ...getActiveNativeChatGhostStats(),
        flags: getPopupFeatureFlags(),
      });
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
  window.addEventListener('kickflow:setFlag', (event) => {
    const detail = (event as CustomEvent<{ key: string; value: boolean | string }>).detail;
    if (detail && typeof detail.key === 'string') applyFlagChange(detail.key, detail.value);
  });
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
    'kf_flag_showHostRaid',
    'kf_flag_showPinnedMessage',
    'kf_flag_showModeChanges',
  ]);
  if (saved.kf_flag_chatMode === 'native' || saved.kf_flag_chatMode === 'own') setFeatureFlag('chatMode', saved.kf_flag_chatMode);
  if (typeof saved.kf_flag_showDeletedMessages === 'boolean') setFeatureFlag('showDeletedMessages', saved.kf_flag_showDeletedMessages);
  if (typeof saved.kf_flag_preserveBansInline === 'boolean') setFeatureFlag('preserveBansInline', saved.kf_flag_preserveBansInline);
  if (typeof saved.kf_flag_debugLogging === 'boolean') setFeatureFlag('debugLogging', saved.kf_flag_debugLogging);
  if (typeof saved.kf_flag_showSubscriptions === 'boolean') setFeatureFlag('showSubscriptions', saved.kf_flag_showSubscriptions);
  if (typeof saved.kf_flag_showGiftedSubs === 'boolean') setFeatureFlag('showGiftedSubs', saved.kf_flag_showGiftedSubs);
  if (typeof saved.kf_flag_showHostRaid === 'boolean') setFeatureFlag('showHostRaid', saved.kf_flag_showHostRaid);
  if (typeof saved.kf_flag_showPinnedMessage === 'boolean') setFeatureFlag('showPinnedMessage', saved.kf_flag_showPinnedMessage);
  if (typeof saved.kf_flag_showModeChanges === 'boolean') setFeatureFlag('showModeChanges', saved.kf_flag_showModeChanges);
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
  await applySavedFlags();
  setDebugLogging(featureFlags.debugLogging);
  installStatusBridge();
  installNavigationHooks();
  handlePotentialNavigation();
}

void main();
