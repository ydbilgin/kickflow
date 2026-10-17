import { describe, expect, it } from 'vitest';
import { formatDurationMinutes, type Lang } from '../../src/content/shared/i18n';

describe('formatDurationMinutes', () => {
  const boundaryCases: Array<[number, string, string]> = [
    [59, '59M', '59DK'],
    [60, '1H', '1SA'],
    [61, '1H 1M', '1SA 1DK'],
    [1439, '23H 59M', '23SA 59DK'],
    [1440, '1D', '1G'],
    [1441, '1D', '1G'],
  ];

  it.each(boundaryCases)('formats %d minutes with localized units', (minutes, english, turkish) => {
    expect(formatDurationMinutes(minutes, 'en')).toBe(english);
    expect(formatDurationMinutes(minutes, 'tr')).toBe(turkish);
  });

  it.each([
    ['en', ''],
    ['tr', ''],
  ] as Array<[Lang, string]>)('returns an empty string for an unavailable duration (%s)', (language, expected) => {
    expect(formatDurationMinutes(null, language)).toBe(expected);
    expect(formatDurationMinutes(undefined, language)).toBe(expected);
    expect(formatDurationMinutes(0, language)).toBe(expected);
  });
});
