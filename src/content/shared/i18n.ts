import { safeStorageGet, safeStorageSet } from './extension-context';

export type Lang = 'tr' | 'en';
type Params = Record<string, string | number>;
type PluralTemplate = { one: string; other: string };
type LocalizedTemplate = string | PluralTemplate;

const STORAGE_KEY = 'kf_lang';

export const messages = {
  'overlay.failed': { en: 'KickFlow could not start. Kick chat is available.', tr: 'KickFlow başlatılamadı. Kick sohbeti açık.' },
  'overlay.retry': { en: 'Try again', tr: 'Tekrar dene' },
  'overlay.gap': { en: 'Connection gap · estimated missing messages: {n}', tr: 'Bağlantı kesintisi · eksik mesaj tahmini: {n}' },
  'overlay.gap_time': { en: 'Connection gap · about {n} seconds could not be recovered', tr: 'Bağlantı kesintisi · yaklaşık {n} saniye alınamadı' },
  'player.controls': {en:'Video player controls',tr:'Video oynatıcı denetimleri'},
  'player.clip_record': {en:'Record next 15 seconds locally',tr:'Sonraki 15 saniyeyi bilgisayara kaydet'},
  'player.clip_stop': {en:'Stop local recording and preview',tr:'Yerel kaydı durdur ve önizle'},
  'player.clip_preview': {en:'Local clip preview',tr:'Yerel klip önizlemesi'},
  'player.clip_save': {en:'Save WebM to Downloads',tr:'WebM dosyasını İndirilenler klasörüne kaydet'},
  'player.clip_ready': {en:'Clip ready. Preview and save below.',tr:'Klip hazır. Önizleyip aşağıdan kaydet.'},
  'player.clip_recording': {en:'Recording next 15 seconds. Press again to stop.',tr:'Sonraki 15 saniye kaydediliyor. Durdurmak için tekrar bas.'},
  'player.clip_unsupported': {en:'Local recording is unavailable in this browser.',tr:'Bu tarayıcıda yerel kayıt kullanılamıyor.'},
  'player.capture_no_frame': {en:'Start playback before capturing a frame or clip.',tr:'Görüntü veya klip almak için önce videoyu oynat.'},
  'player.capture_failed': {en:'Capture failed. This video may restrict recording.',tr:'Kayıt alınamadı. Bu video kayda izin vermiyor olabilir.'},
  'chat.reply_to': { en: 'Reply to {name}', tr: '{name} kullanıcısına yanıtla' },
  'category.turkish_off': { en: 'Show only Turkish streams (Kick language filter). Remembered on every category.', tr: 'Yalnız Türkçe yayınları göster (Kick dil filtresi). Her kategoride hatırlanır.' },
  'category.turkish_on': { en: 'Turkish filter on. Click to show all languages.', tr: 'Türkçe filtresi açık. Tüm dilleri göstermek için tıkla.' },
  'chat.thread_open': { en: 'Thread', tr: 'Yan Sohbet' },
  'chat.reply_unavailable': { en: "Kick's reply box was not found. Reload the page (F5); if this line comes back, Kick's page changed: send a screenshot of it.", tr: "Kick'in yanıt kutusu bulunamadı. Sayfayı yenile (F5); bu satır yine çıkarsa Kick sayfası değişmiş demektir, ekran görüntüsünü gönder." },
  'chat.reply_wrong_room': { en: "This message belongs to another channel's chat. Reload the page (F5).", tr: 'Bu mesaj açık kanalın sohbetine ait değil. Sayfayı yenile (F5).' },
  'chat.reply_no_bridge': { en: "KickFlow's page helper is not loaded. Reload the page (F5).", tr: "KickFlow'un sayfa yardımcısı yüklenmemiş. Sayfayı yenile (F5)." },
  'chat.reply_followers_only': { en: 'This chat is followers only; a reply cannot be written.', tr: 'Bu sohbet takipçilere özel; yanıt yazılamıyor.' },
  'chat.reply_subscribers_only': { en: 'This chat is subscribers only; a reply cannot be written.', tr: 'Bu sohbet abonelere özel; yanıt yazılamıyor.' },
  'chat.reply_login_required': { en: 'Sign in to write a reply in this chat.', tr: 'Bu sohbette yanıt yazmak için giriş yap.' },
  'chat.reply_rules_required': { en: 'Accept the native chat rules to write a reply.', tr: 'Yanıt yazmak için yerel sohbet kurallarını kabul et.' },
  'chat.reply_no_editor': { en: 'This chat has no writable message field; a reply cannot be written.', tr: 'Bu sohbette yazı yazılamıyor; kullanılabilir mesaj alanı yok.' },
  'setting.floating_strip': { en: 'Cinema strip', tr: 'Sinema şeridi' },
  'setting.floating_strip_desc': { en: "Kick's player bar floats as one glass strip over a soft dark fade. Off: Kick's flat bar with KickFlow's plate.", tr: 'Kick’in oynatıcı çubuğu yumuşak bir koyu geçişin üstünde tek parça cam şerit olur. Kapalı: Kick’in düz çubuğu ve KickFlow plakası.' },
  'player.to_live': { en: 'Live', tr: 'Canlıya' },
  'player.seconds_short': { en: 's', tr: 'sn' },
  'player.forward_at_live': { en: 'Already at live', tr: 'Zaten canlıdasın' },
  'player.speed_menu_title': { en: 'Playback speed', tr: 'Oynatma hızı' },
  'player.speed_auto_title': { en: 'Catch up with live', tr: 'Canlıya otomatik yetiş' },
  'player.speed_auto_hint': { en: 'Up to 1.5× when behind, 1× at live', tr: 'Geride kalınca en çok 1,5×, canlıda 1×' },
  'player.speed_manual_hint': { en: 'Picking a speed turns Auto off', tr: 'Elle hız seçmek Otomatik’i kapatır' },
  'player.speed_catching': { en: 'Speed {rate}, catching up with live', tr: 'Hız {rate}, canlıya yetişiyor' },
  'player.frame_saved': { en: 'Frame saved', tr: 'Kare kaydedildi' },
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
  'modaction.ban.single': { en: '{mod} banned {name}.', tr: '{mod}, {name} adlı kullanıcıyı banladı.' },
  'modaction.ban.single.unknown': { en: 'A moderator banned {name}.', tr: 'Bir moderatör, {name} adlı kullanıcıyı banladı.' },
  'modaction.ban.bulk': { en: '{mod} banned {n} users:', tr: '{mod}, {n} kullanıcıyı banladı:' },
  'modaction.ban.bulk.unknown': { en: 'A moderator banned {n} users:', tr: 'Bir moderatör, {n} kullanıcıyı banladı:' },
  'modaction.timeout.single': { en: '{mod} timed out {name} for {duration}.', tr: '{mod}, {name} adlı kullanıcıyı {duration} susturdu.' },
  'modaction.timeout.single.unknown': { en: 'A moderator timed out {name} for {duration}.', tr: 'Bir moderatör, {name} adlı kullanıcıyı {duration} susturdu.' },
  'modaction.timeout.single.no_duration': { en: '{mod} timed out {name}.', tr: '{mod}, {name} adlı kullanıcıyı susturdu.' },
  'modaction.timeout.single.no_duration.unknown': { en: 'A moderator timed out {name}.', tr: 'Bir moderatör, {name} adlı kullanıcıyı susturdu.' },
  'modaction.timeout.bulk': { en: '{mod} timed out {n} users:', tr: '{mod}, {n} kullanıcıyı susturdu:' },
  'modaction.timeout.bulk.unknown': { en: 'A moderator timed out {n} users:', tr: 'Bir moderatör, {n} kullanıcıyı susturdu:' },
  'modaction.timeout.bulk.duration': { en: '{mod} timed out {n} users for {duration}:', tr: '{mod}, {n} kullanıcıyı {duration} susturdu:' },
  'modaction.timeout.bulk.duration.unknown': { en: 'A moderator timed out {n} users for {duration}:', tr: 'Bir moderatör, {n} kullanıcıyı {duration} susturdu:' },
  'modaction.delete.single': { en: '{mod} deleted a message from {name}.', tr: '{mod}, {name} adlı kullanıcının mesajını sildi.' },
  'modaction.delete.single.unknown': { en: 'A moderator deleted a message from {name}.', tr: 'Bir moderatör, {name} adlı kullanıcının mesajını sildi.' },
  'modaction.delete.bulk': { en: '{mod} deleted {n} messages:', tr: '{mod}, {n} mesajı sildi:' },
  'modaction.delete.bulk.unknown': { en: 'A moderator deleted {n} messages:', tr: 'Bir moderatör, {n} mesajı sildi:' },
  'modaction.tag.ban': { en: 'BAN', tr: 'BAN' },
  'modaction.tag.timeout': { en: 'TIMEOUT', tr: 'SUSTURMA' },
  'modaction.tag.delete': { en: 'DELETED', tr: 'SİLİNDİ' },
  'modaction.tag.unknown': { en: 'MODERATION', tr: 'MODERASYON' },
  'modaction.unknown.single': { en: '{mod} moderated {name}; action type unknown.', tr: '{mod}, {name} için moderasyon uyguladı; türü bilinmiyor.' },
  'modaction.unknown.single.no_moderator': { en: 'A moderator acted on {name}; action type unknown.', tr: 'Bir moderatör, {name} için işlem yaptı; türü bilinmiyor.' },
  'modaction.unknown.bulk': { en: '{mod} moderated {n} users; action type unknown:', tr: '{mod}, {n} kullanıcıya işlem yaptı; türü bilinmiyor:' },
  'modaction.unknown.bulk.no_moderator': { en: 'A moderator acted on {n} users; action type unknown:', tr: 'Bir moderatör, {n} kullanıcıya işlem yaptı; türü bilinmiyor:' },
  'modaction.more': { en: { one: 'and {n} more', other: 'and {n} more' }, tr: { one: 've {n} kişi daha', other: 've {n} kişi daha' } },
  'modaction.moderator_profile_title': { en: "Open moderator {name}'s profile", tr: '{name} moderatör profilini aç' },
  'modaction.target_profile_title': { en: "Open {name}'s profile", tr: '{name} profilini aç' },
  'modaction.target_jump_title': { en: "Jump to {name}'s retained message", tr: '{name} kullanıcısının korunmuş mesajına git' },
  'modaction.dismiss': { en: 'Dismiss moderator action notice', tr: 'Moderatör işlem bildirimini kapat' },
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
  'message.deleted_by.ai': { en: 'AI mod', tr: 'AI mod' },
  'message.deleted_by.mod': { en: 'moderator', tr: 'moderatör' },
  'message.banned': { en: 'BANNED', tr: 'BANLANDI' },
  'message.moderation_unknown': { en: 'MODERATION TYPE UNKNOWN', tr: 'MODERASYON TÜRÜ BİLİNMİYOR' },
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
  'tab.rewards': { en: 'Rewards', tr: 'Ödüller' },
  'tab.search': { en: 'Search', tr: 'Arama' },
  'tab.shortcuts': { en: 'Shortcuts', tr: 'Kısayollar' },
  'tab.about': { en: 'About', tr: 'Hakkında' },
  'search.placeholder': { en: 'Search chat messages…', tr: 'Sohbet mesajlarında ara…' },
  'search.hint': {
    en: 'Searches every message seen on this channel since the page was opened. Use words, "phrases", from:name, or -excluded terms.',
    tr: 'Sayfa açıldığından beri bu kanalda görülen tüm mesajlarda arar. Kelimeler, "ifadeler", from:ad veya -hariç terimler kullan.',
  },
  'search.unavailable': {
    en: 'No chat archive on this page — open a channel or a VOD.',
    tr: 'Bu sayfada sohbet arşivi yok — bir kanal veya VOD aç.',
  },
  'search.empty': { en: 'No message matches.', tr: 'Eşleşen mesaj yok.' },
  'search.widened': {
    en: 'No exact match. Showing loose sender-name matches.',
    tr: 'Tam eşleşme yok. Gevşek gönderen adı eşleşmeleri gösteriliyor.',
  },
  'search.count': {
    en: { one: '{n} match', other: '{n} matches' },
    tr: { one: '{n} sonuç', other: '{n} sonuç' },
  },
  'search.count_capped': {
    en: { one: '{n} match, newest {shown} shown', other: '{n} matches, newest {shown} shown' },
    tr: { one: '{n} sonuç, en yenisi {shown} tanesi gösteriliyor', other: '{n} sonuç, en yeni {shown} tanesi gösteriliyor' },
  },
  'search.truncated': {
    en: 'Older messages have already been dropped from the archive.',
    tr: 'Daha eski mesajlar arşivden düşmüştü.',
  },
  'search.hotkey_hint': { en: 'Ctrl+F opens this tab.', tr: 'Ctrl+F bu sekmeyi açar.' },
  'panel.removed_count': { en: 'Removed, {n} messages', tr: 'Kaldırılanlar, {n} mesaj' },
  'panel.removed_empty': { en: 'No removed messages yet', tr: 'Henüz kaldırılan mesaj yok' },
  'panel.removed_no_session': { en: 'No channel session is active.', tr: 'Etkin bir kanal oturumu yok.' },
  'panel.general_intro': { en: 'Monitor this session and choose the primary chat view.', tr: 'Oturum durumunu izle ve temel sohbet görünümünü seç.' },
  'panel.live_status': { en: 'Live status', tr: 'Canlı durum' },
  'stat.connection': { en: 'Connection', tr: 'Bağlantı' },
  'stat.channel': { en: 'Channel', tr: 'Kanal' },
  'stat.chatroom_id': { en: 'Chatroom ID', tr: 'Sohbet odası no' },
  'stat.pusher': { en: 'Pusher', tr: 'Canlı bağlantı' },
  'stat.messages': { en: 'Messages', tr: 'Mesaj' },
  'stat.preserved': { en: 'Preserved', tr: 'Korunan' },
  'stat.bans': { en: 'Bans', tr: 'Ban' },
  'stat.deletions': { en: 'Deletions', tr: 'Silme' },
  'stat.ghost_inline': { en: 'Ghost inline', tr: 'Silinen, yerinde' },
  'stat.ghost_pending': { en: 'Ghost pending', tr: 'Silinen, yer bekliyor' },
  'stat.ghost_evicted': { en: 'Ghost evicted', tr: 'Silinen, düşürüldü' },
  'stat.last_ban': { en: 'Last ban', tr: 'Son ban' },
  'panel.chat_view': { en: 'Chat view', tr: 'Sohbet görünümü' },
  'panel.chat_mode': { en: 'Chat mode', tr: 'Sohbet modu' },
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
  'setting.chatters_badges': { en: 'Active chatter badges', tr: 'Aktif sohbetçi rozetleri' },
  'setting.chatters_badges_desc': { en: 'Shows session removed-message evidence beside native chatter rows.', tr: 'Yerel sohbetçi satırlarında oturumdaki kaldırılan mesaj kanıtlarını gösterir.' },
  'setting.search_hotkey': { en: 'Ctrl+F opens chat search', tr: 'Ctrl+F sohbet aramasını açar' },
  'setting.search_hotkey_desc': {
    en: 'Off returns Ctrl+F to the browser’s page find. The Search tab stays available either way.',
    tr: 'Kapalıyken Ctrl+F tarayıcının sayfa aramasına döner. Arama sekmesi her durumda açık kalır.',
  },
  'setting.user_messages': { en: 'Messages this session', tr: 'Bu oturumdaki mesajlar' },
  'setting.user_messages_desc': { en: 'Shows this user’s messages retained during the current session.', tr: 'Bu kullanıcının mevcut oturumda tutulan mesajlarını gösterir.' },
  'setting.hide_quick_emotes': { en: 'Hide quick emote bar', tr: 'Hızlı emoji çubuğunu gizle' },
  'setting.hide_quick_emotes_desc': { en: 'Hides Kick’s emote shortcuts above chat input. The emote picker still works.', tr: 'Sohbet girişinin üstündeki Kick emoji kısayollarını gizler. Emoji seçici çalışmaya devam eder.' },
  'setting.mod_actions': { en: 'Moderator action notices', tr: 'Moderatör işlem bildirimleri' },
  'setting.mod_actions_desc': { en: 'Shows docked notices when messages are banned, timed out, or deleted.', tr: 'Mesajlar banlandığında, zaman aşımına uğradığında veya silindiğinde sabit bildirimler gösterir.' },
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
  'setting.role_style': { en: 'Moderator / VIP style', tr: 'Moderatör / VIP stili' },
  'setting.role_style_desc': { en: 'Keep the left bar only, or add a faint row fill.', tr: 'Yalnızca sol çubuğu kullan veya hafif bir satır dolgusu ekle.' },
  'setting.role_style_frame': { en: 'Bar only', tr: 'Yalnız çubuk' },
  'setting.role_style_both': { en: 'Bar + fill', tr: 'Çubuk + dolgu' },
  'setting.role_colors': { en: 'Role colors', tr: 'Rol renkleri' },
  'setting.role_colors_desc': { en: 'Customize moderator and VIP colors.', tr: 'Moderatör ve VIP renklerini özelleştir.' },
  'setting.mod_frame': { en: 'Highlight moderator messages', tr: 'Moderatör mesajlarını vurgula' },
  'setting.mod_frame_desc': { en: 'Uses the shared role style and moderator color.', tr: 'Ortak rol stilini ve moderatör rengini kullanır.' },
  'setting.mod_frame_color': { en: 'Moderator color', tr: 'Moderatör rengi' },
  'setting.mod_frame_color_desc': { en: 'Pick a swatch or a custom color (green band is reserved).', tr: 'Hazır renklerden seç veya özel bir renk kullan (yeşil bant ayrılmıştır).' },
  'setting.mod_frame_color_warn': { en: 'That green is reserved for reply-jump — a nearby hue was applied instead.', tr: 'O yeşil yanıt-atlama için ayrılmış — yakın bir ton uygulandı.' },
  'setting.vip_frame': { en: 'Highlight VIP messages', tr: 'VIP mesajlarını vurgula' },
  'setting.vip_frame_desc': { en: 'Uses the shared role style and VIP color.', tr: 'Ortak rol stilini ve VIP rengini kullanır.' },
  'setting.vip_frame_color': { en: 'VIP color', tr: 'VIP rengi' },
  'setting.vip_frame_color_desc': { en: 'Pick a swatch or a custom color (green band is reserved).', tr: 'Hazır renklerden seç veya özel bir renk kullan (yeşil bant ayrılmıştır).' },
  'setting.vip_frame_color_warn': { en: 'That green is reserved for reply-jump — a nearby hue was applied instead.', tr: 'O yeşil yanıt-atlama için ayrılmış — yakın bir ton uygulandı.' },
  'chatters.removed_count': {
    en: { one: '{n} removed', other: '{n} removed' },
    tr: { one: '{n} kaldırıldı', other: '{n} kaldırıldı' },
  },
  'chatters.open_removed': { en: 'Review {n} removed messages from {name}', tr: '{name} için kaldırılan {n} mesajı incele' },
  'panel.player_intro': { en: 'Manage playback and tools added to the native control bar.', tr: 'Yayın oynatımını ve yerel kontrol çubuğuna eklenen araçları yönet.' },
  'panel.rewards_intro': {
    en: "Manage Kick Drops and daily rewards from this tab. Drops use Kick's own button; daily rewards briefly open and close Kick's reward window. Neither feature touches channel points.",
    tr: 'Kick Drops ve günlük ödüllerini bu sekmeden yönet. Drops, Kick’in kendi düğmesiyle alınır; günlük ödül için Kick’in ödül penceresi kısa süre açılıp kapanır. İki özellik de kanal puanlarına dokunmaz.',
  },
  'setting.auto_theater': { en: 'Automatic theater mode', tr: 'Otomatik tiyatro modu' },
  'setting.auto_theater_desc': { en: 'Switches to the wide player layout when a channel opens.', tr: 'Kanal açıldığında geniş oynatıcı düzenine geçer.' },
  'setting.caption_guard': { en: 'Keep captions off by default', tr: 'Altyazıyı varsayılan olarak kapalı tut' },
  'setting.caption_guard_desc': { en: 'Prevents Kick from silently restoring captions after a reload. You can still turn them on manually for the current session.', tr: 'Kick’in altyazıyı yenilemeden sonra sessizce geri açmasını önler. Geçerli oturumda yine elle açabilirsin.' },
  'setting.seek': { en: 'Seek back / forward', tr: 'Geri / ileri sarma' },
  'setting.seek_desc': { en: 'Adds 10-second seek buttons to the control bar.', tr: 'Kontrol çubuğuna 10 saniyelik sarma düğmeleri ekler.' },
  'setting.seek_bar': { en: 'Seek bar', tr: 'Sarma çubuğu' },
  'setting.seek_bar_desc': { en: "Draws the green position bar whenever Kick leaves it out, which it often does on a live stream.", tr: 'Kick canlı yayında sık sık çizmediği yeşil konum çubuğunu, çizmediği zaman bizim çizmemizi sağlar.' },
  'setting.live_catchup': { en: 'Live catch-up', tr: 'Canlıya yetişme' },
  'setting.live_catchup_desc': { en: 'Carefully accelerates playback when the stream falls behind.', tr: 'Geride kalınca yayını kontrollü biçimde hızlandırır.' },
  'setting.quality_lock': { en: 'Quality button', tr: 'Kalite düğmesi' },
  'setting.quality_always_best': { en: 'Open every stream at the highest quality', tr: 'Her yayını en yüksek kalitede aç' },
  'setting.quality_always_best_desc': { en: 'A quality you pick by hand holds for that stream only; the next stream opens at the highest again. Off: your last pick is remembered.', tr: 'Elle seçtiğin kalite yalnız o yayında kalır; sonraki yayın yine en yüksekte açılır. Kapalıyken son seçimin hatırlanır.' },
  'setting.quality_lock_desc': { en: 'Shows the quality button on the player bar and keeps the quality you pick there.', tr: 'Oynatıcı barında kalite düğmesini gösterir ve orada seçtiğin kaliteyi korur.' },
  'setting.screenshot': { en: 'Screenshot', tr: 'Ekran görüntüsü' },
  'setting.screenshot_desc': { en: 'Adds a frame-capture button to the control bar.', tr: 'Kontrol çubuğuna kare yakalama düğmesi ekler.' },
  'setting.speed': { en: 'Speed controls', tr: 'Hız kontrolleri' },
  'setting.speed_desc': { en: 'Shows manual and automatic playback-speed tools.', tr: 'Manuel ve otomatik oynatma hızı araçlarını gösterir.' },
  'setting.fullscreen_terminal': { en: 'Fullscreen terminal slot', tr: 'Tam ekranı sona al' },
  'setting.fullscreen_terminal_desc': { en: "Moves Kick's fullscreen button after the settings control with CSS order; the DOM stays unchanged.", tr: 'Kick’in tam ekran düğmesini CSS order ile ayarlar kontrolünün arkasına alır; DOM değişmez.' },
  'setting.auto_claim_drops': { en: 'Auto-claim Drops', tr: 'Drops ödüllerini otomatik al' },
  'setting.auto_claim_drops_desc': {
    en: "On the channel you watch, automatically claims Kick Drops rewards when a reward reaches 100% by clicking Kick's own Claim button. Only while this Kick tab is open: it never calls a Kick API or runs as a background service. Never touches channel points; spending them is your choice.",
    tr: 'İzlediğin kanalda bir Kick Drops ödülü %100’e ulaştığında Kick’in kendi alma düğmesine tıklayarak otomatik alır. Yalnızca Kick sekmesi açıkken çalışır; Kick’e kendi başına istek göndermez ve arka planda çalışmaz. Kanal puanlarına hiç dokunmaz; onları harcayıp harcamamak senin kararın.',
  },
  'setting.auto_claim_daily_reward': { en: 'Auto-claim daily reward', tr: 'Günlük ödülü otomatik al' },
  'setting.auto_claim_daily_reward_desc': {
    en: "Automatically claims Kick's daily reward by briefly opening and closing Kick's own reward window. It runs only while this Kick tab is open and never touches channel points.",
    tr: 'Kick’in günlük ödülünü, kendi ödül penceresini kısa süre açıp kapatarak senin için otomatik alır. Yalnızca bu Kick sekmesi açıkken çalışır ve kanal puanlarına hiç dokunmaz.',
  },
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
  'player.behind_seconds': { en: '−{n} s', tr: '−{n} sn' },
  'player.behind_minutes': { en: '−{n} min', tr: '−{n} dk' },
  'player.seek_back_title': { en: '{n}s back', tr: '{n} sn geri' },
  'player.seek_forward_title': { en: '{n}s forward', tr: '{n} sn ileri' },
  'player.seek_back_aria': { en: 'Seek back {n} seconds', tr: '{n} saniye geri sar' },
  'player.seek_forward_aria': { en: 'Seek forward {n} seconds', tr: '{n} saniye ileri sar' },
  'player.screenshot': { en: 'Take screenshot', tr: 'Ekran görüntüsü al' },
  'player.buffer_warning': { en: 'Buffer under pressure; speed reduced to 1.5x', tr: 'Buffer zorlandı; hız 1.5x oldu' },
  'player.manual_speed': { en: 'Manual speed: {rate}', tr: 'Manuel hız: {rate}' },
  'player.auto': { en: 'AUTO', tr: 'OTO' },
  'player.select_speed': { en: 'Select playback speed', tr: 'Oynatma hızını seç' },
  'player.more_controls': { en: 'More controls', tr: 'Diğer kontroller' },
  'player.quality': { en: 'Quality', tr: 'Kalite' },
  'player.quality_best': { en: 'Best picture', tr: 'En iyi görüntü' },
  'player.quality_best_hint': { en: 'Always the highest', tr: 'Hep en yüksek' },
  'player.quality_best_hint_now': { en: 'Always the highest, now {label}', tr: 'Hep en yüksek, şu an {label}' },
  'player.quality_auto': { en: 'Match my connection', tr: 'Bağlantıya göre' },
  'player.quality_auto_hint': { en: 'Steps down by itself when the connection slows', tr: 'İnternet yavaşlarsa kendisi düşürür' },
  'player.quality_saver': { en: 'Data saver', tr: 'Veri tasarrufu' },
  'player.quality_saver_hint': { en: 'At most 480p, for mobile data', tr: 'En çok 480p, telefon interneti için' },
  'player.quality_more': { en: 'Other resolutions', tr: 'Diğer çözünürlükler' },
  'player.quality_sub_best': { en: 'BEST', tr: 'EN İYİ' },
  'player.quality_sub_stream': { en: 'THIS STREAM', tr: 'BU YAYIN' },
  'player.quality_sub_saver': { en: 'SAVER', tr: 'TASARRUF' },

  'entry.footer_title': { en: 'KickFlow removed messages', tr: 'KickFlow kaldırılan mesajlar' },
  'entry.footer_aria': { en: 'Open KickFlow removed messages', tr: 'KickFlow kaldırılan mesajları aç' },
  'entry.settings_title': { en: 'KickFlow settings', tr: 'KickFlow ayarları' },
  'entry.settings_aria': { en: 'Open KickFlow settings', tr: 'KickFlow ayarlarını aç' },
  'overlay.connected': { en: 'Connected, waiting for messages…', tr: 'Bağlandı — mesajlar bekleniyor…' },
  'overlay.reconnecting': { en: 'Reconnecting…', tr: 'Yeniden bağlanıyor…' },
  'overlay.replay_loading': { en: 'Loading replay chat…', tr: 'Yayın sohbeti yükleniyor…' },
  'overlay.replay_ready': { en: 'Replay chat ready — waiting for messages…', tr: 'Yayın sohbeti hazır — mesajlar bekleniyor…' },
  'chat.new_messages': { en: '↓ New messages', tr: '↓ Yeni mesajlar' },
  'chat.pause_count': {
    en: { one: '{count} new message', other: '{count} new messages' },
    tr: { one: '{count} yeni mesaj', other: '{count} yeni mesaj' },
  },
  'chat.new_messages_count': {
    en: { one: '↓ {count} new message', other: '↓ {count} new messages' },
    tr: { one: '↓ {count} yeni mesaj', other: '↓ {count} yeni mesaj' },
  },

  'status.starting': { en: 'starting', tr: 'başlıyor' },
  'status.resolving_channel': { en: 'resolving channel…', tr: 'kanal bulunuyor…' },
  'status.not_channel': { en: 'not a channel page', tr: 'Bu sayfa bir kanal değil. Bir Kick yayını aç.' },
  'status.chatroom_unresolved': { en: 'could not resolve chatroom id', tr: 'sohbet odası bulunamadı' },
  'status.pusher_connecting': { en: 'Pusher connecting…', tr: 'canlı sohbete bağlanıyor…' },
  'status.socket_waiting': { en: 'Pusher socket connected, waiting for chatroom subscription…', tr: 'bağlandı, sohbet odası bekleniyor…' },
  'status.active_native': { en: 'active, marking native chat', tr: 'çalışıyor, Kick’in sohbeti kullanılıyor' },
  'status.active_native_replay': { en: 'active — native replay chat', tr: 'çalışıyor, Kick’in tekrar sohbeti kullanılıyor' },
  'status.subscription_waiting_native': { en: 'waiting for chatroom subscription, native chat', tr: 'sohbet odası bekleniyor; şimdilik Kick’in sohbeti görünüyor' },
  'status.active_own': { en: 'active, rendering KickFlow list', tr: 'çalışıyor, KickFlow sohbet listesi gösteriliyor' },
  'status.vod_replay_loading': { en: 'loading replay chat…', tr: 'yayın sohbeti yükleniyor…' },
  'status.active_vod_replay': { en: 'active — replay chat synchronized', tr: 'çalışıyor, tekrar sohbeti videoyla eş zamanlı' },
  'status.vod_replay_failed_native': { en: 'replay unavailable — native replay chat', tr: 'tekrar sohbeti alınamadı; Kick’in sohbeti görünüyor' },
  'status.content_not_ready': { en: 'content not ready, retrying in background with native chat', tr: 'sohbet henüz hazır değil; Kick’in sohbeti görünüyor, arka planda yeniden deneniyor' },
  'status.chatroom_unresolved_native': { en: 'could not resolve chatroom id, native chat', tr: 'sohbet odası bulunamadı; Kick’in sohbeti görünüyor. Sayfayı yenile.' },
  'status.history_empty': { en: 'history empty, waiting for live chatroom subscription…', tr: 'geçmiş boş, canlı sohbet bekleniyor…' },
  'status.history_failed': { en: 'could not load history, waiting for live chatroom subscription…', tr: 'geçmiş alınamadı, canlı sohbet bekleniyor…' },
  'status.active_ready': { en: 'active, chatroom subscription ready', tr: 'çalışıyor, sohbet odası hazır' },
  'status.chatroom_ready_waiting': { en: 'chatroom ready, waiting for visible chat area', tr: 'sohbet odası hazır, sohbet alanı bekleniyor' },
  'status.primary_unavailable': { en: 'chatroom connection not ready ({reason}), native chat', tr: 'canlı sohbet hazır değil ({reason}); Kick’in sohbeti görünüyor' },
  'status.reconnecting': { en: 'reconnecting…', tr: 'yeniden bağlanıyor…' },
  'status.reconnect_failed': { en: 'could not reconnect to chatroom, native chat', tr: 'sohbet odasına yeniden bağlanılamadı; Kick’in sohbeti görünüyor. Sayfayı yenile.' },
  'status.waiting_chat_panel': { en: 'waiting for chat panel…', tr: 'sohbet paneli bekleniyor…' },

  'popup.tagline': { en: 'A streamlined Kick experience.', tr: 'Kick deneyimi, sadeleştirilmiş.' },
  'popup.connection_status': { en: 'Connection status', tr: 'Bağlantı durumu' },
  'popup.reading_status': { en: 'Reading status…', tr: 'Durum okunuyor…' },
  'popup.mode_desc': { en: 'Kick or KickFlow list', tr: 'Kick veya KickFlow listesi' },
  'popup.hover_follow': { en: 'Scrolling under the pointer', tr: 'İmleç altındaki kaydırma' },
  'popup.hover_follow_desc': { en: 'KickFlow list: how new messages move in while you point at chat', tr: 'KickFlow listesi: imleç sohbetteyken yeni mesajlar nasıl gelir' },
  'popup.status_stats': { en: 'Status / Statistics', tr: 'Durum / İstatistik' },
  'popup.debug_log': { en: 'Debug log (F12)', tr: 'Hata ayıklama kaydı (F12)' },
  'popup.changes_hint': { en: 'Changes apply immediately and persist after reload.', tr: 'Değişiklik anında uygulanır; kanal yeniden yüklenince de korunur.' },
  // Texts that popup.html carried only in English (2026-11-16): en is the old HTML text, byte for byte.
  'popup.hover_smooth': { en: 'Smooth', tr: 'Yumuşak' },
  'popup.hover_instant': { en: 'Instant', tr: 'Anında' },
  'popup.mode_option_native': { en: 'Native', tr: 'Kick’in sohbeti' },
  'popup.active_mode_own': { en: 'own chat', tr: 'KickFlow sohbet listesi' },
  'popup.active_mode_native': { en: 'native chat', tr: 'Kick’in sohbeti' },
  'popup.not_connected': { en: 'not connected', tr: 'Kick sekmesine bağlanılamadı. Sayfayı yenile.' },
  'popup.active': { en: 'KickFlow active · {mode}', tr: 'KickFlow aktif · {mode}' },
  'popup.pusher_connected': { en: 'connected', tr: 'bağlı' },
  'popup.pusher_disconnected': { en: 'disconnected', tr: 'bağlı değil' },
  'popup.no_active_tab': { en: 'no active tab', tr: 'Açık bir sekme yok. Bir Kick yayını aç.' },
  'popup.not_kick_tab': { en: 'not a Kick tab / content script unavailable', tr: 'Bu sekmede KickFlow çalışmıyor. Bir Kick yayını aç ya da sayfayı yenile.' },
  'popup.open_kick': { en: 'Open kick.com in the active tab', tr: 'Bu sekme Kick değil. Bir Kick yayını aç.' },
  'popup.summary': { en: 'This session', tr: 'Bu oturum' },
  'popup.sum_messages': { en: 'Messages seen', tr: 'Görülen mesaj' },
  'popup.sum_preserved': { en: 'Kept after removal', tr: 'Silinse de korunan' },
  'popup.sum_bans': { en: 'Kept from bans', tr: 'Bandan korunan' },
  'popup.diagnostics': { en: 'Diagnostics', tr: 'Tanılama' },
  'popup.diagnostics_desc': { en: 'Technical details for bug reports.', tr: 'Hata bildirimi için teknik ayrıntılar.' },
  'popup.mode_native': { en: 'Kick chat', tr: 'Kick sohbeti' },
  'popup.mode_own': { en: 'KickFlow list', tr: 'KickFlow listesi' },
  'popup.tab_unavailable': { en: 'Could not connect to the Kick tab.', tr: 'Kick sekmesine bağlanılamadı.' },
  'popup.save_failed': { en: 'Setting changed for this tab, but could not be saved.', tr: 'Ayar bu sekmede değişti ancak kaydedilemedi.' },

  'time.seconds_ago': { en: { one: '{n} second ago', other: '{n} seconds ago' }, tr: { one: '{n} sn önce', other: '{n} sn önce' } },
  'time.minutes_ago': { en: { one: '{n} minute ago', other: '{n} minutes ago' }, tr: { one: '{n} dk önce', other: '{n} dk önce' } },
  'time.hours_ago': { en: { one: '{n} hour ago', other: '{n} hours ago' }, tr: { one: '{n} sa önce', other: '{n} sa önce' } },

  'user.not_subscribed': { en: 'not subscribed', tr: 'abone değil' },
  'user.unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'user.subscribed_months': { en: { one: '{n} month', other: '{n} months' }, tr: { one: '{n} ay abone', other: '{n} ay abone' } },
  'user.not_following': { en: 'not following', tr: 'takip etmiyor' },
  'user.close': { en: 'Close user card', tr: 'Kullanıcı kartını kapat' },
  'user.open_middle': { en: 'kick.com/{slug}, middle-click to open in a new tab', tr: 'kick.com/{slug} — orta tıkla yeni sekmede aç' },
  'user.verified': { en: 'verified', tr: 'doğrulanmış' },
  'user.followers': { en: 'followers', tr: 'takipçi' },
  'user.created': { en: 'account created', tr: 'hesap oluşturma' },
  'user.following': { en: 'following', tr: 'takip' },
  'user.subscription': { en: 'subscription', tr: 'abonelik' },
  'user.messages': { en: 'Messages this session', tr: 'Bu oturumdaki mesajlar' },
  'user.messages_empty': { en: 'No messages recorded in this session.', tr: 'Bu oturumda kayıtlı mesaj yok.' },
  'user.messages_truncated': { en: 'Older messages were not retained.', tr: 'Daha eskisi tutulmadı.' },
  'user.messages_jump': { en: 'Click to jump to this message', tr: 'Mesaja gitmek için tıkla' },
  'user.open': { en: 'open', tr: 'aç' },
  'user.follow_on_kick': { en: 'Follow on Kick', tr: "Kick'te takip et" },
  'user.kick_controls': { en: 'Kick controls', tr: 'Kick işlemleri' },
  // 2026-11-24: ultrawide fill (U key) toast.
  'player.aspect_contain': { en: 'Picture: as sent (bands)', tr: 'Görüntü: olduğu gibi (bantlı)' },
  'player.aspect_cover': { en: 'Picture: fill by cropping', tr: 'Görüntü: kırparak doldur' },
  'player.aspect_stretch': { en: 'Picture: slight stretch', tr: 'Görüntü: hafif germe' },
  // 0.4.3 (2026-11-24, code review B13): the loudness leveller says when it cannot work.
  'player.leveller_silent': { en: 'Loudness leveller hears no sound. Reload the page to get it back.', tr: 'Ses dengeleyici ses alamıyor. Sesi geri almak için sayfayı yenile.' },
  'player.leveller_unsupported': { en: 'Loudness leveller cannot work on this player; the sound is left as it is.', tr: 'Ses dengeleyici bu oynatıcıda çalışamıyor; ses olduğu gibi bırakıldı.' },
} as const satisfies Record<string, { en: LocalizedTemplate; tr: LocalizedTemplate }>;

export type MessageKey = keyof typeof messages;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
const MINIMUM_DURATION_MINUTES = 0;

type DurationMessageKey =
  | 'duration.minutes_short'
  | 'duration.hours_short'
  | 'duration.hours_minutes_short'
  | 'duration.days_short';

function interpolateTemplate(template: string, params: Params): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

function interpolateDuration(
  key: DurationMessageKey,
  language: Lang,
  params: Record<string, number>,
): string {
  return interpolateTemplate(messages[key][language], params);
}

/** Pure, language-explicit duration formatting for minute-based moderation values. */
export function formatDurationMinutes(
  minutes: number | null | undefined,
  language: Lang,
): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= MINIMUM_DURATION_MINUTES) return '';

  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes < MINUTES_PER_HOUR) {
    return interpolateDuration('duration.minutes_short', language, { n: roundedMinutes });
  }

  if (roundedMinutes < MINUTES_PER_DAY) {
    const hours = Math.floor(roundedMinutes / MINUTES_PER_HOUR);
    const remainingMinutes = roundedMinutes % MINUTES_PER_HOUR;
    if (remainingMinutes > MINIMUM_DURATION_MINUTES) {
      return interpolateDuration('duration.hours_minutes_short', language, {
        h: hours,
        m: remainingMinutes,
      });
    }
    return interpolateDuration('duration.hours_short', language, { n: hours });
  }

  return interpolateDuration('duration.days_short', language, {
    n: Math.round(roundedMinutes / MINUTES_PER_DAY),
  });
}

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
  return interpolateTemplate(template, params);
}

let statusPatterns: { key: MessageKey; pattern: RegExp; names: string[] }[] | null = null;

/** The page script writes its status line in its own language (English until kf_lang is stored), while a
 * popup may run in another one (?lang=tr opens it in Turkish). Returns a known status line in the
 * current language; any other text comes back unchanged. */
export function localizeStatusLine(text: string): string {
  statusPatterns ??= (Object.keys(messages) as MessageKey[])
    .filter((key) => key.startsWith('status.'))
    .flatMap((key) => (['en', 'tr'] as const).map((language) => {
      const template = messages[key][language] as string;
      const names: string[] = [];
      const source = template.split(/(\{[a-zA-Z0-9_]+\})/).map((part) => {
        const name = /^\{([a-zA-Z0-9_]+)\}$/.exec(part)?.[1];
        if (name) { names.push(name); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return { key, pattern: new RegExp(`^${source}$`), names };
    }));
  for (const { key, pattern, names } of statusPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    return t(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return text;
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
