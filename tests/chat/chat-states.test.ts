import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { handleMessageDeleted, handleUserBanned } from '../../src/content/chat/ban-guard';
import { ModActionFeed, type ModAction } from '../../src/content/chat/mod-action-feed';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { applyPreservedMarking, buildMessageElement, deleteAttribution } from '../../src/content/chat/message-view';
import { findNativePausePill, NativePausePillCounter, PAUSE_COUNT_CLASS } from '../../src/content/chat/native-pause-pill';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';
import { chatMessage } from '../helpers/chat-message';

// One clear state per moderation event. Each case below is tagged with how it was established:
//   LIVE  = the same shape was caught on public Kick on 2026-10-24 (see RAPOR.md)
//   FIXTURE = could not be caught live in the session window; built from the code's own payload types

const originalShowDeleted = featureFlags.showDeletedMessages;

describe('deleted message shows exactly one notice', () => {
  beforeEach(() => {
    setLang('tr');
    featureFlags.showDeletedMessages = true;
  });
  afterEach(() => {
    featureFlags.showDeletedMessages = originalShowDeleted;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function deleteAndRender(payload: { aiModerated: boolean | null; deletedBy: string | null; violatedRules: string[] }, message: ChatMessage = chatMessage('m1', { content: 'hello' })) {
    const store = new ChatIntegrityStore({});
    store.addMessage(message);
    const onModAction = vi.fn();
    handleMessageDeleted({ messageId: message.id, ...payload }, { store, onModAction } as never);
    const stored = store.getMessageById(message.id)!;
    const row = buildMessageElement(stored);
    document.body.append(row);
    return { row, onModAction, stored };
  }

  it('LIVE: AI-mod delete (is_spam) gives one chip naming the AI mod and no system line', () => {
    const { row, onModAction } = deleteAndRender({ aiModerated: true, deletedBy: null, violatedRules: ['is_spam-TRUE'] });
    expect(onModAction).not.toHaveBeenCalled();
    const labels = row.querySelectorAll('.kickflow-status-label');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.textContent).toBe('SİLİNDİ· AI mod (is_spam-TRUE)');
    expect(row.querySelectorAll('.kickflow-mod-label')).toHaveLength(1);
    expect(document.querySelector('.kickflow-modaction-block, .kickflow-event-row--mod-action')).toBeNull();
    expect(row.textContent).not.toContain('Bir moderatör');
  });

  it('FIXTURE: human delete names the moderator role in Turkish and English, with no system line', () => {
    const tr = deleteAndRender({ aiModerated: false, deletedBy: null, violatedRules: [] });
    expect(tr.onModAction).not.toHaveBeenCalled();
    expect(tr.row.querySelector('.kickflow-status-label')!.textContent).toBe('SİLİNDİ· moderatör');
    document.body.innerHTML = '';
    setLang('en');
    const en = deleteAndRender({ aiModerated: false, deletedBy: null, violatedRules: [] });
    expect(en.row.querySelector('.kickflow-status-label')!.textContent).toBe('DELETED· moderator');
  });

  it('FIXTURE: a named moderator wins over the generic label', () => {
    const { row, stored } = deleteAndRender({ aiModerated: false, deletedBy: 'chhatto', violatedRules: [] });
    expect(deleteAttribution(stored.preservedMeta ?? {})).toBe('chhatto');
    expect(row.querySelector('.kickflow-mod-label')!.textContent).toBe('· chhatto');
  });

  it('FIXTURE: Kick gives no actor and no reason, so the chip says deleted and nothing contradicting', () => {
    const { row, onModAction } = deleteAndRender({ aiModerated: null, deletedBy: null, violatedRules: [] });
    expect(onModAction).not.toHaveBeenCalled();
    expect(row.querySelector('.kickflow-status-label')!.textContent).toBe('SİLİNDİ');
    expect(row.querySelector('.kickflow-mod-label')).toBeNull();
  });

  it('FIXTURE: several deletes in a row never reach the notice feed', () => {
    const store = new ChatIntegrityStore({});
    const seen: string[] = [];
    const feed = new ModActionFeed({ onNotice: (n) => seen.push(n.kind), onNoticeUpdated: (n) => seen.push(`u:${n.kind}`) });
    for (const id of ['a', 'b', 'c']) {
      store.addMessage(chatMessage(id));
      handleMessageDeleted({ messageId: id, aiModerated: true, deletedBy: null, violatedRules: ['hate'] }, {
        store, onModAction: (action: ModAction) => feed.push(action),
      } as never);
    }
    expect(seen).toEqual([]);
  });

  it('FIXTURE: re-applying the marking (second layer) never stacks a second chip', () => {
    const { row, stored } = deleteAndRender({ aiModerated: true, deletedBy: null, violatedRules: ['hate'] });
    applyPreservedMarking(row, stored);
    applyPreservedMarking(row, stored);
    expect(row.querySelectorAll('.kickflow-status-label')).toHaveLength(1);
    expect(row.querySelectorAll('.kickflow-mod-label')).toHaveLength(1);
  });

  it('FIXTURE: emote-only and very long deleted messages still carry one chip', () => {
    const emote = chatMessage('e1', { content: '[emote:37226:KEKW][emote:37226:KEKW][emote:37226:KEKW]' });
    const long = chatMessage('l1', { content: 'x'.repeat(500) });
    for (const message of [emote, long]) {
      const { row, onModAction } = deleteAndRender({ aiModerated: true, deletedBy: null, violatedRules: ['hate'] }, message);
      expect(onModAction).not.toHaveBeenCalled();
      expect(row.querySelectorAll('.kickflow-status-label')).toHaveLength(1);
      document.body.innerHTML = '';
    }
  });

  it('FIXTURE: a reply to a deleted message keeps its reply context and gets no extra system line', () => {
    const reply = chatMessage('r1', {
      content: 'agreed',
      replyContext: { replyToUser: 'm1sno', replyToText: 'helal olsun', replyToMessageId: 'm1' },
    });
    const store = new ChatIntegrityStore({});
    store.addMessage(chatMessage('m1', { content: 'helal olsun' }));
    store.addMessage(reply);
    const onModAction = vi.fn();
    handleMessageDeleted({ messageId: 'm1', aiModerated: true, deletedBy: null, violatedRules: ['hate'] }, { store, onModAction } as never);
    const row = buildMessageElement(store.getMessageById('r1')!);
    expect(onModAction).not.toHaveBeenCalled();
    expect(row.querySelector('.kickflow-message__reply-context')).not.toBeNull();
    expect(row.querySelector('.kickflow-status-label')).toBeNull();
  });

  it('keeps the delete untouched when showDeletedMessages is off: no chip, no notice', () => {
    featureFlags.showDeletedMessages = false;
    const store = new ChatIntegrityStore({});
    store.addMessage(chatMessage('m1'));
    const onModAction = vi.fn();
    handleMessageDeleted({ messageId: 'm1', aiModerated: true, deletedBy: null, violatedRules: [] }, { store, onModAction } as never);
    expect(onModAction).not.toHaveBeenCalled();
    expect(store.getMessageById('m1')?.preserved).toBe(false);
  });
});

describe('ban and timeout keep one notice per event', () => {
  beforeEach(() => setLang('tr'));
  afterEach(() => { document.body.innerHTML = ''; });

  it('FIXTURE: a timeout of three messages makes one notice for the event and one chip per row', () => {
    const store = new ChatIntegrityStore({});
    for (const id of ['a', 'b', 'c']) store.addMessage(chatMessage(id, { userId: 9 }));
    const noticeKinds: string[] = [];
    const feed = new ModActionFeed({ onNotice: (n) => noticeKinds.push(`${n.kind}:${n.durationMin}`), onNoticeUpdated: () => undefined });
    handleUserBanned({ userId: 9, permanent: false, durationMin: 5, bannedBy: 'chhatto', expiresAt: null }, {
      store, onModAction: (action: ModAction) => feed.push(action),
    } as never);
    expect(noticeKinds).toEqual(['timeout:5']);
    const rows = ['a', 'b', 'c'].map((id) => buildMessageElement(store.getMessageById(id)!));
    for (const row of rows) expect(row.querySelectorAll('.kickflow-status-label')).toHaveLength(1);
  });

  it('FIXTURE: a permanent ban notice is still produced when no message is retained', () => {
    const store = new ChatIntegrityStore({});
    const onModAction = vi.fn();
    handleUserBanned({ userId: 5, username: 'late', permanent: true, durationMin: null, bannedBy: null, expiresAt: null }, { store, onModAction } as never);
    expect(onModAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ban', victim: 'late' }));
  });
});

describe('native pause pill gets a new-message count', () => {
  const html = readFileSync(resolve(process.cwd(), 'tests/fixtures/native-pause-pill-2026-10-24.html'), 'utf8');
  let lifecycle: Lifecycle;

  beforeEach(() => {
    vi.useFakeTimers();
    setLang('en');
    document.body.innerHTML = html;
    lifecycle = new Lifecycle();
  });
  afterEach(() => {
    lifecycle.dispose();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('LIVE-shaped: finds Kick\'s pill by structure and leaves its own text alone', () => {
    const pill = findNativePausePill();
    expect(pill).not.toBeNull();
    expect(pill!.querySelector('span')!.textContent).toBe('Chat paused for scrolling');
  });

  it('LIVE-shaped: a pinned-message card in the same column is never taken for the pause pill', () => {
    const wrapper = findNativePausePill()!.closest('.absolute')!;
    wrapper.remove();
    expect(document.querySelector('[data-testid="pinned-message-modal"]')).not.toBeNull();
    expect(findNativePausePill()).toBeNull();
    const counter = new NativePausePillCounter(lifecycle);
    counter.noteMessage();
    expect(document.querySelector(`.${PAUSE_COUNT_CLASS}`)).toBeNull();
    expect(counter.getCount()).toBe(0);
  });

  it('LIVE-shaped: the count follows messages that arrive while the pill is up, and click still reaches Kick\'s button', () => {
    const counter = new NativePausePillCounter(lifecycle);
    const pill = findNativePausePill()!;
    const click = vi.fn();
    pill.addEventListener('click', click);
    expect(pill.querySelector(`.${PAUSE_COUNT_CLASS}`)).toBeNull();
    for (let i = 0; i < 3; i++) counter.noteMessage();
    expect(pill.querySelector(`.${PAUSE_COUNT_CLASS}`)!.textContent).toBe('+3');
    expect(pill.querySelector(`.${PAUSE_COUNT_CLASS}`)!.getAttribute('title')).toBe('3 new messages');
    counter.noteMessage();
    expect(pill.querySelector(`.${PAUSE_COUNT_CLASS}`)!.textContent).toBe('+4');
    pill.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uses the singular for one message and Turkish text in Turkish', () => {
    const counter = new NativePausePillCounter(lifecycle);
    counter.noteMessage();
    const badge = () => findNativePausePill()!.querySelector<HTMLElement>(`.${PAUSE_COUNT_CLASS}`)!;
    expect(badge().textContent).toBe('+1');
    expect(badge().title).toBe('1 new message');
    setLang('tr');
    counter.noteMessage();
    expect(badge().textContent).toBe('+2');
    expect(badge().title).toBe('2 yeni mesaj');
  });

  it('counts nothing when the chat is not paused, and starts again at zero on the next pause', () => {
    const counter = new NativePausePillCounter(lifecycle);
    const wrapper = findNativePausePill()!.closest('.absolute')!;
    const parent = wrapper.parentElement!;
    wrapper.remove();
    counter.noteMessage();
    counter.noteMessage();
    expect(counter.getCount()).toBe(0);
    parent.append(wrapper);
    vi.advanceTimersByTime(600);
    expect(findNativePausePill()!.querySelector(`.${PAUSE_COUNT_CLASS}`)).toBeNull();
    counter.noteMessage();
    expect(findNativePausePill()!.querySelector(`.${PAUSE_COUNT_CLASS}`)!.textContent).toBe('+1');
    // resume: Kick removes the pill; the count must reset
    wrapper.remove();
    vi.advanceTimersByTime(600);
    expect(counter.getCount()).toBe(0);
  });

  it('puts the count back if Kick re-renders the pill without it', () => {
    const counter = new NativePausePillCounter(lifecycle);
    counter.noteMessage();
    findNativePausePill()!.querySelector(`.${PAUSE_COUNT_CLASS}`)!.remove();
    vi.advanceTimersByTime(600);
    expect(findNativePausePill()!.querySelector(`.${PAUSE_COUNT_CLASS}`)!.textContent).toBe('+1');
  });

  it('removes its count on dispose and does nothing without a chat column', () => {
    const counter = new NativePausePillCounter(lifecycle);
    counter.noteMessage();
    lifecycle.dispose();
    expect(document.querySelector(`.${PAUSE_COUNT_CLASS}`)).toBeNull();
    document.body.innerHTML = '';
    expect(findNativePausePill()).toBeNull();
    expect(() => counter.noteMessage()).not.toThrow();
  });
});
