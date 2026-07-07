const CHAT_LIST_SELECTOR = '#chatroom-messages .no-scrollbar';
const ROW_SELECTOR = '[data-index]';
const MID_ATTR = 'data-kickflow-mid';
const DEBUG_SAMPLE_LIMIT = 25;

let observedList: HTMLElement | null = null;
let listObserver: MutationObserver | null = null;
let bodyObserver: MutationObserver | null = null;
let debugSamples = 0;

function debugEnabled(): boolean {
  try {
    return window.localStorage.getItem('kickflow.debug') === '1';
  } catch {
    return false;
  }
}

function rawReactKey(el: Element): string | null {
  try {
    const prop = Object.getOwnPropertyNames(el).find((name) => name.startsWith('__reactFiber'));
    const key = prop ? (el as unknown as Record<string, { key?: unknown } | undefined>)[prop]?.key : null;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

function parseMessageId(key: string): string {
  const parts = key.split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : key;
}

function stampRow(row: HTMLElement): void {
  const rawKey = rawReactKey(row);
  const messageId = rawKey ? parseMessageId(rawKey) : null;

  if (messageId) {
    if (row.getAttribute(MID_ATTR) !== messageId) {
      row.setAttribute(MID_ATTR, messageId);
    }
  } else if (row.hasAttribute(MID_ATTR)) {
    row.removeAttribute(MID_ATTR);
  }

  if (debugEnabled() && debugSamples < DEBUG_SAMPLE_LIMIT) {
    debugSamples++;
    console.debug('[kickflow-mainworld] key', rawKey, '-> mid', messageId);
  }
}

function collectRows(node: Node): HTMLElement[] {
  if (!(node instanceof HTMLElement)) return [];
  const rows: HTMLElement[] = [];
  if (node.matches(ROW_SELECTOR)) rows.push(node);
  rows.push(...Array.from(node.querySelectorAll<HTMLElement>(ROW_SELECTOR)));
  return rows;
}

function closestRow(node: Node): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return node.parentElement?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
  return node.matches(ROW_SELECTOR) ? node : node.closest<HTMLElement>(ROW_SELECTOR);
}

function stampExistingRows(list: HTMLElement): void {
  list.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach(stampRow);
}

function observeList(list: HTMLElement): void {
  if (list === observedList) return;
  listObserver?.disconnect();
  observedList = list;
  stampExistingRows(list);

  listObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const targetRow = closestRow(mutation.target);
      if (targetRow) stampRow(targetRow);
      for (const node of mutation.addedNodes) {
        collectRows(node).forEach(stampRow);
      }
    }
  });
  listObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-index'] });
}

function attachToCurrentList(): void {
  const list = document.querySelector<HTMLElement>(CHAT_LIST_SELECTOR);
  if (list) observeList(list);
}

function start(): void {
  attachToCurrentList();

  bodyObserver = new MutationObserver(() => attachToCurrentList());
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  window.setInterval(attachToCurrentList, 1000);
}

if (document.body) {
  start();
} else {
  window.addEventListener('DOMContentLoaded', start, { once: true });
}

window.addEventListener('pagehide', () => {
  listObserver?.disconnect();
  bodyObserver?.disconnect();
});
