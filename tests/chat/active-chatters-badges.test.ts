import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_CHATTERS_ROW_SELECTOR,
  ActiveChattersBadgesController,
} from '../../src/content/chat/active-chatters-badges';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';
import type { StatusSnapshotProvider } from '../../src/content/status';

const statusSnapshot: StatusSnapshotProvider = () => ({
  slug: 'channel', chatroomId: 1, active: true, reason: 'test', pusherConnected: true,
  lastBanAt: null, messageCount: 0, preservedCount: 0, bannedCount: 0, deletedCount: 0,
  ghostAnchored: 0, ghostPendingNoAnchor: 0, ghostStrip: 0, ghostEvicted: 0,
});

function chatterRow(username: string, avatar = 'https://files.kick.com/images/user/profile/123/conversion/fullsize.webp'): string {
  return `
    <li class="block" data-state="open">
      <button class="betterhover:hover:bg-surface-highest betterhover:active:scale-100 flex h-auto w-full justify-start gap-4 p-2 text-left font-normal text-white transition-colors disabled:text-white"
        type="button">
        <div class="relative size-6 shrink-0 rounded-full">
          <img alt="" class="size-full rounded-full object-cover" src="${avatar}">
        </div>
        <span class="min-w-0 flex-1 truncate text-base font-normal leading-6">${username}</span>
      </button>
    </li>`;
}

function activeChattersFixture(rows: string): string {
  return `
    <div class="absolute inset-0 z-popover">
      <section class="bg-surface-base flex size-full min-h-0 flex-col overflow-hidden text-white">
        <header class="border-outline-decorative flex h-[50px] shrink-0 items-center gap-2.5 border-b p-1.5">
          <div class="size-9 shrink-0"><button type="button" aria-label="Collapse chat"></button></div>
          <h2 class="min-w-0 flex-1 text-center text-base font-bold leading-6">Active chatters</h2>
          <button type="button" aria-label="Show live chat"></button>
        </header>
        <div class="shrink-0 p-3">
          <label class="relative block min-w-0">
            <span class="sr-only">Search active chatters</span>
            <svg class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2"></svg>
            <input aria-label="Search active chatters" class="h-8 pl-11 pr-3 text-base" placeholder="Filter" type="search">
          </label>
        </div>
        <div class="min-h-0 flex-1" data-radix-scroll-area-root="">
          <div class="pb-6">
            <div class="border-outline-decorative divide-outline-decorative flex flex-col divide-y border-t" data-orientation="vertical">
              <div class="accordion-item" data-state="open">
                <h3 class="group/section text-base font-bold leading-6">
                  <button type="button" class="flex h-auto w-full justify-start gap-2 p-3"><span>Chatters</span></button>
                </h3>
                <div data-state="open">
                  <ul class="flex list-none flex-col overflow-hidden p-0">${rows}</ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>`;
}

function message(id: string, userId: number, username: string, slug: string): ChatMessage {
  return {
    id, chatroomId: 1, content: `${id} removed text`, type: 'message',
    createdAt: new Date('2026-07-19T12:00:00Z').toISOString(),
    sender: { id: userId, username, slug, identity: { color: '', badges: [], badgesV2: [] } },
    preserved: false,
  };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ActiveChattersBadgesController', () => {
  beforeAll(() => setLang('en'));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('adds a literal evidence badge without taking over the native row click', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('DevletSah_Ozcan'));
    const store = new ChatIntegrityStore();
    store.addMessage(message('one', 7, 'DevletSah_Ozcan', 'devletsah-ozcan'));
    store.addMessage(message('two', 7, 'DevletSah_Ozcan', 'devletsah-ozcan'));
    store.markUserBanned(7);
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    const nativeClick = vi.fn();
    const nativeRow = document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)!;
    nativeRow.addEventListener('click', nativeClick);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);

    const badge = nativeRow.querySelector<HTMLElement>('.kickflow-active-chatters-badge');
    expect(badge?.textContent).toBe('2 removed');
    expect(badge?.dataset.kickflowSlug).toBe('devletsah-ozcan');
    badge?.click();
    expect(nativeClick).not.toHaveBeenCalled();
    expect(removedPanel.isOpen()).toBe(true);
    expect(document.querySelector('.kickflow-panel__filter-chip')?.textContent).toBe('Filtered: DevletSah_Ozcan ×');
    expect(document.querySelectorAll('.kickflow-removed-row')).toHaveLength(2);

    nativeRow.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('reconciles realistic React-style row replacement and sweeps only owned badges', async () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('FirstUser'));
    const store = new ChatIntegrityStore();
    store.addMessage(message('first', 1, 'FirstUser', 'first-user'));
    store.markMessageDeleted('first');
    store.addMessage(message('second', 2, 'Second_User', 'second-user'));
    store.markMessageDeleted('second');
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    new ActiveChattersBadgesController(lifecycle, store, removedPanel);
    const oldBadge = document.querySelector<HTMLElement>('.kickflow-active-chatters-badge')!;
    const list = document.querySelector<HTMLUListElement>('ul.flex.list-none.flex-col.overflow-hidden.p-0')!;
    const nativeMarker = document.createElement('span');
    nativeMarker.className = 'kick-native-marker';
    list.parentElement?.append(nativeMarker);

    list.innerHTML = chatterRow('Second_User');
    await flushMutations();

    expect(oldBadge.isConnected).toBe(false);
    expect(document.querySelector('.kick-native-marker')).toBe(nativeMarker);
    expect(document.querySelector('.kickflow-active-chatters-badge')?.getAttribute('data-kickflow-slug')).toBe('second-user');

    lifecycle.dispose();
    expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();
    expect(document.querySelector('.kick-native-marker')).toBe(nativeMarker);
  });

  it('fails closed when one rendered username maps to multiple preserved slugs', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Collision_User'));
    const store = new ChatIntegrityStore();
    store.addMessage(message('one', 1, 'Collision_User', 'first-slug'));
    store.addMessage(message('two', 2, 'collision_user', 'second-slug'));
    store.markUserBanned(1);
    store.markUserBanned(2);
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);

    expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();
    lifecycle.dispose();
  });
});
