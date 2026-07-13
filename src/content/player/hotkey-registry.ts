import { safeStorageGet, safeStorageSet } from '../shared/extension-context';

export const HOTKEY_ACTIONS = ['rewind', 'forward', 'screenshot', 'goLive'] as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

export interface HotkeyDefinition {
  action: HotkeyAction;
  label: string;
  defaultKey: string;
}

export interface HotkeyBinding {
  enabled: boolean;
  key: string;
}

export type HotkeyBindings = Record<HotkeyAction, HotkeyBinding>;

export interface HotkeyUpdateResult {
  ok: boolean;
  reason?: 'invalid' | 'collision';
  conflictingAction?: HotkeyAction;
  nativeConflict?: boolean;
  bindings: HotkeyBindings;
}

export const HOTKEY_DEFINITIONS: readonly HotkeyDefinition[] = [
  { action: 'rewind', label: '10 sn geri', defaultKey: 'ArrowLeft' },
  { action: 'forward', label: '10 sn ileri', defaultKey: 'ArrowRight' },
  { action: 'screenshot', label: 'Ekran görüntüsü', defaultKey: 's' },
  { action: 'goLive', label: 'Canlıya dön', defaultKey: 'l' },
];

const NATIVE_KEYS = new Set(['c', 't', 'f', 'm', 'k', ' ', 'i']);
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'CapsLock', 'NumLock', 'ScrollLock']);
const listeners = new Set<(bindings: HotkeyBindings) => void>();

let bindings = createDefaultHotkeyBindings();

function storageKey(action: HotkeyAction, field: keyof HotkeyBinding): string {
  return `kf_hotkey_${action}_${field}`;
}

function cloneBindings(value: HotkeyBindings): HotkeyBindings {
  return Object.fromEntries(
    HOTKEY_ACTIONS.map((action) => [action, { ...value[action] }]),
  ) as unknown as HotkeyBindings;
}

function emit(): void {
  const snapshot = getHotkeyBindings();
  for (const listener of listeners) listener(snapshot);
}

function hasCollision(value: HotkeyBindings): boolean {
  return new Set(HOTKEY_ACTIONS.map((action) => value[action].key)).size !== HOTKEY_ACTIONS.length;
}

export function createDefaultHotkeyBindings(): HotkeyBindings {
  return Object.fromEntries(
    HOTKEY_DEFINITIONS.map(({ action, defaultKey }) => [action, { enabled: true, key: defaultKey }]),
  ) as unknown as HotkeyBindings;
}

/** Normalizes letter bindings case-insensitively while preserving named KeyboardEvent keys. */
export function normalizeHotkeyKey(key: string): string | null {
  if (!key || MODIFIER_KEYS.has(key)) return null;
  if (key === 'Spacebar' || key === 'Space') return ' ';
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function formatHotkeyKey(key: string): string {
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === ' ') return 'Boşluk';
  if (key === 'Escape') return 'Esc';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function isKickNativeHotkey(key: string): boolean {
  const normalized = normalizeHotkeyKey(key);
  return normalized !== null && NATIVE_KEYS.has(normalized);
}

export function getHotkeyBindings(): HotkeyBindings {
  return cloneBindings(bindings);
}

export function getHotkeyBinding(action: HotkeyAction): HotkeyBinding {
  return { ...bindings[action] };
}

export function findHotkeyAction(key: string): HotkeyAction | null {
  const normalized = normalizeHotkeyKey(key);
  if (normalized === null) return null;
  return HOTKEY_ACTIONS.find((action) => bindings[action].enabled && bindings[action].key === normalized) ?? null;
}

export function subscribeHotkeyBindings(listener: (value: HotkeyBindings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies one live edit. All configured actions reserve their key, even while disabled, so
 * re-enabling an action can never create a latent collision. */
export function updateHotkeyBinding(
  action: HotkeyAction,
  patch: Partial<HotkeyBinding>,
): HotkeyUpdateResult {
  const next = getHotkeyBindings();
  const normalizedKey = patch.key === undefined ? next[action].key : normalizeHotkeyKey(patch.key);
  if (normalizedKey === null) return { ok: false, reason: 'invalid', bindings: next };

  const conflictingAction = HOTKEY_ACTIONS.find(
    (candidate) => candidate !== action && next[candidate].key === normalizedKey,
  );
  if (conflictingAction) {
    return { ok: false, reason: 'collision', conflictingAction, bindings: next };
  }

  next[action] = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : next[action].enabled,
    key: normalizedKey,
  };
  bindings = next;
  emit();

  const persisted: Record<string, unknown> = {};
  if (typeof patch.enabled === 'boolean') persisted[storageKey(action, 'enabled')] = next[action].enabled;
  if (patch.key !== undefined) persisted[storageKey(action, 'key')] = next[action].key;
  if (Object.keys(persisted).length > 0) void safeStorageSet(persisted);

  return {
    ok: true,
    nativeConflict: patch.key !== undefined && isKickNativeHotkey(normalizedKey),
    bindings: getHotkeyBindings(),
  };
}

export function resetHotkeyBindings(): HotkeyBindings {
  bindings = createDefaultHotkeyBindings();
  const persisted: Record<string, unknown> = {};
  for (const action of HOTKEY_ACTIONS) {
    persisted[storageKey(action, 'enabled')] = bindings[action].enabled;
    persisted[storageKey(action, 'key')] = bindings[action].key;
  }
  void safeStorageSet(persisted);
  emit();
  return getHotkeyBindings();
}

/** Loads all bindings as one snapshot. A corrupted/colliding snapshot fails closed to the
 * unique defaults instead of leaving two actions racing for one key. */
export async function loadHotkeyBindings(): Promise<HotkeyBindings> {
  const keys = HOTKEY_ACTIONS.flatMap((action) => [storageKey(action, 'enabled'), storageKey(action, 'key')]);
  const stored = await safeStorageGet(keys);
  const next = createDefaultHotkeyBindings();

  for (const action of HOTKEY_ACTIONS) {
    const enabled = stored[storageKey(action, 'enabled')];
    const key = stored[storageKey(action, 'key')];
    if (typeof enabled === 'boolean') next[action].enabled = enabled;
    if (typeof key === 'string') {
      const normalized = normalizeHotkeyKey(key);
      if (normalized !== null) next[action].key = normalized;
    }
  }

  bindings = hasCollision(next) ? createDefaultHotkeyBindings() : next;
  emit();
  return getHotkeyBindings();
}

let captureActive = false;

export function setHotkeyCaptureActive(active: boolean): void {
  captureActive = active;
}

export function isHotkeyCaptureActive(): boolean {
  return captureActive;
}
