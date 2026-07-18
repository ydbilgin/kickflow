import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bootstrapSource = readFileSync(
  resolve(process.cwd(), 'src/content/bootstrap.ts'),
  'utf8',
).replace(/\r\n?/g, '\n');

function styleTemplate(): string {
  const marker = 'style.textContent = `';
  const start = bootstrapSource.indexOf(marker);
  const end = bootstrapSource.indexOf('`;\n  document.head.appendChild(style);', start + marker.length);
  if (start < 0 || end < 0) throw new Error('bootstrap style template not found');
  return bootstrapSource.slice(start + marker.length, end);
}

function declarations(selector: string): string {
  const css = styleTemplate();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1].replace(/\s+/g, ' ').trim();
}

describe('own-mode message row geometry styles', () => {
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
