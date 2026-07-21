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
    expect(t('setting.caption_guard')).toBe('Keep captions off by default');
    expect(t('setting.caption_guard_desc')).toBe('Prevents Kick from silently restoring captions after a reload. You can still turn them on manually for the current session.');
    expect(t('event.subscription.months', { n: 1 })).toBe('subscribed for 1 month');
    expect(t('event.subscription.months', { n: 3 })).toBe('subscribed for 3 months');
    expect(t('setting.mod_frame_color')).toBe('Moderator color');
    expect(t('setting.vip_frame_color')).toBe('VIP color');
    expect(t('setting.role_style')).toBe('Moderator / VIP style');
    expect(t('setting.role_style_desc')).toBe('Keep the left bar only, or add a faint row fill.');
    expect(t('setting.role_style_frame')).toBe('Bar only');
    expect(t('setting.role_style_both')).toBe('Bar + fill');
    expect(t('setting.role_colors')).toBe('Role colors');
    expect(t('setting.role_colors_desc')).toBe('Customize moderator and VIP colors.');
    expect(t('setting.mod_frame')).toBe('Highlight moderator messages');
    expect(t('setting.mod_frame_desc')).toBe('Uses the shared role style and moderator color.');
    expect(t('setting.vip_frame')).toBe('Highlight VIP messages');
    expect(t('setting.vip_frame_desc')).toBe('Uses the shared role style and VIP color.');

    const listener = vi.fn();
    const unsubscribe = subscribeLang(listener);
    setLang('tr');

    expect(getLang()).toBe('tr');
    expect(t('setting.caption_guard')).toBe('Altyazıyı varsayılan olarak kapalı tut');
    expect(t('setting.caption_guard_desc')).toBe('Kick’in altyazıyı yenilemeden sonra sessizce geri açmasını önler. Geçerli oturumda yine elle açabilirsin.');
    expect(t('setting.mod_frame_color')).toBe('Moderatör rengi');
    expect(t('setting.vip_frame_color')).toBe('VIP rengi');
    expect(t('setting.role_style')).toBe('Moderatör / VIP stili');
    expect(t('setting.role_style_desc')).toBe('Yalnızca sol çubuğu kullan veya hafif bir satır dolgusu ekle.');
    expect(t('setting.role_style_frame')).toBe('Yalnız çubuk');
    expect(t('setting.role_style_both')).toBe('Çubuk + dolgu');
    expect(t('setting.role_colors')).toBe('Rol renkleri');
    expect(t('setting.role_colors_desc')).toBe('Moderatör ve VIP renklerini özelleştir.');
    expect(t('setting.mod_frame')).toBe('Moderatör mesajlarını vurgula');
    expect(t('setting.mod_frame_desc')).toBe('Ortak rol stilini ve moderatör rengini kullanır.');
    expect(t('setting.vip_frame')).toBe('VIP mesajlarını vurgula');
    expect(t('setting.vip_frame_desc')).toBe('Ortak rol stilini ve VIP rengini kullanır.');
    expect(t('event.gift.single', { name: 'sarah_lee' })).toBe(', sarah_lee kullanıcısına abonelik hediye etti');
    expect(listener).toHaveBeenCalledWith('tr');
    expect(storageSet).toHaveBeenCalledWith({ kf_lang: 'tr' });
    unsubscribe();
  });
});
