import type { Lifecycle } from '../shared/lifecycle';
import type { PinnedMessage } from './message-store';

export const NATIVE_PIN_HIDDEN_ATTRIBUTE = 'data-kickflow-native-pin-hidden';

export interface NativePinMirrorTarget {
  setMirroredPinnedMessage(pin: PinnedMessage, content: Node): void;
  clearPinnedMessage(): void;
}

interface MirroredNativePin {
  pin: PinnedMessage;
  contentTemplate: DocumentFragment;
  presentationSignature: string;
}

interface StructuralRows {
  actor: HTMLElement | null;
  content: HTMLElement | null;
}

interface NativePinLocation {
  messages: HTMLElement;
  overlay: HTMLElement | null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function isNativePinOverlay(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement
    && element.classList.contains('absolute')
    && element.classList.contains('w-full');
}

function findOverlayBeforeMessages(messages: HTMLElement): HTMLElement | null {
  if (!messages.parentElement) return null;
  if (isNativePinOverlay(messages.previousElementSibling)) return messages.previousElementSibling;

  const siblings = Array.from(messages.parentElement.children);
  const messageIndex = siblings.indexOf(messages);
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = siblings[index];
    if (isNativePinOverlay(candidate)) return candidate;
  }
  return null;
}

function isBottomOverlay(element: Element | null): boolean {
  return element instanceof HTMLElement
    && element.classList.contains('absolute')
    && Array.from(element.classList).some((className) => className.startsWith('bottom-'));
}

/**
 * Resolve both structural siblings instead of trusting the first matching id. Mirrored message
 * markup can itself contain an id, and a duplicate inside the earlier pin overlay must not make
 * the real virtualized message list undiscoverable.
 */
function findNativePinLocation(): NativePinLocation | null {
  let best: NativePinLocation | null = null;
  let bestScore = -1;
  for (const messages of document.querySelectorAll<HTMLElement>('[id="chatroom-messages"]')) {
    const overlay = findOverlayBeforeMessages(messages);
    let score = overlay ? 100 : 0;
    if (overlay && messages.previousElementSibling === overlay) score += 10;
    if (isBottomOverlay(messages.nextElementSibling)) score += 5;
    if (messages.tagName === 'DIV') score += 1;
    if (score <= bestScore) continue;
    best = { messages, overlay };
    bestScore = score;
  }
  return best;
}

/** Kick's pin is the absolute/full-width sibling before the virtualized message list. */
export function findNativePinOverlay(): HTMLElement | null {
  return findNativePinLocation()?.overlay ?? null;
}

function directElements(element: Element): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
}

/** Follow single-child layout wrappers until the header/body row pair becomes visible. */
function findStructuralRows(pinRoot: HTMLElement): StructuralRows {
  let current: HTMLElement | null = pinRoot;
  while (current) {
    const children = directElements(current);
    if (children.length >= 2) return { actor: children[0], content: children[1] };
    current = children.length === 1 ? children[0] : null;
  }
  return { actor: null, content: null };
}

function textOutsideInteractiveElements(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, a, img, svg').forEach((node) => node.remove());
  return normalizeText(clone.textContent);
}

function hasUsernameShape(value: string): boolean {
  return /[\p{L}\p{N}_]/u.test(value);
}

/**
 * Locate the username control through structure rather than localized attribution copy.
 * The actor row owns avatar image(s), the username link/button, and separate attribution text.
 */
function findAttributedActor(pinRoot: HTMLElement): { row: HTMLElement; username: string } | null {
  const controls = pinRoot.querySelectorAll<HTMLElement>('button, a');
  for (const control of controls) {
    if (control.hasAttribute('aria-label')) continue;
    const username = normalizeText(control.textContent);
    if (!username || !hasUsernameShape(username)) continue;

    let candidate = control.parentElement;
    while (candidate && pinRoot.contains(candidate)) {
      if (candidate.querySelector('img') && textOutsideInteractiveElements(candidate)) {
        return { row: candidate, username };
      }
      if (candidate === pinRoot) break;
      candidate = candidate.parentElement;
    }
  }
  return null;
}

function isProbableActorRow(row: HTMLElement | null): row is HTMLElement {
  if (!row || row.matches('button, a')) return false;
  return Boolean(row.querySelector('button') && textOutsideInteractiveElements(row));
}

function findContentAfterActor(actorRow: HTMLElement, pinRoot: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = actorRow;
  while (current) {
    let sibling = current.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.tagName !== 'BUTTON') return sibling;
      sibling = sibling.nextElementSibling;
    }
    if (current === pinRoot) break;
    current = current.parentElement;
    if (!current || !pinRoot.contains(current)) break;
  }
  return null;
}

function cloneWithoutNativeButtons(source: HTMLElement | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!source) return fragment;

  for (const child of Array.from(source.childNodes)) {
    if (child instanceof HTMLButtonElement) continue;
    const clone = child.cloneNode(true);
    if (clone instanceof Element) {
      clone.querySelectorAll('button').forEach((button) => button.remove());
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    }
    fragment.appendChild(clone);
  }
  return fragment;
}

function readableNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) {
    return Array.from(node.childNodes).map(readableNodeText).join(' ');
  }
  if (node.tagName === 'IMG') {
    return node.getAttribute('alt') || node.getAttribute('title') || node.getAttribute('src') || '';
  }
  if (node.tagName === 'BR') return ' ';
  const childText = Array.from(node.childNodes).map(readableNodeText).join(' ');
  if (normalizeText(childText)) return childText;
  return node.getAttribute('aria-label')
    || node.getAttribute('title')
    || (node.tagName === 'A' ? node.getAttribute('href') : '')
    || '';
}

function presentationNodeSignature(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#${normalizeText(node.textContent)}`;
  if (!(node instanceof Element)) {
    return Array.from(node.childNodes).map(presentationNodeSignature).join('');
  }

  const attributes = ['alt', 'href', 'rel', 'src', 'style', 'target', 'title']
    .map((name) => [name, node.getAttribute(name)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
  const children = Array.from(node.childNodes).map(presentationNodeSignature).join('');
  return `<${node.tagName.toLowerCase()} ${attributes}>${children}</${node.tagName.toLowerCase()}>`;
}

function stablePinId(actor: string, messageText: string, linkTargets: string): string {
  const canonical = `${actor.toLowerCase()}\n${messageText}\n${linkTargets}`;
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  return `native-pin-${(fnv >>> 0).toString(36)}-${(djb >>> 0).toString(36)}-${canonical.length.toString(36)}`;
}

function readNativePin(overlay: HTMLElement): MirroredNativePin | null {
  const innerWrapper = overlay.firstElementChild;
  if (!(innerWrapper instanceof HTMLElement) || innerWrapper.childElementCount === 0) return null;

  const pinRoot = innerWrapper.firstElementChild;
  if (!(pinRoot instanceof HTMLElement)) return null;

  const structuralRows = findStructuralRows(pinRoot);
  // Restrict the primary actor search to the structural header. Otherwise a message link
  // beside an emote image can look like the avatar/username pattern when the actor is absent.
  const structuralActor = structuralRows.actor;
  const structuralActorIsHeader = isProbableActorRow(structuralActor);
  const attributedActor = structuralActorIsHeader && structuralActor
    ? findAttributedActor(structuralActor)
    : null;
  const actorRow = attributedActor?.row
    ?? (structuralActorIsHeader ? structuralActor : null);
  const contentRow = actorRow
    ? findContentAfterActor(actorRow, pinRoot) ?? structuralRows.content
    : pinRoot;
  const contentTemplate = cloneWithoutNativeButtons(contentRow);
  const actor = attributedActor?.username ?? '';
  const messageText = normalizeText(readableNodeText(contentTemplate));
  if (!messageText) return null;
  const linkTargets = Array.from(contentTemplate.querySelectorAll('a'))
    .map((link) => normalizeText(link.getAttribute('href')))
    .join('\n');
  const id = stablePinId(actor, messageText, linkTargets);

  return {
    pin: {
      message: {
        id,
        chatroomId: 0,
        content: messageText,
        type: 'message',
        createdAt: '',
        sender: {
          id: 0,
          username: '',
          slug: '',
          identity: { color: '', badges: [], badgesV2: [] },
        },
        preserved: false,
      },
      durationSeconds: 0,
      pinnedBy: { id: 0, username: actor, slug: '' },
    },
    contentTemplate,
    presentationSignature: `${actor}\n${presentationNodeSignature(contentTemplate)}`,
  };
}

/** Lifecycle-scoped own-mode mirror. Native mode never constructs this controller. */
export class NativePinMirror {
  private messages: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private overlayObserver: MutationObserver | null = null;
  private documentObserver: MutationObserver | null = null;
  private lastPinId: string | null = null;
  private lastPresentationSignature: string | null = null;
  private disposed = false;

  constructor(
    lifecycle: Lifecycle,
    private readonly target: NativePinMirrorTarget,
  ) {
    lifecycle.add(() => this.dispose());
    this.reconcileOverlay();
    // One filtered document observer covers asynchronous mount and later subtree replacement.
    // Ordinary message-row churn exits without performing a document-wide selector lookup.
    this.observeDocument();
  }

  private reconcileOverlay(): void {
    const location = findNativePinLocation();
    this.messages = location?.messages ?? null;
    this.bindOverlay(location?.overlay ?? null);
  }

  private mutationCouldIntroduceMessages(record: MutationRecord): boolean {
    if (record.type === 'attributes') {
      return record.attributeName === 'id'
        && record.target instanceof HTMLElement
        && (record.target.id === 'chatroom-messages' || record.oldValue === 'chatroom-messages');
    }
    return Array.from(record.addedNodes).some((node) => node instanceof Element && (
      node.matches('[id="chatroom-messages"]')
      || node.querySelector('[id="chatroom-messages"]')
    ));
  }

  private mutationCouldChangeLocation(record: MutationRecord): boolean {
    if (!this.messages) return this.mutationCouldIntroduceMessages(record);
    if (
      !this.messages.isConnected
      || this.messages.id !== 'chatroom-messages'
      || (this.overlay !== null && (
        !this.overlay.isConnected
        || !isNativePinOverlay(this.overlay)
        || this.overlay.parentElement !== this.messages.parentElement
      ))
    ) return true;

    const parent = this.messages.parentElement;
    if (!parent) return true;
    if (record.type === 'childList') return record.target === parent;
    if (!(record.target instanceof HTMLElement)) return false;
    return record.target === this.messages
      || record.target === this.overlay
      || record.target.parentElement === parent;
  }

  private observeDocument(): void {
    if (this.documentObserver || !document.body) return;
    this.documentObserver = new MutationObserver((records) => {
      if (this.disposed) return;
      if (records.some((record) => this.mutationCouldChangeLocation(record))) this.reconcileOverlay();
    });
    this.documentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id'],
      attributeOldValue: true,
    });
  }

  private bindOverlay(overlay: HTMLElement | null): void {
    if (overlay === this.overlay) return;
    this.overlayObserver?.disconnect();
    this.overlayObserver = null;
    this.overlay?.removeAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE);
    this.overlay = overlay;

    if (!overlay) {
      this.clearMirroredPin();
      return;
    }

    this.syncFromOverlay();
    this.overlayObserver = new MutationObserver((records) => {
      if (this.disposed || !this.overlay) return;
      const onlyMarkerChanged = records.every((record) => record.type === 'attributes'
        && record.target === this.overlay
        && record.attributeName === NATIVE_PIN_HIDDEN_ATTRIBUTE);
      if (onlyMarkerChanged) {
        if (this.lastPinId !== null && !this.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)) {
          this.overlay.setAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE, '');
        }
        return;
      }
      this.syncFromOverlay();
    });
    this.overlayObserver.observe(overlay, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  private syncFromOverlay(): void {
    if (!this.overlay) return;
    const mirrored = readNativePin(this.overlay);
    if (!mirrored) {
      if (this.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)) {
        this.overlay.removeAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE);
      }
      this.clearMirroredPin();
      return;
    }
    if (!this.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)) {
      this.overlay.setAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE, '');
    }
    if (
      mirrored.pin.message.id === this.lastPinId
      && mirrored.presentationSignature === this.lastPresentationSignature
    ) return;

    this.lastPinId = mirrored.pin.message.id;
    this.lastPresentationSignature = mirrored.presentationSignature;
    this.target.setMirroredPinnedMessage(mirrored.pin, mirrored.contentTemplate);
  }

  private clearMirroredPin(): void {
    if (this.lastPinId === null && this.lastPresentationSignature === null) return;
    this.lastPinId = null;
    this.lastPresentationSignature = null;
    this.target.clearPinnedMessage();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.documentObserver?.disconnect();
    this.documentObserver = null;
    this.overlayObserver?.disconnect();
    this.overlayObserver = null;
    this.overlay?.removeAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE);
    this.overlay = null;
    this.messages = null;
    this.lastPinId = null;
    this.lastPresentationSignature = null;
    this.target.clearPinnedMessage();
  }
}
