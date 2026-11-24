import { afterEach, expect, it, vi } from 'vitest';
import { startChatWithRetries, type ChatStartupAttempt } from '../../src/content/chat/startup-retry';
import { Lifecycle } from '../../src/content/shared/lifecycle';

afterEach(() => vi.useRealTimers());

it('backs off twice before the banner, then manual retry creates fresh resources', () => {
  vi.useFakeTimers();
  const parent = new Lifecycle();
  const attempts: Array<{ life: Lifecycle; controls: ChatStartupAttempt }> = [];
  const banner = vi.fn();
  startChatWithRetries(parent, (life, controls) => attempts.push({ life, controls }));
  attempts[0]!.controls.fail(banner);
  expect(attempts[0]!.life.isDisposed).toBe(false);
  expect(banner).not.toHaveBeenCalled();
  vi.advanceTimersByTime(999);
  expect(attempts).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(attempts[0]!.life.isDisposed).toBe(true);
  attempts[1]!.controls.fail(banner);
  vi.advanceTimersByTime(1999);
  expect(attempts).toHaveLength(2);
  vi.advanceTimersByTime(1);
  attempts[2]!.controls.fail(banner);
  expect(banner).toHaveBeenCalledOnce();
  expect(attempts[2]!.life.isDisposed).toBe(false);
  attempts[2]!.controls.retry();
  expect(attempts[2]!.life.isDisposed).toBe(true);
  expect(attempts).toHaveLength(4);
  parent.dispose();
});

it('keeps a recovered native list and cancels a replacement pending during backoff', () => {
  vi.useFakeTimers();
  const parent = new Lifecycle();
  let current: ChatStartupAttempt;
  const start = vi.fn((_life: Lifecycle, controls: ChatStartupAttempt) => { current = controls; });
  const banner = vi.fn();
  startChatWithRetries(parent, start);
  current!.fail(banner);
  current!.ready();
  vi.advanceTimersByTime(5000);
  expect(start).toHaveBeenCalledOnce();
  expect(banner).not.toHaveBeenCalled();
  parent.dispose();
});

it('cancels SPA retries and ignores completion from an obsolete attempt', () => {
  vi.useFakeTimers();
  const parent = new Lifecycle();
  const start = vi.fn((_life: Lifecycle, controls: ChatStartupAttempt) => controls.fail(vi.fn()));
  startChatWithRetries(parent, start);
  parent.dispose();
  vi.advanceTimersByTime(10000);
  expect(start).toHaveBeenCalledOnce();
});
