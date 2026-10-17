import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNativeEventStackGeometry } from '../../src/content/chat/overlay-mount';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function anchorWith(child: HTMLElement): HTMLElement {
  const parent = document.createElement('section');
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  anchor.append(child);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 480,
    width: 320, height: 480, toJSON: () => ({}),
  });
  parent.append(anchor);
  document.body.append(parent);
  return anchor;
}

describe('message-region ownership excludes the native composer', () => {
  it.each(['true', '', 'plaintext-only'])('rejects an editable descendant (%j)', (value) => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', value);
    expect(resolveNativeEventStackGeometry(anchorWith(editor)).status).toBe('invalid');
    expect(editor.isConnected).toBe(true);
  });
  it('rejects the captured send button even while slow mode disables it', () => {
    const send = document.createElement('button');
    send.id = 'send-message-button';
    send.disabled = true;
    expect(resolveNativeEventStackGeometry(anchorWith(send)).status).toBe('invalid');
    expect(send.disabled).toBe(true);
  });
  it('rejects a native textarea', () => {
    expect(resolveNativeEventStackGeometry(anchorWith(document.createElement('textarea'))).status).toBe('invalid');
  });
  it('keeps ordinary message content and an external composer untouched', () => {
    const message = document.createElement('div');
    message.setAttribute('contenteditable', 'false');
    const anchor = anchorWith(message);
    const send = document.createElement('button');
    send.id = 'send-message-button';
    anchor.parentElement!.append(send);
    expect(resolveNativeEventStackGeometry(anchor).status).toBe('none');
    expect(send.parentElement).toBe(anchor.parentElement);
  });
});
