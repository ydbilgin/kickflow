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

    const { getLang, messages, setLang, subscribeLang, t } = await import('../../src/content/shared/i18n');
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
    for (const key of [
      'tab.rewards',
      'panel.rewards_intro',
      'setting.auto_claim_drops',
      'setting.auto_claim_drops_desc',
      'setting.auto_claim_daily_reward',
      'setting.auto_claim_daily_reward_desc',
    ] as const) {
      expect(messages[key].en.trim()).not.toBe('');
      expect(messages[key].tr.trim()).not.toBe('');
    }
    expect(t('tab.rewards')).toBe('Rewards');
    expect(t('panel.rewards_intro')).toBe("Manage Kick Drops and daily rewards from this tab. Drops use Kick's own button; daily rewards briefly open and close Kick's reward window. Neither feature touches channel points.");
    expect(t('setting.auto_claim_drops')).toBe('Auto-claim Drops');
    expect(t('setting.auto_claim_drops_desc')).toBe("On the channel you watch, automatically claims Kick Drops rewards when a reward reaches 100% by clicking Kick's own Claim button. Only while this Kick tab is open: it never calls a Kick API or runs as a background service. Never touches channel points; spending them is your choice.");
    expect(t('setting.auto_claim_daily_reward')).toBe('Auto-claim daily reward');
    expect(t('setting.auto_claim_daily_reward_desc')).toBe("Automatically claims Kick's daily reward by briefly opening and closing Kick's own reward window. It runs only while this Kick tab is open and never touches channel points.");

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
    expect(t('tab.rewards')).toBe(messages['tab.rewards'].tr);
    expect(t('panel.rewards_intro')).toBe(messages['panel.rewards_intro'].tr);
    expect(t('setting.auto_claim_drops')).toBe('Drops ödüllerini otomatik al');
    expect(t('setting.auto_claim_drops_desc')).toBe('İzlediğin kanalda bir Kick Drops ödülü %100’e ulaştığında Kick’in kendi Claim düğmesine tıklayarak otomatik alır. Yalnızca Kick sekmesi açıkken çalışır; Kick API’sini hiç çağırmaz ve arka plan servisi değildir. Kanal puanlarına hiç dokunmaz; onları harcayıp harcamamak senin kararın.');
    expect(t('setting.auto_claim_daily_reward')).toBe(messages['setting.auto_claim_daily_reward'].tr);
    expect(t('setting.auto_claim_daily_reward_desc')).toBe(messages['setting.auto_claim_daily_reward_desc'].tr);
    expect(t('event.gift.single', { name: 'sarah_lee' })).toBe(', sarah_lee kullanıcısına abonelik hediye etti');
    expect(listener).toHaveBeenCalledWith('tr');
    expect(storageSet).toHaveBeenCalledWith({ kf_lang: 'tr' });
    unsubscribe();
  });
});
