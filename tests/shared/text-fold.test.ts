import { describe, expect, it } from 'vitest';
import { foldSearchText, parseSearchQuery } from '../../src/content/shared/text-fold';

describe('foldSearchText', () => {
  it('folds Turkish İ/I/ı before Unicode default lowercasing', () => {
    expect(foldSearchText('İzmir')).toBe('izmir');
    expect(foldSearchText('IŞIK')).toBe('isik');
    expect(foldSearchText('ışık')).toBe('isik');
    expect(foldSearchText('MAŞALLAH')).toBe('masallah');
    expect(foldSearchText('güneş')).toBe('gunes');
  });

  it('strips generic Latin diacritics', () => {
    expect(foldSearchText('café')).toBe('cafe');
    expect(foldSearchText('niño')).toBe('nino');
    expect(foldSearchText('Ångström')).toBe('angstrom');
  });

  it('preserves code-unit and code-point counts over a mixed corpus', () => {
    const corpus = [
      'İzmir MAŞALLAH IŞIK güneş',
      'café niño Ångström',
      'hello ASCII 123',
      'emoji 😀🎉👨‍👩‍👧',
      'CJK 日本語漢字',
      'combining e\u0301 and precomposed é',
      'mixed Şeyma + 東京 + 🚀',
      'compatibility ideograph \u{2F800}',
    ].join('\n');

    const folded = foldSearchText(corpus);
    expect(folded.length).toBe(corpus.length);
    expect([...folded].length).toBe([...corpus].length);
  });

  it('leaves a combining mark alone when stripping it would collapse the code point', () => {
    // A lone combining acute has no base letter; dropping it would yield 0 code points.
    expect(foldSearchText('\u0301')).toBe('\u0301');
  });

  it('parses folded required terms into a structured query', () => {
    expect(parseSearchQuery('  İZMİR\t güzel \n')).toEqual({
      requiredTerms: ['izmir', 'guzel'],
      excludedTerms: [],
      senderFilters: [],
    });
  });

  it('keeps quoted phrases together and accepts an unterminated phrase', () => {
    expect(parseSearchQuery('"iyi geceler" sonra')).toEqual({
      requiredTerms: ['iyi geceler', 'sonra'],
      excludedTerms: [],
      senderFilters: [],
    });
    expect(parseSearchQuery('before "iyi gece')).toEqual({
      requiredTerms: ['before', 'iyi gece'],
      excludedTerms: [],
      senderFilters: [],
    });
  });

  it('separates sender filters and negation from plain hyphenated terms', () => {
    expect(parseSearchQuery('from:ŞEYMA from:"Ahmet Yılmaz" -şaka well-known -')).toEqual({
      requiredTerms: ['well-known', '-'],
      excludedTerms: ['saka'],
      senderFilters: ['seyma', 'ahmet yilmaz'],
    });
  });
});
