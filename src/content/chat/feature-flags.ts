export interface FeatureFlags {
  /** Gates debug/info logging plus the unknown-Pusher-event logger. Off by default. */
  debugLogging: boolean;
  /** Deleted-message display: preserve deleted messages in place, struck-through, with their
   * ORIGINAL text (from our own message store) — strictly better than Mo'Kick's
   * "Deleted by a moderator" placeholder. On now that the delete event name is confirmed
   * (`App\Events\MessageDeletedEvent`, from Mo'Kick's shipping source) in pusher-client.ts. */
  showDeletedMessages: boolean;
  /** Mini mod-log panel — Phase 2, UI intentionally not implemented. Stub flag only. */
  modLogPanel: boolean;
}

export const featureFlags: FeatureFlags = {
  debugLogging: false,
  showDeletedMessages: true,
  modLogPanel: false,
};

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  featureFlags[key] = value;
}
