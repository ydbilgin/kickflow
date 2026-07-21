import { afterEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  applyNativeHighlights,
  applyOwnListHighlights,
  HL_FILL_CLASS,
  HL_FRAME_CLASS,
  ROLE_FILL_CLASS,
  ROLE_MOD_CLASS,
  ROLE_VIP_CLASS,
  syncHighlightCssVars,
} from '../../src/content/chat/message-highlight-apply';
import type { ChatMessage } from '../../src/content/chat/message-store';
import {
  DEFAULT_MENTION_HIGHLIGHT_COLOR,
  hexToRgb,
  normalizeHexColor,
  resolveMessageHighlightState,
  rgbToHsl,
  ROLE_BAR_ALPHA,
  ROLE_BAR_WIDTH_PX,
  ROLE_FILL_ALPHA,
  sanitizeHighlightColor,
  type MentionHighlightStyle,
  type MessageHighlightState,
  type ResolveMessageHighlightInput,
  type RoleHighlightStyle,
} from '../../src/content/chat/message-highlight';
import { invalidateOwnerIdentityCache } from '../../src/content/chat/owner-identity';

const originalFlags = { ...featureFlags };

afterEach(() => {
  Object.assign(featureFlags, originalFlags);
  invalidateOwnerIdentityCache();
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
  roleHighlightStyle: 'frame',
  modFrameEnabled: true,
  vipFrameEnabled: true,
  ...overrides,
});

/** Independent oracle for the exhaustive resolver table — must not call production code. */
function oracleHighlight(input: ResolveMessageHighlightInput): MessageHighlightState {
  const roleBar =
    input.isVip && input.vipFrameEnabled
      ? 'vip' as const
      : input.isModerator && input.modFrameEnabled
        ? 'moderator' as const
        : null;
  let personal: MessageHighlightState['personal'] = null;
  if (input.mentionHighlightEnabled) {
    if (input.replyToMe) personal = 'reply';
    else if (input.mentionMe) personal = 'mention';
  }
  const fill = personal != null && (input.mentionHighlightStyle === 'fill' || input.mentionHighlightStyle === 'both');
  const outline =
    personal != null
    && (input.mentionHighlightStyle === 'frame' || input.mentionHighlightStyle === 'both')
    && !input.jumpFlashActive;
  const roleFill =
    roleBar != null && input.roleHighlightStyle === 'both' && !fill
      ? roleBar
      : null;
  return { roleBar, roleFill, fill, outline, personal };
}

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

describe('resolveMessageHighlightState', () => {
  it('mention-only', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true }))).toEqual({
      roleBar: null,
      roleFill: null,
      fill: true,
      outline: true,
      personal: 'mention',
    });
  });

  it('reply-only (beats mention when both)', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true, replyToMe: true }))).toEqual({
      roleBar: null,
      roleFill: null,
      fill: true,
      outline: true,
      personal: 'reply',
    });
  });

  it('mod-only defaults to bar without role fill', () => {
    expect(resolveMessageHighlightState(base({ isModerator: true }))).toEqual({
      roleBar: 'moderator',
      roleFill: null,
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('vip-only defaults to bar without role fill', () => {
    expect(resolveMessageHighlightState(base({ isVip: true }))).toEqual({
      roleBar: 'vip',
      roleFill: null,
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('role style both adds roleFill on role-only rows', () => {
    expect(resolveMessageHighlightState(base({
      isModerator: true,
      roleHighlightStyle: 'both',
    }))).toEqual({
      roleBar: 'moderator',
      roleFill: 'moderator',
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('personal fill replaces role fill while keeping role bar', () => {
    expect(resolveMessageHighlightState(base({
      isModerator: true,
      mentionMe: true,
      roleHighlightStyle: 'both',
      mentionHighlightStyle: 'fill',
    }))).toEqual({
      roleBar: 'moderator',
      roleFill: null,
      fill: true,
      outline: false,
      personal: 'mention',
    });
  });

  it('role plus personal frame keeps role tint only in both', () => {
    expect(resolveMessageHighlightState(base({
      isVip: true,
      mentionMe: true,
      roleHighlightStyle: 'both',
      mentionHighlightStyle: 'frame',
    }))).toMatchObject({
      roleBar: 'vip',
      roleFill: 'vip',
      fill: false,
      outline: true,
    });
    expect(resolveMessageHighlightState(base({
      isVip: true,
      mentionMe: true,
      roleHighlightStyle: 'frame',
      mentionHighlightStyle: 'frame',
    }))).toMatchObject({
      roleBar: 'vip',
      roleFill: null,
      fill: false,
      outline: true,
    });
  });

  it('mention+mod stacks both channels', () => {
    expect(resolveMessageHighlightState(base({ mentionMe: true, isModerator: true }))).toEqual({
      roleBar: 'moderator',
      roleFill: null,
      fill: true,
      outline: true,
      personal: 'mention',
    });
  });

  it('reply+vip stacks both channels', () => {
    expect(resolveMessageHighlightState(base({ replyToMe: true, isVip: true }))).toEqual({
      roleBar: 'vip',
      roleFill: null,
      fill: true,
      outline: true,
      personal: 'reply',
    });
  });

  it('mention+jumpflash keeps fill but yields outline; role bar survives jump', () => {
    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      isModerator: true,
      jumpFlashActive: true,
      roleHighlightStyle: 'both',
    }))).toEqual({
      roleBar: 'moderator',
      roleFill: null,
      fill: true,
      outline: false,
      personal: 'mention',
    });
  });

  it('vip+mod both present → vip wins role bar', () => {
    expect(resolveMessageHighlightState(base({ isVip: true, isModerator: true }))).toEqual({
      roleBar: 'vip',
      roleFill: null,
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('none', () => {
    expect(resolveMessageHighlightState(base())).toEqual({
      roleBar: null,
      roleFill: null,
      fill: false,
      outline: false,
      personal: null,
    });
  });

  it('respects style frame/fill and disabled personal flag', () => {
    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      mentionHighlightStyle: 'frame',
    }))).toMatchObject({ fill: false, outline: true, personal: 'mention', roleFill: null });

    expect(resolveMessageHighlightState(base({
      mentionMe: true,
      mentionHighlightStyle: 'fill',
    }))).toMatchObject({ fill: true, outline: false, personal: 'mention', roleFill: null });

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
      roleHighlightStyle: 'both',
    }))).toMatchObject({ roleBar: 'moderator', roleFill: 'moderator' });
  });

  it('disabled roles create neither bar nor fill', () => {
    expect(resolveMessageHighlightState(base({
      isVip: true,
      isModerator: true,
      vipFrameEnabled: false,
      modFrameEnabled: false,
      roleHighlightStyle: 'both',
    }))).toMatchObject({ roleBar: null, roleFill: null });
  });

  it('enumerates all 1536 resolver combinations against an independent oracle', () => {
    const bools = [false, true] as const;
    const personalStyles: MentionHighlightStyle[] = ['frame', 'fill', 'both'];
    const roleStyles: RoleHighlightStyle[] = ['frame', 'both'];
    let count = 0;
    for (const isVip of bools) {
      for (const isModerator of bools) {
        for (const mentionMe of bools) {
          for (const replyToMe of bools) {
            for (const jumpFlashActive of bools) {
              for (const mentionHighlightEnabled of bools) {
                for (const modFrameEnabled of bools) {
                  for (const vipFrameEnabled of bools) {
                    for (const mentionHighlightStyle of personalStyles) {
                      for (const roleHighlightStyle of roleStyles) {
                        const input = base({
                          isVip,
                          isModerator,
                          mentionMe,
                          replyToMe,
                          jumpFlashActive,
                          mentionHighlightEnabled,
                          modFrameEnabled,
                          vipFrameEnabled,
                          mentionHighlightStyle,
                          roleHighlightStyle,
                        });
                        expect(resolveMessageHighlightState(input)).toEqual(oracleHighlight(input));
                        count += 1;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(count).toBe(1536);
  });
});

describe('sanitizeHighlightColor', () => {
  it('passes a safe in-range color through unchanged (normalized)', () => {
    expect(sanitizeHighlightColor('#FFC94D')).toBe('#FFC94D');
    expect(sanitizeHighlightColor('ffc94d')).toBe('#FFC94D');
    expect(sanitizeHighlightColor(DEFAULT_MENTION_HIGHLIGHT_COLOR)).toBe('#FFC94D');
  });

  it('nudges a green-band high-saturation color out of ~90–120°', () => {
    const nudged = sanitizeHighlightColor('#53FC18');
    const rgb = hexToRgb(nudged)!;
    const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    expect(s).toBeGreaterThan(55);
    expect(h < 90 || h > 120).toBe(true);
    expect(nudged).not.toBe('#53FC18');
  });

  it('clamps out-of-range lightness into [55%, 82%]', () => {
    const dark = sanitizeHighlightColor('#000080');
    const darkRgb = hexToRgb(dark)!;
    const darkHsl = rgbToHsl(darkRgb.r, darkRgb.g, darkRgb.b);
    expect(darkHsl.l).toBeGreaterThanOrEqual(55);
    expect(darkHsl.l).toBeLessThanOrEqual(82);

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

describe('role highlight rendering', () => {
  it('exports the built-in role constants exactly', () => {
    expect(ROLE_BAR_WIDTH_PX).toBe(2);
    expect(ROLE_BAR_ALPHA).toBe(0.80);
    expect(ROLE_FILL_ALPHA).toBe(0.04);
  });

  it('syncs independently selected moderator and VIP colors into own-list CSS variables', () => {
    featureFlags.modFrameColor = '#38BDF8';
    featureFlags.vipFrameColor = '#A78BFA';
    const root = document.createElement('div');

    syncHighlightCssVars(root);

    expect(root.style.getPropertyValue('--kf-mod-bar')).toBe('rgba(56,189,248,0.8)');
    expect(root.style.getPropertyValue('--kf-mod-fill')).toBe('rgba(56,189,248,0.04)');
    expect(root.style.getPropertyValue('--kf-vip-bar')).toBe('rgba(167,139,250,0.8)');
    expect(root.style.getPropertyValue('--kf-vip-fill')).toBe('rgba(167,139,250,0.04)');
  });

  it('own-list frame mode uses role bar class without role-fill', () => {
    featureFlags.roleHighlightStyle = 'frame';
    const row = document.createElement('div');
    applyOwnListHighlights(row, roleMessage('moderator'));
    expect(row.classList.contains(ROLE_MOD_CLASS)).toBe(true);
    expect(row.classList.contains(ROLE_FILL_CLASS)).toBe(false);
  });

  it('own-list both mode adds role-fill and live switch clears it', () => {
    featureFlags.roleHighlightStyle = 'both';
    const row = document.createElement('div');
    applyOwnListHighlights(row, roleMessage('vip'));
    expect(row.classList.contains(ROLE_VIP_CLASS)).toBe(true);
    expect(row.classList.contains(ROLE_FILL_CLASS)).toBe(true);

    featureFlags.roleHighlightStyle = 'frame';
    applyOwnListHighlights(row, roleMessage('vip'));
    expect(row.classList.contains(ROLE_VIP_CLASS)).toBe(true);
    expect(row.classList.contains(ROLE_FILL_CLASS)).toBe(false);
    expect(row.classList.contains(HL_FILL_CLASS)).toBe(false);
    expect(row.classList.contains(HL_FRAME_CLASS)).toBe(false);
  });

  it('native frame has 2px/0.80 bar and no 9999px role fill shadow', () => {
    featureFlags.roleHighlightStyle = 'frame';
    featureFlags.modFrameColor = '#38BDF8';
    const row = document.createElement('div');
    applyNativeHighlights(row, roleMessage('moderator'));

    expect(row.style.boxShadow).toBe('inset 2px 0 0 rgba(56,189,248,0.8)');
    expect(row.style.boxShadow).not.toContain('9999px');
    expect(row.style.background).toBe('');
    expect(row.style.backgroundColor).toBe('');
    expect(row.style.border).toBe('');
    expect(row.style.borderLeft).toBe('');
  });

  it('native both emits bar then role fill; personal fill replaces role fill and keeps bar first', () => {
    featureFlags.roleHighlightStyle = 'both';
    featureFlags.vipFrameColor = '#A78BFA';
    featureFlags.mentionHighlightEnabled = true;
    featureFlags.mentionHighlightStyle = 'fill';
    featureFlags.mentionHighlightColor = '#FFC94D';
    featureFlags.manualUsername = 'owner';

    const vipOnly = document.createElement('div');
    applyNativeHighlights(vipOnly, roleMessage('vip'));
    expect(vipOnly.style.boxShadow).toBe(
      'inset 2px 0 0 rgba(167,139,250,0.8), inset 0 0 0 9999px rgba(167,139,250,0.04)',
    );

    const withReply: ChatMessage = {
      ...roleMessage('vip'),
      id: 'vip-reply',
      content: 'hi',
      replyContext: {
        replyToUser: 'owner',
        replyToText: 'prior',
        replyToMessageId: 'x',
        replyToUserId: null,
      },
    };
    const row = document.createElement('div');
    applyNativeHighlights(row, withReply);
    expect(row.style.boxShadow.startsWith('inset 2px 0 0 rgba(167,139,250,0.8)')).toBe(true);
    expect(row.style.boxShadow).toContain('rgba(255,201,77,0.18)');
    expect(row.style.boxShadow).not.toContain('rgba(167,139,250,0.04)');
    expect(row.style.backgroundColor).toBe('');
    expect(row.style.borderLeft).toBe('');
  });
});
