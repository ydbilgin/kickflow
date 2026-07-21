import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { getHotkeyBindings, resetHotkeyBindings } from '../../src/content/player/hotkey-registry';
import type { KickFlowStatusSnapshot, StatusSnapshotProvider } from '../../src/content/status';
import { setLang } from '../../src/content/shared/i18n';

function statusSnapshot(overrides: Partial<KickFlowStatusSnapshot> = {}): KickFlowStatusSnapshot {
  return {
    slug: null,
    chatroomId: null,
    active: false,
    reason: 'kanal sayfası değil',
    pusherConnected: false,
    lastBanAt: null,
    messageCount: 0,
    preservedCount: 0,
    bannedCount: 0,
    deletedCount: 0,
    ghostAnchored: 0,
    ghostPendingNoAnchor: 0,
    ghostStrip: 0,
    ghostEvicted: 0,
    ...overrides,
  };
}

const getTestStatusSnapshot: StatusSnapshotProvider = () => statusSnapshot();

/** Finds a settings row's control by its label text — resilient to row reordering, unlike
 * indexing into querySelectorAll('input')/('select'). */
function settingsControl(section: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement | null {
  const labels = Array.from(section.querySelectorAll<HTMLLabelElement>('.kickflow-panel__settings label'));
  const label = labels.find((l) => l.querySelector('span')?.textContent === labelText);
  return label?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select') ?? null;
}

type TestDashboardSection = 'general' | 'removed' | 'chat' | 'player' | 'hotkeys' | 'about';

function openDashboardSection(
  panel: RemovedMessagesPanel,
  key: TestDashboardSection,
): { modal: HTMLElement; pane: HTMLElement } {
  panel.showSettings();
  const modal = document.querySelector<HTMLElement>('.kickflow-panel');
  expect(modal).not.toBeNull();
  const navButton = modal!.querySelector<HTMLButtonElement>(`.kickflow-panel__nav-item[data-section="${key}"]`);
  expect(navButton).not.toBeNull();
  navButton!.click();
  const pane = modal!.querySelector<HTMLElement>(`.kickflow-panel__section[data-section="${key}"]`);
  expect(pane).not.toBeNull();
  expect(pane!.hidden).toBe(false);
  expect(navButton!.getAttribute('aria-current')).toBe('page');
  return { modal: modal!, pane: pane! };
}

function requiredSettingsControl<T extends HTMLInputElement | HTMLSelectElement>(
  pane: HTMLElement,
  labelText: string,
): T {
  const control = settingsControl(pane, labelText);
  expect(control).not.toBeNull();
  return control as T;
}

function requiredStatValue(pane: HTMLElement, labelText: string): HTMLElement {
  const row = Array.from(pane.querySelectorAll<HTMLElement>('.kickflow-panel__stat'))
    .find((candidate) => candidate.querySelector('dt')?.textContent === labelText);
  expect(row).not.toBeUndefined();
  const value = row!.querySelector<HTMLElement>('dd');
  expect(value).not.toBeNull();
  return value!;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
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
  const originalFlags = { ...featureFlags };
  beforeAll(() => setLang('tr'));
  afterEach(() => {
    Object.assign(featureFlags, originalFlags);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('switches the open dashboard between English and Turkish from General', () => {
    setLang('en');
    const lifecycle = new Lifecycle();
    const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
    panel.showSettings('general');
    let section = document.querySelector<HTMLElement>('.kickflow-panel')!;
    expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('General');

    const language = settingsControl(section, 'Language') as HTMLSelectElement;
    expect(language.value).toBe('en');
    language.value = 'tr';
    language.dispatchEvent(new Event('change', { bubbles: true }));

    section = document.querySelector<HTMLElement>('.kickflow-panel')!;
    expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Genel');
    expect((settingsControl(section, 'Dil') as HTMLSelectElement).value).toBe('tr');
    lifecycle.dispose();
  });

  it('is hidden by default (section present but display:none) even though it already instantiates', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);

    const section = document.querySelector<HTMLElement>('.kickflow-panel');
    expect(section).not.toBeNull();
    expect(section?.style.display).toBe('none');
    expect(panel.isOpen()).toBe(false);
    lifecycle.dispose();
  });

  it('toggle() opens it (visible) and toggling again closes it', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    const section = document.querySelector<HTMLElement>('.kickflow-panel')!;

    panel.toggle();
    expect(panel.isOpen()).toBe(true);
    expect(section.style.display).toBe('flex');

    panel.toggle();
    expect(panel.isOpen()).toBe(false);
    expect(section.style.display).toBe('none');

    lifecycle.dispose();
  });

  it('toggle("removed") opens directly on Kaldırılanlar and toggles that view closed', () => {
    const lifecycle = new Lifecycle();
    const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
    const section = document.querySelector<HTMLElement>('.kickflow-panel')!;

    panel.toggle('removed');
    expect(panel.isOpen()).toBe(true);
    expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Kaldırılanlar');
    expect(section.querySelector<HTMLElement>('.kickflow-panel__section[data-section="removed"]')?.hidden).toBe(false);

    panel.toggle('removed');
    expect(panel.isOpen()).toBe(false);
    lifecycle.dispose();
  });

  it('removedCount() reflects the store\'s preserved messages, independent of open state', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
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

  it('opens Removed with a canonical-slug filter and clears it from the bilingual chip', () => {
    setLang('en');
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const first = message('user-one-message', 1, 'first removed text');
    first.sender.slug = 'canonical-one';
    first.sender.username = 'User_One';
    const second = message('user-two-message', 2, 'second removed text');
    second.sender.slug = 'canonical-two';
    second.sender.username = 'User_Two';
    store.addMessage(first);
    store.addMessage(second);
    store.markUserBanned(1);
    store.markMessageDeleted(second.id);
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);

    panel.showUserFilter('  CANONICAL-ONE ', 'User_One');

    const modal = requiredElement<HTMLElement>(document, '.kickflow-panel');
    const chip = requiredElement<HTMLButtonElement>(modal, '.kickflow-panel__filter-chip');
    expect(panel.isOpen()).toBe(true);
    expect(modal.querySelector('.kickflow-panel__title')?.textContent).toBe('Removed');
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('Filtered: User_One ×');
    expect(Array.from(modal.querySelectorAll<HTMLElement>('.kickflow-removed-row')).map((row) => row.dataset.kickflowRemovedMid))
      .toEqual(['user-one-message']);

    chip.click();
    expect(chip.hidden).toBe(true);
    expect(Array.from(modal.querySelectorAll<HTMLElement>('.kickflow-removed-row')).map((row) => row.dataset.kickflowRemovedMid))
      .toEqual(['user-two-message', 'user-one-message']);

    lifecycle.dispose();
    setLang('tr');
  });

  it('shows rows with sender + status label once opened', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });

    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.render();
    panel.toggle();

    const section = document.querySelector<HTMLElement>('.kickflow-panel');
    const row = section?.querySelector<HTMLElement>('.kickflow-removed-row');
    expect(row?.textContent).toContain('user1');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('BANLANDI');
    lifecycle.dispose();
  });

  it('renders removed-row emotes with their typeable shortcut as alt and hover text', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'bak [emote:789:HYPERCLAP]'));
    store.markMessageDeleted('m1');

    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.render();
    panel.toggle();

    const emote = document.querySelector<HTMLImageElement>('.kickflow-removed-row__content img.kickflow-emote');
    expect(emote?.alt).toBe('HYPERCLAP');
    expect(emote?.title).toBe('HYPERCLAP');
    lifecycle.dispose();
  });

  it('opens a removed-panel username in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'banned text'));
    store.markUserBanned(1, { permanent: true, bannedBy: 'mod1' });

    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.render();
    panel.toggle();

    const row = document.querySelector<HTMLElement>('.kickflow-removed-row');
    const username = row?.querySelector<HTMLElement>('.kickflow-removed-row__username');
    expect(username?.tagName).toBe('SPAN');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.tabIndex).toBe(0);
    expect(username?.classList.contains('kickflow-removed-row__username--link')).toBe(true);

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

    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.render();
    panel.toggle();

    const row = document.querySelector<HTMLElement>('.kickflow-removed-row');
    expect(row?.querySelector('.kickflow-status-label')?.textContent).toBe('SİLİNDİ');
    expect(row?.querySelector('.kickflow-mod-label')?.textContent).toBe('· modname');
    lifecycle.dispose();
  });

  it('rebuilds an existing row when later moderation metadata adds the deleting moderator', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1, 'deleted text'));
    store.markMessageDeleted('m1', { aiModerated: false });

    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
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
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.toggle();

    const empty = document.querySelector<HTMLElement>('.kickflow-removed-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('Henüz kaldırılan mesaj yok');
    lifecycle.dispose();
  });

  it('the × close button calls toggle() (closes)', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.toggle();
    expect(panel.isOpen()).toBe(true);

    const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
    const close = section.querySelector<HTMLButtonElement>('.kickflow-panel__close');
    expect(close).not.toBeNull();
    close!.click();

    expect(panel.isOpen()).toBe(false);
    expect(section.style.display).toBe('none');
    expect(document.activeElement).toBe(opener);
    lifecycle.dispose();
  });

  it('removes the panel from the DOM once the lifecycle is disposed', () => {
    const lifecycle = new Lifecycle();
    const store = new ChatIntegrityStore();
    store.addMessage(message('m1', 1));
    store.markUserBanned(1);

    new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
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
    const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
    panel.toggle();
    expect(document.querySelector('.kickflow-removed-row')?.textContent).toContain('self-heal');

    document.querySelector('.kickflow-panel')?.remove();
    panel.render();

    expect(document.querySelector('.kickflow-removed-row')?.textContent).toContain('self-heal');
    lifecycle.dispose();
  });

  describe('dashboard structure and modal interaction', () => {
    it('builds one labelled modal with all six panes and switches sections in place', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      panel.showSettings();

      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      const dialog = section.querySelector<HTMLElement>('[role="dialog"]')!;
      const buttons = Array.from(section.querySelectorAll<HTMLButtonElement>('.kickflow-panel__nav-item'));

      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('kickflow-dashboard-title');
      expect(buttons.map((button) => button.textContent)).toEqual([
        'Genel', 'Kaldırılanlar', 'Sohbet', 'Oynatıcı', 'Kısayollar', 'Hakkında',
      ]);
      expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Genel');
      expect(section.querySelector<HTMLElement>('.kickflow-panel__section[data-section="general"]')?.hidden).toBe(false);

      buttons.find((button) => button.dataset.section === 'hotkeys')?.click();

      expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Kısayollar');
      expect(section.querySelector<HTMLElement>('.kickflow-panel__section[data-section="general"]')?.hidden).toBe(true);
      expect(section.querySelector<HTMLElement>('.kickflow-panel__section[data-section="hotkeys"]')?.hidden).toBe(false);
      expect(buttons.find((button) => button.dataset.section === 'hotkeys')?.getAttribute('aria-current')).toBe('page');
      lifecycle.dispose();
    });

    it('keeps the moderation log out of Genel and renders it only in Kaldırılanlar', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('removed-only', 4, 'yalnızca log görünümünde'));
      store.markUserBanned(4, { permanent: true, bannedBy: 'mod4' });
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);

      const general = openDashboardSection(panel, 'general').pane;
      expect(general.querySelector('.kickflow-panel__removed-list')).toBeNull();

      const removed = openDashboardSection(panel, 'removed').pane;
      expect(removed.querySelector('.kickflow-removed-row')?.textContent).toContain('yalnızca log görünümünde');
      lifecycle.dispose();
    });

    it('renders newest messages first with distinct action metadata and original content', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('oldest', 1, 'ilk mesaj'));
      store.addMessage(message('middle', 2, 'ikinci mesaj'));
      store.addMessage(message('newest', 3, 'son mesaj'));
      store.markUserBanned(1, { permanent: true, bannedBy: 'banmod' });
      store.markMessageDeleted('middle', { deletedBy: 'deletemod' });
      store.markUserBanned(3, { permanent: false, durationMin: 10, bannedBy: 'timeoutmod' });
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const removed = openDashboardSection(panel, 'removed').pane;
      const rows = Array.from(removed.querySelectorAll<HTMLElement>('.kickflow-removed-row'));

      expect(rows.map((row) => row.dataset.kickflowRemovedMid)).toEqual(['newest', 'middle', 'oldest']);
      expect(rows[0].querySelector('.kickflow-removed-row__content')?.textContent).toBe('son mesaj');
      expect(rows[0].querySelector('.kickflow-status-label--timeout')?.textContent).toBe('TIMEOUT 10DK');
      expect(rows[0].querySelector('.kickflow-mod-label')?.textContent).toBe('· timeoutmod');
      expect(rows[1].querySelector('.kickflow-status-label--deleted')?.textContent).toBe('SİLİNDİ');
      expect(rows[2].querySelector('.kickflow-status-label--banned')?.textContent).toBe('BANLANDI');
      lifecycle.dispose();
    });

    it('renders the exact shared live snapshot counters, including all three ghost values', () => {
      const lifecycle = new Lifecycle();
      const snapshot = statusSnapshot({
        slug: 'snapshot-channel',
        chatroomId: null,
        active: true,
        pusherConnected: true,
        messageCount: 41,
        preservedCount: 7,
        bannedCount: 4,
        deletedCount: 3,
        ghostAnchored: 2,
        ghostPendingNoAnchor: 5,
        ghostEvicted: 9,
      });
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), () => snapshot);
      const general = openDashboardSection(panel, 'general').pane;

      expect(requiredStatValue(general, 'Mesaj').textContent).toBe('41');
      expect(requiredStatValue(general, 'Korunmuş').textContent).toBe('7');
      expect(requiredStatValue(general, 'Ban').textContent).toBe('4');
      expect(requiredStatValue(general, 'Silme').textContent).toBe('3');
      expect(requiredStatValue(general, 'Ghost inline').textContent).toBe('2');
      expect(requiredStatValue(general, 'Ghost bekleyen').textContent).toBe('5');
      expect(requiredStatValue(general, 'Ghost evict').textContent).toBe('9');
      const missingChatroom = requiredStatValue(general, 'Chatroom ID');
      expect(missingChatroom.textContent).toBe('—');
      expect(missingChatroom.classList.contains('kickflow-panel__stat-value--missing')).toBe(true);
      lifecycle.dispose();
    });

    it('gives every hotkey change button an action-specific accessible name', () => {
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
      const hotkeys = openDashboardSection(panel, 'hotkeys').pane;
      const names = Array.from(
        hotkeys.querySelectorAll<HTMLButtonElement>('.kickflow-panel__hotkey-change'),
        (button) => button.getAttribute('aria-label'),
      );

      expect(names).toEqual([
        '10 sn geri kısayolunu değiştir',
        '10 sn ileri kısayolunu değiştir',
        'Ekran görüntüsü kısayolunu değiştir',
        'Canlıya dön kısayolunu değiştir',
      ]);
      expect(new Set(names).size).toBe(4);
      lifecycle.dispose();
    });

    it('closes on Escape and returns focus to the element that opened it', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      panel.showSettings();

      expect(document.activeElement?.classList.contains('kickflow-panel__close')).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(panel.isOpen()).toBe(false);
      expect(document.activeElement).toBe(opener);
      lifecycle.dispose();
    });

    it('closes on a backdrop click but not on a click inside the dialog', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      panel.showSettings();
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      const dialog = section.querySelector<HTMLElement>('.kickflow-panel__shell')!;

      dialog.click();
      expect(panel.isOpen()).toBe(true);

      section.click();
      expect(panel.isOpen()).toBe(false);
      expect(document.activeElement).toBe(opener);

      lifecycle.dispose();
    });

    it.each(['Escape', 'backdrop'] as const)(
      'returns focus to a self-healed launcher replacement after %s close',
      (closePath) => {
        const lifecycle = new Lifecycle();
        const opener = document.createElement('button');
        opener.id = 'kickflow-footer-toggle';
        document.body.append(opener);
        opener.focus();
        const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
        panel.showSettings();

        const replacement = document.createElement('button');
        replacement.id = opener.id;
        opener.replaceWith(replacement);
        if (closePath === 'Escape') {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        } else {
          const backdrop = document.querySelector<HTMLElement>('.kickflow-panel');
          expect(backdrop).not.toBeNull();
          backdrop!.click();
        }

        expect(panel.isOpen()).toBe(false);
        expect(document.activeElement).toBe(replacement);
        lifecycle.dispose();
      },
    );

    it('locks background scrolling and restores exact prior overflow on close and dispose', () => {
      document.documentElement.style.overflow = 'clip';
      document.body.style.overflow = 'scroll';
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);

      panel.showSettings();
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.body.style.overflow).toBe('hidden');
      panel.toggle();
      expect(document.documentElement.style.overflow).toBe('clip');
      expect(document.body.style.overflow).toBe('scroll');

      panel.showSettings();
      lifecycle.dispose();
      expect(document.documentElement.style.overflow).toBe('clip');
      expect(document.body.style.overflow).toBe('scroll');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    });

    it('traps Tab focus inside the open dashboard', () => {
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
      panel.showSettings();
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      const first = section.querySelector<HTMLButtonElement>('.kickflow-panel__nav-item')!;
      const last = settingsControl(section, 'Dil') as HTMLSelectElement;

      last.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(first);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(last);
      lifecycle.dispose();
    });
  });

  describe('dashboard settings controls', () => {

    it('settings controls reflect the current featureFlags once opened', () => {
      const originalChatMode = featureFlags.chatMode;
      const originalShowDeleted = featureFlags.showDeletedMessages;
      const originalBanInline = featureFlags.preserveBansInline;
      const originalSubscriptions = featureFlags.showSubscriptions;
      const originalGiftedSubs = featureFlags.showGiftedSubs;
      const originalHostRaid = featureFlags.showHostRaid;
      const originalModeChanges = featureFlags.showModeChanges;
      const originalAutoTheater = featureFlags.autoTheater;
      const originalCaptionGuard = featureFlags.captionGuard;
      featureFlags.chatMode = 'own';
      featureFlags.showDeletedMessages = false;
      featureFlags.preserveBansInline = false;
      featureFlags.showSubscriptions = false;
      featureFlags.showGiftedSubs = true;
      featureFlags.showHostRaid = false;
      featureFlags.showModeChanges = false;
      featureFlags.autoTheater = true;
      featureFlags.captionGuard = false;

      try {
        const lifecycle = new Lifecycle();
        const store = new ChatIntegrityStore();
        store.addMessage(message('m1', 1));
        store.markUserBanned(1);

        const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
        const general = openDashboardSection(panel, 'general').pane;
        const modeSelect = requiredSettingsControl<HTMLSelectElement>(general, 'Chat modu');
        const chat = openDashboardSection(panel, 'chat').pane;
        const deletedCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Silinenleri göster');
        const banCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Ban satır-içi');
        const subscriptionsCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Abonelikler');
        const giftedSubsCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Hediye abonelikler');
        const hostRaidCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Host / Raid');
        const modeChangesCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Mod değişiklikleri');
        const player = openDashboardSection(panel, 'player').pane;
        const autoTheaterCheckbox = requiredSettingsControl<HTMLInputElement>(player, 'Otomatik tiyatro modu');
        const captionGuardCheckbox = requiredSettingsControl<HTMLInputElement>(player, 'Altyazıyı varsayılan olarak kapalı tut');
        expect(modeSelect.value).toBe('own');
        expect(deletedCheckbox.checked).toBe(false);
        expect(banCheckbox.checked).toBe(false);
        expect(subscriptionsCheckbox.checked).toBe(false);
        expect(giftedSubsCheckbox.checked).toBe(true);
        expect(hostRaidCheckbox.checked).toBe(false);
        expect(modeChangesCheckbox.checked).toBe(false);
        expect(autoTheaterCheckbox.checked).toBe(true);
        expect(captionGuardCheckbox.checked).toBe(false);

        lifecycle.dispose();
      } finally {
        featureFlags.chatMode = originalChatMode;
        featureFlags.showDeletedMessages = originalShowDeleted;
        featureFlags.preserveBansInline = originalBanInline;
        featureFlags.showSubscriptions = originalSubscriptions;
        featureFlags.showGiftedSubs = originalGiftedSubs;
        featureFlags.showHostRaid = originalHostRaid;
        featureFlags.showModeChanges = originalModeChanges;
        featureFlags.autoTheater = originalAutoTheater;
        featureFlags.captionGuard = originalCaptionGuard;
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

        const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
        const chat = openDashboardSection(panel, 'chat').pane;
        const subscriptionsCheckbox = requiredSettingsControl<HTMLInputElement>(chat, 'Abonelikler');
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

      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const chat = openDashboardSection(panel, 'chat').pane;
      const checkbox = requiredSettingsControl<HTMLInputElement>(chat, 'Silinenleri göster');

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

      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const chat = openDashboardSection(panel, 'chat').pane;
      const checkbox = requiredSettingsControl<HTMLInputElement>(chat, 'Ban satır-içi');

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
      ['Kicks / bağışlar', 'showKicks'],
      ['Host / Raid', 'showHostRaid'],
      ['Mod değişiklikleri', 'showModeChanges'],
      ['Aktif sohbetçi rozetleri', 'showChattersBadges'],
      ['Bana yanıt verildiğinde / benden bahsedildiğinde vurgula', 'mentionHighlightEnabled'],
      ['Moderatör mesajlarını vurgula', 'modFrameEnabled'],
      ['VIP mesajlarını vurgula', 'vipFrameEnabled'],
      ['Otomatik tiyatro modu', 'autoTheater'],
      ['Altyazıyı varsayılan olarak kapalı tut', 'captionGuard'],
      ['Geri / ileri sarma', 'rewindControls'],
      ['Canlıya yetişme', 'liveCatchup'],
      ['En yüksek kalite', 'qualityLock'],
      ['Ekran görüntüsü', 'screenshot'],
      ['Hız kontrolleri', 'speedControls'],
    ] as const)('toggling "%s" dispatches kickflow:setFlag with {key: %s, value}', (label, key) => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const playerKeys: readonly string[] = [
        'autoTheater', 'captionGuard', 'rewindControls', 'liveCatchup', 'qualityLock', 'screenshot', 'speedControls',
      ];
      const pane = openDashboardSection(panel, playerKeys.includes(key) ? 'player' : 'chat').pane;
      const checkbox = requiredSettingsControl<HTMLInputElement>(pane, label);

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

    it('exposes one shared role style control and collapses role colors by default', () => {
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
      const chat = openDashboardSection(panel, 'chat').pane;
      const rows = Array.from(chat.querySelectorAll<HTMLElement>('.kickflow-panel__settings-row'));
      const rowIndex = (label: string) => rows.findIndex((row) => row.querySelector('span')?.textContent === label);

      expect(rowIndex('Vurgu rengi')).toBe(rowIndex('Vurgu stili') + 1);
      expect(rowIndex('Moderatör / VIP stili')).toBeGreaterThan(rowIndex('Kick kullanıcı adın'));
      expect(rowIndex('Moderatör mesajlarını vurgula')).toBe(rowIndex('Moderatör / VIP stili') + 1);
      expect(rowIndex('VIP mesajlarını vurgula')).toBe(rowIndex('Moderatör mesajlarını vurgula') + 1);

      const roleGroups = Array.from(chat.querySelectorAll<HTMLElement>('.kickflow-panel__segmented'))
        .filter((group) => group.getAttribute('aria-label') === 'Moderatör / VIP stili');
      expect(roleGroups).toHaveLength(1);
      const roleButtons = Array.from(roleGroups[0].querySelectorAll<HTMLButtonElement>('button'));
      expect(roleButtons.map((b) => b.textContent)).toEqual(['Yalnız çubuk', 'Çubuk + dolgu']);
      expect(roleButtons.some((b) => /dolgu only|fill only|Fill|Çerçeve/i.test(b.textContent ?? ''))).toBe(false);
      expect(roleButtons[0].getAttribute('aria-pressed')).toBe('true');
      expect(roleButtons[0].classList.contains('kickflow-panel__segment--active')).toBe(true);
      expect(roleButtons[1].getAttribute('aria-pressed')).toBe('false');

      let received: { key: string; value: unknown } | null = null;
      const listener = (event: Event) => {
        received = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      };
      window.addEventListener('kickflow:setFlag', listener);
      roleButtons[1].click();
      window.removeEventListener('kickflow:setFlag', listener);
      expect(received).toEqual({ key: 'roleHighlightStyle', value: 'both' });

      featureFlags.roleHighlightStyle = 'both';
      panel.render();
      expect(roleButtons[0].getAttribute('aria-pressed')).toBe('false');
      expect(roleButtons[1].getAttribute('aria-pressed')).toBe('true');
      expect(roleButtons[1].classList.contains('kickflow-panel__segment--active')).toBe(true);

      const disclosure = chat.querySelector<HTMLDetailsElement>('.kickflow-panel__role-colors');
      expect(disclosure).not.toBeNull();
      expect(disclosure!.open).toBe(false);
      expect(disclosure!.querySelector('summary')?.textContent).toContain('Rol renkleri');
      const dots = disclosure!.querySelectorAll<HTMLElement>('.kickflow-panel__role-color-dot');
      expect(dots).toHaveLength(2);
      for (const dot of dots) {
        expect(dot.getAttribute('aria-hidden')).toBe('true');
      }

      // Personal color stays outside the disclosure.
      expect(rowIndex('Vurgu rengi')).toBeGreaterThanOrEqual(0);
      expect(disclosure!.contains(rows[rowIndex('Vurgu rengi')])).toBe(false);

      disclosure!.open = true;
      const colorRows = Array.from(disclosure!.querySelectorAll<HTMLElement>('.kickflow-panel__settings-row'))
        .filter((row) => row.querySelector('input[type="color"]'));
      expect(colorRows).toHaveLength(2);
      for (const row of colorRows) {
        expect(row.querySelectorAll('.kickflow-panel__swatch')).toHaveLength(8);
        expect(row.querySelector('input[type="color"]')).not.toBeNull();
        expect(row.querySelector('.kickflow-panel__color-warn')).not.toBeNull();
      }

      // No per-role style segmented controls.
      const allSegmentLabels = Array.from(chat.querySelectorAll('.kickflow-panel__segmented'))
        .map((g) => g.getAttribute('aria-label'));
      expect(allSegmentLabels.filter((label) => label === 'Moderatör / VIP stili')).toHaveLength(1);
      expect(allSegmentLabels).not.toContain('Moderatör stili');
      expect(allSegmentLabels).not.toContain('VIP stili');

      lifecycle.dispose();
    });

    it('changing the chat-mode select dispatches kickflow:setFlag with {key: chatMode, value}', () => {
      const lifecycle = new Lifecycle();
      const store = new ChatIntegrityStore();
      store.addMessage(message('m1', 1));
      store.markUserBanned(1);

      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const general = openDashboardSection(panel, 'general').pane;
      const select = requiredSettingsControl<HTMLSelectElement>(general, 'Chat modu');

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

      const panel = new RemovedMessagesPanel(lifecycle, store, getTestStatusSnapshot);
      const { modal, pane } = openDashboardSection(panel, 'general');
      expect(pane.querySelector('.kickflow-panel__settings-row--mode')).not.toBeNull();

      // Past the 10-min preservation TTL, measured from preservation rather than send time.
      store.sweepExpiredPreserved((store.getMessageById('m1')?.preservedAt ?? Date.now()) + 11 * 60 * 1000);
      panel.render();

      expect(modal.isConnected).toBe(true);
      expect(panel.removedCount()).toBe(0);
      lifecycle.dispose();
      expect(document.querySelector('.kickflow-panel')).toBeNull();
    });

    it('navbar-style showSettings opens the existing panel directly on settings', () => {
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);

      panel.showSettings();

      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      expect(panel.isOpen()).toBe(true);
      expect(section.style.display).toBe('flex');
      expect(section.querySelector<HTMLElement>('.kickflow-panel__settings')?.style.display).toBe('');
      expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Genel');
      lifecycle.dispose();
    });

    it('showSettings(section) opens the requested tab and its default returns to Genel', () => {
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);

      panel.showSettings('removed');
      const section = document.querySelector<HTMLElement>('.kickflow-panel')!;
      expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Kaldırılanlar');
      expect(section.querySelector<HTMLElement>('[data-section="removed"]')?.getAttribute('aria-current')).toBe('page');

      panel.showSettings();
      expect(section.querySelector('.kickflow-panel__title')?.textContent).toBe('Genel');
      expect(section.querySelector<HTMLElement>('.kickflow-panel__section[data-section="general"]')?.hidden).toBe(false);
      lifecycle.dispose();
    });

    it('captures a rebound key live, prevents collisions, and warns for Kick-native keys', () => {
      resetHotkeyBindings();
      const lifecycle = new Lifecycle();
      const panel = new RemovedMessagesPanel(lifecycle, new ChatIntegrityStore(), getTestStatusSnapshot);
      const hotkeys = openDashboardSection(panel, 'hotkeys').pane;
      const screenshotChange = requiredElement<HTMLButtonElement>(
        hotkeys,
        '.kickflow-panel__hotkey-row:nth-child(3) .kickflow-panel__hotkey-change',
      );
      const screenshotChip = requiredElement<HTMLElement>(
        hotkeys,
        '.kickflow-panel__hotkey-row:nth-child(3) .kickflow-panel__hotkey-chip',
      );
      const status = requiredElement<HTMLElement>(hotkeys, '.kickflow-panel__hotkey-status');

      screenshotChange.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      expect(status.textContent).toContain('kullanımda');
      expect(getHotkeyBindings().screenshot.key).toBe('s');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', bubbles: true, cancelable: true }));
      expect(getHotkeyBindings().screenshot.key).toBe('c');
      expect(screenshotChip.textContent).toBe('C');
      expect(status.textContent).toContain('Kick’in kendi kısayoluyla');

      lifecycle.dispose();
      resetHotkeyBindings();
    });
  });
});
