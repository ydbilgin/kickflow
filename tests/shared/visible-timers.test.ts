import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coalesce, visibleInterval } from '../../src/content/shared/coalesce';
import { Lifecycle } from '../../src/content/shared/lifecycle';

let state: DocumentVisibilityState = 'visible';
const setVisibility = (value: DocumentVisibilityState): void => {
  state = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  state = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('visibleInterval ticks while visible, skips while hidden and catches up once on return', () => {
  const lifecycle = new Lifecycle();
  const tick = vi.fn();
  visibleInterval(lifecycle, tick, 1000);
  vi.advanceTimersByTime(3000);
  expect(tick).toHaveBeenCalledTimes(3);

  setVisibility('hidden');
  tick.mockClear();
  vi.advanceTimersByTime(60_000);
  expect(tick).not.toHaveBeenCalled();

  setVisibility('visible');
  expect(tick).toHaveBeenCalledTimes(1);
  lifecycle.dispose();
  vi.advanceTimersByTime(5000);
  expect(tick).toHaveBeenCalledTimes(1);
});

it('visibleInterval stops listening for visibility after dispose', () => {
  const lifecycle = new Lifecycle();
  const tick = vi.fn();
  visibleInterval(lifecycle, tick, 1000);
  lifecycle.dispose();
  setVisibility('hidden');
  setVisibility('visible');
  expect(tick).not.toHaveBeenCalled();
});

it('coalesce turns a burst of calls into one trailing run per gap', () => {
  const work = vi.fn();
  const gate = coalesce(work, 250);
  for (let i = 0; i < 500; i++) gate.run();
  expect(work).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(work).toHaveBeenCalledTimes(1);
  // A second burst right after waits for the remaining gap.
  vi.advanceTimersByTime(10);
  for (let i = 0; i < 500; i++) gate.run();
  vi.advanceTimersByTime(100);
  expect(work).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(200);
  expect(work).toHaveBeenCalledTimes(2);
});

it('coalesce does no work for a hidden tab and runs once when it is shown', () => {
  const lifecycle = new Lifecycle();
  const work = vi.fn();
  const gate = coalesce(work, 100, lifecycle);
  setVisibility('hidden');
  gate.run();
  vi.advanceTimersByTime(1000);
  expect(work).not.toHaveBeenCalled();
  setVisibility('visible');
  vi.advanceTimersByTime(200);
  expect(work).toHaveBeenCalledTimes(1);
  lifecycle.dispose();
  gate.run();
  setVisibility('hidden'); setVisibility('visible');
  vi.advanceTimersByTime(1000);
  expect(work).toHaveBeenCalledTimes(1);
});
