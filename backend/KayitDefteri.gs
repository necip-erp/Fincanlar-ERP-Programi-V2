// ════════════════════════════════════════════════════════════════════════════
// KAYIT DEFTERİ — veri kaybı kontrolü için tüm işlemlere sıralı KAYIT NO (2026000001...)
//
// Her işlem (Satış/Sipariş/Teklif, Alış, İadeler, Tahsilat, Ödeme, Cari Virman, Çek/Senet,
// manuel Cari hareketi) "Ana" satır olarak, kendi KARŞI KAYITLARI (Cari borç/alacak, Stok
// giriş/çıkış, Banka/POS/Kredi Kartı hareketi) ise "Karşı" satır olarak — HER BİRİ kendi
// numarasıyla — KayitDefteri sayfasına yazılır ve birbirine bağlanır (ANA_KAYIT_NO).
//
// • Numaralar tek sayaçtan (yıl + 6 hane) verilir, ASLA yeniden kullanılmaz. Uygulamadan
//   silinen kaydın satırı defterden kalkmaz, DURUM=Silindi olur (silinme zamanıyla).
// • Sipariş ve Teklif dışındaki her işlemde BEKLENEN karşı kayıtlar işlem anında hesaplanıp
//   saklanır; eksik olan ana satırda "⚠ Eksik: ..." görünür. Sheet'ten elle silinen kayıtlar
//   Kontrol ekranıyla yakalanır (defterde var, kaynakta yok).
// • Defter yazımı asıl işlemi ASLA engellemez (her yer try/catch).
//
// Canlı akış: handleRequest → kdToplayiciBaslat_() (karşı kayıt toplayıcısı açılır) → işlem →
// kdIsle_() (Ana satır + toplanan karşı kayıtlar deftere yazılır). Toplayıcıya kayıt notunu
// cariHareketEkle / stokHareketOtomatikYaz / banka-pos-kredi kartı hareketi fonksiyonları düşer.
// ════════════════════════════════════════════════════════════════════════════

const KD_SHEET_ADI = "KayitDefteri";
const KD_BASLIKLAR = ["KAYIT_NO","MODUL","KARSI_KAYIT","ISLEM","ROL","KAYNAK","KAYNAK_ID","ANA_KAYIT_NO","BELGE_NO","TARIH","CARI","TUTAR","YON","BEKLENEN","DURUM","KAYIT_ZAMANI","DEGISIKLIK_ZAMANI","SILINME_ZAMANI"];
const KD_NO = 0, KD_MODUL = 1, KD_KARSI = 2, KD_ISLEM = 3, KD_ROL = 4, KD_KAYNAK = 5, KD_KID = 6, KD_ANA = 7,
      KD_BELGE = 8, KD_TARIH = 9, KD_CARI = 10, KD_TUTAR = 11, KD_YON = 12, KD_BEKLENEN = 13, KD_DURUM = 14,
      KD_KAYIT = 15, KD_DEGISIM = 16, KD_SILINME = 17;
// Sütun biçimleri: numaralar sayı, tutar para, gerisi METİN (E-Tablo "00", tarih vb. metinleri bozmasın).
const KD_FORMATLAR = ["0","@","@","@","@","@","@","0","@","@","@","#,##0.00","@","@","@","@","@","@"];

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
//   tur "sil": ana kayıt + karşı kayıtları DURUM=Silindi yapılır
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
  return sheet;
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
  const anahtar = "KD_SAYAC_" + yil;
  let son = parseInt(props.getProperty(anahtar) || "0", 10) || 0;
  // Özellik kaybolsa/eskise bile numaralar geri düşmesin: sayfadaki son numarayla karşılaştır.
  const sonSatir = sheet.getLastRow();
  if (sonSatir >= 2) {
    const sonNo = parseInt(sheet.getRange(sonSatir, 1).getValue(), 10) || 0;
    if (Math.floor(sonNo / 1000000) === yil) son = Math.max(son, sonNo - yil * 1000000);
  }
  props.setProperty(anahtar, String(son + adet));
  return yil * 1000000 + son + 1;
}

// ── Ana kayıt tanımı ──
function kdBeklenenTurleri_(key, row, opts) {
  opts = opts || {};
  const b = [];
  const ekle = (k, tip) => b.push(kdBacakTuru_(k, tip));
  const cariId = String(row[2] || "").trim();
  if (key === "satis") {
    if (String(row[8] || "Fatura") === "Fatura") {
      if (opts.cariIsle !== false && cariId) ekle("cari", "Borç");
      if (opts.stokIsle !== false) ekle("stok", "Çıkış");
      if (String(row[5] || "") === "Havale" && String(row[10] || "")) ekle("banka", "Giriş");
    }
  } else if (key === "alis") {
    if (cariId) ekle("cari", "Alacak");
    ekle("stok", "Giriş");
  } else if (key === "alisiade") {
    if (cariId) ekle("cari", "Borç");
    ekle("stok", "Çıkış");
  } else if (key === "satisiade") {
    if (cariId) ekle("cari", "Alacak");
    ekle("stok", "Giriş");
  } else if (key === "tahsilat") {
    ekle("cari", "Alacak");
    const yontem = String(row[5] || "");
    if (yontem === "Kredi Kartı" && String(row[8] || "")) ekle("pos", "Borç");
    if (yontem === "Havale/EFT" && String(row[9] || "")) ekle("banka", "Giriş");
  } else if (key === "odeme") {
    const hedefTipi = String(row[10] || "") || (cariId ? "Cari" : "");
    if (hedefTipi === "Cari") ekle("cari", "Borç");
    const yontem = String(row[5] || "");
    if (yontem === "Kredi Kartı" && String(row[8] || "")) ekle("pos", "Alacak");
    if (yontem === "Havale/EFT" && String(row[9] || "")) ekle("banka", "Çıkış");
    if (hedefTipi === "Banka" && String(row[12] || "")) {
      if (String(row[11] || "") === "hesap") ekle("banka", "Giriş");
      else if (String(row[11] || "") === "kart") ekle("kart", "Ödeme");
    }
  } else if (key === "virman") {
    ekle("cari", "Borç"); ekle("cari", "Alacak");
  } else if (key === "cek") {
    ekle("cari", String(row[1] || "") === "Alınan" ? "Alacak" : "Borç");
  } else if (key === "posaktarim") {
    ekle("pos", "Alacak"); ekle("banka", "Giriş");
  }
  return b;
}

// Kaynak sayfa satırından deftere yazılacak ana kayıt tanımı.
function kdAnaTanimla_(key, row, opts) {
  const kk = KD_KAYNAKLAR[key];
  const id = String(row[0]);
  const t = { key: key, id: id, kaynak: SHEETS[kk.sheet], modul: kk.modul, belge: "", yon: "" };
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
    t.islem = "Cari Virman"; t.tarih = kdMetin_(row[1]);
    t.cari = kdMetin_(row[3]) + " → " + kdMetin_(row[5]); t.tutar = kdSayi_(row[6]); t.kayit = row[8];
  } else if (key === "cek") {
    t.islem = kdMetin_(row[1]) + " " + (kdMetin_(row[15]) === "Senet" ? "Senet" : "Çek");
    t.tarih = kdMetin_(row[8]); t.cari = kdMetin_(row[3]); t.tutar = kdSayi_(row[4]); t.kayit = row[12];
    t.belge = kdMetin_(row[6]);
  } else if (key === "posaktarim") {
    t.islem = "POS → Banka Aktarımı"; t.tarih = kdMetin_(row[3]); t.cari = ""; t.tutar = kdSayi_(row[4]); t.kayit = row[6];
  }
  t.beklenen = kdBeklenenTurleri_(key, row, opts);
  return t;
}

// ── Karşı kayıt indeksleri (kaynak sayfalardan) ──
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

// gerekli: {cari, stok, banka, pos, kart}. Dönen indeks: her tür için {isaretli: {"PREFIX:id":[bacak]}, hepsi:[{bacak, isaret}]}
function kdBacakIndeksi_(ss, gerekli) {
  const idx = { cari: null, stok: null, banka: null, pos: null, kart: null };
  const hareketOku = (k, sheetAdi, kolonlar) => {
    const isaretli = {}, hepsi = [];
    kdSayfaOku_(ss, sheetAdi).forEach(r => {
      const b = { k: k, tip: kdMetin_(r[kolonlar.tip]), kaynak: sheetAdi, kid: String(r[0]), tutar: kdSayi_(r[kolonlar.tutar]), tarih: kdMetin_(r[kolonlar.tarih]), ek: kolonlar.ek === undefined ? "" : kdMetin_(r[kolonlar.ek]), aciklama: kdMetin_(r[kolonlar.aciklama]), kayit: kdMetin_(r[6]) };
      const is = kdIsaretAyir_(b.aciklama);
      hepsi.push({ b: b, is: is });
      if (is) { const a = is.prefix + ":" + is.id; (isaretli[a] = isaretli[a] || []).push(b); }
    });
    return { isaretli: isaretli, hepsi: hepsi };
  };
  if (gerekli.cari) idx.cari = hareketOku("cari", SHEETS.cariHareketler, { tip: 3, tutar: 4, tarih: 2, ek: 1, aciklama: 5 });
  if (gerekli.banka) idx.banka = hareketOku("banka", SHEETS.bankaHesapHareketleri, { tip: 3, tutar: 4, tarih: 2, ek: 1, aciklama: 5 });
  if (gerekli.pos) idx.pos = hareketOku("pos", SHEETS.posHareketleri, { tip: 3, tutar: 4, tarih: 2, ek: 1, aciklama: 5 });
  if (gerekli.kart) idx.kart = hareketOku("kart", SHEETS.krediKartHareketleri, { tip: 3, tutar: 4, tarih: 2, ek: 1, aciklama: 5 });
  if (gerekli.stok) {
    const gruplu = {}, hepsi = [];
    kdSayfaOku_(ss, SHEETS.stokHareketleri).forEach(r => {
      const belgeNo = kdMetin_(r[11]);
      if (!belgeNo) return;
      const tip = kdMetin_(r[6]);
      const anahtar = belgeNo + "|" + tip;
      let g = gruplu[anahtar];
      if (!g) {
        g = { k: "stok", tip: tip, kaynak: SHEETS.stokHareketleri, kid: belgeNo, tutar: 0, tarih: kdMetin_(r[1]), ek: "", adet: 0, belgeTipi: kdMetin_(r[10]), kayit: kdMetin_(r[9]) };
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

// ── Satır kurucular ──
function kdKarsiMetni_(bacaklar, beklenen) {
  const parcalar = bacaklar.map(b => b.tur + " (" + b.no + ")");
  const eksik = beklenen.filter(t => !bacaklar.some(b => b.tur === t));
  if (!bacaklar.length && !beklenen.length) return "— (karşı kayıt gerekmez)";
  let metin = parcalar.join(" · ");
  if (eksik.length) metin += (metin ? " · " : "") + "⚠ Eksik: " + eksik.join(", ");
  return metin;
}

function kdAnaSatiri_(no, t, karsiMetni, kayitZamani) {
  const satir = new Array(KD_BASLIKLAR.length).fill("");
  satir[KD_NO] = no; satir[KD_MODUL] = t.modul; satir[KD_KARSI] = karsiMetni; satir[KD_ISLEM] = t.islem;
  satir[KD_ROL] = "Ana"; satir[KD_KAYNAK] = t.kaynak; satir[KD_KID] = t.id; satir[KD_ANA] = "";
  satir[KD_BELGE] = t.belge || ""; satir[KD_TARIH] = t.tarih || ""; satir[KD_CARI] = t.cari || ""; satir[KD_TUTAR] = t.tutar || 0;
  satir[KD_YON] = t.yon || ""; satir[KD_BEKLENEN] = (t.beklenen || []).join("|"); satir[KD_DURUM] = "Aktif";
  satir[KD_KAYIT] = kayitZamani; satir[KD_DEGISIM] = ""; satir[KD_SILINME] = "";
  return satir;
}

function kdBacakSatiri_(no, anaNo, t, b, kayitZamani) {
  const satir = new Array(KD_BASLIKLAR.length).fill("");
  const tur = kdBacakTuru_(b.k, b.tip);
  satir[KD_NO] = no; satir[KD_MODUL] = KD_BACAK_MODUL[b.k];
  satir[KD_KARSI] = "Ana: " + t.islem + " (" + anaNo + ")";
  satir[KD_ISLEM] = tur; satir[KD_ROL] = "Karşı"; satir[KD_KAYNAK] = b.kaynak; satir[KD_KID] = b.kid; satir[KD_ANA] = anaNo;
  satir[KD_BELGE] = t.belge || ""; satir[KD_TARIH] = b.tarih || t.tarih || ""; satir[KD_CARI] = t.cari || "";
  satir[KD_TUTAR] = b.tutar || 0; satir[KD_YON] = b.tip; satir[KD_BEKLENEN] = ""; satir[KD_DURUM] = "Aktif";
  satir[KD_KAYIT] = kayitZamani; satir[KD_DEGISIM] = ""; satir[KD_SILINME] = "";
  return satir;
}

// Bir ana kayıt + karşı kayıtları için ardışık satırlar (no0'dan başlar).
function kdGrupSatirlari_(no0, t, bacaklar, kayitZamani) {
  const bac = bacaklar.map((b, i) => ({ b: b, no: no0 + 1 + i, tur: kdBacakTuru_(b.k, b.tip) }));
  const ana = kdAnaSatiri_(no0, t, kdKarsiMetni_(bac, t.beklenen), kayitZamani);
  return [ana].concat(bac.map(x => kdBacakSatiri_(x.no, no0, t, x.b, kayitZamani)));
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

// Ledger'da (Ana, kaynak, id) satırının dizini; yoksa -1.
function kdAnaIndeksi_(satirlar, kaynakAdi, id) {
  for (let i = 0; i < satirlar.length; i++) {
    const r = satirlar[i];
    if (r[KD_ROL] === "Ana" && String(r[KD_KAYNAK]) === String(kaynakAdi) && String(r[KD_KID]) === String(id)) return i;
  }
  return -1;
}

// Ana kayıt + karşı kayıtlarını deftere işler (yoksa oluşturur, varsa karşı kayıtları eşleştirir).
function kdGrupSenkronla_(ss, key, id, bacaklar, opts) {
  const row = kdKaynakSatiriBul_(ss, key, id);
  if (!row) return { atlandi: "kaynak bulunamadı" };
  const t = kdAnaTanimla_(key, row, opts);
  const sheet = kdSheet_(ss);
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    const anaIdx = kdAnaIndeksi_(satirlar, t.kaynak, id);
    const simdi = kdSimdi_();
    if (anaIdx < 0) {
      const no0 = kdNoAl_(sheet, 1 + bacaklar.length);
      kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, kdGrupSatirlari_(no0, t, bacaklar, simdi));
      return;
    }
    // Var olan ana kayıt: karşı kayıtları eşleştir
    const anaNo = Number(satirlar[anaIdx][KD_NO]);
    const mevcut = [];
    satirlar.forEach((r, i) => { if (Number(r[KD_ANA]) === anaNo && r[KD_DURUM] === "Aktif") mevcut.push({ r: r, i: i, eslesti: false }); });
    const yeniler = bacaklar.slice();
    const eslesenler = [];
    mevcut.forEach(e => {
      const j = yeniler.findIndex(b => b.kaynak === String(e.r[KD_KAYNAK]) && String(b.kid) === String(e.r[KD_KID]));
      if (j >= 0) { e.eslesti = true; eslesenler.push({ e: e, b: yeniler[j] }); yeniler.splice(j, 1); }
    });
    mevcut.filter(e => !e.eslesti).forEach(e => {
      const j = yeniler.findIndex(b => kdBacakTuru_(b.k, b.tip) === String(e.r[KD_ISLEM]));
      if (j >= 0) { e.eslesti = true; eslesenler.push({ e: e, b: yeniler[j] }); yeniler.splice(j, 1); }
    });
    const silinecek = mevcut.filter(e => !e.eslesti);
    // yeni karşı kayıtlar için numara ayır ve ekle
    const bacakNolari = []; // {tur,no}
    eslesenler.forEach(x => bacakNolari.push({ tur: String(x.e.r[KD_ISLEM]), no: Number(x.e.r[KD_NO]) }));
    let yeniNo0 = 0;
    if (yeniler.length) yeniNo0 = kdNoAl_(sheet, yeniler.length);
    yeniler.forEach((b, i) => bacakNolari.push({ tur: kdBacakTuru_(b.k, b.tip), no: yeniNo0 + i }));
    // eşleşen karşı kayıtları yerinde güncelle
    eslesenler.forEach(x => {
      const s = kdBacakSatiri_(Number(x.e.r[KD_NO]), anaNo, t, x.b, x.e.r[KD_KAYIT]);
      s[KD_DEGISIM] = simdi;
      kdSatirlariYaz_(sheet, x.e.i + 2, [s]);
    });
    // silinen karşı kayıtlar
    silinecek.forEach(e => {
      const s = e.r.slice(); s[KD_DURUM] = "Silindi"; s[KD_SILINME] = simdi; s[KD_DEGISIM] = simdi;
      kdSatirlariYaz_(sheet, e.i + 2, [s]);
    });
    // ana satırı güncelle
    const ana = kdAnaSatiri_(anaNo, t, kdKarsiMetni_(bacakNolari, t.beklenen), satirlar[anaIdx][KD_KAYIT]);
    ana[KD_DEGISIM] = simdi;
    kdSatirlariYaz_(sheet, anaIdx + 2, [ana]);
    if (yeniler.length) {
      kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, yeniler.map((b, i) => kdBacakSatiri_(yeniNo0 + i, anaNo, t, b, simdi)));
    }
  });
  return { ok: true };
}

// Kaynak kaydı (ve varsa karşı kayıtlarını) DURUM=Silindi yapar. anaSilinirseKarsilarDa: ana silinince bağlı satırlar da.
function kdSilindiIsaretle_(ss, kaynakAdi, id) {
  const sheet = kdSheet_(ss);
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(sheet);
    const simdi = kdSimdi_();
    const hedefler = new Set();
    satirlar.forEach((r, i) => {
      if (String(r[KD_KAYNAK]) === String(kaynakAdi) && String(r[KD_KID]) === String(id) && r[KD_DURUM] === "Aktif") {
        hedefler.add(i);
        if (r[KD_ROL] === "Ana") {
          const anaNo = Number(r[KD_NO]);
          satirlar.forEach((r2, j) => { if (Number(r2[KD_ANA]) === anaNo && r2[KD_DURUM] === "Aktif") hedefler.add(j); });
        }
      }
    });
    hedefler.forEach(i => {
      const s = satirlar[i].slice(); s[KD_DURUM] = "Silindi"; s[KD_SILINME] = simdi; s[KD_DEGISIM] = simdi;
      kdSatirlariYaz_(sheet, i + 2, [s]);
    });
  });
}

// Manuel Cari hareketi (işaretsiz) — tek satırlık ana kayıt.
function kdManuelCariHareketi_(ss, id) {
  const sheet = ss.getSheetByName(SHEETS.cariHareketler);
  if (!sheet || sheet.getLastRow() < 2) return;
  const veri = sheet.getDataRange().getValues();
  let r = null;
  for (let i = 1; i < veri.length; i++) if (String(veri[i][0]) === String(id)) { r = veri[i]; break; }
  if (!r) return;
  if (kdIsaretAyir_(r[5])) return; // işaretliyse başka bir ana kaydın karşı kaydı
  const t = kdManuelCariTanimi_(r, cariAdiBul_(ss, String(r[1])));
  const defter = kdSheet_(ss);
  kdKilitli_(() => {
    const satirlar = kdTumSatirlar_(defter);
    if (kdAnaIndeksi_(satirlar, t.kaynak, t.id) >= 0) return;
    const no0 = kdNoAl_(defter, 1);
    kdSatirlariYaz_(defter, defter.getLastRow() + 1, kdGrupSatirlari_(no0, t, [], kdSimdi_()));
  });
}

function cariAdiBul_(ss, cariId) {
  const s = ss.getSheetByName(SHEETS.cariHesaplar);
  if (!s || s.getLastRow() < 2) return "";
  const v = s.getRange(2, 1, s.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === String(cariId)) return String(v[i][2] || "");
  return "";
}

function kdManuelCariTanimi_(r, cariAd) {
  return { key: "cariHareket", id: String(r[0]), kaynak: SHEETS.cariHareketler, modul: "Cari",
    islem: "Cari Hareket (Manuel) — " + kdMetin_(r[3]), tarih: kdMetin_(r[2]), cari: cariAd, tutar: kdSayi_(r[4]),
    belge: "", yon: kdMetin_(r[3]), beklenen: [], kayit: r[6] };
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
    if (meta.tur === "sil") kdSilindiIsaretle_(ss, SHEETS.cariHareketler, id);
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
    // toplayıcıdan gelen karşı kayıtlar: aynı (tür,kaynak,kid) tekrarlarını ele
    const gorulen = {};
    legs = legs.filter(b => { const a = b.k + "|" + b.tip + "|" + b.kaynak + "|" + b.kid; if (gorulen[a]) return false; gorulen[a] = 1; return true; });
  }
  kdGrupSenkronla_(ss, key, id, legs, opts);
}

// Toplu "tumAlislariSilVeSifirla" gibi işlemlerden sonra: kaynağı artık olmayan Aktif ana kayıtları Silindi yap.
function kdKaynagiOlmayanlariSilindiYap_(ss, key) {
  const kk = KD_KAYNAKLAR[key];
  const kaynakAdi = SHEETS[kk.sheet];
  const mevcutId = new Set(kdSayfaOku_(ss, kaynakAdi).map(r => String(r[0])));
  const sheet = kdSheet_(ss);
  const silinecekler = [];
  kdTumSatirlar_(sheet).forEach(r => { if (r[KD_ROL] === "Ana" && r[KD_DURUM] === "Aktif" && String(r[KD_KAYNAK]) === kaynakAdi && !mevcutId.has(String(r[KD_KID]))) silinecekler.push(String(r[KD_KID])); });
  silinecekler.forEach(id => kdSilindiIsaretle_(ss, kaynakAdi, id));
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

// Ana kaydı olmayan (sahipsiz) veya işaretsiz (manuel) hareketleri ana kayıt tanımı olarak üretir.
function kdYetimTanimlari_(dunya, ss) {
  const sonuc = [];
  const cariAdlari = {};
  const cariSayfa = kdSayfaOku_(ss, SHEETS.cariHesaplar);
  cariSayfa.forEach(r => { cariAdlari[String(r[0])] = String(r[2] || ""); });
  const hareketTurleri = [["cari", "Cari"], ["banka", "Banka"], ["pos", "POS"], ["kart", "Kredi Kartı"]];
  hareketTurleri.forEach(([k, modulAdi]) => {
    if (!dunya.idx[k]) return;
    dunya.idx[k].hepsi.forEach(x => {
      const b = x.b, is = x.is;
      if (!is) {
        if (k !== "cari") return; // işaretsiz banka/pos/kart hareketleri (manuel) ilk sürümde kapsam dışı
        sonuc.push({ tanim: kdManuelCariTanimi_([b.kid, b.ek, b.tarih, b.tip, b.tutar, "", b.kayit], cariAdlari[b.ek] || ""), zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
        return;
      }
      const key = KD_PREFIX_ANAHTAR[is.prefix];
      if (key && dunya.anaIdSeti[key] && dunya.anaIdSeti[key].has(is.id)) return; // sahibi var
      sonuc.push({ tanim: { key: "yetim", id: b.kid, kaynak: b.kaynak, modul: modulAdi, islem: "Sahipsiz " + kdBacakTuru_(k, b.tip) + " (ana kayıt yok: " + is.prefix + ":" + is.id + ")",
        tarih: b.tarih, cari: cariAdlari[b.ek] || "", tutar: b.tutar, belge: "", yon: b.tip, beklenen: [], yetimUyari: true, kayit: b.kayit }, zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
    });
  });
  // Sahipsiz stok hareketleri (otomatik belge tipli ama ana kaydı olmayan)
  if (dunya.idx.stok) {
    const tumIdler = new Set();
    Object.keys(dunya.anaIdSeti).forEach(k => dunya.anaIdSeti[k].forEach(i => tumIdler.add(i)));
    dunya.idx.stok.hepsi.forEach(x => {
      const b = x.b;
      if (KD_STOK_BELGE_TIPLERI.indexOf(b.belgeTipi) < 0 || tumIdler.has(b.kid)) return;
      sonuc.push({ tanim: { key: "yetim", id: b.kid, kaynak: b.kaynak, modul: "Stok", islem: "Sahipsiz " + kdBacakTuru_("stok", b.tip) + " (" + b.belgeTipi + ", ana kayıt yok)",
        tarih: b.tarih, cari: "", tutar: b.tutar, belge: "", yon: b.tip, beklenen: [], yetimUyari: true, kayit: b.kayit }, zaman: kdZamanSayisi_(b.kayit) || kdZamanSayisi_(b.tarih) });
    });
  }
  return sonuc;
}

// ── MEVCUT KAYITLARI NUMARALA (geriye dönük / eksik tamamlama) ──
function kayitDefteriBaslat(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const dunya = kdDunyaOku_(ss);
  const aday = []; // {t, bacaklar, zaman}
  Object.keys(KD_KAYNAKLAR).forEach(key => {
    dunya.anaSatirlar[key].forEach(r => {
      const t = kdAnaTanimla_(key, r);
      aday.push({ t: t, bacaklar: kdBacaklariBul_(dunya.idx, key, t.id), zaman: kdZamanSayisi_(t.kayit) || kdZamanSayisi_(t.tarih) });
    });
  });
  kdYetimTanimlari_(dunya, ss).forEach(y => aday.push({ t: y.tanim, bacaklar: [], zaman: y.zaman }));
  const idSirasi = (t) => parseInt((String(t.id).match(/\d{10,}/) || ["0"])[0], 10) || 0;
  aday.sort((a, b) => (a.zaman - b.zaman) || (idSirasi(a.t) - idSirasi(b.t)));

  let yeniAna = 0, yeniBacak = 0, eklenenBacak = 0;
  const PARCA = 200;
  for (let baslangic = 0; baslangic < aday.length; baslangic += PARCA) {
    const parca = aday.slice(baslangic, baslangic + PARCA);
    kdKilitli_(() => {
      const satirlar = kdTumSatirlar_(sheet);
      const varOlan = {};
      const herhangiRol = {};
      satirlar.forEach((r, i) => {
        herhangiRol[String(r[KD_KAYNAK]) + "|" + String(r[KD_KID])] = true;
        if (r[KD_ROL] === "Ana") varOlan[String(r[KD_KAYNAK]) + "|" + String(r[KD_KID])] = i;
      });
      const simdi = kdSimdi_();
      const eklenecekler = [];
      let toplamNo = 0;
      const yeniGruplar = [];
      parca.forEach(a => {
        const anahtar = a.t.kaynak + "|" + a.t.id;
        if (varOlan[anahtar] !== undefined) return;
        if (a.t.yetimUyari && herhangiRol[anahtar]) return; // sahipsiz görünen hareket zaten bir ana kaydın karşı satırı olarak defterde
        yeniGruplar.push(a); toplamNo += 1 + a.bacaklar.length;
      });
      if (yeniGruplar.length) {
        let no = kdNoAl_(sheet, toplamNo);
        yeniGruplar.forEach(a => {
          const kayit = kdZamanMetniDuzenle_(a.t.kayit) || simdi;
          kdGrupSatirlari_(no, a.t, a.bacaklar, kayit).forEach(s => eklenecekler.push(s));
          if (a.t.yetimUyari) eklenecekler[eklenecekler.length - 1][KD_KARSI] = "⚠ Ana kayıt bulunamadı — bu hareketin sahibi silinmiş olabilir";
          no += 1 + a.bacaklar.length; yeniAna++; yeniBacak += a.bacaklar.length;
        });
        kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, eklenecekler);
      }
      // Ana kaydı zaten defterde olan ama karşı kaydı defterde OLMAYANLAR: karşı kayıtları ekle
      parca.forEach(a => {
        const ai = varOlan[a.t.kaynak + "|" + a.t.id];
        if (ai === undefined || !a.bacaklar.length) return;
        const anaNo = Number(satirlar[ai][KD_NO]);
        const eksikBacak = a.bacaklar.filter(b => !satirlar.some(r => Number(r[KD_ANA]) === anaNo && String(r[KD_KAYNAK]) === b.kaynak && String(r[KD_KID]) === String(b.kid)));
        if (!eksikBacak.length) return;
        const no0 = kdNoAl_(sheet, eksikBacak.length);
        kdSatirlariYaz_(sheet, sheet.getLastRow() + 1, eksikBacak.map((b, i) => kdBacakSatiri_(no0 + i, anaNo, a.t, b, simdi)));
        eklenenBacak += eksikBacak.length;
        // ana satırın karşı kayıt metnini tazele
        const tumBac = kdTumSatirlar_(sheet).filter(r => Number(r[KD_ANA]) === anaNo && r[KD_DURUM] === "Aktif").map(r => ({ tur: String(r[KD_ISLEM]), no: Number(r[KD_NO]) }));
        const ana = satirlar[ai].slice(); ana[KD_KARSI] = kdKarsiMetni_(tumBac, a.t.beklenen); ana[KD_DEGISIM] = simdi;
        kdSatirlariYaz_(sheet, ai + 2, [ana]);
      });
    });
  }
  return { ok: true, yeniAnaKayit: yeniAna, yeniKarsiKayit: yeniBacak + eklenenBacak, toplamAday: aday.length };
}

// "dd/MM/yyyy HH:mm" biçimini korur; Date ise biçimler; değilse "".
function kdZamanMetniDuzenle_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const s = String(v || "");
  return /^\d{2}\/\d{2}\/\d{4}/.test(s) ? s : "";
}

// ── KONTROL ──
function getKayitDefteriKontrol() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const satirlar = kdTumSatirlar_(sheet);
  const dunya = kdDunyaOku_(ss);
  const LIMIT = 300;
  const s = { silinenler: [], kaynakYok: [], karsiEksik: [], sahipsiz: [], numarasiz: [], tutarFarki: [], karsiKalmis: [] };
  const sayac = { silinenler: 0, kaynakYok: 0, karsiEksik: 0, sahipsiz: 0, numarasiz: 0, tutarFarki: 0, karsiKalmis: 0 };
  const ekle = (ad, o) => { sayac[ad]++; if (s[ad].length < LIMIT) s[ad].push(o); };
  const ozetle = (r, not) => ({ no: Number(r[KD_NO]), modul: r[KD_MODUL], islem: r[KD_ISLEM], belgeNo: kdMetin_(r[KD_BELGE]), tarih: kdMetin_(r[KD_TARIH]), cari: kdMetin_(r[KD_CARI]), tutar: kdSayi_(r[KD_TUTAR]), not: not });

  // kaynak varlık kümeleri
  const cariHareketIdleri = new Set((dunya.idx.cari ? dunya.idx.cari.hepsi : []).map(x => x.b.kid));
  const bankaIdleri = new Set((dunya.idx.banka ? dunya.idx.banka.hepsi : []).map(x => x.b.kid));
  const posIdleri = new Set((dunya.idx.pos ? dunya.idx.pos.hepsi : []).map(x => x.b.kid));
  const kartIdleri = new Set((dunya.idx.kart ? dunya.idx.kart.hepsi : []).map(x => x.b.kid));
  const stokBelgeler = new Set((dunya.idx.stok ? dunya.idx.stok.hepsi : []).map(x => x.b.kid));
  const kaynakVarMi = (r) => {
    const k = String(r[KD_KAYNAK]), id = String(r[KD_KID]);
    if (k === SHEETS.cariHareketler) return cariHareketIdleri.has(id);
    if (k === SHEETS.bankaHesapHareketleri) return bankaIdleri.has(id);
    if (k === SHEETS.posHareketleri) return posIdleri.has(id);
    if (k === SHEETS.krediKartHareketleri) return kartIdleri.has(id);
    if (k === SHEETS.stokHareketleri) return stokBelgeler.has(id);
    const key = Object.keys(KD_KAYNAKLAR).find(x => SHEETS[KD_KAYNAKLAR[x].sheet] === k);
    return key ? dunya.anaIdSeti[key].has(id) : true;
  };

  const anaNoHaritasi = {};
  satirlar.forEach(r => { if (r[KD_ROL] === "Ana") anaNoHaritasi[Number(r[KD_NO])] = r; });
  const bacaklarByAna = {};
  satirlar.forEach(r => { if (r[KD_ROL] === "Karşı") (bacaklarByAna[Number(r[KD_ANA])] = bacaklarByAna[Number(r[KD_ANA])] || []).push(r); });

  satirlar.forEach(r => {
    const durum = r[KD_DURUM];
    if (r[KD_ROL] === "Ana" && durum === "Silindi") ekle("silinenler", ozetle(r, "Silindi: " + kdMetin_(r[KD_SILINME])));
    if (durum === "Aktif" && !kaynakVarMi(r)) ekle("kaynakYok", ozetle(r, r[KD_ROL] === "Ana" ? "Defterde var ama kaynak sayfada kayıt YOK (uygulama dışından silinmiş olabilir)" : "Karşı kaydın kaynağı bulunamadı"));
    if (r[KD_ROL] === "Ana" && durum === "Aktif") {
      const beklenen = String(r[KD_BEKLENEN] || "").split("|").filter(x => x);
      const aktifBac = (bacaklarByAna[Number(r[KD_NO])] || []).filter(b => b[KD_DURUM] === "Aktif" && kaynakVarMi(b));
      const eksik = beklenen.filter(t => !aktifBac.some(b => String(b[KD_ISLEM]) === t));
      if (eksik.length) ekle("karsiEksik", ozetle(r, "Eksik karşı kayıt: " + eksik.join(", ")));
      // tutar kontrolü: cari karşı kaydı ile ana tutar
      const cariBac = aktifBac.filter(b => String(b[KD_MODUL]) === "Cari");
      if (String(r[KD_MODUL]) !== "Cari Virman" && cariBac.length === 1 && Math.abs(kdSayi_(cariBac[0][KD_TUTAR]) - kdSayi_(r[KD_TUTAR])) > 0.05) {
        ekle("tutarFarki", ozetle(r, "Ana tutar " + kdSayi_(r[KD_TUTAR]).toFixed(2) + " ≠ Cari karşı kayıt " + kdSayi_(cariBac[0][KD_TUTAR]).toFixed(2)));
      }
    }
    if (r[KD_ROL] === "Ana" && String(r[KD_ISLEM]).indexOf("Sahipsiz") === 0 && durum === "Aktif") ekle("sahipsiz", ozetle(r, "Ana kaydı olmayan hareket"));
    // Silinmiş ana kaydın karşı kaydı hâlâ duruyor mu?
    if (r[KD_ROL] === "Karşı" && durum === "Silindi" && kaynakVarMi(r)) {
      const ana = anaNoHaritasi[Number(r[KD_ANA])];
      ekle("karsiKalmis", ozetle(r, "Deftere göre silinmiş ama kaynak sayfada HÂLÂ duruyor" + (ana ? " (ana: " + ana[KD_ISLEM] + " #" + ana[KD_NO] + ")" : "")));
    }
  });

  // Numarasız: kaynakta olup defterde hiç olmayanlar
  const defterdekiler = new Set(satirlar.map(r => String(r[KD_KAYNAK]) + "|" + String(r[KD_KID])));
  const defterAnalari = new Set(satirlar.filter(r => r[KD_ROL] === "Ana").map(r => String(r[KD_KAYNAK]) + "|" + String(r[KD_KID])));
  const yetimler = kdYetimTanimlari_(dunya, ss);
  Object.keys(KD_KAYNAKLAR).forEach(key => {
    dunya.anaSatirlar[key].forEach(row => {
      const t = kdAnaTanimla_(key, row);
      if (!defterAnalari.has(t.kaynak + "|" + t.id)) ekle("numarasiz", { no: "", modul: t.modul, islem: t.islem, belgeNo: t.belge, tarih: t.tarih, cari: t.cari, tutar: t.tutar, not: "Kaynakta var, defterde numarası yok" });
    });
  });
  yetimler.forEach(y => {
    if (!defterdekiler.has(y.tanim.kaynak + "|" + y.tanim.id)) ekle("numarasiz", { no: "", modul: y.tanim.modul, islem: y.tanim.islem, belgeNo: "", tarih: y.tanim.tarih, cari: y.tanim.cari, tutar: y.tanim.tutar, not: "Kaynakta var, defterde numarası yok" });
  });

  const ozet = {
    toplamKayit: satirlar.length,
    anaKayit: satirlar.filter(r => r[KD_ROL] === "Ana").length,
    aktif: satirlar.filter(r => r[KD_DURUM] === "Aktif").length,
    silinen: satirlar.filter(r => r[KD_DURUM] === "Silindi").length,
    sorunSayisi: sayac.kaynakYok + sayac.karsiEksik + sayac.sahipsiz + sayac.numarasiz + sayac.tutarFarki + sayac.karsiKalmis,
    sayac: sayac,
  };
  return { ok: true, ozet: ozet, bulgular: s, kontrolZamani: kdSimdi_() };
}

// ── LİSTE ──
// body: { sayfa, adet, modul, durum, rol, arama, sorunlu }
function getKayitDefteri(body) {
  body = body || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = kdSheet_(ss);
  const satirlar = kdTumSatirlar_(sheet);
  const adet = Math.min(Math.max(parseInt(body.adet, 10) || 200, 1), 1000);
  const sayfa = Math.max(parseInt(body.sayfa, 10) || 0, 0);
  const arama = String(body.arama || "").trim().toLocaleLowerCase("tr");
  const moduller = {};
  satirlar.forEach(r => { moduller[String(r[KD_MODUL])] = true; });
  const uygun = satirlar.filter(r => {
    if (body.modul && String(r[KD_MODUL]) !== body.modul) return false;
    if (body.durum && String(r[KD_DURUM]) !== body.durum) return false;
    if (body.rol && String(r[KD_ROL]) !== body.rol) return false;
    if (body.sorunlu && !(String(r[KD_KARSI]).indexOf("⚠") >= 0 || r[KD_DURUM] === "Silindi")) return false;
    if (arama) {
      const metin = [r[KD_NO], r[KD_MODUL], r[KD_KARSI], r[KD_ISLEM], r[KD_BELGE], r[KD_CARI], r[KD_KID]].join(" ").toLocaleLowerCase("tr");
      if (metin.indexOf(arama) < 0) return false;
    }
    return true;
  });
  uygun.sort((a, b) => Number(b[KD_NO]) - Number(a[KD_NO]));
  const dilim = uygun.slice(sayfa * adet, sayfa * adet + adet).map(r => ({
    no: Number(r[KD_NO]), modul: kdMetin_(r[KD_MODUL]), karsi: kdMetin_(r[KD_KARSI]), islem: kdMetin_(r[KD_ISLEM]), rol: kdMetin_(r[KD_ROL]),
    kaynakId: kdMetin_(r[KD_KID]), anaNo: r[KD_ANA] === "" ? "" : Number(r[KD_ANA]), belgeNo: kdMetin_(r[KD_BELGE]), tarih: kdMetin_(r[KD_TARIH]),
    cari: kdMetin_(r[KD_CARI]), tutar: kdSayi_(r[KD_TUTAR]), yon: kdMetin_(r[KD_YON]), durum: kdMetin_(r[KD_DURUM]),
    kayitZamani: kdMetin_(r[KD_KAYIT]), silinmeZamani: kdMetin_(r[KD_SILINME]),
  }));
  return { ok: true, toplam: uygun.length, satirlar: dilim, sayfa: sayfa, adet: adet, moduller: Object.keys(moduller).sort(),
    ozet: { toplamKayit: satirlar.length, anaKayit: satirlar.filter(r => r[KD_ROL] === "Ana").length, silinen: satirlar.filter(r => r[KD_DURUM] === "Silindi").length,
            uyarili: satirlar.filter(r => String(r[KD_KARSI]).indexOf("⚠") >= 0).length,
            sonNo: satirlar.length ? Number(satirlar[satirlar.length - 1][KD_NO]) : 0 } };
}
