// Regression: "KickFlow shows removed (banned / timed out / deleted) messages only sometimes".
// Bug report 2026-10-23 20:52 (kick.com/euryel): the Kaldırılanlar panel listed three bans, the
// native chat showed neither the struck rows nor the moderator notices; 11 s later all appeared.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { handleMessageDeleted, handleUserBanned } from '../../src/content/chat/ban-guard';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { NativeChatAugmenter } from '../../src/content/chat/native-augment';
import type { Lifecycle } from '../../src/content/shared/lifecycle';
import type { ModActionNotice } from '../../src/content/chat/mod-action-feed';

class FakeLifecycle implements Pick<Lifecycle, 'add' | 'setInterval' | 'setTimeout' | 'isDisposed'> {
  readonly disposers: Array<() => void> = [];
  readonly isDisposed = false;
  add(disposer: () => void): void { this.disposers.push(disposer); }
  readonly intervals: Array<() => void> = [];
  /** Recorded, never run by a timer: a test ticks them explicitly with tick(). */
  setInterval(handler: () => void): void { this.intervals.push(handler); }
  tick(): void { this.intervals.forEach((handler) => handler()); }
  setTimeout(handler: () => void, ms: number): void { window.setTimeout(handler, ms); }
}

function message(id: string, userId: number, content = id): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content,
    type: 'message',
    createdAt: new Date('2026-10-23T17:51:00Z').toISOString(),
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

function makeRow(id: string, index: number): HTMLElement {
  const row = document.createElement('div');
  row.dataset.index = String(index);
  row.dataset.kickflowMid = id;
  const group = document.createElement('div');
  group.className = 'group relative flex w-full min-w-0 items-start gap-2';
  const shell = document.createElement('div');
  shell.className = 'flex min-w-0 max-w-full grow flex-col';
  const content = document.createElement('div');
  content.className = 'break-words text-sm';
  content.textContent = `native ${id}`;
  shell.append(content);
  group.append(shell);
  row.append(group);
  return row;
}

function installChat(rows: string[]): HTMLElement {
  document.body.innerHTML = '<div id="chatroom-messages"><div class="no-scrollbar"></div></div>';
  const list = document.querySelector<HTMLElement>('.no-scrollbar')!;
  rows.forEach((id, index) => list.appendChild(makeRow(id, index)));
  return list;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

/** Visible = attached and no ancestor carries the display:none class KickFlow uses to hide native content. */
function visible(element: Element | null): boolean {
  return Boolean(element?.isConnected && !element.closest('.kickflow-native-content-dimmed'));
}

const callbacks = { onJump: () => undefined, onOpenPanel: () => undefined };

function banNotice(id: string, victim: string, messageId: string): ModActionNotice {
  return {
    id,
    kind: 'ban',
    moderator: 'Euryel',
    durationMin: null,
    victims: [{ name: victim, messageId }],
    count: 1,
    messageId,
    firstAt: 1,
    lastAt: 1,
  };
}

describe('removed messages are shown consistently in native chat', () => {
  const original = { ...featureFlags };
  beforeEach(() => {
    featureFlags.showDeletedMessages = true;
    featureFlags.preserveBansInline = true;
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value.replace(/"/g, '\\"') },
    });
  });
  afterEach(() => {
    Object.assign(featureFlags, original);
    document.body.innerHTML = '';
  });

  it('keeps the ban notice visible when the victim wrote the newest row, before and after Kick removes it', async () => {
    // The moderator bans right after the offending line, so the victim's row is the newest row.
    const list = installChat(['m1', 'm2', 'victim1']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('m2', 2, 'also before'));
    store.addMessage(message('victim1', 9, 'offending line'));
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    handleUserBanned({ userId: 9, username: 'user9', permanent: true, bannedBy: 'Euryel' } as never, {
      store,
      augmenter,
      onModAction: () => augmenter.showModActionNotice(banNotice('n1', 'user9', 'victim1'), callbacks),
    });
    await flush();

    // While Kick still shows the row, the struck copy is visible and so is the notice.
    expect(visible(list.querySelector('[data-kickflow-mid="victim1"] .kickflow-original-content'))).toBe(true);
    expect(visible(list.querySelector('.kickflow-modaction-block'))).toBe(true);

    // Kick drops a banned user's rows. No other chat traffic follows (a quiet minute).
    list.querySelector('[data-kickflow-mid="victim1"]')!.remove();
    await flush();

    expect(visible(list.querySelector('[data-kickflow-ghost-mid="victim1"]'))).toBe(true);
    expect(visible(list.querySelector('.kickflow-modaction-block'))).toBe(true);
  });

  it('keeps a deleted message in place when Kick drops its row (live 2026-10-23: Kick removes deleted rows ~1 s later)', async () => {
    const list = installChat(['m1', 'del1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('del1', 5, 'deleted line'));
    store.addMessage(message('m3', 3, 'after'));
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    handleMessageDeleted({ messageId: 'del1', aiModerated: false } as never, { store, augmenter });
    await flush();
    expect(visible(list.querySelector('[data-kickflow-mid="del1"] .kickflow-original-content'))).toBe(true);

    list.querySelector('[data-kickflow-mid="del1"]')!.remove();
    await flush();

    const ghost = list.querySelector('[data-kickflow-ghost-mid="del1"]');
    expect(visible(ghost)).toBe(true);
    expect(ghost?.textContent).toContain('deleted line');
    expect(ghost?.closest('[data-kickflow-mid]')?.getAttribute('data-kickflow-mid')).toBe('m1');
  });

  it('does not ghost a deleted message when showing deleted messages is off', async () => {
    featureFlags.showDeletedMessages = false;
    const list = installChat(['m1', 'del1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('del1', 5, 'deleted line'));
    store.addMessage(message('m3', 3, 'after'));
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    handleMessageDeleted({ messageId: 'del1', aiModerated: false } as never, { store, augmenter });
    list.querySelector('[data-kickflow-mid="del1"]')!.remove();
    await flush();

    expect(list.querySelector('[data-kickflow-ghost-mid="del1"]')).toBeNull();
  });

  it('shows the ghost when Kick removes the victim row before KickFlow receives the ban, in a quiet chat', async () => {
    const list = installChat(['m1', 'victim1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('victim1', 9, 'offending line'));
    store.addMessage(message('m3', 3, 'after'));
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);

    list.querySelector('[data-kickflow-mid="victim1"]')!.remove();
    await flush();
    handleUserBanned({ userId: 9, username: 'user9', permanent: true, bannedBy: 'Euryel' } as never, { store, augmenter });
    await flush();

    expect(visible(list.querySelector('[data-kickflow-ghost-mid="victim1"]'))).toBe(true);
  });

  it('marks a banned user\'s line that arrives just after the ban event (live 2026-10-23: Kick drops it)', async () => {
    let clock = 1_000_000;
    const list = installChat(['m1']);
    const store = new ChatIntegrityStore({ now: () => clock });
    store.addMessage(message('m1', 1, 'before'));
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    handleUserBanned({ userId: 9, username: 'user9', permanent: true, bannedBy: 'Euryel' } as never, { store, augmenter });

    // The line was sent before the ban took effect but its event arrives 320 ms after the ban event.
    clock += 320;
    store.addMessage(message('late1', 9, 'sent before the ban'));
    list.appendChild(makeRow('late1', 1));
    await flush();
    expect(store.getMessageById('late1')).toMatchObject({ preserved: true, preservedReason: 'banned' });
    expect(visible(list.querySelector('[data-kickflow-mid="late1"] .kickflow-original-content'))).toBe(true);

    list.querySelector('[data-kickflow-mid="late1"]')!.remove();
    await flush();
    expect(visible(list.querySelector('[data-kickflow-ghost-mid="late1"]'))).toBe(true);

    // Long after the ban (an expired timeout), a new line from the same user is ordinary chat.
    clock += 60_000;
    store.addMessage(message('later', 9, 'back after a timeout'));
    expect(store.getMessageById('later')?.preserved).toBe(false);
  });

  it('heals within one tick when the chat root is remounted without the banned row (no event reaches the observer)', async () => {
    installChat(['m1', 'victim1', 'm3']);
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'before'));
    store.addMessage(message('victim1', 9, 'offending line'));
    store.addMessage(message('m3', 3, 'after'));
    const lifecycle = new FakeLifecycle();
    const augmenter = new NativeChatAugmenter(lifecycle as unknown as Lifecycle, store);
    handleUserBanned({ userId: 9, username: 'user9', permanent: true, bannedBy: 'Euryel' } as never, { store, augmenter });
    await flush();

    // Kick re-mounts the whole chat (layout change, modal, reconnect): a new #chatroom-messages
    // without the banned row. The old observer never sees a removal record for it.
    const list = installChat(['m1', 'm3']);
    for (let i = 0; i < 3; i++) {
      lifecycle.tick();
      await flush();
    }

    expect(visible(list.querySelector('[data-kickflow-ghost-mid="victim1"]'))).toBe(true);
  });
});
