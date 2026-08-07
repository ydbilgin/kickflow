import { describe, expect, it } from 'vitest';
import { highlightSearchQuery } from '../../src/content/chat/search-highlight';
import { buildArchivedMessageRow } from '../../src/content/chat/user-message-list';
import { parseSearchQuery } from '../../src/content/shared/text-fold';
import { archivedMessage } from '../helpers/chat-message';

function textContainer(text: string): HTMLDivElement {
  const container = document.createElement('div');
  container.textContent = text;
  return container;
}

describe('highlightSearchQuery', () => {
  it('preserves the original Turkish spelling inside a folded match', () => {
    const container = textContainer('İzmir güzel');

    highlightSearchQuery(container, parseSearchQuery('izmir'));

    const marks = container.querySelectorAll('mark.kickflow-search__hit');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('İzmir');
    expect(marks[0]?.textContent).toHaveLength(5);
  });

  it('keeps supplementary-character code-unit offsets aligned before a match', () => {
    const emojiContainer = textContainer('😀 İzmir');
    highlightSearchQuery(emojiContainer, parseSearchQuery('izmir'));
    expect(emojiContainer.querySelector('mark')?.textContent).toBe('İzmir');
    expect(emojiContainer.textContent).toBe('😀 İzmir');

    // U+2F800 canonically normalizes to one BMP code unit. The fold must retain the original
    // two-unit character or the match offset moves left and wraps the preceding space.
    const shrinkingFoldContainer = textContainer('\u{2F800} İzmir');
    highlightSearchQuery(shrinkingFoldContainer, parseSearchQuery('izmir'));
    expect(shrinkingFoldContainer.querySelector('mark')?.textContent).toBe('İzmir');
    expect(shrinkingFoldContainer.textContent).toBe('\u{2F800} İzmir');
  });

  it('marks every term and merges overlapping or adjacent ranges', () => {
    const separate = textContainer('one two');
    highlightSearchQuery(separate, parseSearchQuery('one two'));
    expect(Array.from(separate.querySelectorAll('mark'), (mark) => mark.textContent))
      .toEqual(['one', 'two']);

    const overlapping = textContainer('ahmet');
    highlightSearchQuery(overlapping, parseSearchQuery('ah ahm'));
    expect(overlapping.querySelectorAll('mark')).toHaveLength(1);
    expect(overlapping.querySelector('mark')?.textContent).toBe('ahm');
    expect(overlapping.querySelector('mark mark')).toBeNull();

    const adjacent = textContainer('ahmet');
    highlightSearchQuery(adjacent, parseSearchQuery('ah met'));
    expect(adjacent.querySelectorAll('mark')).toHaveLength(1);
    expect(adjacent.querySelector('mark')?.textContent).toBe('ahmet');
  });

  it('highlights a matching sender name', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('sender', { username: 'Ahmet', text: 'hello' }),
      { clockLabel: '12:34', showUsername: true },
    );

    highlightSearchQuery(row, parseSearchQuery('ahmet'));

    expect(row.querySelector('.kickflow-user-messages__name mark')?.textContent).toBe('Ahmet');
  });

  it('never highlights the clock column', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('clock', { username: 'Ahmet', text: 'hello' }),
      { clockLabel: '12:34', showUsername: true },
    );

    highlightSearchQuery(row, parseSearchQuery('12'));

    expect(row.querySelector('.kickflow-user-messages__time')?.textContent).toBe('12:34');
    expect(row.querySelector('.kickflow-user-messages__time mark')).toBeNull();
    expect(row.querySelector('mark')).toBeNull();
  });

  it('preserves emote and link elements while highlighting their surrounding text', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('emote', {
        text: 'İzmir [emote:123:name] güzel',
        replyTo: { user: 'Quoted', text: 'İzmir context', messageId: 'source' },
      }),
      { clockLabel: '12:34' },
    );
    const image = row.querySelector('img');
    const reply = row.querySelector('.kickflow-user-messages__reply');
    expect(image).not.toBeNull();
    expect(reply).not.toBeNull();

    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'İzmir link';
    row.appendChild(link);

    highlightSearchQuery(row, parseSearchQuery('izmir güzel link'));

    expect(row.querySelector('img')).toBe(image);
    expect(row.querySelector('a')).toBe(link);
    expect(row.querySelector('.kickflow-user-messages__reply')).toBe(reply);
    expect(Array.from(row.querySelectorAll('mark'), (mark) => mark.textContent))
      .toEqual(['İzmir', 'İzmir', 'güzel', 'İzmir', 'link']);
  });

  it('does not touch a text node when no term matches', () => {
    const container = textContainer('nothing here');
    const childNodeCount = container.childNodes.length;
    const textNode = container.firstChild;
    const innerHTML = container.innerHTML;

    highlightSearchQuery(container, parseSearchQuery('missing'));

    expect(container.childNodes).toHaveLength(childNodeCount);
    expect(container.firstChild).toBe(textNode);
    expect(container.innerHTML).toBe(innerHTML);
  });

  it('is idempotent when called twice with the same terms', () => {
    const container = textContainer('İzmir güzel İzmir');
    const query = parseSearchQuery('izmir');
    highlightSearchQuery(container, query);
    const once = container.innerHTML;

    highlightSearchQuery(container, query);

    expect(container.innerHTML).toBe(once);
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(container.querySelector('mark mark')).toBeNull();
  });

  it('never highlights an excluded term', () => {
    const container = textContainer('spam clean');

    highlightSearchQuery(container, parseSearchQuery('-spam clean'));

    expect(Array.from(container.querySelectorAll('mark'), (mark) => mark.textContent)).toEqual(['clean']);
  });

  it('highlights a sender filter only in the sender name', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('sender-filter', { username: 'Ahmet', text: 'from:ahmet ahmet literal body' }),
      { clockLabel: '12:34', showUsername: true },
    );

    highlightSearchQuery(row, parseSearchQuery('from:ahmet'));

    expect(row.querySelector('.kickflow-user-messages__name mark')?.textContent).toBe('Ahmet');
    expect(row.querySelector('.kickflow-user-messages__text > mark')).toBeNull();
    expect(Array.from(row.querySelectorAll('mark'), (mark) => mark.textContent)).toEqual(['Ahmet']);
  });

  it('highlights a quoted phrase as one span including its spaces', () => {
    const container = textContainer('before iyi geceler after');

    highlightSearchQuery(container, parseSearchQuery('"iyi geceler"'));

    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')?.textContent).toBe('iyi geceler');
  });
});
