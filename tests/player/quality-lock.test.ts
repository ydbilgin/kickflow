import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GEAR_PATH_PREFIX,
  KNOWN_GEAR_PATH_PREFIXES,
  findQualityGearCandidates,
  initQualityLock,
} from '../../src/content/player/quality-lock';
import { Lifecycle } from '../../src/content/shared/lifecycle';

// The gear path is DERIVED from the production constant, never copied. A fixture that
// spells the prefix out keeps passing after Kick redraws the cog and the constant is
// updated — which is exactly what happened twice: 'M25.7' matched nothing on live Kick from
// some point before 2026-08-20 and 'M16.759' from some point before 2026-08-28, while this
// suite stayed green against a fixture that still drew the old icon.
function iconButton(pathD: string): HTMLButtonElement {
  const button = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.append(path);
  button.append(svg);
  return button;
}

/** Mirrors the live control bar measured on 2026-08-28: icon-only transport controls FIRST
 * (play/pause, volume — both unlabelled), then labelled/test-id'd controls, then the
 * icon-only settings cog LAST. That order is what makes the structural fallback safe, so the
 * fixture must reproduce it rather than a two-button toy bar.
 * Evidence: output/playwright/quality-lock-round101-probe.json */
function setupPlayer(gearPath = `${GEAR_PATH_PREFIX}-test-gear`): {
  gear: HTMLButtonElement;
  playPause: HTMLButtonElement;
  bar: HTMLElement;
} {
  const wrapper = document.createElement('div');
  const video = document.createElement('video');
  video.id = 'video-player';
  const bar = document.createElement('div');
  bar.className = 'z-controls bottom-0';

  const playPause = iconButton('M6.667 3.333C5.75 3.333 5 4.083 5 5v10c0');
  const volume = iconButton('M9.167 2.567a.83.83 0 0 0-.517.183L5.833');
  const live = document.createElement('button');
  live.textContent = 'LIVE';
  const seekBack = iconButton('M11.5 5.4v13.2L2.8 12z');
  seekBack.setAttribute('aria-label', 'Seek back 10 seconds');
  const fullscreen = iconButton('M16.667 1.667h-5v1.666h4.166c.459 0 .834');
  fullscreen.setAttribute('data-testid', 'video-player-fullscreen');
  const gear = iconButton(gearPath);

  bar.append(playPause, volume, live, seekBack, fullscreen, gear);
  wrapper.append(video, bar);
  document.body.append(wrapper);
  return { gear, playPause, bar };
}

/** A Radix-shaped quality menu, appended when `trigger` is pressed. */
function attachQualityMenu(trigger: HTMLElement, labels: readonly string[], checked: string): HTMLElement[] {
  const rows = labels.map((label) => {
    const row = document.createElement('button');
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', String(label === checked));
    row.textContent = label;
    return row;
  });
  trigger.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.append(...rows);
    document.body.append(menu);
  });
  return rows;
}

function stubEnvironment(): void {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test' },
    storage: { local: { get: vi.fn(async () => ({ 'kickflow.qualityPreference': 'highest' })), set: vi.fn() } },
  });
}

const ATTEMPT_BUDGET_MS = 1800 + 5 * (60 + 260 + 1300) + 500;

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('quality-lock lifecycle', () => {
  it('does not select a quality after its channel lifecycle is disposed mid-menu wait', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
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

  // Regression guard for the 2026-08-20 live finding: Kick redrew its cog, the shipped path
  // prefix stopped matching, and quality-lock gave up on every load while logging only at
  // debug — invisible unless the user flips a flag. The give-up MUST be visible by default.
  it('warns visibly when nothing in the control bar opens a quality menu', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A fully populated control bar whose cog matches no known path AND opens nothing.
    setupPlayer('M99.9-a-cog-that-opens-nothing');
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('KNOWN_GEAR_PATH_PREFIXES');
    lifecycle.dispose();
  });
});

// The 2026-08-28 round. Kick had redrawn the cog for the SECOND time in eight days, so icon
// identity alone is not a detector — these cover the structural fallback that replaced it.
describe('quality-lock gear discovery', () => {
  it('selects the highest quality when the cog matches no known path at all', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gear } = setupPlayer('M42.42-kick-redrew-the-cog-again');
    const rows = attachQualityMenu(gear, ['Auto', '1080p60Giriş gerekli', '720p60', '480p'], 'Auto');
    const picked = vi.fn();
    rows[2].addEventListener('click', picked);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);

    // 720p60 — not Auto, and not the login-gated 1080p60 row.
    expect(picked).toHaveBeenCalled();
    // And it SAYS the icon rotted, naming the live path, so the fast path can be restored.
    expect(warn.mock.calls.flat().join(' ')).toContain('M42.42-kick-redrew-the-cog-again');
    lifecycle.dispose();
  });

  it('never offers the leading icon-only transport controls as gear candidates', () => {
    const { gear, playPause } = setupPlayer('M42.42-unmatched');
    const candidates = findQualityGearCandidates().map((c) => c.button);

    // play/pause and volume are icon-only too. They lead the bar, so the "after the last
    // identified button" rule keeps them unreachable — pressing one would pause the stream.
    expect(candidates).toContain(gear);
    expect(candidates).not.toContain(playPause);
    expect(candidates).toHaveLength(1);
  });

  it('ignores KickFlow\'s own control-bar buttons', () => {
    const { bar } = setupPlayer('M42.42-unmatched');
    const ours = document.createElement('div');
    ours.id = 'kickflow-player-cluster';
    ours.append(iconButton('M0 0h1v1z'));
    bar.append(ours); // appended AFTER the cog: trailing, icon-only, and not Kick's

    expect(findQualityGearCandidates().every((c) => !c.button.closest('[id^="kickflow-"]'))).toBe(true);
  });

  it('still prefers a known cog path when one matches', () => {
    const { gear } = setupPlayer(`${KNOWN_GEAR_PATH_PREFIXES[1]}-older-icon`);
    const candidates = findQualityGearCandidates();

    expect(candidates[0].button).toBe(gear);
    expect(candidates[0].via).toBe('known-path');
  });
});

// STATUS round 100 recorded this collision as found-but-not-fixed: KickFlow's own `AUTO ▾`
// playback-speed menu renders `role="menuitemradio"` rows, and the old document-wide query
// read them as the quality menu, scored every row -1 and gave up.
describe('quality-lock menu scoping', () => {
  it('reads only the rows the gear press opened, not an already-open KickFlow speed menu', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const speedMenu = document.createElement('div');
    speedMenu.setAttribute('role', 'menu');
    for (const label of ['Auto', '1x', '1.5x', '2x']) {
      const row = document.createElement('button');
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', String(label === 'Auto'));
      row.textContent = label;
      speedMenu.append(row);
    }
    document.body.append(speedMenu); // our speed menu is open BEFORE quality-lock runs
    const rows = attachQualityMenu(gear, ['Auto', '1080p60', '720p60'], 'Auto');
    const picked = vi.fn();
    rows[1].addEventListener('click', picked);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);

    expect(picked).toHaveBeenCalled();
    lifecycle.dispose();
  });
});
