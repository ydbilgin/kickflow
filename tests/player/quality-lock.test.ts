import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEAR_PATH_PREFIX, initQualityLock } from '../../src/content/player/quality-lock';
import { Lifecycle } from '../../src/content/shared/lifecycle';

// The gear path is DERIVED from the production constant, never copied. A fixture that
// spells the prefix out keeps passing after Kick redraws the cog and the constant is
// updated — which is exactly what happened: the shipped 'M25.7' matched nothing on live
// Kick from some point before 2026-08-20, while this suite stayed green against a fixture
// that still drew the old icon.
function setupPlayer(gearPath = `${GEAR_PATH_PREFIX}-test-gear`): HTMLButtonElement {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  const gear = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', gearPath);
  svg.append(path);
  gear.append(svg);
  bar.append(live, gear);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return gear;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('quality-lock lifecycle', () => {
  it('does not select a quality after its channel lifecycle is disposed mid-menu wait', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('chrome', {
      runtime: { id: 'kickflow-test' },
      storage: { local: { get: vi.fn(async () => ({ 'kickflow.qualityPreference': 'highest' })), set: vi.fn() } },
    });
    const gear = setupPlayer();
    const quality = document.createElement('button');
    quality.setAttribute('role', 'menuitemradio');
    quality.textContent = '1080p60';
    const selected = vi.fn();
    quality.addEventListener('click', selected);
    gear.addEventListener('click', () => document.body.append(quality));
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(1800 + 60);
    expect(quality.isConnected).toBe(true);
    lifecycle.dispose();
    await vi.advanceTimersByTimeAsync(260);

    expect(selected).not.toHaveBeenCalled();
  });

  // Regression guard for the 2026-08-20 live finding: Kick redrew its cog, GEAR_PATH_PREFIX
  // stopped matching, and quality-lock gave up on every load while logging only at debug —
  // invisible unless the user flips a flag. The give-up MUST be visible by default, or the
  // next icon change goes unnoticed for weeks again.
  it('warns visibly when no button in the control bar matches the gear icon', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('chrome', {
      runtime: { id: 'kickflow-test' },
      storage: { local: { get: vi.fn(async () => ({ 'kickflow.qualityPreference': 'highest' })), set: vi.fn() } },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A fully populated control bar whose cog carries a path the constant does not match.
    setupPlayer('M99.9-kick-redrew-the-cog');
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    // APPLY_DELAY_MS + MAX_ATTEMPTS * (menu settle + RETRY_DELAY_MS), with headroom.
    await vi.advanceTimersByTimeAsync(1800 + 5 * (60 + 1300) + 500);

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('GEAR_PATH_PREFIX');
    lifecycle.dispose();
  });
});
