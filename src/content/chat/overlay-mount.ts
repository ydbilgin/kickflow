import { Lifecycle } from '../shared/lifecycle';
import { SELECTORS } from '../shared/selectors';

const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const OWN_LIST_ID = 'kickflow-message-list';
/** Set on <html> (NOT on #chatroom-messages — React re-renders that node and would strip
 * any class we add to it). Descendant CSS then hides the native list. */
const CHAT_ACTIVE_CLASS = 'kickflow-chat-active';
const SYNC_INTERVAL_MS = 500;

/**
 * The ENTIRE Kick chat panel is React-owned — confirmed live 2026-07-05 by DOM inspection:
 * #chatroom-messages AND every ancestor up to the page shell carry `__reactFiber$`. Appending
 * our list anywhere inside that subtree makes React reconcile it away on its next re-render
 * (observed: hydration error #418 + a continuous stream of "render-queue: container not found,
 * dropping batch" — so the own list never activated, native chat stayed, and a ban simply
 * deleted the message).
 *
 * Fix: mount at document.body level. React never touches nodes we own outside its tree, so it
 * survives every chat re-render. Two layers:
 *   - `root`: a position:fixed wrapper kept aligned to #chatroom-messages (ResizeObserver +
 *     window events + a slow interval catch-all for layout changes that emit no event, e.g.
 *     theatre-mode / sidebar toggles). It does NOT scroll, so it can hold overlay UI that must
 *     stay put (the jump-to-newest pill).
 *   - `ownList`: the inner overflow-y:auto message list (the render target).
 * The native list is hidden via a CSS rule keyed off a class on <html> (React-proof). Everything
 * downstream — render queue, store, ban-guard — is unchanged; only the mount layer moved. */
export class ChatOverlayMount {
  /** Outer position:fixed wrapper aligned to the chat area; holds the scroll list plus
   * non-scrolling overlay UI (the jump-to-newest pill). Append fixed overlay chrome here. */
  readonly root: HTMLElement;
  /** Inner overflow-y:auto message list — the render/scroll target. */
  readonly ownList: HTMLElement;
  private activated = false;
  private readonly resizeObserver: ResizeObserver;
  private observedAnchor: HTMLElement | null = null;

  constructor(lifecycle: Lifecycle) {
    const root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    root.style.position = 'fixed';
    root.style.zIndex = '30';
    root.style.display = 'none';

    const ownList = document.createElement('div');
    ownList.id = OWN_LIST_ID;
    root.appendChild(ownList);
    document.body.appendChild(root);
    this.root = root;
    this.ownList = ownList;
    lifecycle.add(() => root.remove());

    const sync = () => this.sync();
    this.resizeObserver = new ResizeObserver(sync);
    this.resizeObserver.observe(document.documentElement);
    lifecycle.add(() => this.resizeObserver.disconnect());

    lifecycle.addEventListener(window, 'resize', sync);
    // capture=true so Kick's own inner scroll containers still trigger a reposition.
    lifecycle.addEventListener(window, 'scroll', sync, true);
    lifecycle.setInterval(sync, SYNC_INTERVAL_MS);

    lifecycle.add(() => document.documentElement.classList.remove(CHAT_ACTIVE_CLASS));
  }

  /** Hide native chat + reveal the overlay. Called once the first message has rendered, so a
   * failed/empty session silently leaves native chat in place (the intended fail-safe). */
  activate(): void {
    if (this.activated) return;
    this.activated = true;
    document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
    this.root.style.display = '';
    this.sync();
  }

  private sync(): void {
    const anchor = document.querySelector<HTMLElement>(SELECTORS.chatMessagesContainer);

    // Keep the ResizeObserver pointed at the live anchor — Kick can replace #chatroom-messages.
    if (anchor !== this.observedAnchor) {
      if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
      if (anchor) this.resizeObserver.observe(anchor);
      this.observedAnchor = anchor;
    }

    if (!this.activated) return;

    const rect = anchor?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      // Chat collapsed / off-screen — hide the overlay but stay armed to re-show on return.
      this.root.style.visibility = 'hidden';
      return;
    }

    this.root.style.visibility = 'visible';
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;
    this.root.style.width = `${rect.width}px`;
    this.root.style.height = `${rect.height}px`;
  }
}
