import type { Lifecycle } from '../shared/lifecycle';
import { t } from '../shared/i18n';
import type { ChatIntegrityStore } from './message-store';
import type { RemovedMessagesPanel } from './removed-panel';

/** Confirmed from Kick's 2026-07-19 production bundle. The input anchors discovery without
 * depending on localized heading/placeholder text; the surrounding class-bearing section and
 * nested list shape distinguish this surface from other search controls. */
export const ACTIVE_CHATTERS_PANEL_SELECTOR =
  'section.bg-surface-base.flex.size-full.min-h-0.flex-col.overflow-hidden.text-white';
export const ACTIVE_CHATTERS_SEARCH_SELECTOR = 'input[type="search"].h-8.pl-11.pr-3';
export const ACTIVE_CHATTERS_ROW_SELECTOR =
  'ul.flex.list-none.flex-col.overflow-hidden.p-0 > li > button.flex.h-auto.w-full';
export const ACTIVE_CHATTERS_USERNAME_SELECTOR =
  'span.min-w-0.flex-1.truncate.text-base.font-normal.leading-6';

const BADGE_CLASS = 'kickflow-active-chatters-badge';
const INJECTED_SELECTOR = `.${BADGE_CLASS}`;

export class ActiveChattersBadgesController {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;

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
    root.querySelectorAll<HTMLElement>(ACTIVE_CHATTERS_ROW_SELECTOR).forEach((row) => {
      const usernameElement = row.querySelector<HTMLElement>(ACTIVE_CHATTERS_USERNAME_SELECTOR);
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
    for (const search of searches) {
      const panel = search.closest<HTMLElement>(ACTIVE_CHATTERS_PANEL_SELECTOR);
      if (panel) return panel;
    }
    return null;
  }

  private attachToCurrentPanel(): void {
    const root = this.findCurrentPanel();
    if (!root) {
      this.disconnectObserver(true);
      return;
    }
    if (root === this.observedRoot) {
      this.reconcileAll();
      return;
    }

    this.disconnectObserver(true);
    this.observedRoot = root;
    this.observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => this.isOwnedMutation(mutation))) return;
      this.reconcileAll();
    });
    this.observer.observe(root, { childList: true, subtree: true });
    this.reconcileAll();
  }

  private isOwnedMutation(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList') return false;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    return changed.length > 0 && changed.every(
      (node) => node instanceof Element && node.matches(INJECTED_SELECTOR),
    );
  }

  private disconnectObserver(clearBadges: boolean): void {
    if (clearBadges) this.observedRoot?.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;
  }

  private dispose(): void {
    this.disconnectObserver(true);
  }
}
