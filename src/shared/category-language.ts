/** Category-page language shortcut contract, shared by the content chip and the MAIN-world bridge.
 *
 * Kick's own filter (measured read-only on kick.com/category/valorant, 2026-11-24): the "Dil"
 * combobox (#livestream_filter_by, data-testid content-lang-filter-button) writes its choice into
 * the page URL as `languages=<code>[,<code>...]` (one comma list, e.g. `tr,en`), and the
 * livestream list is fetched from recommendations/livestreams/list with `language=tr`. A fresh
 * load and a Next router replace of that URL both make Kick's filter show the choice ("Dil 1").
 * Kick's in-page navigation to another category drops the parameter, which is why Turkish
 * sometimes "is not there". Sorting keeps it. */

export const CATEGORY_LANGUAGE_EVENT = 'kickflow:category-languages-v1';
export const CATEGORY_LANGUAGE_RESULT_ATTRIBUTE = 'data-kickflow-category-lang-result';
export const CATEGORY_LANGUAGE_CHIP_SELECTOR = 'button.kickflow-lang-chip';
export const LANGUAGES_PARAM = 'languages';
export const TURKISH = 'tr';

export type CategoryLanguageResult = 'ok' | 'no-router' | 'invalid' | 'failed';

/** Only the live-stream list of a category: /category/<slug> (Clips and Drops tabs have no Dil filter). */
export function isCategoryLivePath(pathname: string): boolean {
  return /^\/category\/[^/]+\/?$/.test(pathname);
}

export function languagesOf(search: string): string[] {
  const raw = new URLSearchParams(search).getAll(LANGUAGES_PARAM).join(',');
  return raw.split(',').map((code) => code.trim()).filter(Boolean);
}

export function hasLanguage(search: string, code: string = TURKISH): boolean {
  return languagesOf(search).includes(code);
}

/** Path + query with `code` added to or removed from Kick's comma list; other languages and
 * parameters (sort) stay as they are. Removing the last language removes the parameter. */
export function withLanguage(pathname: string, search: string, on: boolean, code: string = TURKISH): string {
  const params = new URLSearchParams(search);
  const current = languagesOf(search).filter((item) => item !== code);
  const next = on ? [...current, code] : current;
  params.delete(LANGUAGES_PARAM);
  if (next.length) params.set(LANGUAGES_PARAM, next.join(','));
  const query = params.toString().replace(/%2C/gi, ',');
  return query ? `${pathname}?${query}` : pathname;
}

/** Accept only a same-site category live path with a plain query; nothing else reaches the router. */
export function parseCategoryLanguageRequest(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 600 || !raw.startsWith('/')) return null;
  try {
    const url = new URL(raw, 'https://kick.com');
    if (url.origin !== 'https://kick.com' || url.hash || !isCategoryLivePath(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
