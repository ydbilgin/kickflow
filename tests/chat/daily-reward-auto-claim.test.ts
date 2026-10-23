import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DailyRewardAutoClaimController,
} from '../../src/content/daily-reward-auto-claim';
import { featureFlags, setFeatureFlag } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { logger } from '../../src/content/shared/logger';

const DAILY_REWARD_CTA_SRC = 'https://static.kick.com/rewards/reward-available-CTA.webm';
const DIALOG_WAIT_TIMEOUT_MS = 6_000;
const CLAIM_WAIT_TIMEOUT_MS = 6_000;

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
  claimButton.className = 'w-full bg-brand-bg-default';
  claimButton.textContent = 'Claim';
  claimButton.disabled = disabled;
  // Model Kick acknowledging the click; success now waits for a state/label change.
  claimButton.addEventListener('click', () => { claimButton.textContent = 'Claimed'; });
  footer.append(claimButton);
  content.append(stageShell, footer);
  modalWrapper.append(content);
  dialog.append(modalWrapper);
  return { dialog, claimButton };
}

/** A foreign dialog shaped exactly like the old selector wanted: a new `role="dialog"` holding a
 * `button.w-full`. Only the reward modal's StageShell (round 81 recon, CONFIRMED in the bundle) is
 * missing. This is the K2 counter-example: under the old rule it was indistinguishable. */
function createForeignFullWidthDialog(): { dialog: HTMLDivElement; button: HTMLButtonElement } {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.dataset.state = 'open';
  dialog.setAttribute('aria-label', 'Your Privacy Choices');
  const footer = document.createElement('div');
  footer.className = 'flex w-full flex-col items-center gap-2';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'w-full';
  button.textContent = 'Allow All';
  footer.append(button);
  dialog.append(footer);
  return { dialog, button };
}

interface RewardFixtureOptions {
  /** Runs inside the launcher click BEFORE the reward dialog mounts. */
  beforeRewardMount?: () => void;
  /** Runs inside the launcher click AFTER the reward dialog mounts. */
  afterRewardMount?: () => void;
}

function installRewardFixture(disabled = false, options: RewardFixtureOptions = {}): RewardFixture {
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
    options.beforeRewardMount?.();
    const fixture = createClaimDialog(disabled);
    claimButtons.push(fixture.claimButton);
    openDialog = fixture.dialog;
    document.body.append(openDialog);
    options.afterRewardMount?.();
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

/** Header CTA with no dialog listener, so a click gives up on the dialog wait. */
function installSilentDailyRewardCta(): { launcher: HTMLButtonElement; video: HTMLVideoElement } {
  const launcher = document.createElement('button');
  launcher.type = 'button';
  const video = document.createElement('video');
  video.src = DAILY_REWARD_CTA_SRC;
  launcher.append(video);
  document.body.append(launcher);
  return { launcher, video };
}

async function flushMutationObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function installOctoberReward(options: {
  stages?: number;
  controlled?: boolean;
  disabled?: boolean;
  /** 'replace' models Kick's 2026-10-20 bundle: the click disables the button at once (request in
   * flight), and success replaces it with a View link. 'pending' disables it and never answers. */
  acknowledge?: 'replace' | 'pending' | 'label' | 'none';
  recognized?: boolean;
} = {}) {
  const { launcher } = installSilentDailyRewardCta();
  const template = document.createElement('template');
  template.innerHTML = readFileSync(resolve('tests/fixtures/daily-reward-2026-10.html'), 'utf8');
  const dialog = template.content.querySelector<HTMLElement>('[role="dialog"]')!;
  dialog.id = 'fixture-reward-dialog'; // Synthetic Radix runtime id, not a site hook.
  if (options.controlled) launcher.setAttribute('aria-controls', dialog.id);
  const stage = dialog.querySelector<HTMLElement>('[class~="aspect-1348/1080"]')!;
  const card = stage.closest('section')!;
  for (let index = 1; index < (options.stages ?? 1); index += 1) card.after(card.cloneNode(true));
  if (options.recognized === false) stage.remove();
  const button = dialog.querySelector<HTMLButtonElement>('button.w-full')!;
  button.disabled = options.disabled ?? false;
  const acknowledge = options.acknowledge ?? 'replace';
  const claim = vi.fn(() => {
    if (acknowledge === 'replace' || acknowledge === 'pending') button.disabled = true;
    if (acknowledge === 'replace') {
      const view = document.createElement('a');
      view.textContent = 'View';
      button.replaceWith(view);
    }
    if (acknowledge === 'label') button.textContent = 'Claimed';
  });
  button.addEventListener('click', claim);
  const close = dialog.querySelector<HTMLButtonElement>('button.size-9')!;
  close.addEventListener('click', () => dialog.remove());
  launcher.addEventListener('click', () => {
    if (dialog.isConnected) dialog.remove();
    else document.body.append(dialog);
  });
  return { launcher, dialog, button, claim, close, stage };
}

describe('Daily reward auto-claim controller', () => {
  let lifecycle: Lifecycle;
  let previousHref = '';

  beforeEach(() => {
    previousHref = window.location.href;
    document.body.replaceChildren();
    setFeatureFlag('autoClaimDailyReward', true);
    lifecycle = new Lifecycle();
  });

  afterEach(() => {
    lifecycle.dispose();
    setFeatureFlag('autoClaimDailyReward', false);
    document.body.replaceChildren();
    window.history.replaceState({}, '', previousHref);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Round 2 bundle safety', () => {
    it.each(['Talep et', 'Claim', 'Obtenir', 'Büyük ödülü al', 'Ödülünü al'])('accepts a typeless video-stage primary-base action labelled %s', (label) => {
      const fixture = installOctoberReward();
      fixture.button.textContent = label;
      expect(fixture.button.hasAttribute('type')).toBe(false);
      expect(fixture.button.type).toBe('submit');
      expect(fixture.button.classList.contains('bg-primary-base')).toBe(true);
      expect(fixture.stage.closest('section')).not.toBeNull();
      expect(fixture.stage.querySelector('video')).not.toBeNull();
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it.each(['Satın al', 'SATIN AL', 'Satın Al şimdi', 'Buy', 'Buy now', 'Purchase', 'Abone ol',
      'Subscribe', 'Subscription', 'Hediye', 'Hediye gönder', 'Gift', 'Gift a sub', 'Gifting',
      'Takip et', 'Follow', 'Donate', 'Bağış yap', 'Satın alın', 'Şimdi satın alın',
      'Abonelik başlat', 'Aboneliğini yenile', 'Hediyeler', 'Takibe al', 'Gifted sub',
      'Resubscribe', 'Buying', 'Tipping', 'Following', 'Donation'])('refuses the lone primary button labelled %s', (label) => {
      vi.useFakeTimers();
      const fixture = installOctoberReward();
      fixture.button.textContent = label;
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('vetoes a purchase accessible label even when the visible label says Claim', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward();
      fixture.button.setAttribute('aria-label', 'Buy now');
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it('rechecks a purchase label changed immediately before the claim click', () => {
      const fixture = installOctoberReward();
      vi.spyOn(logger, 'info').mockImplementation((message) => {
        if (message === 'daily-reward-auto-claim: clicking the enabled Kick claim button') {
          fixture.button.textContent = 'Satın al';
        }
      });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it.each(['role-dialog', 'role-alertdialog', 'native-dialog'])('refuses nested %s before or during the disabled phase', async (kind) => {
      const fixture = installOctoberReward({ disabled: true });
      const nested = document.createElement(kind === 'native-dialog' ? 'dialog' : 'div');
      if (kind !== 'native-dialog') nested.setAttribute('role', kind === 'role-dialog' ? 'dialog' : 'alertdialog');
      new DailyRewardAutoClaimController(lifecycle);
      fixture.dialog.append(nested);
      fixture.button.disabled = false;
      await flushMutationObserver();
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it.each(['role-alertdialog', 'native-dialog'])('refuses a reward inside a parent %s', (kind) => {
      vi.useFakeTimers();
      const fixture = installOctoberReward();
      const parent = document.createElement(kind === 'native-dialog' ? 'dialog' : 'div');
      if (kind === 'role-alertdialog') parent.setAttribute('role', 'alertdialog');
      fixture.launcher.addEventListener('click', () => {
        if (fixture.dialog.isConnected) {
          document.body.append(parent);
          parent.append(fixture.dialog);
        }
      });
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it.each(['rewards-panel', 'drops-panel'])('refuses a stage or claim within #%s', (id) => {
      vi.useFakeTimers();
      const fixture = installOctoberReward();
      fixture.stage.id = id;
      fixture.button.parentElement!.id = id;
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it.each(['submit', 'reset', 'form'])('refuses an explicit %s control context', (kind) => {
      vi.useFakeTimers();
      const fixture = installOctoberReward();
      if (kind === 'form') {
        const form = document.createElement('form');
        fixture.button.replaceWith(form);
        form.append(fixture.button);
      } else fixture.button.type = kind as 'submit' | 'reset';
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it('claims the legacy bracketed stage without an explicit button type', () => {
      const fixture = installRewardFixture(false, {
        afterRewardMount: () => fixture.getClaimButtons()[0].removeAttribute('type'),
      });
      const click = vi.fn();
      fixture.launcher.addEventListener('click', () => {
        fixture.getClaimButtons()[0]?.addEventListener('click', click);
      }, { once: true });
      new DailyRewardAutoClaimController(lifecycle);
      expect(click).toHaveBeenCalledTimes(1);
    });

    it('uses class and disabled mutations, without observing inline style or calling an endpoint', async () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const fetch = vi.spyOn(globalThis, 'fetch');
      const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
      const fixture = installOctoberReward({ disabled: true });
      new DailyRewardAutoClaimController(lifecycle);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.calls[0][1]?.attributeFilter).not.toContain('style');
      fixture.button.disabled = false;
      await flushMutationObserver();
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(xhr).not.toHaveBeenCalled();
    });
  });

  describe('Round 2 structural diagnostics', () => {
    it.each(['aspect-1348/1080', 'aspect-[1348/1080]'])('preserves %s, primary-base, video, section and missing type without text', async (aspect) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const set = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', { runtime: { id: 'fixture-extension' }, storage: { local: { set } } });
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fixture = installOctoberReward({ disabled: true });
      fixture.stage.classList.replace('aspect-1348/1080', aspect);
      fixture.dialog.classList.add('user-PRIVATE-CLASS', 'bg-[url(PRIVATE-URL)]');
      fixture.dialog.setAttribute('aria-label', 'PRIVATE-LABEL');
      fixture.dialog.id = 'PRIVATE-ID';
      fixture.button.textContent = 'PRIVATE-TEXT';
      fixture.stage.querySelector('video')!.src = 'https://example.invalid/PRIVATE-VIDEO';
      const input = document.createElement('input');
      input.value = 'PRIVATE-INPUT';
      const custom = document.createElement('private-custom-element');
      custom.setAttribute('role', 'PRIVATE-ROLE');
      fixture.dialog.prepend(input, custom);
      // More than the entire element budget before the stage/footer in document order.
      const icons = document.createElement('div');
      for (let n = 0; n < 100; n++) icons.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      fixture.dialog.prepend(icons);

      const controller = new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(CLAIM_WAIT_TIMEOUT_MS);
      await flushMutationObserver();
      expect(set).toHaveBeenCalledTimes(1);
      const saved = set.mock.calls[0][0];
      const snapshot = saved.kf_diag_dailyReward;
      expect(Object.keys(saved)).toEqual(['kf_diag_dailyReward']);
      expect(snapshot).toContain(aspect);
      expect(snapshot).toContain('video class=absolute object-contain');
      expect(snapshot).toContain('button type=missing class=bg-primary-base w-full');
      expect(snapshot).not.toMatch(/PRIVATE|private-custom|Daily Reward|Claim|Streak|https:/);
      expect(snapshot.trim().split('\n').length).toBeLessThanOrEqual(60);
      expect(new TextEncoder().encode(JSON.stringify(saved)).length).toBeLessThanOrEqual(2_048);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      // A later appearance refreshes the snapshot without another warning.
      const video = fixture.launcher.querySelector('video')!;
      video.remove();
      await flushMutationObserver();
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      fixture.launcher.append(video);
      await flushMutationObserver();
      vi.advanceTimersByTime(CLAIM_WAIT_TIMEOUT_MS);
      expect(set).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      controller.syncFlag();
    });

    it.each(['submit', 'button', 'reset', 'PRIVATE-TYPE'])('records a filtered explicit button type %s', (type) => {
      vi.useFakeTimers();
      const set = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', { runtime: { id: 'fixture-extension' }, storage: { local: { set } } });
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fixture = installOctoberReward({ disabled: true });
      fixture.button.setAttribute('type', type);
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      const snapshot = set.mock.calls[0][0].kf_diag_dailyReward;
      expect(snapshot).toContain(`button type=${type === 'PRIVATE-TYPE' ? 'other' : type}`);
      expect(snapshot).not.toContain('PRIVATE-TYPE');
    });

    it('keeps section structure and typeless button evidence when the stage is unrecognized', () => {
      vi.useFakeTimers();
      const set = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', { runtime: { id: 'fixture-extension' }, storage: { local: { set } } });
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fixture = installOctoberReward({ recognized: false });
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      const snapshot = set.mock.calls[0][0].kf_diag_dailyReward;
      expect(snapshot).toContain('section class=flex w-full flex-col items-center gap-4 rounded-lg bg-surface-bg-highest p-4');
      expect(snapshot).toContain('button type=missing class=bg-primary-base w-full');
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it.each(['rejected', 'unavailable'])('survives %s diagnostic storage without another warning', async (kind) => {
      vi.useFakeTimers();
      const set = vi.fn().mockRejectedValue(new Error('storage unavailable'));
      vi.stubGlobal('chrome', kind === 'unavailable' ? undefined
        : { runtime: { id: 'fixture-extension' }, storage: { local: { set } } });
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      installSilentDailyRewardCta();
      new DailyRewardAutoClaimController(lifecycle);
      expect(() => vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS)).not.toThrow();
      await flushMutationObserver();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(kind === 'unavailable' ? 0 : 1);
    });

    it('does not write a give-up diagnostic when the native claim is acknowledged', () => {
      const set = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', { runtime: { id: 'fixture-extension' }, storage: { local: { set } } });
      installOctoberReward();
      new DailyRewardAutoClaimController(lifecycle);
      expect(set).not.toHaveBeenCalled();
    });
  });

  describe('2026-10 regression', () => {
    it.each([false, true])('claims the INFERRED current fixture once and closes (aria-controls=%s)', (controlled) => {
      const fixture = installOctoberReward({ controlled });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('claims once with several carousel stages inside the same dialog', () => {
      const fixture = installOctoberReward({ stages: 6 });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('ignores inactive portal footers even when their enabled buttons come last', () => {
      const fixture = installOctoberReward({ stages: 3 });
      const hidden = fixture.button.parentElement!.parentElement!.cloneNode(true) as HTMLElement;
      hidden.hidden = true;
      fixture.button.parentElement!.parentElement!.after(hidden);
      const hiddenClick = vi.spyOn(hidden.querySelector('button')!, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(hiddenClick).not.toHaveBeenCalled();
    });

    it('uses the launcher identity when another reward-shaped dialog appears', () => {
      const fixture = installOctoberReward({ controlled: true });
      const other = fixture.dialog.cloneNode(true) as HTMLElement;
      other.id = 'fixture-unrelated-dialog';
      const otherClick = vi.spyOn(other.querySelector('button.w-full')!, 'click');
      fixture.launcher.addEventListener('click', () => {
        if (!other.isConnected) document.body.append(other);
      }, { once: true });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(otherClick).not.toHaveBeenCalled();
      expect(other.isConnected).toBe(true);
    });

    it('does not fall back to an unrelated dialog when aria-controls names a missing id', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ controlled: true });
      fixture.launcher.setAttribute('aria-controls', 'fixture-missing');
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(true);
    });

    it('leaves a foreign Close control untouched when the linked window never mounts', () => {
      vi.useFakeTimers();
      const { launcher } = installSilentDailyRewardCta();
      launcher.setAttribute('aria-controls', 'fixture-missing-window');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.id = 'fixture-foreign-window';
      dialog.innerHTML = '<button><span class="sr-only">Close</span></button>';
      const close = vi.fn(() => dialog.remove());
      dialog.querySelector('button')!.addEventListener('click', close);
      launcher.addEventListener('click', () => document.body.append(dialog), { once: true });
      const launch = vi.spyOn(launcher, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(launch).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      expect(dialog.isConnected).toBe(true);
    });

    it('closes the linked unrecognized window after its stage is removed', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ controlled: true, recognized: false });
      const launch = vi.spyOn(fixture.launcher, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.dialog.isConnected).toBe(true);
      vi.advanceTimersByTime(DIALOG_WAIT_TIMEOUT_MS);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(launch).toHaveBeenCalledTimes(2);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('reports only shape once and closes an unrecognised new dialog on timeout', () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fixture = installOctoberReward({ recognized: false });
      fixture.dialog.className = 'shape-one shape-two private-third-token';
      fixture.button.textContent = 'PRIVATE TEXT MUST NOT BE LOGGED';
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'daily-reward-auto-claim: giving up for this CTA appearance:',
        'dialog did not mount before the bounded wait ended',
        '',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-third-token');
      vi.advanceTimersByTime(60_000);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('waits for a disabled claim phase, then clicks exactly once', async () => {
      const fixture = installOctoberReward({ disabled: true });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).not.toHaveBeenCalled();
      fixture.button.disabled = false;
      await flushMutationObserver();
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it.each(['replace', 'label'] as const)('logs claimed only after the %s acknowledgement', async (signal) => {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const fixture = installOctoberReward({ acknowledge: 'none' });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(true);
      expect(info).not.toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      if (signal === 'replace') fixture.button.replaceWith(document.createElement('a'));
      else fixture.button.firstChild!.textContent = 'Claimed';
      await flushMutationObserver();
      expect(info).toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    // Owner 2026-10-20 ("günlük ödülü hala almıyor"). Kick's current bundle disables the button while its
    // claim request is in flight. Closing then unmounted the window before Kick's success handler ran, so
    // the navbar chest stayed "unclaimed". The window must stay open until Kick answers.
    it('keeps the window open while the claim request is in flight, and closes after Kick shows View', async () => {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const fixture = installOctoberReward({ acknowledge: 'pending' });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.button.disabled).toBe(true);
      await flushMutationObserver();
      expect(fixture.dialog.isConnected).toBe(true);
      expect(info).not.toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      const view = document.createElement('a');
      view.textContent = 'View';
      fixture.button.replaceWith(view);
      await flushMutationObserver();
      expect(info).toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      expect(fixture.dialog.isConnected).toBe(false);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
    });

    it('gives up without claiming success when Kick re-enables the button after its request', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const fixture = installOctoberReward({ acknowledge: 'pending' });
      new DailyRewardAutoClaimController(lifecycle);
      await flushMutationObserver();
      expect(fixture.dialog.isConnected).toBe(true);
      fixture.button.disabled = false;
      await flushMutationObserver();
      expect(info).not.toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      expect(warn).toHaveBeenCalledWith('daily-reward-auto-claim: giving up for this CTA appearance:',
        'Kick re-enabled the claim button without confirming the claim', '');
      expect(fixture.dialog.isConnected).toBe(false);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
    });

    it('bounds a click without acknowledgement and closes without claiming success', () => {
      vi.useFakeTimers();
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const fixture = installOctoberReward({ acknowledge: 'pending' });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(29_000);
      expect(fixture.dialog.isConnected).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(fixture.dialog.isConnected).toBe(false);
      expect(info).not.toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
      expect(fixture.claim).toHaveBeenCalledTimes(1);
    });

    it.each(['flag off', 'dispose', 'Drops navigation'] as const)('closes an opened window on %s', (exit) => {
      const fixture = installOctoberReward({ disabled: true });
      const controller = new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.dialog.isConnected).toBe(true);
      if (exit === 'flag off') {
        setFeatureFlag('autoClaimDailyReward', false);
        controller.syncFlag();
      } else if (exit === 'dispose') lifecycle.dispose();
      else {
        window.history.replaceState({}, '', '/drops/claimed');
        window.dispatchEvent(new Event('kickflow:locationchange'));
      }
      expect(fixture.dialog.isConnected).toBe(false);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it('uses the dialog close button if the opening launcher disappears', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ recognized: false });
      fixture.launcher.addEventListener('click', () => fixture.launcher.remove());
      const close = vi.spyOn(fixture.close, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(close).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it('preserves the pre-existing cookie dialog while claiming the current fixture', () => {
      const cookie = createForeignFullWidthDialog();
      document.body.append(cookie.dialog);
      const click = vi.spyOn(cookie.button, 'click');
      const fixture = installOctoberReward();
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(cookie.dialog.isConnected).toBe(true);
      expect(click).not.toHaveBeenCalled();
    });
  });

  describe('2026-10 identity boundaries', () => {
    it('uses media inside the source-proven stage shell when the aspect utility changes', () => {
      const fixture = installOctoberReward();
      fixture.stage.classList.remove('aspect-1348/1080');
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).toHaveBeenCalledTimes(1);
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('does not treat an arbitrary dialog image as a reward stage', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ recognized: false });
      fixture.dialog.prepend(document.createElement('img'));
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it.each(['rewards-panel', 'drops-panel'])('never follows launcher linkage into #%s', (id) => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ controlled: true });
      fixture.dialog.id = id;
      fixture.launcher.setAttribute('aria-controls', id);
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(fixture.claim).not.toHaveBeenCalled();
    });

    it('refuses two new reward dialogs and closes both through native controls', () => {
      const fixture = installOctoberReward();
      const twin = fixture.dialog.cloneNode(true) as HTMLElement;
      twin.id = 'fixture-twin';
      const twinButton = vi.spyOn(twin.querySelector('button.w-full')!, 'click');
      const twinClose = twin.querySelector<HTMLButtonElement>('button.size-9')!;
      twinClose.addEventListener('click', () => twin.remove());
      fixture.launcher.addEventListener('click', () => document.body.append(twin), { once: true });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(twinButton).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
      expect(twin.isConnected).toBe(false);
    });

    it('rechecks changed aria-controls before the claim button click', () => {
      const fixture = installOctoberReward({ controlled: true });
      vi.spyOn(logger, 'info').mockImplementation((message) => {
        if (message === 'daily-reward-auto-claim: clicking the enabled Kick claim button') {
          fixture.launcher.setAttribute('aria-controls', 'fixture-wrong-dialog');
        }
      });
      new DailyRewardAutoClaimController(lifecycle);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('does not skip a final disabled primary button to click an earlier one', () => {
      vi.useFakeTimers();
      const fixture = installOctoberReward({ disabled: true });
      const earlier = fixture.button.cloneNode(true) as HTMLButtonElement;
      earlier.disabled = false;
      fixture.button.before(earlier);
      const earlierClick = vi.spyOn(earlier, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(earlierClick).not.toHaveBeenCalled();
      expect(fixture.dialog.isConnected).toBe(false);
    });

    it('closes when a claim click throws without logging claimed or sending Escape', () => {
      const fixture = installOctoberReward();
      vi.spyOn(fixture.button, 'click').mockImplementation(() => { throw new Error('fixture click failed'); });
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const key = vi.fn();
      document.addEventListener('keydown', key);
      try {
        new DailyRewardAutoClaimController(lifecycle);
        expect(fixture.dialog.isConnected).toBe(false);
        expect(info).not.toHaveBeenCalledWith('daily-reward-auto-claim: claimed');
        expect(key).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', key);
      }
    });

    it('records passive modal counts without clicking any control', async () => {
      const fixture = installOctoberReward({ stages: 3, disabled: true });
      new DailyRewardAutoClaimController(lifecycle);
      const { collectKickAnchorEvidence } = await import('../playwright/kick-anchor-checks.mjs');
      const evidence = collectKickAnchorEvidence({ anchors: {} });
      expect(evidence.navbar.dailyRewardDialogCount).toBe(1);
      expect(evidence.navbar.dailyRewardDialogs).toEqual([
        { stages: 3, stageMedia: 3, fullWidthButtons: 1, classes: ['flex', 'flex-col'] },
      ]);
      expect(fixture.claim).not.toHaveBeenCalled();
    });
  });

  // Observed live on 2026-08-02: Kick keeps the cookie-consent SDK's own role="dialog" mounted on the
  // page. K2 (2026-09-29 review): the old guard test mounted the stranger AFTER the reward window and
  // without a full-width button, so it stayed green with the guard deleted. The stranger here has
  // the old selector's exact shape and mounts in BOTH orders; its click count must always be zero.
  it.each([
    ['before', 'beforeRewardMount'],
    ['after', 'afterRewardMount'],
  ] as const)('never clicks a full-width button in a foreign dialog that mounts %s the reward window', (_order, hook) => {
    const stranger = createForeignFullWidthDialog();
    const strangerClick = vi.spyOn(stranger.button, 'click');
    const fixture = installRewardFixture(false, {
      [hook]: () => { if (!stranger.dialog.isConnected) document.body.append(stranger.dialog); },
    });
    const rewardClicks: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) rewardClicks.push(event.target!);
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      expect(stranger.dialog.isConnected).toBe(true);
      expect(strangerClick).not.toHaveBeenCalled();
      expect(rewardClicks).toHaveLength(1);
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('stops without clicking when only a foreign full-width dialog opens (zero reward candidates)', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fixture = installRewardFixture();
    // Replace the reconstructed trigger so it opens ONLY the stranger.
    const launcher = fixture.launcher.cloneNode(true) as HTMLButtonElement;
    fixture.launcher.replaceWith(launcher);
    const stranger = createForeignFullWidthDialog();
    const strangerClick = vi.spyOn(stranger.button, 'click');
    launcher.addEventListener('click', () => {
      if (!stranger.dialog.isConnected) document.body.append(stranger.dialog);
    });

    new DailyRewardAutoClaimController(lifecycle);
    vi.advanceTimersByTime(6_000 * 2);

    expect(strangerClick).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'daily-reward-auto-claim: giving up for this CTA appearance:',
      'dialog did not mount before the bounded wait ended',
        '',
    );
  });

  it('stops and reports, clicking nothing, when several reward-shaped dialogs open at once', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const twin = createClaimDialog(false);
    const twinClick = vi.spyOn(twin.claimButton, 'click');
    const fixture = installRewardFixture(false, {
      beforeRewardMount: () => { if (!twin.dialog.isConnected) document.body.append(twin.dialog); },
    });
    const rewardClicks: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) rewardClicks.push(event.target!);
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      expect(twinClick).not.toHaveBeenCalled();
      expect(rewardClicks).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        'daily-reward-auto-claim: giving up for this CTA appearance:',
        expect.stringContaining('several daily-reward dialogs'),
        '',
      );
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('stops without clicking when a second reward-shaped dialog appears while the claim button is still disabled', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fixture = installRewardFixture(true);
    new DailyRewardAutoClaimController(lifecycle);
    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');

    const twin = createClaimDialog(false);
    const twinClick = vi.spyOn(twin.claimButton, 'click');
    document.body.append(twin.dialog);
    claimButton.disabled = false;
    await flushMutationObserver();

    expect(claimClick).not.toHaveBeenCalled();
    expect(twinClick).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'daily-reward-auto-claim: giving up for this CTA appearance:',
      expect.stringContaining('no longer the single daily-reward dialog'),
      '',
    );
  });

  it('stops without clicking when the chosen dialog loses its reward identity before the button enables', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fixture = installRewardFixture(true);
    new DailyRewardAutoClaimController(lifecycle);
    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');
    const dialog = claimButton.closest('[role="dialog"]')!;

    dialog.querySelector('[class*="aspect-[1348/1080]"]')!.remove();
    claimButton.disabled = false;
    await flushMutationObserver();

    expect(claimClick).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'daily-reward-auto-claim: giving up for this CTA appearance:',
      expect.stringContaining('no longer the single daily-reward dialog'),
      '',
    );
  });

  it('re-checks identity right before the click and stops if the dialog changed in between', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fixture = installRewardFixture();
    // The last thing the controller does before the click is announce it. Mutating the DOM inside
    // that call is the narrowest window between the decision and the click a test can reach.
    vi.spyOn(logger, 'info').mockImplementation((message: unknown) => {
      if (message !== 'daily-reward-auto-claim: clicking the enabled Kick claim button') return;
      const dialog = fixture.getClaimButtons()[0]?.closest('[role="dialog"]');
      dialog?.querySelector('[class*="aspect-[1348/1080]"]')?.remove();
    });
    const rewardClicks: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) rewardClicks.push(event.target!);
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      expect(fixture.getClaimButtons()).toHaveLength(1);
      expect(rewardClicks).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        'daily-reward-auto-claim: giving up for this CTA appearance:',
        expect.stringContaining('changed right before the click'),
        '',
      );
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  // A borrowed stage class alone is not identity: require the source-proven primary control.
  it('never clicks a foreign dialog that borrows the StageShell class without a primary control', () => {
    vi.useFakeTimers();
    const fixture = installRewardFixture();
    const launcher = fixture.launcher.cloneNode(true) as HTMLButtonElement;
    fixture.launcher.replaceWith(launcher);
    const foreign = createForeignFullWidthDialog();
    const stage = document.createElement('div');
    stage.className = 'relative aspect-[1348/1080] w-full';
    foreign.dialog.prepend(stage);
    const foreignClick = vi.spyOn(foreign.button, 'click');
    launcher.addEventListener('click', () => {
      if (!foreign.dialog.isConnected) document.body.append(foreign.dialog);
    });

    new DailyRewardAutoClaimController(lifecycle);
    vi.advanceTimersByTime(6_000 * 2);

    expect(foreignClick).not.toHaveBeenCalled();
  });

  it('ignores a StageShell elsewhere in the document when claiming inside the opened dialog', () => {
    const promo = document.createElement('div');
    promo.className = 'bg-surface-higher relative aspect-[1348/1080] w-full';
    document.body.append(promo);
    const fixture = installRewardFixture();
    const rewardClicks: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) rewardClicks.push(event.target!);
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      expect(rewardClicks).toHaveLength(1);
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  // Fix round 1 (cx review F2): a dialog nested inside the reward dialog must never lend its
  // full-width button to the claim, wherever it sits; a nested dialog is doubt, so nothing is clicked.
  it.each([
    ['at the dialog root', (dialog: Element) => dialog],
    ['inside the claim footer, after the claim button', (dialog: Element) => dialog.querySelector('button.w-full')!.parentElement!],
  ] as const)('never clicks when a foreign dialog is nested %s', (_where, host) => {
    vi.useFakeTimers();
    const foreign = createForeignFullWidthDialog();
    const foreignClick = vi.spyOn(foreign.button, 'click');
    const fixture = installRewardFixture(false, {
      afterRewardMount: () => {
        const reward = fixture.getClaimButtons()[0]!.closest('[role="dialog"]')!;
        host(reward).append(foreign.dialog);
      },
    });
    const rewardClicks: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) rewardClicks.push(event.target!);
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);
      vi.advanceTimersByTime(6_000 * 2);

      expect(foreignClick).not.toHaveBeenCalled();
      expect(rewardClicks).toHaveLength(0);
      expect(fixture.getClaimButtons()).toHaveLength(1);
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('stops without clicking when a foreign dialog nests into the chosen dialog while the button is disabled', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fixture = installRewardFixture(true);
    new DailyRewardAutoClaimController(lifecycle);
    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');
    const foreign = createForeignFullWidthDialog();
    const foreignClick = vi.spyOn(foreign.button, 'click');

    claimButton.parentElement!.append(foreign.dialog);
    claimButton.disabled = false;
    await flushMutationObserver();

    expect(claimClick).not.toHaveBeenCalled();
    expect(foreignClick).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'daily-reward-auto-claim: giving up for this CTA appearance:',
      expect.stringContaining('no longer the single daily-reward dialog'),
      '',
    );
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

  it('still claims when Kick drops the navbar CTA as the reward window opens', () => {
    // Live 2026-08-04: every attempt died on "the claimable CTA disappeared before the claim step".
    // Kick removes the CTA from the navbar the moment its window opens, so the CTA can only be a
    // precondition for OPENING the window — never for claiming inside it.
    const fixture = installRewardFixture();
    fixture.launcher.addEventListener('click', () => fixture.video.remove(), { once: true });
    const clicked: string[] = [];
    const listener = (event: Event): void => {
      if (event.target === fixture.launcher) clicked.push('launcher');
      if (event.target === fixture.getClaimButtons()[0]) clicked.push('claim');
    };
    document.addEventListener('click', listener, true);

    try {
      new DailyRewardAutoClaimController(lifecycle);

      expect(fixture.video.isConnected).toBe(false);
      expect(clicked).toEqual(['launcher', 'claim', 'launcher']);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('waits out a claim button that mounts disabled, then clicks it once Kick enables it', () => {
    // The owner's real reward, 2026-08-06: Kick mounts the window with its claim button disabled
    // and enables it a moment later. Treating that first reading as a verdict gave up every time.
    const fixture = installRewardFixture(true);
    new DailyRewardAutoClaimController(lifecycle);

    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');
    expect(claimClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); // attempt still alive

    claimButton.disabled = false;
    claimButton.dispatchEvent(new Event('kickflow-noop')); // observers key off the attribute below
    document.body.appendChild(document.createComment('mutation'));

    return Promise.resolve().then(() => {
      expect(claimClick).toHaveBeenCalledTimes(1);
    });
  });

  it('still gives up on a claim button that never becomes clickable, via the bounded wait', () => {
    vi.useFakeTimers();
    const fixture = installRewardFixture(true);
    new DailyRewardAutoClaimController(lifecycle);

    const claimButton = fixture.getClaimButtons()[0];
    const claimClick = vi.spyOn(claimButton, 'click');
    vi.advanceTimersByTime(CLAIM_WAIT_TIMEOUT_MS * 2);

    expect(claimClick).not.toHaveBeenCalled();
    expect(fixture.getClaimButtons().length).toBeGreaterThan(0);
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

  // 2026-10-15: the header CTA is on every Kick page. Drops routes must not open it.
  it.each(['/drops', '/drops/claimed', '/drops/campaigns'] as const)(
    'does not click the daily-reward launcher or warn when the CTA appears on %s',
    async (pathname) => {
      window.history.replaceState({}, '', pathname);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const present = installSilentDailyRewardCta();
      const presentClick = vi.spyOn(present.launcher, 'click');
      new DailyRewardAutoClaimController(lifecycle);
      expect(presentClick).not.toHaveBeenCalled();

      present.launcher.remove();
      await flushMutationObserver();
      const appeared = installSilentDailyRewardCta();
      const appearedClick = vi.spyOn(appeared.launcher, 'click');
      await flushMutationObserver();

      expect(presentClick).not.toHaveBeenCalled();
      expect(appearedClick).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('claims the daily reward once on /some-channel', () => {
    window.history.replaceState({}, '', '/some-channel');
    const fixture = installRewardFixture();
    const claimed: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) claimed.push(event.target!);
    };
    document.addEventListener('click', listener, true);
    try {
      new DailyRewardAutoClaimController(lifecycle);
      expect(claimed).toHaveLength(1);
      expect(fixture.getClaimButtons()).toHaveLength(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('still claims on a channel whose path only begins with the drops letters', () => {
    window.history.replaceState({}, '', '/drops-channel');
    const fixture = installRewardFixture();
    const claimed: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) claimed.push(event.target!);
    };
    document.addEventListener('click', listener, true);
    try {
      new DailyRewardAutoClaimController(lifecycle);
      expect(claimed).toHaveLength(1);
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });

  it('does not click the same launcher again until 10 minutes after a bounded give-up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { launcher, video } = installSilentDailyRewardCta();
    const click = vi.spyOn(launcher, 'click');
    new DailyRewardAutoClaimController(lifecycle);

    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6_000);
    expect(click).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    video.remove();
    await flushMutationObserver();
    vi.advanceTimersByTime(9 * 60 * 1000);
    launcher.append(video);
    await flushMutationObserver();
    expect(click).toHaveBeenCalledTimes(1);

    video.remove();
    await flushMutationObserver();
    vi.advanceTimersByTime(60 * 1000 + 1);
    launcher.append(video);
    await flushMutationObserver();
    expect(click).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns once per page load when three different launchers give up on a missing dialog', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    new DailyRewardAutoClaimController(lifecycle);

    for (let n = 0; n < 3; n += 1) {
      document.querySelectorAll('button').forEach((button) => button.remove());
      await flushMutationObserver();
      const { launcher } = installSilentDailyRewardCta();
      const click = vi.spyOn(launcher, 'click');
      await flushMutationObserver();
      expect(click).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(6_000);
      expect(click).toHaveBeenCalledTimes(1);
      // The cooldown is page-wide: a re-mounted CTA (new nodes) inside the 10 minutes is not clicked.
      document.querySelectorAll('button').forEach((button) => button.remove());
      await flushMutationObserver();
      const { launcher: remounted } = installSilentDailyRewardCta();
      const remountedClick = vi.spyOn(remounted, 'click');
      await flushMutationObserver();
      expect(remountedClick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10 * 60 * 1000);
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'daily-reward-auto-claim: giving up for this CTA appearance:',
      'dialog did not mount before the bounded wait ended',
      '',
    );
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('claims once after SPA navigation from /drops/claimed to /some-channel', () => {
    window.history.replaceState({}, '', '/drops/claimed');
    const fixture = installRewardFixture();
    const launcherClick = vi.spyOn(fixture.launcher, 'click');
    const claimed: EventTarget[] = [];
    const listener = (event: Event): void => {
      if (fixture.getClaimButtons().includes(event.target as HTMLButtonElement)) claimed.push(event.target!);
    };
    document.addEventListener('click', listener, true);
    try {
      new DailyRewardAutoClaimController(lifecycle);
      expect(launcherClick).not.toHaveBeenCalled();
      expect(claimed).toHaveLength(0);

      window.history.replaceState({}, '', '/some-channel');
      window.dispatchEvent(new Event('kickflow:locationchange'));

      expect(claimed).toHaveLength(1);
      expect(fixture.getClaimButtons()).toHaveLength(1);
      expect(launcherClick).toHaveBeenCalledTimes(2);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      document.removeEventListener('click', listener, true);
    }
  });
});
