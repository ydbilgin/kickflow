import { logger } from '../shared/logger';
import type { Lifecycle } from '../shared/lifecycle';

const ROW_SELECTOR = 'a[data-testid^="sidebar-following-channel-"]';
const VIEWER_COUNT_SELECTOR = 'span[title]';
const LIVE_DOT_SELECTOR = 'div.rounded-full.h-2.w-2';
const REFRESH_INTERVAL_MS = 45_000;
const REQUEST_STAGGER_MS = 250;
const OBSERVER_DEBOUNCE_MS = 150;
const REQUEST_MAX_ATTEMPTS = 3;
const REQUEST_RETRY_BASE_MS = 800;

interface SidebarChannelData {
  isLive: boolean;
  viewerCount: number;
}

interface ChannelResponse {
  livestream?: { is_live?: boolean; viewer_count?: number } | null;
}

export function getSidebarChannelSlug(row: HTMLAnchorElement): string | null {
  const href = row.getAttribute('href');
  if (!href) return null;
  const slug = href.replace(/^\/+/, '');
  return slug || null;
}

export function formatViewerCount(viewerCount: number): string {
  return viewerCount < 1000 ? String(viewerCount) : `${Math.round(viewerCount / 1000)}\u00a0B`;
}

/** Keeps Kick's React-owned followed-channel rows fresh without replacing their DOM. */
export class SidebarRefreshController {
  private readonly cache = new Map<string, SidebarChannelData>();
  private readonly observer = new MutationObserver(() => this.scheduleCachedReapply());
  private observerTimer: number | null = null;
  private refreshInProgress = false;
  private refreshQueued = false;
  private disposed = false;

  constructor(lifecycle: Lifecycle, enabled = true) {
    if (!enabled) {
      this.disposed = true;
      lifecycle.add(() => this.dispose());
      return;
    }
    const firstRow = this.discoverRows()[0];
    this.observer.observe(firstRow?.closest('section') ?? document.body, { childList: true, subtree: true });
    lifecycle.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    lifecycle.addEventListener(document, 'visibilitychange', this.handleVisibilityChange);
    lifecycle.add(() => this.dispose());
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshInProgress) {
      this.refreshQueued = true;
      return Promise.resolve();
    }
    return this.runRefresh();
  }

  private async runRefresh(): Promise<void> {
    this.refreshInProgress = true;
    try {
      const rows = this.discoverRows();
      for (let index = 0; index < rows.length; index++) {
        if (this.disposed) return;
        if (index > 0) await this.delay(REQUEST_STAGGER_MS);
        if (this.disposed) return;
        await this.refreshRow(rows[index]);
      }
    } finally {
      this.refreshInProgress = false;
      if (this.refreshQueued && !this.disposed) {
        this.refreshQueued = false;
        void this.runRefresh();
      }
    }
  }

  private discoverRows(): HTMLAnchorElement[] {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>(ROW_SELECTOR));
  }

  private async refreshRow(row: HTMLAnchorElement): Promise<void> {
    const slug = getSidebarChannelSlug(row);
    if (!slug) return;
    try {
      const data = await this.fetchChannel(slug);
      if (!data || this.disposed) return;
      this.cache.set(slug, data);
      this.patchRow(row, data);
    } catch (error) {
      logger.warn('sidebar-refresh: failed to refresh', slug, error);
    }
  }

  private async fetchChannel(slug: string): Promise<SidebarChannelData> {
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
    let lastError: unknown = new Error('request failed');
    for (let attempt = 0; attempt < REQUEST_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (response.ok) {
          const json = (await response.json()) as ChannelResponse;
          if (!json.livestream) return { isLive: false, viewerCount: 0 };
          if (typeof json.livestream.is_live !== 'boolean' || typeof json.livestream.viewer_count !== 'number') {
            throw new Error('invalid channel response');
          }
          return { isLive: json.livestream.is_live, viewerCount: json.livestream.viewer_count };
        }
        lastError = new Error(`HTTP ${response.status}`);
        if (response.status !== 429 && response.status < 500) throw lastError;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && /^HTTP [1-4](?!29)/.test(error.message)) throw error;
      }
      if (attempt < REQUEST_MAX_ATTEMPTS - 1) await this.delay(REQUEST_RETRY_BASE_MS * 2 ** attempt);
    }
    throw lastError;
  }

  private patchRow(row: HTMLAnchorElement, data: SidebarChannelData): void {
    const count = row.querySelector<HTMLElement>(VIEWER_COUNT_SELECTOR);
    if (count) {
      count.title = String(data.viewerCount);
      count.textContent = formatViewerCount(data.viewerCount);
    }
    row.querySelector<HTMLElement>(LIVE_DOT_SELECTOR)?.setAttribute('data-kickflow-live', String(data.isLive));
  }

  private scheduleCachedReapply(): void {
    if (this.disposed) return;
    if (this.observerTimer !== null) window.clearTimeout(this.observerTimer);
    this.observerTimer = window.setTimeout(() => {
      this.observerTimer = null;
      for (const row of this.discoverRows()) {
        const slug = getSidebarChannelSlug(row);
        const data = slug ? this.cache.get(slug) : undefined;
        if (data) this.patchRow(row, data);
      }
    }, OBSERVER_DEBOUNCE_MS);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    if (this.observerTimer !== null) window.clearTimeout(this.observerTimer);
  }
}
