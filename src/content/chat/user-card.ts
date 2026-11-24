import { appendBadges } from './message-view';
import { mergeIdentityBadges } from './message-store';
import { featureFlags } from './feature-flags';
import { getUserMessageArchive } from './archive-session';
import { buildUserMessageList, scrollUserMessageListToLatest, type UserMessageListModel } from './user-message-list';
import { makeDraggable } from '../shared/draggable';
import { createAvatarPreviewAction, dismissAvatarPreview, fullSizeAvatarUrl } from '../shared/avatar-preview';
import { openInNewTab } from '../shared/new-tab';
import type { ChatBadge } from './message-store';
import { formatNumber, getLang, t } from '../shared/i18n';
import { openNativeUserCard, resetNativeUserCardRequest } from './native-user-card';

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const TRUSTED_IMAGE_HOST = 'kick.com';
const TRUSTED_IMAGE_HOST_SUFFIX = '.kick.com';
const CARD_CLASS = 'kickflow-user-card';
const FIELD_CLASS = 'kickflow-user-card__field';
// Kick's current default asset (the old default2.jpeg URL now serves HTML).
const DEFAULT_PROFILE_PIC = 'https://kick.com/img/default-profile-pictures/default-avatar-2.webp';

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
  nativeUsername?: string;
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
let activeOpener: HTMLElement | null = null;
export function configureUserCardSession(slug: string | null): void {
  channelSlug = slug && SAFE_SLUG_RE.test(slug) ? slug : null;
  cache.clear();
  resetNativeUserCardRequest();
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
  const subscribedFor = typeof card.subscribed_for === 'number' && Number.isFinite(card.subscribed_for) && card.subscribed_for >= 0
    ? card.subscribed_for > 0 ? t('user.subscribed_months', { n: card.subscribed_for }) : t('user.not_subscribed')
    : t('user.unknown');
  const badges = mergeIdentityBadges({
    // Native cards retain historical subscriber badges, including active:false.
    // Native chat intentionally hides these; keep this exception local to cards.
    badges: normalizeBadges(card.badges).map(badge => badge.type === 'subscriber' ? { ...badge, active: true } : badge),
    badgesV2: normalizeBadges(card.badges_v2),
  });
  const { profilePic: channelPic, bio } = readChannel(channel);
  const cardPic = typeof card.profile_pic === 'string' && card.profile_pic ? card.profile_pic : null;
  return {
    userId: typeof card.id === 'number' && Number.isSafeInteger(card.id) && card.id > 0 ? card.id : null,
    messages: null,
    username,
    nativeUsername: typeof card.username === 'string' && SAFE_SLUG_RE.test(card.username) ? card.username : undefined,
    slug,
    profilePic: cardPic ?? channelPic,
    role: roleFrom(card),
    verified: Boolean(channel?.verified),
    bio,
    followers: formatFollowers(channel?.followers_count),
    createdAt: formatDate(card.created_at) ?? '-',
    followingSince: formatDate(card.following_since) ?? (card.following_since === null ? t('user.not_following') : t('user.unknown')),
    subscribedFor,
    badges,
  };
}

async function fetchUserCard(username: string, fallbackName: string, nativeUsername: string): Promise<UserCardViewModel | null> {
  if (!channelSlug || !SAFE_SLUG_RE.test(username)) return null;
  const cacheKey = `${username}:${nativeUsername.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const getJson = async (url: string): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  // Card endpoint = this-channel relationship (following/subscribed/badges); channel endpoint =
  // the user's own profile (avatar, bio, follower count, verified). Fetch both in parallel + merge.
  const promise = Promise.all([
    // Kick's relationship endpoint accepts the username, while the profile URL
    // accepts the canonical slug. They can differ (Verssa_99 / verssa-99).
    getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}/users/${encodeURIComponent(
      nativeUsername
    )}`),
    getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(username)}`),
  ]).then(([cardRaw, channelRaw]) => {
    // A partial card is usable for this click, but must not pin unknown facts for the session.
    const relationship = cardRaw as KickUserCardResponse | null;
    const complete = relationship && channelRaw
      && (relationship.following_since === null || formatDate(relationship.following_since) !== null)
      && typeof relationship.subscribed_for === 'number'
      && Number.isFinite(relationship.subscribed_for) && relationship.subscribed_for >= 0;
    if (!complete && cache.get(cacheKey) === promise) cache.delete(cacheKey);
    if (!cardRaw && !channelRaw) return null;
    return mapUserCardResponse(
      (cardRaw ?? {}) as KickUserCardResponse,
      (channelRaw ?? {}) as KickChannelResponse,
      fallbackName,
      username,
    );
  });
  cache.set(cacheKey, promise);
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
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', model.username);

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
  const img = document.createElement('img');
  img.className = 'kickflow-user-card__avatar';
  img.src = profilePic?.href ?? DEFAULT_PROFILE_PIC;
  img.alt = '';
  img.loading = 'lazy';
  const realImage = profilePic && !profilePic.pathname.startsWith('/img/default-profile-pictures/')
    && fullSizeAvatarUrl(profilePic.href) !== null;
  const avatar = realImage ? createAvatarPreviewAction(img, model.username) : img;
  if (profilePic && profilePic.href !== DEFAULT_PROFILE_PIC) {
    img.addEventListener('error', () => {
      if (avatar !== img) avatar.replaceWith(img);
      img.src = DEFAULT_PROFILE_PIC;
    }, { once: true });
  }
  header.appendChild(avatar);

  const title = document.createElement('div');
  title.className = 'kickflow-user-card__title';
  const nameRow = document.createElement('div');
  nameRow.className = 'kickflow-user-card__nameRow';
  const name = document.createElement('strong');
  name.className = 'kickflow-user-card__name';
  name.textContent = model.username;
  // Native card titles open the profile. The remaining header remains the drag handle.
  if (SAFE_SLUG_RE.test(model.slug)) {
    name.setAttribute('role', 'link');
    name.tabIndex = 0;
    name.title = t('user.open_middle', { slug: model.slug });
    name.dataset.kickflowProfileUrl = `https://kick.com/${model.slug}`;
    const openProfile = (event: Event): void => {
      event.preventDefault(); event.stopImmediatePropagation();
      openInNewTab(name.dataset.kickflowProfileUrl!);
    };
    name.addEventListener('auxclick', event => { if (event.button === 1) openProfile(event); });
    name.addEventListener('click', event => {
      if (event.button === 0) openProfile(event);
    });
    name.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openProfile(event); });
    name.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
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
  makeDraggable(card, header, 'button, a, .kickflow-user-card__name');

  // Optional profile data occupies the same slots before and after either request.
  // The local archive and Close target must never move when those slots hydrate.
  const bio = document.createElement('div');
  bio.className = 'kickflow-user-card__bio';
  bio.textContent = model.bio ?? '';
  card.appendChild(bio);

  const facts = buildFieldGrid();
  appendField(facts, t('user.followers'), model.followers ?? t('user.unknown'));
  appendField(facts, t('user.created'), model.createdAt);
  appendField(facts, t('user.following'), model.followingSince);
  appendField(facts, t('user.subscription'), model.subscribedFor);
  card.appendChild(facts);

  const badges = document.createElement('div');
  badges.className = 'kickflow-user-card__badges';
  appendBadges(badges, model.badges);
  card.appendChild(badges);

  const actions = document.createElement('div');
  actions.className = 'kickflow-user-card__actions';
  const follow = document.createElement('a');
  follow.className = 'kickflow-user-card__action';
  follow.dataset.kickflowCardAction = 'follow';
  follow.href = `https://kick.com/${model.slug}`;
  follow.target = '_blank';
  follow.rel = 'noopener noreferrer';
  follow.textContent = t('user.follow_on_kick');
  follow.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); openInNewTab(follow.href);
  });
  const native = document.createElement('button');
  native.type = 'button';
  native.className = 'kickflow-user-card__action';
  native.dataset.kickflowCardAction = 'native';
  native.dataset.kickflowNativeUsername = model.nativeUsername ?? model.slug;
  native.dataset.kickflowNativeProfileSlug = model.slug;
  native.textContent = t('user.kick_controls');
  native.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (openNativeUserCard(native.dataset.kickflowNativeUsername!, native.dataset.kickflowNativeProfileSlug!)) dismissUserCard();
    else openInNewTab(follow.href);
  });
  actions.append(follow, native);
  card.appendChild(actions);

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
  nativeUsername: string,
): HTMLElement {
  const card = buildUserCardElement({
    userId: null,
    messages,
    username: displayName,
    nativeUsername,
    slug: SAFE_SLUG_RE.test(slug) ? slug : displayName,
    profilePic: null,
    role: null,
    verified: false,
    bio: null,
    followers: null,
    createdAt: '-',
    followingSince: t('user.unknown'),
    subscribedFor: t('user.unknown'),
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
  const { left, top } = resolveCardPlacement({
    anchorX: x,
    anchorY: y,
    cardWidth: card.offsetWidth,
    cardHeight: card.offsetHeight,
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
    if (event.key === 'Escape' && !event.defaultPrevented) dismissUserCard();
  };
  document.addEventListener('keydown', key);
  const clamp = () => clampCardToViewport(card);
  window.addEventListener('resize', clamp);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(clamp) : null;
  observer?.observe(card);
  card.addEventListener('kickflow:dismiss', () => {
    document.removeEventListener('keydown', key);
    window.removeEventListener('resize', clamp);
    observer?.disconnect();
  }, { once: true });
}

function clampCardToViewport(card: HTMLElement): void {
  const rect = card.getBoundingClientRect();
  const margin = CARD_VIEWPORT_MARGIN_PX;
  const left = parseFloat(card.style.left) || rect.left;
  const top = parseFloat(card.style.top) || rect.top;
  card.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
  const nextTop = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
  card.style.top = `${nextTop}px`;
  card.style.maxHeight = `${Math.max(0, window.innerHeight - nextTop - margin)}px`;
}

export function dismissUserCard(): void {
  if (!activeCard) return;
  const restoreFocus = activeCard.contains(document.activeElement) && activeOpener?.isConnected;
  dismissAvatarPreview();
  activeCard.dispatchEvent(new Event('kickflow:dismiss'));
  activeCard.remove();
  activeCard = null;
  if (restoreFocus) activeOpener?.focus({ preventScroll: true });
  activeOpener = null;
}

function isUsableUserId(userId: number | null): userId is number {
  return typeof userId === 'number' && Number.isInteger(userId) && userId > 0;
}

function getUserMessageListModel(userId: number | null, names: readonly string[]): UserMessageListModel | null {
  const userMessageArchive = getUserMessageArchive();
  if (!featureFlags.showUserMessages || !userMessageArchive) {
    return null;
  }

  let resolvedUserId = isUsableUserId(userId) ? userId : null;
  if (resolvedUserId === null) {
    for (const name of names) {
      const archivedUserId = userMessageArchive.getUserIdByName(name);
      if (isUsableUserId(archivedUserId)) {
        resolvedUserId = archivedUserId;
        break;
      }
    }
  }
  if (resolvedUserId === null) return null;

  return {
    messages: userMessageArchive.getByUserId(resolvedUserId),
    truncated: userMessageArchive.truncated,
  };
}

export async function openUserCard(
  username: string,
  displayName: string,
  clientX: number,
  clientY: number,
  userId: number | null,
  nativeUsername?: string,
): Promise<void> {
  const opener = activeCard?.contains(document.activeElement) ? activeOpener
    : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dismissUserCard();
  // Built once and reused for both cards: the archive is a live object, so re-querying it after
  // the await could hand the two cards different rows for the same click.
  const messages = getUserMessageListModel(userId, [username, displayName]);
  const lookupName = nativeUsername && SAFE_SLUG_RE.test(nativeUsername) ? nativeUsername : username;
  const loading = buildMinimalCard(displayName, username, messages, lookupName);
  loading.setAttribute('aria-busy', 'true');
  document.body.appendChild(loading);
  positionCard(loading, clientX, clientY);
  installDismissHandlers(loading);
  scrollUserMessageListToLatest(loading);
  activeCard = loading;
  activeOpener = opener;
  loading.focus({ preventScroll: true });

  const model = await fetchUserCard(username, displayName, lookupName);
  if (activeCard !== loading) return;
  loading.setAttribute('aria-busy', 'false');
  if (!model) return;
  const next = buildUserCardElement({ ...model, userId, messages });
  // Hydrate facts in place: root, close button, drag handle, profile link and message rows
  // belong to the user's active pointer gesture. Replacing them swallowed clicks and tore
  // down an in-progress drag whenever either request finished.
  loading.setAttribute('aria-label', model.username);
  const header = loading.querySelector<HTMLElement>('.kickflow-user-card__header')!;
  const name = header.querySelector<HTMLElement>('.kickflow-user-card__name')!;
  name.textContent = model.username;
  name.dataset.kickflowProfileUrl = `https://kick.com/${model.slug}`;
  name.title = t('user.open_middle', { slug: model.slug });
  const profileLink = loading.querySelector<HTMLAnchorElement>('.kickflow-user-card__link');
  if (profileLink) {
    profileLink.href = `https://kick.com/${model.slug}`;
    profileLink.textContent = `kick.com/${model.slug} → ${t('user.open')}`;
  }
  const avatar = next.querySelector('.kickflow-avatar-action, .kickflow-user-card__avatar');
  if (avatar) header.querySelector('.kickflow-avatar-action, .kickflow-user-card__avatar')?.replaceWith(avatar);
  const verified = next.querySelector('.kickflow-user-card__verified');
  if (verified) name.parentElement?.append(verified);
  const role = next.querySelector('.kickflow-user-card__role');
  if (role) header.querySelector('.kickflow-user-card__title')?.append(role);
  const oldFacts = loading.querySelector('.kickflow-user-card__facts')!;
  const bio = next.querySelector('.kickflow-user-card__bio');
  if (bio) loading.querySelector('.kickflow-user-card__bio')?.replaceWith(bio);
  oldFacts.replaceWith(next.querySelector('.kickflow-user-card__facts')!);
  const badges = next.querySelector('.kickflow-user-card__badges');
  if (badges) loading.querySelector('.kickflow-user-card__badges')?.replaceWith(badges);
  const nativeAction = loading.querySelector<HTMLElement>('[data-kickflow-card-action="native"]');
  if (nativeAction) {
    nativeAction.dataset.kickflowNativeUsername = model.nativeUsername ?? lookupName;
    nativeAction.dataset.kickflowNativeProfileSlug = model.slug;
  }
  const followAction = loading.querySelector<HTMLAnchorElement>('[data-kickflow-card-action="follow"]');
  if (followAction) followAction.href = `https://kick.com/${model.slug}`;
  // Growth uses the available space below the original top. Do not flip the card again
  // after its close button is already under the mouse.
  const top = parseFloat(loading.style.top) || CARD_VIEWPORT_MARGIN_PX;
  loading.style.maxHeight = `${Math.max(0, window.innerHeight - top - CARD_VIEWPORT_MARGIN_PX)}px`;
}
