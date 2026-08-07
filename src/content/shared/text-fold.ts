/**
 * Search-oriented text fold: Turkish letter overrides first, then a generic NFD strip.
 *
 * The fold is 1:1 on UTF-16 code units so JavaScript string offsets from indexOf, slice,
 * and DOM Range map back onto the original string. Characters whose folded form changes
 * code-unit length are left unchanged, even when both forms are one code point.
 */

/** Turkish letters that must be rewritten before Unicode default lowercasing — otherwise
 * `İ`.toLowerCase() yields `i` + U+0307 and `I`.toLowerCase() yields dotted `i`, both of
 * which break ASCII-style queries like `izmir` / `isik`. */
const TURKISH_FOLD: Readonly<Record<string, string>> = Object.freeze({
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
});

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/** Generic-path memo: NFD + mark strip is O(char) and the distinct set on a chat page is
 * small, so one entry per code point lasts the page lifetime. */
const genericFoldByCodePoint = new Map<number, string>();

function foldGenericCodePoint(char: string, codePoint: number): string {
  const cached = genericFoldByCodePoint.get(codePoint);
  if (cached !== undefined) return cached;

  const stripped = char.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
  // Hard invariant: folded and original forms must occupy the same UTF-16 code units so
  // JavaScript and DOM offsets stay aligned with the source string.
  const folded = stripped.length === char.length ? stripped : char;
  genericFoldByCodePoint.set(codePoint, folded);
  return folded;
}

export function foldSearchText(value: string): string {
  let result = '';
  for (const char of value) {
    const turkish = TURKISH_FOLD[char];
    if (turkish !== undefined) {
      result += turkish;
      continue;
    }
    result += foldGenericCodePoint(char, char.codePointAt(0)!);
  }
  return result;
}

export interface ParsedSearchQuery {
  readonly requiredTerms: readonly string[];
  readonly excludedTerms: readonly string[];
  readonly senderFilters: readonly string[];
}

interface ParsedToken {
  readonly value: string;
  readonly nextIndex: number;
}

const SENDER_FILTER_PREFIX = 'from:';

/** The canonical search-query parser shared by matching and result highlighting. */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const requiredTerms: string[] = [];
  const excludedTerms: string[] = [];
  const senderFilters: string[] = [];
  let index = 0;

  while (index < query.length) {
    while (index < query.length && isWhitespace(query[index]!)) index += 1;
    if (index >= query.length) break;

    const negated = query[index] === '-'
      && index + 1 < query.length
      && !isWhitespace(query[index + 1]!);
    if (negated) index += 1;

    const hasSenderPrefix = !negated
      && foldSearchText(query.slice(index, index + SENDER_FILTER_PREFIX.length)) === SENDER_FILTER_PREFIX
      && index + SENDER_FILTER_PREFIX.length < query.length
      && !isWhitespace(query[index + SENDER_FILTER_PREFIX.length]!);
    if (hasSenderPrefix) index += SENDER_FILTER_PREFIX.length;

    const token = readToken(query, index);
    index = token.nextIndex;
    const foldedValue = foldSearchText(token.value);
    if (foldedValue.length === 0) continue;

    if (hasSenderPrefix) {
      senderFilters.push(foldedValue);
    } else if (negated) {
      excludedTerms.push(foldedValue);
    } else {
      // A bare `from:` reaches this path because an empty sender filter is plain text.
      requiredTerms.push(foldedValue);
    }
  }

  return { requiredTerms, excludedTerms, senderFilters };
}

function readToken(query: string, startIndex: number): ParsedToken {
  if (query[startIndex] === '"') {
    const phraseStart = startIndex + 1;
    const closingQuote = query.indexOf('"', phraseStart);
    if (closingQuote < 0) return { value: query.slice(phraseStart), nextIndex: query.length };
    return { value: query.slice(phraseStart, closingQuote), nextIndex: closingQuote + 1 };
  }

  let endIndex = startIndex;
  while (endIndex < query.length && !isWhitespace(query[endIndex]!)) endIndex += 1;
  return { value: query.slice(startIndex, endIndex), nextIndex: endIndex };
}

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}
