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
  /** Show rows describing chatroom mode changes after the initial state snapshot. */
  showModeChanges: boolean;
  /** Refresh native followed-channel sidebar viewer counts and live indicators. */
  showSidebarRefresh: boolean;
  /** Automatically enter Kick's theater layout when a channel/video loads. Opt-in because it
   * changes the page layout rather than only augmenting it. */
  autoTheater: boolean;
  /** Show the 10-second rewind/forward controls and enable their configured hotkeys. */
  rewindControls: boolean;
  /** Show the CANLI/behind-live control and run automatic catch-up. */
  liveCatchup: boolean;
  /** Select the highest currently available stream quality after media loads. */
  qualityLock: boolean;
  /** Show frame capture and enable its configured hotkey. */
  screenshot: boolean;
  /** Show manual/automatic playback-speed controls. */
  speedControls: boolean;
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
  showModeChanges: true,
  showSidebarRefresh: true,
  autoTheater: false,
  rewindControls: true,
  liveCatchup: true,
  qualityLock: true,
  screenshot: true,
  speedControls: true,
  modLogPanel: false,
};

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  featureFlags[key] = value;
}
