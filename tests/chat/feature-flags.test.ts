import { describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';

describe('feature-flags', () => {
  it('defaults chatMode to native', () => {
    expect(featureFlags.chatMode).toBe('native');
  });

  it('shows event rows and pinned messages by default', () => {
    expect(featureFlags.showSubscriptions).toBe(true);
    expect(featureFlags.showGiftedSubs).toBe(true);
    expect(featureFlags.showHostRaid).toBe(true);
    expect(featureFlags.showPinnedMessage).toBe(true);
    expect(featureFlags.showModeChanges).toBe(true);
  });

  it('keeps automatic theater mode opt-in', () => {
    expect(featureFlags.autoTheater).toBe(false);
  });
});
