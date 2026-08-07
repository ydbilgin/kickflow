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
    hoverFollowMode: 'browser-smooth',
    showDeletedMessages: true,
    preserveBansInline: true,
    debugLogging: false,
    showSubscriptions: false,
    showGiftedSubs: true,
    showKicks: true,
    showHostRaid: false,
    showModeChanges: false,
    showChattersBadges: true,
    autoTheater: false,
    rewindControls: true,
    liveCatchup: true,
    qualityLock: true,
    screenshot: true,
    speedControls: true,
    autoClaimDrops: true,
    autoClaimDailyReward: true,
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
    runtime: { id: 'kickflow-popup-test' },
    storage: {
      local: {
        get: vi.fn(async () => ({ kf_lang: 'tr' })),
        set: vi.fn(async () => undefined),
      },
    },
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
      'Change 10s back shortcut',
      'Change 10s forward shortcut',
      'Change Screenshot shortcut',
      'Change Go live shortcut',
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

  it('hydrates and sends hoverFollowMode through kickflow:setFlag', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    const select = document.getElementById('t-hover-follow-mode') as HTMLSelectElement;
    expect(select.value).toBe('browser-smooth');
    expect(Array.from(select.options, (option) => option.value)).toEqual(['browser-smooth', 'instant']);
    expect(Array.from(select.options, (option) => option.textContent)).toEqual([
      'Current: browser smooth',
      'Instant: no animation',
    ]);

    sendMessage.mockClear();
    select.value = 'instant';
    select.dispatchEvent(new Event('change'));
    await flushAsyncWork();
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'kickflow:setFlag',
      key: 'hoverFollowMode',
      value: 'instant',
    });

    sendMessage.mockClear();
    select.value = 'browser-smooth';
    select.dispatchEvent(new Event('change'));
    await flushAsyncWork();
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'kickflow:setFlag',
      key: 'hoverFollowMode',
      value: 'browser-smooth',
    });
  });

  it('hydrates all event popup checkboxes from the shared status payload', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    expect((document.getElementById('t-subscriptions') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('t-gifted-subs') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-kicks') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-host-raid') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('t-mode-changes') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('t-chatters-badges') as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('label[for="t-subscriptions"]')?.textContent).toBe('Abonelikler');
    expect(document.querySelector('label[for="t-gifted-subs"]')?.textContent).toBe('Hediye abonelikler');
    expect(document.querySelector('label[for="t-kicks"]')?.textContent).toBe('Kicks / bağışlar');
    expect(document.querySelector('label[for="t-host-raid"]')?.textContent).toBe('Host / Raid');
    expect(document.querySelector('label[for="t-mode-changes"]')?.textContent).toBe('Mod değişiklikleri');
    expect(document.querySelector('label[for="t-chatters-badges"]')?.textContent).toBe('Aktif sohbetçi rozetleri');
  });

  it('sends each event toggle through kickflow:setFlag', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();
    sendMessage.mockClear();

    for (const [id, key] of [
      ['t-subscriptions', 'showSubscriptions'],
      ['t-gifted-subs', 'showGiftedSubs'],
      ['t-kicks', 'showKicks'],
      ['t-host-raid', 'showHostRaid'],
      ['t-mode-changes', 'showModeChanges'],
      ['t-chatters-badges', 'showChattersBadges'],
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

  it('renders both reward toggles under Rewards and dispatches each flag change', async () => {
    await import('../../src/popup/popup');
    await flushAsyncWork();

    const sections = Array.from(document.querySelectorAll<HTMLElement>('.section'));
    const player = sections.find((section) => section.querySelector('.section-title')?.textContent === 'Oynatıcı');
    const rewards = sections.find((section) => section.querySelector('#t-auto-claim-daily-reward') !== null);
    expect(player?.querySelector('#t-auto-claim-drops')).toBeNull();
    expect(rewards).not.toBeUndefined();
    expect(rewards?.querySelector('#t-auto-claim-drops')).not.toBeNull();
    expect(rewards?.querySelector('#t-auto-claim-daily-reward')).not.toBeNull();
    expect((document.getElementById('t-auto-claim-drops') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-auto-claim-daily-reward') as HTMLInputElement).checked).toBe(true);

    sendMessage.mockClear();
    const checkbox = document.getElementById('t-auto-claim-drops') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await flushAsyncWork();

    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'kickflow:setFlag',
      key: 'autoClaimDrops',
      value: false,
    });

    sendMessage.mockClear();
    const dailyCheckbox = document.getElementById('t-auto-claim-daily-reward') as HTMLInputElement;
    dailyCheckbox.checked = false;
    dailyCheckbox.dispatchEvent(new Event('change'));
    await flushAsyncWork();

    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'kickflow:setFlag',
      key: 'autoClaimDailyReward',
      value: false,
    });
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
