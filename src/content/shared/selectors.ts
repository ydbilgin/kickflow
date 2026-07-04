// Confirmed live via Playwright inspection of kick.com on 2026-07-04 (see
// docs/superpowers/specs/2026-07-04-kickflow-design.md). Do not swap these for guessed
// alternates (e.g. `.chat-rooms-list`, which does not exist on the live page).
export const SELECTORS = {
  chatMessagesContainer: '#chatroom-messages',
  videoPlayer: '#video-player',
  // Native control bar root. GOTCHA (confirmed live via Playwright against a real stream
  // 2026-07-04): Kick renders THREE elements sharing class `z-controls` —
  //   (1) a top-right "Chat" re-open toggle (`div.z-controls.absolute.right-7.top-7`,
  //       shown only when chat is collapsed; a single button, NO LIVE button, and it lives
  //       OUTSIDE the player wrapper — in the chat panel),
  //   (2) an empty layout layer inside the player (`div.z-controls.relative.grid-row-1`,
  //       ZERO buttons — a positioning wrapper, not the bar), and
  //   (3) the REAL bottom player bar (`div.z-controls.absolute.bottom-0.left-0.flex`,
  //       the play/volume/time/LIVE + settings/fullscreen cluster; 8 buttons incl. LIVE).
  // A bare `document.querySelector('div.z-controls')` returns #1; even scoping to the
  // wrapper returns #2 first (DOM order) — both lack the LIVE anchor, so controls silently
  // never mounted. findControlBar() below selects the bar by its bottom anchor, falling
  // back to whichever wrapper-scoped z-controls actually holds buttons.
  controlBar: 'div.z-controls',
  // The real bottom bar specifically — the only z-controls with the `bottom-0` anchor.
  controlBarBottom: 'div.z-controls.bottom-0',
} as const;

export function getChatMessagesContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.chatMessagesContainer);
}

export function getVideoElement(): HTMLVideoElement | null {
  const el = document.querySelector(SELECTORS.videoPlayer);
  return el instanceof HTMLVideoElement ? el : null;
}

export function findControlBar(): HTMLElement | null {
  // See SELECTORS.controlBar: THREE nodes share `z-controls` (chat toggle, an empty layout
  // layer, and the real bottom bar). Scope EVERYTHING to the player wrapper (#video-player's
  // parent) so DOM order elsewhere on the page can never select the wrong bar — the chat
  // toggle lives outside the wrapper, and a future preview/modal player bar would too.
  const wrapper = findPlayerWrapper();
  if (!wrapper) return null;
  // Primary: the bar's unique bottom anchor, scoped to this player.
  const bottom = wrapper.querySelector<HTMLElement>(SELECTORS.controlBarBottom);
  if (bottom) return bottom;
  // Fallback if Kick drops the `bottom-0` utility: among the z-controls inside the wrapper,
  // pick the one that actually holds buttons — and, of those, the richest cluster — never
  // the empty layout layer.
  const bars = Array.from(wrapper.querySelectorAll<HTMLElement>(SELECTORS.controlBar))
    .filter((bar) => bar.querySelector('button'));
  if (bars.length === 0) return null;
  return bars.reduce((best, bar) =>
    bar.querySelectorAll('button').length > best.querySelectorAll('button').length ? bar : best,
  );
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
