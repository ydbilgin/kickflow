import { afterEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';

/** Finds a settings row's control by its label text — resilient to row reordering, unlike
 * indexing into querySelectorAll('input')/('select'). */
function settingsControl(section: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement | null {
  const labels = Array.from(section.querySelectorAll<HTMLLabelElement>('.kickflow-ghost-strip__settings label'));
  const label = labels.find((l) => l.querySelector('span')?.textContent === labelText);
  return label?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select') ?? null;
}

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

  describe('quick-settings gear', () => {
    it('header shows grip · toggle · gear, and the gear reveals/hides the settings section', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);

      const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip');
      const header = section?.querySelector('.kickflow-ghost-strip__header');
      const grip = header?.querySelector('.kickflow-ghost-strip__grip');
      const toggle = header?.querySelector('.kickflow-ghost-strip__toggle');
      const gear = header?.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear');
      expect(grip).not.toBeNull();
      expect(toggle).not.toBeNull();
      expect(gear).not.toBeNull();

      const settings = section?.querySelector<HTMLElement>('.kickflow-ghost-strip__settings');
      expect(settings).not.toBeNull();
      expect(settings?.style.display).toBe('none'); // starts hidden

      gear?.click();
      expect(settings?.style.display).toBe('');

      gear?.click();
      expect(settings?.style.display).toBe('none');

      lifecycle.dispose();
    });

    it('settings controls reflect the current featureFlags once opened', () => {
      const originalChatMode = featureFlags.chatMode;
      const originalShowDeleted = featureFlags.showDeletedMessages;
      const originalBanInline = featureFlags.preserveBansInline;
      featureFlags.chatMode = 'own';
      featureFlags.showDeletedMessages = false;
      featureFlags.preserveBansInline = false;

      try {
        const lifecycle = new Lifecycle();
        const store = new ChatIntegrityStore();
        store.addMessage(message('m1', 1));
        store.markUserBanned(1);

        new RemovedMessagesPanel(lifecycle, store);
        const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
        section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();

        const modeSelect = settingsControl(section, 'Chat modu') as HTMLSelectElement;
        const deletedCheckbox = settingsControl(section, 'Silinenleri göster') as HTMLInputElement;
        const banCheckbox = settingsControl(section, 'Ban satır-içi') as HTMLInputElement;
        expect(modeSelect.value).toBe('own');
        expect(deletedCheckbox.checked).toBe(false);
        expect(banCheckbox.checked).toBe(false);

        lifecycle.dispose();
      } finally {
        featureFlags.chatMode = originalChatMode;
        featureFlags.showDeletedMessages = originalShowDeleted;
        featureFlags.preserveBansInline = originalBanInline;
      }
    });

    it('a flag changed elsewhere (e.g. via the popup) is reflected in an already-open settings section on the next render tick', () => {
      const originalShowDeleted = featureFlags.showDeletedMessages;
      featureFlags.showDeletedMessages = true;

      try {
        const lifecycle = new Lifecycle();
        const store = new ChatIntegrityStore();
        store.addMessage(message('m1', 1));
        store.markUserBanned(1);

        const panel = new RemovedMessagesPanel(lifecycle, store);
        const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
        section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();

        const deletedCheckbox = settingsControl(section, 'Silinenleri göster') as HTMLInputElement;
        expect(deletedCheckbox.checked).toBe(true);

        featureFlags.showDeletedMessages = false; // simulate a change made through the popup path
        panel.render(); // the 1s render tick

        expect(deletedCheckbox.checked).toBe(false);

        lifecycle.dispose();
      } finally {
        featureFlags.showDeletedMessages = originalShowDeleted;
      }
    });

    it('toggling "silinenleri göster" dispatches kickflow:setFlag with {key: showDeletedMessages, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
      section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();
      const checkbox = settingsControl(section, 'Silinenleri göster') as HTMLInputElement;

      let received: { key: string; value: unknown } | null = null;
      const listener = (event: Event) => {
        received = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      };
      window.addEventListener('kickflow:setFlag', listener);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      window.removeEventListener('kickflow:setFlag', listener);
      expect(received).toEqual({ key: 'showDeletedMessages', value: true });
      lifecycle.dispose();
    });

    it('toggling "ban satır-içi" dispatches kickflow:setFlag with {key: preserveBansInline, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
      section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();
      const checkbox = settingsControl(section, 'Ban satır-içi') as HTMLInputElement;

      let received: { key: string; value: unknown } | null = null;
      const listener = (event: Event) => {
        received = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      };
      window.addEventListener('kickflow:setFlag', listener);

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      window.removeEventListener('kickflow:setFlag', listener);
      expect(received).toEqual({ key: 'preserveBansInline', value: false });
      lifecycle.dispose();
    });

    it('changing the chat-mode select dispatches kickflow:setFlag with {key: chatMode, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
      section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();
      const select = settingsControl(section, 'Chat modu') as HTMLSelectElement;

      let received: { key: string; value: unknown } | null = null;
      const listener = (event: Event) => {
        received = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      };
      window.addEventListener('kickflow:setFlag', listener);

      select.value = 'own';
      select.dispatchEvent(new Event('change'));

      window.removeEventListener('kickflow:setFlag', listener);
      expect(received).toEqual({ key: 'chatMode', value: 'own' });
      lifecycle.dispose();
    });

    it('the gear/settings do not break the empty-state teardown', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1, 'banned text'));
      store.markUserBanned(1);

      const panel = new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-ghost-strip')!;
      section.querySelector<HTMLButtonElement>('.kickflow-ghost-strip__gear')?.click();
      expect(section.querySelector('.kickflow-ghost-strip__settings')).not.toBeNull();

      // Past the 10-min preserved TTL, relative to the fixed createdAt the `message()` helper uses
      // (not real wall-clock time, which the test run's clock may sit either side of).
      store.sweepExpiredPreserved(new Date('2026-07-08T19:00:00Z').getTime() + 11 * 60 * 1000);
      panel.render();

      expect(document.querySelector('.kickflow-ghost-strip')).toBeNull();
      lifecycle.dispose();
    });
  });
});
