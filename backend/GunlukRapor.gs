// ════════════════════════════════════════════════════════════════════════════
// GÜNLÜK İŞLEM RAPORU — Belirli bir gün için TÜM modüllerde YAPILAN işlemleri
// (işlemin kendi tarihine değil, sisteme GİRİLDİĞİ KAYIT ZAMANINA göre) tek bir
// Excel dosyasında, her modül ayrı sekmede toplayan bir nevi günlük yedekleme.
//
// Her kaynak (Satış, Alış, Tahsilat, ...) İKİ sekme üretir:
//   - "<Modül Adı>"        : okunaklı, sadeleştirilmiş DETAY tablosu (ekranda okumak için)
//   - "HAM - <Modül Adı>"  : kaynak Google E-Tablosu sayfasının O SATIRLARDAKİ TÜM sütunlarını
//                            (gerçek sütun adları + gerçek ID'lerle) birebir içeren HAM YEDEK —
//                            bir saldırı/veri kaybı halinde ilgili sayfaya satır satır geri
//                            yapıştırılarak SİSTEME ENTEGRE EDİLEBİLİR.
// Satış/Alış ayrıca KALEM KALEM (ürün satırı satırı) detay+ham çiftine de sahiptir
// ("Satış Kalemleri (Detay)" / "Alış Kalemleri (Detay)" ve HAM eşleri) — o gün girilen her
// satış/alışın içindeki tüm ürün satırları tek tek listelenir.
//
// Nasıl çalışır: Ayarlar ekranındaki "📊 Günlük İşlem Raporu" butonuyla
// (gunlukIslemRaporuUret action'ı) istenildiğinde üretilir; ayrıca
// gunlukRaporTetikleyiciKur() (Apps Script editöründen elle, TEK SEFERLİK
// çalıştırılır — otomatikYedekAl'daki yedekTetikleyiciKur ile aynı desen) her
// gün belirlenen saatte otomatik de üretir; bu otomatik olan zaten var olan
// düzenli yedeklemenin YANINDA ek bir emniyet sibobudur.
//
// Çıktı ÜÇ yere birden gider:
//   1) Drive'da "Fincanlar ERP - Günlük İşlem Raporları" klasörüne .xlsx olarak
//   2) GUNLUK_RAPOR_EPOSTA script özelliğinde tanımlı adres(ler)e e-posta eki
//   3) (sadece buton ile üretildiğinde) tarayıcıya indirilmek üzere base64
// ════════════════════════════════════════════════════════════════════════════

var GUNLUK_RAPOR_KLASOR_ADI = "Fincanlar ERP - Günlük İşlem Raporları";

// Her kaynak: hangi sayfadan okunacak, o sayfanın TÜM başlıkları (index'leri
// doğru hesaplayabilmek için), hangi index'in "sisteme girildiği an" olduğu
// (KAYIT_TARIHI, dd/MM/yyyy HH:mm formatında) ve rapora hangi kolonların hangi
// Türkçe başlıkla yazılacağı (goster: [{k:"TARIH", ad:"Tarih"}, ...]).
function grKaynaklar_() {
  return [
    { anahtar: "satislar", ad: "Satış (Sipariş-Teklif-Fatura)",
      headers: ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"],
      kayitKolon: "KAYIT_TARIHI",
      goster: [["BELGE_TIPI","Belge Tipi"],["TARIH","Tarih"],["CARI_AD","Cari"],["TOPLAM_TUTAR","Tutar"],["ODEME_TIPI","Ödeme Tipi"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "alislar", ad: "Alış (Sipariş-Teklif-Fatura)",
      headers: ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"],
      kayitKolon: "KAYIT_TARIHI",
      goster: [["TARIH","Tarih"],["CARI_AD","Cari"],["TOPLAM_TUTAR","Tutar"],["ODEME_TIPI","Ödeme Tipi"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "tahsilatlar", ad: "Tahsilatlar",
      headers: ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"],
      kayitKolon: "KAYIT_TARIHI",
      goster: [["TARIH","Tarih"],["CARI_AD","Cari"],["TUTAR","Tutar"],["YONTEM","Yöntem"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "odemeler", ad: "Ödemeler",
      headers: ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"],
      kayitKolon: "KAYIT_TARIHI",
      goster: [["TARIH","Tarih"],["CARI_AD","Cari"],["TUTAR","Tutar"],["YONTEM","Yöntem"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "cariVirmanlar", ad: "Cari Virmanlar",
      headers: CARI_VIRMAN_BASLIKLAR,
      kayitKolon: "KAYIT_TARIHI",
      goster: [["TARIH","Tarih"],["KAYNAK_CARI_AD","Kaynak Cari"],["HEDEF_CARI_AD","Hedef Cari"],["TUTAR","Tutar"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "cariHareketler", ad: "Cari Hareketleri (Detay)",
      headers: ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"],
      kayitKolon: "KAYIT_TARIHI", cariKolon: "CARI_ID",
      goster: [["TARIH","Tarih"],["_CARI_AD","Cari"],["TIP","Tip"],["TUTAR","Tutar"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "bankaHesapHareketleri", ad: "Banka Hesap Hareketleri (Detay)",
      headers: BANKA_HESAP_HAREKET_BASLIKLAR,
      kayitKolon: "KAYIT_TARIHI", bankaHesapKolon: "BANKA_HESAP_ID",
      goster: [["TARIH","Tarih"],["_HESAP_AD","Banka/Hesap"],["TIP","Tip"],["TUTAR","Tutar"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "posHareketleri", ad: "POS Hareketleri (Detay)",
      headers: POS_HAREKET_BASLIKLAR,
      kayitKolon: "KAYIT_TARIHI", posKolon: "POS_HESAP_ID",
      goster: [["TARIH","Tarih"],["_POS_AD","POS"],["TIP","Tip"],["TUTAR","Tutar"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "krediKartHareketleri", ad: "Kredi Kartı Hareketleri (Detay)",
      headers: KREDI_KART_HAREKET_BASLIKLAR,
      kayitKolon: "KAYIT_TARIHI", kartKolon: "KREDI_KART_ID",
      goster: [["TARIH","Tarih"],["_KART_AD","Kredi Kartı"],["TIP","Tip"],["TUTAR","Tutar"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
    { anahtar: "stokHareketleri", ad: "Stok Hareketleri (Detay)",
      headers: STOK_HAREKET_BASLIKLAR,
      kayitKolon: "KAYIT_TARIHI",
      goster: [["TARIH","Tarih"],["STOK_KODU","Stok Kodu"],["STOK_ADI","Stok Adı"],["HAREKET_TIPI","Hareket"],["MIKTAR","Miktar"],["BIRIM","Birim"],["BELGE_TIPI","Belge Tipi"],["BELGE_NO","Belge No"],["ACIKLAMA","Açıklama"],["KAYIT_TARIHI","Girildiği Saat"]] },
  ];
}

// Satış/Alış'ın KENDİSİ değil, o gün girilen satış/alışların TEK TEK KALEMLERİNİ (ürün
// satırlarını) listeleyen kaynaklar. Kalem sayfalarının kendi KAYIT_TARIHI'i yok — bu yüzden
// gün filtresi, o gün kayıtlı satislar/alislar ID'lerine (grKaynaklar_ işlenirken toplanır)
// göre yapılır (ebeveynIdKolon o ID'yi kalem satırında tutan sütun).
function grKalemKaynaklari_() {
  return [
    { anahtar: "satisKalemleri", ad: "Satış Kalemleri (Detay)", ebeveynAnahtar: "satislar", ebeveynIdKolon: "SATIS_ID",
      headers: ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"],
      goster: [["STOK_KODU","Stok Kodu"],["URUN_ADI","Ürün Adı"],["MIKTAR","Miktar"],["BIRIM","Birim"],["BIRIM_FIYAT","Birim Fiyat"],["ISKONTO_YUZDE","İskonto %"],["KDV_ORANI","KDV %"],["TUTAR","Tutar"],["SATIS_ID","Bağlı Satış ID"]] },
    { anahtar: "alisKalemleri", ad: "Alış Kalemleri (Detay)", ebeveynAnahtar: "alislar", ebeveynIdKolon: "ALIS_ID",
      headers: ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"],
      goster: [["STOK_KODU","Stok Kodu"],["URUN_ADI","Ürün Adı"],["MIKTAR","Miktar"],["BIRIM","Birim"],["BIRIM_FIYAT","Birim Fiyat"],["TUTAR","Tutar"],["ALIS_ID","Bağlı Alış ID"]] },
  ];
}

// "10/09/2026 14:32" veya Date nesnesi ya da "2026-09-25..." -> "yyyy-MM-dd" karşılaştırma anahtarı.
function grGunAnahtari_(deger) {
  if (deger instanceof Date) return Utilities.formatDate(deger, "Europe/Istanbul", "yyyy-MM-dd");
  const s = String(deger || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return "";
}

// Cari/Banka Hesabı/POS/Kredi Kartı ID'lerini okunaklı isme çeviren haritaları
// TEK SEFERDE kurar (her satır için tekrar tekrar sayfa okumamak için).
function grHaritalarOlustur_(ss) {
  const cariAd = {};
  try {
    const d = ss.getSheetByName(SHEETS.cariHesaplar).getDataRange().getValues();
    for (let i = 1; i < d.length; i++) cariAd[String(d[i][0])] = String(d[i][2] || "");
  } catch (e) { /* sayfa yoksa boş harita ile devam */ }

  const bankaAd = {};
  try {
    const d = ss.getSheetByName(SHEETS.bankalar).getDataRange().getValues();
    for (let i = 1; i < d.length; i++) bankaAd[String(d[i][0])] = String(d[i][1] || "");
  } catch (e) { /* yoksay */ }

  const bankaHesapAd = {};
  try {
    const d = ss.getSheetByName(SHEETS.bankaHesaplari).getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      const banka = bankaAd[String(d[i][1])] || "";
      bankaHesapAd[String(d[i][0])] = (banka ? banka + " — " : "") + String(d[i][2] || "");
    }
  } catch (e) { /* yoksay */ }

  const posAd = {};
  try {
    const d = ss.getSheetByName(SHEETS.posCihazlari).getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      const banka = bankaAd[String(d[i][1])] || "";
      posAd[String(d[i][0])] = String(d[i][2] || "") + (banka ? " — " + banka : "");
    }
  } catch (e) { /* yoksay */ }

  const kartAd = {};
  try {
    const d = ss.getSheetByName(SHEETS.krediKartlari).getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      const banka = bankaAd[String(d[i][1])] || "";
      kartAd[String(d[i][0])] = String(d[i][2] || "") + (banka ? " — " + banka : "");
    }
  } catch (e) { /* yoksay */ }

  return { cariAd: cariAd, bankaHesapAd: bankaHesapAd, posAd: posAd, kartAd: kartAd };
}

// Bir kaynağı okuyup gunAnahtari'na eşleşen satırları [ [Türkçe başlık,...], [değerler,...], ... ] olarak döner.
// Ayrıca (kalem kaynaklarının gün filtresini yapabilmesi ve HAM YEDEK sekmesi üretilebilmesi için):
//   - idler: bu kaynağın "ID" sütunundaki, o gün eşleşen kayıtların ID seti (Set)
//   - hamBaslik / hamSatirlar: sayfanın KENDİ (gerçek, o an sayfada yazılı) başlık satırı ve
//     eşleşen satırların TÜM sütunlarıyla (kısaltılmamış) hali — bir sorun halinde bu veriler
//     ilgili Google E-Tablosu sayfasına satır satır GERİ YAPIŞTIRILARAK sisteme entegre edilebilir.
function grKaynakTablosu_(ss, kaynak, gunAnahtari, haritalar) {
  const sheetAdi = SHEETS[kaynak.anahtar];
  const sheet = ss.getSheetByName(sheetAdi);
  const baslikSatiri = kaynak.goster.map(g => g[1]);
  if (!sheet) return { baslik: baslikSatiri, satirlar: [], idler: new Set(), hamBaslik: [], hamSatirlar: [] };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { baslik: baslikSatiri, satirlar: [], idler: new Set(), hamBaslik: data[0] || [], hamSatirlar: [] };

  const kayitIdx = kaynak.headers.indexOf(kaynak.kayitKolon);
  const idIdx = kaynak.headers.indexOf("ID");
  const cariIdx = kaynak.cariKolon ? kaynak.headers.indexOf(kaynak.cariKolon) : -1;
  const bankaHesapIdx = kaynak.bankaHesapKolon ? kaynak.headers.indexOf(kaynak.bankaHesapKolon) : -1;
  const posIdx = kaynak.posKolon ? kaynak.headers.indexOf(kaynak.posKolon) : -1;
  const kartIdx = kaynak.kartKolon ? kaynak.headers.indexOf(kaynak.kartKolon) : -1;

  const satirlar = [], idler = new Set(), hamSatirlar = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (kayitIdx < 0 || grGunAnahtari_(r[kayitIdx]) !== gunAnahtari) continue;
    const satir = kaynak.goster.map(g => {
      const alan = g[0];
      if (alan === "_CARI_AD") return haritalar.cariAd[String(r[cariIdx])] || String(r[cariIdx] || "");
      if (alan === "_HESAP_AD") return haritalar.bankaHesapAd[String(r[bankaHesapIdx])] || String(r[bankaHesapIdx] || "");
      if (alan === "_POS_AD") return haritalar.posAd[String(r[posIdx])] || String(r[posIdx] || "");
      if (alan === "_KART_AD") return haritalar.kartAd[String(r[kartIdx])] || String(r[kartIdx] || "");
      const idx = kaynak.headers.indexOf(alan);
      return idx >= 0 ? r[idx] : "";
    });
    satirlar.push(satir);
    hamSatirlar.push(r);
    if (idIdx >= 0) idler.add(String(r[idIdx]));
  }
  return { baslik: baslikSatiri, satirlar: satirlar, idler: idler, hamBaslik: data[0], hamSatirlar: hamSatirlar };
}

// Kalem (satış/alış satırı) kaynakları için: gün filtresi kayıt tarihine göre değil,
// kalemin bağlı olduğu satış/alış'ın o gün girilmiş olmasına göre yapılır (ebeveynIdSeti).
function grKalemKaynakTablosu_(ss, kaynak, ebeveynIdSeti) {
  const sheetAdi = SHEETS[kaynak.anahtar];
  const sheet = ss.getSheetByName(sheetAdi);
  const baslikSatiri = kaynak.goster.map(g => g[1]);
  if (!sheet) return { baslik: baslikSatiri, satirlar: [], hamBaslik: [], hamSatirlar: [] };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { baslik: baslikSatiri, satirlar: [], hamBaslik: data[0] || [], hamSatirlar: [] };

  const ebeveynIdx = kaynak.headers.indexOf(kaynak.ebeveynIdKolon);
  const satirlar = [], hamSatirlar = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (ebeveynIdx < 0 || !ebeveynIdSeti.has(String(r[ebeveynIdx]))) continue;
    const satir = kaynak.goster.map(g => {
      const idx = kaynak.headers.indexOf(g[0]);
      return idx >= 0 ? r[idx] : "";
    });
    satirlar.push(satir);
    hamSatirlar.push(r);
  }
  return { baslik: baslikSatiri, satirlar: satirlar, hamBaslik: data[0], hamSatirlar: hamSatirlar };
}

// Bir DETAY sekmesinin yanına, aynı kayıtların KAYNAK SAYFADAKİ TÜM sütunlarını (kısaltılmamış,
// olduğu gibi) içeren bir "HAM YEDEK" sekmesi ekler. Bu sekme, bir saldırı/veri kaybı halinde
// ilgili Google E-Tablosu sayfasına satır satır kopyalanıp SİSTEME GERİ YÜKLENEBİLECEK şekilde,
// gerçek sütun adları ve gerçek ID'lerle birebir tutulur (görüntü için sadeleştirilmiş DETAY
// sekmesinin aksine hiçbir sütun atlanmaz/yeniden adlandırılmaz).
function grHamYedekSekmesiEkle_(gecici, ad, hamBaslik, hamSatirlar) {
  if (!hamBaslik || !hamBaslik.length) return;
  const sekme = gecici.insertSheet("HAM - " + ad);
  sekme.getRange(1, 1, 1, hamBaslik.length).setValues([hamBaslik]).setFontWeight("bold").setBackground("#fde9d9");
  if (hamSatirlar.length) sekme.getRange(2, 1, hamSatirlar.length, hamBaslik.length).setValues(hamSatirlar);
  sekme.autoResizeColumns(1, hamBaslik.length);
}

function grKlasoruGetirVeyaOlustur_() {
  const klasorler = DriveApp.getFoldersByName(GUNLUK_RAPOR_KLASOR_ADI);
  if (klasorler.hasNext()) return klasorler.next();
  return DriveApp.createFolder(GUNLUK_RAPOR_KLASOR_ADI);
}

// Ana işlev: verilen gün (yyyy-MM-dd, boşsa bugün) için raporu üretir.
// istenenBase64=true ise (buton çağrısında) dosyayı base64 olarak da döner.
function gunlukIslemRaporuOlustur_(gunAnahtari, istenenBase64) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  gunAnahtari = gunAnahtari || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");
  const haritalar = grHaritalarOlustur_(ss);
  const kaynaklar = grKaynaklar_();

  const gecici = SpreadsheetApp.create("Günlük İşlem Raporu - " + gunAnahtari);
  const ozetSatirlari = [["Modül", "Kayıt Sayısı"]];
  const ebeveynIdSetleri = {}; // { satislar: Set, alislar: Set } — kalem kaynakları bunu kullanır

  // 1) Ana kaynaklar (Satış/Alış/Tahsilat/Ödeme/... başlıkları) — okunaklı DETAY sekmesi +
  //    yanına aynı kayıtların TÜM sütunlarıyla HAM YEDEK sekmesi.
  kaynaklar.forEach(function (kaynak) {
    const tablo = grKaynakTablosu_(ss, kaynak, gunAnahtari, haritalar);
    ebeveynIdSetleri[kaynak.anahtar] = tablo.idler;

    const sekme = gecici.insertSheet(kaynak.ad);
    sekme.getRange(1, 1, 1, tablo.baslik.length).setValues([tablo.baslik]).setFontWeight("bold");
    if (tablo.satirlar.length) sekme.getRange(2, 1, tablo.satirlar.length, tablo.baslik.length).setValues(tablo.satirlar);
    sekme.autoResizeColumns(1, tablo.baslik.length);
    ozetSatirlari.push([kaynak.ad, tablo.satirlar.length]);

    grHamYedekSekmesiEkle_(gecici, kaynak.ad, tablo.hamBaslik, tablo.hamSatirlar);
  });

  // 2) Kalem kaynakları (Satış/Alış'ın TEK TEK ürün satırları) — o gün girilen satış/alışlara
  //    bağlı kalemler, kalem kalem (aynı şekilde DETAY + HAM YEDEK ikilisiyle).
  grKalemKaynaklari_().forEach(function (kaynak) {
    const ebeveynIdSeti = ebeveynIdSetleri[kaynak.ebeveynAnahtar] || new Set();
    const tablo = grKalemKaynakTablosu_(ss, kaynak, ebeveynIdSeti);

    const sekme = gecici.insertSheet(kaynak.ad);
    sekme.getRange(1, 1, 1, tablo.baslik.length).setValues([tablo.baslik]).setFontWeight("bold");
    if (tablo.satirlar.length) sekme.getRange(2, 1, tablo.satirlar.length, tablo.baslik.length).setValues(tablo.satirlar);
    sekme.autoResizeColumns(1, tablo.baslik.length);
    ozetSatirlari.push([kaynak.ad, tablo.satirlar.length]);

    grHamYedekSekmesiEkle_(gecici, kaynak.ad, tablo.hamBaslik, tablo.hamSatirlar);
  });

  // Özet sekmesini en başa al.
  const ozet = gecici.insertSheet("Özet", 0);
  ozet.getRange(1, 1, 1, 2).setValues([["Fincanlar ERP — Günlük İşlem Raporu", gunAnahtari]]).setFontWeight("bold");
  ozet.getRange(3, 1, ozetSatirlari.length, 2).setValues(ozetSatirlari);
  ozet.getRange(3, 1, 1, 2).setFontWeight("bold");
  ozet.autoResizeColumns(1, 2);
  // Boş varsayılan "Sayfa1" sekmesi varsa temizle.
  const varsayilan = gecici.getSheetByName("Sayfa1") || gecici.getSheetByName("Sheet1");
  if (varsayilan) gecici.deleteSheet(varsayilan);

  SpreadsheetApp.flush();

  // Google Sheet'i .xlsx'e çevir.
  const disaAktarUrl = "https://docs.google.com/spreadsheets/d/" + gecici.getId() + "/export?format=xlsx";
  const yanit = UrlFetchApp.fetch(disaAktarUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const dosyaAdi = "Gunluk_Islem_Raporu_" + gunAnahtari + ".xlsx";
  const blob = yanit.getBlob().setName(dosyaAdi);

  // 1) Drive'a kaydet.
  const klasor = grKlasoruGetirVeyaOlustur_();
  const dosya = klasor.createFile(blob);

  // Artık ihtiyaç yok — sadece .xlsx'i Drive'da bırak, ham Google E-Tablosu'nu sil.
  DriveApp.getFileById(gecici.getId()).setTrashed(true);

  // 2) E-posta ile gönder (script özelliğinde adres tanımlıysa).
  let epostaSonuc = "GUNLUK_RAPOR_EPOSTA script özelliği tanımlı değil, e-posta gönderilmedi.";
  try {
    const adresler = (PropertiesService.getScriptProperties().getProperty("GUNLUK_RAPOR_EPOSTA") || "").trim();
    if (adresler) {
      MailApp.sendEmail({
        to: adresler,
        subject: "Fincanlar ERP — Günlük İşlem Raporu (" + gunAnahtari + ")",
        body: gunAnahtari + " tarihli günlük işlem raporu ektedir. Drive linki: " + dosya.getUrl(),
        attachments: [blob],
      });
      epostaSonuc = "Gönderildi: " + adresler;
    }
  } catch (e) {
    epostaSonuc = "E-posta gönderilemedi: " + e.message;
  }

  return {
    ok: true,
    gun: gunAnahtari,
    dosyaAdi: dosyaAdi,
    driveUrl: dosya.getUrl(),
    epostaSonuc: epostaSonuc,
    base64: istenenBase64 ? Utilities.base64Encode(blob.getBytes()) : undefined,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// Web API'den (buton) çağrılır: body.tarih (yyyy-MM-dd, opsiyonel) verilen
// günün raporunu üretir, indirme için base64 döner.
function gunlukIslemRaporuUret(body) {
  body = body || {};
  const gun = String(body.tarih || "").trim() || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");
  try {
    return gunlukIslemRaporuOlustur_(gun, true);
  } catch (e) {
    return { ok: false, hata: "Rapor üretilemedi: " + e.message };
  }
}

// Zaman tetikleyicisi bu fonksiyonu çağırır (bugünün raporu, base64 YOK).
function gunlukIslemRaporuOtomatik() {
  var bugun = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");
  gunlukIslemRaporuOlustur_(bugun, false);
}

// TEK SEFERLİK KURULUM: Apps Script editöründen elle bir kez çalıştır (▶
// Çalıştır, "gunlukRaporTetikleyiciKur" seçili). saat parametresini burada
// (fonksiyonun içinde) 0-23 arası değiştirip öyle çalıştır — varsayılan 23
// (gece 23:00). yedekTetikleyiciKur ile aynı desen: tekrar çalıştırmak sorun
// değil, önce eski tetikleyiciyi siler.
function gunlukRaporTetikleyiciKur() {
  var saat = 23; // ← istenen saat buradan değiştirilebilir (0-23)
  var tetikleyiciler = ScriptApp.getProjectTriggers();
  for (var i = 0; i < tetikleyiciler.length; i++) {
    if (tetikleyiciler[i].getHandlerFunction() === "gunlukIslemRaporuOtomatik") {
      ScriptApp.deleteTrigger(tetikleyiciler[i]);
    }
  }
  ScriptApp.newTrigger("gunlukIslemRaporuOtomatik")
    .timeBased()
    .everyDays(1)
    .atHour(saat)
    .create();
}

function gunlukRaporTetikleyiciDurumGoster() {
  var tetikleyiciler = ScriptApp.getProjectTriggers();
  var bulundu = false;
  for (var i = 0; i < tetikleyiciler.length; i++) {
    if (tetikleyiciler[i].getHandlerFunction() === "gunlukIslemRaporuOtomatik") {
      bulundu = true;
      Logger.log("Günlük rapor tetikleyicisi AKTİF.");
    }
  }
  if (!bulundu) Logger.log("Günlük rapor tetikleyicisi KURULU DEĞİL — gunlukRaporTetikleyiciKur() fonksiyonunu çalıştır.");
}
