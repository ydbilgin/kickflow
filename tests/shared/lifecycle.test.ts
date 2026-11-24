import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle } from '../../src/content/shared/lifecycle';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Lifecycle timeout ownership', () => {
  it('releases completed timeout registrations throughout a long session', () => {
    vi.useFakeTimers();
    const lifecycle = new Lifecycle();
    const handler = vi.fn();
    for (let round = 0; round < 100; round++) {
      for (let timer = 0; timer < 10; timer++) lifecycle.setTimeout(handler, 1);
      vi.advanceTimersByTime(1);
    }
    expect(handler).toHaveBeenCalledTimes(1000);
    // Inspect retained cleanup handles, not GC timing or an unmeasured heap estimate.
    expect((lifecycle as unknown as { disposers: unknown[] }).disposers).toHaveLength(0);
    const clear = vi.spyOn(window, 'clearTimeout');
    lifecycle.dispose();
    expect(clear).not.toHaveBeenCalled();
  });

  it('still cancels pending timeouts and immediately cancels ones added after disposal', () => {
    vi.useFakeTimers();
    const lifecycle = new Lifecycle();
    const handler = vi.fn();
    lifecycle.setTimeout(handler, 100);
    lifecycle.dispose();
    lifecycle.setTimeout(handler, 1);
    vi.advanceTimersByTime(100);
    expect(handler).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
