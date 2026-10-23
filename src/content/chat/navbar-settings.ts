import type { Lifecycle } from '../shared/lifecycle';
import { subscribeLang, t } from '../shared/i18n';
import { logger } from '../shared/logger';

const BUTTON_ID = 'kickflow-navbar-settings';
const BUTTON_CLASS = 'kickflow-navbar-settings';
const ACTIVE_CLASS = 'kickflow-navbar-settings--active';
const ENSURE_INTERVAL_MS = 1000;
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
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    lifecycle.add(() => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    });
    lifecycle.add(subscribeLang(() => this.refresh()));
    lifecycle.setInterval(() => this.ensureInjected(), ENSURE_INTERVAL_MS);
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
    const box = cluster.getBoundingClientRect();
    button.style.position = 'fixed';
    button.style.zIndex = '1000';
    button.style.left = `${Math.max(8, Math.min(innerWidth - 42, box.left))}px`;
    button.style.top = `${Math.max(8, box.top + (box.height - 34) / 2)}px`;
    button.style.display = box.width > 0 && box.height > 0 ? '' : 'none';
    this.refresh();
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
    if (!this.button) return;
    this.button.classList.toggle(ACTIVE_CLASS, this.panel.isOpen());
    this.button.title = t('entry.settings_title');
    this.button.setAttribute('aria-label', t('entry.settings_aria'));
  }

  private dispose(): void {
    if (!this.button) return;
    this.button.remove();
    this.button = null;
  }
}
