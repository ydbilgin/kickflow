import { logger } from '../shared/logger';
import { findControlBar, findLiveButton, findPlayerWrapper } from '../shared/selectors';
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

type MissingNativeBarAnchor = 'control-bar' | 'live-button';

/** A lifecycle owns one mount manager, rather than one pair of observers per control.
 * Map insertion order is the native-bar order: rewind, CANLI, speed, screenshot. */
const managers = new WeakMap<Lifecycle, NativeBarMountManager>();
const managerAliases = new WeakMap<Lifecycle, Lifecycle>();
const controlOwners = new WeakMap<HTMLElement, NativeBarMountManager>();

class NativeBarMountManager {
  private readonly controls = new Map<string, RegisteredControl>();
  /** Children of the BAR itself rather than of the button row. The seek bar is absolutely
   * positioned against the bar's own box, so it cannot live beside the buttons. Same manager,
   * same observers, same rebuild-survival — only the insertion point differs. */
  private readonly rootControls = new Map<string, RegisteredControl>();
  private readonly wrapperObserver = new MutationObserver(() => this.handleMutation());
  private readonly wrapperRebindObserver = new MutationObserver(() => this.handleMutation());
  // Kick's theatre-mode layout (fixed positioning + a calc(100vw - var(--chat-width)) bar
  // width, confirmed live 2026-07-15) is driven entirely by Tailwind's `group-data-[theatre=true]`
  // variant against a `[data-theatre]` ancestor: the bar's own class/style attributes never
  // change, only that ancestor's `data-theatre` value does. childList-only observation above
  // never sees this, so it needs its own attribute watch scoped to just that one attribute.
  private readonly theatreAttributeObserver = new MutationObserver(() => this.handleMutation());
  private observedWrapper: HTMLElement | null = null;
  private trailingEnsureTimer: number | null = null;
  private retryTimer: number | null = null;
  private retryAttempts = 0;
  private readonly warnedMissingAnchors = new Set<MissingNativeBarAnchor>();
  private disposed = false;

  constructor(private readonly lifecycle: Lifecycle) {
    this.rebindWrapper();
    this.wrapperRebindObserver.observe(document.body, { childList: true, subtree: true });
    this.theatreAttributeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theatre'],
      subtree: true,
    });
    lifecycle.addEventListener(document, 'fullscreenchange', () => this.handleMutation());
    lifecycle.add(() => this.dispose());
  }

  mount(ownerLifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
    return this.register(this.controls, ownerLifecycle, id, build);
  }

  mountRoot(ownerLifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
    return this.register(this.rootControls, ownerLifecycle, id, build);
  }

  private register(
    registry: Map<string, RegisteredControl>,
    ownerLifecycle: Lifecycle,
    id: string,
    build: () => HTMLElement,
  ): HTMLElement | null {
    let control = registry.get(id);
    if (!control) {
      control = { id, build, element: null };
      registry.set(id, control);
      ownerLifecycle.add(() => this.unmount(id));
    }

    this.ensureAll();
    return control.element?.isConnected ? control.element : null;
  }

  private unmount(id: string): void {
    const registry = this.controls.has(id) ? this.controls : this.rootControls;
    const control = registry.get(id);
    if (!control) return;
    control.element?.remove();
    if (control.element) controlOwners.delete(control.element);
    const existing = document.getElementById(id);
    if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
    registry.delete(id);
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
    for (const control of [...this.controls.values(), ...this.rootControls.values()]) {
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

  private scheduleRetry(missingAnchor?: MissingNativeBarAnchor): void {
    if (this.disposed || this.retryTimer !== null) return;
    if (this.retryAttempts >= RETRY_LIMIT) {
      if (missingAnchor) this.warnMissingAnchor(missingAnchor);
      return;
    }
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.retryAttempts++;
      this.rebindWrapper();
      this.ensureAll();
    }, RETRY_INTERVAL_MS);
  }

  private warnMissingAnchor(anchor: MissingNativeBarAnchor): void {
    if (this.warnedMissingAnchors.has(anchor)) return;
    this.warnedMissingAnchors.add(anchor);
    const check = anchor === 'control-bar'
      ? 'SELECTORS.controlBarBottom / SELECTORS.controlBar in src/content/shared/selectors.ts'
      : 'LIVE_EDGE_LABELS / GO_TO_LIVE_PHRASES in src/content/shared/selectors.ts';
    logger.warn(
      `native-bar: gave up after ${RETRY_LIMIT} attempts — ${check} did not match Kick's native player bar.`,
    );
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
    if (this.disposed || (this.controls.size === 0 && this.rootControls.size === 0)) return;

    this.rebindWrapper();
    this.ensureRootControls();

    if (this.controls.size === 0) return;
    const liveButton = findLiveButton();
    const parent = liveButton?.parentElement;
    if (!liveButton || !parent) {
      this.scheduleRetry(findControlBar() ? 'live-button' : 'control-bar');
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

  /** Bar-level children are order-independent (each is absolutely positioned against the bar),
   * so they only ever need to BE in the bar — never to sit at a particular index. */
  private ensureRootControls(): void {
    if (this.rootControls.size === 0) return;
    const bar = findControlBar();
    if (!bar) {
      this.scheduleRetry('control-bar');
      return;
    }
    for (const control of this.rootControls.values()) {
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
      if (element.parentElement !== bar) bar.append(element);
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wrapperObserver.disconnect();
    this.wrapperRebindObserver.disconnect();
    this.theatreAttributeObserver.disconnect();
    if (this.trailingEnsureTimer !== null) window.clearTimeout(this.trailingEnsureTimer);
    this.clearRetry();

    for (const control of [...this.controls.values(), ...this.rootControls.values()]) {
      control.element?.remove();
      if (control.element) controlOwners.delete(control.element);
      const existing = document.getElementById(control.id);
      if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
      control.element = null;
    }
    this.controls.clear();
    this.rootControls.clear();
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
  const mounted = managerFor(lifecycle).mount(lifecycle, id, build);
  if (!mounted) {
    logger.debug('native-bar: control bar/LIVE button not present yet for', id, '- retrying');
  }
  return mounted;
}

/**
 * Same manager and the same survival guarantees as `mountIntoControlBar`, but the element
 * becomes a direct child of the control BAR instead of the button row, and needs no LIVE-button
 * anchor. For chrome that is positioned against the bar's own box rather than sequenced among
 * the buttons — the seek bar, which Kick itself places at `-top-7` spanning the full width.
 */
export function mountIntoControlBarRoot(lifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
  if (lifecycle.isDisposed) return null;
  const mounted = managerFor(lifecycle).mountRoot(lifecycle, id, build);
  if (!mounted) {
    logger.debug('native-bar: control bar not present yet for', id, '- retrying');
  }
  return mounted;
}

function managerFor(lifecycle: Lifecycle): NativeBarMountManager {
  const managerLifecycle = managerAliases.get(lifecycle) ?? lifecycle;
  let manager = managers.get(managerLifecycle);
  if (!manager) {
    manager = new NativeBarMountManager(managerLifecycle);
    managers.set(managerLifecycle, manager);
  }
  return manager;
}

/** Lets independently disposable feature lifecycles share one ordered native-bar manager owned
 * by their player session. This preserves rewind → CANLI → speed → screenshot ordering while
 * still allowing any one feature to unmount live. */
export function shareNativeBarMountManager(lifecycle: Lifecycle, managerLifecycle: Lifecycle): void {
  if (lifecycle.isDisposed || managerLifecycle.isDisposed) return;
  managerAliases.set(lifecycle, managerLifecycle);
  lifecycle.add(() => managerAliases.delete(lifecycle));
}
