import { afterEach, describe, expect, it } from 'vitest';
import { configureUserMessageArchive } from '../../src/content/chat/archive-session';
import { buildMessageSearchResults, getMessageSearchModel } from '../../src/content/chat/message-search';
import { UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { chatMessage } from '../helpers/chat-message';
import { setLang } from '../../src/content/shared/i18n';

function archiveWith(...contents: string[]): UserMessageArchive {
  const archive = new UserMessageArchive();
  contents.forEach((content, index) => archive.add(chatMessage(`m${index}`, { userId: index + 1, content })));
  return archive;
}

describe('message search', () => {
  afterEach(() => {
    configureUserMessageArchive(null);
    setLang('tr');
  });

  it('separates "no archive on this page" from "no match"', () => {
    configureUserMessageArchive(null);
    expect(getMessageSearchModel('anything').status).toBe('unavailable');

    configureUserMessageArchive(archiveWith('merhaba'));
    expect(getMessageSearchModel('   ').status).toBe('idle');
    expect(getMessageSearchModel('yok').status).toBe('results');
    expect(getMessageSearchModel('yok').matches).toEqual([]);
  });

  it('renders one row per match with the sender name, and a count', () => {
    configureUserMessageArchive(archiveWith('birinci link', 'ikinci link'));
    const root = buildMessageSearchResults(getMessageSearchModel('link'));

    const rows = root.querySelectorAll('.kickflow-user-messages__row');
    expect(rows).toHaveLength(2);
    // Newest first, and each row names its sender because results cross users.
    expect(rows[0]?.querySelector('.kickflow-user-messages__name')?.textContent).toBe('user2: ');
    expect(rows[0]?.textContent).toContain('ikinci link');
    expect(root.querySelector('.kickflow-search__summary')?.textContent).toBe('2 sonuç');
  });

  it('says how many matches were left off when the cap bites', () => {
    const archive = new UserMessageArchive();
    for (let index = 0; index < 120; index += 1) {
      archive.add(chatMessage(`m${index}`, { content: 'aynı kelime' }));
    }
    configureUserMessageArchive(archive);

    const model = getMessageSearchModel('aynı');
    expect(model.total).toBe(120);
    expect(model.matches).toHaveLength(100);
    expect(buildMessageSearchResults(model).querySelector('.kickflow-search__summary')?.textContent)
      .toContain('120');
  });

  it('warns that evicted messages are not searchable', () => {
    const archive = new UserMessageArchive({ maxMessages: 1 });
    archive.add(chatMessage('old', { content: 'kaybolan' }));
    archive.add(chatMessage('new', { content: 'kaybolan' }));
    configureUserMessageArchive(archive);

    const notes = buildMessageSearchResults(getMessageSearchModel('kaybolan'))
      .querySelectorAll('.kickflow-search__note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe('Daha eski mesajlar arşivden düşmüştü.');
  });

  it('shows the hint before a query and the empty state after a fruitless one', () => {
    configureUserMessageArchive(archiveWith('merhaba'));

    expect(buildMessageSearchResults(getMessageSearchModel('')).querySelector('.kickflow-search__note')?.textContent)
      .toContain('Sayfa açıldığından beri');
    expect(buildMessageSearchResults(getMessageSearchModel('zzz')).querySelector('.kickflow-search__note')?.textContent)
      .toBe('Eşleşen mesaj yok.');
  });
});
