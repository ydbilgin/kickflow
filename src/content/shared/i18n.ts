import { safeStorageGet, safeStorageSet } from './extension-context';

export type Lang = 'tr' | 'en';
type Params = Record<string, string | number>;
type PluralTemplate = { one: string; other: string };
type LocalizedTemplate = string | PluralTemplate;

const STORAGE_KEY = 'kf_lang';

export const messages = {
  'common.close': { en: 'Close', tr: 'Kapat' },
  'common.change': { en: 'Change', tr: 'Değiştir' },
  'common.reset_defaults': { en: 'Reset to defaults', tr: 'Varsayılana dön' },
  'common.connected': { en: 'Connected', tr: 'Bağlı' },
  'common.waiting': { en: 'Waiting', tr: 'Bekliyor' },
  'common.yes': { en: 'yes', tr: 'evet' },
  'common.no': { en: 'no', tr: 'hayır' },
  'common.space': { en: 'Space', tr: 'Boşluk' },

  'event.subscription.new': { en: 'subscribed', tr: 'abone oldu' },
  'event.subscription.months': {
    en: { one: 'subscribed for {n} month', other: 'subscribed for {n} months' },
    tr: { one: '{n} ay abone oldu', other: '{n} ay abone oldu' },
  },
  'event.celebration.months': {
    en: { one: 'resubscribed for {n} month', other: 'resubscribed for {n} months' },
    tr: { one: '{n}. abonelik ayını kutladı', other: '{n}. abonelik ayını kutladı' },
  },
  'event.gift.single': { en: ' gifted a sub to {name}', tr: ', {name} kullanıcısına abonelik hediye etti' },
  'event.gift.bulk': {
    en: { one: 'gifted a sub to {n} person', other: 'gifted a sub to {n} people' },
    tr: { one: '{n} kişiye abonelik hediye etti', other: '{n} kişiye abonelik hediye etti' },
  },
  'event.gift.more': {
    en: { one: ' and {n} more', other: ' and {n} more' },
    tr: { one: ' ve {n} kişi daha', other: ' ve {n} kişi daha' },
  },
  'event.kicks': { en: 'gifted {n} KICKs', tr: '{n} KICKs hediye etti' },
  'event.host.viewers': {
    en: { one: 'hosted with {n} viewer', other: 'hosted with {n} viewers' },
    tr: { one: '{n} izleyiciyle host etti', other: '{n} izleyiciyle host etti' },
  },
  'event.host': { en: 'hosted', tr: 'host etti' },
  'event.mode.slow_on': { en: 'Slow mode on ({n}s)', tr: 'Yavaş mod açıldı ({n}sn)' },
  'event.mode.slow_off': { en: 'Slow mode off', tr: 'Yavaş mod kapandı' },
  'event.mode.followers_on': { en: 'Followers-only mode on', tr: 'Sadece takipçi modu açıldı' },
  'event.mode.followers_on_minutes': { en: 'Followers-only mode on ({n}m)', tr: 'Sadece takipçi modu açıldı ({n}dk)' },
  'event.mode.followers_off': { en: 'Followers-only mode off', tr: 'Sadece takipçi modu kapandı' },
  'event.mode.subscribers_on': { en: 'Subscribers-only mode on', tr: 'Sadece abone modu açıldı' },
  'event.mode.subscribers_off': { en: 'Subscribers-only mode off', tr: 'Sadece abone modu kapandı' },
  'event.mode.emotes_on': { en: 'Emotes-only mode on', tr: 'Sadece emote modu açıldı' },
  'event.mode.emotes_off': { en: 'Emotes-only mode off', tr: 'Sadece emote modu kapandı' },

  'message.deleted': { en: 'DELETED', tr: 'SİLİNDİ' },
  'message.banned': { en: 'BANNED', tr: 'BANLANDI' },
  'message.timeout': { en: 'TIMEOUT', tr: 'TIMEOUT' },
  'duration.minutes_short': { en: '{n}M', tr: '{n}DK' },
  'duration.hours_short': { en: '{n}H', tr: '{n}SA' },
  'duration.hours_minutes_short': { en: '{h}H {m}M', tr: '{h}SA {m}DK' },
  'duration.days_short': { en: '{n}D', tr: '{n}G' },

  'badge.badge': { en: 'badge', tr: 'rozet' },
  'badge.level': { en: 'Level {n}', tr: '{n}. Seviye' },
  'badge.moderator': { en: 'Moderator', tr: 'Moderatör' },
  'badge.vip': { en: 'VIP', tr: 'VIP' },
  'badge.og': { en: 'OG', tr: 'OG' },
  'badge.gift_subscriber': { en: 'Gift Subscriber', tr: 'Hediye Aboneliği' },
  'badge.verified_streamer': { en: 'Verified Streamer', tr: 'Onaylı Yayıncı' },
  'badge.kick_staff': { en: 'Kick Staff', tr: 'Kick Ekibi' },
  'badge.broadcaster': { en: 'Broadcaster', tr: 'Yayıncı' },
  'badge.founder': { en: 'Founder', tr: 'Kurucu' },
  'badge.sidekick': { en: 'Sidekick', tr: 'Sidekick' },
  'badge.bot': { en: 'Bot', tr: 'Bot' },
  'badge.trainwreckstv': { en: "Train's Army", tr: 'Train’s Army' },
  'badge.subscriber': { en: 'Subscriber', tr: 'Abone' },
  'badge.subscriber_months': { en: 'Subscriber, {n} months', tr: 'Abone — {n} ay' },

  'panel.control_panel': { en: 'CONTROL PANEL', tr: 'KONTROL PANELİ' },
  'panel.sections': { en: 'KickFlow sections', tr: 'KickFlow bölümleri' },
  'panel.close_aria': { en: 'Close KickFlow panel', tr: 'KickFlow panelini kapat' },
  'tab.general': { en: 'General', tr: 'Genel' },
  'tab.removed': { en: 'Removed', tr: 'Kaldırılanlar' },
  'tab.chat': { en: 'Chat', tr: 'Sohbet' },
  'tab.player': { en: 'Player', tr: 'Oynatıcı' },
  'tab.shortcuts': { en: 'Shortcuts', tr: 'Kısayollar' },
  'tab.about': { en: 'About', tr: 'Hakkında' },
  'panel.removed_count': { en: 'Removed, {n} messages', tr: 'Kaldırılanlar, {n} mesaj' },
  'panel.removed_empty': { en: 'No removed messages yet', tr: 'Henüz kaldırılan mesaj yok' },
  'panel.general_intro': { en: 'Monitor this session and choose the primary chat view.', tr: 'Oturum durumunu izle ve temel sohbet görünümünü seç.' },
  'panel.live_status': { en: 'Live status', tr: 'Canlı durum' },
  'stat.connection': { en: 'Connection', tr: 'Bağlantı' },
  'stat.channel': { en: 'Channel', tr: 'Kanal' },
  'stat.chatroom_id': { en: 'Chatroom ID', tr: 'Chatroom ID' },
  'stat.pusher': { en: 'Pusher', tr: 'Pusher' },
  'stat.messages': { en: 'Messages', tr: 'Mesaj' },
  'stat.preserved': { en: 'Preserved', tr: 'Korunmuş' },
  'stat.bans': { en: 'Bans', tr: 'Ban' },
  'stat.deletions': { en: 'Deletions', tr: 'Silme' },
  'stat.ghost_inline': { en: 'Ghost inline', tr: 'Ghost inline' },
  'stat.ghost_pending': { en: 'Ghost pending', tr: 'Ghost bekleyen' },
  'stat.ghost_evicted': { en: 'Ghost evicted', tr: 'Ghost evict' },
  'stat.last_ban': { en: 'Last ban', tr: 'Son ban' },
  'panel.chat_view': { en: 'Chat view', tr: 'Sohbet görünümü' },
  'panel.chat_mode': { en: 'Chat mode', tr: 'Chat modu' },
  'panel.chat_mode_desc': { en: "Use Kick's native chat or the KickFlow list.", tr: 'Kick’in yerel sohbetini veya KickFlow listesini kullan.' },
  'panel.language': { en: 'Language', tr: 'Dil' },
  'panel.language_desc': { en: 'Choose the language used by KickFlow.', tr: 'KickFlow arayüz dilini seç.' },
  'panel.removed_intro': { en: 'Review messages banned, timed out, or deleted in this channel.', tr: 'Bu kanalda banlanan, zaman aşımına uğrayan ve silinen mesajları incele.' },
  'panel.removed_aria': { en: 'Removed messages', tr: 'Kaldırılan mesajlar' },
  'panel.filtered_user': { en: 'Filtered: {name}', tr: 'Filtre: {name}' },
  'panel.clear_user_filter': { en: 'Clear filter for {name}', tr: '{name} filtresini temizle' },
  'panel.chat_intro': { en: 'Choose which KickFlow enhancements appear in the chat feed.', tr: 'Sohbet akışında hangi KickFlow iyileştirmelerinin görüneceğini seç.' },
  'setting.show_deleted': { en: 'Show deleted messages', tr: 'Silinenleri göster' },
  'setting.show_deleted_desc': { en: 'Keeps moderator-deleted messages visible.', tr: 'Moderatörlerin sildiği mesajları görünür tutar.' },
  'setting.inline_bans': { en: 'Inline bans', tr: 'Ban satır-içi' },
  'setting.inline_bans_desc': { en: 'Preserves banned users’ recent messages in the feed.', tr: 'Banlanan kullanıcıların son mesajlarını akışta korur.' },
  'setting.subscriptions': { en: 'Subscriptions', tr: 'Abonelikler' },
  'setting.subscriptions_desc': { en: 'Shows new subscription events.', tr: 'Yeni abonelik etkinliklerini gösterir.' },
  'setting.gifted_subscriptions': { en: 'Gifted subscriptions', tr: 'Hediye abonelikler' },
  'setting.gifted_subscriptions_desc': { en: 'Shows gifted-subscription events.', tr: 'Hediye abonelik etkinliklerini gösterir.' },
  'setting.kicks': { en: 'Kicks / donations', tr: 'Kicks / bağışlar' },
  'setting.kicks_desc': { en: 'Adds paid Kicks donation events to the chat feed.', tr: 'Ücretli Kicks bağış etkinliklerini sohbet akışına ekler.' },
  'setting.host_raid': { en: 'Host / Raid', tr: 'Host / Raid' },
  'setting.host_raid_desc': { en: 'Adds host and raid events to the chat feed.', tr: 'Host ve raid etkinliklerini sohbet akışına ekler.' },
  'setting.mode_changes': { en: 'Mode changes', tr: 'Mod değişiklikleri' },
  'setting.mode_changes_desc': { en: 'Reports chat setting changes such as slow mode.', tr: 'Yavaş mod gibi sohbet ayarı değişikliklerini bildirir.' },
  'setting.sidebar_refresh': { en: 'Sidebar refresh', tr: 'Sidebar yenileme' },
  'setting.sidebar_refresh_desc': { en: 'Keeps followed channels’ live status up to date.', tr: 'Takip edilen kanalların canlı durumunu güncel tutar.' },
  'setting.chatters_badges': { en: 'Active chatter badges', tr: 'Aktif sohbetçi rozetleri' },
  'setting.chatters_badges_desc': { en: 'Shows session removed-message evidence beside native chatter rows.', tr: 'Yerel sohbetçi satırlarında oturumdaki kaldırılan mesaj kanıtlarını gösterir.' },
  'setting.mention_highlight': { en: 'Highlight replies to me / mentions of me', tr: 'Bana yanıt verildiğinde / benden bahsedildiğinde vurgula' },
  'setting.mention_highlight_desc': { en: 'Frames or fills chat rows that @mention you or reply to your messages.', tr: 'Seni @bahseden veya mesajına yanıt veren satırları çerçeveler ya da doldurur.' },
  'setting.mention_style': { en: 'Highlight style', tr: 'Vurgu stili' },
  'setting.mention_style_desc': { en: 'Outline, fill, or both.', tr: 'Çerçeve, dolgu veya her ikisi.' },
  'setting.mention_style_frame': { en: 'Frame', tr: 'Çerçeve' },
  'setting.mention_style_fill': { en: 'Fill', tr: 'Dolgu' },
  'setting.mention_style_both': { en: 'Both', tr: 'Her ikisi' },
  'setting.mention_color': { en: 'Highlight color', tr: 'Vurgu rengi' },
  'setting.mention_color_desc': { en: 'Pick a swatch or a custom color (green band is reserved).', tr: 'Hazır renklerden seç veya özel bir renk kullan (yeşil bant ayrılmıştır).' },
  'setting.mention_color_warn': { en: 'That green is reserved for reply-jump — a nearby hue was applied instead.', tr: 'O yeşil yanıt-atlama için ayrılmış — yakın bir ton uygulandı.' },
  'setting.manual_username': { en: 'Your Kick username', tr: 'Kick kullanıcı adın' },
  'setting.manual_username_desc': { en: 'Fallback if auto-detection fails.', tr: 'Otomatik algılama başarısız olursa yedek.' },
  'setting.manual_username_placeholder': { en: 'e.g. your_kick_name', tr: 'ör. kick_kullanici_adin' },
  'setting.identity_unresolved': { en: 'Kick identity was not detected — you can type your username above.', tr: 'Kick kimliğin algılanamadı — yukarıya kullanıcı adını yazabilirsin.' },
  'setting.mod_frame': { en: 'Frame moderator messages', tr: 'Moderatör mesajlarını çerçevele' },
  'setting.mod_frame_desc': { en: 'Left accent bar on moderator chat rows.', tr: 'Moderatör sohbet satırlarında sol vurgu çubuğu.' },
  'setting.mod_frame_color': { en: 'Moderator frame color', tr: 'Moderatör çerçeve rengi' },
  'setting.mod_frame_color_desc': { en: 'Pick a swatch or a custom color (green band is reserved).', tr: 'Hazır renklerden seç veya özel bir renk kullan (yeşil bant ayrılmıştır).' },
  'setting.mod_frame_color_warn': { en: 'That green is reserved for reply-jump — a nearby hue was applied instead.', tr: 'O yeşil yanıt-atlama için ayrılmış — yakın bir ton uygulandı.' },
  'setting.vip_frame': { en: 'Frame VIP messages', tr: 'VIP mesajlarını çerçevele' },
  'setting.vip_frame_desc': { en: 'Left accent bar on VIP chat rows.', tr: 'VIP sohbet satırlarında sol vurgu çubuğu.' },
  'setting.vip_frame_color': { en: 'VIP frame color', tr: 'VIP çerçeve rengi' },
  'setting.vip_frame_color_desc': { en: 'Pick a swatch or a custom color (green band is reserved).', tr: 'Hazır renklerden seç veya özel bir renk kullan (yeşil bant ayrılmıştır).' },
  'setting.vip_frame_color_warn': { en: 'That green is reserved for reply-jump — a nearby hue was applied instead.', tr: 'O yeşil yanıt-atlama için ayrılmış — yakın bir ton uygulandı.' },
  'chatters.removed_count': {
    en: { one: '{n} removed', other: '{n} removed' },
    tr: { one: '{n} kaldırıldı', other: '{n} kaldırıldı' },
  },
  'chatters.open_removed': { en: 'Review {n} removed messages from {name}', tr: '{name} için kaldırılan {n} mesajı incele' },
  'panel.player_intro': { en: 'Manage playback and tools added to the native control bar.', tr: 'Yayın oynatımını ve yerel kontrol çubuğuna eklenen araçları yönet.' },
  'setting.auto_theater': { en: 'Automatic theater mode', tr: 'Otomatik tiyatro modu' },
  'setting.auto_theater_desc': { en: 'Switches to the wide player layout when a channel opens.', tr: 'Kanal açıldığında geniş oynatıcı düzenine geçer.' },
  'setting.caption_guard': { en: 'Keep captions off by default', tr: 'Altyazıyı varsayılan olarak kapalı tut' },
  'setting.caption_guard_desc': { en: 'Prevents Kick from silently restoring captions after a reload. You can still turn them on manually for the current session.', tr: 'Kick’in altyazıyı yenilemeden sonra sessizce geri açmasını önler. Geçerli oturumda yine elle açabilirsin.' },
  'setting.seek': { en: 'Seek back / forward', tr: 'Geri / ileri sarma' },
  'setting.seek_desc': { en: 'Adds 10-second seek buttons to the control bar.', tr: 'Kontrol çubuğuna 10 saniyelik sarma düğmeleri ekler.' },
  'setting.live_catchup': { en: 'Live catch-up', tr: 'Canlıya yetişme' },
  'setting.live_catchup_desc': { en: 'Carefully accelerates playback when the stream falls behind.', tr: 'Geride kalınca yayını kontrollü biçimde hızlandırır.' },
  'setting.quality_lock': { en: 'Highest quality', tr: 'En yüksek kalite' },
  'setting.quality_lock_desc': { en: 'Selects the highest available stream quality.', tr: 'Mevcut en yüksek yayın kalitesini seçer.' },
  'setting.screenshot': { en: 'Screenshot', tr: 'Ekran görüntüsü' },
  'setting.screenshot_desc': { en: 'Adds a frame-capture button to the control bar.', tr: 'Kontrol çubuğuna kare yakalama düğmesi ekler.' },
  'setting.speed': { en: 'Speed controls', tr: 'Hız kontrolleri' },
  'setting.speed_desc': { en: 'Shows manual and automatic playback-speed tools.', tr: 'Manuel ve otomatik oynatma hızı araçlarını gösterir.' },
  'panel.shortcuts_intro': { en: 'Run player actions with one key. Shortcuts are disabled while typing.', tr: 'Oynatıcı eylemlerini tek tuşla çalıştır. Yazı alanındayken kısayollar devre dışıdır.' },
  'panel.changes_live': { en: 'Changes apply immediately.', tr: 'Değişiklikler anında uygulanır.' },
  'about.copy': { en: 'A personal browser extension that streamlines Kick chat and live viewing.', tr: 'Kick sohbetini ve canlı yayın deneyimini sadeleştiren kişisel bir tarayıcı eklentisi.' },
  'about.version': { en: 'Version', tr: 'Sürüm' },
  'about.platform': { en: 'Platform', tr: 'Platform' },
  'about.application': { en: 'Application', tr: 'Uygulama' },
  'about.application_value': { en: 'Runs inside kick.com', tr: 'kick.com içinde çalışır' },

  'hotkey.rewind': { en: '10s back', tr: '10 sn geri' },
  'hotkey.forward': { en: '10s forward', tr: '10 sn ileri' },
  'hotkey.screenshot': { en: 'Screenshot', tr: 'Ekran görüntüsü' },
  'hotkey.go_live': { en: 'Go live', tr: 'Canlıya dön' },
  'hotkey.enable_aria': { en: 'Enable {name} shortcut', tr: '{name} kısayolunu etkinleştir' },
  'hotkey.change_aria': { en: 'Change {name} shortcut', tr: '{name} kısayolunu değiştir' },
  'hotkey.press_key': { en: 'Press a key…', tr: 'Bir tuşa bas…' },
  'hotkey.press_key_cancel': { en: 'Press a key…  Esc: cancel', tr: 'Bir tuşa bas…  Esc: iptal' },
  'hotkey.cancelled': { en: 'Change cancelled.', tr: 'Değişiklik iptal edildi.' },
  'hotkey.modifier_invalid': { en: 'A modifier key cannot be used by itself.', tr: 'Tek başına bir değiştirici tuş kullanılamaz.' },
  'hotkey.collision': { en: 'This key is already used for “{name}”.', tr: 'Bu tuş “{name}” için kullanımda.' },
  'hotkey.invalid': { en: 'This key cannot be assigned.', tr: 'Bu tuş bağlanamıyor.' },
  'hotkey.saved': { en: 'Shortcut saved.', tr: 'Kısayol kaydedildi.' },
  'hotkey.saved_native_conflict': { en: "Saved: may conflict with a native Kick shortcut.", tr: 'Kaydedildi: Kick’in kendi kısayoluyla çakışabilir.' },
  'hotkey.reset': { en: 'Shortcuts reset.', tr: 'Kısayollar sıfırlandı.' },

  'player.live': { en: 'LIVE', tr: 'CANLI' },
  'player.go_live': { en: 'Go live', tr: 'Canlı yayına dön' },
  'player.go_live_behind': { en: 'Go live, {n} seconds behind', tr: 'Canlı yayına dön, {n} saniye geridesin' },
  'player.behind_seconds': { en: '-{n}s', tr: '-{n}sn' },
  'player.behind_minutes': { en: '-{n}m', tr: '-{n}dk' },
  'player.seek_back_title': { en: '{n}s back', tr: '{n} sn geri' },
  'player.seek_forward_title': { en: '{n}s forward', tr: '{n} sn ileri' },
  'player.seek_back_aria': { en: 'Seek back {n} seconds', tr: '{n} saniye geri sar' },
  'player.seek_forward_aria': { en: 'Seek forward {n} seconds', tr: '{n} saniye ileri sar' },
  'player.screenshot': { en: 'Take screenshot', tr: 'Ekran görüntüsü al' },
  'player.buffer_warning': { en: 'Buffer under pressure; speed reduced to 1.5x', tr: 'Buffer zorlandı; hız 1.5x oldu' },
  'player.manual_speed': { en: 'Manual speed: {rate}', tr: 'Manuel hız: {rate}' },
  'player.auto': { en: 'AUTO', tr: 'OTO' },
  'player.select_speed': { en: 'Select playback speed', tr: 'Oynatma hızını seç' },

  'entry.footer_title': { en: 'KickFlow removed messages', tr: 'KickFlow kaldırılan mesajlar' },
  'entry.footer_aria': { en: 'Open KickFlow removed messages', tr: 'KickFlow kaldırılan mesajları aç' },
  'entry.settings_title': { en: 'KickFlow settings', tr: 'KickFlow ayarları' },
  'entry.settings_aria': { en: 'Open KickFlow settings', tr: 'KickFlow ayarlarını aç' },
  'overlay.connected': { en: 'Connected, waiting for messages…', tr: 'Bağlandı — mesajlar bekleniyor…' },
  'overlay.reconnecting': { en: 'Reconnecting…', tr: 'Yeniden bağlanıyor…' },
  'chat.new_messages': { en: '↓ New messages', tr: '↓ Yeni mesajlar' },

  'status.starting': { en: 'starting', tr: 'başlatılıyor' },
  'status.resolving_channel': { en: 'resolving channel…', tr: 'kanal çözülüyor…' },
  'status.not_channel': { en: 'not a channel page', tr: 'kanal sayfası değil' },
  'status.chatroom_unresolved': { en: 'could not resolve chatroom id', tr: 'chatroom-id çözülemedi' },
  'status.pusher_connecting': { en: 'Pusher connecting…', tr: 'Pusher bağlanıyor…' },
  'status.socket_waiting': { en: 'Pusher socket connected, waiting for chatroom subscription…', tr: 'Pusher soketi bağlı — chatroom aboneliği bekleniyor…' },
  'status.active_native': { en: 'active, marking native chat', tr: 'aktif — native chat işaretleniyor' },
  'status.subscription_waiting_native': { en: 'waiting for chatroom subscription, native chat', tr: 'chatroom aboneliği bekleniyor — native chat' },
  'status.active_own': { en: 'active, rendering KickFlow list', tr: 'aktif — kendi liste render ediliyor' },
  'status.content_not_ready': { en: 'content not ready, retrying in background with native chat', tr: 'içerik hazır değil — native chat, arka planda yeniden deneniyor' },
  'status.chatroom_unresolved_native': { en: 'could not resolve chatroom id, native chat', tr: 'chatroom-id çözülemedi — native chat' },
  'status.history_empty': { en: 'history empty, waiting for live chatroom subscription…', tr: 'geçmiş boş — canlı chatroom aboneliği bekleniyor…' },
  'status.history_failed': { en: 'could not load history, waiting for live chatroom subscription…', tr: 'geçmiş alınamadı — canlı chatroom aboneliği bekleniyor…' },
  'status.active_ready': { en: 'active, chatroom subscription ready', tr: 'aktif — chatroom aboneliği hazır' },
  'status.chatroom_ready_waiting': { en: 'chatroom ready, waiting for visible chat area', tr: 'chatroom hazır — görünür chat alanı bekleniyor' },
  'status.primary_unavailable': { en: 'chatroom connection not ready ({reason}), native chat', tr: 'chatroom bağlantısı hazır değil ({reason}) — native chat' },
  'status.reconnecting': { en: 'reconnecting…', tr: 'yeniden bağlanıyor…' },
  'status.reconnect_failed': { en: 'could not reconnect to chatroom, native chat', tr: 'chatroom yeniden bağlanamadı — native chat' },
  'status.waiting_chat_panel': { en: 'waiting for chat panel…', tr: 'chat paneli bekleniyor…' },

  'popup.tagline': { en: 'A streamlined Kick experience.', tr: 'Kick deneyimi, sadeleştirilmiş.' },
  'popup.connection_status': { en: 'Connection status', tr: 'Bağlantı durumu' },
  'popup.reading_status': { en: 'Reading status…', tr: 'durum okunuyor…' },
  'popup.mode_desc': { en: 'Kick or KickFlow list', tr: 'Kick veya KickFlow listesi' },
  'popup.status_stats': { en: 'Status / Statistics', tr: 'Durum / İstatistik' },
  'popup.debug_log': { en: 'Debug log (F12)', tr: 'Debug günlüğü (F12)' },
  'popup.changes_hint': { en: 'Changes apply immediately and persist after reload.', tr: 'Değişiklik anında uygulanır; kanal yeniden yüklenince de korunur.' },
  'popup.not_connected': { en: 'not connected', tr: 'bağlanamadı' },
  'popup.active': { en: 'KickFlow active · {mode} chat', tr: 'KickFlow aktif · {mode} chat' },
  'popup.pusher_connected': { en: 'connected', tr: 'bağlı' },
  'popup.pusher_disconnected': { en: 'disconnected', tr: 'değil' },
  'popup.no_active_tab': { en: 'no active tab', tr: 'aktif sekme yok' },
  'popup.not_kick_tab': { en: 'not a Kick tab / content script unavailable', tr: 'Kick sekmesi değil / içerik betiği yok' },
  'popup.open_kick': { en: 'Open kick.com in the active tab', tr: 'Kick sekmesinde değilsin (kick.com aç)' },
  'popup.tab_unavailable': { en: 'Could not connect to the Kick tab.', tr: 'Kick sekmesine bağlanılamadı.' },

  'time.seconds_ago': { en: { one: '{n} second ago', other: '{n} seconds ago' }, tr: { one: '{n} sn önce', other: '{n} sn önce' } },
  'time.minutes_ago': { en: { one: '{n} minute ago', other: '{n} minutes ago' }, tr: { one: '{n} dk önce', other: '{n} dk önce' } },
  'time.hours_ago': { en: { one: '{n} hour ago', other: '{n} hours ago' }, tr: { one: '{n} sa önce', other: '{n} sa önce' } },

  'user.not_subscribed': { en: 'not subscribed', tr: 'abone değil' },
  'user.subscribed_months': { en: { one: 'subscribed for {n} month', other: 'subscribed for {n} months' }, tr: { one: '{n} ay abone', other: '{n} ay abone' } },
  'user.not_following': { en: 'not following', tr: 'takip etmiyor' },
  'user.close': { en: 'Close user card', tr: 'Kullanıcı kartını kapat' },
  'user.open_middle': { en: 'kick.com/{slug}, middle-click to open in a new tab', tr: 'kick.com/{slug} — orta tıkla yeni sekmede aç' },
  'user.verified': { en: 'verified', tr: 'doğrulanmış' },
  'user.followers': { en: 'followers', tr: 'takipçi' },
  'user.created': { en: 'account created', tr: 'hesap oluşturma' },
  'user.following': { en: 'following', tr: 'takip' },
  'user.subscription': { en: 'subscription', tr: 'abonelik' },
  'user.open': { en: 'open', tr: 'aç' },
} as const satisfies Record<string, { en: LocalizedTemplate; tr: LocalizedTemplate }>;

export type MessageKey = keyof typeof messages;

let lang: Lang = 'en';
const listeners = new Set<(next: Lang) => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (next === lang) return;
  lang = next;
  void safeStorageSet({ [STORAGE_KEY]: next });
  for (const listener of listeners) listener(next);
}

export async function loadLang(): Promise<Lang> {
  const stored = await safeStorageGet(STORAGE_KEY);
  const next = stored[STORAGE_KEY];
  if (next === 'en' || next === 'tr') setLang(next);
  return lang;
}

export function subscribeLang(listener: (next: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function selectTemplate(template: LocalizedTemplate, params: Params): string {
  if (typeof template === 'string') return template;
  const count = Number(params.n);
  return count === 1 ? template.one : template.other;
}

export function t(key: MessageKey, params: Params = {}): string {
  const template = selectTemplate(messages[key][lang], params);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US').format(value);
}

export function hotkeyLabel(action: 'rewind' | 'forward' | 'screenshot' | 'goLive'): string {
  const keys = {
    rewind: 'hotkey.rewind',
    forward: 'hotkey.forward',
    screenshot: 'hotkey.screenshot',
    goLive: 'hotkey.go_live',
  } as const;
  return t(keys[action]);
}
