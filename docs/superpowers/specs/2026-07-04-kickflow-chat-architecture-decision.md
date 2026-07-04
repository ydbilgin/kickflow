# KickFlow — Chat Mimari Kararı: Banlı/Silinen Mesajı Yerinde Gösterme (2026-07-04)

Süreç: Council Tur 3 (cx GitHub-kaynak-kanıtlı + ax Pro + ax Flash, oybirliği) + bağımsız 7TV/NipahTV kaynak araştırması + Opus adversarial critic (mevcut kodu okuyup 3 MUST-FIX + 3 SHOULD-FIX buldu) + canlı DOM doğrulaması.

## KARAR: A1 — Kendi kontrollü chat listesi (mevcut mimari DOĞRU, korunuyor)

BTTV-tarzı "banlı/silinen mesaj yerinde üstü-çizili kalsın" ancak mesaj render'ının sahipliğiyle mümkün. Kanıt (gerçek kaynak koddan):
- 7TV Twitch'te native renderer'ı bypass edip KENDİ listesini çiziyor; silindi durumu kendi modelinde, üstü-çizme kendi component'inde. Kick'te bunu HİÇ yapmıyor (sadece emote/cosmetic) çünkü Kick virtualized + ban'da mesajı state'ten siliyor.
- NipahTV (Kick-native) chat'i tamamen kendi UI'ıyla değiştiriyor; silinen-mesaj-koruma için açık issue #196 → Kick'te bu iş özel render sahipliği gerektiriyor.
- A2 (native patch) ve A4 (overlay) node-recycling yüzünden kanıtlanmış çıkmaz. A3 (ayrı şerit) sağlam ama "yerinde" değil → fallback.

## Canlı DOM doğrulaması (2026-07-04) — A1'in maliyeti DAR çıktı
`#chatroom-messages`'ın KARDEŞLERİ (gizlenmiyor, korunuyor):
- Pinned mesaj overlay'i (`absolute w-full empty:hidden`)
- Alt overlay (kutlama/scroll-to-bottom/yeni-mesaj göstergesi)
- Mesaj yazma kutusu `#chatroom-footer` (composer + emote menüsü — grandparent seviyesinde, ayrı)

Sadece `#chatroom-messages`'ın içindeki virtualized liste (rows: `data-index` + `absolute` transform) gizleniyor. **Kaybolan:** kullanıcı-kartı (isme tıklama), reply, mesaj-üstü mod-hover butonları, VE muhtemelen inline sub/gift/sistem bildirimleri (ChatMessageEvent değilse). Bir viewer (mod değil) için bu kayıplar dar/kabul edilebilir.

## BAĞLAYICI DÜZELTMELER (Opus critic — mevcut kodda gerçek bug'lar, implementasyonda uygulanacak)

### MUST-FIX (extension'ın var oluş sebebini kıran hatalar)
1. **Fail-unsafe → chat'siz kalma:** `ensureOwnMessageList` native'i SENKRON `display:none` yapıyor ama Pusher/chatroom-id async ve başarısız olabilir (null id, private kanal, WS mesaj getirmez) → kullanıcı boş liste + native chat YOK ile kalıyor (hiçbir şey yapmamaktan KÖTÜ). **Fix:** native'i ancak İLK BAŞARILI flush'tan sonra gizle; her başarısızlık/inaktif yolda native'i geri getir (= A3-fallback'in de temeli).
2. **Ban-işaretleme render flush'ıyla yarışıyor:** mesaj 250ms/rAF batch'inde beklerken gelen `UserBannedEvent`, henüz var olmayan DOM elementini arıyor → store `preserved` işaretliyor ama `buildMessageElement` `message.preserved`'ı HİÇ okumuyor → satır üstü-çizgisiz render ediliyor. Tam da banlanan (en yeni) mesajlar sessizce kaçırılıyor. **Fix:** preserved/banned/deleted durumu `buildMessageElement`'te render anında uygulanmalı; ban-guard sadece zaten-render-edilmiş satırlar için ek katman.
3. **50-cap ölü kod → sınırsız büyüme:** `preserveMessage` `LimitedQueue(50)`'a push ediyor ama evict edilen dönüşü YOK SAYIYOR; `preserved=true` kalıyor → `forget()` atlıyor, `trimMessageWindow` hep muaf tutuyor. Hiçbir şey un-preserve etmiyor → bot-ban dalgasında (hedef senaryo!) korunmuş node+obje sınırsız büyür, TTL yok. **Fix:** preserved-queue eviction'ında gerçekten un-preserve + forget + node'u kaldır.

### SHOULD-FIX
4. **Player QoL bağımsız DEĞİL:** `startSession`, `initPlayerQol`'den ÖNCE `#chatroom-messages`'ı 15sn'ye kadar bekliyor → player 15sn gecikebilir. **Fix:** player sadece `#video-player` (video elementi) varlığına gate'lensin, chat'e değil.
5. **createElement gerekli ama YETERLİ değil (XSS):** chat içeriği tamamen saldırgan-kontrollü, extension kullanıcının Kick oturumu bağlamında çalışıyor. Emote/badge/link eklerken güvenli-render checklist'i ZORUNLU:
   - Mesaj metni, username, mention → `textContent`/`createTextNode` (asla innerHTML).
   - Emote id → `^\d+$` regex doğrula, sonra `https://files.kick.com/emotes/{id}/fullsize` (cx canlı test: `/fullsize`=200, prefix'siz=403).
   - Badge `image_url` → sadece `https:` + Kick-CDN host allowlist (yoksa IP-leak/beacon riski).
   - Link `href` → sadece `http(s):` allowlist (`javascript:`/`data:` reddet — page context'te exec riski).
   - Renk → `element.style.color = value` (property setter geçersizi reddeder), ASLA `setAttribute('style')`/`cssText`.
6. **A3 auto-fallback:** own-list renderer inaktif/başarısızsa otomatik olarak native chat'e geri dön (MUST-FIX #1'in çözümü zaten bunu sağlıyor) — kullanıcı asla chat'siz kalmasın.

### MINOR
7. Autoscroll/scroll-anchoring yok (canlı chat takip etmiyor, top-trim'de zıplıyor) — eklenmeli. `mutation-audit.ts` şu an kendi listemizi gözlüyor (vestigial A2 kalıntısı) — gözden geçir. "Tüm geçmiş mesajlar korunur" iddiası abartı: per-user 30 / 200-node penceresi dışındakiler ban anında zaten yok — dürüst dokümante et.

## Player QoL modülü
Karardan etkilenmiyor (kendi başına), sadece SHOULD-FIX #4 (gate düzeltmesi) uygulanır.

## Kullanıcıya sorulacak 2 gerçek tercih sorusu (danışmanların oybirliğiyle sorduğu)
1. Sadece Kick resmi emote'ları mı, yoksa 3. parti (7TV/BTTV) emote'ları da mı render edilsin?
2. Banlı mesajlar yerinde üstü-çizili kalsın + AYRICA en üstte "son banlananlar" barında pin'lensin mi, yoksa sadece yerinde mi?
