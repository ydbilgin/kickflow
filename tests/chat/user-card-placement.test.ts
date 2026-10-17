import { describe, expect, it } from 'vitest';
import {
  CARD_ANCHOR_GAP_PX,
  CARD_VIEWPORT_MARGIN_PX,
  resolveCardPlacement,
} from '../../src/content/chat/user-card';

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 720 };
const CARD = { cardWidth: 320, cardHeight: 420 };

function place(anchorX: number, anchorY: number, overrides: Partial<typeof CARD & typeof VIEWPORT> = {}) {
  return resolveCardPlacement({ anchorX, anchorY, ...CARD, ...VIEWPORT, ...overrides });
}

/** The acceptance criterion for this card is not "looks fine": it is that the card's rectangle stays
 * inside the viewport rectangle at every anchor the owner can click. Assert that, not the pixels. */
function assertInsideViewport(
  placement: { left: number; top: number },
  card = CARD,
  viewport = VIEWPORT,
): void {
  expect(placement.left).toBeGreaterThanOrEqual(CARD_VIEWPORT_MARGIN_PX);
  expect(placement.top).toBeGreaterThanOrEqual(CARD_VIEWPORT_MARGIN_PX);
  expect(placement.left + card.cardWidth).toBeLessThanOrEqual(viewport.viewportWidth - CARD_VIEWPORT_MARGIN_PX);
  expect(placement.top + card.cardHeight).toBeLessThanOrEqual(viewport.viewportHeight - CARD_VIEWPORT_MARGIN_PX);
}

describe('user-card placement', () => {
  it('opens below-right of the anchor when there is room', () => {
    const placement = place(400, 120);

    expect(placement).toEqual({ left: 400 + CARD_ANCHOR_GAP_PX, top: 120 + CARD_ANCHOR_GAP_PX });
    assertInsideViewport(placement);
  });

  it('flips above the anchor instead of hanging off the bottom', () => {
    const placement = place(400, 640);

    expect(placement.top).toBe(640 - CARD_ANCHOR_GAP_PX - CARD.cardHeight);
    assertInsideViewport(placement);
  });

  it('clamps to the right edge instead of overflowing horizontally', () => {
    const placement = place(1270, 100);

    expect(placement.left).toBe(VIEWPORT.viewportWidth - CARD.cardWidth - CARD_VIEWPORT_MARGIN_PX);
    assertInsideViewport(placement);
  });

  it('stays inside the viewport for every anchor across the whole screen', () => {
    for (let x = 0; x <= VIEWPORT.viewportWidth; x += 40) {
      for (let y = 0; y <= VIEWPORT.viewportHeight; y += 40) {
        assertInsideViewport(place(x, y));
      }
    }
  });

  it('stays inside the viewport for a short card and a tall card alike', () => {
    for (const cardHeight of [120, 300, 560, 700]) {
      const card = { ...CARD, cardHeight };
      for (const y of [0, 200, 400, 719]) {
        assertInsideViewport(place(600, y, { cardHeight }), card);
      }
    }
  });

  it('pins to the top margin when the card cannot fit the viewport at all', () => {
    // The CSS max-height should prevent this, but placement must degrade to "readable from the top"
    // rather than to a negative offset that puts the header off-screen.
    const placement = place(600, 400, { cardHeight: 900 });

    expect(placement.top).toBe(CARD_VIEWPORT_MARGIN_PX);
  });

  it('never returns a negative offset on a tiny viewport', () => {
    const placement = place(10, 10, { viewportWidth: 200, viewportHeight: 200 });

    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
  });
});
