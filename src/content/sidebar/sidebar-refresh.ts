import { logger } from '../shared/logger';
import type { Lifecycle } from '../shared/lifecycle';

export const SIDEBAR_CHANNEL_ROW_SELECTOR = [
  'a[data-testid^="sidebar-following-channel-"]',
  'a[data-testid^="sidebar-recommended-channel-"]',
].join(', ');
const VIEWER_COUNT_SELECTOR = 'span[title]';
const LIVE_DOT_SELECTOR = 'div.rounded-full.h-2.w-2';
const REFRESH_INTERVAL_MS = 45_000;
const REQUEST_STAGGER_MS = 250;
const OBSERVER_DEBOUNCE_MS = 150;
const REQUEST_MAX_ATTEMPTS = 3;
const REQUEST_RETRY_BASE_MS = 800;
const CHANNEL_SLUG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const UUID_LIKE_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

interface SidebarChannelData {
  isLive: boolean;
  viewerCount: number;
}

interface ChannelResponse {
  livestream?: { is_live?: boolean; viewer_count?: number } | null;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function getSidebarChannelSlug(row: HTMLAnchorElement): string | null {
  const href = row.getAttribute('href')?.trim();
  if (!href) return null;
  const match = href.match(/^\/?([^/?#]+)\/?(?:[?#].*)?$/);
  const slug = match?.[1];
  if (!slug || !CHANNEL_SLUG_PATTERN.test(slug) || UUID_LIKE_PATTERN.test(slug)) return null;
  return slug;
}

export function formatViewerCount(viewerCount: number): string {
  return viewerCount < 1000 ? String(viewerCount) : `${Math.round(viewerCount / 1000)}\u00a0B`;
}

/** Keeps Kick's React-owned followed/recommended channel rows fresh without replacing their DOM. */
export class SidebarRefreshController {
  private readonly cache = new Map<string, SidebarChannelData>();
  private readonly notFoundSlugs = new Set<string>();
  private readonly observer = new MutationObserver(() => this.scheduleCachedReapply());
  private observerTimer: number | null = null;
  private refreshInProgress = false;
  private refreshQueued = false;
  private activeRefreshSlugs = new Set<string>();
  private disposed = false;

  constructor(lifecycle: Lifecycle, enabled = true) {
    if (!enabled) {
      this.disposed = true;
      lifecycle.add(() => this.dispose());
      return;
    }
    this.syncObserverRoots(this.discoverRows());
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
      this.syncObserverRoots(rows);
      const rowsBySlug = new Map<string, HTMLAnchorElement[]>();
      for (const row of rows) {
        const slug = getSidebarChannelSlug(row);
        if (!slug || this.notFoundSlugs.has(slug)) continue;
        const matchingRows = rowsBySlug.get(slug);
        if (matchingRows) matchingRows.push(row);
        else rowsBySlug.set(slug, [row]);
      }
      this.activeRefreshSlugs = new Set(rowsBySlug.keys());

      let index = 0;
      for (const [slug, matchingRows] of rowsBySlug) {
        if (this.disposed) return;
        if (index > 0) await this.delay(REQUEST_STAGGER_MS);
        if (this.disposed) return;
        await this.refreshSlug(slug, matchingRows);
        index++;
      }
    } finally {
      this.activeRefreshSlugs.clear();
      this.refreshInProgress = false;
      if (this.refreshQueued && !this.disposed) {
        this.refreshQueued = false;
        void this.runRefresh();
      }
    }
  }

  private discoverRows(): HTMLAnchorElement[] {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>(SIDEBAR_CHANNEL_ROW_SELECTOR));
  }

  private syncObserverRoots(rows: HTMLAnchorElement[]): void {
    const roots = new Set<HTMLElement>();
    for (const row of rows) roots.add(row.closest('section') ?? row.parentElement ?? document.body);
    if (roots.size === 0) roots.add(document.body);
    this.observer.disconnect();
    for (const root of roots) this.observer.observe(root, { childList: true, subtree: true });
  }

  private async refreshSlug(slug: string, rows: HTMLAnchorElement[]): Promise<void> {
    try {
      const data = await this.fetchChannel(slug);
      if (!data || this.disposed) return;
      this.cache.set(slug, data);
      for (const row of rows) this.patchRow(row, data);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) this.notFoundSlugs.add(slug);
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
        lastError = new HttpStatusError(response.status);
        if (response.status !== 429 && response.status < 500) throw lastError;
      } catch (error) {
        lastError = error;
        if (error instanceof HttpStatusError && error.status !== 429 && error.status < 500) throw error;
      }
      if (attempt < REQUEST_MAX_ATTEMPTS - 1) await this.delay(REQUEST_RETRY_BASE_MS * 2 ** attempt);
    }
    throw lastError;
  }

  private patchRow(row: HTMLAnchorElement, data: SidebarChannelData): void {
    const count = row.querySelector<HTMLElement>(VIEWER_COUNT_SELECTOR);
    if (count) {
      const title = String(data.viewerCount);
      const formatted = formatViewerCount(data.viewerCount);
      // textContent replaces a text node and therefore emits childList mutations even when the
      // value is unchanged. Idempotent writes keep our observer's cached-reapply pass from
      // scheduling itself forever every 150ms.
      if (count.title !== title) count.title = title;
      if (count.textContent !== formatted) count.textContent = formatted;
    }
    const dot = row.querySelector<HTMLElement>(LIVE_DOT_SELECTOR);
    const live = String(data.isLive);
    if (dot?.getAttribute('data-kickflow-live') !== live) dot?.setAttribute('data-kickflow-live', live);
  }

  private scheduleCachedReapply(): void {
    if (this.disposed) return;
    if (this.observerTimer !== null) window.clearTimeout(this.observerTimer);
    this.observerTimer = window.setTimeout(() => {
      this.observerTimer = null;
      const rows = this.discoverRows();
      this.syncObserverRoots(rows);
      let hasUncachedSlug = false;
      for (const row of rows) {
        const slug = getSidebarChannelSlug(row);
        const data = slug ? this.cache.get(slug) : undefined;
        if (data) this.patchRow(row, data);
        else if (slug && !this.notFoundSlugs.has(slug) && !this.activeRefreshSlugs.has(slug)) {
          hasUncachedSlug = true;
        }
      }
      if (hasUncachedSlug) void this.refresh();
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
