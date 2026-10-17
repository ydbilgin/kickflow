import { describe, expect, it } from 'vitest';
import { CONTENT_TOKEN_RE, EMOTE_TOKEN_RE, extractMentionUsernames } from '../../src/content/chat/content-tokens';
import { buildMessageElement } from '../../src/content/chat/message-view';
import { chatMessage } from '../helpers/chat-message';

const name = 'collectiblescatsittingverycomfortable';
const token = `[emote:5747951:${name}]`;
function emotes(text: string): RegExpMatchArray[] {
  CONTENT_TOKEN_RE.lastIndex = 0;
  return [...text.matchAll(CONTENT_TOKEN_RE)].filter((m) => m.groups?.emoteId);
}

describe('long emote names use the shared safe tokenizer', () => {
  it('recognizes the exact owner example in rendering and plain-text reduction', () => {
    expect(name).toHaveLength(37);
    expect(emotes(token)[0]?.groups).toMatchObject({ emoteId: '5747951', emoteName: name });
    expect(token.replace(EMOTE_TOKEN_RE, '$1')).toBe(name);
    const row = buildMessageElement(chatMessage('long-emote', { content: token }));
    const image = row.querySelector<HTMLImageElement>('img[src="https://files.kick.com/emotes/5747951/fullsize"]');
    expect(image).not.toBeNull();
    expect(row.textContent).not.toContain('[emote:5747951:');
  });

  it('keeps adjacent emotes separate and does not leak a mention out of a valid name', () => {
    expect(emotes(token + '[emote:39261:KEKW]').map((m) => m.groups?.emoteId)).toEqual(['5747951', '39261']);
    expect(extractMentionUsernames('[emote:1:collectible@inside] @outside')).toEqual(['outside']);
  });

  it.each([1, 30, 31, 37, 128])('accepts a %i-character name', (length) => {
    expect(emotes(`[emote:1:${'a'.repeat(length)}]`)).toHaveLength(1);
  });

  it.each(['', 'a'.repeat(129), 'bad[name', 'bad\nname', 'bad\rname'])('leaves a malformed or over-budget name literal: %j', (value) => {
    expect(emotes(`[emote:1:${value}]`)).toHaveLength(0);
  });

  it('does not turn emote names into HTML', () => {
    const hostile = '[emote:1:<svg/onload=alert(1)>]';
    const row = buildMessageElement(chatMessage('hostile-name', { content: hostile }));
    expect(row.querySelector('svg[onload], script, [onclick]')).toBeNull();
  });
});
