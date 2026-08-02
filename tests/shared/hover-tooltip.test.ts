import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOVER_TOOLTIP_ANCHOR_GAP_PX,
  HOVER_TOOLTIP_CLASS,
  registerHoverTooltip,
  resolveHoverTooltipPlacement,
  type HoverTooltipAnchorRect,
  type HoverTooltipSize,
  type HoverTooltipViewport,
} from '../../src/content/shared/hover-tooltip';

const VIEWPORT: HoverTooltipViewport = { width: 320, height: 180 };
const TOOLTIP: HoverTooltipSize = { width: 110, height: 28 };
const VISIBLE_CLASS = `${HOVER_TOOLTIP_CLASS}--visible`;
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function place(anchorRect: HoverTooltipAnchorRect): { left: number; top: number } {
  return resolveHoverTooltipPlacement({ anchorRect, tooltipSize: TOOLTIP, viewportSize: VIEWPORT });
}

function assertContained(
  placement: { left: number; top: number },
  size: HoverTooltipSize = TOOLTIP,
  viewport: HoverTooltipViewport = VIEWPORT,
): void {
  expect(placement.left).toBeGreaterThanOrEqual(0);
  expect(placement.top).toBeGreaterThanOrEqual(0);
  expect(placement.left + size.width).toBeLessThanOrEqual(viewport.width);
  expect(placement.top + size.height).toBeLessThanOrEqual(viewport.height);
}

function assertDoesNotCoverAnchor(
  placement: { left: number; top: number },
  anchorRect: HoverTooltipAnchorRect,
  size: HoverTooltipSize = TOOLTIP,
): void {
  const overlaps = placement.left < anchorRect.right
    && placement.left + size.width > anchorRect.left
    && placement.top < anchorRect.bottom
    && placement.top + size.height > anchorRect.top;
  expect(overlaps).toBe(false);
}

describe('hover-tooltip placement', () => {
  it('stays inside the viewport at every edge and corner', () => {
    const anchors: HoverTooltipAnchorRect[] = [
      { left: 0, top: 0, right: 18, bottom: 18 },
      { left: 302, top: 0, right: 320, bottom: 18 },
      { left: 0, top: 162, right: 18, bottom: 180 },
      { left: 302, top: 162, right: 320, bottom: 180 },
      { left: 0, top: 80, right: 18, bottom: 98 },
      { left: 302, top: 80, right: 320, bottom: 98 },
      { left: 151, top: 0, right: 169, bottom: 18 },
      { left: 151, top: 162, right: 169, bottom: 180 },
    ];

    for (const anchorRect of anchors) {
      const placement = place(anchorRect);
      assertContained(placement);
      assertDoesNotCoverAnchor(placement, anchorRect);
    }
  });

  it('prefers above the anchor when the tooltip fits there', () => {
    const anchorRect = { left: 140, top: 100, right: 158, bottom: 118 };

    expect(place(anchorRect)).toEqual({
      left: (140 + 158 - TOOLTIP.width) / 2,
      top: 100 - HOVER_TOOLTIP_ANCHOR_GAP_PX - TOOLTIP.height,
    });
  });

  it('flips below only when there is no room above', () => {
    const anchorRect = { left: 140, top: 4, right: 158, bottom: 22 };
    const placement = place(anchorRect);

    expect(placement.top).toBe(anchorRect.bottom + HOVER_TOOLTIP_ANCHOR_GAP_PX);
    assertContained(placement);
    assertDoesNotCoverAnchor(placement, anchorRect);
  });

  it('uses a horizontal side when neither vertical side can contain the tooltip', () => {
    const anchorRect = { left: 75, top: 42, right: 105, bottom: 58 };
    const size = { width: 60, height: 70 };
    const viewport = { width: 180, height: 100 };
    const placement = resolveHoverTooltipPlacement({
      anchorRect,
      tooltipSize: size,
      viewportSize: viewport,
    });

    assertContained(placement, size, viewport);
    assertDoesNotCoverAnchor(placement, anchorRect, size);
  });
});

describe('registered hover tooltip', () => {
  function register(anchor: HTMLElement, label: string): HTMLElement {
    document.body.append(anchor);
    disposers.push(registerHoverTooltip(anchor, label));
    return document.querySelector<HTMLElement>(`.${HOVER_TOOLTIP_CLASS}`)!;
  }

  it('uses one shared body-level element for mouse and keyboard visibility', () => {
    const anchor = document.createElement('span');
    const tooltip = register(anchor, 'Moderator');

    anchor.dispatchEvent(new Event('mouseenter'));
    expect(tooltip.textContent).toBe('Moderator');
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    expect(tooltip.parentElement).toBe(document.body);

    anchor.dispatchEvent(new Event('mouseleave'));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);

    anchor.dispatchEvent(new Event('focus'));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);
    anchor.dispatchEvent(new Event('blur'));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);

    anchor.dispatchEvent(new Event('mouseenter'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('removes anchor, document, window, observer, and shared-element resources on disposal', () => {
    const anchor = document.createElement('span');
    const removeAnchorListener = vi.spyOn(anchor, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const disconnectObserver = vi.spyOn(MutationObserver.prototype, 'disconnect');
    document.body.append(anchor);
    const dispose = registerHoverTooltip(anchor, 'Moderator');

    anchor.dispatchEvent(new Event('mouseenter'));
    expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).not.toBeNull();
    dispose();

    expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).toBeNull();
    for (const eventName of ['mouseenter', 'mouseleave', 'focus', 'blur']) {
      expect(removeAnchorListener).toHaveBeenCalledWith(eventName, expect.any(Function));
    }
    expect(removeDocumentListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(disconnectObserver).toHaveBeenCalled();
  });

  it('removes the shared element even when a registration is disposed before activation', () => {
    const anchor = document.createElement('span');
    document.body.append(anchor);
    const dispose = registerHoverTooltip(anchor, 'Moderator');

    expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).not.toBeNull();
    dispose();
    expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).toBeNull();
  });

  it('disposes the active registration when its anchor leaves the document', async () => {
    const anchor = document.createElement('span');
    const removeAnchorListener = vi.spyOn(anchor, 'removeEventListener');
    document.body.append(anchor);
    const dispose = registerHoverTooltip(anchor, 'Moderator');

    anchor.dispatchEvent(new Event('mouseenter'));
    anchor.remove();
    await vi.waitFor(() => expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).toBeNull());

    expect(removeAnchorListener).toHaveBeenCalledWith('mouseenter', expect.any(Function));
    dispose();
  });
});
