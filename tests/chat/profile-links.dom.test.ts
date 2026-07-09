import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendParsedContent, buildMessageElement } from '../../src/content/chat/message-view';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { NativeChatAugmenter } from '../../src/content/chat/native-augment';
import type { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeLifecycle implements Pick<Lifecycle, 'add' | 'setInterval' | 'isDisposed'> {
  readonly isDisposed = false;

  add(): void {}
  setInterval(): void {}
}

function message(): ChatMessage {
  return {
    id: 'm1',
    chatroomId: 1,
    content: 'deleted text',
    type: 'message',
    createdAt: '',
    sender: {
      id: 1,
      username: 'alice',
      slug: 'alice_123',
      identity: { color: '', badges: [], badgesV2: [] },
    },
    preserved: false,
  };
}

function captureNewTabClick(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.href).toBe('https://kick.com/alice_123');
    expect(this.target).toBe('_blank');
    expect(this.rel).toBe('noopener noreferrer');
    expect(this.isConnected).toBe(false);
  });
}

describe('profile new-tab gestures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uses a detached anchor for a username middle-click instead of a popup window', () => {
    const click = captureNewTabClick();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const row = buildMessageElement(message());
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('uses the same detached-anchor new-tab gesture for a Mode B preserved username', () => {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    document.body.innerHTML = '<div id="chatroom-messages"><div class="no-scrollbar"><div data-kickflow-mid="m1"><span class="break-words"></span></div></div></div>';
    const store = new ChatIntegrityStore();
    store.addMessage(message());
    store.markMessageDeleted('m1');
    const click = captureNewTabClick();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const augmenter = new NativeChatAugmenter(new FakeLifecycle() as unknown as Lifecycle, store);
    augmenter.markById('m1');
    const username = document.querySelector<HTMLElement>('.kickflow-preserved-username');

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
  });

  it('uses the detached-anchor new-tab gesture for Ctrl, Shift, and Meta clicks', () => {
    const click = captureNewTabClick();
    const row = buildMessageElement(message());
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');

    username?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }));
    username?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
    username?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true }));

    expect(click).toHaveBeenCalledTimes(3);
  });

  it('uses the detached-anchor new-tab gesture for a pasted same-origin channel link', () => {
    const click = captureNewTabClick();
    const parent = document.createElement('span');
    appendParsedContent(parent, 'https://kick.com/alice_123');
    const link = parent.querySelector<HTMLAnchorElement>('.kickflow-link');

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(click).toHaveBeenCalledOnce();
  });

  it('keeps a username navigable even when the display name differs from the account username', () => {
    const click = captureNewTabClick();
    const withDisplayName = message();
    withDisplayName.sender.displayName = 'Alice The Great';
    const row = buildMessageElement(withDisplayName);
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
  });
});
