// KickFlow popup: reports live status of the content script on the active Kick tab and exposes
// owner-facing flag toggles. Talks to the content script over chrome.tabs.sendMessage (activeTab grants
// access on popup open). No inline script (MV3 CSP); this is built to dist/popup.js.

import {
  HOTKEY_ACTIONS,
  HOTKEY_DEFINITIONS,
  createDefaultHotkeyBindings,
  formatHotkeyKey,
  normalizeHotkeyKey,
  type HotkeyAction,
  type HotkeyBindings,
  type HotkeyUpdateResult,
} from '../content/player/hotkey-registry';
import type { KickFlowStatusSnapshot } from '../content/status';

interface StatusResponse extends KickFlowStatusSnapshot {
  flags: {
    chatMode: 'native' | 'own';
    showDeletedMessages: boolean;
    preserveBansInline: boolean;
    debugLogging: boolean;
    showSubscriptions: boolean;
    showGiftedSubs: boolean;
    showHostRaid: boolean;
    showPinnedMessage: boolean;
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
  if (s < 60) return s + ' sn önce';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' dk önce' : Math.round(m / 60) + ' sa önce';
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
    change.textContent = capturingAction === action ? 'Bir tuşa bas…' : 'Değiştir';
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
    $('reason').textContent = error || 'bağlanamadı';
    $('stats').style.display = 'none';
    $('toggles').style.display = 'none';
    return;
  }
  $('stats').style.display = '';
  $('toggles').style.display = '';
  setDot(res.active ? 'active' : (res.slug ? 'native' : 'off'));
  $('reason').textContent = res.active ? `KickFlow aktif · ${res.flags.chatMode} chat` : res.reason.split('\u2014').join('·');

  setStatValue('slug', res.slug);
  setStatValue('chatroomId', res.chatroomId);
  setStatValue('pusher', res.pusherConnected ? 'bağlı' : 'değil');
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
  (($('t-host-raid') as HTMLInputElement)).checked = res.flags.showHostRaid;
  (($('t-pinned-message') as HTMLInputElement)).checked = res.flags.showPinnedMessage;
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
  if (id === undefined) return render(null, 'aktif sekme yok');
  try {
    const res = (await chrome.tabs.sendMessage(id, { type: 'kickflow:getStatus' })) as StatusResponse | undefined;
    if (!res) return render(null, 'Kick sekmesi değil / içerik betiği yok');
    render(res);
  } catch {
    render(null, 'Kick sekmesinde değilsin (kick.com aç)');
  }
}

async function setFlag(
  key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging' | 'showSubscriptions' | 'showGiftedSubs' | 'showHostRaid' | 'showPinnedMessage' | 'showModeChanges' | 'showSidebarRefresh' | 'autoTheater' | 'rewindControls' | 'liveCatchup' | 'qualityLock' | 'screenshot' | 'speedControls',
  value: boolean,
): Promise<void>;
async function setFlag(key: 'chatMode', value: 'native' | 'own'): Promise<void>;
async function setFlag(
  key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging' | 'showSubscriptions' | 'showGiftedSubs' | 'showHostRaid' | 'showPinnedMessage' | 'showModeChanges' | 'showSidebarRefresh' | 'autoTheater' | 'rewindControls' | 'liveCatchup' | 'qualityLock' | 'screenshot' | 'speedControls' | 'chatMode',
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
    setHotkeyStatus('Kick sekmesine bağlanılamadı.');
    return null;
  }
}

async function resetHotkeys(): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return;
  try {
    const result = await chrome.tabs.sendMessage(id, { type: 'kickflow:resetHotkeys' }) as { ok: boolean; bindings: HotkeyBindings };
    if (result?.bindings) renderHotkeys(result.bindings);
    setHotkeyStatus('Kısayollar sıfırlandı.');
  } catch {
    setHotkeyStatus('Kick sekmesine bağlanılamadı.');
  }
}

$('t-deleted').addEventListener('change', (e) => setFlag('showDeletedMessages', (e.target as HTMLInputElement).checked));
$('t-bans-inline').addEventListener('change', (e) => setFlag('preserveBansInline', (e.target as HTMLInputElement).checked));
$('t-debug').addEventListener('change', (e) => setFlag('debugLogging', (e.target as HTMLInputElement).checked));
$('t-subscriptions').addEventListener('change', (e) => setFlag('showSubscriptions', (e.target as HTMLInputElement).checked));
$('t-gifted-subs').addEventListener('change', (e) => setFlag('showGiftedSubs', (e.target as HTMLInputElement).checked));
$('t-host-raid').addEventListener('change', (e) => setFlag('showHostRaid', (e.target as HTMLInputElement).checked));
$('t-pinned-message').addEventListener('change', (e) => setFlag('showPinnedMessage', (e.target as HTMLInputElement).checked));
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
    setHotkeyStatus('Bir tuşa bas…  Esc: iptal');
    if (lastHotkeys) renderHotkeys(lastHotkeys);
  });
}

document.addEventListener('keydown', (event) => {
  const action = capturingAction;
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    finishHotkeyCapture('Değişiklik iptal edildi.');
    return;
  }
  const key = normalizeHotkeyKey(event.key);
  if (key === null) {
    setHotkeyStatus('Tek başına bir değiştirici tuş kullanılamaz.');
    return;
  }
  void setHotkey(action, { key }).then((result) => {
    if (!result) return;
    if (!result.ok) {
      if (result.reason === 'collision' && result.conflictingAction) {
        const conflict = HOTKEY_DEFINITIONS.find((item) => item.action === result.conflictingAction)?.label ?? result.conflictingAction;
        setHotkeyStatus(`Bu tuş “${conflict}” için kullanımda.`);
      } else {
        setHotkeyStatus('Bu tuş bağlanamıyor.');
      }
      if (result.bindings) renderHotkeys(result.bindings);
      return;
    }
    if (result.bindings) lastHotkeys = result.bindings;
    finishHotkeyCapture(
      result.nativeConflict ? 'Kaydedildi: Kick’in kendi kısayoluyla çakışabilir.' : 'Kısayol kaydedildi.',
    );
  });
}, true);

$('hotkey-reset').addEventListener('click', () => {
  finishHotkeyCapture();
  void resetHotkeys();
});

void refresh();
window.setInterval(refresh, 1000);
