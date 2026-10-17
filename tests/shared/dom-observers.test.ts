import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenElementPresent } from '../../src/content/shared/dom-observers';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { SELECTORS, getVideoElement } from '../../src/content/shared/selectors';

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('whenElementPresent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('calls onPresent synchronously when the element already exists', () => {
    const lifecycle = new Lifecycle();
    const existing = document.createElement('div');
    existing.id = 'ready';
    document.body.append(existing);
    const onPresent = vi.fn();

    whenElementPresent('#ready', lifecycle, onPresent);

    expect(onPresent).toHaveBeenCalledTimes(1);
    expect(onPresent).toHaveBeenCalledWith(existing);
    lifecycle.dispose();
  });

  it('fires once when an element is appended later', async () => {
    const lifecycle = new Lifecycle();
    const onPresent = vi.fn();

    whenElementPresent('#late', lifecycle, onPresent);
    expect(onPresent).not.toHaveBeenCalled();

    const late = document.createElement('div');
    late.id = 'late';
    document.body.append(late);
    await flushMutations();

    const extra = document.createElement('div');
    document.body.append(extra);
    await flushMutations();

    expect(onPresent).toHaveBeenCalledTimes(1);
    expect(onPresent).toHaveBeenCalledWith(late);
    lifecycle.dispose();
  });

  it('can wait for a selector to resolve to an actual video element', async () => {
    const lifecycle = new Lifecycle();
    document.body.innerHTML = '<div id="video-player"></div>';
    const onPresent = vi.fn();

    whenElementPresent<HTMLVideoElement>(SELECTORS.videoPlayer, lifecycle, onPresent, { resolve: getVideoElement });
    expect(onPresent).not.toHaveBeenCalled();

    const video = document.createElement('video');
    video.id = 'video-player';
    document.getElementById('video-player')?.replaceWith(video);
    await flushMutations();

    expect(onPresent).toHaveBeenCalledTimes(1);
    expect(onPresent).toHaveBeenCalledWith(video);
    lifecycle.dispose();
  });
});
