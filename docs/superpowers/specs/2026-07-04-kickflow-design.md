# KickFlow — Design Spec (2026-07-04)

Kişisel kullanım Chrome (MV3) tarayıcı eklentisi — Kick.com için. Amaç: mevcut "MoKick" eklentisinin (kapalı kaynak, ~40k kullanıcı) Firefox'ta doğrulanmış performans sorunlarını (belirli aralıklarla chat donması, sayfanın az duyarlı hale gelmesi) tekrarlamadan, aynı değerli özelliklerin (özellikle banlanan kullanıcıların mesajlarının kaybolmaması) daha hafif bir implementasyonunu sağlamak.

Süreç: 3 bağımsız AI danışman (farklı model aileleri, aynı brief, birbirinden habersiz) → Sonnet orchestrator sentezi → bağımsız Opus adversarial critic. İki tur (kapsam/mimari, sonra isim+performans-derinleştirme) + iki critic geçişi. Critic'ler somut, doğrulanabilir hatalar buldu (aşağıda "Düzeltmeler" bölümünde) — bu bir tasarım sürecinin gücünü gösteriyor: yakınsama tek başına doğruluk garantisi değil.

## İsim
**KickFlow**. Not: mevcut bir "Kickflow" adında workflow-SaaS ürünü var — kişisel/dağıtımsız kullanımda önemsiz, ileride paylaşılırsa yeniden değerlendirilmeli.

## Kapsam — İki bağımsız modül

### 1. Chat Integrity modülü
- **Amaç:** Banlanan kullanıcının mesajlarının tamamen kaybolmasını önlemek (asıl motivasyon) + silinen mesajları göster + mini mod-log (Phase 2).
- **Bağlantı:** Kendi ayrı, salt-okunur ikinci Pusher WebSocket bağlantısı — **kodlamadan önce** DevTools'ta kanalın (`chatrooms.{id}.v2` varsayımı) gerçekten public/unauthenticated olduğu doğrulanmalı. Private/presence çıkarsa: sayfanın zaten authenticate olmuş bağlantısını pasif dinlemeye dön (credential toplamadan, sadece read).

### 2. Player QoL modülü
- Sabit en-yüksek video kalitesi (Auto değil).
- Geri sarınca 1.5x hız, canlıya yetişince (eşik ~1.5-3sn) otomatik 1x'e dönüş — native `timeupdate` event'i, polling yok.
- Kick'in native rewind seek-bar'ında sol/sağ ok tuşuyla ileri-geri sarma (Kick bunu native desteklemiyor — ayrıca eklenmeli).
- **İzolasyon:** Bu modül chat modülünün render/batching hattından tamamen bağımsız çalışır; hiçbir ortak scheduler/debounce paylaşılmaz.

## MVP sırası
1. Event ingest + normalizasyon + store altyapısı.
2. **Banlı kullanıcı mesajı koruma** — asıl şikayet, `UserBannedEvent` (tek doğrulanmış event ismi). İLK bu — ikinci bir doğrulanmamış özellikten önce.
3. Player: sabit en-yüksek kalite (izole, düşük risk, hızlı doğrulanabilir).
4. Player: adaptif catch-up hızı.
5. Player: ok tuşu seek (Kick'in rewind seek-bar DOM yapısına bağımlı olduğu için en kırılgan — en sona bırakıldı).
6. Silinen mesaj gösterme (event ismi DevTools'ta doğrulanana kadar feature-flag arkasında).
7. Mini mod-log paneli → Phase 2.

## Chat render hattı
- Buffer: plain array, `push()`.
- Flush tetikleyici: **250ms zamanlayıcı VEYA ≥50 bekleyen mesaj eşiği** (hangisi önce olursa) → sonraki `requestAnimationFrame` tick'inde tek `DocumentFragment` ile DOM'a bas.
- DOM boyutu: **virtualization yok (YAGNI — kişisel/tek-kanal ölçekte aşırı mühendislik, Kick'in native layout'unu kırılgan hale getirir)**. Bunun yerine sabit pencere: container **200 node** limitine kırpılır (`removeChild` en eskiden), her flush sonrası kontrol edilir. **İstisna: `preserved` işaretli mesajlar bu kırpmadan muaf** (aşağıya bakın).
- Veri modeli: `LimitedQueue` (dairesel buffer, global 500 mesaj/30dk) + `messageById: Map` + `messagesByUserId: Map<userId, Set<messageId>>` + her kullanıcı için ayrıca son ~30 mesajlık kendi `LimitedQueue`'su.
- DOM-veri ilişkisi: `WeakMap<HTMLElement, ChatMessage>` — plain `Map` KULLANMA, node söküldüğünde bellek sızıntısı riski taşır.

## Banlı/silinen mesaj koruma — iki katmanlı mekanizma (critic düzeltmesi)

İlk tasarımda üç danışman da bağımsız olarak aynı hatalı varsayımı yapmıştı: `MutationObserver`'ı `subtree:false` + `attributes:true` ile kurup mesaj elementlerinin (container'ın ÇOCUKLARI) class/style değişikliklerini yakalamayı planlamışlardı. **MDN'e göre bu yanlış:** `subtree:false` iken attribute gözlemi sadece observe edilen node'un KENDİ attribute'larını yakalar, çocuklarını değil. Kick bir SPA olduğu için mesajları class/style ile gizlemesi (tam DOM'dan silme değil) olası — bu durumda pasif gözlem hiçbir şey yakalamaz.

**Doğru mimari (iki katmanlı):**
1. **Birincil — proaktif işaretleme:** `UserBannedEvent` kendi Pusher bağlantımızdan geldiği anda (Kick'in kendi scripti mesajları gizlemeye fırsat bulmadan ÖNCE), `messagesByUserId` üzerinden bulunan ilgili mesaj node'ları kendi `preserved` class'ımızla işaretlenir. Kick'in DOM'u nasıl değiştirdiğinden bağımsız, deterministik.
2. **İkincil/fallback — audit gözlemci:** `subtree:true` ile (evet, `false` değil) chat container'ı gözlemler; proaktif işaretleme yetişemezse (ör. Kick'in gizlemesi bizim event'imizden önce gelirse) yine de yakalar. Maliyeti rAF'a erteleme + ilgisiz node'ları hızlı filtreleme ile kontrol altında tutulur. Bu SADECE yedek, birincil güvenilirlik proaktif katmanda.

**Retention/eviction çelişkisi (2. düzeltme):** `preserved: true` (banlı veya silinmiş) mesajlar hem global `LimitedQueue` eviction'ından hem 200-node DOM clip'inden **muaf** olmalı — aksi halde hızlı chat'te koruduğumuz mesajı normal ring/clip döngüsü kendi siler. Ayrı küçük bir pinned alt-liste (ör. son 50 pinned) tutulmalı, global limit ile aynı anda uygulanmamalı.

**Selector uyarısı:** Danışmanların önerdiği `.chat-rooms-list` hiçbir kaynakta doğrulanmadı, muhtemelen YANLIŞ (kanal/oda listesi sidebar'ı gibi okunuyor, mesaj listesi değil). Gerçek selector kodlamadan önce DevTools'ta bulunmalı.

## Player QoL / Chat modülü ilişkisi
`timeupdate` event'i saniyede birkaç kez tetiklenir, sadece `currentTime`/live-edge karşılaştırması + `playbackRate` ataması yapar (<0.01ms). Chat batching hattıyla hiçbir scheduler/state paylaşmaz — iki modül birbirinden bağımsız, biri bozulursa diğeri etkilenmez.

## Diğer kararlar
- Content script mimarisi; background service worker sadece ayar senkronizasyonu için (MV3'te uzun-yaşayan WebSocket için güvenilir değil).
- Kişisel kullanım/dağıtımsız → ToS/etik risk düşük ama sıfır değil; no-credential, no-write, in-memory-first disiplini korunur. `chrome.storage.local` sadece ayarlar için, `.session` sadece küçük mod-log için — canlı mesaj buffer'ı bunların dışında, sadece bellekte.
- **YAGNI (yapılmayacaklar):** tam virtualization/windowing, Web Worker ile JSON parsing, Redux/MobX/RxJS gibi state kütüphaneleri, disk persistence, video/HLS codec'ine müdahale, sunucu-taraflı moderasyon undo (unban vb. — credential gerektirir, hard kural ihlali).

## Kodlamadan önce zorunlu empirik doğrulama adımları
1. Pusher kanalının (`chatrooms.{id}.v2`) gerçekten public olduğunu DevTools → Network → WS ile doğrula.
2. Mesaj-silme ve timeout event isimlerini canlı yakala (yalnızca `UserBannedEvent` şu an doğrulanmış durumda).
3. Banlı kullanıcı mesajlarının gerçekten "kaybolduğunu" mu yoksa "soluklaştığını" mı DevTools'ta gözle doğrula.
4. Gerçek mesaj-listesi container selector'ını bul (`.chat-rooms-list` değil).
5. Kick'in banlı/silinen mesajı DOM'da nasıl işlediğini tespit et: node tamamen mi siliniyor (childList), yoksa class/style ile mi gizleniyor (attributes)? Bu, proaktif-işaretleme/fallback dengesinin doğru çalışıp çalışmadığını belirler.
6. Kalite-seçici ve native rewind seek-bar'ının DOM yapısı/selector'ları.

## Modül dosya yapısı
```
src/
  content/
    bootstrap.ts              // route/channel değişimini algılar, modülleri başlatır/durdurur
    chat/
      pusher-client.ts        // salt-okunur ikinci Pusher bağlantısı, reconnect-on-navigation
      message-store.ts        // LimitedQueue + index + snapshot + preserved/pinned ayrı liste
      render-queue.ts         // 250ms/50msg hibrit + rAF + DocumentFragment
      dom-window.ts           // 200 node clip (preserved hariç)
      ban-guard.ts            // proaktif işaretleme — birincil koruma mekanizması
      mutation-audit.ts       // subtree:true fallback/audit gözlemci
      feature-flags.ts        // deleted-message flag, mod-log phase flag
    player/
      quality-lock.ts         // Auto dışında en yüksek kalite seçimi
      live-catchup.ts         // timeupdate state machine
      rewind-hotkeys.ts       // native rewind seek-bar sol/sağ tuş bağlama
    shared/
      logger.ts               // debug flag kapalıyken sessiz
      lifecycle.ts            // cleanup disposables
      selectors.ts            // DevTools doğrulaması sonrası gerçek selector'lar buraya
```

## Kaynaklar / geçmiş
Tüm ara council raporları ve iki critic geçişi: `C:\Users\ydbil\council_mokick-lite\` (KICKFLOW_FINAL_SPEC_2026-07-04.md, MOKICK_LITE_DECISION_2026-07-04.md, SYNTHESIS.md, SYNTHESIS2.md, danışman raporları).
