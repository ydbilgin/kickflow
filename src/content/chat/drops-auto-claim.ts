import { featureFlags } from './feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import { logger } from '../shared/logger';

export const DROPS_PANEL_SELECTOR = '#drops-panel';
export const CHANNEL_POINTS_PANEL_SELECTOR = '#rewards-panel';
const COMPLETE_PROGRESSBAR_SELECTOR = '[role="progressbar"][data-state="complete"]';
const ANY_PROGRESSBAR_SELECTOR = '[role="progressbar"]';
const OBSERVED_ATTRIBUTE_NAMES = ['data-state', 'disabled', 'id'];
const OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  attributeFilter: OBSERVED_ATTRIBUTE_NAMES,
  childList: true,
  subtree: true,
};

function findDropsPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DROPS_PANEL_SELECTOR);
}

function isInsideChannelPointsPanel(element: Element): boolean {
  return element.closest(CHANNEL_POINTS_PANEL_SELECTOR) !== null;
}

/** Finds the reward card that OWNS this progressbar without depending on a tag name. Kick's bundle
 * defines the card as a styled component, so its rendered element (`li`, `div`, …) is not something
 * we can assert; the round-78 recon confirmed the progressbar and the button but not the wrapper's
 * tag. So the card is derived structurally: climb from the progressbar until an ancestor holds a
 * button, and stop at the first ancestor that holds a SECOND progressbar — that one already spans
 * two cards, and claiming from it would attribute a neighbour's button to this reward. */
function findRewardCard(progressbar: Element, dropsPanel: HTMLElement): HTMLElement | null {
  if (isInsideChannelPointsPanel(progressbar)) return null;
  if (!dropsPanel.contains(progressbar)) return null;

  let node = progressbar.parentElement;
  while (node && node !== dropsPanel && dropsPanel.contains(node)) {
    if (node.querySelectorAll(ANY_PROGRESSBAR_SELECTOR).length > 1) return null;
    if (node.querySelector('button')) return node;
    node = node.parentElement;
  }
  return null;
}

function findEnabledClaimButton(card: HTMLElement): HTMLButtonElement | null {
  const button = card.querySelector<HTMLButtonElement>('button');
  if (!button || isInsideChannelPointsPanel(button) || button.disabled) return null;
  return button;
}

function findClaimTargets(dropsPanel: HTMLElement): HTMLButtonElement[] {
  const targets = new Set<HTMLButtonElement>();
  for (const progressbar of dropsPanel.querySelectorAll<HTMLElement>(COMPLETE_PROGRESSBAR_SELECTOR)) {
    const card = findRewardCard(progressbar, dropsPanel);
    const button = card ? findEnabledClaimButton(card) : null;
    if (button) targets.add(button);
  }
  return [...targets];
}

function nodeContainsElement(node: Node, element: Element): boolean {
  if (node === element) return true;
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return false;
  return (node as ParentNode).contains(element);
}

/**
 * The body-level observer is required because Kick portals the Drops panel after page load and
 * can replace that portal during a channel session. It is event-driven rather than a poll, and
 * unrelated document mutations are discarded before the scoped Drops scan. Lifecycle owns the
 * single observer, so disabling the flag or ending the session disconnects it completely.
 */
export class DropsAutoClaimController {
  private observer: MutationObserver | null = null;
  private readonly clickedButtons = new WeakSet<HTMLButtonElement>();

  constructor(private readonly lifecycle: Lifecycle) {
    lifecycle.add(() => this.stopObserving());
    if (featureFlags.autoClaimDrops) this.startObserving();
  }

  syncFlag(): void {
    if (featureFlags.autoClaimDrops) {
      this.startObserving();
    } else {
      this.stopObserving();
    }
  }

  private startObserving(): void {
    if (this.observer || this.lifecycle.isDisposed || !featureFlags.autoClaimDrops) return;

    const observationRoot = document.body ?? document.documentElement;
    if (!observationRoot) return;

    const observer = new MutationObserver((records) => this.handleMutations(records));
    observer.observe(observationRoot, OBSERVER_OPTIONS);
    this.observer = observer;
    this.claimAvailableRewards();
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private handleMutations(records: MutationRecord[]): void {
    if (this.lifecycle.isDisposed || !featureFlags.autoClaimDrops) return;

    const dropsPanel = findDropsPanel();
    if (!dropsPanel) return;

    const affectsDrops = records.some((record) => {
      if (dropsPanel.contains(record.target)) return true;
      return Array.from(record.addedNodes).some((node) => nodeContainsElement(node, dropsPanel));
    });
    if (affectsDrops) this.claimAvailableRewards(dropsPanel);
  }

  private claimAvailableRewards(dropsPanel: HTMLElement | null = findDropsPanel()): void {
    if (this.lifecycle.isDisposed || !featureFlags.autoClaimDrops || !dropsPanel) return;

    for (const button of findClaimTargets(dropsPanel)) {
      if (this.clickedButtons.has(button) || button.disabled || !dropsPanel.contains(button)) continue;

      this.clickedButtons.add(button);
      logger.info('drops-auto-claim: clicking a confirmed Kick Drops claim button');
      button.click();
    }
  }
}

let activeController: DropsAutoClaimController | null = null;

export function initAutoClaimDrops(lifecycle: Lifecycle): void {
  const controller = new DropsAutoClaimController(lifecycle);
  activeController = controller;
  lifecycle.add(() => {
    if (activeController === controller) activeController = null;
  });
}

/** Called by bootstrap's shared flag mutator so the setting starts or stops in the live session. */
export function syncAutoClaimDropsFlag(): void {
  activeController?.syncFlag();
}
