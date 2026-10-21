# Yerel sunucu: başlatma ve sorun giderme protokolü

Yerel sunucu (SATIS bilgisayarı, `C:\YerelSunucu\FincanlarERP`) `BASLAT.bat` ile açılır.
Bu belge, sunucunun kapalı bulunduğu durumlarda izlenecek adımları toplar.
(Not: Bu depo herkese açıktır; belgeye şifre, e-posta, IP gibi bilgiler yazılmaz.)

## 1. Sunucu nasıl çalışır

- Sunucu, `BASLAT.bat` içindeki siyah pencerede çalışır. Pencere kapanırsa sunucu da kapanır.
- `BASLAT.bat` içinde bir yeniden başlatma döngüsü vardır: sunucu çökerse 5 saniye sonra yeniden açılır.
  Program Güncelleme sırasında `node.exe` kapanınca sunucunun yeniden açılması da bu döngü sayesindedir.
- Döngü yalnızca pencere açıkken çalışır. Bilgisayar yeniden başlarsa ya da pencere kapatılırsa kendiliğinden başlamaz.

## 2. Otomatik başlatma (bilgisayar açılınca)

Kurulum, Windows'un Başlangıç klasörüne `BASLAT.bat` kısayolu koymaktır:

1. `Win + R` > `shell:startup` yazıp Enter.
2. Açılan klasörde sağ tık > Yeni > Kısayol.
3. Konum olarak `C:\YerelSunucu\FincanlarERP\BASLAT.bat` yazıp bitirin.
4. Açık siyah pencereyi kapatıp kısayola çift tıklayarak deneyin; `http://localhost:3000` açılmalı.

Sınırı: Başlangıç klasörü, kullanıcı oturumu açılınca çalışır. Bilgisayar yeniden başlayıp şifre ekranında
bekliyorsa sunucu başlamaz. Çözüm: şifresiz otomatik oturum açma ya da Görev Zamanlayıcı.

Doğrulama: bilgisayarı dükkân kapandıktan sonra yeniden başlatıp sunucunun kendiliğinden açıldığını görün.

## 3. Sunucu açılmıyorsa (sabah kontrolü)

1. SATIS bilgisayarında `C:\YerelSunucu\FincanlarERP` klasörünü açın.
2. Adres çubuğuna `cmd` yazıp Enter'a basın.
3. `node src\server.js` yazın.
   - Siyah pencerede hata varsa metnini kaydedin.
   - Hata yoksa "Bu bilgisayardan : http://localhost:3000" yazar ve sunucu açılır.
4. `localhost:3000` da açılmıyorsa sorun ağda değil sunucudadır.

## 4. Hata: `EADDRINUSE ... 0.0.0.0:3000`

Anlamı: 3000 numaralı portu başka bir sunucu zaten kullanıyor. Sunucu bozuk değildir; genellikle
aynı anda iki siyah pencere açıktır (örneğin elle açılan `node src\server.js` ve `BASLAT.bat`).

Çözüm:

1. Eski siyah pencereleri kapatın.
2. `BASLAT.bat` döngüsü en geç 5 saniyede sunucuyu yeniden açar. Açmazsa `BASLAT.bat` dosyasına çift tıklayın.
3. Pencereyi kapatmak sunucuyu durdurmazsa: Görev Yöneticisi (`Ctrl + Shift + Esc`) > `node.exe` > Görevi sonlandır.

Kural: Aynı anda tek sunucu penceresi açık olmalıdır.

## 5. Kapanma nedenini kaydetmek (isteğe bağlı)

`BASLAT.bat` içinde şu satır:

```
"%NODE%" src\server.js
```

şununla değiştirilirse çıktılar pencere yerine `sunucu-kayit.log` dosyasına yazılır:

```
"%NODE%" src\server.js >> sunucu-kayit.log 2>&1
```

Sunucu yine kapanırsa nedeni dosyanın son satırlarından anlaşılır. Pencerede çıktı görmek isteniyorsa bu değişiklik yapılmaz.

## 6. Dosyayı silinmeye karşı korumak

Windows'ta dosyaya silme şifresi konulamaz. Yapılabilecekler:

- Salt okunur + gizli yapmak: klasörde `cmd` açıp `attrib +r +h BASLAT.bat`. Geri almak için `attrib -r -h BASLAT.bat`.
- `BASLAT.bat` ve Başlangıç klasöründeki kısayolun yedeğini harici diskte tutmak.
- Asıl önemli olan `FincanlarERP` klasörü ve `veri.json` dosyasıdır; harici disk yedeği ve 5 dakikalık bulut yedeği bunlar içindir.

Dosya silinse de çalışan sunucu durmaz; etkisi bilgisayar yeniden başlayınca görülür.

## 7. "Bağlantı hatası" (program açılmıyor ya da işlem sırasında hata veriyor)

Önce hatanın hangi bilgisayarda çıktığını ayırın. İlk soru her zaman şudur: **SATIS'ta `http://localhost:3000` açılıyor mu?**

### A) SATIS'ta da açılmıyor: sunucu çalışmıyor

1. Siyah pencere (`BASLAT.bat`) açık mı? Kapalıysa `BASLAT.bat` kısayoluna çift tıklayın.
2. Pencere açıksa içindeki son hata satırını kaydedin (`EADDRINUSE` ise bölüm 4).
3. Bilgisayar yeniden başlamışsa Başlangıç kısayolu kurulu mu bakın (bölüm 2).

### B) SATIS'ta açılıyor, diğer bilgisayarda açılmıyor: sorun ağda

Sunucu sağlam. Sırayla kontrol edin:

1. **Adres:** diğer bilgisayarda `http://<SATIS adresi>:3000` yazılmalı. `https` değil `http` olmalı, `:3000` unutulmamalı.
2. **Aynı ağ:** iki bilgisayar aynı modeme bağlı olmalı (kablo ya da Wi-Fi). Başka bir ağdan (mobil veri, misafir Wi-Fi) ulaşılmaz.
3. **SATIS açık mı:** bilgisayar uyku modunda ya da kapalıysa ulaşılmaz. Güç ayarlarında uyku "Hiçbir zaman" olmalı.
4. **SATIS'ın adresi değişmiş olabilir:** SATIS'ta `cmd` açıp `ipconfig` yazın, "IPv4 Adresi" satırına bakın. Modemde SATIS için ayrılan sabit adres (Ev Ağı > Statik DHCP) duruyorsa adres aynı kalır. Değiştiyse rezervasyonu yeniden yapın.
5. **Ağ erişimi testi:** diğer bilgisayarda `cmd` açıp `ping <SATIS adresi>` yazın. Yanıt gelmiyorsa kablo/Wi-Fi ya da modem sorunudur. Yanıt geliyor ama sayfa açılmıyorsa güvenlik duvarı (aşağıdaki madde) bakılır.
6. **Güvenlik duvarı:** SATIS'ta Windows Güvenlik Duvarı, Node.js'in özel ağda gelen bağlantılarına izin vermeli. Ağ profili "Genel" ise "Özel" yapılabilir.

### C) Program açık ama işlem sırasında "bağlantı hatası" çıkıyor

1. Sayfayı yenileyin (`F5`). Hata geçiyorsa bağlantı anlık kopmuştur.
2. Hata sürüyorsa A ve B maddelerini sırayla uygulayın. SATIS'ta siyah pencere kapanmış olabilir.
3. Sunucu çalışıyor ama internet yoksa yerel çalışma devam eder. Yalnızca internet isteyen işler (Drive'a bulut yedeği, e-Fatura/e-Arşiv gönderimi, uyarı e-postası) yapılamaz. Ekranda kırmızı uyarı bandı çıkabilir (3 ardışık bulut yedeği başarısız olunca). İnternet gelince kendiliğinden devam eder; gelmezse modemi kontrol edin.
4. Bulut sürümü yerelin salt okunur aynasıdır. Bulutta kayıt yazılamaması hata değildir; yazma yalnızca yerel sunucudan yapılır.

### Bana bilgi verirken

Sorunu iletirken şunları yazın: hangi bilgisayar, hata metni (ekran görüntüsü ya da yazı), SATIS'ta `localhost:3000` açılıyor mu, siyah pencerede son satırlar ne diyor, ne zaman başladı (yeniden başlatma/elektrik kesintisi sonrası mı).
