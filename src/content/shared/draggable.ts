/** Drag `element` by pressing `handle`. Clamps to the viewport. Ignores drags starting on
 * elements matching `ignoreSelector` (e.g. buttons/links). Cleans its document listeners up on
 * mouseup AND when `element` dispatches `kickflow:dismiss` (so a removed/rebuilt element can't
 * leak listeners). Returns a disposer that also removes the mousedown handler. */
export function makeDraggable(element: HTMLElement, handle: HTMLElement, ignoreSelector?: string): () => void {
  let stopActiveDrag: (() => void) | null = null;
  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (ignoreSelector && (event.target as HTMLElement).closest(ignoreSelector)) return;
    stopActiveDrag?.();
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: MouseEvent): void => {
      const x = Math.max(4, Math.min(moveEvent.clientX - offsetX, window.innerWidth - element.offsetWidth - 4));
      const y = Math.max(4, Math.min(moveEvent.clientY - offsetY, window.innerHeight - element.offsetHeight - 4));
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    };
    // Clean up on mouseup OR if the element is dismissed mid-drag (Escape / another card / channel
    // switch) — otherwise the document listeners leak and keep the detached element alive.
    const stop = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      element.removeEventListener('kickflow:dismiss', stop);
      if (stopActiveDrag === stop) stopActiveDrag = null;
    };
    stopActiveDrag = stop;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    element.addEventListener('kickflow:dismiss', stop);
  };
  handle.addEventListener('mousedown', onMouseDown);
  return () => {
    stopActiveDrag?.();
    handle.removeEventListener('mousedown', onMouseDown);
  };
}
