import type { Lifecycle } from '../shared/lifecycle';
import { subscribeLang, t } from '../shared/i18n';
import { logger } from '../shared/logger';

const BUTTON_ID = 'kickflow-navbar-settings';
const BUTTON_CLASS = 'kickflow-navbar-settings';
const ACTIVE_CLASS = 'kickflow-navbar-settings--active';
const ENSURE_INTERVAL_MS = 1000;
export const NAVBAR_RIGHT_CLUSTER_INDEX = 2;
export const NAVBAR_RIGHT_CLUSTER_CLASSES = ['flex', 'items-center', 'gap-2'] as const;

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

/** React-safe, interval-driven navbar injection. It owns one button only, retries quietly while
 * the shell is absent, and never observes the page body. Both it and the footer entry point call
 * the same body-level panel instance. */
export class NavbarSettingsButton {
  private button: HTMLButtonElement | null = null;
  private warnedMissingCluster = false;

  constructor(
    lifecycle: Lifecycle,
    private readonly panel: NavbarSettingsPanel,
  ) {
    this.ensureInjected();
    lifecycle.add(subscribeLang(() => this.refresh()));
    lifecycle.setInterval(() => this.ensureInjected(), ENSURE_INTERVAL_MS);
    lifecycle.add(() => this.dispose());
  }

  private ensureInjected(): void {
    const existing = document.getElementById(BUTTON_ID);
    if (existing instanceof HTMLButtonElement && existing.classList.contains(BUTTON_CLASS)) {
      const cluster = findNavbarRightCluster();
      if (cluster && (existing.parentElement !== cluster || cluster.firstElementChild !== existing)) {
        cluster.prepend(existing);
      }
      this.button = existing;
      this.refresh();
      return;
    }
    existing?.remove();

    const cluster = findNavbarRightCluster();
    if (!cluster) {
      const renderedNavbar = Array.from(document.querySelectorAll('nav'))
        .some((nav) => nav.children.length >= 3);
      if (renderedNavbar && !this.warnedMissingCluster) {
        this.warnedMissingCluster = true;
        logger.warn(
          'navbar-settings: Kick rendered a navbar, but findNavbarRightCluster could not match '
          + 'children[2] with classes "flex items-center gap-2". The KickFlow settings button is not mounted.',
        );
      }
      return;
    }
    const button = this.build();
    cluster.prepend(button);
    this.button = button;
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
    this.button?.remove();
    this.button = null;
  }
}
