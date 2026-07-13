import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatViewerCount, getSidebarChannelSlug, SidebarRefreshController } from '../../src/content/sidebar/sidebar-refresh';
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { logger } from '../../src/content/shared/logger';

const jahreinRow = `
  <section>
    <button><a class="flex h-11 w-full flex-row items-center gap-2 rounded px-1.5" data-testid="sidebar-following-channel-1" data-state="false" href="/jahrein">
      <div class="relative size-7 shrink-0 rounded-full"><img alt="Jahrein" class="h-full w-full overflow-hidden rounded-full" src="..."></div>
      <div class="flex w-full gap-1 overflow-hidden"><div class="flex min-w-0 max-w-full shrink grow flex-col gap-0.5"><span class="shrink truncate text-sm font-bold leading-[1.2]">Jahrein</span><span class="text-subtle truncate text-xs font-bold leading-normal">Sadece Sohbet</span></div><div class="flex w-fit shrink-0 flex-nowrap items-center gap-x-1 self-start text-white"><div class="h-2 w-2 rounded-full bg-green-500"></div><span class="text-sm font-semibold"><span title="11002">11&nbsp;B</span></span></div></div>
    </a></button>
  </section>`;

function response(isLive = true, viewerCount = 2275): Response {
  return { ok: true, status: 200, json: async () => ({ livestream: { is_live: isLive, viewer_count: viewerCount } }) } as Response;
}

function mount(rows = 1): HTMLAnchorElement[] {
  document.body.innerHTML = jahreinRow;
  const section = document.querySelector('section') as HTMLElement;
  for (let index = 2; index <= rows; index++) {
    const copy = section.querySelector('a')!.cloneNode(true) as HTMLAnchorElement;
    copy.dataset.testid = `sidebar-following-channel-${index}`;
    copy.href = `/channel-${index}`;
    section.append(copy);
  }
  return Array.from(document.querySelectorAll('a'));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('sidebar refresh', () => {
  it('extracts a channel slug from the native following row href', () => {
    const [row] = mount();
    expect(getSidebarChannelSlug(row)).toBe('jahrein');
  });

  it('rejects UUID-like and non-channel hrefs before fetching', async () => {
    vi.useFakeTimers();
    const [uuidRow, normalRow] = mount(2);
    uuidRow.setAttribute('href', '/e2209b9b4e164395a4e6b22bf321a0b6');
    normalRow.setAttribute('href', '/normal_slug-2');
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);

    await flush();
    await vi.advanceTimersByTimeAsync(250);

    expect(getSidebarChannelSlug(uuidRow)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://kick.com/api/v2/channels/normal_slug-2', {
      headers: { accept: 'application/json' },
    });
    normalRow.setAttribute('href', '/categories/games');
    expect(getSidebarChannelSlug(normalRow)).toBeNull();
    lifecycle.dispose();
  });

  it('patches the native viewer count and live indicator after a successful fetch', async () => {
    const [row] = mount();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(true, 2275)));
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();

    expect(row.querySelector('span[title]')?.getAttribute('title')).toBe('2275');
    expect(row.querySelector('span[title]')?.textContent).toBe('2\u00a0B');
    expect(row.querySelector('div.rounded-full.h-2.w-2')?.getAttribute('data-kickflow-live')).toBe('true');
    lifecycle.dispose();
  });

  it('leaves native values unchanged and does not retry or re-warn a 404 row', async () => {
    vi.useFakeTimers();
    const [row] = mount();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();

    expect(row.querySelector('span[title]')?.getAttribute('title')).toBe('11002');
    expect(row.querySelector('span[title]')?.textContent).toBe('11\u00a0B');
    expect(warn).toHaveBeenCalledWith('sidebar-refresh: failed to refresh', 'jahrein', expect.any(Error));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('stages requests and refreshes again on the periodic interval', async () => {
    vi.useFakeTimers();
    mount(2);
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    lifecycle.dispose();
  });

  it('runs an additional refresh when the document becomes visible', async () => {
    mount();
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });

  it('reapplies cached data after React replaces a row without fetching again', async () => {
    vi.useFakeTimers();
    const [row] = mount();
    const fetchMock = vi.fn().mockResolvedValue(response(false, 500));
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();
    const replacement = row.cloneNode(true) as HTMLAnchorElement;
    replacement.querySelector('span[title]')!.textContent = 'eski';
    replacement.querySelector('span[title]')!.setAttribute('title', '1');
    row.replaceWith(replacement);
    await flush();
    await vi.advanceTimersByTimeAsync(150);

    expect(replacement.querySelector('span[title]')?.textContent).toBe('500');
    expect(replacement.querySelector('div.rounded-full.h-2.w-2')?.getAttribute('data-kickflow-live')).toBe('false');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('does not let its own cached DOM patch create a perpetual observer loop', async () => {
    vi.useFakeTimers();
    mount();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 500)));
    const timeout = vi.spyOn(window, 'setTimeout');
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle);
    await flush();

    await vi.advanceTimersByTimeAsync(1000);

    // One observer debounce follows the initial changed text node; the idempotent cached pass
    // does not mutate it again and schedule another.
    expect(timeout).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  it('does no work while disabled', () => {
    vi.useFakeTimers();
    mount();
    const fetchMock = vi.fn();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new Lifecycle();
    new SidebarRefreshController(lifecycle, false);
    vi.advanceTimersByTime(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    lifecycle.dispose();
  });

  it('formats the observed count shapes', () => {
    expect(formatViewerCount(11_002)).toBe('11\u00a0B');
    expect(formatViewerCount(500)).toBe('500');
  });
});
