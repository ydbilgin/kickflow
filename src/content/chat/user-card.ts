import { featureFlags } from './feature-flags';
import { appendBadges } from './message-view';
import type { FeatureFlags } from './feature-flags';
import type { ChatBadge } from './message-store';

const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const CARD_CLASS = 'kickflow-user-card';
const FIELD_CLASS = 'kickflow-user-card__field';

interface UserCardRawBadge {
  type?: unknown;
  text?: unknown;
  count?: unknown;
  image_url?: unknown;
  imageUrl?: unknown;
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

export interface UserCardViewModel {
  username: string;
  slug: string;
  profilePic: string | null;
  role: string | null;
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
  return {
    type: typeof raw.type === 'string' ? raw.type : undefined,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    count: typeof raw.count === 'number' ? raw.count : undefined,
    imageUrl: typeof raw.image_url === 'string'
      ? raw.image_url
      : typeof raw.imageUrl === 'string'
        ? raw.imageUrl
        : undefined,
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

function roleFrom(raw: KickUserCardResponse): string | null {
  if (raw.is_channel_owner === true) return 'owner';
  if (raw.is_staff === true) return 'staff';
  if (raw.is_moderator === true) return 'mod';
  return null;
}

export function mapUserCardResponse(raw: KickUserCardResponse, fallbackName: string, fallbackSlug: string): UserCardViewModel {
  const slug = typeof raw.slug === 'string' && SAFE_SLUG_RE.test(raw.slug) ? raw.slug : fallbackSlug;
  const username = typeof raw.username === 'string' && raw.username ? raw.username : fallbackName;
  const subscribedFor = typeof raw.subscribed_for === 'number' && raw.subscribed_for > 0
    ? `${raw.subscribed_for} ay abone`
    : 'abone değil';
  const badgesV2 = normalizeBadges(raw.badges_v2);
  const badges = badgesV2.length > 0 ? badgesV2 : normalizeBadges(raw.badges);
  return {
    username,
    slug,
    profilePic: typeof raw.profile_pic === 'string' && raw.profile_pic ? raw.profile_pic : null,
    role: roleFrom(raw),
    createdAt: formatDate(raw.created_at) ?? '-',
    followingSince: formatDate(raw.following_since) ?? 'takip etmiyor',
    subscribedFor,
    badges,
  };
}

async function fetchUserCard(username: string, fallbackName: string): Promise<UserCardViewModel | null> {
  if (!channelSlug || !SAFE_SLUG_RE.test(username)) return null;
  const cached = cache.get(username);
  if (cached) return cached;

  const promise = fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}/users/${encodeURIComponent(username)}`, {
    headers: { accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      return mapUserCardResponse((await response.json()) as KickUserCardResponse, fallbackName, username);
    })
    .catch(() => null);
  cache.set(username, promise);
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
  const name = document.createElement('strong');
  name.textContent = model.username;
  title.appendChild(name);
  if (model.role) {
    const role = document.createElement('span');
    role.className = 'kickflow-user-card__role';
    role.textContent = model.role;
    title.appendChild(role);
  }
  header.appendChild(title);
  card.appendChild(header);

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
  link.textContent = `kick.com/${model.slug} \u2192 aç`;
  card.appendChild(link);
  return card;
}

function buildMinimalCard(displayName: string, slug: string | null): HTMLElement {
  const card = buildUserCardElement({
    username: displayName,
    slug: slug && SAFE_SLUG_RE.test(slug) ? slug : displayName,
    profilePic: null,
    role: null,
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
  card.style.top = `${Math.min(y + margin, window.innerHeight - 220)}px`;
}

function installDismissHandlers(card: HTMLElement): void {
  const outside = (event: MouseEvent) => {
    if (!card.contains(event.target as Node)) dismissUserCard();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismissUserCard();
  };
  const scroll = () => dismissUserCard();
  window.setTimeout(() => document.addEventListener('mousedown', outside), 0);
  document.addEventListener('keydown', key);
  window.addEventListener('scroll', scroll, true);
  card.addEventListener('kickflow:dismiss', () => {
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', key);
    window.removeEventListener('scroll', scroll, true);
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
