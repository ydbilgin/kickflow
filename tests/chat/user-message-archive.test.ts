import { describe, expect, it } from 'vitest';
import { ARCHIVE_MAX_AGE_MS, ARCHIVE_MAX_MESSAGES, ARCHIVE_PER_USER_CAP, UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { parseSearchQuery } from '../../src/content/shared/text-fold';
import { chatMessage } from '../helpers/chat-message';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const INDEXED_USER_ID = 61;
const INDEXED_USER_NAME = 'Cahitc61';
const OTHER_USER_ID = 62;
const OTHER_USER_NAME = 'other-user';

function searchArchive(archive: UserMessageArchive, query: string, limit?: number) {
  return archive.search(parseSearchQuery(query), limit);
}

function messageFrom(id: string, userId: number, username: string, content: string) {
  const message = chatMessage(id, { userId, content });
  return {
    ...message,
    sender: {
      ...message.sender,
      slug: username.toLowerCase(),
      username,
      displayName: username,
    },
  };
}

function indexedMessage(
  id: string,
  userId = INDEXED_USER_ID,
  name = INDEXED_USER_NAME,
  createdAt = new Date(NOW).toISOString(),
) {
  const base = chatMessage(id, { userId, createdAt });
  return {
    ...base,
    sender: {
      ...base.sender,
      slug: name.toLowerCase(),
      username: name,
    },
  };
}

describe('UserMessageArchive', () => {
  it('resolves sender slugs and usernames case-insensitively', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const base = chatMessage('indexed-name', {
      userId: INDEXED_USER_ID,
      createdAt: new Date(NOW).toISOString(),
    });

    archive.add({
      ...base,
      sender: {
        ...base.sender,
        slug: 'archive-slug',
        username: INDEXED_USER_NAME,
      },
    });

    expect(archive.getUserIdByName('archive-slug')).toBe(INDEXED_USER_ID);
    expect(archive.getUserIdByName('cahitc61')).toBe(INDEXED_USER_ID);
    expect(archive.getUserIdByName(' Cahitc61 ')).toBe(INDEXED_USER_ID);
  });

  it('returns null for an unknown name', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    archive.add(indexedMessage('known-name'));

    expect(archive.getUserIdByName('unknown-name')).toBeNull();
  });

  it('removes the name index when the per-user cap evicts every record', () => {
    const archive = new UserMessageArchive({ perUserCap: 0, now: () => NOW });

    archive.add(indexedMessage('per-user-eviction'));

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('removes the name index when the age cap evicts every record', () => {
    let now = 0;
    const archive = new UserMessageArchive({ maxAgeMs: 5, now: () => now });

    archive.add(indexedMessage('age-eviction', INDEXED_USER_ID, INDEXED_USER_NAME, new Date(0).toISOString()));
    now = 6;
    archive.sweepExpired();

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('removes the name index when the global cap evicts every record', () => {
    const archive = new UserMessageArchive({ maxMessages: 1, now: () => NOW });

    archive.add(indexedMessage('global-eviction'));
    archive.add(indexedMessage('global-eviction-other', OTHER_USER_ID, OTHER_USER_NAME));

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('clears the name index', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    archive.add(indexedMessage('clear-index'));
    archive.clear();

    expect(archive.getUserIdByName(INDEXED_USER_NAME)).toBeNull();
  });

  it('stores a normal message and returns it for its user', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const message = chatMessage('m1', {
      userId: 7,
      content: 'hello',
      createdAt: new Date(NOW).toISOString(),
    });

    expect(archive.add(message)).toBe(true);
    expect(archive.getByUserId(7)).toEqual([{
      id: 'm1', userId: 7, username: 'user7', at: NOW, addedAt: NOW, text: 'hello', replyTo: null, deleted: false,
    }]);
  });

  it('returns false and stores nothing for a system event', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const message = chatMessage('event', {
      systemEvent: { kind: 'subscription', username: 'user1', months: 1 },
    });

    expect(archive.add(message)).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('returns false for a duplicate id and keeps one record', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    expect(archive.add(chatMessage('same', { createdAt: new Date(NOW).toISOString() }))).toBe(true);
    expect(archive.add(chatMessage('same', { content: 'replacement', createdAt: new Date(NOW).toISOString() }))).toBe(false);
    expect(archive.size).toBe(1);
  });

  it('returns false for whitespace-only content', () => {
    const archive = new UserMessageArchive({ now: () => NOW });

    expect(archive.add(chatMessage('blank', { content: ' \n\t ' }))).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('uses parseable createdAt and falls back to the injected clock otherwise', () => {
    const fallbackAt = NOW + 1234;
    const archive = new UserMessageArchive({ now: () => fallbackAt });
    const parsedAt = NOW - 5000;

    archive.add(chatMessage('parsed', { createdAt: new Date(parsedAt).toISOString() }));
    archive.add(chatMessage('fallback', { createdAt: 'not-a-date' }));

    expect(archive.getByUserId(1).map(({ id, at }) => ({ id, at }))).toEqual([
      { id: 'parsed', at: parsedAt },
      { id: 'fallback', at: fallbackAt },
    ]);
  });

  it('returns three interleaved users in arrival order, oldest first', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('u1-a', { userId: 1, createdAt }));
    archive.add(chatMessage('u2-a', { userId: 2, createdAt }));
    archive.add(chatMessage('u1-b', { userId: 1, createdAt }));
    archive.add(chatMessage('u3-a', { userId: 3, createdAt }));
    archive.add(chatMessage('u1-c', { userId: 1, createdAt }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['u1-a', 'u1-b', 'u1-c']);
    expect(archive.getByUserId(2).map(({ id }) => id)).toEqual(['u2-a']);
    expect(archive.getByUserId(3).map(({ id }) => id)).toEqual(['u3-a']);
  });

  it('returns a copy whose array mutation does not affect the next call', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('copy', { createdAt: new Date(NOW).toISOString() }));

    const first = archive.getByUserId(1);
    first.pop();

    expect(archive.getByUserId(1)).toHaveLength(1);
  });

  it('enforces the per-user cap without evicting other users', () => {
    const archive = new UserMessageArchive({
      now: () => NOW,
      perUserCap: 3,
      maxMessages: ARCHIVE_MAX_MESSAGES,
      maxAgeMs: ARCHIVE_MAX_AGE_MS,
    });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('u1-1', { userId: 1, createdAt }));
    archive.add(chatMessage('u2-1', { userId: 2, createdAt }));
    archive.add(chatMessage('u1-2', { userId: 1, createdAt }));
    archive.add(chatMessage('u1-3', { userId: 1, createdAt }));
    archive.add(chatMessage('u1-4', { userId: 1, createdAt }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['u1-2', 'u1-3', 'u1-4']);
    expect(archive.getByUserId(2).map(({ id }) => id)).toEqual(['u2-1']);
  });

  it('enforces the global cap and removes the evicted record from its user index', () => {
    const archive = new UserMessageArchive({ maxMessages: 3, now: () => NOW });
    const createdAt = new Date(NOW).toISOString();
    archive.add(chatMessage('oldest', { userId: 10, createdAt }));
    archive.add(chatMessage('second', { userId: 20, createdAt }));
    archive.add(chatMessage('third', { userId: 30, createdAt }));
    archive.add(chatMessage('newest', { userId: 40, createdAt }));

    expect(archive.size).toBe(3);
    expect(archive.getByUserId(10)).toEqual([]);
    expect(archive.getByUserId(20).map(({ id }) => id)).toEqual(['second']);
    expect(archive.getByUserId(40).map(({ id }) => id)).toEqual(['newest']);
  });

  it('keeps the slot array bounded during sustained global-cap churn', () => {
    const createdAt = new Date(NOW).toISOString();
    const archive = new UserMessageArchive({ maxMessages: 2_000, now: () => NOW });

    for (let index = 0; index < 50_000; index += 1) {
      archive.add(chatMessage(`churn-${index}`, { userId: index % 100, createdAt }));
    }

    expect(archive.size).toBe(2_000);
    expect(archive.internalSlotCount).toBeLessThanOrEqual(2 * 2_000);
  });

  it('preserves per-user order through compaction', () => {
    const archive = new UserMessageArchive({
      maxMessages: 100,
      perUserCap: 100,
      now: () => NOW,
    });

    for (let index = 0; index < 5_000; index += 1) {
      archive.add(chatMessage(`ordered-${index}`, {
        userId: 1,
        createdAt: new Date(NOW + index).toISOString(),
      }));
    }

    expect(archive.getByUserId(1).map(({ id, at }) => ({ id, at }))).toEqual(
      Array.from({ length: 100 }, (_, offset) => {
        const index = 4_900 + offset;
        return { id: `ordered-${index}`, at: NOW + index };
      }),
    );
  });

  it('drains expired records from the head when adding a message', () => {
    let now = 0;
    const archive = new UserMessageArchive({ maxAgeMs: 5, now: () => now });

    // The clock advances between adds: retention counts from when the archive stored each record.
    for (let index = 0; index < 10; index += 1) {
      now = index;
      archive.add(chatMessage(`age-${index}`, { createdAt: new Date(index).toISOString() }));
    }

    now = 10;
    archive.add(chatMessage('age-next', { createdAt: new Date(now).toISOString() }));

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual([
      'age-5', 'age-6', 'age-7', 'age-8', 'age-9', 'age-next',
    ]);
    expect(archive.size).toBe(6);
  });

  it('keeps a message whose own timestamp is old, and ages it out by how long it was held', () => {
    // This is the VOD case: replay archives day-old messages. Expiring them by their original
    // timestamp emptied the archive the instant it filled, so search found nothing on a VOD.
    let now = NOW;
    const archive = new UserMessageArchive({ maxAgeMs: 1_000, now: () => now });

    archive.add(chatMessage('live', { createdAt: new Date(NOW).toISOString() }));
    archive.add(chatMessage('replayed', { createdAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString() }));
    archive.sweepExpired();

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['live', 'replayed']);
    // The reader still sees the message's ORIGINAL time.
    expect(archive.getByUserId(1)[1]?.at).toBe(NOW - 24 * 60 * 60 * 1000);

    now = NOW + 1_001;
    archive.sweepExpired();

    expect(archive.getByUserId(1)).toEqual([]);
  });

  it('leaves no index residue after heavy churn', () => {
    const createdAt = new Date(NOW).toISOString();
    const archive = new UserMessageArchive({
      maxMessages: 3,
      perUserCap: 2,
      now: () => NOW,
    });

    for (let index = 0; index < 100; index += 1) {
      archive.add(chatMessage(`indexed-${index}`, {
        userId: (index % 5) + 1,
        createdAt,
      }));
    }

    const internal = archive as unknown as {
      records: Array<{ id: string } | null>;
      slotById: Map<string, number>;
      recordsById: Map<string, unknown>;
      recordsByUserId: Map<number, unknown[]>;
    };
    for (const userId of [1, 2, 3, 4, 5]) {
      for (const record of archive.getByUserId(userId)) {
        expect(archive.add(chatMessage(record.id, { userId, createdAt }))).toBe(false);
        const slot = internal.slotById.get(record.id);
        expect(slot).toBeDefined();
        expect(internal.records[slot!]?.id).toBe(record.id);
        expect(internal.recordsById.has(record.id)).toBe(true);
      }
    }

    expect(archive.getByUserId(1)).toEqual([]);
    expect(internal.recordsByUserId.has(1)).toBe(false);
    expect(internal.recordsById.has('indexed-0')).toBe(false);
    expect(internal.slotById.has('indexed-0')).toBe(false);
    expect(archive.add(chatMessage('indexed-0', { userId: 1, createdAt }))).toBe(true);
  });

  it('sweeps records older than the age cap while keeping a newer record', () => {
    let now = 500;
    const archive = new UserMessageArchive({ maxAgeMs: 1000, now: () => now });
    archive.add(chatMessage('old', { createdAt: new Date(0).toISOString() }));
    now = 1000;
    archive.add(chatMessage('new', { createdAt: new Date(1000).toISOString() }));
    now = 1501;

    archive.sweepExpired();

    expect(archive.getByUserId(1).map(({ id }) => id)).toEqual(['new']);
  });

  it('tracks truncation and resets it on clear', () => {
    const archive = new UserMessageArchive({ maxMessages: 1, now: () => NOW });
    expect(archive.truncated).toBe(false);
    archive.add(chatMessage('first', { createdAt: new Date(NOW).toISOString() }));
    archive.add(chatMessage('second', { createdAt: new Date(NOW).toISOString() }));

    expect(archive.truncated).toBe(true);
    archive.clear();
    expect(archive.truncated).toBe(false);
    expect(archive.size).toBe(0);
  });

  it('keeps the answered message so a reply is not archived as a non-sequitur', () => {
    const archive = new UserMessageArchive();
    archive.add(chatMessage('m1', {
      content: 'bende de öyleydi',
      replyContext: { replyToUser: 'keperiks', replyToText: 'ben 3 ayda topladım', replyToMessageId: 'src' },
    }));

    expect(archive.getByUserId(1)[0]?.replyTo)
      .toEqual({ user: 'keperiks', text: 'ben 3 ayda topladım', messageId: 'src' });
  });

  it('stores no reply when either half of the quote is missing', () => {
    const archive = new UserMessageArchive();
    archive.add(chatMessage('noUser', { replyContext: { replyToUser: '  ', replyToText: 'orphan quote' } }));
    archive.add(chatMessage('noText', { replyContext: { replyToUser: 'keperiks', replyToText: null } }));

    expect(archive.getByUserId(1).map((record) => record.replyTo)).toEqual([null, null]);
  });

  it('marks a message deleted idempotently and ignores unknown ids', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('delete-me', { createdAt: new Date(NOW).toISOString() }));

    expect(archive.getByUserId(1)[0]?.deleted).toBe(false);
    archive.markDeleted('delete-me');
    archive.markDeleted('delete-me');
    archive.markDeleted('unknown');

    expect(archive.getByUserId(1)[0]?.deleted).toBe(true);
    expect(archive.size).toBe(1);
  });
  it('searches newest first, requires every term, and matches the sender name', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('a', { userId: 4, content: 'kick.com/eray adresine bak' }));
    archive.add(chatMessage('b', { userId: 5, content: 'BAK burada bir LINK var' }));
    archive.add(chatMessage('c', { userId: 6, content: 'alakasiz mesaj' }));

    // Case-insensitive, and both terms must be present in the same message.
    expect(searchArchive(archive, 'bak link').matches.map((record) => record.id)).toEqual(['b']);
    // Newest first: 'b' was archived after 'a'.
    expect(searchArchive(archive, 'bak').matches.map((record) => record.id)).toEqual(['b', 'a']);
    // The sender's name is part of the haystack, so a name alone finds that user's messages.
    expect(searchArchive(archive, 'user6').matches.map((record) => record.id)).toEqual(['c']);
    expect(searchArchive(archive, '   ').matches).toEqual([]);
    expect(searchArchive(archive, '').total).toBe(0);
  });

  it('caps returned rows while still counting every match', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    for (let index = 0; index < 5; index += 1) {
      archive.add(chatMessage(`m${index}`, { content: 'tekrar eden mesaj' }));
    }

    const result = searchArchive(archive, 'tekrar', 2);
    expect(result.matches.map((record) => record.id)).toEqual(['m4', 'm3']);
    expect(result.total).toBe(5);
  });

  it('keeps deleted messages searchable and never returns an evicted one', () => {
    const archive = new UserMessageArchive({ now: () => NOW, maxMessages: 2 });
    archive.add(chatMessage('old', { content: 'aranan kelime' }));
    archive.add(chatMessage('mid', { content: 'aranan kelime' }));
    archive.add(chatMessage('new', { content: 'aranan kelime' }));
    archive.markDeleted('new');

    const result = searchArchive(archive, 'aranan');
    expect(result.matches.map((record) => record.id)).toEqual(['new', 'mid']);
    expect(result.matches[0]?.deleted).toBe(true);
  });

  it('finds Turkish İzmir with an ASCII izmir query', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('izmir-msg', { content: 'İzmir güzel' }));

    expect(searchArchive(archive, 'izmir').matches.map((record) => record.id)).toEqual(['izmir-msg']);
  });

  it('folds ş both ways between query and haystack', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('upper', { content: 'MAŞALLAH' }));
    archive.add(chatMessage('lower', { content: 'masallah' }));

    expect(searchArchive(archive, 'masallah').matches.map((record) => record.id)).toEqual(['lower', 'upper']);
    expect(searchArchive(archive, 'MAŞALLAH').matches.map((record) => record.id)).toEqual(['lower', 'upper']);
  });

  it('folds ışık / IŞIK / isik to the same form', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('isik-upper', { content: 'IŞIK' }));
    archive.add(chatMessage('isik-lower', { content: 'ışık' }));

    expect(searchArchive(archive, 'ışık').matches.map((record) => record.id)).toEqual(['isik-lower', 'isik-upper']);
    expect(searchArchive(archive, 'isik').matches.map((record) => record.id)).toEqual(['isik-lower', 'isik-upper']);
  });

  it('folds güneş and gunes both ways', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('with-diacritic', { content: 'güneş' }));
    archive.add(chatMessage('ascii', { content: 'gunes' }));

    expect(searchArchive(archive, 'gunes').matches.map((record) => record.id)).toEqual(['ascii', 'with-diacritic']);
    expect(searchArchive(archive, 'güneş').matches.map((record) => record.id)).toEqual(['ascii', 'with-diacritic']);
  });

  it('folds the sender name in the haystack', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    const base = chatMessage('seyma-msg', { content: 'merhaba' });
    archive.add({
      ...base,
      sender: {
        ...base.sender,
        slug: 'seyma',
        username: 'Şeyma',
        displayName: 'Şeyma',
      },
    });

    expect(searchArchive(archive, 'seyma').matches.map((record) => record.id)).toEqual(['seyma-msg']);
  });

  it('searches emote tokens by name and ignores the emote wrapper', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('emote-only', { content: '[emote:1234:kekw]' }));

    expect(searchArchive(archive, 'kekw').matches.map((record) => record.id)).toEqual(['emote-only']);
    expect(searchArchive(archive, 'emote').matches).toEqual([]);
    // Raw text stays intact for the renderer.
    expect(archive.getByUserId(1)[0]?.text).toBe('[emote:1234:kekw]');
  });

  // Two adjacent short-named emotes used to be swallowed by one greedy token match, which left
  // the literal word `emote` sitting in the haystack and matched a query for it.
  it('reduces every emote token when a message carries more than one', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('spam', { content: '[emote:39261:KEKW][emote:39261:KEKW]' }));
    archive.add(chatMessage('around', { content: '[emote:1234:kekw] bak [emote:5678:pog]' }));

    expect(searchArchive(archive, 'kekw').matches.map((record) => record.id)).toEqual(['around', 'spam']);
    expect(searchArchive(archive, 'pog').matches.map((record) => record.id)).toEqual(['around']);
    expect(searchArchive(archive, 'bak').matches.map((record) => record.id)).toEqual(['around']);
    expect(searchArchive(archive, 'emote').matches).toEqual([]);
  });

  it('keeps plain ASCII search behaviour unchanged', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('ascii-msg', { content: 'Hello World' }));

    expect(searchArchive(archive, 'hello').matches.map((record) => record.id)).toEqual(['ascii-msg']);
    expect(searchArchive(archive, 'HELLO WORLD').matches.map((record) => record.id)).toEqual(['ascii-msg']);
    expect(searchArchive(archive, 'missing').matches).toEqual([]);
  });

  it('keeps sender filters isolated from body text while combining them with required terms', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('ahmet-link', 1, 'Ahmet', 'a link is here'));
    archive.add(messageFrom('body-name', 2, 'Other', 'ahmet link and kekw are here'));

    expect(searchArchive(archive, 'from:ahmet link').matches.map((record) => record.id))
      .toEqual(['ahmet-link']);
    expect(searchArchive(archive, 'from:kekw').matches).toEqual([]);
  });

  it('folds sender filters and treats multiple filters as a union', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('seyma', 1, 'Şeyma', 'first'));
    archive.add(messageFrom('ahmet', 2, 'Ahmet', 'second'));
    archive.add(messageFrom('other', 3, 'Other', 'third'));

    expect(searchArchive(archive, 'from:seyma').matches.map((record) => record.id)).toEqual(['seyma']);
    expect(searchArchive(archive, 'from:seyma from:ahmet').matches.map((record) => record.id))
      .toEqual(['ahmet', 'seyma']);
  });

  it('matches quoted and unterminated phrases without splitting their spaces', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('phrase', { content: 'say iyi geceler now' }));
    archive.add(chatMessage('apart', { content: 'iyi appears here and geceler later' }));

    expect(searchArchive(archive, '"iyi geceler"').matches.map((record) => record.id)).toEqual(['phrase']);
    expect(searchArchive(archive, '"iyi gece').matches.map((record) => record.id)).toEqual(['phrase']);
  });

  it('applies folded negation while keeping hyphenated words and a bare hyphen literal', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(chatMessage('spam', { content: 'SAKA spam' }));
    archive.add(chatMessage('known', { content: 'well-known source' }));
    archive.add(chatMessage('dash', { content: 'single - marker' }));
    archive.add(chatMessage('clean', { content: 'ordinary message' }));

    expect(searchArchive(archive, '-spam').matches.map((record) => record.id))
      .toEqual(['clean', 'dash', 'known']);
    expect(searchArchive(archive, '-şaka').matches.map((record) => record.id))
      .toEqual(['clean', 'dash', 'known']);
    expect(searchArchive(archive, 'well-known').matches.map((record) => record.id)).toEqual(['known']);
    expect(searchArchive(archive, '-').matches.map((record) => record.id)).toEqual(['dash', 'known']);
  });

  it('widens a strict zero to sender-name subsequences in newest-first order', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('old', 1, 'SercanNoder', 'first message'));
    archive.add(messageFrom('new', 1, 'SercanNoder', 'second message'));

    const result = searchArchive(archive, 'srcnod');

    expect(result.widened).toBe(true);
    expect(result.matches.map((record) => record.id)).toEqual(['new', 'old']);
  });

  it('does not supplement a strict result with loose sender-name matches', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('loose-name', 1, 'SercanNoder', 'ordinary message'));
    archive.add(messageFrom('strict-body', 2, 'Alice', 'srcnod appears literally'));

    const result = searchArchive(archive, 'srcnod');

    expect(result.widened).toBe(false);
    expect(result.matches.map((record) => record.id)).toEqual(['strict-body']);
  });

  it('never applies subsequence matching to message bodies', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('body-only', 1, 'Alice', 's-r-c-n-o-d'));

    expect(searchArchive(archive, 'srcnod').matches).toEqual([]);
  });

  it('keeps negated terms authoritative during widened matching', () => {
    const archive = new UserMessageArchive({ now: () => NOW });
    archive.add(messageFrom('excluded-loose-name', 1, 'SercanNoder', 'spam'));

    expect(searchArchive(archive, 'srcnod -spam').matches).toEqual([]);
  });

  it('keeps folded search maps sized to live records across every eviction path', () => {
    let now = 0;
    const archive = new UserMessageArchive({
      maxMessages: 2,
      maxAgeMs: 5,
      perUserCap: 2,
      now: () => now,
    });

    const expectHaystackTracksLive = () => {
      expect(archive.internalFoldedHaystackCount).toBe(archive.size);
      expect(archive.internalFoldedSenderNameCount).toBe(archive.size);
    };

    archive.add(chatMessage('age-a', { userId: 1, content: 'one', createdAt: new Date(0).toISOString() }));
    archive.add(chatMessage('age-b', { userId: 2, content: 'two', createdAt: new Date(0).toISOString() }));
    expectHaystackTracksLive();

    // Age eviction.
    now = 6;
    archive.sweepExpired();
    expect(archive.size).toBe(0);
    expectHaystackTracksLive();

    // Global-cap eviction.
    now = 10;
    archive.add(chatMessage('global-a', { userId: 1, content: 'ga', createdAt: new Date(10).toISOString() }));
    archive.add(chatMessage('global-b', { userId: 2, content: 'gb', createdAt: new Date(10).toISOString() }));
    archive.add(chatMessage('global-c', { userId: 3, content: 'gc', createdAt: new Date(10).toISOString() }));
    expect(archive.size).toBe(2);
    expectHaystackTracksLive();

    // Per-user-cap eviction.
    archive.add(chatMessage('user-a', { userId: 9, content: 'ua', createdAt: new Date(10).toISOString() }));
    archive.add(chatMessage('user-b', { userId: 9, content: 'ub', createdAt: new Date(10).toISOString() }));
    archive.add(chatMessage('user-c', { userId: 9, content: 'uc', createdAt: new Date(10).toISOString() }));
    expect(archive.getByUserId(9)).toHaveLength(2);
    expectHaystackTracksLive();

    archive.clear();
    expect(archive.size).toBe(0);
    expectHaystackTracksLive();
  });
});
