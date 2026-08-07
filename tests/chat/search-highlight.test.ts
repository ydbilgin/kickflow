import { describe, expect, it } from 'vitest';
import { highlightSearchTerms } from '../../src/content/chat/search-highlight';
import { buildArchivedMessageRow } from '../../src/content/chat/user-message-list';
import { parseSearchTerms } from '../../src/content/shared/text-fold';
import { archivedMessage } from '../helpers/chat-message';

function textContainer(text: string): HTMLDivElement {
  const container = document.createElement('div');
  container.textContent = text;
  return container;
}

describe('highlightSearchTerms', () => {
  it('preserves the original Turkish spelling inside a folded match', () => {
    const container = textContainer('İzmir güzel');

    highlightSearchTerms(container, parseSearchTerms('izmir'));

    const marks = container.querySelectorAll('mark.kickflow-search__hit');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('İzmir');
    expect(marks[0]?.textContent).toHaveLength(5);
  });

  it('keeps supplementary-character code-unit offsets aligned before a match', () => {
    const emojiContainer = textContainer('😀 İzmir');
    highlightSearchTerms(emojiContainer, parseSearchTerms('izmir'));
    expect(emojiContainer.querySelector('mark')?.textContent).toBe('İzmir');
    expect(emojiContainer.textContent).toBe('😀 İzmir');

    // U+2F800 canonically normalizes to one BMP code unit. The fold must retain the original
    // two-unit character or the match offset moves left and wraps the preceding space.
    const shrinkingFoldContainer = textContainer('\u{2F800} İzmir');
    highlightSearchTerms(shrinkingFoldContainer, parseSearchTerms('izmir'));
    expect(shrinkingFoldContainer.querySelector('mark')?.textContent).toBe('İzmir');
    expect(shrinkingFoldContainer.textContent).toBe('\u{2F800} İzmir');
  });

  it('marks every term and merges overlapping or adjacent ranges', () => {
    const separate = textContainer('one two');
    highlightSearchTerms(separate, ['one', 'two']);
    expect(Array.from(separate.querySelectorAll('mark'), (mark) => mark.textContent))
      .toEqual(['one', 'two']);

    const overlapping = textContainer('ahmet');
    highlightSearchTerms(overlapping, ['ah', 'ahm']);
    expect(overlapping.querySelectorAll('mark')).toHaveLength(1);
    expect(overlapping.querySelector('mark')?.textContent).toBe('ahm');
    expect(overlapping.querySelector('mark mark')).toBeNull();

    const adjacent = textContainer('ahmet');
    highlightSearchTerms(adjacent, ['ah', 'met']);
    expect(adjacent.querySelectorAll('mark')).toHaveLength(1);
    expect(adjacent.querySelector('mark')?.textContent).toBe('ahmet');
  });

  it('highlights a matching sender name', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('sender', { username: 'Ahmet', text: 'hello' }),
      { clockLabel: '12:34', showUsername: true },
    );

    highlightSearchTerms(row, parseSearchTerms('ahmet'));

    expect(row.querySelector('.kickflow-user-messages__name mark')?.textContent).toBe('Ahmet');
  });

  it('never highlights the clock column', () => {
    const row = buildArchivedMessageRow(
      archivedMessage('clock', { username: 'Ahmet', text: 'hello' }),
      { clockLabel: '12:34', showUsername: true },
    );

    highlightSearchTerms(row, parseSearchTerms('12'));

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

    highlightSearchTerms(row, parseSearchTerms('izmir güzel link'));

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

    highlightSearchTerms(container, ['missing']);

    expect(container.childNodes).toHaveLength(childNodeCount);
    expect(container.firstChild).toBe(textNode);
    expect(container.innerHTML).toBe(innerHTML);
  });

  it('is idempotent when called twice with the same terms', () => {
    const container = textContainer('İzmir güzel İzmir');
    const terms = parseSearchTerms('izmir');
    highlightSearchTerms(container, terms);
    const once = container.innerHTML;

    highlightSearchTerms(container, terms);

    expect(container.innerHTML).toBe(once);
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(container.querySelector('mark mark')).toBeNull();
  });
});
