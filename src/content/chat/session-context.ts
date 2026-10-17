const NON_CHANNEL_SLUGS = new Set([
  'api',
  'browse',
  'categories',
  'category',
  'video',
  'videos',
  'search',
  'subscription',
  'subscriptions',
  'wallet',
  'dashboard',
  'drops',
  'settings',
  'following',
  'clips',
  'collectibles',
  'messages',
  'notifications',
  'shop',
  // Reserved site routes include footer destinations, bundle routes and login. 2026-10-16.
  // These destinations cannot identify a channel session.
  'terms-of-service',
  'terms-and-conditions',
  'privacy-policy',
  'cookie-policy',
  'community-guidelines',
  'dmca-policy',
  'partner-terms-and-conditions',
  'kicks-usage-policy',
  'advertising-policy',
  'kick-drops-terms',
  'popout',
  'mobile',
]);

const SAFE_VOD_ID = /^[A-Za-z0-9_-]+$/;

export type ChatSessionContext =
  | {
      kind: 'live';
      slug: string;
      sessionKey: string;
    }
  | {
      kind: 'vod';
      slug: string;
      videoId: string;
      sessionKey: string;
    };

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Turns the current Kick route into the identity that owns chat/player lifecycle. A VOD id is
 * part of that identity so same-channel live ↔ VOD and VOD ↔ VOD navigation cannot reuse a live
 * socket or stale replay controller. */
export function parseChatSessionContext(pathname: string): ChatSessionContext | null {
  const rawSegments = pathname.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;
  const segments = rawSegments.map(decodePathSegment);
  if (segments.some((segment) => segment === null)) return null;

  const slug = segments[0]!;
  if (!slug || NON_CHANNEL_SLUGS.has(slug.toLowerCase())) return null;
  // Kick channel slugs hold letters, digits, '-' and '_' only. A dotted root is a file such as
  // /robots.txt or /sitemap.xml, never a channel.
  if (slug.includes('.')) return null;

  if (segments[1]?.toLowerCase() === 'videos' && segments.length >= 3) {
    const videoId = segments[2]!;
    if (!SAFE_VOD_ID.test(videoId)) return null;
    return {
      kind: 'vod',
      slug,
      videoId,
      sessionKey: `vod:${slug}:${videoId}`,
    };
  }

  return {
    kind: 'live',
    slug,
    sessionKey: `live:${slug}`,
  };
}
