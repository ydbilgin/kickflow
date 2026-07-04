import { logger } from '../shared/logger';
import { findControlBar, findLiveButton } from '../shared/selectors';
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
 * Kick re-renders `.z-controls` on navigation/fullscreen toggle, which can silently drop
 * anything injected into it. A narrow, debounced MutationObserver scoped to the control
 * bar itself (NOT document.body) re-runs the idempotent ensure() so injected controls
 * survive those re-renders, without the cost/risk of a page-wide observer.
 *
 * Returns the mounted element, or null if the control bar/LIVE button couldn't be found
 * (no-op + warn — there is deliberately no floating-overlay fallback here; that approach
 * was tried and rejected).
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

  const initial = ensure();
  if (!initial) {
    logger.warn('native-bar: control bar / LIVE button not found, skipping mount for', id);
    return null;
  }

  const bar = findControlBar();
  if (bar) {
    let debounceTimer: number | null = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        ensure();
      }, OBSERVER_DEBOUNCE_MS);
    });
    observer.observe(bar, { childList: true, subtree: true });
    lifecycle.add(() => {
      observer.disconnect();
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    });
  }

  lifecycle.add(() => document.getElementById(id)?.remove());

  return initial;
}
