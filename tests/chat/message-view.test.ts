import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendBadges, appendParsedContent, applyPreservedMarking, buildMessageElement, setSubscriberBadges } from '../../src/content/chat/message-view';
import { ChatIntegrityStore, type ChatMessage } from '../../src/content/chat/message-store';
import { OWN_LIST_ID } from '../../src/content/chat/overlay-mount';
import { normalizeMessage } from '../../src/content/chat/pusher-client';
import { configureUserCardSession, configureUserMessageArchive } from '../../src/content/chat/user-card';
import { UserMessageArchive } from '../../src/content/chat/user-message-archive';
import { setLang } from '../../src/content/shared/i18n';

beforeEach(() => setLang('tr'));

function message(
  slug: string,
  identity?: Partial<ChatMessage['sender']['identity']>,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'm1',
    chatroomId: 1,
    content: 'hello',
    type: 'message',
    createdAt: '',
    sender: {
      id: 1,
      username: 'Alice',
      slug,
      identity: { color: '', badges: [], badgesV2: [], ...identity },
    },
    preserved: false,
    ...overrides,
  };
}

describe('message-view safe rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    configureUserCardSession(null);
    setSubscriberBadges([]);
    document.body.innerHTML = '';
  });

  it('renders an injected VOD timestamp while preserving the default live formatter', () => {
    const createdAt = '2026-07-26T01:25:48Z';
    const vodRow = buildMessageElement(
      message('alice', undefined, { createdAt }),
      { timestampText: '07:13:10' },
    );
    const liveRow = buildMessageElement(message('alice', undefined, { createdAt }));

    expect(vodRow.querySelector('.kickflow-message__time')?.textContent).toBe('07:13:10');
    expect(liveRow.querySelector('.kickflow-message__time')?.textContent)
      .toBe(new Date(createdAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }));
  });

  it('renders parsed emotes, mentions, links, and script-looking text safely', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'hi [emote:123:kek] @Bob, http://x.y <script>alert(1)</script>');

    const emote = parent.querySelector<HTMLImageElement>('img.kickflow-emote');
    const emoteBox = parent.querySelector<HTMLElement>('.kickflow-emote-box');
    expect(emote?.src).toBe('https://files.kick.com/emotes/123/fullsize');
    expect(emote?.alt).toBe('kek');
    expect(emote?.title).toBe('kek');
    expect(emoteBox?.firstElementChild).toBe(emote);
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');
    expect(mention?.textContent).toBe('@Bob');
    expect(mention?.getAttribute('role')).toBe('link');
    expect(mention?.tabIndex).toBe(0);
    expect(mention?.classList.contains('kickflow-mention--link')).toBe(true);
    expect(parent.textContent).toContain('@Bob, http://x.y');
    expect(parent.querySelector<HTMLAnchorElement>('a.kickflow-link')?.href).toBe('http://x.y/');
    expect(parent.textContent).toContain('<script>alert(1)</script>');
    expect(parent.querySelector('script')).toBeNull();
  });

  it('gives long link text a <wbr> break hint after every slash, so a narrow column wraps at a path boundary instead of mid-domain', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'https://x.com/onlydramaX/status/2077813518233940154');

    const anchor = parent.querySelector<HTMLAnchorElement>('a.kickflow-link');
    expect(anchor?.href).toBe('https://x.com/onlydramaX/status/2077813518233940154');
    expect(anchor?.textContent).toBe('https://x.com/onlydramaX/status/2077813518233940154');
    expect(anchor?.querySelectorAll('wbr').length).toBeGreaterThan(0);
    expect(anchor?.innerHTML).not.toContain('<script');
  });

  it('uses the parsed emote name as safe alt and hover text in a regular Mode-A row', () => {
    const emoteName = '<svg onload=alert(1)>';
    const row = buildMessageElement(message('alice', undefined, {
      content: `hello [emote:456:${emoteName}]`,
    }));

    const emote = row.querySelector<HTMLImageElement>('.kickflow-message__content img.kickflow-emote');
    expect(emote?.alt).toBe(emoteName);
    expect(emote?.title).toBe(emoteName);
    expect(row.querySelector('svg')).toBeNull();
  });

  it('renders a subscription event row with singular/plural wording and safe user text', () => {
    const unsafeUsername = '<img src=x onerror=alert(1)>';
    const firstMonth = buildMessageElement(message('', undefined, {
      id: 'sub:1:first:1',
      type: 'subscription',
      systemEvent: { kind: 'subscription', username: unsafeUsername, months: 1 },
    }));
    const renewal = buildMessageElement(message('', undefined, {
      id: 'sub:1:renewal:2',
      type: 'subscription',
      systemEvent: { kind: 'subscription', username: 'violet_demo', months: 5 },
    }));

    expect(firstMonth.classList.contains('kickflow-event-row')).toBe(true);
    expect(firstMonth.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⭐');
    expect(firstMonth.querySelector('.kickflow-event-row__username')?.textContent).toBe(unsafeUsername);
    expect(firstMonth.textContent).toBe(`⭐${unsafeUsername} abone oldu`);
    expect(firstMonth.querySelector('img')).toBeNull();
    expect(renewal.textContent).toBe('⭐violet_demo 5 ay abone oldu');
  });

  it('gives system-event identities deterministic, distinguishable fallback colors and profile links', () => {
    const first = buildMessageElement(message('', undefined, {
      id: 'sub:color:1',
      systemEvent: { kind: 'subscription', username: 'color_alice', months: 1 },
    }));
    const second = buildMessageElement(message('', undefined, {
      id: 'sub:color:2',
      systemEvent: { kind: 'subscription', username: 'color_bob', months: 1 },
    }));
    const repeat = buildMessageElement(message('', undefined, {
      id: 'sub:color:3',
      systemEvent: { kind: 'subscription', username: 'COLOR_ALICE', months: 1 },
    }));
    const firstUser = first.querySelector<HTMLElement>('.kickflow-event-row__username');
    const secondUser = second.querySelector<HTMLElement>('.kickflow-event-row__username');
    const repeatUser = repeat.querySelector<HTMLElement>('.kickflow-event-row__username');

    expect(firstUser?.style.color).not.toBe('');
    expect(firstUser?.style.color).not.toBe('inherit');
    expect(secondUser?.style.color).not.toBe(firstUser?.style.color);
    expect(repeatUser?.style.color).toBe(firstUser?.style.color);
    expect(firstUser?.getAttribute('role')).toBe('link');
    expect(firstUser?.tabIndex).toBe(0);
    expect(first.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('renders role-labeled mod-action rows with safe identity text', () => {
    setLang('en');
    const unsafeName = '<img src=x onerror=alert(1)>';
    const row = buildMessageElement(message('', undefined, {
      id: 'mod-action:ban-1',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'ban',
        moderator: 'moderator_one',
        durationMin: null,
        victims: [{ name: unsafeName, messageId: null }],
        count: 1,
      },
    }));

    expect(row.querySelector('.kickflow-event-row__icon')).toBeNull();
    expect(row.querySelector('.kickflow-event-row__kind-tag')?.textContent).toBe('BAN');
    expect(row.textContent).toBe(`BAN Moderator: 🛡moderator_one | Target: ${unsafeName} | Banned`);
    expect(row.querySelector('.kickflow-event-row__moderator')?.textContent).toBe('moderator_one');
    expect(row.querySelector('.kickflow-event-row__moderator')?.getAttribute('title'))
      .toBe("Open moderator moderator_one's profile");
    expect(row.querySelector('.kickflow-event-row__victim')?.textContent).toBe(unsafeName);
    expect(row.querySelector('[data-kickflow-role="moderator"]')).not.toBeNull();
    expect(row.querySelector('[data-kickflow-role="target"]')).not.toBeNull();
    expect(row.textContent).toContain('Moderator:');
    expect(row.textContent).toContain('Target:');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.kickflow-event-row__victim')?.getAttribute('role')).toBeNull();
    expect(row.querySelector('.kickflow-event-row__victim')?.getAttribute('tabindex')).toBeNull();
  });

  it('renders an unknown-moderator action with an explicit unknown actor and a target profile link', () => {
    setLang('tr');
    const row = buildMessageElement(message('', undefined, {
      id: 'mod-action:unknown-1',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'timeout',
        moderator: null,
        durationMin: 5,
        victims: [{ name: 'target-user', messageId: null }],
        count: 1,
      },
    }));

    expect(row.querySelector('.kickflow-event-row__kind-tag')?.textContent).toBe('SUSTURMA');
    expect(row.querySelector('[data-kickflow-role="moderator"]')).toBeNull();
    expect(row.querySelector('.kickflow-event-row__moderator-shield')).toBeNull();
    expect(row.querySelector('[data-kickflow-role="target"]')?.textContent).toBe('target-user');
    expect(row.textContent).toContain('Moderatör: bilinmiyor');
    expect(row.textContent).toContain('Hedef:');
    expect(row.querySelector('.kickflow-event-row__victim')?.getAttribute('role')).toBe('link');
    expect(row.querySelector('.kickflow-event-row__victim')?.tabIndex).toBe(0);
    expect(row.querySelector('.kickflow-event-row__victim')?.getAttribute('title'))
      .toBe('target-user profilini aç');
  });

  it('covers every moderator-action matrix cell with explicit role markers in both languages', () => {
    const kinds = ['ban', 'timeout', 'delete'] as const;
    const forms = [
      { name: 'single', count: 1, victims: [{ name: 'target-one', messageId: null }] },
      {
        name: 'bulk',
        count: 2,
        victims: [
          { name: 'target-one', messageId: null },
          { name: 'target-two', messageId: null },
        ],
      },
    ] as const;
    const actors = [null, 'moderator-one'] as const;
    const durations = [null, 5] as const;

    for (const language of ['en', 'tr'] as const) {
      setLang(language);
      const moderatorLabel = language === 'en' ? 'Moderator:' : 'Moderatör:';
      const targetLabel = language === 'en' ? 'Target' : 'Hedef';
      const bulkTargetLabel = language === 'en' ? 'Targets' : 'Hedefler';
      const durationLabel = language === 'en' ? '5M' : '5DK';

      for (const kind of kinds) {
        for (const form of forms) {
          for (const moderator of actors) {
            for (const durationMin of durations) {
              const row = buildMessageElement(message('', undefined, {
                id: `mod-action:matrix:${language}:${kind}:${form.name}:${moderator ?? 'unknown'}:${durationMin ?? 'none'}`,
                type: 'mod-action',
                systemEvent: {
                  kind: 'mod-action',
                  actionKind: kind,
                  moderator,
                  durationMin,
                  victims: [...form.victims],
                  count: form.count,
                },
              }));
              const text = row.textContent ?? '';

              expect(text).toContain(moderatorLabel);
              expect(text).toContain(form.name === 'single' ? `${targetLabel}:` : `${bulkTargetLabel} (`);
              expect(text).not.toContain('__kickflow_');
              if (kind === 'timeout' && durationMin !== null) expect(text).toContain(durationLabel);

              const targetElements = row.querySelectorAll<HTMLElement>('.kickflow-event-row__victim');
              expect(targetElements).toHaveLength(form.victims.length);
              for (const target of targetElements) {
                expect(target.tabIndex).toBe(0);
                expect(target.getAttribute('role')).toBe('link');
                expect(target.title).toContain(language === 'en' ? 'profile' : 'profil');
              }

              const moderatorElement = row.querySelector<HTMLElement>('.kickflow-event-row__moderator');
              if (moderator) {
                expect(moderatorElement?.getAttribute('role')).toBe('link');
                expect(moderatorElement?.tabIndex).toBe(0);
                expect(moderatorElement?.title).toContain(language === 'en' ? 'profile' : 'profil');
              } else {
                expect(moderatorElement).toBeNull();
              }
            }
          }
        }
      }
    }
  });

  it('takes the moderator color from the fixed role system and the target color from identity', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('moderator_one', { color: '#E879F9' }, {
      id: 'moderator-seed',
      sender: {
        ...message('moderator_one').sender,
        username: 'moderator_one',
        slug: 'moderator_one',
        identity: { color: '#E879F9', badges: [], badgesV2: [] },
      },
    }));
    store.addMessage(message('target_user', { color: '#12ABEF' }, {
      id: 'target-seed',
      sender: {
        ...message('target_user').sender,
        username: 'target_user',
        slug: 'target_user',
        identity: { color: '#12ABEF', badges: [], badgesV2: [] },
      },
    }));

    const row = buildMessageElement(message('', undefined, {
      id: 'mod-action:roles-1',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'delete',
        moderator: 'moderator_one',
        durationMin: null,
        victims: [{ name: 'target_user', messageId: null }],
        count: 1,
      },
    }));
    const moderator = row.querySelector<HTMLElement>('.kickflow-event-row__moderator');
    const target = row.querySelector<HTMLElement>('.kickflow-event-row__victim');

    expect(moderator?.style.color).toBe('');
    expect(target?.style.color).toBe('rgb(18, 171, 239)');
  });

  it('keeps every moderator-action name on the profile path and gives retained messages separate jump controls', async () => {
    setLang('en');
    configureUserCardSession('channel');
    const fetchSpy = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    const jump = vi.fn();
    const openPanel = vi.fn();
    const single = buildMessageElement(message('', undefined, {
      id: 'mod-action:single-links',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'delete',
        moderator: 'single-moderator',
        durationMin: null,
        victims: [{ name: 'single-target', messageId: 'single-message' }],
        count: 1,
      },
    }), { onJumpToMessage: jump, onOpenRemovedPanel: openPanel });
    const bulk = buildMessageElement(message('', undefined, {
      id: 'mod-action:bulk-links',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'ban',
        moderator: 'bulk-moderator',
        durationMin: null,
        victims: [
          { name: 'first-target', messageId: 'first-message' },
          { name: 'no-target', messageId: null },
          { name: 'third-target', messageId: 'third-message' },
        ],
        count: 3,
      },
    }), { onJumpToMessage: jump, onOpenRemovedPanel: openPanel });

    const names = [
      ...single.querySelectorAll<HTMLElement>('.kickflow-event-row__moderator, .kickflow-event-row__victim'),
      ...bulk.querySelectorAll<HTMLElement>('.kickflow-event-row__moderator, .kickflow-event-row__victim'),
    ];
    for (const name of names) {
      expect(name.getAttribute('role')).toBe('link');
      expect(name.tabIndex).toBe(0);
      expect(name.title).toContain('profile');
      name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    }
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalled();
    expect(jump).not.toHaveBeenCalled();
    expect(openPanel).not.toHaveBeenCalled();

    const profileTabClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    for (const name of names) {
      name.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    }
    expect(profileTabClick).toHaveBeenCalledTimes(names.length);
    expect(jump).not.toHaveBeenCalled();

    const singleJump = single.querySelector<HTMLElement>('.kickflow-event-row__jump-control')!;
    const bulkJumps = [...bulk.querySelectorAll<HTMLElement>('.kickflow-event-row__jump-control')];
    expect(single.querySelectorAll('.kickflow-event-row__jump-control')).toHaveLength(1);
    expect(bulkJumps).toHaveLength(2);
    expect(singleJump.getAttribute('role')).toBe('button');
    expect(singleJump.tabIndex).toBe(0);
    expect(singleJump.getAttribute('aria-label')).toBe("Jump to single-target's retained message");
    expect(bulkJumps.map((control) => control.getAttribute('aria-label'))).toEqual([
      "Jump to first-target's retained message",
      "Jump to third-target's retained message",
    ]);
    const noTarget = [...bulk.querySelectorAll<HTMLElement>('.kickflow-event-row__victim')]
      .find((element) => element.textContent === 'no-target')!;
    expect(noTarget.nextElementSibling?.classList.contains('kickflow-event-row__jump-control') ?? false).toBe(false);

    singleJump.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    bulkJumps[0].dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));
    bulkJumps[1].dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
    }));
    expect(jump).toHaveBeenNthCalledWith(1, 'single-message', singleJump);
    expect(jump).toHaveBeenNthCalledWith(2, 'first-message', bulkJumps[0]);
    expect(jump).toHaveBeenNthCalledWith(3, 'third-message', bulkJumps[1]);

    setLang('tr');
    const localized = buildMessageElement(message('', undefined, {
      id: 'mod-action:localized-jump',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'delete',
        moderator: null,
        durationMin: null,
        victims: [{ name: 'hedef-kullanici', messageId: 'localized-message' }],
        count: 1,
      },
    }), { onJumpToMessage: jump });
    const localizedJump = localized.querySelector<HTMLElement>('.kickflow-event-row__jump-control')!;
    expect(localizedJump.getAttribute('aria-label'))
      .toBe('hedef-kullanici kullanıcısının korunmuş mesajına git');
  });

  it('opens the archived message list when a mod-action target is activated through real wiring', async () => {
    configureUserCardSession('channel');
    const archive = new UserMessageArchive();
    const archived = message('target-user', undefined, {
      id: 'target-archive-message',
      content: 'target archived message',
      sender: {
        ...message('target-user').sender,
        id: 61,
        username: 'Target-User',
        slug: 'target-user',
      },
    });
    archive.add(archived);
    configureUserMessageArchive(archive);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const row = buildMessageElement(message('', undefined, {
      id: 'mod-action:target-message-list',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'timeout',
        moderator: null,
        durationMin: 5,
        victims: [{ name: 'Target-User', messageId: null }],
        count: 1,
      },
    }));
    const target = row.querySelector<HTMLElement>('[data-kickflow-role="target"]');
    expect(target).not.toBeNull();

    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    await vi.waitFor(() => {
      const list = document.querySelector<HTMLElement>('.kickflow-user-messages');
      expect(list?.textContent).toContain('target archived message');
    });
  });

  it('keeps only the bulk row background as a Removed-panel fallback and excludes nested controls', () => {
    setLang('en');
    const jump = vi.fn();
    const openPanel = vi.fn();
    const single = buildMessageElement(message('', undefined, {
      id: 'mod-action:single-row',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'delete',
        moderator: null,
        durationMin: null,
        victims: [{ name: 'single-user', messageId: 'single-message' }],
        count: 1,
      },
    }), { onJumpToMessage: jump, onOpenRemovedPanel: openPanel });
    single.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(single.getAttribute('role')).toBeNull();
    expect(openPanel).not.toHaveBeenCalled();
    expect(jump).not.toHaveBeenCalled();

    const burst = buildMessageElement(message('', undefined, {
      id: 'mod-action:burst-row',
      type: 'mod-action',
      systemEvent: {
        kind: 'mod-action',
        actionKind: 'ban',
        moderator: null,
        durationMin: null,
        victims: [{ name: 'first-user', messageId: 'first-message' }],
        count: 2,
      },
    }), { onJumpToMessage: jump, onOpenRemovedPanel: openPanel });
    const name = burst.querySelector<HTMLElement>('.kickflow-event-row__victim')!;
    const jumpControl = burst.querySelector<HTMLElement>('.kickflow-event-row__jump-control')!;
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    jumpControl.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(openPanel).not.toHaveBeenCalled();
    expect(jump).toHaveBeenCalledWith('first-message', jumpControl);

    burst.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(openPanel).toHaveBeenCalledTimes(1);
    burst.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(openPanel).toHaveBeenCalledTimes(2);
  });

  it('wires every bulk-gift recipient, including recipients revealed later, as a profile link', async () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:links',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'profile_gifter',
        giftCount: 5,
        giftedUsernames: ['recipient_one', 'recipient_two', 'recipient_three', 'recipient_four', 'recipient_five'],
      },
    }));

    row.querySelector<HTMLElement>('.kickflow-event-row__more')
      ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    const identities = row.querySelectorAll<HTMLElement>(
      '.kickflow-event-row__username, .kickflow-event-row__recipient',
    );
    expect(identities).toHaveLength(6);
    for (const identity of identities) {
      expect(identity.getAttribute('role')).toBe('link');
      expect(identity.tabIndex).toBe(0);
      expect(identity.style.color).not.toBe('');
    }

    document.body.appendChild(row);
    identities[5].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await Promise.resolve();
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('recipient_five');
  });

  it('prefers a real identity color previously seen by the chat store', () => {
    const store = new ChatIntegrityStore();
    store.addMessage(message('known_color_user', { color: '#12ABEF' }, {
      id: 'known-color-message',
      sender: {
        ...message('known_color_user').sender,
        username: 'Known_Color_User',
        slug: 'known_color_user',
        identity: { color: '#12ABEF', badges: [], badgesV2: [] },
      },
    }));

    const row = buildMessageElement(message('', undefined, {
      id: 'sub:known-color',
      systemEvent: { kind: 'subscription', username: 'known_color_user', months: 1 },
    }));

    expect(row.querySelector<HTMLElement>('.kickflow-event-row__username')?.style.color)
      .toBe('rgb(18, 171, 239)');
  });

  it('renders a real celebration message as a native-style renewal card', () => {
    const captured = normalizeMessage({
      id: 'be911675-50cd-4910-848a-87ea0ccd59df',
      chatroom_id: 25951243,
      content: 'Oooo 32. ay gelmiş [emote:4860485:Jahreintersoldprayadge]',
      type: 'celebration',
      created_at: '2026-07-14T19:23:58+00:00',
      sender: {
        id: 28329441,
        username: 'ErenCekic02',
        slug: 'erencekic02',
        identity: {
          color: '#31D6C2',
          badges: [{ type: 'subscriber', text: 'Subscriber', count: 32, sort_order: 9 }],
          badges_v2: [{
            name: 'level', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/20_x.png',
            metadata: { level: 20 }, selected: true, sort_order: 1,
          }],
        },
      },
      metadata: {
        celebration: {
          id: 'chceleb_01KXGZF48ZJBEZYQJRT9W5DMWC',
          type: 'subscription_renewed',
          total_months: 32,
          created_at: '2026-07-14T18:50:42.335677Z',
        },
      },
    });
    if (!captured) throw new Error('captured celebration fixture failed to normalize');

    const row = buildMessageElement(captured);

    expect(row.classList.contains('kickflow-event-row--celebration')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⭐');
    expect(row.querySelector('.kickflow-event-row__username')?.textContent).toBe('ErenCekic02');
    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('32');
    expect(row.querySelector('.kickflow-celebration__message')?.textContent).toContain('Oooo 32. ay gelmiş');
    expect(row.querySelector('.kickflow-celebration__message img.kickflow-emote')?.getAttribute('alt')).toBe('Jahreintersoldprayadge');
    const identity = row.querySelector('.kickflow-celebration__message .kickflow-message__identity');
    expect(identity?.querySelector('.kickflow-message__badges')).not.toBeNull();
    expect(identity?.querySelector('.kickflow-celebration__author')?.textContent).toBe('ErenCekic02');
    expect(row.querySelector('.kickflow-celebration__message .kickflow-message__separator')?.textContent).toBe(':\u00a0');
    expect(row.querySelectorAll('.kickflow-message__separator')).toHaveLength(1);
  });

  it('names the single gift recipient with both usernames safe and no count capsule', () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:single',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'violet_demo<script>',
        giftCount: 1,
        giftedUsernames: ['<img src=x onerror=alert(1)>'],
      },
    }));

    expect(row.classList.contains('kickflow-event-row--gifted-subscription')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('🎁');
    expect(row.querySelector('.kickflow-event-row__username')?.textContent).toBe('violet_demo<script>');
    expect(row.querySelector('.kickflow-event-row__recipient')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(row.textContent).toBe('🎁violet_demo<script>, <img src=x onerror=alert(1)> kullanıcısına abonelik hediye etti');
    expect(row.querySelector('.kickflow-event-row__count')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('img')).toBeNull();
  });

  it('names every recipient of a small bulk gift without a remainder or hover list', () => {
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:small-bulk',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'cozy_mert',
        giftCount: 3,
        giftedUsernames: ['nova_88', 'ayla_k', 'demir42'],
      },
    }));

    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('3');
    expect(row.textContent).toBe('🎁cozy_mert 3 kişiye abonelik hediye etti: nova_88, ayla_k, demir42');
    expect(row.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
  });

  it('caps a large bulk gift at three names and expands the rest on click (no hover dependency)', () => {
    // Real captured 10-recipient GiftedSubscriptionsEvent payload (2026-07-14).
    const names = [
      'nova_88', 'ayla_k', 'demir42', 'mercan_x', 'luna_sade',
      'atlas_fake', 'poyraz_demo', 'kiraz_test', 'deniz_mock', 'umut_sample',
    ];
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:bulk',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'cozy_mert', giftCount: 10, giftedUsernames: names },
    }));

    expect(row.querySelector('.kickflow-event-row__count')?.textContent).toBe('10');
    expect(row.textContent).toBe('🎁cozy_mert 10 kişiye abonelik hediye etti: nova_88, ayla_k, demir42 ve 7 kişi daha');
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(3);
    // The full list is NOT hidden in a hover-only title; it lives behind a visible affordance.
    expect(row.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    expect(more?.getAttribute('role')).toBe('button');
    expect(more?.getAttribute('tabindex')).toBe('0');

    // Click reveals every remaining KNOWN name in place; the one-shot trigger removes itself.
    more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(10);
    expect(row.querySelector('.kickflow-event-row__more')).toBeNull();
    expect(row.textContent).toBe(`🎁cozy_mert 10 kişiye abonelik hediye etti: ${names.join(', ')}`);
  });

  it('expands the bulk recipient list on Enter/Space for keyboard users', () => {
    const names = ['one', 'two', 'three', 'four', 'five', 'six'];
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:kbd',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'gifter', giftCount: 6, giftedUsernames: names },
    }));
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    more!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(6);
    expect(row.querySelector('.kickflow-event-row__more')).toBeNull();
  });

  it('collapses the expand trigger to a static count when some recipients are unnameable', () => {
    // Kick's count (20) exceeds the names it sent (5): clicking reveals the 2 hidden KNOWN names,
    // then the trigger degrades to a plain, non-interactive remainder for the 15 unknown ones.
    const row = buildMessageElement(message('', undefined, {
      id: 'gift:1:mixed',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 20,
        giftedUsernames: ['one', 'two', 'three', 'four', 'five'],
      },
    }));
    expect(row.textContent).toBe('🎁gifter 20 kişiye abonelik hediye etti: one, two, three ve 17 kişi daha');
    const more = row.querySelector<HTMLElement>('.kickflow-event-row__more');
    more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row.querySelectorAll('.kickflow-event-row__recipient')).toHaveLength(5);
    // Trigger is now inert text — no button role, and it left the __more class.
    const inert = row.querySelector('.kickflow-event-row__more');
    expect(inert).toBeNull();
    expect(row.textContent).toBe('🎁gifter 20 kişiye abonelik hediye etti: one, two, three, four, five ve 15 kişi daha');
  });

  it('never shows a number that contradicts the visible names when count and names disagree', () => {
    // Kick's total ahead of the names: headline keeps the total, remainder = total - shown,
    // and no hover list exists because no known name is hidden.
    const countAhead = buildMessageElement(message('', undefined, {
      id: 'gift:1:count-ahead',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 5,
        giftedUsernames: ['one', 'two', 'three'],
      },
    }));
    expect(countAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three ve 2 kişi daha');
    expect(countAhead.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();

    // Fewer names than the cap: the remainder still reconciles against the headline total.
    const oneNamed = buildMessageElement(message('', undefined, {
      id: 'gift:1:one-named',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'gifter', giftCount: 3, giftedUsernames: ['one'] },
    }));
    expect(oneNamed.textContent).toBe('🎁gifter 3 kişiye abonelik hediye etti: one ve 2 kişi daha');

    // More names than Kick's stated total: five real names outrank a smaller number.
    const namesAhead = buildMessageElement(message('', undefined, {
      id: 'gift:1:names-ahead',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'gifter',
        giftCount: 2,
        giftedUsernames: ['one', 'two', 'three', 'four', 'five'],
      },
    }));
    expect(namesAhead.querySelector('.kickflow-event-row__count')?.textContent).toBe('5');
    expect(namesAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three ve 2 kişi daha');
    // The two names beyond the cap are reachable by clicking the visible trigger, not via hover.
    expect(namesAhead.querySelector('.kickflow-event-row__recipients')?.getAttribute('title')).toBeNull();
    namesAhead.querySelector<HTMLElement>('.kickflow-event-row__more')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(namesAhead.textContent).toBe('🎁gifter 5 kişiye abonelik hediye etti: one, two, three, four, five');
  });

  it('falls back to the count-only gift row when recipients are empty or missing', () => {
    const empty = buildMessageElement(message('', undefined, {
      id: 'gift:1:empty',
      type: 'gifted-subscription',
      systemEvent: { kind: 'gifted-subscription', username: 'violet_demo', giftCount: 3, giftedUsernames: [] },
    }));
    expect(empty.textContent).toBe('🎁violet_demo 3 kişiye abonelik hediye etti');
    expect(empty.querySelector('.kickflow-event-row__recipients')).toBeNull();

    // A malformed producer (missing array) must degrade to the same row, never crash.
    const missing = buildMessageElement(message('', undefined, {
      id: 'gift:1:missing',
      type: 'gifted-subscription',
      systemEvent: {
        kind: 'gifted-subscription',
        username: 'violet_demo',
        giftCount: 3,
        giftedUsernames: undefined as unknown as string[],
      },
    }));
    expect(missing.textContent).toBe('🎁violet_demo 3 kişiye abonelik hediye etti');
  });

  it('renders a kicks row with safe user text, grouped amount, and optional fields', () => {
    const basic = buildMessageElement(message('', undefined, {
      id: 'kicks:txn-1',
      type: 'kicks',
      systemEvent: { kind: 'kicks', username: 'TallSkydiver', amount: 500, giftName: null, senderMessage: null },
    }));

    expect(basic.classList.contains('kickflow-event-row--kicks')).toBe(true);
    expect(basic.querySelector('.kickflow-event-row__icon')?.textContent).toBe('💰');
    expect(basic.querySelector('.kickflow-event-row__username')?.textContent).toBe('TallSkydiver');
    expect(basic.querySelector('.kickflow-event-row__count')?.textContent).toBe('500');
    expect(basic.textContent).toBe('💰TallSkydiver 500 KICKs hediye etti');

    const rich = buildMessageElement(message('', undefined, {
      id: 'kicks:txn-2',
      type: 'kicks',
      systemEvent: {
        kind: 'kicks',
        username: 'violet_demo<script>',
        amount: 1_234_567,
        giftName: 'Rage Quit',
        senderMessage: 'nice [emote:456:kek] <script>alert(1)</script>',
      },
    }));

    const count = rich.querySelector<HTMLElement>('.kickflow-event-row__count');
    // Large amounts are grouped for display, but the exact integer stays on the title.
    expect(count?.textContent).toBe('1.234.567');
    expect(count?.title).toBe('1234567');
    expect(rich.querySelector('.kickflow-event-row__username')?.textContent).toBe('violet_demo<script>');
    expect(rich.querySelector('.kickflow-event-row__gift')?.textContent).toBe('Rage Quit');
    // The sender message travels the same safe emote/link path as ordinary chat content.
    expect(rich.querySelector<HTMLImageElement>('.kickflow-event-row__note img.kickflow-emote')?.src)
      .toBe('https://files.kick.com/emotes/456/fullsize');
    expect(rich.textContent).toContain('<script>alert(1)</script>');
    expect(rich.querySelector('script, svg')).toBeNull();
  });

  it('renders host rows with safe user text, Turkish viewer formatting, and a viewerless fallback', () => {
    const unsafeUsername = '<img src=x onerror=alert(1)>';
    const withViewers = buildMessageElement(message('', undefined, {
      id: 'host:1:unsafe:1',
      type: 'host',
      systemEvent: {
        kind: 'host',
        username: unsafeUsername,
        numberViewers: 12_345,
        optionalMessage: '<script>alert(2)</script>',
      },
    }));
    const withoutViewers = buildMessageElement(message('', undefined, {
      id: 'host:1:viewerless:2',
      type: 'host',
      systemEvent: {
        kind: 'host',
        username: 'Mr_Jelal',
        numberViewers: 0,
        optionalMessage: null,
      },
    }));

    expect(withViewers.classList.contains('kickflow-event-row--host')).toBe(true);
    expect(withViewers.querySelector('.kickflow-event-row__icon')?.textContent).toBe('📡');
    expect(withViewers.querySelector('.kickflow-event-row__username')?.textContent).toBe(unsafeUsername);
    expect(withViewers.querySelector('.kickflow-event-row__count')?.textContent).toBe('12.345');
    expect(withViewers.textContent).toBe(`📡${unsafeUsername} 12.345 izleyiciyle host etti`);
    expect(withViewers.querySelector('img, script')).toBeNull();
    expect(withoutViewers.textContent).toBe('📡Mr_Jelal host etti');
    expect(withoutViewers.querySelector('.kickflow-event-row__count')).toBeNull();
  });

  it('renders a mode system row with its settings icon and safe text', () => {
    const unsafeText = 'Yavaş mod açıldı (5sn)<script>alert(1)</script>';
    const row = buildMessageElement(message('', undefined, {
      id: 'mode:1:slow_mode:1',
      type: 'mode',
      systemEvent: { kind: 'mode', mode: 'slow_mode', text: unsafeText },
    }));

    expect(row.classList.contains('kickflow-event-row--mode')).toBe(true);
    expect(row.querySelector('.kickflow-event-row__icon')?.textContent).toBe('⚙');
    expect(row.querySelector('.kickflow-event-row__text')?.textContent).toBe(unsafeText);
    expect(row.querySelector('script')).toBeNull();
  });

  it('opens a mention slug in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @Bob_123!');
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');

    mention?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(parent.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('opens a mention user card on plain left-click', async () => {
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @NoSuchUserProbably');
    document.body.appendChild(parent);

    parent.querySelector<HTMLElement>('.kickflow-mention')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 20, clientY: 30 }));
    await Promise.resolve();

    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('NoSuchUserProbably');
    expect(document.querySelector<HTMLAnchorElement>('.kickflow-user-card__link')?.href)
      .toBe('https://kick.com/nosuchuserprobably');
  });

  it('keeps mention Space activation from bubbling into page-level hotkeys', async () => {
    const parent = document.createElement('span');
    appendParsedContent(parent, 'selam @NoSuchUserProbably');
    document.body.appendChild(parent);
    const mention = parent.querySelector<HTMLElement>('.kickflow-mention');
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    mention?.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('NoSuchUserProbably');
  });

  it('renders non-numeric emote ids as text', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, '[emote:abc:kek]');

    expect(parent.querySelector('img.kickflow-emote')).toBeNull();
    expect(parent.textContent).toBe('[emote:abc:kek]');
  });

  it('does not anchor javascript scheme text', () => {
    const parent = document.createElement('span');

    appendParsedContent(parent, 'javascript:alert(1)');

    expect(parent.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(parent.textContent).toBe('javascript:alert(1)');
  });

  it('falls back to badge text for untrusted image hosts', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ text: 'VIP', imageUrl: 'https://evil.example/badge.png' }]);

    expect(parent.querySelector('img')).toBeNull();
    expect(parent.querySelector('.kickflow-badge-text')?.textContent).toBe('VIP');
  });

  it('renders safe username slugs as an interactive span (NOT a router-recognizable anchor)', () => {
    const row = buildMessageElement(message('alice_123'));

    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    // Deliberately a <span role="link">, not <a href> — so Kick's SPA click router can't classify
    // it and navigate the page. We handle left-click (card) / modified-click (new tab) ourselves.
    expect(username?.tagName).toBe('SPAN');
    expect(username?.getAttribute('role')).toBe('link');
    expect(username?.tabIndex).toBe(0);
    expect(username?.classList.contains('kickflow-message__username--link')).toBe(true);
    expect(username?.textContent).toBe('Alice');
    expect(row.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('opens a safe username in a new tab on middle-click without adding a same-origin anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const row = buildMessageElement(message('alice_123'));
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');

    username?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(row.querySelector('a[href*="kick.com"]')).toBeNull();
  });

  it('keeps username keyboard activation from bubbling into page-level hotkeys', async () => {
    const row = buildMessageElement(message('alice_123'));
    document.body.appendChild(row);
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    username?.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.querySelector('.kickflow-user-card')?.textContent).toContain('Alice');
  });

  it('does not link unsafe username slugs', () => {
    const row = buildMessageElement(message('../evil'));

    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    expect(username?.tagName).toBe('SPAN');
    expect(username?.textContent).toBe('Alice');
    expect(row.querySelector('a[href*="evil"]')).toBeNull();
  });

  it('renders reply context above the message using text nodes only', () => {
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: {
        replyToUser: 'ZehoG',
        replyToText: '<script>alert(1)</script> hello',
        replyToMessageId: 'orig-1',
        replyToUserId: 2,
        threadParentId: 'orig-1',
      },
    }));

    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');
    expect(reply?.textContent).toBe('↩ZehoG: <script>alert(1)</script> hello');
    expect(reply?.querySelector('.kickflow-message__reply-user')?.textContent).toBe('ZehoG');
    expect(reply?.querySelector<HTMLElement>('.kickflow-message__reply-user')?.title).toBe('ZehoG');
    expect(reply?.querySelector('.kickflow-message__reply-separator')?.textContent).toBe(': ');
    expect(reply?.querySelector('.kickflow-message__reply-snippet')?.textContent).toBe('<script>alert(1)</script> hello');
    // No child carries its own title — the whole row shows one "user: message" tooltip so the
    // ellipsized replied-to message is fully readable on hover (see appendReplyContext).
    expect(reply?.querySelector<HTMLElement>('.kickflow-message__reply-snippet')?.title).toBe('');
    expect(reply?.title).toBe('ZehoG: <script>alert(1)</script> hello');
    expect(reply?.querySelector('.kickflow-message__reply-label')).toBeNull();
    expect(reply?.querySelector('script')).toBeNull();
    expect(row.firstElementChild).toBe(reply);
  });

  it('makes a reply with an original id keyboard-accessible and jumps to its own-list row', () => {
    const list = document.createElement('div');
    list.id = OWN_LIST_ID;
    const target = document.createElement('div');
    target.dataset.messageId = 'orig-jump';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    list.appendChild(target);
    document.body.appendChild(list);

    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: { replyToUser: 'Jump_User', replyToText: 'original', replyToMessageId: 'orig-jump' },
    }));
    list.appendChild(row);
    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');

    expect(reply?.getAttribute('role')).toBe('button');
    expect(reply?.tabIndex).toBe(0);
    reply?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(target.classList.contains('kickflow-message--jump-highlight')).toBe(true);

    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    reply?.dispatchEvent(enter);
    const space = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    reply?.dispatchEvent(space);
    expect(enter.defaultPrevented).toBe(true);
    expect(space.defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it('handles a missing reply target without throwing', () => {
    const list = document.createElement('div');
    list.id = OWN_LIST_ID;
    document.body.appendChild(list);
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: { replyToUser: 'Gone_User', replyToText: 'trimmed', replyToMessageId: 'gone' },
    }));
    list.appendChild(row);
    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');

    expect(() => reply?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))).not.toThrow();
  });

  it('leaves a reply without an original id non-interactive', () => {
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: { replyToUser: 'Legacy_User', replyToText: 'old payload', replyToMessageId: null },
    }));
    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');

    expect(reply?.hasAttribute('role')).toBe(false);
    expect(reply?.hasAttribute('tabindex')).toBe(false);
  });

  it('renders an emote inside a reply snippet and uses its plain name as the hover title', () => {
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: {
        replyToUser: 'ZehoG',
        replyToText: 'hi [emote:5405749:sreactayak] there',
        replyToMessageId: 'orig-1',
        replyToUserId: 2,
        threadParentId: 'orig-1',
      },
    }));

    const reply = row.querySelector<HTMLElement>('.kickflow-message__reply-context');
    const snippet = row.querySelector<HTMLElement>('.kickflow-message__reply-snippet');
    const emote = snippet?.querySelector<HTMLImageElement>('img.kickflow-emote');
    expect(emote?.src).toBe('https://files.kick.com/emotes/5405749/fullsize');
    // The row's hover title is the plain-texted "user: message" (bare emote name, not the raw
    // `[emote:...]` token); the snippet itself carries no title.
    expect(reply?.title).toBe('ZehoG: hi sreactayak there');
    expect(snippet?.title).toBe('');
  });

  it('renders a URL inside a compact reply snippet as plain text, never as a link', () => {
    const row = buildMessageElement(message('alice_123', undefined, {
      replyContext: {
        replyToUser: 'ZehoG',
        replyToText: 'check http://evil.example out',
        replyToMessageId: 'orig-1',
        replyToUserId: 2,
        threadParentId: 'orig-1',
      },
    }));

    const snippet = row.querySelector<HTMLElement>('.kickflow-message__reply-snippet');
    expect(snippet?.querySelector('a')).toBeNull();
    expect(snippet?.textContent).toBe('check http://evil.example out');
  });

  it('reconciles an existing deleted label when a later ban upgrades the message', () => {
    const item = message('alice', undefined, {
      preserved: true,
      preservedReason: 'deleted',
      preservedMeta: { aiModerated: false, deletedBy: 'delete-mod' },
    });
    const row = buildMessageElement(item);
    expect(row.classList.contains('kickflow-deleted')).toBe(true);

    item.preservedReason = 'banned';
    item.preservedMeta = { ...item.preservedMeta, permanent: true, bannedBy: 'ban-mod' };
    applyPreservedMarking(row, item);

    expect(row.classList.contains('kickflow-deleted')).toBe(false);
    expect(row.classList.contains('kickflow-banned')).toBe(true);
    expect(row.querySelectorAll('.kickflow-status-label')).toHaveLength(1);
    expect(row.querySelector('.kickflow-status-label')?.textContent).toBe('BANLANDI');
    expect(row.querySelector('.kickflow-mod-label')?.textContent).toBe('· ban-mod');
  });

  it('renders an authentic Kick SVG for a moderator role badge, with a tooltip', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'moderator' }]);

    const img = parent.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    expect(img?.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(img?.title).toBe('Moderatör');
  });

  it('renders a level image (`badges_v2`) BEFORE an authentic role asset (`badges`), in sort_order', () => {
    const row = buildMessageElement(message('alice_123', {
      badges: [{ type: 'moderator', text: 'Moderator', sortOrder: 4 }],
      badgesV2: [{ name: 'level', imageUrl: 'https://ext.cdn.kick.com/chat/badges/1_x.png', level: 1, sortOrder: 1 }],
    }));

    const badgeContainer = row.querySelector('.kickflow-message__badges');
    const icons = Array.from(badgeContainer?.querySelectorAll<HTMLImageElement>('img.kickflow-badge-icon') ?? []);

    // sortOrder 1 (level) < sortOrder 4 (moderator) — the level image must come first.
    expect(icons).toHaveLength(2);
    expect(icons[0].src).toBe('https://ext.cdn.kick.com/chat/badges/1_x.png');
    expect(icons[0].title).toBe('1. Seviye');
    expect(icons[1].src.startsWith('data:image/svg+xml')).toBe(true);
    expect(icons[1].title).toBe('Moderatör');
  });

  it('keeps badges and username in one native-shaped identity group with a non-breaking separator', () => {
    const row = buildMessageElement(message('alice_123', {
      badges: [{ type: 'moderator', text: 'Moderator', sortOrder: 1 }],
    }));

    const identity = row.querySelector<HTMLElement>('.kickflow-message__identity');
    const badges = row.querySelector<HTMLElement>('.kickflow-message__badges');
    const username = row.querySelector<HTMLElement>('.kickflow-message__username');
    const separator = row.querySelector<HTMLElement>('.kickflow-message__separator');

    expect(identity).not.toBeNull();
    expect(Array.from(identity?.children ?? [])).toEqual([badges, username]);
    expect(separator?.textContent).toBe(':\u00a0');
    expect(separator?.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits an explicitly unselected level badge from a real Kick-shaped message', () => {
    const captured = normalizeMessage({
      id: '23a4be58-1f76-414e-b452-29905f5828d4',
      chat_id: 49494919,
      chatroom_id: 49206572,
      user_id: 1628,
      content: 'uğraşamam.',
      type: 'message',
      metadata: '{"message_ref":"1784233982451"}',
      sender: {
        id: 1628,
        slug: 'laureth',
        username: 'laureth',
        identity: {
          color: '#AAA9FF',
          badges: [
            { type: 'subscriber', text: 'Subscriber', count: 1, sort_order: 9 },
          ],
          badges_v2: [
            {
              name: 'level',
              badge_type: 'global',
              image_url: 'https://ext.cdn.kick.com/chat/badges/34_019f35ce-472b-7c85-b482-8e7b7ed343b1.png',
              selected: false,
              metadata: { level: 34 },
              sort_order: 1,
            },
          ],
        },
      },
      created_at: '2026-07-16T20:33:01Z',
      thread_parent_id: null,
    });
    if (!captured) throw new Error('captured Kick fixture failed to normalize');

    const row = buildMessageElement(captured);
    const badges = row.querySelector('.kickflow-message__badges');

    expect(row.classList.contains('kickflow-message')).toBe(true);
    expect(row.querySelector('.kickflow-message__username')?.textContent).toBe('laureth');
    expect(badges?.querySelector('img[src*="/chat/badges/34_"]')).toBeNull();
    expect(badges?.querySelector('.kickflow-badge-role')?.getAttribute('title')).toContain('Abone');
  });

  it('resolves the channel subscriber badge by month count and renders it as a real image', () => {
    setSubscriberBadges([
      { months: 1, src: 'https://files.kick.com/channel_subscriber_badges/1/original' },
      { months: 6, src: 'https://files.kick.com/channel_subscriber_badges/6/original' },
    ]);
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'subscriber', count: 12 }]);

    const img = parent.querySelector<HTMLImageElement>('img.kickflow-badge-icon');
    expect(img?.src).toBe('https://files.kick.com/channel_subscriber_badges/6/original');
    expect(img?.title).toContain('Abone');
    expect(img?.title).toContain('12 ay');
  });

  it('falls back to a subscriber chip when no channel subscriber-badge context is set', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'subscriber', count: 14 }]);

    const chip = parent.querySelector<HTMLElement>('.kickflow-badge-role');
    expect(parent.querySelector('img')).toBeNull();
    expect(chip).not.toBeNull();
    expect(chip?.title).toContain('Abone');
    expect(chip?.querySelector('.kickflow-badge-role__count')?.textContent).toBe('14');
  });

  it('renders a broadcaster fallback chip with its Turkish label as the tooltip', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'broadcaster' }]);

    const chip = parent.querySelector<HTMLElement>('.kickflow-badge-role');
    expect(chip).not.toBeNull();
    expect(chip?.title).toBe('Yayıncı');
  });

  it('falls back to badge text (with a tooltip) for an unknown role type', () => {
    const parent = document.createElement('span');

    appendBadges(parent, [{ type: 'weird', text: 'Weird' }]);

    const span = parent.querySelector<HTMLElement>('.kickflow-badge-text');
    expect(parent.querySelector('.kickflow-badge-role')).toBeNull();
    expect(span?.textContent).toBe('Weird');
    expect(span?.title).toBe('Weird');
  });
});
