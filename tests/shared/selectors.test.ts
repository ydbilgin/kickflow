import { afterEach, describe, expect, it } from 'vitest';
import { findLiveButton } from '../../src/content/shared/selectors';

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
