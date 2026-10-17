import { afterEach, describe, expect, it } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  initBarOrder,
  installBarOrder,
  removeBarOrder,
  syncBarOrderFlag,
} from '../../src/content/player/bar-order';
import { findQualityGearCandidates } from '../../src/content/player/quality-lock';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const originalFullscreenTerminal = featureFlags.fullscreenTerminal;

function iconButton(pathD: string): HTMLButtonElement {
  const button = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.append(path);
  button.append(svg);
  return button;
}

function setupPlayer(): { gear: HTMLButtonElement } {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';

  bar.append(
    iconButton('M6.667 3.333C5.75 3.333 5 4.083 5 5v10c0'),
    iconButton('M9.167 2.567a.83.83 0 0 0-.517.183L5.833'),
  );
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  bar.append(live);

  const fullscreen = iconButton('M16.667 1.667h-5v1.666h4.166c.459 0 .834');
  fullscreen.setAttribute('data-testid', 'video-player-fullscreen');
  bar.append(fullscreen);

  const gear = iconButton('M42.42-kick-redrew-the-cog-again');
  bar.append(gear);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return { gear };
}

afterEach(() => {
  featureFlags.fullscreenTerminal = originalFullscreenTerminal;
  removeBarOrder();
  document.body.replaceChildren();
});

describe('player bar order', () => {
  it('installs one style with the terminal fullscreen rule when the flag is on', () => {
    featureFlags.fullscreenTerminal = true;
    const lifecycle = new Lifecycle();
    initBarOrder(lifecycle);

    const style = document.getElementById('kickflow-bar-order');
    expect(style).toBeInstanceOf(HTMLStyleElement);
    expect(style?.textContent).toBe(
      'div.z-controls.bottom-0 button[data-testid="video-player-fullscreen"] { order: 1 }',
    );

    installBarOrder();
    expect(document.querySelectorAll('#kickflow-bar-order')).toHaveLength(1);
    lifecycle.dispose();
  });

  it('removes the style when the flag is off', () => {
    featureFlags.fullscreenTerminal = true;
    installBarOrder();
    expect(document.getElementById('kickflow-bar-order')).not.toBeNull();

    featureFlags.fullscreenTerminal = false;
    syncBarOrderFlag();

    expect(document.getElementById('kickflow-bar-order')).toBeNull();
  });

  it('keeps quality gear discovery in DOM order while the rule is installed', () => {
    featureFlags.fullscreenTerminal = true;
    installBarOrder();
    const { gear } = setupPlayer();

    expect(findQualityGearCandidates()).toEqual([{ button: gear, via: 'trailing-icon' }]);
  });
});
