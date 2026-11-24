// 2026-10-29: with 0.2.32 the bottom bar appeared every ~30 s while the mouse was still.
// Live trace (2026-10-29): the rendition recheck
// pressed the native quality gear, Kick set aria-expanded="true" on it, and the controls
// presenter treated that hidden inspection as a viewer-opened menu and showed the bar.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Lifecycle } from '../../src/content/shared/lifecycle';

let initControlsVisibility: typeof import('../../src/content/player/controls-visibility').initControlsVisibility;
let initQualityLock: typeof import('../../src/content/player/quality-lock').initQualityLock;
let GEAR_PATH_PREFIX: string;

beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  ({ initControlsVisibility } = await import('../../src/content/player/controls-visibility'));
  ({ initQualityLock, GEAR_PATH_PREFIX } = await import('../../src/content/player/quality-lock'));
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test' },
    storage: { local: { get: vi.fn(async () => ({ 'kickflow.qualityPreference': 'highest' })), set: vi.fn() } },
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Kick-shaped player: the gear is a Radix trigger that flips aria-expanded and opens a
 * quality menu portal; Escape closes it. */
function setup(): { wrapper: HTMLElement; gear: HTMLButtonElement; opens: () => number } {
  document.body.innerHTML = '<div id="wrapper"><video id="video-player"></video><div class="z-controls bottom-0"><button id="play">Play</button><button id="gear" aria-haspopup="menu" aria-expanded="false"><svg><path></path></svg></button></div></div>';
  const wrapper = document.getElementById('wrapper')!;
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, bottom: 600, right: 1000, height: 600, width: 1000 } as DOMRect);
  const gear = document.getElementById('gear') as HTMLButtonElement;
  gear.querySelector('path')!.setAttribute('d', `${GEAR_PATH_PREFIX}-gear`);
  let opens = 0;
  gear.addEventListener('click', () => {
    opens += 1;
    gear.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    for (const label of ['Auto', '720p60', '480p']) {
      const row = document.createElement('button');
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', String(label === '720p60'));
      row.textContent = label;
      menu.append(row);
    }
    document.body.append(menu);
    sessionStorage.setItem('stream_quality', '720');
    document.addEventListener('keydown', () => { menu.remove(); gear.setAttribute('aria-expanded', 'false'); }, { once: true, capture: true });
  });
  return { wrapper, gear, opens: () => opens };
}

it('hidden rendition rechecks never show the bar while the viewer does nothing', async () => {
  const { wrapper, gear, opens } = setup();
  const shown: number[] = [];
  new MutationObserver(() => {
    if (wrapper.getAttribute('data-kickflow-controls') === 'shown') shown.push(Date.now());
  }).observe(wrapper, { attributes: true, attributeFilter: ['data-kickflow-controls'] });
  const lifecycle = new Lifecycle();
  initControlsVisibility(lifecycle);
  initQualityLock(lifecycle);
  try {
    // Initial pass plus three 30-second rechecks, no pointer or keyboard input at all.
    await vi.advanceTimersByTimeAsync(100_000);
    expect(opens()).toBeGreaterThanOrEqual(3);
    expect(shown).toEqual([]);
    expect(wrapper.getAttribute('data-kickflow-controls')).toBe('hidden');
    expect(gear.hasAttribute('data-kickflow-quality-probe-trigger')).toBe(false);
  } finally { lifecycle.dispose(); }
});

it('a menu the viewer opens on the same gear still holds the bar', async () => {
  const { wrapper, gear } = setup();
  const lifecycle = new Lifecycle();
  initControlsVisibility(lifecycle);
  try {
    gear.setAttribute('aria-expanded', 'true');
    await vi.advanceTimersByTimeAsync(9000);
    expect(wrapper.getAttribute('data-kickflow-controls')).toBe('shown');
  } finally { lifecycle.dispose(); }
});
