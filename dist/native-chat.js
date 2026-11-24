"use strict";
(() => {
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
  function parseNativePublication(raw) {
    const push = record(record(decode(raw))?.push);
    const data = record(record(push?.pub)?.data);
    return push && data ? sanitizePublicChatPublication({ channel: push.channel, event: data.event, data: data.data }) : null;
  }

  // src/mainworld/native-chat-bridge.ts
  var BRIDGE_SLOT = /* @__PURE__ */ Symbol.for("kickflow.native-chat-bridge.v1");
  var REALTIME_HOST = /^realtime\.[a-z0-9]+(?:-[a-z0-9]+)*\.platform\.kick\.com$/;
  function isKickRealtimeUrl(raw) {
    if (typeof raw !== "string" && !(raw instanceof URL)) return false;
    try {
      const url = new URL(String(raw));
      return url.protocol === "wss:" && REALTIME_HOST.test(url.hostname) && !url.username && !url.password && !url.port && url.pathname === "/connection/websocket";
    } catch {
      return false;
    }
  }
  function findDescriptor(start, key) {
    for (let proto = start; proto; proto = Object.getPrototypeOf(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor) return descriptor;
    }
    return void 0;
  }
  function installNativeChatBridge(target = window) {
    const state = target;
    const existing = state[BRIDGE_SLOT];
    if (existing) return existing;
    const proto = target.WebSocket.prototype;
    const ownAdd = Object.getOwnPropertyDescriptor(proto, "addEventListener");
    const baseAdd = findDescriptor(proto, "addEventListener")?.value;
    const ownOnMessage = Object.getOwnPropertyDescriptor(proto, "onmessage");
    const onMessageDescriptor = findDescriptor(proto, "onmessage");
    const cleanups = /* @__PURE__ */ new Set();
    const seen = /* @__PURE__ */ new WeakSet();
    let nextSocketId = 0;
    let disposed = false;
    const publish = (signal) => {
      if (!disposed) target.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: signal }));
    };
    const observe = (socket) => {
      if (disposed || seen.has(socket)) return;
      seen.add(socket);
      let url;
      try {
        url = socket.url;
      } catch {
        return;
      }
      if (!isKickRealtimeUrl(url)) return;
      const socketId = ++nextSocketId;
      const onMessage = (event) => {
        if (disposed || typeof event.data !== "string") return;
        for (const raw of event.data.split("\n")) {
          const publication = parseNativePublication(raw);
          if (publication) {
            publish({ kind: "publication", socketId, publication });
            continue;
          }
          try {
            const push = record(record(JSON.parse(raw))?.push);
            if (push?.unsubscribe && isPublicChatChannel(push.channel)) {
              publish({ kind: "unavailable", socketId, channel: push.channel });
            }
          } catch {
          }
        }
      };
      const cleanup = () => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onClose);
        cleanups.delete(cleanup);
      };
      const onClose = () => {
        publish({ kind: "unavailable", socketId });
        cleanup();
      };
      cleanups.add(cleanup);
      baseAdd.call(socket, "message", onMessage);
      baseAdd.call(socket, "close", onClose);
      baseAdd.call(socket, "error", onClose);
    };
    Object.defineProperty(proto, "addEventListener", {
      configurable: true,
      writable: true,
      enumerable: ownAdd?.enumerable ?? false,
      value: function addEventListener(...args) {
        observe(this);
        return baseAdd.apply(this, args);
      }
    });
    const setOnMessage = onMessageDescriptor?.set;
    if (setOnMessage && onMessageDescriptor?.configurable !== false) {
      Object.defineProperty(proto, "onmessage", {
        configurable: true,
        enumerable: onMessageDescriptor.enumerable,
        get: onMessageDescriptor.get,
        set(value) {
          observe(this);
          setOnMessage.call(this, value);
        }
      });
    }
    const restore = (key, own) => {
      if (own) Object.defineProperty(proto, key, own);
      else delete proto[key];
    };
    const teardown = () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      restore("addEventListener", ownAdd);
      if (setOnMessage && onMessageDescriptor?.configurable !== false) restore("onmessage", ownOnMessage);
      if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
    };
    state[BRIDGE_SLOT] = teardown;
    return teardown;
  }

  // src/mainworld/native-chat-entry.ts
  installNativeChatBridge();
})();
