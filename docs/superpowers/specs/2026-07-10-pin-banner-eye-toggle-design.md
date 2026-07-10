# KickFlow — Pin Banner Göz (Minimize) Butonu (Design, 2026-07-10)

Owner: sabitlenmiş mesaj banner'ına, mevcut × (dismiss) butonunun yanına bir göz (👁) butonu eklensin. Göz açıkken banner tam görünür (mevcut davranış). Göz kapatılınca banner tamamen kaybolmaz — ince bir bar'a (navbar gibi) küçülür. × ile kapatma davranışı DEĞİŞMİYOR, ayrı bir eksen.

## Kapsam
- Tamamen KickFlow'un kendi DOM'u (`message-view.ts` `buildPinnedMessageElement` + `bootstrap.ts`'teki `PinnedMessageController`) — Kick'in React-owned ağacına dokunulmuyor, bu yüzden #418 sınıfı risk YOK.
- Mevcut `showPinnedMessage` flag'i ve `ActivePinnedMessageState`'in dismiss-by-id davranışı (round 21) DEĞİŞMİYOR.

## Davranış
- Banner header'ına × butonunun yanına yeni bir 👁 buton eklenir.
- **Göz açık (varsayılan):** mevcut tam banner (başlık + gönderen + rozet + içerik).
- **Göz kapalı (tıklanınca):** banner ince tek-satır bir bar'a küçülür — sadece 📌 ikon + mevcut amber accent rengi, **başka HİÇBİR eleman yok (× dahil değil)**. Bar'ın herhangi bir yerine tıklanınca göz tekrar açılır, tam banner geri gelir.
- **× (dismiss) sadece genişletilmiş halde erişilebilir (owner kararı, çelişki düzeltmesi 2026-07-10):** daralı bar'da × butonu YOK — bir pin'i tamamen kapatmak isteyen önce bara tıklayıp genişletir, sonra × ile kapatır. Genişletilmiş haldeyken × davranışı mevcut `ActivePinnedMessageState.dismiss` mantığıyla aynı, göz durumundan etkilenmez.
- **Yeni/farklı pin geldiğinde:** göz durumu her zaman "açık"a sıfırlanır (mevcut `setActive()`'in `dismissedPinId`'i sıfırlamasıyla aynı tetikleyici noktası) — owner kararı: her yeni pin tam banner olarak başlar.
- **Kalıcılık yok:** göz durumu `chrome.storage`'a yazılmaz, sadece o pin'in ömrü boyunca geçerli oturum-içi UI state'i (diğer `showXxx` toggle'larından farklı — onlar özelliği tamamen açıp kapatıyor, bu sadece görünüm modu).

## Mimari
- `message-store.ts`: `ActivePinnedMessageState`'e `collapsed: boolean` alanı eklenir (private state, `setActive()` çağrıldığında `false`'a resetlenir — `dismissedPinId` resetiyle aynı satırda). Yeni metotlar: `toggleCollapsed(): void`, `isCollapsed(): boolean`.
- `message-view.ts` `buildPinnedMessageElement`: 👁 buton eklenir (× ile aynı header'da); `collapsed` durumuna göre ya tam banner ya ince-bar render edilir (iki ayrı DOM dalı, tek fonksiyon içinde dallanma — mevcut fonksiyonun genişletilmesi, yeni bir dosya gerekmez).
- `bootstrap.ts` `PinnedMessageController`'daki `refresh()` fonksiyonu `collapsed` durumunu da hesaba katacak şekilde güncellenir (mevcut `state.getVisible()` çağrısının yanına `state.isCollapsed()` okuması eklenir).

## Test planı (tamamen jsdom'da test edilebilir, engelleyici yok)
- 👁 tıklanınca ince-bar'a geçiyor, tekrar tıklanınca tam banner'a dönüyor.
- İnce-bar'ın herhangi bir noktasına tıklamak da açıyor (sadece göz ikonuna tıklamak zorunlu değil).
- İnce-bar modunda × butonu DOM'da yok (render edilmiyor) — sadece genişletilmiş halde × mevcut ve çalışıyor.
- Yeni farklı pin id geldiğinde collapsed her zaman false'a dönüyor (önceki pin collapsed=true bırakılmış olsa bile).
- Aynı pin id tekrar gelirse (`setActive` false dönen durum) collapsed state korunuyor (resetlenmiyor) — sadece GERÇEKTEN yeni pin resetler.

## Guardrail'ler
- İnce-bar modunda da erişilebilirlik: buton/tıklanabilir alan yeterince büyük, tooltip ("genişlet"/"daralt") eklenir.
- Mevcut safe-render kuralı korunur: hiçbir yeni innerHTML kullanımı yok, tüm içerik `textContent`/mevcut `appendParsedContent` ile.
