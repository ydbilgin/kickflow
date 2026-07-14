import { afterEach, describe, expect, it } from 'vitest';
import { FooterToggleButton, type FooterTogglePanel } from '../../src/content/chat/footer-toggle';
import type { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeLifecycle implements Pick<Lifecycle, 'add' | 'setInterval' | 'isDisposed'> {
  readonly disposers: Array<() => void> = [];
  readonly intervals: Array<{ handler: () => void; intervalMs: number }> = [];
  readonly isDisposed = false;

  add(disposer: () => void): void {
    this.disposers.push(disposer);
  }

  setInterval(handler: () => void, intervalMs: number): void {
    this.intervals.push({ handler, intervalMs });
  }

  /** Runs every registered disposer, mirroring the real Lifecycle.dispose() LIFO order. */
  dispose(): void {
    let disposer: (() => void) | undefined;
    while ((disposer = this.disposers.pop())) disposer();
  }

  /** Fires every registered 1s ensure-tick, same as the real Lifecycle's window.setInterval would. */
  tick(): void {
    for (const { handler } of this.intervals) handler();
  }
}

class FakePanel implements FooterTogglePanel {
  open = false;
  count = 0;
  toggleCalls = 0;
  lastSection: 'removed' | undefined;

  toggle(section?: 'removed'): void {
    this.toggleCalls++;
    this.lastSection = section;
    this.open = !this.open;
  }

  isOpen(): boolean {
    return this.open;
  }

  removedCount(): number {
    return this.count;
  }
}

function installSendButton(): HTMLElement {
  document.body.innerHTML = `
    <div id="chatroom-footer">
      <div class="ml-auto flex items-center gap-x-2">
        <button id="some-gear-button" type="button">gear</button>
        <button id="send-message-button" type="button">Gönder</button>
      </div>
    </div>
  `;
  return document.getElementById('send-message-button')!;
}

describe('FooterToggleButton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('injects #kickflow-footer-toggle before send-message-button\'s previous sibling', () => {
    installSendButton();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, new FakePanel());

    const button = document.getElementById('kickflow-footer-toggle');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');

    const cluster = document.querySelector('.ml-auto');
    const children = Array.from(cluster?.children ?? []);
    // Lands before the gear button (send's previousElementSibling), i.e. first in the cluster.
    expect(children[0]).toBe(button);
  });

  it('does nothing (no throw, no button) when #send-message-button is not present yet', () => {
    document.body.innerHTML = '<div id="chatroom-footer"></div>';
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, new FakePanel());

    expect(document.getElementById('kickflow-footer-toggle')).toBeNull();
  });

  it('clicking the button targets the removed section through panel.toggle()', () => {
    installSendButton();
    const panel = new FakePanel();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, panel);

    const button = document.getElementById('kickflow-footer-toggle') as HTMLButtonElement;
    button.click();

    expect(panel.toggleCalls).toBe(1);
    expect(panel.lastSection).toBe('removed');
    expect(panel.open).toBe(true);
  });

  it('--active reflects panel.isOpen(), updated on click', () => {
    installSendButton();
    const panel = new FakePanel();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, panel);

    const button = document.getElementById('kickflow-footer-toggle') as HTMLButtonElement;
    expect(button.classList.contains('kickflow-footer-toggle--active')).toBe(false);

    button.click(); // panel.open -> true
    expect(button.classList.contains('kickflow-footer-toggle--active')).toBe(true);

    button.click(); // panel.open -> false
    expect(button.classList.contains('kickflow-footer-toggle--active')).toBe(false);
  });

  it('--active also updates on the 1s tick (panel closed via its own ×, not our click)', () => {
    installSendButton();
    const panel = new FakePanel();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, panel);

    const button = document.getElementById('kickflow-footer-toggle') as HTMLButtonElement;
    panel.open = true; // simulate the panel opening itself, bypassing our click handler
    expect(button.classList.contains('kickflow-footer-toggle--active')).toBe(false);

    lifecycle.tick();

    expect(button.classList.contains('kickflow-footer-toggle--active')).toBe(true);
  });

  it('the badge shows removedCount() when > 0 and hides at 0, updated on the 1s tick', () => {
    installSendButton();
    const panel = new FakePanel();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, panel);

    const badge = document.querySelector<HTMLElement>('.kickflow-footer-toggle__badge')!;
    expect(badge.style.display).toBe('none');

    panel.count = 3;
    lifecycle.tick();
    expect(badge.style.display).not.toBe('none');
    expect(badge.textContent).toBe('3');

    panel.count = 0;
    lifecycle.tick();
    expect(badge.style.display).toBe('none');
  });

  it('re-injects the button if React (or a channel switch) removes it from the DOM — driven by the 1s ensure tick', () => {
    installSendButton();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, new FakePanel());

    document.getElementById('kickflow-footer-toggle')?.remove();
    expect(document.getElementById('kickflow-footer-toggle')).toBeNull();

    lifecycle.tick();

    expect(document.getElementById('kickflow-footer-toggle')).not.toBeNull();
  });

  it('re-injects after the whole footer (including send-message-button) remounts on channel change', () => {
    installSendButton();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, new FakePanel());

    // Simulate Kick tearing down and remounting the entire footer with a fresh send button.
    installSendButton();
    expect(document.getElementById('kickflow-footer-toggle')).toBeNull();

    lifecycle.tick();

    expect(document.getElementById('kickflow-footer-toggle')).not.toBeNull();
  });

  it('dispose removes the button from the DOM', () => {
    installSendButton();
    const lifecycle = new FakeLifecycle();
    new FooterToggleButton(lifecycle as unknown as Lifecycle, new FakePanel());
    expect(document.getElementById('kickflow-footer-toggle')).not.toBeNull();

    lifecycle.dispose();

    expect(document.getElementById('kickflow-footer-toggle')).toBeNull();
  });
});
