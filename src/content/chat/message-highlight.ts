/**
 * Pure highlight precedence + personal-color guardrails for mention/reply/mod/VIP framing.
 * DOM-free so vitest can enumerate stacking combinations without jsdom row fixtures.
 */

export type MentionHighlightStyle = 'frame' | 'fill' | 'both';
/** Shared moderator/VIP visual treatment: left bar only, or bar plus faint row fill. */
export type RoleHighlightStyle = 'frame' | 'both';
export type RoleBar = 'vip' | 'moderator' | null;
export type PersonalKind = 'reply' | 'mention' | null;

export const DEFAULT_MENTION_HIGHLIGHT_COLOR = '#FFC94D';

/** Role left-bar width (own-list border / native inset shadow). */
export const ROLE_BAR_WIDTH_PX = 2;
/** Role left-bar alpha over the chat surface. */
export const ROLE_BAR_ALPHA = 0.80;
/** Opt-in role full-row tint alpha (`both` style only). */
export const ROLE_FILL_ALPHA = 0.04;

/** Curated swatches for the Sohbet color pickers (personal default first). None are in Kick's reserved green band. */
export const MENTION_COLOR_SWATCHES = [
  '#FFC94D', // default amber
  '#F59E0B', // amber
  '#22D3EE', // cyan
  '#38BDF8', // sky
  '#A78BFA', // violet
  '#E879F9', // magenta
  '#FB7185', // coral
  '#2DD4BF', // mint/teal (outside reserved ~90–120° green)
] as const;

export interface ResolveMessageHighlightInput {
  isVip: boolean;
  isModerator: boolean;
  mentionMe: boolean;
  replyToMe: boolean;
  jumpFlashActive: boolean;
  mentionHighlightEnabled: boolean;
  mentionHighlightStyle: MentionHighlightStyle;
  /** Shared moderator/VIP style. Missing callers should pass `'frame'`. */
  roleHighlightStyle: RoleHighlightStyle;
  modFrameEnabled: boolean;
  vipFrameEnabled: boolean;
}

export interface MessageHighlightState {
  roleBar: RoleBar;
  /** Role full-row tint when style is `both` and personal fill is not active. */
  roleFill: RoleBar;
  /** Apply personal fill layer. */
  fill: boolean;
  /** Apply personal outline (false while jump-flash owns the outline). */
  outline: boolean;
  /** Which personal attention kind is active (reply beats mention). */
  personal: PersonalKind;
}

/**
 * Three independent visual channels (role fill is a supplemental treatment of the role bar,
 * not a fourth precedence channel):
 * 1. roleBar — vip beats moderator; never suppressed by personal/flash; always present for both styles
 * 2. personal fill — when style includes fill (replaces role fill when both would apply)
 * 3. personal outline — yielded to jump-flash while flash is active
 */
export function resolveMessageHighlightState(input: ResolveMessageHighlightInput): MessageHighlightState {
  const roleBar: RoleBar = input.isVip && input.vipFrameEnabled
    ? 'vip'
    : input.isModerator && input.modFrameEnabled
      ? 'moderator'
      : null;

  let personal: PersonalKind = null;
  if (input.mentionHighlightEnabled) {
    if (input.replyToMe) personal = 'reply';
    else if (input.mentionMe) personal = 'mention';
  }

  const style = input.mentionHighlightStyle;
  const wantsFill = personal != null && (style === 'fill' || style === 'both');
  const wantsFrame = personal != null && (style === 'frame' || style === 'both');
  const outline = wantsFrame && !input.jumpFlashActive;
  const roleFill: RoleBar =
    roleBar != null && input.roleHighlightStyle === 'both' && !wantsFill
      ? roleBar
      : null;

  return { roleBar, roleFill, fill: wantsFill, outline, personal };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Normalize `#RGB` / `#RRGGBB` (optional leading #) to uppercase `#RRGGBB`, or null. */
export function normalizeHexColor(value: string): string | null {
  const raw = value.trim();
  const m = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  return `#${hex.toUpperCase()}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
    case gn: h = ((bn - rn) / d + 2); break;
    default: h = ((rn - gn) / d + 4); break;
  }
  h *= 60;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hp >= 0 && hp < 1) { rn = c; gn = x; }
  else if (hp < 2) { rn = x; gn = c; }
  else if (hp < 3) { gn = c; bn = x; }
  else if (hp < 4) { gn = x; bn = c; }
  else if (hp < 5) { rn = x; bn = c; }
  else { rn = c; bn = x; }
  const m = ln - c / 2;
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255),
  };
}

/**
 * Guardrail for the custom highlight-color pickers:
 * - Clamp lightness into [55%, 82%]
 * - Nudge hue out of Kick's reserved green band (~90°–120°) when saturation > 55%
 * Safe in-range colors pass through unchanged (aside from hex normalization).
 */
export function sanitizeHighlightColor(raw: string): string {
  const normalized = normalizeHexColor(raw);
  if (!normalized) return DEFAULT_MENTION_HIGHLIGHT_COLOR;
  const rgb = hexToRgb(normalized);
  if (!rgb) return DEFAULT_MENTION_HIGHLIGHT_COLOR;
  let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const lightBefore = l;
  l = Math.min(82, Math.max(55, l));

  let hueNudged = false;
  if (s > 55 && h >= 90 && h <= 120) {
    h = h < 105 ? 89 : 121;
    hueNudged = true;
  }

  if (!hueNudged && lightBefore === l) {
    return normalized;
  }
  const out = hslToRgb(h, s, l);
  return rgbToHex(out.r, out.g, out.b);
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_MENTION_HIGHLIGHT_COLOR)!;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

export function personalOutlineRgba(hex: string): string {
  return rgbaFromHex(hex, 0.95);
}

export function personalFillRgba(hex: string, style: MentionHighlightStyle): string {
  return rgbaFromHex(hex, style === 'fill' ? 0.18 : 0.13);
}
