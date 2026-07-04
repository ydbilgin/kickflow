import { logger } from '../shared/logger';
import { findQualityButton } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 1000;

function parseQualityLabel(label: string): number {
  const match = label.match(/(\d{3,4})p/i);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function trySelectHighestQuality(): boolean {
  const button = findQualityButton();
  if (!button) return false;

  button.click();

  const menuItems = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], li, button')
  ).filter((el) => /\d{3,4}p|auto/i.test(el.textContent ?? ''));

  if (menuItems.length === 0) {
    logger.warn('quality-lock: settings button found but no quality options detected');
    return false;
  }

  let best: HTMLElement | null = null;
  let bestValue = -1;
  for (const item of menuItems) {
    const text = item.textContent ?? '';
    if (/auto/i.test(text)) continue;
    const value = parseQualityLabel(text);
    if (value > bestValue) {
      bestValue = value;
      best = item;
    }
  }

  if (!best) {
    logger.warn('quality-lock: no non-Auto quality option found');
    return false;
  }

  best.click();
  logger.debug('quality-lock: selected quality option', best.textContent);
  return true;
}

/** Fails gracefully and gives up quietly after MAX_ATTEMPTS — the quality button/menu
 * selectors are unconfirmed placeholders (see shared/selectors.ts), so this must never
 * throw or spam retries indefinitely if Kick's UI doesn't match. */
export function initQualityLock(lifecycle: Lifecycle): void {
  let attempts = 0;

  const attempt = (): void => {
    attempts++;
    try {
      const success = trySelectHighestQuality();
      if (success || attempts >= MAX_ATTEMPTS) {
        if (!success) logger.warn('quality-lock: giving up after', attempts, 'attempt(s)');
        return;
      }
    } catch (error) {
      logger.warn('quality-lock: failed, giving up for this session', error);
      return;
    }
    lifecycle.setTimeout(attempt, RETRY_DELAY_MS);
  };

  lifecycle.setTimeout(attempt, RETRY_DELAY_MS);
}
