import { afterEach, describe, expect, it } from 'vitest';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function message(id: string, userId: number, content = id): ChatMessage {
  return {
    id,
    chatroomId: 1,
    content,
    type: 'message',
    createdAt: new Date('2026-07-08T19:00:00Z').toISOString(),
    sender: {
      id: userId,
      username: `user${userId}`,
      slug: `user${userId}`,
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

describe('RemovedMessagesPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not show a panel when nothing is preserved', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    new RemovedMessagesPanel(lifecycle, store);

    expect(document.querySelector('.kickflow-ghost-strip')).toBeNull();
    lifecycle.dispose();
  });

  it('shows the panel with the correct count once messages are preserved, starting collapsed', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.addMessage(message('m2', 2, 'deleted text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });
    store.markMessageDeleted('m2');

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();

    const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip');
    expect(section).not.toBeNull();
    expect(section?.classList.contains('kickflow-ghost-strip--collapsed')).toBe(true);
    const toggle = section?.querySelector<HTMLElement>('.kickflow-ghost-strip__toggle');
    expect(toggle?.textContent).toContain('(2)');
    lifecycle.dispose();
  });

  it('clicking the toggle flips the collapsed class and renders rows with sender + status label', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();

    const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip');
    const toggle = section?.querySelector<HTMLElement>('.kickflow-ghost-strip__toggle');
    expect(section?.classList.contains('kickflow-ghost-strip--collapsed')).toBe(true);

    toggle?.click();

    expect(section?.classList.contains('kickflow-ghost-strip--collapsed')).toBe(false);
    const row = section?.querySelector<HTMLElement>('.kickflow-ghost-row');
    expect(row?.textContent).toContain('user1');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('banlandı');
    lifecycle.dispose();
  });

  it('renders a SİLİNDİ status label for a preserved deleted message', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'deleted text'));
    store.markMessageDeleted('m1');

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();
    const toggle = document.querySelector<HTMLElement>('.kickflow-ghost-strip__toggle');
    toggle?.click();

    const row = document.querySelector<HTMLElement>('.kickflow-ghost-row');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('silindi');
    lifecycle.dispose();
  });

  it('has a drag grip in the header that is the makeDraggable handle', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1));
    store.markUserBanned(1);

    new RemovedMessagesPanel(lifecycle, store);

    const header = document.querySelector('.kickflow-ghost-strip__header');
    const grip = document.querySelector('.kickflow-ghost-strip__grip');
    expect(header).not.toBeNull();
    expect(grip).not.toBeNull();
    expect(header?.contains(grip)).toBe(true);
    lifecycle.dispose();
  });

  it('removes the panel from the DOM once the lifecycle is disposed', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1));
    store.markUserBanned(1);

    new RemovedMessagesPanel(lifecycle, store);
    expect(document.querySelector('.kickflow-ghost-strip')).not.toBeNull();

    lifecycle.dispose();

    expect(document.querySelector('.kickflow-ghost-strip')).toBeNull();
  });
});
