# KickFlow — Sidebar İzleyici-Sayısı/Canlı-Durum Yenileme (Design, 2026-07-10)

Owner: "Takip Edilen Kanallar" sidebar'ındaki izleyici sayıları ve canlı/offline durumu bayat kalıyor — yeni açılan bir yayın hâlâ eski (düşük/0) sayıyı gösterebiliyor. Round 21'de "Sidebar-yenileme" adıyla kapsam dışı bırakılmıştı, owner şimdi talep etti.

## Kapsam
- **Kapsanan:** izleyici sayısı metni + canlı/offline nokta durumu, hem "Takip Edilen Kanallar" hem "Önerilen Kanallar" listelerindeki satırlar.
- **Kapsam dışı:** kanal ekleme/çıkarma, avatar/başlık/kategori metni, "Daha Fazla Göster/Az" davranışı (mevcut haliyle kalır, sadece o an DOM'da render edilmiş satırlar patch'lenir).

## Bilinen gerçekler (doğrulandı)
- `kick.com/api/v2/channels/{slug}` endpoint'i `bootstrap.ts`'te chatroom-id lookup için zaten kullanılıyor ve çalıştığı kanıtlı (WAF engeli yok, aynı-origin content-script fetch'i). Yanıt `livestream: {is_live, viewer_count} | null` içeriyor — canlı test edildi (jahrein/husamviyuviyu/amouranth üzerinde, 2026-07-10).
- Sidebar tamamen Kick'in kendi React-owned DOM'u — KickFlow şu ana kadar hiç dokunmuyor (grep ile doğrulandı, `src/` içinde sidebar/followed/Takip referansı yok).
- Owner risk kabul etti: native paneli **yerinde** güncelleyeceğiz (kendi ayrı overlay panelimiz DEĞİL) — bu, `kickflow-chat-react-overlay-mount` memory'sindeki #418 sınıfı riskle aynı aile (React kendi re-render'ında bizim patch'imizi silebilir).

## ⚠️ Engelleyici bağımlılık — implementasyondan ÖNCE gerekli
Sidebar satırlarının gerçek DOM yapısı (liste container class'ı, satır class'ı, avatar/isim/nokta/sayı elementlerinin class'ları, "Takip Edilen Kanallar" başlığının gerçek DOM konumu) bilinmiyor. kick.com'a scriptli/otomasyonlu erişim WAF'a takılıyor (bkz. `kickflow-kick-automation-waf-block` memory) — bu yapı sadece owner'ın gerçek tarayıcısından DevTools ile çıkarılabilir. Bu repo'nun kendi tasarım notunda da aynı uyarı zaten var (`2026-07-04-kickflow-design.md`: "Selector uyarısı... gerçek selector kodlamadan önce DevTools'ta bulunmalı").

**Owner'dan istenecek:** bir takip edilen kanal satırına sağ-tık → İncele → o satırın (ve liste/aside container'ının) outerHTML'ini kopyalayıp vermesi. Bu olmadan cx kör/tahmini class isimleriyle kodlar ve canlıda kırılma riski yüksek olur.

## Mimari
Yeni dosya `src/content/chat/sidebar-refresh.ts`, mevcut `Lifecycle`-scoped controller pattern'i (`native-bar.ts` ile aynı aile):

```
class SidebarRefreshController {
  constructor(lifecycle: Lifecycle, root: Element)
  private discoverRows(): SidebarRow[]   // href="/slug" içeren satırlar, container'dan
  private async refreshRow(row: SidebarRow): Promise<void>
  private patchRow(row: SidebarRow, data: {isLive: boolean; viewerCount: number}): void
  private observeAndReapply(): void      // MutationObserver, native-bar.ts'teki self-heal pattern'i
}
```

- **Keşif:** kök container'da (owner'ın vereceği selector'a göre) `a[href^="/"]` satırları toplanır, `href`'ten slug çıkarılır. Sadece gerçek kanal satırları (avatar+isim+nokta içerenler) filtrelenir — nav linkleri (Ana Sayfa/Gözat/Takip Edilen Kanallar başlığı) hariç tutulur.
- **Veri çekme:** her slug için `GET kick.com/api/v2/channels/{slug}` — mevcut retry/backoff helper'ı (bootstrap.ts'teki chatroom-id lookup'ı) paylaşılabilirse paylaşılır, değilse aynı desenle küçük bir kopyası yazılır. İstekler **stagger'lanır** (satır başına ~250ms arayla, tek seferde N paralel istek YOK) — WAF/rate-limit riskini azaltmak için.
- **Tetikleyiciler (owner kararı):** (a) periyodik `setInterval` (~45sn), (b) `document.visibilitychange`/`window focus` olayında ekstra bir tur — sekmeye dönünce hemen tazelenir.
- **Patch:** satırın mevcut sayı text node'u ve nokta elementinin class'ı DEĞİŞTİRİLMEDEN sadece `textContent`/renk güncellenir (Kick'in kendi CSS'i korunur, bizim ekstra stil eklememize gerek kalmaz).
- **React-wipe'a karşı self-heal:** kök container `MutationObserver({childList:true, subtree:true})` ile izlenir; Kick kendi re-render'ında bir satırı değiştirirse (patch'lediğimiz değer DOM'dan kaybolursa/resetlenirse), bir sonraki tick'te **son bilinen taze veriyle** otomatik yeniden patch'leriz. Bu native-bar.ts round 16'da kanıtlanmış "leading ensure + trailing check" desenin küçültülmüş hali.
- **Feature flag:** `showSidebarRefresh` (default `true`), mevcut 5 flag'le aynı popup/panel/storage deseni (`kf_flag_showSidebarRefresh`). Owner canlıda sorun görürse tek tıkla kapatabilir.
- **Hata toleransı:** bir satırın fetch'i 404/network-error olursa DOM'daki mevcut değeri OLDUĞU GİBİ bırak (boşaltma/"—" yazma yok), `logger.warn` ile logla, bir sonraki turda tekrar dene.
- **Lifecycle:** bootstrap sırasında sidebar kök elementi bulununca başlatılır (mevcut retry-until-present deseniyle, `whenElementPresent`); tab/extension teardown'da observer+interval temizlenir.

## Test planı
- Owner'ın vereceği gerçek HTML'den türetilmiş sentetik jsdom fixture'ı (`tests/chat/sidebar-refresh.test.ts`).
- Kapsanacak senaryolar: slug çıkarma (nav-link'leri hariç tutma), patch sonrası doğru textContent/class, fetch-hata → eski değer korunur, fake-timer ile stagger zamanlaması, mutation sonrası yeniden-patch (self-heal), flag kapalıyken hiç fetch atmama, visibilitychange tetikleyicisi.
- **Canlı doğrulama yine owner'da** — WAF nedeniyle Claude/cx kick.com'u scriptli test edemiyor (bkz. `kickflow-kick-automation-waf-block`).

## Guardrail'ler
- Sadece görünür (DOM'da render edilmiş) satırlar patch'lenir — "Daha Fazla Göster" öncesi gizli satırlara istek atılmaz.
- Stagger + interval ile Kick API'sine yük bindirilmez.
- Self-heal reapply bir "savaş" döngüsüne dönmemeli — sadece mutation SONRASI tek seferlik yeniden-uygulama, sürekli zorlayıcı re-write yok (CPU/flicker riski).
