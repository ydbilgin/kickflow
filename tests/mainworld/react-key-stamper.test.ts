import { describe, expect, it } from 'vitest';
import { parseMessageId } from '../../src/mainworld/react-key-stamper';

describe('parseMessageId', () => {
  it('strips the React list prefix before the first dash', () => {
    expect(parseMessageId('3456-aaa-bbb-ccc')).toBe('aaa-bbb-ccc');
  });

  it('returns keys without a dash as-is', () => {
    expect(parseMessageId('nokey')).toBe('nokey');
  });
});
