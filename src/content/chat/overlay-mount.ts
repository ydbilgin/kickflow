import { visibleInterval } from '../shared/coalesce';
import { Lifecycle } from '../shared/lifecycle';
import { SELECTORS, ACTIVE_CHATTERS_SEARCH_SELECTOR } from '../shared/selectors';
import { t } from '../shared/i18n';
import { isRequestedNativeUserCardSurface } from './native-user-card';
import { isThreadPanelList } from './native-thread';

/** Start at the first chat column, window load, or the bounded 3 second deadline.
 * Dispose all three competitors before mounting so hydration cannot double-mount. */
export function scheduleChatStartup(mount: () => void): () => void {
  let done = false;
  const observer = new MutationObserver(() => {
    if (document.querySelector('#chatroom-messages')) start();
  });
  const cleanup = (): void => {
    observer.disconnect(); window.clearTimeout(timer);
    window.removeEventListener('load', start);
  };
  const start = (): void => {
    if (done) return;
    done = true; cleanup(); mount();
  };
  const timer = window.setTimeout(start, 3000);
  window.addEventListener('load', start, { once: true });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'complete' || document.querySelector('#chatroom-messages')) start();
  return () => { done = true; cleanup(); };
}

const OVERLAY_ROOT_ID = 'kickflow-chat-overlay';
export const OWN_LIST_ID = 'kickflow-message-list';
const CHAT_ACTIVE_CLASS = 'kickflow-chat-active';
const STATUS_ATTRIBUTE = 'data-kickflow-chat-status';
const SYNC_INTERVAL_MS = 500;
// While own chat is active and was fully verified this recently, the per-flush callers (RenderQueue
// asking for its container, noteContentAppended) skip the full re-verification. Every structural
// signal (resize, relevant mutation, window scroll, the 500 ms tick, any state change) still verifies
// from scratch. Measured 2026-11-08 on a 19k-viewer channel: the repeated verification (computed
// style, rectangles, elementsFromPoint) was most of KickFlow's 15-20 s of main-thread time per minute.
const HOT_PATH_FRESH_MS = 300;
const GEOMETRY_EPSILON_PX = 0.5;
// These body-level surfaces belong to own chat. Their covering the list is expected,
// and must not be mistaken for a native popup that requires returning to native chat.
const OWN_CHAT_SURFACE_SELECTOR = '.kickflow-user-card, .kickflow-avatar-preview, .kickflow-panel';
const NATIVE_CHAT_PRESENTATION_TOKENS = [
  '--chatroom-font-size',
  '--chatroom-timestamps-display',
  '--chatroom-message-spacing',
] as const;

export type ChatTakeoverState = 'native' | 'probing' | 'ready' | 'active' | 'fallback';

function isCssVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const opacity = Number.parseFloat(style.opacity);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.visibility !== 'collapse'
    && (!Number.isFinite(opacity) || opacity > 0);
}

/** A passive Radix tooltip may overlap the list when the composer identity button is
 * hovered. It is not an interactive native popup and must not release chat. */
function isPassiveNativeTooltipSurface(element: Element): boolean {
  const surface = element.closest('[data-radix-popper-content-wrapper], [role="tooltip"]');
  return surface !== null
    && (surface.matches('[role="tooltip"]') || surface.querySelector('[role="tooltip"]') !== null)
    && !surface.matches('[role="menu"], [role="dialog"]')
    && surface.querySelector('[role="menu"], [role="dialog"], button, a[href], input, select, textarea, [contenteditable="true"]') === null;
}

/** Recognize Kick's established panel/stage anchors, never arbitrary dialog text.
 * These surfaces can cover chat without changing which renderer owns it. */
function knownNativeChatSurfaces(): HTMLElement[] {
  const surfaces: HTMLElement[] = [];
  for (const search of document.querySelectorAll(ACTIVE_CHATTERS_SEARCH_SELECTOR)) {
    const panel = search.closest<HTMLElement>('section, [role="dialog"]');
    if (panel && !panel.contains(document.querySelector(SELECTORS.chatMessagesContainer))
      && isCssVisible(panel)) surfaces.push(panel);
  }
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]')) {
    if (isCssVisible(dialog) && dialog.querySelector(SELECTORS.dailyRewardStage)
      && dialog.querySelector(SELECTORS.dailyRewardFullWidthButton + '.bg-primary-base, button.w-full.bg-brand-bg-default')) {
      surfaces.push(dialog);
    }
  }
  return surfaces;
}

function isKnownNativeChatSurface(element: Element): boolean {
  return knownNativeChatSurfaces().some((surface) => surface === element || surface.contains(element)
    // Radix positions the whole known dialog inside this wrapper.
    || (element.matches('[data-radix-popper-content-wrapper]') && element.contains(surface))
    // The reward dialog's passive Radix backdrop is a sibling, not a dialog child.
    || (element instanceof HTMLElement && element.matches('div[data-state="open"][aria-hidden="true"]')
      && element.parentElement === surface.parentElement && getComputedStyle(element).position === 'fixed'
      && element.querySelector('button, a[href], input, [role="dialog"]') === null));
}

const NATIVE_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';
const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [contenteditable="true"]';

function viewportSize(): { width: number; height: number } {
  const html = document.documentElement;
  return {
    width: html.clientWidth > 0 ? html.clientWidth : window.innerWidth,
    height: html.clientHeight > 0 ? html.clientHeight : window.innerHeight,
  };
}

function isTopLayerModal(dialog: Element): boolean {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return false;
  // :modal is true only for showModal() (Chrome 105+); a show()n dialog is not a page modal.
  try { return dialog.matches(':modal'); } catch { return false; }
}

/** Laid out and not hidden. Opacity is ignored: Kick's dialogs fade in from opacity 0 while their
 * backdrop already covers the page (measured 2026-11-19: up to ~0.7 s in a throttled window). */
function isLaidOut(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

function isOpenNativeDialog(element: Element): boolean {
  if (!(element instanceof HTMLElement) || element.closest(OWN_CHAT_SURFACE_SELECTOR)
    || element.closest('[hidden]') || !isLaidOut(element)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** A page-wide modal backdrop: fixed, covering the whole viewport, and holding no control of its
 * own unless it wraps the dialog. Opacity is ignored on purpose: Radix fades the backdrop in from 0
 * while it already covers the page. */
function isViewportBackdrop(element: HTMLElement): boolean {
  if (element.closest(OWN_CHAT_SURFACE_SELECTOR) || !isLaidOut(element)
    || getComputedStyle(element).position !== 'fixed') return false;
  const box = element.getBoundingClientRect();
  const viewport = viewportSize();
  if (!(box.left <= 1 && box.top <= 1 && box.right >= viewport.width - 1 && box.bottom >= viewport.height - 1)) return false;
  return element.querySelector(INTERACTIVE_SELECTOR) === null || element.querySelector(NATIVE_DIALOG_SELECTOR) !== null;
}

/** The backdrop belongs to an open dialog: Radix portals both as siblings, some modals nest the
 * dialog inside the backdrop. */
function backdropHasOpenDialog(backdrop: HTMLElement): boolean {
  const candidates = [
    ...Array.from(backdrop.querySelectorAll(NATIVE_DIALOG_SELECTOR)),
    ...Array.from(backdrop.parentElement?.children ?? []).filter((sibling) => sibling !== backdrop)
      .flatMap((sibling) => sibling.matches(NATIVE_DIALOG_SELECTOR)
        ? [sibling]
        : Array.from(sibling.querySelectorAll(NATIVE_DIALOG_SELECTOR))),
  ];
  return candidates.some(isOpenNativeDialog);
}

/** An extension panel opened with showModal() inside an open shadow root. While it is open the
 * browser makes the rest of the page inert, so the hit test sees only its (retargeted) host. */
function hostsOpenTopLayerModal(element: Element): boolean {
  const shadow = element.shadowRoot;
  if (!shadow) return false;
  return Array.from(shadow.querySelectorAll('dialog[open]')).some(isTopLayerModal);
}

/** True when `hit`, the top element over the chat list, is a page-level modal layer: Kick's dialog
 * backdrop (drops/rewards and other Radix dialogs), a dialog that sits with such a backdrop, a
 * native top-layer dialog, or a shadow-hosted top-layer panel. Such a layer covers native and own
 * chat alike, so handing chat back to Kick under it only shows native chat (reported 2026-11-19). */
export function isPageModalLayer(hit: Element): boolean {
  if (hostsOpenTopLayerModal(hit)) return true;
  const topLayer = hit.closest('dialog');
  if (topLayer && isTopLayerModal(topLayer) && !topLayer.closest(OWN_CHAT_SURFACE_SELECTOR)) return true;
  for (let node: Element | null = hit; node && node !== document.body && node !== document.documentElement;
    node = node.parentElement) {
    if (node instanceof HTMLElement && isViewportBackdrop(node) && backdropHasOpenDialog(node)) return true;
  }
  const dialog = hit.closest(NATIVE_DIALOG_SELECTOR);
  if (!dialog || !isOpenNativeDialog(dialog)) return false;
  if (dialog.getAttribute('aria-modal') === 'true' || isTopLayerModal(dialog)) return true;
  return Array.from(dialog.parentElement?.children ?? []).some((sibling) =>
    sibling !== dialog && sibling instanceof HTMLElement && isViewportBackdrop(sibling));
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
  // The active stylesheet hides every native child of this anchor. Never take
  // over an anchor that also owns the composer after a native layout change.
  if (anchor.querySelector('#send-message-button, textarea, [contenteditable]:not([contenteditable="false"])')) {
    return { status: 'invalid', eventStack: null, eventStackRect: null, ownRect: null };
  }
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
  // Layout recovery is not proof that an unavailable transport recovered.
  private sourceUnavailable = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private readonly nativeEventStackMutationObserver: MutationObserver;
  private observedAnchor: HTMLElement | null = null;
  private observedEventStack: HTMLElement | null = null;
  private observedEventStackParent: HTMLElement | null = null;
  private availableOwnListRect: LayoutRect | null = null;
  private lastVerifiedAt = -Infinity;
  private hotPathDepth = 0;
  private statusElement: HTMLElement | null = null;
  private retryHandler: (() => void) | null = null;
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

    const sync = () => { this.invalidateVerification(); this.syncNow(); };
    this.resizeObserver = new ResizeObserver((entries) => {
      const eventStackDriven = entries.length > 0
        && entries.every((entry) => entry.target === this.observedEventStack);
      this.invalidateVerification();
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
      if (relevant) { this.invalidateVerification(); this.syncNow(); }
    });
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id'],
      attributeOldValue: true,
    });
    lifecycle.add(() => this.mutationObserver.disconnect());

    this.nativeEventStackMutationObserver = new MutationObserver(() => { this.invalidateVerification(); this.syncNow(false); });
    lifecycle.add(() => this.nativeEventStackMutationObserver.disconnect());

    lifecycle.addEventListener(window, 'resize', sync);
    // Scroll is captured from every element. Rows scrolling inside our own list or inside Kick's chat list move nothing the
    // overlay is aligned to, and the page-level ones arrive in bursts: one sync per frame is enough.
    let scrollFrame: number | null = null;
    lifecycle.addEventListener(window, 'scroll', (event) => {
      if (event.target instanceof Node
        && (this.root.contains(event.target) || this.observedAnchor?.contains(event.target))) return;
      if (scrollFrame !== null) return;
      scrollFrame = window.requestAnimationFrame(() => { scrollFrame = null; sync(); });
    }, true);
    lifecycle.add(() => { if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame); scrollFrame = null; });
    visibleInterval(lifecycle, sync, SYNC_INTERVAL_MS);
    lifecycle.add(() => {
      this.disposed = true;
      document.documentElement.classList.remove(CHAT_ACTIVE_CLASS);
      this.observedAnchor?.removeAttribute('data-kickflow-main-chat');
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
    this.hotPathDepth++;
    try {
      if (!this.verifiedRecently()) this.syncNow();
    } finally { this.hotPathDepth--; }
    return this.root.isConnected
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && this.availableOwnListRect !== null
      ? this.ownList
      : null;
  }

  noteContentAppended(appended: readonly HTMLElement[]): void {
    if (this.disposed || appended.length === 0) return;
    if (this.verifiedRecently() && this.contentReady && this.statusElement === null) {
      // Already active and verified moments ago: only the cheap structural facts are rechecked here.
      if (this.root.isConnected && this.ownList.isConnected && this.ownList.parentElement === this.root
          && appended.some((row) => row.isConnected && row.parentElement === this.ownList)) return;
    }
    this.hotPathDepth++;
    try { this.noteContentAppendedFull(appended); } finally { this.hotPathDepth--; }
  }

  private noteContentAppendedFull(appended: readonly HTMLElement[]): void {
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
    if (!this.sourceUnavailable && this.statusElement?.dataset.kickflowChatStatus !== 'reconnecting') this.setStatus(null);
    this.takeoverState = 'ready';
    this.transitionToActive();
  }

  setPrimaryReady(): void {
    if (this.disposed) return;
    this.sourceUnavailable = false;
    this.primaryReady = true;
    if (!this.contentReady) this.setStatus('connected', t('overlay.connected'));
    else this.setStatus(null);
    this.takeoverState = 'ready';
    this.transitionToActive();
  }

  /** VOD replay has no primary Pusher subscription. A visible status is nevertheless a complete
   * readiness proof, so own chat can stay active while a seek clears the old rows and loads the
   * new timestamp instead of briefly exposing native chat underneath. */
  setReplayLoading(): void {
    this.setReplaySourceReady(t('overlay.replay_loading'));
  }

  /** A successful replay response—including a legitimate empty window—keeps the selected own
   * view active. The status disappears as soon as RenderQueue appends a visible row. */
  setReplayReady(): void {
    this.setReplaySourceReady(t('overlay.replay_ready'));
  }

  /** Existing rows stay mounted during a short reconnect grace. Bootstrap owns the grace timer;
   * this method only supplies the explicit visible state required by the invariant. */
  setReconnecting(): void {
    if (this.disposed || this.takeoverState !== 'active') return;
    this.primaryReady = false;
    this.setStatus('reconnecting', t('overlay.reconnecting'));
    this.syncNow();
  }

  setPrimaryUnavailable(reason: string): void {
    if (this.disposed) return;
    this.sourceUnavailable = true;
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
    if (this.hotPathDepth > 0 && this.verifiedRecently()) return true;

    const roots = Array.from(document.querySelectorAll<HTMLElement>(`[id="${OVERLAY_ROOT_ID}"]`));
    const hasVisibleContent = this.hasVisibleOwnRow() || this.hasVisibleStatus();
    const geometry = this.observedAnchor ? resolveNativeEventStackGeometry(this.observedAnchor) : null;
    const hasPositiveAvailableRect = geometry !== null
      && geometry.status !== 'invalid'
      && geometry.ownRect.height > 0
      && rectsMatch(this.availableOwnListRect, geometry.ownRect)
      && inlineGeometryMatches(this.root, geometry.ownRect);
    const suspended = this.isNativeChatTemporarilyHidden();
    // Measured once per check, and only when the paint or overlap rule would otherwise fail.
    let coveredByModal: boolean | null = null;
    const covered = (): boolean => (coveredByModal ??= this.isCoveredByPageModal());
    const valid = roots.length === 1
      && roots[0] === this.root
      && this.root.isConnected
      && (suspended || isCssVisible(this.root))
      && this.ownList.isConnected
      && this.ownList.parentElement === this.root
      && this.observedAnchor !== null
      && (suspended || this.isUsableAnchor(this.observedAnchor))
      && (suspended || hasPositiveAvailableRect)
      && hasVisibleContent
      && (suspended || this.isPaintedOnTop() || covered())
      && (!this.hasOverlappingNativeControls() || covered());
    if (!valid) this.failOpen('active-invariant-broken');
    else this.lastVerifiedAt = performance.now();
    return valid;
  }

  private invalidateVerification(): void { this.lastVerifiedAt = -Infinity; }

  /** True only while own chat is active, was fully verified within HOT_PATH_FRESH_MS and nothing
   * structural has been signalled since. */
  private verifiedRecently(): boolean {
    return this.takeoverState === 'active'
      && document.documentElement.classList.contains(CHAT_ACTIVE_CLASS)
      && performance.now() - this.lastVerifiedAt < HOT_PATH_FRESH_MS;
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

    // Kick removes/zero-sizes the anchor while its chatter panel or Chat toggle is
    // shown. Keep the session/list, hide stale geometry, and resume on the next sync.
    if (this.takeoverState === 'active' && this.isNativeChatTemporarilyHidden()) {
      this.root.style.display = 'none';
      this.assertActiveInvariant();
      return;
    }
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
      && !this.sourceUnavailable
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
    if (this.sourceUnavailable) {
      this.failOpen('source-unavailable');
      return;
    }
    this.repairStructure();
    this.refreshContentReadiness();
    if (this.isNativeChatTemporarilyHidden() && this.availableOwnListRect
      && (this.contentReady || (this.primaryReady && this.hasVisibleStatus()))) {
      this.takeoverState = 'active';
      document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
      this.root.style.display = 'none';
      this.assertActiveInvariant();
      return;
    }
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
    // assertActiveInvariant rejects a native control over the list, but only after the active class
    // is set, which restyles the whole page. Looking first keeps a blocked page from flipping that
    // class several times a second (measured 2026-11-08: 127 activate/fail cycles in 30 s).
    if (this.hasOverlappingNativeControls() && !this.isCoveredByPageModal()) {
      this.failOpen('native-control-overlap');
      return;
    }
    this.takeoverState = 'active';
    this.updatePresentation();
    document.documentElement.classList.add(CHAT_ACTIVE_CLASS);
    this.assertActiveInvariant();
  }

  private setReplaySourceReady(statusText: string): void {
    if (this.disposed) return;
    this.sourceUnavailable = false;
    this.primaryReady = true;
    this.refreshContentReadiness();
    if (!this.contentReady) this.setStatus('connected', statusText);
    else this.setStatus(null);
    this.takeoverState = 'ready';
    this.transitionToActive();
  }

  private repairStructure(): void {
    for (const duplicate of document.querySelectorAll<HTMLElement>(`[id="${OVERLAY_ROOT_ID}"]`)) {
      if (duplicate !== this.root) duplicate.remove();
    }
    if (!this.root.isConnected && document.body) document.body.append(this.root);
    if (this.ownList.parentElement !== this.root) this.root.prepend(this.ownList);
  }

  /** A body-level z-index loses to Kick's narrow-screen #channel-content context.
   * Keep the list in that context, below Kick's popup layers, and outside its React list. */
  private syncStackingContext(anchor: HTMLElement): void {
    const host = anchor.closest<HTMLElement>('#channel-content') ?? document.body;
    if (this.root.parentElement !== host) host.append(this.root);
  }

  /** The first page layer over the centre of the own list, skipping our own card layers and the
   * native surfaces that may legitimately cover it. `undefined` means there is no paint engine
   * (jsdom); `null` means nothing was hit. */
  private topForeignLayerAtListCentre(): Element | null | undefined {
    if (typeof document.elementFromPoint !== 'function') return undefined;
    const rect = this.availableOwnListRect;
    if (!rect) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)];
    return stack.find((element) => element !== null && !element.closest(OWN_CHAT_SURFACE_SELECTOR)
      && !isRequestedNativeUserCardSurface(element) && !isPassiveNativeTooltipSurface(element)
      && !isKnownNativeChatSurface(element)) ?? null;
  }

  private isPaintedOnTop(): boolean {
    // jsdom has no paint engine. Browser checks always use the real hit test.
    if (typeof document.elementFromPoint !== 'function') return true;
    if (!this.availableOwnListRect) return false;
    // showModal() moves our avatar preview into the browser's top layer. Its backdrop
    // intentionally hides the entire hit-test stack until dismissal, including this list.
    if (document.querySelector('.kickflow-avatar-preview:modal')) return true;
    // Ignore only our card layers, then require the own list underneath. A different
    // page layer still fails the invariant even when it sits behind the card.
    const hit = this.topForeignLayerAtListCentre();
    return hit != null && this.root.contains(hit);
  }

  /** A page-level modal (Kick's drops/rewards dialog with its backdrop, a top-layer panel) is the
   * top layer over the list. Native chat would be just as covered, so own chat stays the chat; the
   * checks resume in full once the modal closes. Only a modal ON TOP of the list counts: a native
   * popup that our list paints over is still a reason to give chat back. */
  private isCoveredByPageModal(): boolean {
    const hit = this.topForeignLayerAtListCentre();
    return hit != null && !this.root.contains(hit) && isPageModalLayer(hit);
  }

  private hasOverlappingNativeControls(): boolean {
    const rect = this.availableOwnListRect;
    if (!rect) return false;
    return Array.from(document.querySelectorAll<HTMLElement>(
      '[role="menu"], [role="dialog"], dialog[open], [data-radix-popper-content-wrapper], [data-testid="emote-picker"]',
    )).some((control) => {
      if (this.root.contains(control) || control.closest(OWN_CHAT_SURFACE_SELECTOR) || isRequestedNativeUserCardSurface(control)
        || isPassiveNativeTooltipSurface(control)
        || isKnownNativeChatSurface(control)
        || control.closest('[hidden], [aria-hidden="true"]')
        || !isCssVisible(control)) return false;
      const box = control.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left
        && box.top < rect.bottom && box.bottom > rect.top;
    });
  }

  private isNativeChatTemporarilyHidden(): boolean {
    if (!this.observedAnchor || this.isUsableAnchor(this.observedAnchor)) return false;
    // A missing anchor by itself remains a real failure. Require Kick's documented
    // reopen control or the structurally recognized native panel as positive proof.
    const toggles = Array.from(document.querySelectorAll<HTMLElement>('div.z-controls.absolute.right-7.top-7'))
      .filter((element) => element.querySelector('button') && !element.closest('#video-player'));
    return [...toggles, ...knownNativeChatSurfaces()].some((element) => {
      const box = element.getBoundingClientRect();
      return isCssVisible(element) && box.width > 0 && box.height > 0;
    });
  }

  private updateObservedAnchor(anchor: HTMLElement | null): void {
    if (anchor === this.observedAnchor) return;
    if (this.observedAnchor) {
      this.resizeObserver.unobserve(this.observedAnchor);
      this.observedAnchor.removeAttribute('data-kickflow-main-chat');
    }
    if (anchor) {
      anchor.setAttribute('data-kickflow-main-chat', '');
      this.resizeObserver.observe(anchor);
    }
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
    this.syncStackingContext(anchor);
    const geometry = resolveNativeEventStackGeometry(anchor);
    const eventStackObservationTarget = geometry.eventStack ?? findNativeEventStackObservationTarget(anchor);
    this.updateNativeEventStackObservers(anchor.parentElement, eventStackObservationTarget);
    if (geometry.status === 'invalid' || geometry.ownRect.height <= 0) {
      this.availableOwnListRect = null;
      return false;
    }

    const rect = geometry.ownRect;
    this.availableOwnListRect = rect;
    const nativeStyle = getComputedStyle(anchor);
    for (const token of NATIVE_CHAT_PRESENTATION_TOKENS) {
      const value = nativeStyle.getPropertyValue(token).trim();
      if (value) this.root.style.setProperty(token, value);
      else this.root.style.removeProperty(token);
    }
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
    // Kick's side-conversation panel reuses the id for its own list; it is never the chat.
    if (isThreadPanelList(anchor)) return false;
    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private hasVisibleStatus(): boolean {
    return this.statusElement !== null
      && this.statusElement.isConnected
      && this.statusElement.parentElement === this.root
      && isCssVisible(this.statusElement);
  }

  private hasVisibleOwnRow(): boolean {
    return Array.from(this.ownList.querySelectorAll<HTMLElement>('.kickflow-message, .kickflow-event-row'))
      .some((element) => element.isConnected && isCssVisible(element));
  }

  private refreshContentReadiness(): void {
    if (this.contentReady && !this.hasVisibleOwnRow()) this.contentReady = false;
    if (!this.contentReady && this.primaryReady && !this.hasVisibleStatus()) {
      this.setStatus('connected', t('overlay.connected'));
    }
  }

  setRetryHandler(handler: () => void): void { this.retryHandler = handler; }

  showFailure(): void {
    this.failOpen('startup-failed');
    this.setStatus('failed', t('overlay.failed'));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = t('overlay.retry');
    retry.addEventListener('click', () => {
      this.setStatus(null);
      this.updatePresentation();
      this.retryHandler?.();
    }, { once: true });
    this.statusElement!.append(' ', retry);
    this.updatePresentation();
  }

  private setStatus(kind: 'connected' | 'reconnecting' | 'failed' | null, text = ''): void {
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
      this.statusElement.style.flex = '0 0 auto';
      this.statusElement.style.marginTop = 'auto';
      this.statusElement.style.pointerEvents = 'auto';
      this.root.append(this.statusElement);
    }
    this.statusElement.setAttribute(STATUS_ATTRIBUTE, kind);
    this.statusElement.textContent = text;
  }

  private updatePresentation(): void {
    const active = this.takeoverState === 'active';
    this.ownList.style.display = active ? '' : 'none';
    const failed = this.statusElement?.dataset.kickflowChatStatus === 'failed'
      && !this.hasOverlappingNativeControls();
    this.root.style.display = active || failed ? '' : 'none';
    this.root.style.pointerEvents = active ? 'auto' : 'none';
  }
}
