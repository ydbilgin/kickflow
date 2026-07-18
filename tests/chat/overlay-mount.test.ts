import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount, resolveNativeEventStackGeometry } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { setLang } from '../../src/content/shared/i18n';

class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  static trigger(target: Element): void {
    for (const observer of FakeResizeObserver.instances) {
      if (!observer.observed.has(target)) continue;
      observer.callback([{ target } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    }
  }

  static reset(): void {
    FakeResizeObserver.instances.length = 0;
  }
}

class FakeMutationObserver {
  static readonly instances: FakeMutationObserver[] = [];
  readonly observations: Array<{ target: Node; options: MutationObserverInit }> = [];

  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }

  observe(target: Node, options: MutationObserverInit = {}): void {
    this.observations.push({ target, options });
  }

  disconnect(): void {
    this.observations.length = 0;
  }

  takeRecords(): MutationRecord[] {
    return [];
  }

  static triggerChildList(target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []): void {
    const record = {
      type: 'childList',
      target,
      addedNodes,
      removedNodes,
    } as unknown as MutationRecord;
    for (const observer of FakeMutationObserver.instances) {
      const matches = observer.observations.some((observation) =>
        observation.options.childList === true
        && (observation.target === target
          || (observation.options.subtree === true && observation.target.contains(target))),
      );
      if (matches) observer.callback([record], observer as unknown as MutationObserver);
    }
  }

  static reset(): void {
    FakeMutationObserver.instances.length = 0;
  }
}

function rect(width = 320, height = 480, left = 10, top = 20): DOMRect {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function addAnchor(width = 320, height = 480): HTMLElement {
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(width, height));
  document.body.append(anchor);
  return anchor;
}

interface CapturedChatFixture {
  parent: HTMLElement;
  anchor: HTMLElement;
  pin: HTMLElement | null;
}

interface CapturedEventStackFixture {
  parent: HTMLElement;
  anchor: HTMLElement;
  eventStack: HTMLElement;
}

function createNativeEvent(kind: 'pin' | 'poll-voting' | 'poll-results'): HTMLElement {
  if (kind === 'pin') {
    const pin = document.createElement('aside');
    pin.dataset.nativeEvent = 'pin';
    pin.append(document.createElement('button'));
    return pin;
  }

  const poll = document.createElement('section');
  poll.dataset.nativeEvent = kind;
  poll.setAttribute('aria-label', kind === 'poll-voting' ? 'Native poll voting card' : 'Native poll results card');
  const title = document.createElement('h3');
  title.textContent = 'Which map next?';
  poll.append(title);
  for (const label of ['Arena', 'Ruins']) {
    const choice = document.createElement('button');
    choice.dataset.pollChoice = label.toLowerCase();
    choice.textContent = kind === 'poll-voting' ? label : `${label} results`;
    poll.append(choice);
  }
  if (kind === 'poll-voting') {
    const vote = document.createElement('button');
    vote.dataset.pollAction = 'vote';
    vote.textContent = 'Vote';
    poll.append(vote);
  }
  const remove = document.createElement('button');
  remove.dataset.pollAction = 'delete';
  remove.textContent = 'Delete poll';
  poll.append(remove);
  return poll;
}

function addCapturedEventStackFixture(
  anchorRect: DOMRect,
  getStackRect: () => DOMRect,
  events: ReadonlyArray<'pin' | 'poll-voting' | 'poll-results'>,
): CapturedEventStackFixture {
  const parent = document.createElement('section');
  parent.className = 'relative flex min-h-0 flex-1 flex-col';
  const eventStack = document.createElement('div');
  eventStack.className = 'absolute w-full empty:hidden';
  eventStack.dataset.nativeSurface = 'chatroom-event-stack';
  eventStack.append(...events.map(createNativeEvent));
  vi.spyOn(eventStack, 'getBoundingClientRect').mockImplementation(getStackRect);
  parent.append(eventStack);

  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(anchorRect);
  parent.append(anchor);
  document.body.append(parent);
  return { parent, anchor, eventStack };
}

function addCapturedChatFixture(
  anchorRect: DOMRect = rect(),
  getPinRect?: () => DOMRect,
): CapturedChatFixture {
  const parent = document.createElement('section');
  parent.className = 'relative flex min-h-0 flex-1 flex-col';
  let pin: HTMLElement | null = null;
  if (getPinRect) {
    pin = document.createElement('div');
    pin.className = 'absolute w-full empty:hidden';
    const control = document.createElement('button');
    vi.spyOn(control, 'getBoundingClientRect').mockImplementation(getPinRect);
    pin.append(control);
    vi.spyOn(pin, 'getBoundingClientRect').mockImplementation(getPinRect);
    parent.append(pin);
  }

  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(anchorRect);
  parent.append(anchor);
  document.body.append(parent);
  return { parent, anchor, pin };
}

function addOwnRow(mount: ChatOverlayMount, id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kickflow-message';
  row.dataset.messageId = id;
  row.textContent = id;
  mount.ownList.append(row);
  return row;
}

describe('ChatOverlayMount takeover readiness', () => {
  beforeEach(() => {
    setLang('tr');
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    document.documentElement.classList.remove('kickflow-chat-active');
    FakeResizeObserver.reset();
    FakeMutationObserver.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.classList.remove('kickflow-chat-active');
    FakeResizeObserver.reset();
    FakeMutationObserver.reset();
  });

  it('uses the full captured anchor rectangle when there is no native pin', () => {
    addCapturedChatFixture(rect(320, 480, 10, 20));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.left).toBe('10px');
    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.width).toBe('320px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('mirrors native chat typography and timestamp tokens onto the body-level overlay', () => {
    const { anchor } = addCapturedChatFixture(rect(320, 480, 10, 20));
    anchor.style.setProperty('--chatroom-font-size', '14px');
    anchor.style.setProperty('--chatroom-timestamps-display', 'none');
    anchor.style.setProperty('--chatroom-message-spacing', '4px');
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.getPropertyValue('--chatroom-font-size')).toBe('14px');
    expect(mount.root.style.getPropertyValue('--chatroom-timestamps-display')).toBe('none');
    expect(mount.root.style.getPropertyValue('--chatroom-message-spacing')).toBe('4px');

    anchor.style.setProperty('--chatroom-font-size', '16px');
    anchor.style.setProperty('--chatroom-timestamps-display', 'inline');
    anchor.style.setProperty('--chatroom-message-spacing', '5px');
    mount.syncNow();
    expect(mount.root.style.getPropertyValue('--chatroom-font-size')).toBe('16px');
    expect(mount.root.style.getPropertyValue('--chatroom-timestamps-display')).toBe('inline');
    expect(mount.root.style.getPropertyValue('--chatroom-message-spacing')).toBe('5px');
    lifecycle.dispose();
  });

  it('reserves an initial visible native pin top band', () => {
    addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 84, 10, 20));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('104px');
    expect(mount.root.style.height).toBe('396px');
    lifecycle.dispose();
  });

  it('reserves the event-stack container for a native poll voting card', () => {
    const { anchor, eventStack } = addCapturedEventStackFixture(
      rect(320, 480, 10, 20),
      () => rect(320, 210, 10, 20),
      ['poll-voting'],
    );
    expect(resolveNativeEventStackGeometry(anchor)).toMatchObject({
      status: 'valid',
      eventStack,
      ownRect: { top: 230, height: 270 },
    });
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('230px');
    expect(mount.root.style.height).toBe('270px');
    lifecycle.dispose();
  });

  it('recomputes when a native poll expands from voting to taller results', () => {
    let stackRect = rect(320, 210, 10, 20);
    const { eventStack } = addCapturedEventStackFixture(
      rect(320, 480, 10, 20),
      () => stackRect,
      ['poll-voting'],
    );
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    expect(mount.root.style.top).toBe('230px');

    eventStack.replaceChildren(createNativeEvent('poll-results'));
    stackRect = rect(320, 276, 10, 20);
    FakeResizeObserver.trigger(eventStack);

    expect(mount.root.style.top).toBe('296px');
    expect(mount.root.style.height).toBe('204px');
    lifecycle.dispose();
  });

  it('reserves the union height of a single event stack containing a pin and poll', () => {
    addCapturedEventStackFixture(
      rect(320, 480, 10, 20),
      () => rect(320, 294, 10, 20),
      ['pin', 'poll-voting'],
    );
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('314px');
    expect(mount.root.style.height).toBe('186px');
    lifecycle.dispose();
  });

  it('removes the whole reserved band when a poll ends and the event stack empties', () => {
    let stackRect = rect(320, 210, 10, 20);
    const { eventStack } = addCapturedEventStackFixture(
      rect(320, 480, 10, 20),
      () => stackRect,
      ['poll-voting'],
    );
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    expect(mount.root.style.top).toBe('230px');

    const removed = Array.from(eventStack.childNodes);
    eventStack.replaceChildren();
    stackRect = rect(0, 0, 10, 20);
    FakeMutationObserver.triggerChildList(eventStack, [], removed);

    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('reserves a native pin when Kick populates its existing empty shell in place', () => {
    const { parent, anchor } = addCapturedChatFixture(rect(320, 480, 10, 20));
    let pinRect = rect(0, 0, 10, 20);
    const pin = document.createElement('div');
    pin.className = 'absolute w-full empty:hidden';
    vi.spyOn(pin, 'getBoundingClientRect').mockImplementation(() => pinRect);
    parent.insertBefore(pin, anchor);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();
    expect(mount.root.style.top).toBe('20px');

    const control = document.createElement('button');
    pinRect = rect(320, 84, 10, 20);
    vi.spyOn(control, 'getBoundingClientRect').mockImplementation(() => pinRect);
    pin.append(control);
    FakeMutationObserver.triggerChildList(pin, [control]);

    expect(mount.root.style.top).toBe('104px');
    expect(mount.root.style.height).toBe('396px');
    expect(mount.state).toBe('active');
    lifecycle.dispose();
  });

  it('recomputes the reserved band for native expand and collapse ResizeObserver changes', () => {
    let pinRect = rect(320, 54, 10, 20);
    const { pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => pinRect);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('74px');
    expect(mount.root.style.height).toBe('426px');
    pinRect = rect(320, 132, 10, 20);
    FakeResizeObserver.trigger(pin!);
    expect(mount.root.style.top).toBe('152px');
    expect(mount.root.style.height).toBe('348px');
    pinRect = rect(320, 42, 10, 20);
    FakeResizeObserver.trigger(pin!);
    expect(mount.root.style.top).toBe('62px');
    expect(mount.root.style.height).toBe('438px');
    lifecycle.dispose();
  });

  it('restores the full anchor rectangle after native unpin removal', () => {
    const { parent, pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 84, 10, 20));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    expect(mount.root.style.top).toBe('104px');

    pin!.remove();
    FakeMutationObserver.triggerChildList(parent, [], [pin!]);

    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('restores the full anchor rectangle when Kick empties the native pin surface in place', () => {
    let pinRect = rect(320, 84, 10, 20);
    const { pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => pinRect);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    expect(mount.root.style.top).toBe('104px');

    const removed = Array.from(pin!.childNodes);
    pinRect = rect(0, 0, 10, 20);
    pin!.replaceChildren();
    FakeMutationObserver.triggerChildList(pin!, [], removed);

    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('tracks a same-parent native pin replacement without touching message data', () => {
    const { parent, anchor, pin } = addCapturedChatFixture(
      rect(320, 480, 10, 20),
      () => rect(320, 60, 10, 20),
    );
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    expect(mount.root.style.top).toBe('80px');

    const replacement = document.createElement('div');
    replacement.className = 'absolute w-full empty:hidden';
    replacement.append(document.createElement('button'));
    vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(rect(320, 110, 10, 20));
    pin!.remove();
    parent.insertBefore(replacement, anchor);
    FakeMutationObserver.triggerChildList(parent, [replacement], [pin!]);

    expect(mount.root.style.top).toBe('130px');
    expect(mount.root.style.height).toBe('370px');
    lifecycle.dispose();
  });

  it('ignores an unrelated absolute full-width sibling outside the anchor top edge', () => {
    addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 40, 10, 180));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('ignores an unrelated absolute sibling that is not the full-width event stack', () => {
    const { parent, anchor } = addCapturedChatFixture(rect(320, 480, 10, 20));
    const unrelated = document.createElement('div');
    unrelated.className = 'absolute right-0';
    vi.spyOn(unrelated, 'getBoundingClientRect').mockReturnValue(rect(100, 120, 230, 20));
    parent.insertBefore(unrelated, anchor);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);

    expect(mount.root.style.top).toBe('20px');
    expect(mount.root.style.height).toBe('480px');
    lifecycle.dispose();
  });

  it('fails open when a native pin leaves zero own-list height', () => {
    addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 480, 10, 20));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'no-space');
    mount.noteContentAppended([row]);

    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    lifecycle.dispose();
  });

  it('fails open for ambiguous or horizontally non-contiguous top-edge pin coverage', () => {
    const ambiguous = addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 50, 10, 20));
    const secondPin = document.createElement('div');
    secondPin.className = 'absolute w-full empty:hidden';
    secondPin.append(document.createElement('button'));
    vi.spyOn(secondPin, 'getBoundingClientRect').mockReturnValue(rect(320, 70, 10, 20));
    ambiguous.parent.insertBefore(secondPin, ambiguous.anchor);
    const ambiguousLifecycle = new Lifecycle();
    const ambiguousMount = new ChatOverlayMount(ambiguousLifecycle);
    ambiguousMount.setProbing();
    ambiguousMount.setPrimaryReady();
    expect(ambiguousMount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    ambiguousLifecycle.dispose();

    document.body.replaceChildren();
    const partial = addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(160, 70, 10, 20));
    const partialLifecycle = new Lifecycle();
    const partialMount = new ChatOverlayMount(partialLifecycle);
    partialMount.setProbing();
    partialMount.setPrimaryReady();
    expect(partial.pin).not.toBeNull();
    expect(partialMount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    partialLifecycle.dispose();
  });

  it('keeps the body root and pointer-active descendants below native pin controls', () => {
    const { pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => rect(320, 90, 10, 20));
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();

    expect(mount.root.style.pointerEvents).toBe('auto');
    expect(Number.parseFloat(mount.root.style.top)).toBeGreaterThanOrEqual(pin!.getBoundingClientRect().bottom);
    expect(Number.parseFloat(mount.root.style.top)).toBeGreaterThanOrEqual(pin!.querySelector('button')!.getBoundingClientRect().bottom);
    lifecycle.dispose();
  });

  it('keeps the body root and pointer-active descendants below native poll controls', () => {
    const stackRect = rect(320, 220, 10, 20);
    const { eventStack } = addCapturedEventStackFixture(
      rect(320, 480, 10, 20),
      () => stackRect,
      ['poll-voting'],
    );
    for (const control of eventStack.querySelectorAll<HTMLElement>('button')) {
      vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(rect(280, 36, 30, 180));
    }
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();

    expect(mount.root.style.pointerEvents).toBe('auto');
    expect(Number.parseFloat(mount.root.style.top)).toBeGreaterThanOrEqual(stackRect.bottom);
    for (const control of eventStack.querySelectorAll<HTMLElement>('button')) {
      expect(Number.parseFloat(mount.root.style.top)).toBeGreaterThanOrEqual(control.getBoundingClientRect().bottom);
    }
    lifecycle.dispose();
  });

  it('never activates takeover from native pin presence, resize, or replacement', () => {
    let pinRect = rect(320, 54, 10, 20);
    const { parent, anchor, pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => pinRect);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    pinRect = rect(320, 100, 10, 20);
    FakeResizeObserver.trigger(pin!);
    const replacement = document.createElement('div');
    replacement.className = 'absolute w-full empty:hidden';
    replacement.append(document.createElement('button'));
    vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(rect(320, 70, 10, 20));
    pin!.remove();
    parent.insertBefore(replacement, anchor);
    FakeMutationObserver.triggerChildList(parent, [replacement], [pin!]);

    expect(mount.state).toBe('probing');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    lifecycle.dispose();
  });

  it('does not let a pin-only resize reacquire takeover from fallback readiness', () => {
    let pinRect = rect(320, 54, 10, 20);
    const { pin } = addCapturedChatFixture(rect(320, 480, 10, 20), () => pinRect);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    mount.failOpen('test-fallback');

    pinRect = rect(320, 100, 10, 20);
    FakeResizeObserver.trigger(pin!);

    expect(mount.root.style.top).toBe('120px');
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    lifecycle.dispose();
  });

  it('does not activate from a row appended to an off-document root', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.root.remove();
    const row = addOwnRow(mount, 'off-document');
    mount.noteContentAppended([row]);

    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.state).not.toBe('active');
    lifecycle.dispose();
  });

  it('repairs a removed own list without leaving a broken active class', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'ready');
    mount.noteContentAppended([row]);
    expect(mount.state).toBe('active');

    mount.ownList.remove();
    mount.syncNow();

    expect(mount.ownList.parentElement).toBe(mount.root);
    expect(mount.ownList.isConnected).toBe(true);
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('selects the visible duplicate anchor instead of the first hidden zero-sized match', () => {
    const hidden = addAnchor(0, 0);
    hidden.style.display = 'none';
    const visible = addAnchor(360, 500);
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'visible-anchor');
    mount.noteContentAppended([row]);

    expect(mount.selectedAnchor).toBe(visible);
    expect(mount.state).toBe('active');
    expect(mount.root.style.width).toBe('360px');
    lifecycle.dispose();
  });

  it('fails open across an anchor gap and reactivates only when readiness can be re-proven', () => {
    const anchor = addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'survives-gap');
    mount.noteContentAppended([row]);
    expect(mount.state).toBe('active');

    anchor.remove();
    mount.syncNow();
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    const replacement = addAnchor(400, 520);
    mount.syncNow();
    expect(mount.selectedAnchor).toBe(replacement);
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('activates a legitimate empty chat only with primary readiness and a visible status row', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.setPrimaryReady();

    expect(mount.state).toBe('active');
    expect(mount.ownList.querySelector('[data-kickflow-chat-status]')?.textContent).toContain('Bağlandı');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('fails open at the initial no-content deadline and can recover on later primary readiness', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    mount.initialNoContentDeadline();

    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('keeps rows plus a reconnecting status during grace, then fails open and recovers', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'existing-row');
    mount.noteContentAppended([row]);
    mount.setReconnecting();

    expect(mount.state).toBe('active');
    expect(mount.ownList.querySelector('[data-kickflow-chat-status]')?.textContent).toContain('Yeniden');
    mount.setPrimaryUnavailable('grace-expired');
    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);

    mount.setPrimaryReady();
    expect(mount.state).toBe('active');
    expect(mount.assertActiveInvariant()).toBe(true);
    lifecycle.dispose();
  });

  it('does not reuse stale row readiness after the final visible row is removed', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    mount.setProbing();
    const row = addOwnRow(mount, 'last-row');
    mount.noteContentAppended([row]);
    row.remove();
    mount.syncNow();

    expect(mount.state).toBe('fallback');
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    lifecycle.dispose();
  });

  it('enforces the direct active-class invariant and fails open when content is absent', () => {
    addAnchor();
    const lifecycle = new Lifecycle();
    const mount = new ChatOverlayMount(lifecycle);
    document.documentElement.classList.add('kickflow-chat-active');
    mount.root.style.display = '';
    mount.ownList.style.display = '';

    expect(mount.assertActiveInvariant()).toBe(false);
    expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
    expect(mount.state).toBe('fallback');
    lifecycle.dispose();
  });

  it('leaves one invariant-safe overlay after rapid own/native/own plus channel replacement', () => {
    addAnchor();
    const firstLifecycle = new Lifecycle();
    const first = new ChatOverlayMount(firstLifecycle);
    first.setProbing();
    const firstRow = addOwnRow(first, 'first-channel');
    first.noteContentAppended([firstRow]);

    firstLifecycle.dispose();
    const nativeLifecycle = new Lifecycle();
    nativeLifecycle.dispose();
    const secondLifecycle = new Lifecycle();
    const second = new ChatOverlayMount(secondLifecycle);
    second.setProbing();
    second.setPrimaryReady();

    expect(document.querySelectorAll('[id="kickflow-chat-overlay"]')).toHaveLength(1);
    expect(second.assertActiveInvariant()).toBe(true);
    secondLifecycle.dispose();
  });
});
