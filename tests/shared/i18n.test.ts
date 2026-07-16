import { afterEach, describe, expect, it, vi } from 'vitest';

describe('i18n', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('defaults to English, persists language changes, notifies subscribers, and formats plurals', async () => {
    const storageSet = vi.fn(async (): Promise<void> => undefined);
    vi.stubGlobal('chrome', {
      runtime: { id: 'kickflow-i18n-test' },
      storage: { local: { get: vi.fn(async () => ({})), set: storageSet } },
    });

    const { getLang, setLang, subscribeLang, t } = await import('../../src/content/shared/i18n');
    expect(getLang()).toBe('en');
    expect(t('event.subscription.months', { n: 1 })).toBe('subscribed for 1 month');
    expect(t('event.subscription.months', { n: 3 })).toBe('subscribed for 3 months');

    const listener = vi.fn();
    const unsubscribe = subscribeLang(listener);
    setLang('tr');

    expect(getLang()).toBe('tr');
    expect(t('event.gift.single', { name: 'sarah_lee' })).toBe(', sarah_lee kullanıcısına abonelik hediye etti');
    expect(listener).toHaveBeenCalledWith('tr');
    expect(storageSet).toHaveBeenCalledWith({ kf_lang: 'tr' });
    unsubscribe();
  });
});
