import { featureFlags } from '../chat/feature-flags';
import type { Lifecycle } from '../shared/lifecycle';

const BAR_ORDER_STYLE_ID = 'kickflow-bar-order';
const BAR_ORDER_RULE = 'div.z-controls.bottom-0 button[data-testid="video-player-fullscreen"] { order: 1 }';
/** One attribute on <html> switches the floating glass strip CSS (bootstrap.ts sheet) on or off. */
export const STRIP_ATTRIBUTE = 'data-kickflow-strip';

/** If Kick stops matching this selector, Kick's own order returns and nothing breaks. */
export function installBarOrder(): void {
  const existing = document.getElementById(BAR_ORDER_STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = BAR_ORDER_RULE;
    return;
  }
  existing?.remove();

  const style = document.createElement('style');
  style.id = BAR_ORDER_STYLE_ID;
  style.textContent = BAR_ORDER_RULE;
  document.head.appendChild(style);
}

export function removeBarOrder(): void {
  document.getElementById(BAR_ORDER_STYLE_ID)?.remove();
}

/** Called by bootstrap's shared flag mutator so the stylesheet follows the live setting. */
export function syncBarOrderFlag(): void {
  if (featureFlags.fullscreenTerminal) {
    installBarOrder();
  } else {
    removeBarOrder();
  }
  syncFloatingStrip();
}

export function syncFloatingStrip(): void {
  const root = document.documentElement;
  if (featureFlags.floatingStrip) {
    if (!root.hasAttribute(STRIP_ATTRIBUTE)) root.setAttribute(STRIP_ATTRIBUTE, '');
  } else {
    root.removeAttribute(STRIP_ATTRIBUTE);
  }
}

function removeFloatingStrip(): void {
  document.documentElement.removeAttribute(STRIP_ATTRIBUTE);
}

export function initBarOrder(lifecycle: Lifecycle): void {
  syncBarOrderFlag();
  lifecycle.add(removeBarOrder);
  lifecycle.add(removeFloatingStrip);
}
