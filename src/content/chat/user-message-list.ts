import { appendParsedContent } from './message-view';
import { jumpToMessage } from './message-jump';
import type { ArchivedMessage } from './user-message-archive';
import { t } from '../shared/i18n';

/** Width of the clock gutter. The reply quote is indented by exactly this much so a quote and the
 * message answering it sit on the same left edge instead of stair-stepping. */
export const USER_MESSAGE_TIME_COLUMN_PX = 32;

export interface UserMessageListModel {
  readonly messages: readonly ArchivedMessage[];
  readonly truncated: boolean;
}

/** Builds the collapsible "messages this session" section for the user card. */
export function buildUserMessageList(model: UserMessageListModel): HTMLElement {
  const root = document.createElement('div');
  root.className = 'kickflow-user-messages';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'kickflow-user-messages__toggle';
  toggle.setAttribute('aria-expanded', 'true');

  const title = document.createElement('span');
  title.className = 'kickflow-user-messages__title';
  title.textContent = t('user.messages');

  const count = document.createElement('span');
  count.className = 'kickflow-user-messages__count';
  count.textContent = String(model.messages.length);
  toggle.append(title, count);

  let collapsed = false;
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    root.classList.toggle('kickflow-user-messages--collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  root.appendChild(toggle);

  if (model.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'kickflow-user-messages__empty';
    empty.textContent = t('user.messages_empty');
    root.appendChild(empty);
  } else {
    const body = document.createElement('div');
    body.className = 'kickflow-user-messages__body';
    // A burst of messages inside one minute repeats the same clock value on every row, which reads
    // as noise and buries the one thing the timestamp is for: seeing WHEN the burst happened.
    let previousLabel = '';
    for (const message of model.messages) {
      const label = formatClock(message.at);
      body.appendChild(buildArchivedMessageRow(message, {
        clockLabel: label === previousLabel ? '' : label,
      }));
      previousLabel = label;
    }
    root.appendChild(body);
  }

  if (model.truncated) {
    const note = document.createElement('div');
    note.className = 'kickflow-user-messages__note';
    note.textContent = t('user.messages_truncated');
    root.appendChild(note);
  }
  return root;
}

/** Scrolls the list to the newest row. MUST run after the card is in the document: a detached
 * element reports scrollHeight 0, so doing this inside the builder silently leaves the list
 * pinned to the oldest message — the opposite of what the reader wants to see first. */
export function scrollUserMessageListToLatest(mountedCard: ParentNode): void {
  const body = mountedCard.querySelector<HTMLElement>('.kickflow-user-messages__body');
  if (body) body.scrollTop = body.scrollHeight;
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface ArchivedMessageRowOptions {
  /** Blank keeps the grid column without repeating a clock value inside one minute. */
  readonly clockLabel: string;
  /** Rendered before the text. Omitted by the per-user list, where every row is the same person. */
  readonly showUsername?: boolean;
}

/** The one archived-message row renderer. The user card's per-user list and the dashboard search
 * both use it, so a change to how an archived message reads lands on both surfaces at once. */
export function buildArchivedMessageRow(
  message: ArchivedMessage,
  options: ArchivedMessageRowOptions,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kickflow-user-messages__row';
  row.dataset.messageId = message.id;
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.title = t('user.messages_jump');
  if (message.deleted) row.classList.add('kickflow-user-messages__row--deleted');

  if (message.replyTo) row.appendChild(buildReplyContext(message.replyTo));

  const line = document.createElement('div');
  line.className = 'kickflow-user-messages__line';

  const time = document.createElement('span');
  time.className = 'kickflow-user-messages__time';
  // Rendered even when blank so the text column stays on one grid line down the whole list.
  time.textContent = options.clockLabel;

  const text = document.createElement('span');
  text.className = 'kickflow-user-messages__text';
  if (options.showUsername) {
    const name = document.createElement('span');
    name.className = 'kickflow-user-messages__name';
    name.textContent = `${message.username}: `;
    text.appendChild(name);
  }
  appendParsedContent(text, message.text, { compact: true });
  line.append(time, text);
  row.appendChild(line);

  row.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    jumpToRow(row);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    jumpToRow(row);
  });
  return row;
}

function buildReplyContext(replyTo: NonNullable<ArchivedMessage['replyTo']>): HTMLElement {
  const quote = document.createElement('div');
  quote.className = 'kickflow-user-messages__reply';

  const icon = document.createElement('span');
  icon.className = 'kickflow-user-messages__replyIcon';
  icon.textContent = '↩';
  icon.setAttribute('aria-hidden', 'true');

  const user = document.createElement('span');
  user.className = 'kickflow-user-messages__replyUser';
  user.textContent = replyTo.user;

  const text = document.createElement('span');
  text.className = 'kickflow-user-messages__replyText';
  // Compact parse, same rule as the chat reply preview: emotes render, links stay inert text so the
  // quote never becomes a second focusable target inside an already-interactive row.
  appendParsedContent(text, replyTo.text, { compact: true });

  quote.append(icon, user, text);
  return quote;
}

function jumpToRow(row: HTMLElement): void {
  const messageId = row.dataset.messageId;
  if (messageId) jumpToMessage(messageId, row);
}
