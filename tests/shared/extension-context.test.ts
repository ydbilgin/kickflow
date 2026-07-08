import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtensionContextValid, safeStorageGet, safeStorageSet } from '../../src/content/shared/extension-context';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isExtensionContextValid', () => {
  it('returns true when chrome.runtime.id is a truthy string', () => {
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' } });
    expect(isExtensionContextValid()).toBe(true);
  });

  it('returns false when chrome.runtime.id is undefined', () => {
    vi.stubGlobal('chrome', { runtime: { id: undefined } });
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when chrome is undefined', () => {
    vi.stubGlobal('chrome', undefined);
    expect(isExtensionContextValid()).toBe(false);
  });
});

describe('safeStorageGet', () => {
  it('valid context: returns what chrome.storage.local.get resolves and is called with the passed keys', async () => {
    const get = vi.fn(async () => ({ a: 1 }));
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' }, storage: { local: { get } } });

    const result = await safeStorageGet(['a']);

    expect(result).toEqual({ a: 1 });
    expect(get).toHaveBeenCalledWith(['a']);
  });

  it('invalid context: returns {} and never calls chrome.storage.local.get', async () => {
    const get = vi.fn(async () => ({ a: 1 }));
    vi.stubGlobal('chrome', { runtime: { id: undefined }, storage: { local: { get } } });

    const result = await safeStorageGet(['a']);

    expect(result).toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it('valid context but get rejects: returns {} without throwing', async () => {
    const get = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' }, storage: { local: { get } } });

    await expect(safeStorageGet(['a'])).resolves.toEqual({});
  });
});

describe('safeStorageSet', () => {
  it('valid context: calls chrome.storage.local.set with the items and resolves', async () => {
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' }, storage: { local: { set } } });

    await expect(safeStorageSet({ a: 1 })).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith({ a: 1 });
  });

  it('invalid context: never calls chrome.storage.local.set and resolves', async () => {
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { id: undefined }, storage: { local: { set } } });

    await expect(safeStorageSet({ a: 1 })).resolves.toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });

  it('valid context but set rejects: resolves without throwing', async () => {
    const set = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    vi.stubGlobal('chrome', { runtime: { id: 'abc123' }, storage: { local: { set } } });

    await expect(safeStorageSet({ a: 1 })).resolves.toBeUndefined();
  });
});
