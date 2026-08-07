/**
 * Search-oriented text fold: Turkish letter overrides first, then a generic NFD strip.
 *
 * The fold is 1:1 on code points so a later highlight pass can map folded match offsets
 * back onto the original string. Characters whose folded form is not exactly one code
 * point are left unchanged.
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
  // Hard invariant: folded form must be exactly one code point, else keep the original so
  // offsets stay aligned with the source string.
  const foldedCodePoints = [...stripped];
  const folded = foldedCodePoints.length === 1 ? foldedCodePoints[0]! : char;
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
