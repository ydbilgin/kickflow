import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_CHATTERS_PANEL_SELECTOR,
  ACTIVE_CHATTERS_ROW_SELECTOR,
  ACTIVE_CHATTERS_SEARCH_SELECTOR,
  ActiveChattersBadgesController,
} from '../../src/content/chat/active-chatters-badges';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { configureUserCardSession } from '../../src/content/chat/user-card';
import { configureUserMessageArchive } from '../../src/content/chat/archive-session';
import { UserMessageArchive } from '../../src/content/chat/user-message-archive';
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

function looseRow(username: string): string {
  return `<li><button type="button"><span class="truncate">${username}</span></button></li>`;
}

function message(id: string, userId: number, username: string, slug: string): ChatMessage {
  return {
    id, chatroomId: 1, content: `${id} removed text`, type: 'message',
    createdAt: new Date('2026-07-19T12:00:00Z').toISOString(),
    sender: { id: userId, username, slug, identity: { color: '', badges: [], badgesV2: [] } },
    preserved: false,
  };
}

function mountChatters(username: string, slug: string): Lifecycle {
  const store = new ChatIntegrityStore();
  store.addMessage(message('kept', 7, username, slug));
  store.markUserBanned(7);
  const lifecycle = new Lifecycle();
  const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
  new ActiveChattersBadgesController(lifecycle, store, removedPanel);
  return lifecycle;
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ActiveChattersBadgesController', () => {
  beforeAll(() => setLang('en'));
  afterEach(() => {
    configureUserMessageArchive(null);
    configureUserCardSession(null);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('opens KickFlow card activation from a row click and suppresses the native handler', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Active_User'));
    configureUserCardSession('channel');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    const nativeClick = vi.fn();
    const nativeRow = document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)!;
    nativeRow.addEventListener('click', nativeClick);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 240,
    });
    nativeRow.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(nativeClick).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')).not.toBeNull();
    lifecycle.dispose();
  });

  it('passes the clicked name to the card so archived messages are rendered', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Archive_User'));
    configureUserCardSession('channel');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const archive = new UserMessageArchive({
      now: () => Date.parse('2026-07-19T12:30:00Z'),
    });
    archive.add(message('archived', 7, 'Archive_User', 'archive_user'));
    configureUserMessageArchive(archive);
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);
    document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)?.click();

    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('archived removed text');
    lifecycle.dispose();
  });

  it('keeps the removed-count badge action separate from card activation', () => {
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
    expect(document.querySelector('.kickflow-user-card')).toBeNull();
    expect(removedPanel.isOpen()).toBe(true);
    expect(document.querySelector('.kickflow-panel__filter-chip')?.textContent).toBe('Filtered: DevletSah_Ozcan ×');
    expect(document.querySelectorAll('.kickflow-removed-row')).toHaveLength(2);

    lifecycle.dispose();
  });

  it('opens the card from Enter on a focused row', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Keyboard_User'));
    configureUserCardSession('channel');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    const nativeKeydown = vi.fn();
    const row = document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)!;
    row.addEventListener('keydown', nativeKeydown);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);
    row.focus();
    const keydown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    row.dispatchEvent(keydown);

    expect(keydown.defaultPrevented).toBe(true);
    expect(nativeKeydown).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')).not.toBeNull();
    lifecycle.dispose();
  });

  it('leaves a row click untouched when the row has no usable username', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow(''));
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    const nativeClick = vi.fn();
    const row = document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)!;
    row.addEventListener('click', nativeClick);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);
    row.click();

    expect(nativeClick).toHaveBeenCalledOnce();
    expect(document.querySelector('.kickflow-user-card')).toBeNull();
    lifecycle.dispose();
  });

  it('removes row activation after dispose', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Disposed_User'));
    configureUserCardSession('channel');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);
    const nativeClick = vi.fn();
    const row = document.querySelector<HTMLButtonElement>(ACTIVE_CHATTERS_ROW_SELECTOR)!;
    row.addEventListener('click', nativeClick);
    new ActiveChattersBadgesController(lifecycle, store, removedPanel);

    lifecycle.dispose();
    row.click();

    expect(nativeClick).toHaveBeenCalledOnce();
    expect(document.querySelector('.kickflow-user-card')).toBeNull();
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

  it('still attaches badges in the legacy active-chatters panel', () => {
    document.body.innerHTML = activeChattersFixture(chatterRow('Legacy_User'));
    const lifecycle = mountChatters('Legacy_User', 'legacy-user');

    const panel = document.querySelector(ACTIVE_CHATTERS_PANEL_SELECTOR);
    expect(panel?.querySelector('.kickflow-active-chatters-badge')?.textContent).toBe('1 removed');
    expect(panel?.querySelector('.kickflow-active-chatters-badge')?.dataset.kickflowSlug).toBe('legacy-user');
    lifecycle.dispose();
  });

  it('attaches to a section whose class list no longer matches, including a row outside the nearer wrapper', () => {
    document.body.innerHTML = `
      <section class="bg-surface-lighter flex flex-col">
        <div id="inner">
          <label><input type="search" class="h-8 pl-11 pr-3"></label>
          <ul>${looseRow('Inner_User')}</ul>
        </div>
        <ul>${looseRow('Outer_User')}</ul>
      </section>`;
    const lifecycle = mountChatters('Outer_User', 'outer-user');

    expect(document.querySelector(ACTIVE_CHATTERS_PANEL_SELECTOR)).toBeNull();
    const badge = document.querySelector<HTMLElement>('.kickflow-active-chatters-badge');
    expect(badge?.textContent).toBe('1 removed');
    expect(document.getElementById('inner')?.contains(badge ?? null)).toBe(false);
    expect(badge?.closest('button')?.textContent).toContain('Outer_User');
    lifecycle.dispose();
  });

  it('attaches when the panel is a div with replaced surface classes', () => {
    document.body.innerHTML = `
      <div class="bg-surface-lighter flex flex-col" id="panel">
        <label><input type="search" class="h-8 pl-11 pr-3"></label>
        <ul>${looseRow('Wrapped_User')}</ul>
      </div>`;
    const lifecycle = mountChatters('Wrapped_User', 'wrapped-user');

    // The fixture panel has no section or dialog ancestor (KickFlow's own mounted panel is elsewhere in the body).
    expect(document.getElementById('panel')?.closest('section')).toBeNull();
    expect(document.getElementById('panel')?.closest('[role="dialog"]')).toBeNull();
    expect(document.querySelector(ACTIVE_CHATTERS_PANEL_SELECTOR)).toBeNull();
    expect(document.getElementById('panel')?.querySelector('.kickflow-active-chatters-badge')?.textContent).toBe('1 removed');
    lifecycle.dispose();
  });

  it('attaches to a dialog wrapper, including a row outside the nearer inner div', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div id="inner">
          <label><input type="search" class="h-8 pl-11 pr-3"></label>
          <ul>${looseRow('Inner_User')}</ul>
        </div>
        <ul>${looseRow('Dialog_User')}</ul>
      </div>`;
    const lifecycle = mountChatters('Dialog_User', 'dialog-user');

    expect(document.querySelector(ACTIVE_CHATTERS_PANEL_SELECTOR)).toBeNull();
    const badge = document.querySelector<HTMLElement>('.kickflow-active-chatters-badge');
    expect(badge?.textContent).toBe('1 removed');
    expect(badge?.closest('[role="dialog"]')).not.toBeNull();
    expect(document.getElementById('inner')?.contains(badge ?? null)).toBe(false);
    lifecycle.dispose();
  });

  it('attaches without warning when chatter rows render 2s after the search input', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <section class="bg-surface-lighter flex flex-col" id="panel">
        <input type="search" class="h-8 pl-11 pr-3">
        <div id="rows"></div>
      </section>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lifecycle = mountChatters('Late_User', 'late-user');

    expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    document.getElementById('rows')!.innerHTML = `<ul>${looseRow('Late_User')}</ul>`;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(document.querySelector('.kickflow-active-chatters-badge')?.textContent).toBe('1 removed');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(warn).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  // 2026-10-15: a search field with no row list used to warn immediately and name the legacy
  // class selector. Rows are allowed to arrive later, so the warning waits 5s and fires once.
  it('warns once, five seconds after the search input, when no chatter rows appear', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <section class="kick-redrew-this-panel">
        <input type="search" class="h-8 pl-11 pr-3">
      </section>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new ChatIntegrityStore();
    const lifecycle = new Lifecycle();
    const removedPanel = new RemovedMessagesPanel(lifecycle, store, statusSnapshot);

    new ActiveChattersBadgesController(lifecycle, store, removedPanel);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(warn).toHaveBeenCalledOnce();
    const text = warn.mock.calls.flat().join(' ');
    expect(text).toContain('no panel containing chatter rows');
    expect(text).toContain('within 5s');
    expect(text).toContain(ACTIVE_CHATTERS_SEARCH_SELECTOR);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(warn).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('does not badge a chatter list that is not an ancestor of the search input', () => {
    document.body.innerHTML = `
      <section class="bg-surface-base flex size-full min-h-0 flex-col overflow-hidden text-white">
        <ul class="flex list-none flex-col overflow-hidden p-0">${chatterRow('Elsewhere_User')}</ul>
      </section>
      <div id="site-search">
        <input type="search" class="h-8 pl-11 pr-3" placeholder="Search">
      </div>`;
    const lifecycle = mountChatters('Elsewhere_User', 'elsewhere-user');

    expect(document.querySelector(ACTIVE_CHATTERS_ROW_SELECTOR)?.textContent).toContain('Elsewhere_User');
    expect(document.querySelector('.kickflow-active-chatters-badge')).toBeNull();
    lifecycle.dispose();
  });
});
