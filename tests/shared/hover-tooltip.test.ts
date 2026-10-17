import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOVER_TOOLTIP_ANCHOR_GAP_PX,
  HOVER_TOOLTIP_ATTRIBUTE,
  HOVER_TOOLTIP_CLASS,
  resolveHoverTooltipPlacement,
  type HoverTooltipAnchorRect,
  type HoverTooltipSize,
  type HoverTooltipViewport,
} from '../../src/content/shared/hover-tooltip';

const VIEWPORT: HoverTooltipViewport = { width: 320, height: 180 };
const TOOLTIP: HoverTooltipSize = { width: 110, height: 28 };
const VISIBLE_CLASS = `${HOVER_TOOLTIP_CLASS}--visible`;

afterEach(() => {
  document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
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

describe('delegated hover tooltip', () => {
  function addAnchor(label: string): HTMLSpanElement {
    const anchor = document.createElement('span');
    anchor.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, label);
    document.body.append(anchor);
    return anchor;
  }

  it('resolves deeply nested emote and badge descendants without touching unregistered elements', () => {
    const row = document.createElement('div');
    const nestedLevelOne = document.createElement('div');
    const nestedLevelTwo = document.createElement('span');
    const emote = document.createElement('span');
    emote.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, 'Kappa');
    const emoteImage = document.createElement('img');
    emote.append(emoteImage);
    const badge = document.createElement('span');
    badge.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, 'Moderator');
    const unregistered = document.createElement('span');
    nestedLevelTwo.append(emote, badge, unregistered);
    nestedLevelOne.append(nestedLevelTwo);
    row.append(nestedLevelOne);
    document.body.append(row);

    emoteImage.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>(`.${HOVER_TOOLTIP_CLASS}`)!;
    expect(tooltip.textContent).toBe('Kappa');
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);

    emoteImage.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: unregistered }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);

    badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.textContent).toBe('Moderator');
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);

    badge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: unregistered }));
    unregistered.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('uses one shared body-level element for mouse and keyboard visibility', () => {
    const anchor = addAnchor('Moderator');

    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>(`.${HOVER_TOOLTIP_CLASS}`)!;
    expect(tooltip.textContent).toBe('Moderator');
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    expect(tooltip.parentElement).toBe(document.body);

    anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);

    anchor.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);
    anchor.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);

    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('hides when the active anchor is removed from the document', async () => {
    const anchor = addAnchor('Moderator');

    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>(`.${HOVER_TOOLTIP_CLASS}`)!;
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(true);
    anchor.remove();

    await vi.waitFor(() => expect(document.querySelector(`.${HOVER_TOOLTIP_CLASS}`)).toBeNull());
    expect(tooltip.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('adds two hundred tooltip rows through attributes without per-row listeners', () => {
    const addDocumentListener = vi.spyOn(document, 'addEventListener');
    const rows = Array.from({ length: 200 }, (_, index) => {
      const row = document.createElement('span');
      vi.spyOn(row, 'addEventListener');
      row.setAttribute(HOVER_TOOLTIP_ATTRIBUTE, `Row ${index}`);
      document.body.append(row);
      return row;
    });

    expect(rows).toHaveLength(200);
    expect(rows.every((row) => row.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE))).toBe(true);
    expect(rows.every((row) => vi.mocked(row.addEventListener).mock.calls.length === 0)).toBe(true);
    expect(addDocumentListener).not.toHaveBeenCalled();
  });
});
