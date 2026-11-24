import { getLang } from './i18n';
import type { Lifecycle } from './lifecycle';
import { isInsideChatScroller, onlyChatMutations } from './coalesce';
import { parseChatSessionContext } from '../chat/session-context';
import { px, setStyleIfChanged } from './style-write';

const STYLE_ID = 'kickflow-avatar-preview-style';
let activePreview: { close: () => void; source: HTMLElement | null } | null = null;

function copy(): { enlarge: string; title: string; close: string; failed: string } {
  return getLang() === 'tr'
    ? { enlarge: 'Profil resmini büyüt', title: 'Profil resmi', close: 'Kapat', failed: 'Profil resmi yüklenemedi.' }
    : { enlarge: 'Enlarge profile picture', title: 'Profile picture', close: 'Close', failed: 'The profile picture could not be loaded.' };
}

/** Only Kick's HTTPS raster images are previewed. Promote known profile conversions without
 * guessing paths for unrelated images, and preserve signed query parameters. */
export function fullSizeAvatarUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname !== 'kick.com' && !url.hostname.endsWith('.kick.com')) return null;
  if (!/\.(?:webp|png|jpe?g|gif|avif)$/i.test(url.pathname)) return null;
  if (url.pathname.includes('/profile_image/conversion/')) {
    url.pathname = url.pathname.replace(/-(?:small|medium|large|thumbnail|thumb|fullsize)(\.(?:webp|png|jpe?g|gif|avif))$/i, '-fullsize$1');
  }
  return url.href;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .kickflow-avatar-enlarge { box-sizing: border-box; display: inline-flex; flex: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: var(--kf-surface-3, #1f2520); color: var(--kf-green, #53fc18); cursor: pointer; }
    .kickflow-avatar-enlarge svg { width: 70%; height: 70%; pointer-events: none; }
    .kickflow-avatar-action { position: relative; display: inline-flex; flex: none; width: 48px; height: 48px; border-radius: 50%; }
    .kickflow-avatar-action > .kickflow-avatar-enlarge { width: 100%; height: 100%; background: transparent; }
    .kickflow-avatar-action .kickflow-user-card__avatar { width: 100%; height: 100%; border-radius: 50%; }
    .kickflow-avatar-action > .kickflow-avatar-enlarge > svg { position: absolute; right: 10%; bottom: 34%; width: 28%; height: 28%; padding: 2px; border-radius: 50%; background: var(--kf-surface-3, #1f2520); opacity: 0; }
    .kickflow-avatar-action:hover svg, .kickflow-avatar-action:focus-within svg { opacity: 1; }
    .kickflow-avatar-enlarge:focus-visible, .kickflow-avatar-preview button:focus-visible { outline: 2px solid #b5e7ff; outline-offset: 3px; }
    .kickflow-avatar-enlarge--channel { position: fixed; z-index: 10010; opacity: 0; pointer-events: none; }
    .kickflow-avatar-enlarge--channel.kickflow-avatar-enlarge--visible, .kickflow-avatar-enlarge--channel:focus-visible { opacity: 1; pointer-events: auto; }
    .kickflow-avatar-enlarge--direct { background: transparent; pointer-events: auto; opacity: 1; }
    .kickflow-avatar-enlarge--direct > svg { position: absolute; right: 10%; bottom: 34%; width: 28%; height: 28%; padding: 2px; border-radius: 50%; background: var(--kf-surface-3, #1f2520); opacity: 0; }
    .kickflow-avatar-enlarge--direct:hover > svg, .kickflow-avatar-enlarge--direct:focus-visible > svg { opacity: 1; }
    .kickflow-avatar-enlarge[hidden] { display: none; }
    .kickflow-avatar-preview { box-sizing: border-box; width: max-content; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); margin: auto; padding: 16px; border: 1px solid #727a82; border-radius: 12px; background: #151b22; color: #f7f9fb; box-shadow: 0 12px 60px #0008; font: 14px/1.4 system-ui, sans-serif; }
    .kickflow-avatar-preview::backdrop { background: #000c; }
    .kickflow-avatar-preview__header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 12px; }
    .kickflow-avatar-preview button { width: 32px; height: 32px; padding: 0; border: 1px solid #727a82; border-radius: 6px; background: #20262d; color: #f7f9fb; font-size: 24px; cursor: pointer; }
    .kickflow-avatar-preview img { display: block; width: auto; height: auto; max-width: min(76vw, 720px); max-height: calc(100vh - 132px); object-fit: contain; margin: auto; }
    .kickflow-avatar-preview img[hidden] { display: none; }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export function dismissAvatarPreview(): void {
  activePreview?.close();
}

export function openAvatarPreview(value: string, name = '', source: HTMLElement | null = null): boolean {
  const url = fullSizeAvatarUrl(value);
  if (!url) return false;
  dismissAvatarPreview();
  ensureStyles();
  const text = copy();
  const previousFocus = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dialog = document.createElement('dialog');
  dialog.className = 'kickflow-avatar-preview';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', name ? `${text.title}: ${name}` : text.title);
  const header = document.createElement('div');
  header.className = 'kickflow-avatar-preview__header';
  const title = document.createElement('strong');
  title.textContent = name ? `${text.title}: ${name}` : text.title;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', text.close);
  header.append(title, closeButton);
  const image = document.createElement('img');
  image.alt = name ? `${text.title}: ${name}` : text.title;
  image.src = url;
  const error = document.createElement('p');
  error.hidden = true;
  error.setAttribute('role', 'status');
  error.textContent = text.failed;
  image.addEventListener('error', () => { image.hidden = true; error.hidden = false; });
  dialog.append(header, image, error);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    if (activePreview?.close === close) activePreview = null;
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'Tab') {
      // The dialog has a single interactive element. Keep keyboard focus on its close action,
      // including the fallback used by DOM test environments without showModal().
      event.preventDefault();
      event.stopImmediatePropagation();
      closeButton.focus();
    }
  };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', close);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  document.body.appendChild(dialog);
  activePreview = { close, source };
  document.addEventListener('keydown', onKey, true);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  closeButton.focus({ preventScroll: true });
  return true;
}

/** The same magnifier is used inside card avatars and over native channel avatars. */
export function createAvatarPreviewButton(getUrl: () => string, name = ''): HTMLButtonElement {
  ensureStyles();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kickflow-avatar-enlarge';
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/></svg>';
  button.title = copy().enlarge;
  button.setAttribute('aria-label', copy().enlarge);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAvatarPreview(getUrl(), name, button);
  });
  return button;
}

export function createAvatarPreviewAction(image: HTMLImageElement, name = ''): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'kickflow-avatar-action';
  const button = createAvatarPreviewButton(() => image.currentSrc || image.src, name);
  button.prepend(image);
  wrapper.append(button);
  return wrapper;
}

function visibleAvatar(image: HTMLImageElement): boolean {
  const rect = image.getBoundingClientRect();
  const style = window.getComputedStyle(image);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
    && style.visibility !== 'collapse' && style.display !== 'none' && style.opacity !== '0';
}

/** Kick removed channel-avatar's id in November 2026. Identify its local name/avatar row,
 * never a Tailwind class combination or an arbitrary profile image elsewhere on the page. */
function findChannelAvatar(): HTMLImageElement | null {
  const legacy = document.querySelector<HTMLImageElement>('img#channel-avatar');
  if (legacy && visibleAvatar(legacy)) return legacy;
  const channel = parseChatSessionContext(window.location.pathname);
  if (!channel || window.location.pathname.startsWith('/popout/')) return null;
  const excluded = 'aside, nav, dialog, [role="dialog"], .kickflow-user-card, .kickflow-avatar-preview';
  for (const heading of document.querySelectorAll<HTMLElement>('[data-testid="channel-username"], h1, h2, [role="heading"]')) {
    if (heading.closest(excluded)) continue;
    const name = heading.textContent?.trim().toLocaleLowerCase();
    if (!name || (name !== channel.slug.toLocaleLowerCase() && heading.dataset.testid !== 'channel-username')) continue;
    // The name and avatar are siblings inside a compact row. Stop before page-wide containers.
    let row = heading.parentElement;
    for (let depth = 0; row && depth < 4 && !row.matches('body, main, html'); depth++, row = row.parentElement) {
      for (const image of row.querySelectorAll<HTMLImageElement>('img')) {
        if (image.closest(excluded) || !visibleAvatar(image)) continue;
        const url = image.currentSrc || image.src;
        if (!fullSizeAvatarUrl(url)) continue;
        if (image.alt.trim().toLocaleLowerCase() === name
          || (image.dataset.testid === 'channel-avatar' && new URL(url).pathname.includes('/profile_image/'))) return image;
      }
    }
  }
  return null;
}

/** SPA-wide controller, with no edits to Kick's native avatar or its clickable ancestors. The
 * body-owned control follows the avatar's measured rect and cannot change the header layout. */
export function initChannelAvatarPreview(lifecycle: Lifecycle): void {
  const view = window;
  let avatar: HTMLImageElement | null = null;
  let avatarUrl = '';
  let route = window.location.pathname;
  let frame = 0;
  const button = createAvatarPreviewButton(() => avatar?.currentSrc || avatar?.src || '', '');
  button.classList.add('kickflow-avatar-enlarge--channel');
  button.hidden = true;
  document.body.appendChild(button);
  const refresh = (): void => {
    frame = 0;
    if (lifecycle.isDisposed || !view.document) return;
    const next = findChannelAvatar();
    const nextUrl = next?.currentSrc || next?.src || '';
    if ((next !== avatar || nextUrl !== avatarUrl || route !== window.location.pathname) && activePreview?.source === button) dismissAvatarPreview();
    if (next !== avatar) button.classList.remove('kickflow-avatar-enlarge--visible');
    route = window.location.pathname;
    avatar = next;
    avatarUrl = nextUrl;
    const rect = avatar?.getBoundingClientRect();
    const hidden = !avatar || !rect || rect.width === 0 || rect.height === 0
      || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth
      || !fullSizeAvatarUrl(avatar.currentSrc || avatar.src);
    // Write only what changed (2026-11-11). This refresh runs on every non-chat body mutation;
    // each unchanged write was itself a <body> mutation record (soak: ~3 records/s from here).
    if (button.hidden !== hidden) button.hidden = hidden;
    if (!hidden && rect) {
      const direct = !avatar?.closest('a[href], button, [role="button"], [onclick], [tabindex]');
      if (button.classList.contains('kickflow-avatar-enlarge--direct') !== direct) {
        button.classList.toggle('kickflow-avatar-enlarge--direct', direct);
      }
      const size = Math.min(22, rect.width * 0.28, rect.height * 0.28);
      setStyleIfChanged(button, 'width', px(direct ? rect.width : size));
      setStyleIfChanged(button, 'height', px(direct ? rect.height : size));
      // Inside the circle, above Kick's LIVE badge, never beside the channel title.
      setStyleIfChanged(button, 'left', px(direct ? rect.left : rect.right - size - rect.width * 0.10));
      setStyleIfChanged(button, 'top', px(direct ? rect.top : rect.bottom - size - rect.height * 0.34));
      const label = copy().enlarge;
      if (button.title !== label) button.title = label;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    }
  };
  const updateHover = (target: EventTarget | null): void => {
    const visible = target === avatar || (target instanceof Node && button.contains(target));
    if (button.classList.contains('kickflow-avatar-enlarge--visible') !== visible) {
      button.classList.toggle('kickflow-avatar-enlarge--visible', visible);
    }
  };
  lifecycle.addEventListener(document, 'pointerover', ((event: PointerEvent) => updateHover(event.target)) as EventListener);
  lifecycle.addEventListener(document, 'pointerout', ((event: PointerEvent) => updateHover(event.relatedTarget)) as EventListener);
  const schedule = (): void => {
    if (lifecycle.isDisposed || !view.document) return;
    if (!frame) frame = view.requestAnimationFrame(refresh);
  };
  // Chat rows (and their emote images) mutate many times a second inside the chat scrollers; the
  // channel avatar is never inside them and does not move when they change (2026-11-09 profile:
  // the per-frame avatar search was ~5% of a busy page's main thread).
  const observer = new MutationObserver((records) => { if (!onlyChatMutations(records)) schedule(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'id', 'alt', 'hidden', 'data-testid'] });
  lifecycle.addEventListener(window, 'kickflow:locationchange', schedule);
  lifecycle.addEventListener(window, 'popstate', schedule);
  lifecycle.addEventListener(window, 'resize', schedule);
  lifecycle.addEventListener(document, 'scroll', ((event: Event) => { if (!isInsideChatScroller(event.target)) schedule(); }) as EventListener, true);
  // Every emote and badge image in chat fires a captured load event; only images outside chat matter.
  lifecycle.addEventListener(document, 'load', ((event: Event) => { if (!isInsideChatScroller(event.target)) schedule(); }) as EventListener, true);
  lifecycle.add(() => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    dismissAvatarPreview();
    button.remove();
    document.getElementById(STYLE_ID)?.remove();
  });
  refresh();
}
