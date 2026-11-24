import { logger } from '../shared/logger';
import { findPlayerWrapper, getVideoElement } from '../shared/selectors';
import { mountIntoControlBar } from './native-bar';
import type { Lifecycle } from '../shared/lifecycle';
import { formatHotkeyKey, getHotkeyBinding, subscribeHotkeyBindings } from './hotkey-registry';
import { subscribeLang, t } from '../shared/i18n';
import {captureFilename,captureStatus,createLocalClipButton,cancelLocalClip,refreshLocalClipButtons} from './local-clip';
import {createCameraIcon} from './bar-chrome.js';
import {showFrameToast as showSharedFrameToast} from './bar-shared.js';

let toastTimer: number | null = null;

/** FINAL 6.3 moment 4: one toast above the strip, with the frame and its file name, then gone.
 * At most one node; nothing keeps running after it leaves. The toast itself is bar-shared.js,
 * shared with a fallback player bar (2026-10-29). */
export function showFrameToast(url: string, filename: string): void {
  const host = document.fullscreenElement ?? findPlayerWrapper();
  if (!host) return;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = showSharedFrameToast(host, url, filename, t('player.frame_saved'));
}


const CONTROLS_ID = 'kickflow-screenshot-controls';

/** channel slug from the URL, sanitised for a filename (kick.com/<slug>). */

/** `<slug>_YYYY-MM-DD_HH-MM-SS.png` — filesystem-safe, sortable. */
function screenshotFilename(): string { return captureFilename('png'); }

/** Draws the CURRENT video frame to a canvas and triggers a PNG download. Kick's IVS
 * `<video>` is NOT cross-origin-tainted (verified live 2026-07-04: drawImage + toBlob
 * succeed), so this needs no extra permissions. Silently no-ops if no frame is decoded yet
 * (videoWidth 0) or if a future CORS change taints the canvas. */
export function captureFrame(video: HTMLVideoElement): boolean {
  if (!video.videoWidth || !video.videoHeight) {
    logger.debug('screenshot: no decoded frame yet, ignoring');
    captureStatus(t('player.capture_no_frame')); return false;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {captureStatus(t('player.capture_failed'));return false;}
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {captureStatus(t('player.capture_failed'));return;}
      const url = URL.createObjectURL(blob);
      const filename = screenshotFilename();
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showFrameToast(url, filename);
      // Revoke after the download has had time to start (immediate revoke can cancel it).
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, 'image/png');
    return true;
  } catch (error) {
    logger.warn('screenshot: capture failed (canvas may be CORS-tainted)', error);
    captureStatus(t('player.capture_failed'));return false;
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
  return captureFrame(video);
}

/** Mounts a camera button into the native control bar (after the rewind/catch-up controls);
 * click captures the current frame as a PNG download. */
export function initScreenshot(lifecycle: Lifecycle): void {
  lifecycle.add(cancelLocalClip);
  const video = getVideoElement();
  if (!video) {
    logger.debug('screenshot: #video-player not found, skipping');
    return;
  }

  let buttonEl: HTMLButtonElement | null = null;
  const updateHotkeyTitle = (): void => {
    refreshLocalClipButtons();
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

    group.append(button,createLocalClipButton());
    return group;
  });
}
