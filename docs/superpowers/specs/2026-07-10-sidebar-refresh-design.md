# KickFlow — Sidebar İzleyici-Sayısı/Canlı-Durum Yenileme (Design, 2026-07-10)

Owner: "Takip Edilen Kanallar" sidebar'ındaki izleyici sayıları ve canlı/offline durumu bayat kalıyor — yeni açılan bir yayın hâlâ eski (düşük/0) sayıyı gösterebiliyor. Round 21'de "Sidebar-yenileme" adıyla kapsam dışı bırakılmıştı, owner şimdi talep etti.

## Kapsam
- **Kapsanan (v1):** SADECE "Takip Edilen Kanallar" listesi — izleyici sayısı metni + canlı/offline nokta durumu.
- **v1 kapsam dışı (bilinçli descope, 2026-07-10):** "Önerilen Kanallar" listesi. Owner'ın çıkardığı gerçek DOM'da (bkz. aşağıki "Gerçek DOM yapısı") sadece takip edilen satırların `data-testid="sidebar-following-channel-N"` deseni doğrulandı; önerilen kanalların aynı deseni kullanıp kullanmadığı bilinmiyor. Onu da kapsamaya çalışmak tahmine döner (bu repo'nun kendi `.chat-rooms-list` dersi). Owner'ın orijinal şikayeti zaten Takip Edilen Kanallar'daydı — Önerilen Kanallar ayrı, küçük bir fast-follow turu olabilir (kendi `data-testid`'i doğrulanınca).
- **Her zaman kapsam dışı:** kanal ekleme/çıkarma, avatar/başlık/kategori metni, "Daha Fazla Göster/Az" davranışı (mevcut haliyle kalır, sadece o an DOM'da render edilmiş satırlar patch'lenir).

## Bilinen gerçekler (doğrulandı)
- `kick.com/api/v2/channels/{slug}` endpoint'i `bootstrap.ts`'te chatroom-id lookup için zaten kullanılıyor ve çalıştığı kanıtlı (WAF engeli yok, aynı-origin content-script fetch'i). Yanıt `livestream: {is_live, viewer_count} | null` içeriyor — canlı test edildi (jahrein/husamviyuviyu/amouranth üzerinde, 2026-07-10).
- Sidebar tamamen Kick'in kendi React-owned DOM'u — KickFlow şu ana kadar hiç dokunmuyor (grep ile doğrulandı, `src/` içinde sidebar/followed/Takip referansı yok).
- Owner risk kabul etti: native paneli **yerinde** güncelleyeceğiz (kendi ayrı overlay panelimiz DEĞİL) — bu, `kickflow-chat-react-overlay-mount` memory'sindeki #418 sınıfı riskle aynı aile (React kendi re-render'ında bizim patch'imizi silebilir).

## Gerçek DOM yapısı (owner'ın Console'dan çıkardığı canlı örnek, 2026-07-10, Jahrein satırı)
```html
<a class="flex h-11 w-full flex-row items-center gap-2 rounded px-1.5"
   data-testid="sidebar-following-channel-1" data-state="false" href="/jahrein">
  <div class="relative size-7 shrink-0 rounded-full">
    <img alt="Jahrein" class="h-full w-full overflow-hidden rounded-full" src="...">
  </div>
  <div class="flex w-full gap-1 overflow-hidden">
    <div class="flex min-w-0 max-w-full shrink grow flex-col gap-0.5">
      <span class="shrink truncate text-sm font-bold leading-[1.2]">Jahrein</span>
      <span class="text-subtle truncate text-xs font-bold leading-normal">Sadece Sohbet</span>
    </div>
    <div class="flex w-fit shrink-0 flex-nowrap items-center gap-x-1 self-start text-white">
      <div class="h-2 w-2 rounded-full bg-green-500"></div>
      <span class="text-sm font-semibold"><span title="11002">11&nbsp;B</span></span>
    </div>
  </div>
</a>
```
(Bu `<a>`, Kick tarafından bir `<button class="group inline-flex ...">` içine sarılıyor — biz sadece `<a>`'yı ve içindekileri hedefliyoruz, `<button>` sarmalayıcıya dokunmuyoruz.)

**Kararlı anchor bulundu — Tailwind class'larına değil, `data-testid`'e bağlanıyoruz:**
- **Satır seçici:** `a[data-testid^="sidebar-following-channel-"]` — Kick'in kendi koyduğu semantic test-id, class isimlerinden çok daha kararlı (aynı sohbette gördüğümüz gibi Kick'in Tailwind class'ları anlamsız/otomatik üretilmiş, güvenilir değil). `data-testid` sıra-bazlı (satır index'i, kanal-slug'a sabit değil) — bu SORUN DEĞİL çünkü her patch turunda satırın KENDİ `href`'inden slug taze okunuyor, index hiç persist edilmiyor.
- **Slug:** `row.getAttribute('href')` → `/jahrein` → `jahrein`.
- **İzleyici sayısı:** `row.querySelector('span[title]')` — Kick'in KENDİSİ ham sayıyı `title` attribute'unda tutuyor (`title="11002"`), görünen metin ("11 B") sadece kısaltılmış gösterim. Patch: `countEl.title = String(rawCount)` + `countEl.textContent = <kısaltılmış format>`. **Not:** Kick'in tam kısaltma algoritmasını (yuvarlama/ondalık kuralları büyük sayılarda) tek örnekten bilemeyiz — makul bir K/M kısaltma fonksiyonu yazılıp owner'ın canlı testinde görsel doğrulanacak, gerekirse ince ayar yapılır (bu projenin standart "ship+owner-test+fast-follow" döngüsü).
- **Canlı nokta:** `row.querySelector('div.rounded-full.h-2.w-2')` — küçük 8px daire. **Kick'in "offline" durumundaki class'ını hiç görmedik (owner'ın örneği canlı bir kanaldı) — o rengi TAHMİN ETMİYORUZ.** Onun yerine dot'a kendi kontrolümüzdeki bir `data-kickflow-live="true|false"` attribute'u koyup rengi KENDİ injected CSS'imizle yönetiyoruz (`ensureStyles()`'a `[data-kickflow-live="true"]{background:#22c55e}` / `[data-kickflow-live="false"]{background:#6b7280}` gibi) — Kick'in kendi class'ını okumaya/değiştirmeye hiç gerek yok, sadece inline-override.
- **Liste container:** `<section class="flex w-full flex-col p-3">`, ilk çocuğu "Takip Edilen Kanallar" başlık `<div>`'i, sonrası satır `<button>`'ları. Self-heal MutationObserver bu `<section>` üzerinde çalışır.

## Mimari
Yeni dosya `src/content/chat/sidebar-refresh.ts`, mevcut `Lifecycle`-scoped controller pattern'i (`native-bar.ts` ile aynı aile):

```
class SidebarRefreshController {
  constructor(lifecycle: Lifecycle)
  private discoverRows(): HTMLAnchorElement[]   // a[data-testid^="sidebar-following-channel-"]
  private async refreshRow(row: HTMLAnchorElement): Promise<void>
  private patchRow(row: HTMLAnchorElement, data: {isLive: boolean; viewerCount: number}): void
  private observeAndReapply(): void             // MutationObserver, native-bar.ts'teki self-heal pattern'i
}
```

- **Keşif:** `document.querySelectorAll('a[data-testid^="sidebar-following-channel-"]')` — nav-link filtrelemeye gerek yok, bu test-id sadece kanal satırlarında var.
- **Veri çekme:** her slug için `GET kick.com/api/v2/channels/{slug}` — mevcut retry/backoff helper'ı (bootstrap.ts'teki chatroom-id lookup'ı) paylaşılabilirse paylaşılır, değilse aynı desenle küçük bir kopyası yazılır. İstekler **stagger'lanır** (satır başına ~250ms arayla, tek seferde N paralel istek YOK) — WAF/rate-limit riskini azaltmak için.
- **Tetikleyiciler (owner kararı):** (a) periyodik `setInterval` (~45sn), (b) `document.visibilitychange`/`window focus` olayında ekstra bir tur — sekmeye dönünce hemen tazelenir.
- **Patch:** `row.querySelector('span[title]')` bulunup `title`/`textContent` güncellenir (bkz. yukarıdaki "Gerçek DOM yapısı"); `row.querySelector('div.rounded-full.h-2.w-2')` bulunup `data-kickflow-live="true|false"` attribute'u set edilir (renk bizim CSS'imizden gelir, Kick'in class'ı okunmaz/silinmez).
- **React-wipe'a karşı self-heal:** liste `<section>`'ı `MutationObserver({childList:true, subtree:true})` ile izlenir; Kick kendi re-render'ında bir satırı değiştirirse (patch'lediğimiz değer DOM'dan kaybolursa/resetlenirse), bir sonraki tick'te **son bilinen taze veriyle** otomatik yeniden patch'leriz. Bu native-bar.ts round 16'da kanıtlanmış "leading ensure + trailing check" desenin küçültülmüş hali.
- **Feature flag:** `showSidebarRefresh` (default `true`), mevcut 5 flag'le aynı popup/panel/storage deseni (`kf_flag_showSidebarRefresh`). Owner canlıda sorun görürse tek tıkla kapatabilir.
- **Hata toleransı:** bir satırın fetch'i 404/network-error olursa DOM'daki mevcut değeri OLDUĞU GİBİ bırak (boşaltma/"—" yazma yok), `logger.warn` ile logla, bir sonraki turda tekrar dene.
- **Lifecycle:** bootstrap sırasında ilk `a[data-testid^="sidebar-following-channel-"]` bulununca başlatılır (mevcut retry-until-present deseniyle, `whenElementPresent`); tab/extension teardown'da observer+interval temizlenir.

## Test planı
- Owner'ın verdiği gerçek HTML'e (yukarıdaki Jahrein örneği) dayanan sentetik jsdom fixture'ı (`tests/chat/sidebar-refresh.test.ts`).
- Kapsanacak senaryolar: slug çıkarma (`href` → slug), `title`+`textContent` patch, `data-kickflow-live` set/toggle, fetch-hata → eski değer korunur, fake-timer ile stagger zamanlaması, mutation sonrası yeniden-patch (self-heal), flag kapalıyken hiç fetch atmama, visibilitychange tetikleyicisi.
- **Canlı doğrulama yine owner'da** — WAF nedeniyle Claude/cx kick.com'u scriptli test edemiyor (bkz. `kickflow-kick-automation-waf-block`).

## Guardrail'ler
- Sadece görünür (DOM'da render edilmiş) satırlar patch'lenir — "Daha Fazla Göster" öncesi gizli satırlara istek atılmaz.
- Stagger + interval ile Kick API'sine yük bindirilmez.
- Self-heal reapply bir "savaş" döngüsüne dönmemeli — sadece mutation SONRASI tek seferlik yeniden-uygulama, sürekli zorlayıcı re-write yok (CPU/flicker riski).
- `bootstrap.ts` `ensureStyles()`'a eklenecek: `[data-kickflow-live="true"] { background: #22c55e !important; }` ve `[data-kickflow-live="false"] { background: #6b7280 !important; }` — Kick'in kendi `bg-green-500` class'ına dokunmadan, sadece bizim attribute'umuz üzerinden rengi biz yönetiyoruz.
