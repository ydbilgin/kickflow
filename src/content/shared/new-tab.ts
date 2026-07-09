/** Opens a real anchor while it is detached, so site-level SPA routers cannot observe a
 * same-origin link, while the browser retains normal target=_blank tab handling. */
export function openInNewTab(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}

/** New-tab-only gestures (middle-click + modifier-left-click) for a non-anchor element,
 * WITHOUT claiming plain left-click — for elements whose plain click has another job
 * (or none), e.g. the user-card title. The button-1 mousedown must be cancelled here
 * too: its default action is Chrome's autoscroll pan, which inside a scrollable ancestor
 * swallows the gesture before `auxclick` ever fires (same trap as wireProfileSlugLink). */
export function wireNewTabGestures(element: HTMLElement, url: string): void {
  const act = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openInNewTab(url);
  };
  element.addEventListener('auxclick', (event) => { if (event.button === 1) act(event); });
  element.addEventListener('click', (event) => {
    if (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey)) act(event);
  });
  element.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
}
