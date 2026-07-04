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
- **Son commit:** `01ee9db`. Build: `npm run build` temiz (~179kb).

## DOĞRULANMADI (owner canlı test etmeli — SIRADAKİ İŞ)
1. **Yeni player build canlıda çalışıyor mu:** rewind butonları native çubukta mı, adaptif gösterge çıkıyor mu, kalite gerçekten en yükseğe kilitleniyor mu. → Owner reboot+reload sonrası test edecek.
2. **Gerçek ban/silme yerinde üstü-çiziliyor mu:** canlı bir moderasyon eylemi hiç gözlenmedi. Mekanizma doğru yazıldı ama gerçek ban ile test edilmedi.
3. **Silme/timeout event isimleri:** hâlâ bilinmiyor → `showDeletedMessages` flag'i KAPALI. Debug modda gerçek event yakalanınca açılacak.
4. **Kalite sessionStorage yeterli mi:** yetmezse gerçek kalite butonunu DevTools ile kesin bulup hedefli çözeceğiz (tahminle değil).
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
