import { isInsideChatScroller, visibleInterval } from '../shared/coalesce';
import type { Lifecycle } from '../shared/lifecycle';
import { subscribeLang, t } from '../shared/i18n';
import { px, setStyleIfChanged } from '../shared/style-write';

const BUTTON_ID = 'kickflow-footer-toggle';
const SEND_BUTTON_ID = 'send-message-button';
const BUTTON_CLASS = 'kickflow-footer-toggle';
const ACTIVE_CLASS = 'kickflow-footer-toggle--active';
const BADGE_CLASS = 'kickflow-footer-toggle__badge';
const ENSURE_INTERVAL_MS = 1000;
/** On <html> while our button is a direct child of <body>; the stylesheet's footer slot keys on
 * it. It replaces `body:has(> .kickflow-footer-toggle)`, which made every chat row inserted
 * anywhere restyle the whole page (~150 ms per row on a busy channel, 2026-11-09). */
export const FOOTER_ENTRY_ATTRIBUTE = 'data-kickflow-footer-entry';
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

/** Body-level control aligned with the native send cluster. CSS reserves its old inline slot
 * without adding a child to the SSR footer: inserting before a native button causes React #418.
 * Reconcile the anchor on the bounded interval and viewport changes, including native remounts. */
export class FooterToggleButton {
  private button: HTMLButtonElement | null = null;
  private badge: HTMLSpanElement | null = null;

  constructor(
    lifecycle: Lifecycle,
    private readonly panel: FooterTogglePanel,
  ) {
    this.ensureInjected();
    const reposition = (): void => this.ensureInjected();
    // Capture-phase scroll also reports every scroll inside the chat lists (each new row on a busy
    // channel). Those scrollers move nothing this fixed button is aligned to; measuring here forced
    // a style and layout pass per row batch (2026-11-09 profile: ~4% of the page's main thread).
    const repositionOnScroll = (event: Event): void => {
      if (isInsideChatScroller(event.target)) return;
      this.ensureInjected();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', repositionOnScroll, true);
    lifecycle.add(() => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', repositionOnScroll, true);
    });
    lifecycle.add(subscribeLang(() => this.refresh()));
    visibleInterval(lifecycle, () => this.ensureInjected(), ENSURE_INTERVAL_MS);
    lifecycle.add(() => this.dispose());
  }

  /** Reconcile against the current send button, not merely the old toggle's ID.
   * A native remount can leave our connected button behind in an obsolete footer. */
  private ensureInjected(): void {
    const send = document.getElementById(SEND_BUTTON_ID);
    if (!send || !send.parentElement) {
      this.dispose();
      return;
    }
    const existing = document.getElementById(BUTTON_ID);
    if (existing && (!(existing instanceof HTMLButtonElement)
      || !existing.classList.contains(BUTTON_CLASS))) return;

    const button = existing ?? this.build();
    if (button.parentElement !== document.body) document.body.append(button);
    if (!document.documentElement.hasAttribute(FOOTER_ENTRY_ATTRIBUTE)) document.documentElement.setAttribute(FOOTER_ENTRY_ATTRIBUTE, '');
    const box = send.parentElement.getBoundingClientRect();
    // This runs every second and on resize/scroll. Assigning an unchanged inline style or
    // attribute still queues a mutation record on <body>, which wakes every page-wide observer;
    // the 2026-11-11 soak counted ~2.3 such records per second from this button.
    setStyleIfChanged(button, 'position', 'fixed');
    setStyleIfChanged(button, 'zIndex', '403');
    setStyleIfChanged(button, 'left', px(box.left));
    setStyleIfChanged(button, 'top', px(box.top + (box.height - 30) / 2));
    setStyleIfChanged(button, 'display', box.width > 0 && box.height > 0 && !send.closest('[hidden]') ? '' : 'none');
    this.button = button;
    this.badge = button.querySelector<HTMLSpanElement>(`.${BADGE_CLASS}`);
    this.refresh();
  }

  private build(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = BUTTON_CLASS;
    button.title = t('entry.footer_title');
    button.setAttribute('aria-label', t('entry.footer_aria'));
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
    const title = t('entry.footer_title');
    if (button.title !== title) button.title = title;
    const aria = t('entry.footer_aria');
    if (button.getAttribute('aria-label') !== aria) button.setAttribute('aria-label', aria);
    const open = this.panel.isOpen();
    if (button.classList.contains(ACTIVE_CLASS) !== open) button.classList.toggle(ACTIVE_CLASS, open);

    const badge = this.badge ?? button.querySelector<HTMLSpanElement>(`.${BADGE_CLASS}`);
    if (!badge) return;
    const count = this.panel.removedCount();
    const text = count > 0 ? String(count) : '';
    if (badge.textContent !== text) badge.textContent = text;
    setStyleIfChanged(badge, 'display', count > 0 ? '' : 'none');
  }

  private dispose(): void {
    this.button?.remove();
    this.button = null;
    this.badge = null;
    if (!document.querySelector(`body > .${BUTTON_CLASS}`)) document.documentElement.removeAttribute(FOOTER_ENTRY_ATTRIBUTE);
  }
}
