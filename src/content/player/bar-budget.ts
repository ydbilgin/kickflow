/**
 * The width budget for KickFlow's cluster inside Kick's native control bar.
 *
 * Kick's bar is one `flex justify-between` row whose buttons all carry `shrink-0 grow-0`, and
 * its nearest ancestor is `overflow-hidden`. So when our cluster asks for more room than the bar
 * has, Kick's own right-hand group is pushed past the bar and CLIPPED: theatre, fullscreen and
 * the settings cog stop being clickable at all. Measured 2026-09-05, that happened at every
 * viewport below roughly 1190px (docs/RULING_kick_ui_layout.md §3.1, §7.3).
 *
 * This module answers exactly one question — given the free space and what each control really
 * costs, which controls mount in the bar and which collapse into the overflow menu — and it
 * answers it from REAL rects. It never reads a width, padding or min-width constant that the
 * production stylesheet also owns, because a budget computed from the same constant the layout
 * uses would agree with itself while the screen was broken.
 */

export interface BudgetControl {
  id: string;
  /** Rendered width plus the flex gap the control occupies in its group. 0 = not measurable. */
  cost: number;
}

export interface BudgetPlan {
  /** Ids that stay in the bar, in bar order. */
  mounted: string[];
  /** Ids that move into the overflow menu, in bar order. */
  collapsed: string[];
  /** Whether the `⋯` button itself belongs in the bar. */
  overflow: boolean;
}

export interface BudgetInput {
  /** Pixels the bar can give KickFlow without moving anything Kick owns. */
  free: number;
  /** Cost of the `⋯` button, measured the same way as any other control. */
  overflowCost: number;
  /** Every registered control, in bar order. */
  controls: readonly BudgetControl[];
  /** Ids in the order they should be given up — first entry collapses first. */
  collapseOrder: readonly string[];
}

export interface BarMeasurement {
  free: number;
  /** Cost per control id, for every KickFlow control currently in the bar. */
  costs: Map<string, number>;
}

const NOTHING_MOUNTS: BudgetPlan = { mounted: [], collapsed: [], overflow: false };

/**
 * Pure arithmetic: no DOM, no constants of its own.
 *
 * A control whose cost is 0 was not measurable (a bar Kick has not laid out yet, or a test
 * environment without layout). Collapsing one would free nothing, so it is never chosen — we
 * only ever hide a control we can PROVE does not fit.
 */
export function planBarBudget(input: BudgetInput): BudgetPlan {
  const ids = input.controls.map((control) => control.id);
  const total = input.controls.reduce((sum, control) => sum + control.cost, 0);
  if (total <= input.free) return { mounted: ids, collapsed: [], overflow: false };
  // Not even the overflow button fits. KickFlow mounts nothing rather than displace Kick;
  // its actions stay on their hotkeys (hotkey-registry.ts).
  if (input.overflowCost > input.free) return { ...NOTHING_MOUNTS, collapsed: ids };

  const costs = new Map(input.controls.map((control) => [control.id, control.cost]));
  const budget = input.free - input.overflowCost;
  const collapsed = new Set<string>();
  let needed = total;

  // Named priority first, then anything the priority list does not mention, in bar order — a
  // control added later must never be able to keep a named one out of the bar.
  for (const id of [...input.collapseOrder, ...ids]) {
    if (needed <= budget) break;
    const cost = costs.get(id) ?? 0;
    if (cost <= 0 || collapsed.has(id)) continue;
    collapsed.add(id);
    needed -= cost;
  }

  return {
    mounted: ids.filter((id) => !collapsed.has(id)),
    collapsed: ids.filter((id) => collapsed.has(id)),
    overflow: true,
  };
}

/**
 * Reads the bar. `free = bar content width − everything in the bar KickFlow does not own`.
 *
 * Returns null when the bar has no measurable width — a bar Kick has not revealed yet, or an
 * environment with no layout engine. That is NOT evidence that our controls do not fit, so the
 * caller keeps them mounted rather than acting on a measurement it does not have.
 */
export function measureBarBudget(bar: HTMLElement, ours: readonly HTMLElement[]): BarMeasurement | null {
  const barStyle = getComputedStyle(bar);
  const content = bar.clientWidth - lengthOf(barStyle.paddingLeft) - lengthOf(barStyle.paddingRight);
  if (!(content > 0)) return null;

  let used = 0;
  let flowChildren = 0;
  for (const child of Array.from(bar.children)) {
    if (!(child instanceof HTMLElement) || !occupiesFlow(child)) continue;
    flowChildren += 1;
    used += child.getBoundingClientRect().width;
  }
  used += Math.max(0, flowChildren - 1) * lengthOf(barStyle.columnGap);

  // Our own controls are inside one of those children, so their width is already counted in it.
  // Taking it back out is what makes `free` the space we may occupy rather than the space left
  // over after we already took some.
  const costs = new Map<string, number>();
  for (const element of ours) {
    if (!element.id || !bar.contains(element) || !occupiesFlow(element)) continue;
    const cost = controlCost(element);
    costs.set(element.id, cost);
    used -= cost;
  }

  return { free: content - used, costs };
}

/** What one control really takes from the row: its rendered box plus the gap beside it. */
export function controlCost(element: HTMLElement): number {
  const parent = element.parentElement;
  const gap = parent ? lengthOf(getComputedStyle(parent).columnGap) : 0;
  return element.getBoundingClientRect().width + gap;
}

export function samePlan(left: BudgetPlan, right: BudgetPlan): boolean {
  return left.overflow === right.overflow
    && left.mounted.join() === right.mounted.join()
    && left.collapsed.join() === right.collapsed.join();
}

/** `normal`, `auto` and an empty string all mean "no length here". */
function lengthOf(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Absolutely positioned children (Kick's seek bar, ours) take no room in the row. */
function occupiesFlow(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
}
