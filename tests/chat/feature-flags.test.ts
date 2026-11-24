import { describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';

// 2026-11-11: seven tests that each re-typed one default were folded into one table. A default is a
// product decision; one place lists them, and a changed default fails here with its name.
describe('feature-flags', () => {
  it('ships the agreed defaults', () => {
    expect({
      chatMode: featureFlags.chatMode,
      hoverFollowMode: featureFlags.hoverFollowMode,
      hideQuickEmoteBar: featureFlags.hideQuickEmoteBar,
      showSubscriptions: featureFlags.showSubscriptions,
      showGiftedSubs: featureFlags.showGiftedSubs,
      showKicks: featureFlags.showKicks,
      showPolls: featureFlags.showPolls,
      showHostRaid: featureFlags.showHostRaid,
      showModeChanges: featureFlags.showModeChanges,
      autoTheater: featureFlags.autoTheater,
      captionGuard: featureFlags.captionGuard,
      rewindControls: featureFlags.rewindControls,
      liveCatchup: featureFlags.liveCatchup,
      qualityLock: featureFlags.qualityLock,
      screenshot: featureFlags.screenshot,
      speedControls: featureFlags.speedControls,
      mentionHighlightEnabled: featureFlags.mentionHighlightEnabled,
      mentionHighlightStyle: featureFlags.mentionHighlightStyle,
      mentionHighlightColor: featureFlags.mentionHighlightColor,
      roleHighlightStyle: featureFlags.roleHighlightStyle,
      modFrameEnabled: featureFlags.modFrameEnabled,
      modFrameColor: featureFlags.modFrameColor,
      vipFrameEnabled: featureFlags.vipFrameEnabled,
      vipFrameColor: featureFlags.vipFrameColor,
      manualUsername: featureFlags.manualUsername,
    }).toEqual({
      chatMode: 'native',
      hoverFollowMode: 'browser-smooth',
      hideQuickEmoteBar: true,
      showSubscriptions: true,
      showGiftedSubs: true,
      showKicks: true,
      showPolls: true,
      showHostRaid: true,
      showModeChanges: true,
      autoTheater: false,
      captionGuard: true,
      rewindControls: true,
      liveCatchup: true,
      qualityLock: true,
      screenshot: true,
      speedControls: true,
      mentionHighlightEnabled: true,
      mentionHighlightStyle: 'both',
      mentionHighlightColor: '#FFC94D',
      roleHighlightStyle: 'frame',
      modFrameEnabled: true,
      modFrameColor: '#14B8A6',
      vipFrameEnabled: true,
      vipFrameColor: '#EC4899',
      manualUsername: '',
    });
  });
});
