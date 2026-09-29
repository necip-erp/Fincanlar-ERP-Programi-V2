// ════════════════════════════════════════════════
// ÇALIŞMA YILI — yeni yıl e-tablosu oluşturma ve BFM (e-fatura) yıl filtresi.
// Altyapı (yıl → e-tablo eşlemesi, aktifSheetId_) Code.gs'in başındadır.
//
// KURAL: Yeni yıl, temel yılın e-tablosunun birebir KOPYASIDIR; böylece sütun yapısı ve
// kullanılan tüm tanımlar/kurallar aynen gelir. Sadece hareket/kart verileri boşaltılır:
//   • AYNEN KALAN (ayar/tanım): Kullanıcılar (parolalarıyla), marka, ürün grubu, alt grup, ebat,
//     renk, ambalaj, birim, gider grupları, açıklama şablonları, sipariş durumları, plasiyer,
//     proje kodu, fatura tipi, virman tipi, banka/hesap/POS/kredi kartı TANIMLARI.
//   • SIFIRLANAN: cariler, stok kartları, stok hareketleri, alış/satış/iade/tahsilat/ödeme,
//     çek-senet, banka/POS/kart hareketleri, kayıt defteri, silinenler, eşleştirme hafızaları,
//     oturumlar ve diğer tüm sayfalar (başlık satırı kalır). Belge serilerinin sayacı 1'e döner.
//   • _YEDEK_ ekli sayfalar yeni yıla taşınmaz.
// ════════════════════════════════════════════════

function yilAyarSayfalari_() {
  return [
    SHEETS.markalar, SHEETS.urunGruplari, SHEETS.altUrunGruplari, SHEETS.ebatlar, SHEETS.renkler,
    SHEETS.ambalajTanimlari, SHEETS.birimTanimlari, SHEETS.giderUstGruplari, SHEETS.giderAltGruplari,
    SHEETS.aciklamaSablonlari, SHEETS.siparisDurumlari, SHEETS.plasiyerler, SHEETS.projeKodlari,
    SHEETS.faturaTipleri, SHEETS.virmanTipleri, SHEETS.kullanicilar,
    SHEETS.bankalar, SHEETS.bankaHesaplari, SHEETS.posCihazlari, SHEETS.krediKartlari,
    SHEETS.seriTanimlari,
  ];
}

// body: { yeniYil: "2027", kaynakYil?: "2026" } — sadece Admin. Boş, kurallar aynı yeni yıl e-tablosu üretir.
function yeniCalismaYiliOlustur(body) {
  const yil = String((body && body.yeniYil) || "").trim(); // NOT: body.yil = içinde çalışılan yıl (handleRequest); oluşturulacak yıl ayrı alandan gelir
  if (!/^20\d\d(-\d{1,2})?$/.test(yil)) return { ok: false, hata: "Çalışma yılı 2027 ya da 2026-2 biçiminde olmalı" };
  const kayit = yilKayitlari_();
  if (kayit[yil]) return { ok: false, hata: yil + " çalışma yılı zaten var" };
  const kaynakYil = String((body && body.kaynakYil) || TEMEL_YIL_);
  if (!kayit[kaynakYil]) return { ok: false, hata: "Kaynak yıl bulunamadı: " + kaynakYil };

  const lock = kilitGetir_();
  lock.waitLock(30000);
  try {
    const kopya = DriveApp.getFileById(kayit[kaynakYil]).makeCopy("Fincanlar ERP - " + yil + " Çalışma Yılı");
    const ss = SpreadsheetApp.openById(kopya.getId());
    const ayar = {};
    yilAyarSayfalari_().forEach(function (ad) { ayar[ad] = true; });

    let silinenSayfa = 0, bosaltilan = 0;
    ss.getSheets().forEach(function (sh) {
      const ad = sh.getName();
      if (ad.indexOf("_YEDEK_") >= 0) { ss.deleteSheet(sh); silinenSayfa++; return; }
      if (ayar[ad]) return;
      const son = sh.getMaxRows();
      if (son > 1) { sh.getRange(2, 1, son - 1, Math.max(sh.getMaxColumns(), 1)).clearContent(); bosaltilan++; }
    });

    // Belge serileri yeni yılda baştan başlar (SONRAKI_NO = 1).
    const seriSh = ss.getSheetByName(SHEETS.seriTanimlari);
    if (seriSh && seriSh.getLastRow() >= 2) {
      const baslik = seriSh.getRange(1, 1, 1, seriSh.getLastColumn()).getValues()[0];
      const kol = baslik.indexOf("SONRAKI_NO");
      if (kol >= 0) {
        const n = seriSh.getLastRow() - 1;
        seriSh.getRange(2, kol + 1, n, 1).setValues(Array.from({ length: n }, function () { return [1]; }));
      }
    }
    SpreadsheetApp.flush();

    const props = PropertiesService.getScriptProperties();
    let mevcut = {};
    try { mevcut = JSON.parse(props.getProperty("YIL_SHEETLERI") || "{}") || {}; } catch (e) { mevcut = {}; }
    mevcut[yil] = kopya.getId();
    props.setProperty("YIL_SHEETLERI", JSON.stringify(mevcut));
    _YIL_KAYIT_ = null;

    return { ok: true, yil: yil, sheetId: kopya.getId(), url: kopya.getUrl(), bosaltilanSayfa: bosaltilan, silinenYedekSayfa: silinenSayfa };
  } finally {
    lock.releaseLock();
  }
}

// FATURAFIYAT (dış e-fatura tablosu) tüm yılların faturalarını tutar. BFM "bekleyen alış faturaları"
// listesi çalışma yılına göre süzülür: temel yıl (2026) eski davranışı korur (2026 ve öncesi görünür);
// sonraki yıllar yalnız kendi yılının faturalarını görür. Tarihten yıl okunamıyorsa fatura gösterilir.
function bfmFaturaYilUygunMu_(tarih) {
  let fy = null;
  if (tarih instanceof Date) fy = tarih.getFullYear();
  else { const m = String(tarih || "").match(/(20\d\d)/); if (m) fy = parseInt(m[1], 10); }
  if (fy === null) return true;
  const aktif = parseInt(aktifYil_(), 10);
  if (String(aktif) === TEMEL_YIL_) return fy <= aktif;
  return fy === aktif;
}
