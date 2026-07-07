import { Lifecycle } from '../shared/lifecycle';
import { SELECTORS } from '../shared/selectors';

const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const OWN_LIST_ID = 'kickflow-message-list';
const CHAT_ACTIVE_CLASS = 'kickflow-chat-active';
const SYNC_INTERVAL_MS = 500;

export class ChatOverlayMount {
  readonly root: HTMLElement;
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
    lifecycle.addEventListener(window, 'scroll', sync, true);
    lifecycle.setInterval(sync, SYNC_INTERVAL_MS);

    lifecycle.add(() => document.documentElement.classList.remove(CHAT_ACTIVE_CLASS));
  }

  activate(): void {
    if (this.activated) return;
    this.activated = true;
    document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
    this.root.style.display = '';
    this.sync();
  }

  private sync(): void {
    const anchor = document.querySelector<HTMLElement>(SELECTORS.chatMessagesContainer);

    if (anchor !== this.observedAnchor) {
      if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
      if (anchor) this.resizeObserver.observe(anchor);
      this.observedAnchor = anchor;
    }

    if (!this.activated) return;

    const rect = anchor?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
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
