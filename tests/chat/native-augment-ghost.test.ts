import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { NativeChatAugmenter } from '../../src/content/chat/native-augment';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle as RealLifecycle } from '../../src/content/shared/lifecycle';
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

function message(id: string, userId: number, content = id): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content,
    type: 'message',
    createdAt: new Date('2026-07-07T19:00:00Z').toISOString(),
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

function installChat(rows: string[]): HTMLElement {
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
  const group = document.createElement('div');
  group.className = 'group';
  const nativeContent = document.createElement('span');
  nativeContent.className = 'break-words';
  nativeContent.textContent = `native ${id}`;
  group.appendChild(nativeContent);
  row.appendChild(group);
  return row;
}

async function flushObserver(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('NativeChatAugmenter ghost blocks', () => {
  const originalShowDeleted = featureFlags.showDeletedMessages;
  const originalPreserveBansInline = featureFlags.preserveBansInline;

  beforeEach(() => {
    featureFlags.showDeletedMessages = true;
    featureFlags.preserveBansInline = true;
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value.replace(/"/g, '\\"') },
    });
  });

  afterEach(() => {
    featureFlags.showDeletedMessages = originalShowDeleted;
    featureFlags.preserveBansInline = originalPreserveBansInline;
    document.body.innerHTML = '';
  });

  it('anchors removed banned rows, reasserts after recycle, reanchors, falls back, and keeps deletes intact', async () => {
    const list = installChat(['m1', 'ban1', 'ban2', 'm4']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('ban1', 2, 'first banned'));
    store.addMessage(message('ban2', 2, 'second banned'));
    store.addMessage(message('m4', 4, 'after'));
    store.markUserBanned(2, { permanent: true, bannedBy: 'mod1' });
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    document.querySelector('[data-kickflow-mid="ban1"]')?.remove();
    document.querySelector('[data-kickflow-mid="ban2"]')?.remove();
    await flushObserver();

    const firstAnchor = document.querySelector<HTMLElement>('[data-kickflow-mid="m1"]');
    expect(firstAnchor?.querySelector('.kickflow-ghost-block')?.textContent).toContain('first banned');
    expect(firstAnchor?.querySelector('.kickflow-ghost-block')?.textContent).toContain('second banned');
    const firstText = firstAnchor?.querySelector('.kickflow-ghost-block')?.textContent ?? '';
    expect(firstText.indexOf('first banned')).toBeLessThan(firstText.indexOf('second banned'));
    expect(augmenter.getGhostStats()).toMatchObject({ ghostAnchored: 2, ghostPendingNoAnchor: 0, ghostStrip: 0 });

    firstAnchor?.remove();
    const recycled = makeRow('m1', 10);
    list.appendChild(recycled);
    await flushObserver();

    expect(recycled.querySelector('.kickflow-ghost-block')?.textContent).toContain('first banned');
    expect(recycled.querySelectorAll('[data-kickflow-ghost-mid="ban1"]')).toHaveLength(1);

    recycled.remove();
    await flushObserver();

    const nextAnchor = document.querySelector<HTMLElement>('[data-kickflow-mid="m4"]');
    expect(nextAnchor?.querySelector('.kickflow-ghost-block')?.textContent).toContain('first banned');
    expect(document.querySelectorAll('.kickflow-ghost-block')).toHaveLength(1);

    nextAnchor?.remove();
    await flushObserver();

    // No inline anchor left: both bans are pending re-anchor (still preserved this session). The
    // augmenter no longer owns a panel for these — that's RemovedMessagesPanel's job now (tested
    // separately in removed-panel.test.ts), driven off the same store independent of anchoring.
    expect(document.querySelector('.kickflow-ghost-block')).toBeNull();
    expect(document.querySelector('.kickflow-ghost-strip')).toBeNull();
    expect(augmenter.getGhostStats()).toMatchObject({ ghostAnchored: 0, ghostPendingNoAnchor: 2 });

    const lateAnchor = makeRow('m4', 11);
    list.appendChild(lateAnchor);
    await flushObserver();

    // The bans re-anchor inline once a neighbor row is mounted again.
    expect(lateAnchor.querySelector('.kickflow-ghost-block')?.textContent).toContain('second banned');
    expect(augmenter.getGhostStats()).toMatchObject({ ghostAnchored: 2, ghostPendingNoAnchor: 0 });

    store.addMessage(message('del1', 9, 'deleted text'));
    store.markMessageDeleted('del1');
    const deletedRow = makeRow('del1', 12);
    list.appendChild(deletedRow);
    await flushObserver();

    expect(deletedRow.classList.contains('kickflow-deleted')).toBe(true);
    expect(deletedRow.querySelector('.kickflow-original-content')?.textContent).toContain('deleted text');
  });

  it('makes ghost-row usernames clickable like Mode A/removed-panel usernames', async () => {
    installChat(['m1', 'ban1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('ban1', 2, 'banned text'));
    store.addMessage(message('m3', 3, 'after'));
    store.markUserBanned(2, { permanent: true, bannedBy: 'mod1' });
    new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    document.querySelector('[data-kickflow-mid="ban1"]')?.remove();
    await flushObserver();

    const username = document.querySelector<HTMLElement>('.kickflow-ghost-row__username');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.classList.contains('kickflow-ghost-row__username--link')).toBe(true);
  });

  it('removes ghost state when preserved banned messages are evicted', async () => {
    const list = installChat(['m1', 'ban1']);
    let augmenter: NativeChatAugmenter | null = null;
    const store = new ChatIntegrityStore({
      onPreservedEvicted: (evicted) => augmenter?.forgetGhost(evicted.id),
    });
    store.addMessage(message('m1', 1));
    store.addMessage(message('ban1', 2, 'evicted banned'));
    store.markUserBanned(2);
    augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    document.querySelector('[data-kickflow-mid="ban1"]')?.remove();
    await flushObserver();
    expect(document.querySelector('.kickflow-ghost-block')?.textContent).toContain('evicted banned');

    for (let i = 0; i < 50; i++) {
      store.addMessage(message(`later-${i}`, 100 + i));
      store.markUserBanned(100 + i);
    }
    await flushObserver();

    expect(list.querySelector('[data-kickflow-ghost-mid="ban1"]')).toBeNull();
    expect(augmenter.getGhostStats().ghostEvicted).toBe(1);
  });

  it('never prunes removed-panel rows while re-anchoring inline ghosts', async () => {
    installChat(['m1', 'ban1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('ban1', 2, 'banned text'));
    store.addMessage(message('m3', 3, 'after'));
    store.addMessage(message('deleted1', 4, 'deleted text'));
    store.markUserBanned(2, { permanent: true });
    store.markMessageDeleted('deleted1');
    const panelLifecycle = new RealLifecycle();
    const panel = new RemovedMessagesPanel(panelLifecycle, store);
    panel.render();
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    document.querySelector('[data-kickflow-mid="ban1"]')?.remove();
    await flushObserver();
    augmenter.reconcileAll();
    await flushObserver();

    const panelRows = document.querySelector('.kickflow-panel');
    expect(panelRows?.querySelector('[data-kickflow-ghost-mid="ban1"]')).not.toBeNull();
    expect(panelRows?.querySelector('[data-kickflow-ghost-mid="deleted1"]')).not.toBeNull();
    panelLifecycle.dispose();
  });
});
