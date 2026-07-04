import { logger, setDebugLogging } from './shared/logger';
import { Lifecycle } from './shared/lifecycle';
import { SELECTORS } from './shared/selectors';
import { featureFlags } from './chat/feature-flags';
import { ChatDomRegistry, ChatIntegrityStore, type ChatMessage } from './chat/message-store';
import { RenderQueue } from './chat/render-queue';
import { trimMessageWindow } from './chat/dom-window';
import { handleUserBanned, handleMessageDeleted } from './chat/ban-guard';
import { PusherClient } from './chat/pusher-client';
import { initQualityLock } from './player/quality-lock';
import { initLiveCatchup } from './player/live-catchup';
import { initRewindHotkeys } from './player/rewind-hotkeys';

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
  style.textContent = `
    #${OWN_LIST_ID} { padding: 4px 8px; overflow-y: auto; height: 100%; box-sizing: border-box; }
    .kickflow-message { padding: 2px 0; font-size: 13px; line-height: 1.5; word-break: break-word; }
    .kickflow-message__time { color: #6d6d6d; margin-right: 6px; font-size: 11px; }
    .kickflow-message__badges:empty { display: none; }
    .kickflow-message__badges { margin-right: 4px; }
    .kickflow-badge-icon { height: 1.1em; width: auto; vertical-align: middle; margin-right: 2px; }
    .kickflow-badge-text { font-size: 10px; font-weight: 700; margin-right: 4px; opacity: 0.8; }
    .kickflow-message__username { font-weight: 600; }
    .kickflow-emote { height: 1.6em; width: auto; vertical-align: middle; margin: 0 1px; }
    .kickflow-mention { background: rgba(83, 252, 24, 0.15); border-radius: 3px; padding: 0 2px; }
    .kickflow-link { color: #66bfff; text-decoration: underline; }
    .kickflow-status-label { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.02em; vertical-align: middle; text-decoration: none; text-transform: uppercase; }
    .kickflow-status-label--banned { background: #e9113c; color: #fff; }
    .kickflow-status-label--deleted { background: #6d6d6d; color: #fff; }
    .kickflow-preserved { opacity: 0.65; }
    .kickflow-preserved .kickflow-message__content { text-decoration: line-through; }
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
  initLiveCatchup(lifecycle);
  initRewindHotkeys(lifecycle);
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
