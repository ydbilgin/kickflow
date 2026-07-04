export interface FeatureFlags {
  /** Gates debug/info logging plus the unknown-Pusher-event logger. Off by default. */
  debugLogging: boolean;
  /** Deleted-message display. Off by default — the delete event name is unconfirmed
   * (best-effort guess in pusher-client.ts); flip manually once confirmed in real use. */
  showDeletedMessages: boolean;
  /** Mini mod-log panel — Phase 2, UI intentionally not implemented. Stub flag only. */
  modLogPanel: boolean;
}

export const featureFlags: FeatureFlags = {
  debugLogging: false,
  showDeletedMessages: false,
  modLogPanel: false,
};

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  featureFlags[key] = value;
}
