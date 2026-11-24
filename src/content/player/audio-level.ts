import type { Lifecycle } from '../shared/lifecycle';
import { logger } from '../shared/logger';
import { safeStorageGet, safeStorageSet } from '../shared/extension-context';
import { parseChatSessionContext } from '../chat/session-context';
import { observeVideoElement } from './video-element';
import { isTypingTarget } from './rewind-hotkeys';
import { t } from '../shared/i18n';

/** Loudness leveller and per-channel volume (2026-11-24).
 *
 * Leveller: <video> -> DynamicsCompressor -> make-up gain -> speakers, through Web Audio. A loud
 * streamer is pressed down, a quiet one comes up. Measured 2026-11-24 in headless Chromium on a live
 * Kick channel (Kick's own IVS player, anonymous): the video plays from MediaSource (no plain src),
 * HLS playlists and segments answer `access-control-allow-origin: *`, an AnalyserNode behind
 * createMediaElementSource read a peak of 0.27 (not silence) and a canvas drawImage was not tainted.
 * So CORS does not block it today. It still degrades:
 * - a plain cross-origin src without crossorigin is never routed (Chrome would output silence);
 * - an AudioContext that is not running waits for the next click or key on the page;
 * - when the routed output stays at exact digital zero for 4 s while the video plays unmuted, the
 *   leveller reports `silent` once; the element cannot be un-routed, so the panel tells him to reload.
 * Turning the switch off keeps the element routed but bypasses the compressor (straight to speakers).
 *
 * Channel volume: the volume and mute he sets on a channel are stored under kf_channelVolumes and set
 * again when that channel's player opens. Only his own changes are stored; Kick's start-up value and
 * our own writes are not.
 *
 * 0.4.3 (2026-11-24, code review B8, B13, B19):
 * - `silent` and `unsupported` are shown on the player (a short note), once per video element;
 * - an element without any source yet (currentSrc '') is routed only after it loads (a plain cross-origin src set
 *   later would otherwise be silenced for good);
 * - one gesture retry (pointerdown or key, whichever comes first) for the element on the page at that moment, and one
 *   silence watcher at a time;
 * - an AudioContext that Chrome suspends later (device change, sleep) is resumed on his next click or key, also
 *   while the switch is off, because the element stays routed until the page reloads;
 * - a limiter after the make-up gain keeps peaks under 0 dBFS;
 * - channel volume counts only a change within USER_INPUT_MS of his input on the player, only while the page is
 *   still that channel, and writes at most every VOLUME_WRITE_MS; Kick's own late start-up value is set back
 *   within RESTORE_WINDOW_MS. */

export const COMPRESSOR = Object.freeze({ threshold: -26, knee: 24, ratio: 4, attack: 0.004, release: 0.25 });
export const MAKEUP_GAIN = 1.5;
export const LIMITER = Object.freeze({ threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.05 });
export const USER_INPUT_MS = 1000;
export const VOLUME_WRITE_MS = 250;
export const RESTORE_WINDOW_MS = 8000;
const NOTE_CLASS = 'kickflow-leveller-note';
export const CHANNEL_VOLUMES_KEY = 'kf_channelVolumes';
export const MAX_REMEMBERED_CHANNELS = 300;
const SILENCE_MS = 4000;

export type LevellerState = 'off' | 'waiting' | 'on' | 'unsupported' | 'silent';
let levellerState: LevellerState = 'off';
const stateListeners = new Set<(state: LevellerState) => void>();
function setState(state: LevellerState): void {
  if (levellerState === state) return;
  levellerState = state;
  for (const listener of stateListeners) listener(state);
}
export function getLevellerState(): LevellerState { return levellerState; }
export function onLevellerState(listener: (state: LevellerState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** True when Chrome may route this element through Web Audio without silencing it. */
export function routableSource(video: Pick<HTMLVideoElement, 'currentSrc' | 'crossOrigin'>, pageOrigin = location.origin): boolean {
  const src = video.currentSrc || '';
  if (!src || src.startsWith('blob:')) return true; // MediaSource / srcObject: bytes appended by script
  if (video.crossOrigin) return true;
  try { return new URL(src).origin === pageOrigin; } catch { return false; }
}

interface Route {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  compressor: DynamicsCompressorNode;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
  levelled: boolean;
}

let sharedContext: AudioContext | null = null;
const routes = new WeakMap<HTMLMediaElement, Route>();
let routedAny = false;
let resumeArmed = false;
let contextWatched: AudioContext | null = null;

/** Chrome may suspend the context later (audio device change, sleep). A routed element is then silent even with the
 * switch off, so the next click or key on the page resumes it. Module-wide: routing outlives the switch. */
function watchContext(context: AudioContext): void {
  if (contextWatched === context || typeof (context as Partial<EventTarget>).addEventListener !== 'function') return;
  contextWatched = context;
  context.addEventListener('statechange', () => {
    if (!routedAny || context.state === 'running' || (context.state as string) === 'closed' || resumeArmed) return;
    resumeArmed = true;
    const resume = (): void => {
      if (!resumeArmed) return;
      resumeArmed = false;
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      void context.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);
  });
}
type ContextFactory = () => AudioContext;
let contextFactory: ContextFactory = () => new AudioContext();
/** Tests only. */
export function setAudioContextFactory(factory: ContextFactory | null): void {
  contextFactory = factory ?? (() => new AudioContext());
  sharedContext = null;
  routedAny = false;
  resumeArmed = false;
  contextWatched = null;
}

function route(video: HTMLVideoElement): Route | null {
  const existing = routes.get(video);
  if (existing) return existing;
  try {
    sharedContext ??= contextFactory();
    const context = sharedContext;
    const source = context.createMediaElementSource(video);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR.threshold;
    compressor.knee.value = COMPRESSOR.knee;
    compressor.ratio.value = COMPRESSOR.ratio;
    compressor.attack.value = COMPRESSOR.attack;
    compressor.release.value = COMPRESSOR.release;
    const gain = context.createGain();
    gain.gain.value = MAKEUP_GAIN;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    compressor.connect(gain);
    gain.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(context.destination);
    const made: Route = { context, source, compressor, gain, limiter, analyser, levelled: false };
    routes.set(video, made);
    routedAny = true;
    watchContext(context);
    return made;
  } catch (error) {
    logger.debug('audio-level: Web Audio routing refused', error);
    return null;
  }
}

/** Connects the source either through the leveller or straight to the speakers. */
export function setLevelled(made: Route, on: boolean): void {
  if (made.levelled === on && (made.source as unknown as { __kfConnected?: boolean }).__kfConnected) return;
  try { made.source.disconnect(); } catch { /* first connection */ }
  made.source.connect(on ? made.compressor : made.context.destination);
  (made.source as unknown as { __kfConnected?: boolean }).__kfConnected = true;
  made.levelled = on;
}

/** A short note on the player (the leveller cannot fix silence by itself; the page must reload). */
function showNote(video: HTMLVideoElement, text: string): void {
  const host = (video.closest('#injected-channel-player') as HTMLElement | null) ?? video.parentElement;
  if (!host) return;
  host.querySelector(`.${NOTE_CLASS}`)?.remove();
  const note = document.createElement('div');
  note.className = NOTE_CLASS;
  note.textContent = text;
  note.setAttribute('role', 'status');
  Object.assign(note.style, {
    position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '30',
    padding: '6px 12px', borderRadius: '6px', background: 'rgba(11,11,12,0.82)', color: '#fff',
    font: '600 13px/1.3 system-ui, sans-serif', pointerEvents: 'none', maxWidth: '80%', textAlign: 'center',
  });
  host.append(note);
  window.setTimeout(() => note.remove(), 8000);
}

/** Returns the stop function; the caller keeps one watcher at a time. */
function watchSilence(video: HTMLVideoElement, made: Route): () => void {
  const buffer = new Float32Array(made.analyser.fftSize);
  let silentSince = 0;
  const id = window.setInterval(() => {
    if (!made.levelled || video.paused || video.muted || video.volume === 0 || video.readyState < 3) { silentSince = 0; return; }
    made.analyser.getFloatTimeDomainData(buffer);
    let peak = 0;
    for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0) { silentSince = 0; if (levellerState === 'silent') setState('on'); return; }
    silentSince ||= Date.now();
    if (Date.now() - silentSince >= SILENCE_MS) setState('silent');
  }, 500);
  return () => window.clearInterval(id);
}

export function initLoudnessLeveller(lifecycle: Lifecycle): void {
  setState('waiting');
  let current: HTMLVideoElement | null = null;
  let pendingGesture = false;
  let stopSilence: (() => void) | null = null;
  const waitingForSource = new WeakSet<HTMLVideoElement>();
  const noted = new WeakMap<HTMLVideoElement, Set<LevellerState>>();
  const offState = onLevellerState((state) => {
    const video = current;
    if (!video || (state !== 'silent' && state !== 'unsupported')) return;
    const seen = noted.get(video) ?? new Set<LevellerState>();
    if (seen.has(state)) return;
    seen.add(state);
    noted.set(video, seen);
    showNote(video, t(state === 'silent' ? 'player.leveller_silent' : 'player.leveller_unsupported'));
  });
  lifecycle.add(offState);
  const attach = (video: HTMLVideoElement | null): void => {
    if (video !== current) { stopSilence?.(); stopSilence = null; }
    current = video;
    if (!video || lifecycle.isDisposed) return;
    if (!video.currentSrc && !video.srcObject && !routes.has(video)) {
      // No source yet: route only once it loads, so a plain cross-origin src set later is seen first.
      setState('waiting');
      if (!waitingForSource.has(video)) {
        waitingForSource.add(video);
        const loaded = (): void => {
          video.removeEventListener('loadedmetadata', loaded);
          video.removeEventListener('playing', loaded);
          waitingForSource.delete(video);
          if (current === video) attach(video);
        };
        lifecycle.addEventListener(video, 'loadedmetadata', loaded);
        lifecycle.addEventListener(video, 'playing', loaded);
      }
      return;
    }
    if (!routableSource(video)) { setState('unsupported'); return; }
    sharedContext ??= (() => { try { return contextFactory(); } catch { return null; } })();
    const context = sharedContext;
    if (!context) { setState('unsupported'); return; }
    if (context.state !== 'running') {
      void context.resume().catch(() => {});
      if ((context.state as string) !== 'running') {
        // Chrome starts audio only after a user gesture on the page; routing before that would mute.
        setState('waiting');
        if (!pendingGesture) {
          pendingGesture = true;
          // One retry for whichever comes first; it attaches the element on the page then, not the one seen now.
          const retry = () => {
            if (!pendingGesture) return;
            pendingGesture = false;
            void context.resume().then(() => { if (current && !lifecycle.isDisposed) attach(current); }, () => {});
          };
          lifecycle.addEventListener(document, 'pointerdown', retry, { capture: true, once: true });
          lifecycle.addEventListener(document, 'keydown', retry, { capture: true, once: true });
        }
        return;
      }
    }
    const made = route(video);
    if (!made) { setState('unsupported'); return; }
    setLevelled(made, true);
    setState('on');
    stopSilence?.();
    stopSilence = watchSilence(video, made);
  };
  observeVideoElement(lifecycle, attach);
  lifecycle.add(() => {
    stopSilence?.();
    stopSilence = null;
    if (current) {
      const made = routes.get(current); if (made) setLevelled(made, false);
      (current.closest('#injected-channel-player') ?? current.parentElement)?.querySelector(`.${NOTE_CLASS}`)?.remove();
    }
    current = null;
    setState('off');
  });
}

// --- Per-channel volume ------------------------------------------------------------------------

export interface ChannelVolume { v: number; m: boolean; at: number }
export type ChannelVolumes = Record<string, ChannelVolume>;

export function sanitizeChannelVolumes(raw: unknown): ChannelVolumes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(([slug, value]) => {
    if (!/^[a-z0-9_-]{1,100}$/.test(slug) || !value || typeof value !== 'object') return false;
    const entry = value as Partial<ChannelVolume>;
    return typeof entry.v === 'number' && entry.v >= 0 && entry.v <= 1 && typeof entry.m === 'boolean' && typeof entry.at === 'number';
  }) as [string, ChannelVolume][];
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_REMEMBERED_CHANNELS));
}

export function rememberVolume(all: ChannelVolumes, slug: string, volume: number, muted: boolean, now = Date.now()): ChannelVolumes {
  const v = Math.round(Math.min(1, Math.max(0, volume)) * 1000) / 1000;
  return sanitizeChannelVolumes({ ...all, [slug.toLowerCase()]: { v, m: muted, at: now } });
}

export function currentChannelSlug(pathname = location.pathname): string | null {
  const context = parseChatSessionContext(pathname);
  return context ? context.slug.toLowerCase() : null;
}

export function initChannelVolume(lifecycle: Lifecycle): void {
  const slug = currentChannelSlug();
  if (!slug) return;
  let bound: HTMLVideoElement | null = null;
  let writing = 0;
  let restored = false;
  let wanted: ChannelVolume | null = null;
  let lastUserInputAt = -Infinity;
  let changedByHim = false;
  let boundAt = 0;
  let writeTimer = 0;
  let pending: { volume: number; muted: boolean } | null = null;
  const apply = (video: HTMLVideoElement): void => {
    if (!wanted || changedByHim) return;
    if (Math.abs(video.volume - wanted.v) < 0.005 && video.muted === wanted.m) { restored = true; return; }
    writing++;
    video.volume = wanted.v;
    video.muted = wanted.m;
    window.setTimeout(() => { writing = Math.max(0, writing - 1); }, 0);
    restored = true;
  };
  // His input on the player (slider, mute button, wheel) or a player key; a click in chat is not. It counts for
  // USER_INPUT_MS only: a click on play or fullscreen does not make Kick's later own volume change his.
  const markUser = (event?: Event): void => {
    const target = event?.target;
    if (event && !(target instanceof Element && bound && (target.closest('#injected-channel-player') || bound.parentElement?.contains(target)))) return;
    lastUserInputAt = Date.now();
  };
  // Writes the value he set (taken at his change, so a later change by Kick during navigation is not it).
  const store = (): void => {
    writeTimer = 0;
    const value = pending;
    pending = null;
    if (!value) return;
    void safeStorageGet(CHANNEL_VOLUMES_KEY).then((stored) => {
      const next = rememberVolume(sanitizeChannelVolumes(stored[CHANNEL_VOLUMES_KEY]), slug, value.volume, value.muted);
      return safeStorageSet({ [CHANNEL_VOLUMES_KEY]: next });
    });
  };
  const onVolume = (): void => {
    const video = bound;
    if (!video || writing > 0) return;
    // The page has already moved to another channel (the in-page change is seen up to 400 ms late): not this one's.
    if (currentChannelSlug() !== slug) return;
    if (Date.now() - lastUserInputAt > USER_INPUT_MS) {
      // Kick's own change: its late start-up value is set back once more; later ones (ads, reloads) are left alone.
      if (wanted && !changedByHim && Date.now() - boundAt <= RESTORE_WINDOW_MS) apply(video);
      return;
    }
    changedByHim = true;
    pending = { volume: video.volume, muted: video.muted };
    if (writeTimer) window.clearTimeout(writeTimer);
    writeTimer = window.setTimeout(store, VOLUME_WRITE_MS);
  };
  const onPlaying = (): void => { if (bound && !restored) apply(bound); };
  lifecycle.addEventListener(document, 'pointerdown', markUser, true);
  lifecycle.addEventListener(document, 'wheel', markUser, { capture: true, passive: true });
  lifecycle.addEventListener(document, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (isTypingTarget(event.target)) return;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key.toLowerCase() === 'm') markUser();
  }, true);
  observeVideoElement(lifecycle, (video) => {
    bound?.removeEventListener('volumechange', onVolume);
    bound?.removeEventListener('playing', onPlaying);
    bound = video;
    restored = false;
    boundAt = Date.now();
    if (!video) return;
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('playing', onPlaying);
    if (wanted) apply(video);
  });
  lifecycle.add(() => {
    if (writeTimer) { window.clearTimeout(writeTimer); store(); }
    bound?.removeEventListener('volumechange', onVolume);
    bound?.removeEventListener('playing', onPlaying);
    bound = null;
  });
  void safeStorageGet(CHANNEL_VOLUMES_KEY).then((stored) => {
    if (lifecycle.isDisposed) return;
    wanted = sanitizeChannelVolumes(stored[CHANNEL_VOLUMES_KEY])[slug] ?? null;
    if (wanted && bound) apply(bound);
    // Kick sets its own start volume a moment after the player mounts; set ours once more after it.
    if (wanted) lifecycle.setTimeout(() => { if (bound) { restored = false; apply(bound); } }, 1500);
  });
}
