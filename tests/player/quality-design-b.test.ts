// Quality design B, chosen 2026-10-29 from a design mockup (option B).
// Three plain choices (En iyi görüntü / Bağlantıya göre / Veri tasarrufu), the exact renditions
// one tap deeper ("Diğer çözünürlükler"), and a chip on the bar naming what plays. The old
// "Highest quality" setting becomes the first choice.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeQualityMode,
  pickQuality,
  qualityLabelForLevel,
  qualityRenditions,
} from '../../src/content/player/bar-shared.js';
import { Lifecycle } from '../../src/content/shared/lifecycle';

type QualityLockModule = typeof import('../../src/content/player/quality-lock');
type FlagsModule = typeof import('../../src/content/chat/feature-flags');

let quality: QualityLockModule;
let flags: FlagsModule;

const LIVE_ROWS = ['Auto', '1080p60Login required', '720p60', '480p', '360p', '160p'];

describe('one rule for both bars: which rendition a choice selects', () => {
  it('reads the old "Highest quality" value as "En iyi görüntü" and rejects junk', () => {
    expect(normalizeQualityMode('highest')).toBe('best');
    expect(normalizeQualityMode('best')).toBe('best');
    expect(normalizeQualityMode('auto')).toBe('auto');
    expect(normalizeQualityMode('saver')).toBe('saver');
    expect(normalizeQualityMode('720p60')).toBe('720p60');
    expect(normalizeQualityMode('480p')).toBe('480p');
    expect(normalizeQualityMode('Source')).toBeNull();
    expect(normalizeQualityMode('')).toBeNull();
    expect(normalizeQualityMode(true)).toBeNull();
  });

  it('best = the highest selectable row, never a login-gated one', () => {
    expect(LIVE_ROWS[pickQuality('best', LIVE_ROWS)!]).toBe('720p60');
    expect(pickQuality('best', ['Auto', 'Source', '1080p60'])).toBe(1);
  });

  it('saver = the highest row at or below 480p, else the lowest row', () => {
    expect(LIVE_ROWS[pickQuality('saver', LIVE_ROWS)!]).toBe('480p');
    expect(pickQuality('saver', ['Auto', '1080p60', '720p30'])).toBe(2);
    expect(pickQuality('saver', ['Auto', '720p60', '480p30', '360p'])).toBe(2);
  });

  it('auto = let the player choose; an exact label = that row, else the nearest below', () => {
    expect(pickQuality('auto', LIVE_ROWS)).toBe(-1);
    expect(LIVE_ROWS[pickQuality('360p', LIVE_ROWS)!]).toBe('360p');
    expect(LIVE_ROWS[pickQuality('1080p60', LIVE_ROWS)!]).toBe('720p60');
    expect(LIVE_ROWS[pickQuality('540p', LIVE_ROWS)!]).toBe('480p');
    expect(LIVE_ROWS[pickQuality('144p', LIVE_ROWS)!]).toBe('160p');
    expect(pickQuality('best', ['Auto', '1080p60Login required'])).toBeNull();
  });

  it('names renditions the way Kick does and lists them highest first', () => {
    expect(qualityLabelForLevel({ height: 1080, frameRate: 60 })).toBe('1080p60');
    expect(qualityLabelForLevel({ height: 480, frameRate: 30 })).toBe('480p');
    expect(qualityLabelForLevel({ height: 0 })).toBeNull();
    expect(qualityRenditions(['Auto', '480p', '1080p60Login required', '720p60', 'Source', '720p60']))
      .toEqual(['720p60', '480p']);
  });
});

// ---- Native bar: the choice is applied through Kick's own (hidden) quality menu. -----------

const livePlayer = readFileSync('tests/fixtures/quality-lock-live-2026-10-22-player-before.html', 'utf8');
const liveMenu = readFileSync('tests/fixtures/quality-lock-live-2026-10-22-menus.html', 'utf8');

/** The anonymous live DOM captured from kick.com on 2026-10-22, driven like Radix drives it. */
function setupLiveMenu() {
  document.body.innerHTML = livePlayer;
  const gear = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const template = document.createElement('template');
  template.innerHTML = liveMenu;
  const menu = template.content.querySelector<HTMLElement>('[role="menu"]')!;
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  const label = (row: HTMLElement) => row.querySelector('span')!.textContent!;
  const state = { selected: 'Auto', picks: [] as string[] };
  const open = () => {
    gear.setAttribute('aria-expanded', 'true');
    gear.setAttribute('aria-controls', menu.id);
    for (const row of rows) row.setAttribute('aria-checked', String(label(row) === state.selected));
    document.body.append(menu);
  };
  const close = () => {
    menu.remove();
    gear.setAttribute('aria-expanded', 'false');
  };
  gear.addEventListener('pointerdown', () => (gear.getAttribute('aria-expanded') === 'true' ? close() : open()));
  for (const row of rows) row.addEventListener('click', () => {
    state.selected = label(row);
    state.picks.push(state.selected);
    // Kick persists a numeric height for a rendition pick (saved player bundle, 2026-10-17).
    const height = state.selected.match(/^(\d+)p/)?.[1];
    if (height) sessionStorage.setItem('stream_quality', height);
    close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, true);
  return { gear, state };
}

beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  quality = await import('../../src/content/player/quality-lock');
  flags = await import('../../src/content/chat/feature-flags');
  (await import('../../src/content/shared/i18n')).setLang('tr');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function stubEnvironment(): void {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test' },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } },
  });
}

const BUDGET_MS = 20_000;

describe('native bar: each choice goes through Kick\'s own quality menu', () => {
  it.each([
    { mode: 'best', expected: '720p60' },
    { mode: 'saver', expected: '480p' },
    { mode: 'auto', expected: 'Auto' },
    { mode: '360p', expected: '360p' },
  ])('$mode selects and confirms $expected on the captured live menu', async ({ mode, expected }) => {
    stubEnvironment();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = setupLiveMenu();
    // Start from a rendition so "auto" has something to change.
    if (mode === 'auto') live.state.selected = '720p60';
    flags.featureFlags.qualityAlwaysBest = false;
    flags.featureFlags.qualityMode = mode;
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe(expected);
      expect(live.state.picks).toEqual([expected]);
      expect(warn).not.toHaveBeenCalled();
    } finally { lifecycle.dispose(); }
  });

  it('a new choice re-applies at once, without waiting for the 30 s recheck', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    flags.featureFlags.qualityAlwaysBest = false;
    flags.featureFlags.qualityMode = 'best';
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      flags.featureFlags.qualityMode = 'saver';
      quality.notifyQualityModeChanged();
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('480p');
      expect(live.state.picks).toEqual(['720p60', '480p']);
    } finally { lifecycle.dispose(); }
  });

  it('adopts a choice the viewer makes in Kick\'s own menu instead of fighting it', () => {
    const row = (text: string) => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      for (const label of ['Auto', '720p60', '480p']) {
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitemradio');
        item.innerHTML = `<span>${label}</span>`;
        menu.append(item);
      }
      document.body.append(menu);
      return [...menu.children].find((item) => item.textContent === text) as HTMLElement;
    };
    expect(quality.qualityModeFromNativeRow(row('Auto'))).toBe('auto');
    expect(quality.qualityModeFromNativeRow(row('480p'))).toBe('480p');
    // A row of some other menu (our speed menu has "Auto" too) is not a quality pick.
    const speed = document.createElement('div');
    speed.setAttribute('role', 'menu');
    speed.innerHTML = '<button role="menuitemradio">Auto</button><button role="menuitemradio">1.5x</button>';
    document.body.append(speed);
    expect(quality.qualityModeFromNativeRow(speed.firstElementChild as HTMLElement)).toBeNull();
  });
});

describe('native bar: the chip and its menu', () => {
  function chip(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('#kickflow-quality-controls .kickflow-quality-btn')!;
  }

  it('mounts a chip in KickFlow\'s plate that names the rendition and the choice', async () => {
    stubEnvironment();
    setupLiveMenu();
    flags.featureFlags.qualityMode = 'best';
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      expect(chip()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(chip().textContent).toBe('720p60EN İYİ');
      expect(chip().getAttribute('aria-label')).toBe('Kalite: 720p60 EN İYİ');
      expect(chip().classList.contains('kickflow-quality-btn--held')).toBe(true);
    } finally { lifecycle.dispose(); }
    expect(document.getElementById('kickflow-quality-controls')).toBeNull();
  });

  it('opens the B menu: three choices, then the exact renditions one tap deeper', async () => {
    stubEnvironment();
    setupLiveMenu();
    // Design B as it was: with "always highest" off a pick is stored through the flag path.
    flags.featureFlags.qualityAlwaysBest = false;
    flags.featureFlags.qualityMode = 'best';
    const picked: unknown[] = [];
    const onFlag = (event: Event) => picked.push((event as CustomEvent).detail);
    window.addEventListener('kickflow:setFlag', onFlag);
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      chip().click();
      const menu = document.querySelector<HTMLElement>('.kickflow-player-menu.kickflow-quality-menu')!;
      expect(menu).not.toBeNull();
      const intents = [...menu.querySelectorAll('.kickflow-quality-menu__intent')];
      expect(intents.map((row) => row.querySelector('b')!.textContent)).toEqual(['En iyi görüntü', 'Bağlantıya göre', 'Veri tasarrufu']);
      expect(intents.map((row) => row.querySelector('small')!.textContent)).toEqual([
        'Hep en yüksek, şu an 720p60',
        'İnternet yavaşlarsa kendisi düşürür',
        'En çok 480p, telefon interneti için',
      ]);
      expect(intents[0].getAttribute('aria-checked')).toBe('true');
      const more = menu.querySelector<HTMLButtonElement>('.kickflow-quality-menu__more')!;
      expect(more.textContent).toBe('Diğer çözünürlükler ›');
      const grid = menu.querySelector<HTMLElement>('.kickflow-quality-menu__grid')!;
      expect(grid.hidden).toBe(true);
      more.click();
      expect(grid.hidden).toBe(false);
      // The login-gated 1080p60 is not offered: it cannot be selected while logged out.
      expect([...grid.querySelectorAll('button')].map((row) => row.textContent)).toEqual(['720p60', '480p', '360p', '160p']);
      (intents[2] as HTMLButtonElement).click();
      expect(picked).toEqual([expect.objectContaining({ key: 'qualityMode', value: 'saver' })]);
      expect(document.querySelector('.kickflow-quality-menu')).toBeNull();
    } finally {
      window.removeEventListener('kickflow:setFlag', onFlag);
      lifecycle.dispose();
    }
  });

  it('in "Bağlantıya göre" the chip shows the playing height, unframed', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    live.state.selected = '720p60';
    flags.featureFlags.qualityAlwaysBest = false;
    flags.featureFlags.qualityMode = 'auto';
    const video = document.querySelector<HTMLVideoElement>('video')!;
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('Auto');
      expect(chip().textContent).toBe('480pOTO');
      expect(chip().classList.contains('kickflow-quality-btn--held')).toBe(false);
    } finally { lifecycle.dispose(); }
  });
});

// ---- Always highest (2026-11-24). Reported: after one stream at 720p the next stream opened
// at 720p too. Cause: design B stored every pick (also one in Kick's own menu) as qualityMode. With qualityAlwaysBest (default on) a
// pick holds for that stream only and the next stream opens at the highest again.
describe('always highest: a pick is for this stream only', () => {
  function chip(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('#kickflow-quality-controls .kickflow-quality-btn')!;
  }
  function pickFromChip(mode: string): void {
    chip().click();
    const menu = document.querySelector<HTMLElement>('.kickflow-player-menu.kickflow-quality-menu')!;
    menu.querySelector<HTMLButtonElement>(`[data-quality-mode="${mode}"]`)!.click();
  }

  it('is on by default', () => {
    expect(flags.featureFlags.qualityAlwaysBest).toBe(true);
  });

  it('opens at the highest rendition even when an older pick is still stored', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    // Kick's player starts from its own remembered height, and design B had stored the pick.
    live.state.selected = '360p';
    sessionStorage.setItem('stream_quality', '360');
    flags.featureFlags.qualityMode = '360p';
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      expect(live.state.picks).toEqual(['720p60']);
      expect(chip().textContent).toBe('720p60EN İYİ');
    } finally { lifecycle.dispose(); }
  });

  it('keeps a hand pick through a source reload, stores nothing, and the next stream is highest again', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    const stored: unknown[] = [];
    const onFlag = (event: Event) => stored.push((event as CustomEvent).detail);
    window.addEventListener('kickflow:setFlag', onFlag);
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      pickFromChip('360p');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('360p');
      expect(chip().textContent).toBe('360pBU YAYIN');
      // The same stream reloads its source (reconnect, ad break): the pick is not fought.
      document.querySelector('video')!.dispatchEvent(new Event('loadstart'));
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      // ... nor by the periodic rendition recheck.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(live.state.selected).toBe('360p');
      expect(live.state.picks).toEqual(['720p60', '360p']);
      expect(stored).toEqual([]);
      expect(flags.featureFlags.qualityMode).toBe('best');
    } finally { lifecycle.dispose(); }

    // The next channel: a new player session. Kick still remembers 360p; KickFlow does not.
    const next = new Lifecycle();
    quality.initQualityLock(next);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      expect(live.state.picks).toEqual(['720p60', '360p', '720p60']);
      expect(stored).toEqual([]);
    } finally {
      window.removeEventListener('kickflow:setFlag', onFlag);
      next.dispose();
    }
  });

  it('"En iyi görüntü" ends the stream pick; the top rendition counts as no pick', async () => {
    expect(quality.streamPickFor('best', ['720p60', '480p'])).toBeNull();
    expect(quality.streamPickFor('720p60', ['720p60', '480p'])).toBeNull();
    expect(quality.streamPickFor('480p', ['720p60', '480p'])).toBe('480p');
    expect(quality.streamPickFor('auto', ['720p60', '480p'])).toBe('auto');
    expect(quality.streamPickFor('480p', [])).toBe('480p');

    stubEnvironment();
    const live = setupLiveMenu();
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      pickFromChip('saver');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('480p');
      pickFromChip('best');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('720p60');
      expect(chip().textContent).toBe('720p60EN İYİ');
    } finally { lifecycle.dispose(); }
  });

  // Review 2026-11-24 (K-1): a pick in Kick's own gear menu. jsdom clicks are untrusted, so the
  // test passes `trusted` for the viewer's real click.
  const viewer = () => true;
  function nativeClick(live: ReturnType<typeof setupLiveMenu>, label: string): void {
    live.gear.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    const row = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .find((item) => item.querySelector('span')?.textContent === label)!;
    row.click();
  }

  it('review K-1: a pick in Kick\'s menu names that rendition at once and does not reopen the closing menu', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    let gearPresses = 0;
    live.gear.addEventListener('pointerdown', () => { gearPresses += 1; });
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle, viewer);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      const pressesBefore = gearPresses;
      nativeClick(live, '360p');
      expect(live.state.selected).toBe('360p');
      // Not the old "720p60 BU YAYIN": the chip names the row the viewer just picked.
      expect(chip().textContent).toBe('360pBU YAYIN');
      // No hidden inspection while Kick's menu is still closing (it used to come at 100 ms).
      await vi.advanceTimersByTimeAsync(1000);
      expect(gearPresses).toBe(pressesBefore + 1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('360p');
      expect(live.state.picks).toEqual(['720p60', '360p']);
      expect(chip().textContent).toBe('360pBU YAYIN');
    } finally { lifecycle.dispose(); }
  });

  it('review K-1: the top row picked in Kick\'s menu before the first look is "best", not a hold', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle, viewer);
    try {
      // Before the opening pass (1.8 s) has read the list.
      nativeClick(live, '720p60');
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      expect(chip().textContent).toBe('720p60EN İYİ');
    } finally { lifecycle.dispose(); }
  });

  it('review K-5: "En iyi görüntü" on the chip re-applies even when it already is the choice', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      // The player fell back on its own (or the opening pass gave up): 480p plays, choice is best.
      live.state.selected = '480p';
      sessionStorage.setItem('stream_quality', '480');
      pickFromChip('best');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('720p60');
      // The stored-choice mode re-applies the same way.
      flags.featureFlags.qualityAlwaysBest = false;
      flags.featureFlags.qualityMode = 'best';
      quality.notifyQualityModeChanged();
      await vi.advanceTimersByTimeAsync(3000);
      live.state.selected = '480p';
      sessionStorage.setItem('stream_quality', '480');
      pickFromChip('best');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('720p60');
    } finally { lifecycle.dispose(); }
  });

  it('review K-3: with the quality button off, "always highest" still opens the stream at the highest, chipless', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    live.state.selected = '360p';
    flags.featureFlags.qualityLock = false;
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      expect(live.state.selected).toBe('720p60');
      expect(document.getElementById('kickflow-quality-controls')).toBeNull();
    } finally {
      lifecycle.dispose();
      flags.featureFlags.qualityLock = true;
    }
  });

  it('switched off, the stored choice rules again and a stream pick is dropped', async () => {
    stubEnvironment();
    const live = setupLiveMenu();
    flags.featureFlags.qualityMode = '480p';
    const lifecycle = new Lifecycle();
    quality.initQualityLock(lifecycle);
    try {
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      pickFromChip('360p');
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('360p');
      flags.featureFlags.qualityAlwaysBest = false;
      quality.notifyQualityModeChanged();
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.state.selected).toBe('480p');
      expect(chip().textContent).toBe('480p');
    } finally { lifecycle.dispose(); }
  });
});
