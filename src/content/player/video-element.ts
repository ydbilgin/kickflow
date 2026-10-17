import { getVideoElement } from '../shared/selectors';
import type { Lifecycle } from '../shared/lifecycle';

type VideoElementCallback = (video: HTMLVideoElement | null) => void;

interface VideoElementObserver {
  current: HTMLVideoElement | null;
  callbacks: Set<VideoElementCallback>;
  observer: MutationObserver;
}

const observers = new WeakMap<Lifecycle, VideoElementObserver>();

function notifyIfChanged(entry: VideoElementObserver): void {
  const next = getVideoElement();
  if (next === entry.current) return;
  entry.current = next;
  for (const callback of entry.callbacks) callback(next);
}

function observerFor(lifecycle: Lifecycle): VideoElementObserver {
  const existing = observers.get(lifecycle);
  if (existing) return existing;

  // MutationObserver already batches per microtask (one callback per render batch, not per node),
  // and notifyIfChanged is a cheap `#video-player` id-query + identity compare — so an undebounced
  // body observer is fine here and keeps element swaps instant.
  let entry!: VideoElementObserver;
  const observer = new MutationObserver(() => notifyIfChanged(entry));
  entry = {
    current: getVideoElement(),
    callbacks: new Set(),
    observer,
  };
  entry.observer.observe(document.body, { childList: true, subtree: true });
  lifecycle.add(() => {
    entry.observer.disconnect();
    entry.callbacks.clear();
    observers.delete(lifecycle);
  });
  observers.set(lifecycle, entry);
  return entry;
}

export function observeVideoElement(lifecycle: Lifecycle, callback: VideoElementCallback): void {
  if (lifecycle.isDisposed) return;
  const entry = observerFor(lifecycle);
  entry.callbacks.add(callback);
  lifecycle.add(() => entry.callbacks.delete(callback));
  callback(entry.current);
}

export function bindVideoElementListener(
  lifecycle: Lifecycle,
  type: string,
  listener: EventListener,
  options?: boolean | AddEventListenerOptions,
): void {
  let bound: HTMLVideoElement | null = null;

  observeVideoElement(lifecycle, (video) => {
    if (bound === video) return;
    bound?.removeEventListener(type, listener, options);
    bound = video;
    bound?.addEventListener(type, listener, options);
  });

  lifecycle.add(() => {
    bound?.removeEventListener(type, listener, options);
    bound = null;
  });
}
