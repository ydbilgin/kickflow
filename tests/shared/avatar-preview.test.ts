import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAvatarPreviewButton,
  dismissAvatarPreview,
  fullSizeAvatarUrl,
  initChannelAvatarPreview,
  openAvatarPreview,
} from '../../src/content/shared/avatar-preview';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';
import { configureUserCardSession, openUserCard } from '../../src/content/chat/user-card';

const ORIGINAL = 'https://files.kick.com/images/user/25790533/profile_image/conversion/picture-medium.webp?signature=keep';
const FULLSIZE = ORIGINAL.replace('-medium.webp', '-fullsize.webp');
let lifecycle: Lifecycle;
let frames: FrameRequestCallback[];

async function flush(): Promise<void> {
  await Promise.resolve();
  const pending = frames.splice(0);
  for (const callback of pending) callback(0);
  await Promise.resolve();
}

function avatar(src = ORIGINAL): HTMLImageElement {
  const image = document.createElement('img');
  image.id = 'channel-avatar';
  image.src = src;
  image.getBoundingClientRect = () => ({ left: 10, top: 20, right: 74, bottom: 84, width: 64, height: 64, x: 10, y: 20, toJSON: () => ({}) });
  return image;
}

// Kick's desktop header measured on 2026-11-05. The mobile copy comes first in DOM order.
function channelHeader(name = 'xQc', src = ORIGINAL): HTMLElement {
  const header = document.createElement('section');
  header.innerHTML = `
    <div class="mobile"><button><div><div><img alt="${name}" src="${src}"></div></div></button><h1 data-testid="channel-username">${name}</h1></div>
    <div class="flex max-w-full shrink grow-0 flex-row gap-2 overflow-hidden lg:gap-4">
      <div class="shrink-0"><button class="m-0! inline-flex h-14 w-12 items-center justify-center border-0 p-0! lg:h-[68px] lg:w-16">
        <div class="group relative flex aspect-square shrink-0 items-center size-12 cursor-pointer lg:size-16">
          <div class="aspect-square w-full overflow-hidden rounded-full">
            <img alt="${name}" src="${src}" class="aspect-square w-full object-cover transition-transform duration-300" data-testid="channel-avatar">
          </div>
        </div>
      </button></div>
      <div><button><h1 data-testid="channel-username">${name}</h1></button><span>1.5M followers</span></div>
    </div>`;
  header.querySelector<HTMLImageElement>('img[data-testid="channel-avatar"]')!.getBoundingClientRect = avatar().getBoundingClientRect;
  return header;
}

describe('avatar preview', () => {
  beforeEach(() => {
    lifecycle = new Lifecycle();
    setLang('en');
    frames = [];
    window.history.replaceState(null, '', '/xqc');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { frames = []; });
  });
  afterEach(() => {
    lifecycle.dispose();
    dismissAvatarPreview();
    configureUserCardSession(null);
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    document.getElementById('kickflow-avatar-preview-style')?.remove();
    vi.restoreAllMocks();
  });

  it('promotes known Kick profile conversions and preserves original full-size/ordinary images', () => {
    expect(fullSizeAvatarUrl(ORIGINAL)).toBe(FULLSIZE);
    expect(fullSizeAvatarUrl(FULLSIZE)).toBe(FULLSIZE);
    expect(fullSizeAvatarUrl('https://files.kick.com/avatar-small.png')).toBe('https://files.kick.com/avatar-small.png');
  });

  it.each([
    'javascript:alert(1)', 'data:image/png;base64,abc', 'http://files.kick.com/avatar.png',
    'https://kick.com.evil.example/avatar.webp', 'https://evil.example/avatar.png',
    'https://fixture-user:fixture-password@files.kick.com/avatar.webp', 'https://files.kick.com:444/avatar.webp',
    'https://files.kick.com/profile.html', '//files.kick.com/avatar.png',
  ])('rejects unsafe image URL %s without creating a dialog', (url) => {
    expect(fullSizeAvatarUrl(url)).toBeNull();
    expect(openAvatarPreview(url)).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('opens via an accessible separate button, contains focus and restores it after Escape', () => {
    const button = createAvatarPreviewButton(() => ORIGINAL, '<Alice>');
    document.body.appendChild(button);
    button.focus();
    const bubble = vi.fn();
    document.addEventListener('keydown', bubble);
    button.click();
    const dialog = document.querySelector('dialog')!;
    expect(button.getAttribute('aria-label')).toBe('Enlarge profile picture');
    expect(dialog.querySelector('img')?.src).toBe(FULLSIZE);
    expect(dialog.querySelector('strong')?.textContent).toBe('Profile picture: <Alice>');
    expect(dialog.querySelector('Alice')).toBeNull();
    const closeButton = dialog.querySelector('button')!;
    expect(document.activeElement).toBe(closeButton);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(closeButton);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(bubble).not.toHaveBeenCalled();
    document.removeEventListener('keydown', bubble);
  });

  it('uses native modal support, offers a close action and keeps only one preview', () => {
    const showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    try {
      openAvatarPreview(ORIGINAL, 'Alice');
      openAvatarPreview(FULLSIZE, 'Bob');
      expect(showModal).toHaveBeenCalledTimes(2);
      expect(document.querySelectorAll('dialog')).toHaveLength(1);
      document.querySelector<HTMLButtonElement>('dialog button')!.click();
      expect(document.querySelector('dialog')).toBeNull();
    } finally {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    }
  });

  it('closes only for a click outside the dialog bounds and handles image failure', () => {
    openAvatarPreview(ORIGINAL);
    const dialog = document.querySelector('dialog')!;
    dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400, x: 100, y: 100, toJSON: () => ({}) });
    dialog.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 200, bubbles: true }));
    expect(dialog.isConnected).toBe(true);
    const image = dialog.querySelector('img')!;
    image.dispatchEvent(new Event('error'));
    expect(image.hidden).toBe(true);
    expect(dialog.querySelector<HTMLElement>('[role=status]')?.hidden).toBe(false);
    dialog.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 20, bubbles: true }));
    expect(dialog.isConnected).toBe(false);
  });

  it('keeps native avatar navigation unchanged and reads changed source on activation', async () => {
    const link = document.createElement('a');
    link.href = 'https://kick.com/alice';
    const image = avatar();
    link.appendChild(image);
    document.body.appendChild(link);
    const nativeClick = vi.fn((event: MouseEvent) => event.preventDefault());
    link.addEventListener('click', nativeClick);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    expect(button.parentElement).toBe(document.body);
    expect(link.children).toHaveLength(1);
    expect(button.hidden).toBe(false);
    expect(parseFloat(button.style.left)).toBeGreaterThanOrEqual(10);
    expect(parseFloat(button.style.left) + parseFloat(button.style.width)).toBeLessThanOrEqual(74);
    expect(parseFloat(button.style.top) + parseFloat(button.style.height)).toBeLessThanOrEqual(84);
    expect(button.classList.contains('kickflow-avatar-enlarge--visible')).toBe(false);
    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(button.classList.contains('kickflow-avatar-enlarge--visible')).toBe(true);
    image.click();
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(document.querySelector('dialog')).toBeNull();
    image.src = 'https://files.kick.com/new.webp';
    await flush();
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe('https://files.kick.com/new.webp');
  });

  it('finds the idsiz channel header, skips the 0x0 mobile copy, and enlarges on hover/click', () => {
    const header = channelHeader();
    // Kick also gives the visible channel banner the same alt text as the profile picture.
    const banner = avatar(ORIGINAL.replace('/profile_image/', '/banner_image/'));
    banner.removeAttribute('id');
    banner.alt = 'xQc';
    document.body.append(banner, header);
    const nativeButton = header.querySelector<HTMLButtonElement>('img[data-testid="channel-avatar"]')!.closest('button')!;
    const before = nativeButton.outerHTML;
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    expect(button.hidden).toBe(false);
    expect(parseFloat(button.style.width)).toBeGreaterThan(0);
    const image = header.querySelector('img[data-testid="channel-avatar"]')!;
    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(button.classList.contains('kickflow-avatar-enlarge--visible')).toBe(true);
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(FULLSIZE);
    expect(nativeButton.outerHTML).toBe(before);
  });

  it('prefers the old id when visible, then falls back when the old image is 0x0', async () => {
    const old = avatar('https://files.kick.com/old.webp');
    document.body.append(channelHeader(), old);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(old.src);
    old.getBoundingClientRect = () => new DOMRect();
    window.dispatchEvent(new Event('resize'));
    await flush();
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(FULLSIZE);
  });

  it('matches by the nearby channel display name without Tailwind classes or test ids', () => {
    const header = channelHeader();
    header.querySelectorAll('[class], [data-testid]').forEach((element) => {
      element.removeAttribute('class'); element.removeAttribute('data-testid');
    });
    document.body.append(header);
    initChannelAvatarPreview(lifecycle);
    expect(document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!.hidden).toBe(false);
  });

  it('ignores visible sidebar/card lookalikes and unrelated profile pictures', () => {
    const sidebar = document.createElement('aside');
    sidebar.append(channelHeader());
    const card = document.createElement('dialog');
    card.append(channelHeader());
    const wrong = channelHeader();
    wrong.querySelectorAll('img').forEach((image) => { image.alt = 'Someone else'; image.removeAttribute('data-testid'); });
    document.body.append(sidebar, card, wrong);
    initChannelAvatarPreview(lifecycle);
    expect(document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!.hidden).toBe(true);
  });

  it('re-finds the new header on SPA navigation and discards the previous preview', async () => {
    const header = channelHeader();
    document.body.append(header);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    button.click();
    window.history.pushState(null, '', '/nextchannel');
    header.replaceWith(channelHeader('NextChannel', 'https://files.kick.com/next.webp'));
    await flush();
    expect(document.querySelector('dialog')).toBeNull();
    expect(button.hidden).toBe(false);
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe('https://files.kick.com/next.webp');
    window.history.pushState(null, '', '/browse');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    expect(button.hidden).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('follows SPA avatar replacements, hides on absent/unsafe avatars, and disposes without remount', async () => {
    const first = avatar();
    document.body.appendChild(first);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    button.click();
    const second = avatar('https://files.kick.com/second.webp');
    first.replaceWith(second);
    await flush();
    expect(document.querySelector('dialog')).toBeNull();
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(second.src);
    second.remove();
    await flush();
    expect(button.hidden).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
    const unsafe = avatar('https://tracker.example/picture.png');
    document.body.appendChild(unsafe);
    await flush();
    expect(button.hidden).toBe(true);
    lifecycle.dispose();
    document.body.appendChild(avatar());
    await flush();
    expect(document.querySelector('.kickflow-avatar-enlarge--channel')).toBeNull();
  });

  it('provides Turkish labels in a Turkish session', () => {
    setLang('tr');
    const button = createAvatarPreviewButton(() => ORIGINAL);
    expect(button.getAttribute('aria-label')).toBe('Profil resmini büyüt');
    document.body.appendChild(button);
    button.click();
    expect(document.querySelector('dialog button')?.getAttribute('aria-label')).toBe('Kapat');
  });

  it('dismisses stale previews when an SPA route reuses the same image element', async () => {
    const image = avatar();
    document.body.appendChild(image);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    button.click();
    image.src = 'https://files.kick.com/next-channel.webp';
    await flush();
    expect(document.querySelector('dialog')).toBeNull();
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(image.src);
  });

  it('hides the fixed control when its native avatar leaves the viewport', async () => {
    const image = avatar();
    document.body.appendChild(image);
    initChannelAvatarPreview(lifecycle);
    const button = document.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge--channel')!;
    expect(button.hidden).toBe(false);
    image.getBoundingClientRect = () => ({ left: 10, top: -100, right: 74, bottom: -36, width: 64, height: 64, x: 10, y: -100, toJSON: () => ({}) });
    document.dispatchEvent(new Event('scroll'));
    await flush();
    expect(button.hidden).toBe(true);
  });

  it('opens from the real user card without starting a drag, and Escape preserves that card', async () => {
    configureUserCardSession('test-channel');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ following_since: null, subscribed_for: 0, profile_pic: ORIGINAL }),
    } as Response);
    await openUserCard('alice', 'Alice', 30, 40, null);
    const card = document.querySelector<HTMLElement>('.kickflow-user-card')!;
    const button = card.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge')!;
    expect(button).not.toBeNull();
    const pointer = new MouseEvent('mousedown', { button: 0, clientX: 40, clientY: 50, bubbles: true, cancelable: true });
    button.dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(false);
    button.click();
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(FULLSIZE);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(card.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(card.isConnected).toBe(false);
  });
});
