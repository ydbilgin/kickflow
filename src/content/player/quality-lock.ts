import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

// Kick stores the active stream quality in sessionStorage and resets it to "Auto" every
// session (confirmed prior art: github.com/firatmelih/kick-anti-auto-quality). This is
// the ONLY mechanism here. A positional UI fallback (clicking an unverified button in the
// control bar's right-hand cluster, hoping it was the settings/quality control) was tried
// and removed: it clicked before proving the target was correct, and Escape does not
// reliably undo a real side effect on the wrong control (captions/PiP/theater/fullscreen)
// — an unacceptable risk on the user's live player. A real UI quality selector is future
// work, only once Kick's settings control has an actually-verified selector, not a
// positional guess.
const SESSION_STORAGE_KEY = 'stream_quality';
const HIGHEST_QUALITY_GUESS = '1080p60';

const PREFERENCE_STORAGE_KEY = 'kickflow.qualityPreference';

function applySessionStorageQuality(): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, HIGHEST_QUALITY_GUESS);
    logger.debug('quality-lock: wrote sessionStorage', SESSION_STORAGE_KEY, '=', HIGHEST_QUALITY_GUESS);
  } catch (error) {
    logger.warn('quality-lock: sessionStorage write failed', error);
  }
}

/** Preference is currently always "highest" — persisted for forward-compatibility with a
 * future settings UI, not read back to change behavior yet. */
async function ensurePreferenceStored(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PREFERENCE_STORAGE_KEY);
    if (!(PREFERENCE_STORAGE_KEY in stored)) {
      await chrome.storage.local.set({ [PREFERENCE_STORAGE_KEY]: 'highest' });
    }
  } catch (error) {
    logger.warn('quality-lock: preference read/write failed (non-fatal)', error);
  }
}

/** Event-driven only, no polling loops: applies once on mount and again on every
 * `loadstart` (Kick resets stream_quality to Auto on every new source load). The write is
 * silent/cheap so it's safe to repeat.
 *
 * Does NOT attempt the HLS `currentLevel` API — that needs the page's own hls.js
 * instance, which an isolated-world content script cannot reach without a MAIN-world
 * bridge. Possible phase-2 improvement if that instance is ever confirmed reachable. */
export function initQualityLock(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.warn('quality-lock: #video-player not found, skipping');
    return;
  }

  void ensurePreferenceStored();

  applySessionStorageQuality();
  lifecycle.addEventListener(video, 'loadstart', applySessionStorageQuality);
}
