# Yerel sunucu dosyaları

Dükkândaki yerel sunucunun (C:\YerelSunucu\FincanlarERP) **sunucu dosyaları**. Ekranlar (`index.html`) ve arka plan kodu (`backend/*.gs`) bu klasörde DEĞİL, deponun kendi yerindedir; yerel sunucu üçünü de ayrı ayrı alır.

`src/` içindekiler yerel sunucuda `src\` klasörüne gider. `runtime.js` ve `senkron-istek.js` bu depoda yoktur, güncellemede dokunulmaz.

Güncelleme: yerel sunucuda Ayarlar > **Program Güncelleme (GitHub)** > Güncelle.
Sunucu hiç açılmazsa (kapalıyken): `node src\geri-al.js`
Veri yedeğinden geri dönüş: `node src\geri-yukle.js "<yedek dosyası>"`
