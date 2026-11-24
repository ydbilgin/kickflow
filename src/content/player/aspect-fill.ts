import { featureFlags } from '../chat/feature-flags';
import type { Lifecycle } from '../shared/lifecycle';
import { t } from '../shared/i18n';
import { observeVideoElement } from './video-element';
import { isTypingTarget } from './rewind-hotkeys';

/** Ultrawide fill (2026-11-24). A 16:9 stream on a 21:9 screen leaves black side bands: Kick keeps
 * the player box 16:9 inside a wider black stage. Measured 2026-11-24 in headless Chromium at
 * 2560x1080 on a live Valorant channel: stage 1964x888 (overflow hidden, bg black), player box
 * 1579x888, 192 px band on each side.
 *
 * Modes: 'contain' = Kick as it is (bands), 'cover' = uniform zoom until the bands are gone (top
 * and bottom are cropped, the HUD may be cut), 'stretch' = up to 15% horizontal stretch, the rest
 * by a small uniform zoom (less crop than cover). Only the <video> element gets a transform and a
 * clip; Kick's DOM and the 16:9 controls stay as they are. The stage's own overflow:hidden clips
 * the scaled picture; the clip-path is a second guard for stages without it. */
export type AspectMode = 'contain' | 'cover' | 'stretch';
export const ASPECT_MODES: readonly AspectMode[] = ['contain', 'cover', 'stretch'];
export const MAX_STRETCH = 1.15;
export const ASPECT_HOTKEY = 'u';

export interface Box { x: number; y: number; width: number; height: number }
export interface FillTransform { tx: number; ty: number; sx: number; sy: number; clip: { top: number; right: number; bottom: number; left: number } }

export function normalizeAspectMode(value: unknown): AspectMode | null {
  return value === 'contain' || value === 'cover' || value === 'stretch' ? value : null;
}

export function nextAspectMode(mode: AspectMode): AspectMode {
  return ASPECT_MODES[(ASPECT_MODES.indexOf(mode) + 1) % ASPECT_MODES.length]!;
}

/** The picture inside the element box under object-fit: contain. */
export function containedPicture(box: Box, videoWidth: number, videoHeight: number): Box {
  if (!(videoWidth > 0 && videoHeight > 0 && box.width > 0 && box.height > 0)) return box;
  const aspect = videoWidth / videoHeight;
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** Transform (about the box centre) that makes the picture fill the stage in `mode`; null when
 * nothing has to change (contain, no bands, or unusable sizes). Bands under 2% are ignored. */
export function fillTransform(mode: AspectMode, box: Box, picture: Box, stage: Box): FillTransform | null {
  if (mode === 'contain') return null;
  if (!(picture.width > 0 && picture.height > 0 && stage.width > 0 && stage.height > 0)) return null;
  const wide = stage.width / picture.width, tall = stage.height / picture.height;
  if (Math.abs(wide - tall) < 0.02) return null;
  let sx: number, sy: number;
  if (mode === 'cover') {
    sx = sy = Math.max(wide, tall);
  } else if (wide > tall) {
    const stretch = Math.min(wide / tall, MAX_STRETCH);
    sy = wide / stretch; sx = wide;
    if (sy < tall) sy = tall;
  } else {
    const stretch = Math.min(tall / wide, MAX_STRETCH);
    sx = tall / stretch; sy = tall;
    if (sx < wide) sx = wide;
  }
  const boxMidX = box.x + box.width / 2, boxMidY = box.y + box.height / 2;
  const picMidX = picture.x + picture.width / 2, picMidY = picture.y + picture.height / 2;
  const stageMidX = stage.x + stage.width / 2, stageMidY = stage.y + stage.height / 2;
  // After scaling about the box centre the picture centre moves; translate it onto the stage centre.
  const tx = stageMidX - (boxMidX + (picMidX - boxMidX) * sx);
  const ty = stageMidY - (boxMidY + (picMidY - boxMidY) * sy);
  // Visible stage mapped back into the element's own (untransformed) coordinates for clip-path.
  const toLocalX = (x: number) => boxMidX + (x - tx - boxMidX) / sx;
  const toLocalY = (y: number) => boxMidY + (y - ty - boxMidY) / sy;
  const left = Math.max(0, toLocalX(stage.x) - box.x), right = Math.max(0, box.x + box.width - toLocalX(stage.x + stage.width));
  const top = Math.max(0, toLocalY(stage.y) - box.y), bottom = Math.max(0, box.y + box.height - toLocalY(stage.y + stage.height));
  return { tx, ty, sx, sy, clip: { top, right, bottom, left } };
}

/** The black area around Kick's player: the nearest ancestor (or the fullscreen element) that is
 * larger than the element box and clips its content. */
export function findStage(video: HTMLElement): HTMLElement | null {
  const fullscreen = document.fullscreenElement;
  if (fullscreen instanceof HTMLElement && fullscreen !== video && fullscreen.contains(video)) return fullscreen;
  // Layout size, not the (possibly transformed) on-screen rectangle.
  const ownWidth = video.offsetWidth, ownHeight = video.offsetHeight;
  let node = video.parentElement;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    if (node === document.body) break;
    const style = getComputedStyle(node);
    const clips = /hidden|clip/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
    if (clips && (node.offsetWidth > ownWidth + 4 || node.offsetHeight > ownHeight + 4)) return node;
  }
  return null;
}

const rectOf = (element: Element): Box => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

const STYLE_ATTR = 'data-kickflow-aspect';
const AMBIENT_CLASS = 'kickflow-ambient';
const TOAST_CLASS = 'kickflow-aspect-toast';

class AspectController {
  private video: HTMLVideoElement | null = null;
  private stage: HTMLElement | null = null;
  private applied = false;
  private resize: ResizeObserver | null = null;
  private frame = 0;

  constructor(private readonly lifecycle: Lifecycle, private readonly getMode: () => AspectMode, private readonly ambient: () => boolean) {
    observeVideoElement(lifecycle, (video) => this.bind(video));
    lifecycle.addEventListener(document, 'fullscreenchange', () => this.schedule());
    lifecycle.addEventListener(window, 'resize', () => this.schedule());
    lifecycle.add(() => this.unbind());
  }

  private bind(video: HTMLVideoElement | null): void {
    if (video === this.video) return;
    this.unbind();
    this.video = video;
    if (!video) return;
    video.addEventListener('loadedmetadata', this.onMeta);
    video.addEventListener('resize', this.onMeta);
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => this.schedule());
      this.resize.observe(video);
    }
    this.schedule();
  }

  private readonly onMeta = (): void => this.schedule();

  private unbind(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resize?.disconnect();
    this.resize = null;
    if (this.video) {
      this.video.removeEventListener('loadedmetadata', this.onMeta);
      this.video.removeEventListener('resize', this.onMeta);
      this.clear(this.video);
    }
    this.video = null;
    this.stage = null;
  }

  schedule(): void {
    if (this.frame || this.lifecycle.isDisposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.apply(); });
  }

  private clear(video: HTMLVideoElement): void {
    if (!this.applied) return;
    video.style.removeProperty('transform');
    video.style.removeProperty('transform-origin');
    video.style.removeProperty('clip-path');
    video.removeAttribute(STYLE_ATTR);
    this.applied = false;
  }

  apply(): void {
    const video = this.video;
    if (!video || !video.isConnected) return;
    const mode = this.getMode();
    // Measure without our own transform: clear first, then read the plain layout.
    this.clear(video);
    const stage = findStage(video);
    this.stage = stage;
    if (stage && this.ambient()) ambientFor(stage, video, this.lifecycle);
    if (!stage || mode === 'contain') return;
    const box = rectOf(video);
    const picture = containedPicture(box, video.videoWidth, video.videoHeight);
    const plan = fillTransform(mode, box, picture, rectOf(stage));
    if (!plan) return;
    video.style.setProperty('transform-origin', '50% 50%');
    video.style.setProperty('transform', `translate(${plan.tx.toFixed(2)}px, ${plan.ty.toFixed(2)}px) scale(${plan.sx.toFixed(4)}, ${plan.sy.toFixed(4)})`);
    const c = plan.clip;
    video.style.setProperty('clip-path', `inset(${c.top.toFixed(1)}px ${c.right.toFixed(1)}px ${c.bottom.toFixed(1)}px ${c.left.toFixed(1)}px)`);
    video.setAttribute(STYLE_ATTR, mode);
    this.applied = true;
  }

  toast(text: string): void {
    const host = this.stage ?? this.video?.parentElement;
    if (!host) return;
    host.querySelector(`.${TOAST_CLASS}`)?.remove();
    const note = document.createElement('div');
    note.className = TOAST_CLASS;
    note.textContent = text;
    note.setAttribute('role', 'status');
    Object.assign(note.style, {
      position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '30',
      padding: '6px 12px', borderRadius: '6px', background: 'rgba(11,11,12,0.78)', color: '#fff',
      font: '600 13px/1.3 system-ui, sans-serif', pointerEvents: 'none',
    });
    host.append(note);
    window.setTimeout(() => note.remove(), 1400);
  }
}

// --- Ambient side bands -------------------------------------------------------------------------
// A small canvas first inside the stage, under Kick's player box (tree order, both positioned with
// z-index auto). It shows the blurred colours of the current frame; it draws 8 times a second, only
// while the page is visible, the video plays and the stage is wider or taller than the picture.
// drawImage of the video never reads pixels back, so a CORS-tainted frame would still draw.

const ambientByStage = new WeakMap<HTMLElement, { canvas: HTMLCanvasElement; stop: () => void }>();
let ambientActive: { stage: HTMLElement; stop: () => void } | null = null;

export function stopAmbient(): void {
  ambientActive?.stop();
  ambientActive = null;
}

function ambientFor(stage: HTMLElement, video: HTMLVideoElement, lifecycle: Lifecycle): void {
  if (ambientActive?.stage === stage && ambientByStage.get(stage)?.canvas.isConnected) return;
  stopAmbient();
  const canvas = document.createElement('canvas');
  canvas.className = AMBIENT_CLASS;
  canvas.width = 32; canvas.height = 18;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none',
    filter: 'blur(48px) saturate(1.3)', opacity: '0.55', transform: 'scale(1.15)',
  });
  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  stage.prepend(canvas);
  const context = canvas.getContext('2d');
  const timer = window.setInterval(() => {
    if (!context || document.visibilityState !== 'visible' || video.paused || video.readyState < 2) return;
    if (!canvas.isConnected) stage.prepend(canvas);
    try { context.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { /* frame not drawable yet */ }
  }, 125);
  const stop = () => { window.clearInterval(timer); canvas.remove(); ambientByStage.delete(stage); };
  ambientByStage.set(stage, { canvas, stop });
  ambientActive = { stage, stop };
  lifecycle.add(() => { if (ambientActive?.stage === stage) stopAmbient(); else stop(); });
}

// --- Feature entry points (one child lifecycle each, see bootstrap syncPlayerFeature) -----------

let controller: AspectController | null = null;
let ambientController: AspectController | null = null;
let modeChanged: ((mode: AspectMode) => void) | null = null;

export function aspectModeLabel(mode: AspectMode): string {
  return t(mode === 'cover' ? 'player.aspect_cover' : mode === 'stretch' ? 'player.aspect_stretch' : 'player.aspect_contain');
}

/** Bootstrap hands in the persist function so the hotkey reaches the same flag path as the panel. */
export function setAspectModeWriter(writer: (mode: AspectMode) => void): void {
  modeChanged = writer;
}

export function initUltrawideFill(lifecycle: Lifecycle): void {
  const current = new AspectController(lifecycle, () => normalizeAspectMode(featureFlags.aspectMode) ?? 'contain', () => false);
  controller = current;
  lifecycle.add(() => { if (controller === current) controller = null; });
  lifecycle.addEventListener(document, 'keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.defaultPrevented || key.repeat || key.ctrlKey || key.metaKey || key.altKey) return;
    if (key.key.toLowerCase() !== ASPECT_HOTKEY || isTypingTarget(key.target)) return;
    const next = nextAspectMode(normalizeAspectMode(featureFlags.aspectMode) ?? 'contain');
    modeChanged?.(next);
    current.toast(aspectModeLabel(next));
  }, true);
}

export function initAmbientBands(lifecycle: Lifecycle): void {
  const current = new AspectController(lifecycle, () => 'contain', () => true);
  ambientController = current;
  lifecycle.add(() => { if (ambientController === current) ambientController = null; stopAmbient(); });
}

/** Called after `aspectMode` changes (panel, side panel or hotkey). */
export function syncAspectMode(): void {
  controller?.schedule();
  ambientController?.schedule();
}
