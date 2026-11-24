import { isInsideChatScroller, visibleInterval } from '../shared/coalesce';
import type { Lifecycle } from '../shared/lifecycle';
import { subscribeLang, t } from '../shared/i18n';
import { logger } from '../shared/logger';
import { px, setStyleIfChanged } from '../shared/style-write';

const BUTTON_ID = 'kickflow-navbar-settings';
const BUTTON_CLASS = 'kickflow-navbar-settings';
const ACTIVE_CLASS = 'kickflow-navbar-settings--active';
const ENSURE_INTERVAL_MS = 1000;
/** On <html> while our button is a direct child of <body>; the stylesheet's navbar slot keys on
 * it. It replaces `body:has(> .kickflow-navbar-settings)`, which made every chat row inserted
 * anywhere restyle the whole page (~150 ms per row on a busy channel, 2026-11-09). */
export const NAVBAR_ENTRY_ATTRIBUTE = 'data-kickflow-navbar-entry';
export const NAVBAR_RIGHT_CLUSTER_INDEX = 2;
export const NAVBAR_RIGHT_CLUSTER_CLASSES = ['flex', 'items-center', 'gap-2'] as const;
// Native navbar height utilities captured 2026-10-13 (repair-evidence live/VOD shells),
// plus the previously captured desktop spelling. An arbitrary page <nav> is not the shell.
const NAVBAR_HEIGHT_CLASSES = ['h-(--navbar-height)', 'h-[var(--navbar-height)]', 'h-[--navbar-height]'] as const;

export interface NavbarSettingsPanel {
  showSettings(): void;
  isOpen(): boolean;
}

/** Finds the captured 2026-07-13 Kick navbar structurally: three direct div clusters, with the
 * third being the native `flex items-center gap-2` gift/KICKs/avatar cluster. No displayed text
 * or locale-specific attribute participates in anchoring. */
export function findNavbarRightCluster(): HTMLDivElement | null {
  for (const nav of document.querySelectorAll('nav')) {
    const children = Array.from(nav.children);
    if (children.length < 3 || !children.slice(0, 3).every((child) => child instanceof HTMLDivElement)) continue;
    const right = children[NAVBAR_RIGHT_CLUSTER_INDEX];
    if (!(right instanceof HTMLDivElement)) continue;
    if (
      NAVBAR_RIGHT_CLUSTER_CLASSES.every((className) => right.classList.contains(className))
    ) {
      return right;
    }
  }
  return null;
}

/** Keep the control outside React's SSR child sequence, aligned before the native cluster.
 * Both this entry point and the footer open the same body-level panel. */
export class NavbarSettingsButton {
  private button: HTMLButtonElement | null = null;
  private warnedMissingCluster = false;

  constructor(
    lifecycle: Lifecycle,
    private readonly panel: NavbarSettingsPanel,
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

  private ensureInjected(): void {
    const cluster = findNavbarRightCluster();
    if (!cluster) {
      this.dispose();
      const renderedNavbar = Array.from(document.querySelectorAll('nav'))
        .some((nav) => nav.children.length >= 3
          && NAVBAR_HEIGHT_CLASSES.some((className) => nav.classList.contains(className)));
      if (renderedNavbar && !this.warnedMissingCluster) {
        this.warnedMissingCluster = true;
        logger.warn(
          'navbar-settings: Kick rendered a navbar, but findNavbarRightCluster could not match '
          + 'children[2] with classes "flex items-center gap-2". Check NAVBAR_RIGHT_CLUSTER_INDEX / '
          + 'NAVBAR_RIGHT_CLUSTER_CLASSES in src/content/chat/navbar-settings.ts; the KickFlow settings button is not mounted.',
        );
      }
      return;
    }
    const existing = document.getElementById(BUTTON_ID);
    if (existing instanceof HTMLButtonElement && existing.classList.contains(BUTTON_CLASS)) {
      this.button = existing;
    } else {
      if (existing) return;
      this.button = this.build();
    }
    const button = this.button;
    const mounted = button.parentElement !== document.body;
    if (mounted) document.body.append(button);
    if (!document.documentElement.hasAttribute(NAVBAR_ENTRY_ATTRIBUTE)) document.documentElement.setAttribute(NAVBAR_ENTRY_ATTRIBUTE, '');
    const box = cluster.getBoundingClientRect();
    // Runs every second: an unchanged inline style still queues a mutation record on <body> and
    // wakes every page-wide observer (2026-11-11 soak: ~3.4 records/s from this button).
    setStyleIfChanged(button, 'position', 'fixed');
    setStyleIfChanged(button, 'zIndex', '1000');
    setStyleIfChanged(button, 'left', px(Math.max(8, Math.min(innerWidth - 42, box.left))));
    setStyleIfChanged(button, 'top', px(Math.max(8, box.top + (box.height - 34) / 2)));
    setStyleIfChanged(button, 'display', box.width > 0 && box.height > 0 ? '' : 'none');
    this.refresh();
    if (mounted) window.dispatchEvent(new Event('kickflow:navbar-entrychange'));
  }

  private build(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = BUTTON_CLASS;
    button.title = t('entry.settings_title');
    button.setAttribute('aria-label', t('entry.settings_aria'));
    button.textContent = 'K';
    button.addEventListener('click', () => {
      this.panel.showSettings();
      this.refresh();
    });
    return button;
  }

  private refresh(): void {
    const button = this.button;
    if (!button) return;
    const open = this.panel.isOpen();
    if (button.classList.contains(ACTIVE_CLASS) !== open) button.classList.toggle(ACTIVE_CLASS, open);
    // A host page script may claim this button with data-kickflow-claimed and set
    // its own label. Writing ours back each second made the two scripts trade the title and
    // aria-label twice a second: ~3.5 mutation records/s on <body> in the 2026-11-11 soak.
    if (button.dataset.kickflowClaimed === 'true') return;
    const title = t('entry.settings_title');
    if (button.title !== title) button.title = title;
    const aria = t('entry.settings_aria');
    if (button.getAttribute('aria-label') !== aria) button.setAttribute('aria-label', aria);
  }

  private dispose(): void {
    if (!this.button) return;
    this.button.remove();
    this.button = null;
    if (!document.querySelector(`body > .${BUTTON_CLASS}`)) document.documentElement.removeAttribute(NAVBAR_ENTRY_ATTRIBUTE);
    window.dispatchEvent(new Event('kickflow:navbar-entrychange'));
  }
}
