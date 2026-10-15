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

// ★ 14 Eki 2026 — ŞİRKET DÜZENİ (tek seferlik, sadece Admin):
//   • Mevcut tüm şirketler (2026, 2026-2) AYNEN kalır, yalnızca görünen adlarının başına "ESKİ " eklenir
//     (iç anahtarlar ve veriler değişmez).
//   • Yeni, BOŞ bir şirket oluşturulur ve adı "2026" görünür (iç anahtar 2026-3; ayarlar/tanımlar/kullanıcılar
//     kaynak şirketten aynen gelir, cari/stok/hareket sıfırdır) ve giriş ekranında AÇILIŞTA bu şirket seçili gelir.
//   • Bundan sonraki tüm kayıtlar yeni şirkette tutulur; eski şirketlere giriş ekranından yıl seçilerek girilir.
// body: { kaynakYil?: "2026-2" } — kaynak verilmezse 2026-2 (yoksa temel yıl) kullanılır.
function sirketDuzeniKur(body) {
  const props = PropertiesService.getScriptProperties();
  const onceki = props.getProperty("SIRKET_DUZENI_KURULDU");
  if (onceki) return { ok: false, hata: "Şirket düzeni zaten kurulmuş (yeni şirket iç adı: " + onceki + ")" };

  const kayit = yilKayitlari_();
  const eskiler = Object.keys(kayit).sort();
  let n = 3, yeniAnahtar = "2026-" + n;
  while (kayit[yeniAnahtar]) { n++; yeniAnahtar = "2026-" + n; }

  let kaynak = String((body && body.kaynakYil) || "");
  if (!kaynak || !kayit[kaynak]) kaynak = kayit["2026-2"] ? "2026-2" : TEMEL_YIL_;

  const r = yeniCalismaYiliOlustur({ yeniYil: yeniAnahtar, kaynakYil: kaynak });
  if (!r || !r.ok) return r || { ok: false, hata: "Yeni şirket oluşturulamadı" };

  const etiket = yilEtiketleri_();
  eskiler.forEach(function (y) {
    const mevcut = String(etiket[y] || y);
    etiket[y] = mevcut.indexOf("ESKİ") === 0 ? mevcut : "ESKİ " + mevcut;
  });
  etiket[yeniAnahtar] = "2026";
  props.setProperty("YIL_ETIKETLERI", JSON.stringify(etiket));
  props.setProperty("VARSAYILAN_YIL", yeniAnahtar);
  props.setProperty("SIRKET_DUZENI_KURULDU", yeniAnahtar);
  _YIL_KAYIT_ = null;

  return { ok: true, yeniAnahtar: yeniAnahtar, kaynakYil: kaynak, etiketler: etiket, sheetId: r.sheetId, url: r.url };
}

// ★ 16 Eki 2026 — ŞİRKETLER ARASI STOK KARTI AKTARIMI (yalnız yerel sunucu, yalnız Admin).
// Çalışılan (açık) şirketin boş stok listesine, body.kaynakYil şirketindeki STOK KARTLARI aynen kopyalanır
// (ID, kod, ad, birim, fiyat, grup, görsel, hızlı satış, pasif… tüm sütunlar). Stok MİKTARI/HAREKETİ aktarılmaz
// (miktar hareketlerden hesaplanır). Hedefte aynı stok kodu varsa o kart atlanır; aynı ID başka kodla varsa yeni ID verilir.
// Tekrar çalıştırmak güvenlidir. body: { kaynakYil: "2026", onizleme?: true }
function yilStokKartlariAktar(body) {
  if (!yerelMi_()) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda yapılır" };
  const kayit = yilKayitlari_();
  const hedefYil = aktifYil_();
  const kaynakYil = String((body && body.kaynakYil) || "").trim();
  if (!kaynakYil || !kayit[kaynakYil]) return { ok: false, hata: "Kaynak şirket bulunamadı: " + kaynakYil };
  if (kaynakYil === hedefYil) return { ok: false, hata: "Kaynak ve hedef aynı şirket; önce giriş ekranında YENİ şirkete girin, sonra eski şirketi kaynak seçin" };
  const kSS = SpreadsheetApp.openById(kayit[kaynakYil]);
  const kSheet = kSS.getSheetByName(SHEETS.stokTanimlari);
  if (!kSheet) return { ok: false, hata: "Kaynak şirkette stok kartı sayfası yok" };
  const kData = kSheet.getDataRange().getValues();

  const ss = acikSS_();
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const gen = Math.max(sheet.getLastColumn(), STOK_TANIM_BASLIKLAR.length);
  const hData = sheet.getDataRange().getValues();
  const kodVar = {}, idVar = {};
  for (let i = 1; i < hData.length; i++) {
    const k = String(hData[i][1] === undefined || hData[i][1] === null ? "" : hData[i][1]).trim().toUpperCase();
    if (k) kodVar[k] = true;
    if (hData[i][0]) idVar[String(hData[i][0])] = true;
  }

  const yeni = [];
  let kaynakAdet = 0, zatenVar = 0, kodsuz = 0, idDegisti = 0;
  const t0 = Date.now();
  for (let i = 1; i < kData.length; i++) {
    const r = kData[i];
    if (!r[0] && !r[1]) continue;
    const kod = String(r[1] === undefined || r[1] === null ? "" : r[1]).trim();
    if (!kod) { kodsuz++; continue; }
    kaynakAdet++;
    const kodB = kod.toUpperCase();
    if (kodVar[kodB]) { zatenVar++; continue; }
    kodVar[kodB] = true;
    const satir = [];
    for (let c = 0; c < gen; c++) satir.push(c < r.length && r[c] !== undefined && r[c] !== null ? r[c] : "");
    let id = String(satir[0] || "");
    if (!id || idVar[id]) { id = "sk_" + t0 + "_" + yeni.length; satir[0] = id; idDegisti++; }
    idVar[id] = true;
    yeni.push(satir);
  }
  if (body && body.onizleme) {
    return { ok: true, onizleme: true, kaynakYil: kaynakYil, hedefYil: hedefYil, kaynakAdet: kaynakAdet, eklenecek: yeni.length, zatenVar: zatenVar, kodsuz: kodsuz };
  }
  if (yeni.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, yeni.length, gen).setValues(yeni);
    SpreadsheetApp.flush();
    cacheTemizle(["stokTanimListesi"]);
    veriSurumuArtir_();
  }
  return { ok: true, kaynakYil: kaynakYil, hedefYil: hedefYil, kaynakAdet: kaynakAdet, eklenen: yeni.length, zatenVar: zatenVar, kodsuz: kodsuz, idDegisti: idDegisti };
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
