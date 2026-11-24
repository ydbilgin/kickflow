import { visibleInterval } from '../shared/coalesce';
import type { Lifecycle } from '../shared/lifecycle';
import { formatNumber, t } from '../shared/i18n';

export const PAUSE_COUNT_CLASS = 'kickflow-pause-count';

/** Kick's own "Chat paused for scrolling" button. It sits in an absolutely positioned wrapper that is
 * a direct child of the chat column, next to the scroller. Identified by its Pause icon, not by its
 * words, so it works in every Kick language (seen live 2026-10-24: en "Chat paused for scrolling", tr
 * "kaydırırken sohbet duraklatıldı"). The pinned-message card is another absolute child of the same
 * column with buttons of its own (hide, expand); the first live build of this feature put the count on
 * that card, so the icon check is the whole point. Clicking the pill already resumes the chat natively. */
export function findNativePausePill(doc: Document = document): HTMLButtonElement | null {
  const column = doc.querySelector('#chatroom-messages')?.parentElement;
  if (!column) return null;
  for (const child of Array.from(column.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('absolute')) continue;
    for (const button of Array.from(child.querySelectorAll('button'))) {
      if (button.querySelector('svg[data-ds-icon="Pause"]')) return button;
    }
  }
  return null;
}

/** Adds "· N new messages" to Kick's pause pill while the reader is scrolled up. Kick's pill says the
 * chat is paused but not how much is waiting; this adds the count without a second pill on top of it. */
export class NativePausePillCounter {
  private count = 0;
  private present = false;
  private observer: MutationObserver | null = null;
  private observedColumn: Element | null = null;

  constructor(lifecycle: Lifecycle, private readonly doc: Document = document) {
    visibleInterval(lifecycle, () => this.sync(), 500);
    lifecycle.add(() => this.dispose());
    this.sync();
  }

  /** Call for every live chat message the store accepts. */
  noteMessage(): void {
    this.sync();
    if (!this.present) return;
    this.count++;
    this.render();
  }

  sync(): void {
    const pill = findNativePausePill(this.doc);
    this.watchColumn();
    if (!pill) {
      this.present = false;
      this.count = 0;
      return;
    }
    if (!this.present) {
      this.present = true;
      this.count = 0;
    }
    this.render(pill);
  }

  getCount(): number {
    return this.count;
  }

  private render(known?: HTMLButtonElement | null): void {
    const pill = known ?? findNativePausePill(this.doc);
    if (!pill) return;
    let badge = pill.querySelector<HTMLElement>(`.${PAUSE_COUNT_CLASS}`);
    if (this.count === 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = this.doc.createElement('span');
      badge.className = PAUSE_COUNT_CLASS;
      pill.appendChild(badge);
    }
    // Short on purpose: Kick's own label already fills most of the chat column width, so the visible
    // text is "+6" and the full phrase ("6 new messages") sits in the tooltip and the accessible name.
    const text = `+${formatNumber(this.count)}`;
    const phrase = t('chat.pause_count', { n: this.count, count: formatNumber(this.count) });
    if (badge.textContent !== text) badge.textContent = text;
    if (badge.title !== phrase) {
      badge.title = phrase;
      badge.setAttribute('aria-label', phrase);
    }
  }

  private watchColumn(): void {
    const column = this.doc.querySelector('#chatroom-messages')?.parentElement ?? null;
    if (column === this.observedColumn) return;
    this.observer?.disconnect();
    this.observedColumn = column;
    this.observer = null;
    if (!column) return;
    // Only the wrapper that holds the pill matters, so watch direct children of the column and
    // the wrapper's own subtree, not the whole virtualized message list.
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(column, { childList: true });
    for (const child of Array.from(column.children)) {
      if (child instanceof HTMLElement && child.classList.contains('absolute')) {
        this.observer.observe(child, { childList: true, subtree: true });
      }
    }
  }

  private dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedColumn = null;
    findNativePausePill(this.doc)?.querySelector(`.${PAUSE_COUNT_CLASS}`)?.remove();
  }
}
