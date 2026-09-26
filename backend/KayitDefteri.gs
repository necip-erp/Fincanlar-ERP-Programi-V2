// ════════════════════════════════════════════════════════════════════════════
// KAYIT DEFTERİ — veri kaybı kontrolü için tüm işlemlere sıralı KAYIT NO (2026000001...)
//
// HER İŞLEM TEK SATIR ve İKİ TARAFLI: sol tarafta BORÇ hesabı + tutarı, sağ tarafta ALACAK hesabı +
// tutarı. Sipariş ve Teklif hariç her işlemin iki tarafı da olmalıdır:
//   Satış Faturası : Borç Cari            / Alacak Stok Çıkış
//   Alış Faturası  : Borç Stok Giriş      / Alacak Cari
//   Tahsilat       : Borç Kasa|Banka|POS  / Alacak Cari
//   Ödeme          : Borç Cari|Banka|Gider/ Alacak Kasa|Banka|POS
//   Cari Virman    : Borç Cari (hedef)    / Alacak Cari (kaynak)   ... vb.
// Kasa/Gider/Çek portföyü gibi ayrı kaydı olmayan taraflar "sanal" taraftır (ana kayıttan doğar).
// Faturanın Havale ile tahsilatı ayrı bir satır olarak yazılır (Borç Banka / Alacak Cari).
//
// • Numaralar tek sayaçtan (yıl + 6 hane) verilir, ASLA yeniden kullanılmaz. Uygulamadan silinen
//   kaydın satırı defterden kalkmaz, DURUM=Silindi olur (silinme zamanıyla).
// • Bir tarafın karşılığı olan gerçek kayıt (CariHareketler/StokHareketleri/Banka/POS/...) eksikse
//   satırda "⚠ Eksik: ..." yazar. Sheet'ten elle silinen kayıtlar Kontrol ile yakalanır.
// • Defter yazımı asıl işlemi ASLA engellemez (her yer try/catch).
//
// Canlı akış: handleRequest → kdToplayiciBaslat_() (karşı kayıt toplayıcısı açılır) → işlem →
// kdIsle_() (satır(lar) deftere yazılır). Toplayıcıya kayıt notunu cariHareketEkle /
// stokHareketOtomatikYaz / banka-pos-kredi kartı hareketi fonksiyonları düşer.
// ════════════════════════════════════════════════════════════════════════════

const KD_SHEET_ADI = "KayitDefteriV2";
const KD_TEMIZ_ON_EK = "✓ (hata temizlendi"; // KONTROL alanı bu ifadeyle başlıyorsa satırın hatası kullanıcı tarafından temizlenmiştir
const KD_BASLIKLAR = ["KAYIT_NO","MODUL","ISLEM","TARIH","BELGE_NO","CARI","BELGE_TUTARI","BORC_HESAP","BORC_TUTAR","ALACAK_HESAP","ALACAK_TUTAR",
  "KONTROL","DURUM","KAYNAK","KAYNAK_ID","ALT","GRUP","BORC_KAYNAK","ALACAK_KAYNAK","BORC_BEKLENEN","ALACAK_BEKLENEN","KAYIT_ZAMANI","DEGISIKLIK_ZAMANI","SILINME_ZAMANI","CARI_KODU","MODUL_NO"];
const KD_NO = 0, KD_MODUL = 1, KD_ISLEM = 2, KD_TARIH = 3, KD_BELGE = 4, KD_CARI = 5, KD_BTUTAR = 6, KD_BHESAP = 7, KD_BTL = 8, KD_AHESAP = 9, KD_ATL = 10,
      KD_KONTROL = 11, KD_DURUM = 12, KD_KAYNAK = 13, KD_KID = 14, KD_ALT = 15, KD_GRUP = 16, KD_BKAYNAK = 17, KD_AKAYNAK = 18,
      KD_BBEKLENEN = 19, KD_ABEKLENEN = 20, KD_KAYIT = 21, KD_DEGISIM = 22, KD_SILINME = 23, KD_CARIKOD = 24, KD_MODULNO = 25;
// Sütun biçimleri: numaralar sayı, tutarlar para, gerisi METİN (E-Tablo "00", tarih vb. metinleri bozmasın).
const KD_FORMATLAR = ["0","@","@","@","@","@","#,##0.00","@","#,##0.00","@","#,##0.00","@","@","@","@","@","@","@","@","@","@","@","@","@","@","0"];

// Ana kayıt kaynakları. sheet = SHEETS anahtarı, prefix = CariHareketler/Banka/POS açıklamasındaki "PREFIX:id |" işareti.
const KD_KAYNAKLAR = {
  satis:     { modul: "Satış",       sheet: "satislar",      prefix: "SATIS",     stok: true, banka: true },
  alis:      { modul: "Alış",        sheet: "alislar",       prefix: "ALIS",      stok: true },
  alisiade:  { modul: "Alış",        sheet: "alisIadeler",   prefix: "ALISIADE",  stok: true },
  satisiade: { modul: "Satış",       sheet: "satisIadeler",  prefix: "SATISIADE", stok: true },
  tahsilat:  { modul: "Tahsilat",    sheet: "tahsilatlar",   prefix: "TAHSILAT",  banka: true, pos: true },
  odeme:     { modul: "Ödeme",       sheet: "odemeler",      prefix: "ODEME",     banka: true, pos: true, kart: true },
  virman:    { modul: "Cari Virman", sheet: "cariVirmanlar", prefix: "VIRMAN" },
  cek:       { modul: "Çek/Senet",   sheet: "cekSenetler",   prefix: "CEK", ekPrefix: ["CEKCIRO"] },
  posaktarim:{ modul: "Finans",      sheet: "posBankaAktarimlari", prefix: "POSAKTARIM", banka: true, pos: true },
};
const KD_PREFIX_ANAHTAR = { SATIS: "satis", ALIS: "alis", ALISIADE: "alisiade", SATISIADE: "satisiade", TAHSILAT: "tahsilat", ODEME: "odeme", VIRMAN: "virman", CEK: "cek", CEKCIRO: "cek", POSAKTARIM: "posaktarim" };
const KD_BACAK_MODUL = { cari: "Cari", stok: "Stok", banka: "Banka", pos: "POS", kart: "Kredi Kartı" };
const KD_STOK_BELGE_TIPLERI = ["Satış Faturası", "Alış Faturası", "Alış İadesi", "Satış İadesi"];

// Uygulama aksiyonları → deftere nasıl işleneceği.
//   tur "olustur": id sonuçtan/istekten alınır, karşı kayıtlar toplayıcıdan gelir
//   tur "guncelle": karşı kayıtlar kaynak sayfalardan yeniden taranır
//   tur "sil": kaydın satır(lar)ı DURUM=Silindi yapılır
const KD_ACTIONLAR = {
  saveSatis:              { k: "satis", tur: "olustur",  id: (b, r) => r.id },
  siparistenFaturaOlustur:{ k: "satis", tur: "olustur",  id: (b, r) => r.faturaId },
  updateSatis:            { k: "satis", tur: "guncelle", id: (b, r) => b.id },
  silSatis:               { k: "satis", tur: "sil",      id: (b, r) => b.id },
  saveAlis:               { k: "alis",  tur: "olustur",  id: (b, r) => r.id },
  onaylaAlisFaturasi:     { k: "alis",  tur: "olustur",  id: (b, r) => r.alisId },
  updateAlis:             { k: "alis",  tur: "guncelle", id: (b, r) => b.id },
  silAlis:                { k: "alis",  tur: "sil",      id: (b, r) => b.id },
  saveAlisIade:           { k: "alisiade", tur: "olustur", id: (b, r) => r.id },
  silAlisIade:            { k: "alisiade", tur: "sil",     id: (b, r) => b.id },
  saveSatisIade:          { k: "satisiade", tur: "olustur", id: (b, r) => r.id },
  silSatisIade:           { k: "satisiade", tur: "sil",     id: (b, r) => b.id },
  saveTahsilat:           { k: "tahsilat", tur: "olustur",  id: (b, r) => r.id },
  guncelleTahsilat:       { k: "tahsilat", tur: "guncelle", id: (b, r) => b.id },
  silTahsilat:            { k: "tahsilat", tur: "sil",      id: (b, r) => b.id },
  saveOdeme:              { k: "odeme", tur: "olustur", id: (b, r) => r.id },
  silOdeme:               { k: "odeme", tur: "sil",     id: (b, r) => b.id },
  saveCariVirman:         { k: "virman", tur: "olustur",  id: (b, r) => r.id },
  updateCariVirman:       { k: "virman", tur: "guncelle", id: (b, r) => b.id },
  cariVirmanSil:          { k: "virman", tur: "sil",      id: (b, r) => b.id },
  saveCekSenet:           { k: "cek", tur: "olustur",  id: (b, r) => r.id },
  cekSenetIslemYap:       { k: "cek", tur: "guncelle", id: (b, r) => b.id },
  cekSenetDurumGuncelle:  { k: "cek", tur: "guncelle", id: (b, r) => b.id },
  cekSenetHareketGeriAl:  { k: "cek", tur: "guncelle", id: (b, r) => b.id },
  savePosBankaAktarim:    { k: "posaktarim", tur: "olustur", id: (b, r) => r.id },
  silPosBankaAktarim:     { k: "posaktarim", tur: "sil",     id: (b, r) => b.id },
  silCekSenet:            { k: "cek", tur: "sil",      id: (b, r) => b.id },
  cariHareketEkle:        { k: "cariHareket", tur: "olustur", id: (b, r) => r.id },
  cariHareketSil:         { k: "cariHareket", tur: "sil",     id: (b, r) => b.id },
  silinenGeriAl:          { k: "geriAl", tur: "olustur", id: (b, r) => r.yeniId },
  tumAlislariSilVeSifirla:{ k: "alis", tur: "hepsiSenkron" },
};

// ── Toplayıcı: işlem sırasında oluşan karşı kayıtların notları ──
var KD_TOPLAYICI_ = null;
function kdToplayiciBaslat_() { KD_TOPLAYICI_ = []; }
function kdBacakNotu_(b) { if (KD_TOPLAYICI_) KD_TOPLAYICI_.push(b); }

// ── Yardımcılar ──
function kdSimdi_() { return Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"); }
function kdYil_() { return parseInt(Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy"), 10); }
function kdMetin_(v) { return v === null || v === undefined ? "" : (v instanceof Date ? hucreTarihStr(v) : String(v)); }
function kdSayi_(v) { return parseFloat(v) || 0; }
function kdBacakTuru_(k, tip) { return KD_BACAK_MODUL[k] + " " + tip; }

// "dd/MM/yyyy HH:mm" (veya Date / yyyy-MM-dd) → sıralama için sayı.
function kdZamanSayisi_(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v || "");
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  return 0;
}

function kdSheet_(ss) {
  const sheet = getOrCreateSheet(ss, KD_SHEET_ADI, KD_BASLIKLAR);
  kdBaslikGuvence_(sheet);
  return sheet;
}
// (21 Eyl 2026) Sonradan eklenen CARI_KODU sütunu (25.) eski sayfalarda yoksa başlığı + sütun biçimini ekler.
// (26 Eyl 2026) Aynı desenle MODUL_NO sütunu (26.) eklendi — genel KAYIT_NO'nun YANINDA, sadece o modülün
// kendi işlemlerini sayan ayrı bir sıra numarası (bkz. kdModulNoAl_).
function kdBaslikGuvence_(sheet) {
  if (sheet.getMaxColumns() < KD_BASLIKLAR.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), KD_BASLIKLAR.length - sheet.getMaxColumns());
  const h = sheet.getRange(1, KD_CARIKOD + 1);
  if (String(h.getValue() || "") !== "CARI_KODU") {
    h.setValue("CARI_KODU").setFontWeight("bold").setBackground("#e8edf5");
    sheet.getRange(2, KD_CARIKOD + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
  }
  const hm = sheet.getRange(1, KD_MODULNO + 1);
  if (String(hm.getValue() || "") !== "MODUL_NO") {
    hm.setValue("MODUL_NO").setFontWeight("bold").setBackground("#e8edf5");
    sheet.getRange(2, KD_MODULNO + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("0");
  }
}

function kdTumSatirlar_(sheet) {
  const son = sheet.getLastRow();
  if (son < 2) return [];
  return sheet.getRange(2, 1, son - 1, KD_BASLIKLAR.length).getValues();
}

// Satırları belirli bir satır numarasından başlayarak, sütun biçimlerini ÖNCE metne/sayıya ayarlayıp yazar.
function kdSatirlariYaz_(sheet, ilkSatir, satirlar) {
  if (!satirlar.length) return;
  const gerekenSon = ilkSatir + satirlar.length - 1;
  if (gerekenSon > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), gerekenSon - sheet.getMaxRows());
  const aralik = sheet.getRange(ilkSatir, 1, satirlar.length, KD_BASLIKLAR.length);
  aralik.setNumberFormats(satirlar.map(() => KD_FORMATLAR));
  aralik.setValues(satirlar);
}

// Kilit altında çalıştır: numara ayırma + yazma birlikte olsun ki numara boşluğu oluşmasın.
function kdKilitli_(fn) {
  const kilit = LockService.getScriptLock();
  kilit.waitLock(30000);
  try { return fn(); } finally { kilit.releaseLock(); }
}

// KİLİT ALTINDA çağrılmalı. "adet" ardışık numara ayırır, ilkini döndürür.
function kdNoAl_(sheet, adet) {
  const yil = kdYil_();
  const props = PropertiesService.getScriptProperties();
  const anahtar = "KD2_SAYAC_" + yil;
  let son = parseInt(props.getProperty(anahtar) || "0", 10) || 0;
  // Özellik kaybolsa/eskise bile numaralar geri düşmesin: sayfadaki en büyük numarayla karşılaştır.
  const sonSatir = sheet.getLastRow();
  if (sonSatir >= 2) {
    const sonNo = parseInt(sheet.getRange(sonSatir, 1).getValue(), 10) || 0;
    if (Math.floor(sonNo / 1000000) === yil) son = Math.max(son, sonNo - yil * 1000000);
  }
  props.setProperty(anahtar, String(son + adet));
  return yil * 1000000 + son + 1;
}

// (26 Eyl 2026) Modülün KENDİ, genel KAYIT_NO'dan BAĞIMSIZ sıralı takip numarası — aynı
// "yıl + 6 hane" biçimini kullanır ama sadece o modülün (ör. sadece Satış, sadece Alış)
// işlemlerini sayar. "İhtiyaç halinde modül modül işlemleri kontrol edebileyim" isteğiyle
// eklendi; genel numarayı DEĞİŞTİRMEZ, sadece yanına ikinci bir numara ekler.
// KİLİT ALTINDA çağrılmalı (kdGirisleriYaz_/kayitDefteriBaslat zaten kdKilitli_ içinde çalışır).
// satirlar: sheet'ten ÖNCEDEN okunmuş satır listesi (ek okumaya gerek kalmasın diye) — verilirse
// property kaybolsa/eskise bile o modülün defterdeki en büyük MODUL_NO'suyla karşılaştırılıp
// numara geri düşmesi önlenir.
function kdModulNoAl_(modul, adet, satirlar) {
  const yil = kdYil_();
  const props = PropertiesService.getScriptProperties();
  const anahtar = "KD2_MODULSAYAC_" + modul + "_" + yil;
  let son = parseInt(props.getProperty(anahtar) || "0", 10) || 0;
  (satirlar || []).forEach(r => {
    if (String(r[KD_MODUL]) !== modul) return;
    const mevcutNo = parseInt(r[KD_MODULNO], 10) || 0;
    if (Math.floor(mevcutNo / 1000000) === yil) son = Math.max(son, mevcutNo - yil * 1000000);
  });
  props.setProperty(anahtar, String(son + adet));
  return yil * 1000000 + son + 1;
}

// ── Bağlam: cari / banka / POS / kart adları (yalnız gerektiğinde okunur) ──
function kdBaglam_(ss) {
  const onbellek = {};
  const yukle = (ad, sheetKey) => {
    if (!onbellek[ad]) {
      const m = {};
      kdSayfaOku_(ss, SHEETS[sheetKey]).forEach(r => { m[String(r[0])] = String(r[2] || ""); });
      onbellek[ad] = m;
    }
    return onbellek[ad];
  };
  // Cari kodu haritası (CariHesaplar 9. sütun) ve fatura kalemleri (KDV hariç tutar hesabı için) — yalnız istenirse okunur.
  const kodHaritasi = () => {
    if (!onbellek.cariKod) {
      const m = {};
      kdSayfaOku_(ss, SHEETS.cariHesaplar).forEach(r => { m[String(r[0])] = String(r[8] || ""); });
      onbellek.cariKod = m;
    }
    return onbellek.cariKod;
  };
  const kalemGrupla = (ad, sheetKey) => {
    if (!onbellek[ad]) {
      const m = {};
      kdSayfaOku_(ss, SHEETS[sheetKey]).forEach(r => { const id = String(r[1]); (m[id] = m[id] || []).push(r); });
      onbellek[ad] = m;
    }
    return onbellek[ad];
  };
  return {
    cari: () => yukle("cari", "cariHesaplar"), banka: () => yukle("banka", "bankaHesaplari"),
    pos: () => yukle("pos", "posCihazlari"), kart: () => yukle("kart", "krediKartlari"),
    cariKod: kodHaritasi,
    satisKalem: () => kalemGrupla("satisKalem", "satisKalemleri"), alisKalem: () => kalemGrupla("alisKalem", "alisKalemleri"),
  };
}

function kdSayfaOku_(ss, ad) {
  const s = ss.getSheetByName(ad);
  if (!s || s.getLastRow() < 2) return [];
  const veri = s.getDataRange().getValues();
  veri.shift();
  return veri.filter(r => r[0]);
}

function kdIsaretAyir_(aciklama) {
  const m = String(aciklama || "").match(/^([A-Z]+):(\S+) \|/);
  return m ? { prefix: m[1], id: m[2] } : null;
}

// (21 Eyl 2026) Kayıt Defteri'nde FATURALARDA tutarlar her zaman KDV HARİÇ gösterilir (eskiden cari tarafı KDV dahil,
// stok tarafı hariç olduğu için karışıklık yaratıyordu). Satış faturası: faturadaki "Ara Toplam" (kalem iskontoları + dip
// iskonto düşülmüş, KDV hariç); Alış faturası: kalemlerin miktar × birim fiyat toplamı. Diğer belgelerde (iade, tahsilat,
// ödeme, çek/senet, virman) KDV yoktur → null (mevcut tutarlar aynen kalır). Satış Sipariş/Teklif satırlarının (sarı) Belge
// Tutarı da aynı kuralla KDV hariç gösterilir ki Belge Tutarı sütunu tek anlam taşısın.
function kdHaricTutar_(key, row, ctx) {
  const yuvarla = (x) => Math.round(x * 100) / 100;
  if (key === "satis") {
    const kalemler = ctx.satisKalem()[String(row[0])] || [];
    if (!kalemler.length) return null;
    let ara = 0;
    kalemler.forEach(k => { ara += satisKalemHesapla(parseFloat(k[3]) || 0, parseFloat(k[5]) || 0, parseFloat(k[7]) || 0, parseFloat(k[8]) || 0).araToplam; });
    ara -= ara * ((parseFloat(row[9]) || 0) / 100);
    const tutarIsk = parseFloat(row[13]) || 0;
    if (tutarIsk > 0 && String(row[14]) === "0") ara = Math.max(0, ara - tutarIsk); // KDV'den ÖNCE uygulanan tutar iskontosu matrahı düşürür
    return yuvarla(ara);
  }
  if (key === "alis") {
    const kalemler = ctx.alisKalem()[String(row[0])] || [];
    if (!kalemler.length) return null;
    let toplam = 0;
    kalemler.forEach(k => { toplam += (parseFloat(k[3]) || 0) * (parseFloat(k[5]) || 0); });
    return yuvarla(toplam);
  }
  return null;
}
function kdCariKodu_(cariIdler, ctx) {
  const m = ctx.cariKod();
  return (cariIdler || []).map(id => m[String(id || "")] || "").filter(Boolean).join(" → ");
}

// ── Ana kayıt tanımı ──
function kdAnaTanimla_(key, row) {
  const kk = KD_KAYNAKLAR[key];
  const id = String(row[0]);
  const t = { key: key, id: id, kaynak: SHEETS[kk.sheet], modul: kk.modul, belge: "", cariTek: true, grup: "",
              cariIdler: key === "virman" ? [row[2], row[4]] : (key === "posaktarim" ? [] : [row[2]]) };
  if (key === "satis") {
    const bt = String(row[8] || "Fatura");
    t.islem = "Satış " + (bt === "Fatura" ? "Faturası" : bt === "Sipariş" ? "Siparişi" : "Teklifi");
    t.tarih = kdMetin_(row[1]); t.cari = kdMetin_(row[3]); t.tutar = kdSayi_(row[4]); t.kayit = row[7];
    t.belge = kdMetin_(row[15]) || kdMetin_(row[16]);
  } else if (key === "alis") {
    t.islem = "Alış Faturası"; t.tarih = kdMetin_(row[1]); t.cari = kdMetin_(row[3]); t.tutar = kdSayi_(row[4]); t.kayit = row[7];
  } else if (key === "alisiade" || key === "satisiade") {
    t.islem = key === "alisiade" ? "Alış İadesi" : "Satış İadesi";
    t.tarih = kdMetin_(row[1]); t.cari = kdMetin_(row[3]); t.tutar = kdSayi_(row[4]); t.kayit = row[6];
  } else if (key === "tahsilat" || key === "odeme") {
    t.islem = (key === "tahsilat" ? "Tahsilat" : "Ödeme") + " (" + (kdMetin_(row[5]) || "—") + ")";
    t.tarih = kdMetin_(row[1]); t.cari = kdMetin_(row[3]) || (key === "odeme" ? kdMetin_(row[13]) : ""); t.tutar = kdSayi_(row[4]); t.kayit = row[7];
  } else if (key === "virman") {
    t.islem = "Cari Virman"; t.tarih = kdMetin_(row[1]); t.cariTek = false;
    t.cari = kdMetin_(row[3]) + " → " + kdMetin_(row[5]); t.tutar = kdSayi_(row[6]); t.kayit = row[8];
  } else if (key === "cek") {
    t.islem = kdMetin_(row[1]) + " " + (kdMetin_(row[15]) === "Senet" ? "Senet" : "Çek");
    t.tarih = kdMetin_(row[8]); t.cari = kdMetin_(row[3]); t.tutar = kdSayi_(row[4]); t.kayit = row[12];
    t.belge = kdMetin_(row[6]);
  } else if (key === "posaktarim") {
    t.islem = "POS → Banka Aktarımı"; t.tarih = kdMetin_(row[3]); t.cari = ""; t.tutar = kdSayi_(row[4]); t.kayit = row[6];
  }
  return t;
}

// ── Karşı kayıt indeksleri (kaynak sayfalardan) ──
// gerekli: {cari, stok, banka, pos, kart}. Dönen indeks: her tür için {isaretli: {"PREFIX:id":[bacak]}, hepsi:[{b, is}]}
function kdBacakIndeksi_(ss, gerekli) {
  const idx = { cari: null, stok: null, banka: null, pos: null, kart: null };
  const hareketOku = (k, sheetAdi) => {
    const isaretli = {}, hepsi = [];
    kdSayfaOku_(ss, sheetAdi).forEach(r => {
      const is = kdIsaretAyir_(r[5]);
      const b = { k: k, tip: kdMetin_(r[3]), kaynak: sheetAdi, kid: String(r[0]), tutar: kdSayi_(r[4]), tarih: kdMetin_(r[2]), ek: kdMetin_(r[1]),
                  aciklama: kdMetin_(r[5]), kayit: kdMetin_(r[6]), prefix: is ? is.prefix : "" };
      hepsi.push({ b: b, is: is });
      if (is) { const a = is.prefix + ":" + is.id; (isaretli[a] = isaretli[a] || []).push(b); }
    });
    return { isaretli: isaretli, hepsi: hepsi };
  };
  if (gerekli.cari) idx.cari = hareketOku("cari", SHEETS.cariHareketler);
  if (gerekli.banka) idx.banka = hareketOku("banka", SHEETS.bankaHesapHareketleri);
  if (gerekli.pos) idx.pos = hareketOku("pos", SHEETS.posHareketleri);
  if (gerekli.kart) idx.kart = hareketOku("kart", SHEETS.krediKartHareketleri);
  if (gerekli.stok) {
    const gruplu = {}, hepsi = [];
    kdSayfaOku_(ss, SHEETS.stokHareketleri).forEach(r => {
      const belgeNo = kdMetin_(r[11]);
      if (!belgeNo) return;
      const tip = kdMetin_(r[6]);
      const anahtar = belgeNo + "|" + tip;
      let g = gruplu[anahtar];
      if (!g) {
        g = { k: "stok", tip: tip, kaynak: SHEETS.stokHareketleri, kid: belgeNo, tutar: 0, tarih: kdMetin_(r[1]), ek: "", adet: 0, belgeTipi: kdMetin_(r[10]), kayit: kdMetin_(r[9]), prefix: "" };
        gruplu[anahtar] = g; hepsi.push(g);
      }
      g.tutar += kdSayi_(r[7]) * kdSayi_(r[12]); g.adet++;
    });
    const isaretli = {};
    hepsi.forEach(g => { (isaretli[g.kid] = isaretli[g.kid] || []).push(g); });
    idx.stok = { isaretli: isaretli, hepsi: hepsi.map(g => ({ b: g, is: null })) };
  }
  return idx;
}

function kdGerekliIndeksler_(key) {
  const kk = KD_KAYNAKLAR[key] || {};
  return { cari: true, stok: !!kk.stok, banka: !!kk.banka, pos: !!kk.pos, kart: !!kk.kart };
}

// Bir ana kaydın karşı kayıtları (indeksten).
function kdBacaklariBul_(idx, key, id) {
  const kk = KD_KAYNAKLAR[key];
  const sonuc = [];
  const prefixler = [kk.prefix].concat(kk.ekPrefix || []);
  ["cari", "banka", "pos", "kart"].forEach(k => {
    if (!idx[k]) return;
    prefixler.forEach(p => { (idx[k].isaretli[p + ":" + id] || []).forEach(b => sonuc.push(b)); });
  });
  if (idx.stok) (idx.stok.isaretli[id] || []).forEach(b => sonuc.push(b));
  return sonuc;
}

// ── Taraf (Borç/Alacak) kuralları ──
// Bir karşı kayıt hangi tarafa yazılır? (kasa/banka/POS/stok girişi = BORÇ, çıkışı = ALACAK)
function kdBacakTarafi_(b) {
  if (b.k === "stok" || b.k === "banka") return b.tip === "Giriş" ? "borc" : "alacak";
  if (b.k === "kart") return b.tip === "Ödeme" ? "borc" : "alacak";
  return b.tip === "Borç" ? "borc" : "alacak"; // cari, pos
}

// Bir işlem türünün satır(lar)ının taraf şartnamesi. Dönen: [{alt, grup?, islemEk?, borc?, alacak?}]
// taraf şartnamesi: {k, tip} = gerçek kayıt ŞART, {sanal: "Kasa"} = ayrı kaydı olmayan taraf, {bacak} = hazır kayıt
function kdSpecler_(key, row, opts, legs) {
  const cariId = String(row[2] || "").trim();
  const S = (k, tip) => ({ k: k, tip: tip });
  const V = (ad) => ({ sanal: ad });
  const e = [];
  if (key === "satis") {
    const bt = String(row[8] || "Fatura");
    if (bt !== "Fatura") return [{ alt: "", grup: bt === "Sipariş" ? "Sipariş" : "Teklif" }];
    e.push({ alt: "", borc: (opts.cariIsle !== false && cariId) ? S("cari", "Borç") : null, alacak: opts.stokIsle !== false ? S("stok", "Çıkış") : null });
    if (String(row[5] || "") === "Havale" && String(row[10] || "")) {
      e.push({ alt: "odeme", islemEk: " — Havale ile tahsilat", borc: S("banka", "Giriş"), alacak: cariId ? S("cari", "Alacak") : V("Peşin Müşteri") });
    }
  } else if (key === "alis") {
    e.push({ alt: "", borc: S("stok", "Giriş"), alacak: cariId ? S("cari", "Alacak") : null });
  } else if (key === "alisiade") {
    e.push({ alt: "", borc: cariId ? S("cari", "Borç") : null, alacak: S("stok", "Çıkış") });
  } else if (key === "satisiade") {
    e.push({ alt: "", borc: S("stok", "Giriş"), alacak: cariId ? S("cari", "Alacak") : null });
  } else if (key === "tahsilat") {
    const yontem = String(row[5] || "");
    const borc = yontem === "Kredi Kartı" ? (String(row[8] || "") ? S("pos", "Borç") : V("POS"))
               : yontem === "Havale/EFT" ? (String(row[9] || "") ? S("banka", "Giriş") : V("Banka")) : V("Kasa");
    e.push({ alt: "", borc: borc, alacak: S("cari", "Alacak") });
  } else if (key === "odeme") {
    const yontem = String(row[5] || "");
    const alacak = yontem === "Kredi Kartı" ? (String(row[8] || "") ? S("pos", "Alacak") : V("POS"))
                 : yontem === "Havale/EFT" ? (String(row[9] || "") ? S("banka", "Çıkış") : V("Banka")) : V("Kasa");
    const hedefTipi = String(row[10] || "") || (cariId ? "Cari" : "");
    let borc;
    if (hedefTipi === "Cari") borc = S("cari", "Borç");
    else if (hedefTipi === "Banka") {
      const alt = String(row[11] || "");
      borc = (alt === "hesap" && String(row[12] || "")) ? S("banka", "Giriş") : (alt === "kart" && String(row[12] || "")) ? S("kart", "Ödeme") : V("Banka");
    } else if (hedefTipi === "Gider") borc = V("Gider: " + kdMetin_(row[13]));
    else borc = cariId ? S("cari", "Borç") : V(hedefTipi || "Hedef");
    e.push({ alt: "", borc: borc, alacak: alacak });
  } else if (key === "virman") {
    e.push({ alt: "", borc: S("cari", "Borç"), alacak: S("cari", "Alacak") });
  } else if (key === "cek") {
    if (String(row[1] || "") === "Alınan") e.push({ alt: "", borc: V("Çek/Senet Portföyü"), alacak: S("cari", "Alacak") });
    else e.push({ alt: "", borc: S("cari", "Borç"), alacak: V("Çek/Senet (Verilen)") });
    // Ciro edilen çek: her ciro cari hareketi ayrı satır
    (legs || []).filter(b => b.k === "cari" && b.prefix === "CEKCIRO").forEach(b => {
      const borcTaraf = kdBacakTarafi_(b) === "borc";
      e.push({ alt: "ciro:" + b.kid, islemEk: " — Ciro", borc: borcTaraf ? { bacak: b } : V("Çek/Senet Portföyü"), alacak: borcTaraf ? V("Çek/Senet Portföyü") : { bacak: b } });
    });
  } else if (key === "posaktarim") {
    e.push({ alt: "", borc: S("banka", "Giriş"), alacak: S("pos", "Alacak") });
  }
  return e;
}

function kdHesapAdi_(b, t, ctx) {
  if (b.k === "cari") return "Cari: " + (t.cariTek && t.cari ? t.cari : (ctx.cari()[b.ek] || t.cari || ""));
  if (b.k === "stok") return "Stok " + b.tip;
  if (b.k === "banka") return "Banka: " + (ctx.banka()[b.ek] || "Hesap");
  if (b.k === "pos") return "POS: " + (ctx.pos()[b.ek] || "POS");
  return "Kredi Kartı: " + (ctx.kart()[b.ek] || "Kart");
}

// Bir tarafı kurar: {ad, tutar, kaynak, tur, eksik?, sanal?}
function kdTarafKur_(spec, legs, kul, t, ctx) {
  if (!spec) return null;
  if (spec.sanal) return { ad: spec.sanal, tutar: t.tutar, kaynak: "-", tur: "", sanal: true };
  let b = spec.bacak || null;
  if (!b) {
    const i = legs.findIndex((x, j) => !kul.has(j) && x.k === spec.k && x.tip === spec.tip);
    if (i >= 0) { kul.add(i); b = legs[i]; }
  }
  const tur = spec.bacak ? "" : kdBacakTuru_(spec.k, spec.tip);
  if (!b) return { ad: "", tutar: 0, kaynak: "", tur: tur, eksik: true };
  return { ad: kdHesapAdi_(b, t, ctx), tutar: b.tutar, kaynak: b.kaynak + "|" + b.kid, tur: spec.bacak ? "" : tur };
}

function kdKontrolMetni_(g) {
  if (g.grup === "Sipariş" || g.grup === "Teklif") return "—";
  if (g.grup === "Manuel") return "— (manuel giriş, tek taraflı)";
  if (g.grup === "Yetim") return "⚠ Ana kayıt bulunamadı";
  const eksik = [];
  [g.borc, g.alacak].forEach(x => { if (x && x.eksik) eksik.push(x.tur); });
  if (eksik.length) return "⚠ Eksik: " + eksik.join(", ");
  if (!g.borc && !g.alacak) return "— (cari/stok işlenmedi)";
  if (!g.borc || !g.alacak) return "⚠ Tek taraflı (" + (g.borc ? "alacak" : "borç") + " tarafı işlenmedi)";
  if (g.borc && g.alacak && !/^Stok/.test(g.borc.ad) && !/^Stok/.test(g.alacak.ad) && Math.abs(g.borc.tutar - g.alacak.tutar) > 0.05) return "⚠ Tutar farkı";
  return "✓";
}

// Ana kayıt + karşı kayıtlar + kurallardan defter girişleri (satırları) üretir.
function kdGirisleriKur_(key, row, legs, opts, t, ctx) {
  const kul = new Set();
  return kdSpecler_(key, row, opts || {}, legs).map(spec => {
    const g = { alt: spec.alt, grup: spec.grup || t.grup || "", modul: t.modul, islem: t.islem + (spec.islemEk || ""), tarih: t.tarih, belge: t.belge, cari: t.cari, belgeTutari: t.tutar,
                kaynak: t.kaynak, kid: t.id, kayit: t.kayit };
    g.borc = kdTarafKur_(spec.borc, legs, kul, t, ctx);
    g.alacak = kdTarafKur_(spec.alacak, legs, kul, t, ctx);
    g.kontrol = kdKontrolMetni_(g); // kontrol GERÇEK karşı kayıt tutarlarıyla yapılır; aşağıdaki KDV hariç düzeltme yalnız gösterim içindir
    g.cariKodu = kdCariKodu_(t.cariIdler, ctx);
    // Faturanın kendi (ana) satırında Belge Tutarı ve iki tarafın tutarı KDV HARİÇ gösterilir. Faturaya bağlı
    // "Havale ile tahsilat" gibi alt satırlar gerçek para hareketidir, olduğu gibi kalır.
    if (!spec.alt && (key === "satis" || key === "alis")) {
      const haric = kdHaricTutar_(key, row, ctx);
      if (haric !== null) {
        g.belgeTutari = haric;
        if (g.borc && !g.borc.eksik) g.borc = Object.assign({}, g.borc, { tutar: haric });
        if (g.alacak && !g.alacak.eksik) g.alacak = Object.assign({}, g.alacak, { tutar: haric });
      }
    }
    return g;
  });
}

// Manuel cari hareketi (işaretsiz) veya sahipsiz (ana kaydı olmayan) hareket → tek taraflı giriş.
function kdTekBacakGirisi_(b, modulAdi, islem, grup, cariAd, ctx) {
  const t = { modul: modulAdi, cari: cariAd, cariTek: true, tutar: b.tutar };
  const g = { alt: "", grup: grup, modul: modulAdi, islem: islem, tarih: b.tarih, belge: "", cari: cariAd, belgeTutari: b.tutar, kaynak: b.kaynak, kid: b.kid, kayit: b.kayit, borc: null, alacak: null,
             cariKodu: b.k === "cari" ? (ctx.cariKod()[String(b.ek)] || "") : "" };
  const taraf = { ad: kdHesapAdi_(b, t, ctx), tutar: b.tutar, kaynak: b.kaynak + "|" + b.kid, tur: "" };
  if (kdBacakTarafi_(b) === "borc") g.borc = taraf; else g.alacak = taraf;
  g.kontrol = kdKontrolMetni_(g);
  return g;
}

// ── Satır kurucu ──
function kdSatiri_(no, g, kayitZamani, modulNo) {
  const s = new Array(KD_BASLIKLAR.length).fill("");
  s[KD_NO] = no; s[KD_MODUL] = g.modul; s[KD_ISLEM] = g.islem; s[KD_TARIH] = g.tarih || ""; s[KD_BELGE] = g.belge || ""; s[KD_CARI] = g.cari || "";
  s[KD_BTUTAR] = g.belgeTutari || 0;
  const taraf = (x) => x ? (x.eksik ? "⚠ " + x.tur + " YOK" : x.ad) : "";
  s[KD_BHESAP] = taraf(g.borc); s[KD_BTL] = g.borc && !g.borc.eksik ? g.borc.tutar : "";
  s[KD_AHESAP] = taraf(g.alacak); s[KD_ATL] = g.alacak && !g.alacak.eksik ? g.alacak.tutar : "";
  s[KD_KONTROL] = g.kontrol; s[KD_DURUM] = "Aktif"; s[KD_KAYNAK] = g.kaynak; s[KD_KID] = g.kid; s[KD_ALT] = g.alt || ""; s[KD_GRUP] = g.grup || "";
  s[KD_BKAYNAK] = g.borc ? g.borc.kaynak : ""; s[KD_AKAYNAK] = g.alacak ? g.alacak.kaynak : "";
  s[KD_BBEKLENEN] = g.borc && g.borc.tur ? g.borc.tur : ""; s[KD_ABEKLENEN] = g.alacak && g.alacak.tur ? g.alacak.tur : "";
  s[KD_KAYIT] = kayitZamani; s[KD_DEGISIM] = ""; s[KD_SILINME] = ""; s[KD_CARIKOD] = g.cariKodu || ""; s[KD_MODULNO] = modulNo || "";
  return s;
}

// ── CANLI AKIŞ ──
function kdKaynakSatiriBul_(ss, key, id) {
  const sheet = ss.getSheetByName(SHEETS[KD_KAYNAKLAR[key].sheet]);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const idler = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < idler.length; i++) {
    if (String(idler[i][0]) === String(id)) return sheet.getRange(i + 2, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  }
  return null;
}

function kdGirisAnahtari_(kaynak, kid, alt) { return String(kaynak) + "|" + String(kid) + "|" + String(alt || ""); }

// Bir ana kaydın defter satırlarını (giriş listesi) deftere işler: yoksa oluşturur, varsa yerinde günceller,
// artık üretilmeyen girişleri Silindi yapar.
function kdGirisleriYaz_(ss, sheet, kaynak, kid, girisler) {
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    const simdi = kdSimdi_();
    const mevcut = {};
    satirlar.forEach((r, i) => { if (String(r[KD_KAYNAK]) === String(kaynak) && String(r[KD_KID]) === String(kid) && r[KD_DURUM] === "Aktif") mevcut[String(r[KD_ALT] || "")] = i; });
    const yeniler = girisler.filter(g => mevcut[g.alt || ""] === undefined);
    const no0 = yeniler.length ? kdNoAl_(sheet, yeniler.length) : 0;
    // Bir kdGirisleriYaz_ çağrısındaki TÜM girişler aynı ana kayda (dolayısıyla aynı modüle) ait
    // olduğundan (bkz. kdGirisleriKur_: g.modul = t.modul), tek bir modül no bloğu yeterli.
    const modulNo0 = yeniler.length ? kdModulNoAl_(yeniler[0].modul, yeniler.length, satirlar) : 0;
    const uretilen = {};
    girisler.forEach(g => {
      uretilen[g.alt || ""] = true;
      const i = mevcut[g.alt || ""];
      if (i !== undefined) {
        const s = kdSatiri_(Number(satirlar[i][KD_NO]), g, satirlar[i][KD_KAYIT], satirlar[i][KD_MODULNO]);
        s[KD_DEGISIM] = simdi;
        kdSatirlariYaz_(sheet, i + 2, [s]);
      }
    });
    Object.keys(mevcut).forEach(alt => {
      if (uretilen[alt]) return;
      const i = mevcut[alt];
      const s = satirlar[i].slice(); s[KD_DURUM] = "Silindi"; s[KD_SILINME] = simdi; s[KD_DEGISIM] = simdi;
      kdSatirlariYaz_(sheet, i + 2, [s]);
    });
    if (yeniler.length) kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, yeniler.map((g, j) => kdSatiri_(no0 + j, g, simdi, modulNo0 + j)));
  });
}

function kdGrupSenkronla_(ss, key, id, bacaklar, opts) {
  const row = kdKaynakSatiriBul_(ss, key, id);
  if (!row) return { atlandi: "kaynak bulunamadı" };
  const t = kdAnaTanimla_(key, row);
  const girisler = kdGirisleriKur_(key, row, bacaklar, opts, t, kdBaglam_(ss));
  kdGirisleriYaz_(ss, kdSheet_(ss), t.kaynak, t.id, girisler);
  return { ok: true };
}

// Kaynak kaydın tüm satırlarını DURUM=Silindi yapar.
function kdSilindiIsaretle_(ss, kaynakAdi, id) {
  const sheet = kdSheet_(ss);
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    const simdi = kdSimdi_();
    satirlar.forEach((r, i) => {
      if (String(r[KD_KAYNAK]) === String(kaynakAdi) && String(r[KD_KID]) === String(id) && r[KD_DURUM] === "Aktif") {
        const s = r.slice(); s[KD_DURUM] = "Silindi"; s[KD_SILINME] = simdi; s[KD_DEGISIM] = simdi;
        kdSatirlariYaz_(sheet, i + 2, [s]);
      }
    });
  });
}

// Uygulamadan bir Cari hareketi silinince: kendisi ana satırsa Silindi olur; başka bir işlemin tarafıysa o satır
// "⚠ Eksik" olarak işaretlenir (taraf kaynağı artık yok).
function kdCariHareketiSilindi_(ss, id) {
  kdSilindiIsaretle_(ss, SHEETS.cariHareketler, id);
  const sheet = kdSheet_(ss);
  const anahtar = SHEETS.cariHareketler + "|" + id;
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    const simdi = kdSimdi_();
    satirlar.forEach((r, i) => {
      if (r[KD_DURUM] !== "Aktif") return;
      const borcta = String(r[KD_BKAYNAK]) === anahtar, alacakta = String(r[KD_AKAYNAK]) === anahtar;
      if (!borcta && !alacakta) return;
      const s = r.slice();
      const tur = borcta ? (s[KD_BBEKLENEN] || "Cari Borç") : (s[KD_ABEKLENEN] || "Cari Alacak");
      if (borcta) { s[KD_BHESAP] = "⚠ " + tur + " YOK"; s[KD_BTL] = ""; s[KD_BKAYNAK] = ""; s[KD_BBEKLENEN] = tur; }
      else { s[KD_AHESAP] = "⚠ " + tur + " YOK"; s[KD_ATL] = ""; s[KD_AKAYNAK] = ""; s[KD_ABEKLENEN] = tur; }
      s[KD_KONTROL] = "⚠ Eksik: " + tur; s[KD_DEGISIM] = simdi;
      kdSatirlariYaz_(sheet, i + 2, [s]);
    });
  });
}

function kdManuelCariHareketi_(ss, id) {
  const sheet = ss.getSheetByName(SHEETS.cariHareketler);
  if (!sheet || sheet.getLastRow() < 2) return;
  const veri = sheet.getDataRange().getValues();
  let r = null;
  for (let i = 1; i < veri.length; i++) if (String(veri[i][0]) === String(id)) { r = veri[i]; break; }
  if (!r || kdIsaretAyir_(r[5])) return; // işaretliyse başka bir işlemin karşı kaydı
  const ctx = kdBaglam_(ss);
  const b = { k: "cari", tip: kdMetin_(r[3]), kaynak: SHEETS.cariHareketler, kid: String(r[0]), tutar: kdSayi_(r[4]), tarih: kdMetin_(r[2]), ek: kdMetin_(r[1]), kayit: r[6], prefix: "" };
  const g = kdTekBacakGirisi_(b, "Cari", "Cari Hareket (Manuel) — " + b.tip, "Manuel", ctx.cari()[b.ek] || "", ctx);
  const defter = kdSheet_(ss);
  const satirlar = kdTumSatirlar_(defter);
  if (satirlar.some(x => String(x[KD_KAYNAK]) === b.kaynak && String(x[KD_KID]) === b.kid && x[KD_DURUM] === "Aktif")) return;
  kdGirisleriYaz_(ss, defter, b.kaynak, b.kid, [g]);
}

// silinenGeriAl: geri yüklenen kaydın türünü SilinenIslemler'den öğren.
function kdGeriAlAnahtari_(ss, body) {
  const s = ss.getSheetByName(SHEETS.silinenIslemler);
  if (!s || s.getLastRow() < 2) return "";
  const v = s.getDataRange().getValues();
  const harita = { TAHSILAT: "tahsilat", ODEME: "odeme", SATIS: "satis", ALIS: "alis", ALISIADE: "alisiade", SATISIADE: "satisiade", CEKSENET: "cek", VIRMAN: "virman" };
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === String(body.id)) return harita[String(v[i][1] || "")] || "";
  return "";
}

// handleRequest'ten, işlem BAŞARIYLA bittikten sonra çağrılır. Hata verse bile asıl işlem etkilenmez.
function kdIsle_(action, body, result, bacaklar) {
  const meta = KD_ACTIONLAR[action];
  if (!meta || !result || result.ok === false || result.error) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (meta.tur === "hepsiSenkron") { kdKaynagiOlmayanlariSilindiYap_(ss, meta.k); return; }
  const id = String(meta.id(body, result) || "");
  let key = meta.k;
  if (key === "geriAl") { key = kdGeriAlAnahtari_(ss, body); if (!key) return; }
  if (key === "cariHareket") {
    if (meta.tur === "sil") kdCariHareketiSilindi_(ss, id);
    else kdManuelCariHareketi_(ss, id);
    return;
  }
  if (!id) return;
  const kaynakAdi = SHEETS[KD_KAYNAKLAR[key].sheet];
  if (meta.tur === "sil") { kdSilindiIsaretle_(ss, kaynakAdi, id); return; }
  const opts = { stokIsle: body.stokIsle, cariIsle: body.cariIsle };
  let legs = bacaklar || [];
  if (meta.tur === "guncelle") {
    legs = kdBacaklariBul_(kdBacakIndeksi_(ss, kdGerekliIndeksler_(key)), key, id);
  } else {
    const gorulen = {};
    legs = legs.filter(b => { const a = b.k + "|" + b.tip + "|" + b.kaynak + "|" + b.kid; if (gorulen[a]) return false; gorulen[a] = 1; return true; });
  }
  kdGrupSenkronla_(ss, key, id, legs, opts);
}

// Toplu "tumAlislariSilVeSifirla" gibi işlemlerden sonra: kaynağı artık olmayan Aktif ana satırları Silindi yap.
function kdKaynagiOlmayanlariSilindiYap_(ss, key) {
  const kaynakAdi = SHEETS[KD_KAYNAKLAR[key].sheet];
  const mevcutId = new Set(kdSayfaOku_(ss, kaynakAdi).map(r => String(r[0])));
  const sheet = kdSheet_(ss);
  const silinecekler = {};
  kdTumSatirlar_(sheet).forEach(r => { if (r[KD_DURUM] === "Aktif" && String(r[KD_KAYNAK]) === kaynakAdi && !mevcutId.has(String(r[KD_KID]))) silinecekler[String(r[KD_KID])] = true; });
  Object.keys(silinecekler).forEach(id => kdSilindiIsaretle_(ss, kaynakAdi, id));
}

// ── DÜNYA: tüm kaynakların anlık görüntüsü (Numarala + Kontrol için) ──
function kdDunyaOku_(ss) {
  const d = { anaSatirlar: {}, anaIdSeti: {}, idx: kdBacakIndeksi_(ss, { cari: true, stok: true, banka: true, pos: true, kart: true }) };
  Object.keys(KD_KAYNAKLAR).forEach(key => {
    const rows = kdSayfaOku_(ss, SHEETS[KD_KAYNAKLAR[key].sheet]);
    d.anaSatirlar[key] = rows;
    d.anaIdSeti[key] = new Set(rows.map(r => String(r[0])));
  });
  return d;
}

// Ana kaydı olmayan (sahipsiz) veya işaretsiz (manuel) hareketleri tek taraflı giriş olarak üretir.
function kdYetimGirisleri_(dunya, ctx) {
  const sonuc = [];
  [["cari", "Cari"], ["banka", "Banka"], ["pos", "POS"], ["kart", "Kredi Kartı"]].forEach(([k, modulAdi]) => {
    if (!dunya.idx[k]) return;
    dunya.idx[k].hepsi.forEach(x => {
      const b = x.b, is = x.is;
      const cariAd = k === "cari" ? (ctx.cari()[b.ek] || "") : "";
      if (!is) {
        if (k !== "cari") return; // işaretsiz banka/pos/kart hareketleri (manuel) ilk sürümde kapsam dışı
        sonuc.push({ g: kdTekBacakGirisi_(b, "Cari", "Cari Hareket (Manuel) — " + b.tip, "Manuel", cariAd, ctx), zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
        return;
      }
      const key = KD_PREFIX_ANAHTAR[is.prefix];
      if (key && dunya.anaIdSeti[key] && dunya.anaIdSeti[key].has(is.id)) return; // sahibi var
      sonuc.push({ g: kdTekBacakGirisi_(b, modulAdi, "Sahipsiz " + kdBacakTuru_(k, b.tip) + " (ana kayıt yok: " + is.prefix + ":" + is.id + ")", "Yetim", cariAd, ctx), zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
    });
  });
  if (dunya.idx.stok) {
    const tumIdler = new Set();
    Object.keys(dunya.anaIdSeti).forEach(k => dunya.anaIdSeti[k].forEach(i => tumIdler.add(i)));
    dunya.idx.stok.hepsi.forEach(x => {
      const b = x.b;
      if (KD_STOK_BELGE_TIPLERI.indexOf(b.belgeTipi) < 0 || tumIdler.has(b.kid)) return;
      sonuc.push({ g: kdTekBacakGirisi_(b, "Stok", "Sahipsiz " + kdBacakTuru_("stok", b.tip) + " (" + b.belgeTipi + ", ana kayıt yok)", "Yetim", "", ctx), zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
    });
  }
  return sonuc;
}

// "dd/MM/yyyy HH:mm" biçimini korur; Date ise biçimler; değilse "".
function kdZamanMetniDuzenle_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const s = String(v || "");
  return /^\d{2}\/\d{2}\/\d{4}/.test(s) ? s : "";
}

// ── MEVCUT KAYITLARI NUMARALA (geriye dönük / eksik tamamlama) ──
// Kaynak sayfalardaki tüm kayıtlardan (ve sahipsiz/manuel hareketlerden) defter girişlerini üretir: [{g, zaman}]
function kdTumGirisleriUret_(dunya, ctx) {
  const aday = [];
  Object.keys(KD_KAYNAKLAR).forEach(key => {
    dunya.anaSatirlar[key].forEach(r => {
      const t = kdAnaTanimla_(key, r);
      const zaman = kdZamanSayisi_(t.kayit) || kdZamanSayisi_(t.tarih);
      kdGirisleriKur_(key, r, kdBacaklariBul_(dunya.idx, key, t.id), {}, t, ctx).forEach(g => aday.push({ g: g, zaman: zaman }));
    });
  });
  kdYetimGirisleri_(dunya, ctx).forEach(y => aday.push(y));
  return aday;
}

function kayitDefteriBaslat(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const dunya = kdDunyaOku_(ss);
  const ctx = kdBaglam_(ss);
  const aday = kdTumGirisleriUret_(dunya, ctx); // {g, zaman}
  const idSirasi = (g) => parseInt((String(g.kid).match(/\d{10,}/) || ["0"])[0], 10) || 0;
  aday.sort((a, b) => (a.zaman - b.zaman) || (idSirasi(a.g) - idSirasi(b.g)));

  let yeni = 0;
  const PARCA = 200;
  for (let bas = 0; bas < aday.length; bas += PARCA) {
    const parca = aday.slice(bas, bas + PARCA);
    kdKilitli_(() => {
      const guncelSatirlar = kdTumSatirlar_(sheet);
      const varOlan = {};
      guncelSatirlar.forEach(r => { varOlan[kdGirisAnahtari_(r[KD_KAYNAK], r[KD_KID], r[KD_ALT])] = true; });
      const eklenecek = parca.filter(a => !varOlan[kdGirisAnahtari_(a.g.kaynak, a.g.kid, a.g.alt)]);
      if (!eklenecek.length) return;
      const no0 = kdNoAl_(sheet, eklenecek.length);
      const simdi = kdSimdi_();
      // Bu parça birden fazla modülü karışık içerebilir (zamana göre sıralı) — her modül için
      // ayrı bir modül-no bloğu ayrılıp, parça içinde o modülün kaçıncı görülüşüyse ondan verilir.
      const modulAdet = {};
      eklenecek.forEach(a => { modulAdet[a.g.modul] = (modulAdet[a.g.modul] || 0) + 1; });
      const modulBaslangic = {};
      Object.keys(modulAdet).forEach(m => { modulBaslangic[m] = kdModulNoAl_(m, modulAdet[m], guncelSatirlar); });
      const modulIlerleme = {};
      kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, eklenecek.map((a, j) => {
        const m = a.g.modul;
        modulIlerleme[m] = (modulIlerleme[m] || 0) + 1;
        return kdSatiri_(no0 + j, a.g, kdZamanMetniDuzenle_(a.g.kayit) || simdi, modulBaslangic[m] + modulIlerleme[m] - 1);
      }));
      yeni += eklenecek.length;
    });
  }
  return { ok: true, yeniKayit: yeni, toplamAday: aday.length };
}

// ── (21 Eyl 2026) MEVCUT SATIRLARI GÜNCELLE: Fatura tutarları KDV HARİÇ + Cari Kodu ──
// Sadece BELGE_TUTARI / BORC_TUTAR / ALACAK_TUTAR / CARI_KODU hücrelerini, kaynak kayıtlardan yeniden hesaplanan
// değerle yerinde günceller. Kayıt no, kontrol, durum, zaman damgaları (DEĞİŞİKLİK dahil) DOKUNULMAZ. Kaynağı artık
// olmayan (Silindi) satırlar hesaplanamadığı için olduğu gibi kalır. Tekrar çalıştırmak güvenlidir. Bittiğinde bayrak
// konur; getKayitDefteri "duzeltmeGerekli" bayrağını buna göre döner.
function kayitDefteriTutarKoduDuzelt(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const dunya = kdDunyaOku_(ss);
  const ctx = kdBaglam_(ss);
  const aday = kdTumGirisleriUret_(dunya, ctx);
  const esit = (a, b) => {
    const sa = String(a === null || a === undefined ? "" : a), sb = String(b === null || b === undefined ? "" : b);
    if (sa === "" || sb === "") return sa === sb;
    const na = Number(sa), nb = Number(sb);
    return (isNaN(na) || isNaN(nb)) ? sa === sb : Math.abs(na - nb) < 0.005;
  };
  let guncellenen = 0, incelenen = 0;
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    if (!satirlar.length) return;
    const indeks = {};
    satirlar.forEach((r, i) => { if (r[KD_DURUM] === "Aktif") indeks[kdGirisAnahtari_(r[KD_KAYNAK], r[KD_KID], r[KD_ALT])] = i; });
    const kolonlar = [KD_BTUTAR, KD_BTL, KD_ATL, KD_CARIKOD];
    aday.forEach(a => {
      const i = indeks[kdGirisAnahtari_(a.g.kaynak, a.g.kid, a.g.alt)];
      if (i === undefined) return;
      incelenen++;
      const yeni = kdSatiri_(0, a.g, "");
      let degisti = false;
      kolonlar.forEach(c => { if (!esit(satirlar[i][c], yeni[c])) { satirlar[i][c] = yeni[c]; degisti = true; } });
      if (degisti) guncellenen++;
    });
    if (guncellenen) {
      kolonlar.forEach(c => {
        const aralik = sheet.getRange(2, c + 1, satirlar.length, 1);
        aralik.setNumberFormats(satirlar.map(() => [KD_FORMATLAR[c]]));
        aralik.setValues(satirlar.map(r => [r[c]]));
      });
    }
  });
  PropertiesService.getScriptProperties().setProperty("KD_HARIC_SURUM", "1");
  return { ok: true, incelenen: incelenen, guncellenen: guncellenen };
}

// ── KONTROL ──
// opts.tumu: bulgu listeleri kısaltılmaz ve her bulguya satır indeksi (_i) + düzeltme notları eklenir (Hataları Temizle için).
function getKayitDefteriKontrol(opts) {
  opts = opts || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const satirlar = kdTumSatirlar_(sheet);
  const dunya = kdDunyaOku_(ss);
  const ctx = kdBaglam_(ss);
  const LIMIT = opts.tumu ? 1e9 : 300;
  const duzeltNotlari = []; // {i, tur, taraf}
  let sonIdx = -1;
  const kategoriler = ["silinenler", "kaynakYok", "karsiEksik", "tekTaraf", "sahipsiz", "numarasiz", "tutarFarki", "karsiKalmis", "nakliyeSupheli"];
  const nakliyeSupheli = nkSupheliAlisHaritasi_();
  const s = {}, sayac = {};
  kategoriler.forEach(k => { s[k] = []; sayac[k] = 0; });
  const ekle = (ad, o) => { sayac[ad]++; if (s[ad].length < LIMIT) s[ad].push(o); };
  const ozetle = (r, not) => ({ no: Number(r[KD_NO]), modul: r[KD_MODUL], islem: r[KD_ISLEM], belgeNo: kdMetin_(r[KD_BELGE]), tarih: kdMetin_(r[KD_TARIH]), cari: kdMetin_(r[KD_CARI]), tutar: kdSayi_(r[KD_BTUTAR]), not: not, _i: sonIdx });
  const temizlendiMi = (r) => String(r[KD_KONTROL]).indexOf(KD_TEMIZ_ON_EK) === 0; // "Hataları Temizle" ile kabul edilmiş satır

  const idKumesi = (k) => new Set((dunya.idx[k] ? dunya.idx[k].hepsi : []).map(x => x.b.kid));
  const cariIdleri = idKumesi("cari"), bankaIdleri = idKumesi("banka"), posIdleri = idKumesi("pos"), kartIdleri = idKumesi("kart"), stokBelgeler = idKumesi("stok");
  const kaynakVarMi = (kaynak, kid) => {
    const k = String(kaynak), id = String(kid);
    if (k === SHEETS.cariHareketler) return cariIdleri.has(id);
    if (k === SHEETS.bankaHesapHareketleri) return bankaIdleri.has(id);
    if (k === SHEETS.posHareketleri) return posIdleri.has(id);
    if (k === SHEETS.krediKartHareketleri) return kartIdleri.has(id);
    if (k === SHEETS.stokHareketleri) return stokBelgeler.has(id);
    const key = Object.keys(KD_KAYNAKLAR).find(x => SHEETS[KD_KAYNAKLAR[x].sheet] === k);
    return key ? dunya.anaIdSeti[key].has(id) : true;
  };
  const tarafVarMi = (tarafKaynak) => {
    if (!tarafKaynak || tarafKaynak === "-") return true; // sanal / tanımsız
    const i = String(tarafKaynak).indexOf("|");
    return kaynakVarMi(String(tarafKaynak).slice(0, i), String(tarafKaynak).slice(i + 1));
  };

  const basvurulan = new Set();
  satirlar.forEach(r => {
    basvurulan.add(String(r[KD_KAYNAK]) + "|" + String(r[KD_KID]));
    [r[KD_BKAYNAK], r[KD_AKAYNAK]].forEach(x => { if (x && x !== "-") basvurulan.add(String(x)); });
  });

  satirlar.forEach((r, satirIdx) => {
    sonIdx = satirIdx;
    const durum = r[KD_DURUM];
    const grup = String(r[KD_GRUP]);
    const anaAnahtar = String(r[KD_KAYNAK]) + "|" + String(r[KD_KID]);
    if (durum === "Silindi") {
      if (String(r[KD_ALT] || "") === "") ekle("silinenler", ozetle(r, "Silindi: " + kdMetin_(r[KD_SILINME])));
      // silinmiş satırın karşı kaydı hâlâ duruyor mu?
      [[r[KD_BKAYNAK], r[KD_BHESAP]], [r[KD_AKAYNAK], r[KD_AHESAP]]].forEach(([k, ad]) => {
        if (!temizlendiMi(r) && k && k !== "-" && String(k) !== anaAnahtar && tarafVarMi(k)) {
          ekle("karsiKalmis", ozetle(r, "Deftere göre silinmiş ama karşı kayıt (" + ad + ") kaynak sayfada HÂLÂ duruyor"));
          duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "karsiKalmis", kaynak: String(k) });
        }
      });
      return;
    }
    if (!kaynakVarMi(r[KD_KAYNAK], r[KD_KID])) {
      ekle("kaynakYok", ozetle(r, "Defterde var ama kaynak sayfada kayıt YOK (uygulama dışından silinmiş olabilir)"));
      duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "kaynakYok" });
      return;
    }
    if (String(r[KD_KAYNAK]) === SHEETS.alislar && String(r[KD_ALT] || "") === "" && nakliyeSupheli[String(r[KD_KID])]) ekle("nakliyeSupheli", ozetle(r, nakliyeSupheli[String(r[KD_KID])].not));
    if (temizlendiMi(r)) return; // hatası "Hataları Temizle" ile kabul edilmiş satır: kaynak değişip satır yeniden hesaplanana kadar bulgu sayılmaz
    if (grup === "Yetim") { ekle("sahipsiz", ozetle(r, "Ana kaydı olmayan hareket")); duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "sahipsiz" }); }
    if (grup === "Sipariş" || grup === "Teklif" || grup === "Manuel") return;
    if (String(r[KD_KONTROL]).indexOf("⚠ Tek taraflı") === 0) { ekle("tekTaraf", ozetle(r, String(r[KD_KONTROL]))); duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "tekTaraf" }); }
    // Beklenen ama hiç bulunamayan taraflar
    [[r[KD_BBEKLENEN], r[KD_BKAYNAK]], [r[KD_ABEKLENEN], r[KD_AKAYNAK]]].forEach(([tur, kaynak]) => {
      if (tur && !kaynak) { ekle("karsiEksik", ozetle(r, "Eksik karşı kayıt: " + tur)); duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "karsiEksik" }); }
      else if (kaynak && !tarafVarMi(kaynak)) { ekle("karsiEksik", ozetle(r, "Karşı kayıt kaynak sayfada bulunamadı (elle silinmiş olabilir): " + kaynak)); duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "karsiEksik" }); }
    });
    // Tutar kontrolü (stok tarafı KDV/iskonto nedeniyle farklı olabilir → hariç)
    const bt = kdSayi_(r[KD_BTL]), at = kdSayi_(r[KD_ATL]);
    if (r[KD_BKAYNAK] && r[KD_AKAYNAK] && !/^Stok/.test(String(r[KD_BHESAP])) && !/^Stok/.test(String(r[KD_AHESAP])) && Math.abs(bt - at) > 0.05) {
      ekle("tutarFarki", ozetle(r, "Borç " + bt.toFixed(2) + " ≠ Alacak " + at.toFixed(2)));
      duzeltNotlari.push({ i: satirIdx, no: Number(r[KD_NO]), tur: "tutarFarki" });
    }
  });

  // Numarasız: kaynakta olup defterde hiç olmayan ana kayıtlar / hareketler
  const defterdeAna = new Set(satirlar.map(r => String(r[KD_KAYNAK]) + "|" + String(r[KD_KID])));
  Object.keys(KD_KAYNAKLAR).forEach(key => {
    dunya.anaSatirlar[key].forEach(row => {
      const t = kdAnaTanimla_(key, row);
      if (!defterdeAna.has(t.kaynak + "|" + t.id)) { ekle("numarasiz", { no: "", modul: t.modul, islem: t.islem, belgeNo: t.belge, tarih: t.tarih, cari: t.cari, tutar: t.tutar, not: "Kaynakta var, defterde numarası yok" }); return; }
      // ana kayıt numaralı ama karşı kaydı deftere işlenmemiş (uygulama dışında eklenmiş)
      kdBacaklariBul_(dunya.idx, key, t.id).forEach(b => {
        if (!basvurulan.has(b.kaynak + "|" + b.kid)) ekle("numarasiz", { no: "", modul: t.modul, islem: t.islem + " → " + kdBacakTuru_(b.k, b.tip), belgeNo: t.belge, tarih: b.tarih, cari: t.cari, tutar: b.tutar, not: "Karşı kayıt kaynakta var ama defterde hiçbir satırda yok" });
      });
    });
  });
  kdYetimGirisleri_(dunya, ctx).forEach(y => {
    if (!basvurulan.has(y.g.kaynak + "|" + y.g.kid)) ekle("numarasiz", { no: "", modul: y.g.modul, islem: y.g.islem, belgeNo: "", tarih: y.g.tarih, cari: y.g.cari, tutar: y.g.belgeTutari, not: "Kaynakta var, defterde numarası yok" });
  });

  const aktif = satirlar.filter(r => r[KD_DURUM] === "Aktif").length;
  const ozet = {
    toplamKayit: satirlar.length, aktif: aktif, silinen: satirlar.length - aktif,
    sorunSayisi: sayac.kaynakYok + sayac.karsiEksik + sayac.tekTaraf + sayac.sahipsiz + sayac.numarasiz + sayac.tutarFarki + sayac.karsiKalmis + sayac.nakliyeSupheli,
    sayac: sayac,
  };
  const sonuc = { ok: true, ozet: ozet, bulgular: s, kontrolZamani: kdSimdi_() };
  if (opts.tumu) sonuc.duzeltNotlari = duzeltNotlari;
  return sonuc;
}

// ── HATALARI TEMİZLE (21 Eyl 2026) ──
// Kontrol'ün bulduğu MEVCUT hatalı satırlar defterden SİLİNİR (bundan sonra oluşan yeni hatalar satırda ❗ ile görünür).
// Silinen satırların kayıt numaraları bir daha kullanılmaz; kaynak kaydı hâlâ duran işlemler için "🔢 Mevcut kayıtları numarala"
// çalıştırılınca yeni numarayla ve güncel durumlarıyla yeniden deftere alınır.
// Hiçbir işlem/stok/cari/banka kaydına DOKUNULMAZ. Nakliye şüphelileri kapsam dışıdır (Ayarlar > Nakliye Dağıtımı Kontrolü).
// body.onizleme=true → hiçbir şey silmez, yalnız sayıları döndürür.
function kayitDefteriHatalariTemizle(body) {
  body = body || {};
  const kontrol = getKayitDefteriKontrol({ tumu: true });
  const notlar = kontrol.duzeltNotlari || [];
  const say = { kaynakYok: 0, karsiEksik: 0, tekTaraf: 0, tutarFarki: 0, sahipsiz: 0, karsiKalmis: 0 };
  const silinecek = {}; // satır indeksi → kayıt no
  const gorulen = {};
  notlar.forEach(n => {
    silinecek[n.i] = n.no;
    const a = n.i + "|" + n.tur;
    if (!gorulen[a]) { gorulen[a] = 1; say[n.tur]++; }
  });
  const indeksler = Object.keys(silinecek).map(Number).sort((a, b) => b - a); // sondan başa: satır kayması olmasın
  const toplam = indeksler.length;
  if (body.onizleme || !toplam) return { ok: true, onizleme: !!body.onizleme, temizlenecek: toplam, sayac: say, nakliyeSupheli: kontrol.ozet.sayac.nakliyeSupheli || 0 };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  let silinen = 0;
  kdKilitli_(() => {
    // Kontrol ile silme arasında defter değişmiş olabilir: her satırın hâlâ aynı kayıt no'su olduğunu doğrula.
    const guncel = kdTumSatirlar_(sheet);
    indeksler.forEach(i => {
      if (!guncel[i] || Number(guncel[i][KD_NO]) !== Number(silinecek[i])) return; // satır bu arada kaymışsa dokunma
      sheet.deleteRow(i + 2);
      silinen++;
    });
  });
  return { ok: true, temizlenen: silinen, sayac: say, nakliyeSupheli: kontrol.ozet.sayac.nakliyeSupheli || 0 };
}

// ── LİSTE ──
// body: { sayfa, adet, modul, islem, durum, arama, sorunlu, tarihBas, tarihSon }
function getKayitDefteri(body) {
  body = body || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const satirlar = kdTumSatirlar_(sheet);
  const adet = Math.min(Math.max(parseInt(body.adet, 10) || 200, 1), 1000);
  const sayfa = Math.max(parseInt(body.sayfa, 10) || 0, 0);
  const arama = String(body.arama || "").trim().toLocaleLowerCase("tr");
  const moduller = {}, islemler = {};
  satirlar.forEach(r => {
    moduller[String(r[KD_MODUL])] = true;
    // Modül seçiliyse İşlem listesi SADECE o modüle ait işlemleri göstersin (aksi halde tüm
    // modüllerin işlemleri karışık bir liste olur, seçim anlamsızlaşır).
    if (!body.modul || String(r[KD_MODUL]) === body.modul) islemler[String(r[KD_ISLEM])] = true;
  });
  const gun = (r) => kdMetin_(r[KD_TARIH]).slice(0, 10);
  const uygun = satirlar.filter(r => {
    if (body.modul && String(r[KD_MODUL]) !== body.modul) return false;
    if (body.islem && String(r[KD_ISLEM]) !== body.islem) return false;
    if (body.durum && String(r[KD_DURUM]) !== body.durum) return false;
    if (body.sorunlu && !(String(r[KD_KONTROL]).indexOf("⚠") >= 0 || r[KD_DURUM] === "Silindi")) return false;
    if (body.tarihBas && gun(r) < body.tarihBas) return false;
    if (body.tarihSon && gun(r) > body.tarihSon) return false;
    if (arama) {
      const metin = [r[KD_NO], r[KD_MODUL], r[KD_ISLEM], r[KD_BELGE], r[KD_CARI], r[KD_CARIKOD], r[KD_BHESAP], r[KD_AHESAP], r[KD_KONTROL], r[KD_KID]].join(" ").toLocaleLowerCase("tr");
      if (metin.indexOf(arama) < 0) return false;
    }
    return true;
  });
  uygun.sort((a, b) => Number(b[KD_NO]) - Number(a[KD_NO]));
  let toplamBorc = 0, toplamAlacak = 0;
  uygun.forEach(r => { if (r[KD_DURUM] === "Aktif") { toplamBorc += kdSayi_(r[KD_BTL]); toplamAlacak += kdSayi_(r[KD_ATL]); } });
  const nakliyeSupheli = nkSupheliAlisHaritasi_(); // ❗ Nakliye dağıtımı tutarsız onaylanmış alış faturaları
  const uyariNotu = (r) => (r[KD_DURUM] === "Aktif" && String(r[KD_KAYNAK]) === SHEETS.alislar && nakliyeSupheli[String(r[KD_KID])]) ? nakliyeSupheli[String(r[KD_KID])].not : "";
  const dilim = uygun.slice(sayfa * adet, sayfa * adet + adet).map(r => ({
    no: Number(r[KD_NO]), modulNo: r[KD_MODULNO] === "" ? null : Number(r[KD_MODULNO]), modul: kdMetin_(r[KD_MODUL]), islem: kdMetin_(r[KD_ISLEM]), tarih: kdMetin_(r[KD_TARIH]), belgeNo: kdMetin_(r[KD_BELGE]),
    cari: kdMetin_(r[KD_CARI]), cariKodu: kdMetin_(r[KD_CARIKOD]), belgeTutari: kdSayi_(r[KD_BTUTAR]), borcHesap: kdMetin_(r[KD_BHESAP]), borcTutar: r[KD_BTL] === "" ? null : kdSayi_(r[KD_BTL]),
    alacakHesap: kdMetin_(r[KD_AHESAP]), alacakTutar: r[KD_ATL] === "" ? null : kdSayi_(r[KD_ATL]), kontrol: kdMetin_(r[KD_KONTROL]), durum: kdMetin_(r[KD_DURUM]),
    grup: kdMetin_(r[KD_GRUP]), kaynak: kdMetin_(r[KD_KAYNAK]), kaynakId: kdMetin_(r[KD_KID]), uyari: uyariNotu(r), kayitZamani: kdMetin_(r[KD_KAYIT]), silinmeZamani: kdMetin_(r[KD_SILINME]),
  }));
  return { ok: true, toplam: uygun.length, satirlar: dilim, sayfa: sayfa, adet: adet, moduller: Object.keys(moduller).sort(), islemler: Object.keys(islemler).sort(),
    toplamBorc: toplamBorc, toplamAlacak: toplamAlacak,
    duzeltmeGerekli: PropertiesService.getScriptProperties().getProperty("KD_HARIC_SURUM") !== "1", // eski satırlar KDV hariç/cari kodu için henüz güncellenmedi
    ozet: { toplamKayit: satirlar.length, silinen: satirlar.filter(r => r[KD_DURUM] === "Silindi").length,
            uyarili: satirlar.filter(r => r[KD_DURUM] === "Aktif" && String(r[KD_KONTROL]).indexOf("⚠") >= 0).length,
            sonNo: satirlar.length ? Number(satirlar[satirlar.length - 1][KD_NO]) : 0 } };
}
