"use strict";
(() => {
  // src/content/chat/session-context.ts
  var NON_CHANNEL_SLUGS = /* @__PURE__ */ new Set([
    "api",
    "browse",
    "categories",
    "category",
    "video",
    "videos",
    "search",
    "subscription",
    "subscriptions",
    "wallet",
    "dashboard",
    "drops",
    "settings",
    "following",
    "clips",
    "collectibles",
    "messages",
    "notifications",
    "shop",
    // Reserved site routes include footer destinations, bundle routes and login. 2026-10-16.
    // These destinations cannot identify a channel session.
    "terms-of-service",
    "terms-and-conditions",
    "privacy-policy",
    "cookie-policy",
    "community-guidelines",
    "dmca-policy",
    "partner-terms-and-conditions",
    "kicks-usage-policy",
    "advertising-policy",
    "kick-drops-terms",
    "popout",
    "mobile"
  ]);
  var SAFE_VOD_ID = /^[A-Za-z0-9_-]+$/;
  var SAFE_CHANNEL_SLUG = /^[A-Za-z0-9_-]+$/;
  function decodePathSegment(segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return null;
    }
  }
  function parseChatSessionContext(pathname) {
    const rawSegments = pathname.split("/").filter(Boolean);
    if (rawSegments.length === 0) return null;
    const segments = rawSegments.map(decodePathSegment);
    if (segments.some((segment) => segment === null)) return null;
    if (segments[0]?.toLowerCase() === "popout") {
      if (segments.length !== 3 || segments[2]?.toLowerCase() !== "chat") return null;
      const popoutSlug = segments[1];
      if (!SAFE_CHANNEL_SLUG.test(popoutSlug)) return null;
      return { kind: "live", slug: popoutSlug, sessionKey: `popout:${popoutSlug}` };
    }
    const slug = segments[0];
    if (!slug || NON_CHANNEL_SLUGS.has(slug.toLowerCase())) return null;
    if (slug.includes(".")) return null;
    if (segments[1]?.toLowerCase() === "videos" && segments.length >= 3) {
      const videoId = segments[2];
      if (!SAFE_VOD_ID.test(videoId)) return null;
      return {
        kind: "vod",
        slug,
        videoId,
        sessionKey: `vod:${slug}:${videoId}`
      };
    }
    return {
      kind: "live",
      slug,
      sessionKey: `live:${slug}`
    };
  }

  // src/shared/reply-contract.ts
  var REPLY_REQUEST_EVENT = "kickflow:select-reply-v1";
  var REPLY_RESULT_ATTRIBUTE = "data-kickflow-reply-result";
  var NATIVE_CHAT_EDITOR = '[data-testid="chat-input"][contenteditable="true"]';
  var NATIVE_CHAT_FOOTER = "#chatroom-footer";
  function shownInPage(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === "none") return false;
    }
    return true;
  }
  function liveChatFooter(root = document) {
    const footers = [...root.querySelectorAll(NATIVE_CHAT_FOOTER)];
    if (footers.length <= 1) return footers[0] ?? null;
    const shown = footers.filter(shownInPage);
    return shown.length === 1 ? shown[0] : null;
  }
  function nativeChatReplyBlock(root = document) {
    const footer = liveChatFooter(root);
    if (!footer || footer.querySelector(NATIVE_CHAT_EDITOR)) return null;
    const text = (footer.textContent ?? "").toLocaleLowerCase("tr-TR");
    if (/kurallar[ıi].*kabul|accept.*(?:chat )?rules|agree.*rules/.test(text)) return "rules_required";
    if (/giriş yap|oturum aç|log ?in|sign in/.test(text)) return "login_required";
    if (/abonelere özel|yalnızca aboneler|subscriber[s]?[- ]only/.test(text)) return "subscribers_only";
    if (/takipçilere özel|yalnızca takipçiler|follower[s]?[- ]only/.test(text)) return "followers_only";
    return "no_editor";
  }
  function parseReplyRequest(raw) {
    if (typeof raw !== "string" || raw.length > 4e4) return null;
    try {
      const value = JSON.parse(raw);
      const message = value?.message;
      const sender = message?.sender;
      if (typeof value.sessionKey !== "string" || value.sessionKey.length > 150 || !message || typeof message.id !== "string" || !message.id || message.id.length > 200 || !Number.isSafeInteger(message.chatroom_id) || message.chatroom_id <= 0 || typeof message.content !== "string" || message.content.length > 1e4 || !["message", "reply"].includes(message.type) || typeof message.created_at !== "string" || !sender || !Number.isSafeInteger(sender.id) || sender.id <= 0 || typeof sender.username !== "string" || !sender.username || sender.username.length > 100 || typeof sender.slug !== "string" || typeof sender.identity?.color !== "string" || !Array.isArray(sender.identity.badges) || message.thread_parent_id != null && (typeof message.thread_parent_id !== "string" || message.thread_parent_id.length > 200)) return null;
      const clean = {
        id: message.id,
        chatroom_id: message.chatroom_id,
        content: message.content,
        type: message.type,
        created_at: message.created_at,
        sender: {
          id: sender.id,
          username: sender.username,
          slug: sender.slug,
          identity: { color: sender.identity.color, badges: sender.identity.badges.slice(0, 30).map((badge) => ({
            ...typeof badge?.type === "string" ? { type: badge.type } : {},
            ...typeof badge?.count === "number" ? { count: badge.count } : {}
          })) }
        },
        thread_parent_id: message.thread_parent_id ?? null
      };
      if (message.metadata) {
        const { original_sender: originalSender, original_message: originalMessage } = message.metadata;
        if (!originalSender || !originalMessage || originalSender.username !== null && typeof originalSender.username !== "string" || originalSender.id !== null && !Number.isSafeInteger(originalSender.id) || originalMessage.id !== null && typeof originalMessage.id !== "string" || originalMessage.content !== null && typeof originalMessage.content !== "string") return null;
        clean.metadata = {
          original_sender: { id: originalSender.id, username: originalSender.username },
          original_message: { id: originalMessage.id, content: originalMessage.content }
        };
      }
      return { sessionKey: value.sessionKey, message: clean };
    } catch {
      return null;
    }
  }

  // src/mainworld/reply-bridge.ts
  var REPLY_BRIDGE_SLOT = /* @__PURE__ */ Symbol.for("kickflow.reply-bridge.v1");
  function replyStore(value) {
    if (!value || typeof value !== "object" && typeof value !== "function") return null;
    const candidate = value;
    if (typeof candidate.getState !== "function") return null;
    try {
      const state = candidate.getState();
      return state && Number.isSafeInteger(state.currentChatroomId) && state.currentChatroomId >= 0 && "currentReplyingMessage" in state && typeof state.setReplyingMessage === "function" && typeof state.editorInstance?.current?.focus === "function" ? candidate : null;
    } catch {
      return null;
    }
  }
  function subscribedReplyStore(fiber) {
    const hooks = [];
    for (let hook = fiber.memoizedState, count = 0; hook && count < 128; hook = hook.next, count++) hooks.push(hook);
    const snapshots = new Set(hooks.map((hook) => hook.queue?.getSnapshot).filter((value) => typeof value === "function"));
    for (const hook of hooks) {
      const memo = hook.memoizedState;
      if (!Array.isArray(memo) || memo.length !== 2) continue;
      const [getters, dependencies] = memo;
      if (!Array.isArray(getters) || getters.length !== 2 || !snapshots.has(getters[0]) || !Array.isArray(dependencies) || dependencies.length !== 4 || typeof dependencies[0] !== "function" || typeof dependencies[1] !== "function" || typeof dependencies[2] !== "function") continue;
      const store = replyStore({ getState: dependencies[0] });
      if (store) return store;
    }
    return null;
  }
  function findNativeReplyAdapter(root = document) {
    const editors = [...root.querySelectorAll(NATIVE_CHAT_EDITOR)];
    const live = liveChatFooter(root);
    const liveEditors = live ? editors.filter((editor2) => live.contains(editor2)) : [];
    const footerEditors = editors.filter((editor2) => editor2.closest(NATIVE_CHAT_FOOTER));
    const candidates = liveEditors.length > 0 ? liveEditors : footerEditors.length > 0 ? footerEditors : editors;
    if (candidates.length !== 1) return null;
    const editor = candidates[0];
    const key = Object.getOwnPropertyNames(editor).find((name) => name.startsWith("__reactFiber$"));
    let fiber = key ? editor[key] : void 0;
    let store = null;
    let room = null;
    const inspect = (value) => {
      if (!room && value && typeof value === "object") {
        const candidate = value;
        if (Number.isSafeInteger(candidate.chatroomId) && candidate.chatroomId > 0 && typeof candidate.channelSlug === "string") room = candidate;
      }
    };
    for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
      store ??= subscribedReplyStore(fiber);
      inspect(fiber.memoizedProps?.value);
      let context = fiber.dependencies?.firstContext;
      for (let count = 0; context && count < 64; count++, context = context.next) inspect(context.memoizedValue);
      if (store && room) return { store, room, editor };
    }
    return null;
  }
  function nativeReplyRoomMatches(adapter, context) {
    const nativeRoom = adapter.store.getState().currentChatroomId;
    return context.kind === "live" && adapter.room.channelSlug.toLowerCase() === context.slug.toLowerCase() && (nativeRoom === adapter.room.chatroomId || context.sessionKey.startsWith("popout:") && nativeRoom === 0);
  }
  function selectNativeReply(request, root = document) {
    const route = parseChatSessionContext(root.location.pathname);
    if (route?.kind !== "live" || route.sessionKey !== request.sessionKey) return "wrong-room";
    try {
      const blocked = nativeChatReplyBlock(root);
      if (blocked) return blocked;
      const adapter = findNativeReplyAdapter(root);
      if (!adapter) return "unavailable";
      if (adapter.room.chatroomId !== request.message.chatroom_id || !nativeReplyRoomMatches(adapter, route)) return "wrong-room";
      adapter.store.getState().setReplyingMessage(request.message);
      const selected = adapter.store.getState().currentReplyingMessage;
      if (selected?.id !== request.message.id || selected.chatroom_id !== request.message.chatroom_id) return "unavailable";
      const nativeEditor = adapter.store.getState().editorInstance.current;
      if (nativeEditor?.getRootElement?.() === adapter.editor) nativeEditor.focus();
      else adapter.editor.focus();
      return "selected";
    } catch {
      return "unavailable";
    }
  }
  function installReplyBridge(root = document) {
    const state = root;
    state[REPLY_BRIDGE_SLOT]?.();
    const listener = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches("button.kickflow-message__reply-action")) return;
      const request = parseReplyRequest(event.detail);
      const result = request ? selectNativeReply(request, root) : "invalid-target";
      target.setAttribute(REPLY_RESULT_ATTRIBUTE, result);
    };
    root.addEventListener(REPLY_REQUEST_EVENT, listener);
    const teardown = () => {
      root.removeEventListener(REPLY_REQUEST_EVENT, listener);
      if (state[REPLY_BRIDGE_SLOT] === teardown) delete state[REPLY_BRIDGE_SLOT];
    };
    state[REPLY_BRIDGE_SLOT] = teardown;
    return teardown;
  }

  // src/shared/category-language.ts
  var CATEGORY_LANGUAGE_EVENT = "kickflow:category-languages-v1";
  var CATEGORY_LANGUAGE_RESULT_ATTRIBUTE = "data-kickflow-category-lang-result";
  var CATEGORY_LANGUAGE_CHIP_SELECTOR = "button.kickflow-lang-chip";
  function isCategoryLivePath(pathname) {
    return /^\/category\/[^/]+\/?$/.test(pathname);
  }
  function parseCategoryLanguageRequest(raw) {
    if (typeof raw !== "string" || raw.length > 600 || !raw.startsWith("/")) return null;
    try {
      const url = new URL(raw, "https://kick.com");
      if (url.origin !== "https://kick.com" || url.hash || !isCategoryLivePath(url.pathname)) return null;
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  // src/mainworld/category-language-bridge.ts
  var BRIDGE_SLOT = /* @__PURE__ */ Symbol.for("kickflow.category-language-bridge.v1");
  function nextRouter(view) {
    try {
      const router = view.next?.router;
      return router && typeof router.replace === "function" ? router : null;
    } catch {
      return null;
    }
  }
  function installCategoryLanguageBridge(root = document) {
    const state = root;
    state[BRIDGE_SLOT]?.();
    const view = root.defaultView ?? window;
    const listener = (event) => {
      const target = event.target;
      if (!(target instanceof view.HTMLElement) || !target.matches(CATEGORY_LANGUAGE_CHIP_SELECTOR)) return;
      const url = parseCategoryLanguageRequest(event.detail);
      const write = (result) => target.setAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE, result);
      if (!url) {
        write("invalid");
        return;
      }
      const router = nextRouter(view);
      if (!router) {
        write("no-router");
        return;
      }
      try {
        const pending = router.replace(url, void 0, { shallow: true, scroll: false });
        write("ok");
        if (pending && typeof pending.then === "function") {
          pending.then((ok) => {
            if (ok === false) write("failed");
          }, () => write("failed"));
        }
      } catch {
        write("failed");
      }
    };
    root.addEventListener(CATEGORY_LANGUAGE_EVENT, listener);
    const teardown = () => {
      root.removeEventListener(CATEGORY_LANGUAGE_EVENT, listener);
      if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
    };
    state[BRIDGE_SLOT] = teardown;
    return teardown;
  }

  // src/content/chat/native-thread.ts
  var NATIVE_LIST_SELECTOR = '[id="chatroom-messages"]';
  var PANEL_HEADER_ICON_SELECTOR = 'svg[data-ds-icon="MessagesOutline"]';
  var PANEL_HEADER_TITLE_SELECTOR = ":scope > h2";
  var PANEL_HEADER_CLOSE_SELECTOR = ":scope > button";
  var NATIVE_ROW_SELECTOR = "[data-index]";
  var NATIVE_ROW_BODY_SELECTOR = ".group > .w-full";
  var NATIVE_THREAD_ICON_SELECTOR = 'svg[data-ds-icon="ArrowCurveLeft"]';
  var NATIVE_REPLY_TOOLBAR_SELECTOR = `div:has(> button > ${NATIVE_THREAD_ICON_SELECTOR})`;
  var THREAD_PANEL_ATTRIBUTE = "data-kickflow-thread-panel";
  var THREAD_SHELL_ATTRIBUTE = "data-kickflow-thread-shell";
  var THREAD_HEADER_ATTRIBUTE = "data-kickflow-thread-header";
  var THREAD_LIST_ATTRIBUTE = "data-kickflow-thread-list";
  var THREAD_PLACED_ATTRIBUTE = "data-kickflow-thread-placed";
  function threadPanelPartsFor(list) {
    if (!(list instanceof HTMLElement) || !list.matches(NATIVE_LIST_SELECTOR)) return null;
    const header = list.previousElementSibling;
    if (!(header instanceof HTMLElement)) return null;
    if (!header.querySelector(PANEL_HEADER_ICON_SELECTOR) || !header.querySelector(PANEL_HEADER_TITLE_SELECTOR) || !header.querySelector(PANEL_HEADER_CLOSE_SELECTOR)) return null;
    const shell = list.parentElement;
    const outer = shell?.parentElement;
    if (!shell || !outer || outer === list.ownerDocument.body || outer === list.ownerDocument.documentElement) return null;
    return { outer, shell, header, list };
  }
  function isThreadPanelList(element) {
    return threadPanelPartsFor(element) !== null;
  }
  function threadPanelRowFor(target) {
    if (!(target instanceof Element)) return null;
    const row = target.closest(NATIVE_ROW_SELECTOR);
    const list = row?.closest(NATIVE_LIST_SELECTOR);
    return row && list && isThreadPanelList(list) ? row : null;
  }
  var THREAD_PANEL_CSS = `
    /* --- Kick "Yan Sohbet" panel, dressed as part of KickFlow (native-thread.ts). --- */
    [${THREAD_PANEL_ATTRIBUTE}][${THREAD_PLACED_ATTRIBUTE}] {
      left: var(--kf-thread-left) !important; right: var(--kf-thread-right) !important;
      bottom: var(--kf-thread-bottom) !important; top: auto !important;
      width: auto !important; height: var(--kf-thread-height) !important; max-height: 45% !important;
      z-index: 40 !important;
    }
    [${THREAD_SHELL_ATTRIBUTE}] {
      background: var(--kf-ground) !important; border: 1px solid var(--kf-line-2) !important;
      border-radius: 6px !important; box-shadow: none !important; overflow: hidden;
      color: var(--kf-ink); font-family: var(--kf-font);
    }
    [${THREAD_HEADER_ATTRIBUTE}] {
      padding: 4px 4px 4px 10px !important; gap: 6px !important; flex: none;
      border-bottom: 1px solid var(--kf-line) !important;
    }
    [${THREAD_HEADER_ATTRIBUTE}] > div { width: 18px !important; height: 18px !important; color: var(--kf-ink-3); }
    [${THREAD_HEADER_ATTRIBUTE}] > h2 {
      font: 700 13px/1.4 var(--kf-font) !important; color: var(--kf-ink) !important; letter-spacing: 0;
    }
    [${THREAD_HEADER_ATTRIBUTE}] > button { width: 28px !important; height: 28px !important; color: var(--kf-ink-2) !important; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] {
      flex: 1 1 0 !important; height: auto !important; min-height: 0 !important;
      font-family: var(--kf-font); font-size: max(12px, var(--chatroom-font-size, 13px)); line-height: 1.5;
      color: var(--kf-ink); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} {
      font-size: inherit !important; line-height: 1.5 !important; border-radius: 4px !important;
      padding: var(--chatroom-message-spacing, 3px) 6px var(--chatroom-message-spacing, 3px) 10px !important;
      cursor: pointer;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}][${THREAD_LIST_ATTRIBUTE}] [data-index][data-index]:hover > ${NATIVE_ROW_BODY_SELECTOR} {
      background-color: rgba(255,255,255,0.045) !important;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} span { line-height: inherit !important; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} button { font-weight: 700; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}][${THREAD_LIST_ATTRIBUTE}] [data-index][data-index]:hover > .group > ${NATIVE_REPLY_TOOLBAR_SELECTOR} {
      display: flex !important;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] .kickflow-message__reply-context--miss { animation: kickflow-reply-miss 0.5s ease; }
`;

  // src/mainworld/react-key-stamper.ts
  var CHAT_LIST_SELECTOR = "#chatroom-messages .no-scrollbar";
  var ROW_SELECTOR = "[data-index]";
  var REACT_FIBER_PROPERTY_PREFIX = "__reactFiber";
  var MID_ATTR = "data-kickflow-mid";
  var DEBUG_SAMPLE_LIMIT = 25;
  var debugSamples = 0;
  function debugEnabled() {
    try {
      return window.localStorage.getItem("kickflow.debug") === "1";
    } catch {
      return false;
    }
  }
  function rawReactKey(el) {
    try {
      const prop = Object.getOwnPropertyNames(el).find((name) => name.startsWith(REACT_FIBER_PROPERTY_PREFIX));
      const key = prop ? el[prop]?.key : null;
      return typeof key === "string" && key ? key : null;
    } catch {
      return null;
    }
  }
  var REACT_MESSAGE_KEY = /^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  function parseMessageId(key) {
    return REACT_MESSAGE_KEY.exec(key)?.[2] ?? null;
  }
  var THREAD_ROW_KEY = /^(?:\d+-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  function parseThreadRowMessageId(key) {
    return THREAD_ROW_KEY.exec(key)?.[1] ?? null;
  }
  function stampThreadPanelRow(row) {
    const rawKey = rawReactKey(row);
    const messageId = rawKey ? parseThreadRowMessageId(rawKey) : null;
    if (messageId) row.setAttribute(MID_ATTR, messageId);
    else row.removeAttribute(MID_ATTR);
  }
  function stampThreadPanelClick(event) {
    const row = threadPanelRowFor(event.target);
    if (row) stampThreadPanelRow(row);
  }
  function readMessageId(row) {
    const rawKey = rawReactKey(row);
    return rawKey ? parseMessageId(rawKey) : null;
  }
  function stampRow(row) {
    const rawKey = rawReactKey(row);
    const messageId = rawKey ? parseMessageId(rawKey) : null;
    if (messageId) {
      if (row.getAttribute(MID_ATTR) !== messageId) {
        row.setAttribute(MID_ATTR, messageId);
      }
    } else if (row.hasAttribute(MID_ATTR)) {
      row.removeAttribute(MID_ATTR);
    }
    if (debugEnabled() && debugSamples < DEBUG_SAMPLE_LIMIT) {
      debugSamples++;
      if (rawKey && !messageId) {
        console.debug("[kickflow-mainworld] unexpected React row key shape; skipped stamping", rawKey);
      } else {
        console.debug("[kickflow-mainworld] key", rawKey, "-> mid", messageId);
      }
    }
  }
  function collectRows(node) {
    if (!(node instanceof HTMLElement)) return [];
    const rows = [];
    if (node.matches(ROW_SELECTOR)) rows.push(node);
    rows.push(...Array.from(node.querySelectorAll(ROW_SELECTOR)));
    return rows;
  }
  function closestRow(node) {
    if (!(node instanceof HTMLElement)) return node.parentElement?.closest(ROW_SELECTOR) ?? null;
    return node.matches(ROW_SELECTOR) ? node : node.closest(ROW_SELECTOR);
  }
  function stampExistingRows(list) {
    list.querySelectorAll(ROW_SELECTOR).forEach(stampRow);
  }
  function initReactKeyStamper(root = document) {
    const ownerDocument = root instanceof Document ? root : root.ownerDocument;
    const observerRoot = root instanceof Document ? ownerDocument.body : root;
    const MutationObserverCtor = ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    let observedList = null;
    let listObserver = null;
    let bodyObserver = null;
    const delayedPasses = /* @__PURE__ */ new Set();
    const restampCurrentList = () => {
      if (!observedList) return;
      observedList.querySelectorAll(ROW_SELECTOR).forEach((row) => {
        const currentId = row.getAttribute(MID_ATTR);
        const nextId = readMessageId(row);
        if (!currentId || currentId !== nextId) {
          stampRow(row);
        }
      });
    };
    const scheduleDelayedRestamps = () => {
      for (const delayMs of [100, 1e3]) {
        const timeoutId = window.setTimeout(() => {
          delayedPasses.delete(timeoutId);
          restampCurrentList();
        }, delayMs);
        delayedPasses.add(timeoutId);
      }
    };
    const detachObservedList = () => {
      listObserver?.disconnect();
      listObserver = null;
      observedList = null;
    };
    const observeList = (list) => {
      if (list === observedList) return;
      listObserver?.disconnect();
      observedList = list;
      stampExistingRows(list);
      scheduleDelayedRestamps();
      listObserver = new MutationObserverCtor((mutations) => {
        for (const mutation of mutations) {
          const targetRow = closestRow(mutation.target);
          if (targetRow) stampRow(targetRow);
          for (const node of mutation.addedNodes) {
            collectRows(node).forEach(stampRow);
          }
        }
      });
      listObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-index"] });
    };
    const attachToCurrentList = () => {
      const list = root.querySelector(CHAT_LIST_SELECTOR);
      if (list) {
        observeList(list);
      } else if (observedList) {
        detachObservedList();
      }
    };
    attachToCurrentList();
    bodyObserver = new MutationObserverCtor((records) => {
      const currentWasDetached = observedList !== null && !observedList.isConnected;
      const couldIntroduceList = observedList === null && records.some(
        (record) => Array.from(record.addedNodes).some((node) => node instanceof Element && (node.matches(CHAT_LIST_SELECTOR) || node.querySelector(CHAT_LIST_SELECTOR) !== null))
      );
      if (currentWasDetached || couldIntroduceList) attachToCurrentList();
    });
    if (observerRoot) {
      bodyObserver.observe(observerRoot, { childList: true, subtree: true });
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      attachToCurrentList();
      restampCurrentList();
    }, 1e3);
    return {
      restampCurrentList,
      teardown() {
        detachObservedList();
        bodyObserver?.disconnect();
        window.clearInterval(intervalId);
        delayedPasses.forEach((timeoutId) => window.clearTimeout(timeoutId));
        delayedPasses.clear();
        bodyObserver = null;
      }
    };
  }
  var autoController = null;
  var stopReplyBridge = null;
  var stopCategoryLanguageBridge = null;
  var threadClickStamping = false;
  function start() {
    autoController ??= initReactKeyStamper();
    if (!threadClickStamping) {
      window.addEventListener("click", stampThreadPanelClick, true);
      threadClickStamping = true;
    }
    stopReplyBridge ??= installReplyBridge();
    stopCategoryLanguageBridge ??= installCategoryLanguageBridge();
  }
  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
  window.addEventListener("pagehide", () => {
    autoController?.teardown();
    autoController = null;
    stopReplyBridge?.();
    stopReplyBridge = null;
    stopCategoryLanguageBridge?.();
    stopCategoryLanguageBridge = null;
    window.removeEventListener("click", stampThreadPanelClick, true);
    threadClickStamping = false;
  });
  window.addEventListener("pageshow", start);
})();
