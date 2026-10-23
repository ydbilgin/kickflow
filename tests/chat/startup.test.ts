import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleChatStartup } from '../../src/content/chat/overlay-mount';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });
describe('step 4: first startup trigger wins', () => {
  it('starts immediately when the chat column exists before page load', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    document.body.innerHTML = '<div id="chatroom-messages"></div>';
    const start = vi.fn(); const cancel = scheduleChatStartup(start);
    expect(start).toHaveBeenCalledOnce(); cancel();
  });
  it('starts on the chat-column mutation without waiting for load', async () => {
    vi.useFakeTimers(); vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const start = vi.fn(); const cancel = scheduleChatStartup(start);
    document.body.innerHTML = '<div id="chatroom-messages"></div>';
    await Promise.resolve(); expect(start).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('load')); vi.advanceTimersByTime(3000);
    expect(start).toHaveBeenCalledOnce(); cancel();
  });
  it('caps a page with no load event at 3 seconds', () => {
    vi.useFakeTimers(); vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const start = vi.fn(); const cancel = scheduleChatStartup(start);
    vi.advanceTimersByTime(2999); expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(start).toHaveBeenCalledOnce(); cancel();
  });
  it('starts at page load and disposes the deadline', () => {
    vi.useFakeTimers(); vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const start = vi.fn(); const cancel = scheduleChatStartup(start);
    window.dispatchEvent(new Event('load')); vi.advanceTimersByTime(3000);
    expect(start).toHaveBeenCalledOnce(); cancel();
  });
});
