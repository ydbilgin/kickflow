import { foldSearchText, type ParsedSearchQuery } from '../shared/text-fold';

const SEARCH_HIT_CLASS = 'kickflow-search__hit';
const EXCLUDED_SUBTREE_SELECTOR = '.kickflow-user-messages__time, .kickflow-user-messages__reply, .kickflow-user-messages__name';
const SENDER_NAME_SELECTOR = '.kickflow-user-messages__name';

interface MatchRange {
  start: number;
  end: number;
}

/** Highlights positive query matches without changing the rendered elements around their text. */
export function highlightSearchQuery(container: HTMLElement, query: ParsedSearchQuery): void {
  highlightTerms(container, query.requiredTerms);

  for (const senderName of container.querySelectorAll<HTMLElement>(SENDER_NAME_SELECTOR)) {
    highlightTerms(senderName, [...query.requiredTerms, ...query.senderFilters]);
  }
}

function highlightTerms(container: HTMLElement, terms: readonly string[]): void {
  if (terms.length === 0) return;

  const nodes = collectHighlightableNodes(container);
  const values = nodes.map((node) => node instanceof Text ? node.data : node.alt);
  const ranges = findMergedMatchRanges(foldSearchText(values.join('')), terms);
  let offset = 0;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const end = offset + values[index]!.length;
    const localRanges = ranges.filter((range) => range.start < end && range.end > offset)
      .map((range) => ({ start: Math.max(0, range.start - offset), end: Math.min(end, range.end) - offset }));
    if (localRanges.length > 0) {
      if (node instanceof Text) {
        if (!node.parentElement?.closest(`mark.${SEARCH_HIT_CLASS}`)) wrapMatchRanges(node, localRanges);
      } else {
        // Color the existing fixed-size emote box; keep its image, tooltip and geometry intact.
        (node.closest('.kickflow-emote-box') ?? node).classList.add(SEARCH_HIT_CLASS);
      }
    }
    offset = end;
  }
}

function collectHighlightableNodes(container: HTMLElement): Array<Text | HTMLImageElement> {
  const nodeFilter = container.ownerDocument.defaultView?.NodeFilter;
  if (!nodeFilter) return [];

  const nodes: Array<Text | HTMLImageElement> = [];
  const walker = container.ownerDocument.createTreeWalker(
    container,
    nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT,
    {
      acceptNode(node): number {
        if (node.nodeType === node.ELEMENT_NODE) {
          const element = node as Element;
          if (element.matches(EXCLUDED_SUBTREE_SELECTOR)) return nodeFilter.FILTER_REJECT;
          return element.matches('img.kickflow-emote') ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_SKIP;
        }
        return nodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text | HTMLImageElement);
    current = walker.nextNode();
  }
  return nodes;
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
