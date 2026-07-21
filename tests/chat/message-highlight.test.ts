import { afterEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  applyNativeHighlights,
  syncHighlightCssVars,
} from '../../src/content/chat/message-highlight-apply';
import type { ChatMessage } from '../../src/content/chat/message-store';
import {
  DEFAULT_MENTION_HIGHLIGHT_COLOR,
  hexToRgb,
  normalizeHexColor,
  resolveMessageHighlightState,
  rgbToHsl,
  sanitizeHighlightColor,
  type ResolveMessageHighlightInput,
} from '../../src/content/chat/message-highlight';

const originalFlags = { ...featureFlags };

afterEach(() => {
  Object.assign(featureFlags, originalFlags);
  document.body.replaceChildren();
});

const base = (overrides: Partial<ResolveMessageHighlightInput> = {}): ResolveMessageHighlightInput => ({
  isVip: false,
  isModerator: false,
  mentionMe: false,
  replyToMe: false,
  jumpFlashActive: false,
  mentionHighlightEnabled: true,
  mentionHighlightStyle: 'both',
  modFrameEnabled: true,
  vipFrameEnabled: true,
  ...overrides,
});

describe('resolveMessageHighlightState', () => {
  it('mention-only', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true }))).toEqual({
      roleBar: null,
      fill: true,
      outline: true,
      personal: 'mention',
    });
  });

  it('reply-only (beats mention when both)', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true, replyToMe: true }))).toEqual({
      roleBar: null,
      fill: true,
      outline: true,
      personal: 'reply',
    });
  });

  it('mod-only', () => {
    expect(resolveMessageHighlightState(base({ isModerator: true }))).toEqual({
      roleBar: 'moderator',
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('vip-only', () => {
    expect(resolveMessageHighlightState(base({ isVip: true }))).toEqual({
      roleBar: 'vip',
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('mention+mod stacks both channels', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true, isModerator: true }))).toEqual({
      roleBar: 'moderator',
      fill: true,
      outline: true,
      personal: 'mention',
    });
  });

  it('reply+vip stacks both channels', () => {
    expect(resolveMessageHighlightState(base({ replyToMe: true, isVip: true }))).toEqual({
      roleBar: 'vip',
      fill: true,
      outline: true,
      personal: 'reply',
    });
  });

  it('mention+jumpflash keeps fill but yields outline', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true, jumpFlashActive: true }))).toEqual({
      roleBar: null,
      fill: true,
      outline: false,
      personal: 'mention',
    });
  });

  it('vip+mod both present → vip wins role bar', () => {
    expect(resolveMessageHighlightState(base({ isVip: true, isModerator: true }))).toEqual({
      roleBar: 'vip',
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('none', () => {
    expect(resolveMessageHighlightState(base())).toEqual({
      roleBar: null,
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('respects style frame/fill and disabled personal flag', () => {
    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      mentionHighlightStyle: 'frame',
    }))).toMatchObject({ fill: false, outline: true, personal: 'mention' });

    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      mentionHighlightStyle: 'fill',
    }))).toMatchObject({ fill: true, outline: false, personal: 'mention' });

    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      mentionHighlightEnabled: false,
    }))).toMatchObject({ fill: false, outline: false, personal: null });
  });

  it('falls through to mod when vip frame is disabled', () => {
    expect(resolveMessageHighlightState(base({
      isVip: true,
      isModerator: true,
      vipFrameEnabled: false,
    })).roleBar).toBe('moderator');
  });
});

describe('sanitizeHighlightColor', () => {
  it('passes a safe in-range color through unchanged (normalized)', () => {
    expect(sanitizeHighlightColor('#FFC94D')).toBe('#FFC94D');
    expect(sanitizeHighlightColor('ffc94d')).toBe('#FFC94D');
    expect(sanitizeHighlightColor(DEFAULT_MENTION_HIGHLIGHT_COLOR)).toBe('#FFC94D');
  });

  it('nudges a green-band high-saturation color out of ~90–120°', () => {
    // Pure-ish Kick green #53FC18 sits in the reserved hue band at high saturation.
    const nudged = sanitizeHighlightColor('#53FC18');
    const rgb = hexToRgb(nudged)!;
    const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    expect(s).toBeGreaterThan(55);
    expect(h < 90 || h > 120).toBe(true);
    expect(nudged).not.toBe('#53FC18');
  });

  it('clamps out-of-range lightness into [55%, 82%]', () => {
    // Near-black blue → lightness far below 55%
    const dark = sanitizeHighlightColor('#000080');
    const darkRgb = hexToRgb(dark)!;
    const darkHsl = rgbToHsl(darkRgb.r, darkRgb.g, darkRgb.b);
    expect(darkHsl.l).toBeGreaterThanOrEqual(55);
    expect(darkHsl.l).toBeLessThanOrEqual(82);

    // Near-white → lightness above 82%
    const light = sanitizeHighlightColor('#F5F5FF');
    const lightRgb = hexToRgb(light)!;
    const lightHsl = rgbToHsl(lightRgb.r, lightRgb.g, lightRgb.b);
    expect(lightHsl.l).toBeGreaterThanOrEqual(55);
    expect(lightHsl.l).toBeLessThanOrEqual(82);
  });

  it('falls back to default on garbage input', () => {
    expect(sanitizeHighlightColor('not-a-color')).toBe(DEFAULT_MENTION_HIGHLIGHT_COLOR);
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
  });
});

describe('custom moderator and VIP rendering colors', () => {
  const roleMessage = (role: 'moderator' | 'vip'): ChatMessage => ({
    id: role,
    chatroomId: 1,
    content: 'role message',
    type: 'message',
    createdAt: '',
    sender: {
      id: 1,
      username: 'role-user',
      slug: 'role-user',
      identity: { color: '', badges: [{ type: role }], badgesV2: [] },
    },
    preserved: false,
  });

  it('syncs independently selected moderator and VIP colors into own-list CSS variables', () => {
    featureFlags.modFrameColor = '#38BDF8';
    featureFlags.vipFrameColor = '#A78BFA';
    const root = document.createElement('div');

    syncHighlightCssVars(root);

    expect(root.style.getPropertyValue('--kf-mod-bar')).toBe('rgba(56,189,248,0.95)');
    expect(root.style.getPropertyValue('--kf-mod-fill')).toBe('rgba(56,189,248,0.07)');
    expect(root.style.getPropertyValue('--kf-vip-bar')).toBe('rgba(167,139,250,0.95)');
    expect(root.style.getPropertyValue('--kf-vip-fill')).toBe('rgba(167,139,250,0.07)');
  });

  it('derives native moderator and VIP role shadows from their current flags', () => {
    featureFlags.modFrameColor = '#38BDF8';
    featureFlags.vipFrameColor = '#A78BFA';
    const modRow = document.createElement('div');
    const vipRow = document.createElement('div');

    applyNativeHighlights(modRow, roleMessage('moderator'));
    applyNativeHighlights(vipRow, roleMessage('vip'));

    expect(modRow.style.boxShadow).toContain('rgba(56,189,248,0.95)');
    expect(modRow.style.boxShadow).toContain('rgba(56,189,248,0.07)');
    expect(vipRow.style.boxShadow).toContain('rgba(167,139,250,0.95)');
    expect(vipRow.style.boxShadow).toContain('rgba(167,139,250,0.07)');
  });
});
