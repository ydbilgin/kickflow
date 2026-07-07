import { featureFlags } from './feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import type { ChatIntegrityStore } from './message-store';
import {
  BANNED_CLASS,
  DELETED_CLASS,
  PRESERVED_CLASS,
  TIMEOUT_CLASS,
  appendParsedContent,
  applyPreservedMarking,
} from './message-view';

const CHAT_ROOT_SELECTOR = '#chatroom-messages';
const CHAT_LIST_SELECTOR = '#chatroom-messages .no-scrollbar';
const ROW_SELECTOR = '[data-index]';
const AUGMENTED_CLASS = 'kickflow-augmented';
const ORIGINAL_CONTENT_CLASS = 'kickflow-original-content';
const DIMMED_NATIVE_CONTENT_CLASS = 'kickflow-native-content-dimmed';

const INJECTED_SELECTOR = [
  '.kickflow-status-label',
  '.kickflow-mod-label',
  `.${ORIGINAL_CONTENT_CLASS}`,
].join(',');

const PRESERVED_CLASSES = [
  AUGMENTED_CLASS,
  PRESERVED_CLASS,
  BANNED_CLASS,
  TIMEOUT_CLASS,
  DELETED_CLASS,
];

export class NativeChatAugmenter {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
  ) {
    const attach = (): void => this.attachToCurrentChat();
    attach();
    lifecycle.setInterval(attach, 1000);
    lifecycle.add(() => this.disconnect());
  }

  markById(id: string): void {
    const row = document.querySelector<HTMLElement>(
      `${CHAT_ROOT_SELECTOR} [data-kickflow-mid="${CSS.escape(id)}"]`,
    );
    if (row) this.reconcileRow(row);
  }

  private attachToCurrentChat(): void {
    const root = document.querySelector<HTMLElement>(CHAT_ROOT_SELECTOR);
    if (!root || root === this.observedRoot) return;

    this.disconnect();
    this.observedRoot = root;
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-kickflow-mid'],
    });
    this.reconcileVisibleRows();
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;
  }

  private reconcileVisibleRows(): void {
    document
      .querySelectorAll<HTMLElement>(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}`)
      .forEach((row) => this.reconcileRow(row));
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const row = this.asRow(mutation.target);
        if (row) this.reconcileRow(row);
        continue;
      }

      for (const node of mutation.addedNodes) {
        this.collectRows(node).forEach((row) => this.reconcileRow(row));
      }
    }
  }

  private collectRows(node: Node): HTMLElement[] {
    if (!(node instanceof HTMLElement)) return [];
    const rows: HTMLElement[] = [];
    const self = this.asRow(node);
    if (self) rows.push(self);
    rows.push(...Array.from(node.querySelectorAll<HTMLElement>(ROW_SELECTOR)));
    return rows;
  }

  private asRow(target: EventTarget | Node): HTMLElement | null {
    return target instanceof HTMLElement && target.matches(ROW_SELECTOR) ? target : null;
  }

  private reconcileRow(row: HTMLElement, retryIfUnstamped = true): void {
    this.cleanRow(row);

    const id = row.dataset.kickflowMid;
    if (!id) {
      if (retryIfUnstamped) {
        window.setTimeout(() => this.reconcileRow(row, false), 0);
      }
      return;
    }

    const message = this.store.getMessageById(id);
    if (!message?.preserved) return;
    if (message.preservedReason === 'deleted' && !featureFlags.showDeletedMessages) return;

    row.classList.add(AUGMENTED_CLASS);
    this.dimNativeContent(row);

    const original = document.createElement('span');
    original.className = ORIGINAL_CONTENT_CLASS;
    appendParsedContent(original, message.content);
    row.appendChild(original);

    applyPreservedMarking(row, message);
  }

  private cleanRow(row: HTMLElement): void {
    row.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
    row.classList.remove(...PRESERVED_CLASSES);
    row
      .querySelectorAll(`.${DIMMED_NATIVE_CONTENT_CLASS}`)
      .forEach((node) => node.classList.remove(DIMMED_NATIVE_CONTENT_CLASS));
  }

  private dimNativeContent(row: HTMLElement): void {
    const candidates = [
      '.break-words',
      '[class*="break-words"]',
      'span[class*="font-normal"]',
      'span[class*="text"]',
    ];
    for (const selector of candidates) {
      const element = row.querySelector<HTMLElement>(selector);
      if (element && !element.classList.contains(ORIGINAL_CONTENT_CLASS)) {
        element.classList.add(DIMMED_NATIVE_CONTENT_CLASS);
        return;
      }
    }
  }
}
