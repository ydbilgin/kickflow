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

/** The direct DOM parent of #video-player — Kick's `position:relative` wrapper that the
 * (`absolute`-positioned) control bar is anchored within. Exists as soon as the video
 * element does, before the control bar has necessarily rendered, and — unlike the bar
 * itself — is never replaced by a bar re-render/fullscreen toggle. Used by
 * player/native-bar.ts as a STABLE MutationObserver root so mounting can retry until the
 * bar appears, and survives the bar being fully replaced later in the session. */
export function findPlayerWrapper(): HTMLElement | null {
  return getVideoElement()?.parentElement ?? null;
}

/** Best-effort text-content lookup rather than a guessed class name (confirmed live: the
 * jump-to-live control has no testable attributes, just visible "LIVE" text). Strictly
 * scoped to WITHIN the control bar — no document-wide fallback — so this can never match
 * an unrelated button elsewhere on the page that happens to say "LIVE" (e.g. a stream
 * status badge). Relied on by player/native-bar.ts as the anchor to inject KickFlow's own
 * controls after. */
export function findLiveButton(): HTMLElement | null {
  const bar = findControlBar();
  if (!bar) return null;
  const candidates = bar.querySelectorAll<HTMLElement>('button');
  for (const el of candidates) {
    if (el.textContent?.trim().toUpperCase() === 'LIVE') return el;
  }
  return null;
}

// UNCONFIRMED: the settings/quality button is icon-only with no aria-label anywhere in
// the control bar (checked live) — there is no reliable selector for it, and a positional
// guess was tried and removed from quality-lock.ts (risked toggling the wrong control,
// e.g. fullscreen/captions, with no safe undo). quality-lock.ts relies solely on writing
// Kick's own `stream_quality` sessionStorage key instead; a real UI selector is future
// work, once one is actually confirmed.
