import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  collectKickAnchorEvidence,
  evaluateKickAnchorResults,
} from './kick-anchor-checks.mjs';

// The harness lives beside its test, under `tests/`, NOT under `output/` — `.gitignore:21`
// ignores `output/` wholesale, so a harness placed there is absent from a fresh clone while this
// tracked test still imports it, and the suite breaks for the next person. Only the generated
// JSON result belongs in `output/`.
const repoRoot = path.resolve('.');
const fixturePath = path.join(repoRoot, 'tests', 'playwright', 'kick-anchor-fixture.html');
const loaderUrl = pathToFileURL(path.join(repoRoot, 'tests', 'playwright', 'kick-anchor-loader.mjs')).href;
const execFileAsync = promisify(execFile);
let fixtureHtml;
let anchorLoad;

beforeAll(async () => {
  const loaderProgram = `import { loadProductionAnchors } from ${JSON.stringify(loaderUrl)};`
    + ` process.stdout.write(JSON.stringify(await loadProductionAnchors(${JSON.stringify(repoRoot)})));`;
  const loaded = execFileAsync(process.execPath, ['--input-type=module', '--eval', loaderProgram], {
    cwd: repoRoot,
    maxBuffer: 2 * 1024 * 1024,
  });
  [fixtureHtml, anchorLoad] = await Promise.all([
    readFile(fixturePath, 'utf8'),
    loaded.then(({ stdout }) => JSON.parse(stdout)),
  ]);
});

beforeEach(() => {
  document.open();
  document.write(fixtureHtml);
  document.close();
  const row = document.querySelector('[data-probe-react-key]');
  const key = row?.getAttribute('data-probe-react-key');
  if (!row || !key) throw new Error('fixture React-key carrier is missing');
  Object.defineProperty(row, `${anchorLoad.values.reactFiberPrefix}fixture`, {
    configurable: true,
    value: { key },
  });
});

function fixtureObservations() {
  return {
    webSockets: [anchorLoad.values.pusherUrl],
    requests: [
      { url: anchorLoad.values.chatHistoryBaseUrl, status: 200 },
      { url: anchorLoad.values.chatHistoryStartTimeUrl, status: 200 },
    ],
  };
}

function runFixture() {
  const evidence = collectKickAnchorEvidence({
    anchors: anchorLoad.values,
    observations: fixtureObservations(),
  });
  return evaluateKickAnchorResults(anchorLoad, evidence);
}

describe('Kick live-anchor probe fixture', () => {
  it('reports MATCH for every checkable production anchor', () => {
    const results = runFixture();

    expect(results).toHaveLength(31);
    expect(results.every((result) => result.status === 'MATCH')).toBe(true);
  });

  it('reports exactly one MISS when one fixture anchor is renamed', () => {
    const rewardVideo = document.querySelector('button[aria-label="Daily reward"] video');
    if (!(rewardVideo instanceof HTMLVideoElement)) throw new Error('fixture daily-reward video is missing');
    rewardVideo.src = 'https://files.kick.com/daily-bonus-cta.webm';

    const results = runFixture();
    const misses = results.filter((result) => result.status === 'MISS');

    expect(misses.map((result) => result.id)).toEqual(['navbar.daily-reward-cta']);
    expect(results.filter((result) => result.status === 'MATCH')).toHaveLength(results.length - 1);
  });

  // Regression for the probe's OWN first live run (2026-08-28). It landed mid-pre-roll, found only
  // `https://static.kick.com/ads/black_2s.mp4` and an empty control bar, and reported six player
  // anchors as MISS — every one of which had been verified matching on the same site an hour
  // earlier. A probe that cries wolf is exactly as useless as one that stays silent, so a page
  // with no mounted player must produce no MISS at all.
  it('reports NOT_CHECKABLE, never MISS, when the player never mounted', () => {
    const video = document.querySelector('#video-player');
    if (!(video instanceof HTMLVideoElement)) throw new Error('fixture player video is missing');
    video.removeAttribute('id');
    video.setAttribute('src', 'https://static.kick.com/ads/black_2s.mp4');
    for (const bar of document.querySelectorAll('div.z-controls')) bar.remove();

    const results = runFixture();
    const statusById = new Map(results.map((result) => [result.id, result.status]));

    expect(results.filter((result) => result.status === 'MISS')).toEqual([]);
    for (const id of [
      'player.video',
      'player.control-bar-fallback',
      'player.control-bar-bottom',
      'player.settings-cog-paths',
      'player.live-edge-labels',
      'player.theater-token',
    ]) {
      expect(statusById.get(id)).toBe('NOT_CHECKABLE');
    }
  });

  // Same failure shape on the network anchors: history backfill fires under conditions the probe
  // does not control, and the first live run called an empty request list a changed endpoint.
  it('reports NOT_CHECKABLE for a chat-history endpoint that was never requested', () => {
    const evidence = collectKickAnchorEvidence({
      anchors: anchorLoad.values,
      observations: { webSockets: [anchorLoad.values.pusherUrl], requests: [] },
    });
    const statusById = new Map(
      evaluateKickAnchorResults(anchorLoad, evidence).map((result) => [result.id, result.status]),
    );

    expect(statusById.get('network.chat-history')).toBe('NOT_CHECKABLE');
    expect(statusById.get('network.chat-history-start-time')).toBe('NOT_CHECKABLE');
  });
});
