import type { Lifecycle } from '../shared/lifecycle';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';
import type { ModActionKind, ModActionNotice } from './mod-action-feed';

export const MOD_ACTION_MAX_VISIBLE = 3;
export const MOD_ACTION_NAMES_SHOWN = 3;
export const MOD_ACTION_NOTICE_TTL_MS = 12_000;
export const MOD_ACTION_STRIP_MIN_WIDTH_PX = 220;
export const MOD_ACTION_STRIP_INSET_PX = 8;
export const MOD_ACTION_STRIP_ANIMATION_MS = 180;

const STRIP_CLASS = 'kickflow-modaction-strip';
const ROW_CLASS = 'kickflow-modaction-row';
const ROW_TEXT_CLASS = 'kickflow-modaction-row__text';
const ROW_HEADLINE_CLASS = 'kickflow-modaction-row__headline';
const ROW_NAMES_CLASS = 'kickflow-modaction-row__names';
const ROW_NAME_CLASS = 'kickflow-modaction-row__name';
const MORE_CLASS = 'kickflow-modaction-more';
const DISMISS_CLASS = 'kickflow-modaction-row__dismiss';
const ANCHOR_SELECTOR = '#chatroom-messages';

export interface StripAnchorRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

export interface StripViewport {
  readonly width: number;
  readonly height: number;
}

export interface StripPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export function resolveStripPlacement(
  anchorRect: StripAnchorRect,
  stripHeight: number,
  viewport: StripViewport,
): StripPlacement {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const anchorWidth = Math.max(0, Number.isFinite(anchorRect.width)
    ? anchorRect.width
    : anchorRect.right - anchorRect.left);
  const minimumWidth = Math.min(MOD_ACTION_STRIP_MIN_WIDTH_PX, viewportWidth);
  const width = anchorWidth < MOD_ACTION_STRIP_MIN_WIDTH_PX
    ? anchorWidth
    : Math.max(minimumWidth, Math.min(anchorWidth, viewportWidth));
  const maxLeft = Math.max(0, viewportWidth - width);
  const proposedLeft = anchorRect.right - width;
  const left = Math.min(Math.max(proposedLeft, 0), maxLeft);
  const height = Math.max(0, stripHeight);
  const maxTop = Math.max(0, viewportHeight - height);
  const proposedTop = anchorRect.bottom - height - MOD_ACTION_STRIP_INSET_PX;
  const top = Math.min(Math.max(proposedTop, 0), maxTop);
  return { left, top, width };
}

export interface ModActionStripOptions {
  onJump: (messageId: string) => void;
  onOpenPanel: () => void;
}

interface NoticeRowState {
  notice: ModActionNotice;
  element: HTMLDivElement;
  text: HTMLSpanElement;
  timerId: number | null;
  engaged: boolean;
}

const SINGLE_KEYS: Record<ModActionKind, MessageKey> = {
  ban: 'modaction.ban.single',
  timeout: 'modaction.timeout.single',
  delete: 'modaction.delete.single',
};

const BULK_KEYS: Record<ModActionKind, MessageKey> = {
  ban: 'modaction.ban.bulk',
  timeout: 'modaction.timeout.bulk',
  delete: 'modaction.delete.bulk',
};

function createTextNode(value: string): Text {
  return document.createTextNode(value);
}

export class ModActionStrip {
  private readonly root: HTMLDivElement;
  private readonly rows = new Map<string, NoticeRowState>();
  private anchor: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frameHandle: number | null = null;
  private disposed = false;

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly options: ModActionStripOptions,
  ) {
    this.root = document.createElement('div');
    this.root.className = STRIP_CLASS;
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.display = 'none';
    this.root.style.position = 'fixed';
    this.root.style.setProperty('--kickflow-modaction-animation-duration', `${MOD_ACTION_STRIP_ANIMATION_MS}ms`);
    document.body.appendChild(this.root);

    lifecycle.addEventListener(window, 'resize', this.reposition);
    lifecycle.addEventListener(window, 'scroll', this.reposition, { capture: true, passive: true });
    lifecycle.add(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
    lifecycle.add(() => this.dispose());

    // The anchor lives deep inside Kick's React tree, so noticing it appear or disappear across an
    // SPA navigation needs a subtree observer. That fires on EVERY chat message and every React
    // render, so the callback must not force layout: it does one querySelector and returns unless
    // the anchor identity actually changed or a notice is on screen. Real work is coalesced to one
    // frame, so a burst of mutations costs one reflow instead of hundreds.
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(this.onDomMutated);
      observer.observe(document.body, { childList: true, subtree: true });
      lifecycle.add(() => observer.disconnect());
    }
    lifecycle.add(() => this.cancelScheduledReposition());
    this.reposition();
  }

  get element(): HTMLDivElement {
    return this.root;
  }

  addNotice(notice: ModActionNotice): void {
    if (this.disposed) return;
    if (this.rows.has(notice.id)) {
      this.updateNotice(notice);
      return;
    }
    while (this.rows.size >= MOD_ACTION_MAX_VISIBLE) {
      const oldestId = this.rows.keys().next().value;
      if (oldestId === undefined) break;
      this.removeRow(oldestId);
    }

    const element = document.createElement('div');
    element.className = ROW_CLASS;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    const icon = document.createElement('span');
    icon.className = `${ROW_CLASS}__icon`;
    icon.textContent = '🛡';
    const text = document.createElement('span');
    text.className = ROW_TEXT_CLASS;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = DISMISS_CLASS;
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', t('modaction.dismiss'));
    element.append(icon, text, dismiss);

    const state: NoticeRowState = { notice, element, text, timerId: null, engaged: false };
    this.rows.set(notice.id, state);
    this.lifecycle.addEventListener(element, 'click', () => this.activate(state));
    this.lifecycle.addEventListener(element, 'keydown', (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
      keyboardEvent.preventDefault();
      this.activate(state);
    });
    this.lifecycle.addEventListener(element, 'mouseenter', () => this.engage(state));
    this.lifecycle.addEventListener(element, 'focus', () => this.engage(state));
    this.lifecycle.addEventListener(dismiss, 'click', (event: Event) => {
      event.stopPropagation();
      this.removeRow(notice.id);
    });
    this.lifecycle.addEventListener(dismiss, 'keydown', (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
      event.stopPropagation();
      keyboardEvent.preventDefault();
      this.removeRow(notice.id);
    });

    this.root.appendChild(element);
    this.renderNotice(state);
    this.scheduleExpiry(state);
    this.reposition();
  }

  updateNotice(notice: ModActionNotice): void {
    if (this.disposed) return;
    const state = this.rows.get(notice.id);
    if (!state) {
      this.addNotice(notice);
      return;
    }
    state.notice = notice;
    this.renderNotice(state);
    if (!state.engaged) this.scheduleExpiry(state);
    this.reposition();
  }

  clear(): void {
    for (const id of Array.from(this.rows.keys())) this.removeRow(id);
    this.root.style.display = 'none';
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelScheduledReposition();
    this.disposed = true;
    this.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root.remove();
  }

  /** Cheap by construction — it may run thousands of times a minute. Never forces layout. */
  private readonly onDomMutated = (): void => {
    if (this.disposed) return;
    const anchor = document.querySelector<HTMLElement>(ANCHOR_SELECTOR);
    if (anchor === this.anchor && this.rows.size === 0) return;
    this.scheduleReposition();
  };

  private scheduleReposition(): void {
    if (this.disposed || this.frameHandle !== null) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      this.reposition();
      return;
    }
    this.frameHandle = window.requestAnimationFrame(() => {
      this.frameHandle = null;
      this.reposition();
    });
  }

  private cancelScheduledReposition(): void {
    if (this.frameHandle === null) return;
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly reposition = (): void => {
    if (this.disposed) return;
    const anchor = document.querySelector<HTMLElement>(ANCHOR_SELECTOR);
    this.observeAnchor(anchor);
    if (this.rows.size === 0 || !anchor) {
      this.root.style.display = 'none';
      return;
    }

    this.root.style.display = '';
    const placement = resolveStripPlacement(
      anchor.getBoundingClientRect(),
      this.root.getBoundingClientRect().height,
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.root.style.left = `${placement.left}px`;
    this.root.style.top = `${placement.top}px`;
    this.root.style.width = `${placement.width}px`;
  };

  private observeAnchor(anchor: HTMLElement | null): void {
    if (anchor === this.anchor) return;
    this.anchor = anchor;
    this.resizeObserver?.disconnect();
    if (!anchor || typeof ResizeObserver !== 'function') return;
    if (!this.resizeObserver) this.resizeObserver = new ResizeObserver(this.reposition);
    this.resizeObserver.observe(anchor);
  }

  private renderNotice(state: NoticeRowState): void {
    const notice = state.notice;
    state.text.replaceChildren();
    const headline = document.createElement('span');
    headline.className = ROW_HEADLINE_CLASS;
    const victim = notice.victims[0] ?? '';
    headline.textContent = t(notice.count === 1 ? SINGLE_KEYS[notice.kind] : BULK_KEYS[notice.kind], {
      name: victim,
      n: notice.count,
    });
    state.text.appendChild(headline);

    if (notice.kind === 'timeout' && notice.durationMin !== null) {
      state.text.appendChild(createTextNode(` (${t('duration.minutes_short', { n: notice.durationMin })})`));
    }

    // Names come before the moderator clause. A bulk headline ends in a colon ("12 bans:"), so
    // inserting "by X" between it and the list reads as a broken sentence.
    if (notice.count > 1) this.appendVictimNames(state);

    const moderator = notice.moderator?.trim();
    if (moderator) state.text.appendChild(createTextNode(t('modaction.by', { name: moderator })));

    state.element.setAttribute('aria-label', state.text.textContent ?? '');
  }

  private appendVictimNames(state: NoticeRowState): void {
    const notice = state.notice;
    const names = document.createElement('span');
    names.className = ROW_NAMES_CLASS;
    const shown = notice.victims.slice(0, MOD_ACTION_NAMES_SHOWN);
    const hiddenKnown = notice.victims.slice(shown.length);
    const unknownRemainder = Math.max(0, notice.count - notice.victims.length);

    shown.forEach((name, index) => {
      if (index > 0) names.appendChild(createTextNode(', '));
      names.appendChild(this.createVictimName(name));
    });

    if (hiddenKnown.length > 0) {
      if (shown.length > 0) names.appendChild(createTextNode(', '));
      const more = document.createElement('span');
      more.className = MORE_CLASS;
      more.setAttribute('role', 'button');
      more.setAttribute('tabindex', '0');
      more.textContent = t('modaction.more', { n: notice.count - shown.length });
      const expand = (event: Event): void => {
        event.stopPropagation();
        this.engage(state);
        for (const name of hiddenKnown) {
          names.insertBefore(createTextNode(', '), more);
          names.insertBefore(this.createVictimName(name), more);
        }
        if (unknownRemainder > 0) {
          more.removeAttribute('role');
          more.removeAttribute('tabindex');
          more.textContent = t('modaction.more', { n: unknownRemainder });
        } else {
          more.remove();
        }
      };
      this.lifecycle.addEventListener(more, 'click', expand);
      this.lifecycle.addEventListener(more, 'keydown', (event: Event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        keyboardEvent.preventDefault();
        expand(event);
      });
      names.appendChild(more);
    } else if (unknownRemainder > 0) {
      if (shown.length > 0) names.appendChild(createTextNode(', '));
      names.appendChild(createTextNode(t('modaction.more', { n: unknownRemainder })));
    }

    if (names.childNodes.length > 0) {
      state.text.appendChild(createTextNode(' '));
      state.text.appendChild(names);
    }
  }

  private createVictimName(name: string): HTMLSpanElement {
    const element = document.createElement('span');
    element.className = ROW_NAME_CLASS;
    element.textContent = name;
    return element;
  }

  private activate(state: NoticeRowState): void {
    this.engage(state);
    if (state.notice.messageId !== null) {
      this.options.onJump(state.notice.messageId);
    } else {
      this.options.onOpenPanel();
    }
  }

  private engage(state: NoticeRowState): void {
    state.engaged = true;
    this.cancelExpiry(state);
  }

  private scheduleExpiry(state: NoticeRowState): void {
    this.cancelExpiry(state);
    if (state.engaged) return;
    // No per-timer lifecycle registration: a 40-ban burst reschedules this on every update, so one
    // teardown closure per call would grow without bound. Disposal already runs clear() -> removeRow()
    // -> cancelExpiry() for every live row, which covers the same ground once.
    state.timerId = window.setTimeout(() => {
      if (this.rows.get(state.notice.id) !== state) return;
      this.removeRow(state.notice.id);
    }, MOD_ACTION_NOTICE_TTL_MS);
  }

  private cancelExpiry(state: NoticeRowState): void {
    if (state.timerId === null) return;
    window.clearTimeout(state.timerId);
    state.timerId = null;
  }

  private removeRow(id: string): void {
    const state = this.rows.get(id);
    if (!state) return;
    this.cancelExpiry(state);
    state.element.remove();
    this.rows.delete(id);
    if (this.rows.size === 0) this.root.style.display = 'none';
  }
}
