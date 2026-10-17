import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { RemovedMessagesPanel } from '../../src/content/chat/removed-panel';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { getStatus, resetStatus } from '../../src/content/status';
import { t } from '../../src/content/shared/i18n';
import { NATIVE_CHAT_EVENT } from '../../src/shared/native-chat';

class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  constructor() { super(); Socket.instances.push(this); }
  send(): void { /* No network. */ }
  close(): void { this.dispatchEvent(new Event('close')); }
}

const originalFlags = { ...featureFlags };
let bootstrap: typeof import('../../src/content/bootstrap');
let lifecycle: Lifecycle;

function publication(id: string, socketId = 1): void {
  window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: {
    kind: 'publication', socketId, publication: {
      channel: 'chatrooms.1.v2', event: 'App\\Events\\ChatMessageEvent',
      data: { id, chatroom_id: 1, content: 'Fixture', sender: { id: 7, username: 'fixture' } },
    },
  } }));
}
function nativeLoss(): void {
  window.dispatchEvent(new CustomEvent(NATIVE_CHAT_EVENT, { detail: { kind: 'unavailable', socketId: 1 } }));
}
function active(): boolean { return document.documentElement.classList.contains('kickflow-chat-active'); }

beforeAll(async () => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('chrome', {
    runtime: { id: 'fixture', onMessage: { addListener: vi.fn() } },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  });
  // Bootstrap's automatic page mount is independent of this explicitly owned session.
  vi.stubGlobal('requestIdleCallback', vi.fn());
  bootstrap = await import('../../src/content/bootstrap');
  for (let n = 0; n < 12; n++) await Promise.resolve();
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, json: async () => url.includes('/api/v2/channels/')
      ? { id: 2, chatroom: { id: 1 } }
      : { data: { messages: [] } },
  })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 330, bottom: 500, width: 320, height: 480,
    toJSON: () => ({}),
  });
  document.body.innerHTML = '<div><div id="chatroom-messages"></div></div>';
  featureFlags.chatMode = 'own';
  resetStatus('fixture');
  lifecycle = new Lifecycle();
  bootstrap.initChatIntegrity({ kind: 'live', slug: 'fixture', sessionKey: 'live:fixture' }, lifecycle,
    new RemovedMessagesPanel(lifecycle, null, bootstrap.getLiveStatusSnapshot));
  for (let n = 0; n < 12; n++) await Promise.resolve();
  expect(Socket.instances).toHaveLength(1);
  publication('initial');
  expect(active()).toBe(true);
  // A failed fallback while native is proven must not own the native grace deadline.
  Socket.instances[0].close();
});

afterEach(() => {
  lifecycle.dispose();
  Socket.instances = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => { Object.assign(featureFlags, originalFlags); vi.unstubAllGlobals(); });

describe('own chat native reconnect grace', () => {
  it('keeps the list mounted and reconnecting until a publication inside 12 seconds recovers it', () => {
    const list = document.getElementById('kickflow-message-list');
    nativeLoss();
    expect(active()).toBe(true);
    expect(getStatus()).toMatchObject({ active: true, pusherConnected: false, reason: t('status.reconnecting') });
    expect(document.querySelector('[data-kickflow-chat-status="reconnecting"]')).not.toBeNull();
    vi.advanceTimersByTime(11_999);
    expect(active()).toBe(true);
    publication('recovered', 2);
    expect(document.getElementById('kickflow-message-list')).toBe(list);
    expect(getStatus()).toMatchObject({ active: true, pusherConnected: true, reason: t('status.active_ready') });
    expect(document.querySelector('[data-kickflow-chat-status="reconnecting"]')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(active()).toBe(true);
  });

  it('fails open after 12 seconds without a publication and recovers on a later publication', () => {
    const list = document.getElementById('kickflow-message-list');
    nativeLoss();
    vi.advanceTimersByTime(11_999);
    expect(active()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(active()).toBe(false);
    expect(getStatus()).toMatchObject({ active: false, pusherConnected: false, reason: t('status.reconnect_failed') });
    publication('late', 2);
    expect(document.getElementById('kickflow-message-list')).toBe(list);
    expect(getStatus()).toMatchObject({ active: true, pusherConnected: true });
    expect(active()).toBe(true);
  });
});
