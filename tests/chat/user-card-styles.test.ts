import { describe, expect, it } from 'vitest';
import { styleTemplate } from '../helpers/bootstrap-css';

describe('user-card chrome styles', () => {
  // 2026-11-11: six tests that matched CSS text (max-height, flex, animation curve, gutter widths)
  // were removed; they pinned wording, not behaviour. This one guards the scraping harnesses.
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
