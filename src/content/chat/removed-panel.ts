import type { Lifecycle } from '../shared/lifecycle';
import type { StatusSnapshotProvider } from '../status';
import type { FooterTogglePanel } from './footer-toggle';
import { getLang, hotkeyLabel, setLang, subscribeLang, t, type MessageKey } from '../shared/i18n';
import { featureFlags } from './feature-flags';
import type { ChatIntegrityStore, ChatMessage } from './message-store';
import { appendParsedContent, applyPreservedMarking, wireUsernameProfileLink } from './message-view';
import {
  MENTION_COLOR_SWATCHES,
  normalizeHexColor,
  sanitizeHighlightColor,
  type MentionHighlightStyle,
  type RoleHighlightStyle,
} from './message-highlight';
import { isOwnerIdentityResolved } from './owner-identity';
import { getExtensionVersion } from '../shared/extension-context';
import {
  HOTKEY_ACTIONS,
  HOTKEY_DEFINITIONS,
  formatHotkeyKey,
  getHotkeyBindings,
  normalizeHotkeyKey,
  resetHotkeyBindings,
  setHotkeyCaptureActive,
  updateHotkeyBinding,
  type HotkeyAction,
} from '../player/hotkey-registry';

const PANEL_CLASS = 'kickflow-panel';
const PANEL_SHELL_CLASS = 'kickflow-panel__shell';
const PANEL_RAIL_CLASS = 'kickflow-panel__rail';
const PANEL_MAIN_CLASS = 'kickflow-panel__main';
const PANEL_HEADER_CLASS = 'kickflow-panel__header';
const PANEL_TITLE_CLASS = 'kickflow-panel__title';
const PANEL_COUNT_CLASS = 'kickflow-panel__count';
const PANEL_BTN_CLASS = 'kickflow-panel__btn';
const PANEL_CLOSE_CLASS = 'kickflow-panel__close';
const PANEL_SETTINGS_CLASS = 'kickflow-panel__settings';
const PANEL_BODY_CLASS = 'kickflow-panel__removed-list';
const FILTER_CHIP_CLASS = 'kickflow-panel__filter-chip';
const REMOVED_ROW_CLASS = 'kickflow-removed-row';
const REMOVED_EMPTY_CLASS = 'kickflow-removed-empty';

// Bounded so a high-moderation channel (mass bans) can't grow the panel without limit — keep the
// newest N removed messages only.
const MAX_PANEL_ROWS = 60;

export type DashboardSection = 'general' | 'removed' | 'chat' | 'player' | 'hotkeys' | 'about';

const DASHBOARD_SECTIONS: ReadonlyArray<{ key: DashboardSection; labelKey: MessageKey }> = [
  { key: 'general', labelKey: 'tab.general' },
  { key: 'removed', labelKey: 'tab.removed' },
  { key: 'chat', labelKey: 'tab.chat' },
  { key: 'player', labelKey: 'tab.player' },
  { key: 'hotkeys', labelKey: 'tab.shortcuts' },
  { key: 'about', labelKey: 'tab.about' },
];

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface HotkeyRowControls {
  enabled: HTMLInputElement;
  chip: HTMLElement;
  change: HTMLButtonElement;
}

interface DashboardStats {
  connection: HTMLElement;
  connectionDot: HTMLElement;
  channel: HTMLElement;
  chatroom: HTMLElement;
  messages: HTMLElement;
  preserved: HTMLElement;
  banned: HTMLElement;
  deleted: HTMLElement;
  ghostAnchored: HTMLElement;
  ghostPending: HTMLElement;
  ghostEvicted: HTMLElement;
  lastBan: HTMLElement;
}

interface ScrollLockState {
  rootOverflow: string;
  bodyOverflow: string;
}

type HighlightColorFlagKey = 'mentionHighlightColor' | 'modFrameColor' | 'vipFrameColor';

interface HighlightColorControlRefs {
  swatchButtons: Map<string, HTMLButtonElement>;
  customInput: HTMLInputElement;
  getCurrentColor: () => string;
}

/** Dispatched by the settings controls; bootstrap.ts's single `applyFlagChange` mutator (also
 * called by the popup's chrome.runtime message) is the only thing that ever writes featureFlags
 * — this window event is the panel's route into that same shared mutator. */
function dispatchFlag(key: string, value: boolean | string): void {
  window.dispatchEvent(new CustomEvent('kickflow:setFlag', { detail: { key, value } }));
}

/** Body-level KickFlow dashboard. Its Removed pane lists every banned, timed-out, or deleted
 * message the session's `ChatIntegrityStore` still holds. Mode-independent (Mode A own-render
 * and Mode B native-augment both instantiate one against the same store) so neither mode
 * duplicates settings or removed-message rendering.
 *
 * Hidden by default: it still instantiates immediately (subscribes to the store, builds its DOM)
 * so the footer button's `isOpen()`/`removedCount()` reads are correct from the first tick, but
   * the section stays `display:none` until opened by the footer or navbar entry point.
 *
 * Session/channel isolation: data comes only from the in-memory store — never any persisted,
 * cross-tab-shared storage — and the panel is torn down via the session `Lifecycle` — a channel
 * switch or tab close disposes it, so two tabs / two channels never share a panel or its data. */
export class RemovedMessagesPanel implements FooterTogglePanel {
  private section: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private main: HTMLElement | null = null;
  private titleHeading: HTMLElement | null = null;
  private open = false;
  private lastSig = ''; // skip rebuilding the body when its contents are unchanged
  private activeSection: DashboardSection = 'general';
  private opener: HTMLElement | null = null;
  private openerId: string | null = null;
  private scrollLockState: ScrollLockState | null = null;
  private readonly dashboardSections = new Map<DashboardSection, HTMLElement>();
  private readonly navButtons = new Map<DashboardSection, HTMLButtonElement>();
  private stats: DashboardStats | null = null;
  private countChip: HTMLElement | null = null;
  private chatModeSelect: HTMLSelectElement | null = null;
  private showDeletedCheckbox: HTMLInputElement | null = null;
  private banInlineCheckbox: HTMLInputElement | null = null;
  private subscriptionsCheckbox: HTMLInputElement | null = null;
  private giftedSubsCheckbox: HTMLInputElement | null = null;
  private kicksCheckbox: HTMLInputElement | null = null;
  private hostRaidCheckbox: HTMLInputElement | null = null;
  private modeChangesCheckbox: HTMLInputElement | null = null;
  private sidebarRefreshCheckbox: HTMLInputElement | null = null;
  private chattersBadgesCheckbox: HTMLInputElement | null = null;
  private mentionHighlightCheckbox: HTMLInputElement | null = null;
  private modFrameCheckbox: HTMLInputElement | null = null;
  private vipFrameCheckbox: HTMLInputElement | null = null;
  private mentionStyleButtons = new Map<MentionHighlightStyle, HTMLButtonElement>();
  private roleStyleButtons = new Map<RoleHighlightStyle, HTMLButtonElement>();
  private readonly highlightColorControls = new Map<HighlightColorFlagKey, HighlightColorControlRefs>();
  private roleColorDots: { mod: HTMLElement; vip: HTMLElement } | null = null;
  private manualUsernameInput: HTMLInputElement | null = null;
  private identityNote: HTMLElement | null = null;
  private autoTheaterCheckbox: HTMLInputElement | null = null;
  private captionGuardCheckbox: HTMLInputElement | null = null;
  private rewindControlsCheckbox: HTMLInputElement | null = null;
  private liveCatchupCheckbox: HTMLInputElement | null = null;
  private qualityLockCheckbox: HTMLInputElement | null = null;
  private screenshotCheckbox: HTMLInputElement | null = null;
  private speedControlsCheckbox: HTMLInputElement | null = null;
  private readonly hotkeyRows = new Map<HotkeyAction, HotkeyRowControls>();
  private hotkeyStatus: HTMLElement | null = null;
  private captureAction: HotkeyAction | null = null;
  private userFilter: { slug: string; label: string } | null = null;
  private filterChip: HTMLButtonElement | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
    private readonly getStatusSnapshot: StatusSnapshotProvider,
  ) {
    this.render();
    lifecycle.add(subscribeLang(() => this.rebuildForLanguage()));
    lifecycle.setInterval(() => this.render(), 1000);
    lifecycle.addEventListener(document, 'keydown', (event) => this.onHotkeyCapture(event as KeyboardEvent), true);
    lifecycle.addEventListener(document, 'keydown', (event) => this.onDashboardKeydown(event as KeyboardEvent), true);
    lifecycle.add(() => this.dispose());
  }

  /** Toggles the shared dashboard. A different requested section is selected without closing. */
  toggle(section?: DashboardSection): void {
    if (section !== undefined && this.open && section !== this.activeSection) {
      this.showDashboardSection(section);
      return;
    }
    const opening = !this.open;
    if (section !== undefined) this.activeSection = section;
    this.setOpen(!this.open);
    if (opening && section !== undefined) this.showDashboardSection(section);
  }

  /** Opens the shared dashboard on a specific section. Navbar callers use the General default. */
  showSettings(section: DashboardSection = 'general'): void {
    this.activeSection = section;
    this.setOpen(true);
    this.showDashboardSection(section);
  }

  /** Opens Removed on one canonical identity. Native Active Chatters badges use this entry point;
   * the clearable chip is the only way the scoped view persists across panel renders. */
  showUserFilter(slug: string, label: string): void {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) return;
    this.userFilter = { slug: normalizedSlug, label: label.trim() || normalizedSlug };
    this.lastSig = '';
    this.showSettings('removed');
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
    const allRemoved = this.store.getPreserved()
      .filter((message) => message.preserved === true)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    const removed = (this.userFilter
      ? this.store.getPreservedForSlug(this.userFilter.slug)
      : allRemoved)
      .filter((message) => message.preserved === true)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));

    const section = this.ensureSection();
    section.style.display = this.open ? 'flex' : 'none';
    section.setAttribute('aria-hidden', this.open ? 'false' : 'true');

    if (this.countChip) {
      this.countChip.textContent = allRemoved.length > 0 ? String(allRemoved.length) : '';
      this.countChip.style.display = allRemoved.length > 0 ? '' : 'none';
    }
    const removedNav = this.navButtons.get('removed');
    removedNav?.setAttribute(
      'aria-label',
      allRemoved.length > 0 ? t('panel.removed_count', { n: allRemoved.length }) : t('tab.removed'),
    );
    this.refreshUserFilterChip();

    // Keep displayed values current when the popup changes a flag, without replacing nodes and
    // stealing focus from a select or hotkey button.
    this.refreshSettingsControls();
    this.refreshStats();

    const body = section.querySelector<HTMLElement>(`.${PANEL_BODY_CLASS}`);
    if (!body) return;
    const shown = removed.slice(0, MAX_PANEL_ROWS);
    // The panel can change without its count or final id changing: a metadata enrichment (e.g.
    // deletedBy arriving in a later event) alters an existing row, as can an expiry+preserve that
    // keeps the same shape. Sign every field buildRow reads, not merely the list shape.
    const sig = `${this.userFilter?.slug ?? ''}\u001d${removed.length}\u001e${shown.map((message) => JSON.stringify({
      id: message.id,
      seq: message.seq,
      content: message.content,
      createdAt: message.createdAt,
      sender: message.sender,
      preserved: message.preserved,
      preservedReason: message.preservedReason,
      preservedMeta: message.preservedMeta,
    })).join('\u001f')}`;
    if (sig === this.lastSig) return; // unchanged since last render — don't churn/scroll-jump
    this.lastSig = sig;
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = REMOVED_EMPTY_CLASS;
      empty.textContent = t('panel.removed_empty');
      body.replaceChildren(empty);
    } else {
      body.replaceChildren(...shown.map((message) => this.buildRow(message)));
    }
  }

  private setOpen(nextOpen: boolean): void {
    if (nextOpen === this.open) {
      if (nextOpen) this.refreshSettingsControls();
      return;
    }

    if (nextOpen) {
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.openerId = this.opener?.id || null;
      this.lockDocumentScroll();
      this.open = true;
      this.render();
      this.showDashboardSection(this.activeSection, false);
      this.section?.querySelector<HTMLButtonElement>(`.${PANEL_CLOSE_CLASS}`)?.focus();
      return;
    }

    this.finishHotkeyCapture();
    this.open = false;
    this.render();
    const opener = this.opener;
    const openerId = this.openerId;
    this.opener = null;
    this.openerId = null;
    this.unlockDocumentScroll();
    const focusTarget = opener?.isConnected
      ? opener
      : openerId
        ? document.getElementById(openerId)
        : null;
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  }

  private ensureSection(): HTMLElement {
    if (this.section?.isConnected) return this.section;

    const section = document.createElement('div');
    section.className = PANEL_CLASS;
    section.style.display = this.open ? 'flex' : 'none';
    section.setAttribute('aria-hidden', this.open ? 'false' : 'true');
    section.addEventListener('click', (event) => {
      if (event.target === section) this.setOpen(false);
    });

    const shell = document.createElement('section');
    shell.className = PANEL_SHELL_CLASS;
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'kickflow-dashboard-title');
    this.shell = shell;

    const rail = document.createElement('aside');
    rail.className = PANEL_RAIL_CLASS;

    const wordmark = document.createElement('div');
    wordmark.className = 'kickflow-panel__wordmark';
    wordmark.textContent = 'KickFlow';

    const railCaption = document.createElement('p');
    railCaption.className = 'kickflow-panel__rail-caption';
    railCaption.textContent = t('panel.control_panel');

    const nav = document.createElement('nav');
    nav.className = 'kickflow-panel__nav';
    nav.setAttribute('aria-label', t('panel.sections'));
    for (const item of DASHBOARD_SECTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kickflow-panel__nav-item';
      button.dataset.section = item.key;
      const label = document.createElement('span');
      label.className = 'kickflow-panel__nav-label';
      label.textContent = t(item.labelKey);
      button.append(label);
      if (item.key === 'removed') {
        const count = document.createElement('span');
        count.className = PANEL_COUNT_CLASS;
        count.style.display = 'none';
        count.setAttribute('aria-hidden', 'true');
        button.append(count);
        this.countChip = count;
      }
      button.setAttribute('aria-controls', `kickflow-dashboard-${item.key}`);
      button.addEventListener('click', () => this.showDashboardSection(item.key));
      nav.append(button);
      this.navButtons.set(item.key, button);
    }

    const version = document.createElement('span');
    version.className = 'kickflow-panel__version';
    version.textContent = `v${getExtensionVersion()}`;
    rail.append(wordmark, railCaption, nav, version);

    const main = document.createElement('div');
    main.className = PANEL_MAIN_CLASS;
    this.main = main;

    const header = document.createElement('div');
    header.className = PANEL_HEADER_CLASS;

    const title = document.createElement('h1');
    title.className = PANEL_TITLE_CLASS;
    title.id = 'kickflow-dashboard-title';
    this.titleHeading = title;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = `${PANEL_BTN_CLASS} ${PANEL_CLOSE_CLASS}`;
    close.title = t('common.close');
    close.setAttribute('aria-label', t('panel.close_aria'));
    close.textContent = '×';
    close.addEventListener('click', () => this.setOpen(false));

    header.append(title, close);

    const settings = this.buildSettingsSection();
    main.append(header, settings);
    shell.append(rail, main);
    section.append(shell);
    document.body.appendChild(section);
    this.section = section;
    // The body is new even if the store signature is unchanged. Force this render to populate
    // it; otherwise an externally removed panel self-heals as an empty shell on the next tick.
    this.lastSig = '';
    this.showDashboardSection(this.activeSection, false);
    return section;
  }

  /** The same owner-facing flags the Chrome popup exposes. Built once; controls still dispatch
   * `kickflow:setFlag`, which bootstrap.ts's single mutator applies and persists. */
  private buildSettingsSection(): HTMLElement {
    const settings = document.createElement('div');
    settings.className = PANEL_SETTINGS_CLASS;
    this.dashboardSections.clear();

    const general = this.buildDashboardPane('general');
    general.append(this.buildPaneIntro(t('panel.general_intro')));

    const statusGroup = document.createElement('section');
    statusGroup.className = 'kickflow-panel__group';
    statusGroup.append(this.buildGroupTitle(t('panel.live_status')));
    const statsList = document.createElement('dl');
    statsList.className = 'kickflow-panel__stats';
    const connection = this.buildStat(t('stat.connection'));
    const connectionDot = document.createElement('span');
    connectionDot.className = 'kickflow-panel__live-dot';
    connection.value.prepend(connectionDot);
    const channel = this.buildStat(t('stat.channel'));
    const chatroom = this.buildStat(t('stat.chatroom_id'));
    const messages = this.buildStat(t('stat.messages'));
    const preserved = this.buildStat(t('stat.preserved'));
    const banned = this.buildStat(t('stat.bans'));
    const deleted = this.buildStat(t('stat.deletions'));
    const ghostAnchored = this.buildStat(t('stat.ghost_inline'));
    const ghostPending = this.buildStat(t('stat.ghost_pending'));
    const ghostEvicted = this.buildStat(t('stat.ghost_evicted'));
    const lastBan = this.buildStat(t('stat.last_ban'));
    statsList.append(
      connection.row,
      channel.row,
      chatroom.row,
      messages.row,
      preserved.row,
      banned.row,
      deleted.row,
      ghostAnchored.row,
      ghostPending.row,
      ghostEvicted.row,
      lastBan.row,
    );
    statusGroup.append(statsList);
    this.stats = {
      connection: connection.value,
      connectionDot,
      channel: channel.value,
      chatroom: chatroom.value,
      messages: messages.value,
      preserved: preserved.value,
      banned: banned.value,
      deleted: deleted.value,
      ghostAnchored: ghostAnchored.value,
      ghostPending: ghostPending.value,
      ghostEvicted: ghostEvicted.value,
      lastBan: lastBan.value,
    };

    const modeGroup = document.createElement('section');
    modeGroup.className = 'kickflow-panel__group';
    modeGroup.append(this.buildGroupTitle(t('panel.chat_view')));
    const modeLabel = document.createElement('label');
    modeLabel.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--mode';
    const modeCopy = this.buildRowCopy(t('panel.chat_mode'), t('panel.chat_mode_desc'));
    const modeSelect = document.createElement('select');
    modeSelect.setAttribute('aria-label', t('panel.chat_mode'));
    const nativeOption = document.createElement('option');
    nativeOption.value = 'native';
    nativeOption.textContent = 'Native';
    const ownOption = document.createElement('option');
    ownOption.value = 'own';
    ownOption.textContent = 'KickFlow';
    modeSelect.append(nativeOption, ownOption);
    modeSelect.value = featureFlags.chatMode;
    modeSelect.addEventListener('change', () => dispatchFlag('chatMode', modeSelect.value));
    modeLabel.append(modeCopy, modeSelect);
    modeGroup.append(modeLabel);
    this.chatModeSelect = modeSelect;

    const languageLabel = document.createElement('label');
    languageLabel.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--mode';
    const languageCopy = this.buildRowCopy(t('panel.language'), t('panel.language_desc'));
    const languageSelect = document.createElement('select');
    languageSelect.setAttribute('aria-label', t('panel.language'));
    for (const [value, label] of [['en', 'EN'], ['tr', 'TR']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      languageSelect.append(option);
    }
    languageSelect.value = getLang();
    languageSelect.addEventListener('change', () => {
      const next = languageSelect.value;
      if (next === 'en' || next === 'tr') setLang(next);
    });
    languageLabel.append(languageCopy, languageSelect);
    modeGroup.append(languageLabel);

    general.append(statusGroup, modeGroup);

    const removed = this.buildDashboardPane('removed');
    removed.append(this.buildPaneIntro(t('panel.removed_intro')));
    const filterChip = document.createElement('button');
    filterChip.type = 'button';
    filterChip.className = FILTER_CHIP_CLASS;
    filterChip.addEventListener('click', () => this.clearUserFilter());
    filterChip.hidden = true;
    this.filterChip = filterChip;
    const body = document.createElement('div');
    body.className = PANEL_BODY_CLASS;
    body.setAttribute('role', 'list');
    body.setAttribute('aria-label', t('panel.removed_aria'));
    body.setAttribute('aria-live', 'polite');
    removed.append(filterChip, body);

    const chat = this.buildDashboardPane('chat');
    chat.append(this.buildPaneIntro(t('panel.chat_intro')));
    const chatGroup = document.createElement('section');
    chatGroup.className = 'kickflow-panel__group';

    const { label: deletedLabel, checkbox: deletedCheckbox } = this.buildSettingsToggle(
      t('setting.show_deleted'),
      t('setting.show_deleted_desc'),
      'showDeletedMessages',
      featureFlags.showDeletedMessages,
    );
    this.showDeletedCheckbox = deletedCheckbox;

    const { label: banLabel, checkbox: banCheckbox } = this.buildSettingsToggle(
      t('setting.inline_bans'),
      t('setting.inline_bans_desc'),
      'preserveBansInline',
      featureFlags.preserveBansInline,
    );
    this.banInlineCheckbox = banCheckbox;

    const { label: subscriptionsLabel, checkbox: subscriptionsCheckbox } = this.buildSettingsToggle(
      t('setting.subscriptions'), t('setting.subscriptions_desc'), 'showSubscriptions', featureFlags.showSubscriptions,
    );
    this.subscriptionsCheckbox = subscriptionsCheckbox;

    const { label: giftedSubsLabel, checkbox: giftedSubsCheckbox } = this.buildSettingsToggle(
      t('setting.gifted_subscriptions'), t('setting.gifted_subscriptions_desc'), 'showGiftedSubs', featureFlags.showGiftedSubs,
    );
    this.giftedSubsCheckbox = giftedSubsCheckbox;

    const { label: kicksLabel, checkbox: kicksCheckbox } = this.buildSettingsToggle(
      t('setting.kicks'), t('setting.kicks_desc'), 'showKicks', featureFlags.showKicks,
    );
    this.kicksCheckbox = kicksCheckbox;

    const { label: hostRaidLabel, checkbox: hostRaidCheckbox } = this.buildSettingsToggle(
      t('setting.host_raid'), t('setting.host_raid_desc'), 'showHostRaid', featureFlags.showHostRaid,
    );
    this.hostRaidCheckbox = hostRaidCheckbox;

    const { label: modeChangesLabel, checkbox: modeChangesCheckbox } = this.buildSettingsToggle(
      t('setting.mode_changes'), t('setting.mode_changes_desc'), 'showModeChanges', featureFlags.showModeChanges,
    );
    this.modeChangesCheckbox = modeChangesCheckbox;

    const { label: sidebarRefreshLabel, checkbox: sidebarRefreshCheckbox } = this.buildSettingsToggle(
      t('setting.sidebar_refresh'), t('setting.sidebar_refresh_desc'), 'showSidebarRefresh', featureFlags.showSidebarRefresh,
    );
    this.sidebarRefreshCheckbox = sidebarRefreshCheckbox;

    const { label: chattersBadgesLabel, checkbox: chattersBadgesCheckbox } = this.buildSettingsToggle(
      t('setting.chatters_badges'), t('setting.chatters_badges_desc'), 'showChattersBadges', featureFlags.showChattersBadges,
    );
    this.chattersBadgesCheckbox = chattersBadgesCheckbox;

    const { label: mentionHighlightLabel, checkbox: mentionHighlightCheckbox } = this.buildSettingsToggle(
      t('setting.mention_highlight'),
      t('setting.mention_highlight_desc'),
      'mentionHighlightEnabled',
      featureFlags.mentionHighlightEnabled,
    );
    this.mentionHighlightCheckbox = mentionHighlightCheckbox;

    const mentionStyleRow = this.buildMentionStyleControl();
    const mentionColorRow = this.buildHighlightColorControl(
      'mentionHighlightColor',
      'setting.mention_color',
      'setting.mention_color_desc',
      'setting.mention_color_warn',
      () => featureFlags.mentionHighlightColor,
    );
    const identityRow = this.buildManualUsernameControl();

    const roleStyleRow = this.buildRoleStyleControl();

    const { label: modFrameLabel, checkbox: modFrameCheckbox } = this.buildSettingsToggle(
      t('setting.mod_frame'),
      t('setting.mod_frame_desc'),
      'modFrameEnabled',
      featureFlags.modFrameEnabled,
    );
    this.modFrameCheckbox = modFrameCheckbox;

    const { label: vipFrameLabel, checkbox: vipFrameCheckbox } = this.buildSettingsToggle(
      t('setting.vip_frame'),
      t('setting.vip_frame_desc'),
      'vipFrameEnabled',
      featureFlags.vipFrameEnabled,
    );
    this.vipFrameCheckbox = vipFrameCheckbox;

    const roleColorsDisclosure = this.buildRoleColorsDisclosure();

    chatGroup.append(
      deletedLabel,
      banLabel,
      subscriptionsLabel,
      giftedSubsLabel,
      kicksLabel,
      hostRaidLabel,
      modeChangesLabel,
      sidebarRefreshLabel,
      chattersBadgesLabel,
      mentionHighlightLabel,
      mentionStyleRow,
      mentionColorRow,
      identityRow,
      roleStyleRow,
      modFrameLabel,
      vipFrameLabel,
      roleColorsDisclosure,
    );
    chat.append(chatGroup);

    const player = this.buildDashboardPane('player');
    player.append(this.buildPaneIntro(t('panel.player_intro')));
    const playerGroup = document.createElement('section');
    playerGroup.className = 'kickflow-panel__group';

    const { label: autoTheaterLabel, checkbox: autoTheaterCheckbox } = this.buildSettingsToggle(
      t('setting.auto_theater'), t('setting.auto_theater_desc'), 'autoTheater', featureFlags.autoTheater,
    );
    this.autoTheaterCheckbox = autoTheaterCheckbox;

    const { label: captionGuardLabel, checkbox: captionGuardCheckbox } = this.buildSettingsToggle(
      t('setting.caption_guard'), t('setting.caption_guard_desc'), 'captionGuard', featureFlags.captionGuard,
    );
    this.captionGuardCheckbox = captionGuardCheckbox;

    const { label: rewindControlsLabel, checkbox: rewindControlsCheckbox } = this.buildSettingsToggle(
      t('setting.seek'), t('setting.seek_desc'), 'rewindControls', featureFlags.rewindControls,
    );
    this.rewindControlsCheckbox = rewindControlsCheckbox;

    const { label: liveCatchupLabel, checkbox: liveCatchupCheckbox } = this.buildSettingsToggle(
      t('setting.live_catchup'), t('setting.live_catchup_desc'), 'liveCatchup', featureFlags.liveCatchup,
    );
    this.liveCatchupCheckbox = liveCatchupCheckbox;

    const { label: qualityLockLabel, checkbox: qualityLockCheckbox } = this.buildSettingsToggle(
      t('setting.quality_lock'), t('setting.quality_lock_desc'), 'qualityLock', featureFlags.qualityLock,
    );
    this.qualityLockCheckbox = qualityLockCheckbox;

    const { label: screenshotLabel, checkbox: screenshotCheckbox } = this.buildSettingsToggle(
      t('setting.screenshot'), t('setting.screenshot_desc'), 'screenshot', featureFlags.screenshot,
    );
    this.screenshotCheckbox = screenshotCheckbox;

    const { label: speedControlsLabel, checkbox: speedControlsCheckbox } = this.buildSettingsToggle(
      t('setting.speed'), t('setting.speed_desc'), 'speedControls', featureFlags.speedControls,
    );
    this.speedControlsCheckbox = speedControlsCheckbox;

    playerGroup.append(
      autoTheaterLabel,
      captionGuardLabel,
      rewindControlsLabel,
      liveCatchupLabel,
      qualityLockLabel,
      screenshotLabel,
      speedControlsLabel,
    );
    player.append(playerGroup);

    const hotkeys = this.buildDashboardPane('hotkeys');
    hotkeys.append(this.buildPaneIntro(t('panel.shortcuts_intro')));

    const hotkeyList = document.createElement('div');
    hotkeyList.className = 'kickflow-panel__hotkeys';
    for (const definition of HOTKEY_DEFINITIONS) hotkeyList.append(this.buildHotkeyRow(definition.action, hotkeyLabel(definition.action)));

    const hotkeyFooter = document.createElement('div');
    hotkeyFooter.className = 'kickflow-panel__hotkey-footer';
    const hotkeyStatus = document.createElement('span');
    hotkeyStatus.className = 'kickflow-panel__hotkey-status';
    hotkeyStatus.setAttribute('role', 'status');
    hotkeyStatus.setAttribute('aria-live', 'polite');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'kickflow-panel__hotkey-reset';
    reset.textContent = t('common.reset_defaults');
    reset.addEventListener('click', () => {
      this.finishHotkeyCapture();
      resetHotkeyBindings();
      this.refreshHotkeyControls();
      this.setHotkeyStatus(t('hotkey.reset'));
    });
    hotkeyFooter.append(hotkeyStatus, reset);
    this.hotkeyStatus = hotkeyStatus;

    const hint = document.createElement('p');
    hint.className = 'kickflow-panel__settings-hint';
    hint.textContent = t('panel.changes_live');

    hotkeys.append(hotkeyList, hotkeyFooter, hint);

    const about = this.buildDashboardPane('about');
    const aboutMark = document.createElement('div');
    aboutMark.className = 'kickflow-panel__about-mark';
    aboutMark.textContent = 'KickFlow';
    const aboutText = document.createElement('p');
    aboutText.className = 'kickflow-panel__about-copy';
    aboutText.textContent = t('about.copy');
    const aboutFacts = document.createElement('dl');
    aboutFacts.className = 'kickflow-panel__about-facts';
    for (const [label, value] of [[t('about.version'), getExtensionVersion()], [t('about.platform'), 'Chrome MV3'], [t('about.application'), t('about.application_value')]]) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      row.append(term, detail);
      aboutFacts.append(row);
    }
    about.append(aboutMark, aboutText, aboutFacts);

    settings.append(general, removed, chat, player, hotkeys, about);
    return settings;
  }

  private buildDashboardPane(key: DashboardSection): HTMLElement {
    const pane = document.createElement('section');
    pane.className = 'kickflow-panel__section';
    pane.id = `kickflow-dashboard-${key}`;
    pane.dataset.section = key;
    pane.setAttribute('role', 'region');
    pane.setAttribute('aria-labelledby', `kickflow-dashboard-title`);
    this.dashboardSections.set(key, pane);
    return pane;
  }

  private buildPaneIntro(text: string): HTMLParagraphElement {
    const intro = document.createElement('p');
    intro.className = 'kickflow-panel__section-intro';
    intro.textContent = text;
    return intro;
  }

  private buildGroupTitle(text: string): HTMLHeadingElement {
    const title = document.createElement('h2');
    title.className = 'kickflow-panel__settings-title';
    title.textContent = text;
    return title;
  }

  private buildRowCopy(labelText: string, description: string): HTMLElement {
    const copy = document.createElement('div');
    copy.className = 'kickflow-panel__settings-copy';
    const label = document.createElement('span');
    label.className = 'kickflow-panel__settings-label';
    label.textContent = labelText;
    const detail = document.createElement('span');
    detail.className = 'kickflow-panel__settings-description';
    detail.textContent = description;
    copy.append(label, detail);
    return copy;
  }

  private buildStat(labelText: string): { row: HTMLElement; value: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'kickflow-panel__stat';
    const label = document.createElement('dt');
    label.textContent = labelText;
    const value = document.createElement('dd');
    value.className = 'kickflow-panel__stat-value--missing';
    value.textContent = '—';
    row.append(label, value);
    return { row, value };
  }

  private buildHotkeyRow(action: HotkeyAction, labelText: string): HTMLElement {
    const binding = getHotkeyBindings()[action];
    const row = document.createElement('div');
    row.className = 'kickflow-panel__hotkey-row';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'kickflow-panel__settings-toggle kickflow-panel__hotkey-enabled';
    enabled.checked = binding.enabled;
    enabled.setAttribute('aria-label', t('hotkey.enable_aria', { name: labelText }));
    enabled.addEventListener('change', () => {
      updateHotkeyBinding(action, { enabled: enabled.checked });
      this.refreshHotkeyControls();
    });

    const label = document.createElement('span');
    label.className = 'kickflow-panel__hotkey-label';
    label.textContent = labelText;

    const chip = document.createElement('kbd');
    chip.className = 'kickflow-panel__hotkey-chip';
    chip.textContent = formatHotkeyKey(binding.key);

    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'kickflow-panel__hotkey-change';
    change.setAttribute('aria-label', t('hotkey.change_aria', { name: labelText }));
    change.textContent = t('common.change');
    change.addEventListener('click', () => this.startHotkeyCapture(action));

    row.append(label, chip, change, enabled);
    this.hotkeyRows.set(action, { enabled, chip, change });
    return row;
  }

  private startHotkeyCapture(action: HotkeyAction): void {
    this.captureAction = action;
    setHotkeyCaptureActive(true);
    this.setHotkeyStatus(t('hotkey.press_key_cancel'));
    this.refreshHotkeyControls();
  }

  private finishHotkeyCapture(message?: string): void {
    this.captureAction = null;
    setHotkeyCaptureActive(false);
    if (message !== undefined) this.setHotkeyStatus(message);
    this.refreshHotkeyControls();
  }

  private onHotkeyCapture(event: KeyboardEvent): void {
    const action = this.captureAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.key === 'Escape') {
      this.finishHotkeyCapture(t('hotkey.cancelled'));
      return;
    }
    const key = normalizeHotkeyKey(event.key);
    if (key === null) {
      this.setHotkeyStatus(t('hotkey.modifier_invalid'));
      return;
    }

    const result = updateHotkeyBinding(action, { key });
    if (!result.ok) {
      if (result.reason === 'collision' && result.conflictingAction) {
        const conflict = hotkeyLabel(result.conflictingAction);
        this.setHotkeyStatus(t('hotkey.collision', { name: conflict }));
      } else {
        this.setHotkeyStatus(t('hotkey.invalid'));
      }
      return;
    }

    this.finishHotkeyCapture(
      result.nativeConflict ? t('hotkey.saved_native_conflict') : t('hotkey.saved'),
    );
  }

  private setHotkeyStatus(message: string): void {
    if (this.hotkeyStatus) this.hotkeyStatus.textContent = message;
  }

  private refreshHotkeyControls(): void {
    const bindings = getHotkeyBindings();
    for (const action of HOTKEY_ACTIONS) {
      const controls = this.hotkeyRows.get(action);
      if (!controls) continue;
      const capturing = this.captureAction === action;
      controls.enabled.checked = bindings[action].enabled;
      controls.chip.textContent = capturing ? t('hotkey.press_key').toLocaleLowerCase(getLang() === 'tr' ? 'tr-TR' : 'en-US') : formatHotkeyKey(bindings[action].key);
      controls.chip.classList.toggle('kickflow-panel__hotkey-chip--capturing', capturing);
      controls.change.textContent = t('common.change');
      controls.change.classList.toggle('kickflow-panel__hotkey-change--capturing', capturing);
    }
  }

  private buildSettingsToggle(
    labelText: string,
    description: string,
    key: string,
    checked: boolean,
  ): { label: HTMLLabelElement; checkbox: HTMLInputElement } {
    const label = document.createElement('label');
    label.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--toggle';
    const copy = this.buildRowCopy(labelText, description);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'kickflow-panel__settings-toggle';
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => dispatchFlag(key, checkbox.checked));
    label.append(copy, checkbox);
    return { label, checkbox };
  }

  private buildMentionStyleControl(): HTMLElement {
    return this.buildSegmentedStyleControl({
      labelKey: 'setting.mention_style',
      descriptionKey: 'setting.mention_style_desc',
      flagKey: 'mentionHighlightStyle',
      options: [
        { value: 'frame', labelKey: 'setting.mention_style_frame' },
        { value: 'fill', labelKey: 'setting.mention_style_fill' },
        { value: 'both', labelKey: 'setting.mention_style_both' },
      ],
      buttonMap: this.mentionStyleButtons,
      sync: () => this.syncMentionStyleButtons(),
    });
  }

  private buildRoleStyleControl(): HTMLElement {
    return this.buildSegmentedStyleControl({
      labelKey: 'setting.role_style',
      descriptionKey: 'setting.role_style_desc',
      flagKey: 'roleHighlightStyle',
      options: [
        { value: 'frame', labelKey: 'setting.role_style_frame' },
        { value: 'both', labelKey: 'setting.role_style_both' },
      ],
      buttonMap: this.roleStyleButtons,
      sync: () => this.syncRoleStyleButtons(),
    });
  }

  private buildSegmentedStyleControl<T extends string>(config: {
    labelKey: MessageKey;
    descriptionKey: MessageKey;
    flagKey: string;
    options: Array<{ value: T; labelKey: MessageKey }>;
    buttonMap: Map<T, HTMLButtonElement>;
    sync: () => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--stack';
    row.appendChild(this.buildRowCopy(t(config.labelKey), t(config.descriptionKey)));
    const group = document.createElement('div');
    group.className = 'kickflow-panel__segmented';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(config.labelKey));
    config.buttonMap.clear();
    for (const option of config.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kickflow-panel__segment';
      button.textContent = t(option.labelKey);
      button.addEventListener('click', () => dispatchFlag(config.flagKey, option.value));
      config.buttonMap.set(option.value, button);
      group.appendChild(button);
    }
    config.sync();
    row.appendChild(group);
    return row;
  }

  private buildRoleColorsDisclosure(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'kickflow-panel__role-colors';
    const summary = document.createElement('summary');
    const copy = document.createElement('div');
    copy.className = 'kickflow-panel__role-colors-copy';
    const title = document.createElement('span');
    title.textContent = t('setting.role_colors');
    const desc = document.createElement('span');
    desc.className = 'kickflow-panel__role-colors-desc';
    desc.textContent = t('setting.role_colors_desc');
    copy.append(title, desc);
    const dots = document.createElement('span');
    dots.className = 'kickflow-panel__role-color-dots';
    const modDot = document.createElement('span');
    modDot.className = 'kickflow-panel__role-color-dot';
    modDot.setAttribute('aria-hidden', 'true');
    const vipDot = document.createElement('span');
    vipDot.className = 'kickflow-panel__role-color-dot';
    vipDot.setAttribute('aria-hidden', 'true');
    dots.append(modDot, vipDot);
    this.roleColorDots = { mod: modDot, vip: vipDot };
    summary.append(copy, dots);
    details.appendChild(summary);

    const modFrameColorRow = this.buildHighlightColorControl(
      'modFrameColor',
      'setting.mod_frame_color',
      'setting.mod_frame_color_desc',
      'setting.mod_frame_color_warn',
      () => featureFlags.modFrameColor,
    );
    const vipFrameColorRow = this.buildHighlightColorControl(
      'vipFrameColor',
      'setting.vip_frame_color',
      'setting.vip_frame_color_desc',
      'setting.vip_frame_color_warn',
      () => featureFlags.vipFrameColor,
    );
    details.append(modFrameColorRow, vipFrameColorRow);
    this.syncRoleColorDots();
    return details;
  }

  private buildHighlightColorControl(
    key: HighlightColorFlagKey,
    labelKey: MessageKey,
    descriptionKey: MessageKey,
    warningKey: MessageKey,
    getCurrentColor: () => string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--stack';
    row.appendChild(this.buildRowCopy(t(labelKey), t(descriptionKey)));
    const swatches = document.createElement('div');
    swatches.className = 'kickflow-panel__swatches';
    const swatchButtons = new Map<string, HTMLButtonElement>();
    const warn = document.createElement('p');
    warn.className = 'kickflow-panel__color-warn';
    warn.textContent = t(warningKey);
    warn.hidden = true;
    for (const hex of MENTION_COLOR_SWATCHES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kickflow-panel__swatch';
      button.title = hex;
      button.setAttribute('aria-label', hex);
      button.style.backgroundColor = hex;
      button.addEventListener('click', () => {
        warn.hidden = true;
        dispatchFlag(key, hex);
      });
      swatchButtons.set(hex.toUpperCase(), button);
      swatches.appendChild(button);
    }
    const customWrap = document.createElement('label');
    customWrap.className = 'kickflow-panel__swatch-custom';
    customWrap.title = t(labelKey);
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = normalizeHexColor(getCurrentColor()) ?? MENTION_COLOR_SWATCHES[0];
    custom.addEventListener('input', () => {
      const raw = custom.value;
      const sanitized = sanitizeHighlightColor(raw);
      const changed = normalizeHexColor(sanitized) !== normalizeHexColor(raw);
      warn.hidden = !changed;
      dispatchFlag(key, sanitized);
      if (changed) custom.value = sanitized;
    });
    customWrap.appendChild(custom);
    swatches.appendChild(customWrap);
    row.append(swatches, warn);
    this.highlightColorControls.set(key, { swatchButtons, customInput: custom, getCurrentColor });
    this.syncHighlightColorControls();
    return row;
  }

  private buildManualUsernameControl(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'kickflow-panel__settings-row kickflow-panel__settings-row--stack';
    row.appendChild(this.buildRowCopy(t('setting.manual_username'), t('setting.manual_username_desc')));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'kickflow-panel__identity-input';
    input.autocomplete = 'username';
    input.spellcheck = false;
    input.maxLength = 25;
    input.placeholder = t('setting.manual_username_placeholder');
    input.value = featureFlags.manualUsername;
    input.addEventListener('change', () => dispatchFlag('manualUsername', input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        dispatchFlag('manualUsername', input.value);
        input.blur();
      }
    });
    this.manualUsernameInput = input;
    const note = document.createElement('p');
    note.className = 'kickflow-panel__identity-note';
    note.textContent = t('setting.identity_unresolved');
    this.identityNote = note;
    this.syncIdentityNote();
    row.append(input, note);
    return row;
  }

  private syncMentionStyleButtons(): void {
    const current = featureFlags.mentionHighlightStyle;
    for (const [value, button] of this.mentionStyleButtons) {
      button.classList.toggle('kickflow-panel__segment--active', value === current);
      button.setAttribute('aria-pressed', value === current ? 'true' : 'false');
    }
  }

  private syncRoleStyleButtons(): void {
    const current = featureFlags.roleHighlightStyle;
    for (const [value, button] of this.roleStyleButtons) {
      button.classList.toggle('kickflow-panel__segment--active', value === current);
      button.setAttribute('aria-pressed', value === current ? 'true' : 'false');
    }
  }

  private syncRoleColorDots(): void {
    if (!this.roleColorDots) return;
    this.roleColorDots.mod.style.backgroundColor =
      normalizeHexColor(featureFlags.modFrameColor) ?? featureFlags.modFrameColor;
    this.roleColorDots.vip.style.backgroundColor =
      normalizeHexColor(featureFlags.vipFrameColor) ?? featureFlags.vipFrameColor;
  }

  private syncHighlightColorControls(): void {
    for (const { swatchButtons, customInput, getCurrentColor } of this.highlightColorControls.values()) {
      const current = (normalizeHexColor(getCurrentColor()) ?? MENTION_COLOR_SWATCHES[0]).toUpperCase();
      for (const [hex, button] of swatchButtons) {
        button.classList.toggle('kickflow-panel__swatch--active', hex === current);
      }
      if (customInput.value.toUpperCase() !== current) {
        customInput.value = current;
      }
    }
  }

  private syncIdentityNote(): void {
    if (!this.identityNote) return;
    this.identityNote.hidden = isOwnerIdentityResolved();
  }

  private showDashboardSection(key: DashboardSection, resetScroll = true): void {
    this.activeSection = key;
    for (const item of DASHBOARD_SECTIONS) {
      const active = item.key === key;
      const pane = this.dashboardSections.get(item.key);
      if (pane) pane.hidden = !active;
      const button = this.navButtons.get(item.key);
      if (button) {
        button.classList.toggle('kickflow-panel__nav-item--active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
      }
      if (active && this.titleHeading) this.titleHeading.textContent = t(item.labelKey);
    }
    if (resetScroll) {
      const settings = this.main?.querySelector<HTMLElement>(`.${PANEL_SETTINGS_CLASS}`);
      if (settings) settings.scrollTop = 0;
    }
  }

  private refreshStats(): void {
    const stats = this.stats;
    if (!stats) return;
    const snapshot = this.getStatusSnapshot();
    const connected = snapshot.pusherConnected;
    const missingConnection = !connected && !snapshot.slug;
    stats.connection.replaceChildren(
      stats.connectionDot,
      document.createTextNode(connected ? t('common.connected') : (snapshot.slug ? t('common.waiting') : '—')),
    );
    stats.connection.classList.toggle('kickflow-panel__stat-value--missing', missingConnection);
    stats.connectionDot.classList.toggle('kickflow-panel__live-dot--connected', connected);
    this.setStatValue(stats.channel, snapshot.slug);
    this.setStatValue(stats.chatroom, snapshot.chatroomId);
    this.setStatValue(stats.messages, snapshot.messageCount);
    this.setStatValue(stats.preserved, snapshot.preservedCount);
    this.setStatValue(stats.banned, snapshot.bannedCount);
    this.setStatValue(stats.deleted, snapshot.deletedCount);
    this.setStatValue(stats.ghostAnchored, snapshot.ghostAnchored);
    this.setStatValue(stats.ghostPending, snapshot.ghostPendingNoAnchor);
    this.setStatValue(stats.ghostEvicted, snapshot.ghostEvicted);
    this.setStatValue(stats.lastBan, snapshot.lastBanAt === null ? null : this.formatAgo(snapshot.lastBanAt));
  }

  private setStatValue(element: HTMLElement, value: string | number | null): void {
    const missing = value === null || value === '';
    element.textContent = missing ? '—' : String(value);
    element.classList.toggle('kickflow-panel__stat-value--missing', missing);
  }

  private formatAgo(timestamp: number | null): string {
    if (timestamp === null) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return t('time.seconds_ago', { n: seconds });
    const minutes = Math.round(seconds / 60);
    return minutes < 60
      ? t('time.minutes_ago', { n: minutes })
      : t('time.hours_ago', { n: Math.round(minutes / 60) });
  }

  private onDashboardKeydown(event: KeyboardEvent): void {
    if (!this.open || !this.shell) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(this.shell.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.closest('[hidden]'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.shell.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.shell.contains(active))) {
      event.preventDefault();
      first.focus();
    }
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
    if (this.subscriptionsCheckbox && this.subscriptionsCheckbox.checked !== featureFlags.showSubscriptions) {
      this.subscriptionsCheckbox.checked = featureFlags.showSubscriptions;
    }
    if (this.giftedSubsCheckbox && this.giftedSubsCheckbox.checked !== featureFlags.showGiftedSubs) {
      this.giftedSubsCheckbox.checked = featureFlags.showGiftedSubs;
    }
    if (this.kicksCheckbox && this.kicksCheckbox.checked !== featureFlags.showKicks) {
      this.kicksCheckbox.checked = featureFlags.showKicks;
    }
    if (this.hostRaidCheckbox && this.hostRaidCheckbox.checked !== featureFlags.showHostRaid) {
      this.hostRaidCheckbox.checked = featureFlags.showHostRaid;
    }
    if (this.modeChangesCheckbox && this.modeChangesCheckbox.checked !== featureFlags.showModeChanges) {
      this.modeChangesCheckbox.checked = featureFlags.showModeChanges;
    }
    if (this.sidebarRefreshCheckbox && this.sidebarRefreshCheckbox.checked !== featureFlags.showSidebarRefresh) {
      this.sidebarRefreshCheckbox.checked = featureFlags.showSidebarRefresh;
    }
    if (this.chattersBadgesCheckbox && this.chattersBadgesCheckbox.checked !== featureFlags.showChattersBadges) {
      this.chattersBadgesCheckbox.checked = featureFlags.showChattersBadges;
    }
    if (this.mentionHighlightCheckbox && this.mentionHighlightCheckbox.checked !== featureFlags.mentionHighlightEnabled) {
      this.mentionHighlightCheckbox.checked = featureFlags.mentionHighlightEnabled;
    }
    if (this.modFrameCheckbox && this.modFrameCheckbox.checked !== featureFlags.modFrameEnabled) {
      this.modFrameCheckbox.checked = featureFlags.modFrameEnabled;
    }
    if (this.vipFrameCheckbox && this.vipFrameCheckbox.checked !== featureFlags.vipFrameEnabled) {
      this.vipFrameCheckbox.checked = featureFlags.vipFrameEnabled;
    }
    this.syncMentionStyleButtons();
    this.syncRoleStyleButtons();
    this.syncHighlightColorControls();
    this.syncRoleColorDots();
    if (this.manualUsernameInput && this.manualUsernameInput.value !== featureFlags.manualUsername
      && document.activeElement !== this.manualUsernameInput) {
      this.manualUsernameInput.value = featureFlags.manualUsername;
    }
    this.syncIdentityNote();
    if (this.autoTheaterCheckbox && this.autoTheaterCheckbox.checked !== featureFlags.autoTheater) {
      this.autoTheaterCheckbox.checked = featureFlags.autoTheater;
    }
    if (this.captionGuardCheckbox && this.captionGuardCheckbox.checked !== featureFlags.captionGuard) {
      this.captionGuardCheckbox.checked = featureFlags.captionGuard;
    }
    if (this.rewindControlsCheckbox && this.rewindControlsCheckbox.checked !== featureFlags.rewindControls) {
      this.rewindControlsCheckbox.checked = featureFlags.rewindControls;
    }
    if (this.liveCatchupCheckbox && this.liveCatchupCheckbox.checked !== featureFlags.liveCatchup) {
      this.liveCatchupCheckbox.checked = featureFlags.liveCatchup;
    }
    if (this.qualityLockCheckbox && this.qualityLockCheckbox.checked !== featureFlags.qualityLock) {
      this.qualityLockCheckbox.checked = featureFlags.qualityLock;
    }
    if (this.screenshotCheckbox && this.screenshotCheckbox.checked !== featureFlags.screenshot) {
      this.screenshotCheckbox.checked = featureFlags.screenshot;
    }
    if (this.speedControlsCheckbox && this.speedControlsCheckbox.checked !== featureFlags.speedControls) {
      this.speedControlsCheckbox.checked = featureFlags.speedControls;
    }
    this.refreshHotkeyControls();
  }

  private refreshUserFilterChip(): void {
    if (!this.filterChip) return;
    const filter = this.userFilter;
    this.filterChip.hidden = filter === null;
    if (!filter) {
      this.filterChip.textContent = '';
      this.filterChip.removeAttribute('aria-label');
      return;
    }
    this.filterChip.textContent = `${t('panel.filtered_user', { name: filter.label })} ×`;
    this.filterChip.setAttribute('aria-label', t('panel.clear_user_filter', { name: filter.label }));
  }

  private clearUserFilter(): void {
    if (!this.userFilter) return;
    this.userFilter = null;
    this.lastSig = '';
    this.render();
  }

  /** Builds a moderation-ledger row without changing the store's preservation annotations. */
  private buildRow(message: ChatMessage): HTMLElement {
    const row = document.createElement('div');
    row.className = REMOVED_ROW_CLASS;
    row.dataset.kickflowRemovedMid = message.id;
    row.setAttribute('role', 'listitem');

    const time = document.createElement('time');
    time.className = 'kickflow-removed-row__time';
    const createdAt = new Date(message.createdAt);
    time.textContent = Number.isNaN(createdAt.getTime())
      ? ''
      : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    if (!Number.isNaN(createdAt.getTime())) time.dateTime = message.createdAt;

    const messageCopy = document.createElement('div');
    messageCopy.className = 'kickflow-removed-row__message';

    const username = document.createElement('span');
    username.className = 'kickflow-removed-row__username';
    const displayName = message.sender.displayName || message.sender.username;
    username.textContent = displayName;
    wireUsernameProfileLink(username, message.sender, displayName, 'kickflow-removed-row__username--link');
    username.style.color = message.sender.identity.color || 'inherit';

    const content = document.createElement('span');
    content.className = 'kickflow-removed-row__content';
    appendParsedContent(content, message.content);
    messageCopy.append(username, content);

    row.append(time, messageCopy);
    applyPreservedMarking(row, message);

    const action = document.createElement('div');
    action.className = 'kickflow-removed-row__action';
    const status = row.querySelector<HTMLElement>('.kickflow-status-label');
    const moderator = row.querySelector<HTMLElement>('.kickflow-mod-label');
    if (status) action.append(status);
    if (moderator) action.append(moderator);
    row.append(action);
    return row;
  }

  /** Rebuilds the open dashboard from catalog values. Existing chat rows intentionally keep
   * their creation-time copy; newly rendered rows use the current language. */
  private rebuildForLanguage(): void {
    this.finishHotkeyCapture();
    this.removeSection();
    this.lastSig = '';
    this.render();
    if (this.open) this.showDashboardSection(this.activeSection, false);
  }

  /** Drops all DOM references so an externally removed body-level dashboard can self-heal. */
  private removeSection(): void {
    if (this.section) {
      this.section.remove();
      this.section = null;
    }
    this.shell = null;
    this.main = null;
    this.titleHeading = null;
    this.stats = null;
    this.countChip = null;
    this.dashboardSections.clear();
    this.navButtons.clear();
    this.chatModeSelect = null;
    this.showDeletedCheckbox = null;
    this.banInlineCheckbox = null;
    this.subscriptionsCheckbox = null;
    this.giftedSubsCheckbox = null;
    this.kicksCheckbox = null;
    this.hostRaidCheckbox = null;
    this.modeChangesCheckbox = null;
    this.sidebarRefreshCheckbox = null;
    this.chattersBadgesCheckbox = null;
    this.mentionHighlightCheckbox = null;
    this.modFrameCheckbox = null;
    this.vipFrameCheckbox = null;
    this.mentionStyleButtons.clear();
    this.roleStyleButtons.clear();
    this.highlightColorControls.clear();
    this.roleColorDots = null;
    this.manualUsernameInput = null;
    this.identityNote = null;
    this.autoTheaterCheckbox = null;
    this.captionGuardCheckbox = null;
    this.rewindControlsCheckbox = null;
    this.liveCatchupCheckbox = null;
    this.qualityLockCheckbox = null;
    this.screenshotCheckbox = null;
    this.speedControlsCheckbox = null;
    this.hotkeyRows.clear();
    this.hotkeyStatus = null;
    this.filterChip = null;
  }

  private lockDocumentScroll(): void {
    if (this.scrollLockState) return;
    this.scrollLockState = {
      rootOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private unlockDocumentScroll(): void {
    const prior = this.scrollLockState;
    if (!prior) return;
    document.documentElement.style.overflow = prior.rootOverflow;
    document.body.style.overflow = prior.bodyOverflow;
    this.scrollLockState = null;
  }

  private dispose(): void {
    this.finishHotkeyCapture();
    this.open = false;
    this.opener = null;
    this.openerId = null;
    this.unlockDocumentScroll();
    this.removeSection();
  }
}
