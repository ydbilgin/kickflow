import { mergeIdentityBadges, type ChatBadge, type ChatMessage, type ChatMessageSender, type PreservedMeta, type SubscriberBadge } from './message-store';
import { isSafeKickSlug, openUserCard } from './user-card';
import { ROLE_BADGE_ASSETS, ROLE_BADGE_FALLBACK_LABELS } from './badge-assets';
import { openInNewTab } from '../shared/new-tab';
import { formatNumber, t, type MessageKey } from '../shared/i18n';

export const MESSAGE_CLASS = 'kickflow-message';
export const PRESERVED_CLASS = 'kickflow-preserved';
export const BANNED_CLASS = 'kickflow-banned';
export const TIMEOUT_CLASS = 'kickflow-timeout';
export const DELETED_CLASS = 'kickflow-deleted';
export const EVENT_ROW_CLASS = 'kickflow-event-row';

// Bulk gifts name at most this many recipients inline (a Kick bulk can be 50+; three ~25-char
// usernames is about one wrapped line at the panel's 13px width). The rest collapse into
// a localized "and N more", with every known name still reachable on the preview's hover title.
export const GIFT_RECIPIENTS_SHOWN_MAX = 3;

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
  img.title = name;
  img.className = 'kickflow-emote';
  img.loading = 'lazy';
  const box = document.createElement('span');
  box.className = 'kickflow-emote-box';
  box.appendChild(img);
  parent.appendChild(box);
}

// Long URLs have no spaces, so the chat panel's `overflow-wrap: anywhere` (needed to keep any
// long unbroken token from overflowing the narrow column) breaks them at an arbitrary character —
// e.g. "https://x.com/..." mid-domain as "x." / "com", which reads as two broken links instead of
// one long one. <wbr> after every '/' gives the browser a preferred break point at path-segment
// boundaries, so wrapping (when the line is too narrow) lands somewhere legible instead.
function appendUrlTextWithBreakHints(parent: HTMLElement, url: string): void {
  const segments = url.split(/(?<=\/)/);
  segments.forEach((segment, index) => {
    parent.appendChild(document.createTextNode(segment));
    if (index < segments.length - 1) parent.appendChild(document.createElement('wbr'));
  });
}

function appendLink(parent: HTMLElement, rawUrl: string): void {
  const url = isAllowedLinkUrl(rawUrl);
  if (!url) {
    parent.appendChild(document.createTextNode(rawUrl));
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url.href;
  appendUrlTextWithBreakHints(anchor, rawUrl);
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
    openInNewTab(url.href);
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
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) {
      openInNewTab(profileUrl);
    } else {
      void openUserCard(slug, displayName, event.clientX, event.clientY);
    }
  };
  element.addEventListener('click', (event) => { if (event.button === 0) act(event); });
  element.addEventListener('auxclick', (event) => { if (event.button === 1) act(event); });
  // Middle-press default action is Chrome's autoscroll pan. Unlike a real <a href> (where the
  // browser suppresses autoscroll and opens a tab), this is a role=link span, and inside a
  // scrollable ancestor (our chat list, Kick's page) autoscroll SWALLOWS the whole gesture —
  // `auxclick` never fires and middle-click can't open the profile (live-repro'd 2026-07-10 in
  // headed Chromium with the popup blocker on). Preventing the default only for button 1 keeps
  // left-click, drag-select and real scrolling untouched.
  element.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
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
  wireProfileSlugLink(username, sender.slug, displayName, linkClass);
}

function groupMessageIdentity(badges: HTMLElement, username: HTMLElement): HTMLSpanElement {
  const identity = document.createElement('span');
  identity.className = 'kickflow-message__identity';
  identity.append(badges, username);
  return identity;
}

function createMessageSeparator(): HTMLSpanElement {
  const separator = document.createElement('span');
  separator.className = 'kickflow-message__separator';
  separator.textContent = ':\u00a0';
  separator.setAttribute('aria-hidden', 'true');
  return separator;
}

/** Safe-render only: message text is fully attacker-controlled. Every branch below
 * builds nodes via createElement/textContent — never innerHTML or string concatenation.
 *
 * `opts.compact` renders for the ellipsized reply snippet: emotes still render as images
 * (so a reply to an emote-only message isn't blank), but urls/mentions collapse to plain
 * text — no `<a>`, no profile-card wiring — since a one-line truncated preview has no room
 * for another layer of interactive/focusable elements. */
export function appendParsedContent(parent: HTMLElement, content: string, opts?: { compact?: boolean }): void {
  const compact = opts?.compact ?? false;
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
      if (compact) {
        parent.appendChild(document.createTextNode(groups.url));
      } else {
        appendLink(parent, groups.url);
      }
    } else if (groups.mention) {
      if (compact) {
        const span = document.createElement('span');
        span.className = 'kickflow-mention';
        span.textContent = groups.mention;
        parent.appendChild(span);
      } else {
        appendMention(parent, groups.mention);
      }
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) {
    parent.appendChild(document.createTextNode(content.slice(lastIndex)));
  }
}

// Same emote subpattern as CONTENT_TOKEN_RE, kept standalone: a tooltip title has no need for
// the url/mention alternation, and content outside emote tokens is already plain text.
const EMOTE_TOKEN_ONLY_RE = /\[emote:\d{1,10}:(.{1,30})\]/g;

/** Tooltip-only text: emote tokens collapse to their bare name (`[emote:5405749:sreactayak]`
 * → `sreactayak`); urls/mentions are left as-is since they're already readable raw text. */
function contentToPlainText(content: string): string {
  return content.replace(EMOTE_TOKEN_ONLY_RE, '$1');
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
        const title = badge.level != null ? t('badge.level', { n: badge.level }) : (badge.name || badge.text || t('badge.badge'));
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
      const label = roleBadgeLabel(badge.type, asset.label);
      img.alt = label;
      img.title = label;
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
        const title = badge.count ? t('badge.subscriber_months', { n: badge.count }) : t('badge.subscriber');
        img.alt = title;
        img.title = title;
        img.className = 'kickflow-badge-icon';
        img.loading = 'lazy';
        parent.appendChild(img);
      } else {
        appendRoleBadge(parent, t('badge.subscriber'), SUBSCRIBER_FALLBACK_STYLE, badge.count);
      }
      continue;
    }

    // 4. Labelled chip fallback (no captured asset for this role type).
    const fallbackStyle = badge.type ? ROLE_BADGE_FALLBACK_STYLES[badge.type] : undefined;
    if (fallbackStyle) {
      const label = roleBadgeLabel(badge.type, (badge.type && ROLE_BADGE_FALLBACK_LABELS[badge.type]) || badge.type || '');
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

function roleBadgeLabel(type: string | undefined, fallback: string): string {
  const keys: Record<string, MessageKey> = {
    moderator: 'badge.moderator',
    vip: 'badge.vip',
    og: 'badge.og',
    sub_gifter: 'badge.gift_subscriber',
    verified: 'badge.verified_streamer',
    staff: 'badge.kick_staff',
    broadcaster: 'badge.broadcaster',
    founder: 'badge.founder',
    sidekick: 'badge.sidekick',
    bot: 'badge.bot',
    trainwreckstv: 'badge.trainwreckstv',
  };
  return type && keys[type] ? t(keys[type]) : fallback;
}

export function appendStatusLabel(row: HTMLElement, text: string, modifier: string): void {
  const label = document.createElement('span');
  label.className = `kickflow-status-label kickflow-status-label--${modifier}`;
  label.textContent = text;
  row.appendChild(label);
}

/** Compact localized duration from minutes. Empty when unknown. */
export function formatTimeoutDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '';
  if (min < 60) return t('duration.minutes_short', { n: Math.round(min) });
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? t('duration.hours_minutes_short', { h, m }) : t('duration.hours_short', { n: h });
  }
  return t('duration.days_short', { n: Math.round(min / (60 * 24)) });
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
  if (!message.preserved) return;
  // A later moderation event can enrich metadata or upgrade a single-message delete to a
  // user ban. Reconcile the existing annotation instead of treating PRESERVED_CLASS as proof
  // that the row is current; otherwise Mode A can remain labelled "silindi" after the ban.
  clearPreservedMarking(row);
  row.classList.add(PRESERVED_CLASS);
  const meta = message.preservedMeta ?? {};

  if (message.preservedReason === 'banned') {
    // Kick's ban events carry `permanent`: false = timeout (with a duration), true/absent = a
    // permanent ban. "banlandı" is reserved for permanent bans; timeouts show their length.
    if (meta.permanent === false) {
      row.classList.add(TIMEOUT_CLASS);
      const dur = formatTimeoutDuration(meta.durationMin);
      appendStatusLabel(row, dur ? `${t('message.timeout')} ${dur}` : t('message.timeout'), 'timeout');
      appendModLabel(row, meta.bannedBy);
    } else {
      row.classList.add(BANNED_CLASS);
      appendStatusLabel(row, t('message.banned'), 'banned');
      appendModLabel(row, meta.bannedBy);
    }
  } else if (message.preservedReason === 'deleted') {
    row.classList.add(DELETED_CLASS);
    appendStatusLabel(row, t('message.deleted'), 'deleted');
    appendModLabel(row, deleteAttribution(meta));
  }
}

/** Removes only KickFlow's preservation annotation, leaving the original safe-rendered row
 * intact. Used when a retained Mode-A message reaches the preservation TTL/cap. */
export function clearPreservedMarking(row: HTMLElement): void {
  row.classList.remove(PRESERVED_CLASS, BANNED_CLASS, TIMEOUT_CLASS, DELETED_CLASS);
  row.querySelectorAll('.kickflow-status-label, .kickflow-mod-label').forEach((node) => node.remove());
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
    // Compact mode: same safe-render path as the main content, minus the interactive layer
    // (see appendParsedContent's compact doc) — an emote-bearing reply still shows its emote.
    appendParsedContent(snippet, context.replyToText, { compact: true });
    text.appendChild(snippet);
  }
  reply.appendChild(text);
  // One hover tooltip for the whole reply row: the full "user: message" of what's being
  // replied to. The visible line is ellipsized (user capped at 38%, snippet clipped), so the
  // tooltip is where the complete replied-to message is actually readable — more useful than
  // a redundant "…is replying to this user" phrase (the ↩ icon already conveys "reply").
  // No child carries its own title, so hovering anywhere on the row shows this same string.
  const replyPlain = context.replyToText ? contentToPlainText(context.replyToText) : '';
  reply.title =
    context.replyToUser && replyPlain ? `${context.replyToUser}: ${replyPlain}`
    : replyPlain || context.replyToUser || '';
  row.appendChild(reply);
}

/** Safe-render only: username and counts originate in public Pusher payloads and are assigned via
 * textContent. Fixed connecting words are separate text nodes; no event value becomes markup. */
function buildSystemEventElement(message: ChatMessage): HTMLElement {
  const event = message.systemEvent;
  if (!event) throw new Error('buildSystemEventElement requires a system event');

  const row = document.createElement('div');
  row.className = `${MESSAGE_CLASS} ${EVENT_ROW_CLASS} ${EVENT_ROW_CLASS}--${event.kind}`;
  row.dataset.messageId = message.id;

  const icon = document.createElement('span');
  icon.className = `${EVENT_ROW_CLASS}__icon`;
  icon.textContent = event.kind === 'subscription'
    ? '⭐'
    : event.kind === 'gifted-subscription'
      ? '🎁'
      : event.kind === 'kicks'
        ? '💰'
        : event.kind === 'host'
          ? '📡'
          : '⚙';

  if (event.kind === 'mode') {
    const text = document.createElement('span');
    text.className = `${EVENT_ROW_CLASS}__text`;
    text.textContent = event.text;
    row.append(icon, text);
    return row;
  }

  const username = document.createElement('span');
  username.className = `${EVENT_ROW_CLASS}__username`;
  username.textContent = event.username;

  // Flex-item boundaries collapse adjacent whitespace (CSS Flexbox ยง4), so bare text
  // nodes can't sit directly between elements here — everything but the icon goes in
  // one non-flex text container where normal inline whitespace rules apply.
  const body = document.createElement('span');
  body.className = `${EVENT_ROW_CLASS}__body`;
  body.appendChild(username);

  const appendCountTemplate = (key: MessageKey, value: number, formatted = String(value)): HTMLElement | null => {
    const localized = t(key, { n: value });
    const raw = String(value);
    const splitAt = localized.indexOf(raw);
    body.appendChild(document.createTextNode(' '));
    if (splitAt < 0) {
      body.appendChild(document.createTextNode(localized));
      return null;
    }
    body.appendChild(document.createTextNode(localized.slice(0, splitAt)));
    const count = document.createElement('span');
    count.className = `${EVENT_ROW_CLASS}__count`;
    count.textContent = formatted;
    body.append(count, document.createTextNode(localized.slice(splitAt + raw.length)));
    return count;
  };

  if (event.kind === 'subscription') {
    if (event.months === 1) {
      body.appendChild(document.createTextNode(` ${t('event.subscription.new')}`));
    } else {
      appendCountTemplate('event.subscription.months', event.months);
    }
  } else if (event.kind === 'gifted-subscription') {
    // Recipient usernames are attacker-controlled → textContent only, same as every name here.
    // `?? []` guards a malformed producer at runtime; the empty branch keeps the count-only row.
    const recipients = event.giftedUsernames ?? [];
    if (event.giftCount === 1 && recipients.length === 1) {
      // Single gift: name the recipient. The dative suffix is attached to the common noun
      // ("kullanıcısına"), never to the username itself — arbitrary usernames (digits, no
      // vowels, emoji) make proper Turkish vowel-harmony unsolvable, and a wrong suffix reads
      // worse than the neutral construction.
      const localized = t('event.gift.single', { name: recipients[0] });
      const splitAt = localized.indexOf(recipients[0]);
      body.appendChild(document.createTextNode(localized.slice(0, splitAt)));
      const recipient = document.createElement('span');
      recipient.className = `${EVENT_ROW_CLASS}__recipient`;
      recipient.textContent = recipients[0];
      body.append(recipient, document.createTextNode(localized.slice(splitAt + recipients[0].length)));
    } else {
      // Kick's gifted_total is authoritative, but the headline must never contradict the
      // visible names — if the array is somehow longer, the larger number wins, and the
      // "ve N kişi daha" remainder is derived from the same headline so the row always adds up.
      const effectiveTotal = Math.max(event.giftCount, recipients.length);
      appendCountTemplate('event.gift.bulk', effectiveTotal);
      if (recipients.length > 0) {
        const preview = document.createElement('span');
        preview.className = `${EVENT_ROW_CLASS}__recipients`;
        // Every recipient name is attacker-controlled → textContent only (same discipline as
        // the rest of this file). Returns the span so both the initial render and the
        // click-to-expand path build names identically.
        const makeRecipient = (name: string): HTMLSpanElement => {
          const recipient = document.createElement('span');
          recipient.className = `${EVENT_ROW_CLASS}__recipient`;
          recipient.textContent = name;
          return recipient;
        };

        const shown = recipients.slice(0, GIFT_RECIPIENTS_SHOWN_MAX);
        shown.forEach((name, index) => {
          if (index > 0) preview.appendChild(document.createTextNode(', '));
          preview.appendChild(makeRecipient(name));
        });

        const hiddenKnown = recipients.slice(shown.length);
        // Kick's count can exceed the number of names it actually sent us; those extra
        // recipients are unnameable and stay as a plain trailing count.
        const unknownRemainder = Math.max(0, effectiveTotal - recipients.length);

        if (hiddenKnown.length > 0) {
          // "ve N kişi daha" is a VISIBLE, click/Enter-activatable affordance that expands the
          // remaining KNOWN names in place — unlike a hover title it works on touch and signals
          // itself to a passing reader (owner's real goal: be ABLE to see who got them). A plain
          // <span role=button> with our own gesture handler is the overlay's SPA-safe pattern:
          // no href for Kick's client-side click router to hijack. One-shot expansion.
          const more = document.createElement('span');
          more.className = `${EVENT_ROW_CLASS}__more`;
          more.setAttribute('role', 'button');
          more.setAttribute('tabindex', '0');
          more.textContent = t('event.gift.more', { n: effectiveTotal - shown.length });
          const expand = (): void => {
            for (const name of hiddenKnown) {
              preview.insertBefore(document.createTextNode(', '), more);
              preview.insertBefore(makeRecipient(name), more);
            }
            if (unknownRemainder > 0) {
              // Some recipients remain unnameable — collapse the trigger to an honest static count.
              more.removeAttribute('role');
              more.removeAttribute('tabindex');
              more.className = '';
              more.textContent = t('event.gift.more', { n: unknownRemainder });
            } else {
              more.remove();
            }
          };
          more.addEventListener('click', expand);
          more.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              expand();
            }
          });
          preview.appendChild(more);
        } else if (unknownRemainder > 0) {
          // All known names already shown, but the count is higher — nothing to expand.
          preview.appendChild(document.createTextNode(t('event.gift.more', { n: unknownRemainder })));
        }

        body.append(document.createTextNode(': '), preview);
      }
    }
  } else if (event.kind === 'kicks') {
    const count = appendCountTemplate('event.kicks', event.amount, formatNumber(event.amount));
    // Keep the precise integer available to screen readers / hover even when Intl groups it.
    if (count) count.title = String(event.amount);
    // gift.name and the sender's message are attacker-controlled → same safe emote/link/mention
    // path as ordinary chat content (appendParsedContent), never innerHTML.
    if (event.giftName) {
      const gift = document.createElement('span');
      gift.className = `${EVENT_ROW_CLASS}__gift`;
      appendParsedContent(gift, event.giftName);
      body.append(document.createTextNode(' · '), gift);
    }
    if (event.senderMessage) {
      const note = document.createElement('span');
      note.className = `${EVENT_ROW_CLASS}__note`;
      appendParsedContent(note, event.senderMessage);
      body.append(document.createTextNode(' — '), note);
    }
  } else if (event.numberViewers > 0) {
    appendCountTemplate('event.host.viewers', event.numberViewers, formatNumber(event.numberViewers));
  } else {
    body.appendChild(document.createTextNode(` ${t('event.host')}`));
  }

  row.append(icon, body);
  return row;
}

/** Kick's `type: celebration` renewal is a message card, not an ordinary chat line. Keep the
 * sender-authored content on the standard safe parser while giving the renewal its native-like
 * headline and identity line. */
function buildCelebrationElement(message: ChatMessage): HTMLElement {
  const celebration = message.celebration;
  if (!celebration) throw new Error('buildCelebrationElement requires celebration metadata');

  const row = document.createElement('div');
  row.className = `${MESSAGE_CLASS} ${EVENT_ROW_CLASS} ${EVENT_ROW_CLASS}--celebration`;
  row.dataset.messageId = message.id;

  const icon = document.createElement('span');
  icon.className = `${EVENT_ROW_CLASS}__icon`;
  icon.textContent = '⭐';

  const body = document.createElement('span');
  body.className = `${EVENT_ROW_CLASS}__body`;

  const headline = document.createElement('span');
  headline.className = 'kickflow-celebration__headline';
  const headlineUsername = document.createElement('span');
  headlineUsername.className = `${EVENT_ROW_CLASS}__username`;
  const displayName = message.sender.displayName || message.sender.username;
  headlineUsername.textContent = displayName;
  wireUsernameProfileLink(headlineUsername, message.sender, displayName, 'kickflow-message__username--link');
  headlineUsername.style.color = message.sender.identity.color || 'inherit';
  headline.appendChild(headlineUsername);

  const localized = t('event.celebration.months', { n: celebration.totalMonths });
  const rawCount = String(celebration.totalMonths);
  const countIndex = localized.indexOf(rawCount);
  headline.appendChild(document.createTextNode(' '));
  if (countIndex < 0) {
    headline.appendChild(document.createTextNode(localized));
  } else {
    headline.appendChild(document.createTextNode(localized.slice(0, countIndex)));
    const count = document.createElement('span');
    count.className = `${EVENT_ROW_CLASS}__count`;
    count.textContent = rawCount;
    headline.append(count, document.createTextNode(localized.slice(countIndex + rawCount.length)));
  }

  const messageLine = document.createElement('span');
  messageLine.className = 'kickflow-celebration__message';
  const badges = document.createElement('span');
  badges.className = 'kickflow-message__badges';
  appendBadges(badges, mergeIdentityBadges(message.sender.identity));
  const author = document.createElement('span');
  author.className = 'kickflow-celebration__author';
  author.textContent = displayName;
  wireUsernameProfileLink(author, message.sender, displayName, 'kickflow-message__username--link');
  author.style.color = message.sender.identity.color || 'inherit';
  const content = document.createElement('span');
  content.className = 'kickflow-message__content';
  appendParsedContent(content, message.content);
  messageLine.append(groupMessageIdentity(badges, author), createMessageSeparator(), content);

  body.append(headline, messageLine);
  row.append(icon, body);
  applyPreservedMarking(row, message);
  return row;
}

export function buildMessageElement(message: ChatMessage): HTMLElement {
  if (message.systemEvent) return buildSystemEventElement(message);
  if (message.celebration?.type === 'subscription_renewed') return buildCelebrationElement(message);

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

  const separator = createMessageSeparator();

  const content = document.createElement('span');
  content.className = 'kickflow-message__content';
  appendParsedContent(content, message.content);

  row.append(time, groupMessageIdentity(badges, username), separator, content);
  applyPreservedMarking(row, message);

  return row;
}
