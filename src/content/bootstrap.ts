import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { SELECTORS } from './shared/selectors';
import { featureFlags, setFeatureFlag, type FeatureFlags } from './chat/feature-flags';
import { getStatus, setStatus, resetStatus } from './status';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from './chat/message-store';
import { RenderQueue } from './chat/render-queue';
import { trimMessageWindow, isNearBottom } from './chat/dom-window';
import { handleUserBanned, handleMessageDeleted } from './chat/ban-guard';
import { PusherClient } from './chat/pusher-client';
import { fetchChatHistory } from './chat/history';
import { ChatOverlayMount } from './chat/overlay-mount';
import { initQualityLock } from './player/quality-lock';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';
import { initRewindControls } from './player/rewind-controls';
import { initSpeedControls } from './player/speed-controls';
import { initScreenshot } from './player/screenshot';

const OWN_LIST_ID = 'kickflow-message-list';
const STYLE_ID = 'kickflow-styles';
const CHAT_CONTAINER_WAIT_MS = 15000;
const VIDEO_ELEMENT_WAIT_MS = 15000;
const PRESERVED_SWEEP_INTERVAL_MS = 60_000;
const NAVIGATION_POLL_INTERVAL_MS = 400;

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
        const json = (await response.json()) as { id?: number; chatroom?: { id?: number; channel_id?: number } };
        const chatroomId = json.chatroom?.id;
        if (typeof chatroomId !== 'number') return null;
        // History uses the CHANNEL id (top-level `id` === chatroom.channel_id), NOT the chatroom
        // id (which returns an empty history). Fall back to chatroomId if neither is present.
        const channelId =
          typeof json.id === 'number' ? json.id
          : typeof json.chatroom?.channel_id === 'number' ? json.chatroom.channel_id
          : chatroomId;
        return { chatroomId, channelId };
      }
      const transient = response.status === 429 || response.status >= 500;
      logger.warn('bootstrap: channel lookup failed for', slug, 'status', response.status, transient ? '(retrying)' : '(terminal)');
      if (!transient) return null;
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

function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    let timer: number;

    const observer = new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) settle(el);
    });

    const settle = (value: HTMLElement | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(value);
    };

    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(() => settle(null), timeoutMs);
  });
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // All selectors are scoped under #kickflow-message-list for specificity, and images use
  // `display: inline-block !important` + an explicit px height. Kick's page is built with
  // Tailwind, whose preflight reset applies `img { display: block; height: auto }` globally
  // — without overriding display, every emote/badge <img> becomes a block and drops onto
  // its own line at natural (huge) size, which is exactly the broken stacked layout we saw.
  style.textContent = `
    #${OWN_LIST_ID} {
      padding: 6px 10px; overflow-y: auto; height: 100%; box-sizing: border-box;
      font-size: 13px; line-height: 1.45; color: #efeff1;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    #${OWN_LIST_ID} .kickflow-message {
      display: block; padding: 3px 5px; border-radius: 4px;
      word-break: break-word; overflow-wrap: anywhere;
    }
    #${OWN_LIST_ID} .kickflow-message:hover { background: rgba(255,255,255,0.06); }
    #${OWN_LIST_ID} .kickflow-message__time { color: #adadb8; font-size: 11px; margin-right: 5px; }
    #${OWN_LIST_ID} .kickflow-message__badges:empty { display: none; }
    #${OWN_LIST_ID} .kickflow-message__badges { margin-right: 3px; }
    #${OWN_LIST_ID} .kickflow-badge-icon {
      display: inline-block !important; height: 15px !important; width: auto !important;
      vertical-align: -3px; margin-right: 3px;
    }
    #${OWN_LIST_ID} .kickflow-badge-text { font-size: 10px; font-weight: 700; margin-right: 4px; opacity: 0.75; }
    #${OWN_LIST_ID} .kickflow-message__username { font-weight: 700; }
    #${OWN_LIST_ID} .kickflow-message__separator { color: #adadb8; }
    #${OWN_LIST_ID} .kickflow-message__content { color: #efeff1; }
    #${OWN_LIST_ID} .kickflow-emote {
      display: inline-block !important; height: 24px !important; width: auto !important;
      vertical-align: middle; margin: 0 2px;
    }
    #${OWN_LIST_ID} .kickflow-mention { color: #53fc18; font-weight: 600; }
    #${OWN_LIST_ID} .kickflow-link { color: #66bfff; text-decoration: underline; }
    #${OWN_LIST_ID} .kickflow-status-label {
      display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.02em; vertical-align: middle;
      text-decoration: none; text-transform: uppercase;
    }
    #${OWN_LIST_ID} .kickflow-status-label--banned { background: #e9113c; color: #fff; }
    #${OWN_LIST_ID} .kickflow-status-label--timeout { background: #e6932b; color: #fff; }
    #${OWN_LIST_ID} .kickflow-status-label--deleted { background: #6d6d6d; color: #fff; }
    #${OWN_LIST_ID} .kickflow-mod-label { margin-left: 5px; font-size: 10px; font-weight: 600; opacity: 0.7; }
    #${OWN_LIST_ID} .kickflow-preserved { opacity: 0.6; }
    #${OWN_LIST_ID} .kickflow-preserved .kickflow-message__content { text-decoration: line-through; }

    /* The own list is a body-level position:fixed overlay (see overlay-mount.ts — the Kick
       chat panel is entirely React-owned, so an in-panel node gets reconciled away). When the
       overlay is active, hide the native list. The class is on <html>, NOT on #chatroom-messages,
       because React re-renders that node and would strip a class added to it. */
    html.kickflow-chat-active #chatroom-messages > * { visibility: hidden !important; }

    /* --- Player controls, injected inline into Kick's native control bar. Global classes
       (not scoped to the chat list): they live inside Kick's dark bar and are styled to sit
       flush with the native buttons while keeping fixed dimensions across re-renders. --- */
    .kickflow-player-group {
      display: inline-flex; align-items: center; gap: 5px;
      height: 32px; margin-left: 6px; padding-left: 8px;
      border-left: 1px solid rgba(255,255,255,0.18);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-catchup-group,
    .kickflow-speed-group {
      margin-left: 4px; padding-left: 0; border-left: 0;
    }
    .kickflow-player-btn,
    .kickflow-catchup-indicator,
    .kickflow-player-toggle,
    .kickflow-speed-btn {
      appearance: none;
      display: inline-flex; align-items: center; justify-content: center;
      margin: 0; border: 0; color: #fff; line-height: 1; white-space: nowrap; cursor: pointer;
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
      transition: background .14s ease, opacity .14s ease, transform .09s ease, color .14s ease;
    }
    .kickflow-player-btn {
      gap: 3px; height: 32px; min-width: 32px; padding: 0 9px; border-radius: 6px;
      background: transparent; opacity: 0.82; font-size: 12px; font-weight: 600;
    }
    .kickflow-player-btn:hover,
    .kickflow-catchup-indicator:hover,
    .kickflow-player-toggle:hover,
    .kickflow-speed-btn:hover {
      background: rgba(255,255,255,0.16); opacity: 1;
    }
    .kickflow-player-btn:active,
    .kickflow-catchup-indicator:active,
    .kickflow-player-toggle:active,
    .kickflow-speed-btn:active {
      background: rgba(255,255,255,0.24); transform: scale(0.94);
    }
    .kickflow-player-btn:focus-visible,
    .kickflow-catchup-indicator:focus-visible,
    .kickflow-player-toggle:focus-visible,
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
    }
    .kickflow-seek-pill__btn + .kickflow-seek-pill__btn {
      border-left: 1px solid rgba(255,255,255,0.18);
    }
    .kickflow-seek-pill__btn:active { transform: none; }
    .kickflow-player-btn--live {
      min-width: 68px; font-weight: 700; padding: 0 10px;
    }
    .kickflow-player-btn--live::before {
      content: ''; width: 7px; height: 7px; margin-right: 1px; border-radius: 50%;
      background: #e9113c; box-shadow: 0 0 5px rgba(233,17,60,0.7);
    }
    .kickflow-catchup-indicator {
      height: 26px; min-width: 102px; padding: 0 8px; border-radius: 5px;
      background: rgba(255,176,32,0.14); color: #ffb020; opacity: 0.95;
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .kickflow-player-toggle {
      height: 26px; min-width: 42px; padding: 0 8px; border-radius: 5px;
      background: transparent; opacity: 0.55;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
    }
    .kickflow-player-toggle--on { color: #53fc18; opacity: 0.95; }
    .kickflow-speed-btn {
      height: 26px; min-width: 58px; padding: 0 8px; border-radius: 5px;
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

    /* Chat "jump to newest" pill — shown when scrolled up and new messages arrive. Anchored
       to #chatroom-messages (which already carries Tailwind's relative position), centered
       above the input. */
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
  `;
  document.head.appendChild(style);
}

// Kick's native message list is virtualized/row-recycled AND the entire chat panel is
// React-owned (confirmed live 2026-07-05: #chatroom-messages and every ancestor carry
// `__reactFiber$`), so KickFlow can neither tag native rows reliably NOR inject its own list
// inside the panel — React reconciles a foreign in-panel node away on its next re-render.
// Instead it renders its own independent list as a document.body-level overlay aligned to the
// chat area (see ChatOverlayMount), fed entirely by its own Pusher connection.
//
// The overlay starts hidden and native stays visible/untouched until the first message
// actually renders (mount.activate()) — chatroom-id resolution and the Pusher connection are
// both async and can fail (null id, private channel, no message ever arrives), and hiding
// native up front would leave the user with an empty list AND no native chat on any of those
// failure paths. This is also the auto-fallback: if KickFlow's renderer never runs, the user
// silently keeps Kick's native chat instead of losing it.
function initChatIntegrity(slug: string, lifecycle: Lifecycle): void {
  const registry = new ChatDomRegistry();
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message: ChatMessage) => {
      const element = registry.getElementForMessageId(message.id);
      if (!element) return;
      registry.forget(element);
      element.remove();
    },
  });

  const mount = new ChatOverlayMount(lifecycle);
  const ownList = mount.ownList;

  // "Jump to newest" pill: appears when the user has scrolled up and new messages arrive, so
  // live bottom-follow is never forced on someone reading history. It lives in the overlay's
  // fixed `root` wrapper — NOT inside `ownList` (the scroll container) — so it stays pinned to
  // the bottom of the viewport instead of scrolling away with history (cx review 2026-07-05).
  const scrollPill = document.createElement('button');
  scrollPill.type = 'button';
  scrollPill.className = 'kickflow-scroll-pill';
  scrollPill.textContent = '↓ Yeni mesajlar';
  scrollPill.style.display = 'none';
  scrollPill.addEventListener('click', () => {
    ownList.scrollTop = ownList.scrollHeight;
    scrollPill.style.display = 'none';
  });
  mount.root.appendChild(scrollPill);
  lifecycle.add(() => scrollPill.remove());

  // Hide the pill the moment the user scrolls back to the bottom themselves.
  lifecycle.addEventListener(ownList, 'scroll', () => {
    if (isNearBottom(ownList)) scrollPill.style.display = 'none';
  });

  let activated = false;

  const renderQueue = new RenderQueue({
    getContainer: () => ownList,
    registry,
    onFlush: (appended, wasAtBottom) => {
      if (!activated && appended.length > 0) {
        activated = true;
        mount.activate();
        setStatus({ active: true, reason: 'aktif — kendi liste render ediliyor' });
      }

      trimMessageWindow(ownList, registry);
      if (wasAtBottom) {
        ownList.scrollTop = ownList.scrollHeight;
        scrollPill.style.display = 'none';
      } else if (appended.length > 0) {
        // New messages arrived while the user is reading history — surface the pill.
        scrollPill.style.display = '';
      }
    },
  });
  lifecycle.add(() => renderQueue.dispose());

  lifecycle.setInterval(() => store.sweepExpiredPreserved(), PRESERVED_SWEEP_INTERVAL_MS);

  resolveChannel(slug).then(async (resolved) => {
    if (lifecycle.isDisposed) return;
    if (!resolved) {
      logger.warn('bootstrap: could not resolve channel for', slug, '- chat integrity inactive, native chat stays visible');
      setStatus({ reason: 'chatroom-id çözülemedi — native chat' });
      return;
    }
    const { chatroomId, channelId } = resolved;
    setStatus({ chatroomId, reason: 'geçmiş yükleniyor…' });

    // Backfill recent history BEFORE going live so the overlay opens with the existing backlog
    // instead of empty (hiding native would otherwise wipe what the user was already reading).
    // Enqueued first → renders above live messages (the render queue preserves enqueue order);
    // dedup-by-id in the store handles any overlap with the first live Pusher messages.
    const history = await fetchChatHistory(channelId);
    if (lifecycle.isDisposed) return;
    for (const message of history) {
      store.addMessage(message);
      renderQueue.enqueue(message);
    }

    setStatus({ reason: 'Pusher bağlanıyor…' });
    const client = new PusherClient(chatroomId, {
      onConnected: () => {
        setStatus({ pusherConnected: true });
        // Don't clobber the "aktif" reason if the list is already rendering (reconnect case).
        if (!getStatus().active) setStatus({ reason: 'Pusher bağlı — ilk mesaj bekleniyor' });
      },
      onDisconnected: () => {
        setStatus({ pusherConnected: false });
      },
      onMessage: (message) => {
        store.addMessage(message);
        renderQueue.enqueue(message);
      },
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

/** Fully independent of chat readiness — gated only on the video element, not on
 * #chatroom-messages (which can legitimately take a while, or never resolve). */
async function initPlayerQolSession(lifecycle: Lifecycle): Promise<void> {
  const video = await waitForElement(SELECTORS.videoPlayer, VIDEO_ELEMENT_WAIT_MS);
  if (lifecycle.isDisposed) return;
  if (!video) {
    logger.warn('bootstrap: #video-player not found, player QoL module skipped');
    return;
  }

  initQualityLock(lifecycle);
  initRewindHotkeys(lifecycle);
  // Mount order determines native-bar left-to-right order (see native-bar.ts): rewind
  // controls right after LIVE, then the catch-up indicator/toggle after that.
  initRewindControls(lifecycle);
  initLiveCatchup(lifecycle);
  initSpeedControls(lifecycle);
  initScreenshot(lifecycle);
}

let currentLifecycle: Lifecycle | null = null;
let currentSlug: string | null = null;
let sessionToken = 0;

async function startSession(slug: string): Promise<void> {
  const token = ++sessionToken;
  document.getElementById('kickflow-chat-overlay')?.remove();
  document.documentElement.classList.remove('kickflow-chat-active');

  const lifecycle = new Lifecycle();
  currentLifecycle = lifecycle;

  ensureStyles();

  // Player QoL and chat integrity are started concurrently and never gate each other.
  void initPlayerQolSession(lifecycle);

  const chatContainer = await waitForElement(SELECTORS.chatMessagesContainer, CHAT_CONTAINER_WAIT_MS);
  if (token !== sessionToken || lifecycle.isDisposed) return;

  if (!chatContainer) {
    logger.warn('bootstrap:', SELECTORS.chatMessagesContainer, 'not found for', slug, '- chat integrity module skipped');
    setStatus({ reason: 'chat paneli bulunamadı — native chat' });
    return;
  }
  // chatContainer (checked above) is the gate that the chat panel exists; the overlay mount
  // then tracks #chatroom-messages by selector itself (it must survive Kick replacing it).
  initChatIntegrity(slug, lifecycle);
}

function stopSession(): void {
  currentLifecycle?.dispose();
  currentLifecycle = null;
}

function handlePotentialNavigation(): void {
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

/** Popup ↔ content-script bridge: report status + apply flag toggles. activeTab grants the
 * popup access on open. Flags persist to chrome.storage.local so a toggle survives a reload. */
function installStatusBridge(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'kickflow:getStatus') {
      const ownList = document.getElementById('kickflow-message-list');
      sendResponse({
        ...getStatus(),
        messageCount: ownList ? ownList.querySelectorAll('.kickflow-message').length : 0,
        preservedCount: document.querySelectorAll('.kickflow-preserved').length,
        bannedCount: document.querySelectorAll('.kickflow-banned').length,
        deletedCount: document.querySelectorAll('.kickflow-deleted').length,
        flags: { showDeletedMessages: featureFlags.showDeletedMessages, debugLogging: featureFlags.debugLogging },
      });
      return;
    }
    if (
      msg.type === 'kickflow:setFlag' &&
      (msg.key === 'showDeletedMessages' || msg.key === 'debugLogging') &&
      typeof msg.value === 'boolean'
    ) {
      const key = msg.key as keyof FeatureFlags;
      setFeatureFlag(key, msg.value);
      if (key === 'debugLogging') setDebugLogging(msg.value);
      void chrome.storage.local.set({ ['kf_flag_' + key]: msg.value });
      sendResponse({ ok: true });
      return;
    }
  });
}

/** Load flag overrides the user set via the popup, applied before the first session starts so
 * they take effect immediately (not just after the next toggle). */
async function applySavedFlags(): Promise<void> {
  try {
    const saved = await chrome.storage.local.get(['kf_flag_showDeletedMessages', 'kf_flag_debugLogging']);
    if (typeof saved.kf_flag_showDeletedMessages === 'boolean') setFeatureFlag('showDeletedMessages', saved.kf_flag_showDeletedMessages);
    if (typeof saved.kf_flag_debugLogging === 'boolean') setFeatureFlag('debugLogging', saved.kf_flag_debugLogging);
  } catch {
    // storage unavailable — fall back to the compiled-in defaults
  }
}

function installNavigationHooks(): void {
  let lastHref = window.location.href;
  window.setInterval(() => {
    const href = window.location.href;
    if (href === lastHref) return;
    lastHref = href;
    window.dispatchEvent(new Event('kickflow:locationchange'));
  }, NAVIGATION_POLL_INTERVAL_MS);
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('kickflow:locationchange')));
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
