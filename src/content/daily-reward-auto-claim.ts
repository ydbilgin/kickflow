import { featureFlags } from './chat/feature-flags';
import type { Lifecycle } from './shared/lifecycle';
import { logger } from './shared/logger';
import { isDropsRoutePath, SELECTORS } from './shared/selectors';
import { safeStorageSet } from './shared/extension-context';

// Keep the exported CTA string for the existing production anchor loader.
export const DAILY_REWARD_CTA_SELECTOR = SELECTORS.dailyRewardCta;
const DIALOG_SELECTOR = SELECTORS.dailyRewardDialog;
/** Each phase has a separate bounded wait: mount, clickable claim control, acknowledgement.
 * A shared deadline used to kill an attempt whose dialog had already opened. */
const DIALOG_WAIT_TIMEOUT_MS = 6_000;
const CLAIM_WAIT_TIMEOUT_MS = 6_000;
/** After the click Kick plays its unbox/roulette reveal before View replaces the button. 2026-10-20. */
const CLAIM_ACK_TIMEOUT_MS = 30_000;
/** Same launcher is not opened again until this elapses after a bounded-wait give-up. 2026-10-15. */
const LAUNCHER_GIVE_UP_COOLDOWN_MS = 10 * 60 * 1000;
const DIALOG_DID_NOT_MOUNT_REASON = 'dialog did not mount before the bounded wait ended';
const CLAIM_NEVER_CLICKABLE_REASON = 'the reward window opened but its claim button never became clickable';
const CLAIM_NOT_ACKNOWLEDGED_REASON = 'the claim click was not acknowledged before the bounded wait ended';
const CLAIM_REJECTED_REASON = 'Kick re-enabled the claim button without confirming the claim';
const OBSERVED_ATTRIBUTE_NAMES = [
  'class', 'data-state', 'disabled', 'aria-disabled', 'aria-controls',
  'hidden', 'aria-hidden', 'inert', 'role', 'src', 'id',
];

function isBoundedGiveUp(reason: string): boolean {
  return reason === DIALOG_DID_NOT_MOUNT_REASON || reason === CLAIM_NEVER_CLICKABLE_REASON
    || reason === CLAIM_NOT_ACKNOWLEDGED_REASON;
}
const OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  attributeFilter: OBSERVED_ATTRIBUTE_NAMES,
  childList: true,
  characterData: true,
  subtree: true,
};

interface RewardFlow {
  launcher: HTMLButtonElement;
  dialogsBeforeOpen: Set<HTMLElement>;
  dialog: HTMLElement | null;
  /** True once this attempt has clicked the launcher to open. 2026-10-15. */
  opened: boolean;
  /** pending: Kick disabled the button after our click (its request is in flight). 2026-10-20. */
  claim: { button: HTMLButtonElement; label: string; pending: boolean } | null;
}

/** Keep known layout tokens only: arbitrary classes, roles and custom element names can carry
 * identifiers. Both aspect syntaxes and the current primary palette must survive a miss. */
const DIAGNOSTIC_CLASS_PATTERN = /^(?:(?:sm|md|lg|xl|hover|focus|disabled):)*(?:relative|absolute|fixed|flex|grid|block|hidden|flex-(?:col|row|wrap|1)|(?:items|justify)-(?:center|start|end|between)|(?:w|h)-(?:full|auto|screen)|(?:gap|p|px|py|m|mx|my)-\d{1,2}|rounded(?:-(?:sm|md|lg|full))?|overflow-hidden|object-contain|aspect-(?:\[\d{1,4}\/\d{1,4}\]|\d{1,4}\/\d{1,4}|square|video)|bg-(?:black|primary(?:-(?:base|hover|active|disabled|subtle|default|strong))?|brand-bg-default|surface(?:-higher|-bg-highest)?))$/;
const DIAGNOSTIC_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'dialog', 'button', 'img', 'picture', 'video', 'canvas', 'span', 'p', 'h1', 'h2', 'h3', 'i', 'svg', 'path', 'form', 'input']);
const DIAGNOSTIC_ROLES = new Set(['dialog', 'alertdialog', 'button', 'img', 'presentation', 'none', 'group']);

/** At most 60 element records and 1800 ASCII bytes (under 2048 with the storage envelope).
 * Prioritize the stage/media/button before traversing icons or carousel descendants, so a large
 * header cannot hide the cause of a miss. Never store text, ids, URLs or raw attributes. */
function snapshotRewardStructure(flow: RewardFlow): string {
  const roots = flow.dialog ? [flow.dialog] : newDialogs(flow).slice(0, 4);
  if (!roots.length) roots.push(flow.launcher);
  const seen = new Set<Element>();
  let snapshot = '';
  const append = (element: Element): boolean => {
    if (seen.has(element)) return true;
    if (seen.size >= 60) return false;
    seen.add(element);
    const tag = DIAGNOSTIC_TAGS.has(element.localName) ? element.localName : 'element';
    const role = element.getAttribute('role') ?? '';
    const classes: string[] = [];
    for (const token of element.classList) {
      if (token.length <= 64 && DIAGNOSTIC_CLASS_PATTERN.test(token)) classes.push(token);
      if (classes.length === 8) break;
    }
    const type = element.getAttribute('type');
    const buttonType = element instanceof HTMLButtonElement
      ? ` type=${type === null ? 'missing' : /^(?:button|submit|reset)$/i.test(type) ? type.toLowerCase() : 'other'}` : '';
    const line = `${tag}${DIAGNOSTIC_ROLES.has(role) ? ` role=${role}` : ''}${buttonType} class=${classes.join(' ')}\n`;
    if (snapshot.length + line.length > 1_800) return false;
    snapshot += line;
    return true;
  };
  for (const root of roots) {
    const stage = root.querySelector(SELECTORS.dailyRewardStage);
    const button = root.querySelector(SELECTORS.dailyRewardFullWidthButton);
    for (const element of [root, stage, stage?.querySelector('video, img'), button]) {
      if (element && !append(element)) return snapshot;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!append(node as Element)) return snapshot;
    }
  }
  return snapshot;
}

function isInsideExcludedRewardSurface(element: Element): boolean {
  return element.closest(SELECTORS.dailyRewardExcludedSurface) !== null;
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

/** Stage identity is local to the opened dialog. The 2026-10 bundle uses a carousel and
 * aspect-1348/1080; older markup uses brackets. A media fallback uses the same bundle's
 * StageShell surface, never an arbitrary video elsewhere in the dialog or document. */
function findRewardStages(dialog: HTMLElement): HTMLElement[] {
  const stages = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.dailyRewardStage));
  const mediaStages = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.dailyRewardMediaStage))
    .filter((stage) => stage.querySelector('video, img') !== null);
  return Array.from(new Set([...stages, ...mediaStages]))
    .filter((stage) => !isInsideExcludedRewardSurface(stage)
      && !stages.some((outer) => outer !== stage && outer.contains(stage)));
}

function newDialogs(flow: RewardFlow): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR))
    .filter((dialog) => !flow.dialogsBeforeOpen.has(dialog) && !isInsideExcludedRewardSurface(dialog));
}

/** Trigger linkage wins. Without it, require exactly one newly mounted reward candidate.
 * A pre-existing cookie dialog, excluded surface, or nested dialog cannot supply a target.
 * Primary styling plus a stage prevents a foreign full-width button borrowing identity. */
function findRewardDialogCandidates(flow: RewardFlow): HTMLElement[] {
  const controlledId = flow.launcher.getAttribute('aria-controls');
  const linked = controlledId ? document.getElementById(controlledId) : null;
  return newDialogs(flow).filter((dialog) => dialog.matches('[role="dialog"]')
    && (!controlledId || dialog === linked)
    && dialog.parentElement?.closest(DIALOG_SELECTOR) === null
    && dialog.querySelector(DIALOG_SELECTOR) === null
    && findFinalClaimButton(dialog) !== null);
}

/** Footers are portalled after the carousel; inactive ones carry hidden (fresh bundle).
 * Keep the final full-width control after the entire stage area, including while disabled. */
function findFinalClaimButton(dialog: HTMLElement): HTMLButtonElement | null {
  const stages = findRewardStages(dialog);
  if (!stages.length || !dialog.isConnected || isInsideExcludedRewardSurface(dialog)) return null;
  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>(SELECTORS.dailyRewardFullWidthButton))
    .filter((button) => button.closest(DIALOG_SELECTOR) === dialog
      && !isInsideExcludedRewardSurface(button)
      && button.closest(SELECTORS.dailyRewardHidden) === null
      // The native Button has no type. Its DOM type is submit even outside a form.
      && (!button.hasAttribute('type') || button.getAttribute('type')?.toLowerCase() === 'button')
      && button.form === null && !button.closest('form')
      && stages.every((stage) => !stage.contains(button)
        && (stage.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
  const final = buttons[buttons.length - 1];
  return final?.matches(SELECTORS.dailyRewardPrimaryButton) && !hasUnsafeActionLabel(final) ? final : null;
}

/** Primary styling never authorizes purchases, subscriptions, gifts or follows. Check both
 * visible and accessible labels; Turkish dotless i and accents fold to the same word. */
function hasUnsafeActionLabel(button: HTMLButtonElement): boolean {
  const label = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ı/g, 'i');
  return /(?:^|[^a-z])(?:buy(?:s|ing)?(?![a-z])|tip(?:s|ping)?(?![a-z])|purchas|(?:re)?subscri|gift|follow|donat|satin\s*al|abone|hediye|taki[pb]|bagis)/.test(label);
}

type ClaimTarget =
  | { kind: 'wait' }
  | { kind: 'stop'; reason: string }
  | { kind: 'ready'; button: HTMLButtonElement };

/** Re-derives the claim target for an already chosen dialog from the live DOM. Run on every
 * mutation AND once more immediately before the click, so a dialog that changed, gained a twin, or
 * lost its identity after it was chosen is never clicked. */
function resolveClaimTarget(dialog: HTMLElement, flow: RewardFlow): ClaimTarget {
  if (!dialog.isConnected) return { kind: 'stop', reason: 'the opened dialog disappeared before claiming' };
  const candidates = findRewardDialogCandidates(flow);
  const stageCount = findRewardStages(dialog).length;
  if (candidates.length !== 1 || candidates[0] !== dialog) {
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
      || (target instanceof HTMLButtonElement && record.attributeName === 'aria-controls')
      || target.matches(DIALOG_SELECTOR)
      || target.closest(DIALOG_SELECTOR) !== null;
  }

  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target && target.closest(DIALOG_SELECTOR) !== null) return true;
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
  /** One warning per document; storage still retains the latest give-up structure. */
  private giveUpWarned = false;
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

  /** Close an existing attempt and forget the appearance; never start one on Drops. */
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
      claim: null,
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

    if (flow.claim) {
      this.checkClaimOutcome(flow, flow.claim);
      return;
    }

    if (!flow.dialog) {
      // The CTA is the TRIGGER, and nothing more. Kick removes it from the navbar in the same tick
      // the reward window opens, so re-checking it here aborted every attempt before the dialog was
      // even looked for — measured live 2026-08-04, that check alone killed the whole feature. An
      // attempt that opens nothing is already bounded by the two waits below.
      const candidates = findRewardDialogCandidates(flow);
      if (candidates.length === 0) return;
      if (candidates.length > 1) {
        this.failAttempt(`several daily-reward dialogs are present (${candidates.length} candidates); refusing to choose one`);
        return;
      }
      flow.dialog = candidates[0];
      this.restartWait(flow, CLAIM_WAIT_TIMEOUT_MS, CLAIM_NEVER_CLICKABLE_REASON);
    }

    const target = resolveClaimTarget(flow.dialog, flow);
    if (target.kind === 'wait') return;
    if (target.kind === 'stop') {
      this.failAttempt(target.reason);
      return;
    }
    this.claimAndClose(flow, flow.dialog, target.button);
  }

  /** A click alone is not success, and neither is the disabled state. Kick's 2026-10-20 bundle disables
   * the button the moment its claim request starts (isPending), long before the server answers; the
   * answer then either replaces the button with View/Share (success), changes its label (claimed), or
   * re-enables it after an error toast. Closing on "disabled" unmounted the reward window mid-request,
   * so Kick's own success handler never updated the navbar and the chest kept looking unclaimed. */
  private checkClaimOutcome(flow: RewardFlow, claim: NonNullable<RewardFlow['claim']>): void {
    const { button, label } = claim;
    const dialog = flow.dialog;
    if (!dialog || !dialog.isConnected) {
      logger.info('daily-reward-auto-claim: the reward window closed before Kick confirmed the claim');
      this.finishFlow();
      return;
    }
    const replaced = !button.isConnected || !dialog.contains(button);
    if (replaced || (button.textContent ?? '') !== label) {
      logger.info('daily-reward-auto-claim: claimed');
      this.finishFlow();
      this.closeOpenedDialog(flow);
      return;
    }
    const pending = button.disabled || button.getAttribute('aria-disabled') === 'true';
    if (pending) {
      claim.pending = true;
      return;
    }
    if (claim.pending) this.failAttempt(CLAIM_REJECTED_REASON);
  }

  private claimAndClose(flow: RewardFlow, dialog: HTMLElement, claimButton: HTMLButtonElement): void {
    logger.info('daily-reward-auto-claim: clicking the enabled Kick claim button');
    // Last look before acting on the owner's live account: the same identity check, from the live
    // DOM, with nothing in between but the click itself.
    const recheck = resolveClaimTarget(dialog, flow);
    if (recheck.kind !== 'ready' || recheck.button !== claimButton) {
      const detail = recheck.kind === 'stop' ? `: ${recheck.reason}` : '';
      this.failAttempt(`the daily-reward dialog changed right before the click${detail}`);
      return;
    }
    flow.claim = { button: claimButton, label: claimButton.textContent ?? '', pending: false };
    this.restartWait(flow, CLAIM_ACK_TIMEOUT_MS, CLAIM_NOT_ACKNOWLEDGED_REASON);
    try {
      claimButton.click();
    } catch (error) {
      this.failAttempt('claim button click threw', error);
      return;
    }

    this.advanceFlow();
  }

  /** Clean up newly opened windows even when recognition failed. Never send a global Escape
   * or touch a pre-existing dialog. The bundle's own Close control is a fallback if the
   * trigger was removed or its toggle did not remove the window. */
  private closeOpenedDialog(flow: RewardFlow): void {
    const dialogs = newDialogs(flow);
    const linkedId = flow.dialog ? null : flow.launcher.getAttribute('aria-controls'); // A linked launcher owns one window.
    const opened = dialogs.filter((dialog) => (flow.dialog ? dialog === flow.dialog : !linkedId || dialog.id === linkedId));
    if (!flow.opened || !opened.length) return;
    if (flow.launcher.isConnected) {
      logger.info('daily-reward-auto-claim: closing the daily-reward window with its launcher toggle');
      try { flow.launcher.click(); } catch (error) {
        logger.debug('daily-reward-auto-claim: launcher close threw', error);
      }
    }
    for (const dialog of opened) {
      if (!dialog.isConnected) continue;
      const label = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.dailyRewardCloseLabel))
        .find((span) => span.textContent?.trim() === 'Close'
          && span.closest(DIALOG_SELECTOR) === dialog && !isInsideExcludedRewardSurface(span));
      const close = label?.closest('button');
      if (close instanceof HTMLButtonElement && !close.disabled) {
        try { close.click(); } catch (error) {
          logger.debug('daily-reward-auto-claim: dialog close threw', error);
        }
      }
    }
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
    // Capture before closing, and keep arbitrary page classes out of warnings as well as storage.
    if (flow) void safeStorageSet({ kf_diag_dailyReward: snapshotRewardStructure(flow) });
    if (flow && isBoundedGiveUp(reason)) this.rememberBoundedGiveUp(flow.launcher);
    this.logGiveUp(reason, error);
    this.finishFlow();
    if (flow) this.closeOpenedDialog(flow);
  }

  /** Repeated give-ups stay off the extension errors page. */
  private logGiveUp(reason: string, error?: unknown): void {
    const detail = error ?? '';
    if (this.giveUpWarned) {
      logger.debug('daily-reward-auto-claim: giving up for this CTA appearance:', reason, detail);
      return;
    }
    this.giveUpWarned = true;
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
    const flow = this.flow;
    this.finishFlow();
    if (flow) this.closeOpenedDialog(flow);
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
