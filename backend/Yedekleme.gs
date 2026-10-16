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
  var temizlikOnce = "";
  try { temizlikOnce = yedekAlanTemizle_(klasor); } catch (e) { temizlikOnce = "HATA: " + e.message; }   // yer açmadan yeni kopya alınamayabilir
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
  var temizlikSonra = "";
  try { temizlikSonra = yedekAlanTemizle_(klasor); } catch (e) { temizlikSonra = "HATA: " + e.message; }
  ozet.temizlik = [temizlikOnce, temizlikSonra].filter(function (x) { return x; }).join(" | ");
  try { ozet.eposta = yedekEpostaGonder_(klasor, damga, !!kodZorla); } catch (e) { ozet.eposta = "HATA: " + e.message; }
  try { PropertiesService.getScriptProperties().setProperty("SON_YEDEK_OZET", JSON.stringify({ z: Date.now(), o: ozet })); } catch (e) {}
  return ozet;
}

// ── Drive doluluk koruması (12 Eki 2026) ──
// Drive %80 dolduğunda en ESKİ yedek dosyaları silinir. Her türün (veri için her yılın) en yeni birkaç kopyası ASLA silinmez;
// rehber silinmez. Silme KALICIDIR (çöp kutusu yer açmaz); Drive REST API ile yapılır, olmazsa çöpe atılır.
var YEDEK_DOLULUK_ESIGI_ = 0.80;
var YEDEK_TUR_MIN_ = { veri: 3, kod: 2, ayar: 3 };   // korunan en yeni kopya sayısı
var YEDEK_TEMIZLIK_TUR_LIMIT_ = 6;                    // tek turda en çok bu kadar dosya silinir

function driveDolulukOrani_() {
  try {
    var lim = DriveApp.getStorageLimit();
    if (!(lim > 0)) return null;   // sınırsız / okunamadı
    return DriveApp.getStorageUsed() / lim;
  } catch (e) { return null; }
}

function yedekKaliciSil_(dosya) {
  try {
    var r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + dosya.getId() + "?supportsAllDrives=true",
      { method: "delete", headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    var k = r.getResponseCode();
    if (k === 204 || k === 200) return true;
  } catch (e) {}
  dosya.setTrashed(true);
  return false;
}

function yedekAlanTemizle_(klasor) {
  var oran = driveDolulukOrani_();
  if (oran === null) return "Drive kotası okunamadı";
  var yuzde = Math.round(oran * 100);
  if (oran < YEDEK_DOLULUK_ESIGI_) return "Drive %" + yuzde + " dolu (temizlik gerekmedi)";
  var gruplar = {}, it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next(), ad = f.getName(), tur = yedekTurunuBul_(ad);
    if (!tur || tur === "rehber") continue;
    var anahtar = tur === "veri" ? "veri:" + (ad.split(" - ")[1] || "") : tur;
    (gruplar[anahtar] = gruplar[anahtar] || []).push({ f: f, tur: tur, t: f.getDateCreated().getTime(), ad: ad });
  }
  var adaylar = [];
  Object.keys(gruplar).forEach(function (k) {
    var g = gruplar[k].sort(function (a, b) { return b.t - a.t; });
    g.slice(YEDEK_TUR_MIN_[g[0].tur] || 3).forEach(function (x) { adaylar.push(x); });   // en yeniler korunur
  });
  adaylar.sort(function (a, b) { return a.t - b.t; });   // en eskiden başla
  var silinen = [];
  while (adaylar.length && silinen.length < YEDEK_TEMIZLIK_TUR_LIMIT_) {
    var x = adaylar.shift();
    try { yedekKaliciSil_(x.f); silinen.push(x.ad); } catch (e) { break; }
    var yeni = driveDolulukOrani_();
    if (yeni !== null && yeni < YEDEK_DOLULUK_ESIGI_) { oran = yeni; break; }
  }
  var son = driveDolulukOrani_();
  var sonYuzde = son === null ? yuzde : Math.round(son * 100);
  if (!silinen.length) return "Drive %" + yuzde + " dolu — silinebilecek eski yedek yok (her türün en yeni kopyaları korunur); Drive alanını elle boşaltın";
  return "Drive %" + yuzde + " doluydu: " + silinen.length + " eski yedek silindi (şimdi ≈%" + sonYuzde + ")" + (sonYuzde >= 80 ? " — hâlâ %80 üstü, Drive'da başka büyük dosyalar var" : "");
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
    "  * Ayni dosyalar tanimli diger e-posta adreslerine ek olarak da gider (ana hesap erisilemezse oradan alin).",
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
    ok: true, klasorVar: !!klasor, klasorUrl: klasor ? klasor.getUrl() : "", klasorId: klasor ? klasor.getId() : "",
    eposta: yedekEpostaDurumu_(),
    yedekler: [], adet: { veri: 0, kod: 0, ayar: 0 }, sonVeriZamani: null, sonVeriDakika: null,
    sonKodZamani: null, tetikleyici: yedekTetikleyiciDurumu_(), sonTur: null,
    driveDolulukYuzde: (function () { var o = driveDolulukOrani_(); return o === null ? null : Math.round(o * 100); })(),
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

// ════════════════════════════════════════════════════════════════════════════
// BAŞKA HESAPLARA YEDEK (8-9 Eki 2026) — en fazla 3 e-posta adresi.
//  * Yedek paketi (veri .xlsx + program kodu ZIP + ayarlar + rehber) bu adreslere E-POSTA EKİ olarak gider:
//    böylece kopya o hesabın kendi posta kutusunda durur; ana hesap ele geçirilse bile silinemez.
//    (Gmail'de ek üzerindeki "Drive'a kaydet" ile alıcı kendi Drive'ına da alabilir.)
//  * İsteğe bağlı: yedek klasörü bu adreslerle YALNIZCA GÖRÜNTÜLEME olarak paylaşılır; alıcı hesapta
//    kurulacak "Yedek Çekici" betiği (ekrandan indirilir) her gün kopyaları kendi Drive'ına alır (Drive→Drive).
//  * Zamanlanmış turda günde en çok bir kez gönderilir; "Şimdi Yedek Al" her seferinde gönderir.
// ════════════════════════════════════════════════════════════════════════════
var YEDEK_EPOSTA_ANAHTAR_ = "YEDEK_EPOSTALAR";
var YEDEK_SON_EPOSTA_ANAHTAR_ = "YEDEK_SON_EPOSTA";
var YEDEK_EPOSTA_SIKLIK_SAAT_ = 20;
var YEDEK_EK_LIMIT_BAYT_ = 20 * 1024 * 1024; // tek e-postadaki toplam ek (Gmail sınırı 25 MB)

function yedekEpostaAyariOku_() {
  try {
    var ham = PropertiesService.getScriptProperties().getProperty(YEDEK_EPOSTA_ANAHTAR_);
    var a = ham ? JSON.parse(ham) : {};
    return { adresler: Array.isArray(a.adresler) ? a.adresler.slice(0, 3) : [], paylas: a.paylas !== false };
  } catch (e) { return { adresler: [], paylas: true }; }
}

function yedekEpostaDurumu_() {
  var a = yedekEpostaAyariOku_();
  var son = Number(PropertiesService.getScriptProperties().getProperty(YEDEK_SON_EPOSTA_ANAHTAR_) || 0);
  return {
    adresler: a.adresler, paylas: a.paylas,
    sonGonderim: son ? Utilities.formatDate(new Date(son), "Europe/Istanbul", "dd.MM.yyyy HH:mm") : "",
  };
}

// body: { adresler: ["a@x.com", ...], paylas: true|false }
function saveYedekEpostalari(body) {
  var ham = Array.isArray(body.adresler) ? body.adresler : [];
  var temiz = [], gorulen = {};
  for (var i = 0; i < ham.length; i++) {
    var m = String(ham[i] || "").trim().toLowerCase();
    if (!m) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return { ok: false, hata: "Geçersiz e-posta adresi: " + m };
    if (gorulen[m]) continue;
    gorulen[m] = true; temiz.push(m);
  }
  if (temiz.length > 3) return { ok: false, hata: "En fazla 3 adres tanımlanabilir." };
  var onceki = yedekEpostaAyariOku_();
  var paylas = body.paylas !== false;
  PropertiesService.getScriptProperties().setProperty(YEDEK_EPOSTA_ANAHTAR_, JSON.stringify({ adresler: temiz, paylas: paylas }));
  var uyari = "";
  try {
    var klasor = yedekKlasoruGetirVeyaOlustur_();
    // Klasör paylaşımı: yalnızca GÖRÜNTÜLEME. Listeden çıkarılan/paylaşım kapatılan adreslerin erişimi kaldırılır.
    var hedef = paylas ? temiz : [];
    onceki.adresler.forEach(function (m) { if (hedef.indexOf(m) < 0) { try { klasor.removeViewer(m); } catch (e) {} } });
    hedef.forEach(function (m) { try { klasor.addViewer(m); } catch (e) { uyari += " " + m + " ile paylaşılamadı (" + e.message + ")."; } });
  } catch (e) { uyari = "Klasör paylaşımı güncellenemedi: " + e.message; }
  var d = getYedekDurumu();
  if (uyari) d.uyari = uyari.trim();
  return d;
}

// Klasördeki her türün en yeni dosyası (her yıl için ayrı veri yedeği).
function yedekEnYeniDosyalar_(klasor) {
  var en = {}, it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next(), ad = f.getName(), tur = yedekTurunuBul_(ad);
    if (!tur) continue;
    var anahtar = tur === "veri" ? "veri:" + (ad.split(" - ")[1] || "") : tur;
    var t = tur === "rehber" ? f.getLastUpdated().getTime() : f.getDateCreated().getTime();
    if (!en[anahtar] || t > en[anahtar].t) en[anahtar] = { f: f, tur: tur, t: t };
  }
  return Object.keys(en).sort().map(function (k) { return en[k]; });
}

function yedekEpostaGonder_(klasor, damga, zorla) {
  var ayar = yedekEpostaAyariOku_();
  if (!ayar.adresler.length) return "adres tanımlı değil";
  var props = PropertiesService.getScriptProperties();
  var son = Number(props.getProperty(YEDEK_SON_EPOSTA_ANAHTAR_) || 0);
  if (!zorla && son && (Date.now() - son) < YEDEK_EPOSTA_SIKLIK_SAAT_ * 3600 * 1000) return "bugün gönderildi (atlandı)";

  var dosyalar = yedekEnYeniDosyalar_(klasor);
  var ekler = [], linkler = [];
  dosyalar.forEach(function (d) {
    var f = d.f;
    try {
      if (d.tur === "veri") {
        var yanit = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + f.getId() + "/export?format=xlsx",
          { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        var blob = yanit.getResponseCode() === 200 ? yanit.getBlob().setName(f.getName() + ".xlsx") : null;
        if (blob && blob.getBytes().length <= YEDEK_EK_LIMIT_BAYT_) { ekler.push(blob); return; }
        linkler.push(f.getName() + " (çok büyük / dışa aktarılamadı): " + f.getUrl());
      } else {
        var b = f.getBlob();
        if (b.getBytes().length <= YEDEK_EK_LIMIT_BAYT_) ekler.push(b.setName(f.getName())); else linkler.push(f.getName() + ": " + f.getUrl());
      }
    } catch (e) { linkler.push(f.getName() + " (eklenemedi: " + e.message + "): " + f.getUrl()); }
  });

  // Ekleri e-posta başına ~20 MB'ı aşmayacak şekilde parçalara böl.
  var parcalar = [[]], boyut = 0;
  ekler.forEach(function (b) {
    var n = b.getBytes().length;
    if (boyut + n > YEDEK_EK_LIMIT_BAYT_ && parcalar[parcalar.length - 1].length) { parcalar.push([]); boyut = 0; }
    parcalar[parcalar.length - 1].push(b); boyut += n;
  });
  var toplamMail = parcalar.length * ayar.adresler.length;
  if (MailApp.getRemainingDailyQuota() < toplamMail) throw new Error("Günlük e-posta kotası yetmiyor (" + toplamMail + " mail gerekli)");

  ayar.adresler.forEach(function (adres) {
    parcalar.forEach(function (ek, i) {
      var govde = "Fincanlar ERP otomatik yedeği — " + damga + "\n\n" +
        "Bu e-postadaki dosyaları saklayın (Gmail'de ek üzerindeki 'Drive'a kaydet' ile kendi Drive'ınıza da alabilirsiniz).\n" +
        "Ekler: " + ek.map(function (b) { return b.getName(); }).join(", ") + "\n" +
        (parcalar.length > 1 ? "\n(Bu " + (i + 1) + ". / " + parcalar.length + " e-posta; yedek birden fazla e-postaya bölündü.)\n" : "") +
        (linkler.length && i === 0 ? "\nE-postaya sığmayan dosyalar (klasör bu hesapla paylaşıldıysa açılır):\n" + linkler.join("\n") + "\n" : "") +
        "\nGeri yükleme adımları ektedeki GERI_YUKLEME_REHBERI.txt dosyasındadır.\nDrive klasörü: " + klasor.getUrl() + "\n";
      MailApp.sendEmail({ to: adres, subject: "Fincanlar ERP Yedek — " + damga + (parcalar.length > 1 ? " (" + (i + 1) + "/" + parcalar.length + ")" : ""), body: govde, attachments: ek });
    });
  });
  props.setProperty(YEDEK_SON_EPOSTA_ANAHTAR_, String(Date.now()));
  return ayar.adresler.length + " adrese gönderildi (" + ekler.length + " ek" + (linkler.length ? ", " + linkler.length + " bağlantı" : "") + ")";
}

// Ekrandan: mevcut en yeni dosyaları yeni yedek almadan e-postayla gönder.
function yedekEpostaGonderSimdi() {
  var klasor = yedekKlasoruBul_();
  if (!klasor) return { ok: false, hata: "Henüz yedek klasörü yok — önce 'Şimdi Yedek Al' ile yedek alın." };
  var damga = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd_HH-mm");
  var sonuc;
  try { sonuc = yedekEpostaGonder_(klasor, damga, true); } catch (e) { return { ok: false, hata: "E-posta gönderilemedi: " + e.message }; }
  var d = getYedekDurumu();
  d.epostaSonuc = sonuc;
  return d;
}


// ════════════════════════════════════════════════════════════════════════════
// YEREL SUNUCU YEDEĞİ (15 Eki 2026)
// Dükkândaki yerel sunucu (localhost:3000) verisini her 5 dakikada (değiştiyse) buraya gönderir:
//   Drive > "Fincanlar ERP - Otomatik Yedekler" > "Yerel Sunucu" > yerel-veri-<yıl-ay-gün_saat-dk-sn>.json.gz
// Güvenlik: yükleme anahtarı yerel sunucuda üretilir; bulutta yalnızca SHA-256 özeti tutulur (ilk yüklemede kaydolur).
//   Anahtarı sıfırlamak için Script Özelliği YEREL_YEDEK_ANAHTAR_OZET silinir.
// Budama: son 3 saat hepsi, 48 saate kadar saatte 1, 30 güne kadar günde 1, daha eskisi silinir; en yeni 3 hiç silinmez.
// Büyük veri 24 MB'lık gzip PARÇALARINA bölünür (.001, .002 ...); birleştirme: copy /b a.gz.001+a.gz.002 a.json.gz
// ════════════════════════════════════════════════════════════════════════════
var YEREL_YEDEK_ALT_KLASOR_ = "Yerel Sunucu";

function yerelYedekKlasoru_() {
  var ana = yedekKlasoruGetirVeyaOlustur_();
  var it = ana.getFoldersByName(YEREL_YEDEK_ALT_KLASOR_);
  if (it.hasNext()) return it.next();
  var k = ana.createFolder(YEREL_YEDEK_ALT_KLASOR_);
  k.createFile("OKU-BENI.txt", [
    "YEREL SUNUCU YEDEKLERI",
    "yerel-veri-<tarih_saat>.json.gz  : yerel sunucunun veri.json dosyasinin sikistirilmis kopyasi.",
    "Geri yuklemek icin: dosyayi acin (7-Zip / gunzip) -> veri.json elde edilir -> C:\\YerelSunucu\\FincanlarERP\\veri\\ icine koyun (sunucu kapaliyken).",
    "Buyuk veri .001 .002 parcalara bolunur: copy /b yerel-veri-X.json.gz.001+yerel-veri-X.json.gz.002 birlesik.json.gz",
    "Yedekler budanir: son 3 saat hepsi, 48 saate kadar saatte 1, 30 gune kadar gunde 1."
  ].join("\r\n"), MimeType.PLAIN_TEXT);
  return k;
}

function yerelYedekAnahtarKontrol_(anahtar) {
  anahtar = String(anahtar || "");
  if (anahtar.length < 20) return "Anahtar geçersiz";
  var ozet = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, anahtar));
  var props = PropertiesService.getScriptProperties();
  var kayitli = props.getProperty("YEREL_YEDEK_ANAHTAR_OZET");
  if (!kayitli) { props.setProperty("YEREL_YEDEK_ANAHTAR_OZET", ozet); return ""; }
  return kayitli === ozet ? "" : "Anahtar uyuşmuyor";
}

// body: { anahtar, damga: "2026-10-15_03-55-10", parca: 1, toplam: 1, veri: <base64 gzip> } — oturumsuz, anahtarla korunur.
function yerelYedekYukle(body) {
  body = body || {};
  var hata = yerelYedekAnahtarKontrol_(body.anahtar);
  if (hata) return { ok: false, hata: hata };
  var damga = String(body.damga || "");
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(damga)) return { ok: false, hata: "Damga geçersiz" };
  var parca = parseInt(body.parca, 10) || 1, toplam = parseInt(body.toplam, 10) || 1;
  if (parca < 1 || toplam < 1 || parca > toplam || toplam > 99) return { ok: false, hata: "Parça bilgisi geçersiz" };
  var bytes = Utilities.base64Decode(String(body.veri || ""));
  if (!bytes || bytes.length < 20) return { ok: false, hata: "Veri boş" };
  var ad = "yerel-veri-" + damga + ".json.gz" + (toplam > 1 ? "." + ("00" + parca).slice(-3) : "");
  var klasor = yerelYedekKlasoru_();
  if (klasor.getFilesByName(ad).hasNext()) return { ok: true, ad: ad, zatenVar: true };   // aynı parça tekrar gelirse çoğaltma
  klasor.createFile(Utilities.newBlob(bytes, "application/gzip", ad));
  var silinen = 0;
  if (parca === toplam) { try { silinen = yerelYedekBuda_(klasor); } catch (e) {} }
  var oran = driveDolulukOrani_();
  return { ok: true, ad: ad, boyut: bytes.length, silinen: silinen, driveYuzde: oran === null ? null : Math.round(oran * 100) };
}

function yerelYedekBuda_(klasor) {
  var gruplar = {}, it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var m = /^yerel-veri-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json\.gz/.exec(f.getName());
    if (!m) continue;
    var anahtar = m.slice(1, 7).join("");
    var g = gruplar[anahtar] || (gruplar[anahtar] = { t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), dosyalar: [] });
    g.dosyalar.push(f);
  }
  var s = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd-HH-mm-ss").split("-");
  var simdi = Date.UTC(+s[0], +s[1] - 1, +s[2], +s[3], +s[4], +s[5]);
  var liste = Object.keys(gruplar).map(function (k) { return gruplar[k]; }).sort(function (a, b) { return a.t - b.t; });   // eskiden yeniye
  var korunanSon = liste.length - 3;   // en yeni 3 grup ASLA silinmez
  var goruldu = {}, sil = [];
  liste.forEach(function (g, i) {
    if (i >= korunanSon) return;
    var yasSaat = (simdi - g.t) / 3600000;
    if (yasSaat <= 3) return;
    var kova = yasSaat <= 48 ? "s" + Math.floor(g.t / 3600000) : (yasSaat <= 720 ? "g" + Math.floor(g.t / 86400000) : "x");
    if (kova !== "x" && !goruldu[kova]) { goruldu[kova] = true; return; }   // kovanın ilk (en eski) yedeği kalır
    sil.push(g);
  });
  var adet = 0;
  for (var i = 0; i < sil.length && adet < 40; i++) {
    sil[i].dosyalar.forEach(function (f) { try { yedekKaliciSil_(f); } catch (e) {} });
    adet++;
  }
  return adet;
}

// ════════════════════════════════════════════════════════════════════════════
// ★ 16 Eki 2026 — SORUN UYARISI (e-posta). Normal işleyişte olmaması gereken sorunlar her gün elle kontrol edilmesin diye sistem uyarır.
// Yerel sunucu her 5 dk'da buluta "nabız" gönderir (yerelNabiz): hayatta olduğunu + kendi tespit ettiği sorunları (3 ardışık yedek gönderilemedi,
// yedek durduruldu, disk/Drive dolu...). Bulut (bu bölüm) şunlarda e-posta atar:
//   • NABIZ yok: son nabızdan beri esikDk (varsayılan 15 dk = 3 nabız) geçti — sunucu kapandı / bilgisayar bozuldu / internet gitti.
//     Yalnız ÇALIŞMA SAATLERİNDE (varsayılan 08:00-20:00) denetlenir; gece bilgisayar kapalıysa uyarı atılmaz.
//   • Yerelin bildirdiği sorun var (e-posta işaretli olanlar): sorun başına 1 e-posta, sürerse 6 saatte bir hatırlatma.
//   • Her iki durum düzelince "düzeldi" e-postası.
// Alıcı ve saatler Script Özellikleri'nde NABIZ_AYAR (JSON: {eposta, esikDk, baslangicSaat, bitisSaat, hatirlatSaat}) ile değiştirilir.
// Tetikleyici (nabizKontrolTetikleyici, 5 dk) ilk nabızla kendiliğinden kurulur; elle kurmak gerekmez.
// ════════════════════════════════════════════════════════════════════════════
var NABIZ_VARSAYILAN_ = { eposta: "fincanlaryapi@gmail.com", esikDk: 15, baslangicSaat: 8, bitisSaat: 20, hatirlatSaat: 6 };

function nabizAyar_() {
  var a = {}; Object.keys(NABIZ_VARSAYILAN_).forEach(function (k) { a[k] = NABIZ_VARSAYILAN_[k]; });
  try {
    var j = JSON.parse(PropertiesService.getScriptProperties().getProperty("NABIZ_AYAR") || "{}") || {};
    if (typeof j.eposta === "string" && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(j.eposta.trim())) a.eposta = j.eposta.trim();
    ["esikDk", "baslangicSaat", "bitisSaat", "hatirlatSaat"].forEach(function (k) { var n = parseFloat(j[k]); if (isFinite(n) && n >= 0) a[k] = n; });
  } catch (e) { /* bozuk ayar varsayılana düşer */ }
  if (a.esikDk < 10) a.esikDk = 10;   // nabız 5 dk'da bir gelir; 10 dk altı sahte alarm üretir
  return a;
}
function nabizSaatOndalik_(t) {
  var d = new Date(t);
  return parseInt(Utilities.formatDate(d, "Europe/Istanbul", "H"), 10) + parseInt(Utilities.formatDate(d, "Europe/Istanbul", "mm"), 10) / 60;
}
function nabizZamanMetni_(t) { return Utilities.formatDate(new Date(t), "Europe/Istanbul", "dd/MM/yyyy HH:mm"); }
function nabizMail_(konu, govde) {
  try {
    var ayar = nabizAyar_();
    if (MailApp.getRemainingDailyQuota() < 1) return false;
    MailApp.sendEmail({ to: ayar.eposta, subject: "Fincanlar ERP UYARI — " + konu, body: govde + "\n\n—\nBu ileti Fincanlar ERP bulut tarafından otomatik gönderildi (" + nabizZamanMetni_(Date.now()) + ")." });
    return true;
  } catch (e) { return false; }
}

// body: { anahtar, uyarilar: [{k, m, e}], yedekT, test } — oturumsuz, yükleme anahtarıyla korunur (yerelYedekYukle ile aynı).
function yerelNabiz(body) {
  if (yerelMi_()) return { ok: false, hata: "Nabız yalnızca bulutta alınır" };
  body = body || {};
  var hata = yerelYedekAnahtarKontrol_(body.anahtar);
  if (hata) return { ok: false, hata: hata };
  var uy = [];
  (Array.isArray(body.uyarilar) ? body.uyarilar : []).slice(0, 10).forEach(function (u) {
    if (u && u.k) uy.push({ k: String(u.k).slice(0, 30), m: String(u.m || "").slice(0, 300), e: u.e === true });
  });
  var props = PropertiesService.getScriptProperties();
  props.setProperty("NABIZ", JSON.stringify({ t: Date.now(), uyarilar: uy, yedekT: parseInt(body.yedekT, 10) || 0 }));
  nabizTetikleyiciGuvence_();
  var sonuc = { ok: true, eposta: nabizAyar_().eposta };
  if (body.test) {
    sonuc.testGonderildi = nabizMail_("deneme", "Bu bir DENEME iletisidir. Yerel sunucudan \"Uyarı e-postasını dene\" düğmesine basıldı.\nUyarı e-postaları bu adrese gelecek: " + sonuc.eposta + "\nÇalışma saatleri: " + nabizAyar_().baslangicSaat + ":00 - " + nabizAyar_().bitisSaat + ":00, nabız eşiği: " + nabizAyar_().esikDk + " dk.");
    if (!sonuc.testGonderildi) { sonuc.ok = false; sonuc.hata = "E-posta gönderilemedi (kota dolu ya da izin yok)"; }
  }
  try { nabizDegerlendir_(); } catch (e) { /* değerlendirme hatası nabzı bozmaz */ }
  return sonuc;
}

// Çekirdek: durumu değerlendirir, gerekirse e-posta atar. Test edilebilsin diye tetikleyiciden ayrı.
function nabizDegerlendir_() {
  var props = PropertiesService.getScriptProperties();
  var nb = null;
  try { nb = JSON.parse(props.getProperty("NABIZ") || "null"); } catch (e) { nb = null; }
  if (!nb || !nb.t) return { durum: "nabiz-yok" };            // yerel sunucu henüz hiç nabız göndermedi
  var ayar = nabizAyar_(), simdi = Date.now();
  var durum = {}; try { durum = JSON.parse(props.getProperty("NABIZ_DURUM") || "{}") || {}; } catch (e) { durum = {}; }
  var yasDk = (simdi - nb.t) / 60000;
  var saatSimdi = nabizSaatOndalik_(simdi), saatSon = nabizSaatOndalik_(nb.t);
  var calismaSaati = function (h) { return h >= ayar.baslangicSaat && h < ayar.bitisSaat; };
  var gonderilen = [];

  // 1) Nabız kesildi (sunucu yanıt vermiyor). 12 saati geçmişse (gece/hafta sonu kapalı) yeniden uyarılmaz.
  var sessiz = yasDk >= ayar.esikDk && yasDk < 12 * 60 && calismaSaati(saatSimdi) && calismaSaati(saatSon);
  if (sessiz && !durum.sessiz) {
    durum.sessiz = { t: simdi }; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));
    nabizMail_("Yerel sunucudan " + Math.round(yasDk) + " dakikadır haber alınamıyor",
      "Yerel sunucudan (SATIS bilgisayarı) son nabız: " + nabizZamanMetni_(nb.t) + " (" + Math.round(yasDk) + " dk önce).\n\nOlası nedenler: sunucu penceresi kapanmış, bilgisayar kapalı/uykuda, internet kesilmiş.\n" +
      "Bu sırada girilen işlemler yerelde durur ama buluta GİTMEZ. Kontrol edin: SATIS bilgisayarında sunucu penceresi açık mı, internet var mı.\n" +
      "Son başarılı bulut yedeği: " + (nb.yedekT ? nabizZamanMetni_(nb.yedekT) : "bilinmiyor") + ".");
    gonderilen.push("sessiz");
  } else if (durum.sessiz && yasDk < ayar.esikDk) {
    durum.sessiz = null; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));
    nabizMail_("Yerel sunucu yeniden bağlandı", "Yerel sunucudan nabız tekrar geliyor (" + nabizZamanMetni_(nb.t) + "). Önceki uyarı geçersiz.");
    gonderilen.push("sessiz-duzeldi");
  } else if (durum.sessiz && yasDk >= 12 * 60) {
    durum.sessiz = null; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));   // gece/uzun kapanış: sessizce sıfırla
  }

  // 2) Yerelin kendi bildirdiği sorunlar (yalnız nabız tazeyken; e-posta işaretli olanlar)
  if (yasDk < ayar.esikDk) {
    var e = (nb.uyarilar || []).filter(function (u) { return u.e; });
    var imza = e.map(function (u) { return u.k; }).sort().join(",");
    var metin = e.map(function (u) { return "• " + u.m; }).join("\n");
    if (imza && imza !== (durum.imza || "")) {
      durum.imza = imza; durum.mailT = simdi; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));
      nabizMail_(e.length === 1 ? e[0].m.slice(0, 70) : e.length + " sorun var", "Yerel sunucu şu sorun(lar)ı bildirdi:\n\n" + metin + "\n\nAyrıntı: ERP > Yedekleme > Günlük Rapor ve sağ üstteki zil.");
      gonderilen.push("sorun");
    } else if (imza && simdi - (durum.mailT || 0) > ayar.hatirlatSaat * 3600000) {
      durum.mailT = simdi; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));
      nabizMail_("HATIRLATMA: sorun sürüyor", "Aşağıdaki sorun(lar) hâlâ düzelmedi:\n\n" + metin);
      gonderilen.push("hatirlatma");
    } else if (!imza && durum.imza) {
      durum.imza = ""; props.setProperty("NABIZ_DURUM", JSON.stringify(durum));
      nabizMail_("Sorun(lar) düzeldi", "Yerel sunucunun bildirdiği sorun(lar) artık görünmüyor.");
      gonderilen.push("sorun-duzeldi");
    }
  }
  return { durum: "tamam", yasDk: Math.round(yasDk), gonderilen: gonderilen };
}

function nabizKontrolTetikleyici() { try { nabizDegerlendir_(); } catch (e) { /* tetikleyici hatası sessiz */ } }
function nabizTetikleyiciGuvence_() {
  try {
    var onb = CacheService.getScriptCache();
    if (onb.get("nabizTetikleyici")) return;
    var var_ = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "nabizKontrolTetikleyici"; });
    if (!var_) ScriptApp.newTrigger("nabizKontrolTetikleyici").timeBased().everyMinutes(5).create();
    onb.put("nabizTetikleyici", "1", 6 * 3600);
  } catch (e) { /* kurulamazsa nabız yine de işler; her nabızda yeniden denenir */ }
}

// Ekrandaki kırmızı uyarı bandı için (her oturum açmış kullanıcıya açık, salt okunur). Ayrıntıyı ekran yalnız Admin'e gösterir.
function yerelYedekSaglik() {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: true, yerel: false };
  return JSON.parse(JSON.stringify(YerelYedek.saglik()));
}

// ── Yerel sunucuda çalışırken Yedekleme ekranının kullandığı işlemler (yerel sunucu src/yedek.js ile konuşur) ──
function yerelYedekDurum() {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: true, yerel: false };
  var d = YerelYedek.durum();
  return JSON.parse(JSON.stringify({ ok: true, yerel: true, ayar: d.ayar, durum: d.durum, flash: d.flash, bulutAdres: d.bulutAdres, simdi: d.simdi }));
}
function yerelYedekAyarKaydet(body) {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelYedek.ayarKaydet((body && body.ayar) || {})));
}
// ★ 16 Eki 2026 — İşlem günlüğü (Yedekleme modülü günlük raporu + sağ üst bildirim zili). body: { tarih: "YYYY-MM-DD", filtre: "tum|kritik|silme|bekleyen" }
function yerelYedekAktivite(body) {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelYedek.aktiviteListe({ tarih: String((body && body.tarih) || ""), filtre: String((body && body.filtre) || "tum") })));
}
function yerelYedekAktiviteOzet() {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: true, yerel: false };
  return JSON.parse(JSON.stringify(Object.assign({ yerel: true }, YerelYedek.aktiviteOzet())));
}
function yerelYedekSimdi(body) {
  if (typeof YerelYedek === "undefined" || !YerelYedek) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelYedek.simdi(String((body && body.hedef) || "ikisi"))));
}

// ════════════════════════════════════════════════════════════════════════════
// YEREL SUNUCU PROGRAM GÜNCELLEME (15 Eki 2026) — Ayarlar > "Program Güncelleme (GitHub)"
// Yerel sunucu src/guncelle.js ile konuşur; bulutta (Apps Script) bu işlemler "yerel değil" döner.
// ════════════════════════════════════════════════════════════════════════════
function yerelGuncelleDurum() {
  if (typeof YerelGuncelle === "undefined" || !YerelGuncelle) return { ok: true, yerel: false };
  return Object.assign({ ok: true }, JSON.parse(JSON.stringify(YerelGuncelle.durum())), { yerelSunucu: true }); // "yerel" alanı kurulu sürüm bilgisidir (null olabilir), bayrak ayrı
}
function yerelGuncelleKontrol() {
  if (typeof YerelGuncelle === "undefined" || !YerelGuncelle) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelGuncelle.kontrol()));
}
function yerelGuncelleUygula() {
  if (typeof YerelGuncelle === "undefined" || !YerelGuncelle) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelGuncelle.uygula()));
}
function yerelGuncelleGeriAl(body) {
  if (typeof YerelGuncelle === "undefined" || !YerelGuncelle) return { ok: false, hata: "Bu işlem yalnızca yerel sunucuda çalışır" };
  return JSON.parse(JSON.stringify(YerelGuncelle.geriAl(String((body && body.ad) || ""))));
}


// ════════════════════════════════════════════════════════════════════════════
// ★ 16 Eki 2026 — BULUT = YEREL AYNASI (tek yönlü: yerel → bulut)
// Yerel sunucu her 5 dk'da (veri değiştiyse) veri.json'ı yukarıdaki "Yerel Sunucu" Drive klasörüne gönderir. Bu bölüm o yedeğin
// EN YENİ tamamlanmış kopyasını okur ve bulutun e-tablolarını yerelle AYNI hale getirir: aynı şirketler/yıllar (ESKİ 2026, 2026...),
// aynı kullanıcılar, cariler, stoklar, hareketler. Bulut zaten salt okunur olduğundan ayna yönü tek taraflıdır (çakışma yok).
//   • Bulutun ESKİ e-tablolarına DOKUNULMAZ: yerelin her şirketi için yeni bir "Fincanlar ERP - Yerel Ayna - <ad>" e-tablosu açılır
//     (AYNA_HARITA: yerel kitap kimliği → bulut e-tablo kimliği). Bulut şirket listesi AYNA_YIL_SHEETLERI ile bunlara yönlenir.
//   • "Oturumlar" sayfası aynalanmaz (bulut girişleri düşmesin). Şirket etiketleri / açılış şirketi yerelden alınır.
//   • Bulut acil durumda yazmaya AÇIKSA ayna çalışmaz (acil kayıtlar ezilmesin).
//   • Tetikleyici: Ayarlar > Bulut Yazma Kilidi > "Otomatik eşitlemeyi kur" (bir kez, 5 dk'da bir). "Şimdi eşitle" ile elle de çalışır.
// ════════════════════════════════════════════════════════════════════════════
function aynaVeriOku_() {
  var klasor = yerelYedekKlasoru_();
  var gruplar = {}, it = klasor.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var m = /^yerel-veri-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.json\.gz(?:\.(\d{3}))?$/.exec(f.getName());
    if (!m) continue;
    var g = gruplar[m[1]] || (gruplar[m[1]] = { damga: m[1], parcalar: [] });
    g.parcalar.push({ no: m[2] ? parseInt(m[2], 10) : 1, tek: !m[2], dosya: f });
  }
  var liste = Object.keys(gruplar).sort().reverse();   // yeniden eskiye
  var simdi = Date.now();
  for (var i = 0; i < liste.length; i++) {
    var g2 = gruplar[liste[i]];
    g2.parcalar.sort(function (a, b) { return a.no - b.no; });
    var tamam = g2.parcalar.every(function (p, ix) { return p.no === ix + 1; });
    var yeniMi = g2.parcalar.some(function (p) { return simdi - p.dosya.getLastUpdated().getTime() < 90000; });   // yükleme sürüyor olabilir
    if (!tamam || yeniMi) continue;
    var baytlar = [];
    g2.parcalar.forEach(function (p) {
      var ham = Utilities.ungzip(Utilities.newBlob(p.dosya.getBlob().getBytes(), "application/x-gzip", "p.gz")).getBytes();
      baytlar = baytlar.concat(ham);
    });
    var metin = Utilities.newBlob(baytlar).getDataAsString("UTF-8");
    var veri = JSON.parse(metin, function (k, v) { return v && typeof v === "object" && v.$d !== undefined && Object.keys(v).length === 1 ? new Date(v.$d) : v; });
    return { damga: g2.damga, veri: veri };
  }
  return null;
}

// Çekirdek: ayrıştırılmış yerel veriyi (veri.json) bulut e-tablolarına yazar. Test edilebilsin diye Drive'dan ayrı.
function aynaUygula_(veri, baslangic) {
  var props = PropertiesService.getScriptProperties();
  var harita = {};
  try { harita = JSON.parse(props.getProperty("AYNA_HARITA") || "{}") || {}; } catch (e) { harita = {}; }
  var t0 = baslangic || Date.now();
  var yazilan = 0, sayfaSayisi = 0, yeniDosya = 0;
  var atla = {}; atla[SHEETS.oturumlar] = true;
  (veri.kitaplar || []).forEach(function (k) {
    var ss = null;
    if (harita[k.id]) { try { ss = SpreadsheetApp.openById(harita[k.id]); } catch (e) { ss = null; } }
    if (!ss) { ss = SpreadsheetApp.create("Fincanlar ERP - Yerel Ayna - " + (k.ad || k.id)); harita[k.id] = ss.getId(); yeniDosya++; props.setProperty("AYNA_HARITA", JSON.stringify(harita)); }
    var yerelAdlar = {};
    (k.sayfalar || []).forEach(function (sy) {
      if (!sy || !sy.ad || atla[sy.ad] || sy.ad.indexOf("_YEDEK_") >= 0) return;
      yerelAdlar[sy.ad] = true;
      var sh = ss.getSheetByName(sy.ad) || ss.insertSheet(sy.ad);
      var satirlar = sy.satirlar || [];
      var nr = satirlar.length, nc = 1;
      satirlar.forEach(function (r) { if (r && r.length > nc) nc = r.length; });
      var eskiSon = sh.getLastRow(), eskiKol = sh.getLastColumn();
      if (nr === 0) { if (eskiSon > 0) sh.clearContents(); sayfaSayisi++; return; }
      if (sh.getMaxRows() < nr) sh.insertRowsAfter(sh.getMaxRows(), nr - sh.getMaxRows());
      if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
      (sy.metinKol || []).forEach(function (c) { if (c >= 1 && c <= nc) sh.getRange(1, c, nr, 1).setNumberFormat("@"); });
      var m = satirlar.map(function (r) {
        var o = new Array(nc);
        for (var j = 0; j < nc; j++) { var v = r && r[j]; o[j] = (v === undefined || v === null) ? "" : v; }
        return o;
      });
      sh.getRange(1, 1, nr, nc).setValues(m);
      if (eskiSon > nr) sh.getRange(nr + 1, 1, eskiSon - nr, Math.max(eskiKol, nc)).clearContent();
      if (eskiKol > nc) sh.getRange(1, nc + 1, Math.max(nr, eskiSon), eskiKol - nc).clearContent();
      yazilan += nr; sayfaSayisi++;
    });
    // yerelde olmayan (silinmiş / varsayılan boş) sayfaları kaldır; en az bir sayfa kalır, Oturumlar'a dokunulmaz
    ss.getSheets().forEach(function (sh) {
      var ad = sh.getName();
      if (yerelAdlar[ad] || atla[ad] || ss.getSheets().length <= 1) return;
      try { ss.deleteSheet(sh); } catch (e) {}
    });
  });
  SpreadsheetApp.flush();
  props.setProperty("AYNA_HARITA", JSON.stringify(harita));

  // Şirket (çalışma yılı) listesi yerelle birebir: anahtar → ayna e-tablosu. Temel yıl "2026" yerelde de örtük (varsayılan kitaba düşer).
  var oz = veri.ozellikler || {};
  var yerelYil = {};
  try { yerelYil = JSON.parse(oz.YIL_SHEETLERI || "{}") || {}; } catch (e) { yerelYil = {}; }
  yerelYil[TEMEL_YIL_] = SHEET_ID_TEMEL_;
  var kitapIds = {}; (veri.kitaplar || []).forEach(function (k) { kitapIds[k.id] = true; });
  var yilHarita = {};
  Object.keys(yerelYil).forEach(function (y) {
    var kid = kitapIds[yerelYil[y]] ? yerelYil[y] : veri.varsayilanId;   // yerel sunucudaki çözümleme ile aynı
    if (harita[kid]) yilHarita[y] = harita[kid];
  });
  props.setProperty("AYNA_YIL_SHEETLERI", JSON.stringify(yilHarita));
  ["YIL_ETIKETLERI", "VARSAYILAN_YIL", "SIRKET_DUZENI_KURULDU"].forEach(function (a) {
    if (oz[a]) props.setProperty(a, String(oz[a])); else props.deleteProperty(a);
  });
  _YIL_KAYIT_ = null;
  Object.keys(yilHarita).forEach(function (y) { aktifYilAyarla_(y); veriSurumuArtir_(); });
  _AKTIF_YIL_ = null;
  return { yazilanSatir: yazilan, sayfa: sayfaSayisi, yeniDosya: yeniDosya, yil: Object.keys(yilHarita).sort(), sureSn: Math.round((Date.now() - t0) / 1000) };
}

function bulutAynaEsitle(zorla) {
  if (yerelMi_()) return { ok: false, hata: "Ayna yalnızca bulutta çalışır" };
  var props = PropertiesService.getScriptProperties();
  if (bulutYazmaAcikMi_()) return { ok: false, hata: "Bulut acil durum için yazmaya AÇIK; ayna durduruldu (acil kayıtlar ezilmesin). Önce kilitleyin." };
  try { kilitGetir_().waitLock(20000); } catch (e) { return { ok: false, hata: "Sistem meşgul, ayna sonra denenecek" }; }
  try {
    var t0 = Date.now();
    var okunan = aynaVeriOku_();
    if (!okunan) { props.setProperty("AYNA_HATA", "Tamamlanmış yerel yedek bulunamadı"); return { ok: false, hata: "Tamamlanmış yerel yedek bulunamadı (yerel sunucu henüz bulut yedeği göndermemiş olabilir)" }; }
    if (!zorla && props.getProperty("AYNA_SON_DAMGA") === okunan.damga) return { ok: true, degismedi: true, damga: okunan.damga };
    // ★ BOŞ/EKSİK YEDEK KORUMASI: yerelin gönderdiği kopya boş ya da bir öncekinin yarısından küçükse bulut e-tabloları o kopyayla EZİLMEZ.
    var kitapSay = (okunan.veri.kitaplar || []).length, satirSay = 0;
    (okunan.veri.kitaplar || []).forEach(function (k) { (k.sayfalar || []).forEach(function (sy) { satirSay += (sy.satirlar || []).length; }); });
    var oncekiSatir = parseInt(props.getProperty("AYNA_SON_SATIR") || "0", 10) || 0;
    if (kitapSay === 0 || satirSay === 0 || (oncekiSatir >= 200 && satirSay < oncekiSatir * 0.5)) {
      var neden = "Yerel yedek boş/eksik görünüyor (" + oncekiSatir + " → " + satirSay + " satır); ayna uygulanmadı, bulut verisi korundu";
      props.setProperty("AYNA_HATA", neden);
      return { ok: false, hata: neden };
    }
    var r = aynaUygula_(okunan.veri, t0);
    props.setProperty("AYNA_SON_SATIR", String(satirSay));
    props.setProperty("AYNA_SON_DAMGA", okunan.damga);
    props.setProperty("AYNA_SON_ZAMAN", Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"));
    props.setProperty("AYNA_HATA", "");
    r.ok = true; r.damga = okunan.damga;
    return r;
  } catch (e) {
    try { props.setProperty("AYNA_HATA", String(e && e.message || e).slice(0, 300)); } catch (x) {}
    return { ok: false, hata: "Ayna eşitleme hatası: " + (e && e.message || e) };
  } finally {
    try { kilitGetir_().releaseLock(); } catch (e2) {}
  }
}
function bulutAynaEsitleTetikleyici() { bulutAynaEsitle(false); }
function bulutAynaSimdi() { return bulutAynaEsitle(true); }
function bulutAynaKur() {
  if (yerelMi_()) return { ok: false, hata: "Yalnızca bulutta kurulur" };
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "bulutAynaEsitleTetikleyici") ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger("bulutAynaEsitleTetikleyici").timeBased().everyMinutes(5).create();
    return { ok: true };
  } catch (e) { return { ok: false, hata: "Tetikleyici kurulamadı: " + (e && e.message || e) }; }
}
function bulutAynaDurum_() {
  var p = PropertiesService.getScriptProperties();
  var kurulu = false;
  try { kurulu = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "bulutAynaEsitleTetikleyici"; }); } catch (e) {}
  return { aynaAktif: !!p.getProperty("AYNA_YIL_SHEETLERI"), aynaSon: p.getProperty("AYNA_SON_ZAMAN") || "", aynaYedekDamga: p.getProperty("AYNA_SON_DAMGA") || "", aynaHata: p.getProperty("AYNA_HATA") || "", aynaTetikleyici: kurulu };
}
