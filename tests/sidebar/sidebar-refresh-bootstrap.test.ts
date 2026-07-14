import { afterEach, describe, expect, it, vi } from 'vitest';

type BootstrapModule = typeof import('../../src/content/bootstrap');

function sidebarRow(index = 7, slug = 'naru'): string {
  return `
    <section>
      <a class="flex h-11 w-full flex-row items-center gap-2 rounded px-1.5"
        data-testid="sidebar-following-channel-${index}" data-state="false" href="/${slug}">
        <div class="relative size-7 shrink-0 rounded-full">
          <img alt="Naru" class="h-full w-full overflow-hidden rounded-full" src="...">
        </div>
        <div class="flex w-full gap-1 overflow-hidden">
          <div class="flex min-w-0 max-w-full shrink grow flex-col gap-0.5">
            <span class="shrink truncate text-sm font-bold leading-[1.2]">Naru</span>
            <span class="text-subtle truncate text-xs font-bold leading-normal">League of Legends</span>
          </div>
          <div class="flex w-fit shrink-0 flex-nowrap items-center gap-x-1 self-start text-white">
            <div class="h-2 w-2 rounded-full bg-gray-500"></div>
            <span class="text-sm font-semibold"><span title="0">0</span></span>
          </div>
        </div>
      </a>
    </section>`;
}

function channelResponse(viewerCount: number, isLive = true): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ livestream: { is_live: isLive, viewer_count: viewerCount } }),
  } as Response;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function stubExtension(saved: Record<string, unknown> = {}): void {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'kickflow-sidebar-test',
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue(saved),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
}

async function loadBootstrap(path: string, saved: Record<string, unknown> = {}): Promise<BootstrapModule> {
  vi.resetModules();
  window.history.replaceState({}, '', path);
  document.body.innerHTML = sidebarRow();
  stubExtension(saved);
  const bootstrap = await import('../../src/content/bootstrap');
  await flush();
  return bootstrap;
}

afterEach(async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    Object.defineProperty(chrome.runtime, 'id', { configurable: true, value: undefined });
    window.dispatchEvent(new Event('kickflow:locationchange'));
    await flush();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.getElementById('kickflow-styles')?.remove();
});

describe('site-wide sidebar bootstrap', () => {
  it.each(['/', '/following'])('starts and patches on the non-channel route %s', async (path) => {
    vi.spyOn(window, 'setInterval').mockReturnValue(1);
    const fetchMock = vi.fn().mockResolvedValue(channelResponse(1416));
    vi.stubGlobal('fetch', fetchMock);

    await loadBootstrap(path);

    const row = document.querySelector<HTMLAnchorElement>('a[data-testid="sidebar-following-channel-7"]');
    expect(row?.querySelector('span[title]')?.getAttribute('title')).toBe('1416');
    expect(row?.querySelector('span[title]')?.textContent).toBe('1\u00a0B');
    expect(row?.querySelector('[data-kickflow-live]')?.getAttribute('data-kickflow-live')).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const styleText = document.getElementById('kickflow-styles')?.textContent ?? '';
    expect(styleText).toContain('a[data-testid^="sidebar-following-channel-"] div.rounded-full.h-2.w-2[data-kickflow-live="true"]');
    expect(styleText).not.toMatch(/^\s*div\.rounded-full\.h-2\.w-2\[data-kickflow-live=/mu);
  });

  it('reversibly hides an offline live-list row without removing Kick-owned DOM', async () => {
    vi.spyOn(window, 'setInterval').mockReturnValue(1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(channelResponse(0, false)));

    await loadBootstrap('/');

    const row = document.querySelector<HTMLAnchorElement>('a[data-testid="sidebar-following-channel-7"]')!;
    expect(row.isConnected).toBe(true);
    expect(row.getAttribute('data-kickflow-live')).toBe('false');
    expect(getComputedStyle(row).display).toBe('none');
  });

  it('keeps the controller off initially, then recreates it across enable, disable, and enable', async () => {
    vi.spyOn(window, 'setInterval').mockReturnValue(1);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(channelResponse(500))
      .mockResolvedValueOnce(channelResponse(900));
    vi.stubGlobal('fetch', fetchMock);
    const bootstrap = await loadBootstrap('/', { kf_flag_showSidebarRefresh: false });
    const row = document.querySelector<HTMLAnchorElement>('a[data-testid="sidebar-following-channel-7"]')!;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(row.querySelector('span[title]')?.textContent).toBe('0');

    bootstrap.applyFlagChange('showSidebarRefresh', true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(row.querySelector('span[title]')?.textContent).toBe('500');

    bootstrap.applyFlagChange('showSidebarRefresh', false);
    row.querySelector('span[title]')!.textContent = 'native';
    row.querySelector('span[title]')!.setAttribute('title', '1');
    row.querySelector('[data-kickflow-live]')?.removeAttribute('data-kickflow-live');
    await flush();
    expect(row.querySelector('span[title]')?.textContent).toBe('native');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    bootstrap.applyFlagChange('showSidebarRefresh', true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(row.querySelector('span[title]')?.textContent).toBe('900');
    expect(row.querySelector('[data-kickflow-live]')?.getAttribute('data-kickflow-live')).toBe('true');
  });
});
