import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findNativeReplyAdapter, installReplyBridge } from '../../src/mainworld/reply-bridge';
import { requestNativeReply } from '../../src/content/chat/reply-action';
import { buildMessageElement } from '../../src/content/chat/message-view';
import { parseReplyRequest, REPLY_REQUEST_EVENT, REPLY_RESULT_ATTRIBUTE } from '../../src/shared/reply-contract';
import { chatMessage } from '../helpers/chat-message';

let stop: (() => void) | undefined;
beforeEach(() => { history.replaceState(null, '', '/ilkinsan'); });
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

// Public shape observed in editor ancestors on anonymous channel + popout, 2026-10-23.
// The native composer/store is deliberately separate from the production KickFlow renderer.
function nativeComposer(room = 1, slug = 'ilkinsan') {
  const editor = document.createElement('div');
  editor.dataset.testid = 'chat-input'; editor.contentEditable = 'true';
  editor.setAttribute('contenteditable', 'true'); editor.textContent = 'existing draft';
  document.body.append(editor);
  const focus = vi.fn();
  const state = {
    currentChatroomId: room,
    currentReplyingMessage: null as Record<string, any> | null,
    editorInstance: { current: { focus, getRootElement: () => editor } },
    setReplyingMessage: vi.fn((message: any) => { state.currentReplyingMessage = message; }),
  };
  const store = { getState: () => state };
  const provider = { memoizedProps: { value: { chatroomId: room, channelSlug: slug } } };
  const selector = (value: typeof state) => value.currentReplyingMessage;
  const getSnapshot = () => selector(store.getState());
  // Captured useSyncExternalStoreWithSelector: memoized getter pair + dependency list,
  // linked by identity to a later subscription hook's queue.getSnapshot. Hook order varies.
  const subscription = { queue: { getSnapshot }, next: null };
  const memo = { memoizedState: [[getSnapshot, () => null], [store.getState, () => state, selector, undefined]], next: subscription };
  const fiber = { return: provider, memoizedState: memo };
  Object.defineProperty(editor, '__reactFiber$datedFixture', { value: fiber, configurable: true });
  return { editor, state, store, fiber, focus };
}

function ownReply(sessionKey = 'live:ilkinsan', id = 'chosen') {
  const message = chatMessage(id, { userId: 42, content: '<script>untrusted original</script>' });
  const row = buildMessageElement(message, { onReply: (message, cue) => requestNativeReply(message, cue, sessionKey) });
  document.body.append(row);
  const button = row.querySelector<HTMLButtonElement>('.kickflow-message__reply-action')!;
  return { row, button, message };
}

describe('own row -> native reply contract', () => {
  it('reinstallation replaces the old MAIN listener and its stale disposer cannot remove the new one', () => {
    const native = nativeComposer(); const earlier = installReplyBridge(); stop = installReplyBridge();
    try {
      const own = ownReply(); own.button.click();
      expect(native.state.setReplyingMessage).toHaveBeenCalledTimes(1);
      earlier(); own.button.click();
      expect(native.state.setReplyingMessage).toHaveBeenCalledTimes(2);
    } finally { earlier(); }
  });

  it.each(['/ilkinsan', '/popout/ilkinsan/chat'])('selects the original id in %s without editing the draft or sending', pathname => {
    history.replaceState(null, '', pathname);
    const native = nativeComposer(); stop = installReplyBridge();
    const key = pathname.includes('popout') ? 'popout:ilkinsan' : 'live:ilkinsan';
    const own = ownReply(key);
    const network = vi.spyOn(globalThis, 'fetch');
    own.button.click();
    expect(native.state.currentReplyingMessage).toMatchObject({ id: 'chosen', chatroom_id: 1, sender: { id: 42 }, content: '<script>untrusted original</script>' });
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('selected');
    expect(native.editor.textContent).toBe('existing draft');
    expect(native.focus).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
    expect(document.querySelector('script')).toBeNull();
  });

  it('retains the reply after the source row is virtualized away; native cancel clears it', () => {
    const native = nativeComposer(); stop = installReplyBridge();
    const own = ownReply(); own.button.click(); own.row.remove();
    expect(native.state.currentReplyingMessage?.id).toBe('chosen');
    native.state.setReplyingMessage(null);
    expect(native.state.currentReplyingMessage).toBeNull();
    expect(native.editor.textContent).toBe('existing draft');
  });

  it('uses the new editor/store after reconnect instead of a cached detached provider', () => {
    const first = nativeComposer(); stop = installReplyBridge();
    const own = ownReply(); own.button.click(); first.editor.remove();
    const second = nativeComposer(); own.button.click();
    expect(first.state.setReplyingMessage).toHaveBeenCalledTimes(1);
    expect(second.state.currentReplyingMessage?.id).toBe('chosen');
  });

  it('preserves the clicked child and thread root when replying to a reply', () => {
    const native = nativeComposer(); stop = installReplyBridge();
    const own = ownReply(); own.message.type = 'reply';
    own.message.replyContext = { replyToMessageId: 'parent', replyToText: 'quoted parent', replyToUser: 'parentUser', replyToUserId: 7, threadParentId: 'root' };
    requestNativeReply(own.message, own.button, 'live:ilkinsan');
    expect(native.state.currentReplyingMessage).toMatchObject({ id: 'chosen', type: 'reply', thread_parent_id: 'root', metadata: { original_message: { id: 'parent' } } });
    // Captured native send contract uses selected.id for original_message and root for the thread.
    const selected = native.state.currentReplyingMessage!;
    expect({ original: selected.id, thread: selected.thread_parent_id || selected.id }).toEqual({ original: 'chosen', thread: 'root' });
  });

  it.each(['wrong room', 'changed route', 'old main session in popout', 'VOD'])('rejects %s without changing native reply state', kind => {
    const native = nativeComposer(kind === 'wrong room' ? 999 : 1);
    if (kind === 'changed route') history.replaceState(null, '', '/different');
    if (kind === 'old main session in popout') history.replaceState(null, '', '/popout/ilkinsan/chat');
    if (kind === 'VOD') history.replaceState(null, '', '/ilkinsan/videos/video-id');
    stop = installReplyBridge(); const own = ownReply(); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('wrong-room');
    expect(native.state.setReplyingMessage).not.toHaveBeenCalled();
    expect(own.row.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(native.editor.textContent).toBe('existing draft');
  });

  it.each(['no MAIN listener', 'changed editor anchor', 'changed store API', 'changed React property', 'missing editor', 'ambiguous editors', 'setter ignored'])('reports %s instead of a plain @mention fallback', kind => {
    const native = nativeComposer();
    if (kind !== 'no MAIN listener') stop = installReplyBridge();
    if (kind === 'changed editor anchor') native.editor.dataset.testid = 'new-input';
    if (kind === 'changed store API') Object.assign(native.state, { setReplyingMessage: undefined });
    if (kind === 'changed React property') delete (native.editor as any).__reactFiber$datedFixture;
    if (kind === 'missing editor') native.editor.remove();
    if (kind === 'ambiguous editors') nativeComposer();
    if (kind === 'setter ignored') native.state.setReplyingMessage.mockImplementation(() => {});
    const own = ownReply(); own.button.click();
    expect(own.row.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).not.toBe('selected');
    expect(native.editor.textContent).toBe('existing draft');
  });

  it('discovers the capabilities despite native class, icon and virtual-row changes', () => {
    const native = nativeComposer(); native.editor.className = 'entirely-new-css';
    expect(findNativeReplyAdapter()?.store.getState()).toBe(native.state);
    expect(document.querySelector('[data-index]')).toBeNull();
  });

  it.each(['/ilkinsan', '/popout/ilkinsan/chat'])('selects the main composer while a reply-thread editor is mounted (%s)', pathname => {
    history.replaceState(null, '', pathname);
    const main = nativeComposer();
    const footer = document.createElement('div'); footer.id = 'chatroom-footer';
    document.body.append(footer); footer.append(main.editor);
    const thread = nativeComposer();
    const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
    document.body.append(dialog); dialog.append(thread.editor);
    stop = installReplyBridge();
    const own = ownReply(pathname.includes('popout') ? 'popout:ilkinsan' : 'live:ilkinsan');
    own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('selected');
    expect(main.state.currentReplyingMessage?.id).toBe('chosen');
    expect(thread.state.setReplyingMessage).not.toHaveBeenCalled();
    expect(main.editor.textContent).toBe('existing draft');
    expect(thread.editor.textContent).toBe('existing draft');
    expect(main.focus).toHaveBeenCalledOnce();
    expect(thread.focus).not.toHaveBeenCalled();
  });

  it('focuses the selected main editor when Kick rebinds its shared editor reference to the thread', () => {
    const main = nativeComposer();
    const footer = document.createElement('div'); footer.id = 'chatroom-footer';
    document.body.append(footer); footer.append(main.editor);
    const thread = nativeComposer();
    // Live 2026-11-06: both editors subscribe to the same store, whose editorInstance
    // now points at the thread. It must not choose the focus destination for our row.
    Object.assign(main.state.editorInstance, { current: { focus: thread.focus, getRootElement: () => thread.editor } });
    stop = installReplyBridge(); const own = ownReply(); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('selected');
    expect(document.activeElement).toBe(main.editor);
    expect(thread.focus).not.toHaveBeenCalled();
    expect(main.editor.textContent).toBe('existing draft');
    expect(thread.editor.textContent).toBe('existing draft');
  });

  it('does not pick a first editor when duplicate main footers exist', () => {
    for (let i = 0; i < 2; i++) {
      const native = nativeComposer();
      const footer = document.createElement('div'); footer.id = 'chatroom-footer';
      document.body.append(footer); footer.append(native.editor);
    }
    expect(findNativeReplyAdapter()).toBeNull();
  });

  // Measured live 2026-11-22, anonymous Chromium, kick.com/ilkinsan -> sidebar link -> /isaacnaks
  // (no page load): Kick keeps the previous chatroom mounted under a React Activity wrapper with
  // inline `display: none !important`, so two #chatroom-footer blocks each hold an editable
  // chat-input. 0.3.30 counted both and every reply said "Bu sohbette yanıt seçilemiyor".
  function channelChange(hiddenFirst: boolean) {
    history.replaceState(null, '', '/isaacnaks');
    const mount = (room: number, slug: string, hidden: boolean) => {
      const native = nativeComposer(room, slug);
      const activity = document.createElement('div');
      if (hidden) activity.setAttribute('style', 'display: none !important;');
      const footer = document.createElement('div'); footer.id = 'chatroom-footer';
      activity.append(footer); footer.append(native.editor);
      return { native, activity };
    };
    const old = mount(2, 'ilkinsan', true);
    const current = mount(1, 'isaacnaks', false);
    document.body.append(...(hiddenFirst ? [old.activity, current.activity] : [current.activity, old.activity]));
    return { old: old.native, current: current.native, oldWrapper: old.activity };
  }
  const SPA_HINT = 'Kick keeps the previous channel\'s chat mounted but hidden after an in-page channel change. '
    + 'If this fails, run: node tests/playwright/reply-click-probe.mjs --spa=1 --diag=1 --extension=<built Suite> '
    + 'and compare "footers"/"editableInFooter" with liveChatFooter() in src/shared/reply-contract.ts.';

  it.each([true, false])('selects the visible chat after an in-page channel change (hidden old chat first: %s)', hiddenFirst => {
    const { old, current } = channelChange(hiddenFirst);
    stop = installReplyBridge();
    const own = ownReply('live:isaacnaks'); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE), SPA_HINT).toBe('selected');
    expect(current.state.currentReplyingMessage?.id, SPA_HINT).toBe('chosen');
    expect(old.state.setReplyingMessage, SPA_HINT).not.toHaveBeenCalled();
    expect(own.row.querySelector('.kickflow-message__reply-status'), SPA_HINT).toBeNull();
    expect(current.focus).toHaveBeenCalledOnce();
    expect(old.focus).not.toHaveBeenCalled();
  });

  it('reads a lock from the visible chat, not from the hidden previous channel', () => {
    const { current } = channelChange(true);
    const footer = current.editor.parentElement!;
    current.editor.remove(); footer.textContent = 'Subscribers only';
    stop = installReplyBridge();
    const own = ownReply('live:isaacnaks'); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE), SPA_HINT).toBe('subscribers_only');
  });

  it('still refuses to guess when two chats are both visible', () => {
    const { oldWrapper } = channelChange(true);
    oldWrapper.removeAttribute('style');
    expect(findNativeReplyAdapter()).toBeNull();
  });

  it('names the failed check and the next step in every non-lock failure line', () => {
    const own = ownReply(); own.button.click();
    expect(own.row.querySelector('.kickflow-message__reply-status')?.textContent).toMatch(/Reload the page \(F5\).*\[no-bridge\]$/);
    stop = installReplyBridge(); own.button.click();
    expect(own.row.querySelector('.kickflow-message__reply-status')?.textContent).toMatch(/Reload the page \(F5\).*\[unavailable\]$/);
    nativeComposer(999); own.button.click();
    expect(own.row.querySelector('.kickflow-message__reply-status')?.textContent).toMatch(/Reload the page \(F5\).*\[wrong-room\]$/);
  });

  it('bounds discovery on a malformed cyclic fiber chain', () => {
    const native = nativeComposer();
    Object.assign(native.fiber, { dependencies: undefined, return: native.fiber });
    expect(findNativeReplyAdapter()).toBeNull();
  });

  it('ignores a lookalike memo pair that is not linked to an actual subscription', () => {
    const native = nativeComposer();
    Object.assign(native.fiber.memoizedState.next.queue, { getSnapshot: () => null });
    expect(findNativeReplyAdapter()).toBeNull();
  });

  it('rejects a stale native store even when the room context has already changed', () => {
    const native = nativeComposer(); native.state.currentChatroomId = 999;
    stop = installReplyBridge(); const own = ownReply(); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('wrong-room');
    expect(native.state.setReplyingMessage).not.toHaveBeenCalled();
  });

  it.each(['/ilkinsan', '/popout/ilkinsan/chat'])('handles the observed zero queue-room sentinel only in popout (%s)', pathname => {
    history.replaceState(null, '', pathname);
    const native = nativeComposer(); native.state.currentChatroomId = 0;
    stop = installReplyBridge();
    const popout = pathname.includes('popout');
    const own = ownReply(popout ? 'popout:ilkinsan' : 'live:ilkinsan'); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe(popout ? 'selected' : 'wrong-room');
    expect(native.state.setReplyingMessage).toHaveBeenCalledTimes(popout ? 1 : 0);
  });

  it('rejects malformed targets and projects away arbitrary extra properties', () => {
    const native = nativeComposer(); stop = installReplyBridge();
    const own = ownReply();
    own.button.dispatchEvent(new CustomEvent(REPLY_REQUEST_EVENT, { bubbles: true, detail: '{broken' }));
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('invalid-target');
    expect(native.state.setReplyingMessage).not.toHaveBeenCalled();
    own.button.click();
    const raw = { sessionKey: 'live:ilkinsan', message: { ...native.state.currentReplyingMessage, unrelated: 'discard' }, unrelated: 'discard' };
    const parsed = parseReplyRequest(JSON.stringify(raw));
    expect(parsed).not.toHaveProperty('unrelated'); expect(parsed?.message).not.toHaveProperty('unrelated');
    expect(parseReplyRequest(JSON.stringify({ ...raw, message: { ...raw.message, chatroom_id: 0 } }))).toBeNull();
  });

  it('removes old failure feedback when the current contract becomes available', () => {
    stop = installReplyBridge(); const own = ownReply(); own.button.click();
    expect(own.row.querySelector('[role="status"]')).not.toBeNull();
    nativeComposer(); own.button.click();
    expect(own.row.querySelector('[role="status"]')).toBeNull();
  });
});

describe('locked chat reply explanation', () => {
  beforeEach(async () => { const {setLang} = await import('../../src/content/shared/i18n'); setLang('tr'); });
  afterEach(async () => { const {setLang} = await import('../../src/content/shared/i18n'); setLang('en'); });
  it.each([
    ['Takipçilere Özel', 'takipçilere özel'],
    ['Subscribers only', 'abonelere özel'],
    ['Sohbete katılmak için giriş yap', 'giriş yap'],
    ['Sohbet kurallarını kabul et', 'kurallarını kabul et'],
    ['Sohbet şu anda kullanılamıyor', 'yazı yazılamıyor'],
  ])('explains %s without suggesting retry', (text, expected) => {
    const footer = document.createElement('div'); footer.id = 'chatroom-footer'; footer.textContent = text;
    document.body.append(footer); stop = installReplyBridge();
    const own = ownReply(); own.button.click();
    expect(own.row.querySelector('.kickflow-message__reply-status')?.textContent?.toLowerCase()).toContain(expected);
    expect(own.row.textContent).not.toContain('Tekrar dene');
    expect(own.button.getAttribute('aria-disabled')).toBe('true');
  });
  it('rechecks a lock after native rules/login unlock the editor', () => {
    const footer = document.createElement('div'); footer.id = 'chatroom-footer'; footer.textContent = 'Takipçilere Özel';
    document.body.append(footer); stop = installReplyBridge(); const own = ownReply(); own.button.click();
    footer.replaceChildren(); const native = nativeComposer(); footer.append(native.editor); own.button.click();
    expect(own.button.getAttribute(REPLY_RESULT_ATTRIBUTE)).toBe('selected');
    expect(own.button.hasAttribute('aria-disabled')).toBe(false);
    expect(own.row.querySelector('.kickflow-message__reply-status')).toBeNull();
  });
});
