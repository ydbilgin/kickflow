import { featureFlags } from './feature-flags';
import { appendBadges } from './message-view';
import { mergeIdentityBadges } from './message-store';
import type { FeatureFlags } from './feature-flags';
import type { ChatBadge } from './message-store';

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
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

export function configureUserCardSession(slug: string | null): void {
  channelSlug = slug && SAFE_SLUG_RE.test(slug) ? slug : null;
  cache.clear();
  dismissUserCard();
}

export function isSafeKickSlug(slug: string): boolean {
  return SAFE_SLUG_RE.test(slug);
}

export function isMasqueradeEnabled(): boolean {
  const flags = featureFlags as FeatureFlags & {
    masquerade?: boolean;
    masqueradeEnabled?: boolean;
    privacyMode?: boolean;
  };
  return flags.masquerade === true || flags.masqueradeEnabled === true || flags.privacyMode === true;
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
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatFollowers(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return new Intl.NumberFormat('tr-TR').format(value);
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
    ? `${card.subscribed_for} ay abone`
    : 'abone değil';
  const badges = mergeIdentityBadges({
    badges: normalizeBadges(card.badges),
    badgesV2: normalizeBadges(card.badges_v2),
  });
  const { profilePic: channelPic, bio } = readChannel(channel);
  const cardPic = typeof card.profile_pic === 'string' && card.profile_pic ? card.profile_pic : null;
  return {
    username,
    slug,
    profilePic: cardPic ?? channelPic,
    role: roleFrom(card),
    verified: Boolean(channel?.verified),
    bio,
    followers: formatFollowers(channel?.followers_count),
    createdAt: formatDate(card.created_at) ?? '-',
    followingSince: formatDate(card.following_since) ?? 'takip etmiyor',
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

function appendField(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  row.className = FIELD_CLASS;
  const key = document.createElement('span');
  key.className = 'kickflow-user-card__key';
  key.textContent = label;
  const val = document.createElement('span');
  val.className = 'kickflow-user-card__value';
  val.textContent = value;
  row.append(key, val);
  parent.appendChild(row);
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
  close.setAttribute('aria-label', 'kapat');
  close.addEventListener('click', () => dismissUserCard());
  card.appendChild(close);

  const header = document.createElement('div');
  header.className = 'kickflow-user-card__header';
  if (model.profilePic) {
    const img = document.createElement('img');
    img.className = 'kickflow-user-card__avatar';
    img.src = model.profilePic;
    img.alt = '';
    img.loading = 'lazy';
    header.appendChild(img);
  }

  const title = document.createElement('div');
  title.className = 'kickflow-user-card__title';
  const nameRow = document.createElement('div');
  nameRow.className = 'kickflow-user-card__nameRow';
  const name = document.createElement('strong');
  name.textContent = model.username;
  nameRow.appendChild(name);
  if (model.verified) {
    const verified = document.createElement('span');
    verified.className = 'kickflow-user-card__verified';
    verified.textContent = '✔';
    verified.title = 'doğrulanmış';
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
  makeDraggable(card, header);

  if (model.bio) {
    const bio = document.createElement('div');
    bio.className = 'kickflow-user-card__bio';
    bio.textContent = model.bio;
    card.appendChild(bio);
  }

  if (model.followers) appendField(card, 'takipçi', model.followers);
  appendField(card, 'hesap oluşturma', model.createdAt);
  appendField(card, 'takip', model.followingSince);
  appendField(card, 'abonelik', model.subscribedFor);

  if (model.badges.length > 0) {
    const badges = document.createElement('div');
    badges.className = 'kickflow-user-card__badges';
    appendBadges(badges, model.badges);
    card.appendChild(badges);
  }

  const link = document.createElement('a');
  link.className = 'kickflow-user-card__link';
  link.href = `https://kick.com/${model.slug}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `kick.com/${model.slug} → aç`;
  // Same-origin link inside our overlay — open it ourselves so a plain left-click can't bubble to
  // Kick's SPA router and navigate the current page instead of opening the profile in a new tab.
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(link.href, '_blank', 'noopener,noreferrer');
  });
  card.appendChild(link);
  return card;
}

function buildMinimalCard(displayName: string, slug: string | null): HTMLElement {
  const card = buildUserCardElement({
    username: displayName,
    slug: slug && SAFE_SLUG_RE.test(slug) ? slug : displayName,
    profilePic: null,
    role: null,
    verified: false,
    bio: null,
    followers: null,
    createdAt: '-',
    followingSince: 'takip etmiyor',
    subscribedFor: 'abone değil',
    badges: [],
  });
  if (!slug) card.querySelector('.kickflow-user-card__link')?.remove();
  return card;
}

function positionCard(card: HTMLElement, x: number, y: number): void {
  const margin = 8;
  card.style.left = `${Math.min(x + margin, window.innerWidth - 284)}px`;
  card.style.top = `${Math.min(y + margin, window.innerHeight - 260)}px`;
}

/** Grab the card by its header (the top) and drag it anywhere on the page. Ignores drags that
 * start on the close button or the profile link so those keep working. */
function makeDraggable(card: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.kickflow-user-card__close, a')) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: MouseEvent): void => {
      const x = Math.max(4, Math.min(moveEvent.clientX - offsetX, window.innerWidth - card.offsetWidth - 4));
      const y = Math.max(4, Math.min(moveEvent.clientY - offsetY, window.innerHeight - card.offsetHeight - 4));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    };
    // Clean up on mouseup OR if the card is dismissed mid-drag (Escape / another card / channel
    // switch) — otherwise the document listeners leak and keep the detached card alive.
    const stop = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      card.removeEventListener('kickflow:dismiss', stop);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    card.addEventListener('kickflow:dismiss', stop);
  });
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

export async function openUserCard(username: string, displayName: string, clientX: number, clientY: number): Promise<void> {
  dismissUserCard();
  if (isMasqueradeEnabled()) {
    const card = buildMinimalCard(displayName, null);
    document.body.appendChild(card);
    positionCard(card, clientX, clientY);
    installDismissHandlers(card);
    activeCard = card;
    return;
  }

  const loading = buildMinimalCard(displayName, username);
  document.body.appendChild(loading);
  positionCard(loading, clientX, clientY);
  installDismissHandlers(loading);
  activeCard = loading;

  const model = await fetchUserCard(username, displayName);
  if (activeCard !== loading) return;
  const next = model ? buildUserCardElement(model) : buildMinimalCard(displayName, username);
  loading.dispatchEvent(new Event('kickflow:dismiss'));
  loading.replaceWith(next);
  activeCard = next;
  positionCard(next, clientX, clientY);
  installDismissHandlers(next);
}
