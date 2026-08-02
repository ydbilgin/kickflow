export const HOVER_TOOLTIP_CLASS = 'kickflow-hover-tooltip';
const HOVER_TOOLTIP_VISIBLE_CLASS = `${HOVER_TOOLTIP_CLASS}--visible`;

/** Keeps the floating label visually separate from the badge without changing badge geometry. */
export const HOVER_TOOLTIP_ANCHOR_GAP_PX = 6;

export interface HoverTooltipAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HoverTooltipSize {
  width: number;
  height: number;
}

export interface HoverTooltipViewport {
  width: number;
  height: number;
}

export interface HoverTooltipPlacementInput {
  anchorRect: HoverTooltipAnchorRect;
  tooltipSize: HoverTooltipSize;
  viewportSize: HoverTooltipViewport;
}

export interface HoverTooltipPlacement {
  left: number;
  top: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function fitsWithinViewport(start: number, size: number, viewportSize: number): boolean {
  return start >= 0 && start + size <= viewportSize;
}

/**
 * Pure placement maths for the shared tooltip. Above is preferred, below is the first fallback,
 * and a horizontal fallback keeps the tooltip separate when neither vertical side can contain it.
 */
export function resolveHoverTooltipPlacement(input: HoverTooltipPlacementInput): HoverTooltipPlacement {
  const { anchorRect, tooltipSize, viewportSize } = input;
  const maxLeft = Math.max(0, viewportSize.width - tooltipSize.width);
  const maxTop = Math.max(0, viewportSize.height - tooltipSize.height);
  const centeredLeft = (anchorRect.left + anchorRect.right - tooltipSize.width) / 2;
  const left = clamp(centeredLeft, 0, maxLeft);
  const aboveTop = anchorRect.top - HOVER_TOOLTIP_ANCHOR_GAP_PX - tooltipSize.height;
  const belowTop = anchorRect.bottom + HOVER_TOOLTIP_ANCHOR_GAP_PX;

  if (fitsWithinViewport(aboveTop, tooltipSize.height, viewportSize.height)) {
    return { left, top: aboveTop };
  }
  if (fitsWithinViewport(belowTop, tooltipSize.height, viewportSize.height)) {
    return { left, top: belowTop };
  }

  const centeredTop = clamp(
    (anchorRect.top + anchorRect.bottom - tooltipSize.height) / 2,
    0,
    maxTop,
  );
  const rightLeft = anchorRect.right + HOVER_TOOLTIP_ANCHOR_GAP_PX;
  if (fitsWithinViewport(rightLeft, tooltipSize.width, viewportSize.width)) {
    return { left: rightLeft, top: centeredTop };
  }
  const leftLeft = anchorRect.left - HOVER_TOOLTIP_ANCHOR_GAP_PX - tooltipSize.width;
  if (fitsWithinViewport(leftLeft, tooltipSize.width, viewportSize.width)) {
    return { left: leftLeft, top: centeredTop };
  }

  // A zero-gap side is still non-overlapping and is useful on a viewport too short for the
  // configured visual gap. The final clamp handles a tooltip larger than the available viewport.
  const touchingAboveTop = anchorRect.top - tooltipSize.height;
  if (fitsWithinViewport(touchingAboveTop, tooltipSize.height, viewportSize.height)) {
    return { left, top: touchingAboveTop };
  }
  const touchingBelowTop = anchorRect.bottom;
  if (fitsWithinViewport(touchingBelowTop, tooltipSize.height, viewportSize.height)) {
    return { left, top: touchingBelowTop };
  }

  const aboveRoom = Math.max(0, anchorRect.top);
  const belowRoom = Math.max(0, viewportSize.height - anchorRect.bottom);
  const fallbackTop = aboveRoom >= belowRoom ? aboveTop : belowTop;
  return { left, top: clamp(fallbackTop, 0, maxTop) };
}

interface TooltipRegistration {
  anchor: HTMLElement;
  label: string;
  disposed: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

let sharedTooltip: HTMLDivElement | null = null;
let activeRegistration: TooltipRegistration | null = null;
let activeKeyHandler: ((event: KeyboardEvent) => void) | null = null;
let activeRepositionHandler: (() => void) | null = null;
let activeMutationObserver: MutationObserver | null = null;

function ensureSharedTooltip(): HTMLDivElement | null {
  if (!document.body) return null;
  if (!sharedTooltip) {
    sharedTooltip = document.createElement('div');
    sharedTooltip.className = HOVER_TOOLTIP_CLASS;
    sharedTooltip.setAttribute('aria-hidden', 'true');
  }
  if (!sharedTooltip.isConnected) document.body.appendChild(sharedTooltip);
  return sharedTooltip;
}

function readAnchorRect(anchor: HTMLElement): HoverTooltipAnchorRect {
  const rect = anchor.getBoundingClientRect();
  const right = Number.isFinite(rect.right) && (rect.right !== 0 || (rect.left === 0 && rect.width === 0))
    ? rect.right
    : rect.left + rect.width;
  const bottom = Number.isFinite(rect.bottom) && (rect.bottom !== 0 || (rect.top === 0 && rect.height === 0))
    ? rect.bottom
    : rect.top + rect.height;
  return {
    left: rect.left,
    top: rect.top,
    right,
    bottom,
  };
}

function hideTooltip(registration: TooltipRegistration): void {
  if (activeRegistration !== registration) return;
  activeRegistration = null;
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }
  if (activeRepositionHandler) {
    window.removeEventListener('resize', activeRepositionHandler);
    window.removeEventListener('scroll', activeRepositionHandler, true);
    activeRepositionHandler = null;
  }
  activeMutationObserver?.disconnect();
  activeMutationObserver = null;
  sharedTooltip?.classList.remove(HOVER_TOOLTIP_VISIBLE_CLASS);
}

function positionTooltip(registration: TooltipRegistration): void {
  const tooltip = ensureSharedTooltip();
  if (!tooltip) return;
  // The card and the settings panel already sit at the maximum z-index, so paint order decides:
  // last child wins. Re-append only when something else was added after us — repositioning runs on
  // every scroll event, and an unconditional append mutates the body on each one, which the
  // anchor-liveness observer below then has to process.
  if (document.body.lastElementChild !== tooltip) document.body.appendChild(tooltip);
  const placement = resolveHoverTooltipPlacement({
    anchorRect: readAnchorRect(registration.anchor),
    tooltipSize: {
      width: tooltip.getBoundingClientRect().width,
      height: tooltip.getBoundingClientRect().height,
    },
    viewportSize: { width: window.innerWidth, height: window.innerHeight },
  });
  tooltip.style.left = `${placement.left}px`;
  tooltip.style.top = `${placement.top}px`;
}

function installActiveListeners(registration: TooltipRegistration): void {
  activeKeyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideTooltip(registration);
  };
  document.addEventListener('keydown', activeKeyHandler);

  activeRepositionHandler = () => {
    if (!registration.anchor.isConnected) {
      disposeRegistration(registration);
      return;
    }
    positionTooltip(registration);
  };
  window.addEventListener('resize', activeRepositionHandler);
  window.addEventListener('scroll', activeRepositionHandler, true);

  if (document.body) {
    activeMutationObserver = new MutationObserver(() => {
      if (!registration.anchor.isConnected) disposeRegistration(registration);
    });
    activeMutationObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function showTooltip(registration: TooltipRegistration): void {
  if (registration.disposed) return;
  if (!registration.anchor.isConnected) {
    disposeRegistration(registration);
    return;
  }
  if (activeRegistration === registration) {
    positionTooltip(registration);
    sharedTooltip?.classList.add(HOVER_TOOLTIP_VISIBLE_CLASS);
    return;
  }
  if (activeRegistration) hideTooltip(activeRegistration);

  const tooltip = ensureSharedTooltip();
  if (!tooltip) return;
  activeRegistration = registration;
  tooltip.textContent = registration.label;
  positionTooltip(registration);
  tooltip.classList.add(HOVER_TOOLTIP_VISIBLE_CLASS);
  installActiveListeners(registration);
}

function disposeRegistration(registration: TooltipRegistration): void {
  if (registration.disposed) return;
  registration.disposed = true;
  registration.anchor.removeEventListener('mouseenter', registration.onMouseEnter);
  registration.anchor.removeEventListener('mouseleave', registration.onMouseLeave);
  registration.anchor.removeEventListener('focus', registration.onFocus);
  registration.anchor.removeEventListener('blur', registration.onBlur);
  if (activeRegistration === registration) {
    hideTooltip(registration);
  }
  if (!activeRegistration) {
    sharedTooltip?.remove();
    sharedTooltip = null;
  }
}

/** Registers one badge or other future anchor and returns its complete listener disposer. */
export function registerHoverTooltip(anchor: HTMLElement, label: string): () => void {
  let registration: TooltipRegistration;
  registration = {
    anchor,
    label,
    disposed: false,
    onMouseEnter: () => showTooltip(registration),
    onMouseLeave: () => hideTooltip(registration),
    onFocus: () => showTooltip(registration),
    onBlur: () => hideTooltip(registration),
  };
  anchor.addEventListener('mouseenter', registration.onMouseEnter);
  anchor.addEventListener('mouseleave', registration.onMouseLeave);
  anchor.addEventListener('focus', registration.onFocus);
  anchor.addEventListener('blur', registration.onBlur);
  ensureSharedTooltip();
  return () => disposeRegistration(registration);
}
