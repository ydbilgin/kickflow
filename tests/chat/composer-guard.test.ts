import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatOverlayMount } from '../../src/content/chat/overlay-mount';
import { Lifecycle } from '../../src/content/shared/lifecycle';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('kickflow-chat-active');
  vi.unstubAllGlobals();
});

function fixture(composer: HTMLElement) {
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
  const anchor = document.createElement('div');
  anchor.id = 'chatroom-messages';
  anchor.getBoundingClientRect = () => new DOMRect(10, 20, 398, 500);
  anchor.append(composer);
  document.body.append(anchor);
  const lifecycle = new Lifecycle();
  const mount = new ChatOverlayMount(lifecycle);
  mount.setPrimaryReady();
  return { lifecycle, mount };
}

describe('composer moved inside native message anchor', () => {
  it.each(['send button', 'textarea', 'contenteditable', 'plaintext-only editor'])('keeps native chat visible when its anchor contains a %s', kind => {
    const composer = document.createElement(kind === 'textarea' ? 'textarea' : kind === 'send button' ? 'button' : 'div');
    if (kind === 'send button') composer.id = 'send-message-button';
    if (kind === 'contenteditable') composer.setAttribute('contenteditable', 'true');
    if (kind === 'plaintext-only editor') composer.setAttribute('contenteditable', 'plaintext-only');
    const { lifecycle, mount } = fixture(composer);
    try {
      expect(document.documentElement.classList.contains('kickflow-chat-active')).toBe(false);
      expect(mount.state).toBe('fallback');
      expect(mount.root.style.display).toBe('none');
    } finally { lifecycle.dispose(); }
  });

  it('still takes over ordinary non-editable message content', () => {
    const row = document.createElement('div');
    row.setAttribute('contenteditable', 'false');
    const { lifecycle, mount } = fixture(row);
    try { expect(mount.state).toBe('active'); }
    finally { lifecycle.dispose(); }
  });
});
