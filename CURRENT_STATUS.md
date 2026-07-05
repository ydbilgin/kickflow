# KickFlow — CURRENT STATUS

> Bu dosya = projenin anlık durumu. Owner "status oku" derse BU dosya okunur.
> Son güncelleme: 2026-07-05

## Proje
- **KickFlow** = Yasin'in kişisel Chrome MV3 eklentisi (Kick.com) + **7/24 sunucu monitörü**. Repo: `F:\GitHub\kickflow` (lokal git, remote YOK, commit sadece Yasin Derya Bilgin).
- **Amaç:** (1) banlanan/silinen chat mesajlarını YERİNDE üstü-çizili koru, (2) player QoL (rewind/adaptif/kalite/screenshot/pill), (3) **7/24 ban/silme takibi** (Oracle sunucu → banlist.laureth.xyz).

## 🟢 7/24 MONITOR SERVER + banlist.laureth.xyz (2026-07-05, CANLI)
- **Ne:** Kick public Pusher chat'ten 7/24 silinen+banlanan mesaj toplayıcı (orijinal metin + kim banladı + süre). Kaynak artık **AYRI REPO: `F:\GitHub\banlist-monitor`** (lokal git, initial commit `115c556`, kickflow'dan çıkarıldı 2026-07-05 — istenirse yayınlanabilir; deploy source buradan). Node/ws/SQLite/fastify. Deploy: Oracle `/opt/kickflow/server`, systemd `kickflow-monitor` (active+enabled). (Not: eski `kickflow/server/src` kalıntısı bir sistem-process kilidi yüzünden silinemedi → reboot sonrası elle sil.) İzlenen: levo `24906135`, hype `24495088`. Şu an ~5 ban + 26 silme yakalandı (mod'lar: Chhatto, SelamBenDi görünüyor; banned_by+süre çalışıyor).
- **Viewer:** `https://banlist.laureth.xyz` — sayfa-içi şifre **`kick`** (Cloudflare Access DIŞI → sadece bu şifre). Tunnel route + DNS **CF API'den** eklendi (`/opt/laureth/secrets/cf_api_token`).
- **Tasarım v2 (2026-07-05, design-council + builder-opus + cx review):** "Forensic Ledger" — tri-face tipografi (serif tarih / mono omurga / sans sohbet), zaman-oluğu, tarihlere göre sticky bölümler, ban=ember/delete=ochre, green karantinada, **reply context** (↳ replying to @X — defensive, gerçek reply gelince kesinleşir), **kullanıcı→sağ kayan yan panel** (o kişinin o kanaldaki kayıtları). SQLite `reply_to_*` kolonları eklendi.
- **Pipeline:** Opus SPEC → builder-opus → cx cross-family review → deploy (her aşama). Detay: memory `kickflow-monitor-server.md`. Mimari: tek multiplexed socket, per-channel demux, ephemeral buffer, Pusher-only (Kick API'ye dokunmaz — slug→id tarayıcıda).
- **YAPILDI (2026-07-05):** viewer-v2 + admin paneli (kanal hot-ekleme, ADMIN_TOKEN) + cookie-auth ✅ canlı; laureth.xyz içeriği artık Caddy basic_auth (user `laureth`) — email-OTP kaldırıldı ✅. **AÇIK:** reply-shape canlı doğrulaması; Discord alert = owner talebiyle ÇIKARILDI. **Yasal:** başkalarının silinen mesajı = KVKK gri-alan → ÖZEL tutuldu (public teşhir YAPILMADI, bilinçli).
- **Mimari:** A1 = Kick native chat'ini gizle, kendi salt-okunur Pusher bağlantımızdan (`chatrooms.{id}.v2`, public) beslenen kendi listemizi çiz. 3 council turu + 3 Opus critic + canlı DOM doğrulamasıyla seçildi. Kararlar: `docs/superpowers/specs/2026-07-04-*.md`.

## 🟢 2026-07-05 — CHAT OVERLAY FIX (kök sebep bulundu, CANLI KANITLI) + popup + Mode-A
- **Kök sebep (canlı doğrulandı, levo):** "Banlanan mesaj kayboluyor / kendi liste hiç açılmıyor / native'e düşüyor" = Kick chat paneli TAMAMEN React kontrolünde (`#chatroom-messages` + tüm atalar `__reactFiber$`). Listemizi panele enjekte edince React söküyordu (React error #418 + sonsuz "render-queue: container not found, dropping" → hiç aktifleşmiyor → native chat → ban'da mesaj siliniyor). İlk 429/id-fetch teorisi CANLI testte çürüdü (fetch 200'dü). Detay: memory `kickflow-chat-react-overlay-mount`.
- **Fix:** kendi liste artık `document.body` seviyesinde `position:fixed` **overlay** (React dışı) — outer fixed wrapper (pill'i tutar) + inner scroll list; `#chatroom-messages`'a hizalı (ResizeObserver + resize/scroll + 500ms). Native `<html>.kickflow-chat-active` class'ıyla gizli (React silemez). Yeni: `src/content/chat/overlay-mount.ts`.
- **CANLI KANIT (izole muted Chromium, levo):** overlay aktif, native gizli, **GERÇEK banlar korundu** — `ban-guard: updated 1/1/2`, SNAP `banned:4`, "banlandı" yerinde üstü-çizili. Görsel: chat düzgün (badge/emote/renk). → DOĞRULANMADI #2 ARTIK ÇÖZÜLDÜ.
- **Chat geçmişi backfill (YENİ):** overlay artık girişte boş başlamıyor — `web.kick.com/api/v1/chat/{CHANNEL_ID}/history`'den son ~25 mesajı çekip normal pipeline'dan render ediyor (native'i gizleyince geçmiş kaybolmuyordu şikayeti). Kanıt: canlı 25 mesaj ~8sn'de + sonra canlı banlar korundu. Endpoint detayı: memory `kickflow-chat-api-endpoints` (channel-id ≠ chatroom-id). `src/content/chat/history.ts`.
- **Mode-A hardening:** `resolveChatroomId`→`resolveChannel` artık same-origin credentials (Mo'Kick gibi) + 429/5xx backoff-retry (ayrı latent native-fallback riskini kapatır) + channel-id'yi de döndürüyor (history için).
- **Popup yönetim/durum UI (YENİ):** ikon→panel; aktif/native + SEBEP, chatroom id, Pusher, mesaj/korunmuş/ban/silme sayaçları, son ban; toggle: silinen-göster + debug-log (chrome.storage'a persist). `src/popup/`, `status.ts`, `manifest action`+`activeTab`. Build'e 2. entry (`dist/popup.js`).
- **Review:** overlay fix cx cross-family review'landı (pill bug bulundu+düzeltildi+doğrulandı). Mode-A+popup için cx review #2 (devam ediyor). Build (tsc+esbuild) temiz.
- **Sıradaki özellikler (ax_pro envanteri):** `docs/mokick-feature-gap-plan.md` — Top 5: @mention+ses, ok-tuşu ses+oto-theatre, kanal gizleme, chat Ctrl+tık, öncelikli-kullanıcı+mod-log.
- **Ban/timeout etiketleri (2026-07-05):** perma → **BANLANDI**, süreli → **timeout <süre>**, ikisi de **mod adı** ("· Creed"); silme → **SİLİNDİ**. `UserBannedEvent` zaten `permanent`/`duration`/`banned_by` taşıyor, artık extract ediliyor. Oracle viewer (`banlist.laureth.xyz`) de non-perma → **TIMEOUT** (amber) gösteriyor, deploy edildi. Commit'ler `c5fe266` (ext) + `f21f983` (server).
- **Player kontrolleri rework (2026-07-05, council+critic+cx+doğrulama):** commit `26a10fe`. **Anında canlı:** ≤3sn canlı / 3–15sn 1.5x crawl / **>15sn anında snap** (buffered.end-0.5, debounced). YETİŞİLİYOR göstergesi artık **tıklanabilir** (→canlı) + sadece geride görünür. **Sticky DVR guard:** manuel seek → OTO askıda (yank yok), CANLI temizler. **Manuel HIZ menüsü** (`speed-controls.ts`): 3x…0.25x + OTO, karşılıklı dışlama (tek `player-state.ts` kaynağı), fullscreen-safe menü, starvation guard, preservesPitch. Hotkey Lexical-chat guard. Kritik ölçüm: `video.duration`=Infinity/2^30 + `seekable.end`=2^30 sentinel (isStreamOnLive=duration>2^30). Karar: `.claude/_dispatch/council_player-controls/DECISION_SPEC.md`. F10 izole-Chromium doğrulaması geçti.

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
2. **Gerçek ban/silme yerinde üstü-çiziliyor mu:** ✅ ÇÖZÜLDÜ (2026-07-05). levo'da GERÇEK banlarla canlı doğrulandı — `ban-guard: updated 1/1/2`, "banlandı" yerinde üstü-çizili. (Kök sebep overlay-mount'tu; yukarıdaki 2026-07-05 bölümüne bak.) Not: gerçek `MessageDeletedEvent` (silme) hâlâ canlı gözlenmedi — event adı doğru, ban ile aynı yoldan geçiyor.
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
