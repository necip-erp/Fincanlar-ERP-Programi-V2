// ════════════════════════════════════════════════════════════════════════════
// YEDEKLEME PAKETİ (8 Eki 2026)
// Her yedekleme turunda Drive'daki "Fincanlar ERP - Otomatik Yedekler" klasörüne şunlar girer:
//   1) VERİ      : her çalışma yılının e-tablosunun tam kopyası           ("Fincanlar ERP Yedek - <yıl> - <zaman>")
//   2) PROGRAM   : GitHub'daki güncel program kodunun ZIP'i (ön yüz + sunucu) ("Fincanlar ERP Program Kodu - <zaman>.zip")
//   3) AYARLAR   : Apps Script özellikleri (yıl→e-tablo eşlemesi, EDM ayarları; ŞİFRE HARİÇ) ("Fincanlar ERP Ayarlar - <zaman>.json")
//   4) REHBER    : sıfırdan ayağa kaldırma adımları                      ("GERI_YUKLEME_REHBERI.txt", her turda güncellenir)
// Ayarlar > 💾 Yedekleme ekranından durum görülür, "Şimdi Yedek Al" ile elle yedek alınır, dosyalar
// flash belleğe kaydedilmek üzere indirilir. Zamanlanmış tur: otomatikYedekAl (Code.gs) → yedekCalistir_.
// ════════════════════════════════════════════════════════════════════════════

var YEDEK_VERI_ONEK_ = "Fincanlar ERP Yedek - ";
var YEDEK_KOD_ONEK_ = "Fincanlar ERP Program Kodu - ";
var YEDEK_AYAR_ONEK_ = "Fincanlar ERP Ayarlar - ";
var YEDEK_REHBER_ADI_ = "GERI_YUKLEME_REHBERI.txt";
var YEDEK_KOD_ZIP_URL_ = "https://github.com/necip-erp/Fincanlar-ERP-Programi-V2/archive/refs/heads/main.zip";
var YEDEK_KOD_SIKLIK_SAAT_ = 20; // program kodu ZIP'i en fazla bu kadar saatte bir yenilenir (veri her turda alınır)

function yedekKlasoruBul_() {
  var k = DriveApp.getFoldersByName(YEDEK_KLASOR_ADI);
  return k.hasNext() ? k.next() : null;
}

function yedekTurunuBul_(ad) {
  if (ad.indexOf(YEDEK_VERI_ONEK_) === 0) return "veri";
  if (ad.indexOf(YEDEK_KOD_ONEK_) === 0) return "kod";
  if (ad.indexOf(YEDEK_AYAR_ONEK_) === 0) return "ayar";
  if (ad === YEDEK_REHBER_ADI_) return "rehber";
  return "";
}

// Zamanlanmış turun ve "Şimdi Yedek Al"ın ortak işi. kodZorla=true → program ZIP'i de her koşulda yenilenir.
function yedekCalistir_(kodZorla) {
  var klasor = yedekKlasoruGetirVeyaOlustur_();
  var damga = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd_HH-mm");
  var ozet = { damga: damga, veri: [], kod: null, ayar: null, rehber: null };
  var kayit = yilKayitlari_();
  Object.keys(kayit).sort().forEach(function (yil) {
    try {
      DriveApp.getFileById(kayit[yil]).makeCopy(YEDEK_VERI_ONEK_ + yil + " - " + damga, klasor);
      ozet.veri.push(yil);
    } catch (e) { ozet.veri.push(yil + " (HATA: " + e.message + ")"); }
  });
  try { ozet.ayar = yedekAyarDosyasiYaz_(klasor, damga); } catch (e) { ozet.ayar = "HATA: " + e.message; }
  try { ozet.kod = yedekKodZipiAl_(klasor, damga, !!kodZorla); } catch (e) { ozet.kod = "HATA: " + e.message; }
  try { yedekRehberiYaz_(klasor); ozet.rehber = "tamam"; } catch (e) { ozet.rehber = "HATA: " + e.message; }
  try { PropertiesService.getScriptProperties().setProperty("SON_YEDEK_OZET", JSON.stringify({ z: Date.now(), o: ozet })); } catch (e) {}
  return ozet;
}

// Apps Script özellikleri → JSON. EDM şifresi KASITLI olarak yazılmaz (Drive'da düz metin durmasın).
function yedekAyarDosyasiYaz_(klasor, damga) {
  var tum = PropertiesService.getScriptProperties().getProperties();
  var cikti = {};
  Object.keys(tum).forEach(function (k) {
    if (k === "SON_YEDEK_OZET") return;
    cikti[k] = /PASSWORD|PAROLA|SIFRE|SECRET|TOKEN/i.test(k) ? "***GERI YUKLERKEN ELLE GIRIN***" : tum[k];
  });
  klasor.createFile(YEDEK_AYAR_ONEK_ + damga + ".json", JSON.stringify(cikti, null, 2), MimeType.PLAIN_TEXT);
  return Object.keys(cikti).length + " ayar";
}

// GitHub'daki güncel kodun ZIP'ini klasöre koyar (depo herkese açık olduğu için anahtar gerekmez).
function yedekKodZipiAl_(klasor, damga, zorla) {
  if (!zorla) {
    var son = yedekSonDosyaZamani_(klasor, YEDEK_KOD_ONEK_);
    if (son && (Date.now() - son) < YEDEK_KOD_SIKLIK_SAAT_ * 3600 * 1000) return "güncel (yenilenmedi)";
  }
  var yanit = UrlFetchApp.fetch(YEDEK_KOD_ZIP_URL_, { followRedirects: true, muteHttpExceptions: true });
  if (yanit.getResponseCode() !== 200) throw new Error("GitHub yanıtı " + yanit.getResponseCode());
  var blob = yanit.getBlob().setName(YEDEK_KOD_ONEK_ + damga + ".zip");
  if (blob.getBytes().length < 50000) throw new Error("ZIP beklenenden küçük geldi");
  klasor.createFile(blob);
  return "alındı (" + Math.round(blob.getBytes().length / 1024) + " KB)";
}

function yedekSonDosyaZamani_(klasor, onek) {
  var en = 0, it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(onek) === 0) { var t = f.getDateCreated().getTime(); if (t > en) en = t; }
  }
  return en || null;
}

function yedekRehberiYaz_(klasor) {
  var metin = yedekRehberMetni_();
  var it = klasor.getFilesByName(YEDEK_REHBER_ADI_);
  if (it.hasNext()) it.next().setContent(metin);
  else klasor.createFile(YEDEK_REHBER_ADI_, metin, MimeType.PLAIN_TEXT);
}

function yedekRehberMetni_() {
  return [
    "FINCANLAR ERP — GERI YUKLEME REHBERI",
    "=====================================",
    "Bu klasordeki dosyalar sistemi SIFIRDAN ayaga kaldirmaya yeter:",
    "  * 'Fincanlar ERP Yedek - <yil> - <zaman>'  : o yilin tum verisi (Google E-Tablo kopyasi)",
    "  * 'Fincanlar ERP Program Kodu - <zaman>.zip': programin tum kodu (on yuz + sunucu)",
    "  * 'Fincanlar ERP Ayarlar - <zaman>.json'    : Apps Script ozellikleri (EDM sifresi HARIC)",
    "  * Flash bellege kopyalamak icin: program icinde Ayarlar > Yedekleme > 'Hepsini indir'.",
    "    (E-Tablolar Excel .xlsx olarak iner; Drive'a yukleyip Google E-Tablo olarak acilabilir.)",
    "",
    "ADIM 1 — VERIYI GERI GETIR",
    "  a) Drive'da en yeni 'Fincanlar ERP Yedek - <yil> - ...' dosyasini bulun. Sorun yoksa dosyayi",
    "     'Kopyasini olustur' ile asil dosya yapin. Flash'tan geliyorsa: .xlsx dosyasini Drive'a yukleyin,",
    "     sag tik > Birlikte ac > Google E-Tablolar, sonra Dosya > Google E-Tablolar olarak kaydet.",
    "  b) Yeni e-tablonun adres cubugundaki kimligi (…/d/ ile /edit arasi) not edin. Her yil icin ayri.",
    "",
    "ADIM 2 — SUNUCUYU (APPS SCRIPT) KUR",
    "  a) ZIP'i acin. 'backend' klasorunde .gs dosyalari ve appsscript.json vardir.",
    "  b) script.google.com > Yeni proje. Her .gs dosyasini ayni adla ekleyip icerigini yapistirin.",
    "     Proje Ayarlari > 'appsscript.json dosyasini goster' ile appsscript.json icerigini de yapistirin.",
    "     (Alternatif, bilgisayarda Node varsa: npm i -g @google/clasp ; clasp login ; backend klasorunde",
    "      'clasp create --type standalone --title FincanlarERP' ; 'clasp push'.)",
    "  c) Code.gs basindaki SHEET_ID_TEMEL_ degerini ADIM 1'deki temel yil (2026) e-tablo kimligiyle degistirin.",
    "  d) Proje Ayarlari > Komut dosyasi ozellikleri: 'Ayarlar' JSON dosyasindaki degerleri girin.",
    "     YIL_SHEETLERI = {\"2026\":\"<yeni kimlik>\",\"2026-2\":\"<yeni kimlik>\"} biciminde YENI kimliklerle olmali.",
    "     EDM_PASSWORD gibi '***' yazan degerleri kendiniz girin.",
    "  e) Dagit > Yeni dagitim > Web uygulamasi: Calistiran = Ben, Erisim = Herkes. Yetkileri onaylayin.",
    "     Cikan 'Web uygulamasi URL'si' (…/exec) bir sonraki adimda lazim.",
    "  f) Editorden bir kez calistirin: yedekTetikleyiciKur  (otomatik yedek)  ve  gunlukRaporTetikleyiciKur (gunluk rapor).",
    "",
    "ADIM 3 — ON YUZU (PROGRAM EKRANI) KUR",
    "  a) ZIP icindeki index.html dosyasinda 'const CARI_API = \"...\"' satirini ADIM 2-e'deki yeni URL ile degistirin.",
    "  b) index.html, sw.js, manifest.json ve .png dosyalarini herhangi bir statik barindirmaya yukleyin",
    "     (GitHub Pages, Netlify, kendi sunucunuz...). GitHub kullaniyorsaniz depoya yukleyip Settings > Pages'i acin.",
    "  c) Acil durumda index.html'i bilgisayarda cift tiklayip acmak da calisir (internet gerekir).",
    "",
    "ADIM 4 — KONTROL",
    "  Programa eski kullanici adi/sifre ile girin (kullanicilar veriyle birlikte yedekten gelir).",
    "  Ayarlar > Yedekleme ekraninda 'Son yedek' yesil olmali.",
    "",
    "Bu rehber her yedekleme turunda otomatik guncellenir.",
  ].join("\n");
}

// ── Program ekranının (Ayarlar > Yedekleme) kullandığı işlemler ──

function getYedekDurumu() {
  var klasor = yedekKlasoruBul_();
  var simdi = Date.now();
  var sonuc = {
    ok: true, klasorVar: !!klasor, klasorUrl: klasor ? klasor.getUrl() : "",
    yedekler: [], adet: { veri: 0, kod: 0, ayar: 0 }, sonVeriZamani: null, sonVeriDakika: null,
    sonKodZamani: null, tetikleyici: yedekTetikleyiciDurumu_(), sonTur: null,
  };
  try {
    var p = PropertiesService.getScriptProperties().getProperty("SON_YEDEK_OZET");
    if (p) sonuc.sonTur = JSON.parse(p);
  } catch (e) {}
  if (!klasor) return sonuc;

  var liste = [];
  var it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var tur = yedekTurunuBul_(f.getName());
    if (!tur) continue;
    var t = f.getDateCreated().getTime();
    if (tur === "rehber") t = f.getLastUpdated().getTime();
    liste.push({ id: f.getId(), ad: f.getName(), tur: tur, t: t, boyut: f.getSize() });
  }
  liste.forEach(function (x) {
    if (sonuc.adet[x.tur] !== undefined) sonuc.adet[x.tur]++;
    if (x.tur === "veri" && (!sonuc.sonVeriZamani || x.t > sonuc.sonVeriZamani)) sonuc.sonVeriZamani = x.t;
    if (x.tur === "kod" && (!sonuc.sonKodZamani || x.t > sonuc.sonKodZamani)) sonuc.sonKodZamani = x.t;
  });
  if (sonuc.sonVeriZamani) sonuc.sonVeriDakika = Math.round((simdi - sonuc.sonVeriZamani) / 60000);
  liste.sort(function (a, b) { return b.t - a.t; });
  sonuc.yedekler = liste.slice(0, 40).map(function (x) {
    var indir;
    if (x.tur === "veri") indir = "https://docs.google.com/spreadsheets/d/" + x.id + "/export?format=xlsx";
    else indir = "https://drive.google.com/uc?export=download&id=" + x.id;
    return {
      id: x.id, ad: x.ad, tur: x.tur, boyutKB: x.boyut ? Math.round(x.boyut / 1024) : null,
      zaman: Utilities.formatDate(new Date(x.t), "Europe/Istanbul", "dd.MM.yyyy HH:mm"),
      acUrl: "https://drive.google.com/open?id=" + x.id, indirUrl: indir,
    };
  });
  return sonuc;
}

function yedekTetikleyiciDurumu_() {
  try {
    var t = ScriptApp.getProjectTriggers();
    var yedek = false, rapor = false;
    for (var i = 0; i < t.length; i++) {
      var h = t[i].getHandlerFunction();
      if (h === "otomatikYedekAl") yedek = true;
      if (h.indexOf("gunlukRapor") === 0 || h.indexOf("gunlukIslemRapor") === 0) rapor = true;
    }
    return { okunabildi: true, yedekKurulu: yedek, raporKurulu: rapor };
  } catch (e) {
    return { okunabildi: false, hata: String(e.message || e) };
  }
}

// "Şimdi Yedek Al" — veri + program kodu + ayarlar + rehber. Kilitsiz çalışır (veriyi değiştirmez).
function yedekAlSimdi() {
  var ozet = yedekCalistir_(true);
  var durum = getYedekDurumu();
  durum.yeniTur = ozet;
  return durum;
}

// Ekrandan otomatik yedek tetikleyicisini kur (yetki yoksa editörden elle kurulması istenir).
function yedekTetikleyiciKurWeb() {
  try {
    var t = ScriptApp.getProjectTriggers();
    for (var i = 0; i < t.length; i++) if (t[i].getHandlerFunction() === "otomatikYedekAl") ScriptApp.deleteTrigger(t[i]);
    ScriptApp.newTrigger("otomatikYedekAl").timeBased().everyHours(6).create();
  } catch (e) {
    return { ok: false, hata: "Ekrandan kurulamadı (" + (e.message || e) + "). Apps Script editöründe yedekTetikleyiciKur fonksiyonunu bir kez ▶ ile çalıştırın." };
  }
  var durum = getYedekDurumu();
  return durum;
}
