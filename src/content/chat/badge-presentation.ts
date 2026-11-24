/** A badge keeps its own keyboard/pointer tooltip target. Message rows may additionally
 * forward activation to the same mounted native badge, which owns any provider action. */
export function applyBadgePresentation(element: HTMLElement, onActivate?: () => void): void {
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.addEventListener('click', (event) => {
    if ((event as MouseEvent).button !== 0) return;
    event.stopPropagation();
    element.focus();
    onActivate?.();
  });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    element.focus();
    onActivate?.();
  });
}

/** The group gives screen readers a compact list while every badge retains its own label. */
export function describeBadgeGroup(parent: HTMLElement): void {
  const badges = Array.from(parent.querySelectorAll<HTMLElement>('.kickflow-badge-icon, .kickflow-badge-role, .kickflow-badge-text'));
  if (!badges.length) return;
  const names = badges.map((element) => element.getAttribute('aria-label') || element.getAttribute('alt') || element.textContent || '').filter(Boolean);
  parent.classList.add('kickflow-badge-group');
  parent.setAttribute('role', 'group');
  parent.setAttribute('aria-label', names.join(' · '));
}

/** Native icon art stays bare. The outline exists only while a keyboard user is on a badge. */
export const BADGE_STYLES = `
    .kickflow-badge-icon, .kickflow-badge-role, .kickflow-badge-text {
      background: transparent; border: 0; box-shadow: none; border-radius: 0;
      padding: 0; opacity: 1; cursor: pointer;
    }
    .kickflow-badge-icon:focus-visible,
    .kickflow-badge-role:focus-visible,
    .kickflow-badge-text:focus-visible {
      outline: 2px solid var(--kf-green); outline-offset: 2px;
    }
`;
