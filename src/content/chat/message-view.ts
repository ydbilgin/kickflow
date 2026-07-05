import type { ChatBadge, ChatMessage } from './message-store';

export const MESSAGE_CLASS = 'kickflow-message';
export const PRESERVED_CLASS = 'kickflow-preserved';
export const BANNED_CLASS = 'kickflow-banned';
export const TIMEOUT_CLASS = 'kickflow-timeout';
export const DELETED_CLASS = 'kickflow-deleted';

// Kick official emotes only (confirmed scope — no 7TV/BTTV). Live-verified 2026-07-04:
// `/fullsize` on this path returns 200 image/gif; the same URL without it returns 403.
const EMOTE_URL_PREFIX = 'https://files.kick.com/emotes/';
const EMOTE_URL_SUFFIX = '/fullsize';

const TRUSTED_IMAGE_HOST = 'kick.com';
const TRUSTED_IMAGE_HOST_SUFFIX = '.kick.com';

// 7TV's own tokenizer regex (`/( )|(\[emote:\d{1,10}:.{1,30}\])/`) inspired the emote
// token shape; extended with url/mention alternatives so one pass over `content` handles
// all three safely via named capture groups instead of string concatenation.
const CONTENT_TOKEN_RE =
  /\[emote:(?<emoteId>\d{1,10}):(?<emoteName>.{1,30})\]|(?<url>https?:\/\/[^\s]+)|(?<mention>@[a-zA-Z0-9_]{1,25})/g;

function isTrustedBadgeImageUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== TRUSTED_IMAGE_HOST && !url.hostname.endsWith(TRUSTED_IMAGE_HOST_SUFFIX)) return null;
  return url;
}

function isAllowedLinkUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

function appendEmote(parent: HTMLElement, id: string, name: string, rawToken: string): void {
  // Redundant with the regex's \d{1,10}, but kept as an explicit gate right before URL
  // construction per the safe-render checklist — cheap insurance if the regex ever changes.
  if (!/^\d+$/.test(id)) {
    parent.appendChild(document.createTextNode(rawToken));
    return;
  }
  const img = document.createElement('img');
  img.src = `${EMOTE_URL_PREFIX}${id}${EMOTE_URL_SUFFIX}`;
  img.alt = name;
  img.className = 'kickflow-emote';
  img.loading = 'lazy';
  parent.appendChild(img);
}

function appendLink(parent: HTMLElement, rawUrl: string): void {
  const url = isAllowedLinkUrl(rawUrl);
  if (!url) {
    parent.appendChild(document.createTextNode(rawUrl));
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url.href;
  anchor.textContent = rawUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.className = 'kickflow-link';
  parent.appendChild(anchor);
}

function appendMention(parent: HTMLElement, rawMention: string): void {
  const span = document.createElement('span');
  span.className = 'kickflow-mention';
  span.textContent = rawMention;
  parent.appendChild(span);
}

/** Safe-render only: message text is fully attacker-controlled. Every branch below
 * builds nodes via createElement/textContent — never innerHTML or string concatenation. */
function appendParsedContent(parent: HTMLElement, content: string): void {
  let lastIndex = 0;
  for (const match of content.matchAll(CONTENT_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parent.appendChild(document.createTextNode(content.slice(lastIndex, index)));
    }
    const groups = match.groups ?? {};
    if (groups.emoteId) {
      appendEmote(parent, groups.emoteId, groups.emoteName ?? '', match[0]);
    } else if (groups.url) {
      appendLink(parent, groups.url);
    } else if (groups.mention) {
      appendMention(parent, groups.mention);
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) {
    parent.appendChild(document.createTextNode(content.slice(lastIndex)));
  }
}

function appendBadges(parent: HTMLElement, badges: ChatBadge[]): void {
  for (const badge of badges) {
    if (badge.imageUrl) {
      const url = isTrustedBadgeImageUrl(badge.imageUrl);
      if (url) {
        const img = document.createElement('img');
        img.src = url.href;
        img.alt = badge.text || badge.type || 'badge';
        img.className = 'kickflow-badge-icon';
        img.loading = 'lazy';
        parent.appendChild(img);
        continue;
      }
      // untrusted scheme/host (tracking/IP-leak risk) — fall through to text fallback
    }
    const label = badge.text || badge.type;
    if (label) {
      const span = document.createElement('span');
      span.className = 'kickflow-badge-text';
      span.textContent = label;
      parent.appendChild(span);
    }
  }
}

function appendStatusLabel(row: HTMLElement, text: string, modifier: string): void {
  const label = document.createElement('span');
  label.className = `kickflow-status-label kickflow-status-label--${modifier}`;
  label.textContent = text;
  row.appendChild(label);
}

/** Compact Turkish duration from minutes: "5dk", "1sa 30dk", "2g". Empty when unknown. */
function formatTimeoutDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '';
  if (min < 60) return `${Math.round(min)}dk`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h}sa ${m}dk` : `${h}sa`;
  }
  return `${Math.round(min / (60 * 24))}g`;
}

/** The moderator who issued the action, as a subtle non-uppercase suffix (e.g. "· Chhatto"). */
function appendModLabel(row: HTMLElement, mod: string | null | undefined): void {
  if (!mod) return;
  const span = document.createElement('span');
  span.className = 'kickflow-mod-label';
  span.textContent = `· ${mod}`;
  row.appendChild(span);
}

/** Applies preserved/banned/deleted visual status to an already-built row. Idempotent,
 * and deliberately called from two places:
 *  - buildMessageElement, at render time (covers a UserBannedEvent arriving while the
 *    message is still sitting in the render batch — the row must reflect the store's
 *    current status the moment it's built, not just react to later events).
 *  - ban-guard.ts, as the second layer, for rows that were already rendered BEFORE the
 *    event arrived.
 */
export function applyPreservedMarking(row: HTMLElement, message: ChatMessage): void {
  if (!message.preserved || row.classList.contains(PRESERVED_CLASS)) return;
  row.classList.add(PRESERVED_CLASS);
  const meta = message.preservedMeta ?? {};

  if (message.preservedReason === 'banned') {
    // Kick's ban events carry `permanent`: false = timeout (with a duration), true/absent = a
    // permanent ban. "banlandı" is reserved for permanent bans; timeouts show their length.
    if (meta.permanent === false) {
      row.classList.add(TIMEOUT_CLASS);
      const dur = formatTimeoutDuration(meta.durationMin);
      appendStatusLabel(row, dur ? `timeout ${dur}` : 'timeout', 'timeout');
      appendModLabel(row, meta.bannedBy);
    } else {
      row.classList.add(BANNED_CLASS);
      appendStatusLabel(row, 'banlandı', 'banned');
      appendModLabel(row, meta.bannedBy);
    }
  } else if (message.preservedReason === 'deleted') {
    row.classList.add(DELETED_CLASS);
    appendStatusLabel(row, 'silindi', 'deleted');
  }
}

export function buildMessageElement(message: ChatMessage): HTMLElement {
  const row = document.createElement('div');
  row.className = MESSAGE_CLASS;
  row.dataset.messageId = message.id;

  const time = document.createElement('span');
  time.className = 'kickflow-message__time';
  const createdAt = new Date(message.createdAt);
  time.textContent = Number.isNaN(createdAt.getTime())
    ? ''
    : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const badges = document.createElement('span');
  badges.className = 'kickflow-message__badges';
  const badgeSource = message.sender.identity.badgesV2.length > 0
    ? message.sender.identity.badgesV2
    : message.sender.identity.badges;
  appendBadges(badges, badgeSource);

  const username = document.createElement('span');
  username.className = 'kickflow-message__username';
  username.textContent = message.sender.username;
  // Property assignment only — the setter rejects invalid values. Never
  // setAttribute('style', ...) / .cssText, which would accept arbitrary CSS text.
  username.style.color = message.sender.identity.color || 'inherit';

  const separator = document.createElement('span');
  separator.className = 'kickflow-message__separator';
  separator.textContent = ': ';

  const content = document.createElement('span');
  content.className = 'kickflow-message__content';
  appendParsedContent(content, message.content);

  row.append(time, badges, username, separator, content);
  applyPreservedMarking(row, message);

  return row;
}
