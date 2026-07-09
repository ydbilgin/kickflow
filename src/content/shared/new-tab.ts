/** Opens a real anchor while it is detached, so site-level SPA routers cannot observe a
 * same-origin link, while the browser retains normal target=_blank tab handling. */
export function openInNewTab(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.click();
}
