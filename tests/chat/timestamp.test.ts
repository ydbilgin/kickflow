import { describe, expect, it } from 'vitest';
import { formatVodReplayTimestamp } from '../../src/content/chat/timestamp';

describe('formatVodReplayTimestamp', () => {
  const vodStart = Date.parse('2026-07-25T18:12:38Z');

  it('matches native MM:SS labels throughout the first hour', () => {
    expect(formatVodReplayTimestamp('2026-07-25T18:12:38Z', vodStart))
      .toBe('00:00');
    expect(formatVodReplayTimestamp('2026-07-25T18:12:43Z', vodStart))
      .toBe('00:05');
    expect(formatVodReplayTimestamp('2026-07-25T18:13:43Z', vodStart))
      .toBe('01:05');
    expect(formatVodReplayTimestamp('2026-07-25T18:17:43Z', vodStart))
      .toBe('05:05');
    expect(formatVodReplayTimestamp('2026-07-25T19:12:37Z', vodStart))
      .toBe('59:59');
  });

  it('switches to native HH:MM:SS at one hour and preserves the captured position', () => {
    expect(formatVodReplayTimestamp('2026-07-25T19:12:38Z', vodStart))
      .toBe('01:00:00');
    expect(formatVodReplayTimestamp('2026-07-26T01:25:48Z', vodStart))
      .toBe('07:13:10');
  });

  it('floors fractional seconds and preserves total hours beyond one day', () => {
    expect(formatVodReplayTimestamp('2026-07-25T18:12:39.999Z', vodStart))
      .toBe('00:01');
    expect(formatVodReplayTimestamp('2026-07-27T01:14:41Z', vodStart))
      .toBe('31:02:03');
  });

  it('returns an empty timestamp for invalid or pre-start input', () => {
    expect(formatVodReplayTimestamp('not-a-date', vodStart)).toBe('');
    expect(formatVodReplayTimestamp('2026-07-25T18:12:37Z', vodStart)).toBe('');
    expect(formatVodReplayTimestamp('2026-07-25T18:12:38Z', Number.NaN)).toBe('');
  });
});
