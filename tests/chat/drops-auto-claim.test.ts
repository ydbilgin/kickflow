import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropsAutoClaimController } from '../../src/content/chat/drops-auto-claim';
import { setFeatureFlag } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const DROPS_PANEL_ID = 'drops-panel';
const CHANNEL_POINTS_PANEL_ID = 'rewards-panel';

type ProgressState = 'complete' | 'loading';

interface RewardCardOptions {
  progressState: ProgressState;
  progressValue: string;
  footer: string;
}

function createRewardCard(options: RewardCardOptions): HTMLLIElement {
  const card = document.createElement('li');
  card.className = 'flex flex-col gap-3 w-[120px] shrink-0';
  card.innerHTML = `
    <div class="relative flex flex-col items-center overflow-hidden rounded bg-surface-base">
      <img src="REWARD_IMAGE_URL" alt="Example reward" width="142" height="142" class="block aspect-square rounded-t object-cover">
      <span class="text-surface-onSurface border-outline-decorative line-clamp-3 w-full break-words border-t p-2 text-left font-semibold h-[56px] text-xs">Example reward</span>
      <div role="progressbar" aria-valuemax="1" aria-valuemin="0" aria-valuenow="${options.progressValue}" aria-valuetext="100%" data-state="${options.progressState}" data-value="${options.progressValue}" data-max="1" class="bg-outline-region absolute bottom-0 left-0 right-0 h-1 w-full translate-y-1/2 overflow-hidden rounded-lg">
        <div data-state="${options.progressState}" data-value="${options.progressValue}" data-max="1" class="bg-primary-base h-full w-full origin-left rounded-lg" style="transform:scaleX(${options.progressValue})"></div>
      </div>
    </div>
    <div class="flex flex-col gap-1 h-10 items-start justify-start">${options.footer}</div>
  `;
  return card;
}

function createClaimButton(disabled = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Claim Example reward');
  button.className = 'self-center';
  button.textContent = 'Claim';
  button.disabled = disabled;
  return button;
}

function createDropsPanel(card: HTMLLIElement): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = DROPS_PANEL_ID;
  panel.className = 'z-popover absolute inset-x-0 bottom-full h-fit lg:bottom-0 -translate-y-[52px]';
  panel.innerHTML = `
    <div data-testid="drops-panel" class="bg-surface-base relative rounded-t flex h-auto min-h-0 w-full flex-col overflow-hidden break-all min-h-[50px]" style="max-height:600px;transition:max-height 350ms;transition-timing-function:ease-out">
      <div class="overflow-y-auto pt-0 transition-opacity duration-300 opacity-100">
        <div class="flex flex-col gap-3 px-5 pb-4">
          <div class="flex flex-col gap-3">
            <div class="bg-surface-highest flex flex-col gap-4 rounded p-4">
              <div class="relative">
                <ul class="flex flex-row flex-nowrap gap-2 overflow-x-auto pr-8 lg:flex-wrap lg:justify-start lg:pr-0"></ul>
                <div class="from-surface-highest pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l to-transparent lg:hidden"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  panel.querySelector('ul')?.append(card);
  return panel;
}

function installClaimableFixture(disabled = false): {
  panel: HTMLDivElement;
  card: HTMLLIElement;
  button: HTMLButtonElement;
} {
  const button = createClaimButton(disabled);
  const card = createRewardCard({
    progressState: 'complete',
    progressValue: '1',
    footer: button.outerHTML,
  });
  const panel = createDropsPanel(card);
  document.body.append(panel);
  const liveButton = card.querySelector('button') as HTMLButtonElement;
  return { panel, card, button: liveButton };
}

function installTextOnlyFixture(state: 'watching' | 'claimed' | 'unavailable'): {
  panel: HTMLDivElement;
  card: HTMLLIElement;
} {
  const watching = state === 'watching';
  const card = createRewardCard({
    progressState: watching ? 'loading' : 'complete',
    progressValue: watching ? '0.5' : '1',
    footer: `<span class="text-surface-onSurfaceSecondary">${
      watching ? 'Progress to unlock' : state === 'claimed' ? 'Reward claimed' : 'Reward not available'
    }</span>`,
  });
  const panel = createDropsPanel(card);
  document.body.append(panel);
  return { panel, card };
}

function installChannelPointsPanel(): {
  panel: HTMLDivElement;
  launcher: HTMLButtonElement;
  submit: HTMLButtonElement;
} {
  const panel = document.createElement('div');
  panel.id = CHANNEL_POINTS_PANEL_ID;
  panel.innerHTML = `
    <button data-testid="channel-points-button">1,000 points</button>
    <form><button type="submit">Redeem</button></form>
  `;
  document.body.append(panel);
  return {
    panel,
    launcher: panel.querySelector('[data-testid="channel-points-button"]') as HTMLButtonElement,
    submit: panel.querySelector('button[type="submit"]') as HTMLButtonElement,
  };
}

async function flushMutationObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Drops auto-claim controller', () => {
  let lifecycle: Lifecycle;

  beforeEach(() => {
    document.body.replaceChildren();
    setFeatureFlag('autoClaimDrops', true);
    lifecycle = new Lifecycle();
  });

  afterEach(() => {
    lifecycle.dispose();
    setFeatureFlag('autoClaimDrops', false);
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  // Round 78 confirmed the progressbar and the button from Kick's bundle but NOT the card wrapper's
  // tag name — the bundle renders the card through a styled component. These two tests hold the
  // card-resolution rule to what the evidence actually supports.
  it('resolves the card structurally, so a wrapper that is not a list item still claims', () => {
    const button = createClaimButton();
    const card = createRewardCard({ progressState: 'complete', progressValue: '1', footer: button.outerHTML });
    const divCard = document.createElement('div');
    divCard.className = card.className;
    divCard.innerHTML = card.innerHTML;
    const panel = createDropsPanel(card);
    card.replaceWith(divCard);
    document.body.append(panel);
    const click = vi.spyOn(divCard.querySelector('button') as HTMLButtonElement, 'click');

    new DropsAutoClaimController(lifecycle);

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('never attributes a neighbouring card\'s button to a card that has none', () => {
    const watchingCard = createRewardCard({
      progressState: 'complete',
      progressValue: '1',
      footer: '<span>Reward claimed</span>',
    });
    const claimable = createClaimButton();
    const claimableCard = createRewardCard({
      progressState: 'complete',
      progressValue: '1',
      footer: claimable.outerHTML,
    });
    const panel = createDropsPanel(watchingCard);
    panel.querySelector('ul')?.append(claimableCard);
    document.body.append(panel);
    const neighbourClick = vi.spyOn(claimableCard.querySelector('button') as HTMLButtonElement, 'click');

    new DropsAutoClaimController(lifecycle);

    // The claimable card is claimed on its own account, exactly once — never twice because the
    // buttonless sibling climbed far enough up the tree to find it too.
    expect(neighbourClick).toHaveBeenCalledTimes(1);
  });

  it('clicks a claimable card exactly once across repeated mutations and a panel remount', async () => {
    const { panel, button } = installClaimableFixture();
    const click = vi.spyOn(button, 'click');

    new DropsAutoClaimController(lifecycle);
    expect(click).toHaveBeenCalledTimes(1);

    const footer = button.parentElement!;
    footer.replaceChildren();
    footer.append(button);
    await flushMutationObserver();
    panel.remove();
    document.body.append(panel);
    await flushMutationObserver();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('never clicks a watching card whose progressbar is not complete', () => {
    const { card } = installTextOnlyFixture('watching');
    new DropsAutoClaimController(lifecycle);

    expect(card.querySelector('button')).toBeNull();
  });

  it.each(['claimed', 'unavailable'] as const)('never clicks a %s text-only card', (state) => {
    const { card } = installTextOnlyFixture(state);
    new DropsAutoClaimController(lifecycle);

    expect(card.querySelector('button')).toBeNull();
  });

  it('skips a disabled claim button and clicks it after Kick clears the disabled attribute', async () => {
    const { button } = installClaimableFixture(true);
    const click = vi.spyOn(button, 'click');

    new DropsAutoClaimController(lifecycle);
    expect(click).not.toHaveBeenCalled();

    button.disabled = false;
    await flushMutationObserver();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('never touches the channel-points subtree in the same document', () => {
    const points = installChannelPointsPanel();
    const launcherClick = vi.spyOn(points.launcher, 'click');
    const submitClick = vi.spyOn(points.submit, 'click');
    installClaimableFixture();

    new DropsAutoClaimController(lifecycle);

    expect(launcherClick).not.toHaveBeenCalled();
    expect(submitClick).not.toHaveBeenCalled();
  });

  it('does nothing when no Drops panel exists', async () => {
    expect(() => new DropsAutoClaimController(lifecycle)).not.toThrow();
    await flushMutationObserver();
    expect(document.querySelector(`#${DROPS_PANEL_ID}`)).toBeNull();
  });

  it('handles a Drops panel that appears after the controller starts', async () => {
    const controller = new DropsAutoClaimController(lifecycle);
    expect(controller).toBeInstanceOf(DropsAutoClaimController);

    const { button } = installClaimableFixture();
    const click = vi.spyOn(button, 'click');
    await flushMutationObserver();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('attaches no observer and clicks nothing while the flag is off', async () => {
    setFeatureFlag('autoClaimDrops', false);
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const setTimeout = vi.spyOn(window, 'setTimeout');
    const setInterval = vi.spyOn(window, 'setInterval');
    const { button } = installClaimableFixture();
    const click = vi.spyOn(button, 'click');

    new DropsAutoClaimController(lifecycle);
    await flushMutationObserver();

    expect(observe).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('disconnects its observer on teardown and cannot click after disposal', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    new DropsAutoClaimController(lifecycle);
    expect(observe).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);

    const { button } = installClaimableFixture();
    const click = vi.spyOn(button, 'click');
    await flushMutationObserver();

    expect(click).not.toHaveBeenCalled();
  });
});
