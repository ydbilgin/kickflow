"use strict";
(() => {
  // src/content/shared/logger.ts
  var debugEnabled = false;
  function setDebugLogging(enabled) {
    debugEnabled = enabled;
  }
  var logger = {
    debug(...args) {
      if (debugEnabled) console.debug("[KickFlow]", ...args);
    },
    info(...args) {
      if (debugEnabled) console.info("[KickFlow]", ...args);
    },
    warn(...args) {
      console.warn("[KickFlow]", ...args);
    },
    error(...args) {
      console.error("[KickFlow]", ...args);
    }
  };

  // src/content/shared/lifecycle.ts
  var Lifecycle = class {
    constructor() {
      this.disposers = [];
      this.disposed = false;
    }
    add(disposer) {
      if (this.disposed) {
        disposer();
        return;
      }
      this.disposers.push(disposer);
    }
    addEventListener(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      this.add(() => target.removeEventListener(type, listener, options));
    }
    setTimeout(handler, timeoutMs) {
      const id = window.setTimeout(() => {
        const index = this.disposers.indexOf(cancel);
        if (index !== -1) this.disposers.splice(index, 1);
        handler();
      }, timeoutMs);
      const cancel = () => window.clearTimeout(id);
      this.add(cancel);
    }
    setInterval(handler, intervalMs) {
      const id = window.setInterval(handler, intervalMs);
      this.add(() => window.clearInterval(id));
    }
    get isDisposed() {
      return this.disposed;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      let disposer;
      while (disposer = this.disposers.pop()) {
        try {
          disposer();
        } catch (error) {
          logger.error("lifecycle disposer threw", error);
        }
      }
    }
  };

  // src/content/shared/layout-watchdog.ts
  var LAYOUT_WATCHDOG_POLL_INTERVAL_MS = 500;
  var LAYOUT_WATCHDOG_RING_BUFFER_CAP = 120;
  var LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES = 200 * 1024;
  var LAYOUT_WATCHDOG_STORAGE_KEY = "kickflow-layout-watchdog";
  var LAYOUT_WATCHDOG_RECOVERY_COMMAND = `copy(localStorage.getItem('${LAYOUT_WATCHDOG_STORAGE_KEY}'))`;
  var SIDEBAR_COLLAPSED_WIDTH_PX = 60;
  var HORIZONTAL_OVERFLOW_TOLERANCE_PX = 2;
  var NAVBAR_ZERO_HEIGHT_PX = 0;
  var NAVBAR_TOP_EDGE_PX = 0;
  var WIDTH_BUDGET_TOLERANCE_PX = 30;
  var CONTROL_BAR_MISSING_CONSECUTIVE_POLLS = 2;
  var SIDEBAR_ROW_SELECTOR = '[data-testid^="sidebar-following-channel-"], [data-testid^="sidebar-recommended-channel-"]';
  var SIDEBAR_WRAPPER_SELECTOR = "#sidebar-wrapper";
  var LAYOUT_INVARIANT_NAMES = [
    "sidebar-collapsed",
    "horizontal-overflow",
    "navbar-offscreen",
    "width-budget",
    "control-bar-missing"
  ];
  function round(value) {
    return Math.round(value);
  }
  function measureRect(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height)
    };
  }
  function resolveNavbar(documentRef) {
    return Array.from(documentRef.querySelectorAll("nav")).find((nav) => !nav.closest(".kickflow-panel")) ?? null;
  }
  function findLayoutSidebar(documentRef) {
    const wrapper = documentRef.querySelector(SIDEBAR_WRAPPER_SELECTOR);
    if (wrapper) return wrapper;
    const rows = Array.from(documentRef.querySelectorAll(SIDEBAR_ROW_SELECTOR));
    const section = rows[0]?.closest("section") ?? null;
    if (section && rows.every((row) => section.contains(row))) return section;
    for (const aside of documentRef.querySelectorAll("aside")) {
      if (rows.some((row) => aside.contains(row))) return aside;
    }
    return null;
  }
  function resolveTheatreValue(wrapper) {
    return wrapper?.closest("[data-theatre]")?.getAttribute("data-theatre") ?? null;
  }
  function resolveControlBar(wrapper) {
    return wrapper?.querySelector("div.z-controls.bottom-0") ?? null;
  }
  function resolveWrapperClasses(wrapper) {
    return wrapper ? Array.from(wrapper.classList).sort() : null;
  }
  function captureLayoutSnapshot(documentRef, viewport) {
    const video = documentRef.querySelector("#video-player");
    const wrapper = video?.parentElement ?? null;
    const sidebar = findLayoutSidebar(documentRef);
    const documentElement = documentRef.documentElement;
    return {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      innerWidth: viewport.innerWidth,
      innerHeight: viewport.innerHeight,
      documentElement: documentElement ? {
        clientWidth: documentElement.clientWidth,
        scrollWidth: documentElement.scrollWidth
      } : null,
      fullscreen: documentRef.fullscreenElement != null,
      theatre: resolveTheatreValue(wrapper),
      navbar: measureRect(resolveNavbar(documentRef)),
      sidebar: measureRect(sidebar),
      video: measureRect(video),
      wrapper: measureRect(wrapper),
      chatMessages: measureRect(documentRef.querySelector("#chatroom-messages")),
      overlay: measureRect(documentRef.querySelector("#kickflow-chat-overlay")),
      controlBar: measureRect(resolveControlBar(wrapper)),
      wrapperClasses: resolveWrapperClasses(wrapper),
      kickflowControls: Array.from(
        documentRef.querySelectorAll('[id^="kickflow-"][id$="-controls"]')
      ).map((element) => ({ id: element.id, rect: measureRect(element) }))
    };
  }
  function isTheatreActive(snapshot) {
    return snapshot.theatre === "true";
  }
  function evaluateSidebarCollapsed(snapshot) {
    if (isTheatreActive(snapshot)) return "pass";
    if (!snapshot.sidebar) return "unverifiable";
    return snapshot.sidebar.width < SIDEBAR_COLLAPSED_WIDTH_PX ? "fail" : "pass";
  }
  function evaluateHorizontalOverflow(snapshot) {
    const documentElement = snapshot.documentElement;
    if (!documentElement) return "unverifiable";
    return documentElement.scrollWidth - documentElement.clientWidth > HORIZONTAL_OVERFLOW_TOLERANCE_PX ? "fail" : "pass";
  }
  function evaluateNavbarOffscreen(snapshot) {
    if (!snapshot.navbar) return "unverifiable";
    return snapshot.navbar.height <= NAVBAR_ZERO_HEIGHT_PX || snapshot.navbar.y < NAVBAR_TOP_EDGE_PX ? "fail" : "pass";
  }
  function evaluateWidthBudget(snapshot) {
    if (isTheatreActive(snapshot)) return "pass";
    if (!snapshot.sidebar || !snapshot.video || !snapshot.chatMessages) return "unverifiable";
    const usedWidth = snapshot.sidebar.width + snapshot.video.width + snapshot.chatMessages.width;
    return Math.abs(usedWidth - snapshot.innerWidth) > WIDTH_BUDGET_TOLERANCE_PX ? "fail" : "pass";
  }
  function evaluateControlBarMissing(snapshot) {
    if (!snapshot.wrapper || !snapshot.wrapperClasses) return "unverifiable";
    if (snapshot.wrapperClasses.includes("cursor-none")) return "pass";
    return snapshot.controlBar ? "pass" : "fail";
  }
  function evaluateLayoutInvariant(name, snapshot) {
    switch (name) {
      case "sidebar-collapsed":
        return evaluateSidebarCollapsed(snapshot);
      case "horizontal-overflow":
        return evaluateHorizontalOverflow(snapshot);
      case "navbar-offscreen":
        return evaluateNavbarOffscreen(snapshot);
      case "width-budget":
        return evaluateWidthBudget(snapshot);
      case "control-bar-missing":
        return evaluateControlBarMissing(snapshot);
    }
  }
  function evaluateLayoutInvariants(snapshot) {
    return Object.fromEntries(
      LAYOUT_INVARIANT_NAMES.map((name) => [name, evaluateLayoutInvariant(name, snapshot)])
    );
  }
  function resolveStorage() {
    try {
      return localStorage;
    } catch (error) {
      logger.warn("Layout watchdog could not access localStorage; trip records will not persist.", error);
      return null;
    }
  }
  function createDefaultRuntime(options) {
    const documentRef = options.document ?? document;
    const viewport = options.viewport ?? window;
    return {
      captureSnapshot: options.captureSnapshot ?? (() => captureLayoutSnapshot(documentRef, viewport)),
      setInterval: options.setInterval ?? ((handler, intervalMs) => window.setInterval(handler, intervalMs)),
      clearInterval: options.clearInterval ?? ((id) => window.clearInterval(id)),
      storage: options.storage === void 0 ? resolveStorage() : options.storage,
      now: options.now ?? (() => Date.now()),
      getUrl: options.getUrl ?? (() => window.location.href)
    };
  }
  function serializedByteLength(value) {
    return typeof TextEncoder === "function" ? new TextEncoder().encode(value).byteLength : value.length;
  }
  function isTripCount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  var LayoutWatchdog = class {
    constructor(options = {}) {
      this.intervalId = null;
      this.running = false;
      this.previousSerializedSnapshot = "";
      this.ringBuffer = [];
      this.invariantStates = /* @__PURE__ */ new Map();
      this.controlBarMissingPolls = 0;
      this.runtime = createDefaultRuntime(options);
    }
    get isRunning() {
      return this.running;
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.pollNow();
      this.intervalId = this.runtime.setInterval(
        () => this.pollNow(),
        LAYOUT_WATCHDOG_POLL_INTERVAL_MS
      );
    }
    stop() {
      if (this.intervalId !== null) {
        this.runtime.clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.running = false;
      this.previousSerializedSnapshot = "";
      this.ringBuffer.length = 0;
      this.invariantStates.clear();
      this.controlBarMissingPolls = 0;
    }
    /** Runs one owned poll without needing to wait for the scheduler. It is also the seam used by
     * deterministic tests; a stopped watchdog cannot read the DOM or write storage. */
    pollNow() {
      if (!this.running) return null;
      try {
        const snapshot = this.runtime.captureSnapshot();
        this.appendChangedSnapshot(snapshot);
        this.evaluateTransitions(snapshot);
        return snapshot;
      } catch (error) {
        logger.warn("Layout watchdog poll failed; the current layout sample was skipped.", error);
        return null;
      }
    }
    getRingBuffer() {
      return this.ringBuffer.slice();
    }
    appendChangedSnapshot(snapshot) {
      const serialized = JSON.stringify(snapshot);
      if (serialized === this.previousSerializedSnapshot) return;
      this.previousSerializedSnapshot = serialized;
      this.ringBuffer.push(snapshot);
      if (this.ringBuffer.length > LAYOUT_WATCHDOG_RING_BUFFER_CAP) this.ringBuffer.shift();
    }
    evaluateTransitions(snapshot) {
      const evaluations = evaluateLayoutInvariants(snapshot);
      for (const name of LAYOUT_INVARIANT_NAMES) {
        const result = this.resolveEffectiveResult(name, evaluations[name]);
        const previous = this.invariantStates.get(name);
        if ((previous === "pass" || previous === "unverifiable") && result === "fail") {
          this.persistTrip(name);
        }
        this.invariantStates.set(name, result);
      }
    }
    resolveEffectiveResult(name, result) {
      if (name !== "control-bar-missing") return result;
      if (result !== "fail") {
        this.controlBarMissingPolls = 0;
        return result;
      }
      this.controlBarMissingPolls++;
      return this.controlBarMissingPolls >= CONTROL_BAR_MISSING_CONSECUTIVE_POLLS ? "fail" : "pass";
    }
    readPersistedTripCount() {
      const storage = this.runtime.storage;
      if (!storage) return 0;
      try {
        const raw = storage.getItem(LAYOUT_WATCHDOG_STORAGE_KEY);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return 0;
        const tripCount = parsed.tripCount;
        return isTripCount(tripCount) ? tripCount : 0;
      } catch (error) {
        logger.warn("Layout watchdog could not read its localStorage trip counter.", error);
        return 0;
      }
    }
    persistTrip(invariant) {
      const storage = this.runtime.storage;
      if (!storage) {
        logger.warn("Layout watchdog could not persist this trip because localStorage is unavailable.");
        this.logTrip(invariant);
        return;
      }
      const record2 = {
        invariant,
        timestamp: new Date(this.runtime.now()).toISOString(),
        url: this.runtime.getUrl(),
        ringBuffer: this.ringBuffer.slice(),
        tripCount: this.readPersistedTripCount() + 1
      };
      let serialized = JSON.stringify(record2);
      while (serializedByteLength(serialized) > LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES && record2.ringBuffer.length > 0) {
        record2.ringBuffer.shift();
        serialized = JSON.stringify(record2);
      }
      if (serializedByteLength(serialized) > LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES) {
        logger.warn("Layout watchdog trip record exceeded its storage cap and was not written.");
        this.logTrip(invariant);
        return;
      }
      try {
        storage.setItem(LAYOUT_WATCHDOG_STORAGE_KEY, serialized);
      } catch (error) {
        logger.warn("Layout watchdog could not persist its trip record to localStorage.", error);
      }
      this.logTrip(invariant);
    }
    logTrip(invariant) {
      logger.warn(
        `Layout watchdog detected a "${invariant}" layout failure. Run this in the ordinary page console to recover the saved history: ${LAYOUT_WATCHDOG_RECOVERY_COMMAND}`
      );
    }
  };

  // src/content/shared/extension-context.ts
  function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }
  function getExtensionVersion() {
    try {
      return chrome?.runtime?.getManifest?.().version ?? "dev";
    } catch {
      return "dev";
    }
  }
  async function safeStorageGet(keys) {
    if (!isExtensionContextValid()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return {};
    }
  }
  async function safeStorageRemove(keys) {
    if (!isExtensionContextValid()) return false;
    try {
      await chrome.storage.local.remove(keys);
      return true;
    } catch {
      return false;
    }
  }
  async function safeStorageSet(items) {
    if (!isExtensionContextValid()) return false;
    try {
      await chrome.storage.local.set(items);
      return true;
    } catch {
      return false;
    }
  }

  // src/content/shared/i18n.ts
  var STORAGE_KEY = "kf_lang";
  var messages = {
    "overlay.failed": { en: "KickFlow could not start. Kick chat is available.", tr: "KickFlow ba\u015Flat\u0131lamad\u0131. Kick sohbeti a\xE7\u0131k." },
    "overlay.retry": { en: "Try again", tr: "Tekrar dene" },
    "overlay.gap": { en: "Connection gap \xB7 estimated missing messages: {n}", tr: "Ba\u011Flant\u0131 kesintisi \xB7 eksik mesaj tahmini: {n}" },
    "overlay.gap_time": { en: "Connection gap \xB7 about {n} seconds could not be recovered", tr: "Ba\u011Flant\u0131 kesintisi \xB7 yakla\u015F\u0131k {n} saniye al\u0131namad\u0131" },
    "player.controls": { en: "Video player controls", tr: "Video oynat\u0131c\u0131 denetimleri" },
    "player.clip_record": { en: "Record next 15 seconds locally", tr: "Sonraki 15 saniyeyi bilgisayara kaydet" },
    "player.clip_stop": { en: "Stop local recording and preview", tr: "Yerel kayd\u0131 durdur ve \xF6nizle" },
    "player.clip_preview": { en: "Local clip preview", tr: "Yerel klip \xF6nizlemesi" },
    "player.clip_save": { en: "Save WebM to Downloads", tr: "WebM dosyas\u0131n\u0131 \u0130ndirilenler klas\xF6r\xFCne kaydet" },
    "player.clip_ready": { en: "Clip ready. Preview and save below.", tr: "Klip haz\u0131r. \xD6nizleyip a\u015Fa\u011F\u0131dan kaydet." },
    "player.clip_recording": { en: "Recording next 15 seconds. Press again to stop.", tr: "Sonraki 15 saniye kaydediliyor. Durdurmak i\xE7in tekrar bas." },
    "player.clip_unsupported": { en: "Local recording is unavailable in this browser.", tr: "Bu taray\u0131c\u0131da yerel kay\u0131t kullan\u0131lam\u0131yor." },
    "player.capture_no_frame": { en: "Start playback before capturing a frame or clip.", tr: "G\xF6r\xFCnt\xFC veya klip almak i\xE7in \xF6nce videoyu oynat." },
    "player.capture_failed": { en: "Capture failed. This video may restrict recording.", tr: "Kay\u0131t al\u0131namad\u0131. Bu video kayda izin vermiyor olabilir." },
    "chat.reply_to": { en: "Reply to {name}", tr: "{name} kullan\u0131c\u0131s\u0131na yan\u0131tla" },
    "category.turkish_off": { en: "Show only Turkish streams (Kick language filter). Remembered on every category.", tr: "Yaln\u0131z T\xFCrk\xE7e yay\u0131nlar\u0131 g\xF6ster (Kick dil filtresi). Her kategoride hat\u0131rlan\u0131r." },
    "category.turkish_on": { en: "Turkish filter on. Click to show all languages.", tr: "T\xFCrk\xE7e filtresi a\xE7\u0131k. T\xFCm dilleri g\xF6stermek i\xE7in t\u0131kla." },
    "chat.thread_open": { en: "Thread", tr: "Yan Sohbet" },
    "chat.reply_unavailable": { en: "Kick's reply box was not found. Reload the page (F5); if this line comes back, Kick's page changed: send a screenshot of it.", tr: "Kick'in yan\u0131t kutusu bulunamad\u0131. Sayfay\u0131 yenile (F5); bu sat\u0131r yine \xE7\u0131karsa Kick sayfas\u0131 de\u011Fi\u015Fmi\u015F demektir, ekran g\xF6r\xFCnt\xFCs\xFCn\xFC g\xF6nder." },
    "chat.reply_wrong_room": { en: "This message belongs to another channel's chat. Reload the page (F5).", tr: "Bu mesaj a\xE7\u0131k kanal\u0131n sohbetine ait de\u011Fil. Sayfay\u0131 yenile (F5)." },
    "chat.reply_no_bridge": { en: "KickFlow's page helper is not loaded. Reload the page (F5).", tr: "KickFlow'un sayfa yard\u0131mc\u0131s\u0131 y\xFCklenmemi\u015F. Sayfay\u0131 yenile (F5)." },
    "chat.reply_followers_only": { en: "This chat is followers only; a reply cannot be written.", tr: "Bu sohbet takip\xE7ilere \xF6zel; yan\u0131t yaz\u0131lam\u0131yor." },
    "chat.reply_subscribers_only": { en: "This chat is subscribers only; a reply cannot be written.", tr: "Bu sohbet abonelere \xF6zel; yan\u0131t yaz\u0131lam\u0131yor." },
    "chat.reply_login_required": { en: "Sign in to write a reply in this chat.", tr: "Bu sohbette yan\u0131t yazmak i\xE7in giri\u015F yap." },
    "chat.reply_rules_required": { en: "Accept the native chat rules to write a reply.", tr: "Yan\u0131t yazmak i\xE7in yerel sohbet kurallar\u0131n\u0131 kabul et." },
    "chat.reply_no_editor": { en: "This chat has no writable message field; a reply cannot be written.", tr: "Bu sohbette yaz\u0131 yaz\u0131lam\u0131yor; kullan\u0131labilir mesaj alan\u0131 yok." },
    "setting.floating_strip": { en: "Cinema strip", tr: "Sinema \u015Feridi" },
    "setting.floating_strip_desc": { en: "Kick's player bar floats as one glass strip over a soft dark fade. Off: Kick's flat bar with KickFlow's plate.", tr: "Kick\u2019in oynat\u0131c\u0131 \xE7ubu\u011Fu yumu\u015Fak bir koyu ge\xE7i\u015Fin \xFCst\xFCnde tek par\xE7a cam \u015Ferit olur. Kapal\u0131: Kick\u2019in d\xFCz \xE7ubu\u011Fu ve KickFlow plakas\u0131." },
    "player.to_live": { en: "Live", tr: "Canl\u0131ya" },
    "player.seconds_short": { en: "s", tr: "sn" },
    "player.forward_at_live": { en: "Already at live", tr: "Zaten canl\u0131das\u0131n" },
    "player.speed_menu_title": { en: "Playback speed", tr: "Oynatma h\u0131z\u0131" },
    "player.speed_auto_title": { en: "Catch up with live", tr: "Canl\u0131ya otomatik yeti\u015F" },
    "player.speed_auto_hint": { en: "Up to 1.5\xD7 when behind, 1\xD7 at live", tr: "Geride kal\u0131nca en \xE7ok 1,5\xD7, canl\u0131da 1\xD7" },
    "player.speed_manual_hint": { en: "Picking a speed turns Auto off", tr: "Elle h\u0131z se\xE7mek Otomatik\u2019i kapat\u0131r" },
    "player.speed_catching": { en: "Speed {rate}, catching up with live", tr: "H\u0131z {rate}, canl\u0131ya yeti\u015Fiyor" },
    "player.frame_saved": { en: "Frame saved", tr: "Kare kaydedildi" },
    "common.close": { en: "Close", tr: "Kapat" },
    "common.change": { en: "Change", tr: "De\u011Fi\u015Ftir" },
    "common.reset_defaults": { en: "Reset to defaults", tr: "Varsay\u0131lana d\xF6n" },
    "common.connected": { en: "Connected", tr: "Ba\u011Fl\u0131" },
    "common.waiting": { en: "Waiting", tr: "Bekliyor" },
    "common.yes": { en: "yes", tr: "evet" },
    "common.no": { en: "no", tr: "hay\u0131r" },
    "common.space": { en: "Space", tr: "Bo\u015Fluk" },
    "event.subscription.new": { en: "subscribed", tr: "abone oldu" },
    "event.subscription.months": {
      en: { one: "subscribed for {n} month", other: "subscribed for {n} months" },
      tr: { one: "{n} ay abone oldu", other: "{n} ay abone oldu" }
    },
    "event.celebration.months": {
      en: { one: "resubscribed for {n} month", other: "resubscribed for {n} months" },
      tr: { one: "{n}. abonelik ay\u0131n\u0131 kutlad\u0131", other: "{n}. abonelik ay\u0131n\u0131 kutlad\u0131" }
    },
    "event.gift.single": { en: " gifted a sub to {name}", tr: ", {name} kullan\u0131c\u0131s\u0131na abonelik hediye etti" },
    "event.gift.bulk": {
      en: { one: "gifted a sub to {n} person", other: "gifted a sub to {n} people" },
      tr: { one: "{n} ki\u015Fiye abonelik hediye etti", other: "{n} ki\u015Fiye abonelik hediye etti" }
    },
    "event.gift.more": {
      en: { one: " and {n} more", other: " and {n} more" },
      tr: { one: " ve {n} ki\u015Fi daha", other: " ve {n} ki\u015Fi daha" }
    },
    "event.kicks": { en: "gifted {n} KICKs", tr: "{n} KICKs hediye etti" },
    "event.host.viewers": {
      en: { one: "hosted with {n} viewer", other: "hosted with {n} viewers" },
      tr: { one: "{n} izleyiciyle host etti", other: "{n} izleyiciyle host etti" }
    },
    "event.host": { en: "hosted", tr: "host etti" },
    "modaction.ban.single": { en: "{mod} banned {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 banlad\u0131." },
    "modaction.ban.single.unknown": { en: "A moderator banned {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 banlad\u0131." },
    "modaction.ban.bulk": { en: "{mod} banned {n} users:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 banlad\u0131:" },
    "modaction.ban.bulk.unknown": { en: "A moderator banned {n} users:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 banlad\u0131:" },
    "modaction.timeout.single": { en: "{mod} timed out {name} for {duration}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 {duration} susturdu." },
    "modaction.timeout.single.unknown": { en: "A moderator timed out {name} for {duration}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 {duration} susturdu." },
    "modaction.timeout.single.no_duration": { en: "{mod} timed out {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 susturdu." },
    "modaction.timeout.single.no_duration.unknown": { en: "A moderator timed out {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 susturdu." },
    "modaction.timeout.bulk": { en: "{mod} timed out {n} users:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 susturdu:" },
    "modaction.timeout.bulk.unknown": { en: "A moderator timed out {n} users:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 susturdu:" },
    "modaction.timeout.bulk.duration": { en: "{mod} timed out {n} users for {duration}:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 {duration} susturdu:" },
    "modaction.timeout.bulk.duration.unknown": { en: "A moderator timed out {n} users for {duration}:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 {duration} susturdu:" },
    "modaction.delete.single": { en: "{mod} deleted a message from {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131n\u0131n mesaj\u0131n\u0131 sildi." },
    "modaction.delete.single.unknown": { en: "A moderator deleted a message from {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131n\u0131n mesaj\u0131n\u0131 sildi." },
    "modaction.delete.bulk": { en: "{mod} deleted {n} messages:", tr: "{mod}, {n} mesaj\u0131 sildi:" },
    "modaction.delete.bulk.unknown": { en: "A moderator deleted {n} messages:", tr: "Bir moderat\xF6r, {n} mesaj\u0131 sildi:" },
    "modaction.tag.ban": { en: "BAN", tr: "BAN" },
    "modaction.tag.timeout": { en: "TIMEOUT", tr: "SUSTURMA" },
    "modaction.tag.delete": { en: "DELETED", tr: "S\u0130L\u0130ND\u0130" },
    "modaction.tag.unknown": { en: "MODERATION", tr: "MODERASYON" },
    "modaction.unknown.single": { en: "{mod} moderated {name}; action type unknown.", tr: "{mod}, {name} i\xE7in moderasyon uygulad\u0131; t\xFCr\xFC bilinmiyor." },
    "modaction.unknown.single.no_moderator": { en: "A moderator acted on {name}; action type unknown.", tr: "Bir moderat\xF6r, {name} i\xE7in i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor." },
    "modaction.unknown.bulk": { en: "{mod} moderated {n} users; action type unknown:", tr: "{mod}, {n} kullan\u0131c\u0131ya i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor:" },
    "modaction.unknown.bulk.no_moderator": { en: "A moderator acted on {n} users; action type unknown:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131ya i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor:" },
    "modaction.more": { en: { one: "and {n} more", other: "and {n} more" }, tr: { one: "ve {n} ki\u015Fi daha", other: "ve {n} ki\u015Fi daha" } },
    "modaction.moderator_profile_title": { en: "Open moderator {name}'s profile", tr: "{name} moderat\xF6r profilini a\xE7" },
    "modaction.target_profile_title": { en: "Open {name}'s profile", tr: "{name} profilini a\xE7" },
    "modaction.target_jump_title": { en: "Jump to {name}'s retained message", tr: "{name} kullan\u0131c\u0131s\u0131n\u0131n korunmu\u015F mesaj\u0131na git" },
    "modaction.dismiss": { en: "Dismiss moderator action notice", tr: "Moderat\xF6r i\u015Flem bildirimini kapat" },
    "event.mode.slow_on": { en: "Slow mode on ({n}s)", tr: "Yava\u015F mod a\xE7\u0131ld\u0131 ({n}sn)" },
    "event.mode.slow_off": { en: "Slow mode off", tr: "Yava\u015F mod kapand\u0131" },
    "event.mode.followers_on": { en: "Followers-only mode on", tr: "Sadece takip\xE7i modu a\xE7\u0131ld\u0131" },
    "event.mode.followers_on_minutes": { en: "Followers-only mode on ({n}m)", tr: "Sadece takip\xE7i modu a\xE7\u0131ld\u0131 ({n}dk)" },
    "event.mode.followers_off": { en: "Followers-only mode off", tr: "Sadece takip\xE7i modu kapand\u0131" },
    "event.mode.subscribers_on": { en: "Subscribers-only mode on", tr: "Sadece abone modu a\xE7\u0131ld\u0131" },
    "event.mode.subscribers_off": { en: "Subscribers-only mode off", tr: "Sadece abone modu kapand\u0131" },
    "event.mode.emotes_on": { en: "Emotes-only mode on", tr: "Sadece emote modu a\xE7\u0131ld\u0131" },
    "event.mode.emotes_off": { en: "Emotes-only mode off", tr: "Sadece emote modu kapand\u0131" },
    "message.deleted": { en: "DELETED", tr: "S\u0130L\u0130ND\u0130" },
    "message.deleted_by.ai": { en: "AI mod", tr: "AI mod" },
    "message.deleted_by.mod": { en: "moderator", tr: "moderat\xF6r" },
    "message.banned": { en: "BANNED", tr: "BANLANDI" },
    "message.moderation_unknown": { en: "MODERATION TYPE UNKNOWN", tr: "MODERASYON T\xDCR\xDC B\u0130L\u0130NM\u0130YOR" },
    "message.timeout": { en: "TIMEOUT", tr: "TIMEOUT" },
    "duration.minutes_short": { en: "{n}M", tr: "{n}DK" },
    "duration.hours_short": { en: "{n}H", tr: "{n}SA" },
    "duration.hours_minutes_short": { en: "{h}H {m}M", tr: "{h}SA {m}DK" },
    "duration.days_short": { en: "{n}D", tr: "{n}G" },
    "badge.badge": { en: "badge", tr: "rozet" },
    "badge.level": { en: "Level {n}", tr: "{n}. Seviye" },
    "badge.moderator": { en: "Moderator", tr: "Moderat\xF6r" },
    "badge.vip": { en: "VIP", tr: "VIP" },
    "badge.og": { en: "OG", tr: "OG" },
    "badge.gift_subscriber": { en: "Gift Subscriber", tr: "Hediye Aboneli\u011Fi" },
    "badge.verified_streamer": { en: "Verified Streamer", tr: "Onayl\u0131 Yay\u0131nc\u0131" },
    "badge.kick_staff": { en: "Kick Staff", tr: "Kick Ekibi" },
    "badge.broadcaster": { en: "Broadcaster", tr: "Yay\u0131nc\u0131" },
    "badge.founder": { en: "Founder", tr: "Kurucu" },
    "badge.sidekick": { en: "Sidekick", tr: "Sidekick" },
    "badge.bot": { en: "Bot", tr: "Bot" },
    "badge.trainwreckstv": { en: "Train's Army", tr: "Train\u2019s Army" },
    "badge.subscriber": { en: "Subscriber", tr: "Abone" },
    "badge.subscriber_months": { en: "Subscriber, {n} months", tr: "Abone \u2014 {n} ay" },
    "panel.control_panel": { en: "CONTROL PANEL", tr: "KONTROL PANEL\u0130" },
    "panel.sections": { en: "KickFlow sections", tr: "KickFlow b\xF6l\xFCmleri" },
    "panel.close_aria": { en: "Close KickFlow panel", tr: "KickFlow panelini kapat" },
    "tab.general": { en: "General", tr: "Genel" },
    "tab.removed": { en: "Removed", tr: "Kald\u0131r\u0131lanlar" },
    "tab.chat": { en: "Chat", tr: "Sohbet" },
    "tab.player": { en: "Player", tr: "Oynat\u0131c\u0131" },
    "tab.rewards": { en: "Rewards", tr: "\xD6d\xFCller" },
    "tab.search": { en: "Search", tr: "Arama" },
    "tab.shortcuts": { en: "Shortcuts", tr: "K\u0131sayollar" },
    "tab.about": { en: "About", tr: "Hakk\u0131nda" },
    "search.placeholder": { en: "Search chat messages\u2026", tr: "Sohbet mesajlar\u0131nda ara\u2026" },
    "search.hint": {
      en: 'Searches every message seen on this channel since the page was opened. Use words, "phrases", from:name, or -excluded terms.',
      tr: 'Sayfa a\xE7\u0131ld\u0131\u011F\u0131ndan beri bu kanalda g\xF6r\xFClen t\xFCm mesajlarda arar. Kelimeler, "ifadeler", from:ad veya -hari\xE7 terimler kullan.'
    },
    "search.unavailable": {
      en: "No chat archive on this page \u2014 open a channel or a VOD.",
      tr: "Bu sayfada sohbet ar\u015Fivi yok \u2014 bir kanal veya VOD a\xE7."
    },
    "search.empty": { en: "No message matches.", tr: "E\u015Fle\u015Fen mesaj yok." },
    "search.widened": {
      en: "No exact match. Showing loose sender-name matches.",
      tr: "Tam e\u015Fle\u015Fme yok. Gev\u015Fek g\xF6nderen ad\u0131 e\u015Fle\u015Fmeleri g\xF6steriliyor."
    },
    "search.count": {
      en: { one: "{n} match", other: "{n} matches" },
      tr: { one: "{n} sonu\xE7", other: "{n} sonu\xE7" }
    },
    "search.count_capped": {
      en: { one: "{n} match, newest {shown} shown", other: "{n} matches, newest {shown} shown" },
      tr: { one: "{n} sonu\xE7, en yenisi {shown} tanesi g\xF6steriliyor", other: "{n} sonu\xE7, en yeni {shown} tanesi g\xF6steriliyor" }
    },
    "search.truncated": {
      en: "Older messages have already been dropped from the archive.",
      tr: "Daha eski mesajlar ar\u015Fivden d\xFC\u015Fm\xFC\u015Ft\xFC."
    },
    "search.hotkey_hint": { en: "Ctrl+F opens this tab.", tr: "Ctrl+F bu sekmeyi a\xE7ar." },
    "panel.removed_count": { en: "Removed, {n} messages", tr: "Kald\u0131r\u0131lanlar, {n} mesaj" },
    "panel.removed_empty": { en: "No removed messages yet", tr: "Hen\xFCz kald\u0131r\u0131lan mesaj yok" },
    "panel.removed_no_session": { en: "No channel session is active.", tr: "Etkin bir kanal oturumu yok." },
    "panel.general_intro": { en: "Monitor this session and choose the primary chat view.", tr: "Oturum durumunu izle ve temel sohbet g\xF6r\xFCn\xFCm\xFCn\xFC se\xE7." },
    "panel.live_status": { en: "Live status", tr: "Canl\u0131 durum" },
    "stat.connection": { en: "Connection", tr: "Ba\u011Flant\u0131" },
    "stat.channel": { en: "Channel", tr: "Kanal" },
    "stat.chatroom_id": { en: "Chatroom ID", tr: "Sohbet odas\u0131 no" },
    "stat.pusher": { en: "Pusher", tr: "Canl\u0131 ba\u011Flant\u0131" },
    "stat.messages": { en: "Messages", tr: "Mesaj" },
    "stat.preserved": { en: "Preserved", tr: "Korunan" },
    "stat.bans": { en: "Bans", tr: "Ban" },
    "stat.deletions": { en: "Deletions", tr: "Silme" },
    "stat.ghost_inline": { en: "Ghost inline", tr: "Silinen, yerinde" },
    "stat.ghost_pending": { en: "Ghost pending", tr: "Silinen, yer bekliyor" },
    "stat.ghost_evicted": { en: "Ghost evicted", tr: "Silinen, d\xFC\u015F\xFCr\xFCld\xFC" },
    "stat.last_ban": { en: "Last ban", tr: "Son ban" },
    "panel.chat_view": { en: "Chat view", tr: "Sohbet g\xF6r\xFCn\xFCm\xFC" },
    "panel.chat_mode": { en: "Chat mode", tr: "Sohbet modu" },
    "panel.chat_mode_desc": { en: "Use Kick's native chat or the KickFlow list.", tr: "Kick\u2019in yerel sohbetini veya KickFlow listesini kullan." },
    "panel.language": { en: "Language", tr: "Dil" },
    "panel.language_desc": { en: "Choose the language used by KickFlow.", tr: "KickFlow aray\xFCz dilini se\xE7." },
    "panel.removed_intro": { en: "Review messages banned, timed out, or deleted in this channel.", tr: "Bu kanalda banlanan, zaman a\u015F\u0131m\u0131na u\u011Frayan ve silinen mesajlar\u0131 incele." },
    "panel.removed_aria": { en: "Removed messages", tr: "Kald\u0131r\u0131lan mesajlar" },
    "panel.filtered_user": { en: "Filtered: {name}", tr: "Filtre: {name}" },
    "panel.clear_user_filter": { en: "Clear filter for {name}", tr: "{name} filtresini temizle" },
    "panel.chat_intro": { en: "Choose which KickFlow enhancements appear in the chat feed.", tr: "Sohbet ak\u0131\u015F\u0131nda hangi KickFlow iyile\u015Ftirmelerinin g\xF6r\xFCnece\u011Fini se\xE7." },
    "setting.show_deleted": { en: "Show deleted messages", tr: "Silinenleri g\xF6ster" },
    "setting.show_deleted_desc": { en: "Keeps moderator-deleted messages visible.", tr: "Moderat\xF6rlerin sildi\u011Fi mesajlar\u0131 g\xF6r\xFCn\xFCr tutar." },
    "setting.inline_bans": { en: "Inline bans", tr: "Ban sat\u0131r-i\xE7i" },
    "setting.inline_bans_desc": { en: "Preserves banned users\u2019 recent messages in the feed.", tr: "Banlanan kullan\u0131c\u0131lar\u0131n son mesajlar\u0131n\u0131 ak\u0131\u015Fta korur." },
    "setting.subscriptions": { en: "Subscriptions", tr: "Abonelikler" },
    "setting.subscriptions_desc": { en: "Shows new subscription events.", tr: "Yeni abonelik etkinliklerini g\xF6sterir." },
    "setting.gifted_subscriptions": { en: "Gifted subscriptions", tr: "Hediye abonelikler" },
    "setting.gifted_subscriptions_desc": { en: "Shows gifted-subscription events.", tr: "Hediye abonelik etkinliklerini g\xF6sterir." },
    "setting.kicks": { en: "Kicks / donations", tr: "Kicks / ba\u011F\u0131\u015Flar" },
    "setting.kicks_desc": { en: "Adds paid Kicks donation events to the chat feed.", tr: "\xDCcretli Kicks ba\u011F\u0131\u015F etkinliklerini sohbet ak\u0131\u015F\u0131na ekler." },
    "setting.host_raid": { en: "Host / Raid", tr: "Host / Raid" },
    "setting.host_raid_desc": { en: "Adds host and raid events to the chat feed.", tr: "Host ve raid etkinliklerini sohbet ak\u0131\u015F\u0131na ekler." },
    "setting.mode_changes": { en: "Mode changes", tr: "Mod de\u011Fi\u015Fiklikleri" },
    "setting.mode_changes_desc": { en: "Reports chat setting changes such as slow mode.", tr: "Yava\u015F mod gibi sohbet ayar\u0131 de\u011Fi\u015Fikliklerini bildirir." },
    "setting.chatters_badges": { en: "Active chatter badges", tr: "Aktif sohbet\xE7i rozetleri" },
    "setting.chatters_badges_desc": { en: "Shows session removed-message evidence beside native chatter rows.", tr: "Yerel sohbet\xE7i sat\u0131rlar\u0131nda oturumdaki kald\u0131r\u0131lan mesaj kan\u0131tlar\u0131n\u0131 g\xF6sterir." },
    "setting.search_hotkey": { en: "Ctrl+F opens chat search", tr: "Ctrl+F sohbet aramas\u0131n\u0131 a\xE7ar" },
    "setting.search_hotkey_desc": {
      en: "Off returns Ctrl+F to the browser\u2019s page find. The Search tab stays available either way.",
      tr: "Kapal\u0131yken Ctrl+F taray\u0131c\u0131n\u0131n sayfa aramas\u0131na d\xF6ner. Arama sekmesi her durumda a\xE7\u0131k kal\u0131r."
    },
    "setting.user_messages": { en: "Messages this session", tr: "Bu oturumdaki mesajlar" },
    "setting.user_messages_desc": { en: "Shows this user\u2019s messages retained during the current session.", tr: "Bu kullan\u0131c\u0131n\u0131n mevcut oturumda tutulan mesajlar\u0131n\u0131 g\xF6sterir." },
    "setting.hide_quick_emotes": { en: "Hide quick emote bar", tr: "H\u0131zl\u0131 emoji \xE7ubu\u011Funu gizle" },
    "setting.hide_quick_emotes_desc": { en: "Hides Kick\u2019s emote shortcuts above chat input. The emote picker still works.", tr: "Sohbet giri\u015Finin \xFCst\xFCndeki Kick emoji k\u0131sayollar\u0131n\u0131 gizler. Emoji se\xE7ici \xE7al\u0131\u015Fmaya devam eder." },
    "setting.mod_actions": { en: "Moderator action notices", tr: "Moderat\xF6r i\u015Flem bildirimleri" },
    "setting.mod_actions_desc": { en: "Shows docked notices when messages are banned, timed out, or deleted.", tr: "Mesajlar banland\u0131\u011F\u0131nda, zaman a\u015F\u0131m\u0131na u\u011Frad\u0131\u011F\u0131nda veya silindi\u011Finde sabit bildirimler g\xF6sterir." },
    "setting.mention_highlight": { en: "Highlight replies to me / mentions of me", tr: "Bana yan\u0131t verildi\u011Finde / benden bahsedildi\u011Finde vurgula" },
    "setting.mention_highlight_desc": { en: "Frames or fills chat rows that @mention you or reply to your messages.", tr: "Seni @bahseden veya mesaj\u0131na yan\u0131t veren sat\u0131rlar\u0131 \xE7er\xE7eveler ya da doldurur." },
    "setting.mention_style": { en: "Highlight style", tr: "Vurgu stili" },
    "setting.mention_style_desc": { en: "Outline, fill, or both.", tr: "\xC7er\xE7eve, dolgu veya her ikisi." },
    "setting.mention_style_frame": { en: "Frame", tr: "\xC7er\xE7eve" },
    "setting.mention_style_fill": { en: "Fill", tr: "Dolgu" },
    "setting.mention_style_both": { en: "Both", tr: "Her ikisi" },
    "setting.mention_color": { en: "Highlight color", tr: "Vurgu rengi" },
    "setting.mention_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.mention_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "setting.manual_username": { en: "Your Kick username", tr: "Kick kullan\u0131c\u0131 ad\u0131n" },
    "setting.manual_username_desc": { en: "Fallback if auto-detection fails.", tr: "Otomatik alg\u0131lama ba\u015Far\u0131s\u0131z olursa yedek." },
    "setting.manual_username_placeholder": { en: "e.g. your_kick_name", tr: "\xF6r. kick_kullanici_adin" },
    "setting.identity_unresolved": { en: "Kick identity was not detected \u2014 you can type your username above.", tr: "Kick kimli\u011Fin alg\u0131lanamad\u0131 \u2014 yukar\u0131ya kullan\u0131c\u0131 ad\u0131n\u0131 yazabilirsin." },
    "setting.role_style": { en: "Moderator / VIP style", tr: "Moderat\xF6r / VIP stili" },
    "setting.role_style_desc": { en: "Keep the left bar only, or add a faint row fill.", tr: "Yaln\u0131zca sol \xE7ubu\u011Fu kullan veya hafif bir sat\u0131r dolgusu ekle." },
    "setting.role_style_frame": { en: "Bar only", tr: "Yaln\u0131z \xE7ubuk" },
    "setting.role_style_both": { en: "Bar + fill", tr: "\xC7ubuk + dolgu" },
    "setting.role_colors": { en: "Role colors", tr: "Rol renkleri" },
    "setting.role_colors_desc": { en: "Customize moderator and VIP colors.", tr: "Moderat\xF6r ve VIP renklerini \xF6zelle\u015Ftir." },
    "setting.mod_frame": { en: "Highlight moderator messages", tr: "Moderat\xF6r mesajlar\u0131n\u0131 vurgula" },
    "setting.mod_frame_desc": { en: "Uses the shared role style and moderator color.", tr: "Ortak rol stilini ve moderat\xF6r rengini kullan\u0131r." },
    "setting.mod_frame_color": { en: "Moderator color", tr: "Moderat\xF6r rengi" },
    "setting.mod_frame_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.mod_frame_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "setting.vip_frame": { en: "Highlight VIP messages", tr: "VIP mesajlar\u0131n\u0131 vurgula" },
    "setting.vip_frame_desc": { en: "Uses the shared role style and VIP color.", tr: "Ortak rol stilini ve VIP rengini kullan\u0131r." },
    "setting.vip_frame_color": { en: "VIP color", tr: "VIP rengi" },
    "setting.vip_frame_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.vip_frame_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "chatters.removed_count": {
      en: { one: "{n} removed", other: "{n} removed" },
      tr: { one: "{n} kald\u0131r\u0131ld\u0131", other: "{n} kald\u0131r\u0131ld\u0131" }
    },
    "chatters.open_removed": { en: "Review {n} removed messages from {name}", tr: "{name} i\xE7in kald\u0131r\u0131lan {n} mesaj\u0131 incele" },
    "panel.player_intro": { en: "Manage playback and tools added to the native control bar.", tr: "Yay\u0131n oynat\u0131m\u0131n\u0131 ve yerel kontrol \xE7ubu\u011Funa eklenen ara\xE7lar\u0131 y\xF6net." },
    "panel.rewards_intro": {
      en: "Manage Kick Drops and daily rewards from this tab. Drops use Kick's own button; daily rewards briefly open and close Kick's reward window. Neither feature touches channel points.",
      tr: "Kick Drops ve g\xFCnl\xFCk \xF6d\xFCllerini bu sekmeden y\xF6net. Drops, Kick\u2019in kendi d\xFC\u011Fmesiyle al\u0131n\u0131r; g\xFCnl\xFCk \xF6d\xFCl i\xE7in Kick\u2019in \xF6d\xFCl penceresi k\u0131sa s\xFCre a\xE7\u0131l\u0131p kapan\u0131r. \u0130ki \xF6zellik de kanal puanlar\u0131na dokunmaz."
    },
    "setting.auto_theater": { en: "Automatic theater mode", tr: "Otomatik tiyatro modu" },
    "setting.auto_theater_desc": { en: "Switches to the wide player layout when a channel opens.", tr: "Kanal a\xE7\u0131ld\u0131\u011F\u0131nda geni\u015F oynat\u0131c\u0131 d\xFCzenine ge\xE7er." },
    "setting.caption_guard": { en: "Keep captions off by default", tr: "Altyaz\u0131y\u0131 varsay\u0131lan olarak kapal\u0131 tut" },
    "setting.caption_guard_desc": { en: "Prevents Kick from silently restoring captions after a reload. You can still turn them on manually for the current session.", tr: "Kick\u2019in altyaz\u0131y\u0131 yenilemeden sonra sessizce geri a\xE7mas\u0131n\u0131 \xF6nler. Ge\xE7erli oturumda yine elle a\xE7abilirsin." },
    "setting.seek": { en: "Seek back / forward", tr: "Geri / ileri sarma" },
    "setting.seek_desc": { en: "Adds 10-second seek buttons to the control bar.", tr: "Kontrol \xE7ubu\u011Funa 10 saniyelik sarma d\xFC\u011Fmeleri ekler." },
    "setting.seek_bar": { en: "Seek bar", tr: "Sarma \xE7ubu\u011Fu" },
    "setting.seek_bar_desc": { en: "Draws the green position bar whenever Kick leaves it out, which it often does on a live stream.", tr: "Kick canl\u0131 yay\u0131nda s\u0131k s\u0131k \xE7izmedi\u011Fi ye\u015Fil konum \xE7ubu\u011Funu, \xE7izmedi\u011Fi zaman bizim \xE7izmemizi sa\u011Flar." },
    "setting.live_catchup": { en: "Live catch-up", tr: "Canl\u0131ya yeti\u015Fme" },
    "setting.live_catchup_desc": { en: "Carefully accelerates playback when the stream falls behind.", tr: "Geride kal\u0131nca yay\u0131n\u0131 kontroll\xFC bi\xE7imde h\u0131zland\u0131r\u0131r." },
    "setting.quality_lock": { en: "Quality button", tr: "Kalite d\xFC\u011Fmesi" },
    "setting.quality_always_best": { en: "Open every stream at the highest quality", tr: "Her yay\u0131n\u0131 en y\xFCksek kalitede a\xE7" },
    "setting.quality_always_best_desc": { en: "A quality you pick by hand holds for that stream only; the next stream opens at the highest again. Off: your last pick is remembered.", tr: "Elle se\xE7ti\u011Fin kalite yaln\u0131z o yay\u0131nda kal\u0131r; sonraki yay\u0131n yine en y\xFCksekte a\xE7\u0131l\u0131r. Kapal\u0131yken son se\xE7imin hat\u0131rlan\u0131r." },
    "setting.quality_lock_desc": { en: "Shows the quality button on the player bar and keeps the quality you pick there.", tr: "Oynat\u0131c\u0131 bar\u0131nda kalite d\xFC\u011Fmesini g\xF6sterir ve orada se\xE7ti\u011Fin kaliteyi korur." },
    "setting.screenshot": { en: "Screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC" },
    "setting.screenshot_desc": { en: "Adds a frame-capture button to the control bar.", tr: "Kontrol \xE7ubu\u011Funa kare yakalama d\xFC\u011Fmesi ekler." },
    "setting.speed": { en: "Speed controls", tr: "H\u0131z kontrolleri" },
    "setting.speed_desc": { en: "Shows manual and automatic playback-speed tools.", tr: "Manuel ve otomatik oynatma h\u0131z\u0131 ara\xE7lar\u0131n\u0131 g\xF6sterir." },
    "setting.fullscreen_terminal": { en: "Fullscreen terminal slot", tr: "Tam ekran\u0131 sona al" },
    "setting.fullscreen_terminal_desc": { en: "Moves Kick's fullscreen button after the settings control with CSS order; the DOM stays unchanged.", tr: "Kick\u2019in tam ekran d\xFC\u011Fmesini CSS order ile ayarlar kontrol\xFCn\xFCn arkas\u0131na al\u0131r; DOM de\u011Fi\u015Fmez." },
    "setting.auto_claim_drops": { en: "Auto-claim Drops", tr: "Drops \xF6d\xFCllerini otomatik al" },
    "setting.auto_claim_drops_desc": {
      en: "On the channel you watch, automatically claims Kick Drops rewards when a reward reaches 100% by clicking Kick's own Claim button. Only while this Kick tab is open: it never calls a Kick API or runs as a background service. Never touches channel points; spending them is your choice.",
      tr: "\u0130zledi\u011Fin kanalda bir Kick Drops \xF6d\xFCl\xFC %100\u2019e ula\u015Ft\u0131\u011F\u0131nda Kick\u2019in kendi alma d\xFC\u011Fmesine t\u0131klayarak otomatik al\u0131r. Yaln\u0131zca Kick sekmesi a\xE7\u0131kken \xE7al\u0131\u015F\u0131r; Kick\u2019e kendi ba\u015F\u0131na istek g\xF6ndermez ve arka planda \xE7al\u0131\u015Fmaz. Kanal puanlar\u0131na hi\xE7 dokunmaz; onlar\u0131 harcay\u0131p harcamamak senin karar\u0131n."
    },
    "setting.auto_claim_daily_reward": { en: "Auto-claim daily reward", tr: "G\xFCnl\xFCk \xF6d\xFCl\xFC otomatik al" },
    "setting.auto_claim_daily_reward_desc": {
      en: "Automatically claims Kick's daily reward by briefly opening and closing Kick's own reward window. It runs only while this Kick tab is open and never touches channel points.",
      tr: "Kick\u2019in g\xFCnl\xFCk \xF6d\xFCl\xFCn\xFC, kendi \xF6d\xFCl penceresini k\u0131sa s\xFCre a\xE7\u0131p kapatarak senin i\xE7in otomatik al\u0131r. Yaln\u0131zca bu Kick sekmesi a\xE7\u0131kken \xE7al\u0131\u015F\u0131r ve kanal puanlar\u0131na hi\xE7 dokunmaz."
    },
    "panel.shortcuts_intro": { en: "Run player actions with one key. Shortcuts are disabled while typing.", tr: "Oynat\u0131c\u0131 eylemlerini tek tu\u015Fla \xE7al\u0131\u015Ft\u0131r. Yaz\u0131 alan\u0131ndayken k\u0131sayollar devre d\u0131\u015F\u0131d\u0131r." },
    "panel.changes_live": { en: "Changes apply immediately.", tr: "De\u011Fi\u015Fiklikler an\u0131nda uygulan\u0131r." },
    "about.copy": { en: "A personal browser extension that streamlines Kick chat and live viewing.", tr: "Kick sohbetini ve canl\u0131 yay\u0131n deneyimini sadele\u015Ftiren ki\u015Fisel bir taray\u0131c\u0131 eklentisi." },
    "about.version": { en: "Version", tr: "S\xFCr\xFCm" },
    "about.platform": { en: "Platform", tr: "Platform" },
    "about.application": { en: "Application", tr: "Uygulama" },
    "about.application_value": { en: "Runs inside kick.com", tr: "kick.com i\xE7inde \xE7al\u0131\u015F\u0131r" },
    "hotkey.rewind": { en: "10s back", tr: "10 sn geri" },
    "hotkey.forward": { en: "10s forward", tr: "10 sn ileri" },
    "hotkey.screenshot": { en: "Screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC" },
    "hotkey.go_live": { en: "Go live", tr: "Canl\u0131ya d\xF6n" },
    "hotkey.enable_aria": { en: "Enable {name} shortcut", tr: "{name} k\u0131sayolunu etkinle\u015Ftir" },
    "hotkey.change_aria": { en: "Change {name} shortcut", tr: "{name} k\u0131sayolunu de\u011Fi\u015Ftir" },
    "hotkey.press_key": { en: "Press a key\u2026", tr: "Bir tu\u015Fa bas\u2026" },
    "hotkey.press_key_cancel": { en: "Press a key\u2026  Esc: cancel", tr: "Bir tu\u015Fa bas\u2026  Esc: iptal" },
    "hotkey.cancelled": { en: "Change cancelled.", tr: "De\u011Fi\u015Fiklik iptal edildi." },
    "hotkey.modifier_invalid": { en: "A modifier key cannot be used by itself.", tr: "Tek ba\u015F\u0131na bir de\u011Fi\u015Ftirici tu\u015F kullan\u0131lamaz." },
    "hotkey.collision": { en: "This key is already used for \u201C{name}\u201D.", tr: "Bu tu\u015F \u201C{name}\u201D i\xE7in kullan\u0131mda." },
    "hotkey.invalid": { en: "This key cannot be assigned.", tr: "Bu tu\u015F ba\u011Flanam\u0131yor." },
    "hotkey.saved": { en: "Shortcut saved.", tr: "K\u0131sayol kaydedildi." },
    "hotkey.saved_native_conflict": { en: "Saved: may conflict with a native Kick shortcut.", tr: "Kaydedildi: Kick\u2019in kendi k\u0131sayoluyla \xE7ak\u0131\u015Fabilir." },
    "hotkey.reset": { en: "Shortcuts reset.", tr: "K\u0131sayollar s\u0131f\u0131rland\u0131." },
    "player.live": { en: "LIVE", tr: "CANLI" },
    "player.go_live": { en: "Go live", tr: "Canl\u0131 yay\u0131na d\xF6n" },
    "player.go_live_behind": { en: "Go live, {n} seconds behind", tr: "Canl\u0131 yay\u0131na d\xF6n, {n} saniye geridesin" },
    "player.behind_seconds": { en: "\u2212{n} s", tr: "\u2212{n} sn" },
    "player.behind_minutes": { en: "\u2212{n} min", tr: "\u2212{n} dk" },
    "player.seek_back_title": { en: "{n}s back", tr: "{n} sn geri" },
    "player.seek_forward_title": { en: "{n}s forward", tr: "{n} sn ileri" },
    "player.seek_back_aria": { en: "Seek back {n} seconds", tr: "{n} saniye geri sar" },
    "player.seek_forward_aria": { en: "Seek forward {n} seconds", tr: "{n} saniye ileri sar" },
    "player.screenshot": { en: "Take screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC al" },
    "player.buffer_warning": { en: "Buffer under pressure; speed reduced to 1.5x", tr: "Buffer zorland\u0131; h\u0131z 1.5x oldu" },
    "player.manual_speed": { en: "Manual speed: {rate}", tr: "Manuel h\u0131z: {rate}" },
    "player.auto": { en: "AUTO", tr: "OTO" },
    "player.select_speed": { en: "Select playback speed", tr: "Oynatma h\u0131z\u0131n\u0131 se\xE7" },
    "player.more_controls": { en: "More controls", tr: "Di\u011Fer kontroller" },
    "player.quality": { en: "Quality", tr: "Kalite" },
    "player.quality_best": { en: "Best picture", tr: "En iyi g\xF6r\xFCnt\xFC" },
    "player.quality_best_hint": { en: "Always the highest", tr: "Hep en y\xFCksek" },
    "player.quality_best_hint_now": { en: "Always the highest, now {label}", tr: "Hep en y\xFCksek, \u015Fu an {label}" },
    "player.quality_auto": { en: "Match my connection", tr: "Ba\u011Flant\u0131ya g\xF6re" },
    "player.quality_auto_hint": { en: "Steps down by itself when the connection slows", tr: "\u0130nternet yava\u015Flarsa kendisi d\xFC\u015F\xFCr\xFCr" },
    "player.quality_saver": { en: "Data saver", tr: "Veri tasarrufu" },
    "player.quality_saver_hint": { en: "At most 480p, for mobile data", tr: "En \xE7ok 480p, telefon interneti i\xE7in" },
    "player.quality_more": { en: "Other resolutions", tr: "Di\u011Fer \xE7\xF6z\xFCn\xFCrl\xFCkler" },
    "player.quality_sub_best": { en: "BEST", tr: "EN \u0130Y\u0130" },
    "player.quality_sub_stream": { en: "THIS STREAM", tr: "BU YAYIN" },
    "player.quality_sub_saver": { en: "SAVER", tr: "TASARRUF" },
    "entry.footer_title": { en: "KickFlow removed messages", tr: "KickFlow kald\u0131r\u0131lan mesajlar" },
    "entry.footer_aria": { en: "Open KickFlow removed messages", tr: "KickFlow kald\u0131r\u0131lan mesajlar\u0131 a\xE7" },
    "entry.settings_title": { en: "KickFlow settings", tr: "KickFlow ayarlar\u0131" },
    "entry.settings_aria": { en: "Open KickFlow settings", tr: "KickFlow ayarlar\u0131n\u0131 a\xE7" },
    "overlay.connected": { en: "Connected, waiting for messages\u2026", tr: "Ba\u011Fland\u0131 \u2014 mesajlar bekleniyor\u2026" },
    "overlay.reconnecting": { en: "Reconnecting\u2026", tr: "Yeniden ba\u011Flan\u0131yor\u2026" },
    "overlay.replay_loading": { en: "Loading replay chat\u2026", tr: "Yay\u0131n sohbeti y\xFCkleniyor\u2026" },
    "overlay.replay_ready": { en: "Replay chat ready \u2014 waiting for messages\u2026", tr: "Yay\u0131n sohbeti haz\u0131r \u2014 mesajlar bekleniyor\u2026" },
    "chat.new_messages": { en: "\u2193 New messages", tr: "\u2193 Yeni mesajlar" },
    "chat.pause_count": {
      en: { one: "{count} new message", other: "{count} new messages" },
      tr: { one: "{count} yeni mesaj", other: "{count} yeni mesaj" }
    },
    "chat.new_messages_count": {
      en: { one: "\u2193 {count} new message", other: "\u2193 {count} new messages" },
      tr: { one: "\u2193 {count} yeni mesaj", other: "\u2193 {count} yeni mesaj" }
    },
    "status.starting": { en: "starting", tr: "ba\u015Fl\u0131yor" },
    "status.resolving_channel": { en: "resolving channel\u2026", tr: "kanal bulunuyor\u2026" },
    "status.not_channel": { en: "not a channel page", tr: "Bu sayfa bir kanal de\u011Fil. Bir Kick yay\u0131n\u0131 a\xE7." },
    "status.chatroom_unresolved": { en: "could not resolve chatroom id", tr: "sohbet odas\u0131 bulunamad\u0131" },
    "status.pusher_connecting": { en: "Pusher connecting\u2026", tr: "canl\u0131 sohbete ba\u011Flan\u0131yor\u2026" },
    "status.socket_waiting": { en: "Pusher socket connected, waiting for chatroom subscription\u2026", tr: "ba\u011Fland\u0131, sohbet odas\u0131 bekleniyor\u2026" },
    "status.active_native": { en: "active, marking native chat", tr: "\xE7al\u0131\u015F\u0131yor, Kick\u2019in sohbeti kullan\u0131l\u0131yor" },
    "status.active_native_replay": { en: "active \u2014 native replay chat", tr: "\xE7al\u0131\u015F\u0131yor, Kick\u2019in tekrar sohbeti kullan\u0131l\u0131yor" },
    "status.subscription_waiting_native": { en: "waiting for chatroom subscription, native chat", tr: "sohbet odas\u0131 bekleniyor; \u015Fimdilik Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.active_own": { en: "active, rendering KickFlow list", tr: "\xE7al\u0131\u015F\u0131yor, KickFlow sohbet listesi g\xF6steriliyor" },
    "status.vod_replay_loading": { en: "loading replay chat\u2026", tr: "yay\u0131n sohbeti y\xFCkleniyor\u2026" },
    "status.active_vod_replay": { en: "active \u2014 replay chat synchronized", tr: "\xE7al\u0131\u015F\u0131yor, tekrar sohbeti videoyla e\u015F zamanl\u0131" },
    "status.vod_replay_failed_native": { en: "replay unavailable \u2014 native replay chat", tr: "tekrar sohbeti al\u0131namad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.content_not_ready": { en: "content not ready, retrying in background with native chat", tr: "sohbet hen\xFCz haz\u0131r de\u011Fil; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor, arka planda yeniden deneniyor" },
    "status.chatroom_unresolved_native": { en: "could not resolve chatroom id, native chat", tr: "sohbet odas\u0131 bulunamad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor. Sayfay\u0131 yenile." },
    "status.history_empty": { en: "history empty, waiting for live chatroom subscription\u2026", tr: "ge\xE7mi\u015F bo\u015F, canl\u0131 sohbet bekleniyor\u2026" },
    "status.history_failed": { en: "could not load history, waiting for live chatroom subscription\u2026", tr: "ge\xE7mi\u015F al\u0131namad\u0131, canl\u0131 sohbet bekleniyor\u2026" },
    "status.active_ready": { en: "active, chatroom subscription ready", tr: "\xE7al\u0131\u015F\u0131yor, sohbet odas\u0131 haz\u0131r" },
    "status.chatroom_ready_waiting": { en: "chatroom ready, waiting for visible chat area", tr: "sohbet odas\u0131 haz\u0131r, sohbet alan\u0131 bekleniyor" },
    "status.primary_unavailable": { en: "chatroom connection not ready ({reason}), native chat", tr: "canl\u0131 sohbet haz\u0131r de\u011Fil ({reason}); Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.reconnecting": { en: "reconnecting\u2026", tr: "yeniden ba\u011Flan\u0131yor\u2026" },
    "status.reconnect_failed": { en: "could not reconnect to chatroom, native chat", tr: "sohbet odas\u0131na yeniden ba\u011Flan\u0131lamad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor. Sayfay\u0131 yenile." },
    "status.waiting_chat_panel": { en: "waiting for chat panel\u2026", tr: "sohbet paneli bekleniyor\u2026" },
    "popup.tagline": { en: "A streamlined Kick experience.", tr: "Kick deneyimi, sadele\u015Ftirilmi\u015F." },
    "popup.connection_status": { en: "Connection status", tr: "Ba\u011Flant\u0131 durumu" },
    "popup.reading_status": { en: "Reading status\u2026", tr: "Durum okunuyor\u2026" },
    "popup.mode_desc": { en: "Kick or KickFlow list", tr: "Kick veya KickFlow listesi" },
    "popup.hover_follow": { en: "Scrolling under the pointer", tr: "\u0130mle\xE7 alt\u0131ndaki kayd\u0131rma" },
    "popup.hover_follow_desc": { en: "KickFlow list: how new messages move in while you point at chat", tr: "KickFlow listesi: imle\xE7 sohbetteyken yeni mesajlar nas\u0131l gelir" },
    "popup.status_stats": { en: "Status / Statistics", tr: "Durum / \u0130statistik" },
    "popup.debug_log": { en: "Debug log (F12)", tr: "Hata ay\u0131klama kayd\u0131 (F12)" },
    "popup.changes_hint": { en: "Changes apply immediately and persist after reload.", tr: "De\u011Fi\u015Fiklik an\u0131nda uygulan\u0131r; kanal yeniden y\xFCklenince de korunur." },
    // Texts that popup.html carried only in English (2026-11-16): en is the old HTML text, byte for byte.
    "popup.hover_smooth": { en: "Smooth", tr: "Yumu\u015Fak" },
    "popup.hover_instant": { en: "Instant", tr: "An\u0131nda" },
    "popup.mode_option_native": { en: "Native", tr: "Kick\u2019in sohbeti" },
    "popup.active_mode_own": { en: "own chat", tr: "KickFlow sohbet listesi" },
    "popup.active_mode_native": { en: "native chat", tr: "Kick\u2019in sohbeti" },
    "popup.not_connected": { en: "not connected", tr: "Kick sekmesine ba\u011Flan\u0131lamad\u0131. Sayfay\u0131 yenile." },
    "popup.active": { en: "KickFlow active \xB7 {mode}", tr: "KickFlow aktif \xB7 {mode}" },
    "popup.pusher_connected": { en: "connected", tr: "ba\u011Fl\u0131" },
    "popup.pusher_disconnected": { en: "disconnected", tr: "ba\u011Fl\u0131 de\u011Fil" },
    "popup.no_active_tab": { en: "no active tab", tr: "A\xE7\u0131k bir sekme yok. Bir Kick yay\u0131n\u0131 a\xE7." },
    "popup.not_kick_tab": { en: "not a Kick tab / content script unavailable", tr: "Bu sekmede KickFlow \xE7al\u0131\u015Fm\u0131yor. Bir Kick yay\u0131n\u0131 a\xE7 ya da sayfay\u0131 yenile." },
    "popup.open_kick": { en: "Open kick.com in the active tab", tr: "Bu sekme Kick de\u011Fil. Bir Kick yay\u0131n\u0131 a\xE7." },
    "popup.summary": { en: "This session", tr: "Bu oturum" },
    "popup.sum_messages": { en: "Messages seen", tr: "G\xF6r\xFClen mesaj" },
    "popup.sum_preserved": { en: "Kept after removal", tr: "Silinse de korunan" },
    "popup.sum_bans": { en: "Kept from bans", tr: "Bandan korunan" },
    "popup.diagnostics": { en: "Diagnostics", tr: "Tan\u0131lama" },
    "popup.diagnostics_desc": { en: "Technical details for bug reports.", tr: "Hata bildirimi i\xE7in teknik ayr\u0131nt\u0131lar." },
    "popup.mode_native": { en: "Kick chat", tr: "Kick sohbeti" },
    "popup.mode_own": { en: "KickFlow list", tr: "KickFlow listesi" },
    "popup.tab_unavailable": { en: "Could not connect to the Kick tab.", tr: "Kick sekmesine ba\u011Flan\u0131lamad\u0131." },
    "popup.save_failed": { en: "Setting changed for this tab, but could not be saved.", tr: "Ayar bu sekmede de\u011Fi\u015Fti ancak kaydedilemedi." },
    "time.seconds_ago": { en: { one: "{n} second ago", other: "{n} seconds ago" }, tr: { one: "{n} sn \xF6nce", other: "{n} sn \xF6nce" } },
    "time.minutes_ago": { en: { one: "{n} minute ago", other: "{n} minutes ago" }, tr: { one: "{n} dk \xF6nce", other: "{n} dk \xF6nce" } },
    "time.hours_ago": { en: { one: "{n} hour ago", other: "{n} hours ago" }, tr: { one: "{n} sa \xF6nce", other: "{n} sa \xF6nce" } },
    "user.not_subscribed": { en: "not subscribed", tr: "abone de\u011Fil" },
    "user.unknown": { en: "unknown", tr: "bilinmiyor" },
    "user.subscribed_months": { en: { one: "{n} month", other: "{n} months" }, tr: { one: "{n} ay abone", other: "{n} ay abone" } },
    "user.not_following": { en: "not following", tr: "takip etmiyor" },
    "user.close": { en: "Close user card", tr: "Kullan\u0131c\u0131 kart\u0131n\u0131 kapat" },
    "user.open_middle": { en: "kick.com/{slug}, middle-click to open in a new tab", tr: "kick.com/{slug} \u2014 orta t\u0131kla yeni sekmede a\xE7" },
    "user.verified": { en: "verified", tr: "do\u011Frulanm\u0131\u015F" },
    "user.followers": { en: "followers", tr: "takip\xE7i" },
    "user.created": { en: "account created", tr: "hesap olu\u015Fturma" },
    "user.following": { en: "following", tr: "takip" },
    "user.subscription": { en: "subscription", tr: "abonelik" },
    "user.messages": { en: "Messages this session", tr: "Bu oturumdaki mesajlar" },
    "user.messages_empty": { en: "No messages recorded in this session.", tr: "Bu oturumda kay\u0131tl\u0131 mesaj yok." },
    "user.messages_truncated": { en: "Older messages were not retained.", tr: "Daha eskisi tutulmad\u0131." },
    "user.messages_jump": { en: "Click to jump to this message", tr: "Mesaja gitmek i\xE7in t\u0131kla" },
    "user.open": { en: "open", tr: "a\xE7" },
    "user.follow_on_kick": { en: "Follow on Kick", tr: "Kick'te takip et" },
    "user.kick_controls": { en: "Kick controls", tr: "Kick i\u015Flemleri" },
    // 2026-11-24: ultrawide fill (U key) toast.
    "player.aspect_contain": { en: "Picture: as sent (bands)", tr: "G\xF6r\xFCnt\xFC: oldu\u011Fu gibi (bantl\u0131)" },
    "player.aspect_cover": { en: "Picture: fill by cropping", tr: "G\xF6r\xFCnt\xFC: k\u0131rparak doldur" },
    "player.aspect_stretch": { en: "Picture: slight stretch", tr: "G\xF6r\xFCnt\xFC: hafif germe" },
    // 0.4.3 (2026-11-24, code review B13): the loudness leveller says when it cannot work.
    "player.leveller_silent": { en: "Loudness leveller hears no sound. Reload the page to get it back.", tr: "Ses dengeleyici ses alam\u0131yor. Sesi geri almak i\xE7in sayfay\u0131 yenile." },
    "player.leveller_unsupported": { en: "Loudness leveller cannot work on this player; the sound is left as it is.", tr: "Ses dengeleyici bu oynat\u0131c\u0131da \xE7al\u0131\u015Fam\u0131yor; ses oldu\u011Fu gibi b\u0131rak\u0131ld\u0131." }
  };
  var MINUTES_PER_HOUR = 60;
  var HOURS_PER_DAY = 24;
  var MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
  var MINIMUM_DURATION_MINUTES = 0;
  function interpolateTemplate(template, params) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
  }
  function interpolateDuration(key, language, params) {
    return interpolateTemplate(messages[key][language], params);
  }
  function formatDurationMinutes(minutes, language) {
    if (minutes == null || !Number.isFinite(minutes) || minutes <= MINIMUM_DURATION_MINUTES) return "";
    const roundedMinutes = Math.round(minutes);
    if (roundedMinutes < MINUTES_PER_HOUR) {
      return interpolateDuration("duration.minutes_short", language, { n: roundedMinutes });
    }
    if (roundedMinutes < MINUTES_PER_DAY) {
      const hours = Math.floor(roundedMinutes / MINUTES_PER_HOUR);
      const remainingMinutes = roundedMinutes % MINUTES_PER_HOUR;
      if (remainingMinutes > MINIMUM_DURATION_MINUTES) {
        return interpolateDuration("duration.hours_minutes_short", language, {
          h: hours,
          m: remainingMinutes
        });
      }
      return interpolateDuration("duration.hours_short", language, { n: hours });
    }
    return interpolateDuration("duration.days_short", language, {
      n: Math.round(roundedMinutes / MINUTES_PER_DAY)
    });
  }
  var lang = "en";
  var listeners = /* @__PURE__ */ new Set();
  function getLang() {
    return lang;
  }
  function setLang(next) {
    if (typeof document !== "undefined") document.documentElement.lang = next;
    if (next === lang) return;
    lang = next;
    void safeStorageSet({ [STORAGE_KEY]: next });
    for (const listener of listeners) listener(next);
  }
  async function loadLang() {
    const stored = await safeStorageGet(STORAGE_KEY);
    const next = stored[STORAGE_KEY];
    if (next === "en" || next === "tr") setLang(next);
    return lang;
  }
  function subscribeLang(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function selectTemplate(template, params) {
    if (typeof template === "string") return template;
    const count = Number(params.n);
    return count === 1 ? template.one : template.other;
  }
  function t(key, params = {}) {
    const template = selectTemplate(messages[key][lang], params);
    return interpolateTemplate(template, params);
  }
  function formatNumber(value) {
    return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US").format(value);
  }
  function hotkeyLabel(action) {
    const keys = {
      rewind: "hotkey.rewind",
      forward: "hotkey.forward",
      screenshot: "hotkey.screenshot",
      goLive: "hotkey.go_live"
    };
    return t(keys[action]);
  }

  // src/content/shared/coalesce.ts
  function coalesce(work, minGapMs, lifecycle) {
    let timer = null;
    let last = -Infinity;
    let disposed = false;
    const fire2 = () => {
      timer = null;
      if (document.visibilityState === "hidden") return;
      last = performance.now();
      work();
    };
    const api = {
      run() {
        if (disposed || timer !== null) return;
        const wait = Math.max(0, last + minGapMs - performance.now());
        timer = window.setTimeout(fire2, wait);
      },
      flush() {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        fire2();
      },
      cancel() {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") api.run();
    };
    document.addEventListener("visibilitychange", onVisible);
    lifecycle?.add(() => {
      disposed = true;
      api.cancel();
      document.removeEventListener("visibilitychange", onVisible);
    });
    return api;
  }
  var CHAT_SCROLLER_SELECTOR = "#chatroom-messages, #kickflow-chat-overlay";
  function isInsideChatScroller(target) {
    if (!target || typeof target.nodeType !== "number") return false;
    const node = target;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return element?.closest(CHAT_SCROLLER_SELECTOR) != null;
  }
  function onlyChatMutations(records) {
    for (const record2 of records) if (!isInsideChatScroller(record2.target)) return false;
    return records.length > 0;
  }
  function visibleInterval(lifecycle, handler, intervalMs) {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      handler();
    };
    lifecycle.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    lifecycle.add(() => document.removeEventListener("visibilitychange", tick));
  }

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

  // src/content/shared/style-write.ts
  function px(value) {
    return `${Math.round(value * 100) / 100}px`;
  }
  function setStyleIfChanged(element, key, value) {
    if (element.style[key] !== value) element.style[key] = value;
  }

  // src/content/shared/avatar-preview.ts
  var STYLE_ID = "kickflow-avatar-preview-style";
  var activePreview = null;
  function copy() {
    return getLang() === "tr" ? { enlarge: "Profil resmini b\xFCy\xFCt", title: "Profil resmi", close: "Kapat", failed: "Profil resmi y\xFCklenemedi." } : { enlarge: "Enlarge profile picture", title: "Profile picture", close: "Close", failed: "The profile picture could not be loaded." };
  }
  function fullSizeAvatarUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname !== "kick.com" && !url.hostname.endsWith(".kick.com")) return null;
    if (!/\.(?:webp|png|jpe?g|gif|avif)$/i.test(url.pathname)) return null;
    if (url.pathname.includes("/profile_image/conversion/")) {
      url.pathname = url.pathname.replace(/-(?:small|medium|large|thumbnail|thumb|fullsize)(\.(?:webp|png|jpe?g|gif|avif))$/i, "-fullsize$1");
    }
    return url.href;
  }
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    .kickflow-avatar-enlarge { box-sizing: border-box; display: inline-flex; flex: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: var(--kf-surface-3, #1f2520); color: var(--kf-green, #53fc18); cursor: pointer; }
    .kickflow-avatar-enlarge svg { width: 70%; height: 70%; pointer-events: none; }
    .kickflow-avatar-action { position: relative; display: inline-flex; flex: none; width: 48px; height: 48px; border-radius: 50%; }
    .kickflow-avatar-action > .kickflow-avatar-enlarge { width: 100%; height: 100%; background: transparent; }
    .kickflow-avatar-action .kickflow-user-card__avatar { width: 100%; height: 100%; border-radius: 50%; }
    .kickflow-avatar-action > .kickflow-avatar-enlarge > svg { position: absolute; right: 10%; bottom: 34%; width: 28%; height: 28%; padding: 2px; border-radius: 50%; background: var(--kf-surface-3, #1f2520); opacity: 0; }
    .kickflow-avatar-action:hover svg, .kickflow-avatar-action:focus-within svg { opacity: 1; }
    .kickflow-avatar-enlarge:focus-visible, .kickflow-avatar-preview button:focus-visible { outline: 2px solid #b5e7ff; outline-offset: 3px; }
    .kickflow-avatar-enlarge--channel { position: fixed; z-index: 10010; opacity: 0; pointer-events: none; }
    .kickflow-avatar-enlarge--channel.kickflow-avatar-enlarge--visible, .kickflow-avatar-enlarge--channel:focus-visible { opacity: 1; pointer-events: auto; }
    .kickflow-avatar-enlarge--direct { background: transparent; pointer-events: auto; opacity: 1; }
    .kickflow-avatar-enlarge--direct > svg { position: absolute; right: 10%; bottom: 34%; width: 28%; height: 28%; padding: 2px; border-radius: 50%; background: var(--kf-surface-3, #1f2520); opacity: 0; }
    .kickflow-avatar-enlarge--direct:hover > svg, .kickflow-avatar-enlarge--direct:focus-visible > svg { opacity: 1; }
    .kickflow-avatar-enlarge[hidden] { display: none; }
    .kickflow-avatar-preview { box-sizing: border-box; width: max-content; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); margin: auto; padding: 16px; border: 1px solid #727a82; border-radius: 12px; background: #151b22; color: #f7f9fb; box-shadow: 0 12px 60px #0008; font: 14px/1.4 system-ui, sans-serif; }
    .kickflow-avatar-preview::backdrop { background: #000c; }
    .kickflow-avatar-preview__header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 12px; }
    .kickflow-avatar-preview button { width: 32px; height: 32px; padding: 0; border: 1px solid #727a82; border-radius: 6px; background: #20262d; color: #f7f9fb; font-size: 24px; cursor: pointer; }
    .kickflow-avatar-preview img { display: block; width: auto; height: auto; max-width: min(76vw, 720px); max-height: calc(100vh - 132px); object-fit: contain; margin: auto; }
    .kickflow-avatar-preview img[hidden] { display: none; }
  `;
    (document.head ?? document.documentElement).appendChild(style);
  }
  function dismissAvatarPreview() {
    activePreview?.close();
  }
  function openAvatarPreview(value, name = "", source = null) {
    const url = fullSizeAvatarUrl(value);
    if (!url) return false;
    dismissAvatarPreview();
    ensureStyles();
    const text = copy();
    const previousFocus = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = document.createElement("dialog");
    dialog.className = "kickflow-avatar-preview";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", name ? `${text.title}: ${name}` : text.title);
    const header = document.createElement("div");
    header.className = "kickflow-avatar-preview__header";
    const title = document.createElement("strong");
    title.textContent = name ? `${text.title}: ${name}` : text.title;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "\xD7";
    closeButton.setAttribute("aria-label", text.close);
    header.append(title, closeButton);
    const image = document.createElement("img");
    image.alt = name ? `${text.title}: ${name}` : text.title;
    image.src = url;
    const error = document.createElement("p");
    error.hidden = true;
    error.setAttribute("role", "status");
    error.textContent = text.failed;
    image.addEventListener("error", () => {
      image.hidden = true;
      error.hidden = false;
    });
    dialog.append(header, image, error);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      if (activePreview?.close === close) activePreview = null;
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeButton.focus();
      }
    };
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", close);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    document.body.appendChild(dialog);
    activePreview = { close, source };
    document.addEventListener("keydown", onKey, true);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    closeButton.focus({ preventScroll: true });
    return true;
  }
  function createAvatarPreviewButton(getUrl, name = "") {
    ensureStyles();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kickflow-avatar-enlarge";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/></svg>';
    button.title = copy().enlarge;
    button.setAttribute("aria-label", copy().enlarge);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAvatarPreview(getUrl(), name, button);
    });
    return button;
  }
  function createAvatarPreviewAction(image, name = "") {
    const wrapper = document.createElement("span");
    wrapper.className = "kickflow-avatar-action";
    const button = createAvatarPreviewButton(() => image.currentSrc || image.src, name);
    button.prepend(image);
    wrapper.append(button);
    return wrapper;
  }
  function visibleAvatar(image) {
    const rect = image.getBoundingClientRect();
    const style = window.getComputedStyle(image);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none" && style.opacity !== "0";
  }
  function findChannelAvatar() {
    const legacy = document.querySelector("img#channel-avatar");
    if (legacy && visibleAvatar(legacy)) return legacy;
    const channel = parseChatSessionContext(window.location.pathname);
    if (!channel || window.location.pathname.startsWith("/popout/")) return null;
    const excluded = 'aside, nav, dialog, [role="dialog"], .kickflow-user-card, .kickflow-avatar-preview';
    for (const heading of document.querySelectorAll('[data-testid="channel-username"], h1, h2, [role="heading"]')) {
      if (heading.closest(excluded)) continue;
      const name = heading.textContent?.trim().toLocaleLowerCase();
      if (!name || name !== channel.slug.toLocaleLowerCase() && heading.dataset.testid !== "channel-username") continue;
      let row = heading.parentElement;
      for (let depth = 0; row && depth < 4 && !row.matches("body, main, html"); depth++, row = row.parentElement) {
        for (const image of row.querySelectorAll("img")) {
          if (image.closest(excluded) || !visibleAvatar(image)) continue;
          const url = image.currentSrc || image.src;
          if (!fullSizeAvatarUrl(url)) continue;
          if (image.alt.trim().toLocaleLowerCase() === name || image.dataset.testid === "channel-avatar" && new URL(url).pathname.includes("/profile_image/")) return image;
        }
      }
    }
    return null;
  }
  function initChannelAvatarPreview(lifecycle) {
    const view = window;
    let avatar = null;
    let avatarUrl = "";
    let route2 = window.location.pathname;
    let frame = 0;
    const button = createAvatarPreviewButton(() => avatar?.currentSrc || avatar?.src || "", "");
    button.classList.add("kickflow-avatar-enlarge--channel");
    button.hidden = true;
    document.body.appendChild(button);
    const refresh = () => {
      frame = 0;
      if (lifecycle.isDisposed || !view.document) return;
      const next = findChannelAvatar();
      const nextUrl = next?.currentSrc || next?.src || "";
      if ((next !== avatar || nextUrl !== avatarUrl || route2 !== window.location.pathname) && activePreview?.source === button) dismissAvatarPreview();
      if (next !== avatar) button.classList.remove("kickflow-avatar-enlarge--visible");
      route2 = window.location.pathname;
      avatar = next;
      avatarUrl = nextUrl;
      const rect = avatar?.getBoundingClientRect();
      const hidden = !avatar || !rect || rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth || !fullSizeAvatarUrl(avatar.currentSrc || avatar.src);
      if (button.hidden !== hidden) button.hidden = hidden;
      if (!hidden && rect) {
        const direct = !avatar?.closest('a[href], button, [role="button"], [onclick], [tabindex]');
        if (button.classList.contains("kickflow-avatar-enlarge--direct") !== direct) {
          button.classList.toggle("kickflow-avatar-enlarge--direct", direct);
        }
        const size = Math.min(22, rect.width * 0.28, rect.height * 0.28);
        setStyleIfChanged(button, "width", px(direct ? rect.width : size));
        setStyleIfChanged(button, "height", px(direct ? rect.height : size));
        setStyleIfChanged(button, "left", px(direct ? rect.left : rect.right - size - rect.width * 0.1));
        setStyleIfChanged(button, "top", px(direct ? rect.top : rect.bottom - size - rect.height * 0.34));
        const label = copy().enlarge;
        if (button.title !== label) button.title = label;
        if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      }
    };
    const updateHover = (target) => {
      const visible = target === avatar || target instanceof Node && button.contains(target);
      if (button.classList.contains("kickflow-avatar-enlarge--visible") !== visible) {
        button.classList.toggle("kickflow-avatar-enlarge--visible", visible);
      }
    };
    lifecycle.addEventListener(document, "pointerover", ((event) => updateHover(event.target)));
    lifecycle.addEventListener(document, "pointerout", ((event) => updateHover(event.relatedTarget)));
    const schedule = () => {
      if (lifecycle.isDisposed || !view.document) return;
      if (!frame) frame = view.requestAnimationFrame(refresh);
    };
    const observer = new MutationObserver((records) => {
      if (!onlyChatMutations(records)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src", "srcset", "id", "alt", "hidden", "data-testid"] });
    lifecycle.addEventListener(window, "kickflow:locationchange", schedule);
    lifecycle.addEventListener(window, "popstate", schedule);
    lifecycle.addEventListener(window, "resize", schedule);
    lifecycle.addEventListener(document, "scroll", ((event) => {
      if (!isInsideChatScroller(event.target)) schedule();
    }), true);
    lifecycle.addEventListener(document, "load", ((event) => {
      if (!isInsideChatScroller(event.target)) schedule();
    }), true);
    lifecycle.add(() => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      dismissAvatarPreview();
      button.remove();
      document.getElementById(STYLE_ID)?.remove();
    });
    refresh();
  }

  // src/content/chat/startup-retry.ts
  function startChatWithRetries(parent, start) {
    let active = null;
    let timer = null;
    let attempt = 0;
    const begin = () => {
      if (parent.isDisposed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      active?.dispose();
      const child = new Lifecycle();
      active = child;
      attempt++;
      let failed = false;
      const controls = {
        ready: () => {
          if (child.isDisposed || parent.isDisposed) return;
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
          failed = false;
          attempt = 0;
        },
        fail: (showFailure) => {
          if (failed || child.isDisposed || parent.isDisposed) return;
          failed = true;
          if (attempt >= 3) {
            showFailure();
            return;
          }
          timer = window.setTimeout(begin, 1e3 * 2 ** Math.max(0, attempt - 1));
        },
        retry: () => {
          attempt = 0;
          begin();
        }
      };
      start(child, controls);
    };
    parent.add(() => {
      if (timer !== null) window.clearTimeout(timer);
      active?.dispose();
    });
    begin();
  }

  // src/content/chat/badge-presentation.ts
  function applyBadgePresentation(element, onActivate) {
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      element.focus();
      onActivate?.();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      element.focus();
      onActivate?.();
    });
  }
  function describeBadgeGroup(parent) {
    const badges = Array.from(parent.querySelectorAll(".kickflow-badge-icon, .kickflow-badge-role, .kickflow-badge-text"));
    if (!badges.length) return;
    const names = badges.map((element) => element.getAttribute("aria-label") || element.getAttribute("alt") || element.textContent || "").filter(Boolean);
    parent.classList.add("kickflow-badge-group");
    parent.setAttribute("role", "group");
    parent.setAttribute("aria-label", names.join(" \xB7 "));
  }
  var BADGE_STYLES = `
    .kickflow-badge-icon, .kickflow-badge-role, .kickflow-badge-text {
      background: transparent; border: 0; box-shadow: none; border-radius: 0;
      padding: 0; opacity: 1; cursor: pointer;
    }
    .kickflow-badge-icon:focus-visible,
    .kickflow-badge-role:focus-visible,
    .kickflow-badge-text:focus-visible {
      outline: 2px solid var(--kf-green); outline-offset: 2px;
    }
`;

  // src/content/shared/selectors.ts
  var SELECTORS = {
    // Fresh public Kick bundle read 2026-10-17; runtime DOM is INFERRED.
    // Evidence and inference boundaries: tests/fixtures/daily-reward-2026-10.html.
    dailyRewardCta: 'video[src*="reward-available-CTA"]',
    dailyRewardDialog: '[role="dialog"], [role="alertdialog"], dialog',
    dailyRewardExcludedSurface: "#rewards-panel, #drops-panel",
    dailyRewardStage: '[class~="aspect-[1348/1080]"], [class~="aspect-1348/1080"]',
    dailyRewardMediaStage: "div.relative.w-full.overflow-hidden.rounded-md.bg-black",
    dailyRewardFullWidthButton: "button.w-full",
    // Current footer imports module 888724 (bg-primary-base); retain the older Button style.
    dailyRewardPrimaryButton: "button.bg-primary-base, button.bg-brand-bg-default",
    dailyRewardCloseLabel: "button span.sr-only",
    dailyRewardHidden: '[hidden], [aria-hidden="true"], [inert]',
    chatMessagesContainer: "#chatroom-messages",
    videoPlayer: "#video-player",
    // Native control bar root. GOTCHA (confirmed live via Playwright against a real stream
    // 2026-07-04): Kick renders THREE elements sharing class `z-controls` —
    //   (1) a top-right "Chat" re-open toggle (`div.z-controls.absolute.right-7.top-7`,
    //       shown only when chat is collapsed; a single button, NO LIVE button, and it lives
    //       OUTSIDE the player wrapper — in the chat panel),
    //   (2) an empty layout layer inside the player (`div.z-controls.relative.grid-row-1`,
    //       ZERO buttons — a positioning wrapper, not the bar), and
    //   (3) the REAL bottom player bar (`div.z-controls.absolute.bottom-0.left-0.flex`,
    //       the play/volume/time/LIVE + settings/fullscreen cluster; 8 buttons incl. LIVE).
    // A bare `document.querySelector('div.z-controls')` returns #1; even scoping to the
    // wrapper returns #2 first (DOM order) — both lack the LIVE anchor, so controls silently
    // never mounted. findControlBar() below selects the bar by its bottom anchor, falling
    // back to whichever wrapper-scoped z-controls actually holds buttons.
    controlBar: "div.z-controls",
    // The real bottom bar specifically — the only z-controls with the `bottom-0` anchor.
    controlBarBottom: "div.z-controls.bottom-0",
    // Shipped by Kick's visible caption control on 2026-07-21. Unlike its localized tooltip and
    // state-dependent SVG, this developer-facing test id is shared by desktop/mobile player bars.
    nativeCaptionButton: 'button[data-testid="video-player-closed-captions"]',
    nativeFullscreenButton: 'button[data-testid="video-player-fullscreen"]'
  };
  function getVideoElement() {
    const el = document.querySelector(SELECTORS.videoPlayer);
    return el instanceof HTMLVideoElement ? el : null;
  }
  function findControlBar() {
    const wrapper = findPlayerWrapper();
    if (!wrapper) return null;
    const bottom = wrapper.querySelector(SELECTORS.controlBarBottom);
    if (bottom) return bottom;
    const bars = Array.from(wrapper.querySelectorAll(SELECTORS.controlBar)).filter((bar) => !bar.classList.contains("grid-row-1") && bar.querySelector("button"));
    if (bars.length === 0) return null;
    return bars.reduce(
      (best, bar) => bar.querySelectorAll("button").length > best.querySelectorAll("button").length ? bar : best
    );
  }
  function findPlayerWrapper() {
    return getVideoElement()?.parentElement ?? null;
  }
  function normalizeLiveButtonText(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }
  var LIVE_EDGE_LABELS = /* @__PURE__ */ new Set(["LIVE", "CANLI"]);
  var GO_TO_LIVE_PHRASES = [
    "GO TO LIVE",
    "GO LIVE",
    "JUMP TO LIVE",
    "CANLI YAYINA",
    "YAYINA GEC"
  ];
  function findLiveButton() {
    const bar = findControlBar();
    if (!bar) return null;
    const candidates = bar.querySelectorAll("button");
    for (const el of candidates) {
      if (el.closest('[id^="kickflow-"]')) continue;
      const text = normalizeLiveButtonText(el.textContent ?? "");
      if (LIVE_EDGE_LABELS.has(text) || GO_TO_LIVE_PHRASES.some((phrase) => text.includes(phrase))) {
        return el;
      }
    }
    return null;
  }
  function findControlBarInsertionAnchor() {
    const live = findLiveButton();
    if (live) return live;
    const bar = findControlBar();
    if (!bar) return null;
    const fullscreen = bar.querySelector(SELECTORS.nativeFullscreenButton);
    if (!fullscreen || fullscreen.closest('[id^="kickflow-"]')) return null;
    let rightGroup = fullscreen.parentElement;
    while (rightGroup && rightGroup.parentElement !== bar) rightGroup = rightGroup.parentElement;
    if (!(rightGroup instanceof HTMLDivElement)) return null;
    const leftGroup = bar.firstElementChild;
    if (!(leftGroup instanceof HTMLDivElement) || leftGroup === rightGroup || !leftGroup.classList.contains("flex") || !leftGroup.classList.contains("items-center")) return null;
    const nativeButtons = Array.from(leftGroup.querySelectorAll("button")).filter((button) => !button.closest('[id^="kickflow-"]'));
    if (nativeButtons.length < 2) return null;
    const children = Array.from(leftGroup.children).filter((child) => child instanceof HTMLElement && !child.id.startsWith("kickflow-"));
    return children[children.length - 1] ?? null;
  }
  var ACTIVE_CHATTERS_PANEL_SELECTOR = "section.bg-surface-base.flex.size-full.min-h-0.flex-col.overflow-hidden.text-white";
  var ACTIVE_CHATTERS_SEARCH_SELECTOR = 'input[type="search"].h-8.pl-11.pr-3';
  var ACTIVE_CHATTERS_ROW_SELECTOR = "ul.flex.list-none.flex-col.overflow-hidden.p-0 > li > button.flex.h-auto.w-full";
  var ACTIVE_CHATTERS_USERNAME_SELECTOR = "span.min-w-0.flex-1.truncate.text-base.font-normal.leading-6";
  var ACTIVE_CHATTERS_ROW_FALLBACK_SELECTOR = "ul > li > button";
  var ACTIVE_CHATTERS_USERNAME_FALLBACK_SELECTOR = "span.truncate";
  function isDropsRoutePath(pathname) {
    return pathname === "/drops" || pathname.startsWith("/drops/");
  }

  // src/content/shared/dom-observers.ts
  function whenElementPresent(selector, lifecycle, onPresent, options = {}) {
    let done = false;
    const resolve = options.resolve ?? (() => document.querySelector(selector));
    const finish = (el) => {
      if (done || lifecycle.isDisposed) return;
      done = true;
      onPresent(el);
    };
    const existing = resolve();
    if (existing) {
      finish(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = resolve();
      if (el) finish(el);
      if (done) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    lifecycle.add(() => observer.disconnect());
  }

  // src/content/chat/feature-flags.ts
  var featureFlags = {
    chatMode: "native",
    hoverFollowMode: "browser-smooth",
    debugLogging: false,
    showDeletedMessages: true,
    preserveBansInline: true,
    showSubscriptions: true,
    showGiftedSubs: true,
    showKicks: true,
    showPolls: true,
    showHostRaid: true,
    showModeChanges: true,
    showChattersBadges: true,
    showUserMessages: true,
    chatSearchHotkey: true,
    hideQuickEmoteBar: true,
    showModActions: true,
    autoTheater: false,
    captionGuard: true,
    rewindControls: true,
    seekBar: true,
    liveCatchup: true,
    qualityLock: true,
    qualityMode: "best",
    qualityAlwaysBest: true,
    screenshot: true,
    speedControls: true,
    fullscreenTerminal: true,
    floatingStrip: true,
    autoClaimDrops: false,
    autoClaimDailyReward: false,
    modLogPanel: false,
    mentionHighlightEnabled: true,
    mentionHighlightStyle: "both",
    mentionHighlightColor: "#FFC94D",
    roleHighlightStyle: "frame",
    modFrameEnabled: true,
    modFrameColor: "#14B8A6",
    vipFrameEnabled: true,
    vipFrameColor: "#EC4899",
    manualUsername: "",
    ultrawideFill: false,
    aspectMode: "cover",
    ambientBands: false,
    loudnessLeveler: false,
    channelVolume: false,
    contentBlocking: true,
    liveNotify: false
  };
  function setFeatureFlag(key, value) {
    featureFlags[key] = value;
  }

  // src/content/chat/native-thread.ts
  var NATIVE_LIST_SELECTOR = '[id="chatroom-messages"]';
  var PANEL_HEADER_ICON_SELECTOR = 'svg[data-ds-icon="MessagesOutline"]';
  var PANEL_HEADER_TITLE_SELECTOR = ":scope > h2";
  var PANEL_HEADER_CLOSE_SELECTOR = ":scope > button";
  var NATIVE_ROW_SELECTOR = "[data-index]";
  var NATIVE_MID_ATTRIBUTE = "data-kickflow-mid";
  var NATIVE_ROW_BODY_SELECTOR = ".group > .w-full";
  var NATIVE_THREAD_ICON_SELECTOR = 'svg[data-ds-icon="ArrowCurveLeft"]';
  var NATIVE_NO_EXPAND_SELECTOR = "[data-prevent-expand]";
  var NATIVE_REPLY_TOOLBAR_SELECTOR = `div:has(> button > ${NATIVE_THREAD_ICON_SELECTOR})`;
  var THREAD_PANEL_ATTRIBUTE = "data-kickflow-thread-panel";
  var THREAD_SHELL_ATTRIBUTE = "data-kickflow-thread-shell";
  var THREAD_HEADER_ATTRIBUTE = "data-kickflow-thread-header";
  var THREAD_LIST_ATTRIBUTE = "data-kickflow-thread-list";
  var THREAD_PLACED_ATTRIBUTE = "data-kickflow-thread-placed";
  var MARK_ATTRIBUTES = [
    THREAD_PANEL_ATTRIBUTE,
    THREAD_SHELL_ATTRIBUTE,
    THREAD_HEADER_ATTRIBUTE,
    THREAD_LIST_ATTRIBUTE,
    THREAD_PLACED_ATTRIBUTE
  ];
  var PANEL_MAX_HEIGHT_PX = 340;
  var PANEL_MAX_HEIGHT_SHARE = 0.45;
  var PANEL_OPEN_DEADLINE_MS = 1200;
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
  function findThreadPanel(root = document) {
    for (const list of Array.from(root.querySelectorAll(NATIVE_LIST_SELECTOR))) {
      const parts = threadPanelPartsFor(list);
      if (parts) return parts;
    }
    return null;
  }
  function findMainNativeLists(root = document) {
    return Array.from(root.querySelectorAll(NATIVE_LIST_SELECTOR)).filter((list) => !isThreadPanelList(list));
  }
  function findMainNativeList(root = document) {
    return findMainNativeLists(root)[0] ?? null;
  }
  function findMainNativeRow(messageId, root = document) {
    for (const list of findMainNativeLists(root)) {
      const row = Array.from(list.querySelectorAll(`[${NATIVE_MID_ATTRIBUTE}]`)).find((element) => element.getAttribute(NATIVE_MID_ATTRIBUTE) === messageId);
      if (row) return row;
    }
    return null;
  }
  var panelUnavailable = false;
  var openCheckGeneration = 0;
  function nativeThreadAvailable(messageId, root = document) {
    if (panelUnavailable) return false;
    const row = findMainNativeRow(messageId, root);
    return row !== null && threadClickTarget(row) !== null;
  }
  function threadClickTarget(row) {
    const button = row.querySelector(NATIVE_THREAD_ICON_SELECTOR)?.closest("button") ?? null;
    return button && !button.disabled ? button : null;
  }
  function openNativeThread(messageId, root = document) {
    if (panelUnavailable) return false;
    const row = findMainNativeRow(messageId, root);
    const target = row ? threadClickTarget(row) : null;
    if (!target) return false;
    target.click();
    const generation = openCheckGeneration;
    window.setTimeout(() => {
      if (generation === openCheckGeneration && !findThreadPanel(root)) panelUnavailable = true;
    }, PANEL_OPEN_DEADLINE_MS);
    return true;
  }
  function resetNativeThreadState() {
    panelUnavailable = false;
    openCheckGeneration++;
  }
  function clearMarks(root, keep) {
    const owners = {
      [THREAD_PANEL_ATTRIBUTE]: keep?.outer,
      [THREAD_SHELL_ATTRIBUTE]: keep?.shell,
      [THREAD_HEADER_ATTRIBUTE]: keep?.header,
      [THREAD_LIST_ATTRIBUTE]: keep?.list,
      [THREAD_PLACED_ATTRIBUTE]: keep?.outer
    };
    for (const attribute of MARK_ATTRIBUTES) {
      root.querySelectorAll(`[${attribute}]`).forEach((element) => {
        if (element !== owners[attribute]) element.removeAttribute(attribute);
      });
    }
  }
  function placeInChatColumn(parts, root) {
    const main2 = findMainNativeList(root);
    const containing = parts.outer.offsetParent;
    const unplace = () => {
      parts.outer.removeAttribute(THREAD_PLACED_ATTRIBUTE);
    };
    if (!main2 || !(containing instanceof HTMLElement)) return unplace();
    const chat = main2.getBoundingClientRect();
    const box = containing.getBoundingClientRect();
    if (chat.width <= 0 || chat.height <= 0) return unplace();
    const height = Math.round(Math.min(PANEL_MAX_HEIGHT_PX, chat.height * PANEL_MAX_HEIGHT_SHARE));
    const style = parts.outer.style;
    style.setProperty("--kf-thread-left", `${Math.round(chat.left - box.left)}px`);
    style.setProperty("--kf-thread-right", `${Math.round(box.right - chat.right)}px`);
    style.setProperty("--kf-thread-bottom", `${Math.round(box.bottom - chat.bottom)}px`);
    style.setProperty("--kf-thread-height", `${height}px`);
    parts.outer.setAttribute(THREAD_PLACED_ATTRIBUTE, "");
  }
  function syncThreadPanel(root = document) {
    const parts = findThreadPanel(root);
    clearMarks(root, parts);
    if (!parts) return null;
    panelUnavailable = false;
    parts.outer.setAttribute(THREAD_PANEL_ATTRIBUTE, "");
    parts.shell.setAttribute(THREAD_SHELL_ATTRIBUTE, "");
    parts.header.setAttribute(THREAD_HEADER_ATTRIBUTE, "");
    parts.list.setAttribute(THREAD_LIST_ATTRIBUTE, "");
    placeInChatColumn(parts, root);
    return parts;
  }
  function containsNativeList(node) {
    return node instanceof Element && (node.matches(NATIVE_LIST_SELECTOR) || node.querySelector(NATIVE_LIST_SELECTOR) !== null);
  }
  function threadRowMessageId(row) {
    return row.getAttribute(NATIVE_MID_ATTRIBUTE);
  }
  function threadRowForClick(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest(`button, a, ${NATIVE_NO_EXPAND_SELECTOR}`)) return null;
    return target.closest(`[${THREAD_LIST_ATTRIBUTE}] ${NATIVE_ROW_SELECTOR}`);
  }
  function installNativeThreadPanel(lifecycle, jump) {
    const sync = () => {
      syncThreadPanel();
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record2) => Array.from(record2.addedNodes).some(containsNativeList) || Array.from(record2.removedNodes).some(containsNativeList))) sync();
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    lifecycle.add(() => observer.disconnect());
    lifecycle.setInterval(sync, 1e3);
    lifecycle.addEventListener(window, "resize", sync);
    lifecycle.addEventListener(document, "click", (event) => {
      if (event.button !== 0) return;
      const row = threadRowForClick(event.target);
      const messageId = row ? threadRowMessageId(row) : null;
      if (!row || !messageId) return;
      jump(messageId, row);
    });
    lifecycle.add(() => clearMarks(document, null));
    resetNativeThreadState();
    lifecycle.add(resetNativeThreadState);
    sync();
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

  // src/content/chat/native-quick-emotes.ts
  var QUICK_EMOTE_ATTRIBUTE = "data-kickflow-native-quick-emotes";
  var QUICK_EMOTE_SYNC_GAP_MS = 1e3;
  var IMAGE_SELECTOR = 'img[src^="https://files.kick.com/emotes/"]';
  function sharedChatRoot(first, second) {
    for (let node = first.parentElement; node; node = node.parentElement) {
      if (node.contains(second)) return node;
    }
    return null;
  }
  function findNativeQuickEmoteBar() {
    const messages2 = findMainNativeList();
    const composer = document.getElementById("chat-input-wrapper");
    if (!messages2 || !composer) return null;
    const root = sharedChatRoot(messages2, composer);
    if (!root) return null;
    const images = Array.from(root.querySelectorAll(IMAGE_SELECTOR)).filter((image) => !messages2.contains(image) && !composer.contains(image));
    if (images.length === 0) return null;
    const messageRect = messages2.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    if (composerRect.top < messageRect.bottom - 16) return null;
    for (const image of images) {
      let container = null;
      for (let node = image.parentElement; node && node !== root; node = node.parentElement) {
        if (node.contains(composer) || node.contains(messages2)) break;
        const rect = node.getBoundingClientRect();
        if (rect.height > 72 || rect.width > messageRect.width + 2) break;
        const inFooter = rect.top >= messageRect.bottom - 16 && rect.top <= messageRect.bottom + 72 && rect.bottom <= composerRect.top + 8 && rect.left >= messageRect.left - 2 && rect.right <= messageRect.right + 2;
        if (!inFooter) continue;
        const count = node.querySelectorAll(IMAGE_SELECTOR).length;
        if (count >= 4 && count <= 24) {
          if (node.textContent?.trim() || node.querySelector('input, textarea, [contenteditable], [role="status"]') || Array.from(node.querySelectorAll("img")).some((img) => !img.matches(IMAGE_SELECTOR)) || Array.from(node.querySelectorAll("button")).some((button) => !button.querySelector(IMAGE_SELECTOR))) break;
          container = node;
        }
      }
      if (container) return container;
    }
    return null;
  }
  var NativeQuickEmoteBar = class {
    constructor(lifecycle, shouldHide) {
      this.shouldHide = shouldHide;
      this.target = null;
      this.originalDisplay = "";
      this.originalPriority = "";
      this.sync();
      const resync = coalesce(() => this.sync(), QUICK_EMOTE_SYNC_GAP_MS, lifecycle);
      const observer = new MutationObserver(() => resync.run());
      observer.observe(document.body, { childList: true, subtree: true });
      lifecycle.add(() => observer.disconnect());
      visibleInterval(lifecycle, () => this.sync(), 2e3);
      lifecycle.add(() => this.dispose());
    }
    sync() {
      const found = this.target?.isConnected && this.shouldHide() ? this.target : findNativeQuickEmoteBar();
      if (this.target !== found) {
        this.restore();
        this.target = found;
        if (found) {
          this.originalDisplay = found.style.getPropertyValue("display");
          this.originalPriority = found.style.getPropertyPriority("display");
          found.setAttribute(QUICK_EMOTE_ATTRIBUTE, "");
        }
      }
      if (!this.target) return;
      if (this.shouldHide()) this.target.style.setProperty("display", "none", "important");
      else if (this.target.style.getPropertyValue("display") === "none" && this.target.style.getPropertyPriority("display") === "important") {
        this.target.style.setProperty("display", this.originalDisplay, this.originalPriority);
      }
    }
    dispose() {
      this.restore();
    }
    restore() {
      if (!this.target) return;
      this.target.style.setProperty("display", this.originalDisplay, this.originalPriority);
      this.target.removeAttribute(QUICK_EMOTE_ATTRIBUTE);
      this.target = null;
    }
  };

  // src/content/status.ts
  var status = {
    slug: null,
    chatroomId: null,
    active: false,
    reason: t("status.starting"),
    pusherConnected: false,
    lastBanAt: null
  };
  function setStatus(patch) {
    Object.assign(status, patch);
  }
  function getStatus() {
    return { ...status };
  }
  function resetStatus(slug) {
    status.slug = slug;
    status.chatroomId = null;
    status.active = false;
    status.reason = slug ? t("status.resolving_channel") : t("status.not_channel");
    status.pusherConnected = false;
    status.lastBanAt = null;
  }

  // src/content/chat/message-store.ts
  function mergeIdentityBadges(identity) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const visibleBadges = identity.badges.filter((badge2) => badge2.active !== false);
    const visibleBadgesV2 = identity.badgesV2.filter((badge2) => badge2.selected !== false);
    for (const badge2 of [...visibleBadges, ...visibleBadgesV2]) {
      const key = (badge2.type ?? badge2.name ?? "") + ":" + (badge2.count ?? "");
      if (key !== ":") {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(badge2);
    }
    return out.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  }
  function normalizeChatIdentity(value) {
    return value.trim().toLowerCase();
  }
  var SEEN_IDENTITY_COLOR_CAP = 2e3;
  var seenChatIdentityColors = /* @__PURE__ */ new Map();
  function rememberChatIdentityColor(sender) {
    const key = normalizeChatIdentity(sender.username);
    const color = sender.identity.color.trim();
    if (!key || !color) return;
    seenChatIdentityColors.delete(key);
    seenChatIdentityColors.set(key, color);
    if (seenChatIdentityColors.size > SEEN_IDENTITY_COLOR_CAP) {
      const oldest = seenChatIdentityColors.keys().next().value;
      if (oldest !== void 0) seenChatIdentityColors.delete(oldest);
    }
  }
  function getSeenChatIdentityColor(username) {
    return seenChatIdentityColors.get(normalizeChatIdentity(username));
  }
  var GLOBAL_CAPACITY = 800;
  var PRESERVED_CAPACITY = 50;
  var PRESERVED_TTL_MS = 10 * 60 * 1e3;
  var LATE_BAN_WINDOW_MS = 5e3;
  var LATE_BAN_CAPACITY = 200;
  var LimitedQueue = class {
    constructor(capacity) {
      this.capacity = capacity;
      this.slots = [];
      this.head = 0;
      this.count = 0;
      if (capacity <= 0) {
        throw new Error("LimitedQueue capacity must be greater than zero");
      }
    }
    /** Pushes an item; returns the item evicted from the front, if the queue was full. */
    push(item) {
      if (this.count < this.capacity) {
        this.slots[(this.head + this.count) % this.capacity] = item;
        this.count += 1;
        return void 0;
      }
      const evicted = this.slots[this.head];
      this.slots[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
      return evicted;
    }
    toArray() {
      const out = new Array(this.count);
      for (let i = 0; i < this.count; i++) out[i] = this.slots[(this.head + i) % this.capacity];
      return out;
    }
    includes(item) {
      for (let i = 0; i < this.count; i++) {
        if (this.slots[(this.head + i) % this.capacity] === item) return true;
      }
      return false;
    }
    get size() {
      return this.count;
    }
    clear() {
      this.slots = [];
      this.head = 0;
      this.count = 0;
    }
  };
  var REMOVED_LEDGER_CAPACITY = 300;
  var RemovedLedger = class {
    constructor(capacity = REMOVED_LEDGER_CAPACITY) {
      this.capacity = capacity;
      this.records = /* @__PURE__ */ new Map();
      this.changeListeners = /* @__PURE__ */ new Set();
      this.revision = 0;
    }
    get size() {
      return this.records.size;
    }
    get version() {
      return this.revision;
    }
    /** Inserts or refreshes the record for a preserved message. A refresh keeps the record's place
     * (first moderation time) and takes the richer reason/metadata. */
    record(message2) {
      if (!message2.preserved || !message2.preservedReason || message2.systemEvent) return;
      const previous = this.records.get(message2.id);
      const snapshot = Object.freeze({
        ...message2,
        sender: message2.sender,
        preserved: true,
        preservedReason: message2.preservedReason,
        preservedMeta: message2.preservedMeta ? Object.freeze({ ...message2.preservedMeta }) : void 0,
        preservedAt: previous?.preservedAt ?? message2.preservedAt
      });
      if (previous && sameRecord(previous, snapshot)) return;
      this.records.set(message2.id, snapshot);
      while (this.records.size > this.capacity) {
        const oldest = this.records.keys().next().value;
        if (oldest === void 0) break;
        this.records.delete(oldest);
      }
      this.changed();
    }
    get(messageId) {
      return this.records.get(messageId);
    }
    /** Oldest first. A fresh array; the records themselves are frozen. */
    toArray() {
      return Array.from(this.records.values());
    }
    forSlug(slug) {
      const normalizedSlug = normalizeChatIdentity(slug);
      if (!normalizedSlug) return [];
      return this.toArray().filter((record2) => normalizeChatIdentity(record2.sender.slug) === normalizedSlug);
    }
    /** Called synchronously after every change. Returns the unsubscribe function. */
    subscribe(listener) {
      this.changeListeners.add(listener);
      return () => this.changeListeners.delete(listener);
    }
    clear() {
      if (this.records.size === 0) return;
      this.records.clear();
      this.changed();
    }
    changed() {
      this.revision += 1;
      for (const listener of this.changeListeners) {
        try {
          listener();
        } catch (error) {
          logger.debug("RemovedLedger listener threw", error);
        }
      }
    }
  };
  function sameRecord(a, b) {
    return a.preservedReason === b.preservedReason && a.content === b.content && JSON.stringify(a.preservedMeta ?? null) === JSON.stringify(b.preservedMeta ?? null);
  }
  var ChatDomRegistry = class {
    constructor() {
      this.messageByElement = /* @__PURE__ */ new WeakMap();
      this.elementByMessageId = /* @__PURE__ */ new Map();
      this.elementsByUserId = /* @__PURE__ */ new Map();
    }
    register(element, message2) {
      this.messageByElement.set(element, message2);
      this.elementByMessageId.set(message2.id, element);
      if (message2.systemEvent) return;
      let set = this.elementsByUserId.get(message2.sender.id);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.elementsByUserId.set(message2.sender.id, set);
      }
      set.add(element);
    }
    getMessage(element) {
      return this.messageByElement.get(element);
    }
    getElementForMessageId(messageId) {
      return this.elementByMessageId.get(messageId);
    }
    getElementsForUser(userId) {
      const set = this.elementsByUserId.get(userId);
      return set ? Array.from(set) : [];
    }
    forget(element) {
      const message2 = this.messageByElement.get(element);
      if (!message2) return;
      this.elementByMessageId.delete(message2.id);
      if (message2.systemEvent) return;
      const set = this.elementsByUserId.get(message2.sender.id);
      if (set) {
        set.delete(element);
        if (set.size === 0) this.elementsByUserId.delete(message2.sender.id);
      }
    }
    clear() {
      this.elementByMessageId.clear();
      this.elementsByUserId.clear();
    }
  };
  var ChatIntegrityStore = class {
    constructor(options = {}) {
      this.options = options;
      this.messageById = /* @__PURE__ */ new Map();
      this.messagesByUserId = /* @__PURE__ */ new Map();
      this.global = new LimitedQueue(GLOBAL_CAPACITY);
      // Separate pinned sub-collection, exempt from the eviction below. Without this, a fast
      // chat would silently evict the very messages this extension exists to preserve.
      // Bounded on two axes so it can never grow without bound itself: capacity (50, via
      // LimitedQueue) AND age (PRESERVED_TTL_MS, via sweepExpiredPreserved).
      this.preserved = new LimitedQueue(PRESERVED_CAPACITY);
      // When showDeletedMessages is off, the row leaves messageById so a pending render is dropped.
      // Keep a bounded id tombstone so a reconnect/history replay cannot resurrect it, and so an old
      // object still draining from the ordinary rings can never collide with a replacement id.
      this.removedMessageIds = /* @__PURE__ */ new Set();
      this.removedMessageIdOrder = new LimitedQueue(GLOBAL_CAPACITY);
      // A live delete can race the initial history response. Retain its metadata until that message
      // arrives so the stale history snapshot is born preserved instead of flashing as a normal row.
      this.pendingDeletedById = /* @__PURE__ */ new Map();
      this.pendingDeleteOrder = new LimitedQueue(GLOBAL_CAPACITY);
      this.nextSeq = 1;
      // userId -> the most recent ban, for lines that arrive just after it (LATE_BAN_WINDOW_MS).
      this.recentBans = /* @__PURE__ */ new Map();
      /** The session's ban/delete list. Survives the preserved TTL/cap, ring eviction and reset(). */
      this.removed = new RemovedLedger();
    }
    /** Adds a message once. The boolean lets callers avoid queueing a duplicate id for render. */
    addMessage(message2) {
      if (this.messageById.has(message2.id) || this.removedMessageIds.has(message2.id)) return false;
      message2.seq ??= this.nextSeq++;
      this.messageById.set(message2.id, message2);
      if (!message2.systemEvent) {
        rememberChatIdentityColor(message2.sender);
        this.indexByUser(message2);
      }
      const evictedGlobally = this.global.push(message2);
      if (evictedGlobally) this.forget(evictedGlobally);
      const pendingDelete = this.pendingDeletedById.get(message2.id);
      if (pendingDelete && !message2.systemEvent) {
        this.pendingDeletedById.delete(message2.id);
        this.preserveMessage(message2, "deleted", pendingDelete.meta);
      }
      if (!message2.systemEvent) this.applyRecentBan(message2);
      if (!message2.systemEvent) {
        try {
          this.options.onMessageAdded?.(message2);
        } catch (error) {
          logger.debug("ChatIntegrityStore onMessageAdded callback threw", error);
        }
      }
      return true;
    }
    indexByUser(message2) {
      let ids = this.messagesByUserId.get(message2.sender.id);
      if (!ids) {
        ids = /* @__PURE__ */ new Set();
        this.messagesByUserId.set(message2.sender.id, ids);
      }
      ids.add(message2.id);
    }
    /** Preserved messages must survive normal ring-buffer eviction (see the preserved
     * sub-collection above) — only forget non-preserved messages here. */
    forget(message2) {
      if (message2.preserved) return;
      this.messageById.delete(message2.id);
      if (message2.systemEvent) return;
      const ids = this.messagesByUserId.get(message2.sender.id);
      if (ids) {
        ids.delete(message2.id);
        if (ids.size === 0) this.messagesByUserId.delete(message2.sender.id);
      }
    }
    getOwnedMessagesByUserId(userId) {
      const ids = this.messagesByUserId.get(userId);
      if (!ids) return [];
      const result = [];
      for (const id of ids) {
        const message2 = this.messageById.get(id);
        if (message2) result.push(message2);
      }
      return result;
    }
    getMessageById(messageId) {
      return this.messageById.get(messageId);
    }
    getMessageSeq(messageId) {
      return this.messageById.get(messageId)?.seq;
    }
    /** Fully drop a non-preserved message from the index, used by own-render mode when
     * showDeletedMessages is off and KickFlow must mimic native row removal itself. */
    removeMessage(messageId) {
      const message2 = this.messageById.get(messageId);
      if (message2?.preserved) return;
      this.rememberRemovedMessageId(messageId);
      this.pendingDeletedById.delete(messageId);
      if (!message2) return;
      this.messageById.delete(messageId);
      if (message2.systemEvent) return;
      const ids = this.messagesByUserId.get(message2.sender.id);
      if (ids) {
        ids.delete(messageId);
        if (ids.size === 0) this.messagesByUserId.delete(message2.sender.id);
      }
    }
    rememberRemovedMessageId(messageId) {
      if (this.removedMessageIds.has(messageId)) return;
      this.removedMessageIds.add(messageId);
      const evicted = this.removedMessageIdOrder.push(messageId);
      if (evicted) this.removedMessageIds.delete(evicted);
    }
    isPreservedBanned(messageId) {
      const message2 = this.messageById.get(messageId);
      return message2?.preserved === true && message2.preservedReason === "banned";
    }
    getMessagesInArrivalOrder() {
      return Array.from(this.messageById.values()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    }
    markUserBanned(userId, meta = {}) {
      const messages2 = this.getOwnedMessagesByUserId(userId);
      for (const message2 of messages2) {
        this.preserveMessage(message2, "banned", meta);
      }
      this.recentBans.delete(userId);
      this.recentBans.set(userId, { meta, at: this.now() });
      if (this.recentBans.size > LATE_BAN_CAPACITY) {
        const oldest = this.recentBans.keys().next().value;
        if (oldest !== void 0) this.recentBans.delete(oldest);
      }
      return messages2;
    }
    applyRecentBan(message2) {
      const ban = this.recentBans.get(message2.sender.id);
      if (!ban) return;
      if (this.now() - ban.at > LATE_BAN_WINDOW_MS) {
        this.recentBans.delete(message2.sender.id);
        return;
      }
      this.preserveMessage(message2, "banned", ban.meta);
    }
    now() {
      return this.options.now?.() ?? Date.now();
    }
    markMessageDeleted(messageId, meta = {}) {
      const message2 = this.messageById.get(messageId);
      if (!message2) {
        this.rememberPendingDelete(messageId, meta);
        return void 0;
      }
      if (message2.systemEvent) return void 0;
      this.preserveMessage(message2, "deleted", meta);
      return message2;
    }
    rememberPendingDelete(messageId, meta) {
      const existing = this.pendingDeletedById.get(messageId);
      if (existing) {
        existing.meta = this.mergePreservedMeta(existing.meta, meta);
        return;
      }
      const pending = { id: messageId, meta: this.mergePreservedMeta(void 0, meta) };
      this.pendingDeletedById.set(messageId, pending);
      const evicted = this.pendingDeleteOrder.push(pending);
      if (evicted && this.pendingDeletedById.get(evicted.id) === evicted) {
        this.pendingDeletedById.delete(evicted.id);
      }
    }
    preserveMessage(message2, reason, meta = {}) {
      if (message2.preserved) {
        message2.preservedMeta = this.mergePreservedMeta(message2.preservedMeta, meta);
        if (reason === "banned" && message2.preservedReason !== "banned") {
          message2.preservedReason = "banned";
          message2.preservedAt = Date.now();
          this.removed.record(message2);
          this.notifyMessagePreserved(message2, reason);
          return;
        }
        this.removed.record(message2);
        return;
      }
      message2.preserved = true;
      message2.preservedReason = reason;
      message2.preservedMeta = this.mergePreservedMeta(void 0, meta);
      message2.preservedAt = Date.now();
      let evicted;
      if (this.preserved.size === PRESERVED_CAPACITY) {
        const retained = this.preserved.toArray();
        evicted = retained.find((item) => item.sender.id === message2.sender.id) ?? retained[0];
        this.preserved.clear();
        for (const item of retained) {
          if (item !== evicted) this.preserved.push(item);
        }
      }
      this.preserved.push(message2);
      if (evicted) {
        this.unpreserve(evicted);
      }
      this.removed.record(message2);
      this.notifyMessagePreserved(message2, reason);
    }
    notifyMessagePreserved(message2, reason) {
      try {
        this.options.onMessagePreserved?.(message2, reason);
      } catch (error) {
        logger.debug("ChatIntegrityStore onMessagePreserved callback threw", error);
      }
    }
    unpreserve(message2) {
      message2.preserved = false;
      message2.preservedReason = void 0;
      message2.preservedMeta = void 0;
      message2.preservedAt = void 0;
      if (!this.isRetainedInGlobalRing(message2)) this.forget(message2);
      this.options.onPreservedEvicted?.(message2);
    }
    isRetainedInGlobalRing(message2) {
      return this.global.includes(message2);
    }
    /** Keeps richer moderation details that arrive in a later event, without replacing known
     * details with null/empty placeholders from a thinner payload. */
    mergePreservedMeta(existing, incoming) {
      const merged = { ...existing };
      if (incoming.permanent != null) merged.permanent = incoming.permanent;
      if (incoming.durationMin != null) merged.durationMin = incoming.durationMin;
      if (incoming.bannedBy != null) merged.bannedBy = incoming.bannedBy;
      if (incoming.aiModerated != null) merged.aiModerated = incoming.aiModerated;
      if (incoming.deletedBy != null) merged.deletedBy = incoming.deletedBy;
      if (incoming.violatedRules && incoming.violatedRules.length > 0) {
        merged.violatedRules = incoming.violatedRules;
      }
      return merged;
    }
    /** Cheap TTL sweep (O(<=50); meant to run on a slow interval from bootstrap.ts) so a
     * message doesn't stay preserved forever just because fewer than 50 more
     * preservations happened after it. */
    sweepExpiredPreserved(now = Date.now()) {
      const survivors = [];
      let expiredCount = 0;
      for (const message2 of this.preserved.toArray()) {
        const preservedAt = message2.preservedAt ?? Date.parse(message2.createdAt);
        const age = Number.isNaN(preservedAt) ? 0 : now - preservedAt;
        if (age > PRESERVED_TTL_MS) {
          expiredCount++;
          this.unpreserve(message2);
        } else {
          survivors.push(message2);
        }
      }
      if (expiredCount === 0) return;
      this.preserved.clear();
      for (const survivor of survivors) this.preserved.push(survivor);
    }
    getPreserved() {
      return this.preserved.toArray();
    }
    /** Returns this session's removed-message records for one canonical Kick slug, from the
     * removed ledger, so the answer does not change when the preserved window expires. */
    getPreservedForSlug(slug) {
      return this.removed.forSlug(slug);
    }
    /** The native Active Chatters row renders `username` but keeps `slug` only as a React key. Use
     * the exact session-known username solely to recover a canonical slug, and fail closed if the
     * removed ledger maps that username to more than one slug. */
    resolvePreservedSlugForUsername(username) {
      const normalizedUsername = normalizeChatIdentity(username);
      if (!normalizedUsername) return null;
      const slugs = /* @__PURE__ */ new Map();
      for (const message2 of this.removed.toArray()) {
        if (normalizeChatIdentity(message2.sender.username) !== normalizedUsername) continue;
        const normalizedSlug = normalizeChatIdentity(message2.sender.slug);
        if (normalizedSlug) slugs.set(normalizedSlug, message2.sender.slug.trim());
      }
      return slugs.size === 1 ? slugs.values().next().value ?? null : null;
    }
    /** Clears the chat history (a VOD seek). The removed ledger is deliberately kept: clearing the
     * history must not clear the ban/delete list. A new session gets a new store and ledger. */
    reset() {
      this.messageById.clear();
      this.messagesByUserId.clear();
      this.global.clear();
      this.preserved.clear();
      this.removedMessageIds.clear();
      this.removedMessageIdOrder.clear();
      this.pendingDeletedById.clear();
      this.pendingDeleteOrder.clear();
      this.nextSeq = 1;
    }
  };

  // src/content/chat/archive-session.ts
  var sessionArchive = null;
  function configureUserMessageArchive(archive) {
    sessionArchive = archive;
  }
  function getUserMessageArchive() {
    return sessionArchive;
  }

  // src/content/chat/dom-window.ts
  var MAX_NON_PRESERVED_NODES = 200;
  var MAX_NON_PRESERVED_NODES_PAUSED = 600;
  var BOTTOM_THRESHOLD_PX = 60;
  var USER_SCROLL_INPUT_WINDOW_MS = 1500;
  var READER_SCROLL_EVENT = "kickflow:reader-scroll";
  function isNearBottom(container) {
    return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
  }
  var ScrollFollowController = class {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.pinned = true;
      this.disposed = false;
      this.programmaticScroll = false;
      this.programmaticClearFrame = null;
      this.unsettledFollow = null;
      this.contentLanded = false;
      this.pointerHeld = false;
      this.hoverHeld = false;
      this.pointerReleaseFrame = null;
      this.observedRows = /* @__PURE__ */ new Set();
      this.lastUserInputAt = Number.NEGATIVE_INFINITY;
      /** Middle-button autoscroll moves the offset with no further input events until the next press. */
      this.autoscrollHeld = false;
      this.noteUserInput = () => {
        this.lastUserInputAt = this.now();
      };
      this.handleKeyDown = () => {
        this.autoscrollHeld = false;
        this.noteUserInput();
      };
      this.handlePointerDown = (event) => {
        if (this.disposed) return;
        this.noteUserInput();
        this.autoscrollHeld = event.button === 1;
        if (event.button !== 0) return;
        if (this.pointerReleaseFrame !== null) this.cancelFrame(this.pointerReleaseFrame);
        this.pointerReleaseFrame = null;
        this.pointerHeld = true;
        if (this.unsettledFollow && typeof this.container.scrollTo === "function") {
          this.container.scrollTo({ top: this.container.scrollTop, behavior: "instant" });
        }
        this.unsettledFollow = null;
      };
      this.handlePointerRelease = () => {
        if (!this.pointerHeld || this.disposed) return;
        if (this.pointerReleaseFrame !== null) return;
        this.pointerReleaseFrame = this.scheduleFrame(() => {
          this.pointerReleaseFrame = null;
          if (this.disposed || !this.pointerHeld) return;
          this.pointerHeld = false;
          if (this.isPinned) {
            this.options.onPinnedChange?.(true);
            this.scrollToBottom();
          }
        });
      };
      this.handleWheel = (event) => {
        if (!this.disposed) {
          this.autoscrollHeld = false;
          this.noteUserInput();
        }
        if (this.disposed || event.defaultPrevented || event.ctrlKey || event.deltaY >= 0 || this.container.scrollHeight <= this.container.clientHeight || this.container.scrollTop <= 0 && !this.unsettledFollow) return;
        if (this.unsettledFollow && typeof this.container.scrollTo === "function") {
          this.container.scrollTo({ top: this.container.scrollTop, behavior: "instant" });
        }
        this.programmaticScroll = false;
        this.unsettledFollow = null;
        this.setPinned(false);
      };
      this.handleScroll = () => {
        if (this.disposed) return;
        const movedUp = this.container.scrollTop < this.lastScrollTop;
        this.lastScrollTop = this.container.scrollTop;
        if (isNearBottom(this.container) && (this.pinned || !movedUp)) {
          this.setPinned(true);
          return;
        }
        if (this.programmaticScroll && !movedUp) return;
        if (!movedUp) return;
        if (!this.userScrollRecent()) {
          if (this.pinned) this.scrollToBottom(this.options.getScrollFollowBehavior?.() ?? "auto");
          return;
        }
        this.programmaticScroll = false;
        this.unsettledFollow = null;
        this.setPinned(false);
      };
      this.handleScrollEnd = () => {
        if (this.disposed || !this.unsettledFollow) return;
        if (this.container.scrollTop >= this.unsettledFollow.bottomTarget) {
          this.unsettledFollow = null;
        }
      };
      this.handleRowsResized = () => {
        if (this.disposed) return;
        this.pruneObservedRows();
        if (this.isPinned) {
          const behavior = this.options.getScrollFollowBehavior?.() ?? "auto";
          if (this.unsettledFollow?.bottomTarget === this.bottomTarget && this.unsettledFollow.behavior === behavior) return;
          this.scrollToBottom(behavior);
        }
      };
      this.lastScrollTop = container.scrollTop;
      this.scheduleFrame = options.scheduleFrame ?? ((callback) => window.requestAnimationFrame(callback));
      this.cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
      this.now = options.now ?? (() => performance.now());
      const createResizeObserver = options.createResizeObserver ?? ((callback) => new ResizeObserver(callback));
      this.resizeObserver = createResizeObserver(this.handleRowsResized);
      this.resizeObserver?.observe(container);
      container.addEventListener("scroll", this.handleScroll);
      container.addEventListener("scrollend", this.handleScrollEnd);
      container.addEventListener("wheel", this.handleWheel, { passive: true });
      container.addEventListener("pointerdown", this.handlePointerDown);
      container.addEventListener("touchstart", this.noteUserInput, { passive: true });
      container.addEventListener("touchmove", this.noteUserInput, { passive: true });
      container.addEventListener(READER_SCROLL_EVENT, this.noteUserInput);
      document.addEventListener("keydown", this.handleKeyDown, true);
      document.addEventListener("pointerup", this.handlePointerRelease);
      document.addEventListener("pointercancel", this.handlePointerRelease);
      window.addEventListener("blur", this.handlePointerRelease);
    }
    get isPinned() {
      return this.pinned && !this.pointerHeld && !this.hoverHeld;
    }
    /** Suspend automatic motion while aiming, without changing wheel/scrollbar follow intent. */
    setHoverHeld(held) {
      if (this.disposed || this.hoverHeld === held) return;
      const wasPinned = this.isPinned;
      this.hoverHeld = held;
      if (held) {
        if (this.unsettledFollow && typeof this.container.scrollTo === "function") {
          this.container.scrollTo({ top: this.container.scrollTop, behavior: "instant" });
        }
        this.unsettledFollow = null;
      }
      if (wasPinned !== this.isPinned) this.options.onPinnedChange?.(this.isPinned);
      if (!held && this.isPinned) this.scrollToBottom();
    }
    /** Snap through one marked programmatic-scroll window. Explicit user intent always wins, even
     * if the user starts scrolling upward before the browser delivers our synthetic scroll event. */
    scrollToBottom(behavior = "auto") {
      if (this.disposed || this.pointerHeld || this.hoverHeld) return;
      if (this.container.childElementCount === 0) this.contentLanded = false;
      else if (this.container.clientHeight > 0) {
        if (!this.contentLanded) behavior = "auto";
        this.contentLanded = true;
      }
      this.setPinned(true);
      this.programmaticScroll = true;
      const top = this.container.scrollHeight;
      if (behavior === "smooth" && typeof this.container.scrollTo === "function") {
        this.unsettledFollow = { bottomTarget: this.bottomTarget, behavior };
        this.container.scrollTo({ top, behavior });
      } else {
        this.unsettledFollow = null;
        this.container.scrollTop = top;
      }
      this.lastScrollTop = this.container.scrollTop;
      if (this.programmaticClearFrame !== null) this.cancelFrame(this.programmaticClearFrame);
      this.programmaticClearFrame = this.scheduleFrame(() => {
        this.programmaticClearFrame = null;
        this.programmaticScroll = false;
      });
    }
    /** Observe direct message rows rather than the fixed-height scroll container: a scroller's
     * content box does not resize when an image inside it gains height, but its row does. */
    observeRows(rows) {
      if (this.disposed || !this.resizeObserver) return;
      this.pruneObservedRows();
      for (const row of rows) {
        if (row.parentElement !== this.container || this.observedRows.has(row)) continue;
        this.observedRows.add(row);
        this.resizeObserver.observe(row);
      }
    }
    /** Capture any pending user scroll before a DOM trim, then accept the trim's anchor
     * correction without mistaking that offset decrease for fresh upward input. */
    preserveScrollIntent(mutate) {
      if (this.disposed) return;
      const readerActive = this.userScrollRecent();
      if (readerActive) this.handleScroll();
      mutate();
      if (readerActive || !this.isPinned) this.lastScrollTop = this.container.scrollTop;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.container.removeEventListener("scroll", this.handleScroll);
      this.container.removeEventListener("scrollend", this.handleScrollEnd);
      this.container.removeEventListener("wheel", this.handleWheel);
      this.container.removeEventListener("pointerdown", this.handlePointerDown);
      this.container.removeEventListener("touchstart", this.noteUserInput);
      this.container.removeEventListener("touchmove", this.noteUserInput);
      this.container.removeEventListener(READER_SCROLL_EVENT, this.noteUserInput);
      document.removeEventListener("keydown", this.handleKeyDown, true);
      document.removeEventListener("pointerup", this.handlePointerRelease);
      document.removeEventListener("pointercancel", this.handlePointerRelease);
      window.removeEventListener("blur", this.handlePointerRelease);
      if (this.programmaticClearFrame !== null) this.cancelFrame(this.programmaticClearFrame);
      if (this.pointerReleaseFrame !== null) this.cancelFrame(this.pointerReleaseFrame);
      this.resizeObserver?.disconnect();
      this.observedRows.clear();
    }
    /** Keep a pressed username, link or selection under the pointer until its click completes.
     * A hover meter still releases rows, and smooth follow used to move the target between
     * pointerdown and pointerup. Retain the user's prior follow intent rather than repinning
     * someone who had already wheeled up. */
    userScrollRecent() {
      return this.pointerHeld || this.autoscrollHeld || this.now() - this.lastUserInputAt <= USER_SCROLL_INPUT_WINDOW_MS;
    }
    get bottomTarget() {
      return Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    }
    setPinned(pinned) {
      if (this.pinned === pinned) return;
      this.pinned = pinned;
      this.options.onPinnedChange?.(pinned);
    }
    pruneObservedRows() {
      if (!this.resizeObserver) return;
      const hadRows = this.observedRows.size > 0;
      for (const row of this.observedRows) {
        if (row.parentElement === this.container) continue;
        this.resizeObserver.unobserve(row);
        this.observedRows.delete(row);
      }
      if (hadRows && this.observedRows.size === 0) this.contentLanded = false;
    }
  };
  function trimMessageWindow(container, registry, maxNodes = MAX_NON_PRESERVED_NODES, keepOffset = true) {
    const messages2 = Array.from(container.children).filter(
      (child) => child.classList.contains(MESSAGE_CLASS)
    );
    const nonPreserved = messages2.filter((child) => !child.classList.contains(PRESERVED_CLASS));
    const overflow = nonPreserved.length - maxNodes;
    if (overflow <= 0) return;
    const preserveOffset = typeof keepOffset === "function" ? keepOffset() : keepOffset;
    let removedHeight = 0;
    for (let i = 0; preserveOffset && i < overflow; i++) {
      removedHeight += nonPreserved[i].getBoundingClientRect().height;
    }
    const scrollTop = preserveOffset ? container.scrollTop : 0;
    for (let i = 0; i < overflow; i++) {
      const node = nonPreserved[i];
      registry.forget(node);
      container.removeChild(node);
    }
    if (removedHeight > 0) {
      container.scrollTop = scrollTop - removedHeight;
    }
    logger.debug("dom-window: trimmed", overflow, "node(s)");
  }
  function decideScrollFollow(stickToBottom, appendedCount, isHovered = false, hoveredBehavior = "smooth") {
    if (stickToBottom) {
      return {
        scrollToBottom: true,
        scrollBehavior: isHovered ? hoveredBehavior : "auto",
        trimCap: MAX_NON_PRESERVED_NODES,
        showPill: false
      };
    }
    return {
      scrollToBottom: false,
      scrollBehavior: "auto",
      trimCap: MAX_NON_PRESERVED_NODES_PAUSED,
      showPill: appendedCount > 0
    };
  }
  var HOVER_AIM_IDLE_MS = 2e3;
  function attachScrollFollowHover(container, follow, options = {}) {
    let hovered = false;
    let pointer = null;
    let pointerRow = null;
    let hoverFrame = null;
    let idleTimer = null;
    const releaseHold = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = null;
      follow.setHoverHeld(false);
    };
    const holdAim = () => {
      follow.setHoverHeld(true);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(releaseHold, HOVER_AIM_IDLE_MS);
    };
    const markRow = (row) => {
      if (row === pointerRow && (!row || row.isConnected)) return;
      pointerRow?.removeAttribute("data-kickflow-pointer-row");
      pointerRow = row;
      row?.setAttribute("data-kickflow-pointer-row", "");
    };
    const refreshRow = () => {
      if (!pointer || !container.isConnected) {
        markRow(null);
        return;
      }
      const hit = document.elementFromPoint(pointer.x, pointer.y);
      const row = hit?.closest(`.${MESSAGE_CLASS}`) ?? null;
      markRow(row?.parentElement === container ? row : null);
    };
    const scheduleRowRefresh = () => {
      if (!pointer || hoverFrame !== null) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = null;
        refreshRow();
      });
    };
    const onListPointerMove = (event) => {
      if (event.pointerType === "touch") {
        pointer = null;
        markRow(null);
        releaseHold();
        return;
      }
      if (hovered) holdAim();
      pointer = { x: event.clientX, y: event.clientY };
      refreshRow();
    };
    const clearPointerRow = () => {
      pointer = null;
      markRow(null);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") forceExit();
    };
    const rowObserver = new MutationObserver(scheduleRowRefresh);
    rowObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    container.addEventListener("pointermove", onListPointerMove);
    container.addEventListener("scroll", scheduleRowRefresh);
    const onBlur = () => forceExit();
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    let overContinuation = false;
    let pendingFooterExit = null;
    const cancelFooterExit = () => {
      if (pendingFooterExit === null) return;
      window.clearTimeout(pendingFooterExit);
      pendingFooterExit = null;
    };
    const setHovered = (next) => {
      if (hovered === next) return;
      hovered = next;
      if (next) holdAim();
      else {
        clearPointerRow();
        releaseHold();
      }
      options.onHoverChange?.(next);
      if (!next) options.onPointerLeave?.();
    };
    const isContinuation = (target, event) => {
      if (!options.hoverContinuationSelector || !(target instanceof Element) || !target.closest(options.hoverContinuationSelector)) return false;
      const rect = container.getBoundingClientRect();
      const isQuickEmoteBar = Boolean(target.closest("[data-kickflow-native-quick-emotes]"));
      return event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom + (isQuickEmoteBar ? 72 : 0);
    };
    const isQuickEmoteGap = (event) => {
      if (!options.hoverContinuationSelector || !document.querySelector("[data-kickflow-native-quick-emotes]")) return false;
      const rect = container.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.bottom - 16 && event.clientY < rect.bottom + 72;
    };
    const deferFooterExit = () => {
      cancelFooterExit();
      pendingFooterExit = window.setTimeout(() => {
        pendingFooterExit = null;
        setHovered(false);
      }, 120);
    };
    const onPointerEnter = (event) => {
      if (event.pointerType === "touch") return;
      holdAim();
      cancelFooterExit();
      overContinuation = false;
      setHovered(true);
    };
    const onPointerLeave = (event) => {
      clearPointerRow();
      overContinuation = isContinuation(event.relatedTarget, event);
      if (overContinuation) cancelFooterExit();
      else if (isQuickEmoteGap(event)) deferFooterExit();
      else {
        cancelFooterExit();
        setHovered(false);
      }
    };
    const onPointerMove = (event) => {
      if (event.pointerType === "touch") return;
      const next = isContinuation(event.target, event);
      if (next) {
        cancelFooterExit();
        holdAim();
        setHovered(true);
      } else if (overContinuation && !(event.target instanceof Node && container.contains(event.target))) {
        if (isQuickEmoteGap(event)) deferFooterExit();
        else {
          cancelFooterExit();
          setHovered(false);
        }
      } else if (pendingFooterExit !== null && !isQuickEmoteGap(event) && !(event.target instanceof Node && container.contains(event.target))) {
        cancelFooterExit();
        setHovered(false);
      }
      overContinuation = next;
    };
    const endContinuation = () => {
      if (!overContinuation && pendingFooterExit === null) return;
      cancelFooterExit();
      overContinuation = false;
      setHovered(false);
    };
    const onDocumentExit = (event) => {
      if (event.relatedTarget === null) endContinuation();
    };
    const forceExit = () => {
      cancelFooterExit();
      overContinuation = false;
      clearPointerRow();
      releaseHold();
      setHovered(false);
    };
    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);
    if (options.hoverContinuationSelector) {
      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerout", onDocumentExit, true);
      window.addEventListener("blur", endContinuation);
    }
    return {
      get isHovered() {
        return hovered;
      },
      decide(appendedCount) {
        return decideScrollFollow(
          follow.isPinned,
          appendedCount,
          hovered,
          options.getHoveredBehavior?.() ?? "smooth"
        );
      },
      apply(decision) {
        if (!decision.scrollToBottom) return;
        follow.scrollToBottom(decision.scrollBehavior);
      },
      dispose() {
        if (hoverFrame !== null) window.cancelAnimationFrame(hoverFrame);
        rowObserver.disconnect();
        clearPointerRow();
        releaseHold();
        container.removeEventListener("pointermove", onListPointerMove);
        container.removeEventListener("scroll", scheduleRowRefresh);
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        cancelFooterExit();
        container.removeEventListener("pointerenter", onPointerEnter);
        container.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("pointerout", onDocumentExit, true);
        window.removeEventListener("blur", endContinuation);
      }
    };
  }

  // src/content/chat/native-user-card.ts
  var SAFE_NAME = /^[a-zA-Z0-9_-]+$/;
  var request = null;
  var closeObserver = null;
  var navigation = window.navigation;
  function resetNativeUserCardRequest() {
    request = null;
    closeObserver?.disconnect();
    closeObserver = null;
    navigation?.removeEventListener("navigate", resetNativeUserCardRequest);
    window.removeEventListener("popstate", resetNativeUserCardRequest);
  }
  function openNativeUserCard(username, profileSlug = username) {
    if (!SAFE_NAME.test(username) || !SAFE_NAME.test(profileSlug)) return false;
    const name = username.toLowerCase();
    const buttons = Array.from(document.querySelectorAll("#chatroom-messages button[title]"));
    const button = buttons.reverse().find((node) => node.title.toLowerCase() === name && node.textContent?.trim().toLowerCase() === name && !node.disabled);
    if (!button) return false;
    resetNativeUserCardRequest();
    request = { slug: profileSlug.toLowerCase(), route: location.href, deadline: performance.now() + 8e3, root: null };
    navigation?.addEventListener("navigate", resetNativeUserCardRequest);
    window.addEventListener("popstate", resetNativeUserCardRequest);
    button.click();
    return true;
  }
  function isRequestedNativeUserCardSurface(element) {
    if (!request) return false;
    if (request.route !== location.href) {
      resetNativeUserCardRequest();
      return false;
    }
    const root = element.closest("#user-identity");
    if (!root || !root.isConnected) return false;
    const profile = Array.from(root.querySelectorAll("a[href]")).some((anchor) => {
      try {
        const url = new URL(anchor.href);
        return url.origin === "https://kick.com" && url.pathname.toLowerCase() === `/${request.slug}`;
      } catch {
        return false;
      }
    });
    if (!profile) {
      if (request.root === root) resetNativeUserCardRequest();
      return false;
    }
    if (!request.root && performance.now() <= request.deadline) {
      request.root = root;
      closeObserver = new MutationObserver((records) => {
        const removed = records.some((record2) => Array.from(record2.removedNodes).some((node) => node === root || node instanceof Element && node.contains(root)));
        const style = getComputedStyle(root);
        if (removed || !root.isConnected || root.hidden || style.display === "none" || style.visibility === "hidden") {
          resetNativeUserCardRequest();
        }
      });
      closeObserver.observe(document.body, { childList: true, subtree: true });
      closeObserver.observe(root, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    }
    return request.root === root;
  }

  // src/content/chat/overlay-mount.ts
  function scheduleChatStartup(mount) {
    let done = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector("#chatroom-messages")) start();
    });
    const cleanup = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("load", start);
    };
    const start = () => {
      if (done) return;
      done = true;
      cleanup();
      mount();
    };
    const timer = window.setTimeout(start, 3e3);
    window.addEventListener("load", start, { once: true });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === "complete" || document.querySelector("#chatroom-messages")) start();
    return () => {
      done = true;
      cleanup();
    };
  }
  var OVERLAY_ROOT_ID = "kickflow-chat-overlay";
  var OWN_LIST_ID = "kickflow-message-list";
  var CHAT_ACTIVE_CLASS = "kickflow-chat-active";
  var STATUS_ATTRIBUTE = "data-kickflow-chat-status";
  var SYNC_INTERVAL_MS = 500;
  var HOT_PATH_FRESH_MS = 300;
  var GEOMETRY_EPSILON_PX = 0.5;
  var OWN_CHAT_SURFACE_SELECTOR = ".kickflow-user-card, .kickflow-avatar-preview, .kickflow-panel";
  var NATIVE_CHAT_PRESENTATION_TOKENS = [
    "--chatroom-font-size",
    "--chatroom-timestamps-display",
    "--chatroom-message-spacing"
  ];
  function isCssVisible(element) {
    const style = getComputedStyle(element);
    const opacity = Number.parseFloat(style.opacity);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && (!Number.isFinite(opacity) || opacity > 0);
  }
  function isPassiveNativeTooltipSurface(element) {
    const surface = element.closest('[data-radix-popper-content-wrapper], [role="tooltip"]');
    return surface !== null && (surface.matches('[role="tooltip"]') || surface.querySelector('[role="tooltip"]') !== null) && !surface.matches('[role="menu"], [role="dialog"]') && surface.querySelector('[role="menu"], [role="dialog"], button, a[href], input, select, textarea, [contenteditable="true"]') === null;
  }
  function knownNativeChatSurfaces() {
    const surfaces = [];
    for (const search of document.querySelectorAll(ACTIVE_CHATTERS_SEARCH_SELECTOR)) {
      const panel = search.closest('section, [role="dialog"]');
      if (panel && !panel.contains(document.querySelector(SELECTORS.chatMessagesContainer)) && isCssVisible(panel)) surfaces.push(panel);
    }
    for (const dialog of document.querySelectorAll('[role="dialog"], dialog[open]')) {
      if (isCssVisible(dialog) && dialog.querySelector(SELECTORS.dailyRewardStage) && dialog.querySelector(SELECTORS.dailyRewardFullWidthButton + ".bg-primary-base, button.w-full.bg-brand-bg-default")) {
        surfaces.push(dialog);
      }
    }
    return surfaces;
  }
  function isKnownNativeChatSurface(element) {
    return knownNativeChatSurfaces().some((surface) => surface === element || surface.contains(element) || element.matches("[data-radix-popper-content-wrapper]") && element.contains(surface) || element instanceof HTMLElement && element.matches('div[data-state="open"][aria-hidden="true"]') && element.parentElement === surface.parentElement && getComputedStyle(element).position === "fixed" && element.querySelector('button, a[href], input, [role="dialog"]') === null);
  }
  var NATIVE_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';
  var INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [contenteditable="true"]';
  function viewportSize() {
    const html = document.documentElement;
    return {
      width: html.clientWidth > 0 ? html.clientWidth : window.innerWidth,
      height: html.clientHeight > 0 ? html.clientHeight : window.innerHeight
    };
  }
  function isTopLayerModal(dialog) {
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return false;
    try {
      return dialog.matches(":modal");
    } catch {
      return false;
    }
  }
  function isLaidOut(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
  }
  function isOpenNativeDialog(element) {
    if (!(element instanceof HTMLElement) || element.closest(OWN_CHAT_SURFACE_SELECTOR) || element.closest("[hidden]") || !isLaidOut(element)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function isViewportBackdrop(element) {
    if (element.closest(OWN_CHAT_SURFACE_SELECTOR) || !isLaidOut(element) || getComputedStyle(element).position !== "fixed") return false;
    const box = element.getBoundingClientRect();
    const viewport = viewportSize();
    if (!(box.left <= 1 && box.top <= 1 && box.right >= viewport.width - 1 && box.bottom >= viewport.height - 1)) return false;
    return element.querySelector(INTERACTIVE_SELECTOR) === null || element.querySelector(NATIVE_DIALOG_SELECTOR) !== null;
  }
  function backdropHasOpenDialog(backdrop) {
    const candidates = [
      ...Array.from(backdrop.querySelectorAll(NATIVE_DIALOG_SELECTOR)),
      ...Array.from(backdrop.parentElement?.children ?? []).filter((sibling) => sibling !== backdrop).flatMap((sibling) => sibling.matches(NATIVE_DIALOG_SELECTOR) ? [sibling] : Array.from(sibling.querySelectorAll(NATIVE_DIALOG_SELECTOR)))
    ];
    return candidates.some(isOpenNativeDialog);
  }
  function hostsOpenTopLayerModal(element) {
    const shadow = element.shadowRoot;
    if (!shadow) return false;
    return Array.from(shadow.querySelectorAll("dialog[open]")).some(isTopLayerModal);
  }
  function isPageModalLayer(hit) {
    if (hostsOpenTopLayerModal(hit)) return true;
    const topLayer = hit.closest("dialog");
    if (topLayer && isTopLayerModal(topLayer) && !topLayer.closest(OWN_CHAT_SURFACE_SELECTOR)) return true;
    for (let node = hit; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node instanceof HTMLElement && isViewportBackdrop(node) && backdropHasOpenDialog(node)) return true;
    }
    const dialog = hit.closest(NATIVE_DIALOG_SELECTOR);
    if (!dialog || !isOpenNativeDialog(dialog)) return false;
    if (dialog.getAttribute("aria-modal") === "true" || isTopLayerModal(dialog)) return true;
    return Array.from(dialog.parentElement?.children ?? []).some((sibling) => sibling !== dialog && sibling instanceof HTMLElement && isViewportBackdrop(sibling));
  }
  function containsChatAnchor(node) {
    return node instanceof Element && (node.matches('[id="chatroom-messages"]') || node.querySelector('[id="chatroom-messages"]') !== null);
  }
  function toLayoutRect(left, top, width, height) {
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  function horizontallyIntersects(first, second) {
    return Math.min(first.right, second.right) - Math.max(first.left, second.left) > GEOMETRY_EPSILON_PX;
  }
  function spansAnchorWidth(eventStackRect, anchorRect) {
    return eventStackRect.left <= anchorRect.left + GEOMETRY_EPSILON_PX && eventStackRect.right >= anchorRect.right - GEOMETRY_EPSILON_PX;
  }
  function findNativeEventStackObservationTarget(anchor) {
    const parent = anchor.parentElement;
    if (!parent) return null;
    for (let sibling = anchor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling instanceof HTMLElement && sibling.isConnected && sibling.parentElement === parent && sibling.matches(".absolute.w-full")) {
        return sibling;
      }
    }
    return null;
  }
  function resolveNativeEventStackGeometry(anchor) {
    if (anchor.querySelector('#send-message-button, textarea, [contenteditable]:not([contenteditable="false"])')) {
      return { status: "invalid", eventStack: null, eventStackRect: null, ownRect: null };
    }
    const anchorRect = anchor.getBoundingClientRect();
    const fullAnchorRect = toLayoutRect(
      anchorRect.left,
      anchorRect.top,
      anchorRect.width,
      anchorRect.height
    );
    const parent = anchor.parentElement;
    if (!parent) return { status: "invalid", eventStack: null, eventStackRect: null, ownRect: null };
    const topEdgeCandidates = [];
    for (let sibling = anchor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (!(sibling instanceof HTMLElement) || !sibling.matches(".absolute.w-full")) continue;
      if (!sibling.isConnected || sibling.parentElement !== parent || !isCssVisible(sibling)) continue;
      const eventStackRect2 = sibling.getBoundingClientRect();
      if (eventStackRect2.width <= 0 || eventStackRect2.height <= 0) continue;
      const overlapsAnchorTop = eventStackRect2.top <= anchorRect.top + GEOMETRY_EPSILON_PX && eventStackRect2.bottom > anchorRect.top + GEOMETRY_EPSILON_PX;
      if (!overlapsAnchorTop || !horizontallyIntersects(eventStackRect2, anchorRect)) continue;
      topEdgeCandidates.push({ eventStack: sibling, rect: eventStackRect2 });
    }
    if (topEdgeCandidates.length === 0) {
      return { status: "none", eventStack: null, eventStackRect: null, ownRect: fullAnchorRect };
    }
    if (topEdgeCandidates.length !== 1) {
      return { status: "invalid", eventStack: null, eventStackRect: null, ownRect: null };
    }
    const [{ eventStack, rect: eventStackRect }] = topEdgeCandidates;
    if (!spansAnchorWidth(eventStackRect, anchorRect)) {
      return { status: "invalid", eventStack, eventStackRect, ownRect: null };
    }
    const reservedBottom = Math.min(Math.max(eventStackRect.bottom, anchorRect.top), anchorRect.bottom);
    const ownTop = reservedBottom;
    const ownHeight = anchorRect.bottom - ownTop;
    if (!(ownHeight > 0)) {
      return { status: "invalid", eventStack, eventStackRect, ownRect: null };
    }
    return {
      status: "valid",
      eventStack,
      eventStackRect,
      ownRect: toLayoutRect(anchorRect.left, ownTop, anchorRect.width, ownHeight)
    };
  }
  function rectsMatch(first, second) {
    if (!first) return false;
    return Math.abs(first.left - second.left) <= GEOMETRY_EPSILON_PX && Math.abs(first.top - second.top) <= GEOMETRY_EPSILON_PX && Math.abs(first.width - second.width) <= GEOMETRY_EPSILON_PX && Math.abs(first.height - second.height) <= GEOMETRY_EPSILON_PX;
  }
  function inlineGeometryMatches(element, rect) {
    return Math.abs(Number.parseFloat(element.style.left) - rect.left) <= GEOMETRY_EPSILON_PX && Math.abs(Number.parseFloat(element.style.top) - rect.top) <= GEOMETRY_EPSILON_PX && Math.abs(Number.parseFloat(element.style.width) - rect.width) <= GEOMETRY_EPSILON_PX && Math.abs(Number.parseFloat(element.style.height) - rect.height) <= GEOMETRY_EPSILON_PX;
  }
  var ChatOverlayMount = class {
    constructor(lifecycle) {
      this.takeoverState = "native";
      this.contentReady = false;
      this.primaryReady = false;
      // Layout recovery is not proof that an unavailable transport recovered.
      this.sourceUnavailable = false;
      this.observedAnchor = null;
      this.observedEventStack = null;
      this.observedEventStackParent = null;
      this.availableOwnListRect = null;
      this.lastVerifiedAt = -Infinity;
      this.hotPathDepth = 0;
      this.statusElement = null;
      this.retryHandler = null;
      this.disposed = false;
      const root = document.createElement("div");
      root.id = OVERLAY_ROOT_ID;
      root.style.position = "fixed";
      root.style.zIndex = "30";
      root.style.display = "none";
      root.style.pointerEvents = "none";
      const ownList = document.createElement("div");
      ownList.id = OWN_LIST_ID;
      ownList.style.display = "none";
      ownList.style.pointerEvents = "auto";
      root.append(ownList);
      document.body.appendChild(root);
      this.root = root;
      this.ownList = ownList;
      const sync = () => {
        this.invalidateVerification();
        this.syncNow();
      };
      this.resizeObserver = new ResizeObserver((entries) => {
        const eventStackDriven = entries.length > 0 && entries.every((entry) => entry.target === this.observedEventStack);
        this.invalidateVerification();
        this.syncNow(!eventStackDriven);
      });
      this.resizeObserver.observe(document.documentElement);
      lifecycle.add(() => this.resizeObserver.disconnect());
      this.mutationObserver = new MutationObserver((records) => {
        const relevant = records.some((record2) => {
          if (record2.type === "attributes") return record2.attributeName === "id";
          return Array.from(record2.removedNodes).some((node) => node === this.root || node === this.ownList || containsChatAnchor(node)) || Array.from(record2.addedNodes).some(containsChatAnchor);
        });
        if (relevant) {
          this.invalidateVerification();
          this.syncNow();
        }
      });
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id"],
        attributeOldValue: true
      });
      lifecycle.add(() => this.mutationObserver.disconnect());
      this.nativeEventStackMutationObserver = new MutationObserver(() => {
        this.invalidateVerification();
        this.syncNow(false);
      });
      lifecycle.add(() => this.nativeEventStackMutationObserver.disconnect());
      lifecycle.addEventListener(window, "resize", sync);
      let scrollFrame = null;
      lifecycle.addEventListener(window, "scroll", (event) => {
        if (event.target instanceof Node && (this.root.contains(event.target) || this.observedAnchor?.contains(event.target))) return;
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(() => {
          scrollFrame = null;
          sync();
        });
      }, true);
      lifecycle.add(() => {
        if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
      });
      visibleInterval(lifecycle, sync, SYNC_INTERVAL_MS);
      lifecycle.add(() => {
        this.disposed = true;
        document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
        this.observedAnchor?.removeAttribute("data-kickflow-main-chat");
        root.remove();
      });
      this.syncNow();
    }
    get state() {
      return this.takeoverState;
    }
    get selectedAnchor() {
      return this.observedAnchor;
    }
    get hasVisibleOwnContent() {
      return this.contentReady;
    }
    setProbing() {
      if (this.disposed || this.takeoverState === "active") return;
      this.takeoverState = "probing";
      document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
      this.syncNow();
    }
    /** RenderQueue uses this immediately before a flush. A detached root/list is repaired first;
     * returning null prevents any off-document append from being mistaken for visible content. */
    getRenderContainer() {
      if (this.disposed) return null;
      this.hotPathDepth++;
      try {
        if (!this.verifiedRecently()) this.syncNow();
      } finally {
        this.hotPathDepth--;
      }
      return this.root.isConnected && this.ownList.isConnected && this.ownList.parentElement === this.root && this.availableOwnListRect !== null ? this.ownList : null;
    }
    noteContentAppended(appended) {
      if (this.disposed || appended.length === 0) return;
      if (this.verifiedRecently() && this.contentReady && this.statusElement === null) {
        if (this.root.isConnected && this.ownList.isConnected && this.ownList.parentElement === this.root && appended.some((row) => row.isConnected && row.parentElement === this.ownList)) return;
      }
      this.hotPathDepth++;
      try {
        this.noteContentAppendedFull(appended);
      } finally {
        this.hotPathDepth--;
      }
    }
    noteContentAppendedFull(appended) {
      const connectedFlush = this.root.isConnected && this.ownList.isConnected && this.ownList.parentElement === this.root && appended.some((row) => row.isConnected && row.parentElement === this.ownList && isCssVisible(row));
      if (!connectedFlush) {
        this.failOpen("off-document-render");
        this.syncNow();
        return;
      }
      this.contentReady = true;
      if (!this.sourceUnavailable && this.statusElement?.dataset.kickflowChatStatus !== "reconnecting") this.setStatus(null);
      this.takeoverState = "ready";
      this.transitionToActive();
    }
    setPrimaryReady() {
      if (this.disposed) return;
      this.sourceUnavailable = false;
      this.primaryReady = true;
      if (!this.contentReady) this.setStatus("connected", t("overlay.connected"));
      else this.setStatus(null);
      this.takeoverState = "ready";
      this.transitionToActive();
    }
    /** VOD replay has no primary Pusher subscription. A visible status is nevertheless a complete
     * readiness proof, so own chat can stay active while a seek clears the old rows and loads the
     * new timestamp instead of briefly exposing native chat underneath. */
    setReplayLoading() {
      this.setReplaySourceReady(t("overlay.replay_loading"));
    }
    /** A successful replay response—including a legitimate empty window—keeps the selected own
     * view active. The status disappears as soon as RenderQueue appends a visible row. */
    setReplayReady() {
      this.setReplaySourceReady(t("overlay.replay_ready"));
    }
    /** Existing rows stay mounted during a short reconnect grace. Bootstrap owns the grace timer;
     * this method only supplies the explicit visible state required by the invariant. */
    setReconnecting() {
      if (this.disposed || this.takeoverState !== "active") return;
      this.primaryReady = false;
      this.setStatus("reconnecting", t("overlay.reconnecting"));
      this.syncNow();
    }
    setPrimaryUnavailable(reason) {
      if (this.disposed) return;
      this.sourceUnavailable = true;
      this.primaryReady = false;
      this.failOpen(reason);
    }
    initialNoContentDeadline() {
      if (!this.contentReady && !this.primaryReady) this.failOpen("initial-no-content-deadline");
    }
    failOpen(_reason) {
      if (this.disposed) return;
      document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
      this.takeoverState = "fallback";
      this.updatePresentation();
    }
    /** Public for the direct invariant regression and diagnostics. A false result always restores
     * native chat before returning. When the class is absent, the implication holds trivially. */
    assertActiveInvariant() {
      if (!document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
        return this.takeoverState !== "active";
      }
      if (this.hotPathDepth > 0 && this.verifiedRecently()) return true;
      const roots = Array.from(document.querySelectorAll(`[id="${OVERLAY_ROOT_ID}"]`));
      const hasVisibleContent = this.hasVisibleOwnRow() || this.hasVisibleStatus();
      const geometry = this.observedAnchor ? resolveNativeEventStackGeometry(this.observedAnchor) : null;
      const hasPositiveAvailableRect = geometry !== null && geometry.status !== "invalid" && geometry.ownRect.height > 0 && rectsMatch(this.availableOwnListRect, geometry.ownRect) && inlineGeometryMatches(this.root, geometry.ownRect);
      const suspended = this.isNativeChatTemporarilyHidden();
      let coveredByModal = null;
      const covered = () => coveredByModal ??= this.isCoveredByPageModal();
      const valid = roots.length === 1 && roots[0] === this.root && this.root.isConnected && (suspended || isCssVisible(this.root)) && this.ownList.isConnected && this.ownList.parentElement === this.root && this.observedAnchor !== null && (suspended || this.isUsableAnchor(this.observedAnchor)) && (suspended || hasPositiveAvailableRect) && hasVisibleContent && (suspended || this.isPaintedOnTop() || covered()) && (!this.hasOverlappingNativeControls() || covered());
      if (!valid) this.failOpen("active-invariant-broken");
      else this.lastVerifiedAt = performance.now();
      return valid;
    }
    invalidateVerification() {
      this.lastVerifiedAt = -Infinity;
    }
    /** True only while own chat is active, was fully verified within HOT_PATH_FRESH_MS and nothing
     * structural has been signalled since. */
    verifiedRecently() {
      return this.takeoverState === "active" && document.documentElement.classList.contains(CHAT_ACTIVE_CLASS) && performance.now() - this.lastVerifiedAt < HOT_PATH_FRESH_MS;
    }
    syncNow(allowRecoveryActivation = true) {
      if (this.disposed) return;
      const mountWasBroken = !this.root.isConnected || !this.ownList.isConnected || this.ownList.parentElement !== this.root;
      if (mountWasBroken && document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
        this.failOpen("mount-lost");
      }
      this.repairStructure();
      if (this.takeoverState === "active" && this.isNativeChatTemporarilyHidden()) {
        this.root.style.display = "none";
        this.assertActiveInvariant();
        return;
      }
      const anchor = this.selectAnchor();
      this.updateObservedAnchor(anchor);
      if (!anchor) {
        this.availableOwnListRect = null;
        this.updateNativeEventStackObservers(null, null);
        if (this.takeoverState === "active" || document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
          this.failOpen("anchor-unavailable");
        }
        this.root.style.visibility = "hidden";
        this.updatePresentation();
        return;
      }
      if (!this.syncGeometry(anchor)) {
        this.root.style.visibility = "hidden";
        this.failOpen("native-event-stack-geometry-invalid");
        return;
      }
      this.refreshContentReadiness();
      if (allowRecoveryActivation && !this.sourceUnavailable && this.takeoverState === "fallback" && (this.contentReady || this.primaryReady)) {
        this.takeoverState = "ready";
        this.transitionToActive();
        return;
      }
      this.updatePresentation();
      if (document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) this.assertActiveInvariant();
    }
    transitionToActive() {
      if (this.disposed || this.takeoverState !== "ready") return;
      if (this.sourceUnavailable) {
        this.failOpen("source-unavailable");
        return;
      }
      this.repairStructure();
      this.refreshContentReadiness();
      if (this.isNativeChatTemporarilyHidden() && this.availableOwnListRect && (this.contentReady || this.primaryReady && this.hasVisibleStatus())) {
        this.takeoverState = "active";
        document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
        this.root.style.display = "none";
        this.assertActiveInvariant();
        return;
      }
      const anchor = this.selectAnchor();
      this.updateObservedAnchor(anchor);
      this.refreshContentReadiness();
      const hasReadiness = this.contentReady || this.primaryReady && this.hasVisibleStatus();
      if (!anchor || !hasReadiness) {
        this.failOpen(anchor ? "content-readiness-lost" : "anchor-unavailable");
        return;
      }
      if (!this.syncGeometry(anchor)) {
        this.failOpen("native-event-stack-geometry-invalid");
        return;
      }
      if (this.hasOverlappingNativeControls() && !this.isCoveredByPageModal()) {
        this.failOpen("native-control-overlap");
        return;
      }
      this.takeoverState = "active";
      this.updatePresentation();
      document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
      this.assertActiveInvariant();
    }
    setReplaySourceReady(statusText) {
      if (this.disposed) return;
      this.sourceUnavailable = false;
      this.primaryReady = true;
      this.refreshContentReadiness();
      if (!this.contentReady) this.setStatus("connected", statusText);
      else this.setStatus(null);
      this.takeoverState = "ready";
      this.transitionToActive();
    }
    repairStructure() {
      for (const duplicate of document.querySelectorAll(`[id="${OVERLAY_ROOT_ID}"]`)) {
        if (duplicate !== this.root) duplicate.remove();
      }
      if (!this.root.isConnected && document.body) document.body.append(this.root);
      if (this.ownList.parentElement !== this.root) this.root.prepend(this.ownList);
    }
    /** A body-level z-index loses to Kick's narrow-screen #channel-content context.
     * Keep the list in that context, below Kick's popup layers, and outside its React list. */
    syncStackingContext(anchor) {
      const host = anchor.closest("#channel-content") ?? document.body;
      if (this.root.parentElement !== host) host.append(this.root);
    }
    /** The first page layer over the centre of the own list, skipping our own card layers and the
     * native surfaces that may legitimately cover it. `undefined` means there is no paint engine
     * (jsdom); `null` means nothing was hit. */
    topForeignLayerAtListCentre() {
      if (typeof document.elementFromPoint !== "function") return void 0;
      const rect = this.availableOwnListRect;
      if (!rect) return null;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
      return stack.find((element) => element !== null && !element.closest(OWN_CHAT_SURFACE_SELECTOR) && !isRequestedNativeUserCardSurface(element) && !isPassiveNativeTooltipSurface(element) && !isKnownNativeChatSurface(element)) ?? null;
    }
    isPaintedOnTop() {
      if (typeof document.elementFromPoint !== "function") return true;
      if (!this.availableOwnListRect) return false;
      if (document.querySelector(".kickflow-avatar-preview:modal")) return true;
      const hit = this.topForeignLayerAtListCentre();
      return hit != null && this.root.contains(hit);
    }
    /** A page-level modal (Kick's drops/rewards dialog with its backdrop, a top-layer panel) is the
     * top layer over the list. Native chat would be just as covered, so own chat stays the chat; the
     * checks resume in full once the modal closes. Only a modal ON TOP of the list counts: a native
     * popup that our list paints over is still a reason to give chat back. */
    isCoveredByPageModal() {
      const hit = this.topForeignLayerAtListCentre();
      return hit != null && !this.root.contains(hit) && isPageModalLayer(hit);
    }
    hasOverlappingNativeControls() {
      const rect = this.availableOwnListRect;
      if (!rect) return false;
      return Array.from(document.querySelectorAll(
        '[role="menu"], [role="dialog"], dialog[open], [data-radix-popper-content-wrapper], [data-testid="emote-picker"]'
      )).some((control) => {
        if (this.root.contains(control) || control.closest(OWN_CHAT_SURFACE_SELECTOR) || isRequestedNativeUserCardSurface(control) || isPassiveNativeTooltipSurface(control) || isKnownNativeChatSurface(control) || control.closest('[hidden], [aria-hidden="true"]') || !isCssVisible(control)) return false;
        const box = control.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
      });
    }
    isNativeChatTemporarilyHidden() {
      if (!this.observedAnchor || this.isUsableAnchor(this.observedAnchor)) return false;
      const toggles = Array.from(document.querySelectorAll("div.z-controls.absolute.right-7.top-7")).filter((element) => element.querySelector("button") && !element.closest("#video-player"));
      return [...toggles, ...knownNativeChatSurfaces()].some((element) => {
        const box = element.getBoundingClientRect();
        return isCssVisible(element) && box.width > 0 && box.height > 0;
      });
    }
    updateObservedAnchor(anchor) {
      if (anchor === this.observedAnchor) return;
      if (this.observedAnchor) {
        this.resizeObserver.unobserve(this.observedAnchor);
        this.observedAnchor.removeAttribute("data-kickflow-main-chat");
      }
      if (anchor) {
        anchor.setAttribute("data-kickflow-main-chat", "");
        this.resizeObserver.observe(anchor);
      }
      this.observedAnchor = anchor;
    }
    updateNativeEventStackObservers(parent, eventStack) {
      if (parent === this.observedEventStackParent && eventStack === this.observedEventStack) return;
      if (this.observedEventStack) this.resizeObserver.unobserve(this.observedEventStack);
      this.nativeEventStackMutationObserver.disconnect();
      this.observedEventStackParent = parent;
      this.observedEventStack = eventStack;
      if (parent) this.nativeEventStackMutationObserver.observe(parent, { childList: true });
      if (eventStack) {
        this.resizeObserver.observe(eventStack);
        this.nativeEventStackMutationObserver.observe(eventStack, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"]
        });
      }
    }
    syncGeometry(anchor) {
      this.syncStackingContext(anchor);
      const geometry = resolveNativeEventStackGeometry(anchor);
      const eventStackObservationTarget = geometry.eventStack ?? findNativeEventStackObservationTarget(anchor);
      this.updateNativeEventStackObservers(anchor.parentElement, eventStackObservationTarget);
      if (geometry.status === "invalid" || geometry.ownRect.height <= 0) {
        this.availableOwnListRect = null;
        return false;
      }
      const rect = geometry.ownRect;
      this.availableOwnListRect = rect;
      const nativeStyle = getComputedStyle(anchor);
      for (const token of NATIVE_CHAT_PRESENTATION_TOKENS) {
        const value = nativeStyle.getPropertyValue(token).trim();
        if (value) this.root.style.setProperty(token, value);
        else this.root.style.removeProperty(token);
      }
      this.root.style.visibility = "visible";
      this.root.style.left = `${rect.left}px`;
      this.root.style.top = `${rect.top}px`;
      this.root.style.width = `${rect.width}px`;
      this.root.style.height = `${rect.height}px`;
      return true;
    }
    selectAnchor() {
      if (this.observedAnchor && this.isUsableAnchor(this.observedAnchor)) return this.observedAnchor;
      return Array.from(document.querySelectorAll('[id="chatroom-messages"]')).find((candidate) => this.isUsableAnchor(candidate)) ?? null;
    }
    isUsableAnchor(anchor) {
      if (!anchor.isConnected || anchor.id !== SELECTORS.chatMessagesContainer.slice(1) || !isCssVisible(anchor)) {
        return false;
      }
      if (isThreadPanelList(anchor)) return false;
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    hasVisibleStatus() {
      return this.statusElement !== null && this.statusElement.isConnected && this.statusElement.parentElement === this.root && isCssVisible(this.statusElement);
    }
    hasVisibleOwnRow() {
      return Array.from(this.ownList.querySelectorAll(".kickflow-message, .kickflow-event-row")).some((element) => element.isConnected && isCssVisible(element));
    }
    refreshContentReadiness() {
      if (this.contentReady && !this.hasVisibleOwnRow()) this.contentReady = false;
      if (!this.contentReady && this.primaryReady && !this.hasVisibleStatus()) {
        this.setStatus("connected", t("overlay.connected"));
      }
    }
    setRetryHandler(handler) {
      this.retryHandler = handler;
    }
    showFailure() {
      this.failOpen("startup-failed");
      this.setStatus("failed", t("overlay.failed"));
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = t("overlay.retry");
      retry.addEventListener("click", () => {
        this.setStatus(null);
        this.updatePresentation();
        this.retryHandler?.();
      }, { once: true });
      this.statusElement.append(" ", retry);
      this.updatePresentation();
    }
    setStatus(kind, text = "") {
      if (kind === null) {
        this.statusElement?.remove();
        this.statusElement = null;
        return;
      }
      if (!this.statusElement) {
        this.statusElement = document.createElement("div");
        this.statusElement.setAttribute(STATUS_ATTRIBUTE, kind);
        this.statusElement.setAttribute("role", "status");
        this.statusElement.style.padding = "10px 12px";
        this.statusElement.style.color = "rgba(255,255,255,0.68)";
        this.statusElement.style.fontSize = "12px";
        this.statusElement.style.flex = "0 0 auto";
        this.statusElement.style.marginTop = "auto";
        this.statusElement.style.pointerEvents = "auto";
        this.root.append(this.statusElement);
      }
      this.statusElement.setAttribute(STATUS_ATTRIBUTE, kind);
      this.statusElement.textContent = text;
    }
    updatePresentation() {
      const active = this.takeoverState === "active";
      this.ownList.style.display = active ? "" : "none";
      const failed = this.statusElement?.dataset.kickflowChatStatus === "failed" && !this.hasOverlappingNativeControls();
      this.root.style.display = active || failed ? "" : "none";
      this.root.style.pointerEvents = active ? "auto" : "none";
    }
  };

  // src/content/chat/message-jump.ts
  var MISS_CLASS = "kickflow-message__reply-context--miss";
  function playMissCue(missCueElement) {
    missCueElement.classList.remove(MISS_CLASS);
    void missCueElement.offsetWidth;
    missCueElement.classList.add(MISS_CLASS);
    window.setTimeout(() => missCueElement.classList.remove(MISS_CLASS), 500);
  }
  function jumpToMessage(messageId, missCueElement) {
    const ownList = document.getElementById(OWN_LIST_ID);
    const target = ownList ? Array.from(ownList.querySelectorAll("[data-message-id]")).find((element) => element.dataset.messageId === messageId) : void 0;
    if (!target) {
      playMissCue(missCueElement);
      return false;
    }
    ownList?.dispatchEvent(new Event(READER_SCROLL_EVENT));
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("kickflow-message--jump-highlight");
    window.setTimeout(() => target.classList.remove("kickflow-message--jump-highlight"), 1800);
    return true;
  }

  // src/content/chat/user-message-list.ts
  var USER_MESSAGE_TIME_COLUMN_PX = 38;
  function buildUserMessageList(model) {
    const root = document.createElement("div");
    root.className = "kickflow-user-messages";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "kickflow-user-messages__toggle";
    toggle.setAttribute("aria-expanded", "true");
    const title = document.createElement("span");
    title.className = "kickflow-user-messages__title";
    title.textContent = t("user.messages");
    const count = document.createElement("span");
    count.className = "kickflow-user-messages__count";
    count.textContent = String(model.messages.length);
    toggle.append(title, count);
    let collapsed = false;
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      root.classList.toggle("kickflow-user-messages--collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });
    root.appendChild(toggle);
    if (model.messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "kickflow-user-messages__empty";
      empty.textContent = t("user.messages_empty");
      root.appendChild(empty);
    } else {
      const body = document.createElement("div");
      body.className = "kickflow-user-messages__body";
      let previousLabel = "";
      for (const message2 of model.messages) {
        const label = formatClock(message2.at);
        body.appendChild(buildArchivedMessageRow(message2, {
          clockLabel: label === previousLabel ? "" : label
        }));
        previousLabel = label;
      }
      root.appendChild(body);
    }
    if (model.truncated) {
      const note2 = document.createElement("div");
      note2.className = "kickflow-user-messages__note";
      note2.textContent = t("user.messages_truncated");
      root.appendChild(note2);
    }
    return root;
  }
  function scrollUserMessageListToLatest(mountedCard) {
    const body = mountedCard.querySelector(".kickflow-user-messages__body");
    if (body) body.scrollTop = body.scrollHeight;
  }
  function formatClock(at) {
    const date = new Date(at);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  function buildArchivedMessageRow(message2, options) {
    const row = document.createElement("div");
    row.className = "kickflow-user-messages__row";
    row.dataset.messageId = message2.id;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.title = t("user.messages_jump");
    if (message2.deleted) row.classList.add("kickflow-user-messages__row--deleted");
    if (message2.replyTo) row.appendChild(buildReplyContext(message2.replyTo));
    const line = document.createElement("div");
    line.className = "kickflow-user-messages__line";
    const time = document.createElement("span");
    time.className = "kickflow-user-messages__time";
    time.textContent = options.clockLabel;
    const text = document.createElement("span");
    text.className = "kickflow-user-messages__text";
    if (options.showUsername) {
      const name = document.createElement("span");
      name.className = "kickflow-user-messages__name";
      name.textContent = `${message2.username}: `;
      text.appendChild(name);
    }
    appendParsedContent(text, message2.text, { compact: true });
    line.append(time, text);
    row.appendChild(line);
    row.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      jumpToRow(row);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      jumpToRow(row);
    });
    return row;
  }
  function buildReplyContext(replyTo) {
    const quote = document.createElement("div");
    quote.className = "kickflow-user-messages__reply";
    const icon = document.createElement("span");
    icon.className = "kickflow-user-messages__replyIcon";
    icon.textContent = "\u21A9";
    icon.setAttribute("aria-hidden", "true");
    const user = document.createElement("span");
    user.className = "kickflow-user-messages__replyUser";
    user.textContent = replyTo.user;
    const text = document.createElement("span");
    text.className = "kickflow-user-messages__replyText";
    appendParsedContent(text, replyTo.text, { compact: true });
    quote.append(icon, user, text);
    return quote;
  }
  function jumpToRow(row) {
    const messageId = row.dataset.messageId;
    if (messageId) jumpToMessage(messageId, row);
  }

  // src/content/shared/draggable.ts
  function makeDraggable(element, handle, ignoreSelector) {
    let stopActiveDrag = null;
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      if (ignoreSelector && event.target.closest(ignoreSelector)) return;
      stopActiveDrag?.();
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const move = (moveEvent) => {
        const x = Math.max(4, Math.min(moveEvent.clientX - offsetX, window.innerWidth - element.offsetWidth - 4));
        const y = Math.max(4, Math.min(moveEvent.clientY - offsetY, window.innerHeight - element.offsetHeight - 4));
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      };
      const stop = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", stop);
        element.removeEventListener("kickflow:dismiss", stop);
        if (stopActiveDrag === stop) stopActiveDrag = null;
      };
      stopActiveDrag = stop;
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", stop);
      element.addEventListener("kickflow:dismiss", stop);
    };
    handle.addEventListener("mousedown", onMouseDown);
    return () => {
      stopActiveDrag?.();
      handle.removeEventListener("mousedown", onMouseDown);
    };
  }

  // src/content/shared/new-tab.ts
  function openInNewTab(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }

  // src/content/chat/user-card.ts
  var SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
  var TRUSTED_IMAGE_HOST = "kick.com";
  var TRUSTED_IMAGE_HOST_SUFFIX = ".kick.com";
  var CARD_CLASS = "kickflow-user-card";
  var FIELD_CLASS = "kickflow-user-card__field";
  var DEFAULT_PROFILE_PIC = "https://kick.com/img/default-profile-pictures/default-avatar-2.webp";
  var channelSlug = null;
  var cache = /* @__PURE__ */ new Map();
  var activeCard = null;
  var activeOpener = null;
  function configureUserCardSession(slug) {
    channelSlug = slug && SAFE_SLUG_RE.test(slug) ? slug : null;
    cache.clear();
    resetNativeUserCardRequest();
    dismissUserCard();
  }
  function isSafeKickSlug(slug) {
    return SAFE_SLUG_RE.test(slug);
  }
  function trustedProfileImageUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    if (url.hostname !== TRUSTED_IMAGE_HOST && !url.hostname.endsWith(TRUSTED_IMAGE_HOST_SUFFIX)) return null;
    return url;
  }
  function normalizeBadge(raw) {
    const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : null;
    return {
      type: typeof raw.type === "string" ? raw.type : void 0,
      name: typeof raw.name === "string" ? raw.name : void 0,
      text: typeof raw.text === "string" ? raw.text : void 0,
      count: typeof raw.count === "number" ? raw.count : void 0,
      imageUrl: typeof raw.image_url === "string" ? raw.image_url : typeof raw.imageUrl === "string" ? raw.imageUrl : void 0,
      level: metadata && typeof metadata.level === "number" ? metadata.level : void 0,
      active: typeof raw.active === "boolean" ? raw.active : void 0,
      selected: typeof raw.selected === "boolean" ? raw.selected : void 0,
      sortOrder: typeof raw.sort_order === "number" ? raw.sort_order : void 0
    };
  }
  function normalizeBadges(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((badge2) => Boolean(badge2) && typeof badge2 === "object").map(normalizeBadge);
  }
  function formatDate(value) {
    if (typeof value !== "string" || value.trim() === "") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(getLang() === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }
  function formatFollowers(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    return formatNumber(value);
  }
  function roleFrom(raw) {
    if (raw.is_channel_owner === true) return "owner";
    if (raw.is_staff === true) return "staff";
    if (raw.is_moderator === true) return "mod";
    return null;
  }
  function readChannel(raw) {
    const user = raw && typeof raw.user === "object" && raw.user ? raw.user : null;
    const profilePic = user && typeof user.profile_pic === "string" && user.profile_pic ? user.profile_pic : null;
    const bio = user && typeof user.bio === "string" && user.bio.trim() ? user.bio.trim() : null;
    return { profilePic, bio };
  }
  function mapUserCardResponse(card, channel, fallbackName, fallbackSlug) {
    const slug = typeof card.slug === "string" && SAFE_SLUG_RE.test(card.slug) ? card.slug : fallbackSlug;
    const username = typeof card.username === "string" && card.username ? card.username : fallbackName;
    const subscribedFor = typeof card.subscribed_for === "number" && Number.isFinite(card.subscribed_for) && card.subscribed_for >= 0 ? card.subscribed_for > 0 ? t("user.subscribed_months", { n: card.subscribed_for }) : t("user.not_subscribed") : t("user.unknown");
    const badges = mergeIdentityBadges({
      // Native cards retain historical subscriber badges, including active:false.
      // Native chat intentionally hides these; keep this exception local to cards.
      badges: normalizeBadges(card.badges).map((badge2) => badge2.type === "subscriber" ? { ...badge2, active: true } : badge2),
      badgesV2: normalizeBadges(card.badges_v2)
    });
    const { profilePic: channelPic, bio } = readChannel(channel);
    const cardPic = typeof card.profile_pic === "string" && card.profile_pic ? card.profile_pic : null;
    return {
      userId: typeof card.id === "number" && Number.isSafeInteger(card.id) && card.id > 0 ? card.id : null,
      messages: null,
      username,
      nativeUsername: typeof card.username === "string" && SAFE_SLUG_RE.test(card.username) ? card.username : void 0,
      slug,
      profilePic: cardPic ?? channelPic,
      role: roleFrom(card),
      verified: Boolean(channel?.verified),
      bio,
      followers: formatFollowers(channel?.followers_count),
      createdAt: formatDate(card.created_at) ?? "-",
      followingSince: formatDate(card.following_since) ?? (card.following_since === null ? t("user.not_following") : t("user.unknown")),
      subscribedFor,
      badges
    };
  }
  async function fetchUserCard(username, fallbackName, nativeUsername) {
    if (!channelSlug || !SAFE_SLUG_RE.test(username)) return null;
    const cacheKey = `${username}:${nativeUsername.toLowerCase()}`;
    const cached2 = cache.get(cacheKey);
    if (cached2) return cached2;
    const getJson = async (url) => {
      const controller2 = new AbortController();
      const timeout = window.setTimeout(() => controller2.abort(), 8e3);
      try {
        const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller2.signal });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const promise = Promise.all([
      // Kick's relationship endpoint accepts the username, while the profile URL
      // accepts the canonical slug. They can differ (Verssa_99 / verssa-99).
      getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}/users/${encodeURIComponent(
        nativeUsername
      )}`),
      getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(username)}`)
    ]).then(([cardRaw, channelRaw]) => {
      const relationship = cardRaw;
      const complete = relationship && channelRaw && (relationship.following_since === null || formatDate(relationship.following_since) !== null) && typeof relationship.subscribed_for === "number" && Number.isFinite(relationship.subscribed_for) && relationship.subscribed_for >= 0;
      if (!complete && cache.get(cacheKey) === promise) cache.delete(cacheKey);
      if (!cardRaw && !channelRaw) return null;
      return mapUserCardResponse(
        cardRaw ?? {},
        channelRaw ?? {},
        fallbackName,
        username
      );
    });
    cache.set(cacheKey, promise);
    return promise;
  }
  function appendField(parent, label, value) {
    const cell = document.createElement("div");
    cell.className = FIELD_CLASS;
    const key = document.createElement("span");
    key.className = "kickflow-user-card__key";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = "kickflow-user-card__value";
    val.textContent = value;
    val.title = value;
    cell.append(key, val);
    parent.appendChild(cell);
  }
  function buildFieldGrid() {
    const grid = document.createElement("div");
    grid.className = "kickflow-user-card__facts";
    return grid;
  }
  function buildUserCardElement(model) {
    const card = document.createElement("section");
    card.className = CARD_CLASS;
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", model.username);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kickflow-user-card__close";
    close.textContent = "\xD7";
    close.setAttribute("aria-label", t("user.close"));
    close.addEventListener("click", () => dismissUserCard());
    card.appendChild(close);
    const header = document.createElement("div");
    header.className = "kickflow-user-card__header";
    const profilePic = model.profilePic ? trustedProfileImageUrl(model.profilePic) : null;
    const img = document.createElement("img");
    img.className = "kickflow-user-card__avatar";
    img.src = profilePic?.href ?? DEFAULT_PROFILE_PIC;
    img.alt = "";
    img.loading = "lazy";
    const realImage = profilePic && !profilePic.pathname.startsWith("/img/default-profile-pictures/") && fullSizeAvatarUrl(profilePic.href) !== null;
    const avatar = realImage ? createAvatarPreviewAction(img, model.username) : img;
    if (profilePic && profilePic.href !== DEFAULT_PROFILE_PIC) {
      img.addEventListener("error", () => {
        if (avatar !== img) avatar.replaceWith(img);
        img.src = DEFAULT_PROFILE_PIC;
      }, { once: true });
    }
    header.appendChild(avatar);
    const title = document.createElement("div");
    title.className = "kickflow-user-card__title";
    const nameRow = document.createElement("div");
    nameRow.className = "kickflow-user-card__nameRow";
    const name = document.createElement("strong");
    name.className = "kickflow-user-card__name";
    name.textContent = model.username;
    if (SAFE_SLUG_RE.test(model.slug)) {
      name.setAttribute("role", "link");
      name.tabIndex = 0;
      name.title = t("user.open_middle", { slug: model.slug });
      name.dataset.kickflowProfileUrl = `https://kick.com/${model.slug}`;
      const openProfile = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openInNewTab(name.dataset.kickflowProfileUrl);
      };
      name.addEventListener("auxclick", (event) => {
        if (event.button === 1) openProfile(event);
      });
      name.addEventListener("click", (event) => {
        if (event.button === 0) openProfile(event);
      });
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openProfile(event);
      });
      name.addEventListener("mousedown", (event) => {
        if (event.button === 1) event.preventDefault();
      });
    }
    nameRow.appendChild(name);
    if (model.verified) {
      const verified = document.createElement("span");
      verified.className = "kickflow-user-card__verified";
      verified.textContent = "\u2714";
      verified.title = t("user.verified");
      nameRow.appendChild(verified);
    }
    title.appendChild(nameRow);
    if (model.role) {
      const role = document.createElement("span");
      role.className = "kickflow-user-card__role";
      role.textContent = model.role;
      title.appendChild(role);
    }
    header.appendChild(title);
    card.appendChild(header);
    makeDraggable(card, header, "button, a, .kickflow-user-card__name");
    const bio = document.createElement("div");
    bio.className = "kickflow-user-card__bio";
    bio.textContent = model.bio ?? "";
    card.appendChild(bio);
    const facts = buildFieldGrid();
    appendField(facts, t("user.followers"), model.followers ?? t("user.unknown"));
    appendField(facts, t("user.created"), model.createdAt);
    appendField(facts, t("user.following"), model.followingSince);
    appendField(facts, t("user.subscription"), model.subscribedFor);
    card.appendChild(facts);
    const badges = document.createElement("div");
    badges.className = "kickflow-user-card__badges";
    appendBadges(badges, model.badges);
    card.appendChild(badges);
    const actions = document.createElement("div");
    actions.className = "kickflow-user-card__actions";
    const follow = document.createElement("a");
    follow.className = "kickflow-user-card__action";
    follow.dataset.kickflowCardAction = "follow";
    follow.href = `https://kick.com/${model.slug}`;
    follow.target = "_blank";
    follow.rel = "noopener noreferrer";
    follow.textContent = t("user.follow_on_kick");
    follow.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openInNewTab(follow.href);
    });
    const native = document.createElement("button");
    native.type = "button";
    native.className = "kickflow-user-card__action";
    native.dataset.kickflowCardAction = "native";
    native.dataset.kickflowNativeUsername = model.nativeUsername ?? model.slug;
    native.dataset.kickflowNativeProfileSlug = model.slug;
    native.textContent = t("user.kick_controls");
    native.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openNativeUserCard(native.dataset.kickflowNativeUsername, native.dataset.kickflowNativeProfileSlug)) dismissUserCard();
      else openInNewTab(follow.href);
    });
    actions.append(follow, native);
    card.appendChild(actions);
    if (featureFlags.showUserMessages && model.messages) {
      card.appendChild(buildUserMessageList(model.messages));
    }
    const link = document.createElement("a");
    link.className = "kickflow-user-card__link";
    link.href = `https://kick.com/${model.slug}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `kick.com/${model.slug} \u2192 ${t("user.open")}`;
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openInNewTab(link.href);
    });
    card.appendChild(link);
    return card;
  }
  function buildMinimalCard(displayName, slug, messages2, nativeUsername) {
    const card = buildUserCardElement({
      userId: null,
      messages: messages2,
      username: displayName,
      nativeUsername,
      slug: SAFE_SLUG_RE.test(slug) ? slug : displayName,
      profilePic: null,
      role: null,
      verified: false,
      bio: null,
      followers: null,
      createdAt: "-",
      followingSince: t("user.unknown"),
      subscribedFor: t("user.unknown"),
      badges: []
    });
    return card;
  }
  var CARD_VIEWPORT_MARGIN_PX = 8;
  var CARD_ANCHOR_GAP_PX = 8;
  var CARD_MAX_HEIGHT_INSET_PX = CARD_VIEWPORT_MARGIN_PX * 2;
  function resolveCardPlacement(input) {
    const m = CARD_VIEWPORT_MARGIN_PX;
    const gap = CARD_ANCHOR_GAP_PX;
    const maxLeft = Math.max(m, input.viewportWidth - input.cardWidth - m);
    const left = Math.min(Math.max(input.anchorX + gap, m), maxLeft);
    const below = input.anchorY + gap;
    const above = input.anchorY - gap - input.cardHeight;
    let top;
    if (below + input.cardHeight + m <= input.viewportHeight) {
      top = below;
    } else if (above >= m) {
      top = above;
    } else {
      top = Math.max(m, input.viewportHeight - input.cardHeight - m);
    }
    return { left, top };
  }
  function positionCard(card, x, y) {
    const { left, top } = resolveCardPlacement({
      anchorX: x,
      anchorY: y,
      cardWidth: card.offsetWidth,
      cardHeight: card.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
  function installDismissHandlers(card) {
    const key = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismissUserCard();
    };
    document.addEventListener("keydown", key);
    const clamp3 = () => clampCardToViewport(card);
    window.addEventListener("resize", clamp3);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(clamp3) : null;
    observer?.observe(card);
    card.addEventListener("kickflow:dismiss", () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", clamp3);
      observer?.disconnect();
    }, { once: true });
  }
  function clampCardToViewport(card) {
    const rect = card.getBoundingClientRect();
    const margin = CARD_VIEWPORT_MARGIN_PX;
    const left = parseFloat(card.style.left) || rect.left;
    const top = parseFloat(card.style.top) || rect.top;
    card.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
    const nextTop = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
    card.style.top = `${nextTop}px`;
    card.style.maxHeight = `${Math.max(0, window.innerHeight - nextTop - margin)}px`;
  }
  function dismissUserCard() {
    if (!activeCard) return;
    const restoreFocus = activeCard.contains(document.activeElement) && activeOpener?.isConnected;
    dismissAvatarPreview();
    activeCard.dispatchEvent(new Event("kickflow:dismiss"));
    activeCard.remove();
    activeCard = null;
    if (restoreFocus) activeOpener?.focus({ preventScroll: true });
    activeOpener = null;
  }
  function isUsableUserId(userId) {
    return typeof userId === "number" && Number.isInteger(userId) && userId > 0;
  }
  function getUserMessageListModel(userId, names) {
    const userMessageArchive = getUserMessageArchive();
    if (!featureFlags.showUserMessages || !userMessageArchive) {
      return null;
    }
    let resolvedUserId = isUsableUserId(userId) ? userId : null;
    if (resolvedUserId === null) {
      for (const name of names) {
        const archivedUserId = userMessageArchive.getUserIdByName(name);
        if (isUsableUserId(archivedUserId)) {
          resolvedUserId = archivedUserId;
          break;
        }
      }
    }
    if (resolvedUserId === null) return null;
    return {
      messages: userMessageArchive.getByUserId(resolvedUserId),
      truncated: userMessageArchive.truncated
    };
  }
  async function openUserCard(username, displayName, clientX, clientY, userId, nativeUsername) {
    const opener = activeCard?.contains(document.activeElement) ? activeOpener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dismissUserCard();
    const messages2 = getUserMessageListModel(userId, [username, displayName]);
    const lookupName = nativeUsername && SAFE_SLUG_RE.test(nativeUsername) ? nativeUsername : username;
    const loading = buildMinimalCard(displayName, username, messages2, lookupName);
    loading.setAttribute("aria-busy", "true");
    document.body.appendChild(loading);
    positionCard(loading, clientX, clientY);
    installDismissHandlers(loading);
    scrollUserMessageListToLatest(loading);
    activeCard = loading;
    activeOpener = opener;
    loading.focus({ preventScroll: true });
    const model = await fetchUserCard(username, displayName, lookupName);
    if (activeCard !== loading) return;
    loading.setAttribute("aria-busy", "false");
    if (!model) return;
    const next = buildUserCardElement({ ...model, userId, messages: messages2 });
    loading.setAttribute("aria-label", model.username);
    const header = loading.querySelector(".kickflow-user-card__header");
    const name = header.querySelector(".kickflow-user-card__name");
    name.textContent = model.username;
    name.dataset.kickflowProfileUrl = `https://kick.com/${model.slug}`;
    name.title = t("user.open_middle", { slug: model.slug });
    const profileLink = loading.querySelector(".kickflow-user-card__link");
    if (profileLink) {
      profileLink.href = `https://kick.com/${model.slug}`;
      profileLink.textContent = `kick.com/${model.slug} \u2192 ${t("user.open")}`;
    }
    const avatar = next.querySelector(".kickflow-avatar-action, .kickflow-user-card__avatar");
    if (avatar) header.querySelector(".kickflow-avatar-action, .kickflow-user-card__avatar")?.replaceWith(avatar);
    const verified = next.querySelector(".kickflow-user-card__verified");
    if (verified) name.parentElement?.append(verified);
    const role = next.querySelector(".kickflow-user-card__role");
    if (role) header.querySelector(".kickflow-user-card__title")?.append(role);
    const oldFacts = loading.querySelector(".kickflow-user-card__facts");
    const bio = next.querySelector(".kickflow-user-card__bio");
    if (bio) loading.querySelector(".kickflow-user-card__bio")?.replaceWith(bio);
    oldFacts.replaceWith(next.querySelector(".kickflow-user-card__facts"));
    const badges = next.querySelector(".kickflow-user-card__badges");
    if (badges) loading.querySelector(".kickflow-user-card__badges")?.replaceWith(badges);
    const nativeAction = loading.querySelector('[data-kickflow-card-action="native"]');
    if (nativeAction) {
      nativeAction.dataset.kickflowNativeUsername = model.nativeUsername ?? lookupName;
      nativeAction.dataset.kickflowNativeProfileSlug = model.slug;
    }
    const followAction = loading.querySelector('[data-kickflow-card-action="follow"]');
    if (followAction) followAction.href = `https://kick.com/${model.slug}`;
    const top = parseFloat(loading.style.top) || CARD_VIEWPORT_MARGIN_PX;
    loading.style.maxHeight = `${Math.max(0, window.innerHeight - top - CARD_VIEWPORT_MARGIN_PX)}px`;
  }

  // src/content/chat/badge-assets.ts
  var ROLE_BADGE_ASSETS = {
    moderator: {
      label: "Moderator",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzgxN181MDY2NykiPjxwYXRoIGQ9Ik0zMCAwQzMxLjEwNDYgMCAzMiAwLjg5NTQzMSAzMiAyVjMwQzMyIDMxLjEwNDYgMzEuMTA0NiAzMiAzMCAzMkgyQzAuODk1NDMxIDMyIDAgMzEuMTA0NiAwIDMwVjJDMCAwLjg5NTQzMSAwLjg5NTQzMSAwIDIgMEgzMFpNMTYuMjE5NyAyLjk5MzE2QzE1LjgyOTIgMi42MDI2NiAxNS4xOTYyIDIuNjAyNjUgMTQuODA1NyAyLjk5MzE2TDguMzYzMjggOS40MzU1NUM3Ljk3Mjk0IDkuODI2MDggNy45NzI4NCAxMC40NTkxIDguMzYzMjggMTAuODQ5NkwxMC4wOTE4IDEyLjU3ODFDMTAuNDgyMyAxMi45Njg2IDExLjExNTMgMTIuOTY4NSAxMS41MDU5IDEyLjU3ODFMMTEuNTg1IDEyLjQ5OUwxMy45NDE0IDE0Ljg1NjRMMy41NzEyOSAyNS4yMjc1QzIuNzAzNTcgMjYuMDk1NCAyLjcwMzUgMjcuNTAyMyAzLjU3MTI5IDI4LjM3MDFDNC40MzkxMSAyOS4yMzc2IDUuODQ2MTIgMjkuMjM3NyA2LjcxMzg3IDI4LjM3MDFMMTcuMDg0IDE3Ljk5OUwxOS40NDE0IDIwLjM1NjRMMTkuMzYzMyAyMC40MzQ2QzE4Ljk3MjggMjAuODI1MSAxOC45NzI4IDIxLjQ1ODEgMTkuMzYzMyAyMS44NDg2TDIxLjA5MTggMjMuNTc3MUMyMS40ODIzIDIzLjk2NzYgMjIuMTE1NCAyMy45Njc2IDIyLjUwNTkgMjMuNTc3MUwyOC45NDgyIDE3LjEzNDhDMjkuMzM4NiAxNi43NDQzIDI5LjMzODYgMTYuMTExMiAyOC45NDgyIDE1LjcyMDdMMjcuMjE5NyAxMy45OTIyQzI2LjgyOTMgMTMuNjAxNyAyNi4xOTYyIDEzLjYwMTggMjUuODA1NyAxMy45OTIyTDI1LjcyNjYgMTQuMDcwM0wyMy4zNzAxIDExLjcxMzlDMjQuMjM3NyAxMC44NDYxIDI0LjIzNzYgOS40MzkxIDIzLjM3MDEgOC41NzEyOUMyMi41MDIzIDcuNzAzNSAyMS4wOTU0IDcuNzAzNTcgMjAuMjI3NSA4LjU3MTI5TDE3Ljg3MDEgNi4yMTM4N0wxNy45NDgyIDYuMTM1NzRDMTguMzM4OCA1Ljc0NTIyIDE4LjMzODggNS4xMTIyMSAxNy45NDgyIDQuNzIxNjhMMTYuMjE5NyAyLjk5MzE2WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzgxN181MDY2NykiPjwvcGF0aD48cGF0aCBkPSJNMzAgMEMzMS4xMDQ2IDAgMzIgMC44OTU0MzEgMzIgMlYzMEMzMiAzMS4xMDQ2IDMxLjEwNDYgMzIgMzAgMzJIMkMwLjg5NTQzMSAzMiAwIDMxLjEwNDYgMCAzMFYyQzAgMC44OTU0MzEgMC44OTU0MzEgMCAyIDBIMzBaTTE2LjIxOTcgMi45OTMxNkMxNS44MjkyIDIuNjAyNjYgMTUuMTk2MiAyLjYwMjY1IDE0LjgwNTcgMi45OTMxNkw4LjM2MzI4IDkuNDM1NTVDNy45NzI5NCA5LjgyNjA4IDcuOTcyODQgMTAuNDU5MSA4LjM2MzI4IDEwLjg0OTZMMTAuMDkxOCAxMi41NzgxQzEwLjQ4MjMgMTIuOTY4NiAxMS4xMTUzIDEyLjk2ODUgMTEuNTA1OSAxMi41NzgxTDExLjU4NSAxMi40OTlMMTMuOTQxNCAxNC44NTY0TDMuNTcxMjkgMjUuMjI3NUMyLjcwMzU3IDI2LjA5NTQgMi43MDM1IDI3LjUwMjMgMy41NzEyOSAyOC4zNzAxQzQuNDM5MTEgMjkuMjM3NiA1Ljg0NjEyIDI5LjIzNzcgNi43MTM4NyAyOC4zNzAxTDE3LjA4NCAxNy45OTlMMTkuNDQxNCAyMC4zNTY0TDE5LjM2MzMgMjAuNDM0NkMxOC45NzI4IDIwLjgyNTEgMTguOTcyOCAyMS40NTgxIDE5LjM2MzMgMjEuODQ4NkwyMS4wOTE4IDIzLjU3NzFDMjEuNDgyMyAyMy45Njc2IDIyLjExNTQgMjMuOTY3NiAyMi41MDU5IDIzLjU3NzFMMjguOTQ4MiAxNy4xMzQ4QzI5LjMzODYgMTYuNzQ0MyAyOS4zMzg2IDE2LjExMTIgMjguOTQ4MiAxNS43MjA3TDI3LjIxOTcgMTMuOTkyMkMyNi44MjkzIDEzLjYwMTcgMjYuMTk2MiAxMy42MDE4IDI1LjgwNTcgMTMuOTkyMkwyNS43MjY2IDE0LjA3MDNMMjMuMzcwMSAxMS43MTM5QzI0LjIzNzcgMTAuODQ2MSAyNC4yMzc2IDkuNDM5MSAyMy4zNzAxIDguNTcxMjlDMjIuNTAyMyA3LjcwMzUgMjEuMDk1NCA3LjcwMzU3IDIwLjIyNzUgOC41NzEyOUwxNy44NzAxIDYuMjEzODdMMTcuOTQ4MiA2LjEzNTc0QzE4LjMzODggNS43NDUyMiAxOC4zMzg4IDUuMTEyMjEgMTcuOTQ4MiA0LjcyMTY4TDE2LjIxOTcgMi45OTMxNloiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl84MTdfNTA2NjcpIj48L3BhdGg+PHBhdGggZD0iTTMwIDBDMzEuMTA0NiAwIDMyIDAuODk1NDMxIDMyIDJWMzBDMzIgMzEuMTA0NiAzMS4xMDQ2IDMyIDMwIDMySDJDMC44OTU0MzEgMzIgMCAzMS4xMDQ2IDAgMzBWMkMwIDAuODk1NDMxIDAuODk1NDMxIDAgMiAwSDMwWk0xNi4yMTk3IDIuOTkzMTZDMTUuODI5MiAyLjYwMjY2IDE1LjE5NjIgMi42MDI2NSAxNC44MDU3IDIuOTkzMTZMOC4zNjMyOCA5LjQzNTU1QzcuOTcyOTQgOS44MjYwOCA3Ljk3Mjg0IDEwLjQ1OTEgOC4zNjMyOCAxMC44NDk2TDEwLjA5MTggMTIuNTc4MUMxMC40ODIzIDEyLjk2ODYgMTEuMTE1MyAxMi45Njg1IDExLjUwNTkgMTIuNTc4MUwxMS41ODUgMTIuNDk5TDEzLjk0MTQgMTQuODU2NEwzLjU3MTI5IDI1LjIyNzVDMi43MDM1NyAyNi4wOTU0IDIuNzAzNSAyNy41MDIzIDMuNTcxMjkgMjguMzcwMUM0LjQzOTExIDI5LjIzNzYgNS44NDYxMiAyOS4yMzc3IDYuNzEzODcgMjguMzcwMUwxNy4wODQgMTcuOTk5TDE5LjQ0MTQgMjAuMzU2NEwxOS4zNjMzIDIwLjQzNDZDMTguOTcyOCAyMC44MjUxIDE4Ljk3MjggMjEuNDU4MSAxOS4zNjMzIDIxLjg0ODZMMjEuMDkxOCAyMy41NzcxQzIxLjQ4MjMgMjMuOTY3NiAyMi4xMTU0IDIzLjk2NzYgMjIuNTA1OSAyMy41NzcxTDI4Ljk0ODIgMTcuMTM0OEMyOS4zMzg2IDE2Ljc0NDMgMjkuMzM4NiAxNi4xMTEyIDI4Ljk0ODIgMTUuNzIwN0wyNy4yMTk3IDEzLjk5MjJDMjYuODI5MyAxMy42MDE3IDI2LjE5NjIgMTMuNjAxOCAyNS44MDU3IDEzLjk5MjJMMjUuNzI2NiAxNC4wNzAzTDIzLjM3MDEgMTEuNzEzOUMyNC4yMzc3IDEwLjg0NjEgMjQuMjM3NiA5LjQzOTEgMjMuMzcwMSA4LjU3MTI5QzIyLjUwMjMgNy43MDM1IDIxLjA5NTQgNy43MDM1NyAyMC4yMjc1IDguNTcxMjlMMTcuODcwMSA2LjIxMzg3TDE3Ljk0ODIgNi4xMzU3NEMxOC4zMzg4IDUuNzQ1MjIgMTguMzM4OCA1LjExMjIxIDE3Ljk0ODIgNC43MjE2OEwxNi4yMTk3IDIuOTkzMTZaIiBmaWxsPSJ1cmwoI3BhaW50Ml9saW5lYXJfODE3XzUwNjY3KSI+PC9wYXRoPjwvZz48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfODE3XzUwNjY3IiB4MT0iMTguODEwMiIgeTE9Ii0xMi43MjIyIiB4Mj0iMi44ODUzNiIgeTI9IjM5LjEwNjMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjRkY2QTRBIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjQzcwQzAwIj48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfODE3XzUwNjY3IiB4MT0iMTUuNzQ2NyIgeTE9Ii00Ljc1NTc1IiB4Mj0iMTYuMzIxIiB5Mj0iMzkuMDY3MiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNGRkM5MDAiPjwvc3RvcD48c3RvcCBvZmZzZXQ9IjAuOTkiIHN0b3AtY29sb3I9IiNGRjk1MDAiPjwvc3RvcD48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQyX2xpbmVhcl84MTdfNTA2NjciIHgxPSItMTQuOTU0MyIgeTE9IjQ2Ljk1NDQiIHgyPSIzMi4wMDAxIiB5Mj0iLTAuMDAwNTA5MjIyIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iIzAwOTVGRiI+PC9zdG9wPjxzdG9wIG9mZnNldD0iMC45OSIgc3RvcC1jb2xvcj0iIzAwQzdGRiI+PC9zdG9wPjwvbGluZWFyR3JhZGllbnQ+PGNsaXBQYXRoIGlkPSJjbGlwMF84MTdfNTA2NjciPjxyZWN0IHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0id2hpdGUiPjwvcmVjdD48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4="
    },
    vip: {
      label: "VIP",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzc0Nl8yODE3MSkiPjxwYXRoIGQ9Ik0zMCAwQzMxLjEwNDYgMCAzMiAwLjg5NTQzMSAzMiAyVjMwQzMyIDMxLjEwNDYgMzEuMTA0NiAzMiAzMCAzMkgyQzAuODk1NDMxIDMyIDAgMzEuMTA0NiAwIDMwVjJDMCAwLjg5NTQzMSAwLjg5NTQzMSA0LjEwNjM3ZS0wOCAyIDBIMzBaTTE1Ljk2NDggNUMxNS43NzQ4IDUuMDAwMDUgMTUuNTg4IDUuMDUyMDQgMTUuNDIzOCA1LjE1MDM5QzE1LjI1OTYgNS4yNDg3OCAxNS4xMjQgNS4zOTA1NyAxNS4wMzAzIDUuNTYwNTVMOS44MjgxMiAxNS4wMTc2TDMuNTUwNzggMTEuODkwNkMzLjM2OTEzIDExLjc5ODUgMy4xNjUzNCAxMS43NjA3IDIuOTYzODcgMTEuNzgyMkMyLjc2MjQxIDExLjgwMzggMi41NzA0OCAxMS44ODQyIDIuNDExMTMgMTIuMDEyN0MyLjI1MjM1IDEyLjE0MDggMi4xMzE4NSAxMi4zMTI2IDIuMDYzNDggMTIuNTA3OEMxLjk5NTExIDEyLjcwMzEgMS45ODE0MyAxMi45MTQ0IDIuMDI0NDEgMTMuMTE3Mkw0LjU4MzAxIDI1LjEyN0M0LjYzNTQ0IDI1LjM3ODIgNC43NzE2NSAyNS42MDM0IDQuOTY3NzcgMjUuNzYyN0M1LjE2Mzc2IDI1LjkyMTcgNS40MDc2MiAyNi4wMDU2IDUuNjU3MjMgMjZIMjYuMjUxQzI2LjUwMDkgMjYuMDA1NyAyNi43NDUzIDI1LjkyMTkgMjYuOTQxNCAyNS43NjI3QzI3LjEzNzYgMjUuNjAzNCAyNy4yNzM3IDI1LjM3ODIgMjcuMzI2MiAyNS4xMjdMMjkuOTY5NyAxMy4xMTcyQzMwLjAxODcgMTIuOTEwMyAzMC4wMDg2IDEyLjY5MzIgMjkuOTQwNCAxMi40OTIyQzI5Ljg3MjIgMTIuMjkxMiAyOS43NDg1IDEyLjExNTEgMjkuNTg1IDExLjk4NDRDMjkuNDIxNSAxMS44NTM3IDI5LjIyNDkgMTEuNzc0MyAyOS4wMTg2IDExLjc1NTlDMjguODEyMiAxMS43Mzc0IDI4LjYwNDkgMTEuNzgwMiAyOC40MjE5IDExLjg3OTlMMjIuMTAyNSAxNS4wMjgzTDE2LjkwMDQgNS41NjA1NUMxNi44MDY2IDUuMzkwNTQgMTYuNjcwMSA1LjI0ODc4IDE2LjUwNTkgNS4xNTAzOUMxNi4zNDE2IDUuMDUyMDcgMTYuMTU0OSA1IDE1Ljk2NDggNVoiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcl83NDZfMjgxNzEpIj48L3BhdGg+PHBhdGggZD0iTTMwIDBDMzEuMTA0NiAwIDMyIDAuODk1NDMxIDMyIDJWMzBDMzIgMzEuMTA0NiAzMS4xMDQ2IDMyIDMwIDMySDJDMC44OTU0MzEgMzIgMCAzMS4xMDQ2IDAgMzBWMkMwIDAuODk1NDMxIDAuODk1NDMxIDQuMTA2MzdlLTA4IDIgMEgzMFpNMTUuOTY0OCA1QzE1Ljc3NDggNS4wMDAwNSAxNS41ODggNS4wNTIwNCAxNS40MjM4IDUuMTUwMzlDMTUuMjU5NiA1LjI0ODc4IDE1LjEyNCA1LjM5MDU3IDE1LjAzMDMgNS41NjA1NUw5LjgyODEyIDE1LjAxNzZMMy41NTA3OCAxMS44OTA2QzMuMzY5MTMgMTEuNzk4NSAzLjE2NTM0IDExLjc2MDcgMi45NjM4NyAxMS43ODIyQzIuNzYyNDEgMTEuODAzOCAyLjU3MDQ4IDExLjg4NDIgMi40MTExMyAxMi4wMTI3QzIuMjUyMzUgMTIuMTQwOCAyLjEzMTg1IDEyLjMxMjYgMi4wNjM0OCAxMi41MDc4QzEuOTk1MTEgMTIuNzAzMSAxLjk4MTQzIDEyLjkxNDQgMi4wMjQ0MSAxMy4xMTcyTDQuNTgzMDEgMjUuMTI3QzQuNjM1NDQgMjUuMzc4MiA0Ljc3MTY1IDI1LjYwMzQgNC45Njc3NyAyNS43NjI3QzUuMTYzNzYgMjUuOTIxNyA1LjQwNzYyIDI2LjAwNTYgNS42NTcyMyAyNkgyNi4yNTFDMjYuNTAwOSAyNi4wMDU3IDI2Ljc0NTMgMjUuOTIxOSAyNi45NDE0IDI1Ljc2MjdDMjcuMTM3NiAyNS42MDM0IDI3LjI3MzcgMjUuMzc4MiAyNy4zMjYyIDI1LjEyN0wyOS45Njk3IDEzLjExNzJDMzAuMDE4NyAxMi45MTAzIDMwLjAwODYgMTIuNjkzMiAyOS45NDA0IDEyLjQ5MjJDMjkuODcyMiAxMi4yOTEyIDI5Ljc0ODUgMTIuMTE1MSAyOS41ODUgMTEuOTg0NEMyOS40MjE1IDExLjg1MzcgMjkuMjI0OSAxMS43NzQzIDI5LjAxODYgMTEuNzU1OUMyOC44MTIyIDExLjczNzQgMjguNjA0OSAxMS43ODAyIDI4LjQyMTkgMTEuODc5OUwyMi4xMDI1IDE1LjAyODNMMTYuOTAwNCA1LjU2MDU1QzE2LjgwNjYgNS4zOTA1NCAxNi42NzAxIDUuMjQ4NzggMTYuNTA1OSA1LjE1MDM5QzE2LjM0MTYgNS4wNTIwNyAxNi4xNTQ5IDUgMTUuOTY0OCA1WiIgZmlsbD0idXJsKCNwYWludDFfbGluZWFyXzc0Nl8yODE3MSkiPjwvcGF0aD48L2c+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzc0Nl8yODE3MSIgeDE9IjE4LjgxMDIiIHkxPSItMTIuNzIyMiIgeDI9IjIuODg1MzYiIHkyPSIzOS4xMDYzIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iI0ZGNkE0QSI+PC9zdG9wPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0M3MEMwMCI+PC9zdG9wPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzc0Nl8yODE3MSIgeDE9IjE1Ljc0NjciIHkxPSItNC43NTU3NSIgeDI9IjE2LjMyMSIgeTI9IjM5LjA2NzIiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjRkZDOTAwIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIwLjk5IiBzdG9wLWNvbG9yPSIjRkY5NTAwIj48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48Y2xpcFBhdGggaWQ9ImNsaXAwXzc0Nl8yODE3MSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSJ3aGl0ZSI+PC9yZWN0PjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=="
    },
    og: {
      label: "OG",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzYxNF82MjY2KSI+PHBhdGggZD0iTTIyLjgyMjYgMTcuMjY5M1YyOC4wMDM3QzIyLjgyMjYgMjguMjE3NyAyMi44OTI5IDI4LjM4MyAyMy4wMzM2IDI4LjQ5OTZDMjMuMTc0MiAyOC41OTY5IDIzLjM5NjkgMjguNjQ1NSAyMy43MDE3IDI4LjY0NTVIMjQuNTEwNFYzMkgyMS44MzhDMTkuOTYyNyAzMiAxOC42MjY1IDMxLjY2OTQgMTcuODI5NCAzMS4wMDgyQzE3LjA1NTkgMzAuMzQ3IDE2LjY2OTEgMjkuNDcyIDE2LjY2OTEgMjguMzgzVjE2Ljg5MDFDMTYuNjY5MSAxNS44MDExIDE3LjA1NTkgMTQuOTI2IDE3LjgyOTQgMTQuMjY0OEMxOC42MjY1IDEzLjYwMzYgMTkuOTYyNyAxMy4yNzMgMjEuODM4IDEzLjI3M0gyNC42NTExVjE2LjYyNzZIMjMuNzAxN0MyMy4zOTY5IDE2LjYyNzYgMjMuMTc0MiAxNi42ODU5IDIzLjAzMzYgMTYuODAyNkMyMi44OTI5IDE2Ljg5OTggMjIuODIyNiAxNy4wNTU0IDIyLjgyMjYgMTcuMjY5M1pNMzIuMDAwMiAyMS42NDQ3VjI0Ljg4MjZIMjQuMDg4NVYyMS42NDQ3SDMyLjAwMDJaTTI1Ljg0NjYgMTkuNjkwNFYxNy4yNjkzQzI1Ljg0NjYgMTcuMDU1NCAyNS43NzYzIDE2Ljg5OTggMjUuNjM1NyAxNi44MDI2QzI1LjQ5NSAxNi42ODU5IDI1LjI3MjMgMTYuNjI3NiAyNC45Njc2IDE2LjYyNzZIMjQuMDE4MlYxMy4yNzNIMjYuODMxMkMyOC43MDY2IDEzLjI3MyAzMC4wMzEgMTMuNjAzNiAzMC44MDQ2IDE0LjI2NDhDMzEuNjAxNyAxNC45MjYgMzIuMDAwMiAxNS44MDExIDMyLjAwMDIgMTYuODkwMVYxOS42OTA0SDI1Ljg0NjZaTTI1Ljg0NjYgMjguMDAzN1YyMy44OTA4SDMyLjAwMDJWMjguMzgzQzMyLjAwMDIgMjkuNDcyIDMxLjYwMTcgMzAuMzQ3IDMwLjgwNDYgMzEuMDA4MkMzMC4wMzEgMzEuNjY5NCAyOC43MDY2IDMyIDI2LjgzMTIgMzJIMjQuMTU4OFYyOC42NDU1SDI0Ljk2NzZDMjUuMjcyMyAyOC42NDU1IDI1LjQ5NSAyOC41OTY5IDI1LjYzNTcgMjguNDk5NkMyNS43NzYzIDI4LjM4MyAyNS44NDY2IDI4LjIxNzcgMjUuODQ2NiAyOC4wMDM3WiIgZmlsbD0id2hpdGUiPjwvcGF0aD48cGF0aCBkPSJNMjIuODIyNiAxNy4yNjkzVjI4LjAwMzdDMjIuODIyNiAyOC4yMTc3IDIyLjg5MjkgMjguMzgzIDIzLjAzMzYgMjguNDk5NkMyMy4xNzQyIDI4LjU5NjkgMjMuMzk2OSAyOC42NDU1IDIzLjcwMTcgMjguNjQ1NUgyNC41MTA0VjMySDIxLjgzOEMxOS45NjI3IDMyIDE4LjYyNjUgMzEuNjY5NCAxNy44Mjk0IDMxLjAwODJDMTcuMDU1OSAzMC4zNDcgMTYuNjY5MSAyOS40NzIgMTYuNjY5MSAyOC4zODNWMTYuODkwMUMxNi42NjkxIDE1LjgwMTEgMTcuMDU1OSAxNC45MjYgMTcuODI5NCAxNC4yNjQ4QzE4LjYyNjUgMTMuNjAzNiAxOS45NjI3IDEzLjI3MyAyMS44MzggMTMuMjczSDI0LjY1MTFWMTYuNjI3NkgyMy43MDE3QzIzLjM5NjkgMTYuNjI3NiAyMy4xNzQyIDE2LjY4NTkgMjMuMDMzNiAxNi44MDI2QzIyLjg5MjkgMTYuODk5OCAyMi44MjI2IDE3LjA1NTQgMjIuODIyNiAxNy4yNjkzWk0zMi4wMDAyIDIxLjY0NDdWMjQuODgyNkgyNC4wODg1VjIxLjY0NDdIMzIuMDAwMlpNMjUuODQ2NiAxOS42OTA0VjE3LjI2OTNDMjUuODQ2NiAxNy4wNTU0IDI1Ljc3NjMgMTYuODk5OCAyNS42MzU3IDE2LjgwMjZDMjUuNDk1IDE2LjY4NTkgMjUuMjcyMyAxNi42Mjc2IDI0Ljk2NzYgMTYuNjI3NkgyNC4wMTgyVjEzLjI3M0gyNi44MzEyQzI4LjcwNjYgMTMuMjczIDMwLjAzMSAxMy42MDM2IDMwLjgwNDYgMTQuMjY0OEMzMS42MDE3IDE0LjkyNiAzMi4wMDAyIDE1LjgwMTEgMzIuMDAwMiAxNi44OTAxVjE5LjY5MDRIMjUuODQ2NlpNMjUuODQ2NiAyOC4wMDM3VjIzLjg5MDhIMzIuMDAwMlYyOC4zODNDMzIuMDAwMiAyOS40NzIgMzEuNjAxNyAzMC4zNDcgMzAuODA0NiAzMS4wMDgyQzMwLjAzMSAzMS42Njk0IDI4LjcwNjYgMzIgMjYuODMxMiAzMkgyNC4xNTg4VjI4LjY0NTVIMjQuOTY3NkMyNS4yNzIzIDI4LjY0NTUgMjUuNDk1IDI4LjU5NjkgMjUuNjM1NyAyOC40OTk2QzI1Ljc3NjMgMjguMzgzIDI1Ljg0NjYgMjguMjE3NyAyNS44NDY2IDI4LjAwMzdaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfNjE0XzYyNjYpIj48L3BhdGg+PHBhdGggZD0iTTIyLjgyMjggMy45OTYyNVYxNC43MzA3QzIyLjgyMjggMTQuOTQ0NiAyMi44OTMxIDE1LjEwOTkgMjMuMDMzOCAxNS4yMjY2QzIzLjE3NDQgMTUuMzIzOCAyMy4zOTcxIDE1LjM3MjQgMjMuNzAxOSAxNS4zNzI0SDI0LjUxMDZWMTguNzI3SDIxLjgzODJDMTkuOTYyOSAxOC43MjcgMTguNjI2NyAxOC4zOTY0IDE3LjgyOTYgMTcuNzM1MkMxNy4wNTYgMTcuMDc0IDE2LjY2OTMgMTYuMTk4OSAxNi42NjkzIDE1LjEwOTlWMy42MTcwNEMxNi42NjkzIDIuNTI4MDQgMTcuMDU2IDEuNjUyOTUgMTcuODI5NiAwLjk5MTc3QzE4LjYyNjcgMC4zMzA1OSAxOS45NjI5IDAgMjEuODM4MiAwSDI0LjY1MTNWMy4zNTQ1MkgyMy43MDE5QzIzLjM5NzEgMy4zNTQ1MiAyMy4xNzQ0IDMuNDEyODYgMjMuMDMzOCAzLjUyOTUzQzIyLjg5MzEgMy42MjY3NyAyMi44MjI4IDMuNzgyMzQgMjIuODIyOCAzLjk5NjI1Wk0zMi4wMDA0IDguMzcxNzFWMTEuNjA5NUgyNC4wODg3VjguMzcxNzFIMzIuMDAwNFpNMjUuODQ2OCA2LjQxNzM0VjMuOTk2MjVDMjUuODQ2OCAzLjc4MjM0IDI1Ljc3NjUgMy42MjY3NyAyNS42MzU4IDMuNTI5NTNDMjUuNDk1MiAzLjQxMjg2IDI1LjI3MjUgMy4zNTQ1MiAyNC45Njc3IDMuMzU0NTJIMjQuMDE4M1YwSDI2LjgzMTRDMjguNzA2NyAwIDMwLjAzMTIgMC4zMzA1OSAzMC44MDQ4IDAuOTkxNzdDMzEuNjAxOCAxLjY1Mjk1IDMyLjAwMDQgMi41MjgwNCAzMi4wMDA0IDMuNjE3MDRWNi40MTczNEgyNS44NDY4Wk0yNS44NDY4IDE0LjczMDdWMTAuNjE3OEgzMi4wMDA0VjE1LjEwOTlDMzIuMDAwNCAxNi4xOTg5IDMxLjYwMTggMTcuMDc0IDMwLjgwNDggMTcuNzM1MkMzMC4wMzEyIDE4LjM5NjQgMjguNzA2NyAxOC43MjcgMjYuODMxNCAxOC43MjdIMjQuMTU5VjE1LjM3MjRIMjQuOTY3N0MyNS4yNzI1IDE1LjM3MjQgMjUuNDk1MiAxNS4zMjM4IDI1LjYzNTggMTUuMjI2NkMyNS43NzY1IDE1LjEwOTkgMjUuODQ2OCAxNC45NDQ2IDI1Ljg0NjggMTQuNzMwN1oiIGZpbGw9IiMwMEZGRjIiPjwvcGF0aD48cGF0aCBkPSJNOS4zODg1NSA3LjgxNzQ4VjQuMjg3OTVDOS4zODg1NSA0LjA3NDA0IDkuMzE4MjIgMy45MTg0NiA5LjE3NzU3IDMuODIxMjNDOS4wMzY5MSAzLjcwNDU1IDguODE0MjEgMy42NDYyMSA4LjUwOTQ3IDMuNjQ2MjFINy4zNDkwOVYwSDEwLjM3MzFDMTIuMjQ4NSAwIDEzLjU3MyAwLjMzMDU5IDE0LjM0NjUgMC45OTE3N0MxNS4xNDM2IDEuNjUyOTUgMTUuNTQyMSAyLjUyODA0IDE1LjU0MjEgMy42MTcwNFY3LjgxNzQ4SDkuMzg4NTVaTTkuMzg4NTUgMTQuNDM5VjcuNDM4MjhIMTUuNTQyMVYxNS4xMDk5QzE1LjU0MjEgMTYuMTk4OSAxNS4xNDM2IDE3LjA3NCAxNC4zNDY1IDE3LjczNTJDMTMuNTczIDE4LjM5NjQgMTIuMjQ4NSAxOC43MjcgMTAuMzczMSAxOC43MjdINy4zNDkwOVYxNS4wODA3SDguNTA5NDdDOC44MTQyMSAxNS4wODA3IDkuMDM2OTEgMTUuMDMyMSA5LjE3NzU3IDE0LjkzNDlDOS4zMTgyMiAxNC44MTgyIDkuMzg4NTUgMTQuNjUyOSA5LjM4ODU1IDE0LjQzOVpNNi4xNTM1NCA0LjI4Nzk1VjcuODE3NDhIMFYzLjYxNzA0QzAgMi41MjgwNCAwLjM4Njc5NCAxLjY1Mjk1IDEuMTYwMzggMC45OTE3N0MxLjk1NzQxIDAuMzMwNTkgMy4yOTM2MSAwIDUuMTY4OTcgMEg4LjE5M1YzLjY0NjIxSDcuMDMyNjJDNi43Mjc4NyAzLjY0NjIxIDYuNTA1MTcgMy43MDQ1NSA2LjM2NDUyIDMuODIxMjNDNi4yMjM4NyAzLjkxODQ2IDYuMTUzNTQgNC4wNzQwNCA2LjE1MzU0IDQuMjg3OTVaTTYuMTUzNTQgNy40MzgyOFYxNC40MzlDNi4xNTM1NCAxNC42NTI5IDYuMjIzODcgMTQuODE4MiA2LjM2NDUyIDE0LjkzNDlDNi41MDUxNyAxNS4wMzIxIDYuNzI3ODcgMTUuMDgwNyA3LjAzMjYyIDE1LjA4MDdIOC4xOTNWMTguNzI3SDUuMTY4OTdDMy4yOTM2MSAxOC43MjcgMS45NTc0MSAxOC4zOTY0IDEuMTYwMzggMTcuNzM1MkMwLjM4Njc5NCAxNy4wNzQgMCAxNi4xOTg5IDAgMTUuMTA5OVY3LjQzODI4SDYuMTUzNTRaIiBmaWxsPSJ3aGl0ZSI+PC9wYXRoPjxwYXRoIGQ9Ik05LjM4ODU1IDcuODE3NDhWNC4yODc5NUM5LjM4ODU1IDQuMDc0MDQgOS4zMTgyMiAzLjkxODQ2IDkuMTc3NTcgMy44MjEyM0M5LjAzNjkxIDMuNzA0NTUgOC44MTQyMSAzLjY0NjIxIDguNTA5NDcgMy42NDYyMUg3LjM0OTA5VjBIMTAuMzczMUMxMi4yNDg1IDAgMTMuNTczIDAuMzMwNTkgMTQuMzQ2NSAwLjk5MTc3QzE1LjE0MzYgMS42NTI5NSAxNS41NDIxIDIuNTI4MDQgMTUuNTQyMSAzLjYxNzA0VjcuODE3NDhIOS4zODg1NVpNOS4zODg1NSAxNC40MzlWNy40MzgyOEgxNS41NDIxVjE1LjEwOTlDMTUuNTQyMSAxNi4xOTg5IDE1LjE0MzYgMTcuMDc0IDE0LjM0NjUgMTcuNzM1MkMxMy41NzMgMTguMzk2NCAxMi4yNDg1IDE4LjcyNyAxMC4zNzMxIDE4LjcyN0g3LjM0OTA5VjE1LjA4MDdIOC41MDk0N0M4LjgxNDIxIDE1LjA4MDcgOS4wMzY5MSAxNS4wMzIxIDkuMTc3NTcgMTQuOTM0OUM5LjMxODIyIDE0LjgxODIgOS4zODg1NSAxNC42NTI5IDkuMzg4NTUgMTQuNDM5Wk02LjE1MzU0IDQuMjg3OTVWNy44MTc0OEgwVjMuNjE3MDRDMCAyLjUyODA0IDAuMzg2Nzk0IDEuNjUyOTUgMS4xNjAzOCAwLjk5MTc3QzEuOTU3NDEgMC4zMzA1OSAzLjI5MzYxIDAgNS4xNjg5NyAwSDguMTkzVjMuNjQ2MjFINy4wMzI2MkM2LjcyNzg3IDMuNjQ2MjEgNi41MDUxNyAzLjcwNDU1IDYuMzY0NTIgMy44MjEyM0M2LjIyMzg3IDMuOTE4NDYgNi4xNTM1NCA0LjA3NDA0IDYuMTUzNTQgNC4yODc5NVpNNi4xNTM1NCA3LjQzODI4VjE0LjQzOUM2LjE1MzU0IDE0LjY1MjkgNi4yMjM4NyAxNC44MTgyIDYuMzY0NTIgMTQuOTM0OUM2LjUwNTE3IDE1LjAzMjEgNi43Mjc4NyAxNS4wODA3IDcuMDMyNjIgMTUuMDgwN0g4LjE5M1YxOC43MjdINS4xNjg5N0MzLjI5MzYxIDE4LjcyNyAxLjk1NzQxIDE4LjM5NjQgMS4xNjAzOCAxNy43MzUyQzAuMzg2Nzk0IDE3LjA3NCAwIDE2LjE5ODkgMCAxNS4xMDk5VjcuNDM4MjhINi4xNTM1NFoiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl82MTRfNjI2NikiPjwvcGF0aD48cGF0aCBkPSJNOS4zODgzOSAyMS4wOTA1VjE3LjU2MUM5LjM4ODM5IDE3LjM0NzEgOS4zMTgwNyAxNy4xOTE1IDkuMTc3NDEgMTcuMDk0M0M5LjAzNjc2IDE2Ljk3NzYgOC44MTQwNiAxNi45MTkzIDguNTA5MzIgMTYuOTE5M0g3LjM0ODkzVjEzLjI3M0gxMC4zNzNDMTIuMjQ4MyAxMy4yNzMgMTMuNTcyOCAxMy42MDM2IDE0LjM0NjQgMTQuMjY0OEMxNS4xNDM0IDE0LjkyNiAxNS41NDE5IDE1LjgwMTEgMTUuNTQxOSAxNi44OTAxVjIxLjA5MDVIOS4zODgzOVpNOS4zODgzOSAyNy43MTJWMjAuNzExM0gxNS41NDE5VjI4LjM4M0MxNS41NDE5IDI5LjQ3MiAxNS4xNDM0IDMwLjM0NyAxNC4zNDY0IDMxLjAwODJDMTMuNTcyOCAzMS42Njk0IDEyLjI0ODMgMzIgMTAuMzczIDMySDcuMzQ4OTNWMjguMzUzOEg4LjUwOTMyQzguODE0MDYgMjguMzUzOCA5LjAzNjc2IDI4LjMwNTIgOS4xNzc0MSAyOC4yMDc5QzkuMzE4MDcgMjguMDkxMyA5LjM4ODM5IDI3LjkyNiA5LjM4ODM5IDI3LjcxMlpNNi4xNTMzOSAxNy41NjFWMjEuMDkwNUgtMC4wMDAxNTI1ODhWMTYuODkwMUMtMC4wMDAxNTI1ODggMTUuODAxMSAwLjM4NjY0MSAxNC45MjYgMS4xNjAyMyAxNC4yNjQ4QzEuOTU3MjYgMTMuNjAzNiAzLjI5MzQ2IDEzLjI3MyA1LjE2ODgyIDEzLjI3M0g4LjE5Mjg1VjE2LjkxOTNINy4wMzI0N0M2LjcyNzcyIDE2LjkxOTMgNi41MDUwMiAxNi45Nzc2IDYuMzY0MzcgMTcuMDk0M0M2LjIyMzcxIDE3LjE5MTUgNi4xNTMzOSAxNy4zNDcxIDYuMTUzMzkgMTcuNTYxWk02LjE1MzM5IDIwLjcxMTNWMjcuNzEyQzYuMTUzMzkgMjcuOTI2IDYuMjIzNzEgMjguMDkxMyA2LjM2NDM3IDI4LjIwNzlDNi41MDUwMiAyOC4zMDUyIDYuNzI3NzIgMjguMzUzOCA3LjAzMjQ3IDI4LjM1MzhIOC4xOTI4NVYzMkg1LjE2ODgyQzMuMjkzNDYgMzIgMS45NTcyNiAzMS42Njk0IDEuMTYwMjMgMzEuMDA4MkMwLjM4NjY0MSAzMC4zNDcgLTAuMDAwMTUyNTg4IDI5LjQ3MiAtMC4wMDAxNTI1ODggMjguMzgzVjIwLjcxMTNINi4xNTMzOVoiIGZpbGw9IiMwMEZGRjIiPjwvcGF0aD48L2c+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzYxNF82MjY2IiB4MT0iMjMuOTYyMiIgeTE9IjAuNjk1MTYyIiB4Mj0iMjQuNDI3NCIgeTI9IjMxLjk5ODYiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMDBGRkYyIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDA2Mzk5Ij48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfNjE0XzYyNjYiIHgxPSI3Ljc3MTA0IiB5MT0iMCIgeDI9IjcuOTEwNjIiIHkyPSIzMi41NjciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMDBGRkYyIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDA2Mzk5Ij48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48Y2xpcFBhdGggaWQ9ImNsaXAwXzYxNF82MjY2Ij48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9IndoaXRlIj48L3JlY3Q+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+"
    },
    sub_gifter: {
      label: "Gift Subscriber",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzMxXzMxOTkpIj48cGF0aCBkPSJNMjIuMzQgOS41TDI2IDRIMThMMTYgN0wxNCA0SDZMOS42NiA5LjVINFYxNS4xSDI4VjkuNUgyMi4zNFoiIGZpbGw9IiNERUIyRkYiPjwvcGF0aD48cGF0aCBkPSJNMjYuMDggMTkuMTAwMUg1LjkwMDAyVjI4LjUwMDFIMjYuMDhWMTkuMTAwMVoiIGZpbGw9IiNERUIyRkYiPjwvcGF0aD48cGF0aCBkPSJNMjYuMDggMTUuMTAwMUg1LjkwMDAyVjE5LjEwMDFIMjYuMDhWMTUuMTAwMVoiIGZpbGw9IiNCQzY2RkYiPjwvcGF0aD48L2c+PGRlZnM+PGNsaXBQYXRoIGlkPSJjbGlwMF8zMV8zMTk5Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQuNSIgZmlsbD0id2hpdGUiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQgNCkiPjwvcmVjdD48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4="
    },
    verified: {
      label: "Verified Streamer",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzYxNF82Mjc1KSI+PHBhdGggZD0iTTMwLjg1OTggMTkuMjM2OEMzMC4xOTc3IDE4LjIwNjkgMjkuNTM1NiAxNy4yMTM4IDI4Ljg3MzYgMTYuMTgzOUMyOC43MjY0IDE1Ljk2MzIgMjguNzI2NCAxNS44MTYxIDI4Ljg3MzYgMTUuNTk1NEMyOS41MzU2IDE0LjYwMjMgMzAuMTYwOSAxMy42MDkyIDMwLjgyMyAxMi42MTYxQzMxLjU5NTQgMTEuNDM5MSAzMS4xOTA4IDEwLjI5ODkgMjkuODY2NyA5LjgyMDY5QzI4Ljc2MzIgOS40MTYwOSAyNy42NTk4IDguOTc0NzEgMjYuNTU2MyA4LjU3MDEyQzI2LjMzNTYgOC40OTY1NiAyNi4yMjUzIDguMzQ5NDMgMjYuMjI1MyA4LjA5MTk2QzI2LjE4ODUgNi44NzgxNiAyNi4xMTQ5IDUuNjY0MzcgMjYuMDQxNCA0LjQ4NzM2QzI1Ljk2NzggMy4yIDI0Ljk3NDcgMi40NjQzNyAyMy43MjQxIDIuNzk1NEMyMi41NDcxIDMuMDg5NjYgMjEuMzcwMSAzLjQyMDY5IDIwLjIyOTkgMy43NTE3M0MxOS45NzI0IDMuODI1MjkgMTkuODI1MyAzLjc1MTczIDE5LjY0MTQgMy41Njc4MkMxOC45MDU3IDIuNjExNDkgMTguMTMzMyAxLjY5MTk1IDE3LjM5NzcgMC43NzI0MTRDMTYuNTg4NSAtMC4yNTc0NzIgMTUuMzM3OSAtMC4yNTc0NzIgMTQuNDkyIDAuNzcyNDE0QzEzLjc1NjMgMS42OTE5NSAxMi45ODM5IDIuNjExNDkgMTIuMjg1MSAzLjUzMTAzQzEyLjEwMTIgMy43ODg1IDExLjkxNzIgMy44MjUyOSAxMS42MjMgMy43NTE3M0MxMC40ODI4IDMuNDIwNjkgOS4zNDI1MyAzLjEyNjQ0IDguNTMzMzQgMi45MDU3NUM2Ljk1MTczIDIuNTM3OTMgNS45OTU0MSAzLjE2MzIyIDUuOTIxODQgNC40ODczNkM1Ljg0ODI4IDUuNzAxMTUgNS43NzQ3MiA2LjkxNDk1IDUuNzM3OTQgOC4xNjU1MkM1LjczNzk0IDguNDIyOTkgNS42Mjc1OSA4LjUzMzMzIDUuNDA2OSA4LjY0MzY4QzQuMjY2NjcgOS4wODUwNiAzLjEyNjQ0IDkuNTI2NDQgMS45ODYyMSA5Ljk2NzgyQzAuODA5MjAzIDEwLjQ0NiAwLjQ0MTM4NyAxMS41ODYyIDEuMTQwMjMgMTIuNjUyOUMxLjgwMjMgMTMuNjgyOCAyLjQ2NDM3IDE0LjY3NTkgMy4xMjY0NCAxNS43MDU3QzMuMjczNTYgMTUuOTI2NCAzLjI3MzU2IDE2LjA3MzYgMy4xMjY0NCAxNi4zMzFDMi40Mjc1OSAxNy4zNjA5IDEuNzY1NTIgMTguMzkwOCAxLjEwMzQ1IDE5LjQ1NzVDMC40NzgxNjUgMjAuNDUwNiAwLjg4Mjc1OSAyMS42Mjc2IDEuOTg2MjEgMjIuMDY5QzMuMTI2NDQgMjIuNTEwNCA0LjMwMzQ1IDIyLjk1MTcgNS40NDM2OCAyMy4zOTMxQzUuNzAxMTUgMjMuNDY2NyA1Ljc3NDcxIDIzLjYxMzggNS43NzQ3MSAyMy44NzEzQzUuODExNDkgMjUuMDQ4MyA1Ljk1ODYyIDI2LjE4ODUgNS45NTg2MiAyNy4zNjU1QzUuOTU4NjIgMjguNTQyNSA2Ljk4ODUgMjkuNjA5MiA4LjQyMjk4IDI5LjE2NzhDOS41NjMyMSAyOC44IDEwLjcwMzQgMjguNTQyNSAxMS44NDM3IDI4LjIxMTVDMTIuMDY0NCAyOC4xMzc5IDEyLjIxMTUgMjguMTc0NyAxMi4zNTg2IDI4LjM5NTRDMTMuMTMxIDI5LjM1MTcgMTMuODY2NyAzMC4yNzEzIDE0LjYzOTEgMzEuMjI3NkMxNS40ODUgMzIuMjU3NSAxNi42OTg4IDMyLjI1NzUgMTcuNTA4IDMxLjIyNzZDMTguMjgwNSAzMC4yNzEzIDE5LjAxNjEgMjkuMzUxNyAxOS43ODg1IDI4LjM5NTRDMTkuOTM1NiAyOC4yMTE1IDIwLjA0NiAyOC4xMzc5IDIwLjMwMzQgMjguMjExNUMyMS40ODA0IDI4LjU0MjUgMjIuNjU3NSAyOC44MzY4IDIzLjgzNDUgMjkuMTY3OEMyNS4wNDgzIDI5LjQ5ODggMjYuMDc4MSAyOC43NjMyIDI2LjExNDkgMjcuNTEyNkMyNi4xODg1IDI2LjI5ODkgMjYuMjYyMSAyNS4wODUxIDI2LjI5ODggMjMuODM0NUMyNi4yOTg4IDIzLjU0MDIgMjYuNDQ2IDIzLjQyOTkgMjYuNjY2NyAyMy4zNTYzQzI3Ljc3MDEgMjIuOTUxNyAyOC45MTAzIDIyLjUxMDQgMzAuMDEzOCAyMi4wNjlDMzEuMTkwOCAyMS40ODA1IDMxLjU1ODYgMjAuMzAzNCAzMC44NTk4IDE5LjIzNjhaTTIyLjA2OSAxMy4yMDQ2TDE0LjcxMjcgMjAuNTYwOUMxNC41Mjg3IDIwLjc0NDggMTQuMjcxMyAyMC44OTIgMTQuMDEzOCAyMC45Mjg3QzEzLjk0MDIgMjAuOTI4NyAxMy44Mjk5IDIwLjk2NTUgMTMuNzU2MyAyMC45NjU1QzEzLjQyNTMgMjAuOTY1NSAxMy4wNTc1IDIwLjgxODQgMTIuOCAyMC41NjA5TDkuNzgzOTIgMTcuNTQ0OEM5LjI2ODk4IDE3LjAyOTkgOS4yNjg5OCAxNi4xODM5IDkuNzgzOTIgMTUuNjY5QzEwLjI5ODkgMTUuMTU0IDExLjE0NDggMTUuMTU0IDExLjY1OTggMTUuNjY5TDEzLjcxOTYgMTcuNzI4N0wyMC4xMTk2IDExLjMyODdDMjAuNjM0NSAxMC44MTM4IDIxLjQ4MDUgMTAuODEzOCAyMS45OTU0IDExLjMyODdDMjIuNTgzOSAxMS44NDM3IDIyLjU4MzkgMTIuNjg5NyAyMi4wNjkgMTMuMjA0NloiIGZpbGw9InVybCgjcGFpbnQwX2xpbmVhcl82MTRfNjI3NSkiPjwvcGF0aD48L2c+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzYxNF82Mjc1IiB4MT0iOC4xNDEzOCIgeTE9IjMyLjM1OTEiIHgyPSIyNC40OTY4IiB5Mj0iMC45MDQ4ODQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMUVGRjAwIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIwLjk5IiBzdG9wLWNvbG9yPSIjMDBGRjhDIj48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48Y2xpcFBhdGggaWQ9ImNsaXAwXzYxNF82Mjc1Ij48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9IndoaXRlIj48L3JlY3Q+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+"
    },
    staff: {
      label: "Kick Staff",
      uri: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzYxNF82MjY2KSI+PHBhdGggZD0iTTIyLjgyMjYgMTcuMjY5M1YyOC4wMDM3QzIyLjgyMjYgMjguMjE3NyAyMi44OTI5IDI4LjM4MyAyMy4wMzM2IDI4LjQ5OTZDMjMuMTc0MiAyOC41OTY5IDIzLjM5NjkgMjguNjQ1NSAyMy43MDE3IDI4LjY0NTVIMjQuNTEwNFYzMkgyMS44MzhDMTkuOTYyNyAzMiAxOC42MjY1IDMxLjY2OTQgMTcuODI5NCAzMS4wMDgyQzE3LjA1NTkgMzAuMzQ3IDE2LjY2OTEgMjkuNDcyIDE2LjY2OTEgMjguMzgzVjE2Ljg5MDFDMTYuNjY5MSAxNS44MDExIDE3LjA1NTkgMTQuOTI2IDE3LjgyOTQgMTQuMjY0OEMxOC42MjY1IDEzLjYwMzYgMTkuOTYyNyAxMy4yNzMgMjEuODM4IDEzLjI3M0gyNC42NTExVjE2LjYyNzZIMjMuNzAxN0MyMy4zOTY5IDE2LjYyNzYgMjMuMTc0MiAxNi42ODU5IDIzLjAzMzYgMTYuODAyNkMyMi44OTI5IDE2Ljg5OTggMjIuODIyNiAxNy4wNTU0IDIyLjgyMjYgMTcuMjY5M1pNMzIuMDAwMiAyMS42NDQ3VjI0Ljg4MjZIMjQuMDg4NVYyMS42NDQ3SDMyLjAwMDJaTTI1Ljg0NjYgMTkuNjkwNFYxNy4yNjkzQzI1Ljg0NjYgMTcuMDU1NCAyNS43NzYzIDE2Ljg5OTggMjUuNjM1NyAxNi44MDI2QzI1LjQ5NSAxNi42ODU5IDI1LjI3MjMgMTYuNjI3NiAyNC45Njc2IDE2LjYyNzZIMjQuMDE4MlYxMy4yNzNIMjYuODMxMkMyOC43MDY2IDEzLjI3MyAzMC4wMzEgMTMuNjAzNiAzMC44MDQ2IDE0LjI2NDhDMzEuNjAxNyAxNC45MjYgMzIuMDAwMiAxNS44MDExIDMyLjAwMDIgMTYuODkwMVYxOS42OTA0SDI1Ljg0NjZaTTI1Ljg0NjYgMjguMDAzN1YyMy44OTA4SDMyLjAwMDJWMjguMzgzQzMyLjAwMDIgMjkuNDcyIDMxLjYwMTcgMzAuMzQ3IDMwLjgwNDYgMzEuMDA4MkMzMC4wMzEgMzEuNjY5NCAyOC43MDY2IDMyIDI2LjgzMTIgMzJIMjQuMTU4OFYyOC42NDU1SDI0Ljk2NzZDMjUuMjcyMyAyOC42NDU1IDI1LjQ5NSAyOC41OTY5IDI1LjYzNTcgMjguNDk5NkMyNS43NzYzIDI4LjM4MyAyNS44NDY2IDI4LjIxNzcgMjUuODQ2NiAyOC4wMDM3WiIgZmlsbD0id2hpdGUiPjwvcGF0aD48cGF0aCBkPSJNMjIuODIyOCAzLjk5NjI1VjE0LjczMDdDMjIuODIyOCAxNC45NDQ2IDIyLjg5MzEgMTUuMTA5OSAyMy4wMzM4IDE1LjIyNjZDMjMuMTc0NCAxNS4zMjM4IDIzLjM5NzEgMTUuMzcyNCAyMy43MDE5IDE1LjM3MjRIMjQuNTEwNlYxOC43MjdIMjEuODM4MkMxOS45NjI5IDE4LjcyNyAxOC42MjY3IDE4LjM5NjQgMTcuODI5NiAxNy43MzUyQzE3LjA1NiAxNy4wNzQgMTYuNjY5MyAxNi4xOTg5IDE2LjY2OTMgMTUuMTA5OVYzLjYxNzA0QzE2LjY2OTMgMi41MjgwNCAxNy4wNTYgMS42NTI5NSAxNy44Mjk2IDAuOTkxNzdDMTguNjI2NyAwLjMzMDU5IDE5Ljk2MjkgMCAyMS44MzgyIDBIMjQuNjUxM1YzLjM1NDUySDIzLjcwMTlDMjMuMzk3MSAzLjM1NDUyIDIzLjE3NDQgMy40MTI4NiAyMy4wMzM4IDMuNTI5NTNDMjIuODkzMSAzLjYyNjc3IDIyLjgyMjggMy43ODIzNCAyMi44MjI4IDMuOTk2MjVaTTMyLjAwMDQgOC4zNzE3MVYxMS42MDk1SDI0LjA4ODdWOC4zNzE3MUgzMi4wMDA0Wk0yNS44NDY4IDYuNDE3MzRWMy45OTYyNUMyNS44NDY4IDMuNzgyMzQgMjUuNzc2NSAzLjYyNjc3IDI1LjYzNTggMy41Mjk1M0MyNS40OTUyIDMuNDEyODYgMjUuMjcyNSAzLjM1NDUyIDI0Ljk2NzcgMy4zNTQ1MkgyNC4wMTgzVjBIMjYuODMxNEMyOC43MDY3IDAgMzAuMDMxMiAwLjMzMDU5IDMwLjgwNDggMC45OTE3N0MzMS42MDE4IDEuNjUyOTUgMzIuMDAwNCAyLjUyODA0IDMyLjAwMDQgMy42MTcwNFY2LjQxNzM0SDI1Ljg0NjhaTTI1Ljg0NjggMTQuNzMwN1YxMC42MTc4SDMyLjAwMDRWMTUuMTA5OUMzMi4wMDA0IDE2LjE5ODkgMzEuNjAxOCAxNy4wNzQgMzAuODA0OCAxNy43MzUyQzMwLjAzMTIgMTguMzk2NCAyOC43MDY3IDE4LjcyNyAyNi44MzE0IDE4LjcyN0gyNC4xNTlWMTUuMzcyNEgyNC45Njc3QzI1LjI3MjUgMTUuMzcyNCAyNS40OTUyIDE1LjMyMzggMjUuNjM1OCAxNS4yMjY2QzI1Ljc3NjUgMTUuMTA5OSAyNS44NDY4IDE0Ljk0NDYgMjUuODQ2OCAxNC43MzA3WiIgZmlsbD0iIzAwRkZGMiI+PC9wYXRoPjxwYXRoIGQ9Ik05LjM4ODU1IDcuODE3NDhWNC4yODc5NUM5LjM4ODU1IDQuMDc0MDQgOS4zMTgyMiAzLjkxODQ2IDkuMTc3NTcgMy44MjEyM0M5LjAzNjkxIDMuNzA0NTUgOC44MTQyMSAzLjY0NjIxIDguNTA5NDcgMy42NDYyMUg3LjM0OTA5VjBIMTAuMzczMUMxMi4yNDg1IDAgMTMuNTczIDAuMzMwNTkgMTQuMzQ2NSAwLjk5MTc3QzE1LjE0MzYgMS42NTI5NSAxNS41NDIxIDIuNTI4MDQgMTUuNTQyMSAzLjYxNzA0VjcuODE3NDhIOS4zODg1NVpNOS4zODg1NSAxNC40MzlWNy40MzgyOEgxNS41NDIxVjE1LjEwOTlDMTUuNTQyMSAxNi4xOTg5IDE1LjE0MzYgMTcuMDc0IDE0LjM0NjUgMTcuNzM1MkMxMy41NzMgMTguMzk2NCAxMi4yNDg1IDE4LjcyNyAxMC4zNzMxIDE4LjcyN0g3LjM0OTA5VjE1LjA4MDdIOC41MDk0N0M4LjgxNDIxIDE1LjA4MDcgOS4wMzY5MSAxNS4wMzIxIDkuMTc3NTcgMTQuOTM0OUM5LjMxODIyIDE0LjgxODIgOS4zODg1NSAxNC42NTI5IDkuMzg4NTUgMTQuNDM5Wk02LjE1MzU0IDQuMjg3OTVWNy44MTc0OEgwVjMuNjE3MDRDMCAyLjUyODA0IDAuMzg2Nzk0IDEuNjUyOTUgMS4xNjAzOCAwLjk5MTc3QzEuOTU3NDEgMC4zMzA1OSAzLjI5MzYxIDAgNS4xNjg5NyAwSDguMTkzVjMuNjQ2MjFINy4wMzI2MkM2LjcyNzg3IDMuNjQ2MjEgNi41MDUxNyAzLjcwNDU1IDYuMzY0NTIgMy44MjEyM0M2LjIyMzg3IDMuOTE4NDYgNi4xNTM1NCA0LjA3NDA0IDYuMTUzNTQgNC4yODc5NVpNNi4xNTM1NCA3LjQzODI4VjE0LjQzOUM2LjE1MzU0IDE0LjY1MjkgNi4yMjM4NyAxNC44MTgyIDYuMzY0NTIgMTQuOTM0OUM2LjUwNTE3IDE1LjAzMjEgNi43Mjc4NyAxNS4wODA3IDcuMDMyNjIgMTUuMDgwN0g4LjE5M1YxOC43MjdINS4xNjg5N0MzLjI5MzYxIDE4LjcyNyAxLjk1NzQxIDE4LjM5NjQgMS4xNjAzOCAxNy43MzUyQzAuMzg2Nzk0IDE3LjA3NCAwIDE2LjE5ODkgMCAxNS4xMDk5VjcuNDM4MjhINi4xNTM1NFoiIGZpbGw9IndoaXRlIj48L3BhdGg+PHBhdGggZD0iTTkuMzg4MzkgMjEuMDkwNVYxNy41NjFDOS4zODgzOSAxNy4zNDcxIDkuMzE4MDcgMTcuMTkxNSA5LjE3NzQxIDE3LjA5NDNDOS4wMzY3NiAxNi45Nzc2IDguODE0MDYgMTYuOTE5MyA4LjUwOTMyIDE2LjkxOTNINy4zNDg5M1YxMy4yNzNIMTAuMzczQzEyLjI0ODMgMTMuMjczIDEzLjU3MjggMTMuNjAzNiAxNC4zNDY0IDE0LjI2NDhDMTUuMTQzNCAxNC45MjYgMTUuNTQxOSAxNS44MDExIDE1LjU0MTkgMTYuODkwMVYyMS4wOTA1SDkuMzg4MzlaTTkuMzg4MzkgMjcuNzEyVjIwLjcxMTNIMTUuNTQxOVYyOC4zODNDMTUuNTQxOSAyOS40NzIgMTUuMTQzNCAzMC4zNDcgMTQuMzQ2NCAzMS4wMDgyQzEzLjU3MjggMzEuNjY5NCAxMi4yNDgzIDMyIDEwLjM3MyAzMkg3LjM0ODkzVjI4LjM1MzhIOC41MDkzMkM4LjgxNDA2IDI4LjM1MzggOS4wMzY3NiAyOC4zMDUyIDkuMTc3NDEgMjguMjA3OUM5LjMxODA3IDI4LjA5MTMgOS4zODgzOSAyNy45MjYgOS4zODgzOSAyNy43MTJaTTYuMTUzMzkgMTcuNTYxVjIxLjA5MDVILTAuMDAwMTUyNTg4VjE2Ljg5MDFDLTAuMDAwMTUyNTg4IDE1LjgwMTEgMC4zODY2NDEgMTQuOTI2IDEuMTYwMjMgMTQuMjY0OEMxLjk1NzI2IDEzLjYwMzYgMy4yOTM0NiAxMy4yNzMgNS4xNjg4MiAxMy4yNzNIOC4xOTI4NVYxNi45MTkzSDcuMDMyNDdDNi43Mjc3MiAxNi45MTkzIDYuNTA1MDIgMTYuOTc3NiA2LjM2NDM3IDE3LjA5NDNDNi4yMjM3MSAxNy4xOTE1IDYuMTUzMzkgMTcuMzQ3MSA2LjE1MzM5IDE3LjU2MVpNNi4xNTMzOSAyMC43MTEzVjI3LjcxMkM2LjE1MzM5IDI3LjkyNiA2LjIyMzcxIDI4LjA5MTMgNi4zNjQzNyAyOC4yMDc5QzYuNTA1MDIgMjguMzA1MiA2LjcyNzcyIDI4LjM1MzggNy4wMzI0NyAyOC4zNTM4SDguMTkyODVWMzJINS4xNjg4MkMzLjI5MzQ2IDMyIDEuOTU3MjYgMzEuNjY5NCAxLjE2MDIzIDMxLjAwODJDMC4zODY2NDEgMzAuMzQ3IC0wLjAwMDE1MjU4OCAyOS40NzIgLTAuMDAwMTUyNTg4IDI4LjM4M1YyMC43MTEzSDYuMTUzMzlaIiBmaWxsPSIjMDBGRkYyIj48L3BhdGg+PC9nPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2xpcDBfNjE0XzYyNjYiPjxyZWN0IHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0id2hpdGUiPjwvcmVjdD48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4="
    }
  };
  var ROLE_BADGE_FALLBACK_LABELS = {
    broadcaster: "Broadcaster",
    founder: "Founder",
    sidekick: "Sidekick",
    bot: "Bot",
    trainwreckstv: "Train\u2019s Army"
  };

  // src/content/chat/content-tokens.ts
  var EMOTE_NAME_PATTERN = "[^\\[\\]\\r\\n]{1,128}";
  var CONTENT_TOKEN_RE = new RegExp(
    `\\[emote:(?<emoteId>\\d{1,10}):(?<emoteName>${EMOTE_NAME_PATTERN})\\]|(?<url>https?:\\/\\/[^\\s]+)|(?<mention>@[a-zA-Z0-9_]{1,25})`,
    "g"
  );
  var EMOTE_TOKEN_RE = new RegExp(
    `\\[emote:\\d{1,10}:(${EMOTE_NAME_PATTERN})\\]`,
    "g"
  );
  function extractMentionUsernames(content) {
    const names = [];
    CONTENT_TOKEN_RE.lastIndex = 0;
    for (const match of content.matchAll(CONTENT_TOKEN_RE)) {
      const mention = match.groups?.mention;
      if (mention) names.push(mention.slice(1));
    }
    return names;
  }

  // src/content/chat/message-highlight.ts
  var DEFAULT_MENTION_HIGHLIGHT_COLOR = "#FFC94D";
  var ROLE_BAR_WIDTH_PX = 3;
  var ROLE_BAR_ALPHA = 0.8;
  var ROLE_FILL_ALPHA = 0.04;
  var MENTION_COLOR_SWATCHES = [
    "#FFC94D",
    // default amber
    "#F59E0B",
    // amber
    "#22D3EE",
    // cyan
    "#38BDF8",
    // sky
    "#A78BFA",
    // violet
    "#E879F9",
    // magenta
    "#FB7185",
    // coral
    "#2DD4BF"
    // mint/teal (outside reserved ~90–120° green)
  ];
  function resolveMessageHighlightState(input) {
    const roleBar = input.isVip && input.vipFrameEnabled ? "vip" : input.isModerator && input.modFrameEnabled ? "moderator" : null;
    let personal = null;
    if (input.mentionHighlightEnabled) {
      if (input.replyToMe) personal = "reply";
      else if (input.mentionMe) personal = "mention";
    }
    const style = input.mentionHighlightStyle;
    const wantsFill = personal != null && (style === "fill" || style === "both");
    const wantsFrame = personal != null && (style === "frame" || style === "both");
    const outline = wantsFrame && !input.jumpFlashActive;
    const roleFill = roleBar != null && input.roleHighlightStyle === "both" && !wantsFill ? roleBar : null;
    return { roleBar, roleFill, fill: wantsFill, outline, personal };
  }
  function normalizeHexColor(value) {
    const raw = value.trim();
    const m = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return null;
    let hex = m[1];
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    return `#${hex.toUpperCase()}`;
  }
  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16)
    };
  }
  function rgbToHex(r, g, b) {
    const clamp3 = (n) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[clamp3(r), clamp3(g), clamp3(b)].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    return { h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l) {
    const sn = s / 100;
    const ln = l / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const hp = (h % 360 + 360) % 360 / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let rn = 0;
    let gn = 0;
    let bn = 0;
    if (hp >= 0 && hp < 1) {
      rn = c;
      gn = x;
    } else if (hp < 2) {
      rn = x;
      gn = c;
    } else if (hp < 3) {
      gn = c;
      bn = x;
    } else if (hp < 4) {
      gn = x;
      bn = c;
    } else if (hp < 5) {
      rn = x;
      bn = c;
    } else {
      rn = c;
      bn = x;
    }
    const m = ln - c / 2;
    return {
      r: Math.round((rn + m) * 255),
      g: Math.round((gn + m) * 255),
      b: Math.round((bn + m) * 255)
    };
  }
  function sanitizeHighlightColor(raw) {
    const normalized = normalizeHexColor(raw);
    if (!normalized) return DEFAULT_MENTION_HIGHLIGHT_COLOR;
    const rgb = hexToRgb(normalized);
    if (!rgb) return DEFAULT_MENTION_HIGHLIGHT_COLOR;
    let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const lightBefore = l;
    l = Math.min(82, Math.max(55, l));
    let hueNudged = false;
    if (s > 55 && h >= 90 && h <= 120) {
      h = h < 105 ? 89 : 121;
      hueNudged = true;
    }
    if (!hueNudged && lightBefore === l) {
      return normalized;
    }
    const out = hslToRgb(h, s, l);
    return rgbToHex(out.r, out.g, out.b);
  }
  function rgbaFromHex(hex, alpha) {
    const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_MENTION_HIGHLIGHT_COLOR);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }
  function personalOutlineRgba(hex) {
    return rgbaFromHex(hex, 0.95);
  }
  function personalFillRgba(hex, style) {
    return rgbaFromHex(hex, style === "fill" ? 0.18 : 0.13);
  }

  // src/content/chat/owner-identity.ts
  var cached = null;
  var unresolvedDebugLogged = false;
  function invalidateOwnerIdentityCache() {
    cached = null;
    unresolvedDebugLogged = false;
  }
  function resolveOwnerIdentity() {
    const manual = featureFlags.manualUsername.trim();
    if (manual) {
      const identity = {
        username: normalizeChatIdentity(manual),
        userId: null
      };
      cached = identity;
      return identity;
    }
    if (cached && cached.username) return cached;
    const fromDom = readOwnerUsernameFromDom();
    if (fromDom) {
      cached = { username: normalizeChatIdentity(fromDom), userId: null };
      return cached;
    }
    if (!unresolvedDebugLogged) {
      unresolvedDebugLogged = true;
      console.debug("[kickflow] owner identity unresolved \u2014 mention/reply highlight idle until set");
    }
    return { username: null, userId: null };
  }
  function isOwnerIdentityResolved() {
    const id = resolveOwnerIdentity();
    return id.username != null && id.username.length > 0;
  }
  function readOwnerUsernameFromDom() {
    for (const nav of document.querySelectorAll("nav")) {
      const children = Array.from(nav.children);
      if (children.length < 3) continue;
      const right = children[2];
      if (!(right instanceof HTMLElement)) continue;
      if (!(right.classList.contains("flex") && right.classList.contains("items-center") && right.classList.contains("gap-2"))) {
        continue;
      }
      for (const link of right.querySelectorAll('a[href^="/"]')) {
        const slug = slugFromPath(link.getAttribute("href") ?? "");
        if (slug) return slug;
      }
      for (const el of right.querySelectorAll("button, img, [aria-label]")) {
        const labeled = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
        const guess = guessUsernameFromLabel(labeled);
        if (guess) return guess;
      }
    }
    const testIds = [
      '[data-testid="user-menu"]',
      '[data-testid="nav-profile"]',
      '[data-testid="header-user-menu"]',
      '[data-testid="user-profile"]'
    ];
    for (const sel of testIds) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const href = el.closest("a")?.getAttribute("href") || el.querySelector("a")?.getAttribute("href") || el.getAttribute("href");
      const slug = slugFromPath(href ?? "");
      if (slug) return slug;
      const labeled = el.getAttribute("aria-label") || "";
      const guess = guessUsernameFromLabel(labeled);
      if (guess) return guess;
    }
    return null;
  }
  var RESERVED_PATH_SLUGS = /* @__PURE__ */ new Set([
    "categories",
    "search",
    "browse",
    "following",
    "subscriptions",
    "dashboard",
    "settings",
    "transactions",
    "messages",
    "community",
    "clips",
    "videos",
    "home",
    "login",
    "signup",
    "register",
    "offline",
    "popout"
  ]);
  function slugFromPath(href) {
    try {
      const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://kick.com");
      if (url.hostname !== "kick.com" && !url.hostname.endsWith(".kick.com")) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 1) return null;
      const slug = parts[0].toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(slug)) return null;
      if (RESERVED_PATH_SLUGS.has(slug)) return null;
      return slug;
    } catch {
      return null;
    }
  }
  function guessUsernameFromLabel(label) {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const patterns = [
      /@([a-zA-Z0-9_]{1,25})/,
      /(?:profile|account|user)\s+(?:for\s+)?([a-zA-Z0-9_]{1,25})/i,
      /^([a-zA-Z0-9_]{1,25})(?:'s)?\s+(?:profile|account|menu)/i
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m?.[1] && !RESERVED_PATH_SLUGS.has(m[1].toLowerCase())) return m[1];
    }
    if (/^[a-zA-Z0-9_]{1,25}$/.test(trimmed) && !RESERVED_PATH_SLUGS.has(trimmed.toLowerCase())) {
      return trimmed;
    }
    return null;
  }

  // src/content/chat/message-highlight-apply.ts
  var ROLE_VIP_CLASS = "kickflow-message--role-vip";
  var ROLE_MOD_CLASS = "kickflow-message--role-mod";
  var ROLE_FILL_CLASS = "kickflow-message--role-fill";
  var MENTION_ME_CLASS = "kickflow-message--mention-me";
  var REPLY_ME_CLASS = "kickflow-message--reply-me";
  var HL_FILL_CLASS = "kickflow-message--hl-fill";
  var HL_FRAME_CLASS = "kickflow-message--hl-frame";
  var REPLY_TO_ME_CONTEXT_CLASS = "kickflow-message__reply-context--to-me";
  var REPLY_ME_MARK_CLASS = "kickflow-message__reply-me-mark";
  var JUMP_HIGHLIGHT_CLASS = "kickflow-message--jump-highlight";
  var OWN_HIGHLIGHT_CLASSES = [
    ROLE_VIP_CLASS,
    ROLE_MOD_CLASS,
    ROLE_FILL_CLASS,
    MENTION_ME_CLASS,
    REPLY_ME_CLASS,
    HL_FILL_CLASS,
    HL_FRAME_CLASS
  ];
  var activeHighlightStore = null;
  function setHighlightStore(store) {
    activeHighlightStore = store;
  }
  function messageMentionsOwner(content, ownerUsername) {
    if (!ownerUsername) return false;
    const want = normalizeChatIdentity(ownerUsername);
    return extractMentionUsernames(content).some((name) => normalizeChatIdentity(name) === want);
  }
  function messageRepliesToOwner(message2, owner) {
    const ctx = message2.replyContext;
    if (!ctx) return false;
    if (owner.userId != null && ctx.replyToUserId != null && ctx.replyToUserId === owner.userId) {
      return true;
    }
    if (owner.username && ctx.replyToUser) {
      return normalizeChatIdentity(ctx.replyToUser) === normalizeChatIdentity(owner.username);
    }
    return false;
  }
  function computeHighlightForMessage(message2, jumpFlashActive) {
    const owner = resolveOwnerIdentity();
    const badges = mergeIdentityBadges(message2.sender.identity);
    const isVip = badges.some((b) => b.type === "vip");
    const isModerator = badges.some((b) => b.type === "moderator");
    const mentionMe = messageMentionsOwner(message2.content, owner.username);
    const replyToMe = messageRepliesToOwner(message2, owner);
    return resolveMessageHighlightState({
      isVip,
      isModerator,
      mentionMe,
      replyToMe,
      jumpFlashActive,
      mentionHighlightEnabled: featureFlags.mentionHighlightEnabled,
      mentionHighlightStyle: featureFlags.mentionHighlightStyle,
      roleHighlightStyle: featureFlags.roleHighlightStyle,
      modFrameEnabled: featureFlags.modFrameEnabled,
      vipFrameEnabled: featureFlags.vipFrameEnabled
    });
  }
  function syncHighlightCssVars(root) {
    const target = root ?? document.getElementById(OWN_LIST_ID) ?? document.documentElement;
    const color = featureFlags.mentionHighlightColor;
    const style = featureFlags.mentionHighlightStyle;
    target.style.setProperty("--kf-hl-outline", personalOutlineRgba(color));
    target.style.setProperty("--kf-hl-fill", personalFillRgba(color, style === "fill" ? "fill" : "both"));
    target.style.setProperty("--kf-hl-fill-only", personalFillRgba(color, "fill"));
    target.style.setProperty("--kf-mod-bar", rgbaFromHex(featureFlags.modFrameColor, ROLE_BAR_ALPHA));
    target.style.setProperty("--kf-mod-fill", rgbaFromHex(featureFlags.modFrameColor, ROLE_FILL_ALPHA));
    target.style.setProperty("--kf-vip-bar", rgbaFromHex(featureFlags.vipFrameColor, ROLE_BAR_ALPHA));
    target.style.setProperty("--kf-vip-fill", rgbaFromHex(featureFlags.vipFrameColor, ROLE_FILL_ALPHA));
  }
  function applyOwnListHighlights(row, message2) {
    if (message2.systemEvent) {
      clearOwnListHighlights(row);
      return;
    }
    const jumpFlashActive = row.classList.contains(JUMP_HIGHLIGHT_CLASS);
    const state2 = computeHighlightForMessage(message2, jumpFlashActive);
    clearOwnListHighlights(row);
    if (state2.roleBar === "vip") row.classList.add(ROLE_VIP_CLASS);
    else if (state2.roleBar === "moderator") row.classList.add(ROLE_MOD_CLASS);
    if (state2.roleFill) row.classList.add(ROLE_FILL_CLASS);
    if (state2.personal === "mention") row.classList.add(MENTION_ME_CLASS);
    if (state2.personal === "reply") row.classList.add(REPLY_ME_CLASS);
    const style = featureFlags.mentionHighlightStyle;
    if (state2.personal && (style === "fill" || style === "both")) row.classList.add(HL_FILL_CLASS);
    if (state2.personal && (style === "frame" || style === "both")) row.classList.add(HL_FRAME_CLASS);
    if (state2.personal === "reply") ensureReplyToMeMarker(row);
  }
  function clearOwnListHighlights(row) {
    row.classList.remove(...OWN_HIGHLIGHT_CLASSES);
    row.querySelector(`.${REPLY_ME_MARK_CLASS}`)?.remove();
    row.querySelector(`.${REPLY_TO_ME_CONTEXT_CLASS}`)?.classList.remove(REPLY_TO_ME_CONTEXT_CLASS);
  }
  function ensureReplyToMeMarker(row) {
    const existing = row.querySelector(".kickflow-message__reply-context");
    if (existing) {
      existing.classList.add(REPLY_TO_ME_CONTEXT_CLASS);
      return;
    }
    if (row.querySelector(`.${REPLY_ME_MARK_CLASS}`)) return;
    const mark = document.createElement("span");
    mark.className = REPLY_ME_MARK_CLASS;
    mark.textContent = "\u21A9";
    mark.setAttribute("aria-hidden", "true");
    row.insertBefore(mark, row.firstChild);
  }
  function applyNativeHighlights(row, message2) {
    clearNativeHighlightStyles(row);
    if (message2.systemEvent) return;
    const jumpFlashActive = row.classList.contains(JUMP_HIGHLIGHT_CLASS);
    const state2 = computeHighlightForMessage(message2, jumpFlashActive);
    const color = featureFlags.mentionHighlightColor;
    const styleMode = featureFlags.mentionHighlightStyle;
    const shadows = [];
    if (state2.roleBar === "vip") {
      shadows.push(`inset ${ROLE_BAR_WIDTH_PX}px 0 0 ${rgbaFromHex(featureFlags.vipFrameColor, ROLE_BAR_ALPHA)}`);
    } else if (state2.roleBar === "moderator") {
      shadows.push(`inset ${ROLE_BAR_WIDTH_PX}px 0 0 ${rgbaFromHex(featureFlags.modFrameColor, ROLE_BAR_ALPHA)}`);
    }
    if (state2.roleFill === "vip") {
      shadows.push(`inset 0 0 0 9999px ${rgbaFromHex(featureFlags.vipFrameColor, ROLE_FILL_ALPHA)}`);
    } else if (state2.roleFill === "moderator") {
      shadows.push(`inset 0 0 0 9999px ${rgbaFromHex(featureFlags.modFrameColor, ROLE_FILL_ALPHA)}`);
    }
    if (state2.fill) {
      shadows.push(`inset 0 0 0 9999px ${personalFillRgba(color, fillStyleForNative(styleMode))}`);
    }
    if (state2.outline) {
      row.style.outline = `2px solid ${personalOutlineRgba(color)}`;
      row.style.outlineOffset = "1px";
    }
    if (shadows.length > 0) {
      row.style.boxShadow = shadows.join(", ");
    }
    if (state2.personal === "reply") ensureReplyToMeMarker(row);
  }
  function fillStyleForNative(style) {
    return style === "fill" ? "fill" : "both";
  }
  function clearNativeHighlightStyles(row) {
    row.style.outline = "";
    row.style.outlineOffset = "";
    row.style.boxShadow = "";
    row.querySelector(`.${REPLY_ME_MARK_CLASS}`)?.remove();
    row.querySelector(`.${REPLY_TO_ME_CONTEXT_CLASS}`)?.classList.remove(REPLY_TO_ME_CONTEXT_CLASS);
  }
  function refreshMessageHighlights() {
    syncHighlightCssVars();
    const store = activeHighlightStore;
    const list = document.getElementById(OWN_LIST_ID);
    if (list && store) {
      list.querySelectorAll("[data-message-id]").forEach((row) => {
        const id = row.dataset.messageId;
        if (!id) return;
        const message2 = store.getMessageById(id);
        if (message2) applyOwnListHighlights(row, message2);
      });
    }
  }

  // src/content/shared/hover-tooltip.ts
  var HOVER_TOOLTIP_CLASS = "kickflow-hover-tooltip";
  var HOVER_TOOLTIP_ATTRIBUTE = "data-kickflow-tooltip";
  var HOVER_TOOLTIP_VISIBLE_CLASS = `${HOVER_TOOLTIP_CLASS}--visible`;
  var HOVER_TOOLTIP_ANCHOR_SELECTOR = `[${HOVER_TOOLTIP_ATTRIBUTE}]`;
  var HOVER_TOOLTIP_ANCHOR_GAP_PX = 6;
  var HOVER_TOOLTIP_MAX_WIDTH_PX = 420;
  var HOVER_TOOLTIP_MAX_WIDTH_CSS_VARIABLE = "--kickflow-hover-tooltip-max-width";
  var HOVER_TOOLTIP_VIEWPORT_INSET_PX = 8;
  var HOVER_TOOLTIP_VIEWPORT_INSET_CSS_VARIABLE = "--kickflow-hover-tooltip-viewport-inset";
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }
  function fitsWithinViewport(start, size, viewportSize2) {
    return start >= 0 && start + size <= viewportSize2;
  }
  function resolveHoverTooltipPlacement(input) {
    const { anchorRect, tooltipSize, viewportSize: viewportSize2 } = input;
    const maxLeft = Math.max(0, viewportSize2.width - tooltipSize.width);
    const maxTop = Math.max(0, viewportSize2.height - tooltipSize.height);
    const centeredLeft = (anchorRect.left + anchorRect.right - tooltipSize.width) / 2;
    const left = clamp(centeredLeft, 0, maxLeft);
    const aboveTop = anchorRect.top - HOVER_TOOLTIP_ANCHOR_GAP_PX - tooltipSize.height;
    const belowTop = anchorRect.bottom + HOVER_TOOLTIP_ANCHOR_GAP_PX;
    if (fitsWithinViewport(aboveTop, tooltipSize.height, viewportSize2.height)) {
      return { left, top: aboveTop };
    }
    if (fitsWithinViewport(belowTop, tooltipSize.height, viewportSize2.height)) {
      return { left, top: belowTop };
    }
    const centeredTop = clamp(
      (anchorRect.top + anchorRect.bottom - tooltipSize.height) / 2,
      0,
      maxTop
    );
    const rightLeft = anchorRect.right + HOVER_TOOLTIP_ANCHOR_GAP_PX;
    if (fitsWithinViewport(rightLeft, tooltipSize.width, viewportSize2.width)) {
      return { left: rightLeft, top: centeredTop };
    }
    const leftLeft = anchorRect.left - HOVER_TOOLTIP_ANCHOR_GAP_PX - tooltipSize.width;
    if (fitsWithinViewport(leftLeft, tooltipSize.width, viewportSize2.width)) {
      return { left: leftLeft, top: centeredTop };
    }
    const touchingAboveTop = anchorRect.top - tooltipSize.height;
    if (fitsWithinViewport(touchingAboveTop, tooltipSize.height, viewportSize2.height)) {
      return { left, top: touchingAboveTop };
    }
    const touchingBelowTop = anchorRect.bottom;
    if (fitsWithinViewport(touchingBelowTop, tooltipSize.height, viewportSize2.height)) {
      return { left, top: touchingBelowTop };
    }
    const aboveRoom = Math.max(0, anchorRect.top);
    const belowRoom = Math.max(0, viewportSize2.height - anchorRect.bottom);
    const fallbackTop = aboveRoom >= belowRoom ? aboveTop : belowTop;
    return { left, top: clamp(fallbackTop, 0, maxTop) };
  }
  var sharedTooltip = null;
  var activeAnchor = null;
  var activeKeyHandler = null;
  var activeRepositionHandler = null;
  var activeMutationObserver = null;
  function ensureSharedTooltip() {
    if (!document.body) return null;
    if (!sharedTooltip) {
      sharedTooltip = document.createElement("div");
      sharedTooltip.className = HOVER_TOOLTIP_CLASS;
      sharedTooltip.setAttribute("aria-hidden", "true");
      sharedTooltip.style.setProperty(
        HOVER_TOOLTIP_MAX_WIDTH_CSS_VARIABLE,
        `${HOVER_TOOLTIP_MAX_WIDTH_PX}px`
      );
      sharedTooltip.style.setProperty(
        HOVER_TOOLTIP_VIEWPORT_INSET_CSS_VARIABLE,
        `${HOVER_TOOLTIP_VIEWPORT_INSET_PX}px`
      );
    }
    if (!sharedTooltip.isConnected) document.body.appendChild(sharedTooltip);
    return sharedTooltip;
  }
  function readAnchorRect(anchor) {
    const rect = anchor.getBoundingClientRect();
    const right = Number.isFinite(rect.right) && (rect.right !== 0 || rect.left === 0 && rect.width === 0) ? rect.right : rect.left + rect.width;
    const bottom = Number.isFinite(rect.bottom) && (rect.bottom !== 0 || rect.top === 0 && rect.height === 0) ? rect.bottom : rect.top + rect.height;
    return {
      left: rect.left,
      top: rect.top,
      right,
      bottom
    };
  }
  function hideTooltip(removeSharedElement = false) {
    if (!activeAnchor) return;
    activeAnchor = null;
    if (activeKeyHandler) {
      document.removeEventListener("keydown", activeKeyHandler);
      activeKeyHandler = null;
    }
    if (activeRepositionHandler) {
      window.removeEventListener("resize", activeRepositionHandler);
      window.removeEventListener("scroll", activeRepositionHandler, true);
      activeRepositionHandler = null;
    }
    activeMutationObserver?.disconnect();
    activeMutationObserver = null;
    sharedTooltip?.classList.remove(HOVER_TOOLTIP_VISIBLE_CLASS);
    if (removeSharedElement) {
      sharedTooltip?.remove();
      sharedTooltip = null;
    }
  }
  function positionTooltip(anchor) {
    const tooltip = ensureSharedTooltip();
    if (!tooltip) return;
    if (document.body.lastElementChild !== tooltip) document.body.appendChild(tooltip);
    const placement = resolveHoverTooltipPlacement({
      anchorRect: readAnchorRect(anchor),
      tooltipSize: {
        width: tooltip.getBoundingClientRect().width,
        height: tooltip.getBoundingClientRect().height
      },
      viewportSize: { width: window.innerWidth, height: window.innerHeight }
    });
    tooltip.style.left = `${placement.left}px`;
    tooltip.style.top = `${placement.top}px`;
  }
  function installActiveListeners(anchor) {
    activeKeyHandler = (event) => {
      if (event.key === "Escape") hideTooltip();
    };
    document.addEventListener("keydown", activeKeyHandler);
    activeRepositionHandler = () => {
      if (!anchor.isConnected || !anchor.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE)) {
        hideTooltip(true);
        return;
      }
      positionTooltip(anchor);
    };
    window.addEventListener("resize", activeRepositionHandler);
    window.addEventListener("scroll", activeRepositionHandler, true);
    if (document.body) {
      activeMutationObserver = new MutationObserver(() => {
        if (!anchor.isConnected || !anchor.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE)) hideTooltip(true);
      });
      activeMutationObserver.observe(document.body, {
        attributes: true,
        attributeFilter: [HOVER_TOOLTIP_ATTRIBUTE],
        childList: true,
        subtree: true
      });
    }
  }
  function showTooltip(anchor) {
    const label = anchor.getAttribute(HOVER_TOOLTIP_ATTRIBUTE);
    if (label === null || label.trim() === "" || !anchor.isConnected) {
      if (activeAnchor === anchor) hideTooltip(true);
      return;
    }
    const isNewAnchor = activeAnchor !== anchor;
    if (isNewAnchor && activeAnchor) hideTooltip();
    const tooltip = ensureSharedTooltip();
    if (!tooltip) return;
    activeAnchor = anchor;
    tooltip.textContent = label;
    positionTooltip(anchor);
    tooltip.classList.add(HOVER_TOOLTIP_VISIBLE_CLASS);
    if (isNewAnchor) installActiveListeners(anchor);
  }
  function resolveTooltipAnchor(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(HOVER_TOOLTIP_ANCHOR_SELECTOR);
  }
  function installDelegatedListeners() {
    if (typeof document === "undefined") return;
    const tooltipDocument = document;
    if (tooltipDocument.__kickflowHoverTooltipInstalled) return;
    tooltipDocument.__kickflowHoverTooltipInstalled = true;
    document.addEventListener("mouseover", (event) => {
      const anchor = resolveTooltipAnchor(event.target);
      if (!anchor || resolveTooltipAnchor(event.relatedTarget) === anchor) return;
      showTooltip(anchor);
    });
    document.addEventListener("mouseout", (event) => {
      if (activeAnchor && resolveTooltipAnchor(event.relatedTarget) !== activeAnchor) hideTooltip();
    });
    document.addEventListener("focusin", (event) => {
      const anchor = resolveTooltipAnchor(event.target);
      if (anchor) showTooltip(anchor);
    });
    document.addEventListener("focusout", (event) => {
      if (activeAnchor && resolveTooltipAnchor(event.relatedTarget) !== activeAnchor) hideTooltip();
    });
  }
  installDelegatedListeners();

  // src/content/chat/timestamp.ts
  var TWO_DIGIT_WIDTH = 2;
  var SECONDS_PER_MINUTE = 60;
  var MINUTES_PER_HOUR2 = 60;
  var SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR2;
  var liveTimeFormatter = null;
  function formatLiveChatTimestamp(createdAt) {
    const date = new Date(createdAt);
    if (!Number.isFinite(date.getTime())) return "";
    liveTimeFormatter ??= new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit" });
    return liveTimeFormatter.format(date);
  }
  var padTwoDigits = (value) => String(value).padStart(TWO_DIGIT_WIDTH, "0");
  function formatVodReplayTimestamp(createdAt, vodStartTimeMs) {
    const messageTimeMs = Date.parse(createdAt);
    if (!Number.isFinite(messageTimeMs) || !Number.isFinite(vodStartTimeMs)) return "";
    const elapsedMs = messageTimeMs - vodStartTimeMs;
    if (elapsedMs < 0) return "";
    const elapsedSeconds = Math.floor(elapsedMs / 1e3);
    const hours = Math.floor(elapsedSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor(
      elapsedSeconds % SECONDS_PER_HOUR / SECONDS_PER_MINUTE
    );
    const seconds = elapsedSeconds % SECONDS_PER_MINUTE;
    if (hours === 0) return `${padTwoDigits(minutes)}:${padTwoDigits(seconds)}`;
    return `${padTwoDigits(hours)}:${padTwoDigits(minutes)}:${padTwoDigits(seconds)}`;
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

  // src/content/chat/reply-action.ts
  function snapshotReplyTarget(message2) {
    return {
      ...message2,
      sender: { ...message2.sender, identity: {
        ...message2.sender.identity,
        badges: message2.sender.identity.badges.map((badge2) => ({ ...badge2 })),
        badgesV2: message2.sender.identity.badgesV2.map((badge2) => ({ ...badge2 }))
      } },
      ...message2.replyContext ? { replyContext: { ...message2.replyContext } } : {}
    };
  }
  function updateReplyAvailability(cue) {
    const blocked = nativeChatReplyBlock(cue.ownerDocument);
    if (blocked) {
      cue.setAttribute("aria-disabled", "true");
      cue.title = t(`chat.reply_${blocked}`);
    } else {
      cue.removeAttribute("aria-disabled");
      cue.title = cue.getAttribute("aria-label") ?? "";
    }
    return blocked;
  }
  function replyFailureText(result) {
    if (result === null) return `${t("chat.reply_no_bridge")} [no-bridge]`;
    if (result === "wrong-room") return `${t("chat.reply_wrong_room")} [wrong-room]`;
    return `${t("chat.reply_unavailable")} [${result}]`;
  }
  function requestNativeReply(message2, cue, sessionKey) {
    const context = message2.replyContext;
    const native = {
      id: message2.id,
      chatroom_id: message2.chatroomId,
      content: message2.content,
      created_at: message2.createdAt,
      type: message2.type === "reply" ? "reply" : "message",
      sender: {
        id: message2.sender.id,
        username: message2.sender.username,
        slug: message2.sender.slug,
        identity: {
          color: message2.sender.identity.color,
          badges: message2.sender.identity.badges.map((badge2) => ({ type: badge2.type, count: badge2.count }))
        }
      },
      thread_parent_id: context?.threadParentId ?? null,
      ...context ? { metadata: {
        original_sender: { id: context.replyToUserId ?? null, username: context.replyToUser },
        original_message: { id: context.replyToMessageId ?? null, content: context.replyToText }
      } } : {}
    };
    cue.removeAttribute(REPLY_RESULT_ATTRIBUTE);
    const blocked = updateReplyAvailability(cue);
    if (blocked) cue.setAttribute(REPLY_RESULT_ATTRIBUTE, blocked);
    else cue.dispatchEvent(new CustomEvent(REPLY_REQUEST_EVENT, { bubbles: true, detail: JSON.stringify({ sessionKey, message: native }) }));
    const selected = cue.getAttribute(REPLY_RESULT_ATTRIBUTE) === "selected";
    const row = cue.closest(".kickflow-message");
    let status2 = row?.querySelector(".kickflow-message__reply-status");
    if (selected) status2?.remove();
    else if (row) {
      if (!status2) {
        status2 = document.createElement("span");
        status2.className = "kickflow-message__reply-status";
        status2.setAttribute("role", "status");
        row.append(status2);
      }
      status2.textContent = blocked ? t(`chat.reply_${blocked}`) : replyFailureText(cue.getAttribute(REPLY_RESULT_ATTRIBUTE));
    }
    return selected;
  }

  // src/content/chat/message-view.ts
  var MESSAGE_CLASS = "kickflow-message";
  var PRESERVED_CLASS = "kickflow-preserved";
  var BANNED_CLASS = "kickflow-banned";
  var TIMEOUT_CLASS = "kickflow-timeout";
  var DELETED_CLASS = "kickflow-deleted";
  var EVENT_ROW_CLASS = "kickflow-event-row";
  var MOD_ACTION_KIND_CLASS_PREFIX = "kickflow-modaction-kind--";
  var MOD_ACTION_SURFACE_CLASS = "kickflow-modaction-surface";
  var MOD_ACTION_BULK_CLASS = `${EVENT_ROW_CLASS}--mod-action-bulk`;
  var MOD_ACTION_JUMP_CONTROL_CLASS = `${EVENT_ROW_CLASS}__jump-control`;
  var GIFT_RECIPIENTS_SHOWN_MAX = 3;
  var FALLBACK_IDENTITY_COLORS = [
    "#F472B6",
    "#FB7185",
    "#FB923C",
    "#FACC15",
    "#A3E635",
    "#4ADE80",
    "#2DD4BF",
    "#22D3EE",
    "#60A5FA",
    "#818CF8",
    "#A78BFA",
    "#E879F9"
  ];
  function fallbackIdentityColor(username) {
    const normalized = normalizeChatIdentity(username);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index++) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return FALLBACK_IDENTITY_COLORS[(hash >>> 0) % FALLBACK_IDENTITY_COLORS.length];
  }
  function identityColor(username) {
    return getSeenChatIdentityColor(username) || fallbackIdentityColor(username);
  }
  function wireEventProfileIdentity(element, username) {
    wireProfileSlugLink(
      element,
      username.toLowerCase(),
      username,
      "kickflow-event-row__identity--link",
      null
    );
  }
  function styleAndWireEventIdentity(element, username) {
    element.style.color = identityColor(username);
    wireEventProfileIdentity(element, username);
  }
  function createMessageJumpControl(name, messageId, jump) {
    const control = document.createElement("span");
    control.className = MOD_ACTION_JUMP_CONTROL_CLASS;
    control.setAttribute("role", "button");
    control.tabIndex = 0;
    const label = t("modaction.target_jump_title", { name });
    control.setAttribute("aria-label", label);
    control.title = label;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u2197";
    control.appendChild(icon);
    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      jump(messageId, control);
    };
    control.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      activate(event);
    });
    control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      activate(event);
    });
    return control;
  }
  var EMOTE_URL_PREFIX = "https://files.kick.com/emotes/";
  var EMOTE_URL_SUFFIX = "/fullsize";
  var TRUSTED_IMAGE_HOST2 = "kick.com";
  var TRUSTED_IMAGE_HOST_SUFFIX2 = ".kick.com";
  function isTrustedBadgeImageUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    if (url.hostname !== TRUSTED_IMAGE_HOST2 && !url.hostname.endsWith(TRUSTED_IMAGE_HOST_SUFFIX2)) return null;
    return url;
  }
  function isAllowedLinkUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  }
  function appendEmote(parent, id, name, rawToken) {
    if (!/^\d+$/.test(id)) {
      parent.appendChild(document.createTextNode(rawToken));
      return;
    }
    const img = document.createElement("img");
    img.src = `${EMOTE_URL_PREFIX}${id}${EMOTE_URL_SUFFIX}`;
    img.alt = name;
    img.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, name);
    img.className = "kickflow-emote";
    img.dataset.emoteId = id;
    img.loading = "lazy";
    const box = document.createElement("span");
    box.className = "kickflow-emote-box";
    box.appendChild(img);
    parent.appendChild(box);
  }
  function appendUrlTextWithBreakHints(parent, url) {
    const segments = url.split(/(?<=\/)/);
    segments.forEach((segment, index) => {
      parent.appendChild(document.createTextNode(segment));
      if (index < segments.length - 1) parent.appendChild(document.createElement("wbr"));
    });
  }
  function appendLink(parent, rawUrl) {
    const url = isAllowedLinkUrl(rawUrl);
    if (!url) {
      parent.appendChild(document.createTextNode(rawUrl));
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url.href;
    appendUrlTextWithBreakHints(anchor, rawUrl);
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.className = "kickflow-link";
    anchor.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openInNewTab(url.href);
    });
    parent.appendChild(anchor);
  }
  function wireProfileSlugLink(element, slug, displayName, linkClass, userId, nativeUsername = slug) {
    if (!isSafeKickSlug(slug)) return;
    const profileUrl = `https://kick.com/${slug}`;
    element.classList.add(linkClass);
    element.setAttribute("role", "link");
    element.tabIndex = 0;
    const act = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) {
        openInNewTab(profileUrl);
      } else {
        void openUserCard(slug, displayName, event.clientX, event.clientY, userId, nativeUsername);
      }
    };
    element.addEventListener("click", (event) => {
      if (event.button === 0) act(event);
    });
    element.addEventListener("auxclick", (event) => {
      if (event.button === 1) act(event);
    });
    element.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = element.getBoundingClientRect();
      void openUserCard(slug, displayName, rect.left, rect.bottom, userId, nativeUsername);
    });
  }
  function appendMention(parent, rawMention) {
    const span = document.createElement("span");
    span.className = "kickflow-mention";
    span.textContent = rawMention;
    const displayName = rawMention.slice(1);
    span.style.setProperty("--kf-mention-color", identityColor(displayName));
    wireProfileSlugLink(span, displayName.toLowerCase(), displayName, "kickflow-mention--link", null);
    parent.appendChild(span);
  }
  function wireNativeEmoteClicks(content, messageId) {
    content.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const emote = target.closest("img.kickflow-emote[data-emote-id]");
      if (!emote || !content.contains(emote)) return;
      const nativeRow = findMainNativeRow(messageId);
      const nativeEmote = Array.from(nativeRow?.querySelectorAll("[data-emote-id] img") ?? []).find((image) => image.closest("[data-emote-id]")?.dataset.emoteId === emote.dataset.emoteId);
      if (!nativeEmote) return;
      event.stopPropagation();
      nativeEmote.click();
    });
  }
  function wireUsernameProfileLink(username, sender, displayName, linkClass) {
    wireProfileSlugLink(username, sender.slug, displayName, linkClass, sender.id, sender.username);
  }
  function groupMessageIdentity(badges, username) {
    const identity = document.createElement("span");
    identity.className = "kickflow-message__identity";
    identity.append(badges, username);
    return identity;
  }
  function createMessageSeparator() {
    const separator = document.createElement("span");
    separator.className = "kickflow-message__separator";
    separator.textContent = ":\xA0";
    separator.setAttribute("aria-hidden", "true");
    return separator;
  }
  function appendParsedContent(parent, content, opts) {
    const compact = opts?.compact ?? false;
    let lastIndex = 0;
    for (const match of content.matchAll(CONTENT_TOKEN_RE)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        parent.appendChild(document.createTextNode(content.slice(lastIndex, index)));
      }
      const groups = match.groups ?? {};
      if (groups.emoteId) {
        appendEmote(parent, groups.emoteId, groups.emoteName ?? "", match[0]);
      } else if (groups.url) {
        if (compact) {
          parent.appendChild(document.createTextNode(groups.url));
        } else {
          appendLink(parent, groups.url);
        }
      } else if (groups.mention) {
        if (compact) {
          const span = document.createElement("span");
          span.className = "kickflow-mention";
          span.textContent = groups.mention;
          parent.appendChild(span);
        } else {
          appendMention(parent, groups.mention);
        }
      }
      lastIndex = index + match[0].length;
    }
    if (lastIndex < content.length) {
      parent.appendChild(document.createTextNode(content.slice(lastIndex)));
    }
  }
  function contentToPlainText(content) {
    return content.replace(EMOTE_TOKEN_RE, "$1");
  }
  var ROLE_BADGE_FALLBACK_STYLES = {
    broadcaster: { glyph: "\u2605" },
    founder: { glyph: "\u265B" },
    sidekick: { glyph: "\u2726" },
    bot: { glyph: "\u2699" },
    trainwreckstv: { glyph: "\u25B2" }
  };
  var SUBSCRIBER_FALLBACK_STYLE = { glyph: "\u2605" };
  var subscriberBadges = [];
  function setSubscriberBadges(badges) {
    subscriberBadges = badges;
  }
  function resolveSubscriberBadge(count) {
    if (!count || !subscriberBadges.length) return null;
    let match = null;
    for (const b of subscriberBadges) {
      if (count >= b.months) match = b;
      else break;
    }
    return match;
  }
  function appendRoleBadge(parent, label, style, badge2, onActivate) {
    const count = badge2.count;
    const chip = document.createElement("span");
    chip.className = "kickflow-badge-role";
    const tooltipLabel = badge2.type === "subscriber" && count ? t("badge.subscriber_months", { n: count }) : label + (count ? ` (${count})` : "");
    chip.setAttribute("aria-label", tooltipLabel);
    chip.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, tooltipLabel);
    applyBadgePresentation(chip, onActivate);
    const glyph = document.createElement("span");
    glyph.textContent = style.glyph;
    chip.appendChild(glyph);
    if (count) {
      const countEl = document.createElement("span");
      countEl.className = "kickflow-badge-role__count";
      countEl.textContent = String(count);
      chip.appendChild(countEl);
    }
    parent.appendChild(chip);
  }
  function appendBadges(parent, badges, messageId) {
    for (const badge2 of badges) {
      const onActivate = messageId ? () => forwardNativeBadgeClick(messageId, badge2) : void 0;
      if (badge2.imageUrl) {
        const url = isTrustedBadgeImageUrl(badge2.imageUrl);
        if (url) {
          const img = document.createElement("img");
          img.src = url.href;
          const label2 = badge2.level != null ? t("badge.level", { n: badge2.level }) : badge2.name || badge2.text || t("badge.badge");
          img.alt = label2;
          img.className = "kickflow-badge-icon";
          img.loading = "lazy";
          img.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label2);
          applyBadgePresentation(img, onActivate);
          parent.appendChild(img);
          continue;
        }
      }
      const asset = badge2.type ? ROLE_BADGE_ASSETS[badge2.type] : void 0;
      if (asset) {
        const img = document.createElement("img");
        img.src = asset.uri;
        const baseLabel = roleBadgeLabel(badge2.type, asset.label);
        const label2 = badge2.type === "sub_gifter" && badge2.count ? `${baseLabel} (${badge2.count})` : baseLabel;
        img.alt = label2;
        img.className = "kickflow-badge-icon";
        img.loading = "lazy";
        img.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label2);
        applyBadgePresentation(img, onActivate);
        parent.appendChild(img);
        continue;
      }
      if (badge2.type === "subscriber") {
        const sub = resolveSubscriberBadge(badge2.count);
        const subUrl = sub ? isTrustedBadgeImageUrl(sub.src) : null;
        if (subUrl) {
          const img = document.createElement("img");
          img.src = subUrl.href;
          const label2 = badge2.count ? t("badge.subscriber_months", { n: badge2.count }) : t("badge.subscriber");
          img.alt = label2;
          img.className = "kickflow-badge-icon";
          img.loading = "lazy";
          img.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label2);
          applyBadgePresentation(img, onActivate);
          parent.appendChild(img);
        } else {
          appendRoleBadge(parent, t("badge.subscriber"), SUBSCRIBER_FALLBACK_STYLE, badge2, onActivate);
        }
        continue;
      }
      const fallbackStyle = badge2.type ? ROLE_BADGE_FALLBACK_STYLES[badge2.type] : void 0;
      if (fallbackStyle) {
        const label2 = roleBadgeLabel(badge2.type, badge2.type && ROLE_BADGE_FALLBACK_LABELS[badge2.type] || badge2.type || "");
        appendRoleBadge(parent, label2, fallbackStyle, badge2, onActivate);
        continue;
      }
      const label = badge2.text || badge2.name || badge2.type;
      if (label) {
        const span = document.createElement("span");
        span.className = "kickflow-badge-text";
        span.textContent = label;
        span.setAttribute("aria-label", label);
        span.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label);
        applyBadgePresentation(span, onActivate);
        parent.appendChild(span);
      }
    }
    describeBadgeGroup(parent);
  }
  function forwardNativeBadgeClick(messageId, badge2) {
    const row = Array.from(document.querySelectorAll("#chatroom-messages [data-kickflow-mid]")).find((element) => element.dataset.kickflowMid === messageId);
    if (!row) return;
    const typeTarget = badge2.type ? Array.from(row.querySelectorAll("[data-testid]")).find((element) => element.dataset.testid === `identity-badge-${badge2.type}`) : void 0;
    const levelTarget = badge2.level != null ? Array.from(row.querySelectorAll("svg[data-ds-icon]")).find((element) => element.getAttribute("data-ds-icon") === `Level${badge2.level}`) : void 0;
    const imageTarget = badge2.imageUrl ? Array.from(row.querySelectorAll("img")).find((element) => element.src.split("?")[0] === badge2.imageUrl.split("?")[0]) : void 0;
    const target = typeTarget?.querySelector("img, svg") ?? typeTarget ?? levelTarget ?? imageTarget;
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  }
  function roleBadgeLabel(type, fallback) {
    const keys = {
      moderator: "badge.moderator",
      vip: "badge.vip",
      og: "badge.og",
      sub_gifter: "badge.gift_subscriber",
      verified: "badge.verified_streamer",
      staff: "badge.kick_staff",
      broadcaster: "badge.broadcaster",
      founder: "badge.founder",
      sidekick: "badge.sidekick",
      bot: "badge.bot",
      trainwreckstv: "badge.trainwreckstv"
    };
    return type && keys[type] ? t(keys[type]) : fallback;
  }
  function appendStatusLabel(row, text, modifier) {
    const label = document.createElement("span");
    label.className = `kickflow-status-label kickflow-status-label--${modifier}`;
    label.textContent = text;
    const identity = row.querySelector(".kickflow-message__identity");
    if (identity) identity.append(label);
    else row.appendChild(label);
  }
  function formatTimeoutDuration(min) {
    return formatDurationMinutes(min, getLang());
  }
  function appendModLabel(row, mod) {
    if (!mod) return;
    const span = document.createElement("span");
    span.className = "kickflow-mod-label";
    span.textContent = `\xB7 ${mod}`;
    (row.querySelector(".kickflow-status-label") ?? row).appendChild(span);
  }
  function deleteAttribution(meta) {
    if (meta.deletedBy) return meta.deletedBy;
    if (meta.aiModerated === true) {
      const rules = (meta.violatedRules ?? []).filter(Boolean);
      const ai = t("message.deleted_by.ai");
      return rules.length ? `${ai} (${rules.join(", ")})` : ai;
    }
    if (meta.aiModerated === false) return t("message.deleted_by.mod");
    return null;
  }
  function applyPreservedMarking(row, message2) {
    if (!message2.preserved) return;
    row.querySelector(".kickflow-message__reply-action")?.remove();
    row.querySelector(".kickflow-message__reply-status")?.remove();
    row.classList.remove("kickflow-message--can-reply");
    clearPreservedMarking(row);
    row.classList.add(PRESERVED_CLASS);
    const meta = message2.preservedMeta ?? {};
    if (message2.preservedReason === "banned") {
      if (meta.permanent === false) {
        row.classList.add(TIMEOUT_CLASS);
        const dur = formatTimeoutDuration(meta.durationMin);
        appendStatusLabel(row, dur ? `${t("message.timeout")} ${dur}` : t("message.timeout"), "timeout");
        appendModLabel(row, meta.bannedBy);
      } else if (meta.permanent === true) {
        row.classList.add(BANNED_CLASS);
        appendStatusLabel(row, t("message.banned"), "banned");
        appendModLabel(row, meta.bannedBy);
      } else {
        appendStatusLabel(row, t("message.moderation_unknown"), "unknown");
        appendModLabel(row, meta.bannedBy);
      }
    } else if (message2.preservedReason === "deleted") {
      row.classList.add(DELETED_CLASS);
      appendStatusLabel(row, t("message.deleted"), "deleted");
      appendModLabel(row, deleteAttribution(meta));
    }
  }
  function clearPreservedMarking(row) {
    row.classList.remove(PRESERVED_CLASS, BANNED_CLASS, TIMEOUT_CLASS, DELETED_CLASS);
    row.querySelectorAll(".kickflow-status-label, .kickflow-mod-label").forEach((node) => node.remove());
  }
  function threadGlyph() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M3.5 4h13v9h-7l-4 3.5V13h-2Z");
    svg.append(path);
    return svg;
  }
  function createThreadButton(messageId, reply) {
    const button = document.createElement("span");
    button.className = "kickflow-message__thread-open";
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.hidden = true;
    const label = t("chat.thread_open");
    button.setAttribute("aria-label", label);
    button.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label);
    button.append(threadGlyph());
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openNativeThread(messageId)) return;
      button.hidden = true;
      playMissCue(reply);
    };
    button.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      open(event);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      open(event);
    });
    return button;
  }
  function appendReplyContext(row, message2) {
    const context = message2.replyContext;
    if (!context || !context.replyToUser && !context.replyToText) return;
    const reply = document.createElement("span");
    reply.className = "kickflow-message__reply-context";
    const icon = document.createElement("span");
    icon.className = "kickflow-message__reply-icon";
    icon.textContent = "\u21A9";
    reply.appendChild(icon);
    const text = document.createElement("span");
    text.className = "kickflow-message__reply-text";
    if (context.replyToUser) {
      const user = document.createElement("span");
      user.className = "kickflow-message__reply-user";
      user.textContent = context.replyToUser;
      user.title = context.replyToUser;
      user.style.color = identityColor(context.replyToUser);
      text.appendChild(user);
      if (context.replyToText) {
        const separator = document.createElement("span");
        separator.className = "kickflow-message__reply-separator";
        separator.textContent = ": ";
        text.appendChild(separator);
      }
    }
    if (context.replyToText) {
      const snippet = document.createElement("span");
      snippet.className = "kickflow-message__reply-snippet";
      appendParsedContent(snippet, context.replyToText, { compact: true });
      text.appendChild(snippet);
    }
    reply.appendChild(text);
    const replyPlain = context.replyToText ? contentToPlainText(context.replyToText) : "";
    const replyLabel = context.replyToUser && replyPlain ? `${context.replyToUser}: ${replyPlain}` : replyPlain || context.replyToUser || "";
    reply.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, replyLabel);
    const replyToMessageId = context.replyToMessageId ?? null;
    reply.setAttribute("role", "button");
    reply.tabIndex = 0;
    const jumpOrOpenThread = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const jumped = replyToMessageId !== null && jumpToMessage(replyToMessageId, reply);
      if (jumped) return;
      if (replyToMessageId === null) playMissCue(reply);
      openNativeThread(message2.id);
    };
    reply.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      jumpOrOpenThread(event);
    });
    reply.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      jumpOrOpenThread(event);
    });
    const threadButton = createThreadButton(message2.id, reply);
    reply.appendChild(threadButton);
    const refreshThreadButton = () => {
      threadButton.hidden = !nativeThreadAvailable(message2.id);
    };
    row.addEventListener("pointerenter", refreshThreadButton);
    reply.addEventListener("focusin", (event) => {
      if (event.target === reply) refreshThreadButton();
    });
    row.appendChild(reply);
  }
  function lineGlyph(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const paths = {
      subscription: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
      "gifted-subscription": "M4 10h16v11H4ZM3 6h18v4H3Zm9 0v15M12 6C5 6 6 0 9 2Zm0 0c7 0 6-6 3-4Z",
      kicks: "M5 4v16M8 12l10-8M8 12l10 8",
      host: "M3 9h6l10-5v16l-10-5H3Zm6 6 2 6",
      mode: "M4 7h16M4 17h16M8 4v6M16 14v6",
      "mod-action": "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z"
    };
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[kind] ?? paths.subscription);
    svg.append(path);
    return svg;
  }
  function buildSystemEventElement(message2, options = {}) {
    const event = message2.systemEvent;
    if (!event) throw new Error("buildSystemEventElement requires a system event");
    const row = document.createElement("div");
    row.className = `${MESSAGE_CLASS} ${EVENT_ROW_CLASS} ${EVENT_ROW_CLASS}--${event.kind}`;
    row.dataset.messageId = message2.id;
    row.dataset.createdAt = message2.createdAt;
    if (event.kind === "gap") {
      row.setAttribute("role", "separator");
      row.textContent = event.estimatedCount === null ? t("overlay.gap_time", { n: event.seconds }) : t("overlay.gap", { n: event.estimatedCount });
      return row;
    }
    if (event.kind === "mod-action") {
      row.classList.add(
        MOD_ACTION_SURFACE_CLASS,
        `${MOD_ACTION_KIND_CLASS_PREFIX}${event.actionKind}`
      );
    }
    const icon = event.kind === "mod-action" ? null : document.createElement("span");
    if (icon) {
      icon.className = `${EVENT_ROW_CLASS}__icon`;
      icon.append(lineGlyph(event.kind));
    }
    if (event.kind === "mode") {
      const text = document.createElement("span");
      text.className = `${EVENT_ROW_CLASS}__text`;
      text.textContent = event.text;
      if (icon) row.append(icon);
      row.append(text);
      return row;
    }
    const body = document.createElement("span");
    body.className = `${EVENT_ROW_CLASS}__body`;
    const appendCountTemplate = (key, value, formatted = String(value), params = {}, cursor = 0, leadingSpace = cursor === 0, trailingText = cursor === 0) => {
      const localized = t(key, { ...params, n: value });
      const raw = String(value);
      const splitAt = localized.indexOf(raw, cursor);
      if (leadingSpace) body.appendChild(document.createTextNode(" "));
      if (splitAt < 0) {
        body.appendChild(document.createTextNode(localized.slice(cursor)));
        return null;
      }
      body.appendChild(document.createTextNode(localized.slice(cursor, splitAt)));
      const count = document.createElement("span");
      count.className = `${EVENT_ROW_CLASS}__count`;
      count.textContent = formatted;
      body.appendChild(count);
      if (trailingText) body.appendChild(document.createTextNode(localized.slice(splitAt + raw.length)));
      return count;
    };
    if (event.kind === "mod-action") {
      const moderatorToken = "__kickflow_moderator__";
      const victimToken = "__kickflow_victim__";
      const firstVictim = event.victims[0] ?? { name: "unknown user", messageId: null };
      const jump = options.onJumpToMessage ?? ((messageId, cue) => jumpToMessage(messageId, cue));
      const tag = document.createElement(options.onOpenRemovedPanel ? "button" : "span");
      tag.className = `${EVENT_ROW_CLASS}__kind-tag`;
      tag.dataset.kickflowRole = "action-kind";
      if (tag instanceof HTMLButtonElement) {
        tag.type = "button";
        tag.setAttribute("aria-label", t("tab.removed"));
        tag.title = t("tab.removed");
        tag.addEventListener("click", (eventObject) => {
          eventObject.preventDefault();
          eventObject.stopPropagation();
          options.onOpenRemovedPanel?.();
        });
      } else tag.setAttribute("aria-hidden", "true");
      tag.append(lineGlyph("mod-action"));
      body.append(tag);
      const createModerator = () => {
        const moderator2 = event.moderator?.trim();
        if (!moderator2) return null;
        const actor2 = document.createElement("span");
        actor2.className = `${EVENT_ROW_CLASS}__actor`;
        actor2.dataset.kickflowRole = "moderator";
        const name = document.createElement("span");
        name.className = `${EVENT_ROW_CLASS}__username ${EVENT_ROW_CLASS}__moderator`;
        name.dataset.kickflowRole = "moderator-name";
        name.textContent = moderator2;
        name.title = t("modaction.moderator_profile_title", { name: moderator2 });
        wireEventProfileIdentity(name, moderator2);
        actor2.append(name);
        return actor2;
      };
      const createVictimContent = (victim) => {
        const name = victim.name || "unknown user";
        const nameElement = document.createElement("span");
        nameElement.className = `${EVENT_ROW_CLASS}__victim`;
        nameElement.dataset.kickflowRole = "target";
        nameElement.textContent = name;
        nameElement.title = t("modaction.target_profile_title", { name });
        styleAndWireEventIdentity(nameElement, name);
        const action = document.createElement("span");
        action.className = `${EVENT_ROW_CLASS}__victim-action`;
        action.appendChild(nameElement);
        if (victim.messageId !== null) {
          action.appendChild(createMessageJumpControl(name, victim.messageId, jump));
        }
        const content = document.createDocumentFragment();
        content.appendChild(action);
        return content;
      };
      const appendTemplate = (key2, params, parts2) => {
        const localized = t(key2, params);
        let cursor = 0;
        for (const part of parts2) {
          if ("count" in part) {
            const rawCount = String(part.count);
            const splitAt2 = localized.indexOf(rawCount, cursor);
            appendCountTemplate(
              key2,
              part.count,
              part.formatted,
              params,
              cursor,
              false,
              false
            );
            cursor = splitAt2 < 0 ? localized.length : splitAt2 + rawCount.length;
            continue;
          }
          const splitAt = localized.indexOf(part.token, cursor);
          if (splitAt < 0) {
            body.appendChild(document.createTextNode(localized.slice(cursor)));
            cursor = localized.length;
            break;
          }
          body.appendChild(document.createTextNode(localized.slice(cursor, splitAt)));
          body.appendChild(part.node);
          cursor = splitAt + part.token.length;
        }
        body.appendChild(document.createTextNode(localized.slice(cursor)));
      };
      const moderator = event.moderator?.trim();
      const hasModerator = Boolean(moderator);
      const single = event.count === 1;
      const actionKey = (kind, bulk, knownModerator, hasDuration2) => {
        if (kind === "ban") {
          if (bulk) return knownModerator ? "modaction.ban.bulk" : "modaction.ban.bulk.unknown";
          return knownModerator ? "modaction.ban.single" : "modaction.ban.single.unknown";
        }
        if (kind === "timeout") {
          if (bulk) {
            if (hasDuration2) return knownModerator ? "modaction.timeout.bulk.duration" : "modaction.timeout.bulk.duration.unknown";
            return knownModerator ? "modaction.timeout.bulk" : "modaction.timeout.bulk.unknown";
          }
          if (!hasDuration2) return knownModerator ? "modaction.timeout.single.no_duration" : "modaction.timeout.single.no_duration.unknown";
          return knownModerator ? "modaction.timeout.single" : "modaction.timeout.single.unknown";
        }
        if (kind === "unknown") {
          if (bulk) return knownModerator ? "modaction.unknown.bulk" : "modaction.unknown.bulk.no_moderator";
          return knownModerator ? "modaction.unknown.single" : "modaction.unknown.single.no_moderator";
        }
        if (bulk) return knownModerator ? "modaction.delete.bulk" : "modaction.delete.bulk.unknown";
        return knownModerator ? "modaction.delete.single" : "modaction.delete.single.unknown";
      };
      const duration = event.actionKind === "timeout" ? formatDurationMinutes(event.durationMin, getLang()) : "";
      const hasDuration = duration.length > 0;
      const key = actionKey(event.actionKind, !single, hasModerator, hasDuration);
      const durationToken = "__kickflow_duration__";
      const templateParams = {
        mod: moderatorToken,
        name: victimToken,
        duration: durationToken,
        n: event.count
      };
      const createDuration = () => {
        const element = document.createElement("span");
        element.className = `${EVENT_ROW_CLASS}__duration`;
        element.textContent = duration;
        return element;
      };
      const parts = [];
      if (hasModerator) {
        const moderatorElement = createModerator();
        if (moderatorElement) parts.push({ token: moderatorToken, node: moderatorElement });
      }
      if (single) {
        parts.push({ token: victimToken, node: createVictimContent(firstVictim) });
        if (hasDuration) {
          parts.push({ token: durationToken, node: createDuration() });
        }
      } else {
        parts.push({ count: event.count });
        if (hasDuration) {
          parts.push({ token: durationToken, node: createDuration() });
        }
      }
      appendTemplate(key, templateParams, parts);
      if (!single) {
        const preview = document.createElement("span");
        preview.className = `${EVENT_ROW_CLASS}__victims`;
        const shown = event.victims.slice(0, GIFT_RECIPIENTS_SHOWN_MAX);
        const hiddenKnown = event.victims.slice(shown.length);
        const unknownRemainder = Math.max(0, event.count - event.victims.length);
        const appendVictim = (victim, index) => {
          if (index > 0) preview.appendChild(document.createTextNode(", "));
          preview.appendChild(createVictimContent(victim));
        };
        shown.forEach(appendVictim);
        if (hiddenKnown.length > 0) {
          if (shown.length > 0) preview.appendChild(document.createTextNode(", "));
          const more = document.createElement("span");
          more.className = `${EVENT_ROW_CLASS}__more`;
          more.setAttribute("role", "button");
          more.tabIndex = 0;
          more.textContent = t("modaction.more", { n: event.count - shown.length });
          let expanded = false;
          const expand = (eventObject) => {
            if (expanded) return;
            expanded = true;
            eventObject.preventDefault();
            eventObject.stopPropagation();
            hiddenKnown.forEach((victim) => {
              preview.insertBefore(document.createTextNode(", "), more);
              preview.insertBefore(createVictimContent(victim), more);
            });
            if (unknownRemainder > 0) {
              more.removeAttribute("role");
              more.removeAttribute("tabindex");
              more.className = `${EVENT_ROW_CLASS}__remainder`;
              more.textContent = t("modaction.more", { n: unknownRemainder });
            } else {
              more.remove();
            }
          };
          more.addEventListener("click", expand);
          more.addEventListener("keydown", (eventObject) => {
            if (eventObject.key === "Enter" || eventObject.key === " ") expand(eventObject);
          });
          preview.appendChild(more);
        } else if (unknownRemainder > 0) {
          if (shown.length > 0) preview.appendChild(document.createTextNode(", "));
          preview.appendChild(document.createTextNode(t("modaction.more", { n: unknownRemainder })));
        }
        if (preview.childNodes.length > 0) body.append(document.createTextNode(" "), preview);
      }
      const openRemovedPanel = options.onOpenRemovedPanel;
      if (!single && openRemovedPanel) {
        row.classList.add(MOD_ACTION_BULK_CLASS);
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        const isNestedAction = (target) => target instanceof Element && target.closest(
          `.${EVENT_ROW_CLASS}__identity--link, .${MOD_ACTION_JUMP_CONTROL_CLASS}, .${EVENT_ROW_CLASS}__more`
        ) !== null;
        row.addEventListener("click", (eventObject) => {
          if (eventObject.button !== 0 || isNestedAction(eventObject.target)) return;
          eventObject.preventDefault();
          openRemovedPanel();
        });
        row.addEventListener("keydown", (eventObject) => {
          if (eventObject.target !== row || eventObject.key !== "Enter" && eventObject.key !== " ") return;
          eventObject.preventDefault();
          openRemovedPanel();
        });
      }
      row.append(body);
      return row;
    }
    const username = document.createElement("span");
    username.className = `${EVENT_ROW_CLASS}__username`;
    username.textContent = event.username;
    styleAndWireEventIdentity(username, event.username);
    body.appendChild(username);
    if (event.kind === "subscription") {
      if (event.months === 1) {
        body.appendChild(document.createTextNode(` ${t("event.subscription.new")}`));
      } else {
        appendCountTemplate("event.subscription.months", event.months);
      }
    } else if (event.kind === "gifted-subscription") {
      const recipients = event.giftedUsernames ?? [];
      if (event.giftCount === 1 && recipients.length === 1) {
        const localized = t("event.gift.single", { name: recipients[0] });
        const splitAt = localized.indexOf(recipients[0]);
        body.appendChild(document.createTextNode(localized.slice(0, splitAt)));
        const recipient = document.createElement("span");
        recipient.className = `${EVENT_ROW_CLASS}__recipient`;
        recipient.textContent = recipients[0];
        styleAndWireEventIdentity(recipient, recipients[0]);
        body.append(recipient, document.createTextNode(localized.slice(splitAt + recipients[0].length)));
      } else {
        const effectiveTotal = Math.max(event.giftCount, recipients.length);
        appendCountTemplate("event.gift.bulk", effectiveTotal);
        if (recipients.length > 0) {
          const preview = document.createElement("span");
          preview.className = `${EVENT_ROW_CLASS}__recipients`;
          const makeRecipient = (name) => {
            const recipient = document.createElement("span");
            recipient.className = `${EVENT_ROW_CLASS}__recipient`;
            recipient.textContent = name;
            styleAndWireEventIdentity(recipient, name);
            return recipient;
          };
          const shown = recipients.slice(0, GIFT_RECIPIENTS_SHOWN_MAX);
          shown.forEach((name, index) => {
            if (index > 0) preview.appendChild(document.createTextNode(", "));
            preview.appendChild(makeRecipient(name));
          });
          const hiddenKnown = recipients.slice(shown.length);
          const unknownRemainder = Math.max(0, effectiveTotal - recipients.length);
          if (hiddenKnown.length > 0) {
            const more = document.createElement("span");
            more.className = `${EVENT_ROW_CLASS}__more`;
            more.setAttribute("role", "button");
            more.setAttribute("tabindex", "0");
            more.textContent = t("event.gift.more", { n: effectiveTotal - shown.length });
            let expanded = false;
            const expand = () => {
              if (expanded) return;
              expanded = true;
              for (const name of hiddenKnown) {
                preview.insertBefore(document.createTextNode(", "), more);
                preview.insertBefore(makeRecipient(name), more);
              }
              if (unknownRemainder > 0) {
                more.removeAttribute("role");
                more.removeAttribute("tabindex");
                more.className = "";
                more.textContent = t("event.gift.more", { n: unknownRemainder });
              } else {
                more.remove();
              }
            };
            more.addEventListener("click", expand);
            more.addEventListener("keydown", (event2) => {
              if (event2.key === "Enter" || event2.key === " ") {
                event2.preventDefault();
                expand();
              }
            });
            preview.appendChild(more);
          } else if (unknownRemainder > 0) {
            preview.appendChild(document.createTextNode(t("event.gift.more", { n: unknownRemainder })));
          }
          body.append(document.createTextNode(": "), preview);
        }
      }
    } else if (event.kind === "kicks") {
      const count = appendCountTemplate("event.kicks", event.amount, formatNumber(event.amount));
      if (count) count.title = String(event.amount);
      if (event.giftName) {
        const gift = document.createElement("span");
        gift.className = `${EVENT_ROW_CLASS}__gift`;
        appendParsedContent(gift, event.giftName);
        body.append(document.createTextNode(" \xB7 "), gift);
      }
      if (event.senderMessage) {
        const note2 = document.createElement("span");
        note2.className = `${EVENT_ROW_CLASS}__note`;
        appendParsedContent(note2, event.senderMessage);
        body.append(document.createTextNode(" \u2014 "), note2);
      }
    } else if (event.numberViewers > 0) {
      appendCountTemplate("event.host.viewers", event.numberViewers, formatNumber(event.numberViewers));
    } else {
      body.appendChild(document.createTextNode(` ${t("event.host")}`));
    }
    if (icon) row.append(icon);
    row.append(body);
    return row;
  }
  function buildCelebrationElement(message2) {
    const celebration = message2.celebration;
    if (!celebration) throw new Error("buildCelebrationElement requires celebration metadata");
    const row = document.createElement("div");
    row.className = `${MESSAGE_CLASS} ${EVENT_ROW_CLASS} ${EVENT_ROW_CLASS}--celebration`;
    row.dataset.messageId = message2.id;
    row.dataset.createdAt = message2.createdAt;
    const icon = document.createElement("span");
    icon.className = `${EVENT_ROW_CLASS}__icon`;
    icon.append(lineGlyph("subscription"));
    const body = document.createElement("span");
    body.className = `${EVENT_ROW_CLASS}__body`;
    const headline = document.createElement("span");
    headline.className = "kickflow-celebration__headline";
    const headlineUsername = document.createElement("span");
    headlineUsername.className = `${EVENT_ROW_CLASS}__username`;
    const displayName = message2.sender.displayName || message2.sender.username;
    headlineUsername.textContent = displayName;
    wireUsernameProfileLink(headlineUsername, message2.sender, displayName, "kickflow-message__username--link");
    headlineUsername.style.color = message2.sender.identity.color || "inherit";
    headline.appendChild(headlineUsername);
    const localized = t("event.celebration.months", { n: celebration.totalMonths });
    const rawCount = String(celebration.totalMonths);
    const countIndex = localized.indexOf(rawCount);
    headline.appendChild(document.createTextNode(" "));
    if (countIndex < 0) {
      headline.appendChild(document.createTextNode(localized));
    } else {
      headline.appendChild(document.createTextNode(localized.slice(0, countIndex)));
      const count = document.createElement("span");
      count.className = `${EVENT_ROW_CLASS}__count`;
      count.textContent = rawCount;
      headline.append(count, document.createTextNode(localized.slice(countIndex + rawCount.length)));
    }
    const messageLine = document.createElement("span");
    messageLine.className = "kickflow-celebration__message";
    const badges = document.createElement("span");
    badges.className = "kickflow-message__badges";
    appendBadges(badges, mergeIdentityBadges(message2.sender.identity), message2.id);
    const author = document.createElement("span");
    author.className = "kickflow-celebration__author";
    author.textContent = displayName;
    wireUsernameProfileLink(author, message2.sender, displayName, "kickflow-message__username--link");
    author.style.color = message2.sender.identity.color || "inherit";
    const content = document.createElement("span");
    content.className = "kickflow-message__content";
    appendParsedContent(content, message2.content);
    messageLine.append(groupMessageIdentity(badges, author), createMessageSeparator(), content);
    body.append(headline, messageLine);
    row.append(icon, body);
    applyPreservedMarking(row, message2);
    applyOwnListHighlights(row, message2);
    return row;
  }
  function buildMessageElement(message2, options = {}) {
    if (message2.systemEvent) return buildSystemEventElement(message2, options);
    if (message2.celebration?.type === "subscription_renewed") return buildCelebrationElement(message2);
    const row = document.createElement("div");
    row.className = MESSAGE_CLASS;
    row.dataset.messageId = message2.id;
    row.dataset.createdAt = message2.createdAt;
    appendReplyContext(row, message2);
    const time = document.createElement("span");
    time.className = "kickflow-message__time";
    if (options.timestampText !== void 0) {
      time.textContent = options.timestampText;
    } else {
      time.textContent = formatLiveChatTimestamp(message2.createdAt);
    }
    const badges = document.createElement("span");
    badges.className = "kickflow-message__badges";
    appendBadges(badges, mergeIdentityBadges(message2.sender.identity), message2.id);
    const displayName = message2.sender.displayName || message2.sender.username;
    const username = document.createElement("span");
    username.className = "kickflow-message__username";
    username.textContent = displayName;
    wireUsernameProfileLink(username, message2.sender, displayName, "kickflow-message__username--link");
    username.style.color = message2.sender.identity.color || "inherit";
    const separator = createMessageSeparator();
    const content = document.createElement("span");
    content.className = "kickflow-message__content";
    appendParsedContent(content, message2.content);
    wireNativeEmoteClicks(content, message2.id);
    row.append(time, groupMessageIdentity(badges, username), separator, content);
    if (options.onReply && !message2.preserved && ["message", "reply"].includes(message2.type)) {
      const target = snapshotReplyTarget(message2);
      const reply = document.createElement("button");
      reply.type = "button";
      reply.className = "kickflow-message__reply-action";
      reply.setAttribute("aria-label", t("chat.reply_to", { name: displayName }));
      reply.title = t("chat.reply_to", { name: displayName });
      reply.textContent = "\u21A9";
      updateReplyAvailability(reply);
      reply.addEventListener("pointerenter", () => updateReplyAvailability(reply));
      reply.addEventListener("focus", () => updateReplyAvailability(reply));
      reply.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onReply(target, reply);
      });
      row.classList.add("kickflow-message--can-reply");
      row.append(reply);
    }
    applyPreservedMarking(row, message2);
    applyOwnListHighlights(row, message2);
    return row;
  }

  // src/content/chat/ban-guard.ts
  function notifyModAction(deps, action) {
    try {
      deps.onModAction?.(action);
    } catch (error) {
      logger.debug("ban-guard: onModAction callback threw", error);
    }
  }
  function newestMessage(messages2) {
    let newest = messages2[0];
    for (const message2 of messages2.slice(1)) {
      if ((message2.seq ?? 0) >= (newest.seq ?? 0)) newest = message2;
    }
    return newest;
  }
  function fallbackVictimName(payload) {
    const username = payload.username?.trim();
    return username || `user ${payload.userId}`;
  }
  function handleUserBanned(payload, deps) {
    const messages2 = deps.store.markUserBanned(payload.userId, {
      permanent: payload.permanent,
      durationMin: payload.durationMin,
      bannedBy: payload.bannedBy
    });
    const actionKind = payload.permanent === false ? "timeout" : payload.permanent === true ? "ban" : "unknown";
    if (messages2.length === 0) {
      notifyModAction(deps, {
        kind: actionKind,
        moderator: payload.bannedBy,
        victim: fallbackVictimName(payload),
        messageId: null,
        durationMin: actionKind === "timeout" ? payload.durationMin : null,
        at: Date.now()
      });
      logger.debug("ban-guard: no retained message for banned user", payload.userId);
      return;
    }
    let updatedCount = 0;
    for (const message2 of messages2) {
      if (deps.augmenter) {
        deps.augmenter.markById(message2.id);
        updatedCount++;
        continue;
      }
      const element = deps.registry?.getElementForMessageId(message2.id);
      if (!element) continue;
      applyPreservedMarking(element, message2);
      updatedCount++;
    }
    deps.augmenter?.seedBannedGhosts(messages2.map((message2) => message2.id));
    logger.debug(
      "ban-guard: updated",
      updatedCount,
      "message(s) for user",
      payload.userId,
      payload.permanent === false ? `(timeout ${payload.durationMin ?? "?"}m by ${payload.bannedBy ?? "?"})` : payload.permanent === true ? "(ban)" : "(moderation type unknown)"
    );
    const newest = newestMessage(messages2);
    notifyModAction(deps, {
      kind: actionKind,
      moderator: payload.bannedBy,
      victim: newest.sender.displayName?.trim() || newest.sender.username,
      messageId: newest.id,
      durationMin: payload.permanent === false ? payload.durationMin : null,
      at: Date.now()
    });
  }
  function handleMessageDeleted(payload, deps) {
    const { messageId } = payload;
    if (featureFlags.showDeletedMessages) {
      const message2 = deps.store.markMessageDeleted(messageId, {
        aiModerated: payload.aiModerated,
        deletedBy: payload.deletedBy,
        violatedRules: payload.violatedRules
      });
      if (!message2) return;
      if (deps.augmenter) {
        deps.augmenter.markById(messageId);
        deps.augmenter.seedRemovedGhosts([messageId]);
      } else {
        const element = deps.registry?.getElementForMessageId(messageId);
        if (element) applyPreservedMarking(element, message2);
      }
      logger.debug("ban-guard: struck-through deleted message", messageId, payload.aiModerated ? "(AI)" : "(mod)");
      return;
    }
    if (deps.registry) {
      const existing = deps.store.getMessageById(messageId);
      if (existing?.preserved) return;
      const element = deps.registry.getElementForMessageId(messageId);
      if (element) {
        deps.registry.forget(element);
        element.remove();
      }
      deps.store.removeMessage(messageId);
      logger.debug("ban-guard: removed deleted message (showDeletedMessages off)", messageId);
    }
  }

  // src/shared/native-chat.ts
  var NATIVE_CHAT_EVENT = "kickflow:native-publication-v1";
  var actor = { id: true, username: true, display_name: true, slug: true, name: true };
  var badge = {
    type: true,
    name: true,
    text: true,
    count: true,
    image_url: true,
    active: true,
    selected: true,
    sort_order: true,
    metadata: { level: true }
  };
  var message = {
    id: true,
    chatroom_id: true,
    content: true,
    type: true,
    created_at: true,
    thread_parent_id: true,
    sender: { ...actor, identity: { color: true, badges: [badge], badges_v2: [badge] } },
    metadata: {
      original_sender: actor,
      original_message: { id: true, content: true, message: true },
      celebration: { type: true, total_months: true }
    }
  };
  var schemas = {
    "App\\Events\\ChatMessageEvent": message,
    "App\\Events\\UserBannedEvent": {
      id: true,
      user_id: true,
      username: true,
      user: actor,
      permanent: true,
      duration: true,
      duration_min: true,
      duration_in_minutes: true,
      banned_by: actor,
      bannedBy: actor,
      banned_by_user: actor,
      expires_at: true,
      banned_until: true,
      expiresAt: true
    },
    "App\\Events\\MessageDeletedEvent": {
      id: true,
      message: { id: true },
      aiModerated: true,
      violatedRules: true,
      deleted_by: actor,
      deletedBy: actor,
      moderator: actor,
      moderator_user: actor,
      deleted_by_user: actor,
      user_deleted_by: actor
    },
    "App\\Events\\SubscriptionEvent": { chatroom_id: true, username: true, months: true },
    "App\\Events\\ChannelSubscriptionEvent": { channel_id: true, user_ids: true, username: true },
    GiftedSubscriptionsEvent: {
      chatroom_id: true,
      correlation_id: true,
      gifted_usernames: true,
      gifter_username: true,
      gifted_total: true
    },
    KicksGifted: { gift_transaction_id: true, sender: actor, gift: { amount: true, name: true }, message: true },
    "App\\Events\\StreamHostEvent": { chatroom_id: true, host_username: true, number_viewers: true, optional_message: true },
    "App\\Events\\PinnedMessageCreatedEvent": { message, duration: true, pinnedBy: actor },
    "App\\Events\\ChatroomUpdatedEvent": {
      id: true,
      slow_mode: { enabled: true, message_interval: true },
      followers_mode: { enabled: true, min_duration: true },
      subscribers_mode: { enabled: true },
      emotes_mode: { enabled: true }
    }
  };
  var stringOrObjectFields = /* @__PURE__ */ new Set([
    "original_sender",
    "original_message",
    "banned_by",
    "bannedBy",
    "banned_by_user",
    "deleted_by",
    "deletedBy",
    "moderator",
    "moderator_user",
    "deleted_by_user",
    "user_deleted_by"
  ]);
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function decode(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  function project(raw, schema) {
    const clean = {};
    for (const [key, shape] of Object.entries(schema)) {
      let value = raw[key];
      if (key === "metadata") value = decode(value);
      if (value === void 0) continue;
      if (shape === true) {
        if (value === null || ["string", "boolean", "number"].includes(typeof value)) clean[key] = value;
        else if (Array.isArray(value)) clean[key] = value.filter((item) => typeof item === "string" || typeof item === "number");
      } else if (Array.isArray(shape)) {
        if (Array.isArray(value)) clean[key] = value.flatMap((item) => {
          const r = record(item);
          return r ? [project(r, shape[0])] : [];
        });
      } else {
        const r = record(value);
        if (r) clean[key] = project(r, shape);
        else if (typeof value === "string" && stringOrObjectFields.has(key)) clean[key] = value;
      }
    }
    return clean;
  }
  function isPublicChatChannel(channel) {
    return typeof channel === "string" && /^(?:chatrooms\.[1-9]\d*\.v2|channel\.[1-9]\d*|chatroom_[1-9]\d*|channel_[1-9]\d*)$/.test(channel);
  }
  function sanitizePublicChatPublication(raw) {
    const frame = record(raw);
    if (!frame || !isPublicChatChannel(frame.channel) || typeof frame.event !== "string") return null;
    const schema = Object.prototype.hasOwnProperty.call(schemas, frame.event) ? schemas[frame.event] : void 0;
    const payload = record(decode(frame.data));
    if (!schema || !payload) return null;
    return { channel: frame.channel, event: frame.event, data: project(payload, schema) };
  }

  // src/content/chat/pusher-client.ts
  var PUSHER_URL = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false";
  var CHAT_MESSAGE_EVENT = "App\\Events\\ChatMessageEvent";
  var USER_BANNED_EVENT = "App\\Events\\UserBannedEvent";
  var SUBSCRIPTION_EVENT = "App\\Events\\SubscriptionEvent";
  var CHANNEL_SUBSCRIPTION_EVENT = "App\\Events\\ChannelSubscriptionEvent";
  var GIFTED_SUBSCRIPTIONS_EVENT = "GiftedSubscriptionsEvent";
  var KICKS_GIFTED_EVENT = "KicksGifted";
  var STREAM_HOST_EVENT = "App\\Events\\StreamHostEvent";
  var PINNED_MESSAGE_CREATED_EVENT = "App\\Events\\PinnedMessageCreatedEvent";
  var CHATROOM_UPDATED_EVENT = "App\\Events\\ChatroomUpdatedEvent";
  var MESSAGE_DELETED_EVENT = "App\\Events\\MessageDeletedEvent";
  var RECONNECT_BASE_DELAY_MS = 1e3;
  var RECONNECT_MAX_DELAY_MS = 15e3;
  var LIVENESS_IDLE_MS = 2 * 60 * 1e3;
  var LIVENESS_PROBE_TIMEOUT_MS = 30 * 1e3;
  var LIVENESS_CHECK_INTERVAL_MS = 30 * 1e3;
  var CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS = 10 * 1e3;
  var PRIMARY_SUBSCRIPTION_CONFIRM_TIMEOUT_MS = 10 * 1e3;
  var PUSHER_ESTABLISHMENT_TIMEOUT_MS = 12 * 1e3;
  function normalizeBadge2(raw) {
    if (!raw || typeof raw !== "object") return {};
    const data = raw;
    const meta = data.metadata ?? null;
    return {
      type: typeof data.type === "string" ? data.type : void 0,
      name: typeof data.name === "string" ? data.name : void 0,
      text: typeof data.text === "string" ? data.text : void 0,
      count: typeof data.count === "number" ? data.count : void 0,
      imageUrl: typeof data.image_url === "string" ? data.image_url : void 0,
      level: meta && typeof meta.level === "number" ? meta.level : void 0,
      active: typeof data.active === "boolean" ? data.active : void 0,
      selected: typeof data.selected === "boolean" ? data.selected : void 0,
      sortOrder: typeof data.sort_order === "number" ? data.sort_order : void 0
    };
  }
  function normalizeBadges2(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeBadge2);
  }
  function normalizeMetadata(raw) {
    let value = raw;
    if (typeof value === "string") {
      if (!value.trim()) return null;
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function extractReplyContext(raw, md) {
    if (!md) return void 0;
    const originalSender = md.original_sender;
    const originalMessage = md.original_message;
    if (!originalSender && !originalMessage) return void 0;
    let replyToUser = null;
    let replyToUserId = null;
    if (typeof originalSender === "string" && originalSender) {
      replyToUser = originalSender;
    } else if (originalSender && typeof originalSender === "object") {
      const sender = originalSender;
      replyToUser = typeof sender.username === "string" && sender.username ? sender.username : null;
      replyToUserId = typeof sender.id === "number" ? sender.id : null;
    }
    let replyToText = null;
    let replyToMessageId = null;
    if (typeof originalMessage === "string" && originalMessage) {
      replyToText = originalMessage;
    } else if (originalMessage && typeof originalMessage === "object") {
      const message2 = originalMessage;
      replyToText = typeof message2.content === "string" && message2.content ? message2.content : typeof message2.message === "string" && message2.message ? message2.message : null;
      replyToMessageId = typeof message2.id === "string" ? message2.id : null;
    }
    if (!replyToUser && !replyToText) return void 0;
    return {
      replyToUser,
      replyToText,
      replyToMessageId,
      replyToUserId,
      threadParentId: typeof raw.thread_parent_id === "string" ? raw.thread_parent_id : null
    };
  }
  function extractCelebrationContext(metadata) {
    const raw = metadata?.celebration;
    if (!raw || typeof raw !== "object") return void 0;
    const celebration = raw;
    const totalMonths = celebration.total_months;
    if (celebration.type !== "subscription_renewed" || typeof totalMonths !== "number" || !Number.isSafeInteger(totalMonths) || totalMonths <= 0) return void 0;
    return { type: "subscription_renewed", totalMonths };
  }
  function normalizeMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const sender = r.sender;
    if (!sender || typeof sender !== "object") return null;
    const s = sender;
    if (typeof r.id !== "string" || typeof r.content !== "string") return null;
    if (typeof s.id !== "number" || typeof s.username !== "string") return null;
    const identity = s.identity ?? null;
    const metadata = normalizeMetadata(r.metadata);
    const replyContext = extractReplyContext(r, metadata);
    const celebration = extractCelebrationContext(metadata);
    return {
      id: r.id,
      chatroomId: typeof r.chatroom_id === "number" ? r.chatroom_id : 0,
      content: r.content,
      type: typeof r.type === "string" ? r.type : "message",
      createdAt: typeof r.created_at === "string" ? r.created_at : "",
      sender: {
        id: s.id,
        username: s.username,
        displayName: typeof s.display_name === "string" ? s.display_name : void 0,
        slug: typeof s.slug === "string" ? s.slug : "",
        identity: {
          color: identity && typeof identity.color === "string" ? identity.color : "",
          badges: normalizeBadges2(identity?.badges),
          badgesV2: normalizeBadges2(identity?.badges_v2)
        }
      },
      ...celebration ? { celebration } : {},
      ...replyContext ? { replyContext } : {},
      preserved: false
    };
  }
  function coerceNum(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return null;
  }
  function firstString(...values) {
    for (const value of values) if (typeof value === "string" && value) return value;
    return null;
  }
  function extractBannedBy(data) {
    const bb = data.banned_by ?? data.bannedBy ?? data.banned_by_user;
    if (typeof bb === "string") return bb;
    if (bb && typeof bb === "object" && typeof bb.username === "string") {
      return bb.username;
    }
    return null;
  }
  function extractActorName(value) {
    if (typeof value === "string" && value.trim()) return value;
    if (!value || typeof value !== "object") return null;
    const data = value;
    return firstString(data.username, data.slug, data.name);
  }
  function extractDeletedBy(data) {
    return extractActorName(data.deleted_by) ?? extractActorName(data.deletedBy) ?? extractActorName(data.moderator) ?? extractActorName(data.moderator_user) ?? extractActorName(data.deleted_by_user) ?? extractActorName(data.user_deleted_by);
  }
  function normalizeBanPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    let userId;
    let username;
    if (typeof data.user_id === "number") {
      userId = data.user_id;
      username = typeof data.username === "string" ? data.username : void 0;
    } else if (data.user && typeof data.user === "object") {
      const user = data.user;
      if (typeof user.id === "number") {
        userId = user.id;
        username = typeof user.username === "string" ? user.username : void 0;
      }
    }
    if (userId === void 0) return null;
    return {
      userId,
      username,
      permanent: typeof data.permanent === "boolean" ? data.permanent : null,
      durationMin: coerceNum(data.duration) ?? coerceNum(data.duration_min) ?? coerceNum(data.duration_in_minutes),
      bannedBy: extractBannedBy(data),
      expiresAt: firstString(data.expires_at, data.banned_until, data.expiresAt)
    };
  }
  function normalizeDeletePayload(raw) {
    const data = raw;
    const rawId = data?.message?.id ?? data?.id;
    const messageId = typeof rawId === "string" ? rawId : void 0;
    if (!messageId) return null;
    const aiModerated = typeof data?.aiModerated === "boolean" ? data.aiModerated : null;
    const deletedBy = data && typeof data === "object" ? extractDeletedBy(data) : null;
    const violatedRules = Array.isArray(data?.violatedRules) ? data.violatedRules.filter((rule) => typeof rule === "string") : [];
    return { messageId, aiModerated, deletedBy, violatedRules };
  }
  function isPositiveInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  }
  function normalizeSubscriptionPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (!isPositiveInteger(data.chatroom_id)) return null;
    if (typeof data.username !== "string" || !data.username.trim()) return null;
    if (!isPositiveInteger(data.months)) return null;
    return { chatroomId: data.chatroom_id, username: data.username, months: data.months };
  }
  function normalizeChannelSubscriptionPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (!isPositiveInteger(data.channel_id)) return null;
    if (typeof data.username !== "string" || !data.username.trim()) return null;
    if (!Array.isArray(data.user_ids) || data.user_ids.length === 0 || !data.user_ids.every(isPositiveInteger)) return null;
    return {
      userIds: data.user_ids,
      username: data.username,
      channelId: data.channel_id
    };
  }
  function normalizeGiftedSubscriptionsPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (!isPositiveInteger(data.chatroom_id)) return null;
    if (typeof data.correlation_id !== "string" || !data.correlation_id.trim()) return null;
    if (typeof data.gifter_username !== "string" || !data.gifter_username.trim()) return null;
    if (!Array.isArray(data.gifted_usernames) || data.gifted_usernames.length === 0 || !data.gifted_usernames.every((username) => typeof username === "string" && username.trim())) return null;
    if (!isPositiveInteger(data.gifted_total)) return null;
    return {
      chatroomId: data.chatroom_id,
      correlationId: data.correlation_id,
      giftedUsernames: data.gifted_usernames,
      gifterUsername: data.gifter_username,
      giftCount: data.gifted_total
    };
  }
  function normalizeKicksGiftedPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (typeof data.gift_transaction_id !== "string" || !data.gift_transaction_id.trim()) return null;
    const sender = data.sender;
    if (!sender || typeof sender !== "object") return null;
    const s = sender;
    if (!isPositiveInteger(s.id)) return null;
    if (typeof s.username !== "string" || !s.username.trim()) return null;
    const gift = data.gift;
    if (!gift || typeof gift !== "object") return null;
    const g = gift;
    if (!isPositiveInteger(g.amount)) return null;
    return {
      giftTransactionId: data.gift_transaction_id,
      senderUsername: s.username,
      amount: g.amount,
      giftName: typeof g.name === "string" && g.name.trim() ? g.name : null,
      senderMessage: typeof data.message === "string" && data.message.trim() ? data.message : null
    };
  }
  function normalizeHostPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (!isPositiveInteger(data.chatroom_id)) return null;
    if (typeof data.host_username !== "string" || !data.host_username.trim()) return null;
    const numberViewers = data.number_viewers == null ? 0 : data.number_viewers;
    if (typeof numberViewers !== "number" || !Number.isSafeInteger(numberViewers) || numberViewers < 0) return null;
    const optionalMessage = data.optional_message == null ? null : data.optional_message;
    if (typeof optionalMessage !== "string" && optionalMessage !== null) return null;
    return {
      chatroomId: data.chatroom_id,
      hostUsername: data.host_username,
      numberViewers,
      optionalMessage
    };
  }
  function normalizePinnedMessagePayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    const message2 = normalizeMessage(data.message);
    if (!message2 || !isPositiveInteger(message2.chatroomId)) return null;
    const durationSeconds = coerceNum(data.duration);
    if (durationSeconds === null || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) return null;
    if (!data.pinnedBy || typeof data.pinnedBy !== "object") return null;
    const pinnedBy = data.pinnedBy;
    if (!isPositiveInteger(pinnedBy.id)) return null;
    if (typeof pinnedBy.username !== "string" || !pinnedBy.username.trim()) return null;
    if (typeof pinnedBy.slug !== "string") return null;
    return {
      message: message2,
      durationSeconds,
      pinnedBy: {
        id: pinnedBy.id,
        username: pinnedBy.username,
        slug: pinnedBy.slug
      }
    };
  }
  function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  function modeRecord(value) {
    return value && typeof value === "object" ? value : null;
  }
  function normalizeChatroomUpdatedPayload(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw;
    if (!isPositiveInteger(data.id)) return null;
    const slowMode = modeRecord(data.slow_mode);
    const followersMode = modeRecord(data.followers_mode);
    const subscribersMode = modeRecord(data.subscribers_mode);
    const emotesMode = modeRecord(data.emotes_mode);
    if (!slowMode || !followersMode || !subscribersMode || !emotesMode) return null;
    if (typeof slowMode.enabled !== "boolean" || !isNonNegativeInteger(slowMode.message_interval)) return null;
    if (typeof followersMode.enabled !== "boolean" || !isNonNegativeInteger(followersMode.min_duration)) return null;
    if (typeof subscribersMode.enabled !== "boolean" || typeof emotesMode.enabled !== "boolean") return null;
    return {
      chatroomId: data.id,
      slowMode: { enabled: slowMode.enabled, messageInterval: slowMode.message_interval },
      followersMode: { enabled: followersMode.enabled, minDuration: followersMode.min_duration },
      subscribersMode: { enabled: subscribersMode.enabled },
      emotesMode: { enabled: emotesMode.enabled }
    };
  }
  function closeQuietly(socket) {
    if (socket.readyState === 0) {
      socket.addEventListener("open", () => {
        try {
          socket.close();
        } catch {
        }
      }, { once: true });
      return;
    }
    socket.close();
  }
  var RECONNECT_WARN_AFTER = 4;
  var PusherClient = class {
    constructor(chatroomId, channelId, callbacks, options = {}) {
      this.chatroomId = chatroomId;
      this.channelId = channelId;
      this.callbacks = callbacks;
      this.options = options;
      this.nativeListening = false;
      this.nativePrimarySockets = /* @__PURE__ */ new Set();
      this.readyAnnounced = false;
      this.seenMessages = /* @__PURE__ */ new Set();
      this.recentPublications = /* @__PURE__ */ new Map();
      this.socket = null;
      this.disposed = false;
      this.reconnectAttempt = 0;
      /** One warning per outage; reset when the room is confirmed again. 2026-10-20. */
      this.reconnectWarned = false;
      this.reconnectTimer = null;
      this.livenessTimer = null;
      this.livenessProbeTimer = null;
      this.lastFrameAt = 0;
      this.awaitingLivenessReply = false;
      this.establishmentTimer = null;
      this.primarySubscriptionTimer = null;
      this.primarySubscriptionState = "idle";
      this.giftSubscriptionTimer = null;
      this.giftSubscriptionState = "idle";
      this.kicksSubscriptionTimer = null;
      this.kicksSubscriptionState = "idle";
      this.onNativeSignal = (event) => {
        if (this.disposed) return;
        const signal = record(event.detail);
        if (!signal || typeof signal.socketId !== "number" || !Number.isSafeInteger(signal.socketId) || signal.socketId <= 0) return;
        if (signal.kind === "unavailable") {
          if (signal.channel !== void 0 && signal.channel !== this.primaryChannelName) return;
          if (!this.nativePrimarySockets.delete(signal.socketId)) return;
          if (this.nativePrimarySockets.size === 0 && this.primarySubscriptionState !== "active") {
            this.reportDisconnected();
          }
          if (this.nativePrimarySockets.size === 0 && this.socket === null) this.scheduleReconnect();
          return;
        }
        if (signal.kind !== "publication") return;
        const publication = sanitizePublicChatPublication(signal.publication);
        if (!publication || !this.isSessionChannel(publication.channel)) return;
        this.handlePublicPublication(publication, signal.socketId);
      };
    }
    connect() {
      if (this.disposed) return;
      if (!this.nativeListening) {
        window.addEventListener(NATIVE_CHAT_EVENT, this.onNativeSignal);
        this.nativeListening = true;
      }
      if (!this.options.legacyPusher) return;
      this.teardownSocket();
      let socket;
      try {
        socket = new WebSocket(PUSHER_URL);
      } catch (error) {
        logger.warn("pusher-client: WebSocket construction failed", error);
        this.reportUnavailable("constructor-error");
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      this.startLivenessWatchdog();
      const isCurrentSocket = () => !this.disposed && this.socket === socket;
      this.establishmentTimer = window.setTimeout(() => {
        this.establishmentTimer = null;
        if (!isCurrentSocket()) return;
        this.noteReconnect("pusher-client: connection establishment timed out; reconnecting");
        this.failCurrentConnection("handshake-timeout");
      }, PUSHER_ESTABLISHMENT_TIMEOUT_MS);
      socket.addEventListener("message", (event) => {
        if (!isCurrentSocket()) return;
        this.noteFrameActivity();
        this.handleRawMessage(event.data);
      });
      socket.addEventListener("close", () => {
        if (!isCurrentSocket()) return;
        this.socket = null;
        this.stopLivenessWatchdog();
        this.clearReadinessTimers();
        this.clearGiftSubscriptionTimer();
        this.clearKicksSubscriptionTimer();
        this.primarySubscriptionState = "idle";
        this.giftSubscriptionState = "idle";
        this.kicksSubscriptionState = "idle";
        this.reportDisconnected();
        this.scheduleReconnect();
      });
      socket.addEventListener("error", (event) => {
        if (!isCurrentSocket()) return;
        logger.debug("pusher-client: socket error", event);
        this.failCurrentConnection("socket-error");
      });
    }
    subscribe() {
      if (this.send({
        event: "pusher:subscribe",
        data: { auth: "", channel: this.primaryChannelName }
      })) {
        this.primarySubscriptionState = "pending";
        this.clearPrimarySubscriptionTimer();
        this.primarySubscriptionTimer = window.setTimeout(() => {
          this.primarySubscriptionTimer = null;
          if (this.primarySubscriptionState !== "pending") return;
          this.noteReconnect("pusher-client: primary chatroom subscription was not confirmed; reconnecting", this.primaryChannelName);
          this.failCurrentConnection("subscription-timeout");
        }, PRIMARY_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
      }
      this.send({
        event: "pusher:subscribe",
        data: { auth: "", channel: this.legacyChannelName }
      });
      if (this.send({
        event: "pusher:subscribe",
        data: { auth: "", channel: this.giftChannelName }
      })) {
        this.giftSubscriptionState = "pending";
        this.clearGiftSubscriptionTimer();
        this.giftSubscriptionTimer = window.setTimeout(() => {
          this.giftSubscriptionTimer = null;
          if (this.giftSubscriptionState !== "pending") return;
          this.giftSubscriptionState = "unavailable";
          logger.warn(
            "pusher-client: gift channel subscription was not confirmed; gifted subscriptions disabled",
            this.giftChannelName
          );
        }, CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
      }
      if (this.send({
        event: "pusher:subscribe",
        data: { auth: "", channel: this.kicksChannelName }
      })) {
        this.kicksSubscriptionState = "pending";
        this.clearKicksSubscriptionTimer();
        this.kicksSubscriptionTimer = window.setTimeout(() => {
          this.kicksSubscriptionTimer = null;
          if (this.kicksSubscriptionState !== "pending") return;
          this.kicksSubscriptionState = "unavailable";
          logger.warn(
            "pusher-client: kicks channel subscription was not confirmed; kicks gifts disabled",
            this.kicksChannelName
          );
        }, CHANNEL_SUBSCRIPTION_CONFIRM_TIMEOUT_MS);
      }
    }
    get legacyChannelName() {
      return `channel.${this.channelId}`;
    }
    get giftChannelName() {
      return `chatroom_${this.chatroomId}`;
    }
    get kicksChannelName() {
      return `channel_${this.channelId}`;
    }
    get primaryChannelName() {
      return `chatrooms.${this.chatroomId}.v2`;
    }
    clearEstablishmentTimer() {
      if (this.establishmentTimer === null) return;
      window.clearTimeout(this.establishmentTimer);
      this.establishmentTimer = null;
    }
    clearPrimarySubscriptionTimer() {
      if (this.primarySubscriptionTimer === null) return;
      window.clearTimeout(this.primarySubscriptionTimer);
      this.primarySubscriptionTimer = null;
    }
    clearReadinessTimers() {
      this.clearEstablishmentTimer();
      this.clearPrimarySubscriptionTimer();
    }
    confirmPrimarySubscription() {
      if (this.primarySubscriptionState === "active") return;
      this.clearPrimarySubscriptionTimer();
      this.primarySubscriptionState = "active";
      this.reconnectAttempt = 0;
      this.reconnectWarned = false;
      this.announceReady();
    }
    announceReady() {
      if (this.readyAnnounced) return;
      this.readyAnnounced = true;
      this.callbacks.onPrimarySubscriptionReady?.();
    }
    reportUnavailable(reason) {
      if (!this.options.legacyPusher) return;
      if (this.nativePrimarySockets.size > 0) return;
      this.readyAnnounced = false;
      this.callbacks.onPrimarySubscriptionUnavailable?.(reason);
    }
    reportDisconnected() {
      if (this.nativePrimarySockets.size > 0) return;
      this.readyAnnounced = false;
      this.callbacks.onDisconnected?.();
    }
    isSessionChannel(channel) {
      return [this.primaryChannelName, this.legacyChannelName, this.giftChannelName, this.kicksChannelName].includes(channel);
    }
    confirmPrimaryFromValidatedFrame(channel, nativeSocketId) {
      if (nativeSocketId !== void 0) return;
      if (channel === this.primaryChannelName) this.confirmPrimarySubscription();
    }
    rejectPrimarySubscription(payload) {
      logger.warn(
        "pusher-client: primary chatroom subscription failed; reconnecting",
        this.primaryChannelName,
        typeof payload === "string" ? payload : JSON.stringify(payload)
      );
      this.failCurrentConnection("subscription-error");
    }
    clearGiftSubscriptionTimer() {
      if (this.giftSubscriptionTimer === null) return;
      window.clearTimeout(this.giftSubscriptionTimer);
      this.giftSubscriptionTimer = null;
    }
    confirmGiftSubscription() {
      this.clearGiftSubscriptionTimer();
      this.giftSubscriptionState = "active";
    }
    rejectGiftSubscription(payload) {
      this.clearGiftSubscriptionTimer();
      this.giftSubscriptionState = "unavailable";
      logger.warn(
        "pusher-client: gift channel subscription failed; gifted subscriptions disabled",
        this.giftChannelName,
        typeof payload === "string" ? payload : JSON.stringify(payload)
      );
    }
    clearKicksSubscriptionTimer() {
      if (this.kicksSubscriptionTimer === null) return;
      window.clearTimeout(this.kicksSubscriptionTimer);
      this.kicksSubscriptionTimer = null;
    }
    confirmKicksSubscription() {
      this.clearKicksSubscriptionTimer();
      this.kicksSubscriptionState = "active";
    }
    rejectKicksSubscription(payload) {
      this.clearKicksSubscriptionTimer();
      this.kicksSubscriptionState = "unavailable";
      logger.warn(
        "pusher-client: kicks channel subscription failed; kicks gifts disabled",
        this.kicksChannelName,
        typeof payload === "string" ? payload : JSON.stringify(payload)
      );
    }
    send(payload) {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(payload));
        return true;
      }
      return false;
    }
    startLivenessWatchdog() {
      this.stopLivenessWatchdog();
      this.lastFrameAt = Date.now();
      this.livenessTimer = window.setInterval(() => this.checkConnectionLiveness(), LIVENESS_CHECK_INTERVAL_MS);
    }
    stopLivenessWatchdog() {
      if (this.livenessTimer !== null) {
        window.clearInterval(this.livenessTimer);
        this.livenessTimer = null;
      }
      if (this.livenessProbeTimer !== null) {
        window.clearTimeout(this.livenessProbeTimer);
        this.livenessProbeTimer = null;
      }
      this.awaitingLivenessReply = false;
    }
    noteFrameActivity() {
      this.lastFrameAt = Date.now();
      if (this.awaitingLivenessReply) {
        this.awaitingLivenessReply = false;
        if (this.livenessProbeTimer !== null) {
          window.clearTimeout(this.livenessProbeTimer);
          this.livenessProbeTimer = null;
        }
      }
    }
    /** 2026-10-20: a dropped connection that this client
     * retries by itself (sleep/wake, a network blip) is not an error for the extension errors page.
     * It stays a debug line until RECONNECT_WARN_AFTER attempts in a row fail, then warns once. */
    noteReconnect(message2, ...detail) {
      if (this.reconnectAttempt + 1 < RECONNECT_WARN_AFTER || this.reconnectWarned) {
        logger.debug(message2, ...detail);
        return;
      }
      this.reconnectWarned = true;
      logger.warn(message2, ...detail, `(${this.reconnectAttempt + 1} attempts in a row)`);
    }
    checkConnectionLiveness() {
      if (this.disposed || !this.socket || this.awaitingLivenessReply) return;
      if (Date.now() - this.lastFrameAt < LIVENESS_IDLE_MS) return;
      if (this.socket.readyState !== WebSocket.OPEN || !this.send({ event: "pusher:ping", data: {} })) {
        this.reconnectAfterLivenessFailure();
        return;
      }
      this.awaitingLivenessReply = true;
      this.livenessProbeTimer = window.setTimeout(() => {
        this.livenessProbeTimer = null;
        if (!this.awaitingLivenessReply) return;
        this.noteReconnect("pusher-client: liveness probe timed out; reconnecting");
        this.reconnectAfterLivenessFailure();
      }, LIVENESS_PROBE_TIMEOUT_MS);
    }
    reconnectAfterLivenessFailure() {
      if (this.disposed || !this.socket) return;
      const socket = this.socket;
      this.stopLivenessWatchdog();
      this.clearReadinessTimers();
      this.clearGiftSubscriptionTimer();
      this.clearKicksSubscriptionTimer();
      this.primarySubscriptionState = "idle";
      this.giftSubscriptionState = "idle";
      this.kicksSubscriptionState = "idle";
      this.socket = null;
      try {
        closeQuietly(socket);
      } catch {
      }
      this.reportDisconnected();
      this.scheduleReconnect();
    }
    handleRawMessage(raw) {
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch (error) {
        logger.warn("pusher-client: failed to parse frame", error);
        return;
      }
      const eventName = frame.event;
      if (!eventName) return;
      if (eventName === "pusher:connection_established") {
        this.clearEstablishmentTimer();
        this.subscribe();
        if (this.nativePrimarySockets.size === 0) this.callbacks.onConnected?.();
        return;
      }
      if (eventName === "pusher:ping") {
        this.send({ event: "pusher:pong", data: {} });
        return;
      }
      if (eventName === "pusher:error") {
        const data = this.parseInnerData(frame.data);
        logger.debug("pusher-client: server error frame", typeof data === "string" ? data : JSON.stringify(data));
        this.failCurrentConnection("server-error");
        return;
      }
      if (eventName === "pusher_internal:subscription_succeeded") {
        if (frame.channel === this.primaryChannelName) this.confirmPrimarySubscription();
        if (frame.channel === this.giftChannelName) this.confirmGiftSubscription();
        if (frame.channel === this.kicksChannelName) this.confirmKicksSubscription();
        return;
      }
      if (eventName === "pusher:subscription_error") {
        if (frame.channel === this.primaryChannelName) {
          this.rejectPrimarySubscription(this.parseInnerData(frame.data));
          return;
        }
        if (frame.channel === this.giftChannelName) this.rejectGiftSubscription(this.parseInnerData(frame.data));
        if (frame.channel === this.kicksChannelName) this.rejectKicksSubscription(this.parseInnerData(frame.data));
        return;
      }
      if (eventName.startsWith("pusher_internal:") || eventName.startsWith("pusher:")) {
        return;
      }
      this.handlePublicPublication(frame);
    }
    handlePublicPublication(frame, nativeSocketId) {
      if (frame.channel !== void 0 && !this.isSessionChannel(frame.channel)) return;
      const eventName = frame.event;
      if (!eventName) return;
      const payload = this.parseInnerData(frame.data);
      if (eventName !== CHAT_MESSAGE_EVENT) {
        const clean = sanitizePublicChatPublication(frame);
        if (clean) {
          const key = JSON.stringify(clean);
          const previous = this.recentPublications.get(key);
          const source = nativeSocketId ?? 0;
          if (previous && previous.source !== source && Date.now() - previous.at < 5e3) return;
          this.recentPublications.set(key, { at: Date.now(), source });
          if (this.recentPublications.size > 2e3) this.recentPublications.delete(this.recentPublications.keys().next().value);
        }
      }
      switch (eventName) {
        case CHAT_MESSAGE_EVENT: {
          if (!payload) return;
          const message2 = normalizeMessage(payload);
          if (!message2) {
            if (featureFlags.debugLogging) {
              logger.debug("pusher-client: dropped malformed ChatMessageEvent payload", payload);
            }
            return;
          }
          if (nativeSocketId !== void 0) {
            if (frame.channel !== this.primaryChannelName || message2.chatroomId !== this.chatroomId) return;
            this.nativePrimarySockets.add(nativeSocketId);
            this.clearReconnectTimer();
            this.reconnectAttempt = 0;
            this.reconnectWarned = false;
            this.announceReady();
          } else {
            this.confirmPrimaryFromValidatedFrame(frame.channel);
          }
          if (this.seenMessages.has(message2.id)) return;
          this.seenMessages.add(message2.id);
          if (this.seenMessages.size > 2e3) this.seenMessages.delete(this.seenMessages.values().next().value);
          this.callbacks.onMessage(message2);
          return;
        }
        case USER_BANNED_EVENT: {
          if (featureFlags.debugLogging) {
            logger.debug("pusher-client: raw UserBannedEvent payload", payload);
          }
          const normalized = normalizeBanPayload(payload);
          if (normalized) {
            this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
            this.callbacks.onUserBanned(normalized);
          } else {
            logger.warn("pusher-client: UserBannedEvent payload matched neither known shape", payload);
          }
          return;
        }
        case MESSAGE_DELETED_EVENT: {
          const normalized = normalizeDeletePayload(payload);
          if (!normalized) return;
          this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
          this.callbacks.onMessageDeleted?.(normalized);
          return;
        }
        case SUBSCRIPTION_EVENT: {
          const normalized = normalizeSubscriptionPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: SubscriptionEvent payload did not match the captured shape", payload);
            return;
          }
          this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
          this.callbacks.onSubscription?.(normalized);
          return;
        }
        case CHANNEL_SUBSCRIPTION_EVENT: {
          const normalized = normalizeChannelSubscriptionPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: ChannelSubscriptionEvent payload did not match the captured shape", payload);
            return;
          }
          if (featureFlags.debugLogging) {
            logger.debug("pusher-client: non-presentational ChannelSubscriptionEvent", normalized);
          }
          return;
        }
        case GIFTED_SUBSCRIPTIONS_EVENT: {
          if (frame.channel !== this.giftChannelName) return;
          if (nativeSocketId === void 0 && this.giftSubscriptionState === "unavailable") return;
          const normalized = normalizeGiftedSubscriptionsPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: GiftedSubscriptionsEvent payload did not match the captured shape", payload);
            return;
          }
          if (frame.channel === this.giftChannelName) this.confirmGiftSubscription();
          this.callbacks.onGiftedSubscriptions?.(normalized);
          return;
        }
        case KICKS_GIFTED_EVENT: {
          if (frame.channel !== this.kicksChannelName) return;
          if (nativeSocketId === void 0 && this.kicksSubscriptionState === "unavailable") return;
          const normalized = normalizeKicksGiftedPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: KicksGifted payload did not match the captured shape", payload);
            return;
          }
          this.confirmKicksSubscription();
          this.callbacks.onKicksGifted?.(normalized);
          return;
        }
        case STREAM_HOST_EVENT: {
          const normalized = normalizeHostPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: StreamHostEvent payload did not match the captured shape", payload);
            return;
          }
          this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
          this.callbacks.onHost?.(normalized);
          return;
        }
        case PINNED_MESSAGE_CREATED_EVENT: {
          const normalized = normalizePinnedMessagePayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: PinnedMessageCreatedEvent payload did not match the captured shape", payload);
            return;
          }
          this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
          this.callbacks.onPinnedMessage?.(normalized);
          return;
        }
        case CHATROOM_UPDATED_EVENT: {
          const normalized = normalizeChatroomUpdatedPayload(payload);
          if (!normalized) {
            logger.warn("pusher-client: ChatroomUpdatedEvent payload did not match the captured shape", payload);
            return;
          }
          if (normalized.chatroomId !== this.chatroomId) return;
          this.confirmPrimaryFromValidatedFrame(frame.channel, nativeSocketId);
          this.callbacks.onChatroomUpdated?.(normalized);
          return;
        }
        default: {
          if (featureFlags.debugLogging) {
            logger.debug("pusher-client: unknown event", eventName, JSON.stringify(payload)?.slice(0, 500));
          }
          this.callbacks.onUnknownEvent?.(eventName, payload);
        }
      }
    }
    // Pusher channel events double-encode: the outer frame's `data` is itself a JSON
    // string that must be parsed again to reach the real payload.
    parseInnerData(data) {
      if (typeof data !== "string") return data ?? null;
      try {
        return JSON.parse(data);
      } catch (error) {
        logger.debug("pusher-client: failed to parse inner data", error);
        return null;
      }
    }
    failCurrentConnection(reason) {
      if (this.disposed) return;
      const socket = this.socket;
      this.socket = null;
      this.stopLivenessWatchdog();
      this.clearReadinessTimers();
      this.clearGiftSubscriptionTimer();
      this.clearKicksSubscriptionTimer();
      this.primarySubscriptionState = "idle";
      this.giftSubscriptionState = "idle";
      this.kicksSubscriptionState = "idle";
      if (socket) {
        try {
          closeQuietly(socket);
        } catch {
        }
      }
      this.reportUnavailable(reason);
      if (socket) this.reportDisconnected();
      this.scheduleReconnect();
    }
    scheduleReconnect() {
      if (!this.options.legacyPusher) return;
      if (this.disposed || this.nativePrimarySockets.size > 0 || this.reconnectTimer !== null) return;
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
      this.reconnectAttempt++;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }
    clearReconnectTimer() {
      if (this.reconnectTimer === null) return;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    teardownSocket() {
      this.stopLivenessWatchdog();
      this.clearReadinessTimers();
      this.clearGiftSubscriptionTimer();
      this.clearKicksSubscriptionTimer();
      this.primarySubscriptionState = "idle";
      this.giftSubscriptionState = "idle";
      this.kicksSubscriptionState = "idle";
      this.clearReconnectTimer();
      if (this.socket) {
        const socket = this.socket;
        this.socket = null;
        try {
          closeQuietly(socket);
        } catch {
        }
      }
    }
    dispose() {
      this.disposed = true;
      window.removeEventListener(NATIVE_CHAT_EVENT, this.onNativeSignal);
      this.nativeListening = false;
      this.nativePrimarySockets.clear();
      this.seenMessages.clear();
      this.recentPublications.clear();
      this.teardownSocket();
    }
  };

  // src/content/chat/native-augment.ts
  var CHAT_ROOT_SELECTOR = "#chatroom-messages";
  var CHAT_LIST_SELECTOR = "#chatroom-messages .no-scrollbar";
  var ROW_SELECTOR = "[data-index]";
  var AUGMENTED_CLASS = "kickflow-augmented";
  var ORIGINAL_CONTENT_CLASS = "kickflow-original-content";
  var DIMMED_NATIVE_CONTENT_CLASS = "kickflow-native-content-dimmed";
  var GHOST_BLOCK_CLASS = "kickflow-ghost-block";
  var GHOST_ROW_CLASS = "kickflow-ghost-row";
  var MOD_ACTION_BLOCK_CLASS = "kickflow-modaction-block";
  var MOD_ACTION_ANCHOR_ATTRIBUTE = "data-kickflow-modaction-anchor";
  var MOD_ACTION_ID_ATTRIBUTE = "data-kickflow-modaction-id";
  var MOD_ACTION_SIGNATURE_ATTRIBUTE = "data-kickflow-modaction-signature";
  var POINTER_ROW_ATTRIBUTE = "data-kickflow-pointer-row";
  var NATIVE_CONTENT_SELECTOR = '.break-words, [class*="break-words"]';
  var NATIVE_ROW_GROUP_CLASS = "group";
  var ANCHOR_MAX_SEQ_DISTANCE = 20;
  var MAX_GHOSTS_PER_ANCHOR = 4;
  var MOD_ACTION_MAX_ROWS_IN_CHAT = 3;
  var INJECTED_SELECTOR = [
    `.${GHOST_BLOCK_CLASS}`,
    `.${MOD_ACTION_BLOCK_CLASS}`,
    ".kickflow-status-label",
    ".kickflow-mod-label",
    `.${ORIGINAL_CONTENT_CLASS}`
  ].join(",");
  var PRESERVED_CLASSES = [
    AUGMENTED_CLASS,
    PRESERVED_CLASS,
    BANNED_CLASS,
    TIMEOUT_CLASS,
    DELETED_CLASS
  ];
  var activeAugmenter = null;
  function reconcileActiveNativeChat() {
    activeAugmenter?.reconcileAll();
  }
  function getActiveNativeChatGhostStats() {
    return activeAugmenter?.getGhostStats() ?? {
      ghostAnchored: 0,
      ghostPendingNoAnchor: 0,
      ghostStrip: 0,
      ghostEvicted: 0
    };
  }
  var NativeChatAugmenter = class {
    constructor(lifecycle, store) {
      this.lifecycle = lifecycle;
      this.store = store;
      this.observer = null;
      this.hoverObserver = null;
      this.observedRoot = null;
      this.hoverFrame = null;
      this.pointerPosition = null;
      this.pointerRow = null;
      this.ghostsNeeded = /* @__PURE__ */ new Set();
      this.ghostAnchorById = /* @__PURE__ */ new Map();
      this.ghostsByAnchor = /* @__PURE__ */ new Map();
      this.modActionNotices = /* @__PURE__ */ new Map();
      this.reanchorTimer = null;
      this.ghostEvicted = 0;
      /** Mounted-row index, set only for the duration of one anchor pass. */
      this.passIndex = null;
      this.handlePointerMove = (event) => {
        if (event.pointerType === "touch") {
          this.handlePointerLeave();
          return;
        }
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        this.pointerPosition = { x: event.clientX, y: event.clientY };
        this.refreshPointerRow();
      };
      this.handlePointerLeave = () => {
        this.pointerPosition = null;
        this.setPointerRow(null);
      };
      this.handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") this.handlePointerLeave();
      };
      this.handleReplyEscape = (event) => {
        if (event.key !== "Escape") return;
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !focused.matches('button:has(svg[data-ds-icon="ArrowCurveLeft"])') || !focused.closest(CHAT_ROOT_SELECTOR)) return;
        focused.blur();
        this.handlePointerLeave();
      };
      this.schedulePointerRefresh = () => {
        if (!this.pointerPosition || this.hoverFrame !== null) return;
        this.hoverFrame = window.requestAnimationFrame(() => {
          this.hoverFrame = null;
          this.refreshPointerRow();
        });
      };
      const attach = () => this.attachToCurrentChat();
      document.addEventListener("pointermove", this.handlePointerMove, true);
      document.addEventListener("pointerleave", this.handlePointerLeave);
      document.documentElement.addEventListener("pointerleave", this.handlePointerLeave);
      document.addEventListener("keydown", this.handleReplyEscape, true);
      window.addEventListener("blur", this.handlePointerLeave);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      lifecycle.add(() => {
        document.removeEventListener("pointermove", this.handlePointerMove, true);
        document.removeEventListener("pointerleave", this.handlePointerLeave);
        document.documentElement.removeEventListener("pointerleave", this.handlePointerLeave);
        document.removeEventListener("keydown", this.handleReplyEscape, true);
        window.removeEventListener("blur", this.handlePointerLeave);
        document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      });
      activeAugmenter = this;
      attach();
      visibleInterval(lifecycle, () => {
        attach();
        this.healRemovedRendering();
      }, 1e3);
      visibleInterval(lifecycle, () => {
        if (this.pointerPosition && this.observedRoot && document.visibilityState !== "hidden") {
          this.refreshPointerRow();
        }
      }, 100);
      lifecycle.add(() => {
        if (activeAugmenter === this) activeAugmenter = null;
        this.dispose();
      });
    }
    markById(id) {
      const row = document.querySelector(
        `${CHAT_ROOT_SELECTOR} [data-kickflow-mid="${CSS.escape(id)}"]`
      );
      if (row) this.reconcileRow(row);
    }
    seedBannedGhosts(ids) {
      this.seedRemovedGhosts(ids);
    }
    /** A removed message (ban, timeout or delete) that Kick no longer renders gets a ghost row at its
     * chronological place. Kick drops a banned user's rows and, seen live 2026-10-23, often drops a
     * deleted message's row within a second or so as well; both must stay visible inline. */
    seedRemovedGhosts(ids) {
      if (!this.ghostsEnabled()) return;
      let changed = false;
      for (const id of ids) {
        if (!this.isGhostCandidate(id) || this.isMessageMounted(id)) continue;
        this.ghostsNeeded.add(id);
        changed = true;
      }
      if (changed) this.scheduleAnchorPass();
    }
    showModActionNotice(notice, callbacks) {
      if (this.lifecycle.isDisposed) return;
      const existing = this.modActionNotices.get(notice.id);
      if (existing) {
        existing.notice = notice;
        existing.callbacks = callbacks;
      } else {
        this.modActionNotices.set(notice.id, { notice, callbacks, anchorMid: null });
        while (this.modActionNotices.size > MOD_ACTION_MAX_ROWS_IN_CHAT) {
          const oldestId = this.modActionNotices.keys().next().value;
          if (oldestId === void 0) break;
          this.modActionNotices.delete(oldestId);
        }
      }
      this.scheduleAnchorPass();
    }
    clearModActionNotices() {
      this.modActionNotices.clear();
      this.observedRoot?.querySelectorAll(`.${MOD_ACTION_BLOCK_CLASS}`).forEach((node) => node.remove());
    }
    forgetGhost(id) {
      const hadGhost = this.ghostsNeeded.delete(id) || this.ghostAnchorById.has(id);
      this.removeGhostFromAnchor(id);
      if (hadGhost) this.ghostEvicted++;
    }
    reconcileAll() {
      if (!this.ghostsEnabled()) this.clearGhosts();
      this.reconcileVisibleRows();
      if (this.ghostsEnabled() || this.modActionNotices.size > 0) this.scheduleAnchorPass();
    }
    ghostsEnabled() {
      return featureFlags.preserveBansInline || featureFlags.showDeletedMessages;
    }
    isGhostCandidate(id) {
      return this.isGhostCandidateMessage(this.store.getMessageById(id));
    }
    /** Bans/timeouts follow preserveBansInline, deletes follow showDeletedMessages. */
    isGhostCandidateMessage(message2) {
      if (!message2?.preserved) return false;
      if (message2.preservedReason === "banned") return featureFlags.preserveBansInline;
      if (message2.preservedReason === "deleted") return featureFlags.showDeletedMessages;
      return false;
    }
    getGhostStats() {
      return {
        ghostAnchored: this.ghostAnchorById.size,
        ghostPendingNoAnchor: this.ghostsNeeded.size,
        // The bounded strip is gone — pending ghosts now surface via the shared
        // RemovedMessagesPanel (bootstrap.ts), which this augmenter no longer owns.
        ghostStrip: 0,
        ghostEvicted: this.ghostEvicted
      };
    }
    /** Safety net, once a second: the inline view of removed messages must not depend on some
     * unrelated chat mutation arriving later. Every trigger above is event-driven (ban event, row
     * removal record, newly mounted row); when one is missed — a quiet chat, a chat root swapped
     * between two attach ticks, a removal Kick expresses in a shape the observer does not classify —
     * a removed message stayed invisible until the next message happened to arrive (user report
     * 2026-10-23: the removed-messages panel showed three bans, the chat none, 11 s later all). The pass
     * is idempotent, so running it when nothing is stale changes no DOM. */
    healRemovedRendering() {
      if (this.lifecycle.isDisposed || !this.observedRoot || document.visibilityState === "hidden") return;
      if (this.reanchorTimer != null) return;
      if (this.hasStaleRemovedRendering()) this.scheduleAnchorPass();
    }
    hasStaleRemovedRendering() {
      for (const state2 of this.modActionNotices.values()) {
        if (state2.anchorMid === null) return true;
        const row = this.findMountedRowByMid(state2.anchorMid);
        if (!row) continue;
        if (this.store.getMessageById(state2.anchorMid)?.preserved) return true;
        if (!row.querySelector(`.${MOD_ACTION_BLOCK_CLASS}`)) return true;
      }
      if (!this.ghostsEnabled()) return false;
      if (this.ghostsNeeded.size > 0) return true;
      for (const [id, anchorMid] of this.ghostAnchorById) {
        const row = this.findMountedRowByMid(anchorMid);
        if (row && !this.isGhostMountedUnderAnchor(id, row)) return true;
      }
      for (const message2 of this.store.getPreserved()) {
        if (!this.isGhostCandidateMessage(message2) || this.ghostAnchorById.has(message2.id)) continue;
        if (!this.isMessageMounted(message2.id)) return true;
      }
      return false;
    }
    attachToCurrentChat() {
      const root = findMainNativeList();
      if (!root) {
        if (this.observedRoot) this.disconnectObserver();
        return;
      }
      if (root === this.observedRoot) return;
      this.disconnectObserver();
      this.observedRoot = root;
      this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-kickflow-mid"]
      });
      this.hoverObserver = new MutationObserver(this.schedulePointerRefresh);
      this.hoverObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        // Kick repositions existing virtual rows with transform changes as well as appending rows.
        // Do not observe our own POINTER_ROW_ATTRIBUTE, which would create an observer loop.
        attributeFilter: ["style", "data-index"]
      });
      root.addEventListener("scroll", this.schedulePointerRefresh, true);
      this.schedulePointerRefresh();
      this.reconcileVisibleRows();
      if (this.modActionNotices.size > 0) this.scheduleAnchorPass();
    }
    disconnectObserver() {
      this.observer?.disconnect();
      this.observer = null;
      this.hoverObserver?.disconnect();
      this.hoverObserver = null;
      this.observedRoot?.removeEventListener("scroll", this.schedulePointerRefresh, true);
      this.setPointerRow(null);
      this.observedRoot = null;
    }
    dispose() {
      if (this.hoverFrame !== null) window.cancelAnimationFrame(this.hoverFrame);
      this.hoverFrame = null;
      this.clearGhosts();
      this.clearModActionNotices();
      this.observedRoot?.querySelectorAll(ROW_SELECTOR).forEach((row) => this.cleanRow(row));
      this.disconnectObserver();
    }
    refreshPointerRow() {
      const pointer = this.pointerPosition;
      if (!pointer || !this.observedRoot || document.documentElement.classList.contains("kickflow-chat-active")) {
        this.setPointerRow(null);
        return;
      }
      const hit = document.elementFromPoint(pointer.x, pointer.y);
      const row = hit?.closest(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}`) ?? null;
      this.setPointerRow(row?.closest(CHAT_ROOT_SELECTOR) === this.observedRoot ? row : null);
    }
    setPointerRow(row) {
      if (this.pointerRow === row && (!row || row.isConnected)) return;
      this.pointerRow?.removeAttribute(POINTER_ROW_ATTRIBUTE);
      this.pointerRow = row;
      row?.setAttribute(POINTER_ROW_ATTRIBUTE, "");
    }
    reconcileVisibleRows() {
      document.querySelectorAll(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}`).forEach((row) => this.reconcileRow(row));
    }
    handleMutations(mutations) {
      let mountedSetChanged = false;
      let needsAnchorPass = false;
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const row = this.asRow(mutation.target);
          if (row) {
            mountedSetChanged = true;
            this.reconcileRow(row);
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          const rows = this.collectRows(node);
          if (rows.length > 0) mountedSetChanged = true;
          rows.forEach((row) => this.reconcileRow(row));
        }
        if (this.mutationTouchesNativeContent(mutation)) {
          const row = this.closestRow(mutation.target);
          if (row) this.reconcileRow(row);
        }
        for (const node of mutation.removedNodes) {
          const rows = this.collectRows(node);
          if (rows.length > 0) mountedSetChanged = true;
          if (this.containsModActionBlock(node)) needsAnchorPass = true;
          if (!this.ghostsEnabled()) continue;
          for (const id of this.collectMessageIds(node)) {
            if (this.isGhostCandidate(id)) {
              this.ghostsNeeded.add(id);
              needsAnchorPass = true;
            }
            if (this.ghostsByAnchor.has(id)) needsAnchorPass = true;
          }
        }
      }
      if (this.ghostsEnabled() && (needsAnchorPass || mountedSetChanged && (this.ghostsNeeded.size > 0 || this.ghostAnchorById.size > 0)) || this.modActionNotices.size > 0 && (needsAnchorPass || mountedSetChanged)) {
        this.scheduleAnchorPass();
      }
    }
    collectRows(node) {
      if (!(node instanceof HTMLElement)) return [];
      const rows = [];
      const self = this.asRow(node);
      if (self) rows.push(self);
      rows.push(...Array.from(node.querySelectorAll(ROW_SELECTOR)));
      return rows;
    }
    asRow(target) {
      return target instanceof HTMLElement && target.matches(ROW_SELECTOR) ? target : null;
    }
    closestRow(target) {
      if (!(target instanceof Node)) return null;
      const element = target instanceof HTMLElement ? target : target.parentElement;
      return element?.closest(ROW_SELECTOR) ?? null;
    }
    mutationTouchesNativeContent(mutation) {
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.some((node) => node instanceof HTMLElement && (node.matches(NATIVE_CONTENT_SELECTOR) || node.querySelector(NATIVE_CONTENT_SELECTOR) !== null));
    }
    collectMessageIds(node) {
      if (!(node instanceof HTMLElement)) return [];
      const ids = [];
      const self = node.dataset.kickflowMid;
      if (self) ids.push(self);
      node.querySelectorAll("[data-kickflow-mid]").forEach((element) => {
        const id = element.dataset.kickflowMid;
        if (id) ids.push(id);
      });
      return ids;
    }
    containsModActionBlock(node) {
      return node instanceof HTMLElement && (node.matches(`.${MOD_ACTION_BLOCK_CLASS}`) || node.querySelector(`.${MOD_ACTION_BLOCK_CLASS}`) !== null);
    }
    reconcileRow(row, retryIfUnstamped = true) {
      if (this.lifecycle.isDisposed) return;
      this.cleanRow(row);
      const id = row.dataset.kickflowMid;
      if (!id) {
        if (retryIfUnstamped) {
          this.lifecycle.setTimeout(() => this.reconcileRow(row, false), 0);
        }
        return;
      }
      const message2 = this.store.getMessageById(id);
      if (message2?.preserved) {
        if (message2.preservedReason !== "deleted" || featureFlags.showDeletedMessages) {
          row.classList.add(AUGMENTED_CLASS);
          this.hideNativeContent(row);
          row.appendChild(this.buildPreservedInline(message2));
          applyPreservedMarking(row, message2);
        }
      }
      if (message2 && !message2.systemEvent) {
        applyNativeHighlights(row, message2);
      }
      if (this.ghostsEnabled()) this.reapplyGhostsForAnchor(id, row);
      if (this.modActionNotices.size > 0) this.scheduleAnchorPass();
    }
    cleanRow(row) {
      row.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
      row.classList.remove(...PRESERVED_CLASSES);
      clearNativeHighlightStyles(row);
      row.querySelectorAll(`.${DIMMED_NATIVE_CONTENT_CLASS}`).forEach((node) => node.classList.remove(DIMMED_NATIVE_CONTENT_CLASS));
    }
    /** Hides the native message content (whatever it currently is — the original text or a
     * "Deleted by a moderator" placeholder) so our own stored copy is the only one shown. */
    hideNativeContent(row) {
      const holder = row.querySelector(NATIVE_CONTENT_SELECTOR);
      if (holder && !holder.classList.contains(ORIGINAL_CONTENT_CLASS)) {
        holder.classList.add(DIMMED_NATIVE_CONTENT_CLASS);
      }
    }
    /** Builds our struck-through copy of a preserved message (sender name + original text) from the
     * store, so hiding the native row never loses who said what. */
    buildPreservedInline(message2) {
      const wrap = document.createElement("span");
      wrap.className = ORIGINAL_CONTENT_CLASS;
      const username = document.createElement("span");
      username.className = "kickflow-preserved-username";
      const displayName = message2.sender.displayName || message2.sender.username;
      username.textContent = displayName;
      wireUsernameProfileLink(username, message2.sender, displayName, "kickflow-preserved-username--link");
      username.style.color = message2.sender.identity.color || "inherit";
      const separator = document.createElement("span");
      separator.textContent = ": ";
      const content = document.createElement("span");
      appendParsedContent(content, message2.content);
      wrap.append(username, separator, content);
      return wrap;
    }
    scheduleAnchorPass() {
      if (this.reanchorTimer != null) return;
      this.reanchorTimer = window.setTimeout(() => {
        this.reanchorTimer = null;
        this.reanchorGhosts();
      }, 0);
    }
    reanchorGhosts() {
      this.passIndex = this.buildMountedIndex();
      try {
        this.reanchorGhostsWithIndex();
      } finally {
        this.passIndex = null;
      }
    }
    reanchorGhostsWithIndex() {
      if (this.ghostsEnabled()) {
        this.pruneStrayGhosts();
        const ids = new Set(this.ghostsNeeded);
        for (const id of this.ghostAnchorById.keys()) ids.add(id);
        for (const message2 of this.store.getPreserved()) {
          if (this.isGhostCandidateMessage(message2) && !this.isMessageMounted(message2.id)) ids.add(message2.id);
        }
        Array.from(ids).sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0)).forEach((id) => this.reanchorGhost(id));
      } else {
        this.clearGhosts();
      }
      this.reanchorModActionBlocks();
    }
    /** Removes ghost DOM that duplicates or strands — the main defense against the same banned
     * message showing twice. react-virtuoso recycles row elements, so a ghost-block can be left
     * attached to a DOM row Kick has since reassigned to another message; and a message Kick later
     * re-renders natively should lose its ghost. Runs at the top of every anchor pass. */
    pruneStrayGhosts() {
      const root = this.observedRoot;
      if (!root) return;
      root.querySelectorAll(`.${GHOST_BLOCK_CLASS}`).forEach((block) => {
        const anchorMid = block.dataset.kickflowGhostAnchor;
        const row = block.closest(ROW_SELECTOR);
        if (!anchorMid || !row || row.dataset.kickflowMid !== anchorMid) block.remove();
      });
      const seen = /* @__PURE__ */ new Set();
      root.querySelectorAll(`.${GHOST_ROW_CLASS}[data-kickflow-ghost-mid]`).forEach((el) => {
        const mid = el.dataset.kickflowGhostMid ?? "";
        const message2 = this.store.getMessageById(mid);
        const valid = this.isGhostCandidateMessage(message2) && !this.isMessageMounted(mid);
        if (!valid || seen.has(mid)) {
          el.remove();
          return;
        }
        seen.add(mid);
      });
      root.querySelectorAll(`.${GHOST_BLOCK_CLASS}`).forEach((block) => {
        if (!block.querySelector(`.${GHOST_ROW_CLASS}`)) block.remove();
      });
    }
    reanchorModActionBlocks() {
      const root = this.observedRoot;
      if (!root) return;
      this.pruneStrayModActionBlocks();
      if (this.modActionNotices.size === 0) return;
      for (const state2 of this.modActionNotices.values()) {
        if (state2.anchorMid !== null) {
          if (this.store.getMessageById(state2.anchorMid)?.preserved) {
            const replacement = this.findLiveRowAtOrBefore(this.store.getMessageSeq(state2.anchorMid)) ?? this.findNewestMountedNativeRow();
            if (replacement) state2.anchorMid = replacement.mid;
          }
          continue;
        }
        const newest = this.findNewestMountedNativeRow();
        if (!newest) continue;
        state2.anchorMid = newest.mid;
      }
      const byAnchor = /* @__PURE__ */ new Map();
      for (const [noticeId, state2] of this.modActionNotices) {
        if (state2.anchorMid === null) continue;
        let group = byAnchor.get(state2.anchorMid);
        if (!group) {
          group = [];
          byAnchor.set(state2.anchorMid, group);
        }
        group.push([noticeId, state2]);
      }
      for (const [anchorMid, group] of byAnchor) {
        const row = this.findMountedRowByMid(anchorMid);
        if (!row) continue;
        const host = this.findModActionHost(row);
        const existing = Array.from(host.children).filter((child) => child instanceof HTMLElement && child.classList.contains(MOD_ACTION_BLOCK_CLASS));
        const alreadyCurrent = existing.length === group.length && existing.every((block, index) => {
          const [noticeId, state2] = group[index];
          return block.getAttribute(MOD_ACTION_ANCHOR_ATTRIBUTE) === anchorMid && block.getAttribute(MOD_ACTION_ID_ATTRIBUTE) === noticeId && block.getAttribute(MOD_ACTION_SIGNATURE_ATTRIBUTE) === this.modActionSignature(state2.notice);
        });
        if (alreadyCurrent) continue;
        existing.forEach((block) => block.remove());
        for (const [noticeId, state2] of group) {
          host.appendChild(this.buildModActionBlock(noticeId, state2.notice, state2.callbacks, anchorMid));
        }
      }
    }
    pruneStrayModActionBlocks() {
      const root = this.observedRoot;
      if (!root) return;
      root.querySelectorAll(`.${MOD_ACTION_BLOCK_CLASS}`).forEach((block) => {
        const noticeId = block.getAttribute(MOD_ACTION_ID_ATTRIBUTE);
        const anchorMid = block.getAttribute(MOD_ACTION_ANCHOR_ATTRIBUTE);
        const row = block.closest(ROW_SELECTOR);
        if (!noticeId || !anchorMid || !row || row.dataset.kickflowMid !== anchorMid || !this.modActionNotices.has(noticeId)) {
          block.remove();
        }
      });
    }
    findNewestMountedNativeRow() {
      return this.findLiveRowAtOrBefore(void 0);
    }
    /** Newest mounted row that is not itself a removed message, optionally no newer than `maxSeq`.
     * A removed message's row is a bad host for a notice: its native content holder is hidden and a
     * banned user's row is dropped by Kick moments later (the moderator usually bans right after the
     * offending line, so that row is very often the newest one). */
    findLiveRowAtOrBefore(maxSeq) {
      if (this.passIndex) {
        let found = null;
        for (const entry of this.passIndex.ordered) {
          if (entry.preserved) continue;
          if (maxSeq != null && entry.seq > maxSeq) continue;
          if (found && entry.seq <= found.seq) continue;
          found = entry;
        }
        return found ? { mid: found.mid, row: found.row, seq: found.seq } : null;
      }
      let newest = null;
      document.querySelectorAll(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid]`).forEach((row) => {
        const mid = row.dataset.kickflowMid;
        if (!mid) return;
        const message2 = this.store.getMessageById(mid);
        const seq = message2?.seq;
        if (seq == null || message2?.preserved) return;
        if (maxSeq != null && seq > maxSeq) return;
        if (newest && seq <= newest.seq) return;
        newest = { mid, row, seq };
      });
      return newest;
    }
    modActionSignature(notice) {
      return JSON.stringify({
        kind: notice.kind,
        moderator: notice.moderator,
        durationMin: notice.durationMin,
        count: notice.count,
        victims: notice.victims
      });
    }
    buildModActionBlock(noticeId, notice, callbacks, anchorMid) {
      const block = document.createElement("div");
      block.className = `${MOD_ACTION_BLOCK_CLASS} ${MOD_ACTION_SURFACE_CLASS} ${MOD_ACTION_KIND_CLASS_PREFIX}${notice.kind}`;
      block.setAttribute(MOD_ACTION_ANCHOR_ATTRIBUTE, anchorMid);
      block.setAttribute(MOD_ACTION_ID_ATTRIBUTE, noticeId);
      block.setAttribute(MOD_ACTION_SIGNATURE_ATTRIBUTE, this.modActionSignature(notice));
      const message2 = {
        id: `mod-action:${noticeId}`,
        chatroomId: 0,
        content: "",
        type: "mod-action",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        sender: {
          id: 0,
          username: notice.moderator ?? "",
          slug: "",
          identity: { color: "", badges: [], badgesV2: [] }
        },
        systemEvent: {
          kind: "mod-action",
          actionKind: notice.kind,
          moderator: notice.moderator,
          durationMin: notice.durationMin,
          victims: notice.victims,
          count: notice.count
        },
        preserved: false
      };
      block.appendChild(buildMessageElement(message2, {
        onJumpToMessage: callbacks.onJump,
        onOpenRemovedPanel: callbacks.onOpenPanel
      }));
      return block;
    }
    reanchorGhost(id) {
      const message2 = this.store.getMessageById(id);
      if (!message2 || !this.isGhostCandidateMessage(message2)) {
        this.forgetGhost(id);
        return;
      }
      if (this.isMessageMounted(id)) {
        this.ghostsNeeded.delete(id);
        this.removeGhostFromAnchor(id);
        return;
      }
      const anchor = this.resolveAnchor(message2);
      if (!anchor) {
        this.removeGhostFromAnchor(id);
        this.ghostsNeeded.add(id);
        return;
      }
      const previousAnchor = this.ghostAnchorById.get(id);
      if (previousAnchor === anchor.mid && this.isGhostMountedUnderAnchor(id, anchor.row)) {
        this.ghostsNeeded.delete(id);
        return;
      }
      this.removeGhostFromAnchor(id);
      this.ghostAnchorById.set(id, anchor.mid);
      let set = this.ghostsByAnchor.get(anchor.mid);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.ghostsByAnchor.set(anchor.mid, set);
      }
      set.add(id);
      this.ghostsNeeded.delete(id);
      this.injectGhostBlock(anchor.row, anchor.mid);
    }
    resolveAnchor(bannedMessage) {
      const bannedSeq = bannedMessage.seq;
      if (bannedSeq == null) return null;
      let previous = null;
      let next = null;
      const consider = (mid, row, seq) => {
        if (seq < bannedSeq && (!previous || seq > previous.seq)) previous = { mid, row, seq };
        if (seq > bannedSeq && (!next || seq < next.seq)) next = { mid, row, seq };
      };
      if (this.passIndex) {
        for (const entry of this.passIndex.ordered) {
          if (entry.mid === bannedMessage.id || entry.ghostCandidate) continue;
          consider(entry.mid, entry.row, entry.seq);
        }
      } else {
        document.querySelectorAll(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid]`).forEach((row) => {
          const mid = row.dataset.kickflowMid;
          if (!mid || mid === bannedMessage.id || this.isGhostCandidate(mid)) return;
          const seq = this.store.getMessageSeq(mid);
          if (seq == null) return;
          consider(mid, row, seq);
        });
      }
      const chosen = previous ?? next;
      if (!chosen || Math.abs(chosen.seq - bannedSeq) > ANCHOR_MAX_SEQ_DISTANCE) return null;
      return { mid: chosen.mid, row: chosen.row };
    }
    reapplyGhostsForAnchor(anchorMid, row) {
      if (this.isGhostCandidate(anchorMid)) {
        if (this.ghostsByAnchor.has(anchorMid)) this.scheduleAnchorPass();
        return;
      }
      if (!this.ghostsByAnchor.has(anchorMid)) return;
      this.injectGhostBlock(row, anchorMid);
    }
    injectGhostBlock(anchorRow, anchorMid) {
      const ids = Array.from(this.ghostsByAnchor.get(anchorMid) ?? []).filter((id) => this.isGhostCandidate(id)).sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0)).slice(-MAX_GHOSTS_PER_ANCHOR);
      const host = this.findGhostHost(anchorRow);
      const existing = host.querySelector(`:scope > .${GHOST_BLOCK_CLASS}`);
      const existingIds = existing?.dataset.kickflowGhostIds?.split(",").filter(Boolean) ?? [];
      if (existing && existingIds.join(",") === ids.join(",")) return;
      existing?.remove();
      if (ids.length === 0) return;
      const block = document.createElement("div");
      block.className = GHOST_BLOCK_CLASS;
      block.dataset.kickflowGhostAnchor = anchorMid;
      block.dataset.kickflowGhostIds = ids.join(",");
      for (const id of ids) {
        const message2 = this.store.getMessageById(id);
        if (message2) block.appendChild(this.buildGhostRow(message2));
      }
      host.appendChild(block);
    }
    findGhostHost(row) {
      return Array.from(row.children).find((child) => child instanceof HTMLElement && child.classList.contains(NATIVE_ROW_GROUP_CLASS)) ?? row;
    }
    /** Mount moderator notices under Kick's native content element so the notice inherits the same
     * typography and horizontal origin as the neighboring message. The anchor remains the native
     * row, so virtualization still removes and restores the notice with that row. */
    findModActionHost(row) {
      return row.querySelector(NATIVE_CONTENT_SELECTOR) ?? this.findGhostHost(row);
    }
    buildGhostRow(message2) {
      const row = document.createElement("div");
      row.className = GHOST_ROW_CLASS;
      row.dataset.kickflowGhostMid = message2.id;
      const time = document.createElement("span");
      time.className = "kickflow-ghost-row__time";
      const createdAt = new Date(message2.createdAt);
      time.textContent = Number.isNaN(createdAt.getTime()) ? "" : createdAt.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
      const badges = document.createElement("span");
      badges.className = "kickflow-ghost-row__badges";
      appendBadges(badges, mergeIdentityBadges(message2.sender.identity));
      const username = document.createElement("span");
      username.className = "kickflow-ghost-row__username";
      const displayName = message2.sender.displayName || message2.sender.username;
      username.textContent = displayName;
      wireUsernameProfileLink(username, message2.sender, displayName, "kickflow-ghost-row__username--link");
      username.style.color = message2.sender.identity.color || "inherit";
      const separator = document.createElement("span");
      separator.className = "kickflow-ghost-row__separator";
      separator.textContent = ": ";
      const content = document.createElement("span");
      content.className = "kickflow-ghost-row__content";
      appendParsedContent(content, message2.content);
      row.append(time, badges, username, separator, content);
      applyPreservedMarking(row, message2);
      return row;
    }
    removeGhostFromAnchor(id) {
      const anchorMid = this.ghostAnchorById.get(id);
      if (!anchorMid) return;
      this.ghostAnchorById.delete(id);
      const ids = this.ghostsByAnchor.get(anchorMid);
      ids?.delete(id);
      if (!ids || ids.size === 0) {
        this.ghostsByAnchor.delete(anchorMid);
        this.findMountedRowByMid(anchorMid)?.querySelector(`.${GHOST_BLOCK_CLASS}`)?.remove();
        return;
      }
      const row = this.findMountedRowByMid(anchorMid);
      if (row) this.injectGhostBlock(row, anchorMid);
    }
    isMessageMounted(id) {
      return this.findMountedRowByMid(id) !== null;
    }
    findMountedRowByMid(id) {
      if (this.passIndex) return this.passIndex.byMid.get(id) ?? null;
      return document.querySelector(
        `${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid="${CSS.escape(id)}"]`
      );
    }
    /** One walk over the mounted native rows for a whole anchor pass. An attribute selector is not
     * indexed, so each per-ghost lookup used to walk the whole document: a pass with 50 pending
     * ghosts made 100+ document-wide scans, and a pass runs on every chat message while any ghost
     * is pending (2026-11-11). Ghost and notice blocks are not rows, so the index stays valid while
     * the pass inserts and removes them. */
    buildMountedIndex() {
      const byMid = /* @__PURE__ */ new Map();
      const ordered = [];
      document.querySelectorAll(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid]`).forEach((row) => {
        const mid = row.dataset.kickflowMid;
        if (!mid) return;
        if (!byMid.has(mid)) byMid.set(mid, row);
        const message2 = this.store.getMessageById(mid);
        if (message2?.seq == null) return;
        ordered.push({ mid, row, seq: message2.seq, ghostCandidate: this.isGhostCandidateMessage(message2), preserved: message2.preserved });
      });
      return { byMid, ordered };
    }
    isGhostMountedUnderAnchor(id, anchorRow) {
      return anchorRow.querySelector(`[data-kickflow-ghost-mid="${CSS.escape(id)}"]`) !== null;
    }
    clearGhosts() {
      if (this.reanchorTimer != null) {
        window.clearTimeout(this.reanchorTimer);
        this.reanchorTimer = null;
      }
      this.observedRoot?.querySelectorAll(`.${GHOST_BLOCK_CLASS}`).forEach((node) => node.remove());
      this.ghostsNeeded.clear();
      this.ghostAnchorById.clear();
      this.ghostsByAnchor.clear();
    }
  };

  // src/content/chat/active-chatters-badges.ts
  var BADGE_CLASS = "kickflow-active-chatters-badge";
  var INJECTED_SELECTOR2 = `.${BADGE_CLASS}`;
  var USER_CARD_ACTIVATION_KEYS = /* @__PURE__ */ new Set(["Enter", " "]);
  var PANEL_ANCESTOR_LIMIT = 8;
  var PANEL_RESOLVE_WAIT_MS = 5e3;
  function usernameElementIn(row) {
    return row.querySelector(ACTIVE_CHATTERS_USERNAME_SELECTOR) ?? row.querySelector(ACTIVE_CHATTERS_USERNAME_FALLBACK_SELECTOR);
  }
  function isInsideChatMessageList(element) {
    return element.closest(SELECTORS.chatMessagesContainer) !== null;
  }
  function isLooseChatterButton(button) {
    const item = button.parentElement;
    const list = item?.parentElement;
    if (item?.tagName !== "LI" || list?.tagName !== "UL") return false;
    return usernameElementIn(button) !== null;
  }
  function listChatterRows(root) {
    const seen = /* @__PURE__ */ new Set();
    const rows = [];
    const add = (row) => {
      if (seen.has(row) || isInsideChatMessageList(row) || !usernameElementIn(row)) return;
      seen.add(row);
      rows.push(row);
    };
    root.querySelectorAll(ACTIVE_CHATTERS_ROW_SELECTOR).forEach(add);
    root.querySelectorAll(ACTIVE_CHATTERS_ROW_FALLBACK_SELECTOR).forEach((row) => {
      if (isLooseChatterButton(row)) add(row);
    });
    return rows;
  }
  function isRejectedPanel(element) {
    return element === document.body || element === document.documentElement || element.matches(SELECTORS.chatMessagesContainer);
  }
  function panelCandidates(search) {
    const candidates = [];
    let node = search.parentElement;
    for (let depth = 0; depth < PANEL_ANCESTOR_LIMIT && node; depth += 1) {
      if (node === document.body || node === document.documentElement) break;
      if (!isRejectedPanel(node) && listChatterRows(node).length > 0) candidates.push(node);
      node = node.parentElement;
    }
    return candidates;
  }
  function panelFromSearch(search) {
    const candidates = panelCandidates(search);
    return candidates.find((element) => element.matches(ACTIVE_CHATTERS_PANEL_SELECTOR)) ?? candidates.find((element) => element.tagName === "SECTION") ?? candidates.find((element) => element.matches('[role="dialog"]')) ?? candidates[0] ?? null;
  }
  function chatterRowFromTarget(target, root) {
    const exact = target.closest(ACTIVE_CHATTERS_ROW_SELECTOR);
    if (exact && root.contains(exact) && !isInsideChatMessageList(exact) && usernameElementIn(exact)) return exact;
    const button = target.closest("button");
    if (!(button instanceof HTMLElement) || !root.contains(button)) return null;
    if (isInsideChatMessageList(button) || !isLooseChatterButton(button)) return null;
    return button;
  }
  var ActiveChattersBadgesController = class {
    constructor(lifecycle, store, removedPanel) {
      this.store = store;
      this.removedPanel = removedPanel;
      this.observer = null;
      this.observedRoot = null;
      this.missingPanelTimerId = null;
      this.missingPanelWatchStarted = false;
      this.warnedMissingPanel = false;
      this.disposed = false;
      this.handlePanelActivation = (event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest(INJECTED_SELECTOR2)) return;
        const root = this.observedRoot;
        if (!root) return;
        const row = chatterRowFromTarget(target, root);
        if (!row) return;
        const username = usernameElementIn(row)?.textContent?.trim() ?? "";
        const slug = username.toLowerCase();
        if (!username || !isSafeKickSlug(slug)) return;
        if (event.type === "keydown") {
          const keyboardEvent = event;
          if (!USER_CARD_ACTIVATION_KEYS.has(keyboardEvent.key)) return;
          keyboardEvent.preventDefault();
          keyboardEvent.stopImmediatePropagation();
          const rect = row.getBoundingClientRect();
          void openUserCard(slug, username, rect.left, rect.bottom, null);
          return;
        }
        if (event.type !== "click") return;
        const mouseEvent = event;
        mouseEvent.preventDefault();
        mouseEvent.stopImmediatePropagation();
        void openUserCard(slug, username, mouseEvent.clientX, mouseEvent.clientY, null);
      };
      const attach = () => this.attachToCurrentPanel();
      attach();
      visibleInterval(lifecycle, attach, 1e3);
      lifecycle.add(() => this.dispose());
    }
    reconcileAll() {
      const root = this.observedRoot;
      if (!root) return;
      root.querySelectorAll(INJECTED_SELECTOR2).forEach((node) => node.remove());
      listChatterRows(root).forEach((row) => {
        const usernameElement = usernameElementIn(row);
        const label = usernameElement?.textContent?.trim() ?? "";
        if (!usernameElement || !label) return;
        const slug = this.store.resolvePreservedSlugForUsername(label);
        if (!slug) return;
        const matches = this.store.getPreservedForSlug(slug);
        if (matches.length === 0) return;
        const badge2 = document.createElement("span");
        badge2.className = `kickflow-badge-role ${BADGE_CLASS}`;
        badge2.dataset.kickflowSlug = slug;
        badge2.setAttribute("role", "button");
        badge2.tabIndex = 0;
        badge2.textContent = t("chatters.removed_count", { n: matches.length });
        badge2.setAttribute("aria-label", t("chatters.open_removed", { name: label, n: matches.length }));
        badge2.addEventListener("click", (event) => {
          event.stopPropagation();
          this.removedPanel.showUserFilter(slug, label);
        });
        badge2.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          this.removedPanel.showUserFilter(slug, label);
        });
        row.append(badge2);
      });
    }
    findCurrentPanel() {
      const searches = document.querySelectorAll(ACTIVE_CHATTERS_SEARCH_SELECTOR);
      let loose = null;
      for (const search of searches) {
        const panel = panelFromSearch(search);
        if (!panel) continue;
        if (panel.matches(ACTIVE_CHATTERS_PANEL_SELECTOR)) return panel;
        if (!loose) loose = panel;
      }
      return loose;
    }
    attachToCurrentPanel() {
      const root = this.findCurrentPanel();
      if (!root) {
        this.armMissingPanelWarning();
        this.disconnectObserver(true);
        return;
      }
      this.clearMissingPanelTimer();
      if (root === this.observedRoot) {
        this.reconcileAll();
        return;
      }
      this.disconnectObserver(true);
      this.observedRoot = root;
      this.attachPanelActivationListeners(root);
      this.observer = new MutationObserver((mutations) => {
        if (mutations.every((mutation) => this.isOwnedMutation(mutation))) return;
        this.reconcileAll();
      });
      this.observer.observe(root, { childList: true, subtree: true });
      this.reconcileAll();
    }
    /** One clock per page load, started the first time the search field is seen with no panel. */
    armMissingPanelWarning() {
      if (this.disposed || this.missingPanelWatchStarted || this.warnedMissingPanel) return;
      if (!document.querySelector(ACTIVE_CHATTERS_SEARCH_SELECTOR)) return;
      this.missingPanelWatchStarted = true;
      this.missingPanelTimerId = window.setTimeout(() => this.warnIfPanelStillMissing(), PANEL_RESOLVE_WAIT_MS);
    }
    warnIfPanelStillMissing() {
      this.missingPanelTimerId = null;
      if (this.disposed || this.warnedMissingPanel) return;
      if (this.findCurrentPanel()) return;
      if (!document.querySelector(ACTIVE_CHATTERS_SEARCH_SELECTOR)) return;
      this.warnedMissingPanel = true;
      logger.warn(
        `active-chatters: ${ACTIVE_CHATTERS_SEARCH_SELECTOR} rendered, but no panel containing chatter rows was found within 5s. Badge and user-card attachment is inactive.`
      );
    }
    clearMissingPanelTimer() {
      if (this.missingPanelTimerId === null) return;
      window.clearTimeout(this.missingPanelTimerId);
      this.missingPanelTimerId = null;
    }
    isOwnedMutation(mutation) {
      if (mutation.type !== "childList") return false;
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return changed.length > 0 && changed.every(
        (node) => node instanceof Element && node.matches(INJECTED_SELECTOR2)
      );
    }
    attachPanelActivationListeners(root) {
      root.addEventListener("click", this.handlePanelActivation, true);
      root.addEventListener("keydown", this.handlePanelActivation, true);
    }
    disconnectObserver(clearBadges) {
      const root = this.observedRoot;
      if (root) {
        root.removeEventListener("click", this.handlePanelActivation, true);
        root.removeEventListener("keydown", this.handlePanelActivation, true);
      }
      if (clearBadges) root?.querySelectorAll(INJECTED_SELECTOR2).forEach((node) => node.remove());
      this.observer?.disconnect();
      this.observer = null;
      this.observedRoot = null;
    }
    dispose() {
      this.disposed = true;
      this.clearMissingPanelTimer();
      this.disconnectObserver(true);
    }
  };

  // src/content/shared/text-fold.ts
  var TURKISH_FOLD = Object.freeze({
    \u0130: "i",
    I: "i",
    \u0131: "i",
    \u015E: "s",
    \u015F: "s",
    \u011E: "g",
    \u011F: "g",
    \u00DC: "u",
    \u00FC: "u",
    \u00D6: "o",
    \u00F6: "o",
    \u00C7: "c",
    \u00E7: "c"
  });
  var COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
  var genericFoldByCodePoint = /* @__PURE__ */ new Map();
  function foldGenericCodePoint(char, codePoint) {
    const cached2 = genericFoldByCodePoint.get(codePoint);
    if (cached2 !== void 0) return cached2;
    const stripped = char.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase();
    const folded = stripped.length === char.length ? stripped : char;
    genericFoldByCodePoint.set(codePoint, folded);
    return folded;
  }
  function foldSearchText(value) {
    let result = "";
    for (const char of value) {
      const turkish = TURKISH_FOLD[char];
      if (turkish !== void 0) {
        result += turkish;
        continue;
      }
      result += foldGenericCodePoint(char, char.codePointAt(0));
    }
    return result;
  }
  var SENDER_FILTER_PREFIX = "from:";
  function parseSearchQuery(query) {
    const requiredTerms = [];
    const excludedTerms = [];
    const senderFilters = [];
    let index = 0;
    while (index < query.length) {
      while (index < query.length && isWhitespace(query[index])) index += 1;
      if (index >= query.length) break;
      const negated = query[index] === "-" && index + 1 < query.length && !isWhitespace(query[index + 1]);
      if (negated) index += 1;
      const hasSenderPrefix = !negated && foldSearchText(query.slice(index, index + SENDER_FILTER_PREFIX.length)) === SENDER_FILTER_PREFIX && index + SENDER_FILTER_PREFIX.length < query.length && !isWhitespace(query[index + SENDER_FILTER_PREFIX.length]);
      if (hasSenderPrefix) index += SENDER_FILTER_PREFIX.length;
      const token = readToken(query, index);
      index = token.nextIndex;
      const foldedValue = foldSearchText(token.value);
      if (foldedValue.length === 0) continue;
      if (hasSenderPrefix) {
        senderFilters.push(foldedValue);
      } else if (negated) {
        excludedTerms.push(foldedValue);
      } else {
        requiredTerms.push(foldedValue);
      }
    }
    return { requiredTerms, excludedTerms, senderFilters };
  }
  function readToken(query, startIndex) {
    if (query[startIndex] === '"') {
      const phraseStart = startIndex + 1;
      const closingQuote = query.indexOf('"', phraseStart);
      if (closingQuote < 0) return { value: query.slice(phraseStart), nextIndex: query.length };
      return { value: query.slice(phraseStart, closingQuote), nextIndex: closingQuote + 1 };
    }
    let endIndex = startIndex;
    while (endIndex < query.length && !isWhitespace(query[endIndex])) endIndex += 1;
    return { value: query.slice(startIndex, endIndex), nextIndex: endIndex };
  }
  function isWhitespace(value) {
    return /\s/.test(value);
  }

  // src/content/chat/search-highlight.ts
  var SEARCH_HIT_CLASS = "kickflow-search__hit";
  var EXCLUDED_SUBTREE_SELECTOR = ".kickflow-user-messages__time, .kickflow-user-messages__reply, .kickflow-user-messages__name";
  var SENDER_NAME_SELECTOR = ".kickflow-user-messages__name";
  function highlightSearchQuery(container, query) {
    highlightTerms(container, query.requiredTerms);
    for (const senderName of container.querySelectorAll(SENDER_NAME_SELECTOR)) {
      highlightTerms(senderName, [...query.requiredTerms, ...query.senderFilters]);
    }
  }
  function highlightTerms(container, terms) {
    if (terms.length === 0) return;
    const nodes = collectHighlightableNodes(container);
    const values = nodes.map((node) => node instanceof Text ? node.data : node.alt);
    const ranges = findMergedMatchRanges(foldSearchText(values.join("")), terms);
    let offset = 0;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const end = offset + values[index].length;
      const localRanges = ranges.filter((range) => range.start < end && range.end > offset).map((range) => ({ start: Math.max(0, range.start - offset), end: Math.min(end, range.end) - offset }));
      if (localRanges.length > 0) {
        if (node instanceof Text) {
          if (!node.parentElement?.closest(`mark.${SEARCH_HIT_CLASS}`)) wrapMatchRanges(node, localRanges);
        } else {
          (node.closest(".kickflow-emote-box") ?? node).classList.add(SEARCH_HIT_CLASS);
        }
      }
      offset = end;
    }
  }
  function collectHighlightableNodes(container) {
    const nodeFilter = container.ownerDocument.defaultView?.NodeFilter;
    if (!nodeFilter) return [];
    const nodes = [];
    const walker = container.ownerDocument.createTreeWalker(
      container,
      nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === node.ELEMENT_NODE) {
            const element = node;
            if (element.matches(EXCLUDED_SUBTREE_SELECTOR)) return nodeFilter.FILTER_REJECT;
            return element.matches("img.kickflow-emote") ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_SKIP;
          }
          return nodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }
  function findMergedMatchRanges(foldedText, terms) {
    const ranges = [];
    for (const term of terms) {
      if (term.length === 0) continue;
      let searchFrom = 0;
      while (searchFrom <= foldedText.length - term.length) {
        const start = foldedText.indexOf(term, searchFrom);
        if (start < 0) break;
        ranges.push({ start, end: start + term.length });
        searchFrom = start + 1;
      }
    }
    if (ranges.length === 0) return [];
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [{ ...ranges[0] }];
    for (let index = 1; index < ranges.length; index += 1) {
      const range = ranges[index];
      const previous = merged[merged.length - 1];
      if (range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }
    return merged;
  }
  function wrapMatchRanges(textNode, ranges) {
    const source = textNode.data;
    const ownerDocument = textNode.ownerDocument;
    const fragment = ownerDocument.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) {
        fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor, range.start)));
      }
      const mark = ownerDocument.createElement("mark");
      mark.className = SEARCH_HIT_CLASS;
      mark.textContent = source.slice(range.start, range.end);
      fragment.appendChild(mark);
      cursor = range.end;
    }
    if (cursor < source.length) {
      fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor)));
    }
    textNode.replaceWith(fragment);
  }

  // src/content/chat/user-message-archive.ts
  var ARCHIVE_MAX_MESSAGES = 5e3;
  var ARCHIVE_MAX_AGE_MS = 30 * 60 * 1e3;
  var ARCHIVE_PER_USER_CAP = 100;
  var ARCHIVE_COMPACT_MIN_HEAD = 1024;
  var SEARCH_RESULT_LIMIT = 100;
  function buildFoldedHaystack(text) {
    const searchableText = text.replace(EMOTE_TOKEN_RE, "$1");
    return foldSearchText(searchableText);
  }
  function readReplyTo(message2) {
    const context = message2.replyContext;
    const user = context?.replyToUser?.trim();
    const text = context?.replyToText;
    if (!user || !text) return null;
    return { user, text, messageId: context?.replyToMessageId ?? null };
  }
  var UserMessageArchive = class {
    constructor(options = {}) {
      this.records = [];
      this.head = 0;
      this.liveCount = 0;
      this.slotById = /* @__PURE__ */ new Map();
      this.recordsById = /* @__PURE__ */ new Map();
      /** Folded search haystack per message id. Kept off `ArchivedMessage` so search/DOM copies
       * never leak the fold into the public shape. */
      this.foldedHaystacks = /* @__PURE__ */ new Map();
      /** Folded sender name per message id. Kept separate so `from:` can never match body text. */
      this.foldedSenderNames = /* @__PURE__ */ new Map();
      this.recordsByUserId = /* @__PURE__ */ new Map();
      this.userIdByName = /* @__PURE__ */ new Map();
      this.namesByUserId = /* @__PURE__ */ new Map();
      this.wasTruncated = false;
      this.maxMessages = Math.max(0, options.maxMessages ?? ARCHIVE_MAX_MESSAGES);
      this.maxAgeMs = options.maxAgeMs ?? ARCHIVE_MAX_AGE_MS;
      this.perUserCap = Math.max(0, options.perUserCap ?? ARCHIVE_PER_USER_CAP);
      this.now = options.now ?? (() => Date.now());
    }
    /** Returns false when the message was rejected (duplicate id, system event, blank text). */
    add(message2) {
      if (message2.systemEvent || this.recordsById.has(message2.id) || message2.content.trim() === "") return false;
      const parsedAt = Date.parse(message2.createdAt);
      const addedAt = this.now();
      const record2 = {
        id: message2.id,
        userId: message2.sender.id,
        username: message2.sender.displayName?.trim() || message2.sender.username,
        at: Number.isFinite(parsedAt) ? parsedAt : addedAt,
        addedAt,
        text: message2.content,
        replyTo: readReplyTo(message2),
        deleted: false
      };
      this.records.push(record2);
      this.slotById.set(record2.id, this.records.length - 1);
      this.liveCount += 1;
      this.recordsById.set(record2.id, record2);
      this.foldedHaystacks.set(record2.id, buildFoldedHaystack(record2.text));
      this.foldedSenderNames.set(record2.id, foldSearchText(record2.username));
      let userRecords = this.recordsByUserId.get(record2.userId);
      if (!userRecords) {
        userRecords = [];
        this.recordsByUserId.set(record2.userId, userRecords);
      }
      userRecords.push(record2);
      this.indexSenderName(record2.userId, message2.sender.slug);
      this.indexSenderName(record2.userId, message2.sender.username);
      this.drainExpiredFromHead();
      this.enforcePerUserCap(record2.userId);
      this.enforceGlobalCap();
      return true;
    }
    /** Returns the archived user's ID for a case-insensitive slug or username. */
    getUserIdByName(name) {
      const key = normalizeChatIdentity(name);
      if (!key) return null;
      return this.userIdByName.get(key) ?? null;
    }
    /** Newest → oldest, capped at `limit`. `total` counts matches before the cap. */
    search(query, limit = SEARCH_RESULT_LIMIT) {
      if (!hasQueryTerms(query) || limit <= 0) return { matches: [], total: 0, widened: false };
      const strict = this.collectMatches(query, limit, false);
      if (strict.total > 0 || !hasPositiveTerms(query)) return { ...strict, widened: false };
      const widened = this.collectMatches(query, limit, true);
      return { ...widened, widened: widened.total > 0 };
    }
    /** Oldest → newest. Returns a fresh array; callers must never mutate internal state. */
    getByUserId(userId) {
      const records = this.recordsByUserId.get(userId);
      return records ? records.map((record2) => ({ ...record2 })) : [];
    }
    /** No-op when the id is unknown. Idempotent. */
    markDeleted(messageId) {
      const record2 = this.recordsById.get(messageId);
      if (record2) record2.deleted = true;
    }
    /** Drops every record older than maxAgeMs. Safe to call at any time. */
    sweepExpired() {
      const cutoff = this.now() - this.maxAgeMs;
      let slot = 0;
      while (slot < this.records.length) {
        const record2 = this.records[slot];
        if (!record2) {
          slot += 1;
          continue;
        }
        if (record2.addedAt >= cutoff) {
          slot += 1;
          continue;
        }
        slot = Math.max(0, slot - this.evict(record2) + 1);
      }
    }
    /** True once ANY record has been evicted for ANY reason (age, global cap, per-user cap). */
    get truncated() {
      return this.wasTruncated;
    }
    get size() {
      return this.liveCount;
    }
    /** Test-only getter for the compaction invariant test. */
    get internalSlotCount() {
      return this.records.length;
    }
    /** Test-only getter: folded haystack entries must track live records across every eviction. */
    get internalFoldedHaystackCount() {
      return this.foldedHaystacks.size;
    }
    /** Test-only getter: folded sender-name entries must track live records across every eviction. */
    get internalFoldedSenderNameCount() {
      return this.foldedSenderNames.size;
    }
    /** Full reset, including `truncated`. */
    clear() {
      this.records = [];
      this.head = 0;
      this.liveCount = 0;
      this.slotById.clear();
      this.recordsById.clear();
      this.foldedHaystacks.clear();
      this.foldedSenderNames.clear();
      this.recordsByUserId.clear();
      this.userIdByName.clear();
      this.namesByUserId.clear();
      this.wasTruncated = false;
    }
    indexSenderName(userId, name) {
      const key = normalizeChatIdentity(name);
      if (!key) return;
      this.userIdByName.set(key, userId);
      let names = this.namesByUserId.get(userId);
      if (!names) {
        names = /* @__PURE__ */ new Set();
        this.namesByUserId.set(userId, names);
      }
      names.add(key);
    }
    removeUserNameIndex(userId) {
      const names = this.namesByUserId.get(userId);
      if (!names) return;
      for (const name of names) {
        if (this.userIdByName.get(name) === userId) this.userIdByName.delete(name);
      }
      this.namesByUserId.delete(userId);
    }
    drainExpiredFromHead() {
      const cutoff = this.now() - this.maxAgeMs;
      while (this.head < this.records.length) {
        const record2 = this.records[this.head];
        if (!record2) {
          this.head += 1;
          continue;
        }
        if (record2.addedAt >= cutoff) return;
        this.evict(record2);
      }
    }
    enforcePerUserCap(userId) {
      const records = this.recordsByUserId.get(userId);
      if (!records) return;
      while (records.length > this.perUserCap) {
        const oldest = records[0];
        if (!oldest) return;
        this.evict(oldest);
      }
    }
    enforceGlobalCap() {
      while (this.liveCount > this.maxMessages) {
        const oldest = this.records[this.head];
        if (!oldest) return;
        this.evict(oldest);
      }
    }
    evict(record2) {
      const slot = this.slotById.get(record2.id);
      if (slot === void 0 || this.records[slot] !== record2) return 0;
      this.records[slot] = null;
      this.slotById.delete(record2.id);
      this.recordsById.delete(record2.id);
      this.foldedHaystacks.delete(record2.id);
      this.foldedSenderNames.delete(record2.id);
      const userRecords = this.recordsByUserId.get(record2.userId);
      if (userRecords) {
        const userIndex = userRecords.indexOf(record2);
        if (userIndex >= 0) userRecords.splice(userIndex, 1);
        if (userRecords.length === 0) {
          this.recordsByUserId.delete(record2.userId);
          this.removeUserNameIndex(record2.userId);
        }
      }
      this.liveCount -= 1;
      this.wasTruncated = true;
      return this.advanceHeadAndCompact();
    }
    advanceHeadAndCompact() {
      while (this.head < this.records.length && this.records[this.head] === null) {
        this.head += 1;
      }
      if (this.head < ARCHIVE_COMPACT_MIN_HEAD || this.head * 2 < this.records.length) return 0;
      const oldHead = this.head;
      this.records = this.records.slice(oldHead);
      for (const [id, slot] of this.slotById) {
        this.slotById.set(id, slot - oldHead);
      }
      this.head = 0;
      return oldHead;
    }
    collectMatches(query, limit, senderSubsequenceOnly) {
      const matches = [];
      let total = 0;
      for (let slot = this.records.length - 1; slot >= this.head; slot -= 1) {
        const record2 = this.records[slot];
        if (!record2 || !this.recordMatches(record2, query, senderSubsequenceOnly)) continue;
        total += 1;
        if (matches.length < limit) matches.push({ ...record2 });
      }
      return { matches, total };
    }
    recordMatches(record2, query, senderSubsequenceOnly) {
      const haystack = this.foldedHaystacks.get(record2.id);
      const senderName = this.foldedSenderNames.get(record2.id);
      if (haystack === void 0 || senderName === void 0) return false;
      const containsTerm = (term) => haystack.includes(term) || senderName.includes(term);
      if (query.excludedTerms.some(containsTerm)) return false;
      if (senderSubsequenceOnly) {
        return query.requiredTerms.every((term) => isSubsequence(term, senderName)) && matchesAnySenderFilter(query.senderFilters, senderName, isSubsequence);
      }
      return query.requiredTerms.every(containsTerm) && matchesAnySenderFilter(query.senderFilters, senderName, (term, name) => name.includes(term));
    }
  };
  function hasQueryTerms(query) {
    return query.requiredTerms.length > 0 || query.excludedTerms.length > 0 || query.senderFilters.length > 0;
  }
  function hasPositiveTerms(query) {
    return query.requiredTerms.length > 0 || query.senderFilters.length > 0;
  }
  function matchesAnySenderFilter(senderFilters, senderName, matches) {
    if (senderFilters.length === 0) return true;
    return senderFilters.some((filter) => matches(filter, senderName));
  }
  function isSubsequence(needle, haystack) {
    let needleIndex = 0;
    for (let haystackIndex = 0; haystackIndex < haystack.length && needleIndex < needle.length; haystackIndex += 1) {
      if (haystack[haystackIndex] === needle[needleIndex]) needleIndex += 1;
    }
    return needleIndex === needle.length;
  }

  // src/content/chat/message-search.ts
  function getMessageSearchModel(query) {
    const parsedQuery = parseSearchQuery(query);
    const archive = getUserMessageArchive();
    if (!archive) {
      return {
        status: "unavailable",
        query: parsedQuery,
        matches: [],
        total: 0,
        archiveTruncated: false,
        widened: false
      };
    }
    if (query.trim() === "") {
      return {
        status: "idle",
        query: parsedQuery,
        matches: [],
        total: 0,
        archiveTruncated: archive.truncated,
        widened: false
      };
    }
    const { matches, total, widened } = archive.search(parsedQuery, SEARCH_RESULT_LIMIT);
    return { status: "results", query: parsedQuery, matches, total, archiveTruncated: archive.truncated, widened };
  }
  function buildMessageSearchResults(model) {
    const root = document.createElement("div");
    root.className = "kickflow-search__results";
    if (model.status === "unavailable") {
      root.appendChild(note(t("search.unavailable")));
      return root;
    }
    if (model.status === "idle") {
      root.appendChild(note(t("search.hint")));
      return root;
    }
    if (model.matches.length === 0) {
      root.appendChild(note(t("search.empty")));
      return root;
    }
    if (model.widened) root.appendChild(note(t("search.widened")));
    const summary = document.createElement("div");
    summary.className = "kickflow-search__summary";
    summary.textContent = model.total > model.matches.length ? t("search.count_capped", { n: model.total, shown: model.matches.length }) : t("search.count", { n: model.total });
    root.appendChild(summary);
    const body = document.createElement("div");
    body.className = "kickflow-user-messages__body kickflow-search__body";
    for (const message2 of model.matches) {
      const row = buildArchivedMessageRow(message2, {
        clockLabel: formatClock(message2.at),
        showUsername: true
      });
      highlightSearchQuery(row, model.query);
      body.appendChild(row);
    }
    root.appendChild(body);
    if (model.archiveTruncated) root.appendChild(note(t("search.truncated")));
    return root;
  }
  function note(text) {
    const element = document.createElement("div");
    element.className = "kickflow-search__note";
    element.textContent = text;
    return element;
  }

  // src/content/player/hotkey-registry.ts
  var HOTKEY_ACTIONS = ["rewind", "forward", "screenshot", "goLive"];
  var HOTKEY_DEFINITIONS = [
    { action: "rewind", label: "10s back", defaultKey: "ArrowLeft" },
    { action: "forward", label: "10s forward", defaultKey: "ArrowRight" },
    { action: "screenshot", label: "Screenshot", defaultKey: "s" },
    { action: "goLive", label: "Go live", defaultKey: "l" }
  ];
  var NATIVE_KEYS = /* @__PURE__ */ new Set(["c", "t", "f", "m", "k", " ", "i"]);
  var MODIFIER_KEYS = /* @__PURE__ */ new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "CapsLock", "NumLock", "ScrollLock"]);
  var listeners2 = /* @__PURE__ */ new Set();
  var bindings = createDefaultHotkeyBindings();
  function storageKey(action, field) {
    return `kf_hotkey_${action}_${field}`;
  }
  function cloneBindings(value) {
    return Object.fromEntries(
      HOTKEY_ACTIONS.map((action) => [action, { ...value[action] }])
    );
  }
  function emit() {
    const snapshot = getHotkeyBindings();
    for (const listener of listeners2) listener(snapshot);
  }
  function hasCollision(value) {
    return new Set(HOTKEY_ACTIONS.map((action) => value[action].key)).size !== HOTKEY_ACTIONS.length;
  }
  function createDefaultHotkeyBindings() {
    return Object.fromEntries(
      HOTKEY_DEFINITIONS.map(({ action, defaultKey }) => [action, { enabled: true, key: defaultKey }])
    );
  }
  function normalizeHotkeyKey(key) {
    if (!key || MODIFIER_KEYS.has(key)) return null;
    if (key === "Spacebar" || key === "Space") return " ";
    if (key.length === 1) return key.toLowerCase();
    return key;
  }
  function formatHotkeyKey(key) {
    if (key === "ArrowLeft") return "\u2190";
    if (key === "ArrowRight") return "\u2192";
    if (key === "ArrowUp") return "\u2191";
    if (key === "ArrowDown") return "\u2193";
    if (key === " ") return t("common.space");
    if (key === "Escape") return "Esc";
    return key.length === 1 ? key.toUpperCase() : key;
  }
  function isKickNativeHotkey(key) {
    const normalized = normalizeHotkeyKey(key);
    return normalized !== null && NATIVE_KEYS.has(normalized);
  }
  function getHotkeyBindings() {
    return cloneBindings(bindings);
  }
  function getHotkeyBinding(action) {
    return { ...bindings[action] };
  }
  function findHotkeyAction(key) {
    const normalized = normalizeHotkeyKey(key);
    if (normalized === null) return null;
    return HOTKEY_ACTIONS.find((action) => bindings[action].enabled && bindings[action].key === normalized) ?? null;
  }
  function subscribeHotkeyBindings(listener) {
    listeners2.add(listener);
    return () => listeners2.delete(listener);
  }
  function updateHotkeyBinding(action, patch) {
    const next = getHotkeyBindings();
    const normalizedKey = patch.key === void 0 ? next[action].key : normalizeHotkeyKey(patch.key);
    if (normalizedKey === null) return { ok: false, reason: "invalid", bindings: next };
    const conflictingAction = HOTKEY_ACTIONS.find(
      (candidate) => candidate !== action && next[candidate].key === normalizedKey
    );
    if (conflictingAction) {
      return { ok: false, reason: "collision", conflictingAction, bindings: next };
    }
    next[action] = {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : next[action].enabled,
      key: normalizedKey
    };
    bindings = next;
    emit();
    const persisted = {};
    if (typeof patch.enabled === "boolean") persisted[storageKey(action, "enabled")] = next[action].enabled;
    if (patch.key !== void 0) persisted[storageKey(action, "key")] = next[action].key;
    if (Object.keys(persisted).length > 0) void safeStorageSet(persisted);
    return {
      ok: true,
      nativeConflict: patch.key !== void 0 && isKickNativeHotkey(normalizedKey),
      bindings: getHotkeyBindings()
    };
  }
  function resetHotkeyBindings() {
    bindings = createDefaultHotkeyBindings();
    const persisted = {};
    for (const action of HOTKEY_ACTIONS) {
      persisted[storageKey(action, "enabled")] = bindings[action].enabled;
      persisted[storageKey(action, "key")] = bindings[action].key;
    }
    void safeStorageSet(persisted);
    emit();
    return getHotkeyBindings();
  }
  async function loadHotkeyBindings() {
    const keys = HOTKEY_ACTIONS.flatMap((action) => [storageKey(action, "enabled"), storageKey(action, "key")]);
    const stored = await safeStorageGet(keys);
    const next = createDefaultHotkeyBindings();
    for (const action of HOTKEY_ACTIONS) {
      const enabled = stored[storageKey(action, "enabled")];
      const key = stored[storageKey(action, "key")];
      if (typeof enabled === "boolean") next[action].enabled = enabled;
      if (typeof key === "string") {
        const normalized = normalizeHotkeyKey(key);
        if (normalized !== null) next[action].key = normalized;
      }
    }
    bindings = hasCollision(next) ? createDefaultHotkeyBindings() : next;
    emit();
    return getHotkeyBindings();
  }
  var captureActive = false;
  function setHotkeyCaptureActive(active) {
    captureActive = active;
  }
  function isHotkeyCaptureActive() {
    return captureActive;
  }

  // src/content/chat/removed-panel.ts
  var PANEL_CLASS = "kickflow-panel";
  var PANEL_SHELL_CLASS = "kickflow-panel__shell";
  var PANEL_RAIL_CLASS = "kickflow-panel__rail";
  var PANEL_MAIN_CLASS = "kickflow-panel__main";
  var PANEL_HEADER_CLASS = "kickflow-panel__header";
  var PANEL_TITLE_CLASS = "kickflow-panel__title";
  var PANEL_COUNT_CLASS = "kickflow-panel__count";
  var PANEL_BTN_CLASS = "kickflow-panel__btn";
  var PANEL_CLOSE_CLASS = "kickflow-panel__close";
  var PANEL_SETTINGS_CLASS = "kickflow-panel__settings";
  var PANEL_BODY_CLASS = "kickflow-panel__removed-list";
  var FILTER_CHIP_CLASS = "kickflow-panel__filter-chip";
  var REMOVED_ROW_CLASS = "kickflow-removed-row";
  var REMOVED_EMPTY_CLASS = "kickflow-removed-empty";
  var MAX_PANEL_ROWS = REMOVED_LEDGER_CAPACITY;
  var SEARCH_DEBOUNCE_MS = 120;
  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  var DASHBOARD_SECTIONS = [
    { key: "general", labelKey: "tab.general" },
    { key: "removed", labelKey: "tab.removed" },
    { key: "search", labelKey: "tab.search" },
    { key: "chat", labelKey: "tab.chat" },
    { key: "player", labelKey: "tab.player" },
    { key: "rewards", labelKey: "tab.rewards" },
    { key: "hotkeys", labelKey: "tab.shortcuts" },
    { key: "about", labelKey: "tab.about" }
  ];
  var FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "select:not([disabled])",
    "input:not([disabled])",
    "[href]",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  var RemovedMessagesPanel = class {
    constructor(lifecycle, store, getStatusSnapshot) {
      this.getStatusSnapshot = getStatusSnapshot;
      this.flagSaveStatus = null;
      this.flagChangeRevision = 0;
      this.section = null;
      this.shell = null;
      this.main = null;
      this.titleHeading = null;
      this.open = false;
      this.lastSig = "";
      // skip rebuilding the body when its contents are unchanged
      this.renderedLedgerVersion = -2;
      // removed-ledger version the body last rendered
      this.activeSection = "general";
      this.opener = null;
      this.openerId = null;
      this.scrollLockState = null;
      this.dashboardSections = /* @__PURE__ */ new Map();
      this.navButtons = /* @__PURE__ */ new Map();
      this.stats = null;
      this.countChip = null;
      this.chatModeSelect = null;
      this.showDeletedCheckbox = null;
      this.banInlineCheckbox = null;
      this.subscriptionsCheckbox = null;
      this.giftedSubsCheckbox = null;
      this.kicksCheckbox = null;
      this.hostRaidCheckbox = null;
      this.modeChangesCheckbox = null;
      this.chattersBadgesCheckbox = null;
      this.userMessagesCheckbox = null;
      this.quickEmotesCheckbox = null;
      this.searchHotkeyCheckbox = null;
      this.modActionsCheckbox = null;
      this.mentionHighlightCheckbox = null;
      this.modFrameCheckbox = null;
      this.vipFrameCheckbox = null;
      this.mentionStyleButtons = /* @__PURE__ */ new Map();
      this.roleStyleButtons = /* @__PURE__ */ new Map();
      this.highlightColorControls = /* @__PURE__ */ new Map();
      this.roleColorDots = null;
      this.manualUsernameInput = null;
      this.identityNote = null;
      this.autoTheaterCheckbox = null;
      this.captionGuardCheckbox = null;
      this.rewindControlsCheckbox = null;
      this.seekBarCheckbox = null;
      this.liveCatchupCheckbox = null;
      this.qualityLockCheckbox = null;
      this.qualityAlwaysBestCheckbox = null;
      this.screenshotCheckbox = null;
      this.speedControlsCheckbox = null;
      this.fullscreenTerminalCheckbox = null;
      this.floatingStripCheckbox = null;
      this.autoClaimDropsCheckbox = null;
      this.autoClaimDailyRewardCheckbox = null;
      this.hotkeyRows = /* @__PURE__ */ new Map();
      this.hotkeyStatus = null;
      this.captureAction = null;
      this.userFilter = null;
      this.filterChip = null;
      this.searchInput = null;
      this.searchResults = null;
      this.searchRenderHandle = null;
      this.store = store;
      this.render();
      lifecycle.add(subscribeLang(() => this.rebuildForLanguage()));
      visibleInterval(lifecycle, () => {
        if (this.open) this.render();
      }, 1e3);
      lifecycle.addEventListener(document, "keydown", (event) => this.onHotkeyCapture(event), true);
      lifecycle.addEventListener(document, "keydown", (event) => this.onSearchHotkey(event), true);
      lifecycle.addEventListener(document, "keydown", (event) => this.onDashboardKeydown(event), true);
      lifecycle.add(() => this.dispose());
    }
    /** Bootstrap owns persistence; the panel owns the latest change's acknowledgement. */
    dispatchFlag(key, value) {
      const revision2 = ++this.flagChangeRevision;
      window.dispatchEvent(new CustomEvent("kickflow:setFlag", {
        detail: {
          key,
          value,
          onSaved: (ok) => {
            if (revision2 !== this.flagChangeRevision || !this.flagSaveStatus?.isConnected) return;
            this.flagSaveStatus.textContent = ok ? "" : t("popup.save_failed");
            this.flagSaveStatus.hidden = ok;
            this.refreshSettingsControls();
          }
        }
      }));
    }
    /** Binds the currently active channel store without replacing the site-wide dashboard. */
    setStore(store) {
      if (this.store === store) return;
      this.store = store;
      this.userFilter = null;
      this.lastSig = "";
      if (this.searchInput) this.searchInput.value = "";
      this.render();
      this.renderSearchResults();
    }
    /** Toggles the shared dashboard. A different requested section is selected without closing. */
    toggle(section) {
      if (section !== void 0 && this.open && section !== this.activeSection) {
        this.showDashboardSection(section);
        return;
      }
      const opening = !this.open;
      if (section !== void 0) this.activeSection = section;
      this.setOpen(!this.open);
      if (opening && section !== void 0) this.showDashboardSection(section);
    }
    /** Opens the shared dashboard on a specific section. Navbar callers use the General default. */
    showSettings(section = "general") {
      this.activeSection = section;
      this.setOpen(true);
      this.showDashboardSection(section);
    }
    /** Opens Removed on one canonical identity. Native Active Chatters badges use this entry point;
     * the clearable chip is the only way the scoped view persists across panel renders. */
    showUserFilter(slug, label) {
      const normalizedSlug = slug.trim();
      if (!normalizedSlug) return;
      this.userFilter = { slug: normalizedSlug, label: label.trim() || normalizedSlug };
      this.lastSig = "";
      this.showSettings("removed");
      this.render();
    }
    isOpen() {
      return this.open;
    }
    /** O(1): the session's removed ledger size (bans, timeouts, deletes; bounded, oldest out). */
    removedCount() {
      return this.store?.removed.size ?? 0;
    }
    /** Closed, the panel does no work at all: everything it shows sits inside the display:none
     * section, and the footer button's badge reads removedCount() itself. setOpen(true) renders
     * everything before the panel shows, so opening is still instant and current (2026-11-11). */
    render() {
      const section = this.ensureSection();
      const display = this.open ? "flex" : "none";
      if (section.style.display !== display) section.style.display = display;
      setAttributeIfChanged(section, "aria-hidden", this.open ? "false" : "true");
      if (!this.open) return;
      const store = this.store;
      const newestFirst = (records) => [...records].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
      const ledgerVersion = store?.removed.version ?? -1;
      const listUnchanged = ledgerVersion === this.renderedLedgerVersion && this.lastSig !== "";
      const allRemoved = listUnchanged ? [] : newestFirst(store?.removed.toArray() ?? []);
      const removed = listUnchanged ? [] : store && this.userFilter ? newestFirst(store.removed.forSlug(this.userFilter.slug)) : allRemoved;
      const removedTotal = store?.removed.size ?? 0;
      if (this.countChip) {
        const chipText = removedTotal > 0 ? String(removedTotal) : "";
        if (this.countChip.textContent !== chipText) this.countChip.textContent = chipText;
        const chipDisplay = removedTotal > 0 ? "" : "none";
        if (this.countChip.style.display !== chipDisplay) this.countChip.style.display = chipDisplay;
      }
      const removedNav = this.navButtons.get("removed");
      if (removedNav) setAttributeIfChanged(
        removedNav,
        "aria-label",
        removedTotal > 0 ? t("panel.removed_count", { n: removedTotal }) : t("tab.removed")
      );
      this.refreshUserFilterChip();
      this.refreshSettingsControls();
      this.refreshStats();
      if (listUnchanged) return;
      const body = section.querySelector(`.${PANEL_BODY_CLASS}`);
      if (!body) return;
      this.renderedLedgerVersion = ledgerVersion;
      const shown = removed.slice(0, MAX_PANEL_ROWS);
      const sig = `${this.userFilter?.slug ?? ""}${removed.length}${shown.map((message2) => JSON.stringify({
        id: message2.id,
        seq: message2.seq,
        content: message2.content,
        createdAt: message2.createdAt,
        sender: message2.sender,
        preserved: message2.preserved,
        preservedReason: message2.preservedReason,
        preservedMeta: message2.preservedMeta
      })).join("")}`;
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      if (shown.length === 0) {
        const empty = document.createElement("div");
        empty.className = REMOVED_EMPTY_CLASS;
        empty.textContent = store ? t("panel.removed_empty") : t("panel.removed_no_session");
        body.replaceChildren(empty);
      } else {
        body.replaceChildren(...shown.map((message2) => this.buildRow(message2)));
      }
    }
    setOpen(nextOpen) {
      if (nextOpen === this.open) {
        if (nextOpen) this.refreshSettingsControls();
        return;
      }
      if (nextOpen) {
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.openerId = this.opener?.id || null;
        this.lockDocumentScroll();
        this.open = true;
        this.render();
        this.showDashboardSection(this.activeSection, false);
        this.section?.querySelector(`.${PANEL_CLOSE_CLASS}`)?.focus();
        return;
      }
      this.finishHotkeyCapture();
      this.open = false;
      this.render();
      const opener = this.opener;
      const openerId = this.openerId;
      this.opener = null;
      this.openerId = null;
      this.unlockDocumentScroll();
      const focusTarget = opener?.isConnected ? opener : openerId ? document.getElementById(openerId) : null;
      if (focusTarget instanceof HTMLElement) focusTarget.focus();
    }
    ensureSection() {
      if (this.section?.isConnected) return this.section;
      const section = document.createElement("div");
      section.className = PANEL_CLASS;
      section.style.display = this.open ? "flex" : "none";
      section.setAttribute("aria-hidden", this.open ? "false" : "true");
      section.addEventListener("click", (event) => {
        if (event.target === section) this.setOpen(false);
      });
      const shell = document.createElement("section");
      shell.className = PANEL_SHELL_CLASS;
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-modal", "true");
      shell.setAttribute("aria-labelledby", "kickflow-dashboard-title");
      this.shell = shell;
      const rail = document.createElement("aside");
      rail.className = PANEL_RAIL_CLASS;
      const wordmark = document.createElement("div");
      wordmark.className = "kickflow-panel__wordmark";
      wordmark.textContent = "KickFlow";
      const railCaption = document.createElement("p");
      railCaption.className = "kickflow-panel__rail-caption";
      railCaption.textContent = t("panel.control_panel");
      const nav = document.createElement("nav");
      nav.className = "kickflow-panel__nav";
      nav.setAttribute("aria-label", t("panel.sections"));
      for (const item of DASHBOARD_SECTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "kickflow-panel__nav-item";
        button.dataset.section = item.key;
        const label = document.createElement("span");
        label.className = "kickflow-panel__nav-label";
        label.textContent = t(item.labelKey);
        button.append(label);
        if (item.key === "removed") {
          const count = document.createElement("span");
          count.className = PANEL_COUNT_CLASS;
          count.style.display = "none";
          count.setAttribute("aria-hidden", "true");
          button.append(count);
          this.countChip = count;
        }
        button.setAttribute("aria-controls", `kickflow-dashboard-${item.key}`);
        button.addEventListener("click", () => this.showDashboardSection(item.key));
        nav.append(button);
        this.navButtons.set(item.key, button);
      }
      const version = document.createElement("span");
      version.className = "kickflow-panel__version";
      version.textContent = `v${getExtensionVersion()}`;
      rail.append(wordmark, railCaption, nav, version);
      const main2 = document.createElement("div");
      main2.className = PANEL_MAIN_CLASS;
      this.main = main2;
      const header = document.createElement("div");
      header.className = PANEL_HEADER_CLASS;
      const title = document.createElement("h1");
      title.className = PANEL_TITLE_CLASS;
      title.id = "kickflow-dashboard-title";
      this.titleHeading = title;
      const close = document.createElement("button");
      close.type = "button";
      close.className = `${PANEL_BTN_CLASS} ${PANEL_CLOSE_CLASS}`;
      close.title = t("common.close");
      close.setAttribute("aria-label", t("panel.close_aria"));
      close.textContent = "\xD7";
      close.addEventListener("click", () => this.setOpen(false));
      header.append(title, close);
      const flagSaveStatus = document.createElement("p");
      flagSaveStatus.className = "kickflow-panel__settings-hint kickflow-panel__save-status";
      flagSaveStatus.setAttribute("role", "status");
      flagSaveStatus.hidden = true;
      this.flagSaveStatus = flagSaveStatus;
      const settings = this.buildSettingsSection();
      main2.append(header, flagSaveStatus, settings);
      shell.append(rail, main2);
      section.append(shell);
      document.body.appendChild(section);
      this.section = section;
      this.lastSig = "";
      this.showDashboardSection(this.activeSection, false);
      return section;
    }
    /** The same owner-facing flags the Chrome popup exposes. Built once; controls still dispatch
     * `kickflow:setFlag`, which bootstrap.ts's single mutator applies and persists. */
    buildSettingsSection() {
      const settings = document.createElement("div");
      settings.className = PANEL_SETTINGS_CLASS;
      this.dashboardSections.clear();
      const general = this.buildDashboardPane("general");
      general.append(this.buildPaneIntro(t("panel.general_intro")));
      const statusGroup = document.createElement("section");
      statusGroup.className = "kickflow-panel__group";
      statusGroup.append(this.buildGroupTitle(t("panel.live_status")));
      const statsList = document.createElement("dl");
      statsList.className = "kickflow-panel__stats";
      const connection = this.buildStat(t("stat.connection"));
      const connectionDot = document.createElement("span");
      connectionDot.className = "kickflow-panel__live-dot";
      connection.value.prepend(connectionDot);
      const channel = this.buildStat(t("stat.channel"));
      const chatroom = this.buildStat(t("stat.chatroom_id"));
      const messages2 = this.buildStat(t("stat.messages"));
      const preserved = this.buildStat(t("stat.preserved"));
      const banned = this.buildStat(t("stat.bans"));
      const deleted = this.buildStat(t("stat.deletions"));
      const ghostAnchored = this.buildStat(t("stat.ghost_inline"));
      const ghostPending = this.buildStat(t("stat.ghost_pending"));
      const ghostEvicted = this.buildStat(t("stat.ghost_evicted"));
      const lastBan = this.buildStat(t("stat.last_ban"));
      statsList.append(
        connection.row,
        channel.row,
        chatroom.row,
        messages2.row,
        preserved.row,
        banned.row,
        deleted.row,
        ghostAnchored.row,
        ghostPending.row,
        ghostEvicted.row,
        lastBan.row
      );
      statusGroup.append(statsList);
      this.stats = {
        connection: connection.value,
        connectionDot,
        channel: channel.value,
        chatroom: chatroom.value,
        messages: messages2.value,
        preserved: preserved.value,
        banned: banned.value,
        deleted: deleted.value,
        ghostAnchored: ghostAnchored.value,
        ghostPending: ghostPending.value,
        ghostEvicted: ghostEvicted.value,
        lastBan: lastBan.value
      };
      const modeGroup = document.createElement("section");
      modeGroup.className = "kickflow-panel__group";
      modeGroup.append(this.buildGroupTitle(t("panel.chat_view")));
      const modeLabel = document.createElement("label");
      modeLabel.className = "kickflow-panel__settings-row kickflow-panel__settings-row--mode";
      const modeCopy = this.buildRowCopy(t("panel.chat_mode"), t("panel.chat_mode_desc"));
      const modeSelect = document.createElement("select");
      modeSelect.setAttribute("aria-label", t("panel.chat_mode"));
      const nativeOption = document.createElement("option");
      nativeOption.value = "native";
      nativeOption.textContent = t("popup.mode_option_native");
      const ownOption = document.createElement("option");
      ownOption.value = "own";
      ownOption.textContent = "KickFlow";
      modeSelect.append(nativeOption, ownOption);
      modeSelect.value = featureFlags.chatMode;
      modeSelect.addEventListener("change", () => this.dispatchFlag("chatMode", modeSelect.value));
      modeLabel.append(modeCopy, modeSelect);
      modeGroup.append(modeLabel);
      this.chatModeSelect = modeSelect;
      const languageLabel = document.createElement("label");
      languageLabel.className = "kickflow-panel__settings-row kickflow-panel__settings-row--mode";
      const languageCopy = this.buildRowCopy(t("panel.language"), t("panel.language_desc"));
      const languageSelect = document.createElement("select");
      languageSelect.setAttribute("aria-label", t("panel.language"));
      for (const [value, label] of [["en", "EN"], ["tr", "TR"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        languageSelect.append(option);
      }
      languageSelect.value = getLang();
      languageSelect.addEventListener("change", () => {
        const next = languageSelect.value;
        if (next === "en" || next === "tr") setLang(next);
      });
      languageLabel.append(languageCopy, languageSelect);
      modeGroup.append(languageLabel);
      general.append(statusGroup, modeGroup);
      const removed = this.buildDashboardPane("removed");
      removed.append(this.buildPaneIntro(t("panel.removed_intro")));
      const filterChip = document.createElement("button");
      filterChip.type = "button";
      filterChip.className = FILTER_CHIP_CLASS;
      filterChip.addEventListener("click", () => this.clearUserFilter());
      filterChip.hidden = true;
      this.filterChip = filterChip;
      const body = document.createElement("div");
      body.className = PANEL_BODY_CLASS;
      body.setAttribute("role", "list");
      body.setAttribute("aria-label", t("panel.removed_aria"));
      body.setAttribute("aria-live", "polite");
      removed.append(filterChip, body);
      const search = this.buildDashboardPane("search");
      search.append(this.buildPaneIntro(t("search.hotkey_hint")));
      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.className = "kickflow-search__input";
      searchInput.placeholder = t("search.placeholder");
      searchInput.setAttribute("aria-label", t("search.placeholder"));
      searchInput.addEventListener("input", () => this.scheduleSearchRender());
      searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this.renderSearchResults();
      });
      this.searchInput = searchInput;
      const searchResults = document.createElement("div");
      searchResults.className = "kickflow-search";
      searchResults.setAttribute("aria-live", "polite");
      this.searchResults = searchResults;
      search.append(searchInput, searchResults);
      this.renderSearchResults();
      const chat = this.buildDashboardPane("chat");
      chat.append(this.buildPaneIntro(t("panel.chat_intro")));
      const chatGroup = document.createElement("section");
      chatGroup.className = "kickflow-panel__group";
      const { label: deletedLabel, checkbox: deletedCheckbox } = this.buildSettingsToggle(
        t("setting.show_deleted"),
        t("setting.show_deleted_desc"),
        "showDeletedMessages",
        featureFlags.showDeletedMessages
      );
      this.showDeletedCheckbox = deletedCheckbox;
      const { label: banLabel, checkbox: banCheckbox } = this.buildSettingsToggle(
        t("setting.inline_bans"),
        t("setting.inline_bans_desc"),
        "preserveBansInline",
        featureFlags.preserveBansInline
      );
      this.banInlineCheckbox = banCheckbox;
      const { label: subscriptionsLabel, checkbox: subscriptionsCheckbox } = this.buildSettingsToggle(
        t("setting.subscriptions"),
        t("setting.subscriptions_desc"),
        "showSubscriptions",
        featureFlags.showSubscriptions
      );
      this.subscriptionsCheckbox = subscriptionsCheckbox;
      const { label: giftedSubsLabel, checkbox: giftedSubsCheckbox } = this.buildSettingsToggle(
        t("setting.gifted_subscriptions"),
        t("setting.gifted_subscriptions_desc"),
        "showGiftedSubs",
        featureFlags.showGiftedSubs
      );
      this.giftedSubsCheckbox = giftedSubsCheckbox;
      const { label: kicksLabel, checkbox: kicksCheckbox } = this.buildSettingsToggle(
        t("setting.kicks"),
        t("setting.kicks_desc"),
        "showKicks",
        featureFlags.showKicks
      );
      this.kicksCheckbox = kicksCheckbox;
      const { label: hostRaidLabel, checkbox: hostRaidCheckbox } = this.buildSettingsToggle(
        t("setting.host_raid"),
        t("setting.host_raid_desc"),
        "showHostRaid",
        featureFlags.showHostRaid
      );
      this.hostRaidCheckbox = hostRaidCheckbox;
      const { label: modeChangesLabel, checkbox: modeChangesCheckbox } = this.buildSettingsToggle(
        t("setting.mode_changes"),
        t("setting.mode_changes_desc"),
        "showModeChanges",
        featureFlags.showModeChanges
      );
      this.modeChangesCheckbox = modeChangesCheckbox;
      const { label: chattersBadgesLabel, checkbox: chattersBadgesCheckbox } = this.buildSettingsToggle(
        t("setting.chatters_badges"),
        t("setting.chatters_badges_desc"),
        "showChattersBadges",
        featureFlags.showChattersBadges
      );
      this.chattersBadgesCheckbox = chattersBadgesCheckbox;
      const { label: userMessagesLabel, checkbox: userMessagesCheckbox } = this.buildSettingsToggle(
        t("setting.user_messages"),
        t("setting.user_messages_desc"),
        "showUserMessages",
        featureFlags.showUserMessages
      );
      this.userMessagesCheckbox = userMessagesCheckbox;
      const { label: quickEmotesLabel, checkbox: quickEmotesCheckbox } = this.buildSettingsToggle(
        t("setting.hide_quick_emotes"),
        t("setting.hide_quick_emotes_desc"),
        "hideQuickEmoteBar",
        featureFlags.hideQuickEmoteBar
      );
      this.quickEmotesCheckbox = quickEmotesCheckbox;
      const { label: searchHotkeyLabel, checkbox: searchHotkeyCheckbox } = this.buildSettingsToggle(
        t("setting.search_hotkey"),
        t("setting.search_hotkey_desc"),
        "chatSearchHotkey",
        featureFlags.chatSearchHotkey
      );
      this.searchHotkeyCheckbox = searchHotkeyCheckbox;
      const { label: modActionsLabel, checkbox: modActionsCheckbox } = this.buildSettingsToggle(
        t("setting.mod_actions"),
        t("setting.mod_actions_desc"),
        "showModActions",
        featureFlags.showModActions
      );
      this.modActionsCheckbox = modActionsCheckbox;
      const { label: mentionHighlightLabel, checkbox: mentionHighlightCheckbox } = this.buildSettingsToggle(
        t("setting.mention_highlight"),
        t("setting.mention_highlight_desc"),
        "mentionHighlightEnabled",
        featureFlags.mentionHighlightEnabled
      );
      this.mentionHighlightCheckbox = mentionHighlightCheckbox;
      const mentionStyleRow = this.buildMentionStyleControl();
      const mentionColorRow = this.buildHighlightColorControl(
        "mentionHighlightColor",
        "setting.mention_color",
        "setting.mention_color_desc",
        "setting.mention_color_warn",
        () => featureFlags.mentionHighlightColor
      );
      const identityRow = this.buildManualUsernameControl();
      const roleStyleRow = this.buildRoleStyleControl();
      const { label: modFrameLabel, checkbox: modFrameCheckbox } = this.buildSettingsToggle(
        t("setting.mod_frame"),
        t("setting.mod_frame_desc"),
        "modFrameEnabled",
        featureFlags.modFrameEnabled
      );
      this.modFrameCheckbox = modFrameCheckbox;
      const { label: vipFrameLabel, checkbox: vipFrameCheckbox } = this.buildSettingsToggle(
        t("setting.vip_frame"),
        t("setting.vip_frame_desc"),
        "vipFrameEnabled",
        featureFlags.vipFrameEnabled
      );
      this.vipFrameCheckbox = vipFrameCheckbox;
      const roleColorsDisclosure = this.buildRoleColorsDisclosure();
      chatGroup.append(
        deletedLabel,
        banLabel,
        subscriptionsLabel,
        giftedSubsLabel,
        kicksLabel,
        hostRaidLabel,
        modeChangesLabel,
        chattersBadgesLabel,
        userMessagesLabel,
        quickEmotesLabel,
        searchHotkeyLabel,
        modActionsLabel,
        mentionHighlightLabel,
        mentionStyleRow,
        mentionColorRow,
        identityRow,
        roleStyleRow,
        modFrameLabel,
        vipFrameLabel,
        roleColorsDisclosure
      );
      chat.append(chatGroup);
      const player = this.buildDashboardPane("player");
      player.append(this.buildPaneIntro(t("panel.player_intro")));
      const playerGroup = document.createElement("section");
      playerGroup.className = "kickflow-panel__group";
      const { label: autoTheaterLabel, checkbox: autoTheaterCheckbox } = this.buildSettingsToggle(
        t("setting.auto_theater"),
        t("setting.auto_theater_desc"),
        "autoTheater",
        featureFlags.autoTheater
      );
      this.autoTheaterCheckbox = autoTheaterCheckbox;
      const { label: captionGuardLabel, checkbox: captionGuardCheckbox } = this.buildSettingsToggle(
        t("setting.caption_guard"),
        t("setting.caption_guard_desc"),
        "captionGuard",
        featureFlags.captionGuard
      );
      this.captionGuardCheckbox = captionGuardCheckbox;
      const { label: rewindControlsLabel, checkbox: rewindControlsCheckbox } = this.buildSettingsToggle(
        t("setting.seek"),
        t("setting.seek_desc"),
        "rewindControls",
        featureFlags.rewindControls
      );
      this.rewindControlsCheckbox = rewindControlsCheckbox;
      const { label: seekBarLabel, checkbox: seekBarCheckbox } = this.buildSettingsToggle(
        t("setting.seek_bar"),
        t("setting.seek_bar_desc"),
        "seekBar",
        featureFlags.seekBar
      );
      this.seekBarCheckbox = seekBarCheckbox;
      const { label: liveCatchupLabel, checkbox: liveCatchupCheckbox } = this.buildSettingsToggle(
        t("setting.live_catchup"),
        t("setting.live_catchup_desc"),
        "liveCatchup",
        featureFlags.liveCatchup
      );
      this.liveCatchupCheckbox = liveCatchupCheckbox;
      const { label: qualityLockLabel, checkbox: qualityLockCheckbox } = this.buildSettingsToggle(
        t("setting.quality_lock"),
        t("setting.quality_lock_desc"),
        "qualityLock",
        featureFlags.qualityLock
      );
      this.qualityLockCheckbox = qualityLockCheckbox;
      const { label: qualityAlwaysBestLabel, checkbox: qualityAlwaysBestCheckbox } = this.buildSettingsToggle(
        t("setting.quality_always_best"),
        t("setting.quality_always_best_desc"),
        "qualityAlwaysBest",
        featureFlags.qualityAlwaysBest
      );
      this.qualityAlwaysBestCheckbox = qualityAlwaysBestCheckbox;
      const { label: screenshotLabel, checkbox: screenshotCheckbox } = this.buildSettingsToggle(
        t("setting.screenshot"),
        t("setting.screenshot_desc"),
        "screenshot",
        featureFlags.screenshot
      );
      this.screenshotCheckbox = screenshotCheckbox;
      const { label: speedControlsLabel, checkbox: speedControlsCheckbox } = this.buildSettingsToggle(
        t("setting.speed"),
        t("setting.speed_desc"),
        "speedControls",
        featureFlags.speedControls
      );
      this.speedControlsCheckbox = speedControlsCheckbox;
      const { label: fullscreenTerminalLabel, checkbox: fullscreenTerminalCheckbox } = this.buildSettingsToggle(
        t("setting.fullscreen_terminal"),
        t("setting.fullscreen_terminal_desc"),
        "fullscreenTerminal",
        featureFlags.fullscreenTerminal
      );
      this.fullscreenTerminalCheckbox = fullscreenTerminalCheckbox;
      const { label: floatingStripLabel, checkbox: floatingStripCheckbox } = this.buildSettingsToggle(
        t("setting.floating_strip"),
        t("setting.floating_strip_desc"),
        "floatingStrip",
        featureFlags.floatingStrip
      );
      this.floatingStripCheckbox = floatingStripCheckbox;
      playerGroup.append(
        autoTheaterLabel,
        captionGuardLabel,
        rewindControlsLabel,
        seekBarLabel,
        liveCatchupLabel,
        qualityLockLabel,
        qualityAlwaysBestLabel,
        screenshotLabel,
        speedControlsLabel,
        fullscreenTerminalLabel,
        floatingStripLabel
      );
      player.append(playerGroup);
      const rewards = this.buildDashboardPane("rewards");
      rewards.append(this.buildPaneIntro(t("panel.rewards_intro")));
      const rewardsGroup = document.createElement("section");
      rewardsGroup.className = "kickflow-panel__group";
      const { label: autoClaimDropsLabel, checkbox: autoClaimDropsCheckbox } = this.buildSettingsToggle(
        t("setting.auto_claim_drops"),
        t("setting.auto_claim_drops_desc"),
        "autoClaimDrops",
        featureFlags.autoClaimDrops
      );
      this.autoClaimDropsCheckbox = autoClaimDropsCheckbox;
      const { label: autoClaimDailyRewardLabel, checkbox: autoClaimDailyRewardCheckbox } = this.buildSettingsToggle(
        t("setting.auto_claim_daily_reward"),
        t("setting.auto_claim_daily_reward_desc"),
        "autoClaimDailyReward",
        featureFlags.autoClaimDailyReward
      );
      this.autoClaimDailyRewardCheckbox = autoClaimDailyRewardCheckbox;
      rewardsGroup.append(autoClaimDropsLabel, autoClaimDailyRewardLabel);
      rewards.append(rewardsGroup);
      const hotkeys = this.buildDashboardPane("hotkeys");
      hotkeys.append(this.buildPaneIntro(t("panel.shortcuts_intro")));
      const hotkeyList = document.createElement("div");
      hotkeyList.className = "kickflow-panel__hotkeys";
      for (const definition of HOTKEY_DEFINITIONS) hotkeyList.append(this.buildHotkeyRow(definition.action, hotkeyLabel(definition.action)));
      const hotkeyFooter = document.createElement("div");
      hotkeyFooter.className = "kickflow-panel__hotkey-footer";
      const hotkeyStatus = document.createElement("span");
      hotkeyStatus.className = "kickflow-panel__hotkey-status";
      hotkeyStatus.setAttribute("role", "status");
      hotkeyStatus.setAttribute("aria-live", "polite");
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "kickflow-panel__hotkey-reset";
      reset.textContent = t("common.reset_defaults");
      reset.addEventListener("click", () => {
        this.finishHotkeyCapture();
        resetHotkeyBindings();
        this.refreshHotkeyControls();
        this.setHotkeyStatus(t("hotkey.reset"));
      });
      hotkeyFooter.append(hotkeyStatus, reset);
      this.hotkeyStatus = hotkeyStatus;
      const hint = document.createElement("p");
      hint.className = "kickflow-panel__settings-hint";
      hint.textContent = t("panel.changes_live");
      hotkeys.append(hotkeyList, hotkeyFooter, hint);
      const about = this.buildDashboardPane("about");
      const aboutMark = document.createElement("div");
      aboutMark.className = "kickflow-panel__about-mark";
      aboutMark.textContent = "KickFlow";
      const aboutText = document.createElement("p");
      aboutText.className = "kickflow-panel__about-copy";
      aboutText.textContent = t("about.copy");
      const aboutFacts = document.createElement("dl");
      aboutFacts.className = "kickflow-panel__about-facts";
      for (const [label, value] of [[t("about.version"), getExtensionVersion()], [t("about.platform"), "Chrome MV3"], [t("about.application"), t("about.application_value")]]) {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        row.append(term, detail);
        aboutFacts.append(row);
      }
      about.append(aboutMark, aboutText, aboutFacts);
      settings.append(general, removed, search, chat, player, rewards, hotkeys, about);
      return settings;
    }
    buildDashboardPane(key) {
      const pane = document.createElement("section");
      pane.className = "kickflow-panel__section";
      pane.id = `kickflow-dashboard-${key}`;
      pane.dataset.section = key;
      pane.setAttribute("role", "region");
      pane.setAttribute("aria-labelledby", `kickflow-dashboard-title`);
      this.dashboardSections.set(key, pane);
      return pane;
    }
    buildPaneIntro(text) {
      const intro = document.createElement("p");
      intro.className = "kickflow-panel__section-intro";
      intro.textContent = text;
      return intro;
    }
    buildGroupTitle(text) {
      const title = document.createElement("h2");
      title.className = "kickflow-panel__settings-title";
      title.textContent = text;
      return title;
    }
    buildRowCopy(labelText, description) {
      const copy2 = document.createElement("div");
      copy2.className = "kickflow-panel__settings-copy";
      const label = document.createElement("span");
      label.className = "kickflow-panel__settings-label";
      label.textContent = labelText;
      const detail = document.createElement("span");
      detail.className = "kickflow-panel__settings-description";
      detail.textContent = description;
      copy2.append(label, detail);
      return copy2;
    }
    buildStat(labelText) {
      const row = document.createElement("div");
      row.className = "kickflow-panel__stat";
      const label = document.createElement("dt");
      label.textContent = labelText;
      const value = document.createElement("dd");
      value.className = "kickflow-panel__stat-value--missing";
      value.textContent = "\u2014";
      row.append(label, value);
      return { row, value };
    }
    buildHotkeyRow(action, labelText) {
      const binding = getHotkeyBindings()[action];
      const row = document.createElement("div");
      row.className = "kickflow-panel__hotkey-row";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.className = "kickflow-panel__settings-toggle kickflow-panel__hotkey-enabled";
      enabled.checked = binding.enabled;
      enabled.setAttribute("aria-label", t("hotkey.enable_aria", { name: labelText }));
      enabled.addEventListener("change", () => {
        updateHotkeyBinding(action, { enabled: enabled.checked });
        this.refreshHotkeyControls();
      });
      const label = document.createElement("span");
      label.className = "kickflow-panel__hotkey-label";
      label.textContent = labelText;
      const chip = document.createElement("kbd");
      chip.className = "kickflow-panel__hotkey-chip";
      chip.textContent = formatHotkeyKey(binding.key);
      const change = document.createElement("button");
      change.type = "button";
      change.className = "kickflow-panel__hotkey-change";
      change.setAttribute("aria-label", t("hotkey.change_aria", { name: labelText }));
      change.textContent = t("common.change");
      change.addEventListener("click", () => this.startHotkeyCapture(action));
      row.append(label, chip, change, enabled);
      this.hotkeyRows.set(action, { enabled, chip, change });
      return row;
    }
    startHotkeyCapture(action) {
      this.captureAction = action;
      setHotkeyCaptureActive(true);
      this.setHotkeyStatus(t("hotkey.press_key_cancel"));
      this.refreshHotkeyControls();
    }
    finishHotkeyCapture(message2) {
      this.captureAction = null;
      setHotkeyCaptureActive(false);
      if (message2 !== void 0) this.setHotkeyStatus(message2);
      this.refreshHotkeyControls();
    }
    onHotkeyCapture(event) {
      const action = this.captureAction;
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        this.finishHotkeyCapture(t("hotkey.cancelled"));
        return;
      }
      const key = normalizeHotkeyKey(event.key);
      if (key === null) {
        this.setHotkeyStatus(t("hotkey.modifier_invalid"));
        return;
      }
      const result = updateHotkeyBinding(action, { key });
      if (!result.ok) {
        if (result.reason === "collision" && result.conflictingAction) {
          const conflict = hotkeyLabel(result.conflictingAction);
          this.setHotkeyStatus(t("hotkey.collision", { name: conflict }));
        } else {
          this.setHotkeyStatus(t("hotkey.invalid"));
        }
        return;
      }
      this.finishHotkeyCapture(
        result.nativeConflict ? t("hotkey.saved_native_conflict") : t("hotkey.saved")
      );
    }
    setHotkeyStatus(message2) {
      if (this.hotkeyStatus) this.hotkeyStatus.textContent = message2;
    }
    refreshHotkeyControls() {
      const bindings2 = getHotkeyBindings();
      for (const action of HOTKEY_ACTIONS) {
        const controls = this.hotkeyRows.get(action);
        if (!controls) continue;
        const capturing = this.captureAction === action;
        controls.enabled.checked = bindings2[action].enabled;
        controls.chip.textContent = capturing ? t("hotkey.press_key").toLocaleLowerCase(getLang() === "tr" ? "tr-TR" : "en-US") : formatHotkeyKey(bindings2[action].key);
        controls.chip.classList.toggle("kickflow-panel__hotkey-chip--capturing", capturing);
        controls.change.textContent = t("common.change");
        controls.change.classList.toggle("kickflow-panel__hotkey-change--capturing", capturing);
      }
    }
    buildSettingsToggle(labelText, description, key, checked) {
      const label = document.createElement("label");
      label.className = "kickflow-panel__settings-row kickflow-panel__settings-row--toggle";
      const copy2 = this.buildRowCopy(labelText, description);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "kickflow-panel__settings-toggle";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => this.dispatchFlag(key, checkbox.checked));
      label.append(copy2, checkbox);
      return { label, checkbox };
    }
    buildMentionStyleControl() {
      return this.buildSegmentedStyleControl({
        labelKey: "setting.mention_style",
        descriptionKey: "setting.mention_style_desc",
        flagKey: "mentionHighlightStyle",
        options: [
          { value: "frame", labelKey: "setting.mention_style_frame" },
          { value: "fill", labelKey: "setting.mention_style_fill" },
          { value: "both", labelKey: "setting.mention_style_both" }
        ],
        buttonMap: this.mentionStyleButtons,
        sync: () => this.syncMentionStyleButtons()
      });
    }
    buildRoleStyleControl() {
      return this.buildSegmentedStyleControl({
        labelKey: "setting.role_style",
        descriptionKey: "setting.role_style_desc",
        flagKey: "roleHighlightStyle",
        options: [
          { value: "frame", labelKey: "setting.role_style_frame" },
          { value: "both", labelKey: "setting.role_style_both" }
        ],
        buttonMap: this.roleStyleButtons,
        sync: () => this.syncRoleStyleButtons()
      });
    }
    buildSegmentedStyleControl(config) {
      const row = document.createElement("div");
      row.className = "kickflow-panel__settings-row kickflow-panel__settings-row--stack";
      row.appendChild(this.buildRowCopy(t(config.labelKey), t(config.descriptionKey)));
      const group = document.createElement("div");
      group.className = "kickflow-panel__segmented";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", t(config.labelKey));
      config.buttonMap.clear();
      for (const option of config.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "kickflow-panel__segment";
        button.textContent = t(option.labelKey);
        button.addEventListener("click", () => this.dispatchFlag(config.flagKey, option.value));
        config.buttonMap.set(option.value, button);
        group.appendChild(button);
      }
      config.sync();
      row.appendChild(group);
      return row;
    }
    buildRoleColorsDisclosure() {
      const details = document.createElement("details");
      details.className = "kickflow-panel__role-colors";
      const summary = document.createElement("summary");
      const copy2 = document.createElement("div");
      copy2.className = "kickflow-panel__role-colors-copy";
      const title = document.createElement("span");
      title.textContent = t("setting.role_colors");
      const desc = document.createElement("span");
      desc.className = "kickflow-panel__role-colors-desc";
      desc.textContent = t("setting.role_colors_desc");
      copy2.append(title, desc);
      const dots = document.createElement("span");
      dots.className = "kickflow-panel__role-color-dots";
      const modDot = document.createElement("span");
      modDot.className = "kickflow-panel__role-color-dot";
      modDot.setAttribute("aria-hidden", "true");
      const vipDot = document.createElement("span");
      vipDot.className = "kickflow-panel__role-color-dot";
      vipDot.setAttribute("aria-hidden", "true");
      dots.append(modDot, vipDot);
      this.roleColorDots = { mod: modDot, vip: vipDot };
      summary.append(copy2, dots);
      details.appendChild(summary);
      const modFrameColorRow = this.buildHighlightColorControl(
        "modFrameColor",
        "setting.mod_frame_color",
        "setting.mod_frame_color_desc",
        "setting.mod_frame_color_warn",
        () => featureFlags.modFrameColor
      );
      const vipFrameColorRow = this.buildHighlightColorControl(
        "vipFrameColor",
        "setting.vip_frame_color",
        "setting.vip_frame_color_desc",
        "setting.vip_frame_color_warn",
        () => featureFlags.vipFrameColor
      );
      details.append(modFrameColorRow, vipFrameColorRow);
      this.syncRoleColorDots();
      return details;
    }
    buildHighlightColorControl(key, labelKey, descriptionKey, warningKey, getCurrentColor) {
      const row = document.createElement("div");
      row.className = "kickflow-panel__settings-row kickflow-panel__settings-row--stack";
      row.appendChild(this.buildRowCopy(t(labelKey), t(descriptionKey)));
      const swatches = document.createElement("div");
      swatches.className = "kickflow-panel__swatches";
      const swatchButtons = /* @__PURE__ */ new Map();
      const warn = document.createElement("p");
      warn.className = "kickflow-panel__color-warn";
      warn.textContent = t(warningKey);
      warn.hidden = true;
      for (const hex of MENTION_COLOR_SWATCHES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "kickflow-panel__swatch";
        button.title = hex;
        button.setAttribute("aria-label", hex);
        button.style.backgroundColor = hex;
        button.addEventListener("click", () => {
          warn.hidden = true;
          this.dispatchFlag(key, hex);
        });
        swatchButtons.set(hex.toUpperCase(), button);
        swatches.appendChild(button);
      }
      const customWrap = document.createElement("label");
      customWrap.className = "kickflow-panel__swatch-custom";
      customWrap.title = t(labelKey);
      const custom = document.createElement("input");
      custom.type = "color";
      custom.value = normalizeHexColor(getCurrentColor()) ?? MENTION_COLOR_SWATCHES[0];
      custom.addEventListener("input", () => {
        const raw = custom.value;
        const sanitized = sanitizeHighlightColor(raw);
        const changed = normalizeHexColor(sanitized) !== normalizeHexColor(raw);
        warn.hidden = !changed;
        this.dispatchFlag(key, sanitized);
        if (changed) custom.value = sanitized;
      });
      customWrap.appendChild(custom);
      swatches.appendChild(customWrap);
      row.append(swatches, warn);
      this.highlightColorControls.set(key, { swatchButtons, customInput: custom, getCurrentColor });
      this.syncHighlightColorControls();
      return row;
    }
    buildManualUsernameControl() {
      const row = document.createElement("div");
      row.className = "kickflow-panel__settings-row kickflow-panel__settings-row--stack";
      row.appendChild(this.buildRowCopy(t("setting.manual_username"), t("setting.manual_username_desc")));
      const input = document.createElement("input");
      input.type = "text";
      input.className = "kickflow-panel__identity-input";
      input.autocomplete = "username";
      input.spellcheck = false;
      input.maxLength = 25;
      input.placeholder = t("setting.manual_username_placeholder");
      input.value = featureFlags.manualUsername;
      input.addEventListener("change", () => this.dispatchFlag("manualUsername", input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.dispatchFlag("manualUsername", input.value);
          input.blur();
        }
      });
      this.manualUsernameInput = input;
      const note2 = document.createElement("p");
      note2.className = "kickflow-panel__identity-note";
      note2.textContent = t("setting.identity_unresolved");
      this.identityNote = note2;
      this.syncIdentityNote();
      row.append(input, note2);
      return row;
    }
    syncMentionStyleButtons() {
      const current = featureFlags.mentionHighlightStyle;
      for (const [value, button] of this.mentionStyleButtons) {
        button.classList.toggle("kickflow-panel__segment--active", value === current);
        button.setAttribute("aria-pressed", value === current ? "true" : "false");
      }
    }
    syncRoleStyleButtons() {
      const current = featureFlags.roleHighlightStyle;
      for (const [value, button] of this.roleStyleButtons) {
        button.classList.toggle("kickflow-panel__segment--active", value === current);
        button.setAttribute("aria-pressed", value === current ? "true" : "false");
      }
    }
    syncRoleColorDots() {
      if (!this.roleColorDots) return;
      this.roleColorDots.mod.style.backgroundColor = normalizeHexColor(featureFlags.modFrameColor) ?? featureFlags.modFrameColor;
      this.roleColorDots.vip.style.backgroundColor = normalizeHexColor(featureFlags.vipFrameColor) ?? featureFlags.vipFrameColor;
    }
    syncHighlightColorControls() {
      for (const { swatchButtons, customInput, getCurrentColor } of this.highlightColorControls.values()) {
        const current = (normalizeHexColor(getCurrentColor()) ?? MENTION_COLOR_SWATCHES[0]).toUpperCase();
        for (const [hex, button] of swatchButtons) {
          button.classList.toggle("kickflow-panel__swatch--active", hex === current);
        }
        if (customInput.value.toUpperCase() !== current) {
          customInput.value = current;
        }
      }
    }
    syncIdentityNote() {
      if (!this.identityNote) return;
      this.identityNote.hidden = isOwnerIdentityResolved();
    }
    showDashboardSection(key, resetScroll = true) {
      this.activeSection = key;
      for (const item of DASHBOARD_SECTIONS) {
        const active = item.key === key;
        const pane = this.dashboardSections.get(item.key);
        if (pane) pane.hidden = !active;
        const button = this.navButtons.get(item.key);
        if (button) {
          button.classList.toggle("kickflow-panel__nav-item--active", active);
          button.setAttribute("aria-current", active ? "page" : "false");
        }
        if (active && this.titleHeading) this.titleHeading.textContent = t(item.labelKey);
      }
      if (resetScroll) {
        const settings = this.main?.querySelector(`.${PANEL_SETTINGS_CLASS}`);
        if (settings) settings.scrollTop = 0;
      }
    }
    /** Opens Search focused and ready to type. The Ctrl+F entry point and the nav button share it
     * so the tab always arrives in the same state. */
    showSearch() {
      this.showSettings("search");
      this.renderSearchResults();
      const input = this.searchInput;
      if (!input) return;
      input.focus();
      input.select();
    }
    scheduleSearchRender() {
      if (this.searchRenderHandle !== null) return;
      this.searchRenderHandle = window.setTimeout(() => {
        this.searchRenderHandle = null;
        this.renderSearchResults();
      }, SEARCH_DEBOUNCE_MS);
    }
    renderSearchResults() {
      const container = this.searchResults;
      if (!container) return;
      container.replaceChildren(buildMessageSearchResults(getMessageSearchModel(this.searchInput?.value ?? "")));
    }
    refreshStats() {
      const stats = this.stats;
      if (!stats) return;
      const snapshot = this.getStatusSnapshot();
      const connected = snapshot.pusherConnected;
      const missingConnection = !connected && !snapshot.slug;
      const connectionLabel = snapshot.slug === null ? t("status.not_channel") : connected ? t("common.connected") : t("common.waiting");
      stats.connection.replaceChildren(
        stats.connectionDot,
        document.createTextNode(connectionLabel)
      );
      stats.connection.classList.toggle("kickflow-panel__stat-value--missing", missingConnection);
      stats.connectionDot.classList.toggle("kickflow-panel__live-dot--connected", connected);
      this.setStatValue(stats.channel, snapshot.slug);
      this.setStatValue(stats.chatroom, snapshot.chatroomId);
      this.setStatValue(stats.messages, snapshot.messageCount);
      this.setStatValue(stats.preserved, snapshot.preservedCount);
      this.setStatValue(stats.banned, snapshot.bannedCount);
      this.setStatValue(stats.deleted, snapshot.deletedCount);
      this.setStatValue(stats.ghostAnchored, snapshot.ghostAnchored);
      this.setStatValue(stats.ghostPending, snapshot.ghostPendingNoAnchor);
      this.setStatValue(stats.ghostEvicted, snapshot.ghostEvicted);
      this.setStatValue(stats.lastBan, snapshot.lastBanAt === null ? null : this.formatAgo(snapshot.lastBanAt));
    }
    setStatValue(element, value) {
      const missing = value === null || value === "";
      const text = missing ? "\u2014" : String(value);
      if (element.textContent !== text) element.textContent = text;
      element.classList.toggle("kickflow-panel__stat-value--missing", missing);
    }
    formatAgo(timestamp) {
      if (timestamp === null) return "\u2014";
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1e3));
      if (seconds < 60) return t("time.seconds_ago", { n: seconds });
      const minutes = Math.round(seconds / 60);
      return minutes < 60 ? t("time.minutes_ago", { n: minutes }) : t("time.hours_ago", { n: Math.round(minutes / 60) });
    }
    /** Ctrl+F / ⌘F opens KickFlow's search. Typing surfaces keep the chord — including our own
     * search box, which is the deliberate escape hatch back to the browser's page find. */
    onSearchHotkey(event) {
      if (!featureFlags.chatSearchHotkey) return;
      if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.showSearch();
    }
    onDashboardKeydown(event) {
      if (!this.open || !this.shell) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(this.shell.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.closest("[hidden]"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !this.shell.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !this.shell.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    /** Keeps the controls' displayed value/checked current with featureFlags without replacing
     * nodes — a rebuild-on-every-render would steal focus/close an open <select> mid-interaction. */
    refreshSettingsControls() {
      if (this.chatModeSelect && this.chatModeSelect.value !== featureFlags.chatMode) {
        this.chatModeSelect.value = featureFlags.chatMode;
      }
      if (this.showDeletedCheckbox && this.showDeletedCheckbox.checked !== featureFlags.showDeletedMessages) {
        this.showDeletedCheckbox.checked = featureFlags.showDeletedMessages;
      }
      if (this.banInlineCheckbox && this.banInlineCheckbox.checked !== featureFlags.preserveBansInline) {
        this.banInlineCheckbox.checked = featureFlags.preserveBansInline;
      }
      if (this.subscriptionsCheckbox && this.subscriptionsCheckbox.checked !== featureFlags.showSubscriptions) {
        this.subscriptionsCheckbox.checked = featureFlags.showSubscriptions;
      }
      if (this.giftedSubsCheckbox && this.giftedSubsCheckbox.checked !== featureFlags.showGiftedSubs) {
        this.giftedSubsCheckbox.checked = featureFlags.showGiftedSubs;
      }
      if (this.kicksCheckbox && this.kicksCheckbox.checked !== featureFlags.showKicks) {
        this.kicksCheckbox.checked = featureFlags.showKicks;
      }
      if (this.hostRaidCheckbox && this.hostRaidCheckbox.checked !== featureFlags.showHostRaid) {
        this.hostRaidCheckbox.checked = featureFlags.showHostRaid;
      }
      if (this.modeChangesCheckbox && this.modeChangesCheckbox.checked !== featureFlags.showModeChanges) {
        this.modeChangesCheckbox.checked = featureFlags.showModeChanges;
      }
      if (this.chattersBadgesCheckbox && this.chattersBadgesCheckbox.checked !== featureFlags.showChattersBadges) {
        this.chattersBadgesCheckbox.checked = featureFlags.showChattersBadges;
      }
      if (this.searchHotkeyCheckbox && this.searchHotkeyCheckbox.checked !== featureFlags.chatSearchHotkey) {
        this.searchHotkeyCheckbox.checked = featureFlags.chatSearchHotkey;
      }
      if (this.userMessagesCheckbox && this.userMessagesCheckbox.checked !== featureFlags.showUserMessages) {
        this.userMessagesCheckbox.checked = featureFlags.showUserMessages;
      }
      if (this.quickEmotesCheckbox && this.quickEmotesCheckbox.checked !== featureFlags.hideQuickEmoteBar) {
        this.quickEmotesCheckbox.checked = featureFlags.hideQuickEmoteBar;
      }
      if (this.modActionsCheckbox && this.modActionsCheckbox.checked !== featureFlags.showModActions) {
        this.modActionsCheckbox.checked = featureFlags.showModActions;
      }
      if (this.mentionHighlightCheckbox && this.mentionHighlightCheckbox.checked !== featureFlags.mentionHighlightEnabled) {
        this.mentionHighlightCheckbox.checked = featureFlags.mentionHighlightEnabled;
      }
      if (this.modFrameCheckbox && this.modFrameCheckbox.checked !== featureFlags.modFrameEnabled) {
        this.modFrameCheckbox.checked = featureFlags.modFrameEnabled;
      }
      if (this.vipFrameCheckbox && this.vipFrameCheckbox.checked !== featureFlags.vipFrameEnabled) {
        this.vipFrameCheckbox.checked = featureFlags.vipFrameEnabled;
      }
      this.syncMentionStyleButtons();
      this.syncRoleStyleButtons();
      this.syncHighlightColorControls();
      this.syncRoleColorDots();
      if (this.manualUsernameInput && this.manualUsernameInput.value !== featureFlags.manualUsername && document.activeElement !== this.manualUsernameInput) {
        this.manualUsernameInput.value = featureFlags.manualUsername;
      }
      this.syncIdentityNote();
      if (this.autoTheaterCheckbox && this.autoTheaterCheckbox.checked !== featureFlags.autoTheater) {
        this.autoTheaterCheckbox.checked = featureFlags.autoTheater;
      }
      if (this.captionGuardCheckbox && this.captionGuardCheckbox.checked !== featureFlags.captionGuard) {
        this.captionGuardCheckbox.checked = featureFlags.captionGuard;
      }
      if (this.rewindControlsCheckbox && this.rewindControlsCheckbox.checked !== featureFlags.rewindControls) {
        this.rewindControlsCheckbox.checked = featureFlags.rewindControls;
      }
      if (this.seekBarCheckbox && this.seekBarCheckbox.checked !== featureFlags.seekBar) {
        this.seekBarCheckbox.checked = featureFlags.seekBar;
      }
      if (this.liveCatchupCheckbox && this.liveCatchupCheckbox.checked !== featureFlags.liveCatchup) {
        this.liveCatchupCheckbox.checked = featureFlags.liveCatchup;
      }
      if (this.qualityLockCheckbox && this.qualityLockCheckbox.checked !== featureFlags.qualityLock) {
        this.qualityLockCheckbox.checked = featureFlags.qualityLock;
      }
      if (this.qualityAlwaysBestCheckbox && this.qualityAlwaysBestCheckbox.checked !== featureFlags.qualityAlwaysBest) {
        this.qualityAlwaysBestCheckbox.checked = featureFlags.qualityAlwaysBest;
      }
      if (this.screenshotCheckbox && this.screenshotCheckbox.checked !== featureFlags.screenshot) {
        this.screenshotCheckbox.checked = featureFlags.screenshot;
      }
      if (this.speedControlsCheckbox && this.speedControlsCheckbox.checked !== featureFlags.speedControls) {
        this.speedControlsCheckbox.checked = featureFlags.speedControls;
      }
      if (this.fullscreenTerminalCheckbox && this.fullscreenTerminalCheckbox.checked !== featureFlags.fullscreenTerminal) {
        this.fullscreenTerminalCheckbox.checked = featureFlags.fullscreenTerminal;
      }
      if (this.floatingStripCheckbox && this.floatingStripCheckbox.checked !== featureFlags.floatingStrip) {
        this.floatingStripCheckbox.checked = featureFlags.floatingStrip;
      }
      if (this.autoClaimDropsCheckbox && this.autoClaimDropsCheckbox.checked !== featureFlags.autoClaimDrops) {
        this.autoClaimDropsCheckbox.checked = featureFlags.autoClaimDrops;
      }
      if (this.autoClaimDailyRewardCheckbox && this.autoClaimDailyRewardCheckbox.checked !== featureFlags.autoClaimDailyReward) {
        this.autoClaimDailyRewardCheckbox.checked = featureFlags.autoClaimDailyReward;
      }
      this.refreshHotkeyControls();
    }
    refreshUserFilterChip() {
      if (!this.filterChip) return;
      const filter = this.userFilter;
      this.filterChip.hidden = filter === null;
      if (!filter) {
        this.filterChip.textContent = "";
        this.filterChip.removeAttribute("aria-label");
        return;
      }
      this.filterChip.textContent = `${t("panel.filtered_user", { name: filter.label })} \xD7`;
      this.filterChip.setAttribute("aria-label", t("panel.clear_user_filter", { name: filter.label }));
    }
    clearUserFilter() {
      if (!this.userFilter) return;
      this.userFilter = null;
      this.lastSig = "";
      this.render();
    }
    /** Builds a moderation-ledger row without changing the store's preservation annotations. */
    buildRow(message2) {
      const row = document.createElement("div");
      row.className = REMOVED_ROW_CLASS;
      row.dataset.kickflowRemovedMid = message2.id;
      row.setAttribute("role", "listitem");
      const time = document.createElement("time");
      time.className = "kickflow-removed-row__time";
      const createdAt = new Date(message2.createdAt);
      time.textContent = Number.isNaN(createdAt.getTime()) ? "" : createdAt.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
      if (!Number.isNaN(createdAt.getTime())) time.dateTime = message2.createdAt;
      const messageCopy = document.createElement("div");
      messageCopy.className = "kickflow-removed-row__message";
      const username = document.createElement("span");
      username.className = "kickflow-removed-row__username";
      const displayName = message2.sender.displayName || message2.sender.username;
      username.textContent = displayName;
      wireUsernameProfileLink(username, message2.sender, displayName, "kickflow-removed-row__username--link");
      username.style.color = message2.sender.identity.color || "inherit";
      const content = document.createElement("span");
      content.className = "kickflow-removed-row__content";
      appendParsedContent(content, message2.content);
      messageCopy.append(username, content);
      row.append(time, messageCopy);
      applyPreservedMarking(row, message2);
      const action = document.createElement("div");
      action.className = "kickflow-removed-row__action";
      const status2 = row.querySelector(".kickflow-status-label");
      const moderator = row.querySelector(".kickflow-mod-label");
      if (status2) action.append(status2);
      if (moderator) action.append(moderator);
      row.append(action);
      return row;
    }
    /** Rebuilds the open dashboard from catalog values. Existing chat rows intentionally keep
     * their creation-time copy; newly rendered rows use the current language. */
    rebuildForLanguage() {
      this.finishHotkeyCapture();
      this.removeSection();
      this.lastSig = "";
      this.render();
      if (this.open) this.showDashboardSection(this.activeSection, false);
    }
    /** Drops all DOM references so an externally removed body-level dashboard can self-heal. */
    removeSection() {
      this.flagChangeRevision++;
      this.flagSaveStatus = null;
      if (this.section) {
        this.section.remove();
        this.section = null;
      }
      this.shell = null;
      this.main = null;
      this.titleHeading = null;
      this.stats = null;
      this.countChip = null;
      this.dashboardSections.clear();
      this.navButtons.clear();
      this.chatModeSelect = null;
      this.showDeletedCheckbox = null;
      this.banInlineCheckbox = null;
      this.subscriptionsCheckbox = null;
      this.giftedSubsCheckbox = null;
      this.kicksCheckbox = null;
      this.hostRaidCheckbox = null;
      this.modeChangesCheckbox = null;
      this.chattersBadgesCheckbox = null;
      this.userMessagesCheckbox = null;
      this.quickEmotesCheckbox = null;
      this.mentionHighlightCheckbox = null;
      this.modFrameCheckbox = null;
      this.vipFrameCheckbox = null;
      this.mentionStyleButtons.clear();
      this.roleStyleButtons.clear();
      this.highlightColorControls.clear();
      this.roleColorDots = null;
      this.manualUsernameInput = null;
      this.identityNote = null;
      this.autoTheaterCheckbox = null;
      this.captionGuardCheckbox = null;
      this.rewindControlsCheckbox = null;
      this.seekBarCheckbox = null;
      this.liveCatchupCheckbox = null;
      this.qualityLockCheckbox = null;
      this.qualityAlwaysBestCheckbox = null;
      this.screenshotCheckbox = null;
      this.speedControlsCheckbox = null;
      this.fullscreenTerminalCheckbox = null;
      this.floatingStripCheckbox = null;
      this.autoClaimDropsCheckbox = null;
      this.autoClaimDailyRewardCheckbox = null;
      this.hotkeyRows.clear();
      this.hotkeyStatus = null;
      this.filterChip = null;
      this.modActionsCheckbox = null;
    }
    lockDocumentScroll() {
      if (this.scrollLockState) return;
      this.scrollLockState = {
        rootOverflow: document.documentElement.style.overflow,
        bodyOverflow: document.body.style.overflow
      };
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }
    unlockDocumentScroll() {
      const prior = this.scrollLockState;
      if (!prior) return;
      document.documentElement.style.overflow = prior.rootOverflow;
      document.body.style.overflow = prior.bodyOverflow;
      this.scrollLockState = null;
    }
    dispose() {
      this.finishHotkeyCapture();
      this.open = false;
      this.opener = null;
      this.openerId = null;
      this.unlockDocumentScroll();
      this.removeSection();
    }
  };
  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  // src/content/chat/drops-auto-claim.ts
  var DROPS_PANEL_SELECTOR = "#drops-panel";
  var CHANNEL_POINTS_PANEL_SELECTOR = "#rewards-panel";
  var COMPLETE_PROGRESSBAR_SELECTOR = '[role="progressbar"][data-state="complete"]';
  var ANY_PROGRESSBAR_SELECTOR = '[role="progressbar"]';
  var OBSERVED_ATTRIBUTE_NAMES = ["data-state", "disabled", "id"];
  var OBSERVER_OPTIONS = {
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTE_NAMES,
    childList: true,
    subtree: true
  };
  function findDropsPanel() {
    return document.querySelector(DROPS_PANEL_SELECTOR);
  }
  function isInsideChannelPointsPanel(element) {
    return element.closest(CHANNEL_POINTS_PANEL_SELECTOR) !== null;
  }
  function findRewardCard(progressbar, dropsPanel) {
    if (isInsideChannelPointsPanel(progressbar)) return null;
    if (!dropsPanel.contains(progressbar)) return null;
    let node = progressbar.parentElement;
    while (node && node !== dropsPanel && dropsPanel.contains(node)) {
      if (node.querySelectorAll(ANY_PROGRESSBAR_SELECTOR).length > 1) return null;
      if (node.querySelector("button")) return node;
      node = node.parentElement;
    }
    return null;
  }
  function findEnabledClaimButton(card) {
    const button = card.querySelector("button");
    if (!button || isInsideChannelPointsPanel(button) || button.disabled) return null;
    return button;
  }
  function findClaimTargets(dropsPanel) {
    const targets = /* @__PURE__ */ new Set();
    for (const progressbar of dropsPanel.querySelectorAll(COMPLETE_PROGRESSBAR_SELECTOR)) {
      const card = findRewardCard(progressbar, dropsPanel);
      const button = card ? findEnabledClaimButton(card) : null;
      if (button) targets.add(button);
    }
    return [...targets];
  }
  function nodeContainsElement(node, element) {
    if (node === element) return true;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return false;
    return node.contains(element);
  }
  var DropsAutoClaimController = class {
    constructor(lifecycle) {
      this.lifecycle = lifecycle;
      this.observer = null;
      this.clickedButtons = /* @__PURE__ */ new WeakSet();
      lifecycle.add(() => this.stopObserving());
      if (featureFlags.autoClaimDrops) this.startObserving();
    }
    syncFlag() {
      if (featureFlags.autoClaimDrops) {
        this.startObserving();
      } else {
        this.stopObserving();
      }
    }
    startObserving() {
      if (this.observer || this.lifecycle.isDisposed || !featureFlags.autoClaimDrops) return;
      const observationRoot = document.body ?? document.documentElement;
      if (!observationRoot) return;
      const observer = new MutationObserver((records) => this.handleMutations(records));
      observer.observe(observationRoot, OBSERVER_OPTIONS);
      this.observer = observer;
      this.claimAvailableRewards();
    }
    stopObserving() {
      this.observer?.disconnect();
      this.observer = null;
    }
    handleMutations(records) {
      if (this.lifecycle.isDisposed || !featureFlags.autoClaimDrops) return;
      const dropsPanel = findDropsPanel();
      if (!dropsPanel) return;
      const affectsDrops = records.some((record2) => {
        if (dropsPanel.contains(record2.target)) return true;
        return Array.from(record2.addedNodes).some((node) => nodeContainsElement(node, dropsPanel));
      });
      if (affectsDrops) this.claimAvailableRewards(dropsPanel);
    }
    claimAvailableRewards(dropsPanel = findDropsPanel()) {
      if (this.lifecycle.isDisposed || !featureFlags.autoClaimDrops || !dropsPanel) return;
      for (const button of findClaimTargets(dropsPanel)) {
        if (this.clickedButtons.has(button) || button.disabled || !dropsPanel.contains(button)) continue;
        this.clickedButtons.add(button);
        logger.info("drops-auto-claim: clicking a confirmed Kick Drops claim button");
        button.click();
      }
    }
  };
  var activeController = null;
  function initAutoClaimDrops(lifecycle) {
    const controller2 = new DropsAutoClaimController(lifecycle);
    activeController = controller2;
    lifecycle.add(() => {
      if (activeController === controller2) activeController = null;
    });
  }
  function syncAutoClaimDropsFlag() {
    activeController?.syncFlag();
  }

  // src/content/daily-reward-auto-claim.ts
  var DAILY_REWARD_CTA_SELECTOR = SELECTORS.dailyRewardCta;
  var DIALOG_SELECTOR = SELECTORS.dailyRewardDialog;
  var DIALOG_WAIT_TIMEOUT_MS = 6e3;
  var CLAIM_WAIT_TIMEOUT_MS = 6e3;
  var CLAIM_ACK_TIMEOUT_MS = 3e4;
  var LAUNCHER_GIVE_UP_COOLDOWN_MS = 10 * 60 * 1e3;
  var DIALOG_DID_NOT_MOUNT_REASON = "dialog did not mount before the bounded wait ended";
  var CLAIM_NEVER_CLICKABLE_REASON = "the reward window opened but its claim button never became clickable";
  var CLAIM_NOT_ACKNOWLEDGED_REASON = "the claim click was not acknowledged before the bounded wait ended";
  var CLAIM_REJECTED_REASON = "Kick re-enabled the claim button without confirming the claim";
  var OBSERVED_ATTRIBUTE_NAMES2 = [
    "class",
    "data-state",
    "disabled",
    "aria-disabled",
    "aria-controls",
    "hidden",
    "aria-hidden",
    "inert",
    "role",
    "src",
    "id"
  ];
  function isBoundedGiveUp(reason) {
    return reason === DIALOG_DID_NOT_MOUNT_REASON || reason === CLAIM_NEVER_CLICKABLE_REASON || reason === CLAIM_NOT_ACKNOWLEDGED_REASON;
  }
  var OBSERVER_OPTIONS2 = {
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTE_NAMES2,
    childList: true,
    characterData: true,
    subtree: true
  };
  var DIAGNOSTIC_CLASS_PATTERN = /^(?:(?:sm|md|lg|xl|hover|focus|disabled):)*(?:relative|absolute|fixed|flex|grid|block|hidden|flex-(?:col|row|wrap|1)|(?:items|justify)-(?:center|start|end|between)|(?:w|h)-(?:full|auto|screen)|(?:gap|p|px|py|m|mx|my)-\d{1,2}|rounded(?:-(?:sm|md|lg|full))?|overflow-hidden|object-contain|aspect-(?:\[\d{1,4}\/\d{1,4}\]|\d{1,4}\/\d{1,4}|square|video)|bg-(?:black|primary(?:-(?:base|hover|active|disabled|subtle|default|strong))?|brand-bg-default|surface(?:-higher|-bg-highest)?))$/;
  var DIAGNOSTIC_TAGS = /* @__PURE__ */ new Set(["div", "section", "article", "header", "footer", "main", "nav", "dialog", "button", "img", "picture", "video", "canvas", "span", "p", "h1", "h2", "h3", "i", "svg", "path", "form", "input"]);
  var DIAGNOSTIC_ROLES = /* @__PURE__ */ new Set(["dialog", "alertdialog", "button", "img", "presentation", "none", "group"]);
  function snapshotRewardStructure(flow) {
    const roots = flow.dialog ? [flow.dialog] : newDialogs(flow).slice(0, 4);
    if (!roots.length) roots.push(flow.launcher);
    const seen = /* @__PURE__ */ new Set();
    let snapshot = "";
    const append = (element) => {
      if (seen.has(element)) return true;
      if (seen.size >= 60) return false;
      seen.add(element);
      const tag = DIAGNOSTIC_TAGS.has(element.localName) ? element.localName : "element";
      const role = element.getAttribute("role") ?? "";
      const classes = [];
      for (const token of element.classList) {
        if (token.length <= 64 && DIAGNOSTIC_CLASS_PATTERN.test(token)) classes.push(token);
        if (classes.length === 8) break;
      }
      const type = element.getAttribute("type");
      const buttonType = element instanceof HTMLButtonElement ? ` type=${type === null ? "missing" : /^(?:button|submit|reset)$/i.test(type) ? type.toLowerCase() : "other"}` : "";
      const line = `${tag}${DIAGNOSTIC_ROLES.has(role) ? ` role=${role}` : ""}${buttonType} class=${classes.join(" ")}
`;
      if (snapshot.length + line.length > 1800) return false;
      snapshot += line;
      return true;
    };
    for (const root of roots) {
      const stage = root.querySelector(SELECTORS.dailyRewardStage);
      const button = root.querySelector(SELECTORS.dailyRewardFullWidthButton);
      for (const element of [root, stage, stage?.querySelector("video, img"), button]) {
        if (element && !append(element)) return snapshot;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        if (!append(node)) return snapshot;
      }
    }
    return snapshot;
  }
  function isInsideExcludedRewardSurface(element) {
    return element.closest(SELECTORS.dailyRewardExcludedSurface) !== null;
  }
  function findDailyRewardVideo() {
    for (const video of document.querySelectorAll(DAILY_REWARD_CTA_SELECTOR)) {
      if (!isInsideExcludedRewardSurface(video)) return video;
    }
    return null;
  }
  function findDailyRewardLauncher(video) {
    const launcher = video.closest("button");
    if (!(launcher instanceof HTMLButtonElement)) return null;
    if (isInsideExcludedRewardSurface(launcher)) return null;
    return launcher;
  }
  function findRewardStages(dialog) {
    const stages = Array.from(dialog.querySelectorAll(SELECTORS.dailyRewardStage));
    const mediaStages = Array.from(dialog.querySelectorAll(SELECTORS.dailyRewardMediaStage)).filter((stage) => stage.querySelector("video, img") !== null);
    return Array.from(/* @__PURE__ */ new Set([...stages, ...mediaStages])).filter((stage) => !isInsideExcludedRewardSurface(stage) && !stages.some((outer) => outer !== stage && outer.contains(stage)));
  }
  function newDialogs(flow) {
    return Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter((dialog) => !flow.dialogsBeforeOpen.has(dialog) && !isInsideExcludedRewardSurface(dialog));
  }
  function findRewardDialogCandidates(flow) {
    const controlledId = flow.launcher.getAttribute("aria-controls");
    const linked = controlledId ? document.getElementById(controlledId) : null;
    return newDialogs(flow).filter((dialog) => dialog.matches('[role="dialog"]') && (!controlledId || dialog === linked) && dialog.parentElement?.closest(DIALOG_SELECTOR) === null && dialog.querySelector(DIALOG_SELECTOR) === null && findFinalClaimButton(dialog) !== null);
  }
  function findFinalClaimButton(dialog) {
    const stages = findRewardStages(dialog);
    if (!stages.length || !dialog.isConnected || isInsideExcludedRewardSurface(dialog)) return null;
    const buttons = Array.from(dialog.querySelectorAll(SELECTORS.dailyRewardFullWidthButton)).filter((button) => button.closest(DIALOG_SELECTOR) === dialog && !isInsideExcludedRewardSurface(button) && button.closest(SELECTORS.dailyRewardHidden) === null && (!button.hasAttribute("type") || button.getAttribute("type")?.toLowerCase() === "button") && button.form === null && !button.closest("form") && stages.every((stage) => !stage.contains(button) && (stage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
    const final = buttons[buttons.length - 1];
    return final?.matches(SELECTORS.dailyRewardPrimaryButton) && !hasUnsafeActionLabel(final) ? final : null;
  }
  function hasUnsafeActionLabel(button) {
    const label = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ı/g, "i");
    return /(?:^|[^a-z])(?:buy(?:s|ing)?(?![a-z])|tip(?:s|ping)?(?![a-z])|purchas|(?:re)?subscri|gift|follow|donat|satin\s*al|abone|hediye|taki[pb]|bagis)/.test(label);
  }
  function resolveClaimTarget(dialog, flow) {
    if (!dialog.isConnected) return { kind: "stop", reason: "the opened dialog disappeared before claiming" };
    const candidates = findRewardDialogCandidates(flow);
    const stageCount = findRewardStages(dialog).length;
    if (candidates.length !== 1 || candidates[0] !== dialog) {
      return {
        kind: "stop",
        reason: `the chosen dialog is no longer the single daily-reward dialog (${candidates.length} candidates, ${stageCount} stages)`
      };
    }
    const claimButton = findFinalClaimButton(dialog);
    if (!claimButton) return { kind: "wait" };
    if (claimButton.disabled || claimButton.getAttribute("aria-disabled") === "true") return { kind: "wait" };
    if (isInsideExcludedRewardSurface(claimButton) || !dialog.contains(claimButton)) {
      return { kind: "stop", reason: "the claim button was outside the opened daily-reward dialog" };
    }
    return { kind: "ready", button: claimButton };
  }
  function nodeContainsRewardSurface(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return false;
    const parent = node;
    if (node instanceof Element && (node.matches(DAILY_REWARD_CTA_SELECTOR) || node.matches(DIALOG_SELECTOR))) return true;
    return parent.querySelector(DAILY_REWARD_CTA_SELECTOR) !== null || parent.querySelector(DIALOG_SELECTOR) !== null;
  }
  function isRewardMutation(record2) {
    if (record2.type === "attributes") {
      const target2 = record2.target;
      if (!(target2 instanceof Element)) return false;
      return target2.matches("video") || target2 instanceof HTMLButtonElement && record2.attributeName === "aria-controls" || target2.matches(DIALOG_SELECTOR) || target2.closest(DIALOG_SELECTOR) !== null;
    }
    const target = record2.target instanceof Element ? record2.target : record2.target.parentElement;
    if (target && target.closest(DIALOG_SELECTOR) !== null) return true;
    return Array.from(record2.addedNodes).some(nodeContainsRewardSurface) || Array.from(record2.removedNodes).some(nodeContainsRewardSurface);
  }
  var DailyRewardAutoClaimController = class {
    constructor(lifecycle) {
      this.lifecycle = lifecycle;
      this.observer = null;
      this.ctaPresent = false;
      this.attemptStartedForCta = false;
      this.flow = null;
      this.waitTimeoutId = null;
      /** Launcher and CTA nodes that recently gave up on a bounded wait. 2026-10-15. */
      this.giveUpUntil = /* @__PURE__ */ new WeakMap();
      /** Unexpected shape/rejection warns once per document; ordinary timeouts never use that budget. */
      this.giveUpWarned = false;
      /** Page-wide: after a bounded give-up no launcher is clicked until this time, even if the site
       * re-mounts the header CTA as new nodes. 2026-10-15. */
      this.boundedGiveUpUntil = 0;
      lifecycle.add(() => this.dispose());
      lifecycle.addEventListener(window, "kickflow:locationchange", () => this.onLocationChange());
      if (featureFlags.autoClaimDailyReward) this.startObserving();
    }
    syncFlag() {
      if (featureFlags.autoClaimDailyReward) {
        this.startObserving();
      } else {
        this.stopObserving();
      }
    }
    /** bootstrap dispatches this on SPA navigation. Drops routes suppress; leaving them re-checks the header CTA. */
    onLocationChange() {
      if (this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
      if (isDropsRoutePath(window.location.pathname)) {
        this.suppressForDropsRoute();
        return;
      }
      this.syncCtaAppearance();
    }
    /** Close an existing attempt and forget the appearance; never start one on Drops. */
    suppressForDropsRoute() {
      this.cancelFlow();
      this.ctaPresent = false;
      this.attemptStartedForCta = false;
    }
    startObserving() {
      if (this.observer || this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
      const observationRoot = document.body ?? document.documentElement;
      if (!observationRoot) return;
      const observer = new MutationObserver((records) => {
        if (!records.some(isRewardMutation)) return;
        this.handleRewardMutations();
      });
      observer.observe(observationRoot, OBSERVER_OPTIONS2);
      this.observer = observer;
      this.syncCtaAppearance();
    }
    stopObserving() {
      this.observer?.disconnect();
      this.observer = null;
      this.cancelFlow();
    }
    dispose() {
      this.stopObserving();
    }
    handleRewardMutations() {
      if (this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
      if (isDropsRoutePath(window.location.pathname)) {
        this.suppressForDropsRoute();
        return;
      }
      this.advanceFlow();
      this.syncCtaAppearance();
    }
    syncCtaAppearance() {
      if (isDropsRoutePath(window.location.pathname)) {
        this.suppressForDropsRoute();
        return;
      }
      const video = findDailyRewardVideo();
      if (!video) {
        this.ctaPresent = false;
        this.attemptStartedForCta = false;
        return;
      }
      if (this.ctaPresent) return;
      this.ctaPresent = true;
      if (this.attemptStartedForCta || this.flow) return;
      const launcher = findDailyRewardLauncher(video);
      if (!launcher) {
        this.attemptStartedForCta = true;
        logger.warn("daily-reward-auto-claim: CTA appeared without its native launcher");
        return;
      }
      if (this.isCoolingDown(video, launcher)) {
        this.attemptStartedForCta = true;
        return;
      }
      this.attemptStartedForCta = true;
      this.startAttempt(launcher);
    }
    startAttempt(launcher) {
      if (this.flow?.opened) return;
      if (isDropsRoutePath(window.location.pathname)) {
        this.suppressForDropsRoute();
        return;
      }
      const flow = {
        launcher,
        dialogsBeforeOpen: new Set(document.querySelectorAll(DIALOG_SELECTOR)),
        dialog: null,
        opened: true,
        claim: null
      };
      this.flow = flow;
      this.restartWait(flow, DIALOG_WAIT_TIMEOUT_MS, DIALOG_DID_NOT_MOUNT_REASON);
      logger.info("daily-reward-auto-claim: opening Kick\u2019s daily reward window");
      try {
        launcher.click();
      } catch (error) {
        this.failAttempt("launcher click threw", error);
        return;
      }
      this.advanceFlow();
    }
    advanceFlow() {
      if (isDropsRoutePath(window.location.pathname)) {
        this.suppressForDropsRoute();
        return;
      }
      const flow = this.flow;
      if (!flow || this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
      if (flow.claim) {
        this.checkClaimOutcome(flow, flow.claim);
        return;
      }
      if (!flow.dialog) {
        const candidates = findRewardDialogCandidates(flow);
        if (candidates.length === 0) return;
        if (candidates.length > 1) {
          this.failAttempt(`several daily-reward dialogs are present (${candidates.length} candidates); refusing to choose one`);
          return;
        }
        flow.dialog = candidates[0];
        this.restartWait(flow, CLAIM_WAIT_TIMEOUT_MS, CLAIM_NEVER_CLICKABLE_REASON);
      }
      const target = resolveClaimTarget(flow.dialog, flow);
      if (target.kind === "wait") return;
      if (target.kind === "stop") {
        this.failAttempt(target.reason);
        return;
      }
      this.claimAndClose(flow, flow.dialog, target.button);
    }
    /** A click alone is not success, and neither is the disabled state. Kick's 2026-10-20 bundle disables
     * the button the moment its claim request starts (isPending), long before the server answers; the
     * answer then either replaces the button with View/Share (success), changes its label (claimed), or
     * re-enables it after an error toast. Closing on "disabled" unmounted the reward window mid-request,
     * so Kick's own success handler never updated the navbar and the chest kept looking unclaimed. */
    checkClaimOutcome(flow, claim) {
      const { button, label } = claim;
      const dialog = flow.dialog;
      if (!dialog || !dialog.isConnected) {
        logger.info("daily-reward-auto-claim: the reward window closed before Kick confirmed the claim");
        this.finishFlow();
        return;
      }
      const replaced = !button.isConnected || !dialog.contains(button);
      if (replaced || (button.textContent ?? "") !== label) {
        logger.info("daily-reward-auto-claim: claimed");
        this.finishFlow();
        this.closeOpenedDialog(flow);
        return;
      }
      const pending = button.disabled || button.getAttribute("aria-disabled") === "true";
      if (pending) {
        claim.pending = true;
        return;
      }
      if (claim.pending) this.failAttempt(CLAIM_REJECTED_REASON);
    }
    claimAndClose(flow, dialog, claimButton) {
      logger.info("daily-reward-auto-claim: clicking the enabled Kick claim button");
      const recheck = resolveClaimTarget(dialog, flow);
      if (recheck.kind !== "ready" || recheck.button !== claimButton) {
        const detail = recheck.kind === "stop" ? `: ${recheck.reason}` : "";
        this.failAttempt(`the daily-reward dialog changed right before the click${detail}`);
        return;
      }
      flow.claim = { button: claimButton, label: claimButton.textContent ?? "", pending: false };
      this.restartWait(flow, CLAIM_ACK_TIMEOUT_MS, CLAIM_NOT_ACKNOWLEDGED_REASON);
      try {
        claimButton.click();
      } catch (error) {
        this.failAttempt("claim button click threw", error);
        return;
      }
      this.advanceFlow();
    }
    /** Clean up newly opened windows even when recognition failed. Never send a global Escape
     * or touch a pre-existing dialog. The bundle's own Close control is a fallback if the
     * trigger was removed or its toggle did not remove the window. */
    closeOpenedDialog(flow) {
      const dialogs = newDialogs(flow);
      const linkedId = flow.dialog ? null : flow.launcher.getAttribute("aria-controls");
      const opened = dialogs.filter((dialog) => flow.dialog ? dialog === flow.dialog : !linkedId || dialog.id === linkedId);
      if (!flow.opened || !opened.length) return;
      if (flow.launcher.isConnected) {
        logger.info("daily-reward-auto-claim: closing the daily-reward window with its launcher toggle");
        try {
          flow.launcher.click();
        } catch (error) {
          logger.debug("daily-reward-auto-claim: launcher close threw", error);
        }
      }
      for (const dialog of opened) {
        if (!dialog.isConnected) continue;
        const label = Array.from(dialog.querySelectorAll(SELECTORS.dailyRewardCloseLabel)).find((span) => span.textContent?.trim() === "Close" && span.closest(DIALOG_SELECTOR) === dialog && !isInsideExcludedRewardSurface(span));
        const close = label?.closest("button");
        if (close instanceof HTMLButtonElement && !close.disabled) {
          try {
            close.click();
          } catch (error) {
            logger.debug("daily-reward-auto-claim: dialog close threw", error);
          }
        }
      }
    }
    /** Replaces the flow's bounded wait. Each phase gets its own deadline and its own reason, so a
     * failure names the step that actually stalled. */
    restartWait(flow, timeoutMs, reason) {
      if (this.waitTimeoutId !== null) window.clearTimeout(this.waitTimeoutId);
      this.waitTimeoutId = window.setTimeout(() => {
        if (this.flow !== flow) return;
        this.failAttempt(reason);
      }, timeoutMs);
    }
    failAttempt(reason, error) {
      const flow = this.flow;
      if (flow) void safeStorageSet({ kf_diag_dailyReward: snapshotRewardStructure(flow) });
      if (flow && isBoundedGiveUp(reason)) this.rememberBoundedGiveUp(flow.launcher);
      this.logGiveUp(reason, error);
      this.finishFlow();
      if (flow) this.closeOpenedDialog(flow);
    }
    /** A bounded wait is an expected outcome, including its first occurrence. Keep exceptions
     * visible even after earlier failures; a diagnostics reporter, when present, forwards warn/error. */
    logGiveUp(reason, error) {
      const detail = error ?? "";
      if (error === void 0 && (isBoundedGiveUp(reason) || this.giveUpWarned)) {
        logger.debug("daily-reward-auto-claim: giving up for this CTA appearance:", reason, detail);
        return;
      }
      this.giveUpWarned = true;
      logger.warn("daily-reward-auto-claim: giving up for this CTA appearance:", reason, detail);
    }
    rememberBoundedGiveUp(launcher) {
      const until2 = Date.now() + LAUNCHER_GIVE_UP_COOLDOWN_MS;
      this.giveUpUntil.set(launcher, until2);
      this.boundedGiveUpUntil = Math.max(this.boundedGiveUpUntil, until2);
      const video = launcher.querySelector(DAILY_REWARD_CTA_SELECTOR);
      if (video) this.giveUpUntil.set(video, until2);
    }
    isCoolingDown(video, launcher) {
      const now = Date.now();
      if (now < this.boundedGiveUpUntil) return true;
      const videoUntil = this.giveUpUntil.get(video);
      const launcherUntil = this.giveUpUntil.get(launcher);
      return videoUntil !== void 0 && now < videoUntil || launcherUntil !== void 0 && now < launcherUntil;
    }
    finishFlow() {
      if (this.waitTimeoutId !== null) {
        window.clearTimeout(this.waitTimeoutId);
        this.waitTimeoutId = null;
      }
      this.flow = null;
    }
    cancelFlow() {
      const flow = this.flow;
      this.finishFlow();
      if (flow) this.closeOpenedDialog(flow);
    }
  };
  var activeController2 = null;
  function initAutoClaimDailyReward(lifecycle) {
    const controller2 = new DailyRewardAutoClaimController(lifecycle);
    activeController2 = controller2;
    lifecycle.add(() => {
      if (activeController2 === controller2) activeController2 = null;
    });
  }
  function syncAutoClaimDailyRewardFlag() {
    activeController2?.syncFlag();
  }

  // src/shared/category-language.ts
  var CATEGORY_LANGUAGE_EVENT = "kickflow:category-languages-v1";
  var CATEGORY_LANGUAGE_RESULT_ATTRIBUTE = "data-kickflow-category-lang-result";
  var LANGUAGES_PARAM = "languages";
  var TURKISH = "tr";
  function isCategoryLivePath(pathname) {
    return /^\/category\/[^/]+\/?$/.test(pathname);
  }
  function languagesOf(search) {
    const raw = new URLSearchParams(search).getAll(LANGUAGES_PARAM).join(",");
    return raw.split(",").map((code) => code.trim()).filter(Boolean);
  }
  function hasLanguage(search, code = TURKISH) {
    return languagesOf(search).includes(code);
  }
  function withLanguage(pathname, search, on, code = TURKISH) {
    const params = new URLSearchParams(search);
    const current = languagesOf(search).filter((item) => item !== code);
    const next = on ? [...current, code] : current;
    params.delete(LANGUAGES_PARAM);
    if (next.length) params.set(LANGUAGES_PARAM, next.join(","));
    const query = params.toString().replace(/%2C/gi, ",");
    return query ? `${pathname}?${query}` : pathname;
  }

  // src/content/category-language-chip.ts
  var CATEGORY_TURKISH_KEY = "kf_categoryTurkish";
  var LANG_FILTER_BUTTON_SELECTOR = '#livestream_filter_by, [data-testid="content-lang-filter-button"]';
  var CHIP_ID = "kickflow-lang-chip-tr";
  var STYLE_ID2 = "kickflow-lang-chip-style";
  var LABEL = "T\xFCrk\xE7e";
  var ROUTER_WAIT_MS = 1200;
  var POPOVER_WAIT_MS = 1500;
  var CSS2 = `
.kickflow-lang-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:6px 12px;border:0;border-radius:4px;
  font:600 14px/1 Inter,"Inter Fallback",system-ui,sans-serif;white-space:nowrap;cursor:pointer;user-select:none;
  background:rgba(83,88,99,.4);color:#fff;transition:background-color .15s,color .15s}
.kickflow-lang-chip:hover{background:rgba(83,88,99,.6)}
.kickflow-lang-chip:focus-visible{outline:2px solid #53fc18;outline-offset:2px}
.kickflow-lang-chip[aria-pressed="true"]{background:#53fc18;color:#000}
.kickflow-lang-chip[aria-pressed="true"]:hover{background:#4ae014}
.kickflow-lang-chip[data-busy="true"]{opacity:.7;cursor:progress}
.kickflow-lang-chip__mark{display:none;font-size:12px}
.kickflow-lang-chip[aria-pressed="true"] .kickflow-lang-chip__mark{display:inline}
`;
  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  var never = () => false;
  async function until(test, ms, wait, aborted = never) {
    const step = 100;
    for (let spent = 0; spent <= ms; spent += step) {
      if (aborted()) return false;
      if (test()) return true;
      await wait(step);
    }
    return !aborted() && test();
  }
  function popoverCheckbox() {
    return document.getElementById(`language-${TURKISH}`);
  }
  function findLanguageFilterButton() {
    const all = Array.from(document.querySelectorAll(LANG_FILTER_BUTTON_SELECTOR)).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'));
    return all.find((el) => el.getClientRects().length > 0) ?? all[0] ?? null;
  }
  var defaultDeps = {
    async viaRouter(chip, url, on, aborted = never) {
      chip.removeAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE);
      chip.dispatchEvent(new CustomEvent(CATEGORY_LANGUAGE_EVENT, { bubbles: true, composed: true, detail: url }));
      if (chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE) !== "ok") return false;
      const failed = () => aborted() || chip.getAttribute(CATEGORY_LANGUAGE_RESULT_ATTRIBUTE) === "failed";
      const done = await until(() => hasLanguage(window.location.search) === on, ROUTER_WAIT_MS, this.wait, failed);
      return done;
    },
    async viaPopover(filterButton, on, aborted = never) {
      const wasOpen = filterButton.getAttribute("aria-expanded") === "true";
      if (!wasOpen) filterButton.click();
      const close = () => {
        if (wasOpen) return;
        const current = findLanguageFilterButton() ?? filterButton;
        if (current.getAttribute("aria-expanded") === "true") current.click();
      };
      const found = await until(() => popoverCheckbox() !== null, POPOVER_WAIT_MS, this.wait, aborted);
      const box = popoverCheckbox();
      if (!found || !box || aborted()) {
        close();
        return false;
      }
      if (box.getAttribute("aria-checked") === "true" !== on) box.click();
      const done = await until(() => hasLanguage(window.location.search) === on, POPOVER_WAIT_MS, this.wait, aborted);
      close();
      return done;
    },
    wait: sleep,
    trusted: (event) => event.isTrusted
  };
  var OWN_CHANGE_WINDOW_MS = 4e3;
  var MAX_REAPPLY_PER_ENTRY = 2;
  function inLanguageControl(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(`${LANG_FILTER_BUTTON_SELECTOR}, [id^="language-"]`)) return true;
    const layer = target.closest('[role="dialog"], [data-radix-popper-content-wrapper], [role="listbox"], [role="menu"]');
    return !!layer?.querySelector('[id^="language-"]');
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID2)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID2;
    style.textContent = CSS2;
    (document.head ?? document.documentElement).appendChild(style);
  }
  function createChip(onClick) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.id = CHIP_ID;
    chip.className = "kickflow-lang-chip";
    chip.setAttribute("data-kickflow-lang", TURKISH);
    chip.setAttribute("aria-pressed", "false");
    const mark = document.createElement("span");
    mark.className = "kickflow-lang-chip__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "\u2713";
    const text = document.createElement("span");
    text.textContent = LABEL;
    chip.append(mark, text);
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return chip;
  }
  async function initCategoryLanguageChip(lifecycle, deps = defaultDeps) {
    const stored = await safeStorageGet(CATEGORY_TURKISH_KEY);
    let remembered = stored[CATEGORY_TURKISH_KEY] === true;
    const inert = { refresh() {
    }, idle: async () => {
    }, get remembered() {
      return remembered;
    } };
    if (lifecycle.isDisposed || typeof document === "undefined" || !document.body) return inert;
    const isTrusted = deps.trusted ?? ((event) => event.isTrusted);
    let chip = null;
    let enteredPath = null;
    let seenOn = null;
    let reapplied = 0;
    let busy = null;
    let frame = 0;
    let lastOwnInput = Number.NEGATIVE_INFINITY;
    const remember = (on) => {
      if (remembered === on) return;
      remembered = on;
      void safeStorageSet({ [CATEGORY_TURKISH_KEY]: on });
    };
    const paint = () => {
      if (!chip) return;
      const on = hasLanguage(window.location.search);
      const pressed = on ? "true" : "false";
      if (chip.getAttribute("aria-pressed") !== pressed) chip.setAttribute("aria-pressed", pressed);
      const title = t(on ? "category.turkish_on" : "category.turkish_off");
      if (chip.title !== title) chip.title = title;
      const busyValue = busy ? "true" : "false";
      if (chip.getAttribute("data-busy") !== busyValue) chip.setAttribute("data-busy", busyValue);
    };
    const apply = (on) => {
      if (busy) return busy.then(() => false);
      const runPath = window.location.pathname;
      const aborted = () => lifecycle.isDisposed || window.location.pathname !== runPath;
      let reached = false;
      const run = async () => {
        const filter = findLanguageFilterButton();
        if (!chip || !filter || hasLanguage(window.location.search) === on) return;
        const url = withLanguage(runPath, window.location.search, on);
        const router = async () => deps.viaRouter(chip, url, on, aborted);
        const popover = async () => {
          const current2 = findLanguageFilterButton();
          return current2 ? deps.viaPopover(current2, on, aborted) : false;
        };
        for (const step of on ? [router, popover] : [popover]) {
          if (aborted()) return;
          let done = false;
          try {
            done = await step();
          } catch {
            done = false;
          }
          if (done) {
            reached = !aborted();
            return;
          }
        }
      };
      const current = run().then(() => reached, () => false).finally(() => {
        busy = null;
        if (window.location.pathname === runPath && isCategoryLivePath(runPath)) seenOn = hasLanguage(window.location.search);
        paint();
        schedule();
      });
      busy = current.then(() => void 0);
      paint();
      return current;
    };
    const onChipClick = () => {
      if (busy) return;
      const next = !hasLanguage(window.location.search);
      void apply(next).then((reached) => {
        if (reached) remember(next);
      });
    };
    const noteOwnInput = (event) => {
      if (isTrusted(event) && inLanguageControl(event.target)) lastOwnInput = Date.now();
    };
    let observing = false;
    const observer = new MutationObserver((records) => {
      if (!onlyChatMutations(records)) schedule();
    });
    const syncObserver = (onCategory) => {
      if (onCategory && !observing) {
        observer.observe(document.body, { childList: true, subtree: true });
        observing = true;
      } else if (!onCategory && observing) {
        observer.disconnect();
        observing = false;
      }
    };
    const refresh = () => {
      frame = 0;
      if (lifecycle.isDisposed || typeof window === "undefined") return;
      const path = window.location.pathname;
      const onCategory = isCategoryLivePath(path);
      syncObserver(onCategory);
      const filter = onCategory ? findLanguageFilterButton() : null;
      if (!filter || !filter.parentElement) {
        chip?.remove();
        if (!onCategory && !busy) {
          enteredPath = null;
          seenOn = null;
        }
        return;
      }
      ensureStyle();
      chip ??= createChip(onChipClick);
      if (filter.nextElementSibling !== chip) filter.insertAdjacentElement("afterend", chip);
      const on = hasLanguage(window.location.search);
      if (busy) {
        paint();
        return;
      }
      if (enteredPath !== path) {
        enteredPath = path;
        seenOn = on;
        reapplied = 0;
        if (remembered && !on) void apply(true);
      } else if (seenOn !== null && seenOn !== on) {
        seenOn = on;
        if (Date.now() - lastOwnInput <= OWN_CHANGE_WINDOW_MS) {
          remember(on);
        } else if (remembered && !on && reapplied < MAX_REAPPLY_PER_ENTRY) {
          reapplied += 1;
          void apply(true);
        }
      }
      paint();
    };
    function schedule() {
      if (lifecycle.isDisposed || frame || typeof window === "undefined") return;
      frame = window.requestAnimationFrame(refresh);
    }
    const onStorage = (changes, area) => {
      if (area !== "local" || !changes || !(CATEGORY_TURKISH_KEY in changes)) return;
      remembered = changes[CATEGORY_TURKISH_KEY]?.newValue === true;
    };
    try {
      chrome.storage?.onChanged?.addListener(onStorage);
    } catch {
    }
    lifecycle.add(() => {
      try {
        chrome.storage?.onChanged?.removeListener(onStorage);
      } catch {
      }
    });
    document.addEventListener("click", noteOwnInput, true);
    document.addEventListener("keydown", noteOwnInput, true);
    lifecycle.addEventListener(window, "kickflow:locationchange", schedule);
    lifecycle.addEventListener(window, "popstate", schedule);
    lifecycle.add(() => {
      document.removeEventListener("click", noteOwnInput, true);
      document.removeEventListener("keydown", noteOwnInput, true);
      observer.disconnect();
      observing = false;
      if (frame) window.cancelAnimationFrame(frame);
      chip?.remove();
      chip = null;
      document.getElementById(STYLE_ID2)?.remove();
    });
    refresh();
    return {
      refresh,
      idle: async () => {
        while (busy) await busy;
      },
      get remembered() {
        return remembered;
      }
    };
  }

  // src/content/chat/native-pause-pill.ts
  var PAUSE_COUNT_CLASS = "kickflow-pause-count";
  function findNativePausePill(doc = document) {
    const column = doc.querySelector("#chatroom-messages")?.parentElement;
    if (!column) return null;
    for (const child of Array.from(column.children)) {
      if (!(child instanceof HTMLElement) || !child.classList.contains("absolute")) continue;
      for (const button of Array.from(child.querySelectorAll("button"))) {
        if (button.querySelector('svg[data-ds-icon="Pause"]')) return button;
      }
    }
    return null;
  }
  var NativePausePillCounter = class {
    constructor(lifecycle, doc = document) {
      this.doc = doc;
      this.count = 0;
      this.present = false;
      this.observer = null;
      this.observedColumn = null;
      visibleInterval(lifecycle, () => this.sync(), 500);
      lifecycle.add(() => this.dispose());
      this.sync();
    }
    /** Call for every live chat message the store accepts. */
    noteMessage() {
      this.sync();
      if (!this.present) return;
      this.count++;
      this.render();
    }
    sync() {
      const pill = findNativePausePill(this.doc);
      this.watchColumn();
      if (!pill) {
        this.present = false;
        this.count = 0;
        return;
      }
      if (!this.present) {
        this.present = true;
        this.count = 0;
      }
      this.render(pill);
    }
    getCount() {
      return this.count;
    }
    render(known) {
      const pill = known ?? findNativePausePill(this.doc);
      if (!pill) return;
      let badge2 = pill.querySelector(`.${PAUSE_COUNT_CLASS}`);
      if (this.count === 0) {
        badge2?.remove();
        return;
      }
      if (!badge2) {
        badge2 = this.doc.createElement("span");
        badge2.className = PAUSE_COUNT_CLASS;
        pill.appendChild(badge2);
      }
      const text = `+${formatNumber(this.count)}`;
      const phrase = t("chat.pause_count", { n: this.count, count: formatNumber(this.count) });
      if (badge2.textContent !== text) badge2.textContent = text;
      if (badge2.title !== phrase) {
        badge2.title = phrase;
        badge2.setAttribute("aria-label", phrase);
      }
    }
    watchColumn() {
      const column = this.doc.querySelector("#chatroom-messages")?.parentElement ?? null;
      if (column === this.observedColumn) return;
      this.observer?.disconnect();
      this.observedColumn = column;
      this.observer = null;
      if (!column) return;
      this.observer = new MutationObserver(() => this.sync());
      this.observer.observe(column, { childList: true });
      for (const child of Array.from(column.children)) {
        if (child instanceof HTMLElement && child.classList.contains("absolute")) {
          this.observer.observe(child, { childList: true, subtree: true });
        }
      }
    }
    dispose() {
      this.observer?.disconnect();
      this.observer = null;
      this.observedColumn = null;
      findNativePausePill(this.doc)?.querySelector(`.${PAUSE_COUNT_CLASS}`)?.remove();
    }
  };

  // src/content/chat/mod-action-feed.ts
  var MOD_ACTION_BURST_WINDOW_MS = 5e3;
  var MOD_ACTION_BURST_MAX_MS = 3e4;
  var MOD_ACTION_NOTICE_VICTIM_CAP = 20;
  var nextNoticeSequence = 0;
  function sameModerator(left, right) {
    return left === right;
  }
  function asNotice(notice) {
    return {
      id: notice.id,
      kind: notice.kind,
      moderator: notice.moderator,
      durationMin: notice.durationMin,
      victims: notice.victims.map((victim) => ({ ...victim })),
      count: notice.count,
      messageId: notice.messageId,
      firstAt: notice.firstAt,
      lastAt: notice.lastAt
    };
  }
  var ModActionFeed = class {
    constructor(options) {
      this.openNotice = null;
      this.disposed = false;
      this.now = options.now ?? (() => Date.now());
      this.burstWindowMs = options.burstWindowMs ?? MOD_ACTION_BURST_WINDOW_MS;
      this.burstMaxMs = options.burstMaxMs ?? MOD_ACTION_BURST_MAX_MS;
      this.victimCap = Math.max(0, Math.floor(options.victimCap ?? MOD_ACTION_NOTICE_VICTIM_CAP));
      this.onNotice = options.onNotice;
      this.onNoticeUpdated = options.onNoticeUpdated;
    }
    push(action) {
      if (this.disposed) return;
      const at = Number.isFinite(action.at) ? action.at : this.now();
      const open = this.openNotice;
      if (open && this.canJoin(open, action, at)) {
        this.join(open, action, at);
        this.onNoticeUpdated(asNotice(open));
        return;
      }
      const notice = {
        id: `mod-action-${++nextNoticeSequence}`,
        kind: action.kind,
        moderator: action.moderator,
        durationMin: action.kind === "timeout" ? action.durationMin : null,
        victims: this.victimCap > 0 ? [{ name: action.victim, messageId: action.messageId }] : [],
        count: 1,
        messageId: action.messageId,
        firstAt: at,
        lastAt: at
      };
      this.openNotice = notice;
      this.onNotice(asNotice(notice));
    }
    clear() {
      this.openNotice = null;
    }
    dispose() {
      if (this.disposed) return;
      this.clear();
      this.disposed = true;
    }
    canJoin(open, action, at) {
      return open.kind === action.kind && sameModerator(open.moderator, action.moderator) && (open.kind !== "timeout" || open.durationMin === action.durationMin) && at - open.lastAt <= this.burstWindowMs && at - open.firstAt <= this.burstMaxMs;
    }
    join(open, action, at) {
      open.count++;
      open.messageId = null;
      open.lastAt = Math.max(open.lastAt, at);
      if (open.victims.length < this.victimCap && !open.victims.some(({ name }) => name === action.victim)) {
        open.victims.push({ name: action.victim, messageId: action.messageId });
      }
    }
  };

  // src/content/chat/footer-toggle.ts
  var BUTTON_ID = "kickflow-footer-toggle";
  var SEND_BUTTON_ID = "send-message-button";
  var BUTTON_CLASS = "kickflow-footer-toggle";
  var ACTIVE_CLASS = "kickflow-footer-toggle--active";
  var BADGE_CLASS2 = "kickflow-footer-toggle__badge";
  var ENSURE_INTERVAL_MS = 1e3;
  var FOOTER_ENTRY_ATTRIBUTE = "data-kickflow-footer-entry";
  var SVG_NS = "http://www.w3.org/2000/svg";
  function buildIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const bubble = document.createElementNS(SVG_NS, "path");
    bubble.setAttribute("d", "M4 5.5A2 2 0 0 1 6 3.5h12A2 2 0 0 1 20 5.5v8A2 2 0 0 1 18 15.5H9.5L5 19.5v-4H6A2 2 0 0 1 4 13.5z");
    svg.appendChild(bubble);
    const slash = document.createElementNS(SVG_NS, "path");
    slash.setAttribute("d", "M4.5 3.5l15 17");
    svg.appendChild(slash);
    return svg;
  }
  var FooterToggleButton = class {
    constructor(lifecycle, panel) {
      this.panel = panel;
      this.button = null;
      this.badge = null;
      this.ensureInjected();
      const reposition = () => this.ensureInjected();
      const repositionOnScroll = (event) => {
        if (isInsideChatScroller(event.target)) return;
        this.ensureInjected();
      };
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", repositionOnScroll, true);
      lifecycle.add(() => {
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", repositionOnScroll, true);
      });
      lifecycle.add(subscribeLang(() => this.refresh()));
      visibleInterval(lifecycle, () => this.ensureInjected(), ENSURE_INTERVAL_MS);
      lifecycle.add(() => this.dispose());
    }
    /** Reconcile against the current send button, not merely the old toggle's ID.
     * A native remount can leave our connected button behind in an obsolete footer. */
    ensureInjected() {
      const send = document.getElementById(SEND_BUTTON_ID);
      if (!send || !send.parentElement) {
        this.dispose();
        return;
      }
      const existing = document.getElementById(BUTTON_ID);
      if (existing && (!(existing instanceof HTMLButtonElement) || !existing.classList.contains(BUTTON_CLASS))) return;
      const button = existing ?? this.build();
      if (button.parentElement !== document.body) document.body.append(button);
      if (!document.documentElement.hasAttribute(FOOTER_ENTRY_ATTRIBUTE)) document.documentElement.setAttribute(FOOTER_ENTRY_ATTRIBUTE, "");
      const box = send.parentElement.getBoundingClientRect();
      setStyleIfChanged(button, "position", "fixed");
      setStyleIfChanged(button, "zIndex", "403");
      setStyleIfChanged(button, "left", px(box.left));
      setStyleIfChanged(button, "top", px(box.top + (box.height - 30) / 2));
      setStyleIfChanged(button, "display", box.width > 0 && box.height > 0 && !send.closest("[hidden]") ? "" : "none");
      this.button = button;
      this.badge = button.querySelector(`.${BADGE_CLASS2}`);
      this.refresh();
    }
    build() {
      const button = document.createElement("button");
      button.type = "button";
      button.id = BUTTON_ID;
      button.className = BUTTON_CLASS;
      button.title = t("entry.footer_title");
      button.setAttribute("aria-label", t("entry.footer_aria"));
      button.appendChild(buildIcon());
      const badge2 = document.createElement("span");
      badge2.className = BADGE_CLASS2;
      badge2.style.display = "none";
      button.appendChild(badge2);
      this.badge = badge2;
      button.addEventListener("click", () => {
        this.panel.toggle("removed");
        this.refresh();
      });
      return button;
    }
    /** Reflects `panel.isOpen()` (the `--active` KickFlow-green tint) and `panel.removedCount()`
     * (the badge, hidden at 0) onto whatever button node currently exists — called right after
     * click and on every 1s tick, so it stays correct even when the panel is closed via its own
     * ×, or a message gets removed while the panel is shut. */
    refresh() {
      const button = this.button;
      if (!button) return;
      const title = t("entry.footer_title");
      if (button.title !== title) button.title = title;
      const aria = t("entry.footer_aria");
      if (button.getAttribute("aria-label") !== aria) button.setAttribute("aria-label", aria);
      const open = this.panel.isOpen();
      if (button.classList.contains(ACTIVE_CLASS) !== open) button.classList.toggle(ACTIVE_CLASS, open);
      const badge2 = this.badge ?? button.querySelector(`.${BADGE_CLASS2}`);
      if (!badge2) return;
      const count = this.panel.removedCount();
      const text = count > 0 ? String(count) : "";
      if (badge2.textContent !== text) badge2.textContent = text;
      setStyleIfChanged(badge2, "display", count > 0 ? "" : "none");
    }
    dispose() {
      this.button?.remove();
      this.button = null;
      this.badge = null;
      if (!document.querySelector(`body > .${BUTTON_CLASS}`)) document.documentElement.removeAttribute(FOOTER_ENTRY_ATTRIBUTE);
    }
  };

  // src/content/chat/navbar-settings.ts
  var BUTTON_ID2 = "kickflow-navbar-settings";
  var BUTTON_CLASS2 = "kickflow-navbar-settings";
  var ACTIVE_CLASS2 = "kickflow-navbar-settings--active";
  var ENSURE_INTERVAL_MS2 = 1e3;
  var NAVBAR_ENTRY_ATTRIBUTE = "data-kickflow-navbar-entry";
  var NAVBAR_RIGHT_CLUSTER_INDEX = 2;
  var NAVBAR_RIGHT_CLUSTER_CLASSES = ["flex", "items-center", "gap-2"];
  var NAVBAR_HEIGHT_CLASSES = ["h-(--navbar-height)", "h-[var(--navbar-height)]", "h-[--navbar-height]"];
  function findNavbarRightCluster() {
    for (const nav of document.querySelectorAll("nav")) {
      const children = Array.from(nav.children);
      if (children.length < 3 || !children.slice(0, 3).every((child) => child instanceof HTMLDivElement)) continue;
      const right = children[NAVBAR_RIGHT_CLUSTER_INDEX];
      if (!(right instanceof HTMLDivElement)) continue;
      if (NAVBAR_RIGHT_CLUSTER_CLASSES.every((className) => right.classList.contains(className))) {
        return right;
      }
    }
    return null;
  }
  var NavbarSettingsButton = class {
    constructor(lifecycle, panel) {
      this.panel = panel;
      this.button = null;
      this.warnedMissingCluster = false;
      this.ensureInjected();
      const reposition = () => this.ensureInjected();
      const repositionOnScroll = (event) => {
        if (isInsideChatScroller(event.target)) return;
        this.ensureInjected();
      };
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", repositionOnScroll, true);
      lifecycle.add(() => {
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", repositionOnScroll, true);
      });
      lifecycle.add(subscribeLang(() => this.refresh()));
      visibleInterval(lifecycle, () => this.ensureInjected(), ENSURE_INTERVAL_MS2);
      lifecycle.add(() => this.dispose());
    }
    ensureInjected() {
      const cluster = findNavbarRightCluster();
      if (!cluster) {
        this.dispose();
        const renderedNavbar = Array.from(document.querySelectorAll("nav")).some((nav) => nav.children.length >= 3 && NAVBAR_HEIGHT_CLASSES.some((className) => nav.classList.contains(className)));
        if (renderedNavbar && !this.warnedMissingCluster) {
          this.warnedMissingCluster = true;
          logger.warn(
            'navbar-settings: Kick rendered a navbar, but findNavbarRightCluster could not match children[2] with classes "flex items-center gap-2". Check NAVBAR_RIGHT_CLUSTER_INDEX / NAVBAR_RIGHT_CLUSTER_CLASSES in src/content/chat/navbar-settings.ts; the KickFlow settings button is not mounted.'
          );
        }
        return;
      }
      const existing = document.getElementById(BUTTON_ID2);
      if (existing instanceof HTMLButtonElement && existing.classList.contains(BUTTON_CLASS2)) {
        this.button = existing;
      } else {
        if (existing) return;
        this.button = this.build();
      }
      const button = this.button;
      const mounted = button.parentElement !== document.body;
      if (mounted) document.body.append(button);
      if (!document.documentElement.hasAttribute(NAVBAR_ENTRY_ATTRIBUTE)) document.documentElement.setAttribute(NAVBAR_ENTRY_ATTRIBUTE, "");
      const box = cluster.getBoundingClientRect();
      setStyleIfChanged(button, "position", "fixed");
      setStyleIfChanged(button, "zIndex", "1000");
      setStyleIfChanged(button, "left", px(Math.max(8, Math.min(innerWidth - 42, box.left))));
      setStyleIfChanged(button, "top", px(Math.max(8, box.top + (box.height - 34) / 2)));
      setStyleIfChanged(button, "display", box.width > 0 && box.height > 0 ? "" : "none");
      this.refresh();
      if (mounted) window.dispatchEvent(new Event("kickflow:navbar-entrychange"));
    }
    build() {
      const button = document.createElement("button");
      button.type = "button";
      button.id = BUTTON_ID2;
      button.className = BUTTON_CLASS2;
      button.title = t("entry.settings_title");
      button.setAttribute("aria-label", t("entry.settings_aria"));
      button.textContent = "K";
      button.addEventListener("click", () => {
        this.panel.showSettings();
        this.refresh();
      });
      return button;
    }
    refresh() {
      const button = this.button;
      if (!button) return;
      const open = this.panel.isOpen();
      if (button.classList.contains(ACTIVE_CLASS2) !== open) button.classList.toggle(ACTIVE_CLASS2, open);
      if (button.dataset.kickflowClaimed === "true") return;
      const title = t("entry.settings_title");
      if (button.title !== title) button.title = title;
      const aria = t("entry.settings_aria");
      if (button.getAttribute("aria-label") !== aria) button.setAttribute("aria-label", aria);
    }
    dispose() {
      if (!this.button) return;
      this.button.remove();
      this.button = null;
      if (!document.querySelector(`body > .${BUTTON_CLASS2}`)) document.documentElement.removeAttribute(NAVBAR_ENTRY_ATTRIBUTE);
      window.dispatchEvent(new Event("kickflow:navbar-entrychange"));
    }
  };

  // src/content/chat/hover-meter.ts
  var HOVER_RELEASE_INTERVAL_MS = 250;
  var HOVER_METER_BACKLOG_CAP = 200;
  var INITIAL_NEXT_RELEASE_AT_MS = 0;
  var NO_ROWS_RELEASED = 0;
  var ONE_ROW_RELEASED = 1;
  var NO_DELAY_MS = 0;
  function measureHoverMeter(pendingRows, metered, nowMs, nextReleaseAt) {
    if (pendingRows <= 0) {
      return {
        admittedRows: NO_ROWS_RELEASED,
        releaseAll: false,
        nextReleaseAt,
        delayMs: null
      };
    }
    if (!metered) {
      return {
        admittedRows: pendingRows,
        releaseAll: true,
        nextReleaseAt,
        delayMs: null
      };
    }
    if (pendingRows > HOVER_METER_BACKLOG_CAP) {
      return {
        admittedRows: pendingRows,
        releaseAll: true,
        nextReleaseAt: nowMs + HOVER_RELEASE_INTERVAL_MS,
        delayMs: NO_DELAY_MS
      };
    }
    const delayMs = Math.max(NO_DELAY_MS, nextReleaseAt - nowMs);
    if (delayMs > NO_DELAY_MS) {
      return {
        admittedRows: NO_ROWS_RELEASED,
        releaseAll: false,
        nextReleaseAt,
        delayMs
      };
    }
    return {
      admittedRows: ONE_ROW_RELEASED,
      releaseAll: false,
      nextReleaseAt: nowMs + HOVER_RELEASE_INTERVAL_MS,
      delayMs: NO_DELAY_MS
    };
  }
  var HoverReleaseMeter = class {
    constructor() {
      this.metered = false;
      this.nextReleaseAt = INITIAL_NEXT_RELEASE_AT_MS;
    }
    setMetered(metered) {
      this.metered = metered;
    }
    release(pendingRows, nowMs) {
      const result = measureHoverMeter(pendingRows, this.metered, nowMs, this.nextReleaseAt);
      this.nextReleaseAt = result.nextReleaseAt;
      return { maxRows: result.admittedRows, releaseAll: result.releaseAll };
    }
    timeUntilNextRelease(pendingRows, nowMs) {
      return measureHoverMeter(pendingRows, this.metered, nowMs, this.nextReleaseAt).delayMs;
    }
  };
  var UNMETERED_RELEASE_POLICY = {
    release(pendingRows) {
      return { maxRows: pendingRows, releaseAll: true };
    },
    timeUntilNextRelease() {
      return null;
    }
  };

  // src/content/chat/render-queue.ts
  var FLUSH_INTERVAL_MS = 250;
  var MAX_BATCH_SIZE = 50;
  var MOUNT_RETRY_DELAY_MS = 250;
  var HIDDEN_BACKLOG_ROWS = 200;
  var HIDDEN_COMPACT_AT = HIDDEN_BACKLOG_ROWS * 2;
  var HIDDEN_FIRST_RENDER_DELAY_MS = 0;
  var RenderQueue = class {
    constructor(options) {
      this.options = options;
      this.pending = [];
      this.timerId = null;
      this.frameId = null;
      this.frameUsesTimeout = false;
      this.forceUnmeteredOnNextRender = false;
      this.disposed = false;
      /** True once any row reached the DOM. From then on a hidden tab builds no rows. */
      this.hasRendered = false;
      /** True while the last render found no mount. Enqueue then waits for the mount retry instead of
       * re-filtering the whole backlog on every message (the eviction test took 28 s that way). */
      this.mountUnavailable = false;
      this.handleVisibilityChange = () => {
        if (this.disposed) return;
        if (document.hidden) {
          if (this.frameId === null || this.frameUsesTimeout) return;
          window.cancelAnimationFrame(this.frameId);
          this.frameId = null;
          if (!this.hasRendered) this.scheduleRender();
          return;
        }
        if (this.pending.length === 0) return;
        this.compactHiddenBacklog();
        this.scheduleRender();
      };
      this.releasePolicy = options.releasePolicy ?? UNMETERED_RELEASE_POLICY;
      this.now = options.now ?? Date.now;
      this.scheduleTimer = options.scheduleTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
      this.cancelTimer = options.cancelTimer ?? ((timerId) => window.clearTimeout(timerId));
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    get pendingCount() {
      return this.pending.length;
    }
    enqueue(message2) {
      if (this.disposed) return;
      this.pending.push(message2);
      this.notifyPendingChange();
      if (this.parkedWhileHidden()) {
        if (this.pending.length >= HIDDEN_COMPACT_AT) this.compactHiddenBacklog();
        return;
      }
      if (this.pending.length >= MAX_BATCH_SIZE && !this.mountUnavailable) {
        this.flush();
        return;
      }
      this.schedulePendingWork(false);
    }
    /** Re-evaluates a pending batch after hover or pin state changes without adding another timer
     * owner. A metered queue can wake immediately; an unmetered queue retains the normal batch. */
    wake() {
      if (this.disposed || this.pending.length === 0) return;
      this.cancelScheduledTimer();
      this.schedulePendingWork(false);
    }
    /** Releases every pending row without applying metering. Pointer-leave calls this only after
     * its hover transition has disabled the injected meter. */
    flushPending() {
      if (this.disposed || this.pending.length === 0) return;
      this.cancelScheduledTimer();
      this.scheduleRender(true);
    }
    /** A VOD seek invalidates every row captured for the previous playback window, including rows
     * still waiting for the 250ms batch. Cancel scheduled work as well as clearing the array so an
     * old animation-frame callback cannot race the reset. */
    clearPending() {
      const hadPending = this.pending.length > 0;
      this.pending = [];
      if (hadPending) this.notifyPendingChange();
      this.cancelScheduledTimer();
      if (this.frameId !== null) {
        if (this.frameUsesTimeout) this.cancelTimer(this.frameId);
        else window.cancelAnimationFrame(this.frameId);
        this.frameId = null;
        this.frameUsesTimeout = false;
      }
      this.forceUnmeteredOnNextRender = false;
    }
    flush() {
      this.cancelScheduledTimer();
      if (this.pending.length === 0) return;
      this.scheduleRender();
    }
    parkedWhileHidden() {
      return this.hasRendered && document.hidden;
    }
    /** Releases evicted references and keeps preserved rows plus the newest HIDDEN_BACKLOG_ROWS. */
    compactHiddenBacklog() {
      const shouldRender = this.options.shouldRender;
      const live = shouldRender ? this.pending.filter(shouldRender) : this.pending;
      let ordinary = 0;
      for (const message2 of live) if (!message2.preserved) ordinary += 1;
      let skip = Math.max(0, ordinary - HIDDEN_BACKLOG_ROWS);
      const kept = skip === 0 ? live : live.filter((message2) => {
        if (message2.preserved || skip === 0) return true;
        skip -= 1;
        return false;
      });
      if (kept.length === this.pending.length) return;
      this.pending = kept;
      this.notifyPendingChange();
    }
    scheduleRender(forceUnmetered = false) {
      if (this.disposed || this.pending.length === 0) return;
      if (forceUnmetered) this.forceUnmeteredOnNextRender = true;
      if (this.frameId !== null) return;
      if (this.parkedWhileHidden()) return;
      const render = () => {
        this.frameId = null;
        this.frameUsesTimeout = false;
        const forceForThisRender = this.forceUnmeteredOnNextRender;
        this.forceUnmeteredOnNextRender = false;
        this.renderNextBatch(forceForThisRender);
      };
      if (document.hidden) {
        this.frameUsesTimeout = true;
        this.frameId = this.scheduleTimer(render, HIDDEN_FIRST_RENDER_DELAY_MS);
      } else {
        this.frameUsesTimeout = false;
        let renderedSynchronously = false;
        const id = window.requestAnimationFrame(() => {
          renderedSynchronously = true;
          render();
        });
        if (!renderedSynchronously) this.frameId = id;
      }
    }
    renderNextBatch(forceUnmetered) {
      if (this.disposed || this.pending.length === 0) return;
      if (this.parkedWhileHidden()) return;
      const shouldRender = this.options.shouldRender;
      if (shouldRender) {
        const retained = this.pending.filter(shouldRender);
        if (retained.length !== this.pending.length) {
          this.pending = retained;
          this.notifyPendingChange();
        }
        if (this.pending.length === 0) return;
      }
      const container = this.options.getContainer();
      this.mountUnavailable = !container;
      if (!container) {
        if (this.timerId === null) {
          this.timerId = this.scheduleTimer(() => {
            this.timerId = null;
            this.scheduleRender(forceUnmetered);
          }, MOUNT_RETRY_DELAY_MS);
        }
        return;
      }
      const decision = forceUnmetered ? { maxRows: this.pending.length, releaseAll: true } : this.releasePolicy.release(this.pending.length, this.now());
      if (decision.maxRows <= 0) {
        this.schedulePendingWork(false);
        return;
      }
      const batchSize = Math.min(this.pending.length, decision.maxRows, MAX_BATCH_SIZE);
      const batch = this.pending.splice(0, batchSize);
      this.notifyPendingChange();
      const fragment = document.createDocumentFragment();
      const appended = [];
      for (const message2 of batch) {
        if (this.options.shouldRender && !this.options.shouldRender(message2)) continue;
        try {
          const timestampText = this.options.formatTimestamp?.(message2);
          const element = buildMessageElement(message2, {
            timestampText,
            onOpenRemovedPanel: this.options.onOpenRemovedPanel,
            onReply: this.options.onReply
          });
          element.dataset.createdAt = message2.createdAt;
          this.options.registry.register(element, message2);
          fragment.appendChild(element);
          appended.push(element);
        } catch (error) {
          logger.error("render-queue: row render failed", message2.id, error);
        }
      }
      if (appended.length > 0) {
        this.hasRendered = true;
        let previous = container.lastElementChild instanceof HTMLElement ? Date.parse(container.lastElementChild.dataset.createdAt ?? "") : -Infinity;
        const orderedTail = appended.every((element) => {
          const at = Date.parse(element.dataset.createdAt);
          const follows = Number.isFinite(at) && at >= previous;
          previous = at;
          return follows;
        });
        if (orderedTail) {
          container.appendChild(fragment);
        } else {
          const ordered = Array.from(container.children).filter((child) => child instanceof HTMLElement).map((element) => ({ element, at: Date.parse(element.dataset.createdAt ?? "") }));
          for (const element of appended) {
            const at = Date.parse(element.dataset.createdAt);
            const index = Number.isFinite(at) ? ordered.findIndex((entry) => entry.at > at) : -1;
            container.insertBefore(element, index < 0 ? null : ordered[index].element);
            ordered.splice(index < 0 ? ordered.length : index, 0, { element, at });
          }
        }
        try {
          this.options.onFlush?.(appended);
        } catch (error) {
          logger.error("render-queue: flush callback failed", error);
        }
      }
      if (this.pending.length === 0) return;
      if (decision.releaseAll) this.scheduleRender(true);
      else this.schedulePendingWork(true);
    }
    schedulePendingWork(afterRender) {
      if (this.disposed || this.pending.length === 0 || this.frameId !== null || this.timerId !== null) return;
      const delayMs = this.releasePolicy.timeUntilNextRelease(this.pending.length, this.now());
      if (delayMs !== null) {
        this.timerId = this.scheduleTimer(() => {
          this.timerId = null;
          this.scheduleRender();
        }, delayMs);
        return;
      }
      if (afterRender) {
        this.scheduleRender();
        return;
      }
      this.timerId = this.scheduleTimer(() => this.flush(), FLUSH_INTERVAL_MS);
    }
    cancelScheduledTimer() {
      if (this.timerId === null) return;
      this.cancelTimer(this.timerId);
      this.timerId = null;
    }
    notifyPendingChange() {
      try {
        this.options.onPendingChange?.(this.pending.length);
      } catch (error) {
        logger.error("render-queue: pending-count callback failed", error);
      }
    }
    dispose() {
      this.disposed = true;
      this.clearPending();
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
  };

  // src/content/chat/history.ts
  function captureOutage(messages2) {
    const sample = messages2.filter((m) => !m.systemEvent && Number.isFinite(Date.parse(m.createdAt))).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-25);
    const last = sample[sample.length - 1];
    if (!last) return null;
    const lastAt = Date.parse(last.createdAt);
    const span = lastAt - Date.parse(sample[0].createdAt);
    return { lastId: last.id, lastAt, messagesPerMs: span > 0 ? (sample.length - 1) / span : null };
  }
  function planBackfill(history, oldestShown, outage) {
    const sorted = [...history].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let gap = outage && sorted.length > 0 ? { at: outage.lastAt + 1, count: 0, seconds: 0 } : null;
    if (outage && sorted.length > 0 && !sorted.some((m) => m.id === outage.lastId)) {
      const first = sorted.find((m) => Date.parse(m.createdAt) > outage.lastAt);
      if (first) {
        const elapsed = Date.parse(first.createdAt) - outage.lastAt;
        const expected = outage.messagesPerMs === null ? null : elapsed * outage.messagesPerMs;
        if (Date.parse(sorted[0].createdAt) > outage.lastAt && (expected === null ? elapsed > 3e3 : expected > 2)) {
          gap = {
            at: outage.lastAt + 1,
            count: expected === null ? null : Math.max(1, Math.round(expected) - 1),
            seconds: Math.max(1, Math.round(elapsed / 1e3))
          };
        }
      }
    }
    return { messages: sorted.filter((m) => oldestShown === null || Date.parse(m.createdAt) >= oldestShown), gap };
  }
  var historyUrl = (channelId, startTime) => {
    const base = `https://web.kick.com/api/v1/chat/${channelId}/history`;
    if (!startTime) return base;
    return `${base}?${new URLSearchParams({ start_time: startTime }).toString()}`;
  };
  var HISTORY_MAX_ATTEMPTS = 3;
  var HISTORY_RETRY_BASE_MS = 800;
  var HISTORY_FETCH_ATTEMPT_TIMEOUT_MS = 6e3;
  var ChatHistoryBackfill = class {
    constructor(channelId, callbacks, fetchHistory = fetchChatHistoryResult) {
      this.channelId = channelId;
      this.callbacks = callbacks;
      this.fetchHistory = fetchHistory;
      this.running = false;
      this.requested = false;
    }
    request() {
      this.requested = true;
      if (!this.running) void this.run();
    }
    async run() {
      this.running = true;
      try {
        while (this.requested && !this.callbacks.isDisposed()) {
          this.requested = false;
          const fetched = await this.fetchHistory(this.channelId);
          const result = Array.isArray(fetched) ? { status: "success", messages: fetched } : fetched;
          if (this.callbacks.isDisposed()) continue;
          this.callbacks.onResult?.(result);
          if (result.status === "success") this.callbacks.onMessages(result.messages);
        }
      } finally {
        this.running = false;
        if (this.requested && !this.callbacks.isDisposed()) void this.run();
      }
    }
  };
  async function fetchChatHistoryResult(channelId, startTime) {
    for (let attempt = 0; attempt < HISTORY_MAX_ATTEMPTS; attempt++) {
      const controller2 = new AbortController();
      const timeoutId = window.setTimeout(() => controller2.abort(), HISTORY_FETCH_ATTEMPT_TIMEOUT_MS);
      try {
        const response = await fetch(historyUrl(channelId, startTime), {
          headers: { accept: "application/json" },
          signal: controller2.signal
        });
        if (!response.ok) {
          logger.debug("history: fetch failed, status", response.status);
          const transient = response.status === 429 || response.status >= 500;
          if (!transient) return { status: "error", reason: "terminal-http", statusCode: response.status };
        } else {
          const json = await response.json();
          const raw = json?.data?.messages;
          if (!Array.isArray(raw)) return { status: "error", reason: "invalid-response" };
          const messages2 = [];
          for (const item of raw) {
            const message2 = normalizeMessage(item);
            if (message2) messages2.push(message2);
          }
          if (raw.length > 0 && messages2.length === 0) {
            return { status: "error", reason: "invalid-response" };
          }
          messages2.sort((a, b) => {
            const ta = Date.parse(a.createdAt);
            const tb = Date.parse(b.createdAt);
            return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
          });
          logger.debug("history: backfilled", messages2.length, "messages");
          return { status: "success", messages: messages2 };
        }
      } catch (error) {
        logger.info("history: fetch threw", error);
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (attempt < HISTORY_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, HISTORY_RETRY_BASE_MS * 2 ** attempt));
      }
    }
    logger.debug("history: fetch exhausted retries");
    return { status: "error", reason: "exhausted" };
  }

  // src/content/player/bar-chrome.js
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var CONTROLS_IDLE_MS = 4e3;
  var STRIP_ATTRIBUTE = "data-kickflow-strip";
  var STEP_SECONDS = 10;
  function inBottomArea(rect, x, y, barHeight = 80) {
    const depth = Math.min(rect.height / 3, Math.max(96, barHeight + 16));
    return x >= rect.left && x <= rect.right && y <= rect.bottom && y >= rect.bottom - depth;
  }
  function svgShell() {
    const svg = document.createElementNS(SVG_NS2, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  function createTransportIcon(pathData) {
    const svg = svgShell();
    const path = document.createElementNS(SVG_NS2, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  }
  var STEP_RING = "M4.84 6.63A8.95 8.95 0 1 1 3.05 12H4.95A7.05 7.05 0 1 0 6.36 7.77z";
  var STEP_ARROW = "M4.35 3.4h1.9v3.25h3.25v1.9H4.35z";
  function createStepIcon(direction) {
    const svg = svgShell();
    const arrow = document.createElementNS(SVG_NS2, "g");
    if (direction === "forward") arrow.setAttribute("transform", "matrix(-1 0 0 1 24 0)");
    for (const pathData of [STEP_RING, STEP_ARROW]) {
      const path = document.createElementNS(SVG_NS2, "path");
      path.setAttribute("d", pathData);
      arrow.append(path);
    }
    const label = document.createElementNS(SVG_NS2, "text");
    label.setAttribute("x", direction === "forward" ? "11.7" : "12.3");
    label.setAttribute("y", "15.3");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "kickflow-player-btn__step");
    label.textContent = String(STEP_SECONDS);
    svg.append(arrow, label);
    return svg;
  }
  function createCameraIcon() {
    const svg = svgShell();
    const body = document.createElementNS(SVG_NS2, "path");
    body.setAttribute(
      "d",
      "M9.1 4h5.8a1 1 0 0 1 .83.45L16.74 6H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 6h2.26l1.01-1.55A1 1 0 0 1 9.1 4zM12 9.5a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"
    );
    svg.append(body);
    return svg;
  }
  function createToLiveIcon() {
    const svg = svgShell();
    const path = document.createElementNS(SVG_NS2, "path");
    path.setAttribute("d", "M4.5 6.2v11.6a.7.7 0 0 0 1.1.6l8-5.8a.7.7 0 0 0 0-1.2l-8-5.8a.7.7 0 0 0-1.1.6ZM17 5.5h1.2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H17a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z");
    svg.append(path);
    return svg;
  }
  function filledIcon(pathData) {
    return createTransportIcon(pathData);
  }
  function createBoltIcon() {
    const svg = filledIcon("M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6Z");
    svg.setAttribute("class", "kickflow-speed-btn__bolt");
    return svg;
  }
  function createOverflowIcon() {
    return filledIcon(
      "M6 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM12 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM18 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z"
    );
  }
  var FALLBACK_BAR_CSS = `
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
`.trim();
  var PLATE_END_CLASS = "kickflow-player-group--plate-end";
  var PLATE_CHIP_GROUP_ID = "kickflow-catchup-controls";
  function onPlate(element) {
    return !!element && element.classList.contains("kickflow-player-group") && (element.id !== PLATE_CHIP_GROUP_ID || element.classList.contains("kickflow-player-group--chip"));
  }
  function syncPlateRunEnds(container) {
    if (!container) return;
    for (let element = container.firstElementChild; element; element = element.nextElementSibling) {
      if (!element.classList.contains("kickflow-player-group")) continue;
      const end = onPlate(element) && !onPlate(element.nextElementSibling);
      if (element.classList.contains(PLATE_END_CLASS) !== end) element.classList.toggle(PLATE_END_CLASS, end);
    }
  }

  // src/content/player/controls-visibility.ts
  var QUALITY_PROBE_TRIGGER_ATTRIBUTE = "data-kickflow-quality-probe-trigger";
  var BAR_SHELF_ATTRIBUTE = "data-kickflow-bar-shelf";
  var BAR_SELECTOR = "div.z-controls.bottom-0";
  function initControlsVisibility(lifecycle) {
    let visible = false, keyboard = false, timer = null, disposed = false;
    let host = null;
    let holding = false;
    const addedAttributes = /* @__PURE__ */ new Map();
    let shelves = /* @__PURE__ */ new Set();
    const syncShelves = () => {
      const next = /* @__PURE__ */ new Set();
      if (host) {
        for (const bar of host.querySelectorAll(BAR_SELECTOR)) {
          const shelf = bar.parentElement;
          if (shelf && shelf !== host && shelf.localName === "div") next.add(shelf);
        }
      }
      for (const shelf of shelves) if (!next.has(shelf)) shelf.removeAttribute(BAR_SHELF_ATTRIBUTE);
      for (const shelf of next) if (!shelf.hasAttribute(BAR_SHELF_ATTRIBUTE)) shelf.setAttribute(BAR_SHELF_ATTRIBUTE, "");
      shelves = next;
    };
    const releaseHost = () => {
      for (const shelf of shelves) shelf.removeAttribute(BAR_SHELF_ATTRIBUTE);
      shelves = /* @__PURE__ */ new Set();
      host?.removeAttribute("data-kickflow-controls");
      for (const [name, value] of addedAttributes) if (host?.getAttribute(name) === value) host.removeAttribute(name);
      addedAttributes.clear();
    };
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const menuOpen = () => !!findControlBar()?.querySelector(`:is([aria-expanded="true"], [data-state="open"][aria-haspopup]):not([${QUALITY_PROBE_TRIGGER_ATTRIBUTE}])`) || !!host?.querySelector(".kickflow-player-menu");
    const focused = () => keyboard && !!document.activeElement && (host === document.activeElement || !!findControlBar()?.contains(document.activeElement) || !!host?.querySelector(".kickflow-player-menu")?.contains(document.activeElement));
    const held = () => {
      const video = getVideoElement();
      return !!video && (video.paused || video.ended || focused() || menuOpen());
    };
    const wakeNative = () => {
      if (!host) return;
      const r = host.getBoundingClientRect();
      host.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom - 12 }));
    };
    const paint = () => {
      const next = findPlayerWrapper();
      if (host !== next) {
        releaseHost();
        host = next;
        for (const [name, value] of [["tabindex", "0"], ["role", "group"], ["aria-label", t("player.controls")]]) {
          if (host && !host.hasAttribute(name)) {
            host.setAttribute(name, value);
            addedAttributes.set(name, value);
          }
        }
      }
      const state2 = visible ? "shown" : "hidden";
      if (host?.getAttribute("data-kickflow-controls") !== state2) host?.setAttribute("data-kickflow-controls", state2);
      syncShelves();
      host?.dispatchEvent(new Event("kickflow:controlsvisibility"));
    };
    const arm = () => {
      cancel();
      holding = held();
      const delay = holding ? 2e3 : CONTROLS_IDLE_MS;
      timer = window.setTimeout(() => {
        timer = null;
        if (held() && document.visibilityState !== "hidden") {
          visible = true;
          wakeNative();
          paint();
          arm();
        } else {
          visible = false;
          paint();
        }
      }, delay);
    };
    const show = () => {
      visible = true;
      paint();
      if (!findControlBar() || held()) wakeNative();
      arm();
    };
    const hide = () => {
      cancel();
      holding = false;
      visible = false;
      paint();
    };
    const move = (event) => {
      const e = event;
      const wrapper = findPlayerWrapper();
      if (!wrapper) return;
      if (inBottomArea(wrapper.getBoundingClientRect(), e.clientX, e.clientY, findControlBar()?.getBoundingClientRect().height)) show();
    };
    lifecycle.addEventListener(document, "pointermove", move, true);
    lifecycle.addEventListener(document, "pointerdown", () => {
      keyboard = false;
    }, true);
    lifecycle.addEventListener(document, "keydown", (event) => {
      if (event.key === "Tab") keyboard = true;
      if (focused()) show();
    }, true);
    lifecycle.addEventListener(document, "focusin", () => {
      if (focused()) show();
    });
    lifecycle.addEventListener(document, "focusout", () => {
      if (!held()) arm();
    });
    lifecycle.addEventListener(document, "pointerout", (event) => {
      const e = event, wrapper = findPlayerWrapper();
      if (wrapper?.contains(e.target) && !wrapper.contains(e.relatedTarget) && !held()) hide();
      if (!e.relatedTarget && !held()) hide();
    }, true);
    lifecycle.addEventListener(window, "blur", () => {
      keyboard = false;
      hide();
    });
    lifecycle.addEventListener(document, "visibilitychange", () => {
      keyboard = false;
      if (document.visibilityState === "hidden") hide();
      else if (held()) show();
      else hide();
    });
    const reset = () => {
      if (held()) show();
      else hide();
    };
    lifecycle.addEventListener(document, "fullscreenchange", reset);
    lifecycle.addEventListener(window, "resize", reset);
    for (const type of ["pause", "play", "ended", "loadedmetadata", "emptied"]) {
      lifecycle.addEventListener(document, type, (event) => {
        if (event.target === getVideoElement()) reset();
      }, true);
    }
    const observer = new MutationObserver((records) => {
      if (disposed || onlyChatMutations(records)) return;
      if (findPlayerWrapper() !== host) reset();
      else if (held() && (!visible || !holding) && document.visibilityState !== "hidden") show();
      else if (!held() && holding) arm();
      syncShelves();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded", "data-state", "data-theatre"] });
    lifecycle.add(subscribeLang(() => {
      if (host && addedAttributes.has("aria-label")) {
        const label = t("player.controls");
        host.setAttribute("aria-label", label);
        addedAttributes.set("aria-label", label);
      }
    }));
    lifecycle.add(() => {
      disposed = true;
      cancel();
      observer.disconnect();
      releaseHost();
    });
    reset();
  }

  // src/content/player/video-element.ts
  var observers = /* @__PURE__ */ new WeakMap();
  function notifyIfChanged(entry) {
    const next = getVideoElement();
    if (next === entry.current) return;
    entry.current = next;
    for (const callback of entry.callbacks) callback(next);
  }
  function observerFor(lifecycle) {
    const existing = observers.get(lifecycle);
    if (existing) return existing;
    let entry;
    const observer = new MutationObserver(() => notifyIfChanged(entry));
    entry = {
      current: getVideoElement(),
      callbacks: /* @__PURE__ */ new Set(),
      observer
    };
    entry.observer.observe(document.body, { childList: true, subtree: true });
    lifecycle.add(() => {
      entry.observer.disconnect();
      entry.callbacks.clear();
      observers.delete(lifecycle);
    });
    observers.set(lifecycle, entry);
    return entry;
  }
  function observeVideoElement(lifecycle, callback) {
    if (lifecycle.isDisposed) return;
    const entry = observerFor(lifecycle);
    entry.callbacks.add(callback);
    lifecycle.add(() => entry.callbacks.delete(callback));
    callback(entry.current);
  }
  function bindVideoElementListener(lifecycle, type, listener, options) {
    let bound = null;
    observeVideoElement(lifecycle, (video) => {
      if (bound === video) return;
      bound?.removeEventListener(type, listener, options);
      bound = video;
      bound?.addEventListener(type, listener, options);
    });
    lifecycle.add(() => {
      bound?.removeEventListener(type, listener, options);
      bound = null;
    });
  }

  // src/content/chat/vod-replay.ts
  var REPLAY_BUCKET_SECONDS = 5;
  var IMMEDIATE_OFFSET_MS = Number.NEGATIVE_INFINITY;
  var RELEASED_ID_CAP = 4e3;
  function partitionDueMessages(pending, playbackMs) {
    const due = [];
    const rest = [];
    for (const entry of pending) {
      if (entry.offsetMs <= playbackMs) due.push(entry);
      else rest.push(entry);
    }
    return { due, rest };
  }
  var videosUrl = (channelId) => `https://web.kick.com/api/v1/channels/${channelId}/videos`;
  async function fetchVodMetadataResult(channelId, videoId) {
    try {
      const response = await fetch(videosUrl(channelId), {
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        return { status: "error", reason: "http", statusCode: response.status };
      }
      const json = await response.json();
      if (!Array.isArray(json?.data)) {
        return { status: "error", reason: "invalid-response" };
      }
      const match = json.data.find((item) => {
        if (!item || typeof item !== "object") return false;
        return item.id === videoId;
      });
      if (!match) return { status: "error", reason: "missing-video" };
      if (typeof match.start_time !== "string") {
        return { status: "error", reason: "invalid-start-time" };
      }
      const startTimeMs = Date.parse(match.start_time);
      if (!Number.isFinite(startTimeMs)) {
        return { status: "error", reason: "invalid-start-time" };
      }
      return { status: "success", startTimeMs };
    } catch (error) {
      logger.info("vod-replay: metadata fetch threw", error);
      return { status: "error", reason: "network" };
    }
  }
  var VodChatReplayController = class {
    constructor(lifecycle, channelId, videoId, callbacks, dependencies = {}) {
      this.lifecycle = lifecycle;
      this.channelId = channelId;
      this.videoId = videoId;
      this.callbacks = callbacks;
      this.startTimeMs = null;
      this.video = null;
      this.epoch = 0;
      this.lastRequestedBucket = null;
      this.queuedRequest = null;
      this.requestRunning = false;
      this.seekPending = false;
      this.started = false;
      this.unavailable = false;
      /** Fetched but not yet reached by the playhead, oldest first. */
      this.pending = [];
      this.pendingIds = /* @__PURE__ */ new Set();
      /** Ids already handed to the renderer, insertion-ordered so the cap can evict the oldest. */
      this.releasedIds = /* @__PURE__ */ new Set();
      this.bindVideo = (video) => {
        if (video === this.video || this.lifecycle.isDisposed || this.unavailable) return;
        const replacingVideo = this.video !== null;
        this.unbindVideo();
        this.video = video;
        if (replacingVideo) this.beginSeekReset();
        if (!video) return;
        video.addEventListener("timeupdate", this.handleTimeUpdate);
        video.addEventListener("play", this.handlePlay);
        video.addEventListener("seeking", this.handleSeeking);
        video.addEventListener("seeked", this.handleSeeked);
        this.queueCurrentPosition(true);
      };
      this.handleTimeUpdate = () => {
        if (this.video?.paused !== false) return;
        this.releaseDueMessages();
        this.queueCurrentPosition(false);
      };
      this.handlePlay = () => {
        this.releaseDueMessages();
        this.queueCurrentPosition(false);
      };
      this.handleSeeking = () => {
        if (this.seekPending) return;
        this.seekPending = true;
        this.beginSeekReset();
      };
      this.handleSeeked = () => {
        if (!this.seekPending) this.beginSeekReset();
        this.seekPending = false;
        this.queueCurrentPosition(true);
      };
      this.fetchMetadata = dependencies.fetchMetadata ?? fetchVodMetadataResult;
      this.fetchHistory = dependencies.fetchHistory ?? fetchChatHistoryResult;
      this.observeVideo = dependencies.observeVideo ?? observeVideoElement;
      lifecycle.add(() => this.unbindVideo());
    }
    async start() {
      if (this.started || this.lifecycle.isDisposed) return;
      this.started = true;
      const metadata = await this.fetchMetadata(this.channelId, this.videoId);
      if (this.lifecycle.isDisposed) return;
      if (metadata.status === "error") {
        logger.info("vod-replay: metadata unavailable", metadata.reason);
        this.markUnavailable();
        return;
      }
      this.startTimeMs = metadata.startTimeMs;
      this.observeVideo(this.lifecycle, this.bindVideo);
    }
    unbindVideo() {
      if (!this.video) return;
      this.video.removeEventListener("timeupdate", this.handleTimeUpdate);
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("seeking", this.handleSeeking);
      this.video.removeEventListener("seeked", this.handleSeeked);
      this.video = null;
    }
    beginSeekReset() {
      this.epoch += 1;
      this.lastRequestedBucket = null;
      this.queuedRequest = null;
      this.pending = [];
      this.pendingIds.clear();
      this.releasedIds.clear();
      this.callbacks.onReset();
    }
    /** Buffers a fetched bucket on the playback timeline. Kick returns a whole window at once; the
     * playhead — not the fetch — decides when each message appears, so replay flows at the rate the
     * chat actually had instead of arriving in one lump per bucket. */
    acceptMessages(messages2) {
      if (this.startTimeMs === null) return;
      let added = false;
      for (const message2 of messages2) {
        if (this.pendingIds.has(message2.id) || this.releasedIds.has(message2.id)) continue;
        const parsedAt = Date.parse(message2.createdAt);
        const offsetMs = Number.isFinite(parsedAt) ? parsedAt - this.startTimeMs : IMMEDIATE_OFFSET_MS;
        this.pending.push({ message: message2, offsetMs });
        this.pendingIds.add(message2.id);
        added = true;
      }
      if (added) this.pending.sort((left, right) => left.offsetMs - right.offsetMs);
      this.releaseDueMessages();
    }
    releaseDueMessages() {
      if (this.pending.length === 0 || this.startTimeMs === null) return;
      const currentTime = this.video?.currentTime;
      if (currentTime === void 0 || !Number.isFinite(currentTime)) return;
      const { due, rest } = partitionDueMessages(this.pending, currentTime * 1e3);
      if (due.length === 0) return;
      this.pending = rest;
      for (const entry of due) {
        this.pendingIds.delete(entry.message.id);
        this.releasedIds.add(entry.message.id);
      }
      this.trimReleasedIds();
      this.callbacks.onMessages(due.map((entry) => entry.message), this.startTimeMs);
    }
    trimReleasedIds() {
      if (this.releasedIds.size <= RELEASED_ID_CAP) return;
      const target = RELEASED_ID_CAP / 2;
      for (const id of this.releasedIds) {
        if (this.releasedIds.size <= target) break;
        this.releasedIds.delete(id);
      }
    }
    queueCurrentPosition(force) {
      if (this.lifecycle.isDisposed || this.unavailable || this.startTimeMs === null || !this.video || !Number.isFinite(this.video.currentTime)) {
        return;
      }
      const bucketSeconds = Math.max(
        0,
        Math.floor(this.video.currentTime / REPLAY_BUCKET_SECONDS) * REPLAY_BUCKET_SECONDS
      );
      if (!force && bucketSeconds === this.lastRequestedBucket) return;
      this.lastRequestedBucket = bucketSeconds;
      this.queuedRequest = { bucketSeconds, epoch: this.epoch };
      void this.drainRequests();
    }
    async drainRequests() {
      if (this.requestRunning || this.unavailable || this.lifecycle.isDisposed) return;
      this.requestRunning = true;
      try {
        while (this.queuedRequest && !this.unavailable && !this.lifecycle.isDisposed) {
          const request2 = this.queuedRequest;
          this.queuedRequest = null;
          const startTime = new Date(
            this.startTimeMs + (request2.bucketSeconds + REPLAY_BUCKET_SECONDS) * 1e3
          ).toISOString();
          const result = await this.fetchHistory(this.channelId, startTime);
          if (this.lifecycle.isDisposed || request2.epoch !== this.epoch) continue;
          if (result.status === "error") {
            logger.info("vod-replay: history unavailable", result.reason);
            this.markUnavailable();
            return;
          }
          this.acceptMessages(result.messages);
          this.callbacks.onReady();
        }
      } finally {
        this.requestRunning = false;
        if (this.queuedRequest && !this.unavailable && !this.lifecycle.isDisposed) {
          void this.drainRequests();
        }
      }
    }
    markUnavailable() {
      if (this.unavailable || this.lifecycle.isDisposed) return;
      this.unavailable = true;
      this.queuedRequest = null;
      this.callbacks.onUnavailable();
    }
  };

  // src/content/player/bar-shared.js
  var NORMAL_PLAYBACK_RATE = 1;
  var SPEED_RATES = Object.freeze([3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25]);
  var SPEED_GRID_RATES = Object.freeze([...SPEED_RATES].reverse());
  var SPEED_GRID_COLUMNS = 3;
  function formatPlaybackRate(rate, lang2) {
    const text = Number.isInteger(rate) ? rate.toFixed(0) : String(rate);
    return `${lang2 === "tr" ? text.replace(".", ",") : text}\xD7`;
  }
  function displayObservedRate(rate, lang2) {
    const known = [NORMAL_PLAYBACK_RATE, ...SPEED_RATES];
    const nearest = known.reduce((best, candidate) => Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best);
    return Math.abs(nearest - rate) <= 0.03 ? formatPlaybackRate(nearest, lang2) : formatPlaybackRate(Number(rate.toFixed(2)), lang2);
  }
  var CATCHUP_PLAYBACK_RATE = 1.5;
  var BEHIND_THRESHOLD_SECONDS = 3;
  var CHIP_HIDE_SECONDS = 2.5;
  var CAUGHT_UP_THRESHOLD_SECONDS = 1.5;
  var CATCHUP_MIN_START_BUFFER_SECONDS = 1;
  var CATCHUP_MIN_KEEP_BUFFER_SECONDS = 0.5;
  var CATCHUP_STALL_HOLD_MS = 6e4;
  var CATCHUP_MAX_STALL_HOLD_MS = 16 * 6e4;
  function stallHoldMs(stalls) {
    const n = Math.max(1, Math.floor(stalls));
    return Math.min(CATCHUP_MAX_STALL_HOLD_MS, CATCHUP_STALL_HOLD_MS * 2 ** (n - 1));
  }
  function createSeekRecoveryTracker() {
    const recovering = /* @__PURE__ */ new WeakMap();
    return (type, video) => {
      if (type === "loadstart" || type === "playing" && !video.seeking) {
        recovering.delete(video);
      } else if (type === "seeking") {
        recovering.set(video, null);
      } else if (type === "seeked") {
        recovering.set(video, video.currentTime);
      } else if (type === "timeupdate" && !video.seeking && !video.paused && video.readyState >= 3) {
        const position = recovering.get(video);
        if (typeof position === "number" && video.currentTime > position + 0.05) recovering.delete(video);
      }
      return video.seeking || recovering.has(video);
    };
  }
  function decideCatchup(input) {
    if (!input.behindPlausible) return { kind: "none" };
    if (input.mode === "manual") {
      if (input.manualRate > NORMAL_PLAYBACK_RATE && input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
        return { kind: "manualDropToNormal" };
      }
      return { kind: "none" };
    }
    const measured = input.bufferAhead !== void 0;
    const buffer = input.bufferAhead ?? 0;
    if (input.stallHold) {
      return input.catchingUp ? { kind: "setRate", rate: NORMAL_PLAYBACK_RATE } : { kind: "none" };
    }
    if (!input.catchingUp && input.behindBy > BEHIND_THRESHOLD_SECONDS) {
      if (measured && buffer < CATCHUP_MIN_START_BUFFER_SECONDS) return { kind: "none" };
      return { kind: "setRate", rate: CATCHUP_PLAYBACK_RATE };
    }
    if (input.catchingUp && input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
      return { kind: "setRate", rate: NORMAL_PLAYBACK_RATE };
    }
    if (input.catchingUp && measured && buffer < CATCHUP_MIN_KEEP_BUFFER_SECONDS) {
      return { kind: "setRate", rate: NORMAL_PLAYBACK_RATE };
    }
    return { kind: "none" };
  }
  function bufferAheadSeconds(video) {
    const time = video.currentTime;
    if (!Number.isFinite(time)) return null;
    const ranges = video.buffered;
    if (!ranges) return null;
    for (let index = 0; index < ranges.length; index++) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      if (time >= start - 0.1 && time <= end) {
        const ahead = end - time;
        return Number.isFinite(ahead) ? Math.max(0, ahead) : null;
      }
    }
    return null;
  }
  function planBarBudget(input) {
    const ids = input.controls.map((control) => control.id);
    const total = input.controls.reduce((sum, control) => sum + control.cost, 0);
    if (total <= input.free) return { mounted: ids, collapsed: [], overflow: false };
    if (input.overflowCost > input.free) return { mounted: [], collapsed: ids, overflow: false };
    const costs = new Map(input.controls.map((control) => [control.id, control.cost]));
    const budget = input.free - input.overflowCost;
    const collapsed = /* @__PURE__ */ new Set();
    let needed = total;
    for (const id of [...input.collapseOrder, ...ids]) {
      if (needed <= budget) break;
      const cost = costs.get(id) ?? 0;
      if (cost <= 0 || collapsed.has(id)) continue;
      collapsed.add(id);
      needed -= cost;
    }
    return {
      mounted: ids.filter((id) => !collapsed.has(id)),
      collapsed: ids.filter((id) => collapsed.has(id)),
      overflow: true
    };
  }
  function samePlan(left, right) {
    return left.overflow === right.overflow && left.mounted.join() === right.mounted.join() && left.collapsed.join() === right.collapsed.join();
  }
  var HOST_CHECK_INTERVAL_MS = 250;
  var VIEWPORT_MARGIN_PX = 8;
  var PlayerMenu = class {
    constructor(options) {
      this.options = options;
      this.element = null;
      this.disposers = [];
    }
    get isOpen() {
      return this.element !== null;
    }
    toggle(anchor) {
      if (this.isOpen) {
        this.close();
        return;
      }
      this.open(anchor);
    }
    open(anchor) {
      const host = document.fullscreenElement ?? this.options.host?.() ?? null;
      if (!host) return;
      this.close();
      const menu = document.createElement("div");
      menu.className = `kickflow-player-menu ${this.options.className}`;
      menu.setAttribute("role", "menu");
      menu.style.visibility = "hidden";
      this.options.fill(menu);
      host.append(menu);
      this.element = menu;
      this.position(menu, anchor);
      this.bindClosers(menu, anchor);
      const focusTarget = this.options.initialFocus?.(menu);
      focusTarget?.focus({ preventScroll: true });
    }
    close() {
      if (!this.element) return;
      this.element.remove();
      this.element = null;
      for (const dispose of this.disposers.splice(0)) dispose();
    }
    position(menu, anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      const menuWidth = menu.offsetWidth;
      const left = clamp2(
        anchorRect.left + anchorRect.width / 2 - menuWidth / 2,
        VIEWPORT_MARGIN_PX,
        window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX
      );
      menu.style.left = `${Math.round(left)}px`;
      menu.style.bottom = `${Math.round(window.innerHeight - anchorRect.top + VIEWPORT_MARGIN_PX)}px`;
      menu.style.visibility = "";
    }
    bindClosers(menu, anchor) {
      this.listen(document, "pointerdown", (event) => {
        const target = event.target;
        if (target instanceof Node) {
          if (menu.contains(target) || anchor.contains(target)) return;
          const element = target instanceof Element ? target : target.parentElement;
          if (element?.closest(".kickflow-player-menu")) return;
        }
        this.close();
      }, true);
      this.listen(document, "keydown", (event) => {
        if (event.key !== "Escape") return;
        const hadFocus = menu.contains(document.activeElement);
        this.close();
        if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
      });
      this.listen(window, "resize", () => this.close());
      this.listen(document, "fullscreenchange", () => this.close());
      const timer = window.setInterval(() => {
        if (!anchor.isConnected) this.close();
      }, HOST_CHECK_INTERVAL_MS);
      this.disposers.push(() => window.clearInterval(timer));
    }
    listen(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      this.disposers.push(() => target.removeEventListener(type, listener, options));
    }
  };
  function clamp2(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  var QUALITY_INTENTS = Object.freeze(["best", "auto", "saver"]);
  var DEFAULT_QUALITY_MODE = "best";
  var SAVER_MAX_HEIGHT = 480;
  var QUALITY_ATTRIBUTE = "data-kickflow-quality";
  var RESOLUTION_LABEL = /^(\d{3,4})p(?:\s*(\d{2,3})(?:\s*fps)?)?(?:\s*\((?:source|original|kaynak|orijinal)\))?$/i;
  var SOURCE_LABEL = /^(source|original|kaynak|orijinal)$/i;
  var AUTO_LABEL = /^(auto|otomatik|oto)$/i;
  var MODE_LABEL = /^(\d{3,4})p(\d{2,3})?$/;
  function normalizeQualityMode(value) {
    if (value === "highest") return "best";
    if (QUALITY_INTENTS.includes(value)) return value;
    return typeof value === "string" && MODE_LABEL.test(value) ? value : null;
  }
  function qualityScore(text) {
    const label = String(text ?? "").trim();
    if (SOURCE_LABEL.test(label)) return Number.MAX_SAFE_INTEGER;
    const match = label.match(RESOLUTION_LABEL);
    return match ? parseInt(match[1], 10) * 1e3 + Number(match[2] || 0) : -1;
  }
  function qualityHeight(text) {
    const label = String(text ?? "").trim();
    if (SOURCE_LABEL.test(label)) return Number.POSITIVE_INFINITY;
    const match = label.match(RESOLUTION_LABEL);
    return match ? parseInt(match[1], 10) : null;
  }
  function isAutoQualityLabel(text) {
    return AUTO_LABEL.test(String(text ?? "").trim());
  }
  function qualityModeLabel(text) {
    const label = String(text ?? "").trim();
    if (SOURCE_LABEL.test(label)) return null;
    const match = label.match(RESOLUTION_LABEL);
    return match ? `${parseInt(match[1], 10)}p${match[2] ? Number(match[2]) : ""}` : null;
  }
  function pickQuality(mode, labels) {
    if (mode === "auto") return -1;
    const scored = [];
    labels.forEach((label, index) => {
      const score = qualityScore(label);
      if (score >= 0) scored.push({ index, score, height: qualityHeight(label), short: qualityModeLabel(label) });
    });
    if (!scored.length) return null;
    const highest = (list) => list.reduce((best, item) => item.score > best.score ? item : best);
    const lowest = (list) => list.reduce((best, item) => item.score < best.score ? item : best);
    if (mode === "saver") {
      const within = scored.filter((item) => item.height <= SAVER_MAX_HEIGHT);
      return (within.length ? highest(within) : lowest(scored)).index;
    }
    if (mode !== "best" && normalizeQualityMode(mode)) {
      const exact = scored.find((item) => item.short === mode);
      if (exact) return exact.index;
      const target = qualityScore(mode);
      const below = scored.filter((item) => item.score <= target);
      return (below.length ? highest(below) : lowest(scored)).index;
    }
    return highest(scored).index;
  }
  function qualityChipParts(mode, current, words2) {
    const sub = mode === "best" ? words2.subBest : mode === "auto" ? words2.subAuto : mode === "saver" ? words2.subSaver : words2.subExact || "";
    return { value: current || words2.chip, sub };
  }
  var paintedChips = /* @__PURE__ */ new WeakMap();
  function paintQualityChip(button, mode, current, words2) {
    const { value, sub } = qualityChipParts(mode, current, words2);
    const label = `${words2.title}: ${value}${sub ? ` ${sub}` : ""}`;
    if (paintedChips.get(button) === label) return;
    paintedChips.set(button, label);
    const text = document.createElement("span");
    text.className = "kickflow-quality-btn__value";
    text.textContent = value;
    const parts = [text];
    if (sub) {
      const small = document.createElement("small");
      small.className = "kickflow-quality-btn__sub";
      small.textContent = sub;
      parts.push(small);
    }
    button.replaceChildren(...parts);
    button.classList.toggle("kickflow-quality-btn--held", mode !== "auto");
    button.setAttribute("aria-label", label);
    button.title = words2.title;
  }
  function createQualityButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kickflow-speed-btn kickflow-quality-btn";
    button.setAttribute("aria-haspopup", "menu");
    return button;
  }
  function fillQualityMenu(menu, { mode, current, renditions, words: words2, onPick }) {
    menu.setAttribute("aria-label", words2.title);
    const head = document.createElement("div");
    head.className = "kickflow-quality-menu__head";
    head.textContent = words2.title;
    menu.append(head);
    const row = (value, title, hint, className) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `kickflow-quality-menu__item ${className}`;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(mode === value));
      item.setAttribute("data-quality-mode", value);
      const name = document.createElement("b");
      name.textContent = title;
      item.append(name);
      if (hint) {
        const small = document.createElement("small");
        small.textContent = hint;
        item.append(small);
      }
      item.addEventListener("click", () => onPick(value));
      return item;
    };
    menu.append(
      row("best", words2.best, words2.bestHint(current), "kickflow-quality-menu__intent"),
      row("auto", words2.auto, words2.autoHint, "kickflow-quality-menu__intent"),
      row("saver", words2.saver, words2.saverHint, "kickflow-quality-menu__intent")
    );
    if (!renditions.length) return;
    const separator = document.createElement("div");
    separator.className = "kickflow-quality-menu__sep";
    separator.setAttribute("role", "separator");
    const exactPicked = !QUALITY_INTENTS.includes(mode);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "kickflow-quality-menu__more";
    more.textContent = `${words2.more} \u203A`;
    more.setAttribute("aria-expanded", String(exactPicked));
    const grid = document.createElement("div");
    grid.className = "kickflow-quality-menu__grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", words2.more);
    grid.hidden = !exactPicked;
    for (const label of renditions) grid.append(row(label, label, "", "kickflow-quality-menu__exact"));
    more.addEventListener("click", () => {
      grid.hidden = !grid.hidden;
      more.setAttribute("aria-expanded", String(!grid.hidden));
      if (!grid.hidden) grid.querySelector("button")?.focus({ preventScroll: true });
    });
    menu.append(separator, more, grid);
  }
  function qualityRenditions(labels) {
    const seen = /* @__PURE__ */ new Set();
    return labels.map((label) => ({ short: qualityModeLabel(label), score: qualityScore(label) })).filter((item) => item.short && !seen.has(item.short) && seen.add(item.short)).sort((left, right) => right.score - left.score).map((item) => item.short);
  }
  var CLIP_SECONDS = 15;
  var CLIP_VIDEO_BITS_PER_SECOND = 3e6;
  var STATUS_MS = 4e3;
  function createCaptureNamer() {
    let lastStamp = "";
    let suffix = 0;
    return (pathname, extension, now = /* @__PURE__ */ new Date()) => {
      const slug = String(pathname || "").split("/").filter(Boolean)[0]?.replace(/[^a-z0-9_-]/gi, "") || "kick";
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      suffix = stamp === lastStamp ? suffix + 1 : 0;
      lastStamp = stamp;
      return `${slug}_${stamp}${suffix ? `_${suffix}` : ""}.${extension}`;
    };
  }
  function showCaptureStatus(host, text) {
    if (!host) return;
    host.querySelector(".kickflow-capture-status")?.remove();
    const status2 = document.createElement("div");
    status2.className = "kickflow-capture-status";
    status2.setAttribute("role", "status");
    status2.textContent = text;
    host.append(status2);
    window.setTimeout(() => status2.remove(), STATUS_MS);
  }
  function createLocalClip(options) {
    let recorder = null;
    let stream = null;
    let timeout = null;
    let previewUrl = null;
    let generation = 0;
    const scope = options.scope ?? "kickflow";
    const say = (key) => showCaptureStatus(options.getHost(), options.text(key));
    const title = () => options.title ? options.title(!!recorder) : options.text(recorder ? "clip_stop" : "clip_record");
    const refreshButtons = () => {
      for (const button of document.querySelectorAll(`[data-kickflow-local-clip="${scope}"]`)) {
        button.textContent = recorder ? "\u25A0" : "\u25CF";
        button.setAttribute("aria-pressed", String(!!recorder));
        button.title = title();
        button.setAttribute("aria-label", button.title);
      }
    };
    const releaseStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    const closePreview = () => {
      document.querySelector(".kickflow-clip-preview")?.remove();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    };
    const cancel = () => {
      generation++;
      const active = recorder;
      recorder = null;
      if (active && active.state !== "inactive") active.stop();
      releaseStream();
      closePreview();
      refreshButtons();
    };
    const preview = (blob) => {
      closePreview();
      const host = options.getHost();
      if (!host) return;
      previewUrl = URL.createObjectURL(blob);
      const url = previewUrl;
      const name = options.filename("webm");
      const panel = document.createElement("section");
      panel.className = "kickflow-clip-preview";
      panel.setAttribute("aria-label", options.text("clip_preview"));
      const heading = document.createElement("strong");
      heading.textContent = options.text("clip_preview");
      const player = document.createElement("video");
      player.src = url;
      player.controls = true;
      player.muted = true;
      player.preload = "metadata";
      const filename = document.createElement("small");
      filename.textContent = name;
      const save = document.createElement("a");
      save.href = url;
      save.download = name;
      save.textContent = options.text("clip_save");
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = options.text("close");
      close.onclick = closePreview;
      panel.append(heading, player, filename, save, close);
      host.append(panel);
      say("clip_ready");
    };
    const toggle = () => {
      if (recorder) {
        if (recorder.state !== "inactive") recorder.stop();
        return true;
      }
      const video = options.getVideo();
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused) {
        say("capture_no_frame");
        return false;
      }
      if (typeof MediaRecorder === "undefined" || !video.captureStream) {
        say("clip_unsupported");
        return false;
      }
      const token = ++generation;
      try {
        const mime = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
        if (!mime) throw Error("WebM unsupported");
        stream = video.captureStream();
        if (!stream.getVideoTracks().length) throw Error("No video track");
        const chunks = [];
        const active = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: CLIP_VIDEO_BITS_PER_SECOND });
        recorder = active;
        active.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        active.onstop = () => {
          if (token !== generation) return;
          recorder = null;
          releaseStream();
          refreshButtons();
          const blob = new Blob(chunks, { type: mime });
          if (blob.size) preview(blob);
          else say("capture_failed");
        };
        active.onerror = () => {
          if (token !== generation) return;
          cancel();
          say("capture_failed");
        };
        active.start();
        timeout = window.setTimeout(() => {
          if (active.state !== "inactive") active.stop();
        }, CLIP_SECONDS * 1e3);
        refreshButtons();
        say("clip_recording");
        return true;
      } catch {
        recorder = null;
        releaseStream();
        refreshButtons();
        say("capture_failed");
        return false;
      }
    };
    const createButton = () => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kickflow-player-btn";
      button.setAttribute("data-kickflow-local-clip", scope);
      button.textContent = recorder ? "\u25A0" : "\u25CF";
      button.title = title();
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(!!recorder));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle();
      });
      return button;
    };
    return { toggle, cancel, closePreview, refreshButtons, createButton, isRecording: () => !!recorder };
  }
  function showFrameToast(host, url, filename, heading, ms = 2400) {
    if (!host) return null;
    host.querySelector(".kickflow-frame-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "kickflow-frame-toast";
    toast.setAttribute("role", "status");
    const thumb = document.createElement("img");
    thumb.className = "kickflow-frame-toast__thumb";
    thumb.alt = "";
    thumb.src = url;
    const text = document.createElement("span");
    text.className = "kickflow-frame-toast__text";
    const title = document.createElement("b");
    title.textContent = heading;
    const name = document.createElement("small");
    name.textContent = filename;
    text.append(title, name);
    toast.append(thumb, text);
    host.append(toast);
    return window.setTimeout(() => toast.remove(), ms);
  }

  // src/content/player/bar-budget.ts
  function measureBarBudget(bar, ours) {
    const barStyle = getComputedStyle(bar);
    const content = bar.clientWidth - lengthOf(barStyle.paddingLeft) - lengthOf(barStyle.paddingRight);
    if (!(content > 0)) return null;
    let used = 0;
    let flowChildren = 0;
    for (const child of Array.from(bar.children)) {
      if (!(child instanceof HTMLElement) || !occupiesFlow(child)) continue;
      flowChildren += 1;
      used += child.getBoundingClientRect().width;
    }
    used += Math.max(0, flowChildren - 1) * lengthOf(barStyle.columnGap);
    const costs = /* @__PURE__ */ new Map();
    for (const element of ours) {
      if (!element.id || !bar.contains(element) || !occupiesFlow(element)) continue;
      const cost = controlCost(element);
      costs.set(element.id, cost);
      used -= cost;
    }
    return { free: content - used, costs };
  }
  function controlCost(element) {
    const parent = element.parentElement;
    const gap = parent ? lengthOf(getComputedStyle(parent).columnGap) : 0;
    return element.getBoundingClientRect().width + gap;
  }
  function lengthOf(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function occupiesFlow(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.position !== "absolute" && style.position !== "fixed";
  }

  // src/content/player/player-menu.ts
  var PlayerMenu2 = class extends PlayerMenu {
    constructor(options) {
      super({ ...options, host: findPlayerWrapper });
    }
  };

  // src/content/player/overflow-menu.ts
  function createOverflowControl(lifecycle, rows) {
    const group = document.createElement("span");
    group.className = "kickflow-player-group kickflow-player-group--overflow";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kickflow-player-btn kickflow-player-btn--overflow";
    button.setAttribute("aria-haspopup", "menu");
    button.append(createOverflowIcon());
    group.append(button);
    const menu = new PlayerMenu2({
      className: "kickflow-overflow-menu",
      fill: (root) => {
        for (const control of rows()) {
          const row = document.createElement("div");
          row.className = "kickflow-overflow-menu__row";
          row.append(control);
          const title = control.querySelector("button")?.title ?? "";
          const match = /^(.*?)\s*\(([^()]+)\)$/.exec(title);
          const name = document.createElement("span");
          name.className = "kickflow-overflow-menu__name";
          name.textContent = match ? match[1] : title;
          row.append(name);
          if (match) {
            const key = document.createElement("kbd");
            key.className = "kickflow-player-kbd";
            key.textContent = match[2];
            row.append(key);
          }
          root.append(row);
        }
      }
    });
    const applyLang = () => {
      button.title = t("player.more_controls");
      button.setAttribute("aria-label", t("player.more_controls"));
    };
    applyLang();
    button.addEventListener("click", () => menu.toggle(button));
    lifecycle.add(subscribeLang(() => {
      applyLang();
      menu.close();
    }));
    lifecycle.add(() => menu.close());
    return {
      element: group,
      close: () => menu.close(),
      detach: () => {
        menu.close();
        group.remove();
      }
    };
  }

  // src/content/player/native-bar.ts
  var OBSERVER_DEBOUNCE_MS = 150;
  var RETRY_INTERVAL_MS = 250;
  var RETRY_LIMIT = 20;
  var CONTROL_ORDER = [
    "kickflow-rewind-controls",
    "kickflow-speed-controls",
    "kickflow-quality-controls",
    "kickflow-screenshot-controls",
    "kickflow-catchup-controls"
  ];
  var COLLAPSE_PRIORITY = [
    "kickflow-screenshot-controls",
    "kickflow-quality-controls",
    "kickflow-speed-controls",
    "kickflow-rewind-controls",
    "kickflow-catchup-controls"
  ];
  var OVERFLOW_CONTROL_ID = "kickflow-overflow-controls";
  var CHIP_CONTROL_ID = "kickflow-catchup-controls";
  var BUDGET_PASS_LIMIT = 3;
  var EMPTY_PLAN = { mounted: [], collapsed: [], overflow: false };
  function controlPriority(id) {
    const index = CONTROL_ORDER.indexOf(id);
    return index < 0 ? CONTROL_ORDER.length : index;
  }
  var managers = /* @__PURE__ */ new WeakMap();
  var managerAliases = /* @__PURE__ */ new WeakMap();
  var controlOwners = /* @__PURE__ */ new WeakMap();
  var NativeBarMountManager = class {
    constructor(lifecycle) {
      this.lifecycle = lifecycle;
      this.controls = /* @__PURE__ */ new Map();
      /** Children of the BAR itself rather than of the button row. The seek bar is absolutely
       * positioned against the bar's own box, so it cannot live beside the buttons. Same manager,
       * same observers, same rebuild-survival — only the insertion point differs. */
      this.rootControls = /* @__PURE__ */ new Map();
      this.wrapperObserver = new MutationObserver(() => this.handleMutation());
      // Body-wide so a remounted player is found; chat rows mutating inside the chat scrollers can
      // neither remount the player nor remove a bar control, so those batches are skipped (2026-11-09).
      this.wrapperRebindObserver = new MutationObserver((records) => {
        if (!onlyChatMutations(records)) this.handleMutation();
      });
      // Kick's theatre-mode layout (fixed positioning + a calc(100vw - var(--chat-width)) bar
      // width, confirmed live 2026-07-15) is driven entirely by Tailwind's `group-data-[theatre=true]`
      // variant against a `[data-theatre]` ancestor: the bar's own class/style attributes never
      // change, only that ancestor's `data-theatre` value does. childList-only observation above
      // never sees this, so it needs its own attribute watch scoped to just that one attribute.
      this.theatreAttributeObserver = new MutationObserver(() => this.handleMutation());
      /** The bar's width is what the budget is spent against, and it changes without any mutation
       * we can see (window resize, chat panel, theatre). Re-planning happens inside this callback,
       * which the browser runs BEFORE it paints, so no frame ever shows Kick's controls displaced.
       * Absent in jsdom, where there is no layout to observe either. */
      this.barResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.ensureAll()) : null;
      this.observedBar = null;
      this.overflow = null;
      this.plan = EMPTY_PLAN;
      /** The button row our groups were last placed in; its plate end is re-marked on every
       * mutation batch, before paint, as the :has() rule it replaces did (2026-11-09). */
      this.plateParent = null;
      /** Last measured cost per control id, including the ⋯ button. A collapsed control is not in
       * the bar and cannot be measured, so its last real measurement is what decides whether it may
       * come back. */
      this.costs = /* @__PURE__ */ new Map();
      this.observedWrapper = null;
      this.trailingEnsureTimer = null;
      this.retryTimer = null;
      this.retryAttempts = 0;
      this.warnedMissingAnchors = /* @__PURE__ */ new Set();
      this.disposed = false;
      this.rebindWrapper();
      this.wrapperRebindObserver.observe(document.body, { childList: true, subtree: true });
      this.theatreAttributeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-theatre"],
        subtree: true
      });
      lifecycle.addEventListener(document, "fullscreenchange", () => this.handleMutation());
      lifecycle.add(() => this.dispose());
    }
    mount(ownerLifecycle, id, build) {
      return this.register(this.controls, ownerLifecycle, id, build);
    }
    mountRoot(ownerLifecycle, id, build) {
      return this.register(this.rootControls, ownerLifecycle, id, build);
    }
    register(registry, ownerLifecycle, id, build) {
      let control = registry.get(id);
      if (!control) {
        control = { id, build, element: null };
        registry.set(id, control);
        ownerLifecycle.add(() => this.unmount(id));
      }
      this.ensureAll();
      return control.element?.isConnected ? control.element : null;
    }
    unmount(id) {
      const registry = this.controls.has(id) ? this.controls : this.rootControls;
      const control = registry.get(id);
      if (!control) return;
      if (control.element) this.barResizeObserver?.unobserve(control.element);
      control.element?.remove();
      if (control.element) controlOwners.delete(control.element);
      const existing = document.getElementById(id);
      if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
      registry.delete(id);
      this.costs.delete(id);
      this.plan = {
        ...this.plan,
        mounted: this.plan.mounted.filter((entry) => entry !== id),
        collapsed: this.plan.collapsed.filter((entry) => entry !== id)
      };
      this.ensureAll();
    }
    rebindWrapper() {
      const currentWrapper = findPlayerWrapper();
      if (currentWrapper === this.observedWrapper) return;
      this.wrapperObserver.disconnect();
      this.observedWrapper = currentWrapper;
      if (currentWrapper) {
        this.wrapperObserver.observe(currentWrapper, { childList: true, subtree: true });
      }
    }
    /** A fast leading check keeps a continuous React mutation stream from starving remounts.
     * The trailing pass still catches a settled bar whose controls were merely reordered. */
    handleMutation() {
      if (this.disposed) return;
      this.rebindWrapper();
      if (this.plateParent?.isConnected) syncPlateRunEnds(this.plateParent);
      if (this.retryAttempts >= RETRY_LIMIT) this.retryAttempts = 0;
      if (this.hasMissingControl()) {
        this.ensureAll();
      }
      this.scheduleTrailingEnsure();
    }
    /** A COLLAPSED control is absent from the document on purpose (its element lives in the
     * overflow menu, which exists only while the menu is open). Counting it as missing would make
     * every mutation re-mount it, and the re-mount would mutate the DOM again — a loop. */
    hasMissingControl() {
      for (const control of [...this.controls.values(), ...this.rootControls.values()]) {
        if (this.plan.collapsed.includes(control.id)) continue;
        if (!(document.getElementById(control.id) instanceof HTMLElement)) return true;
      }
      return false;
    }
    scheduleTrailingEnsure() {
      if (this.trailingEnsureTimer !== null) window.clearTimeout(this.trailingEnsureTimer);
      this.trailingEnsureTimer = window.setTimeout(() => {
        this.trailingEnsureTimer = null;
        this.ensureAll();
      }, OBSERVER_DEBOUNCE_MS);
    }
    scheduleRetry(missingAnchor) {
      if (this.disposed || this.retryTimer !== null) return;
      if (this.retryAttempts >= RETRY_LIMIT) {
        if (missingAnchor) this.warnMissingAnchor(missingAnchor);
        return;
      }
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.retryAttempts++;
        this.rebindWrapper();
        this.ensureAll();
      }, RETRY_INTERVAL_MS);
    }
    /**
     * "The control bar is not there" is NOT evidence that our selector rotted.
     *
     * Kick mounts the control bar lazily after pointer interaction. 2026-10-16.
     * The pointer must move over the player first. With no pointer interaction the
     * wrapper holds NO bar and none of our four controls; after hovering, the bar carries 13
     * buttons and all four mount correctly. The retry budget is 20 x 250 ms ~= 5 s, so a viewer
     * who has not touched the player yet exhausts it on every single page load — and the manager
     * then recovers on its own through the observer.
     *
     * A warning that fires on a healthy session for a feature that is about to work is worse than
     * no warning at all: it teaches the reader to ignore the channel this whole mechanism exists to
     * keep credible. So warn only for the case that really is anchor rot — a bar-shaped element IS
     * in the player wrapper and `findControlBar()` still could not match it.
     */
    controlBarLooksRotted() {
      const wrapper = findPlayerWrapper();
      if (!wrapper || findControlBar()) return false;
      return Array.from(wrapper.querySelectorAll("div")).some((element) => element.querySelector("button"));
    }
    warnMissingAnchor(anchor) {
      if (anchor === "control-bar" && !this.controlBarLooksRotted()) return;
      if (this.warnedMissingAnchors.has(anchor)) return;
      this.warnedMissingAnchors.add(anchor);
      const check = anchor === "control-bar" ? "SELECTORS.controlBarBottom / SELECTORS.controlBar in src/content/shared/selectors.ts" : "LIVE_EDGE_LABELS / GO_TO_LIVE_PHRASES / findControlBarInsertionAnchor in src/content/shared/selectors.ts";
      logger.debug(
        `native-bar: waiting for native controls after ${RETRY_LIMIT} attempts \u2014 ${check}.`
      );
    }
    clearRetry() {
      if (this.retryTimer !== null) {
        window.clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.retryAttempts = 0;
    }
    /** Restores every registered group after the native insertion anchor in registry order, within the width
     * the bar actually has. Cached elements are moved back into the new bar, preserving listeners
     * and dynamic button state.
     *
     * The budget runs in the SAME synchronous task as the mounting, so a control that turns out
     * not to fit is taken back out before the browser paints — Kick's own controls are never seen
     * displaced, not even for one frame. */
    ensureAll() {
      if (this.disposed || this.controls.size === 0 && this.rootControls.size === 0) return;
      this.rebindWrapper();
      this.ensureRootControls();
      if (this.controls.size === 0) return;
      const insertionAnchor = findControlBarInsertionAnchor();
      const parent = insertionAnchor?.parentElement;
      if (!insertionAnchor || !parent) {
        this.scheduleRetry(findControlBar() ? "insertion-anchor" : "control-bar");
        return;
      }
      this.observeBar();
      let plan = this.computePlan();
      for (let pass = 0; pass < BUDGET_PASS_LIMIT; pass++) {
        if (!this.applyPlan(plan, insertionAnchor, parent)) {
          this.scheduleRetry();
          return;
        }
        const remeasured = this.computePlan();
        if (samePlan(plan, remeasured)) break;
        plan = remeasured;
      }
      this.clearRetry();
    }
    orderedControlIds() {
      return Array.from(this.controls.values()).sort((left, right) => controlPriority(left.id) - controlPriority(right.id)).map((control) => control.id);
    }
    /** Measures the bar and decides who is in it. An unmeasurable bar yields the pre-budget
     * behaviour — everything mounts — because "we could not measure" is not evidence that a
     * control does not fit, and hiding one on no evidence is the failure this file exists to
     * prevent. */
    computePlan() {
      const ids = this.orderedControlIds();
      const bar = findControlBar();
      if (!bar) return { mounted: ids, collapsed: [], overflow: false };
      const inBar = [];
      for (const control of this.controls.values()) {
        if (control.element?.isConnected) inBar.push(control.element);
      }
      if (this.overflow?.element.isConnected) inBar.push(this.overflow.element);
      const measurement = measureBarBudget(bar, inBar);
      if (!measurement) {
        logger.debug("native-bar: control bar has no measurable width, skipping the width budget");
        return { mounted: ids, collapsed: [], overflow: false };
      }
      for (const [id, cost] of measurement.costs) this.costs.set(id, cost);
      return planBarBudget({
        free: measurement.free,
        overflowCost: this.costs.get(OVERFLOW_CONTROL_ID) ?? 0,
        controls: ids.map((id) => ({ id, cost: this.costs.get(id) ?? 0 })),
        collapseOrder: COLLAPSE_PRIORITY
      });
    }
    /** False means another manager owns one of our ids and the caller must retry. */
    applyPlan(plan, insertionAnchor, parent) {
      for (const id of plan.collapsed) {
        const element = this.controls.get(id)?.element;
        if (element && element.parentElement === parent) element.remove();
      }
      let anchor = insertionAnchor;
      let overflowPlaced = false;
      const placeOverflow = () => {
        overflowPlaced = true;
        const element = this.ensureOverflowControl().element;
        if (element.parentElement !== parent || anchor.nextElementSibling !== element) {
          anchor.after(element);
        }
        anchor = element;
      };
      for (const id of plan.mounted) {
        const control = this.controls.get(id);
        if (!control) continue;
        if (plan.overflow && !overflowPlaced && id === CHIP_CONTROL_ID) placeOverflow();
        const existing = document.getElementById(control.id);
        if (existing instanceof HTMLElement && existing !== control.element) {
          if (controlOwners.get(existing) && controlOwners.get(existing) !== this) return false;
          existing.remove();
        }
        let element = control.element;
        if (!element) {
          element = control.build();
          element.id = control.id;
          control.element = element;
          controlOwners.set(element, this);
          if (control.id === CHIP_CONTROL_ID) this.barResizeObserver?.observe(element);
        }
        if (element.parentElement !== parent || anchor.nextElementSibling !== element) {
          anchor.after(element);
        }
        anchor = element;
      }
      if (plan.overflow) {
        if (!overflowPlaced) placeOverflow();
      } else if (this.overflow) {
        this.overflow.detach();
      }
      if (plan.collapsed.join() !== this.plan.collapsed.join()) this.overflow?.close();
      this.plan = plan;
      this.plateParent = parent;
      syncPlateRunEnds(parent);
      return true;
    }
    ensureOverflowControl() {
      if (!this.overflow) {
        const overflow = createOverflowControl(this.lifecycle, () => this.collapsedElements());
        overflow.element.id = OVERFLOW_CONTROL_ID;
        controlOwners.set(overflow.element, this);
        this.overflow = overflow;
      }
      return this.overflow;
    }
    collapsedElements() {
      return this.plan.collapsed.map((id) => this.controls.get(id)?.element).filter((element) => element instanceof HTMLElement);
    }
    observeBar() {
      const bar = findControlBar();
      if (!this.barResizeObserver || bar === this.observedBar) return;
      if (this.observedBar) this.barResizeObserver.unobserve(this.observedBar);
      this.observedBar = bar;
      if (bar) this.barResizeObserver.observe(bar);
    }
    /** Bar-level children are order-independent (each is absolutely positioned against the bar),
     * so they only ever need to BE in the bar — never to sit at a particular index. */
    ensureRootControls() {
      if (this.rootControls.size === 0) return;
      const bar = findControlBar();
      if (!bar) {
        this.scheduleRetry("control-bar");
        return;
      }
      for (const control of this.rootControls.values()) {
        const existing = document.getElementById(control.id);
        if (existing instanceof HTMLElement && existing !== control.element) {
          if (controlOwners.get(existing) && controlOwners.get(existing) !== this) {
            this.scheduleRetry();
            return;
          }
          existing.remove();
        }
        let element = control.element;
        if (!element) {
          element = control.build();
          element.id = control.id;
          control.element = element;
          controlOwners.set(element, this);
        }
        if (element.parentElement !== bar) bar.append(element);
      }
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.wrapperObserver.disconnect();
      this.wrapperRebindObserver.disconnect();
      this.theatreAttributeObserver.disconnect();
      this.barResizeObserver?.disconnect();
      this.observedBar = null;
      this.plateParent = null;
      this.overflow?.detach();
      this.overflow = null;
      this.plan = EMPTY_PLAN;
      this.costs.clear();
      if (this.trailingEnsureTimer !== null) window.clearTimeout(this.trailingEnsureTimer);
      this.clearRetry();
      for (const control of [...this.controls.values(), ...this.rootControls.values()]) {
        control.element?.remove();
        if (control.element) controlOwners.delete(control.element);
        const existing = document.getElementById(control.id);
        if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
        control.element = null;
      }
      this.controls.clear();
      this.rootControls.clear();
      managers.delete(this.lifecycle);
    }
  };
  function mountIntoControlBar(lifecycle, id, build) {
    if (lifecycle.isDisposed) return null;
    const mounted = managerFor(lifecycle).mount(lifecycle, id, build);
    if (!mounted) {
      logger.debug("native-bar:", id, "is not in the bar - anchor not ready, or collapsed by the width budget");
    }
    return mounted;
  }
  function mountIntoControlBarRoot(lifecycle, id, build) {
    if (lifecycle.isDisposed) return null;
    const mounted = managerFor(lifecycle).mountRoot(lifecycle, id, build);
    if (!mounted) {
      logger.debug("native-bar: control bar not present yet for", id, "- retrying");
    }
    return mounted;
  }
  function managerFor(lifecycle) {
    const managerLifecycle = managerAliases.get(lifecycle) ?? lifecycle;
    let manager = managers.get(managerLifecycle);
    if (!manager) {
      manager = new NativeBarMountManager(managerLifecycle);
      managers.set(managerLifecycle, manager);
    }
    return manager;
  }
  function shareNativeBarMountManager(lifecycle, managerLifecycle) {
    if (lifecycle.isDisposed || managerLifecycle.isDisposed) return;
    managerAliases.set(lifecycle, managerLifecycle);
    lifecycle.add(() => managerAliases.delete(lifecycle));
  }

  // src/content/player/quality-lock.ts
  var CONTROLS_ID = "kickflow-quality-controls";
  var VIEWER_INPUT_WINDOW_MS = 1e3;
  var APPLY_DELAY_MS = 1800;
  var READY_DELAY_MS = 100;
  var MENU_RENDER_MS = 260;
  var MAX_MENU_RENDER_WAITS = 4;
  var RETRY_DELAY_MS = 1300;
  var MAX_ATTEMPTS = 5;
  var MAX_CONTROL_REARMS = 2;
  var RENDITION_RECHECK_MS = 3e4;
  var RENDITION_RECHECK_MAX_MS = 10 * 6e4;
  var RESIZE_RECHECK_DELAY_MS = 2e3;
  var NATIVE_PICK_SETTLE_MS = 1500;
  var MAX_UNKNOWN_PROBES_PER_ATTEMPT = 2;
  var KNOWN_GEAR_PATH_PREFIXES = ["M17.5 8.33", "M16.759", "M25.7"];
  var GEAR_PATH_PREFIX = KNOWN_GEAR_PATH_PREFIXES[0];
  var sleep2 = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  var firstPathD = (button) => button.querySelector("svg path")?.getAttribute("d") || "";
  function fire(el, type, Ctor) {
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", pointerId: 1, button: 0 }));
  }
  function press(el) {
    fire(el, "pointerdown", PointerEvent);
    fire(el, "mousedown", MouseEvent);
    fire(el, "pointerup", PointerEvent);
    fire(el, "mouseup", MouseEvent);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  }
  function revealControlBar() {
    if (findControlBar()) return;
    const wrapper = findPlayerWrapper();
    if (!wrapper) return;
    for (const type of ["pointermove", "mousemove", "mouseover"]) {
      wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
    }
  }
  function isIdentified(button) {
    return button.hasAttribute("data-testid") || (button.getAttribute("aria-label") || "").trim() !== "" || (button.textContent || "").trim() !== "";
  }
  function findQualityGearCandidates() {
    const bar = findControlBar();
    if (!bar) return [];
    const buttons = Array.from(bar.querySelectorAll("button")).filter((b) => !b.closest('[id^="kickflow-"]') && !b.matches(':disabled, [aria-disabled="true"], [data-disabled]'));
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (button, via) => {
      if (seen.has(button)) return;
      seen.add(button);
      candidates.push({ button, via });
    };
    for (const button of buttons) {
      if (button.getAttribute("aria-haspopup") === "menu") add(button, "menu-role");
    }
    let lastIdentified = -1;
    buttons.forEach((button, index) => {
      if (isIdentified(button)) lastIdentified = index;
    });
    for (let i = buttons.length - 1; i > lastIdentified; i--) {
      if (buttons[i].querySelector("svg")) add(buttons[i], "trailing-icon");
    }
    for (const button of buttons) {
      if (KNOWN_GEAR_PATH_PREFIXES.some((prefix) => firstPathD(button).startsWith(prefix))) {
        add(button, "known-path");
      }
    }
    return candidates;
  }
  function visibleNativeRow(row) {
    return !row.closest('[id^="kickflow-"], [hidden], [aria-hidden="true"], [data-state="closed"]');
  }
  function associatedMenuRows(button) {
    const controlled = (button.getAttribute("aria-controls") || "").split(/\s+/);
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find(
      (node) => visibleNativeRow(node) && (node.id !== "" && controlled.includes(node.id) || button.id !== "" && (node.getAttribute("aria-labelledby") || "").split(/\s+/).includes(button.id))
    );
    return menu ? Array.from(menu.querySelectorAll('[role="menuitemradio"]')).filter(visibleNativeRow) : [];
  }
  function menuRowsOpenedBy(button, before) {
    const associated = associatedMenuRows(button);
    if (associated.length) return associated;
    const fresh = Array.from(document.querySelectorAll('[role="menuitemradio"]')).filter((row) => !before.has(row) && visibleNativeRow(row));
    const container = fresh[0]?.closest('[role="menu"]');
    return container ? Array.from(container.querySelectorAll('[role="menuitemradio"]')).filter(visibleNativeRow) : fresh;
  }
  function closeMenu(openedRows) {
    if (!openedRows.some((row) => row.isConnected && visibleNativeRow(row))) return;
    (openedRows[0].closest('[role="menu"]') ?? openedRows[0]).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: false }));
  }
  function nativeSavedQuality() {
    try {
      return sessionStorage.getItem("stream_quality");
    } catch {
      return null;
    }
  }
  var nextProbe = 0;
  function concealInspection(button, before) {
    const id = String(++nextProbe);
    const existingMenus = new Set(Array.from(document.querySelectorAll('[role="menu"]')).filter(visibleNativeRow));
    const marked = /* @__PURE__ */ new Set();
    const style = document.createElement("style");
    style.textContent = `[data-kickflow-quality-probe="${id}"] { visibility: hidden !important; pointer-events: none !important; animation: none !important; transition: none !important; }`;
    (document.head ?? document.documentElement).append(style);
    const conceal = () => {
      for (const row of menuRowsOpenedBy(button, before)) {
        const menu = row.closest('[role="menu"]') ?? row;
        if (existingMenus.has(menu) || marked.has(menu)) continue;
        menu.setAttribute("data-kickflow-quality-probe", id);
        marked.add(menu);
      }
    };
    const observer = new MutationObserver((records) => {
      if (onlyChatMutations(records)) return;
      conceal();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const menu of marked) menu.removeAttribute("data-kickflow-quality-probe");
      style.remove();
    };
  }
  var warnedDocuments = /* @__PURE__ */ new WeakSet();
  var rowText = (row) => (row.textContent || "").trim();
  var rowDisabled = (row) => row.matches(':disabled, [aria-disabled="true"], [data-disabled]');
  async function applyQualityOnce(mode, isDisposed, acknowledge, observe) {
    if (isDisposed()) return "skip";
    revealControlBar();
    await sleep2(60);
    if (isDisposed()) return "skip";
    const candidates = findQualityGearCandidates();
    if (candidates.length === 0) return "skip";
    let unknownProbes = 0;
    for (const { button, via } of candidates) {
      if (via === "trailing-icon") {
        if (unknownProbes >= MAX_UNKNOWN_PROBES_PER_ATTEMPT) continue;
        unknownProbes += 1;
      }
      const before = new Set(document.querySelectorAll('[role="menuitemradio"]'));
      let rows = associatedMenuRows(button);
      if (rows.length || button.getAttribute("aria-expanded") === "true") return "defer";
      const restoreInspection = concealInspection(button, before);
      button.setAttribute(QUALITY_PROBE_TRIGGER_ATTRIBUTE, "");
      try {
        press(button);
        for (let wait = 0; wait < MAX_MENU_RENDER_WAITS; wait++) {
          await sleep2(MENU_RENDER_MS);
          rows = menuRowsOpenedBy(button, before);
          if (rows.length || isDisposed()) break;
        }
        if (isDisposed()) return "skip";
        const enabled = rows.filter((row) => !rowDisabled(row));
        const labels = enabled.map(rowText);
        if (!labels.some((label) => qualityScore(label) >= 0)) continue;
        logger.debug("quality-lock: native quality menu found via", via);
        const renditions = qualityRenditions(labels);
        const checkedRow = rows.find((row) => row.getAttribute("aria-checked") === "true");
        const pick = pickQuality(mode, labels);
        const target = pick === -1 ? enabled.find((row) => isAutoQualityLabel(rowText(row))) : pick === null ? void 0 : enabled[pick];
        if (!target) {
          observe({ renditions, checked: checkedRow ? rowText(checkedRow) : null });
          return "already";
        }
        const height = qualityModeLabel(rowText(target))?.match(/^(\d+)p/)?.[1];
        if (target.getAttribute("aria-checked") === "true") {
          observe({ renditions, checked: rowText(target) });
          if (height && nativeSavedQuality() === height) acknowledge({ saved: height });
          return "already";
        }
        const savedBefore = nativeSavedQuality();
        press(target);
        await sleep2(60);
        observe({ renditions, checked: rowText(target) });
        const savedAfter = nativeSavedQuality();
        if (height && savedAfter === height && savedAfter !== savedBefore) acknowledge({ saved: savedAfter });
        return "set";
      } finally {
        closeMenu(rows);
        await sleep2(MENU_RENDER_MS);
        restoreInspection();
        button.removeAttribute(QUALITY_PROBE_TRIGGER_ATTRIBUTE);
      }
    }
    return "skip";
  }
  async function applyWithRetries(mode, isDisposed, reportFailure, confirmed, observe) {
    const progress = { acknowledgement: null };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (isDisposed()) return "failed";
      const result = await applyQualityOnce(mode, isDisposed, (ack) => {
        progress.acknowledgement = ack;
      }, observe).catch(() => "skip");
      if (isDisposed()) return "failed";
      if (result === "defer") return "defer";
      if (result === "already") {
        if (progress.acknowledgement) confirmed(progress.acknowledgement);
        logger.debug("quality-lock:", result, `(attempt ${attempt})`);
        return "verified";
      }
      await sleep2(RETRY_DELAY_MS);
      if (isDisposed()) return "failed";
      if (progress.acknowledgement && nativeSavedQuality() === progress.acknowledgement.saved) {
        confirmed(progress.acknowledgement);
        return "verified";
      }
      progress.acknowledgement = null;
    }
    if (isDisposed()) return "failed";
    const renderedNativeControls = findControlBar() || Array.from(findPlayerWrapper()?.querySelectorAll("button") ?? []).some((button) => !button.closest('[id^="kickflow-"]') && (button.hasAttribute("data-testid") && button.getAttribute("data-testid").startsWith("video-player-") || button.querySelector('svg[data-ds-icon="Play"], svg[data-ds-icon="Pause"]')));
    if (!renderedNativeControls) {
      logger.debug("quality-lock: retries ended before the native control bar rendered");
      return "failed";
    }
    logger.debug("quality-lock: native menu confirmation exhausted", { candidates: findQualityGearCandidates().length });
    const what = mode === "best" ? "highest quality" : `quality "${mode}"`;
    reportFailure(`quality-lock: ${what} could not be confirmed; keeping the current selection.`);
    return "failed";
  }
  var modeListeners = /* @__PURE__ */ new Set();
  function notifyQualityModeChanged() {
    for (const listener of modeListeners) listener();
  }
  function requestQualityMode(mode) {
    window.dispatchEvent(new CustomEvent("kickflow:setFlag", { detail: { key: "qualityMode", value: mode } }));
  }
  function qualityModeFromNativeRow(row) {
    if (row.closest('[id^="kickflow-"], .kickflow-player-menu, [data-kickflow-quality-probe]')) return null;
    const menu = row.closest('[role="menu"]');
    if (!menu) return null;
    const labels = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map(rowText);
    if (!labels.some((label) => qualityScore(label) >= 0)) return null;
    const text = rowText(row);
    if (isAutoQualityLabel(text)) return "auto";
    if (qualityScore(text) === Number.MAX_SAFE_INTEGER) return "best";
    return normalizeQualityMode(qualityModeLabel(text));
  }
  function qualityWords() {
    return {
      title: t("player.quality"),
      chip: t("player.quality"),
      subBest: t("player.quality_sub_best"),
      subAuto: t("player.auto"),
      subSaver: t("player.quality_sub_saver"),
      best: t("player.quality_best"),
      bestHint: (current) => current ? t("player.quality_best_hint_now", { label: current }) : t("player.quality_best_hint"),
      auto: t("player.quality_auto"),
      autoHint: t("player.quality_auto_hint"),
      saver: t("player.quality_saver"),
      saverHint: t("player.quality_saver_hint"),
      more: t("player.quality_more")
    };
  }
  var storedMode = () => normalizeQualityMode(featureFlags.qualityMode) ?? "best";
  function streamPickFor(mode, renditions) {
    return mode === "best" || renditions.length > 0 && mode === renditions[0] ? null : mode;
  }
  function initQualityLock(lifecycle, isTrusted = (event) => event.isTrusted) {
    let running = false;
    let pending = false;
    let timer;
    let recheckTimer;
    let generation = 0;
    let interactionVersion = 0;
    let currentVideo = null;
    let controlsObserver = null;
    let lastGear;
    let controlRearms = 0;
    let acknowledgement = null;
    const readinessSeen = /* @__PURE__ */ new Set();
    let renditions = [];
    let checkedText = null;
    let chip = null;
    let streamPick = null;
    const currentMode = () => featureFlags.qualityAlwaysBest ? streamPick ?? "best" : storedMode();
    let nativePickUntil = 0;
    const choose = (next, from) => {
      if (from === "native") nativePickUntil = Date.now() + NATIVE_PICK_SETTLE_MS;
      if (!featureFlags.qualityAlwaysBest) {
        if (next !== currentMode()) requestQualityMode(next);
        else if (from === "chip") applyModeChange();
        return;
      }
      const pick = streamPickFor(next, renditions);
      if (pick === streamPick && from === "native") return;
      streamPick = pick;
      applyModeChange();
    };
    const reportFailure = (message2) => {
      if (warnedDocuments.has(document)) return;
      warnedDocuments.add(document);
      logger.debug(message2);
    };
    let recheckDelay = RENDITION_RECHECK_MS;
    let observedSignature = null;
    let observationChanged = false;
    let comparedObservation = false;
    let lastResizeRecheck = Number.NEGATIVE_INFINITY;
    const resetRecheckBackoff = () => {
      recheckDelay = RENDITION_RECHECK_MS;
      observedSignature = null;
      observationChanged = false;
      comparedObservation = false;
    };
    const scheduleRenditionRecheck = (delayMs = recheckDelay) => {
      window.clearTimeout(recheckTimer);
      recheckTimer = window.setTimeout(() => {
        recheckTimer = void 0;
        if (lifecycle.isDisposed || !currentVideo) return;
        const active = document.activeElement;
        if (document.visibilityState === "hidden" || active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
          scheduleRenditionRecheck(delayMs);
          return;
        }
        acknowledgement = null;
        request2();
      }, delayMs);
    };
    const scheduleNextRecheck = (result) => {
      if (result === "verified") {
        recheckDelay = observationChanged || !comparedObservation ? RENDITION_RECHECK_MS : Math.min(recheckDelay * 2, RENDITION_RECHECK_MAX_MS);
        observationChanged = false;
        comparedObservation = false;
      }
      scheduleRenditionRecheck(recheckDelay);
    };
    const noteObservation = (seen) => {
      const signature = `${seen.renditions.join("|")}#${seen.checked ?? ""}`;
      if (observedSignature !== null) {
        comparedObservation = true;
        if (observedSignature !== signature) observationChanged = true;
      }
      observedSignature = signature;
    };
    const recheckOnSizeChange = () => {
      if (lifecycle.isDisposed || running || currentMode() === "auto" || !checkedText) return;
      const held = qualityModeLabel(checkedText)?.match(/^(\d+)p/)?.[1];
      const height = getVideoElement()?.videoHeight;
      if (!held || !height || String(height) === held) return;
      const now = Date.now();
      if (now - lastResizeRecheck < RENDITION_RECHECK_MS) return;
      lastResizeRecheck = now;
      recheckDelay = RENDITION_RECHECK_MS;
      scheduleRenditionRecheck(RESIZE_RECHECK_DELAY_MS);
    };
    const drain = () => {
      timer = void 0;
      if (lifecycle.isDisposed || running || !pending || !currentVideo) return;
      pending = false;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (acknowledgement && nativeSavedQuality() === acknowledgement.saved) return;
      running = true;
      const startedGeneration = generation;
      const startedVideo = currentVideo;
      const startedInteraction = interactionVersion;
      void applyWithRetries(
        currentMode(),
        () => lifecycle.isDisposed || generation !== startedGeneration || interactionVersion !== startedInteraction || getVideoElement() !== startedVideo,
        reportFailure,
        (ack) => {
          acknowledgement = ack;
        },
        (seen) => {
          if (lifecycle.isDisposed || generation !== startedGeneration) return;
          renditions = seen.renditions;
          checkedText = seen.checked;
          if (streamPick !== null && renditions.length > 0 && streamPick === renditions[0]) streamPick = null;
          noteObservation(seen);
          paintChip();
        }
      ).then((result) => {
        if (result !== "failed" && !lifecycle.isDisposed && generation === startedGeneration) scheduleNextRecheck(result);
      }).finally(() => {
        running = false;
        if (pending && !lifecycle.isDisposed && timer === void 0) request2();
      });
    };
    const request2 = (ready = false) => {
      if (lifecycle.isDisposed || !currentVideo) return;
      pending = true;
      if (ready && timer !== void 0) {
        window.clearTimeout(timer);
        timer = void 0;
      }
      if (timer === void 0 && !running) timer = window.setTimeout(drain, ready || currentVideo.readyState >= 1 ? READY_DELAY_MS : APPLY_DELAY_MS);
    };
    const resetSource = () => {
      generation += 1;
      window.clearTimeout(recheckTimer);
      recheckTimer = void 0;
      acknowledgement = null;
      readinessSeen.clear();
      controlRearms = 0;
      checkedText = null;
      resetRecheckBackoff();
      paintChip();
      request2();
    };
    const currentLabel = () => {
      const held = checkedText ? qualityModeLabel(checkedText) : null;
      if (held && currentMode() !== "auto") return held;
      const height = getVideoElement()?.videoHeight;
      return height ? `${height}p` : null;
    };
    function paintChip() {
      if (!chip) return;
      const words2 = qualityWords();
      if (featureFlags.qualityAlwaysBest && streamPick) words2.subExact = t("player.quality_sub_stream");
      paintQualityChip(chip, currentMode(), currentLabel(), words2);
    }
    const qualityMenu = new PlayerMenu2({
      className: "kickflow-quality-menu",
      fill: (root) => fillQualityMenu(root, {
        mode: currentMode(),
        current: currentLabel(),
        renditions,
        words: qualityWords(),
        onPick: (mode) => {
          qualityMenu.close();
          choose(mode, "chip");
        }
      }),
      initialFocus: (root) => root.querySelector('[aria-checked="true"]')
    });
    if (featureFlags.qualityLock) mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
      const group = document.createElement("span");
      group.className = "kickflow-player-group";
      const button = createQualityButton();
      button.addEventListener("click", () => qualityMenu.toggle(button));
      group.append(button);
      chip = button;
      paintChip();
      return group;
    });
    lifecycle.add(() => qualityMenu.close());
    lifecycle.add(subscribeLang(() => {
      paintChip();
      qualityMenu.close();
    }));
    bindVideoElementListener(lifecycle, "resize", () => {
      paintChip();
      recheckOnSizeChange();
    });
    function applyModeChange() {
      acknowledgement = null;
      resetRecheckBackoff();
      if (running) interactionVersion += 1;
      paintChip();
      if (Date.now() < nativePickUntil) scheduleRenditionRecheck(Math.max(0, nativePickUntil - Date.now()));
      else request2(true);
    }
    const onModeChange = () => {
      if (!featureFlags.qualityAlwaysBest) streamPick = null;
      applyModeChange();
    };
    modeListeners.add(onModeChange);
    lifecycle.add(() => modeListeners.delete(onModeChange));
    let lastViewerInput = 0;
    const noteViewerInput = (event) => {
      if (isTrusted(event)) lastViewerInput = Date.now();
    };
    const adoptViewerPick = (event) => {
      if (!isTrusted(event) && Date.now() - lastViewerInput > VIEWER_INPUT_WINDOW_MS) return;
      const row = event.target instanceof Element ? event.target.closest('[role="menuitemradio"]') : null;
      const mode = row ? qualityModeFromNativeRow(row) : null;
      if (!row || !mode) return;
      if (renditions.length === 0) {
        const labels = Array.from(row.closest('[role="menu"]')?.querySelectorAll('[role="menuitemradio"]') ?? []).filter((item) => !rowDisabled(item)).map(rowText);
        renditions = qualityRenditions(labels);
      }
      if (mode === "auto" || qualityModeLabel(rowText(row))) checkedText = rowText(row);
      if (mode !== currentMode()) choose(mode, "native");
      else paintChip();
    };
    document.addEventListener("pointerup", noteViewerInput, true);
    document.addEventListener("keydown", noteViewerInput, true);
    document.addEventListener("click", adoptViewerPick, true);
    lifecycle.add(() => {
      document.removeEventListener("pointerup", noteViewerInput, true);
      document.removeEventListener("keydown", noteViewerInput, true);
      document.removeEventListener("click", adoptViewerPick, true);
    });
    observeVideoElement(lifecycle, (video) => {
      controlsObserver?.disconnect();
      currentVideo = video;
      resetSource();
      lastGear = findQualityGearCandidates()[0]?.button;
      if (!video?.parentElement) return;
      controlsObserver = new MutationObserver(() => {
        const gear = findQualityGearCandidates()[0]?.button;
        if (gear && gear !== lastGear && controlRearms < MAX_CONTROL_REARMS) {
          controlRearms += 1;
          acknowledgement = null;
          request2();
        }
        lastGear = gear;
      });
      controlsObserver.observe(video.parentElement, { childList: true, subtree: true });
    });
    bindVideoElementListener(lifecycle, "loadstart", resetSource);
    for (const type of ["loadedmetadata", "canplay", "playing"]) {
      bindVideoElementListener(lifecycle, type, () => {
        if (readinessSeen.has(type)) return;
        readinessSeen.add(type);
        request2(true);
      });
    }
    const resumeAfterEditing = (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) request2();
    };
    document.addEventListener("focusout", resumeAfterEditing);
    const interruptInspection = (event) => {
      if (!event.isTrusted || !running) return;
      interactionVersion += 1;
      pending = true;
    };
    document.addEventListener("pointerdown", interruptInspection, true);
    document.addEventListener("keydown", interruptInspection, true);
    lifecycle.add(() => {
      document.removeEventListener("focusout", resumeAfterEditing);
      document.removeEventListener("pointerdown", interruptInspection, true);
      document.removeEventListener("keydown", interruptInspection, true);
      window.clearTimeout(timer);
      window.clearTimeout(recheckTimer);
      controlsObserver?.disconnect();
      pending = false;
    });
  }

  // src/content/player/rewind-controls.ts
  var CONTROLS_ID2 = "kickflow-rewind-controls";
  var MAX_CROSS_RANGE_GAP_SECONDS = 30;
  var MAX_REASONABLE_MEDIA_SECONDS = 24 * 60 * 60;
  function saneBoundary(value) {
    return Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_MEDIA_SECONDS ? value : null;
  }
  var goLiveRewindWindows = /* @__PURE__ */ new WeakMap();
  var watchedRewindVideos = /* @__PURE__ */ new WeakSet();
  function rememberGoLiveRewindWindow(video) {
    const ranges = saneRanges(video.buffered);
    if (!ranges.some((range) => video.currentTime >= range.start && video.currentTime <= range.end)) return;
    goLiveRewindWindows.set(video, { source: video.currentSrc, ranges });
    if (watchedRewindVideos.has(video)) return;
    watchedRewindVideos.add(video);
    const clear = () => {
      goLiveRewindWindows.delete(video);
    };
    video.addEventListener("emptied", clear);
    video.addEventListener("loadstart", clear);
  }
  function saneRanges(ranges) {
    const result = [];
    for (let index = 0; index < ranges.length; index++) {
      const start = saneBoundary(ranges.start(index));
      const end = saneBoundary(ranges.end(index));
      if (start === null || end === null || end < start) continue;
      result.push({ start, end });
    }
    return result;
  }
  function firstFiniteStartWithFiniteEnd(ranges) {
    for (let index = 0; index < ranges.length; index++) {
      const start = saneBoundary(ranges.start(index));
      const end = saneBoundary(ranges.end(index));
      if (start !== null && end !== null) return start;
    }
    return null;
  }
  function liveEdge(video) {
    const ranges = saneRanges(video.buffered);
    return ranges.length > 0 ? ranges[ranges.length - 1].end : null;
  }
  function seekFloor(video) {
    const bufferedStart = saneRanges(video.buffered)[0]?.start;
    if (bufferedStart !== void 0) return bufferedStart;
    const invertedBufferedStart = firstFiniteStartWithFiniteEnd(video.buffered);
    if (invertedBufferedStart !== null) return invertedBufferedStart;
    const seekableStart = saneRanges(video.seekable)[0]?.start;
    if (seekableStart !== void 0) return seekableStart;
    return 0;
  }
  function clampSeekTarget(video, delta) {
    const result = computeSeekTarget(video, delta);
    if (delta < 0 && result > video.currentTime) return video.currentTime;
    if (delta > 0 && result < video.currentTime) return video.currentTime;
    if (Math.abs(result - video.currentTime) > Math.abs(delta) + MAX_CROSS_RANGE_GAP_SECONDS) {
      logger.debug("rewind-controls: suppressed transient catapult seek", {
        currentTime: video.currentTime,
        wouldSeekTo: result,
        delta
      });
      return video.currentTime;
    }
    return result;
  }
  function computeSeekTarget(video, delta) {
    const target = video.currentTime + delta;
    const seekableRanges = saneRanges(video.seekable);
    const dvr = seekableRanges.find(
      (range) => video.currentTime >= range.start && video.currentTime <= range.end
    );
    if (dvr) {
      return Math.min(Math.max(target, dvr.start), dvr.end);
    }
    const beforeLive = goLiveRewindWindows.get(video);
    if (delta < 0 && beforeLive && beforeLive.source === video.currentSrc && beforeLive.ranges.some((range) => target >= range.start && target <= range.end)) {
      return target;
    }
    const bufferedRanges = saneRanges(video.buffered);
    if (bufferedRanges.length > 0) {
      for (const range of bufferedRanges) {
        if (target >= range.start && target <= range.end) return target;
      }
      const first = bufferedRanges[0];
      const last = bufferedRanges[bufferedRanges.length - 1];
      if (target < first.start) return first.start;
      if (target > last.end) return last.end;
      const currentRange = bufferedRanges.find(
        (range) => video.currentTime >= range.start && video.currentTime <= range.end
      );
      for (let index = 1; index < bufferedRanges.length; index++) {
        const previous = bufferedRanges[index - 1];
        const next = bufferedRanges[index];
        if (target <= previous.end || target >= next.start) continue;
        if (next.start - previous.end > MAX_CROSS_RANGE_GAP_SECONDS) {
          if (delta < 0 && currentRange === next) return next.start;
          if (delta > 0 && currentRange === previous) return previous.end;
        }
        if (delta < 0) return previous.end;
        if (delta > 0) return next.start;
        return target - previous.end <= next.start - target ? previous.end : next.start;
      }
    }
    const floor = seekFloor(video);
    const edge = liveEdge(video) ?? target;
    const ceil = Math.max(floor, edge);
    return Math.min(Math.max(target, floor), ceil);
  }
  function seekBy(video, delta) {
    try {
      const target = clampSeekTarget(video, delta);
      video.currentTime = target;
      logger.debug("rewind-controls: seek", delta, "-> currentTime", target);
    } catch (error) {
      logger.warn("rewind-controls: seek failed", error);
    }
  }
  var forwardAtLiveEdge = false;
  var forwardButtonRef = null;
  function applyForwardDim() {
    const button = forwardButtonRef;
    if (!button) return;
    button.classList.toggle("kickflow-player-btn--dim", forwardAtLiveEdge);
    if (forwardAtLiveEdge) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }
  function setForwardAtLiveEdge(atEdge) {
    if (forwardAtLiveEdge === atEdge) return;
    forwardAtLiveEdge = atEdge;
    applyForwardDim();
  }
  var RIPPLE_CLASS = "kickflow-seek-ripple";
  var RIPPLE_MS = 520;
  var rippleTimer = null;
  function showSeekRipple(delta) {
    try {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
    }
    const host = document.fullscreenElement ?? findPlayerWrapper();
    if (!host) return;
    host.querySelector(`.${RIPPLE_CLASS}`)?.remove();
    if (rippleTimer !== null) window.clearTimeout(rippleTimer);
    const ripple = document.createElement("div");
    ripple.className = `${RIPPLE_CLASS} ${RIPPLE_CLASS}--${delta < 0 ? "back" : "forward"}`;
    ripple.setAttribute("aria-hidden", "true");
    ripple.append(createStepIcon(delta < 0 ? "back" : "forward"));
    const label = document.createElement("span");
    label.textContent = `${delta < 0 ? "\u2212" : "+"}${Math.abs(delta)} ${t("player.seconds_short")}`;
    ripple.append(label);
    host.append(ripple);
    rippleTimer = window.setTimeout(() => {
      rippleTimer = null;
      ripple.remove();
    }, RIPPLE_MS);
  }
  function initRewindControls(lifecycle) {
    const video = getVideoElement();
    if (!video) {
      logger.debug("rewind-controls: #video-player not found, skipping");
      return;
    }
    let rewindButton = null;
    let forwardButton = null;
    const updateHotkeyTitles = () => {
      const rewindHotkey = getHotkeyBinding("rewind");
      const forwardHotkey = getHotkeyBinding("forward");
      if (rewindButton) {
        rewindButton.title = `${t("player.seek_back_title", { n: STEP_SECONDS })}${rewindHotkey.enabled ? ` (${formatHotkeyKey(rewindHotkey.key)})` : ""}`;
        rewindButton.setAttribute("aria-label", t("player.seek_back_aria", { n: STEP_SECONDS }));
      }
      if (forwardButton) {
        forwardButton.title = `${t("player.seek_forward_title", { n: STEP_SECONDS })}${forwardHotkey.enabled ? ` (${formatHotkeyKey(forwardHotkey.key)})` : ""}`;
        forwardButton.setAttribute("aria-label", t("player.seek_forward_aria", { n: STEP_SECONDS }));
      }
    };
    lifecycle.add(subscribeHotkeyBindings(updateHotkeyTitles));
    lifecycle.add(subscribeLang(updateHotkeyTitles));
    mountIntoControlBar(lifecycle, CONTROLS_ID2, () => {
      const group = document.createElement("span");
      group.className = "kickflow-player-group";
      const rewind = document.createElement("button");
      rewind.type = "button";
      rewind.className = "kickflow-player-btn";
      rewind.append(createStepIcon("back"));
      const forward = document.createElement("button");
      forward.type = "button";
      forward.className = "kickflow-player-btn";
      forward.append(createStepIcon("forward"));
      rewindButton = rewind;
      forwardButton = forward;
      forwardButtonRef = forward;
      applyForwardDim();
      updateHotkeyTitles();
      rewind.addEventListener("click", () => {
        const current = getVideoElement();
        if (current) seekBy(current, -STEP_SECONDS);
        showSeekRipple(-STEP_SECONDS);
      });
      forward.addEventListener("click", () => {
        const current = getVideoElement();
        if (current) seekBy(current, STEP_SECONDS);
        if (!forwardAtLiveEdge) showSeekRipple(STEP_SECONDS);
      });
      group.append(rewind, forward);
      return group;
    });
  }

  // src/content/player/player-state.ts
  var PLAYER_STATE_CHANGED_EVENT = "kickflow:playerStateChanged";
  var CATCHUP_TOGGLED_EVENT = "kickflow:catchupToggled";
  var NORMAL_PLAYBACK_RATE2 = 1;
  var TOGGLE_STORAGE_KEY = "kickflow.catchupEnabled";
  var DEFAULT_STATE = {
    mode: "auto",
    manualRate: NORMAL_PLAYBACK_RATE2
  };
  var listeners3 = /* @__PURE__ */ new Set();
  var state = { ...DEFAULT_STATE };
  var revision = 0;
  var loadPromise = null;
  function cloneState(value) {
    return { ...value };
  }
  function normalizeRate(rate) {
    return Number.isFinite(rate) && rate > 0 ? rate : NORMAL_PLAYBACK_RATE2;
  }
  function persistCatchupEnabled(enabled) {
    void safeStorageSet({ [TOGGLE_STORAGE_KEY]: enabled });
  }
  function emitCatchupToggled(enabled) {
    window.dispatchEvent(new CustomEvent(CATCHUP_TOGGLED_EVENT, { detail: enabled }));
  }
  function setState(next, options = {}) {
    const normalized = {
      mode: next.mode,
      manualRate: normalizeRate(next.manualRate)
    };
    if (normalized.mode === state.mode && normalized.manualRate === state.manualRate) {
      return;
    }
    const previous = state;
    state = normalized;
    revision++;
    if (options.persistMode && previous.mode !== state.mode) {
      persistCatchupEnabled(state.mode === "auto");
    }
    if (options.emitToggle && previous.mode !== state.mode) {
      emitCatchupToggled(state.mode === "auto");
    }
    const snapshot = cloneState(state);
    const previousSnapshot = cloneState(previous);
    window.dispatchEvent(new CustomEvent(PLAYER_STATE_CHANGED_EVENT, { detail: snapshot }));
    for (const listener of listeners3) {
      try {
        listener(snapshot, previousSnapshot);
      } catch (error) {
        logger.error("player-state: listener threw", error);
      }
    }
  }
  function getPlayerState() {
    return cloneState(state);
  }
  function subscribePlayerState(listener) {
    listeners3.add(listener);
    return () => listeners3.delete(listener);
  }
  function ensurePlayerStateLoaded() {
    if (loadPromise) return loadPromise;
    const loadRevision = revision;
    loadPromise = safeStorageGet(TOGGLE_STORAGE_KEY).then((stored) => {
      if (revision !== loadRevision) return;
      const value = stored[TOGGLE_STORAGE_KEY];
      if (typeof value !== "boolean") return;
      setState(
        {
          mode: value ? "auto" : "manual",
          manualRate: NORMAL_PLAYBACK_RATE2
        },
        { emitToggle: false, persistMode: false }
      );
    });
    return loadPromise;
  }
  function setAutoMode() {
    setState(
      {
        mode: "auto",
        manualRate: state.manualRate
      },
      { emitToggle: true, persistMode: true }
    );
  }
  function setManualRate(rate) {
    setState(
      {
        mode: "manual",
        manualRate: normalizeRate(rate)
      },
      { emitToggle: true, persistMode: true }
    );
  }
  function setPlayerPlaybackRate(video, rate) {
    const safeRate = normalizeRate(rate);
    video.preservesPitch = true;
    video.webkitPreservesPitch = true;
    if (video.playbackRate !== safeRate) video.playbackRate = safeRate;
  }

  // src/content/player/live-catchup.ts
  var CONTROLS_ID3 = "kickflow-catchup-controls";
  var MAX_PLAUSIBLE_BEHIND_SECONDS = 12 * 60 * 60;
  var LIVE_DURATION_SENTINEL_SECONDS = 2 ** 30;
  var activeGoLive = null;
  function goLiveNow() {
    if (!activeGoLive) return false;
    activeGoLive();
    return true;
  }
  function isLiveStream(video) {
    return video.duration === Infinity || video.duration >= LIVE_DURATION_SENTINEL_SECONDS;
  }
  function saneLiveEdge(value) {
    if (!Number.isFinite(value) || value <= 0 || value >= LIVE_DURATION_SENTINEL_SECONDS) return null;
    return value;
  }
  function seekableLiveEdge(video) {
    const s = video.seekable;
    if (!s.length) return null;
    return saneLiveEdge(s.end(s.length - 1));
  }
  function durationLiveEdge(video) {
    return saneLiveEdge(video.duration);
  }
  function bufferedLiveEdge(video) {
    let furthest = null;
    for (let index = 0; index < video.buffered.length; index++) {
      const end = saneLiveEdge(video.buffered.end(index));
      if (end !== null && (furthest === null || end > furthest)) furthest = end;
    }
    return furthest;
  }
  var BUFFERED_EDGE_MARGIN_SECONDS = 0.5;
  function goLiveTarget(video) {
    const seekable = seekableLiveEdge(video);
    if (seekable !== null) return seekable;
    const buffered = bufferedLiveEdge(video);
    if (buffered === null) return null;
    const target = buffered - BUFFERED_EDGE_MARGIN_SECONDS;
    return target > 0 ? target : null;
  }
  function catchupLiveEdge(video) {
    const seekable = seekableLiveEdge(video);
    const duration = durationLiveEdge(video);
    if (seekable === null) return duration ?? bufferedLiveEdge(video);
    if (duration === null) return seekable;
    return Math.max(seekable, duration);
  }
  var BEHIND_ATTRIBUTE = "data-kickflow-behind";
  function initLiveCatchup(lifecycle) {
    lifecycle.add(() => document.documentElement.removeAttribute(BEHIND_ATTRIBUTE));
    const video = getVideoElement();
    if (!video) {
      logger.debug("live-catchup: #video-player not found, skipping");
      return;
    }
    let catchingUp = false;
    let stallHoldUntil = 0;
    let stallCount = 0;
    const trackSeekRecovery = createSeekRecoveryTracker();
    let liveButtonEl = null;
    let lastLiveLabel = "";
    let lastBehindSeconds = null;
    const updateHotkeyTitle = () => {
      if (!liveButtonEl) return;
      const binding = getHotkeyBinding("goLive");
      liveButtonEl.title = `${t("player.go_live")}${binding.enabled ? ` (${formatHotkeyKey(binding.key)})` : ""}`;
    };
    lifecycle.add(subscribeHotkeyBindings(updateHotkeyTitle));
    lifecycle.add(subscribeLang(() => {
      updateHotkeyTitle();
      lastLiveLabel = "";
      setLiveButtonState(lastBehindSeconds);
    }));
    let liveLatched = false;
    let lastSeekEnd = null;
    const detectLive = (current) => {
      if (liveLatched) return true;
      if (isLiveStream(current) || findLiveButton() !== null) {
        liveLatched = true;
        return true;
      }
      const end = seekableLiveEdge(current);
      if (end !== null) {
        if (lastSeekEnd !== null && end > lastSeekEnd + 0.5) {
          liveLatched = true;
          return true;
        }
        lastSeekEnd = end;
      }
      return false;
    };
    const formatBehind = (roundedSeconds) => roundedSeconds > 99 ? t("player.behind_minutes", { n: Math.round(roundedSeconds / 60) }) : t("player.behind_seconds", { n: roundedSeconds });
    let chipGroupEl = null;
    let behindTextEl = null;
    let goTextEl = null;
    const setLiveButtonState = (behindSeconds) => {
      lastBehindSeconds = behindSeconds;
      const behind = behindSeconds !== null;
      if (!liveButtonEl) return;
      const rounded = behind ? Math.max(0, Math.round(behindSeconds)) : 0;
      const label = behind ? formatBehind(rounded) : "";
      const key = `${label}|${t("player.to_live")}`;
      if (key === lastLiveLabel) return;
      lastLiveLabel = key;
      liveButtonEl.classList.toggle("kickflow-player-btn--behind", behind);
      document.documentElement.toggleAttribute(BEHIND_ATTRIBUTE, behind);
      chipGroupEl?.classList.toggle("kickflow-player-group--chip", behind);
      syncPlateRunEnds(chipGroupEl?.parentElement);
      if (behindTextEl) behindTextEl.textContent = label;
      if (goTextEl) goTextEl.textContent = t("player.to_live");
      liveButtonEl.tabIndex = behind ? 0 : -1;
      if (behind) liveButtonEl.removeAttribute("aria-hidden");
      else liveButtonEl.setAttribute("aria-hidden", "true");
      liveButtonEl.setAttribute(
        "aria-label",
        behind ? t("player.go_live_behind", { n: rounded }) : t("player.go_live")
      );
    };
    const resetAutoPlaybackRate = (current = getVideoElement()) => {
      catchingUp = false;
      if (current && getPlayerState().mode === "auto") {
        setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE2);
      }
    };
    const resetMediaTracking = (current) => {
      liveLatched = false;
      lastSeekEnd = null;
      resetAutoPlaybackRate(current);
      setForwardAtLiveEdge(false);
      setLiveButtonState(null);
    };
    const goLive = () => {
      const current = getVideoElement();
      const target = current ? goLiveTarget(current) : null;
      if (current && target !== null) {
        try {
          if (target > current.currentTime) {
            rememberGoLiveRewindWindow(current);
            current.currentTime = target;
          }
          if (getPlayerState().mode === "auto") resetAutoPlaybackRate(current);
          if (current.paused) void current.play().catch(() => void 0);
          return;
        } catch (error) {
          logger.warn("live-catchup: go-live seek failed", error);
        }
      }
      findLiveButton()?.click();
      if (getPlayerState().mode === "auto") resetAutoPlaybackRate();
    };
    activeGoLive = goLive;
    lifecycle.add(() => {
      if (activeGoLive === goLive) activeGoLive = null;
    });
    const onTimeUpdate = (event) => {
      const current = event.currentTarget;
      if (!(current instanceof HTMLVideoElement)) return;
      trackSeekRecovery("timeupdate", current);
      const playerState = getPlayerState();
      const live = detectLive(current);
      const liveEdgeSec = catchupLiveEdge(current);
      const behindBy = liveEdgeSec === null ? null : liveEdgeSec - current.currentTime;
      if (!live) {
        if (catchingUp) resetAutoPlaybackRate(current);
        setForwardAtLiveEdge(false);
        setLiveButtonState(null);
        return;
      }
      if (liveEdgeSec === null || behindBy === null) {
        if (catchingUp) resetAutoPlaybackRate(current);
        setForwardAtLiveEdge(false);
        setLiveButtonState(null);
        return;
      }
      const plausible = Number.isFinite(behindBy) && behindBy <= MAX_PLAUSIBLE_BEHIND_SECONDS;
      setForwardAtLiveEdge(plausible && behindBy <= BEHIND_THRESHOLD_SECONDS);
      const chipShown = lastBehindSeconds !== null;
      const showChip = plausible && (behindBy > BEHIND_THRESHOLD_SECONDS || chipShown && behindBy > CHIP_HIDE_SECONDS);
      setLiveButtonState(showChip ? behindBy : null);
      if (playerState.mode === "manual") {
        catchingUp = false;
        const action2 = decideCatchup({
          mode: playerState.mode,
          manualRate: playerState.manualRate,
          catchingUp,
          behindBy,
          behindPlausible: plausible
        });
        if (action2.kind === "manualDropToNormal") {
          setManualRate(NORMAL_PLAYBACK_RATE2);
          setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE2);
        }
        return;
      }
      if (!plausible) {
        if (catchingUp) resetAutoPlaybackRate(current);
        return;
      }
      const action = decideCatchup({
        mode: playerState.mode,
        manualRate: playerState.manualRate,
        catchingUp,
        behindBy,
        behindPlausible: plausible,
        bufferAhead: bufferAheadSeconds(current),
        stallHold: Date.now() < stallHoldUntil
      });
      const shouldMaintainCatchupRate = action.kind === "setRate" && action.rate === CATCHUP_PLAYBACK_RATE || catchingUp && action.kind === "none";
      if (shouldMaintainCatchupRate) {
        const startedCatchingUp = !catchingUp;
        catchingUp = true;
        setPlayerPlaybackRate(current, CATCHUP_PLAYBACK_RATE);
        if (startedCatchingUp) {
          logger.debug("live-catchup: behind by", behindBy.toFixed(1), "s, speeding up");
        }
      } else if (action.kind === "setRate" && action.rate === NORMAL_PLAYBACK_RATE2) {
        resetAutoPlaybackRate(current);
        logger.debug("live-catchup: caught up, resetting playback rate");
      }
    };
    bindVideoElementListener(lifecycle, "timeupdate", onTimeUpdate);
    for (const type of ["seeking", "seeked", "playing"]) {
      bindVideoElementListener(lifecycle, type, (event) => {
        if (event.currentTarget instanceof HTMLVideoElement) trackSeekRecovery(type, event.currentTarget);
      });
    }
    bindVideoElementListener(lifecycle, "waiting", (event) => {
      const current = event.currentTarget;
      if (!(current instanceof HTMLVideoElement) || trackSeekRecovery("waiting", current)) return;
      if (getPlayerState().mode !== "auto") return;
      stallCount += 1;
      stallHoldUntil = Date.now() + stallHoldMs(stallCount);
      if (catchingUp || current.playbackRate !== NORMAL_PLAYBACK_RATE2) {
        resetAutoPlaybackRate(current);
        logger.debug("live-catchup: rebuffer, auto catch-up paused");
      }
    });
    bindVideoElementListener(lifecycle, "loadstart", (event) => {
      const current = event.currentTarget;
      if (current instanceof HTMLVideoElement) {
        trackSeekRecovery("loadstart", current);
        resetMediaTracking(current);
      }
    });
    let currentVideo = video;
    observeVideoElement(lifecycle, (current) => {
      if (current === currentVideo) return;
      if (currentVideo && getPlayerState().mode === "auto") {
        setPlayerPlaybackRate(currentVideo, NORMAL_PLAYBACK_RATE2);
      }
      currentVideo = current;
      stallCount = 0;
      stallHoldUntil = 0;
      resetMediaTracking(current);
    });
    lifecycle.add(() => {
      resetAutoPlaybackRate();
      setForwardAtLiveEdge(false);
    });
    lifecycle.add(subscribePlayerState(() => {
      if (getPlayerState().mode === "manual") catchingUp = false;
    }));
    mountIntoControlBar(lifecycle, CONTROLS_ID3, () => {
      const group = document.createElement("span");
      group.className = "kickflow-player-group";
      const live = document.createElement("button");
      live.type = "button";
      live.className = "kickflow-player-btn kickflow-player-btn--live";
      live.append(createToLiveIcon());
      const behindText = document.createElement("span");
      behindText.className = "kickflow-live-chip__behind";
      const goText = document.createElement("span");
      goText.className = "kickflow-live-chip__go";
      live.append(behindText, goText);
      liveButtonEl = live;
      behindTextEl = behindText;
      goTextEl = goText;
      chipGroupEl = group;
      updateHotkeyTitle();
      lastLiveLabel = "";
      setLiveButtonState(null);
      live.addEventListener("click", goLive);
      group.append(live);
      return group;
    });
    void ensurePlayerStateLoaded();
  }

  // src/content/player/local-clip.ts
  var nameCapture = createCaptureNamer();
  function captureFilename(extension) {
    return nameCapture(location.pathname, extension);
  }
  var playerHost = () => document.fullscreenElement ?? findPlayerWrapper();
  function captureStatus(text) {
    showCaptureStatus(playerHost(), text);
  }
  function clipTitle(recording) {
    if (recording) return t("player.clip_stop");
    const binding = getHotkeyBinding("screenshot");
    return t("player.clip_record") + (binding.enabled ? ` (Shift+${formatHotkeyKey(binding.key)})` : "");
  }
  var WORDS = {
    clip_stop: "player.clip_stop",
    clip_record: "player.clip_record",
    clip_preview: "player.clip_preview",
    clip_save: "player.clip_save",
    clip_ready: "player.clip_ready",
    clip_recording: "player.clip_recording",
    clip_unsupported: "player.clip_unsupported",
    capture_no_frame: "player.capture_no_frame",
    capture_failed: "player.capture_failed",
    close: "common.close"
  };
  var words = (key) => t(WORDS[key]);
  var clip = createLocalClip({
    getVideo: () => getVideoElement(),
    getHost: playerHost,
    filename: captureFilename,
    text: words,
    title: clipTitle
  });
  function refreshLocalClipButtons() {
    clip.refreshButtons();
  }
  function cancelLocalClip() {
    clip.cancel();
  }
  function toggleLocalClip() {
    return clip.toggle();
  }
  function createLocalClipButton() {
    return clip.createButton();
  }

  // src/content/player/screenshot.ts
  var toastTimer = null;
  function showFrameToast2(url, filename) {
    const host = document.fullscreenElement ?? findPlayerWrapper();
    if (!host) return;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = showFrameToast(host, url, filename, t("player.frame_saved"));
  }
  var CONTROLS_ID4 = "kickflow-screenshot-controls";
  function screenshotFilename() {
    return captureFilename("png");
  }
  function captureFrame(video) {
    if (!video.videoWidth || !video.videoHeight) {
      logger.debug("screenshot: no decoded frame yet, ignoring");
      captureStatus(t("player.capture_no_frame"));
      return false;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      captureStatus(t("player.capture_failed"));
      return false;
    }
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          captureStatus(t("player.capture_failed"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const filename = screenshotFilename();
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showFrameToast2(url, filename);
        window.setTimeout(() => URL.revokeObjectURL(url), 1e4);
      }, "image/png");
      return true;
    } catch (error) {
      logger.warn("screenshot: capture failed (canvas may be CORS-tainted)", error);
      captureStatus(t("player.capture_failed"));
      return false;
    }
  }
  function captureScreenshot() {
    const video = getVideoElement();
    if (!video) {
      logger.warn("screenshot: #video-player not found at capture time");
      return false;
    }
    return captureFrame(video);
  }
  function initScreenshot(lifecycle) {
    lifecycle.add(cancelLocalClip);
    const video = getVideoElement();
    if (!video) {
      logger.debug("screenshot: #video-player not found, skipping");
      return;
    }
    let buttonEl = null;
    const updateHotkeyTitle = () => {
      refreshLocalClipButtons();
      if (!buttonEl) return;
      const binding = getHotkeyBinding("screenshot");
      buttonEl.title = `${t("player.screenshot")}${binding.enabled ? ` (${formatHotkeyKey(binding.key)})` : ""}`;
      buttonEl.setAttribute("aria-label", t("player.screenshot"));
    };
    lifecycle.add(subscribeHotkeyBindings(updateHotkeyTitle));
    lifecycle.add(subscribeLang(updateHotkeyTitle));
    mountIntoControlBar(lifecycle, CONTROLS_ID4, () => {
      const group = document.createElement("span");
      group.className = "kickflow-player-group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kickflow-player-btn";
      button.append(createCameraIcon());
      buttonEl = button;
      updateHotkeyTitle();
      button.addEventListener("click", () => {
        captureScreenshot();
      });
      group.append(button, createLocalClipButton());
      return group;
    });
  }

  // src/content/player/rewind-hotkeys.ts
  var SEEK_STEP_SECONDS = 10;
  var REPEAT_SEEK_MIN_INTERVAL_MS = 150;
  function isTypingTarget2(target) {
    let element = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    while (element) {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role")?.toLowerCase();
      const testId = element.getAttribute("data-testid")?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select" || role === "textbox" || element.hasAttribute("data-lexical-editor") || testId.includes("chat") || element.isContentEditable) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }
  function initRewindHotkeys(lifecycle) {
    const video = getVideoElement();
    if (!video) {
      logger.debug("rewind-hotkeys: #video-player not found, skipping");
      return;
    }
    let lastSeekAt = 0;
    const onKeyDown = (event) => {
      const keyboardEvent = event;
      if (isHotkeyCaptureActive()) return;
      if (isTypingTarget2(keyboardEvent.target)) return;
      if (keyboardEvent.target instanceof Element && keyboardEvent.target.closest(".kickflow-player-menu, [data-media-keyboard-scope]")) return;
      if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return;
      const action = findHotkeyAction(keyboardEvent.key);
      if (!action) return;
      try {
        let handled = false;
        if ((action === "rewind" || action === "forward") && featureFlags.rewindControls) {
          const current = getVideoElement();
          if (!current) return;
          const now = Date.now();
          if (keyboardEvent.repeat && now - lastSeekAt < REPEAT_SEEK_MIN_INTERVAL_MS) {
            handled = true;
          } else {
            const direction = action === "rewind" ? -1 : 1;
            const target = clampSeekTarget(current, direction * SEEK_STEP_SECONDS);
            current.currentTime = target;
            lastSeekAt = now;
            if (!keyboardEvent.repeat) showSeekRipple(direction * SEEK_STEP_SECONDS);
            logger.debug("rewind-hotkeys: seeked to", target);
            handled = true;
          }
        } else if (action === "screenshot" && featureFlags.screenshot) {
          handled = keyboardEvent.repeat || (keyboardEvent.shiftKey ? toggleLocalClip() : captureScreenshot());
        } else if (action === "goLive" && featureFlags.liveCatchup) {
          handled = goLiveNow();
        }
        if (!handled) return;
        keyboardEvent.preventDefault();
        keyboardEvent.stopImmediatePropagation();
      } catch (error) {
        logger.warn("rewind-hotkeys: action failed", action, error);
      }
    };
    lifecycle.addEventListener(document, "keydown", onKeyDown, true);
  }

  // src/content/player/seek-bar.ts
  var CONTROLS_ID5 = "kickflow-seek-bar";
  var KICK_CLASSES = {
    root: "group/seekbar absolute -top-7 left-0 h-5 w-full",
    track: "bg-subtle/50 absolute bottom-0 left-0 h-1 w-full",
    range: "absolute h-full bg-green-500",
    thumb: "bg-primary-base absolute size-4 rounded-full"
  };
  function computePlayedRatio(video) {
    const edge = liveEdge(video);
    if (edge === null) return null;
    const floor = seekFloor(video);
    const span = edge - floor;
    if (!(span > 0)) return null;
    const ratio = (video.currentTime - floor) / span;
    return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  }
  function seekDeltaForRatio(video, ratio) {
    const edge = liveEdge(video);
    if (edge === null) return null;
    const floor = seekFloor(video);
    const span = edge - floor;
    if (!(span > 0)) return null;
    const target = floor + span * (ratio < 0 ? 0 : ratio > 1 ? 1 : ratio);
    return target - video.currentTime;
  }
  function isNativeSeekBarVisible(root) {
    for (const candidate of root.querySelectorAll('[class*="group/seekbar"]')) {
      if (candidate.id === CONTROLS_ID5) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    return false;
  }
  var UNPAINTED = /* @__PURE__ */ new Set(["", "rgba(0, 0, 0, 0)", "transparent"]);
  function probeKickClassesResolved(root, range) {
    if (!range.isConnected) return false;
    const painted = !UNPAINTED.has(getComputedStyle(range).backgroundColor);
    root.classList.toggle("kickflow-seek-bar--fallback", !painted);
    if (!painted) {
      logger.debug("seek-bar: Kick utility classes did not resolve, using measured fallback");
    }
    return true;
  }
  function initSeekBar(lifecycle) {
    if (!getVideoElement()) {
      logger.debug("seek-bar: #video-player not found, skipping");
      return;
    }
    let rootEl = null;
    let rangeEl = null;
    let thumbEl = null;
    let fallbackProbed = false;
    const render = () => {
      const root = rootEl;
      const range = rangeEl;
      const thumb = thumbEl;
      if (!root || !range || !thumb) return;
      const bar = findControlBar();
      if (bar && isNativeSeekBarVisible(bar)) {
        root.hidden = true;
        return;
      }
      const video = getVideoElement();
      const played = video ? computePlayedRatio(video) : null;
      if (played === null) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      if (!fallbackProbed) fallbackProbed = probeKickClassesResolved(root, range);
      const playedPercent = `${(played * 100).toFixed(2)}%`;
      range.style.width = playedPercent;
      thumb.style.left = playedPercent;
    };
    const seekToPointer = (event) => {
      const root = rootEl;
      const video = getVideoElement();
      if (!root || !video) return;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return;
      const delta = seekDeltaForRatio(video, (event.clientX - rect.left) / rect.width);
      if (delta === null) return;
      try {
        video.currentTime = clampSeekTarget(video, delta);
      } catch (error) {
        logger.warn("seek-bar: seek failed", error);
      }
      render();
    };
    bindVideoElementListener(lifecycle, "timeupdate", render);
    bindVideoElementListener(lifecycle, "progress", render);
    bindVideoElementListener(lifecycle, "loadstart", render);
    observeVideoElement(lifecycle, render);
    mountIntoControlBarRoot(lifecycle, CONTROLS_ID5, () => {
      const root = document.createElement("div");
      root.className = `${KICK_CLASSES.root} kickflow-seek-bar`;
      root.hidden = true;
      const track = document.createElement("div");
      track.className = `${KICK_CLASSES.track} kickflow-seek-bar__track`;
      const range = document.createElement("div");
      range.className = `${KICK_CLASSES.range} kickflow-seek-bar__range`;
      const thumb = document.createElement("div");
      thumb.className = `${KICK_CLASSES.thumb} kickflow-seek-bar__thumb`;
      track.append(range);
      root.append(track, thumb);
      rootEl = root;
      rangeEl = range;
      thumbEl = thumb;
      fallbackProbed = false;
      root.addEventListener("pointerdown", seekToPointer);
      render();
      return root;
    });
  }

  // src/content/player/speed-controls.ts
  var CONTROLS_ID6 = "kickflow-speed-controls";
  var GRID_COLUMNS = SPEED_GRID_COLUMNS;
  var STARVATION_RATE_THRESHOLD = 2.5;
  var STARVATION_WINDOW_MS = 5e3;
  var STARVATION_WAITING_COUNT = 2;
  var STARVATION_FALLBACK_RATE = 1.5;
  function formatRate(rate) {
    return formatPlaybackRate(rate, getLang());
  }
  function displayObservedRate2(rate) {
    return displayObservedRate(rate, getLang());
  }
  function deactivateSpeedControls() {
    const current = getVideoElement();
    if (getPlayerState().mode === "manual") setAutoMode();
    if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE2);
  }
  function initSpeedControls(lifecycle) {
    const video = getVideoElement();
    if (!video) {
      logger.debug("speed-controls: #video-player not found, skipping");
      return;
    }
    let buttonEl = null;
    let waitingEvents = [];
    let warningEl = null;
    let warningTimer = null;
    const clearWarning = () => {
      warningEl?.remove();
      warningEl = null;
      if (warningTimer !== null) {
        window.clearTimeout(warningTimer);
        warningTimer = null;
      }
    };
    const showStarvationWarning = () => {
      const host = document.fullscreenElement ?? findPlayerWrapper();
      if (!host) return;
      clearWarning();
      const warning = document.createElement("div");
      warning.className = "kickflow-speed-warning";
      warning.textContent = t("player.buffer_warning");
      host.append(warning);
      warningEl = warning;
      warningTimer = window.setTimeout(clearWarning, 2500);
    };
    let lastVisual = "";
    const updateButtonVisual = () => {
      if (!buttonEl) return;
      const playerState = getPlayerState();
      const manual = playerState.mode === "manual";
      const observedRate = getVideoElement()?.playbackRate ?? NORMAL_PLAYBACK_RATE2;
      const catching = !manual && Math.abs(observedRate - NORMAL_PLAYBACK_RATE2) > 0.05;
      const rateText = manual ? formatRate(playerState.manualRate) : catching ? displayObservedRate2(observedRate) : formatRate(NORMAL_PLAYBACK_RATE2);
      const visual = `${manual ? "m" : catching ? "c" : "a"}|${rateText}|${getLang()}`;
      if (visual === lastVisual) return;
      lastVisual = visual;
      const parts = [];
      if (catching) parts.push(createBoltIcon());
      const value = document.createElement("span");
      value.className = "kickflow-speed-btn__value";
      value.textContent = rateText;
      parts.push(value);
      if (!manual) {
        const auto = document.createElement("small");
        auto.className = "kickflow-speed-btn__auto";
        auto.textContent = t("player.auto");
        parts.push(auto);
      }
      buttonEl.replaceChildren(...parts);
      buttonEl.classList.toggle("kickflow-speed-btn--manual", manual);
      buttonEl.classList.toggle("kickflow-speed-btn--catch", catching);
      buttonEl.setAttribute("aria-pressed", String(manual));
      const label = manual ? t("player.manual_speed", { rate: rateText }) : catching ? t("player.speed_catching", { rate: rateText }) : `${t("player.select_speed")}: ${rateText} ${t("player.auto")}`;
      buttonEl.title = manual || catching ? label : t("player.select_speed");
      buttonEl.setAttribute("aria-label", label);
    };
    const selectAuto = () => {
      setAutoMode();
      const current = getVideoElement();
      if (current) setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE2);
      updateButtonVisual();
    };
    const selectManualRate = (rate) => {
      setManualRate(rate);
      const current = getVideoElement();
      if (current) setPlayerPlaybackRate(current, rate);
      updateButtonVisual();
    };
    const speedMenu = new PlayerMenu2({
      className: "kickflow-speed-menu",
      fill: (root) => {
        const playerState = getPlayerState();
        root.setAttribute("aria-label", t("player.speed_menu_title"));
        const head = document.createElement("div");
        head.className = "kickflow-speed-menu__head";
        const title = document.createElement("span");
        title.textContent = t("player.speed_menu_title");
        const esc = document.createElement("kbd");
        esc.className = "kickflow-player-kbd";
        esc.textContent = "Esc";
        head.append(title, esc);
        root.append(head);
        const auto = document.createElement("button");
        auto.type = "button";
        auto.className = "kickflow-speed-menu__auto";
        auto.setAttribute("role", "menuitemcheckbox");
        auto.setAttribute("aria-checked", String(playerState.mode === "auto"));
        const autoText = document.createElement("span");
        autoText.className = "kickflow-speed-menu__auto-text";
        const autoTitle = document.createElement("b");
        autoTitle.textContent = t("player.speed_auto_title");
        const autoHint = document.createElement("small");
        autoHint.textContent = t("player.speed_auto_hint");
        autoText.append(autoTitle, autoHint);
        const knob = document.createElement("span");
        knob.className = "kickflow-switch";
        knob.setAttribute("aria-hidden", "true");
        auto.append(autoText, knob);
        auto.addEventListener("click", () => {
          if (getPlayerState().mode === "auto") selectManualRate(NORMAL_PLAYBACK_RATE2);
          else selectAuto();
          updateMenuSelection();
        });
        root.append(auto);
        const grid = document.createElement("div");
        grid.className = "kickflow-speed-menu__grid";
        grid.setAttribute("role", "group");
        const items = [];
        for (const rate of SPEED_GRID_RATES) {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "kickflow-speed-menu__item";
          item.setAttribute("role", "menuitemradio");
          const checked = playerState.mode === "manual" && Math.abs(playerState.manualRate - rate) < 1e-3;
          item.setAttribute("aria-checked", String(checked));
          item.textContent = formatRate(rate);
          item.addEventListener("click", () => {
            selectManualRate(rate);
            speedMenu.close();
          });
          items.push(item);
          grid.append(item);
        }
        const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLUMNS, ArrowUp: -GRID_COLUMNS };
        grid.addEventListener("keydown", (event) => {
          const index = items.indexOf(event.target);
          const step = steps[event.key];
          if (index < 0 || step === void 0) return;
          event.preventDefault();
          event.stopPropagation();
          const next = index + step;
          if (next < 0 && event.key === "ArrowUp") {
            auto.focus();
            return;
          }
          items[Math.min(items.length - 1, Math.max(0, next))]?.focus();
        });
        auto.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          items[0]?.focus();
        });
        root.append(grid);
        const hint = document.createElement("div");
        hint.className = "kickflow-speed-menu__hint";
        hint.textContent = t("player.speed_manual_hint");
        root.append(hint);
      },
      initialFocus: (root) => root.querySelector('.kickflow-speed-menu__item[aria-checked="true"]') ?? root.querySelector(".kickflow-speed-menu__auto")
    });
    const updateMenuSelection = () => {
      const root = speedMenu.element;
      if (!root) return;
      const state2 = getPlayerState();
      root.querySelector(".kickflow-speed-menu__auto")?.setAttribute("aria-checked", String(state2.mode === "auto"));
      root.querySelectorAll(".kickflow-speed-menu__item").forEach((item, index) => {
        item.setAttribute("aria-checked", String(state2.mode === "manual" && Math.abs(state2.manualRate - SPEED_GRID_RATES[index]) < 1e-3));
      });
    };
    const onWaiting = (event) => {
      const current = event.currentTarget;
      if (!(current instanceof HTMLVideoElement)) return;
      if (current.playbackRate < STARVATION_RATE_THRESHOLD) {
        waitingEvents = [];
        return;
      }
      const now = Date.now();
      waitingEvents = waitingEvents.filter((timestamp) => now - timestamp <= STARVATION_WINDOW_MS);
      waitingEvents.push(now);
      if (waitingEvents.length < STARVATION_WAITING_COUNT) return;
      waitingEvents = [];
      setManualRate(STARVATION_FALLBACK_RATE);
      setPlayerPlaybackRate(current, STARVATION_FALLBACK_RATE);
      showStarvationWarning();
      logger.debug("speed-controls: high-rate playback starved, reduced to", STARVATION_FALLBACK_RATE);
    };
    bindVideoElementListener(lifecycle, "waiting", onWaiting);
    bindVideoElementListener(lifecycle, "ratechange", (event) => {
      const current = event.currentTarget;
      if (!(current instanceof HTMLVideoElement)) return;
      if (current.playbackRate < STARVATION_RATE_THRESHOLD) waitingEvents = [];
      updateButtonVisual();
    });
    observeVideoElement(lifecycle, (current) => {
      waitingEvents = [];
      if (current && getPlayerState().mode === "manual") {
        setPlayerPlaybackRate(current, getPlayerState().manualRate);
      }
      updateButtonVisual();
    });
    lifecycle.add(subscribePlayerState((state2, previous) => {
      const current = getVideoElement();
      updateButtonVisual();
      if (current && state2.mode === "manual") {
        setPlayerPlaybackRate(current, state2.manualRate);
      } else if (current && previous.mode === "manual") {
        setPlayerPlaybackRate(current, NORMAL_PLAYBACK_RATE2);
      }
      updateMenuSelection();
    }));
    lifecycle.add(subscribeLang(() => {
      updateButtonVisual();
      speedMenu.close();
      if (warningEl) warningEl.textContent = t("player.buffer_warning");
    }));
    lifecycle.add(() => speedMenu.close());
    lifecycle.add(clearWarning);
    mountIntoControlBar(lifecycle, CONTROLS_ID6, () => {
      const group = document.createElement("span");
      group.className = "kickflow-player-group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kickflow-speed-btn";
      button.setAttribute("aria-haspopup", "menu");
      buttonEl = button;
      lastVisual = "";
      updateButtonVisual();
      button.addEventListener("click", () => speedMenu.toggle(button));
      group.append(button);
      return group;
    });
    void ensurePlayerStateLoaded().then(() => {
      if (lifecycle.isDisposed) return;
      const playerState = getPlayerState();
      const current = getVideoElement();
      if (current && playerState.mode === "manual") {
        setPlayerPlaybackRate(current, playerState.manualRate);
      }
      updateButtonVisual();
    });
  }

  // src/content/player/auto-theater.ts
  var RETRY_DELAY_MS2 = 250;
  var MAX_RETRIES = 20;
  var TECHNICAL_THEATER_TOKEN = /(?:^|[-_:])(theat(?:er|re)|wide)(?:[-_:]|$)/i;
  var THEATER_SHORTCUT = /\(\s*t\s*\)\s*$/i;
  var THEATER_STATE_SELECTOR = "[data-theatre]";
  function technicalMetadata(element) {
    const values = [];
    for (const name of ["id", "class", "data-testid", "data-control", "data-action", "data-icon", "name"]) {
      const value = element.getAttribute(name);
      if (value) values.push(value);
    }
    return values;
  }
  function findTheaterButton() {
    const bar = findControlBar();
    if (!bar) return null;
    for (const button of bar.querySelectorAll("button")) {
      if (button.closest('[id^="kickflow-"]')) continue;
      const metadata = [
        ...technicalMetadata(button),
        ...Array.from(button.querySelectorAll("svg, svg *")).flatMap(technicalMetadata)
      ];
      if (metadata.some((value) => TECHNICAL_THEATER_TOKEN.test(value))) return button;
      const accessibleLabel = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`.trim();
      if (THEATER_SHORTCUT.test(accessibleLabel)) return button;
    }
    return null;
  }
  function isTheaterModeActive(button = findTheaterButton()) {
    const shell = document.querySelector(THEATER_STATE_SELECTOR);
    if (shell?.getAttribute("data-theatre") === "true") return true;
    if (!button) return false;
    if (button.getAttribute("aria-pressed") === "true") return true;
    return ["active", "on", "checked"].includes(button.getAttribute("data-state") ?? "");
  }
  function revealControlBar2() {
    const wrapper = findPlayerWrapper();
    if (!wrapper) return;
    for (const type of ["pointermove", "mousemove", "mouseover"]) {
      wrapper.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 8,
        clientY: 8
      }));
    }
  }
  var AutoTheaterController = class {
    constructor(lifecycle) {
      this.lifecycle = lifecycle;
      this.video = null;
      this.appliedVideo = null;
      this.retryTimer = null;
      this.retryCount = 0;
      observeVideoElement(lifecycle, (video) => {
        if (this.video === video) return;
        this.video = video;
        this.resetAttempt();
        this.trigger();
      });
      bindVideoElementListener(lifecycle, "loadstart", () => {
        this.resetAttempt();
        this.trigger();
      });
      lifecycle.addEventListener(window, "kickflow:locationchange", () => {
        this.resetAttempt();
        this.trigger();
      });
      lifecycle.add(() => this.cancelRetry());
    }
    syncFlag() {
      if (!featureFlags.autoTheater) {
        this.cancelRetry();
        return;
      }
      this.resetAttempt();
      this.trigger();
    }
    resetAttempt() {
      this.appliedVideo = null;
      this.retryCount = 0;
      this.cancelRetry();
    }
    cancelRetry() {
      if (this.retryTimer === null) return;
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    scheduleRetry(missingAnchor) {
      if (!featureFlags.autoTheater || this.lifecycle.isDisposed || this.retryTimer !== null) return;
      if (this.retryCount >= MAX_RETRIES) {
        const anchor = missingAnchor === "video-player" ? "SELECTORS.videoPlayer (#video-player)" : "TECHNICAL_THEATER_TOKEN and THEATER_SHORTCUT in src/content/player/auto-theater.ts";
        logger.warn(
          `auto-theater: gave up after ${MAX_RETRIES} attempts \u2014 ${anchor} did not match Kick's player DOM.`
        );
        return;
      }
      this.retryCount++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.trigger();
      }, RETRY_DELAY_MS2);
    }
    trigger() {
      if (!featureFlags.autoTheater || this.lifecycle.isDisposed) return;
      const video = getVideoElement();
      if (!video) {
        this.scheduleRetry("video-player");
        return;
      }
      if (this.video !== video) {
        this.video = video;
        this.appliedVideo = null;
        this.retryCount = 0;
      }
      if (this.appliedVideo === video) return;
      const button = findTheaterButton();
      if (isTheaterModeActive(button)) {
        this.appliedVideo = video;
        this.cancelRetry();
        return;
      }
      if (!button) {
        revealControlBar2();
        this.scheduleRetry("theater-button");
        return;
      }
      this.appliedVideo = video;
      this.cancelRetry();
      button.click();
    }
  };
  var activeController3 = null;
  function initAutoTheater(lifecycle) {
    const controller2 = new AutoTheaterController(lifecycle);
    activeController3 = controller2;
    lifecycle.add(() => {
      if (activeController3 === controller2) activeController3 = null;
    });
  }
  function syncAutoTheaterFlag() {
    activeController3?.syncFlag();
  }

  // src/content/player/caption-guard.ts
  var CAPTIONS_PREFERENCE_KEY = "captions_enabled";
  var RETRY_DELAY_MS3 = 250;
  var MAX_RETRIES2 = 20;
  var ACTIVE_ICON_PATH_PREFIX = "M20 17.999";
  var INACTIVE_ICON_PATH_PREFIX = "M8.99973 7.99921";
  function getNativeCaptionState(button) {
    const pressed = button.getAttribute("aria-pressed");
    if (pressed === "true") return true;
    if (pressed === "false") return false;
    const paths = Array.from(button.querySelectorAll("svg path"));
    const firstPath = paths[0]?.getAttribute("d") ?? "";
    if (paths.length === 1 && firstPath.startsWith(ACTIVE_ICON_PATH_PREFIX)) return true;
    if (paths.length >= 3 && firstPath.startsWith(INACTIVE_ICON_PATH_PREFIX)) return false;
    return null;
  }
  function findNativeCaptionButton() {
    const button = findControlBar()?.querySelector(SELECTORS.nativeCaptionButton);
    return button instanceof HTMLButtonElement ? button : null;
  }
  function revealControlBar3() {
    const wrapper = findPlayerWrapper();
    if (!wrapper) return;
    for (const type of ["pointermove", "mousemove", "mouseover"]) {
      wrapper.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 8,
        clientY: 8
      }));
    }
  }
  function disablePersistedCaptionPreference() {
    try {
      window.localStorage.setItem(CAPTIONS_PREFERENCE_KEY, JSON.stringify(false));
    } catch {
      logger.debug("caption-guard: Kick localStorage unavailable; relying on the native control");
    }
  }
  var CaptionGuardController = class {
    constructor(lifecycle) {
      this.lifecycle = lifecycle;
      this.retryTimer = null;
      this.retryCount = 0;
      this.settled = false;
      disablePersistedCaptionPreference();
      lifecycle.add(() => this.cancelRetry());
      this.trigger();
    }
    cancelRetry() {
      if (this.retryTimer === null) return;
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    finish() {
      this.settled = true;
      this.cancelRetry();
    }
    /**
     * A stream with no captions has no caption control, and that is not a rotted selector.
     *
     * A caption button may be absent even when every other control is mounted. 2026-10-16.
     * A full control bar does not guarantee that captions are available. Blaming
     * `SELECTORS.nativeCaptionButton` there is a false accusation, and repeating it on every
     * caption-less stream is exactly how a warning channel loses its meaning.
     *
     * So warn only when a caption-SHAPED control is present and we still cannot read it — a button
     * whose test id or accessible name says captions while our own selector misses it.
     */
    captionControlLooksRotted() {
      if (document.querySelector(SELECTORS.nativeCaptionButton)) return false;
      const bar = findControlBar();
      if (!bar) return false;
      return Array.from(bar.querySelectorAll("button")).some((button) => {
        const signals = [
          button.getAttribute("data-testid") ?? "",
          button.getAttribute("aria-label") ?? "",
          button.getAttribute("title") ?? ""
        ].join(" ");
        return /caption|subtitle|altyaz/i.test(signals);
      });
    }
    scheduleRetry() {
      if (this.settled || this.lifecycle.isDisposed || this.retryTimer !== null) return;
      if (this.retryCount >= MAX_RETRIES2) {
        if (this.captionControlLooksRotted()) {
          logger.warn(
            `caption-guard: gave up after ${MAX_RETRIES2} attempts \u2014 a caption-shaped control is in the bar but SELECTORS.nativeCaptionButton (${SELECTORS.nativeCaptionButton}) or the ACTIVE_ICON_PATH_PREFIX / INACTIVE_ICON_PATH_PREFIX signatures in src/content/player/caption-guard.ts no longer match it. Only the persisted preference was reset.`
          );
        } else {
          logger.debug("caption-guard: this stream exposes no caption control; persisted preference reset only");
        }
        return;
      }
      this.retryCount++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.trigger();
      }, RETRY_DELAY_MS3);
    }
    trigger() {
      if (this.settled || this.lifecycle.isDisposed) return;
      const button = findNativeCaptionButton();
      const state2 = button ? getNativeCaptionState(button) : null;
      if (state2 === false) {
        this.finish();
        return;
      }
      if (state2 === true && button) {
        this.finish();
        button.click();
        return;
      }
      revealControlBar3();
      this.scheduleRetry();
    }
  };
  function initCaptionGuard(lifecycle) {
    new CaptionGuardController(lifecycle);
  }

  // src/content/player/aspect-fill.ts
  var ASPECT_MODES = ["contain", "cover", "stretch"];
  var MAX_STRETCH = 1.15;
  var ASPECT_HOTKEY = "u";
  function normalizeAspectMode(value) {
    return value === "contain" || value === "cover" || value === "stretch" ? value : null;
  }
  function nextAspectMode(mode) {
    return ASPECT_MODES[(ASPECT_MODES.indexOf(mode) + 1) % ASPECT_MODES.length];
  }
  function containedPicture(box, videoWidth, videoHeight) {
    if (!(videoWidth > 0 && videoHeight > 0 && box.width > 0 && box.height > 0)) return box;
    const aspect = videoWidth / videoHeight;
    const width = Math.min(box.width, box.height * aspect);
    const height = width / aspect;
    return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
  }
  function fillTransform(mode, box, picture, stage) {
    if (mode === "contain") return null;
    if (!(picture.width > 0 && picture.height > 0 && stage.width > 0 && stage.height > 0)) return null;
    const wide = stage.width / picture.width, tall = stage.height / picture.height;
    if (Math.abs(wide - tall) < 0.02) return null;
    let sx, sy;
    if (mode === "cover") {
      sx = sy = Math.max(wide, tall);
    } else if (wide > tall) {
      const stretch = Math.min(wide / tall, MAX_STRETCH);
      sy = wide / stretch;
      sx = wide;
      if (sy < tall) sy = tall;
    } else {
      const stretch = Math.min(tall / wide, MAX_STRETCH);
      sx = tall / stretch;
      sy = tall;
      if (sx < wide) sx = wide;
    }
    const boxMidX = box.x + box.width / 2, boxMidY = box.y + box.height / 2;
    const picMidX = picture.x + picture.width / 2, picMidY = picture.y + picture.height / 2;
    const stageMidX = stage.x + stage.width / 2, stageMidY = stage.y + stage.height / 2;
    const tx = stageMidX - (boxMidX + (picMidX - boxMidX) * sx);
    const ty = stageMidY - (boxMidY + (picMidY - boxMidY) * sy);
    const toLocalX = (x) => boxMidX + (x - tx - boxMidX) / sx;
    const toLocalY = (y) => boxMidY + (y - ty - boxMidY) / sy;
    const left = Math.max(0, toLocalX(stage.x) - box.x), right = Math.max(0, box.x + box.width - toLocalX(stage.x + stage.width));
    const top = Math.max(0, toLocalY(stage.y) - box.y), bottom = Math.max(0, box.y + box.height - toLocalY(stage.y + stage.height));
    return { tx, ty, sx, sy, clip: { top, right, bottom, left } };
  }
  function findStage(video) {
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && fullscreen !== video && fullscreen.contains(video)) return fullscreen;
    const ownWidth = video.offsetWidth, ownHeight = video.offsetHeight;
    let node = video.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (node === document.body) break;
      const style = getComputedStyle(node);
      const clips = /hidden|clip/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
      if (clips && (node.offsetWidth > ownWidth + 4 || node.offsetHeight > ownHeight + 4)) return node;
    }
    return null;
  }
  var rectOf = (element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  var STYLE_ATTR = "data-kickflow-aspect";
  var AMBIENT_CLASS = "kickflow-ambient";
  var TOAST_CLASS = "kickflow-aspect-toast";
  var AspectController = class {
    constructor(lifecycle, getMode, ambient) {
      this.lifecycle = lifecycle;
      this.getMode = getMode;
      this.ambient = ambient;
      this.video = null;
      this.stage = null;
      this.applied = false;
      this.resize = null;
      this.frame = 0;
      this.onMeta = () => this.schedule();
      observeVideoElement(lifecycle, (video) => this.bind(video));
      lifecycle.addEventListener(document, "fullscreenchange", () => this.schedule());
      lifecycle.addEventListener(window, "resize", () => this.schedule());
      lifecycle.add(() => this.unbind());
    }
    bind(video) {
      if (video === this.video) return;
      this.unbind();
      this.video = video;
      if (!video) return;
      video.addEventListener("loadedmetadata", this.onMeta);
      video.addEventListener("resize", this.onMeta);
      if (typeof ResizeObserver === "function") {
        this.resize = new ResizeObserver(() => this.schedule());
        this.resize.observe(video);
      }
      this.schedule();
    }
    unbind() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.resize?.disconnect();
      this.resize = null;
      if (this.video) {
        this.video.removeEventListener("loadedmetadata", this.onMeta);
        this.video.removeEventListener("resize", this.onMeta);
        this.clear(this.video);
      }
      this.video = null;
      this.stage = null;
    }
    schedule() {
      if (this.frame || this.lifecycle.isDisposed) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.apply();
      });
    }
    clear(video) {
      if (!this.applied) return;
      video.style.removeProperty("transform");
      video.style.removeProperty("transform-origin");
      video.style.removeProperty("clip-path");
      video.removeAttribute(STYLE_ATTR);
      this.applied = false;
    }
    apply() {
      const video = this.video;
      if (!video || !video.isConnected) return;
      const mode = this.getMode();
      this.clear(video);
      const stage = findStage(video);
      this.stage = stage;
      if (stage && this.ambient()) ambientFor(stage, video, this.lifecycle);
      if (!stage || mode === "contain") return;
      const box = rectOf(video);
      const picture = containedPicture(box, video.videoWidth, video.videoHeight);
      const plan = fillTransform(mode, box, picture, rectOf(stage));
      if (!plan) return;
      video.style.setProperty("transform-origin", "50% 50%");
      video.style.setProperty("transform", `translate(${plan.tx.toFixed(2)}px, ${plan.ty.toFixed(2)}px) scale(${plan.sx.toFixed(4)}, ${plan.sy.toFixed(4)})`);
      const c = plan.clip;
      video.style.setProperty("clip-path", `inset(${c.top.toFixed(1)}px ${c.right.toFixed(1)}px ${c.bottom.toFixed(1)}px ${c.left.toFixed(1)}px)`);
      video.setAttribute(STYLE_ATTR, mode);
      this.applied = true;
    }
    toast(text) {
      const host = this.stage ?? this.video?.parentElement;
      if (!host) return;
      host.querySelector(`.${TOAST_CLASS}`)?.remove();
      const note2 = document.createElement("div");
      note2.className = TOAST_CLASS;
      note2.textContent = text;
      note2.setAttribute("role", "status");
      Object.assign(note2.style, {
        position: "absolute",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "30",
        padding: "6px 12px",
        borderRadius: "6px",
        background: "rgba(11,11,12,0.78)",
        color: "#fff",
        font: "600 13px/1.3 system-ui, sans-serif",
        pointerEvents: "none"
      });
      host.append(note2);
      window.setTimeout(() => note2.remove(), 1400);
    }
  };
  var ambientByStage = /* @__PURE__ */ new WeakMap();
  var ambientActive = null;
  function stopAmbient() {
    ambientActive?.stop();
    ambientActive = null;
  }
  function ambientFor(stage, video, lifecycle) {
    if (ambientActive?.stage === stage && ambientByStage.get(stage)?.canvas.isConnected) return;
    stopAmbient();
    const canvas = document.createElement("canvas");
    canvas.className = AMBIENT_CLASS;
    canvas.width = 32;
    canvas.height = 18;
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      filter: "blur(48px) saturate(1.3)",
      opacity: "0.55",
      transform: "scale(1.15)"
    });
    if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
    stage.prepend(canvas);
    const context = canvas.getContext("2d");
    const timer = window.setInterval(() => {
      if (!context || document.visibilityState !== "visible" || video.paused || video.readyState < 2) return;
      if (!canvas.isConnected) stage.prepend(canvas);
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
      }
    }, 125);
    const stop = () => {
      window.clearInterval(timer);
      canvas.remove();
      ambientByStage.delete(stage);
    };
    ambientByStage.set(stage, { canvas, stop });
    ambientActive = { stage, stop };
    lifecycle.add(() => {
      if (ambientActive?.stage === stage) stopAmbient();
      else stop();
    });
  }
  var controller = null;
  var ambientController = null;
  var modeChanged = null;
  function aspectModeLabel(mode) {
    return t(mode === "cover" ? "player.aspect_cover" : mode === "stretch" ? "player.aspect_stretch" : "player.aspect_contain");
  }
  function setAspectModeWriter(writer) {
    modeChanged = writer;
  }
  function initUltrawideFill(lifecycle) {
    const current = new AspectController(lifecycle, () => normalizeAspectMode(featureFlags.aspectMode) ?? "contain", () => false);
    controller = current;
    lifecycle.add(() => {
      if (controller === current) controller = null;
    });
    lifecycle.addEventListener(document, "keydown", (event) => {
      const key = event;
      if (key.defaultPrevented || key.repeat || key.ctrlKey || key.metaKey || key.altKey) return;
      if (key.key.toLowerCase() !== ASPECT_HOTKEY || isTypingTarget2(key.target)) return;
      const next = nextAspectMode(normalizeAspectMode(featureFlags.aspectMode) ?? "contain");
      modeChanged?.(next);
      current.toast(aspectModeLabel(next));
    }, true);
  }
  function initAmbientBands(lifecycle) {
    const current = new AspectController(lifecycle, () => "contain", () => true);
    ambientController = current;
    lifecycle.add(() => {
      if (ambientController === current) ambientController = null;
      stopAmbient();
    });
  }
  function syncAspectMode() {
    controller?.schedule();
    ambientController?.schedule();
  }

  // src/content/player/audio-level.ts
  var COMPRESSOR = Object.freeze({ threshold: -26, knee: 24, ratio: 4, attack: 4e-3, release: 0.25 });
  var MAKEUP_GAIN = 1.5;
  var LIMITER = Object.freeze({ threshold: -1, knee: 0, ratio: 20, attack: 1e-3, release: 0.05 });
  var USER_INPUT_MS = 1e3;
  var VOLUME_WRITE_MS = 250;
  var RESTORE_WINDOW_MS = 8e3;
  var NOTE_CLASS = "kickflow-leveller-note";
  var CHANNEL_VOLUMES_KEY = "kf_channelVolumes";
  var MAX_REMEMBERED_CHANNELS = 300;
  var SILENCE_MS = 4e3;
  var levellerState = "off";
  var stateListeners = /* @__PURE__ */ new Set();
  function setState2(state2) {
    if (levellerState === state2) return;
    levellerState = state2;
    for (const listener of stateListeners) listener(state2);
  }
  function onLevellerState(listener) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }
  function routableSource(video, pageOrigin = location.origin) {
    const src = video.currentSrc || "";
    if (!src || src.startsWith("blob:")) return true;
    if (video.crossOrigin) return true;
    try {
      return new URL(src).origin === pageOrigin;
    } catch {
      return false;
    }
  }
  var sharedContext = null;
  var routes = /* @__PURE__ */ new WeakMap();
  var routedAny = false;
  var resumeArmed = false;
  var contextWatched = null;
  function watchContext(context) {
    if (contextWatched === context || typeof context.addEventListener !== "function") return;
    contextWatched = context;
    context.addEventListener("statechange", () => {
      if (!routedAny || context.state === "running" || context.state === "closed" || resumeArmed) return;
      resumeArmed = true;
      const resume = () => {
        if (!resumeArmed) return;
        resumeArmed = false;
        document.removeEventListener("pointerdown", resume, true);
        document.removeEventListener("keydown", resume, true);
        void context.resume().catch(() => {
        });
      };
      document.addEventListener("pointerdown", resume, true);
      document.addEventListener("keydown", resume, true);
    });
  }
  var contextFactory = () => new AudioContext();
  function route(video) {
    const existing = routes.get(video);
    if (existing) return existing;
    try {
      sharedContext ??= contextFactory();
      const context = sharedContext;
      const source = context.createMediaElementSource(video);
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = COMPRESSOR.threshold;
      compressor.knee.value = COMPRESSOR.knee;
      compressor.ratio.value = COMPRESSOR.ratio;
      compressor.attack.value = COMPRESSOR.attack;
      compressor.release.value = COMPRESSOR.release;
      const gain = context.createGain();
      gain.gain.value = MAKEUP_GAIN;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      limiter.attack.value = LIMITER.attack;
      limiter.release.value = LIMITER.release;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      compressor.connect(gain);
      gain.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(context.destination);
      const made = { context, source, compressor, gain, limiter, analyser, levelled: false };
      routes.set(video, made);
      routedAny = true;
      watchContext(context);
      return made;
    } catch (error) {
      logger.debug("audio-level: Web Audio routing refused", error);
      return null;
    }
  }
  function setLevelled(made, on) {
    if (made.levelled === on && made.source.__kfConnected) return;
    try {
      made.source.disconnect();
    } catch {
    }
    made.source.connect(on ? made.compressor : made.context.destination);
    made.source.__kfConnected = true;
    made.levelled = on;
  }
  function showNote(video, text) {
    const host = video.closest("#injected-channel-player") ?? video.parentElement;
    if (!host) return;
    host.querySelector(`.${NOTE_CLASS}`)?.remove();
    const note2 = document.createElement("div");
    note2.className = NOTE_CLASS;
    note2.textContent = text;
    note2.setAttribute("role", "status");
    Object.assign(note2.style, {
      position: "absolute",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "30",
      padding: "6px 12px",
      borderRadius: "6px",
      background: "rgba(11,11,12,0.82)",
      color: "#fff",
      font: "600 13px/1.3 system-ui, sans-serif",
      pointerEvents: "none",
      maxWidth: "80%",
      textAlign: "center"
    });
    host.append(note2);
    window.setTimeout(() => note2.remove(), 8e3);
  }
  function watchSilence(video, made) {
    const buffer = new Float32Array(made.analyser.fftSize);
    let silentSince = 0;
    const id = window.setInterval(() => {
      if (!made.levelled || video.paused || video.muted || video.volume === 0 || video.readyState < 3) {
        silentSince = 0;
        return;
      }
      made.analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
      if (peak > 0) {
        silentSince = 0;
        if (levellerState === "silent") setState2("on");
        return;
      }
      silentSince ||= Date.now();
      if (Date.now() - silentSince >= SILENCE_MS) setState2("silent");
    }, 500);
    return () => window.clearInterval(id);
  }
  function initLoudnessLeveller(lifecycle) {
    setState2("waiting");
    let current = null;
    let pendingGesture = false;
    let stopSilence = null;
    const waitingForSource = /* @__PURE__ */ new WeakSet();
    const noted = /* @__PURE__ */ new WeakMap();
    const offState = onLevellerState((state2) => {
      const video = current;
      if (!video || state2 !== "silent" && state2 !== "unsupported") return;
      const seen = noted.get(video) ?? /* @__PURE__ */ new Set();
      if (seen.has(state2)) return;
      seen.add(state2);
      noted.set(video, seen);
      showNote(video, t(state2 === "silent" ? "player.leveller_silent" : "player.leveller_unsupported"));
    });
    lifecycle.add(offState);
    const attach = (video) => {
      if (video !== current) {
        stopSilence?.();
        stopSilence = null;
      }
      current = video;
      if (!video || lifecycle.isDisposed) return;
      if (!video.currentSrc && !video.srcObject && !routes.has(video)) {
        setState2("waiting");
        if (!waitingForSource.has(video)) {
          waitingForSource.add(video);
          const loaded = () => {
            video.removeEventListener("loadedmetadata", loaded);
            video.removeEventListener("playing", loaded);
            waitingForSource.delete(video);
            if (current === video) attach(video);
          };
          lifecycle.addEventListener(video, "loadedmetadata", loaded);
          lifecycle.addEventListener(video, "playing", loaded);
        }
        return;
      }
      if (!routableSource(video)) {
        setState2("unsupported");
        return;
      }
      sharedContext ??= (() => {
        try {
          return contextFactory();
        } catch {
          return null;
        }
      })();
      const context = sharedContext;
      if (!context) {
        setState2("unsupported");
        return;
      }
      if (context.state !== "running") {
        void context.resume().catch(() => {
        });
        if (context.state !== "running") {
          setState2("waiting");
          if (!pendingGesture) {
            pendingGesture = true;
            const retry = () => {
              if (!pendingGesture) return;
              pendingGesture = false;
              void context.resume().then(() => {
                if (current && !lifecycle.isDisposed) attach(current);
              }, () => {
              });
            };
            lifecycle.addEventListener(document, "pointerdown", retry, { capture: true, once: true });
            lifecycle.addEventListener(document, "keydown", retry, { capture: true, once: true });
          }
          return;
        }
      }
      const made = route(video);
      if (!made) {
        setState2("unsupported");
        return;
      }
      setLevelled(made, true);
      setState2("on");
      stopSilence?.();
      stopSilence = watchSilence(video, made);
    };
    observeVideoElement(lifecycle, attach);
    lifecycle.add(() => {
      stopSilence?.();
      stopSilence = null;
      if (current) {
        const made = routes.get(current);
        if (made) setLevelled(made, false);
        (current.closest("#injected-channel-player") ?? current.parentElement)?.querySelector(`.${NOTE_CLASS}`)?.remove();
      }
      current = null;
      setState2("off");
    });
  }
  function sanitizeChannelVolumes(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries = Object.entries(raw).filter(([slug, value]) => {
      if (!/^[a-z0-9_-]{1,100}$/.test(slug) || !value || typeof value !== "object") return false;
      const entry = value;
      return typeof entry.v === "number" && entry.v >= 0 && entry.v <= 1 && typeof entry.m === "boolean" && typeof entry.at === "number";
    });
    entries.sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(entries.slice(0, MAX_REMEMBERED_CHANNELS));
  }
  function rememberVolume(all, slug, volume, muted, now = Date.now()) {
    const v = Math.round(Math.min(1, Math.max(0, volume)) * 1e3) / 1e3;
    return sanitizeChannelVolumes({ ...all, [slug.toLowerCase()]: { v, m: muted, at: now } });
  }
  function currentChannelSlug(pathname = location.pathname) {
    const context = parseChatSessionContext(pathname);
    return context ? context.slug.toLowerCase() : null;
  }
  function initChannelVolume(lifecycle) {
    const slug = currentChannelSlug();
    if (!slug) return;
    let bound = null;
    let writing = 0;
    let restored = false;
    let wanted = null;
    let lastUserInputAt = -Infinity;
    let changedByHim = false;
    let boundAt = 0;
    let writeTimer = 0;
    let pending = null;
    const apply = (video) => {
      if (!wanted || changedByHim) return;
      if (Math.abs(video.volume - wanted.v) < 5e-3 && video.muted === wanted.m) {
        restored = true;
        return;
      }
      writing++;
      video.volume = wanted.v;
      video.muted = wanted.m;
      window.setTimeout(() => {
        writing = Math.max(0, writing - 1);
      }, 0);
      restored = true;
    };
    const markUser = (event) => {
      const target = event?.target;
      if (event && !(target instanceof Element && bound && (target.closest("#injected-channel-player") || bound.parentElement?.contains(target)))) return;
      lastUserInputAt = Date.now();
    };
    const store = () => {
      writeTimer = 0;
      const value = pending;
      pending = null;
      if (!value) return;
      void safeStorageGet(CHANNEL_VOLUMES_KEY).then((stored) => {
        const next = rememberVolume(sanitizeChannelVolumes(stored[CHANNEL_VOLUMES_KEY]), slug, value.volume, value.muted);
        return safeStorageSet({ [CHANNEL_VOLUMES_KEY]: next });
      });
    };
    const onVolume = () => {
      const video = bound;
      if (!video || writing > 0) return;
      if (currentChannelSlug() !== slug) return;
      if (Date.now() - lastUserInputAt > USER_INPUT_MS) {
        if (wanted && !changedByHim && Date.now() - boundAt <= RESTORE_WINDOW_MS) apply(video);
        return;
      }
      changedByHim = true;
      pending = { volume: video.volume, muted: video.muted };
      if (writeTimer) window.clearTimeout(writeTimer);
      writeTimer = window.setTimeout(store, VOLUME_WRITE_MS);
    };
    const onPlaying = () => {
      if (bound && !restored) apply(bound);
    };
    lifecycle.addEventListener(document, "pointerdown", markUser, true);
    lifecycle.addEventListener(document, "wheel", markUser, { capture: true, passive: true });
    lifecycle.addEventListener(document, "keydown", (event) => {
      const key = event.key;
      if (isTypingTarget2(event.target)) return;
      if (key === "ArrowUp" || key === "ArrowDown" || key.toLowerCase() === "m") markUser();
    }, true);
    observeVideoElement(lifecycle, (video) => {
      bound?.removeEventListener("volumechange", onVolume);
      bound?.removeEventListener("playing", onPlaying);
      bound = video;
      restored = false;
      boundAt = Date.now();
      if (!video) return;
      video.addEventListener("volumechange", onVolume);
      video.addEventListener("playing", onPlaying);
      if (wanted) apply(video);
    });
    lifecycle.add(() => {
      if (writeTimer) {
        window.clearTimeout(writeTimer);
        store();
      }
      bound?.removeEventListener("volumechange", onVolume);
      bound?.removeEventListener("playing", onPlaying);
      bound = null;
    });
    void safeStorageGet(CHANNEL_VOLUMES_KEY).then((stored) => {
      if (lifecycle.isDisposed) return;
      wanted = sanitizeChannelVolumes(stored[CHANNEL_VOLUMES_KEY])[slug] ?? null;
      if (wanted && bound) apply(bound);
      if (wanted) lifecycle.setTimeout(() => {
        if (bound) {
          restored = false;
          apply(bound);
        }
      }, 1500);
    });
  }

  // src/content/content-blocking.ts
  var BLOCK_LISTS_KEY = "kf_blockLists";
  var BLOCKED_ATTRIBUTE = "data-kickflow-blocked";
  var MAX_ENTRIES = 300;
  var CARD_SELECTOR = [
    '[data-testid="livestream-results-card"]',
    '[data-testid^="sidebar-recommended-channel-"]',
    '[data-testid^="sidebar-following-channel-"]',
    '[data-testid="category-card-root"]'
  ].join(", ");
  function normalizeTerm(value) {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function termList(raw) {
    const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]/) : [];
    const out = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      let term = normalizeTerm(value);
      term = term.replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\//, "").replace(/^\/?category\//, "").replace(/^[@/]+/, "").replace(/\/+$/, "");
      if (term && term.length <= 100 && !out.includes(term)) out.push(term);
    }
    return out.slice(0, MAX_ENTRIES);
  }
  function sanitizeBlockLists(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return { channels: termList(source.channels), categories: termList(source.categories), tags: termList(source.tags) };
  }
  function isEmpty(lists2) {
    return !lists2.channels.length && !lists2.categories.length && !lists2.tags.length;
  }
  function hrefPath(anchor) {
    const href = anchor.getAttribute("href") ?? "";
    try {
      return new URL(href, "https://kick.com").pathname;
    } catch {
      return "";
    }
  }
  function readCard(card) {
    const facts = { channel: null, categories: [], tags: [] };
    const anchors = card.matches("a[href]") ? [card, ...card.querySelectorAll("a[href]")] : [...card.querySelectorAll("a[href]")];
    for (const anchor of anchors) {
      const path = hrefPath(anchor);
      const category = /^\/category\/([^/]+)\/?$/.exec(path);
      if (category) {
        facts.categories.push(normalizeTerm(decodeURIComponent(category[1])));
        const name = anchor.textContent ?? "";
        if (name.trim() && !card.matches('[data-testid="category-card-root"]')) facts.categories.push(normalizeTerm(name));
        continue;
      }
      const channel = /^\/([A-Za-z0-9_-]{1,100})\/?$/.exec(path);
      if (channel && !facts.channel) facts.channel = channel[1].toLowerCase();
    }
    if (card.matches('[data-testid="category-card-root"]')) {
      const title = card.querySelector("[title], h3, h2, span");
      const name = title?.getAttribute("title") ?? title?.textContent ?? "";
      if (name.trim()) facts.categories.push(normalizeTerm(name));
      facts.channel = null;
    }
    if (/^sidebar-/.test(card.getAttribute("data-testid") ?? "")) {
      const lines = card.querySelectorAll("span.truncate");
      const category = lines[1]?.textContent ?? "";
      if (category.trim()) facts.categories.push(normalizeTerm(category));
    }
    for (const pill of card.querySelectorAll('[class*="group/tag"]')) {
      const text = pill.textContent ?? "";
      if (text.trim()) facts.tags.push(normalizeTerm(text));
    }
    return facts;
  }
  function isBlocked(facts, lists2) {
    if (facts.channel && lists2.channels.includes(facts.channel)) return true;
    if (facts.categories.some((value) => lists2.categories.includes(value))) return true;
    return facts.tags.some((value) => lists2.tags.includes(value) || lists2.categories.includes(value));
  }
  function applyBlocking(root, lists2, enabled) {
    let hidden = 0;
    for (const card of root.querySelectorAll(CARD_SELECTOR)) {
      const block = enabled && !isEmpty(lists2) && isBlocked(readCard(card), lists2);
      if (block) {
        hidden++;
        if (!card.hasAttribute(BLOCKED_ATTRIBUTE)) card.setAttribute(BLOCKED_ATTRIBUTE, "");
      } else if (card.hasAttribute(BLOCKED_ATTRIBUTE)) {
        card.removeAttribute(BLOCKED_ATTRIBUTE);
      }
    }
    return hidden;
  }
  var STYLE_ID3 = "kickflow-content-blocking-style";
  function ensureStyle2() {
    if (document.getElementById(STYLE_ID3)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID3;
    style.textContent = `[${BLOCKED_ATTRIBUTE}]{display:none!important}`;
    (document.head ?? document.documentElement).append(style);
  }
  var lists = { channels: [], categories: [], tags: [] };
  var rerun = null;
  function handleBlockListsChange(changes) {
    if (!Object.prototype.hasOwnProperty.call(changes, BLOCK_LISTS_KEY)) return;
    lists = sanitizeBlockLists(changes[BLOCK_LISTS_KEY].newValue);
    rerun?.();
  }
  function syncContentBlocking() {
    rerun?.();
  }
  async function initContentBlocking(lifecycle) {
    ensureStyle2();
    let frame = 0;
    let observing = false;
    const scan = () => {
      if (frame || lifecycle.isDisposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyBlocking(document, lists, featureFlags.contentBlocking);
      });
    };
    const observer = new MutationObserver((records) => {
      if (!onlyChatMutations(records)) scan();
    });
    const active = () => featureFlags.contentBlocking && !isEmpty(lists);
    const run = () => {
      if (lifecycle.isDisposed) return;
      if (active() && !observing && document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        observing = true;
      } else if (!active() && observing) {
        observer.disconnect();
        observing = false;
      }
      scan();
    };
    rerun = run;
    lifecycle.add(() => {
      if (frame) cancelAnimationFrame(frame);
      if (rerun === run) rerun = null;
      observer.disconnect();
      observing = false;
      applyBlocking(document, lists, false);
      document.getElementById(STYLE_ID3)?.remove();
    });
    lifecycle.addEventListener(window, "kickflow:locationchange", () => {
      if (active()) scan();
    });
    const stored = await safeStorageGet(BLOCK_LISTS_KEY);
    if (lifecycle.isDisposed) return;
    lists = sanitizeBlockLists(stored[BLOCK_LISTS_KEY]);
    run();
  }

  // src/content/player/bar-order.ts
  var BAR_ORDER_STYLE_ID = "kickflow-bar-order";
  var BAR_ORDER_RULE = 'div.z-controls.bottom-0 button[data-testid="video-player-fullscreen"] { order: 1 }';
  function installBarOrder() {
    const existing = document.getElementById(BAR_ORDER_STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
      existing.textContent = BAR_ORDER_RULE;
      return;
    }
    existing?.remove();
    const style = document.createElement("style");
    style.id = BAR_ORDER_STYLE_ID;
    style.textContent = BAR_ORDER_RULE;
    document.head.appendChild(style);
  }
  function removeBarOrder() {
    document.getElementById(BAR_ORDER_STYLE_ID)?.remove();
  }
  function syncBarOrderFlag() {
    if (featureFlags.fullscreenTerminal) {
      installBarOrder();
    } else {
      removeBarOrder();
    }
    syncFloatingStrip();
  }
  function syncFloatingStrip() {
    const root = document.documentElement;
    if (featureFlags.floatingStrip) {
      if (!root.hasAttribute(STRIP_ATTRIBUTE)) root.setAttribute(STRIP_ATTRIBUTE, "");
    } else {
      root.removeAttribute(STRIP_ATTRIBUTE);
    }
  }
  function removeFloatingStrip() {
    document.documentElement.removeAttribute(STRIP_ATTRIBUTE);
  }
  function initBarOrder(lifecycle) {
    syncBarOrderFlag();
    lifecycle.add(removeBarOrder);
    lifecycle.add(removeFloatingStrip);
  }

  // src/content/bootstrap.ts
  var OVERLAY_ROOT_ID2 = "kickflow-chat-overlay";
  var OWN_LIST_ID2 = "kickflow-message-list";
  var PRESERVED_SWEEP_INTERVAL_MS = 6e4;
  var NAVIGATION_POLL_INTERVAL_MS = 400;
  var CHANNEL_RESOLUTION_ATTEMPT_TIMEOUT_MS = 6e3;
  var INITIAL_NO_CONTENT_FALLBACK_MS = 15e3;
  var PRIMARY_RECONNECT_GRACE_MS = 12e3;
  var BOOLEAN_FLAG_KEYS = [
    "showDeletedMessages",
    "preserveBansInline",
    "debugLogging",
    "showSubscriptions",
    "showGiftedSubs",
    "showKicks",
    "showPolls",
    "showHostRaid",
    "showModeChanges",
    "showChattersBadges",
    "showUserMessages",
    "chatSearchHotkey",
    "hideQuickEmoteBar",
    "showModActions",
    "autoTheater",
    "captionGuard",
    "rewindControls",
    "seekBar",
    "liveCatchup",
    "qualityLock",
    "qualityAlwaysBest",
    "screenshot",
    "speedControls",
    "fullscreenTerminal",
    "floatingStrip",
    "autoClaimDrops",
    "autoClaimDailyReward",
    "mentionHighlightEnabled",
    "modFrameEnabled",
    "vipFrameEnabled",
    "ultrawideFill",
    "ambientBands",
    "loudnessLeveler",
    "channelVolume",
    "contentBlocking",
    "liveNotify"
  ];
  var STRING_FLAG_PARSERS = {
    chatMode: (value) => value === "native" || value === "own" ? value : null,
    hoverFollowMode: (value) => value === "browser-smooth" || value === "instant" ? value : null,
    mentionHighlightStyle: (value) => value === "frame" || value === "fill" || value === "both" ? value : null,
    roleHighlightStyle: (value) => value === "frame" || value === "both" ? value : null,
    mentionHighlightColor: (value) => typeof value === "string" ? sanitizeHighlightColor(value) : null,
    modFrameColor: (value) => typeof value === "string" ? sanitizeHighlightColor(value) : null,
    vipFrameColor: (value) => typeof value === "string" ? sanitizeHighlightColor(value) : null,
    manualUsername: (value) => typeof value === "string" ? value.trim() : null,
    qualityMode: (value) => normalizeQualityMode(value),
    aspectMode: (value) => value === "cover" || value === "stretch" || value === "contain" ? value : null
  };
  var STRING_FLAG_KEYS = Object.keys(STRING_FLAG_PARSERS);
  function parseStringFlag(key, value) {
    return STRING_FLAG_PARSERS[key](value);
  }
  var PLAYER_FEATURE_KEYS = [
    "captionGuard",
    "rewindControls",
    "seekBar",
    "liveCatchup",
    "qualityLock",
    "screenshot",
    "speedControls",
    "ultrawideFill",
    "ambientBands",
    "loudnessLeveler",
    "channelVolume"
  ];
  function isPlayerFeatureFlagKey(key) {
    return PLAYER_FEATURE_KEYS.includes(key);
  }
  function isBooleanFlagKey(key) {
    return BOOLEAN_FLAG_KEYS.includes(key);
  }
  function isStringFlagKey(key) {
    return STRING_FLAG_KEYS.includes(key);
  }
  function createSystemEventCallbacks(enqueueOnce, updateSystemEvent = enqueueOnce) {
    let systemEventSequence = 0;
    let previousChatroomState = null;
    const createSystemEventMessage = (id, eventChatroomId, systemEvent) => ({
      id,
      chatroomId: eventChatroomId,
      content: "",
      type: systemEvent.kind,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sender: {
        id: 0,
        username: "username" in systemEvent ? systemEvent.username : "",
        slug: "",
        identity: { color: "", badges: [], badgesV2: [] }
      },
      systemEvent,
      preserved: false
    });
    return {
      onSubscription: (payload) => {
        if (payload.months > 1) return;
        if (!featureFlags.showSubscriptions) return;
        const sequence = ++systemEventSequence;
        enqueueOnce(createSystemEventMessage(
          `sub:${payload.chatroomId}:${encodeURIComponent(payload.username)}:${payload.months}:${sequence}`,
          payload.chatroomId,
          { kind: "subscription", username: payload.username, months: payload.months }
        ));
      },
      onGiftedSubscriptions: (payload) => {
        if (!featureFlags.showGiftedSubs) return;
        enqueueOnce(createSystemEventMessage(
          `gift:${payload.chatroomId}:${encodeURIComponent(payload.correlationId)}`,
          payload.chatroomId,
          {
            kind: "gifted-subscription",
            username: payload.gifterUsername,
            giftCount: payload.giftCount,
            giftedUsernames: payload.giftedUsernames
          }
        ));
      },
      onKicksGifted: (payload) => {
        if (!featureFlags.showKicks) return;
        enqueueOnce(createSystemEventMessage(
          `kicks:${encodeURIComponent(payload.giftTransactionId)}`,
          0,
          {
            kind: "kicks",
            username: payload.senderUsername,
            amount: payload.amount,
            giftName: payload.giftName,
            senderMessage: payload.senderMessage
          }
        ));
      },
      onHost: (payload) => {
        if (!featureFlags.showHostRaid) return;
        const sequence = ++systemEventSequence;
        enqueueOnce(createSystemEventMessage(
          `host:${payload.chatroomId}:${encodeURIComponent(payload.hostUsername)}:${sequence}`,
          payload.chatroomId,
          {
            kind: "host",
            username: payload.hostUsername,
            numberViewers: payload.numberViewers,
            optionalMessage: payload.optionalMessage
          }
        ));
      },
      onChatroomUpdated: (payload) => {
        const previous = previousChatroomState;
        previousChatroomState = payload;
        if (!previous || previous.chatroomId !== payload.chatroomId) return;
        const changes = [];
        if (previous.slowMode.enabled !== payload.slowMode.enabled || payload.slowMode.enabled && previous.slowMode.messageInterval !== payload.slowMode.messageInterval) {
          changes.push({
            mode: "slow_mode",
            text: payload.slowMode.enabled ? t("event.mode.slow_on", { n: payload.slowMode.messageInterval }) : t("event.mode.slow_off")
          });
        }
        if (previous.followersMode.enabled !== payload.followersMode.enabled || payload.followersMode.enabled && previous.followersMode.minDuration !== payload.followersMode.minDuration) {
          changes.push({
            mode: "followers_mode",
            text: payload.followersMode.enabled ? payload.followersMode.minDuration > 0 ? t("event.mode.followers_on_minutes", { n: payload.followersMode.minDuration }) : t("event.mode.followers_on") : t("event.mode.followers_off")
          });
        }
        if (previous.subscribersMode.enabled !== payload.subscribersMode.enabled) {
          changes.push({
            mode: "subscribers_mode",
            text: payload.subscribersMode.enabled ? t("event.mode.subscribers_on") : t("event.mode.subscribers_off")
          });
        }
        if (previous.emotesMode.enabled !== payload.emotesMode.enabled) {
          changes.push({
            mode: "emotes_mode",
            text: payload.emotesMode.enabled ? t("event.mode.emotes_on") : t("event.mode.emotes_off")
          });
        }
        if (!featureFlags.showModeChanges) return;
        for (const change of changes) {
          const sequence = ++systemEventSequence;
          enqueueOnce(createSystemEventMessage(
            `mode:${payload.chatroomId}:${change.mode}:${sequence}`,
            payload.chatroomId,
            { kind: "mode", mode: change.mode, text: change.text }
          ));
        }
      },
      onModAction: (notice) => {
        if (!featureFlags.showModActions) return;
        enqueueOnce(createSystemEventMessage(
          `mod-action:${notice.id}`,
          0,
          {
            kind: "mod-action",
            actionKind: notice.kind,
            moderator: notice.moderator,
            durationMin: notice.durationMin,
            victims: notice.victims,
            count: notice.count
          }
        ));
      },
      onModActionUpdated: (notice) => {
        if (!featureFlags.showModActions) return;
        updateSystemEvent(createSystemEventMessage(
          `mod-action:${notice.id}`,
          0,
          {
            kind: "mod-action",
            actionKind: notice.kind,
            moderator: notice.moderator,
            durationMin: notice.durationMin,
            victims: notice.victims,
            count: notice.count
          }
        ));
      }
    };
  }
  var CHATROOM_ID_MAX_ATTEMPTS = 3;
  var CHATROOM_ID_RETRY_BASE_MS = 800;
  async function resolveChannel(slug, lifecycle) {
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
    for (let attempt = 0; attempt < CHATROOM_ID_MAX_ATTEMPTS; attempt++) {
      if (lifecycle?.isDisposed) return null;
      const controller2 = new AbortController();
      lifecycle?.add(() => controller2.abort());
      const timeoutId = window.setTimeout(() => controller2.abort(), CHANNEL_RESOLUTION_ATTEMPT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: controller2.signal
        });
        if (response.ok) {
          const json = await response.json();
          const chatroomId = json.chatroom?.id;
          if (!Number.isSafeInteger(chatroomId) || chatroomId <= 0) throw new Error("Channel chatroom not ready");
          const channelId = typeof json.id === "number" ? json.id : typeof json.chatroom?.channel_id === "number" ? json.chatroom.channel_id : chatroomId;
          const subscriberBadges2 = Array.isArray(json.subscriber_badges) ? json.subscriber_badges.map((b) => ({ months: Number(b?.months), src: typeof b?.badge_image?.src === "string" ? b.badge_image.src : "" })).filter((b) => Number.isFinite(b.months) && b.src).sort((a, b) => a.months - b.months) : [];
          return { chatroomId, channelId, subscriberBadges: subscriberBadges2 };
        }
        const transient = response.status === 403 || response.status === 429 || response.status >= 500;
        if (transient) {
          logger.debug("bootstrap: channel lookup failed for", slug, "status", response.status, "(retrying)");
        } else {
          logger.info("bootstrap: channel lookup failed for", slug, "status", response.status, "(terminal)");
          return null;
        }
      } catch (error) {
        logger.debug("bootstrap: channel lookup threw", error, "(retrying)");
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (attempt < CHATROOM_ID_MAX_ATTEMPTS - 1) {
        if (lifecycle?.isDisposed) return null;
        await new Promise((resolve) => {
          const timer = window.setTimeout(resolve, CHATROOM_ID_RETRY_BASE_MS * 2 ** attempt);
          lifecycle?.add(() => {
            window.clearTimeout(timer);
            resolve();
          });
        });
      }
    }
    logger.warn("bootstrap: channel lookup exhausted retries for", slug, "- native chat stays visible");
    return null;
  }
  var FALLBACK_STYLE_ID = "kickflow-styles";
  var stylesInstalled = false;
  var adoptedStyleSheet = null;
  function ensureStyles2() {
    if (stylesInstalled) return;
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
    #${OVERLAY_ROOT_ID2} { display: flex; flex-direction: column; overflow: hidden; }
    #${OWN_LIST_ID2} {
      flex: 1 1 auto; min-height: 0; padding: 6px 8px 6px 6px; overflow-y: auto; height: auto; box-sizing: border-box;
      font-size: max(12px, var(--chatroom-font-size, 13px)); line-height: 1.5; color: var(--kf-ink);
      font-family: var(--kf-font);
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #${OWN_LIST_ID2} .kickflow-message {
      display: block; position: relative; padding: var(--chatroom-message-spacing, 3px) 6px var(--chatroom-message-spacing, 3px) 10px; border-radius: 4px;
      word-break: break-word; overflow-wrap: anywhere;
    }
    #${OWN_LIST_ID2} .kickflow-message:not(.kickflow-event-row):hover { background: rgba(255,255,255,0.045); }
    #${OWN_LIST_ID2} .kickflow-message:not(.kickflow-event-row):not(.kickflow-message--hl-fill):not(.kickflow-message--role-fill):hover:not([data-kickflow-pointer-row]):not(:has(:focus-visible)) {
      background: transparent;
    }
    #${OWN_LIST_ID2} .kickflow-message:not(.kickflow-event-row):not(.kickflow-message--hl-fill):not(.kickflow-message--role-fill):is([data-kickflow-pointer-row], :has(:focus-visible)) {
      background: rgba(255,255,255,0.045);
    }
    #${OWN_LIST_ID2} .kickflow-message__time {
      display: var(--chatroom-timestamps-display, inline); color: var(--kf-ink-3);
      font-size: max(12px, calc(var(--chatroom-font-size, 13px) - 2px)); font-weight: 600;
      margin-right: 4px; font-variant-numeric: tabular-nums;
    }
    #${OWN_LIST_ID2} .kickflow-message__time:empty { display: none; }
    #${OWN_LIST_ID2} .kickflow-message__identity {
      display: inline-flex; min-width: 0; flex-wrap: nowrap; align-items: baseline;
    }
    #${OWN_LIST_ID2} .kickflow-message__badges:empty { display: none; }
    #${OWN_LIST_ID2} .kickflow-message__badges {
      display: inline-flex; align-items: center; align-self: center; gap: 4px;
      padding-right: 4px;
    }
    #${OWN_LIST_ID2} .kickflow-message__username {
      font-weight: 700; color: inherit; text-decoration: none;
    }
    #${OWN_LIST_ID2} .kickflow-message__username--link,
    .kickflow-event-row__identity--link { cursor: pointer; }
    #${OWN_LIST_ID2} .kickflow-message__username--link:hover,
    .kickflow-event-row__identity--link:hover { text-decoration: underline; text-underline-offset: 2px; }
    #${OWN_LIST_ID2} .kickflow-message__separator {
      display: inline-flex; color: inherit; font-weight: 700;
    }
    #${OWN_LIST_ID2} .kickflow-message__content { color: var(--kf-ink); line-height: 1.55; }

    /* --- Gutter: one 3px mark at the row's left edge. Solid = who / you; dashed = removed. --- */
    #${OWN_LIST_ID2} .kickflow-message::before {
      content: none; position: absolute; left: 2px; top: 4px; bottom: 4px; width: 3px; border-radius: 2px;
      pointer-events: none;
    }
    #${OWN_LIST_ID2} .kickflow-message--can-reply { position: relative; min-height: 28px; padding-right: 30px; }
    #${OWN_LIST_ID2} .kickflow-message__reply-action {
      position: absolute; right: 2px; top: 2px; width: 24px; height: 24px;
      border: 0; border-radius: 4px; background: #232a26; color: #efeff1;
      font: inherit; font-size: 18px; cursor: pointer; opacity: 0; pointer-events: none;
    }
    #${OWN_LIST_ID2} .kickflow-message:is([data-kickflow-pointer-row], :focus-within) .kickflow-message__reply-action {
      opacity: 1; pointer-events: auto;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-action:focus-visible { outline: 2px solid #53fc18; }
    #${OWN_LIST_ID2} .kickflow-message__reply-status { display: block; color: #facc83; font-size: 12px; }
    /* Highlight colors: CSS vars are synchronized from their feature flags. */
    #${OWN_LIST_ID2} {
      --kf-hl-outline: rgba(255,201,77,0.95);
      --kf-hl-fill: rgba(255,201,77,0.13);
      --kf-hl-fill-only: rgba(255,201,77,0.18);
      --kf-mod-bar: rgba(20,184,166,${ROLE_BAR_ALPHA});
      --kf-mod-fill: rgba(20,184,166,${ROLE_FILL_ALPHA});
      --kf-vip-bar: rgba(236,72,153,${ROLE_BAR_ALPHA});
      --kf-vip-fill: rgba(236,72,153,${ROLE_FILL_ALPHA});
    }
    /* Mentions of you: "frame" = your colour in the gutter plus a hairline ring; "fill" = a wash. */
    #${OWN_LIST_ID2} .kickflow-message--mention-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight),
    #${OWN_LIST_ID2} .kickflow-message--reply-me.kickflow-message--hl-frame:not(.kickflow-message--jump-highlight) {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kf-hl-outline) 30%, transparent);
    }
    #${OWN_LIST_ID2} .kickflow-message.kickflow-message--mention-me::before,
    #${OWN_LIST_ID2} .kickflow-message.kickflow-message--reply-me::before {
      content: ''; background: var(--kf-hl-outline);
    }
    /* A removed row speaks only through its dashed gutter. */
    #${OWN_LIST_ID2} .kickflow-message.kickflow-preserved::before { content: none; }
    #${OWN_LIST_ID2} .kickflow-message--mention-me.kickflow-message--hl-fill,
    #${OWN_LIST_ID2} .kickflow-message--reply-me.kickflow-message--hl-fill {
      background-color: var(--kf-hl-fill);
    }
    /* fill-only mode uses the slightly stronger tint */
    #${OWN_LIST_ID2} .kickflow-message--hl-fill:not(.kickflow-message--hl-frame) {
      background-color: var(--kf-hl-fill-only);
    }
    /* Role bars: left accent always; faint tint only with role-fill (yields to personal fill). */
    #${OWN_LIST_ID2} .kickflow-message--role-mod {
      padding-left: 10px;
    }
    #${OWN_LIST_ID2} .kickflow-message--role-mod::before,
    #${OWN_LIST_ID2} .kickflow-message--role-vip::before {
      content: ''; position: absolute; left: 2px; top: 4px; bottom: 4px;
      width: ${ROLE_BAR_WIDTH_PX}px; background: var(--kf-mod-bar); border-radius: 0;
    }
    #${OWN_LIST_ID2} .kickflow-message--role-mod.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-mod-fill);
    }
    #${OWN_LIST_ID2} .kickflow-message--role-vip {
      padding-left: 10px;
    }
    #${OWN_LIST_ID2} .kickflow-message--role-vip::before { background: var(--kf-vip-bar); }
    #${OWN_LIST_ID2} .kickflow-message--role-vip.kickflow-message--role-fill:not(.kickflow-message--hl-fill) {
      background-color: var(--kf-vip-fill);
    }
    #${OWN_LIST_ID2} .kickflow-message--jump-highlight {
      background-color: var(--kf-green-soft);
      box-shadow: inset 0 0 0 1px rgba(83,252,24,0.70);
      animation: kickflow-jump-land .9s var(--kf-ease) both;
    }
    @keyframes kickflow-jump-land { from { background-color: rgba(83,252,24,0.26); } to { background-color: rgba(83,252,24,0.12); } }

    /* --- Reply: a thread spine from the quoted line down to the speaker, no box. --- */
    #${OWN_LIST_ID2} .kickflow-message__reply-context {
      position: relative; display: flex; align-items: center; width: 100%; min-width: 0; margin-bottom: 1px;
      padding: 0 0 0 20px; color: var(--kf-ink-3); font-size: 12px; font-weight: 500; line-height: 1.5;
      white-space: nowrap; overflow: hidden;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-context::before {
      content: ''; position: absolute; left: 6px; top: 50%; width: 10px; height: 100%;
      border: solid var(--kf-line-3); border-width: 1.5px 0 0 1.5px; border-top-left-radius: 6px;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-context[role="button"] { cursor: pointer; }
    #${OWN_LIST_ID2} .kickflow-message__reply-context[role="button"]:hover { color: var(--kf-ink-2); }
    #${OWN_LIST_ID2} .kickflow-message__reply-context[role="button"]:hover::before { border-color: var(--kf-ink-3); }
    #${OWN_LIST_ID2} .kickflow-message__reply-context[role="button"]:focus-visible { outline: 2px solid var(--kf-green); outline-offset: -2px; border-radius: 3px; }
    #${OWN_LIST_ID2} .kickflow-message__reply-context--to-me { color: var(--kf-ink-2); }
    #${OWN_LIST_ID2} .kickflow-message__reply-context--to-me::before { border-color: var(--kf-hl-outline); }
    #${OWN_LIST_ID2} .kickflow-message__reply-me-mark {
      display: inline-block; margin-right: 4px; color: var(--kf-hl-outline); font-size: 12px;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-context--miss {
      animation: kickflow-reply-miss 0.5s ease;
    }
    @keyframes kickflow-reply-miss {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-3px); }
      40%, 80% { transform: translateX(3px); }
    }
    /* The spine replaces the arrow glyph; the glyph stays in the DOM for screen readers' text. */
    #${OWN_LIST_ID2} .kickflow-message__reply-icon {
      position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%);
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-text {
      display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-separator { flex: none; }
    #${OWN_LIST_ID2} .kickflow-message__reply-user {
      flex: 0 0 auto; flex-shrink: 0; white-space: nowrap;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-separator { white-space: pre; }
    #${OWN_LIST_ID2} .kickflow-message__reply-snippet {
      display: inline-block; min-width: 0; flex: 1 1 auto;
      overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-user { font-weight: 650; opacity: 0.85; }
    /* The deliberate way into Kick's side conversation (T3): a small icon at the line's right end. */
    #${OWN_LIST_ID2} .kickflow-message__thread-open {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; margin-left: auto; padding-left: 0; border-radius: 3px;
      color: var(--kf-ink-3); cursor: pointer;
    }
    #${OWN_LIST_ID2} .kickflow-message__thread-open[hidden] { display: none; }
    #${OWN_LIST_ID2} .kickflow-message__thread-open:hover { color: var(--kf-ink); background: rgba(255,255,255,0.08); }
    #${OWN_LIST_ID2} .kickflow-message__thread-open:focus-visible { outline: 2px solid var(--kf-green); outline-offset: -2px; }
    #${OWN_LIST_ID2} .kickflow-message__thread-open svg { width: 13px; height: 13px; }

    /* --- Removed messages: kept in place, struck once, with a stamp band above them. --- */
    #${OWN_LIST_ID2} .kickflow-preserved { opacity: 1; }
    #${OWN_LIST_ID2} .kickflow-preserved .kickflow-message__identity { display: inline; }
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
    #${OWN_LIST_ID2} .kickflow-preserved .kickflow-message__content,
    .kickflow-original-content > span:last-child {
      color: var(--kf-ink-2); text-decoration: line-through; text-decoration-thickness: 1.5px;
      text-decoration-color: color-mix(in srgb, var(--kf-cut) 75%, transparent);
    }
    /* The stamp: what happened, how long, by whom. Text arrives upper-case from i18n; no
       text-transform here, because a lower-cased "TIMEOUT" on a Turkish page reads "t\u0131meout". */
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
    #${OWN_LIST_ID2} .kickflow-badge-text,
    #${OWN_LIST_ID2} .kickflow-badge-role,
    #${OWN_LIST_ID2} .kickflow-badge-role__count { font-size: 12px; }

    /* --- Events: no cards. A neutral gutter, a line glyph, names in ink. --- */
    #${OWN_LIST_ID2} .kickflow-event-row {
      display: flex; align-items: baseline; gap: 0; margin: 2px 0;
      border: 0; border-radius: 4px;
      padding: 5px 6px 5px 10px; background: transparent; color: var(--kf-ink-2);
    }
    #${OWN_LIST_ID2} .kickflow-event-row::before {
      content: ''; background: var(--kf-line-3);
    }
    #${OWN_LIST_ID2} .kickflow-event-row--gifted-subscription,
    #${OWN_LIST_ID2} .kickflow-event-row--subscription,
    #${OWN_LIST_ID2} .kickflow-event-row--kicks,
    #${OWN_LIST_ID2} .kickflow-event-row--celebration { background: linear-gradient(90deg, rgba(83,252,24,0.05), transparent 75%); }
    #${OWN_LIST_ID2} .kickflow-event-row--gifted-subscription::before,
    #${OWN_LIST_ID2} .kickflow-event-row--subscription::before,
    #${OWN_LIST_ID2} .kickflow-event-row--kicks::before,
    #${OWN_LIST_ID2} .kickflow-event-row--celebration::before { background: rgba(83,252,24,0.55); }
    #${OWN_LIST_ID2} .kickflow-event-row--celebration {
      align-items: flex-start;
    }
    #${OWN_LIST_ID2} .kickflow-event-row--celebration .kickflow-event-row__body,
    #${OWN_LIST_ID2} .kickflow-celebration__headline,
    #${OWN_LIST_ID2} .kickflow-celebration__message { display: block; min-width: 0; }
    #${OWN_LIST_ID2} .kickflow-celebration__headline { font-weight: 600; }
    #${OWN_LIST_ID2} .kickflow-celebration__message {
      margin-top: 3px; padding: 0 0 0 8px; border-left: 1px solid var(--kf-line-3);
      background: transparent; color: var(--kf-ink);
    }
    #${OWN_LIST_ID2} .kickflow-celebration__author { font-weight: 700; }
    #${OWN_LIST_ID2} .kickflow-event-row__icon { flex: none; margin-right: 8px; color: var(--kf-ink-3); }
    #${OWN_LIST_ID2} .kickflow-event-row svg { display: inline-block; vertical-align: -3px; }
    #${OWN_LIST_ID2} .kickflow-event-row__username,
    #${OWN_LIST_ID2} .kickflow-event-row__count,
    #${OWN_LIST_ID2} .kickflow-event-row__recipient { font-weight: 700; color: var(--kf-ink); }
    #${OWN_LIST_ID2} .kickflow-event-row__count { font-variant-numeric: tabular-nums; }
    #${OWN_LIST_ID2} .kickflow-event-row__more {
      cursor: pointer; text-decoration: underline; text-decoration-color: var(--kf-line-3); text-underline-offset: 2px;
    }
    #${OWN_LIST_ID2} .kickflow-event-row__more:hover { color: var(--kf-ink); }
    /* Connection gap: a rule with the words in the middle. */
    #${OWN_LIST_ID2} .kickflow-event-row--gap {
      display: flex; align-items: center; gap: 10px; padding: 8px 0; margin: 6px 0; border: 0;
      border-radius: 0; background: transparent; color: var(--kf-ink-3); font-size: 12px; text-align: center;
    }
    #${OWN_LIST_ID2} .kickflow-event-row--gap::before,
    #${OWN_LIST_ID2} .kickflow-event-row--gap::after {
      content: ''; position: static; flex: 1 1 12px; height: 1px; width: auto; border-radius: 0;
      background: repeating-linear-gradient(90deg, var(--kf-line-3) 0 3px, transparent 3px 6px);
    }
    #${OWN_LIST_ID2} .kickflow-event-row--gap .kickflow-event-row__icon { display: none; }
    #${OVERLAY_ROOT_ID2} [data-kickflow-chat-status] { background: var(--kf-surface); border-top: 1px solid var(--kf-line-2); color: var(--kf-ink-2); font-family: var(--kf-font); }
    #${OVERLAY_ROOT_ID2} [data-kickflow-chat-status] button {
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
    /* Paused chat: Kick's own button shape (6px radius, like "G\xF6nder"), so it reads as part of the page. */
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
    #${OWN_LIST_ID2} .kickflow-message__badges .kickflow-badge-icon {
      width: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
      height: calc(var(--chatroom-font-size, 13px) * (18 / 13)) !important;
    }
    #${OWN_LIST_ID2} .kickflow-message__badges .kickflow-badge-role {
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
    #${OWN_LIST_ID2} .kickflow-emote-box {
      width: calc(var(--chatroom-font-size, 13px) * (28 / 13)); height: 1.2em;
      margin: 0 1px;
    }
    #${OWN_LIST_ID2} .kickflow-emote {
      width: calc(var(--chatroom-font-size, 13px) * (28 / 13)) !important;
      height: calc(var(--chatroom-font-size, 13px) * (28 / 13)) !important;
    }
    /* Reply snippets keep a compact 16px box even though ordinary message emotes scale with
       Kick's chat-size token. */
    #${OWN_LIST_ID2} .kickflow-message__reply-snippet .kickflow-emote-box {
      width: 16px; height: 16px; vertical-align: -4px; margin: 0 1px;
    }
    #${OWN_LIST_ID2} .kickflow-message__reply-snippet .kickflow-emote {
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
    /* Preserved (deleted/banned) rows: hide the native content entirely \u2014 Kick may leave the
       original text OR swap in a "Deleted by a moderator" placeholder \u2014 and show our stored copy. */
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
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action {
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
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action::before {
      content: ''; background: repeating-linear-gradient(180deg, var(--kickflow-modaction-accent) 0 4px, transparent 4px 7px);
    }
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__icon { display: none; }
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__moderator {
      color: var(--kickflow-modaction-moderator-color);
    }
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__count,
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__duration,
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__more,
    #${OWN_LIST_ID2} .kickflow-event-row--mod-action .kickflow-event-row__remainder {
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
      .kickflow-panel__shell, .kickflow-panel__hotkey-chip--capturing, #${OWN_LIST_ID2} .kickflow-message--jump-highlight { animation: none; }
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
       label already says live ("\u0130kinci CANLI yok"). It is the LAST item of our plate, so when it
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
       Declared here: the thumb's placement and hover reveal, and the hover thickening \u2014 all of
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
    /* The overflow ("Di\u011Fer") menu holds the REAL control elements as rows, each with its name
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
  function installStyleSheet(css) {
    const adopted = document.adoptedStyleSheets;
    if (adopted && typeof CSSStyleSheet === "function") {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...adopted, sheet];
        return sheet;
      } catch (error) {
        logger.info("bootstrap: constructable stylesheet unavailable, falling back to <style>", error);
      }
    }
    if (document.getElementById(FALLBACK_STYLE_ID)) return null;
    const style = document.createElement("style");
    style.id = FALLBACK_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
    return null;
  }
  function removeStyles() {
    if (!stylesInstalled) return;
    stylesInstalled = false;
    const sheet = adoptedStyleSheet;
    adoptedStyleSheet = null;
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((entry) => entry !== sheet);
      return;
    }
    document.getElementById(FALLBACK_STYLE_ID)?.remove();
  }
  function initNativeChatIntegrity(context, lifecycle, panel) {
    const { slug } = context;
    setSubscriberBadges([]);
    configureUserCardSession(slug);
    const archive = new UserMessageArchive();
    configureUserMessageArchive(archive);
    lifecycle.add(() => {
      configureUserMessageArchive(null);
      configureUserCardSession(null);
    });
    let augmenter = null;
    const pausePill = new NativePausePillCounter(lifecycle);
    const store = new ChatIntegrityStore({
      onPreservedEvicted: (message2) => {
        augmenter?.forgetGhost(message2.id);
        augmenter?.markById(message2.id);
      },
      onMessageAdded: (message2) => {
        pausePill.noteMessage();
        archive.add(message2);
        if (message2.preserved) archive.markDeleted(message2.id);
      },
      onMessagePreserved: (message2) => archive.markDeleted(message2.id)
    });
    augmenter = new NativeChatAugmenter(lifecycle, store);
    setHighlightStore(store);
    lifecycle.add(() => setHighlightStore(null));
    syncHighlightCssVars();
    panel.setStore(store);
    lifecycle.add(() => panel.setStore(null));
    initActiveChattersBadgesSession(lifecycle, store, panel);
    new FooterToggleButton(lifecycle, panel);
    const renderNativeModAction = (notice) => {
      augmenter?.showModActionNotice(notice, {
        onJump: jumpToChatMessage,
        onOpenPanel: () => panel.showSettings("removed")
      });
    };
    initModActionNotificationsSession(context, lifecycle, {
      onNotice: renderNativeModAction,
      onNoticeUpdated: renderNativeModAction,
      clear: () => augmenter?.clearModActionNotices()
    });
    lifecycle.setInterval(() => {
      store.sweepExpiredPreserved();
      archive.sweepExpired();
    }, PRESERVED_SWEEP_INTERVAL_MS);
    if (context.kind === "vod") {
      setStatus({
        active: true,
        pusherConnected: false,
        reason: t("status.active_native_replay")
      });
      startNativeVodArchiveFeed(context, lifecycle, store);
      return;
    }
    resolveChannel(slug).then((resolved) => {
      if (lifecycle.isDisposed) return;
      if (!resolved) {
        logger.warn("bootstrap: could not resolve channel for", slug, "- chat integrity inactive, native chat stays visible");
        setStatus({ reason: t("status.chatroom_unresolved") });
        return;
      }
      setSubscriberBadges(resolved.subscriberBadges);
      const { chatroomId, channelId } = resolved;
      setStatus({ chatroomId, reason: t("status.pusher_connecting") });
      const client = new PusherClient(chatroomId, channelId, {
        onConnected: () => {
          setStatus({ reason: t("status.socket_waiting") });
        },
        onPrimarySubscriptionReady: () => {
          setStatus({ pusherConnected: true, active: true, reason: t("status.active_native") });
        },
        onPrimarySubscriptionUnavailable: () => {
          setStatus({ pusherConnected: false, active: false, reason: t("status.subscription_waiting_native") });
        },
        onDisconnected: () => {
          setStatus({ pusherConnected: false });
        },
        onMessage: (message2) => {
          store.addMessage(message2);
        },
        onUserBanned: (payload) => {
          setStatus({ lastBanAt: Date.now() });
          handleUserBanned(payload, {
            store,
            augmenter,
            onModAction: (action) => pushModActionForSession(lifecycle, action)
          });
        },
        onMessageDeleted: (payload) => {
          handleMessageDeleted(payload, {
            store,
            augmenter,
            onModAction: (action) => pushModActionForSession(lifecycle, action)
          });
        }
      });
      lifecycle.add(() => {
        client.dispose();
        setStatus({ pusherConnected: false });
      });
      client.connect();
    });
  }
  function startNativeVodArchiveFeed(context, lifecycle, store) {
    void resolveChannel(context.slug).then((resolved) => {
      if (lifecycle.isDisposed || !resolved) return;
      const replay = new VodChatReplayController(
        lifecycle,
        resolved.channelId,
        context.videoId,
        {
          onReset: () => void 0,
          onMessages: (messages2) => {
            let archived = 0;
            for (const message2 of messages2) {
              if (store.addMessage(message2)) archived += 1;
            }
            logger.debug("vod-archive-feed: archived", archived, "of", messages2.length);
          },
          onReady: () => void 0,
          onUnavailable: () => void 0
        }
      );
      void replay.start();
    });
  }
  function reconcileOwnPreservedEviction(message2, store, registry) {
    const element = registry.getElementForMessageId(message2.id);
    if (!element) return;
    if (store.getMessageById(message2.id) === message2) {
      clearPreservedMarking(element);
      return;
    }
    registry.forget(element);
    element.remove();
  }
  function initOwnChatIntegrity(context, lifecycle, panel) {
    startChatWithRetries(lifecycle, (attempt, controls) => initOwnChatAttempt(context, attempt, panel, controls));
  }
  function initOwnChatAttempt(context, lifecycle, panel, startup) {
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
      onPreservedEvicted: (message2) => reconcileOwnPreservedEviction(message2, store, registry),
      onMessageAdded: (message2) => {
        archive.add(message2);
        if (message2.preserved) archive.markDeleted(message2.id);
      },
      onMessagePreserved: (message2) => archive.markDeleted(message2.id)
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
    installNativeThreadPanel(lifecycle, (messageId, cue) => {
      jumpToMessage(messageId, cue);
    });
    let wasReady = false;
    const markReady = () => {
      if (mount.state !== "active") return;
      wasReady = true;
      startup.ready();
    };
    const ownList = mount.ownList;
    const scrollPill = document.createElement("button");
    scrollPill.type = "button";
    scrollPill.className = "kickflow-scroll-pill";
    scrollPill.textContent = t("chat.new_messages");
    scrollPill.style.display = "none";
    scrollPill.style.pointerEvents = "auto";
    const hoverMeter = context.kind === "live" ? new HoverReleaseMeter() : null;
    let hovered = false;
    let renderQueue = null;
    let pendingCount = 0;
    let scrollFollow;
    let pillShownAtMs = 0;
    let pillHideTimerId = null;
    const resolveModeAScrollFollowBehavior = (isHovered) => {
      if (!isHovered) return "auto";
      return featureFlags.hoverFollowMode === "instant" ? "auto" : "smooth";
    };
    const cancelPillHide = () => {
      if (pillHideTimerId === null) return;
      window.clearTimeout(pillHideTimerId);
      pillHideTimerId = null;
    };
    lifecycle.add(cancelPillHide);
    const hidePendingPill = () => {
      scrollPill.textContent = t("chat.new_messages");
      scrollPill.style.display = "none";
    };
    const schedulePillHide = () => {
      if (pillHideTimerId !== null) return;
      const remaining = Math.max(0, PILL_MIN_VISIBLE_MS - (Date.now() - pillShownAtMs));
      pillHideTimerId = window.setTimeout(() => {
        pillHideTimerId = null;
        if (pendingCount > 0 && hovered && scrollFollow.isPinned) return;
        hidePendingPill();
      }, remaining);
    };
    function updatePendingPill(nextCount) {
      pendingCount = nextCount;
      if (!hoverMeter) return;
      const pinned = scrollFollow.isPinned;
      const visible = scrollPill.style.display !== "none";
      if (pinned && nextCount > 0 && (visible || hovered && nextCount >= PILL_MIN_PENDING)) {
        cancelPillHide();
        scrollPill.textContent = t("chat.new_messages_count", {
          n: nextCount,
          count: formatNumber(nextCount)
        });
        if (!visible) pillShownAtMs = Date.now();
        scrollPill.style.display = "";
        return;
      }
      if (pinned && visible) schedulePillHide();
    }
    scrollFollow = new ScrollFollowController(ownList, {
      onPinnedChange: (pinned) => {
        if (pinned) scrollPill.style.display = "none";
        hoverMeter?.setMetered(hovered && pinned);
        renderQueue?.wake();
        if (pinned) updatePendingPill(renderQueue?.pendingCount ?? pendingCount);
      },
      getScrollFollowBehavior: () => resolveModeAScrollFollowBehavior(hovered)
    });
    lifecycle.add(() => scrollFollow.dispose());
    const hoverFollow = attachScrollFollowHover(ownList, scrollFollow, {
      hoverContinuationSelector: ".kickflow-user-card, [data-kickflow-native-quick-emotes]",
      getHoveredBehavior: () => resolveModeAScrollFollowBehavior(true),
      onHoverChange: (nextHovered) => {
        hovered = nextHovered;
        hoverMeter?.setMetered(nextHovered && scrollFollow.isPinned);
        renderQueue?.wake();
        updatePendingPill(renderQueue?.pendingCount ?? pendingCount);
      },
      onPointerLeave: hoverMeter ? () => renderQueue?.flushPending() : void 0
    });
    lifecycle.add(() => hoverFollow.dispose());
    scrollPill.addEventListener("click", () => {
      renderQueue?.flushPending();
      scrollFollow.scrollToBottom();
      scrollPill.style.display = "none";
    });
    mount.root.appendChild(scrollPill);
    lifecycle.add(() => scrollPill.remove());
    let vodStartTimeMs = null;
    const queue = new RenderQueue({
      getContainer: () => mount.getRenderContainer(),
      registry,
      releasePolicy: hoverMeter ?? void 0,
      // A delete can arrive while its ChatMessageEvent is waiting in RenderQueue's 250ms batch.
      // Only render objects that this session's store still owns: this drops those removed-before-
      // flush rows and also prevents a replayed Pusher/history id from creating a duplicate row.
      shouldRender: (message2) => store.getMessageById(message2.id) === message2,
      onOpenRemovedPanel: () => panel.showSettings("removed"),
      onReply: context.kind === "live" ? (message2, cue) => {
        if (!lifecycle.isDisposed) requestNativeReply(message2, cue, context.sessionKey);
      } : void 0,
      onPendingChange: updatePendingPill,
      formatTimestamp: context.kind === "vod" ? (message2) => vodStartTimeMs === null ? "" : formatVodReplayTimestamp(message2.createdAt, vodStartTimeMs) : void 0,
      onFlush: (appended) => {
        mount.noteContentAppended(appended);
        if (mount.state === "active") {
          markReady();
          setStatus({
            active: true,
            pusherConnected: context.kind === "live" ? getStatus().pusherConnected : false,
            reason: context.kind === "vod" ? t("status.active_vod_replay") : t("status.active_own")
          });
        }
        const decision = hoverFollow.decide(appended.length);
        const snapsAfterTrim = () => decision.scrollToBottom && decision.scrollBehavior === "auto" && scrollFollow.isPinned;
        scrollFollow.preserveScrollIntent(() => trimMessageWindow(ownList, registry, decision.trimCap, () => !snapsAfterTrim()));
        scrollFollow.observeRows(appended);
        hoverFollow.apply(decision);
        if (decision.showPill) {
          scrollPill.textContent = t("chat.new_messages");
          scrollPill.style.display = "";
        } else if (decision.scrollToBottom && (hoverMeter === null || !hovered || renderQueue?.pendingCount === 0)) {
          scrollPill.style.display = "none";
        }
      }
    });
    renderQueue = queue;
    lifecycle.add(() => queue.dispose());
    lifecycle.setInterval(() => {
      store.sweepExpiredPreserved();
      archive.sweepExpired();
    }, PRESERVED_SWEEP_INTERVAL_MS);
    const enqueueOnce = (message2) => {
      if (store.addMessage(message2)) queue.enqueue(message2);
    };
    const updateSystemEvent = (message2) => {
      const nextEvent = message2.systemEvent;
      if (!nextEvent || nextEvent.kind !== "mod-action") {
        enqueueOnce(message2);
        return;
      }
      const existing = store.getMessageById(message2.id);
      if (!existing) {
        enqueueOnce(message2);
        return;
      }
      if (!existing.systemEvent || existing.systemEvent.kind !== "mod-action") return;
      existing.systemEvent = nextEvent;
      const element = registry.getElementForMessageId(message2.id);
      if (!element) return;
      const replacement = buildMessageElement(existing, {
        onOpenRemovedPanel: () => panel.showSettings("removed")
      });
      registry.forget(element);
      element.replaceWith(replacement);
      registry.register(replacement, existing);
    };
    const systemEventCallbacks = createSystemEventCallbacks(enqueueOnce, updateSystemEvent);
    initModActionNotificationsSession(context, lifecycle, {
      onNotice: systemEventCallbacks.onModAction,
      onNoticeUpdated: systemEventCallbacks.onModActionUpdated,
      clear: () => void 0
    });
    const failed = () => startup.fail(() => {
      mount.showFailure();
      setStatus({ active: false, reason: t("status.content_not_ready") });
    });
    const start = () => {
      void resolveChannel(slug, lifecycle).then(async (resolved) => {
        if (lifecycle.isDisposed) return;
        if (!resolved) {
          logger.warn("bootstrap: could not resolve channel for", slug, "- chat integrity inactive, native chat stays visible");
          mount.failOpen("channel-resolution-failed");
          failed();
          setStatus({ active: false, reason: t("status.chatroom_unresolved_native") });
          return;
        }
        setSubscriberBadges(resolved.subscriberBadges);
        const { chatroomId, channelId } = resolved;
        lifecycle.setTimeout(() => {
          if (!wasReady && mount.state !== "active") {
            mount.failOpen("startup-not-ready");
            failed();
          }
        }, INITIAL_NO_CONTENT_FALLBACK_MS);
        setStatus({
          chatroomId,
          pusherConnected: false,
          reason: context.kind === "vod" ? t("status.vod_replay_loading") : t("status.pusher_connecting")
        });
        if (context.kind === "vod") {
          const resetReplayWindow = () => {
            queue.clearPending();
            store.reset();
            registry.clear();
            for (const row of ownList.querySelectorAll(
              ".kickflow-message, .kickflow-event-row"
            )) {
              row.remove();
            }
            scrollPill.style.display = "none";
            mount.setReplayLoading();
            setStatus({
              active: mount.state === "active",
              pusherConnected: false,
              reason: t("status.vod_replay_loading")
            });
          };
          const replay = new VodChatReplayController(
            lifecycle,
            channelId,
            context.videoId,
            {
              onReset: resetReplayWindow,
              onMessages: (messages2, startTimeMs) => {
                vodStartTimeMs = startTimeMs;
                for (const message2 of messages2) enqueueOnce(message2);
              },
              onReady: () => {
                mount.setReplayReady();
                markReady();
                setStatus({
                  active: mount.state === "active",
                  pusherConnected: false,
                  reason: t("status.active_vod_replay")
                });
              },
              onUnavailable: () => {
                mount.failOpen("vod-replay-unavailable");
                failed();
                setStatus({
                  active: false,
                  pusherConnected: false,
                  reason: t("status.vod_replay_failed_native")
                });
              }
            }
          );
          void replay.start();
          return;
        }
        let primaryReady = false;
        let hasPrimaryReadyOnce = false;
        let reconnectGraceTimer = null;
        let outage = null;
        let historyLoaded = false;
        const clearReconnectGrace = () => {
          if (reconnectGraceTimer === null) return;
          window.clearTimeout(reconnectGraceTimer);
          reconnectGraceTimer = null;
        };
        lifecycle.add(clearReconnectGrace);
        const historyBackfill = new ChatHistoryBackfill(channelId, {
          isDisposed: () => lifecycle.isDisposed,
          onMessages: (history) => {
            const times = Array.from(ownList.querySelectorAll("[data-created-at]")).map((row) => Date.parse(row.dataset.createdAt)).filter(Number.isFinite);
            const oldest = historyLoaded && times.length > 0 ? Math.min(...times) : null;
            const plan = planBackfill(history, oldest, outage);
            if (plan.gap && outage) {
              const gap = plan.gap;
              enqueueOnce({
                id: `gap:${outage.lastId}`,
                chatroomId,
                type: "system",
                createdAt: new Date(Math.max(gap.at, oldest ?? gap.at)).toISOString(),
                content: "",
                sender: { id: 0, username: "KickFlow", slug: "kickflow", identity: { color: "", badges: [], badgesV2: [] } },
                preserved: false,
                systemEvent: { kind: "gap", estimatedCount: gap.count, seconds: gap.seconds }
              });
            }
            outage = null;
            historyLoaded = true;
            for (const message2 of plan.messages) {
              enqueueOnce({ ...message2, chatroomId });
            }
          },
          onResult: (result) => {
            if (result.status === "success") {
              if (result.messages.length === 0 && !primaryReady && mount.state !== "active") {
                setStatus({ reason: t("status.history_empty") });
              }
              return;
            }
            if (mount.state !== "active") {
              setStatus({ reason: t("status.history_failed") });
            }
          }
        });
        historyBackfill.request();
        const client = new PusherClient(chatroomId, channelId, {
          onConnected: () => {
            if (!getStatus().active) setStatus({ reason: t("status.socket_waiting") });
          },
          onPrimarySubscriptionReady: () => {
            primaryReady = true;
            clearReconnectGrace();
            mount.setPrimaryReady();
            markReady();
            setStatus({
              pusherConnected: true,
              active: mount.state === "active",
              reason: mount.state === "active" ? t("status.active_ready") : t("status.chatroom_ready_waiting")
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
              reason: t("status.primary_unavailable", { reason })
            });
          },
          onDisconnected: () => {
            outage ??= captureOutage(store.getMessagesInArrivalOrder());
            const keepDuringGrace = mount.state === "active";
            primaryReady = false;
            setStatus({ pusherConnected: false });
            if (!keepDuringGrace) return;
            mount.setReconnecting();
            setStatus({ active: true, reason: t("status.reconnecting") });
            clearReconnectGrace();
            reconnectGraceTimer = window.setTimeout(() => {
              reconnectGraceTimer = null;
              if (primaryReady || lifecycle.isDisposed) return;
              mount.setPrimaryUnavailable("primary-reconnect-grace-expired");
              failed();
              setStatus({ active: false, reason: t("status.reconnect_failed") });
            }, PRIMARY_RECONNECT_GRACE_MS);
          },
          onMessage: (message2) => {
            enqueueOnce(message2);
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
              onModAction: (action) => pushModActionForSession(lifecycle, action)
            });
          },
          onMessageDeleted: (payload) => {
            handleMessageDeleted(payload, {
              store,
              registry,
              onModAction: (action) => pushModActionForSession(lifecycle, action)
            });
          }
        });
        lifecycle.add(() => {
          client.dispose();
          setStatus({ pusherConnected: false });
        });
        client.connect();
      }).catch((error) => {
        if (lifecycle.isDisposed) return;
        logger.warn("bootstrap: chat startup attempt failed", error);
        mount.failOpen("startup-exception");
        failed();
      });
    };
    mount.setRetryHandler(startup.retry);
    start();
  }
  function initChatIntegrity(context, lifecycle, panel = getSiteSettingsPanel()) {
    if (featureFlags.chatMode === "own") {
      initOwnChatIntegrity(context, lifecycle, panel);
    } else {
      initNativeChatIntegrity(context, lifecycle, panel);
    }
  }
  var playerFeatureInitializers = {
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
    channelVolume: initChannelVolume
  };
  var playerSessionLifecycle = null;
  var playerFeatureLifecycles = /* @__PURE__ */ new Map();
  function playerFeatureEnabled(key) {
    return key === "qualityLock" ? featureFlags.qualityLock || featureFlags.qualityAlwaysBest : featureFlags[key];
  }
  var qualityControllerChip = null;
  function syncPlayerFeature(key) {
    const session = playerSessionLifecycle;
    let active = playerFeatureLifecycles.get(key);
    const liveOnlyOnRecording = key === "liveCatchup" && parseChatSessionContext(window.location.pathname)?.kind === "vod";
    if (!playerFeatureEnabled(key) || !session || session.isDisposed || liveOnlyOnRecording) {
      active?.dispose();
      playerFeatureLifecycles.delete(key);
      return;
    }
    if (key === "qualityLock" && active && !active.isDisposed && qualityControllerChip !== featureFlags.qualityLock) {
      active.dispose();
      playerFeatureLifecycles.delete(key);
      active = void 0;
    }
    if (active && !active.isDisposed) return;
    if (key === "qualityLock") qualityControllerChip = featureFlags.qualityLock;
    const featureLifecycle = new Lifecycle();
    playerFeatureLifecycles.set(key, featureLifecycle);
    shareNativeBarMountManager(featureLifecycle, session);
    playerFeatureInitializers[key](featureLifecycle);
  }
  function disposePlayerFeatures() {
    for (const lifecycle of playerFeatureLifecycles.values()) lifecycle.dispose();
    playerFeatureLifecycles.clear();
    playerSessionLifecycle = null;
  }
  function initPlayerQolSession(lifecycle) {
    if (!getVideoElement()) {
      logger.debug("bootstrap: #video-player not present yet, player QoL module waiting");
    }
    whenElementPresent(
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
      { resolve: getVideoElement }
    );
  }
  var currentLifecycle = null;
  var activeQuickEmoteBar = null;
  var currentSessionContext = null;
  var sessionToken = 0;
  var navPollId = null;
  var navigationInitialized = false;
  var siteLifecycleServices = null;
  function initSiteLifecycle() {
    if (siteLifecycleServices && !siteLifecycleServices.lifecycle.isDisposed) return siteLifecycleServices;
    const lifecycle = new Lifecycle();
    ensureStyles2();
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
  function getSiteSettingsPanel() {
    return initSiteLifecycle().panel;
  }
  function disposeSiteLifecycle() {
    const services = siteLifecycleServices;
    siteLifecycleServices = null;
    services?.lifecycle.dispose();
  }
  function syncLayoutWatchdog() {
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
  var activeChattersBadgesContext = null;
  var activeModActionNotificationsContext = null;
  function stopModActionNotifications() {
    const context = activeModActionNotificationsContext;
    if (!context) return;
    const lifecycle = context.featureLifecycle;
    context.featureLifecycle = null;
    context.feed = null;
    context.renderer.clear();
    lifecycle?.dispose();
  }
  function jumpToChatMessage(messageId, missCueElement) {
    if (jumpToMessage(messageId, missCueElement)) return;
    const nativeRow = Array.from(document.querySelectorAll("#chatroom-messages [data-kickflow-mid]")).find((element) => element.dataset.kickflowMid === messageId);
    nativeRow?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
  function pushModActionForSession(sessionLifecycle, action) {
    const context = activeModActionNotificationsContext;
    if (!context || context.sessionLifecycle !== sessionLifecycle || !context.feed || !featureFlags.showModActions) return;
    context.feed.push(action);
  }
  function syncModActionNotifications() {
    const context = activeModActionNotificationsContext;
    if (!context || context.sessionLifecycle.isDisposed || context.chatContext.kind === "vod" || !featureFlags.showModActions) {
      stopModActionNotifications();
      return;
    }
    if (context.featureLifecycle && !context.featureLifecycle.isDisposed) return;
    const lifecycle = new Lifecycle();
    const feed = new ModActionFeed({
      onNotice: context.renderer.onNotice,
      onNoticeUpdated: context.renderer.onNoticeUpdated
    });
    context.featureLifecycle = lifecycle;
    context.feed = feed;
    lifecycle.add(() => feed.dispose());
  }
  function initModActionNotificationsSession(chatContext, sessionLifecycle, renderer) {
    stopModActionNotifications();
    activeModActionNotificationsContext = null;
    if (chatContext.kind === "vod") return;
    const context = {
      sessionLifecycle,
      chatContext,
      renderer,
      featureLifecycle: null,
      feed: null
    };
    activeModActionNotificationsContext = context;
    sessionLifecycle.add(() => {
      if (activeModActionNotificationsContext !== context) return;
      stopModActionNotifications();
      activeModActionNotificationsContext = null;
    });
    syncModActionNotifications();
  }
  function stopActiveChattersBadges() {
    const context = activeChattersBadgesContext;
    if (!context) return;
    const lifecycle = context.featureLifecycle;
    context.featureLifecycle = null;
    context.controller = null;
    lifecycle?.dispose();
  }
  function syncActiveChattersBadges() {
    const context = activeChattersBadgesContext;
    if (!context || context.sessionLifecycle.isDisposed || !featureFlags.showChattersBadges) {
      stopActiveChattersBadges();
      return;
    }
    if (context.featureLifecycle && !context.featureLifecycle.isDisposed) return;
    ensureStyles2();
    const lifecycle = new Lifecycle();
    context.featureLifecycle = lifecycle;
    context.controller = new ActiveChattersBadgesController(lifecycle, context.store, context.panel);
  }
  function initActiveChattersBadgesSession(sessionLifecycle, store, panel) {
    stopActiveChattersBadges();
    const context = {
      sessionLifecycle,
      store,
      panel,
      featureLifecycle: null,
      controller: null
    };
    activeChattersBadgesContext = context;
    sessionLifecycle.add(() => {
      if (activeChattersBadgesContext !== context) return;
      stopActiveChattersBadges();
      activeChattersBadgesContext = null;
    });
    syncActiveChattersBadges();
  }
  function onPopstate() {
    window.dispatchEvent(new Event("kickflow:locationchange"));
  }
  function startSession(context) {
    const { slug } = context;
    const token = ++sessionToken;
    const panel = getSiteSettingsPanel();
    document.getElementById("kickflow-chat-overlay")?.remove();
    document.documentElement.classList.remove("kickflow-chat-active");
    configureUserCardSession(null);
    const lifecycle = new Lifecycle();
    currentLifecycle = lifecycle;
    activeQuickEmoteBar = new NativeQuickEmoteBar(lifecycle, () => featureFlags.hideQuickEmoteBar);
    lifecycle.add(() => {
      activeQuickEmoteBar = null;
    });
    initPlayerQolSession(lifecycle);
    if (!document.querySelector(SELECTORS.chatMessagesContainer)) {
      logger.debug("bootstrap:", SELECTORS.chatMessagesContainer, "not present yet for", slug, "- chat integrity module waiting");
      setStatus({ reason: t("status.waiting_chat_panel") });
    }
    whenElementPresent(SELECTORS.chatMessagesContainer, lifecycle, () => {
      if (token !== sessionToken || lifecycle.isDisposed) return;
      initChatIntegrity(context, lifecycle, panel);
    });
  }
  function stopSession() {
    currentLifecycle?.dispose();
    currentLifecycle = null;
  }
  function teardownZombie() {
    window.removeEventListener("popstate", onPopstate);
    window.removeEventListener("kickflow:locationchange", handlePotentialNavigation);
    window.removeEventListener("kickflow:setFlag", onWindowFlagChange);
    if (navPollId !== null) {
      window.clearInterval(navPollId);
      navPollId = null;
    }
    stopSession();
    disposeSiteLifecycle();
    configureUserCardSession(null);
    configureUserMessageArchive(null);
    document.getElementById("kickflow-chat-overlay")?.remove();
    document.querySelector(".kickflow-panel")?.remove();
    document.getElementById("kickflow-footer-toggle")?.remove();
    document.getElementById("kickflow-navbar-settings")?.remove();
    document.documentElement.classList.remove("kickflow-chat-active");
    document.documentElement.removeAttribute(QUALITY_ATTRIBUTE);
    removeStyles();
  }
  function onWindowFlagChange(event) {
    const detail = event.detail;
    if (detail && typeof detail.key === "string") {
      void applyFlagChange(detail.key, detail.value).then((ok) => {
        if (typeof detail.onSaved === "function") detail.onSaved(ok);
      });
    }
  }
  function handlePotentialNavigation() {
    if (!isExtensionContextValid()) {
      teardownZombie();
      return;
    }
    const context = parseChatSessionContext(window.location.pathname);
    const previousSessionKey = currentSessionContext?.sessionKey ?? null;
    const nextSessionKey = context?.sessionKey ?? null;
    if (navigationInitialized && nextSessionKey === previousSessionKey) return;
    navigationInitialized = true;
    logger.debug("bootstrap: chat session changed", previousSessionKey, "->", nextSessionKey);
    stopSession();
    currentSessionContext = context;
    resetStatus(context?.slug ?? null);
    if (context) {
      startSession(context);
    }
  }
  function applyFlagChange(key, value) {
    if (isBooleanFlagKey(key) && typeof value === "boolean") {
      setFeatureFlag(key, value);
      if (key === "hideQuickEmoteBar") activeQuickEmoteBar?.sync();
      if (key === "speedControls" && !value) deactivateSpeedControls();
      if (key === "showDeletedMessages" || key === "preserveBansInline") reconcileActiveNativeChat();
      if (key === "debugLogging") {
        setDebugLogging(value);
        syncLayoutWatchdog();
      }
      if (key === "autoTheater") syncAutoTheaterFlag();
      if (key === "contentBlocking") syncContentBlocking();
      if (key === "fullscreenTerminal" || key === "floatingStrip") syncBarOrderFlag();
      if (key === "autoClaimDrops") syncAutoClaimDropsFlag();
      if (key === "autoClaimDailyReward") syncAutoClaimDailyRewardFlag();
      if (key === "qualityLock") syncQualityAttribute();
      if (key === "qualityAlwaysBest") {
        syncQualityAttribute();
        syncPlayerFeature("qualityLock");
        notifyQualityModeChanged();
      }
      if (isPlayerFeatureFlagKey(key)) syncPlayerFeature(key);
      if (key === "showChattersBadges") {
        syncActiveChattersBadges();
      }
      if (key === "showModActions") {
        syncModActionNotifications();
      }
      if (key === "mentionHighlightEnabled" || key === "modFrameEnabled" || key === "vipFrameEnabled") {
        refreshMessageHighlights();
        reconcileActiveNativeChat();
      }
      return safeStorageSet({ ["kf_flag_" + key]: value });
    } else if (isStringFlagKey(key)) {
      const parsed = parseStringFlag(key, value);
      if (parsed === null) return Promise.resolve(false);
      setFeatureFlag(key, parsed);
      if (key === "chatMode") {
        if (currentSessionContext) {
          stopSession();
          resetStatus(currentSessionContext.slug);
          startSession(currentSessionContext);
        }
      } else if (key === "qualityMode") {
        syncQualityAttribute();
        notifyQualityModeChanged();
      } else if (key === "aspectMode") {
        syncAspectMode();
      } else if (key !== "hoverFollowMode") {
        if (key === "manualUsername") invalidateOwnerIdentityCache();
        refreshMessageHighlights();
        reconcileActiveNativeChat();
      }
      return safeStorageSet({ ["kf_flag_" + key]: parsed });
    }
    return Promise.resolve(false);
  }
  function getPopupFeatureFlags() {
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
      liveNotify: featureFlags.liveNotify
    };
  }
  function countUniqueStatusMessages(selector) {
    const ids = /* @__PURE__ */ new Set();
    let anonymous = 0;
    document.querySelectorAll(selector).forEach((element) => {
      const id = element.dataset.messageId ?? element.dataset.kickflowMid ?? element.dataset.kickflowGhostMid ?? element.dataset.kickflowRemovedMid;
      if (id) ids.add(id);
      else anonymous++;
    });
    return ids.size + anonymous;
  }
  function getLiveStatusSnapshot() {
    const ownList = document.getElementById(OWN_LIST_ID2);
    return {
      ...getStatus(),
      messageCount: ownList ? ownList.querySelectorAll(".kickflow-message").length : document.querySelectorAll("#chatroom-messages [data-index]").length,
      preservedCount: countUniqueStatusMessages(".kickflow-preserved"),
      bannedCount: countUniqueStatusMessages(".kickflow-banned"),
      deletedCount: countUniqueStatusMessages(".kickflow-deleted"),
      ...getActiveNativeChatGhostStats()
    };
  }
  function installStatusBridge() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "kickflow:getStatus") {
        sendResponse({
          ...getLiveStatusSnapshot(),
          flags: getPopupFeatureFlags(),
          hotkeys: getHotkeyBindings()
        });
        return;
      }
      if (msg.type === "kickflow:setHotkey" && HOTKEY_ACTIONS.includes(msg.action) && msg.patch && typeof msg.patch === "object") {
        const patch = {};
        if (typeof msg.patch.enabled === "boolean") patch.enabled = msg.patch.enabled;
        if (typeof msg.patch.key === "string") patch.key = msg.patch.key;
        sendResponse(updateHotkeyBinding(msg.action, patch));
        return;
      }
      if (msg.type === "kickflow:resetHotkeys") {
        sendResponse({ ok: true, bindings: resetHotkeyBindings() });
        return;
      }
      if (msg.type === "kickflow:setFlag" && isBooleanFlagKey(msg.key) && typeof msg.value === "boolean") {
        void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
        return true;
      }
      if (msg.type === "kickflow:setFlag" && msg.key === "chatMode" && (msg.value === "native" || msg.value === "own")) {
        void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
        return true;
      }
      if (msg.type === "kickflow:setFlag" && msg.key === "hoverFollowMode" && (msg.value === "browser-smooth" || msg.value === "instant")) {
        void applyFlagChange(msg.key, msg.value).then((ok) => sendResponse({ ok }));
        return true;
      }
      return void 0;
    });
    window.addEventListener("kickflow:setFlag", onWindowFlagChange);
    chrome.storage.onChanged?.addListener(applyStoredFlagChanges);
  }
  function applyStoredFlagChanges(changes, area) {
    if (area !== "local" || !changes || typeof changes !== "object") return;
    handleBlockListsChange(changes);
    for (const [name, change] of Object.entries(changes)) {
      if (!name.startsWith("kf_flag_")) continue;
      const key = name.slice("kf_flag_".length);
      const value = change?.newValue;
      if (isBooleanFlagKey(key) && typeof value === "boolean") {
        if (featureFlags[key] !== value) void applyFlagChange(key, value);
      } else if (isStringFlagKey(key) && typeof value === "string") {
        const parsed = parseStringFlag(key, value);
        if (parsed !== null && featureFlags[key] !== parsed) void applyFlagChange(key, parsed);
      }
    }
  }
  async function applySavedFlags() {
    const saved = await safeStorageGet([
      ...BOOLEAN_FLAG_KEYS.map((key) => `kf_flag_${key}`),
      ...STRING_FLAG_KEYS.map((key) => `kf_flag_${key}`),
      LEGACY_QUALITY_PREFERENCE_KEY
    ]);
    for (const key of BOOLEAN_FLAG_KEYS) {
      const value = saved[`kf_flag_${key}`];
      if (typeof value === "boolean") setFeatureFlag(key, value);
    }
    for (const key of STRING_FLAG_KEYS) {
      const parsed = parseStringFlag(key, saved[`kf_flag_${key}`]);
      if (parsed !== null) setFeatureFlag(key, parsed);
    }
    await migrateQualityPreference(saved);
  }
  var LEGACY_QUALITY_PREFERENCE_KEY = "kickflow.qualityPreference";
  async function migrateQualityPreference(saved) {
    if (saved.kf_flag_qualityMode === void 0) {
      const mode = normalizeQualityMode(saved[LEGACY_QUALITY_PREFERENCE_KEY]) ?? DEFAULT_QUALITY_MODE;
      setFeatureFlag("qualityMode", mode);
      await safeStorageSet({ kf_flag_qualityMode: mode });
    }
    if (saved[LEGACY_QUALITY_PREFERENCE_KEY] !== void 0) await safeStorageRemove(LEGACY_QUALITY_PREFERENCE_KEY);
  }
  function syncQualityAttribute() {
    const mode = featureFlags.qualityAlwaysBest ? DEFAULT_QUALITY_MODE : featureFlags.qualityMode;
    document.documentElement.setAttribute(QUALITY_ATTRIBUTE, featureFlags.qualityLock || featureFlags.qualityAlwaysBest ? mode : "auto");
  }
  function installNavigationHooks() {
    let lastHref = window.location.href;
    navPollId = window.setInterval(() => {
      if (!isExtensionContextValid()) {
        teardownZombie();
        return;
      }
      const href = window.location.href;
      if (href === lastHref) return;
      lastHref = href;
      window.dispatchEvent(new Event("kickflow:locationchange"));
    }, NAVIGATION_POLL_INTERVAL_MS);
    window.addEventListener("popstate", onPopstate);
    window.addEventListener("kickflow:locationchange", handlePotentialNavigation);
  }
  var PILL_MIN_PENDING = 2;
  var PILL_MIN_VISIBLE_MS = 700;
  function afterPageSettled(mount) {
    scheduleChatStartup(mount);
  }
  async function main() {
    await Promise.all([applySavedFlags(), loadHotkeyBindings(), loadLang()]);
    setAspectModeWriter((mode) => {
      void applyFlagChange("aspectMode", mode);
    });
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
  var bootstrapScope = globalThis;
  if (!bootstrapScope.__kickflowContentStarted) {
    bootstrapScope.__kickflowContentStarted = true;
    void main();
  }
})();
