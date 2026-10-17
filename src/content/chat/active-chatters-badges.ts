import type { Lifecycle } from '../shared/lifecycle';
import { t } from '../shared/i18n';
import { logger } from '../shared/logger';
import {
  ACTIVE_CHATTERS_PANEL_SELECTOR,
  ACTIVE_CHATTERS_ROW_FALLBACK_SELECTOR,
  ACTIVE_CHATTERS_ROW_SELECTOR,
  ACTIVE_CHATTERS_SEARCH_SELECTOR,
  ACTIVE_CHATTERS_USERNAME_FALLBACK_SELECTOR,
  ACTIVE_CHATTERS_USERNAME_SELECTOR,
  SELECTORS,
} from '../shared/selectors';
import type { ChatIntegrityStore } from './message-store';
import type { RemovedMessagesPanel } from './removed-panel';
import { isSafeKickSlug, openUserCard } from './user-card';

export {
  ACTIVE_CHATTERS_PANEL_SELECTOR,
  ACTIVE_CHATTERS_ROW_SELECTOR,
  ACTIVE_CHATTERS_SEARCH_SELECTOR,
  ACTIVE_CHATTERS_USERNAME_SELECTOR,
};

const BADGE_CLASS = 'kickflow-active-chatters-badge';
const INJECTED_SELECTOR = `.${BADGE_CLASS}`;
const USER_CARD_ACTIVATION_KEYS = new Set(['Enter', ' ']);
/** Ancestors walked from the search input while looking for the panel. 2026-10-15. */
const PANEL_ANCESTOR_LIMIT = 8;
/** Rows can mount after the search field. Warn once, this long after the field is first seen. 2026-10-15. */
const PANEL_RESOLVE_WAIT_MS = 5_000;

function usernameElementIn(row: ParentNode): HTMLElement | null {
  return row.querySelector<HTMLElement>(ACTIVE_CHATTERS_USERNAME_SELECTOR)
    ?? row.querySelector<HTMLElement>(ACTIVE_CHATTERS_USERNAME_FALLBACK_SELECTOR);
}

function isInsideChatMessageList(element: Element): boolean {
  return element.closest(SELECTORS.chatMessagesContainer) !== null;
}

function isLooseChatterButton(button: HTMLElement): boolean {
  const item = button.parentElement;
  const list = item?.parentElement;
  if (item?.tagName !== 'LI' || list?.tagName !== 'UL') return false;
  return usernameElementIn(button) !== null;
}

/** Exact class match first, then `ul > li > button` with a username span. Rows inside the chat
 * message list never count: that list is not the active-chatters panel. 2026-10-15. */
function listChatterRows(root: ParentNode): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const rows: HTMLElement[] = [];
  const add = (row: HTMLElement): void => {
    if (seen.has(row) || isInsideChatMessageList(row) || !usernameElementIn(row)) return;
    seen.add(row);
    rows.push(row);
  };
  root.querySelectorAll<HTMLElement>(ACTIVE_CHATTERS_ROW_SELECTOR).forEach(add);
  root.querySelectorAll<HTMLElement>(ACTIVE_CHATTERS_ROW_FALLBACK_SELECTOR).forEach((row) => {
    if (isLooseChatterButton(row)) add(row);
  });
  return rows;
}

function isRejectedPanel(element: HTMLElement): boolean {
  return element === document.body
    || element === document.documentElement
    || element.matches(SELECTORS.chatMessagesContainer);
}

/** Nearest ancestor first, at most PANEL_ANCESTOR_LIMIT steps, stopping before body. */
function panelCandidates(search: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  let node = search.parentElement;
  for (let depth = 0; depth < PANEL_ANCESTOR_LIMIT && node; depth += 1) {
    if (node === document.body || node === document.documentElement) break;
    if (!isRejectedPanel(node) && listChatterRows(node).length > 0) candidates.push(node);
    node = node.parentElement;
  }
  return candidates;
}

/** Preference: legacy class selector, then a section, then a dialog, then the nearest ancestor
 * that actually contains chatter rows. 2026-10-15. */
function panelFromSearch(search: HTMLElement): HTMLElement | null {
  const candidates = panelCandidates(search);
  return candidates.find((element) => element.matches(ACTIVE_CHATTERS_PANEL_SELECTOR))
    ?? candidates.find((element) => element.tagName === 'SECTION')
    ?? candidates.find((element) => element.matches('[role="dialog"]'))
    ?? candidates[0]
    ?? null;
}

function chatterRowFromTarget(target: Element, root: HTMLElement): HTMLElement | null {
  const exact = target.closest<HTMLElement>(ACTIVE_CHATTERS_ROW_SELECTOR);
  if (exact && root.contains(exact) && !isInsideChatMessageList(exact) && usernameElementIn(exact)) return exact;
  const button = target.closest('button');
  if (!(button instanceof HTMLElement) || !root.contains(button)) return null;
  if (isInsideChatMessageList(button) || !isLooseChatterButton(button)) return null;
  return button;
}

export class ActiveChattersBadgesController {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;
  private missingPanelTimerId: number | null = null;
  private missingPanelWatchStarted = false;
  private warnedMissingPanel = false;
  private disposed = false;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
    private readonly removedPanel: RemovedMessagesPanel,
  ) {
    const attach = (): void => this.attachToCurrentPanel();
    attach();
    lifecycle.setInterval(attach, 1000);
    lifecycle.add(() => this.dispose());
  }

  reconcileAll(): void {
    const root = this.observedRoot;
    if (!root) return;

    // Owned-node allowlist and sweep: every pass removes only KickFlow's badge nodes, then
    // derives the current state from Kick's rows plus the in-memory store.
    root.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
    listChatterRows(root).forEach((row) => {
      const usernameElement = usernameElementIn(row);
      const label = usernameElement?.textContent?.trim() ?? '';
      if (!usernameElement || !label) return;

      // Kick keeps slug only as a React key. Recover it from exact session-known username
      // evidence, and prefer no badge when multiple canonical slugs are possible.
      const slug = this.store.resolvePreservedSlugForUsername(label);
      if (!slug) return;
      const matches = this.store.getPreservedForSlug(slug);
      if (matches.length === 0) return;

      const badge = document.createElement('span');
      badge.className = `kickflow-badge-role ${BADGE_CLASS}`;
      badge.dataset.kickflowSlug = slug;
      badge.setAttribute('role', 'button');
      badge.tabIndex = 0;
      badge.textContent = t('chatters.removed_count', { n: matches.length });
      badge.setAttribute('aria-label', t('chatters.open_removed', { name: label, n: matches.length }));
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removedPanel.showUserFilter(slug, label);
      });
      badge.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.removedPanel.showUserFilter(slug, label);
      });
      row.append(badge);
    });
  }

  private findCurrentPanel(): HTMLElement | null {
    const searches = document.querySelectorAll<HTMLInputElement>(ACTIVE_CHATTERS_SEARCH_SELECTOR);
    let loose: HTMLElement | null = null;
    for (const search of searches) {
      const panel = panelFromSearch(search);
      if (!panel) continue;
      if (panel.matches(ACTIVE_CHATTERS_PANEL_SELECTOR)) return panel;
      if (!loose) loose = panel;
    }
    return loose;
  }

  private attachToCurrentPanel(): void {
    const root = this.findCurrentPanel();
    if (!root) {
      this.armMissingPanelWarning();
      this.disconnectObserver(true);
      return;
    }
    this.clearMissingPanelTimer();
    if (root === this.observedRoot) {
      this.reconcileAll();
      return;
    }

    this.disconnectObserver(true);
    this.observedRoot = root;
    this.attachPanelActivationListeners(root);
    this.observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => this.isOwnedMutation(mutation))) return;
      this.reconcileAll();
    });
    this.observer.observe(root, { childList: true, subtree: true });
    this.reconcileAll();
  }

  /** One clock per page load, started the first time the search field is seen with no panel. */
  private armMissingPanelWarning(): void {
    if (this.disposed || this.missingPanelWatchStarted || this.warnedMissingPanel) return;
    if (!document.querySelector(ACTIVE_CHATTERS_SEARCH_SELECTOR)) return;
    this.missingPanelWatchStarted = true;
    this.missingPanelTimerId = window.setTimeout(() => this.warnIfPanelStillMissing(), PANEL_RESOLVE_WAIT_MS);
  }

  private warnIfPanelStillMissing(): void {
    this.missingPanelTimerId = null;
    if (this.disposed || this.warnedMissingPanel) return;
    if (this.findCurrentPanel()) return;
    if (!document.querySelector(ACTIVE_CHATTERS_SEARCH_SELECTOR)) return;
    this.warnedMissingPanel = true;
    logger.warn(
      `active-chatters: ${ACTIVE_CHATTERS_SEARCH_SELECTOR} rendered, but no panel containing chatter rows `
      + `was found within 5s. Badge and user-card attachment is inactive.`,
    );
  }

  private clearMissingPanelTimer(): void {
    if (this.missingPanelTimerId === null) return;
    window.clearTimeout(this.missingPanelTimerId);
    this.missingPanelTimerId = null;
  }

  private isOwnedMutation(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList') return false;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    return changed.length > 0 && changed.every(
      (node) => node instanceof Element && node.matches(INJECTED_SELECTOR),
    );
  }

  private handlePanelActivation = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(INJECTED_SELECTOR)) return;

    const root = this.observedRoot;
    if (!root) return;
    const row = chatterRowFromTarget(target, root);
    if (!row) return;

    const username = usernameElementIn(row)?.textContent?.trim() ?? '';
    const slug = username.toLowerCase();
    if (!username || !isSafeKickSlug(slug)) return;

    if (event.type === 'keydown') {
      const keyboardEvent = event as KeyboardEvent;
      if (!USER_CARD_ACTIVATION_KEYS.has(keyboardEvent.key)) return;

      keyboardEvent.preventDefault();
      keyboardEvent.stopImmediatePropagation();
      const rect = row.getBoundingClientRect();
      void openUserCard(slug, username, rect.left, rect.bottom, null);
      return;
    }

    if (event.type !== 'click') return;
    const mouseEvent = event as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopImmediatePropagation();
    void openUserCard(slug, username, mouseEvent.clientX, mouseEvent.clientY, null);
  };

  private attachPanelActivationListeners(root: HTMLElement): void {
    root.addEventListener('click', this.handlePanelActivation, true);
    root.addEventListener('keydown', this.handlePanelActivation, true);
  }

  private disconnectObserver(clearBadges: boolean): void {
    const root = this.observedRoot;
    if (root) {
      root.removeEventListener('click', this.handlePanelActivation, true);
      root.removeEventListener('keydown', this.handlePanelActivation, true);
    }
    if (clearBadges) root?.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;
  }

  private dispose(): void {
    this.disposed = true;
    this.clearMissingPanelTimer();
    this.disconnectObserver(true);
  }
}
