import { featureFlags } from './chat/feature-flags';
import type { Lifecycle } from './shared/lifecycle';
import { logger } from './shared/logger';
import { isDropsRoutePath } from './shared/selectors';

export const DAILY_REWARD_CTA_SELECTOR = 'video[src*="reward-available-CTA"]';
const EXCLUDED_REWARD_SURFACE_SELECTOR = '#rewards-panel, #drops-panel';
const DIALOG_SELECTOR = '[role="dialog"]';
const FULL_WIDTH_BUTTON_SELECTOR = 'button.w-full';
/** Positive identity of Kick's daily-reward modal rests on its confirmed STRUCTURE, not one class.
 * The modal, its content and its claim button carry no stable id or data-testid. 2026-10-16.
 * Identify the dialog by its nested components:
 * ModalWrapper `div.relative.flex.flex-col` > content `div.flex.w-full.flex-col.items-center.gap-4`
 * holding the StageShell (`aspect-[1348/1080]`) and, after it, the full-width primary claim button.
 * Width and stage classes alone do not identify the reward dialog. Nested dialogs cannot
 * supply its identity or claim button. 2026-10-16. */
const REWARD_STAGE_SELECTOR = '[class~="aspect-[1348/1080]"]';
const REWARD_MODAL_WRAPPER_SELECTOR = 'div.relative.flex.flex-col';
const REWARD_CONTENT_SELECTOR = 'div.flex.w-full.flex-col.items-center.gap-4';
/** Two separate bounded waits. The first covers Kick mounting its reward window after the launcher
 * click; the second covers the window's own entry/"celebrate" phase before the claim control is
 * clickable. One shared 3 s deadline used to kill an attempt whose dialog had already opened. */
const DIALOG_WAIT_TIMEOUT_MS = 6_000;
const CLAIM_WAIT_TIMEOUT_MS = 6_000;
/** Same launcher is not opened again until this elapses after a bounded-wait give-up. 2026-10-15. */
const LAUNCHER_GIVE_UP_COOLDOWN_MS = 10 * 60 * 1000;
const DIALOG_DID_NOT_MOUNT_REASON = 'dialog did not mount before the bounded wait ended';
const CLAIM_NEVER_CLICKABLE_REASON = 'the reward window opened but its claim button never became clickable';
const OBSERVED_ATTRIBUTE_NAMES = ['class', 'data-state', 'disabled', 'role', 'src'];

function isBoundedGiveUp(reason: string): boolean {
  return reason === DIALOG_DID_NOT_MOUNT_REASON || reason === CLAIM_NEVER_CLICKABLE_REASON;
}
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
  /** True once this attempt has clicked the launcher to open. 2026-10-15. */
  opened: boolean;
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

function countRewardStagesInDocument(): number {
  return document.querySelectorAll(REWARD_STAGE_SELECTOR).length;
}

/** The reward dialog's single StageShell, or null unless the dialog carries the confirmed structure:
 * no dialog nested inside it, exactly one stage, the stage inside the content container, the content
 * container inside the ModalWrapper, all inside this dialog. Document-wide stage uniqueness is checked
 * by the callers, because a second stage anywhere is a reason to STOP, not just to skip a dialog. */
function findRewardStage(dialog: HTMLElement): HTMLElement | null {
  if (!dialog.isConnected || isInsideExcludedRewardSurface(dialog)) return null;
  if (dialog.querySelector(DIALOG_SELECTOR) !== null) return null;
  const stages = dialog.querySelectorAll<HTMLElement>(REWARD_STAGE_SELECTOR);
  if (stages.length !== 1) return null;
  const stage = stages[0];
  const content = stage.parentElement?.closest<HTMLElement>(REWARD_CONTENT_SELECTOR) ?? null;
  if (!content || !dialog.contains(content)) return null;
  const wrapper = content.parentElement?.closest<HTMLElement>(REWARD_MODAL_WRAPPER_SELECTOR) ?? null;
  if (!wrapper || !dialog.contains(wrapper)) return null;
  return stage;
}

/** Every dialog that appeared after the launcher click AND carries the reward structure. The daily
 * reward modal is not the only `role="dialog"` on a Kick page (the cookie-consent SDK keeps one
 * mounted, observed live 2026-08-02), so "newly appeared" never decides alone. The caller acts only
 * when this list has exactly one entry and the stage is unique in the document. */
function findRewardDialogCandidates(dialogsBeforeOpen: Set<HTMLElement>): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR))
    .filter((dialog) => !dialogsBeforeOpen.has(dialog) && findRewardStage(dialog) !== null);
}

/** The claim control is the final full-width button of the reward content container that comes
 * AFTER the stage, is not inside the stage, and whose nearest dialog is the reward dialog itself. */
function findFinalClaimButton(dialog: HTMLElement): HTMLButtonElement | null {
  const stage = findRewardStage(dialog);
  const content = stage?.parentElement?.closest<HTMLElement>(REWARD_CONTENT_SELECTOR) ?? null;
  if (!stage || !content) return null;
  const buttons = Array.from(content.querySelectorAll<HTMLButtonElement>(FULL_WIDTH_BUTTON_SELECTOR))
    .filter((button) => button.closest(DIALOG_SELECTOR) === dialog
      && !stage.contains(button)
      && (stage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  return buttons[buttons.length - 1] ?? null;
}

type ClaimTarget =
  | { kind: 'wait' }
  | { kind: 'stop'; reason: string }
  | { kind: 'ready'; button: HTMLButtonElement };

/** Re-derives the claim target for an already chosen dialog from the live DOM. Run on every
 * mutation AND once more immediately before the click, so a dialog that changed, gained a twin, or
 * lost its identity after it was chosen is never clicked. */
function resolveClaimTarget(dialog: HTMLElement, dialogsBeforeOpen: Set<HTMLElement>): ClaimTarget {
  if (!dialog.isConnected) return { kind: 'stop', reason: 'the opened dialog disappeared before claiming' };
  const candidates = findRewardDialogCandidates(dialogsBeforeOpen);
  const stageCount = countRewardStagesInDocument();
  if (candidates.length !== 1 || candidates[0] !== dialog || stageCount !== 1) {
    return {
      kind: 'stop',
      reason: `the chosen dialog is no longer the single daily-reward dialog (${candidates.length} candidates, ${stageCount} stages)`,
    };
  }

  const claimButton = findFinalClaimButton(dialog);
  if (!claimButton) return { kind: 'wait' };
  // Disabled is a PHASE, not a verdict. Kick mounts the reward window with its claim button
  // disabled and enables it a moment later, so failing here gave up on the first mutation after
  // the dialog appeared — every time, on the owner's real reward (2026-08-06). The 6 s wait armed
  // the instant the dialog was found already covers a button that never becomes clickable, and
  // its message says exactly that. Wait for it instead of pre-empting it.
  //
  // A transient disabled state must not pre-empt the bounded wait. 2026-10-16.
  // Let that wait decide when the button remains disabled.
  if (claimButton.disabled || claimButton.getAttribute('aria-disabled') === 'true') return { kind: 'wait' };
  if (isInsideExcludedRewardSurface(claimButton) || !dialog.contains(claimButton)) {
    return { kind: 'stop', reason: 'the claim button was outside the opened daily-reward dialog' };
  }
  return { kind: 'ready', button: claimButton };
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
 * Drops routes (/drops and /drops/*) are not attempts. Re-checked on kickflow:locationchange.
 * 2026-10-15.
 */
export class DailyRewardAutoClaimController {
  private observer: MutationObserver | null = null;
  private ctaPresent = false;
  private attemptStartedForCta = false;
  private flow: RewardFlow | null = null;
  private waitTimeoutId: number | null = null;
  /** Launcher and CTA nodes that recently gave up on a bounded wait. 2026-10-15. */
  private readonly giveUpUntil = new WeakMap<Node, number>();
  /** First bounded-wait give-up of this document is warn; later ones are debug. 2026-10-15. */
  private boundedGiveUpWarned = false;
  /** Page-wide: after a bounded give-up no launcher is clicked until this time, even if the site
   * re-mounts the header CTA as new nodes. 2026-10-15. */
  private boundedGiveUpUntil = 0;

  constructor(private readonly lifecycle: Lifecycle) {
    lifecycle.add(() => this.dispose());
    lifecycle.addEventListener(window, 'kickflow:locationchange', () => this.onLocationChange());
    if (featureFlags.autoClaimDailyReward) this.startObserving();
  }

  syncFlag(): void {
    if (featureFlags.autoClaimDailyReward) {
      this.startObserving();
    } else {
      this.stopObserving();
    }
  }

  /** bootstrap dispatches this on SPA navigation. Drops routes suppress; leaving them re-checks the header CTA. */
  private onLocationChange(): void {
    if (this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;
    if (isDropsRoutePath(window.location.pathname)) {
      this.suppressForDropsRoute();
      return;
    }
    this.syncCtaAppearance();
  }

  /** Drop any in-flight wait and forget the appearance. No click. 2026-10-15. */
  private suppressForDropsRoute(): void {
    this.cancelFlow();
    this.ctaPresent = false;
    this.attemptStartedForCta = false;
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
    if (isDropsRoutePath(window.location.pathname)) {
      this.suppressForDropsRoute();
      return;
    }
    this.advanceFlow();
    this.syncCtaAppearance();
  }

  private syncCtaAppearance(): void {
    if (isDropsRoutePath(window.location.pathname)) {
      this.suppressForDropsRoute();
      return;
    }

    const video = findDailyRewardVideo();
    if (!video) {
      this.ctaPresent = false;
      this.attemptStartedForCta = false;
      return;
    }

    if (this.ctaPresent) return;
    this.ctaPresent = true;
    if (this.attemptStartedForCta || this.flow) return;

    const launcher = findDailyRewardLauncher(video);
    if (!launcher) {
      this.attemptStartedForCta = true;
      logger.warn('daily-reward-auto-claim: CTA appeared without its native launcher');
      return;
    }
    if (this.isCoolingDown(video, launcher)) {
      this.attemptStartedForCta = true;
      return;
    }

    this.attemptStartedForCta = true;
    this.startAttempt(launcher);
  }

  private startAttempt(launcher: HTMLButtonElement): void {
    // 2026-10-15: one open click per attempt. A re-entrant click must not open again.
    if (this.flow?.opened) return;
    if (isDropsRoutePath(window.location.pathname)) {
      this.suppressForDropsRoute();
      return;
    }
    const flow: RewardFlow = {
      launcher,
      dialogsBeforeOpen: new Set(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)),
      dialog: null,
      opened: true,
    };
    this.flow = flow;
    this.restartWait(flow, DIALOG_WAIT_TIMEOUT_MS, DIALOG_DID_NOT_MOUNT_REASON);

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
    if (isDropsRoutePath(window.location.pathname)) {
      this.suppressForDropsRoute();
      return;
    }
    const flow = this.flow;
    if (!flow || this.lifecycle.isDisposed || !featureFlags.autoClaimDailyReward) return;

    if (!flow.dialog) {
      // The CTA is the TRIGGER, and nothing more. Kick removes it from the navbar in the same tick
      // the reward window opens, so re-checking it here aborted every attempt before the dialog was
      // even looked for — measured live 2026-08-04, that check alone killed the whole feature. An
      // attempt that opens nothing is already bounded by the two waits below.
      const candidates = findRewardDialogCandidates(flow.dialogsBeforeOpen);
      if (candidates.length === 0) return;
      const stageCount = countRewardStagesInDocument();
      if (candidates.length > 1 || stageCount !== 1) {
        this.failAttempt(`several daily-reward dialogs or stages are present (${candidates.length} candidates, ${stageCount} stages); refusing to choose one`);
        return;
      }
      flow.dialog = candidates[0];
      this.restartWait(flow, CLAIM_WAIT_TIMEOUT_MS, CLAIM_NEVER_CLICKABLE_REASON);
    }

    const target = resolveClaimTarget(flow.dialog, flow.dialogsBeforeOpen);
    if (target.kind === 'wait') return;
    if (target.kind === 'stop') {
      this.failAttempt(target.reason);
      return;
    }
    this.claimAndClose(flow, flow.dialog, target.button);
  }

  private claimAndClose(flow: RewardFlow, dialog: HTMLElement, claimButton: HTMLButtonElement): void {
    logger.info('daily-reward-auto-claim: clicking the enabled Kick claim button');
    // Last look before acting on the owner's live account: the same identity check, from the live
    // DOM, with nothing in between but the click itself.
    const recheck = resolveClaimTarget(dialog, flow.dialogsBeforeOpen);
    if (recheck.kind !== 'ready' || recheck.button !== claimButton) {
      const detail = recheck.kind === 'stop' ? `: ${recheck.reason}` : '';
      this.failAttempt(`the daily-reward dialog changed right before the click${detail}`);
      return;
    }
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

  /** Replaces the flow's bounded wait. Each phase gets its own deadline and its own reason, so a
   * failure names the step that actually stalled. */
  private restartWait(flow: RewardFlow, timeoutMs: number, reason: string): void {
    if (this.waitTimeoutId !== null) window.clearTimeout(this.waitTimeoutId);
    this.waitTimeoutId = window.setTimeout(() => {
      if (this.flow !== flow) return;
      this.failAttempt(reason);
    }, timeoutMs);
  }

  private failAttempt(reason: string, error?: unknown): void {
    const flow = this.flow;
    if (flow) this.closeOpenedDialog(flow);
    if (flow && isBoundedGiveUp(reason)) this.rememberBoundedGiveUp(flow.launcher);
    this.logGiveUp(reason, error);
    this.finishFlow();
  }

  /** Repeat bounded-wait give-ups stay off the extension errors page. debug is silent unless the debug flag is on. */
  private logGiveUp(reason: string, error?: unknown): void {
    const detail = error ?? '';
    if (isBoundedGiveUp(reason) && this.boundedGiveUpWarned) {
      logger.debug('daily-reward-auto-claim: giving up for this CTA appearance:', reason, detail);
      return;
    }
    if (isBoundedGiveUp(reason)) this.boundedGiveUpWarned = true;
    logger.warn('daily-reward-auto-claim: giving up for this CTA appearance:', reason, detail);
  }

  private rememberBoundedGiveUp(launcher: HTMLButtonElement): void {
    const until = Date.now() + LAUNCHER_GIVE_UP_COOLDOWN_MS;
    this.giveUpUntil.set(launcher, until);
    this.boundedGiveUpUntil = Math.max(this.boundedGiveUpUntil, until);
    const video = launcher.querySelector(DAILY_REWARD_CTA_SELECTOR);
    if (video) this.giveUpUntil.set(video, until);
  }

  private isCoolingDown(video: HTMLVideoElement, launcher: HTMLButtonElement): boolean {
    const now = Date.now();
    if (now < this.boundedGiveUpUntil) return true;
    const videoUntil = this.giveUpUntil.get(video);
    const launcherUntil = this.giveUpUntil.get(launcher);
    return (videoUntil !== undefined && now < videoUntil)
      || (launcherUntil !== undefined && now < launcherUntil);
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
