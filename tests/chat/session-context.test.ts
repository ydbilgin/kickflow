import { describe, expect, it } from 'vitest';
import { parseChatSessionContext } from '../../src/content/chat/session-context';

describe('parseChatSessionContext', () => {
  it.each([
    'api', 'browse', 'categories', 'category', 'video', 'videos', 'search',
    'subscription', 'subscriptions', 'wallet', 'dashboard', 'settings',
    'following', 'clips', 'messages', 'notifications', 'shop', 'drops', 'collectibles',
  ])('rejects the non-channel root %s and its nested pages', (root) => {
    for (const path of [`/${root}`, `/${root}/campaigns`, `/${root.toUpperCase()}/nested`, `/%${root.charCodeAt(0).toString(16)}${root.slice(1)}/nested`]) {
      expect(parseChatSessionContext(path)).toBeNull();
    }
  });

  // Route sweep 2026-10-06. Sources: output/kick-home.html (2026-07-10 footer links), string
  // constants in the cached kick.com bundles under output/playwright/*/Code Cache/js, the
  // /mobile/login URL in output/playwright/owner-login.json and the robots.txt / sitemap.xml
  // probe in output/round88-badge-click-analysis.md.
  it.each([
    'terms-of-service', 'privacy-policy', 'community-guidelines', 'dmca-policy',
    'partner-terms-and-conditions', 'kicks-usage-policy', 'advertising-policy', 'kick-drops-terms',
    'cookie-policy', 'terms-and-conditions', 'popout', 'mobile',
  ])('rejects the swept Kick site root %s and its nested pages', (root) => {
    for (const path of [`/${root}`, `/${root}/nested`, `/${root.toUpperCase()}`]) {
      expect(parseChatSessionContext(path)).toBeNull();
    }
  });

  it('rejects file-like roots such as /robots.txt, which no channel slug can match', () => {
    for (const path of ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/sitemap.xml/extra']) {
      expect(parseChatSessionContext(path)).toBeNull();
    }
  });

  it('keeps hyphen and underscore channel slugs as live channels', () => {
    expect(parseChatSessionContext('/some-streamer')?.sessionKey).toBe('live:some-streamer');
    expect(parseChatSessionContext('/alice_123')?.sessionKey).toBe('live:alice_123');
  });

  it('matches only the Kick popout chat route and keeps its own session identity', () => {
    expect(parseChatSessionContext('/popout/eray/chat')).toEqual({
      kind: 'live', slug: 'eray', sessionKey: 'popout:eray',
    });
    expect(parseChatSessionContext('/popout/alice_123/chat')?.slug).toBe('alice_123');
    for (const path of ['/popout', '/popout/eray', '/popout/eray/video',
      '/popout/eray/chat/extra', '/popout/%2Fchat/chat', '/popout/robots.txt/chat']) {
      expect(parseChatSessionContext(path)).toBeNull();
    }
    expect(parseChatSessionContext('/eray')?.sessionKey).toBe('live:eray');
  });

  it('keeps normal channel routes and the videos listing on the live channel session', () => {
    expect(parseChatSessionContext('/hype')).toEqual({
      kind: 'live',
      slug: 'hype',
      sessionKey: 'live:hype',
    });
    expect(parseChatSessionContext('/hype/videos')).toEqual({
      kind: 'live',
      slug: 'hype',
      sessionKey: 'live:hype',
    });
  });

  it('gives every VOD its own same-channel session identity', () => {
    expect(parseChatSessionContext('/hype/videos/019f9a7a-a9f0-76a9-873c-705f620bfcc9')).toEqual({
      kind: 'vod',
      slug: 'hype',
      videoId: '019f9a7a-a9f0-76a9-873c-705f620bfcc9',
      sessionKey: 'vod:hype:019f9a7a-a9f0-76a9-873c-705f620bfcc9',
    });
    expect(parseChatSessionContext('/hype/videos/another-vod')?.sessionKey)
      .toBe('vod:hype:another-vod');
  });

  it('rejects reserved roots and malformed VOD ids instead of treating them as live channels', () => {
    expect(parseChatSessionContext('/browse')).toBeNull();
    expect(parseChatSessionContext('/hype/videos/%20')).toBeNull();
    expect(parseChatSessionContext('/')).toBeNull();
  });
});
