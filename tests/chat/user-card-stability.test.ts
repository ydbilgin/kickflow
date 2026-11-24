import { afterEach, expect, it, vi } from 'vitest';
import { configureUserCardSession, dismissUserCard, openUserCard } from '../../src/content/chat/user-card';

afterEach(() => { dismissUserCard(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves a loading card drag when the delayed profile arrives', async () => {
  configureUserCardSession('channel');
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => {
    await wait;
    return { ok: true, json: async () => ({ username: 'alice', slug: 'alice', subscribed_for: 0, following_since: null }) };
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: 320, height: 300 } as DOMRect;
  });
  const opening = openUserCard('alice', 'Alice', 700, 100, null);
  const loading = document.querySelector<HTMLElement>('.kickflow-user-card')!;
  loading.querySelector('.kickflow-user-card__header')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 728, clientY: 128 }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 150 }));
  document.dispatchEvent(new MouseEvent('mouseup'));
  const dragged = { left: loading.style.left, top: loading.style.top };
  release();
  await opening;
  const hydrated = document.querySelector<HTMLElement>('.kickflow-user-card')!;
  expect({ left: hydrated.style.left, top: hydrated.style.top }).toEqual(dragged);
});

it('adds the avatar preview while retaining the loading card and its close action', async () => {
  configureUserCardSession('channel-preview');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ username: 'preview-user', slug: 'preview-user',
      profile_pic: 'https://files.kick.com/images/user/1/profile_image/conversion/avatar-small.webp',
      subscribed_for: 0, following_since: null }),
  })));
  const opening = openUserCard('preview-user', 'Preview User', 700, 100, null);
  const loading = document.querySelector<HTMLElement>('.kickflow-user-card')!;
  const close = loading.querySelector('.kickflow-user-card__close');
  await opening;
  expect(document.querySelector('.kickflow-user-card')).toBe(loading);
  expect(loading.querySelector('.kickflow-user-card__close')).toBe(close);
  const enlarge = loading.querySelector<HTMLButtonElement>('.kickflow-avatar-enlarge');
  expect(enlarge).not.toBeNull();
  enlarge!.click();
  expect(document.querySelector<HTMLImageElement>('.kickflow-avatar-preview img')?.src)
    .toContain('avatar-fullsize.webp');
});
