import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installChat(): HTMLElement {
  document.body.innerHTML = '<div id="chatroom-messages"><div class="no-scrollbar"></div></div>';
  const list = document.querySelector<HTMLElement>('.no-scrollbar');
  if (!list) throw new Error('missing chat list');
  return list;
}

function makeRow(index = 0): HTMLElement {
  const row = document.createElement('div');
  row.dataset.index = String(index);
  return row;
}

function setReactFiberKey(row: HTMLElement, id: string): void {
  Object.defineProperty(row, '__reactFiber$kickflowTest', {
    configurable: true,
    writable: true,
    value: { key: `3456-${id}` },
  });
}

describe('initReactKeyStamper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    installChat();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('stamps a row whose React fiber key becomes readable after insertion', async () => {
    const list = document.querySelector<HTMLElement>('.no-scrollbar');
    if (!list) throw new Error('missing chat list');
    const row = makeRow();
    list.appendChild(row);

    const { initReactKeyStamper } = await import('../../src/mainworld/react-key-stamper');
    window.dispatchEvent(new Event('pagehide'));
    const stamper = initReactKeyStamper();

    expect(row.getAttribute('data-kickflow-mid')).toBeNull();

    setReactFiberKey(row, '72faefda-d095-4a8f-a146-7e9b7c491908');
    await vi.advanceTimersByTimeAsync(1000);

    expect(row.getAttribute('data-kickflow-mid')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');
    stamper.teardown();
  });

  it('re-stamps a recycled row when its React fiber key changes', async () => {
    const list = document.querySelector<HTMLElement>('.no-scrollbar');
    if (!list) throw new Error('missing chat list');
    const row = makeRow();
    setReactFiberKey(row, '72faefda-d095-4a8f-a146-7e9b7c491908');
    list.appendChild(row);

    const { initReactKeyStamper } = await import('../../src/mainworld/react-key-stamper');
    window.dispatchEvent(new Event('pagehide'));
    const stamper = initReactKeyStamper();

    expect(row.getAttribute('data-kickflow-mid')).toBe('72faefda-d095-4a8f-a146-7e9b7c491908');

    setReactFiberKey(row, '8957918e-cbad-48b2-a196-44a18740317a');
    await vi.advanceTimersByTimeAsync(1000);

    expect(row.getAttribute('data-kickflow-mid')).toBe('8957918e-cbad-48b2-a196-44a18740317a');
    stamper.teardown();
  });

  it('does not stamp a row when its fiber key has an unexpected shape', async () => {
    const list = document.querySelector<HTMLElement>('.no-scrollbar');
    if (!list) throw new Error('missing chat list');
    const row = makeRow();
    setReactFiberKey(row, 'not-a-message-id');
    list.appendChild(row);

    const { initReactKeyStamper } = await import('../../src/mainworld/react-key-stamper');
    window.dispatchEvent(new Event('pagehide'));
    const stamper = initReactKeyStamper();

    expect(row.getAttribute('data-kickflow-mid')).toBeNull();
    stamper.teardown();
  });
});
