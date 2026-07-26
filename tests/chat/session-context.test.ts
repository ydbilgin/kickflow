import { describe, expect, it } from 'vitest';
import { parseChatSessionContext } from '../../src/content/chat/session-context';

describe('parseChatSessionContext', () => {
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
