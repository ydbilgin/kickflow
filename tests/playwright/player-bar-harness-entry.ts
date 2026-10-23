// Mounts the REAL production player controls into a page shell that reproduces Kick's own
// three-column desktop layout, so the control bar's width follows the VIEWPORT exactly the way
// it does on kick.com. The screenshot then compares our cluster against native chrome rather
// than against a blank page, and the width sweep in player-bar-visual.mjs can ask the only
// question that matters: does our cluster ever move a control Kick owns?
//
// data-snapshot: kick.com/eray 2026-09-05 (docs/RULING_kick_ui_layout.md §7.1-7.2), logged out,
// viewport 1024x760: sidebar rail 56px, chat column 340px, bar 628x44, bar padding 8px below xl.
// Native button tokens read out of Kick's bundle 2026-08-05:
//   ButtonIcon size:"xl" variant:"link" -> size-11 (44px), rounded (4px), bg-transparent,
//   text-xl + [&_svg]:size-[1em] (20px icon), [&_svg]:fill-current, active:scale-[0.95];
//   the surrounding group is `flex flex-row items-center gap-2 lg:gap-0`, and every Kick button
//   carries `shrink-0 grow-0`.
import { Lifecycle } from '../../src/content/shared/lifecycle';
import { initRewindControls } from '../../src/content/player/rewind-controls';
import { initLiveCatchup } from '../../src/content/player/live-catchup';
import { initSpeedControls } from '../../src/content/player/speed-controls';
import { initScreenshot, showFrameToast } from '../../src/content/player/screenshot';
import { showSeekRipple } from '../../src/content/player/rewind-controls';
import { initSeekBar } from '../../src/content/player/seek-bar';
import { shareNativeBarMountManager } from '../../src/content/player/native-bar';
import { setLang } from '../../src/content/shared/i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(window.location.search);
const recordedPlayer = params.has('vod');
// The cinema strip is on by default (feature flag floatingStrip); ?flat measures the fallback.
if (!params.has('flat')) document.documentElement.setAttribute('data-kickflow-strip', '');

function nativeIcon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function nativeButton(d: string, testid?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'native-btn';
  if (testid) button.setAttribute('data-testid', testid);
  button.append(nativeIcon(d));
  return button;
}

function nativeTextButton(label: string, testid: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'native-btn native-text-btn';
  button.setAttribute('data-testid', testid);
  button.textContent = label;
  return button;
}

const PAUSE = 'M6.5 4.5h3.5v15H6.5zM14 4.5h3.5v15H14z';
const VOLUME = 'M4 9.5h3.5L12 5.2v13.6L7.5 14.5H4zM15 8.6a5 5 0 0 1 0 6.8l1.5 1.4a7 7 0 0 0 0-9.6z';
const PIP = 'M3 5h18v14H3zm9 5h7v6h-7z';
const THEATRE = 'M3 6h18v12H3zm2 2v8h14V8z';
const FULLSCREEN = 'M4 4h6v2.6H6.6V10H4zm10 0h6v6h-2.6V6.6H14zM4 14h2.6v3.4H10V20H4zm13.4 0H20v6h-6v-2.6h3.4z';
const SETTINGS = 'M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm9 3.6-2.2 1.6.5 2.7-2.5 1.1-1.9-2-2.7.5-1-2.6-2.7-.5-.4-2.7L5.6 8l1.1-2.5 2.7.5L11 3.8l2.7.5 1.9-2 2.5 1.1-.5 2.7z';

document.body.innerHTML = '';

// Kick's desktop shell: a 56px collapsed rail, the player column, and a fixed-width chat column.
// The player column carries `min-width: 0` so it really shrinks with the viewport (otherwise the
// page would grow a horizontal scrollbar instead, and the bar would never get narrow), plus the
// `overflow: hidden` that Kick's own `div.grid-row-2` ancestor has — the box that makes a
// displaced control UNREACHABLE rather than merely ugly.
const shell = document.createElement('div');
shell.className = 'page-shell';

const sidebar = document.createElement('div');
sidebar.className = 'sidebar';

const playerColumn = document.createElement('div');
playerColumn.className = 'player-column';

const chatColumn = document.createElement('div');
chatColumn.className = 'chat-column';

const wrapper = document.createElement('div');
wrapper.className = 'player-wrapper';

const video = document.createElement('video');
video.id = 'video-player';
wrapper.append(video);

const bar = document.createElement('div');
bar.className = 'z-controls bottom-0 native-bar';

const leftCluster = document.createElement('div');
leftCluster.className = 'native-cluster flex flex-row items-center gap-2 lg:gap-0';
leftCluster.append(nativeButton(PAUSE), nativeButton(VOLUME));

const time = document.createElement('span');
time.className = 'native-time';
time.textContent = recordedPlayer ? '00:05 / 05:30:35' : '04:51:14';
leftCluster.append(time);

const liveButton = document.createElement('button');
liveButton.type = 'button';
liveButton.className = 'native-btn native-text-btn native-live';
liveButton.textContent = 'LIVE';
if (!recordedPlayer) leftCluster.append(liveButton);

// DOM order measured live 2026-09-05: PiP, Klip, theatre, fullscreen, settings cog. The cog is
// the one control with NO data-testid, which is why the ruling moves fullscreen past it instead
// of moving the cog left (R3).
const rightCluster = document.createElement('div');
rightCluster.className = leftCluster.className;
rightCluster.append(
  nativeButton(PIP, 'video-player-pip'),
  nativeTextButton('Klip', 'video-player-clip'),
  nativeButton(THEATRE, 'video-player-theatre-mode'),
  nativeButton(FULLSCREEN, 'video-player-fullscreen'),
  nativeButton(SETTINGS),
);
// The recorded player captured 2026-10-13 has an extra native speed-menu icon beside the cog.
// Its size follows the same ButtonIcon utility as the other native controls.
if (recordedPlayer) rightCluster.append(nativeButton(SETTINGS));

bar.append(leftCluster, rightCluster);
wrapper.append(bar);
playerColumn.append(wrapper);
shell.append(sidebar, playerColumn, chatColumn);
document.body.append(shell);

setLang('tr');

const session = new Lifecycle();
initRewindControls(session);
initLiveCatchup(session);
const speed = new Lifecycle();
shareNativeBarMountManager(speed, session);
initSpeedControls(speed);
const shot = new Lifecycle();
shareNativeBarMountManager(shot, session);
initScreenshot(shot);
const seek = new Lifecycle();
shareNativeBarMountManager(seek, session);
initSeekBar(seek);

// Drive the behind-live state so the amber treatment is on screen too. The production code
// only writes it from a timeupdate, so raise a real one against a fake media clock.
Object.defineProperties(video, {
  duration: { configurable: true, value: Infinity },
  currentTime: { configurable: true, value: 120, writable: true },
  buffered: {
    configurable: true,
    value: { length: 1, start: () => 0, end: () => 124 } as unknown as TimeRanges,
  },
  seekable: {
    configurable: true,
    value: { length: 1, start: () => 0, end: () => 2 ** 30 } as unknown as TimeRanges,
  },
});

(window as unknown as { kickflowShowBehind: (on: boolean) => void }).kickflowShowBehind = (on) => {
  (video as unknown as { currentTime: number }).currentTime = on ? 120 : 124;
  video.dispatchEvent(new Event('timeupdate'));
};

// Screenshot-only hooks for the design comparison (player-bar-visual.mjs --shots). The toast is
// fed a tiny inline image because the fixture's <video> has no decoded frame to capture.
const sampleFrame = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#2b3a4d"/><stop offset="1" stop-color="#6b5536"/></linearGradient></defs>'
  + '<rect width="64" height="36" fill="url(#g)"/></svg>');
(window as unknown as { kickflowMoment: (name: string) => void }).kickflowMoment = (name) => {
  if (name === 'ripple') showSeekRipple(-10);
  if (name === 'toast') showFrameToast(sampleFrame, 'ornek_kanal_083859.png');
};

// The media properties above are defined after init, so raise one tick to render the initial
// state; production gets this from real playback within ~250ms.
video.dispatchEvent(new Event('timeupdate'));
