import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LayoutWatchdog,
  LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES,
  type LayoutInvariantName,
  type LayoutRect,
  type LayoutSnapshot,
  captureLayoutSnapshot,
  evaluateLayoutInvariant,
  findLayoutSidebar,
} from '../../src/content/shared/layout-watchdog';

function rect(overrides: Partial<LayoutRect> = {}): LayoutRect {
  return { x: 0, y: 0, width: 100, height: 100, ...overrides };
}

function snapshot(overrides: Partial<LayoutSnapshot> = {}): LayoutSnapshot {
  return {
    scrollX: 0,
    scrollY: 0,
    innerWidth: 1000,
    innerHeight: 800,
    documentElement: { clientWidth: 1000, scrollWidth: 1000 },
    fullscreen: false,
    theatre: 'false',
    navbar: rect({ width: 1000, height: 64 }),
    sidebar: rect({ width: 180 }),
    video: rect({ width: 600 }),
    wrapper: rect({ width: 600 }),
    chatMessages: rect({ width: 220 }),
    overlay: rect({ width: 220 }),
    controlBar: rect({ y: 700, width: 600, height: 40 }),
    wrapperClasses: ['cursor-none'],
    kickflowControls: [],
    ...overrides,
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writes.push(value);
  }
}

function watchdogFor(
  samples: LayoutSnapshot[],
  storage: Storage | null = new MemoryStorage(),
): { watchdog: LayoutWatchdog; scheduled: ReturnType<typeof vi.fn> } {
  let index = 0;
  const scheduled = vi.fn(() => 1);
  const watchdog = new LayoutWatchdog({
    captureSnapshot: () => samples[Math.min(index++, samples.length - 1)]!,
    setInterval: scheduled,
    clearInterval: vi.fn(),
    storage,
    now: () => Date.parse('2026-08-02T12:00:00.000Z'),
    getUrl: () => 'https://kick.com/following',
  });
  return { watchdog, scheduled };
}

describe('layout watchdog invariants', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('captures the required geometry and resolves the sidebar through semantic rows', () => {
    document.body.innerHTML = `
      <nav></nav>
      <div id="sidebar-wrapper"><a data-testid="sidebar-following-channel-1" href="/channel"></a></div>
      <div data-theatre="false" class="player-wrapper cursor-none">
        <div id="video-player"></div>
        <div class="z-controls bottom-0"></div>
      </div>
      <div id="chatroom-messages"></div>
      <div id="kickflow-chat-overlay"></div>
      <div id="kickflow-rewind-controls"></div>
    `;
    const elements = new Map<Element, [number, number, number, number]>([
      [document.querySelector('nav')!, [0, 0, 1000, 64]],
      [document.querySelector('#sidebar-wrapper')!, [0, 64, 180, 736]],
      [document.querySelector('#video-player')!, [180, 64, 600, 736]],
      [document.querySelector('.player-wrapper')!, [180, 64, 600, 736]],
      [document.querySelector('.z-controls')!, [180, 760, 600, 40]],
      [document.querySelector('#chatroom-messages')!, [780, 64, 220, 736]],
      [document.querySelector('#kickflow-chat-overlay')!, [780, 64, 220, 736]],
      [document.querySelector('#kickflow-rewind-controls')!, [500, 760, 60, 40]],
    ]);
    for (const [element, [x, y, width, height]] of elements) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x, y, width, height, top: y, left: x, right: x + width, bottom: y + height,
        toJSON: () => ({}),
      });
    }
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 1000 });

    const captured = captureLayoutSnapshot(document, {
      scrollX: 12.5,
      scrollY: 3.25,
      innerWidth: 1000,
      innerHeight: 800,
    });

    expect(findLayoutSidebar(document)).toBe(document.querySelector('#sidebar-wrapper'));
    expect(captured).toMatchObject({
      scrollX: 12.5,
      scrollY: 3.25,
      innerWidth: 1000,
      innerHeight: 800,
      documentElement: { clientWidth: 1000, scrollWidth: 1000 },
      fullscreen: false,
      theatre: 'false',
      navbar: { x: 0, y: 0, width: 1000, height: 64 },
      sidebar: { x: 0, y: 64, width: 180, height: 736 },
      video: { x: 180, y: 64, width: 600, height: 736 },
      wrapper: { x: 180, y: 64, width: 600, height: 736 },
      chatMessages: { x: 780, y: 64, width: 220, height: 736 },
      overlay: { x: 780, y: 64, width: 220, height: 736 },
      controlBar: { x: 180, y: 760, width: 600, height: 40 },
      wrapperClasses: ['cursor-none', 'player-wrapper'],
    });
    expect(captured.kickflowControls).toEqual([
      { id: 'kickflow-rewind-controls', rect: { x: 500, y: 760, width: 60, height: 40 } },
    ]);
  });

  const cases: Array<{
    name: LayoutInvariantName;
    passing: LayoutSnapshot;
    failing: LayoutSnapshot;
    unverifiable: LayoutSnapshot;
  }> = [
    {
      name: 'sidebar-collapsed',
      passing: snapshot(),
      failing: snapshot({ sidebar: rect({ width: 59 }) }),
      unverifiable: snapshot({ sidebar: null }),
    },
    {
      name: 'horizontal-overflow',
      passing: snapshot(),
      failing: snapshot({ documentElement: { clientWidth: 1000, scrollWidth: 1003 } }),
      unverifiable: snapshot({ documentElement: null }),
    },
    {
      name: 'navbar-offscreen',
      passing: snapshot(),
      failing: snapshot({ navbar: rect({ y: -1, height: 64 }) }),
      unverifiable: snapshot({ navbar: null }),
    },
    {
      name: 'width-budget',
      passing: snapshot(),
      failing: snapshot({ video: rect({ width: 650 }) }),
      unverifiable: snapshot({ sidebar: null }),
    },
    {
      name: 'control-bar-missing',
      passing: snapshot(),
      failing: snapshot({ wrapperClasses: [], controlBar: null }),
      unverifiable: snapshot({ wrapper: null, wrapperClasses: null }),
    },
  ];

  it.each(cases)('$name returns pass, fail, and unverifiable honestly', ({ name, passing, failing, unverifiable }) => {
    expect(evaluateLayoutInvariant(name, passing)).toBe('pass');
    expect(evaluateLayoutInvariant(name, failing)).toBe('fail');
    expect(evaluateLayoutInvariant(name, unverifiable)).toBe('unverifiable');
  });

  it('persists only pass-to-fail transitions and increments the cumulative counter', () => {
    const storage = new MemoryStorage();
    const samples = [
      snapshot(),
      snapshot({ sidebar: rect({ width: 59 }), video: rect({ width: 721 }) }),
      snapshot({ sidebar: rect({ width: 59 }), video: rect({ width: 721 }) }),
      snapshot(),
      snapshot({ sidebar: rect({ width: 59 }), video: rect({ width: 721 }) }),
    ];
    const { watchdog } = watchdogFor(samples, storage);

    watchdog.start();
    watchdog.pollNow();
    expect(storage.writes).toHaveLength(1);
    watchdog.pollNow();
    expect(storage.writes).toHaveLength(1);
    watchdog.pollNow();
    watchdog.pollNow();

    expect(storage.writes).toHaveLength(2);
    expect(JSON.parse(storage.writes[1]!).tripCount).toBe(2);
  });

  it('trips when an invariant becomes measurable and is already failing', () => {
    const storage = new MemoryStorage();
    const { watchdog } = watchdogFor([
      snapshot({ sidebar: null, video: null, chatMessages: null }),
      // The width budget stays satisfied so only the sidebar invariant can trip here.
      snapshot({ sidebar: rect({ width: 20 }), video: rect({ width: 760 }) }),
    ], storage);

    watchdog.start();
    expect(storage.writes).toHaveLength(0);
    watchdog.pollNow();

    expect(storage.writes).toHaveLength(1);
    expect(JSON.parse(storage.writes[0]!).invariant).toBe('sidebar-collapsed');
  });

  it('never trips on the very first observation, because there is no history to persist', () => {
    const storage = new MemoryStorage();
    const { watchdog } = watchdogFor([snapshot({ sidebar: rect({ width: 20 }) })], storage);

    watchdog.start();

    expect(storage.writes).toHaveLength(0);
  });

  it('waits for two consecutive missing control-bar polls before tripping', () => {
    const storage = new MemoryStorage();
    const samples = [
      snapshot(),
      snapshot({ wrapperClasses: [], controlBar: null }),
      snapshot({ wrapperClasses: [], controlBar: null }),
    ];
    const { watchdog } = watchdogFor(samples, storage);

    watchdog.start();
    watchdog.pollNow();
    expect(storage.writes).toHaveLength(0);
    watchdog.pollNow();
    expect(storage.writes).toHaveLength(1);
  });

  it('drops the oldest snapshots when a trip record reaches the serialized storage cap', () => {
    const storage = new MemoryStorage();
    const largeClass = 'layout-history-'.padEnd(150 * 1024, 'x');
    const { watchdog } = watchdogFor([
      snapshot({ wrapperClasses: [largeClass] }),
      snapshot({ sidebar: rect({ width: 59 }), video: rect({ width: 721 }), wrapperClasses: [largeClass] }),
    ], storage);

    watchdog.start();
    watchdog.pollNow();

    expect(storage.writes).toHaveLength(1);
    expect(new TextEncoder().encode(storage.writes[0]!).byteLength)
      .toBeLessThanOrEqual(LAYOUT_WATCHDOG_MAX_SERIALIZED_RECORD_BYTES);
    expect(JSON.parse(storage.writes[0]!).ringBuffer).toHaveLength(1);
  });

  it('appends identical snapshots once and caps the change-driven ring buffer', () => {
    const first = snapshot();
    const changed = snapshot({ scrollX: 1 });
    const identicalHarness = watchdogFor([first, first, changed, changed]);
    identicalHarness.watchdog.start();
    identicalHarness.watchdog.pollNow();
    identicalHarness.watchdog.pollNow();
    identicalHarness.watchdog.pollNow();
    expect(identicalHarness.watchdog.getRingBuffer()).toHaveLength(2);

    let sampleIndex = 0;
    const capped = new LayoutWatchdog({
      captureSnapshot: () => snapshot({ scrollX: sampleIndex++ }),
      setInterval: () => 1,
      clearInterval: () => undefined,
      storage: null,
      now: Date.now,
      getUrl: () => 'https://kick.com/following',
    });
    capped.start();
    for (let i = 0; i < 124; i++) capped.pollNow();

    const ring = capped.getRingBuffer();
    expect(ring).toHaveLength(120);
    expect(ring[0]?.scrollX).toBe(5);
  });

  it('does not schedule or write while stopped', () => {
    const storage = new MemoryStorage();
    const { watchdog, scheduled } = watchdogFor([snapshot({ sidebar: rect({ width: 59 }) })], storage);

    expect(watchdog.pollNow()).toBeNull();
    expect(scheduled).not.toHaveBeenCalled();
    expect(storage.writes).toHaveLength(0);
  });

  it('swallows localStorage failures instead of propagating them', () => {
    const storage: Storage = {
      get length(): number { return 0; },
      clear(): void {},
      getItem(): string | null { throw new Error('quota read failure'); },
      key(): string | null { return null; },
      removeItem(): void {},
      setItem(): void { throw new Error('quota write failure'); },
    };
    const { watchdog } = watchdogFor([
      snapshot(),
      snapshot({ sidebar: rect({ width: 59 }) }),
    ], storage);

    watchdog.start();
    expect(() => watchdog.pollNow()).not.toThrow();
  });
});
