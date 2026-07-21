/**
 * Shared chat content tokenizer. message-view and mention-highlight both consume this so
 * @username detection never drifts from the safe-render path.
 */

// 7TV's own tokenizer regex (`/( )|(\[emote:\d{1,10}:.{1,30}\])/`) inspired the emote
// token shape; extended with url/mention alternatives so one pass over `content` handles
// all three safely via named capture groups instead of string concatenation.
export const CONTENT_TOKEN_RE =
  /\[emote:(?<emoteId>\d{1,10}):(?<emoteName>.{1,30})\]|(?<url>https?:\/\/[^\s]+)|(?<mention>@[a-zA-Z0-9_]{1,25})/g;

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
