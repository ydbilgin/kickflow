import { logger } from '../shared/logger';
import { findLiveButton, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

const OBSERVER_DEBOUNCE_MS = 150;
const RETRY_INTERVAL_MS = 250;
const RETRY_LIMIT = 20;
const CONTROL_ORDER = [
  'kickflow-rewind-controls',
  'kickflow-catchup-controls',
  'kickflow-speed-controls',
  'kickflow-screenshot-controls',
] as const;

function controlPriority(id: string): number {
  const index = (CONTROL_ORDER as readonly string[]).indexOf(id);
  return index < 0 ? CONTROL_ORDER.length : index;
}

interface RegisteredControl {
  id: string;
  build: () => HTMLElement;
  element: HTMLElement | null;
}

/** A lifecycle owns one mount manager, rather than one pair of observers per control.
 * Map insertion order is the native-bar order: rewind, CANLI, speed, screenshot. */
const managers = new WeakMap<Lifecycle, NativeBarMountManager>();
const managerAliases = new WeakMap<Lifecycle, Lifecycle>();
const controlOwners = new WeakMap<HTMLElement, NativeBarMountManager>();

class NativeBarMountManager {
  private readonly controls = new Map<string, RegisteredControl>();
  private readonly wrapperObserver = new MutationObserver(() => this.handleMutation());
  private readonly wrapperRebindObserver = new MutationObserver(() => this.handleMutation());
  private observedWrapper: HTMLElement | null = null;
  private trailingEnsureTimer: number | null = null;
  private retryTimer: number | null = null;
  private retryAttempts = 0;
  private disposed = false;

  constructor(private readonly lifecycle: Lifecycle) {
    this.rebindWrapper();
    this.wrapperRebindObserver.observe(document.body, { childList: true, subtree: true });
    lifecycle.add(() => this.dispose());
  }

  mount(ownerLifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
    let control = this.controls.get(id);
    if (!control) {
      control = { id, build, element: null };
      this.controls.set(id, control);
      ownerLifecycle.add(() => this.unmount(id));
    }

    this.ensureAll();
    return control.element?.isConnected ? control.element : null;
  }

  private unmount(id: string): void {
    const control = this.controls.get(id);
    if (!control) return;
    control.element?.remove();
    if (control.element) controlOwners.delete(control.element);
    const existing = document.getElementById(id);
    if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
    this.controls.delete(id);
    this.ensureAll();
  }

  private rebindWrapper(): void {
    const currentWrapper = findPlayerWrapper();
    if (currentWrapper === this.observedWrapper) return;

    this.wrapperObserver.disconnect();
    this.observedWrapper = currentWrapper;
    if (currentWrapper) {
      this.wrapperObserver.observe(currentWrapper, { childList: true, subtree: true });
    }
  }

  /** A fast leading check keeps a continuous React mutation stream from starving remounts.
   * The trailing pass still catches a settled bar whose controls were merely reordered. */
  private handleMutation(): void {
    if (this.disposed) return;
    this.rebindWrapper();

    if (this.retryAttempts >= RETRY_LIMIT) this.retryAttempts = 0;

    if (this.hasMissingControl()) {
      this.ensureAll();
    }
    this.scheduleTrailingEnsure();
  }

  private hasMissingControl(): boolean {
    const orderedControls = Array.from(this.controls.values())
      .sort((left, right) => controlPriority(left.id) - controlPriority(right.id));
    for (const control of orderedControls) {
      if (!(document.getElementById(control.id) instanceof HTMLElement)) return true;
    }
    return false;
  }

  private scheduleTrailingEnsure(): void {
    if (this.trailingEnsureTimer !== null) window.clearTimeout(this.trailingEnsureTimer);
    this.trailingEnsureTimer = window.setTimeout(() => {
      this.trailingEnsureTimer = null;
      this.ensureAll();
    }, OBSERVER_DEBOUNCE_MS);
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== null || this.retryAttempts >= RETRY_LIMIT) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.retryAttempts++;
      this.rebindWrapper();
      this.ensureAll();
    }, RETRY_INTERVAL_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryAttempts = 0;
  }

  /** Restores every registered group after the LIVE button in registry order. Cached elements
   * are moved back into the new bar, preserving listeners and dynamic button state. */
  private ensureAll(): void {
    if (this.disposed || this.controls.size === 0) return;

    this.rebindWrapper();
    const liveButton = findLiveButton();
    const parent = liveButton?.parentElement;
    if (!liveButton || !parent) {
      this.scheduleRetry();
      return;
    }

    let anchor: HTMLElement = liveButton;
    const orderedControls = Array.from(this.controls.values())
      .sort((left, right) => controlPriority(left.id) - controlPriority(right.id));
    for (const control of orderedControls) {
      const existing = document.getElementById(control.id);
      if (existing instanceof HTMLElement && existing !== control.element) {
        if (controlOwners.get(existing) && controlOwners.get(existing) !== this) {
          this.scheduleRetry();
          return;
        }
        existing.remove();
      }

      let element = control.element;
      if (!element) {
        element = control.build();
        element.id = control.id;
        control.element = element;
        controlOwners.set(element, this);
      }

      if (element.parentElement !== parent || anchor.nextElementSibling !== element) {
        anchor.after(element);
      }
      anchor = element;
    }

    this.clearRetry();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wrapperObserver.disconnect();
    this.wrapperRebindObserver.disconnect();
    if (this.trailingEnsureTimer !== null) window.clearTimeout(this.trailingEnsureTimer);
    this.clearRetry();

    for (const control of this.controls.values()) {
      control.element?.remove();
      if (control.element) controlOwners.delete(control.element);
      const existing = document.getElementById(control.id);
      if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
      control.element = null;
    }
    this.controls.clear();
    managers.delete(this.lifecycle);
  }
}

/**
 * Idempotently mounts `build()`'s element into Kick's native control bar immediately after
 * Kick's LIVE button. All calls made for one Lifecycle share one persistent manager, which
 * keeps the public API stable while surviving React bar replacement without an overlay.
 *
 * A missed LIVE anchor is retried for five seconds in lifecycle-bound 250ms intervals; later
 * native mutations begin a fresh retry window. The mounted element is cached per id and moved
 * into rebuilt bars, so native-bar remounts preserve listeners and dynamic UI state.
 */
export function mountIntoControlBar(lifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
  if (lifecycle.isDisposed) return null;

  const managerLifecycle = managerAliases.get(lifecycle) ?? lifecycle;
  let manager = managers.get(managerLifecycle);
  if (!manager) {
    manager = new NativeBarMountManager(managerLifecycle);
    managers.set(managerLifecycle, manager);
  }

  const mounted = manager.mount(lifecycle, id, build);
  if (!mounted) {
    logger.debug('native-bar: control bar/LIVE button not present yet for', id, '- retrying');
  }
  return mounted;
}

/** Lets independently disposable feature lifecycles share one ordered native-bar manager owned
 * by their player session. This preserves rewind → CANLI → speed → screenshot ordering while
 * still allowing any one feature to unmount live. */
export function shareNativeBarMountManager(lifecycle: Lifecycle, managerLifecycle: Lifecycle): void {
  if (lifecycle.isDisposed || managerLifecycle.isDisposed) return;
  managerAliases.set(lifecycle, managerLifecycle);
  lifecycle.add(() => managerAliases.delete(lifecycle));
}
