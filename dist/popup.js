"use strict";
(() => {
  // src/content/shared/extension-context.ts
  function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }
  async function safeStorageGet(keys) {
    if (!isExtensionContextValid()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return {};
    }
  }
  async function safeStorageSet(items) {
    if (!isExtensionContextValid()) return false;
    try {
      await chrome.storage.local.set(items);
      return true;
    } catch {
      return false;
    }
  }

  // src/content/shared/i18n.ts
  var STORAGE_KEY = "kf_lang";
  var messages = {
    "overlay.failed": { en: "KickFlow could not start. Kick chat is available.", tr: "KickFlow ba\u015Flat\u0131lamad\u0131. Kick sohbeti a\xE7\u0131k." },
    "overlay.retry": { en: "Try again", tr: "Tekrar dene" },
    "overlay.gap": { en: "Connection gap \xB7 estimated missing messages: {n}", tr: "Ba\u011Flant\u0131 kesintisi \xB7 eksik mesaj tahmini: {n}" },
    "overlay.gap_time": { en: "Connection gap \xB7 about {n} seconds could not be recovered", tr: "Ba\u011Flant\u0131 kesintisi \xB7 yakla\u015F\u0131k {n} saniye al\u0131namad\u0131" },
    "player.controls": { en: "Video player controls", tr: "Video oynat\u0131c\u0131 denetimleri" },
    "player.clip_record": { en: "Record next 15 seconds locally", tr: "Sonraki 15 saniyeyi bilgisayara kaydet" },
    "player.clip_stop": { en: "Stop local recording and preview", tr: "Yerel kayd\u0131 durdur ve \xF6nizle" },
    "player.clip_preview": { en: "Local clip preview", tr: "Yerel klip \xF6nizlemesi" },
    "player.clip_save": { en: "Save WebM to Downloads", tr: "WebM dosyas\u0131n\u0131 \u0130ndirilenler klas\xF6r\xFCne kaydet" },
    "player.clip_ready": { en: "Clip ready. Preview and save below.", tr: "Klip haz\u0131r. \xD6nizleyip a\u015Fa\u011F\u0131dan kaydet." },
    "player.clip_recording": { en: "Recording next 15 seconds. Press again to stop.", tr: "Sonraki 15 saniye kaydediliyor. Durdurmak i\xE7in tekrar bas." },
    "player.clip_unsupported": { en: "Local recording is unavailable in this browser.", tr: "Bu taray\u0131c\u0131da yerel kay\u0131t kullan\u0131lam\u0131yor." },
    "player.capture_no_frame": { en: "Start playback before capturing a frame or clip.", tr: "G\xF6r\xFCnt\xFC veya klip almak i\xE7in \xF6nce videoyu oynat." },
    "player.capture_failed": { en: "Capture failed. This video may restrict recording.", tr: "Kay\u0131t al\u0131namad\u0131. Bu video kayda izin vermiyor olabilir." },
    "chat.reply_to": { en: "Reply to {name}", tr: "{name} kullan\u0131c\u0131s\u0131na yan\u0131tla" },
    "category.turkish_off": { en: "Show only Turkish streams (Kick language filter). Remembered on every category.", tr: "Yaln\u0131z T\xFCrk\xE7e yay\u0131nlar\u0131 g\xF6ster (Kick dil filtresi). Her kategoride hat\u0131rlan\u0131r." },
    "category.turkish_on": { en: "Turkish filter on. Click to show all languages.", tr: "T\xFCrk\xE7e filtresi a\xE7\u0131k. T\xFCm dilleri g\xF6stermek i\xE7in t\u0131kla." },
    "chat.thread_open": { en: "Thread", tr: "Yan Sohbet" },
    "chat.reply_unavailable": { en: "Kick's reply box was not found. Reload the page (F5); if this line comes back, Kick's page changed: send a screenshot of it.", tr: "Kick'in yan\u0131t kutusu bulunamad\u0131. Sayfay\u0131 yenile (F5); bu sat\u0131r yine \xE7\u0131karsa Kick sayfas\u0131 de\u011Fi\u015Fmi\u015F demektir, ekran g\xF6r\xFCnt\xFCs\xFCn\xFC g\xF6nder." },
    "chat.reply_wrong_room": { en: "This message belongs to another channel's chat. Reload the page (F5).", tr: "Bu mesaj a\xE7\u0131k kanal\u0131n sohbetine ait de\u011Fil. Sayfay\u0131 yenile (F5)." },
    "chat.reply_no_bridge": { en: "KickFlow's page helper is not loaded. Reload the page (F5).", tr: "KickFlow'un sayfa yard\u0131mc\u0131s\u0131 y\xFCklenmemi\u015F. Sayfay\u0131 yenile (F5)." },
    "chat.reply_followers_only": { en: "This chat is followers only; a reply cannot be written.", tr: "Bu sohbet takip\xE7ilere \xF6zel; yan\u0131t yaz\u0131lam\u0131yor." },
    "chat.reply_subscribers_only": { en: "This chat is subscribers only; a reply cannot be written.", tr: "Bu sohbet abonelere \xF6zel; yan\u0131t yaz\u0131lam\u0131yor." },
    "chat.reply_login_required": { en: "Sign in to write a reply in this chat.", tr: "Bu sohbette yan\u0131t yazmak i\xE7in giri\u015F yap." },
    "chat.reply_rules_required": { en: "Accept the native chat rules to write a reply.", tr: "Yan\u0131t yazmak i\xE7in yerel sohbet kurallar\u0131n\u0131 kabul et." },
    "chat.reply_no_editor": { en: "This chat has no writable message field; a reply cannot be written.", tr: "Bu sohbette yaz\u0131 yaz\u0131lam\u0131yor; kullan\u0131labilir mesaj alan\u0131 yok." },
    "setting.floating_strip": { en: "Cinema strip", tr: "Sinema \u015Feridi" },
    "setting.floating_strip_desc": { en: "Kick's player bar floats as one glass strip over a soft dark fade. Off: Kick's flat bar with KickFlow's plate.", tr: "Kick\u2019in oynat\u0131c\u0131 \xE7ubu\u011Fu yumu\u015Fak bir koyu ge\xE7i\u015Fin \xFCst\xFCnde tek par\xE7a cam \u015Ferit olur. Kapal\u0131: Kick\u2019in d\xFCz \xE7ubu\u011Fu ve KickFlow plakas\u0131." },
    "player.to_live": { en: "Live", tr: "Canl\u0131ya" },
    "player.seconds_short": { en: "s", tr: "sn" },
    "player.forward_at_live": { en: "Already at live", tr: "Zaten canl\u0131das\u0131n" },
    "player.speed_menu_title": { en: "Playback speed", tr: "Oynatma h\u0131z\u0131" },
    "player.speed_auto_title": { en: "Catch up with live", tr: "Canl\u0131ya otomatik yeti\u015F" },
    "player.speed_auto_hint": { en: "Up to 1.5\xD7 when behind, 1\xD7 at live", tr: "Geride kal\u0131nca en \xE7ok 1,5\xD7, canl\u0131da 1\xD7" },
    "player.speed_manual_hint": { en: "Picking a speed turns Auto off", tr: "Elle h\u0131z se\xE7mek Otomatik\u2019i kapat\u0131r" },
    "player.speed_catching": { en: "Speed {rate}, catching up with live", tr: "H\u0131z {rate}, canl\u0131ya yeti\u015Fiyor" },
    "player.frame_saved": { en: "Frame saved", tr: "Kare kaydedildi" },
    "common.close": { en: "Close", tr: "Kapat" },
    "common.change": { en: "Change", tr: "De\u011Fi\u015Ftir" },
    "common.reset_defaults": { en: "Reset to defaults", tr: "Varsay\u0131lana d\xF6n" },
    "common.connected": { en: "Connected", tr: "Ba\u011Fl\u0131" },
    "common.waiting": { en: "Waiting", tr: "Bekliyor" },
    "common.yes": { en: "yes", tr: "evet" },
    "common.no": { en: "no", tr: "hay\u0131r" },
    "common.space": { en: "Space", tr: "Bo\u015Fluk" },
    "event.subscription.new": { en: "subscribed", tr: "abone oldu" },
    "event.subscription.months": {
      en: { one: "subscribed for {n} month", other: "subscribed for {n} months" },
      tr: { one: "{n} ay abone oldu", other: "{n} ay abone oldu" }
    },
    "event.celebration.months": {
      en: { one: "resubscribed for {n} month", other: "resubscribed for {n} months" },
      tr: { one: "{n}. abonelik ay\u0131n\u0131 kutlad\u0131", other: "{n}. abonelik ay\u0131n\u0131 kutlad\u0131" }
    },
    "event.gift.single": { en: " gifted a sub to {name}", tr: ", {name} kullan\u0131c\u0131s\u0131na abonelik hediye etti" },
    "event.gift.bulk": {
      en: { one: "gifted a sub to {n} person", other: "gifted a sub to {n} people" },
      tr: { one: "{n} ki\u015Fiye abonelik hediye etti", other: "{n} ki\u015Fiye abonelik hediye etti" }
    },
    "event.gift.more": {
      en: { one: " and {n} more", other: " and {n} more" },
      tr: { one: " ve {n} ki\u015Fi daha", other: " ve {n} ki\u015Fi daha" }
    },
    "event.kicks": { en: "gifted {n} KICKs", tr: "{n} KICKs hediye etti" },
    "event.host.viewers": {
      en: { one: "hosted with {n} viewer", other: "hosted with {n} viewers" },
      tr: { one: "{n} izleyiciyle host etti", other: "{n} izleyiciyle host etti" }
    },
    "event.host": { en: "hosted", tr: "host etti" },
    "modaction.ban.single": { en: "{mod} banned {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 banlad\u0131." },
    "modaction.ban.single.unknown": { en: "A moderator banned {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 banlad\u0131." },
    "modaction.ban.bulk": { en: "{mod} banned {n} users:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 banlad\u0131:" },
    "modaction.ban.bulk.unknown": { en: "A moderator banned {n} users:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 banlad\u0131:" },
    "modaction.timeout.single": { en: "{mod} timed out {name} for {duration}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 {duration} susturdu." },
    "modaction.timeout.single.unknown": { en: "A moderator timed out {name} for {duration}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 {duration} susturdu." },
    "modaction.timeout.single.no_duration": { en: "{mod} timed out {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131y\u0131 susturdu." },
    "modaction.timeout.single.no_duration.unknown": { en: "A moderator timed out {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131y\u0131 susturdu." },
    "modaction.timeout.bulk": { en: "{mod} timed out {n} users:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 susturdu:" },
    "modaction.timeout.bulk.unknown": { en: "A moderator timed out {n} users:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 susturdu:" },
    "modaction.timeout.bulk.duration": { en: "{mod} timed out {n} users for {duration}:", tr: "{mod}, {n} kullan\u0131c\u0131y\u0131 {duration} susturdu:" },
    "modaction.timeout.bulk.duration.unknown": { en: "A moderator timed out {n} users for {duration}:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131y\u0131 {duration} susturdu:" },
    "modaction.delete.single": { en: "{mod} deleted a message from {name}.", tr: "{mod}, {name} adl\u0131 kullan\u0131c\u0131n\u0131n mesaj\u0131n\u0131 sildi." },
    "modaction.delete.single.unknown": { en: "A moderator deleted a message from {name}.", tr: "Bir moderat\xF6r, {name} adl\u0131 kullan\u0131c\u0131n\u0131n mesaj\u0131n\u0131 sildi." },
    "modaction.delete.bulk": { en: "{mod} deleted {n} messages:", tr: "{mod}, {n} mesaj\u0131 sildi:" },
    "modaction.delete.bulk.unknown": { en: "A moderator deleted {n} messages:", tr: "Bir moderat\xF6r, {n} mesaj\u0131 sildi:" },
    "modaction.tag.ban": { en: "BAN", tr: "BAN" },
    "modaction.tag.timeout": { en: "TIMEOUT", tr: "SUSTURMA" },
    "modaction.tag.delete": { en: "DELETED", tr: "S\u0130L\u0130ND\u0130" },
    "modaction.tag.unknown": { en: "MODERATION", tr: "MODERASYON" },
    "modaction.unknown.single": { en: "{mod} moderated {name}; action type unknown.", tr: "{mod}, {name} i\xE7in moderasyon uygulad\u0131; t\xFCr\xFC bilinmiyor." },
    "modaction.unknown.single.no_moderator": { en: "A moderator acted on {name}; action type unknown.", tr: "Bir moderat\xF6r, {name} i\xE7in i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor." },
    "modaction.unknown.bulk": { en: "{mod} moderated {n} users; action type unknown:", tr: "{mod}, {n} kullan\u0131c\u0131ya i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor:" },
    "modaction.unknown.bulk.no_moderator": { en: "A moderator acted on {n} users; action type unknown:", tr: "Bir moderat\xF6r, {n} kullan\u0131c\u0131ya i\u015Flem yapt\u0131; t\xFCr\xFC bilinmiyor:" },
    "modaction.more": { en: { one: "and {n} more", other: "and {n} more" }, tr: { one: "ve {n} ki\u015Fi daha", other: "ve {n} ki\u015Fi daha" } },
    "modaction.moderator_profile_title": { en: "Open moderator {name}'s profile", tr: "{name} moderat\xF6r profilini a\xE7" },
    "modaction.target_profile_title": { en: "Open {name}'s profile", tr: "{name} profilini a\xE7" },
    "modaction.target_jump_title": { en: "Jump to {name}'s retained message", tr: "{name} kullan\u0131c\u0131s\u0131n\u0131n korunmu\u015F mesaj\u0131na git" },
    "modaction.dismiss": { en: "Dismiss moderator action notice", tr: "Moderat\xF6r i\u015Flem bildirimini kapat" },
    "event.mode.slow_on": { en: "Slow mode on ({n}s)", tr: "Yava\u015F mod a\xE7\u0131ld\u0131 ({n}sn)" },
    "event.mode.slow_off": { en: "Slow mode off", tr: "Yava\u015F mod kapand\u0131" },
    "event.mode.followers_on": { en: "Followers-only mode on", tr: "Sadece takip\xE7i modu a\xE7\u0131ld\u0131" },
    "event.mode.followers_on_minutes": { en: "Followers-only mode on ({n}m)", tr: "Sadece takip\xE7i modu a\xE7\u0131ld\u0131 ({n}dk)" },
    "event.mode.followers_off": { en: "Followers-only mode off", tr: "Sadece takip\xE7i modu kapand\u0131" },
    "event.mode.subscribers_on": { en: "Subscribers-only mode on", tr: "Sadece abone modu a\xE7\u0131ld\u0131" },
    "event.mode.subscribers_off": { en: "Subscribers-only mode off", tr: "Sadece abone modu kapand\u0131" },
    "event.mode.emotes_on": { en: "Emotes-only mode on", tr: "Sadece emote modu a\xE7\u0131ld\u0131" },
    "event.mode.emotes_off": { en: "Emotes-only mode off", tr: "Sadece emote modu kapand\u0131" },
    "message.deleted": { en: "DELETED", tr: "S\u0130L\u0130ND\u0130" },
    "message.deleted_by.ai": { en: "AI mod", tr: "AI mod" },
    "message.deleted_by.mod": { en: "moderator", tr: "moderat\xF6r" },
    "message.banned": { en: "BANNED", tr: "BANLANDI" },
    "message.moderation_unknown": { en: "MODERATION TYPE UNKNOWN", tr: "MODERASYON T\xDCR\xDC B\u0130L\u0130NM\u0130YOR" },
    "message.timeout": { en: "TIMEOUT", tr: "TIMEOUT" },
    "duration.minutes_short": { en: "{n}M", tr: "{n}DK" },
    "duration.hours_short": { en: "{n}H", tr: "{n}SA" },
    "duration.hours_minutes_short": { en: "{h}H {m}M", tr: "{h}SA {m}DK" },
    "duration.days_short": { en: "{n}D", tr: "{n}G" },
    "badge.badge": { en: "badge", tr: "rozet" },
    "badge.level": { en: "Level {n}", tr: "{n}. Seviye" },
    "badge.moderator": { en: "Moderator", tr: "Moderat\xF6r" },
    "badge.vip": { en: "VIP", tr: "VIP" },
    "badge.og": { en: "OG", tr: "OG" },
    "badge.gift_subscriber": { en: "Gift Subscriber", tr: "Hediye Aboneli\u011Fi" },
    "badge.verified_streamer": { en: "Verified Streamer", tr: "Onayl\u0131 Yay\u0131nc\u0131" },
    "badge.kick_staff": { en: "Kick Staff", tr: "Kick Ekibi" },
    "badge.broadcaster": { en: "Broadcaster", tr: "Yay\u0131nc\u0131" },
    "badge.founder": { en: "Founder", tr: "Kurucu" },
    "badge.sidekick": { en: "Sidekick", tr: "Sidekick" },
    "badge.bot": { en: "Bot", tr: "Bot" },
    "badge.trainwreckstv": { en: "Train's Army", tr: "Train\u2019s Army" },
    "badge.subscriber": { en: "Subscriber", tr: "Abone" },
    "badge.subscriber_months": { en: "Subscriber, {n} months", tr: "Abone \u2014 {n} ay" },
    "panel.control_panel": { en: "CONTROL PANEL", tr: "KONTROL PANEL\u0130" },
    "panel.sections": { en: "KickFlow sections", tr: "KickFlow b\xF6l\xFCmleri" },
    "panel.close_aria": { en: "Close KickFlow panel", tr: "KickFlow panelini kapat" },
    "tab.general": { en: "General", tr: "Genel" },
    "tab.removed": { en: "Removed", tr: "Kald\u0131r\u0131lanlar" },
    "tab.chat": { en: "Chat", tr: "Sohbet" },
    "tab.player": { en: "Player", tr: "Oynat\u0131c\u0131" },
    "tab.rewards": { en: "Rewards", tr: "\xD6d\xFCller" },
    "tab.search": { en: "Search", tr: "Arama" },
    "tab.shortcuts": { en: "Shortcuts", tr: "K\u0131sayollar" },
    "tab.about": { en: "About", tr: "Hakk\u0131nda" },
    "search.placeholder": { en: "Search chat messages\u2026", tr: "Sohbet mesajlar\u0131nda ara\u2026" },
    "search.hint": {
      en: 'Searches every message seen on this channel since the page was opened. Use words, "phrases", from:name, or -excluded terms.',
      tr: 'Sayfa a\xE7\u0131ld\u0131\u011F\u0131ndan beri bu kanalda g\xF6r\xFClen t\xFCm mesajlarda arar. Kelimeler, "ifadeler", from:ad veya -hari\xE7 terimler kullan.'
    },
    "search.unavailable": {
      en: "No chat archive on this page \u2014 open a channel or a VOD.",
      tr: "Bu sayfada sohbet ar\u015Fivi yok \u2014 bir kanal veya VOD a\xE7."
    },
    "search.empty": { en: "No message matches.", tr: "E\u015Fle\u015Fen mesaj yok." },
    "search.widened": {
      en: "No exact match. Showing loose sender-name matches.",
      tr: "Tam e\u015Fle\u015Fme yok. Gev\u015Fek g\xF6nderen ad\u0131 e\u015Fle\u015Fmeleri g\xF6steriliyor."
    },
    "search.count": {
      en: { one: "{n} match", other: "{n} matches" },
      tr: { one: "{n} sonu\xE7", other: "{n} sonu\xE7" }
    },
    "search.count_capped": {
      en: { one: "{n} match, newest {shown} shown", other: "{n} matches, newest {shown} shown" },
      tr: { one: "{n} sonu\xE7, en yenisi {shown} tanesi g\xF6steriliyor", other: "{n} sonu\xE7, en yeni {shown} tanesi g\xF6steriliyor" }
    },
    "search.truncated": {
      en: "Older messages have already been dropped from the archive.",
      tr: "Daha eski mesajlar ar\u015Fivden d\xFC\u015Fm\xFC\u015Ft\xFC."
    },
    "search.hotkey_hint": { en: "Ctrl+F opens this tab.", tr: "Ctrl+F bu sekmeyi a\xE7ar." },
    "panel.removed_count": { en: "Removed, {n} messages", tr: "Kald\u0131r\u0131lanlar, {n} mesaj" },
    "panel.removed_empty": { en: "No removed messages yet", tr: "Hen\xFCz kald\u0131r\u0131lan mesaj yok" },
    "panel.removed_no_session": { en: "No channel session is active.", tr: "Etkin bir kanal oturumu yok." },
    "panel.general_intro": { en: "Monitor this session and choose the primary chat view.", tr: "Oturum durumunu izle ve temel sohbet g\xF6r\xFCn\xFCm\xFCn\xFC se\xE7." },
    "panel.live_status": { en: "Live status", tr: "Canl\u0131 durum" },
    "stat.connection": { en: "Connection", tr: "Ba\u011Flant\u0131" },
    "stat.channel": { en: "Channel", tr: "Kanal" },
    "stat.chatroom_id": { en: "Chatroom ID", tr: "Sohbet odas\u0131 no" },
    "stat.pusher": { en: "Pusher", tr: "Canl\u0131 ba\u011Flant\u0131" },
    "stat.messages": { en: "Messages", tr: "Mesaj" },
    "stat.preserved": { en: "Preserved", tr: "Korunan" },
    "stat.bans": { en: "Bans", tr: "Ban" },
    "stat.deletions": { en: "Deletions", tr: "Silme" },
    "stat.ghost_inline": { en: "Ghost inline", tr: "Silinen, yerinde" },
    "stat.ghost_pending": { en: "Ghost pending", tr: "Silinen, yer bekliyor" },
    "stat.ghost_evicted": { en: "Ghost evicted", tr: "Silinen, d\xFC\u015F\xFCr\xFCld\xFC" },
    "stat.last_ban": { en: "Last ban", tr: "Son ban" },
    "panel.chat_view": { en: "Chat view", tr: "Sohbet g\xF6r\xFCn\xFCm\xFC" },
    "panel.chat_mode": { en: "Chat mode", tr: "Sohbet modu" },
    "panel.chat_mode_desc": { en: "Use Kick's native chat or the KickFlow list.", tr: "Kick\u2019in yerel sohbetini veya KickFlow listesini kullan." },
    "panel.language": { en: "Language", tr: "Dil" },
    "panel.language_desc": { en: "Choose the language used by KickFlow.", tr: "KickFlow aray\xFCz dilini se\xE7." },
    "panel.removed_intro": { en: "Review messages banned, timed out, or deleted in this channel.", tr: "Bu kanalda banlanan, zaman a\u015F\u0131m\u0131na u\u011Frayan ve silinen mesajlar\u0131 incele." },
    "panel.removed_aria": { en: "Removed messages", tr: "Kald\u0131r\u0131lan mesajlar" },
    "panel.filtered_user": { en: "Filtered: {name}", tr: "Filtre: {name}" },
    "panel.clear_user_filter": { en: "Clear filter for {name}", tr: "{name} filtresini temizle" },
    "panel.chat_intro": { en: "Choose which KickFlow enhancements appear in the chat feed.", tr: "Sohbet ak\u0131\u015F\u0131nda hangi KickFlow iyile\u015Ftirmelerinin g\xF6r\xFCnece\u011Fini se\xE7." },
    "setting.show_deleted": { en: "Show deleted messages", tr: "Silinenleri g\xF6ster" },
    "setting.show_deleted_desc": { en: "Keeps moderator-deleted messages visible.", tr: "Moderat\xF6rlerin sildi\u011Fi mesajlar\u0131 g\xF6r\xFCn\xFCr tutar." },
    "setting.inline_bans": { en: "Inline bans", tr: "Ban sat\u0131r-i\xE7i" },
    "setting.inline_bans_desc": { en: "Preserves banned users\u2019 recent messages in the feed.", tr: "Banlanan kullan\u0131c\u0131lar\u0131n son mesajlar\u0131n\u0131 ak\u0131\u015Fta korur." },
    "setting.subscriptions": { en: "Subscriptions", tr: "Abonelikler" },
    "setting.subscriptions_desc": { en: "Shows new subscription events.", tr: "Yeni abonelik etkinliklerini g\xF6sterir." },
    "setting.gifted_subscriptions": { en: "Gifted subscriptions", tr: "Hediye abonelikler" },
    "setting.gifted_subscriptions_desc": { en: "Shows gifted-subscription events.", tr: "Hediye abonelik etkinliklerini g\xF6sterir." },
    "setting.kicks": { en: "Kicks / donations", tr: "Kicks / ba\u011F\u0131\u015Flar" },
    "setting.kicks_desc": { en: "Adds paid Kicks donation events to the chat feed.", tr: "\xDCcretli Kicks ba\u011F\u0131\u015F etkinliklerini sohbet ak\u0131\u015F\u0131na ekler." },
    "setting.host_raid": { en: "Host / Raid", tr: "Host / Raid" },
    "setting.host_raid_desc": { en: "Adds host and raid events to the chat feed.", tr: "Host ve raid etkinliklerini sohbet ak\u0131\u015F\u0131na ekler." },
    "setting.mode_changes": { en: "Mode changes", tr: "Mod de\u011Fi\u015Fiklikleri" },
    "setting.mode_changes_desc": { en: "Reports chat setting changes such as slow mode.", tr: "Yava\u015F mod gibi sohbet ayar\u0131 de\u011Fi\u015Fikliklerini bildirir." },
    "setting.chatters_badges": { en: "Active chatter badges", tr: "Aktif sohbet\xE7i rozetleri" },
    "setting.chatters_badges_desc": { en: "Shows session removed-message evidence beside native chatter rows.", tr: "Yerel sohbet\xE7i sat\u0131rlar\u0131nda oturumdaki kald\u0131r\u0131lan mesaj kan\u0131tlar\u0131n\u0131 g\xF6sterir." },
    "setting.search_hotkey": { en: "Ctrl+F opens chat search", tr: "Ctrl+F sohbet aramas\u0131n\u0131 a\xE7ar" },
    "setting.search_hotkey_desc": {
      en: "Off returns Ctrl+F to the browser\u2019s page find. The Search tab stays available either way.",
      tr: "Kapal\u0131yken Ctrl+F taray\u0131c\u0131n\u0131n sayfa aramas\u0131na d\xF6ner. Arama sekmesi her durumda a\xE7\u0131k kal\u0131r."
    },
    "setting.user_messages": { en: "Messages this session", tr: "Bu oturumdaki mesajlar" },
    "setting.user_messages_desc": { en: "Shows this user\u2019s messages retained during the current session.", tr: "Bu kullan\u0131c\u0131n\u0131n mevcut oturumda tutulan mesajlar\u0131n\u0131 g\xF6sterir." },
    "setting.hide_quick_emotes": { en: "Hide quick emote bar", tr: "H\u0131zl\u0131 emoji \xE7ubu\u011Funu gizle" },
    "setting.hide_quick_emotes_desc": { en: "Hides Kick\u2019s emote shortcuts above chat input. The emote picker still works.", tr: "Sohbet giri\u015Finin \xFCst\xFCndeki Kick emoji k\u0131sayollar\u0131n\u0131 gizler. Emoji se\xE7ici \xE7al\u0131\u015Fmaya devam eder." },
    "setting.mod_actions": { en: "Moderator action notices", tr: "Moderat\xF6r i\u015Flem bildirimleri" },
    "setting.mod_actions_desc": { en: "Shows docked notices when messages are banned, timed out, or deleted.", tr: "Mesajlar banland\u0131\u011F\u0131nda, zaman a\u015F\u0131m\u0131na u\u011Frad\u0131\u011F\u0131nda veya silindi\u011Finde sabit bildirimler g\xF6sterir." },
    "setting.mention_highlight": { en: "Highlight replies to me / mentions of me", tr: "Bana yan\u0131t verildi\u011Finde / benden bahsedildi\u011Finde vurgula" },
    "setting.mention_highlight_desc": { en: "Frames or fills chat rows that @mention you or reply to your messages.", tr: "Seni @bahseden veya mesaj\u0131na yan\u0131t veren sat\u0131rlar\u0131 \xE7er\xE7eveler ya da doldurur." },
    "setting.mention_style": { en: "Highlight style", tr: "Vurgu stili" },
    "setting.mention_style_desc": { en: "Outline, fill, or both.", tr: "\xC7er\xE7eve, dolgu veya her ikisi." },
    "setting.mention_style_frame": { en: "Frame", tr: "\xC7er\xE7eve" },
    "setting.mention_style_fill": { en: "Fill", tr: "Dolgu" },
    "setting.mention_style_both": { en: "Both", tr: "Her ikisi" },
    "setting.mention_color": { en: "Highlight color", tr: "Vurgu rengi" },
    "setting.mention_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.mention_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "setting.manual_username": { en: "Your Kick username", tr: "Kick kullan\u0131c\u0131 ad\u0131n" },
    "setting.manual_username_desc": { en: "Fallback if auto-detection fails.", tr: "Otomatik alg\u0131lama ba\u015Far\u0131s\u0131z olursa yedek." },
    "setting.manual_username_placeholder": { en: "e.g. your_kick_name", tr: "\xF6r. kick_kullanici_adin" },
    "setting.identity_unresolved": { en: "Kick identity was not detected \u2014 you can type your username above.", tr: "Kick kimli\u011Fin alg\u0131lanamad\u0131 \u2014 yukar\u0131ya kullan\u0131c\u0131 ad\u0131n\u0131 yazabilirsin." },
    "setting.role_style": { en: "Moderator / VIP style", tr: "Moderat\xF6r / VIP stili" },
    "setting.role_style_desc": { en: "Keep the left bar only, or add a faint row fill.", tr: "Yaln\u0131zca sol \xE7ubu\u011Fu kullan veya hafif bir sat\u0131r dolgusu ekle." },
    "setting.role_style_frame": { en: "Bar only", tr: "Yaln\u0131z \xE7ubuk" },
    "setting.role_style_both": { en: "Bar + fill", tr: "\xC7ubuk + dolgu" },
    "setting.role_colors": { en: "Role colors", tr: "Rol renkleri" },
    "setting.role_colors_desc": { en: "Customize moderator and VIP colors.", tr: "Moderat\xF6r ve VIP renklerini \xF6zelle\u015Ftir." },
    "setting.mod_frame": { en: "Highlight moderator messages", tr: "Moderat\xF6r mesajlar\u0131n\u0131 vurgula" },
    "setting.mod_frame_desc": { en: "Uses the shared role style and moderator color.", tr: "Ortak rol stilini ve moderat\xF6r rengini kullan\u0131r." },
    "setting.mod_frame_color": { en: "Moderator color", tr: "Moderat\xF6r rengi" },
    "setting.mod_frame_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.mod_frame_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "setting.vip_frame": { en: "Highlight VIP messages", tr: "VIP mesajlar\u0131n\u0131 vurgula" },
    "setting.vip_frame_desc": { en: "Uses the shared role style and VIP color.", tr: "Ortak rol stilini ve VIP rengini kullan\u0131r." },
    "setting.vip_frame_color": { en: "VIP color", tr: "VIP rengi" },
    "setting.vip_frame_color_desc": { en: "Pick a swatch or a custom color (green band is reserved).", tr: "Haz\u0131r renklerden se\xE7 veya \xF6zel bir renk kullan (ye\u015Fil bant ayr\u0131lm\u0131\u015Ft\u0131r)." },
    "setting.vip_frame_color_warn": { en: "That green is reserved for reply-jump \u2014 a nearby hue was applied instead.", tr: "O ye\u015Fil yan\u0131t-atlama i\xE7in ayr\u0131lm\u0131\u015F \u2014 yak\u0131n bir ton uyguland\u0131." },
    "chatters.removed_count": {
      en: { one: "{n} removed", other: "{n} removed" },
      tr: { one: "{n} kald\u0131r\u0131ld\u0131", other: "{n} kald\u0131r\u0131ld\u0131" }
    },
    "chatters.open_removed": { en: "Review {n} removed messages from {name}", tr: "{name} i\xE7in kald\u0131r\u0131lan {n} mesaj\u0131 incele" },
    "panel.player_intro": { en: "Manage playback and tools added to the native control bar.", tr: "Yay\u0131n oynat\u0131m\u0131n\u0131 ve yerel kontrol \xE7ubu\u011Funa eklenen ara\xE7lar\u0131 y\xF6net." },
    "panel.rewards_intro": {
      en: "Manage Kick Drops and daily rewards from this tab. Drops use Kick's own button; daily rewards briefly open and close Kick's reward window. Neither feature touches channel points.",
      tr: "Kick Drops ve g\xFCnl\xFCk \xF6d\xFCllerini bu sekmeden y\xF6net. Drops, Kick\u2019in kendi d\xFC\u011Fmesiyle al\u0131n\u0131r; g\xFCnl\xFCk \xF6d\xFCl i\xE7in Kick\u2019in \xF6d\xFCl penceresi k\u0131sa s\xFCre a\xE7\u0131l\u0131p kapan\u0131r. \u0130ki \xF6zellik de kanal puanlar\u0131na dokunmaz."
    },
    "setting.auto_theater": { en: "Automatic theater mode", tr: "Otomatik tiyatro modu" },
    "setting.auto_theater_desc": { en: "Switches to the wide player layout when a channel opens.", tr: "Kanal a\xE7\u0131ld\u0131\u011F\u0131nda geni\u015F oynat\u0131c\u0131 d\xFCzenine ge\xE7er." },
    "setting.caption_guard": { en: "Keep captions off by default", tr: "Altyaz\u0131y\u0131 varsay\u0131lan olarak kapal\u0131 tut" },
    "setting.caption_guard_desc": { en: "Prevents Kick from silently restoring captions after a reload. You can still turn them on manually for the current session.", tr: "Kick\u2019in altyaz\u0131y\u0131 yenilemeden sonra sessizce geri a\xE7mas\u0131n\u0131 \xF6nler. Ge\xE7erli oturumda yine elle a\xE7abilirsin." },
    "setting.seek": { en: "Seek back / forward", tr: "Geri / ileri sarma" },
    "setting.seek_desc": { en: "Adds 10-second seek buttons to the control bar.", tr: "Kontrol \xE7ubu\u011Funa 10 saniyelik sarma d\xFC\u011Fmeleri ekler." },
    "setting.seek_bar": { en: "Seek bar", tr: "Sarma \xE7ubu\u011Fu" },
    "setting.seek_bar_desc": { en: "Draws the green position bar whenever Kick leaves it out, which it often does on a live stream.", tr: "Kick canl\u0131 yay\u0131nda s\u0131k s\u0131k \xE7izmedi\u011Fi ye\u015Fil konum \xE7ubu\u011Funu, \xE7izmedi\u011Fi zaman bizim \xE7izmemizi sa\u011Flar." },
    "setting.live_catchup": { en: "Live catch-up", tr: "Canl\u0131ya yeti\u015Fme" },
    "setting.live_catchup_desc": { en: "Carefully accelerates playback when the stream falls behind.", tr: "Geride kal\u0131nca yay\u0131n\u0131 kontroll\xFC bi\xE7imde h\u0131zland\u0131r\u0131r." },
    "setting.quality_lock": { en: "Quality button", tr: "Kalite d\xFC\u011Fmesi" },
    "setting.quality_always_best": { en: "Open every stream at the highest quality", tr: "Her yay\u0131n\u0131 en y\xFCksek kalitede a\xE7" },
    "setting.quality_always_best_desc": { en: "A quality you pick by hand holds for that stream only; the next stream opens at the highest again. Off: your last pick is remembered.", tr: "Elle se\xE7ti\u011Fin kalite yaln\u0131z o yay\u0131nda kal\u0131r; sonraki yay\u0131n yine en y\xFCksekte a\xE7\u0131l\u0131r. Kapal\u0131yken son se\xE7imin hat\u0131rlan\u0131r." },
    "setting.quality_lock_desc": { en: "Shows the quality button on the player bar and keeps the quality you pick there.", tr: "Oynat\u0131c\u0131 bar\u0131nda kalite d\xFC\u011Fmesini g\xF6sterir ve orada se\xE7ti\u011Fin kaliteyi korur." },
    "setting.screenshot": { en: "Screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC" },
    "setting.screenshot_desc": { en: "Adds a frame-capture button to the control bar.", tr: "Kontrol \xE7ubu\u011Funa kare yakalama d\xFC\u011Fmesi ekler." },
    "setting.speed": { en: "Speed controls", tr: "H\u0131z kontrolleri" },
    "setting.speed_desc": { en: "Shows manual and automatic playback-speed tools.", tr: "Manuel ve otomatik oynatma h\u0131z\u0131 ara\xE7lar\u0131n\u0131 g\xF6sterir." },
    "setting.fullscreen_terminal": { en: "Fullscreen terminal slot", tr: "Tam ekran\u0131 sona al" },
    "setting.fullscreen_terminal_desc": { en: "Moves Kick's fullscreen button after the settings control with CSS order; the DOM stays unchanged.", tr: "Kick\u2019in tam ekran d\xFC\u011Fmesini CSS order ile ayarlar kontrol\xFCn\xFCn arkas\u0131na al\u0131r; DOM de\u011Fi\u015Fmez." },
    "setting.auto_claim_drops": { en: "Auto-claim Drops", tr: "Drops \xF6d\xFCllerini otomatik al" },
    "setting.auto_claim_drops_desc": {
      en: "On the channel you watch, automatically claims Kick Drops rewards when a reward reaches 100% by clicking Kick's own Claim button. Only while this Kick tab is open: it never calls a Kick API or runs as a background service. Never touches channel points; spending them is your choice.",
      tr: "\u0130zledi\u011Fin kanalda bir Kick Drops \xF6d\xFCl\xFC %100\u2019e ula\u015Ft\u0131\u011F\u0131nda Kick\u2019in kendi alma d\xFC\u011Fmesine t\u0131klayarak otomatik al\u0131r. Yaln\u0131zca Kick sekmesi a\xE7\u0131kken \xE7al\u0131\u015F\u0131r; Kick\u2019e kendi ba\u015F\u0131na istek g\xF6ndermez ve arka planda \xE7al\u0131\u015Fmaz. Kanal puanlar\u0131na hi\xE7 dokunmaz; onlar\u0131 harcay\u0131p harcamamak senin karar\u0131n."
    },
    "setting.auto_claim_daily_reward": { en: "Auto-claim daily reward", tr: "G\xFCnl\xFCk \xF6d\xFCl\xFC otomatik al" },
    "setting.auto_claim_daily_reward_desc": {
      en: "Automatically claims Kick's daily reward by briefly opening and closing Kick's own reward window. It runs only while this Kick tab is open and never touches channel points.",
      tr: "Kick\u2019in g\xFCnl\xFCk \xF6d\xFCl\xFCn\xFC, kendi \xF6d\xFCl penceresini k\u0131sa s\xFCre a\xE7\u0131p kapatarak senin i\xE7in otomatik al\u0131r. Yaln\u0131zca bu Kick sekmesi a\xE7\u0131kken \xE7al\u0131\u015F\u0131r ve kanal puanlar\u0131na hi\xE7 dokunmaz."
    },
    "panel.shortcuts_intro": { en: "Run player actions with one key. Shortcuts are disabled while typing.", tr: "Oynat\u0131c\u0131 eylemlerini tek tu\u015Fla \xE7al\u0131\u015Ft\u0131r. Yaz\u0131 alan\u0131ndayken k\u0131sayollar devre d\u0131\u015F\u0131d\u0131r." },
    "panel.changes_live": { en: "Changes apply immediately.", tr: "De\u011Fi\u015Fiklikler an\u0131nda uygulan\u0131r." },
    "about.copy": { en: "A personal browser extension that streamlines Kick chat and live viewing.", tr: "Kick sohbetini ve canl\u0131 yay\u0131n deneyimini sadele\u015Ftiren ki\u015Fisel bir taray\u0131c\u0131 eklentisi." },
    "about.version": { en: "Version", tr: "S\xFCr\xFCm" },
    "about.platform": { en: "Platform", tr: "Platform" },
    "about.application": { en: "Application", tr: "Uygulama" },
    "about.application_value": { en: "Runs inside kick.com", tr: "kick.com i\xE7inde \xE7al\u0131\u015F\u0131r" },
    "hotkey.rewind": { en: "10s back", tr: "10 sn geri" },
    "hotkey.forward": { en: "10s forward", tr: "10 sn ileri" },
    "hotkey.screenshot": { en: "Screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC" },
    "hotkey.go_live": { en: "Go live", tr: "Canl\u0131ya d\xF6n" },
    "hotkey.enable_aria": { en: "Enable {name} shortcut", tr: "{name} k\u0131sayolunu etkinle\u015Ftir" },
    "hotkey.change_aria": { en: "Change {name} shortcut", tr: "{name} k\u0131sayolunu de\u011Fi\u015Ftir" },
    "hotkey.press_key": { en: "Press a key\u2026", tr: "Bir tu\u015Fa bas\u2026" },
    "hotkey.press_key_cancel": { en: "Press a key\u2026  Esc: cancel", tr: "Bir tu\u015Fa bas\u2026  Esc: iptal" },
    "hotkey.cancelled": { en: "Change cancelled.", tr: "De\u011Fi\u015Fiklik iptal edildi." },
    "hotkey.modifier_invalid": { en: "A modifier key cannot be used by itself.", tr: "Tek ba\u015F\u0131na bir de\u011Fi\u015Ftirici tu\u015F kullan\u0131lamaz." },
    "hotkey.collision": { en: "This key is already used for \u201C{name}\u201D.", tr: "Bu tu\u015F \u201C{name}\u201D i\xE7in kullan\u0131mda." },
    "hotkey.invalid": { en: "This key cannot be assigned.", tr: "Bu tu\u015F ba\u011Flanam\u0131yor." },
    "hotkey.saved": { en: "Shortcut saved.", tr: "K\u0131sayol kaydedildi." },
    "hotkey.saved_native_conflict": { en: "Saved: may conflict with a native Kick shortcut.", tr: "Kaydedildi: Kick\u2019in kendi k\u0131sayoluyla \xE7ak\u0131\u015Fabilir." },
    "hotkey.reset": { en: "Shortcuts reset.", tr: "K\u0131sayollar s\u0131f\u0131rland\u0131." },
    "player.live": { en: "LIVE", tr: "CANLI" },
    "player.go_live": { en: "Go live", tr: "Canl\u0131 yay\u0131na d\xF6n" },
    "player.go_live_behind": { en: "Go live, {n} seconds behind", tr: "Canl\u0131 yay\u0131na d\xF6n, {n} saniye geridesin" },
    "player.behind_seconds": { en: "\u2212{n} s", tr: "\u2212{n} sn" },
    "player.behind_minutes": { en: "\u2212{n} min", tr: "\u2212{n} dk" },
    "player.seek_back_title": { en: "{n}s back", tr: "{n} sn geri" },
    "player.seek_forward_title": { en: "{n}s forward", tr: "{n} sn ileri" },
    "player.seek_back_aria": { en: "Seek back {n} seconds", tr: "{n} saniye geri sar" },
    "player.seek_forward_aria": { en: "Seek forward {n} seconds", tr: "{n} saniye ileri sar" },
    "player.screenshot": { en: "Take screenshot", tr: "Ekran g\xF6r\xFCnt\xFCs\xFC al" },
    "player.buffer_warning": { en: "Buffer under pressure; speed reduced to 1.5x", tr: "Buffer zorland\u0131; h\u0131z 1.5x oldu" },
    "player.manual_speed": { en: "Manual speed: {rate}", tr: "Manuel h\u0131z: {rate}" },
    "player.auto": { en: "AUTO", tr: "OTO" },
    "player.select_speed": { en: "Select playback speed", tr: "Oynatma h\u0131z\u0131n\u0131 se\xE7" },
    "player.more_controls": { en: "More controls", tr: "Di\u011Fer kontroller" },
    "player.quality": { en: "Quality", tr: "Kalite" },
    "player.quality_best": { en: "Best picture", tr: "En iyi g\xF6r\xFCnt\xFC" },
    "player.quality_best_hint": { en: "Always the highest", tr: "Hep en y\xFCksek" },
    "player.quality_best_hint_now": { en: "Always the highest, now {label}", tr: "Hep en y\xFCksek, \u015Fu an {label}" },
    "player.quality_auto": { en: "Match my connection", tr: "Ba\u011Flant\u0131ya g\xF6re" },
    "player.quality_auto_hint": { en: "Steps down by itself when the connection slows", tr: "\u0130nternet yava\u015Flarsa kendisi d\xFC\u015F\xFCr\xFCr" },
    "player.quality_saver": { en: "Data saver", tr: "Veri tasarrufu" },
    "player.quality_saver_hint": { en: "At most 480p, for mobile data", tr: "En \xE7ok 480p, telefon interneti i\xE7in" },
    "player.quality_more": { en: "Other resolutions", tr: "Di\u011Fer \xE7\xF6z\xFCn\xFCrl\xFCkler" },
    "player.quality_sub_best": { en: "BEST", tr: "EN \u0130Y\u0130" },
    "player.quality_sub_stream": { en: "THIS STREAM", tr: "BU YAYIN" },
    "player.quality_sub_saver": { en: "SAVER", tr: "TASARRUF" },
    "entry.footer_title": { en: "KickFlow removed messages", tr: "KickFlow kald\u0131r\u0131lan mesajlar" },
    "entry.footer_aria": { en: "Open KickFlow removed messages", tr: "KickFlow kald\u0131r\u0131lan mesajlar\u0131 a\xE7" },
    "entry.settings_title": { en: "KickFlow settings", tr: "KickFlow ayarlar\u0131" },
    "entry.settings_aria": { en: "Open KickFlow settings", tr: "KickFlow ayarlar\u0131n\u0131 a\xE7" },
    "overlay.connected": { en: "Connected, waiting for messages\u2026", tr: "Ba\u011Fland\u0131 \u2014 mesajlar bekleniyor\u2026" },
    "overlay.reconnecting": { en: "Reconnecting\u2026", tr: "Yeniden ba\u011Flan\u0131yor\u2026" },
    "overlay.replay_loading": { en: "Loading replay chat\u2026", tr: "Yay\u0131n sohbeti y\xFCkleniyor\u2026" },
    "overlay.replay_ready": { en: "Replay chat ready \u2014 waiting for messages\u2026", tr: "Yay\u0131n sohbeti haz\u0131r \u2014 mesajlar bekleniyor\u2026" },
    "chat.new_messages": { en: "\u2193 New messages", tr: "\u2193 Yeni mesajlar" },
    "chat.pause_count": {
      en: { one: "{count} new message", other: "{count} new messages" },
      tr: { one: "{count} yeni mesaj", other: "{count} yeni mesaj" }
    },
    "chat.new_messages_count": {
      en: { one: "\u2193 {count} new message", other: "\u2193 {count} new messages" },
      tr: { one: "\u2193 {count} yeni mesaj", other: "\u2193 {count} yeni mesaj" }
    },
    "status.starting": { en: "starting", tr: "ba\u015Fl\u0131yor" },
    "status.resolving_channel": { en: "resolving channel\u2026", tr: "kanal bulunuyor\u2026" },
    "status.not_channel": { en: "not a channel page", tr: "Bu sayfa bir kanal de\u011Fil. Bir Kick yay\u0131n\u0131 a\xE7." },
    "status.chatroom_unresolved": { en: "could not resolve chatroom id", tr: "sohbet odas\u0131 bulunamad\u0131" },
    "status.pusher_connecting": { en: "Pusher connecting\u2026", tr: "canl\u0131 sohbete ba\u011Flan\u0131yor\u2026" },
    "status.socket_waiting": { en: "Pusher socket connected, waiting for chatroom subscription\u2026", tr: "ba\u011Fland\u0131, sohbet odas\u0131 bekleniyor\u2026" },
    "status.active_native": { en: "active, marking native chat", tr: "\xE7al\u0131\u015F\u0131yor, Kick\u2019in sohbeti kullan\u0131l\u0131yor" },
    "status.active_native_replay": { en: "active \u2014 native replay chat", tr: "\xE7al\u0131\u015F\u0131yor, Kick\u2019in tekrar sohbeti kullan\u0131l\u0131yor" },
    "status.subscription_waiting_native": { en: "waiting for chatroom subscription, native chat", tr: "sohbet odas\u0131 bekleniyor; \u015Fimdilik Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.active_own": { en: "active, rendering KickFlow list", tr: "\xE7al\u0131\u015F\u0131yor, KickFlow sohbet listesi g\xF6steriliyor" },
    "status.vod_replay_loading": { en: "loading replay chat\u2026", tr: "yay\u0131n sohbeti y\xFCkleniyor\u2026" },
    "status.active_vod_replay": { en: "active \u2014 replay chat synchronized", tr: "\xE7al\u0131\u015F\u0131yor, tekrar sohbeti videoyla e\u015F zamanl\u0131" },
    "status.vod_replay_failed_native": { en: "replay unavailable \u2014 native replay chat", tr: "tekrar sohbeti al\u0131namad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.content_not_ready": { en: "content not ready, retrying in background with native chat", tr: "sohbet hen\xFCz haz\u0131r de\u011Fil; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor, arka planda yeniden deneniyor" },
    "status.chatroom_unresolved_native": { en: "could not resolve chatroom id, native chat", tr: "sohbet odas\u0131 bulunamad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor. Sayfay\u0131 yenile." },
    "status.history_empty": { en: "history empty, waiting for live chatroom subscription\u2026", tr: "ge\xE7mi\u015F bo\u015F, canl\u0131 sohbet bekleniyor\u2026" },
    "status.history_failed": { en: "could not load history, waiting for live chatroom subscription\u2026", tr: "ge\xE7mi\u015F al\u0131namad\u0131, canl\u0131 sohbet bekleniyor\u2026" },
    "status.active_ready": { en: "active, chatroom subscription ready", tr: "\xE7al\u0131\u015F\u0131yor, sohbet odas\u0131 haz\u0131r" },
    "status.chatroom_ready_waiting": { en: "chatroom ready, waiting for visible chat area", tr: "sohbet odas\u0131 haz\u0131r, sohbet alan\u0131 bekleniyor" },
    "status.primary_unavailable": { en: "chatroom connection not ready ({reason}), native chat", tr: "canl\u0131 sohbet haz\u0131r de\u011Fil ({reason}); Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor" },
    "status.reconnecting": { en: "reconnecting\u2026", tr: "yeniden ba\u011Flan\u0131yor\u2026" },
    "status.reconnect_failed": { en: "could not reconnect to chatroom, native chat", tr: "sohbet odas\u0131na yeniden ba\u011Flan\u0131lamad\u0131; Kick\u2019in sohbeti g\xF6r\xFCn\xFCyor. Sayfay\u0131 yenile." },
    "status.waiting_chat_panel": { en: "waiting for chat panel\u2026", tr: "sohbet paneli bekleniyor\u2026" },
    "popup.tagline": { en: "A streamlined Kick experience.", tr: "Kick deneyimi, sadele\u015Ftirilmi\u015F." },
    "popup.connection_status": { en: "Connection status", tr: "Ba\u011Flant\u0131 durumu" },
    "popup.reading_status": { en: "Reading status\u2026", tr: "Durum okunuyor\u2026" },
    "popup.mode_desc": { en: "Kick or KickFlow list", tr: "Kick veya KickFlow listesi" },
    "popup.hover_follow": { en: "Scrolling under the pointer", tr: "\u0130mle\xE7 alt\u0131ndaki kayd\u0131rma" },
    "popup.hover_follow_desc": { en: "KickFlow list: how new messages move in while you point at chat", tr: "KickFlow listesi: imle\xE7 sohbetteyken yeni mesajlar nas\u0131l gelir" },
    "popup.status_stats": { en: "Status / Statistics", tr: "Durum / \u0130statistik" },
    "popup.debug_log": { en: "Debug log (F12)", tr: "Hata ay\u0131klama kayd\u0131 (F12)" },
    "popup.changes_hint": { en: "Changes apply immediately and persist after reload.", tr: "De\u011Fi\u015Fiklik an\u0131nda uygulan\u0131r; kanal yeniden y\xFCklenince de korunur." },
    // Texts that popup.html carried only in English (2026-11-16): en is the old HTML text, byte for byte.
    "popup.hover_smooth": { en: "Smooth", tr: "Yumu\u015Fak" },
    "popup.hover_instant": { en: "Instant", tr: "An\u0131nda" },
    "popup.mode_option_native": { en: "Native", tr: "Kick\u2019in sohbeti" },
    "popup.active_mode_own": { en: "own chat", tr: "KickFlow sohbet listesi" },
    "popup.active_mode_native": { en: "native chat", tr: "Kick\u2019in sohbeti" },
    "popup.not_connected": { en: "not connected", tr: "Kick sekmesine ba\u011Flan\u0131lamad\u0131. Sayfay\u0131 yenile." },
    "popup.active": { en: "KickFlow active \xB7 {mode}", tr: "KickFlow aktif \xB7 {mode}" },
    "popup.pusher_connected": { en: "connected", tr: "ba\u011Fl\u0131" },
    "popup.pusher_disconnected": { en: "disconnected", tr: "ba\u011Fl\u0131 de\u011Fil" },
    "popup.no_active_tab": { en: "no active tab", tr: "A\xE7\u0131k bir sekme yok. Bir Kick yay\u0131n\u0131 a\xE7." },
    "popup.not_kick_tab": { en: "not a Kick tab / content script unavailable", tr: "Bu sekmede KickFlow \xE7al\u0131\u015Fm\u0131yor. Bir Kick yay\u0131n\u0131 a\xE7 ya da sayfay\u0131 yenile." },
    "popup.open_kick": { en: "Open kick.com in the active tab", tr: "Bu sekme Kick de\u011Fil. Bir Kick yay\u0131n\u0131 a\xE7." },
    "popup.summary": { en: "This session", tr: "Bu oturum" },
    "popup.sum_messages": { en: "Messages seen", tr: "G\xF6r\xFClen mesaj" },
    "popup.sum_preserved": { en: "Kept after removal", tr: "Silinse de korunan" },
    "popup.sum_bans": { en: "Kept from bans", tr: "Bandan korunan" },
    "popup.diagnostics": { en: "Diagnostics", tr: "Tan\u0131lama" },
    "popup.diagnostics_desc": { en: "Technical details for bug reports.", tr: "Hata bildirimi i\xE7in teknik ayr\u0131nt\u0131lar." },
    "popup.mode_native": { en: "Kick chat", tr: "Kick sohbeti" },
    "popup.mode_own": { en: "KickFlow list", tr: "KickFlow listesi" },
    "popup.tab_unavailable": { en: "Could not connect to the Kick tab.", tr: "Kick sekmesine ba\u011Flan\u0131lamad\u0131." },
    "popup.save_failed": { en: "Setting changed for this tab, but could not be saved.", tr: "Ayar bu sekmede de\u011Fi\u015Fti ancak kaydedilemedi." },
    "time.seconds_ago": { en: { one: "{n} second ago", other: "{n} seconds ago" }, tr: { one: "{n} sn \xF6nce", other: "{n} sn \xF6nce" } },
    "time.minutes_ago": { en: { one: "{n} minute ago", other: "{n} minutes ago" }, tr: { one: "{n} dk \xF6nce", other: "{n} dk \xF6nce" } },
    "time.hours_ago": { en: { one: "{n} hour ago", other: "{n} hours ago" }, tr: { one: "{n} sa \xF6nce", other: "{n} sa \xF6nce" } },
    "user.not_subscribed": { en: "not subscribed", tr: "abone de\u011Fil" },
    "user.unknown": { en: "unknown", tr: "bilinmiyor" },
    "user.subscribed_months": { en: { one: "{n} month", other: "{n} months" }, tr: { one: "{n} ay abone", other: "{n} ay abone" } },
    "user.not_following": { en: "not following", tr: "takip etmiyor" },
    "user.close": { en: "Close user card", tr: "Kullan\u0131c\u0131 kart\u0131n\u0131 kapat" },
    "user.open_middle": { en: "kick.com/{slug}, middle-click to open in a new tab", tr: "kick.com/{slug} \u2014 orta t\u0131kla yeni sekmede a\xE7" },
    "user.verified": { en: "verified", tr: "do\u011Frulanm\u0131\u015F" },
    "user.followers": { en: "followers", tr: "takip\xE7i" },
    "user.created": { en: "account created", tr: "hesap olu\u015Fturma" },
    "user.following": { en: "following", tr: "takip" },
    "user.subscription": { en: "subscription", tr: "abonelik" },
    "user.messages": { en: "Messages this session", tr: "Bu oturumdaki mesajlar" },
    "user.messages_empty": { en: "No messages recorded in this session.", tr: "Bu oturumda kay\u0131tl\u0131 mesaj yok." },
    "user.messages_truncated": { en: "Older messages were not retained.", tr: "Daha eskisi tutulmad\u0131." },
    "user.messages_jump": { en: "Click to jump to this message", tr: "Mesaja gitmek i\xE7in t\u0131kla" },
    "user.open": { en: "open", tr: "a\xE7" },
    "user.follow_on_kick": { en: "Follow on Kick", tr: "Kick'te takip et" },
    "user.kick_controls": { en: "Kick controls", tr: "Kick i\u015Flemleri" },
    // 2026-11-24: ultrawide fill (U key) toast.
    "player.aspect_contain": { en: "Picture: as sent (bands)", tr: "G\xF6r\xFCnt\xFC: oldu\u011Fu gibi (bantl\u0131)" },
    "player.aspect_cover": { en: "Picture: fill by cropping", tr: "G\xF6r\xFCnt\xFC: k\u0131rparak doldur" },
    "player.aspect_stretch": { en: "Picture: slight stretch", tr: "G\xF6r\xFCnt\xFC: hafif germe" },
    // 0.4.3 (2026-11-24, code review B13): the loudness leveller says when it cannot work.
    "player.leveller_silent": { en: "Loudness leveller hears no sound. Reload the page to get it back.", tr: "Ses dengeleyici ses alam\u0131yor. Sesi geri almak i\xE7in sayfay\u0131 yenile." },
    "player.leveller_unsupported": { en: "Loudness leveller cannot work on this player; the sound is left as it is.", tr: "Ses dengeleyici bu oynat\u0131c\u0131da \xE7al\u0131\u015Fam\u0131yor; ses oldu\u011Fu gibi b\u0131rak\u0131ld\u0131." }
  };
  var MINUTES_PER_HOUR = 60;
  var HOURS_PER_DAY = 24;
  var MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
  function interpolateTemplate(template, params) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
  }
  var lang = "en";
  var listeners = /* @__PURE__ */ new Set();
  function setLang(next) {
    if (typeof document !== "undefined") document.documentElement.lang = next;
    if (next === lang) return;
    lang = next;
    void safeStorageSet({ [STORAGE_KEY]: next });
    for (const listener of listeners) listener(next);
  }
  async function loadLang() {
    const stored = await safeStorageGet(STORAGE_KEY);
    const next = stored[STORAGE_KEY];
    if (next === "en" || next === "tr") setLang(next);
    return lang;
  }
  function selectTemplate(template, params) {
    if (typeof template === "string") return template;
    const count = Number(params.n);
    return count === 1 ? template.one : template.other;
  }
  function t(key, params = {}) {
    const template = selectTemplate(messages[key][lang], params);
    return interpolateTemplate(template, params);
  }
  var statusPatterns = null;
  function localizeStatusLine(text) {
    statusPatterns ??= Object.keys(messages).filter((key) => key.startsWith("status.")).flatMap((key) => ["en", "tr"].map((language) => {
      const template = messages[key][language];
      const names = [];
      const source = template.split(/(\{[a-zA-Z0-9_]+\})/).map((part) => {
        const name = /^\{([a-zA-Z0-9_]+)\}$/.exec(part)?.[1];
        if (name) {
          names.push(name);
          return "(.+?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("");
      return { key, pattern: new RegExp(`^${source}$`), names };
    }));
    for (const { key, pattern, names } of statusPatterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      return t(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
    }
    return text;
  }
  function hotkeyLabel(action) {
    const keys = {
      rewind: "hotkey.rewind",
      forward: "hotkey.forward",
      screenshot: "hotkey.screenshot",
      goLive: "hotkey.go_live"
    };
    return t(keys[action]);
  }

  // src/content/player/hotkey-registry.ts
  var HOTKEY_ACTIONS = ["rewind", "forward", "screenshot", "goLive"];
  var HOTKEY_DEFINITIONS = [
    { action: "rewind", label: "10s back", defaultKey: "ArrowLeft" },
    { action: "forward", label: "10s forward", defaultKey: "ArrowRight" },
    { action: "screenshot", label: "Screenshot", defaultKey: "s" },
    { action: "goLive", label: "Go live", defaultKey: "l" }
  ];
  var MODIFIER_KEYS = /* @__PURE__ */ new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "CapsLock", "NumLock", "ScrollLock"]);
  var bindings = createDefaultHotkeyBindings();
  function createDefaultHotkeyBindings() {
    return Object.fromEntries(
      HOTKEY_DEFINITIONS.map(({ action, defaultKey }) => [action, { enabled: true, key: defaultKey }])
    );
  }
  function normalizeHotkeyKey(key) {
    if (!key || MODIFIER_KEYS.has(key)) return null;
    if (key === "Spacebar" || key === "Space") return " ";
    if (key.length === 1) return key.toLowerCase();
    return key;
  }
  function formatHotkeyKey(key) {
    if (key === "ArrowLeft") return "\u2190";
    if (key === "ArrowRight") return "\u2192";
    if (key === "ArrowUp") return "\u2191";
    if (key === "ArrowDown") return "\u2193";
    if (key === " ") return t("common.space");
    if (key === "Escape") return "Esc";
    return key.length === 1 ? key.toUpperCase() : key;
  }

  // src/popup/popup.ts
  var $ = (id) => document.getElementById(id);
  var capturingAction = null;
  var lastHotkeys = null;
  var flagChangeRevision = 0;
  var refreshRevision = 0;
  var NOTICE_MS = 5e3;
  var reasonNotice = null;
  function showReasonNotice(text) {
    reasonNotice = { text, until: Date.now() + NOTICE_MS };
    $("reason").textContent = text;
  }
  function activeReasonNotice() {
    if (reasonNotice && Date.now() < reasonNotice.until) return reasonNotice.text;
    reasonNotice = null;
    return null;
  }
  function applyStaticTranslations() {
    const setText = (selector, key) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = t(key);
    };
    setText(".tagline", "popup.tagline");
    setText("#reason", "popup.reading_status");
    $("dot").title = t("popup.connection_status");
    setText(".mode-copy strong", "panel.chat_view");
    setText(".mode-copy span", "popup.mode_desc");
    $("t-chat-mode").setAttribute("aria-label", t("panel.chat_mode"));
    setText(".hover-follow-copy strong", "popup.hover_follow");
    setText(".hover-follow-copy span", "popup.hover_follow_desc");
    $("t-hover-follow-mode").setAttribute("aria-label", t("popup.hover_follow"));
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    const summary = $("stats").closest(".summary");
    summary?.setAttribute("aria-label", t("popup.summary"));
    const rewardsIntro = document.getElementById("rewards-intro");
    if (rewardsIntro) rewardsIntro.textContent = t("panel.rewards_intro");
    const statKeys = [
      ["slug", "stat.channel"],
      ["chatroomId", "stat.chatroom_id"],
      ["pusher", "stat.pusher"],
      ["messages", "popup.sum_messages"],
      ["preserved", "popup.sum_preserved"],
      ["banned", "popup.sum_bans"],
      ["deleted", "stat.deletions"],
      ["ghostAnchored", "stat.ghost_inline"],
      ["ghostPending", "stat.ghost_pending"],
      ["ghostEvicted", "stat.ghost_evicted"],
      ["lastBan", "stat.last_ban"]
    ];
    for (const [id, key] of statKeys) {
      const label = $(id).parentElement?.querySelector(".k");
      if (label) label.textContent = t(key);
    }
    const settingKeys = [
      ["t-deleted", "setting.show_deleted"],
      ["t-bans-inline", "setting.inline_bans"],
      ["t-subscriptions", "setting.subscriptions"],
      ["t-gifted-subs", "setting.gifted_subscriptions"],
      ["t-kicks", "setting.kicks"],
      ["t-host-raid", "setting.host_raid"],
      ["t-mode-changes", "setting.mode_changes"],
      ["t-chatters-badges", "setting.chatters_badges"],
      ["t-hide-quick-emotes", "setting.hide_quick_emotes"],
      ["t-debug", "popup.debug_log"],
      ["t-auto-theater", "setting.auto_theater"],
      ["t-rewind-controls", "setting.seek"],
      ["t-live-catchup", "setting.live_catchup"],
      ["t-quality-lock", "setting.quality_lock"],
      ["t-quality-always-best", "setting.quality_always_best"],
      ["t-screenshot", "setting.screenshot"],
      ["t-speed-controls", "setting.speed"],
      ["t-auto-claim-drops", "setting.auto_claim_drops"],
      ["t-auto-claim-daily-reward", "setting.auto_claim_daily_reward"]
    ];
    for (const [id, key] of settingKeys) {
      const label = document.querySelector(`label[for="${id}"] > span`);
      if (label) label.textContent = t(key);
    }
    for (const action of HOTKEY_ACTIONS) {
      const label = hotkeyLabel(action);
      const row = document.querySelector(`[data-hotkey-action="${action}"]`);
      const copy = row?.querySelector("span");
      if (copy) copy.textContent = label;
      $(`hk-${action}-enabled`).setAttribute("aria-label", t("hotkey.enable_aria", { name: label }));
      $(`hk-${action}-change`).setAttribute("aria-label", t("hotkey.change_aria", { name: label }));
    }
    $("hotkey-reset").textContent = t("common.reset_defaults");
    setText(".hint", "popup.changes_hint");
  }
  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }
  function setDot(state) {
    const dot = $("dot");
    dot.className = "dot dot--" + state;
  }
  function fmtAgo(ms) {
    if (!ms) return null;
    const s = Math.max(0, Math.round((Date.now() - ms) / 1e3));
    if (s < 60) return t("time.seconds_ago", { n: s });
    const m = Math.round(s / 60);
    return m < 60 ? t("time.minutes_ago", { n: m }) : t("time.hours_ago", { n: Math.round(m / 60) });
  }
  function setStatValue(id, value) {
    const element = $(id);
    const missing = value === null || value === "";
    element.textContent = missing ? "\u2014" : String(value);
    element.classList.toggle("missing", missing);
  }
  function setHotkeyStatus(message) {
    $("hotkey-status").textContent = message;
  }
  function renderHotkeys(bindings2) {
    lastHotkeys = bindings2;
    for (const action of HOTKEY_ACTIONS) {
      const enabled = $(`hk-${action}-enabled`);
      const chip = $(`hk-${action}-key`);
      const change = $(`hk-${action}-change`);
      enabled.checked = bindings2[action].enabled;
      chip.textContent = formatHotkeyKey(bindings2[action].key);
      change.textContent = capturingAction === action ? t("hotkey.press_key") : t("common.change");
      change.classList.toggle("hotkey-change--capturing", capturingAction === action);
    }
  }
  function finishHotkeyCapture(message) {
    capturingAction = null;
    if (message !== void 0) setHotkeyStatus(message);
    if (lastHotkeys) renderHotkeys(lastHotkeys);
  }
  function render(res, error) {
    if (error || !res) {
      setDot("off");
      $("reason").textContent = error || t("popup.not_connected");
      $("stats").style.display = "none";
      $("toggles").style.display = "none";
      return;
    }
    $("stats").style.display = "";
    $("toggles").style.display = "";
    setDot(res.active ? "active" : res.slug ? "native" : "off");
    $("reason").textContent = activeReasonNotice() ?? (res.active ? t("popup.active", { mode: t(res.flags.chatMode === "own" ? "popup.mode_own" : "popup.mode_native") }) : localizeStatusLine(res.reason).split("\u2014").join("\xB7"));
    setStatValue("slug", res.slug);
    setStatValue("chatroomId", res.chatroomId);
    setStatValue("pusher", res.pusherConnected ? t("popup.pusher_connected") : t("popup.pusher_disconnected"));
    setStatValue("messages", res.messageCount);
    setStatValue("preserved", res.preservedCount);
    setStatValue("banned", res.bannedCount);
    setStatValue("deleted", res.deletedCount);
    setStatValue("ghostAnchored", res.ghostAnchored);
    setStatValue("ghostPending", res.ghostPendingNoAnchor);
    setStatValue("ghostEvicted", res.ghostEvicted);
    setStatValue("lastBan", fmtAgo(res.lastBanAt));
    $("t-deleted").checked = res.flags.showDeletedMessages;
    $("t-bans-inline").checked = res.flags.preserveBansInline;
    $("t-debug").checked = res.flags.debugLogging;
    $("t-subscriptions").checked = res.flags.showSubscriptions;
    $("t-gifted-subs").checked = res.flags.showGiftedSubs;
    $("t-kicks").checked = res.flags.showKicks;
    $("t-host-raid").checked = res.flags.showHostRaid;
    $("t-mode-changes").checked = res.flags.showModeChanges;
    $("t-chatters-badges").checked = res.flags.showChattersBadges;
    $("t-hide-quick-emotes").checked = res.flags.hideQuickEmoteBar;
    $("t-auto-theater").checked = res.flags.autoTheater;
    $("t-rewind-controls").checked = res.flags.rewindControls;
    $("t-live-catchup").checked = res.flags.liveCatchup;
    $("t-quality-lock").checked = res.flags.qualityLock;
    $("t-quality-always-best").checked = res.flags.qualityAlwaysBest !== false;
    $("t-screenshot").checked = res.flags.screenshot;
    $("t-speed-controls").checked = res.flags.speedControls;
    $("t-auto-claim-drops").checked = res.flags.autoClaimDrops;
    $("t-auto-claim-daily-reward").checked = res.flags.autoClaimDailyReward;
    $("t-chat-mode").value = res.flags.chatMode;
    $("t-hover-follow-mode").value = res.flags.hoverFollowMode;
    renderHotkeys(res.hotkeys ?? createDefaultHotkeyBindings());
  }
  async function refresh() {
    const change = flagChangeRevision;
    const revision = ++refreshRevision;
    const isCurrent = () => change === flagChangeRevision && revision === refreshRevision;
    try {
      const id = await activeTabId();
      if (!isCurrent()) return;
      if (id === void 0) return render(null, t("popup.no_active_tab"));
      const res = await chrome.tabs.sendMessage(id, { type: "kickflow:getStatus" });
      if (!isCurrent()) return;
      if (!res) return render(null, t("popup.not_kick_tab"));
      render(res);
    } catch {
      if (isCurrent()) render(null, t("popup.open_kick"));
    }
  }
  async function setFlag(key, value) {
    const revision = ++flagChangeRevision;
    const isCurrent = () => revision === flagChangeRevision;
    reasonNotice = null;
    try {
      const id = await activeTabId();
      if (id === void 0) {
        if (isCurrent()) showReasonNotice(t("popup.no_active_tab"));
        return;
      }
      const result = await chrome.tabs.sendMessage(id, { type: "kickflow:setFlag", key, value });
      if (!isCurrent()) return;
      await refresh();
      if (isCurrent() && result?.ok !== true) showReasonNotice(t("popup.save_failed"));
    } catch {
      if (isCurrent()) showReasonNotice(t("popup.tab_unavailable"));
    }
  }
  async function setHotkey(action, patch) {
    const id = await activeTabId();
    if (id === void 0) return null;
    try {
      return await chrome.tabs.sendMessage(id, { type: "kickflow:setHotkey", action, patch });
    } catch {
      setHotkeyStatus(t("popup.tab_unavailable"));
      return null;
    }
  }
  async function resetHotkeys() {
    const id = await activeTabId();
    if (id === void 0) return;
    try {
      const result = await chrome.tabs.sendMessage(id, { type: "kickflow:resetHotkeys" });
      if (result?.bindings) renderHotkeys(result.bindings);
      setHotkeyStatus(t("hotkey.reset"));
    } catch {
      setHotkeyStatus(t("popup.tab_unavailable"));
    }
  }
  $("t-deleted").addEventListener("change", (e) => setFlag("showDeletedMessages", e.target.checked));
  $("t-bans-inline").addEventListener("change", (e) => setFlag("preserveBansInline", e.target.checked));
  $("t-debug").addEventListener("change", (e) => setFlag("debugLogging", e.target.checked));
  $("t-subscriptions").addEventListener("change", (e) => setFlag("showSubscriptions", e.target.checked));
  $("t-gifted-subs").addEventListener("change", (e) => setFlag("showGiftedSubs", e.target.checked));
  $("t-kicks").addEventListener("change", (e) => setFlag("showKicks", e.target.checked));
  $("t-host-raid").addEventListener("change", (e) => setFlag("showHostRaid", e.target.checked));
  $("t-mode-changes").addEventListener("change", (e) => setFlag("showModeChanges", e.target.checked));
  $("t-chatters-badges").addEventListener("change", (e) => setFlag("showChattersBadges", e.target.checked));
  $("t-hide-quick-emotes").addEventListener("change", (e) => setFlag("hideQuickEmoteBar", e.target.checked));
  $("t-auto-theater").addEventListener("change", (e) => setFlag("autoTheater", e.target.checked));
  $("t-rewind-controls").addEventListener("change", (e) => setFlag("rewindControls", e.target.checked));
  $("t-live-catchup").addEventListener("change", (e) => setFlag("liveCatchup", e.target.checked));
  $("t-quality-lock").addEventListener("change", (e) => setFlag("qualityLock", e.target.checked));
  $("t-quality-always-best").addEventListener("change", (e) => setFlag("qualityAlwaysBest", e.target.checked));
  $("t-screenshot").addEventListener("change", (e) => setFlag("screenshot", e.target.checked));
  $("t-speed-controls").addEventListener("change", (e) => setFlag("speedControls", e.target.checked));
  $("t-auto-claim-drops").addEventListener("change", (e) => setFlag("autoClaimDrops", e.target.checked));
  $("t-auto-claim-daily-reward").addEventListener("change", (e) => setFlag("autoClaimDailyReward", e.target.checked));
  $("t-chat-mode").addEventListener("change", (e) => setFlag("chatMode", e.target.value));
  $("t-hover-follow-mode").addEventListener("change", (e) => {
    setFlag("hoverFollowMode", e.target.value);
  });
  for (const action of HOTKEY_ACTIONS) {
    $(`hk-${action}-enabled`).addEventListener("change", async (event) => {
      const enabled = event.target.checked;
      const result = await setHotkey(action, { enabled });
      if (result?.bindings) renderHotkeys(result.bindings);
    });
    $(`hk-${action}-change`).addEventListener("click", () => {
      capturingAction = action;
      setHotkeyStatus(t("hotkey.press_key_cancel"));
      if (lastHotkeys) renderHotkeys(lastHotkeys);
    });
  }
  document.addEventListener("keydown", (event) => {
    const action = capturingAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      finishHotkeyCapture(t("hotkey.cancelled"));
      return;
    }
    const key = normalizeHotkeyKey(event.key);
    if (key === null) {
      setHotkeyStatus(t("hotkey.modifier_invalid"));
      return;
    }
    void setHotkey(action, { key }).then((result) => {
      if (!result) return;
      if (!result.ok) {
        if (result.reason === "collision" && result.conflictingAction) {
          const conflict = hotkeyLabel(result.conflictingAction);
          setHotkeyStatus(t("hotkey.collision", { name: conflict }));
        } else {
          setHotkeyStatus(t("hotkey.invalid"));
        }
        if (result.bindings) renderHotkeys(result.bindings);
        return;
      }
      if (result.bindings) lastHotkeys = result.bindings;
      finishHotkeyCapture(
        result.nativeConflict ? t("hotkey.saved_native_conflict") : t("hotkey.saved")
      );
    });
  }, true);
  function selectTab(panel, focus = false) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const selected = tab.dataset.panel === panel;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    document.querySelectorAll(".section[data-panel]").forEach((section) => {
      section.hidden = section.dataset.panel !== panel;
    });
  }
  var tabButtons = Array.from(document.querySelectorAll(".tab"));
  tabButtons.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.panel ?? "chat"));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabButtons[(index + step + tabButtons.length) % tabButtons.length];
      selectTab(next.dataset.panel ?? "chat", true);
    });
  });
  $("hotkey-reset").addEventListener("click", () => {
    finishHotkeyCapture();
    void resetHotkeys();
  });
  async function main() {
    await loadLang();
    const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
    if (requestedLanguage === "tr" || requestedLanguage === "en") setLang(requestedLanguage);
    applyStaticTranslations();
    await refresh();
    window.setInterval(refresh, 1e3);
  }
  void main();
})();
