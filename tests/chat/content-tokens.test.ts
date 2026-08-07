import { describe, expect, it } from 'vitest';
import { CONTENT_TOKEN_RE, EMOTE_TOKEN_RE, extractMentionUsernames } from '../../src/content/chat/content-tokens';

function emoteNames(content: string): string[] {
  return [...content.matchAll(CONTENT_TOKEN_RE)]
    .map((match) => match.groups?.emoteName)
    .filter((name): name is string => name !== undefined);
}

describe('CONTENT_TOKEN_RE', () => {
  it('parses a single emote token', () => {
    expect(emoteNames('[emote:5405749:sreactayak]')).toEqual(['sreactayak']);
  });

  // Regression: a permissive `.{1,30}` name is greedy and runs past the first `]`, so two
  // adjacent SHORT-named emotes were parsed as one emote called `KEKW][emote:39261:KEKW`.
  // Long names hid it by overrunning the 30-char cap, which is why real chat mostly looked fine.
  it('parses two adjacent short-named emotes as two emotes', () => {
    expect(emoteNames('[emote:39261:KEKW][emote:39261:KEKW]')).toEqual(['KEKW', 'KEKW']);
    expect(emoteNames('[emote:5405749:kek] [emote:5405749:kek]')).toEqual(['kek', 'kek']);
  });

  it('keeps the text between two emotes out of either name', () => {
    expect(emoteNames('[emote:1234:kekw] lol [emote:5678:pog]')).toEqual(['kekw', 'pog']);
  });

  it('still parses urls and mentions', () => {
    expect([...'see https://example.com/x @ahmet'.matchAll(CONTENT_TOKEN_RE)].map((m) => m.groups?.url ?? m.groups?.mention))
      .toEqual(['https://example.com/x', '@ahmet']);
    expect(extractMentionUsernames('hi @ahmet and @mehmet_1')).toEqual(['ahmet', 'mehmet_1']);
  });

  it('leaves a malformed token alone', () => {
    expect(emoteNames('[emote:12345678901:toolongid]')).toEqual([]);
    expect(emoteNames('[emote::noid]')).toEqual([]);
  });
});

describe('EMOTE_TOKEN_RE', () => {
  it('reduces every token to its name, including adjacent short ones', () => {
    expect('[emote:39261:KEKW][emote:39261:KEKW]'.replace(EMOTE_TOKEN_RE, '$1')).toBe('KEKWKEKW');
    expect('[emote:1234:kekw] lol [emote:5678:pog]'.replace(EMOTE_TOKEN_RE, '$1')).toBe('kekw lol pog');
  });

  it('agrees with the tokenizer on which names it finds', () => {
    const content = 'a [emote:1:x] b [emote:22:yy][emote:333:zzz] c';
    const reduced = [...content.matchAll(EMOTE_TOKEN_RE)].map((match) => match[1]);
    expect(reduced).toEqual(emoteNames(content));
  });
});
