# Mo'Kick → KickFlow — özellik boşluğu planı

> Kaynak: ax_pro (Gemini 3.1 Pro) Mo'Kick kaynak envanteri, 2026-07-05. Bu doküman KickFlow
> mimarisine göre önceliklendirilmiş, uygulanabilir plandır. Karar: owner. Kapsam: kişisel kullanım.

KickFlow'un mevcut mimarisi: içerik betiği (`src/content/`), kendi Pusher bağlantısı + kendi
overlay chat listesi (`overlay-mount.ts`), player QoL modülleri, ve yeni popup durum paneli. Aşağıdaki
özellikler bu iskelete oturur.

## Öncelikli 5 (değer/efor)

### 1. @mention dinleyici + ses bildirimi — **Değer: Yüksek · Efor: S**
- **Ne:** Kendi adın/takma adların chat'te geçince ses çal + satırı vurgula.
- **KickFlow'a oturma:** Zaten TÜM mesajlar `pusher-client → onMessage` üzerinden geçiyor. `message.content`'te owner'ın kullanıcı adı / kullanıcı-tanımlı takma ad listesi regex-match → `new Audio()` çal + o satıra `.kickflow-mention-hit` sınıfı. Kullanıcı adı = zaten sayfadan/`/me` çağrısından okunabilir; takma adlar popup'tan girilir (chrome.storage).
- **Yeni:** `src/content/chat/mention-listener.ts` + popup'a "takma adlar" input + ses aç/kapa toggle.

### 2. Klavyeyle ses + oto-sinema modu — **Değer: Yüksek · Efor: S**
- **Ne:** Yukarı/Aşağı ok = ses ±; her yayına girişte otomatik theatre/sinema modu.
- **KickFlow'a oturma:** `rewind-hotkeys.ts` zaten ok tuşlarını (sol/sağ) yakalıyor — yukarı/aşağı ekle → `video.volume` ayarla (+ küçük on-screen OSD). Oto-theatre: Kick'in kendi theatre butonunu tespit edip yayına girişte bir kez tıkla (idempotent). ⚠️ Ok-yukarı/aşağı sayfa scroll'unu tetikleyebilir → chat/player odakta `preventDefault`.
- **Yeni:** `src/content/player/volume-hotkeys.ts` + `auto-theater.ts` (feature-flag'li).

### 3. Kanal gizleme / karaliste — **Değer: Yüksek · Efor: M**
- **Ne:** Ana sayfa/kategori dizininde istemediğin yayıncıları gizle.
- **KickFlow'a oturma:** Yeni bir DOM-observer modülü — ana sayfa kart listesini izle, karalisteye giren slug'ların kartını gizle. Karaliste popup'tan yönetilir (chrome.storage). Kick ana sayfası React/virtualize → MutationObserver + slug eşleştirme gerekir (overlay dersinden: React kartlarını SİLME, sadece `display:none` uygula ve re-render'da yeniden uygula).
- **Yeni:** `src/content/browse/channel-hider.ts` + popup karaliste yönetimi. ⚠️ Bu, chat/player DIŞINDA yeni bir yüzey (kick.com ana sayfası) → ayrı içerik-betiği kapsamı; test maliyeti orta.

### 4. Chat girdi güçlendirici (Ctrl+tık yanıt/alıntı) — **Değer: Yüksek · Efor: S/M**
- **Ne:** Bir mesaja Ctrl+tık = hızlı yanıtla/alıntıla; tek-tık kopyala/etiketle.
- **KickFlow'a oturma:** Kendi overlay satırlarımız zaten bizde (`message-view.ts`) → satıra tık/ctrl-tık handler ekle. AMA "yanıtla" = Kick'in native chat input'una yazmak/reply-context set etmek gerekir; Kick input'u React → değeri programatik set etmek reconcile ile silinebilir (overlay dersi). Çözüm: input'a `document.execCommand`/native setter + `input` event dispatch (React controlled-input pattern) VEYA sadece "kopyala/@etiketle" (input'a mention ekle) ile başla. Reply-context tam entegrasyon = M.
- **Yeni:** `message-view.ts` satır handler + `chat/input-bridge.ts`.

### 5. Öncelikli kullanıcı vurgusu + mod-aksiyon log — **Değer: Yüksek · Efor: M**
- **Ne (a):** Sevdiğin kişilerin mesajlarını çerçeve/renk ile vurgula (öncelikli kullanıcı listesi).
- **Ne (b):** Kanalda kim banlandı/susturuldu/silindi → satır-içi mod-log (Mo'Kick `moderationEventsRenderer` gibi).
- **KickFlow'a oturma:** (a) `onMessage`'da `sender.username` öncelikli-listede ise `.kickflow-priority` sınıfı; liste popup'tan (chrome.storage). (b) `handleUserBanned`/`handleMessageDeleted` zaten event'leri yakalıyor → overlay'e bir "🔨 X, Y tarafından banlandı" log satırı bas (bizde ekstra kolay çünkü orijinal metin + banned_by zaten var). Bu, `modLogPanel` feature-flag'inin gerçek gövdesi olur.
- **Yeni:** `chat/priority-users.ts` + `handleUserBanned`'e log-satırı; popup'a öncelikli-liste + mod-log toggle.

## Bilinçli kapsam-dışı (düşük öncelik, yine de kayıtta)
- 3. parti emote (7TV/BTTV), Draw'n'Guess oyunu, Giveaway sistemi, Membership/Supporters — büyük efor, kişisel-izleme değeri düşük. Şimdilik HAYIR.

## Önerilen sıra
1 (mention+ses) → 2 (ses tuşları+theatre) → 5b (mod-log — altyapı hazır, düşük efor) → 4 (chat Ctrl+tık) → 5a (öncelikli kullanıcı) → 3 (kanal gizleme — ayrı yüzey, en son).

Her biri: küçük feature-flag'li modül + popup toggle + izole Chromium'da canlı doğrulama + cx cross-family review (pipeline).
