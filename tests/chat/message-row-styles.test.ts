import { afterEach, describe, expect, it } from 'vitest';
import { declarations, styleTemplate } from '../helpers/bootstrap-css';

describe('own-mode message row geometry styles', () => {
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

  it('uses the native chat typography and keeps all badge spacing on the container', () => {
    const list = declarations('#${OWN_LIST_ID}');
    const row = declarations('#${OWN_LIST_ID} .kickflow-message');
    const time = declarations('#${OWN_LIST_ID} .kickflow-message__time');
    const emptyTime = declarations('#${OWN_LIST_ID} .kickflow-message__time:empty');
    const identity = declarations('#${OWN_LIST_ID} .kickflow-message__identity');
    const badges = declarations('#${OWN_LIST_ID} .kickflow-message__badges');
    const icon = declarations('.kickflow-badge-icon');
    const role = declarations('.kickflow-badge-role');
    const text = declarations('.kickflow-badge-text');

    expect(list).toContain('font-size: var(--chatroom-font-size, 13px)');
    expect(list).toContain('line-height: 1.5');
    expect(row).toContain('padding: var(--chatroom-message-spacing, 3px) 5px');
    expect(time).toContain('display: var(--chatroom-timestamps-display, inline)');
    expect(time).toContain('font-size: calc(var(--chatroom-font-size, 13px) - 2px)');
    expect(time).toContain('font-weight: 600');
    expect(time).toContain('margin-right: 4px');
    expect(emptyTime).toBe('display: none;');
    expect(identity).toContain('display: inline-flex');
    expect(identity).toContain('align-items: baseline');
    expect(badges).toContain('gap: 4px');
    expect(badges).toContain('padding-right: 4px');
    expect(badges).toContain('align-self: center');
    expect(badges).not.toContain('margin-right');
    expect(badges).not.toContain('vertical-align');
    for (const badge of [icon, role, text]) {
      expect(badge).not.toContain('margin-right');
      expect(badge).not.toContain('vertical-align');
    }
  });

  it('matches native separator and content treatment', () => {
    const separator = declarations('#${OWN_LIST_ID} .kickflow-message__separator');
    const content = declarations('#${OWN_LIST_ID} .kickflow-message__content');

    expect(separator).toContain('display: inline-flex');
    expect(separator).toContain('font-weight: 700');
    expect(separator).toContain('color: inherit');
    expect(content).toContain('line-height: 1.55');
  });

  it('does not let the generic message hover erase semantic system-event tints', () => {
    const hover = declarations('#${OWN_LIST_ID} .kickflow-message:not(.kickflow-event-row):hover');

    expect(hover).toContain('background: rgba(255,255,255,0.06)');
  });

  it('neutralizes the native content-holder inset for injected moderator notices', () => {
    const notice = declarations('.kickflow-modaction-block');
    const inlinePadding = '--kickflow-native-content-inline-padding';

    expect(notice).toContain(`${inlinePadding}: 8px`);
    expect(notice).toContain(`margin: 3px 0 0 calc(-1 * var(${inlinePadding}))`);
    expect(notice).toContain(`width: calc(100% + (2 * var(${inlinePadding})))`);
    expect(notice).toContain(`max-width: calc(100% + (2 * var(${inlinePadding})))`);
  });

  it('uses a tagged role contrast and a tinted band for every moderator-action kind', () => {
    const actionCss = styleTemplate();
    const tag = declarations('.kickflow-event-row--mod-action .kickflow-event-row__kind-tag');
    const moderator = declarations('.kickflow-event-row--mod-action .kickflow-event-row__moderator');
    const victim = declarations('.kickflow-event-row--mod-action .kickflow-event-row__victim');
    const victimAction = declarations('.kickflow-event-row__victim-action');
    const jumpControl = declarations('.kickflow-event-row__jump-control[role="button"]');
    const bulkRow = declarations('.kickflow-event-row--mod-action-bulk[role="button"]');
    const block = declarations('.kickflow-modaction-block');

    const surface = declarations('.kickflow-modaction-surface');

    expect(actionCss).toContain('.kickflow-modaction-surface {');
    expect(surface).toContain('--kickflow-modaction-accent: oklch(0.80 0.06 265)');
    expect(surface).toContain('background: var(--kickflow-modaction-band)');
    expect(surface).toContain('border: 0');
    expect(surface).toContain('border-radius: 4px');
    expect(tag).toContain('font-size: 10px');
    expect(tag).toContain('font-weight: 700');
    expect(tag).toContain('letter-spacing: 0.07em');
    expect(tag).toContain('text-transform: uppercase');
    expect(moderator).toContain('color: var(--kickflow-modaction-moderator-color)');
    expect(victim).toContain('text-decoration: underline');
    expect(victimAction).toContain('display: inline-flex');
    expect(victimAction).toContain('flex-wrap: nowrap');
    expect(jumpControl).toContain('display: inline-flex');
    expect(jumpControl).toContain('margin-left: 4px');
    expect(jumpControl).toContain('color: var(--kickflow-modaction-meta-color)');
    expect(jumpControl).toContain('text-decoration: none');
    expect(jumpControl).not.toContain('font-size');
    expect(bulkRow).toContain('cursor: pointer');
    expect(actionCss).toContain('.kickflow-event-row--mod-action .kickflow-event-row__count,');
    expect(actionCss).toContain('font-variant-numeric: tabular-nums');
    expect(block).toContain('border: 0');
    expect(block).not.toMatch(/border-(?:left|right):\s*2px/);

    expect(declarations('.kickflow-modaction-kind--ban'))
      .toContain('--kickflow-modaction-accent: oklch(0.64 0.19 22)');
    expect(declarations('.kickflow-modaction-kind--timeout'))
      .toContain('--kickflow-modaction-accent: oklch(0.75 0.14 72)');
    expect(declarations('.kickflow-modaction-kind--delete'))
      .toContain('--kickflow-modaction-accent: oklch(0.80 0.06 265)');
  });

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

    expect(tagStyle.textTransform).toBe('uppercase');
    expect(Number.parseFloat(tagStyle.fontSize)).toBeLessThan(Number.parseFloat(actionStyle.fontSize));
    expect(actionStyle.getPropertyValue('--kickflow-modaction-moderator-color').trim())
      .toBe('oklch(0.78 0.13 155)');
    // jsdom preserves unresolved custom-property references in computed declarations. The
    // variable value above is read from the real stylesheet and is the browser-resolved color.
    expect(moderatorStyle.color).toBe('var(--kickflow-modaction-moderator-color)');
    expect(moderatorStyle.color).not.toBe(targetStyle.color);
    expect(targetStyle.color).toBe('rgb(18, 171, 239)');
    expect(targetStyle.textDecoration).toContain('underline');
    expect(actionStyle.borderLeftWidth).toBe('0px');
    expect(actionStyle.borderRightWidth).toBe('0px');
    expect(actionStyle.backgroundColor).not.toBe(nativeStyle.backgroundColor);
    // jsdom does not resolve color-mix(), so verify the computed custom-property payload and
    // production background binding here; Chromium resolves this band during the offline probe.
    expect(actionStyle.getPropertyValue('--kickflow-modaction-band').trim())
      .toContain('color-mix(in oklch');
    expect(actionStyle.background).toBe('var(--kickflow-modaction-band)');
  });

  it('uses native-sized, line-box-neutral emote wrappers at every chat font size', () => {
    const baseBox = declarations('.kickflow-emote-box');
    const baseImage = declarations('.kickflow-emote');
    const box = declarations('#${OWN_LIST_ID} .kickflow-emote-box');
    const image = declarations('#${OWN_LIST_ID} .kickflow-emote');
    const compactBox = declarations('#${OWN_LIST_ID} .kickflow-message__reply-snippet .kickflow-emote-box');
    const compactImage = declarations('#${OWN_LIST_ID} .kickflow-message__reply-snippet .kickflow-emote');

    expect(baseBox).toContain('position: relative');
    expect(baseImage).toContain('position: absolute');
    expect(baseImage).toContain('transform: translateY(-50%)');
    expect(box).toContain('height: 1.2em');
    expect(box).toContain('width: calc(var(--chatroom-font-size, 13px) * (28 / 13))');
    expect(box).toContain('margin: 0 1px');
    expect(image).toContain('height: calc(var(--chatroom-font-size, 13px) * (28 / 13))');
    expect(compactBox).toContain('width: 16px');
    expect(compactBox).toContain('height: 16px');
    expect(compactImage).toContain('width: 16px !important');
    expect(compactImage).toContain('height: 16px !important');
  });
});
