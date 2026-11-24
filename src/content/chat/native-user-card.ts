// Native reference: anonymous kick.com/mrstiventc, 2026-10-25. Username buttons
// open #user-identity; its profile anchor identifies the selected user. We only
// open that surface. Follow, mute, moderation and purchases remain Kick controls.
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;
interface CardRequest { slug: string; route: string; deadline: number; root: HTMLElement | null; }
let request: CardRequest | null = null;
let closeObserver: MutationObserver | null = null;
const navigation = (window as unknown as { navigation?: EventTarget }).navigation;

export function resetNativeUserCardRequest(): void {
  request = null;
  closeObserver?.disconnect(); closeObserver = null;
  navigation?.removeEventListener('navigate', resetNativeUserCardRequest);
  window.removeEventListener('popstate', resetNativeUserCardRequest);
}

export function openNativeUserCard(username: string, profileSlug = username): boolean {
  if (!SAFE_NAME.test(username) || !SAFE_NAME.test(profileSlug)) return false;
  const name = username.toLowerCase();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#chatroom-messages button[title]'));
  const button = buttons.reverse().find(node => node.title.toLowerCase() === name
    && node.textContent?.trim().toLowerCase() === name && !node.disabled);
  if (!button) return false;
  resetNativeUserCardRequest();
  request = { slug: profileSlug.toLowerCase(), route: location.href, deadline: performance.now() + 8000, root: null };
  navigation?.addEventListener('navigate', resetNativeUserCardRequest);
  window.addEventListener('popstate', resetNativeUserCardRequest);
  // DOM click deliberately avoids scrolling the hidden native list, which would
  // move the reader's paused chat. This target opens a card, never an account write.
  button.click();
  return true;
}

/** Only a card explicitly opened by our control may coexist over own chat.
 * Binding to the actual root prevents an unrelated future popup inheriting this
 * exception. A different identity, route, dialog or menu keeps the normal guard. */
export function isRequestedNativeUserCardSurface(element: Element): boolean {
  if (!request) return false;
  if (request.route !== location.href) { resetNativeUserCardRequest(); return false; }
  const root = element.closest<HTMLElement>('#user-identity');
  if (!root || !root.isConnected) return false;
  const profile = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).some(anchor => {
    try {
      const url = new URL(anchor.href);
      return url.origin === 'https://kick.com' && url.pathname.toLowerCase() === `/${request!.slug}`;
    } catch { return false; }
  });
  if (!profile) {
    if (request.root === root) resetNativeUserCardRequest();
    return false;
  }
  if (!request.root && performance.now() <= request.deadline) {
    request.root = root;
    closeObserver = new MutationObserver(records => {
      const removed = records.some(record => Array.from(record.removedNodes).some(node =>
        node === root || (node instanceof Element && node.contains(root))));
      const style = getComputedStyle(root);
      if (removed || !root.isConnected || root.hidden || style.display === 'none' || style.visibility === 'hidden') {
        resetNativeUserCardRequest();
      }
    });
    closeObserver.observe(document.body, { childList: true, subtree: true });
    closeObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  return request.root === root;
}
