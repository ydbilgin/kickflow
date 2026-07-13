import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';

/** Finds a settings row's control by its label text — resilient to row reordering, unlike
 * indexing into querySelectorAll('input')/('select'). */
function settingsControl(section: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement | null {
  const labels = Array.from(section.querySelectorAll<HTMLLabelElement>('.kickflow-panel__settings label'));
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
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is hidden by default (section present but display:none) even though it already instantiates', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store);

    const section = document.querySelector<HTMLElement>('.kickflow-panel');
    expect(section).not.toBeNull();
    expect(section?.style.display).toBe('none');
    expect(panel.isOpen()).toBe(false);
    lifecycle.dispose();
  });

  it('toggle() opens it (visible) and toggling again closes it', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store);
    const section = document.querySelector<HTMLElement>('.kickflow-panel')!;

    panel.toggle();
    expect(panel.isOpen()).toBe(true);
    expect(section.style.display).toBe('flex');

    panel.toggle();
    expect(panel.isOpen()).toBe(false);
    expect(section.style.display).toBe('none');

    lifecycle.dispose();
  });

  it('removedCount() reflects the store\'s preserved messages, independent of open state', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store);
    expect(panel.removedCount()).toBe(0);

    store.addMessage(message('m1', 1, 'banned text'));
    store.addMessage(message('m2', 2, 'deleted text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });
    store.markMessageDeleted('m2');
    panel.render();

    expect(panel.removedCount()).toBe(2);
    expect(panel.isOpen()).toBe(false); // removedCount() doesn't open it

    const countChip = document.querySelector<HTMLElement>('.kickflow-panel__count');
    expect(countChip?.textContent).toBe('2');
    lifecycle.dispose();
  });

  it('shows rows with sender + status label once opened', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();
    panel.toggle();

    const section = document.querySelector<HTMLElement>('.kickflow-panel');
    const row = section?.querySelector<HTMLElement>('.kickflow-ghost-row');
    expect(row?.textContent).toContain('user1');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('banlandı');
    lifecycle.dispose();
  });

  it('opens a removed-panel username in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();
    panel.toggle();

    const row = document.querySelector<HTMLElement>('.kickflow-ghost-row');
    const username = row?.querySelector<HTMLElement>('.kickflow-ghost-row__username');
    expect(username?.tagName).toBe('SPAN');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.tabIndex).toBe(0);
    expect(username?.classList.contains('kickflow-ghost-row__username--link')).toBe(true);

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(row?.querySelector('a[href*="kick.com"]')).toBeNull();
    open.mockRestore();
    lifecycle.dispose();
  });

  it('renders a SİLİNDİ status label for a preserved deleted message', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'deleted text'));
    store.markMessageDeleted('m1', { deletedBy: 'modname' });

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();
    panel.toggle();

    const row = document.querySelector<HTMLElement>('.kickflow-ghost-row');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('silindi');
    expect(row?.querySelector('.kickflow-mod-label')?.textContent).toBe('· modname');
    lifecycle.dispose();
  });

  it('rebuilds an existing row when later moderation metadata adds the deleting moderator', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'deleted text'));
    store.markMessageDeleted('m1', { aiModerated: false });

    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.render();
    panel.toggle();
    expect(document.querySelector('.kickflow-mod-label')?.textContent).toBe('· mod');

    store.markMessageDeleted('m1', { deletedBy: 'modname' });
    panel.render();

    expect(document.querySelector('.kickflow-mod-label')?.textContent).toBe('· modname');
    lifecycle.dispose();
  });

  it('shows the empty placeholder once opened with nothing preserved', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.toggle();

    const empty = document.querySelector<HTMLElement>('.kickflow-ghost-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('henüz kaldırılan mesaj yok');
    lifecycle.dispose();
  });

  it('the × close button calls toggle() (closes)', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.toggle();
    expect(panel.isOpen()).toBe(true);

    const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
    const close = section.querySelector<HTMLButtonElement>('.kickflow-panel__close');
    expect(close).not.toBeNull();
    close?.click();

    expect(panel.isOpen()).toBe(false);
    expect(section.style.display).toBe('none');
    lifecycle.dispose();
  });

  it('removes the panel from the DOM once the lifecycle is disposed', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1));
    store.markUserBanned(1);

    new RemovedMessagesPanel(lifecycle, store);
    expect(document.querySelector('.kickflow-panel')).not.toBeNull();

    lifecycle.dispose();

    expect(document.querySelector('.kickflow-panel')).toBeNull();
  });

  it('repopulates unchanged rows when its body-level section is externally removed', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const item = message('self-heal', 7);
    store.addMessage(item);
    store.markMessageDeleted(item.id);
    const panel = new RemovedMessagesPanel(lifecycle, store);
    panel.toggle();
    expect(document.querySelector('.kickflow-ghost-row')?.textContent).toContain('self-heal');

    document.querySelector('.kickflow-panel')?.remove();
    panel.render();

    expect(document.querySelector('.kickflow-ghost-row')?.textContent).toContain('self-heal');
    lifecycle.dispose();
  });

  describe('whole-header drag', () => {
    it('a mousedown on the header background repositions it to explicit left/top (drag-anchor switch fires)', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      new RemovedMessagesPanel(lifecycle, store);

      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      const header = section.querySelector<HTMLElement>('.kickflow-panel__header')!;
      expect(section.style.left).toBe('');

      header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

      expect(section.style.right).toBe('auto');
      expect(section.style.bottom).toBe('auto');
      expect(section.style.left).not.toBe('');
      expect(section.style.top).not.toBe('');
      lifecycle.dispose();
    });

    it('a mousedown landing on the ⚙/× buttons or a settings control does NOT trigger the drag-anchor switch', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      new RemovedMessagesPanel(lifecycle, store);

      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      const gear = section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')!;

      gear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

      expect(section.style.left).toBe('');
      expect(section.style.right).toBe('');
      lifecycle.dispose();
    });
  });

  describe('quick-settings gear', () => {
    it('header shows title · count · ⚙ · ×, and the gear reveals/hides the settings section', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);

      const section = document.querySelector<HTMLElement>('.kickflow-panel');
      const header = section?.querySelector('.kickflow-panel__header');
      const title = header?.querySelector('.kickflow-panel__title');
      const gear = header?.querySelector<HTMLButtonElement>('.kickflow-panel__gear');
      const close = header?.querySelector<HTMLButtonElement>('.kickflow-panel__close');
      expect(title?.textContent).toBe('Kaldırılanlar');
      expect(gear).not.toBeNull();
      expect(close).not.toBeNull();

      const settings = section?.querySelector<HTMLElement>('.kickflow-panel__settings');
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
      const originalSubscriptions = featureFlags.showSubscriptions;
      const originalGiftedSubs = featureFlags.showGiftedSubs;
      const originalHostRaid = featureFlags.showHostRaid;
      const originalPinnedMessage = featureFlags.showPinnedMessage;
      const originalModeChanges = featureFlags.showModeChanges;
      const originalAutoTheater = featureFlags.autoTheater;
      featureFlags.chatMode = 'own';
      featureFlags.showDeletedMessages = false;
      featureFlags.preserveBansInline = false;
      featureFlags.showSubscriptions = false;
      featureFlags.showGiftedSubs = true;
      featureFlags.showHostRaid = false;
      featureFlags.showPinnedMessage = true;
      featureFlags.showModeChanges = false;
      featureFlags.autoTheater = true;

      try {
        const lifecycle = new Lifecycle();
        const store = new ChatIntegrityStore();
        store.addMessage(message('m1', 1));
        store.markUserBanned(1);

        new RemovedMessagesPanel(lifecycle, store);
        const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
        section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();

        const modeSelect = settingsControl(section, 'Chat modu') as HTMLSelectElement;
        const deletedCheckbox = settingsControl(section, 'Silinenleri göster') as HTMLInputElement;
        const banCheckbox = settingsControl(section, 'Ban satır-içi') as HTMLInputElement;
        const subscriptionsCheckbox = settingsControl(section, 'Abonelikler') as HTMLInputElement;
        const giftedSubsCheckbox = settingsControl(section, 'Hediye abonelikler') as HTMLInputElement;
        const hostRaidCheckbox = settingsControl(section, 'Host / Raid') as HTMLInputElement;
        const pinnedMessageCheckbox = settingsControl(section, 'Sabitlenmiş mesaj') as HTMLInputElement;
        const modeChangesCheckbox = settingsControl(section, 'Mod değişiklikleri') as HTMLInputElement;
        const autoTheaterCheckbox = settingsControl(section, 'Otomatik tiyatro modu') as HTMLInputElement;
        expect(modeSelect.value).toBe('own');
        expect(deletedCheckbox.checked).toBe(false);
        expect(banCheckbox.checked).toBe(false);
        expect(subscriptionsCheckbox.checked).toBe(false);
        expect(giftedSubsCheckbox.checked).toBe(true);
        expect(hostRaidCheckbox.checked).toBe(false);
        expect(pinnedMessageCheckbox.checked).toBe(true);
        expect(modeChangesCheckbox.checked).toBe(false);
        expect(autoTheaterCheckbox.checked).toBe(true);

        lifecycle.dispose();
      } finally {
        featureFlags.chatMode = originalChatMode;
        featureFlags.showDeletedMessages = originalShowDeleted;
        featureFlags.preserveBansInline = originalBanInline;
        featureFlags.showSubscriptions = originalSubscriptions;
        featureFlags.showGiftedSubs = originalGiftedSubs;
        featureFlags.showHostRaid = originalHostRaid;
        featureFlags.showPinnedMessage = originalPinnedMessage;
        featureFlags.showModeChanges = originalModeChanges;
        featureFlags.autoTheater = originalAutoTheater;
      }
    });

    it('a flag changed elsewhere (e.g. via the popup) is reflected in an already-open settings section on the next render tick', () => {
      const originalSubscriptions = featureFlags.showSubscriptions;
      featureFlags.showSubscriptions = true;

      try {
        const lifecycle = new Lifecycle();
        const store = new ChatIntegrityStore();
        store.addMessage(message('m1', 1));
        store.markUserBanned(1);

        const panel = new RemovedMessagesPanel(lifecycle, store);
        const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
        section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();

        const subscriptionsCheckbox = settingsControl(section, 'Abonelikler') as HTMLInputElement;
        expect(subscriptionsCheckbox.checked).toBe(true);

        featureFlags.showSubscriptions = false; // simulate a change made through the popup path
        panel.render(); // the 1s render tick

        expect(subscriptionsCheckbox.checked).toBe(false);

        lifecycle.dispose();
      } finally {
        featureFlags.showSubscriptions = originalSubscriptions;
      }
    });

    it('toggling "silinenleri göster" dispatches kickflow:setFlag with {key: showDeletedMessages, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();
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
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();
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

    it.each([
      ['Abonelikler', 'showSubscriptions'],
      ['Hediye abonelikler', 'showGiftedSubs'],
      ['Host / Raid', 'showHostRaid'],
      ['Sabitlenmiş mesaj', 'showPinnedMessage'],
      ['Mod değişiklikleri', 'showModeChanges'],
      ['Otomatik tiyatro modu', 'autoTheater'],
    ] as const)('toggling "%s" dispatches kickflow:setFlag with {key: %s, value}', (label, key) => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();
      const checkbox = settingsControl(section, label) as HTMLInputElement;

      let received: { key: string; value: unknown } | null = null;
      const listener = (event: Event) => {
        received = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      };
      window.addEventListener('kickflow:setFlag', listener);

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      window.removeEventListener('kickflow:setFlag', listener);
      expect(received).toEqual({ key, value: false });
      lifecycle.dispose();
    });

    it('changing the chat-mode select dispatches kickflow:setFlag with {key: chatMode, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();
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

    it('stays present (hidden) when the store empties; only lifecycle disposes it', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1, 'banned text'));
      store.markUserBanned(1);

      const panel = new RemovedMessagesPanel(lifecycle, store);
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      section.querySelector<HTMLButtonElement>('.kickflow-panel__gear')?.click();
      expect(section.querySelector('.kickflow-panel__settings')).not.toBeNull();

      // Past the 10-min preservation TTL, measured from preservation rather than send time.
      store.sweepExpiredPreserved((store.getMessageById('m1')?.preservedAt ?? Date.now()) + 11 * 60 * 1000);
      panel.render();

      const still = document.querySelector<HTMLElement>('.kickflow-panel');
      expect(still).not.toBeNull();
      expect(panel.removedCount()).toBe(0);
      lifecycle.dispose();
      expect(document.querySelector('.kickflow-panel')).toBeNull();
    });
  });
});
