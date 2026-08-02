import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DailyRewardAutoClaimController,
} from '../../src/content/daily-reward-auto-claim';
import { featureFlags, setFeatureFlag } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const DAILY_REWARD_CTA_SRC = 'https://static.kick.com/rewards/reward-available-CTA.webm';
const DIALOG_WAIT_TIMEOUT_MS = 3_000;

interface RewardFixture {
  launcher: HTMLButtonElement;
  video: HTMLVideoElement;
  getClaimButtons: () => HTMLButtonElement[];
}

function createClaimDialog(disabled: boolean): { dialog: HTMLDivElement; claimButton: HTMLButtonElement } {
  // CONFIRMED from round 81 §8: Radix role="dialog", ModalWrapper, StageShell, and the final
  // full-width primary claim button. RECONSTRUCTED: runtime data-state, labels, and surrounding text.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.dataset.state = 'open';
  dialog.className = 'flex flex-col lg:max-w-[482px]';

  const modalWrapper = document.createElement('div');
  modalWrapper.className = 'relative flex flex-col';
  const content = document.createElement('div');
  content.className = 'flex w-full flex-col items-center gap-4';
  const stageShell = document.createElement('div');
  stageShell.className = 'bg-surface-higher relative aspect-[1348/1080] w-full overflow-hidden rounded-md bg-black';
  const footer = document.createElement('div');
  footer.className = 'flex w-full flex-col items-center gap-2';
  const claimButton = document.createElement('button');
  claimButton.type = 'button';
  claimButton.className = 'w-full';
  claimButton.textContent = 'Claim';
  claimButton.disabled = disabled;
  footer.append(claimButton);
  content.append(stageShell, footer);
  modalWrapper.append(content);
  dialog.append(modalWrapper);
  return { dialog, claimButton };
}

function installRewardFixture(disabled = false): RewardFixture {
  // RECONSTRUCTED from round 81 §8: the CTA URL, navbar right-cluster parent, and KICKs sibling order.
  // CONFIRMED: the launcher is a native button holding a localized-label video CTA.
  const nav = document.createElement('nav');
  const left = document.createElement('div');
  const middle = document.createElement('div');
  const right = document.createElement('div');
  right.className = 'flex items-center gap-2';

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', '[localized claim_your_reward]');
  const video = document.createElement('video');
  video.src = DAILY_REWARD_CTA_SRC;
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.className = 'absolute inset-0 size-full object-contain';
  launcher.append(video);

  const kicks = document.createElement('button');
  kicks.type = 'button';
  kicks.dataset.testid = 'kicks-top-nav';
  kicks.textContent = '[localized KICKs balance]';
  right.append(launcher, kicks);
  nav.append(left, middle, right);
  document.body.append(nav);

  const claimButtons: HTMLButtonElement[] = [];
  let openDialog: HTMLDivElement | null = null;
  launcher.addEventListener('click', () => {
    if (openDialog?.isConnected) {
      openDialog.remove();
      return;
    }
    const fixture = createClaimDialog(disabled);
    claimButtons.push(fixture.claimButton);
    openDialog = fixture.dialog;
    document.body.append(openDialog);
  });

  return { launcher, video, getClaimButtons: () => claimButtons };
}

function installChannelPointsSurface(): {
  panel: HTMLDivElement;
  launcher: HTMLButtonElement;
  submit: HTMLButtonElement;
} {
  const panel = document.createElement('div');
  panel.id = 'rewards-panel';
  panel.innerHTML = `
    <button data-testid="channel-points-button">1,000 points</button>
    <form><button type="submit">Redeem</button></form>
    <button type="button"><video src="${DAILY_REWARD_CTA_SRC}"></button>
  `;
  document.body.append(panel);
  return {
    panel,
    launcher: panel.querySelector('[data-testid="channel-points-button"]') as HTMLButtonElement,
    submit: panel.querySelector('button[type="submit"]') as HTMLButtonElement,
  };
}

function installDropsSurface(): { panel: HTMLDivElement; claim: HTMLButtonElement } {
  const panel = document.createElement('div');
  panel.id = 'drops-panel';
  panel.innerHTML = `
    <button type="button"><video src="${DAILY_REWARD_CTA_SRC}"></button>
    <button type="button">Drops claim</button>
  `;
  document.body.append(panel);
  return { panel, claim: panel.querySelectorAll('button')[1] as HTMLButtonElement };
}

async function flushMutationObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Daily reward auto-claim controller', () => {
  let lifecycle: Lifecycle;

  beforeEach(() => {
    document.body.replaceChildren();
    setFeatureFlag('autoClaimDailyReward', true);
    lifecycle = new Lifecycle();
  });

  afterEach(() => {
    lifecycle.dispose();
    setFeatureFlag('autoClaimDailyReward', false);
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Observed live on 2026-08-02: Kick keeps the cookie-consent SDK's own role="dialog" mounted on the
  // page. A "newly appeared dialog" rule alone would hand it the claim click.
  it('ignores an unrelated dialog that mounts alongside the reward window', () => {
    const fixture = installRewardFixture();
    const stranger = document.createElement('div');
    stranger.setAttribute('role', 'dialog');
    stranger.setAttribute('aria-label', 'Your Privacy Choices');
    stranger.innerHTML = '<button id="accept-recommended-btn-handler">Allow All</button>';
    const strangerClick = vi.spyOn(stranger.querySelector('button') as HTMLButtonElement, 'click');
    fixture.launcher.addEventListener('click', () => {
      if (!stranger.isConnected) document.body.append(stranger);
    }, { once: true });

    new DailyRewardAutoClaimController(lifecycle);

    expect(strangerClick).not.toHaveBeenCalled();
    const claimed = fixture.getClaimButtons();
    expect(claimed).toHaveLength(1);
  });

  it('does nothing when the CTA is absent and schedules no dialog wait', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    new DailyRewardAutoClaimController(lifecycle);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('does nothing while the flag is off, including no observer or timer', () => {
    setFeatureFlag('autoClaimDailyReward', false);
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const fixture = installRewardFixture();
    const launcherClick = vi.spyOn(fixture.launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);

    expect(observeSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(launcherClick).not.toHaveBeenCalled();
  });

  it('opens, clicks the enabled claim button, then closes the opened dialog in order', () => {
    const fixture = installRewardFixture();
    const order: string[] = [];
    const clickOrderListener = (event: Event): void => {
      if (event.target === fixture.launcher) order.push('launcher');
      if (event.target === fixture.getClaimButtons()[0]) order.push('claim');
    };
    document.addEventListener('click', clickOrderListener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      const claimButton = fixture.getClaimButtons()[0];
      expect(order).toEqual(['launcher', 'claim', 'launcher']);
      expect(claimButton).toBeDefined();
      expect(claimButton.disabled).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      document.removeEventListener('click', clickOrderListener, true);
    }
  });

  it('does not click a disabled final claim button and closes the dialog', () => {
    const fixture = installRewardFixture(true);
    const launcherClick = vi.spyOn(fixture.launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);

    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');
    expect(claimClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(launcherClick).toHaveBeenCalledTimes(2);
  });

  it('gives up after a dialog never mounts without a retry loop', () => {
    vi.useFakeTimers();
    const fixture = installRewardFixture();
    // Prevent the reconstructed trigger from mounting a dialog for this failure fixture.
    fixture.launcher.replaceWith(fixture.launcher.cloneNode(true));
    const launcher = document.querySelector<HTMLButtonElement>('nav button[aria-label]')!;
    const launcherClick = vi.spyOn(launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);
    vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS * 2);

    expect(launcherClick).toHaveBeenCalledTimes(1);
  });

  it('allows only one attempt while the same CTA remains present, even after a re-render', async () => {
    const fixture = installRewardFixture();
    const launcherClick = vi.spyOn(fixture.launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);
    const firstClaim = fixture.getClaimButtons()[0];
    await flushMutationObserver();
    fixture.launcher.append(document.createElement('span'));
    await flushMutationObserver();

    expect(firstClaim).toBeDefined();
    expect(fixture.getClaimButtons()).toHaveLength(1);
    expect(launcherClick).toHaveBeenCalledTimes(2);
  });

  it('allows a new attempt only after the CTA disappears and appears again', async () => {
    const fixture = installRewardFixture();
    const launcherClick = vi.spyOn(fixture.launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);
    fixture.video.remove();
    await flushMutationObserver();
    const replacement = document.createElement('video');
    replacement.src = DAILY_REWARD_CTA_SRC;
    fixture.launcher.append(replacement);
    await flushMutationObserver();

    expect(fixture.getClaimButtons()).toHaveLength(2);
    expect(launcherClick).toHaveBeenCalledTimes(4);
  });

  it('never touches channel points or Drops surfaces in the same document', () => {
    const points = installChannelPointsSurface();
    const drops = installDropsSurface();
    const pointsLauncherClick = vi.spyOn(points.launcher, 'click');
    const pointsSubmitClick = vi.spyOn(points.submit, 'click');
    const dropsClaimClick = vi.spyOn(drops.claim, 'click');
    const reward = installRewardFixture();

    new DailyRewardAutoClaimController(lifecycle);

    expect(reward.getClaimButtons()[0]).toBeDefined();
    expect(pointsLauncherClick).not.toHaveBeenCalled();
    expect(pointsSubmitClick).not.toHaveBeenCalled();
    expect(dropsClaimClick).not.toHaveBeenCalled();
  });

  it('teardown disconnects observation and prevents later clicks', async () => {
    const fixture = installRewardFixture();
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const launcherClick = vi.spyOn(fixture.launcher, 'click');

    new DailyRewardAutoClaimController(lifecycle);
    const callsBeforeDispose = launcherClick.mock.calls.length;
    lifecycle.dispose();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    fixture.video.remove();
    await flushMutationObserver();
    const replacement = document.createElement('video');
    replacement.src = DAILY_REWARD_CTA_SRC;
    fixture.launcher.append(replacement);
    await flushMutationObserver();

    expect(launcherClick).toHaveBeenCalledTimes(callsBeforeDispose);
  });
});
