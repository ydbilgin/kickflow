/** Lightweight, single-source status the popup reads over runtime messaging. Updated at a few
 * key points in bootstrap.ts (navigation, id resolution, Pusher connect, activation, ban); the
 * live message/preserved counts are computed on demand from the DOM in the message bridge, so
 * they never need to be pushed here. */
export interface KickFlowStatus {
  slug: string | null;
  chatroomId: number | null;
  /** True only once the primary chatroom subscription—not merely the socket—is ready. */
  active: boolean;
  /** Human-readable current state — the key value the popup surfaces (esp. WHY it fell to native). */
  reason: string;
  pusherConnected: boolean;
  /** Epoch ms of the last observed UserBannedEvent, or null. */
  lastBanAt: number | null;
}

/** Read-only, on-demand snapshot shared by the popup bridge and the in-page dashboard. Counts
 * are derived from the currently rendered chat DOM so both surfaces report the same tab state. */
export interface KickFlowStatusSnapshot extends KickFlowStatus {
  messageCount: number;
  preservedCount: number;
  bannedCount: number;
  deletedCount: number;
  ghostAnchored: number;
  ghostPendingNoAnchor: number;
  ghostStrip: number;
  ghostEvicted: number;
}

export type StatusSnapshotProvider = () => KickFlowStatusSnapshot;

const status: KickFlowStatus = {
  slug: null,
  chatroomId: null,
  active: false,
  reason: 'başlatılıyor',
  pusherConnected: false,
  lastBanAt: null,
};

export function setStatus(patch: Partial<KickFlowStatus>): void {
  Object.assign(status, patch);
}

export function getStatus(): KickFlowStatus {
  return { ...status };
}

/** Reset for a new session/channel. */
export function resetStatus(slug: string | null): void {
  status.slug = slug;
  status.chatroomId = null;
  status.active = false;
  status.reason = slug ? 'kanal çözülüyor…' : 'kanal sayfası değil';
  status.pusherConnected = false;
  status.lastBanAt = null;
}
