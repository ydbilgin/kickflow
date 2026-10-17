# KickFlow

I built KickFlow to keep chat context readable and put useful playback controls next to Kick's player. It is a Chrome Manifest V3 extension with English and Turkish interfaces.

![KickFlow chat and player controls](docs/media/overview.png)

The screenshots and animation below come from offline Chromium fixtures using the real chat renderer, player modules, and styles. All identities, messages, and video-clock values are synthetic. They show component behavior; they do not prove compatibility with the current live site.

## What I included

- **Chat context:** keep messages seen during the session readable after deletion, bans, or timeouts, with moderation labels when that information is available. Choose native chat augmentation or KickFlow's own chat list.
- **Readable events:** subscriptions, gifted subscriptions with expandable recipient lists, Kicks gifts, hosts, raids, and chat-mode changes. Native pins and polls stay with Kick.
- **Finding messages:** search the current session, inspect a person's session messages, and follow reply previews back to messages still in the rendered list. Mention, reply, moderator, and VIP highlights have separate controls.
- **Player controls:** seek backward and forward by 10 seconds within available DVR bounds, return toward live, catch up automatically, choose playback speed, select the highest available quality, and save the decoded video frame as a PNG. Optional theater mode and a caption preference guard are included.
- **Settings:** a shared dashboard and popup, EN/TR language selection, feature switches, and configurable shortcuts. Defaults include Left/Right for seeking, S for frame capture, and L for live. Typing in chat or an editable field suppresses these player shortcuts.
- **Optional page actions:** switches for clicking native claim controls for eligible on-page rewards. Both are off by default; a click does not establish that a reward was credited.

![Preserved chat context, mentions, and replies](docs/media/chat-context.png)

![Expanded gifted-subscription recipients](docs/media/chat-gifts.png)

![Playback-speed menu in the offline player fixture](docs/media/player-speed.png)

![Chat expansion, rewind, and playback menu demonstration](docs/media/chat-and-player.gif)

## Install with Load unpacked

I include the built `dist/` files in this repository so the prepared folder can be loaded directly.

1. Download or clone this repository and extract it if necessary.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Select **Load unpacked** and choose the folder containing `manifest.json`, `popup.html`, and `dist/`.
4. Open a Kick channel page. Use the KickFlow popup or the settings entry on the page to configure it.

After replacing the files, select **Reload** on the extension card and refresh open channel tabs. I have not published KickFlow on the Chrome Web Store.

To rebuild from source with Node.js and npm:

```sh
npm ci
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node build.mjs
```

Then reload the extension and refresh the channel tab.

## Permissions

| Access | Why I use it |
| --- | --- |
| `storage` | Save feature preferences, language, shortcut bindings, highlight colors, a manual username if supplied, and the catch-up preference in local extension storage. |
| `activeTab` | Read the active tab when the popup is opened and communicate with its KickFlow content script for status and settings. |
| Content-script match `https://kick.com/*` | Read and augment Kick chat and the player. Two small scripts run in the page's MAIN world to observe native chat publications and message keys; the main content script runs in the isolated extension world. |

The manifest requests no background worker, optional permissions, or separate host permissions. The content-script match still grants access to matching Kick pages.

## Privacy

I include no telemetry, analytics, advertising, or remote collection service. Chat messages, moderation evidence, and the searchable archive stay in memory for the channel session. The archive is bounded to 30,000 messages, three hours of retention, and 500 messages per person; results display up to 100 matches. This is not a permanent chat backup.

Preferences are saved through `chrome.storage.local`. The caption guard also changes Kick's caption preference in the site's local storage. The layout watchdog can keep a bounded local diagnostic record of the page URL, timestamp, layout measurements, and element geometry in site local storage; it is not uploaded. Saved screenshots go to the browser's download destination. Removing the extension clears its extension storage; site local storage is managed separately through Chrome's site-data controls.

During normal use, KickFlow reads Kick channel, profile, history, and video data, loads approved chat image assets, and observes native chat events. A legacy chat fallback can connect to Kick's public Pusher service. These requests go to site services from the browser; “no telemetry” does not mean “no network requests.” The promotional fixtures use no live account or Kick traffic.

## Limits

I provide KickFlow as-is and am not affiliated with or endorsed by Kick. Changes to Kick's page layout, event formats, or APIs can break features. The offline checks and fixture media do not establish live-site acceptance for this package.

- I can preserve only messages the extension has received; earlier or unavailable messages cannot be recovered reliably.
- The native page-event bridge is not authenticated against other scripts on the same page. Chat and moderation labels are local context, not authoritative moderation records.
- DVR seeking depends on the stream's buffer. Quality selection cannot unlock gated options. Frame capture can fail when the browser prevents reading the video frame.
- KickFlow's own chat view does not replace every native interaction; starting a native reply and some moderation actions may require native chat.
- The sidebar remains Kick's native sidebar. No channel refresh or permanent archive is promised.

## Licence

I publish KickFlow under the [MIT License](LICENSE). Copyright (c) 2026 Yasin Derya Bilgin. Dependency licences remain their respective authors' terms.

---

## Türkçe

KickFlow'u sohbet bağlamını okunabilir tutmak ve Kick oynatıcısına kullanışlı kontroller eklemek için geliştirdim. Chrome Manifest V3 eklentisidir; İngilizce ve Türkçe arayüz sunar.

### Özellikler

- Oturum sırasında görülen silinmiş, yasaklanmış veya zaman aşımı uygulanmış mesajları, bilgi mevcutsa moderasyon etiketiyle korurum. Yerel sohbeti geliştiren görünüm ve KickFlow'un kendi sohbet listesi arasında seçim yapılabilir.
- Abonelikleri, hediye abonelikleri, Kicks hediyelerini, host/raid ve sohbet modu değişikliklerini okunabilir satırlarda gösteririm. Hediye alıcılarının listesi genişletilebilir.
- Oturum içi arama, kişiye ait oturum mesajları, yanıt önizlemeleri ve ayrı ayrı ayarlanabilen bahsetme, yanıt, moderatör ve VIP vurguları sunarım.
- Oynatıcıya 10 saniye geri/ileri, canlıya dönüş, otomatik yetişme, hız seçimi, mevcut en yüksek kalite ve PNG kare kaydı eklerim. Tiyatro modu isteğe bağlıdır; altyazı tercihi koruması ayarlanabilir.
- Ayarlar paneli ve açılır pencerede dil, özellikler ve kısayollar değiştirilebilir. Varsayılan oynatıcı kısayolları Sol/Sağ, S ve L'dir; yazı alanlarında devreye girmezler.
- Sayfadaki uygun ödüllerin yerel alma düğmelerine tıklayan iki isteğe bağlı ayar vardır. İkisi de varsayılan olarak kapalıdır; tıklama, ödülün hesaba işlendiğinin kanıtı değildir.

Yukarıdaki dört ekran görüntüsünü ve kısa GIF'i Chromium'da çevrimdışı test sayfalarından oluşturdum. Gerçek sohbet ve oynatıcı bileşenlerini kullanırlar; isimler, mesajlar ve video saati yapaydır. Güncel canlı site uyumluluğunu kanıtlamazlar.

### Kurulum

1. Depoyu indirin veya klonlayın; arşivse çıkarın.
2. Chrome'da `chrome://extensions` sayfasını açıp **Geliştirici modu**nu etkinleştirin.
3. **Paketlenmemiş öğe yükle** ile `manifest.json`, `popup.html` ve `dist/` içeren klasörü seçin. Hazır derlenmiş dosyaları ekledim.
4. Bir Kick kanalını açın ve KickFlow ayarlarını yapılandırın. Güncellemeden sonra eklentiyi yeniden yükleyip kanal sekmesini yenileyin.

Chrome Web Mağazası'nda yayımlamadım. Kaynaktan derlemek için yukarıdaki Node.js/npm komutları kullanılabilir.

### İzinler ve gizlilik

`storage` iznini dil, özellikler, renkler, kısayollar, girilmişse kullanıcı adı ve yetişme tercihini yerel olarak saklamak için kullanırım. `activeTab`, açılır pencerenin etkin sekmedeki durum ve ayarlarla iletişim kurmasını sağlar. `https://kick.com/*` içerik betiği eşleşmesi, Kick sayfalarında sohbet ve oynatıcıya erişim sağlar. Manifest ayrı ana makine izni, arka plan çalışanı veya isteğe bağlı izin istemez; içerik betiği eşleşmesi yine de Kick sayfalarına erişim verir.

Telemetri, analiz veya uzaktan veri toplama servisi eklemedim. Sohbet ve moderasyon verileri kanal oturumu boyunca bellekte kalır. Arşiv sınırları 30.000 mesaj, üç saat ve kişi başına 500 mesajdır; aramada en fazla 100 sonuç gösterilir. Tercihler `chrome.storage.local` içinde saklanır. Altyazı koruması sitenin yerel altyazı tercihini değiştirir; düzen izleyicisi de sayfa adresi, zaman damgası ve geometri içeren sınırlı yerel tanılama kaydı tutabilir. Bu kayıt yüklenmez. PNG dosyaları tarayıcının indirme konumuna kaydedilir. Eklentiyi kaldırmak eklenti depolamasını temizler; site verileri ayrıca yönetilir.

Normal kullanımda kanal, profil, geçmiş, video ve sohbet görselleri için Kick servislerine tarayıcıdan istek yapılabilir; eski sohbet bağlantısı gerektiğinde Kick'in herkese açık Pusher servisine bağlanabilir. Telemetri olmaması, ağ isteği olmaması anlamına gelmez.

### Sınırlar ve lisans

Kick ile bağlantılı veya Kick tarafından onaylanmış değilim. Site değişiklikleri özellikleri bozabilir. Görülmemiş mesajları kurtarmayı, kalıcı arşivi veya test edilmemiş canlı site uyumluluğunu vaat etmiyorum. Sayfa olay köprüsü aynı sayfadaki diğer betiklere karşı kimlik doğrulamaz; etiketler yetkili moderasyon kaydı sayılmaz. Geri sarma mevcut arabelleğe bağlıdır; kalite seçimi erişim kısıtlarını aşmaz, kare kaydı tarayıcı kısıtlarında çalışmayabilir. Kendi sohbet görünümümde bazı yerel yanıt ve moderasyon işlemleri için yerel sohbete dönmek gerekebilir. Kenar çubuğunu Kick yönetir.

KickFlow'u [MIT Lisansı](LICENSE) ile yayımlıyorum. Copyright (c) 2026 Yasin Derya Bilgin. Bağımlılıkların kendi lisans koşulları geçerlidir.
