// KickFlow popup: reports live status of the content script on the active Kick tab and exposes
// owner-facing flag toggles. Talks to the content script over chrome.tabs.sendMessage (activeTab grants
// access on popup open). No inline script (MV3 CSP); this is built to dist/popup.js.

import {
  HOTKEY_ACTIONS,
  createDefaultHotkeyBindings,
  formatHotkeyKey,
  normalizeHotkeyKey,
  type HotkeyAction,
  type HotkeyBindings,
  type HotkeyUpdateResult,
} from '../content/player/hotkey-registry';
import type { KickFlowStatusSnapshot } from '../content/status';
import { hotkeyLabel, loadLang, t, type MessageKey } from '../content/shared/i18n';

interface StatusResponse extends KickFlowStatusSnapshot {
  flags: {
    chatMode: 'native' | 'own';
    showDeletedMessages: boolean;
    preserveBansInline: boolean;
    debugLogging: boolean;
    showSubscriptions: boolean;
    showGiftedSubs: boolean;
    showKicks: boolean;
    /** Reserved/default-on; native polls remain visible until a stable poll-only selector exists. */
    showPolls: boolean;
    showHostRaid: boolean;
    showModeChanges: boolean;
    showSidebarRefresh: boolean;
    autoTheater: boolean;
    rewindControls: boolean;
    liveCatchup: boolean;
    qualityLock: boolean;
    screenshot: boolean;
    speedControls: boolean;
  };
  hotkeys: HotkeyBindings;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
let capturingAction: HotkeyAction | null = null;
let lastHotkeys: HotkeyBindings | null = null;

function applyStaticTranslations(): void {
  const setText = (selector: string, key: MessageKey): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = t(key);
  };
  setText('.tagline', 'popup.tagline');
  setText('#reason', 'popup.reading_status');
  $('dot').title = t('popup.connection_status');
  setText('.mode-copy strong', 'panel.chat_view');
  setText('.mode-copy span', 'popup.mode_desc');
  $('t-chat-mode').setAttribute('aria-label', t('panel.chat_mode'));
  const sectionTitles = document.querySelectorAll<HTMLElement>('.section-title');
  const titleKeys: MessageKey[] = ['popup.status_stats', 'tab.chat', 'tab.player', 'tab.shortcuts'];
  sectionTitles.forEach((element, index) => { if (titleKeys[index]) element.textContent = t(titleKeys[index]); });
  const statKeys: Array<[string, MessageKey]> = [
    ['slug', 'stat.channel'], ['chatroomId', 'stat.chatroom_id'], ['pusher', 'stat.pusher'],
    ['messages', 'stat.messages'], ['preserved', 'stat.preserved'], ['banned', 'stat.bans'],
    ['deleted', 'stat.deletions'], ['ghostAnchored', 'stat.ghost_inline'],
    ['ghostPending', 'stat.ghost_pending'], ['ghostEvicted', 'stat.ghost_evicted'], ['lastBan', 'stat.last_ban'],
  ];
  for (const [id, key] of statKeys) {
    const label = $(id).parentElement?.querySelector<HTMLElement>('.k');
    if (label) label.textContent = t(key);
  }
  const settingKeys: Array<[string, MessageKey]> = [
    ['t-deleted', 'setting.show_deleted'], ['t-bans-inline', 'setting.inline_bans'],
    ['t-subscriptions', 'setting.subscriptions'], ['t-gifted-subs', 'setting.gifted_subscriptions'],
    ['t-kicks', 'setting.kicks'], ['t-host-raid', 'setting.host_raid'],
    ['t-mode-changes', 'setting.mode_changes'], ['t-sidebar-refresh', 'setting.sidebar_refresh'],
    ['t-debug', 'popup.debug_log'], ['t-auto-theater', 'setting.auto_theater'],
    ['t-rewind-controls', 'setting.seek'], ['t-live-catchup', 'setting.live_catchup'],
    ['t-quality-lock', 'setting.quality_lock'], ['t-screenshot', 'setting.screenshot'],
    ['t-speed-controls', 'setting.speed'],
  ];
  for (const [id, key] of settingKeys) {
    const label = document.querySelector<HTMLElement>(`label[for="${id}"] > span`);
    if (label) label.textContent = t(key);
  }
  for (const action of HOTKEY_ACTIONS) {
    const label = hotkeyLabel(action);
    const row = document.querySelector<HTMLElement>(`[data-hotkey-action="${action}"]`);
    const copy = row?.querySelector<HTMLElement>('span');
    if (copy) copy.textContent = label;
    $(`hk-${action}-enabled`).setAttribute('aria-label', t('hotkey.enable_aria', { name: label }));
    $(`hk-${action}-change`).setAttribute('aria-label', t('hotkey.change_aria', { name: label }));
  }
  $('hotkey-reset').textContent = t('common.reset_defaults');
  setText('.hint', 'popup.changes_hint');
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function setDot(state: 'active' | 'native' | 'off'): void {
  const dot = $('dot');
  dot.className = 'dot dot--' + state;
}

function fmtAgo(ms: number | null): string | null {
  if (!ms) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('time.seconds_ago', { n: s });
  const m = Math.round(s / 60);
  return m < 60 ? t('time.minutes_ago', { n: m }) : t('time.hours_ago', { n: Math.round(m / 60) });
}

function setStatValue(id: string, value: string | number | null): void {
  const element = $(id);
  const missing = value === null || value === '';
  element.textContent = missing ? '—' : String(value);
  element.classList.toggle('missing', missing);
}

function setHotkeyStatus(message: string): void {
  $('hotkey-status').textContent = message;
}

function renderHotkeys(bindings: HotkeyBindings): void {
  lastHotkeys = bindings;
  for (const action of HOTKEY_ACTIONS) {
    const enabled = $(`hk-${action}-enabled`) as HTMLInputElement;
    const chip = $(`hk-${action}-key`);
    const change = $(`hk-${action}-change`) as HTMLButtonElement;
    enabled.checked = bindings[action].enabled;
    chip.textContent = formatHotkeyKey(bindings[action].key);
    change.textContent = capturingAction === action ? t('hotkey.press_key') : t('common.change');
    change.classList.toggle('hotkey-change--capturing', capturingAction === action);
  }
}

function finishHotkeyCapture(message?: string): void {
  capturingAction = null;
  if (message !== undefined) setHotkeyStatus(message);
  if (lastHotkeys) renderHotkeys(lastHotkeys);
}

function render(res: StatusResponse | null, error?: string): void {
  if (error || !res) {
    setDot('off');
    $('reason').textContent = error || t('popup.not_connected');
    $('stats').style.display = 'none';
    $('toggles').style.display = 'none';
    return;
  }
  $('stats').style.display = '';
  $('toggles').style.display = '';
  setDot(res.active ? 'active' : (res.slug ? 'native' : 'off'));
  $('reason').textContent = res.active ? t('popup.active', { mode: res.flags.chatMode }) : res.reason.split('\u2014').join('·');

  setStatValue('slug', res.slug);
  setStatValue('chatroomId', res.chatroomId);
  setStatValue('pusher', res.pusherConnected ? t('popup.pusher_connected') : t('popup.pusher_disconnected'));
  setStatValue('messages', res.messageCount);
  setStatValue('preserved', res.preservedCount);
  setStatValue('banned', res.bannedCount);
  setStatValue('deleted', res.deletedCount);
  setStatValue('ghostAnchored', res.ghostAnchored);
  setStatValue('ghostPending', res.ghostPendingNoAnchor);
  setStatValue('ghostEvicted', res.ghostEvicted);
  setStatValue('lastBan', fmtAgo(res.lastBanAt));

  (($('t-deleted') as HTMLInputElement)).checked = res.flags.showDeletedMessages;
  (($('t-bans-inline') as HTMLInputElement)).checked = res.flags.preserveBansInline;
  (($('t-debug') as HTMLInputElement)).checked = res.flags.debugLogging;
  (($('t-subscriptions') as HTMLInputElement)).checked = res.flags.showSubscriptions;
  (($('t-gifted-subs') as HTMLInputElement)).checked = res.flags.showGiftedSubs;
  (($('t-kicks') as HTMLInputElement)).checked = res.flags.showKicks;
  (($('t-host-raid') as HTMLInputElement)).checked = res.flags.showHostRaid;
  (($('t-mode-changes') as HTMLInputElement)).checked = res.flags.showModeChanges;
  (($('t-sidebar-refresh') as HTMLInputElement)).checked = res.flags.showSidebarRefresh;
  (($('t-auto-theater') as HTMLInputElement)).checked = res.flags.autoTheater;
  (($('t-rewind-controls') as HTMLInputElement)).checked = res.flags.rewindControls;
  (($('t-live-catchup') as HTMLInputElement)).checked = res.flags.liveCatchup;
  (($('t-quality-lock') as HTMLInputElement)).checked = res.flags.qualityLock;
  (($('t-screenshot') as HTMLInputElement)).checked = res.flags.screenshot;
  (($('t-speed-controls') as HTMLInputElement)).checked = res.flags.speedControls;
  (($('t-chat-mode') as HTMLSelectElement)).value = res.flags.chatMode;
  renderHotkeys(res.hotkeys ?? createDefaultHotkeyBindings());
}

async function refresh(): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return render(null, t('popup.no_active_tab'));
  try {
    const res = (await chrome.tabs.sendMessage(id, { type: 'kickflow:getStatus' })) as StatusResponse | undefined;
    if (!res) return render(null, t('popup.not_kick_tab'));
    render(res);
  } catch {
    render(null, t('popup.open_kick'));
  }
}

async function setFlag(
  key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging' | 'showSubscriptions' | 'showGiftedSubs' | 'showKicks' | 'showPolls' | 'showHostRaid' | 'showModeChanges' | 'showSidebarRefresh' | 'autoTheater' | 'rewindControls' | 'liveCatchup' | 'qualityLock' | 'screenshot' | 'speedControls',
  value: boolean,
): Promise<void>;
async function setFlag(key: 'chatMode', value: 'native' | 'own'): Promise<void>;
async function setFlag(
  key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging' | 'showSubscriptions' | 'showGiftedSubs' | 'showKicks' | 'showPolls' | 'showHostRaid' | 'showModeChanges' | 'showSidebarRefresh' | 'autoTheater' | 'rewindControls' | 'liveCatchup' | 'qualityLock' | 'screenshot' | 'speedControls' | 'chatMode',
  value: boolean | 'native' | 'own'
): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return;
  try {
    await chrome.tabs.sendMessage(id, { type: 'kickflow:setFlag', key, value });
  } catch {
    // Tab is not a Kick tab; ignore it.
  }
  void refresh();
}

async function setHotkey(action: HotkeyAction, patch: { enabled?: boolean; key?: string }): Promise<HotkeyUpdateResult | null> {
  const id = await activeTabId();
  if (id === undefined) return null;
  try {
    return await chrome.tabs.sendMessage(id, { type: 'kickflow:setHotkey', action, patch }) as HotkeyUpdateResult;
  } catch {
    setHotkeyStatus(t('popup.tab_unavailable'));
    return null;
  }
}

async function resetHotkeys(): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return;
  try {
    const result = await chrome.tabs.sendMessage(id, { type: 'kickflow:resetHotkeys' }) as { ok: boolean; bindings: HotkeyBindings };
    if (result?.bindings) renderHotkeys(result.bindings);
    setHotkeyStatus(t('hotkey.reset'));
  } catch {
    setHotkeyStatus(t('popup.tab_unavailable'));
  }
}

$('t-deleted').addEventListener('change', (e) => setFlag('showDeletedMessages', (e.target as HTMLInputElement).checked));
$('t-bans-inline').addEventListener('change', (e) => setFlag('preserveBansInline', (e.target as HTMLInputElement).checked));
$('t-debug').addEventListener('change', (e) => setFlag('debugLogging', (e.target as HTMLInputElement).checked));
$('t-subscriptions').addEventListener('change', (e) => setFlag('showSubscriptions', (e.target as HTMLInputElement).checked));
$('t-gifted-subs').addEventListener('change', (e) => setFlag('showGiftedSubs', (e.target as HTMLInputElement).checked));
$('t-kicks').addEventListener('change', (e) => setFlag('showKicks', (e.target as HTMLInputElement).checked));
$('t-host-raid').addEventListener('change', (e) => setFlag('showHostRaid', (e.target as HTMLInputElement).checked));
$('t-mode-changes').addEventListener('change', (e) => setFlag('showModeChanges', (e.target as HTMLInputElement).checked));
$('t-sidebar-refresh').addEventListener('change', (e) => setFlag('showSidebarRefresh', (e.target as HTMLInputElement).checked));
$('t-auto-theater').addEventListener('change', (e) => setFlag('autoTheater', (e.target as HTMLInputElement).checked));
$('t-rewind-controls').addEventListener('change', (e) => setFlag('rewindControls', (e.target as HTMLInputElement).checked));
$('t-live-catchup').addEventListener('change', (e) => setFlag('liveCatchup', (e.target as HTMLInputElement).checked));
$('t-quality-lock').addEventListener('change', (e) => setFlag('qualityLock', (e.target as HTMLInputElement).checked));
$('t-screenshot').addEventListener('change', (e) => setFlag('screenshot', (e.target as HTMLInputElement).checked));
$('t-speed-controls').addEventListener('change', (e) => setFlag('speedControls', (e.target as HTMLInputElement).checked));
$('t-chat-mode').addEventListener('change', (e) => setFlag('chatMode', (e.target as HTMLSelectElement).value as 'native' | 'own'));

for (const action of HOTKEY_ACTIONS) {
  $(`hk-${action}-enabled`).addEventListener('change', async (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    const result = await setHotkey(action, { enabled });
    if (result?.bindings) renderHotkeys(result.bindings);
  });
  $(`hk-${action}-change`).addEventListener('click', () => {
    capturingAction = action;
    setHotkeyStatus(t('hotkey.press_key_cancel'));
    if (lastHotkeys) renderHotkeys(lastHotkeys);
  });
}

document.addEventListener('keydown', (event) => {
  const action = capturingAction;
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    finishHotkeyCapture(t('hotkey.cancelled'));
    return;
  }
  const key = normalizeHotkeyKey(event.key);
  if (key === null) {
    setHotkeyStatus(t('hotkey.modifier_invalid'));
    return;
  }
  void setHotkey(action, { key }).then((result) => {
    if (!result) return;
    if (!result.ok) {
      if (result.reason === 'collision' && result.conflictingAction) {
        const conflict = hotkeyLabel(result.conflictingAction);
        setHotkeyStatus(t('hotkey.collision', { name: conflict }));
      } else {
        setHotkeyStatus(t('hotkey.invalid'));
      }
      if (result.bindings) renderHotkeys(result.bindings);
      return;
    }
    if (result.bindings) lastHotkeys = result.bindings;
    finishHotkeyCapture(
      result.nativeConflict ? t('hotkey.saved_native_conflict') : t('hotkey.saved'),
    );
  });
}, true);

$('hotkey-reset').addEventListener('click', () => {
  finishHotkeyCapture();
  void resetHotkeys();
});

async function main(): Promise<void> {
  await loadLang();
  applyStaticTranslations();
  await refresh();
  window.setInterval(refresh, 1000);
}

void main();
