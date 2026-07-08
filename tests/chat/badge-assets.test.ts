import { describe, expect, it } from 'vitest';
import { ROLE_BADGE_ASSETS } from '../../src/content/chat/badge-assets';

const EXPECTED_TYPES = ['moderator', 'vip', 'og', 'sub_gifter', 'verified', 'staff'];

describe('badge-assets', () => {
  it('has exactly the 6 authentic role badge types captured so far', () => {
    expect(Object.keys(ROLE_BADGE_ASSETS).sort()).toEqual([...EXPECTED_TYPES].sort());
  });

  it('every asset has a non-empty label and a base64 SVG data URI', () => {
    for (const [type, asset] of Object.entries(ROLE_BADGE_ASSETS)) {
      expect(asset.label.length, `label for ${type}`).toBeGreaterThan(0);
      expect(asset.uri.startsWith('data:image/svg+xml;base64,'), `uri for ${type}`).toBe(true);
    }
  });
});
