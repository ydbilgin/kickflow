import { afterEach, describe, expect, it } from 'vitest';
import { appendBadges, setSubscriberBadges } from '../../src/content/chat/message-view';
import { BADGE_STYLES } from '../../src/content/chat/badge-presentation';
import { setLang } from '../../src/content/shared/i18n';
import { HOVER_TOOLTIP_ATTRIBUTE } from '../../src/content/shared/hover-tooltip';

afterEach(() => {
  setSubscriberBadges([]);
  document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  document.body.replaceChildren();
  setLang('en');
});

describe('native-looking badge presentation', () => {
  it('keeps real Kick icon artwork and omits the category frames and fills', () => {
    const parent = document.createElement('span');
    appendBadges(parent, [{ type: 'moderator' }, { type: 'vip' }, { type: 'level', level: 51, imageUrl: 'https://files.kick.com/level.png' }]);
    expect(parent.querySelectorAll('img')).toHaveLength(3);
    for (const icon of parent.querySelectorAll<HTMLElement>('img')) {
      expect(icon.getAttribute('src')).toMatch(/^(data:|https:\/\/files\.kick\.com\/)/);
      expect(icon.hasAttribute('data-badge-category')).toBe(false);
      expect(icon.style.getPropertyValue('--kickflow-badge-background')).toBe('');
      expect(icon.getAttribute(HOVER_TOOLTIP_ATTRIBUTE)).toBeTruthy();
    }
    expect(BADGE_STYLES).toContain('background: transparent; border: 0; box-shadow: none');
    expect(BADGE_STYLES).not.toContain('var(--kickflow-badge-foreground)');
  });

  it('keeps custom and fallback subscriber month labels without a color legend', () => {
    const fallback = document.createElement('span');
    appendBadges(fallback, [{ type: 'subscriber', count: 12 }]);
    setSubscriberBadges([{ months: 1, src: 'https://files.kick.com/subscriber.webp' }]);
    const custom = document.createElement('span');
    appendBadges(custom, [{ type: 'subscriber', count: 12 }]);
    for (const parent of [fallback, custom]) {
      const badge = parent.firstElementChild as HTMLElement;
      expect(badge.getAttribute(HOVER_TOOLTIP_ATTRIBUTE)).toBe('Subscriber, 12 months');
      expect(parent.getAttribute('aria-label')).toBe('Subscriber, 12 months');
      expect(badge.tabIndex).toBe(0);
      expect(badge.getAttribute('role')).toBe('button');
    }
  });

  it('reveals badge name on click and keyboard focus without opening a user card', () => {
    const parent = document.createElement('span');
    document.body.append(parent);
    appendBadges(parent, [{ type: 'moderator' }, { type: 'vip' }]);
    expect(parent.hasAttribute('tabindex')).toBe(false);
    const first = parent.children[0] as HTMLElement;
    const second = parent.children[1] as HTMLElement;
    first.click();
    expect(document.activeElement).toBe(first);
    expect(document.querySelector('.kickflow-hover-tooltip')?.textContent).toBe('Moderator');
    second.focus();
    second.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    expect(document.activeElement).toBe(second);
    expect(document.querySelector('.kickflow-hover-tooltip')?.textContent).toBe('VIP');
    expect(document.querySelector('.kickflow-user-card')).toBeNull();
  });

  it('keeps arbitrary badge text literal and individually named', () => {
    setLang('tr');
    const parent = document.createElement('span');
    appendBadges(parent, [{ text: '<img src=x onerror=alert(1)>' }, { type: 'moderator' }]);
    expect(parent.querySelectorAll('img')).toHaveLength(1);
    expect(parent.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)>');
    expect(parent.getAttribute('aria-label')).toContain('Moderatör');
  });

  it('keeps empty groups out of keyboard navigation', () => {
    const parent = document.createElement('span');
    appendBadges(parent, []);
    expect(parent.hasAttribute('tabindex')).toBe(false);
    expect(parent.hasAttribute(HOVER_TOOLTIP_ATTRIBUTE)).toBe(false);
  });
});
