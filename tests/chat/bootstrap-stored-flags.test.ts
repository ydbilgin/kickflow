// Settings written to storage by another extension page apply to an open Kick tab. 2026-10-18.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { featureFlags } from '../../src/content/chat/feature-flags';
import { setLang } from '../../src/content/shared/i18n';

type BootstrapModule = typeof import('../../src/content/bootstrap');

const originalFlags = { ...featureFlags };
const storageGet = vi.fn(async (): Promise<Record<string, unknown>> => ({}));
const storageSet = vi.fn(async (): Promise<void> => undefined);
const addChangeListener = vi.fn();
let bootstrap: BootstrapModule;

beforeAll(async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(window, 'setInterval').mockReturnValue(1);
  vi.stubGlobal('chrome', {
    runtime: { id: 'kickflow-test', onMessage: { addListener: vi.fn() } },
    storage: { local: { get: storageGet, set: storageSet }, onChanged: { addListener: addChangeListener } },
  });
  setLang('tr');
  bootstrap = await import('../../src/content/bootstrap');
  await Promise.resolve();
  await Promise.resolve();
});

afterAll(() => {
  Object.assign(featureFlags, originalFlags);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stored flag changes', () => {
  it('registers one storage listener at start', () => {
    expect(addChangeListener).toHaveBeenCalledWith(bootstrap.applyStoredFlagChanges);
  });

  it('applies a boolean flag written while the tab is open and saves it once', async () => {
    featureFlags.autoClaimDrops = true;
    storageSet.mockClear();
    bootstrap.applyStoredFlagChanges({ kf_flag_autoClaimDrops: { newValue: false } }, 'local');
    await Promise.resolve();
    expect(featureFlags.autoClaimDrops).toBe(false);
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('skips the echo of its own save, other areas, unknown keys and wrong types', async () => {
    featureFlags.showKicks = true;
    storageSet.mockClear();
    bootstrap.applyStoredFlagChanges({ kf_flag_showKicks: { newValue: true } }, 'local');
    bootstrap.applyStoredFlagChanges({ kf_flag_showKicks: { newValue: false } }, 'sync');
    bootstrap.applyStoredFlagChanges({ kf_flag_notAFlag: { newValue: true } }, 'local');
    bootstrap.applyStoredFlagChanges({ kf_flag_showKicks: { newValue: 'no' } }, 'local');
    bootstrap.applyStoredFlagChanges({ other_key: { newValue: false } }, 'local');
    await Promise.resolve();
    expect(featureFlags.showKicks).toBe(true);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('applies a valid string flag and ignores an invalid one', async () => {
    featureFlags.mentionHighlightStyle = 'both';
    bootstrap.applyStoredFlagChanges({ kf_flag_mentionHighlightStyle: { newValue: 'frame' } }, 'local');
    expect(featureFlags.mentionHighlightStyle).toBe('frame');
    bootstrap.applyStoredFlagChanges({ kf_flag_mentionHighlightStyle: { newValue: 'nonsense' } }, 'local');
    expect(featureFlags.mentionHighlightStyle).toBe('frame');
  });
});
