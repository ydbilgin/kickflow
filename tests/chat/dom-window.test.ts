import { describe, expect, it, vi } from 'vitest';
import {
  MAX_NON_PRESERVED_NODES,
  MAX_NON_PRESERVED_NODES_PAUSED,
  decideScrollFollow,
  trimMessageWindow,
} from '../../src/content/chat/dom-window';
import { MESSAGE_CLASS, PRESERVED_CLASS } from '../../src/content/chat/message-view';
import { ChatDomRegistry } from '../../src/content/chat/message-store';

function buildContainer(nonPreservedCount: number, preservedCount = 0): HTMLElement {
  const container = document.createElement('div');
  for (let i = 0; i < preservedCount; i++) {
    const node = document.createElement('div');
    node.className = `${MESSAGE_CLASS} ${PRESERVED_CLASS}`;
    container.appendChild(node);
  }
  for (let i = 0; i < nonPreservedCount; i++) {
    const node = document.createElement('div');
    node.className = MESSAGE_CLASS;
    container.appendChild(node);
  }
  return container;
}

describe('decideScrollFollow', () => {
  // Literal caps on purpose (not the imported constants) so this test actually catches
  // someone silently changing 200 -> X or 600 -> Y instead of just mirroring the source.
  it('pinned to bottom: snaps to bottom, normal trim cap, no pill', () => {
    expect(decideScrollFollow(true, 5)).toEqual({
      scrollToBottom: true,
      trimCap: 200,
      showPill: false,
    });
  });

  it('paused (scrolled up) with rows appended: no snap, paused trim cap, shows pill', () => {
    expect(decideScrollFollow(false, 5)).toEqual({
      scrollToBottom: false,
      trimCap: 600,
      showPill: true,
    });
  });

  it('paused with no rows appended: no pill', () => {
    expect(decideScrollFollow(false, 0).showPill).toBe(false);
  });
});

describe('cap constants', () => {
  it('MAX_NON_PRESERVED_NODES is 200 and MAX_NON_PRESERVED_NODES_PAUSED is 600', () => {
    expect(MAX_NON_PRESERVED_NODES).toBe(200);
    expect(MAX_NON_PRESERVED_NODES_PAUSED).toBe(600);
  });
});

describe('trimMessageWindow', () => {
  it('trims non-preserved nodes down to the default cap', () => {
    const container = buildContainer(MAX_NON_PRESERVED_NODES + 50);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry);

    expect(container.querySelectorAll(`.${MESSAGE_CLASS}`)).toHaveLength(MAX_NON_PRESERVED_NODES);
  });

  it('trims down to a custom cap', () => {
    const container = buildContainer(20);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry, 5);

    expect(container.querySelectorAll(`.${MESSAGE_CLASS}`)).toHaveLength(5);
  });

  it('never trims preserved nodes, even under a low custom cap', () => {
    const container = buildContainer(20, 10);
    const registry = new ChatDomRegistry();

    trimMessageWindow(container, registry, 5);

    expect(container.querySelectorAll(`.${PRESERVED_CLASS}`)).toHaveLength(10);
    expect(container.querySelectorAll(`.${MESSAGE_CLASS}:not(.${PRESERVED_CLASS})`)).toHaveLength(5);
  });

  it('calls registry.forget for each removed node', () => {
    const container = buildContainer(20);
    const registry = new ChatDomRegistry();
    const forgetSpy = vi.spyOn(registry, 'forget');

    trimMessageWindow(container, registry, 5);

    expect(forgetSpy).toHaveBeenCalledTimes(15);
  });
});
