/**
 * Shared chat content tokenizer. message-view and mention-highlight both consume this so
 * @username detection never drifts from the safe-render path.
 */

// 7TV's own tokenizer regex (`/( )|(\[emote:\d{1,10}:.{1,30}\])/`) inspired the emote
// token shape; extended with url/mention alternatives so one pass over `content` handles
// all three safely via named capture groups instead of string concatenation.
//
// The name excludes `]` on purpose. 7TV's permissive `.` is greedy, so two adjacent
// short-named emotes let one match run straight past the first closing bracket and swallow
// both tokens: `[emote:39261:KEKW][emote:39261:KEKW]` parsed as a SINGLE emote named
// `KEKW][emote:39261:KEKW]`. Long names stayed correct only because they overran the 30-char
// cap in the old grammar. An emote name can never contain `]` — the bracket
// is what terminates the token.
// Local parser safety limit, not a claimed Kick protocol maximum.
// The observed collectible name has 37 characters. Brackets and line breaks
// remain token boundaries; rendering continues to use DOM/text APIs.
const EMOTE_NAME_PATTERN = '[^\\[\\]\\r\\n]{1,128}';

// One source for the emote grammar. The tokenizer and the plain-text reductions below used to
// carry their own copy of it, and a copy is exactly how the greedy-name bug reached three files.
export const CONTENT_TOKEN_RE = new RegExp(
  `\\[emote:(?<emoteId>\\d{1,10}):(?<emoteName>${EMOTE_NAME_PATTERN})\\]`
    + '|(?<url>https?:\\/\\/[^\\s]+)'
    + '|(?<mention>@[a-zA-Z0-9_]{1,25})',
  'g',
);

/** Emote tokens alone, name captured. For plain-text reductions — a tooltip title, a search
 * haystack — that need no url/mention alternation. */
export const EMOTE_TOKEN_RE = new RegExp(
  `\\[emote:\\d{1,10}:(${EMOTE_NAME_PATTERN})\\]`,
  'g',
);

/** Usernames from `@slug` tokens in content (same tokenizer as the mention renderer). */
export function extractMentionUsernames(content: string): string[] {
  const names: string[] = [];
  CONTENT_TOKEN_RE.lastIndex = 0;
  for (const match of content.matchAll(CONTENT_TOKEN_RE)) {
    const mention = match.groups?.mention;
    if (mention) names.push(mention.slice(1));
  }
  return names;
}
