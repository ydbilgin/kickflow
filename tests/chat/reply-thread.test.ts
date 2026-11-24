import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMessageElement } from '../../src/content/chat/message-view';
import type { ChatMessage } from '../../src/content/chat/message-store';
import { OWN_LIST_ID } from '../../src/content/chat/overlay-mount';
import { resetNativeThreadState } from '../../src/content/chat/native-thread';
import { HOVER_TOOLTIP_ATTRIBUTE } from '../../src/content/shared/hover-tooltip';
import { setLang } from '../../src/content/shared/i18n';

/* Target behaviour T1-T4 of the reply-thread spec (2026-11-12): the quoted line always jumps,
 * Kick's side conversation ("Yan Sohbet") opens only through its own button or as the T2 fallback. */

const ORIGINAL_ID = 'orig-1';
const REPLY_ID = 'reply-1';

function reply(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: REPLY_ID,
    chatroomId: 1,
    content: 'body [emote:777:BodyEmote]',
    type: 'reply',
    createdAt: '',
    sender: { id: 1, username: 'Alice', slug: 'alice', identity: { color: '', badges: [], badgesV2: [] } },
    preserved: false,
    replyContext: {
      replyToUser: 'korkusuzsincap11',
      replyToText: 'ya sıktı abi [emote:555:QuoteEmote] yaaaaa',
      replyToMessageId: ORIGINAL_ID,
      replyToUserId: 2,
      threadParentId: ORIGINAL_ID,
    },
    ...overrides,
  };
}

interface Page {
  list: HTMLElement;
  row: HTMLElement;
  line: HTMLElement;
  original: HTMLElement | null;
  scrollIntoView: ReturnType<typeof vi.fn>;
  /** Clicks reaching Kick's mounted native row of the reply (the only way Yan Sohbet opens). */
  nativeRowClicks: ReturnType<typeof vi.fn>;
  nativeEmoteClicks: ReturnType<typeof vi.fn>;
  pageClicks: ReturnType<typeof vi.fn>;
}

/** Own list with (optionally) the original row, plus Kick's main native list with (optionally)
 * the reply's mounted native row in the live markup shape (fixture: username button with
 * data-prevent-expand, then the text span). */
function page(options: { originalInList: boolean; nativeRowMounted: boolean }, item = reply()): Page {
  const native = document.createElement('div');
  native.id = 'chatroom-messages';
  if (options.nativeRowMounted) {
    native.innerHTML = `<div class="no-scrollbar"><div data-index="4" data-kickflow-mid="${REPLY_ID}"><div class="group relative"><div class="w-full min-w-0"><div class="inline-flex"><button data-prevent-expand="true">Alice</button></div><span class="leading-[1.55]">body <span data-emote-id="777"><img alt="BodyEmote"></span></span></div><div class="absolute right-0 bottom-0"><button id="native-thread" aria-label="Yanıtla"><svg data-ds-icon="ArrowCurveLeft"></svg></button></div></div></div></div>`;
  }
  document.body.append(native);
  const nativeRowClicks = vi.fn();
  const nativeEmoteClicks = vi.fn();
  native.querySelector('[data-kickflow-mid]')?.addEventListener('click', nativeRowClicks);
  native.querySelector('[data-emote-id] img')?.addEventListener('click', nativeEmoteClicks);

  const list = document.createElement('div');
  list.id = OWN_LIST_ID;
  let original: HTMLElement | null = null;
  const scrollIntoView = vi.fn();
  if (options.originalInList) {
    original = document.createElement('div');
    original.dataset.messageId = ORIGINAL_ID;
    original.scrollIntoView = scrollIntoView;
    list.append(original);
  }
  const row = buildMessageElement(item);
  list.append(row);
  document.body.append(list);
  const pageClicks = vi.fn();
  document.addEventListener('click', pageClicks);
  const line = row.querySelector<HTMLElement>('.kickflow-message__reply-context')!;
  return { list, row, line, original, scrollIntoView, nativeRowClicks, nativeEmoteClicks, pageClicks };
}

function leftClick(target: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  target.dispatchEvent(event);
  return event;
}

function key(target: Element, value: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value });
  target.dispatchEvent(event);
  return event;
}

describe('reply quoted line and Kick side conversation (T1-T4)', () => {
  let pageClicks: ReturnType<typeof vi.fn> | null = null;
  beforeEach(() => {
    setLang('tr');
    resetNativeThreadState();
  });
  afterEach(() => {
    if (pageClicks) document.removeEventListener('click', pageClicks);
    pageClicks = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it.each([
    ['the username', '.kickflow-message__reply-user'],
    ['the text', '.kickflow-message__reply-snippet'],
    ['the separator', '.kickflow-message__reply-separator'],
    ['the hidden arrow icon', '.kickflow-message__reply-icon'],
    ['the padding (the line itself)', '.kickflow-message__reply-context'],
  ])('T1: a click on %s jumps to the original and never reaches Kick', (_name, selector) => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    pageClicks = p.pageClicks;

    const event = leftClick(p.row.querySelector(selector)!);

    expect(p.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(p.original?.classList.contains('kickflow-message--jump-highlight')).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(p.pageClicks).not.toHaveBeenCalled();
    expect(p.nativeRowClicks).not.toHaveBeenCalled();
  });

  it('T1: Enter and Space on the focused line jump too, and stop there', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);

    expect(key(p.line, 'Enter').defaultPrevented).toBe(true);
    expect(key(p.line, ' ').defaultPrevented).toBe(true);

    expect(p.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(pageKeys).not.toHaveBeenCalled();
    expect(p.nativeRowClicks).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageKeys);
  });

  it('T2: original gone from the list: miss cue, then Kick opens the side conversation of this reply', () => {
    const p = page({ originalInList: false, nativeRowMounted: true });
    pageClicks = p.pageClicks;

    leftClick(p.row.querySelector('.kickflow-message__reply-snippet')!);

    expect(p.line.classList.contains('kickflow-message__reply-context--miss')).toBe(true);
    expect(p.nativeRowClicks).toHaveBeenCalledOnce();
    // Forwarded to Kick's thread control of that row (the 0.3.20 target), never to its username.
    const forwarded = p.nativeRowClicks.mock.calls[0][0] as MouseEvent;
    expect((forwarded.target as Element).id).toBe('native-thread');
    expect(p.pageClicks).toHaveBeenCalledOnce(); // the forwarded native click, not ours
    expect(p.pageClicks.mock.calls[0][0]).toBe(forwarded);
  });

  it('T2: original gone and Kick offers no thread (native row virtualized): only the miss cue', () => {
    const p = page({ originalInList: false, nativeRowMounted: false });
    pageClicks = p.pageClicks;

    expect(() => leftClick(p.line)).not.toThrow();

    expect(p.line.classList.contains('kickflow-message__reply-context--miss')).toBe(true);
    expect(p.pageClicks).not.toHaveBeenCalled();
  });

  it('T2: a panel row with the same id is never used as the forward target', () => {
    const p = page({ originalInList: false, nativeRowMounted: false });
    const panel = document.createElement('div');
    panel.innerHTML = `<div><div><div><svg data-ds-icon="MessagesOutline"></svg></div><h2>Yan Sohbet</h2><button aria-label="Close"></button></div><div id="chatroom-messages"><div data-index="1" data-kickflow-mid="${REPLY_ID}"><div class="group"><div class="w-full"><span>body</span></div><div><button><svg data-ds-icon="ArrowCurveLeft"></svg></button></div></div></div></div></div></div>`;
    document.body.prepend(panel);
    const panelRowClicks = vi.fn();
    panel.querySelector('[data-kickflow-mid]')!.addEventListener('click', panelRowClicks);

    leftClick(p.line);

    expect(panelRowClicks).not.toHaveBeenCalled();
  });

  it('T3: a mounted native row without Kick\'s thread control does not show the button', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    document.querySelector('#native-thread')!.remove();
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;
    p.row.dispatchEvent(new Event('pointerenter'));
    expect(button.hidden).toBe(true);
  });

  it('T3: the thread button stays hidden until Kick offers a thread for this message', () => {
    const p = page({ originalInList: true, nativeRowMounted: false });
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;

    expect(button.hidden).toBe(true);
    p.row.dispatchEvent(new Event('pointerenter'));
    expect(button.hidden).toBe(true);
  });

  it('T3: the thread button sits at the line end, is labelled "Yan Sohbet", and opens Kick\'s panel without jumping', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    pageClicks = p.pageClicks;
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;

    p.row.dispatchEvent(new Event('pointerenter'));

    expect(button.hidden).toBe(false);
    expect(p.line.lastElementChild).toBe(button);
    expect(button.getAttribute('role')).toBe('button');
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-label')).toBe('Yan Sohbet');
    expect(button.getAttribute(HOVER_TOOLTIP_ATTRIBUTE)).toBe('Yan Sohbet');

    leftClick(button);

    expect(p.nativeRowClicks).toHaveBeenCalledOnce();
    expect(p.scrollIntoView).not.toHaveBeenCalled();
  });

  it('T3: keyboard focus on the line reveals the button; Enter and Space on it open the panel', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;

    p.line.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(button.hidden).toBe(false);

    expect(key(button, 'Enter').defaultPrevented).toBe(true);
    expect(key(button, ' ').defaultPrevented).toBe(true);

    expect(p.nativeRowClicks).toHaveBeenCalledTimes(2);
    expect(p.scrollIntoView).not.toHaveBeenCalled();
  });

  it('T3: when the native row vanished between hover and click, the button hides and the line shakes', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;
    p.row.dispatchEvent(new Event('pointerenter'));
    document.querySelector('[data-kickflow-mid]')!.remove();

    leftClick(button);

    expect(button.hidden).toBe(true);
    expect(p.line.classList.contains('kickflow-message__reply-context--miss')).toBe(true);
    expect(p.scrollIntoView).not.toHaveBeenCalled();
  });

  it('T3: a page without the panel (no panel appeared after a forward) hides the button afterwards', () => {
    vi.useFakeTimers();
    const p = page({ originalInList: true, nativeRowMounted: true });
    const button = p.line.querySelector<HTMLElement>('.kickflow-message__thread-open')!;
    p.row.dispatchEvent(new Event('pointerenter'));
    leftClick(button);

    vi.advanceTimersByTime(1500);
    p.row.dispatchEvent(new Event('pointerenter'));

    expect(button.hidden).toBe(true);
  });

  it('T4: an emote inside the quoted line jumps like the text; Kick\'s emote action is not used', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    pageClicks = p.pageClicks;
    const quotedEmote = p.line.querySelector<HTMLImageElement>('img.kickflow-emote')!;
    expect(quotedEmote.dataset.emoteId).toBe('555');

    leftClick(quotedEmote);

    expect(p.scrollIntoView).toHaveBeenCalledOnce();
    expect(p.nativeEmoteClicks).not.toHaveBeenCalled();
    expect(p.nativeRowClicks).not.toHaveBeenCalled();
    expect(p.pageClicks).not.toHaveBeenCalled();
  });

  it('T4: an emote in the message body keeps today\'s forward to Kick\'s own emote', () => {
    const p = page({ originalInList: true, nativeRowMounted: true });
    const bodyEmote = p.row.querySelector<HTMLImageElement>('.kickflow-message__content img.kickflow-emote')!;

    leftClick(bodyEmote);

    expect(p.nativeEmoteClicks).toHaveBeenCalledOnce();
    expect(p.scrollIntoView).not.toHaveBeenCalled();
  });
});
