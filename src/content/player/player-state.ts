import { logger } from '../shared/logger';

export type PlayerMode = 'auto' | 'manual';

export interface PlayerState {
  mode: PlayerMode;
  manualRate: number;
}

export const PLAYER_STATE_CHANGED_EVENT = 'kickflow:playerStateChanged';
export const CATCHUP_TOGGLED_EVENT = 'kickflow:catchupToggled';
export const NORMAL_PLAYBACK_RATE = 1.0;

const TOGGLE_STORAGE_KEY = 'kickflow.catchupEnabled';
const DEFAULT_STATE: PlayerState = {
  mode: 'auto',
  manualRate: NORMAL_PLAYBACK_RATE,
};

type PlayerStateListener = (state: PlayerState, previous: PlayerState) => void;

const listeners = new Set<PlayerStateListener>();

let state: PlayerState = { ...DEFAULT_STATE };
let revision = 0;
let loadPromise: Promise<void> | null = null;

function cloneState(value: PlayerState): PlayerState {
  return { ...value };
}

function normalizeRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? rate : NORMAL_PLAYBACK_RATE;
}

function persistCatchupEnabled(enabled: boolean): void {
  chrome.storage.local.set({ [TOGGLE_STORAGE_KEY]: enabled }).catch((error: unknown) => {
    logger.debug('player-state: failed to persist catch-up toggle', error);
  });
}

function emitCatchupToggled(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent(CATCHUP_TOGGLED_EVENT, { detail: enabled }));
}

function setState(next: PlayerState, options: { persistMode?: boolean; emitToggle?: boolean } = {}): void {
  const normalized: PlayerState = {
    mode: next.mode,
    manualRate: normalizeRate(next.manualRate),
  };

  if (
    normalized.mode === state.mode &&
    normalized.manualRate === state.manualRate
  ) {
    return;
  }

  const previous = state;
  state = normalized;
  revision++;

  if (options.persistMode && previous.mode !== state.mode) {
    persistCatchupEnabled(state.mode === 'auto');
  }
  if (options.emitToggle && previous.mode !== state.mode) {
    emitCatchupToggled(state.mode === 'auto');
  }

  const snapshot = cloneState(state);
  const previousSnapshot = cloneState(previous);
  window.dispatchEvent(new CustomEvent<PlayerState>(PLAYER_STATE_CHANGED_EVENT, { detail: snapshot }));
  for (const listener of listeners) {
    try {
      listener(snapshot, previousSnapshot);
    } catch (error) {
      logger.error('player-state: listener threw', error);
    }
  }
}

export function getPlayerState(): PlayerState {
  return cloneState(state);
}

export function subscribePlayerState(listener: PlayerStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ensurePlayerStateLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;

  const loadRevision = revision;
  loadPromise = chrome.storage.local
    .get(TOGGLE_STORAGE_KEY)
    .then((stored) => {
      if (revision !== loadRevision) return;
      const value = stored[TOGGLE_STORAGE_KEY];
      if (typeof value !== 'boolean') return;
      setState(
        {
          mode: value ? 'auto' : 'manual',
          manualRate: NORMAL_PLAYBACK_RATE,
        },
        { emitToggle: false, persistMode: false },
      );
    })
    .catch((error: unknown) => {
      logger.debug('player-state: failed to read catch-up preference, defaulting to auto', error);
    });

  return loadPromise;
}

export function setAutoMode(): void {
  setState(
    {
      mode: 'auto',
      manualRate: state.manualRate,
    },
    { emitToggle: true, persistMode: true },
  );
}

export function setManualRate(rate: number): void {
  setState(
    {
      mode: 'manual',
      manualRate: normalizeRate(rate),
    },
    { emitToggle: true, persistMode: true },
  );
}

export function setPlayerPlaybackRate(video: HTMLVideoElement, rate: number): void {
  const safeRate = normalizeRate(rate);
  video.preservesPitch = true;
  (video as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  if (video.playbackRate !== safeRate) video.playbackRate = safeRate;
}
