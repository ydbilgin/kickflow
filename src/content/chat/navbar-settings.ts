import type { Lifecycle } from '../shared/lifecycle';

const BUTTON_ID = 'kickflow-navbar-settings';
const BUTTON_CLASS = 'kickflow-navbar-settings';
const ACTIVE_CLASS = 'kickflow-navbar-settings--active';
const ENSURE_INTERVAL_MS = 1000;

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
    const right = children[2];
    if (!(right instanceof HTMLDivElement)) continue;
    if (
      right.classList.contains('flex') &&
      right.classList.contains('items-center') &&
      right.classList.contains('gap-2')
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

  constructor(
    lifecycle: Lifecycle,
    private readonly panel: NavbarSettingsPanel,
  ) {
    this.ensureInjected();
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
    if (!cluster) return;
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
    button.title = 'KickFlow ayarları';
    button.setAttribute('aria-label', 'KickFlow ayarlarını aç');
    button.textContent = 'K';
    button.addEventListener('click', () => {
      this.panel.showSettings();
      this.refresh();
    });
    return button;
  }

  private refresh(): void {
    this.button?.classList.toggle(ACTIVE_CLASS, this.panel.isOpen());
  }

  private dispose(): void {
    this.button?.remove();
    this.button = null;
  }
}
