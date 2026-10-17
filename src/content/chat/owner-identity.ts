import { featureFlags } from './feature-flags';
import { normalizeChatIdentity } from './message-store';

export interface OwnerIdentity {
  /** Normalized username/slug when known. */
  username: string | null;
  /** Numeric Kick user id when known (often unavailable from DOM). */
  userId: number | null;
}

let cached: OwnerIdentity | null = null;
let unresolvedDebugLogged = false;

/** Clear session cache (call when manual username changes). */
export function invalidateOwnerIdentityCache(): void {
  cached = null;
  unresolvedDebugLogged = false;
}

/**
 * Resolves the logged-in Kick user for mention/reply-to-me detection.
 * Priority: manualUsername override → defensive DOM read → null (silent no-op).
 */
export function resolveOwnerIdentity(): OwnerIdentity {
  const manual = featureFlags.manualUsername.trim();
  if (manual) {
    const identity: OwnerIdentity = {
      username: normalizeChatIdentity(manual),
      userId: null,
    };
    cached = identity;
    return identity;
  }

  if (cached && cached.username) return cached;

  const fromDom = readOwnerUsernameFromDom();
  if (fromDom) {
    cached = { username: normalizeChatIdentity(fromDom), userId: null };
    return cached;
  }

  if (!unresolvedDebugLogged) {
    unresolvedDebugLogged = true;
    console.debug('[kickflow] owner identity unresolved — mention/reply highlight idle until set');
  }
  return { username: null, userId: null };
}

export function isOwnerIdentityResolved(): boolean {
  const id = resolveOwnerIdentity();
  return id.username != null && id.username.length > 0;
}

/**
 * Defensive DOM probes for Kick's navbar account chrome.
 * TODO: verify against live DOM — selectors are best-effort without a live Kick session.
 * Deliberately scoped to the right-side account cluster (and a few testids) so we never
 * mistake the channel slug / browse links for the logged-in user.
 */
function readOwnerUsernameFromDom(): string | null {
  // 1. Profile link / labels in the right-side navbar cluster (gift/KICKs/avatar area).
  for (const nav of document.querySelectorAll('nav')) {
    const children = Array.from(nav.children);
    if (children.length < 3) continue;
    const right = children[2];
    if (!(right instanceof HTMLElement)) continue;
    if (
      !(right.classList.contains('flex')
        && right.classList.contains('items-center')
        && right.classList.contains('gap-2'))
    ) {
      continue;
    }

    for (const link of right.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
      const slug = slugFromPath(link.getAttribute('href') ?? '');
      if (slug) return slug;
    }
    // Avatar button / img alt / aria-label sometimes carries the username.
    for (const el of right.querySelectorAll<HTMLElement>('button, img, [aria-label]')) {
      const labeled = el.getAttribute('aria-label') || el.getAttribute('alt') || '';
      const guess = guessUsernameFromLabel(labeled);
      if (guess) return guess;
    }
  }

  // 2. Common Kick testids / menu hooks (may drift — fail soft).
  const testIds = [
    '[data-testid="user-menu"]',
    '[data-testid="nav-profile"]',
    '[data-testid="header-user-menu"]',
    '[data-testid="user-profile"]',
  ];
  for (const sel of testIds) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const href = el.closest('a')?.getAttribute('href')
      || el.querySelector('a')?.getAttribute('href')
      || el.getAttribute('href');
    const slug = slugFromPath(href ?? '');
    if (slug) return slug;
    const labeled = el.getAttribute('aria-label') || '';
    const guess = guessUsernameFromLabel(labeled);
    if (guess) return guess;
  }

  return null;
}

const RESERVED_PATH_SLUGS = new Set([
  'categories', 'search', 'browse', 'following', 'subscriptions', 'dashboard',
  'settings', 'transactions', 'messages', 'community', 'clips', 'videos',
  'home', 'login', 'signup', 'register', 'offline', 'popout',
]);

function slugFromPath(href: string): string | null {
  try {
    const url = href.startsWith('http') ? new URL(href) : new URL(href, 'https://kick.com');
    if (url.hostname !== 'kick.com' && !url.hostname.endsWith('.kick.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null;
    const slug = parts[0].toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(slug)) return null;
    if (RESERVED_PATH_SLUGS.has(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

function guessUsernameFromLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  // "Open profile for FooBar" / "FooBar's account" / "@FooBar"
  const patterns = [
    /@([a-zA-Z0-9_]{1,25})/,
    /(?:profile|account|user)\s+(?:for\s+)?([a-zA-Z0-9_]{1,25})/i,
    /^([a-zA-Z0-9_]{1,25})(?:'s)?\s+(?:profile|account|menu)/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1] && !RESERVED_PATH_SLUGS.has(m[1].toLowerCase())) return m[1];
  }
  if (/^[a-zA-Z0-9_]{1,25}$/.test(trimmed) && !RESERVED_PATH_SLUGS.has(trimmed.toLowerCase())) {
    return trimmed;
  }
  return null;
}
