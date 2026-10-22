// Popup look refresh (2026-10-22): plain summary, a closed Diagnostics section, tabs, plain wording and full
// Turkish. Behaviour (which messages are sent) is covered by popup.test.ts; these tests pin the layout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statusResponse = {
  slug: 'test-channel', chatroomId: 15250312, active: true, reason: 'aktif', pusherConnected: true, lastBanAt: null,
  messageCount: 1840, preservedCount: 37, bannedCount: 4, deletedCount: 33,
  ghostAnchored: 31, ghostPendingNoAnchor: 2, ghostStrip: 0, ghostEvicted: 4,
  flags: {
    chatMode: 'native', hoverFollowMode: 'browser-smooth', showDeletedMessages: true, preserveBansInline: true,
    debugLogging: false, showSubscriptions: true, showGiftedSubs: true, showKicks: true, showHostRaid: true,
    showModeChanges: true, showChattersBadges: true, autoTheater: false, rewindControls: true, liveCatchup: true,
    qualityLock: true, screenshot: true, speedControls: true, autoClaimDrops: false, autoClaimDailyReward: false,
  },
  hotkeys: {
    rewind: { enabled: true, key: 'ArrowLeft' }, forward: { enabled: true, key: 'ArrowRight' },
    screenshot: { enabled: true, key: 's' }, goLive: { enabled: true, key: 'l' },
  },
};

let lang = 'en';

function loadPopupMarkup(): void {
  const html = readFileSync(resolve(process.cwd(), 'popup.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.replaceChildren(...Array.from(parsed.head.childNodes, (node) => document.importNode(node, true)));
  document.body.replaceChildren(...Array.from(parsed.body.childNodes, (node) => document.importNode(node, true)));
}

async function openPopup(language: string): Promise<void> {
  lang = language;
  await import('../../src/popup/popup');
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

const text = (selector: string): string => document.querySelector<HTMLElement>(selector)?.textContent?.trim() ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  loadPopupMarkup();
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-popup-test' },
    storage: { local: { get: vi.fn(async () => ({ kf_lang: lang })), set: vi.fn(async () => undefined) } },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async (_id: number, message: { type: string }) =>
        (message.type === 'kickflow:getStatus' ? statusResponse : { ok: true })),
    },
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('popup layout refresh', () => {
  it('K2: leads with three plain session numbers and keeps the technical counters in a closed Diagnostics section', async () => {
    await openPopup('en');
    const summary = Array.from(document.querySelectorAll('#stats .sum'), (cell) => [
      cell.querySelector('.v')?.textContent, cell.querySelector('.k')?.textContent,
    ]);
    expect(summary).toEqual([['1840', 'Messages seen'], ['37', 'Kept after removal'], ['4', 'Kept from bans']]);
    const diagnostics = document.getElementById('diagnostics') as HTMLDetailsElement;
    expect(diagnostics.tagName).toBe('DETAILS');
    expect(diagnostics.open).toBe(false);
    for (const id of ['slug', 'chatroomId', 'pusher', 'deleted', 'ghostAnchored', 'ghostPending', 'ghostEvicted', 'lastBan', 't-debug']) {
      expect(diagnostics.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(text('#chatroomId')).toBe('15250312');
    expect(document.querySelector('.section #t-debug')).toBeNull();
  });

  it('K3: names the hover scrolling setting and its two choices in plain words', async () => {
    await openPopup('tr');
    expect(text('.hover-follow-copy strong')).toBe('İmleç altındaki kaydırma');
    const options = Array.from((document.getElementById('t-hover-follow-mode') as HTMLSelectElement).options,
      (option) => [option.value, option.textContent]);
    expect(options).toEqual([['browser-smooth', 'Yumuşak'], ['instant', 'Anında']]);
    expect(document.body.textContent).not.toMatch(/Mode A|Mod A|browser smooth/);
  });

  it('K4: the Turkish popup has no English leftovers, and the status line names the chat view', async () => {
    await openPopup('tr');
    expect(text('#reason')).toBe('KickFlow aktif · Kick sohbeti');
    const options = Array.from((document.getElementById('t-chat-mode') as HTMLSelectElement).options, (option) => option.textContent);
    expect(options).toEqual(['Kick sohbeti', 'KickFlow listesi']);
    const all = document.body.textContent ?? '';
    for (const leftover of ['native', 'Native', 'Current:', 'Chatroom', 'Ghost inline', 'Ghost evict', 'Hover', 'Status / Statistics']) {
      expect(all, leftover).not.toContain(leftover);
    }
    expect(text('#pusher')).toBe('bağlı');
  });

  it('K4: the English status line names the chat view in words', async () => {
    await openPopup('en');
    expect(text('#reason')).toBe('KickFlow active · Kick chat');
  });

  it('K1: shows one of four tabs at a time and moves between them by click and arrow keys', async () => {
    await openPopup('tr');
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Sohbet', 'Oynatıcı', 'Ödüller', 'Kısayollar']);
    const visible = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('.section[data-panel]'))
      .filter((section) => !section.hidden).map((section) => section.dataset.panel ?? '');
    expect(visible()).toEqual(['chat']);
    expect(document.querySelector('#panel-chat #t-hover-follow-mode')).not.toBeNull();
    tabs[1].click();
    expect(visible()).toEqual(['player']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(visible()).toEqual(['rewards']);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(visible()).toEqual(['chat']);
    // Every switch keeps its element and id, so the existing setFlag wiring is untouched.
    for (const id of ['t-deleted', 't-rewind-controls', 't-auto-claim-drops', 'hk-rewind-change']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });
});
