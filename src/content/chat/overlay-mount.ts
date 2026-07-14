import { Lifecycle } from '../shared/lifecycle';
import { SELECTORS } from '../shared/selectors';

const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
const OWN_LIST_ID = 'kickflow-message-list';
const CHAT_ACTIVE_CLASS = 'kickflow-chat-active';
const STATUS_ATTRIBUTE = 'data-kickflow-chat-status';
const SYNC_INTERVAL_MS = 500;
const GEOMETRY_EPSILON_PX = 0.5;

export type ChatTakeoverState = 'native' | 'probing' | 'ready' | 'active' | 'fallback';

function isCssVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const opacity = Number.parseFloat(style.opacity);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.visibility !== 'collapse'
    && (!Number.isFinite(opacity) || opacity > 0);
}

function containsChatAnchor(node: Node): boolean {
  return node instanceof Element && (
    node.matches('[id="chatroom-messages"]')
    || node.querySelector('[id="chatroom-messages"]') !== null
  );
}

interface LayoutRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

export type NativeEventStackGeometryResolution =
  | { readonly status: 'none'; readonly eventStack: null; readonly eventStackRect: null; readonly ownRect: LayoutRect }
  | { readonly status: 'valid'; readonly eventStack: HTMLElement; readonly eventStackRect: DOMRect; readonly ownRect: LayoutRect }
  | { readonly status: 'invalid'; readonly eventStack: HTMLElement | null; readonly eventStackRect: DOMRect | null; readonly ownRect: null };

function toLayoutRect(left: number, top: number, width: number, height: number): LayoutRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function horizontallyIntersects(first: DOMRect, second: DOMRect): boolean {
  return Math.min(first.right, second.right) - Math.max(first.left, second.left) > GEOMETRY_EPSILON_PX;
}

function spansAnchorWidth(eventStackRect: DOMRect, anchorRect: DOMRect): boolean {
  return eventStackRect.left <= anchorRect.left + GEOMETRY_EPSILON_PX
    && eventStackRect.right >= anchorRect.right - GEOMETRY_EPSILON_PX;
}

/** Kick commonly leaves its `.empty:hidden` event-stack shell mounted between native events.
 * Observe that shell structurally so an in-place empty -> populated transition is noticed before
 * the periodic sync. */
function findNativeEventStackObservationTarget(anchor: HTMLElement): HTMLElement | null {
  const parent = anchor.parentElement;
  if (!parent) return null;
  for (let sibling = anchor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling instanceof HTMLElement
      && sibling.isConnected
      && sibling.parentElement === parent
      && sibling.matches('.absolute.w-full')) {
      return sibling;
    }
  }
  return null;
}

/** Layout-only native-event-stack resolver. It reads no child content or identity and measures no
 * individual event. The only accepted surface is one visible, non-empty preceding
 * `.absolute.w-full` sibling whose container rect forms a contiguous band across the selected
 * anchor's top edge. Ambiguous/partial coverage is explicitly invalid. */
export function resolveNativeEventStackGeometry(anchor: HTMLElement): NativeEventStackGeometryResolution {
  const anchorRect = anchor.getBoundingClientRect();
  const fullAnchorRect = toLayoutRect(
    anchorRect.left,
    anchorRect.top,
    anchorRect.width,
    anchorRect.height,
  );
  const parent = anchor.parentElement;
  if (!parent) return { status: 'invalid', eventStack: null, eventStackRect: null, ownRect: null };

  const topEdgeCandidates: Array<{ eventStack: HTMLElement; rect: DOMRect }> = [];
  for (let sibling = anchor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (!(sibling instanceof HTMLElement) || !sibling.matches('.absolute.w-full')) continue;
    if (!sibling.isConnected || sibling.parentElement !== parent || !isCssVisible(sibling)) continue;
    const eventStackRect = sibling.getBoundingClientRect();
    if (eventStackRect.width <= 0 || eventStackRect.height <= 0) continue;
    const overlapsAnchorTop = eventStackRect.top <= anchorRect.top + GEOMETRY_EPSILON_PX
      && eventStackRect.bottom > anchorRect.top + GEOMETRY_EPSILON_PX;
    if (!overlapsAnchorTop || !horizontallyIntersects(eventStackRect, anchorRect)) continue;
    topEdgeCandidates.push({ eventStack: sibling, rect: eventStackRect });
  }

  if (topEdgeCandidates.length === 0) {
    return { status: 'none', eventStack: null, eventStackRect: null, ownRect: fullAnchorRect };
  }
  if (topEdgeCandidates.length !== 1) {
    return { status: 'invalid', eventStack: null, eventStackRect: null, ownRect: null };
  }

  const [{ eventStack, rect: eventStackRect }] = topEdgeCandidates;
  if (!spansAnchorWidth(eventStackRect, anchorRect)) {
    return { status: 'invalid', eventStack, eventStackRect, ownRect: null };
  }

  const reservedBottom = Math.min(Math.max(eventStackRect.bottom, anchorRect.top), anchorRect.bottom);
  const ownTop = reservedBottom;
  const ownHeight = anchorRect.bottom - ownTop;
  if (!(ownHeight > 0)) {
    return { status: 'invalid', eventStack, eventStackRect, ownRect: null };
  }
  return {
    status: 'valid',
    eventStack,
    eventStackRect,
    ownRect: toLayoutRect(anchorRect.left, ownTop, anchorRect.width, ownHeight),
  };
}

function rectsMatch(first: LayoutRect | null, second: LayoutRect): boolean {
  if (!first) return false;
  return Math.abs(first.left - second.left) <= GEOMETRY_EPSILON_PX
    && Math.abs(first.top - second.top) <= GEOMETRY_EPSILON_PX
    && Math.abs(first.width - second.width) <= GEOMETRY_EPSILON_PX
    && Math.abs(first.height - second.height) <= GEOMETRY_EPSILON_PX;
}

function inlineGeometryMatches(element: HTMLElement, rect: LayoutRect): boolean {
  return Math.abs(Number.parseFloat(element.style.left) - rect.left) <= GEOMETRY_EPSILON_PX
    && Math.abs(Number.parseFloat(element.style.top) - rect.top) <= GEOMETRY_EPSILON_PX
    && Math.abs(Number.parseFloat(element.style.width) - rect.width) <= GEOMETRY_EPSILON_PX
    && Math.abs(Number.parseFloat(element.style.height) - rect.height) <= GEOMETRY_EPSILON_PX;
}

/** Own-chat takeover owner. The global native-hide class is written only by transitionToActive,
 * and every route through that method proves the mount/content/anchor invariant first. */
export class ChatOverlayMount {
  readonly root: HTMLElement;
  readonly ownList: HTMLElement;
  private takeoverState: ChatTakeoverState = 'native';
  private contentReady = false;
  private primaryReady = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private readonly nativeEventStackMutationObserver: MutationObserver;
  private observedAnchor: HTMLElement | null = null;
  private observedEventStack: HTMLElement | null = null;
  private observedEventStackParent: HTMLElement | null = null;
  private availableOwnListRect: LayoutRect | null = null;
  private statusElement: HTMLElement | null = null;
  private disposed = false;

  constructor(lifecycle: Lifecycle) {
    const root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    root.style.position = 'fixed';
    root.style.zIndex = '30';
    root.style.display = 'none';
    root.style.pointerEvents = 'none';

    const ownList = document.createElement('div');
    ownList.id = OWN_LIST_ID;
    ownList.style.display = 'none';
    ownList.style.pointerEvents = 'auto';
    root.append(ownList);
    document.body.appendChild(root);
    this.root = root;
    this.ownList = ownList;

    const sync = () => this.syncNow();
    this.resizeObserver = new ResizeObserver((entries) => {
      const eventStackDriven = entries.length > 0
        && entries.every((entry) => entry.target === this.observedEventStack);
      this.syncNow(!eventStackDriven);
    });
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

    this.nativeEventStackMutationObserver = new MutationObserver(() => this.syncNow(false));
    lifecycle.add(() => this.nativeEventStackMutationObserver.disconnect());

    lifecycle.addEventListener(window, 'resize', sync);
    lifecycle.addEventListener(window, 'scroll', sync, true);
    lifecycle.setInterval(sync, SYNC_INTERVAL_MS);
    lifecycle.add(() => {
      this.disposed = true;
      document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
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
    const geometry = this.observedAnchor ? resolveNativeEventStackGeometry(this.observedAnchor) : null;
    const hasPositiveAvailableRect = geometry !== null
      && geometry.status !== 'invalid'
      && geometry.ownRect.height > 0
      && rectsMatch(this.availableOwnListRect, geometry.ownRect)
      && inlineGeometryMatches(this.root, geometry.ownRect);
    const valid = roots.length === 1
      && roots[0] === this.root
      && this.root.isConnected
      && isCssVisible(this.root)
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && this.observedAnchor !== null
      && this.isUsableAnchor(this.observedAnchor)
      && hasPositiveAvailableRect
      && hasVisibleContent;
    if (!valid) this.failOpen('active-invariant-broken');
    return valid;
  }

  syncNow(allowRecoveryActivation = true): void {
    if (this.disposed) return;
    const mountWasBroken = !this.root.isConnected
      || !this.ownList.isConnected
      || this.ownList.parentElement !== this.root;
    if (mountWasBroken && document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
      this.failOpen('mount-lost');
    }
    this.repairStructure();

    const anchor = this.selectAnchor();
    this.updateObservedAnchor(anchor);

    if (!anchor) {
      this.availableOwnListRect = null;
      this.updateNativeEventStackObservers(null, null);
      if (this.takeoverState === 'active' || document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)) {
        this.failOpen('anchor-unavailable');
      }
      this.root.style.visibility = 'hidden';
      this.updatePresentation();
      return;
    }

    if (!this.syncGeometry(anchor)) {
      this.root.style.visibility = 'hidden';
      this.failOpen('native-event-stack-geometry-invalid');
      return;
    }

    this.refreshContentReadiness();
    if (allowRecoveryActivation
      && this.takeoverState === 'fallback'
      && (this.contentReady || this.primaryReady)) {
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
    this.updateObservedAnchor(anchor);
    this.refreshContentReadiness();
    const hasReadiness = this.contentReady || (this.primaryReady && this.hasVisibleStatus());
    if (!anchor || !hasReadiness) {
      this.failOpen(anchor ? 'content-readiness-lost' : 'anchor-unavailable');
      return;
    }

    if (!this.syncGeometry(anchor)) {
      this.failOpen('native-event-stack-geometry-invalid');
      return;
    }
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
    if (this.ownList.parentElement !== this.root) this.root.prepend(this.ownList);
  }

  private updateObservedAnchor(anchor: HTMLElement | null): void {
    if (anchor === this.observedAnchor) return;
    if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
    if (anchor) this.resizeObserver.observe(anchor);
    this.observedAnchor = anchor;
  }

  private updateNativeEventStackObservers(parent: HTMLElement | null, eventStack: HTMLElement | null): void {
    if (parent === this.observedEventStackParent && eventStack === this.observedEventStack) return;
    if (this.observedEventStack) this.resizeObserver.unobserve(this.observedEventStack);
    this.nativeEventStackMutationObserver.disconnect();
    this.observedEventStackParent = parent;
    this.observedEventStack = eventStack;
    if (parent) this.nativeEventStackMutationObserver.observe(parent, { childList: true });
    if (eventStack) {
      this.resizeObserver.observe(eventStack);
      this.nativeEventStackMutationObserver.observe(eventStack, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
    }
  }

  private syncGeometry(anchor: HTMLElement): boolean {
    const geometry = resolveNativeEventStackGeometry(anchor);
    const eventStackObservationTarget = geometry.eventStack ?? findNativeEventStackObservationTarget(anchor);
    this.updateNativeEventStackObservers(anchor.parentElement, eventStackObservationTarget);
    if (geometry.status === 'invalid' || geometry.ownRect.height <= 0) {
      this.availableOwnListRect = null;
      return false;
    }

    const rect = geometry.ownRect;
    this.availableOwnListRect = rect;
    this.root.style.visibility = 'visible';
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;
    this.root.style.width = `${rect.width}px`;
    this.root.style.height = `${rect.height}px`;
    return true;
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
    this.ownList.style.display = active ? '' : 'none';
    this.root.style.display = active ? '' : 'none';
    this.root.style.pointerEvents = active ? 'auto' : 'none';
  }
}
