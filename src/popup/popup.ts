// KickFlow popup: reports live status of the content script on the active Kick tab and exposes
// two flag toggles. Talks to the content script over chrome.tabs.sendMessage (activeTab grants
// access on popup open). No inline script (MV3 CSP) — this is built to dist/popup.js.

interface StatusResponse {
  slug: string | null;
  chatroomId: number | null;
  active: boolean;
  reason: string;
  pusherConnected: boolean;
  lastBanAt: number | null;
  messageCount: number;
  preservedCount: number;
  bannedCount: number;
  deletedCount: number;
  ghostAnchored: number;
  ghostPendingNoAnchor: number;
  ghostStrip: number;
  ghostEvicted: number;
  flags: {
    chatMode: 'native' | 'own';
    showDeletedMessages: boolean;
    preserveBansInline: boolean;
    debugLogging: boolean;
  };
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function setDot(state: 'active' | 'native' | 'off'): void {
  const dot = $('dot');
  dot.className = 'dot dot--' + state;
}

function fmtAgo(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + ' sn önce';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' dk önce' : Math.round(m / 60) + ' sa önce';
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
  $('reason').textContent = res.active ? `✅ KickFlow aktif — ${res.flags.chatMode} chat` : ('○ ' + res.reason);

  $('slug').textContent = res.slug || '—';
  $('chatroomId').textContent = res.chatroomId != null ? String(res.chatroomId) : '—';
  $('pusher').textContent = res.pusherConnected ? 'bağlı' : 'değil';
  $('messages').textContent = String(res.messageCount);
  $('preserved').textContent = String(res.preservedCount);
  $('banned').textContent = String(res.bannedCount);
  $('deleted').textContent = String(res.deletedCount);
  $('ghostAnchored').textContent = String(res.ghostAnchored);
  $('ghostPending').textContent = String(res.ghostPendingNoAnchor);
  $('ghostEvicted').textContent = String(res.ghostEvicted);
  $('lastBan').textContent = fmtAgo(res.lastBanAt);

  (($('t-deleted') as HTMLInputElement)).checked = res.flags.showDeletedMessages;
  (($('t-bans-inline') as HTMLInputElement)).checked = res.flags.preserveBansInline;
  (($('t-debug') as HTMLInputElement)).checked = res.flags.debugLogging;
  (($('t-chat-mode') as HTMLSelectElement)).value = res.flags.chatMode;
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

async function setFlag(key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging', value: boolean): Promise<void>;
async function setFlag(key: 'chatMode', value: 'native' | 'own'): Promise<void>;
async function setFlag(
  key: 'showDeletedMessages' | 'preserveBansInline' | 'debugLogging' | 'chatMode',
  value: boolean | 'native' | 'own'
): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return;
  try {
    await chrome.tabs.sendMessage(id, { type: 'kickflow:setFlag', key, value });
  } catch {
    // tab not a Kick tab — ignore
  }
  void refresh();
}

$('t-deleted').addEventListener('change', (e) => setFlag('showDeletedMessages', (e.target as HTMLInputElement).checked));
$('t-bans-inline').addEventListener('change', (e) => setFlag('preserveBansInline', (e.target as HTMLInputElement).checked));
$('t-debug').addEventListener('change', (e) => setFlag('debugLogging', (e.target as HTMLInputElement).checked));
$('t-chat-mode').addEventListener('change', (e) => setFlag('chatMode', (e.target as HTMLSelectElement).value as 'native' | 'own'));

void refresh();
window.setInterval(refresh, 1000);
