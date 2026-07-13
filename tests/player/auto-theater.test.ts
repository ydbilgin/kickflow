import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  findTheaterButton,
  initAutoTheater,
  isTheaterModeActive,
  syncAutoTheaterFlag,
} from '../../src/content/player/auto-theater';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function setupPlayer(label = 'Tiyatro modu (t)', technicalId = ''): HTMLButtonElement {
  document.body.innerHTML = `
    <div class="group/main" data-theatre="false">
      <div id="player-wrapper">
        <video id="video-player"></video>
        <div class="z-controls bottom-0">
          <button type="button">LIVE</button>
          <button type="button" ${technicalId ? `data-testid="${technicalId}"` : ''} aria-label="${label}">
            <svg viewBox="0 0 32 32"><path d="M4 6h24v20H4z"></path></svg>
          </button>
        </div>
      </div>
    </div>`;
  return document.querySelectorAll<HTMLButtonElement>('.z-controls button')[1];
}

afterEach(() => {
  featureFlags.autoTheater = false;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('auto theater', () => {
  it('finds the native toggle independently of Turkish/English display text', () => {
    const turkish = setupPlayer('Tiyatro modu (t)');
    expect(findTheaterButton()).toBe(turkish);

    const english = setupPlayer('Theatre Mode (t)');
    expect(findTheaterButton()).toBe(english);

    const metadataOnly = setupPlayer('任何语言', 'video-player-theatre-toggle');
    expect(findTheaterButton()).toBe(metadataOnly);
  });

  it('never clicks the theater control while the flag is off', () => {
    const button = setupPlayer();
    const click = vi.spyOn(button, 'click');
    const lifecycle = new Lifecycle();
    featureFlags.autoTheater = false;

    initAutoTheater(lifecycle);
    syncAutoTheaterFlag();

    expect(click).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('does nothing when Kick already reports theater mode active', () => {
    const button = setupPlayer();
    document.querySelector<HTMLElement>('[data-theatre]')?.setAttribute('data-theatre', 'true');
    const click = vi.spyOn(button, 'click');
    const lifecycle = new Lifecycle();
    featureFlags.autoTheater = true;

    expect(isTheaterModeActive(button)).toBe(true);
    initAutoTheater(lifecycle);

    expect(click).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('enters once on load and self-heals across SPA navigation and video swaps', async () => {
    const firstButton = setupPlayer();
    const firstClick = vi.spyOn(firstButton, 'click');
    const lifecycle = new Lifecycle();
    featureFlags.autoTheater = true;
    initAutoTheater(lifecycle);
    expect(firstClick).toHaveBeenCalledOnce();

    const secondButton = firstButton.cloneNode(true) as HTMLButtonElement;
    const secondClick = vi.spyOn(secondButton, 'click');
    firstButton.replaceWith(secondButton);
    window.dispatchEvent(new Event('kickflow:locationchange'));
    expect(secondClick).toHaveBeenCalledOnce();

    const thirdButton = secondButton.cloneNode(true) as HTMLButtonElement;
    const thirdClick = vi.spyOn(thirdButton, 'click');
    secondButton.replaceWith(thirdButton);
    const replacementVideo = document.createElement('video');
    replacementVideo.id = 'video-player';
    document.getElementById('video-player')?.replaceWith(replacementVideo);
    await Promise.resolve();

    expect(thirdClick).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });
});
