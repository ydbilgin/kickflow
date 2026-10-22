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
});
