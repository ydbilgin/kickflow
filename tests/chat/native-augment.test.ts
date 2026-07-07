import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { NativeChatAugmenter } from '../../src/content/chat/native-augment';
import type { Lifecycle } from '../../src/content/shared/lifecycle';

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
  const nativeContent = document.createElement('span');
  nativeContent.className = 'break-words';
  nativeContent.textContent = `native ${id}`;
  row.appendChild(nativeContent);
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
});
