import { featureFlags } from './chat/feature-flags';
import type { Lifecycle } from './shared/lifecycle';
import { logger } from './shared/logger';

const DAILY_REWARD_CTA_SELECTOR = 'video[src*="reward-available-CTA"]';
const EXCLUDED_REWARD_SURFACE_SELECTOR = '#rewards-panel, #drops-panel';
const DIALOG_SELECTOR = '[role="dialog"]';
const FULL_WIDTH_BUTTON_SELECTOR = 'button.w-full';
const DIALOG_WAIT_TIMEOUT_MS = 3_000;
const OBSERVED_ATTRIBUTE_NAMES = ['class', 'data-state', 'disabled', 'role', 'src'];
const OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  attributeFilter: OBSERVED_ATTRIBUTE_NAMES,
  childList: true,
  subtree: true,
};

interface RewardFlow {
  launcher: HTMLButtonElement;
  dialogsBeforeOpen: Set<HTMLElement>;
  dialog: HTMLElement | null;
}

function isInsideExcludedRewardSurface(element: Element): boolean {
  return element.closest(EXCLUDED_REWARD_SURFACE_SELECTOR) !== null;
}

function findDailyRewardVideo(): HTMLVideoElement | null {
  for (const video of document.querySelectorAll<HTMLVideoElement>(DAILY_REWARD_CTA_SELECTOR)) {
    if (!isInsideExcludedRewardSurface(video)) return video;
  }
  return null;
}

function findDailyRewardLauncher(video: HTMLVideoElement): HTMLButtonElement | null {
  const launcher = video.closest('button');
  if (!(launcher instanceof HTMLButtonElement)) return null;
  if (isInsideExcludedRewardSurface(launcher)) return null;
  return launcher;
}

/** The daily-reward modal is not the only `role="dialog"` on a Kick page — the cookie-consent SDK
 * keeps one mounted too, observed live on 2026-08-02. "Newly appeared" alone would therefore pick a
 * stranger whenever an unrelated dialog mounts in the same tick, so a candidate must also hold a
 * full-width button, which is the shape the reward modal's claim control has. */
function findOpenedDialog(dialogsBeforeOpen: Set<HTMLElement>): HTMLElement | null {
  for (const dialog of document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)) {
    if (dialogsBeforeOpen.has(dialog) || isInsideExcludedRewardSurface(dialog)) continue;
    if (!dialog.querySelector(FULL_WIDTH_BUTTON_SELECTOR)) continue;
    return dialog;
  }
  return null;
}

function findFinalClaimButton(dialog: HTMLElement): HTMLButtonElement | null {
  const buttons = dialog.querySelectorAll<HTMLButtonElement>(FULL_WIDTH_BUTTON_SELECTOR);
  return buttons.item(buttons.length - 1) ?? null;
}

function nodeContainsRewardSurface(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return false;
  const parent = node as ParentNode;
  if (node instanceof Element && (node.matches(DAILY_REWARD_CTA_SELECTOR) || node.matches(DIALOG_SELECTOR))) return true;
  return parent.querySelector(DAILY_REWARD_CTA_SELECTOR) !== null
    || parent.querySelector(DIALOG_SELECTOR) !== null;
}

function isRewardMutation(record: MutationRecord): boolean {
  if (record.type === 'attributes') {
    const target = record.target;
    if (!(target instanceof Element)) return false;
    return target.matches('video')
      || target.matches(DIALOG_SELECTOR)
      || target.closest(DIALOG_SELECTOR) !== null;
  }

  if (record.target instanceof Element && record.target.closest(DIALOG_SELECTOR) !== null) return true;
  return Array.from(record.addedNodes).some(nodeContainsRewardSurface)
    || Array.from(record.removedNodes).some(nodeContainsRewardSurface);
}

/**
 * Claims the global navbar daily reward through Kick's own controls. This surface is observed with
 * a MutationObserver because the navbar and Radix portal mount asynchronously; an interval would
 * add recurring work on every page when a single DOM appearance event is enough.
 */
export class DailyRewardAutoClaimController {
  private observer: MutationObserver | null = null;
  private ctaPresent = false;
  private attemptStartedForCta = false;
  private flow: RewardFlow | null = null;
  private waitTimeoutId: number | null = null;

  constructor(private readonly lifecycle: Lifecycle) {
    lifecycle.add(() => this.dispose());
    if (featureFlags.autoClaimDailyReward) this.startObserving();
  }

  syncFlag(): void {
    if (featureFlags.autoClaimDailyReward) {
      this.startObserving();
    } else {
      this.stopObserving();
    }
  }

  private startObserving(): void {
    if (this.observer || this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;

    const observationRoot = document.body ?? document.documentElement;
    if (!observationRoot) return;

    const observer = new MutationObserver((records) => {
      if (!records.some(isRewardMutation)) return;
      this.handleRewardMutations();
    });
    observer.observe(observationRoot, OBSERVER_OPTIONS);
    this.observer = observer;
    this.syncCtaAppearance();
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.cancelFlow();
  }

  private dispose(): void {
    this.stopObserving();
  }

  private handleRewardMutations(): void {
    if (this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
    this.advanceFlow();
    this.syncCtaAppearance();
  }

  private syncCtaAppearance(): void {
    const video = findDailyRewardVideo();
    if (!video) {
      this.ctaPresent = false;
      this.attemptStartedForCta = false;
      return;
    }

    if (this.ctaPresent) return;
    this.ctaPresent = true;
    if (this.attemptStartedForCta || this.flow) return;

    this.attemptStartedForCta = true;
    const launcher = findDailyRewardLauncher(video);
    if (!launcher) {
      logger.warn('daily-reward-auto-claim: CTA appeared without its native launcher');
      return;
    }
    this.startAttempt(launcher);
  }

  private startAttempt(launcher: HTMLButtonElement): void {
    const flow: RewardFlow = {
      launcher,
      dialogsBeforeOpen: new Set(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)),
      dialog: null,
    };
    this.flow = flow;
    this.waitTimeoutId = window.setTimeout(() => {
      if (this.flow !== flow) return;
      this.failAttempt('dialog did not mount before the bounded wait ended');
    }, DIALOG_WAIT_TIMEOUT_MS);

    logger.info('daily-reward-auto-claim: opening Kick’s daily reward window');
    try {
      launcher.click();
    } catch (error) {
      this.failAttempt('launcher click threw', error);
      return;
    }
    this.advanceFlow();
  }

  private advanceFlow(): void {
    const flow = this.flow;
    if (!flow || this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
    if (!findDailyRewardVideo()) {
      this.failAttempt('the claimable CTA disappeared before the claim step');
      return;
    }

    if (!flow.dialog) {
      flow.dialog = findOpenedDialog(flow.dialogsBeforeOpen);
      if (!flow.dialog) return;
    }

    if (!flow.dialog.isConnected) {
      this.failAttempt('the opened dialog disappeared before claiming');
      return;
    }

    const claimButton = findFinalClaimButton(flow.dialog);
    if (!claimButton) return;
    if (claimButton.disabled || claimButton.getAttribute('aria-disabled') === 'true') {
      this.failAttempt('the final daily-reward claim button is disabled');
      return;
    }
    if (isInsideExcludedRewardSurface(claimButton) || !flow.dialog.contains(claimButton)) {
      this.failAttempt('the claim button was outside the opened daily-reward dialog');
      return;
    }

    this.claimAndClose(flow, claimButton);
  }

  private claimAndClose(flow: RewardFlow, claimButton: HTMLButtonElement): void {
    logger.info('daily-reward-auto-claim: clicking the enabled Kick claim button');
    try {
      claimButton.click();
    } catch (error) {
      this.failAttempt('claim button click threw', error);
      return;
    }

    this.closeOpenedDialog(flow);
    this.finishFlow();
  }

  /** Uses the confirmed native trigger as Radix's toggle. It avoids a document-level synthetic
   * key event, which can reach unrelated page handlers and disturb live layout state. */
  private closeOpenedDialog(flow: RewardFlow): void {
    if (!flow.dialog?.isConnected) return;
    if (!flow.launcher.isConnected) {
      logger.warn('daily-reward-auto-claim: cannot close the dialog because its launcher was removed');
      return;
    }

    logger.info('daily-reward-auto-claim: closing the daily-reward window with its launcher toggle');
    flow.launcher.click();
  }

  private failAttempt(reason: string, error?: unknown): void {
    const flow = this.flow;
    if (flow) this.closeOpenedDialog(flow);
    logger.warn('daily-reward-auto-claim: giving up for this CTA appearance:', reason, error ?? '');
    this.finishFlow();
  }

  private finishFlow(): void {
    if (this.waitTimeoutId !== null) {
      window.clearTimeout(this.waitTimeoutId);
      this.waitTimeoutId = null;
    }
    this.flow = null;
  }

  private cancelFlow(): void {
    if (this.waitTimeoutId !== null) {
      window.clearTimeout(this.waitTimeoutId);
      this.waitTimeoutId = null;
    }
    this.flow = null;
  }
}

let activeController: DailyRewardAutoClaimController | null = null;

export function initAutoClaimDailyReward(lifecycle: Lifecycle): void {
  const controller = new DailyRewardAutoClaimController(lifecycle);
  activeController = controller;
  lifecycle.add(() => {
    if (activeController === controller) activeController = null;
  });
}

/** Called by bootstrap's shared flag mutator so the setting starts or stops this site surface live. */
export function syncAutoClaimDailyRewardFlag(): void {
  activeController?.syncFlag();
}
