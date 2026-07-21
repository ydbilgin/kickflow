import type { RoleHighlightStyle } from './message-highlight';

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
  /** Show Kicks gift events (paid gifts) in KickFlow's own chat list. */
  showKicks: boolean;
  /** Reserved default-on native-poll preference. Native polls remain unconditionally visible in
   * this geometry-only version because hiding only the poll requires a stable poll-root selector;
   * hiding the event stack would also hide pins, goals, and pinned Kicks. */
  showPolls: boolean;
  /** Show new host and raid events in KickFlow's own chat list. */
  showHostRaid: boolean;
  /** Show rows describing chatroom mode changes after the initial state snapshot. */
  showModeChanges: boolean;
  /** Refresh native followed-channel sidebar viewer counts and live indicators. */
  showSidebarRefresh: boolean;
  /** Show session removed-message evidence beside Kick's native Active Chatters rows. */
  showChattersBadges: boolean;
  /** Automatically enter Kick's theater layout when a channel/video loads. Opt-in because it
   * changes the page layout rather than only augmenting it. */
  autoTheater: boolean;
  /** Clear Kick's persisted auto-caption preference at each player session and turn off an
   * already-restored native caption state once. Manual in-session use remains available. */
  captionGuard: boolean;
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
  /** Highlight chat rows that @-mention the owner or reply to the owner's messages. */
  mentionHighlightEnabled: boolean;
  /** Personal-attention visual style. */
  mentionHighlightStyle: 'frame' | 'fill' | 'both';
  /** Personal-attention accent color (hex). Guardrailed via sanitizeHighlightColor on write. */
  mentionHighlightColor: string;
  /** Shared moderator/VIP visual style: bar only (`frame`) or bar plus faint fill (`both`). */
  roleHighlightStyle: RoleHighlightStyle;
  /** Enables the moderator role treatment (bar, and fill when style is `both`). Legacy name retained for storage compatibility. */
  modFrameEnabled: boolean;
  /** Moderator accent color (hex). Guardrailed via sanitizeHighlightColor on write. */
  modFrameColor: string;
  /** Enables the VIP role treatment (beats mod when both). Legacy name retained for storage compatibility. */
  vipFrameEnabled: boolean;
  /** VIP accent color (hex). Guardrailed via sanitizeHighlightColor on write. */
  vipFrameColor: string;
  /** Manual Kick username override for mention/reply detection (wins over DOM identity). */
  manualUsername: string;
}

export const featureFlags: FeatureFlags = {
  chatMode: 'native',
  debugLogging: false,
  showDeletedMessages: true,
  preserveBansInline: true,
  showSubscriptions: true,
  showGiftedSubs: true,
  showKicks: true,
  showPolls: true,
  showHostRaid: true,
  showModeChanges: true,
  showSidebarRefresh: true,
  showChattersBadges: true,
  autoTheater: false,
  captionGuard: true,
  rewindControls: true,
  liveCatchup: true,
  qualityLock: true,
  screenshot: true,
  speedControls: true,
  modLogPanel: false,
  mentionHighlightEnabled: true,
  mentionHighlightStyle: 'both',
  mentionHighlightColor: '#FFC94D',
  roleHighlightStyle: 'frame',
  modFrameEnabled: true,
  modFrameColor: '#14B8A6',
  vipFrameEnabled: true,
  vipFrameColor: '#EC4899',
  manualUsername: '',
};

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  featureFlags[key] = value;
}
