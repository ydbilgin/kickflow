import { appendBadges } from './message-view';
import { mergeIdentityBadges } from './message-store';
import { featureFlags } from './feature-flags';
import { UserMessageArchive } from './user-message-archive';
import { buildUserMessageList, scrollUserMessageListToLatest, type UserMessageListModel } from './user-message-list';
import { makeDraggable } from '../shared/draggable';
import { openInNewTab, wireNewTabGestures } from '../shared/new-tab';
import type { ChatBadge } from './message-store';
import { formatNumber, getLang, t } from '../shared/i18n';

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const TRUSTED_IMAGE_HOST = 'kick.com';
const TRUSTED_IMAGE_HOST_SUFFIX = '.kick.com';
const CARD_CLASS = 'kickflow-user-card';
const FIELD_CLASS = 'kickflow-user-card__field';

interface UserCardRawBadge {
  type?: unknown;
  name?: unknown;
  badge_type?: unknown;
  text?: unknown;
  count?: unknown;
  image_url?: unknown;
  imageUrl?: unknown;
  metadata?: unknown;
  active?: unknown;
  selected?: unknown;
  sort_order?: unknown;
}

export interface KickUserCardResponse {
  id?: unknown;
  username?: unknown;
  slug?: unknown;
  profile_pic?: unknown;
  is_staff?: unknown;
  is_channel_owner?: unknown;
  is_moderator?: unknown;
  badges?: unknown;
  badges_v2?: unknown;
  following_since?: unknown;
  created_at?: unknown;
  subscribed_for?: unknown;
  banned?: unknown;
}

/** The user's own channel — richer profile fields (avatar, bio, followers) the card endpoint lacks. */
export interface KickChannelResponse {
  followers_count?: unknown;
  verified?: unknown;
  user?: unknown;
}

export interface UserCardViewModel {
  userId: number | null;
  messages: UserMessageListModel | null;
  username: string;
  slug: string;
  profilePic: string | null;
  role: string | null;
  verified: boolean;
  bio: string | null;
  followers: string | null;
  createdAt: string;
  followingSince: string;
  subscribedFor: string;
  badges: ChatBadge[];
}

let channelSlug: string | null = null;
const cache = new Map<string, Promise<UserCardViewModel | null>>();
let activeCard: HTMLElement | null = null;
let userMessageArchive: UserMessageArchive | null = null;

export function configureUserMessageArchive(archive: UserMessageArchive | null): void {
  userMessageArchive = archive;
}

export function configureUserCardSession(slug: string | null): void {
  channelSlug = slug && SAFE_SLUG_RE.test(slug) ? slug : null;
  if (slug === null) userMessageArchive = null;
  cache.clear();
  dismissUserCard();
}

export function isSafeKickSlug(slug: string): boolean {
  return SAFE_SLUG_RE.test(slug);
}

function trustedProfileImageUrl(value: string): URL | null {
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

function normalizeBadge(raw: UserCardRawBadge): ChatBadge {
  const metadata = raw.metadata && typeof raw.metadata === 'object'
    ? raw.metadata as Record<string, unknown>
    : null;
  return {
    type: typeof raw.type === 'string' ? raw.type : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    count: typeof raw.count === 'number' ? raw.count : undefined,
    imageUrl: typeof raw.image_url === 'string'
      ? raw.image_url
      : typeof raw.imageUrl === 'string'
        ? raw.imageUrl
        : undefined,
    level: metadata && typeof metadata.level === 'number' ? metadata.level : undefined,
    active: typeof raw.active === 'boolean' ? raw.active : undefined,
    selected: typeof raw.selected === 'boolean' ? raw.selected : undefined,
    sortOrder: typeof raw.sort_order === 'number' ? raw.sort_order : undefined,
  };
}

function normalizeBadges(raw: unknown): ChatBadge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((badge): badge is UserCardRawBadge => Boolean(badge) && typeof badge === 'object')
    .map(normalizeBadge);
}

function formatDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatFollowers(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return formatNumber(value);
}

function roleFrom(raw: KickUserCardResponse): string | null {
  if (raw.is_channel_owner === true) return 'owner';
  if (raw.is_staff === true) return 'staff';
  if (raw.is_moderator === true) return 'mod';
  return null;
}

function readChannel(raw: KickChannelResponse): { profilePic: string | null; bio: string | null } {
  const user = raw && typeof raw.user === 'object' && raw.user
    ? (raw.user as { profile_pic?: unknown; bio?: unknown })
    : null;
  const profilePic = user && typeof user.profile_pic === 'string' && user.profile_pic ? user.profile_pic : null;
  const bio = user && typeof user.bio === 'string' && user.bio.trim() ? user.bio.trim() : null;
  return { profilePic, bio };
}

export function mapUserCardResponse(
  card: KickUserCardResponse,
  channel: KickChannelResponse,
  fallbackName: string,
  fallbackSlug: string,
): UserCardViewModel {
  const slug = typeof card.slug === 'string' && SAFE_SLUG_RE.test(card.slug) ? card.slug : fallbackSlug;
  const username = typeof card.username === 'string' && card.username ? card.username : fallbackName;
  const subscribedFor = typeof card.subscribed_for === 'number' && card.subscribed_for > 0
    ? t('user.subscribed_months', { n: card.subscribed_for })
    : t('user.not_subscribed');
  const badges = mergeIdentityBadges({
    badges: normalizeBadges(card.badges),
    badgesV2: normalizeBadges(card.badges_v2),
  });
  const { profilePic: channelPic, bio } = readChannel(channel);
  const cardPic = typeof card.profile_pic === 'string' && card.profile_pic ? card.profile_pic : null;
  return {
    userId: null,
    messages: null,
    username,
    slug,
    profilePic: cardPic ?? channelPic,
    role: roleFrom(card),
    verified: Boolean(channel?.verified),
    bio,
    followers: formatFollowers(channel?.followers_count),
    createdAt: formatDate(card.created_at) ?? '-',
    followingSince: formatDate(card.following_since) ?? t('user.not_following'),
    subscribedFor,
    badges,
  };
}

async function fetchUserCard(username: string, fallbackName: string): Promise<UserCardViewModel | null> {
  if (!channelSlug || !SAFE_SLUG_RE.test(username)) return null;
  const cached = cache.get(username);
  if (cached) return cached;

  const getJson = (url: string): Promise<unknown> =>
    fetch(url, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);

  // Card endpoint = this-channel relationship (following/subscribed/badges); channel endpoint =
  // the user's own profile (avatar, bio, follower count, verified). Fetch both in parallel + merge.
  const promise = Promise.all([
    getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}/users/${encodeURIComponent(username)}`),
    getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(username)}`),
  ]).then(([cardRaw, channelRaw]) => {
    if (!cardRaw && !channelRaw) return null;
    return mapUserCardResponse(
      (cardRaw ?? {}) as KickUserCardResponse,
      (channelRaw ?? {}) as KickChannelResponse,
      fallbackName,
      username,
    );
  });
  cache.set(username, promise);
  // Don't retain a null result for the whole session — a transient API/Cloudflare failure would
  // otherwise pin this user to a minimal card until the channel switches. Drop it so a later click retries.
  void promise.then((model) => {
    if (!model && cache.get(username) === promise) cache.delete(username);
  });
  return promise;
}

/** One cell of the profile-facts grid. These four facts are metadata, not the payload: stacked as
 * full-width label/value rows they took as much height as the messages themselves, so they are laid
 * out two-up with the label above its value. */
function appendField(parent: HTMLElement, label: string, value: string): void {
  const cell = document.createElement('div');
  cell.className = FIELD_CLASS;
  const key = document.createElement('span');
  key.className = 'kickflow-user-card__key';
  key.textContent = label;
  const val = document.createElement('span');
  val.className = 'kickflow-user-card__value';
  val.textContent = value;
  val.title = value;
  cell.append(key, val);
  parent.appendChild(cell);
}

function buildFieldGrid(): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'kickflow-user-card__facts';
  return grid;
}

export function buildUserCardElement(model: UserCardViewModel): HTMLElement {
  const card = document.createElement('section');
  card.className = CARD_CLASS;
  card.tabIndex = -1;

  // Persistent card: an explicit close button — the owner dismisses it when they want.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'kickflow-user-card__close';
  close.textContent = '×';
  close.setAttribute('aria-label', t('user.close'));
  close.addEventListener('click', () => dismissUserCard());
  card.appendChild(close);

  const header = document.createElement('div');
  header.className = 'kickflow-user-card__header';
  const profilePic = model.profilePic ? trustedProfileImageUrl(model.profilePic) : null;
  if (profilePic) {
    const img = document.createElement('img');
    img.className = 'kickflow-user-card__avatar';
    img.src = profilePic.href;
    img.alt = '';
    img.loading = 'lazy';
    header.appendChild(img);
  }

  const title = document.createElement('div');
  title.className = 'kickflow-user-card__title';
  const nameRow = document.createElement('div');
  nameRow.className = 'kickflow-user-card__nameRow';
  const name = document.createElement('strong');
  name.className = 'kickflow-user-card__name';
  name.textContent = model.username;
  // Middle/ctrl-click on the card's own title opens the profile in a new tab (owner ask,
  // 2026-07-10). Plain left-click stays free: the header doubles as the drag handle.
  if (SAFE_SLUG_RE.test(model.slug)) {
    name.title = t('user.open_middle', { slug: model.slug });
    wireNewTabGestures(name, `https://kick.com/${model.slug}`);
  }
  nameRow.appendChild(name);
  if (model.verified) {
    const verified = document.createElement('span');
    verified.className = 'kickflow-user-card__verified';
    verified.textContent = '✔';
    verified.title = t('user.verified');
    nameRow.appendChild(verified);
  }
  title.appendChild(nameRow);
  if (model.role) {
    const role = document.createElement('span');
    role.className = 'kickflow-user-card__role';
    role.textContent = model.role;
    title.appendChild(role);
  }
  header.appendChild(title);
  card.appendChild(header);
  makeDraggable(card, header, '.kickflow-user-card__close, a');

  if (model.bio) {
    const bio = document.createElement('div');
    bio.className = 'kickflow-user-card__bio';
    bio.textContent = model.bio;
    card.appendChild(bio);
  }

  const facts = buildFieldGrid();
  if (model.followers) appendField(facts, t('user.followers'), model.followers);
  appendField(facts, t('user.created'), model.createdAt);
  appendField(facts, t('user.following'), model.followingSince);
  appendField(facts, t('user.subscription'), model.subscribedFor);
  card.appendChild(facts);

  if (model.badges.length > 0) {
    const badges = document.createElement('div');
    badges.className = 'kickflow-user-card__badges';
    appendBadges(badges, model.badges);
    card.appendChild(badges);
  }

  if (featureFlags.showUserMessages && model.messages) {
    card.appendChild(buildUserMessageList(model.messages));
  }

  const link = document.createElement('a');
  link.className = 'kickflow-user-card__link';
  link.href = `https://kick.com/${model.slug}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `kick.com/${model.slug} → ${t('user.open')}`;
  // Same-origin link inside our overlay — open it ourselves so a plain left-click can't bubble to
  // Kick's SPA router and navigate the current page instead of opening the profile in a new tab.
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openInNewTab(link.href);
  });
  card.appendChild(link);
  return card;
}

/** The archive is local data that needs no network, so the minimal card carries it too: it is the
 * card the owner gets when Kick's profile endpoint fails or is rate-limited, which is exactly when
 * hiding the one section that still works would be worst. */
function buildMinimalCard(
  displayName: string,
  slug: string,
  messages: UserMessageListModel | null,
): HTMLElement {
  const card = buildUserCardElement({
    userId: null,
    messages,
    username: displayName,
    slug: SAFE_SLUG_RE.test(slug) ? slug : displayName,
    profilePic: null,
    role: null,
    verified: false,
    bio: null,
    followers: null,
    createdAt: '-',
    followingSince: t('user.not_following'),
    subscribedFor: t('user.not_subscribed'),
    badges: [],
  });
  return card;
}

export const CARD_VIEWPORT_MARGIN_PX = 8;
export const CARD_ANCHOR_GAP_PX = 8;
/** Total vertical space the card leaves free, used as `max-height: calc(100vh - Npx)`. Declared as
 * its own constant rather than an inline `${A * 2}` expression because the visual harnesses replace
 * CSS placeholders by identifier — an expression would survive as literal text and void the rule. */
export const CARD_MAX_HEIGHT_INSET_PX = CARD_VIEWPORT_MARGIN_PX * 2;

export interface CardPlacementInput {
  anchorX: number;
  anchorY: number;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** Pure placement maths, kept separate from the DOM so the "never leaves the viewport" guarantee is
 * assertable instead of eyeballed. The old version subtracted hard-coded 284/260 constants, which
 * silently stopped being the card's real size the moment the message list made its height variable
 * — that is how the card ended up hanging off the bottom of the screen. */
export function resolveCardPlacement(input: CardPlacementInput): { left: number; top: number } {
  const m = CARD_VIEWPORT_MARGIN_PX;
  const gap = CARD_ANCHOR_GAP_PX;
  const maxLeft = Math.max(m, input.viewportWidth - input.cardWidth - m);
  const left = Math.min(Math.max(input.anchorX + gap, m), maxLeft);

  const below = input.anchorY + gap;
  const above = input.anchorY - gap - input.cardHeight;
  let top: number;
  if (below + input.cardHeight + m <= input.viewportHeight) {
    top = below;
  } else if (above >= m) {
    // No room under the cursor, but room over it: flipping beats covering the name that was clicked.
    top = above;
  } else {
    top = Math.max(m, input.viewportHeight - input.cardHeight - m);
  }
  return { left, top };
}

/** Must run while the card is in the document — placement needs its measured size. */
function positionCard(card: HTMLElement, x: number, y: number): void {
  const rect = card.getBoundingClientRect();
  const { left, top } = resolveCardPlacement({
    anchorX: x,
    anchorY: y,
    cardWidth: rect.width,
    cardHeight: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function installDismissHandlers(card: HTMLElement): void {
  // Persistent card: stays open until the owner closes it (× button, Escape, or opening another
  // card). NO scroll / outside-click auto-dismiss — the chat scrolls constantly and would snap it
  // shut the instant it appeared.
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismissUserCard();
  };
  document.addEventListener('keydown', key);
  card.addEventListener('kickflow:dismiss', () => {
    document.removeEventListener('keydown', key);
  }, { once: true });
}

export function dismissUserCard(): void {
  if (!activeCard) return;
  activeCard.dispatchEvent(new Event('kickflow:dismiss'));
  activeCard.remove();
  activeCard = null;
}

function getUserMessageListModel(userId: number | null): UserMessageListModel | null {
  if (!featureFlags.showUserMessages || !userMessageArchive || typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    return null;
  }
  return {
    messages: userMessageArchive.getByUserId(userId),
    truncated: userMessageArchive.truncated,
  };
}

export async function openUserCard(
  username: string,
  displayName: string,
  clientX: number,
  clientY: number,
  userId: number | null,
): Promise<void> {
  dismissUserCard();
  // Built once and reused for both cards: the archive is a live object, so re-querying it after
  // the await could hand the two cards different rows for the same click.
  const messages = getUserMessageListModel(userId);
  const loading = buildMinimalCard(displayName, username, messages);
  document.body.appendChild(loading);
  positionCard(loading, clientX, clientY);
  installDismissHandlers(loading);
  scrollUserMessageListToLatest(loading);
  activeCard = loading;

  const model = await fetchUserCard(username, displayName);
  if (activeCard !== loading) return;
  const next = model
    ? buildUserCardElement({ ...model, userId, messages })
    : buildMinimalCard(displayName, username, messages);
  // The entrance animation belongs to the click, not to the fetch finishing. Replaying it on the
  // swap would read as a second card appearing a fifth of a second after the first.
  next.classList.add('kickflow-user-card--instant');
  loading.dispatchEvent(new Event('kickflow:dismiss'));
  loading.replaceWith(next);
  activeCard = next;
  scrollUserMessageListToLatest(next);
  positionCard(next, clientX, clientY);
  installDismissHandlers(next);
}
