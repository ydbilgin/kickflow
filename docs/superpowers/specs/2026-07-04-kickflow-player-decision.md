# KickFlow — Player QoL & Stutter Kararı (Council 4, 2026-07-04)

Kaynaklar: cx + ax Gemini 3.1 Pro + ax Gemini 3.5 Flash (oybirliği) + bağımsız MoKick prior-art araştırması + Opus'un canlı Playwright DOM/seek testi. Hepsi aynı sonuca vardı.

## Kanıtlanmış gerçekler (empirik)
- **`video.currentTime` ile geri sarma Kick canlıda ÇALIŞIYOR** (Opus canlı test: -30sn istendi, video gitti, oynamaya devam etti; seekable ~sınırsız DVR). Kick'in kendi seek-bar'ına bağlanmaya GEREK YOK.
- **Native kontrol çubuğu enjeksiyon noktası:** `div.z-controls.absolute.bottom-0` içinde LIVE butonunun sol kümesi (play/volume/saat/LIVE). Rewind/forward buraya (MoKick gibi pause yanına) veya sağ dişli grubuna enjekte edilebilir.
- **MoKick native bar'a INLINE enjekte ediyor** (Kick'in fullscreen'ini sona taşıması bunu kanıtlıyor — overlay'den yapılamaz). Özellikleri: precise rewind/forward, adaptive playback speed, catch-live.

## MoKick'i ne ağırlaştırıyor? (asıl soru — cevaplandı)
- **Player özellikleri AĞIR DEĞİL.** rewind/forward/adaptive-speed = event-tabanlı, minik (native `timeupdate` + tek `currentTime` set). Üç danışman da: player controls masum.
- **Ağır olan = MoKick'in chat/oyun/logging bloat'ı** → GC (garbage collection) duraksamaları. AMO yorumları özellikle CHAT modülünü suçluyor. Player şikayetleri ise BUG'lar: "iki hız butonu çıkıyor" (idempotency eksikliği) + "kontrolsüz hızlanma" (cap'siz catch-up).
- **Sonuç:** "player özellikleri ekle" ile "hafif kal" ÇELİŞMİYOR. İkisi bir arada olur.

## Video stutter — KickFlow DEĞİL (oybirliği)
- Üç danışman da KickFlow mimarisini "masum/temiz" buldu: `display:none` layout tetiklemez, 200-satır DOM cap, 250ms batch, polling yok, player chat'e gate değil.
- **Asıl sebep = kullanıcının bilinen Windows MPO + 5-ekran karışık-refresh sorunu** (memory `multimonitor-mpo-stutter`; eklentisiz de Kick/Twitch/YT takılıyor). Çözüm: registry `OverlayTestMode=5` + reboot (kullanıcı onayı bekliyordu).
- Kanıt yolu: DevTools Performance 30sn kayıt → Long Task >50ms kaynağı `kickflow` mi? Değilse compositor/MPO.

## Kararlar (uygulanacak)

### 1. Rewind kontrollerini native bar'a taşı (overlay'i kaldır)
- `rewind-controls.ts`: yüzen overlay YERİNE `.z-controls` içine idempotent enjekte et. Native buton stiline uy.
- **Idempotency guard ZORUNLU** (`data-kickflow-*` / id kontrolü) — MoKick'in "çift buton" bug'ı tam da bu.
- Dar-scope `MutationObserver` (control root üzerinde, `childList+subtree`, 150ms debounce) ile SPA re-render'da yeniden ekle. `document.body`-wide kalıcı observer YOK. Mevcut `Lifecycle`'a bağla.
- Butonlar: ⏪10 / CANLI / 10⏩ (seek `currentTime`±10, clamp `seekable.end`; CANLI = `currentTime=seekable.end`).

### 2. Adaptive catch-up + "YETİŞİLİYOR -Xsn" göstergesi
- `live-catchup.ts` zaten geride kalınca hızlanıyor. Ekle: (a) görünür "YETİŞİLİYOR -Xsn" indikatörü (native bar'da, behind-live = `seekable.end - currentTime`), (b) toggle butonu (adaptif aç/kapa), (c) **hız cap'i** (≤1.5x, deadband ile canlıda tam dursun — MoKick'in "kontrolsüz hızlanma" bug'ından kaçın).

### 3. Quality-lock yeniden yaz (mevcut senkron scan güvenilmez)
- Birincil: `sessionStorage.setItem('stream_quality', ...)` — Kick kaliteyi burada tutuyor (prior-art: firatmelih/kick-anti-auto-quality). En hafif.
- UI fallback: dişliye tıkla → menüyü **async bekle** (MutationObserver/50ms poll, sabit setTimeout değil) → en yüksek non-Auto (Source varsa Source) seç.
- Kalıcılık: tercih `chrome.storage.local`'da; her yeni video/route/`loadstart`'ta uygula (Kick her oturumda Auto'ya resetliyor). Polling YOK, sadece event-tabanlı.
- HLS `currentLevel` API'si daha temiz ama MAIN world gerektirir (isolated content script sayfa JS'ine erişemez) → faz 2, Kick'in hls instance'ı doğrulanırsa.

### 4. Chat — A1 (kendi liste) kalıyor, hafifletme opsiyonel
- Ban koruması için kendi listemiz tek yol; güçlü makinede vanilla listemiz native Vue chat'ten zaten hafif.
- Opsiyonel hafif-mod (gelecek): native chat'e dokunma + banlananları compact bir log'da göster (ama "yerinde" değil). Kullanıcı isterse.
- Mikro-optimizasyon: yoğun chat'te batch 50→20-30 veya `requestIdleCallback`, A/B'de KickFlow kaynaklı long task çıkarsa.

## Guardrail'ler (MoKick'in gerçek bug'larından kaçın)
- Idempotency: buton zaten varsa ekleme (çift-buton bug'ı).
- Catch-up hız cap'i + deadband (kontrolsüz hızlanma bug'ı).
- Native bar bulunamazsa: no-op + warn (overlay fallback YOK, kullanıcı istemiyor).
