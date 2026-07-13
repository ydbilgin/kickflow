import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultHotkeyBindings,
  findHotkeyAction,
  getHotkeyBindings,
  isKickNativeHotkey,
  loadHotkeyBindings,
  resetHotkeyBindings,
  updateHotkeyBinding,
} from '../../src/content/player/hotkey-registry';

let storageGet: ReturnType<typeof vi.fn>;
let storageSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storageGet = vi.fn(async () => ({}));
  storageSet = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test' },
    storage: { local: { get: storageGet, set: storageSet } },
  });
  resetHotkeyBindings();
  storageSet.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hotkey registry', () => {
  it('provides the requested enabled defaults', () => {
    expect(createDefaultHotkeyBindings()).toEqual({
      rewind: { enabled: true, key: 'ArrowLeft' },
      forward: { enabled: true, key: 'ArrowRight' },
      screenshot: { enabled: true, key: 's' },
      goLive: { enabled: true, key: 'l' },
    });
  });

  it('rebinds case-insensitively, applies live, and persists key/enabled edits', () => {
    expect(updateHotkeyBinding('screenshot', { key: 'P' }).ok).toBe(true);
    expect(updateHotkeyBinding('screenshot', { enabled: false }).ok).toBe(true);

    expect(getHotkeyBindings().screenshot).toEqual({ enabled: false, key: 'p' });
    expect(findHotkeyAction('p')).toBeNull();
    expect(storageSet).toHaveBeenCalledWith({ kf_hotkey_screenshot_key: 'p' });
    expect(storageSet).toHaveBeenCalledWith({ kf_hotkey_screenshot_enabled: false });
  });

  it('prevents collisions without changing or persisting the rejected binding', () => {
    const before = getHotkeyBindings();
    const result = updateHotkeyBinding('screenshot', { key: 'ArrowLeft' });

    expect(result).toMatchObject({ ok: false, reason: 'collision', conflictingAction: 'rewind' });
    expect(getHotkeyBindings()).toEqual(before);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('loads persisted key/enabled values and exposes native-key conflict warnings', async () => {
    storageGet.mockResolvedValue({
      kf_hotkey_rewind_enabled: false,
      kf_hotkey_screenshot_key: 'P',
    });

    await loadHotkeyBindings();

    expect(getHotkeyBindings().rewind.enabled).toBe(false);
    expect(getHotkeyBindings().screenshot.key).toBe('p');
    expect(isKickNativeHotkey('C')).toBe(true);
    expect(updateHotkeyBinding('screenshot', { key: 'c' })).toMatchObject({ ok: true, nativeConflict: true });
  });

  it('falls back to unique defaults when persisted storage contains a collision', async () => {
    storageGet.mockResolvedValue({
      kf_hotkey_rewind_key: 'q',
      kf_hotkey_forward_key: 'q',
    });

    await loadHotkeyBindings();

    expect(getHotkeyBindings()).toEqual(createDefaultHotkeyBindings());
  });
});
