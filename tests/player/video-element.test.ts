import { afterEach, describe, expect, it } from 'vitest';
import { bindVideoElementListener } from '../../src/content/player/video-element';
import { Lifecycle } from '../../src/content/shared/lifecycle';

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

function appendVideo(name: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.id = 'video-player';
  video.dataset.name = name;
  document.body.append(video);
  return video;
}

describe('video element listener rebinding', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves element-bound listeners to a replacement #video-player', async () => {
    const lifecycle = new Lifecycle();
    const first = appendVideo('first');
    const calls: string[] = [];

    bindVideoElementListener(lifecycle, 'timeupdate', (event) => {
      const video = event.currentTarget as HTMLVideoElement;
      calls.push(video.dataset.name ?? '');
    });

    first.dispatchEvent(new Event('timeupdate'));

    const second = document.createElement('video');
    second.id = 'video-player';
    second.dataset.name = 'second';
    first.replaceWith(second);
    await flushMutations();

    first.dispatchEvent(new Event('timeupdate'));
    second.dispatchEvent(new Event('timeupdate'));

    expect(calls).toEqual(['first', 'second']);
    lifecycle.dispose();
  });
});
