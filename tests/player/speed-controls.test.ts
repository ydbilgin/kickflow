import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSpeedControls } from '../../src/content/player/speed-controls';
import { setAutoMode, setManualRate } from '../../src/content/player/player-state';
import { Lifecycle } from '../../src/content/shared/lifecycle';

function setupPlayerBar(): void {
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
}

afterEach(() => {
  vi.useRealTimers();
  setAutoMode();
  document.body.replaceChildren();
});

describe('speed controls native-bar remounting', () => {
  it('keeps the speed button reference connected and updating after a native-bar remount', async () => {
    vi.useFakeTimers();
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    await Promise.resolve();

    setManualRate(1.5);
    const originalButton = document.querySelector<HTMLButtonElement>('#kickflow-speed-controls button');
    const group = document.getElementById('kickflow-speed-controls') as HTMLElement;
    expect(originalButton?.textContent).toBe('1.5×');
    expect(originalButton?.classList.contains('kickflow-speed-btn--manual')).toBe(true);

    group.remove();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('kickflow-speed-controls')).toBe(group);
    expect(document.querySelector('#kickflow-speed-controls button')).toBe(originalButton);

    setManualRate(2);
    expect(originalButton?.textContent).toBe('2×');

    lifecycle.dispose();
  });
});

// FINAL design 2026-10-18 (player-bar.html moment 2), added 2026-10-21.
describe('speed button and menu, FINAL design', () => {
  function speedButton(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('#kickflow-speed-controls button') as HTMLButtonElement;
  }

  it('reads "1× AUTO" at rest and shows the bolt and the rate while auto catch-up runs', () => {
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    expect(speedButton().querySelector('.kickflow-speed-btn__value')?.textContent).toBe('1×');
    expect(speedButton().querySelector('.kickflow-speed-btn__auto')?.textContent).toBe('AUTO');
    expect(speedButton().querySelector('svg')).toBeNull();

    const video = document.getElementById('video-player') as HTMLVideoElement;
    video.playbackRate = 1.5;
    video.dispatchEvent(new Event('ratechange'));
    expect(speedButton().classList.contains('kickflow-speed-btn--catch')).toBe(true);
    expect(speedButton().querySelector('svg.kickflow-speed-btn__bolt')).not.toBeNull();
    expect(speedButton().querySelector('.kickflow-speed-btn__value')?.textContent).toBe('1.5×');
    lifecycle.dispose();
  });

  it('opens a 3 x 3 grid slow to fast with the Auto switch on top, keyboard first', () => {
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    speedButton().click();
    const menu = document.querySelector('.kickflow-speed-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.kickflow-speed-menu__item'));
    expect(items.map((item) => item.textContent)).toEqual(
      ['0.25×', '0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×', '2.5×', '3×']);
    const auto = menu.querySelector<HTMLButtonElement>('.kickflow-speed-menu__auto') as HTMLButtonElement;
    expect(auto.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(auto); // auto mode: focus starts on the switch

    auto.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[4]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.kickflow-speed-menu')).toBeNull();
    expect(document.activeElement).toBe(speedButton()); // Esc hands focus back
    lifecycle.dispose();
  });

  it('picks a speed from the grid, frames the button as manual, and the switch hands it back', () => {
    setupPlayerBar();
    const lifecycle = new Lifecycle();
    initSpeedControls(lifecycle);
    speedButton().click();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.kickflow-speed-menu__item'));
    items[5].click(); // 1.5x
    expect(speedButton().textContent).toBe('1.5×');
    expect(speedButton().classList.contains('kickflow-speed-btn--manual')).toBe(true);

    speedButton().click();
    expect(document.activeElement?.textContent).toBe('1.5×'); // focus starts on the chosen speed
    (document.querySelector('.kickflow-speed-menu__auto') as HTMLButtonElement).click();
    expect(speedButton().classList.contains('kickflow-speed-btn--manual')).toBe(false);
    expect(speedButton().querySelector('.kickflow-speed-btn__auto')).not.toBeNull();
    lifecycle.dispose();
  });
});
