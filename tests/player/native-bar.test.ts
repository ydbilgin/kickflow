import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountIntoControlBar, shareNativeBarMountManager } from '../../src/content/player/native-bar';
import { type BudgetPlan, planBarBudget } from '../../src/content/player/bar-budget';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import * as selectors from '../../src/content/shared/selectors';
import { logger } from '../../src/content/shared/logger';

function setupPlayerBar(liveLabel = 'LIVE'): HTMLElement {
  document.body.replaceChildren();
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = liveLabel;
  bar.append(live);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return bar;
}

function setupReplacementPlayerBar(): HTMLElement {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  bar.append(live);
  wrapper.append(video, bar);
  return wrapper;
}

async function flushMountDebounce(): Promise<void> {
  await Promise.resolve();
  vi.advanceTimersByTime(150);
  await Promise.resolve();
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('native-bar mounting', () => {
  it('mounts after the native transport group when a recorded player has no LIVE button', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const left = document.createElement('div');
    left.className = 'flex flex-row items-center gap-2 lg:gap-0';
    const play = document.createElement('button');
    const volume = document.createElement('button');
    const volumeGroup = document.createElement('div');
    volumeGroup.className = 'group/volume flex items-center gap-2 xl:gap-4';
    volumeGroup.append(volume);
    const time = document.createElement('span');
    time.textContent = '00:00 / 03:24:18';
    left.append(play, volumeGroup, time);
    const right = document.createElement('div');
    right.className = left.className;
    const fullscreen = document.createElement('button');
    fullscreen.dataset.testid = 'video-player-fullscreen';
    right.append(fullscreen);
    bar.replaceChildren(left, right);
    const nativeOrder = Array.from(left.children);
    const lifecycle = new Lifecycle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const build = vi.fn(() => document.createElement('span'));

    try {
      const mounted = mountIntoControlBar(lifecycle, 'kickflow-speed-controls', build);
      expect(mounted).not.toBeNull();
      expect(left.lastElementChild).toBe(mounted);
      expect(Array.from(left.children).slice(0, nativeOrder.length)).toEqual(nativeOrder);
      expect(right.children).toHaveLength(1);
      expect(right.lastElementChild).toBe(fullscreen);
      await vi.advanceTimersByTimeAsync(5_250);
      expect(warn).not.toHaveBeenCalled();
      expect(build).toHaveBeenCalledOnce();
    } finally {
      lifecycle.dispose();
    }
  });

  it('mounts controls when the native anchor is the Turkish behind-live label', () => {
    const bar = setupPlayerBar('Canlı Yayına Geç');
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);

    try {
      expect(mounted).not.toBeNull();
      expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    } finally {
      lifecycle.dispose();
    }
  });

  it('mounts only once and removes the injected control on lifecycle disposal', () => {
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const first = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const second = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);

    expect(first).toBe(second);
    expect(build).toHaveBeenCalledTimes(1);
    expect(bar.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);

    lifecycle.dispose();

    expect(document.getElementById('kickflow-test-controls')).toBeNull();
  });

  it('re-injects the control after the native bar drops it', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    mounted?.remove();
    await flushMountDebounce();

    expect(build).toHaveBeenCalledTimes(1);
    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);

    lifecycle.dispose();
  });

  it('remounts after rewind changes the native label to Turkish go-to-live text', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const nativeLiveButton = bar.querySelector('button') as HTMLButtonElement;

    nativeLiveButton.textContent = 'Canlı Yayına Geç';
    mounted?.remove();
    await flushMountDebounce();

    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('rebinds to a replacement player wrapper and mounts its control there', async () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const replacement = setupReplacementPlayerBar();
    document.body.firstElementChild?.replaceWith(replacement);
    await flushMountDebounce();

    expect(build).toHaveBeenCalledTimes(1);
    expect(replacement.querySelector('#kickflow-test-controls')).toBe(mounted);

    lifecycle.dispose();
  });

  it('remounts immediately during a mutation storm instead of waiting for debounce silence', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const wrapper = bar.parentElement as HTMLElement;
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));

    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    mounted?.remove();

    for (let index = 0; index < 10; index++) {
      wrapper.append(document.createElement('i'));
      await flushMutations();
      vi.advanceTimersByTime(100);
    }

    expect(document.getElementById('kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('retries a missed LIVE anchor without depending on another DOM mutation', () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const liveButton = vi.spyOn(selectors, 'findControlBarInsertionAnchor').mockReturnValue(null);

    expect(mountIntoControlBar(lifecycle, 'kickflow-test-controls', build)).toBeNull();
    liveButton.mockRestore();

    vi.advanceTimersByTime(250);

    expect(document.getElementById('kickflow-test-controls')).not.toBeNull();
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('does not remount from a pending retry after lifecycle teardown', () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const liveButton = vi.spyOn(selectors, 'findControlBarInsertionAnchor').mockReturnValue(null);

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    lifecycle.dispose();
    liveButton.mockRestore();
    vi.advanceTimersByTime(5000);

    expect(build).not.toHaveBeenCalled();
    expect(document.getElementById('kickflow-test-controls')).toBeNull();
  });

  it('diagnoses an exhausted native LIVE anchor once without creating extension warnings', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar('OFFLINE');
    const lifecycle = new Lifecycle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', () => document.createElement('span'));
    vi.advanceTimersByTime(5_250);

    expect(warn).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls.filter((args) => String(args[0]).includes('LIVE_EDGE_LABELS'))).toHaveLength(1);
    expect(diagnostic.mock.calls.flat().join(' ')).toContain('LIVE_EDGE_LABELS');

    bar.append(document.createElement('i'));
    await flushMutations();
    vi.advanceTimersByTime(5_250);
    expect(warn).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls.filter((args) => String(args[0]).includes('LIVE_EDGE_LABELS'))).toHaveLength(1);

    lifecycle.dispose();
  });

  // MEASURED LIVE 2026-08-28 (output/playwright/native-bar-hover-probe.json): Kick mounts the
  // control bar only once a pointer moves over the player. With no pointer interaction the wrapper
  // holds no bar and none of our controls; after hovering, the bar carries 13 buttons and all four
  // mount. The retry budget is ~5 s, so a viewer who has not touched the player yet exhausts it on
  // every page load. Warning there would fire on healthy sessions for a feature that is about to
  // work, which is how a warning channel stops being read.
  it('stays silent when Kick has simply not mounted the control bar yet, and still mounts later', async () => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    wrapper.append(video);
    document.body.append(wrapper);
    const lifecycle = new Lifecycle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', () => document.createElement('span'));
    vi.advanceTimersByTime(5_250);

    expect(warn).not.toHaveBeenCalled();

    // The pointer reaches the player: Kick mounts the bar and the control must appear.
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const live = document.createElement('button');
    live.textContent = 'LIVE';
    bar.append(live);
    wrapper.append(bar);
    await flushMutations();
    await flushMountDebounce();

    expect(document.getElementById('kickflow-test-controls')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('retains a developer diagnostic when the control-bar selector misses a rendered bar', () => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    // A bar that Kick renamed away from `z-controls` — this IS anchor rot, and it must be loud.
    const renamedBar = document.createElement('div');
    renamedBar.className = 'player-controls bottom-0';
    const live = document.createElement('button');
    live.textContent = 'LIVE';
    renamedBar.append(live);
    wrapper.append(video, renamedBar);
    document.body.append(wrapper);
    const lifecycle = new Lifecycle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');

    mountIntoControlBar(lifecycle, 'kickflow-test-controls', () => document.createElement('span'));
    vi.advanceTimersByTime(5_250);

    expect(warn).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls.filter((args) => String(args[0]).includes('SELECTORS.controlBarBottom'))).toHaveLength(1);
    expect(diagnostic.mock.calls.flat().join(' ')).toContain('SELECTORS.controlBarBottom');
    lifecycle.dispose();
  });

  it('keeps one cached group when the video element swaps inside its wrapper', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const wrapper = bar.parentElement as HTMLElement;
    const lifecycle = new Lifecycle();
    const build = vi.fn(() => document.createElement('span'));
    const mounted = mountIntoControlBar(lifecycle, 'kickflow-test-controls', build);
    const replacementVideo = document.createElement('video');
    replacementVideo.id = 'video-player';

    wrapper.querySelector('#video-player')?.replaceWith(replacementVideo);
    await flushMountDebounce();

    expect(bar.querySelectorAll('#kickflow-test-controls')).toHaveLength(1);
    expect(bar.querySelector('#kickflow-test-controls')).toBe(mounted);
    expect(build).toHaveBeenCalledTimes(1);

    lifecycle.dispose();
  });

  it('does not inherit stale controls during a rapid lifecycle handoff', async () => {
    const bar = setupPlayerBar();
    const firstLifecycle = new Lifecycle();
    const secondLifecycle = new Lifecycle();
    const staleBuild = vi.fn(() => document.createElement('span'));
    const freshBuild = vi.fn(() => document.createElement('span'));
    const stale = mountIntoControlBar(firstLifecycle, 'kickflow-test-controls', staleBuild);

    expect(mountIntoControlBar(secondLifecycle, 'kickflow-test-controls', freshBuild)).toBeNull();

    firstLifecycle.dispose();
    await flushMutations();

    expect(bar.querySelector('#kickflow-test-controls')).not.toBe(stale);
    expect(freshBuild).toHaveBeenCalledTimes(1);
    secondLifecycle.dispose();
  });

  it('reuses cached groups and shares one observer set across all registrations', async () => {
    vi.useFakeTimers();
    const bar = setupPlayerBar();
    const lifecycle = new Lifecycle();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    // Registered in the old order on purpose: the bar order comes from CONTROL_ORDER (FINAL design
    // 2026-10-18: the behind-live chip is the plate's last item), not from registration order.
    const ids = [
      'kickflow-rewind-controls',
      'kickflow-catchup-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
    ];
    const barOrder = [
      'kickflow-rewind-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
      'kickflow-catchup-controls',
    ];
    const builds = ids.map((id) => vi.fn(() => {
      const group = document.createElement('span');
      group.textContent = id;
      return group;
    }));

    const mounted = ids.map((id, index) => mountIntoControlBar(lifecycle, id, builds[index]));

    // One manager owns three shared observers: wrapper (children), doc rebind, and the
    // theatre-attribute watch — set up once, not per registration.
    expect(observe).toHaveBeenCalledTimes(3);
    expect(Array.from(bar.children).map((child) => child.id || child.textContent)).toEqual([
      'LIVE',
      ...barOrder,
    ]);

    mounted.forEach((group) => group?.remove());
    await flushMutations();

    expect(ids.map((id) => document.getElementById(id))).toEqual(mounted);
    expect(builds.map((build) => build.mock.calls)).toEqual([[[]], [[]], [[]], [[]]]);

    lifecycle.dispose();

    expect(ids.map((id) => document.getElementById(id))).toEqual([null, null, null, null]);
  });

  it('shares ordered mounting across disposable feature lifecycles and removes only the disabled feature', () => {
    const bar = setupPlayerBar();
    const session = new Lifecycle();
    const rewind = new Lifecycle();
    const screenshot = new Lifecycle();
    shareNativeBarMountManager(rewind, session);
    shareNativeBarMountManager(screenshot, session);

    mountIntoControlBar(screenshot, 'kickflow-screenshot-controls', () => document.createElement('span'));
    mountIntoControlBar(rewind, 'kickflow-rewind-controls', () => document.createElement('span'));
    expect(Array.from(bar.children).map((child) => child.id || child.textContent)).toEqual([
      'LIVE',
      'kickflow-rewind-controls',
      'kickflow-screenshot-controls',
    ]);

    rewind.dispose();
    expect(document.getElementById('kickflow-rewind-controls')).toBeNull();
    expect(document.getElementById('kickflow-screenshot-controls')).not.toBeNull();
    session.dispose();
  });
});

describe('bar width budget arithmetic', () => {
  const CONTROLS = [
    { id: 'kickflow-rewind-controls', cost: 88 },
    { id: 'kickflow-catchup-controls', cost: 112 },
    { id: 'kickflow-speed-controls', cost: 52 },
    { id: 'kickflow-screenshot-controls', cost: 44 },
  ];
  const COLLAPSE_ORDER = [
    'kickflow-screenshot-controls',
    'kickflow-speed-controls',
    'kickflow-rewind-controls',
    'kickflow-catchup-controls',
  ];
  const plan = (free: number, overflowCost = 44): BudgetPlan =>
    planBarBudget({ free, overflowCost, controls: CONTROLS, collapseOrder: COLLAPSE_ORDER });

  it('mounts everything when the whole cluster fits, and shows no overflow button', () => {
    expect(plan(296)).toEqual({ mounted: CONTROLS.map((control) => control.id), collapsed: [], overflow: false });
  });

  it('gives up the screenshot first, then speed, then the rewind pair, and CANLI last', () => {
    // Every step must also pay for the 44px overflow button itself, which is why one pixel short
    // of the full cluster already costs two controls.
    expect(plan(295).collapsed).toEqual(['kickflow-speed-controls', 'kickflow-screenshot-controls']);
    expect(plan(200).collapsed).toEqual([
      'kickflow-rewind-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
    ]);
    expect(plan(120)).toEqual({
      mounted: [],
      collapsed: CONTROLS.map((control) => control.id),
      overflow: true,
    });
  });

  it('keeps bar order in both lists, so a collapsed control reappears where it belongs', () => {
    const result = plan(295);
    expect(result.mounted).toEqual(['kickflow-rewind-controls', 'kickflow-catchup-controls']);
    expect(result.collapsed).toEqual(['kickflow-speed-controls', 'kickflow-screenshot-controls']);
    expect(result.overflow).toBe(true);
  });

  it('mounts nothing at all when not even the overflow button fits', () => {
    expect(plan(40)).toEqual({ mounted: [], collapsed: CONTROLS.map((control) => control.id), overflow: false });
    expect(plan(-46)).toEqual({ mounted: [], collapsed: CONTROLS.map((control) => control.id), overflow: false });
  });

  it('never collapses a control it could not measure, because that would free nothing', () => {
    const unmeasured = CONTROLS.map((control) => ({ ...control, cost: 0 }));
    expect(planBarBudget({ free: 0, overflowCost: 0, controls: unmeasured, collapseOrder: COLLAPSE_ORDER }))
      .toEqual({ mounted: unmeasured.map((control) => control.id), collapsed: [], overflow: false });

    const mixed = [{ id: 'measured', cost: 200 }, { id: 'unmeasured', cost: 0 }];
    const result = planBarBudget({ free: 100, overflowCost: 44, controls: mixed, collapseOrder: [] });
    expect(result.collapsed).toEqual(['measured']);
    expect(result.mounted).toEqual(['unmeasured']);
  });

  it('collapses a control the priority list does not name, but only after the named ones', () => {
    const withNewcomer = [...CONTROLS, { id: 'kickflow-future-controls', cost: 44 }];
    const collapseAt = (free: number): BudgetPlan =>
      planBarBudget({ free, overflowCost: 44, controls: withNewcomer, collapseOrder: COLLAPSE_ORDER });

    // Everything the priority list names goes first, so a control added later can never keep a
    // named one out of the bar...
    expect(collapseAt(100).mounted).toEqual(['kickflow-future-controls']);
    expect(collapseAt(100).collapsed).toEqual(CONTROLS.map((control) => control.id));
    // ...and it is still collapsible once there is nothing else left to give up.
    expect(collapseAt(60).collapsed).toEqual(withNewcomer.map((control) => control.id));
  });
});

describe('native-bar width budget against a measured bar', () => {
  const CONTROL_WIDTHS: Record<string, number> = {
    'kickflow-rewind-controls': 88,
    'kickflow-catchup-controls': 112,
    'kickflow-speed-controls': 52,
    'kickflow-screenshot-controls': 44,
    'kickflow-overflow-controls': 44,
  };
  const KICK_CONTROLS_PX = 200;

  /** jsdom has no layout engine, so the bar's geometry is stubbed — but the stub answers with a
   * rect per element exactly as a browser would, and the production code still has to derive
   * `free` from it. The real geometry gate is tests/playwright/player-bar-visual.mjs. */
  function setupMeasuredBar(barWidth: number): { bar: HTMLElement; wrapper: HTMLElement; resize: (px: number) => void } {
    document.body.replaceChildren();
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.id = 'video-player';
    const bar = document.createElement('div');
    bar.className = 'z-controls bottom-0';
    const kickControls = document.createElement('div');
    kickControls.id = 'kick-own-controls';
    const live = document.createElement('button');
    live.textContent = 'LIVE';
    bar.append(kickControls, live);
    wrapper.append(video, bar);
    document.body.append(wrapper);

    const resize = (px: number): void => {
      Object.defineProperty(bar, 'clientWidth', { configurable: true, value: px });
    };
    resize(barWidth);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measured(this: HTMLElement) {
      const width = this === kickControls ? KICK_CONTROLS_PX : CONTROL_WIDTHS[this.id] ?? 0;
      return { x: 0, y: 0, width, height: 44, top: 0, left: 0, right: width, bottom: 44, toJSON: () => ({}) } as DOMRect;
    });

    return { bar, wrapper, resize };
  }

  function mountAll(lifecycle: Lifecycle): void {
    for (const id of [
      'kickflow-rewind-controls',
      'kickflow-catchup-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
    ]) {
      mountIntoControlBar(lifecycle, id, () => {
        const group = document.createElement('span');
        group.className = 'kickflow-player-group';
        group.append(document.createElement('button'));
        return group;
      });
    }
  }

  function idsInBar(bar: HTMLElement): string[] {
    return Array.from(bar.children).map((child) => child.id).filter((id) => id.startsWith('kickflow-'));
  }

  it('collapses the lowest-priority controls into the overflow menu instead of displacing Kick', () => {
    // free = 400 - 200 = 200. The cluster needs 296 and the overflow button another 44, so the
    // screenshot, speed and rewind controls have to go; CANLI is the last one standing.
    const { bar, wrapper } = setupMeasuredBar(400);
    const lifecycle = new Lifecycle();
    mountAll(lifecycle);

    // The ⋯ button joins the plate BEFORE the chip, so the chip stays the plate's last item.
    expect(idsInBar(bar)).toEqual(['kickflow-overflow-controls', 'kickflow-catchup-controls']);

    document.querySelector<HTMLButtonElement>('#kickflow-overflow-controls button')?.click();
    const menu = wrapper.querySelector('.kickflow-overflow-menu');
    const menuIds = Array.from(menu?.querySelectorAll('[id^="kickflow-"]') ?? []).map((element) => element.id);
    expect(menuIds).toEqual([
      'kickflow-rewind-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
    ]);
    // No control is hidden without a route: every registered control is in the bar or the menu.
    expect(new Set([...idsInBar(bar), ...menuIds]).size).toBe(5);

    lifecycle.dispose();
  });

  it('mounts the whole cluster again, with the same nodes, once the bar is wide enough', async () => {
    vi.useFakeTimers();
    const { bar, wrapper, resize } = setupMeasuredBar(400);
    const lifecycle = new Lifecycle();
    mountAll(lifecycle);
    // A collapsed control is not in the document while the menu is closed, so read its node
    // through the menu — that IS its route.
    const overflowButton = document.querySelector<HTMLButtonElement>('#kickflow-overflow-controls button');
    overflowButton?.click();
    const collapsedSpeed = document.getElementById('kickflow-speed-controls');
    expect(collapsedSpeed).not.toBeNull();
    overflowButton?.click();

    resize(600);
    wrapper.append(document.createElement('span'));
    await flushMountDebounce();

    expect(idsInBar(bar)).toEqual([
      'kickflow-rewind-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
      'kickflow-catchup-controls',
    ]);
    // The same node came back, so its listeners and its live state came back with it.
    expect(document.getElementById('kickflow-speed-controls')).toBe(collapsedSpeed);
    expect(document.getElementById('kickflow-overflow-controls')).toBeNull();

    lifecycle.dispose();
  });

  it('mounts nothing when not even the overflow button fits, and never touches Kick', () => {
    const { bar } = setupMeasuredBar(220);
    const lifecycle = new Lifecycle();
    mountAll(lifecycle);

    expect(idsInBar(bar)).toEqual([]);
    expect(Array.from(bar.children).map((child) => child.id || child.textContent)).toEqual([
      'kick-own-controls',
      'LIVE',
    ]);

    lifecycle.dispose();
  });

  it('leaves the budget alone when the bar has no measurable width', () => {
    const { bar } = setupMeasuredBar(0);
    const lifecycle = new Lifecycle();
    mountAll(lifecycle);

    // An unmeasurable bar is not evidence that a control does not fit.
    expect(idsInBar(bar)).toEqual([
      'kickflow-rewind-controls',
      'kickflow-speed-controls',
      'kickflow-screenshot-controls',
      'kickflow-catchup-controls',
    ]);

    lifecycle.dispose();
  });
});
