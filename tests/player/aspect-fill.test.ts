import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  containedPicture,
  fillTransform,
  findStage,
  initAmbientBands,
  initUltrawideFill,
  MAX_STRETCH,
  nextAspectMode,
  normalizeAspectMode,
  setAspectModeWriter,
} from '../../src/content/player/aspect-fill';
import { Lifecycle } from '../../src/content/shared/lifecycle';

// Geometry measured 2026-11-24 at 2560x1080 (headless Chromium, live Valorant channel):
// stage 1964x888 at (256,60), player box 1579x888 at (449,60), stream 1280x720.
const STAGE = { x: 256, y: 60, width: 1964, height: 888 };
const BOX = { x: 449, y: 60, width: 1579, height: 888 };

function mapX(x: number, plan: NonNullable<ReturnType<typeof fillTransform>>): number {
  const midX = BOX.x + BOX.width / 2;
  return midX + (x - midX) * plan.sx + plan.tx;
}
function mapY(y: number, plan: NonNullable<ReturnType<typeof fillTransform>>): number {
  const midY = BOX.y + BOX.height / 2;
  return midY + (y - midY) * plan.sy + plan.ty;
}

describe('ultrawide fill geometry', () => {
  it('cover fills the measured 21:9 stage edge to edge with one uniform zoom', () => {
    const picture = containedPicture(BOX, 1280, 720);
    const plan = fillTransform('cover', BOX, picture, STAGE)!;
    expect(plan.sx).toBeCloseTo(plan.sy, 6);
    expect(plan.sx).toBeCloseTo(1964 / 1579, 3);
    expect(mapX(picture.x, plan)).toBeCloseTo(STAGE.x, 1);
    expect(mapX(picture.x + picture.width, plan)).toBeCloseTo(STAGE.x + STAGE.width, 1);
    // Top and bottom overflow the stage (cropped), the clip keeps exactly the stage.
    expect(mapY(picture.y, plan)).toBeLessThan(STAGE.y);
    expect(mapY(BOX.y + plan.clip.top, plan)).toBeCloseTo(STAGE.y, 1);
  });

  it('stretch fills the width with at most 15% stretch and crops less than cover', () => {
    const picture = containedPicture(BOX, 1280, 720);
    const cover = fillTransform('cover', BOX, picture, STAGE)!;
    const plan = fillTransform('stretch', BOX, picture, STAGE)!;
    expect(mapX(picture.x, plan)).toBeCloseTo(STAGE.x, 1);
    expect(mapX(picture.x + picture.width, plan)).toBeCloseTo(STAGE.x + STAGE.width, 1);
    expect(plan.sx / plan.sy).toBeLessThanOrEqual(MAX_STRETCH + 1e-9);
    expect(plan.sy).toBeLessThan(cover.sy);
    expect(plan.sy).toBeGreaterThanOrEqual(1);
  });

  it('a 21:9 stretch on a stage only 10% wider is a pure stretch without crop', () => {
    const stage = { x: 0, y: 0, width: 1737, height: 888 };
    const box = { x: 79, y: 0, width: 1579, height: 888 };
    const plan = fillTransform('stretch', box, containedPicture(box, 1280, 720), stage)!;
    expect(plan.sy).toBeCloseTo(1, 6);
    expect(plan.sx).toBeCloseTo(1737 / 1579, 3);
  });

  it('contain, a stage without bands or a zero-size video change nothing', () => {
    const picture = containedPicture(BOX, 1280, 720);
    expect(fillTransform('contain', BOX, picture, STAGE)).toBeNull();
    expect(fillTransform('cover', BOX, picture, BOX)).toBeNull();
    expect(fillTransform('cover', BOX, { ...picture, width: 0 }, STAGE)).toBeNull();
  });

  it('a 4:3 stream inside the 16:9 box is centred and filled too', () => {
    const picture = containedPicture(BOX, 1024, 768);
    expect(picture.width).toBeCloseTo(888 * 4 / 3, 3);
    const plan = fillTransform('cover', BOX, picture, STAGE)!;
    expect(mapX(picture.x, plan)).toBeCloseTo(STAGE.x, 1);
    expect(mapX(picture.x + picture.width, plan)).toBeCloseTo(STAGE.x + STAGE.width, 1);
  });

  it('modes cycle and only the three known values pass', () => {
    expect(nextAspectMode('contain')).toBe('cover');
    expect(nextAspectMode('cover')).toBe('stretch');
    expect(nextAspectMode('stretch')).toBe('contain');
    expect(normalizeAspectMode('zoom')).toBeNull();
    expect(normalizeAspectMode('stretch')).toBe('stretch');
  });
});

function mountPlayer(): { video: HTMLVideoElement; stage: HTMLElement } {
  document.body.innerHTML = `
    <div id="stage" style="overflow:hidden">
      <div id="injected-channel-player"><div><video id="video-player"></video></div></div>
    </div>`;
  const stage = document.getElementById('stage')!;
  const video = document.getElementById('video-player') as HTMLVideoElement;
  const rect = (r: { x: number; y: number; width: number; height: number }) => () => ({ ...r, top: r.y, left: r.x, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => r }) as DOMRect;
  stage.getBoundingClientRect = rect(STAGE);
  video.getBoundingClientRect = rect(BOX);
  for (const [element, size] of [[stage, STAGE], [video, BOX]] as const) {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, value: size.width });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: size.height });
  }
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
  return { video, stage };
}

describe('ultrawide fill on the page', () => {
  afterEach(() => {
    featureFlags.aspectMode = 'cover';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('finds the clipping black stage around the 16:9 player box', () => {
    const { video, stage } = mountPlayer();
    expect(findStage(video)).toBe(stage);
  });

  it('transforms only the video, follows the U key and clears everything on teardown', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
    const { video } = mountPlayer();
    const writes: string[] = [];
    setAspectModeWriter((mode) => { writes.push(mode); featureFlags.aspectMode = mode; });
    featureFlags.aspectMode = 'cover';
    const lifecycle = new Lifecycle();
    initUltrawideFill(lifecycle);
    expect(video.style.transform).toContain('scale(');
    expect(video.style.clipPath).toContain('inset(');
    expect(video.getAttribute('data-kickflow-aspect')).toBe('cover');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    expect(writes).toEqual(['stretch']);
    expect(document.querySelector('.kickflow-aspect-toast')?.textContent).toMatch(/germe|stretch/i);

    // Typing in the chat never switches the picture.
    const input = document.createElement('textarea');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    expect(writes).toEqual(['stretch']);

    lifecycle.dispose();
    expect(video.style.transform).toBe('');
    expect(video.style.clipPath).toBe('');
    expect(video.hasAttribute('data-kickflow-aspect')).toBe(false);
  });

  it('ambient bands put one canvas under the player inside the stage and remove it when off', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
    const { stage } = mountPlayer();
    const lifecycle = new Lifecycle();
    initAmbientBands(lifecycle);
    const canvas = stage.querySelector('canvas.kickflow-ambient');
    expect(canvas).not.toBeNull();
    expect(stage.firstElementChild).toBe(canvas);
    expect(canvas!.getAttribute('aria-hidden')).toBe('true');
    lifecycle.dispose();
    expect(stage.querySelector('canvas.kickflow-ambient')).toBeNull();
  });
});
