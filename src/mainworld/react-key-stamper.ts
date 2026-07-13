const CHAT_LIST_SELECTOR = '#chatroom-messages .no-scrollbar';
const ROW_SELECTOR = '[data-index]';
const MID_ATTR = 'data-kickflow-mid';
const DEBUG_SAMPLE_LIMIT = 25;

let debugSamples = 0;

export interface ReactKeyStamperController {
  restampCurrentList(): void;
  teardown(): void;
}

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

const REACT_MESSAGE_KEY = /^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** React currently keys virtualized rows as `numeric-index-UUID`. Reject unexpected shapes
 * instead of slicing arbitrary text into a plausible-but-wrong message id. */
export function parseMessageId(key: string): string | null {
  return REACT_MESSAGE_KEY.exec(key)?.[2] ?? null;
}

function readMessageId(row: HTMLElement): string | null {
  const rawKey = rawReactKey(row);
  return rawKey ? parseMessageId(rawKey) : null;
}

export function stampRow(row: HTMLElement): void {
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
    if (rawKey && !messageId) {
      console.debug('[kickflow-mainworld] unexpected React row key shape; skipped stamping', rawKey);
    } else {
      console.debug('[kickflow-mainworld] key', rawKey, '-> mid', messageId);
    }
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

export function initReactKeyStamper(root: Document | HTMLElement = document): ReactKeyStamperController {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  const observerRoot = root instanceof Document ? ownerDocument.body : root;
  const MutationObserverCtor = ownerDocument.defaultView?.MutationObserver ?? MutationObserver;

  let observedList: HTMLElement | null = null;
  let listObserver: MutationObserver | null = null;
  let bodyObserver: MutationObserver | null = null;
  const delayedPasses = new Set<number>();

  const restampCurrentList = (): void => {
    if (!observedList) return;
    observedList.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((row) => {
      const currentId = row.getAttribute(MID_ATTR);
      const nextId = readMessageId(row);
      if (!currentId || currentId !== nextId) {
        stampRow(row);
      }
    });
  };

  const scheduleDelayedRestamps = (): void => {
    for (const delayMs of [100, 1000]) {
      const timeoutId = window.setTimeout(() => {
        delayedPasses.delete(timeoutId);
        restampCurrentList();
      }, delayMs);
      delayedPasses.add(timeoutId);
    }
  };

  const detachObservedList = (): void => {
    listObserver?.disconnect();
    listObserver = null;
    observedList = null;
  };

  const observeList = (list: HTMLElement): void => {
    if (list === observedList) return;
    listObserver?.disconnect();
    observedList = list;
    stampExistingRows(list);
    scheduleDelayedRestamps();

    listObserver = new MutationObserverCtor((mutations) => {
      for (const mutation of mutations) {
        const targetRow = closestRow(mutation.target);
        if (targetRow) stampRow(targetRow);
        for (const node of mutation.addedNodes) {
          collectRows(node).forEach(stampRow);
        }
      }
    });
    listObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-index'] });
  };

  const attachToCurrentList = (): void => {
    const list = root.querySelector<HTMLElement>(CHAT_LIST_SELECTOR);
    if (list) {
      observeList(list);
    } else if (observedList) {
      // Chat collapse/unmount can leave the list absent indefinitely. Stop the per-list observer
      // and release the detached React subtree until a replacement appears.
      detachObservedList();
    }
  };

  attachToCurrentList();

  bodyObserver = new MutationObserverCtor((records) => {
    const currentWasDetached = observedList !== null && !observedList.isConnected;
    const couldIntroduceList = observedList === null && records.some((record) =>
      Array.from(record.addedNodes).some((node) => node instanceof Element && (
        node.matches(CHAT_LIST_SELECTOR) || node.querySelector(CHAT_LIST_SELECTOR) !== null
      )),
    );
    if (currentWasDetached || couldIntroduceList) attachToCurrentList();
  });
  if (observerRoot) {
    bodyObserver.observe(observerRoot, { childList: true, subtree: true });
  }
  const intervalId = window.setInterval(() => {
    attachToCurrentList();
    restampCurrentList();
  }, 1000);

  return {
    restampCurrentList,
    teardown(): void {
      detachObservedList();
      bodyObserver?.disconnect();
      window.clearInterval(intervalId);
      delayedPasses.forEach((timeoutId) => window.clearTimeout(timeoutId));
      delayedPasses.clear();
      bodyObserver = null;
    },
  };
}

let autoController: ReactKeyStamperController | null = null;

function start(): void {
  autoController ??= initReactKeyStamper();
}

if (document.body) {
  start();
} else {
  window.addEventListener('DOMContentLoaded', start, { once: true });
}

window.addEventListener('pagehide', () => {
  autoController?.teardown();
  autoController = null;
});
