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

describe('side-conversation panel rows (T6)', () => {
  it('accepts a panel row key with or without the list index, and nothing else', async () => {
    const { parseThreadRowMessageId } = await import('../../src/mainworld/react-key-stamper');
    expect(parseThreadRowMessageId('1-72faefda-d095-4a8f-a146-7e9b7c491908')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');
    expect(parseThreadRowMessageId('72faefda-d095-4a8f-a146-7e9b7c491908')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');
    expect(parseThreadRowMessageId('row-72faefda')).toBeNull();
  });

  it('stamps a panel row from its React key and clears a stale stamp', async () => {
    const { stampThreadPanelRow } = await import('../../src/mainworld/react-key-stamper');
    const row = document.createElement('div');
    (row as unknown as Record<string, unknown>).__reactFiber$test = { key: '2-72faefda-d095-4a8f-a146-7e9b7c491908' };
    stampThreadPanelRow(row);
    expect(row.getAttribute('data-kickflow-mid')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');

    (row as unknown as Record<string, unknown>).__reactFiber$test = { key: 'odd' };
    stampThreadPanelRow(row);
    expect(row.hasAttribute('data-kickflow-mid')).toBe(false);
  });
});
