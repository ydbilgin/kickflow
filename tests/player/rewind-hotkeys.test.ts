import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { initRewindHotkeys, isTypingTarget } from '../../src/content/player/rewind-hotkeys';
import { resetHotkeyBindings, updateHotkeyBinding } from '../../src/content/player/hotkey-registry';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';

beforeEach(() => {
  resetHotkeyBindings();
  featureFlags.rewindControls = true;
});

afterEach(() => {
  document.body.replaceChildren();
});

function setupVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.id = 'video-player';
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: 13.4, writable: true },
    buffered: { configurable: true, value: fakeTimeRanges([[0, 46.6]]) },
    seekable: { configurable: true, value: fakeTimeRanges([[0, 2 ** 30]]) },
  });
  document.body.append(video);
  return video;
}

describe('rewind hotkeys', () => {
  it('handles Left-arrow before a competing Kick bubble listener can snap the player to stream start', () => {
    const video = setupVideo();

    // This models a native Kick document-level bubble handler. It is registered first, as it
    // would be when the page booted before the extension. The extension must consume ArrowLeft
    // in capture phase so both handlers cannot write currentTime for a single key press.
    const nativeHandler = (event: Event) => {
      if ((event as KeyboardEvent).key === 'ArrowLeft') video.currentTime = 0;
    };
    document.addEventListener('keydown', nativeHandler);

    const lifecycle = new Lifecycle();
    initRewindHotkeys(lifecycle);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowLeft',
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(video.currentTime).toBeCloseTo(3.4, 8);
    lifecycle.dispose();
    document.removeEventListener('keydown', nativeHandler);
  });

  it('reads a live rebound key from the registry instead of retaining a hardcoded arrow path', () => {
    const video = setupVideo();
    const lifecycle = new Lifecycle();
    initRewindHotkeys(lifecycle);
    expect(updateHotkeyBinding('rewind', { key: 'a' }).ok).toBe(true);

    const oldKey = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' });
    document.dispatchEvent(oldKey);
    expect(oldKey.defaultPrevented).toBe(false);
    expect(video.currentTime).toBeCloseTo(13.4, 8);

    const rebound = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'A' });
    document.dispatchEvent(rebound);
    expect(rebound.defaultPrevented).toBe(true);
    expect(video.currentTime).toBeCloseTo(3.4, 8);
    lifecycle.dispose();
  });

  it('never fires a configured action from typing targets', () => {
    const video = setupVideo();
    const input = document.createElement('input');
    document.body.append(input);
    const lifecycle = new Lifecycle();
    initRewindHotkeys(lifecycle);

    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' });
    input.dispatchEvent(event);

    expect(isTypingTarget(input)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(video.currentTime).toBeCloseTo(13.4, 8);
    lifecycle.dispose();
  });

  it('leaves a matched key untouched when either its action or player feature is disabled', () => {
    const video = setupVideo();
    const lifecycle = new Lifecycle();
    initRewindHotkeys(lifecycle);
    updateHotkeyBinding('rewind', { enabled: false });

    const disabledAction = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' });
    document.dispatchEvent(disabledAction);
    expect(disabledAction.defaultPrevented).toBe(false);

    updateHotkeyBinding('rewind', { enabled: true });
    featureFlags.rewindControls = false;
    const disabledFeature = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' });
    document.dispatchEvent(disabledFeature);
    expect(disabledFeature.defaultPrevented).toBe(false);
    expect(video.currentTime).toBeCloseTo(13.4, 8);
    lifecycle.dispose();
  });
});
