import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FooterToggleButton } from '../../src/content/chat/footer-toggle';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { NavbarSettingsButton } from '../../src/content/chat/navbar-settings';

let lifecycle: Lifecycle;
beforeEach(() => { vi.useFakeTimers(); lifecycle = new Lifecycle(); });
afterEach(() => {
  lifecycle.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();
});
function footer(disabled = false) {
  const parent = document.createElement('div');
  const gear = document.createElement('button');
  const send = document.createElement('button');
  send.id = 'send-message-button'; send.disabled = disabled;
  parent.append(gear, send); document.body.append(parent);
  return { parent, gear, send };
}
function panel() { return { toggle: vi.fn(), isOpen: () => false, removedCount: () => 2 }; }

describe('footer follows the current native send control', () => {
  it('moves the same working button out of a stale connected footer during slow mode', () => {
    const first = footer();
    const controller = panel();
    new FooterToggleButton(lifecycle, controller);
    const button = document.getElementById('kickflow-footer-toggle') as HTMLButtonElement;
    first.send.remove();
    first.parent.hidden = true;
    const second = footer(true);
    vi.advanceTimersByTime(1000);
    expect(button.parentElement).toBe(document.body);
    expect([...second.parent.children]).toEqual([second.gear, second.send]);
    expect(second.send.disabled).toBe(true);
    button.click();
    expect(controller.toggle).toHaveBeenCalledWith('removed');
    expect(document.querySelectorAll('#kickflow-footer-toggle')).toHaveLength(1);
  });
  it('does not reinsert a correctly positioned button every tick', () => {
    const native = footer();
    new FooterToggleButton(lifecycle, panel());
    const insert = vi.spyOn(native.parent, 'insertBefore');
    vi.advanceTimersByTime(3000);
    expect(insert).not.toHaveBeenCalled();
  });
  it('does not adopt or remove a foreign element with the same ID', () => {
    const foreign = document.createElement('span');
    foreign.id = 'kickflow-footer-toggle'; document.body.append(foreign);
    const native = footer();
    new FooterToggleButton(lifecycle, panel());
    vi.advanceTimersByTime(1000);
    expect(foreign.parentElement).toBe(document.body);
    expect(native.parent.contains(foreign)).toBe(false);
    lifecycle.dispose();
    expect(foreign.isConnected).toBe(true);
  });

  it('preserves SSR footer children and text before hydration, across ticks, and on disposal', () => {
    const native = footer();
    native.gear.textContent = 'Native settings'; native.send.textContent = 'Send';
    const snapshot = native.parent.innerHTML;
    const send = vi.fn(); native.send.addEventListener('click', send);
    new FooterToggleButton(lifecycle, panel());
    expect(native.parent.innerHTML).toBe(snapshot);
    expect([...native.parent.children]).toEqual([native.gear, native.send]);
    expect(document.getElementById('kickflow-footer-toggle')?.parentElement).toBe(document.body);
    vi.advanceTimersByTime(3000);
    expect(native.parent.innerHTML).toBe(snapshot);
    native.send.click(); expect(send).toHaveBeenCalledOnce();
    lifecycle.dispose(); expect(native.parent.innerHTML).toBe(snapshot);
  });

  it('preserves SSR navbar children and keeps one working control through native remounts', () => {
    document.body.innerHTML = '<nav><div></div><div></div><div class="flex items-center gap-2"><button>Account</button></div></nav>';
    const cluster = document.querySelector('nav')!.children[2];
    const snapshot = cluster.innerHTML;
    const controller = {showSettings: vi.fn(), isOpen: () => false};
    new NavbarSettingsButton(lifecycle, controller);
    expect(cluster.innerHTML).toBe(snapshot);
    const button = document.getElementById('kickflow-navbar-settings') as HTMLButtonElement;
    expect(button.parentElement).toBe(document.body);
    const replacement = cluster.cloneNode(true) as HTMLElement;
    cluster.replaceWith(replacement); vi.advanceTimersByTime(1000);
    expect(replacement.innerHTML).toBe(snapshot);
    expect(document.getElementById('kickflow-navbar-settings')).toBe(button);
    button.click(); expect(controller.showSettings).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#kickflow-navbar-settings')).toHaveLength(1);
    document.querySelector('nav')!.remove(); vi.advanceTimersByTime(1000);
    expect(button.isConnected).toBe(false);
  });

  it('aligns with the footer slot after resize, hides a hidden anchor and releases viewport listeners', () => {
    const native = footer();
    let left = 200;
    vi.spyOn(native.parent, 'getBoundingClientRect').mockImplementation(() => ({left, top: 700, width: 120, height: 36} as DOMRect));
    new FooterToggleButton(lifecycle, panel());
    const button = document.getElementById('kickflow-footer-toggle') as HTMLButtonElement;
    expect(button.style.left).toBe('200px'); expect(button.style.top).toBe('703px');
    left = 100; window.dispatchEvent(new Event('resize'));
    expect(button.style.left).toBe('100px');
    native.parent.hidden = true; window.dispatchEvent(new Event('scroll'));
    expect(button.style.display).toBe('none');
    native.parent.hidden = false; window.dispatchEvent(new Event('resize'));
    expect(button.style.display).toBe('');
    lifecycle.dispose(); window.dispatchEvent(new Event('resize'));
    expect(document.getElementById('kickflow-footer-toggle')).toBeNull();
  });
});
