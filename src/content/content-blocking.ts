import { featureFlags } from './chat/feature-flags';
import type { Lifecycle } from './shared/lifecycle';
import { safeStorageGet } from './shared/extension-context';
import { onlyChatMutations } from './shared/coalesce';

/** Channel, category and tag blocking (2026-11-24). Cards of a blocked channel, category or tag are
 * hidden from the sidebar (recommended and followed), the home and browse lists, category pages and
 * category tiles. Lists live in kf_blockLists ({ channels, categories, tags }); a settings page edits
 * them, open Kick tabs follow at once. Nothing is sent anywhere; only CSS display.
 *
 * Card shapes measured 2026-11-24 (anonymous, headless Chromium, kick.com home, /browse and
 * /category/valorant): live cards are [data-testid="livestream-results-card"] with the channel link
 * href="/<slug>", the category link href="/category/<slug>" and tag pills (class group/tag, e.g. the
 * "Türkçe" language pill); sidebar rows are a[data-testid^="sidebar-recommended-channel-"] with
 * href="/<slug>" and the category name as the second line; category tiles are
 * [data-testid="category-card-root"] with a link href="/category/<slug>". Followed rows
 * (sidebar-following-channel-*) were not seen logged out; they are matched by the same rule. */

export const BLOCK_LISTS_KEY = 'kf_blockLists';
export const BLOCKED_ATTRIBUTE = 'data-kickflow-blocked';
export const MAX_ENTRIES = 300;

export interface BlockLists { channels: string[]; categories: string[]; tags: string[] }

export const CARD_SELECTOR = [
  '[data-testid="livestream-results-card"]',
  '[data-testid^="sidebar-recommended-channel-"]',
  '[data-testid^="sidebar-following-channel-"]',
  '[data-testid="category-card-root"]',
].join(', ');

/** Lower case, no diacritics, single spaces: "Türkçe" and "turkce" match, "GTA  V" and "gta v" too. */
export function normalizeTerm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
}

function termList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : [];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    let term = normalizeTerm(value);
    // A pasted link or @name becomes the slug: kick.com/name, /category/slots, @name.
    term = term.replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\//, '').replace(/^\/?category\//, '').replace(/^[@/]+/, '').replace(/\/+$/, '');
    if (term && term.length <= 100 && !out.includes(term)) out.push(term);
  }
  return out.slice(0, MAX_ENTRIES);
}

export function sanitizeBlockLists(raw: unknown): BlockLists {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { channels: termList(source.channels), categories: termList(source.categories), tags: termList(source.tags) };
}

export function isEmpty(lists: BlockLists): boolean {
  return !lists.channels.length && !lists.categories.length && !lists.tags.length;
}

export interface CardFacts { channel: string | null; categories: string[]; tags: string[] }

function hrefPath(anchor: Element): string {
  const href = anchor.getAttribute('href') ?? '';
  try { return new URL(href, 'https://kick.com').pathname; } catch { return ''; }
}

/** What a card shows: its channel slug, its category slug and name, its tag pills. */
export function readCard(card: Element): CardFacts {
  const facts: CardFacts = { channel: null, categories: [], tags: [] };
  const anchors = card.matches('a[href]') ? [card, ...card.querySelectorAll('a[href]')] : [...card.querySelectorAll('a[href]')];
  for (const anchor of anchors) {
    const path = hrefPath(anchor);
    const category = /^\/category\/([^/]+)\/?$/.exec(path);
    if (category) {
      facts.categories.push(normalizeTerm(decodeURIComponent(category[1]!)));
      const name = anchor.textContent ?? '';
      if (name.trim() && !card.matches('[data-testid="category-card-root"]')) facts.categories.push(normalizeTerm(name));
      continue;
    }
    const channel = /^\/([A-Za-z0-9_-]{1,100})\/?$/.exec(path);
    if (channel && !facts.channel) facts.channel = channel[1]!.toLowerCase();
  }
  if (card.matches('[data-testid="category-card-root"]')) {
    const title = card.querySelector('[title], h3, h2, span');
    const name = title?.getAttribute('title') ?? title?.textContent ?? '';
    if (name.trim()) facts.categories.push(normalizeTerm(name));
    facts.channel = null;
  }
  // Sidebar rows: the second line is the category name.
  if (/^sidebar-/.test(card.getAttribute('data-testid') ?? '')) {
    const lines = card.querySelectorAll('span.truncate');
    const category = lines[1]?.textContent ?? '';
    if (category.trim()) facts.categories.push(normalizeTerm(category));
  }
  for (const pill of card.querySelectorAll('[class*="group/tag"]')) {
    const text = pill.textContent ?? '';
    if (text.trim()) facts.tags.push(normalizeTerm(text));
  }
  return facts;
}

export function isBlocked(facts: CardFacts, lists: BlockLists): boolean {
  if (facts.channel && lists.channels.includes(facts.channel)) return true;
  if (facts.categories.some((value) => lists.categories.includes(value))) return true;
  return facts.tags.some((value) => lists.tags.includes(value) || lists.categories.includes(value));
}

/** Marks or unmarks every card under `root`. Returns how many are hidden. */
export function applyBlocking(root: ParentNode, lists: BlockLists, enabled: boolean): number {
  let hidden = 0;
  for (const card of root.querySelectorAll(CARD_SELECTOR)) {
    const block = enabled && !isEmpty(lists) && isBlocked(readCard(card), lists);
    if (block) {
      hidden++;
      if (!card.hasAttribute(BLOCKED_ATTRIBUTE)) card.setAttribute(BLOCKED_ATTRIBUTE, '');
    } else if (card.hasAttribute(BLOCKED_ATTRIBUTE)) {
      card.removeAttribute(BLOCKED_ATTRIBUTE);
    }
  }
  return hidden;
}

const STYLE_ID = 'kickflow-content-blocking-style';
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${BLOCKED_ATTRIBUTE}]{display:none!important}`;
  (document.head ?? document.documentElement).append(style);
}

let lists: BlockLists = { channels: [], categories: [], tags: [] };
let rerun: (() => void) | null = null;

/** Called from bootstrap's one storage listener (a second listener would break reinjection). */
export function handleBlockListsChange(changes: Record<string, { newValue?: unknown }>): void {
  if (!Object.prototype.hasOwnProperty.call(changes, BLOCK_LISTS_KEY)) return;
  lists = sanitizeBlockLists(changes[BLOCK_LISTS_KEY]!.newValue);
  rerun?.();
}

export function syncContentBlocking(): void {
  rerun?.();
}

/* 0.4.3 (2026-11-24, code review B18): the page observer runs only while blocking is on and a list has an
 * entry, skips chat mutations (every chat message would rescan every card), rescans once on an in-page route
 * change (a reused card node gets a new href), and the style element leaves with the lifecycle. */
export async function initContentBlocking(lifecycle: Lifecycle): Promise<void> {
  ensureStyle();
  let frame = 0;
  let observing = false;
  const scan = (): void => {
    if (frame || lifecycle.isDisposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyBlocking(document, lists, featureFlags.contentBlocking);
    });
  };
  const observer = new MutationObserver((records) => {
    if (!onlyChatMutations(records)) scan();
  });
  const active = (): boolean => featureFlags.contentBlocking && !isEmpty(lists);
  const run = (): void => {
    if (lifecycle.isDisposed) return;
    if (active() && !observing && document.body) { observer.observe(document.body, { childList: true, subtree: true }); observing = true; }
    else if (!active() && observing) { observer.disconnect(); observing = false; }
    scan();
  };
  rerun = run;
  lifecycle.add(() => {
    if (frame) cancelAnimationFrame(frame);
    if (rerun === run) rerun = null;
    observer.disconnect();
    observing = false;
    applyBlocking(document, lists, false);
    document.getElementById(STYLE_ID)?.remove();
  });
  lifecycle.addEventListener(window, 'kickflow:locationchange', () => { if (active()) scan(); });
  const stored = await safeStorageGet(BLOCK_LISTS_KEY);
  if (lifecycle.isDisposed) return;
  lists = sanitizeBlockLists(stored[BLOCK_LISTS_KEY]);
  run();
}
