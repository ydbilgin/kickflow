import { describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';

describe('feature-flags', () => {
  it('defaults chatMode to native', () => {
    expect(featureFlags.chatMode).toBe('native');
  });

  it('shows event rows by default', () => {
    expect(featureFlags.showSubscriptions).toBe(true);
    expect(featureFlags.showGiftedSubs).toBe(true);
    expect(featureFlags.showKicks).toBe(true);
    expect(featureFlags.showPolls).toBe(true);
    expect(featureFlags.showHostRaid).toBe(true);
    expect(featureFlags.showModeChanges).toBe(true);
  });

  it('keeps automatic theater mode opt-in', () => {
    expect(featureFlags.autoTheater).toBe(false);
  });

  it('keeps every previously unconditional player feature enabled by default', () => {
    expect(featureFlags.captionGuard).toBe(true);
    expect(featureFlags.rewindControls).toBe(true);
    expect(featureFlags.liveCatchup).toBe(true);
    expect(featureFlags.qualityLock).toBe(true);
    expect(featureFlags.screenshot).toBe(true);
    expect(featureFlags.speedControls).toBe(true);
  });

  it('enables mention/mod/VIP highlight defaults', () => {
    expect(featureFlags.mentionHighlightEnabled).toBe(true);
    expect(featureFlags.mentionHighlightStyle).toBe('both');
    expect(featureFlags.mentionHighlightColor).toBe('#FFC94D');
    expect(featureFlags.modFrameEnabled).toBe(true);
    expect(featureFlags.modFrameColor).toBe('#14B8A6');
    expect(featureFlags.vipFrameEnabled).toBe(true);
    expect(featureFlags.vipFrameColor).toBe('#EC4899');
    expect(featureFlags.manualUsername).toBe('');
  });
});
