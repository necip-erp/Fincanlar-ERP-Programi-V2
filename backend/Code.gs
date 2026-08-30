// ════════════════════════════════════════════════
// FİNCANLAR ERP — Cari Modülü (Apps Script backend)
// Mevcut Stok Paneli ile AYNI Google E-Tablosunu kullanır ama tamamen ayrı bir
// Apps Script projesi/deploy'udur — buradaki bir hata canlı Stok Panelini etkilemez.
// ════════════════════════════════════════════════

const SHEET_ID = "17-eyhwLd-3vIkH4HArhPnc3Ty7gkrZVYMERYJynXG4Q";

const SHEETS = {
  cariHesaplar:   "CariHesaplar",
  cariHareketler: "CariHareketler",
  satislar:       "Satislar",
  satisKalemleri: "SatisKalemleri",
  alislar:        "Alislar",
  alisKalemleri:  "AlisKalemleri",
  alisIadeler:      "AlisIadeler",
  alisIadeKalemleri:"AlisIadeKalemleri",
  tahsilatlar:    "Tahsilatlar",
  odemeler:       "Odemeler",
  bankalar:       "Bankalar",
  bankaHesaplari: "BankaHesaplari",
  posCihazlari:   "PosCihazlari",
  krediKartlari:  "KrediKartlari",
  stokTanimlari:  "StokTanimlari",
  birimTanimlari: "BirimTanimlari",
  posHareketleri: "PosHareketleri",
  bankaHesapHareketleri: "BankaHesapHareketleri",
  stokHareketleri: "StokHareketleri",
  seriTanimlari: "SeriTanimlari",
  tedarikciCariEslesme: "TedarikciCariEslesme",
  markalar: "Markalar",
  urunGruplari: "UrunGruplari",
  altUrunGruplari: "AltUrunGruplari",
  ebatlar: "Ebatlar",
  renkler: "Renkler",
  aciklamaSablonlari: "AciklamaSablonlari",
  cekSenetler: "CekSenetler",
  cekSenetHareketleri: "CekSenetHareketleri",
  alisFaturaDurum: "AlisFaturaDurum",
  siparisDurumlari: "SiparisDurumlari",
};

// ── YARDIMCI FONKSİYONLAR ──

// ════════════════════════════════════════════════
// SUNUCU TARAFI ÖNBELLEK (CacheService)
// Stok/Cari sayısı arttıkça her istekte tüm sayfayı okumak (getDataRange)
// yavaşlar; sık istenen liste sonuçlarını kısa süreliğine (varsayılan 3 dk)
// önbellekte tutuyoruz. Bir kayıt eklenip/silinip/güncellenince ilgili
// önbellek anahtarı temizlenir (cacheTemizle), böylece bayat veri gösterilmez.
// CacheService anahtar başına ~100KB sınırı olduğundan çok büyük listeler
// (binlerce satır) önbelleğe alınamayabilir; bu durumda sorunsuzca normal
// (önbelleksiz) okumaya geri düşülür.
// ════════════════════════════════════════════════
function cacheOkuVeyaHesapla(anahtar, saniyeTTL, hesaplaFn) {
  const cache = CacheService.getScriptCache();
  try {
    const mevcut = cache.get(anahtar);
    if (mevcut) return JSON.parse(mevcut);
  } catch (e) { /* önbellek okunamadıysa normal hesaplamaya devam */ }

  const sonuc = hesaplaFn();
  try {
    const json = JSON.stringify(sonuc);
    if (json.length < 95000) cache.put(anahtar, json, saniyeTTL);
  } catch (e) { /* JSON'a çevrilemedi veya önbelleğe yazılamadı — sorun değil */ }
  return sonuc;
}

function cacheTemizle(anahtarlar) {
  try { CacheService.getScriptCache().removeAll(anahtarlar); } catch (e) { /* yoksay */ }
}

// CariHesaplar sayfası daha önce CARI_KODU sütunu olmadan oluşturulmuş olabilir
// (eski veri). Sayfa zaten varsa getOrCreateSheet header'ı güncellemez, bu yüzden
// 9. sütunun (I) başlığını burada garanti altına alıyoruz — yoksa ekliyoruz.
function ensureCariKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "CARI_KODU") {
    sheet.getRange(1, 9).setValue("CARI_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Carinin bu ürünler/satışlar için otomatik uygulanacak genel iskonto oranı (%).
// Satış fişine bu cari seçilince her kalemin iskonto alanına varsayılan olarak yazılır.
function ensureCariIskontoColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 10).getValue();
  if (String(mevcutBaslik || "") !== "ISKONTO_ORANI") {
    sheet.getRange(1, 10).setValue("ISKONTO_ORANI").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Wolvox referanslı: carinin açık hesap borcu bu tutarı aşınca Satış ekranında uyarı
// gösterilir (0 veya boş = limitsiz, kontrol yapılmaz).
function ensureCariKrediLimitiColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 11).getValue();
  if (String(mevcutBaslik || "") !== "KREDI_LIMITI") {
    sheet.getRange(1, 11).setValue("KREDI_LIMITI").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Stok kodu, Alış/Satış/Sipariş kalemleri arasındaki ana bağlantı — ürün adı yerine
// stok koduyla eşleştirme yapılabilmesi için AlisKalemleri'ne bu kolonu ekler.
function ensureAlisKalemStokKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 8).getValue();
  if (String(mevcutBaslik || "") !== "STOK_KODU") {
    sheet.getRange(1, 8).setValue("STOK_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Bir cari hareketin vade tarihi (özellikle Açık Hesap satışlarında "ne zamana
// kadar ödenmeli" bilgisini tutar). "Vadesi Geçmiş Alacaklar" raporunda kullanılır.
function ensureCariHareketVadeColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 8).getValue();
  if (String(mevcutBaslik || "") !== "VADE") {
    sheet.getRange(1, 8).setValue("VADE").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Google E-Tablo, "2026-08-18" veya "18/08/2026 10:30" gibi tarih benzeri
// metinleri hücreye yazılırken kendiliğinden GERÇEK bir Date değerine
// çevirebiliyor. getValues() ile bu hücre geri okunduğunda artık bir metin
// değil bir Date NESNESİ gelir; String(dateNesnesi) çağrısı da tarayıcının/
// sunucunun saat dilimine göre kaymış ve tamamen farklı biçimde bir çıktı
// üretir (örn. UTC'ye çevrilirken gün bile değişebilir). Bu da arayüzde
// "yanlış tarih" olarak görünmenin asıl nedenidir.
// Bu fonksiyon, hücre değeri gerçek bir Date nesnesi olsa da olmasa da
// İstanbul saatine göre TUTARLI bir metne çevirir: TARIH sütunları için
// "yyyy-MM-dd" (tarihGoster bunu gün/ay/yıl'a çevirir), saat bilgisi varsa
// "yyyy-MM-dd HH:mm" olarak.
function hucreTarihStr(deger) {
  if (deger instanceof Date) {
    const saat = Utilities.formatDate(deger, "Europe/Istanbul", "HH:mm");
    const gunBaslangici = (saat === "00:00");
    return gunBaslangici
      ? Utilities.formatDate(deger, "Europe/Istanbul", "yyyy-MM-dd")
      : Utilities.formatDate(deger, "Europe/Istanbul", "yyyy-MM-dd HH:mm");
  }
  return String(deger || "");
}

// ════════════════════════════════════════════════
// AÇIKLAMA ŞABLONLARI (Ayarlar > Açıklama Şablonları — cari harekete otomatik
// düşen açıklamanın işlem türüne/yöntemine göre nasıl yazılacağını belirler.
// Kullanıcı özelleştirmezse ACIKLAMA_SABLON_VARSAYILAN'daki metin kullanılır.
// ════════════════════════════════════════════════
const ACIKLAMA_SABLON_VARSAYILAN = {
  "satis_Fatura": "Satış Faturası",
  "satis_Teklif": "Satış Teklifi",
  "satis_Sipariş": "Satış Siparişi",
  "alis": "Alış Faturası",
  "alisiade": "Alış İadesi",
  "tahsilat_Nakit": "Nakit Tahsilat",
  "tahsilat_Havale/EFT": "Havale/EFT Tahsilat",
  "tahsilat_Kredi Kartı": "Kredi Kartı Tahsilat",
  "tahsilat_Çek": "Çek Tahsilat",
  "odeme_Nakit": "Nakit Ödeme",
  "odeme_Havale/EFT": "Havale/EFT Ödeme",
  "odeme_Kredi Kartı": "Kredi Kartı Ödeme",
  "odeme_Çek": "Çek Ödeme",
  "cek_alinan": "Alınan Çek/Senet",
  "cek_verilen": "Verilen Çek/Senet",
};

function aciklamaSablonlariHaritasi() {
  return cacheOkuVeyaHesapla("aciklamaSablonlari", 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.aciklamaSablonlari, ["ANAHTAR", "METIN"]);
    const data = sheet.getDataRange().getValues();
    const harita = {};
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      harita[String(data[i][0])] = String(data[i][1] || "");
    }
    return harita;
  });
}

function aciklamaSablonuAl(anahtar) {
  const harita = aciklamaSablonlariHaritasi();
  const kayitli = harita[anahtar];
  return (kayitli !== undefined && kayitli !== "") ? kayitli : (ACIKLAMA_SABLON_VARSAYILAN[anahtar] || anahtar);
}

// Cari harekete/POS-banka hareketine düşen açıklamayı oluşturur:
// "SATIS:st_123 | Satış Faturası - müşteri notu" gibi. Baştaki "PREFIX:id"
// kısmı değişmez — hem işlem silinince ilgili hareketi bulmak, hem de Cari
// Hareketler'de bir satıra tıklayınca doğru kaydı açmak için kullanılıyor.
function cariHareketAciklamaOlustur(prefix, id, sablonAnahtari, kullaniciNotu) {
  let s = prefix + ":" + id + " | " + aciklamaSablonuAl(sablonAnahtari);
  if (kullaniciNotu) s += " - " + kullaniciNotu;
  return s;
}

function getAciklamaSablonlari() {
  const sonuc = {};
  Object.keys(ACIKLAMA_SABLON_VARSAYILAN).forEach(a => { sonuc[a] = aciklamaSablonuAl(a); });
  return { ok: true, sablonlar: sonuc };
}

// body: { sablonlar: { anahtar: metin, ... } }
function saveAciklamaSablonlari(body) {
  const sablonlar = body.sablonlar || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.aciklamaSablonlari, ["ANAHTAR", "METIN"]);
  const data = sheet.getDataRange().getValues();
  Object.keys(sablonlar).forEach(anahtar => {
    if (!ACIKLAMA_SABLON_VARSAYILAN.hasOwnProperty(anahtar)) return; // bilinmeyen anahtarları yok say
    const metin = String(sablonlar[anahtar] || "").trim();
    let bulundu = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === anahtar) { sheet.getRange(i + 1, 2).setValue(metin); bulundu = true; break; }
    }
    if (!bulundu) { sheet.appendRow([anahtar, metin]); data.push([anahtar, metin]); }
  });
  cacheTemizle(["aciklamaSablonlari"]);
  return { ok: true };
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  // Aynı anda birden fazla istek gelip ikisi de "sheet yok" görüp oluşturmaya
  // çalışabilir (race condition). LockService ile bunu seri hale getiriyoruz,
  // ayrıca yine de "zaten mevcut" hatası gelirse sayfayı tekrar arayıp
  // buluyoruz (throw etmek yerine).
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet = ss.getSheetByName(name); // lock alındıktan sonra tekrar kontrol
    if (sheet) return sheet;
    try {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e8edf5");
    } catch (e) {
      // Başka bir eşzamanlı çağrı araya girip sayfayı oluşturmuş olabilir
      sheet = ss.getSheetByName(name);
      if (!sheet) throw e; // gerçekten farklı bir hata ise yeniden fırlat
    }
    return sheet;
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError(err) {
  try { Logger.log("HATA: " + err.message + "\n" + err.stack); } catch(e) {}
}

// ── GİRİŞ NOKTALARI ──
function doGet(e) {
  if (e.parameter && e.parameter.payload) {
    try {
      const parsed = JSON.parse(decodeURIComponent(e.parameter.payload));
      e = Object.assign({}, e, { postData: { contents: JSON.stringify(parsed) } });
    } catch(err) {}
  }
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const body = e.postData ? JSON.parse(e.postData.contents) : e.parameter;
    const action = body.action;
    let result;
    switch (action) {
      case "getCariListesi": result = getCariListesi(); break;
      case "getCariDetay":   result = getCariDetay(body.cariId); break;
      case "saveCari":       result = saveCari(body); break;
      case "silCari":        result = silCari(body); break;
      case "cariHareketEkle": result = cariHareketEkle(body); break;
      case "cariHareketSil":  result = cariHareketSil(body); break;
      case "getSatisListesi": result = getSatisListesi(); break;
      case "getSatisDetay":   result = getSatisDetay(body.satisId); break;
      case "saveSatis":       result = saveSatis(body); break;
      case "silSatis":        result = silSatis(body); break;
      case "getAlisListesi":  result = getAlisListesi(); break;
      case "getAlisDetay":    result = getAlisDetay(body.alisId); break;
      case "saveAlis":        result = saveAlis(body); break;
      case "siparistenFaturaOlustur": result = siparistenFaturaOlustur(body); break;
      case "siparisDurumGuncelle": result = siparisDurumGuncelle(body); break;
      case "getCariSiparisListesi": result = getCariSiparisListesi(body.cariId); break;
      case "silAlis":         result = silAlis(body); break;
      case "getAlisIadeListesi": result = getAlisIadeListesi(); break;
      case "getAlisIadeDetay":   result = getAlisIadeDetay(body.iadeId); break;
      case "saveAlisIade":       result = saveAlisIade(body); break;
      case "silAlisIade":        result = silAlisIade(body); break;
      case "getTahsilatListesi": result = getTahsilatListesi(); break;
      case "saveTahsilat":       result = saveTahsilat(body); break;
      case "guncelleTahsilat":   result = guncelleTahsilat(body); break;
      case "silTahsilat":        result = silTahsilat(body); break;
      case "getOdemeListesi": result = getOdemeListesi(); break;
      case "saveOdeme":       result = saveOdeme(body); break;
      case "silOdeme":        result = silOdeme(body); break;
      case "getFinansOzet":   result = getFinansOzet(); break;
      case "getRaporOzet":    result = getRaporOzet(body); break;
      case "getBankaYapisi":  result = getBankaYapisi(); break;
      case "saveBanka":       result = saveBanka(body); break;
      case "silBanka":        result = silBanka(body); break;
      case "saveBankaHesap":  result = saveBankaHesap(body); break;
      case "silBankaHesap":   result = silBankaHesap(body); break;
      case "savePos":         result = savePos(body); break;
      case "silPos":          result = silPos(body); break;
      case "saveKrediKarti":  result = saveKrediKarti(body); break;
      case "silKrediKarti":   result = silKrediKarti(body); break;
      case "getStokTanimListesi": result = getStokTanimListesi(); break;
      case "saveStokTanim":       result = saveStokTanim(body); break;
      case "saveStokTanimTopluce": result = saveStokTanimTopluce(body); break;
      case "silStokTanim":        result = silStokTanim(body); break;
      case "getUrunFiyatGecmisi": result = getUrunFiyatGecmisi(body.urunAdi); break;
      case "getBirimListesi": result = getBirimListesi(); break;
      case "saveBirim":       result = saveBirim(body); break;
      case "silBirim":        result = silBirim(body); break;
      case "getPosHareketleri": result = getPosHareketleri(body.posHesapId); break;
      case "getBankaHesapHareketleri": result = getBankaHesapHareketleri(body.bankaHesapId); break;
      case "getMuhasebeRaporu": result = getMuhasebeRaporu(body); break;
      case "getStokHareketListesi": result = getStokHareketListesi(body); break;
      case "stokHareketGecmisiDoldur": result = stokHareketGecmisiDoldur(); break;
      case "stokHareketTopluEkle":  result = stokHareketTopluEkle(body); break;
      case "silStokHareket":        result = silStokHareket(body); break;
      case "getSeriTanimlari": result = getSeriTanimlari(); break;
      case "saveSeriTanim":    result = saveSeriTanim(body); break;
      case "silSeriTanim":     result = silSeriTanim(body); break;
      case "seriSonrakiNoUret": result = seriSonrakiNoUret(body); break;
      case "getBasitTanimListesi": result = getBasitTanimListesi(body.tip); break;
      case "saveBasitTanim":       result = saveBasitTanim(body); break;
      case "silBasitTanim":        result = silBasitTanim(body); break;
      case "getMarkaListesi": result = getMarkaListesi(); break;
      case "saveMarka":       result = saveMarka(body); break;
      case "silMarka":        result = silMarka(body); break;
      case "birimSiraGuncelle":     result = birimSiraGuncelle(body); break;
      case "basitTanimSiraGuncelle": result = basitTanimSiraGuncelle(body); break;
      case "markaSiraGuncelle":     result = markaSiraGuncelle(body); break;
      case "getAciklamaSablonlari":  result = getAciklamaSablonlari(); break;
      case "saveAciklamaSablonlari": result = saveAciklamaSablonlari(body); break;
      case "getKritikStokListesi": result = getKritikStokListesi(); break;
      case "vadesiGecmisAlacaklar": result = vadesiGecmisAlacaklar(); break;
      case "getCekSenetListesi": result = getCekSenetListesi(); break;
      case "getBekleyenAlisFaturalari": result = getBekleyenAlisFaturalari(); break;
      case "getSiparisDurumlari": result = getSiparisDurumlari(); break;
      case "saveSiparisDurumlari": result = saveSiparisDurumlari(body); break;
      case "onaylaAlisFaturasi": result = onaylaAlisFaturasi(body); break;
      case "reddetAlisFaturasi": result = reddetAlisFaturasi(body); break;
      case "sifirlaAlisFaturaDurum": result = sifirlaAlisFaturaDurum(body); break;
      case "getCekSenetDetay":   result = getCekSenetDetay(body.id); break;
      case "saveCekSenet":       result = saveCekSenet(body); break;
      case "silCekSenet":        result = silCekSenet(body); break;
      case "cekSenetIslemYap":   result = cekSenetIslemYap(body); break;
      case "cekSenetDurumGuncelle": result = cekSenetDurumGuncelle(body); break;
      default: result = { error: "Bilinmeyen işlem: " + action };
    }
    return jsonResponse(result);
  } catch (err) {
    logError(err);
    return jsonResponse({ error: err.message });
  }
}

// ── VERİ FONKSİYONLARI ──

// Tüm cari hesapları, her birinin güncel bakiyesiyle birlikte döndürür.
// Bakiye = toplam BORÇ - toplam ALACAK (pozitifse cari bize borçlu, negatifse biz ona borçluyuz).
function getCariListesi() {
  return cacheOkuVeyaHesapla("cariListesi", 180, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  ensureCariKoduColonu(hSheet);
  ensureCariIskontoColonu(hSheet);
  ensureCariKrediLimitiColonu(hSheet);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);

  const hData = hSheet.getDataRange().getValues();
  const hkData = hkSheet.getDataRange().getValues();

  // Her cari için bakiyeyi tek geçişte hesapla
  const bakiyeMap = {};
  for (let i = 1; i < hkData.length; i++) {
    const row = hkData[i];
    const cariId = String(row[1] || "");
    if (!cariId) continue;
    const tip = String(row[3] || "");
    const tutar = parseFloat(row[4]) || 0;
    if (!bakiyeMap[cariId]) bakiyeMap[cariId] = 0;
    bakiyeMap[cariId] += (tip === "Borç") ? tutar : -tutar;
  }

  const sonuc = [];
  for (let i = 1; i < hData.length; i++) {
    const row = hData[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id,
      tip: String(row[1] || ""),
      ad: String(row[2] || ""),
      telefon: String(row[3] || ""),
      adres: String(row[4] || ""),
      vergiNo: String(row[5] || ""),
      not: String(row[6] || ""),
      tarih: hucreTarihStr(row[7]),
      cariKodu: String(row[8] || ""),
      iskontoOrani: parseFloat(row[9]) || 0,
      krediLimiti: parseFloat(row[10]) || 0,
      bakiye: bakiyeMap[id] || 0,
    });
  }
  return { ok: true, cariler: sonuc };
  });
}

// Tek bir cari hesabın bilgisini + tüm hareket geçmişini (tarihe göre sıralı, kümülatif bakiyeli) döndürür.
function getCariDetay(cariId) {
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  ensureCariKoduColonu(hSheet);
  ensureCariIskontoColonu(hSheet);
  ensureCariKrediLimitiColonu(hSheet);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
  ensureCariHareketVadeColonu(hkSheet);

  const hData = hSheet.getDataRange().getValues();
  let cari = null;
  for (let i = 1; i < hData.length; i++) {
    if (String(hData[i][0]) === String(cariId)) {
      cari = {
        id: String(hData[i][0]), tip: String(hData[i][1] || ""), ad: String(hData[i][2] || ""),
        telefon: String(hData[i][3] || ""), adres: String(hData[i][4] || ""),
        vergiNo: String(hData[i][5] || ""), not: String(hData[i][6] || ""), tarih: String(hData[i][7] || ""),
        cariKodu: String(hData[i][8] || ""), iskontoOrani: parseFloat(hData[i][9]) || 0,
        krediLimiti: parseFloat(hData[i][10]) || 0,
      };
      break;
    }
  }
  if (!cari) return { ok: false, hata: "Cari bulunamadı" };

  const hkData = hkSheet.getDataRange().getValues();
  let hareketler = [];
  for (let i = 1; i < hkData.length; i++) {
    const row = hkData[i];
    if (String(row[1]) !== String(cariId)) continue;
    hareketler.push({
      id: String(row[0]), cariId: String(row[1]), tarih: hucreTarihStr(row[2]),
      tip: String(row[3] || ""), tutar: parseFloat(row[4]) || 0,
      aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
      vade: hucreTarihStr(row[7]),
    });
  }
  // Tarihe göre sırala (eskiden yeniye), kümülatif bakiyeyi hesapla
  hareketler.sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  let bakiye = 0;
  hareketler.forEach(h => {
    bakiye += (h.tip === "Borç") ? h.tutar : -h.tutar;
    h.bakiyeSonrasi = bakiye;
  });
  hareketler.reverse(); // en yeni en üstte gösterilsin

  return { ok: true, cari: cari, hareketler: hareketler, bakiye: bakiye };
}

// body: { id (varsa güncelleme), tip, ad, telefon, adres, vergiNo, not }
function saveCari(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Cari adı gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  ensureCariKoduColonu(sheet);
  ensureCariIskontoColonu(sheet);
  ensureCariKrediLimitiColonu(sheet);
  const data = sheet.getDataRange().getValues();

  let id = String(body.id || "").trim();
  let satirIdx = -1;
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { satirIdx = i + 1; break; }
    }
  }
  if (!id) id = "cr_" + Date.now();

  const satir = [
    id,
    String(body.tip || "Müşteri"),
    ad,
    String(body.telefon || ""),
    String(body.adres || ""),
    String(body.vergiNo || ""),
    String(body.not || ""),
    satirIdx > 0 ? data[satirIdx - 1][7] : Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"),
    String(body.cariKodu || (satirIdx > 0 ? (data[satirIdx - 1][8] || "") : "")),
    parseFloat(body.iskontoOrani) || 0,
    parseFloat(body.krediLimiti) || 0,
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);

  cacheTemizle(["cariListesi"]);
  return { ok: true, id: id };
}

// body: { id } — sadece hiç hareketi olmayan cari silinebilir (güvenlik için)
function silCari(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const hkData = hkSheet.getDataRange().getValues();
  for (let i = 1; i < hkData.length; i++) {
    if (String(hkData[i][1]) === id) {
      return { ok: false, hata: "Bu cariye ait hareketler var, önce onları silin veya cariyi silmeyin" };
    }
  }

  const sheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["cariListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Cari bulunamadı" };
}

// body: { cariId, tarih, tip (Borç/Alacak), tutar, aciklama, vade (opsiyonel — Açık Hesap satışlarında son ödeme tarihi) }
function cariHareketEkle(body) {
  const cariId = String(body.cariId || "").trim();
  const tip = String(body.tip || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  if (tip !== "Borç" && tip !== "Alacak") return { ok: false, hata: "tip Borç veya Alacak olmalı" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
  ensureCariHareketVadeColonu(sheet);
  const id = "hk_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  sheet.appendRow([id, cariId, tarih, tip, tutar, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"), String(body.vade || "")]);

  cacheTemizle(["cariListesi"]); // bakiye değişti, liste önbelleği bayatladı
  return { ok: true, id: id };
}

// Vadesi bugünden önce olan, hâlâ ödenmemiş (Borç tipi) hareketleri listeler.
// Basitlik için: cari o hareketten SONRA aynı tutarda toptan kapatılmış olsa bile
// bu hareket "geciken" olarak görünmeye devam eder — asıl referans cari bakiyesidir,
// bu yüzden cari bakiyesi 0 veya negatifse (borcu kalmamışsa) o carinin hareketleri listeye dahil edilmez.
function vadesiGecmisAlacaklar() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
  ensureCariHareketVadeColonu(hkSheet);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);

  const hData = hSheet.getDataRange().getValues();
  const cariAdMap = {};
  const bakiyeMap = {};
  for (let i = 1; i < hData.length; i++) {
    if (!hData[i][0]) continue;
    cariAdMap[String(hData[i][0])] = String(hData[i][2] || "");
  }

  const hkData = hkSheet.getDataRange().getValues();
  // Önce her carinin güncel bakiyesini hesapla (borcu kapanmışsa vade uyarısı gösterilmesin)
  for (let i = 1; i < hkData.length; i++) {
    const row = hkData[i];
    const cariId = String(row[1] || "");
    if (!cariId) continue;
    const tip = String(row[3] || "");
    const tutar = parseFloat(row[4]) || 0;
    if (!bakiyeMap[cariId]) bakiyeMap[cariId] = 0;
    bakiyeMap[cariId] += (tip === "Borç") ? tutar : -tutar;
  }

  const bugun = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");
  const sonuc = [];
  for (let i = 1; i < hkData.length; i++) {
    const row = hkData[i];
    const cariId = String(row[1] || "");
    if (!cariId) continue;
    const tip = String(row[3] || "");
    const vade = hucreTarihStr(row[7]);
    if (tip !== "Borç" || !vade) continue;
    if (vade >= bugun) continue; // henüz vadesi gelmemiş
    if ((bakiyeMap[cariId] || 0) <= 0) continue; // carinin borcu kalmamış
    sonuc.push({
      id: String(row[0]), cariId: cariId, cariAd: cariAdMap[cariId] || "",
      tarih: hucreTarihStr(row[2]), tutar: parseFloat(row[4]) || 0,
      aciklama: String(row[5] || ""), vade: vade,
      gecikenGunSayisi: Math.round((new Date(bugun) - new Date(vade)) / 86400000),
    });
  }
  sonuc.sort((a, b) => a.vade < b.vade ? -1 : 1);
  return { ok: true, hareketler: sonuc };
}

// body: { id }
function cariHareketSil(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["cariListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Hareket bulunamadı" };
}
// ════════════════════════════════════════════════
// SATIŞ MODÜLÜ
// Stok Panelinden BAĞIMSIZ çalışır (ürünler serbest metin olarak girilir,
// stoktan düşme entegrasyonu sonraki adımda eklenecek).
// Cari bağlantısı VAR: bir satışa cari seçilirse, tutar kadar otomatik
// "Borç" hareketi cariHareketEkle() ile eklenir (müşteri bize borçlanır).
// Satış silinirse bu hareket de bulunup geri silinir (aciklama içindeki
// "SATIS:<id>" işaretiyle eşleştirilir).
// ════════════════════════════════════════════════

// Satislar sayfası daha önce BELGE_TIPI sütunu olmadan oluşturulmuş olabilir;
// 9. sütunun (I) başlığını garanti altına alıyoruz. Eski kayıtlarda bu alan
// boş kalır, okurken "Fatura" varsayılır (geriye dönük uyumluluk).
// Sipariş için kullanıcının elle seçebileceği takip durumları. Faturalanma
// durumu (Muhasebelendi/Kısmen Faturalandı) bunlardan ayrı ve otomatiktir —
// bkz. siparisDurumHesapla().
// Sipariş durumları artık sabit değil — Ayarlar > Sipariş Durumları'ndan tanımlanır
// (SiparisDurumlari sayfası). Bu dizi sadece sayfa hiç oluşturulmamışsa ilk kurulumda
// kullanılan varsayılan settir. "aktarilabilir": bu durumdaki bir sipariş faturaya
// aktarılabilir mi (siparistenFaturaOlustur bunu kontrol eder).
const SIPARIS_DURUM_VARSAYILAN = [
  { ad: "Beklemede", aktarilabilir: false },
  { ad: "Onaylandı", aktarilabilir: true },
  { ad: "Teslim Edildi", aktarilabilir: true },
  { ad: "Haber Verecek", aktarilabilir: false },
];
const SIPARIS_DURUM_BASLIKLAR = ["SIRA", "AD", "AKTARILABILIR"];

function getSiparisDurumlari() {
  return cacheOkuVeyaHesapla("siparisDurumlari", 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.siparisDurumlari, SIPARIS_DURUM_BASLIKLAR);
    let data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      SIPARIS_DURUM_VARSAYILAN.forEach((d, i) => sheet.appendRow([i + 1, d.ad, d.aktarilabilir]));
      data = sheet.getDataRange().getValues();
    }
    const durumlar = [];
    for (let i = 1; i < data.length; i++) {
      const ad = String(data[i][1] || "").trim();
      if (!ad) continue;
      durumlar.push({
        sira: parseFloat(data[i][0]) || i,
        ad: ad,
        aktarilabilir: data[i][2] === true || String(data[i][2]).toUpperCase() === "TRUE",
      });
    }
    durumlar.sort((a, b) => a.sira - b.sira);
    return { ok: true, durumlar: durumlar };
  });
}

// body: { durumlar: [{ad, aktarilabilir}, ...] } — sıra, dizideki sıraya göre yeniden yazılır.
function saveSiparisDurumlari(body) {
  const durumlar = Array.isArray(body.durumlar) ? body.durumlar : [];
  if (durumlar.length === 0) return { ok: false, hata: "En az bir durum tanımlı olmalı" };
  const adSeti = new Set();
  for (const d of durumlar) {
    const ad = String(d.ad || "").trim();
    if (!ad) return { ok: false, hata: "Boş isimli durum olamaz" };
    if (adSeti.has(ad)) return { ok: false, hata: "Aynı isimde birden fazla durum olamaz: " + ad };
    adSeti.add(ad);
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.siparisDurumlari, SIPARIS_DURUM_BASLIKLAR);
  sheet.clearContents();
  sheet.appendRow(SIPARIS_DURUM_BASLIKLAR);
  durumlar.forEach((d, i) => sheet.appendRow([i + 1, String(d.ad).trim(), !!d.aktarilabilir]));

  cacheTemizle(["siparisDurumlari"]);
  return { ok: true };
}

// Bir siparişin listede/detayda gösterilecek nihai durumunu hesaplar:
// hiç faturalanmadıysa kullanıcının elle seçtiği durumu, kısmen faturalandıysa
// "Kısmen Faturalandı", tamamı faturalandıysa "Muhasebelendi" döner.
function siparisDurumHesapla(elleSecilenDurum, tamamiFaturalandiMi, hicFaturalanmadiMi) {
  if (tamamiFaturalandiMi) return "Muhasebelendi";
  if (!hicFaturalanmadiMi) return "Kısmen Faturalandı";
  return elleSecilenDurum || "Beklemede";
}

function ensureSatisBelgeTipiColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "BELGE_TIPI") {
    sheet.getRange(1, 9).setValue("BELGE_TIPI").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h10 = sheet.getRange(1, 10).getValue();
  if (String(h10 || "") !== "DIP_ISKONTO_YUZDE") {
    sheet.getRange(1, 10).setValue("DIP_ISKONTO_YUZDE").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h11 = sheet.getRange(1, 11).getValue();
  if (String(h11 || "") !== "BANKA_HESAP_ID") {
    sheet.getRange(1, 11).setValue("BANKA_HESAP_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Bir Fatura, bir Sipariş'ten (kısmen ya da tamamen) oluşturulduysa kaynak
  // sipariş id'sini burada tutuyoruz — Sipariş'in "ne kadarı faturalandı"
  // durumunu hesaplamak için kullanılır.
  const h12 = sheet.getRange(1, 12).getValue();
  if (String(h12 || "") !== "KAYNAK_SIPARIS_ID") {
    sheet.getRange(1, 12).setValue("KAYNAK_SIPARIS_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Sadece belgeTipi=Sipariş için anlamlı: kullanıcının elle seçtiği takip durumu
  // (Beklemede/Onaylandı/Teslim Edildi/Haber Verecek). Faturalanma durumu
  // (Muhasebelendi/Kısmen Faturalandı) bundan AYRI ve otomatik hesaplanır —
  // sipariş hiç faturalanmadıysa listede bu elle seçilen durum gösterilir.
  const h13 = sheet.getRange(1, 13).getValue();
  if (String(h13 || "") !== "SIPARIS_DURUMU") {
    sheet.getRange(1, 13).setValue("SIPARIS_DURUMU").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Sadece Sipariş'te kullanılan sabit ₺ "Tutar İskontosu" ve onun KDV'den önce mi
  // sonra mı düşüldüğünü belirten bayrak (1=sonra/varsayılan, 0=önce).
  const h14 = sheet.getRange(1, 14).getValue();
  if (String(h14 || "") !== "TUTAR_ISKONTOSU") {
    sheet.getRange(1, 14).setValue("TUTAR_ISKONTOSU").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h15 = sheet.getRange(1, 15).getValue();
  if (String(h15 || "") !== "TUTAR_ISKONTO_KDV_SONRA") {
    sheet.getRange(1, 15).setValue("TUTAR_ISKONTO_KDV_SONRA").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// SatisKalemleri sayfası daha önce ISKONTO_YUZDE / KDV_ORANI sütunları olmadan
// oluşturulmuş olabilir; 8. ve 9. sütun başlıklarını garanti altına alıyoruz.
function ensureSatisKalemVergiKolonlari(sheet) {
  const h8 = sheet.getRange(1, 8).getValue();
  if (String(h8 || "") !== "ISKONTO_YUZDE") {
    sheet.getRange(1, 8).setValue("ISKONTO_YUZDE").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h9 = sheet.getRange(1, 9).getValue();
  if (String(h9 || "") !== "KDV_ORANI") {
    sheet.getRange(1, 9).setValue("KDV_ORANI").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Bir Sipariş kaleminden şimdiye kadar Fatura'ya aktarılmış toplam miktarı
  // tutar (sadece belgeTipi=Sipariş olan satışların kalemlerinde anlamlıdır).
  const h10 = sheet.getRange(1, 10).getValue();
  if (String(h10 || "") !== "FATURALANAN_MIKTAR") {
    sheet.getRange(1, 10).setValue("FATURALANAN_MIKTAR").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Stok kodu, Alış/Satış/Sipariş kalemleri arasındaki ana bağlantı.
  const h11 = sheet.getRange(1, 11).getValue();
  if (String(h11 || "") !== "STOK_KODU") {
    sheet.getRange(1, 11).setValue("STOK_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Bir satış kaleminin (miktar, birim fiyat, iskonto %, kdv %) üzerinden
// Brüt Toplam - İskonto - Ara Toplam - Kdv Toplam - Genel Toplam kırılımını hesaplar.
// Satış fişi tasarımı bu 5 kalemi bu sırayla göstermelidir.
function satisKalemHesapla(miktar, birimFiyat, iskontoYuzde, kdvOrani) {
  const brut = miktar * birimFiyat;
  const iskontoTutari = brut * ((iskontoYuzde || 0) / 100);
  const araToplam = brut - iskontoTutari;
  const kdvTutari = araToplam * ((kdvOrani || 0) / 100);
  const genelToplam = araToplam + kdvTutari;
  return { brut: brut, iskontoTutari: iskontoTutari, araToplam: araToplam, kdvTutari: kdvTutari, genelToplam: genelToplam };
}

// Tüm satışların özet listesini döner (en yeni en üstte).
function getSatisListesi() {
  return cacheOkuVeyaHesapla("satisListesi", 60, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();

  // Sipariş satırları için durum hesaplanacaksa kalemleri de topluca okuyoruz
  // (her satış için ayrı ayrı sorgu atmamak için tek seferde).
  const siparisIdleri = new Set();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][8] || "") === "Sipariş") siparisIdleri.add(String(data[i][0]));
  }
  let faturalanmaHaritasi = {};
  if (siparisIdleri.size > 0) {
    const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
      ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
    ensureSatisKalemVergiKolonlari(kSheet);
    const kData = kSheet.getDataRange().getValues();
    const faturalananMap = {};
    for (let i = 1; i < kData.length; i++) {
      const row = kData[i];
      const satisId = String(row[1] || "");
      if (!siparisIdleri.has(satisId)) continue;
      const miktar = parseFloat(row[3]) || 0;
      const faturalanan = parseFloat(row[9]) || 0;
      if (!faturalananMap[satisId]) faturalananMap[satisId] = { tam: 0, hic: 0, toplamKalem: 0 };
      faturalananMap[satisId].toplamKalem++;
      if (faturalanan >= miktar && miktar > 0) faturalananMap[satisId].tam++;
      if (faturalanan <= 0) faturalananMap[satisId].hic++;
    }
    siparisIdleri.forEach(sid => {
      const f = faturalananMap[sid];
      faturalanmaHaritasi[sid] = !f || f.toplamKalem === 0
        ? { tamamiFaturalandi: false, hicFaturalanmadi: true }
        : { tamamiFaturalandi: f.tam === f.toplamKalem, hicFaturalanmadi: f.hic === f.toplamKalem };
    });
  }

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const belgeTipi = String(row[8] || "") || "Fatura";
    const elleSecilenDurum = String(row[12] || "");
    const f = faturalanmaHaritasi[id];
    sonuc.push({
      id: id,
      tarih: hucreTarihStr(row[1]),
      cariId: String(row[2] || ""),
      cariAd: String(row[3] || ""),
      toplamTutar: parseFloat(row[4]) || 0,
      odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""),
      kayitTarihi: hucreTarihStr(row[7]),
      belgeTipi: belgeTipi,
      siparisManuelDurum: elleSecilenDurum || "Beklemede",
      siparisDurumu: belgeTipi === "Sipariş" ? siparisDurumHesapla(elleSecilenDurum, f && f.tamamiFaturalandi, f ? f.hicFaturalanmadi : true) : "",
    });
  }
  sonuc.reverse(); // ID zaman damgalı olduğundan ekleme sırası = kronolojik; en yeni en üstte
  return { ok: true, satislar: sonuc };
  });
}

// Tek bir satışı + ürün kalemlerini döner.
function getSatisDetay(satisId) {
  if (!satisId) return { ok: false, hata: "satisId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  ensureSatisKalemVergiKolonlari(kSheet);

  const data = sSheet.getDataRange().getValues();
  let satis = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(satisId)) {
      satis = {
        id: String(data[i][0]), tarih: String(data[i][1] || ""), cariId: String(data[i][2] || ""),
        cariAd: String(data[i][3] || ""), toplamTutar: parseFloat(data[i][4]) || 0,
        odemeTipi: String(data[i][5] || ""), aciklama: String(data[i][6] || ""), kayitTarihi: String(data[i][7] || ""),
        belgeTipi: String(data[i][8] || "") || "Fatura",
        dipIskontoYuzde: parseFloat(data[i][9]) || 0, bankaHesapId: String(data[i][10] || ""),
        kaynakSiparisId: String(data[i][11] || ""),
        siparisManuelDurum: String(data[i][12] || "") || "Beklemede",
        tutarIskontosu: parseFloat(data[i][13]) || 0,
        tutarIskontoKdvSonra: String(data[i][14]) !== "0",
      };
      break;
    }
  }
  if (!satis) return { ok: false, hata: "Satış bulunamadı" };

  const kData = kSheet.getDataRange().getValues();
  const kalemler = [];
  // Satış fişi alt toplamı: Brüt Toplam - İskonto - Ara Toplam - Kdv Toplam - Genel Toplam
  let brutToplam = 0, iskontoToplam = 0, kdvToplam = 0, araToplamKalem = 0;
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== String(satisId)) continue;
    const miktar = parseFloat(row[3]) || 0;
    const birimFiyat = parseFloat(row[5]) || 0;
    const iskontoYuzde = parseFloat(row[7]) || 0;
    const kdvOrani = parseFloat(row[8]) || 0;
    const faturalananMiktar = parseFloat(row[9]) || 0;
    const h = satisKalemHesapla(miktar, birimFiyat, iskontoYuzde, kdvOrani);
    brutToplam += h.brut; iskontoToplam += h.iskontoTutari; kdvToplam += h.kdvTutari; araToplamKalem += h.araToplam;
    kalemler.push({
      id: String(row[0]), satisId: String(row[1]), urunAdi: String(row[2] || ""),
      miktar: miktar, birim: String(row[4] || ""), birimFiyat: birimFiyat,
      tutar: parseFloat(row[6]) || 0, iskontoYuzde: iskontoYuzde, kdvOrani: kdvOrani,
      iskontoTutari: h.iskontoTutari, kdvTutari: h.kdvTutari, kalemGenelToplam: h.genelToplam,
      faturalananMiktar: faturalananMiktar, kalanMiktar: Math.max(0, miktar - faturalananMiktar),
      stokKodu: String(row[10] || ""),
    });
  }
  if (satis.belgeTipi === "Sipariş") {
    const tumuFaturalandi = kalemler.length > 0 && kalemler.every(k => k.kalanMiktar <= 0);
    const hicFaturalanmadi = kalemler.every(k => k.faturalananMiktar <= 0);
    satis.siparisDurumu = siparisDurumHesapla(satis.siparisManuelDurum, tumuFaturalandi, hicFaturalanmadi);
  }
  const dipIskontoTutari = araToplamKalem * ((satis.dipIskontoYuzde || 0) / 100);
  const araToplam = brutToplam - iskontoToplam - dipIskontoTutari;
  const genelToplam = araToplam + kdvToplam;
  satis.toplamlar = {
    brutToplam: brutToplam, iskontoToplam: iskontoToplam + dipIskontoTutari, araToplam: araToplam,
    kdvToplam: kdvToplam, genelToplam: genelToplam,
  };
  return { ok: true, satis: satis, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd (cariId yoksa serbest müşteri adı), tarih,
//         odemeTipi, aciklama, kalemler: [{urunAdi, miktar, birim, birimFiyat}, ...] }
function saveSatis(body) {
  const kalemler = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (kalemler.length === 0) return { ok: false, hata: "En az bir ürün kalemi eklemelisiniz" };
  for (const k of kalemler) {
    if (!String(k.urunAdi || "").trim()) return { ok: false, hata: "Kalemlerde ürün adı gerekli" };
    if (!(parseFloat(k.miktar) > 0)) return { ok: false, hata: "Kalemlerde miktar sıfırdan büyük olmalı" };
    if (!(parseFloat(k.birimFiyat) >= 0)) return { ok: false, hata: "Kalemlerde birim fiyat geçersiz" };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  ensureSatisKalemVergiKolonlari(kSheet);

  const cariId = String(body.cariId || "").trim();
  let cariAd = String(body.cariAd || "").trim();
  if (cariId) {
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
    }
  }
  if (!cariAd) cariAd = "Peşin Müşteri";

  // Toplam tutar = Genel Toplam (Brüt Toplam - İskonto + Kdv Toplam), yani cariye
  // yansıyacak/tahsil edilecek nihai tutar. Kalem bazında iskonto % ve kdv % desteklenir.
  // Dip İskonto (fatura geneline uygulanan ek iskonto), kalemlerin toplam ara toplamı
  // üzerinden hesaplanır ve KDV'den sonra genel toplamdan düşülür.
  let kalemGenelToplam = 0, kalemAraToplam = 0, kalemKdvToplam = 0;
  kalemler.forEach(k => {
    const h = satisKalemHesapla(parseFloat(k.miktar) || 0, parseFloat(k.birimFiyat) || 0,
      parseFloat(k.iskontoYuzde) || 0, k.kdvOrani === undefined ? 20 : (parseFloat(k.kdvOrani) || 0));
    kalemGenelToplam += h.genelToplam;
    kalemAraToplam += h.araToplam;
    kalemKdvToplam += h.kdvTutari;
  });
  const dipIskontoYuzde = parseFloat(body.dipIskontoYuzde) || 0;
  const dipIskontoTutari = kalemAraToplam * (dipIskontoYuzde / 100);

  // Tutar İskontosu (yalnızca Sipariş'te kullanılan sabit ₺ iskonto) — tikli ise
  // KDV'den SONRA (genel toplamdan doğrudan düşülür, KDV tutarı değişmez); tiksiz ise
  // KDV'den ÖNCE (ara toplamdan düşülür, kalemlerin ağırlıklı ortalama KDV oranı bu
  // düşülmüş tabana yeniden uygulanarak KDV de orantılı azalır).
  const tutarIskontosu = Math.max(0, parseFloat(body.tutarIskontosu) || 0);
  const tutarIskontoKdvSonra = body.tutarIskontoKdvSonra !== false; // varsayılan: KDV'den sonra
  let toplamTutar;
  if (tutarIskontosu > 0 && !tutarIskontoKdvSonra) {
    const araToplamNet = Math.max(0, kalemAraToplam - dipIskontoTutari - tutarIskontosu);
    const ortalamaKdvOrani = kalemAraToplam > 0 ? (kalemKdvToplam / kalemAraToplam) : 0;
    toplamTutar = araToplamNet * (1 + ortalamaKdvOrani);
  } else {
    toplamTutar = kalemGenelToplam - dipIskontoTutari - tutarIskontosu;
  }
  toplamTutar = Math.max(0, toplamTutar);

  const id = "st_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  const belgeTipi = String(body.belgeTipi || "Fatura");
  let siparisDurumu = "";
  if (belgeTipi === "Sipariş") {
    const durumAdlari = getSiparisDurumlari().durumlar.map(d => d.ad);
    siparisDurumu = durumAdlari.includes(body.siparisDurumu) ? body.siparisDurumu : (durumAdlari[0] || "Beklemede");
  }
  sSheet.appendRow([id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi, belgeTipi, dipIskontoYuzde, bankaHesapId, String(body.kaynakSiparisId || ""), siparisDurumu, tutarIskontosu, tutarIskontoKdvSonra ? 1 : 0]);

  // stokKartiOlustur işaretli ve StokTanimlari'nda henüz olmayan stok kodları için
  // otomatik, minimal bir stok kartı oluşturulur (Alış modülündeki mantığın aynısı).
  const olusturulacaklar = kalemler.filter(k => k.stokKartiOlustur && String(k.stokKodu || "").trim());
  if (olusturulacaklar.length > 0) {
    const mevcutStoklar = getStokTanimListesi().kalemler;
    const mevcutKoduSeti = {};
    mevcutStoklar.forEach(s => { if (s.stokKodu) mevcutKoduSeti[s.stokKodu] = true; });
    olusturulacaklar.forEach(k => {
      const kod = String(k.stokKodu).trim();
      if (mevcutKoduSeti[kod]) return;
      saveStokTanim({ stokKodu: kod, stokAdi: String(k.urunAdi).trim(), birim1: String(k.birim || "adet") });
      mevcutKoduSeti[kod] = true;
    });
  }

  kalemler.forEach((k, idx) => {
    const kId = "sk_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    const iskontoYuzde = parseFloat(k.iskontoYuzde) || 0;
    const kdvOrani = k.kdvOrani === undefined ? 20 : (parseFloat(k.kdvOrani) || 0);
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, iskontoYuzde, kdvOrani, 0, String(k.stokKodu || "").trim()]);
  });

  // Stok Hareket Raporu'na SADECE FATURA yansır (Teklif/Sipariş henüz stoktan mal
  // çıkışı anlamına gelmez — mal siparişin faturalandırılmasıyla fiilen çıkar).
  if (belgeTipi === "Fatura") {
    stokHareketOtomatikYaz(ss, kalemler, tarih, "Çıkış", "Satış Faturası", id, "Satış Faturası — " + cariAd);
  }

  // Cari harekete/banka hareketine SADECE FATURA yansır — Teklif ve Sipariş henüz
  // gerçekleşmiş bir satış değildir, cariye borç yazılmaz. Sipariş faturalandığında
  // (siparistenFaturaOlustur ile) oluşturulan Fatura zaten kendi Borç hareketini yaratır.
  if (belgeTipi === "Fatura") {
    // Cari seçildiyse, tutar kadar otomatik Borç hareketi ekle (müşteri bize borçlanır).
    // "SATIS:<id>" işaretini açıklamaya koyuyoruz ki satış silinince bu hareket bulunup geri alınabilsin.
    if (cariId) {
      cariHareketEkle({
        cariId: cariId,
        tarih: tarih,
        tip: "Borç",
        tutar: toplamTutar,
        aciklama: cariHareketAciklamaOlustur("SATIS", id, "satis_" + belgeTipi, body.aciklama),
        vade: String(body.odemeTipi || "") === "Açık Hesap" ? String(body.vade || "") : "",
      });
    }

    // Ödeme Tipi "Havale" ise ve bir banka hesabı seçildiyse, o hesaba GİRİŞ kaydı düşülür
    // (satış tutarı doğrudan banka hesabına havale ile ödenmiş demektir).
    if (String(body.odemeTipi || "") === "Havale" && bankaHesapId) {
      bankaHesapHareketEkle(bankaHesapId, tarih, "Giriş", toplamTutar,
        cariHareketAciklamaOlustur("SATIS", id, "satis_" + belgeTipi, body.aciklama));
    }
  }

  cacheTemizle(["satisListesi"]);
  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// ════════════════════════════════════════════════
// SİPARİŞTEN KISMİ/ÜRÜN-MİKTAR BAZLI FATURA OLUŞTURMA
// Bir Sipariş'in kalemlerinden istenen ürün + istenen miktar kadarı seçilip
// yeni bir Fatura'ya aktarılır. Aktarılmayan (kalan) miktarlar sipariş
// kaleminde durmaya devam eder — sipariş, tamamı faturalanana kadar
// "Bekliyor" / "Kısmen Faturalandı" durumunda görünür (getSatisListesi/
// getSatisDetay bu durumu FATURALANAN_MIKTAR'a bakarak hesaplar).
// ════════════════════════════════════════════════

// body: { siparisId, tarih, odemeTipi, bankaHesapId, vade, aciklama,
//         kalemler: [{kalemId, aktarilanMiktar}, ...] }
function siparistenFaturaOlustur(body) {
  const siparisId = String(body.siparisId || "").trim();
  if (!siparisId) return { ok: false, hata: "siparisId gerekli" };
  const istekKalemleri = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (istekKalemleri.length === 0) return { ok: false, hata: "Aktarılacak en az bir ürün seçmelisiniz" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  ensureSatisKalemVergiKolonlari(kSheet);

  const sData = sSheet.getDataRange().getValues();
  let siparis = null;
  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][0]) === siparisId) {
      siparis = { cariId: String(sData[i][2] || ""), cariAd: String(sData[i][3] || ""), belgeTipi: String(sData[i][8] || "") || "Fatura", durum: String(sData[i][12] || "") || "Beklemede" };
      break;
    }
  }
  if (!siparis) return { ok: false, hata: "Sipariş bulunamadı" };
  if (siparis.belgeTipi !== "Sipariş") return { ok: false, hata: "Bu kayıt bir Sipariş değil" };
  const durumTanimlari = getSiparisDurumlari().durumlar;
  const aktifDurumBilgi = durumTanimlari.find(d => d.ad === siparis.durum);
  if (!aktifDurumBilgi || !aktifDurumBilgi.aktarilabilir) {
    const aktarilabilirler = durumTanimlari.filter(d => d.aktarilabilir).map(d => d.ad).join(", ") || "(hiçbiri işaretli değil — Ayarlar > Sipariş Durumları'ndan işaretleyin)";
    return { ok: false, hata: "Sipariş durumu \"" + siparis.durum + "\" faturaya aktarıma izin vermiyor. Uygun durum(lar): " + aktarilabilirler };
  }

  const kData = kSheet.getDataRange().getValues();
  const kalemSatirIdx = {}; // kalemId -> sheet satır no (1-indexed)
  const kalemBilgi = {};    // kalemId -> {urunAdi, birim, birimFiyat, iskontoYuzde, kdvOrani, miktar, faturalananMiktar}
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== siparisId) continue;
    const kId = String(row[0]);
    kalemSatirIdx[kId] = i + 1;
    kalemBilgi[kId] = {
      urunAdi: String(row[2] || ""), miktar: parseFloat(row[3]) || 0, birim: String(row[4] || ""),
      birimFiyat: parseFloat(row[5]) || 0, iskontoYuzde: parseFloat(row[7]) || 0, kdvOrani: parseFloat(row[8]) || 0,
      faturalananMiktar: parseFloat(row[9]) || 0, stokKodu: String(row[10] || ""),
    };
  }

  const yeniFaturaKalemleri = [];
  const guncellenecekler = []; // {satirIdx, yeniFaturalananMiktar}
  for (const istek of istekKalemleri) {
    const kId = String(istek.kalemId || "");
    const aktarilan = parseFloat(istek.aktarilanMiktar) || 0;
    const bilgi = kalemBilgi[kId];
    if (!bilgi) return { ok: false, hata: "Sipariş kalemi bulunamadı: " + kId };
    if (aktarilan <= 0) continue;
    const kalan = bilgi.miktar - bilgi.faturalananMiktar;
    if (aktarilan > kalan + 0.0001) {
      return { ok: false, hata: "'" + bilgi.urunAdi + "' için aktarılan miktar (" + aktarilan + "), kalan miktardan (" + kalan + ") fazla olamaz" };
    }
    yeniFaturaKalemleri.push({
      urunAdi: bilgi.urunAdi, miktar: aktarilan, birim: bilgi.birim,
      birimFiyat: bilgi.birimFiyat, iskontoYuzde: bilgi.iskontoYuzde, kdvOrani: bilgi.kdvOrani,
      stokKodu: bilgi.stokKodu,
    });
    guncellenecekler.push({ satirIdx: kalemSatirIdx[kId], yeniFaturalananMiktar: bilgi.faturalananMiktar + aktarilan });
  }
  if (yeniFaturaKalemleri.length === 0) return { ok: false, hata: "Aktarılacak geçerli bir miktar girilmedi" };

  const faturaSonuc = saveSatis({
    cariId: siparis.cariId, cariAd: siparis.cariAd,
    tarih: body.tarih, odemeTipi: body.odemeTipi, bankaHesapId: body.bankaHesapId, vade: body.vade,
    aciklama: String(body.aciklama || ("Sipariş #" + siparisId.slice(-6) + "'den aktarıldı")),
    belgeTipi: "Fatura", kaynakSiparisId: siparisId,
    kalemler: yeniFaturaKalemleri,
  });
  if (!faturaSonuc.ok) return faturaSonuc;

  // Sipariş kalemlerindeki FATURALANAN_MIKTAR'ı güncelle.
  guncellenecekler.forEach(g => { kSheet.getRange(g.satirIdx, 10).setValue(g.yeniFaturalananMiktar); });
  cacheTemizle(["stokTanimListesi", "satisListesi"]); // güncel stok hesaplamaları vb. için (dolaylı etkisi olmasa da güvenli taraf)

  return { ok: true, faturaId: faturaSonuc.id, toplamTutar: faturaSonuc.toplamTutar };
}

// body: { id, durum } — Sipariş'in elle takip edilen durumunu günceller
// (Beklemede/Onaylandı/Teslim Edildi/Haber Verecek). Faturalanma durumu
// (Muhasebelendi/Kısmen Faturalandı) bundan bağımsız, otomatik hesaplanır.
function siparisDurumGuncelle(body) {
  const id = String(body.id || "").trim();
  const durum = String(body.durum || "");
  if (!id) return { ok: false, hata: "id gerekli" };
  if (!getSiparisDurumlari().durumlar.map(d => d.ad).includes(durum)) return { ok: false, hata: "Geçersiz durum" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      if (String(data[i][8] || "") !== "Sipariş") return { ok: false, hata: "Bu kayıt bir Sipariş değil" };
      sSheet.getRange(i + 1, 13).setValue(durum);
      cacheTemizle(["satisListesi"]);
      return { ok: true };
    }
  }
  return { ok: false, hata: "Sipariş bulunamadı" };
}

// Bir carinin tüm siparişlerini (durumlarıyla birlikte) döner — Cari detayındaki
// "Siparişler" bölümü için.
function getCariSiparisListesi(cariId) {
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const res = getSatisListesi();
  if (!res.ok) return res;
  const siparisler = res.satislar.filter(s => s.cariId === String(cariId) && s.belgeTipi === "Sipariş");
  return { ok: true, siparisler: siparisler };
}// body: { id }
function silSatis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sSheet.getDataRange().getValues();

  let cariId = "";
  let kaynakSiparisId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      kaynakSiparisId = String(data[i][11] || "");
      sSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Satış bulunamadı" };

  // Bu satışın otomatik yazdığı Stok Hareket Raporu satırlarını da geri al.
  stokHareketOtomatikSil(ss, id);

  // Kalemlerini sil (silmeden önce kaynak sipariş varsa geri almak için okuyoruz)
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  const kData = kSheet.getDataRange().getValues();
  const silinenKalemler = []; // {urunAdi, miktar} — kaynak sipariş varsa faturalanan miktarı geri almak için
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) {
      if (kaynakSiparisId) silinenKalemler.push({ urunAdi: String(kData[i][2] || ""), miktar: parseFloat(kData[i][3]) || 0 });
      kSheet.deleteRow(i + 1);
    }
  }

  // Bu fatura bir Sipariş'ten (kısmen) oluşturulmuşsa, o siparişin kalemlerindeki
  // FATURALANAN_MIKTAR'ı geri al (ürün adı eşleştirmesiyle) — sipariş yeniden
  // "Bekliyor/Kısmen Faturalandı" durumuna dönsün.
  if (kaynakSiparisId && silinenKalemler.length > 0) {
    const kData2 = kSheet.getDataRange().getValues();
    silinenKalemler.forEach(silinen => {
      for (let i = 1; i < kData2.length; i++) {
        if (String(kData2[i][1]) === kaynakSiparisId && String(kData2[i][2] || "") === silinen.urunAdi) {
          const mevcutFaturalanan = parseFloat(kData2[i][9]) || 0;
          kSheet.getRange(i + 1, 10).setValue(Math.max(0, mevcutFaturalanan - silinen.miktar));
          break;
        }
      }
    });
  }

  // Cariye eklenmiş olan otomatik Borç hareketini bul ve geri al
  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("SATIS:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  // Bu satışla ilişkili bir Havale banka hareketi varsa geri al.
  bankaHesapHareketSilByAciklamaOnPrefix("SATIS:" + id);

  cacheTemizle(["satisListesi"]);
  return { ok: true };
}

// ════════════════════════════════════════════════
// ALIŞ MODÜLÜ
// Satış modülünün aynası ama ters yönlü: Alış yapılınca biz tedarikçiye
// borçlanırız, bu yüzden cariye "Alacak" hareketi eklenir (bakiye negatife
// gider = biz borçluyuz). Stoktan bağımsız (ürün serbest metin).
// ════════════════════════════════════════════════

function getAlisListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = aSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      toplamTutar: parseFloat(row[4]) || 0, odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]),
    });
  }
  sonuc.reverse();
  return { ok: true, alislar: sonuc };
}

function getAlisDetay(alisId) {
  if (!alisId) return { ok: false, hata: "alisId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemStokKoduColonu(kSheet);

  const data = aSheet.getDataRange().getValues();
  let alis = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(alisId)) {
      alis = {
        id: String(data[i][0]), tarih: String(data[i][1] || ""), cariId: String(data[i][2] || ""),
        cariAd: String(data[i][3] || ""), toplamTutar: parseFloat(data[i][4]) || 0,
        odemeTipi: String(data[i][5] || ""), aciklama: String(data[i][6] || ""), kayitTarihi: String(data[i][7] || ""),
      };
      break;
    }
  }
  if (!alis) return { ok: false, hata: "Alış bulunamadı" };

  const kData = kSheet.getDataRange().getValues();
  const kalemler = [];
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== String(alisId)) continue;
    kalemler.push({
      id: String(row[0]), alisId: String(row[1]), urunAdi: String(row[2] || ""),
      miktar: parseFloat(row[3]) || 0, birim: String(row[4] || ""),
      birimFiyat: parseFloat(row[5]) || 0, tutar: parseFloat(row[6]) || 0,
      stokKodu: String(row[7] || ""),
    });
  }
  return { ok: true, alis: alis, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, odemeTipi, aciklama,
//         kalemler: [{urunAdi,miktar,birim,birimFiyat,stokKodu (opsiyonel),
//                     stokKartiOlustur (opsiyonel, true ise stokKodu StokTanimlari'nda
//                     yoksa otomatik yeni bir stok kartı oluşturulur)}] }
function saveAlis(body) {
  const kalemler = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (kalemler.length === 0) return { ok: false, hata: "En az bir ürün kalemi eklemelisiniz" };
  for (const k of kalemler) {
    if (!String(k.urunAdi || "").trim()) return { ok: false, hata: "Kalemlerde ürün adı gerekli" };
    if (!(parseFloat(k.miktar) > 0)) return { ok: false, hata: "Kalemlerde miktar sıfırdan büyük olmalı" };
    if (!(parseFloat(k.birimFiyat) >= 0)) return { ok: false, hata: "Kalemlerde birim fiyat geçersiz" };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemStokKoduColonu(kSheet);

  // stokKartiOlustur işaretli ve StokTanimlari'nda henüz olmayan stok kodları için
  // otomatik, minimal bir stok kartı oluşturulur (stok kodu + ürün adı ile).
  const olusturulacaklar = kalemler.filter(k => k.stokKartiOlustur && String(k.stokKodu || "").trim());
  if (olusturulacaklar.length > 0) {
    const mevcutStoklar = getStokTanimListesi().kalemler;
    const mevcutKoduSeti = {};
    mevcutStoklar.forEach(s => { if (s.stokKodu) mevcutKoduSeti[s.stokKodu] = true; });
    olusturulacaklar.forEach(k => {
      const kod = String(k.stokKodu).trim();
      if (mevcutKoduSeti[kod]) return; // aradan başka bir kalem zaten oluşturmuş olabilir
      saveStokTanim({ stokKodu: kod, stokAdi: String(k.urunAdi).trim(), birim1: String(k.birim || "adet") });
      mevcutKoduSeti[kod] = true;
    });
  }

  const cariId = String(body.cariId || "").trim();
  let cariAd = String(body.cariAd || "").trim();
  if (cariId) {
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
    }
  }
  if (!cariAd) cariAd = "Peşin Tedarikçi";

  let toplamTutar = 0;
  kalemler.forEach(k => { toplamTutar += (parseFloat(k.miktar) || 0) * (parseFloat(k.birimFiyat) || 0); });

  const id = "al_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  aSheet.appendRow([id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi]);

  kalemler.forEach((k, idx) => {
    const kId = "ak_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, String(k.stokKodu || "").trim()]);
  });

  // Stok Hareket Raporu'na Alış Faturası girişi otomatik yazılır (Alış modülünde
  // Teklif/Sipariş ayrımı yok, her kayıt doğrudan fiili bir alış kabul edilir).
  stokHareketOtomatikYaz(ss, kalemler, tarih, "Giriş", "Alış Faturası", id, "Alış Faturası — " + cariAd);

  // Cari seçildiyse, tutar kadar otomatik Alacak hareketi ekle (biz tedarikçiye borçlanırız).
  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Alacak",
      tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("ALIS", id, "alis", body.aciklama),
    });
  }

  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// body: { id }
function silAlis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = aSheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      aSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Alış bulunamadı" };

  // Bu alışın otomatik yazdığı Stok Hareket Raporu satırlarını da geri al.
  stokHareketOtomatikSil(ss, id);

  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  const kData = kSheet.getDataRange().getValues();
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("ALIS:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  // Bu alış bir "bekleyen e-fatura" onayından oluşmuşsa (ALIS_ID eşleşmesiyle), o faturanın
  // "Onaylandı" durum kaydını da sil — fatura tekrar "Bekliyor" durumuna dönsün ve yeniden işlenebilsin.
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = durumData.length - 1; i >= 1; i--) {
    if (String(durumData[i][2] || "") === id) { durumSheet.deleteRow(i + 1); break; }
  }

  return { ok: true };
}

// ════════════════════════════════════════════════
// ALIŞ İADESİ (Alış > İade — tedarikçiye yapılan mal iadesi)
// Alış'ın ayna görüntüsü ama Alış'ın da tersi yönlü: iade yapılınca
// tedarikçiye olan borcumuz AZALIR, bu yüzden cariye "Borç" hareketi
// eklenir (Alış'ta "Alacak" eklenmesinin tam tersi). Stoktan bağımsız.
// ════════════════════════════════════════════════

function getAlisIadeListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = aSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      toplamTutar: parseFloat(row[4]) || 0, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, iadeler: sonuc };
}

function getAlisIadeDetay(iadeId) {
  if (!iadeId) return { ok: false, hata: "iadeId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);

  const data = aSheet.getDataRange().getValues();
  let iade = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(iadeId)) {
      iade = {
        id: String(data[i][0]), tarih: hucreTarihStr(data[i][1]), cariId: String(data[i][2] || ""),
        cariAd: String(data[i][3] || ""), toplamTutar: parseFloat(data[i][4]) || 0,
        aciklama: String(data[i][5] || ""), kayitTarihi: hucreTarihStr(data[i][6]),
      };
      break;
    }
  }
  if (!iade) return { ok: false, hata: "İade bulunamadı" };

  const kData = kSheet.getDataRange().getValues();
  const kalemler = [];
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== String(iadeId)) continue;
    kalemler.push({
      id: String(row[0]), iadeId: String(row[1]), urunAdi: String(row[2] || ""),
      miktar: parseFloat(row[3]) || 0, birim: String(row[4] || ""),
      birimFiyat: parseFloat(row[5]) || 0, tutar: parseFloat(row[6]) || 0,
    });
  }
  return { ok: true, iade: iade, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, aciklama, kalemler: [{urunAdi,miktar,birim,birimFiyat}] }
function saveAlisIade(body) {
  const kalemler = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (kalemler.length === 0) return { ok: false, hata: "En az bir ürün kalemi eklemelisiniz" };
  for (const k of kalemler) {
    if (!String(k.urunAdi || "").trim()) return { ok: false, hata: "Kalemlerde ürün adı gerekli" };
    if (!(parseFloat(k.miktar) > 0)) return { ok: false, hata: "Kalemlerde miktar sıfırdan büyük olmalı" };
    if (!(parseFloat(k.birimFiyat) >= 0)) return { ok: false, hata: "Kalemlerde birim fiyat geçersiz" };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);

  const cariId = String(body.cariId || "").trim();
  let cariAd = String(body.cariAd || "").trim();
  if (cariId) {
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
    }
  }
  if (!cariAd) cariAd = "Peşin Tedarikçi";

  let toplamTutar = 0;
  kalemler.forEach(k => { toplamTutar += (parseFloat(k.miktar) || 0) * (parseFloat(k.birimFiyat) || 0); });

  const id = "ali_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  aSheet.appendRow([id, tarih, cariId, cariAd, toplamTutar, String(body.aciklama || ""), kayitTarihi]);

  kalemler.forEach((k, idx) => {
    const kId = "aik_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat]);
  });

  // Alış İadesi = tedarikçiye geri gönderilen mal = depodan Çıkış.
  stokHareketOtomatikYaz(ss, kalemler, tarih, "Çıkış", "Alış İadesi", id, "Alış İadesi — " + cariAd);

  // Cari seçildiyse, tutar kadar Borç hareketi ekle (tedarikçiye olan borcumuz azalır).
  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Borç",
      tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("ALISIADE", id, "alisiade", body.aciklama),
    });
  }

  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// body: { id }
function silAlisIade(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = aSheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      aSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "İade bulunamadı" };

  // Bu iadenin otomatik yazdığı Stok Hareket Raporu satırlarını da geri al.
  stokHareketOtomatikSil(ss, id);

  const kSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
  const kData = kSheet.getDataRange().getValues();
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("ALISIADE:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  return { ok: true };
}

// ════════════════════════════════════════════════
// TAHSİLAT MODÜLÜ (müşteriden nakit/havale tahsil edilmesi)
// Cari zorunludur. Kaydedilince cariye "Alacak" hareketi eklenir
// (müşterinin borcu azalır). TAHSILAT:<id> işaretiyle geri alınabilir.
// ════════════════════════════════════════════════

function ensureTahsilatPosColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "POS_HESAP_ID") {
    sheet.getRange(1, 9).setValue("POS_HESAP_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
}

function getTahsilatListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"]);
  ensureTahsilatPosColonu(tSheet);
  const data = tSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]), posHesapId: String(row[8] || ""),
    });
  }
  sonuc.reverse();
  return { ok: true, tahsilatlar: sonuc };
}

// body: { cariId, tarih, tutar, yontem, aciklama, posHesapId (yöntem "Kredi Kartı" ise) }
function saveTahsilat(body) {
  const cariId = String(body.cariId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!cariId) return { ok: false, hata: "Cari seçimi gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
    ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
  const cData = cSheet.getDataRange().getValues();
  let cariAd = "";
  for (let i = 1; i < cData.length; i++) {
    if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
  }
  if (!cariAd) return { ok: false, hata: "Cari bulunamadı" };

  const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"]);
  ensureTahsilatPosColonu(tSheet);
  const id = "th_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const yontem = String(body.yontem || "Nakit");
  const posHesapId = String(body.posHesapId || "").trim();
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  tSheet.appendRow([id, tarih, cariId, cariAd, tutar, yontem, String(body.aciklama || ""), kayitTarihi, posHesapId]);

  cariHareketEkle({
    cariId: cariId, tarih: tarih, tip: "Alacak", tutar: tutar,
    aciklama: cariHareketAciklamaOlustur("TAHSILAT", id, "tahsilat_" + yontem, body.aciklama),
  });

  // Kredi Kartı ile tahsilat yapıldıysa ve bir POS hesabı seçildiyse,
  // o POS hesabına BORÇ kaydı düşülür (POS/banka bize bu tutarı ödeyecek).
  if (yontem === "Kredi Kartı" && posHesapId) {
    posHareketEkle(posHesapId, tarih, "Borç", tutar, cariHareketAciklamaOlustur("TAHSILAT", id, "tahsilat_" + yontem, body.aciklama));
  }

  // Havale/EFT ile tahsilat yapıldıysa ve bir banka hesabı seçildiyse, o hesaba GİRİŞ kaydı düşülür.
  if (yontem === "Havale/EFT" && bankaHesapId) {
    bankaHesapHareketEkle(bankaHesapId, tarih, "Giriş", tutar, cariHareketAciklamaOlustur("TAHSILAT", id, "tahsilat_" + yontem, body.aciklama));
  }

  return { ok: true, id: id };
}

// body: { id }
// body: { id, cariId, tarih, yontem, tutar, aciklama, posHesapId, bankaHesapId }
// Var olan tahsilatı (ve cariye/POS'a/bankaya düşen bağlantılı hareketlerini) silip
// aynı id yerine güncellenmiş verilerle yeniden oluşturur — silTahsilat zaten tüm
// bağlantılı kayıtları temizlediği için en güvenli "düzenleme" yolu budur.
function guncelleTahsilat(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const silSonuc = silTahsilat({ id });
  if (!silSonuc.ok) return silSonuc;
  return saveTahsilat(body);
}

function silTahsilat(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"]);
  const data = tSheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      tSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Tahsilat bulunamadı" };

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("TAHSILAT:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  // Kredi kartı tahsilatıyla birlikte bir POS hesabına düşülmüş BORÇ kaydı varsa geri al.
  posHareketSilByAciklamaOnPrefix("TAHSILAT:" + id);
  bankaHesapHareketSilByAciklamaOnPrefix("TAHSILAT:" + id);

  return { ok: true };
}

// ════════════════════════════════════════════════
// ÖDEME MODÜLÜ (tedarikçiye nakit/havale ödenmesi)
// Cari zorunludur. Kaydedilince cariye "Borç" hareketi eklenir
// (tedarikçiye olan borcumuz azalır). ODEME:<id> işaretiyle geri alınabilir.
// ════════════════════════════════════════════════

function ensureOdemePosBankaColonlari(sheet) {
  const posBaslik = sheet.getRange(1, 9).getValue();
  if (String(posBaslik || "") !== "POS_HESAP_ID") {
    sheet.getRange(1, 9).setValue("POS_HESAP_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
  const bankaBaslik = sheet.getRange(1, 10).getValue();
  if (String(bankaBaslik || "") !== "BANKA_HESAP_ID") {
    sheet.getRange(1, 10).setValue("BANKA_HESAP_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
}

function getOdemeListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
  ensureOdemePosBankaColonlari(oSheet);
  const data = oSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]),
    });
  }
  sonuc.reverse();
  return { ok: true, odemeler: sonuc };
}

// body: { cariId, tarih, tutar, yontem, aciklama, posHesapId, bankaHesapId }
function saveOdeme(body) {
  const cariId = String(body.cariId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!cariId) return { ok: false, hata: "Cari seçimi gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
    ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
  const cData = cSheet.getDataRange().getValues();
  let cariAd = "";
  for (let i = 1; i < cData.length; i++) {
    if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
  }
  if (!cariAd) return { ok: false, hata: "Cari bulunamadı" };

  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
  ensureOdemePosBankaColonlari(oSheet);
  const id = "od_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const yontem = String(body.yontem || "Nakit");
  const posHesapId = String(body.posHesapId || "").trim();
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  oSheet.appendRow([id, tarih, cariId, cariAd, tutar, yontem, String(body.aciklama || ""), kayitTarihi, posHesapId, bankaHesapId]);

  cariHareketEkle({
    cariId: cariId, tarih: tarih, tip: "Borç", tutar: tutar,
    aciklama: cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama),
  });

  // Kredi Kartı ile ödeme yapıldıysa ve bir POS hesabı seçildiyse, o hesaba
  // Alacak kaydı düşülür (Tahsilat'ın tam tersi yönde — kartla ödeme yaptık).
  if (yontem === "Kredi Kartı" && posHesapId) {
    posHareketEkle(posHesapId, tarih, "Alacak", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama));
  }

  // Havale/EFT ile ödeme yapıldıysa ve bir banka hesabı seçildiyse, o hesaptan Çıkış kaydı düşülür.
  if (yontem === "Havale/EFT" && bankaHesapId) {
    bankaHesapHareketEkle(bankaHesapId, tarih, "Çıkış", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama));
  }

  return { ok: true, id: id };
}

// body: { id }
function silOdeme(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"]);
  const data = oSheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      oSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Ödeme bulunamadı" };

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("ODEME:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  // Kredi kartı/havale ile birlikte POS ya da banka hesabına düşülmüş kaydı varsa geri al.
  posHareketSilByAciklamaOnPrefix("ODEME:" + id);
  bankaHesapHareketSilByAciklamaOnPrefix("ODEME:" + id);

  return { ok: true };
}

// ════════════════════════════════════════════════
// FİNANS MODÜLÜ — genel özet (tüm zamanlar)
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// ÇEK/SENET MODÜLÜ (Wolvox referanslı)
// Alınan (müşteriden aldığımız) veya Verilen (tedarikçiye verdiğimiz) çek/
// senetlerin vade takibi. Kayıt oluşturulunca cari hareketine hemen Alacak/
// Borç yazılır (Tahsilat/Ödeme mantığıyla aynı) — çek "elde var" sayılır.
// Sonradan tahsil/ödeme (kısmi de olabilir), ciro veya karşılıksız
// işaretlenerek DURUM ve KALAN_TUTAR güncellenir. Kısmi işlemler
// CekSenetHareketleri defterine ayrıca düşer. CEK:<id> önekiyle ilişkili
// cari hareketi geri alınabilir.
// ════════════════════════════════════════════════
const CEK_SENET_BASLIKLAR = ["ID","TIP","CARI_ID","CARI_AD","TUTAR","KALAN_TUTAR","SERI_NO","BANKA_ADI","DUZENLENME_TARIHI","VADE","DURUM","ACIKLAMA","KAYIT_TARIHI"];
const CEK_SENET_HAREKET_BASLIKLAR = ["ID","CEK_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"];

function getCekSenetListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const bugun = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const vade = hucreTarihStr(row[9]);
    const durum = String(row[10] || "Portföyde");
    sonuc.push({
      id: id, tip: String(row[1] || ""), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, kalanTutar: parseFloat(row[5]) || 0,
      seriNo: String(row[6] || ""), bankaAdi: String(row[7] || ""),
      duzenlenmeTarihi: hucreTarihStr(row[8]), vade: vade, durum: durum,
      aciklama: String(row[11] || ""), kayitTarihi: hucreTarihStr(row[12]),
      gecikmis: durum === "Portföyde" && !!vade && vade < bugun,
    });
  }
  // Portföydekiler vadeye göre (en yakın vade önce), kapananlar en sona.
  sonuc.sort((a, b) => {
    const aAcik = a.durum === "Portföyde", bAcik = b.durum === "Portföyde";
    if (aAcik !== bAcik) return aAcik ? -1 : 1;
    return (a.vade || "9999") < (b.vade || "9999") ? -1 : 1;
  });
  return { ok: true, cekSenetler: sonuc };
}

function getCekSenetDetay(id) {
  const cekId = String(id || "");
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let cek = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === cekId) {
      const row = data[i];
      cek = {
        id: String(row[0]), tip: String(row[1] || ""), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kalanTutar: parseFloat(row[5]) || 0,
        seriNo: String(row[6] || ""), bankaAdi: String(row[7] || ""),
        duzenlenmeTarihi: hucreTarihStr(row[8]), vade: hucreTarihStr(row[9]), durum: String(row[10] || ""),
        aciklama: String(row[11] || ""), kayitTarihi: hucreTarihStr(row[12]),
      };
      break;
    }
  }
  if (!cek) return { ok: false, hata: "Çek/senet bulunamadı" };

  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hData = hSheet.getDataRange().getValues();
  const hareketler = [];
  for (let i = 1; i < hData.length; i++) {
    const row = hData[i];
    if (String(row[1]) !== cekId) continue;
    hareketler.push({
      id: String(row[0]), tarih: hucreTarihStr(row[2]), tip: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  hareketler.reverse();
  return { ok: true, cek: cek, hareketler: hareketler };
}

// body: { cariId, tip (Alınan/Verilen), tutar, seriNo, bankaAdi, duzenlenmeTarihi, vade, aciklama }
function saveCekSenet(body) {
  const cariId = String(body.cariId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  const tip = String(body.tip || "Alınan");
  if (!cariId) return { ok: false, hata: "Cari seçimi gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };
  if (tip !== "Alınan" && tip !== "Verilen") return { ok: false, hata: "Geçersiz tip" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
    ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
  const cData = cSheet.getDataRange().getValues();
  let cariAd = "";
  for (let i = 1; i < cData.length; i++) {
    if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
  }
  if (!cariAd) return { ok: false, hata: "Cari bulunamadı" };

  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const id = "cs_" + Date.now();
  const duzenlenmeTarihi = String(body.duzenlenmeTarihi || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const vade = String(body.vade || "");
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  sheet.appendRow([id, tip, cariId, cariAd, tutar, tutar, String(body.seriNo || ""), String(body.bankaAdi || ""),
    duzenlenmeTarihi, vade, "Portföyde", String(body.aciklama || ""), kayitTarihi]);

  // Alınan çek: müşteriden aldık → borcu kapanır (Alacak). Verilen çek: tedarikçiye borcumuzu kapattık (Borç).
  cariHareketEkle({
    cariId: cariId, tarih: duzenlenmeTarihi, tip: tip === "Alınan" ? "Alacak" : "Borç", tutar: tutar,
    aciklama: cariHareketAciklamaOlustur("CEK", id, tip === "Alınan" ? "cek_alinan" : "cek_verilen", body.aciklama),
    vade: vade,
  });

  return { ok: true, id: id };
}

// body: { id } — henüz hiç tahsilat/ödeme işlenmemiş bir çek/senedi tamamen siler.
function silCekSenet(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      sheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Çek/senet bulunamadı" };

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("CEK:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi"]);
        break;
      }
    }
  }

  // Kısmi tahsilat/ödeme geçmişini de temizle.
  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hData = hSheet.getDataRange().getValues();
  for (let i = hData.length - 1; i >= 1; i--) {
    if (String(hData[i][1]) === id) hSheet.deleteRow(i + 1);
  }

  return { ok: true };
}

// body: { id, tarih, tutar, aciklama } — kısmi veya tam tahsilat/ödeme.
// Alınan çekte "Tahsilat", Verilen çekte "Ödeme" hareketi olarak CekSenetHareketleri'ne düşer.
// Kalan tutar sıfırlanınca durum otomatik "Tahsil Edildi" / "Ödendi" olur.
function cekSenetIslemYap(body) {
  const id = String(body.id || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!id) return { ok: false, hata: "id gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let rowIdx = -1, tip = "", kalanTutar = 0, durum = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      rowIdx = i + 1; tip = String(data[i][1] || "");
      kalanTutar = parseFloat(data[i][5]) || 0; durum = String(data[i][10] || "");
      break;
    }
  }
  if (rowIdx === -1) return { ok: false, hata: "Çek/senet bulunamadı" };
  if (durum !== "Portföyde") return { ok: false, hata: "Bu çek/senet zaten kapatılmış (" + durum + ")" };
  if (tutar > kalanTutar + 0.01) return { ok: false, hata: "Tutar kalan tutardan (" + kalanTutar + ") büyük olamaz" };

  const yeniKalan = Math.round((kalanTutar - tutar) * 100) / 100;
  const yeniDurum = yeniKalan <= 0.01 ? (tip === "Alınan" ? "Tahsil Edildi" : "Ödendi") : "Portföyde";
  sheet.getRange(rowIdx, 6).setValue(yeniKalan);   // KALAN_TUTAR
  sheet.getRange(rowIdx, 11).setValue(yeniDurum);  // DURUM

  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hId = "csh_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  hSheet.appendRow([hId, id, tarih, tip === "Alınan" ? "Tahsilat" : "Ödeme", tutar, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  return { ok: true, kalanTutar: yeniKalan, durum: yeniDurum };
}

// body: { id, durum ("Karşılıksız" veya "Ciro Edildi"), aciklama }
// Portföydeki bir çek/senedi tahsil/ödeme yapılmadan kapatır (ör. karşılıksız çıktı ya
// da başka bir tedarikçiye ciro edildi). Cari bakiyesine dokunmaz — o hareket zaten
// kayıt anında düşmüştü; sadece durum bilgisini günceller.
function cekSenetDurumGuncelle(body) {
  const id = String(body.id || "").trim();
  const durum = String(body.durum || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  if (durum !== "Karşılıksız" && durum !== "Ciro Edildi") return { ok: false, hata: "Geçersiz durum" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let rowIdx = -1, mevcutDurum = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { rowIdx = i + 1; mevcutDurum = String(data[i][10] || ""); break; }
  }
  if (rowIdx === -1) return { ok: false, hata: "Çek/senet bulunamadı" };
  if (mevcutDurum !== "Portföyde") return { ok: false, hata: "Bu çek/senet zaten kapatılmış (" + mevcutDurum + ")" };

  sheet.getRange(rowIdx, 11).setValue(durum);

  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hId = "csh_" + Date.now();
  hSheet.appendRow([hId, id, Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"), durum, 0,
    String(body.aciklama || ""), Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  return { ok: true };
}

// ════════════════════════════════════════════════
// BEKLEYEN ALIŞ FATURALARI (fincanlaryapi@gmail.com hesabındaki e-Fatura/fiyat
// otomasyonunun beslediği FATURAFIYAT sayfasından — stok-panel'in "Faturalar"
// sayfasıyla AYNI kaynak). Bu sayfa sadece fiyat/tedarikçi/fatura bilgisi taşır,
// MİKTAR bilgisi yoktur — o yüzden onay ekranında kullanıcı miktarları girer.
// Onaylanan fatura mevcut saveAlis() ile gerçek bir Alış kaydına dönüşür ve
// cariye borç hareketi düşer; AlisFaturaDurum sayfasında FATURA_NO bazında
// Onaylandı/Reddedildi olarak işaretlenip bekleyen listeden düşer.
// ════════════════════════════════════════════════
const DIS_FIYAT_SHEET_ID  = "19t4MsvudC8X7knZ_dymBm5fghcbZcpAMwOmUXZxDPPQ";
const DIS_FIYAT_SHEET_ADI = "FATURAFIYAT";
const ALIS_FATURA_DURUM_BASLIKLAR = ["FATURA_NO","DURUM","ALIS_ID","ACIKLAMA","ISLEM_TARIHI"];

// ════════════════════════════════════════════════
// TEDARİKÇİ → CARİ EŞLEŞTİRME HAFIZASI — bekleyen (e-fatura) alış faturasındaki
// TEDARIKCI adı bir kere bir cariye onaylanınca burada hatırlanır; sonraki
// faturalarda aynı tedarikçi geldiğinde cari otomatik seçili gelir (yine de
// kullanıcı Onayla'ya basmadan işlenmez).
// ════════════════════════════════════════════════
const TEDARIKCI_ESLESME_BASLIKLAR = ["TEDARIKCI","CARI_ID","GUNCELLEME_TARIHI"];

function tedarikciCariEslesmeOku(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciCariEslesme, TEDARIKCI_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const ted = String(data[i][0] || "").trim().toLocaleLowerCase('tr');
    if (ted) map[ted] = String(data[i][1] || "");
  }
  return map;
}

function tedarikciCariEslesmeKaydet(ss, tedarikci, cariId) {
  const t = String(tedarikci || "").trim();
  if (!t || !cariId) return;
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciCariEslesme, TEDARIKCI_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const key = t.toLocaleLowerCase('tr');
  const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim().toLocaleLowerCase('tr') === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[cariId, simdi]]);
      return;
    }
  }
  sheet.appendRow([t, cariId, simdi]);
}

function getBekleyenAlisFaturalari() {
  let disData;
  try {
    const disSs = SpreadsheetApp.openById(DIS_FIYAT_SHEET_ID);
    const disSh = disSs.getSheetByName(DIS_FIYAT_SHEET_ADI);
    if (!disSh) return { ok: false, hata: "FATURAFIYAT sayfası bulunamadı" };
    disData = disSh.getDataRange().getValues();
  } catch (e) {
    return { ok: false, hata: "Fatura kaynağına erişilemedi: " + e.message };
  }
  if (disData.length < 2) return { ok: true, faturalar: [] };

  const h = disData[0];
  const col = {
    kod: h.indexOf("STOK_KODU"), ad: h.indexOf("STOK_ADI"), mik: h.indexOf("MIKTAR"), fiy: h.indexOf("BIRIM_FIYAT"),
    isk: h.indexOf("ISKONTO"), net: h.indexOf("NET_FIYAT"), nak: h.indexOf("NAKLIYE_PAYI"),
    kdv: h.indexOf("KDV_ORANI"), fno: h.indexOf("FATURA_NO"), ftar: h.indexOf("FATURA_TARIHI"),
    ted: h.indexOf("TEDARIKCI"), lnk: h.indexOf("FATURA_LINK"), edm: h.indexOf("EDM_LINK"),
  };

  // İşlenmiş (onaylanmış/reddedilmiş) fatura numaralarını oku.
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();

  // "Onaylandı" durumundaki kayıtların bağlı olduğu Alış kaydı hâlâ var mı diye kontrol için
  // mevcut Alış ID'lerinin setini çıkar. Bağlı Alış silinmiş ama durum kaydı (eski, bu kontrolün
  // eklenmesinden önce oluşmuş) sahipsiz kalmışsa, o kaydı "Bekliyor"a döndürüp temizleriz.
  const alisSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const alisIdSeti = {};
  const alisData = alisSheet.getDataRange().getValues();
  for (let i = 1; i < alisData.length; i++) { const aid = String(alisData[i][0] || ""); if (aid) alisIdSeti[aid] = true; }

  const islenmis = {};
  const sahipsizSatirlar = []; // silinecek durumSheet satır indeksleri (1-tabanlı, aşağıdan yukarı)
  for (let i = 1; i < durumData.length; i++) {
    const fno = String(durumData[i][0] || "");
    if (!fno) continue;
    const durum = String(durumData[i][1] || "");
    const alisId = String(durumData[i][2] || "");
    if (durum === "Onaylandı" && alisId && !alisIdSeti[alisId]) {
      // Bağlı Alış kaydı artık yok — sahipsiz durum kaydı, temizlenip "Bekliyor"a döndürülecek.
      sahipsizSatirlar.push(i + 1);
      continue;
    }
    islenmis[fno] = { durum: durum, islemTarihi: String(durumData[i][4] || "") };
  }
  if (sahipsizSatirlar.length) {
    sahipsizSatirlar.sort((a, b) => b - a).forEach(r => durumSheet.deleteRow(r));
  }

  // Stok kodu StokTanimlari'nda kayıtlı mı diye kontrol için hazır kod seti.
  const stokTanimSonuc = getStokTanimListesi();
  const stokKoduSeti = {};
  (stokTanimSonuc.kalemler || []).forEach(s => { if (s.stokKodu) stokKoduSeti[s.stokKodu] = true; });

  // Daha önce bu tedarikçi bir cariye eşlenmiş mi? Eşlenmişse onay ekranında otomatik seçili gelsin.
  const eslesmeMap = tedarikciCariEslesmeOku(ss);
  const cariListeSonuc = getCariListesi();
  const cariByIdMap = {};
  if (cariListeSonuc.ok) cariListeSonuc.cariler.forEach(c => { cariByIdMap[c.id] = c; });

  // FATURA_NO bazında grupla.
  const gruplar = {};
  for (let i = 1; i < disData.length; i++) {
    const row = disData[i];
    const fno = String(row[col.fno] || "").trim();
    if (!fno) continue;
    // Not: işlenmiş (onaylanmış/reddedilmiş) faturalar artık listeden ATLANMIYOR —
    // "İşlendi" durumuyla birlikte gösteriliyor, tekrar onaya kapatılıyor (bkz. onaylaAlisFaturasi).

    if (!gruplar[fno]) {
      gruplar[fno] = {
        faturaNo: fno, tedarikci: String(row[col.ted] || ""), tarih: String(row[col.ftar] || ""),
        faturaLink: col.lnk >= 0 ? String(row[col.lnk] || "") : "",
        edmLink: col.edm >= 0 ? String(row[col.edm] || "") : "",
        kalemler: [],
      };
    }
    gruplar[fno].kalemler.push({
      stokKodu: String(row[col.kod] || ""), urunAdi: String(row[col.ad] || ""),
      stokVarMi: !!stokKoduSeti[String(row[col.kod] || "")],
      miktar: col.mik >= 0 ? (parseFloat(row[col.mik]) || 0) : 0,
      birimFiyat: parseFloat(row[col.fiy]) || 0, iskonto: parseFloat(row[col.isk]) || 0,
      netFiyat: parseFloat(row[col.net]) || 0, nakliyePayi: parseFloat(row[col.nak]) || 0,
      kdvOrani: parseFloat(row[col.kdv]) || 0,
    });
  }

  const sonuc = Object.values(gruplar).map(f => {
    f.kalemSayisi = f.kalemler.length;
    f.durum = islenmis[f.faturaNo] ? islenmis[f.faturaNo].durum : "Bekliyor";
    f.islemTarihi = islenmis[f.faturaNo] ? islenmis[f.faturaNo].islemTarihi : "";
    const eslesenCariId = eslesmeMap[String(f.tedarikci || "").trim().toLocaleLowerCase('tr')] || "";
    f.eslesenCariId = eslesenCariId;
    f.eslesenCariAd = eslesenCariId && cariByIdMap[eslesenCariId] ? cariByIdMap[eslesenCariId].ad : "";
    // Genel toplam = fatura tutarı (KDV dahil). Kaynak veride miktar olmadığından
    // birim fiyatlar üzerinden hesaplanıyor — gerçek fatura toplamı miktarla çarpılınca değişebilir.
    f.netToplam = f.kalemler.reduce((t, k) => t + k.netFiyat, 0);
    f.genelToplam = f.kalemler.reduce((t, k) => t + (k.netFiyat + k.nakliyePayi) * (1 + k.kdvOrani / 100) * (k.miktar > 0 ? k.miktar : 1), 0);
    // "gg/AA/yyyy" → sıralanabilir "yyyy-AA-gg" anahtarı.
    const parcalar = String(f.tarih || "").split("/");
    f.tarihSirala = parcalar.length === 3 ? `${parcalar[2]}-${parcalar[1].padStart(2,"0")}-${parcalar[0].padStart(2,"0")}` : "";
    return f;
  });
  sonuc.sort((a, b) => (b.tarihSirala || "").localeCompare(a.tarihSirala || ""));

  return { ok: true, faturalar: sonuc };
}

// body: { faturaNo, cariId, cariAd, tarih, odemeTipi, aciklama, kalemler: [{urunAdi,miktar,birim,birimFiyat}] }
// Kullanıcının onay ekranında miktarları girdiği satırlarla gerçek bir Alış kaydı oluşturur
// (mevcut saveAlis mantığıyla — cari borç hareketi dahil) ve faturayı Onaylandı olarak işaretler.
function onaylaAlisFaturasi(body) {
  const faturaNo = String(body.faturaNo || "").trim();
  if (!faturaNo) return { ok: false, hata: "faturaNo gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = 1; i < durumData.length; i++) {
    if (String(durumData[i][0]) === faturaNo) return { ok: false, hata: "Bu fatura zaten işlenmiş (" + durumData[i][1] + ")" };
  }

  const alisSonuc = saveAlis({
    cariId: body.cariId, cariAd: body.cariAd, tarih: body.tarih, odemeTipi: body.odemeTipi,
    aciklama: (String(body.aciklama || "").trim() || ("Fatura No: " + faturaNo)),
    kalemler: body.kalemler,
  });
  if (!alisSonuc.ok) return alisSonuc;

  durumSheet.appendRow([faturaNo, "Onaylandı", alisSonuc.id, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  // Gerçek bir cari seçilerek onaylandıysa, aynı tedarikçiden gelecek sonraki faturalar
  // için bu eşleşmeyi hatırla (bir sonraki onay ekranında otomatik seçili gelsin).
  if (body.cariId && body.tedarikci) {
    tedarikciCariEslesmeKaydet(ss, body.tedarikci, String(body.cariId).trim());
  }

  return { ok: true, alisId: alisSonuc.id, toplamTutar: alisSonuc.toplamTutar };
}

// body: { faturaNo, aciklama }
function reddetAlisFaturasi(body) {
  const faturaNo = String(body.faturaNo || "").trim();
  if (!faturaNo) return { ok: false, hata: "faturaNo gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = 1; i < durumData.length; i++) {
    if (String(durumData[i][0]) === faturaNo) return { ok: false, hata: "Bu fatura zaten işlenmiş (" + durumData[i][1] + ")" };
  }

  durumSheet.appendRow([faturaNo, "Reddedildi", "", String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  return { ok: true };
}

// body: { faturaNo }
// Bir faturanın durum kaydını (Onaylandı/Reddedildi) elle temizler, "Bekliyor"a döndürür.
// NOT: "Onaylandı" bir faturayı sıfırlamak durum kaydını siler ama oluşmuş Alış kaydını SİLMEZ —
// o kayıt hâlâ Alış listesinde durur; istenmiyorsa ayrıca Alış'tan silinmeli.
function sifirlaAlisFaturaDurum(body) {
  const faturaNo = String(body.faturaNo || "").trim();
  if (!faturaNo) return { ok: false, hata: "faturaNo gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = durumData.length - 1; i >= 1; i--) {
    if (String(durumData[i][0]) === faturaNo) { durumSheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, hata: "Bu fatura için işlenmiş bir kayıt bulunamadı" };
}

function getFinansOzet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  function toplamAl(sheetName, headers, kolonIdx) {
    const sheet = getOrCreateSheet(ss, sheetName, headers);
    const data = sheet.getDataRange().getValues();
    let toplam = 0;
    for (let i = 1; i < data.length; i++) toplam += parseFloat(data[i][kolonIdx]) || 0;
    return toplam;
  }

  const toplamSatis = toplamAl(SHEETS.satislar, ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"], 4);
  const toplamAlis = toplamAl(SHEETS.alislar, ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"], 4);
  const toplamTahsilat = toplamAl(SHEETS.tahsilatlar, ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"], 4);
  const toplamOdeme = toplamAl(SHEETS.odemeler, ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"], 4);

  const cariListesi = getCariListesi();
  let cariAlacaklarToplami = 0, cariBorclarToplami = 0;
  if (cariListesi.ok) {
    cariListesi.cariler.forEach(c => {
      if (c.bakiye > 0) cariAlacaklarToplami += c.bakiye;
      else cariBorclarToplami += Math.abs(c.bakiye);
    });
  }

  return {
    ok: true,
    toplamSatis: toplamSatis,
    toplamAlis: toplamAlis,
    toplamTahsilat: toplamTahsilat,
    toplamOdeme: toplamOdeme,
    kasaBakiyesi: toplamTahsilat - toplamOdeme,
    cariAlacaklarToplami: cariAlacaklarToplami,
    cariBorclarToplami: cariBorclarToplami,
  };
}

// ════════════════════════════════════════════════
// RAPOR MODÜLÜ — tarih aralığına göre dökümü
// body: { baslangic (yyyy-MM-dd, opsiyonel), bitis (yyyy-MM-dd, opsiyonel) }
// ════════════════════════════════════════════════

function getRaporOzet(body) {
  const baslangic = String(body.baslangic || "");
  const bitis = String(body.bitis || "");
  // yyyy-MM-dd formatında string karşılaştırması kronolojik sıralamayla aynı sonucu verir
  function araligaDahilMi(tarih) {
    if (baslangic && tarih < baslangic) return false;
    if (bitis && tarih > bitis) return false;
    return true;
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);

  function ozetCikar(sheetName, headers, tarihIdx, tutarIdx) {
    const sheet = getOrCreateSheet(ss, sheetName, headers);
    const data = sheet.getDataRange().getValues();
    let sayi = 0, toplam = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      if (!araligaDahilMi(String(row[tarihIdx] || ""))) continue;
      sayi++;
      toplam += parseFloat(row[tutarIdx]) || 0;
    }
    return { sayi: sayi, toplam: toplam };
  }

  const satis = ozetCikar(SHEETS.satislar, ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"], 1, 4);
  const alis = ozetCikar(SHEETS.alislar, ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"], 1, 4);
  const tahsilat = ozetCikar(SHEETS.tahsilatlar, ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"], 1, 4);
  const odeme = ozetCikar(SHEETS.odemeler, ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"], 1, 4);

  // En çok satılan ürünler (aralıktaki satışlara ait kalemlerden)
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const sData = sSheet.getDataRange().getValues();
  const araliktakiSatisIdleri = {};
  for (let i = 1; i < sData.length; i++) {
    const id = String(sData[i][0] || "");
    if (!id) continue;
    if (araligaDahilMi(String(sData[i][1] || ""))) araliktakiSatisIdleri[id] = true;
  }

  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  const kData = kSheet.getDataRange().getValues();
  const urunMap = {};
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    const satisId = String(row[1] || "");
    if (!araliktakiSatisIdleri[satisId]) continue;
    const urunAdi = String(row[2] || "");
    if (!urunAdi) continue;
    if (!urunMap[urunAdi]) urunMap[urunAdi] = { urunAdi: urunAdi, miktar: 0, tutar: 0 };
    urunMap[urunAdi].miktar += parseFloat(row[3]) || 0;
    urunMap[urunAdi].tutar += parseFloat(row[6]) || 0;
  }
  const enCokSatilanlar = Object.values(urunMap).sort((a, b) => b.tutar - a.tutar).slice(0, 8);

  return {
    ok: true,
    satis: satis, alis: alis, tahsilat: tahsilat, odeme: odeme,
    enCokSatilanlar: enCokSatilanlar,
  };
}

// Muhasebe programlarında bulunan klasik raporlar: Alış Fatura Raporu, Satış Fatura Raporu,
// Ürün Bazlı Hareket/Sipariş/Fatura Raporu. body: { tip, baslangic, bitis }
// tip: "alisFatura" | "satisFatura" | "urunBazliHareket" | "urunBazliSiparis" | "urunBazliFatura"
function getMuhasebeRaporu(body) {
  const tip = String(body.tip || "");
  const baslangic = String(body.baslangic || "");
  const bitis = String(body.bitis || "");
  function araligaDahilMi(tarih) {
    if (baslangic && tarih < baslangic) return false;
    if (bitis && tarih > bitis) return false;
    return true;
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (tip === "alisFatura") {
    const sheet = getOrCreateSheet(ss, SHEETS.alislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
    const data = sheet.getDataRange().getValues();
    const satirlar = [];
    let toplam = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] || !araligaDahilMi(hucreTarihStr(row[1]))) continue;
      const tutar = parseFloat(row[4]) || 0;
      toplam += tutar;
      satirlar.push({ id: String(row[0]), tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""),
        tutar: tutar, odemeTipi: String(row[5] || ""), aciklama: String(row[6] || "") });
    }
    satirlar.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    return { ok: true, tip: tip, satirlar: satirlar, toplam: toplam };
  }

  if (tip === "satisFatura") {
    const sheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sheet);
    const data = sheet.getDataRange().getValues();
    const satirlar = [];
    let toplam = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] || !araligaDahilMi(hucreTarihStr(row[1]))) continue;
      const belgeTipi = String(row[8] || "") || "Fatura";
      if (belgeTipi !== "Fatura") continue;
      const tutar = parseFloat(row[4]) || 0;
      toplam += tutar;
      satirlar.push({ id: String(row[0]), tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""),
        tutar: tutar, odemeTipi: String(row[5] || ""), aciklama: String(row[6] || "") });
    }
    satirlar.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    return { ok: true, tip: tip, satirlar: satirlar, toplam: toplam };
  }

  if (tip === "karZarar") {
    const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sSheet);
    const sData = sSheet.getDataRange().getValues();
    const satisBelgeTipi = {}, satisTarih = {};
    for (let i = 1; i < sData.length; i++) {
      const id = String(sData[i][0] || "");
      if (!id) continue;
      satisBelgeTipi[id] = String(sData[i][8] || "") || "Fatura";
      satisTarih[id] = String(sData[i][1] || "");
    }

    // Ürün adı → alış fiyatı eşleşmesi (Satış Kalemleri stokTanimId TUTMUYOR,
    // sadece serbest metin ürün adı var; bu yüzden isim eşleşmesi kullanılıyor —
    // stok tanımında olmayan/adı farklı yazılan ürünler maliyetsiz sayılır).
    const stokListe = getStokTanimListesi().kalemler;
    const alisFiyatHaritasi = {};
    stokListe.forEach(s => { alisFiyatHaritasi[s.stokAdi.trim().toLocaleLowerCase('tr')] = s.alisFiyati; });

    const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
      ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
    ensureSatisKalemVergiKolonlari(kSheet);
    const kData = kSheet.getDataRange().getValues();

    const urunMap = {}; // urunAdi -> {satisTutari, maliyet, miktar}
    let toplamSatis = 0, toplamMaliyet = 0, eslesmeyenSayisi = 0;
    for (let i = 1; i < kData.length; i++) {
      const row = kData[i];
      const satisId = String(row[1] || "");
      if (!satisId) continue;
      if (satisBelgeTipi[satisId] !== "Fatura") continue; // sadece kesilmiş faturalar
      const tarih = satisTarih[satisId] || "";
      if (!araligaDahilMi(tarih)) continue;

      const urunAdi = String(row[2] || "").trim();
      const miktar = parseFloat(row[3]) || 0;
      const birimFiyat = parseFloat(row[5]) || 0;
      const iskontoYuzde = parseFloat(row[7]) || 0;
      const satirSatisTutari = miktar * birimFiyat * (1 - iskontoYuzde / 100);

      const alisFiyati = alisFiyatHaritasi[urunAdi.toLocaleLowerCase('tr')];
      const maliyetBilinmiyor = (alisFiyati === undefined);
      if (maliyetBilinmiyor) eslesmeyenSayisi++;
      const satirMaliyet = maliyetBilinmiyor ? 0 : (alisFiyati * miktar);

      toplamSatis += satirSatisTutari;
      toplamMaliyet += satirMaliyet;

      if (!urunMap[urunAdi]) urunMap[urunAdi] = { urunAdi, miktar: 0, satisTutari: 0, maliyet: 0, maliyetBilinmiyor: false };
      urunMap[urunAdi].miktar += miktar;
      urunMap[urunAdi].satisTutari += satirSatisTutari;
      urunMap[urunAdi].maliyet += satirMaliyet;
      if (maliyetBilinmiyor) urunMap[urunAdi].maliyetBilinmiyor = true;
    }

    const satirlar = Object.values(urunMap).map(u => ({
      urunAdi: u.urunAdi, miktar: u.miktar, satisTutari: u.satisTutari, maliyet: u.maliyet,
      kar: u.satisTutari - u.maliyet, maliyetBilinmiyor: u.maliyetBilinmiyor,
    }));
    satirlar.sort((a, b) => b.kar - a.kar);

    return {
      ok: true, tip: tip, satirlar: satirlar,
      toplamSatis: toplamSatis, toplamMaliyet: toplamMaliyet, toplamKar: toplamSatis - toplamMaliyet,
      eslesmeyenSayisi: eslesmeyenSayisi,
    };
  }

  if (tip === "urunBazliHareket" || tip === "urunBazliSiparis" || tip === "urunBazliFatura") {
    const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sSheet);
    const sData = sSheet.getDataRange().getValues();
    const satisBelgeTipi = {}, satisTarih = {};
    for (let i = 1; i < sData.length; i++) {
      const id = String(sData[i][0] || "");
      if (!id) continue;
      satisBelgeTipi[id] = String(sData[i][8] || "") || "Fatura";
      satisTarih[id] = hucreTarihStr(sData[i][1]);
    }

    const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
      ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
    const kData = kSheet.getDataRange().getValues();
    const urunMap = {};
    function urunEkle(urunAdi, miktar, tutar, yon) {
      if (!urunMap[urunAdi]) urunMap[urunAdi] = { urunAdi: urunAdi, girisMiktar: 0, cikisMiktar: 0, tutar: 0 };
      if (yon === "giris") urunMap[urunAdi].girisMiktar += miktar; else urunMap[urunAdi].cikisMiktar += miktar;
      urunMap[urunAdi].tutar += tutar;
    }

    for (let i = 1; i < kData.length; i++) {
      const row = kData[i];
      const satisId = String(row[1] || "");
      const belgeTipi = satisBelgeTipi[satisId];
      const tarih = satisTarih[satisId] || "";
      if (!belgeTipi || !araligaDahilMi(tarih)) continue;
      const urunAdi = String(row[2] || "");
      if (!urunAdi) continue;
      if (tip === "urunBazliSiparis" && belgeTipi !== "Sipariş") continue;
      if (tip === "urunBazliFatura" && belgeTipi !== "Fatura") continue;
      // Fiili stok hareketi raporu (urunBazliHareket) sadece kesilmiş Faturaları
      // çıkış sayar — Teklif ve Sipariş henüz malın stoktan çıktığı anlamına gelmez.
      if (tip === "urunBazliHareket" && belgeTipi !== "Fatura") continue;
      urunEkle(urunAdi, parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "cikis");
    }

    // Ürün Bazlı Hareket Raporu ayrıca alış (giriş) ve alış iadesi (giriş azaltan) hareketlerini de kapsar.
    let diagAlisKayitSayisi = null, diagAlisKalemSayisi = null;
    if (tip === "urunBazliHareket") {
      const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
        ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
      const aData = aSheet.getDataRange().getValues();
      const alisTarih = {};
      for (let i = 1; i < aData.length; i++) {
        const id = String(aData[i][0] || "");
        if (id) alisTarih[id] = hucreTarihStr(aData[i][1]);
      }
      const akSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
        ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
      const akData = akSheet.getDataRange().getValues();
      diagAlisKayitSayisi = aData.length - 1;
      diagAlisKalemSayisi = akData.length - 1;
      for (let i = 1; i < akData.length; i++) {
        const row = akData[i];
        const alisId = String(row[1] || "");
        const tarih = alisTarih[alisId] || "";
        if (!tarih || !araligaDahilMi(tarih)) continue;
        const urunAdi = String(row[2] || "");
        if (!urunAdi) continue;
        urunEkle(urunAdi, parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "giris");
      }

      // Alış İadeleri: tedarikçiye geri verilen mal, girişten düşülür (çıkış olarak sayılır).
      const iaSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
        ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
      const iaData = iaSheet.getDataRange().getValues();
      const iadeTarih = {};
      for (let i = 1; i < iaData.length; i++) {
        const id = String(iaData[i][0] || "");
        if (id) iadeTarih[id] = hucreTarihStr(iaData[i][1]);
      }
      const ikSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
        ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
      const ikData = ikSheet.getDataRange().getValues();
      for (let i = 1; i < ikData.length; i++) {
        const row = ikData[i];
        const iadeId = String(row[1] || "");
        const tarih = iadeTarih[iadeId] || "";
        if (!tarih || !araligaDahilMi(tarih)) continue;
        const urunAdi = String(row[2] || "");
        if (!urunAdi) continue;
        urunEkle(urunAdi, parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "cikis");
      }
    }

    const satirlar = Object.values(urunMap).sort((a, b) => b.tutar - a.tutar);
    const sonuc = { ok: true, tip: tip, satirlar: satirlar, toplam: satirlar.reduce((t, s) => t + s.tutar, 0) };
    // GEÇİCİ TEŞHİS: rapor beklenmedik şekilde boş geldiğinde ham veri sayılarını görmek için.
    if (tip === "urunBazliHareket" && satirlar.length === 0) {
      sonuc.diag = {
        satisKayitSayisi: sData.length - 1,
        satisKalemSayisi: kData.length - 1,
        alisKayitSayisi: diagAlisKayitSayisi,
        alisKalemSayisi: diagAlisKalemSayisi,
        ornekSatisKalemSatisId: kData.length > 1 ? String(kData[1][1] || "") : null,
        ornekSatisIdListesi: sData.slice(1, 4).map(r => String(r[0] || "")),
      };
    }
    return sonuc;
  }

  return { ok: false, hata: "Bilinmeyen rapor tipi" };
}

// ════════════════════════════════════════════════
// BANKA TANIMLAMALARI (Finans modülü altında)
// Bankalar → altında Hesap Tanımlamaları, POS Tanımlamaları, Kredi Kartı
// Tanımlamaları. Tümü BANKA_ID ile bankaya bağlanır.
// ════════════════════════════════════════════════

// Tüm banka yapısını (bankalar + hesaplar + pos + kredi kartları) tek seferde döner.
function getBankaYapisi() {
  return cacheOkuVeyaHesapla("bankaYapisi", 300, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const bSheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
  const hSheet = getOrCreateSheet(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
  const pSheet = getOrCreateSheet(ss, SHEETS.posCihazlari, ["ID","BANKA_ID","POS_ADI","ACIKLAMA"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);

  function satirlariOku(sheet, alanlar) {
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const obj = {};
      alanlar.forEach((ad, idx) => { obj[ad] = row[idx] === undefined ? "" : row[idx]; });
      sonuc.push(obj);
    }
    return sonuc;
  }

  const bankalar = satirlariOku(bSheet, ["id","ad"]);
  const hesaplar = satirlariOku(hSheet, ["id","bankaId","hesapAdi","iban"]).map(h => ({...h, id:String(h.id), bankaId:String(h.bankaId)}));
  const posListesi = satirlariOku(pSheet, ["id","bankaId","posAdi","aciklama"]).map(p => ({...p, id:String(p.id), bankaId:String(p.bankaId)}));
  const krediKartlari = satirlariOku(kSheet, ["id","bankaId","kartAdi","limit"]).map(k => ({...k, id:String(k.id), bankaId:String(k.bankaId), limit: parseFloat(k.limit)||0}));

  return { ok: true, bankalar: bankalar.map(b=>({id:String(b.id), ad:String(b.ad)})), hesaplar, pos: posListesi, krediKartlari };
  });
}

function saveBanka(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Banka adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
  let id = String(body.id || "").trim();
  if (id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { sheet.getRange(i+1,1,1,2).setValues([[id, ad]]); cacheTemizle(["bankaYapisi"]); return { ok: true, id }; }
    }
  }
  id = "bk_" + Date.now();
  sheet.appendRow([id, ad]);
  cacheTemizle(["bankaYapisi"]);
  return { ok: true, id: id };
}

function silBanka(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  // Bağlı hesap/pos/kart varsa silmeyi engelle
  const bagli = [SHEETS.bankaHesaplari, SHEETS.posCihazlari, SHEETS.krediKartlari].some(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return false;
    const data = sheet.getDataRange().getValues();
    return data.some((row, i) => i > 0 && String(row[1]) === id);
  });
  if (bagli) return { ok: false, hata: "Bu bankaya bağlı hesap/POS/kredi kartı var, önce onları silin" };
  const sheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); cacheTemizle(["bankaYapisi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Banka bulunamadı" };
}

function saveBankaHesap(body) {
  const hesapAdi = String(body.hesapAdi || "").trim();
  const bankaId = String(body.bankaId || "").trim();
  if (!hesapAdi || !bankaId) return { ok: false, hata: "Banka ve hesap adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
  let id = String(body.id || "").trim();
  const satir = [id || null, bankaId, hesapAdi, String(body.iban || "")];
  if (id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); cacheTemizle(["bankaYapisi"]); return { ok: true, id }; }
    }
  }
  id = "bh_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  cacheTemizle(["bankaYapisi"]);
  return { ok: true, id: id };
}

function silBankaHesap(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); cacheTemizle(["bankaYapisi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Hesap bulunamadı" };
}

function savePos(body) {
  const posAdi = String(body.posAdi || "").trim();
  const bankaId = String(body.bankaId || "").trim();
  if (!posAdi || !bankaId) return { ok: false, hata: "Banka ve POS adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posCihazlari, ["ID","BANKA_ID","POS_ADI","ACIKLAMA"]);
  let id = String(body.id || "").trim();
  const satir = [id || null, bankaId, posAdi, String(body.aciklama || "")];
  if (id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); cacheTemizle(["bankaYapisi"]); return { ok: true, id }; }
    }
  }
  id = "pos_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  cacheTemizle(["bankaYapisi"]);
  return { ok: true, id: id };
}

function silPos(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posCihazlari, ["ID","BANKA_ID","POS_ADI","ACIKLAMA"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); cacheTemizle(["bankaYapisi"]); return { ok: true }; }
  }
  return { ok: false, hata: "POS bulunamadı" };
}

function saveKrediKarti(body) {
  const kartAdi = String(body.kartAdi || "").trim();
  const bankaId = String(body.bankaId || "").trim();
  if (!kartAdi || !bankaId) return { ok: false, hata: "Banka ve kart adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);
  let id = String(body.id || "").trim();
  const satir = [id || null, bankaId, kartAdi, parseFloat(body.limit) || 0];
  if (id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); cacheTemizle(["bankaYapisi"]); return { ok: true, id }; }
    }
  }
  id = "kk_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  cacheTemizle(["bankaYapisi"]);
  return { ok: true, id: id };
}

function silKrediKarti(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); cacheTemizle(["bankaYapisi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Kredi kartı bulunamadı" };
}

// ════════════════════════════════════════════════
// STOK TANIMLAMA (Stok modülünün 2. kademesi — yeni standart modül)
// Sütunlar: Stok Kodu, Stok Adı, 1. Birim, Ambalaj Miktarı, Ambalaj Birimi,
// Alış Fiyatı, Alış İskontosu, Satış Fiyatı, Satış İskontosu.
// Eski Stok Paneli'nden tamamen bağımsız çalışır. Excel'den toplu içe aktarma destekler.
// ════════════════════════════════════════════════

const STOK_TANIM_BASLIKLAR = ["ID","STOK_KODU","STOK_ADI","BIRIM1","AMBALAJ_MIKTARI","AMBALAJ_BIRIMI","ALIS_FIYATI","ALIS_ISKONTOSU","SATIS_FIYATI","SATIS_ISKONTOSU","KAYIT_TARIHI","MARKA_ID","URUN_GRUBU_ID","ALT_URUN_GRUBU_ID","EBAT_ID","RENK_ID","MIN_STOK","BARKOD"];

// Eskiden 11 sütunlu oluşturulmuş StokTanimlari sayfalarına, sona 7 yeni
// tanım sütunu ekler (yalnızca eksikse — getOrCreateSheet zaten var olan
// sayfalara başlık eklemediği için bu göç adımı gerekli).
function ensureStokTanimEkColonlari(sheet) {
  const eklenecek = ["MARKA_ID","URUN_GRUBU_ID","ALT_URUN_GRUBU_ID","EBAT_ID","RENK_ID","MIN_STOK","BARKOD"];
  eklenecek.forEach((baslik, idx) => {
    const kolonNo = 12 + idx;
    const mevcut = sheet.getRange(1, kolonNo).getValue();
    if (String(mevcut || "") !== baslik) {
      sheet.getRange(1, kolonNo).setValue(baslik).setFontWeight("bold").setBackground("#e8edf5");
    }
  });
}

function stokTanimSatiriNesneYap(row) {
  const stokKodu = String(row[1] || "");
  return {
    id: String(row[0] || ""),
    stokKodu: stokKodu,
    markaKodu: stokKodu.trim().slice(0, 2), // stok kodunun ilk 2 hanesi = marka hanesi
    stokAdi: String(row[2] || ""),
    birim1: String(row[3] || ""),
    ambalajMiktari: parseFloat(row[4]) || 0,
    ambalajBirimi: String(row[5] || ""),
    alisFiyati: parseFloat(row[6]) || 0,
    alisIskontosu: parseFloat(row[7]) || 0,
    satisFiyati: parseFloat(row[8]) || 0,
    satisIskontosu: parseFloat(row[9]) || 0,
    kayitTarihi: hucreTarihStr(row[10]),
    markaId: String(row[11] || ""),
    urunGrubuId: String(row[12] || ""),
    altUrunGrubuId: String(row[13] || ""),
    ebatId: String(row[14] || ""),
    renkId: String(row[15] || ""),
    minStok: parseFloat(row[16]) || 0,
    barkod: String(row[17] || ""),
  };
}

// Bir ürünün StokHareketleri defterindeki Giriş-Çıkış toplamından güncel stok
// miktarını hesaplar. Tüm ürünler için tek seferde (map olarak) hesaplanır —
// getStokTanimListesi her çağrıldığında tek tek sorgu atmamak için.
function stokGuncelMiktarHaritasi() {
  return cacheOkuVeyaHesapla("stokGuncelMiktarHaritasi", 60, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
    const data = sheet.getDataRange().getValues();
    const harita = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const stokTanimId = String(row[2] || "");
      if (!stokTanimId) continue;
      const miktar = parseFloat(row[7]) || 0;
      const hareketTipi = String(row[6] || "");
      if (!harita[stokTanimId]) harita[stokTanimId] = 0;
      harita[stokTanimId] += (hareketTipi === "Giriş") ? miktar : -miktar;
    }
    return harita;
  });
}

function getStokTanimListesi() {
  return cacheOkuVeyaHesapla("stokTanimListesi", 180, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const data = sheet.getDataRange().getValues();
  const guncelMiktarHaritasi = stokGuncelMiktarHaritasi();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const nesne = stokTanimSatiriNesneYap(data[i]);
    nesne.guncelStok = guncelMiktarHaritasi[nesne.id] || 0;
    sonuc.push(nesne);
  }
  return { ok: true, kalemler: sonuc };
  });
}

// Minimum stok tanımlanmış (minStok > 0) VE güncel stok bu seviyenin altında/eşit
// olan ürünleri listeler. Not: "güncel stok" burada yalnızca Stok Hareket
// defterindeki (Stok > İşlemler) manuel giriş/çıkış kayıtlarının toplamıdır;
// Satış/Alış faturalarından otomatik düşülmez (Stok Hareket Raporu'ndaki
// notla aynı sınırlama).
function getKritikStokListesi() {
  const tumListe = getStokTanimListesi().kalemler;
  const sonuc = tumListe.filter(k => k.minStok > 0 && k.guncelStok <= k.minStok);
  sonuc.sort((a, b) => (a.guncelStok - a.minStok) - (b.guncelStok - b.minStok));
  return { ok: true, kalemler: sonuc };
}

// body: { id (varsa güncelleme), stokKodu, stokAdi, birim1, ambalajMiktari, ambalajBirimi,
//         alisFiyati, alisIskontosu, satisFiyati, satisIskontosu,
//         markaId, urunGrubuId, altUrunGrubuId, ebatId, renkId, minStok, barkod }
function saveStokTanim(body) {
  const stokAdi = String(body.stokAdi || "").trim();
  if (!stokAdi) return { ok: false, hata: "Stok adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const data = sheet.getDataRange().getValues();

  let id = String(body.id || "").trim();
  let satirIdx = -1;
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { satirIdx = i + 1; break; }
    }
  }
  if (!id) id = "sk_" + Date.now();

  const satir = [
    id,
    String(body.stokKodu || ""),
    stokAdi,
    String(body.birim1 || "adet"),
    parseFloat(body.ambalajMiktari) || 0,
    String(body.ambalajBirimi || ""),
    parseFloat(body.alisFiyati) || 0,
    parseFloat(body.alisIskontosu) || 0,
    parseFloat(body.satisFiyati) || 0,
    parseFloat(body.satisIskontosu) || 0,
    satirIdx > 0 ? data[satirIdx - 1][10] : Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"),
    String(body.markaId || ""),
    String(body.urunGrubuId || ""),
    String(body.altUrunGrubuId || ""),
    String(body.ebatId || ""),
    String(body.renkId || ""),
    parseFloat(body.minStok) || 0,
    String(body.barkod || ""),
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);
  cacheTemizle(["stokTanimListesi"]);
  return { ok: true, id: id };
}

function silStokTanim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); cacheTemizle(["stokTanimListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Kayıt bulunamadı" };
}

// Excel'den kopyala-yapıştır ile toplu içe aktarma.
// body: { kayitlar: [{stokKodu, stokAdi, birim1, ambalajMiktari, ambalajBirimi,
//                      alisFiyati, alisIskontosu, satisFiyati, satisIskontosu}, ...] }
// Aynı Stok Kodu zaten varsa günceller (upsert), yoksa yeni satır ekler — tek toplu
// yazma işlemiyle (appendRow döngüsü yerine setValues) hız kazandırır.
function saveStokTanimTopluce(body) {
  const kayitlar = Array.isArray(body.kayitlar) ? body.kayitlar : [];
  if (kayitlar.length === 0) return { ok: false, hata: "İçe aktarılacak kayıt bulunamadı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const data = sheet.getDataRange().getValues();

  // Mevcut kayıtları STOK_KODU'na göre satır numarasıyla eşle (upsert için)
  const kodSatirMap = {};
  for (let i = 1; i < data.length; i++) {
    const kod = String(data[i][1] || "").trim();
    if (kod) kodSatirMap[kod] = i + 1; // 1-index sheet satırı
  }

  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const yeniSatirlar = [];
  let guncellenen = 0, eklenen = 0, atlanan = 0;

  kayitlar.forEach((k, idx) => {
    const stokAdi = String(k.stokAdi || "").trim();
    if (!stokAdi) { atlanan++; return; }
    const stokKodu = String(k.stokKodu || "").trim();
    const satir = [
      "sk_" + Date.now() + "_" + idx,
      stokKodu,
      stokAdi,
      String(k.birim1 || "adet"),
      parseFloat(k.ambalajMiktari) || 0,
      String(k.ambalajBirimi || ""),
      parseFloat(k.alisFiyati) || 0,
      parseFloat(k.alisIskontosu) || 0,
      parseFloat(k.satisFiyati) || 0,
      parseFloat(k.satisIskontosu) || 0,
      kayitTarihi,
      String(k.markaId || ""),
      String(k.urunGrubuId || ""),
      String(k.altUrunGrubuId || ""),
      String(k.ebatId || ""),
      String(k.renkId || ""),
    ];

    if (stokKodu && kodSatirMap[stokKodu]) {
      // Mevcut kaydı güncelle — ID'yi koru
      const satirNo = kodSatirMap[stokKodu];
      satir[0] = String(data[satirNo - 1][0]);
      sheet.getRange(satirNo, 1, 1, satir.length).setValues([satir]);
      guncellenen++;
    } else {
      yeniSatirlar.push(satir);
      if (stokKodu) kodSatirMap[stokKodu] = -1; // aynı içe aktarma içinde tekrar eşleşmesin
      eklenen++;
    }
  });

  if (yeniSatirlar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, yeniSatirlar.length, STOK_TANIM_BASLIKLAR.length).setValues(yeniSatirlar);
  }

  cacheTemizle(["stokTanimListesi"]);
  return { ok: true, eklenen: eklenen, guncellenen: guncellenen, atlanan: atlanan };
}

// ════════════════════════════════════════════════
// STOK HAREKETLERİ (Stok > İşlemler — Giriş / Çıkış / Toplu Stok Hareketi)
// Basit bir stok hareket defteri: her satır tek bir ürün + miktar + yön
// (Giriş/Çıkış) kaydıdır. Satış/Alış faturalarından BAĞIMSIZDIR — elle
// girilen düzeltme, sayım, fire, transfer vb. hareketler içindir.
// Not: Mevcut Stok Paneli (dış iframe) ayrı bir uygulamadır; bu defter onun
// gösterdiği "güncel stok" rakamını otomatik güncellemez, sadece kendi
// hareket geçmişini/raporunu tutar.
// ════════════════════════════════════════════════
const STOK_HAREKET_BASLIKLAR = ["ID","TARIH","STOK_TANIM_ID","STOK_KODU","STOK_ADI","BIRIM","HAREKET_TIPI","MIKTAR","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI","BELGE_NO"];

// Satış/Alış/Alış İade Faturaları KAYDEDİLDİĞİNDE Stok Hareket Raporu'na (StokHareketleri
// sayfası) otomatik satır yazar. belgeNo = ilgili Satış/Alış kaydının ID'si; silinince
// stokHareketOtomatikSil(belgeNo) ile bu satırlar da otomatik temizlenir.
function stokHareketOtomatikYaz(ss, kalemler, tarih, hareketTipi, belgeTipi, belgeNo, aciklamaOnEk) {
  if (!kalemler || !kalemler.length) return;
  const shSheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
  ensureStokHareketBelgeColonlari(shSheet);

  // stokKodu -> StokTanimlari ID eşlemesi (ürün bazlı rapor filtresinin çalışabilmesi için).
  const tanimData = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR).getDataRange().getValues();
  const koduIdMap = {};
  for (let i = 1; i < tanimData.length; i++) {
    const kod = String(tanimData[i][1] || "").trim();
    if (kod) koduIdMap[kod] = String(tanimData[i][0] || "");
  }

  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const satirlar = [];
  kalemler.forEach((k, idx) => {
    const miktar = parseFloat(k.miktar) || 0;
    if (miktar <= 0) return;
    const stokKodu = String(k.stokKodu || "").trim();
    satirlar.push([
      "sh_" + Date.now() + "_" + idx + "_" + Math.floor(Math.random() * 1000),
      tarih, stokKodu ? (koduIdMap[stokKodu] || "") : "", stokKodu,
      String(k.urunAdi || "").trim(), String(k.birim || "adet"), hareketTipi, miktar,
      aciklamaOnEk, kayitTarihi, belgeTipi, belgeNo,
    ]);
  });
  if (satirlar.length) {
    shSheet.getRange(shSheet.getLastRow() + 1, 1, satirlar.length, STOK_HAREKET_BASLIKLAR.length).setValues(satirlar);
    cacheTemizle(["stokHareketListesi"]);
  }
}

// Bir Satış/Alış/Alış İade kaydı silindiğinde, stokHareketOtomatikYaz ile o kayda ait
// oluşturulmuş BELGE_NO'lu Stok Hareket satırlarını da siler.
function stokHareketOtomatikSil(ss, belgeNo) {
  const shSheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
  ensureStokHareketBelgeColonlari(shSheet);
  const data = shSheet.getDataRange().getValues();
  let silindi = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][11]) === String(belgeNo)) { shSheet.deleteRow(i + 1); silindi = true; }
  }
  if (silindi) cacheTemizle(["stokHareketListesi"]);
}

// stokHareketOtomatikYaz özelliği eklenmeden ÖNCE kaydedilmiş Satış Faturası / Alış
// Faturası / Alış İadesi kayıtları için Stok Hareket Raporu'nda hiç satır yoktur.
// Bu fonksiyon geçmişteki TÜM bu tip kayıtları tarayıp, StokHareketleri'nde o BELGE_NO
// için henüz satır yoksa geriye dönük olarak oluşturur. Ayarlar/Rapor ekranından elle
// tetiklenir, tekrar çalıştırılması güvenlidir (zaten işlenmiş belgeler atlanır).
function stokHareketGecmisiDoldur() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const shSheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
  ensureStokHareketBelgeColonlari(shSheet);
  const shData = shSheet.getDataRange().getValues();
  const islenmisBelgeNolar = {};
  for (let i = 1; i < shData.length; i++) {
    const bn = String(shData[i][11] || "");
    if (bn) islenmisBelgeNolar[bn] = true;
  }

  let eklenen = 0;

  // Satış Faturaları
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const sData = sSheet.getDataRange().getValues();
  const skSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  const skData = skSheet.getDataRange().getValues();
  for (let i = 1; i < sData.length; i++) {
    const sId = String(sData[i][0] || "");
    const belgeTipi = String(sData[i][8] || "Fatura");
    if (!sId || belgeTipi !== "Fatura" || islenmisBelgeNolar[sId]) continue;
    const kalemler = [];
    for (let j = 1; j < skData.length; j++) {
      if (String(skData[j][1]) === sId) {
        kalemler.push({ urunAdi: String(skData[j][2] || ""), miktar: parseFloat(skData[j][3]) || 0,
          birim: String(skData[j][4] || "adet"), stokKodu: String(skData[j][10] || "") });
      }
    }
    if (kalemler.length) {
      stokHareketOtomatikYaz(ss, kalemler, hucreTarihStr(sData[i][1]), "Çıkış", "Satış Faturası", sId,
        "Satış Faturası — " + String(sData[i][3] || ""));
      eklenen++;
    }
  }

  // Alış Faturaları
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const aData = aSheet.getDataRange().getValues();
  const akSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemStokKoduColonu(akSheet);
  const akData = akSheet.getDataRange().getValues();
  for (let i = 1; i < aData.length; i++) {
    const aId = String(aData[i][0] || "");
    if (!aId || islenmisBelgeNolar[aId]) continue;
    const kalemler = [];
    for (let j = 1; j < akData.length; j++) {
      if (String(akData[j][1]) === aId) {
        kalemler.push({ urunAdi: String(akData[j][2] || ""), miktar: parseFloat(akData[j][3]) || 0,
          birim: String(akData[j][4] || "adet"), stokKodu: String(akData[j][7] || "") });
      }
    }
    if (kalemler.length) {
      stokHareketOtomatikYaz(ss, kalemler, hucreTarihStr(aData[i][1]), "Giriş", "Alış Faturası", aId,
        "Alış Faturası — " + String(aData[i][3] || ""));
      eklenen++;
    }
  }

  // Alış İadeleri
  const aiSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const aiData = aiSheet.getDataRange().getValues();
  const aikSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
  const aikData = aikSheet.getDataRange().getValues();
  for (let i = 1; i < aiData.length; i++) {
    const aiId = String(aiData[i][0] || "");
    if (!aiId || islenmisBelgeNolar[aiId]) continue;
    const kalemler = [];
    for (let j = 1; j < aikData.length; j++) {
      if (String(aikData[j][1]) === aiId) {
        kalemler.push({ urunAdi: String(aikData[j][2] || ""), miktar: parseFloat(aikData[j][3]) || 0,
          birim: String(aikData[j][4] || "adet") });
      }
    }
    if (kalemler.length) {
      stokHareketOtomatikYaz(ss, kalemler, hucreTarihStr(aiData[i][1]), "Çıkış", "Alış İadesi", aiId,
        "Alış İadesi — " + String(aiData[i][3] || ""));
      eklenen++;
    }
  }

  cacheTemizle(["stokHareketListesi"]);
  return { ok: true, eklenenBelgeSayisi: eklenen };
}

// Sheet daha önce BELGE_TIPI/BELGE_NO kolonları olmadan oluşturulmuş olabilir; başlıkları tamamlar.
function ensureStokHareketBelgeColonlari(sheet) {
  const h11 = sheet.getRange(1, 11).getValue();
  if (String(h11 || "") !== "BELGE_TIPI") {
    sheet.getRange(1, 11).setValue("BELGE_TIPI").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h12 = sheet.getRange(1, 12).getValue();
  if (String(h12 || "") !== "BELGE_NO") {
    sheet.getRange(1, 12).setValue("BELGE_NO").setFontWeight("bold").setBackground("#e8edf5");
  }
}

function stokHareketSatiriNesneYap(row) {
  return {
    id: String(row[0] || ""),
    tarih: hucreTarihStr(row[1]),
    stokTanimId: String(row[2] || ""),
    stokKodu: String(row[3] || ""),
    stokAdi: String(row[4] || ""),
    birim: String(row[5] || ""),
    hareketTipi: String(row[6] || ""),
    miktar: parseFloat(row[7]) || 0,
    aciklama: String(row[8] || ""),
    kayitTarihi: hucreTarihStr(row[9]),
    belgeTipi: String(row[10] || ""),
    belgeNo: String(row[11] || ""),
  };
}

// Tek bir uçtan hem Stok Giriş, hem Stok Çıkış, hem de Toplu Stok Hareketi
// formları besleniyor — frontend her satırın hareketTipi'ni ("Giriş"/"Çıkış")
// kendisi belirleyip gönderiyor.
// body: { tarih, kayitlar: [{stokTanimId, stokKodu, stokAdi/urunAdi, birim, hareketTipi, miktar, aciklama}, ...] }
function stokHareketTopluEkle(body) {
  const kayitlar = Array.isArray(body.kayitlar) ? body.kayitlar : [];
  if (kayitlar.length === 0) return { ok: false, hata: "Kayıt bulunamadı" };
  const tarih = String(body.tarih || "").trim() || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
  ensureStokHareketBelgeColonlari(sheet);
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");

  const satirlar = [];
  let eklenen = 0, atlanan = 0;
  kayitlar.forEach((k, idx) => {
    const stokAdi = String(k.stokAdi || k.urunAdi || "").trim();
    const miktar = parseFloat(k.miktar) || 0;
    if (!stokAdi || miktar <= 0) { atlanan++; return; }
    const hareketTipi = String(k.hareketTipi || "") === "Çıkış" ? "Çıkış" : "Giriş";
    satirlar.push([
      "sh_" + Date.now() + "_" + idx,
      tarih,
      String(k.stokTanimId || ""),
      String(k.stokKodu || ""),
      stokAdi,
      String(k.birim || "adet"),
      hareketTipi,
      miktar,
      String(k.aciklama || body.genelAciklama || ""),
      kayitTarihi,
      String(k.belgeTipi || body.genelBelgeTipi || ""),
      String(k.belgeNo || body.genelBelgeNo || ""),
    ]);
    eklenen++;
  });

  if (satirlar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, satirlar.length, STOK_HAREKET_BASLIKLAR.length).setValues(satirlar);
  }
  cacheTemizle(["stokHareketListesi"]);
  return { ok: true, eklenen: eklenen, atlanan: atlanan };
}

// ════════════════════════════════════════════════
// SERİ TANIMLAMA (Ayarlar > Seri Tanımlama) — Sipariş No, Teklif No, Satış/Alış
// Fatura No, Cari No gibi belge numaralarının otomatik/takipli üretimi için.
// Her seri: Ad + Prefix + Sonraki No + Basamak Sayısı. "Sonraki No'yu Kullan"
// çağrıldığında GÜNCEL numara formatlanıp döndürülür ve sayaç 1 artırılır.
// ════════════════════════════════════════════════
const SERI_BASLIKLAR = ["ID","AD","PREFIX","SONRAKI_NO","BASAMAK","TUR"];

// "TUR" — serinin hangi otomasyon noktasına bağlı olduğunu belirten SABİT anahtar
// (siparis / teklif / satis_fatura / alis_fatura / cari_alici / cari_satici / "").
// "AD" alanı kullanıcı tarafından Ayarlar ekranından serbestçe yeniden adlandırılabiliyor;
// önceden eşleştirme bu görünen "AD" metnine göre yapılıyordu, dolayısıyla kullanıcı bir
// seriyi yeniden adlandırdığında (örn. prefiksini "AD" kutusuna yazdığında) o seriye bağlı
// "Sonraki No'yu Kullan" butonları sessizce "... serisi bulunamadı" hatası veriyordu. Artık
// eşleştirme bu değişmez TUR alanına göre yapılır; TUR boşsa (özel/genel amaçlı seri) hiçbir
// otomasyona bağlanmaz ve sadece elle seçilerek kullanılır.
const SERI_TUR_ESKI_AD_ESLEME = {
  "Sipariş No": "siparis", "Teklif No": "teklif",
  "Satış Fatura No": "satis_fatura", "Alış Fatura No": "alis_fatura",
  "Cari No (Alıcı)": "cari_alici", "Cari No (Satıcı)": "cari_satici",
  "Cari No": "cari_alici",
};
const SERI_TUR_ETIKETLER = {
  "": "— (otomasyona bağlı değil) —",
  siparis: "Sipariş No", teklif: "Teklif No",
  satis_fatura: "Satış Fatura No", alis_fatura: "Alış Fatura No",
  cari_alici: "Cari No (Alıcı)", cari_satici: "Cari No (Satıcı)",
};

function seriFormatla(prefix, no, basamak) {
  const b = parseInt(basamak) || 4;
  let s = String(parseInt(no) || 1);
  while (s.length < b) s = "0" + s;
  return String(prefix || "") + s;
}

function getSeriTanimlari() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.seriTanimlari, SERI_BASLIKLAR);
  let data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    // İlk kurulumda sık kullanılan varsayılan seriler otomatik oluşturulur.
    const varsayilanlar = [
      ["sr_" + Date.now() + "_1", "Sipariş No", "SIP-", 1, 4, "siparis"],
      ["sr_" + (Date.now() + 1) + "_2", "Teklif No", "TEK-", 1, 4, "teklif"],
      ["sr_" + (Date.now() + 2) + "_3", "Satış Fatura No", "SF-", 1, 4, "satis_fatura"],
      ["sr_" + (Date.now() + 3) + "_4", "Alış Fatura No", "AF-", 1, 4, "alis_fatura"],
      ["sr_" + (Date.now() + 4) + "_5", "Cari No (Alıcı)", "M-", 1, 4, "cari_alici"],
      ["sr_" + (Date.now() + 5) + "_6", "Cari No (Satıcı)", "T-", 1, 4, "cari_satici"],
    ];
    sheet.getRange(2, 1, varsayilanlar.length, SERI_BASLIKLAR.length).setValues(varsayilanlar);
    data = sheet.getDataRange().getValues();
  } else {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      // Eski (TUR sütunu olmayan) tablolarda 6. sütun başlığını ekle.
      if (sheet.getLastColumn() < 6 || String(sheet.getRange(1,6).getValue()||"") !== "TUR") {
        sheet.getRange(1, 6).setValue("TUR");
        data = sheet.getDataRange().getValues();
      }
      // Tek parça geçmiş "Cari No" serisini Alıcı/Satıcı olarak ikiye ayırma
      // (bir kerelik göç): eski seri "Cari No (Alıcı)" olarak devam eder
      // (numarası korunur), "Cari No (Satıcı)" 1'den başlayan yeni bir seri
      // olarak eklenir. Bu blok sadece eski "Cari No" hâlâ mevcutken çalışır.
      let eskiCariNoSatir = -1, alıcıVar = false, satıcıVar = false;
      for (let i = 1; i < data.length; i++) {
        const ad = String(data[i][1] || "");
        if (ad === "Cari No") eskiCariNoSatir = i;
        if (ad === "Cari No (Alıcı)") alıcıVar = true;
        if (ad === "Cari No (Satıcı)") satıcıVar = true;
      }
      if (eskiCariNoSatir > -1 && !alıcıVar && !satıcıVar) {
        sheet.getRange(eskiCariNoSatir + 1, 2).setValue("Cari No (Alıcı)");
        sheet.appendRow(["sr_" + Date.now() + "_satici", "Cari No (Satıcı)", "T-", 1, 4, "cari_satici"]);
        data = sheet.getDataRange().getValues();
      }
      // Boş TUR hücrelerini, satırın (o anki) AD metnine bakarak bir kerelik
      // otomatik doldurma: metin hâlâ bilinen varsayılan isimlerden biriyse
      // (kullanıcı yeniden adlandırmadıysa) doğru TUR atanır. Zaten farklı bir
      // metne değiştirilmiş satırlarda TUR boş kalır — kullanıcı Ayarlar'dan
      // elle seçmeli, çünkü hangi otomasyona ait olduğu artık metinden anlaşılamıyor.
      let turDegisti = false;
      for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        const mevcutTur = String(data[i][5] || "");
        if (mevcutTur) continue;
        const ad = String(data[i][1] || "");
        const tahmin = SERI_TUR_ESKI_AD_ESLEME[ad];
        if (tahmin) { sheet.getRange(i + 1, 6).setValue(tahmin); turDegisti = true; }
      }
      if (turDegisti) data = sheet.getDataRange().getValues();
    } finally {
      lock.releaseLock();
    }
  }
  const seriler = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const prefix = String(row[2] || "");
    const sonrakiNo = parseInt(row[3]) || 1;
    const basamak = parseInt(row[4]) || 4;
    seriler.push({
      id: String(row[0]), ad: String(row[1] || ""), prefix: prefix,
      sonrakiNo: sonrakiNo, basamak: basamak, tur: String(row[5] || ""),
      onizleme: seriFormatla(prefix, sonrakiNo, basamak),
    });
  }
  return { ok: true, seriler: seriler, turEtiketler: SERI_TUR_ETIKETLER };
}

// body: { id?, ad, prefix, sonrakiNo, basamak, tur }
// NOT: Ayarlar ekranı Kaydet'te TÜM seri satırlarını (değişmeyenler dahil)
// aynı anda gönderebiliyor; kilitsiz çalışırsa özellikle yeni satır eklerken
// (appendRow) eşzamanlı çağrılar birbirinin üstüne yazıp veri kaybına yol
// açabiliyordu. LockService ile bu fonksiyonu uçtan uca serileştiriyoruz.
function saveSeriTanim(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Seri adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.seriTanimlari, SERI_BASLIKLAR);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = sheet.getDataRange().getValues();
    let id = String(body.id || "").trim();
    let satirIdx = -1;
    if (id) {
      for (let i = 1; i < data.length; i++) { if (String(data[i][0]) === id) { satirIdx = i + 1; break; } }
    }
    if (!id) id = "sr_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const satir = [id, ad, String(body.prefix || ""), parseInt(body.sonrakiNo) || 1, parseInt(body.basamak) || 4, String(body.tur || "")];
    if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
    else sheet.appendRow(satir);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function silSeriTanim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.seriTanimlari, SERI_BASLIKLAR);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); return { ok: true }; }
    }
    return { ok: false, hata: "Kayıt bulunamadı" };
  } finally {
    lock.releaseLock();
  }
}

// body: { id } — seçilen serinin güncel numarasını formatlar, sayacı 1 artırır, formatlı numarayı döner.
function seriSonrakiNoUret(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.seriTanimlari, SERI_BASLIKLAR);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        const prefix = String(data[i][2] || "");
        const sonrakiNo = parseInt(data[i][3]) || 1;
        const basamak = parseInt(data[i][4]) || 4;
        const no = seriFormatla(prefix, sonrakiNo, basamak);
        sheet.getRange(i + 1, 4).setValue(sonrakiNo + 1);
        return { ok: true, no: no };
      }
    }
    return { ok: false, hata: "Seri bulunamadı" };
  } finally {
    lock.releaseLock();
  }
}

function silStokHareket(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["stokHareketListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Kayıt bulunamadı" };
}

// Stok Hareket Raporu için: tüm hareketler önbelleklenir (kısa süreli), tarih
// aralığı ve ürün filtresi her istekte önbellekteki liste üzerinden uygulanır
// — böylece farklı filtre kombinasyonları için ayrı ayrı önbellek gerekmez.
// body: { baslangic, bitis, stokTanimId }
function getStokHareketListesi(body) {
  body = body || {};
  const baslangic = String(body.baslangic || "");
  const bitis = String(body.bitis || "");
  const stokTanimId = String(body.stokTanimId || "");

  const tumListe = cacheOkuVeyaHesapla("stokHareketListesi", 120, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
    ensureStokHareketBelgeColonlari(sheet);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push(stokHareketSatiriNesneYap(data[i]));
    }
    return sonuc;
  });

  let sonuc = tumListe;
  if (baslangic) sonuc = sonuc.filter(h => h.tarih >= baslangic);
  if (bitis) sonuc = sonuc.filter(h => h.tarih <= bitis);
  if (stokTanimId) sonuc = sonuc.filter(h => h.stokTanimId === stokTanimId);
  sonuc = sonuc.slice().sort((a, b) => a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0));

  let girisToplam = 0, cikisToplam = 0;
  sonuc.forEach(h => { if (h.hareketTipi === "Giriş") girisToplam += h.miktar; else cikisToplam += h.miktar; });

  return { ok: true, hareketler: sonuc, girisToplam: girisToplam, cikisToplam: cikisToplam };
}

// ════════════════════════════════════════════════
// BİRİM TANIMLAMA (Stok > Tanımlar > Stok Birim Tanımları altında —
// ürünler için ölçü birimleri: Adet, Kg, Litre, Kutu vb. Ürün arama/
// seçiminde "1. birim" bu listeden gelir; StokTanimlari'ndaki BIRIM1
// alanı serbest metin olarak kalır ama kullanıcı arayüzde buradaki
// tanımlı birimlerden seçim yapabilir.)
// ════════════════════════════════════════════════
const BIRIM_BASLIKLAR = ["ID", "AD", "SIRA"];

// Bir listeyi SIRA alanına göre artan sırada döndürür; SIRA boş/0 olan eski
// kayıtlar sheet'teki doğal sırasında en sona düşer (Array.sort kararlıdır).
function siraliDizile(liste) {
  return liste
    .map((k, idx) => ({ k: k, s: k.sira > 0 ? k.sira : 1000000 + idx }))
    .sort((a, b) => a.s - b.s)
    .map(x => x.k);
}

function getBirimListesi() {
  return cacheOkuVeyaHesapla("birimListesi", 300, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    sonuc.push({ id: String(data[i][0]), ad: String(data[i][1] || ""), sira: parseFloat(data[i][2]) || 0 });
  }
  return { ok: true, birimler: siraliDizile(sonuc) };
  });
}

// body: { id (varsa güncelleme), ad }
function saveBirim(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Birim adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  let id = String(body.id || "").trim();
  if (id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.getRange(i + 1, 1, 1, 2).setValues([[id, ad]]);
        cacheTemizle(["birimListesi"]);
        return { ok: true, id: id };
      }
    }
  }
  const ss2Data = sheet.getDataRange().getValues();
  const maxSira = ss2Data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[2]) || 0), 0);
  id = "bir_" + Date.now();
  sheet.appendRow([id, ad, maxSira + 1]);
  cacheTemizle(["birimListesi"]);
  return { ok: true, id: id };
}

// body: { tip: "birim", sirali: [id1, id2, ...] } — verilen sırayla SIRA alanını 1..n olarak yeniden yazar.
function birimSiraGuncelle(body) {
  const sirali = Array.isArray(body.sirali) ? body.sirali : [];
  if (sirali.length === 0) return { ok: false, hata: "sirali gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  sirali.forEach((id, idx) => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { sheet.getRange(i + 1, 3).setValue(idx + 1); break; }
    }
  });
  cacheTemizle(["birimListesi"]);
  return { ok: true };
}

function silBirim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["birimListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Birim bulunamadı" };
}

// ════════════════════════════════════════════════
// STOK TANIMLARI İÇİN EK TANIM LİSTELERİ (Stok > Tanımlar altında —
// Ürün Grubu, Alt Ürün Grubu, Ebat, Renk. Tek bir "tip" parametresiyle 4
// listeyi birden yönetir. Şema: [ID, AD, UST_ID, SIRA] — UST_ID sadece
// Alt Ürün Grubu için kullanılır (hangi Ürün Grubuna bağlı olduğu),
// diğerlerinde boş kalır. Marka ayrı tutulur çünkü ayrıca bir KOD
// alanı gerektirir.)
// ════════════════════════════════════════════════
const BASIT_TANIM_SHEET_ADI = {
  urunGrubu: SHEETS.urunGruplari,
  altUrunGrubu: SHEETS.altUrunGruplari,
  ebat: SHEETS.ebatlar,
  renk: SHEETS.renkler,
};
const BASIT_TANIM_CACHE_ANAHTARI = {
  urunGrubu: "urunGrubuListesi",
  altUrunGrubu: "altUrunGrubuListesi",
  ebat: "ebatListesi",
  renk: "renkListesi",
};
const BASIT_TANIM_BASLIKLAR = ["ID", "AD", "UST_ID", "SIRA"];

function getBasitTanimListesi(tip) {
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  return cacheOkuVeyaHesapla(BASIT_TANIM_CACHE_ANAHTARI[tip], 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push({ id: String(data[i][0]), ad: String(data[i][1] || ""), ustId: String(data[i][2] || ""), sira: parseFloat(data[i][3]) || 0 });
    }
    return { ok: true, kalemler: siraliDizile(sonuc) };
  });
}

// body: { tip, id (varsa güncelleme), ad, ustId (yalnızca altUrunGrubu için: bağlı olduğu Ürün Grubu id'si) }
function saveBasitTanim(body) {
  const tip = String(body.tip || "");
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Ad gerekli" };
  const ustId = String(body.ustId || "");
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let id = String(body.id || "").trim();
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.getRange(i + 1, 1, 1, 3).setValues([[id, ad, ustId]]);
        cacheTemizle([BASIT_TANIM_CACHE_ANAHTARI[tip]]);
        return { ok: true, id: id };
      }
    }
  }
  const maxSira = data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[3]) || 0), 0);
  id = tip.slice(0, 3) + "_" + Date.now();
  sheet.appendRow([id, ad, ustId, maxSira + 1]);
  cacheTemizle([BASIT_TANIM_CACHE_ANAHTARI[tip]]);
  return { ok: true, id: id };
}

// body: { tip, id }
function silBasitTanim(body) {
  const tip = String(body.tip || "");
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle([BASIT_TANIM_CACHE_ANAHTARI[tip]]); return { ok: true }; }
  }
  return { ok: false, hata: "Kayıt bulunamadı" };
}

// body: { tip, sirali: [id1, id2, ...] }
function basitTanimSiraGuncelle(body) {
  const tip = String(body.tip || "");
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  const sirali = Array.isArray(body.sirali) ? body.sirali : [];
  if (sirali.length === 0) return { ok: false, hata: "sirali gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  sirali.forEach((id, idx) => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { sheet.getRange(i + 1, 4).setValue(idx + 1); break; }
    }
  });
  cacheTemizle([BASIT_TANIM_CACHE_ANAHTARI[tip]]);
  return { ok: true };
}

// ════════════════════════════════════════════════
// MARKA TANIMLARI (Stok > Tanımlar > Marka Tanımları — Birim'den farklı
// olarak 2 haneli bir KOD alanı da tutar. Bu kod, ürünün Stok Kodu'nun
// ilk 2 hanesiyle EŞLEŞMESİ ÖNERİLEN bir referans kaydıdır — Stok Kodu
// serbest metin olarak kalır, otomatik senkronize edilmez.)
// ════════════════════════════════════════════════
const MARKA_BASLIKLAR = ["ID", "KOD", "AD", "SIRA"];

function getMarkaListesi() {
  return cacheOkuVeyaHesapla("markaListesi", 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push({ id: String(data[i][0]), kod: String(data[i][1] || ""), ad: String(data[i][2] || ""), sira: parseFloat(data[i][3]) || 0 });
    }
    return { ok: true, markalar: siraliDizile(sonuc) };
  });
}

// body: { id (varsa güncelleme), kod, ad }
function saveMarka(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Marka adı gerekli" };
  const kod = String(body.kod || "").trim().toUpperCase().slice(0, 2);
  if (kod.length !== 2) return { ok: false, hata: "Marka kodu 2 karakter olmalı" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let id = String(body.id || "").trim();
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.getRange(i + 1, 1, 1, 3).setValues([[id, kod, ad]]);
        cacheTemizle(["markaListesi"]);
        return { ok: true, id: id };
      }
    }
  }
  const maxSira = data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[3]) || 0), 0);
  id = "mrk_" + Date.now();
  sheet.appendRow([id, kod, ad, maxSira + 1]);
  cacheTemizle(["markaListesi"]);
  return { ok: true, id: id };
}

function silMarka(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["markaListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Marka bulunamadı" };
}

// body: { sirali: [id1, id2, ...] }
function markaSiraGuncelle(body) {
  const sirali = Array.isArray(body.sirali) ? body.sirali : [];
  if (sirali.length === 0) return { ok: false, hata: "sirali gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  sirali.forEach((id, idx) => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { sheet.getRange(i + 1, 4).setValue(idx + 1); break; }
    }
  });
  cacheTemizle(["markaListesi"]);
  return { ok: true };
}

// ════════════════════════════════════════════════
// POS HAREKETLERİ — Tahsilatta "Kredi Kartı" seçilip bir POS hesabı
// belirtildiğinde, o POS hesabına BORÇ kaydı düşer (banka/POS bize bu
// tutarı ödeyecek demektir). TAHSILAT:<id> işaretiyle geri alınabilir,
// CariHareketler ile aynı mantığı izler ama ayrı bir defterdir.
// ════════════════════════════════════════════════
const POS_HAREKET_BASLIKLAR = ["ID", "POS_HESAP_ID", "TARIH", "TIP", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI"];

function posHareketEkle(posHesapId, tarih, tip, tutar, aciklama) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posHareketleri, POS_HAREKET_BASLIKLAR);
  const id = "ph_" + Date.now();
  sheet.appendRow([id, posHesapId, tarih, tip, tutar, aciklama,
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);
  return id;
}

function posHareketSilByAciklamaOnPrefix(prefix) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posHareketleri, POS_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5] || "").indexOf(prefix) === 0) { sheet.deleteRow(i + 1); break; }
  }
}

// Bir POS hesabının hareket dökümü (borç kayıtları toplamıyla birlikte).
function getPosHareketleri(posHesapId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posHareketleri, POS_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  let toplam = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (posHesapId && String(row[1]) !== String(posHesapId)) continue;
    const tutar = parseFloat(row[4]) || 0;
    toplam += (String(row[3]) === "Borç") ? tutar : -tutar;
    sonuc.push({
      id: String(row[0]), posHesapId: String(row[1]), tarih: hucreTarihStr(row[2]),
      tip: String(row[3] || ""), tutar: tutar, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, hareketler: sonuc, toplam: toplam };
}

// ════════════════════════════════════════════════
// BANKA HESAP HAREKETLERİ — Satış/Tahsilat/Ödeme'de ödeme tipi/yöntemi
// "Havale" seçilip bir banka hesabı belirtildiğinde bu deftere kayıt düşer.
// TİP: "Giriş" (hesaba para girdi) veya "Çıkış" (hesaptan para çıktı).
// SATIS:<id> / TAHSILAT:<id> / ODEME:<id> önekiyle geri alınabilir.
// ════════════════════════════════════════════════
const BANKA_HESAP_HAREKET_BASLIKLAR = ["ID", "BANKA_HESAP_ID", "TARIH", "TIP", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI"];

function bankaHesapHareketEkle(bankaHesapId, tarih, tip, tutar, aciklama) {
  if (!bankaHesapId) return null;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesapHareketleri, BANKA_HESAP_HAREKET_BASLIKLAR);
  const id = "bh_" + Date.now();
  sheet.appendRow([id, bankaHesapId, tarih, tip, tutar, aciklama,
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);
  return id;
}

function bankaHesapHareketSilByAciklamaOnPrefix(prefix) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesapHareketleri, BANKA_HESAP_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5] || "").indexOf(prefix) === 0) { sheet.deleteRow(i + 1); break; }
  }
}

// Bir banka hesabının (veya tüm hesapların) hareket dökümü — Finans > Banka Hesap Hareketleri.
function getBankaHesapHareketleri(bankaHesapId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesapHareketleri, BANKA_HESAP_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  let toplam = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (bankaHesapId && String(row[1]) !== String(bankaHesapId)) continue;
    const tutar = parseFloat(row[4]) || 0;
    toplam += (String(row[3]) === "Giriş") ? tutar : -tutar;
    sonuc.push({
      id: String(row[0]), bankaHesapId: String(row[1]), tarih: hucreTarihStr(row[2]),
      tip: String(row[3] || ""), tutar: tutar, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, hareketler: sonuc, toplam: toplam };
}

// ════════════════════════════════════════════════
// ÜRÜN FİYAT GEÇMİŞİ — Sipariş/Teklif/Fatura oluştururken bir ürünün
// geçmiş satış fiyatlarını göstermek için (SatisKalemleri'nden).
// ════════════════════════════════════════════════

function getUrunFiyatGecmisi(urunAdi) {
  const arananUrun = String(urunAdi || "").trim().toLocaleLowerCase("tr");
  if (!arananUrun) return { ok: true, gecmis: [] };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);

  // Satış ID -> {tarih, cariAd} eşlemesi (tek geçişte)
  const sData = sSheet.getDataRange().getValues();
  const satisBilgi = {};
  for (let i = 1; i < sData.length; i++) {
    const id = String(sData[i][0] || "");
    if (!id) continue;
    satisBilgi[id] = { tarih: String(sData[i][1] || ""), cariAd: String(sData[i][3] || "") };
  }

  const kData = kSheet.getDataRange().getValues();
  const eslesenler = [];
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    const urunAdiRow = String(row[2] || "");
    if (!urunAdiRow.toLocaleLowerCase("tr").includes(arananUrun)) continue;
    const satisId = String(row[1] || "");
    const bilgi = satisBilgi[satisId] || { tarih: "", cariAd: "" };
    eslesenler.push({
      tarih: bilgi.tarih, cariAd: bilgi.cariAd,
      miktar: parseFloat(row[3]) || 0, birim: String(row[4] || ""),
      birimFiyat: parseFloat(row[5]) || 0,
    });
  }
  eslesenler.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  return { ok: true, gecmis: eslesenler.slice(0, 8) };
}

// ilk deploy tetikleme Thu Aug 13 07:50:13 UTC 2026
// tekrar tetikleme Thu Aug 13 08:44:23 UTC 2026
// debug tetikleme Thu Aug 13 08:46:04 UTC 2026

// secret düzeltme sonrası tetikleme Fri Aug 14 14:08:12 UTC 2026

// base64 secret sonrasi tetikleme// temizlenmis workflow testi Fri Aug 14 20:10:56 UTC 2026
