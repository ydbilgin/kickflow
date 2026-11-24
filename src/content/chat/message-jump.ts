import { READER_SCROLL_EVENT } from './dom-window';
import { OWN_LIST_ID } from './overlay-mount';

const MISS_CLASS = 'kickflow-message__reply-context--miss';

/** A short shake on the clicked element: "the message you asked for is not in the list". */
export function playMissCue(missCueElement: HTMLElement): void {
  missCueElement.classList.remove(MISS_CLASS);
  // Force reflow so the animation restarts on a second click while it's still playing.
  void missCueElement.offsetWidth;
  missCueElement.classList.add(MISS_CLASS);
  window.setTimeout(() => missCueElement.classList.remove(MISS_CLASS), 500);
}

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
    playMissCue(missCueElement);
    return false;
  }
  // The reader asked for this scroll: the follow controller must not snap it back to the bottom.
  ownList?.dispatchEvent(new Event(READER_SCROLL_EVENT));
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('kickflow-message--jump-highlight');
  window.setTimeout(() => target.classList.remove('kickflow-message--jump-highlight'), 1800);
  return true;
}
