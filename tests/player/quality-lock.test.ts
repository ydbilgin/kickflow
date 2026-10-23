import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let GEAR_PATH_PREFIX: typeof import('../../src/content/player/quality-lock').GEAR_PATH_PREFIX;
let KNOWN_GEAR_PATH_PREFIXES: typeof import('../../src/content/player/quality-lock').KNOWN_GEAR_PATH_PREFIXES;
let findQualityGearCandidates: typeof import('../../src/content/player/quality-lock').findQualityGearCandidates;
let initQualityLock: typeof import('../../src/content/player/quality-lock').initQualityLock;
let logger: typeof import('../../src/content/shared/logger').logger;
import { Lifecycle } from '../../src/content/shared/lifecycle';

beforeEach(async () => {
  // Each test represents a fresh page; individual tests can recreate controllers on that page.
  vi.resetModules();
  ({ GEAR_PATH_PREFIX, KNOWN_GEAR_PATH_PREFIXES, findQualityGearCandidates, initQualityLock }
    = await import('../../src/content/player/quality-lock'));
  ({ logger } = await import('../../src/content/shared/logger'));
});

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
    row.addEventListener('click', () => {
      for (const option of rows) option.setAttribute('aria-checked', String(option === row));
    });
    return row;
  });
  trigger.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.append(...rows);
    document.body.append(menu);
    document.addEventListener('keydown', () => menu.remove(), { once: true, capture: true });
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

const ATTEMPT_BUDGET_MS = 20_000;

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('quality-lock lifecycle', () => {
  it('diagnoses once per document without warnings when the native quality menu is unavailable', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');
    const failures = () => diagnostic.mock.calls.filter((args) => String(args[0]).includes('highest quality could not be confirmed'));
    setupPlayer();
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(warn).not.toHaveBeenCalled();
      expect(failures()).toHaveLength(1);
      document.getElementById('video-player')!.dispatchEvent(new Event('loadstart'));
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(warn).not.toHaveBeenCalled();
      expect(failures()).toHaveLength(1);
    } finally {
      lifecycle.dispose();
    }
  });

  it('stays quiet without a rendered player bar and applies quality when the source later loads', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bar, gear } = setupPlayer();
    const wrapper = bar.parentElement!;
    bar.remove();
    const rows = attachQualityMenu(gear, ['Auto', '720p60', '480p'], 'Auto');
    const picked = vi.fn();
    rows[1].addEventListener('click', picked);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(warn).not.toHaveBeenCalled();
      wrapper.append(bar);
      document.getElementById('video-player')!.dispatchEvent(new Event('loadstart'));
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(picked).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      lifecycle.dispose();
    }
  });

  it('retains a developer diagnostic when rendered controls no longer match the selector', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');
    const { bar } = setupPlayer();
    bar.className = 'renamed-native-controls';
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(warn).not.toHaveBeenCalled();
      expect(diagnostic.mock.calls.flat().join(' ')).toContain('highest quality could not be confirmed');
    } finally {
      lifecycle.dispose();
    }
  });

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

  it('keeps an unavailable optional quality menu out of the extension error list', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');
    // A fully populated control bar whose cog matches no known path AND opens nothing.
    setupPlayer('M99.9-a-cog-that-opens-nothing');
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);

    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);

    expect(warn).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls.flat().join(' ')).toContain('highest quality could not be confirmed');
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
    // A successful structural discovery is quiet even if the icon path is unfamiliar.
    expect(warn).not.toHaveBeenCalled();
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

  it('uses a known cog path when no semantic or trailing structure identifies it', () => {
    const { gear, bar } = setupPlayer(`${KNOWN_GEAR_PATH_PREFIXES[1]}-older-icon`);
    bar.insertBefore(gear, bar.querySelector('[data-testid="video-player-fullscreen"]'));
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

/** Rebuild rows on every native opening and expose the player's actual selected state.
 * Unlike a click spy alone, this lets verification fail when Kick ignores/resets a press. */
function changingQualityMenu(gear: HTMLElement, labels = ['Auto', '1080p60', '720p60']) {
  const state = {
    labels,
    checked: 'Auto',
    opens: 0,
    picks: [] as string[],
    renderDelay: 0,
    accept: (_label: string): boolean => true,
    afterPick: (_label: string): void => {},
  };
  gear.addEventListener('click', () => {
    state.opens += 1;
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const render = (): void => {
      for (const label of state.labels) {
        const row = document.createElement('button');
        row.setAttribute('role', 'menuitemradio');
        row.setAttribute('aria-checked', String(state.checked === label));
        row.textContent = label;
        row.addEventListener('click', () => {
          state.picks.push(label);
          if (state.accept(label)) state.checked = label;
          state.afterPick(label);
        });
        menu.append(row);
      }
      document.body.append(menu);
      document.addEventListener('keydown', () => menu.remove(), { once: true, capture: true });
    };
    if (state.renderDelay) window.setTimeout(render, state.renderDelay);
    else render();
  });
  return state;
}

describe('quality-lock source readiness and verification', () => {
  it.each(['live', 'vod'])('recovers when the %s quality list arrives after the old retry budget', async (kind) => {
    stubEnvironment();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gear, bar } = setupPlayer();
    if (kind === 'vod') bar.querySelectorAll('button')[2].remove();
    const video = document.getElementById('video-player')!;
    Object.defineProperty(video, 'duration', { value: kind === 'live' ? Infinity : 1200 });
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    const state = changingQualityMenu(gear);
    video.dispatchEvent(new Event('canplay'));
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.checked).toBe('1080p60');
    expect(state.picks).toEqual(['1080p60']);
    expect(state.opens).toBeGreaterThan(1); // the selected state was read back
    lifecycle.dispose();
  });

  it('waits for a native menu that renders later than 260ms', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    state.renderDelay = 800;
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.checked).toBe('1080p60');
    expect(state.picks).toEqual(['1080p60']);
    lifecycle.dispose();
  });

  it('reselects when Kick resets Auto after the first selection', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    state.afterPick = () => {
      if (state.picks.length === 1) window.setTimeout(() => { state.checked = 'Auto'; }, 500);
    };
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toEqual(['1080p60', '1080p60']);
    expect(state.checked).toBe('1080p60');
    expect(state.opens).toBe(3);
    lifecycle.dispose();
  });

  it('does not treat an ignored native selection as success', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    state.accept = () => state.picks.length > 1;
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toHaveLength(2);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('cancels a stale menu and preserves a loadstart received while running', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear, ['Auto', '720p60']);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(1800 + 60);
    state.labels = ['Auto', '1080p60', '720p60'];
    document.getElementById('video-player')!.dispatchEvent(new Event('loadstart'));
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toEqual(['1080p60']);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('reconciles a reset at playing after an earlier successful pass, even without loadstart', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    state.checked = 'Auto';
    document.getElementById('video-player')!.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toHaveLength(2);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('rearms when an already-loaded video replaces the original without a new loadstart', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    state.checked = 'Auto';
    const replacement = document.createElement('video');
    replacement.id = 'video-player';
    document.getElementById('video-player')!.replaceWith(replacement);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toHaveLength(2);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('waits for a late video when initialized before the player mounts', async () => {
    stubEnvironment();
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('recovers on late native control mount without any further media event', async () => {
    stubEnvironment();
    const { gear, bar } = setupPlayer();
    const wrapper = bar.parentElement!;
    bar.remove();
    const state = changingQualityMenu(gear);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    wrapper.append(bar);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.checked).toBe('1080p60');
    lifecycle.dispose();
  });

  it('rearms between a disposed live session and a VOD session sharing the video', async () => {
    stubEnvironment();
    const { gear, bar } = setupPlayer();
    const state = changingQualityMenu(gear);
    const live = new Lifecycle();
    initQualityLock(live);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    live.dispose();
    bar.querySelectorAll('button')[2].remove();
    state.labels = ['Auto', 'Source', '1080p60'];
    state.checked = 'Auto';
    const vod = new Lifecycle();
    initQualityLock(vod);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.picks).toEqual(['1080p60', 'Source']);
    expect(state.checked).toBe('Source');
    vod.dispose();
  });

  it('stops after five rejected selections and ignores repeated readiness events', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear);
    state.accept = () => false;
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.opens).toBe(5);
    expect(warn).not.toHaveBeenCalled();
    const video = document.getElementById('video-player')!;
    video.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    const opens = state.opens;
    for (let i = 0; i < 20; i++) video.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.opens).toBe(opens);
    expect(vi.getTimerCount()).toBe(0);
    lifecycle.dispose();
  });

  it('disconnects readiness and mount recovery when disposed', async () => {
    stubEnvironment();
    const { gear, bar } = setupPlayer();
    const state = changingQualityMenu(gear);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    lifecycle.dispose();
    document.getElementById('video-player')!.dispatchEvent(new Event('canplay'));
    bar.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.opens).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('quality-lock rendition labels', () => {
  it.each([
    { labels: ['Auto', '1080p60', 'Source'], expected: 'Source' },
    { labels: ['Otomatik', '720p60', 'Kaynak'], expected: 'Kaynak' },
    { labels: ['Auto', '1080p30', '1080p60', '2160p50'], expected: '2160p50' },
    { labels: ['Auto', '1080p', '1080p30', '1080p60'], expected: '1080p60' },
    { labels: ['Auto', '1080p60 (Source)', '720p60'], expected: '1080p60 (Source)' },
    { labels: ['Auto', 'SourceGiriş gerekli', '1080p60Login required', '720p60'], expected: '720p60' },
  ])('selects $expected from $labels', async ({ labels, expected }) => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const state = changingQualityMenu(gear, labels);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(state.checked).toBe(expected);
    expect(state.picks).toEqual([expected]);
    lifecycle.dispose();
  });

  it('skips disabled Source and resolution rows even without a login badge', async () => {
    stubEnvironment();
    const { gear } = setupPlayer();
    const rows = attachQualityMenu(gear, ['Auto', 'Source', '1080p60', '720p60'], 'Auto');
    rows[1].setAttribute('aria-disabled', 'true');
    rows[2].setAttribute('data-disabled', '');
    const picked = vi.fn();
    rows[3].addEventListener('click', picked);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
    expect(picked).toHaveBeenCalledOnce();
    expect(rows[3].getAttribute('aria-checked')).toBe('true');
    lifecycle.dispose();
  });
});

const livePlayer = readFileSync('tests/fixtures/quality-lock-live-2026-10-22-player-before.html', 'utf8');
const liveMenu = readFileSync('tests/fixtures/quality-lock-live-2026-10-22-menus.html', 'utf8');

describe('quality-lock anonymous live DOM, 2026-10-22', () => {
  function setupLiveMenu(alreadyOpen = false, retained = false) {
    document.body.innerHTML = livePlayer;
    const gear = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    const template = document.createElement('template');
    template.innerHTML = liveMenu;
    const menu = template.content.querySelector<HTMLElement>('[role="menu"]')!;
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    let selected = 'Auto';
    const picks: string[] = [];
    const open = () => {
      menu.hidden = false;
      gear.setAttribute('aria-expanded', 'true');
      gear.setAttribute('aria-controls', menu.id);
      for (const row of rows) row.setAttribute('aria-checked', String(row.textContent === selected));
      document.body.append(menu);
    };
    const close = () => {
      if (retained) menu.hidden = true; else menu.remove();
      gear.setAttribute('aria-expanded', 'false');
    };
    gear.addEventListener('pointerdown', () => gear.getAttribute('aria-expanded') === 'true' ? close() : open());
    for (const row of rows) row.addEventListener('click', () => {
      selected = row.textContent!;
      picks.push(selected);
      close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, true);
    if (alreadyOpen) open();
    return { gear, menu, rows, picks, selected: () => selected };
  }

  it('prefers the captured menu trigger role over a matching SVG path', () => {
    const { gear } = setupLiveMenu();
    expect(findQualityGearCandidates()[0]).toEqual({ button: gear, via: 'menu-role' });
  });

  it('selects and confirms the highest accessible captured row, leaving the login gate alone', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = setupLiveMenu();
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(state.selected()).toBe('720p60');
      expect(state.picks).toEqual(['720p60']);
      expect(warn).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('keeps the captured menu usable if the glyph and button position change', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = setupLiveMenu();
    state.gear.querySelector('path')!.setAttribute('d', 'M99 future-icon');
    state.gear.parentElement!.prepend(state.gear);
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(state.selected()).toBe('720p60');
      expect(warn).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('reads an already-open associated native menu without toggling it shut', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = setupLiveMenu(true, true);
    // Radix can retain connected row nodes; they are not necessarily fresh after a press.
    const lifecycle = new Lifecycle();
    initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      expect(state.selected()).toBe('720p60');
      expect(warn).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('retains one debug diagnostic across controller recreation without warnings or errors', async () => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostic = vi.spyOn(logger, 'debug');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = livePlayer; // rendered gear with no responding native menu
    for (let session = 0; session < 2; session++) {
      const lifecycle = new Lifecycle();
      initQualityLock(lifecycle);
      await vi.advanceTimersByTimeAsync(ATTEMPT_BUDGET_MS);
      lifecycle.dispose();
    }
    expect(warn).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls.filter((args) => String(args[0]).includes('highest quality could not be confirmed'))).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });
});
