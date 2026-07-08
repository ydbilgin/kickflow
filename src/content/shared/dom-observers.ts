import type { Lifecycle } from './lifecycle';

export interface ElementPresenceOptions<T extends HTMLElement> {
  resolve?: () => T | null;
}

export function whenElementPresent<T extends HTMLElement = HTMLElement>(
  selector: string,
  lifecycle: Lifecycle,
  onPresent: (el: T) => void,
  options: ElementPresenceOptions<T> = {},
): void {
  let done = false;
  const resolve = options.resolve ?? (() => document.querySelector<T>(selector));

  const finish = (el: T): void => {
    if (done || lifecycle.isDisposed) return;
    done = true;
    onPresent(el);
  };

  const existing = resolve();
  if (existing) {
    finish(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const el = resolve();
    if (el) finish(el);
    if (done) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  lifecycle.add(() => observer.disconnect());
}
