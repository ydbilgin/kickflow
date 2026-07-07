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

    setReactFiberKey(row, 'late-id');
    await vi.advanceTimersByTimeAsync(1000);

    expect(row.getAttribute('data-kickflow-mid')).toBe('late-id');
    stamper.teardown();
  });

  it('re-stamps a recycled row when its React fiber key changes', async () => {
    const list = document.querySelector<HTMLElement>('.no-scrollbar');
    if (!list) throw new Error('missing chat list');
    const row = makeRow();
    setReactFiberKey(row, 'first-id');
    list.appendChild(row);

    const { initReactKeyStamper } = await import('../../src/mainworld/react-key-stamper');
    window.dispatchEvent(new Event('pagehide'));
    const stamper = initReactKeyStamper();

    expect(row.getAttribute('data-kickflow-mid')).toBe('first-id');

    setReactFiberKey(row, 'second-id');
    await vi.advanceTimersByTimeAsync(1000);

    expect(row.getAttribute('data-kickflow-mid')).toBe('second-id');
    stamper.teardown();
  });
});
