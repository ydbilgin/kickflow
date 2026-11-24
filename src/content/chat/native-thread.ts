import type { Lifecycle } from '../shared/lifecycle';

/* Kick's native side conversation ("Yan Sohbet") panel and the native-row forward that opens it.
 *
 * This module is the ONLY place that knows Kick's markup for that panel. Everything else (the
 * stylesheet below, the own-list thread button, the MAIN-world id stamper) works through the
 * data-kickflow-thread-* attributes this module writes. When Kick changes its markup, detection
 * returns null, no attribute is written, and the panel keeps Kick's own look: that is the single
 * fallback, and it styles nothing.
 *
 * Markup source: live kick.com/hype, 2026-11-12, saved trimmed in
 * tests/fixtures/kick-thread-panel-live.html. The panel is a second element with the SAME id as the
 * main chat list (`#chatroom-messages`), preceded by a header holding the MessagesOutline icon,
 * an h2 title and a close button. */

const NATIVE_LIST_SELECTOR = '[id="chatroom-messages"]';
const PANEL_HEADER_ICON_SELECTOR = 'svg[data-ds-icon="MessagesOutline"]';
const PANEL_HEADER_TITLE_SELECTOR = ':scope > h2';
const PANEL_HEADER_CLOSE_SELECTOR = ':scope > button';
const NATIVE_ROW_SELECTOR = '[data-index]';
const NATIVE_MID_ATTRIBUTE = 'data-kickflow-mid';
const NATIVE_ROW_BODY_SELECTOR = '.group > .w-full';
const NATIVE_THREAD_ICON_SELECTOR = 'svg[data-ds-icon="ArrowCurveLeft"]';
/** Kick marks the parts of a row that must not expand it (the username button). */
const NATIVE_NO_EXPAND_SELECTOR = '[data-prevent-expand]';
const NATIVE_REPLY_TOOLBAR_SELECTOR = `div:has(> button > ${NATIVE_THREAD_ICON_SELECTOR})`;

export const THREAD_PANEL_ATTRIBUTE = 'data-kickflow-thread-panel';
export const THREAD_SHELL_ATTRIBUTE = 'data-kickflow-thread-shell';
export const THREAD_HEADER_ATTRIBUTE = 'data-kickflow-thread-header';
export const THREAD_LIST_ATTRIBUTE = 'data-kickflow-thread-list';
/** Set only after the panel was measured into the chat column; positioning depends on it. */
export const THREAD_PLACED_ATTRIBUTE = 'data-kickflow-thread-placed';

const MARK_ATTRIBUTES = [
  THREAD_PANEL_ATTRIBUTE,
  THREAD_SHELL_ATTRIBUTE,
  THREAD_HEADER_ATTRIBUTE,
  THREAD_LIST_ATTRIBUTE,
  THREAD_PLACED_ATTRIBUTE,
] as const;

/** Kick's default panel is 340px tall; inside the chat column it never takes more than 45%. */
const PANEL_MAX_HEIGHT_PX = 340;
const PANEL_MAX_HEIGHT_SHARE = 0.45;
/** After a forward, a panel that has not appeared by then means Kick offers none on this page. */
const PANEL_OPEN_DEADLINE_MS = 1200;

export interface ThreadPanelParts {
  outer: HTMLElement;
  shell: HTMLElement;
  header: HTMLElement;
  list: HTMLElement;
}

/** The panel parts around one `#chatroom-messages` element, or null when it is not the panel. */
export function threadPanelPartsFor(list: Element): ThreadPanelParts | null {
  if (!(list instanceof HTMLElement) || !list.matches(NATIVE_LIST_SELECTOR)) return null;
  const header = list.previousElementSibling;
  if (!(header instanceof HTMLElement)) return null;
  if (!header.querySelector(PANEL_HEADER_ICON_SELECTOR)
    || !header.querySelector(PANEL_HEADER_TITLE_SELECTOR)
    || !header.querySelector(PANEL_HEADER_CLOSE_SELECTOR)) return null;
  const shell = list.parentElement;
  const outer = shell?.parentElement;
  if (!shell || !outer || outer === list.ownerDocument.body || outer === list.ownerDocument.documentElement) return null;
  return { outer, shell, header, list };
}

export function isThreadPanelList(element: Element): boolean {
  return threadPanelPartsFor(element) !== null;
}

export function findThreadPanel(root: ParentNode = document): ThreadPanelParts | null {
  for (const list of Array.from(root.querySelectorAll(NATIVE_LIST_SELECTOR))) {
    const parts = threadPanelPartsFor(list);
    if (parts) return parts;
  }
  return null;
}

/** Every `#chatroom-messages` that is not the side-conversation panel (normally exactly one). */
export function findMainNativeLists(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(NATIVE_LIST_SELECTOR))
    .filter((list) => !isThreadPanelList(list));
}

export function findMainNativeList(root: ParentNode = document): HTMLElement | null {
  return findMainNativeLists(root)[0] ?? null;
}

/** The mounted native row of a message in the MAIN chat list. Panel rows never count: they are
 * a copy of the thread, and forwarding a click to them would act inside the panel. */
export function findMainNativeRow(messageId: string, root: ParentNode = document): HTMLElement | null {
  for (const list of findMainNativeLists(root)) {
    const row = Array.from(list.querySelectorAll<HTMLElement>(`[${NATIVE_MID_ATTRIBUTE}]`))
      .find((element) => element.getAttribute(NATIVE_MID_ATTRIBUTE) === messageId);
    if (row) return row;
  }
  return null;
}

let panelUnavailable = false;
/** Bumped by a reset so a pending open check from an earlier page/session cannot land late. */
let openCheckGeneration = 0;

/** True when Kick can open its thread for this message right now: the message's native row is
 * mounted in the main list with its thread control, and Kick has not shown, on this page, that it
 * offers no panel. */
export function nativeThreadAvailable(messageId: string, root: ParentNode = document): boolean {
  if (panelUnavailable) return false;
  const row = findMainNativeRow(messageId, root);
  return row !== null && threadClickTarget(row) !== null;
}

/** Kick's thread control on a mounted reply row. 0.3.20 clicked exactly this button on every quoted
 * line click, and live that opened the panel (live screenshots of 2026-11-12):
 * it is the one forward target with live evidence behind it. */
function threadClickTarget(row: HTMLElement): HTMLButtonElement | null {
  const button = row.querySelector(NATIVE_THREAD_ICON_SELECTOR)?.closest('button') ?? null;
  return button && !button.disabled ? button : null;
}

/** Opens Kick's own side-conversation panel for a message by clicking the thread control of its
 * mounted native row. Returns false when there is nothing to forward to (row virtualized away,
 * control missing or disabled, or no panel on this page). */
export function openNativeThread(messageId: string, root: ParentNode = document): boolean {
  if (panelUnavailable) return false;
  const row = findMainNativeRow(messageId, root);
  const target = row ? threadClickTarget(row) : null;
  if (!target) return false;
  target.click();
  const generation = openCheckGeneration;
  window.setTimeout(() => {
    if (generation === openCheckGeneration && !findThreadPanel(root)) panelUnavailable = true;
  }, PANEL_OPEN_DEADLINE_MS);
  return true;
}

/** Test seam: forget a "no panel on this page" verdict. */
export function resetNativeThreadState(): void {
  panelUnavailable = false;
  openCheckGeneration++;
}

/** Removes every mark that is not on its rightful element of `keep` (a closed or replaced panel). */
function clearMarks(root: ParentNode, keep: ThreadPanelParts | null): void {
  const owners: Record<(typeof MARK_ATTRIBUTES)[number], HTMLElement | undefined> = {
    [THREAD_PANEL_ATTRIBUTE]: keep?.outer,
    [THREAD_SHELL_ATTRIBUTE]: keep?.shell,
    [THREAD_HEADER_ATTRIBUTE]: keep?.header,
    [THREAD_LIST_ATTRIBUTE]: keep?.list,
    [THREAD_PLACED_ATTRIBUTE]: keep?.outer,
  };
  for (const attribute of MARK_ATTRIBUTES) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((element) => {
      if (element !== owners[attribute]) element.removeAttribute(attribute);
    });
  }
}

function placeInChatColumn(parts: ThreadPanelParts, root: ParentNode): void {
  const main = findMainNativeList(root);
  const containing = parts.outer.offsetParent;
  const unplace = (): void => { parts.outer.removeAttribute(THREAD_PLACED_ATTRIBUTE); };
  if (!main || !(containing instanceof HTMLElement)) return unplace();
  const chat = main.getBoundingClientRect();
  const box = containing.getBoundingClientRect();
  if (chat.width <= 0 || chat.height <= 0) return unplace();
  const height = Math.round(Math.min(PANEL_MAX_HEIGHT_PX, chat.height * PANEL_MAX_HEIGHT_SHARE));
  const style = parts.outer.style;
  style.setProperty('--kf-thread-left', `${Math.round(chat.left - box.left)}px`);
  style.setProperty('--kf-thread-right', `${Math.round(box.right - chat.right)}px`);
  style.setProperty('--kf-thread-bottom', `${Math.round(box.bottom - chat.bottom)}px`);
  style.setProperty('--kf-thread-height', `${height}px`);
  parts.outer.setAttribute(THREAD_PLACED_ATTRIBUTE, '');
}

/** Marks the current panel (if any) so the stylesheet can dress it, and moves it into the chat
 * column above the input. Returns the parts, or null when no panel is open. */
export function syncThreadPanel(root: ParentNode = document): ThreadPanelParts | null {
  const parts = findThreadPanel(root);
  clearMarks(root, parts);
  if (!parts) return null;
  panelUnavailable = false;
  parts.outer.setAttribute(THREAD_PANEL_ATTRIBUTE, '');
  parts.shell.setAttribute(THREAD_SHELL_ATTRIBUTE, '');
  parts.header.setAttribute(THREAD_HEADER_ATTRIBUTE, '');
  parts.list.setAttribute(THREAD_LIST_ATTRIBUTE, '');
  placeInChatColumn(parts, root);
  return parts;
}

function containsNativeList(node: Node): boolean {
  return node instanceof Element
    && (node.matches(NATIVE_LIST_SELECTOR) || node.querySelector(NATIVE_LIST_SELECTOR) !== null);
}

/** Message id the MAIN world stamped on a panel row (react-key-stamper stampThreadPanelRow). */
export function threadRowMessageId(row: Element): string | null {
  return row.getAttribute(NATIVE_MID_ATTRIBUTE);
}

/** The panel row a click landed on, unless it landed on one of Kick's own controls inside it. */
export function threadRowForClick(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(`button, a, ${NATIVE_NO_EXPAND_SELECTOR}`)) return null;
  return target.closest<HTMLElement>(`[${THREAD_LIST_ATTRIBUTE}] ${NATIVE_ROW_SELECTOR}`);
}

/** The panel row under a click target, found by markup alone (the MAIN world stamps it). */
export function threadPanelRowFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>(NATIVE_ROW_SELECTOR);
  const list = row?.closest(NATIVE_LIST_SELECTOR);
  return row && list && isThreadPanelList(list) ? row : null;
}

/** Keeps the panel marked and placed while the chat session lives, and makes a click on a panel
 * message jump to that message in KickFlow's list (T6). */
export function installNativeThreadPanel(
  lifecycle: Lifecycle,
  jump: (messageId: string, cueElement: HTMLElement) => void,
): void {
  const sync = (): void => { syncThreadPanel(); };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => Array.from(record.addedNodes).some(containsNativeList)
      || Array.from(record.removedNodes).some(containsNativeList))) sync();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  lifecycle.add(() => observer.disconnect());
  lifecycle.setInterval(sync, 1000);
  lifecycle.addEventListener(window, 'resize', sync);
  lifecycle.addEventListener(document, 'click', (event: Event) => {
    if ((event as MouseEvent).button !== 0) return;
    const row = threadRowForClick(event.target);
    const messageId = row ? threadRowMessageId(row) : null;
    if (!row || !messageId) return;
    jump(messageId, row);
  });
  lifecycle.add(() => clearMarks(document, null));
  // A new chat session (channel switch, popout) starts without an earlier "no panel" verdict.
  resetNativeThreadState();
  lifecycle.add(resetNativeThreadState);
  sync();
}

/** Selectors and declarations for the dressed panel. Only data-kickflow-thread-* attributes and
 * Kick row parts named in this module are used; without the attributes nothing here applies.
 * `!important` is needed against Kick's utility classes. The own-list takeover hides only the list
 * marked data-kickflow-main-chat (bootstrap.ts), so the panel needs no exemption. */
export const THREAD_PANEL_CSS = `
    /* --- Kick "Yan Sohbet" panel, dressed as part of KickFlow (native-thread.ts). --- */
    [${THREAD_PANEL_ATTRIBUTE}][${THREAD_PLACED_ATTRIBUTE}] {
      left: var(--kf-thread-left) !important; right: var(--kf-thread-right) !important;
      bottom: var(--kf-thread-bottom) !important; top: auto !important;
      width: auto !important; height: var(--kf-thread-height) !important; max-height: 45% !important;
      z-index: 40 !important;
    }
    [${THREAD_SHELL_ATTRIBUTE}] {
      background: var(--kf-ground) !important; border: 1px solid var(--kf-line-2) !important;
      border-radius: 6px !important; box-shadow: none !important; overflow: hidden;
      color: var(--kf-ink); font-family: var(--kf-font);
    }
    [${THREAD_HEADER_ATTRIBUTE}] {
      padding: 4px 4px 4px 10px !important; gap: 6px !important; flex: none;
      border-bottom: 1px solid var(--kf-line) !important;
    }
    [${THREAD_HEADER_ATTRIBUTE}] > div { width: 18px !important; height: 18px !important; color: var(--kf-ink-3); }
    [${THREAD_HEADER_ATTRIBUTE}] > h2 {
      font: 700 13px/1.4 var(--kf-font) !important; color: var(--kf-ink) !important; letter-spacing: 0;
    }
    [${THREAD_HEADER_ATTRIBUTE}] > button { width: 28px !important; height: 28px !important; color: var(--kf-ink-2) !important; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] {
      flex: 1 1 0 !important; height: auto !important; min-height: 0 !important;
      font-family: var(--kf-font); font-size: max(12px, var(--chatroom-font-size, 13px)); line-height: 1.5;
      color: var(--kf-ink); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} {
      font-size: inherit !important; line-height: 1.5 !important; border-radius: 4px !important;
      padding: var(--chatroom-message-spacing, 3px) 6px var(--chatroom-message-spacing, 3px) 10px !important;
      cursor: pointer;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}][${THREAD_LIST_ATTRIBUTE}] [data-index][data-index]:hover > ${NATIVE_ROW_BODY_SELECTOR} {
      background-color: rgba(255,255,255,0.045) !important;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} span { line-height: inherit !important; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] [data-index] > ${NATIVE_ROW_BODY_SELECTOR} button { font-weight: 700; }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}][${THREAD_LIST_ATTRIBUTE}] [data-index][data-index]:hover > .group > ${NATIVE_REPLY_TOOLBAR_SELECTOR} {
      display: flex !important;
    }
    #chatroom-messages[${THREAD_LIST_ATTRIBUTE}] .kickflow-message__reply-context--miss { animation: kickflow-reply-miss 0.5s ease; }
`;
