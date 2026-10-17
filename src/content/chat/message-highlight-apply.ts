import { featureFlags } from './feature-flags';
import {
  personalFillRgba,
  personalOutlineRgba,
  rgbaFromHex,
  resolveMessageHighlightState,
  ROLE_BAR_ALPHA,
  ROLE_BAR_WIDTH_PX,
  ROLE_FILL_ALPHA,
  type MessageHighlightState,
  type MentionHighlightStyle,
} from './message-highlight';
import {
  mergeIdentityBadges,
  normalizeChatIdentity,
  type ChatMessage,
  type ChatIntegrityStore,
} from './message-store';
import { OWN_LIST_ID } from './overlay-mount';
import { resolveOwnerIdentity } from './owner-identity';
import { extractMentionUsernames } from './content-tokens';

export const ROLE_VIP_CLASS = 'kickflow-message--role-vip';
export const ROLE_MOD_CLASS = 'kickflow-message--role-mod';
export const ROLE_FILL_CLASS = 'kickflow-message--role-fill';
export const MENTION_ME_CLASS = 'kickflow-message--mention-me';
export const REPLY_ME_CLASS = 'kickflow-message--reply-me';
export const HL_FILL_CLASS = 'kickflow-message--hl-fill';
export const HL_FRAME_CLASS = 'kickflow-message--hl-frame';
export const REPLY_TO_ME_CONTEXT_CLASS = 'kickflow-message__reply-context--to-me';
export const REPLY_ME_MARK_CLASS = 'kickflow-message__reply-me-mark';
export const JUMP_HIGHLIGHT_CLASS = 'kickflow-message--jump-highlight';

const OWN_HIGHLIGHT_CLASSES = [
  ROLE_VIP_CLASS,
  ROLE_MOD_CLASS,
  ROLE_FILL_CLASS,
  MENTION_ME_CLASS,
  REPLY_ME_CLASS,
  HL_FILL_CLASS,
  HL_FRAME_CLASS,
] as const;

let activeHighlightStore: ChatIntegrityStore | null = null;

/** Session wiring — own and native init both register the live store for flag-change refresh. */
export function setHighlightStore(store: ChatIntegrityStore | null): void {
  activeHighlightStore = store;
}

export function messageMentionsOwner(content: string, ownerUsername: string | null): boolean {
  if (!ownerUsername) return false;
  const want = normalizeChatIdentity(ownerUsername);
  return extractMentionUsernames(content)
    .some((name) => normalizeChatIdentity(name) === want);
}

export function messageRepliesToOwner(
  message: ChatMessage,
  owner: { username: string | null; userId: number | null },
): boolean {
  const ctx = message.replyContext;
  if (!ctx) return false;
  if (owner.userId != null && ctx.replyToUserId != null && ctx.replyToUserId === owner.userId) {
    return true;
  }
  if (owner.username && ctx.replyToUser) {
    return normalizeChatIdentity(ctx.replyToUser) === normalizeChatIdentity(owner.username);
  }
  return false;
}

export function computeHighlightForMessage(
  message: ChatMessage,
  jumpFlashActive: boolean,
): MessageHighlightState {
  const owner = resolveOwnerIdentity();
  const badges = mergeIdentityBadges(message.sender.identity);
  const isVip = badges.some((b) => b.type === 'vip');
  const isModerator = badges.some((b) => b.type === 'moderator');
  const mentionMe = messageMentionsOwner(message.content, owner.username);
  const replyToMe = messageRepliesToOwner(message, owner);
  return resolveMessageHighlightState({
    isVip,
    isModerator,
    mentionMe,
    replyToMe,
    jumpFlashActive,
    mentionHighlightEnabled: featureFlags.mentionHighlightEnabled,
    mentionHighlightStyle: featureFlags.mentionHighlightStyle,
    roleHighlightStyle: featureFlags.roleHighlightStyle,
    modFrameEnabled: featureFlags.modFrameEnabled,
    vipFrameEnabled: featureFlags.vipFrameEnabled,
  });
}

/** Sync CSS custom properties used by the own-list stylesheet for live highlight colors. */
export function syncHighlightCssVars(root?: HTMLElement | null): void {
  const target = root
    ?? document.getElementById(OWN_LIST_ID)
    ?? document.documentElement;
  const color = featureFlags.mentionHighlightColor;
  const style = featureFlags.mentionHighlightStyle;
  target.style.setProperty('--kf-hl-outline', personalOutlineRgba(color));
  target.style.setProperty('--kf-hl-fill', personalFillRgba(color, style === 'fill' ? 'fill' : 'both'));
  target.style.setProperty('--kf-hl-fill-only', personalFillRgba(color, 'fill'));
  target.style.setProperty('--kf-mod-bar', rgbaFromHex(featureFlags.modFrameColor, ROLE_BAR_ALPHA));
  target.style.setProperty('--kf-mod-fill', rgbaFromHex(featureFlags.modFrameColor, ROLE_FILL_ALPHA));
  target.style.setProperty('--kf-vip-bar', rgbaFromHex(featureFlags.vipFrameColor, ROLE_BAR_ALPHA));
  target.style.setProperty('--kf-vip-fill', rgbaFromHex(featureFlags.vipFrameColor, ROLE_FILL_ALPHA));
}

/** Own-list: class-based layers (outline/border/background live in bootstrap stylesheet). */
export function applyOwnListHighlights(row: HTMLElement, message: ChatMessage): void {
  if (message.systemEvent) {
    clearOwnListHighlights(row);
    return;
  }
  const jumpFlashActive = row.classList.contains(JUMP_HIGHLIGHT_CLASS);
  const state = computeHighlightForMessage(message, jumpFlashActive);
  clearOwnListHighlights(row);

  if (state.roleBar === 'vip') row.classList.add(ROLE_VIP_CLASS);
  else if (state.roleBar === 'moderator') row.classList.add(ROLE_MOD_CLASS);
  if (state.roleFill) row.classList.add(ROLE_FILL_CLASS);

  if (state.personal === 'mention') row.classList.add(MENTION_ME_CLASS);
  if (state.personal === 'reply') row.classList.add(REPLY_ME_CLASS);

  // Always mark frame intent when style wants it; CSS yields outline to jump-flash via :not().
  const style = featureFlags.mentionHighlightStyle;
  if (state.personal && (style === 'fill' || style === 'both')) row.classList.add(HL_FILL_CLASS);
  if (state.personal && (style === 'frame' || style === 'both')) row.classList.add(HL_FRAME_CLASS);

  if (state.personal === 'reply') ensureReplyToMeMarker(row);
}

function clearOwnListHighlights(row: HTMLElement): void {
  row.classList.remove(...OWN_HIGHLIGHT_CLASSES);
  row.querySelector(`.${REPLY_ME_MARK_CLASS}`)?.remove();
  row.querySelector(`.${REPLY_TO_ME_CONTEXT_CLASS}`)?.classList.remove(REPLY_TO_ME_CONTEXT_CLASS);
}

function ensureReplyToMeMarker(row: HTMLElement): void {
  const existing = row.querySelector<HTMLElement>('.kickflow-message__reply-context');
  if (existing) {
    existing.classList.add(REPLY_TO_ME_CONTEXT_CLASS);
    return;
  }
  if (row.querySelector(`.${REPLY_ME_MARK_CLASS}`)) return;
  const mark = document.createElement('span');
  mark.className = REPLY_ME_MARK_CLASS;
  mark.textContent = '↩';
  mark.setAttribute('aria-hidden', 'true');
  row.insertBefore(mark, row.firstChild);
}

/**
 * Native mode: layout-neutral outline + inset box-shadow only.
 * Never touches border-color / background-color on Kick's own rows.
 */
export function applyNativeHighlights(row: HTMLElement, message: ChatMessage): void {
  clearNativeHighlightStyles(row);
  if (message.systemEvent) return;

  const jumpFlashActive = row.classList.contains(JUMP_HIGHLIGHT_CLASS);
  const state = computeHighlightForMessage(message, jumpFlashActive);
  const color = featureFlags.mentionHighlightColor;
  const styleMode = featureFlags.mentionHighlightStyle;

  const shadows: string[] = [];
  if (state.roleBar === 'vip') {
    shadows.push(`inset ${ROLE_BAR_WIDTH_PX}px 0 0 ${rgbaFromHex(featureFlags.vipFrameColor, ROLE_BAR_ALPHA)}`);
  } else if (state.roleBar === 'moderator') {
    shadows.push(`inset ${ROLE_BAR_WIDTH_PX}px 0 0 ${rgbaFromHex(featureFlags.modFrameColor, ROLE_BAR_ALPHA)}`);
  }
  if (state.roleFill === 'vip') {
    shadows.push(`inset 0 0 0 9999px ${rgbaFromHex(featureFlags.vipFrameColor, ROLE_FILL_ALPHA)}`);
  } else if (state.roleFill === 'moderator') {
    shadows.push(`inset 0 0 0 9999px ${rgbaFromHex(featureFlags.modFrameColor, ROLE_FILL_ALPHA)}`);
  }

  if (state.fill) {
    shadows.push(`inset 0 0 0 9999px ${personalFillRgba(color, fillStyleForNative(styleMode))}`);
  }

  if (state.outline) {
    row.style.outline = `2px solid ${personalOutlineRgba(color)}`;
    row.style.outlineOffset = '1px';
  }

  if (shadows.length > 0) {
    row.style.boxShadow = shadows.join(', ');
  }

  if (state.personal === 'reply') ensureReplyToMeMarker(row);
}

function fillStyleForNative(style: MentionHighlightStyle): MentionHighlightStyle {
  return style === 'fill' ? 'fill' : 'both';
}

export function clearNativeHighlightStyles(row: HTMLElement): void {
  row.style.outline = '';
  row.style.outlineOffset = '';
  row.style.boxShadow = '';
  row.querySelector(`.${REPLY_ME_MARK_CLASS}`)?.remove();
  row.querySelector(`.${REPLY_TO_ME_CONTEXT_CLASS}`)?.classList.remove(REPLY_TO_ME_CONTEXT_CLASS);
}

/** Re-apply own-list highlights after flag/color/identity changes.
 * Callers should also invoke `reconcileActiveNativeChat()` so native rows refresh. */
export function refreshMessageHighlights(): void {
  syncHighlightCssVars();
  const store = activeHighlightStore;
  const list = document.getElementById(OWN_LIST_ID);
  if (list && store) {
    list.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
      const id = row.dataset.messageId;
      if (!id) return;
      const message = store.getMessageById(id);
      if (message) applyOwnListHighlights(row, message);
    });
  }
}
