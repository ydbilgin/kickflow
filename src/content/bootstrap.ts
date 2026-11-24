import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { LayoutWatchdog } from './shared/layout-watchdog';
import { initChannelAvatarPreview } from './shared/avatar-preview';
import { startChatWithRetries, type ChatStartupAttempt } from './chat/startup-retry';
import { BADGE_STYLES } from './chat/badge-presentation';
import { SELECTORS, getVideoElement } from './shared/selectors';
import { whenElementPresent } from './shared/dom-observers';
import { isExtensionContextValid, safeStorageGet, safeStorageRemove, safeStorageSet } from './shared/extension-context';
import { formatNumber, loadLang, t } from './shared/i18n';
import { featureFlags, setFeatureFlag, type FeatureFlags } from './chat/feature-flags';
import { NativeQuickEmoteBar } from './chat/native-quick-emotes';
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
import { initAutoClaimDailyReward, syncAutoClaimDailyRewardFlag } from './daily-reward-auto-claim';
import { initCategoryLanguageChip } from './category-language-chip';
import { NativePausePillCounter } from './chat/native-pause-pill';
import { ModActionFeed, type ModAction, type ModActionNotice } from './chat/mod-action-feed';
import { FooterToggleButton } from './chat/footer-toggle';
import { NavbarSettingsButton } from './chat/navbar-settings';
import { RenderQueue } from './chat/render-queue';
import { requestNativeReply } from './chat/reply-action';
import { HoverReleaseMeter } from './chat/hover-meter';
import {
  attachScrollFollowHover,
  ScrollFollowController,
  trimMessageWindow,
  type ScrollFollowBehavior,
} from './chat/dom-window';
import { ChatHistoryBackfill, captureOutage, planBackfill, type OutageBoundary } from './chat/history';
import { ChatOverlayMount, scheduleChatStartup } from './chat/overlay-mount';
import { initControlsVisibility } from './player/controls-visibility';
import {
  parseChatSessionContext,
  type ChatSessionContext,
} from './chat/session-context';
import { VodChatReplayController } from './chat/vod-replay';
import { formatVodReplayTimestamp } from './chat/timestamp';
import { CARD_MAX_HEIGHT_INSET_PX, configureUserCardSession } from './chat/user-card';
import { configureUserMessageArchive } from './chat/archive-session';
import { UserMessageArchive } from './chat/user-message-archive';
import { USER_MESSAGE_TIME_COLUMN_PX } from './chat/user-message-list';
import { buildMessageElement, clearPreservedMarking, setSubscriberBadges } from './chat/message-view';
import { jumpToMessage } from './chat/message-jump';
import { installNativeThreadPanel, THREAD_PANEL_CSS } from './chat/native-thread';
import {
  refreshMessageHighlights,
  setHighlightStore,
  syncHighlightCssVars,
} from './chat/message-highlight-apply';
import { sanitizeHighlightColor, ROLE_BAR_ALPHA, ROLE_BAR_WIDTH_PX, ROLE_FILL_ALPHA } from './chat/message-highlight';
import { invalidateOwnerIdentityCache } from './chat/owner-identity';
import { initQualityLock, notifyQualityModeChanged } from './player/quality-lock';
import { DEFAULT_QUALITY_MODE, QUALITY_ATTRIBUTE, normalizeQualityMode } from './player/bar-shared.js';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';
import { initRewindControls } from './player/rewind-controls';
import { initSeekBar } from './player/seek-bar';
import { deactivateSpeedControls, initSpeedControls } from './player/speed-controls';
import { initScreenshot } from './player/screenshot';
import { initAutoTheater, syncAutoTheaterFlag } from './player/auto-theater';
import { initCaptionGuard } from './player/caption-guard';
import { initAmbientBands, initUltrawideFill, setAspectModeWriter, syncAspectMode } from './player/aspect-fill';
import { initChannelVolume, initLoudnessLeveller } from './player/audio-level';
import { handleBlockListsChange, initContentBlocking, syncContentBlocking } from './content-blocking';
import { initBarOrder, syncBarOrderFlag } from './player/bar-order';
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
  'chatSearchHotkey',
  'hideQuickEmoteBar',
  'showModActions',
  'autoTheater',
  'captionGuard',
  'rewindControls',
  'seekBar',
  'liveCatchup',
  'qualityLock',
  'qualityAlwaysBest',
  'screenshot',
  'speedControls',
  'fullscreenTerminal',
  'floatingStrip',
  'autoClaimDrops',
  'autoClaimDailyReward',
  'mentionHighlightEnabled',
  'modFrameEnabled',
  'vipFrameEnabled',
  'ultrawideFill',
  'ambientBands',
  'loudnessLeveler',
  'channelVolume',
  'contentBlocking',
  'liveNotify',
] as const;

type BooleanFlagKey = (typeof BOOLEAN_FLAG_KEYS)[number];

/** Every FeatureFlags key whose value is a string. The parser record below must name each one,
 * so a new string flag fails tsc until it has one parser. applyFlagChange and applySavedFlags
 * both read this record, so a saved value and a live change accept the same values. */
type StringFlagKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends string ? K : never;
}[keyof FeatureFlags];

const STRING_FLAG_PARSERS: { readonly [K in StringFlagKey]: (value: unknown) => FeatureFlags[K] | null } = {
  chatMode: (value) => (value === 'native' || value === 'own' ? value : null),
  hoverFollowMode: (value) => (value === 'browser-smooth' || value === 'instant' ? value : null),
  mentionHighlightStyle: (value) => (value === 'frame' || value === 'fill' || value === 'both' ? value : null),
  roleHighlightStyle: (value) => (value === 'frame' || value === 'both' ? value : null),
  mentionHighlightColor: (value) => (typeof value === 'string' ? sanitizeHighlightColor(value) : null),
  modFrameColor: (value) => (typeof value === 'string' ? sanitizeHighlightColor(value) : null),
  vipFrameColor: (value) => (typeof value === 'string' ? sanitizeHighlightColor(value) : null),
  manualUsername: (value) => (typeof value === 'string' ? value.trim() : null),
  qualityMode: (value) => normalizeQualityMode(value),
  aspectMode: (value) => (value === 'cover' || value === 'stretch' || value === 'contain' ? value : null),
};

const STRING_FLAG_KEYS = Object.keys(STRING_FLAG_PARSERS) as StringFlagKey[];

function parseStringFlag<K extends StringFlagKey>(key: K, value: unknown): FeatureFlags[K] | null {
  return (STRING_FLAG_PARSERS[key] as (value: unknown) => FeatureFlags[K] | null)(value);
}

const PLAYER_FEATURE_KEYS = [
  'captionGuard',
  'rewindControls',
  'seekBar',
  'liveCatchup',
  'qualityLock',
  'screenshot',
  'speedControls',
  'ultrawideFill',
  'ambientBands',
  'loudnessLeveler',
  'channelVolume',
] as const;

type PlayerFeatureFlagKey = (typeof PLAYER_FEATURE_KEYS)[number];

function isPlayerFeatureFlagKey(key: string): key is PlayerFeatureFlagKey {
  return (PLAYER_FEATURE_KEYS as readonly string[]).includes(key);
}

function isBooleanFlagKey(key: string): key is BooleanFlagKey {
  return (BOOLEAN_FLAG_KEYS as readonly string[]).includes(key);
}

function isStringFlagKey(key: string): key is StringFlagKey {
  return (STRING_FLAG_KEYS as readonly string[]).includes(key);
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

export async function resolveChannel(slug: string, lifecycle?: Lifecycle): Promise<ResolvedChannel | null> {
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
    if (lifecycle?.isDisposed) return null;
    const controller = new AbortController();
    lifecycle?.add(() => controller.abort());
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
        if (!Number.isSafeInteger(chatroomId) || chatroomId! <= 0) throw new Error('Channel chatroom not ready');
        const channelId =
          typeof json.id === 'number' ? json.id
          : typeof json.chatroom?.channel_id === 'number' ? json.chatroom.channel_id
          : chatroomId!;
        const subscriberBadges: SubscriberBadge[] = Array.isArray(json.subscriber_badges)
          ? json.subscriber_badges
              .map((b) => ({ months: Number(b?.months), src: typeof b?.badge_image?.src === 'string' ? b.badge_image.src : '' }))
              .filter((b) => Number.isFinite(b.months) && b.src)
              .sort((a, b) => a.months - b.months)
          : [];
        return { chatroomId: chatroomId!, channelId, subscriberBadges };
      }
      const transient = response.status === 403 || response.status === 429 || response.status >= 500;
      if (transient) {
        // 2026-10-20: a retried 429/5xx is not a fault yet; only exhaustion below warns (errors page noise).
        logger.debug('bootstrap: channel lookup failed for', slug, 'status', response.status, '(retrying)');
      } else {
        logger.info('bootstrap: channel lookup failed for', slug, 'status', response.status, '(terminal)');
        return null;
      }
    } catch (error) {
      logger.debug('bootstrap: channel lookup threw', error, '(retrying)');
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (attempt < CHATROOM_ID_MAX_ATTEMPTS - 1) {
      if (lifecycle?.isDisposed) return null;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, CHATROOM_ID_RETRY_BASE_MS * 2 ** attempt);
        lifecycle?.add(() => { window.clearTimeout(timer); resolve(); });
      });
    }
  }
  logger.warn('bootstrap: channel lookup exhausted retries for', slug, '- native chat stays visible');
  return null;
}

/** Id of the fallback `<style>` element, used only where constructable sheets are unavailable. */
const FALLBACK_STYLE_ID = 'kickflow-styles';

let stylesInstalled = false;
/** The adopted stylesheet, or null when the fallback element carries the CSS instead. */
let adoptedStyleSheet: CSSStyleSheet | null = null;

/** Adopts KickFlow's stylesheet WITHOUT putting a node in the document.
 *
 * A `<style>` element appended to Kick's server-rendered `<head>` is a DOM change inside the tree
 * React is still hydrating. Measured on the same VOD, one page load each: 1 × React #418 with the
 * extension loaded, 0 × without. A constructable stylesheet applies exactly the same CSS and adds
 * nothing for hydration to disagree with. Adopted sheets also come last in the cascade, so our
 * rules no longer depend on where in `<head>` the element happened to land. */
function ensureStyles(): void {
  if (stylesInstalled) return;
  // Images use `display: inline-block !important` + an explicit px height. Kick's page is built
  // with Tailwind, whose preflight reset applies `img { display: block; height: auto }` globally.
  const css = `
    /* ===== KickFlow interface, design "Margin" (2026-10-23 redesign). =====
       KickFlow writes in the margin of Kick's chat. One reading rule for every row: the LEFT EDGE
       (the gutter) says what happened, the text stays where it was.
         solid gutter  = who is speaking (mod, VIP) or that it is you (mention, reply to you)
         dashed gutter = moderation removed it (ban red, timeout amber, delete grey)
         stamp band    = one small line ABOVE a removed message: what, how long, by whom
       Colour has one meaning each: green = live / on / do this, amber = needs you (mention,
       behind live, timeout), red = ban, grey = deleted. Everything else is ink on Kick's black.
       Geometry rules (emote boxes, badge gap, the 12 px floor) are unchanged from 0.2.17. */
    :root {
      --kf-ink: #eef2ef; --kf-ink-2: #b4bdb7; --kf-ink-3: #879189; --kf-ink-4: #5d665f;
      --kf-ground: #0b0e0c; --kf-surface: #111512; --kf-surface-2: #171c18; --kf-surface-3: #1f2520;
      --kf-line: rgba(226,240,230,0.08); --kf-line-2: rgba(226,240,230,0.14); --kf-line-3: rgba(226,240,230,0.22);
      --kf-green: #53fc18; --kf-green-ink: #061402; --kf-green-text: #8cff63; --kf-green-soft: rgba(83,252,24,0.12);
      --kf-amber: #ffb547; --kf-amber-soft: rgba(255,181,71,0.10);
      --kf-red: #ff6b5e; --kf-red-soft: rgba(255,107,94,0.09);
      --kf-grey: #9aa39d; --kf-grey-soft: rgba(154,163,157,0.08);
      --kf-font: Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
      --kf-mono: 'Cascadia Mono', Consolas, ui-monospace, monospace;
      --kf-ease: cubic-bezier(.22,1,.36,1);
      /* Logo slot: the one place the KickFlow mark is drawn from (navbar button, panel wordmark).
         Holds the KickFlow mark of 2026-10-23 (a chat bubble with paired rewind triangles); to change
         the logo, replace this data URI and the PNGs in icons/. */
      --kf-mark: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%2316261D' d='M14 8H47L56 17V43H31L16 56V43H8V14Z'/%3E%3Cpath fill='%23ADF56A' d='M15 11H45.75L53 18.25V40H29.75L19 49.3V40H11V15Z'/%3E%3Cpath fill='%2316261D' d='M17 27L29 18V36ZM32 27L44 18V36Z'/%3E%3C/svg%3E");
    }
    #${OVERLAY_ROOT_ID} { display: flex; flex-direction: column; overflow: hidden; }
    #${OWN_LIST_ID} {
      flex: 1 1 auto; min-height: 0; padding: 6px 8px 6px 6px; overflow-y: auto; height: auto; box-sizing: border-box;
      font-size: max(12px, var(--chatroom-font-size, 13px)); line-height: 1.5; color: var(--kf-ink);
      font-family: var(--kf-font);
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #${OWN_LIST_ID} .kickflow-message {
      display: block; position: relative; padding: var(--chatroom-message-spacing, 3px) 6px var(--chatroom-message-spacing, 3px) 10px; border-radius: 4px;
      word-break: break-word; overflow-wrap: anywhere;
    }
    #${OWN_LIST_ID} .kickflow-message:not(.kickflow-event-row):hover { background: rgba(255,255,255,0.045); }
    #${OWN_LIST_ID} .kickflow-message:not(.kickflow-event-row):not(.kickflow-message--hl-fill):not(.kickflow-message--role-fill):hover:not([data-kickflow-pointer-row]):not(:has(:focus-visible)) {
      background: transparent;
    }
    #${OWN_LIST_ID} .kickflow-message:not(.kickflow-event-row):not(.kickflow-message--hl-fill):not(.kickflow-message--role-fill):is([data-kickflow-pointer-row], :has(:focus-visible)) {
      background: rgba(255,255,255,0.045);
    }
    #${OWN_LIST_ID} .kickflow-message__time {
      display: var(--chatroom-timestamps-display, inline); color: var(--kf-ink-3);
      font-size: max(12px, calc(var(--chatroom-font-size, 13px) - 2px)); font-weight: 600;
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
    .kickflow-event-row__identity--link:hover { text-decoration: underline; text-underline-offset: 2px; }
    #${OWN_LIST_ID} .kickflow-message__separator {
      display: inline-flex; color: inherit; font-weight: 700;
    }
    #${OWN_LIST_ID} .kickflow-message__content { color: var(--kf-ink); line-height: 1.55; }

    /* --- Gutter: one 3px mark at the row's left edge. Solid = who / you; dashed = removed. --- */
    #${OWN_LIST_ID} .kickflow-message::before {
      content: none; position: absolute; left: 2px; top: 4px; bottom: 4px; width: 3px; border-radius: 2px;
      pointer-events: none;
    }
    #${OWN_LIST_ID} .kickflow-message--can-reply { position: relative; min-height: 28px; padding-right: 30px; }
    #${OWN_LIST_ID} .kickflow-message__reply-action {
      position: absolute; right: 2px; top: 2px; width: 24px; height: 24px;
      border: 0; border-radius: 4px; background: #232a26; color: #efeff1;
      font: inherit; font-size: 18px; cursor: pointer; opacity: 0; pointer-events: none;
    }
    #${OWN_LIST_ID} .kickflow-message:is([data-kickflow-pointer-row], :focus-within) .kickflow-message__reply-action {
      opacity: 1; pointer-events: auto;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-action:focus-visible { outline: 2px solid #53fc18; }
    #${OWN_LIST_ID} .kickflow-message__reply-status { display: block; color: #facc83; font-size: 12px; }
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
    /* Mentions of you: "frame" = your colour in the gutter plus a hairline ring; "fill" = a wash. */
    #${OWN_LIST_ID} .kickflow-message--mention-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight),
    #${OWN_LIST_ID} .kickflow-message--reply-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight) {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kf-hl-outline) 30%, transparent);
    }
    #${OWN_LIST_ID} .kickflow-message.kickflow-message--mention-me::before,
    #${OWN_LIST_ID} .kickflow-message.kickflow-message--reply-me::before {
      content: ''; background: var(--kf-hl-outline);
    }
    /* A removed row speaks only through its dashed gutter. */
    #${OWN_LIST_ID} .kickflow-message.kickflow-preserved::before { content: none; }
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
      padding-left: 10px;
    }
    #${OWN_LIST_ID} .kickflow-message--role-mod::before,
    #${OWN_LIST_ID} .kickflow-message--role-vip::before {
      content: ''; position: absolute; left: 2px; top: 4px; bottom: 4px;
      width: ${ROLE_BAR_WIDTH_PX}px; background: var(--kf-mod-bar); border-radius: 0;
    }
    #${OWN_LIST_ID} .kickflow-message--role-mod.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-mod-fill);
    }
    #${OWN_LIST_ID} .kickflow-message--role-vip {
      padding-left: 10px;
    }
    #${OWN_LIST_ID} .kickflow-message--role-vip::before { background: var(--kf-vip-bar); }
    #${OWN_LIST_ID} .kickflow-message--role-vip.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-vip-fill);
    }
    #${OWN_LIST_ID} .kickflow-message--jump-highlight {
      background-color: var(--kf-green-soft);
      box-shadow: inset 0 0 0 1px rgba(83,252,24,0.70);
      animation: kickflow-jump-land .9s var(--kf-ease) both;
    }
    @keyframes kickflow-jump-land { from { background-color: rgba(83,252,24,0.26); } to { background-color: rgba(83,252,24,0.12); } }

    /* --- Reply: a thread spine from the quoted line down to the speaker, no box. --- */
    #${OWN_LIST_ID} .kickflow-message__reply-context {
      position: relative; display: flex; align-items: center; width: 100%; min-width: 0; margin-bottom: 1px;
      padding: 0 0 0 20px; color: var(--kf-ink-3); font-size: 12px; font-weight: 500; line-height: 1.5;
      white-space: nowrap; overflow: hidden;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context::before {
      content: ''; position: absolute; left: 6px; top: 50%; width: 10px; height: 100%;
      border: solid var(--kf-line-3); border-width: 1.5px 0 0 1.5px; border-top-left-radius: 6px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"] { cursor: pointer; }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"]:hover { color: var(--kf-ink-2); }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"]:hover::before { border-color: var(--kf-ink-3); }
    #${OWN_LIST_ID} .kickflow-message__reply-context[role="button"]:focus-visible { outline: 2px solid var(--kf-green); outline-offset: -2px; border-radius: 3px; }
    #${OWN_LIST_ID} .kickflow-message__reply-context--to-me { color: var(--kf-ink-2); }
    #${OWN_LIST_ID} .kickflow-message__reply-context--to-me::before { border-color: var(--kf-hl-outline); }
    #${OWN_LIST_ID} .kickflow-message__reply-me-mark {
      display: inline-block; margin-right: 4px; color: var(--kf-hl-outline); font-size: 12px;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-context--miss {
      animation: kickflow-reply-miss 0.5s ease;
    }
    @keyframes kickflow-reply-miss {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-3px); }
      40%, 80% { transform: translateX(3px); }
    }
    /* The spine replaces the arrow glyph; the glyph stays in the DOM for screen readers' text. */
    #${OWN_LIST_ID} .kickflow-message__reply-icon {
      position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%);
    }
    #${OWN_LIST_ID} .kickflow-message__reply-text {
      display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator { flex: none; }
    #${OWN_LIST_ID} .kickflow-message__reply-user {
      flex: 0 0 auto; flex-shrink: 0; white-space: nowrap;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-separator { white-space: pre; }
    #${OWN_LIST_ID} .kickflow-message__reply-snippet {
      display: inline-block; min-width: 0; flex: 1 1 auto;
      overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
    }
    #${OWN_LIST_ID} .kickflow-message__reply-user { font-weight: 650; opacity: 0.85; }
    /* The deliberate way into Kick's side conversation (T3): a small icon at the line's right end. */
    #${OWN_LIST_ID} .kickflow-message__thread-open {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; margin-left: auto; padding-left: 0; border-radius: 3px;
      color: var(--kf-ink-3); cursor: pointer;
    }
    #${OWN_LIST_ID} .kickflow-message__thread-open[hidden] { display: none; }
    #${OWN_LIST_ID} .kickflow-message__thread-open:hover { color: var(--kf-ink); background: rgba(255,255,255,0.08); }
    #${OWN_LIST_ID} .kickflow-message__thread-open:focus-visible { outline: 2px solid var(--kf-green); outline-offset: -2px; }
    #${OWN_LIST_ID} .kickflow-message__thread-open svg { width: 13px; height: 13px; }

    /* --- Removed messages: kept in place, struck once, with a stamp band above them. --- */
    #${OWN_LIST_ID} .kickflow-preserved { opacity: 1; }
    #${OWN_LIST_ID} .kickflow-preserved .kickflow-message__identity { display: inline; }
    .kickflow-preserved {
      --kf-cut: var(--kf-grey); --kf-cut-soft: var(--kf-grey-soft);
      position: relative; padding-top: 22px !important;
      background-image: linear-gradient(90deg, var(--kf-cut-soft), transparent 70%);
    }
    .kickflow-preserved.kickflow-banned { --kf-cut: var(--kf-red); --kf-cut-soft: var(--kf-red-soft); }
    .kickflow-preserved.kickflow-timeout { --kf-cut: var(--kf-amber); --kf-cut-soft: var(--kf-amber-soft); }
    .kickflow-preserved::after {
      content: ''; position: absolute; left: 2px; top: 4px; bottom: 4px; width: 3px; pointer-events: none;
      background: repeating-linear-gradient(180deg, var(--kf-cut) 0 4px, transparent 4px 7px);
    }
    #${OWN_LIST_ID} .kickflow-preserved .kickflow-message__content,
    .kickflow-original-content > span:last-child {
      color: var(--kf-ink-2); text-decoration: line-through; text-decoration-thickness: 1.5px;
      text-decoration-color: color-mix(in srgb, var(--kf-cut) 75%, transparent);
    }
    /* The stamp: what happened, how long, by whom. Text arrives upper-case from i18n; no
       text-transform here, because a lower-cased "TIMEOUT" on a Turkish page reads "tımeout". */
    .kickflow-status-label {
      position: absolute; left: 10px; top: 4px; display: inline-flex; align-items: center; gap: 0;
      height: 16px; margin: 0; padding: 0 5px; border-radius: 3px; box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--kf-cut, var(--kf-grey)) 55%, transparent);
      background: #141915; color: #aeb7b1;
      font: 700 12px/1 var(--kf-font); letter-spacing: .04em;
      text-decoration: none; text-transform: none; white-space: nowrap; vertical-align: baseline;
    }
    .kickflow-status-label--banned { --kf-cut: var(--kf-red); color: #ff8277; }
    .kickflow-status-label--timeout { --kf-cut: var(--kf-amber); color: #ffb547; }
    .kickflow-status-label--deleted, .kickflow-status-label--unknown { --kf-cut: var(--kf-grey); color: #aeb7b1; }
    .kickflow-mod-label {
      margin-left: 5px;
      color: var(--kf-ink-2); font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none;
    }
    #${OWN_LIST_ID} .kickflow-badge-text,
    #${OWN_LIST_ID} .kickflow-badge-role,
    #${OWN_LIST_ID} .kickflow-badge-role__count { font-size: 12px; }

    /* --- Events: no cards. A neutral gutter, a line glyph, names in ink. --- */
    #${OWN_LIST_ID} .kickflow-event-row {
      display: flex; align-items: baseline; gap: 0; margin: 2px 0;
      border: 0; border-radius: 4px;
      padding: 5px 6px 5px 10px; background: transparent; color: var(--kf-ink-2);
    }
    #${OWN_LIST_ID} .kickflow-event-row::before {
      content: ''; background: var(--kf-line-3);
    }
    #${OWN_LIST_ID} .kickflow-event-row--gifted-subscription,
    #${OWN_LIST_ID} .kickflow-event-row--subscription,
    #${OWN_LIST_ID} .kickflow-event-row--kicks,
    #${OWN_LIST_ID} .kickflow-event-row--celebration { background: linear-gradient(90deg, rgba(83,252,24,0.05), transparent 75%); }
    #${OWN_LIST_ID} .kickflow-event-row--gifted-subscription::before,
    #${OWN_LIST_ID} .kickflow-event-row--subscription::before,
    #${OWN_LIST_ID} .kickflow-event-row--kicks::before,
    #${OWN_LIST_ID} .kickflow-event-row--celebration::before { background: rgba(83,252,24,0.55); }
    #${OWN_LIST_ID} .kickflow-event-row--celebration {
      align-items: flex-start;
    }
    #${OWN_LIST_ID} .kickflow-event-row--celebration .kickflow-event-row__body,
    #${OWN_LIST_ID} .kickflow-celebration__headline,
    #${OWN_LIST_ID} .kickflow-celebration__message { display: block; min-width: 0; }
    #${OWN_LIST_ID} .kickflow-celebration__headline { font-weight: 600; }
    #${OWN_LIST_ID} .kickflow-celebration__message {
      margin-top: 3px; padding: 0 0 0 8px; border-left: 1px solid var(--kf-line-3);
      background: transparent; color: var(--kf-ink);
    }
    #${OWN_LIST_ID} .kickflow-celebration__author { font-weight: 700; }
    #${OWN_LIST_ID} .kickflow-event-row__icon { flex: none; margin-right: 8px; color: var(--kf-ink-3); }
    #${OWN_LIST_ID} .kickflow-event-row svg { display: inline-block; vertical-align: -3px; }
    #${OWN_LIST_ID} .kickflow-event-row__username,
    #${OWN_LIST_ID} .kickflow-event-row__count,
    #${OWN_LIST_ID} .kickflow-event-row__recipient { font-weight: 700; color: var(--kf-ink); }
    #${OWN_LIST_ID} .kickflow-event-row__count { font-variant-numeric: tabular-nums; }
    #${OWN_LIST_ID} .kickflow-event-row__more {
      cursor: pointer; text-decoration: underline; text-decoration-color: var(--kf-line-3); text-underline-offset: 2px;
    }
    #${OWN_LIST_ID} .kickflow-event-row__more:hover { color: var(--kf-ink); }
    /* Connection gap: a rule with the words in the middle. */
    #${OWN_LIST_ID} .kickflow-event-row--gap {
      display: flex; align-items: center; gap: 10px; padding: 8px 0; margin: 6px 0; border: 0;
      border-radius: 0; background: transparent; color: var(--kf-ink-3); font-size: 12px; text-align: center;
    }
    #${OWN_LIST_ID} .kickflow-event-row--gap::before,
    #${OWN_LIST_ID} .kickflow-event-row--gap::after {
      content: ''; position: static; flex: 1 1 12px; height: 1px; width: auto; border-radius: 0;
      background: repeating-linear-gradient(90deg, var(--kf-line-3) 0 3px, transparent 3px 6px);
    }
    #${OWN_LIST_ID} .kickflow-event-row--gap .kickflow-event-row__icon { display: none; }
    #${OVERLAY_ROOT_ID} [data-kickflow-chat-status] { background: var(--kf-surface); border-top: 1px solid var(--kf-line-2); color: var(--kf-ink-2); font-family: var(--kf-font); }
    #${OVERLAY_ROOT_ID} [data-kickflow-chat-status] button {
      color: var(--kf-green-text); font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
      border: 0; background: transparent; padding: 4px 6px;
    }
    html.kickflow-chat-active #chatroom-messages[data-kickflow-main-chat] > * { visibility: hidden !important; }
    /* A descendant can override inherited visibility. Opacity on the native row cannot be
       overridden by Kick's reply action during own-list takeover. */
    html.kickflow-chat-active #chatroom-messages[data-kickflow-main-chat] [data-index] { opacity: 0 !important; pointer-events: none !important; }
    /* Kick's virtualized list can retain :hover on the old row after an incoming message moves
       the list under a stationary mouse. The augmenter marks the row actually under the pointer.
       Keyboard focus remains a separate way to reveal the native reply control. */
    #chatroom-messages [data-index]:hover:not([data-kickflow-pointer-row]):not(:has(:focus-visible)) > .group > .w-full {
      background-color: transparent !important;
    }
    #chatroom-messages [data-index]:is([data-kickflow-pointer-row], :has(:focus-visible)) > .group > .w-full {
      background-color: rgba(255,255,255,0.06) !important;
    }
    #chatroom-messages [data-index] > .group > div:has(> button > svg[data-ds-icon="ArrowCurveLeft"]) {
      display: none !important;
    }
    #chatroom-messages [data-index]:is([data-kickflow-pointer-row], :has(:focus-visible)) > .group > div:has(> button > svg[data-ds-icon="ArrowCurveLeft"]) {
      display: flex !important;
    }
    /* Count appended to Kick's own "Chat paused for scrolling" button. */
    .kickflow-pause-count {
      margin-left: 2px; padding: 0 6px; border-radius: 4px; line-height: 1.5;
      background: var(--kf-green, #53fc18); color: var(--kf-green-ink, #0b0e0f);
      font-weight: 700; font-variant-numeric: tabular-nums;
    }
    /* Paused chat: Kick's own button shape (6px radius, like "Gönder"), so it reads as part of the page. */
    .kickflow-scroll-pill {
      position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 20;
      display: inline-flex; align-items: center; gap: 6px;
      height: 30px; padding: 0 14px; border: 0; border-radius: 6px;
      background: var(--kf-green); color: var(--kf-green-ink); cursor: pointer;
      font-family: var(--kf-font); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
      line-height: 1; white-space: nowrap; box-shadow: 0 0 0 4px var(--kf-ground), 0 8px 20px rgba(0,0,0,0.5);
      transition: background .12s ease, transform .1s ease;
    }
    .kickflow-scroll-pill:hover { background: #6dff3a; }
    .kickflow-scroll-pill:active { transform: translateX(-50%) scale(0.96); }
    .kickflow-scroll-pill:focus-visible { outline: 2px solid var(--kf-ink); outline-offset: 2px; }

    /* --- User card: a margin note pinned beside the chat. --- */
    .kickflow-user-card {
      position: fixed; z-index: 2147483647; width: 320px; padding: 14px 14px 12px;
      box-sizing: border-box; display: flex; flex-direction: column; gap: 12px;
      max-height: calc(100vh - ${CARD_MAX_HEIGHT_INSET_PX}px);
      max-width: calc(100vw - ${CARD_MAX_HEIGHT_INSET_PX}px); overflow-y: auto;
      border: 1px solid var(--kf-line-2); border-radius: 10px;
      background: var(--kf-surface); color: var(--kf-ink);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 44px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
      font-family: var(--kf-font); font-size: 13px;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
      animation: kickflow-card-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .kickflow-user-card--instant { animation: none; }
    .kickflow-user-card > :not(.kickflow-user-messages) { flex-shrink: 0; }
    @keyframes kickflow-card-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .kickflow-user-card { animation: none; } }
    .kickflow-user-card__header { display: flex; align-items: center; gap: 12px; height: 44px; padding-right: 30px; cursor: move; user-select: none; }
    .kickflow-user-card__avatar {
      display: block; width: 44px; height: 44px; border-radius: 50%; object-fit: cover;
      background: var(--kf-surface-3); box-shadow: 0 0 0 1px var(--kf-line-2); flex: none;
    }
    .kickflow-user-card__title { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .kickflow-user-card__nameRow { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .kickflow-user-card__nameRow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 750; letter-spacing: -.01em; }
    .kickflow-user-card__name { cursor: pointer; }
    .kickflow-user-card__name:hover { text-decoration: underline; text-underline-offset: 3px; }
    .kickflow-user-card__verified { color: var(--kf-green); font-size: 12px; flex: none; }
    .kickflow-user-card__role { align-self: flex-start; color: var(--kf-ink-2); font-size: 12px; font-weight: 600; text-transform: none; }
    .kickflow-user-card__close {
      position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 6px; background: transparent; color: var(--kf-ink-3);
      font-size: 18px; line-height: 1; cursor: pointer; transition: background .12s ease, color .12s ease;
    }
    .kickflow-user-card__close:hover { background: var(--kf-surface-3); color: var(--kf-ink); }
    .kickflow-user-card__close:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 1px; }
    .kickflow-user-card__bio {
      color: var(--kf-ink-2); font-size: 13px; line-height: 1.45; margin: 0;
      height: 58px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    }
    .kickflow-user-card__facts {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0;
      padding: 0; border-radius: 0; background: transparent;
      border-top: 1px solid var(--kf-line);
    }
    .kickflow-user-card__field {
      display: flex; flex-direction: column; gap: 2px; min-width: 0;
      padding: 8px 0 8px; border-bottom: 1px solid var(--kf-line);
    }
    .kickflow-user-card__field:nth-child(even) { padding-left: 12px; border-left: 1px solid var(--kf-line); }
    .kickflow-user-card__key {
      color: var(--kf-ink-3); font-size: 12px; font-weight: 500; letter-spacing: 0;
      text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-card__key::first-letter { text-transform: uppercase; }
    .kickflow-user-card__value {
      color: var(--kf-ink); font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-card__badges { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; height: 20px; overflow-y: auto; }
    .kickflow-user-card[aria-busy="true"] :is(.kickflow-user-card__bio, .kickflow-user-card__badges, .kickflow-user-card__value) {
      color: transparent; border-radius: 4px; background: rgba(255,255,255,0.055);
    }
    .kickflow-user-messages {
      display: flex; flex-direction: column; min-height: 0;
      padding-top: 2px; border-top: 0;
    }
    .kickflow-user-messages__toggle {
      appearance: none; width: 100%; display: flex; align-items: center; gap: 8px; flex: none;
      padding: 0 0 6px; border: 0; background: transparent; color: var(--kf-ink-2); cursor: pointer;
      font: 600 12px/1.4 var(--kf-font); letter-spacing: 0;
      text-transform: none; text-align: left;
    }
    .kickflow-user-messages__toggle::after {
      content: ''; flex: none; width: 6px; height: 6px; margin-right: 4px; border: solid var(--kf-ink-3);
      border-width: 0 1.5px 1.5px 0; transform: rotate(45deg) translateY(-2px); transition: transform .15s ease;
    }
    .kickflow-user-messages--collapsed .kickflow-user-messages__toggle::after { transform: rotate(-45deg); }
    .kickflow-user-messages__toggle:hover { color: var(--kf-ink); }
    .kickflow-user-messages__toggle:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 2px; border-radius: 3px; }
    .kickflow-user-messages__title { min-width: 0; flex: 1; }
    .kickflow-user-messages__count {
      min-width: 18px; padding: 1px 6px; border-radius: 4px;
      background: var(--kf-surface-3); color: var(--kf-ink-2); text-align: center;
      font-size: 12px; letter-spacing: 0; font-variant-numeric: tabular-nums;
    }
    .kickflow-user-messages__body {
      flex: 1 1 auto; min-height: 0; max-height: 260px; overflow-y: auto; padding-right: 4px;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    .kickflow-user-messages__row {
      position: relative; display: block; min-width: 0; padding: 5px 6px; border-radius: 4px;
      color: var(--kf-ink); cursor: pointer; line-height: 1.45;
      word-break: break-word; overflow-wrap: anywhere;
      transition: background 120ms ease;
    }
    .kickflow-user-messages__row + .kickflow-user-messages__row {
      box-shadow: 0 -1px 0 var(--kf-line);
    }
    .kickflow-user-messages__row:hover,
    .kickflow-user-messages__row:focus-visible { outline: none; background: rgba(255,255,255,0.045); }
    .kickflow-user-messages__row:focus-visible { box-shadow: inset 0 0 0 2px rgba(83,252,24,0.75); }
    .kickflow-user-messages__row--deleted .kickflow-user-messages__text {
      text-decoration: line-through; text-decoration-color: rgba(154,163,157,0.8); color: var(--kf-ink-3);
    }
    .kickflow-user-messages__row--deleted::before {
      content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
      background: repeating-linear-gradient(180deg, var(--kf-grey) 0 3px, transparent 3px 5px);
    }
    .kickflow-user-messages__reply {
      display: flex; align-items: baseline; gap: 4px; min-width: 0;
      margin: 0 0 2px ${USER_MESSAGE_TIME_COLUMN_PX}px;
      color: var(--kf-ink-3); font-size: 12px; line-height: 1.35;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .kickflow-user-messages__reply > * { flex: none; }
    .kickflow-user-messages__replyIcon { opacity: 0.7; }
    .kickflow-user-messages__replyUser { color: var(--kf-ink-2); font-weight: 600; }
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
      flex: none; width: ${USER_MESSAGE_TIME_COLUMN_PX}px; color: var(--kf-ink-3);
      font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .kickflow-user-messages__text { min-width: 0; flex: 1; }
    .kickflow-user-messages__empty,
    .kickflow-user-messages__note {
      color: var(--kf-ink-3); font-size: 12px; line-height: 1.45;
    }
    .kickflow-user-messages__empty { padding: 4px 6px 2px; }
    .kickflow-user-messages__note { flex: none; padding: 7px 6px 0; }
    .kickflow-user-messages--collapsed .kickflow-user-messages__body,
    .kickflow-user-messages--collapsed .kickflow-user-messages__empty,
    .kickflow-user-messages--collapsed .kickflow-user-messages__note { display: none; }
    .kickflow-user-messages__name { color: var(--kf-ink-2); font-weight: 600; }
    /* Search reuses the archived-message row wholesale; only the input, the summary line and the
       taller result body are its own. Heights are relative so the list follows the panel. */
    .kickflow-search__input {
      width: 100%; box-sizing: border-box; margin: 0 0 12px;
      height: 38px; padding: 0 12px; border-radius: 6px;
      border: 1px solid var(--kf-line-2); background: var(--kf-ground);
      color: var(--kf-ink); font-size: 14px; font-family: inherit;
    }
    .kickflow-search__input::placeholder { color: var(--kf-ink-3); }
    .kickflow-search__input:focus-visible {
      outline: none; border-color: rgba(83,252,24,0.75); box-shadow: 0 0 0 3px rgba(83,252,24,0.14);
    }
    .kickflow-search { display: flex; flex-direction: column; min-height: 0; }
    .kickflow-search__results { display: flex; flex-direction: column; min-height: 0; }
    .kickflow-search__summary {
      flex: none; padding: 0 6px 6px; color: var(--kf-ink-3); font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .kickflow-search__note { padding: 4px 6px; color: var(--kf-ink-3); font-size: 12px; line-height: 1.5; }
    .kickflow-search__body { max-height: 46vh; }
    .kickflow-search__hit {
      background: rgba(255,181,71,0.24); color: inherit;
      box-shadow: inset 0 -1.5px 0 rgba(255,181,71,0.9);
      /* A quoted phrase is a multi-word hit, so it wraps in a panel this narrow. Without clone the
         inset ring draws only on the first fragment's edges and the hit reads as a broken box.
         Neither declaration affects layout. */
      -webkit-box-decoration-break: clone; box-decoration-break: clone;
    }
    .kickflow-user-card__actions {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; min-height: 32px;
    }
    .kickflow-user-card__action {
      display: inline-flex; align-items: center; justify-content: center; min-height: 32px;
      padding: 6px 8px; border: 1px solid var(--kf-line-2); border-radius: 4px;
      background: var(--kf-surface-2); color: var(--kf-ink); font: inherit;
      font-size: 12px; line-height: 1.3; text-decoration: none; cursor: pointer;
    }
    .kickflow-user-card__action:hover { background: var(--kf-surface-3); color: var(--kf-green-text); }
    .kickflow-user-card__action:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 2px; }
    .kickflow-user-card__action:disabled { opacity: .55; cursor: default; }
    .kickflow-user-card__link {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin: 0 -14px -12px; padding: 10px 14px; border-top: 1px solid var(--kf-line);
      color: var(--kf-ink-2); text-decoration: none; font-size: 13px; font-weight: 600;
      max-width: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      border-radius: 0 0 10px 10px; transition: background .12s ease, color .12s ease;
    }
    .kickflow-user-card__link:hover { background: var(--kf-surface-2); color: var(--kf-green-text); }
    .kickflow-user-card__link:focus-visible { outline: 2px solid var(--kf-green); outline-offset: -2px; }
    .kickflow-badge-icon {
      display: inline-block !important; height: 18px !important; width: 18px !important;
    }
    .kickflow-badge-text { font-size: 12px; font-weight: 700; opacity: 0.75; }
    .kickflow-badge-role {
      display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      min-width: 18px; height: 18px; padding: 0 3px;
      color: inherit; font-size: 10px; font-weight: 800; line-height: 1;
      gap: 1px;
    }
    .kickflow-badge-role__count { font-size: 9px; font-weight: 700; }
    #${OWN_LIST_ID} .kickflow-message__badges .kickflow-badge-icon {
      width: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
      height: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
    }
    #${OWN_LIST_ID} .kickflow-message__badges .kickflow-badge-role {
      min-width: calc(var(--chatroom-font-size, 13px) * (18 / 13));
      height: calc(var(--chatroom-font-size, 13px) * (18 / 13));
    }
    ${BADGE_STYLES}
    .kickflow-hover-tooltip {
      position: fixed; z-index: 2147483647;
      max-width: min(var(--kickflow-hover-tooltip-max-width), calc(100vw - (2 * var(--kickflow-hover-tooltip-viewport-inset))));
      box-sizing: border-box;
      padding: 5px 8px; border: 1px solid var(--kf-line-2); border-radius: 6px;
      background: var(--kf-surface-2); color: var(--kf-ink); box-shadow: 0 8px 22px rgba(0,0,0,0.5);
      font: 12px/1.4 var(--kf-font); white-space: normal; overflow-wrap: anywhere;
      pointer-events: none; user-select: none; visibility: hidden; opacity: 0;
    }
    .kickflow-hover-tooltip--visible { visibility: visible; opacity: 1; }
    .kickflow-emote-box {
      position: relative; display: inline-block;
      width: 24px; height: 24px; vertical-align: middle; margin: 0 2px;
      cursor: pointer;
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
    /* @name takes the mentioned chatter's own name colour (seen colour first, else the hashed
       palette system rows use), so a glance ties the mention to that speaker's rows. A link is
       "do this", so it takes the green text with a quiet rule. 2026-11-22. */
    .kickflow-mention {
      color: var(--kf-mention-color, var(--kf-ink)); font-weight: 650;
    }
    .kickflow-mention--link { cursor: pointer; }
    .kickflow-mention--link:hover { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .kickflow-link {
      color: var(--kf-green-text); text-decoration: underline; text-decoration-color: rgba(140,255,99,0.45);
      text-decoration-thickness: 1px; text-underline-offset: 3px;
    }
    .kickflow-link:hover { text-decoration-color: currentColor; }
    .kickflow-active-chatters-badge {
      flex: none; min-width: auto; height: 18px; margin-left: auto; padding: 0 6px;
      border: 1px solid rgba(255,107,94,0.45); border-radius: 4px;
      background: var(--kf-red-soft); color: #ffb1a9; cursor: pointer;
      font-size: 11px; font-weight: 700; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums;
    }
    .kickflow-active-chatters-badge:hover { background: rgba(255,107,94,0.2); color: #fff; }
    .kickflow-active-chatters-badge:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 1px; }
    .kickflow-original-content {
      margin-left: 0; color: var(--kf-ink); opacity: 1;
      word-break: break-word; overflow-wrap: anywhere;
    }
    /* Preserved (deleted/banned) rows: hide the native content entirely — Kick may leave the
       original text OR swap in a "Deleted by a moderator" placeholder — and show our stored copy. */
    .kickflow-native-content-dimmed { display: none !important; }
    .kickflow-preserved-username { font-weight: 700; }
    .kickflow-preserved-username--link { cursor: pointer; }
    .kickflow-preserved-username--link:hover { text-decoration: underline; }
    /* Ghost block (native view): a banned user's earlier lines, kept under the row they belong to. */
    .kickflow-ghost-block {
      position: relative; display: block; margin: 4px 0 2px 0; padding: 2px 0 2px 12px;
      border-left: 0;
    }
    .kickflow-ghost-block::before {
      content: ''; position: absolute; left: 2px; top: 3px; bottom: 3px; width: 3px;
      background: repeating-linear-gradient(180deg, var(--kf-red) 0 4px, transparent 4px 7px);
    }
    .kickflow-ghost-row {
      display: block; padding: 2px 0; color: var(--kf-ink-2); opacity: 1;
      font-size: 13px; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere;
    }
    .kickflow-ghost-row__time { margin-right: 5px; color: var(--kf-ink-3); font-size: 12px; font-variant-numeric: tabular-nums; }
    .kickflow-ghost-row__badges {
      margin-right: 4px; display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;
    }
    .kickflow-ghost-row__username { font-weight: 700; }
    .kickflow-ghost-row__username--link { cursor: pointer; }
    .kickflow-ghost-row__username--link:hover { text-decoration: underline; }
    .kickflow-ghost-row__separator { font-weight: 700; }
    .kickflow-ghost-row__content { text-decoration: line-through; text-decoration-color: rgba(255,107,94,0.7); opacity: 1; }
    .kickflow-ghost-empty { color: var(--kf-ink-3); font-size: 12px; text-align: center; padding: 22px 10px; }

    /* --- Moderator actions: same gutter + stamp language as removed messages. --- */
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
      display: inline-flex; align-items: baseline; margin-left: 4px; padding: 0 3px; border-radius: 3px;
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
      --kickflow-modaction-accent: var(--kf-grey);
      --kickflow-modaction-band: linear-gradient(90deg, color-mix(in srgb, var(--kickflow-modaction-accent) 9%, transparent), transparent 80%);
      --kickflow-modaction-moderator-color: #eef2ef;
      --kickflow-modaction-body-color: #b4bdb7;
      --kickflow-modaction-meta-color: #b4bdb7;
      background: var(--kickflow-modaction-band);
      color: var(--kickflow-modaction-body-color);
      border: 0;
      border-radius: 4px;
      box-shadow: none;
    }
    .kickflow-modaction-kind--ban {
      --kickflow-modaction-accent: #ff6b5e;
    }
    .kickflow-modaction-kind--timeout {
      --kickflow-modaction-accent: #ffb547;
    }
    .kickflow-modaction-kind--delete {
      --kickflow-modaction-accent: #9aa39d;
    }
    .kickflow-event-row--mod-action {
      cursor: pointer;
    }
    .kickflow-event-row--mod-action .kickflow-event-row__kind-tag {
      padding: 0; border: 0; background: transparent; font-family: inherit;
      display: inline-flex; align-items: center; box-sizing: border-box;
      margin-right: 6px;
      color: var(--kickflow-modaction-accent);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      vertical-align: 1px;
      white-space: nowrap;
    }
    .kickflow-event-row__kind-tag:is(button) { cursor: pointer; }
    .kickflow-event-row__kind-tag:is(button):focus-visible {
      outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px;
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
      text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
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
      padding: 4px 6px 4px 10px;
      line-height: 1.45;
      word-break: break-word;
      overflow-wrap: anywhere;
      background: var(--kickflow-modaction-band);
      color: var(--kickflow-modaction-body-color);
      border: 0;
      border-radius: 4px;
      box-shadow: none;
    }
    #${OWN_LIST_ID} .kickflow-event-row--mod-action::before {
      content: ''; background: repeating-linear-gradient(180deg, var(--kickflow-modaction-accent) 0 4px, transparent 4px 7px);
    }
    #${OWN_LIST_ID} .kickflow-event-row--mod-action .kickflow-event-row__icon { display: none; }
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
      position: relative;
      display: block; box-sizing: border-box; flex: 0 0 auto;
      width: calc(100% + (2 * var(--kickflow-native-content-inline-padding)));
      max-width: calc(100% + (2 * var(--kickflow-native-content-inline-padding))); min-width: 0;
      margin: 3px 0 0 calc(-1 * var(--kickflow-native-content-inline-padding)); padding-left: 10px;
      font: inherit;
      border: 0;
    }
    .kickflow-modaction-block::before {
      content: ''; position: absolute; left: 2px; top: 4px; bottom: 4px; width: 3px;
      background: repeating-linear-gradient(180deg, var(--kickflow-modaction-accent) 0 4px, transparent 4px 7px);
    }
    .kickflow-modaction-block .kickflow-event-row {
      display: flex; align-items: baseline; min-width: 0; margin: 0; padding: 4px 0;
      color: inherit; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere;
      background: transparent;
      border: 0;
      border-radius: 0;
    }
    .kickflow-modaction-block .kickflow-event-row__body { min-width: 0; }

    /* --- KickFlow settings dashboard: one shared body-level modal for navbar + footer.
       Layout: a dark rail (where you are) beside a lighter sheet (what you change). Rows are
       label + one-line hint + control; hints wrap instead of being cut with an ellipsis. --- */
    @keyframes kickflow-dashboard-in {
      from { opacity: 0; transform: translateY(8px) scale(.99); }
      to { opacity: 1; transform: none; }
    }
    @keyframes kickflow-hotkey-capture {
      0%, 100% { opacity: .62; transform: scale(.985); }
      50% { opacity: 1; transform: scale(1); }
    }
    .kickflow-panel {
      position: fixed; inset: 0; z-index: 2147483000;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: rgba(3,5,4,0.62); color: var(--kf-ink);
      font-family: var(--kf-font);
      line-height: 1.4; overscroll-behavior: contain;
    }
    .kickflow-panel, .kickflow-panel * { box-sizing: border-box; }
    .kickflow-panel__shell {
      width: min(780px, 92vw); height: min(620px, 84vh); max-height: 84vh;
      display: grid; grid-template-columns: 200px minmax(0, 1fr); overflow: hidden;
      border: 1px solid var(--kf-line-2); border-radius: 12px;
      background: var(--kf-surface);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 28px 80px rgba(0,0,0,0.6);
      animation: kickflow-dashboard-in 200ms var(--kf-ease) both;
    }
    .kickflow-panel__rail {
      min-width: 0; display: flex; flex-direction: column; padding: 20px 12px 16px;
      border-right: 1px solid var(--kf-line);
      background: var(--kf-ground);
    }
    .kickflow-panel__wordmark {
      display: flex; align-items: center; gap: 10px;
      padding: 0 8px; color: var(--kf-ink);
      font-size: 16px; font-weight: 800; letter-spacing: -.02em;
    }
    .kickflow-panel__wordmark::before {
      content: ''; flex: none; width: 24px; height: 24px; background: var(--kf-mark) center / contain no-repeat;
    }
    .kickflow-panel__rail-caption {
      margin: 22px 8px 6px; color: var(--kf-ink-4);
      font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    }
    .kickflow-panel__nav { display: flex; flex-direction: column; gap: 1px; }
    .kickflow-panel__nav-item {
      position: relative; appearance: none; width: 100%; min-height: 36px; padding: 0 10px 0 14px; border: 0; border-radius: 6px;
      background: transparent; color: var(--kf-ink-2); cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      font: 550 14px/1.3 var(--kf-font); text-align: left;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .kickflow-panel__nav-item::before {
      content: ''; position: absolute; left: 3px; top: 9px; bottom: 9px; width: 3px; border-radius: 2px;
      background: transparent; transition: background-color 120ms ease;
    }
    .kickflow-panel__nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kickflow-panel__nav-item:hover { background: var(--kf-surface-2); color: var(--kf-ink); }
    .kickflow-panel__nav-item--active,
    .kickflow-panel__nav-item--active:hover {
      background: var(--kf-surface-2); color: var(--kf-ink); font-weight: 650;
    }
    .kickflow-panel__nav-item--active::before { background: var(--kf-green); }
    .kickflow-panel__version {
      margin: auto 8px 0; color: var(--kf-ink-4); font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .kickflow-panel__main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .kickflow-panel__header {
      flex: none; display: flex; align-items: center; min-height: 60px; padding: 0 16px 0 28px;
      background: var(--kf-surface); border-bottom: 1px solid var(--kf-line);
    }
    .kickflow-panel__title {
      min-width: 0; flex: 1; margin: 0; color: var(--kf-ink);
      font-size: 18px; font-weight: 750; letter-spacing: -.015em;
    }
    .kickflow-panel__count {
      min-width: 20px; margin-left: auto; padding: 1px 6px; border: 0;
      border-radius: 4px; background: var(--kf-red-soft); color: #ffb1a9;
      font-size: 12px; font-weight: 700; line-height: 1.4; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .kickflow-panel__btn {
      appearance: none; width: 32px; height: 32px; padding: 0; margin: 0; border: 0;
      border-radius: 6px; background: transparent; color: var(--kf-ink-3); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 400; line-height: 1;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .kickflow-panel__btn:hover { background: var(--kf-surface-3); color: var(--kf-ink); }
    .kickflow-panel__settings {
      min-height: 0; flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 28px 28px;
      scrollbar-color: rgba(255,255,255,0.16) transparent; scrollbar-width: thin;
    }
    .kickflow-panel__section { padding-top: 20px; }
    .kickflow-panel__section[hidden] { display: none !important; }
    .kickflow-panel__section-intro {
      max-width: 500px; margin: 0 0 22px; color: var(--kf-ink-2); font-size: 14px; line-height: 1.5;
    }
    .kickflow-panel__group { margin-top: 26px; }
    .kickflow-panel__section-intro + .kickflow-panel__group { margin-top: 0; }
    .kickflow-panel__settings-title {
      display: flex; align-items: center; margin: 0 0 6px; color: var(--kf-ink-3);
      font-size: 12px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase;
    }
    /* Live status as tiles: the number is the thing you read, the label says what it counts. */
    .kickflow-panel__stats {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0;
      border: solid var(--kf-line); border-width: 1px 0 0 1px; border-radius: 8px; overflow: hidden; background: var(--kf-surface);
    }
    .kickflow-panel__stat {
      min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px;
      min-height: 62px; padding: 10px 12px; border-bottom: 0; background: var(--kf-surface);
      box-shadow: inset -1px -1px 0 var(--kf-line);
    }
    .kickflow-panel__stat dt { color: var(--kf-ink-3); font-size: 12px; }
    .kickflow-panel__stat dd {
      max-width: 100%; min-width: 0; display: flex; align-items: center; gap: 6px; margin: 0; overflow: hidden;
      color: var(--kf-ink); font-size: 17px; font-weight: 650; letter-spacing: -.01em;
      font-variant-numeric: tabular-nums; white-space: nowrap; text-overflow: ellipsis;
    }
    .kickflow-panel__stat dd.kickflow-panel__stat-value--missing {
      color: var(--kf-ink-4); font-weight: 500;
    }
    .kickflow-panel__live-dot {
      display: inline-block; width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--kf-ink-4);
    }
    .kickflow-panel__live-dot--connected { background: var(--kf-green); box-shadow: 0 0 0 3px rgba(83,252,24,0.16); }
    .kickflow-panel__settings-row {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; cursor: pointer;
    }
    .kickflow-panel__settings-row--mode {
      min-height: 60px; padding: 10px 0; border-top: 1px solid var(--kf-line);
      border-bottom: 1px solid var(--kf-line);
    }
    .kickflow-panel__settings-row--mode + .kickflow-panel__settings-row--mode { border-top: 0; }
    .kickflow-panel__settings-row--toggle {
      min-height: 58px; padding: 10px 10px; margin: 0 -10px; border-bottom: 1px solid var(--kf-line);
      border-radius: 0;
    }
    .kickflow-panel__settings-row--toggle:first-child { border-top: 1px solid var(--kf-line); }
    .kickflow-panel__settings-row--toggle:hover { background: rgba(255,255,255,0.025); }
    .kickflow-panel__settings-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding-right: 12px; }
    .kickflow-panel__settings-label { color: var(--kf-ink); font-size: 14px; font-weight: 550; }
    .kickflow-panel__settings-description {
      overflow: visible; color: var(--kf-ink-3); font-size: 13px; line-height: 1.4;
      white-space: normal; text-overflow: clip;
    }
    .kickflow-panel__settings select {
      min-width: 136px; height: 36px; padding: 0 30px 0 12px; appearance: none;
      background: var(--kf-surface-2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='m3 4.5 3 3 3-3' fill='none' stroke='%23b4bdb7' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center;
      color: var(--kf-ink);
      border: 1px solid var(--kf-line-2); border-radius: 6px;
      font: 600 13px/1 var(--kf-font); cursor: pointer;
    }
    .kickflow-panel__settings select:hover { border-color: var(--kf-line-3); }
    .kickflow-panel__settings-toggle {
      appearance: none; position: relative; flex: 0 0 auto; width: 36px; height: 20px; margin: 0;
      border: 0; border-radius: 999px; background: rgba(255,255,255,0.16);
      cursor: pointer; transition: background-color 140ms ease;
    }
    .kickflow-panel__settings-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: #d7ddd8; box-shadow: 0 1px 2px rgba(0,0,0,0.4);
      transition: transform 140ms var(--kf-ease), background-color 140ms ease;
    }
    .kickflow-panel__settings-toggle:checked { background: var(--kf-green); }
    .kickflow-panel__settings-toggle:checked::after { background: var(--kf-green-ink); transform: translateX(16px); }
    .kickflow-panel__settings-toggle:focus-visible,
    .kickflow-panel__settings select:focus-visible,
    .kickflow-panel__nav-item:focus-visible,
    .kickflow-panel__btn:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 2px; }
    .kickflow-panel__settings-hint {
      margin: 16px 0 0; color: var(--kf-ink-3); font-size: 12px; text-align: left;
    }
    .kickflow-panel__save-status {
      flex: 0 0 auto; margin: 8px 24px; overflow-wrap: anywhere; text-align: left; color: var(--kf-amber); font-size: 13px;
    }
    .kickflow-panel__hotkeys {
      border-top: 1px solid var(--kf-line);
    }
    .kickflow-panel__hotkey-row {
      display: grid; grid-template-columns: minmax(0,1fr) auto auto 38px;
      align-items: center; gap: 10px; min-height: 56px;
      border-bottom: 1px solid var(--kf-line);
    }
    .kickflow-panel__hotkey-label {
      overflow: hidden; color: var(--kf-ink); font-size: 14px; font-weight: 550;
      white-space: nowrap; text-overflow: ellipsis;
    }
    /* A key is a keycap, not a green badge: green stays for "on". */
    .kickflow-panel__hotkey-chip {
      min-width: 34px; padding: 5px 9px 4px; border: 1px solid var(--kf-line-3); border-bottom-width: 2px; border-radius: 5px;
      background: var(--kf-surface-2); color: var(--kf-ink);
      font: 650 12px/1.2 var(--kf-mono); text-align: center;
    }
    .kickflow-panel__hotkey-chip--capturing {
      min-width: 94px; border-color: rgba(255,181,71,0.6); color: var(--kf-amber);
      animation: kickflow-hotkey-capture 1.1s ease-in-out infinite;
    }
    .kickflow-panel__hotkey-change,
    .kickflow-panel__hotkey-reset {
      appearance: none; border: 1px solid var(--kf-line-2); border-radius: 6px;
      background: transparent; color: var(--kf-ink-2); cursor: pointer;
      font: 600 13px/1 var(--kf-font);
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .kickflow-panel__hotkey-change { min-width: 76px; height: 32px; padding: 0 12px; }
    .kickflow-panel__hotkey-change:hover,
    .kickflow-panel__hotkey-reset:hover { background: var(--kf-surface-3); color: var(--kf-ink); }
    .kickflow-panel__hotkey-change--capturing { border-color: rgba(255,181,71,0.6); color: var(--kf-amber); }
    .kickflow-panel__hotkey-footer { display: flex; align-items: center; gap: 12px; min-height: 42px; margin-top: 10px; }
    .kickflow-panel__hotkey-status { min-width: 0; flex: 1; color: var(--kf-ink-3); font-size: 12px; line-height: 1.35; }
    .kickflow-panel__hotkey-reset { flex: none; height: 32px; padding: 0 12px; }
    .kickflow-panel__hotkey-change:focus-visible,
    .kickflow-panel__hotkey-reset:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 2px; }
    .kickflow-panel__removed-list {
      border-top: 1px solid var(--kf-line);
    }
    .kickflow-panel__filter-chip {
      align-self: flex-start; margin: 0 0 12px; padding: 5px 10px; border: 1px solid var(--kf-line-3);
      border-radius: 6px; background: var(--kf-surface-2); color: var(--kf-ink);
      cursor: pointer; font: 600 13px/1.2 var(--kf-font);
    }
    .kickflow-panel__filter-chip[hidden] { display: none; }
    .kickflow-panel__filter-chip:hover { border-color: var(--kf-ink-3); }
    .kickflow-panel__filter-chip:focus-visible { outline: 2px solid var(--kf-green); outline-offset: 2px; }
    /* Removed list: a log. Time | who + what (struck) | stamp + moderator. */
    .kickflow-removed-row {
      position: relative;
      display: grid; grid-template-columns: 48px minmax(0, 1fr) minmax(110px, auto);
      align-items: start; gap: 14px; padding: 13px 4px 13px 14px;
      border-bottom: 1px solid var(--kf-line);
      color: var(--kf-ink); word-break: break-word; overflow-wrap: anywhere;
    }
    .kickflow-removed-row::before {
      content: ''; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px;
      background: repeating-linear-gradient(180deg, var(--kf-grey) 0 4px, transparent 4px 7px);
    }
    .kickflow-removed-row:has(.kickflow-status-label--banned)::before { background: repeating-linear-gradient(180deg, var(--kf-red) 0 4px, transparent 4px 7px); }
    .kickflow-removed-row:has(.kickflow-status-label--timeout)::before { background: repeating-linear-gradient(180deg, var(--kf-amber) 0 4px, transparent 4px 7px); }
    .kickflow-removed-row:last-child { border-bottom: 0; }
    .kickflow-removed-row__time {
      padding-top: 2px; color: var(--kf-ink-3); font-size: 12px; font-weight: 600;
      font-variant-numeric: tabular-nums; line-height: 1.4;
    }
    .kickflow-removed-row__message { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .kickflow-removed-row__username {
      width: fit-content; color: var(--kf-ink); font-size: 14px; font-weight: 700; line-height: 1.25;
    }
    .kickflow-removed-row__username--link { cursor: pointer; }
    .kickflow-removed-row__username--link:hover { text-decoration: underline; }
    .kickflow-removed-row__content {
      color: var(--kf-ink-2); font-size: 14px; line-height: 1.5;
      text-decoration-line: line-through; text-decoration-color: rgba(154,163,157,0.75);
      text-decoration-thickness: 1.5px;
    }
    .kickflow-removed-row__action {
      min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    }
    .kickflow-panel .kickflow-removed-row .kickflow-status-label {
      position: static; margin: 0;
    }
    .kickflow-panel .kickflow-removed-row .kickflow-mod-label {
      max-width: 140px; margin: 0; padding: 0; border: 0; overflow: hidden; color: var(--kf-ink-3); opacity: 1;
      font-size: 12px; font-weight: 500; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap;
    }
    .kickflow-removed-empty {
      min-height: 280px; display: grid; place-items: center; padding: 28px;
      color: var(--kf-ink-3); font-size: 14px; text-align: center;
    }
    .kickflow-panel__about-mark {
      display: flex; align-items: center; gap: 14px;
      margin-top: 24px; color: var(--kf-ink); font-size: 28px; font-weight: 800; letter-spacing: -.03em;
    }
    .kickflow-panel__about-mark::before {
      content: ''; flex: none; width: 44px; height: 44px; background: var(--kf-mark) center / contain no-repeat;
    }
    .kickflow-panel__about-copy {
      max-width: 460px; margin: 12px 0 28px; color: var(--kf-ink-2); font-size: 14px; line-height: 1.6;
    }
    .kickflow-panel__about-facts { max-width: 460px; margin: 0; border-top: 1px solid var(--kf-line); }
    .kickflow-panel__about-facts > div {
      display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 44px;
      border-bottom: 1px solid var(--kf-line);
    }
    .kickflow-panel__about-facts dt { color: var(--kf-ink-3); font-size: 13px; }
    .kickflow-panel__about-facts dd { margin: 0; color: var(--kf-ink); font-size: 13px; font-weight: 600; }
    @media (max-width: 640px) {
      .kickflow-panel { padding: 12px; }
      .kickflow-panel__shell {
        width: min(94vw, 600px); height: 84vh; grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr);
      }
      .kickflow-panel__rail {
        padding: 12px 12px 10px; border-right: 0; border-bottom: 1px solid var(--kf-line);
      }
      .kickflow-panel__wordmark { padding: 0 4px; font-size: 15px; }
      .kickflow-panel__rail-caption, .kickflow-panel__version { display: none; }
      .kickflow-panel__nav {
        flex-direction: row; gap: 4px; margin-top: 10px; overflow-x: auto; overscroll-behavior-inline: contain;
        scrollbar-width: none;
      }
      .kickflow-panel__nav::-webkit-scrollbar { display: none; }
      .kickflow-panel__nav-item { width: auto; min-height: 32px; flex: 0 0 auto; padding: 0 12px; white-space: nowrap; }
      .kickflow-panel__nav-item::before { left: 10px; right: 10px; top: auto; bottom: 0; width: auto; height: 2px; }
      .kickflow-panel__count { margin-left: 2px; }
      .kickflow-panel__header { min-height: 52px; padding: 0 12px 0 18px; }
      .kickflow-panel__settings { padding: 0 18px 24px; }
      .kickflow-panel__section { padding-top: 16px; }
      .kickflow-panel__section-intro { margin-bottom: 18px; }
      .kickflow-panel__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .kickflow-panel__hotkey-row { gap: 8px; }
    }
    @media (max-width: 430px) {
      .kickflow-panel__hotkey-chip { min-width: 32px; padding-inline: 7px; }
      .kickflow-panel__hotkey-chip--capturing { min-width: 82px; }
      .kickflow-panel__hotkey-change { min-width: 62px; padding-inline: 8px; }
      .kickflow-removed-row { grid-template-columns: 40px minmax(0, 1fr); gap: 10px; }
      .kickflow-removed-row__action {
        grid-column: 2; flex-direction: row; align-items: center; justify-content: flex-start; flex-wrap: wrap;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .kickflow-panel__shell, .kickflow-panel__hotkey-chip--capturing, #${OWN_LIST_ID} .kickflow-message--jump-highlight { animation: none; }
    }

    /* A CSS-only slot leaves the native footer child/text sequence intact during hydration.
       The body-level control occupies this space beside the native send/gear cluster.
       Keyed on an <html> mark from footer-toggle.ts: a body-level :has() here made every inserted
       chat row restyle the whole page (2026-11-09). */
    html[data-kickflow-footer-entry] div:has(> #send-message-button)::before {
      content: ''; width: 30px; height: 30px; flex: 0 0 30px;
    }
    .kickflow-footer-toggle {
      position: relative; appearance: none; width: 30px; height: 30px; padding: 0; margin: 0;
      border: 0; border-radius: 6px; background: transparent; color: #b5bdb7; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background .12s ease, color .12s ease;
    }
    .kickflow-footer-toggle:hover { background: rgba(255,255,255,0.08); color: #eef2ef; }
    .kickflow-footer-toggle:focus-visible { outline: 2px solid #53fc18; outline-offset: 1px; }
    .kickflow-footer-toggle--active { color: #53fc18; background: rgba(83,252,24,0.10); }
    .kickflow-footer-toggle svg { width: 17px; height: 17px; display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .kickflow-footer-toggle__badge {
      position: absolute; top: 1px; right: 0;
      background: #ff6b5e; color: #1a0503; border-radius: 4px; box-shadow: 0 0 0 2px #0b0e0f;
      min-width: 15px; height: 15px; padding: 0 3px;
      font: 800 10px/1 Inter, 'Segoe UI', system-ui, sans-serif; font-variant-numeric: tabular-nums;
      display: flex; align-items: center; justify-content: center;
    }

    /* Body-level KickFlow mark (logo slot --kf-mark), aligned before the native navbar actions.
       34px matches the reserved slot below and the placement math in navbar-settings.ts. */
    html[data-kickflow-navbar-entry] nav > div:nth-child(3).flex.items-center.gap-2::before {
      content: ''; width: 34px; height: 34px; flex: 0 0 34px;
    }
    .kickflow-navbar-settings {
      appearance: none; width: 34px; height: 34px; padding: 0; margin: 0; border: 0;
      border-radius: 6px; background: transparent; color: transparent; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0; line-height: 0; overflow: hidden;
      transition: background .12s ease, transform .09s ease;
    }
    .kickflow-navbar-settings::before {
      content: ''; width: 28px; height: 28px; background: var(--kf-mark) center / contain no-repeat;
      transition: transform .12s ease;
    }
    .kickflow-navbar-settings:hover { background: rgba(255,255,255,.08); }
    .kickflow-navbar-settings:active { transform: scale(.94); }
    .kickflow-navbar-settings--active { background: rgba(83,252,24,.12); box-shadow: inset 0 0 0 1px rgba(83,252,24,.45); }
    .kickflow-navbar-settings:focus-visible { outline: 2px solid #53fc18; outline-offset: 2px; }

    /* --- Player controls, injected inline into Kick's native control bar.
       FINAL design 2026-10-18 (player-bar.html): KickFlow's controls sit on ONE plate, so it is clear what KickFlow adds,
       while every BUTTON keeps Kick's own geometry, read out of its bundle 2026-08-05:
         size-11 -> 44x44 box, bg-transparent at rest, 20px FILLED icons (fill-current),
         active:scale-[0.95], group gap 0 on desktop.
       The plate, the hover layer and the chip are pseudo-elements INSIDE those 44px boxes, so the
       geometry gate (tests/playwright/player-bar-visual.mjs) still sees native boxes and Kick's
       own controls never move. Nothing here animates while the player is idle. --- */
    .kickflow-player-group {
      position: relative; isolation: isolate;
      display: inline-flex; align-items: center; gap: 0;
      height: 44px;
      /* Kick's own bar buttons carry shrink-0 grow-0; ours match, so a squeezed bar never
         squashes a control instead of collapsing it into the overflow menu. */
      flex: none;
    }
    /* The plate: one glass piece across our consecutive groups. The behind-live chip joins it
       only while it shows; at the live edge its reserved box stays outside and invisible.
       The run's last group carries --plate-end, set by syncPlateRunEnds (bar-chrome.js). */
    .kickflow-player-group:is(:not(#kickflow-catchup-controls), .kickflow-player-group--chip)::before {
      content: ''; position: absolute; z-index: -1; inset: 4px 0;
      background: rgba(255,255,255,0.04);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.09); border-left-width: 0; border-right-width: 0;
      pointer-events: none;
    }
    .kickflow-player-group:is(:not(#kickflow-catchup-controls), .kickflow-player-group--chip):not(.kickflow-player-group + .kickflow-player-group)::before {
      border-left-width: 1px; border-top-left-radius: 12px; border-bottom-left-radius: 12px; left: 0;
    }
    .kickflow-player-group:is(:not(#kickflow-catchup-controls), .kickflow-player-group--chip).kickflow-player-group--plate-end::before {
      border-right-width: 1px; border-top-right-radius: 12px; border-bottom-right-radius: 12px;
    }
    /* Divider after the 10 s pair, as in the design. */
    #kickflow-rewind-controls::after {
      content: ''; width: 1px; height: 18px; margin: 0 3px; flex: none;
      background: rgba(255,255,255,0.16);
    }
    .kickflow-overflow-menu .kickflow-player-group::before,
    .kickflow-overflow-menu #kickflow-rewind-controls::after { display: none; }
    .kickflow-player-btn,
    .kickflow-speed-btn {
      appearance: none; position: relative;
      display: inline-flex; align-items: center; justify-content: center;
      margin: 0; border: 0; color: #f2f6f2; line-height: 1; white-space: nowrap; cursor: pointer;
      /* Kick's bar owns the type: inheriting is what makes the text sit native. */
      font: inherit; font-size: 14px; font-weight: 700;
      background: transparent;
      transition: color .12s ease, transform .09s ease;
    }
    .kickflow-player-btn {
      gap: 2px; height: 44px; min-width: 40px; padding: 0 9px; border-radius: 10px;
    }
    /* Hover and press draw a 36px rounded layer inside the 44px box, matching the plate. */
    .kickflow-player-btn:not(.kickflow-player-btn--live)::after,
    .kickflow-speed-btn::after {
      content: ''; position: absolute; z-index: -1; inset: 4px 1px; border-radius: 10px;
      background: transparent; transition: background .12s ease; pointer-events: none;
    }
    .kickflow-player-btn:not(.kickflow-player-btn--dim):hover::after,
    .kickflow-speed-btn:hover::after { background: rgba(255,255,255,0.12); }
    .kickflow-player-btn:not(.kickflow-player-btn--dim):active::after,
    .kickflow-speed-btn:active::after { background: rgba(255,255,255,0.18); }
    .kickflow-player-btn:active,
    .kickflow-speed-btn:active { transform: scale(0.95); }
    .kickflow-player-btn:focus-visible,
    .kickflow-speed-btn:focus-visible {
      outline: 2px solid #53fc18; outline-offset: -4px;
    }
    .kickflow-player-btn svg {
      width: 20px; height: 20px; display: block;
      fill: currentColor; fill-rule: evenodd; stroke: none;
    }
    .kickflow-player-btn svg text,
    .kickflow-seek-ripple svg text {
      font: 800 7.6px 'Segoe UI', system-ui, sans-serif; fill: currentColor;
    }
    /* 10 s forward at the live edge: nowhere to go, so it is dim (still focusable, a no-op). */
    .kickflow-player-btn--dim { opacity: 0.38; cursor: default; }
    /* The behind-live chip. At the live edge it takes no room at all, because Kick's own LIVE
       label already says live ("İkinci CANLI yok"). It is the LAST item of our plate, so when it
       appears nothing of Kick's or ours moves; native-bar.ts watches its size and re-plans the
       width budget before the next paint. */
    .kickflow-player-btn--live {
      display: none; padding: 0 10px 0 9px; gap: 6px; justify-content: flex-start;
      color: #ffc670; font-size: 13px; font-variant-numeric: tabular-nums;
    }
    .kickflow-player-btn--live::before {
      content: ''; position: absolute; z-index: -1; inset: 7px 3px; border-radius: 8px;
      background: rgba(16,13,8,0.32); box-shadow: inset 0 0 0 1px rgba(255,181,71,0.45);
      transition: background .12s ease; pointer-events: none;
    }
    .kickflow-player-btn--live:hover::before { background: rgba(16,13,8,0.42); }
    .kickflow-player-btn--live svg { width: 14px; height: 14px; }
    .kickflow-player-btn--live.kickflow-player-btn--behind { display: inline-flex; }
    .kickflow-live-chip__go {
      padding-left: 7px; border-left: 1px solid rgba(255,198,112,0.35); font-weight: 600;
    }
    .kickflow-speed-btn {
      height: 44px; min-width: 52px; padding: 0 10px; gap: 5px; border-radius: 10px;
      font-variant-numeric: tabular-nums;
    }
    .kickflow-speed-btn__auto {
      font-size: 11px; font-weight: 600; letter-spacing: .06em; color: #f2f6f2;
    }
    .kickflow-speed-btn svg.kickflow-speed-btn__bolt {
      width: 15px; height: 15px; fill: #53fc18; stroke: none;
    }
    .kickflow-speed-btn--catch { color: #c8ffb2; }
    .kickflow-speed-btn--catch .kickflow-speed-btn__auto { color: inherit; }
    .kickflow-speed-btn--manual { color: #c8ffb2; }
    .kickflow-speed-btn--manual::after {
      inset: 6px 1px; border-radius: 9px;
      background: rgba(83,252,24,0.10); box-shadow: inset 0 0 0 1px rgba(83,252,24,0.42);
    }

    /* Player bar 2026-10-22: transparent at the top, 60% dark at the bottom;
       hover/focus deepens the same fade. Only the middle controls retain a blurred plate.
       Override Kick's background too, so the two fades do not stack. Geometry is unchanged. */
    div.z-controls.bottom-0 {
      isolation: isolate; background-image: none; background-color: transparent;
    }
    div.z-controls.bottom-0:is(:hover, :focus-within) { --kickflow-bar-shade: 0.70; }
    div.z-controls.bottom-0::after {
      content: ''; position: absolute; z-index: -2; left: 0; right: 0; bottom: 0; height: 9rem;
      background: linear-gradient(to top, rgba(0,0,0,var(--kickflow-bar-shade, 0.60)) 0, rgba(0,0,0,var(--kickflow-bar-shade, 0.60)) 4.5rem, rgba(0,0,0,0) 9rem);
      pointer-events: none;
    }
    /* Bottom-area reveal owns both the native strip and the floating overlay controls. */
    [data-kickflow-controls]:focus-visible { outline: 2px solid #53fc18; outline-offset: -2px; }
    [data-kickflow-controls="hidden"] :is(div.z-controls, .kickflow-player-menu) {
      opacity: 0 !important; visibility: hidden !important; pointer-events: none !important;
    }
    [data-kickflow-controls="shown"] div.z-controls.bottom-0 {
      opacity: 1 !important; visibility: visible !important; pointer-events: auto !important;
    }
    /* Current Kick nests the 80px customized bar in a 44px clipping shelf; controls-visibility
       marks that shelf (it was a div:has(> bar) rule, a page-wide restyle per chat row). */
    [data-kickflow-controls] [data-kickflow-bar-shelf] { overflow: visible !important; }
    html[data-kickflow-strip] div.z-controls.bottom-0 {
      padding: 26px 18px 10px;
      background-image: none; background-color: transparent;
    }
    html[data-kickflow-strip] div.z-controls.bottom-0::before {
      content: none;
    }
    /* The seek line moves inside the capsule, above the buttons. */
    html[data-kickflow-strip] div.z-controls.bottom-0 [class*="group/seekbar"] {
      top: 4px; left: 26px; right: 26px; width: auto;
    }
    /* Flat bar (flag off or Kick renamed its bar): our plate carries its own darker fill. No blur
       here: each group would blur on its own and show seams between the pieces. */
    html:not([data-kickflow-strip]) .kickflow-player-group:is(:not(#kickflow-catchup-controls), .kickflow-player-group--chip)::before {
      background: rgba(10,13,11,0.72);
    }
    /* Behind live, the unwatched part of the seek line turns into an amber dashed gap (FINAL 6.3,
       moment 1): ours and Kick's own track, keyed on the chip being shown. The bar showing the chip
       sets data-kickflow-behind (KickFlow bar) / data-fallback-bar-behind (a fallback player bar) on <html>.
       2026-11-09: this used to be a descendant :has() on the bar keyed on the behind chip, with the
       Kick seek line matched by two class-substring selectors (group/seekbar, then bg-subtle). A class-substring
       selector LEFT of a combinator makes Chrome restyle every classed descendant whenever any
       element's class changes; that one rule made each style recalculation on a Kick page 40-90x
       slower (measured: forced recalc 0.9 ms without it, 60-160 ms with it), and Kick's chat pays it on
       every message. Keep [class*=...] only in the rightmost compound; match ancestors by class. */
    html[data-kickflow-behind] div.z-controls.bottom-0 .kickflow-seek-bar__track,
    html[data-kickflow-behind] div.z-controls.bottom-0 .group\\/seekbar [class*="bg-subtle"],
    html[data-fallback-bar-behind] div.z-controls.bottom-0 .kickflow-seek-bar__track,
    html[data-fallback-bar-behind] div.z-controls.bottom-0 .group\\/seekbar [class*="bg-subtle"] {
      background: repeating-linear-gradient(90deg, #ffb547 0 4px, rgba(255,181,71,0) 4px 7px);
    }

    /* --- Seek bar. The geometry and colours come from Kick's OWN utility classes, which the
       element carries; this sheet is adopted and therefore wins the cascade, so it must only
       declare what Kick does not, or it would defeat the parity it is here to preserve.
       Declared here: the thumb's placement and hover reveal, and the hover thickening — all of
       which Kick expresses through variants (group-hover, betterhover) we cannot rely on. --- */
    .kickflow-seek-bar { cursor: pointer; touch-action: none; }
    .kickflow-seek-bar[hidden] { display: none; }
    .kickflow-seek-bar__track { transition: height .12s ease; }
    .kickflow-seek-bar:hover .kickflow-seek-bar__track { height: 6px; }
    .kickflow-seek-bar__range { transition: none; }
    /* 16px thumb centred on the 4px track that sits at the bar's bottom edge:
       half the thumb (8) minus half the track (2) = 6px below it. */
    .kickflow-seek-bar__thumb {
      bottom: -6px; margin-left: -8px; display: none; pointer-events: none;
    }
    .kickflow-seek-bar:hover .kickflow-seek-bar__thumb { display: block; }
    /* Only painted when Kick's utility classes stopped resolving. Values measured from Kick's
       stylesheet 2026-08-05: bg-subtle/50 #929ea680, bg-green-500 / bg-primary-base #53fc18. */
    .kickflow-seek-bar--fallback { position: absolute; top: -28px; left: 0; width: 100%; height: 20px; }
    .kickflow-seek-bar--fallback .kickflow-seek-bar__track {
      position: absolute; bottom: 0; left: 0; width: 100%; height: 4px; background: #929ea680;
    }
    .kickflow-seek-bar--fallback .kickflow-seek-bar__range {
      position: absolute; height: 100%; background: #53fc18;
    }
    .kickflow-seek-bar--fallback .kickflow-seek-bar__thumb {
      position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #53fc18;
    }
    /* One popup shell for every player menu (player-menu.ts); the menu's own class adds only
       what is specific to it. Glass over video, as in the FINAL design. */
    .kickflow-player-menu {
      position: fixed; z-index: 2147483647; padding: 8px;
      border: 0; border-radius: 14px;
      background: rgba(10,13,11,0.86); color: #f2f6f2;
      -webkit-backdrop-filter: blur(16px) saturate(140%); backdrop-filter: blur(16px) saturate(140%);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.11), inset 0 1px 0 rgba(255,255,255,0.07), 0 16px 40px rgba(0,0,0,0.5);
      font-family: 'Inter','Segoe UI Variable','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-player-kbd {
      display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px;
      border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; background: rgba(255,255,255,0.08);
      color: #fff; font: 700 11px/1 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-speed-menu { width: 248px; }
    .kickflow-speed-menu__head {
      display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 8px;
      font-size: 12px; font-weight: 600; color: rgba(242,246,242,0.62);
    }
    .kickflow-speed-menu__auto {
      appearance: none; display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 8px 10px; border: 0; border-radius: 10px; background: rgba(255,255,255,0.06);
      color: inherit; cursor: pointer; text-align: left; font: inherit;
    }
    .kickflow-speed-menu__auto:hover { background: rgba(255,255,255,0.10); }
    .kickflow-speed-menu__auto:focus-visible,
    .kickflow-speed-menu__item:focus-visible { outline: none; box-shadow: 0 0 0 2px #53fc18; }
    .kickflow-speed-menu__auto-text { flex: 1; display: grid; gap: 2px; }
    .kickflow-speed-menu__auto-text b { font-size: 14px; }
    .kickflow-speed-menu__auto-text small { font-size: 12px; line-height: 1.3; color: rgba(242,246,242,0.62); }
    .kickflow-switch {
      position: relative; flex: none; width: 38px; height: 22px; border-radius: 11px;
      background: rgba(255,255,255,0.18); transition: background .12s ease;
    }
    .kickflow-switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
      background: #f2f6f2; transition: transform .12s ease;
    }
    .kickflow-speed-menu__auto[aria-checked="true"] .kickflow-switch { background: #53fc18; }
    .kickflow-speed-menu__auto[aria-checked="true"] .kickflow-switch::after { transform: translateX(16px); background: #071a04; }
    .kickflow-speed-menu__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 8px; }
    .kickflow-speed-menu__item {
      appearance: none; min-height: 36px; padding: 0; border: 0; border-radius: 8px;
      background: rgba(255,255,255,0.04); color: inherit; cursor: pointer;
      font: 700 14px/1 'Inter','Segoe UI',system-ui,sans-serif; font-variant-numeric: tabular-nums;
    }
    .kickflow-speed-menu__item:hover:not([aria-checked="true"]) { background: rgba(255,255,255,0.10); }
    .kickflow-speed-menu__item[aria-checked="true"] { background: #53fc18; color: #071a04; }
    .kickflow-speed-menu__hint { padding: 8px 4px 2px; font-size: 12px; color: rgba(242,246,242,0.55); }
    /* The overflow ("Diğer") menu holds the REAL control elements as rows, each with its name
       and key, so no control gets a second implementation. */
    .kickflow-overflow-menu {
      display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 232px;
    }
    .kickflow-overflow-menu__row {
      display: flex; align-items: center; gap: 8px; padding-right: 8px; border-radius: 8px;
    }
    .kickflow-overflow-menu__row:hover { background: rgba(255,255,255,0.08); }
    .kickflow-overflow-menu__row > .kickflow-player-group { flex: none; }
    .kickflow-overflow-menu__name { flex: 1; font-size: 13px; font-weight: 600; color: #f2f6f2; white-space: nowrap; }
    .kickflow-overflow-menu .kickflow-player-btn--live { display: inline-flex; }
    /* Seek feedback: a glass circle for half a second (rewind-controls.ts showSeekRipple). */
    .kickflow-seek-ripple {
      position: absolute; z-index: 2147483646; top: 42%; width: 112px; height: 112px; margin-top: -56px;
      display: grid; place-items: center; align-content: center; gap: 2px; border-radius: 50%;
      background: rgba(10,12,11,0.45); color: #fff; pointer-events: none;
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
      font: 700 14px/1 'Inter','Segoe UI',system-ui,sans-serif;
      animation: kickflow-ripple .5s cubic-bezier(.22,1,.36,1) both;
    }
    .kickflow-seek-ripple svg { width: 32px; height: 32px; fill: currentColor; }
    .kickflow-seek-ripple--back { left: 15%; }
    .kickflow-seek-ripple--forward { right: 15%; }
    @keyframes kickflow-ripple {
      0% { opacity: 0; transform: scale(.85); } 25% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.05); }
    }
    /* Screenshot: one toast above the strip (screenshot.ts showFrameToast). */
    .kickflow-frame-toast {
      position: absolute; z-index: 2147483646; right: 14px; bottom: 96px;
      display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 10px;
      background: rgba(10,13,11,0.86); color: #f2f6f2; pointer-events: none;
      -webkit-backdrop-filter: blur(16px) saturate(140%); backdrop-filter: blur(16px) saturate(140%);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.11), 0 10px 30px rgba(0,0,0,0.45);
      font-family: 'Inter','Segoe UI Variable','Segoe UI',system-ui,sans-serif;
      animation: kickflow-toast-in .18s cubic-bezier(.22,1,.36,1) both;
    }
    .kickflow-frame-toast__thumb { width: 64px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; box-shadow: 0 0 0 1px rgba(255,255,255,0.2); }
    .kickflow-frame-toast__text { display: grid; gap: 3px; }
    .kickflow-frame-toast__text b { font-size: 13px; }
    .kickflow-frame-toast__text small { font-size: 12px; color: rgba(242,246,242,0.62); }
    .kickflow-capture-status, .kickflow-clip-preview {
      position: absolute; z-index: 2147483646; right: 14px; bottom: 104px;
      max-width: min(320px, calc(100% - 28px)); border-radius: 8px; padding: 12px;
      background: #121713; color: #f2f6f2; font: 13px/1.5 system-ui, sans-serif;
      box-shadow: 0 0 0 1px #465047;
    }
    .kickflow-capture-status { pointer-events: none; }
    .kickflow-clip-preview { display: grid; gap: 8px; pointer-events: auto; }
    .kickflow-clip-preview video { width: 100%; max-height: 180px; }
    .kickflow-clip-preview small { overflow-wrap: anywhere; }
    .kickflow-clip-preview a, .kickflow-clip-preview button {
      padding: 8px 12px; border-radius: 4px; background: #285c27; color: #f2f6f2; text-align: center;
    }
    .kickflow-clip-preview :focus-visible { outline: 2px solid #53fc18; outline-offset: 2px; }
    @keyframes kickflow-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .kickflow-seek-ripple, .kickflow-frame-toast { animation: none; }
      .kickflow-player-btn, .kickflow-speed-btn, .kickflow-switch, .kickflow-switch::after { transition: none; }
    }
    .kickflow-speed-warning {
      position: fixed; left: 50%; bottom: 92px; transform: translateX(-50%);
      z-index: 2147483647; padding: 7px 11px; border-radius: 6px;
      background: rgba(18,20,24,0.96); color: #ffcf66;
      border: 1px solid rgba(255,207,102,0.35); box-shadow: 0 8px 24px rgba(0,0,0,0.38);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif; font-size: 12px; font-weight: 700;
      line-height: 1; white-space: nowrap;
    }
    /* Layout for a bar drawn when Kick's own control strip is absent.
       The same text is FALLBACK_BAR_CSS in player/bar-chrome.js. Colours and
       the 44px boxes stay on the rules above. */
.kickflow-fallback-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  min-height: 44px;
  pointer-events: auto;
}
.kickflow-fallback-bar input[type="range"] {
  width: 72px;
  margin: 0 8px;
  flex: 0 0 auto;
  accent-color: var(--kf-green, #53fc18);
  cursor: pointer;
}
.kickflow-fallback-spacer {
  flex: 1 1 auto;
  min-width: 8px;
}
/* Our display rules would otherwise beat the hidden attribute (quality chip, PiP, overflow). */
.kickflow-fallback-bar [hidden] { display: none !important; }
.kickflow-quality-btn {
  gap: 6px;
}
.kickflow-quality-btn__sub {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
  color: rgba(242,246,242,0.72);
}
.kickflow-quality-btn--held { color: #c8ffb2; }
.kickflow-quality-btn--held .kickflow-quality-btn__sub { color: inherit; }
.kickflow-quality-btn--held::after {
  inset: 6px 1px;
  border-radius: 9px;
  background: rgba(83,252,24,0.10);
  box-shadow: inset 0 0 0 1px rgba(83,252,24,0.42);
}
.kickflow-quality-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 248px;
}
.kickflow-quality-menu__head {
  padding: 2px 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(242,246,242,0.62);
}
.kickflow-quality-menu__item {
  appearance: none;
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: 600 14px/1 'Inter','Segoe UI',system-ui,sans-serif;
  font-variant-numeric: tabular-nums;
}
.kickflow-quality-menu__item:hover:not([aria-checked="true"]) {
  background: rgba(255,255,255,0.10);
}
.kickflow-quality-menu__item[aria-checked="true"] {
  background: #53fc18;
  color: #071a04;
}
.kickflow-quality-menu__item:focus-visible,
.kickflow-quality-menu__more:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #53fc18;
}
.kickflow-quality-menu__intent {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  min-height: 44px;
  padding: 6px 10px;
}
.kickflow-quality-menu__intent b { font-size: 14px; font-weight: 700; }
.kickflow-quality-menu__intent small {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: rgba(242,246,242,0.62);
}
.kickflow-quality-menu__intent[aria-checked="true"] small { color: rgba(7,26,4,0.75); }
.kickflow-quality-menu__sep {
  height: 1px;
  margin: 4px 0;
  background: rgba(220,255,226,0.16);
}
.kickflow-quality-menu__more {
  appearance: none;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(242,246,242,0.72);
  cursor: pointer;
  text-align: left;
  font: 600 13px/1 'Inter','Segoe UI',system-ui,sans-serif;
}
.kickflow-quality-menu__more:hover { background: rgba(255,255,255,0.08); }
.kickflow-quality-menu__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 4px;
}
.kickflow-quality-menu__grid[hidden] { display: none; }
.kickflow-quality-menu__exact {
  justify-content: center;
  padding: 0;
  background: rgba(255,255,255,0.04);
  text-align: center;
}

    ${THREAD_PANEL_CSS}
  `;
  adoptedStyleSheet = installStyleSheet(css);
  stylesInstalled = true;
}

/** Adopts `css` and returns the sheet, or falls back to a `<style>` element and returns null.
 *
 * The fallback exists for one reason: jsdom has no `adoptedStyleSheets`, so without it the whole
 * test suite would crash on boot. Chrome always takes the adoption path — which is the one that
 * keeps a node out of React's hydration tree. Exported so both branches are covered by tests. */
export function installStyleSheet(css: string): CSSStyleSheet | null {
  const adopted = document.adoptedStyleSheets as CSSStyleSheet[] | undefined;
  if (adopted && typeof CSSStyleSheet === 'function') {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...adopted, sheet];
      return sheet;
    } catch (error) {
      logger.info('bootstrap: constructable stylesheet unavailable, falling back to <style>', error);
    }
  }
  if (document.getElementById(FALLBACK_STYLE_ID)) return null;
  const style = document.createElement('style');
  style.id = FALLBACK_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  return null;
}

/** Drops KickFlow's CSS from the page. Only zombie teardown needs this — an ordinary session end
 * keeps the styles, because the next channel mounts the same UI. */
function removeStyles(): void {
  if (!stylesInstalled) return;
  stylesInstalled = false;
  const sheet = adoptedStyleSheet;
  adoptedStyleSheet = null;
  if (sheet) {
    document.adoptedStyleSheets = (document.adoptedStyleSheets as CSSStyleSheet[])
      .filter((entry) => entry !== sheet);
    return;
  }
  document.getElementById(FALLBACK_STYLE_ID)?.remove();
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
  // Kick pauses the list while the reader is scrolled up and its pill does not say how much is waiting.
  const pausePill = new NativePausePillCounter(lifecycle);
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message) => {
      augmenter?.forgetGhost(message.id);
      // A mounted native row must lose its stale strike/status immediately when the preserved
      // TTL/cap releases it; forgetGhost only covers rows that Kick removed from the list.
      augmenter?.markById(message.id);
    },
    onMessageAdded: (message) => {
      pausePill.noteMessage();
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
    startNativeVodArchiveFeed(context, lifecycle, store);
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

/** Mode B on a VOD renders nothing of its own — Kick's replay owns the DOM. This mirrors the same
 * replay messages into the store (and through it the archive) so the dashboard's search can find
 * a line the reader scrolled past. Nothing here touches a row: no render, no marking.
 *
 * `onReset` is deliberately NOT wired to clear anything. A seek resets what Kick DISPLAYS; it does
 * not un-see what the reader already watched, and the archive is the record of that. */
function startNativeVodArchiveFeed(
  context: Extract<ChatSessionContext, { kind: 'vod' }>,
  lifecycle: Lifecycle,
  store: ChatIntegrityStore,
): void {
  void resolveChannel(context.slug).then((resolved) => {
    if (lifecycle.isDisposed || !resolved) return;
    const replay = new VodChatReplayController(
      lifecycle,
      resolved.channelId,
      context.videoId,
      {
        onReset: () => undefined,
        onMessages: (messages) => {
          let archived = 0;
          for (const message of messages) {
            if (store.addMessage(message)) archived += 1;
          }
          logger.debug('vod-archive-feed: archived', archived, 'of', messages.length);
        },
        onReady: () => undefined,
        onUnavailable: () => undefined,
      },
    );
    void replay.start();
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
  startChatWithRetries(lifecycle, (attempt, controls) => initOwnChatAttempt(context, attempt, panel, controls));
}

function initOwnChatAttempt(
  context: ChatSessionContext,
  lifecycle: Lifecycle,
  panel: RemovedMessagesPanel,
  startup: ChatStartupAttempt,
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
  // Kick's side-conversation panel: dressed and placed in the chat column, and a click on one of
  // its messages jumps to that message in KickFlow's list (native-thread.ts).
  installNativeThreadPanel(lifecycle, (messageId, cue) => { jumpToMessage(messageId, cue); });
  let wasReady = false;
  const markReady = (): void => {
    if (mount.state !== 'active') return;
    wasReady = true;
    startup.ready();
  };
  const ownList = mount.ownList;

  const scrollPill = document.createElement('button');
  scrollPill.type = 'button';
  scrollPill.className = 'kickflow-scroll-pill';
  scrollPill.textContent = t('chat.new_messages');
  scrollPill.style.display = 'none';
  scrollPill.style.pointerEvents = 'auto';
  const hoverMeter = context.kind === 'live' ? new HoverReleaseMeter() : null;
  let hovered = false;
  let renderQueue: RenderQueue | null = null;
  let pendingCount = 0;
  let scrollFollow: ScrollFollowController;
  let pillShownAtMs = 0;
  let pillHideTimerId: number | null = null;
  /** Mode A pinned follow: not hovered → auto; hovered + browser-smooth → smooth; hovered + instant → auto. */
  const resolveModeAScrollFollowBehavior = (isHovered: boolean): ScrollFollowBehavior => {
    if (!isHovered) return 'auto';
    return featureFlags.hoverFollowMode === 'instant' ? 'auto' : 'smooth';
  };
  const cancelPillHide = (): void => {
    if (pillHideTimerId === null) return;
    window.clearTimeout(pillHideTimerId);
    pillHideTimerId = null;
  };
  lifecycle.add(cancelPillHide);

  const hidePendingPill = (): void => {
    scrollPill.textContent = t('chat.new_messages');
    scrollPill.style.display = 'none';
  };

  /** Hides only after the pill has been readable for a moment. On a quiet channel the metered
   * backlog oscillates 1 → 0 → 1 every release interval, and hiding on each zero made the pill
   * blink instead of inform. */
  const schedulePillHide = (): void => {
    if (pillHideTimerId !== null) return;
    const remaining = Math.max(0, PILL_MIN_VISIBLE_MS - (Date.now() - pillShownAtMs));
    pillHideTimerId = window.setTimeout(() => {
      pillHideTimerId = null;
      if (pendingCount > 0 && hovered && scrollFollow.isPinned) return;
      hidePendingPill();
    }, remaining);
  };

  function updatePendingPill(nextCount: number): void {
    pendingCount = nextCount;
    if (!hoverMeter) return;
    const pinned = scrollFollow.isPinned;
    const visible = scrollPill.style.display !== 'none';
    // A single queued message is not a backlog — it is on screen 250 ms later either way, so the
    // pill stays out of the way until there is something worth flushing. Once up, it keeps
    // counting down through 1 rather than vanishing mid-drain.
    if (pinned && nextCount > 0 && (visible || (hovered && nextCount >= PILL_MIN_PENDING))) {
      cancelPillHide();
      scrollPill.textContent = t('chat.new_messages_count', {
        n: nextCount,
        count: formatNumber(nextCount),
      });
      if (!visible) pillShownAtMs = Date.now();
      scrollPill.style.display = '';
      return;
    }
    // Deliberately NOT gated on `hovered`: the pointer leaving is exactly when the backlog drains
    // to zero, and requiring hover here would leave the pill on screen showing the last count it
    // had. Still gated on `isPinned`, because a reader who scrolled up owns the pill.
    if (pinned && visible) schedulePillHide();
  }
  scrollFollow = new ScrollFollowController(ownList, {
    onPinnedChange: (pinned) => {
      if (pinned) scrollPill.style.display = 'none';
      hoverMeter?.setMetered(hovered && pinned);
      renderQueue?.wake();
      if (pinned) updatePendingPill(renderQueue?.pendingCount ?? pendingCount);
    },
    getScrollFollowBehavior: () => resolveModeAScrollFollowBehavior(hovered),
  });
  lifecycle.add(() => scrollFollow.dispose());
  const hoverFollow = attachScrollFollowHover(ownList, scrollFollow, {
    hoverContinuationSelector: '.kickflow-user-card, [data-kickflow-native-quick-emotes]',
    getHoveredBehavior: () => resolveModeAScrollFollowBehavior(true),
    onHoverChange: (nextHovered) => {
      hovered = nextHovered;
      hoverMeter?.setMetered(nextHovered && scrollFollow.isPinned);
      renderQueue?.wake();
      updatePendingPill(renderQueue?.pendingCount ?? pendingCount);
    },
    onPointerLeave: hoverMeter ? () => renderQueue?.flushPending() : undefined,
  });
  lifecycle.add(() => hoverFollow.dispose());
  scrollPill.addEventListener('click', () => {
    renderQueue?.flushPending();
    scrollFollow.scrollToBottom();
    scrollPill.style.display = 'none';
  });
  mount.root.appendChild(scrollPill);
  lifecycle.add(() => scrollPill.remove());

  let vodStartTimeMs: number | null = null;
  const queue = new RenderQueue({
    getContainer: () => mount.getRenderContainer(),
    registry,
    releasePolicy: hoverMeter ?? undefined,
    // A delete can arrive while its ChatMessageEvent is waiting in RenderQueue's 250ms batch.
    // Only render objects that this session's store still owns: this drops those removed-before-
    // flush rows and also prevents a replayed Pusher/history id from creating a duplicate row.
    shouldRender: (message) => store.getMessageById(message.id) === message,
    onOpenRemovedPanel: () => panel.showSettings('removed'),
    onReply: context.kind === 'live'
      ? (message, cue) => { if (!lifecycle.isDisposed) requestNativeReply(message, cue, context.sessionKey); }
      : undefined,
    onPendingChange: updatePendingPill,
    formatTimestamp: context.kind === 'vod'
      ? (message) => vodStartTimeMs === null
        ? ''
        : formatVodReplayTimestamp(message.createdAt, vodStartTimeMs)
      : undefined,
    onFlush: (appended /*, wasAtBottom */) => {
      mount.noteContentAppended(appended);
      if (mount.state === 'active') {
        markReady();
        setStatus({
          active: true,
          pusherConnected: context.kind === 'live' ? getStatus().pusherConnected : false,
          reason: context.kind === 'vod'
            ? t('status.active_vod_replay')
            : t('status.active_own'),
        });
      }

      const decision = hoverFollow.decide(appended.length);
      // A pinned list that snaps instantly to the bottom right after the trim needs no offset
      // correction; checked after preserveScrollIntent has read any pending upward scroll.
      const snapsAfterTrim = (): boolean => decision.scrollToBottom && decision.scrollBehavior === 'auto' && scrollFollow.isPinned;
      scrollFollow.preserveScrollIntent(() => trimMessageWindow(ownList, registry, decision.trimCap, () => !snapsAfterTrim()));
      scrollFollow.observeRows(appended);
      hoverFollow.apply(decision);
      if (decision.showPill) {
        scrollPill.textContent = t('chat.new_messages');
        scrollPill.style.display = '';
      } else if (decision.scrollToBottom && (hoverMeter === null || !hovered || renderQueue?.pendingCount === 0)) {
        scrollPill.style.display = 'none';
      }
    },
  });
  renderQueue = queue;
  lifecycle.add(() => queue.dispose());
  lifecycle.setInterval(() => {
    store.sweepExpiredPreserved();
    archive.sweepExpired();
  }, PRESERVED_SWEEP_INTERVAL_MS);

  const enqueueOnce = (message: ChatMessage): void => {
    if (store.addMessage(message)) queue.enqueue(message);
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

  const failed = (): void => startup.fail(() => {
    mount.showFailure();
    setStatus({ active: false, reason: t('status.content_not_ready') });
  });

  const start = (): void => { void resolveChannel(slug, lifecycle).then(async (resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      mount.failOpen('channel-resolution-failed');
      failed();
      setStatus({ active: false, reason: t('status.chatroom_unresolved_native') });
      return;
    }
    setSubscriberBadges(resolved.subscriberBadges);
    const { chatroomId, channelId } = resolved;
    // Resolution alone can take 20.4 seconds. The old 15-second deadline fired
    // before it finished, leaving a stale failure banner over healthy native chat.
    lifecycle.setTimeout(() => {
      if (!wasReady && mount.state !== 'active') { mount.failOpen('startup-not-ready'); failed(); }
    }, INITIAL_NO_CONTENT_FALLBACK_MS);
    setStatus({
      chatroomId,
      pusherConnected: false,
      reason: context.kind === 'vod'
        ? t('status.vod_replay_loading')
        : t('status.pusher_connecting'),
    });

    if (context.kind === 'vod') {
      const resetReplayWindow = (): void => {
        queue.clearPending();
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
            markReady();
            setStatus({
              active: mount.state === 'active',
              pusherConnected: false,
              reason: t('status.active_vod_replay'),
            });
          },
          onUnavailable: () => {
            mount.failOpen('vod-replay-unavailable');
            failed();
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
    let outage: OutageBoundary | null = null;
    let historyLoaded = false;
    const clearReconnectGrace = (): void => {
      if (reconnectGraceTimer === null) return;
      window.clearTimeout(reconnectGraceTimer);
      reconnectGraceTimer = null;
    };
    lifecycle.add(clearReconnectGrace);
    const historyBackfill = new ChatHistoryBackfill(channelId, {
      isDisposed: () => lifecycle.isDisposed,
      onMessages: (history) => {
        const times = Array.from(ownList.querySelectorAll<HTMLElement>('[data-created-at]'))
          .map((row) => Date.parse(row.dataset.createdAt!)).filter(Number.isFinite);
        const oldest = historyLoaded && times.length > 0 ? Math.min(...times) : null;
        const plan = planBackfill(history, oldest, outage);
        if (plan.gap && outage) {
          const gap = plan.gap;
          enqueueOnce({
            id: `gap:${outage.lastId}`, chatroomId, type: 'system',
            createdAt: new Date(Math.max(gap.at, oldest ?? gap.at)).toISOString(), content: '',
            sender: { id: 0, username: 'KickFlow', slug: 'kickflow', identity: { color: '', badges: [], badgesV2: [] } },
            preserved: false, systemEvent: { kind: 'gap', estimatedCount: gap.count, seconds: gap.seconds },
          });
        }
        outage = null;
        historyLoaded = true;
        for (const message of plan.messages) {
          // History is fetched for this resolved channel, but its newer payloads can carry
          // channel_id instead of chatroom_id. Bind the reply target to the known room here;
          // a channel id must never be mistaken for a chatroom id or left as the parser's 0.
          enqueueOnce({ ...message, chatroomId });
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
        markReady();
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
        if (!wasReady) failed();
        setStatus({
          pusherConnected: false,
          active: false,
          reason: t('status.primary_unavailable', { reason }),
        });
      },
      onDisconnected: () => {
        outage ??= captureOutage(store.getMessagesInArrivalOrder());
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
          failed();
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
  }).catch((error) => {
    if (lifecycle.isDisposed) return;
    logger.warn('bootstrap: chat startup attempt failed', error);
    mount.failOpen('startup-exception');
    failed();
  }); };
  mount.setRetryHandler(startup.retry);
  start();
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
  seekBar: initSeekBar,
  liveCatchup: initLiveCatchup,
  qualityLock: initQualityLock,
  screenshot: initScreenshot,
  speedControls: initSpeedControls,
  ultrawideFill: initUltrawideFill,
  ambientBands: initAmbientBands,
  loudnessLeveler: initLoudnessLeveller,
  channelVolume: initChannelVolume,
};

let playerSessionLifecycle: Lifecycle | null = null;
const playerFeatureLifecycles = new Map<PlayerFeatureFlagKey, Lifecycle>();

/** Review K-3 (2026-11-24): the quality controller also runs without its chip while "always
 * highest" is on, so switching the quality button off no longer silently ends that setting. */
function playerFeatureEnabled(key: PlayerFeatureFlagKey): boolean {
  return key === 'qualityLock' ? featureFlags.qualityLock || featureFlags.qualityAlwaysBest : featureFlags[key];
}

/** Whether the running quality controller was started with its chip (featureFlags.qualityLock). */
let qualityControllerChip: boolean | null = null;

function syncPlayerFeature(key: PlayerFeatureFlagKey): void {
  const session = playerSessionLifecycle;
  let active = playerFeatureLifecycles.get(key);
  const liveOnlyOnRecording = key === 'liveCatchup'
    && parseChatSessionContext(window.location.pathname)?.kind === 'vod';
  if (!playerFeatureEnabled(key) || !session || session.isDisposed || liveOnlyOnRecording) {
    active?.dispose();
    playerFeatureLifecycles.delete(key);
    return;
  }
  // The chip is mounted at start: a controller started without it (or with it) restarts when
  // the quality button is switched on (or off) while "always highest" keeps it running.
  if (key === 'qualityLock' && active && !active.isDisposed && qualityControllerChip !== featureFlags.qualityLock) {
    active.dispose();
    playerFeatureLifecycles.delete(key);
    active = undefined;
  }
  if (active && !active.isDisposed) return;
  if (key === 'qualityLock') qualityControllerChip = featureFlags.qualityLock;

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
      initControlsVisibility(lifecycle);
      initBarOrder(lifecycle);
      initRewindHotkeys(lifecycle);
      for (const key of PLAYER_FEATURE_KEYS) syncPlayerFeature(key);
    },
    { resolve: getVideoElement },
  );
}

let currentLifecycle: Lifecycle | null = null;
let activeQuickEmoteBar: NativeQuickEmoteBar | null = null;
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
  void initContentBlocking(lifecycle);
  initAutoClaimDrops(lifecycle);
  initAutoClaimDailyReward(lifecycle);
  initChannelAvatarPreview(lifecycle);
  void initCategoryLanguageChip(lifecycle);
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

  activeQuickEmoteBar = new NativeQuickEmoteBar(lifecycle, () => featureFlags.hideQuickEmoteBar);
  lifecycle.add(() => { activeQuickEmoteBar = null; });

  // Player QoL and chat integrity are started concurrently and never gate each other.
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
  // A dead extension context can leave the session lifecycle undisposed, and a stale archive
  // would answer searches with a channel the reader has already left.
  configureUserMessageArchive(null);
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.querySelector('.kickflow-panel')?.remove();
  document.getElementById('kickflow-footer-toggle')?.remove();
  document.getElementById('kickflow-navbar-settings')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');
  document.documentElement.removeAttribute(QUALITY_ATTRIBUTE);
  removeStyles();
}

/** Named so extension-reload zombie teardown can remove the page-event route too. */
function onWindowFlagChange(event: Event): void {
  const detail = (event as CustomEvent<{
    key: string;
    value: boolean | string;
    onSaved?: (ok: boolean) => void;
  }>).detail;
  if (detail && typeof detail.key === 'string') {
    void applyFlagChange(detail.key, detail.value).then((ok) => {
      if (typeof detail.onSaved === 'function') detail.onSaved(ok);
    });
  }
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
export function applyFlagChange(key: string, value: boolean | string): Promise<boolean> {
  if (isBooleanFlagKey(key) && typeof value === 'boolean') {
    setFeatureFlag(key, value);
    if (key === 'hideQuickEmoteBar') activeQuickEmoteBar?.sync();
    if (key === 'speedControls' && !value) deactivateSpeedControls();
    if (key === 'showDeletedMessages' || key === 'preserveBansInline') reconcileActiveNativeChat();
    if (key === 'debugLogging') {
      setDebugLogging(value);
      syncLayoutWatchdog();
    }
    if (key === 'autoTheater') syncAutoTheaterFlag();
    if (key === 'contentBlocking') syncContentBlocking();
    if (key === 'fullscreenTerminal' || key === 'floatingStrip') syncBarOrderFlag();
    if (key === 'autoClaimDrops') syncAutoClaimDropsFlag();
    if (key === 'autoClaimDailyReward') syncAutoClaimDailyRewardFlag();
    if (key === 'qualityLock') syncQualityAttribute();
    if (key === 'qualityAlwaysBest') {
      syncQualityAttribute();
      syncPlayerFeature('qualityLock');
      notifyQualityModeChanged();
    }
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
    return safeStorageSet({ ['kf_flag_' + key]: value });
  } else if (isStringFlagKey(key)) {
    const parsed = parseStringFlag(key, value);
    if (parsed === null) return Promise.resolve(false);
    setFeatureFlag(key, parsed);
    if (key === 'chatMode') {
      if (currentSessionContext) {
        stopSession();
        resetStatus(currentSessionContext.slug);
        startSession(currentSessionContext);
      }
    } else if (key === 'qualityMode') {
      syncQualityAttribute();
      notifyQualityModeChanged();
    } else if (key === 'aspectMode') {
      syncAspectMode();
    } else if (key !== 'hoverFollowMode') {
      if (key === 'manualUsername') invalidateOwnerIdentityCache();
      refreshMessageHighlights();
      reconcileActiveNativeChat();
    }
    return safeStorageSet({ ['kf_flag_' + key]: parsed });
  }
  return Promise.resolve(false);
}

export function getPopupFeatureFlags(): Omit<FeatureFlags, 'modLogPanel'> {
  return {
    chatMode: featureFlags.chatMode,
    hoverFollowMode: featureFlags.hoverFollowMode,
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
    chatSearchHotkey: featureFlags.chatSearchHotkey,
    hideQuickEmoteBar: featureFlags.hideQuickEmoteBar,
    showModActions: featureFlags.showModActions,
    autoTheater: featureFlags.autoTheater,
    captionGuard: featureFlags.captionGuard,
    rewindControls: featureFlags.rewindControls,
    seekBar: featureFlags.seekBar,
    liveCatchup: featureFlags.liveCatchup,
    qualityLock: featureFlags.qualityLock,
    qualityMode: featureFlags.qualityMode,
    qualityAlwaysBest: featureFlags.qualityAlwaysBest,
    screenshot: featureFlags.screenshot,
    speedControls: featureFlags.speedControls,
    fullscreenTerminal: featureFlags.fullscreenTerminal,
    floatingStrip: featureFlags.floatingStrip,
    autoClaimDrops: featureFlags.autoClaimDrops,
    autoClaimDailyReward: featureFlags.autoClaimDailyReward,
    mentionHighlightEnabled: featureFlags.mentionHighlightEnabled,
    mentionHighlightStyle: featureFlags.mentionHighlightStyle,
    mentionHighlightColor: featureFlags.mentionHighlightColor,
    roleHighlightStyle: featureFlags.roleHighlightStyle,
    modFrameEnabled: featureFlags.modFrameEnabled,
    modFrameColor: featureFlags.modFrameColor,
    vipFrameEnabled: featureFlags.vipFrameEnabled,
    vipFrameColor: featureFlags.vipFrameColor,
    manualUsername: featureFlags.manualUsername,
    ultrawideFill: featureFlags.ultrawideFill,
    aspectMode: featureFlags.aspectMode,
    ambientBands: featureFlags.ambientBands,
    loudnessLeveler: featureFlags.loudnessLeveler,
    channelVolume: featureFlags.channelVolume,
    contentBlocking: featureFlags.contentBlocking,
    liveNotify: featureFlags.liveNotify,
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
      void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
      return true;
    }
    if (
      msg.type === 'kickflow:setFlag' &&
      msg.key === 'chatMode' &&
      (msg.value === 'native' || msg.value === 'own')
    ) {
      void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
      return true;
    }
    if (
      msg.type === 'kickflow:setFlag' &&
      msg.key === 'hoverFollowMode' &&
      (msg.value === 'browser-smooth' || msg.value === 'instant')
    ) {
      void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
      return true;
    }
    return undefined;
  });

  // In-panel gear (removed-panel.ts) dispatches this instead of a chrome.runtime message — same
  // applyFlagChange mutator, so featureFlags stays the one source of truth either way. Registered
  // once here (installStatusBridge runs once from main()), never per-session.
  window.addEventListener('kickflow:setFlag', onWindowFlagChange);
  // A settings page can write kf_flag_* while no Kick tab is open; open tabs apply the new value at once.
  chrome.storage.onChanged?.addListener(applyStoredFlagChanges);
}

/** Applies kf_flag_* values written by another extension page. A value equal to the current flag is the
 * echo of this tab's own save and is skipped, so a change never loops. */
export function applyStoredFlagChanges(changes: Record<string, { newValue?: unknown }>, area: string): void {
  if (area !== 'local' || !changes || typeof changes !== 'object') return;
  handleBlockListsChange(changes);
  for (const [name, change] of Object.entries(changes)) {
    if (!name.startsWith('kf_flag_')) continue;
    const key = name.slice('kf_flag_'.length);
    const value = change?.newValue;
    if (isBooleanFlagKey(key) && typeof value === 'boolean') {
      if (featureFlags[key] !== value) void applyFlagChange(key, value);
    } else if (isStringFlagKey(key) && typeof value === 'string') {
      const parsed = parseStringFlag(key, value);
      if (parsed !== null && featureFlags[key] !== parsed) void applyFlagChange(key, parsed);
    }
  }
}

/** Load flag overrides the user set via the popup, applied before the first session starts so
 * they take effect immediately (not just after the next toggle). */
export async function applySavedFlags(): Promise<void> {
  const saved = await safeStorageGet([
    ...BOOLEAN_FLAG_KEYS.map((key) => `kf_flag_${key}`),
    ...STRING_FLAG_KEYS.map((key) => `kf_flag_${key}`),
    LEGACY_QUALITY_PREFERENCE_KEY,
  ]);
  for (const key of BOOLEAN_FLAG_KEYS) {
    const value = saved[`kf_flag_${key}`];
    if (typeof value === 'boolean') setFeatureFlag(key, value);
  }
  for (const key of STRING_FLAG_KEYS) {
    const parsed = parseStringFlag(key, saved[`kf_flag_${key}`]);
    if (parsed !== null) setFeatureFlag(key, parsed);
  }
  await migrateQualityPreference(saved);
}

/** Before quality design B (2026-10-29) the only quality choice was the switch "Highest quality"
 * (kf_flag_qualityLock), and the controller stored 'highest' under kickflow.qualityPreference.
 * That choice is now the first of three: qualityMode 'best'. The switch keeps its stored value
 * and its meaning (KickFlow manages quality or leaves it to Kick), so nobody's quality changes. */
const LEGACY_QUALITY_PREFERENCE_KEY = 'kickflow.qualityPreference';

async function migrateQualityPreference(saved: Record<string, unknown>): Promise<void> {
  if (saved.kf_flag_qualityMode === undefined) {
    const mode = normalizeQualityMode(saved[LEGACY_QUALITY_PREFERENCE_KEY]) ?? DEFAULT_QUALITY_MODE;
    setFeatureFlag('qualityMode', mode);
    await safeStorageSet({ kf_flag_qualityMode: mode });
  }
  if (saved[LEGACY_QUALITY_PREFERENCE_KEY] !== undefined) await safeStorageRemove(LEGACY_QUALITY_PREFERENCE_KEY);
}

/** A fallback player bar runs in the page world without extension storage. It reads the
 * effective choice from <html>: 'best' while "always highest" is on (with or without the quality
 * button), else the stored mode, or 'auto' (let the player choose) while both are off. A pick on
 * that bar holds for its channel only (player-controls.js qualityState, review K-2). */
function syncQualityAttribute(): void {
  const mode = featureFlags.qualityAlwaysBest ? DEFAULT_QUALITY_MODE : featureFlags.qualityMode;
  document.documentElement.setAttribute(QUALITY_ATTRIBUTE, featureFlags.qualityLock || featureFlags.qualityAlwaysBest ? mode : 'auto');
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

/** Backlog size before the metered "new messages" pill is worth showing, and how long it stays up
 * once shown. Kick admits one queued row every 250 ms, so on a quiet channel the pending count
 * oscillates between 1 and 0 and a naive pill blinks on every release. */
const PILL_MIN_PENDING = 2;
const PILL_MIN_VISIBLE_MS = 700;


/** The approved audit bounds startup at chat-column availability, load, or 3 seconds.
 * DOM writes stay outside Kick's virtualized rows. Live probes measure hydration errors. */
function afterPageSettled(mount: () => void): void {
  scheduleChatStartup(mount);
}

async function main(): Promise<void> {
  await Promise.all([applySavedFlags(), loadHotkeyBindings(), loadLang()]);
  setAspectModeWriter((mode) => { void applyFlagChange('aspectMode', mode); });
  syncQualityAttribute();
  setDebugLogging(featureFlags.debugLogging);
  installStatusBridge();
  installNavigationHooks();
  afterPageSettled(() => {
    initSiteLifecycle();
    syncLayoutWatchdog();
    handlePotentialNavigation();
  });
}

// Dynamic injection can repeat before the first asynchronous settings load ends.
// All site/session controllers belong to the first instance in this isolated world.
const bootstrapScope = globalThis as typeof globalThis & { __kickflowContentStarted?: boolean };
if (!bootstrapScope.__kickflowContentStarted) {
  bootstrapScope.__kickflowContentStarted = true;
  void main();
}
