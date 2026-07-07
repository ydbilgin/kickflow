import { describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';

describe('feature-flags', () => {
  it('defaults chatMode to native', () => {
    expect(featureFlags.chatMode).toBe('native');
  });
});
