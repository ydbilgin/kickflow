import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statusResponse = {
  slug: 'test-channel',
  chatroomId: 15250312,
  active: true,
  reason: 'aktif',
  pusherConnected: true,
  lastBanAt: null,
  messageCount: 3,
  preservedCount: 0,
  bannedCount: 0,
  deletedCount: 0,
  ghostAnchored: 0,
  ghostPendingNoAnchor: 0,
  ghostStrip: 0,
  ghostEvicted: 0,
  flags: {
    chatMode: 'own',
    showDeletedMessages: true,
    preserveBansInline: true,
    debugLogging: false,
    showSubscriptions: false,
    showGiftedSubs: true,
    showHostRaid: false,
    showPinnedMessage: true,
    showModeChanges: false,
    showSidebarRefresh: true,
    autoTheater: false,
    rewindControls: true,
    liveCatchup: true,
    qualityLock: true,
    screenshot: true,
    speedControls: true,
  },
  hotkeys: {
    rewind: { enabled: true, key: 'ArrowLeft' },
    forward: { enabled: true, key: 'ArrowRight' },
    screenshot: { enabled: true, key: 's' },
    goLive: { enabled: true, key: 'l' },
  },
};

let sendMessage: ReturnType<typeof vi.fn>;

function loadPopupMarkup(): void {
  const html = readFileSync(resolve(process.cwd(), 'popup.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const headNodes = Array.from(parsed.head.childNodes, (node) => document.importNode(node, true));
  const bodyNodes = Array.from(parsed.body.childNodes, (node) => document.importNode(node, true));
  document.head.replaceChildren(...headNodes);
  document.body.replaceChildren(...bodyNodes);
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  loadPopupMarkup();
  sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
    if (message.type === 'kickflow:getStatus') return statusResponse;
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage,
    },
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('popup event display toggles', () => {
  it('gives every hotkey change button an action-specific accessible name', () => {
    const names = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.hotkey-change'),
      (button) => button.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      '10 sn geri kısayolunu değiştir',
      '10 sn ileri kısayolunu değiştir',
      'Ekran görüntüsü kısayolunu değiştir',
      'Canlıya dön kısayolunu değiştir',
    ]);
    expect(new Set(names).size).toBe(4);
  });

  it('renders missing status values with the muted em-dash placeholder', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    const lastBan = document.getElementById('lastBan');
    expect(lastBan?.textContent).toBe('—');
    expect(lastBan?.classList.contains('missing')).toBe(true);
    expect(document.getElementById('slug')?.classList.contains('missing')).toBe(false);
  });

  it('hydrates all event popup checkboxes from the shared status payload', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    expect((document.getElementById('t-subscriptions') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('t-gifted-subs') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-host-raid') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('t-pinned-message') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-mode-changes') as HTMLInputElement).checked).toBe(false);
    expect(document.querySelector('label[for="t-subscriptions"]')?.textContent).toBe('Abonelikler');
    expect(document.querySelector('label[for="t-gifted-subs"]')?.textContent).toBe('Hediye abonelikler');
    expect(document.querySelector('label[for="t-host-raid"]')?.textContent).toBe('Host / Raid');
    expect(document.querySelector('label[for="t-pinned-message"]')?.textContent).toBe('Sabitlenmiş mesaj');
    expect(document.querySelector('label[for="t-mode-changes"]')?.textContent).toBe('Mod değişiklikleri');
  });

  it('sends each event toggle through kickflow:setFlag', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();
    sendMessage.mockClear();

    for (const [id, key] of [
      ['t-subscriptions', 'showSubscriptions'],
      ['t-gifted-subs', 'showGiftedSubs'],
      ['t-host-raid', 'showHostRaid'],
      ['t-pinned-message', 'showPinnedMessage'],
      ['t-mode-changes', 'showModeChanges'],
    ] as const) {
      const checkbox = document.getElementById(id) as HTMLInputElement;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      await flushAsyncWork();

      expect(sendMessage).toHaveBeenCalledWith(7, {
        type: 'kickflow:setFlag',
        key,
        value: false,
      });
    }
  });

  it('hydrates and sends all newly toggleable player features', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    for (const [id, key] of [
      ['t-rewind-controls', 'rewindControls'],
      ['t-live-catchup', 'liveCatchup'],
      ['t-quality-lock', 'qualityLock'],
      ['t-screenshot', 'screenshot'],
      ['t-speed-controls', 'speedControls'],
    ] as const) {
      const checkbox = document.getElementById(id) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      sendMessage.mockClear();
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      await flushAsyncWork();
      expect(sendMessage).toHaveBeenCalledWith(7, { type: 'kickflow:setFlag', key, value: false });
    }
  });

  it('captures the next key for a hotkey rebind and sends it live', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();
    sendMessage.mockClear();

    document.getElementById('hk-screenshot-change')?.click();
    const event = new KeyboardEvent('keydown', { key: 'P', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    await flushAsyncWork();

    expect(event.defaultPrevented).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'kickflow:setHotkey',
      action: 'screenshot',
      patch: { key: 'p' },
    });
    expect(document.getElementById('hotkey-status')?.textContent).toBe('Kısayol kaydedildi.');
  });
});
