import { coalesce, visibleInterval } from '../shared/coalesce';
import type { Lifecycle } from '../shared/lifecycle';
import { findMainNativeList } from './native-thread';

export const QUICK_EMOTE_ATTRIBUTE = 'data-kickflow-native-quick-emotes';
const QUICK_EMOTE_SYNC_GAP_MS = 1000;
const IMAGE_SELECTOR = 'img[src^="https://files.kick.com/emotes/"]';

function sharedChatRoot(first: Element, second: Element): Element | null {
  for (let node: Element | null = first.parentElement; node; node = node.parentElement) {
    if (node.contains(second)) return node;
  }
  return null;
}

/** Select only a compact row of native emote images between the message pane and composer.
 * A missing or changed Kick layout safely yields null; messages and the picker stay untouched. */
export function findNativeQuickEmoteBar(): HTMLElement | null {
  const messages = findMainNativeList();
  const composer = document.getElementById('chat-input-wrapper');
  if (!messages || !composer) return null;
  const root = sharedChatRoot(messages, composer);
  if (!root) return null;
  // Look for candidate images first: that is a plain DOM query. Measuring the two rectangles forces a
  // layout, and on a page with no footer emote bar (the usual case) it was the single largest cost
  // KickFlow added to a Kick tab (measured 2026-11-08: about 0.5 s of script time per minute).
  const images = Array.from(root.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR))
    .filter((image) => !messages.contains(image) && !composer.contains(image));
  if (images.length === 0) return null;
  const messageRect = messages.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  if (composerRect.top < messageRect.bottom - 16) return null;
  for (const image of images) {
    let container: HTMLElement | null = null;
    for (let node = image.parentElement; node && node !== root; node = node.parentElement) {
      if (node.contains(composer) || node.contains(messages)) break;
      const rect = node.getBoundingClientRect();
      if (rect.height > 72 || rect.width > messageRect.width + 2) break;
      const inFooter = rect.top >= messageRect.bottom - 16
        && rect.top <= messageRect.bottom + 72
        && rect.bottom <= composerRect.top + 8
        && rect.left >= messageRect.left - 2
        && rect.right <= messageRect.right + 2;
      if (!inFooter) continue;
      const count = node.querySelectorAll(IMAGE_SELECTOR).length;
      // Continue through emote-only wrappers: Kick gives the outer shell its own height
      // and padding. Never climb into slow mode, other footer controls or explanatory text.
      if (count >= 4 && count <= 24) {
        if (node.textContent?.trim() || node.querySelector('input, textarea, [contenteditable], [role="status"]')
          || Array.from(node.querySelectorAll('img')).some((img) => !img.matches(IMAGE_SELECTOR))
          || Array.from(node.querySelectorAll('button')).some((button) => !button.querySelector(IMAGE_SELECTOR))) break;
        container = node;
      }
    }
    if (container) return container;
  }
  return null;
}

/** A reversible presentation preference. Never removes a Kick node or intercepts its clicks. */
export class NativeQuickEmoteBar {
  private target: HTMLElement | null = null;
  private originalDisplay = '';
  private originalPriority = '';

  constructor(lifecycle: Lifecycle, private readonly shouldHide: () => boolean) {
    this.sync();
    // Every chat row mutates this subtree; the lookup measures layout, so run it at most once a second.
    const resync = coalesce(() => this.sync(), QUICK_EMOTE_SYNC_GAP_MS, lifecycle);
    const observer = new MutationObserver(() => resync.run());
    observer.observe(document.body, { childList: true, subtree: true });
    lifecycle.add(() => observer.disconnect());
    visibleInterval(lifecycle, () => this.sync(), 2000);
    lifecycle.add(() => this.dispose());
  }

  sync(): void {
    const found = this.target?.isConnected && this.shouldHide()
      ? this.target : findNativeQuickEmoteBar();
    if (this.target !== found) {
      this.restore();
      this.target = found;
      if (found) {
        this.originalDisplay = found.style.getPropertyValue('display');
        this.originalPriority = found.style.getPropertyPriority('display');
        found.setAttribute(QUICK_EMOTE_ATTRIBUTE, '');
      }
    }
    if (!this.target) return;
    if (this.shouldHide()) this.target.style.setProperty('display', 'none', 'important');
    else if (this.target.style.getPropertyValue('display') === 'none'
      && this.target.style.getPropertyPriority('display') === 'important') {
      this.target.style.setProperty('display', this.originalDisplay, this.originalPriority);
    }
  }

  dispose(): void { this.restore(); }

  private restore(): void {
    if (!this.target) return;
    this.target.style.setProperty('display', this.originalDisplay, this.originalPriority);
    this.target.removeAttribute(QUICK_EMOTE_ATTRIBUTE);
    this.target = null;
  }
}
