// Confirmed live via Playwright inspection of kick.com on 2026-07-04 (see
// docs/superpowers/specs/2026-07-04-kickflow-design.md). Do not swap these for guessed
// alternates (e.g. `.chat-rooms-list`, which does not exist on the live page).
export const SELECTORS = {
  chatMessagesContainer: '#chatroom-messages',
  videoPlayer: '#video-player',
} as const;

// UNCONFIRMED at time of writing: Kick's quality-selector and native rewind seek-bar are
// icon-only with no aria-labels, so no stable selector was found during live inspection.
// These are placeholders — quality-lock.ts and rewind-hotkeys.ts must fail gracefully
// (log + no-op) if they don't resolve to a real element. Update once confirmed by
// inspecting the live player.
export const UNCONFIRMED_SELECTORS = {
  qualityButton: '[data-testid="player-settings-button"], [aria-label="Settings" i], [aria-label="Quality" i]',
  seekBar: '[data-testid="seek-bar"], input[type="range"][aria-label*="seek" i]',
} as const;

export function getChatMessagesContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.chatMessagesContainer);
}

export function getVideoElement(): HTMLVideoElement | null {
  const el = document.querySelector(SELECTORS.videoPlayer);
  return el instanceof HTMLVideoElement ? el : null;
}

export function findQualityButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(UNCONFIRMED_SELECTORS.qualityButton);
}

export function findSeekBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(UNCONFIRMED_SELECTORS.seekBar);
}

/** Best-effort text-content lookup rather than a guessed class name (no testable
 * attributes were found on the live "LIVE"/jump-to-live control). Not currently relied on
 * by live-catchup.ts, which drives off `video.seekable` instead — kept for future use. */
export function findLiveButton(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>('button');
  for (const el of candidates) {
    if (el.textContent?.trim().toUpperCase() === 'LIVE') return el;
  }
  return null;
}
