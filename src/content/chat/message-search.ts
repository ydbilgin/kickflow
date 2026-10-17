import { getUserMessageArchive } from './archive-session';
import { t } from '../shared/i18n';
import { parseSearchQuery, type ParsedSearchQuery } from '../shared/text-fold';
import { highlightSearchQuery } from './search-highlight';
import { buildArchivedMessageRow, formatClock } from './user-message-list';
import { SEARCH_RESULT_LIMIT, type ArchivedMessage } from './user-message-archive';

export type MessageSearchStatus = 'idle' | 'unavailable' | 'results';

export interface MessageSearchModel {
  readonly status: MessageSearchStatus;
  readonly query: ParsedSearchQuery;
  /** Newest first, already capped at SEARCH_RESULT_LIMIT. */
  readonly matches: readonly ArchivedMessage[];
  /** Matches in the archive, which can exceed `matches.length`. */
  readonly total: number;
  /** True once the archive has evicted anything — older messages are simply not searchable. */
  readonly archiveTruncated: boolean;
  /** True when no strict match existed and results use loose sender-name matching. */
  readonly widened: boolean;
}

/** Reads the session archive for one query. Off a channel, or before any message has arrived,
 * there is no archive at all — that is `unavailable`, which reads differently from "no match". */
export function getMessageSearchModel(query: string): MessageSearchModel {
  const parsedQuery = parseSearchQuery(query);
  const archive = getUserMessageArchive();
  if (!archive) {
    return {
      status: 'unavailable',
      query: parsedQuery,
      matches: [],
      total: 0,
      archiveTruncated: false,
      widened: false,
    };
  }
  if (query.trim() === '') {
    return {
      status: 'idle',
      query: parsedQuery,
      matches: [],
      total: 0,
      archiveTruncated: archive.truncated,
      widened: false,
    };
  }
  const { matches, total, widened } = archive.search(parsedQuery, SEARCH_RESULT_LIMIT);
  return { status: 'results', query: parsedQuery, matches, total, archiveTruncated: archive.truncated, widened };
}

/** Renders the result body. The rows are the same archived-message rows the user card shows, with
 * the sender's name turned on because results cross users. */
export function buildMessageSearchResults(model: MessageSearchModel): HTMLElement {
  const root = document.createElement('div');
  root.className = 'kickflow-search__results';

  if (model.status === 'unavailable') {
    root.appendChild(note(t('search.unavailable')));
    return root;
  }
  if (model.status === 'idle') {
    root.appendChild(note(t('search.hint')));
    return root;
  }
  if (model.matches.length === 0) {
    root.appendChild(note(t('search.empty')));
    return root;
  }

  if (model.widened) root.appendChild(note(t('search.widened')));

  const summary = document.createElement('div');
  summary.className = 'kickflow-search__summary';
  summary.textContent = model.total > model.matches.length
    ? t('search.count_capped', { n: model.total, shown: model.matches.length })
    : t('search.count', { n: model.total });
  root.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'kickflow-user-messages__body kickflow-search__body';
  for (const message of model.matches) {
    const row = buildArchivedMessageRow(message, {
      clockLabel: formatClock(message.at),
      showUsername: true,
    });
    highlightSearchQuery(row, model.query);
    body.appendChild(row);
  }
  root.appendChild(body);

  if (model.archiveTruncated) root.appendChild(note(t('search.truncated')));
  return root;
}

function note(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'kickflow-search__note';
  element.textContent = text;
  return element;
}
