export interface FeatureFlags {
  /** Chat rendering mode: native augment keeps Kick's chat; own renders KickFlow's overlay list. */
  chatMode: 'native' | 'own';
  /** Gates debug/info logging plus the unknown-Pusher-event logger. Off by default. */
  debugLogging: boolean;
  /** Deleted-message display: preserve deleted messages in place, struck-through, with their
   * ORIGINAL text (from our own message store) — strictly better than Mo'Kick's
   * "Deleted by a moderator" placeholder. On now that the delete event name is confirmed
   * (`App\Events\MessageDeletedEvent`, from Mo'Kick's shipping source) in pusher-client.ts. */
  showDeletedMessages: boolean;
  /** Ban preservation: when Kick removes banned users' native rows, render them inside a
   * surviving virtualized row wrapper or a small fallback strip. */
  preserveBansInline: boolean;
  /** Show new subscription events in KickFlow's own chat list. */
  showSubscriptions: boolean;
  /** Show new gifted-subscription events in KickFlow's own chat list. */
  showGiftedSubs: boolean;
  /** Show new host and raid events in KickFlow's own chat list. */
  showHostRaid: boolean;
  /** Show the latest pinned chat message above KickFlow's own scrolling list. */
  showPinnedMessage: boolean;
  /** Show rows describing chatroom mode changes after the initial state snapshot. */
  showModeChanges: boolean;
  /** Refresh native followed-channel sidebar viewer counts and live indicators. */
  showSidebarRefresh: boolean;
  /** Mini mod-log panel — Phase 2, UI intentionally not implemented. Stub flag only. */
  modLogPanel: boolean;
}

export const featureFlags: FeatureFlags = {
  chatMode: 'native',
  debugLogging: false,
  showDeletedMessages: true,
  preserveBansInline: true,
  showSubscriptions: true,
  showGiftedSubs: true,
  showHostRaid: true,
  showPinnedMessage: true,
  showModeChanges: true,
  showSidebarRefresh: true,
  modLogPanel: false,
};

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  featureFlags[key] = value;
}
