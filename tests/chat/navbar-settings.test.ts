import { afterEach, describe, expect, it } from 'vitest';
import { NavbarSettingsButton, findNavbarRightCluster, type NavbarSettingsPanel } from '../../src/content/chat/navbar-settings';
import type { Lifecycle } from '../../src/content/shared/lifecycle';

class FakeLifecycle implements Pick<Lifecycle, 'add' | 'setInterval'> {
  readonly disposers: Array<() => void> = [];
  readonly intervals: Array<() => void> = [];

  add(disposer: () => void): void { this.disposers.push(disposer); }
  setInterval(handler: () => void): void { this.intervals.push(handler); }
  tick(): void { for (const handler of this.intervals) handler(); }
  dispose(): void {
    let disposer: (() => void) | undefined;
    while ((disposer = this.disposers.pop())) disposer();
  }
}

class FakePanel implements NavbarSettingsPanel {
  open = false;
  showCalls = 0;
  showSettings(): void { this.open = true; this.showCalls++; }
  isOpen(): boolean { return this.open; }
}

function installNavbar(): HTMLDivElement {
  document.body.innerHTML = `
    <nav class="relative top-0 z-[402] flex h-[--navbar-height] items-center justify-between gap-0 bg-surface-lowest pl-3 pr-10">
      <div class="flex grow-0 items-center gap-2.5"><button>menu</button></div>
      <div class="flex grow items-center justify-center"><input /></div>
      <div class="flex items-center gap-2"><button id="gift">gift</button><button>avatar</button></div>
    </nav>
  `;
  return document.querySelector('nav')!.children[2] as HTMLDivElement;
}

afterEach(() => document.body.replaceChildren());

describe('navbar settings button', () => {
  it('anchors to the third direct navbar div and inserts as its first child', () => {
    const cluster = installNavbar();
    const lifecycle = new FakeLifecycle();
    new NavbarSettingsButton(lifecycle as unknown as Lifecycle, new FakePanel());

    expect(findNavbarRightCluster()).toBe(cluster);
    expect(cluster.firstElementChild?.id).toBe('kickflow-navbar-settings');
    expect(cluster.children[1].id).toBe('gift');
  });

  it('opens the existing shared settings panel and exposes an accessible icon-only mark', () => {
    installNavbar();
    const lifecycle = new FakeLifecycle();
    const panel = new FakePanel();
    new NavbarSettingsButton(lifecycle as unknown as Lifecycle, panel);
    const button = document.getElementById('kickflow-navbar-settings') as HTMLButtonElement;

    button.click();

    expect(panel.showCalls).toBe(1);
    expect(button.textContent).toBe('K');
    expect(button.getAttribute('aria-label')).toContain('KickFlow');
    expect(button.classList.contains('kickflow-navbar-settings--active')).toBe(true);
  });

  it('quietly retries a missing anchor and self-heals after React removes the button', () => {
    const lifecycle = new FakeLifecycle();
    new NavbarSettingsButton(lifecycle as unknown as Lifecycle, new FakePanel());
    expect(document.getElementById('kickflow-navbar-settings')).toBeNull();

    installNavbar();
    lifecycle.tick();
    expect(document.getElementById('kickflow-navbar-settings')).not.toBeNull();

    document.getElementById('kickflow-navbar-settings')?.remove();
    lifecycle.tick();
    expect(document.getElementById('kickflow-navbar-settings')).not.toBeNull();

    lifecycle.dispose();
    expect(document.getElementById('kickflow-navbar-settings')).toBeNull();
  });
});
