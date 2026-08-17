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
  tahsilatlar:    "Tahsilatlar",
  odemeler:       "Odemeler",
  bankalar:       "Bankalar",
  bankaHesaplari: "BankaHesaplari",
  posCihazlari:   "PosCihazlari",
  krediKartlari:  "KrediKartlari",
  stokTanimlari:  "StokTanimlari",
  birimTanimlari: "BirimTanimlari",
  posHareketleri: "PosHareketleri",
};

// ── YARDIMCI FONKSİYONLAR ──
// CariHesaplar sayfası daha önce CARI_KODU sütunu olmadan oluşturulmuş olabilir
// (eski veri). Sayfa zaten varsa getOrCreateSheet header'ı güncellemez, bu yüzden
// 9. sütunun (I) başlığını burada garanti altına alıyoruz — yoksa ekliyoruz.
function ensureCariKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "CARI_KODU") {
    sheet.getRange(1, 9).setValue("CARI_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
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
      case "silAlis":         result = silAlis(body); break;
      case "getTahsilatListesi": result = getTahsilatListesi(); break;
      case "saveTahsilat":       result = saveTahsilat(body); break;
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
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
  ensureCariKoduColonu(hSheet);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);

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
      tarih: String(row[7] || ""),
      cariKodu: String(row[8] || ""),
      bakiye: bakiyeMap[id] || 0,
    });
  }
  return { ok: true, cariler: sonuc };
}

// Tek bir cari hesabın bilgisini + tüm hareket geçmişini (tarihe göre sıralı, kümülatif bakiyeli) döndürür.
function getCariDetay(cariId) {
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
  ensureCariKoduColonu(hSheet);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);

  const hData = hSheet.getDataRange().getValues();
  let cari = null;
  for (let i = 1; i < hData.length; i++) {
    if (String(hData[i][0]) === String(cariId)) {
      cari = {
        id: String(hData[i][0]), tip: String(hData[i][1] || ""), ad: String(hData[i][2] || ""),
        telefon: String(hData[i][3] || ""), adres: String(hData[i][4] || ""),
        vergiNo: String(hData[i][5] || ""), not: String(hData[i][6] || ""), tarih: String(hData[i][7] || ""),
        cariKodu: String(hData[i][8] || ""),
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
      id: String(row[0]), cariId: String(row[1]), tarih: String(row[2] || ""),
      tip: String(row[3] || ""), tutar: parseFloat(row[4]) || 0,
      aciklama: String(row[5] || ""), kayitTarihi: String(row[6] || ""),
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
  const sheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
  ensureCariKoduColonu(sheet);
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
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);

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
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, hata: "Cari bulunamadı" };
}

// body: { cariId, tarih, tip (Borç/Alacak), tutar, aciklama }
function cariHareketEkle(body) {
  const cariId = String(body.cariId || "").trim();
  const tip = String(body.tip || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  if (tip !== "Borç" && tip !== "Alacak") return { ok: false, hata: "tip Borç veya Alacak olmalı" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const id = "hk_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  sheet.appendRow([id, cariId, tarih, tip, tutar, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  return { ok: true, id: id };
}

// body: { id }
function cariHareketSil(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); return { ok: true }; }
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
function ensureSatisBelgeTipiColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "BELGE_TIPI") {
    sheet.getRange(1, 9).setValue("BELGE_TIPI").setFontWeight("bold").setBackground("#e8edf5");
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
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id,
      tarih: String(row[1] || ""),
      cariId: String(row[2] || ""),
      cariAd: String(row[3] || ""),
      toplamTutar: parseFloat(row[4]) || 0,
      odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""),
      kayitTarihi: String(row[7] || ""),
      belgeTipi: String(row[8] || "") || "Fatura",
    });
  }
  sonuc.reverse(); // ID zaman damgalı olduğundan ekleme sırası = kronolojik; en yeni en üstte
  return { ok: true, satislar: sonuc };
}

// Tek bir satışı + ürün kalemlerini döner.
function getSatisDetay(satisId) {
  if (!satisId) return { ok: false, hata: "satisId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI"]);
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
      };
      break;
    }
  }
  if (!satis) return { ok: false, hata: "Satış bulunamadı" };

  const kData = kSheet.getDataRange().getValues();
  const kalemler = [];
  // Satış fişi alt toplamı: Brüt Toplam - İskonto - Ara Toplam - Kdv Toplam - Genel Toplam
  let brutToplam = 0, iskontoToplam = 0, kdvToplam = 0;
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== String(satisId)) continue;
    const miktar = parseFloat(row[3]) || 0;
    const birimFiyat = parseFloat(row[5]) || 0;
    const iskontoYuzde = parseFloat(row[7]) || 0;
    const kdvOrani = parseFloat(row[8]) || 0;
    const h = satisKalemHesapla(miktar, birimFiyat, iskontoYuzde, kdvOrani);
    brutToplam += h.brut; iskontoToplam += h.iskontoTutari; kdvToplam += h.kdvTutari;
    kalemler.push({
      id: String(row[0]), satisId: String(row[1]), urunAdi: String(row[2] || ""),
      miktar: miktar, birim: String(row[4] || ""), birimFiyat: birimFiyat,
      tutar: parseFloat(row[6]) || 0, iskontoYuzde: iskontoYuzde, kdvOrani: kdvOrani,
      iskontoTutari: h.iskontoTutari, kdvTutari: h.kdvTutari, kalemGenelToplam: h.genelToplam,
    });
  }
  const araToplam = brutToplam - iskontoToplam;
  const genelToplam = araToplam + kdvToplam;
  satis.toplamlar = {
    brutToplam: brutToplam, iskontoToplam: iskontoToplam, araToplam: araToplam,
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
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI"]);
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
  let toplamTutar = 0;
  kalemler.forEach(k => {
    const h = satisKalemHesapla(parseFloat(k.miktar) || 0, parseFloat(k.birimFiyat) || 0,
      parseFloat(k.iskontoYuzde) || 0, k.kdvOrani === undefined ? 20 : (parseFloat(k.kdvOrani) || 0));
    toplamTutar += h.genelToplam;
  });

  const id = "st_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  sSheet.appendRow([id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi, String(body.belgeTipi || "Fatura")]);

  kalemler.forEach((k, idx) => {
    const kId = "sk_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    const iskontoYuzde = parseFloat(k.iskontoYuzde) || 0;
    const kdvOrani = k.kdvOrani === undefined ? 20 : (parseFloat(k.kdvOrani) || 0);
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, iskontoYuzde, kdvOrani]);
  });

  // Cari seçildiyse, tutar kadar otomatik Borç hareketi ekle (müşteri bize borçlanır).
  // "SATIS:<id>" işaretini açıklamaya koyuyoruz ki satış silinince bu hareket bulunup geri alınabilsin.
  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Borç",
      tutar: toplamTutar,
      aciklama: "SATIS:" + id + (body.aciklama ? " - " + body.aciklama : ""),
    });
  }

  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// body: { id }
function silSatis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sSheet.getDataRange().getValues();

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      cariId = String(data[i][2] || "");
      sSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "Satış bulunamadı" };

  // Kalemlerini sil
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
  const kData = kSheet.getDataRange().getValues();
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

  // Cariye eklenmiş olan otomatik Borç hareketini bul ve geri al
  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("SATIS:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        break;
      }
    }
  }

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
      id: id, tarih: String(row[1] || ""), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      toplamTutar: parseFloat(row[4]) || 0, odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: String(row[7] || ""),
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
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);

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
    });
  }
  return { ok: true, alis: alis, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, odemeTipi, aciklama, kalemler: [{urunAdi,miktar,birim,birimFiyat}] }
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
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);

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
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat]);
  });

  // Cari seçildiyse, tutar kadar otomatik Alacak hareketi ekle (biz tedarikçiye borçlanırız).
  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Alacak",
      tutar: toplamTutar,
      aciklama: "ALIS:" + id + (body.aciklama ? " - " + body.aciklama : ""),
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

  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
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
      id: id, tarih: String(row[1] || ""), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: String(row[7] || ""), posHesapId: String(row[8] || ""),
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
  tSheet.appendRow([id, tarih, cariId, cariAd, tutar, yontem, String(body.aciklama || ""), kayitTarihi, posHesapId]);

  cariHareketEkle({
    cariId: cariId, tarih: tarih, tip: "Alacak", tutar: tutar,
    aciklama: "TAHSILAT:" + id + (body.aciklama ? " - " + body.aciklama : ""),
  });

  // Kredi Kartı ile tahsilat yapıldıysa ve bir POS hesabı seçildiyse,
  // o POS hesabına BORÇ kaydı düşülür (POS/banka bize bu tutarı ödeyecek).
  if (yontem === "Kredi Kartı" && posHesapId) {
    posHareketEkle(posHesapId, tarih, "Borç", tutar, "TAHSILAT:" + id + (body.aciklama ? " - " + body.aciklama : ""));
  }

  return { ok: true, id: id };
}

// body: { id }
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
        break;
      }
    }
  }

  // Kredi kartı tahsilatıyla birlikte bir POS hesabına düşülmüş BORÇ kaydı varsa geri al.
  posHareketSilByAciklamaOnPrefix("TAHSILAT:" + id);

  return { ok: true };
}

// ════════════════════════════════════════════════
// ÖDEME MODÜLÜ (tedarikçiye nakit/havale ödenmesi)
// Cari zorunludur. Kaydedilince cariye "Borç" hareketi eklenir
// (tedarikçiye olan borcumuz azalır). ODEME:<id> işaretiyle geri alınabilir.
// ════════════════════════════════════════════════

function getOdemeListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"]);
  const data = oSheet.getDataRange().getValues();

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    sonuc.push({
      id: id, tarih: String(row[1] || ""), cariId: String(row[2] || ""), cariAd: String(row[3] || ""),
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: String(row[7] || ""),
    });
  }
  sonuc.reverse();
  return { ok: true, odemeler: sonuc };
}

// body: { cariId, tarih, tutar, yontem, aciklama }
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
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI"]);
  const id = "od_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  oSheet.appendRow([id, tarih, cariId, cariAd, tutar, String(body.yontem || "Nakit"), String(body.aciklama || ""), kayitTarihi]);

  cariHareketEkle({
    cariId: cariId, tarih: tarih, tip: "Borç", tutar: tutar,
    aciklama: "ODEME:" + id + (body.aciklama ? " - " + body.aciklama : ""),
  });

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
        break;
      }
    }
  }

  return { ok: true };
}

// ════════════════════════════════════════════════
// FİNANS MODÜLÜ — genel özet (tüm zamanlar)
// ════════════════════════════════════════════════

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
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);
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

// ════════════════════════════════════════════════
// BANKA TANIMLAMALARI (Finans modülü altında)
// Bankalar → altında Hesap Tanımlamaları, POS Tanımlamaları, Kredi Kartı
// Tanımlamaları. Tümü BANKA_ID ile bankaya bağlanır.
// ════════════════════════════════════════════════

// Tüm banka yapısını (bankalar + hesaplar + pos + kredi kartları) tek seferde döner.
function getBankaYapisi() {
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
      if (String(data[i][0]) === id) { sheet.getRange(i+1,1,1,2).setValues([[id, ad]]); return { ok: true, id }; }
    }
  }
  id = "bk_" + Date.now();
  sheet.appendRow([id, ad]);
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
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); return { ok: true }; }
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
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); return { ok: true, id }; }
    }
  }
  id = "bh_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  return { ok: true, id: id };
}

function silBankaHesap(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); return { ok: true }; }
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
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); return { ok: true, id }; }
    }
  }
  id = "pos_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  return { ok: true, id: id };
}

function silPos(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posCihazlari, ["ID","BANKA_ID","POS_ADI","ACIKLAMA"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); return { ok: true }; }
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
      if (String(data[i][0]) === id) { satir[0] = id; sheet.getRange(i+1,1,1,4).setValues([satir]); return { ok: true, id }; }
    }
  }
  id = "kk_" + Date.now();
  satir[0] = id;
  sheet.appendRow(satir);
  return { ok: true, id: id };
}

function silKrediKarti(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); return { ok: true }; }
  }
  return { ok: false, hata: "Kredi kartı bulunamadı" };
}

// ════════════════════════════════════════════════
// STOK TANIMLAMA (Stok modülünün 2. kademesi — yeni standart modül)
// Sütunlar: Stok Kodu, Stok Adı, 1. Birim, Ambalaj Miktarı, Ambalaj Birimi,
// Alış Fiyatı, Alış İskontosu, Satış Fiyatı, Satış İskontosu.
// Eski Stok Paneli'nden tamamen bağımsız çalışır. Excel'den toplu içe aktarma destekler.
// ════════════════════════════════════════════════

const STOK_TANIM_BASLIKLAR = ["ID","STOK_KODU","STOK_ADI","BIRIM1","AMBALAJ_MIKTARI","AMBALAJ_BIRIMI","ALIS_FIYATI","ALIS_ISKONTOSU","SATIS_FIYATI","SATIS_ISKONTOSU","KAYIT_TARIHI"];

function stokTanimSatiriNesneYap(row) {
  return {
    id: String(row[0] || ""),
    stokKodu: String(row[1] || ""),
    stokAdi: String(row[2] || ""),
    birim1: String(row[3] || ""),
    ambalajMiktari: parseFloat(row[4]) || 0,
    ambalajBirimi: String(row[5] || ""),
    alisFiyati: parseFloat(row[6]) || 0,
    alisIskontosu: parseFloat(row[7]) || 0,
    satisFiyati: parseFloat(row[8]) || 0,
    satisIskontosu: parseFloat(row[9]) || 0,
    kayitTarihi: String(row[10] || ""),
  };
}

function getStokTanimListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    sonuc.push(stokTanimSatiriNesneYap(data[i]));
  }
  return { ok: true, kalemler: sonuc };
}

// body: { id (varsa güncelleme), stokKodu, stokAdi, birim1, ambalajMiktari, ambalajBirimi,
//         alisFiyati, alisIskontosu, satisFiyati, satisIskontosu }
function saveStokTanim(body) {
  const stokAdi = String(body.stokAdi || "").trim();
  if (!stokAdi) return { ok: false, hata: "Stok adı gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
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
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);
  return { ok: true, id: id };
}

function silStokTanim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i+1); return { ok: true }; }
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

  return { ok: true, eklenen: eklenen, guncellenen: guncellenen, atlanan: atlanan };
}

// ════════════════════════════════════════════════
// BİRİM TANIMLAMA (Ayarlar altında — ürünler için ölçü birimleri:
// Adet, Kg, Litre, Kutu vb. Ürün arama/seçiminde "1. birim" bu listeden
// gelir; StokTanimlari'ndaki BIRIM1 alanı serbest metin olarak kalır ama
// kullanıcı arayüzde buradaki tanımlı birimlerden seçim yapabilir.)
// ════════════════════════════════════════════════
const BIRIM_BASLIKLAR = ["ID", "AD"];

function getBirimListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    sonuc.push({ id: String(data[i][0]), ad: String(data[i][1] || "") });
  }
  return { ok: true, birimler: sonuc };
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
        return { ok: true, id: id };
      }
    }
  }
  id = "bir_" + Date.now();
  sheet.appendRow([id, ad]);
  return { ok: true, id: id };
}

function silBirim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.birimTanimlari, BIRIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, hata: "Birim bulunamadı" };
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
      id: String(row[0]), posHesapId: String(row[1]), tarih: String(row[2] || ""),
      tip: String(row[3] || ""), tutar: tutar, aciklama: String(row[5] || ""), kayitTarihi: String(row[6] || ""),
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
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR"]);

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
