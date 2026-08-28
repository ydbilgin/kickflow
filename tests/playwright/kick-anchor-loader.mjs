import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_ANCHOR_KEYS = [
  'chatRoot',
  'chatList',
  'chatRow',
  'chatContent',
  'chatRowGroupClass',
  'reactFiberPrefix',
  'reactMessageKey',
  'contentTokenRegex',
  'videoPlayer',
  'controlBar',
  'controlBarBottom',
  'gearPathPrefixes',
  'captionButton',
  'captionIconPrefixes',
  'liveEdgeLabels',
  'goToLivePhrases',
  'technicalTheaterToken',
  'theaterShortcut',
  'theaterStateSelector',
  'navbarRightClusterIndex',
  'navbarRightClusterClasses',
  'activeChattersPanel',
  'activeChattersSearch',
  'activeChattersRow',
  'activeChattersUsername',
  'dropsPanel',
  'rewardsPanel',
  'dailyRewardCta',
  'pusherUrl',
  'chatHistoryBaseUrl',
  'chatHistoryStartTimeUrl',
];

const entrySource = `
  import { SELECTORS, LIVE_EDGE_LABELS, GO_TO_LIVE_PHRASES } from './src/content/shared/selectors.ts';
  import {
    CHAT_ROOT_SELECTOR, CHAT_LIST_SELECTOR, ROW_SELECTOR, NATIVE_CONTENT_SELECTOR,
    NATIVE_ROW_GROUP_CLASS,
  } from './src/content/chat/native-augment.ts';
  import {
    REACT_FIBER_PROPERTY_PREFIX, REACT_MESSAGE_KEY,
  } from './src/mainworld/react-key-stamper.ts';
  import { CONTENT_TOKEN_RE } from './src/content/chat/content-tokens.ts';
  import { KNOWN_GEAR_PATH_PREFIXES } from './src/content/player/quality-lock.ts';
  import {
    ACTIVE_ICON_PATH_PREFIX, INACTIVE_ICON_PATH_PREFIX,
  } from './src/content/player/caption-guard.ts';
  import {
    TECHNICAL_THEATER_TOKEN, THEATER_SHORTCUT, THEATER_STATE_SELECTOR,
  } from './src/content/player/auto-theater.ts';
  import {
    NAVBAR_RIGHT_CLUSTER_INDEX, NAVBAR_RIGHT_CLUSTER_CLASSES,
  } from './src/content/chat/navbar-settings.ts';
  import {
    ACTIVE_CHATTERS_PANEL_SELECTOR, ACTIVE_CHATTERS_SEARCH_SELECTOR,
    ACTIVE_CHATTERS_ROW_SELECTOR, ACTIVE_CHATTERS_USERNAME_SELECTOR,
  } from './src/content/chat/active-chatters-badges.ts';
  import {
    DROPS_PANEL_SELECTOR, CHANNEL_POINTS_PANEL_SELECTOR,
  } from './src/content/chat/drops-auto-claim.ts';
  import { DAILY_REWARD_CTA_SELECTOR } from './src/content/daily-reward-auto-claim.ts';
  import { PUSHER_URL } from './src/content/chat/pusher-client.ts';
  import { historyUrl } from './src/content/chat/history.ts';

  export default {
    chatRoot: CHAT_ROOT_SELECTOR,
    chatList: CHAT_LIST_SELECTOR,
    chatRow: ROW_SELECTOR,
    chatContent: NATIVE_CONTENT_SELECTOR,
    chatRowGroupClass: NATIVE_ROW_GROUP_CLASS,
    reactFiberPrefix: REACT_FIBER_PROPERTY_PREFIX,
    reactMessageKey: { source: REACT_MESSAGE_KEY.source, flags: REACT_MESSAGE_KEY.flags },
    contentTokenRegex: { source: CONTENT_TOKEN_RE.source, flags: CONTENT_TOKEN_RE.flags },
    videoPlayer: SELECTORS.videoPlayer,
    controlBar: SELECTORS.controlBar,
    controlBarBottom: SELECTORS.controlBarBottom,
    gearPathPrefixes: [...KNOWN_GEAR_PATH_PREFIXES],
    captionButton: SELECTORS.nativeCaptionButton,
    captionIconPrefixes: {
      active: ACTIVE_ICON_PATH_PREFIX,
      inactive: INACTIVE_ICON_PATH_PREFIX,
    },
    liveEdgeLabels: [...LIVE_EDGE_LABELS],
    goToLivePhrases: [...GO_TO_LIVE_PHRASES],
    technicalTheaterToken: { source: TECHNICAL_THEATER_TOKEN.source, flags: TECHNICAL_THEATER_TOKEN.flags },
    theaterShortcut: { source: THEATER_SHORTCUT.source, flags: THEATER_SHORTCUT.flags },
    theaterStateSelector: THEATER_STATE_SELECTOR,
    navbarRightClusterIndex: NAVBAR_RIGHT_CLUSTER_INDEX,
    navbarRightClusterClasses: [...NAVBAR_RIGHT_CLUSTER_CLASSES],
    activeChattersPanel: ACTIVE_CHATTERS_PANEL_SELECTOR,
    activeChattersSearch: ACTIVE_CHATTERS_SEARCH_SELECTOR,
    activeChattersRow: ACTIVE_CHATTERS_ROW_SELECTOR,
    activeChattersUsername: ACTIVE_CHATTERS_USERNAME_SELECTOR,
    dropsPanel: DROPS_PANEL_SELECTOR,
    rewardsPanel: CHANNEL_POINTS_PANEL_SELECTOR,
    dailyRewardCta: DAILY_REWARD_CTA_SELECTOR,
    pusherUrl: PUSHER_URL,
    chatHistoryBaseUrl: historyUrl(123456),
    chatHistoryStartTimeUrl: historyUrl(123456, '2026-01-02T03:04:05.000Z'),
  };
`;

const headlessSourceGlobals = `
  var document = {
    body: null, readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
  };
  var window = {
    addEventListener() {}, removeEventListener() {},
    setInterval() { return 0; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: '', pathname: '/' },
  };
`;

export async function loadProductionAnchors(repoRoot = path.resolve('.')) {
  const failures = {};
  let tempModule = null;
  try {
    const built = await build({
      stdin: {
        contents: entrySource,
        resolveDir: repoRoot,
        sourcefile: 'kick-anchor-runtime-entry.ts',
        loader: 'ts',
      },
      banner: { js: headlessSourceGlobals },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      write: false,
      logLevel: 'silent',
    });
    const output = built.outputFiles?.[0]?.text;
    if (!output) throw new Error('esbuild produced no runtime anchor module');
    tempModule = path.join(tmpdir(), `kickflow-anchor-values-${randomUUID()}.mjs`);
    await writeFile(tempModule, output, 'utf8');
    const imported = await import(`${pathToFileURL(tempModule).href}?v=${randomUUID()}`);
    const values = imported.default ?? {};
    for (const key of PRODUCTION_ANCHOR_KEYS) {
      if (values[key] === undefined) failures[key] = 'production export did not yield a value';
    }
    return { values, failures };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const key of PRODUCTION_ANCHOR_KEYS) failures[key] = message;
    return { values: {}, failures };
  } finally {
    if (tempModule) await rm(tempModule, { force: true }).catch(() => {});
  }
}
