// Shared player-bar chrome: idle timing, icon factories, and the layout rules
// a second player bar needs when Kick's own bar is not on the page.
// Colours, 44px boxes, the gradient and the fade live in the stylesheet.
// 2026-10-28.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Native Kick measured 2026-10-22: approximately four seconds including its fade.
export const CONTROLS_IDLE_MS = 4000;
export const STRIP_ATTRIBUTE = 'data-kickflow-strip';
export const STEP_SECONDS = 10;
export const FALLBACK_LAYOUT_STYLE_ID = 'kickflow-fallback-layout';

export function inBottomArea(rect, x, y, barHeight = 80) {
  const depth = Math.min(rect.height / 3, Math.max(96, barHeight + 16));
  return x >= rect.left && x <= rect.right && y <= rect.bottom && y >= rect.bottom - depth;
}

function svgShell() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export function createTransportIcon(pathData) {
  const svg = svgShell();
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

const STEP_RING = 'M4.84 6.63A8.95 8.95 0 1 1 3.05 12H4.95A7.05 7.05 0 1 0 6.36 7.77z';
const STEP_ARROW = 'M4.35 3.4h1.9v3.25h3.25v1.9H4.35z';

export function createStepIcon(direction) {
  const svg = svgShell();
  const arrow = document.createElementNS(SVG_NS, 'g');
  if (direction === 'forward') arrow.setAttribute('transform', 'matrix(-1 0 0 1 24 0)');
  for (const pathData of [STEP_RING, STEP_ARROW]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    arrow.append(path);
  }
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', direction === 'forward' ? '11.7' : '12.3');
  label.setAttribute('y', '15.3');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('class', 'kickflow-player-btn__step');
  label.textContent = String(STEP_SECONDS);
  svg.append(arrow, label);
  return svg;
}

export function createCameraIcon() {
  const svg = svgShell();
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute(
    'd',
    'M9.1 4h5.8a1 1 0 0 1 .83.45L16.74 6H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 6h2.26l1.01-1.55A1 1 0 0 1 9.1 4z'
      + 'M12 9.5a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z',
  );
  svg.append(body);
  return svg;
}

export function createToLiveIcon() {
  const svg = svgShell();
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4.5 6.2v11.6a.7.7 0 0 0 1.1.6l8-5.8a.7.7 0 0 0 0-1.2l-8-5.8a.7.7 0 0 0-1.1.6ZM17 5.5h1.2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H17a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z');
  svg.append(path);
  return svg;
}

function filledIcon(pathData) {
  return createTransportIcon(pathData);
}

/** FINAL icons.svg #i-bolt, shown only while auto catch-up runs faster than 1x. */
export function createBoltIcon() {
  const svg = filledIcon('M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6Z');
  svg.setAttribute('class', 'kickflow-speed-btn__bolt');
  return svg;
}

/** Three filled dots, matching Kick's `[&_svg]:fill-current` 20px bar icons. */
export function createOverflowIcon() {
  return filledIcon(
    'M6 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z'
      + 'M12 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z'
      + 'M18 9.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z',
  );
}

/** A screen with a smaller window in its corner (picture-in-picture). */
export function createPipIcon() {
  return filledIcon(
    'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'
      + 'M5 6v12h14V6z'
      + 'M12 12.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5z',
  );
}

/** A filled cog, the settings button that opens the quality menu. */
export function createGearIcon() {
  return filledIcon(
    'M10.3 2h3.4l.5 2.6a7.6 7.6 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a7.7 7.7 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9'
      + 'a7.6 7.6 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a7.6 7.6 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a7.7 7.7 0 0 1 0-2.2'
      + 'l-2-1.7 1.7-2.9 2.5.9a7.6 7.6 0 0 1 1.9-1.1z'
      + 'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
  );
}

export const FALLBACK_BAR_CSS = `
.kickflow-fallback-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  min-height: 44px;
  pointer-events: auto;
}
.kickflow-fallback-bar input[type="range"] {
  width: 72px;
  margin: 0 8px;
  flex: 0 0 auto;
  accent-color: var(--kf-green, #53fc18);
  cursor: pointer;
}
.kickflow-fallback-spacer {
  flex: 1 1 auto;
  min-width: 8px;
}
/* Our display rules would otherwise beat the hidden attribute (quality chip, PiP, overflow). */
.kickflow-fallback-bar [hidden] { display: none !important; }
.kickflow-quality-btn {
  gap: 6px;
}
.kickflow-quality-btn__sub {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
  color: rgba(242,246,242,0.72);
}
.kickflow-quality-btn--held { color: #c8ffb2; }
.kickflow-quality-btn--held .kickflow-quality-btn__sub { color: inherit; }
.kickflow-quality-btn--held::after {
  inset: 6px 1px;
  border-radius: 9px;
  background: rgba(83,252,24,0.10);
  box-shadow: inset 0 0 0 1px rgba(83,252,24,0.42);
}
.kickflow-quality-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 248px;
}
.kickflow-quality-menu__head {
  padding: 2px 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(242,246,242,0.62);
}
.kickflow-quality-menu__item {
  appearance: none;
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: 600 14px/1 'Inter','Segoe UI',system-ui,sans-serif;
  font-variant-numeric: tabular-nums;
}
.kickflow-quality-menu__item:hover:not([aria-checked="true"]) {
  background: rgba(255,255,255,0.10);
}
.kickflow-quality-menu__item[aria-checked="true"] {
  background: #53fc18;
  color: #071a04;
}
.kickflow-quality-menu__item:focus-visible,
.kickflow-quality-menu__more:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #53fc18;
}
.kickflow-quality-menu__intent {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  min-height: 44px;
  padding: 6px 10px;
}
.kickflow-quality-menu__intent b { font-size: 14px; font-weight: 700; }
.kickflow-quality-menu__intent small {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: rgba(242,246,242,0.62);
}
.kickflow-quality-menu__intent[aria-checked="true"] small { color: rgba(7,26,4,0.75); }
.kickflow-quality-menu__sep {
  height: 1px;
  margin: 4px 0;
  background: rgba(220,255,226,0.16);
}
.kickflow-quality-menu__more {
  appearance: none;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(242,246,242,0.72);
  cursor: pointer;
  text-align: left;
  font: 600 13px/1 'Inter','Segoe UI',system-ui,sans-serif;
}
.kickflow-quality-menu__more:hover { background: rgba(255,255,255,0.08); }
.kickflow-quality-menu__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 4px;
}
.kickflow-quality-menu__grid[hidden] { display: none; }
.kickflow-quality-menu__exact {
  justify-content: center;
  padding: 0;
  background: rgba(255,255,255,0.04);
  text-align: center;
}
`.trim();

export function ensureFallbackChrome() {
  if (document.getElementById('kickflow-styles') || document.getElementById(FALLBACK_LAYOUT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FALLBACK_LAYOUT_STYLE_ID;
  style.textContent = FALLBACK_BAR_CSS;
  const parent = document.head || document.documentElement;
  if (parent) parent.append(style);
}

// The plate's right end (rounded corner + border) sits on the last group of a run of plate
// groups. That used to be `:not(:has(+ .kickflow-player-group…))`, a sibling :has() which made
// every DOM insertion on the page (each chat row) restyle the whole document: 66 ms per row in
// own-chat mode, measured 2026-11-09. The bar's owners call this after every change to the bar
// instead; it reproduces the selector exactly (next ELEMENT sibling, hidden or not).
export const PLATE_END_CLASS = 'kickflow-player-group--plate-end';
const PLATE_CHIP_GROUP_ID = 'kickflow-catchup-controls';

function onPlate(element) {
  return !!element && element.classList.contains('kickflow-player-group')
    && (element.id !== PLATE_CHIP_GROUP_ID || element.classList.contains('kickflow-player-group--chip'));
}

export function syncPlateRunEnds(container) {
  if (!container) return;
  for (let element = container.firstElementChild; element; element = element.nextElementSibling) {
    if (!element.classList.contains('kickflow-player-group')) continue;
    const end = onPlate(element) && !onPlate(element.nextElementSibling);
    if (element.classList.contains(PLATE_END_CLASS) !== end) element.classList.toggle(PLATE_END_CLASS, end);
  }
}
