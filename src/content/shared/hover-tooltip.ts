export const HOVER_TOOLTIP_CLASS = 'kickflow-hover-tooltip';
export const HOVER_TOOLTIP_ATTRIBUTE = 'data-kickflow-tooltip';
const HOVER_TOOLTIP_VISIBLE_CLASS = `${HOVER_TOOLTIP_CLASS}--visible`;
const HOVER_TOOLTIP_ANCHOR_SELECTOR = `[${HOVER_TOOLTIP_ATTRIBUTE}]`;

/** Keeps the floating label visually separate from the badge without changing badge geometry. */
export const HOVER_TOOLTIP_ANCHOR_GAP_PX = 6;

/** Caps arbitrary reply text at a readable desktop width while preserving the full label by wrapping. */
export const HOVER_TOOLTIP_MAX_WIDTH_PX = 420;
export const HOVER_TOOLTIP_MAX_WIDTH_CSS_VARIABLE = '--kickflow-hover-tooltip-max-width';
export const HOVER_TOOLTIP_VIEWPORT_INSET_PX = 8;
export const HOVER_TOOLTIP_VIEWPORT_INSET_CSS_VARIABLE = '--kickflow-hover-tooltip-viewport-inset';

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

let sharedTooltip: HTMLDivElement | null = null;
let activeAnchor: Element | null = null;
let activeKeyHandler: ((event: KeyboardEvent) => void) | null = null;
let activeRepositionHandler: (() => void) | null = null;
let activeMutationObserver: MutationObserver | null = null;
let delegatedListenersInstalled = false;

function ensureSharedTooltip(): HTMLDivElement | null {
  if (!document.body) return null;
  if (!sharedTooltip) {
    sharedTooltip = document.createElement('div');
    sharedTooltip.className = HOVER_TOOLTIP_CLASS;
    sharedTooltip.setAttribute('aria-hidden', 'true');
    sharedTooltip.style.setProperty(
      HOVER_TOOLTIP_MAX_WIDTH_CSS_VARIABLE,
      `${HOVER_TOOLTIP_MAX_WIDTH_PX}px`,
    );
    sharedTooltip.style.setProperty(
      HOVER_TOOLTIP_VIEWPORT_INSET_CSS_VARIABLE,
      `${HOVER_TOOLTIP_VIEWPORT_INSET_PX}px`,
    );
  }
  if (!sharedTooltip.isConnected) document.body.appendChild(sharedTooltip);
  return sharedTooltip;
}

function readAnchorRect(anchor: Element): HoverTooltipAnchorRect {
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

function hideTooltip(removeSharedElement = false): void {
  if (!activeAnchor) return;
  activeAnchor = null;
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
  if (removeSharedElement) {
    sharedTooltip?.remove();
    sharedTooltip = null;
  }
}

function positionTooltip(anchor: Element): void {
  const tooltip = ensureSharedTooltip();
  if (!tooltip) return;
  // The card and the settings panel already sit at the maximum z-index, so paint order decides:
  // last child wins. Re-append only when something else was added after us — repositioning runs on
  // every scroll event, and an unconditional append mutates the body on each one, which the
  // anchor-liveness observer below then has to process.
  if (document.body.lastElementChild !== tooltip) document.body.appendChild(tooltip);
  const placement = resolveHoverTooltipPlacement({
    anchorRect: readAnchorRect(anchor),
    tooltipSize: {
      width: tooltip.getBoundingClientRect().width,
      height: tooltip.getBoundingClientRect().height,
    },
    viewportSize: { width: window.innerWidth, height: window.innerHeight },
  });
  tooltip.style.left = `${placement.left}px`;
  tooltip.style.top = `${placement.top}px`;
}

function installActiveListeners(anchor: Element): void {
  activeKeyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideTooltip();
  };
  document.addEventListener('keydown', activeKeyHandler);

  activeRepositionHandler = () => {
    if (!anchor.isConnected || !anchor.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE)) {
      hideTooltip(true);
      return;
    }
    positionTooltip(anchor);
  };
  window.addEventListener('resize', activeRepositionHandler);
  window.addEventListener('scroll', activeRepositionHandler, true);

  if (document.body) {
    activeMutationObserver = new MutationObserver(() => {
      if (!anchor.isConnected || !anchor.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE)) hideTooltip(true);
    });
    activeMutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: [HOVER_TOOLTIP_ATTRIBUTE],
      childList: true,
      subtree: true,
    });
  }
}

function showTooltip(anchor: Element): void {
  const label = anchor.getAttribute(HOVER_TOOLTIP_ATTRIBUTE);
  // A blank label is treated as no tooltip at all. The attribute alone would still open the box,
  // painting an empty bordered rectangle — a reply row whose quoted text is entirely whitespace
  // reaches here, and so would any future consumer that sets the attribute from optional data.
  if (label === null || label.trim() === '' || !anchor.isConnected) {
    if (activeAnchor === anchor) hideTooltip(true);
    return;
  }
  const isNewAnchor = activeAnchor !== anchor;
  if (isNewAnchor && activeAnchor) hideTooltip();

  const tooltip = ensureSharedTooltip();
  if (!tooltip) return;
  activeAnchor = anchor;
  tooltip.textContent = label;
  positionTooltip(anchor);
  tooltip.classList.add(HOVER_TOOLTIP_VISIBLE_CLASS);
  if (isNewAnchor) installActiveListeners(anchor);
}

function resolveTooltipAnchor(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(HOVER_TOOLTIP_ANCHOR_SELECTOR);
}

function installDelegatedListeners(): void {
  if (delegatedListenersInstalled || typeof document === 'undefined') return;
  delegatedListenersInstalled = true;

  document.addEventListener('mouseover', (event) => {
    const anchor = resolveTooltipAnchor(event.target);
    if (!anchor || resolveTooltipAnchor(event.relatedTarget) === anchor) return;
    showTooltip(anchor);
  });
  document.addEventListener('mouseout', (event) => {
    if (activeAnchor && resolveTooltipAnchor(event.relatedTarget) !== activeAnchor) hideTooltip();
  });
  document.addEventListener('focusin', (event) => {
    const anchor = resolveTooltipAnchor(event.target);
    if (anchor) showTooltip(anchor);
  });
  document.addEventListener('focusout', (event) => {
    if (activeAnchor && resolveTooltipAnchor(event.relatedTarget) !== activeAnchor) hideTooltip();
  });
}

installDelegatedListeners();
