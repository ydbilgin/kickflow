import { logger } from '../shared/logger';
import type { Lifecycle } from '../shared/lifecycle';

export const SIDEBAR_CHANNEL_ROW_SELECTOR = [
  'a[data-testid^="sidebar-following-channel-"]',
  'a[data-testid^="sidebar-recommended-channel-"]',
].join(', ');
const VIEWER_COUNT_SELECTOR = 'span[title]';
const LIVE_DOT_SELECTOR = 'div.rounded-full.h-2.w-2';
// Keep each 45s pass below the burst that appeared when recommended rows were added.
// Followed rows get most of the budget; both tiers rotate independently across passes.
export const SIDEBAR_REFRESH_POLICY = {
  refreshIntervalMs: 45_000,
  requestStaggerMs: 1_000,
  followedPerCycle: 6,
  recommendedPerCycle: 2,
  requestMaxAttempts: 3,
  requestRetryBaseMs: 2_000,
} as const;
const OBSERVER_DEBOUNCE_MS = 150;
const CHANNEL_SLUG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const UUID_LIKE_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

interface SidebarChannelData {
  isLive: boolean;
  viewerCount: number;
}

interface ChannelResponse {
  livestream?: { is_live?: boolean; viewer_count?: number } | null;
}

interface RefreshEntry {
  slug: string;
  rows: HTMLAnchorElement[];
  followed: boolean;
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
  private readonly knownSlugs = new Set<string>();
  private followedCursor = 0;
  private recommendedCursor = 0;
  private disposed = false;

  constructor(lifecycle: Lifecycle, enabled = true) {
    if (!enabled) {
      this.disposed = true;
      lifecycle.add(() => this.dispose());
      return;
    }
    this.syncObserverRoots(this.discoverRows());
    lifecycle.setInterval(() => void this.refresh(), SIDEBAR_REFRESH_POLICY.refreshIntervalMs);
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
      const entriesBySlug = new Map<string, RefreshEntry>();
      for (const row of rows) {
        const slug = getSidebarChannelSlug(row);
        if (!slug || this.notFoundSlugs.has(slug)) continue;
        this.knownSlugs.add(slug);
        const followed = row.dataset.testid?.startsWith('sidebar-following-channel-') ?? false;
        const entry = entriesBySlug.get(slug);
        if (entry) {
          entry.rows.push(row);
          entry.followed ||= followed;
        } else {
          entriesBySlug.set(slug, { slug, rows: [row], followed });
        }
      }

      const entries = Array.from(entriesBySlug.values());
      const selectedEntries = [
        ...this.takeCycleEntries(
          entries.filter((entry) => entry.followed),
          SIDEBAR_REFRESH_POLICY.followedPerCycle,
          'followed',
        ),
        ...this.takeCycleEntries(
          entries.filter((entry) => !entry.followed),
          SIDEBAR_REFRESH_POLICY.recommendedPerCycle,
          'recommended',
        ),
      ];
      this.activeRefreshSlugs = new Set(selectedEntries.map((entry) => entry.slug));

      let index = 0;
      for (const { slug, rows: matchingRows } of selectedEntries) {
        if (this.disposed) return;
        if (index > 0) await this.delay(SIDEBAR_REFRESH_POLICY.requestStaggerMs);
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

  private takeCycleEntries(
    entries: RefreshEntry[],
    limit: number,
    tier: 'followed' | 'recommended',
  ): RefreshEntry[] {
    if (entries.length === 0) return [];
    const cursor = tier === 'followed' ? this.followedCursor : this.recommendedCursor;
    const start = cursor % entries.length;
    const count = Math.min(limit, entries.length);
    const selected = Array.from({ length: count }, (_, offset) => entries[(start + offset) % entries.length]);
    const nextCursor = (start + count) % entries.length;
    if (tier === 'followed') this.followedCursor = nextCursor;
    else this.recommendedCursor = nextCursor;
    return selected;
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
      if (error instanceof HttpStatusError && error.status === 404) {
        this.notFoundSlugs.add(slug);
        logger.warn('sidebar-refresh: failed to refresh', slug, error);
      } else if (error instanceof TypeError) {
        // Fetch rejects with TypeError for connection/WAF failures. The cached native value is
        // still usable, so an exhausted transient miss is diagnostic noise rather than a warning.
        logger.debug('sidebar-refresh: transient network failure', slug, error);
      } else {
        logger.warn('sidebar-refresh: failed to refresh', slug, error);
      }
    }
  }

  private async fetchChannel(slug: string): Promise<SidebarChannelData> {
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
    let lastError: unknown = new Error('request failed');
    for (let attempt = 0; attempt < SIDEBAR_REFRESH_POLICY.requestMaxAttempts; attempt++) {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (response.ok) {
          const json = (await response.json()) as ChannelResponse;
          // `null` is Kick's explicit offline shape. A missing field is a malformed/transient
          // payload and must not be cached as offline, especially now that offline rows hide.
          if (!Object.prototype.hasOwnProperty.call(json, 'livestream')) throw new Error('invalid channel response');
          if (json.livestream === null) return { isLive: false, viewerCount: 0 };
          if (!json.livestream) throw new Error('invalid channel response');
          if (
            typeof json.livestream.is_live !== 'boolean'
            || typeof json.livestream.viewer_count !== 'number'
            || !Number.isFinite(json.livestream.viewer_count)
            || json.livestream.viewer_count < 0
          ) {
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
      if (attempt < SIDEBAR_REFRESH_POLICY.requestMaxAttempts - 1) {
        const backoffMs = SIDEBAR_REFRESH_POLICY.requestRetryBaseMs * 2 ** attempt;
        if (lastError instanceof TypeError) {
          logger.debug('sidebar-refresh: transient network failure; retrying', slug, backoffMs);
        }
        await this.delay(backoffMs);
      }
    }
    throw lastError;
  }

  private patchRow(row: HTMLAnchorElement, data: SidebarChannelData): void {
    const live = String(data.isLive);
    // Keep React's row mounted and owned by Kick, but let extension CSS reversibly de-list a
    // channel after the API says it is offline. A later live response removes the hiding state.
    if (row.getAttribute('data-kickflow-live') !== live) row.setAttribute('data-kickflow-live', live);
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
    if (dot?.getAttribute('data-kickflow-live') !== live) dot?.setAttribute('data-kickflow-live', live);
  }

  private scheduleCachedReapply(): void {
    if (this.disposed) return;
    if (this.observerTimer !== null) window.clearTimeout(this.observerTimer);
    this.observerTimer = window.setTimeout(() => {
      this.observerTimer = null;
      const rows = this.discoverRows();
      this.syncObserverRoots(rows);
      let hasNewSlug = false;
      for (const row of rows) {
        const slug = getSidebarChannelSlug(row);
        const data = slug ? this.cache.get(slug) : undefined;
        if (data) this.patchRow(row, data);
        else if (
          slug &&
          !this.notFoundSlugs.has(slug) &&
          !this.activeRefreshSlugs.has(slug) &&
          !this.knownSlugs.has(slug)
        ) {
          hasNewSlug = true;
        }
      }
      if (hasNewSlug) void this.refresh();
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
    // Visibility is the one patch that cannot safely remain when the feature is disabled: the
    // extension stylesheet would otherwise keep a Kick-owned offline row hidden indefinitely.
    for (const row of this.discoverRows()) {
      row.removeAttribute('data-kickflow-live');
      row.querySelector<HTMLElement>(LIVE_DOT_SELECTOR)?.removeAttribute('data-kickflow-live');
    }
  }
}
