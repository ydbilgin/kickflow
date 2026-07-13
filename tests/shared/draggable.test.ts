import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDraggable } from '../../src/content/shared/draggable';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('makeDraggable', () => {
  it('removes active document drag listeners when its disposer runs mid-drag', () => {
    const element = document.createElement('section');
    const handle = document.createElement('header');
    element.append(handle);
    document.body.append(element);
    Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 50 });
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 60, width: 100, height: 50,
      toJSON: () => ({}),
    });
    const dispose = makeDraggable(element, handle);

    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 70 }));
    expect(element.style.left).toBe('50px');
    expect(element.style.top).toBe('60px');

    dispose();
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 170 }));
    expect(element.style.left).toBe('50px');
    expect(element.style.top).toBe('60px');
  });
});
