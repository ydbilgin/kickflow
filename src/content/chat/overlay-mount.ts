import { Lifecycle } from '../shared/lifecycle';
import { SELECTORS } from '../shared/selectors';

const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const PINNED_MESSAGE_HOST_ID = 'kickflow-pinned-message-host';
const OWN_LIST_ID = 'kickflow-message-list';
const CHAT_ACTIVE_CLASS = 'kickflow-chat-active';
const PIN_SURFACE_ACTIVE_CLASS = 'kickflow-pin-surface-active';
const STATUS_ATTRIBUTE = 'data-kickflow-chat-status';
const SYNC_INTERVAL_MS = 500;

export type ChatTakeoverState = 'native' | 'probing' | 'ready' | 'active' | 'fallback';

function isCssVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.visibility !== 'collapse'
    && style.opacity !== '0';
}

function containsChatAnchor(node: Node): boolean {
  return node instanceof Element && (
    node.matches('[id="chatroom-messages"]')
    || node.querySelector('[id="chatroom-messages"]') !== null
  );
}

/** Own-chat takeover owner. The global native-hide class is written only by transitionToActive,
 * and every route through that method proves the mount/content/anchor invariant first. */
export class ChatOverlayMount {
  readonly root: HTMLElement;
  readonly pinnedMessageHost: HTMLElement;
  readonly ownList: HTMLElement;
  private takeoverState: ChatTakeoverState = 'native';
  private contentReady = false;
  private primaryReady = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private observedAnchor: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;
  private disposed = false;

  constructor(lifecycle: Lifecycle) {
    const root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    root.style.position = 'fixed';
    root.style.zIndex = '30';
    root.style.display = 'none';
    root.style.pointerEvents = 'none';

    const pinnedMessageHost = document.createElement('div');
    pinnedMessageHost.id = PINNED_MESSAGE_HOST_ID;
    pinnedMessageHost.style.display = 'none';
    pinnedMessageHost.style.pointerEvents = 'auto';

    const ownList = document.createElement('div');
    ownList.id = OWN_LIST_ID;
    ownList.style.display = 'none';
    ownList.style.pointerEvents = 'auto';
    root.append(pinnedMessageHost, ownList);
    document.body.appendChild(root);
    this.root = root;
    this.pinnedMessageHost = pinnedMessageHost;
    this.ownList = ownList;

    const sync = () => this.syncNow();
    this.resizeObserver = new ResizeObserver(sync);
    this.resizeObserver.observe(document.documentElement);
    lifecycle.add(() => this.resizeObserver.disconnect());

    this.mutationObserver = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'attributes') return record.attributeName === 'id';
        return Array.from(record.removedNodes).some((node) =>
          node === this.root || node === this.ownList || containsChatAnchor(node))
          || Array.from(record.addedNodes).some(containsChatAnchor);
      });
      if (relevant) this.syncNow();
    });
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id'],
      attributeOldValue: true,
    });
    lifecycle.add(() => this.mutationObserver.disconnect());

    lifecycle.addEventListener(window, 'resize', sync);
    lifecycle.addEventListener(window, 'scroll', sync, true);
    lifecycle.setInterval(sync, SYNC_INTERVAL_MS);
    lifecycle.add(() => {
      this.disposed = true;
      document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
      document.documentElement.classList.remove(PIN_SURFACE_ACTIVE_CLASS);
      root.remove();
    });

    this.syncNow();
  }

  get state(): ChatTakeoverState {
    return this.takeoverState;
  }

  get selectedAnchor(): HTMLElement | null {
    return this.observedAnchor;
  }

  get hasVisibleOwnContent(): boolean {
    return this.contentReady;
  }

  setProbing(): void {
    if (this.disposed || this.takeoverState === 'active') return;
    this.takeoverState = 'probing';
    document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
    this.syncNow();
  }

  /** Called after the pin controller changes its host. Pins are an independent surface and never
   * count as list readiness, so this can reveal the banner without acquiring native-hide. */
  pinVisibilityChanged(): void {
    if (this.disposed) return;
    this.syncNow();
  }

  /** RenderQueue uses this immediately before a flush. A detached root/list is repaired first;
   * returning null prevents any off-document append from being mistaken for visible content. */
  getRenderContainer(): HTMLElement | null {
    if (this.disposed) return null;
    this.syncNow();
    return this.root.isConnected
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && isCssVisible(this.ownList)
      ? this.ownList
      : null;
  }

  noteContentAppended(appended: readonly HTMLElement[]): void {
    if (this.disposed || appended.length === 0) return;
    const connectedFlush = this.root.isConnected
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && appended.some((row) => row.isConnected && row.parentElement === this.ownList && isCssVisible(row));
    if (!connectedFlush) {
      this.failOpen('off-document-render');
      this.syncNow();
      return;
    }

    this.contentReady = true;
    if (this.statusElement?.dataset.kickflowChatStatus === 'connected') this.setStatus(null);
    this.takeoverState = 'ready';
    this.transitionToActive();
  }

  setPrimaryReady(): void {
    if (this.disposed) return;
    this.primaryReady = true;
    if (!this.contentReady) this.setStatus('connected', 'Bağlandı — mesajlar bekleniyor…');
    else this.setStatus(null);
    this.takeoverState = 'ready';
    this.transitionToActive();
  }

  /** Existing rows stay mounted during a short reconnect grace. Bootstrap owns the grace timer;
   * this method only supplies the explicit visible state required by the invariant. */
  setReconnecting(): void {
    if (this.disposed || this.takeoverState !== 'active') return;
    this.primaryReady = false;
    this.setStatus('reconnecting', 'Yeniden bağlanıyor…');
    this.syncNow();
  }

  setPrimaryUnavailable(reason: string): void {
    this.primaryReady = false;
    this.failOpen(reason);
  }

  initialNoContentDeadline(): void {
    if (!this.contentReady && !this.primaryReady) this.failOpen('initial-no-content-deadline');
  }

  failOpen(_reason: string): void {
    if (this.disposed) return;
    document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
    this.takeoverState = 'fallback';
    this.updatePresentation();
  }

  /** Public for the direct invariant regression and diagnostics. A false result always restores
   * native chat before returning. When the class is absent, the implication holds trivially. */
  assertActiveInvariant(): boolean {
    if (!document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
      return this.takeoverState !== 'active';
    }

    const roots = Array.from(document.querySelectorAll<HTMLElement>(`[id="${OVERLAY_ROOT_ID}"]`));
    const hasVisibleContent = this.hasVisibleOwnRow() || this.hasVisibleStatus();
    const valid = roots.length === 1
      && roots[0] === this.root
      && this.root.isConnected
      && isCssVisible(this.root)
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && this.observedAnchor !== null
      && this.isUsableAnchor(this.observedAnchor)
      && hasVisibleContent;
    if (!valid) this.failOpen('active-invariant-broken');
    return valid;
  }

  syncNow(): void {
    if (this.disposed) return;
    const mountWasBroken = !this.root.isConnected
      || !this.ownList.isConnected
      || this.ownList.parentElement !== this.root;
    if (mountWasBroken && document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
      this.failOpen('mount-lost');
    }
    this.repairStructure();

    const anchor = this.selectAnchor();
    if (anchor !== this.observedAnchor) {
      if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
      if (anchor) this.resizeObserver.observe(anchor);
      this.observedAnchor = anchor;
    }

    if (!anchor) {
      if (this.takeoverState === 'active' || document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
        this.failOpen('anchor-unavailable');
      }
      this.root.style.visibility = 'hidden';
      this.updatePresentation();
      return;
    }

    const rect = anchor.getBoundingClientRect();
    this.root.style.visibility = 'visible';
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;
    this.root.style.width = `${rect.width}px`;
    this.root.style.height = `${rect.height}px`;

    this.refreshContentReadiness();
    if (this.takeoverState === 'fallback' && (this.contentReady || this.primaryReady)) {
      this.takeoverState = 'ready';
      this.transitionToActive();
      return;
    }
    this.updatePresentation();
    if (document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) this.assertActiveInvariant();
  }

  private transitionToActive(): void {
    if (this.disposed || this.takeoverState !== 'ready') return;
    this.repairStructure();
    const anchor = this.selectAnchor();
    if (anchor !== this.observedAnchor) {
      if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
      if (anchor) this.resizeObserver.observe(anchor);
      this.observedAnchor = anchor;
    }
    this.refreshContentReadiness();
    const hasReadiness = this.contentReady || (this.primaryReady && this.hasVisibleStatus());
    if (!anchor || !hasReadiness) {
      this.failOpen(anchor ? 'content-readiness-lost' : 'anchor-unavailable');
      return;
    }

    const rect = anchor.getBoundingClientRect();
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;
    this.root.style.width = `${rect.width}px`;
    this.root.style.height = `${rect.height}px`;
    this.root.style.visibility = 'visible';
    this.takeoverState = 'active';
    this.updatePresentation();
    document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
    this.assertActiveInvariant();
  }

  private repairStructure(): void {
    for (const duplicate of document.querySelectorAll<HTMLElement>(`[id="${OVERLAY_ROOT_ID}"]`)) {
      if (duplicate !== this.root) duplicate.remove();
    }
    if (!this.root.isConnected && document.body) document.body.append(this.root);
    if (this.pinnedMessageHost.parentElement !== this.root) this.root.prepend(this.pinnedMessageHost);
    if (this.ownList.parentElement !== this.root) this.pinnedMessageHost.after(this.ownList);
  }

  private selectAnchor(): HTMLElement | null {
    if (this.observedAnchor && this.isUsableAnchor(this.observedAnchor)) return this.observedAnchor;
    return Array.from(document.querySelectorAll<HTMLElement>('[id="chatroom-messages"]'))
      .find((candidate) => this.isUsableAnchor(candidate)) ?? null;
  }

  private isUsableAnchor(anchor: HTMLElement): boolean {
    if (!anchor.isConnected || anchor.id !== SELECTORS.chatMessagesContainer.slice(1) || !isCssVisible(anchor)) {
      return false;
    }
    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private hasVisibleStatus(): boolean {
    return this.statusElement !== null
      && this.statusElement.isConnected
      && this.statusElement.parentElement === this.ownList
      && isCssVisible(this.statusElement);
  }

  private hasVisibleOwnRow(): boolean {
    return Array.from(this.ownList.querySelectorAll<HTMLElement>('.kickflow-message, .kickflow-event-row'))
      .some((element) => element.isConnected && isCssVisible(element));
  }

  private refreshContentReadiness(): void {
    if (this.contentReady && !this.hasVisibleOwnRow()) this.contentReady = false;
    if (!this.contentReady && this.primaryReady && !this.hasVisibleStatus()) {
      this.setStatus('connected', 'Bağlandı — mesajlar bekleniyor…');
    }
  }

  private setStatus(kind: 'connected' | 'reconnecting' | null, text = ''): void {
    if (kind === null) {
      this.statusElement?.remove();
      this.statusElement = null;
      return;
    }
    if (!this.statusElement) {
      this.statusElement = document.createElement('div');
      this.statusElement.setAttribute(STATUS_ATTRIBUTE, kind);
      this.statusElement.setAttribute('role', 'status');
      this.statusElement.style.padding = '10px 12px';
      this.statusElement.style.color = 'rgba(255,255,255,0.68)';
      this.statusElement.style.fontSize = '12px';
      this.ownList.prepend(this.statusElement);
    }
    this.statusElement.setAttribute(STATUS_ATTRIBUTE, kind);
    this.statusElement.textContent = text;
  }

  private updatePresentation(): void {
    const active = this.takeoverState === 'active';
    const pinVisible = this.pinnedMessageHost.childElementCount > 0;
    this.pinnedMessageHost.style.display = pinVisible ? '' : 'none';
    this.ownList.style.display = active ? '' : 'none';
    this.root.style.display = active || pinVisible ? '' : 'none';
    this.root.style.pointerEvents = active ? 'auto' : 'none';
    const pinSurfaceVisible = pinVisible
      && this.observedAnchor !== null
      && this.isUsableAnchor(this.observedAnchor)
      && this.root.style.visibility !== 'hidden';
    document.documentElement.classList.toggle(PIN_SURFACE_ACTIVE_CLASS, pinSurfaceVisible);
  }
}
