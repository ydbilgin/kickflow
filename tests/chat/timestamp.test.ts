import { describe, expect, it } from 'vitest';
import { formatVodReplayTimestamp } from '../../src/content/chat/timestamp';

describe('formatVodReplayTimestamp', () => {
  const vodStart = Date.parse('2026-07-25T18:12:38Z');

  it('formats zero and the captured Hype replay position as elapsed HH:MM:SS', () => {
    expect(formatVodReplayTimestamp('2026-07-25T18:12:38Z', vodStart))
      .toBe('00:00:00');
    expect(formatVodReplayTimestamp('2026-07-26T01:25:48Z', vodStart))
      .toBe('07:13:10');
  });

  it('floors fractional seconds and preserves total hours beyond one day', () => {
    expect(formatVodReplayTimestamp('2026-07-25T18:12:39.999Z', vodStart))
      .toBe('00:00:01');
    expect(formatVodReplayTimestamp('2026-07-27T01:14:41Z', vodStart))
      .toBe('31:02:03');
  });

  it('returns an empty timestamp for invalid or pre-start input', () => {
    expect(formatVodReplayTimestamp('not-a-date', vodStart)).toBe('');
    expect(formatVodReplayTimestamp('2026-07-25T18:12:37Z', vodStart)).toBe('');
    expect(formatVodReplayTimestamp('2026-07-25T18:12:38Z', Number.NaN)).toBe('');
  });
});
