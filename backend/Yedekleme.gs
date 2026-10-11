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
