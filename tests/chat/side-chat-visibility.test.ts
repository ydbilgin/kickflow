import { describe, expect, it } from 'vitest';
import { styleTemplate } from '../helpers/bootstrap-css';

describe('native chat visibility', () => {
  it('hides only the selected main chat, leaving the duplicate side chat visible', () => {
    const css = styleTemplate();
    const hidingRules = [...css.matchAll(/([^{}]+)\{([^{}]*(?:visibility:\s*hidden|opacity:\s*0)[^{}]*)\}/g)]
      .filter(([, selector]) => selector.includes('kickflow-chat-active') && selector.includes('chatroom-messages'));
    expect(hidingRules.length).toBeGreaterThanOrEqual(2);
    for (const [, selector] of hidingRules) expect(selector).toContain('[data-kickflow-main-chat]');
    const style = document.createElement('style');
    style.textContent = hidingRules.map(([, selector, declarations]) => `${selector} { ${declarations} }`).join('\n');
    document.head.append(style);
    document.documentElement.classList.add('kickflow-chat-active');
    const main = document.createElement('div');
    main.id = 'chatroom-messages';
    main.setAttribute('data-kickflow-main-chat', '');
    main.innerHTML = '<div><div data-index="0">main</div></div>';
    const side = document.createElement('div');
    side.id = 'chatroom-messages';
    side.innerHTML = '<div><div data-index="0">side</div></div>';
    document.body.append(main, side);
    try {
      expect(getComputedStyle(main.firstElementChild!).visibility).toBe('hidden');
      expect(getComputedStyle(main.querySelector('[data-index]')!).opacity).toBe('0');
      expect(getComputedStyle(side.firstElementChild!).visibility).not.toBe('hidden');
      expect(getComputedStyle(side.querySelector('[data-index]')!).opacity).not.toBe('0');
    } finally {
      main.remove(); side.remove(); style.remove();
      document.documentElement.classList.remove('kickflow-chat-active');
    }
  });
});
