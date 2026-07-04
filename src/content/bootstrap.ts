import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { SELECTORS } from './shared/selectors';
import { featureFlags } from './chat/feature-flags';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from './chat/message-store';
import { RenderQueue } from './chat/render-queue';
import { trimMessageWindow, isNearBottom } from './chat/dom-window';
import { handleUserBanned, handleMessageDeleted } from './chat/ban-guard';
import { PusherClient } from './chat/pusher-client';
import { initQualityLock } from './player/quality-lock';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';
import { initRewindControls } from './player/rewind-controls';
import { initScreenshot } from './player/screenshot';

const OWN_LIST_ID = 'kickflow-message-list';
const STYLE_ID = 'kickflow-styles';
const CHAT_CONTAINER_WAIT_MS = 15000;
const VIDEO_ELEMENT_WAIT_MS = 15000;
const PRESERVED_SWEEP_INTERVAL_MS = 60_000;

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

async function resolveChatroomId(slug: string): Promise<number | null> {
  try {
    // credentials: 'omit' — enforce the no-credential hard rule. The content script runs
    // on https://kick.com/*, so a same-site fetch would otherwise attach the user's Kick
    // session cookies; this endpoint is public and must be called unauthenticated. If the
    // unauthenticated call ever fails, the fail-safe below keeps native chat visible.
    const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
    });
    if (!response.ok) {
      logger.warn('bootstrap: channel lookup failed for', slug, 'status', response.status);
      return null;
    }
    const json = (await response.json()) as { chatroom?: { id?: number } };
    const id = json.chatroom?.id;
    return typeof id === 'number' ? id : null;
  } catch (error) {
    logger.warn('bootstrap: channel lookup threw', error);
    return null;
  }
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
    #${OWN_LIST_ID} .kickflow-status-label--deleted { background: #6d6d6d; color: #fff; }
    #${OWN_LIST_ID} .kickflow-preserved { opacity: 0.6; }
    #${OWN_LIST_ID} .kickflow-preserved .kickflow-message__content { text-decoration: line-through; }

    /* --- Player controls, injected inline into Kick's native control bar. Global classes
       (not scoped to the chat list): they live inside Kick's dark bar and are styled to sit
       flush with the native buttons — subtle hover/active feedback, a divider from the native
       cluster, and a live-accent "CANLI" pill. --- */
    .kickflow-player-group {
      display: inline-flex; align-items: center; gap: 1px;
      margin-left: 6px; padding-left: 8px;
      border-left: 1px solid rgba(255,255,255,0.18);
      font-family: 'Inter','Segoe UI',system-ui,sans-serif;
    }
    .kickflow-player-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 3px;
      height: 32px; padding: 0 9px; margin: 0; border: 0; border-radius: 6px;
      background: transparent; color: #fff; opacity: 0.82;
      font-size: 12px; font-weight: 600; letter-spacing: 0.02em; line-height: 1;
      white-space: nowrap; cursor: pointer;
      transition: background .14s ease, opacity .14s ease, transform .09s ease;
    }
    .kickflow-player-btn:hover { background: rgba(255,255,255,0.16); opacity: 1; }
    .kickflow-player-btn:active { background: rgba(255,255,255,0.24); transform: scale(0.93); }
    .kickflow-player-btn:focus-visible { outline: 2px solid #53fc18; outline-offset: 1px; }
    .kickflow-player-btn svg {
      width: 15px; height: 15px; display: block;
      fill: none; stroke: currentColor; stroke-width: 2.3;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .kickflow-player-btn--live { font-weight: 700; letter-spacing: 0.05em; padding: 0 10px; }
    .kickflow-player-btn--live::before {
      content: ''; width: 7px; height: 7px; margin-right: 1px; border-radius: 50%;
      background: #e9113c; box-shadow: 0 0 5px rgba(233,17,60,0.7);
    }
    .kickflow-catchup-indicator {
      display: inline-flex; align-items: center; gap: 3px; padding: 0 4px 0 8px;
      color: #ffb020; font-size: 11px; font-weight: 700; letter-spacing: 0.01em;
      white-space: nowrap; font-variant-numeric: tabular-nums;
    }
    .kickflow-player-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      height: 26px; padding: 0 8px; margin: 0 2px; border: 0; border-radius: 5px;
      background: transparent; color: #fff; opacity: 0.55;
      font-size: 10px; font-weight: 700; letter-spacing: 0.05em; line-height: 1;
      white-space: nowrap; cursor: pointer; text-transform: uppercase;
      transition: background .14s ease, opacity .14s ease, color .14s ease;
    }
    .kickflow-player-toggle:hover { background: rgba(255,255,255,0.14); opacity: 0.95; }
    .kickflow-player-toggle:focus-visible { outline: 2px solid #53fc18; outline-offset: 1px; }
    .kickflow-player-toggle--on { color: #53fc18; opacity: 0.95; }

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

// Kick's native message list is virtualized/row-recycled (confirmed live 2026-07-04:
// rows carry `data-index` + a `translateY` transform and get reused across scroll
// positions), so tagging its DOM nodes directly would be unreliable — a recycled node
// can silently end up representing a different message a moment later. KickFlow renders
// its own independent list instead, fed entirely by its own Pusher connection.
//
// The own list starts hidden and native stays visible/untouched until the first
// message actually renders (see activateOwnMessageList) — chatroom-id resolution and
// the Pusher connection are both async and can fail (null id, private channel, no
// message ever arrives), and hiding native up front would leave the user with an empty
// list AND no native chat on any of those failure paths, which is worse than doing
// nothing. This is also the auto-fallback: if KickFlow's renderer never manages to run,
// the user silently keeps Kick's native chat instead of losing it.
function ensureOwnMessageList(container: HTMLElement): HTMLElement {
  const existing = document.getElementById(OWN_LIST_ID);
  if (existing instanceof HTMLElement && container.contains(existing)) {
    return existing;
  }

  const ownList = document.createElement('div');
  ownList.id = OWN_LIST_ID;
  ownList.style.display = 'none';
  container.appendChild(ownList);
  return ownList;
}

function activateOwnMessageList(container: HTMLElement, ownList: HTMLElement): void {
  const nativeList = container.firstElementChild;
  if (nativeList instanceof HTMLElement && nativeList !== ownList) {
    nativeList.style.display = 'none';
  }
  ownList.style.display = '';
}

function restoreNativeMessageList(container: HTMLElement | null): void {
  document.getElementById(OWN_LIST_ID)?.remove();
  const nativeList = container?.firstElementChild;
  if (nativeList instanceof HTMLElement && nativeList.style.display === 'none') {
    nativeList.style.display = '';
  }
}

function initChatIntegrity(container: HTMLElement, slug: string, lifecycle: Lifecycle): void {
  const registry = new ChatDomRegistry();
  const store = new ChatIntegrityStore({
    onPreservedEvicted: (message: ChatMessage) => {
      const element = registry.getElementForMessageId(message.id);
      if (!element) return;
      registry.forget(element);
      element.remove();
    },
  });

  const ownList = ensureOwnMessageList(container);
  lifecycle.add(() => restoreNativeMessageList(container));

  // "Jump to newest" pill: appears when the user has scrolled up and new messages arrive, so
  // live bottom-follow is never forced on someone reading history. Anchored to `container`
  // (#chatroom-messages carries Tailwind's `relative`), removed on teardown.
  const scrollPill = document.createElement('button');
  scrollPill.type = 'button';
  scrollPill.className = 'kickflow-scroll-pill';
  scrollPill.textContent = '↓ Yeni mesajlar';
  scrollPill.style.display = 'none';
  scrollPill.addEventListener('click', () => {
    const list = document.getElementById(OWN_LIST_ID);
    if (list) list.scrollTop = list.scrollHeight;
    scrollPill.style.display = 'none';
  });
  // The pill is position:absolute — it must anchor to the chat viewport. #chatroom-messages
  // carries Tailwind `relative` today, but guard defensively: if it's ever `static`, the pill
  // would anchor to some outer positioned ancestor and land in the wrong place / get clipped.
  const previousInlinePosition = container.style.position;
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.appendChild(scrollPill);
  lifecycle.add(() => {
    scrollPill.remove();
    if (previousInlinePosition) container.style.position = previousInlinePosition;
    else container.style.removeProperty('position');
  });

  // Hide the pill the moment the user scrolls back to the bottom themselves.
  lifecycle.addEventListener(ownList, 'scroll', () => {
    if (isNearBottom(ownList)) scrollPill.style.display = 'none';
  });

  let activated = false;

  const renderQueue = new RenderQueue({
    getContainer: () => document.getElementById(OWN_LIST_ID),
    registry,
    onFlush: (appended, wasAtBottom) => {
      const list = document.getElementById(OWN_LIST_ID);
      if (!list) return;

      if (!activated && appended.length > 0) {
        activated = true;
        activateOwnMessageList(container, ownList);
      }

      trimMessageWindow(list, registry);
      if (wasAtBottom) {
        list.scrollTop = list.scrollHeight;
        scrollPill.style.display = 'none';
      } else if (appended.length > 0) {
        // New messages arrived while the user is reading history — surface the pill.
        scrollPill.style.display = '';
      }
    },
  });
  lifecycle.add(() => renderQueue.dispose());

  lifecycle.setInterval(() => store.sweepExpiredPreserved(), PRESERVED_SWEEP_INTERVAL_MS);

  resolveChatroomId(slug).then((chatroomId) => {
    if (lifecycle.isDisposed) return;
    if (chatroomId === null) {
      logger.warn('bootstrap: could not resolve chatroom id for', slug, '- chat integrity inactive, native chat stays visible');
      return;
    }

    const client = new PusherClient(chatroomId, {
      onMessage: (message) => {
        store.addMessage(message);
        renderQueue.enqueue(message);
      },
      onUserBanned: (payload) => {
        handleUserBanned(payload.userId, { store, registry });
      },
      onMessageDeleted: (messageId) => {
        handleMessageDeleted(messageId, { store, registry });
      },
    });
    lifecycle.add(() => client.dispose());
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
  initScreenshot(lifecycle);
}

let currentLifecycle: Lifecycle | null = null;
let currentSlug: string | null = null;
let sessionToken = 0;

async function startSession(slug: string): Promise<void> {
  const token = ++sessionToken;
  const lifecycle = new Lifecycle();
  currentLifecycle = lifecycle;

  ensureStyles();

  // Player QoL and chat integrity are started concurrently and never gate each other.
  void initPlayerQolSession(lifecycle);

  const chatContainer = await waitForElement(SELECTORS.chatMessagesContainer, CHAT_CONTAINER_WAIT_MS);
  if (token !== sessionToken || lifecycle.isDisposed) return;

  if (!chatContainer) {
    logger.warn('bootstrap:', SELECTORS.chatMessagesContainer, 'not found for', slug, '- chat integrity module skipped');
    return;
  }
  initChatIntegrity(chatContainer, slug, lifecycle);
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
  if (slug) {
    void startSession(slug);
  }
}

// Kick is a client-routed SPA (History API, no full reload on channel switch), so
// navigation must be detected by patching pushState/replaceState in addition to popstate.
function installHistoryPatch(methodName: 'pushState' | 'replaceState'): void {
  const original = history[methodName].bind(history);
  history[methodName] = ((data: unknown, unused: string, url?: string | URL | null) => {
    const result = original(data, unused, url);
    window.dispatchEvent(new Event('kickflow:locationchange'));
    return result;
  }) as typeof history.pushState;
}

function installNavigationHooks(): void {
  installHistoryPatch('pushState');
  installHistoryPatch('replaceState');
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('kickflow:locationchange')));
  window.addEventListener('kickflow:locationchange', handlePotentialNavigation);
}

function main(): void {
  setDebugLogging(featureFlags.debugLogging);
  installNavigationHooks();
  handlePotentialNavigation();
}

main();
