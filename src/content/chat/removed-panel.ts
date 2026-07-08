import type { Lifecycle } from '../shared/lifecycle';
import { makeDraggable } from '../shared/draggable';
import { mergeIdentityBadges, type ChatIntegrityStore, type ChatMessage } from './message-store';
import { appendBadges, appendParsedContent, applyPreservedMarking } from './message-view';

const STRIP_CLASS = 'kickflow-ghost-strip';
const STRIP_COLLAPSED_CLASS = 'kickflow-ghost-strip--collapsed';
const STRIP_HEADER_CLASS = 'kickflow-ghost-strip__header';
const STRIP_GRIP_CLASS = 'kickflow-ghost-strip__grip';
const STRIP_TOGGLE_CLASS = 'kickflow-ghost-strip__toggle';
const STRIP_BODY_CLASS = 'kickflow-ghost-strip__body';
const GHOST_ROW_CLASS = 'kickflow-ghost-row';

// Bounded so a high-moderation channel (mass bans) can't grow the panel without limit — keep the
// newest N removed messages only.
const MAX_PANEL_ROWS = 60;

/** Persistent "kaldırılanlar" panel: a body-level, draggable, collapsible drawer listing every
 * removed (banned/timeout/deleted) message the session's `ChatIntegrityStore` still holds. Mode-
 * independent (Mode A own-render and Mode B native-augment both instantiate one against the same
 * store) — this is the single shared implementation, extracted so neither mode duplicates it.
 *
 * Session/channel isolation: data comes only from the in-memory store — never any persisted,
 * cross-tab-shared storage — and the panel is torn down via the session `Lifecycle` — a channel
 * switch or tab close disposes it, so two tabs / two channels never share a panel or its data. */
export class RemovedMessagesPanel {
  private section: HTMLElement | null = null;
  private collapsed = true; // starts closed; owner opens on demand — in-memory only (tab isolation)
  private lastSig = ''; // skip rebuilding the open body when its contents are unchanged
  private disposeDrag: (() => void) | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly store: ChatIntegrityStore,
  ) {
    this.render();
    lifecycle.setInterval(() => this.render(), 1000);
    lifecycle.add(() => this.dispose());
  }

  /** Cheap when collapsed (only the header count updates); rebuilds the body only when its
   * contents actually changed. Removes the panel entirely once nothing is preserved anymore. */
  render(): void {
    const removed = this.store.getPreserved()
      .filter((message) => message.preserved === true)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    if (removed.length === 0) {
      this.removeSection(); // same teardown as dispose() — never leak a mid-drag's document listeners
      return;
    }

    const section = this.ensureSection();
    section.classList.toggle(STRIP_COLLAPSED_CLASS, this.collapsed);
    const toggle = section.querySelector<HTMLElement>(`.${STRIP_TOGGLE_CLASS}`);
    if (toggle) toggle.textContent = `${this.collapsed ? '▸' : '▾'} kaldırılanlar (${removed.length})`;
    if (this.collapsed) return; // closed — leave the hidden body as-is

    const body = section.querySelector<HTMLElement>(`.${STRIP_BODY_CLASS}`);
    if (!body) return;
    const shown = removed.slice(-MAX_PANEL_ROWS);
    const sig = `${removed.length}:${shown[shown.length - 1]?.id ?? ''}`;
    if (sig === this.lastSig) return; // unchanged since last open render — don't churn/scroll-jump
    this.lastSig = sig;
    body.replaceChildren(...shown.map((message) => this.buildRow(message)));
  }

  private ensureSection(): HTMLElement {
    if (this.section?.isConnected) return this.section;

    const section = document.createElement('section');
    section.className = STRIP_CLASS;

    const header = document.createElement('div');
    header.className = STRIP_HEADER_CLASS;

    const grip = document.createElement('span');
    grip.className = STRIP_GRIP_CLASS;
    grip.textContent = '⠿';
    // Panel starts anchored bottom-right via CSS (right/bottom). The first drag switches it to
    // explicit left/top at its current on-screen position, then hands off to makeDraggable — no
    // visual jump, and the default corner anchor is cleanly disabled from then on.
    grip.addEventListener('mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = section.getBoundingClientRect();
      section.style.right = 'auto';
      section.style.bottom = 'auto';
      section.style.left = `${rect.left}px`;
      section.style.top = `${rect.top}px`;
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = STRIP_TOGGLE_CLASS;
    toggle.textContent = 'kaldırılanlar';
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });

    header.append(grip, toggle);

    const body = document.createElement('div');
    body.className = STRIP_BODY_CLASS;

    section.append(header, body);
    document.body.appendChild(section);
    this.section = section;
    this.disposeDrag?.();
    this.disposeDrag = makeDraggable(section, grip);
    return section;
  }

  /** Mirrors the row shape native-augment.ts uses for its inline ghost blocks: time + badges +
   * colored username + struck-through content + the preserved status label. */
  private buildRow(message: ChatMessage): HTMLElement {
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
    username.textContent = message.sender.displayName || message.sender.username;
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

  /** Tears the panel DOM down and stops any in-flight drag: dispatch `kickflow:dismiss` (cleans the
   * document mousemove/mouseup listeners makeDraggable added while dragging) and dispose the grip
   * handler. Shared by dispose() and the empty-state branch so neither can leak listeners. */
  private removeSection(): void {
    if (this.section) {
      this.section.dispatchEvent(new Event('kickflow:dismiss'));
      this.section.remove();
      this.section = null;
    }
    this.disposeDrag?.();
    this.disposeDrag = null;
  }

  private dispose(): void {
    this.removeSection();
  }
}
