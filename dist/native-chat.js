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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3NoYXJlZC9uYXRpdmUtY2hhdC50cyIsICIuLi9zcmMvbWFpbndvcmxkL25hdGl2ZS1jaGF0LWJyaWRnZS50cyIsICIuLi9zcmMvbWFpbndvcmxkL25hdGl2ZS1jaGF0LWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKiogUHVibGljIHJlYWx0aW1lIGJvdW5kYXJ5LiBEbyBub3QgYWRkIGNvbm5lY3Rpb24sIGF1dGggb3IgYXJiaXRyYXJ5IHBhY2tldCBmaWVsZHMgaGVyZS4gKi9cclxuZXhwb3J0IGNvbnN0IE5BVElWRV9DSEFUX0VWRU5UID0gJ2tpY2tmbG93Om5hdGl2ZS1wdWJsaWNhdGlvbi12MSc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFB1YmxpY0NoYXRQdWJsaWNhdGlvbiB7XHJcbiAgY2hhbm5lbDogc3RyaW5nO1xyXG4gIGV2ZW50OiBzdHJpbmc7XHJcbiAgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIE5hdGl2ZUNoYXRTaWduYWwgPVxyXG4gIHwgeyBraW5kOiAncHVibGljYXRpb24nOyBzb2NrZXRJZDogbnVtYmVyOyBwdWJsaWNhdGlvbjogUHVibGljQ2hhdFB1YmxpY2F0aW9uIH1cclxuICB8IHsga2luZDogJ3VuYXZhaWxhYmxlJzsgc29ja2V0SWQ6IG51bWJlcjsgY2hhbm5lbD86IHN0cmluZyB9O1xyXG5cclxudHlwZSBTY2hlbWEgPSB7IHJlYWRvbmx5IFtrZXk6IHN0cmluZ106IHRydWUgfCBTY2hlbWEgfCByZWFkb25seSBbU2NoZW1hXSB9O1xyXG5jb25zdCBhY3RvcjogU2NoZW1hID0geyBpZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIGRpc3BsYXlfbmFtZTogdHJ1ZSwgc2x1ZzogdHJ1ZSwgbmFtZTogdHJ1ZSB9O1xyXG5jb25zdCBiYWRnZTogU2NoZW1hID0ge1xyXG4gIHR5cGU6IHRydWUsIG5hbWU6IHRydWUsIHRleHQ6IHRydWUsIGNvdW50OiB0cnVlLCBpbWFnZV91cmw6IHRydWUsIGFjdGl2ZTogdHJ1ZSxcclxuICBzZWxlY3RlZDogdHJ1ZSwgc29ydF9vcmRlcjogdHJ1ZSwgbWV0YWRhdGE6IHsgbGV2ZWw6IHRydWUgfSxcclxufTtcclxuY29uc3QgbWVzc2FnZTogU2NoZW1hID0ge1xyXG4gIGlkOiB0cnVlLCBjaGF0cm9vbV9pZDogdHJ1ZSwgY29udGVudDogdHJ1ZSwgdHlwZTogdHJ1ZSwgY3JlYXRlZF9hdDogdHJ1ZSxcclxuICB0aHJlYWRfcGFyZW50X2lkOiB0cnVlLFxyXG4gIHNlbmRlcjogeyAuLi5hY3RvciwgaWRlbnRpdHk6IHsgY29sb3I6IHRydWUsIGJhZGdlczogW2JhZGdlXSwgYmFkZ2VzX3YyOiBbYmFkZ2VdIH0gfSxcclxuICBtZXRhZGF0YToge1xyXG4gICAgb3JpZ2luYWxfc2VuZGVyOiBhY3RvcixcclxuICAgIG9yaWdpbmFsX21lc3NhZ2U6IHsgaWQ6IHRydWUsIGNvbnRlbnQ6IHRydWUsIG1lc3NhZ2U6IHRydWUgfSxcclxuICAgIGNlbGVicmF0aW9uOiB7IHR5cGU6IHRydWUsIHRvdGFsX21vbnRoczogdHJ1ZSB9LFxyXG4gIH0sXHJcbn07XHJcbmNvbnN0IHNjaGVtYXM6IFJlY29yZDxzdHJpbmcsIFNjaGVtYT4gPSB7XHJcbiAgJ0FwcFxcXFxFdmVudHNcXFxcQ2hhdE1lc3NhZ2VFdmVudCc6IG1lc3NhZ2UsXHJcbiAgJ0FwcFxcXFxFdmVudHNcXFxcVXNlckJhbm5lZEV2ZW50Jzoge1xyXG4gICAgaWQ6IHRydWUsIHVzZXJfaWQ6IHRydWUsIHVzZXJuYW1lOiB0cnVlLCB1c2VyOiBhY3RvciwgcGVybWFuZW50OiB0cnVlLFxyXG4gICAgZHVyYXRpb246IHRydWUsIGR1cmF0aW9uX21pbjogdHJ1ZSwgZHVyYXRpb25faW5fbWludXRlczogdHJ1ZSxcclxuICAgIGJhbm5lZF9ieTogYWN0b3IsIGJhbm5lZEJ5OiBhY3RvciwgYmFubmVkX2J5X3VzZXI6IGFjdG9yLFxyXG4gICAgZXhwaXJlc19hdDogdHJ1ZSwgYmFubmVkX3VudGlsOiB0cnVlLCBleHBpcmVzQXQ6IHRydWUsXHJcbiAgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxNZXNzYWdlRGVsZXRlZEV2ZW50Jzoge1xyXG4gICAgaWQ6IHRydWUsIG1lc3NhZ2U6IHsgaWQ6IHRydWUgfSwgYWlNb2RlcmF0ZWQ6IHRydWUsIHZpb2xhdGVkUnVsZXM6IHRydWUsXHJcbiAgICBkZWxldGVkX2J5OiBhY3RvciwgZGVsZXRlZEJ5OiBhY3RvciwgbW9kZXJhdG9yOiBhY3RvciwgbW9kZXJhdG9yX3VzZXI6IGFjdG9yLFxyXG4gICAgZGVsZXRlZF9ieV91c2VyOiBhY3RvciwgdXNlcl9kZWxldGVkX2J5OiBhY3RvcixcclxuICB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXFN1YnNjcmlwdGlvbkV2ZW50JzogeyBjaGF0cm9vbV9pZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIG1vbnRoczogdHJ1ZSB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXENoYW5uZWxTdWJzY3JpcHRpb25FdmVudCc6IHsgY2hhbm5lbF9pZDogdHJ1ZSwgdXNlcl9pZHM6IHRydWUsIHVzZXJuYW1lOiB0cnVlIH0sXHJcbiAgR2lmdGVkU3Vic2NyaXB0aW9uc0V2ZW50OiB7XHJcbiAgICBjaGF0cm9vbV9pZDogdHJ1ZSwgY29ycmVsYXRpb25faWQ6IHRydWUsIGdpZnRlZF91c2VybmFtZXM6IHRydWUsXHJcbiAgICBnaWZ0ZXJfdXNlcm5hbWU6IHRydWUsIGdpZnRlZF90b3RhbDogdHJ1ZSxcclxuICB9LFxyXG4gIEtpY2tzR2lmdGVkOiB7IGdpZnRfdHJhbnNhY3Rpb25faWQ6IHRydWUsIHNlbmRlcjogYWN0b3IsIGdpZnQ6IHsgYW1vdW50OiB0cnVlLCBuYW1lOiB0cnVlIH0sIG1lc3NhZ2U6IHRydWUgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxTdHJlYW1Ib3N0RXZlbnQnOiB7IGNoYXRyb29tX2lkOiB0cnVlLCBob3N0X3VzZXJuYW1lOiB0cnVlLCBudW1iZXJfdmlld2VyczogdHJ1ZSwgb3B0aW9uYWxfbWVzc2FnZTogdHJ1ZSB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXFBpbm5lZE1lc3NhZ2VDcmVhdGVkRXZlbnQnOiB7IG1lc3NhZ2UsIGR1cmF0aW9uOiB0cnVlLCBwaW5uZWRCeTogYWN0b3IgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxDaGF0cm9vbVVwZGF0ZWRFdmVudCc6IHtcclxuICAgIGlkOiB0cnVlLCBzbG93X21vZGU6IHsgZW5hYmxlZDogdHJ1ZSwgbWVzc2FnZV9pbnRlcnZhbDogdHJ1ZSB9LFxyXG4gICAgZm9sbG93ZXJzX21vZGU6IHsgZW5hYmxlZDogdHJ1ZSwgbWluX2R1cmF0aW9uOiB0cnVlIH0sXHJcbiAgICBzdWJzY3JpYmVyc19tb2RlOiB7IGVuYWJsZWQ6IHRydWUgfSwgZW1vdGVzX21vZGU6IHsgZW5hYmxlZDogdHJ1ZSB9LFxyXG4gIH0sXHJcbn07XHJcbmNvbnN0IHN0cmluZ09yT2JqZWN0RmllbGRzID0gbmV3IFNldChbXHJcbiAgJ29yaWdpbmFsX3NlbmRlcicsICdvcmlnaW5hbF9tZXNzYWdlJywgJ2Jhbm5lZF9ieScsICdiYW5uZWRCeScsICdiYW5uZWRfYnlfdXNlcicsXHJcbiAgJ2RlbGV0ZWRfYnknLCAnZGVsZXRlZEJ5JywgJ21vZGVyYXRvcicsICdtb2RlcmF0b3JfdXNlcicsICdkZWxldGVkX2J5X3VzZXInLCAndXNlcl9kZWxldGVkX2J5JyxcclxuXSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcclxuICByZXR1cm4gdmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcclxuICAgID8gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gOiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWNvZGUodmFsdWU6IHVua25vd24pOiB1bmtub3duIHtcclxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIHZhbHVlO1xyXG4gIHRyeSB7IHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyB1bmtub3duOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cclxufVxyXG5cclxuZnVuY3Rpb24gcHJvamVjdChyYXc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBzY2hlbWE6IFNjaGVtYSk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcclxuICBjb25zdCBjbGVhbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHNoYXBlXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEpKSB7XHJcbiAgICBsZXQgdmFsdWUgPSByYXdba2V5XTtcclxuICAgIGlmIChrZXkgPT09ICdtZXRhZGF0YScpIHZhbHVlID0gZGVjb2RlKHZhbHVlKTtcclxuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgIGlmIChzaGFwZSA9PT0gdHJ1ZSkge1xyXG4gICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgWydzdHJpbmcnLCAnYm9vbGVhbicsICdudW1iZXInXS5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWU7XHJcbiAgICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWUuZmlsdGVyKChpdGVtKSA9PiB0eXBlb2YgaXRlbSA9PT0gJ3N0cmluZycgfHwgdHlwZW9mIGl0ZW0gPT09ICdudW1iZXInKTtcclxuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShzaGFwZSkpIHtcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWUuZmxhdE1hcCgoaXRlbSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHIgPSByZWNvcmQoaXRlbSk7XHJcbiAgICAgICAgcmV0dXJuIHIgPyBbcHJvamVjdChyLCBzaGFwZVswXSldIDogW107XHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgciA9IHJlY29yZCh2YWx1ZSk7XHJcbiAgICAgIGlmIChyKSBjbGVhbltrZXldID0gcHJvamVjdChyLCBzaGFwZSBhcyBTY2hlbWEpO1xyXG4gICAgICAvLyBUaGVzZSBjYXB0dXJlZCBwdWJsaWMgZmllbGRzIGFsc28gYWNjZXB0IGEgYmFyZSBkaXNwbGF5IHN0cmluZy5cclxuICAgICAgZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiBzdHJpbmdPck9iamVjdEZpZWxkcy5oYXMoa2V5KSkgY2xlYW5ba2V5XSA9IHZhbHVlO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gY2xlYW47XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1B1YmxpY0NoYXRDaGFubmVsKGNoYW5uZWw6IHVua25vd24pOiBjaGFubmVsIGlzIHN0cmluZyB7XHJcbiAgcmV0dXJuIHR5cGVvZiBjaGFubmVsID09PSAnc3RyaW5nJyAmJiAvXig/OmNoYXRyb29tc1xcLlsxLTldXFxkKlxcLnYyfGNoYW5uZWxcXC5bMS05XVxcZCp8Y2hhdHJvb21fWzEtOV1cXGQqfGNoYW5uZWxfWzEtOV1cXGQqKSQvLnRlc3QoY2hhbm5lbCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVB1YmxpY0NoYXRQdWJsaWNhdGlvbihyYXc6IHVua25vd24pOiBQdWJsaWNDaGF0UHVibGljYXRpb24gfCBudWxsIHtcclxuICBjb25zdCBmcmFtZSA9IHJlY29yZChyYXcpO1xyXG4gIGlmICghZnJhbWUgfHwgIWlzUHVibGljQ2hhdENoYW5uZWwoZnJhbWUuY2hhbm5lbCkgfHwgdHlwZW9mIGZyYW1lLmV2ZW50ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XHJcbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHNjaGVtYXMsIGZyYW1lLmV2ZW50KSA/IHNjaGVtYXNbZnJhbWUuZXZlbnRdIDogdW5kZWZpbmVkO1xyXG4gIGNvbnN0IHBheWxvYWQgPSByZWNvcmQoZGVjb2RlKGZyYW1lLmRhdGEpKTtcclxuICBpZiAoIXNjaGVtYSB8fCAhcGF5bG9hZCkgcmV0dXJuIG51bGw7XHJcbiAgcmV0dXJuIHsgY2hhbm5lbDogZnJhbWUuY2hhbm5lbCwgZXZlbnQ6IGZyYW1lLmV2ZW50LCBkYXRhOiBwcm9qZWN0KHBheWxvYWQsIHNjaGVtYSkgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTmF0aXZlUHVibGljYXRpb24ocmF3OiB1bmtub3duKTogUHVibGljQ2hhdFB1YmxpY2F0aW9uIHwgbnVsbCB7XHJcbiAgY29uc3QgcHVzaCA9IHJlY29yZChyZWNvcmQoZGVjb2RlKHJhdykpPy5wdXNoKTtcclxuICBjb25zdCBkYXRhID0gcmVjb3JkKHJlY29yZChwdXNoPy5wdWIpPy5kYXRhKTtcclxuICByZXR1cm4gcHVzaCAmJiBkYXRhID8gc2FuaXRpemVQdWJsaWNDaGF0UHVibGljYXRpb24oeyBjaGFubmVsOiBwdXNoLmNoYW5uZWwsIGV2ZW50OiBkYXRhLmV2ZW50LCBkYXRhOiBkYXRhLmRhdGEgfSkgOiBudWxsO1xyXG59XHJcbiIsICJpbXBvcnQge1xyXG4gIE5BVElWRV9DSEFUX0VWRU5ULCBpc1B1YmxpY0NoYXRDaGFubmVsLCBwYXJzZU5hdGl2ZVB1YmxpY2F0aW9uLCByZWNvcmQsXHJcbiAgdHlwZSBOYXRpdmVDaGF0U2lnbmFsLFxyXG59IGZyb20gJy4uL3NoYXJlZC9uYXRpdmUtY2hhdCc7XHJcblxyXG5jb25zdCBCUklER0VfU0xPVCA9IFN5bWJvbC5mb3IoJ2tpY2tmbG93Lm5hdGl2ZS1jaGF0LWJyaWRnZS52MScpO1xyXG4vLyBBY2NlcHQgYSBzaW5nbGUgcmVnaW9uIGxhYmVsLCBuZXZlciBhbiBhcmJpdHJhcnkgc3ViZG9tYWluIG9yIGEgaG9zdG5hbWUgc3VmZml4LlxyXG5jb25zdCBSRUFMVElNRV9IT1NUID0gL15yZWFsdGltZVxcLlthLXowLTldKyg/Oi1bYS16MC05XSspKlxcLnBsYXRmb3JtXFwua2lja1xcLmNvbSQvO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzS2lja1JlYWx0aW1lVXJsKHJhdzogdW5rbm93bik6IGJvb2xlYW4ge1xyXG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnc3RyaW5nJyAmJiAhKHJhdyBpbnN0YW5jZW9mIFVSTCkpIHJldHVybiBmYWxzZTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChTdHJpbmcocmF3KSk7XHJcbiAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSAnd3NzOicgJiYgUkVBTFRJTUVfSE9TVC50ZXN0KHVybC5ob3N0bmFtZSlcclxuICAgICAgJiYgIXVybC51c2VybmFtZSAmJiAhdXJsLnBhc3N3b3JkICYmICF1cmwucG9ydFxyXG4gICAgICAmJiB1cmwucGF0aG5hbWUgPT09ICcvY29ubmVjdGlvbi93ZWJzb2NrZXQnO1xyXG4gIH0gY2F0Y2ggeyByZXR1cm4gZmFsc2U7IH1cclxufVxyXG5cclxuZnVuY3Rpb24gZmluZERlc2NyaXB0b3Ioc3RhcnQ6IG9iamVjdCB8IG51bGwsIGtleTogUHJvcGVydHlLZXkpOiBQcm9wZXJ0eURlc2NyaXB0b3IgfCB1bmRlZmluZWQge1xyXG4gIGZvciAobGV0IHByb3RvID0gc3RhcnQ7IHByb3RvOyBwcm90byA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90bykpIHtcclxuICAgIGNvbnN0IGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvLCBrZXkpO1xyXG4gICAgaWYgKGRlc2NyaXB0b3IpIHJldHVybiBkZXNjcmlwdG9yO1xyXG4gIH1cclxuICByZXR1cm4gdW5kZWZpbmVkO1xyXG59XHJcblxyXG4vKiogT2JzZXJ2ZSBpbmNvbWluZyBwdWJsaWMgcHVibGljYXRpb25zIG9ubHkuIE5ldmVyIGluc3BlY3Qgc2VuZCgpLCBhdXRoIG9yIGNvbm5lY3QgcmVwbGllcy5cclxuICpcclxuICogMjAyNi0xMC0yMDogdGhlIGJyaWRnZSBubyBsb25nZXIgcmVwbGFjZXMgdGhlXHJcbiAqIFdlYlNvY2tldCBjb25zdHJ1Y3Rvci4gQSBQcm94eSBjb25zdHJ1Y3QgdHJhcCBwdXQgdGhpcyBmaWxlIG9uIHRvcCBvZiB0aGUgc3RhY2sgb2YgRVZFUlkgc29ja2V0XHJcbiAqIEtpY2sgb3BlbnMsIHNvIENocm9tZSBhdHRyaWJ1dGVkIGVhY2ggZmFpbGVkIEtpY2sgaGFuZHNoYWtlIChcIldlYlNvY2tldCBjb25uZWN0aW9uIHRvXHJcbiAqIHdzczovL3dlYnNvY2tldHMua2ljay5jb20vdmlld2VyL3YxL2Nvbm5lY3QgLi4uIGZhaWxlZFwiLCBtZWFzdXJlZCAyMDI2LTEwLTIwIGF0IG5hdGl2ZS1jaGF0LmpzOjE3MSlcclxuICogdG8gdGhlIGV4dGVuc2lvbidzIGVycm9yIGxpc3QuIEtpY2sncyByZWFsdGltZSBjbGllbnQgcmVnaXN0ZXJzIGl0cyBtZXNzYWdlIGhhbmRsZXIgcmlnaHQgYWZ0ZXJcclxuICogY29uc3RydWN0aW9uIChvbm1lc3NhZ2Ugb3IgYWRkRXZlbnRMaXN0ZW5lciksIHNvIHRoZSBicmlkZ2UgYXR0YWNoZXMgdGhlcmUgaW5zdGVhZDsgdGhlIHNvY2tldFxyXG4gKiBpcyBjcmVhdGVkIGJ5IEtpY2sncyBvd24gZnJhbWUgYW5kIGl0cyBmYWlsdXJlcyBzdGF5IEtpY2sncy4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxOYXRpdmVDaGF0QnJpZGdlKHRhcmdldDogV2luZG93ICYgUGljazx0eXBlb2YgZ2xvYmFsVGhpcywgJ1dlYlNvY2tldCc+ID0gd2luZG93KTogKCkgPT4gdm9pZCB7XHJcbiAgY29uc3Qgc3RhdGUgPSB0YXJnZXQgYXMgdHlwZW9mIHRhcmdldCAmIFBhcnRpYWw8UmVjb3JkPHN5bWJvbCwgKCkgPT4gdm9pZD4+O1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gc3RhdGVbQlJJREdFX1NMT1RdO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IHByb3RvID0gdGFyZ2V0LldlYlNvY2tldC5wcm90b3R5cGUgYXMgV2ViU29ja2V0O1xyXG4gIGNvbnN0IG93bkFkZCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG8sICdhZGRFdmVudExpc3RlbmVyJyk7XHJcbiAgY29uc3QgYmFzZUFkZCA9IGZpbmREZXNjcmlwdG9yKHByb3RvLCAnYWRkRXZlbnRMaXN0ZW5lcicpPy52YWx1ZSBhcyBXZWJTb2NrZXRbJ2FkZEV2ZW50TGlzdGVuZXInXTtcclxuICBjb25zdCBvd25Pbk1lc3NhZ2UgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvLCAnb25tZXNzYWdlJyk7XHJcbiAgY29uc3Qgb25NZXNzYWdlRGVzY3JpcHRvciA9IGZpbmREZXNjcmlwdG9yKHByb3RvLCAnb25tZXNzYWdlJyk7XHJcbiAgY29uc3QgY2xlYW51cHMgPSBuZXcgU2V0PCgpID0+IHZvaWQ+KCk7XHJcbiAgY29uc3Qgc2VlbiA9IG5ldyBXZWFrU2V0PG9iamVjdD4oKTtcclxuICBsZXQgbmV4dFNvY2tldElkID0gMDtcclxuICBsZXQgZGlzcG9zZWQgPSBmYWxzZTtcclxuICBjb25zdCBwdWJsaXNoID0gKHNpZ25hbDogTmF0aXZlQ2hhdFNpZ25hbCk6IHZvaWQgPT4ge1xyXG4gICAgaWYgKCFkaXNwb3NlZCkgdGFyZ2V0LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KE5BVElWRV9DSEFUX0VWRU5ULCB7IGRldGFpbDogc2lnbmFsIH0pKTtcclxuICB9O1xyXG4gIGNvbnN0IG9ic2VydmUgPSAoc29ja2V0OiBXZWJTb2NrZXQpOiB2b2lkID0+IHtcclxuICAgIGlmIChkaXNwb3NlZCB8fCBzZWVuLmhhcyhzb2NrZXQpKSByZXR1cm47XHJcbiAgICBzZWVuLmFkZChzb2NrZXQpO1xyXG4gICAgbGV0IHVybDogdW5rbm93bjtcclxuICAgIHRyeSB7IHVybCA9IHNvY2tldC51cmw7IH0gY2F0Y2ggeyByZXR1cm47IH1cclxuICAgIGlmICghaXNLaWNrUmVhbHRpbWVVcmwodXJsKSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgc29ja2V0SWQgPSArK25leHRTb2NrZXRJZDtcclxuICAgIGNvbnN0IG9uTWVzc2FnZSA9IChldmVudDogTWVzc2FnZUV2ZW50KTogdm9pZCA9PiB7XHJcbiAgICAgIGlmIChkaXNwb3NlZCB8fCB0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHJldHVybjtcclxuICAgICAgLy8gQ2VudHJpZnVnZSBjYW4gZGVsaW1pdCBzZXZlcmFsIEpTT04gcHJvdG9jb2wgcmVwbGllcyB3aXRoIG5ld2xpbmVzLlxyXG4gICAgICBmb3IgKGNvbnN0IHJhdyBvZiBldmVudC5kYXRhLnNwbGl0KCdcXG4nKSkge1xyXG4gICAgICAgIGNvbnN0IHB1YmxpY2F0aW9uID0gcGFyc2VOYXRpdmVQdWJsaWNhdGlvbihyYXcpO1xyXG4gICAgICAgIGlmIChwdWJsaWNhdGlvbikge1xyXG4gICAgICAgICAgcHVibGlzaCh7IGtpbmQ6ICdwdWJsaWNhdGlvbicsIHNvY2tldElkLCBwdWJsaWNhdGlvbiB9KTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgcHVzaCA9IHJlY29yZChyZWNvcmQoSlNPTi5wYXJzZShyYXcpKT8ucHVzaCk7XHJcbiAgICAgICAgICBpZiAocHVzaD8udW5zdWJzY3JpYmUgJiYgaXNQdWJsaWNDaGF0Q2hhbm5lbChwdXNoLmNoYW5uZWwpKSB7XHJcbiAgICAgICAgICAgIHB1Ymxpc2goeyBraW5kOiAndW5hdmFpbGFibGUnLCBzb2NrZXRJZCwgY2hhbm5lbDogcHVzaC5jaGFubmVsIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggeyAvKiBNYWxmb3JtZWQvY29udHJvbCB0cmFmZmljIG5ldmVyIGNyb3NzZXMgdGhlIGJvdW5kYXJ5LiAqLyB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgICBjb25zdCBjbGVhbnVwID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgICBzb2NrZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIG9uTWVzc2FnZSBhcyBFdmVudExpc3RlbmVyKTtcclxuICAgICAgc29ja2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2Nsb3NlJywgb25DbG9zZSk7XHJcbiAgICAgIHNvY2tldC5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIG9uQ2xvc2UpO1xyXG4gICAgICBjbGVhbnVwcy5kZWxldGUoY2xlYW51cCk7XHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb25DbG9zZSA9ICgpOiB2b2lkID0+IHtcclxuICAgICAgcHVibGlzaCh7IGtpbmQ6ICd1bmF2YWlsYWJsZScsIHNvY2tldElkIH0pO1xyXG4gICAgICBjbGVhbnVwKCk7XHJcbiAgICB9O1xyXG4gICAgY2xlYW51cHMuYWRkKGNsZWFudXApO1xyXG4gICAgYmFzZUFkZC5jYWxsKHNvY2tldCwgJ21lc3NhZ2UnLCBvbk1lc3NhZ2UgYXMgRXZlbnRMaXN0ZW5lcik7XHJcbiAgICBiYXNlQWRkLmNhbGwoc29ja2V0LCAnY2xvc2UnLCBvbkNsb3NlKTtcclxuICAgIGJhc2VBZGQuY2FsbChzb2NrZXQsICdlcnJvcicsIG9uQ2xvc2UpO1xyXG4gIH07XHJcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCAnYWRkRXZlbnRMaXN0ZW5lcicsIHtcclxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcclxuICAgIHdyaXRhYmxlOiB0cnVlLFxyXG4gICAgZW51bWVyYWJsZTogb3duQWRkPy5lbnVtZXJhYmxlID8/IGZhbHNlLFxyXG4gICAgdmFsdWU6IGZ1bmN0aW9uIGFkZEV2ZW50TGlzdGVuZXIodGhpczogV2ViU29ja2V0LCAuLi5hcmdzOiBQYXJhbWV0ZXJzPFdlYlNvY2tldFsnYWRkRXZlbnRMaXN0ZW5lciddPikge1xyXG4gICAgICBvYnNlcnZlKHRoaXMpO1xyXG4gICAgICByZXR1cm4gYmFzZUFkZC5hcHBseSh0aGlzLCBhcmdzKTtcclxuICAgIH0sXHJcbiAgfSk7XHJcbiAgY29uc3Qgc2V0T25NZXNzYWdlID0gb25NZXNzYWdlRGVzY3JpcHRvcj8uc2V0O1xyXG4gIGlmIChzZXRPbk1lc3NhZ2UgJiYgb25NZXNzYWdlRGVzY3JpcHRvcj8uY29uZmlndXJhYmxlICE9PSBmYWxzZSkge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCAnb25tZXNzYWdlJywge1xyXG4gICAgICBjb25maWd1cmFibGU6IHRydWUsXHJcbiAgICAgIGVudW1lcmFibGU6IG9uTWVzc2FnZURlc2NyaXB0b3IuZW51bWVyYWJsZSxcclxuICAgICAgZ2V0OiBvbk1lc3NhZ2VEZXNjcmlwdG9yLmdldCxcclxuICAgICAgc2V0KHRoaXM6IFdlYlNvY2tldCwgdmFsdWU6IHVua25vd24pIHtcclxuICAgICAgICBvYnNlcnZlKHRoaXMpO1xyXG4gICAgICAgIHNldE9uTWVzc2FnZS5jYWxsKHRoaXMsIHZhbHVlKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuICBjb25zdCByZXN0b3JlID0gKGtleTogJ2FkZEV2ZW50TGlzdGVuZXInIHwgJ29ubWVzc2FnZScsIG93bjogUHJvcGVydHlEZXNjcmlwdG9yIHwgdW5kZWZpbmVkKTogdm9pZCA9PiB7XHJcbiAgICBpZiAob3duKSBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG8sIGtleSwgb3duKTtcclxuICAgIGVsc2UgZGVsZXRlIChwcm90byBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtrZXldO1xyXG4gIH07XHJcbiAgY29uc3QgdGVhcmRvd24gPSAoKTogdm9pZCA9PiB7XHJcbiAgICBkaXNwb3NlZCA9IHRydWU7XHJcbiAgICBmb3IgKGNvbnN0IGNsZWFudXAgb2YgY2xlYW51cHMpIGNsZWFudXAoKTtcclxuICAgIHJlc3RvcmUoJ2FkZEV2ZW50TGlzdGVuZXInLCBvd25BZGQpO1xyXG4gICAgaWYgKHNldE9uTWVzc2FnZSAmJiBvbk1lc3NhZ2VEZXNjcmlwdG9yPy5jb25maWd1cmFibGUgIT09IGZhbHNlKSByZXN0b3JlKCdvbm1lc3NhZ2UnLCBvd25Pbk1lc3NhZ2UpO1xyXG4gICAgaWYgKHN0YXRlW0JSSURHRV9TTE9UXSA9PT0gdGVhcmRvd24pIGRlbGV0ZSBzdGF0ZVtCUklER0VfU0xPVF07XHJcbiAgfTtcclxuICBzdGF0ZVtCUklER0VfU0xPVF0gPSB0ZWFyZG93bjtcclxuICByZXR1cm4gdGVhcmRvd247XHJcbn1cclxuIiwgImltcG9ydCB7IGluc3RhbGxOYXRpdmVDaGF0QnJpZGdlIH0gZnJvbSAnLi9uYXRpdmUtY2hhdC1icmlkZ2UnO1xyXG5cclxuaW5zdGFsbE5hdGl2ZUNoYXRCcmlkZ2UoKTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBQ08sTUFBTSxvQkFBb0I7QUFhakMsTUFBTSxRQUFnQixFQUFFLElBQUksTUFBTSxVQUFVLE1BQU0sY0FBYyxNQUFNLE1BQU0sTUFBTSxNQUFNLEtBQUs7QUFDN0YsTUFBTSxRQUFnQjtBQUFBLElBQ3BCLE1BQU07QUFBQSxJQUFNLE1BQU07QUFBQSxJQUFNLE1BQU07QUFBQSxJQUFNLE9BQU87QUFBQSxJQUFNLFdBQVc7QUFBQSxJQUFNLFFBQVE7QUFBQSxJQUMxRSxVQUFVO0FBQUEsSUFBTSxZQUFZO0FBQUEsSUFBTSxVQUFVLEVBQUUsT0FBTyxLQUFLO0FBQUEsRUFDNUQ7QUFDQSxNQUFNLFVBQWtCO0FBQUEsSUFDdEIsSUFBSTtBQUFBLElBQU0sYUFBYTtBQUFBLElBQU0sU0FBUztBQUFBLElBQU0sTUFBTTtBQUFBLElBQU0sWUFBWTtBQUFBLElBQ3BFLGtCQUFrQjtBQUFBLElBQ2xCLFFBQVEsRUFBRSxHQUFHLE9BQU8sVUFBVSxFQUFFLE9BQU8sTUFBTSxRQUFRLENBQUMsS0FBSyxHQUFHLFdBQVcsQ0FBQyxLQUFLLEVBQUUsRUFBRTtBQUFBLElBQ25GLFVBQVU7QUFBQSxNQUNSLGlC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
