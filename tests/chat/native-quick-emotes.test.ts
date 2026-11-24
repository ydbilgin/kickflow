import { afterEach, expect, it, vi } from 'vitest';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { findNativeQuickEmoteBar, NativeQuickEmoteBar, QUICK_EMOTE_ATTRIBUTE } from '../../src/content/chat/native-quick-emotes';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height } as DOMRect;
}

function fixture(): { messages: HTMLElement; bar: HTMLElement; composer: HTMLElement; picker: HTMLButtonElement } {
  const root = document.createElement('div');
  const messages = document.createElement('div');
  messages.id = 'chatroom-messages';
  messages.innerHTML = '<img src="https://files.kick.com/emotes/1/fullsize">';
  const bar = document.createElement('div');
  for (let i = 2; i <= 7; i++) {
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = `https://files.kick.com/emotes/${i}/fullsize`;
    button.append(image);
    bar.append(button);
  }
  const composer = document.createElement('div');
  composer.id = 'chat-input-wrapper';
  const picker = document.createElement('button');
  picker.textContent = 'Emotes';
  composer.append(picker);
  root.append(messages, bar, composer);
  document.body.append(root);
  vi.spyOn(messages, 'getBoundingClientRect').mockReturnValue(rect(700, 100, 300, 600));
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(700, 710, 300, 30));
  vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue(rect(700, 750, 300, 50));
  return { messages, bar, composer, picker };
}

it('hides only the compact native footer bar and restores its original presentation live', () => {
  const { messages, bar, picker } = fixture();
  expect(findNativeQuickEmoteBar()).toBe(bar);
  let hide = true;
  const lifecycle = new Lifecycle();
  const controller = new NativeQuickEmoteBar(lifecycle, () => hide);
  expect(bar.style.display).toBe('none');
  expect(bar.style.getPropertyPriority('display')).toBe('important');
  expect(bar.hasAttribute(QUICK_EMOTE_ATTRIBUTE)).toBe(true);
  expect(messages.style.display).toBe('');
  expect(picker.isConnected).toBe(true);
  hide = false;
  controller.sync();
  expect(bar.style.display).toBe('');
  expect(bar.querySelectorAll('img')).toHaveLength(6);
  lifecycle.dispose();
  expect(bar.hasAttribute(QUICK_EMOTE_ATTRIBUTE)).toBe(false);
});

it('leaves a changed or ambiguous footer alone instead of hiding messages or input', () => {
  const { bar, composer } = fixture();
  bar.lastElementChild?.remove();
  bar.lastElementChild?.remove();
  bar.lastElementChild?.remove();
  expect(findNativeQuickEmoteBar()).toBeNull();
  composer.append(bar);
  expect(findNativeQuickEmoteBar()).toBeNull();
  expect(composer.querySelectorAll('img')).toHaveLength(3);
});

it('collapses the outer emote-only height while preserving slow mode and exact inline styles', () => {
  const { bar, composer } = fixture();
  const shell = document.createElement('div');
  shell.style.cssText = 'height: 48px; padding: 8px; display: flex !important';
  bar.replaceWith(shell);
  shell.append(bar);
  const slow = document.createElement('p');
  slow.textContent = 'Yavaş mod aktif';
  composer.before(slow);
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(rect(700, 702, 300, 48));
  const original = shell.getAttribute('style');
  let hide = true;
  const lifecycle = new Lifecycle();
  const control = new NativeQuickEmoteBar(lifecycle, () => hide);
  expect(shell.style.display).toBe('none');
  expect(slow.style.display).toBe('');
  hide = false;
  control.sync();
  expect(shell.getAttribute('style')).toBe(original);
  lifecycle.dispose();
});

it('does not force a layout while the footer has no emote images (the usual page)', () => {
  const { messages, bar, composer } = fixture();
  bar.replaceChildren();
  const messageRect = vi.mocked(messages.getBoundingClientRect);
  const composerRect = vi.mocked(composer.getBoundingClientRect);
  messageRect.mockClear();
  composerRect.mockClear();
  expect(findNativeQuickEmoteBar()).toBeNull();
  expect(messageRect).not.toHaveBeenCalled();
  expect(composerRect).not.toHaveBeenCalled();
});
