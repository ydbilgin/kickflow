import { afterEach, describe, expect, it } from 'vitest';
import { initRewindHotkeys } from '../../src/content/player/rewind-hotkeys';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { fakeTimeRanges } from '../helpers/timeRanges';

afterEach(() => {
  document.body.replaceChildren();
});

describe('rewind hotkeys', () => {
  it('handles Left-arrow before a competing Kick bubble listener can snap the player to stream start', () => {
    const video = document.createElement('video');
    video.id = 'video-player';
    Object.defineProperties(video, {
      currentTime: { configurable: true, value: 13.4, writable: true },
      buffered: { configurable: true, value: fakeTimeRanges([[0, 46.6]]) },
      seekable: { configurable: true, value: fakeTimeRanges([[0, 2 ** 30]]) },
    });
    document.body.append(video);

    // This models a native Kick document-level bubble handler. It is registered first, as it
    // would be when the page booted before the extension. The extension must consume ArrowLeft
    // in capture phase so both handlers cannot write currentTime for a single key press.
    document.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'ArrowLeft') video.currentTime = 0;
    });

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
  });
});
