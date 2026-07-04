# KickFlow — CURRENT STATUS

> Bu dosya = projenin anlık durumu. Owner "status oku" derse BU dosya okunur.
> Son güncelleme: 2026-07-04

## Proje
- **KickFlow** = Yasin'in kişisel Chrome MV3 eklentisi, Kick.com için. Repo: `F:\GitHub\kickflow` (lokal git, remote YOK, commit sadece Yasin Derya Bilgin).
- **Amaç:** (1) banlanan/silinen chat mesajlarını YERİNDE üstü-çizili koru (BTTV-tarzı — MoKick'te kayboluyor), (2) player QoL (rewind/adaptif/kalite).
- **Mimari:** A1 = Kick native chat'ini gizle, kendi salt-okunur Pusher bağlantımızdan (`chatrooms.{id}.v2`, public) beslenen kendi listemizi çiz. 3 council turu + 3 Opus critic + canlı DOM doğrulamasıyla seçildi. Kararlar: `docs/superpowers/specs/2026-07-04-*.md`.

## Ne YAPILDI (kod yazıldı + review'landı + build temiz)
- **Chat modülü:** kendi liste render'ı (emote `files.kick.com/emotes/{id}/fullsize` + badge + mention + link), banlı/silinen mesaj yerinde `.kickflow-preserved` üstü-çizili + "banlandı/silindi" etiketi, preserved mesajlar eviction'dan muaf (cap 50 + TTL). CSS düzeltildi (Tailwind `img{display:block}` reset'i badge/emote'ları bozuyordu → `inline-block !important`). Kullanıcı ekran görüntüsünde chat'in geldiği DOĞRULANDI.
- **Player modülü:** ⏪10/CANLI/10⏩ butonları native çubukta (`div.z-controls`, LIVE yanına inline, `native-bar.ts` idempotent mount + player-wrapper observer ile self-heal), adaptif catch-up + "YETİŞİLİYOR -Xsn" göstergesi + toggle (hız cap 1.5x + deadband), kalite kilidi = `sessionStorage.stream_quality` (güvenli, kör-tıklama YOK), ok tuşu seek (seekable clamp).
- **Review:** iki tur — Opus critic + cx cross-family — hepsi uygulandı.
- **Son commit:** `01ee9db` (bu düzeltmelerden önce). Build: `npm run build` temiz.
- **2026-07-04 player düzeltmeleri (Playwright izole Chromium ile GERÇEK canlı yayında doğrulandı):**
  1. **Butonlar hiç görünmüyordu** — Kick sayfada `z-controls` class'lı ÜÇ eleman render ediyor (sağ-üst chat-toggle / boş layout katmanı / gerçek alt çubuk). Eski `document.querySelector('div.z-controls')` yanlışını (chat-toggle) seçiyordu → LIVE anchor'ı yok → kontroller HİÇ mount olmuyordu. `findControlBar` artık video-wrapper'a scope'lu, `div.z-controls.bottom-0`'ı seçiyor.
  2. **Catch-up `-1073741819sn` + CANLI catapult** — `seekable.end` rebuffering'de 2^30 sentinel döndürüyor (canlıda `seekableEnd:1073741824`, `bufferedEnd:9.14` ile kanıtlandı). Canlı-kenar / CANLI / clamp artık **`buffered.end` tabanlı** (Mo'Kick'in kanıtlı yöntemi; `adaptiveSpeed.js`+`videoShortcuts.js` de buffered kullanır). live-catchup guard + null stand-down eklendi.
  - Doğrulama: iki tur **cx cross-family review** (sıfır kalan bulgu) + canlı fonksiyonel test (mount + rewind + CANLI sağlıklı + `playbackRate=1`). Test yöntemi: `memory/kickflow-e2e-playwright-harness.md`.
- **2026-07-04 (2) — kalite + silinen mesaj + UI redesign (izole Chromium'da doğrulandı, cx review'lı):**
  1. **Kalite kilidi tamamen yeniden yazıldı** (`quality-lock.ts`). Kök sebep: Kick artık **Amazon IVS Player** kullanıyor (hls DEĞİL); eski `sessionStorage.stream_quality` yazımı IVS'te ÖLÜ (video 720p'de kaldı). Yeni yöntem: Kick'in kendi kalite menüsünü (dişli ⚙, cog SVG path'iyle GÜVENLİ tespit, yanlış-buton fallback YOK) sentetik pointer event'le aç → **en yüksek non-gate `[role=menuitemradio]`'yu** tıkla (Auto + login-gate'li "…Giriş gerekli" satırlar elenir). Canlı test: logged-out'ta **720p60 seçildi** (aria-checked); login'li owner'da 1080p60 seçilecek. Not: her uygulamada menü ~300ms flash olabilir; zaten-en-yüksekse no-op.
  2. **Silinen mesaj özelliği AÇILDI** (`showDeletedMessages: true`). Kök sebep: delete event adı yanlış tahmin edilmişti (`ChatMessageDeletedEvent`). MoKick'in shipping kodundan doğru ad: **`App\Events\MessageDeletedEvent`**; id okuma `data.message?.id ?? data.id`. Artık silinen mesaj kendi depomuzdan ORİJİNAL metniyle üstü-çizili kalır (MoKick sadece "Deleted by a moderator" placeholder basıyor — biz daha iyisini yapıyoruz). Canlı `MessageDeletedEvent` frame'i yakalanamadı (Kick Pusher'ı Worker'da çalıştırıyor olabilir; chat sakindi) → owner login'li makinede ilk gerçek silmede teyit edecek.
  3. **Player UI redesign:** butonlar class-tabanlı (`.kickflow-player-*`, hover/active/focus), rewind/forward **stroke SVG çift-chevron `« »`** (emoji değil), CANLI kırmızı-nokta pill, OTO yeşil/dim toggle. **Ok tuşları 10 sn** (butonlarla hizalı, eskiden 5).

## DOĞRULANMADI (owner canlı test etmeli — SIRADAKİ İŞ)
1. **Player kontrolleri:** ✅ ARTIK DOĞRULANDI — Playwright izole Chromium'da gerçek canlı yayında rewind (⏪10/CANLI/10⏩) + adaptif mount ve fonksiyon doğrulandı. Owner yine de kendi Chrome'unda `reload → F5` ile teyit etsin (aynı kod). Kalite kilidi hâlâ canlı gözlenmedi (sessionStorage tabanlı).
2. **Gerçek ban/silme yerinde üstü-çiziliyor mu:** canlı bir moderasyon eylemi hiç gözlenmedi. Mekanizma doğru yazıldı ama gerçek ban ile test edilmedi.
3. **Silme event'i:** ✅ ad artık biliniyor (`App\Events\MessageDeletedEvent`, MoKick kaynağından) ve flag AÇIK — AMA canlı bir gerçek silme henüz gözlenmedi. Owner login'li makinede ilk silmede orijinal-metin-üstü-çizili çalışıyor mu doğrulayacak.
4. **Kalite:** ✅ ÇÖZÜLDÜ (IVS menü tıklama) — logged-out izole Chromium'da 720p60 seçimi doğrulandı. Owner login'li makinede 1080p60'a kilitleniyor mu + menü flash'ı rahatsız edici mi teyit edecek.
5. **Stutter MPO fix ile geçti mi:** `OverlayTestMode=5` zaten yazılı AMA reboot bekliyor (memory `multimonitor-mpo-stutter`). Reboot sonrası test.

## SIRADAKİ ADIMLAR
- [ ] Owner reboot (MPO fix aktifleşsin) → Kick takılma testi.
- [ ] Owner: `chrome://extensions` → KickFlow reload → Kick F5 → player+chat test.
- [ ] Owner geri bildirim: takılma? rewind/adaptif/kalite? chat?
- [ ] Kalite kilitlenmiyorsa → DevTools ile gerçek kalite selector'ı.
- [ ] Debug ile gerçek delete/ban event yakala → event ismini doğrula → silinen-mesaj özelliğini aç.

## Yükleme / dev döngüsü
- Yükle: `chrome://extensions` → Developer mode → Load unpacked → `F:\GitHub\kickflow`.
- Dev: kod değişince `npm run build` → eklenti reload → Kick F5.
- Debug: `src/content/chat/feature-flags.ts` → `debugLogging: true` → build+reload → F12 Console (bilinmeyen event'leri loglar).

## Kapsam DIŞI (bilinçli, YAGNI)
3. parti (7TV/BTTV) emote, mod-hover butonları, user-card, mod-log paneli (Phase 2), tam virtualization, HLS `currentLevel` API (MAIN world gerektirir → faz 2), Chrome Web Store yayını (owner kişisel kullanım seçti), gelir modeli.
