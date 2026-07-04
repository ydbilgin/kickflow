import { logger } from '../shared/logger';
import { findLiveButton, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

const OBSERVER_DEBOUNCE_MS = 150;
const KICKFLOW_ID_PREFIX = 'kickflow-';

/** Anchor to insert after: the last already-mounted KickFlow control group if one
 * exists, else Kick's native LIVE button itself. Scanning forward through consecutive
 * `kickflow-*`-id siblings (instead of always inserting right after LIVE) keeps multiple
 * mounted groups in stable, deterministic left-to-right order regardless of mount order
 * or how many times the bar has been re-rendered. */
function findInsertionAnchor(): HTMLElement | null {
  const liveButton = findLiveButton();
  const parent = liveButton?.parentElement;
  if (!liveButton || !parent) return null;

  const siblings = Array.from(parent.children);
  const liveIndex = siblings.indexOf(liveButton);
  let anchor: Element = liveButton;
  for (let i = liveIndex + 1; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling instanceof HTMLElement && sibling.id.startsWith(KICKFLOW_ID_PREFIX)) {
      anchor = sibling;
    } else {
      break;
    }
  }
  return anchor instanceof HTMLElement ? anchor : null;
}

/**
 * Idempotently mounts `build()`'s element (tagged with `id`) into Kick's native control
 * bar, right after the LIVE button (or after the last already-mounted KickFlow group).
 * Never mounts a second copy — `document.getElementById(id)` is checked before every
 * (re-)mount, which is the exact guard MoKick's shipped "two buttons appear" bug lacked.
 *
 * The persistence observer is scoped to the VIDEO'S PARENT WRAPPER (findPlayerWrapper),
 * not the control bar node itself — deliberately:
 *  - The wrapper exists as soon as `#video-player` does, so if the bar hasn't rendered
 *    yet on the first `ensure()` attempt, the observer is already watching and will pick
 *    up the bar's later insertion (no permanent give-up on first miss).
 *  - The wrapper also survives the bar being fully REPLACED (fullscreen toggle / Kick
 *    SPA re-render can swap out the whole `.z-controls` node, not just its children) —
 *    an observer attached to the bar itself would be left watching a detached node and
 *    never fire again. Observing one level up, with `subtree: true`, catches both "bar
 *    gained/lost children" and "bar node itself replaced" the same way.
 *
 * Debounced (~150ms) so a burst of unrelated bar mutations only triggers one re-check.
 * Only gives up via Lifecycle teardown (channel change) — never permanently on a single
 * missed attempt.
 *
 * Returns the element mounted on the FIRST attempt, or null if it wasn't mountable yet
 * (the observer keeps retrying in the background) or if there's no video element parent
 * to observe at all (no-op + warn — there is deliberately no floating-overlay fallback
 * here; that approach was tried and rejected).
 */
export function mountIntoControlBar(lifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
  const ensure = (): HTMLElement | null => {
    const existing = document.getElementById(id);
    if (existing) return existing;

    const anchor = findInsertionAnchor();
    if (!anchor) return null;

    const element = build();
    element.id = id;
    anchor.insertAdjacentElement('afterend', element);
    return element;
  };

  const wrapper = findPlayerWrapper();
  if (!wrapper) {
    logger.warn('native-bar: #video-player has no parent to observe, cannot mount', id);
    return null;
  }

  let debounceTimer: number | null = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      ensure();
    }, OBSERVER_DEBOUNCE_MS);
  });
  observer.observe(wrapper, { childList: true, subtree: true });
  lifecycle.add(() => {
    observer.disconnect();
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  });

  lifecycle.add(() => document.getElementById(id)?.remove());

  const initial = ensure();
  if (!initial) {
    logger.debug('native-bar: control bar/LIVE button not present yet for', id, '- will mount once it appears');
  }
  return initial;
}
