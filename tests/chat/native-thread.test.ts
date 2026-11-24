import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THREAD_HEADER_ATTRIBUTE,
  THREAD_LIST_ATTRIBUTE,
  THREAD_PANEL_ATTRIBUTE,
  THREAD_PANEL_CSS,
  THREAD_PLACED_ATTRIBUTE,
  THREAD_SHELL_ATTRIBUTE,
  findMainNativeList,
  findThreadPanel,
  installNativeThreadPanel,
  isThreadPanelList,
  openNativeThread,
  resetNativeThreadState,
  syncThreadPanel,
} from '../../src/content/chat/native-thread';
import { Lifecycle } from '../../src/content/shared/lifecycle';

const FIXTURE = readFileSync(resolve(process.cwd(), 'tests/fixtures/kick-thread-panel-live.html'), 'utf8');

/** Kick's main chat list next to the live panel fixture. The main list's own header ("Sohbet")
 * has a title and buttons too; only the panel's has the MessagesOutline icon right before a list. */
function mountChatColumn(): { column: HTMLElement; main: HTMLElement } {
  const column = document.createElement('div');
  column.id = 'chat-column';
  column.innerHTML = `
    <div id="main-header"><h2>Sohbet</h2><button aria-label="Collapse"></button></div>
    <div id="chatroom-messages" data-testid="chatroom-messages"><div class="no-scrollbar">
      <div data-index="0" data-kickflow-mid="main-1"><div class="group"><div class="w-full"><span>main row</span></div><div><button id="main-thread"><svg data-ds-icon="ArrowCurveLeft"></svg></button></div></div></div>
    </div></div>
    <div id="chat-input-wrapper"></div>
    ${FIXTURE}`;
  document.body.append(column);
  return { column, main: column.querySelector<HTMLElement>('#chatroom-messages')! };
}

function cssRules(css: string): Array<{ selectors: string[]; body: string }> {
  const rules: Array<{ selectors: string[]; body: string }> = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: match[1].split(',').map((part) => part.trim()).filter(Boolean), body: match[2] });
  }
  return rules;
}

describe('Kick side-conversation panel detection (live fixture 2026-11-12)', () => {
  beforeEach(() => resetNativeThreadState());
  afterEach(() => {
    document.documentElement.classList.remove('kickflow-chat-active');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('finds the panel parts in the captured live markup', () => {
    mountChatColumn();
    const parts = findThreadPanel();

    expect(parts).not.toBeNull();
    expect(parts!.header.querySelector('h2')?.textContent).toBe('Yan Sohbet');
    expect(parts!.header.querySelector('button')?.getAttribute('aria-label')).toBe('Close');
    expect(parts!.list.id).toBe('chatroom-messages');
    expect(parts!.list.querySelector('[data-index]')?.textContent).toContain('ya sıktı abi bu oyun yaaaaa');
    expect(parts!.shell.parentElement).toBe(parts!.outer);
    expect(parts!.outer.className).toContain('right-[calc(100%+8px)]');
  });

  it('never takes the main chat list for the panel, even when the panel comes first in the page', () => {
    const { column, main } = mountChatColumn();
    const panelOuter = column.lastElementChild!;
    column.prepend(panelOuter);

    expect(isThreadPanelList(main)).toBe(false);
    expect(findMainNativeList()).toBe(main);
    expect(findThreadPanel()?.list).not.toBe(main);
  });

  it('marks only the panel; Kick markup changes leave everything unmarked (the no-styling fallback)', () => {
    const { main } = mountChatColumn();
    const parts = syncThreadPanel()!;

    expect(parts.outer.hasAttribute(THREAD_PANEL_ATTRIBUTE)).toBe(true);
    expect(parts.shell.hasAttribute(THREAD_SHELL_ATTRIBUTE)).toBe(true);
    expect(parts.header.hasAttribute(THREAD_HEADER_ATTRIBUTE)).toBe(true);
    expect(parts.list.hasAttribute(THREAD_LIST_ATTRIBUTE)).toBe(true);
    expect(main.closest(`[${THREAD_PANEL_ATTRIBUTE}], [${THREAD_LIST_ATTRIBUTE}]`)).toBeNull();

    // Kick drops the icon: detection fails and the earlier marks are removed.
    parts.header.querySelector('svg[data-ds-icon="MessagesOutline"]')!.remove();
    expect(syncThreadPanel()).toBeNull();
    for (const attribute of [THREAD_PANEL_ATTRIBUTE, THREAD_SHELL_ATTRIBUTE, THREAD_HEADER_ATTRIBUTE, THREAD_LIST_ATTRIBUTE, THREAD_PLACED_ATTRIBUTE]) {
      expect(document.querySelector(`[${attribute}]`)).toBeNull();
    }
  });

  it('every panel CSS rule needs a KickFlow mark, and every selector matches the marked live fixture', () => {
    mountChatColumn();
    document.documentElement.classList.add('kickflow-chat-active');
    const parts = syncThreadPanel()!;
    parts.outer.setAttribute(THREAD_PLACED_ATTRIBUTE, '');
    parts.list.querySelector('[data-index]')!.classList.add('kickflow-message__reply-context--miss');

    const rules = cssRules(THREAD_PANEL_CSS);
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const { selectors } of rules) {
      for (const selector of selectors) {
        expect(selector, selector).toMatch(/\[data-kickflow-thread-(panel|shell|header|list)\]/);
        const live = selector.replace(/:hover/g, '');
        const matches = Array.from(document.querySelectorAll(live));
        expect(matches.length, `no fixture match for ${selector}`).toBeGreaterThan(0);
        expect(matches.every((element) => parts.outer.contains(element)), `matches outside the panel: ${selector}`).toBe(true);
      }
    }
  });

  it('panel CSS dresses the panel as KickFlow (T5)', () => {
    const rules = cssRules(THREAD_PANEL_CSS);
    const body = (selector: string): string => rules.find((rule) => rule.selectors.includes(selector))?.body.replace(/\s+/g, ' ') ?? '';

    const placed = body('[data-kickflow-thread-panel][data-kickflow-thread-placed]');
    expect(placed).toContain('left: var(--kf-thread-left) !important');
    expect(placed).toContain('right: var(--kf-thread-right) !important');
    expect(placed).toContain('max-height: 45% !important');
    const shell = body('[data-kickflow-thread-shell]');
    expect(shell).toContain('border: 1px solid var(--kf-line-2) !important');
    expect(shell).toContain('box-shadow: none !important');
    expect(shell).toContain('font-family: var(--kf-font)');
    expect(body('#chatroom-messages[data-kickflow-thread-list]')).toContain('font-size: max(12px, var(--chatroom-font-size, 13px))');
  });

  it('places the panel over the bottom of the chat list, same width, at most 45% of its height', () => {
    const { column, main } = mountChatColumn();
    const parts = findThreadPanel()!;
    Object.defineProperty(parts.outer, 'offsetParent', { configurable: true, get: () => column });
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(rect(1500, 100, 360, 900));
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(rect(1500, 160, 360, 700));

    syncThreadPanel();

    expect(parts.outer.hasAttribute(THREAD_PLACED_ATTRIBUTE)).toBe(true);
    expect(parts.outer.style.getPropertyValue('--kf-thread-left')).toBe('0px');
    expect(parts.outer.style.getPropertyValue('--kf-thread-right')).toBe('0px');
    expect(parts.outer.style.getPropertyValue('--kf-thread-bottom')).toBe('140px');
    expect(parts.outer.style.getPropertyValue('--kf-thread-height')).toBe('315px');
  });

  it('without a measurable chat list the panel is dressed but left where Kick put it', () => {
    mountChatColumn();
    const parts = syncThreadPanel()!;
    expect(parts.outer.hasAttribute(THREAD_PANEL_ATTRIBUTE)).toBe(true);
    expect(parts.outer.hasAttribute(THREAD_PLACED_ATTRIBUTE)).toBe(false);
  });

  it('opens a thread through the main row\'s thread control, never a panel row', () => {
    const { main } = mountChatColumn();
    const mainRow = main.querySelector('[data-kickflow-mid="main-1"]')!;
    const panelRow = findThreadPanel()!.list.querySelector('[data-index]')!;
    panelRow.setAttribute('data-kickflow-mid', 'main-1');
    const mainClicks = vi.fn();
    const panelClicks = vi.fn();
    mainRow.addEventListener('click', mainClicks);
    panelRow.addEventListener('click', panelClicks);

    expect(openNativeThread('main-1')).toBe(true);
    expect(openNativeThread('not-mounted')).toBe(false);

    expect(mainClicks).toHaveBeenCalledOnce();
    expect((mainClicks.mock.calls[0][0] as Event).target).toBe(mainRow.querySelector('#main-thread'));
    expect(panelClicks).not.toHaveBeenCalled();
  });

  it('T6: a click on a panel message jumps to it; Kick controls inside the panel keep their own action', () => {
    mountChatColumn();
    const lifecycle = new Lifecycle();
    const jump = vi.fn();
    installNativeThreadPanel(lifecycle, jump);
    const row = findThreadPanel()!.list.querySelector<HTMLElement>('[data-index]')!;
    row.setAttribute('data-kickflow-mid', 'thread-msg-1');

    row.querySelector<HTMLElement>('span.font-normal')!.click();
    expect(jump).toHaveBeenCalledWith('thread-msg-1', row);

    jump.mockClear();
    row.querySelector<HTMLElement>('button[data-prevent-expand]')!.click();
    row.querySelector<HTMLElement>('button[aria-label="Yanıtla"]')!.click();
    expect(jump).not.toHaveBeenCalled();

    lifecycle.dispose();
    expect(document.querySelector(`[${THREAD_PANEL_ATTRIBUTE}]`)).toBeNull();
  });

  it('T6: an unstamped panel row (id unknown) does nothing', () => {
    mountChatColumn();
    const lifecycle = new Lifecycle();
    const jump = vi.fn();
    installNativeThreadPanel(lifecycle, jump);

    findThreadPanel()!.list.querySelector<HTMLElement>('span.font-normal')!.click();

    expect(jump).not.toHaveBeenCalled();
    lifecycle.dispose();
  });
});
