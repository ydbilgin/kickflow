import type {Lifecycle} from '../shared/lifecycle';
import {findControlBar, findPlayerWrapper, getVideoElement} from '../shared/selectors';
import {subscribeLang,t} from '../shared/i18n';
import {CONTROLS_IDLE_MS, inBottomArea} from './bar-chrome.js';
import {onlyChatMutations} from '../shared/coalesce';

export {CONTROLS_IDLE_MS, inBottomArea};

/** Set by quality-lock on the native gear while it inspects the quality menu out of sight.
 * That open menu is KickFlow's own hidden inspection, not the viewer's, so it must not hold
 * or reveal the bar (2026-10-29: every 30 s recheck showed the bar with the mouse still). */
export const QUALITY_PROBE_TRIGGER_ATTRIBUTE = 'data-kickflow-quality-probe-trigger';
/** Marks the clipping shelf Kick nests its bar in, so the stylesheet can unclip it without a
 * `div:has(> div.z-controls.bottom-0)` rule. That rule made every DOM insertion on the page
 * (each chat row) restyle the whole document: 54 ms per row, measured 2026-11-09. */
export const BAR_SHELF_ATTRIBUTE = 'data-kickflow-bar-shelf';
const BAR_SELECTOR = 'div.z-controls.bottom-0';

/** Own the presentation state, while Kick continues to own every native action. Mouse focus
 * left by automatic quality selection is not keyboard focus and cannot pin the bar. */
export function initControlsVisibility(lifecycle: Lifecycle): void {
  let visible = false, keyboard = false, timer: number | null = null, disposed = false;
  let host: HTMLElement | null = null;
  let holding = false;
  const addedAttributes = new Map<string,string>();
  let shelves = new Set<HTMLElement>();
  /** Every div inside the host whose direct child is the bar: exactly what the replaced rule
   * matched. Runs in the mutation callback, before paint, so no frame shows the bar clipped. */
  const syncShelves = () => {
    const next = new Set<HTMLElement>();
    if (host) {
      for (const bar of host.querySelectorAll<HTMLElement>(BAR_SELECTOR)) {
        const shelf = bar.parentElement;
        if (shelf && shelf !== host && shelf.localName === 'div') next.add(shelf);
      }
    }
    for (const shelf of shelves) if (!next.has(shelf)) shelf.removeAttribute(BAR_SHELF_ATTRIBUTE);
    for (const shelf of next) if (!shelf.hasAttribute(BAR_SHELF_ATTRIBUTE)) shelf.setAttribute(BAR_SHELF_ATTRIBUTE, '');
    shelves = next;
  };
  const releaseHost = () => {
    for (const shelf of shelves) shelf.removeAttribute(BAR_SHELF_ATTRIBUTE);
    shelves = new Set();
    host?.removeAttribute('data-kickflow-controls');
    for (const [name,value] of addedAttributes) if (host?.getAttribute(name) === value) host.removeAttribute(name);
    addedAttributes.clear();
  };
  const cancel = () => {if (timer !== null) window.clearTimeout(timer); timer = null;};
  const menuOpen = () => !!findControlBar()?.querySelector(`:is([aria-expanded="true"], [data-state="open"][aria-haspopup]):not([${QUALITY_PROBE_TRIGGER_ATTRIBUTE}])`)
    || !!host?.querySelector('.kickflow-player-menu');
  const focused = () => keyboard && !!document.activeElement &&
    (host === document.activeElement || !!findControlBar()?.contains(document.activeElement) || !!host?.querySelector('.kickflow-player-menu')?.contains(document.activeElement));
  const held = () => {const video = getVideoElement();return !!video && (video.paused || video.ended || focused() || menuOpen());};
  const wakeNative = () => {
    if (!host) return;
    const r = host.getBoundingClientRect();
    host.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom - 12}));
  };
  const paint = () => {
    const next = findPlayerWrapper();
    if (host !== next) {
      releaseHost(); host = next;
      for (const [name,value] of [['tabindex','0'],['role','group'],['aria-label',t('player.controls')]]) {
        if (host && !host.hasAttribute(name!)) {host.setAttribute(name!,value!);addedAttributes.set(name!,value!);}
      }
    }
    const state = visible ? 'shown' : 'hidden';
    if (host?.getAttribute('data-kickflow-controls') !== state) host?.setAttribute('data-kickflow-controls', state);
    syncShelves();
    host?.dispatchEvent(new Event('kickflow:controlsvisibility'));
  };
  const arm = () => {
    cancel();
    holding = held();
    // Renew a held native bar BEFORE Kick's own four-second unmount removes its trigger/focus.
    const delay = holding ? 2000 : CONTROLS_IDLE_MS;
    timer = window.setTimeout(() => {
      timer = null;
      if (held() && document.visibilityState !== 'hidden') {visible = true; wakeNative(); paint(); arm();}
      else {visible = false; paint();}
    }, delay);
  };
  const show = () => {visible = true; paint(); if (!findControlBar() || held()) wakeNative(); arm();};
  const hide = () => {cancel(); holding = false; visible = false; paint();};
  const move = (event: Event) => {
    const e = event as MouseEvent;
    const wrapper = findPlayerWrapper(); if (!wrapper) return;
    if (inBottomArea(wrapper.getBoundingClientRect(), e.clientX, e.clientY, findControlBar()?.getBoundingClientRect().height)) show();
  };
  lifecycle.addEventListener(document, 'pointermove', move, true);
  lifecycle.addEventListener(document, 'pointerdown', () => {keyboard = false;}, true);
  lifecycle.addEventListener(document, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Tab') keyboard = true;
    if (focused()) show();
  }, true);
  lifecycle.addEventListener(document, 'focusin', () => {if (focused()) show();});
  lifecycle.addEventListener(document, 'focusout', () => {if (!held()) arm();});
  lifecycle.addEventListener(document, 'pointerout', (event) => {
    const e = event as PointerEvent, wrapper = findPlayerWrapper();
    if (wrapper?.contains(e.target as Node) && !wrapper.contains(e.relatedTarget as Node) && !held()) hide();
    if (!e.relatedTarget && !held()) hide();
  }, true);
  lifecycle.addEventListener(window, 'blur', () => {keyboard = false; hide();});
  lifecycle.addEventListener(document, 'visibilitychange', () => {
    keyboard = false; if (document.visibilityState === 'hidden') hide(); else if (held()) show(); else hide();
  });
  const reset = () => {if (held()) show(); else hide();};
  lifecycle.addEventListener(document, 'fullscreenchange', reset);
  lifecycle.addEventListener(window, 'resize', reset);
  for (const type of ['pause', 'play', 'ended', 'loadedmetadata', 'emptied']) {
    lifecycle.addEventListener(document, type, (event) => {if (event.target === getVideoElement()) reset();}, true);
  }
  // Chat rows mutating inside the chat scrollers can neither move the player nor open a bar
  // menu, so those batches skip the player lookups (2026-11-09).
  const observer = new MutationObserver((records) => {
    if (disposed || onlyChatMutations(records)) return;
    if (findPlayerWrapper() !== host) reset();
    else if (held() && (!visible || !holding) && document.visibilityState !== 'hidden') show();
    else if (!held() && holding) arm();
    syncShelves();
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded', 'data-state', 'data-theatre']});
  lifecycle.add(subscribeLang(() => {
    if (host && addedAttributes.has('aria-label')) {const label=t('player.controls');host.setAttribute('aria-label',label);addedAttributes.set('aria-label',label);}
  }));
  lifecycle.add(() => {disposed = true; cancel(); observer.disconnect(); releaseHost();});
  reset();
}
