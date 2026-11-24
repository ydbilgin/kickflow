import { afterEach, describe, expect, it } from 'vitest';
import { declarations, styleTemplate } from '../helpers/bootstrap-css';
import { HOVER_TOOLTIP_MAX_WIDTH_CSS_VARIABLE } from '../../src/content/shared/hover-tooltip';

describe('own-mode message row geometry styles', () => {
  // 2026-11-11: the tests that only matched CSS text (toContain('margin: ...')) were removed; they
  // pinned the stylesheet's wording, not what a reader sees. Geometry is the browser gate's job
  // (tests/playwright/chat-layout.mjs). This one applies the production stylesheet and reads styles.
  afterEach(() => {
    document.head.querySelector('[data-kickflow-test-styles]')?.remove();
    document.body.innerHTML = '';
  });

  function productionCss(): string {
    return styleTemplate()
      .replaceAll('${OVERLAY_ROOT_ID}', 'kickflow-chat-overlay')
      .replaceAll('${OWN_LIST_ID}', 'kickflow-message-list')
      .replace(/\$\{[A-Z][A-Z0-9_]*\}/g, '0');
  }

  it('measures action roles and the band from the production stylesheet', () => {
    const style = document.createElement('style');
    style.dataset.kickflowTestStyles = 'true';
    style.textContent = productionCss();
    document.head.append(style);

    const list = document.createElement('div');
    list.id = 'kickflow-message-list';
    list.style.fontSize = '16px';
    const nativeRow = document.createElement('div');
    nativeRow.style.backgroundColor = 'rgb(24, 24, 27)';
    const action = document.createElement('div');
    action.className = 'kickflow-message kickflow-event-row kickflow-event-row--mod-action kickflow-modaction-surface kickflow-modaction-kind--ban';
    const body = document.createElement('span');
    body.className = 'kickflow-event-row__body';
    const tag = document.createElement('span');
    tag.className = 'kickflow-event-row__kind-tag';
    tag.textContent = 'BAN';
    const moderator = document.createElement('span');
    moderator.className = 'kickflow-event-row__moderator';
    moderator.textContent = 'moderator';
    const target = document.createElement('span');
    target.className = 'kickflow-event-row__victim';
    target.textContent = 'target';
    target.style.color = 'rgb(18, 171, 239)';
    body.append(tag, moderator, target);
    action.append(body);
    list.append(nativeRow, action);
    document.body.append(list);

    const actionStyle = getComputedStyle(action);
    const tagStyle = getComputedStyle(tag);
    const moderatorStyle = getComputedStyle(moderator);
    const targetStyle = getComputedStyle(target);
    const nativeStyle = getComputedStyle(nativeRow);

    expect(tagStyle.textTransform).not.toBe('uppercase');
    expect(Number.parseFloat(tagStyle.fontSize)).toBeLessThan(Number.parseFloat(actionStyle.fontSize));
    expect(actionStyle.getPropertyValue('--kickflow-modaction-moderator-color').trim())
      .toBe('#eef2ef');
    // jsdom preserves unresolved custom-property references in computed declarations. The
    // variable value above is read from the real stylesheet and is the browser-resolved color.
    expect(moderatorStyle.color).toBe('var(--kickflow-modaction-moderator-color)');
    expect(moderatorStyle.color).not.toBe(targetStyle.color);
    expect(targetStyle.color).toBe('rgb(18, 171, 239)');
    expect(targetStyle.textDecoration).toContain('underline');
    // Margin design: no card border; the kind lives in a dashed left gutter (::before).
    expect(actionStyle.borderLeftWidth).toBe('0px');
    expect(actionStyle.borderRightWidth).toBe('0px');
    expect(actionStyle.backgroundColor).not.toBe(nativeStyle.backgroundColor);
    // jsdom does not resolve color-mix(), so verify the computed custom-property payload and
    // production background binding here; Chromium resolves this band during the offline probe.
    expect(actionStyle.getPropertyValue('--kickflow-modaction-band').trim())
      .toContain('linear-gradient(90deg');
    expect(actionStyle.background).toBe('var(--kickflow-modaction-band)');
  });

  it('keeps status labels in their i18n case (lower-casing printed "tımeout" on a Turkish page)', () => {
    expect(declarations('.kickflow-status-label')).toContain('text-transform: none');
  });
});
