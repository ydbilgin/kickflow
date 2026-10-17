import { OWN_LIST_ID } from './overlay-mount';

/** Scrolls KickFlow's own list to a message and flashes it. Returns false when the row is not in
 * the own-list DOM window, in which case the caller's cue element gets the miss animation. */
export function jumpToMessage(messageId: string, missCueElement: HTMLElement): boolean {
  const ownList = document.getElementById(OWN_LIST_ID);
  const target = ownList
    ? Array.from(ownList.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((element) => element.dataset.messageId === messageId)
    : undefined;
  if (!target) {
    // The original row has almost certainly scrolled past KickFlow's own DOM trim window
    // (dom-window.ts MAX_NON_PRESERVED_NODES) — a silent no-op here reads as broken, so
    // give the preview itself a brief "miss" cue instead of pretending nothing happened.
    missCueElement.classList.remove('kickflow-message__reply-context--miss');
    // Force reflow so the animation restarts on a second click while it's still playing.
    void missCueElement.offsetWidth;
    missCueElement.classList.add('kickflow-message__reply-context--miss');
    window.setTimeout(() => missCueElement.classList.remove('kickflow-message__reply-context--miss'), 500);
    return false;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('kickflow-message--jump-highlight');
  window.setTimeout(() => target.classList.remove('kickflow-message--jump-highlight'), 1800);
  return true;
}
