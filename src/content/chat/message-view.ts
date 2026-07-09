import { mergeIdentityBadges, type ChatBadge, type ChatMessage, type ChatMessageSender, type PreservedMeta, type SubscriberBadge } from './message-store';
import { isMasqueradeEnabled, isSafeKickSlug, openUserCard } from './user-card';
import { ROLE_BADGE_ASSETS, ROLE_BADGE_FALLBACK_LABELS } from './badge-assets';

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
  // Plain left-click: open it ourselves so the click can't bubble to Kick's SPA router and navigate
  // the page (a same-origin kick.com link pasted in chat would otherwise route). Modified/middle
  // clicks fall through to the native new-tab (Kick's router ignores those).
  anchor.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(url.href, '_blank', 'noopener,noreferrer');
  });
  parent.appendChild(anchor);
}

export function wireProfileSlugLink(
  element: HTMLElement,
  slug: string,
  displayName: string,
  linkClass: string,
): void {
  if (!isSafeKickSlug(slug)) return;
  const profileUrl = `https://kick.com/${slug}`;
  element.classList.add(linkClass);
  element.setAttribute('role', 'link');
  element.tabIndex = 0;
  const act = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!isMasqueradeEnabled() && (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey)) {
      window.open(profileUrl, '_blank', 'noopener,noreferrer');
    } else {
      void openUserCard(slug, displayName, event.clientX, event.clientY);
    }
  };
  element.addEventListener('click', (event) => { if (event.button === 0) act(event); });
  element.addEventListener('auxclick', (event) => { if (event.button === 1) act(event); });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = element.getBoundingClientRect();
    void openUserCard(slug, displayName, rect.left, rect.bottom);
  });
}

function appendMention(parent: HTMLElement, rawMention: string): void {
  const span = document.createElement('span');
  span.className = 'kickflow-mention';
  span.textContent = rawMention;
  const displayName = rawMention.slice(1);
  wireProfileSlugLink(span, displayName.toLowerCase(), displayName, 'kickflow-mention--link');
  parent.appendChild(span);
}

export function wireUsernameProfileLink(
  username: HTMLElement,
  sender: ChatMessageSender,
  displayName: string,
  linkClass: string,
): void {
  const privacyMasked = isMasqueradeEnabled() || (
    sender.displayName != null && sender.displayName !== sender.username
  );
  if (privacyMasked) return;
  wireProfileSlugLink(username, sender.slug, displayName, linkClass);
}

/** Safe-render only: message text is fully attacker-controlled. Every branch below
 * builds nodes via createElement/textContent — never innerHTML or string concatenation. */
export function appendParsedContent(parent: HTMLElement, content: string): void {
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

// Kick draws role badges from its own bundled inline SVGs, keyed by `type`. We've captured the
// authentic ones into ROLE_BADGE_ASSETS (./badge-assets) for moderator/vip/og/sub_gifter/
// verified/staff — those render as real <img>s below. Types with no captured asset yet
// (broadcaster/founder/sidekick/bot/trainwreckstv) fall back to our own compact colored chip.
// Colors are our own, chosen to be distinct & readable on dark chat.
interface RoleBadgeFallbackStyle { glyph: string; color: string; }
const ROLE_BADGE_FALLBACK_STYLES: Record<string, RoleBadgeFallbackStyle> = {
  broadcaster:   { glyph: '★', color: '#E9113C' },
  founder:       { glyph: '♛', color: '#F97316' },
  sidekick:      { glyph: '✦', color: '#8B5CF6' },
  bot:           { glyph: '⚙', color: '#64748B' },
  trainwreckstv: { glyph: '▲', color: '#F59E0B' },
};
// Subscriber has no bundled role-level asset — Kick serves the CHANNEL's own custom image
// instead (resolveSubscriberBadge below). This is its chip fallback for when that image isn't
// available (channel has no subscriber_badges yet, or the count doesn't clear a tier).
const SUBSCRIBER_FALLBACK_STYLE: RoleBadgeFallbackStyle = { glyph: '★', color: '#3B82F6' };

// Set from bootstrap.ts once the channel's `subscriber_badges` are resolved (Kick's own custom
// per-month images). Empty until then, or on a channel with no custom tiers configured.
let subscriberBadges: SubscriberBadge[] = [];

export function setSubscriberBadges(badges: SubscriberBadge[]): void {
  subscriberBadges = badges;
}

/** Highest-tier sub badge whose month threshold the user has reached (list is months-ASC). */
function resolveSubscriberBadge(count: number | undefined): SubscriberBadge | null {
  if (!count || !subscriberBadges.length) return null;
  let match: SubscriberBadge | null = null;
  for (const b of subscriberBadges) {
    if (count >= b.months) match = b;
    else break;
  }
  return match;
}

function appendRoleBadge(parent: HTMLElement, label: string, style: RoleBadgeFallbackStyle, count?: number): void {
  const chip = document.createElement('span');
  chip.className = 'kickflow-badge-role';
  // Property assignment only (never setAttribute('style')/.cssText) — color is one of our own
  // trusted constants above, same pattern as username.style.color elsewhere in this file.
  chip.style.backgroundColor = style.color;
  chip.title = label + (count ? ` (${count})` : '');
  const glyph = document.createElement('span');
  glyph.textContent = style.glyph;
  chip.appendChild(glyph);
  if (count) {
    const countEl = document.createElement('span');
    countEl.className = 'kickflow-badge-role__count';
    countEl.textContent = String(count);
    chip.appendChild(countEl);
  }
  parent.appendChild(chip);
}

/** Per-badge render order: badges_v2 image → authentic role asset → subscriber's real channel
 * image → labelled chip fallback → plain text fallback. Every rendered badge gets a `title`
 * (hover tooltip) so unlabelled icons/chips are still identifiable. */
export function appendBadges(parent: HTMLElement, badges: ChatBadge[]): void {
  for (const badge of badges) {
    // 1. badges_v2 image (level, and anything else Kick sends pre-rendered with image_url).
    if (badge.imageUrl) {
      const url = isTrustedBadgeImageUrl(badge.imageUrl);
      if (url) {
        const img = document.createElement('img');
        img.src = url.href;
        const title = badge.level != null ? `${badge.level}. Seviye` : (badge.name || badge.text || 'rozet');
        img.alt = title;
        img.title = title;
        img.className = 'kickflow-badge-icon';
        img.loading = 'lazy';
        parent.appendChild(img);
        continue;
      }
      // untrusted scheme/host (tracking/IP-leak risk) — fall through to the other renders below
    }

    // 2. Authentic Kick role asset (our own constants — no trust check needed).
    const asset = badge.type ? ROLE_BADGE_ASSETS[badge.type] : undefined;
    if (asset) {
      const img = document.createElement('img');
      img.src = asset.uri;
      img.alt = asset.label;
      img.title = asset.label;
      img.className = 'kickflow-badge-icon';
      img.loading = 'lazy';
      parent.appendChild(img);
      continue;
    }

    // 3. Subscriber — the channel's own real image, resolved by month count.
    if (badge.type === 'subscriber') {
      const sub = resolveSubscriberBadge(badge.count);
      const subUrl = sub ? isTrustedBadgeImageUrl(sub.src) : null;
      if (subUrl) {
        const img = document.createElement('img');
        img.src = subUrl.href;
        const title = `Abone${badge.count ? ` — ${badge.count} ay` : ''}`;
        img.alt = title;
        img.title = title;
        img.className = 'kickflow-badge-icon';
        img.loading = 'lazy';
        parent.appendChild(img);
      } else {
        appendRoleBadge(parent, 'Abone', SUBSCRIBER_FALLBACK_STYLE, badge.count);
      }
      continue;
    }

    // 4. Labelled chip fallback (no captured asset for this role type).
    const fallbackStyle = badge.type ? ROLE_BADGE_FALLBACK_STYLES[badge.type] : undefined;
    if (fallbackStyle) {
      const label = (badge.type && ROLE_BADGE_FALLBACK_LABELS[badge.type]) || badge.type || '';
      appendRoleBadge(parent, label, fallbackStyle, badge.count);
      continue;
    }

    // 5. Plain text fallback (unknown type entirely).
    const label = badge.text || badge.name || badge.type;
    if (label) {
      const span = document.createElement('span');
      span.className = 'kickflow-badge-text';
      span.textContent = label;
      span.title = label;
      parent.appendChild(span);
    }
  }
}

export function appendStatusLabel(row: HTMLElement, text: string, modifier: string): void {
  const label = document.createElement('span');
  label.className = `kickflow-status-label kickflow-status-label--${modifier}`;
  label.textContent = text;
  row.appendChild(label);
}

/** Compact Turkish duration from minutes: "5dk", "1sa 30dk", "2g". Empty when unknown. */
export function formatTimeoutDuration(min: number | null | undefined): string {
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
export function appendModLabel(row: HTMLElement, mod: string | null | undefined): void {
  if (!mod) return;
  const span = document.createElement('span');
  span.className = 'kickflow-mod-label';
  span.textContent = `· ${mod}`;
  row.appendChild(span);
}

/** Who/what removed a deleted message. Public MessageDeletedEvent usually carries only
 * aiModerated + flagged rules; if Kick ever includes a human actor, prefer that name. */
export function deleteAttribution(meta: PreservedMeta): string | null {
  if (meta.deletedBy) return meta.deletedBy;
  if (meta.aiModerated === true) {
    const rules = (meta.violatedRules ?? []).filter(Boolean);
    return rules.length ? `AI mod (${rules.join(', ')})` : 'AI mod';
  }
  if (meta.aiModerated === false) return 'mod';
  return null;
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
    appendModLabel(row, deleteAttribution(meta));
  }
}

function appendReplyContext(row: HTMLElement, message: ChatMessage): void {
  const context = message.replyContext;
  if (!context || (!context.replyToUser && !context.replyToText)) return;

  const reply = document.createElement('span');
  reply.className = 'kickflow-message__reply-context';

  const icon = document.createElement('span');
  icon.className = 'kickflow-message__reply-icon';
  icon.textContent = '↩';
  reply.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'kickflow-message__reply-text';
  if (context.replyToUser) {
    const user = document.createElement('span');
    user.className = 'kickflow-message__reply-user';
    user.textContent = context.replyToUser;
    user.title = context.replyToUser;
    text.appendChild(user);
    if (context.replyToText) {
      const separator = document.createElement('span');
      separator.className = 'kickflow-message__reply-separator';
      separator.textContent = ': ';
      text.appendChild(separator);
    }
  }
  if (context.replyToText) {
    const snippet = document.createElement('span');
    snippet.className = 'kickflow-message__reply-snippet';
    snippet.textContent = context.replyToText;
    snippet.title = context.replyToText;
    text.appendChild(snippet);
  }
  const label = document.createElement('span');
  label.className = 'kickflow-message__reply-label';
  label.textContent = ' isimli kullanıcıya yanıt veriyor';
  text.appendChild(label);
  reply.appendChild(text);
  row.appendChild(reply);
}

export function buildMessageElement(message: ChatMessage): HTMLElement {
  const row = document.createElement('div');
  row.className = MESSAGE_CLASS;
  row.dataset.messageId = message.id;
  appendReplyContext(row, message);

  const time = document.createElement('span');
  time.className = 'kickflow-message__time';
  const createdAt = new Date(message.createdAt);
  time.textContent = Number.isNaN(createdAt.getTime())
    ? ''
    : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const badges = document.createElement('span');
  badges.className = 'kickflow-message__badges';
  appendBadges(badges, mergeIdentityBadges(message.sender.identity));

  const displayName = message.sender.displayName || message.sender.username;
  // Deliberately NOT an <a href="kick.com/{slug}">: our list is a body-level overlay inside Kick's
  // React SPA, whose document/window click router would classify a same-origin anchor and navigate
  // the page (the "refresh at top" bug) — and a capture-phase router fires before any handler we
  // could add. A plain <span role="link"> has no href for the router to see, so we own every
  // gesture: left-click → our card, middle/ctrl/shift/meta → new tab, Enter/Space → our card.
  const username = document.createElement('span');
  username.className = 'kickflow-message__username';
  username.textContent = displayName;
  wireUsernameProfileLink(username, message.sender, displayName, 'kickflow-message__username--link');
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
