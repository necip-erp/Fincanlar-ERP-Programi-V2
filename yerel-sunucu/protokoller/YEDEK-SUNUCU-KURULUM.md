# Yedek bilgisayarda hızlı kurulum (SATIS bozulursa)

SATIS bilgisayarı açılmaz/bozulursa yerel sunucuyu aynı ağdaki başka bir bilgisayarda
**tek dosyayla** (`YEDEK-KUR.bat`) ayağa kaldırmak için. Bu belge hem hazırlığı (bir kez, sakin günde)
hem de sorun anındaki adımları anlatır.
(Not: Bu depo herkese açıktır; belgeye parola, anahtar, e-posta, IP yazılmaz.)

## 1. Ne var, nerede durur

| Parça | İçerik | Nerede |
|---|---|---|
| **Paket** (`HIZLI-KURULUM`) | sunucu kodu, taşınabilir node, kurulum betiği, şifreli anahtarlar, son veri kopyası | **Flash**: `FincanlarERP-Yedek\HIZLI-KURULUM` |
| **Paket ZIP'i** | aynı paket (veri hariç) tek dosya | **Drive** (kendi hesabınız): `FincanlarERP-HizliKurulum.zip` |
| **Şifreli anahtarlar** | bulut yedek anahtarı + varsa EDM bilgileri; parolasız açılmaz | Flash'ta, ZIP'in içinde ve **farklı bir mail hesabında** (`anahtarlar.sifreli`) |
| **Parola** | anahtar dosyasının parolası | **Yalnız sizde** (evde kâğıtta). Flash'ın/mailin yanında durmaz |
| **Veri** | en yeni veri yedeği | Drive `Yerel Sunucu` klasörü (5 dakikada bir) ve flash (`veri-....json`, günde 1-2 kez) |

Neden iki ayrı parça: kod ve veri her gün değişir, anahtarlar değişmez. Anahtar yalnızca şifreli dosyada durduğu için
flash kaybolsa bile başkasının eline geçse de açılmaz.

GitHub tek başına yetmez: sunucunun bazı dosyaları (`runtime.js` vb.) bu depoda yoktur. Bu yüzden kod, paketin içinde
(flash ve Drive ZIP'i) saklanır.

## 2. Hazırlık (bir kez, sakin günde)

1. `FincanlarERP-YedekKurulum.zip` dosyasını SATIS'ta `C:\YerelSunucu\FincanlarERP\` içine açın. Sonuç: `C:\YerelSunucu\FincanlarERP\yedek-kurulum\`.
2. Flash'ı takın. `yedek-kurulum\PAKET-HAZIRLA.bat` dosyasına çift tıklayın (sunucu çalışırken yapılabilir, sunucuya dokunmaz).
3. Sorulanlar:
   - Hangi flash: numarasını yazın.
   - **Parola**: en az 8 karakter, iki kez. Ekranda görünmez. Bunu **siz** belirlersiniz.
   - Kopyaların konacağı klasör (varsayılan Masaüstü'nde `FincanlarERP-Yedek-Kopya`).
   - ZIP hazırlansın mı: Evet (öneri).
4. Çıkan kopya klasöründeki:
   - `anahtarlar.sifreli` dosyasını **farklı bir mail hesabına** ek olarak gönderin. Parolayı mailde yazmayın.
   - `FincanlarERP-HizliKurulum.zip` dosyasını Drive'a yükleyin.
5. Parolayı kâğıda yazıp güvenli bir yerde saklayın. Kaybolursa dosya açılmaz (bkz. bölüm 6).

**Ne zaman yenilenir:** büyük güncellemelerden sonra `PAKET-HAZIRLA.bat` yeniden çalıştırılır (parola aynı kalabilir).
Aksi halde kurulumda flash'taki düzenli kod kopyası (`FincanlarERP-Yedek\KOD`, günde 1-2 kez yenilenir) otomatik olarak seçilir
ve kurulumdan sonra sunucudaki **Program Güncelleme (GitHub)** düğmesiyle son sürüme geçilir.

## 3. Sorun anı: sırayla

1. **SATIS gerçekten kapalı mı?** Kapatın ya da fişini çekin. Aynı anda iki sunucu çalışırsa veri ikiye ayrılır.
   (Kurulum betiği SATIS cevap veriyorsa durdurur ve onay ister.)
2. Yedek olarak kullanacağınız bilgisayarı seçin (aynı modem/ağ, Windows).
3. **Flash varsa:** takın, `FincanlarERP-Yedek\HIZLI-KURULUM\YEDEK-KUR.bat` dosyasına çift tıklayın. Yönetici izni sorarsa "Evet".
   **Flash yoksa:** Drive'dan `FincanlarERP-HizliKurulum.zip` indirip bir klasöre açın (sağ tık > Özellikler > "Engellemeyi kaldır"
   işaretlenebilir; Windows uyarı verirse "Yine de çalıştır"). Drive'daki `Yerel Sunucu` klasöründen **en yeni** `yerel-veri-....json.gz`
   dosyasını indirin (parçalıysa `.001`, `.002` ... hepsini aynı klasöre; İndirilenler klasörü yeterli). Sonra `YEDEK-KUR.bat`.
4. Ekrandaki 7 adımı izleyin:
   1. **SATIS kontrolü**: otomatik.
   2. **Kod**: öneri en yeni olandır; Enter.
   3. **Anahtarlar**: parolayı yazın. Paket yoksa mail kopyasının yolunu yazın. Parola yoksa bölüm 6.
   4. **Veri**: liste en yeni üstte gelir; öneri 1. numaradır (Enter). Drive yedeği genellikle en yenidir; flash yalnızca internet
      yokken ya da daha yeniyse öne geçer. Ekranda yedeğin saati ve kayıt sayısı görünür; **aradaki işlemlerin kaybolmaması için
      en yeniyi seçin**. `[PARÇA EKSİK]` yazanlar seçilemez.
   5. **Ağ**: "1" seçerseniz bu bilgisayara SATIS'ın eski adresi verilir. Diğer bilgisayarlarda hiçbir şey değişmez (öneri).
      "2" seçerseniz yeni adres ekranda yazılır, onu diğer bilgisayarlarda açarsınız. Güvenlik duvarı izni, "özel ağ" ayarı ve
      uyku kapatma da burada otomatik yapılır.
   6. **Otomatik başlatma**: bilgisayar açılınca sunucu kendiliğinden başlar.
   7. **Başlatma**: sunucu açılır, ekranda adres yazar.
5. Diğer bilgisayarlarda yazan adresi açın (`http://...:3000`, `https` değil). Birkaç kaydı kontrol edin.
6. Ayarlar > Yedekleme'de bulut yedeğinin gittiğini görün (anahtar yüklendiyse kırmızı bant çıkmaz).
7. Kurulum kaydı: `C:\YerelSunucu\FincanlarERP\KURULUM-KAYIT.txt` (hangi kod, hangi veri, hangi adres).

Toplam süre: kurulum dosyası açıldıktan sonra birkaç dakika (veri büyüklüğüne bağlı).

## 4. SATIS düzelince: geri dönüş (veri kaybı olmasın)

Yedek sunucuda çalışılan günlerin kayıtları **yalnızca yedek sunucudadır**. SATIS'ın eski verisiyle açılmaz.

1. Yedek bilgisayarda `DURDUR.bat` ile sunucuyu durdurun (herkes çıkış yapsın). Ayarlar > Yedekleme > "Şimdi yedekle" ile son hali
   buluta gönderin (sunucu kapanmadan).
2. Yedek bilgisayardaki `C:\YerelSunucu\FincanlarERP\veri\veri.json` dosyasını flash'a kopyalayın (ya da Drive'daki en yeni yedeği kullanın).
3. SATIS'ta sunucu kapalıyken: eski `veri\veri.json` adını `veri-eski.json` yapın, yedek bilgisayardan gelen `veri.json` dosyasını
   `veri` klasörüne koyun (ya da `node src\geri-yukle.js "<yedek dosyası>"` ile yükleyin; ayrıntısı README'de).
4. SATIS'ta `BASLAT-GIZLI.vbs` ile sunucuyu açın, kayıtları kontrol edin.
5. Yedek bilgisayarda:
   - `IP-GERI-AL.bat` (varsa; yönetici olarak) çalıştırın, IP otomatiğe dönsün. (SATIS aynı adresi alacak.)
   - Başlangıç klasöründeki (`shell:startup`) `Fincanlar ERP Sunucu` kısayolunu silin.
   - `C:\YerelSunucu\FincanlarERP` klasörünü silmeyin; bir süre yedek olarak kalsın.
6. Yeni anahtar kaydolmuşsa ya da SATIS'ta anahtar değiştiyse: bölüm 6.

## 5. Hızlı kontrol listesi (sorun anında, panik olmadan)

- [ ] SATIS kapalı / fişi çekili
- [ ] Yedek bilgisayar hazır, aynı ağda
- [ ] Flash takılı **ya da** Drive ZIP'i + en yeni veri yedeği indirildi
- [ ] Parola yanımda
- [ ] `YEDEK-KUR.bat` çalıştırıldı, veri olarak **en yeni** yedek seçildi
- [ ] Diğer bilgisayarlarda adres açıldı, birkaç kayıt görüldü

## 6. Parola / anahtar kaybolursa

Anahtar, bulutun bu sunucuyu tanıma şifresidir (bulutta yalnızca SHA-256 özeti tutulur). Yanlış/yeni anahtarla bulut "Anahtar uyuşmuyor"
der: Drive'a yedek gitmez, uyarı e-postası gelmez, e-Fatura/Resimden Oluştur ayarları yerele alınamaz.

Anahtarsız kurulum yine de çalışır (sunucu açılır, yerel işlem yapılır). Düzeltmek için bulutta bir kez:
Apps Script > Proje ayarları > Komut dosyası özellikleri içinde **`YEREL_YEDEK_ANAHTAR_OZET`** satırını silin. Yeni sunucunun anahtarı
bir sonraki yüklemede kaydolur. Sonra yeni sunucuda yeniden `PAKET-HAZIRLA.bat` çalıştırıp yeni anahtar dosyasını (ve yeni parolayı) saklayın.

## 7. Bilmeniz gerekenler

- Kurulum, bu bilgisayardaki eski `C:\YerelSunucu\FincanlarERP` klasörüne **dokunmaz**: varsa adını `...-eski-<tarih>` yapar.
- Veri bulunamazsa ya da seçilen yedek boş/bozuksa kurulum onu kabul etmez.
- Kurulum, BASLAT.bat'ın yeni bir kopyasını yazar (yeniden başlatma döngülü); eskisi `BASLAT-orijinal.bat` olarak kalır.
- Başlangıç kısayolu, kurulumu yapan Windows kullanıcısının Başlangıç klasörüne konur; bilgisayar şifre ekranında beklerken
  sunucu başlamaz (bkz. SUNUCU-BASLATMA.md bölüm 2).
- Yedek bilgisayar Windows 10/11 olmalı. Kurulum, taşınabilir node'u pakette getirir; ayrıca bir şey kurmanız gerekmez.
- Ağ (IP), güvenlik duvarı ve otomatik başlatma adımları Windows'a özeldir ve henüz gerçek bir yedek bilgisayarda denenmedi. İlk deneme
  dükkân kapandıktan sonra, SATIS KAPALIYKEN yapılmalıdır. Sorun çıkarsa `IP-GERI-AL.bat` ve bölüm 4'teki temizlik adımları geri alır.
