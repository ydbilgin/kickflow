import { logger } from '../shared/logger';
import { getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import type { Lifecycle } from '../shared/lifecycle';
import { formatHotkeyKey, getHotkeyBinding, subscribeHotkeyBindings } from './hotkey-registry';
import { subscribeLang, t } from '../shared/i18n';

const CONTROLS_ID = 'kickflow-screenshot-controls';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createCameraIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M3 9a2 2 0 0 1 2-2h2l1.2-1.7a1 1 0 0 1 .8-.4h6a1 1 0 0 1 .8.4L17 7h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');

  const lens = document.createElementNS(SVG_NS, 'circle');
  lens.setAttribute('cx', '12');
  lens.setAttribute('cy', '13');
  lens.setAttribute('r', '3.2');

  svg.append(body, lens);
  return svg;
}

/** channel slug from the URL, sanitised for a filename (kick.com/<slug>). */
function channelSlug(): string {
  const seg = location.pathname.replace(/^\/+/, '').split('/')[0] || 'kick';
  return seg.replace(/[^a-z0-9_-]/gi, '') || 'kick';
}

/** `<slug>_YYYY-MM-DD_HH-MM-SS.png` — filesystem-safe, sortable. */
function screenshotFilename(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `${channelSlug()}_${stamp}.png`;
}

/** Draws the CURRENT video frame to a canvas and triggers a PNG download. Kick's IVS
 * `<video>` is NOT cross-origin-tainted (verified live 2026-07-04: drawImage + toBlob
 * succeed), so this needs no extra permissions. Silently no-ops if no frame is decoded yet
 * (videoWidth 0) or if a future CORS change taints the canvas. */
export function captureFrame(video: HTMLVideoElement): void {
  if (!video.videoWidth || !video.videoHeight) {
    logger.debug('screenshot: no decoded frame yet, ignoring');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = screenshotFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke after the download has had time to start (immediate revoke can cancel it).
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, 'image/png');
  } catch (error) {
    logger.warn('screenshot: capture failed (canvas may be CORS-tainted)', error);
  }
}

/** Shared by the camera button and the rebindable hotkey. Resolves the video at action time so
 * a React player swap cannot leave either path capturing a detached element. */
export function captureScreenshot(): boolean {
  const video = getVideoElement();
  if (!video) {
    logger.warn('screenshot: #video-player not found at capture time');
    return false;
  }
  captureFrame(video);
  return true;
}

/** Mounts a camera button into the native control bar (after the rewind/catch-up controls);
 * click captures the current frame as a PNG download. */
export function initScreenshot(lifecycle: Lifecycle): void {
  const video = getVideoElement();
  if (!video) {
    logger.debug('screenshot: #video-player not found, skipping');
    return;
  }

  let buttonEl: HTMLButtonElement | null = null;
  const updateHotkeyTitle = (): void => {
    if (!buttonEl) return;
    const binding = getHotkeyBinding('screenshot');
    buttonEl.title = `${t('player.screenshot')}${binding.enabled ? ` (${formatHotkeyKey(binding.key)})` : ''}`;
    buttonEl.setAttribute('aria-label', t('player.screenshot'));
  };
  lifecycle.add(subscribeHotkeyBindings(updateHotkeyTitle));
  lifecycle.add(subscribeLang(updateHotkeyTitle));

  mountIntoControlBar(lifecycle, CONTROLS_ID, () => {
    const group = document.createElement('span');
    group.className = 'kickflow-player-group';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kickflow-player-btn';
    button.append(createCameraIcon());
    buttonEl = button;
    updateHotkeyTitle();

    // Plain listener (not Lifecycle-routed) — see rewind-controls.ts: native-bar.ts rebuilds
    // this button on control-bar re-render, so a plain listener is GC'd with the node.
    // Resolve the video FRESH at click time: Kick can swap the <video> on an in-channel player
    // re-render, which would leave the init-time reference pointing at a stale detached node.
    button.addEventListener('click', () => {
      captureScreenshot();
    });

    group.append(button);
    return group;
  });
}
