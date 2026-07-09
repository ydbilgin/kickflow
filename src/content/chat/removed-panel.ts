import type { Lifecycle } from '../shared/lifecycle';
import { makeDraggable } from '../shared/draggable';
import type { FooterTogglePanel } from './footer-toggle';
import { featureFlags } from './feature-flags';
import { mergeIdentityBadges, type ChatIntegrityStore, type ChatMessage } from './message-store';
import { appendBadges, appendParsedContent, applyPreservedMarking, wireUsernameProfileLink } from './message-view';

const PANEL_CLASS = 'kickflow-panel';
const PANEL_HEADER_CLASS = 'kickflow-panel__header';
const PANEL_ACCENT_CLASS = 'kickflow-panel__accent';
const PANEL_TITLE_CLASS = 'kickflow-panel__title';
const PANEL_COUNT_CLASS = 'kickflow-panel__count';
const PANEL_SPACER_CLASS = 'kickflow-panel__spacer';
const PANEL_BTN_CLASS = 'kickflow-panel__btn';
const PANEL_GEAR_CLASS = 'kickflow-panel__gear';
const PANEL_CLOSE_CLASS = 'kickflow-panel__close';
const PANEL_SETTINGS_CLASS = 'kickflow-panel__settings';
const PANEL_BODY_CLASS = 'kickflow-panel__body';
const GHOST_ROW_CLASS = 'kickflow-ghost-row';
const GHOST_EMPTY_CLASS = 'kickflow-ghost-empty';

// The whole header is the drag handle (owner request 3) — everything a click could land on
// that ISN'T dragging (the ⚙/× buttons, and any settings control) is excluded.
const DRAG_IGNORE_SELECTOR = `.${PANEL_BTN_CLASS}, button, select, input, label`;

// Bounded so a high-moderation channel (mass bans) can't grow the panel without limit — keep the
// newest N removed messages only.
const MAX_PANEL_ROWS = 60;

/** Dispatched by the settings controls; bootstrap.ts's single `applyFlagChange` mutator (also
 * called by the popup's chrome.runtime message) is the only thing that ever writes featureFlags
 * — this window event is the panel's route into that same shared mutator. */
function dispatchFlag(key: string, value: boolean | string): void {
  window.dispatchEvent(new CustomEvent('kickflow:setFlag', { detail: { key, value } }));
}

/** "Kaldırılanlar" panel: a body-level, draggable drawer listing every removed (banned/timeout/
 * deleted) message the session's `ChatIntegrityStore` still holds. Mode-independent (Mode A
 * own-render and Mode B native-augment both instantiate one against the same store) — this is
 * the single shared implementation, extracted so neither mode duplicates it.
 *
 * Hidden by default: it still instantiates immediately (subscribes to the store, builds its DOM)
 * so the footer button's `isOpen()`/`removedCount()` reads are correct from the first tick, but
 * the section stays `display:none` until `toggle()`'d open — by the footer button
 * (footer-toggle.ts), never by anything inside the panel itself.
 *
 * Session/channel isolation: data comes only from the in-memory store — never any persisted,
 * cross-tab-shared storage — and the panel is torn down via the session `Lifecycle` — a channel
 * switch or tab close disposes it, so two tabs / two channels never share a panel or its data. */
export class RemovedMessagesPanel implements FooterTogglePanel {
  private section: HTMLElement | null = null;
  private open = false; // hidden by default — the footer button opens it — in-memory only (tab isolation)
  private lastSig = ''; // skip rebuilding the body when its contents are unchanged
  private disposeDrag: (() => void) | null = null;
  private showSettings = false; // gear-revealed quick-settings section — in-memory only
  private settingsSection: HTMLElement | null = null;
  private countChip: HTMLElement | null = null;
  private chatModeSelect: HTMLSelectElement | null = null;
  private showDeletedCheckbox: HTMLInputElement | null = null;
  private banInlineCheckbox: HTMLInputElement | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
  ) {
    this.render();
    lifecycle.setInterval(() => this.render(), 1000);
    lifecycle.add(() => this.dispose());
  }

  /** Flips open/closed. Called by the footer button (footer-toggle.ts) and by the panel's own
   * × close button. */
  toggle(): void {
    this.open = !this.open;
    this.render();
  }

  isOpen(): boolean {
    return this.open;
  }

  removedCount(): number {
    return this.store.getPreserved().filter((message) => message.preserved === true).length;
  }

  /** Keeps content current every tick regardless of open state — so the moment the footer
   * button opens the panel, it's instant AND already up to date, never a stale snapshot from
   * whenever it was last visible. The section itself is just `display:none` while closed. */
  render(): void {
    const removed = this.store.getPreserved()
      .filter((message) => message.preserved === true)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    const section = this.ensureSection();
    section.style.display = this.open ? 'flex' : 'none';

    if (this.countChip) {
      this.countChip.textContent = String(removed.length);
      this.countChip.style.display = removed.length > 0 ? '' : 'none';
    }

    // Settings visibility is independent of open/closed (gear lives in the same header). Keep
    // the controls' displayed values current — e.g. a flag changed via the Chrome popup, which
    // routes through the same applyFlagChange mutator — without stealing focus mid-interaction.
    if (this.showSettings) this.refreshSettingsControls();

    const body = section.querySelector<HTMLElement>(`.${PANEL_BODY_CLASS}`);
    if (!body) return;
    const shown = removed.slice(-MAX_PANEL_ROWS);
    const sig = `${removed.length}:${shown[shown.length - 1]?.id ?? ''}`;
    if (sig === this.lastSig) return; // unchanged since last render — don't churn/scroll-jump
    this.lastSig = sig;
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = GHOST_EMPTY_CLASS;
      empty.textContent = 'henüz kaldırılan mesaj yok';
      body.replaceChildren(empty);
    } else {
      body.replaceChildren(...shown.map((message) => this.buildRow(message)));
    }
  }

  private ensureSection(): HTMLElement {
    if (this.section?.isConnected) return this.section;

    const section = document.createElement('section');
    section.className = PANEL_CLASS;
    section.style.display = this.open ? 'flex' : 'none';

    const header = document.createElement('div');
    header.className = PANEL_HEADER_CLASS;

    const accent = document.createElement('span');
    accent.className = PANEL_ACCENT_CLASS;

    const title = document.createElement('span');
    title.className = PANEL_TITLE_CLASS;
    title.textContent = 'Kaldırılanlar';

    const count = document.createElement('span');
    count.className = PANEL_COUNT_CLASS;
    count.style.display = 'none';
    this.countChip = count;

    const spacer = document.createElement('span');
    spacer.className = PANEL_SPACER_CLASS;

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = `${PANEL_BTN_CLASS} ${PANEL_GEAR_CLASS}`;
    gear.title = 'Ayarlar';
    gear.textContent = '⚙';
    gear.addEventListener('click', () => {
      this.showSettings = !this.showSettings;
      if (this.showSettings) this.refreshSettingsControls();
      this.updateSettingsVisibility();
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = `${PANEL_BTN_CLASS} ${PANEL_CLOSE_CLASS}`;
    close.title = 'Kapat';
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle());

    header.append(accent, title, count, spacer, gear, close);

    // Panel starts anchored bottom-right via CSS (right/bottom). The first drag switches it to
    // explicit left/top at its current on-screen position, then hands off to makeDraggable — no
    // visual jump, and the default corner anchor is cleanly disabled from then on. Only fires for
    // an actual drag start (not a click landing on a button/select/input/label).
    header.addEventListener('mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest(DRAG_IGNORE_SELECTOR)) return;
      const rect = section.getBoundingClientRect();
      section.style.right = 'auto';
      section.style.bottom = 'auto';
      section.style.left = `${rect.left}px`;
      section.style.top = `${rect.top}px`;
    });

    const settings = this.buildSettingsSection();
    this.settingsSection = settings;

    const body = document.createElement('div');
    body.className = PANEL_BODY_CLASS;

    section.append(header, settings, body);
    document.body.appendChild(section);
    this.section = section;
    this.disposeDrag?.();
    // Whole-header drag (owner request 3) — not just a grip. The ⚙/× buttons and settings
    // controls are excluded via DRAG_IGNORE_SELECTOR so they stay clickable.
    this.disposeDrag = makeDraggable(section, header, DRAG_IGNORE_SELECTOR);
    return section;
  }

  /** Quick-settings section — the same three owner-facing flags the Chrome popup exposes, so bans
   * + settings live in one on-page surface. Built once (kept in the DOM, visibility toggled by the
   * gear) — controls dispatch `kickflow:setFlag`, which bootstrap.ts's single `applyFlagChange`
   * mutator applies (same side effects as the popup path: reconcile / session restart / persist). */
  private buildSettingsSection(): HTMLElement {
    const settings = document.createElement('div');
    settings.className = PANEL_SETTINGS_CLASS;
    settings.style.display = this.showSettings ? '' : 'none';

    const modeLabel = document.createElement('label');
    const modeText = document.createElement('span');
    modeText.textContent = 'Chat modu';
    const modeSelect = document.createElement('select');
    const nativeOption = document.createElement('option');
    nativeOption.value = 'native';
    nativeOption.textContent = 'Native';
    const ownOption = document.createElement('option');
    ownOption.value = 'own';
    ownOption.textContent = 'Kendi liste';
    modeSelect.append(nativeOption, ownOption);
    modeSelect.value = featureFlags.chatMode;
    modeSelect.addEventListener('change', () => dispatchFlag('chatMode', modeSelect.value));
    modeLabel.append(modeText, modeSelect);
    this.chatModeSelect = modeSelect;

    const deletedLabel = document.createElement('label');
    const deletedText = document.createElement('span');
    deletedText.textContent = 'Silinenleri göster';
    const deletedCheckbox = document.createElement('input');
    deletedCheckbox.type = 'checkbox';
    deletedCheckbox.checked = featureFlags.showDeletedMessages;
    deletedCheckbox.addEventListener('change', () => dispatchFlag('showDeletedMessages', deletedCheckbox.checked));
    deletedLabel.append(deletedText, deletedCheckbox);
    this.showDeletedCheckbox = deletedCheckbox;

    const banLabel = document.createElement('label');
    const banText = document.createElement('span');
    banText.textContent = 'Ban satır-içi';
    const banCheckbox = document.createElement('input');
    banCheckbox.type = 'checkbox';
    banCheckbox.checked = featureFlags.preserveBansInline;
    banCheckbox.addEventListener('change', () => dispatchFlag('preserveBansInline', banCheckbox.checked));
    banLabel.append(banText, banCheckbox);
    this.banInlineCheckbox = banCheckbox;

    settings.append(modeLabel, deletedLabel, banLabel);
    return settings;
  }

  private updateSettingsVisibility(): void {
    if (this.settingsSection) this.settingsSection.style.display = this.showSettings ? '' : 'none';
  }

  /** Keeps the controls' displayed value/checked current with featureFlags without replacing
   * nodes — a rebuild-on-every-render would steal focus/close an open <select> mid-interaction. */
  private refreshSettingsControls(): void {
    if (this.chatModeSelect && this.chatModeSelect.value !== featureFlags.chatMode) {
      this.chatModeSelect.value = featureFlags.chatMode;
    }
    if (this.showDeletedCheckbox && this.showDeletedCheckbox.checked !== featureFlags.showDeletedMessages) {
      this.showDeletedCheckbox.checked = featureFlags.showDeletedMessages;
    }
    if (this.banInlineCheckbox && this.banInlineCheckbox.checked !== featureFlags.preserveBansInline) {
      this.banInlineCheckbox.checked = featureFlags.preserveBansInline;
    }
  }

  /** Mirrors the row shape native-augment.ts uses for its inline ghost blocks: time + badges +
   * colored username + struck-through content + the preserved status label. */
  private buildRow(message: ChatMessage): HTMLElement {
    const row = document.createElement('div');
    row.className = GHOST_ROW_CLASS;
    row.dataset.kickflowGhostMid = message.id;

    const time = document.createElement('span');
    time.className = 'kickflow-ghost-row__time';
    const createdAt = new Date(message.createdAt);
    time.textContent = Number.isNaN(createdAt.getTime())
      ? ''
      : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const badges = document.createElement('span');
    badges.className = 'kickflow-ghost-row__badges';
    appendBadges(badges, mergeIdentityBadges(message.sender.identity));

    const username = document.createElement('span');
    username.className = 'kickflow-ghost-row__username';
    const displayName = message.sender.displayName || message.sender.username;
    username.textContent = displayName;
    wireUsernameProfileLink(username, message.sender, displayName, 'kickflow-ghost-row__username--link');
    username.style.color = message.sender.identity.color || 'inherit';

    const separator = document.createElement('span');
    separator.className = 'kickflow-ghost-row__separator';
    separator.textContent = ': ';

    const content = document.createElement('span');
    content.className = 'kickflow-ghost-row__content';
    appendParsedContent(content, message.content);

    row.append(time, badges, username, separator, content);
    applyPreservedMarking(row, message);
    return row;
  }

  /** Tears the panel DOM down and stops any in-flight drag: dispatch `kickflow:dismiss` (cleans the
   * document mousemove/mouseup listeners makeDraggable added while dragging) and dispose the drag
   * handler. Shared by dispose() so it can't leak listeners. */
  private removeSection(): void {
    if (this.section) {
      this.section.dispatchEvent(new Event('kickflow:dismiss'));
      this.section.remove();
      this.section = null;
    }
    this.disposeDrag?.();
    this.disposeDrag = null;
    this.countChip = null;
    // showSettings stays in-memory (owner's preference survives a teardown/rebuild); only the
    // now-detached DOM refs are dropped.
    this.settingsSection = null;
    this.chatModeSelect = null;
    this.showDeletedCheckbox = null;
    this.banInlineCheckbox = null;
  }

  private dispose(): void {
    this.removeSection();
  }
}
