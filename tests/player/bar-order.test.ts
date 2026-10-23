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
import { declarations, styleTemplate } from '../helpers/bootstrap-css';

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

// His 2026-10-21 screenshot: Kick's bar over a bright stream, chat text burned into the picture
// behind pause and mute. The dark fade (FINAL row 15, layer 1) must not depend on the cinema strip
// flag, or the flat fallback is unreadable again. The pixel proof is player-bar-visual.mjs --bright.
describe("dark fade under Kick's bar", () => {
  it("is painted on Kick's bar itself, with or without the strip", () => {
    const fade = declarations('div.z-controls.bottom-0::after');
    expect(fade).toContain("content: ''");
    expect(fade).toContain('position: absolute');
    expect(fade).toContain('bottom: 0');
    expect(fade).toContain('var(--kickflow-bar-shade, 0.60)');
    expect(fade).toContain('rgba(0,0,0,0) 9rem');
    expect(fade).toContain('pointer-events: none');
    expect(declarations('div.z-controls.bottom-0')).toContain('isolation: isolate');
  });

  it('has no strip-only copy that could drift from the shared one', () => {
    expect(styleTemplate()).not.toContain('html[data-kickflow-strip] div.z-controls.bottom-0::after');
  });

  it('removes the full-width capsule and darkens the fade for hover and keyboard focus', () => {
    expect(declarations('html[data-kickflow-strip] div.z-controls.bottom-0::before')).toContain('content: none');
    expect(declarations('div.z-controls.bottom-0:is(:hover, :focus-within)')).toContain('--kickflow-bar-shade: 0.70');
    const plate = declarations('.kickflow-player-group:is(:not(#kickflow-catchup-controls), .kickflow-player-group--chip)::before');
    expect(plate).toContain('backdrop-filter: blur(12px)');
  });
});
