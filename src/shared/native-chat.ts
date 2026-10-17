/** Public realtime boundary. Do not add connection, auth or arbitrary packet fields here. */
export const NATIVE_CHAT_EVENT = 'kickflow:native-publication-v1';

export interface PublicChatPublication {
  channel: string;
  event: string;
  data: Record<string, unknown>;
}

export type NativeChatSignal =
  | { kind: 'publication'; socketId: number; publication: PublicChatPublication }
  | { kind: 'unavailable'; socketId: number; channel?: string };

type Schema = { readonly [key: string]: true | Schema | readonly [Schema] };
const actor: Schema = { id: true, username: true, display_name: true, slug: true, name: true };
const badge: Schema = {
  type: true, name: true, text: true, count: true, image_url: true, active: true,
  selected: true, sort_order: true, metadata: { level: true },
};
const message: Schema = {
  id: true, chatroom_id: true, content: true, type: true, created_at: true,
  thread_parent_id: true,
  sender: { ...actor, identity: { color: true, badges: [badge], badges_v2: [badge] } },
  metadata: {
    original_sender: actor,
    original_message: { id: true, content: true, message: true },
    celebration: { type: true, total_months: true },
  },
};
const schemas: Record<string, Schema> = {
  'App\\Events\\ChatMessageEvent': message,
  'App\\Events\\UserBannedEvent': {
    id: true, user_id: true, username: true, user: actor, permanent: true,
    duration: true, duration_min: true, duration_in_minutes: true,
    banned_by: actor, bannedBy: actor, banned_by_user: actor,
    expires_at: true, banned_until: true, expiresAt: true,
  },
  'App\\Events\\MessageDeletedEvent': {
    id: true, message: { id: true }, aiModerated: true, violatedRules: true,
    deleted_by: actor, deletedBy: actor, moderator: actor, moderator_user: actor,
    deleted_by_user: actor, user_deleted_by: actor,
  },
  'App\\Events\\SubscriptionEvent': { chatroom_id: true, username: true, months: true },
  'App\\Events\\ChannelSubscriptionEvent': { channel_id: true, user_ids: true, username: true },
  GiftedSubscriptionsEvent: {
    chatroom_id: true, correlation_id: true, gifted_usernames: true,
    gifter_username: true, gifted_total: true,
  },
  KicksGifted: { gift_transaction_id: true, sender: actor, gift: { amount: true, name: true }, message: true },
  'App\\Events\\StreamHostEvent': { chatroom_id: true, host_username: true, number_viewers: true, optional_message: true },
  'App\\Events\\PinnedMessageCreatedEvent': { message, duration: true, pinnedBy: actor },
  'App\\Events\\ChatroomUpdatedEvent': {
    id: true, slow_mode: { enabled: true, message_interval: true },
    followers_mode: { enabled: true, min_duration: true },
    subscribers_mode: { enabled: true }, emotes_mode: { enabled: true },
  },
};
const stringOrObjectFields = new Set([
  'original_sender', 'original_message', 'banned_by', 'bannedBy', 'banned_by_user',
  'deleted_by', 'deletedBy', 'moderator', 'moderator_user', 'deleted_by_user', 'user_deleted_by',
]);

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function project(raw: Record<string, unknown>, schema: Schema): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, shape] of Object.entries(schema)) {
    let value = raw[key];
    if (key === 'metadata') value = decode(value);
    if (value === undefined) continue;
    if (shape === true) {
      if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) clean[key] = value;
      else if (Array.isArray(value)) clean[key] = value.filter((item) => typeof item === 'string' || typeof item === 'number');
    } else if (Array.isArray(shape)) {
      if (Array.isArray(value)) clean[key] = value.flatMap((item) => {
        const r = record(item);
        return r ? [project(r, shape[0])] : [];
      });
    } else {
      const r = record(value);
      if (r) clean[key] = project(r, shape as Schema);
      // These captured public fields also accept a bare display string.
      else if (typeof value === 'string' && stringOrObjectFields.has(key)) clean[key] = value;
    }
  }
  return clean;
}

export function isPublicChatChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && /^(?:chatrooms\.[1-9]\d*\.v2|channel\.[1-9]\d*|chatroom_[1-9]\d*|channel_[1-9]\d*)$/.test(channel);
}

export function sanitizePublicChatPublication(raw: unknown): PublicChatPublication | null {
  const frame = record(raw);
  if (!frame || !isPublicChatChannel(frame.channel) || typeof frame.event !== 'string') return null;
  const schema = Object.prototype.hasOwnProperty.call(schemas, frame.event) ? schemas[frame.event] : undefined;
  const payload = record(decode(frame.data));
  if (!schema || !payload) return null;
  return { channel: frame.channel, event: frame.event, data: project(payload, schema) };
}

export function parseNativePublication(raw: unknown): PublicChatPublication | null {
  const push = record(record(decode(raw))?.push);
  const data = record(record(push?.pub)?.data);
  return push && data ? sanitizePublicChatPublication({ channel: push.channel, event: data.event, data: data.data }) : null;
}
