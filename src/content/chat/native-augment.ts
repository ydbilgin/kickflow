import { featureFlags } from './feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import type { ChatIntegrityStore } from './message-store';
import {
  BANNED_CLASS,
  DELETED_CLASS,
  PRESERVED_CLASS,
  TIMEOUT_CLASS,
  appendBadges,
  appendParsedContent,
  applyPreservedMarking,
} from './message-view';

const CHAT_ROOT_SELECTOR = '#chatroom-messages';
const CHAT_LIST_SELECTOR = '#chatroom-messages .no-scrollbar';
const ROW_SELECTOR = '[data-index]';
const AUGMENTED_CLASS = 'kickflow-augmented';
const ORIGINAL_CONTENT_CLASS = 'kickflow-original-content';
const DIMMED_NATIVE_CONTENT_CLASS = 'kickflow-native-content-dimmed';
const GHOST_BLOCK_CLASS = 'kickflow-ghost-block';
const GHOST_ROW_CLASS = 'kickflow-ghost-row';
const GHOST_STRIP_CLASS = 'kickflow-ghost-strip';
const GHOST_STRIP_COLLAPSED_CLASS = 'kickflow-ghost-strip--collapsed';
const GHOST_STRIP_BODY_CLASS = 'kickflow-ghost-strip__body';

const INJECTED_SELECTOR = [
  `.${GHOST_BLOCK_CLASS}`,
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

let activeAugmenter: NativeChatAugmenter | null = null;

export function reconcileActiveNativeChat(): void {
  activeAugmenter?.reconcileAll();
}

export interface NativeChatGhostStats {
  ghostAnchored: number;
  ghostPendingNoAnchor: number;
  ghostStrip: number;
  ghostEvicted: number;
}

export function getActiveNativeChatGhostStats(): NativeChatGhostStats {
  return activeAugmenter?.getGhostStats() ?? {
    ghostAnchored: 0,
    ghostPendingNoAnchor: 0,
    ghostStrip: 0,
    ghostEvicted: 0,
  };
}

export class NativeChatAugmenter {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;
  private readonly ghostsNeeded = new Set<string>();
  private readonly ghostAnchorById = new Map<string, string>();
  private readonly ghostsByAnchor = new Map<string, Set<string>>();
  private reanchorTimer: number | null = null;
  private strip: HTMLElement | null = null;
  private stripCollapsed = false;
  private ghostEvicted = 0;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
  ) {
    const attach = (): void => this.attachToCurrentChat();
    activeAugmenter = this;
    attach();
    lifecycle.setInterval(attach, 1000);
    lifecycle.add(() => {
      if (activeAugmenter === this) activeAugmenter = null;
      this.dispose();
    });
  }

  markById(id: string): void {
    const row = document.querySelector<HTMLElement>(
      `${CHAT_ROOT_SELECTOR} [data-kickflow-mid="${CSS.escape(id)}"]`,
    );
    if (row) this.reconcileRow(row);
  }

  seedBannedGhosts(ids: string[]): void {
    if (!featureFlags.preserveBansInline) return;
    let changed = false;
    for (const id of ids) {
      if (!this.store.isPreservedBanned(id) || this.isMessageMounted(id)) continue;
      this.ghostsNeeded.add(id);
      changed = true;
    }
    if (changed) this.scheduleAnchorPass();
  }

  forgetGhost(id: string): void {
    const hadGhost = this.ghostsNeeded.delete(id) || this.ghostAnchorById.has(id);
    this.removeGhostFromAnchor(id);
    this.removeFromStrip(id);
    if (hadGhost) this.ghostEvicted++;
    this.renderFallbackStrip();
  }

  reconcileAll(): void {
    if (!featureFlags.preserveBansInline) this.clearGhosts();
    this.reconcileVisibleRows();
    if (featureFlags.preserveBansInline) this.scheduleAnchorPass();
  }

  getGhostStats(): NativeChatGhostStats {
    return {
      ghostAnchored: this.ghostAnchorById.size,
      ghostPendingNoAnchor: this.ghostsNeeded.size,
      ghostStrip: this.getStripMessageIds().length,
      ghostEvicted: this.ghostEvicted,
    };
  }

  private attachToCurrentChat(): void {
    const root = document.querySelector<HTMLElement>(CHAT_ROOT_SELECTOR);
    if (!root || root === this.observedRoot) return;

    this.disconnectObserver();
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

  private disconnectObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;
  }

  private dispose(): void {
    this.disconnectObserver();
    this.clearGhosts();
  }

  private reconcileVisibleRows(): void {
    document
      .querySelectorAll<HTMLElement>(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}`)
      .forEach((row) => this.reconcileRow(row));
  }

  private handleMutations(mutations: MutationRecord[]): void {
    let mountedSetChanged = false;
    let needsAnchorPass = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const row = this.asRow(mutation.target);
        if (row) {
          mountedSetChanged = true;
          this.reconcileRow(row);
        }
        continue;
      }

      for (const node of mutation.addedNodes) {
        const rows = this.collectRows(node);
        if (rows.length > 0) mountedSetChanged = true;
        rows.forEach((row) => this.reconcileRow(row));
      }

      if (featureFlags.preserveBansInline) {
        for (const node of mutation.removedNodes) {
          const rows = this.collectRows(node);
          if (rows.length > 0) mountedSetChanged = true;
          for (const id of this.collectMessageIds(node)) {
            if (this.store.isPreservedBanned(id)) {
              this.ghostsNeeded.add(id);
              needsAnchorPass = true;
            }
            if (this.ghostsByAnchor.has(id)) needsAnchorPass = true;
          }
        }
      }
    }

    if (
      featureFlags.preserveBansInline &&
      (needsAnchorPass || (mountedSetChanged && (this.ghostsNeeded.size > 0 || this.ghostAnchorById.size > 0)))
    ) {
      this.scheduleAnchorPass();
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

  private collectMessageIds(node: Node): string[] {
    if (!(node instanceof HTMLElement)) return [];
    const ids: string[] = [];
    const self = node.dataset.kickflowMid;
    if (self) ids.push(self);
    node.querySelectorAll<HTMLElement>('[data-kickflow-mid]').forEach((element) => {
      const id = element.dataset.kickflowMid;
      if (id) ids.push(id);
    });
    return ids;
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
    if (message?.preserved) {
      if (message.preservedReason !== 'deleted' || featureFlags.showDeletedMessages) {
        row.classList.add(AUGMENTED_CLASS);
        this.dimNativeContent(row);

        const original = document.createElement('span');
        original.className = ORIGINAL_CONTENT_CLASS;
        appendParsedContent(original, message.content);
        row.appendChild(original);

        applyPreservedMarking(row, message);
      }
    }

    if (featureFlags.preserveBansInline) this.reapplyGhostsForAnchor(id, row);
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

  private scheduleAnchorPass(): void {
    if (this.reanchorTimer != null) return;
    this.reanchorTimer = window.setTimeout(() => {
      this.reanchorTimer = null;
      this.reanchorGhosts();
    }, 0);
  }

  private reanchorGhosts(): void {
    if (!featureFlags.preserveBansInline) {
      this.clearGhosts();
      return;
    }

    const ids = new Set<string>(this.ghostsNeeded);
    for (const id of this.ghostAnchorById.keys()) ids.add(id);
    for (const message of this.store.getPreserved()) {
      if (message.preservedReason === 'banned' && !this.isMessageMounted(message.id)) ids.add(message.id);
    }
    Array.from(ids)
      .sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0))
      .forEach((id) => this.reanchorGhost(id));
    this.renderFallbackStrip();
  }

  private reanchorGhost(id: string): void {
    const message = this.store.getMessageById(id);
    if (!message?.preserved || message.preservedReason !== 'banned') {
      this.forgetGhost(id);
      return;
    }

    if (this.isMessageMounted(id)) {
      this.ghostsNeeded.delete(id);
      this.removeGhostFromAnchor(id);
      this.removeFromStrip(id);
      return;
    }

    const anchor = this.resolveAnchor(message);
    if (!anchor) {
      this.removeGhostFromAnchor(id);
      this.ghostsNeeded.add(id);
      return;
    }

    const previousAnchor = this.ghostAnchorById.get(id);
    if (previousAnchor === anchor.mid && this.isGhostMountedUnderAnchor(id, anchor.row)) {
      this.ghostsNeeded.delete(id);
      this.removeFromStrip(id);
      return;
    }

    this.removeGhostFromAnchor(id);
    this.ghostAnchorById.set(id, anchor.mid);
    let set = this.ghostsByAnchor.get(anchor.mid);
    if (!set) {
      set = new Set<string>();
      this.ghostsByAnchor.set(anchor.mid, set);
    }
    set.add(id);
    this.ghostsNeeded.delete(id);
    this.removeFromStrip(id);
    this.injectGhostBlock(anchor.row, anchor.mid);
  }

  private resolveAnchor(bannedMessage: NonNullable<ReturnType<ChatIntegrityStore['getMessageById']>>): { mid: string; row: HTMLElement } | null {
    const bannedSeq = bannedMessage.seq;
    if (bannedSeq == null) return null;

    let previous: { mid: string; row: HTMLElement; seq: number } | null = null;
    let next: { mid: string; row: HTMLElement; seq: number } | null = null;
    document.querySelectorAll<HTMLElement>(`${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid]`).forEach((row) => {
      const mid = row.dataset.kickflowMid;
      if (!mid || mid === bannedMessage.id || this.store.isPreservedBanned(mid)) return;
      const seq = this.store.getMessageSeq(mid);
      if (seq == null) return;
      if (seq < bannedSeq && (!previous || seq > previous.seq)) previous = { mid, row, seq };
      if (seq > bannedSeq && (!next || seq < next.seq)) next = { mid, row, seq };
    });
    return previous ?? next;
  }

  private reapplyGhostsForAnchor(anchorMid: string, row: HTMLElement): void {
    if (this.store.isPreservedBanned(anchorMid)) {
      if (this.ghostsByAnchor.has(anchorMid)) this.scheduleAnchorPass();
      return;
    }
    if (!this.ghostsByAnchor.has(anchorMid)) return;
    this.injectGhostBlock(row, anchorMid);
  }

  private injectGhostBlock(anchorRow: HTMLElement, anchorMid: string): void {
    const ids = Array.from(this.ghostsByAnchor.get(anchorMid) ?? [])
      .filter((id) => {
        const message = this.store.getMessageById(id);
        return message?.preserved === true && message.preservedReason === 'banned';
      })
      .sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0));

    const host = this.findGhostHost(anchorRow);
    const existing = host.querySelector<HTMLElement>(`:scope > .${GHOST_BLOCK_CLASS}`);
    const existingIds = existing?.dataset.kickflowGhostIds?.split(',').filter(Boolean) ?? [];
    if (existing && existingIds.join(',') === ids.join(',')) return;
    existing?.remove();
    if (ids.length === 0) return;

    const block = document.createElement('div');
    block.className = GHOST_BLOCK_CLASS;
    block.dataset.kickflowGhostAnchor = anchorMid;
    block.dataset.kickflowGhostIds = ids.join(',');
    for (const id of ids) {
      const message = this.store.getMessageById(id);
      if (message) block.appendChild(this.buildGhostRow(message));
    }
    host.appendChild(block);
  }

  private findGhostHost(row: HTMLElement): HTMLElement {
    return Array.from(row.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement && child.classList.contains('group')
    )) ?? row;
  }

  private buildGhostRow(message: NonNullable<ReturnType<ChatIntegrityStore['getMessageById']>>): HTMLElement {
    const row = document.createElement('div');
    row.className = GHOST_ROW_CLASS;
    row.dataset.kickflowGhostMid = message.id;

    const time = document.createElement('span');
    time.className = 'kickflow-ghost-row__time';
    const createdAt = new Date(message.createdAt);
    time.textContent = Number.isNaN(createdAt.getTime())
      ? ''
      : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const badges = document.createElement('span');
    badges.className = 'kickflow-ghost-row__badges';
    appendBadges(badges, message.sender.identity.badgesV2.length > 0
      ? message.sender.identity.badgesV2
      : message.sender.identity.badges);

    const username = document.createElement('span');
    username.className = 'kickflow-ghost-row__username';
    username.textContent = message.sender.username;
    username.style.color = message.sender.identity.color || 'inherit';

    const separator = document.createElement('span');
    separator.className = 'kickflow-ghost-row__separator';
    separator.textContent = ': ';

    const content = document.createElement('span');
    content.className = 'kickflow-ghost-row__content';
    appendParsedContent(content, message.content);

    row.append(time, badges, username, separator, content);
    applyPreservedMarking(row, message);
    return row;
  }

  private removeGhostFromAnchor(id: string): void {
    const anchorMid = this.ghostAnchorById.get(id);
    if (!anchorMid) return;
    this.ghostAnchorById.delete(id);
    const ids = this.ghostsByAnchor.get(anchorMid);
    ids?.delete(id);
    if (!ids || ids.size === 0) {
      this.ghostsByAnchor.delete(anchorMid);
      this.findMountedRowByMid(anchorMid)
        ?.querySelector(`.${GHOST_BLOCK_CLASS}`)
        ?.remove();
      return;
    }
    const row = this.findMountedRowByMid(anchorMid);
    if (row) this.injectGhostBlock(row, anchorMid);
  }

  private isMessageMounted(id: string): boolean {
    return this.findMountedRowByMid(id) !== null;
  }

  private findMountedRowByMid(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `${CHAT_LIST_SELECTOR} ${ROW_SELECTOR}[data-kickflow-mid="${CSS.escape(id)}"]`,
    );
  }

  private isGhostMountedUnderAnchor(id: string, anchorRow: HTMLElement): boolean {
    return anchorRow.querySelector(`[data-kickflow-ghost-mid="${CSS.escape(id)}"]`) !== null;
  }

  private renderFallbackStrip(): void {
    const messages = Array.from(this.ghostsNeeded)
      .map((id) => this.store.getMessageById(id))
      .filter((message): message is NonNullable<ReturnType<ChatIntegrityStore['getMessageById']>> => (
        message?.preserved === true &&
        message.preservedReason === 'banned' &&
        !this.isMessageMounted(message.id)
      ))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    if (messages.length === 0) {
      this.strip?.remove();
      this.strip = null;
      return;
    }

    const strip = this.ensureStrip();
    strip.classList.toggle(GHOST_STRIP_COLLAPSED_CLASS, this.stripCollapsed);
    const body = strip.querySelector<HTMLElement>(`.${GHOST_STRIP_BODY_CLASS}`);
    if (!body) return;
    body.replaceChildren(...messages.map((message) => this.buildGhostRow(message)));
  }

  private ensureStrip(): HTMLElement {
    if (this.strip?.isConnected) return this.strip;

    const strip = document.createElement('section');
    strip.className = GHOST_STRIP_CLASS;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kickflow-ghost-strip__toggle';
    button.textContent = 'son kaldırılanlar';
    button.addEventListener('click', () => {
      this.stripCollapsed = !this.stripCollapsed;
      this.renderFallbackStrip();
    });

    const body = document.createElement('div');
    body.className = GHOST_STRIP_BODY_CLASS;
    strip.append(button, body);
    document.body.appendChild(strip);
    this.strip = strip;
    return strip;
  }

  private removeFromStrip(id: string): void {
    this.strip?.querySelector(`[data-kickflow-ghost-mid="${CSS.escape(id)}"]`)?.remove();
  }

  private getStripMessageIds(): string[] {
    if (!this.strip?.isConnected) return [];
    return Array.from(this.strip.querySelectorAll<HTMLElement>('[data-kickflow-ghost-mid]'))
      .map((row) => row.dataset.kickflowGhostMid)
      .filter((id): id is string => Boolean(id));
  }

  private clearGhosts(): void {
    if (this.reanchorTimer != null) {
      window.clearTimeout(this.reanchorTimer);
      this.reanchorTimer = null;
    }
    document.querySelectorAll(`.${GHOST_BLOCK_CLASS}`).forEach((node) => node.remove());
    this.strip?.remove();
    this.strip = null;
    this.ghostsNeeded.clear();
    this.ghostAnchorById.clear();
    this.ghostsByAnchor.clear();
  }
}
