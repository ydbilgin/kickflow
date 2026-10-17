import { afterEach, describe, expect, it } from 'vitest';
import { findControlBarInsertionAnchor, findLiveButton } from '../../src/content/shared/selectors';

function setupPlayerBar(label: string): HTMLButtonElement {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const button = document.createElement('button');
  button.textContent = label;
  bar.append(button);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('findControlBarInsertionAnchor', () => {
  function recordedBar(): { bar: HTMLElement; left: HTMLElement; time: HTMLElement; fullscreen: HTMLButtonElement } {
    const bar = setupPlayerBar('placeholder').parentElement!;
    const left = document.createElement('div');
    left.className = 'flex flex-row items-center gap-2 lg:gap-0';
    const volume = document.createElement('div');
    volume.append(document.createElement('button'));
    const time = document.createElement('span');
    time.textContent = '00:05 / 05:30:35';
    left.append(document.createElement('button'), volume, time);
    const right = document.createElement('div');
    right.className = left.className;
    const fullscreen = document.createElement('button');
    fullscreen.dataset.testid = 'video-player-fullscreen';
    right.append(fullscreen);
    bar.replaceChildren(left, right);
    return { bar, left, time, fullscreen };
  }

  it('uses the final native transport child without relying on a LIVE label or video duration', () => {
    const { left, time } = recordedBar();
    const own = document.createElement('span');
    own.id = 'kickflow-speed-controls';
    const ownLive = document.createElement('button');
    ownLive.textContent = 'CANLI';
    own.append(ownLive);
    left.append(own);

    expect(findLiveButton()).toBeNull();
    expect(findControlBarInsertionAnchor()).toBe(time);
  });

  it('requires the fullscreen group to belong to the active player bar', () => {
    const { fullscreen } = recordedBar();
    document.body.append(fullscreen);

    expect(findControlBarInsertionAnchor()).toBeNull();
  });

  it('does not count injected buttons as native transport controls', () => {
    const { left } = recordedBar();
    const buttons = Array.from(left.querySelectorAll('button'));
    const own = document.createElement('span');
    own.id = 'kickflow-rewind-controls';
    own.append(buttons[1]);
    left.append(own);

    expect(findControlBarInsertionAnchor()).toBeNull();
  });
});

describe('findLiveButton', () => {
  it.each([
    'LIVE',
    'CANLI',
    'Go to live',
    'Go live',
    'Jump to live',
    'Canlı Yayına Geç',
    'CANLI YAYINA DÖN',
    'YAYINA GEC',
  ])(
    'finds the native live anchor labelled %s',
    (label) => {
      const button = setupPlayerBar(label);

      expect(findLiveButton()).toBe(button);
    },
  );

  it('does not match an unrelated control-bar button', () => {
    setupPlayerBar('Watch live channels');

    expect(findLiveButton()).toBeNull();
  });

  it('does not match LIVE outside the active player control bar', () => {
    const outside = document.createElement('button');
    outside.textContent = 'LIVE';
    document.body.append(outside);
    setupPlayerBar('Settings');

    expect(findLiveButton()).toBeNull();
  });

  it('does not mistake KickFlow\'s own CANLI control for the native anchor', () => {
    const nativeButton = setupPlayerBar('Settings');
    const kickflowGroup = document.createElement('span');
    kickflowGroup.id = 'kickflow-catchup-controls';
    const kickflowButton = document.createElement('button');
    kickflowButton.textContent = 'CANLI';
    kickflowGroup.append(kickflowButton);
    nativeButton.parentElement?.append(kickflowGroup);

    expect(findLiveButton()).toBeNull();
  });
});
