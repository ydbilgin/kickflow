export const ANCHOR_SPECS = [
  { id: 'chat.root', key: 'chatRoot', where: 'src/content/chat/native-augment.ts:CHAT_ROOT_SELECTOR' },
  { id: 'chat.list', key: 'chatList', where: 'src/content/chat/native-augment.ts:CHAT_LIST_SELECTOR' },
  { id: 'chat.row-index', key: 'chatRow', where: 'src/content/chat/native-augment.ts:ROW_SELECTOR' },
  { id: 'chat.row-content', key: 'chatContent', where: 'src/content/chat/native-augment.ts:NATIVE_CONTENT_SELECTOR' },
  { id: 'chat.row-group', key: 'chatRowGroupClass', where: 'src/content/chat/native-augment.ts:NATIVE_ROW_GROUP_CLASS' },
  { id: 'chat.react-fiber-property', key: 'reactFiberPrefix', where: 'src/mainworld/react-key-stamper.ts:REACT_FIBER_PROPERTY_PREFIX' },
  { id: 'chat.react-key-shape', key: 'reactMessageKey', where: 'src/mainworld/react-key-stamper.ts:REACT_MESSAGE_KEY' },
  { id: 'chat.emote-token', key: 'contentTokenRegex', where: 'src/content/chat/content-tokens.ts:CONTENT_TOKEN_RE' },
  { id: 'player.video', key: 'videoPlayer', where: 'src/content/shared/selectors.ts:SELECTORS.videoPlayer' },
  { id: 'player.control-bar-fallback', key: 'controlBar', where: 'src/content/shared/selectors.ts:SELECTORS.controlBar' },
  { id: 'player.control-bar-bottom', key: 'controlBarBottom', where: 'src/content/shared/selectors.ts:SELECTORS.controlBarBottom' },
  { id: 'player.settings-cog-paths', key: 'gearPathPrefixes', where: 'src/content/player/quality-lock.ts:KNOWN_GEAR_PATH_PREFIXES' },
  { id: 'player.caption-button', key: 'captionButton', where: 'src/content/shared/selectors.ts:SELECTORS.nativeCaptionButton' },
  { id: 'player.caption-icon-paths', key: 'captionIconPrefixes', where: 'src/content/player/caption-guard.ts:ACTIVE_ICON_PATH_PREFIX+INACTIVE_ICON_PATH_PREFIX' },
  { id: 'player.live-edge-labels', key: 'liveEdgeLabels', where: 'src/content/shared/selectors.ts:LIVE_EDGE_LABELS' },
  { id: 'player.go-to-live-labels', key: 'goToLivePhrases', where: 'src/content/shared/selectors.ts:GO_TO_LIVE_PHRASES' },
  { id: 'player.theater-token', key: 'technicalTheaterToken', where: 'src/content/player/auto-theater.ts:TECHNICAL_THEATER_TOKEN' },
  { id: 'player.theater-shortcut', key: 'theaterShortcut', where: 'src/content/player/auto-theater.ts:THEATER_SHORTCUT' },
  { id: 'player.theater-state', key: 'theaterStateSelector', where: 'src/content/player/auto-theater.ts:THEATER_STATE_SELECTOR' },
  { id: 'navbar.right-cluster-index', key: 'navbarRightClusterIndex', where: 'src/content/chat/navbar-settings.ts:NAVBAR_RIGHT_CLUSTER_INDEX' },
  { id: 'navbar.right-cluster-classes', key: 'navbarRightClusterClasses', where: 'src/content/chat/navbar-settings.ts:NAVBAR_RIGHT_CLUSTER_CLASSES' },
  { id: 'panels.active-chatters-panel', key: 'activeChattersPanel', where: 'src/content/chat/active-chatters-badges.ts:ACTIVE_CHATTERS_PANEL_SELECTOR' },
  { id: 'panels.active-chatters-search', key: 'activeChattersSearch', where: 'src/content/chat/active-chatters-badges.ts:ACTIVE_CHATTERS_SEARCH_SELECTOR' },
  { id: 'panels.active-chatters-row', key: 'activeChattersRow', where: 'src/content/chat/active-chatters-badges.ts:ACTIVE_CHATTERS_ROW_SELECTOR' },
  { id: 'panels.active-chatters-username', key: 'activeChattersUsername', where: 'src/content/chat/active-chatters-badges.ts:ACTIVE_CHATTERS_USERNAME_SELECTOR' },
  { id: 'panels.drops', key: 'dropsPanel', where: 'src/content/chat/drops-auto-claim.ts:DROPS_PANEL_SELECTOR' },
  { id: 'panels.rewards', key: 'rewardsPanel', where: 'src/content/chat/drops-auto-claim.ts:CHANNEL_POINTS_PANEL_SELECTOR' },
  { id: 'navbar.daily-reward-cta', key: 'dailyRewardCta', where: 'src/content/daily-reward-auto-claim.ts:DAILY_REWARD_CTA_SELECTOR' },
  { id: 'network.pusher-socket', key: 'pusherUrl', where: 'src/content/chat/pusher-client.ts:PUSHER_URL' },
  { id: 'network.chat-history', key: 'chatHistoryBaseUrl', where: 'src/content/chat/history.ts:historyUrl(channelId)' },
  { id: 'network.chat-history-start-time', key: 'chatHistoryStartTimeUrl', where: 'src/content/chat/history.ts:historyUrl(channelId,startTime)' },
];

/** Runs inside either the live page or jsdom. It only locates and records; it never clicks. */
export function collectKickAnchorEvidence({ anchors, observations = {} }) {
  const safeQuery = (root, selector) => {
    try {
      return typeof selector === 'string' ? root?.querySelector?.(selector) ?? null : null;
    } catch {
      return null;
    }
  };
  const all = (root, selector) => {
    try {
      return typeof selector === 'string' ? Array.from(root?.querySelectorAll?.(selector) ?? []) : [];
    } catch {
      return [];
    }
  };
  const regex = (value) => {
    try {
      return value?.source ? new RegExp(value.source, value.flags ?? '') : null;
    } catch {
      return null;
    }
  };
  const firstPath = (element) => safeQuery(element, 'svg path')?.getAttribute('d') ?? '';
  const root = safeQuery(document, anchors.chatRoot);
  const list = safeQuery(document, anchors.chatList);
  const row = safeQuery(list, anchors.chatRow);
  const video = safeQuery(document, anchors.videoPlayer);
  const wrapper = video?.parentElement ?? null;
  const bottomBar = safeQuery(wrapper, anchors.controlBarBottom);
  const fallbackBars = all(wrapper, anchors.controlBar).filter((bar) => safeQuery(bar, 'button'));
  const bar = bottomBar ?? fallbackBars.sort(
    (left, right) => all(right, 'button').length - all(left, 'button').length,
  )[0] ?? null;
  const buttons = all(bar, 'button').map((button, index) => ({
    index,
    text: (button.textContent ?? '').trim().slice(0, 120),
    ariaLabel: button.getAttribute('aria-label') ?? '',
    title: button.getAttribute('title') ?? '',
    testId: button.getAttribute('data-testid'),
    firstPath: firstPath(button).slice(0, 120),
    metadata: [button, ...all(button, 'svg, svg *')]
      .flatMap((element) => Array.from(element.attributes ?? []).map((attribute) => attribute.value)),
  }));
  const caption = safeQuery(bar, anchors.captionButton);
  const captionPaths = all(caption, 'svg path').map((path) => path.getAttribute('d') ?? '');
  const captionIconMatchIndexes = buttons.filter((button) => button.firstPath
    && (button.firstPath.startsWith(anchors.captionIconPrefixes?.active)
      || button.firstPath.startsWith(anchors.captionIconPrefixes?.inactive)))
    .map((button) => button.index);
  const reactProperty = row && typeof anchors.reactFiberPrefix === 'string'
    ? Object.getOwnPropertyNames(row).find((name) => name.startsWith(anchors.reactFiberPrefix)) ?? null
    : null;
  const reactKey = reactProperty ? row?.[reactProperty]?.key : null;
  const rawFixtureContents = all(document, '[data-probe-raw-content]')
    .map((element) => element.getAttribute('data-probe-raw-content'))
    .filter((value) => typeof value === 'string');
  const renderedChatImages = all(row, 'img').map((image) => {
    const source = image.getAttribute('src') ?? '';
    try {
      const parsed = new URL(source, document.baseURI);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return source.slice(0, 120);
    }
  });
  const navbars = all(document, 'nav').map((nav) => ({
    childCount: nav.children.length,
    rightClasses: Array.from(nav.children[anchors.navbarRightClusterIndex]?.classList ?? []),
  }));
  const panel = safeQuery(document, anchors.activeChattersPanel);
  const theaterRegex = regex(anchors.technicalTheaterToken);
  const shortcutRegex = regex(anchors.theaterShortcut);
  const elementDescriptor = (element) => ({
    tag: element.tagName?.toLowerCase() ?? '',
    id: element.id ?? '',
    classes: Array.from(element.classList ?? []).slice(0, 12),
    testId: element.getAttribute?.('data-testid') ?? null,
  });

  return {
    chat: {
      root: Boolean(root),
      list: Boolean(list),
      row: Boolean(row),
      rowAttributes: row ? Array.from(row.attributes).map(({ name, value }) => `${name}=${value}`) : [],
      content: Boolean(safeQuery(row, anchors.chatContent)),
      group: Boolean(row && typeof anchors.chatRowGroupClass === 'string'
        && Array.from(row.children).some((child) => child.classList?.contains(anchors.chatRowGroupClass))),
      reactProperty,
      reactKey: typeof reactKey === 'string' ? reactKey : null,
      contents: [...rawFixtureContents, ...(observations.chatContents ?? [])],
      renderedImages: renderedChatImages,
      nearbyCandidates: all(document, '[id], [class]').filter((element) => {
        const shape = `${element.id ?? ''} ${element.getAttribute?.('class') ?? ''}`.toLowerCase();
        return shape.includes('chat') || shape.includes('message') || shape.includes('scroll');
      }).slice(0, 30).map(elementDescriptor),
      listChildren: Array.from((root ?? document.body)?.children ?? []).slice(0, 30).map(elementDescriptor),
    },
    player: {
      video: Boolean(video),
      wrapper: Boolean(wrapper),
      bottomBar: Boolean(bottomBar),
      fallbackBar: fallbackBars.length > 0,
      zControlClasses: all(wrapper, 'div[class]')
        .map((element) => Array.from(element.classList).join(' ')),
      buttons,
      caption: Boolean(caption),
      captionPaths,
      captionIconMatchIndexes,
      textTrackCount: video?.textTracks?.length ?? 0,
      videoCandidates: all(document, 'video').slice(0, 20).map((candidate) => ({
        ...elementDescriptor(candidate),
        source: (() => {
          const source = candidate.getAttribute('src') ?? '';
          try {
            const parsed = new URL(source, document.baseURI);
            return `${parsed.origin}${parsed.pathname}`;
          } catch {
            return source.slice(0, 120);
          }
        })(),
      })),
      theaterTokenMatches: buttons.filter((button) => button.metadata.some((value) => {
        if (!theaterRegex) return false;
        theaterRegex.lastIndex = 0;
        return theaterRegex.test(value);
      })).map((button) => button.index),
      theaterShortcutMatches: buttons.filter((button) => {
        if (!shortcutRegex) return false;
        shortcutRegex.lastIndex = 0;
        return shortcutRegex.test(`${button.ariaLabel} ${button.title}`.trim());
      }).map((button) => button.index),
      theaterState: safeQuery(document, anchors.theaterStateSelector)?.getAttribute('data-theatre') ?? null,
    },
    navbar: {
      navbars,
      dailyRewardCount: all(document, anchors.dailyRewardCta).length,
      videoSources: all(document, 'video').map((element) => element.getAttribute('src') ?? '').filter(Boolean),
    },
    panels: {
      activePanel: Boolean(panel),
      activeSearchAnywhere: all(document, anchors.activeChattersSearch).length > 0,
      activeSearch: Boolean(safeQuery(panel, anchors.activeChattersSearch)),
      activeRow: Boolean(safeQuery(panel, anchors.activeChattersRow)),
      activeUsername: Boolean(safeQuery(panel, anchors.activeChattersUsername)),
      drops: all(document, anchors.dropsPanel).length,
      rewards: all(document, anchors.rewardsPanel).length,
    },
    network: {
      webSockets: observations.webSockets ?? [],
      requests: observations.requests ?? [],
    },
  };
}

// A page can carry media that is not the stream: Kick serves a placeholder clip out of its ads
// path during a pre-roll, and an offline channel carries no player at all. MEASURED 2026-08-28 —
// the probe's first live run landed mid-pre-roll, found only
// `https://static.kick.com/ads/black_2s.mp4`, and reported six player anchors as MISS while every
// one of them had been verified matching on the same site an hour earlier. A probe that cries
// wolf is exactly as useless as one that stays silent, so "the player never mounted" must report
// NOT_CHECKABLE, never MISS.
// The signal is the player REGION, never the media source: the fixture's real player carries no
// `src` at all, and an ordinary page carries unrelated media (the daily-reward CTA clip), so
// "is there stream media" answers the wrong question in both directions.
const playerRegionPresent = (player) => Boolean(player.video)
  || Boolean(player.fallbackBar)
  || Boolean(player.bottomBar)
  || player.buttons.length > 0;

function printableValue(value) {
  if (value?.source) return `/${value.source}/${value.flags ?? ''}`;
  return value;
}

function dynamicUrlMatches(actual, sample) {
  if (typeof actual !== 'string' || typeof sample !== 'string') return false;
  const escaped = sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('123456', '\\d+');
  return new RegExp(`^${escaped}$`).test(actual);
}

export function evaluateKickAnchorResults(anchorLoad, evidence) {
  const values = anchorLoad?.values ?? {};
  const failures = anchorLoad?.failures ?? {};
  const results = [];
  const specById = new Map(ANCHOR_SPECS.map((spec) => [spec.id, spec]));
  const add = (id, status, detail = {}) => {
    const spec = specById.get(id);
    const loadFailure = !spec || failures[spec.key] || values[spec.key] === undefined;
    results.push({
      id,
      where: spec?.where ?? 'unknown',
      value: printableValue(spec ? values[spec.key] : undefined),
      status: loadFailure ? 'UNLOADABLE' : status,
      ...(loadFailure ? { reason: failures[spec?.key] ?? 'production value was not loaded' } : detail),
    });
  };
  const match = (id, condition, missEvidence) => add(
    id,
    condition ? 'MATCH' : 'MISS',
    condition ? {} : { evidence: missEvidence },
  );
  const conditional = (id, checkable, condition, reason, missEvidence) => {
    if (!checkable) add(id, 'NOT_CHECKABLE', { reason });
    else match(id, condition, missEvidence);
  };
  const buttonEvidence = evidence.player.buttons.map(
    ({ index, ariaLabel, text, testId, firstPath }) => ({ index, label: ariaLabel || text, testId, firstPath }),
  );

  match('chat.root', evidence.chat.root, { candidates: evidence.chat.nearbyCandidates });
  match('chat.list', evidence.chat.list, {
    rootPresent: evidence.chat.root,
    rootChildren: evidence.chat.listChildren,
  });
  match('chat.row-index', evidence.chat.row, { rowAttributes: evidence.chat.rowAttributes });
  conditional('chat.row-content', evidence.chat.row, evidence.chat.content, 'no rendered native chat row was available', {
    rowAttributes: evidence.chat.rowAttributes,
  });
  conditional('chat.row-group', evidence.chat.row, evidence.chat.group, 'no rendered native chat row was available', {
    rowAttributes: evidence.chat.rowAttributes,
  });
  conditional('chat.react-fiber-property', evidence.chat.row, Boolean(evidence.chat.reactProperty), 'no rendered native chat row was available', {
    ownPropertyNames: evidence.chat.reactProperty ? [evidence.chat.reactProperty] : [],
  });
  const keyPattern = values.reactMessageKey?.source ? new RegExp(values.reactMessageKey.source, values.reactMessageKey.flags ?? '') : null;
  conditional('chat.react-key-shape', Boolean(evidence.chat.reactKey), Boolean(keyPattern?.test(evidence.chat.reactKey ?? '')), 'no real React row key was readable', {
    reactKey: evidence.chat.reactKey,
  });
  const tokenPattern = values.contentTokenRegex?.source
    ? new RegExp(values.contentTokenRegex.source, values.contentTokenRegex.flags ?? '')
    : null;
  const emoteCandidates = evidence.chat.contents.filter((content) => {
    if (!tokenPattern) return false;
    tokenPattern.lastIndex = 0;
    return Array.from(content.matchAll(tokenPattern)).some((found) => Boolean(found.groups?.emoteId));
  });
  conditional(
    'chat.emote-token',
    emoteCandidates.length > 0 || evidence.chat.renderedImages.length > 0,
    emoteCandidates.length > 0,
    'no rendered emote image or captured content matching the production grammar was observed',
    {
      renderedImages: evidence.chat.renderedImages,
      capturedContentLengths: evidence.chat.contents.map((content) => content.length),
    },
  );

  // `#video-player` is only a MISS when real stream media is on the page WITHOUT carrying the id.
  // No stream media at all means the channel is offline or a pre-roll is running — a state of the
  // page, not a change to the anchor.
  // `#video-player` is a MISS only when the player region IS on the page without carrying the id —
  // that is the rot we want to catch. When no part of the player mounted at all, nothing about the
  // anchor was tested.
  const playerPresent = playerRegionPresent(evidence.player);
  const noPlayerReason = 'no part of the player mounted (channel offline or pre-roll ad still '
    + 'playing), so its anchors were never exercised';
  conditional(
    'player.video',
    playerPresent,
    evidence.player.video,
    noPlayerReason,
    { videoCandidates: evidence.player.videoCandidates },
  );
  // Everything below reads the control bar, which only exists once the player has mounted.
  const playerMounted = playerPresent;
  conditional('player.control-bar-fallback', playerMounted, evidence.player.fallbackBar, noPlayerReason, {
    zControlClasses: evidence.player.zControlClasses,
  });
  conditional('player.control-bar-bottom', playerMounted, evidence.player.bottomBar, noPlayerReason, {
    zControlClasses: evidence.player.zControlClasses,
  });
  conditional(
    'player.settings-cog-paths',
    playerMounted,
    evidence.player.buttons.some((button) => values.gearPathPrefixes?.some((prefix) => button.firstPath.startsWith(prefix))),
    noPlayerReason,
    { controlBarButtons: buttonEvidence },
  );
  const captionCapability = evidence.player.caption
    || evidence.player.captionIconMatchIndexes.length > 0
    || evidence.player.textTrackCount > 0;
  conditional('player.caption-button', captionCapability, evidence.player.caption,
    'this stream exposed no caption capability/control', {
      controlBarButtons: buttonEvidence,
      iconCandidateIndexes: evidence.player.captionIconMatchIndexes,
      textTrackCount: evidence.player.textTrackCount,
    });
  conditional(
    'player.caption-icon-paths',
    captionCapability,
    evidence.player.captionIconMatchIndexes.length > 0,
    'this stream exposed no caption capability/control',
    {
      captionPathPrefixes: evidence.player.captionPaths.map((path) => path.slice(0, 80)),
      controlBarButtons: buttonEvidence,
      textTrackCount: evidence.player.textTrackCount,
    },
  );
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const buttonTexts = evidence.player.buttons.map((button) => normalize(button.text));
  conditional('player.live-edge-labels', playerMounted,
    buttonTexts.some((text) => values.liveEdgeLabels?.includes(text)), noPlayerReason, {
      buttonLabels: buttonEvidence,
    });
  conditional(
    'player.go-to-live-labels',
    buttonTexts.some((text) => !values.liveEdgeLabels?.includes(text)
      && values.liveEdgeLabels?.some((label) => text.includes(label))),
    buttonTexts.some((text) => values.goToLivePhrases?.some((phrase) => text.includes(phrase))),
    'the player exposed no behind-live control in its current state',
    { buttonLabels: buttonEvidence },
  );
  conditional('player.theater-token', playerMounted, evidence.player.theaterTokenMatches.length > 0,
    noPlayerReason, { controlBarButtons: buttonEvidence });
  conditional(
    'player.theater-shortcut',
    evidence.player.theaterShortcutMatches.length > 0 || evidence.player.theaterTokenMatches.some((index) => {
      const button = evidence.player.buttons[index];
      return Boolean(button?.ariaLabel || button?.title);
    }),
    evidence.player.theaterShortcutMatches.length > 0,
    'the theater control exposed no accessible shortcut label',
    { controlBarButtons: buttonEvidence },
  );
  match('player.theater-state', evidence.player.theaterState === 'true' || evidence.player.theaterState === 'false', {
    dataTheatre: evidence.player.theaterState,
  });

  const navbarIndexMatch = evidence.navbar.navbars.some(
    (navbar) => navbar.childCount > values.navbarRightClusterIndex,
  );
  match('navbar.right-cluster-index', navbarIndexMatch, { navbars: evidence.navbar.navbars });
  match(
    'navbar.right-cluster-classes',
    navbarIndexMatch && evidence.navbar.navbars.some((navbar) =>
      values.navbarRightClusterClasses?.every((className) => navbar.rightClasses.includes(className))),
    { navbars: evidence.navbar.navbars },
  );

  conditional('panels.active-chatters-panel', evidence.panels.activePanel || evidence.panels.activeSearchAnywhere,
    evidence.panels.activePanel, 'the active-chatters panel was not open; the probe will not click an opener', {
      searchSelectorMatched: evidence.panels.activeSearchAnywhere,
    });
  conditional('panels.active-chatters-search', evidence.panels.activePanel, evidence.panels.activeSearch,
    'the active-chatters panel was not open; the probe will not click an opener', { panelMatched: true });
  conditional('panels.active-chatters-row', evidence.panels.activePanel, evidence.panels.activeRow,
    'the active-chatters panel was not open; the probe will not click an opener', { panelMatched: true });
  conditional('panels.active-chatters-username', evidence.panels.activePanel && evidence.panels.activeRow,
    evidence.panels.activeUsername, 'no active-chatter row was rendered', { rowMatched: evidence.panels.activeRow });
  conditional('panels.drops', evidence.panels.drops > 0, true,
    'the Drops panel was not open; the probe will not open or claim it', {});
  conditional('panels.rewards', evidence.panels.rewards > 0, true,
    'the rewards panel was not open; the probe will not open or claim it', {});
  const rewardAlternative = evidence.navbar.videoSources.filter((src) => /reward|daily|bonus/i.test(src));
  conditional('navbar.daily-reward-cta', evidence.navbar.dailyRewardCount > 0 || rewardAlternative.length > 0,
    evidence.navbar.dailyRewardCount > 0, 'no daily-reward CTA was rendered for this account/session', {
      videoSources: rewardAlternative,
    });

  match('network.pusher-socket', evidence.network.webSockets.includes(values.pusherUrl), {
    webSockets: evidence.network.webSockets,
  });
  for (const [id, key] of [
    ['network.chat-history', 'chatHistoryBaseUrl'],
    ['network.chat-history-start-time', 'chatHistoryStartTimeUrl'],
  ]) {
    // A request we never saw is not a changed endpoint. History backfill only fires under
    // conditions the probe does not control, so "no request at all" must be NOT_CHECKABLE — the
    // first live run reported both of these as MISS on an empty request list.
    // The family prefix and the query name are DERIVED from the production sample, never typed
    // here: a literal copied into the probe is the self-validating-fixture defect all over again.
    const sample = values[key];
    const familyPrefix = typeof sample === 'string' && sample.search(/\d+\/history/) > 0
      ? sample.slice(0, sample.search(/\d+\/history/))
      : '';
    const queryName = typeof sample === 'string' && sample.includes('?')
      ? sample.slice(sample.indexOf('?') + 1).split('=')[0]
      : null;
    const familyObserved = Boolean(familyPrefix) && evidence.network.requests.some((request) =>
      request.url.startsWith(familyPrefix) && (!queryName || request.url.includes(`${queryName}=`)));
    const matching = evidence.network.requests.find((request) => dynamicUrlMatches(request.url, sample));
    conditional(
      id,
      familyObserved,
      Boolean(matching && matching.status > 0 && ![404, 410].includes(matching.status)),
      queryName
        ? `no chat-history request carrying "${queryName}" was made during the probe window`
        : 'no chat-history request was made during the probe window',
      { requests: evidence.network.requests },
    );
  }

  return results;
}

export function summarizeAnchorResults(results) {
  return results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, { MATCH: 0, MISS: 0, UNLOADABLE: 0, NOT_CHECKABLE: 0 });
}
