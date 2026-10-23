import { logger } from '../shared/logger';
import { findControlBar, findControlBarInsertionAnchor, findPlayerWrapper } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';
import { type BudgetPlan, measureBarBudget, planBarBudget, samePlan } from './bar-budget';
import { type OverflowControl, createOverflowControl } from './overflow-menu';

const OBSERVER_DEBOUNCE_MS = 150;
const RETRY_INTERVAL_MS = 250;
const RETRY_LIMIT = 20;
/** Bar order (FINAL design 2026-10-18, player-bar.html): the plate holds 10 s back, 10 s forward,
 * speed, screenshot, and the behind-live chip LAST, so the chip appearing or leaving never moves
 * another control. */
const CONTROL_ORDER = [
  'kickflow-rewind-controls',
  'kickflow-speed-controls',
  'kickflow-screenshot-controls',
  'kickflow-catchup-controls',
] as const;
/** The order controls are given up in when the bar is too narrow — first entry collapses first.
 * Screenshot, forward/rewind and go-live all keep their hotkeys when collapsed
 * (hotkey-registry.ts); speed has none, which is why it outranks the rewind pair. CANLI is the
 * one control the owner watches live streams with, so it is the last to leave the bar. */
const COLLAPSE_PRIORITY = [
  'kickflow-screenshot-controls',
  'kickflow-speed-controls',
  'kickflow-rewind-controls',
  'kickflow-catchup-controls',
] as const;
const OVERFLOW_CONTROL_ID = 'kickflow-overflow-controls';
const CHIP_CONTROL_ID = 'kickflow-catchup-controls';
/** Applying a plan changes what is in the bar, which changes what the next measurement sees —
 * a control's cost is only knowable once it has been laid out. Two passes settle every case
 * (mount, then measure the ⋯ button, then give up one more control); the third is the stop. */
const BUDGET_PASS_LIMIT = 3;
const EMPTY_PLAN: BudgetPlan = { mounted: [], collapsed: [], overflow: false };

function controlPriority(id: string): number {
  const index = (CONTROL_ORDER as readonly string[]).indexOf(id);
  return index < 0 ? CONTROL_ORDER.length : index;
}

interface RegisteredControl {
  id: string;
  build: () => HTMLElement;
  element: HTMLElement | null;
}

type MissingNativeBarAnchor = 'control-bar' | 'insertion-anchor';

/** A lifecycle owns one mount manager, rather than one pair of observers per control.
 * Bar order comes from CONTROL_ORDER: rewind, speed, screenshot, behind-live chip. */
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
  /** The bar's width is what the budget is spent against, and it changes without any mutation
   * we can see (window resize, chat panel, theatre). Re-planning happens inside this callback,
   * which the browser runs BEFORE it paints, so no frame ever shows Kick's controls displaced.
   * Absent in jsdom, where there is no layout to observe either. */
  private readonly barResizeObserver: ResizeObserver | null =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.ensureAll()) : null;
  private observedBar: HTMLElement | null = null;
  private overflow: OverflowControl | null = null;
  private plan: BudgetPlan = EMPTY_PLAN;
  /** Last measured cost per control id, including the ⋯ button. A collapsed control is not in
   * the bar and cannot be measured, so its last real measurement is what decides whether it may
   * come back. */
  private readonly costs = new Map<string, number>();
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
    if (control.element) this.barResizeObserver?.unobserve(control.element);
    control.element?.remove();
    if (control.element) controlOwners.delete(control.element);
    const existing = document.getElementById(id);
    if (existing instanceof HTMLElement && controlOwners.get(existing) === this) existing.remove();
    registry.delete(id);
    this.costs.delete(id);
    this.plan = {
      ...this.plan,
      mounted: this.plan.mounted.filter((entry) => entry !== id),
      collapsed: this.plan.collapsed.filter((entry) => entry !== id),
    };
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

  /** A COLLAPSED control is absent from the document on purpose (its element lives in the
   * overflow menu, which exists only while the menu is open). Counting it as missing would make
   * every mutation re-mount it, and the re-mount would mutate the DOM again — a loop. */
  private hasMissingControl(): boolean {
    for (const control of [...this.controls.values(), ...this.rootControls.values()]) {
      if (this.plan.collapsed.includes(control.id)) continue;
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

  /**
   * "The control bar is not there" is NOT evidence that our selector rotted.
   *
   * Kick mounts the control bar lazily after pointer interaction. 2026-10-16.
   * The pointer must move over the player first. With no pointer interaction the
   * wrapper holds NO bar and none of our four controls; after hovering, the bar carries 13
   * buttons and all four mount correctly. The retry budget is 20 x 250 ms ~= 5 s, so a viewer
   * who has not touched the player yet exhausts it on every single page load — and the manager
   * then recovers on its own through the observer.
   *
   * A warning that fires on a healthy session for a feature that is about to work is worse than
   * no warning at all: it teaches the reader to ignore the channel this whole mechanism exists to
   * keep credible. So warn only for the case that really is anchor rot — a bar-shaped element IS
   * in the player wrapper and `findControlBar()` still could not match it.
   */
  private controlBarLooksRotted(): boolean {
    const wrapper = findPlayerWrapper();
    if (!wrapper || findControlBar()) return false;
    return Array.from(wrapper.querySelectorAll('div')).some((element) => element.querySelector('button'));
  }

  private warnMissingAnchor(anchor: MissingNativeBarAnchor): void {
    if (anchor === 'control-bar' && !this.controlBarLooksRotted()) return;
    if (this.warnedMissingAnchors.has(anchor)) return;
    this.warnedMissingAnchors.add(anchor);
    const check = anchor === 'control-bar'
      ? 'SELECTORS.controlBarBottom / SELECTORS.controlBar in src/content/shared/selectors.ts'
      : 'LIVE_EDGE_LABELS / GO_TO_LIVE_PHRASES / findControlBarInsertionAnchor in src/content/shared/selectors.ts';
    // Optional controls recover on later native mutations. A bounded mount miss requires
    // no viewer action and must not become a persistent chrome://extensions error entry.
    logger.debug(
      `native-bar: waiting for native controls after ${RETRY_LIMIT} attempts — ${check}.`,
    );
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryAttempts = 0;
  }

  /** Restores every registered group after the native insertion anchor in registry order, within the width
   * the bar actually has. Cached elements are moved back into the new bar, preserving listeners
   * and dynamic button state.
   *
   * The budget runs in the SAME synchronous task as the mounting, so a control that turns out
   * not to fit is taken back out before the browser paints — Kick's own controls are never seen
   * displaced, not even for one frame. */
  private ensureAll(): void {
    if (this.disposed || (this.controls.size === 0 && this.rootControls.size === 0)) return;

    this.rebindWrapper();
    this.ensureRootControls();

    if (this.controls.size === 0) return;
    const insertionAnchor = findControlBarInsertionAnchor();
    const parent = insertionAnchor?.parentElement;
    if (!insertionAnchor || !parent) {
      this.scheduleRetry(findControlBar() ? 'insertion-anchor' : 'control-bar');
      return;
    }
    this.observeBar();

    let plan = this.computePlan();
    for (let pass = 0; pass < BUDGET_PASS_LIMIT; pass++) {
      if (!this.applyPlan(plan, insertionAnchor, parent)) {
        this.scheduleRetry();
        return;
      }
      const remeasured = this.computePlan();
      if (samePlan(plan, remeasured)) break;
      plan = remeasured;
    }

    this.clearRetry();
  }

  private orderedControlIds(): string[] {
    return Array.from(this.controls.values())
      .sort((left, right) => controlPriority(left.id) - controlPriority(right.id))
      .map((control) => control.id);
  }

  /** Measures the bar and decides who is in it. An unmeasurable bar yields the pre-budget
   * behaviour — everything mounts — because "we could not measure" is not evidence that a
   * control does not fit, and hiding one on no evidence is the failure this file exists to
   * prevent. */
  private computePlan(): BudgetPlan {
    const ids = this.orderedControlIds();
    const bar = findControlBar();
    if (!bar) return { mounted: ids, collapsed: [], overflow: false };

    const inBar: HTMLElement[] = [];
    for (const control of this.controls.values()) {
      if (control.element?.isConnected) inBar.push(control.element);
    }
    if (this.overflow?.element.isConnected) inBar.push(this.overflow.element);

    const measurement = measureBarBudget(bar, inBar);
    if (!measurement) {
      logger.debug('native-bar: control bar has no measurable width, skipping the width budget');
      return { mounted: ids, collapsed: [], overflow: false };
    }
    for (const [id, cost] of measurement.costs) this.costs.set(id, cost);

    return planBarBudget({
      free: measurement.free,
      overflowCost: this.costs.get(OVERFLOW_CONTROL_ID) ?? 0,
      controls: ids.map((id) => ({ id, cost: this.costs.get(id) ?? 0 })),
      collapseOrder: COLLAPSE_PRIORITY,
    });
  }

  /** False means another manager owns one of our ids and the caller must retry. */
  private applyPlan(plan: BudgetPlan, insertionAnchor: HTMLElement, parent: HTMLElement): boolean {
    for (const id of plan.collapsed) {
      const element = this.controls.get(id)?.element;
      // Only ever out of the BAR: while the menu is open the same node is a row in it.
      if (element && element.parentElement === parent) element.remove();
    }

    let anchor: HTMLElement = insertionAnchor;
    let overflowPlaced = false;
    const placeOverflow = (): void => {
      overflowPlaced = true;
      const element = this.ensureOverflowControl().element;
      if (element.parentElement !== parent || anchor.nextElementSibling !== element) {
        anchor.after(element);
      }
      anchor = element;
    };
    for (const id of plan.mounted) {
      const control = this.controls.get(id);
      if (!control) continue;
      // The ⋯ button belongs to the plate; the behind-live chip stays the plate's last item, so
      // the chip appearing never splits the plate (FINAL design 2026-10-18).
      if (plan.overflow && !overflowPlaced && id === CHIP_CONTROL_ID) placeOverflow();
      const existing = document.getElementById(control.id);
      if (existing instanceof HTMLElement && existing !== control.element) {
        if (controlOwners.get(existing) && controlOwners.get(existing) !== this) return false;
        existing.remove();
      }

      let element = control.element;
      if (!element) {
        element = control.build();
        element.id = control.id;
        control.element = element;
        controlOwners.set(element, this);
        // The behind-live chip changes its own width (0 at the live edge); a bar-size watch
        // cannot see that, so its size is watched too and the budget re-plans before paint.
        if (control.id === CHIP_CONTROL_ID) this.barResizeObserver?.observe(element);
      }

      if (element.parentElement !== parent || anchor.nextElementSibling !== element) {
        anchor.after(element);
      }
      anchor = element;
    }

    if (plan.overflow) {
      if (!overflowPlaced) placeOverflow();
    } else if (this.overflow) {
      this.overflow.detach();
    }

    // Rows built for the previous plan are stale the moment the collapsed set changes.
    if (plan.collapsed.join() !== this.plan.collapsed.join()) this.overflow?.close();
    this.plan = plan;
    return true;
  }

  private ensureOverflowControl(): OverflowControl {
    if (!this.overflow) {
      const overflow = createOverflowControl(this.lifecycle, () => this.collapsedElements());
      overflow.element.id = OVERFLOW_CONTROL_ID;
      controlOwners.set(overflow.element, this);
      this.overflow = overflow;
    }
    return this.overflow;
  }

  private collapsedElements(): HTMLElement[] {
    return this.plan.collapsed
      .map((id) => this.controls.get(id)?.element)
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
  }

  private observeBar(): void {
    const bar = findControlBar();
    if (!this.barResizeObserver || bar === this.observedBar) return;
    if (this.observedBar) this.barResizeObserver.unobserve(this.observedBar);
    // (The chip's own observation, added in applyPlan, is independent of the bar's.)
    this.observedBar = bar;
    if (bar) this.barResizeObserver.observe(bar);
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
    this.barResizeObserver?.disconnect();
    this.observedBar = null;
    this.overflow?.detach();
    this.overflow = null;
    this.plan = EMPTY_PLAN;
    this.costs.clear();
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
 * Kick's LIVE button, or the native transport/time group on recorded players. All calls made
 * for one Lifecycle share one persistent manager, which
 * keeps the public API stable while surviving React bar replacement without an overlay.
 *
 * A missed native insertion anchor is retried for five seconds in lifecycle-bound 250ms intervals; later
 * native mutations begin a fresh retry window. The mounted element is cached per id and moved
 * into rebuilt bars, so native-bar remounts preserve listeners and dynamic UI state.
 *
 * The bar's width is a hard budget (bar-budget.ts): if the whole cluster does not fit, the
 * lowest-priority controls move into the `⋯` overflow menu instead — as the SAME element, so a
 * collapsed control keeps its listeners and its state. Returning null therefore means "not in
 * the bar right now", never "gone".
 */
export function mountIntoControlBar(lifecycle: Lifecycle, id: string, build: () => HTMLElement): HTMLElement | null {
  if (lifecycle.isDisposed) return null;
  const mounted = managerFor(lifecycle).mount(lifecycle, id, build);
  if (!mounted) {
    // Two different, both normal, states: the bar/native anchor is not up yet (the manager keeps
    // retrying), or the bar is too narrow for this control and it lives in the overflow menu.
    logger.debug('native-bar:', id, 'is not in the bar - anchor not ready, or collapsed by the width budget');
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
