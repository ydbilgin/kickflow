// Behaviour the two player bars share. KickFlow mounts its controls into Kick's own bar
// (TypeScript, bundled, isolated world); a fallback player draws a whole bar of
// its own (plain JS, page world). A second build copies THIS file unbundled into the
// fallback module, so it must import nothing and must not touch chrome.* or i18n: callers
// pass the host element, the video and the words. 2026-10-29.
//
// Moved here, unchanged in behaviour, from speed-controls.ts (rates), live-catchup.ts
// (catch-up decision), bar-budget.ts (width plan), player-menu.ts (popup) and local-clip.ts
// (15 s recorder) so the fallback bar runs the same code instead of a copy.

export const NORMAL_PLAYBACK_RATE = 1;

// --- Speed ---------------------------------------------------------------------------------

export const SPEED_RATES = Object.freeze([3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25]);
/** The menu's 3 x 3 grid reads slow to fast, left to right (FINAL design 2026-10-18). */
export const SPEED_GRID_RATES = Object.freeze([...SPEED_RATES].reverse());
export const SPEED_GRID_COLUMNS = 3;

export function formatPlaybackRate(rate, lang) {
  const text = Number.isInteger(rate) ? rate.toFixed(0) : String(rate);
  return `${lang === 'tr' ? text.replace('.', ',') : text}×`;
}

export function displayObservedRate(rate, lang) {
  const known = [NORMAL_PLAYBACK_RATE, ...SPEED_RATES];
  const nearest = known.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best);
  return Math.abs(nearest - rate) <= 0.03
    ? formatPlaybackRate(nearest, lang)
    : formatPlaybackRate(Number(rate.toFixed(2)), lang);
}

// --- Live catch-up -------------------------------------------------------------------------

export const CATCHUP_PLAYBACK_RATE = 1.5;
export const BEHIND_THRESHOLD_SECONDS = 3;
/** The chip, once shown, stays until the gap is clearly closed, so a player hovering around the
 * threshold does not make the chip (and the bar budget behind it) flicker. */
export const CHIP_HIDE_SECONDS = 2.5;
export const CAUGHT_UP_THRESHOLD_SECONDS = 1.5;

// Buffer guard (field report 2026-10-29: the player showed loading now and then and sometimes froze).
// The live-edge reading can sit ahead of what the player has actually downloaded, so "1.5 s
// behind the edge" may mean "no media left". At 1.5x the player also needs 1.5x the download
// rate. Catch-up therefore starts only with media loaded ahead of the playhead, stops before
// that buffer runs dry, and stays off after a rebuffer: 1 minute after the first, doubling with
// each further rebuffer on the same video element, up to 16 minutes.
export const CATCHUP_MIN_START_BUFFER_SECONDS = 1;
export const CATCHUP_MIN_KEEP_BUFFER_SECONDS = 0.5;
export const CATCHUP_STALL_HOLD_MS = 60_000;
export const CATCHUP_MAX_STALL_HOLD_MS = 16 * 60_000;

/** How long auto catch-up stays off after the n-th rebuffer (n >= 1) on one video element. */
export function stallHoldMs(stalls) {
  const n = Math.max(1, Math.floor(stalls));
  return Math.min(CATCHUP_MAX_STALL_HOLD_MS, CATCHUP_STALL_HOLD_MS * 2 ** (n - 1));
}

/** A seek can emit waiting after seeked, when video.seeking is already false. Keep that
 * recovery separate from starvation until playback actually resumes. A warm, in-buffer seek
 * may emit no playing event, so advancing media time also ends recovery. State is per element
 * so a replacement player never inherits an unfinished seek. This does not clear a real stall's hold. */
export function createSeekRecoveryTracker() {
  const recovering = new WeakMap();
  return (type, video) => {
    if (type === 'loadstart' || (type === 'playing' && !video.seeking)) {
      recovering.delete(video);
    } else if (type === 'seeking') {
      recovering.set(video, null);
    } else if (type === 'seeked') {
      recovering.set(video, video.currentTime);
    } else if (type === 'timeupdate' && !video.seeking && !video.paused && video.readyState >= 3) {
      const position = recovering.get(video);
      if (typeof position === 'number' && video.currentTime > position + 0.05) recovering.delete(video);
    }
    return video.seeking || recovering.has(video);
  };
}

export function decideCatchup(input) {
  if (!input.behindPlausible) return { kind: 'none' };

  if (input.mode === 'manual') {
    if (input.manualRate > NORMAL_PLAYBACK_RATE && input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
      return { kind: 'manualDropToNormal' };
    }
    return { kind: 'none' };
  }

  const measured = input.bufferAhead !== undefined;
  const buffer = input.bufferAhead ?? 0;
  if (input.stallHold) {
    return input.catchingUp ? { kind: 'setRate', rate: NORMAL_PLAYBACK_RATE } : { kind: 'none' };
  }
  if (!input.catchingUp && input.behindBy > BEHIND_THRESHOLD_SECONDS) {
    if (measured && buffer < CATCHUP_MIN_START_BUFFER_SECONDS) return { kind: 'none' };
    return { kind: 'setRate', rate: CATCHUP_PLAYBACK_RATE };
  }
  if (input.catchingUp && input.behindBy <= CAUGHT_UP_THRESHOLD_SECONDS) {
    return { kind: 'setRate', rate: NORMAL_PLAYBACK_RATE };
  }
  if (input.catchingUp && measured && buffer < CATCHUP_MIN_KEEP_BUFFER_SECONDS) {
    return { kind: 'setRate', rate: NORMAL_PLAYBACK_RATE };
  }
  return { kind: 'none' };
}

/** Seconds loaded ahead of the playhead in the buffered range that holds it; null when the
 * playhead sits in no loaded range (the player is about to rebuffer). */
export function bufferAheadSeconds(video) {
  const time = video.currentTime;
  if (!Number.isFinite(time)) return null;
  const ranges = video.buffered;
  if (!ranges) return null;
  for (let index = 0; index < ranges.length; index++) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    // A small tolerance: players often park the playhead a few ms before a range start.
    if (time >= start - 0.1 && time <= end) {
      const ahead = end - time;
      return Number.isFinite(ahead) ? Math.max(0, ahead) : null;
    }
  }
  return null;
}

// --- Width budget --------------------------------------------------------------------------

/**
 * Pure arithmetic: no DOM, no constants of its own. Given the free space and what each control
 * really costs, which controls stay in the bar and which collapse into the overflow menu.
 * A control whose cost is 0 was not measurable; collapsing one would free nothing, so it is
 * never chosen — we only ever hide a control we can PROVE does not fit.
 */
export function planBarBudget(input) {
  const ids = input.controls.map((control) => control.id);
  const total = input.controls.reduce((sum, control) => sum + control.cost, 0);
  if (total <= input.free) return { mounted: ids, collapsed: [], overflow: false };
  // Not even the overflow button fits: mount nothing rather than displace the player's own
  // controls; the actions stay on their hotkeys.
  if (input.overflowCost > input.free) return { mounted: [], collapsed: ids, overflow: false };

  const costs = new Map(input.controls.map((control) => [control.id, control.cost]));
  const budget = input.free - input.overflowCost;
  const collapsed = new Set();
  let needed = total;

  // Named priority first, then anything the priority list does not mention, in bar order.
  for (const id of [...input.collapseOrder, ...ids]) {
    if (needed <= budget) break;
    const cost = costs.get(id) ?? 0;
    if (cost <= 0 || collapsed.has(id)) continue;
    collapsed.add(id);
    needed -= cost;
  }

  return {
    mounted: ids.filter((id) => !collapsed.has(id)),
    collapsed: ids.filter((id) => collapsed.has(id)),
    overflow: true,
  };
}

export function samePlan(left, right) {
  return left.overflow === right.overflow
    && left.mounted.join() === right.mounted.join()
    && left.collapsed.join() === right.collapsed.join();
}

// --- Popup menu ----------------------------------------------------------------------------

const HOST_CHECK_INTERVAL_MS = 250;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The one popup mechanism the player controls share: hosted inside the player (so it survives
 * fullscreen), positioned above its button from the button's live rect, and closed by every
 * event that can invalidate that position. `host()` names the player element; no host means
 * no menu, so the popup never escapes to `document.body`, where fullscreen would hide it.
 */
export class PlayerMenu {
  constructor(options) {
    this.options = options;
    this.element = null;
    this.disposers = [];
  }

  get isOpen() {
    return this.element !== null;
  }

  toggle(anchor) {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open(anchor);
  }

  open(anchor) {
    const host = document.fullscreenElement ?? this.options.host?.() ?? null;
    if (!host) return;
    this.close();

    const menu = document.createElement('div');
    menu.className = `kickflow-player-menu ${this.options.className}`;
    menu.setAttribute('role', 'menu');
    menu.style.visibility = 'hidden';
    this.options.fill(menu);

    host.append(menu);
    this.element = menu;
    this.position(menu, anchor);
    this.bindClosers(menu, anchor);
    const focusTarget = this.options.initialFocus?.(menu);
    focusTarget?.focus({ preventScroll: true });
  }

  close() {
    if (!this.element) return;
    this.element.remove();
    this.element = null;
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  position(menu, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const left = clamp(
      anchorRect.left + anchorRect.width / 2 - menuWidth / 2,
      VIEWPORT_MARGIN_PX,
      window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX,
    );
    menu.style.left = `${Math.round(left)}px`;
    menu.style.bottom = `${Math.round(window.innerHeight - anchorRect.top + VIEWPORT_MARGIN_PX)}px`;
    menu.style.visibility = '';
  }

  bindClosers(menu, anchor) {
    this.listen(document, 'pointerdown', (event) => {
      const target = event.target;
      if (target instanceof Node) {
        if (menu.contains(target) || anchor.contains(target)) return;
        // A click in ANOTHER player menu is not "outside": the overflow menu hosts the real
        // speed button, so its own submenu must not count as dismissing its host.
        const element = target instanceof Element ? target : target.parentElement;
        if (element?.closest('.kickflow-player-menu')) return;
      }
      this.close();
    }, true);
    this.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Esc from inside the menu hands focus back to the button that opened it.
      const hadFocus = menu.contains(document.activeElement);
      this.close();
      if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    });
    // A resize or a fullscreen switch moves the anchor; a re-render disconnects it.
    this.listen(window, 'resize', () => this.close());
    this.listen(document, 'fullscreenchange', () => this.close());

    const timer = window.setInterval(() => {
      if (!anchor.isConnected) this.close();
    }, HOST_CHECK_INTERVAL_MS);
    this.disposers.push(() => window.clearInterval(timer));
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.disposers.push(() => target.removeEventListener(type, listener, options));
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// --- Quality (design B, 2026-10-29) ----------------------------------------------------------
//
// One quality choice for both bars. Three plain intents, the exact renditions one tap deeper,
// and a chip on the bar that names what is playing. The mode is 'best', 'auto', 'saver', or
// an exact rendition label such as '720p60'. Applying a mode is each bar's own job: the
// native bar selects a row in Kick's own quality menu, the fallback bar sets an hls.js level.

export const QUALITY_INTENTS = Object.freeze(['best', 'auto', 'saver']);
export const DEFAULT_QUALITY_MODE = 'best';
/** "Veri tasarrufu": the highest rendition at or below this height. */
export const SAVER_MAX_HEIGHT = 480;
/** The native bar's content script writes the effective mode here, on <html>, so the fallback
 * bar (page world, no extension storage) starts with the same choice. */
export const QUALITY_ATTRIBUTE = 'data-kickflow-quality';

// A rendition row like "1080p60" / "2160p50" / "480p". Exact match on purpose: it excludes
// "Auto" and login-gated rows, whose text carries a trailing badge ("1080p60Login required").
const RESOLUTION_LABEL = /^(\d{3,4})p(?:\s*(\d{2,3})(?:\s*fps)?)?(?:\s*\((?:source|original|kaynak|orijinal)\))?$/i;
const SOURCE_LABEL = /^(source|original|kaynak|orijinal)$/i;
const AUTO_LABEL = /^(auto|otomatik|oto)$/i;
const MODE_LABEL = /^(\d{3,4})p(\d{2,3})?$/;

/** A stored or picked mode, or null. 'highest' is the value the old "Highest quality" setting
 * stored (kickflow.qualityPreference); it means the same as 'best'. */
export function normalizeQualityMode(value) {
  if (value === 'highest') return 'best';
  if (QUALITY_INTENTS.includes(value)) return value;
  return typeof value === 'string' && MODE_LABEL.test(value) ? value : null;
}

/** Orders renditions: Source above everything, then height, then frame rate. -1 = not a
 * selectable rendition (Auto, a login-gated row, anything else). */
export function qualityScore(text) {
  const label = String(text ?? '').trim();
  if (SOURCE_LABEL.test(label)) return Number.MAX_SAFE_INTEGER;
  const match = label.match(RESOLUTION_LABEL);
  return match ? parseInt(match[1], 10) * 1000 + Number(match[2] || 0) : -1;
}

/** Height in pixels; Source counts as taller than any numbered row; null = not a rendition. */
export function qualityHeight(text) {
  const label = String(text ?? '').trim();
  if (SOURCE_LABEL.test(label)) return Number.POSITIVE_INFINITY;
  const match = label.match(RESOLUTION_LABEL);
  return match ? parseInt(match[1], 10) : null;
}

export function isAutoQualityLabel(text) {
  return AUTO_LABEL.test(String(text ?? '').trim());
}

/** The short form a rendition is stored and shown as ("720p60", "480p"); null for Source and
 * for anything that is not a rendition. */
export function qualityModeLabel(text) {
  const label = String(text ?? '').trim();
  if (SOURCE_LABEL.test(label)) return null;
  const match = label.match(RESOLUTION_LABEL);
  return match ? `${parseInt(match[1], 10)}p${match[2] ? Number(match[2]) : ''}` : null;
}

/** The same short form for an hls.js level: Kick writes the frame rate only above 30. */
export function qualityLabelForLevel(level) {
  const height = Number(level?.height);
  if (!(height > 0)) return null;
  const fps = Math.round(Number(level?.frameRate) || 0);
  return `${height}p${fps > 30 ? fps : ''}`;
}

/**
 * Which of `labels` a mode selects. Returns the index, -1 for "let the player choose" (auto),
 * or null when no label is a selectable rendition.
 * best: the highest. saver: the highest at or below SAVER_MAX_HEIGHT, else the lowest.
 * An exact label: that rendition, else the nearest one below it, else the lowest.
 */
export function pickQuality(mode, labels) {
  if (mode === 'auto') return -1;
  const scored = [];
  labels.forEach((label, index) => {
    const score = qualityScore(label);
    if (score >= 0) scored.push({ index, score, height: qualityHeight(label), short: qualityModeLabel(label) });
  });
  if (!scored.length) return null;
  const highest = (list) => list.reduce((best, item) => (item.score > best.score ? item : best));
  const lowest = (list) => list.reduce((best, item) => (item.score < best.score ? item : best));
  if (mode === 'saver') {
    const within = scored.filter((item) => item.height <= SAVER_MAX_HEIGHT);
    return (within.length ? highest(within) : lowest(scored)).index;
  }
  if (mode !== 'best' && normalizeQualityMode(mode)) {
    const exact = scored.find((item) => item.short === mode);
    if (exact) return exact.index;
    const target = qualityScore(mode);
    const below = scored.filter((item) => item.score <= target);
    return (below.length ? highest(below) : lowest(scored)).index;
  }
  return highest(scored).index;
}

/** Chip text: the rendition playing now, and the mode's short word (for an exact pick only the
 * optional words.subExact, which the native bar sets while the pick is for this stream only). */
export function qualityChipParts(mode, current, words) {
  const sub = mode === 'best' ? words.subBest
    : mode === 'auto' ? words.subAuto
      : mode === 'saver' ? words.subSaver : words.subExact || '';
  return { value: current || words.chip, sub };
}

const paintedChips = new WeakMap();

/** Paints the bar chip. Writes the DOM only when the visible text changes. */
export function paintQualityChip(button, mode, current, words) {
  const { value, sub } = qualityChipParts(mode, current, words);
  const label = `${words.title}: ${value}${sub ? ` ${sub}` : ''}`;
  if (paintedChips.get(button) === label) return;
  paintedChips.set(button, label);
  const text = document.createElement('span');
  text.className = 'kickflow-quality-btn__value';
  text.textContent = value;
  const parts = [text];
  if (sub) {
    const small = document.createElement('small');
    small.className = 'kickflow-quality-btn__sub';
    small.textContent = sub;
    parts.push(small);
  }
  button.replaceChildren(...parts);
  // Framed like a hand-picked speed whenever a rendition is held; plain while the player chooses.
  button.classList.toggle('kickflow-quality-btn--held', mode !== 'auto');
  button.setAttribute('aria-label', label);
  button.title = words.title;
}

/** The bar chip itself: same box as the speed button, its own state class. */
export function createQualityButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kickflow-speed-btn kickflow-quality-btn';
  button.setAttribute('aria-haspopup', 'menu');
  return button;
}

/**
 * Fills a PlayerMenu with the design-B quality menu: the three intents, then
 * "Other resolutions" which unfolds the exact renditions. `renditions` are short labels, highest
 * first; an empty list hides the fold. `onPick(mode)` receives the chosen mode.
 */
export function fillQualityMenu(menu, { mode, current, renditions, words, onPick }) {
  menu.setAttribute('aria-label', words.title);
  const head = document.createElement('div');
  head.className = 'kickflow-quality-menu__head';
  head.textContent = words.title;
  menu.append(head);

  const row = (value, title, hint, className) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `kickflow-quality-menu__item ${className}`;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(mode === value));
    item.setAttribute('data-quality-mode', value);
    const name = document.createElement('b');
    name.textContent = title;
    item.append(name);
    if (hint) {
      const small = document.createElement('small');
      small.textContent = hint;
      item.append(small);
    }
    item.addEventListener('click', () => onPick(value));
    return item;
  };
  menu.append(
    row('best', words.best, words.bestHint(current), 'kickflow-quality-menu__intent'),
    row('auto', words.auto, words.autoHint, 'kickflow-quality-menu__intent'),
    row('saver', words.saver, words.saverHint, 'kickflow-quality-menu__intent'),
  );
  if (!renditions.length) return;

  const separator = document.createElement('div');
  separator.className = 'kickflow-quality-menu__sep';
  separator.setAttribute('role', 'separator');
  const exactPicked = !QUALITY_INTENTS.includes(mode);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'kickflow-quality-menu__more';
  more.textContent = `${words.more} ›`;
  more.setAttribute('aria-expanded', String(exactPicked));
  const grid = document.createElement('div');
  grid.className = 'kickflow-quality-menu__grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', words.more);
  grid.hidden = !exactPicked;
  for (const label of renditions) grid.append(row(label, label, '', 'kickflow-quality-menu__exact'));
  more.addEventListener('click', () => {
    grid.hidden = !grid.hidden;
    more.setAttribute('aria-expanded', String(!grid.hidden));
    if (!grid.hidden) grid.querySelector('button')?.focus({ preventScroll: true });
  });
  menu.append(separator, more, grid);
}

/** Rendition labels for the fold: distinct short labels, highest first. */
export function qualityRenditions(labels) {
  const seen = new Set();
  return labels
    .map((label) => ({ short: qualityModeLabel(label), score: qualityScore(label) }))
    .filter((item) => item.short && !seen.has(item.short) && seen.add(item.short))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.short);
}

// --- Frame and clip capture ----------------------------------------------------------------

export const CLIP_SECONDS = 15;
export const CLIP_VIDEO_BITS_PER_SECOND = 3_000_000;
const STATUS_MS = 4000;

/** `<slug>_<ISO stamp>[_n].<ext>`: filesystem-safe and sortable; two captures in the same
 * millisecond get a suffix instead of overwriting each other. */
export function createCaptureNamer() {
  let lastStamp = '';
  let suffix = 0;
  return (pathname, extension, now = new Date()) => {
    const slug = String(pathname || '').split('/').filter(Boolean)[0]?.replace(/[^a-z0-9_-]/gi, '') || 'kick';
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    suffix = stamp === lastStamp ? suffix + 1 : 0;
    lastStamp = stamp;
    return `${slug}_${stamp}${suffix ? `_${suffix}` : ''}.${extension}`;
  };
}

/** One short status line over the player. At most one; it removes itself. */
export function showCaptureStatus(host, text) {
  if (!host) return;
  host.querySelector('.kickflow-capture-status')?.remove();
  const status = document.createElement('div');
  status.className = 'kickflow-capture-status';
  status.setAttribute('role', 'status');
  status.textContent = text;
  host.append(status);
  window.setTimeout(() => status.remove(), STATUS_MS);
}

/**
 * The local 15 s recorder: records the next CLIP_SECONDS of the playing picture with
 * MediaRecorder, then shows a preview with a save link. No account, no network.
 * options: getVideo(), getHost(), filename(ext), text(key) for the keys
 * clip_stop, clip_record, clip_preview, clip_save, clip_ready, clip_recording,
 * clip_unsupported, capture_no_frame, capture_failed, close; title(recording) optional;
 * scope names this recorder's buttons, so two bars on one page never repaint each
 * other's button.
 */
export function createLocalClip(options) {
  let recorder = null;
  let stream = null;
  let timeout = null;
  let previewUrl = null;
  let generation = 0;
  const scope = options.scope ?? 'kickflow';
  const say = (key) => showCaptureStatus(options.getHost(), options.text(key));
  const title = () => options.title ? options.title(!!recorder) : options.text(recorder ? 'clip_stop' : 'clip_record');

  const refreshButtons = () => {
    for (const button of document.querySelectorAll(`[data-kickflow-local-clip="${scope}"]`)) {
      button.textContent = recorder ? '■' : '●';
      button.setAttribute('aria-pressed', String(!!recorder));
      button.title = title();
      button.setAttribute('aria-label', button.title);
    }
  };
  const releaseStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (timeout !== null) window.clearTimeout(timeout);
    timeout = null;
  };
  const closePreview = () => {
    document.querySelector('.kickflow-clip-preview')?.remove();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  };
  const cancel = () => {
    generation++;
    const active = recorder;
    recorder = null;
    if (active && active.state !== 'inactive') active.stop();
    releaseStream();
    closePreview();
    refreshButtons();
  };
  const preview = (blob) => {
    closePreview();
    const host = options.getHost();
    if (!host) return;
    previewUrl = URL.createObjectURL(blob);
    const url = previewUrl;
    const name = options.filename('webm');
    const panel = document.createElement('section');
    panel.className = 'kickflow-clip-preview';
    panel.setAttribute('aria-label', options.text('clip_preview'));
    const heading = document.createElement('strong');
    heading.textContent = options.text('clip_preview');
    const player = document.createElement('video');
    player.src = url;
    player.controls = true;
    player.muted = true;
    player.preload = 'metadata';
    const filename = document.createElement('small');
    filename.textContent = name;
    const save = document.createElement('a');
    save.href = url;
    save.download = name;
    save.textContent = options.text('clip_save');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = options.text('close');
    close.onclick = closePreview;
    panel.append(heading, player, filename, save, close);
    host.append(panel);
    say('clip_ready');
  };
  const toggle = () => {
    if (recorder) {
      if (recorder.state !== 'inactive') recorder.stop();
      return true;
    }
    const video = options.getVideo();
    if (!video || video.readyState < 2 || !video.videoWidth || video.paused) {
      say('capture_no_frame');
      return false;
    }
    if (typeof MediaRecorder === 'undefined' || !video.captureStream) {
      say('clip_unsupported');
      return false;
    }
    const token = ++generation;
    try {
      const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      if (!mime) throw Error('WebM unsupported');
      stream = video.captureStream();
      if (!stream.getVideoTracks().length) throw Error('No video track');
      const chunks = [];
      const active = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: CLIP_VIDEO_BITS_PER_SECOND });
      recorder = active;
      active.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      active.onstop = () => {
        if (token !== generation) return;
        recorder = null;
        releaseStream();
        refreshButtons();
        const blob = new Blob(chunks, { type: mime });
        if (blob.size) preview(blob);
        else say('capture_failed');
      };
      active.onerror = () => {
        if (token !== generation) return;
        cancel();
        say('capture_failed');
      };
      active.start();
      timeout = window.setTimeout(() => { if (active.state !== 'inactive') active.stop(); }, CLIP_SECONDS * 1000);
      refreshButtons();
      say('clip_recording');
      return true;
    } catch {
      recorder = null;
      releaseStream();
      refreshButtons();
      say('capture_failed');
      return false;
    }
  };
  const createButton = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kickflow-player-btn';
    button.setAttribute('data-kickflow-local-clip', scope);
    button.textContent = recorder ? '■' : '●';
    button.title = title();
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(!!recorder));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle();
    });
    return button;
  };
  return { toggle, cancel, closePreview, refreshButtons, createButton, isRecording: () => !!recorder };
}

/** FINAL 6.3 moment 4: one toast above the strip with the frame and its file name, then gone. */
export function showFrameToast(host, url, filename, heading, ms = 2400) {
  if (!host) return null;
  host.querySelector('.kickflow-frame-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'kickflow-frame-toast';
  toast.setAttribute('role', 'status');
  const thumb = document.createElement('img');
  thumb.className = 'kickflow-frame-toast__thumb';
  thumb.alt = '';
  thumb.src = url;
  const text = document.createElement('span');
  text.className = 'kickflow-frame-toast__text';
  const title = document.createElement('b');
  title.textContent = heading;
  const name = document.createElement('small');
  name.textContent = filename;
  text.append(title, name);
  toast.append(thumb, text);
  host.append(toast);
  return window.setTimeout(() => toast.remove(), ms);
}
