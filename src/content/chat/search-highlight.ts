import { foldSearchText } from '../shared/text-fold';

const SEARCH_HIT_CLASS = 'kickflow-search__hit';
const EXCLUDED_SUBTREE_SELECTOR = `mark.${SEARCH_HIT_CLASS}, .kickflow-user-messages__time`;

interface MatchRange {
  start: number;
  end: number;
}

/** Highlights folded query terms without changing the rendered elements around their text. */
export function highlightSearchTerms(container: HTMLElement, terms: readonly string[]): void {
  if (terms.length === 0) return;

  const textNodes = collectHighlightableTextNodes(container);
  for (const textNode of textNodes) {
    const ranges = findMergedMatchRanges(foldSearchText(textNode.data), terms);
    if (ranges.length > 0) wrapMatchRanges(textNode, ranges);
  }
}

function collectHighlightableTextNodes(container: HTMLElement): Text[] {
  const nodeFilter = container.ownerDocument.defaultView?.NodeFilter;
  if (!nodeFilter) return [];

  const textNodes: Text[] = [];
  const walker = container.ownerDocument.createTreeWalker(
    container,
    nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT,
    {
      acceptNode(node): number {
        if (node.nodeType === node.ELEMENT_NODE) {
          return (node as Element).matches(EXCLUDED_SUBTREE_SELECTOR)
            ? nodeFilter.FILTER_REJECT
            : nodeFilter.FILTER_SKIP;
        }
        return nodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  return textNodes;
}

function findMergedMatchRanges(foldedText: string, terms: readonly string[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const term of terms) {
    if (term.length === 0) continue;
    let searchFrom = 0;
    while (searchFrom <= foldedText.length - term.length) {
      const start = foldedText.indexOf(term, searchFrom);
      if (start < 0) break;
      ranges.push({ start, end: start + term.length });
      searchFrom = start + 1;
    }
  }
  if (ranges.length === 0) return [];

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: MatchRange[] = [{ ...ranges[0]! }];
  for (let index = 1; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    const previous = merged[merged.length - 1]!;
    if (range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function wrapMatchRanges(textNode: Text, ranges: readonly MatchRange[]): void {
  const source = textNode.data;
  const ownerDocument = textNode.ownerDocument;
  const fragment = ownerDocument.createDocumentFragment();
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor, range.start)));
    }
    const mark = ownerDocument.createElement('mark');
    mark.className = SEARCH_HIT_CLASS;
    mark.textContent = source.slice(range.start, range.end);
    fragment.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < source.length) {
    fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor)));
  }
  textNode.replaceWith(fragment);
}
