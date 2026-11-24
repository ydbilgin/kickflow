import { Lifecycle } from '../shared/lifecycle';

export interface ChatStartupAttempt {
  ready(): void;
  fail(showFailure: () => void): void;
  retry(): void;
}

/** Each automatic or manual retry owns fresh sockets, mount observers and deadlines.
 * Keep the final native fallback alive so its retry action remains usable. */
export function startChatWithRetries(
  parent: Lifecycle,
  start: (attempt: Lifecycle, controls: ChatStartupAttempt) => void,
): void {
  let active: Lifecycle | null = null;
  let timer: number | null = null;
  let attempt = 0;
  const begin = (): void => {
    if (parent.isDisposed) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    active?.dispose();
    const child = new Lifecycle();
    active = child;
    attempt++;
    let failed = false;
    const controls: ChatStartupAttempt = {
      ready: () => {
        if (child.isDisposed || parent.isDisposed) return;
        // A late native publication can recover the current list during backoff.
        // Cancel replacement rather than discarding already delivered messages.
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        failed = false;
        attempt = 0;
      },
      fail: (showFailure) => {
        if (failed || child.isDisposed || parent.isDisposed) return;
        failed = true;
        if (attempt >= 3) { showFailure(); return; }
        timer = window.setTimeout(begin, 1000 * 2 ** Math.max(0, attempt - 1));
      },
      retry: () => { attempt = 0; begin(); },
    };
    start(child, controls);
  };
  parent.add(() => {
    if (timer !== null) window.clearTimeout(timer);
    active?.dispose();
  });
  begin();
}
