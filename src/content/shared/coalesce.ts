/** Runs `work` at most once per `minGapMs`, trailing edge, and not at all while the tab is hidden
 * (one run happens when it is shown again). MutationObservers on busy Kick pages fire for every chat
 * row; this keeps their handlers from querying and measuring the DOM at that rate. 2026-11-08. */
export function coalesce(
  work: () => void,
  minGapMs: number,
  lifecycle?: { add(disposer: () => void): void },
): { run(): void; flush(): void; cancel(): void } {
  let timer: number | null = null;
  let last = -Infinity;
  let disposed = false;
  const fire = (): void => {
    timer = null;
    if (document.visibilityState === 'hidden') return;
    last = performance.now();
    work();
  };
  const api = {
    run(): void {
      if (disposed || timer !== null) return;
      const wait = Math.max(0, last + minGapMs - performance.now());
      timer = window.setTimeout(fire, wait);
    },
    flush(): void {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      fire();
    },
    cancel(): void {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
    },
  };
  const onVisible = (): void => { if (document.visibilityState !== 'hidden') api.run(); };
  document.addEventListener('visibilitychange', onVisible);
  lifecycle?.add(() => { disposed = true; api.cancel(); document.removeEventListener('visibilitychange', onVisible); });
  return api;
}

/** Kick's chat list and KickFlow's own list change many times a second on a busy channel. Their
 * rows scroll and mutate inside fixed-size scrollers, so nothing outside them moves or appears
 * because of those changes. Page-wide observers and capture-phase scroll listeners that align
 * header, footer or player controls can skip such events instead of measuring layout. 2026-11-09. */
const CHAT_SCROLLER_SELECTOR = '#chatroom-messages, #kickflow-chat-overlay';

export function isInsideChatScroller(target: EventTarget | Node | null): boolean {
  if (!target || typeof (target as Node).nodeType !== 'number') return false;
  const node = target as Node;
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return element?.closest(CHAT_SCROLLER_SELECTOR) != null;
}

/** True when every record happened inside a chat scroller (see isInsideChatScroller). */
export function onlyChatMutations(records: readonly MutationRecord[]): boolean {
  for (const record of records) if (!isInsideChatScroller(record.target)) return false;
  return records.length > 0;
}

/** A UI-upkeep timer that only works while the tab can be seen. Hidden tabs skip the tick (no DOM
 * query, no layout) and one catch-up tick runs the moment the tab is shown again, so nothing is lost.
 * Needs only `setInterval` and `add` from the lifecycle. Do not use it for timers that carry data,
 * clocks or network work. 2026-11-08. */
export function visibleInterval(
  lifecycle: { setInterval(handler: () => void, intervalMs: number): void; add(disposer: () => void): void },
  handler: () => void,
  intervalMs: number,
): void {
  const tick = (): void => {
    if (document.visibilityState === 'hidden') return;
    handler();
  };
  lifecycle.setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', tick);
  lifecycle.add(() => document.removeEventListener('visibilitychange', tick));
}
