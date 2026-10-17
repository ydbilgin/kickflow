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
  var REALTIME_HOSTS = /* @__PURE__ */ new Set([
    "realtime.us-east-1.platform.kick.com",
    "realtime.us-west-2.platform.kick.com"
  ]);
  function isKickRealtimeUrl(raw) {
    if (typeof raw !== "string" && !(raw instanceof URL)) return false;
    try {
      const url = new URL(String(raw));
      return url.protocol === "wss:" && REALTIME_HOSTS.has(url.hostname) && url.pathname === "/connection/websocket";
    } catch {
      return false;
    }
  }
  function installNativeChatBridge(target = window) {
    const state = target;
    const existing = state[BRIDGE_SLOT];
    if (existing) return existing;
    const original = target.WebSocket;
    const cleanups = /* @__PURE__ */ new Set();
    let nextSocketId = 0;
    let disposed = false;
    const publish = (signal) => {
      if (!disposed) target.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: signal }));
    };
    const wrapped = new Proxy(original, {
      construct(ctor, args, newTarget) {
        const socket = Reflect.construct(ctor, args, newTarget);
        if (!isKickRealtimeUrl(args[0]) || disposed) return socket;
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
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose);
        socket.addEventListener("error", onClose);
        return socket;
      }
    });
    target.WebSocket = wrapped;
    const teardown = () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      if (target.WebSocket === wrapped) target.WebSocket = original;
      if (state[BRIDGE_SLOT] === teardown) delete state[BRIDGE_SLOT];
    };
    state[BRIDGE_SLOT] = teardown;
    return teardown;
  }

  // src/mainworld/native-chat-entry.ts
  installNativeChatBridge();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3NoYXJlZC9uYXRpdmUtY2hhdC50cyIsICIuLi9zcmMvbWFpbndvcmxkL25hdGl2ZS1jaGF0LWJyaWRnZS50cyIsICIuLi9zcmMvbWFpbndvcmxkL25hdGl2ZS1jaGF0LWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKiogUHVibGljIHJlYWx0aW1lIGJvdW5kYXJ5LiBEbyBub3QgYWRkIGNvbm5lY3Rpb24sIGF1dGggb3IgYXJiaXRyYXJ5IHBhY2tldCBmaWVsZHMgaGVyZS4gKi9cclxuZXhwb3J0IGNvbnN0IE5BVElWRV9DSEFUX0VWRU5UID0gJ2tpY2tmbG93Om5hdGl2ZS1wdWJsaWNhdGlvbi12MSc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFB1YmxpY0NoYXRQdWJsaWNhdGlvbiB7XHJcbiAgY2hhbm5lbDogc3RyaW5nO1xyXG4gIGV2ZW50OiBzdHJpbmc7XHJcbiAgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIE5hdGl2ZUNoYXRTaWduYWwgPVxyXG4gIHwgeyBraW5kOiAncHVibGljYXRpb24nOyBzb2NrZXRJZDogbnVtYmVyOyBwdWJsaWNhdGlvbjogUHVibGljQ2hhdFB1YmxpY2F0aW9uIH1cclxuICB8IHsga2luZDogJ3VuYXZhaWxhYmxlJzsgc29ja2V0SWQ6IG51bWJlcjsgY2hhbm5lbD86IHN0cmluZyB9O1xyXG5cclxudHlwZSBTY2hlbWEgPSB7IHJlYWRvbmx5IFtrZXk6IHN0cmluZ106IHRydWUgfCBTY2hlbWEgfCByZWFkb25seSBbU2NoZW1hXSB9O1xyXG5jb25zdCBhY3RvcjogU2NoZW1hID0geyBpZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIGRpc3BsYXlfbmFtZTogdHJ1ZSwgc2x1ZzogdHJ1ZSwgbmFtZTogdHJ1ZSB9O1xyXG5jb25zdCBiYWRnZTogU2NoZW1hID0ge1xyXG4gIHR5cGU6IHRydWUsIG5hbWU6IHRydWUsIHRleHQ6IHRydWUsIGNvdW50OiB0cnVlLCBpbWFnZV91cmw6IHRydWUsIGFjdGl2ZTogdHJ1ZSxcclxuICBzZWxlY3RlZDogdHJ1ZSwgc29ydF9vcmRlcjogdHJ1ZSwgbWV0YWRhdGE6IHsgbGV2ZWw6IHRydWUgfSxcclxufTtcclxuY29uc3QgbWVzc2FnZTogU2NoZW1hID0ge1xyXG4gIGlkOiB0cnVlLCBjaGF0cm9vbV9pZDogdHJ1ZSwgY29udGVudDogdHJ1ZSwgdHlwZTogdHJ1ZSwgY3JlYXRlZF9hdDogdHJ1ZSxcclxuICB0aHJlYWRfcGFyZW50X2lkOiB0cnVlLFxyXG4gIHNlbmRlcjogeyAuLi5hY3RvciwgaWRlbnRpdHk6IHsgY29sb3I6IHRydWUsIGJhZGdlczogW2JhZGdlXSwgYmFkZ2VzX3YyOiBbYmFkZ2VdIH0gfSxcclxuICBtZXRhZGF0YToge1xyXG4gICAgb3JpZ2luYWxfc2VuZGVyOiBhY3RvcixcclxuICAgIG9yaWdpbmFsX21lc3NhZ2U6IHsgaWQ6IHRydWUsIGNvbnRlbnQ6IHRydWUsIG1lc3NhZ2U6IHRydWUgfSxcclxuICAgIGNlbGVicmF0aW9uOiB7IHR5cGU6IHRydWUsIHRvdGFsX21vbnRoczogdHJ1ZSB9LFxyXG4gIH0sXHJcbn07XHJcbmNvbnN0IHNjaGVtYXM6IFJlY29yZDxzdHJpbmcsIFNjaGVtYT4gPSB7XHJcbiAgJ0FwcFxcXFxFdmVudHNcXFxcQ2hhdE1lc3NhZ2VFdmVudCc6IG1lc3NhZ2UsXHJcbiAgJ0FwcFxcXFxFdmVudHNcXFxcVXNlckJhbm5lZEV2ZW50Jzoge1xyXG4gICAgaWQ6IHRydWUsIHVzZXJfaWQ6IHRydWUsIHVzZXJuYW1lOiB0cnVlLCB1c2VyOiBhY3RvciwgcGVybWFuZW50OiB0cnVlLFxyXG4gICAgZHVyYXRpb246IHRydWUsIGR1cmF0aW9uX21pbjogdHJ1ZSwgZHVyYXRpb25faW5fbWludXRlczogdHJ1ZSxcclxuICAgIGJhbm5lZF9ieTogYWN0b3IsIGJhbm5lZEJ5OiBhY3RvciwgYmFubmVkX2J5X3VzZXI6IGFjdG9yLFxyXG4gICAgZXhwaXJlc19hdDogdHJ1ZSwgYmFubmVkX3VudGlsOiB0cnVlLCBleHBpcmVzQXQ6IHRydWUsXHJcbiAgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxNZXNzYWdlRGVsZXRlZEV2ZW50Jzoge1xyXG4gICAgaWQ6IHRydWUsIG1lc3NhZ2U6IHsgaWQ6IHRydWUgfSwgYWlNb2RlcmF0ZWQ6IHRydWUsIHZpb2xhdGVkUnVsZXM6IHRydWUsXHJcbiAgICBkZWxldGVkX2J5OiBhY3RvciwgZGVsZXRlZEJ5OiBhY3RvciwgbW9kZXJhdG9yOiBhY3RvciwgbW9kZXJhdG9yX3VzZXI6IGFjdG9yLFxyXG4gICAgZGVsZXRlZF9ieV91c2VyOiBhY3RvciwgdXNlcl9kZWxldGVkX2J5OiBhY3RvcixcclxuICB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXFN1YnNjcmlwdGlvbkV2ZW50JzogeyBjaGF0cm9vbV9pZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIG1vbnRoczogdHJ1ZSB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXENoYW5uZWxTdWJzY3JpcHRpb25FdmVudCc6IHsgY2hhbm5lbF9pZDogdHJ1ZSwgdXNlcl9pZHM6IHRydWUsIHVzZXJuYW1lOiB0cnVlIH0sXHJcbiAgR2lmdGVkU3Vic2NyaXB0aW9uc0V2ZW50OiB7XHJcbiAgICBjaGF0cm9vbV9pZDogdHJ1ZSwgY29ycmVsYXRpb25faWQ6IHRydWUsIGdpZnRlZF91c2VybmFtZXM6IHRydWUsXHJcbiAgICBnaWZ0ZXJfdXNlcm5hbWU6IHRydWUsIGdpZnRlZF90b3RhbDogdHJ1ZSxcclxuICB9LFxyXG4gIEtpY2tzR2lmdGVkOiB7IGdpZnRfdHJhbnNhY3Rpb25faWQ6IHRydWUsIHNlbmRlcjogYWN0b3IsIGdpZnQ6IHsgYW1vdW50OiB0cnVlLCBuYW1lOiB0cnVlIH0sIG1lc3NhZ2U6IHRydWUgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxTdHJlYW1Ib3N0RXZlbnQnOiB7IGNoYXRyb29tX2lkOiB0cnVlLCBob3N0X3VzZXJuYW1lOiB0cnVlLCBudW1iZXJfdmlld2VyczogdHJ1ZSwgb3B0aW9uYWxfbWVzc2FnZTogdHJ1ZSB9LFxyXG4gICdBcHBcXFxcRXZlbnRzXFxcXFBpbm5lZE1lc3NhZ2VDcmVhdGVkRXZlbnQnOiB7IG1lc3NhZ2UsIGR1cmF0aW9uOiB0cnVlLCBwaW5uZWRCeTogYWN0b3IgfSxcclxuICAnQXBwXFxcXEV2ZW50c1xcXFxDaGF0cm9vbVVwZGF0ZWRFdmVudCc6IHtcclxuICAgIGlkOiB0cnVlLCBzbG93X21vZGU6IHsgZW5hYmxlZDogdHJ1ZSwgbWVzc2FnZV9pbnRlcnZhbDogdHJ1ZSB9LFxyXG4gICAgZm9sbG93ZXJzX21vZGU6IHsgZW5hYmxlZDogdHJ1ZSwgbWluX2R1cmF0aW9uOiB0cnVlIH0sXHJcbiAgICBzdWJzY3JpYmVyc19tb2RlOiB7IGVuYWJsZWQ6IHRydWUgfSwgZW1vdGVzX21vZGU6IHsgZW5hYmxlZDogdHJ1ZSB9LFxyXG4gIH0sXHJcbn07XHJcbmNvbnN0IHN0cmluZ09yT2JqZWN0RmllbGRzID0gbmV3IFNldChbXHJcbiAgJ29yaWdpbmFsX3NlbmRlcicsICdvcmlnaW5hbF9tZXNzYWdlJywgJ2Jhbm5lZF9ieScsICdiYW5uZWRCeScsICdiYW5uZWRfYnlfdXNlcicsXHJcbiAgJ2RlbGV0ZWRfYnknLCAnZGVsZXRlZEJ5JywgJ21vZGVyYXRvcicsICdtb2RlcmF0b3JfdXNlcicsICdkZWxldGVkX2J5X3VzZXInLCAndXNlcl9kZWxldGVkX2J5JyxcclxuXSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcclxuICByZXR1cm4gdmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcclxuICAgID8gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gOiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWNvZGUodmFsdWU6IHVua25vd24pOiB1bmtub3duIHtcclxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIHZhbHVlO1xyXG4gIHRyeSB7IHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyB1bmtub3duOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cclxufVxyXG5cclxuZnVuY3Rpb24gcHJvamVjdChyYXc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBzY2hlbWE6IFNjaGVtYSk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcclxuICBjb25zdCBjbGVhbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHNoYXBlXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEpKSB7XHJcbiAgICBsZXQgdmFsdWUgPSByYXdba2V5XTtcclxuICAgIGlmIChrZXkgPT09ICdtZXRhZGF0YScpIHZhbHVlID0gZGVjb2RlKHZhbHVlKTtcclxuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgIGlmIChzaGFwZSA9PT0gdHJ1ZSkge1xyXG4gICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgWydzdHJpbmcnLCAnYm9vbGVhbicsICdudW1iZXInXS5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWU7XHJcbiAgICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWUuZmlsdGVyKChpdGVtKSA9PiB0eXBlb2YgaXRlbSA9PT0gJ3N0cmluZycgfHwgdHlwZW9mIGl0ZW0gPT09ICdudW1iZXInKTtcclxuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShzaGFwZSkpIHtcclxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSBjbGVhbltrZXldID0gdmFsdWUuZmxhdE1hcCgoaXRlbSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHIgPSByZWNvcmQoaXRlbSk7XHJcbiAgICAgICAgcmV0dXJuIHIgPyBbcHJvamVjdChyLCBzaGFwZVswXSldIDogW107XHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgciA9IHJlY29yZCh2YWx1ZSk7XHJcbiAgICAgIGlmIChyKSBjbGVhbltrZXldID0gcHJvamVjdChyLCBzaGFwZSBhcyBTY2hlbWEpO1xyXG4gICAgICAvLyBUaGVzZSBjYXB0dXJlZCBwdWJsaWMgZmllbGRzIGFsc28gYWNjZXB0IGEgYmFyZSBkaXNwbGF5IHN0cmluZy5cclxuICAgICAgZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiBzdHJpbmdPck9iamVjdEZpZWxkcy5oYXMoa2V5KSkgY2xlYW5ba2V5XSA9IHZhbHVlO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gY2xlYW47XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1B1YmxpY0NoYXRDaGFubmVsKGNoYW5uZWw6IHVua25vd24pOiBjaGFubmVsIGlzIHN0cmluZyB7XHJcbiAgcmV0dXJuIHR5cGVvZiBjaGFubmVsID09PSAnc3RyaW5nJyAmJiAvXig/OmNoYXRyb29tc1xcLlsxLTldXFxkKlxcLnYyfGNoYW5uZWxcXC5bMS05XVxcZCp8Y2hhdHJvb21fWzEtOV1cXGQqfGNoYW5uZWxfWzEtOV1cXGQqKSQvLnRlc3QoY2hhbm5lbCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVB1YmxpY0NoYXRQdWJsaWNhdGlvbihyYXc6IHVua25vd24pOiBQdWJsaWNDaGF0UHVibGljYXRpb24gfCBudWxsIHtcclxuICBjb25zdCBmcmFtZSA9IHJlY29yZChyYXcpO1xyXG4gIGlmICghZnJhbWUgfHwgIWlzUHVibGljQ2hhdENoYW5uZWwoZnJhbWUuY2hhbm5lbCkgfHwgdHlwZW9mIGZyYW1lLmV2ZW50ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XHJcbiAgY29uc3Qgc2NoZW1hID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHNjaGVtYXMsIGZyYW1lLmV2ZW50KSA/IHNjaGVtYXNbZnJhbWUuZXZlbnRdIDogdW5kZWZpbmVkO1xyXG4gIGNvbnN0IHBheWxvYWQgPSByZWNvcmQoZGVjb2RlKGZyYW1lLmRhdGEpKTtcclxuICBpZiAoIXNjaGVtYSB8fCAhcGF5bG9hZCkgcmV0dXJuIG51bGw7XHJcbiAgcmV0dXJuIHsgY2hhbm5lbDogZnJhbWUuY2hhbm5lbCwgZXZlbnQ6IGZyYW1lLmV2ZW50LCBkYXRhOiBwcm9qZWN0KHBheWxvYWQsIHNjaGVtYSkgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTmF0aXZlUHVibGljYXRpb24ocmF3OiB1bmtub3duKTogUHVibGljQ2hhdFB1YmxpY2F0aW9uIHwgbnVsbCB7XHJcbiAgY29uc3QgcHVzaCA9IHJlY29yZChyZWNvcmQoZGVjb2RlKHJhdykpPy5wdXNoKTtcclxuICBjb25zdCBkYXRhID0gcmVjb3JkKHJlY29yZChwdXNoPy5wdWIpPy5kYXRhKTtcclxuICByZXR1cm4gcHVzaCAmJiBkYXRhID8gc2FuaXRpemVQdWJsaWNDaGF0UHVibGljYXRpb24oeyBjaGFubmVsOiBwdXNoLmNoYW5uZWwsIGV2ZW50OiBkYXRhLmV2ZW50LCBkYXRhOiBkYXRhLmRhdGEgfSkgOiBudWxsO1xyXG59XHJcbiIsICJpbXBvcnQge1xyXG4gIE5BVElWRV9DSEFUX0VWRU5ULCBpc1B1YmxpY0NoYXRDaGFubmVsLCBwYXJzZU5hdGl2ZVB1YmxpY2F0aW9uLCByZWNvcmQsXHJcbiAgdHlwZSBOYXRpdmVDaGF0U2lnbmFsLFxyXG59IGZyb20gJy4uL3NoYXJlZC9uYXRpdmUtY2hhdCc7XHJcblxyXG5jb25zdCBCUklER0VfU0xPVCA9IFN5bWJvbC5mb3IoJ2tpY2tmbG93Lm5hdGl2ZS1jaGF0LWJyaWRnZS52MScpO1xyXG4vLyBCb3RoIHJlZ2lvbmFsIGVuZHBvaW50cyB3ZXJlIG1lYXN1cmVkIG9uIG5hdGl2ZSBLaWNrIG9uIDIwMjYtMTAtMTMuIEtlZXAgZXhhY3RcclxuLy8gaG9zdHM6IGFjY2VwdGluZyBhIHN1ZmZpeCBvciBhcmJpdHJhcnkgVVJMIHdvdWxkIG9ic2VydmUgdW5yZWxhdGVkIHNvY2tldHMuXHJcbmNvbnN0IFJFQUxUSU1FX0hPU1RTID0gbmV3IFNldChbXHJcbiAgJ3JlYWx0aW1lLnVzLWVhc3QtMS5wbGF0Zm9ybS5raWNrLmNvbScsXHJcbiAgJ3JlYWx0aW1lLnVzLXdlc3QtMi5wbGF0Zm9ybS5raWNrLmNvbScsXHJcbl0pO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzS2lja1JlYWx0aW1lVXJsKHJhdzogdW5rbm93bik6IGJvb2xlYW4ge1xyXG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnc3RyaW5nJyAmJiAhKHJhdyBpbnN0YW5jZW9mIFVSTCkpIHJldHVybiBmYWxzZTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChTdHJpbmcocmF3KSk7XHJcbiAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSAnd3NzOicgJiYgUkVBTFRJTUVfSE9TVFMuaGFzKHVybC5ob3N0bmFtZSlcclxuICAgICAgJiYgdXJsLnBhdGhuYW1lID09PSAnL2Nvbm5lY3Rpb24vd2Vic29ja2V0JztcclxuICB9IGNhdGNoIHsgcmV0dXJuIGZhbHNlOyB9XHJcbn1cclxuXHJcbi8qKiBPYnNlcnZlIGluY29taW5nIHB1YmxpYyBwdWJsaWNhdGlvbnMgb25seS4gTmV2ZXIgaW5zcGVjdCBzZW5kKCksIGF1dGggb3IgY29ubmVjdCByZXBsaWVzLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaW5zdGFsbE5hdGl2ZUNoYXRCcmlkZ2UodGFyZ2V0OiBXaW5kb3cgJiBQaWNrPHR5cGVvZiBnbG9iYWxUaGlzLCAnV2ViU29ja2V0Jz4gPSB3aW5kb3cpOiAoKSA9PiB2b2lkIHtcclxuICBjb25zdCBzdGF0ZSA9IHRhcmdldCBhcyB0eXBlb2YgdGFyZ2V0ICYgUGFydGlhbDxSZWNvcmQ8c3ltYm9sLCAoKSA9PiB2b2lkPj47XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBzdGF0ZVtCUklER0VfU0xPVF07XHJcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XHJcbiAgY29uc3Qgb3JpZ2luYWwgPSB0YXJnZXQuV2ViU29ja2V0O1xyXG4gIGNvbnN0IGNsZWFudXBzID0gbmV3IFNldDwoKSA9PiB2b2lkPigpO1xyXG4gIGxldCBuZXh0U29ja2V0SWQgPSAwO1xyXG4gIGxldCBkaXNwb3NlZCA9IGZhbHNlO1xyXG4gIGNvbnN0IHB1Ymxpc2ggPSAoc2lnbmFsOiBOYXRpdmVDaGF0U2lnbmFsKTogdm9pZCA9PiB7XHJcbiAgICBpZiAoIWRpc3Bvc2VkKSB0YXJnZXQuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoTkFUSVZFX0NIQVRfRVZFTlQsIHsgZGV0YWlsOiBzaWduYWwgfSkpO1xyXG4gIH07XHJcbiAgY29uc3Qgd3JhcHBlZCA9IG5ldyBQcm94eShvcmlnaW5hbCwge1xyXG4gICAgY29uc3RydWN0KGN0b3IsIGFyZ3MsIG5ld1RhcmdldCkge1xyXG4gICAgICBjb25zdCBzb2NrZXQgPSBSZWZsZWN0LmNvbnN0cnVjdChjdG9yLCBhcmdzLCBuZXdUYXJnZXQpIGFzIFdlYlNvY2tldDtcclxuICAgICAgaWYgKCFpc0tpY2tSZWFsdGltZVVybChhcmdzWzBdKSB8fCBkaXNwb3NlZCkgcmV0dXJuIHNvY2tldDtcclxuICAgICAgY29uc3Qgc29ja2V0SWQgPSArK25leHRTb2NrZXRJZDtcclxuICAgICAgY29uc3Qgb25NZXNzYWdlID0gKGV2ZW50OiBNZXNzYWdlRXZlbnQpOiB2b2lkID0+IHtcclxuICAgICAgICBpZiAoZGlzcG9zZWQgfHwgdHlwZW9mIGV2ZW50LmRhdGEgIT09ICdzdHJpbmcnKSByZXR1cm47XHJcbiAgICAgICAgLy8gQ2VudHJpZnVnZSBjYW4gZGVsaW1pdCBzZXZlcmFsIEpTT04gcHJvdG9jb2wgcmVwbGllcyB3aXRoIG5ld2xpbmVzLlxyXG4gICAgICAgIGZvciAoY29uc3QgcmF3IG9mIGV2ZW50LmRhdGEuc3BsaXQoJ1xcbicpKSB7XHJcbiAgICAgICAgICBjb25zdCBwdWJsaWNhdGlvbiA9IHBhcnNlTmF0aXZlUHVibGljYXRpb24ocmF3KTtcclxuICAgICAgICAgIGlmIChwdWJsaWNhdGlvbikge1xyXG4gICAgICAgICAgICBwdWJsaXNoKHsga2luZDogJ3B1YmxpY2F0aW9uJywgc29ja2V0SWQsIHB1YmxpY2F0aW9uIH0pO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHB1c2ggPSByZWNvcmQocmVjb3JkKEpTT04ucGFyc2UocmF3KSk/LnB1c2gpO1xyXG4gICAgICAgICAgICBpZiAocHVzaD8udW5zdWJzY3JpYmUgJiYgaXNQdWJsaWNDaGF0Q2hhbm5lbChwdXNoLmNoYW5uZWwpKSB7XHJcbiAgICAgICAgICAgICAgcHVibGlzaCh7IGtpbmQ6ICd1bmF2YWlsYWJsZScsIHNvY2tldElkLCBjaGFubmVsOiBwdXNoLmNoYW5uZWwgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0gY2F0Y2ggeyAvKiBNYWxmb3JtZWQvY29udHJvbCB0cmFmZmljIG5ldmVyIGNyb3NzZXMgdGhlIGJvdW5kYXJ5LiAqLyB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgICBjb25zdCBjbGVhbnVwID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgICAgIHNvY2tldC5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgb25NZXNzYWdlKTtcclxuICAgICAgICBzb2NrZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xvc2UnLCBvbkNsb3NlKTtcclxuICAgICAgICBzb2NrZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBvbkNsb3NlKTtcclxuICAgICAgICBjbGVhbnVwcy5kZWxldGUoY2xlYW51cCk7XHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG9uQ2xvc2UgPSAoKTogdm9pZCA9PiB7XHJcbiAgICAgICAgcHVibGlzaCh7IGtpbmQ6ICd1bmF2YWlsYWJsZScsIHNvY2tldElkIH0pO1xyXG4gICAgICAgIGNsZWFudXAoKTtcclxuICAgICAgfTtcclxuICAgICAgY2xlYW51cHMuYWRkKGNsZWFudXApO1xyXG4gICAgICBzb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIG9uTWVzc2FnZSk7XHJcbiAgICAgIHNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIG9uQ2xvc2UpO1xyXG4gICAgICBzb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBvbkNsb3NlKTtcclxuICAgICAgcmV0dXJuIHNvY2tldDtcclxuICAgIH0sXHJcbiAgfSk7XHJcbiAgdGFyZ2V0LldlYlNvY2tldCA9IHdyYXBwZWQ7XHJcbiAgY29uc3QgdGVhcmRvd24gPSAoKTogdm9pZCA9PiB7XHJcbiAgICBkaXNwb3NlZCA9IHRydWU7XHJcbiAgICBmb3IgKGNvbnN0IGNsZWFudXAgb2YgY2xlYW51cHMpIGNsZWFudXAoKTtcclxuICAgIGlmICh0YXJnZXQuV2ViU29ja2V0ID09PSB3cmFwcGVkKSB0YXJnZXQuV2ViU29ja2V0ID0gb3JpZ2luYWw7XHJcbiAgICBpZiAoc3RhdGVbQlJJREdFX1NMT1RdID09PSB0ZWFyZG93bikgZGVsZXRlIHN0YXRlW0JSSURHRV9TTE9UXTtcclxuICB9O1xyXG4gIHN0YXRlW0JSSURHRV9TTE9UXSA9IHRlYXJkb3duO1xyXG4gIHJldHVybiB0ZWFyZG93bjtcclxufVxyXG4iLCAiaW1wb3J0IHsgaW5zdGFsbE5hdGl2ZUNoYXRCcmlkZ2UgfSBmcm9tICcuL25hdGl2ZS1jaGF0LWJyaWRnZSc7XHJcblxyXG5pbnN0YWxsTmF0aXZlQ2hhdEJyaWRnZSgpO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFDTyxNQUFNLG9CQUFvQjtBQWFqQyxNQUFNLFFBQWdCLEVBQUUsSUFBSSxNQUFNLFVBQVUsTUFBTSxjQUFjLE1BQU0sTUFBTSxNQUFNLE1BQU0sS0FBSztBQUM3RixNQUFNLFFBQWdCO0FBQUEsSUFD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
