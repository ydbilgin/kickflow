import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import {
  NATIVE_PIN_HIDDEN_ATTRIBUTE,
  NativePinMirror,
} from '../../src/content/chat/native-pin-mirror';
import { Lifecycle } from '../../src/content/shared/lifecycle';

type BootstrapModule = typeof import('../../src/content/bootstrap');

interface NativePinFixture {
  parent: HTMLElement;
  overlay: HTMLElement;
  inner: HTMLElement;
  messages: HTMLElement;
  bottomOverlay: HTMLElement;
}

const originalFlags = { ...featureFlags };
const activeLifecycles = new Set<Lifecycle>();
let bootstrap: BootstrapModule;

beforeAll(async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(window, 'setInterval').mockReturnValue(1);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'kickflow-test',
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
        set: vi.fn(async (): Promise<void> => undefined),
      },
    },
  });
  bootstrap = await import('../../src/content/bootstrap');
  await flushMutations();
});

afterEach(() => {
  activeLifecycles.forEach((lifecycle) => lifecycle.dispose());
  activeLifecycles.clear();
  document.body.replaceChildren();
  document.documentElement.classList.remove('kickflow-chat-active');
  Object.assign(featureFlags, originalFlags);
});

afterAll(() => {
  Object.assign(featureFlags, originalFlags);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createFixture(): NativePinFixture {
  const parent = document.createElement('div');
  parent.className = 'relative shrink grow overflow-hidden bg-surface-lowest';

  const overlay = document.createElement('div');
  overlay.className = 'absolute w-full empty:hidden';
  overlay.style.paddingTop = '6px';
  overlay.style.paddingBottom = '6px';

  const inner = document.createElement('div');
  inner.className = 'relative flex h-fit w-full flex-col gap-1.5 transition-[padding-left,padding-right] empty:hidden';
  inner.style.paddingLeft = '8px';
  inner.style.paddingRight = '8px';
  overlay.appendChild(inner);

  const messages = document.createElement('div');
  messages.id = 'chatroom-messages';

  const bottomOverlay = document.createElement('div');
  bottomOverlay.className = 'absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2';
  bottomOverlay.textContent = 'new messages';

  parent.append(overlay, messages, bottomOverlay);
  document.body.appendChild(parent);
  return { parent, overlay, inner, messages, bottomOverlay };
}

function fillPin(inner: HTMLElement, actor: string, message: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'native-pin-card';

  const actorRow = document.createElement('div');
  actorRow.className = 'native-pin-actor-row';
  const avatar = document.createElement('img');
  avatar.src = 'https://files.kick.com/avatar.webp';
  avatar.alt = '';
  const actorIdentity = document.createElement('div');
  const badge = document.createElement('img');
  badge.src = 'https://files.kick.com/moderator.svg';
  const actorButton = document.createElement('button');
  actorButton.type = 'button';
  actorButton.textContent = actor;
  actorIdentity.append(badge, actorButton);
  const nativeHeaderControl = document.createElement('button');
  nativeHeaderControl.type = 'button';
  nativeHeaderControl.setAttribute('aria-label', 'native collapse');
  nativeHeaderControl.textContent = '⌃';
  actorRow.append(avatar, actorIdentity, document.createTextNode(' tarafından sabitlendi '), nativeHeaderControl);

  const contentRow = document.createElement('div');
  contentRow.className = 'native-pin-content-row';
  const content = document.createElement('div');
  content.className = 'native-rendered-content';
  content.append(document.createTextNode(`${message} `));
  const link = document.createElement('a');
  link.href = 'https://example.com/tip';
  link.textContent = 'tip link';
  const emote = document.createElement('img');
  emote.src = 'https://files.kick.com/emotes/123/fullsize';
  emote.alt = 'HYPERCLAP';
  content.append(link, document.createTextNode(' '), emote);
  const nativeBodyControl = document.createElement('button');
  nativeBodyControl.type = 'button';
  nativeBodyControl.setAttribute('aria-label', 'native dismiss');
  nativeBodyControl.textContent = '×';
  contentRow.append(content, nativeBodyControl);

  card.append(actorRow, contentRow);
  inner.replaceChildren(card);
  return card;
}

function fillContentOnlyPin(inner: HTMLElement, message: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'native-pin-card';
  const content = document.createElement('div');
  content.className = 'native-rendered-content';
  content.append(document.createTextNode(`${message} `));
  const link = document.createElement('a');
  link.href = 'https://example.com/content-only';
  link.textContent = 'content link';
  const emote = document.createElement('img');
  emote.src = 'https://files.kick.com/emotes/456/fullsize';
  emote.alt = 'ACTORLESS';
  content.append(link, document.createTextNode(' '), emote);
  const nativeControl = document.createElement('button');
  nativeControl.type = 'button';
  nativeControl.textContent = 'Dismiss';
  card.append(content, nativeControl);
  inner.replaceChildren(card);
  return card;
}

function createMirror(fixture: NativePinFixture): {
  lifecycle: Lifecycle;
  host: HTMLElement;
  onShow: ReturnType<typeof vi.fn>;
  controller: import('../../src/content/bootstrap').PinnedMessageController;
} {
  const lifecycle = new Lifecycle();
  activeLifecycles.add(lifecycle);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onShow = vi.fn();
  const controller = bootstrap.createPinnedMessageController(host, onShow);
  new NativePinMirror(lifecycle, controller);
  expect(fixture.bottomOverlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);
  return { lifecycle, host, onShow, controller };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('own-mode native pin mirror', () => {
  it('backfills a filled native pin, clones rich body content, and marks only the pin overlay hidden', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const nativeCard = fillPin(fixture.inner, 'BotRix', 'Destek mesajı');
    const nativeContent = nativeCard.querySelector('.native-rendered-content');
    const { lifecycle, host, onShow } = createMirror(fixture);

    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(host.querySelector('.kickflow-pinned-message')).not.toBeNull();
    expect(host.querySelector('.kickflow-pinned-message__actor')?.textContent).toBe('BotRix sabitledi');
    expect(host.querySelector('.kickflow-pinned-message__content')?.textContent).toContain('Destek mesajı tip link');
    expect(host.querySelector<HTMLAnchorElement>('.kickflow-pinned-message__content a')?.href).toBe('https://example.com/tip');
    expect(host.querySelector<HTMLImageElement>('.kickflow-pinned-message__content img')?.alt).toBe('HYPERCLAP');
    expect(host.querySelector('.kickflow-pinned-message__body button')).toBeNull();
    expect(host.querySelector('.native-rendered-content')).not.toBe(nativeContent);
    expect(onShow).toHaveBeenCalledOnce();

    fixture.overlay.removeAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE);
    await flushMutations();
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(onShow).toHaveBeenCalledOnce();

    lifecycle.dispose();
  });

  it('keeps rendering the cloned message body when no actor username can be extracted', () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillPin(fixture.inner, '', 'actorless pin');
    const { lifecycle, host } = createMirror(fixture);

    expect(host.textContent).toContain('actorless pin');
    expect(host.querySelector('.kickflow-pinned-message__actor')).toBeNull();

    lifecycle.dispose();
  });

  it('does not mistake a textual native control for an actor username', () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const card = fillPin(fixture.inner, '', 'actorless pin');
    const collapse = card.querySelector<HTMLButtonElement>('[aria-label="native collapse"]');
    if (collapse) collapse.textContent = 'Collapse';
    const { lifecycle, host } = createMirror(fixture);

    expect(host.textContent).toContain('actorless pin');
    expect(host.querySelector('.kickflow-pinned-message__actor')).toBeNull();

    lifecycle.dispose();
  });

  it('treats a content-only card as actorless content instead of misclassifying its link', () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillContentOnlyPin(fixture.inner, 'body without an actor row');
    const { lifecycle, host } = createMirror(fixture);

    expect(host.querySelector('.kickflow-pinned-message__actor')).toBeNull();
    expect(host.textContent).toContain('body without an actor row content link');
    expect(host.querySelector<HTMLImageElement>('.kickflow-pinned-message__content img')?.alt).toBe('ACTORLESS');
    expect(host.querySelector('.kickflow-pinned-message__body button')).toBeNull();

    lifecycle.dispose();
  });

  it('mirrors empty-to-filled creation, clears on unpin, and shows the same pin when re-pinned', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const { lifecycle, host } = createMirror(fixture);
    expect(host.childElementCount).toBe(0);
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);

    fillPin(fixture.inner, 'BotRix', 'live pin');
    await flushMutations();
    expect(host.textContent).toContain('live pin');
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    fixture.inner.replaceChildren();
    await flushMutations();
    expect(host.childElementCount).toBe(0);
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);

    fillPin(fixture.inner, 'BotRix', 'live pin');
    await flushMutations();
    expect(host.textContent).toContain('live pin');

    lifecycle.dispose();
  });

  it('fails open when extraction becomes empty, then resumes hiding after valid content returns', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const card = fillPin(fixture.inner, 'BotRix', 'valid pin');
    const { lifecycle, host } = createMirror(fixture);
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    const contentRow = card.querySelector<HTMLElement>('.native-pin-content-row');
    const nativeControl = document.createElement('button');
    nativeControl.textContent = 'Dismiss';
    contentRow?.replaceChildren(document.createTextNode('  \n\t '), nativeControl);
    await flushMutations();

    expect(host.childElementCount).toBe(0);
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);

    fillPin(fixture.inner, 'BotRix', 'valid again');
    await flushMutations();
    expect(host.textContent).toContain('valid again');
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    lifecycle.dispose();
  });

  it('finds the structural message list despite a duplicate id inside pin content and strips cloned ids', () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const card = fillPin(fixture.inner, 'BotRix', 'duplicate-id pin');
    const duplicate = document.createElement('span');
    duplicate.id = 'chatroom-messages';
    duplicate.textContent = 'nested duplicate';
    card.querySelector('.native-rendered-content')?.prepend(duplicate);
    const { lifecycle, host } = createMirror(fixture);

    expect(host.textContent).toContain('duplicate-id pin');
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(host.querySelector('[id="chatroom-messages"]')).toBeNull();
    expect(duplicate.id).toBe('chatroom-messages');

    lifecycle.dispose();
  });

  it('keeps the same id and dismiss/collapse state for identical content, then resets for changed content', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'first pin');
    const { lifecycle, host } = createMirror(fixture);
    const firstBanner = host.querySelector<HTMLElement>('.kickflow-pinned-message');
    const firstId = firstBanner?.dataset.pinId;

    fillPin(fixture.inner, 'BotRix', 'first pin');
    await flushMutations();
    expect(host.querySelector('.kickflow-pinned-message')).toBe(firstBanner);
    expect(host.querySelector<HTMLElement>('.kickflow-pinned-message')?.dataset.pinId).toBe(firstId);

    host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__dismiss')?.click();
    expect(host.childElementCount).toBe(0);
    fillPin(fixture.inner, 'BotRix', 'first pin');
    await flushMutations();
    expect(host.childElementCount).toBe(0);

    fillPin(fixture.inner, 'BotRix', 'second pin');
    await flushMutations();
    const secondBanner = host.querySelector<HTMLElement>('.kickflow-pinned-message');
    expect(secondBanner?.dataset.pinId).not.toBe(firstId);
    expect(secondBanner?.classList.contains('kickflow-pinned-message--collapsed')).toBe(false);

    host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__collapse')?.click();
    const collapsedBanner = host.querySelector<HTMLElement>('.kickflow-pinned-message');
    expect(collapsedBanner?.classList.contains('kickflow-pinned-message--collapsed')).toBe(true);
    fillPin(fixture.inner, 'BotRix', 'second pin');
    await flushMutations();
    expect(host.querySelector('.kickflow-pinned-message')).toBe(collapsedBanner);

    fillPin(fixture.inner, 'BotRix', 'third pin');
    await flushMutations();
    expect(host.textContent).toContain('third pin');
    expect(host.querySelector('.kickflow-pinned-message--collapsed')).toBeNull();

    lifecycle.dispose();
  });

  it('preserves text expansion through eye-collapse and resets it for a different mirrored pin', async () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('kickflow-pinned-message__body-content') ? 36 : 0;
    });
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('kickflow-pinned-message__body-content') ? 72 : 0;
    });
    try {
      featureFlags.showPinnedMessage = true;
      const fixture = createFixture();
      fillPin(fixture.inner, 'BotRix', 'first long pin '.repeat(30));
      const { lifecycle, host } = createMirror(fixture);
      await flushMutations();

      host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__text-toggle')?.click();
      await flushMutations();
      expect(host.querySelector('.kickflow-pinned-message__body--text-expanded')).not.toBeNull();
      expect(host.querySelector('.kickflow-pinned-message__text-toggle')?.getAttribute('aria-expanded')).toBe('true');

      host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__collapse')?.click();
      expect(host.querySelector('.kickflow-pinned-message--collapsed')).not.toBeNull();
      host.querySelector<HTMLElement>('.kickflow-pinned-message--collapsed')?.click();
      await flushMutations();
      expect(host.querySelector('.kickflow-pinned-message__body--text-expanded')).not.toBeNull();
      expect(host.querySelector('.kickflow-pinned-message__text-toggle')?.getAttribute('aria-expanded')).toBe('true');

      fillPin(fixture.inner, 'BotRix', 'different long pin '.repeat(30));
      await flushMutations();
      expect(host.querySelector('.kickflow-pinned-message__body--text-collapsed')).not.toBeNull();
      expect(host.querySelector('.kickflow-pinned-message__body--text-expanded')).toBeNull();
      expect(host.querySelector('.kickflow-pinned-message__text-toggle')?.getAttribute('aria-expanded')).toBe('false');
      lifecycle.dispose();
    } finally {
      clientHeight.mockRestore();
      scrollHeight.mockRestore();
    }
  });

  it('normalizes whitespace for identity and updates same-id actor presentation without resetting identity', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'white   space');
    const { lifecycle, host } = createMirror(fixture);
    const firstBanner = host.querySelector<HTMLElement>('.kickflow-pinned-message');
    const firstId = firstBanner?.dataset.pinId;

    fillPin(fixture.inner, 'BotRix', 'white space');
    await flushMutations();
    expect(host.querySelector('.kickflow-pinned-message')).toBe(firstBanner);
    expect(host.querySelector<HTMLElement>('.kickflow-pinned-message')?.dataset.pinId).toBe(firstId);

    fillPin(fixture.inner, 'BOTRIX', 'white space');
    await flushMutations();
    expect(host.querySelector<HTMLElement>('.kickflow-pinned-message')?.dataset.pinId).toBe(firstId);
    expect(host.querySelector('.kickflow-pinned-message__actor')?.textContent).toBe('BOTRIX sabitledi');

    lifecycle.dispose();
  });

  it('treats a changed link destination or emote identity as a new pin', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const card = fillPin(fixture.inner, 'BotRix', 'same visible label');
    const nativeLink = card.querySelector<HTMLAnchorElement>('.native-rendered-content a');
    if (nativeLink) {
      nativeLink.textContent = 'same link label';
      nativeLink.href = 'https://example.com/first';
    }
    const { lifecycle, host } = createMirror(fixture);
    const firstId = host.querySelector<HTMLElement>('.kickflow-pinned-message')?.dataset.pinId;
    host.querySelector<HTMLButtonElement>('.kickflow-pinned-message__dismiss')?.click();
    expect(host.childElementCount).toBe(0);

    if (nativeLink) nativeLink.href = 'https://example.com/second';
    await flushMutations();
    const linkChangedBanner = host.querySelector<HTMLElement>('.kickflow-pinned-message');
    expect(linkChangedBanner?.dataset.pinId).not.toBe(firstId);
    expect(host.textContent).toContain('same link label');

    linkChangedBanner?.querySelector<HTMLButtonElement>('.kickflow-pinned-message__collapse')?.click();
    expect(host.querySelector('.kickflow-pinned-message--collapsed')).not.toBeNull();
    const emote = card.querySelector<HTMLImageElement>('.native-rendered-content img');
    if (emote) emote.alt = 'CHANGED_EMOTE';
    await flushMutations();
    expect(host.querySelector('.kickflow-pinned-message--collapsed')).toBeNull();
    expect(host.querySelector<HTMLImageElement>('.kickflow-pinned-message__content img')?.alt).toBe('CHANGED_EMOTE');

    lifecycle.dispose();
  });

  it('mirrors emote-only, link-only, long, and rapidly churned final pins', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    const { lifecycle, host } = createMirror(fixture);

    const emoteCard = fillPin(fixture.inner, 'BotRix', 'temporary');
    const emoteContent = emoteCard.querySelector<HTMLElement>('.native-rendered-content');
    const emote = document.createElement('img');
    emote.src = 'https://files.kick.com/emotes/789/fullsize';
    emote.alt = 'EMOTE_ONLY';
    emoteContent?.replaceChildren(emote);
    await flushMutations();
    expect(host.querySelector<HTMLImageElement>('.kickflow-pinned-message__content img')?.alt).toBe('EMOTE_ONLY');

    const linkCard = fillPin(fixture.inner, 'BotRix', 'temporary');
    const linkContent = linkCard.querySelector<HTMLElement>('.native-rendered-content');
    const link = document.createElement('a');
    link.href = 'https://example.com/link-only';
    link.textContent = 'https://example.com/link-only';
    linkContent?.replaceChildren(link);
    await flushMutations();
    expect(host.querySelector<HTMLAnchorElement>('.kickflow-pinned-message__content a')?.href).toBe('https://example.com/link-only');

    const longMessage = 'x'.repeat(20_000);
    fillPin(fixture.inner, 'BotRix', longMessage);
    await flushMutations();
    expect(host.querySelector('.kickflow-pinned-message__content')?.textContent).toContain(longMessage);

    fillPin(fixture.inner, 'BotRix', 'churn one');
    fillPin(fixture.inner, 'BotRix', 'churn two');
    fillPin(fixture.inner, 'BotRix', 'churn final');
    await flushMutations();
    expect(host.textContent).toContain('churn final');
    expect(host.textContent).not.toContain('churn one');

    lifecycle.dispose();
  });

  it('keeps native hidden while the flag is off and immediately re-renders the retained pin when enabled', () => {
    featureFlags.showPinnedMessage = false;
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'toggle pin');
    const { lifecycle, host, controller } = createMirror(fixture);

    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(host.childElementCount).toBe(0);

    featureFlags.showPinnedMessage = true;
    controller.refresh();
    expect(host.textContent).toContain('toggle pin');
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    featureFlags.showPinnedMessage = false;
    controller.refresh();
    expect(host.childElementCount).toBe(0);
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    lifecycle.dispose();
  });

  it('removes the marker, clears the banner, and disconnects observers on teardown', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'before teardown');
    const { lifecycle, host } = createMirror(fixture);
    expect(host.childElementCount).toBe(1);

    lifecycle.dispose();
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(host.childElementCount).toBe(0);

    fillPin(fixture.inner, 'BotRix', 'after teardown');
    await flushMutations();
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(host.childElementCount).toBe(0);
  });

  it('moves the marker and mirror state when Kick swaps the message-list parent', async () => {
    featureFlags.showPinnedMessage = true;
    const first = createFixture();
    fillPin(first.inner, 'BotRix', 'first parent');
    const { lifecycle, host } = createMirror(first);

    const second = createFixture();
    fillPin(second.inner, 'BotRix', 'second parent');
    first.parent.remove();
    await flushMutations();

    expect(first.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(second.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(host.textContent).toContain('second parent');

    lifecycle.dispose();
  });

  it('binds after an asynchronous mount without a second presence observer', async () => {
    featureFlags.showPinnedMessage = true;
    const lifecycle = new Lifecycle();
    activeLifecycles.add(lifecycle);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = bootstrap.createPinnedMessageController(host);
    new NativePinMirror(lifecycle, controller);

    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'mounted later');
    await flushMutations();

    expect(host.textContent).toContain('mounted later');
    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(true);

    lifecycle.dispose();
  });

  it('does not re-run the document-wide lookup for ordinary busy-chat row churn', async () => {
    featureFlags.showPinnedMessage = true;
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'stable while chat is busy');
    const lookupSpy = vi.spyOn(document, 'querySelectorAll');
    const { lifecycle, host } = createMirror(fixture);
    await flushMutations();
    lookupSpy.mockClear();

    for (let index = 0; index < 250; index += 1) {
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.textContent = `message ${index}`;
      fixture.messages.appendChild(row);
    }
    await flushMutations();

    const structuralLookups = lookupSpy.mock.calls.filter(([selector]) => selector === '[id="chatroom-messages"]');
    expect(structuralLookups).toHaveLength(0);
    expect(host.textContent).toContain('stable while chat is busy');

    lookupSpy.mockRestore();
    lifecycle.dispose();
  });

  it('does not mark or mirror the native pin when bootstrap initializes native chat mode', async () => {
    featureFlags.chatMode = 'native';
    const fixture = createFixture();
    fillPin(fixture.inner, 'BotRix', 'native mode pin');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const lifecycle = new Lifecycle();
    activeLifecycles.add(lifecycle);

    bootstrap.initChatIntegrity('channel', lifecycle);
    await flushMutations();

    expect(fixture.overlay.hasAttribute(NATIVE_PIN_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(document.getElementById('kickflow-pinned-message-host')).toBeNull();

    lifecycle.dispose();
    fetchMock.mockRestore();
  });
});
