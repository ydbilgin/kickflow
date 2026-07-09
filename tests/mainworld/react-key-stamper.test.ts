import { describe, expect, it } from 'vitest';
import { parseMessageId } from '../../src/mainworld/react-key-stamper';

describe('parseMessageId', () => {
  it('strips a numeric React list prefix from a UUID message id', () => {
    expect(parseMessageId('3456-72faefda-d095-4a8f-a146-7e9b7c491908')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');
  });

  it('rejects malformed and raw UUID keys instead of stamping a corrupted id', () => {
    expect(parseMessageId('72faefda-d095-4a8f-a146-7e9b7c491908')).toBeNull();
    expect(parseMessageId('3456-not-a-message-id')).toBeNull();
  });
});
