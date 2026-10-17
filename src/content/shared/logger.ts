let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

// debug/info are silent unless the debug flag is on; warn/error stay visible by default
// so unconfirmed-shape problems (ban payload, missing player selectors) surface without
// the user having to flip a flag first.
export const logger = {
  debug(...args: unknown[]): void {
    if (debugEnabled) console.debug('[KickFlow]', ...args);
  },
  info(...args: unknown[]): void {
    if (debugEnabled) console.info('[KickFlow]', ...args);
  },
  warn(...args: unknown[]): void {
    console.warn('[KickFlow]', ...args);
  },
  error(...args: unknown[]): void {
    console.error('[KickFlow]', ...args);
  },
};
