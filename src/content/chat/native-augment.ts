import { featureFlags } from './feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import { mergeIdentityBadges, type ChatIntegrityStore } from './message-store';
import {
  BANNED_CLASS,
  DELETED_CLASS,
  PRESERVED_CLASS,
  TIMEOUT_CLASS,
  appendBadges,
  appendParsedContent,
  applyPreservedMarking,
  wireUsernameProfileLink,
} from './message-view';

const CHAT_ROOT_SELECTOR = '#chatroom-messages';
const CHAT_LIST_SELECTOR = '#chatroom-messages .no-scrollbar';
const ROW_SELECTOR = '[data-index]';
const AUGMENTED_CLASS = 'kickflow-augmented';
const ORIGINAL_CONTENT_CLASS = 'kickflow-original-content';
const DIMMED_NATIVE_CONTENT_CLASS = 'kickflow-native-content-dimmed';
const GHOST_BLOCK_CLASS = 'kickflow-ghost-block';
const GHOST_ROW_CLASS = 'kickflow-ghost-row';
const NATIVE_CONTENT_SELECTOR = '.break-words, [class*="break-words"]';

// Bounds so a high-moderation channel (mass bans) can't pile ghosts onto the few visible
// rows. A banned message only anchors INLINE if its chronological context is still near the
// viewport (a mounted neighbor within this many seq); otherwise it stays pending (surfaced by
// the shared RemovedMessagesPanel, owned by bootstrap.ts, not by this augmenter).
const ANCHOR_MAX_SEQ_DISTANCE = 20;
const MAX_GHOSTS_PER_ANCHOR = 4;

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
  private ghostEvicted = 0;

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
  ) {
    const attach = (): void => this.attachToCurrentChat();
    activeAugmenter = this;
    attach();
    lifecycle.setInterval(() => attach(), 1000);
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
    if (hadGhost) this.ghostEvicted++;
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
      // The bounded strip is gone — pending ghosts now surface via the shared
      // RemovedMessagesPanel (bootstrap.ts), which this augmenter no longer owns.
      ghostStrip: 0,
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
    this.clearGhosts();
    this.disconnectObserver();
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

      // Kick normally mutates the current .break-words holder in place, but a React remount can
      // replace it entirely. Observe that narrow replacement shape so the new native deletion
      // placeholder is hidden and our store-backed copy remains the sole visible content. Do not
      // reconcile arbitrary child changes: our own injected markup would otherwise loop here.
      if (this.mutationTouchesNativeContent(mutation)) {
        const row = this.closestRow(mutation.target);
        if (row) this.reconcileRow(row);
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

  private closestRow(target: EventTarget | Node): HTMLElement | null {
    if (!(target instanceof Node)) return null;
    const element = target instanceof HTMLElement ? target : target.parentElement;
    return element?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
  }

  private mutationTouchesNativeContent(mutation: MutationRecord): boolean {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some((node) => node instanceof HTMLElement && (
      node.matches(NATIVE_CONTENT_SELECTOR)
      || node.querySelector(NATIVE_CONTENT_SELECTOR) !== null
    ));
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
    if (this.lifecycle.isDisposed) return;
    this.cleanRow(row);

    const id = row.dataset.kickflowMid;
    if (!id) {
      if (retryIfUnstamped) {
        // React can stamp the row's id one microtask after it mounts. Route that retry through
        // the session lifecycle so it cannot inject stale markup after a channel switch.
        this.lifecycle.setTimeout(() => this.reconcileRow(row, false), 0);
      }
      return;
    }

    const message = this.store.getMessageById(id);
    if (message?.preserved) {
      if (message.preservedReason !== 'deleted' || featureFlags.showDeletedMessages) {
        row.classList.add(AUGMENTED_CLASS);
        // Always hide the native content and render our OWN stored copy. Kick sometimes leaves the
        // original text in the row and sometimes swaps it to a "Deleted by a moderator" placeholder
        // — and may swap AFTER we mark — so reading the native text races: it either duplicates the
        // message (native original + our copy) or loses it (we struck a soon-to-be placeholder).
        // Hiding native + rendering from our store is race-free: exactly one struck copy, always
        // the real text, with the sender name.
        this.hideNativeContent(row);
        row.appendChild(this.buildPreservedInline(message));
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

  /** Hides the native message content (whatever it currently is — the original text or a
   * "Deleted by a moderator" placeholder) so our own stored copy is the only one shown. */
  private hideNativeContent(row: HTMLElement): void {
    const holder = row.querySelector<HTMLElement>(NATIVE_CONTENT_SELECTOR);
    if (holder && !holder.classList.contains(ORIGINAL_CONTENT_CLASS)) {
      holder.classList.add(DIMMED_NATIVE_CONTENT_CLASS);
    }
  }

  /** Builds our struck-through copy of a preserved message (sender name + original text) from the
   * store, so hiding the native row never loses who said what. */
  private buildPreservedInline(
    message: NonNullable<ReturnType<ChatIntegrityStore['getMessageById']>>,
  ): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = ORIGINAL_CONTENT_CLASS;
    const username = document.createElement('span');
    username.className = 'kickflow-preserved-username';
    const displayName = message.sender.displayName || message.sender.username;
    username.textContent = displayName;
    wireUsernameProfileLink(username, message.sender, displayName, 'kickflow-preserved-username--link');
    username.style.color = message.sender.identity.color || 'inherit';
    const separator = document.createElement('span');
    separator.textContent = ': ';
    const content = document.createElement('span');
    appendParsedContent(content, message.content);
    wrap.append(username, separator, content);
    return wrap;
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

    this.pruneStrayGhosts();

    const ids = new Set<string>(this.ghostsNeeded);
    for (const id of this.ghostAnchorById.keys()) ids.add(id);
    for (const message of this.store.getPreserved()) {
      if (message.preservedReason === 'banned' && !this.isMessageMounted(message.id)) ids.add(message.id);
    }
    Array.from(ids)
      .sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0))
      .forEach((id) => this.reanchorGhost(id));
  }

  /** Removes ghost DOM that duplicates or strands — the main defense against the same banned
   * message showing twice. react-virtuoso recycles row elements, so a ghost-block can be left
   * attached to a DOM row Kick has since reassigned to another message; and a message Kick later
   * re-renders natively should lose its ghost. Runs at the top of every anchor pass. */
  private pruneStrayGhosts(): void {
    // Inline ghosts belong only to the currently observed native chat subtree. The removed
    // messages panel deliberately reuses the row styling/data attribute, so document-wide scans
    // would otherwise erase its rows during every anchor pass.
    const root = this.observedRoot;
    if (!root) return;
    // 1. Ghost-blocks stranded on recycled rows (host row's mid no longer matches the block anchor).
    root.querySelectorAll<HTMLElement>(`.${GHOST_BLOCK_CLASS}`).forEach((block) => {
      const anchorMid = block.dataset.kickflowGhostAnchor;
      const row = block.closest<HTMLElement>(ROW_SELECTOR);
      if (!anchorMid || !row || row.dataset.kickflowMid !== anchorMid) block.remove();
    });
    // 2. Dedupe ghost rows; drop any whose message is now mounted natively or no longer a banned-preserve.
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>(`.${GHOST_ROW_CLASS}[data-kickflow-ghost-mid]`).forEach((el) => {
      const mid = el.dataset.kickflowGhostMid ?? '';
      const message = this.store.getMessageById(mid);
      const valid = message?.preserved === true
        && message.preservedReason === 'banned'
        && !this.isMessageMounted(mid);
      if (!valid || seen.has(mid)) {
        el.remove();
        return;
      }
      seen.add(mid);
    });
    // 3. Drop blocks emptied by the sweep.
    root.querySelectorAll<HTMLElement>(`.${GHOST_BLOCK_CLASS}`).forEach((block) => {
      if (!block.querySelector(`.${GHOST_ROW_CLASS}`)) block.remove();
    });
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
    // `as` cast: previous/next are assigned inside the forEach closure, which TS control-flow
    // narrowing doesn't track (it would otherwise treat them as still-null here).
    const chosen = (previous ?? next) as { mid: string; row: HTMLElement; seq: number } | null;
    // Only anchor inline when the banned message's context is still near the viewport. If the
    // nearest mounted neighbor is far away (its real neighbors scrolled off), don't pile it onto
    // an unrelated visible row — leave it pending (surfaced by the shared RemovedMessagesPanel).
    if (!chosen || Math.abs(chosen.seq - bannedSeq) > ANCHOR_MAX_SEQ_DISTANCE) return null;
    return { mid: chosen.mid, row: chosen.row };
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
      .sort((a, b) => (this.store.getMessageSeq(a) ?? 0) - (this.store.getMessageSeq(b) ?? 0))
      .slice(-MAX_GHOSTS_PER_ANCHOR); // cap per-anchor: keep the newest few, never stack a giant block

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
    appendBadges(badges, mergeIdentityBadges(message.sender.identity));

    const username = document.createElement('span');
    username.className = 'kickflow-ghost-row__username';
    const displayName = message.sender.displayName || message.sender.username;
    username.textContent = displayName;
    wireUsernameProfileLink(username, message.sender, displayName, 'kickflow-ghost-row__username--link');
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

  private clearGhosts(): void {
    if (this.reanchorTimer != null) {
      window.clearTimeout(this.reanchorTimer);
      this.reanchorTimer = null;
    }
    this.observedRoot?.querySelectorAll(`.${GHOST_BLOCK_CLASS}`).forEach((node) => node.remove());
    this.ghostsNeeded.clear();
    this.ghostAnchorById.clear();
    this.ghostsByAnchor.clear();
  }
}
