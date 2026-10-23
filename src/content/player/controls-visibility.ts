import type {Lifecycle} from '../shared/lifecycle';
import {findControlBar, findPlayerWrapper, getVideoElement} from '../shared/selectors';
import {subscribeLang,t} from '../shared/i18n';

// Native Kick measured 2026-10-22: approximately four seconds including its fade.
export const CONTROLS_IDLE_MS = 4000;
export function inBottomArea(rect: DOMRect, x: number, y: number, barHeight = 80): boolean {
  const depth = Math.min(rect.height / 3, Math.max(96, barHeight + 16));
  return x >= rect.left && x <= rect.right && y <= rect.bottom && y >= rect.bottom - depth;
}

/** Own the presentation state, while Kick continues to own every native action. Mouse focus
 * left by automatic quality selection is not keyboard focus and cannot pin the bar. */
export function initControlsVisibility(lifecycle: Lifecycle): void {
  let visible = false, keyboard = false, timer: number | null = null, disposed = false;
  let host: HTMLElement | null = null;
  let holding = false;
  const addedAttributes = new Map<string,string>();
  const releaseHost = () => {
    host?.removeAttribute('data-kickflow-controls');
    for (const [name,value] of addedAttributes) if (host?.getAttribute(name) === value) host.removeAttribute(name);
    addedAttributes.clear();
  };
  const cancel = () => {if (timer !== null) window.clearTimeout(timer); timer = null;};
  const menuOpen = () => !!findControlBar()?.querySelector('[aria-expanded="true"], [data-state="open"][aria-haspopup]')
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
  const observer = new MutationObserver(() => {
    if (disposed) return;
    if (findPlayerWrapper() !== host) reset();
    else if (held() && (!visible || !holding) && document.visibilityState !== 'hidden') show();
    else if (!held() && holding) arm();
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded', 'data-state', 'data-theatre']});
  lifecycle.add(subscribeLang(() => {
    if (host && addedAttributes.has('aria-label')) {const label=t('player.controls');host.setAttribute('aria-label',label);addedAttributes.set('aria-label',label);}
  }));
  lifecycle.add(() => {disposed = true; cancel(); observer.disconnect(); releaseHost();});
  reset();
}
