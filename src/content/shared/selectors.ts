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

function normalizeLiveButtonText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LIVE_EDGE_LABELS = new Set(['LIVE', 'CANLI']);
const GO_TO_LIVE_PHRASES = [
  'GO TO LIVE',
  'GO LIVE',
  'JUMP TO LIVE',
  'CANLI YAYINA',
  'YAYINA GEC',
] as const;

/** Best-effort text-content lookup rather than a guessed class name (confirmed live: the
 * jump-to-live control has no stable testable attributes, only stateful visible text).
 * Turkish labels come from the owner's 2026-07-10 screenshot; diacritic folding keeps
 * `Canlı Yayına Geç` independent of Turkish/English uppercase rules. Strictly scoped to
 * WITHIN the active control bar — no document-wide fallback — so an unrelated LIVE badge
 * elsewhere on the page can never become KickFlow's insertion anchor. */
export function findLiveButton(): HTMLElement | null {
  const bar = findControlBar();
  if (!bar) return null;
  const candidates = bar.querySelectorAll<HTMLElement>('button');
  for (const el of candidates) {
    // Once mounted, KickFlow also contributes a button labelled CANLI to this bar. It is
    // never a valid native insertion anchor, especially if Kick switches to an as-yet
    // unknown locale while the existing KickFlow group remains connected.
    if (el.closest('[id^="kickflow-"]')) continue;
    const text = normalizeLiveButtonText(el.textContent ?? '');
    if (LIVE_EDGE_LABELS.has(text) || GO_TO_LIVE_PHRASES.some((phrase) => text.includes(phrase))) {
      return el;
    }
  }
  return null;
}

// The settings/quality button is icon-only with no aria-label anywhere in the control bar
// (checked live). quality-lock.ts therefore identifies its confirmed cog SVG path and
// deliberately has no positional fallback, which could press fullscreen/captions instead.
