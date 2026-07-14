import type { Lifecycle } from '../shared/lifecycle';

const BUTTON_ID = 'kickflow-footer-toggle';
const SEND_BUTTON_ID = 'send-message-button';
const BUTTON_CLASS = 'kickflow-footer-toggle';
const ACTIVE_CLASS = 'kickflow-footer-toggle--active';
const BADGE_CLASS = 'kickflow-footer-toggle__badge';
const ENSURE_INTERVAL_MS = 1000;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** What removed-panel.ts's `RemovedMessagesPanel` exposes to this button — kept as its own
 * narrow interface so this file never needs to import the panel implementation. */
export interface FooterTogglePanel {
  toggle(section?: 'removed'): void;
  isOpen(): boolean;
  removedCount(): number;
}

/** Builds a small (~16px) slashed speech-bubble icon purely via `createElementNS` — no
 * innerHTML, no string-built markup. Stroke-based (fill:none, stroke:currentColor via CSS) so
 * it tints with `--active` the same way the player controls' SVG icons do. */
function buildIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');

  const bubble = document.createElementNS(SVG_NS, 'path');
  bubble.setAttribute('d', 'M4 5.5A2 2 0 0 1 6 3.5h12A2 2 0 0 1 20 5.5v8A2 2 0 0 1 18 15.5H9.5L5 19.5v-4H6A2 2 0 0 1 4 13.5z');
  svg.appendChild(bubble);

  const slash = document.createElementNS(SVG_NS, 'path');
  slash.setAttribute('d', 'M4.5 3.5l15 17');
  svg.appendChild(slash);

  return svg;
}

/** MoKick-style KickFlow toggle button injected into Kick's chat footer (anchored to
 * `#send-message-button`, the "Gönder" button) — opens/closes the shared `RemovedMessagesPanel`
 * and shows a small badge with its removed-message count. Kick's React footer re-renders
 * (typing, channel switch, layout changes) can tear our node out at any time; rather than fight
 * React with a body-wide MutationObserver, this self-heals on a cheap 1s interval — the exact
 * pattern NativeChatAugmenter already uses for its own re-attach loop. Per-session (rebuilt on
 * channel change via a fresh Lifecycle). */
export class FooterToggleButton {
  private button: HTMLButtonElement | null = null;
  private badge: HTMLSpanElement | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly panel: FooterTogglePanel,
  ) {
    this.ensureInjected();
    lifecycle.setInterval(() => this.ensureInjected(), ENSURE_INTERVAL_MS);
    lifecycle.add(() => this.dispose());
  }

  /** Idempotent: if our button is already in the DOM, just refreshes its active/badge state
   * (covers a flag/panel change happening elsewhere between ticks). If it's missing and Kick's
   * `#send-message-button` exists, (re)builds and inserts it right before the send button's
   * previous sibling — Kick's own chat-gear spot — so React tearing our node out (re-render) or
   * a channel switch remounting the whole footer both self-heal within one tick. */
  private ensureInjected(): void {
    const existing = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
    if (existing) {
      this.button = existing;
      this.refresh();
      return;
    }

    const send = document.getElementById(SEND_BUTTON_ID);
    if (!send || !send.parentElement) return;

    const button = this.build();
    send.parentElement.insertBefore(button, send.previousElementSibling ?? send);
    this.button = button;
    this.refresh();
  }

  private build(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = BUTTON_CLASS;
    button.title = 'KickFlow kaldırılan mesajlar';
    button.setAttribute('aria-label', 'KickFlow kaldırılan mesajları aç');
    button.appendChild(buildIcon());

    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.style.display = 'none';
    button.appendChild(badge);
    this.badge = badge;

    button.addEventListener('click', () => {
      this.panel.toggle('removed');
      this.refresh();
    });

    return button;
  }

  /** Reflects `panel.isOpen()` (the `--active` KickFlow-green tint) and `panel.removedCount()`
   * (the badge, hidden at 0) onto whatever button node currently exists — called right after
   * click and on every 1s tick, so it stays correct even when the panel is closed via its own
   * ×, or a message gets removed while the panel is shut. */
  private refresh(): void {
    const button = this.button;
    if (!button) return;
    button.classList.toggle(ACTIVE_CLASS, this.panel.isOpen());

    const badge = this.badge ?? button.querySelector<HTMLSpanElement>(`.${BADGE_CLASS}`);
    if (!badge) return;
    const count = this.panel.removedCount();
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = '';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  private dispose(): void {
    this.button?.remove();
    this.button = null;
    this.badge = null;
  }
}
