// Confirmed live via Playwright inspection of kick.com on 2026-07-04 (see
// docs/superpowers/specs/2026-07-04-kickflow-design.md). Do not swap these for guessed
// alternates (e.g. `.chat-rooms-list`, which does not exist on the live page).
export const SELECTORS = {
  // Fresh public Kick bundle read 2026-10-17; runtime DOM is INFERRED.
  // Evidence and inference boundaries: tests/fixtures/daily-reward-2026-10.html.
  dailyRewardCta: 'video[src*="reward-available-CTA"]',
  dailyRewardDialog: '[role="dialog"], [role="alertdialog"], dialog',
  dailyRewardExcludedSurface: '#rewards-panel, #drops-panel',
  dailyRewardStage: '[class~="aspect-[1348/1080]"], [class~="aspect-1348/1080"]',
  dailyRewardMediaStage: 'div.relative.w-full.overflow-hidden.rounded-md.bg-black',
  dailyRewardFullWidthButton: 'button.w-full',
  // Current footer imports module 888724 (bg-primary-base); retain the older Button style.
  dailyRewardPrimaryButton: 'button.bg-primary-base, button.bg-brand-bg-default',
  dailyRewardCloseLabel: 'button span.sr-only',
  dailyRewardHidden: '[hidden], [aria-hidden="true"], [inert]',
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
  // Shipped by Kick's visible caption control on 2026-07-21. Unlike its localized tooltip and
  // state-dependent SVG, this developer-facing test id is shared by desktop/mobile player bars.
  nativeCaptionButton: 'button[data-testid="video-player-closed-captions"]',
  nativeFullscreenButton: 'button[data-testid="video-player-fullscreen"]',
} as const;

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
    // The upper z-controls layer also contains the logged-out HD trial promotion. Its
    // two CTA buttons can mount before the transport bar; they are not player controls.
    .filter((bar) => !bar.classList.contains('grid-row-1') && bar.querySelector('button'));
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

export const LIVE_EDGE_LABELS = new Set(['LIVE', 'CANLI']);
export const GO_TO_LIVE_PHRASES = [
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

/** Keep the live anchor when present. Recorded players have transport/time controls but no
 * LIVE button: use the final native child of their left group instead. A separate native
 * fullscreen group and at least two transport buttons are required, so an arbitrary bar
 * button (or KickFlow's own CANLI button) cannot turn into an insertion point.
 * Native group structure measured 2026-10-13:
 * a recorded VOD page (2026-10). */
export function findControlBarInsertionAnchor(): HTMLElement | null {
  const live = findLiveButton();
  if (live) return live;
  const bar = findControlBar();
  if (!bar) return null;
  const fullscreen = bar.querySelector<HTMLElement>(SELECTORS.nativeFullscreenButton);
  if (!fullscreen || fullscreen.closest('[id^="kickflow-"]')) return null;
  let rightGroup = fullscreen.parentElement;
  while (rightGroup && rightGroup.parentElement !== bar) rightGroup = rightGroup.parentElement;
  if (!(rightGroup instanceof HTMLDivElement)) return null;
  const leftGroup = bar.firstElementChild;
  if (!(leftGroup instanceof HTMLDivElement) || leftGroup === rightGroup
    || !leftGroup.classList.contains('flex') || !leftGroup.classList.contains('items-center')) return null;
  const nativeButtons = Array.from(leftGroup.querySelectorAll('button'))
    .filter((button) => !button.closest('[id^="kickflow-"]'));
  if (nativeButtons.length < 2) return null;
  const children = Array.from(leftGroup.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && !child.id.startsWith('kickflow-'));
  return children[children.length - 1] ?? null;
}

// The settings/quality button is icon-only with no aria-label anywhere in the control bar
// (checked live). quality-lock.ts tries confirmed cog paths and bounded trailing icon-only
// candidates, then confirms each candidate from the resolution rows its menu actually opens.

/** Active-chatters surface. The search input is the anchor from Kick's 2026-07-19 bundle.
 * The panel class list is the preferred shape. Kick changed that class list (2026-10-15), so
 * discovery walks ancestors of the input, and row matching falls back to list structure. */
export const ACTIVE_CHATTERS_PANEL_SELECTOR =
  'section.bg-surface-base.flex.size-full.min-h-0.flex-col.overflow-hidden.text-white';
export const ACTIVE_CHATTERS_SEARCH_SELECTOR = 'input[type="search"].h-8.pl-11.pr-3';
export const ACTIVE_CHATTERS_ROW_SELECTOR =
  'ul.flex.list-none.flex-col.overflow-hidden.p-0 > li > button.flex.h-auto.w-full';
export const ACTIVE_CHATTERS_USERNAME_SELECTOR =
  'span.min-w-0.flex-1.truncate.text-base.font-normal.leading-6';
/** Looser row shape used when the exact class string misses. 2026-10-15. */
export const ACTIVE_CHATTERS_ROW_FALLBACK_SELECTOR = 'ul > li > button';
export const ACTIVE_CHATTERS_USERNAME_FALLBACK_SELECTOR = 'span.truncate';

/** True for Kick drops routes. The navbar daily-reward CTA is on every page; these routes
 * render their own rewards surfaces, so the claimer must not start an attempt. 2026-10-15. */
export function isDropsRoutePath(pathname: string): boolean {
  return pathname === '/drops' || pathname.startsWith('/drops/');
}
