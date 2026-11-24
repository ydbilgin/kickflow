import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBlocking,
  BLOCKED_ATTRIBUTE,
  handleBlockListsChange,
  initContentBlocking,
  isBlocked,
  readCard,
  sanitizeBlockLists,
} from '../../src/content/content-blocking';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';

// Shapes copied from the 2026-11-24 anonymous probe of kick.com (home, /browse, /category/valorant).
const LIVE_CARD = `
<div data-testid="livestream-results-card" id="live">
  <a data-card-link="true" href="/c9teen"></a>
  <a data-testid="media-card-thumbnail" href="/c9teen"><img src="x"></a>
  <a href="/c9teen"><span>c9teen</span></a>
  <a href="/c9teen"><h3>13 WINSTREAK</h3></a>
  <a class="group/tag flex" href="/category/valorant"><span>VALORANT</span></a>
  <button aria-disabled="true" class="group/tag flex" disabled>Türkçe</button>
</div>`;
const SLOTS_CARD = `
<div data-testid="livestream-results-card" id="slots">
  <a data-card-link="true" href="/roshtein"></a>
  <a class="group/tag flex" href="/category/slots"><span>Slots &amp; Casino</span></a>
</div>`;
const SIDEBAR = `
<a data-testid="sidebar-recommended-channel-1" id="side" href="/serhanyeniaras">
  <div><img alt=""></div>
  <div><div><span class="shrink truncate">SerhanYeniaras</span><span class="truncate text-sm">KICK Bounties</span></div></div>
</a>`;
const TILE = `
<div role="button" data-testid="category-card-root" id="tile"><a href="/category/grand-theft-auto-vi"><img alt=""></a></div>`;

afterEach(() => {
  document.body.innerHTML = '';
  featureFlags.contentBlocking = true;
});

describe('content blocking', () => {
  it('reads channel, category and tag pills from the measured card shapes', () => {
    document.body.innerHTML = LIVE_CARD + SIDEBAR + TILE;
    expect(readCard(document.getElementById('live')!)).toEqual({ channel: 'c9teen', categories: ['valorant', 'valorant'], tags: ['valorant', 'turkce'] });
    expect(readCard(document.getElementById('side')!)).toMatchObject({ channel: 'serhanyeniaras', categories: ['kick bounties'] });
    expect(readCard(document.getElementById('tile')!)).toMatchObject({ channel: null, categories: ['grand-theft-auto-vi'] });
  });

  it('cleans pasted entries: links, @names, case, accents and duplicates', () => {
    expect(sanitizeBlockLists({
      channels: ['https://kick.com/Roshtein', '@Trainwreckstv', 'roshtein', ''],
      categories: 'kick.com/category/slots, Slots & Casino\n',
      tags: ['Türkçe', 42],
    })).toEqual({ channels: ['roshtein', 'trainwreckstv'], categories: ['slots', 'slots & casino'], tags: ['turkce'] });
    expect(sanitizeBlockLists(null)).toEqual({ channels: [], categories: [], tags: [] });
  });

  it('hides blocked channels, categories (slug or name) and tags, and shows them again when lifted', () => {
    document.body.innerHTML = LIVE_CARD + SLOTS_CARD + SIDEBAR + TILE;
    const lists = sanitizeBlockLists({ categories: ['slots', 'GTA VI', 'grand-theft-auto-vi'], channels: ['serhanyeniaras'] });
    expect(applyBlocking(document, lists, true)).toBe(3);
    expect(document.getElementById('slots')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(true);
    expect(document.getElementById('side')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(true);
    expect(document.getElementById('tile')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(true);
    expect(document.getElementById('live')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(false);

    expect(applyBlocking(document, sanitizeBlockLists({ tags: ['turkce'] }), true)).toBe(1);
    expect(document.getElementById('live')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(true);
    expect(document.getElementById('slots')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(false);

    // Switch off: nothing stays hidden.
    expect(applyBlocking(document, lists, false)).toBe(0);
    expect(document.querySelectorAll(`[${BLOCKED_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it('an empty list hides nothing even while the switch is on', () => {
    document.body.innerHTML = LIVE_CARD + SLOTS_CARD;
    expect(applyBlocking(document, sanitizeBlockLists({}), true)).toBe(0);
    expect(isBlocked({ channel: 'x', categories: [], tags: [] }, sanitizeBlockLists({}))).toBe(false);
  });

  it('a list change from the side panel is accepted through the one storage listener', () => {
    expect(() => handleBlockListsChange({ kf_blockLists: { newValue: { channels: ['a'] } } })).not.toThrow();
    expect(() => handleBlockListsChange({ other: { newValue: 1 } })).not.toThrow();
  });

  // 0.4.3 (2026-11-24, code review B18).
  it('watches the page only while a list has an entry and the switch is on, skips chat, and leaves no style behind', async () => {
    Object.assign(globalThis, { chrome: { runtime: { id: 'x' }, storage: { local: { get: vi.fn(async () => ({})) } } } });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    document.body.innerHTML = '<div id="chatroom-messages"></div>' + SLOTS_CARD;
    const lifecycle = new Lifecycle();
    await initContentBlocking(lifecycle);
    expect(observe).not.toHaveBeenCalled();
    expect(document.getElementById('kickflow-content-blocking-style')).not.toBeNull();
    handleBlockListsChange({ kf_blockLists: { newValue: { categories: ['slots'] } } });
    expect(observe).toHaveBeenCalledTimes(1);
    frames.splice(0).forEach((cb) => cb(0));
    expect(document.getElementById('slots')!.hasAttribute(BLOCKED_ATTRIBUTE)).toBe(true);
    // A chat message alone does not rescan the cards.
    document.getElementById('chatroom-messages')!.append(document.createElement('div'));
    await Promise.resolve();
    expect(frames).toHaveLength(0);
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((cb) => cb(0));
    // An in-page route change rescans once.
    window.dispatchEvent(new Event('kickflow:locationchange'));
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((cb) => cb(0));
    handleBlockListsChange({ kf_blockLists: { newValue: {} } });
    expect(disconnect).toHaveBeenCalled();
    lifecycle.dispose();
    expect(document.getElementById('kickflow-content-blocking-style')).toBeNull();
    vi.restoreAllMocks();
  });
});
