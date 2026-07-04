// Confirmed live via Playwright inspection of kick.com on 2026-07-04 (see
// docs/superpowers/specs/2026-07-04-kickflow-design.md). Do not swap these for guessed
// alternates (e.g. `.chat-rooms-list`, which does not exist on the live page).
export const SELECTORS = {
  chatMessagesContainer: '#chatroom-messages',
  videoPlayer: '#video-player',
  // Native control bar root — confirmed live 2026-07-04 (full-width flex row,
  // justify-between, contains the left play/volume/time/LIVE cluster and a right-hand
  // settings/fullscreen cluster).
  controlBar: 'div.z-controls',
} as const;

export function getChatMessagesContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.chatMessagesContainer);
}

export function getVideoElement(): HTMLVideoElement | null {
  const el = document.querySelector(SELECTORS.videoPlayer);
  return el instanceof HTMLVideoElement ? el : null;
}

export function findControlBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.controlBar);
}

/** Best-effort text-content lookup rather than a guessed class name (confirmed live: the
 * jump-to-live control has no testable attributes, just visible "LIVE" text). Scoped to
 * the control bar first (its confirmed location) with a document-wide fallback. Relied on
 * by player/native-bar.ts as the anchor to inject KickFlow's own controls after. */
export function findLiveButton(): HTMLElement | null {
  const scope = findControlBar() ?? document;
  const candidates = scope.querySelectorAll<HTMLElement>('button');
  for (const el of candidates) {
    if (el.textContent?.trim().toUpperCase() === 'LIVE') return el;
  }
  return null;
}

// UNCONFIRMED: the settings/quality button is icon-only with no aria-label anywhere in
// the control bar (checked live) — there is no reliable selector for it. quality-lock.ts's
// UI fallback instead guesses a position (second-to-last button in the bar's right-hand
// cluster) and backs out gracefully if it doesn't open a quality menu. Its primary
// mechanism (writing Kick's own `stream_quality` sessionStorage key) does not depend on
// this at all.
