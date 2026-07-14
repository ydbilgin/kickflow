import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { NativeChatAugmenter } from '../../src/content/chat/native-augment';
import { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeLifecycle implements Pick<Lifecycle, 'add' | 'setInterval' | 'isDisposed'> {
  readonly disposers: Array<() => void> = [];
  readonly intervals: Array<{ handler: () => void; intervalMs: number }> = [];
  readonly isDisposed = false;

  add(disposer: () => void): void {
    this.disposers.push(disposer);
  }

  setInterval(handler: () => void, intervalMs: number): void {
    this.intervals.push({ handler, intervalMs });
  }
}

function message(id: string, userId = 7, content = 'merhaba @x https://a.b'): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content,
    type: 'message',
    createdAt: new Date().toISOString(),
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

function installChat(rows: string[] = ['m1']): HTMLElement {
  document.body.innerHTML = '<div id="chatroom-messages"><div class="no-scrollbar"></div></div>';
  const list = document.querySelector<HTMLElement>('.no-scrollbar');
  if (!list) throw new Error('missing chat list');
  rows.forEach((id, index) => list.appendChild(makeRow(id, index)));
  return list;
}

function makeRow(id: string, index = 0): HTMLElement {
  const row = document.createElement('div');
  row.dataset.index = String(index);
  row.dataset.kickflowMid = id;
  row.className = 'relative w-full px-2 py-1';
  const group = document.createElement('div');
  group.className = 'group relative flex w-full min-w-0 items-start gap-2';
  const messageShell = document.createElement('div');
  messageShell.className = 'flex min-w-0 max-w-full grow flex-col';
  const identityLine = document.createElement('div');
  identityLine.className = 'flex min-w-0 items-center gap-1 text-sm';
  const username = document.createElement('button');
  username.className = 'truncate font-bold leading-[1.2]';
  username.textContent = `user-${id}`;
  identityLine.append(username);
  const nativeContent = document.createElement('div');
  nativeContent.className = 'break-words text-sm leading-[1.45] line-clamp-2 max-h-12 overflow-hidden';
  const contentBlock = document.createElement('div');
  contentBlock.className = 'min-w-0';
  contentBlock.textContent = `native ${id}`;
  nativeContent.append(contentBlock);
  messageShell.append(identityLine, nativeContent);
  group.append(messageShell);
  row.append(group);
  return row;
}

async function flushObserver(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('NativeChatAugmenter', () => {
  const originalShowDeleted = featureFlags.showDeletedMessages;

  beforeEach(() => {
    featureFlags.showDeletedMessages = true;
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value.replace(/"/g, '\\"') },
    });
  });

  afterEach(() => {
    featureFlags.showDeletedMessages = originalShowDeleted;
    document.body.innerHTML = '';
  });

  it('marks preserved banned messages on demand with original content and status', () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1'));
    store.markUserBanned(7, { permanent: true, bannedBy: 'mod1' });
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');

    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    expect(row?.classList.contains('kickflow-preserved')).toBe(true);
    expect(row?.classList.contains('kickflow-banned')).toBe(true);
    expect(row?.querySelector('.kickflow-original-content')?.textContent).toContain('merhaba @x https://a.b');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('banlandı');
  });

  it('rebuilds rich preserved content beside a nested class-bearing Kick row without copying its utilities', () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'bak [emote:123:kek] https://example.com/duyuru'));
    store.markMessageDeleted('m1');
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');

    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    const nativeContent = row?.querySelector<HTMLElement>('.break-words');
    const preserved = row?.querySelector<HTMLElement>('.kickflow-original-content');
    expect(nativeContent?.classList.contains('line-clamp-2')).toBe(true);
    expect(nativeContent?.classList.contains('kickflow-native-content-dimmed')).toBe(true);
    expect(preserved?.parentElement).toBe(row);
    const emote = preserved?.querySelector<HTMLImageElement>('img.kickflow-emote');
    expect(emote?.alt).toBe('kek');
    expect(emote?.title).toBe('kek');
    expect(preserved?.querySelector('a.kickflow-link')?.textContent).toBe('https://example.com/duyuru');
    expect(preserved?.querySelector('[class*="line-clamp"], .truncate, [class*="max-h-"]')).toBeNull();
  });

  it('uses the correct deleted and timeout labels', () => {
    installChat(['m1', 'm2']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'deleted text'));
    store.addMessage(message('m2', 8, 'timeout text'));
    store.markMessageDeleted('m1');
    store.markUserBanned(8, { permanent: false, durationMin: 90 });
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');
    augmenter.markById('m2');

    const deleted = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    const timeout = document.querySelector<HTMLElement>('[data-kickflow-mid="m2"]');
    expect(deleted?.classList.contains('kickflow-deleted')).toBe(true);
    expect(deleted?.querySelector('.kickflow-status-label')?.textContent).toBe('silindi');
    expect(timeout?.classList.contains('kickflow-timeout')).toBe(true);
    expect(timeout?.querySelector('.kickflow-status-label')?.textContent).toBe('timeout 1sa 30dk');
  });

  it('makes the preserved-inline username clickable like Mode A/removed-panel usernames', () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'deleted text'));
    store.markMessageDeleted('m1');
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');

    const username = document.querySelector<HTMLElement>('.kickflow-preserved-username');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.classList.contains('kickflow-preserved-username--link')).toBe(true);
  });

  it('re-marks remounted rows from the store without another explicit markById call', async () => {
    const list = installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1'));
    store.markUserBanned(7);
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    augmenter.markById('m1');

    document.querySelector('[data-kickflow-mid="m1"]')?.remove();
    const fresh = makeRow('m1', 1);
    list.appendChild(fresh);
    await flushObserver();

    expect(fresh.classList.contains('kickflow-preserved')).toBe(true);
    expect(fresh.querySelector('.kickflow-original-content')?.textContent).toContain('merhaba');
  });

  it('cleans stale preserved markup when a row is recycled to an unpreserved id', async () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1'));
    store.markUserBanned(7);
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    augmenter.markById('m1');
    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    if (!row) throw new Error('missing row');

    row.dataset.kickflowMid = 'm2';
    await flushObserver();

    expect(row.classList.contains('kickflow-preserved')).toBe(false);
    expect(row.querySelector('.kickflow-original-content')).toBeNull();
    expect(row.querySelector('.kickflow-status-label')).toBeNull();
  });

  it('honors showDeletedMessages off while still marking bans', () => {
    featureFlags.showDeletedMessages = false;
    installChat(['m1', 'm2']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'deleted'));
    store.addMessage(message('m2', 8, 'banned'));
    store.markMessageDeleted('m1');
    store.markUserBanned(8);
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');
    augmenter.markById('m2');

    const deleted = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    const banned = document.querySelector<HTMLElement>('[data-kickflow-mid="m2"]');
    expect(deleted?.classList.contains('kickflow-preserved')).toBe(false);
    expect(deleted?.querySelector('.kickflow-original-content')).toBeNull();
    expect(banned?.classList.contains('kickflow-preserved')).toBe(true);
    expect(banned?.classList.contains('kickflow-banned')).toBe(true);
  });

  it('reconciles visible deleted rows when showDeletedMessages changes', () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'deleted'));
    store.markMessageDeleted('m1');
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    if (!row) throw new Error('missing row');

    augmenter.markById('m1');
    expect(row.classList.contains('kickflow-preserved')).toBe(true);
    expect(row.classList.contains('kickflow-deleted')).toBe(true);
    expect(row.querySelector('.kickflow-original-content')).not.toBeNull();

    featureFlags.showDeletedMessages = false;
    augmenter.reconcileAll();

    expect(row.classList.contains('kickflow-preserved')).toBe(false);
    expect(row.classList.contains('kickflow-deleted')).toBe(false);
    expect(row.querySelector('.kickflow-original-content')).toBeNull();
    expect(row.querySelector('.kickflow-status-label')).toBeNull();

    featureFlags.showDeletedMessages = true;
    augmenter.reconcileAll();

    expect(row.classList.contains('kickflow-preserved')).toBe(true);
    expect(row.classList.contains('kickflow-deleted')).toBe(true);
    expect(row.querySelector('.kickflow-original-content')?.textContent).toContain('deleted');
  });

  it('can clear a mounted native row immediately after preservation expires', () => {
    installChat(['m1']);
    let augmenter!: NativeChatAugmenter;
    const store = new ChatIntegrityStore({
      onPreservedEvicted: (expired) => {
        augmenter.forgetGhost(expired.id);
        augmenter.markById(expired.id);
      },
    });
    store.addMessage(message('m1'));
    store.markMessageDeleted('m1');
    augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    augmenter.markById('m1');
    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    expect(row?.classList.contains('kickflow-preserved')).toBe(true);

    store.sweepExpiredPreserved(Date.now() + 10 * 60 * 1000 + 1);

    expect(row?.classList.contains('kickflow-preserved')).toBe(false);
    expect(row?.querySelector('.kickflow-original-content')).toBeNull();
    expect(row?.querySelector('.kickflow-status-label')).toBeNull();
  });

  it('does not keep appending injected content while the observer settles', async () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1'));
    store.markUserBanned(7);
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    augmenter.markById('m1');
    await flushObserver();
    await flushObserver();
    await flushObserver();

    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    expect(row?.querySelectorAll('.kickflow-original-content')).toHaveLength(1);
  });

  it('re-hides a replacement native content holder after Kick changes a deleted row in place', async () => {
    installChat(['m1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 7, 'stored deleted text'));
    store.markMessageDeleted('m1');
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    augmenter.markById('m1');

    const row = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    const oldHolder = row?.querySelector('.break-words');
    const replacement = document.createElement('span');
    replacement.className = 'break-words';
    replacement.textContent = 'Deleted by a moderator';
    oldHolder?.replaceWith(replacement);
    await flushObserver();

    expect(replacement.classList.contains('kickflow-native-content-dimmed')).toBe(true);
    expect(row?.querySelectorAll('.kickflow-original-content')).toHaveLength(1);
    expect(row?.querySelector('.kickflow-original-content')?.textContent).toContain('stored deleted text');
  });

  it('cancels an unstamped-row retry when its session lifecycle is disposed', () => {
    vi.useFakeTimers();
    try {
      const list = installChat([]);
      const row = document.createElement('div');
      row.dataset.index = '0';
      const holder = document.createElement('span');
      holder.className = 'break-words';
      row.append(holder);
      list.append(row);

      const store = new ChatIntegrityStore();
      store.addMessage(message('m1'));
      store.markUserBanned(7);
      const lifecycle = new Lifecycle();
      new NativeChatAugmenter(lifecycle, store);

      lifecycle.dispose();
      row.dataset.kickflowMid = 'm1';
      vi.runAllTimers();

      expect(row.querySelector('.kickflow-original-content')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnects from a detached chat root while waiting for a replacement', async () => {
    const list = installChat([]);
    const root = document.getElementById('chatroom-messages');
    const lifecycle = new FakeLifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1'));
    store.markUserBanned(7);
    new NativeChatAugmenter(lifecycle as unknown as Lifecycle, store);

    root?.remove();
    lifecycle.intervals[0]?.handler();
    const detachedRow = makeRow('m1');
    list.append(detachedRow);
    await flushObserver();

    expect(detachedRow.querySelector('.kickflow-original-content')).toBeNull();
    lifecycle.disposers.forEach((dispose) => dispose());
  });
});
