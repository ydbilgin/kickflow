import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DailyRewardAutoClaimController } from '../../src/content/daily-reward-auto-claim';
import { setFeatureFlag } from '../../src/content/chat/feature-flags';
import { Lifecycle } from '../../src/content/shared/lifecycle';

let lifecycle: Lifecycle;
afterEach(() => {
  lifecycle?.dispose();
  setFeatureFlag('autoClaimDailyReward', false);
  document.body.replaceChildren();
});

it('claims the saved bundle structure with a video stage and typeless primary-base button', async () => {
  document.body.replaceChildren();
  const template = document.createElement('template');
  template.innerHTML = readFileSync(resolve('tests/fixtures/daily-reward-2026-10.html'), 'utf8');
  const dialog = template.content.querySelector<HTMLElement>('[role="dialog"]')!;
  const button = dialog.querySelector<HTMLButtonElement>('button.w-full')!;
  expect(dialog.querySelector('section [class~="aspect-1348/1080"] video')).not.toBeNull();
  expect(button.hasAttribute('type')).toBe(false);
  expect(button.type).toBe('submit');
  expect(button.classList.contains('bg-primary-base')).toBe(true);
  expect(dialog.querySelector('img')).toBeNull();
  const claim = vi.fn(() => { button.disabled = true; });
  button.addEventListener('click', claim);
  const launcher = document.createElement('button');
  launcher.innerHTML = '<video src="https://static.kick.com/rewards/reward-available-CTA.webm"></video>';
  launcher.addEventListener('click', () => {
    if (dialog.isConnected) dialog.remove();
    else document.body.append(dialog);
  });
  document.body.append(launcher);
  setFeatureFlag('autoClaimDailyReward', true);
  lifecycle = new Lifecycle();
  new DailyRewardAutoClaimController(lifecycle);
  expect(claim).toHaveBeenCalledTimes(1);
  // 2026-10-20 bundle: disabled means the claim request is in flight; the window stays open.
  await Promise.resolve();
  await Promise.resolve();
  expect(dialog.isConnected).toBe(true);
  // Kick's success handler swaps the claim button for View (canViewReward); then it closes.
  button.replaceWith(Object.assign(document.createElement('a'), { textContent: 'View' }));
  await Promise.resolve();
  await Promise.resolve();
  expect(dialog.isConnected).toBe(false);
});
