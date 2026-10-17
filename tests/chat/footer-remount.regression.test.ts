import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FooterToggleButton } from '../../src/content/chat/footer-toggle';
import { Lifecycle } from '../../src/content/shared/lifecycle';

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
    expect(button.parentElement).toBe(second.parent);
    expect(button.nextElementSibling).toBe(second.gear);
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
});
