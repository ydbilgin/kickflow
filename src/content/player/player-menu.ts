import { findPlayerWrapper } from '../shared/selectors';

/**
 * The one popup mechanism the player controls share: hosted inside the player (so it survives
 * fullscreen), positioned above its button from the button's live rect, and closed by every
 * event that can invalidate that position.
 *
 * Extracted from speed-controls.ts when the overflow menu needed the same behaviour; a second
 * copy would have been a second set of teardown bugs.
 */
export interface PlayerMenuOptions {
  /** Menu-specific class, added beside the shared `kickflow-player-menu` shell class. */
  className: string;
  /** Fills a freshly created, still-hidden menu. Runs on every open, so it always shows state. */
  fill: (menu: HTMLElement) => void;
  /** Element to focus when the menu opens (keyboard use, FINAL design 2026-10-18). */
  initialFocus?: (menu: HTMLElement) => HTMLElement | null;
}

const HOST_CHECK_INTERVAL_MS = 250;
const VIEWPORT_MARGIN_PX = 8;

export class PlayerMenu {
  private element: HTMLDivElement | null = null;
  private disposers: Array<() => void> = [];

  constructor(private readonly options: PlayerMenuOptions) {}

  get isOpen(): boolean {
    return this.element !== null;
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open(anchor);
  }

  /** No host (no player wrapper) means no menu: the popup never escapes to `document.body`,
   * where fullscreen would hide it. */
  open(anchor: HTMLElement): void {
    const host = document.fullscreenElement ?? findPlayerWrapper();
    if (!host) return;
    this.close();

    const menu = document.createElement('div');
    menu.className = `kickflow-player-menu ${this.options.className}`;
    menu.setAttribute('role', 'menu');
    menu.style.visibility = 'hidden';
    this.options.fill(menu);

    host.append(menu);
    this.element = menu;
    this.position(menu, anchor);
    this.bindClosers(menu, anchor);
    const focusTarget = this.options.initialFocus?.(menu);
    focusTarget?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.element) return;
    this.element.remove();
    this.element = null;
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private position(menu: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const left = clamp(
      anchorRect.left + anchorRect.width / 2 - menuWidth / 2,
      VIEWPORT_MARGIN_PX,
      window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX,
    );
    menu.style.left = `${Math.round(left)}px`;
    menu.style.bottom = `${Math.round(window.innerHeight - anchorRect.top + VIEWPORT_MARGIN_PX)}px`;
    menu.style.visibility = '';
  }

  private bindClosers(menu: HTMLElement, anchor: HTMLElement): void {
    this.listen(document, 'pointerdown', (event) => {
      const target = event.target;
      if (target instanceof Node) {
        if (menu.contains(target) || anchor.contains(target)) return;
        // A click in ANOTHER KickFlow menu is not "outside": the overflow menu hosts the real
        // speed button, so its own submenu must not count as dismissing its host.
        const element = target instanceof Element ? target : target.parentElement;
        if (element?.closest('.kickflow-player-menu')) return;
      }
      this.close();
    }, true);
    this.listen(document, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      // Esc from inside the menu hands focus back to the button that opened it, so a keyboard
      // user is never left on a removed node.
      const hadFocus = menu.contains(document.activeElement);
      this.close();
      if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    });
    // A resize or a fullscreen switch moves the anchor; a re-render disconnects it. The menu is
    // positioned from one reading of that rect, so every one of these invalidates it.
    this.listen(window, 'resize', () => this.close());
    this.listen(document, 'fullscreenchange', () => this.close());

    const timer = window.setInterval(() => {
      if (!anchor.isConnected) this.close();
    }, HOST_CHECK_INTERVAL_MS);
    this.disposers.push(() => window.clearInterval(timer));
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.disposers.push(() => target.removeEventListener(type, listener, options));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
