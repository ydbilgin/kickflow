import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';
import type { ModActionKind, ModActionNotice } from '../../src/content/chat/mod-action-feed';
import {
  MOD_ACTION_MAX_VISIBLE,
  MOD_ACTION_NAMES_SHOWN,
  MOD_ACTION_NOTICE_TTL_MS,
  MOD_ACTION_STRIP_ANIMATION_MS,
  MOD_ACTION_STRIP_INSET_PX,
  MOD_ACTION_STRIP_MIN_WIDTH_PX,
  ModActionStrip,
  resolveStripPlacement,
} from '../../src/content/chat/mod-action-strip';
import { styleTemplate } from '../helpers/bootstrap-css';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function notice(
  id: string,
  overrides: Partial<ModActionNotice> = {},
): ModActionNotice {
  return {
    id,
    kind: 'ban',
    moderator: 'moderator',
    durationMin: null,
    victims: ['victim'],
    count: 1,
    messageId: `message-${id}`,
    firstAt: 1,
    lastAt: 1,
    ...overrides,
  };
}

function mountAnchor(): HTMLElement {
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  document.body.appendChild(anchor);
  return anchor;
}

class TestResizeObserver {
  static readonly instances: TestResizeObserver[] = [];
  readonly observed = new Set<Element>();
  readonly disconnect = vi.fn(() => this.observed.clear());
  readonly observe = vi.fn((element: Element) => this.observed.add(element));

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe('ModActionStrip', () => {
  beforeEach(() => {
    setLang('en');
    document.body.replaceChildren();
    TestResizeObserver.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('keeps placement inside the viewport and never exceeds the anchor across a swept grid', () => {
    const viewport = { width: 1280, height: 800 };
    const heights = [24, 64, 160];
    const widths = [120, 180, 220, 360, 720];
    let combinations = 0;

    for (let left = -120; left <= 1_320; left += 120) {
      for (let top = -120; top <= 840; top += 120) {
        for (const width of widths) {
          for (const height of heights) {
            combinations++;
            const anchor = rect(left, top, width, 320);
            const placement = resolveStripPlacement(anchor, height, viewport);
            expect(placement.left).toBeGreaterThanOrEqual(0);
            expect(placement.left + placement.width).toBeLessThanOrEqual(viewport.width);
            expect(placement.top).toBeGreaterThanOrEqual(0);
            expect(placement.top + height).toBeLessThanOrEqual(viewport.height);
            expect(placement.width).toBeLessThanOrEqual(width);
            if (width < MOD_ACTION_STRIP_MIN_WIDTH_PX) {
              expect(placement.width).toBe(width);
            } else {
              expect(placement.width).toBeGreaterThanOrEqual(MOD_ACTION_STRIP_MIN_WIDTH_PX);
            }
          }
        }
      }
    }

    expect(combinations).toBeGreaterThanOrEqual(200);
  });

  it('docks inside the anchor bottom edge with the required inset when there is room', () => {
    const anchor = rect(100, 100, 420, 500);
    const placement = resolveStripPlacement(anchor, 64, { width: 1280, height: 800 });

    expect(placement.top).toBe(anchor.bottom - 64 - MOD_ACTION_STRIP_INSET_PX);
    expect(placement.left + placement.width).toBe(anchor.right);
  });

  it('keeps rows hidden without an anchor and places them when the anchor appears', () => {
    const lifecycle = new Lifecycle();
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('one'));
    expect(strip.element.style.display).toBe('none');

    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 420, 500));
    window.dispatchEvent(new Event('resize'));

    expect(strip.element.style.display).toBe('');
    expect(strip.element.style.width).toBe('420px');
    lifecycle.dispose();
  });

  it('evicts the oldest row when a fourth notice arrives', () => {
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });

    strip.addNotice(notice('one', { victims: ['one'] }));
    strip.addNotice(notice('two', { victims: ['two'] }));
    strip.addNotice(notice('three', { victims: ['three'] }));
    strip.addNotice(notice('four', { victims: ['four'] }));

    const rows = strip.element.querySelectorAll('.kickflow-modaction-row');
    expect(rows).toHaveLength(MOD_ACTION_MAX_VISIBLE);
    expect(strip.element.textContent).not.toContain('one');
    expect(strip.element.textContent).toContain('four');
    lifecycle.dispose();
  });

  it('renders attacker-controlled usernames as text without assigning innerHTML', () => {
    const lifecycle = new Lifecycle();
    mountAnchor();
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    const setter = vi.spyOn(HTMLElement.prototype, 'innerHTML', 'set');
    const username = '<img src=x onerror=alert(1)>';

    strip.addNotice(notice('xss', { victims: [username] }));

    expect(strip.element.textContent).toContain(username);
    expect(strip.element.querySelector('img')).toBeNull();
    expect(setter).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('routes row, burst, more, and dismiss interactions separately', () => {
    const onJump = vi.fn();
    const onOpenPanel = vi.fn();
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump, onOpenPanel });

    strip.addNotice(notice('single'));
    const singleRow = strip.element.querySelector<HTMLElement>('.kickflow-modaction-row');
    singleRow?.click();
    expect(onJump).toHaveBeenCalledWith('message-single');
    expect(onOpenPanel).not.toHaveBeenCalled();

    strip.clear();
    strip.addNotice(notice('burst', {
      count: 5,
      messageId: null,
      victims: ['one', 'two', 'three', 'four', 'five'],
    }));
    const burstRow = strip.element.querySelector<HTMLElement>('.kickflow-modaction-row');
    burstRow?.click();
    expect(onOpenPanel).toHaveBeenCalledTimes(1);

    const more = strip.element.querySelector<HTMLElement>('.kickflow-modaction-more');
    expect(more).not.toBeNull();
    more?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(strip.element.textContent).toContain('four');
    expect(strip.element.textContent).toContain('five');

    const dismiss = strip.element.querySelector<HTMLButtonElement>('.kickflow-modaction-row__dismiss');
    dismiss?.click();
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(strip.element.querySelector('.kickflow-modaction-row')).toBeNull();
    lifecycle.dispose();
  });

  it('cancels the expiry timer when a reader hovers the row', () => {
    vi.useFakeTimers();
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('hover'));
    const row = strip.element.querySelector<HTMLElement>('.kickflow-modaction-row')!;
    row.dispatchEvent(new Event('mouseenter'));

    vi.advanceTimersByTime(MOD_ACTION_NOTICE_TTL_MS + 1);

    expect(strip.element.querySelector('.kickflow-modaction-row')).not.toBeNull();
    lifecycle.dispose();
  });

  it('removes the strip and unregisters listeners and observers on lifecycle disposal', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('cleanup'));

    lifecycle.dispose();

    expect(strip.element.isConnected).toBe(false);
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.anything(), undefined);
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.anything(), { capture: true, passive: true });
    expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalled();
  });

  it('does not append a strip when the feature gate is off and tears it down when disabled', async () => {
    const originalFlag = featureFlags.showModActions;
    featureFlags.showModActions = false;
    vi.spyOn(window, 'setInterval').mockReturnValue(1);
    vi.stubGlobal('chrome', {
      runtime: { id: 'kickflow-test', onMessage: { addListener: vi.fn() } },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    });

    try {
      const bootstrap = await import('../../src/content/bootstrap');
      const lifecycle = new Lifecycle();
      const panel = { showSettings: vi.fn() };
      const context = { kind: 'live', slug: 'channel', sessionKey: 'live:channel' } as const;

      bootstrap.initModActionNotificationsSession(context, lifecycle, panel as never);
      expect(document.body.querySelector('.kickflow-modaction-strip')).toBeNull();

      bootstrap.applyFlagChange('showModActions', true);
      expect(document.body.querySelector('.kickflow-modaction-strip')).not.toBeNull();
      bootstrap.applyFlagChange('showModActions', false);
      expect(document.body.querySelector('.kickflow-modaction-strip')).toBeNull();

      lifecycle.dispose();
    } finally {
      featureFlags.showModActions = originalFlag;
    }
  });

  it('shows the configured number of names before expansion', () => {
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    const victims = ['one', 'two', 'three', 'four', 'five'];
    strip.addNotice(notice('names', { kind: 'delete' as ModActionKind, count: 5, messageId: null, victims }));

    expect(strip.element.querySelectorAll('.kickflow-modaction-row__name')).toHaveLength(MOD_ACTION_NAMES_SHOWN);
    lifecycle.dispose();
  });

  it('keeps entrance motion short, transform-only, and disabled for reduced motion', () => {
    const css = styleTemplate();
    const animation = css.match(/animation: kickflow-modaction-in ([^;]+);/);
    const keyframes = css.match(/@keyframes kickflow-modaction-in \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

    expect(animation).not.toBeNull();
    expect(MOD_ACTION_STRIP_ANIMATION_MS).toBeLessThanOrEqual(200);
    expect(keyframes).toContain('opacity');
    expect(keyframes).toContain('transform');
    for (const layoutProperty of ['width:', 'height:', 'top:', 'left:', 'margin', 'padding']) {
      expect(keyframes).not.toContain(layoutProperty);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*kickflow-modaction-row \{ animation: none;/);
  });

  it('puts the victim names before the moderator clause on a bulk row', () => {
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('bulk', {
      count: 3,
      messageId: null,
      victims: ['alpha', 'beta', 'gamma'],
      moderator: 'themod',
    }));

    // A bulk headline ends in a colon, so "by themod" must not land between it and the list.
    const text = strip.element.querySelector('.kickflow-modaction-row__text')?.textContent ?? '';
    expect(text).toContain('alpha');
    expect(text).toContain('themod');
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('themod'));
    expect(text.indexOf('gamma')).toBeLessThan(text.indexOf('themod'));
    lifecycle.dispose();
  });

  it('does not accumulate one lifecycle teardown per expiry reschedule', () => {
    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('burst', { count: 1 }));

    // A 40-ban burst reschedules the TTL timer on every update. One teardown closure per
    // reschedule would grow the lifecycle without bound for as long as the session lives.
    const addSpy = vi.spyOn(lifecycle, 'add');
    for (let index = 2; index <= 41; index++) {
      strip.updateNotice(notice('burst', { count: index, messageId: null, victims: ['a', 'b'] }));
    }

    expect(addSpy).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('never forces layout synchronously from a DOM mutation, and coalesces bursts to one frame', async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    const lifecycle = new Lifecycle();
    const anchor = mountAnchor();
    const anchorRect = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 420, 500));
    const strip = new ModActionStrip(lifecycle, { onJump: vi.fn(), onOpenPanel: vi.fn() });
    strip.addNotice(notice('one'));
    anchorRect.mockClear();
    raf.mockClear();
    frames.length = 0;

    // The subtree observer fires on every chat message and every React render. Doing layout work
    // in that callback would put a forced reflow on the hottest path in the page.
    for (let index = 0; index < 5; index++) {
      const noise = document.createElement('div');
      anchor.appendChild(noise);
      await Promise.resolve();
    }

    expect(anchorRect).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);

    frames.forEach((frame) => frame(0));
    expect(anchorRect).toHaveBeenCalled();
    lifecycle.dispose();
  });
});
