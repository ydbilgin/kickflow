import { describe, expect, it } from 'vitest';
import {
  CARD_MAX_HEIGHT_INSET_PX,
  CARD_VIEWPORT_MARGIN_PX,
} from '../../src/content/chat/user-card';
import { USER_MESSAGE_TIME_COLUMN_PX } from '../../src/content/chat/user-message-list';
import { declarations, styleTemplate } from '../helpers/bootstrap-css';

describe('user-card chrome styles', () => {
  it('bounds the card height to the viewport so a long list can never push it off-screen', () => {
    const card = declarations('.kickflow-user-card');

    expect(card).toContain(`max-height: calc(100vh - \${CARD_MAX_HEIGHT_INSET_PX}px)`);
    expect(CARD_MAX_HEIGHT_INSET_PX).toBe(CARD_VIEWPORT_MARGIN_PX * 2);
    // Column layout is what makes the message list, not the card, absorb the overflow.
    expect(card).toContain('display: flex');
    expect(card).toContain('flex-direction: column');
  });

  it('lets the message list shrink instead of the card growing', () => {
    const body = declarations('.kickflow-user-messages__body');

    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('flex: 1 1 auto');
  });

  it('animates the entrance with an ease-out curve and no layout properties', () => {
    const card = declarations('.kickflow-user-card');
    const animationMatch = /animation: kickflow-card-in (\d+)ms cubic-bezier\(([^)]*)\)/.exec(card);

    expect(animationMatch).not.toBeNull();
    const duration = Number(animationMatch?.[1]);
    // Product register: 150-250ms. Slower reads as waiting, faster is not perceived as motion.
    expect(duration).toBeGreaterThanOrEqual(150);
    expect(duration).toBeLessThanOrEqual(250);
    // Ease-out: the curve must end flat, so the second control point's y is 1.
    expect(animationMatch?.[2].split(',').map((n) => Number(n.trim()))[3]).toBe(1);

    const keyframes = styleTemplate().match(/@keyframes kickflow-card-in \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
    expect(keyframes).toContain('opacity');
    expect(keyframes).toContain('transform');
    for (const layoutProperty of ['width:', 'height:', 'top:', 'left:', 'margin', 'padding']) {
      expect(keyframes).not.toContain(layoutProperty);
    }
  });

  it('honours prefers-reduced-motion and skips the replay on the fetched card', () => {
    const css = styleTemplate();

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.kickflow-user-card \{ animation: none/);
    expect(declarations('.kickflow-user-card--instant')).toContain('animation: none');
  });

  it('indents the reply quote to the width of the clock gutter so both share a left edge', () => {
    expect(declarations('.kickflow-user-messages__time'))
      .toContain(`width: \${USER_MESSAGE_TIME_COLUMN_PX}px`);
    expect(declarations('.kickflow-user-messages__reply'))
      .toContain(`margin: 0 0 2px \${USER_MESSAGE_TIME_COLUMN_PX}px`);
    expect(USER_MESSAGE_TIME_COLUMN_PX).toBeGreaterThan(0);
  });

  it('sizes reply emotes on the wrapper, not the absolutely-positioned image alone', () => {
    // Overriding .kickflow-emote height directly fights the line-box-neutral geometry own-mode rows
    // depend on; the box carries the size and the image follows it.
    expect(declarations('.kickflow-user-messages__reply .kickflow-emote-box')).toContain('height: 14px');
    expect(declarations('.kickflow-user-messages__reply .kickflow-emote')).toContain('height: 14px !important');
  });

  it('leaves no unreplaced placeholder that a scraping harness would have to guess', () => {
    const placeholders = new Set(
      [...styleTemplate().matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((match) => match[1]),
    );

    // Every interpolation in the stylesheet must be a bare SCREAMING_SNAKE identifier. An
    // expression such as `${A * 2}` cannot be replaced by name, so the scraping harnesses emit it
    // as literal text and silently void the declaration it sits in.
    expect(placeholders.size).toBeGreaterThan(0);
    const everyInterpolation = [...styleTemplate().matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]);
    const notBareIdentifiers = everyInterpolation.filter((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name));
    expect(notBareIdentifiers).toEqual([]);
  });
});
