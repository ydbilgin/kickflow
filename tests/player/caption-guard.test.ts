import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTIONS_PREFERENCE_KEY,
  getNativeCaptionState,
  initCaptionGuard,
} from '../../src/content/player/caption-guard';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const ACTIVE_ICON_PATH = 'M20 17.999H0V2H20V17.999Z';
const INACTIVE_ICON_PATH = 'M8.99973 7.99921L5.99982 7.99994V12.0003H8.99973';

function setupPlayer(state?: 'on' | 'off'): { bar: HTMLElement; button: HTMLButtonElement | null } {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  bar.append(live);
  wrapper.append(video, bar);
  document.body.append(wrapper);

  if (!state) return { bar, button: null };
  const button = appendCaptionButton(bar, state);
  return { bar, button };
}

function appendCaptionButton(parent: HTMLElement, state: 'on' | 'off'): HTMLButtonElement {
  const button = document.createElement('button');
  button.dataset.testid = 'video-player-closed-captions';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', state === 'on' ? ACTIVE_ICON_PATH : INACTIVE_ICON_PATH);
  svg.append(path);
  if (state === 'off') {
    svg.append(
      document.createElementNS('http://www.w3.org/2000/svg', 'path'),
      document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    );
  }
  button.append(svg);
  parent.append(button);
  return button;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('caption persistence guard', () => {
  it('recognizes Kick\'s current active and inactive native CC icons', () => {
    const active = setupPlayer('on').button!;
    expect(getNativeCaptionState(active)).toBe(true);

    const inactive = setupPlayer('off').button!;
    expect(getNativeCaptionState(inactive)).toBe(false);

    inactive.setAttribute('aria-pressed', 'true');
    expect(getNativeCaptionState(inactive)).toBe(true);
  });

  it('resets a persisted true preference and turns off an already-active native control once', () => {
    localStorage.setItem(CAPTIONS_PREFERENCE_KEY, 'true');
    const button = setupPlayer('on').button!;
    const click = vi.spyOn(button, 'click');
    const lifecycle = new Lifecycle();

    initCaptionGuard(lifecycle);

    expect(localStorage.getItem(CAPTIONS_PREFERENCE_KEY)).toBe('false');
    expect(click).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('settles on an inactive control and does not fight a later manual enable', async () => {
    vi.useFakeTimers();
    const button = setupPlayer('off').button!;
    const click = vi.spyOn(button, 'click');
    const lifecycle = new Lifecycle();

    initCaptionGuard(lifecycle);
    expect(click).not.toHaveBeenCalled();

    button.querySelector('path')?.setAttribute('d', ACTIVE_ICON_PATH);
    button.click();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(click).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('waits for a delayed native control and stops retrying after lifecycle disposal', async () => {
    vi.useFakeTimers();
    const first = setupPlayer();
    const lifecycle = new Lifecycle();
    initCaptionGuard(lifecycle);

    const active = appendCaptionButton(first.bar, 'on');
    const activeClick = vi.spyOn(active, 'click');
    await vi.advanceTimersByTimeAsync(250);
    expect(activeClick).toHaveBeenCalledOnce();

    lifecycle.dispose();
    active.remove();
    const replacement = appendCaptionButton(first.bar, 'on');
    const replacementClick = vi.spyOn(replacement, 'click');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(replacementClick).not.toHaveBeenCalled();
  });
});
