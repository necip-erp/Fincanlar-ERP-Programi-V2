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
  satisIadeler:     "SatisIadeler",
  satisIadeKalemleri:"SatisIadeKalemleri",
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
  krediKartHareketleri: "KrediKartHareketleri",
  posBankaAktarimlari: "PosBankaAktarimlari",
  stokHareketleri: "StokHareketleri",
  seriTanimlari: "SeriTanimlari",
  tedarikciCariEslesme: "TedarikciCariEslesme",
  edmOnekEslesme: "EdmOnekEslesme",
  tedarikciUrunKoduEslesme: "TedarikciUrunKoduEslesme",
  markalar: "Markalar",
  urunGruplari: "UrunGruplari",
  altUrunGruplari: "AltUrunGruplari",
  ebatlar: "Ebatlar",
  renkler: "Renkler",
  ambalajTanimlari: "AmbalajTanimlari",
  giderUstGruplari: "GiderUstGruplari",
  giderAltGruplari: "GiderAltGruplari",
  aciklamaSablonlari: "AciklamaSablonlari",
  cekSenetler: "CekSenetler",
  cekSenetHareketleri: "CekSenetHareketleri",
  cekSenetGorselleri: "CekSenetGorselleri",
  cekYapraklari: "CekYapraklari",
  silinenIslemler: "SilinenIslemler",
  alisFaturaDurum: "AlisFaturaDurum",
  siparisDurumlari: "SiparisDurumlari",
  plasiyerler: "Plasiyerler",
  cariVirmanlar: "CariVirmanlar",
  projeKodlari: "ProjeKodlari",
  faturaTipleri: "FaturaTipleri",
  virmanTipleri: "VirmanTipleri",
  kullanicilar: "Kullanicilar",
  oturumlar: "Oturumlar",
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
// Satış/Alış/Alış İade kalemlerinin stok kodu tutarlılığını doğrular.
// KÖK SORUN: stokGuncelMiktarHaritasi() boş STOK_ID'li hareketleri sessizce
// atlıyor (bkz. Code.gs ~3826), ve Stok Rehberi'nden seçim yapmak zorunlu
// değildi — kullanıcı ürün adını elle yazıp geçebiliyordu. Sonuç: StokHareketleri'ne
// doğru yazılan ama "Güncel Stok" rakamına hiç yansımayan sessiz kayıplar oluşuyordu.
// Bu fonksiyon her kalemin ya (a) gerçekten var olan bir Stok Koduna bağlı olmasını,
// ya da (b) kullanıcının bilerek "Stoksuz" işaretlediği bir hizmet/masraf kalemi
// olmasını zorunlu kılar — üçüncü bir sessiz seçenek bırakmaz.
function stokKoduHaritasiOlustur(ss) {
  const data = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR).getDataRange().getValues();
  const harita = {};
  for (let i = 1; i < data.length; i++) {
    const kod = String(data[i][1] || "").trim();
    if (kod) harita[kod] = String(data[i][0] || "");
  }
  return harita;
}

function kalemlerStokKoduDogrula(ss, kalemler) {
  const harita = stokKoduHaritasiOlustur(ss);
  for (const k of kalemler) {
    if (k.stoksuz) continue;
    // "Yeni stok kartı oluştur" işaretliyse bu kalem az sonra (kayıt akışı içinde)
    // otomatik olarak StokTanimlari'na eklenecek — henüz haritada olmaması normaldir.
    if (k.stokKartiOlustur && String(k.stokKodu || "").trim()) continue;
    const kod = String(k.stokKodu || "").trim();
    const urunAdi = String(k.urunAdi || "(adsız)");
    if (!kod) return "\"" + urunAdi + "\" kalemi için Stok Rehberi'nden bir Stok Kodu seçilmeli, ya da hizmet/masraf kalemiyse 'Stoksuz' işaretlenmeli.";
    if (!harita[kod]) return "\"" + urunAdi + "\" kalemindeki Stok Kodu (" + kod + ") tanımlı değil — Stok Rehberi'nden seçin.";
  }
  return null;
}

// ★ PARÇALI ÖNBELLEK (19 Eyl 2026): CacheService tek değer için ~100KB sınırı koyuyor; eskiden
// 95KB'ı aşan sonuçlar (kayıt sayısı büyüyen Stok/Cari/Satış listeleri gibi) HİÇ önbelleğe
// alınmıyor, her istekte tüm sayfalar yeniden okunuyordu. Artık büyük sonuçlar ~45K karakterlik
// parçalara bölünüp "anahtar#0", "anahtar#1"... altında saklanıyor, ana anahtar sadece bir
// işaretçi ("@@PARCALI@@:<parça sayısı>:<toplam uzunluk>") tutuyor. Okurken tüm parçalar eksiksiz
// ve toplam uzunluk tutarlıysa birleştirilir; herhangi biri eksik/uyumsuzsa (süresi dolmuş,
// eşzamanlı yazma vb.) sessizce "önbellekte yok" sayılıp yeniden hesaplanır.
const CACHE_PARCA_BOYUT_ = 45000;
const CACHE_PARCA_MAX_ = 60;
const CACHE_PARCA_ISARET_ = "@@PARCALI@@:";
// Bir anahtar temizlenince, ona BAĞLI türetilmiş sonuçların önbelleği de temizlenir.
const CACHE_BAGIMLI_ = {
  stokTanimListesi: ["bekleyenAlisFaturalari"],
  cariListesi_v3: ["bekleyenAlisFaturalari"],
  alisListesi: ["bekleyenAlisFaturalari"],
};

function cacheParcaliOku_(cache, mevcut) {
  const bilgi = mevcut.substring(CACHE_PARCA_ISARET_.length).split(":");
  const n = parseInt(bilgi[0], 10), toplam = parseInt(bilgi[1], 10);
  if (!(n > 0) || n > CACHE_PARCA_MAX_ || !(toplam > 0)) return null;
  return { n: n, toplam: toplam };
}

function cacheOkuVeyaHesapla(anahtar, saniyeTTL, hesaplaFn) {
  const cache = CacheService.getScriptCache();
  try {
    const mevcut = cache.get(anahtar);
    if (mevcut) {
      if (mevcut.indexOf(CACHE_PARCA_ISARET_) === 0) {
        const bilgi = cacheParcaliOku_(cache, mevcut);
        if (bilgi) {
          const anahtarlar = [];
          for (let i = 0; i < bilgi.n; i++) anahtarlar.push(anahtar + "#" + i);
          const parcalar = cache.getAll(anahtarlar);
          let birlesik = "", tamam = true;
          for (let i = 0; i < bilgi.n; i++) {
            const p = parcalar[anahtar + "#" + i];
            if (p === undefined || p === null) { tamam = false; break; }
            birlesik += p;
          }
          if (tamam && birlesik.length === bilgi.toplam) return JSON.parse(birlesik);
        }
        // parçalar eksik/uyumsuz → önbellekte yok say, aşağıda yeniden hesapla
      } else {
        return JSON.parse(mevcut);
      }
    }
  } catch (e) { /* önbellek okunamadıysa normal hesaplamaya devam */ }

  const sonuc = hesaplaFn();
  // Hata sonuçları (ok:false) asla önbelleğe yazılmaz — geçici bir hata kalıcı görünmesin.
  if (sonuc && sonuc.ok === false) return sonuc;
  try {
    const json = JSON.stringify(sonuc);
    if (json.length < 95000) {
      cache.put(anahtar, json, saniyeTTL);
    } else if (json.length <= CACHE_PARCA_BOYUT_ * CACHE_PARCA_MAX_) {
      const n = Math.ceil(json.length / CACHE_PARCA_BOYUT_);
      const koyulacak = {};
      for (let i = 0; i < n; i++) koyulacak[anahtar + "#" + i] = json.substr(i * CACHE_PARCA_BOYUT_, CACHE_PARCA_BOYUT_);
      koyulacak[anahtar] = CACHE_PARCA_ISARET_ + n + ":" + json.length;
      cache.putAll(koyulacak, saniyeTTL);
    }
  } catch (e) { /* JSON'a çevrilemedi veya önbelleğe yazılamadı — sorun değil */ }
  return sonuc;
}

function cacheTemizle(anahtarlar) {
  try {
    const tumu = [];
    const ekle = function (k) {
      tumu.push(k);
      for (let i = 0; i < CACHE_PARCA_MAX_; i++) tumu.push(k + "#" + i); // olası parçalar
    };
    (anahtarlar || []).forEach(function (k) {
      ekle(k);
      (CACHE_BAGIMLI_[k] || []).forEach(ekle);
    });
    // removeAll tek çağrıda en fazla 1000 anahtar alır — bölerek gönder.
    for (let i = 0; i < tumu.length; i += 900) {
      CacheService.getScriptCache().removeAll(tumu.slice(i, i + 900));
    }
  } catch (e) { /* yoksay */ }
}

// ════════════════════════════════════════════════
// SİLİNENLER (GERİ ALINABİLİR SİLME) — tüm modüllerde ortak kullanılan çöp kutusu.
// TASARIM: silme anında, o kaydı yeniden OLUŞTURMAK için gereken orijinal veri
// (save___ fonksiyonuna gönderilecek "body" ile aynı şekil) JSON olarak saklanır.
// "Geri Al" denince aynı save___ fonksiyonu tekrar çağrılır — yeni bir ID ile
// yeniden oluşturulur (cari/stok hareketleri dahil, save fonksiyonunun kendi
// mantığıyla en baştan ve doğru şekilde). Böylece restore mantığı her modül için
// ayrı ayrı yazılmak zorunda kalmaz; var olan (test edilmiş) save fonksiyonları
// yeniden kullanılır.
// ════════════════════════════════════════════════
const SILINEN_BASLIKLAR = ["ID","TIP","ORIJINAL_ID","BASLIK","CARI_AD","TUTAR","VERI_JSON","SILME_TARIHI","GERI_ALINDI","GERI_ALMA_TARIHI","YENI_ID","BELGE_NO"];

// belgeNo: Sipariş No / Fatura No gibi, kaydı tanımlayan görünür belge numarası
// (opsiyonel — her tür için bir tane olmayabilir).
// Bazı modüllerde (özellikle BFM'den onaylanan Alış faturaları) ACIKLAMA alanı
// "Fatura No: XYZ" biçiminde bir belge numarası taşır — silinenler kaydında
// bunu ayrı bir alan olarak (BELGE_NO) saklamak için ortak yardımcı.
function belgeNoAciklamadanCikar_(aciklama) {
  const m = String(aciklama || "").match(/Fatura No:\s*(\S+)/i);
  return m ? m[1] : "";
}

function silinenlerKaydet(tip, orijinalId, baslik, cariAd, tutar, veri, belgeNo) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.silinenIslemler, SILINEN_BASLIKLAR);
    const id = "sil_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    sheet.appendRow([id, tip, String(orijinalId || ""), baslik, cariAd || "", tutar || 0,
      JSON.stringify(veri || {}), Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"), false,
      "", "", String(belgeNo || "")]);
    cacheTemizle(["silinenlerListesi"]);
  } catch (e) { /* silinenler kaydı başarısız olsa bile asıl silme işlemi engellenmesin */ }
}

function getSilinenlerListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.silinenIslemler, SILINEN_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || row[8] === true || row[8] === "TRUE") continue;
    sonuc.push({
      id: String(row[0]), tip: String(row[1] || ""), orijinalId: String(row[2] || ""),
      baslik: String(row[3] || ""), cariAd: String(row[4] || ""), tutar: parseFloat(row[5]) || 0,
      silmeTarihi: String(row[7] || ""), belgeNo: String(row[11] || ""), veri: silinenVeriOku_(row),
    });
  }
  sonuc.reverse();
  return { ok: true, silinenler: sonuc };
}

// VERI_JSON hücresini güvenle objeye çevirir — bozuk/okunamaz JSON varsa boş obje döner
// (detay görüntüleme çökmesin diye).
function silinenVeriOku_(row) {
  try { return JSON.parse(String(row[6] || "{}")) || {}; } catch (e) { return {}; }
}

// Bir "Silinenler" kaydını geri getirilemez şekilde listeden kaldırır (ör. geri alma
// başarılı olduktan sonra, ya da kullanıcı "listeden temizle" derse). Geri alma tarihini
// ve yeniden oluşturulan kaydın YENİ ID'sini de yazar — bu sayede "Geri Döndürülenler"
// bölümünde hangi kaydın ne zaman ve hangi yeni numarayla geri geldiği görülebilir.
function silinenKaydiKapat_(id, yeniId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.silinenIslemler, SILINEN_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
      sheet.getRange(i + 1, 9, 1, 3).setValues([[true, simdi, String(yeniId || "")]]);
      return true;
    }
  }
  return false;
}

// "Silinenler" listesinin tam tersi: daha önce silinip GERİ ALINMIŞ kayıtların geçmişi
// (audit izi). Kullanıcı bir siparişin/kaydın geçmişte silinip sonra geri getirildiğini
// buradan görebilir. En son geri alınan en üstte.
function getGeriDondurulenlerListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.silinenIslemler, SILINEN_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || !(row[8] === true || row[8] === "TRUE")) continue;
    sonuc.push({
      id: String(row[0]), tip: String(row[1] || ""), orijinalId: String(row[2] || ""),
      baslik: String(row[3] || ""), cariAd: String(row[4] || ""), tutar: parseFloat(row[5]) || 0,
      silmeTarihi: String(row[7] || ""), geriAlmaTarihi: String(row[9] || ""), yeniId: String(row[10] || ""),
      belgeNo: String(row[11] || ""), veri: silinenVeriOku_(row),
    });
  }
  sonuc.reverse();
  return { ok: true, kayitlar: sonuc };
}

// body: { id } — Silinenler listesindeki bir kaydı, orijinal save___ fonksiyonunu
// aynı veriyle tekrar çağırarak geri getirir.
function silinenGeriAl(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.silinenIslemler, SILINEN_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let tip = "", veriJson = "", zatenGeriAlinmis = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      tip = String(data[i][1] || "");
      veriJson = String(data[i][6] || "");
      zatenGeriAlinmis = (data[i][8] === true || data[i][8] === "TRUE");
      break;
    }
  }
  if (!tip) return { ok: false, hata: "Kayıt bulunamadı" };
  if (zatenGeriAlinmis) return { ok: false, hata: "Bu kayıt zaten geri alınmış" };

  let veri;
  try { veri = JSON.parse(veriJson); } catch (e) { return { ok: false, hata: "Kayıt verisi okunamadı" }; }

  const GERI_YUKLEME_FN = {
    TAHSILAT: saveTahsilat, ODEME: saveOdeme, SATIS: saveSatis, ALIS: saveAlis,
    ALISIADE: saveAlisIade, SATISIADE: saveSatisIade, CEKSENET: saveCekSenet,
    VIRMAN: saveCariVirman,
  };
  const fn = GERI_YUKLEME_FN[tip];
  if (!fn) return { ok: false, hata: "Bu kayıt türü için geri alma henüz desteklenmiyor" };

  const sonuc = fn(veri);
  if (!sonuc || !sonuc.ok) return { ok: false, hata: "Geri yükleme başarısız: " + (sonuc && sonuc.hata || "bilinmiyor") };

  silinenKaydiKapat_(id, sonuc.id);
  return { ok: true, yeniId: sonuc.id };
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

// EDM/e-fatura entegrasyonuyla YANLIŞLIKLA bağlantı kurulmasını önlemek için:
// carinin GİB nezdinde e-Fatura mükellefi olup olmadığı. STANDART DEĞER "Hayır" —
// bir cari için bu alan "Hayır" olduğu sürece BFM/EDM eşleştirme akışlarına HİÇBİR
// ŞEKİLDE dahil edilmemelidir (bkz. edmBaglantisiVarMi()).
function ensureCariEFaturaColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 12).getValue();
  if (String(mevcutBaslik || "") !== "E_FATURA") {
    sheet.getRange(1, 12).setValue("E_FATURA").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Carinin e-Arşiv mükellefi olup olmadığı (e-Fatura'ya kayıtlı DEĞİLSE e-Arşiv
// kullanılır). STANDART DEĞER "Hayır" — bkz. ensureCariEFaturaColonu üstteki not.
function ensureCariEArsivColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 13).getValue();
  if (String(mevcutBaslik || "") !== "E_ARSIV") {
    sheet.getRange(1, 13).setValue("E_ARSIV").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Cariye atanan plasiyer (Plasiyerler tanım tablosundaki ID). Ayarlar > Plasiyer
// Tanımlama'da yönetilir.
function ensureCariPlasiyerColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 14).getValue();
  if (String(mevcutBaslik || "") !== "PLASIYER_ID") {
    sheet.getRange(1, 14).setValue("PLASIYER_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// PERF: yukarıdaki 6 ensureCari*Colonu fonksiyonunu tek tek çağırmak yerine (her biri
// ayrı bir getRange(1,N).getValue() çağrısı = 6 ayrı Sheets servis isteği), başlık
// satırının 9-14. kolonlarını TEK okuma ile alıp sadece eksik olanları tek seferde yazar.
// Davranış aynı; sadece Cari sayfası açılışında (liste/detay/kayıt) daha az servis çağrısı.
function ensureCariEkKolonlariHepsi(sheet) {
  const beklenen = ["CARI_KODU", "ISKONTO_ORANI", "KREDI_LIMITI", "E_FATURA", "E_ARSIV", "PLASIYER_ID"];
  const mevcut = sheet.getRange(1, 9, 1, 6).getValues()[0];
  let degisti = false;
  const yeni = beklenen.map((ad, i) => {
    if (String(mevcut[i] || "") !== ad) { degisti = true; return ad; }
    return mevcut[i];
  });
  if (degisti) {
    sheet.getRange(1, 9, 1, 6).setValues([yeni]).setFontWeight("bold").setBackground("#e8edf5");
  }
}

// EDM/e-fatura ile ilgili HERHANGİ bir işlem (BFM eşleştirme, otomatik fatura
// gönderimi vb.) öncesinde bu fonksiyonla kontrol edilmeli. Cari E_FATURA veya
// E_ARSIV alanlarından biri "Evet" değilse (yani ikisi de "Hayır"/boşsa) EDM
// bağlantısı KURULMAMALIDIR.
function edmBaglantisiVarMi(cari) {
  if (!cari) return false;
  return String(cari.eFatura || "") === "Evet" || String(cari.eArsiv || "") === "Evet";
}

// Stok kodu, Alış/Satış/Sipariş kalemleri arasındaki ana bağlantı — ürün adı yerine
// stok koduyla eşleştirme yapılabilmesi için AlisKalemleri'ne bu kolonu ekler.
function ensureAlisKalemStokKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 8).getValue();
  if (String(mevcutBaslik || "") !== "STOK_KODU") {
    sheet.getRange(1, 8).setValue("STOK_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Alış İadesi kalemlerinde STOK_KODU (8. kolon) — önceden bu tablonun şemasında hiç
// yoktu, ön yüz de Stok Rehberi'nden seçilse dahi bu alanı hiç doldurmuyordu. Sonuç:
// HER Alış İadesi otomatik olarak boş stok koduyla StokHareketleri'ne yazılıyor, bu da
// stokGuncelMiktarHaritasi() tarafından sessizce atlanıp "Güncel Stok" hiç düşmüyordu
// (tedarikçiye iade edilen mal sistemde hâlâ depodaymış gibi görünmeye devam ediyordu).
function ensureAlisIadeKalemStokKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 8).getValue();
  if (String(mevcutBaslik || "") !== "STOK_KODU") {
    sheet.getRange(1, 8).setValue("STOK_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Alış kalemlerinde KDV oranı (9. kolon). Eskiden Alış modülünde KDV hiç
// izlenmiyordu; BIRIM_FIYAT ve TUTAR her zaman KDV HARİÇ tutuluyordu — ama Bekleyen
// Alış Faturaları (BFM) onay ekranı kullanıcıya KDV DAHİL bir "Genel Toplam" gösterip,
// onaylayınca arkada KDV'siz tutarı kaydediyordu (kullanıcı bildirimi: "toplam tutarı
// sisteme kdv siz olarak attı"). Artık TUTAR ve toplamTutar (dolayısıyla Cari Alacak)
// KDV DAHİL hesaplanıyor; BIRIM_FIYAT hâlâ KDV HARİÇ birim maliyeti temsil ediyor.
function ensureAlisKalemKdvColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "KDV_ORANI") {
    sheet.getRange(1, 9).setValue("KDV_ORANI").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// BRUT_FIYAT (10. kolon, iskonto uygulanmadan önceki liste fiyatı) ve ISKONTO_YUZDE
// (11. kolon, satır düzeyi indirim %) — sadece "fatura altı" Brüt Toplam/İskonto
// gösterimi için bilgi amaçlı tutulur; BIRIM_FIYAT (net, KDV hariç maliyet) hesaplarda
// hâlâ tek kaynak, bu ikisi ona dokunmaz. BFM'den gelen kalemlerde gerçek değerle
// doldurulur; manuel girişte brütFiyat=birimFiyat, iskonto=0 (indirim kavramı yok).
function ensureAlisKalemBrutIskontoColonlari(sheet) {
  const h10 = sheet.getRange(1, 10).getValue();
  if (String(h10 || "") !== "BRUT_FIYAT") {
    sheet.getRange(1, 10).setValue("BRUT_FIYAT").setFontWeight("bold").setBackground("#e8edf5");
  }
  const h11 = sheet.getRange(1, 11).getValue();
  if (String(h11 || "") !== "ISKONTO_YUZDE") {
    sheet.getRange(1, 11).setValue("ISKONTO_YUZDE").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// Alışlar sayfasında belge düzeyi (fatura altı) manuel ek indirim tutarı — Satış
// modülündeki "Tutar İskontosu" ile aynı fikir, Alış tarafında da istendi.
function ensureAlisTutarIskontosuColonu(sheet) {
  const h9 = sheet.getRange(1, 9).getValue();
  if (String(h9 || "") !== "TUTAR_ISKONTOSU") {
    sheet.getRange(1, 9).setValue("TUTAR_ISKONTOSU").setFontWeight("bold").setBackground("#e8edf5");
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

// Proje Kodu: Alış/Satış faturaları ve Çek/Senet girişlerinde isteğe bağlı olarak
// girilebilen bir etiket — hangi işin/projenin harcaması veya tahsilatı olduğunu
// takip etmek için. cariHareketEkle üzerinden merkezi olarak CariHareketler'e de
// yazılır ki Cari raporunda proje koduna göre filtrelenebilsin.
function ensureCariHareketProjeKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 9).getValue();
  if (String(mevcutBaslik || "") !== "PROJE_KODU") {
    sheet.getRange(1, 9).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 9);
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

// Google E-Tablo, hücreye yazılan "00", "01", "1-2" gibi sayı/tarih benzeri METİNLERİ
// kendiliğinden sayıya/tarihe çevirir ("00" → 0, "01" → 1). Sonra `String(deger || "")`
// ile okunduğunda 0 değeri "boş" sayılıp kaybolur. Proje Kodu / Fatura Tipi / tanım
// adı-kodu gibi KOD niteliğindeki sütunlar bu yüzden METİN biçimine (@) alınır; böylece
// hem appendRow hem satır-geri-yazan setValues çağrıları yazılanı AYNEN saklar.
// Sütun başına 6 saatte bir uygulanır (önbellek bayrağı) — her okuma/yazmada API çağrısı yapmaz.
function metinKolonuGarantiEt_(sheet, kolon) {
  try {
    const cache = CacheService.getScriptCache();
    const anahtar = "metinKol_" + sheet.getSheetId() + "_" + kolon;
    if (cache.get(anahtar)) return;
    sheet.getRange(2, kolon, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
    cache.put(anahtar, "1", 21600);
  } catch (e) { /* biçim ayarlanamadıysa yazma/okuma yine de devam eder */ }
}

// Bir değer E-Tablo tarafından sayıya/tarihe çevrilebilecek kadar "sayı benzeri" mi?
// ("00", "01", "1-2", "3/4", "1.5" ...) — sadece bu durumda özel metin yazımı gerekir.
function sayiBenzeriMi_(deger) {
  const m = String(deger === null || deger === undefined ? "" : deger).trim();
  return m !== "" && /\d/.test(m) && /^[0-9eE.,\-\/:+\s]+$/.test(m);
}

// appendRow yerine: appendRow, sütun biçimini (@) her zaman dikkate ALMAYIP "00" → 0
// çevirmesini engelleyemeyebilir. Bu yardımcı, metin sütunlarından biri sayı benzeri bir
// değer taşıyorsa hedef hücrelerin biçimini yazmadan HEMEN önce METİN (@) yapıp değeri
// öyle yazar (kesin sonuç); değilse eski hızlı yolla (appendRow) devam eder.
// metinKolonlari: 1 tabanlı sütun numaraları. Yarış durumuna karşı kilit altında çalışır.
function metinliSatirEkle_(sheet, degerler, metinKolonlari) {
  const gerekli = (metinKolonlari || []).some(k => sayiBenzeriMi_(degerler[k - 1]));
  if (!gerekli) { sheet.appendRow(degerler); return; }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const hedef = sheet.getLastRow() + 1;
    if (hedef > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    metinliSatirYaz_(sheet, hedef, degerler, metinKolonlari);
  } finally {
    lock.releaseLock();
  }
}

// Var olan bir satırı geri yazar; sayı benzeri metin sütunlarının biçimini önce @ yapar.
function metinliSatirYaz_(sheet, satir, degerler, metinKolonlari) {
  (metinKolonlari || []).forEach(k => {
    if (k <= degerler.length && sayiBenzeriMi_(degerler[k - 1])) sheet.getRange(satir, k).setNumberFormat("@");
  });
  sheet.getRange(satir, 1, 1, degerler.length).setValues([degerler]);
}

// Hücre değerini METİN olarak okur. 0 sayısını "" yapmaz (`deger || ""` kalıbı yapıyordu).
// Eski (biçim düzeltmesinden önce yazılmış) kayıtlarda baştaki sıfırlar zaten sayıya
// çevrilip kaybolmuş olabilir — orijinali geri getirilemez, en azından boş görünmez.
// haneSayisi verilirse (örn. 2 haneli KOD) sayısal eski değerler soldan sıfırla tamamlanır.
function metinOku_(deger, haneSayisi) {
  if (deger === null || deger === undefined || deger === "") return "";
  if (deger instanceof Date) return hucreTarihStr(deger);
  const m = String(deger);
  if (haneSayisi && typeof deger === "number") return m.padStart(haneSayisi, "0");
  return m;
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
  "satisiade": "Satış İadesi",
  "tahsilat_Nakit": "Nakit Tahsilat",
  "tahsilat_Havale/EFT": "Havale/EFT Tahsilat",
  "tahsilat_Kredi Kartı": "Kredi Kartı Tahsilat",
  "tahsilat_Çek": "Çek Tahsilat",
  "odeme_Nakit": "Nakit Ödeme",
  "odeme_Havale/EFT": "Havale/EFT Ödeme",
  "odeme_Kredi Kartı": "Kredi Kartı Ödeme",
  "odeme_Çek": "Çek Ödeme",
  "odeme_hedefBankaHesap": "Banka Hesabına Aktarım",
  "odeme_hedefKrediKarti": "Kredi Kartı Borç Ödemesi",
  "cek_alinan": "Alınan Çek/Senet",
  "cek_verilen": "Verilen Çek/Senet",
  "cek_ciro": "Çek Cirosu",
  "posBankaAktarim": "POS'tan Bankaya Aktarım",
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

// ════════════════════════════════════════════════
// KULLANICI GİRİŞİ VE OTURUM YÖNETİMİ
// Basit, sheet-tabanlı bir giriş sistemi: parolalar SHA-256 ile hashlenip
// Kullanicilar sayfasında, oturumlar (token → kullanıcı) Oturumlar sayfasında
// tutulur. Web app linki herkese açık kaldığı için (appsscript.json:
// ANYONE_ANONYMOUS) bu, "linki bilen herkes girsin" yerine "sadece 3 tanımlı
// kullanıcı, kendi parolasıyla girsin" seviyesinde bir koruma sağlar —
// bankacılık düzeyinde güvenlik hedeflenmemiştir, amaç kimin ne yaptığını
// ayırt edebilmek ve rastgele erişimi engellemektir.
// ════════════════════════════════════════════════
const KULLANICI_BASLIKLAR = ["ID","KULLANICI_ADI","PAROLA_HASH","ROL","AKTIF","KAYIT_TARIHI"];
const OTURUM_BASLIKLAR = ["TOKEN","KULLANICI_ID","KULLANICI_ADI","ROL","OLUSTURMA_TARIHI"];
const OTURUM_SURESI_SAAT = 12;
const VARSAYILAN_KULLANICILAR = [
  { ad: "Necip",  rol: "Admin" },
  { ad: "Fatih",  rol: "Standart" },
  { ad: "Furkan", rol: "Standart" },
];

function sha256Hex_(metin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, metin, Utilities.Charset.UTF_8);
  return bytes.map(b => (("0" + (b & 0xFF).toString(16)).slice(-2))).join("");
}

// Sayfa yoksa oluşturur VE ilk seferde 3 varsayılan kullanıcıyı (parola =
// kullanıcı adının kendisi) otomatik ekler. Sonraki her çağrıda sadece mevcut
// sayfayı döndürür — burada eklenen kullanıcılar tekrar tekrar eklenmez.
function kullanicilarSheetHazirla_(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.kullanicilar, KULLANICI_BASLIKLAR);
  if (sheet.getLastRow() < 2) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (sheet.getLastRow() < 2) { // lock sonrası tekrar kontrol (yarış durumu)
        const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
        VARSAYILAN_KULLANICILAR.forEach((k, i) => {
          sheet.appendRow(["kul_" + (Date.now() + i), k.ad, sha256Hex_(k.ad), k.rol, "Evet", simdi]);
        });
      }
    } finally { lock.releaseLock(); }
  }
  return sheet;
}

function kullaniciSatirlariniOku_(ss) {
  const sheet = kullanicilarSheetHazirla_(ss);
  const data = sheet.getDataRange().getValues();
  const satirlar = [];
  for (let i = 1; i < data.length; i++) {
    satirlar.push({
      rowIdx: i + 1,
      id: String(data[i][0]),
      kullaniciAdi: String(data[i][1]),
      parolaHash: String(data[i][2]),
      rol: String(data[i][3]),
      aktif: String(data[i][4]) === "Evet",
    });
  }
  return { sheet, satirlar };
}

function girisYap(body) {
  const kullaniciAdi = String(body.kullaniciAdi || "").trim();
  const parola = String(body.parola || "");
  if (!kullaniciAdi || !parola) return { ok: false, hata: "Kullanıcı adı ve parola gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.kullaniciAdi.toLowerCase() === kullaniciAdi.toLowerCase());

  // Kullanıcı bulunamadı / pasif / parola yanlış — hangisi olduğunu belli etmeden
  // aynı genel mesaj döndürülür (kullanıcı adı denemesini kolaylaştırmamak için).
  if (!kullanici || !kullanici.aktif || kullanici.parolaHash !== sha256Hex_(parola)) {
    return { ok: false, hata: "Kullanıcı adı veya parola hatalı" };
  }

  const token = Utilities.getUuid();
  const oturumSheet = getOrCreateSheet(ss, SHEETS.oturumlar, OTURUM_BASLIKLAR);
  oturumSheet.appendRow([token, kullanici.id, kullanici.kullaniciAdi, kullanici.rol, String(Date.now())]);
  oturumlarTemizle_(oturumSheet);

  return { ok: true, token: token, kullaniciAdi: kullanici.kullaniciAdi, rol: kullanici.rol };
}

// Süresi dolmuş oturum satırlarını sayfadan temizler (sayfa sınırsız büyümesin diye).
// Az sayıda kullanıcı/oturum olduğu için basit bir tam-tarama yeterli.
function oturumlarTemizle_(oturumSheet) {
  try {
    const data = oturumSheet.getDataRange().getValues();
    const simdi = Date.now();
    const sinirMs = OTURUM_SURESI_SAAT * 3600 * 1000;
    for (let i = data.length - 1; i >= 1; i--) {
      const olusturma = Number(data[i][4]) || 0;
      if (simdi - olusturma > sinirMs) oturumSheet.deleteRow(i + 1);
    }
  } catch (e) { /* temizlik başarısız olsa da girişi engellemesin */ }
}

// token geçerliyse {kullaniciId, kullaniciAdi, rol} döner, değilse null.
function oturumDogrula_(ss, token) {
  if (!token) return null;
  const oturumSheet = getOrCreateSheet(ss, SHEETS.oturumlar, OTURUM_BASLIKLAR);
  const data = oturumSheet.getDataRange().getValues();
  const simdi = Date.now();
  const sinirMs = OTURUM_SURESI_SAAT * 3600 * 1000;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === token) {
      const olusturma = Number(data[i][4]) || 0;
      if (simdi - olusturma > sinirMs) {
        oturumSheet.deleteRow(i + 1);
        return null;
      }
      return { kullaniciId: String(data[i][1]), kullaniciAdi: String(data[i][2]), rol: String(data[i][3]) };
    }
  }
  return null;
}

function cikisYap(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oturumSheet = getOrCreateSheet(ss, SHEETS.oturumlar, OTURUM_BASLIKLAR);
  const data = oturumSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.token)) { oturumSheet.deleteRow(i + 1); break; }
  }
  return { ok: true };
}

function parolaDegistir(body, oturum) {
  const eskiParola = String(body.eskiParola || "");
  const yeniParola = String(body.yeniParola || "");
  if (!yeniParola || yeniParola.length < 3) return { ok: false, hata: "Yeni parola en az 3 karakter olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.id === oturum.kullaniciId);
  if (!kullanici) return { ok: false, hata: "Kullanıcı bulunamadı" };
  if (kullanici.parolaHash !== sha256Hex_(eskiParola)) return { ok: false, hata: "Mevcut parola yanlış" };

  sheet.getRange(kullanici.rowIdx, 3).setValue(sha256Hex_(yeniParola));
  return { ok: true };
}

// ── Aşağıdaki kullaniciXxx fonksiyonları SADECE Admin rolündeki kullanıcı
// tarafından çağrılabilir; kontrol handleRequest içinde yapılır. ──
function kullaniciListesiGetir() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { satirlar } = kullaniciSatirlariniOku_(ss);
  // PAROLA_HASH asla frontend'e gönderilmez.
  return { ok: true, liste: satirlar.map(k => ({ id: k.id, kullaniciAdi: k.kullaniciAdi, rol: k.rol, aktif: k.aktif })) };
}

function kullaniciEkle(body) {
  const kullaniciAdi = String(body.kullaniciAdi || "").trim();
  const rol = String(body.rol) === "Admin" ? "Admin" : "Standart";
  if (!kullaniciAdi) return { ok: false, hata: "Kullanıcı adı gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  if (satirlar.some(k => k.kullaniciAdi.toLowerCase() === kullaniciAdi.toLowerCase())) {
    return { ok: false, hata: "Bu kullanıcı adı zaten kayıtlı" };
  }
  const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const id = "kul_" + Date.now();
  sheet.appendRow([id, kullaniciAdi, sha256Hex_(kullaniciAdi), rol, "Evet", simdi]);
  return { ok: true, id: id };
}

function kullaniciDurumGuncelle(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.id === String(body.kullaniciId));
  if (!kullanici) return { ok: false, hata: "Kullanıcı bulunamadı" };

  const yeniAktif = body.aktif === true || body.aktif === "Evet";
  if (!yeniAktif) {
    const aktifAdminSayisi = satirlar.filter(k => k.rol === "Admin" && k.aktif).length;
    if (kullanici.rol === "Admin" && aktifAdminSayisi <= 1) {
      return { ok: false, hata: "Tek aktif Admin pasifleştirilemez — önce başka bir kullanıcıyı Admin yapın" };
    }
  }
  sheet.getRange(kullanici.rowIdx, 5).setValue(yeniAktif ? "Evet" : "Hayır");
  return { ok: true };
}

function kullaniciRolGuncelle(body) {
  const yeniRol = String(body.rol) === "Admin" ? "Admin" : "Standart";
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.id === String(body.kullaniciId));
  if (!kullanici) return { ok: false, hata: "Kullanıcı bulunamadı" };

  if (kullanici.rol === "Admin" && yeniRol !== "Admin") {
    const aktifAdminSayisi = satirlar.filter(k => k.rol === "Admin" && k.aktif).length;
    if (aktifAdminSayisi <= 1) return { ok: false, hata: "Tek Admin'in rolü düşürülemez — önce başka bir kullanıcıyı Admin yapın" };
  }
  sheet.getRange(kullanici.rowIdx, 4).setValue(yeniRol);
  return { ok: true };
}

// Parolayı kullanıcı adına sıfırlar — kullanıcı parolasını unuttuğunda Admin bu
// butonu kullanır, kullanıcı bir dahaki girişte "Parolamı Değiştir" ile kendine
// yeni bir parola belirleyebilir.
function kullaniciParolaSifirla(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.id === String(body.kullaniciId));
  if (!kullanici) return { ok: false, hata: "Kullanıcı bulunamadı" };
  sheet.getRange(kullanici.rowIdx, 3).setValue(sha256Hex_(kullanici.kullaniciAdi));
  return { ok: true };
}

function kullaniciSil(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { sheet, satirlar } = kullaniciSatirlariniOku_(ss);
  const kullanici = satirlar.find(k => k.id === String(body.kullaniciId));
  if (!kullanici) return { ok: false, hata: "Kullanıcı bulunamadı" };

  if (kullanici.rol === "Admin") {
    const aktifAdminSayisi = satirlar.filter(k => k.rol === "Admin" && k.aktif).length;
    if (aktifAdminSayisi <= 1) return { ok: false, hata: "Tek Admin silinemez — önce başka bir kullanıcıyı Admin yapın" };
  }
  sheet.deleteRow(kullanici.rowIdx);
  return { ok: true };
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

// Bu action'lar oturum/token gerektirmeden çalışır (login ekranı henüz token
// almadan bunlara ihtiyaç duyar).
const OTURUMSUZ_ACTIONLAR = { girisYap: true };
// Bu action'lar sadece Admin rolündeki kullanıcı tarafından çalıştırılabilir.
const ADMIN_ACTIONLAR = {
  kullaniciListesiGetir: true, kullaniciEkle: true, kullaniciDurumGuncelle: true,
  kullaniciRolGuncelle: true, kullaniciParolaSifirla: true, kullaniciSil: true,
  getKayitDefteri: true, getKayitDefteriKontrol: true, kayitDefteriBaslat: true, kayitDefteriTutarKoduDuzelt: true, kayitDefteriHatalariTemizle: true, nakliyeSorunluFaturalar: true, nakliyeSorunluFaturalariSil: true, // Kayıt Defteri: sadece Admin
};

function handleRequest(e) {
  try {
    const body = e.postData ? JSON.parse(e.postData.contents) : e.parameter;
    const action = body.action;
    let result;
    let oturum = null;
    if (!OTURUMSUZ_ACTIONLAR[action]) {
      oturum = oturumDogrula_(SpreadsheetApp.openById(SHEET_ID), body.token);
      if (!oturum) {
        return jsonResponse({ ok: false, oturumGecersiz: true, hata: "Oturum bulunamadı veya süresi doldu, lütfen tekrar giriş yapın." });
      }
      if (ADMIN_ACTIONLAR[action] && oturum.rol !== "Admin") {
        return jsonResponse({ ok: false, hata: "Bu işlem sadece Admin yetkisiyle yapılabilir." });
      }
    }
    if (KD_ACTIONLAR[action]) kdToplayiciBaslat_(); // Kayıt Defteri: bu işlemde oluşan karşı kayıtları topla
    switch (action) {
      case "girisYap":        result = girisYap(body); break;
      case "cikisYap":        result = cikisYap(body); break;
      case "parolaDegistir":  result = parolaDegistir(body, oturum); break;
      case "kullaniciListesiGetir": result = kullaniciListesiGetir(); break;
      case "kullaniciEkle":         result = kullaniciEkle(body); break;
      case "kullaniciDurumGuncelle":result = kullaniciDurumGuncelle(body); break;
      case "kullaniciRolGuncelle":  result = kullaniciRolGuncelle(body); break;
      case "kullaniciParolaSifirla":result = kullaniciParolaSifirla(body); break;
      case "kullaniciSil":          result = kullaniciSil(body); break;
      case "getCariListesi": result = getCariListesi(); break;
      case "getCariDetay":   result = getCariDetay(body.cariId); break;
      case "saveCari":       result = saveCari(body); break;
      case "silCari":        result = silCari(body); break;
      case "cariHareketEkle": result = cariHareketEkle(body); break;
      case "cariHareketSil":  result = cariHareketSil(body); break;
      case "getSatisListesi": result = getSatisListesi(); break;
      case "getSatisDetay":   result = getSatisDetay(body.satisId); break;
      case "saveSatis":       result = saveSatis(body); break;
      case "updateSatis":     result = updateSatis(body); break;
      case "silSatis":        result = silSatis(body); break;
      case "getAlisListesi":  result = getAlisListesi(); break;
      case "getAlisDetay":    result = getAlisDetay(body.alisId); break;
      case "saveAlis":        result = saveAlis(body); break;
      case "updateAlis":      result = updateAlis(body); break;
      case "siparistenFaturaOlustur": result = siparistenFaturaOlustur(body); break;
      case "siparisDurumGuncelle": result = siparisDurumGuncelle(body); break;
      case "getCariSiparisListesi": result = getCariSiparisListesi(body.cariId); break;
      case "silAlis":         result = silAlis(body); break;
      case "tumAlislariSilVeSifirla": result = tumAlislariSilVeSifirla(body); break;
      case "getAlisIadeListesi": result = getAlisIadeListesi(); break;
      case "getAlisIadeDetay":   result = getAlisIadeDetay(body.iadeId); break;
      case "saveAlisIade":       result = saveAlisIade(body); break;
      case "silAlisIade":        result = silAlisIade(body); break;
      case "getSatisIadeListesi": result = getSatisIadeListesi(); break;
      case "getSatisIadeDetay":   result = getSatisIadeDetay(body.iadeId); break;
      case "saveSatisIade":       result = saveSatisIade(body); break;
      case "silSatisIade":        result = silSatisIade(body); break;
      case "getTahsilatListesi": result = getTahsilatListesi(); break;
      case "saveTahsilat":       result = saveTahsilat(body); break;
      case "guncelleTahsilat":   result = guncelleTahsilat(body); break;
      case "silTahsilat":        result = silTahsilat(body); break;
      case "getOdemeListesi": result = getOdemeListesi(); break;
      case "saveOdeme":       result = saveOdeme(body); break;
      case "silOdeme":        result = silOdeme(body); break;
      case "getFinansOzet":   result = getFinansOzet(); break;
      case "getBugunOzet":    result = getBugunOzet(); break;
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
      case "getStokPanelSnapshot": result = getStokPanelSnapshot(); break;
      case "saveStokTanim":       result = saveStokTanim(body); break;
      case "stokKoduOner":        result = stokKoduOner(body); break;
      case "stokKoduDegistir":    result = stokKoduDegistir(body); break;
      case "saveStokTanimTopluce": result = saveStokTanimTopluce(body); break;
      case "silStokTanim":        result = silStokTanim(body); break;
      case "stokTanimMarkaKoduIsleToplu": result = stokTanimMarkaKoduIsleToplu(); break;
      case "getUrunFiyatGecmisi": result = getUrunFiyatGecmisi(body.urunAdi); break;
      case "getBirimListesi": result = getBirimListesi(); break;
      case "saveBirim":       result = saveBirim(body); break;
      case "silBirim":        result = silBirim(body); break;
      case "getPosHareketleri": result = getPosHareketleri(body.posHesapId); break;
      case "getBankaHesapHareketleri": result = getBankaHesapHareketleri(body.bankaHesapId); break;
      case "getKrediKartHareketleri": result = getKrediKartHareketleri(body.krediKartId); break;
      case "getPosBankaAktarimListesi": result = getPosBankaAktarimListesi(body.posHesapId); break;
      case "savePosBankaAktarim": result = savePosBankaAktarim(body); break;
      case "silPosBankaAktarim": result = silPosBankaAktarim(body); break;
      case "getMuhasebeRaporu": result = getMuhasebeRaporu(body); break;
      case "getStokHareketListesi": result = getStokHareketListesi(body); break;
      case "getStokHareketPenceresi": result = getStokHareketPenceresi(body); break;
      case "getAlisKdvGecmisListesi": result = getAlisKdvGecmisListesi(); break;
      case "getEdmPortalGirisLinki": result = getEdmPortalGirisLinki(); break;
      case "getSonIslemler": result = getSonIslemler(body); break;
      case "gunlukIslemRaporuUret": result = gunlukIslemRaporuUret(body); break;
      case "stokHareketGecmisiDoldur": result = stokHareketGecmisiDoldur(); break;
      case "cariHareketGecmisiDoldur": result = cariHareketGecmisiDoldur(); break;
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
      case "getPlasiyerListesi": result = getPlasiyerListesi(); break;
      case "savePlasiyer":       result = savePlasiyer(body); break;
      case "silPlasiyer":        result = silPlasiyer(body); break;
      case "plasiyerSiraGuncelle": result = plasiyerSiraGuncelle(body); break;
      case "edmCariSorgula":  result = edmCariSorgula(body); break;
      case "edmFaturaGonderTest": result = edmFaturaGonderTest(body); break;
      case "getSatisEfaturaGorsel": result = satisEfaturaGorselAl(body); break;
      case "edmFaturaDurumSorgula": result = edmFaturaDurumSorgula(body); break;
      case "birimSiraGuncelle":     result = birimSiraGuncelle(body); break;
      case "basitTanimSiraGuncelle": result = basitTanimSiraGuncelle(body); break;
      case "markaSiraGuncelle":     result = markaSiraGuncelle(body); break;
      case "getAciklamaSablonlari":  result = getAciklamaSablonlari(); break;
      case "saveAciklamaSablonlari": result = saveAciklamaSablonlari(body); break;
      case "getKritikStokListesi": result = getKritikStokListesi(); break;
      case "vadesiGecmisAlacaklar": result = vadesiGecmisAlacaklar(); break;
      case "getCekSenetListesi": result = getCekSenetListesi(); break;
      case "getCariCekSenetListesi": result = getCariCekSenetListesi(body.cariId); break;
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
      case "cekSenetHareketGeriAl": result = cekSenetHareketGeriAl(body); break;
      case "cekSenetGorselYukle":  result = cekSenetGorselYukle(body); break;
      case "getCekSenetGorselleri": result = getCekSenetGorselleri(body.cekId); break;
      case "getCekYapraklari":      result = getCekYapraklari(body); break;
      case "saveCekKocani":         result = saveCekKocani(body); break;
      case "silCekYaprak":          result = silCekYaprak(body); break;
      case "cekYaprakDurumGuncelle": result = cekYaprakDurumGuncelle(body); break;
      case "silCekSenetGorseli":   result = silCekSenetGorseli(body); break;
      case "getSilinenlerListesi": result = getSilinenlerListesi(); break;
      case "silinenGeriAl":        result = silinenGeriAl(body); break;
      case "getGeriDondurulenlerListesi": result = getGeriDondurulenlerListesi(); break;
      case "saveCariVirman":       result = saveCariVirman(body); break;
      case "getCariVirmanListesi": result = getCariVirmanListesi(); break;
      case "cariVirmanSil":        result = cariVirmanSil(body); break;
      case "updateCariVirman":     result = updateCariVirman(body); break;
      case "getEdmOnekEslesmeListesi": result = getEdmOnekEslesmeListesi(); break;
      case "edmOnekEslesmeManuelKaydet": result = edmOnekEslesmeManuelKaydet(body); break;
      case "edmOnekEslesmeSil":    result = edmOnekEslesmeSil(body); break;
      case "getTedarikciUrunKoduListesi": result = getTedarikciUrunKoduListesi(); break;
      case "tedarikciUrunKoduManuelKaydet": result = tedarikciUrunKoduManuelKaydet(body); break;
      case "tedarikciUrunKoduSil": result = tedarikciUrunKoduSil(body); break;
      case "tedarikciUrunKoduTopluIceAktar": result = tedarikciUrunKoduTopluIceAktar(body); break;
      case "gpdTedarikciKoduIlkYukleme": result = gpdTedarikciKoduIlkYukleme(); break;
      case "gpdStokKartlariIlkYukleme": result = gpdStokKartlariIlkYukleme(); break;
      case "getKayitDefteri":        result = getKayitDefteri(body); break;
      case "getKayitDefteriKontrol": result = getKayitDefteriKontrol(); break;
      case "kayitDefteriBaslat":     result = kayitDefteriBaslat(body); break;
      case "kayitDefteriTutarKoduDuzelt": result = kayitDefteriTutarKoduDuzelt(body); break;
      case "kayitDefteriHatalariTemizle": result = kayitDefteriHatalariTemizle(body); break;
      case "nakliyeSorunluFaturalar": result = nakliyeSorunluFaturalar(); break;
      case "nakliyeSorunluFaturalariSil": result = nakliyeSorunluFaturalariSil(body); break;
      default: result = { error: "Bilinmeyen işlem: " + action };
    }
    // Kayıt Defteri: işlem başarılıysa Ana kayıt + karşı kayıtlar deftere yazılır. Hata verirse
    // asıl işlem ETKİLENMEZ (yalnızca loglanır).
    if (KD_ACTIONLAR[action]) {
      const kdBacaklar = KD_TOPLAYICI_; KD_TOPLAYICI_ = null;
      try { kdIsle_(action, body, result, kdBacaklar); } catch (kdHata) { logError(kdHata); }
    }
    return jsonResponse(result);
  } catch (err) {
    KD_TOPLAYICI_ = null;
    logError(err);
    return jsonResponse({ error: err.message });
  }
}

// ── VERİ FONKSİYONLARI ──

// Tüm cari hesapları, her birinin güncel bakiyesiyle birlikte döndürür.
// Bakiye = toplam BORÇ - toplam ALACAK (pozitifse cari bize borçlu, negatifse biz ona borçluyuz).
function getCariListesi() {
  try {
    return cacheOkuVeyaHesapla("cariListesi_v3", 180, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
    ensureCariEkKolonlariHepsi(hSheet);
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);

    const hData = hSheet.getDataRange().getValues();
    const hkData = hkSheet.getDataRange().getValues();

    // Her cari için bakiyeyi tek geçişte hesapla
    const bakiyeMap = {};
    const sonIslemMap = {}; // cariId -> en son hareket tarihi (Rehber'de "son işleme göre" sıralama için)
    for (let i = 1; i < hkData.length; i++) {
      const row = hkData[i];
      const cariId = String(row[1] || "");
      if (!cariId) continue;
      const tip = String(row[3] || "");
      const tutar = parseFloat(row[4]) || 0;
      if (!bakiyeMap[cariId]) bakiyeMap[cariId] = 0;
      bakiyeMap[cariId] += (tip === "Borç") ? tutar : -tutar;
      const tarihStr = hucreTarihStr(row[2]);
      if (tarihStr && (!sonIslemMap[cariId] || tarihStr > sonIslemMap[cariId])) sonIslemMap[cariId] = tarihStr;
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
        eFatura: String(row[11] || "Hayır") || "Hayır",
        eArsiv: String(row[12] || "Hayır") || "Hayır",
        plasiyerId: String(row[13] || ""),
        bakiye: bakiyeMap[id] || 0,
        sonIslemTarihi: sonIslemMap[id] || "",
      });
    }
    // TEŞHİS: sonuc boşsa ama fiziksel satır varsa (hData.length>1) bunu ayırt
    // edebilmek için satır sayılarını da dönüyoruz (frontend şimdilik göstermiyor
    // ama tarayıcı Network sekmesinde Response'ta görülebilir).
    return { ok: true, cariler: sonuc, _teshisHDataUzunluk: hData.length, _teshisSheetAdi: hSheet.getName() };
    });
  } catch (teshisErr) {
    // Hata ASLA önbelleğe yazılmasın diye cacheOkuVeyaHesapla'nın DIŞINDA yakalanıyor.
    return { ok: false, hata: "getCariListesi hata: " + teshisErr.message };
  }
}

// Tek bir cari hesabın bilgisini + tüm hareket geçmişini (tarihe göre sıralı, kümülatif bakiyeli) döndürür.
function getCariDetay(cariId) {
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  ensureCariEkKolonlariHepsi(hSheet);
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
  ensureCariHareketVadeColonu(hkSheet);
  ensureCariHareketProjeKoduColonu(hkSheet);

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
        eFatura: String(hData[i][11] || "Hayır") || "Hayır",
        eArsiv: String(hData[i][12] || "Hayır") || "Hayır",
        plasiyerId: String(hData[i][13] || ""),
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
      vade: hucreTarihStr(row[7]), projeKodu: metinOku_(row[8]),
    });
  }
  // Tarihe göre sırala (eskiden yeniye). Aynı güne ait birden fazla hareket varsa (TARİH
  // sadece gün çözünürlüğünde), KAYIT_TARIHI (gerçek oluşturulma anı, dakika hassasiyetinde)
  // ile bozuyoruz — aksi halde ör. "önce girilen tahsilat, sonra kesilen fatura" gibi aynı
  // güne denk gelen işlemlerde bakiye kümülatif olarak DOĞRU hesaplanır ama görüntüleme
  // sırası bundan bağımsız kalıp (örn. frontend'de Tarih'e göre yeniden sıralanınca) tutarsız
  // görünebiliyordu — bakiye 0,00 olan satır, bakiye 29.136,00 olan satırdan ÖNCE gösterilip
  // "mantık hatası" izlenimi veriyordu. id de üçüncü seviye kesin bir kırılım sağlar.
  hareketler.sort((a, b) => {
    const gcmp = new Date(a.tarih) - new Date(b.tarih);
    if (gcmp !== 0) return gcmp;
    const kcmp = kayitTarihiEpoch_(a.kayitTarihi) - kayitTarihiEpoch_(b.kayitTarihi);
    if (kcmp !== 0) return kcmp;
    return String(a.id).localeCompare(String(b.id));
  });
  let bakiye = 0;
  hareketler.forEach(h => {
    bakiye += (h.tip === "Borç") ? h.tutar : -h.tutar;
    h.bakiyeSonrasi = bakiye;
  });
  // NOT: Artık burada .reverse() YAPILMIYOR — frontend varsayılan olarak bu (Tarih artan,
  // KAYIT_TARIHI ile kırılımlı) sırayı olduğu gibi gösteriyor; "en yeni en üstte" görünüm
  // isteniyorsa kullanıcı Tarih başlığına tıklayıp azalan sıraya geçebilir (bu durumda da
  // aynı KAYIT_TARIHI kırılımı frontend tarafında korunuyor, bkz. HK_SUTUNLAR.tarih.sortDeger).

  return { ok: true, cari: cari, hareketler: hareketler, bakiye: bakiye };
}

// "dd/MM/yyyy HH:mm" biçimindeki KAYIT_TARIHI metnini karşılaştırılabilir bir epoch
// (milisaniye) değerine çevirir — biçim uyuşmuyorsa 0 döner (sona atılır, kırılım
// sağlanamasa da uygulama çökmesin diye).
function kayitTarihiEpoch_(kt) {
  const m = String(kt || "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
}

// body: { id (varsa güncelleme), tip, ad, telefon, adres, vergiNo, not }
function saveCari(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Cari adı gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  ensureCariEkKolonlariHepsi(sheet);
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
    // STANDART DEĞER "Hayır": body.eFatura/eArsiv tam olarak "Evet" gelmediği sürece
    // (yanlış/eksik veri, undefined vb.) her zaman "Hayır" olarak kaydedilir — EDM
    // bağlantısı sadece kullanıcı açıkça "Evet" seçtiğinde kurulabilsin diye.
    String(body.eFatura) === "Evet" ? "Evet" : "Hayır",
    String(body.eArsiv) === "Evet" ? "Evet" : "Hayır",
    String(body.plasiyerId || ""),
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);

  cacheTemizle(["cariListesi_v3"]);
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
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["cariListesi_v3"]); return { ok: true }; }
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
  ensureCariHareketProjeKoduColonu(sheet);
  const id = "hk_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  metinliSatirEkle_(sheet, [id, cariId, tarih, tip, tutar, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"), String(body.vade || ""), String(body.projeKodu || "").trim()], [9]);

  kdBacakNotu_({ k: "cari", tip: tip, kaynak: SHEETS.cariHareketler, kid: id, tutar: tutar, tarih: tarih, ek: cariId });
  cacheTemizle(["cariListesi_v3"]); // bakiye değişti, liste önbelleği bayatladı
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
  const cariKoduMap = {};
  const bakiyeMap = {};
  for (let i = 1; i < hData.length; i++) {
    if (!hData[i][0]) continue;
    cariAdMap[String(hData[i][0])] = String(hData[i][2] || "");
    cariKoduMap[String(hData[i][0])] = String(hData[i][8] || "");
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
      id: String(row[0]), cariId: cariId, cariAd: cariAdMap[cariId] || "", cariKodu: cariKoduMap[cariId] || "",
      tarih: hucreTarihStr(row[2]), tutar: parseFloat(row[4]) || 0,
      aciklama: String(row[5] || ""), vade: vade,
      gecikenGunSayisi: Math.round((new Date(bugun) - new Date(vade)) / 86400000),
    });
  }
  sonuc.sort((a, b) => a.vade < b.vade ? -1 : 1);
  return { ok: true, hareketler: sonuc };
}

// ════════════════════════════════════════════════
// CARİ VİRMAN — iki cari arasında bakiye aktarımı (nakit/banka hareketi YOK, sadece
// mahsup). KAYNAK carinin bakiyesi tutar kadar AZALIR (Alacak hareketi), HEDEF
// carinin bakiyesi tutar kadar ARTAR (Borç hareketi). Mevcut cariHareketEkle()
// yeniden kullanılır — bakiye hesaplama mantığı (Borç ekler, Alacak çıkarır)
// tüm modüllerde zaten bu şekilde çalışıyor (bkz. vadesiGecmisAlacaklar).
// Silinenler/Geri Döndürülenler çöp kutusuna da diğer modüllerle aynı şekilde dahildir.
// ════════════════════════════════════════════════
const CARI_VIRMAN_BASLIKLAR = ["ID","TARIH","KAYNAK_CARI_ID","KAYNAK_CARI_AD","HEDEF_CARI_ID","HEDEF_CARI_AD","TUTAR","ACIKLAMA","KAYIT_TARIHI","KAYNAK_HAREKET_ID","HEDEF_HAREKET_ID"];

function ensureCariVirmanProjeKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 12).getValue();
  if (String(mevcutBaslik || "") !== "PROJE_KODU") {
    sheet.getRange(1, 12).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 12);
}

// Virman Tipi (örn. "Ortak Aktarımı", "Şube İçi", "Kasa Düzeltmesi" — Ayarlar'dan tanımlanır,
// bkz. BASIT_TANIM_SHEET_ADI.virmanTipi). 23 Eyl 2026: ileride raporlarda kullanılmak üzere eklendi.
function ensureCariVirmanVirmanTipiColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 13).getValue();
  if (String(mevcutBaslik || "") !== "VIRMAN_TIPI") {
    sheet.getRange(1, 13).setValue("VIRMAN_TIPI").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 13);
}

// body: { kaynakCariId, kaynakCariAd, hedefCariId, hedefCariAd, tarih, tutar, aciklama, projeKodu }
function saveCariVirman(body) {
  const kaynakId = String(body.kaynakCariId || "").trim();
  const hedefId = String(body.hedefCariId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!kaynakId) return { ok: false, hata: "Kaynak cari seçilmeli" };
  if (!hedefId) return { ok: false, hata: "Hedef cari seçilmeli" };
  if (kaynakId === hedefId) return { ok: false, hata: "Kaynak ve hedef cari aynı olamaz" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const kaynakAd = String(body.kaynakCariAd || "");
  const hedefAd = String(body.hedefCariAd || "");
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const notu = String(body.aciklama || "").trim();

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const id = "vir_" + Date.now();

  const kaynakHareket = cariHareketEkle({
    cariId: kaynakId, tarih: tarih, tip: "Alacak", tutar: tutar,
    aciklama: "VIRMAN:" + id + " | Cari Virman — " + hedefAd + " hesabına aktarıldı" + (notu ? " (" + notu + ")" : ""),
    projeKodu: body.projeKodu,
  });
  if (!kaynakHareket.ok) return { ok: false, hata: "Kaynak cari hareketi eklenemedi" };

  const hedefHareket = cariHareketEkle({
    cariId: hedefId, tarih: tarih, tip: "Borç", tutar: tutar,
    aciklama: "VIRMAN:" + id + " | Cari Virman — " + kaynakAd + " hesabından aktarıldı" + (notu ? " (" + notu + ")" : ""),
    projeKodu: body.projeKodu,
  });
  if (!hedefHareket.ok) {
    // Hedef tarafı başarısız olduysa, yarım kalmış kaynak hareketini geri al (tutarsız bakiye bırakmamak için).
    cariHareketSil({ id: kaynakHareket.id });
    return { ok: false, hata: "Hedef cari hareketi eklenemedi" };
  }

  const sheet = getOrCreateSheet(ss, SHEETS.cariVirmanlar, CARI_VIRMAN_BASLIKLAR);
  ensureCariVirmanProjeKoduColonu(sheet);
  ensureCariVirmanVirmanTipiColonu(sheet);
  metinliSatirEkle_(sheet, [id, tarih, kaynakId, kaynakAd, hedefId, hedefAd, tutar, notu,
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"), kaynakHareket.id, hedefHareket.id, String(body.projeKodu || "").trim(), String(body.virmanTipi || "").trim()], [12, 13]);

  cacheTemizle(["cariListesi_v3"]);
  return { ok: true, id: id };
}

function getCariVirmanListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariVirmanlar, CARI_VIRMAN_BASLIKLAR);
  ensureCariVirmanProjeKoduColonu(sheet);
  ensureCariVirmanVirmanTipiColonu(sheet);
  const data = sheet.getDataRange().getValues();
  const cariKoduMap = cariKoduHaritasiOlustur(ss);
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const kaynakCariId = String(row[2] || ""), hedefCariId = String(row[4] || "");
    sonuc.push({
      id: String(row[0]), tarih: hucreTarihStr(row[1]),
      kaynakCariId: kaynakCariId, kaynakCariAd: String(row[3] || ""), kaynakCariKodu: cariKoduMap[kaynakCariId] || "",
      hedefCariId: hedefCariId, hedefCariAd: String(row[5] || ""), hedefCariKodu: cariKoduMap[hedefCariId] || "",
      tutar: parseFloat(row[6]) || 0, aciklama: String(row[7] || ""), projeKodu: metinOku_(row[11]),
      virmanTipi: metinOku_(row[12]),
    });
  }
  sonuc.reverse();
  return { ok: true, virmanlar: sonuc };
}

// body: { id } — Silinenler çöp kutusuna kaydedip, iki tarafın CariHareketler
// satırlarını ve CariVirmanlar satırını siler. "Geri Al" ile saveCariVirman aynı
// veriyle tekrar çağrılır (GERI_YUKLEME_FN haritası — yeni bir virman ID'siyle).
// body: { id } — normal silme (Silinenler çöp kutusuna kaydeder).
// body: { id, _geriAlmadanKaydetme:true } — updateCariVirman() içinden "düzenle" akışında
// kullanılır: eski kaydı çöp kutusuna ATMADAN siler (asıl amaç düzenlemek, silmek değil).
function cariVirmanSil(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariVirmanlar, CARI_VIRMAN_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      const veri = {
        kaynakCariId: String(row[2] || ""), kaynakCariAd: String(row[3] || ""),
        hedefCariId: String(row[4] || ""), hedefCariAd: String(row[5] || ""),
        tarih: hucreTarihStr(row[1]), tutar: parseFloat(row[6]) || 0, aciklama: String(row[7] || ""),
      };
      if (!body._geriAlmadanKaydetme) {
        silinenlerKaydet("VIRMAN", id, "Cari Virman", veri.kaynakCariAd + " → " + veri.hedefCariAd, veri.tutar, veri);
      }
      if (row[9]) cariHareketSil({ id: String(row[9]) });
      if (row[10]) cariHareketSil({ id: String(row[10]) });
      sheet.deleteRow(i + 1);
      cacheTemizle(["cariListesi_v3"]);
      return { ok: true };
    }
  }
  return { ok: false, hata: "Virman kaydı bulunamadı" };
}

// Bir virman kaydını düzenler: mevcut kaydı (ve bağlı iki cari hareketini) çöp kutusuna
// atmadan siler, ardından güncellenmiş bilgilerle YENİ bir virman olarak yeniden oluşturur
// (uygulamadaki diğer "güncelle" fonksiyonlarıyla aynı sil+yeniden-oluştur deseni —
// bkz. guncelleTahsilat). Sonuçta yeni bir virman ID'si oluşur.
function updateCariVirman(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const silSonuc = cariVirmanSil({ id: id, _geriAlmadanKaydetme: true });
  if (!silSonuc.ok) return silSonuc;
  return saveCariVirman(body);
}

// body: { id }
function cariHareketSil(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["cariListesi_v3"]); return { ok: true }; }
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
  // Sadece belgeTipi=Sipariş için: modal açılırken Seri Tanımlama'daki "Sipariş No"
  // serisinden otomatik çekilip formun sağ üstünde gösterilen, kayıtla birlikte
  // saklanan sipariş numarası (ör. "SIP-0007").
  const h16 = sheet.getRange(1, 16).getValue();
  if (String(h16 || "") !== "SIPARIS_NO") {
    sheet.getRange(1, 16).setValue("SIPARIS_NO").setFontWeight("bold").setBackground("#e8edf5");
  }
  // EDM'e gönderilen e-Fatura'nın GİB'e bildirilen resmi fatura numarası (ör.
  // FYT2026000000001) — gönderim BAŞARILI olduktan sonra buraya yazılır, ERP ile
  // GİB kaydı arasında numara tutarlılığı sağlanır.
  const h17 = sheet.getRange(1, 17).getValue();
  if (String(h17 || "") !== "EFATURA_NO") {
    sheet.getRange(1, 17).setValue("EFATURA_NO").setFontWeight("bold").setBackground("#e8edf5");
  }
  // EDM SendInvoice ile üretilip gönderilen UUID (GİB tekil fatura no) — gönderim
  // sonrası GetInvoiceStatus ile portal durumunu sorgulamak için gerekli anahtar.
  const h18 = sheet.getRange(1, 18).getValue();
  if (String(h18 || "") !== "EFATURA_UUID") {
    sheet.getRange(1, 18).setValue("EFATURA_UUID").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Son sorgulanan portal durumu (GetInvoiceStatus'tan): STATUS_DESCRIPTION +
  // RESPONSE_DESCRIPTION özet metni, ekranda göstermek için önbelleğe alınır.
  const h19 = sheet.getRange(1, 19).getValue();
  if (String(h19 || "") !== "EFATURA_DURUM") {
    sheet.getRange(1, 19).setValue("EFATURA_DURUM").setFontWeight("bold").setBackground("#e8edf5");
  }
  // EDM'e gönderilirken üretilen HAM UBL-TR 1.2 XML'i (SendInvoice isteğinin
  // CONTENT'ine konan içeriğin ta kendisi) — ileride "Resmi Görüntüle" ekranında
  // hem ham XML'i göstermek hem de görseli o an Sheets'teki (değişmiş olabilecek)
  // veriden değil, GERÇEKTEN GÖNDERİLEN veriden üretmek için saklanır.
  const h20 = sheet.getRange(1, 20).getValue();
  if (String(h20 || "") !== "EFATURA_UBL_XML") {
    sheet.getRange(1, 20).setValue("EFATURA_UBL_XML").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Yukarıdaki XML'in üretildiği alanların JSON anlık görüntüsü (satıcı/alıcı VKN,
  // ünvan, kalemler, toplamlar, tarih/saat) — resmi görsel ekranı XML'i tekrar
  // ayrıştırmak yerine doğrudan bu JSON'dan (daha sağlam/basit) çiziyor.
  const h21 = sheet.getRange(1, 21).getValue();
  if (String(h21 || "") !== "EFATURA_GORSEL_VERI") {
    sheet.getRange(1, 21).setValue("EFATURA_GORSEL_VERI").setFontWeight("bold").setBackground("#e8edf5");
  }
  // İsteğe bağlı: bu faturanın/siparişin hangi işe/projeye ait olduğunu takip etmek
  // için serbest metin etiket. cariHareketEkle çağrısına da geçilip CariHareketler'e
  // yazılır, böylece Cari raporunda proje koduna göre filtrelenebilir.
  const h22 = sheet.getRange(1, 22).getValue();
  if (String(h22 || "") !== "PROJE_KODU") {
    sheet.getRange(1, 22).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  // Sadece kesilen Fatura'larda (Sipariş/Teklif'te anlamsız) anlamlı: Ayarlar'da
  // tanımlanan Fatura Tipi listesinden (ör. Perakende/Toptan/İhracat) seçilen etiket.
  const h23 = sheet.getRange(1, 23).getValue();
  if (String(h23 || "") !== "FATURA_TIPI") {
    sheet.getRange(1, 23).setValue("FATURA_TIPI").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 22); // PROJE_KODU
  metinKolonuGarantiEt_(sheet, 23); // FATURA_TIPI
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
// Cari kodu birçok işlem listesinde (Satış/Alış/Tahsilat/Ödeme/İade/Virman) gösterilecek —
// CariHesaplar sayfasından tek seferde ID -> CARI_KODU haritası çıkarır.
function cariKoduHaritasiOlustur(ss) {
  const map = {};
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
    ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  const hData = hSheet.getDataRange().getValues();
  for (let i = 1; i < hData.length; i++) {
    const cariId = String(hData[i][0] || "");
    if (cariId) map[cariId] = String(hData[i][8] || "");
  }
  return map;
}

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

  const cariKoduMap = cariKoduHaritasiOlustur(ss);
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const belgeTipi = String(row[8] || "") || "Fatura";
    const elleSecilenDurum = String(row[12] || "");
    const f = faturalanmaHaritasi[id];
    const cariId = String(row[2] || "");
    sonuc.push({
      id: id,
      tarih: hucreTarihStr(row[1]),
      cariId: cariId,
      cariAd: String(row[3] || ""),
      cariKodu: cariKoduMap[cariId] || "",
      toplamTutar: parseFloat(row[4]) || 0,
      odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""),
      kayitTarihi: hucreTarihStr(row[7]),
      belgeTipi: belgeTipi,
      siparisNo: String(row[15] || ""),
      siparisManuelDurum: elleSecilenDurum || "Beklemede",
      siparisDurumu: belgeTipi === "Sipariş" ? siparisDurumHesapla(elleSecilenDurum, f && f.tamamiFaturalandi, f ? f.hicFaturalanmadi : true) : "",
      // Liste ekranındaki "EDM'e Gönderilen / Gönderilmeyen" iki kademeli filtreleme
      // için: efaturaNo doluysa bu fatura EDM'e gönderilmiş demektir.
      efaturaNo: String(row[16] || ""),
      efaturaDurum: String(row[18] || ""),
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
        id: String(data[i][0]), tarih: hucreTarihStr(data[i][1]), cariId: String(data[i][2] || ""),
        cariAd: String(data[i][3] || ""), toplamTutar: parseFloat(data[i][4]) || 0,
        odemeTipi: String(data[i][5] || ""), aciklama: String(data[i][6] || ""), kayitTarihi: hucreTarihStr(data[i][7]),
        belgeTipi: String(data[i][8] || "") || "Fatura",
        dipIskontoYuzde: parseFloat(data[i][9]) || 0, bankaHesapId: String(data[i][10] || ""),
        posHesapId: String(data[i][23] || ""),
        odemeTutari: data[i][24] === "" || data[i][24] === undefined ? null : (parseFloat(data[i][24]) || 0),
        kaynakSiparisId: String(data[i][11] || ""),
        siparisManuelDurum: String(data[i][12] || "") || "Beklemede",
        tutarIskontosu: parseFloat(data[i][13]) || 0,
        tutarIskontoKdvSonra: String(data[i][14]) !== "0",
        siparisNo: String(data[i][15] || ""),
        efaturaNo: String(data[i][16] || ""),
        efaturaUuid: String(data[i][17] || ""),
        efaturaDurum: String(data[i][18] || ""),
        projeKodu: metinOku_(data[i][21]),
        faturaTipi: metinOku_(data[i][22]),
      };
      break;
    }
  }
  if (!satis) return { ok: false, hata: "Satış bulunamadı" };

  // EDM'e gönderilmiş bir faturaysa, içerik ekranında "E-FATURA" mı "E-ARŞİV" mi olduğunu
  // belirgin gösterebilmek için carinin e-Fatura/e-Arşiv mükellefiyet bilgisini de ekliyoruz
  // (edmBaglantisiVarMi_ ile aynı mantık: e-Fatura'ya kayıtlı DEĞİLSE e-Arşiv varsayılır).
  if (satis.efaturaNo && satis.cariId) {
    const cariRes = getCariDetay(satis.cariId);
    if (cariRes.ok) {
      satis.cariEFatura = cariRes.cari.eFatura;
      satis.cariEArsiv = cariRes.cari.eArsiv;
    }
  }

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
  const kalemGenelToplam = araToplam + kdvToplam;

  // Tutar İskontosu (sabit ₺, sadece Sipariş'te kullanılır) — saveAlis/updateSatis'teki
  // aynı mantık: KDV'den sonra (varsayılan) doğrudan genel toplamdan, ya da KDV'den önce
  // (ara toplamdan düşülüp kdv oransal olarak yeniden hesaplanır) uygulanır. Daha önce bu
  // tutar sadece saklanıyordu, hiçbir toplam satırında görünmüyordu — burada gösterime
  // giren nihai kdvToplam/araToplam/genelToplam bu iskontoyu yansıtır.
  const tutarIskontosu = satis.tutarIskontosu || 0;
  let nihaiAraToplam = araToplam, nihaiKdvToplam = kdvToplam, nihaiGenelToplam = kalemGenelToplam;
  if (tutarIskontosu > 0) {
    if (satis.tutarIskontoKdvSonra) {
      nihaiGenelToplam = Math.max(0, kalemGenelToplam - tutarIskontosu);
    } else {
      nihaiAraToplam = Math.max(0, araToplam - tutarIskontosu);
      const ortalamaKdvOrani = araToplam > 0 ? (kdvToplam / araToplam) : 0;
      nihaiKdvToplam = nihaiAraToplam * ortalamaKdvOrani;
      nihaiGenelToplam = nihaiAraToplam + nihaiKdvToplam;
    }
  }

  satis.toplamlar = {
    brutToplam: brutToplam, iskontoToplam: iskontoToplam + dipIskontoTutari, araToplam: nihaiAraToplam,
    kdvToplam: nihaiKdvToplam, tutarIskontosu: tutarIskontosu, genelToplam: nihaiGenelToplam,
  };
  return { ok: true, satis: satis, kalemler: kalemler };
}

// body: { cariId (zorunlu), tarih,
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
  const stokHata = kalemlerStokKoduDogrula(ss, kalemler);
  if (stokHata) return { ok: false, hata: stokHata };
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  ensureSatisKalemVergiKolonlari(kSheet);

  const cariId = String(body.cariId || "").trim();
  if (!cariId) return { ok: false, hata: "Cari (müşteri) seçimi zorunludur" };
  let cariAd = "";
  let cariEdmVar = false; // Cari E-Fatura veya E-Arşiv mükellefiyse true — KDV sonrası Tutar İskontosu'na izin verilmez.
  {
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
    ensureCariEFaturaColonu(cSheet);
    ensureCariEArsivColonu(cSheet);
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) {
        cariAd = String(cData[i][2] || "");
        cariEdmVar = String(cData[i][11] || "") === "Evet" || String(cData[i][12] || "") === "Evet";
        break;
      }
    }
  }
  if (!cariAd) return { ok: false, hata: "Seçilen cari bulunamadı" };

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
  // Cari E-Fatura veya E-Arşiv mükellefiyse (EDM bağlantısı olabilecek cari) KDV
  // sonrası sabit tutar iskontosuna İZİN VERİLMEZ — GİB'e giden faturada iskonto her
  // zaman KDV matrahına (KDV'den ÖNCE) yansıtılmalı. Böyle bir caride bu tik ne
  // gelirse gelsin (arayüz zaten devre dışı bırakıyor, burada ikinci güvenlik katmanı) false'a zorlanır.
  const tutarIskontoKdvSonra = cariEdmVar ? false : (body.tutarIskontoKdvSonra !== false); // varsayılan: KDV'den sonra
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
  const posHesapId = String(body.posHesapId || "").trim();
  const belgeTipi = String(body.belgeTipi || "Fatura");
  // Tahsilat/Ödeme'deki aynı kural: Kredi Kartı seçilip POS hesabı belirtilmezse
  // faturada hiçbir POS hareketine iz düşmeden kayıt kaçabiliyordu — burada
  // (SADECE Fatura'da, çünkü Sipariş/Teklif zaten hiçbir hareket yaratmıyor) engelleniyor.
  if (belgeTipi === "Fatura" && String(body.odemeTipi || "") === "Kredi Kartı" && !posHesapId) {
    return { ok: false, hata: "Kredi Kartı ile faturada POS hesabı seçimi zorunludur" };
  }
  // Havale/Kredi Kartı ile faturanın TAMAMI değil, farklı (genelde daha az) bir tutar
  // tahsil edilmiş olabilir — kalan kısım cari üzerinde Açık Hesap gibi kalmaya devam
  // eder (cari Borç hareketi her zaman toplamTutar kadar, aşağıda değişmeden yazılıyor).
  // Belirtilmezse geriye dönük uyumluluk için TAMAMI o yöntemle alınmış varsayılır.
  const odemeTipiOnBelirtilen = String(body.odemeTipi || "");
  let odemeTutari = toplamTutar;
  if ((odemeTipiOnBelirtilen === "Havale" || odemeTipiOnBelirtilen === "Kredi Kartı") && belgeTipi === "Fatura") {
    if (body.odemeTutari !== undefined && body.odemeTutari !== null && String(body.odemeTutari).trim() !== "") {
      odemeTutari = parseFloat(body.odemeTutari) || 0;
      if (!(odemeTutari > 0) || odemeTutari > toplamTutar + 0.01) {
        return { ok: false, hata: (odemeTipiOnBelirtilen === "Havale" ? "Havale" : "Kredi Kartı") + " ile tahsil edilen tutar 0 ile fatura toplamı arasında olmalı" };
      }
    }
  } else {
    odemeTutari = "";
  }
  let siparisDurumu = "";
  if (belgeTipi === "Sipariş") {
    const durumAdlari = getSiparisDurumlari().durumlar.map(d => d.ad);
    siparisDurumu = durumAdlari.includes(body.siparisDurumu) ? body.siparisDurumu : (durumAdlari[0] || "Beklemede");
  }
  metinliSatirEkle_(sSheet, [id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi, belgeTipi, dipIskontoYuzde, bankaHesapId, String(body.kaynakSiparisId || ""), siparisDurumu, tutarIskontosu, tutarIskontoKdvSonra ? 1 : 0, String(body.siparisNo || ""), "", "", "", "", "", String(body.projeKodu || "").trim(), String(body.faturaTipi || "").trim(), posHesapId, odemeTutari], [22, 23]);

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

  // Fatura ekranındaki "Stoğa işle" / "Cariye işle" tikleri — varsayılan olarak
  // İŞARETLİ (true) gelir; kullanıcı bilinçli olarak tiki kaldırırsa (body.stokIsle
  // / body.cariIsle === false) o faturanın stok hareketi / cari borç hareketi
  // OLUŞTURULMAZ. Sipariş/Teklif için zaten geçerli değil (aşağıdaki blok sadece
  // belgeTipi === "Fatura" iken çalışıyor), tikler sadece Fatura'da işe yarar.
  const stokIsle = body.stokIsle !== false;
  const cariIsle = body.cariIsle !== false;

  // Stok Hareket Raporu'na SADECE FATURA yansır (Teklif/Sipariş henüz stoktan mal
  // çıkışı anlamına gelmez — mal siparişin faturalandırılmasıyla fiilen çıkar).
  if (belgeTipi === "Fatura" && stokIsle) {
    stokHareketOtomatikYaz(ss, kalemler, tarih, "Çıkış", "Satış Faturası", id, "Satış Faturası — " + cariAd);
  }

  // Cari harekete/banka hareketine SADECE FATURA yansır — Teklif ve Sipariş henüz
  // gerçekleşmiş bir satış değildir, cariye borç yazılmaz. Sipariş faturalandığında
  // (siparistenFaturaOlustur ile) oluşturulan Fatura zaten kendi Borç hareketini yaratır.
  if (belgeTipi === "Fatura" && cariIsle) {
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
        projeKodu: body.projeKodu,
      });
    }

    // Ödeme Tipi "Havale" ise ve bir banka hesabı seçildiyse, o hesaba GİRİŞ kaydı düşülür.
    // Tahsil edilen tutar (odemeTutari) fatura toplamından FARKLI/daha az olabilir —
    // kalan kısım cari üzerinde borç (Açık Hesap gibi) olarak kalmaya devam eder.
    if (String(body.odemeTipi || "") === "Havale" && bankaHesapId) {
      bankaHesapHareketEkle(bankaHesapId, tarih, "Giriş", odemeTutari,
        cariHareketAciklamaOlustur("SATIS", id, "satis_" + belgeTipi, body.aciklama));
    }

    // Ödeme Tipi "Kredi Kartı" ise ve bir POS hesabı seçildiyse, o POS hesabına
    // BORÇ kaydı düşülür (POS/banka bize bu tutarı ödeyecek) — Tahsilat'taki
    // Kredi Kartı mantığının aynısı. Tahsil edilen tutar (odemeTutari) fatura
    // toplamından farklı/daha az olabilir, kalan kısım cari üzerinde borç kalır.
    if (String(body.odemeTipi || "") === "Kredi Kartı" && posHesapId) {
      posHareketEkle(posHesapId, tarih, "Borç", odemeTutari,
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
      siparis = { cariId: String(sData[i][2] || ""), cariAd: String(sData[i][3] || ""), belgeTipi: String(sData[i][8] || "") || "Fatura", durum: String(sData[i][12] || "") || "Beklemede",
        dipIskontoYuzde: parseFloat(sData[i][9]) || 0, tutarIskontosu: parseFloat(sData[i][13]) || 0, tutarIskontoKdvSonra: sData[i][14] == 1 };
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

  // ★ DÜZELTME (kullanıcı bildirimi: "fatura altı yaptığım iskonto faturalaştırdığım zaman
  // siliniyor"): siparistenFaturaOlustur, oluşturduğu Fatura'ya siparişin belge düzeyi
  // (fatura altı) Dip İskonto %'sini ve Tutar İskontosu'nu hiç aktarmıyordu — saveSatis'e
  // bu alanlar hiç gönderilmediği için otomatik olarak 0'a düşüyordu. Dip İskonto % her
  // zaman aktarılır (yüzde olduğu için bu faturanın kendi ara toplamına orantılı uygulanır).
  // Sabit tutarlı Tutar İskontosu ise SADECE siparişin TÜMÜ bu faturaya aktarılıyorsa
  // aktarılır — aksi halde kısmi faturalarda sabit tutar mükerrer düşülmüş olur.
  const siparisTamamenAktariliyorMu = Object.keys(kalemBilgi).every(kId => {
    const bilgi = kalemBilgi[kId];
    const guncelleme = guncellenecekler.find(g => g.satirIdx === kalemSatirIdx[kId]);
    const yeniFaturalanan = guncelleme ? guncelleme.yeniFaturalananMiktar : bilgi.faturalananMiktar;
    return yeniFaturalanan >= bilgi.miktar - 0.0001;
  });

  // ★ GÜNCELLEME (kullanıcı isteği: "tutar iskontosu içinde miktarda değişiklik oluyor
  // ise ilgili oranda iskonto faturaya yansıtılsın"): sipariş TAMAMEN değil KISMEN
  // faturaya aktarılıyorsa artık Tutar İskontosu 0'a düşürülmüyor — bu faturaya
  // aktarılan tutarın, siparişin toplam (KDV hariç) tutarına oranı kadarı Tutar
  // İskontosu'ndan bu faturaya pay olarak veriliyor. Örn. sipariş tutarının %40'ı bu
  // faturaya aktarılıyorsa, Tutar İskontosu'nun da %40'ı bu faturaya yansır; kalan
  // %60'lık pay, sonraki kısmi faturalarda kendi oranınca aktarılmaya devam eder.
  let tutarIskontosuBuFaturaya = 0;
  if (siparis.tutarIskontosu > 0) {
    if (siparisTamamenAktariliyorMu) {
      tutarIskontosuBuFaturaya = siparis.tutarIskontosu;
    } else {
      let siparisToplamNet = 0, buFaturaNet = 0;
      Object.keys(kalemBilgi).forEach(kId => {
        const b = kalemBilgi[kId];
        siparisToplamNet += b.miktar * b.birimFiyat * (1 - (b.iskontoYuzde || 0) / 100);
      });
      yeniFaturaKalemleri.forEach(k => {
        buFaturaNet += k.miktar * k.birimFiyat * (1 - (k.iskontoYuzde || 0) / 100);
      });
      const oran = siparisToplamNet > 0 ? (buFaturaNet / siparisToplamNet) : 0;
      tutarIskontosuBuFaturaya = Math.round(siparis.tutarIskontosu * oran * 100) / 100;
    }
  }

  const faturaSonuc = saveSatis({
    cariId: siparis.cariId, cariAd: siparis.cariAd,
    tarih: body.tarih, odemeTipi: body.odemeTipi, bankaHesapId: body.bankaHesapId, vade: body.vade,
    aciklama: String(body.aciklama || ("Sipariş #" + siparisId.slice(-6) + "'den aktarıldı")),
    belgeTipi: "Fatura", kaynakSiparisId: siparisId,
    dipIskontoYuzde: siparis.dipIskontoYuzde,
    tutarIskontosu: tutarIskontosuBuFaturaya,
    tutarIskontoKdvSonra: siparis.tutarIskontoKdvSonra,
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
  if (siparisler.length === 0) return { ok: true, siparisler: [] };

  // Bu siparişlerden (siparistenFaturaOlustur ile, tam ya da kısmi) kesilmiş
  // faturaları bulmak için Satislar sayfasını KAYNAK_SIPARIS_ID (12. sütun)
  // üzerinden tarıyoruz — getSatisListesi bu alanı dışarı vermediği için
  // doğrudan sayfadan okunuyor.
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();
  const siparisIdSeti = {};
  siparisler.forEach(s => { siparisIdSeti[s.id] = true; });
  const faturaHaritasi = {}; // siparisId -> [{id, siparisNo, tarih, toplamTutar}]
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const kaynakSiparisId = String(row[11] || "");
    if (!kaynakSiparisId || !siparisIdSeti[kaynakSiparisId]) continue;
    if (String(row[8] || "") !== "Fatura") continue;
    if (!faturaHaritasi[kaynakSiparisId]) faturaHaritasi[kaynakSiparisId] = [];
    faturaHaritasi[kaynakSiparisId].push({
      id: String(row[0] || ""),
      siparisNo: String(row[15] || ""),
      tarih: hucreTarihStr(row[1]),
      toplamTutar: parseFloat(row[4]) || 0,
    });
  }

  const zenginlestirilmis = siparisler.map(s => {
    const faturalar = faturaHaritasi[s.id] || [];
    const faturalananToplam = faturalar.reduce((t, f) => t + f.toplamTutar, 0);
    return Object.assign({}, s, {
      faturalar: faturalar,
      faturalananTutar: faturalananToplam,
      kalanTutar: Math.max(0, s.toplamTutar - faturalananToplam),
    });
  });
  return { ok: true, siparisler: zenginlestirilmis };
}// body: { id }
function silSatis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sSheet.getDataRange().getValues();

  // Kalemleri silmeden ÖNCE oku (hem "Silinenler" anlık görüntüsü hem de sipariş
  // faturalanan-miktar geri alma için gerekiyor).
  const kSheetOn = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  const kDataOn = kSheetOn.getDataRange().getValues();
  const anlikKalemler = [];
  for (let i = 1; i < kDataOn.length; i++) {
    if (String(kDataOn[i][1]) === id) {
      anlikKalemler.push({
        urunAdi: String(kDataOn[i][2] || ""), miktar: parseFloat(kDataOn[i][3]) || 0, birim: String(kDataOn[i][4] || "adet"),
        birimFiyat: parseFloat(kDataOn[i][5]) || 0, iskontoYuzde: parseFloat(kDataOn[i][7]) || 0,
        kdvOrani: parseFloat(kDataOn[i][8]) || 0, stokKodu: String(kDataOn[i][10] || ""),
      });
    }
  }

  let cariId = "";
  let kaynakSiparisId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      cariId = String(row[2] || "");
      kaynakSiparisId = String(row[11] || "");
      if (!body._geriAlmadanKaydetme) {
        const siparisNo = String(row[15] || "");
        const efaturaNo = String(row[16] || "");
        silinenlerKaydet("SATIS", id, (String(row[8] || "Fatura")) + " (Satış)", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, tarih: hucreTarihStr(row[1]), aciklama: String(row[6] || ""),
          belgeTipi: String(row[8] || "Fatura"), odemeTipi: String(row[5] || ""), kalemler: anlikKalemler,
        }, siparisNo || efaturaNo);
      }
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
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  // Bu satışla ilişkili bir Havale banka hareketi varsa geri al.
  bankaHesapHareketSilByAciklamaOnPrefix("SATIS:" + id);
  // Bu satışla ilişkili bir Kredi Kartı POS hareketi varsa geri al.
  posHareketSilByAciklamaOnPrefix("SATIS:" + id);

  cacheTemizle(["satisListesi"]);
  return { ok: true };
}

// body: { id, cariId (zorunlu), tarih, odemeTipi, bankaHesapId, aciklama,
//         dipIskontoYuzde, tutarIskontosu, tutarIskontoKdvSonra, siparisNo,
//         kalemler: [{urunAdi,miktar,birim,birimFiyat,iskontoYuzde,kdvOrani,stokKodu (opsiyonel),
//                     stokKartiOlustur (opsiyonel)}] }
// SADECE Sipariş/Teklif için — bunlar hiç stok/cari harekete yansımadığından (bkz. saveSatis
// yorumları) ledger riski olmadan doğrudan yerinde güncellenebilir. Fatura reddedilir; onun
// stok çıkışı + cari borcu olduğundan düzenlenmesi ayrı bir reversal+reapply akışı gerektirir
// (bkz. updateAlis) ve şimdilik desteklenmiyor.
function updateSatis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const cariId = String(body.cariId || "").trim();
  if (!cariId) return { ok: false, hata: "Cari (müşteri) seçimi zorunludur" };

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
  const data = sSheet.getDataRange().getValues();

  let satirIdx = -1, belgeTipi = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { satirIdx = i + 1; belgeTipi = String(data[i][8] || "") || "Fatura"; break; }
  }
  if (satirIdx === -1) return { ok: false, hata: "Kayıt bulunamadı" };
  if (belgeTipi !== "Sipariş" && belgeTipi !== "Teklif") {
    return { ok: false, hata: "Sadece Sipariş veya Teklif düzenlenebilir (Fatura düzenlenemez)" };
  }

  const cAdKontrolSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
    ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
  ensureCariEFaturaColonu(cAdKontrolSheet);
  ensureCariEArsivColonu(cAdKontrolSheet);
  let cariEdmVar = false; // Cari E-Fatura veya E-Arşiv mükellefiyse true — KDV sonrası Tutar İskontosu'na izin verilmez.
  {
    const cData = cAdKontrolSheet.getDataRange().getValues();
    let bulundu = false;
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) {
        bulundu = true;
        cariEdmVar = String(cData[i][11] || "") === "Evet" || String(cData[i][12] || "") === "Evet";
        break;
      }
    }
    if (!bulundu) return { ok: false, hata: "Seçilen cari bulunamadı" };
  }

  const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
    ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
  ensureSatisKalemVergiKolonlari(kSheet);
  const kData = kSheet.getDataRange().getValues();

  // Ürün adına göre eski FATURALANAN_MIKTAR'ı topluyoruz ki kısmen faturalanmış bir
  // Sipariş kalemi düzenlemede bu bilgi kaybolmasın (yeni miktarı aşamaz).
  const eskiFaturalanan = {};
  for (let i = 1; i < kData.length; i++) {
    if (String(kData[i][1]) === id) {
      const ad = String(kData[i][2] || "");
      eskiFaturalanan[ad] = (eskiFaturalanan[ad] || 0) + (parseFloat(kData[i][9]) || 0);
    }
  }
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

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

  let cariAd = "";
  {
    const cData = cAdKontrolSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
    }
  }

  // Tutar hesaplaması saveSatis ile birebir aynı (bkz. oradaki yorumlar).
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
  const tutarIskontosu = Math.max(0, parseFloat(body.tutarIskontosu) || 0);
  const tutarIskontoKdvSonra = cariEdmVar ? false : (body.tutarIskontoKdvSonra !== false);
  let toplamTutar;
  if (tutarIskontosu > 0 && !tutarIskontoKdvSonra) {
    const araToplamNet = Math.max(0, kalemAraToplam - dipIskontoTutari - tutarIskontosu);
    const ortalamaKdvOrani = kalemAraToplam > 0 ? (kalemKdvToplam / kalemAraToplam) : 0;
    toplamTutar = araToplamNet * (1 + ortalamaKdvOrani);
  } else {
    toplamTutar = kalemGenelToplam - dipIskontoTutari - tutarIskontosu;
  }
  toplamTutar = Math.max(0, toplamTutar);

  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  const eskiRow = data[satirIdx - 1];

  // KAYIT_TARIHI (7), KAYNAK_SIPARIS_ID (11) ve SIPARIS_DURUMU (12) düzenlemeden
  // etkilenmez — orijinal değerleriyle korunur.
  const yeniRow = eskiRow.slice();
  yeniRow[1] = tarih; yeniRow[2] = cariId; yeniRow[3] = cariAd; yeniRow[4] = toplamTutar;
  yeniRow[5] = String(body.odemeTipi || "Peşin"); yeniRow[6] = String(body.aciklama || "");
  yeniRow[9] = dipIskontoYuzde; yeniRow[10] = bankaHesapId;
  yeniRow[13] = tutarIskontosu; yeniRow[14] = tutarIskontoKdvSonra ? 1 : 0;
  yeniRow[15] = String(body.siparisNo !== undefined ? body.siparisNo : (eskiRow[15] || ""));
  yeniRow[21] = String(body.projeKodu !== undefined ? body.projeKodu : metinOku_(eskiRow[21]));
  yeniRow[22] = String(body.faturaTipi !== undefined ? body.faturaTipi : metinOku_(eskiRow[22]));
  metinliSatirYaz_(sSheet, satirIdx, yeniRow, [22, 23]);

  kalemler.forEach((k, idx) => {
    const kId = "sk_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    const iskontoYuzde = parseFloat(k.iskontoYuzde) || 0;
    const kdvOrani = k.kdvOrani === undefined ? 20 : (parseFloat(k.kdvOrani) || 0);
    const ad = String(k.urunAdi).trim();
    const faturalanan = Math.min(miktar, eskiFaturalanan[ad] || 0);
    kSheet.appendRow([kId, id, ad, miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, iskontoYuzde, kdvOrani, faturalanan, String(k.stokKodu || "").trim()]);
  });

  cacheTemizle(["satisListesi"]);
  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// ════════════════════════════════════════════════
// ALIŞ MODÜLÜ
// Satış modülünün aynası ama ters yönlü: Alış yapılınca biz tedarikçiye
// borçlanırız, bu yüzden cariye "Alacak" hareketi eklenir (bakiye negatife
// gider = biz borçluyuz). Stoktan bağımsız (ürün serbest metin).
// ════════════════════════════════════════════════

function getAlisListesi() {
  return cacheOkuVeyaHesapla("alisListesi", 60, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const data = aSheet.getDataRange().getValues();

  // ★ EKLENDİ: soldaki listede fatura no + cari kodu belirgin gösterilsin diye
  // AlisFaturaDurum'dan (ALIS_ID -> FATURA_NO) ve CariHesaplar'dan (CARI_ID -> CARI_KODU) eşleme.
  const faturaNoMap = {};
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = 1; i < durumData.length; i++) {
    const alisId = String(durumData[i][2] || "");
    if (alisId) faturaNoMap[alisId] = String(durumData[i][0] || "");
  }
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const cariId = String(row[2] || "");
    // Fatura no önce AlisFaturaDurum'dan (Bekleyenden onaylanan faturalar), yoksa ACIKLAMA
    // içindeki "Fatura No: X" kalıbından (manuel girişte de faturaNo yazılmışsa) çekiliyor.
    let faturaNo = faturaNoMap[id] || "";
    if (!faturaNo) {
      const ac = String(row[6] || "");
      const m = ac.match(/Fatura No:\s*(\S+)/i);
      if (m) faturaNo = m[1];
    }
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: cariId, cariAd: String(row[3] || ""),
      cariKodu: cariKoduMap[cariId] || "",
      toplamTutar: parseFloat(row[4]) || 0, odemeTipi: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]),
      faturaNo: faturaNo,
    });
  }
  sonuc.reverse();
  return { ok: true, alislar: sonuc };
  });
}

function getAlisDetay(alisId) {
  if (!alisId) return { ok: false, hata: "alisId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemStokKoduColonu(kSheet);
  ensureAlisKalemKdvColonu(kSheet);
  ensureAlisKalemBrutIskontoColonlari(kSheet);
  ensureAlisTutarIskontosuColonu(aSheet);
  ensureAlisProjeKoduColonu(aSheet);
  ensureAlisFaturaTipiColonu(aSheet);

  const data = aSheet.getDataRange().getValues();
  let alis = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(alisId)) {
      alis = {
        id: String(data[i][0]), tarih: hucreTarihStr(data[i][1]), cariId: String(data[i][2] || ""),
        cariAd: String(data[i][3] || ""), toplamTutar: parseFloat(data[i][4]) || 0,
        odemeTipi: String(data[i][5] || ""), aciklama: String(data[i][6] || ""), kayitTarihi: hucreTarihStr(data[i][7]),
        tutarIskontosu: parseFloat(data[i][8]) || 0, projeKodu: metinOku_(data[i][9]),
        faturaTipi: metinOku_(data[i][10]),
      };
      break;
    }
  }
  if (!alis) return { ok: false, hata: "Alış bulunamadı" };

  // ★ EKLENDİ: Alış detayında da "Faturayı Gör" butonu gösterebilmek için faturaNo.
  let faturaNo = "";
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = 1; i < durumData.length; i++) {
    if (String(durumData[i][2] || "") === String(alisId)) { faturaNo = String(durumData[i][0] || ""); break; }
  }
  if (!faturaNo) {
    const m = String(alis.aciklama || "").match(/Fatura No:\s*(\S+)/i);
    if (m) faturaNo = m[1];
  }
  alis.faturaNo = faturaNo;


  const kData = kSheet.getDataRange().getValues();
  const kalemler = [];
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (String(row[1]) !== String(alisId)) continue;
    const birimFiyat = parseFloat(row[5]) || 0;
    kalemler.push({
      id: String(row[0]), alisId: String(row[1]), urunAdi: String(row[2] || ""),
      miktar: parseFloat(row[3]) || 0, birim: String(row[4] || ""),
      birimFiyat: birimFiyat, tutar: parseFloat(row[6]) || 0,
      stokKodu: String(row[7] || ""), kdvOrani: parseFloat(row[8]) || 0,
      brutFiyat: parseFloat(row[9]) || birimFiyat, iskontoYuzde: parseFloat(row[10]) || 0,
    });
  }
  return { ok: true, alis: alis, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, odemeTipi, aciklama,
//         kalemler: [{urunAdi,miktar,birim,birimFiyat,stokKodu (opsiyonel),
//                     stokKartiOlustur (opsiyonel, true ise stokKodu StokTanimlari'nda
//                     yoksa otomatik yeni bir stok kartı oluşturulur)}] }
// Alış faturasının/kaydının isteğe bağlı Proje Kodu etiketi (bkz. Satış'taki eşdeğeri,
// ensureSatisBelgeTipiColonu içindeki PROJE_KODU açıklaması) — Alislar'da TUTAR_ISKONTOSU
// (kolon 9) son kullanılan kolon olduğu için 10. kolona ekleniyor.
function ensureAlisProjeKoduColonu(sheet) {
  const h10 = sheet.getRange(1, 10).getValue();
  if (String(h10 || "") !== "PROJE_KODU") {
    sheet.getRange(1, 10).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 10);
}

// Alış faturasının Fatura Tipi etiketi (bkz. Satış'taki eşdeğeri) — PROJE_KODU'dan (kolon 10)
// sonraki ilk boş kolon olan 11. kolona ekleniyor (23 Eyl 2026, Proje Kodu/Fatura Tipi Bazlı
// Fatura Raporu ile birlikte: Alış tarafında bu ana kadar Fatura Tipi tutulmuyordu).
function ensureAlisFaturaTipiColonu(sheet) {
  const h11 = sheet.getRange(1, 11).getValue();
  if (String(h11 || "") !== "FATURA_TIPI") {
    sheet.getRange(1, 11).setValue("FATURA_TIPI").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 11);
}

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
  ensureAlisKalemKdvColonu(kSheet);
  ensureAlisKalemBrutIskontoColonlari(kSheet);
  ensureAlisTutarIskontosuColonu(aSheet);
  ensureAlisProjeKoduColonu(aSheet);
  ensureAlisFaturaTipiColonu(aSheet);

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

  const stokHata = kalemlerStokKoduDogrula(ss, kalemler);
  if (stokHata) return { ok: false, hata: stokHata };

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

  // TUTAR ve toplamTutar artık KDV DAHİL hesaplanıyor (bkz. ensureAlisKalemKdvColonu
  // yorumu). kdvOrani gönderilmeyen (örn. eski/manuel) kalemlerde 0 varsayılır, bu da
  // eskisi gibi KDV'siz tutar demektir — geriye dönük uyumlu.
  let kalemGenelToplam = 0;
  kalemler.forEach(k => {
    const kdvOrani = parseFloat(k.kdvOrani) || 0;
    kalemGenelToplam += (parseFloat(k.miktar) || 0) * (parseFloat(k.birimFiyat) || 0) * (1 + kdvOrani / 100);
  });
  // Belge düzeyi (fatura altı) manuel ek indirim — Satış'taki "Tutar İskontosu" ile
  // aynı fikir, KDV dahil genel toplamdan düşülür.
  const tutarIskontosu = Math.max(0, parseFloat(body.tutarIskontosu) || 0);
  const toplamTutar = Math.max(0, kalemGenelToplam - tutarIskontosu);

  const id = "al_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  metinliSatirEkle_(aSheet, [id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi, tutarIskontosu, String(body.projeKodu || "").trim(), String(body.faturaTipi || "").trim()], [10, 11]);

  kalemler.forEach((k, idx) => {
    const kId = "ak_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    const kdvOrani = parseFloat(k.kdvOrani) || 0;
    const brutFiyat = parseFloat(k.brutFiyat) || birimFiyat;
    const iskontoYuzde = parseFloat(k.iskontoYuzde) || 0;
    const kalemTutar = miktar * birimFiyat * (1 + kdvOrani / 100);
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, kalemTutar, String(k.stokKodu || "").trim(), kdvOrani, brutFiyat, iskontoYuzde]);
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
      projeKodu: body.projeKodu,
    });
  }

  cacheTemizle(["alisListesi"]);
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

  const kSheetOn = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  const kDataOn = kSheetOn.getDataRange().getValues();
  const anlikKalemler = [];
  for (let i = 1; i < kDataOn.length; i++) {
    if (String(kDataOn[i][1]) === id) {
      anlikKalemler.push({
        urunAdi: String(kDataOn[i][2] || ""), miktar: parseFloat(kDataOn[i][3]) || 0,
        birim: String(kDataOn[i][4] || "adet"), birimFiyat: parseFloat(kDataOn[i][5] || 0),
        stokKodu: String(kDataOn[i][7] || ""),
      });
    }
  }

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      cariId = String(row[2] || "");
      if (!body._geriAlmadanKaydetme) {
        const aciklamaMetni = String(row[6] || "");
        silinenlerKaydet("ALIS", id, "Alış Faturası", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, cariAd: String(row[3] || ""), tarih: hucreTarihStr(row[1]),
          aciklama: aciklamaMetni, odemeTipi: String(row[5] || ""), kalemler: anlikKalemler,
        }, belgeNoAciklamadanCikar_(aciklamaMetni));
      }
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
        cacheTemizle(["cariListesi_v3"]);
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

  cacheTemizle(["alisListesi"]);
  return { ok: true };
}

// ★ EKLENDİ: Kullanıcının isteği üzerine — sistemdeki mükerrer stok kalemi sorunlu Alış
// Faturalarını toplu silip Bekleyen Alış Faturaları'ndan yeniden işlemek için.
// GÜVENLİK: Silmeden önce Alislar/AlisKalemleri/AlisFaturaDurum sayfalarının TAMAMININ ve
// StokHareketleri/CariHareketler sayfalarındaki Alışla ilgili satırların bir kopyasını
// "_YEDEK_<zaman damgası>" son ekli yeni sayfalara alır (silmez, sadece kopyalar) — bir
// şey ters giderse bu yedek sayfalardan elle geri yüklenebilir. body.onay !== true ise
// hiçbir şey silmeden sadece kaç kayıt etkileneceğini döndürür (kuru çalıştırma).
function tumAlislariSilVeSifirla(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const aData = aSheet.getDataRange().getValues();
  const idler = [];
  for (let i = 1; i < aData.length; i++) {
    const id = String(aData[i][0] || "");
    if (id) idler.push(id);
  }
  if (idler.length === 0) return { ok: true, silinen: 0, mesaj: "Silinecek Alış kaydı yok." };

  if (body && body.onay === true) {
    // Yedek: mevcut Alislar/AlisKalemleri/AlisFaturaDurum sayfalarını kopyala.
    const damga = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyyMMdd_HHmmss");
    [SHEETS.alislar, SHEETS.alisKalemleri, SHEETS.alisFaturaDurum].forEach(adi => {
      const kaynak = ss.getSheetByName(adi);
      if (kaynak) kaynak.copyTo(ss).setName(adi + "_YEDEK_" + damga);
    });

    let silinen = 0;
    idler.forEach(id => {
      const sonuc = silAlis({ id: id });
      if (sonuc.ok) silinen++;
    });
    cacheTemizle(["alisListesi", "stokHareketListesi", "cariListesi_v3"]);
    return { ok: true, silinen: silinen, toplam: idler.length, yedekEki: damga };
  }
  // Kuru çalıştırma: sadece bilgi ver, hiçbir şey silme.
  return { ok: true, kuruCalisma: true, silinecekSayi: idler.length };
}
//         kalemler: [{urunAdi,miktar,birim,birimFiyat,stokKodu (opsiyonel),
//                     stokKartiOlustur (opsiyonel)}] }
// Onaylanmış/aktarılmış bir Alış Faturası'nı ID'sini koruyarak günceller: önce
// silAlis'in ters mantığıyla eski stok hareketi + cari hareketi geri alınır
// (fakat alış satırı ve "Onaylandı" durum kaydı SİLİNMEZ), sonra saveAlis'in
// uygulama mantığıyla yeni değerler aynı ID üzerine yazılır.
function updateAlis(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

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
  const data = aSheet.getDataRange().getValues();

  let satirIdx = -1, eskiCariId = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { satirIdx = i + 1; eskiCariId = String(data[i][2] || ""); break; }
  }
  if (satirIdx === -1) return { ok: false, hata: "Alış bulunamadı" };

  // 1) ESKİ ETKİLERİ GERİ AL (silAlis'in aynısı, ama alış satırı ve "Onaylandı" durum
  // kaydı SİLİNMEZ — bu ikisi güncellemeden etkilenmemeli).
  stokHareketOtomatikSil(ss, id);

  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemStokKoduColonu(kSheet);
  ensureAlisKalemKdvColonu(kSheet);
  ensureAlisKalemBrutIskontoColonlari(kSheet);
  ensureAlisTutarIskontosuColonu(aSheet);
  ensureAlisProjeKoduColonu(aSheet);
  ensureAlisFaturaTipiColonu(aSheet);
  const kData = kSheet.getDataRange().getValues();
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

  if (eskiCariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === eskiCariId && String(hkData[i][5] || "").indexOf("ALIS:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  // 2) YENİ DEĞERLERİ AYNI ID ÜZERİNE UYGULA (saveAlis'in aynısı, appendRow yerine
  // mevcut satırın güncellenmesi — KAYIT_TARIHI orijinal oluşturma zamanı olarak korunur).
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

  let kalemGenelToplam = 0;
  kalemler.forEach(k => {
    const kdvOrani = parseFloat(k.kdvOrani) || 0;
    kalemGenelToplam += (parseFloat(k.miktar) || 0) * (parseFloat(k.birimFiyat) || 0) * (1 + kdvOrani / 100);
  });
  const tutarIskontosu = Math.max(0, parseFloat(body.tutarIskontosu) || 0);
  const toplamTutar = Math.max(0, kalemGenelToplam - tutarIskontosu);

  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = String(data[satirIdx - 1][7] || "");
  metinliSatirYaz_(aSheet, satirIdx, [id, tarih, cariId, cariAd, toplamTutar, String(body.odemeTipi || "Peşin"), String(body.aciklama || ""), kayitTarihi, tutarIskontosu, String(body.projeKodu || "").trim(), String(body.faturaTipi || "").trim()], [10, 11]);

  kalemler.forEach((k, idx) => {
    const kId = "ak_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    const kdvOrani = parseFloat(k.kdvOrani) || 0;
    const brutFiyat = parseFloat(k.brutFiyat) || birimFiyat;
    const iskontoYuzde = parseFloat(k.iskontoYuzde) || 0;
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat * (1 + kdvOrani / 100), String(k.stokKodu || "").trim(), kdvOrani, brutFiyat, iskontoYuzde]);
  });

  stokHareketOtomatikYaz(ss, kalemler, tarih, "Giriş", "Alış Faturası", id, "Alış Faturası — " + cariAd);

  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Alacak",
      tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("ALIS", id, "alis", body.aciklama),
      projeKodu: body.projeKodu,
    });
  }

  cacheTemizle(["alisListesi"]);
  return { ok: true, id: id, toplamTutar: toplamTutar };
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
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const cariId = String(row[2] || "");
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: cariId, cariAd: String(row[3] || ""),
      cariKodu: cariKoduMap[cariId] || "",
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
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisIadeKalemStokKoduColonu(kSheet);

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
      stokKodu: String(row[7] || ""),
    });
  }
  return { ok: true, iade: iade, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, aciklama, kalemler: [{urunAdi,miktar,birim,birimFiyat,stokKodu,stoksuz}] }
function saveAlisIade(body) {
  const kalemler = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (kalemler.length === 0) return { ok: false, hata: "En az bir ürün kalemi eklemelisiniz" };
  for (const k of kalemler) {
    if (!String(k.urunAdi || "").trim()) return { ok: false, hata: "Kalemlerde ürün adı gerekli" };
    if (!(parseFloat(k.miktar) > 0)) return { ok: false, hata: "Kalemlerde miktar sıfırdan büyük olmalı" };
    if (!(parseFloat(k.birimFiyat) >= 0)) return { ok: false, hata: "Kalemlerde birim fiyat geçersiz" };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const stokHata = kalemlerStokKoduDogrula(ss, kalemler);
  if (stokHata) return { ok: false, hata: stokHata };
  const aSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisIadeKalemStokKoduColonu(kSheet);

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
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, String(k.stokKodu || "").trim()]);
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

  const kSheetOn = getOrCreateSheet(ss, SHEETS.alisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisIadeKalemStokKoduColonu(kSheetOn);
  const kDataOn = kSheetOn.getDataRange().getValues();
  const anlikKalemler = [];
  for (let i = 1; i < kDataOn.length; i++) {
    if (String(kDataOn[i][1]) === id) {
      anlikKalemler.push({
        urunAdi: String(kDataOn[i][2] || ""), miktar: parseFloat(kDataOn[i][3]) || 0,
        birim: String(kDataOn[i][4] || "adet"), birimFiyat: parseFloat(kDataOn[i][5] || 0),
        stokKodu: String(kDataOn[i][7] || ""),
      });
    }
  }

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      cariId = String(row[2] || "");
      if (!body._geriAlmadanKaydetme) {
        const aciklamaMetni = String(row[5] || "");
        silinenlerKaydet("ALISIADE", id, "Alış İadesi", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, cariAd: String(row[3] || ""), tarih: hucreTarihStr(row[1]),
          aciklama: aciklamaMetni, kalemler: anlikKalemler,
        }, belgeNoAciklamadanCikar_(aciklamaMetni));
      }
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
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  return { ok: true };
}

// ════════════════════════════════════════════════
// SATIŞ İADESİ (Satış > İade — müşteriden geri alınan mal)
// Önceden Satış tarafında "İade" diye bir belge tipi/modül HİÇ yoktu (Alış'ta
// Giriş/İade ayrımı varken Satış'ta sadece Fatura/Teklif/Sipariş vardı) — müşteriden
// mal geri geldiğinde stoğa giriş yazacak standart bir akış mevcut değildi.
// Alış İadesi'nin birebir aynası: iade yapılınca müşterinin bize olan borcu AZALIR
// (cariye "Alacak" hareketi eklenir — Satış'ta "Borç" eklenmesinin tam tersi),
// stok tarafında ise mal depoya GERİ DÖNDÜĞÜ için "Giriş" yazılır.
// ════════════════════════════════════════════════

function getSatisIadeListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sSheet.getDataRange().getValues();
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const cariId = String(row[2] || "");
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: cariId, cariAd: String(row[3] || ""),
      cariKodu: cariKoduMap[cariId] || "",
      toplamTutar: parseFloat(row[4]) || 0, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, iadeler: sonuc };
}

function getSatisIadeDetay(iadeId) {
  if (!iadeId) return { ok: false, hata: "iadeId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);

  const data = sSheet.getDataRange().getValues();
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
      stokKodu: String(row[7] || ""),
    });
  }
  return { ok: true, iade: iade, kalemler: kalemler };
}

// body: { cariId (opsiyonel), cariAd, tarih, aciklama, kalemler: [{urunAdi,miktar,birim,birimFiyat,stokKodu,stoksuz}] }
function saveSatisIade(body) {
  const kalemler = Array.isArray(body.kalemler) ? body.kalemler : [];
  if (kalemler.length === 0) return { ok: false, hata: "En az bir ürün kalemi eklemelisiniz" };
  for (const k of kalemler) {
    if (!String(k.urunAdi || "").trim()) return { ok: false, hata: "Kalemlerde ürün adı gerekli" };
    if (!(parseFloat(k.miktar) > 0)) return { ok: false, hata: "Kalemlerde miktar sıfırdan büyük olmalı" };
    if (!(parseFloat(k.birimFiyat) >= 0)) return { ok: false, hata: "Kalemlerde birim fiyat geçersiz" };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const stokHata = kalemlerStokKoduDogrula(ss, kalemler);
  if (stokHata) return { ok: false, hata: stokHata };
  const sSheet = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);

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

  let toplamTutar = 0;
  kalemler.forEach(k => { toplamTutar += (parseFloat(k.miktar) || 0) * (parseFloat(k.birimFiyat) || 0); });

  const id = "sti_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  sSheet.appendRow([id, tarih, cariId, cariAd, toplamTutar, String(body.aciklama || ""), kayitTarihi]);

  kalemler.forEach((k, idx) => {
    const kId = "stik_" + Date.now() + "_" + idx;
    const miktar = parseFloat(k.miktar) || 0;
    const birimFiyat = parseFloat(k.birimFiyat) || 0;
    kSheet.appendRow([kId, id, String(k.urunAdi).trim(), miktar, String(k.birim || "adet"), birimFiyat, miktar * birimFiyat, String(k.stokKodu || "").trim()]);
  });

  // Satış İadesi = müşteriden geri alınan mal = depoya Giriş.
  stokHareketOtomatikYaz(ss, kalemler, tarih, "Giriş", "Satış İadesi", id, "Satış İadesi — " + cariAd);

  // Cari seçildiyse, tutar kadar Alacak hareketi ekle (müşteriye olan borcu/bize borcu azalır).
  if (cariId) {
    cariHareketEkle({
      cariId: cariId,
      tarih: tarih,
      tip: "Alacak",
      tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("SATISIADE", id, "satisiade", body.aciklama),
    });
  }

  cacheTemizle(["satisListesi"]);
  return { ok: true, id: id, toplamTutar: toplamTutar };
}

// body: { id }
function silSatisIade(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const data = sSheet.getDataRange().getValues();

  const kSheetOn = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  const kDataOn = kSheetOn.getDataRange().getValues();
  const anlikKalemler = [];
  for (let i = 1; i < kDataOn.length; i++) {
    if (String(kDataOn[i][1]) === id) {
      anlikKalemler.push({
        urunAdi: String(kDataOn[i][2] || ""), miktar: parseFloat(kDataOn[i][3]) || 0,
        birim: String(kDataOn[i][4] || "adet"), birimFiyat: parseFloat(kDataOn[i][5] || 0),
        stokKodu: String(kDataOn[i][7] || ""),
      });
    }
  }

  let cariId = "";
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      cariId = String(row[2] || "");
      if (!body._geriAlmadanKaydetme) {
        const aciklamaMetni = String(row[5] || "");
        silinenlerKaydet("SATISIADE", id, "Satış İadesi", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, cariAd: String(row[3] || ""), tarih: hucreTarihStr(row[1]),
          aciklama: aciklamaMetni, kalemler: anlikKalemler,
        }, belgeNoAciklamadanCikar_(aciklamaMetni));
      }
      sSheet.deleteRow(i + 1);
      bulundu = true;
      break;
    }
  }
  if (!bulundu) return { ok: false, hata: "İade bulunamadı" };

  // Bu iadenin otomatik yazdığı Stok Hareket Raporu satırlarını da geri al.
  stokHareketOtomatikSil(ss, id);

  const kSheet = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  const kData = kSheet.getDataRange().getValues();
  for (let i = kData.length - 1; i >= 1; i--) {
    if (String(kData[i][1]) === id) kSheet.deleteRow(i + 1);
  }

  if (cariId) {
    const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
      ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    const hkData = hkSheet.getDataRange().getValues();
    for (let i = hkData.length - 1; i >= 1; i--) {
      if (String(hkData[i][1]) === cariId && String(hkData[i][5] || "").indexOf("SATISIADE:" + id) === 0) {
        hkSheet.deleteRow(i + 1);
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  cacheTemizle(["satisListesi"]);
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
  // Önceden Havale/EFT tahsilatlarında bankaHesapId hiç kalıcı tutulmuyordu (sadece
  // BankaHesapHareketleri'ne yazılıp unutuluyordu) — bu da silme/geri alma sırasında
  // hangi hesaba geri Giriş yazılacağının bilinmemesine yol açardı.
  const mevcutBaslik2 = sheet.getRange(1, 10).getValue();
  if (String(mevcutBaslik2 || "") !== "BANKA_HESAP_ID") {
    sheet.getRange(1, 10).setValue("BANKA_HESAP_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
  const mevcutBaslik3 = sheet.getRange(1, 11).getValue();
  if (String(mevcutBaslik3 || "") !== "PROJE_KODU") {
    sheet.getRange(1, 11).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 11);
}

function getTahsilatListesi() {
  return cacheOkuVeyaHesapla("tahsilatListesi", 60, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"]);
  ensureTahsilatPosColonu(tSheet);
  const data = tSheet.getDataRange().getValues();
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const cariId = String(row[2] || "");
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: cariId, cariAd: String(row[3] || ""),
      cariKodu: cariKoduMap[cariId] || "",
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]), posHesapId: String(row[8] || ""),
      projeKodu: metinOku_(row[10]),
    });
  }
  sonuc.reverse();
  return { ok: true, tahsilatlar: sonuc };
  });
}

// body: { cariId, tarih, tutar, yontem, aciklama, posHesapId (yöntem "Kredi Kartı" ise) }
function saveTahsilat(body) {
  const cariId = String(body.cariId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!cariId) return { ok: false, hata: "Cari seçimi gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const yontem = String(body.yontem || "Nakit");
  const posHesapId = String(body.posHesapId || "").trim();
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  // Kredi Kartı/Havale seçilip karşı hesap belirtilmezse cari tarafı tek başına
  // yazılır ama POS/Banka hesabında hiç iz kalmaz — bu yüzden burada zorunlu kılınıyor.
  if (yontem === "Kredi Kartı" && !posHesapId) return { ok: false, hata: "Kredi Kartı ile tahsilatta POS hesabı seçimi zorunludur" };
  if (yontem === "Havale/EFT" && !bankaHesapId) return { ok: false, hata: "Havale/EFT ile tahsilatta banka hesabı seçimi zorunludur" };

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
  metinliSatirEkle_(tSheet, [id, tarih, cariId, cariAd, tutar, yontem, String(body.aciklama || ""), kayitTarihi, posHesapId, bankaHesapId, String(body.projeKodu || "").trim()], [11]);

  cariHareketEkle({
    cariId: cariId, tarih: tarih, tip: "Alacak", tutar: tutar,
    aciklama: cariHareketAciklamaOlustur("TAHSILAT", id, "tahsilat_" + yontem, body.aciklama),
    projeKodu: body.projeKodu,
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

  cacheTemizle(["tahsilatListesi"]);
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
  const silSonuc = silTahsilat({ id, _geriAlmadanKaydetme: true });
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
      const row = data[i];
      cariId = String(row[2] || "");
      // Silmeden önce "Silinenler"e, aynı tahsilatı yeniden oluşturmaya yetecek veriyle kaydet.
      if (!body._geriAlmadanKaydetme) {
        silinenlerKaydet("TAHSILAT", id, "Tahsilat (" + String(row[5] || "") + ")", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, tutar: parseFloat(row[4]) || 0, tarih: hucreTarihStr(row[1]),
          yontem: String(row[5] || ""), aciklama: String(row[6] || ""),
          posHesapId: String(row[8] || ""), bankaHesapId: String(row[9] || ""),
        });
      }
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
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  // Kredi kartı tahsilatıyla birlikte bir POS hesabına düşülmüş BORÇ kaydı varsa geri al.
  posHareketSilByAciklamaOnPrefix("TAHSILAT:" + id);
  bankaHesapHareketSilByAciklamaOnPrefix("TAHSILAT:" + id);

  cacheTemizle(["tahsilatListesi"]);
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
  // HEDEF_TIPI: "Cari" (varsayılan/eski kayıtlar) | "Banka" | "Gider" — ödeme kime/nereye yapıldı.
  // HEDEF_ALT_TIPI: yalnızca HEDEF_TIPI="Banka" için "hesap" | "kart".
  // HEDEF_ID / HEDEF_AD: Banka için bankaHesapId veya krediKartiId ve adı; Gider için giderAltGrup
  // (veya sadece üst grup) id'si ve "Üst Grup > Alt Grup" biçiminde adı.
  const basliklar = ["HEDEF_TIPI", "HEDEF_ALT_TIPI", "HEDEF_ID", "HEDEF_AD"];
  basliklar.forEach((baslik, idx) => {
    const kolon = 11 + idx;
    const mevcut = sheet.getRange(1, kolon).getValue();
    if (String(mevcut || "") !== baslik) {
      sheet.getRange(1, kolon).setValue(baslik).setFontWeight("bold").setBackground("#e8edf5");
    }
  });
  const projeKoduBaslik = sheet.getRange(1, 15).getValue();
  if (String(projeKoduBaslik || "") !== "PROJE_KODU") {
    sheet.getRange(1, 15).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 15);
}

function getOdemeListesi() {
  return cacheOkuVeyaHesapla("odemeListesi", 60, function () {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
  ensureOdemePosBankaColonlari(oSheet);
  const data = oSheet.getDataRange().getValues();
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "");
    if (!id) continue;
    const cariId = String(row[2] || "");
    const cariAd = String(row[3] || "");
    const hedefTipi = String(row[10] || "") || "Cari";
    const hedefAd = String(row[13] || "");
    sonuc.push({
      id: id, tarih: hucreTarihStr(row[1]), cariId: cariId, cariAd: cariAd || hedefAd || "—",
      cariKodu: (hedefTipi === "Cari") ? (cariKoduMap[cariId] || "") : "",
      tutar: parseFloat(row[4]) || 0, yontem: String(row[5] || ""),
      aciklama: String(row[6] || ""), kayitTarihi: hucreTarihStr(row[7]),
      hedefTipi: hedefTipi, hedefAltTipi: String(row[11] || ""), hedefId: String(row[12] || ""), hedefAd: hedefAd,
      projeKodu: metinOku_(row[14]),
    });
  }
  sonuc.reverse();
  return { ok: true, odemeler: sonuc };
  });
}

// body: { cariId (hedefTipi="Cari" ise zorunlu), tarih, tutar, yontem, aciklama, posHesapId, bankaHesapId,
//         hedefTipi ("Cari"|"Banka"|"Gider", varsayılan "Cari"),
//         hedefAltTipi (hedefTipi="Banka" ise "hesap"|"kart"),
//         hedefId (hedefTipi="Banka" ise bankaHesapId/krediKartiId; hedefTipi="Gider" ise giderAltGrup veya giderUstGrup id'si),
//         giderUstId (hedefTipi="Gider" ise, hedefId bir alt grupsa üst grubu; hedefId zaten üst grupsa boş bırakılabilir) }
function saveOdeme(body) {
  const hedefTipi = String(body.hedefTipi || "Cari");
  const tutar = parseFloat(body.tutar) || 0;
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };
  if (!["Cari", "Banka", "Gider"].includes(hedefTipi)) return { ok: false, hata: "Geçersiz hedef tipi" };

  const yontem = String(body.yontem || "Nakit");
  const posHesapId = String(body.posHesapId || "").trim();
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  // Kredi Kartı/Havale seçilip kaynak POS/Banka hesabı belirtilmezse ödeme
  // sadece cari/gider tarafına yazılır, hangi hesaptan çıktığı hiç görünmez.
  if (yontem === "Kredi Kartı" && !posHesapId) return { ok: false, hata: "Kredi Kartı ile ödemede POS hesabı seçimi zorunludur" };
  if (yontem === "Havale/EFT" && !bankaHesapId) return { ok: false, hata: "Havale/EFT ile ödemede banka hesabı seçimi zorunludur" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  let cariId = "", cariAd = "";
  let hedefAltTipi = "", hedefId = "", hedefAd = "";

  if (hedefTipi === "Cari") {
    cariId = String(body.cariId || "").trim();
    if (!cariId) return { ok: false, hata: "Cari seçimi gerekli" };
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH"]);
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === cariId) { cariAd = String(cData[i][2] || ""); break; }
    }
    if (!cariAd) return { ok: false, hata: "Cari bulunamadı" };
  } else if (hedefTipi === "Banka") {
    hedefAltTipi = String(body.hedefAltTipi || "");
    hedefId = String(body.hedefId || "").trim();
    if (!hedefId || (hedefAltTipi !== "hesap" && hedefAltTipi !== "kart")) {
      return { ok: false, hata: "Banka hesabı veya kredi kartı seçimi gerekli" };
    }
    if (hedefAltTipi === "hesap") {
      const hSheet = getOrCreateSheet(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
      const bSheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
      const hData = hSheet.getDataRange().getValues();
      const bData = bSheet.getDataRange().getValues();
      for (let i = 1; i < hData.length; i++) {
        if (String(hData[i][0]) === hedefId) {
          let bankaAdi = "";
          for (let j = 1; j < bData.length; j++) { if (String(bData[j][0]) === String(hData[i][1])) { bankaAdi = String(bData[j][1] || ""); break; } }
          hedefAd = (bankaAdi ? bankaAdi + " — " : "") + String(hData[i][2] || "");
          break;
        }
      }
    } else {
      const kSheet = getOrCreateSheet(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);
      const bSheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
      const kData = kSheet.getDataRange().getValues();
      const bData = bSheet.getDataRange().getValues();
      for (let i = 1; i < kData.length; i++) {
        if (String(kData[i][0]) === hedefId) {
          let bankaAdi = "";
          for (let j = 1; j < bData.length; j++) { if (String(bData[j][0]) === String(kData[i][1])) { bankaAdi = String(bData[j][1] || ""); break; } }
          hedefAd = (bankaAdi ? bankaAdi + " — " : "") + String(kData[i][2] || "");
          break;
        }
      }
    }
    if (!hedefAd) return { ok: false, hata: "Seçilen banka hesabı/kredi kartı bulunamadı" };
  } else {
    // Gider
    hedefId = String(body.hedefId || "").trim();
    if (!hedefId) return { ok: false, hata: "Gider grubu seçimi gerekli" };
    const ustSheet = getOrCreateSheet(ss, SHEETS.giderUstGruplari, BASIT_TANIM_BASLIKLAR);
    const altSheet = getOrCreateSheet(ss, SHEETS.giderAltGruplari, BASIT_TANIM_BASLIKLAR);
    const ustData = ustSheet.getDataRange().getValues();
    const altData = altSheet.getDataRange().getValues();
    let altKaydi = null;
    for (let i = 1; i < altData.length; i++) { if (String(altData[i][0]) === hedefId) { altKaydi = altData[i]; break; } }
    if (altKaydi) {
      let ustAdi = "";
      for (let i = 1; i < ustData.length; i++) { if (String(ustData[i][0]) === String(altKaydi[2])) { ustAdi = String(ustData[i][1] || ""); break; } }
      hedefAd = (ustAdi ? ustAdi + " > " : "") + String(altKaydi[1] || "");
    } else {
      for (let i = 1; i < ustData.length; i++) { if (String(ustData[i][0]) === hedefId) { hedefAd = String(ustData[i][1] || ""); break; } }
    }
    if (!hedefAd) return { ok: false, hata: "Seçilen gider grubu bulunamadı" };
  }

  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
  ensureOdemePosBankaColonlari(oSheet);
  const id = "od_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  metinliSatirEkle_(oSheet, [id, tarih, cariId, cariAd, tutar, yontem, String(body.aciklama || ""), kayitTarihi, posHesapId, bankaHesapId,
    hedefTipi, hedefAltTipi, hedefId, hedefAd, String(body.projeKodu || "").trim()], [15]);

  // Cariye borç hareketi yalnızca hedef bir Cari ise düşülür (Banka/Gider hedefli
  // ödemelerin bağlı olduğu bir cari hesap yok).
  if (hedefTipi === "Cari") {
    cariHareketEkle({
      cariId: cariId, tarih: tarih, tip: "Borç", tutar: tutar,
      aciklama: cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama),
      projeKodu: body.projeKodu,
    });
  }

  // Kredi Kartı ile ödeme yapıldıysa ve bir POS hesabı seçildiyse, o hesaba
  // Alacak kaydı düşülür (Tahsilat'ın tam tersi yönde — kartla ödeme yaptık).
  if (yontem === "Kredi Kartı" && posHesapId) {
    posHareketEkle(posHesapId, tarih, "Alacak", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama));
  }

  // Havale/EFT ile ödeme yapıldıysa ve bir banka hesabı seçildiyse, o hesaptan Çıkış kaydı düşülür.
  if (yontem === "Havale/EFT" && bankaHesapId) {
    bankaHesapHareketEkle(bankaHesapId, tarih, "Çıkış", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_" + yontem, body.aciklama));
  }

  // Ödeme Hedefi "Banka / Kredi Kartı" ise, yukarıdaki Yöntem bloğu paranın
  // NEREDEN çıktığını (kaynak POS/banka hesabı) işler; burada da paranın
  // NEREYE gittiği (hedef banka hesabı veya kredi kartı) ayrıca kaydedilir.
  // Böylece iki taraflı hareket eksiksiz oluşur — önceden hedefAd sadece
  // görüntüleme amaçlı tutuluyor, hiçbir hesaba işlenmiyordu.
  if (hedefTipi === "Banka" && hedefAltTipi === "hesap" && hedefId) {
    bankaHesapHareketEkle(hedefId, tarih, "Giriş", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_hedefBankaHesap", body.aciklama));
  } else if (hedefTipi === "Banka" && hedefAltTipi === "kart" && hedefId) {
    krediKartHareketEkle(hedefId, tarih, "Ödeme", tutar, cariHareketAciklamaOlustur("ODEME", id, "odeme_hedefKrediKarti", body.aciklama));
  }

  cacheTemizle(["odemeListesi"]);
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
      const row = data[i];
      cariId = String(row[2] || "");
      if (!body._geriAlmadanKaydetme) {
        const hedefTipi = String(row[10] || "Cari");
        const baslik = "Ödeme (" + (hedefTipi === "Cari" ? String(row[3] || "") : String(row[13] || hedefTipi)) + ")";
        silinenlerKaydet("ODEME", id, baslik, String(row[3] || ""), parseFloat(row[4]) || 0, {
          hedefTipi: hedefTipi, tutar: parseFloat(row[4]) || 0, tarih: hucreTarihStr(row[1]),
          yontem: String(row[5] || ""), aciklama: String(row[6] || ""),
          posHesapId: String(row[8] || ""), bankaHesapId: String(row[9] || ""),
          cariId: String(row[2] || ""), hedefAltTipi: String(row[11] || ""), hedefId: String(row[12] || ""),
        });
      }
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
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  // Kredi kartı/havale ile birlikte POS ya da banka hesabına düşülmüş kaydı(ları) varsa geri al.
  // (Hedef "Banka/Kredi Kartı" ise aynı ödeme hem kaynak hem hedef hesaba bir satır
  // yazmış olabilir — bu yüzden alttaki fonksiyonlar TÜM eşleşen satırları siler.)
  posHareketSilByAciklamaOnPrefix("ODEME:" + id);
  bankaHesapHareketSilByAciklamaOnPrefix("ODEME:" + id);
  krediKartHareketSilByAciklamaOnPrefix("ODEME:" + id);

  cacheTemizle(["odemeListesi"]);
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
  return cacheOkuVeyaHesapla("cekSenetListesi", 60, function () {
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
      belgeTuru: String(row[15] || "") === "Senet" ? "Senet" : "Çek",
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
  });
}

// Bir carinin tüm çek/senet kayıtlarını döner — Cari detayındaki "🧾 Çek/Senet"
// bölümünün "Kayıtlar" kutusu için (bkz. getCariSiparisListesi ile aynı desen).
function getCariCekSenetListesi(cariId) {
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const res = getCekSenetListesi();
  if (!res.ok) return res;
  return { ok: true, cekSenetler: res.cekSenetler.filter(c => c.cariId === String(cariId)) };
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
        projeKodu: metinOku_(row[14]),
        belgeTuru: String(row[15] || "") === "Senet" ? "Senet" : "Çek",
        yaprakId: String(row[16] || ""),
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
  ensureCekSenetProjeKoduColonu(sheet);
  ensureCekSenetBelgeTuruColonu(sheet);
  ensureCekSenetYaprakColonu(sheet);
  // Aynı milisaniyede toplu kayıt yapılırsa ID çakışmasın diye sayaçlı benzersizleştirme.
  const id = "cs_" + Date.now() + (body._sira ? "_" + body._sira : "");
  const belgeTuru = String(body.belgeTuru || "Çek") === "Senet" ? "Senet" : "Çek";
  const duzenlenmeTarihi = String(body.duzenlenmeTarihi || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const vade = String(body.vade || "");
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");

  // VERİLEN ÇEK: kendi çek koçanımızdan boş bir yaprak seçilir (yaprakId) — çek no/banka yapraktan gelir.
  // (Yeni ekran yaprakZorunlu:true gönderir; Silinenler'den geri yükleme gibi eski akışlar zorunlu değildir,
  // banka+çek no bir boş yaprakla eşleşirse otomatik bağlanır.)
  let yaprak = null, seriNo = String(body.seriNo || ""), bankaAdi = String(body.bankaAdi || "");
  if (tip === "Verilen" && belgeTuru === "Çek") {
    const sonuc = cekYaprakAyir_(ss, { yaprakId: body.yaprakId, bankaAdi: bankaAdi, seriNo: seriNo, zorunlu: !!body.yaprakZorunlu }, id);
    if (!sonuc.ok) return sonuc;
    yaprak = sonuc.yaprak;
    if (yaprak) { seriNo = yaprak.cekNo; bankaAdi = yaprak.bankaAdi; }
  }
  try {
    metinliSatirEkle_(sheet, [id, tip, cariId, cariAd, tutar, tutar, seriNo, bankaAdi,
      duzenlenmeTarihi, vade, "Portföyde", String(body.aciklama || ""), kayitTarihi, "", String(body.projeKodu || "").trim(), belgeTuru, yaprak ? yaprak.id : ""], [7, 15]);

    // Alınan çek: müşteriden aldık → borcu kapanır (Alacak). Verilen çek: tedarikçiye borcumuzu kapattık (Borç).
    cariHareketEkle({
      cariId: cariId, tarih: duzenlenmeTarihi, tip: tip === "Alınan" ? "Alacak" : "Borç", tutar: tutar,
      aciklama: cariHareketAciklamaOlustur("CEK", id, tip === "Alınan" ? "cek_alinan" : "cek_verilen", body.aciklama),
      vade: vade,
      projeKodu: body.projeKodu,
    });
  } catch (e) {
    if (yaprak) cekYaprakBirak_(ss, id); // kayıt yazılamadıysa yaprak boşa dönsün
    throw e;
  }

  cacheTemizle(["cekSenetListesi"]);
  return { ok: true, id: id };
}

// YAPRAK_ID (17. kolon) — Verilen çekin hangi çek koçanı yaprağından (CekYapraklari) çıkış yapıldığını tutar.
function ensureCekSenetYaprakColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 17).getValue();
  if (String(mevcutBaslik || "") !== "YAPRAK_ID") {
    sheet.getRange(1, 17).setValue("YAPRAK_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// ════════════════════════════════════════════════
// ÇEK KOÇANI / ÇEK YAPRAKLARI — bankadan çek koçanı alınınca boş çek yaprakları ÇEK NUMARASI ile tanımlanır.
// Banka, Finans > Banka Tanımlamaları'nda tanımlı bankalardan seçilir. Verilen (kendi) çeklerimiz bu yapraklardan
// seçilerek çıkış yapılır: yaprak "Boş" → "Kullanıldı" olur (KULLANILAN_CEK_ID). Çek silinirse yaprak tekrar "Boş" olur.
// Durumlar: Boş / Kullanıldı / İptal (zayi, bozuk vb. — seçilemez).
// ════════════════════════════════════════════════
const CEK_YAPRAK_BASLIKLAR = ["ID","BANKA_ID","BANKA_ADI","CEK_NO","DURUM","KULLANILAN_CEK_ID","KOCAN_ID","KAYIT_TARIHI"];

function cekYaprakSheet_(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.cekYapraklari, CEK_YAPRAK_BASLIKLAR);
  metinKolonuGarantiEt_(sheet, 4); // çek no metin: baştaki sıfırlar (0012345) korunsun
  return sheet;
}

function cekYaprakSatirObj_(row) {
  return { id: String(row[0]), bankaId: String(row[1] || ""), bankaAdi: String(row[2] || ""), cekNo: metinOku_(row[3]),
    durum: String(row[4] || "Boş"), kullanilanCekId: String(row[5] || ""), kocanId: String(row[6] || ""), kayitTarihi: String(row[7] || "") };
}

// body: { bankaId?, durum? }
function getCekYapraklari(body) {
  body = body || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const data = cekYaprakSheet_(ss).getDataRange().getValues();
  const bankaId = String(body.bankaId || ""), durum = String(body.durum || "");
  const liste = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const y = cekYaprakSatirObj_(data[i]);
    if (bankaId && y.bankaId !== bankaId) continue;
    if (durum && y.durum !== durum) continue;
    liste.push(y);
  }
  liste.sort((a, b) => a.bankaAdi.localeCompare(b.bankaAdi, "tr") || String(a.cekNo).localeCompare(String(b.cekNo), "tr", { numeric: true }));
  return { ok: true, yapraklar: liste };
}

// body: { bankaId, cekNolari: [ "0012345", ... ] (veya satır/virgülle ayrılmış metin) }
function saveCekKocani(body) {
  const bankaId = String(body.bankaId || "").trim();
  if (!bankaId) return { ok: false, hata: "Banka seçimi gerekli (Finans > Banka Tanımlamaları'ndaki bankalardan)" };
  let nolar = body.cekNolari;
  if (!Array.isArray(nolar)) nolar = String(nolar || "").split(/[\s,;]+/);
  const temiz = [], gorulen = {};
  nolar.forEach(n => { const t = String(n || "").trim(); if (t && !gorulen[t]) { gorulen[t] = 1; temiz.push(t); } });
  if (!temiz.length) return { ok: false, hata: "En az bir çek numarası girin" };
  if (temiz.length > 500) return { ok: false, hata: "Tek seferde en fazla 500 çek yaprağı tanımlanabilir" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const bSheet = getOrCreateSheet(ss, SHEETS.bankalar, ["ID","AD"]);
  const bData = bSheet.getDataRange().getValues();
  let bankaAdi = "";
  for (let i = 1; i < bData.length; i++) if (String(bData[i][0]) === bankaId) { bankaAdi = String(bData[i][1] || ""); break; }
  if (!bankaAdi) return { ok: false, hata: "Seçilen banka tanımlı değil" };

  const sheet = cekYaprakSheet_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = sheet.getDataRange().getValues();
    const mevcut = {};
    for (let i = 1; i < data.length; i++) if (String(data[i][1]) === bankaId) mevcut[String(metinOku_(data[i][3]))] = true;
    const eklenecek = temiz.filter(n => !mevcut[n]);
    const atlanan = temiz.filter(n => mevcut[n]);
    if (eklenecek.length) {
      const kocanId = "kc_" + Date.now();
      const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
      const bas = sheet.getLastRow() + 1;
      if (bas + eklenecek.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), bas + eklenecek.length - 1 - sheet.getMaxRows());
      const satirlar = eklenecek.map((n, k) => ["cy_" + Date.now() + "_" + k, bankaId, bankaAdi, n, "Boş", "", kocanId, simdi]);
      const aralik = sheet.getRange(bas, 1, satirlar.length, CEK_YAPRAK_BASLIKLAR.length);
      aralik.setNumberFormat("@"); // tüm hücreler metin (çek no'daki sıfırlar bozulmasın)
      aralik.setValues(satirlar);
    }
    return { ok: true, eklenen: eklenecek.length, atlanan: atlanan };
  } finally { lock.releaseLock(); }
}

// body: { id } — yalnız "Boş" yaprak silinebilir.
function silCekYaprak(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = cekYaprakSheet_(ss);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) !== id) continue;
    if (String(data[i][4] || "Boş") === "Kullanıldı") return { ok: false, hata: "Bu yaprak bir çekte kullanılmış; önce o çek silinmeli." };
    sheet.deleteRow(i + 1);
    return { ok: true };
  }
  return { ok: false, hata: "Yaprak bulunamadı" };
}

// body: { id, durum: "İptal" | "Boş" } — kullanılmış yaprağın durumu değiştirilemez.
function cekYaprakDurumGuncelle(body) {
  const id = String(body.id || "").trim(), durum = String(body.durum || "");
  if (durum !== "İptal" && durum !== "Boş") return { ok: false, hata: "Geçersiz durum" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = cekYaprakSheet_(ss);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== id) continue;
    if (String(data[i][4] || "Boş") === "Kullanıldı") return { ok: false, hata: "Kullanılmış yaprağın durumu değiştirilemez." };
    sheet.getRange(i + 1, 5).setValue(durum);
    return { ok: true };
  }
  return { ok: false, hata: "Yaprak bulunamadı" };
}

// Verilen çek kaydedilirken yaprağı ayırır (KİLİT ALTINDA "Boş" → "Kullanıldı"). Dönüş: {ok, yaprak|null} veya {ok:false, hata}.
// opts: { yaprakId, bankaAdi, seriNo, zorunlu }
function cekYaprakAyir_(ss, opts, cekId) {
  const sheet = cekYaprakSheet_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = sheet.getDataRange().getValues();
    let idx = -1;
    if (opts.yaprakId) {
      for (let i = 1; i < data.length; i++) if (String(data[i][0]) === String(opts.yaprakId)) { idx = i; break; }
      if (idx < 0) return { ok: false, hata: "Seçilen çek yaprağı bulunamadı" };
      const durum = String(data[idx][4] || "Boş");
      if (durum !== "Boş") return { ok: false, hata: "Çek no " + metinOku_(data[idx][3]) + " yaprağı artık boş değil (" + durum + "); başka bir yaprak seçin." };
    } else if (opts.seriNo && opts.bankaAdi) {
      const b = String(opts.bankaAdi).replace(/[İIıi]/g,"i").toLocaleLowerCase("tr"), n = String(opts.seriNo);
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]).replace(/[İIıi]/g,"i").toLocaleLowerCase("tr") === b && String(metinOku_(data[i][3])) === n && String(data[i][4] || "Boş") === "Boş") { idx = i; break; }
      }
    }
    if (idx < 0) {
      if (opts.zorunlu) return { ok: false, hata: "Verilen çek için çek koçanından boş bir yaprak seçin (Çek/Senet > 📒 Çek Koçanları'ndan tanımlayın)." };
      return { ok: true, yaprak: null };
    }
    sheet.getRange(idx + 1, 5, 1, 2).setValues([["Kullanıldı", String(cekId)]]);
    const y = cekYaprakSatirObj_(data[idx]);
    return { ok: true, yaprak: y };
  } finally { lock.releaseLock(); }
}

// Çek silinince (veya geri alınınca) yaprağı tekrar "Boş" yapar.
function cekYaprakBirak_(ss, cekId) {
  try {
    const sheet = cekYaprakSheet_(ss);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]) === String(cekId) && String(data[i][4]) === "Kullanıldı") {
        sheet.getRange(i + 1, 5, 1, 2).setValues([["Boş", ""]]);
      }
    }
  } catch (e) { /* yaprak serbest bırakılamasa da silme işlemi engellenmesin */ }
}

// CIRO_CARI_ID (14. kolon) — çek/senet ciro edildiğinde hangi cariye devredildiğini
// tutar. Önceden ciro işleminde hedef cari hiç seçilmiyordu, sadece durum
// "Ciro Edildi" yapılıyordu — o cariye borç kaydı da düşülmüyordu.
function ensureCekSenetCiroColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 14).getValue();
  if (String(mevcutBaslik || "") !== "CIRO_CARI_ID") {
    sheet.getRange(1, 14).setValue("CIRO_CARI_ID").setFontWeight("bold").setBackground("#e8edf5");
  }
}

function ensureCekSenetProjeKoduColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 15).getValue();
  if (String(mevcutBaslik || "") !== "PROJE_KODU") {
    sheet.getRange(1, 15).setValue("PROJE_KODU").setFontWeight("bold").setBackground("#e8edf5");
  }
  metinKolonuGarantiEt_(sheet, 15);
}

// BELGE_TURU (16. kolon) — bu kaydın gerçekte bir "Çek" mi yoksa "Senet" mi olduğunu
// tutar. Önceden modülün adı "Çek/Senet" olmasına rağmen bu ayrım hiç tutulmuyordu,
// sadece Alınan/Verilen yönü (TIP) vardı. Eski kayıtlarda bu alan boş gelir — arayüz
// boşu "Çek" gibi gösterir (varsayılan).
function ensureCekSenetBelgeTuruColonu(sheet) {
  const mevcutBaslik = sheet.getRange(1, 16).getValue();
  if (String(mevcutBaslik || "") !== "BELGE_TURU") {
    sheet.getRange(1, 16).setValue("BELGE_TURU").setFontWeight("bold").setBackground("#e8edf5");
  }
}

// body: { id, durum ("Karşılıksız" veya "Ciro Edildi"), aciklama, ciroCariId (Ciro Edildi ise zorunlu) }
// Portföydeki bir çek/senedi tahsil/ödeme yapılmadan kapatır. "Ciro Edildi" durumunda,
// çek başka bir cariye devredilmiş demektir — o cariye Borç hareketi düşülür (biz o
// cariye artık nakit yerine bu çekle ödeme yapmış oluyoruz, borcumuz azalır).
// "Karşılıksız" durumunda cari bakiyesine dokunulmaz (o hareket kayıt anında zaten
// işlenmişti; karşılıksız çıkması ayrı bir tahsilat/icra sürecidir, burada ele alınmıyor).
function cekSenetDurumGuncelle(body) {
  const id = String(body.id || "").trim();
  const durum = String(body.durum || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  if (durum !== "Karşılıksız" && durum !== "Ciro Edildi") return { ok: false, hata: "Geçersiz durum" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  ensureCekSenetCiroColonu(sheet);
  const data = sheet.getDataRange().getValues();
  let rowIdx = -1, mevcutDurum = "", tip = "", kalanTutar = 0, cekTarih = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      rowIdx = i + 1; mevcutDurum = String(data[i][10] || ""); tip = String(data[i][1] || "");
      kalanTutar = parseFloat(data[i][5]) || 0; cekTarih = hucreTarihStr(data[i][8]);
      break;
    }
  }
  if (rowIdx === -1) return { ok: false, hata: "Çek/senet bulunamadı" };
  if (mevcutDurum !== "Portföyde") return { ok: false, hata: "Bu çek/senet zaten kapatılmış (" + mevcutDurum + ")" };

  let ciroCariId = "";
  if (durum === "Ciro Edildi") {
    if (tip !== "Alınan") return { ok: false, hata: "Sadece Alınan çekler ciro edilebilir" };
    ciroCariId = String(body.ciroCariId || "").trim();
    if (!ciroCariId) return { ok: false, hata: "Ciro edilecek cari seçimi zorunludur" };
    const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar,
      ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU"]);
    const cData = cSheet.getDataRange().getValues();
    let ciroCariAd = "";
    for (let i = 1; i < cData.length; i++) { if (String(cData[i][0]) === ciroCariId) { ciroCariAd = String(cData[i][2] || ""); break; } }
    if (!ciroCariAd) return { ok: false, hata: "Ciro edilecek cari bulunamadı" };

    sheet.getRange(rowIdx, 14).setValue(ciroCariId);
    cariHareketEkle({
      cariId: ciroCariId, tarih: Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"), tip: "Borç", tutar: kalanTutar,
      aciklama: cariHareketAciklamaOlustur("CEKCIRO", id, "cek_ciro", body.aciklama),
    });
  }

  sheet.getRange(rowIdx, 11).setValue(durum);

  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hId = "csh_" + Date.now();
  hSheet.appendRow([hId, id, Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"), durum, 0,
    String(body.aciklama || "") + (ciroCariId ? " (Ciro: " + ciroCariId + ")" : ""), Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  cacheTemizle(["cekSenetListesi"]);
  return { ok: true };
}

// body: { id } — bir çek/senetteki EN SON hareketi (kısmi tahsilat/ödeme, Ciro Edildi
// veya Karşılıksız işaretlemesi) geri alır. Silme işlemleri artık "her şeyi birden"
// silmiyor — önce ciro/tahsilat gibi ara adımlar TEK TEK bu fonksiyonla geri alınmalı,
// çek ancak "Portföyde" ve hiç hareketi kalmamış haldeyken tam olarak silinebilir
// (bkz. silCekSenet). Bu, "ciro sonrası sil dedim, hem ciro hem çek girişi silindi"
// sorununu çözer: artık tek bir "Sil" hiçbir zaman birden fazla adımı birden geri almaz.
function cekSenetHareketGeriAl(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hData = hSheet.getDataRange().getValues();
  let sonHareketRowIdx = -1, sonHareket = null;
  for (let i = 1; i < hData.length; i++) {
    if (String(hData[i][1]) === id) { sonHareketRowIdx = i + 1; sonHareket = hData[i]; } // en son eşleşen kalır (satırlar kronolojik ekleniyor)
  }
  if (sonHareketRowIdx === -1) return { ok: false, hata: "Bu çek/senette geri alınacak bir hareket yok" };

  const hareketTip = String(sonHareket[3] || "");
  const hareketTutar = parseFloat(sonHareket[4]) || 0;

  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  ensureCekSenetCiroColonu(sheet);
  const data = sheet.getDataRange().getValues();
  let rowIdx = -1, kalanTutar = 0, tutar = 0, ciroCariId = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { rowIdx = i + 1; kalanTutar = parseFloat(data[i][5]) || 0; tutar = parseFloat(data[i][4]) || 0; ciroCariId = String(data[i][13] || ""); break; }
  }
  if (rowIdx === -1) return { ok: false, hata: "Çek/senet bulunamadı" };

  if (hareketTip === "Ciro Edildi" || hareketTip === "Karşılıksız") {
    if (hareketTip === "Ciro Edildi" && ciroCariId) {
      const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler,
        ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
      const hkData = hkSheet.getDataRange().getValues();
      for (let i = hkData.length - 1; i >= 1; i--) {
        if (String(hkData[i][1]) === ciroCariId && String(hkData[i][5] || "").indexOf("CEKCIRO:" + id) === 0) {
          hkSheet.deleteRow(i + 1);
          cacheTemizle(["cariListesi_v3"]);
          break;
        }
      }
      sheet.getRange(rowIdx, 14).setValue("");
    }
    sheet.getRange(rowIdx, 11).setValue("Portföyde");
  } else {
    // Tahsilat / Ödeme geri alınıyor: tutar tekrar kalan bakiyeye eklenir, durum yeniden "Portföyde" olur.
    const yeniKalan = Math.round((kalanTutar + hareketTutar) * 100) / 100;
    sheet.getRange(rowIdx, 6).setValue(Math.min(yeniKalan, tutar));
    sheet.getRange(rowIdx, 11).setValue("Portföyde");
  }

  hSheet.deleteRow(sonHareketRowIdx);
  cacheTemizle(["cekSenetListesi"]);
  return { ok: true };
}

// ════════════════════════════════════════════════
// ÇEK/SENET GÖRSELLERİ — alınan/verilen her çek/senede birden fazla fotoğraf (ön/arka
// yüz gibi) eklenebilir. Dosyalar Drive'da ayrı bir klasörde tutulur, sadece linki
// CekSenetGorselleri sayfasına yazılır (Sheets hücresine doğrudan base64 yazmak büyük
// görsellerde hücre boyut sınırını aşabileceği için tercih edilmedi).
// ════════════════════════════════════════════════
var CEK_GORSEL_KLASOR_ADI = "Fincanlar ERP - Cek Senet Gorselleri";
const CEK_GORSEL_BASLIKLAR = ["ID","CEK_ID","DOSYA_URL","DOSYA_ADI","YUKLEME_TARIHI"];

function cekGorselKlasoruGetir_() {
  const klasorler = DriveApp.getFoldersByName(CEK_GORSEL_KLASOR_ADI);
  if (klasorler.hasNext()) return klasorler.next();
  return DriveApp.createFolder(CEK_GORSEL_KLASOR_ADI);
}

// body: { cekId, dosyaBase64 (data:image/...;base64,... öneki OLABİLİR de OLMAYABİLİR de), dosyaAdi, mimeType }
function cekSenetGorselYukle(body) {
  // Toplu görsel: cekIdler dizisi verilirse dosya Drive'a BİR kez yüklenir, her çeke ayrı satırla bağlanır.
  const hedefler = (Array.isArray(body.cekIdler) && body.cekIdler.length ? body.cekIdler : [body.cekId]).map(x => String(x || "").trim()).filter(Boolean);
  const cekId = hedefler[0] || "";
  let base64 = String(body.dosyaBase64 || "");
  if (!cekId) return { ok: false, hata: "cekId gerekli" };
  if (!base64) return { ok: false, hata: "Dosya verisi gerekli" };

  const virgul = base64.indexOf(",");
  let mimeType = String(body.mimeType || "image/jpeg");
  if (base64.startsWith("data:") && virgul > -1) {
    mimeType = base64.substring(5, base64.indexOf(";"));
    base64 = base64.substring(virgul + 1);
  }

  let dosya;
  try {
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, mimeType, String(body.dosyaAdi || (cekId + ".jpg")));
    const klasor = cekGorselKlasoruGetir_();
    dosya = klasor.createFile(blob);
    dosya.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    return { ok: false, hata: "Görsel yüklenemedi: " + e.message };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetGorselleri, CEK_GORSEL_BASLIKLAR);
  const dosyaUrl = "https://drive.google.com/uc?export=view&id=" + dosya.getId();
  const yuklemeTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const zaman = Date.now();
  let ilkId = "";
  hedefler.forEach((hid, k) => {
    const id = "csg_" + zaman + "_" + k;
    if (!ilkId) ilkId = id;
    sheet.appendRow([id, hid, dosyaUrl, dosya.getName(), yuklemeTarihi]);
    cacheTemizle(["cekSenetGorselleri_" + hid]);
  });
  return { ok: true, id: ilkId, dosyaUrl: dosyaUrl, baglanan: hedefler.length };
}

function getCekSenetGorselleri(cekId) {
  if (!cekId) return { ok: false, hata: "cekId gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetGorselleri, CEK_GORSEL_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(cekId)) continue;
    sonuc.push({ id: String(data[i][0]), cekId: String(data[i][1]), dosyaUrl: String(data[i][2] || ""),
      dosyaAdi: String(data[i][3] || ""), yuklemeTarihi: String(data[i][4] || "") });
  }
  return { ok: true, gorseller: sonuc };
}

// body: { id } — hem sheet satırını hem Drive dosyasını siler.
function silCekSenetGorseli(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetGorselleri, CEK_GORSEL_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const dosyaUrl = String(data[i][2] || "");
      // Aynı dosya toplu yükleme ile birden fazla çeke bağlanmış olabilir: başka satır hâlâ kullanıyorsa Drive'dan silme.
      const baskaKullanan = data.some((r, j) => j >= 1 && j !== i && String(r[2] || "") === dosyaUrl);
      const m = dosyaUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (m && !baskaKullanan) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* dosya zaten yoksa yoksay */ } }
      sheet.deleteRow(i + 1);
      cacheTemizle(["cekSenetGorselleri_" + String(data[i][1] || "")]);
      return { ok: true };
    }
  }
  return { ok: false, hata: "Görsel bulunamadı" };
}

// body: { id } — çek/senedi ancak "Portföyde" durumda VE hiç işlem geçmişi (kısmi
// tahsilat/ödeme, ciro, karşılıksız) yoksa tamamen siler. Aksi halde önce
// cekSenetHareketGeriAl ile geçmişteki adımların TEK TEK geri alınması istenir —
// tek bir "Sil" tıklamasının birden fazla bağlı işlemi birden geri almasını önler.
function silCekSenet(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();

  const hSheet = getOrCreateSheet(ss, SHEETS.cekSenetHareketleri, CEK_SENET_HAREKET_BASLIKLAR);
  const hData = hSheet.getDataRange().getValues();
  const bagliHareketVar = hData.some(row => String(row[1]) === id);

  let cariId = "", bulunanRow = null;
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) {
      const row = data[i];
      const durum = String(row[10] || "");
      if (durum !== "Portföyde" || bagliHareketVar) {
        return { ok: false, hata: "Bu çek/senette işlem geçmişi var (durum: " + durum + "). Önce ilgili ciro/tahsilat/ödeme işlemini 'Son Hareketi Geri Al' ile geri alın, sonra silin." };
      }
      cariId = String(row[2] || "");
      bulunanRow = row;
      if (!body._geriAlmadanKaydetme) {
        silinenlerKaydet("CEKSENET", id, (String(row[1] || "")) + " Çek/Senet", String(row[3] || ""), parseFloat(row[4]) || 0, {
          cariId: cariId, tip: String(row[1] || ""), tutar: parseFloat(row[4]) || 0,
          seriNo: String(row[6] || ""), bankaAdi: String(row[7] || ""),
          duzenlenmeTarihi: hucreTarihStr(row[8]), vade: hucreTarihStr(row[9]), aciklama: String(row[11] || ""),
        }, String(row[6] || ""));
      }
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
        cacheTemizle(["cariListesi_v3"]);
        break;
      }
    }
  }

  cekYaprakBirak_(ss, id); // Verilen çek bir çek koçanı yaprağından çıkmışsa yaprak tekrar "Boş" olur

  // Not: buraya ulaşıldıysa çek/senette zaten hiç hareket geçmişi yoktu (üstteki kontrol
  // sayesinde) — CekSenetHareketleri'nde silinecek bir şey kalmamıştır.

  cacheTemizle(["cekSenetListesi"]);
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

  cacheTemizle(["cekSenetListesi"]);
  return { ok: true, kalanTutar: yeniKalan, durum: yeniDurum };
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
    const ted = String(data[i][0] || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr');
    if (ted) map[ted] = String(data[i][1] || "");
  }
  return map;
}

function tedarikciCariEslesmeKaydet(ss, tedarikci, cariId) {
  const t = String(tedarikci || "").trim();
  if (!t || !cariId) return;
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciCariEslesme, TEDARIKCI_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const key = t.replace(/[İIıi]/g,"i").toLocaleLowerCase('tr');
  const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr') === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[cariId, simdi]]);
      return;
    }
  }
  sheet.appendRow([t, cariId, simdi]);
}

// ════════════════════════════════════════════════
// EDM ÖNEK → TEDARİKÇİ EŞLEŞTİRME — bazı EDM fatura numaraları (ör. "CNY2026000123")
// gönderen adını net vermez, sadece bir önek taşır. TEDARIKCI eşleştirme hafızasından
// FARKLI olarak bu, YARI OTOMATİK çalışır: BFM ekranında bir ÖNERİ olarak gösterilir,
// otomatik doldurulmaz — kullanıcı onaylayınca (bir cariye işleyince) hem fatura hem
// bu eşleştirme kaydedilir/güncellenir.
// ════════════════════════════════════════════════
const EDM_ONEK_ESLESME_BASLIKLAR = ["ONEK","CARI_ID","CARI_AD","GUNCELLEME_TARIHI"];

// Fatura numarasının başındaki harf bloğunu (varsa) önek olarak çıkarır.
// "CNY2026000123" → "CNY", "FYT2026000005" → "FYT", "2026000123" → "" (harf yoksa önek yok).
function faturaOnekiCikar(faturaNo) {
  const m = String(faturaNo || "").trim().toUpperCase().match(/^[A-ZÇĞİÖŞÜ]+/);
  return m ? m[0] : "";
}

function edmOnekEslesmeOku(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.edmOnekEslesme, EDM_ONEK_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const onek = String(data[i][0] || "").trim().toUpperCase();
    if (onek) map[onek] = { cariId: String(data[i][1] || ""), cariAd: String(data[i][2] || "") };
  }
  return map;
}

function edmOnekEslesmeKaydet(ss, onek, cariId, cariAd) {
  const o = String(onek || "").trim().toUpperCase();
  if (!o || !cariId) return;
  const sheet = getOrCreateSheet(ss, SHEETS.edmOnekEslesme, EDM_ONEK_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim().toUpperCase() === o) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[cariId, cariAd || "", simdi]]);
      return;
    }
  }
  sheet.appendRow([o, cariId, cariAd || "", simdi]);
}

// Ayarlar ekranındaki yönetim tablosu için: tüm eşleştirmeleri listeler.
function getEdmOnekEslesmeListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const map = edmOnekEslesmeOku(ss);
  const sonuc = Object.keys(map).sort().map(onek => ({ onek: onek, cariId: map[onek].cariId, cariAd: map[onek].cariAd }));
  return { ok: true, kayitlar: sonuc };
}

// body: { onek, cariId, cariAd } — Ayarlar ekranından elle ekleme/düzenleme.
function edmOnekEslesmeManuelKaydet(body) {
  const onek = String(body.onek || "").trim();
  const cariId = String(body.cariId || "").trim();
  if (!onek) return { ok: false, hata: "Önek gerekli" };
  if (!cariId) return { ok: false, hata: "Cari seçilmeli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  edmOnekEslesmeKaydet(ss, onek, cariId, String(body.cariAd || ""));
  cacheTemizle(["bekleyenAlisFaturalari"]);
  return { ok: true };
}

// body: { onek }
function edmOnekEslesmeSil(body) {
  const onek = String(body.onek || "").trim().toUpperCase();
  if (!onek) return { ok: false, hata: "onek gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.edmOnekEslesme, EDM_ONEK_ESLESME_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0] || "").trim().toUpperCase() === onek) { sheet.deleteRow(i + 1); cacheTemizle(["bekleyenAlisFaturalari"]); return { ok: true }; }
  }
  return { ok: false, hata: "Eşleştirme bulunamadı" };
}

// ════════════════════════════════════════════════
// TEDARİKÇİ ÜRÜN KODU → STOK KODU EŞLEŞTİRME HAFIZASI — bazı tedarikçiler (ör. GPD/Gül Pres)
// e-faturada STOK_KODU alanını boş bırakır, ama ürün adının içinde KENDİ ürün kodlarını
// (ör. "MTL160 PEDRA TEK GÖVDE LAVABO BATARYASI") geçirir. Bu tablo, fatura numarası
// ÖNEKİ (ör. "GPD" — bkz. faturaOnekiCikar; TEDARIKCI gönderen adından daha güvenilir)
// + o tedarikçinin ürün kodu (ör. "MTL160") ikilisini bizim STOK_KODU'muza bağlar.
// Kullanım: BFM listesi hesaplanırken STOK_KODU boş gelen her kalemde, kalemin ürün adı bu
// tablodaki bilinen kodlara karşı taranır (bkz. urunAdindanStokKoduBul_) — eşleşirse stok
// kodu OTOMATİK ÖNERİLİR (kullanıcı yine de onaylamadan Alış'a işlenmez). Kullanıcı BFM onay
// ekranında bir kalem için stok kodunu (elle ya da arayarak) seçip Onayla'ya bastığında,
// ürün adından aynı yöntemle bir tedarikçi kodu çıkarılabiliyorsa bu eşleştirme öğrenilir/
// güncellenir (bkz. onaylaAlisFaturasi) — böylece aynı kod bir sonraki faturada otomatik gelir.
// ════════════════════════════════════════════════
const TEDARIKCI_URUN_KODU_BASLIKLAR = ["ONEK","TEDARIKCI_KODU","STOK_KODU","STOK_ADI","LISTE_FIYATI","GUNCELLEME_TARIHI"];

// Sayfayı { "GPD": [ {kod:"MTL160-S", stokKodu:"...", stokAdi:"...", listeFiyati:1234}, ... ], ... }
// biçiminde okur — her önek grubu KOD UZUNLUĞUNA GÖRE AZALAN sırada tutulur, böylece
// "MTL160-S" içeren bir üründe önce daha spesifik "MTL160-S" denenir, "MTL160" ile
// yanlışlıkla erken eşleşip yanlış varyant seçilmez (bkz. urunAdindanStokKoduBul_).
function tedarikciUrunKoduEslesmeOku(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciUrunKoduEslesme, TEDARIKCI_URUN_KODU_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const onek = String(data[i][0] || "").trim().toUpperCase();
    const kod = String(data[i][1] || "").trim().toUpperCase();
    const stokKodu = String(data[i][2] || "").trim();
    if (!onek || !kod || !stokKodu) continue;
    if (!map[onek]) map[onek] = [];
    map[onek].push({
      kod: kod, stokKodu: stokKodu, stokAdi: String(data[i][3] || ""),
      listeFiyati: parseFloat(data[i][4]) || 0,
    });
  }
  Object.keys(map).forEach(o => map[o].sort((a, b) => b.kod.length - a.kod.length));
  return map;
}

// (onek, kod) ikilisi üzerine upsert — aynı ikili zaten varsa stok kodu/adı/fiyatı güncellenir
// (elle veya BFM'den her onaylamada tazelenir), yoksa yeni satır eklenir.
function tedarikciUrunKoduEslesmeKaydet(ss, onek, kod, stokKodu, stokAdi, listeFiyati) {
  const o = String(onek || "").trim().toUpperCase();
  const k = String(kod || "").trim().toUpperCase();
  const sk = String(stokKodu || "").trim();
  if (!o || !k || !sk) return;
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciUrunKoduEslesme, TEDARIKCI_URUN_KODU_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const simdi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim().toUpperCase() === o && String(data[i][1] || "").trim().toUpperCase() === k) {
      sheet.getRange(i + 1, 3, 1, 4).setValues([[sk, stokAdi || data[i][3] || "", listeFiyati || parseFloat(data[i][4]) || 0, simdi]]);
      return;
    }
  }
  sheet.appendRow([o, k, sk, stokAdi || "", listeFiyati || 0, simdi]);
}

// Bir ürün adının içinde, VERİLEN önek için bilinen tedarikçi kodlarından en spesifik
// (en uzun) olanını kelime sınırına göre arar. "MTL160" ile "MTL160-S" birbirine
// karışmasın diye liste zaten uzunluğa göre azalan sıraladır (bkz. tedarikciUrunKoduEslesmeOku).
function urunAdindanStokKoduBul_(kodListesi, urunAdi) {
  const ad = String(urunAdi || "").toUpperCase();
  for (let i = 0; i < kodListesi.length; i++) {
    const item = kodListesi[i];
    const pattern = new RegExp("\\b" + item.kod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    if (pattern.test(ad)) return item;
  }
  return null;
}

// Ürün adının içinden, bir tedarikçi ürün kodu gibi görünen (2-6 harf + 2-4 rakam,
// isteğe bağlı "-EK" varyant parçalarıyla — ör. "MTL160", "MTL160-S", "FLB07-2-A")
// bir jeneri̇k desen çıkarır. Öğrenme adımında (onaylaAlisFaturasi) kullanılıyor;
// birden fazla aday varsa EN UZUN (en spesifik) olan tercih edilir.
function urunAdindanKodCikar_(urunAdi) {
  const ad = String(urunAdi || "").toUpperCase();
  const adaylar = ad.match(/\b[A-ZÇĞİÖŞÜ]{2,6}[0-9]{2,4}(?:-[A-Z0-9]+)*\b/g);
  if (!adaylar || !adaylar.length) return null;
  adaylar.sort((a, b) => b.length - a.length);
  return adaylar[0];
}

// Ayarlar ekranındaki yönetim tablosu için: tüm eşleştirmeleri listeler.
function getTedarikciUrunKoduListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const map = tedarikciUrunKoduEslesmeOku(ss);
  const sonuc = [];
  Object.keys(map).sort().forEach(onek => {
    map[onek].forEach(item => sonuc.push({
      onek: onek, kod: item.kod, stokKodu: item.stokKodu, stokAdi: item.stokAdi, listeFiyati: item.listeFiyati,
    }));
  });
  return { ok: true, kayitlar: sonuc };
}

// body: { onek, kod, stokKodu, stokAdi, listeFiyati } — Ayarlar ekranından elle ekleme/düzenleme.
function tedarikciUrunKoduManuelKaydet(body) {
  const onek = String(body.onek || "").trim();
  const kod = String(body.kod || "").trim();
  const stokKodu = String(body.stokKodu || "").trim();
  if (!onek) return { ok: false, hata: "Önek gerekli (ör. GPD)" };
  if (!kod) return { ok: false, hata: "Tedarikçi ürün kodu gerekli" };
  if (!stokKodu) return { ok: false, hata: "Stok kodu gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  tedarikciUrunKoduEslesmeKaydet(ss, onek, kod, stokKodu, String(body.stokAdi || ""), parseFloat(body.listeFiyati) || 0);
  cacheTemizle(["bekleyenAlisFaturalari"]);
  return { ok: true };
}

// body: { onek, kod }
function tedarikciUrunKoduSil(body) {
  const onek = String(body.onek || "").trim().toUpperCase();
  const kod = String(body.kod || "").trim().toUpperCase();
  if (!onek || !kod) return { ok: false, hata: "onek ve kod gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.tedarikciUrunKoduEslesme, TEDARIKCI_URUN_KODU_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0] || "").trim().toUpperCase() === onek && String(data[i][1] || "").trim().toUpperCase() === kod) {
      sheet.deleteRow(i + 1);
      cacheTemizle(["bekleyenAlisFaturalari"]);
      return { ok: true };
    }
  }
  return { ok: false, hata: "Eşleştirme bulunamadı" };
}

// body: { onek, kayitlar: [{kod, stokKodu, stokAdi, listeFiyati}, ...] } — toplu ilk yükleme
// (ör. bir tedarikçinin tüm fiyat listesi Fincanlar stok kodlarıyla eşleştirilip tek seferde
// aktarılırken kullanılır). Var olan (onek,kod) ikilileri güncellenir, yoklar eklenir.
function tedarikciUrunKoduTopluIceAktar(body) {
  const onek = String(body.onek || "").trim();
  const kayitlar = body.kayitlar || [];
  if (!onek) return { ok: false, hata: "Önek gerekli (ör. GPD)" };
  if (!kayitlar.length) return { ok: false, hata: "Aktarılacak kayıt yok" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let eklenen = 0, hatali = 0;
  kayitlar.forEach(k => {
    const kod = String(k.kod || "").trim();
    const stokKodu = String(k.stokKodu || "").trim();
    if (!kod || !stokKodu) { hatali++; return; }
    tedarikciUrunKoduEslesmeKaydet(ss, onek, kod, stokKodu, String(k.stokAdi || ""), parseFloat(k.listeFiyati) || 0);
    eklenen++;
  });
  cacheTemizle(["bekleyenAlisFaturalari"]);
  return { ok: true, eklenen: eklenen, hatali: hatali };
}


// ════════════════════════════════════════════════
// GPD (Gül Pres) TEDARİKÇİ ÜRÜN KODU İLK YÜKLEMESİ — 22 Eyl 2026 tarihli 2026 fiyat
// listesi ile Fincanlar Stok Listesi çapraz eşleştirilerek üretilmiş 203 kayıt (kesin +
// en uzun/spesifik kod otomatik seçilmiş kayıtlar; hiç eşleşmeyen eski seri ürünler
// dahil edilmedi). Fiyatlar BRÜT LİSTE FİYATIDIR — alış/satışta iskonto uygulanır,
// gerçek alış fiyatı her zaman faturadan gelir, bu sadece referans/karşılaştırma içindir.
// TEK SEFERLİK ÇALIŞTIRILIR: dağıtımdan sonra bir kere cariApi("gpdTedarikciKoduIlkYukleme", {})
// ile (veya Apps Script editöründen "Çalıştır" ile) tetiklenir; tekrar çalıştırmak zararsızdır
// (tedarikciUrunKoduEslesmeKaydet var olan (onek,kod) ikilisini sadece günceller).
// ════════════════════════════════════════════════
function gpdTedarikciKoduIlkYukleme() {
  const kayitlar = [{"kod": "TMS01", "stokKodu": "200519015011", "stokAdi": "GPD TAHARET MUSLUĞU BEYAZ TMS01", "listeFiyati": 650}, {"kod": "ADS03", "stokKodu": "200519015012", "stokAdi": "GPD ANKASTRE DUŞ BAŞLIĞI ADS03 (5 FONK)", "listeFiyati": 1300}, {"kod": "FKM01", "stokKodu": "200519015031", "stokAdi": "GPD FİLTRELİ ARA MUSLUK -FKM01", "listeFiyati": 430}, {"kod": "CMS03", "stokKodu": "200519201405", "stokAdi": "GPD FİLTRELİ ÇAMAŞIR MUSLUĞU CMS03", "listeFiyati": 850}, {"kod": "DSB05", "stokKodu": "200520000051", "stokAdi": "GPD MİX NİNO DUŞ BATARYASI DSB05", "listeFiyati": 5200}, {"kod": "MBB75", "stokKodu": "200520000751", "stokAdi": "GPD MİX FELİS BANYO BATARYASI -MBB75", "listeFiyati": 6650}, {"kod": "MBB100", "stokKodu": "200520001001", "stokAdi": "GPD MİX FREZİA BANYO BATARYASI MBB100", "listeFiyati": 7480}, {"kod": "MDL45", "stokKodu": "200520001451", "stokAdi": "GPD DOKTOR/BEDENSEL ENG.DÖNER LAV.BAT.MDL45", "listeFiyati": 5430}, {"kod": "MLB75", "stokKodu": "200520001751", "stokAdi": "GPD MİX FELİS LAVABO BATARYASI -MLB75", "listeFiyati": 4330}, {"kod": "LB30", "stokKodu": "200520002044", "stokAdi": "GPD ORBİS LAVABO BAT. LB30", "listeFiyati": 3180}, {"kod": "BB30", "stokKodu": "200520002045", "stokAdi": "GPD ORBİS BANYO BAT. BB30", "listeFiyati": 4250}, {"kod": "TE30", "stokKodu": "200520002046", "stokAdi": "GPD ORBİS TEK GÖVDE EVİYE BAT. TE30", "listeFiyati": 2800}, {"kod": "TL30", "stokKodu": "200520002047", "stokAdi": "GPD ORBİS TEK GÖVDE LAVABO BAT. TL30", "listeFiyati": 2750}, {"kod": "MTL85", "stokKodu": "200520002051", "stokAdi": "GPD RİTMO TEK GÖVDE LAVABO BATARYASI MTL85", "listeFiyati": 6330}, {"kod": "MAL45", "stokKodu": "200520002451", "stokAdi": "GPD DOKTOR/BEDENSEL ENG.APLİKE LAV.BAT. MAL45", "listeFiyati": 6080}, {"kod": "MTE75", "stokKodu": "200520002751", "stokAdi": "GPD MİX FELİS TEK GÖVDE EVİYE BATARYASI -MTE75", "listeFiyati": 4430}, {"kod": "FPB01", "stokKodu": "200520010011", "stokAdi": "GPD FOTOSELLİ PİSUVAR BATARYASI SIVA ÜSTÜ FPB01", "listeFiyati": 7800}, {"kod": "MLB100", "stokKodu": "200520011001", "stokAdi": "GPD MİX FREZİA LAVABO BATARYASI MLB100", "listeFiyati": 4730}, {"kod": "MBB70", "stokKodu": "200520012011", "stokAdi": "MBB70 ESPİNA BANYO BATARYASI GPD", "listeFiyati": 6030}, {"kod": "MTE70", "stokKodu": "200520012021", "stokAdi": "MTE70 ESPİNA TEK GÖVDE EVYE BATARYASI GPD", "listeFiyati": 4980}, {"kod": "MAR70", "stokKodu": "200520012022", "stokAdi": "GPD MİX ESPİNA ARITMA ÇIKIŞLI EVYE BATARYASI MAR70", "listeFiyati": 7750}, {"kod": "MTL70", "stokKodu": "200520012031", "stokAdi": "MTL70 ESPİNA TEK GÖVDE LAVABO BATARYASI GPD", "listeFiyati": 4800}, {"kod": "MLB70", "stokKodu": "200520012041", "stokAdi": "GPD MİX ESPİNA LAVABO BATARYASI MLB70", "listeFiyati": 4200}, {"kod": "MES70", "stokKodu": "200520012071", "stokAdi": "GPD MİX ESPİNA SPRALLİ EVYE BATARYASI MES70", "listeFiyati": 6000}, {"kod": "TMS70", "stokKodu": "200520012101", "stokAdi": "GPD ESPİNA TAHARET MUSLUĞU TMS70", "listeFiyati": 800}, {"kod": "AAK70", "stokKodu": "200520012701", "stokAdi": "GPD MİX ESPİNA ANKASTRE ARA KESME VALFİ -AAK70", "listeFiyati": 1350}, {"kod": "MLB45", "stokKodu": "200520012703", "stokAdi": "GPD Bedensel Engelli Lavabo Bataryası MLB45", "listeFiyati": 4680}, {"kod": "AAK05", "stokKodu": "200520013051", "stokAdi": "AAK05 GPD MİX NİNO ANKASTRE ARA KESME VALFİ", "listeFiyati": 1280}, {"kod": "DLB05", "stokKodu": "200520013151", "stokAdi": "GPD MİX NİNO DÖNER BORULU LAVABO BATARYASI DLB05", "listeFiyati": 5230}, {"kod": "UEB05", "stokKodu": "200520013171", "stokAdi": "GPD MİX NİNO DÖNER U BORULU EVYE BATARYASI -UEB05", "listeFiyati": 5400}, {"kod": "UEB05-B", "stokKodu": "200520013172", "stokAdi": "GPD MİX NİNO DÖNER U BORULU EVYE BATARYASI -UEB05-B BAKIR GÖRÜNÜMLÜ", "listeFiyati": 8630}, {"kod": "FLB07", "stokKodu": "200520013311", "stokAdi": "GPD FOTOSELLİ SET ÜSTÜ LAVABO BATARYASI FLB07", "listeFiyati": 11300}, {"kod": "MTE100", "stokKodu": "200520021001", "stokAdi": "GPD MİX FREZİA TEK GÖVDE EVİYE BATARYASI MTE100", "listeFiyati": 5330}, {"kod": "ADS07", "stokKodu": "200520023111", "stokAdi": "ADS07 ANKASTRE DUŞ SETİ (Ø200)", "listeFiyati": 2900}, {"kod": "TBB01", "stokKodu": "200520023251", "stokAdi": "GPD TERMOSTATİK BANYO BATARYASI -TBB01", "listeFiyati": 8750}, {"kod": "TBB02", "stokKodu": "200520032022", "stokAdi": "GPD TERMOSTATİK BANYO BATARYASI TBB02", "listeFiyati": 7930}, {"kod": "MTL135", "stokKodu": "200520032023", "stokAdi": "MTL135 TULİO TEK GÖVDE LAVABO BATARYASI GPD", "listeFiyati": 5430}, {"kod": "MTE135", "stokKodu": "200520032024", "stokAdi": "MTE135 TULİO TEK GÖVDE EVİYE BATARYASI GPD", "listeFiyati": 6000}, {"kod": "MLB135", "stokKodu": "200520032025", "stokAdi": "MLB135 TULİO LAVABO BATARYASI GPD", "listeFiyati": 4430}, {"kod": "BNB05", "stokKodu": "200520042011", "stokAdi": "GPD MİX NİNO BANYO BATARYASI BNB05", "listeFiyati": 7680}, {"kod": "BDB05", "stokKodu": "200520042021", "stokAdi": "GPD MİX NİNO EVYE BAT BDB05", "listeFiyati": 5450}, {"kod": "LEB05", "stokKodu": "200520042051", "stokAdi": "GPD MİX NİNO DÖNER L BORULU EVYE BAT.LEB05", "listeFiyati": 5380}, {"kod": "TMS05", "stokKodu": "200520042101", "stokAdi": "GPD NİNO TAHARET MUSLUĞU TMS05", "listeFiyati": 1000}, {"kod": "KRS58", "stokKodu": "200520052021", "stokAdi": "KÜRESEL RAKORLU MUSLUK (ÇELİK KOL)-KRS58", "listeFiyati": 1030}, {"kod": "TMZ01", "stokKodu": "200520052041", "stokAdi": "ARMATÜR TEMİZLEYİCİ VE PARLATICI-TMZ01", "listeFiyati": 350}, {"kod": "FKM03", "stokKodu": "200520052051", "stokAdi": "FİLTRELİ ARA MUSLUK (SERAMİK SALMASTRALI)-FKM03", "listeFiyati": 750}, {"kod": "MTL55", "stokKodu": "200520053011", "stokAdi": "MTL55 SOLUS TEK GÖVDE LAVABO BATARYASI GPD", "listeFiyati": 4280}, {"kod": "MTE55", "stokKodu": "200520053061", "stokAdi": "MTE55 SOLUS TEK GÖVDE EVİYE BATARYASI GPD", "listeFiyati": 4400}, {"kod": "MLB55", "stokKodu": "200520053062", "stokAdi": "GPD MİX SOLUS LAVABO BATARYASI -MLB55", "listeFiyati": 4030}, {"kod": "ADS11", "stokKodu": "200520053121", "stokAdi": "ANKASTRE DUŞ BAŞLIĞI (TAVANDAN)-ADS11", "listeFiyati": 2900}, {"kod": "ADS13", "stokKodu": "200520053122", "stokAdi": "ANKASTRE DUŞ SETİ-ADS13", "listeFiyati": 3930}, {"kod": "GGR04", "stokKodu": "200520053123", "stokAdi": "ANKASTRE KABİN GAGA-GGR04", "listeFiyati": 1150}, {"kod": "DST26", "stokKodu": "200520062011", "stokAdi": "DST26 ASKILI DUŞ SETİ TEK FONKSİYONLU KARE GPD", "listeFiyati": 950}, {"kod": "MLB65", "stokKodu": "200520063011", "stokAdi": "GPD MİX ATROS LAVABO BATARYASI -MLB65", "listeFiyati": 4300}, {"kod": "MTE65", "stokKodu": "200520063061", "stokAdi": "GPD MİX ATROS TEK GÖVDE EVİYE BATARYASI -MTE65", "listeFiyati": 4400}, {"kod": "MSL70", "stokKodu": "200520063141", "stokAdi": "GPD MİX ESPİNA SET ÜSTÜ LAVABO BAT.MSL70", "listeFiyati": 5230}, {"kod": "MSL65", "stokKodu": "200520063142", "stokAdi": "GPD ATROS SET ÜSTÜ LAVABO BAT. MSL65", "listeFiyati": 7850}, {"kod": "MSL65-C", "stokKodu": "200520063143", "stokAdi": "GPD ATROS SET ÜSTÜ LAVABO BAT. MSL65-C", "listeFiyati": 7980}, {"kod": "MTL65", "stokKodu": "200520072031", "stokAdi": "MTL65 ATROS TEK GÖVDE LAVABO GPD", "listeFiyati": 4250}, {"kod": "FPB02", "stokKodu": "200520072032", "stokAdi": "GPD Fotoselli Pisuvar Bataryası (sıva altı) FPB02", "listeFiyati": 7680}, {"kod": "MPN70", "stokKodu": "200520082021", "stokAdi": "ESPİNA PENCERE ÖNÜ BATARYASI-MPN70", "listeFiyati": 5880}, {"kod": "MTK70", "stokKodu": "200520106393", "stokAdi": "MTK70 ESPİNA TEK DELİKLİ KÜVET BATARYASI", "listeFiyati": 5050}, {"kod": "MTL75", "stokKodu": "200520118312", "stokAdi": "GPD MİX FELİS TEK GÖVDE LAVABO BATARYASI -MTL75", "listeFiyati": 4300}, {"kod": "MAB85", "stokKodu": "200520119310", "stokAdi": "MİX RİTMO ANKASTRE BANYO BATARYASI -MAB85 - GPD", "listeFiyati": 8430}, {"kod": "FLB11-2", "stokKodu": "200520124985", "stokAdi": "FOTOSELLİ LAVABO BATARYASI FLB11-2 GPD", "listeFiyati": 9230}, {"kod": "FLB10-S", "stokKodu": "200520124986", "stokAdi": "FOTOSELLİ LAVABO BATARYASI FLB10-S (SİYAH) GPD", "listeFiyati": 14430}, {"kod": "MAL120", "stokKodu": "200520125339", "stokAdi": "MİX ADRİO APLİKE LAVABO BATARYASI - MAL120", "listeFiyati": 5000}, {"kod": "MTT120", "stokKodu": "200520125396", "stokAdi": "ADRİO TEK SU GİRİŞLİ LAVABO BAT. - MTT120", "listeFiyati": 3330}, {"kod": "MLB155-A", "stokKodu": "200520130801", "stokAdi": "PROVİDO TEK LAVABO BATARYASI MLB155-A (ALTIN GÖRÜNÜM)", "listeFiyati": 7830}, {"kod": "MBB155-A", "stokKodu": "200520130803", "stokAdi": "PROVİDO BANYO BATARYASI MBB155-A (ALTIN GÖRÜNÜM)", "listeFiyati": 9350}, {"kod": "MTE155-A", "stokKodu": "200520130806", "stokAdi": "PROVİDO TEK GÖVDE EVİYE BATARYASI MTE155-A (ALTIN GÖRÜNÜM)", "listeFiyati": 9730}, {"kod": "MDB155-A", "stokKodu": "200520130813", "stokAdi": "PROVİDO BANYO BATARYASI MDB155-A (ALTIN GÖRÜNÜM)(TSEN817)", "listeFiyati": 6800}, {"kod": "MSL155-A", "stokKodu": "200520130814", "stokAdi": "PROVİDO SET ÜSTÜ LAVABO BATARYASI MSL155-A (ALTIN GÖRÜNÜM)", "listeFiyati": 9530}, {"kod": "MLB150", "stokKodu": "200520131301", "stokAdi": "TAURO LAVABO BATARYASI MLB150", "listeFiyati": 5430}, {"kod": "MTE150", "stokKodu": "200520131306", "stokAdi": "TAURO TEK GÖVDE EVİYE BATARYASI MTE150", "listeFiyati": 6750}, {"kod": "MLB150-A", "stokKodu": "200520131801", "stokAdi": "TAURO LAVABO BATARYASI MLB150-A (ALTIN GÖRÜNÜM)", "listeFiyati": 6500}, {"kod": "MBB150-A", "stokKodu": "200520131803", "stokAdi": "TAURO BANYO BATARYASI MBB150-A (ALTIN GÖRÜNÜM)", "listeFiyati": 9000}, {"kod": "MBB150", "stokKodu": "200520131804", "stokAdi": "TAURO BANYO BATARYASI MBB150 KROM", "listeFiyati": 7450}, {"kod": "MTE150-A", "stokKodu": "200520131806", "stokAdi": "TAURO EVİYE BATARYASI MTE150-A (ALTIN GÖRÜNÜM)", "listeFiyati": 8230}, {"kod": "MBB55", "stokKodu": "200520153031", "stokAdi": "MBB55 SOLUS BANYO BATARYASI GPD", "listeFiyati": 6530}, {"kod": "MAD55", "stokKodu": "200520153032", "stokAdi": "GPD SOLUS ANKASTRE DUŞ BATARYASI MAD55", "listeFiyati": 2980}, {"kod": "MAD65", "stokKodu": "200520153033", "stokAdi": "GPD ATROS ANKASTRE DUŞ BATARYASI MAD65", "listeFiyati": 3080}, {"kod": "MLB65", "stokKodu": "200520163011", "stokAdi": "MİX ATROS LAVABO BATARYASI -MLB65", "listeFiyati": 4300}, {"kod": "MBB65", "stokKodu": "200520163031", "stokAdi": "MBB65 ATROS BANYO BATARYASI GPD", "listeFiyati": 7400}, {"kod": "MES65-C", "stokKodu": "200520163032", "stokAdi": "ATROS SPİRALLİ EVİYE BATARYASI (MES65-C)", "listeFiyati": 7880}, {"kod": "MAK67", "stokKodu": "200520163901", "stokAdi": "MİX ATROS ANKASTRE KÜVET BATARYASI MAK67 -GPD", "listeFiyati": 16330}, {"kod": "MLB85", "stokKodu": "200520193011", "stokAdi": "MİX RİTMO LAVABO BATARYASI -MLB85  -GPD", "listeFiyati": 5200}, {"kod": "MBB85", "stokKodu": "200520193031", "stokAdi": "MİX RİTMO BANYO BATARYASI -MBB85  -GPD", "listeFiyati": 7330}, {"kod": "MTE85", "stokKodu": "200520193061", "stokAdi": "MİX RİTMO TEK GÖVDE EVİYE BATARYASI -MTE85  -GPD", "listeFiyati": 6800}, {"kod": "FPB02", "stokKodu": "200520200011", "stokAdi": "FOTOSELLİ PİSUAR BATARYASI -FPB02", "listeFiyati": 7680}, {"kod": "MLB105", "stokKodu": "200520213011", "stokAdi": "MİX FUEGO LAVABO BATARYASI -MLB105  -GPD", "listeFiyati": 6480}, {"kod": "MBB105", "stokKodu": "200520213031", "stokAdi": "MİX FUEGO BANYO BATARYASI -MBB105  -GPD", "listeFiyati": 12980}, {"kod": "MTE105", "stokKodu": "200520213061", "stokAdi": "MİX FUEGO TEK GÖVDE EVİYE BATARYASI -MTE105  -GPD", "listeFiyati": 9880}, {"kod": "MKB105", "stokKodu": "200520213062", "stokAdi": "FUEGO KABİN BATARYASI-MKB105", "listeFiyati": 7280}, {"kod": "MLB120", "stokKodu": "200520253011", "stokAdi": "MİX ADRİO LAVABO BATARYASI MLB120", "listeFiyati": 3480}, {"kod": "MDL120", "stokKodu": "200520253021", "stokAdi": "MİX ADRİO DÖNER LAVABO BATARYASI -MDL120", "listeFiyati": 2980}, {"kod": "MBB120", "stokKodu": "200520253031", "stokAdi": "MİX ADRİO BANYO BATARYASI -MBB120", "listeFiyati": 5050}, {"kod": "MDB120", "stokKodu": "200520253032", "stokAdi": "ADRİO DUŞ BATARYASI MDB120", "listeFiyati": 4130}, {"kod": "MTE120", "stokKodu": "200520253061", "stokAdi": "MİX ADRİO TEK GÖVDE EVİYE BATARYASI -MTE120", "listeFiyati": 3580}, {"kod": "MTL120", "stokKodu": "200520253121", "stokAdi": "MİX ADRİO TEK GÖVDE LAVABO BATARYASI -MTL120", "listeFiyati": 3430}, {"kod": "MAE120", "stokKodu": "200520253131", "stokAdi": "MİX ADRİO APLİKE EVİYE BATARYASI MAE120", "listeFiyati": 5100}, {"kod": "MTB120", "stokKodu": "200520254951", "stokAdi": "ADRİO TAHARET BATARYASI-(MTB120)", "listeFiyati": 4600}, {"kod": "AAK71-A", "stokKodu": "200520601904", "stokAdi": "GPD 1/2 MİX ESPİNA ANKASTRE ARA KESME VALFİ ALTIN GÖRÜNÜM (AAK71-A)", "listeFiyati": 2800}, {"kod": "AAK71", "stokKodu": "200534323901", "stokAdi": "GPD 1/2 MİX ESPİNA ANKASTRE ARA KESME VALFİ - AAK71", "listeFiyati": 1780}, {"kod": "MTA160", "stokKodu": "200535289031", "stokAdi": "MTA160 PEDRA TAM ANKASTR BANYO BATARYASI GPD", "listeFiyati": 9430}, {"kod": "MDB165-S", "stokKodu": "200535289161", "stokAdi": "GPD GİLDO DUŞ BAT. MDB165-S", "listeFiyati": 7400}, {"kod": "MBB160", "stokKodu": "200535289951", "stokAdi": "MBB160 PEDRA BANYO BATARYASI GPD", "listeFiyati": 7650}, {"kod": "MBB150-O", "stokKodu": "200535289983", "stokAdi": "TAURO BANYO BATARYASI SİYAH MBB150-O", "listeFiyati": 8650}, {"kod": "MBB165-K-R", "stokKodu": "200535289984", "stokAdi": "GİLDO BANYO BATARYASI KROM+ROSE GOLD MBB165-K-R", "listeFiyati": 10030}, {"kod": "MBB165-S", "stokKodu": "200535289985", "stokAdi": "GİLDO BANYO BATARYASI MBB165-S SİYAH", "listeFiyati": 8930}, {"kod": "DSP09", "stokKodu": "200537318985", "stokAdi": "DUŞ PANELİ ALÜM.SİYAH DSP09", "listeFiyati": 21330}, {"kod": "MES160-S", "stokKodu": "200538289984", "stokAdi": "MES160-S PEDRA  SPİRALLİ EVİYE BATARYASI KROM GPD", "listeFiyati": 8580}, {"kod": "MES71", "stokKodu": "200538289985", "stokAdi": "ESPİNA SPİRALLİ EVİYE BATARYASI MES71 KROM", "listeFiyati": 6880}, {"kod": "MTE160", "stokKodu": "200538322951", "stokAdi": "MTE160 PEDRA TEK GÖVDE EVİYE BATARYASI GPD", "listeFiyati": 5650}, {"kod": "MTE150-O", "stokKodu": "200538322984", "stokAdi": "TAURO TEK GÖVDE EVİYE BAT. SİYAH MTE150-O", "listeFiyati": 8280}, {"kod": "MLB160", "stokKodu": "200541289951", "stokAdi": "MLB160 PEDRA LAVABO BATARYASI GPD", "listeFiyati": 4580}, {"kod": "MLB150-O", "stokKodu": "200541289981", "stokAdi": "TAURO LAVABO BATARYASI SİYAH MLB150-O", "listeFiyati": 6500}, {"kod": "MTE165-K-R", "stokKodu": "200541289982", "stokAdi": "GİLDO LAVABO BATARYASI MTE165-K-R KROM+ROSE GOLD", "listeFiyati": 6150}, {"kod": "MLB165-K-R", "stokKodu": "200541289983", "stokAdi": "GİLDO LAVABO BATARYASI MLB165-K-R KROM+ROSE GOLD", "listeFiyati": 6000}, {"kod": "MTE165-S", "stokKodu": "200541289984", "stokAdi": "GİLDO TEK GÖVDE EVİYE BATARYASI MTE165-S SİYAH", "listeFiyati": 5500}, {"kod": "MSL155", "stokKodu": "200541289985", "stokAdi": "GPD SET ÜSTÜ LAVABO BATARYASI MSL155", "listeFiyati": 7830}, {"kod": "RDK07", "stokKodu": "201251074251", "stokAdi": "ÇAMAŞIR MUSLUK REDİKSİYON-RDK07", "listeFiyati": 230}, {"kod": "STS01", "stokKodu": "201252001461", "stokAdi": "SPREY TAHARET SETİ RED-(STS01)", "listeFiyati": 930}, {"kod": "UZT01", "stokKodu": "201764028101", "stokAdi": "UZATMA 1 CM -GPD (UZT01)", "listeFiyati": 130}, {"kod": "UZT02", "stokKodu": "201764028151", "stokAdi": "GPD UZATMA 1,5CM UZT02", "listeFiyati": 150}, {"kod": "UZT03", "stokKodu": "201764028201", "stokAdi": "GPD UZATMA 2 CM UZT03", "listeFiyati": 180}, {"kod": "UZT04", "stokKodu": "201764028251", "stokAdi": "GPD UZATMA 2,5CM UZT04", "listeFiyati": 230}, {"kod": "UZT05", "stokKodu": "201764028301", "stokAdi": "GPD UZATMA 3CM UZT05", "listeFiyati": 280}, {"kod": "UZT06", "stokKodu": "201764028401", "stokAdi": "GPD UZATMA 4CM UZT06", "listeFiyati": 350}, {"kod": "UZT07", "stokKodu": "201764028501", "stokAdi": "GPD UZATMA 5cm UZT07", "listeFiyati": 380}, {"kod": "DST37", "stokKodu": "201821000060", "stokAdi": "ASKILI DUŞ SETİ DST37 TEK FONK. -GPD", "listeFiyati": 1100}, {"kod": "ADS15", "stokKodu": "201821000062", "stokAdi": "ARBEKA ASKILI DUŞ SETİ (TEK.FONK)-ADS15", "listeFiyati": 3930}, {"kod": "DST24", "stokKodu": "201821000074", "stokAdi": "GPD SÜRGÜLÜ DUŞ SETİ 5FONKS. DST24", "listeFiyati": 8750}, {"kod": "MBB135", "stokKodu": "201821000075", "stokAdi": "MBB135 TULİO BANYO BATARYASI GPD", "listeFiyati": 6280}, {"kod": "AUG01", "stokKodu": "201821000091", "stokAdi": "AUG01 ANKASTRE ARA KESME UZATMA GRUBU (3 CM)(026)", "listeFiyati": 580}, {"kod": "DST16", "stokKodu": "201821013071", "stokAdi": "SÜRGÜLÜ DUŞ TAKIMI 3 FONKSİYONLU -DST16-GPD-", "listeFiyati": 1430}, {"kod": "DST30", "stokKodu": "201821013072", "stokAdi": "GPD SÜRGÜLÜ DUŞ SETİ (TEK FONKSİYONLU)-DST30", "listeFiyati": 3380}, {"kod": "DSP06", "stokKodu": "201821104032", "stokAdi": "DUŞ PANELİ BAMBU -DSP06 (20X150)", "listeFiyati": 25630}, {"kod": "ADS05", "stokKodu": "201821203302", "stokAdi": "ANKASTRE DUŞ SETİ (200X200) ADS05 - GPD", "listeFiyati": 3100}, {"kod": "SAG10", "stokKodu": "201821203303", "stokAdi": "SAG10-ANKASTRE DUŞ SIVA ALTI GRUBU(RİTMO-FUEGO)", "listeFiyati": 2080}, {"kod": "MAD65", "stokKodu": "200520254952", "stokAdi": "MAD65 ATROS ANKASTRE DUŞ BATARYASI (TSEN817)", "listeFiyati": 3080}, {"kod": "ADS02", "stokKodu": "2005202549523", "stokAdi": "ADS02 3 FONKSÜYONLU ANKASTRE DUŞ BAŞLIĞI (TSEN1112)", "listeFiyati": 1300}, {"kod": "ADS05", "stokKodu": "200520023112", "stokAdi": "ADS05 ANKASTRE DUŞ SETİ (200X200)", "listeFiyati": 3100}, {"kod": "DST51", "stokKodu": "201821013075", "stokAdi": "DST51 ASKILI DUŞ SETİ (5 FONK. )", "listeFiyati": 1030}, {"kod": "DST26", "stokKodu": "201821013076", "stokAdi": "DST26 ASKILI DUŞ SETİ TEK FONK. KARE", "listeFiyati": 950}, {"kod": "FPB02", "stokKodu": "200520010012", "stokAdi": "GPD FOTOSELLİ PİSUVAR BATARYASI SIVA ALTI -FPB02", "listeFiyati": 7680}, {"kod": "MLB155", "stokKodu": "200520130802", "stokAdi": "PROVİDO TEK LAVABO BATARYASI- MLB155", "listeFiyati": 6380}, {"kod": "MTE155", "stokKodu": "200520130807", "stokAdi": "PROVİDO TEK GÖVDE EVİYE BATARYASI MTE155", "listeFiyati": 8130}, {"kod": "MDA65", "stokKodu": "200520153034", "stokAdi": "GPD ATROS DUVARDAN ANKASTRE LAVABO BATARYASI-MDA65", "listeFiyati": 8550}, {"kod": "MES65", "stokKodu": "200520163033", "stokAdi": "ATROS SPİRALLİ EVİYE BATARYASI 2 FONKSİYONLU -MES65", "listeFiyati": 7750}, {"kod": "MTE180-B", "stokKodu": "200538322986", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE BATARYASI MTE180-B", "listeFiyati": 13630}, {"kod": "MTL180-R", "stokKodu": "200538322988", "stokAdi": "GPD RETRO TEK GÖVDE LAVABO  BATARYASI MTL180-R", "listeFiyati": 15100}, {"kod": "MTE180-R", "stokKodu": "200538322989", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE  BATARYASI MTE180-R", "listeFiyati": 16200}, {"kod": "MTA85", "stokKodu": "201821203304", "stokAdi": "RİTMO TAM ANKASTRE BANYO BATARYASI-MTA85", "listeFiyati": 9080}, {"kod": "MTA105", "stokKodu": "200535289032", "stokAdi": "FUEGO TAM ANKASTRE BANYO BATARYASI-MTA105", "listeFiyati": 9330}, {"kod": "MAD85", "stokKodu": "201821203305", "stokAdi": "RİTMO ANKASTRE DUŞ BATARYASI-MAD85", "listeFiyati": 3200}, {"kod": "MBB155", "stokKodu": "200520130804", "stokAdi": "GPD PROVİDO BANYO BATARYASI-MBB155", "listeFiyati": 7680}, {"kod": "PUP02", "stokKodu": "200520062013", "stokAdi": "PUP02-POP-UP ÜNİTESİ (BASMALI NORMAL)-GPD", "listeFiyati": 1330}, {"kod": "FLB10-2", "stokKodu": "200520124987", "stokAdi": "FLB10-2 FOTOSELLİ LAVABO BATARYASI (TSEN15091) (TEK GİRİŞLİ)-GPD", "listeFiyati": 11400}, {"kod": "DST50", "stokKodu": "201821013077", "stokAdi": "DST50-ASKILI DUŞ SETİ (5 FONK.)(TSEN1112)", "listeFiyati": 600}, {"kod": "MTE180-A", "stokKodu": "200538322990", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE BATARYASI-MTE180-A", "listeFiyati": 15380}, {"kod": "FLB10", "stokKodu": "200520124988", "stokAdi": "FOTOSELLİ LAVABO BATARYASI (ÇİFT SU GİRİŞLİ)-FLB10-GPD", "listeFiyati": 13150}, {"kod": "PUP05", "stokKodu": "200520124989", "stokAdi": "POP-UP ÜNİTESİ (BASMALI-NORMAL/TAŞMA DELİKSİZ)-PUP05-GPD", "listeFiyati": 800}, {"kod": "DST19-3", "stokKodu": "200520124990", "stokAdi": "DST19-3 KROM KARE YÖNLENDİRİCİLİ DUŞ SETİ (TEK FONKSİYONLU EL DUŞU + 200X200) GPD", "listeFiyati": 4800}, {"kod": "PUP05-S", "stokKodu": "200520124991", "stokAdi": "POP-UP ÜNİTESİ (BASMALI-NORMAL/TAŞMA DELİKSİZ)-PUP05-S-GPD", "listeFiyati": 1050}, {"kod": "MAK65", "stokKodu": "200520163902", "stokAdi": "MAK65 ATROS ANKASTRE KÜVET BATARYASI (3 DELİKLİ ) (TSEN817)-GPD", "listeFiyati": 17750}, {"kod": "MTL180-B", "stokKodu": "200538322991", "stokAdi": "MTL180-B GPD RETRO TEK GÖVDE LAVABO BATARYASI (TSEN817)(BAKIR OKSİT)", "listeFiyati": 12700}, {"kod": "FPB02", "stokKodu": "200520130805", "stokAdi": "GDV015-FPB02 GÖZ DEVRESİ GRUBU (YENİ FOTOSELLİ)-GPD", "listeFiyati": 7680}, {"kod": "MDA65-S", "stokKodu": "200520153035", "stokAdi": "MDA65-S ATROS DUVARDAN ANKASTRE LAVABO BATARYASI(SİYAH)", "listeFiyati": 10450}, {"kod": "MKA165-S", "stokKodu": "200520153036", "stokAdi": "MKA165-S GİLDO MİX KOMBİNE ANKASTRE BANYO BATARYASI (TSEN817)(SİYAH)", "listeFiyati": 22180}, {"kod": "ADS25", "stokKodu": "200520153037", "stokAdi": "ADS25 ANKASTRE DUŞ SETİ (TAVANDAN) (500X500)(TSEN1112)", "listeFiyati": 12200}, {"kod": "MTE65-BG", "stokKodu": "200520153038", "stokAdi": "MTE65-BG ATROS TEK GÖVDE EVİYE BATARYASI(BEYAZ GRANİT KAPLAMA)(TSEN817)", "listeFiyati": 6350}, {"kod": "ADS23-S", "stokKodu": "200520153039", "stokAdi": "ADS23-S ANKASTRE DUŞ BAŞLIĞI TAVANDAN 400X400 SİYAH-GPD", "listeFiyati": 9400}, {"kod": "MCA156", "stokKodu": "200520153040", "stokAdi": "MCA156 PROVİDO MİX ÇEVİRMELİ ANKASTRE BAŞLIĞI TSEN817-GPD", "listeFiyati": 12050}, {"kod": "MKB65", "stokKodu": "201821013080", "stokAdi": "MKB65 ATROS ANKASTRE KABIN BATARYASI (TSEN817)", "listeFiyati": 6480}, {"kod": "MBB165", "stokKodu": "200535001655", "stokAdi": "MBB165 GİLDO BANYO BATARYASI GPD", "listeFiyati": 7400}, {"kod": "MTL165", "stokKodu": "200535011655", "stokAdi": "MTL165 GİLDO TEK GÖVDE LAVABO BATARYASI GPD", "listeFiyati": 4280}, {"kod": "MTE165", "stokKodu": "200535021655", "stokAdi": "MTE165 GİLDO TEK GÖVDE EVİYE BATARYASI GPD", "listeFiyati": 4500}, {"kod": "MTL160", "stokKodu": "200535001601", "stokAdi": "MTL160 PEDRA TEK GÖVDE LAVABO BATARYASI", "listeFiyati": 5300}, {"kod": "MTL180", "stokKodu": "200538001801", "stokAdi": "MTL180 RETRO TEK GÖVDE LAVABO BATARYASI GPD", "listeFiyati": 9500}, {"kod": "MTE180", "stokKodu": "200538011801", "stokAdi": "MTE180 RETRO TEK GÖVDE EVİYE BATARYASI GPD", "listeFiyati": 10380}, {"kod": "MBR65", "stokKodu": "200520000651", "stokAdi": "MBR65 ATROS BERBER BATARYASI", "listeFiyati": 5350}, {"kod": "FLB12", "stokKodu": "200520000121", "stokAdi": "FLB12 FOTOSELLİ LAVABO BATARYASI (MANUEL ISI KUMANDALI) -GPD", "listeFiyati": 13350}, {"kod": "AUG04", "stokKodu": "200538320041", "stokAdi": "AUG04 GPD ANKASTRE BANYO KABİN UZATMA GRUBU", "listeFiyati": 3730}, {"kod": "AUG03", "stokKodu": "200538000031", "stokAdi": "AUG03 GPD ANKASTRE BANYO KABİN UZATMA GRUBU", "listeFiyati": 3600}, {"kod": "AUG05", "stokKodu": "200538000051", "stokAdi": "AUG05 GPD ANKASTRE KABİN UZATMA GRUBU", "listeFiyati": 2350}, {"kod": "MAR71", "stokKodu": "200520012023", "stokAdi": "MAR71 ESPİNA ÇİFT AERATÖRLÜ ARITMA BATARYASI -GPD", "listeFiyati": 8080}, {"kod": "GGR12", "stokKodu": "200520013071", "stokAdi": "GGR12 ANKASTRE BATARYA GRUBU (YÖNLENDİRİCİLİ)(KARE)", "listeFiyati": 3380}, {"kod": "MLB190-S", "stokKodu": "200541281901", "stokAdi": "MİX QUADRO LAVABO BATARYASI -SİYAH MLB190-S", "listeFiyati": 6580}, {"kod": "MBB190-S", "stokKodu": "200541291901", "stokAdi": "MİX QUADRO BANYO BATARYASI -SİYAH MBB190-S", "listeFiyati": 14550}, {"kod": "DST19-3-S", "stokKodu": "201821013191", "stokAdi": "YÖNLENDİRİCİLİ DUŞ SETİ DST19-3-S -SİYAH", "listeFiyati": 6850}, {"kod": "FLB12", "stokKodu": "200538010051", "stokAdi": "KKT05 FOTOSELLİ LAV. BAT. KUMANDA KUTUSU (FLB12) -GPD", "listeFiyati": 13350}, {"kod": "ATB170", "stokKodu": "200520050170", "stokAdi": "ANKASTRE TAHARET BATARYASI ATB170 -GPD", "listeFiyati": 2650}, {"kod": "SBR26", "stokKodu": "200535000261", "stokAdi": "ŞİBER VANA 2\" SBR26 (TSEN 12288) -GPD", "listeFiyati": 4180}, {"kod": "MEE65", "stokKodu": "200538163151", "stokAdi": "MEE65 ATROS ENDÜSTRİYEL EVİYE BATARYASI -GPD", "listeFiyati": 16530}, {"kod": "DST19-3-S", "stokKodu": "200520124193", "stokAdi": "DST19-3-S SİYAH KARE YÖNLENDİRİCİLİ DUŞ SETİ (TEK FONKSİYONLU EL DUŞU + 200X200)-DST19-3-S GPD", "listeFiyati": 6850}, {"kod": "DST19-2", "stokKodu": "201821013019", "stokAdi": "DST19-2 KROM OVAL YÖNLENDİRİCİLİ DUŞ SETİ (Ø200)(3 FONK.) -GPD", "listeFiyati": 4780}, {"kod": "KRS49", "stokKodu": "200520040049", "stokAdi": "KRS49 1/2\" KÜRESEL RAKORLU MUSLUK (ÇELİK K.) -GPD", "listeFiyati": 800}, {"kod": "MCA161", "stokKodu": "200535219161", "stokAdi": "PEDRA MİX ÇEVİRMELİ ANKASTRE BATARYA MCA161 -GPD", "listeFiyati": 11850}, {"kod": "MBB165-S-R", "stokKodu": "200535289986", "stokAdi": "GİLDO BANYO BATARYASI  MBB165-S-R", "listeFiyati": 10580}, {"kod": "MSL165-S-R", "stokKodu": "200535289987", "stokAdi": "MSL165-S-R GİLDO SET ÜSTÜ LAVABO", "listeFiyati": 11030}, {"kod": "MSL160-S", "stokKodu": "200520011601", "stokAdi": "MSL160-S PEDRA SET ÜSTÜ LAVABO BATARYASI SİYAH", "listeFiyati": 10680}, {"kod": "UMS30", "stokKodu": "200520010301", "stokAdi": "UMS30 RİOS UZUN MUSLUK GPD", "listeFiyati": 1000}];
  return tedarikciUrunKoduTopluIceAktar({ onek: "GPD", kayitlar: kayitlar });
}

// ════════════════════════════════════════════════
// GPD (Gül Pres) EŞLEŞEN ÜRÜNLER İÇİN STOK KARTI İLK YÜKLEMESİ — 22 Eyl 2026.
// gpdTedarikciKoduIlkYukleme() ile aynı 203 kayıtlık eşleştirmeye dayanır, ama farklı bir
// sorunu çözer: o fonksiyon sadece "tedarikçi kodu → stok kodu" HAFIZASINI yazıyordu; bu
// stok kodlarının StokTanimlari'nda GERÇEKTEN AÇIK BİR KART olarak var olduğunu varsaymıştı.
// Bazılarında kart hiç açılmamış olduğu için ("giriş yapılan stoklar için stok kartı
// açılmıyor" — 22 Eyl bildirimi), bu fonksiyon HENÜZ KARTI OLMAYAN kodlar için yeni stok
// kartı açar. ★ GÜVENLİK: saveStokTanimTopluce'nin aksine, ZATEN VAR OLAN bir stok kartına
// asla dokunmaz/üzerine yazmaz (marka/ürün grubu/ebat/renk gibi elle yapılmış sınıflandırmalar
// silinmesin diye) — sadece StokTanimlari'nda o kod hiç yoksa yeni satır ekler.
// TEK SEFERLİK ÇALIŞTIRILIR: cariApi("gpdStokKartlariIlkYukleme", {}) ile (veya Apps Script
// editöründen "Çalıştır" ile) tetiklenir; tekrar çalıştırmak zararsızdır (var olanlar atlanır).
// Alış Fiyatı alanına BRÜT LİSTE FİYATI referans olarak yazılır — gerçek alış fiyatı her
// zaman faturadan gelir, bu sadece başlangıç/karşılaştırma referansıdır.
// ════════════════════════════════════════════════
function gpdStokKartlariIlkYukleme() {
  const kayitlar = [{"stokKodu": "200519015011", "stokAdi": "GPD TAHARET MUSLUĞU BEYAZ TMS01", "alisFiyati": 650}, {"stokKodu": "200519015012", "stokAdi": "GPD ANKASTRE DUŞ BAŞLIĞI ADS03 (5 FONK)", "alisFiyati": 1300}, {"stokKodu": "200519015031", "stokAdi": "GPD FİLTRELİ ARA MUSLUK -FKM01", "alisFiyati": 430}, {"stokKodu": "200519201405", "stokAdi": "GPD FİLTRELİ ÇAMAŞIR MUSLUĞU CMS03", "alisFiyati": 850}, {"stokKodu": "200520000051", "stokAdi": "GPD MİX NİNO DUŞ BATARYASI DSB05", "alisFiyati": 5200}, {"stokKodu": "200520000751", "stokAdi": "GPD MİX FELİS BANYO BATARYASI -MBB75", "alisFiyati": 6650}, {"stokKodu": "200520001001", "stokAdi": "GPD MİX FREZİA BANYO BATARYASI MBB100", "alisFiyati": 7480}, {"stokKodu": "200520001451", "stokAdi": "GPD DOKTOR/BEDENSEL ENG.DÖNER LAV.BAT.MDL45", "alisFiyati": 5430}, {"stokKodu": "200520001751", "stokAdi": "GPD MİX FELİS LAVABO BATARYASI -MLB75", "alisFiyati": 4330}, {"stokKodu": "200520002044", "stokAdi": "GPD ORBİS LAVABO BAT. LB30", "alisFiyati": 3180}, {"stokKodu": "200520002045", "stokAdi": "GPD ORBİS BANYO BAT. BB30", "alisFiyati": 4250}, {"stokKodu": "200520002046", "stokAdi": "GPD ORBİS TEK GÖVDE EVİYE BAT. TE30", "alisFiyati": 2800}, {"stokKodu": "200520002047", "stokAdi": "GPD ORBİS TEK GÖVDE LAVABO BAT. TL30", "alisFiyati": 2750}, {"stokKodu": "200520002051", "stokAdi": "GPD RİTMO TEK GÖVDE LAVABO BATARYASI MTL85", "alisFiyati": 6330}, {"stokKodu": "200520002451", "stokAdi": "GPD DOKTOR/BEDENSEL ENG.APLİKE LAV.BAT. MAL45", "alisFiyati": 6080}, {"stokKodu": "200520002751", "stokAdi": "GPD MİX FELİS TEK GÖVDE EVİYE BATARYASI -MTE75", "alisFiyati": 4430}, {"stokKodu": "200520010011", "stokAdi": "GPD FOTOSELLİ PİSUVAR BATARYASI SIVA ÜSTÜ FPB01", "alisFiyati": 7800}, {"stokKodu": "200520011001", "stokAdi": "GPD MİX FREZİA LAVABO BATARYASI MLB100", "alisFiyati": 4730}, {"stokKodu": "200520012011", "stokAdi": "MBB70 ESPİNA BANYO BATARYASI GPD", "alisFiyati": 6030}, {"stokKodu": "200520012021", "stokAdi": "MTE70 ESPİNA TEK GÖVDE EVYE BATARYASI GPD", "alisFiyati": 4980}, {"stokKodu": "200520012022", "stokAdi": "GPD MİX ESPİNA ARITMA ÇIKIŞLI EVYE BATARYASI MAR70", "alisFiyati": 7750}, {"stokKodu": "200520012031", "stokAdi": "MTL70 ESPİNA TEK GÖVDE LAVABO BATARYASI GPD", "alisFiyati": 4800}, {"stokKodu": "200520012041", "stokAdi": "GPD MİX ESPİNA LAVABO BATARYASI MLB70", "alisFiyati": 4200}, {"stokKodu": "200520012071", "stokAdi": "GPD MİX ESPİNA SPRALLİ EVYE BATARYASI MES70", "alisFiyati": 6000}, {"stokKodu": "200520012101", "stokAdi": "GPD ESPİNA TAHARET MUSLUĞU TMS70", "alisFiyati": 800}, {"stokKodu": "200520012701", "stokAdi": "GPD MİX ESPİNA ANKASTRE ARA KESME VALFİ -AAK70", "alisFiyati": 1350}, {"stokKodu": "200520012703", "stokAdi": "GPD Bedensel Engelli Lavabo Bataryası MLB45", "alisFiyati": 4680}, {"stokKodu": "200520013051", "stokAdi": "AAK05 GPD MİX NİNO ANKASTRE ARA KESME VALFİ", "alisFiyati": 1280}, {"stokKodu": "200520013151", "stokAdi": "GPD MİX NİNO DÖNER BORULU LAVABO BATARYASI DLB05", "alisFiyati": 5230}, {"stokKodu": "200520013171", "stokAdi": "GPD MİX NİNO DÖNER U BORULU EVYE BATARYASI -UEB05", "alisFiyati": 5400}, {"stokKodu": "200520013172", "stokAdi": "GPD MİX NİNO DÖNER U BORULU EVYE BATARYASI -UEB05-B BAKIR GÖRÜNÜMLÜ", "alisFiyati": 8630}, {"stokKodu": "200520013311", "stokAdi": "GPD FOTOSELLİ SET ÜSTÜ LAVABO BATARYASI FLB07", "alisFiyati": 11300}, {"stokKodu": "200520021001", "stokAdi": "GPD MİX FREZİA TEK GÖVDE EVİYE BATARYASI MTE100", "alisFiyati": 5330}, {"stokKodu": "200520023111", "stokAdi": "ADS07 ANKASTRE DUŞ SETİ (Ø200)", "alisFiyati": 2900}, {"stokKodu": "200520023251", "stokAdi": "GPD TERMOSTATİK BANYO BATARYASI -TBB01", "alisFiyati": 8750}, {"stokKodu": "200520032022", "stokAdi": "GPD TERMOSTATİK BANYO BATARYASI TBB02", "alisFiyati": 7930}, {"stokKodu": "200520032023", "stokAdi": "MTL135 TULİO TEK GÖVDE LAVABO BATARYASI GPD", "alisFiyati": 5430}, {"stokKodu": "200520032024", "stokAdi": "MTE135 TULİO TEK GÖVDE EVİYE BATARYASI GPD", "alisFiyati": 6000}, {"stokKodu": "200520032025", "stokAdi": "MLB135 TULİO LAVABO BATARYASI GPD", "alisFiyati": 4430}, {"stokKodu": "200520042011", "stokAdi": "GPD MİX NİNO BANYO BATARYASI BNB05", "alisFiyati": 7680}, {"stokKodu": "200520042021", "stokAdi": "GPD MİX NİNO EVYE BAT BDB05", "alisFiyati": 5450}, {"stokKodu": "200520042051", "stokAdi": "GPD MİX NİNO DÖNER L BORULU EVYE BAT.LEB05", "alisFiyati": 5380}, {"stokKodu": "200520042101", "stokAdi": "GPD NİNO TAHARET MUSLUĞU TMS05", "alisFiyati": 1000}, {"stokKodu": "200520052021", "stokAdi": "KÜRESEL RAKORLU MUSLUK (ÇELİK KOL)-KRS58", "alisFiyati": 1030}, {"stokKodu": "200520052041", "stokAdi": "ARMATÜR TEMİZLEYİCİ VE PARLATICI-TMZ01", "alisFiyati": 350}, {"stokKodu": "200520052051", "stokAdi": "FİLTRELİ ARA MUSLUK (SERAMİK SALMASTRALI)-FKM03", "alisFiyati": 750}, {"stokKodu": "200520053011", "stokAdi": "MTL55 SOLUS TEK GÖVDE LAVABO BATARYASI GPD", "alisFiyati": 4280}, {"stokKodu": "200520053061", "stokAdi": "MTE55 SOLUS TEK GÖVDE EVİYE BATARYASI GPD", "alisFiyati": 4400}, {"stokKodu": "200520053062", "stokAdi": "GPD MİX SOLUS LAVABO BATARYASI -MLB55", "alisFiyati": 4030}, {"stokKodu": "200520053121", "stokAdi": "ANKASTRE DUŞ BAŞLIĞI (TAVANDAN)-ADS11", "alisFiyati": 2900}, {"stokKodu": "200520053122", "stokAdi": "ANKASTRE DUŞ SETİ-ADS13", "alisFiyati": 3930}, {"stokKodu": "200520053123", "stokAdi": "ANKASTRE KABİN GAGA-GGR04", "alisFiyati": 1150}, {"stokKodu": "200520062011", "stokAdi": "DST26 ASKILI DUŞ SETİ TEK FONKSİYONLU KARE GPD", "alisFiyati": 950}, {"stokKodu": "200520063011", "stokAdi": "GPD MİX ATROS LAVABO BATARYASI -MLB65", "alisFiyati": 4300}, {"stokKodu": "200520063061", "stokAdi": "GPD MİX ATROS TEK GÖVDE EVİYE BATARYASI -MTE65", "alisFiyati": 4400}, {"stokKodu": "200520063141", "stokAdi": "GPD MİX ESPİNA SET ÜSTÜ LAVABO BAT.MSL70", "alisFiyati": 5230}, {"stokKodu": "200520063142", "stokAdi": "GPD ATROS SET ÜSTÜ LAVABO BAT. MSL65", "alisFiyati": 7850}, {"stokKodu": "200520063143", "stokAdi": "GPD ATROS SET ÜSTÜ LAVABO BAT. MSL65-C", "alisFiyati": 7980}, {"stokKodu": "200520072031", "stokAdi": "MTL65 ATROS TEK GÖVDE LAVABO GPD", "alisFiyati": 4250}, {"stokKodu": "200520072032", "stokAdi": "GPD Fotoselli Pisuvar Bataryası (sıva altı) FPB02", "alisFiyati": 7680}, {"stokKodu": "200520082021", "stokAdi": "ESPİNA PENCERE ÖNÜ BATARYASI-MPN70", "alisFiyati": 5880}, {"stokKodu": "200520106393", "stokAdi": "MTK70 ESPİNA TEK DELİKLİ KÜVET BATARYASI", "alisFiyati": 5050}, {"stokKodu": "200520118312", "stokAdi": "GPD MİX FELİS TEK GÖVDE LAVABO BATARYASI -MTL75", "alisFiyati": 4300}, {"stokKodu": "200520119310", "stokAdi": "MİX RİTMO ANKASTRE BANYO BATARYASI -MAB85 - GPD", "alisFiyati": 8430}, {"stokKodu": "200520124985", "stokAdi": "FOTOSELLİ LAVABO BATARYASI FLB11-2 GPD", "alisFiyati": 9230}, {"stokKodu": "200520124986", "stokAdi": "FOTOSELLİ LAVABO BATARYASI FLB10-S (SİYAH) GPD", "alisFiyati": 14430}, {"stokKodu": "200520125339", "stokAdi": "MİX ADRİO APLİKE LAVABO BATARYASI - MAL120", "alisFiyati": 5000}, {"stokKodu": "200520125396", "stokAdi": "ADRİO TEK SU GİRİŞLİ LAVABO BAT. - MTT120", "alisFiyati": 3330}, {"stokKodu": "200520130801", "stokAdi": "PROVİDO TEK LAVABO BATARYASI MLB155-A (ALTIN GÖRÜNÜM)", "alisFiyati": 7830}, {"stokKodu": "200520130803", "stokAdi": "PROVİDO BANYO BATARYASI MBB155-A (ALTIN GÖRÜNÜM)", "alisFiyati": 9350}, {"stokKodu": "200520130806", "stokAdi": "PROVİDO TEK GÖVDE EVİYE BATARYASI MTE155-A (ALTIN GÖRÜNÜM)", "alisFiyati": 9730}, {"stokKodu": "200520130813", "stokAdi": "PROVİDO BANYO BATARYASI MDB155-A (ALTIN GÖRÜNÜM)(TSEN817)", "alisFiyati": 6800}, {"stokKodu": "200520130814", "stokAdi": "PROVİDO SET ÜSTÜ LAVABO BATARYASI MSL155-A (ALTIN GÖRÜNÜM)", "alisFiyati": 9530}, {"stokKodu": "200520131301", "stokAdi": "TAURO LAVABO BATARYASI MLB150", "alisFiyati": 5430}, {"stokKodu": "200520131306", "stokAdi": "TAURO TEK GÖVDE EVİYE BATARYASI MTE150", "alisFiyati": 6750}, {"stokKodu": "200520131801", "stokAdi": "TAURO LAVABO BATARYASI MLB150-A (ALTIN GÖRÜNÜM)", "alisFiyati": 6500}, {"stokKodu": "200520131803", "stokAdi": "TAURO BANYO BATARYASI MBB150-A (ALTIN GÖRÜNÜM)", "alisFiyati": 9000}, {"stokKodu": "200520131804", "stokAdi": "TAURO BANYO BATARYASI MBB150 KROM", "alisFiyati": 7450}, {"stokKodu": "200520131806", "stokAdi": "TAURO EVİYE BATARYASI MTE150-A (ALTIN GÖRÜNÜM)", "alisFiyati": 8230}, {"stokKodu": "200520153031", "stokAdi": "MBB55 SOLUS BANYO BATARYASI GPD", "alisFiyati": 6530}, {"stokKodu": "200520153032", "stokAdi": "GPD SOLUS ANKASTRE DUŞ BATARYASI MAD55", "alisFiyati": 2980}, {"stokKodu": "200520153033", "stokAdi": "GPD ATROS ANKASTRE DUŞ BATARYASI MAD65", "alisFiyati": 3080}, {"stokKodu": "200520163011", "stokAdi": "MİX ATROS LAVABO BATARYASI -MLB65", "alisFiyati": 4300}, {"stokKodu": "200520163031", "stokAdi": "MBB65 ATROS BANYO BATARYASI GPD", "alisFiyati": 7400}, {"stokKodu": "200520163032", "stokAdi": "ATROS SPİRALLİ EVİYE BATARYASI (MES65-C)", "alisFiyati": 7880}, {"stokKodu": "200520163901", "stokAdi": "MİX ATROS ANKASTRE KÜVET BATARYASI MAK67 -GPD", "alisFiyati": 16330}, {"stokKodu": "200520193011", "stokAdi": "MİX RİTMO LAVABO BATARYASI -MLB85  -GPD", "alisFiyati": 5200}, {"stokKodu": "200520193031", "stokAdi": "MİX RİTMO BANYO BATARYASI -MBB85  -GPD", "alisFiyati": 7330}, {"stokKodu": "200520193061", "stokAdi": "MİX RİTMO TEK GÖVDE EVİYE BATARYASI -MTE85  -GPD", "alisFiyati": 6800}, {"stokKodu": "200520200011", "stokAdi": "FOTOSELLİ PİSUAR BATARYASI -FPB02", "alisFiyati": 7680}, {"stokKodu": "200520213011", "stokAdi": "MİX FUEGO LAVABO BATARYASI -MLB105  -GPD", "alisFiyati": 6480}, {"stokKodu": "200520213031", "stokAdi": "MİX FUEGO BANYO BATARYASI -MBB105  -GPD", "alisFiyati": 12980}, {"stokKodu": "200520213061", "stokAdi": "MİX FUEGO TEK GÖVDE EVİYE BATARYASI -MTE105  -GPD", "alisFiyati": 9880}, {"stokKodu": "200520213062", "stokAdi": "FUEGO KABİN BATARYASI-MKB105", "alisFiyati": 7280}, {"stokKodu": "200520253011", "stokAdi": "MİX ADRİO LAVABO BATARYASI MLB120", "alisFiyati": 3480}, {"stokKodu": "200520253021", "stokAdi": "MİX ADRİO DÖNER LAVABO BATARYASI -MDL120", "alisFiyati": 2980}, {"stokKodu": "200520253031", "stokAdi": "MİX ADRİO BANYO BATARYASI -MBB120", "alisFiyati": 5050}, {"stokKodu": "200520253032", "stokAdi": "ADRİO DUŞ BATARYASI MDB120", "alisFiyati": 4130}, {"stokKodu": "200520253061", "stokAdi": "MİX ADRİO TEK GÖVDE EVİYE BATARYASI -MTE120", "alisFiyati": 3580}, {"stokKodu": "200520253121", "stokAdi": "MİX ADRİO TEK GÖVDE LAVABO BATARYASI -MTL120", "alisFiyati": 3430}, {"stokKodu": "200520253131", "stokAdi": "MİX ADRİO APLİKE EVİYE BATARYASI MAE120", "alisFiyati": 5100}, {"stokKodu": "200520254951", "stokAdi": "ADRİO TAHARET BATARYASI-(MTB120)", "alisFiyati": 4600}, {"stokKodu": "200520601904", "stokAdi": "GPD 1/2 MİX ESPİNA ANKASTRE ARA KESME VALFİ ALTIN GÖRÜNÜM (AAK71-A)", "alisFiyati": 2800}, {"stokKodu": "200534323901", "stokAdi": "GPD 1/2 MİX ESPİNA ANKASTRE ARA KESME VALFİ - AAK71", "alisFiyati": 1780}, {"stokKodu": "200535289031", "stokAdi": "MTA160 PEDRA TAM ANKASTR BANYO BATARYASI GPD", "alisFiyati": 9430}, {"stokKodu": "200535289161", "stokAdi": "GPD GİLDO DUŞ BAT. MDB165-S", "alisFiyati": 7400}, {"stokKodu": "200535289951", "stokAdi": "MBB160 PEDRA BANYO BATARYASI GPD", "alisFiyati": 7650}, {"stokKodu": "200535289983", "stokAdi": "TAURO BANYO BATARYASI SİYAH MBB150-O", "alisFiyati": 8650}, {"stokKodu": "200535289984", "stokAdi": "GİLDO BANYO BATARYASI KROM+ROSE GOLD MBB165-K-R", "alisFiyati": 10030}, {"stokKodu": "200535289985", "stokAdi": "GİLDO BANYO BATARYASI MBB165-S SİYAH", "alisFiyati": 8930}, {"stokKodu": "200537318985", "stokAdi": "DUŞ PANELİ ALÜM.SİYAH DSP09", "alisFiyati": 21330}, {"stokKodu": "200538289984", "stokAdi": "MES160-S PEDRA  SPİRALLİ EVİYE BATARYASI KROM GPD", "alisFiyati": 8580}, {"stokKodu": "200538289985", "stokAdi": "ESPİNA SPİRALLİ EVİYE BATARYASI MES71 KROM", "alisFiyati": 6880}, {"stokKodu": "200538322951", "stokAdi": "MTE160 PEDRA TEK GÖVDE EVİYE BATARYASI GPD", "alisFiyati": 5650}, {"stokKodu": "200538322984", "stokAdi": "TAURO TEK GÖVDE EVİYE BAT. SİYAH MTE150-O", "alisFiyati": 8280}, {"stokKodu": "200541289951", "stokAdi": "MLB160 PEDRA LAVABO BATARYASI GPD", "alisFiyati": 4580}, {"stokKodu": "200541289981", "stokAdi": "TAURO LAVABO BATARYASI SİYAH MLB150-O", "alisFiyati": 6500}, {"stokKodu": "200541289982", "stokAdi": "GİLDO LAVABO BATARYASI MTE165-K-R KROM+ROSE GOLD", "alisFiyati": 6150}, {"stokKodu": "200541289983", "stokAdi": "GİLDO LAVABO BATARYASI MLB165-K-R KROM+ROSE GOLD", "alisFiyati": 6000}, {"stokKodu": "200541289984", "stokAdi": "GİLDO TEK GÖVDE EVİYE BATARYASI MTE165-S SİYAH", "alisFiyati": 5500}, {"stokKodu": "200541289985", "stokAdi": "GPD SET ÜSTÜ LAVABO BATARYASI MSL155", "alisFiyati": 7830}, {"stokKodu": "201251074251", "stokAdi": "ÇAMAŞIR MUSLUK REDİKSİYON-RDK07", "alisFiyati": 230}, {"stokKodu": "201252001461", "stokAdi": "SPREY TAHARET SETİ RED-(STS01)", "alisFiyati": 930}, {"stokKodu": "201764028101", "stokAdi": "UZATMA 1 CM -GPD (UZT01)", "alisFiyati": 130}, {"stokKodu": "201764028151", "stokAdi": "GPD UZATMA 1,5CM UZT02", "alisFiyati": 150}, {"stokKodu": "201764028201", "stokAdi": "GPD UZATMA 2 CM UZT03", "alisFiyati": 180}, {"stokKodu": "201764028251", "stokAdi": "GPD UZATMA 2,5CM UZT04", "alisFiyati": 230}, {"stokKodu": "201764028301", "stokAdi": "GPD UZATMA 3CM UZT05", "alisFiyati": 280}, {"stokKodu": "201764028401", "stokAdi": "GPD UZATMA 4CM UZT06", "alisFiyati": 350}, {"stokKodu": "201764028501", "stokAdi": "GPD UZATMA 5cm UZT07", "alisFiyati": 380}, {"stokKodu": "201821000060", "stokAdi": "ASKILI DUŞ SETİ DST37 TEK FONK. -GPD", "alisFiyati": 1100}, {"stokKodu": "201821000062", "stokAdi": "ARBEKA ASKILI DUŞ SETİ (TEK.FONK)-ADS15", "alisFiyati": 3930}, {"stokKodu": "201821000074", "stokAdi": "GPD SÜRGÜLÜ DUŞ SETİ 5FONKS. DST24", "alisFiyati": 8750}, {"stokKodu": "201821000075", "stokAdi": "MBB135 TULİO BANYO BATARYASI GPD", "alisFiyati": 6280}, {"stokKodu": "201821000091", "stokAdi": "AUG01 ANKASTRE ARA KESME UZATMA GRUBU (3 CM)(026)", "alisFiyati": 580}, {"stokKodu": "201821013071", "stokAdi": "SÜRGÜLÜ DUŞ TAKIMI 3 FONKSİYONLU -DST16-GPD-", "alisFiyati": 1430}, {"stokKodu": "201821013072", "stokAdi": "GPD SÜRGÜLÜ DUŞ SETİ (TEK FONKSİYONLU)-DST30", "alisFiyati": 3380}, {"stokKodu": "201821104032", "stokAdi": "DUŞ PANELİ BAMBU -DSP06 (20X150)", "alisFiyati": 25630}, {"stokKodu": "201821203302", "stokAdi": "ANKASTRE DUŞ SETİ (200X200) ADS05 - GPD", "alisFiyati": 3100}, {"stokKodu": "201821203303", "stokAdi": "SAG10-ANKASTRE DUŞ SIVA ALTI GRUBU(RİTMO-FUEGO)", "alisFiyati": 2080}, {"stokKodu": "200520254952", "stokAdi": "MAD65 ATROS ANKASTRE DUŞ BATARYASI (TSEN817)", "alisFiyati": 3080}, {"stokKodu": "2005202549523", "stokAdi": "ADS02 3 FONKSÜYONLU ANKASTRE DUŞ BAŞLIĞI (TSEN1112)", "alisFiyati": 1300}, {"stokKodu": "200520023112", "stokAdi": "ADS05 ANKASTRE DUŞ SETİ (200X200)", "alisFiyati": 3100}, {"stokKodu": "201821013075", "stokAdi": "DST51 ASKILI DUŞ SETİ (5 FONK. )", "alisFiyati": 1030}, {"stokKodu": "201821013076", "stokAdi": "DST26 ASKILI DUŞ SETİ TEK FONK. KARE", "alisFiyati": 950}, {"stokKodu": "200520010012", "stokAdi": "GPD FOTOSELLİ PİSUVAR BATARYASI SIVA ALTI -FPB02", "alisFiyati": 7680}, {"stokKodu": "200520130802", "stokAdi": "PROVİDO TEK LAVABO BATARYASI- MLB155", "alisFiyati": 6380}, {"stokKodu": "200520130807", "stokAdi": "PROVİDO TEK GÖVDE EVİYE BATARYASI MTE155", "alisFiyati": 8130}, {"stokKodu": "200520153034", "stokAdi": "GPD ATROS DUVARDAN ANKASTRE LAVABO BATARYASI-MDA65", "alisFiyati": 8550}, {"stokKodu": "200520163033", "stokAdi": "ATROS SPİRALLİ EVİYE BATARYASI 2 FONKSİYONLU -MES65", "alisFiyati": 7750}, {"stokKodu": "200538322986", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE BATARYASI MTE180-B", "alisFiyati": 13630}, {"stokKodu": "200538322988", "stokAdi": "GPD RETRO TEK GÖVDE LAVABO  BATARYASI MTL180-R", "alisFiyati": 15100}, {"stokKodu": "200538322989", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE  BATARYASI MTE180-R", "alisFiyati": 16200}, {"stokKodu": "201821203304", "stokAdi": "RİTMO TAM ANKASTRE BANYO BATARYASI-MTA85", "alisFiyati": 9080}, {"stokKodu": "200535289032", "stokAdi": "FUEGO TAM ANKASTRE BANYO BATARYASI-MTA105", "alisFiyati": 9330}, {"stokKodu": "201821203305", "stokAdi": "RİTMO ANKASTRE DUŞ BATARYASI-MAD85", "alisFiyati": 3200}, {"stokKodu": "200520130804", "stokAdi": "GPD PROVİDO BANYO BATARYASI-MBB155", "alisFiyati": 7680}, {"stokKodu": "200520062013", "stokAdi": "PUP02-POP-UP ÜNİTESİ (BASMALI NORMAL)-GPD", "alisFiyati": 1330}, {"stokKodu": "200520124987", "stokAdi": "FLB10-2 FOTOSELLİ LAVABO BATARYASI (TSEN15091) (TEK GİRİŞLİ)-GPD", "alisFiyati": 11400}, {"stokKodu": "201821013077", "stokAdi": "DST50-ASKILI DUŞ SETİ (5 FONK.)(TSEN1112)", "alisFiyati": 600}, {"stokKodu": "200538322990", "stokAdi": "GPD RETRO TEK GÖVDE EVİYE BATARYASI-MTE180-A", "alisFiyati": 15380}, {"stokKodu": "200520124988", "stokAdi": "FOTOSELLİ LAVABO BATARYASI (ÇİFT SU GİRİŞLİ)-FLB10-GPD", "alisFiyati": 13150}, {"stokKodu": "200520124989", "stokAdi": "POP-UP ÜNİTESİ (BASMALI-NORMAL/TAŞMA DELİKSİZ)-PUP05-GPD", "alisFiyati": 800}, {"stokKodu": "200520124990", "stokAdi": "DST19-3 KROM KARE YÖNLENDİRİCİLİ DUŞ SETİ (TEK FONKSİYONLU EL DUŞU + 200X200) GPD", "alisFiyati": 4800}, {"stokKodu": "200520124991", "stokAdi": "POP-UP ÜNİTESİ (BASMALI-NORMAL/TAŞMA DELİKSİZ)-PUP05-S-GPD", "alisFiyati": 1050}, {"stokKodu": "200520163902", "stokAdi": "MAK65 ATROS ANKASTRE KÜVET BATARYASI (3 DELİKLİ ) (TSEN817)-GPD", "alisFiyati": 17750}, {"stokKodu": "200538322991", "stokAdi": "MTL180-B GPD RETRO TEK GÖVDE LAVABO BATARYASI (TSEN817)(BAKIR OKSİT)", "alisFiyati": 12700}, {"stokKodu": "200520130805", "stokAdi": "GDV015-FPB02 GÖZ DEVRESİ GRUBU (YENİ FOTOSELLİ)-GPD", "alisFiyati": 7680}, {"stokKodu": "200520153035", "stokAdi": "MDA65-S ATROS DUVARDAN ANKASTRE LAVABO BATARYASI(SİYAH)", "alisFiyati": 10450}, {"stokKodu": "200520153036", "stokAdi": "MKA165-S GİLDO MİX KOMBİNE ANKASTRE BANYO BATARYASI (TSEN817)(SİYAH)", "alisFiyati": 22180}, {"stokKodu": "200520153037", "stokAdi": "ADS25 ANKASTRE DUŞ SETİ (TAVANDAN) (500X500)(TSEN1112)", "alisFiyati": 12200}, {"stokKodu": "200520153038", "stokAdi": "MTE65-BG ATROS TEK GÖVDE EVİYE BATARYASI(BEYAZ GRANİT KAPLAMA)(TSEN817)", "alisFiyati": 6350}, {"stokKodu": "200520153039", "stokAdi": "ADS23-S ANKASTRE DUŞ BAŞLIĞI TAVANDAN 400X400 SİYAH-GPD", "alisFiyati": 9400}, {"stokKodu": "200520153040", "stokAdi": "MCA156 PROVİDO MİX ÇEVİRMELİ ANKASTRE BAŞLIĞI TSEN817-GPD", "alisFiyati": 12050}, {"stokKodu": "201821013080", "stokAdi": "MKB65 ATROS ANKASTRE KABIN BATARYASI (TSEN817)", "alisFiyati": 6480}, {"stokKodu": "200535001655", "stokAdi": "MBB165 GİLDO BANYO BATARYASI GPD", "alisFiyati": 7400}, {"stokKodu": "200535011655", "stokAdi": "MTL165 GİLDO TEK GÖVDE LAVABO BATARYASI GPD", "alisFiyati": 4280}, {"stokKodu": "200535021655", "stokAdi": "MTE165 GİLDO TEK GÖVDE EVİYE BATARYASI GPD", "alisFiyati": 4500}, {"stokKodu": "200535001601", "stokAdi": "MTL160 PEDRA TEK GÖVDE LAVABO BATARYASI", "alisFiyati": 5300}, {"stokKodu": "200538001801", "stokAdi": "MTL180 RETRO TEK GÖVDE LAVABO BATARYASI GPD", "alisFiyati": 9500}, {"stokKodu": "200538011801", "stokAdi": "MTE180 RETRO TEK GÖVDE EVİYE BATARYASI GPD", "alisFiyati": 10380}, {"stokKodu": "200520000651", "stokAdi": "MBR65 ATROS BERBER BATARYASI", "alisFiyati": 5350}, {"stokKodu": "200520000121", "stokAdi": "FLB12 FOTOSELLİ LAVABO BATARYASI (MANUEL ISI KUMANDALI) -GPD", "alisFiyati": 13350}, {"stokKodu": "200538320041", "stokAdi": "AUG04 GPD ANKASTRE BANYO KABİN UZATMA GRUBU", "alisFiyati": 3730}, {"stokKodu": "200538000031", "stokAdi": "AUG03 GPD ANKASTRE BANYO KABİN UZATMA GRUBU", "alisFiyati": 3600}, {"stokKodu": "200538000051", "stokAdi": "AUG05 GPD ANKASTRE KABİN UZATMA GRUBU", "alisFiyati": 2350}, {"stokKodu": "200520012023", "stokAdi": "MAR71 ESPİNA ÇİFT AERATÖRLÜ ARITMA BATARYASI -GPD", "alisFiyati": 8080}, {"stokKodu": "200520013071", "stokAdi": "GGR12 ANKASTRE BATARYA GRUBU (YÖNLENDİRİCİLİ)(KARE)", "alisFiyati": 3380}, {"stokKodu": "200541281901", "stokAdi": "MİX QUADRO LAVABO BATARYASI -SİYAH MLB190-S", "alisFiyati": 6580}, {"stokKodu": "200541291901", "stokAdi": "MİX QUADRO BANYO BATARYASI -SİYAH MBB190-S", "alisFiyati": 14550}, {"stokKodu": "201821013191", "stokAdi": "YÖNLENDİRİCİLİ DUŞ SETİ DST19-3-S -SİYAH", "alisFiyati": 6850}, {"stokKodu": "200538010051", "stokAdi": "KKT05 FOTOSELLİ LAV. BAT. KUMANDA KUTUSU (FLB12) -GPD", "alisFiyati": 13350}, {"stokKodu": "200520050170", "stokAdi": "ANKASTRE TAHARET BATARYASI ATB170 -GPD", "alisFiyati": 2650}, {"stokKodu": "200535000261", "stokAdi": "ŞİBER VANA 2\" SBR26 (TSEN 12288) -GPD", "alisFiyati": 4180}, {"stokKodu": "200538163151", "stokAdi": "MEE65 ATROS ENDÜSTRİYEL EVİYE BATARYASI -GPD", "alisFiyati": 16530}, {"stokKodu": "200520124193", "stokAdi": "DST19-3-S SİYAH KARE YÖNLENDİRİCİLİ DUŞ SETİ (TEK FONKSİYONLU EL DUŞU + 200X200)-DST19-3-S GPD", "alisFiyati": 6850}, {"stokKodu": "201821013019", "stokAdi": "DST19-2 KROM OVAL YÖNLENDİRİCİLİ DUŞ SETİ (Ø200)(3 FONK.) -GPD", "alisFiyati": 4780}, {"stokKodu": "200520040049", "stokAdi": "KRS49 1/2\" KÜRESEL RAKORLU MUSLUK (ÇELİK K.) -GPD", "alisFiyati": 800}, {"stokKodu": "200535219161", "stokAdi": "PEDRA MİX ÇEVİRMELİ ANKASTRE BATARYA MCA161 -GPD", "alisFiyati": 11850}, {"stokKodu": "200535289986", "stokAdi": "GİLDO BANYO BATARYASI  MBB165-S-R", "alisFiyati": 10580}, {"stokKodu": "200535289987", "stokAdi": "MSL165-S-R GİLDO SET ÜSTÜ LAVABO", "alisFiyati": 11030}, {"stokKodu": "200520011601", "stokAdi": "MSL160-S PEDRA SET ÜSTÜ LAVABO BATARYASI SİYAH", "alisFiyati": 10680}, {"stokKodu": "200520010301", "stokAdi": "UMS30 RİOS UZUN MUSLUK GPD", "alisFiyati": 1000}];
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const data = sheet.getDataRange().getValues();

  const mevcutKodlar = {};
  for (let i = 1; i < data.length; i++) {
    const kod = String(data[i][1] || "").trim();
    if (kod) mevcutKodlar[kod] = true;
  }

  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const yeniSatirlar = [];
  let acilan = 0, atlananMevcut = 0, atlananHatali = 0;

  kayitlar.forEach((k, idx) => {
    const stokKodu = String(k.stokKodu || "").trim();
    const stokAdi = String(k.stokAdi || "").trim();
    if (!stokKodu || !stokAdi) { atlananHatali++; return; }
    if (mevcutKodlar[stokKodu]) { atlananMevcut++; return; } // zaten açık bir kart var, DOKUNMA
    yeniSatirlar.push([
      "sk_gpd_" + Date.now() + "_" + idx,
      stokKodu, stokAdi, "adet", 0, "",
      parseFloat(k.alisFiyati) || 0, 0, 0, 0,
      kayitTarihi, "", "", "", "", "", 0, "",
    ]);
    mevcutKodlar[stokKodu] = true; // aynı çalıştırmada tekrar eşleşmesin
    acilan++;
  });

  if (yeniSatirlar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, yeniSatirlar.length, STOK_TANIM_BASLIKLAR.length).setValues(yeniSatirlar);
  }

  cacheTemizle(["stokTanimListesi"]);
  return { ok: true, acilanKartSayisi: acilan, atlananZatenVar: atlananMevcut, atlananHatali: atlananHatali };
}

// ★ Sunucu önbelleği (45 sn): FATURAFIYAT (dış e-tablo) + durum + alış + stok + cari sayfalarını her
// açılışta baştan okuyan en yavaş liste buydu. Durum/eşleşme değiştiren işlemler (onayla/reddet/
// sıfırla/önek eşleştirme) ve stok/cari/alış önbellekleri temizlenince (bkz. CACHE_BAGIMLI_) bu da
// temizlenir; dış otomasyonun yeni yazdığı faturalar en geç 45 sn içinde görünür.
function getBekleyenAlisFaturalari() {
  return cacheOkuVeyaHesapla("bekleyenAlisFaturalari", 45, function () {
    return getBekleyenAlisFaturalariHesapla_();
  });
}

function getBekleyenAlisFaturalariHesapla_() {
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
    isk: h.indexOf("ISKONTO"), isk2: h.indexOf("ISKONTO2"), net: h.indexOf("NET_FIYAT"), nak: h.indexOf("NAKLIYE_PAYI"),
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
  // EDM fatura no önekinden (ör. "CNY") tedarikçiye — bu SADECE bir ÖNERİ olarak sunulur,
  // otomatik seçilmez (tedarikçi adı eşleşmesinden farklı olarak kullanıcı onayı gerekir).
  const onekMap = edmOnekEslesmeOku(ss);
  // Fatura no önekine göre bilinen tedarikçi ürün kodu → stok kodu eşleştirmeleri (ör. "GPD").
  const tedarikciKoduEslesme = tedarikciUrunKoduEslesmeOku(ss);
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
      iskonto2: col.isk2 >= 0 ? (parseFloat(row[col.isk2]) || 0) : 0,
      netFiyat: parseFloat(row[col.net]) || 0, nakliyePayi: parseFloat(row[col.nak]) || 0,
      kdvOrani: parseFloat(row[col.kdv]) || 0,
    });
  }

  const sonuc = Object.values(gruplar).map(f => {
    f.kalemSayisi = f.kalemler.length;
    f.durum = islenmis[f.faturaNo] ? islenmis[f.faturaNo].durum : "Bekliyor";
    f.islemTarihi = islenmis[f.faturaNo] ? islenmis[f.faturaNo].islemTarihi : "";
    // ★ EŞLEŞTİRME ÖNCELİĞİ (19 Eyl 2026): fatura no ÖNEKİ (ör. "GEF" → Günaydın) ilk sırada.
    // Önek faturayı KESEN firmanın seri harfidir ve Ayarlar'da elle tanımlanabilir/kontrol
    // edilebilir; buna karşılık "gönderen" adı (TEDARIKCI, e-posta başlığından okunur) her zaman
    // gerçek fatura sahibini yansıtmaz (ör. GEF önekli fatura, gönderen adı "CAN ALÜMİNYUM"
    // olarak geldiği için eskiden yanlışlıkla Can Alüminyum cari'sine eşleniyordu).
    // Sıra: (1) önek eşleşmesi (cari hâlâ varsa) → (2) gönderen adı eşleşmesi → (3) eşleşme yok.
    f.onek = faturaOnekiCikar(f.faturaNo);
    // STOK_KODU boş gelen kalemler için, bu faturanın önekine ait bilinen tedarikçi ürün
    // kodlarına (ör. GPD → MTL160) karşı ürün adı taranır — eşleşirse stok kodu OTOMATİK
    // ÖNERİLİR ve BFM onay ekranında ilgili kutuya önceden dolu gelir (bkz. urunAdindanStokKoduBul_).
    // Kullanıcı yine de "Onayla"ya basmadan hiçbir şey Alış'a işlenmez, dilerse değiştirebilir.
    const bilinenKodlar = f.onek ? (tedarikciKoduEslesme[f.onek] || []) : [];
    if (bilinenKodlar.length) {
      f.kalemler.forEach(k => {
        if (k.stokKodu) return; // zaten FATURAFIYAT'tan gelen bir kod varsa dokunma
        const eslesme = urunAdindanStokKoduBul_(bilinenKodlar, k.urunAdi);
        if (eslesme) {
          k.stokKodu = eslesme.stokKodu;
          k.stokVarMi = !!stokKoduSeti[eslesme.stokKodu];
          k.otomatikEslesme = true;
          k.eslesenTedarikciKodu = eslesme.kod;
        }
      });
    }
    const adEslesenId = eslesmeMap[String(f.tedarikci || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr')] || "";
    const onekKaydi = f.onek ? onekMap[f.onek] : null;
    const onekCariGecerli = !!(onekKaydi && onekKaydi.cariId && (!cariListeSonuc.ok || cariByIdMap[onekKaydi.cariId]));
    let eslesenCariId = "", eslesmeKaynagi = "";
    if (onekCariGecerli) { eslesenCariId = onekKaydi.cariId; eslesmeKaynagi = "onek"; }
    else if (adEslesenId) { eslesenCariId = adEslesenId; eslesmeKaynagi = "tedarikci"; }
    f.eslesenCariId = eslesenCariId;
    f.eslesmeKaynagi = eslesmeKaynagi;
    f.eslesenCariAd = eslesenCariId
      ? (cariByIdMap[eslesenCariId] ? cariByIdMap[eslesenCariId].ad : (eslesmeKaynagi === "onek" ? (onekKaydi.cariAd || "") : ""))
      : "";
    // Önek bir cariyi işaret ederken gönderen adı FARKLI bir cariye eşliyse, kullanıcıya bilgi ver.
    if (eslesmeKaynagi === "onek" && adEslesenId && adEslesenId !== eslesenCariId) {
      f.adEslesmesiCariAd = cariByIdMap[adEslesenId] ? cariByIdMap[adEslesenId].ad : "";
    }
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
    tutarIskontosu: body.tutarIskontosu,
    projeKodu: body.projeKodu,
    kalemler: body.kalemler,
  });
  if (!alisSonuc.ok) return alisSonuc;

  durumSheet.appendRow([faturaNo, "Onaylandı", alisSonuc.id, String(body.aciklama || ""),
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);

  // Gerçek bir cari seçilerek onaylandıysa, aynı tedarikçiden gelecek sonraki faturalar
  // için bu eşleşmeyi hatırla (bir sonraki onay ekranında otomatik seçili gelsin).
  // ÖNEKLİ faturada gönderen adı güvenilir olmayabilir (bkz. getBekleyenAlisFaturalari önceliği):
  // bu ad ZATEN başka bir cariye eşliyse üzerine yazılmaz — aksi halde, örn. GEF (Günaydın)
  // faturasının gönderen adı "CAN ALÜMİNYUM" ise, gerçek Can Alüminyum faturaları da yanlışlıkla
  // Günaydın'a eşlenmeye başlardı. Ad daha önce hiç eşlenmediyse (veya fatura önek taşımıyorsa)
  // eskisi gibi öğrenilir.
  const onekOgren = faturaOnekiCikar(faturaNo);
  if (body.cariId && body.tedarikci) {
    const adAnahtar = String(body.tedarikci || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr');
    const mevcutAdEslesmeleri = tedarikciCariEslesmeOku(ss);
    if (!onekOgren || !mevcutAdEslesmeleri[adAnahtar]) {
      tedarikciCariEslesmeKaydet(ss, body.tedarikci, String(body.cariId).trim());
    }
  }
  // Fatura no'da bir önek varsa (ör. "CNY"), bu önek → cari eşleştirmesini de
  // öğren/güncelle — sonraki aynı önekli faturalarda BFM'de öneri olarak çıkar
  // (yine de otomatik uygulanmaz, kullanıcı onayı gerekir).
  const onek = faturaOnekiCikar(faturaNo);
  if (body.cariId && onek) {
    edmOnekEslesmeKaydet(ss, onek, String(body.cariId).trim(), String(body.cariAd || ""));
  }

  // Tedarikçi ürün kodu → stok kodu eşleştirmesini öğren/güncelle (bkz. yukarıdaki blok
  // ve tedarikciUrunKoduEslesmeKaydet). Faturanın bir öneki varsa (ör. "GPD") ve kalemin
  // ürün adında tedarikçi kodu gibi görünen bir desen (ör. "MTL160") tespit edilebiliyorsa,
  // kullanıcının bu kalem için SEÇTİĞİ/onayladığı stok koduyla eşleştirilip kaydedilir —
  // aynı kod bir sonraki faturada BFM'de otomatik önerilir. STOK_KODU zaten FATURAFIYAT'tan
  // gelmiş kalemlerde de zararsızca aynı eşleşme tazelenir (bkz. tedarikciUrunKoduEslesmeKaydet).
  if (onek && Array.isArray(body.kalemler)) {
    body.kalemler.forEach(k => {
      const stokKodu = String(k.stokKodu || "").trim();
      if (!stokKodu) return;
      const tedarikciKodu = urunAdindanKodCikar_(k.urunAdi);
      if (tedarikciKodu) {
        tedarikciUrunKoduEslesmeKaydet(ss, onek, tedarikciKodu, stokKodu, String(k.urunAdi || ""));
      }
    });
  }

  cacheTemizle(["bekleyenAlisFaturalari"]);
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

  cacheTemizle(["bekleyenAlisFaturalari"]);
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
    if (String(durumData[i][0]) === faturaNo) { durumSheet.deleteRow(i + 1); cacheTemizle(["bekleyenAlisFaturalari"]); return { ok: true }; }
  }
  return { ok: false, hata: "Bu fatura için işlenmiş bir kayıt bulunamadı" };
}

// Ana sayfada modüllerin altında gösterilen "Bugünkü Özet" kartları için. Zaten
// önbelleğe alınmış liste fonksiyonlarını (getSatisListesi/getAlisListesi/
// getTahsilatListesi/getOdemeListesi) çağırıp bugünün tarihine göre bellekte
// süzüyor — ek bir sayfa okuması yapmıyor, sadece o listelerin (60sn TTL)
// üzerine 30sn'lik ayrı bir önbellek katmanı ekliyor.
function getBugunOzet() {
  return cacheOkuVeyaHesapla("bugunOzet", 30, function () {
    const bugun = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd");
    function bugunMu(tarihStr) { return String(tarihStr || "").slice(0, 10) === bugun; }
    function topla(liste, alan) {
      return (liste || []).filter(x => bugunMu(x.tarih)).reduce((a, x) => a + (parseFloat(x[alan]) || 0), 0);
    }
    const satisRes = getSatisListesi();
    const satisBugun = (satisRes.satislar || []).filter(s => bugunMu(s.tarih));
    const siparisTutari = satisBugun.filter(s => s.belgeTipi === "Sipariş").reduce((a, s) => a + (parseFloat(s.toplamTutar) || 0), 0);
    const teklifTutari = satisBugun.filter(s => s.belgeTipi === "Teklif").reduce((a, s) => a + (parseFloat(s.toplamTutar) || 0), 0);
    const satisFaturaTutari = satisBugun.filter(s => !s.belgeTipi || s.belgeTipi === "Fatura").reduce((a, s) => a + (parseFloat(s.toplamTutar) || 0), 0);
    const alisRes = getAlisListesi();
    const alisFaturaTutari = topla(alisRes.alislar, "toplamTutar");
    const tahsilatRes = getTahsilatListesi();
    const tahsilatTutari = topla(tahsilatRes.tahsilatlar, "tutar");
    const odemeRes = getOdemeListesi();
    const odemeTutari = topla(odemeRes.odemeler, "tutar");
    return {
      ok: true,
      siparisTutari: siparisTutari, teklifTutari: teklifTutari,
      satisFaturaTutari: satisFaturaTutari, alisFaturaTutari: alisFaturaTutari,
      tahsilatTutari: tahsilatTutari, odemeTutari: odemeTutari,
    };
  });
}

function getFinansOzet() {
  return cacheOkuVeyaHesapla("finansOzet", 30, function () {
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
  });
}

// ════════════════════════════════════════════════
// RAPOR MODÜLÜ — tarih aralığına göre dökümü
// body: { baslangic (yyyy-MM-dd, opsiyonel), bitis (yyyy-MM-dd, opsiyonel) }
// ════════════════════════════════════════════════

function getRaporOzet(body) {
  const baslangic = String(body.baslangic || "");
  const bitis = String(body.bitis || "");
  return cacheOkuVeyaHesapla("raporOzet_" + baslangic + "_" + bitis, 45, function () {
  // yyyy-MM-dd formatında string karşılaştırması kronolojik sıralamayla aynı sonucu verir.
  // tarih artık saat de içerebildiğinden (yyyy-MM-ddTHH:mm), karşılaştırmadan önce sadece
  // gün kısmını (ilk 10 karakter) alıyoruz — yoksa "2026-08-30T14:30" gibi bir değer,
  // salt "2026-08-30" olan bitiş sınırından BÜYÜK sayılıp o güne ait kayıtlar rapordan düşerdi.
  function araligaDahilMi(tarih) {
    const gun = String(tarih || "").slice(0, 10);
    if (baslangic && gun < baslangic) return false;
    if (bitis && gun > bitis) return false;
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
  });
}

// Muhasebe programlarında bulunan klasik raporlar: Alış Fatura Raporu, Satış Fatura Raporu,
// Ürün Bazlı Hareket/Sipariş/Fatura Raporu. body: { tip, baslangic, bitis }
// tip: "alisFatura" | "satisFatura" | "urunBazliHareket" | "urunBazliSiparis" | "urunBazliFatura"
// Belirtilen tarih aralığındaki (baslangic/bitis boş = sınırsız) tüm Nakit kasa
// hareketlerini (Satış Faturası/Alış Faturası/Tahsilat/Ödeme) toplar. Hem "Tarih
// Aralıklı" hem "Günlük" Kasa Raporu modları ve devir (önceki gün bakiyesi)
// hesaplaması bu fonksiyonu kullanır.
// Kasa (nakit) hareketlerini 4 sayfadan TEK SEFERDE, tarih filtresi olmadan okur.
// Böylece "günlük" modda (devir + bugün) aynı sayfaları iki kez okumak gerekmez —
// kasaHareketleriTopla ve getMuhasebeRaporu bu ham listeyi birden çok kez agregeleyebilir.
function kasaNakitHamListesiOku(ss) {
  const liste = [];
  const cariKoduMap = cariKoduHaritasiOlustur(ss);

  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const sData = sSheet.getDataRange().getValues();
  for (let i = 1; i < sData.length; i++) {
    const row = sData[i];
    if (!row[0]) continue;
    const belgeTipi = String(row[8] || "") || "Fatura";
    if (belgeTipi !== "Fatura" || String(row[5] || "") !== "Nakit") continue;
    liste.push({ id: String(row[0]), tip: "SATIS", tarih: hucreTarihStr(row[1]), yon: "Giriş", kaynak: "Satış Faturası",
      cariAd: String(row[3] || ""), cariKodu: cariKoduMap[String(row[2] || "")] || "", tutar: parseFloat(row[4]) || 0, aciklama: String(row[6] || "") });
  }

  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const aData = aSheet.getDataRange().getValues();
  for (let i = 1; i < aData.length; i++) {
    const row = aData[i];
    if (!row[0]) continue;
    if (String(row[5] || "") !== "Nakit") continue;
    liste.push({ id: String(row[0]), tip: "ALIS", tarih: hucreTarihStr(row[1]), yon: "Çıkış", kaynak: "Alış Faturası",
      cariAd: String(row[3] || ""), cariKodu: cariKoduMap[String(row[2] || "")] || "", tutar: parseFloat(row[4]) || 0, aciklama: String(row[6] || "") });
  }

  const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"]);
  const tData = tSheet.getDataRange().getValues();
  for (let i = 1; i < tData.length; i++) {
    const row = tData[i];
    if (!row[0]) continue;
    if (String(row[5] || "") !== "Nakit") continue;
    liste.push({ id: String(row[0]), tip: "TAHSILAT", tarih: hucreTarihStr(row[1]), yon: "Giriş", kaynak: "Tahsilat",
      cariAd: String(row[3] || ""), cariKodu: cariKoduMap[String(row[2] || "")] || "", tutar: parseFloat(row[4]) || 0, aciklama: String(row[6] || "") });
  }

  const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
  ensureOdemePosBankaColonlari(oSheet);
  const oData = oSheet.getDataRange().getValues();
  for (let i = 1; i < oData.length; i++) {
    const row = oData[i];
    if (!row[0]) continue;
    if (String(row[5] || "") !== "Nakit") continue;
    const cariAd = String(row[3] || "");
    const hedefTipi = String(row[10] || "") || "Cari";
    const hedefAd = String(row[13] || "");
    const gosterilecekAd = cariAd || hedefAd || "—";
    liste.push({ id: String(row[0]), tip: "ODEME", tarih: hucreTarihStr(row[1]), yon: "Çıkış",
      kaynak: hedefTipi === "Cari" ? "Ödeme" : "Ödeme (" + hedefTipi + ")",
      cariAd: gosterilecekAd, cariKodu: hedefTipi === "Cari" ? (cariKoduMap[String(row[2] || "")] || "") : "", tutar: parseFloat(row[4]) || 0, aciklama: String(row[6] || "") });
  }

  return liste;
}

// Ham kasa listesini bir tarih aralığına göre süzüp toplar (sayfa erişimi yok, bellek içi).
function kasaAgregatOlustur(hamListe, baslangic, bitis) {
  function araligaDahilMi(tarih) {
    const gun = String(tarih || "").slice(0, 10);
    if (baslangic && gun < baslangic) return false;
    if (bitis && gun > bitis) return false;
    return true;
  }
  const satirlar = [];
  let toplamGiris = 0, toplamCikis = 0;
  hamListe.forEach(h => {
    if (!araligaDahilMi(h.tarih)) return;
    if (h.yon === "Giriş") toplamGiris += h.tutar; else toplamCikis += h.tutar;
    satirlar.push(h);
  });
  satirlar.sort((a, b) => a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0));
  return { satirlar: satirlar, toplamGiris: toplamGiris, toplamCikis: toplamCikis, bakiye: toplamGiris - toplamCikis };
}

function kasaHareketleriTopla(ss, baslangic, bitis) {
  return kasaAgregatOlustur(kasaNakitHamListesiOku(ss), baslangic, bitis);
}

// "YYYY-MM-DD" formatındaki bir tarihten bir gün öncesini aynı formatta döndürür.
function birGunOncesi(gunStr) {
  const parcalar = String(gunStr).split("-").map(Number);
  const d = new Date(parcalar[0], parcalar[1] - 1, parcalar[2]);
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, "Europe/Istanbul", "yyyy-MM-dd");
}

function getMuhasebeRaporu(body) {
  return cacheOkuVeyaHesapla("muhasebeRaporu_" + JSON.stringify(body), 45, function () {
  const tip = String(body.tip || "");
  const baslangic = String(body.baslangic || "");
  const bitis = String(body.bitis || "");
  function araligaDahilMi(tarih) {
    const gun = String(tarih || "").slice(0, 10);
    if (baslangic && gun < baslangic) return false;
    if (bitis && gun > bitis) return false;
    return true;
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (tip === "kasaRaporu") {
    const mod = String(body.mod || "aralik");
    if (mod === "gunluk") {
      const gun = String(body.gun || baslangic || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
      const hamListe = kasaNakitHamListesiOku(ss);
      const devirSonuc = kasaAgregatOlustur(hamListe, "", birGunOncesi(gun));
      const gunSonuc = kasaAgregatOlustur(hamListe, gun, gun);
      return {
        ok: true, tip: tip, mod: "gunluk", gun: gun,
        devir: devirSonuc.bakiye,
        satirlar: gunSonuc.satirlar, toplamGiris: gunSonuc.toplamGiris, toplamCikis: gunSonuc.toplamCikis,
        gunSonuBakiye: devirSonuc.bakiye + gunSonuc.toplamGiris - gunSonuc.toplamCikis,
      };
    }
    if (mod === "devirli") {
      // GÜNLÜK DEVİRLİ KASA: seçilen aralıktaki her hareketli gün için Devir (önceki gün sonu bakiyesi) → gün hareketleri →
      // Gün Sonu bakiyesi. Bir günün gün sonu bakiyesi ertesi hareketli günün devri olarak taşınır (hareketsiz günlerde bakiye değişmez).
      const hamListe = kasaNakitHamListesiOku(ss);
      const acilisDevir = baslangic ? kasaAgregatOlustur(hamListe, "", birGunOncesi(baslangic)).bakiye : 0;
      const gunHaritasi = {};
      hamListe.forEach(h => {
        const g = String(h.tarih || "").slice(0, 10);
        if (!g || !araligaDahilMi(g)) return;
        (gunHaritasi[g] = gunHaritasi[g] || []).push(h);
      });
      let bakiye = acilisDevir, genelGiris = 0, genelCikis = 0;
      const gunler = Object.keys(gunHaritasi).sort().map(g => {
        const satirlar = gunHaritasi[g].slice().sort((a, b) => (a.yon === b.yon ? 0 : (a.yon === "Giriş" ? -1 : 1)));
        let giris = 0, cikis = 0;
        satirlar.forEach(h => { if (h.yon === "Giriş") giris += h.tutar; else cikis += h.tutar; });
        const devir = bakiye;
        bakiye = devir + giris - cikis;
        genelGiris += giris; genelCikis += cikis;
        return { gun: g, devir: devir, toplamGiris: giris, toplamCikis: cikis, gunSonuBakiye: bakiye, satirlar: satirlar };
      });
      return { ok: true, tip: tip, mod: "devirli", baslangic: baslangic, bitis: bitis, acilisDevir: acilisDevir,
        gunler: gunler, toplamGiris: genelGiris, toplamCikis: genelCikis, kapanisBakiye: bakiye };
    }
    const sonuc = kasaHareketleriTopla(ss, baslangic, bitis);
    return { ok: true, tip: tip, mod: "aralik", satirlar: sonuc.satirlar, toplamGiris: sonuc.toplamGiris, toplamCikis: sonuc.toplamCikis, bakiye: sonuc.bakiye };
  }

  if (tip === "alisFatura") {
    const sheet = getOrCreateSheet(ss, SHEETS.alislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
    ensureAlisProjeKoduColonu(sheet);
    ensureAlisFaturaTipiColonu(sheet);
    const cariKoduMap = cariKoduHaritasiOlustur(ss);
    const data = sheet.getDataRange().getValues();
    const satirlar = [];
    let toplam = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] || !araligaDahilMi(hucreTarihStr(row[1]))) continue;
      const tutar = parseFloat(row[4]) || 0;
      toplam += tutar;
      satirlar.push({ id: String(row[0]), tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""), cariKodu: cariKoduMap[String(row[2] || "")] || "",
        tutar: tutar, odemeTipi: String(row[5] || ""), aciklama: String(row[6] || ""),
        projeKodu: metinOku_(row[9]), faturaTipi: metinOku_(row[10]) });
    }
    satirlar.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    return { ok: true, tip: tip, satirlar: satirlar, toplam: toplam };
  }

  if (tip === "satisFatura") {
    const sheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sheet);
    const cariKoduMap = cariKoduHaritasiOlustur(ss);
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
      satirlar.push({ id: String(row[0]), tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""), cariKodu: cariKoduMap[String(row[2] || "")] || "",
        tutar: tutar, odemeTipi: String(row[5] || ""), aciklama: String(row[6] || ""),
        projeKodu: metinOku_(row[21]), faturaTipi: metinOku_(row[22]) });
    }
    satirlar.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    return { ok: true, tip: tip, satirlar: satirlar, toplam: toplam };
  }

  if (tip === "projeFaturaRaporu") {
    // Kesilen (Satış Faturaları — sadece belgeTipi==="Fatura") ve Gelen (Alış Faturaları,
    // hepsi fiili alış) faturalarını Proje Kodu + Fatura Tipi kırılımında özetler.
    // "23 Eyl 2026: Proje Kodu/Fatura Tipi bazlı aylık fatura raporu" isteği.
    const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sSheet);
    const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
    ensureAlisProjeKoduColonu(aSheet);
    ensureAlisFaturaTipiColonu(aSheet);
    const cariKoduMap = cariKoduHaritasiOlustur(ss);

    const ozetHaritasi = {}; // anahtar: projeKodu+"||"+faturaTipi
    const ozetAl = (projeKodu, faturaTipi) => {
      const anahtar = projeKodu + "||" + faturaTipi;
      if (!ozetHaritasi[anahtar]) ozetHaritasi[anahtar] = {
        projeKodu: projeKodu, faturaTipi: faturaTipi,
        kesilenAdet: 0, kesilenTutar: 0, gelenAdet: 0, gelenTutar: 0,
      };
      return ozetHaritasi[anahtar];
    };

    const kesilenDetay = [];
    let toplamKesilenAdet = 0, toplamKesilenTutar = 0;
    const sData = sSheet.getDataRange().getValues();
    for (let i = 1; i < sData.length; i++) {
      const row = sData[i];
      if (!row[0] || !araligaDahilMi(hucreTarihStr(row[1]))) continue;
      const belgeTipi = String(row[8] || "") || "Fatura";
      if (belgeTipi !== "Fatura") continue;
      const tutar = parseFloat(row[4]) || 0;
      const projeKodu = metinOku_(row[21]);
      const faturaTipi = metinOku_(row[22]);
      toplamKesilenAdet++; toplamKesilenTutar += tutar;
      const o = ozetAl(projeKodu, faturaTipi);
      o.kesilenAdet++; o.kesilenTutar += tutar;
      kesilenDetay.push({ id: String(row[0]), yon: "Kesilen", tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""),
        cariKodu: cariKoduMap[String(row[2] || "")] || "", tutar: tutar, projeKodu: projeKodu, faturaTipi: faturaTipi });
    }

    const gelenDetay = [];
    let toplamGelenAdet = 0, toplamGelenTutar = 0;
    const aData = aSheet.getDataRange().getValues();
    for (let i = 1; i < aData.length; i++) {
      const row = aData[i];
      if (!row[0] || !araligaDahilMi(hucreTarihStr(row[1]))) continue;
      const tutar = parseFloat(row[4]) || 0;
      const projeKodu = metinOku_(row[9]);
      const faturaTipi = metinOku_(row[10]);
      toplamGelenAdet++; toplamGelenTutar += tutar;
      const o = ozetAl(projeKodu, faturaTipi);
      o.gelenAdet++; o.gelenTutar += tutar;
      gelenDetay.push({ id: String(row[0]), yon: "Gelen", tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""),
        cariKodu: cariKoduMap[String(row[2] || "")] || "", tutar: tutar, projeKodu: projeKodu, faturaTipi: faturaTipi });
    }

    const satirlar = Object.values(ozetHaritasi).map(o => ({ ...o, net: o.kesilenTutar - o.gelenTutar }));
    kesilenDetay.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    gelenDetay.sort((a, b) => a.tarih < b.tarih ? 1 : -1);
    return {
      ok: true, tip: tip, satirlar: satirlar,
      toplamKesilenAdet: toplamKesilenAdet, toplamKesilenTutar: toplamKesilenTutar,
      toplamGelenAdet: toplamGelenAdet, toplamGelenTutar: toplamGelenTutar,
      kesilenDetay: kesilenDetay, gelenDetay: gelenDetay,
    };
  }

  if (tip === "karZarar") {
    const stokKoduFiltre = String(body.stokKodu || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr');
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
    stokListe.forEach(s => { alisFiyatHaritasi[s.stokAdi.trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr')] = s.alisFiyati; });

    const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
      ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
    ensureSatisKalemVergiKolonlari(kSheet);
    const kData = kSheet.getDataRange().getValues();

    const urunMap = {}; // anahtar (urunAdi+stokKodu) -> {satisTutari, maliyet, miktar}
    let toplamSatis = 0, toplamMaliyet = 0, eslesmeyenSayisi = 0;
    for (let i = 1; i < kData.length; i++) {
      const row = kData[i];
      const satisId = String(row[1] || "");
      if (!satisId) continue;
      if (satisBelgeTipi[satisId] !== "Fatura") continue; // sadece kesilmiş faturalar
      const tarih = satisTarih[satisId] || "";
      if (!araligaDahilMi(tarih)) continue;

      const urunAdi = String(row[2] || "").trim();
      const stokKodu = String(row[10] || "");
      if (stokKoduFiltre && !stokKodu.replace(/[İIıi]/g,"i").toLocaleLowerCase('tr').includes(stokKoduFiltre) && !urunAdi.replace(/[İIıi]/g,"i").toLocaleLowerCase('tr').includes(stokKoduFiltre)) continue;
      const miktar = parseFloat(row[3]) || 0;
      const birimFiyat = parseFloat(row[5]) || 0;
      const iskontoYuzde = parseFloat(row[7]) || 0;
      const satirSatisTutari = miktar * birimFiyat * (1 - iskontoYuzde / 100);

      const alisFiyati = alisFiyatHaritasi[urunAdi.replace(/[İIıi]/g,"i").toLocaleLowerCase('tr')];
      const maliyetBilinmiyor = (alisFiyati === undefined);
      if (maliyetBilinmiyor) eslesmeyenSayisi++;
      const satirMaliyet = maliyetBilinmiyor ? 0 : (alisFiyati * miktar);

      toplamSatis += satirSatisTutari;
      toplamMaliyet += satirMaliyet;

      const anahtar = urunAdi + "||" + stokKodu;
      if (!urunMap[anahtar]) urunMap[anahtar] = { urunAdi, stokKodu, miktar: 0, satisTutari: 0, maliyet: 0, maliyetBilinmiyor: false };
      urunMap[anahtar].miktar += miktar;
      urunMap[anahtar].satisTutari += satirSatisTutari;
      urunMap[anahtar].maliyet += satirMaliyet;
      if (maliyetBilinmiyor) urunMap[anahtar].maliyetBilinmiyor = true;
    }

    const satirlar = Object.values(urunMap).map(u => ({
      urunAdi: u.urunAdi, stokKodu: u.stokKodu, miktar: u.miktar, satisTutari: u.satisTutari, maliyet: u.maliyet,
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
    // Kullanıcı stok kodu yazarak da (kısmi eşleşme, büyük/küçük harf duyarsız) filtreleyebilsin.
    const stokKoduFiltre = String(body.stokKodu || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase('tr');
    const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    ensureSatisBelgeTipiColonu(sSheet);
    const sData = sSheet.getDataRange().getValues();
    const cariKoduMap = cariKoduHaritasiOlustur(ss);
    const satisBelgeTipi = {}, satisTarih = {}, satisCariAd = {}, satisCariKodu = {}, satisFaturaNo = {}, satisOdemeTipi = {}, satisSiparisNo = {};
    for (let i = 1; i < sData.length; i++) {
      const id = String(sData[i][0] || "");
      if (!id) continue;
      satisBelgeTipi[id] = String(sData[i][8] || "") || "Fatura";
      satisTarih[id] = hucreTarihStr(sData[i][1]);
      satisCariAd[id] = String(sData[i][3] || "");
      satisCariKodu[id] = cariKoduMap[String(sData[i][2] || "")] || "";
      satisFaturaNo[id] = String(sData[i][16] || ""); // EFATURA_NO (varsa)
      satisOdemeTipi[id] = String(sData[i][5] || "");
      satisSiparisNo[id] = String(sData[i][15] || ""); // SIPARIS_NO
    }

    const kSheet = getOrCreateSheet(ss, SHEETS.satisKalemleri,
      ["ID","SATIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","ISKONTO_YUZDE","KDV_ORANI","FATURALANAN_MIKTAR","STOK_KODU"]);
    const kData = kSheet.getDataRange().getValues();
    const urunMap = {};
    // Ürün adı + stok kodu birlikte anahtar oluşturur — aynı üründe zaman içinde stok kodu
    // değiştiyse (veya hiç girilmediyse) satırlar birbirine karışmaz.
    function eslesiyorMu(urunAdi, stokKodu) {
      if (!stokKoduFiltre) return true;
      return String(stokKodu || "").replace(/[İIıi]/g,"i").toLocaleLowerCase('tr').includes(stokKoduFiltre) || String(urunAdi || "").replace(/[İIıi]/g,"i").toLocaleLowerCase('tr').includes(stokKoduFiltre);
    }
    function urunEkle(urunAdi, stokKodu, miktar, tutar, yon) {
      if (!eslesiyorMu(urunAdi, stokKodu)) return;
      const anahtar = urunAdi + "||" + (stokKodu || "");
      if (!urunMap[anahtar]) urunMap[anahtar] = { urunAdi: urunAdi, stokKodu: stokKodu || "", girisMiktar: 0, cikisMiktar: 0, tutar: 0 };
      if (yon === "giris") urunMap[anahtar].girisMiktar += miktar; else urunMap[anahtar].cikisMiktar += miktar;
      urunMap[anahtar].tutar += tutar;
    }

    // Stok bazlı sipariş raporu: bir stok seçilince (stokKoduFiltre dolu), o stoğa ait her
    // Sipariş kalemini tek tek de döndürüyoruz ("bekleyen" mi yoksa fatura edilmiş mi
    // görülebilsin diye) — FATURALANAN_MIKTAR alanına göre. Filtre boşsa (tüm ürünler)
    // bu liste boş kalır, sadece aggregate tablo gösterilir (çok kalabalık olmasın diye).
    const siparisDetaylari = [];
    // Ürün Bazlı Fatura Raporu da (Sipariş raporuyla aynı biçimde) bir stok seçilince kalem kalem döner.
    const faturaDetaylari = [];
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
      const stokKodu = String(row[10] || "");
      urunEkle(urunAdi, stokKodu, parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "cikis");
      if (tip === "urunBazliFatura" && stokKoduFiltre && eslesiyorMu(urunAdi, stokKodu)) {
        const fMiktar = parseFloat(row[3]) || 0, fTutar = parseFloat(row[6]) || 0;
        faturaDetaylari.push({
          satisId: satisId, tarih: tarih, faturaNo: satisFaturaNo[satisId] || "", cariAd: satisCariAd[satisId] || "", cariKodu: satisCariKodu[satisId] || "",
          odemeTipi: satisOdemeTipi[satisId] || "", urunAdi: urunAdi, stokKodu: stokKodu, birim: String(row[4] || ""),
          miktar: fMiktar, birimFiyat: parseFloat(row[5]) || 0, iskontoYuzde: parseFloat(row[7]) || 0, kdvOrani: parseFloat(row[8]) || 0, tutar: fTutar,
        });
      }
      if (tip === "urunBazliSiparis" && stokKoduFiltre && eslesiyorMu(urunAdi, stokKodu)) {
        const miktar = parseFloat(row[3]) || 0;
        const tutarToplam = parseFloat(row[6]) || 0;
        const faturalananMiktar = Math.min(miktar, parseFloat(row[9]) || 0);
        const kalanMiktar = Math.max(0, miktar - faturalananMiktar);
        // Fatura edilen/bekleyen TUTAR, miktar oranına göre orantılı hesaplanır — sipariş
        // kaleminin TUTAR'ı hep TAM sipariş miktarı üzerinden tek satırda tutulur, kısmi
        // faturalanma ayrı bir satır/tutar olarak saklanmaz (bkz. siparistenFaturaOlustur).
        const faturalananTutar = miktar > 0 ? tutarToplam * (faturalananMiktar / miktar) : 0;
        const kalanTutar = Math.max(0, tutarToplam - faturalananTutar);
        siparisDetaylari.push({
          satisId: satisId, tarih: tarih, siparisNo: satisSiparisNo[satisId] || "", cariAd: satisCariAd[satisId] || "", cariKodu: satisCariKodu[satisId] || "",
          urunAdi: urunAdi, stokKodu: stokKodu, birim: String(row[4] || ""),
          miktar: miktar, faturalananMiktar: faturalananMiktar, kalanMiktar: kalanMiktar,
          tutar: tutarToplam, faturalananTutar: faturalananTutar, kalanTutar: kalanTutar,
          durum: kalanMiktar > 0.0001 ? (faturalananMiktar > 0.0001 ? "Kısmen Faturalandı" : "Bekliyor") : "Faturalandı",
        });
      }
    }
    siparisDetaylari.sort((a, b) => (a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0)));
    faturaDetaylari.sort((a, b) => (a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0)));

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
        urunEkle(urunAdi, String(row[7] || ""), parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "giris");
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
        // Bu sayfada STOK_KODU sütunu yok — ürün adıyla eşleştirilir (bkz. yorum yukarıda).
        urunEkle(urunAdi, "", parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "cikis");
      }

      // Satış İadeleri: müşteriden geri gelen mal, çıkıştan düşülür (giriş olarak sayılır).
      // (Bu blok eklenmeden önce Satış İadesi diye bir modül hiç yoktu.)
      const siSheet = getOrCreateSheet(ss, SHEETS.satisIadeler,
        ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
      const siData = siSheet.getDataRange().getValues();
      const satisIadeTarih = {};
      for (let i = 1; i < siData.length; i++) {
        const id = String(siData[i][0] || "");
        if (id) satisIadeTarih[id] = hucreTarihStr(siData[i][1]);
      }
      const sikSheet = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
        ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
      const sikData = sikSheet.getDataRange().getValues();
      for (let i = 1; i < sikData.length; i++) {
        const row = sikData[i];
        const iadeId = String(row[1] || "");
        const tarih = satisIadeTarih[iadeId] || "";
        if (!tarih || !araligaDahilMi(tarih)) continue;
        const urunAdi = String(row[2] || "");
        if (!urunAdi) continue;
        urunEkle(urunAdi, String(row[7] || ""), parseFloat(row[3]) || 0, parseFloat(row[6]) || 0, "giris");
      }
    }

    const satirlar = Object.values(urunMap).sort((a, b) => b.tutar - a.tutar);
    const sonuc = { ok: true, tip: tip, satirlar: satirlar, toplam: satirlar.reduce((t, s) => t + s.tutar, 0) };
    if (tip === "urunBazliSiparis" && stokKoduFiltre) sonuc.siparisDetaylari = siparisDetaylari;
    if (tip === "urunBazliFatura" && stokKoduFiltre) sonuc.faturaDetaylari = faturaDetaylari;
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
  });
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

const STOK_TANIM_BASLIKLAR = ["ID","STOK_KODU","STOK_ADI","BIRIM1","AMBALAJ_MIKTARI","AMBALAJ_BIRIMI","ALIS_FIYATI","ALIS_ISKONTOSU","SATIS_FIYATI","SATIS_ISKONTOSU","KAYIT_TARIHI","MARKA_ID","URUN_GRUBU_ID","ALT_URUN_GRUBU_ID","EBAT_ID","RENK_ID","MIN_STOK","BARKOD","KDV_ALIS","KDV_SATIS"];

// Eskiden 11 sütunlu oluşturulmuş StokTanimlari sayfalarına, sona yeni
// tanım sütunlarını ekler (yalnızca eksikse — getOrCreateSheet zaten var olan
// sayfalara başlık eklemediği için bu göç adımı gerekli). KDV_ALIS/KDV_SATIS
// 23 Eyl 2026'da eklendi (Akınsoft ilhamlı Stok Tanımları yeniden tasarımı).
function ensureStokTanimEkColonlari(sheet) {
  const eklenecek = ["MARKA_ID","URUN_GRUBU_ID","ALT_URUN_GRUBU_ID","EBAT_ID","RENK_ID","MIN_STOK","BARKOD","KDV_ALIS","KDV_SATIS"];
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
    // KDV oranları boşsa (eski kayıtlar) Türkiye'deki genel oran %20 varsayılır.
    kdvAlis: (row[18] === "" || row[18] === undefined || row[18] === null) ? 20 : (parseFloat(row[18]) || 0),
    kdvSatis: (row[19] === "" || row[19] === undefined || row[19] === null) ? 20 : (parseFloat(row[19]) || 0),
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

// ★ ESKİ "STOK PANELİ" PROGRAMININ STOK ANLIK GÖRÜNTÜSÜ (19 Eyl 2026): Wolvox'tan yüklenen stok
// (MERKEZ_DEPO), ayrılmış (AYRILMIS) ve satılabilir (SATILABILIR) miktarları ile yükleme tarihi
// (TARIH), aynı Google Sheet'teki "Stoklar" sayfasında tutuluyor (son 7 yüklemeyi saklar). ERP'nin
// Stok Rehberi (F2) bu bilgileri stok koduna göre ayrı kolonlarda gösterir. Sadece EN SON tarihli
// yüklemenin satırları döner; sayfa yoksa/boşsa boş harita döner (kolonlar "—" görünür).
// Sonuç: { ok, tarih:"YYYY-MM-DD", kodlar:{ "<stokKodu>": [stok, ayrilmis, satilabilir], ... } }
function getStokPanelSnapshot() {
  return cacheOkuVeyaHesapla("stokPanelSnapshot", 120, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Stoklar");
    if (!sheet) return { ok: true, tarih: "", kodlar: {} };
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: true, tarih: "", kodlar: {} };
    const basliklar = data[0].map(function (h) { return String(h).toUpperCase().trim(); });
    const iKod = basliklar.indexOf("STOK_KODU"), iStok = basliklar.indexOf("MERKEZ_DEPO");
    const iAyr = basliklar.indexOf("AYRILMIS"), iSat = basliklar.indexOf("SATILABILIR");
    const iTar = basliklar.indexOf("TARIH");
    if (iKod < 0 || iTar < 0) return { ok: true, tarih: "", kodlar: {} };
    const tarihMetni = function (v) {
      if (v instanceof Date) return Utilities.formatDate(v, "Europe/Istanbul", "yyyy-MM-dd");
      return String(v || "").split("T")[0].trim();
    };
    const sayi = function (v) {
      if (typeof v === "number") return v;
      const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
      return isNaN(n) ? 0 : n;
    };
    // 1) En son (en büyük) tarihi bul — "pasif" işaretli satırlar atlanır. ISO tarih olduğu için metin karşılaştırması yeterli.
    let sonTarih = "";
    for (let i = 1; i < data.length; i++) {
      const t = tarihMetni(data[i][iTar]);
      if (!t || t.indexOf("pasif") !== -1) continue;
      if (t > sonTarih) sonTarih = t;
    }
    if (!sonTarih) return { ok: true, tarih: "", kodlar: {} };
    // 2) Sadece o tarihin satırlarını stok koduna göre topla.
    const kodlar = {};
    for (let i = 1; i < data.length; i++) {
      if (tarihMetni(data[i][iTar]) !== sonTarih) continue;
      const kod = String(data[i][iKod] === undefined || data[i][iKod] === null ? "" : data[i][iKod]).trim();
      if (!kod) continue;
      kodlar[kod] = [
        iStok >= 0 ? sayi(data[i][iStok]) : 0,
        iAyr >= 0 ? sayi(data[i][iAyr]) : 0,
        iSat >= 0 ? sayi(data[i][iSat]) : 0,
      ];
    }
    return { ok: true, tarih: sonTarih, kodlar: kodlar };
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

// ★ EKLENDİ (23 Eyl 2026): Stok kodunun ilk 2 hanesi marka kodu ise (bkz. stokTanimSatiriNesneYap
// markaKodu alanı ve stokKoduOner'ın ürettiği şema), Marka Tanımlama'daki (Ayarlar) kayıtlı
// markalardan KOD'u eşleşeni bulup id'sini döner; eşleşme yoksa "" döner.
function markaKoduIleEslesenMarkaId_(stokKodu) {
  const markaKodu = String(stokKodu || "").trim().toUpperCase().slice(0, 2);
  if (markaKodu.length !== 2) return "";
  const marka = (getMarkaListesi().markalar || []).find(m => m.kod === markaKodu);
  return marka ? marka.id : "";
}

// ★ EKLENDİ (23 Eyl 2026): Var olan tüm stok kartlarında Marka alanı boşsa, stok kodunun ilk 2
// hanesini Marka Tanımlama'daki kodlarla eşleştirip otomatik doldurur. Marka zaten seçiliyse
// (elle seçilmiş olabilir) DOKUNULMAZ — kullanıcı isterse zaten dilediği zaman elle değiştirebilir.
// Stok Tanımları ekranındaki "🏷️ Marka Kodlarını İşle" butonundan tetiklenir.
function stokTanimMarkaKoduIsleToplu() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  ensureStokTanimEkColonlari(sheet);
  const data = sheet.getDataRange().getValues();
  const markalar = getMarkaListesi().markalar || [];
  if (markalar.length === 0) return { ok: false, hata: "Önce Ayarlar › Marka Tanımlama'dan marka kodları girilmeli" };
  const kodHaritasi = {};
  markalar.forEach(m => { if (m.kod) kodHaritasi[m.kod] = m.id; });
  let guncellenen = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const markaIdMevcut = String(data[i][11] || "").trim();
    if (markaIdMevcut) continue; // zaten seçilmiş — elle atanmış olabilir, dokunma
    const stokKodu = String(data[i][1] || "").trim().toUpperCase();
    const markaId = kodHaritasi[stokKodu.slice(0, 2)];
    if (markaId) {
      sheet.getRange(i + 1, 12).setValue(markaId); // MARKA_ID = 12. sütun
      guncellenen++;
    }
  }
  if (guncellenen > 0) cacheTemizle(["stokTanimListesi"]);
  return { ok: true, guncellenen: guncellenen };
}

//         alisFiyati, alisIskontosu, kdvAlis, satisFiyati, satisIskontosu, kdvSatis,
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
  const yeniKayitMi = !id;
  if (yeniKayitMi) id = "sk_" + Date.now();

  // ★ Stok kodu tüm modüller arası ana bağlantı olduğu için: MEVCUT bir kaydın kodu bu
  // genel kaydetme fonksiyonuyla asla değiştirilmez (frontend'de alan salt-okunur olsa da
  // burada da güvenceye alınıyor) — kod değişikliği SADECE bağlı tüm hareketleri de
  // taşıyan stokKoduDegistir() üzerinden yapılabilir. Yeni kayıtta boş bırakılırsa
  // ("gerekirse sen ata" — kritik bir alan boş kalmasın diye) otomatik, biricik bir kod
  // atanır; kullanıcı isterse sonradan stokKoduDegistir ile kendi kodunu verebilir.
  let stokKodu;
  if (!yeniKayitMi) {
    stokKodu = String(data[satirIdx - 1][1] || "");
  } else {
    stokKodu = String(body.stokKodu || "").trim();
    if (!stokKodu) stokKodu = "OTO" + Date.now();
  }

  // ★ EKLENDİ (23 Eyl 2026): Marka elle seçilmediyse, stok kodunun ilk 2 hanesini Marka
  // Tanımlama'daki kodlarla eşleştirip otomatik doldurur. Kullanıcı elle bir marka seçtiyse
  // (body.markaId doluysa) buna asla dokunulmaz — otomatik atama sadece boşsa devreye girer.
  let markaId = String(body.markaId || "").trim();
  if (!markaId) markaId = markaKoduIleEslesenMarkaId_(stokKodu);

  const satir = [
    id,
    stokKodu,
    stokAdi,
    String(body.birim1 || "adet"),
    parseFloat(body.ambalajMiktari) || 0,
    String(body.ambalajBirimi || ""),
    parseFloat(body.alisFiyati) || 0,
    parseFloat(body.alisIskontosu) || 0,
    parseFloat(body.satisFiyati) || 0,
    parseFloat(body.satisIskontosu) || 0,
    satirIdx > 0 ? data[satirIdx - 1][10] : Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"),
    String(markaId),
    String(body.urunGrubuId || ""),
    String(body.altUrunGrubuId || ""),
    String(body.ebatId || ""),
    String(body.renkId || ""),
    parseFloat(body.minStok) || 0,
    String(body.barkod || ""),
    body.kdvAlis === undefined || body.kdvAlis === "" ? 20 : (parseFloat(body.kdvAlis) || 0),
    body.kdvSatis === undefined || body.kdvSatis === "" ? 20 : (parseFloat(body.kdvSatis) || 0),
  ];
  if (satirIdx > 0) sheet.getRange(satirIdx, 1, 1, satir.length).setValues([satir]);
  else sheet.appendRow(satir);
  cacheTemizle(["stokTanimListesi"]);
  return { ok: true, id: id, stokKodu: stokKodu };
}

// ★ EKLENDİ: Firma stok kodu şeması — 12 hane: [Marka 2][Ürün Grubu 2][Alt Ürün Grubu 2]
// [Firma Kodu 5][Kalite 1]. Marka/Ürün Grubu/Alt Ürün Grubu'nun kendi tanımlarındaki 2
// haneli KOD'ları birleştirilip, kalan 5+1 haneyi bu fonksiyon otomatik tamamlar:
//  - faturaKodu verilmişse (tedarikçi/e-fatura satırında kendi ürün kodu varsa): o kodun
//    RAKAMLARININ SON 5 HANESİ kullanılır (kısaysa başına 0 eklenerek tamamlanır).
//  - verilmemişse (stoksuz gelen e-faturalarda olduğu gibi): aynı marka+grup+alt grup
//    kombinasyonunda kullanılan en büyük firma kodundan bir sonraki sıra no üretilir (00001'den başlar).
// Kalite kodu belirtilmemişse "1" (1. kalite) varsayılır — kullanıcı isterse elle değiştirebilir.
function stokKoduOner(body) {
  const marka = (getMarkaListesi().markalar || []).find(m => m.id === String(body.markaId || ""));
  if (!marka) return { ok: false, hata: "Marka seçilmeli" };
  if (!marka.kod || marka.kod.length !== 2) return { ok: false, hata: "'" + marka.ad + "' markasının kodu tanımlı değil (Ayarlar › Marka Tanımlama)" };

  const grup = (getBasitTanimListesi("urunGrubu").kalemler || []).find(g => g.id === String(body.urunGrubuId || ""));
  if (!grup) return { ok: false, hata: "Ürün Grubu seçilmeli" };
  if (!grup.kod || grup.kod.length !== 2) return { ok: false, hata: "'" + grup.ad + "' ürün grubunun kodu tanımlı değil (Ayarlar › Ürün Grubu Tanımlama)" };

  const altGrup = (getBasitTanimListesi("altUrunGrubu").kalemler || []).find(a => a.id === String(body.altUrunGrubuId || ""));
  if (!altGrup) return { ok: false, hata: "Alt Ürün Grubu seçilmeli" };
  if (!altGrup.kod || altGrup.kod.length !== 2) return { ok: false, hata: "'" + altGrup.ad + "' alt ürün grubunun kodu tanımlı değil (Ayarlar › Alt Ürün Grubu Tanımlama)" };

  const onEk = marka.kod + grup.kod + altGrup.kod; // ilk 6 hane

  const mevcutKodlar = {};
  (getStokTanimListesi().kalemler || []).forEach(s => { if (s.stokKodu) mevcutKodlar[s.stokKodu] = true; });

  let firmaKodu;
  const faturaKoduRakam = String(body.faturaKodu || "").replace(/[^0-9]/g, "");
  if (faturaKoduRakam) {
    firmaKodu = faturaKoduRakam.slice(-5).padStart(5, "0");
  } else {
    let maxSira = 0;
    Object.keys(mevcutKodlar).forEach(kod => {
      if (kod.length === 12 && kod.slice(0, 6) === onEk) {
        const sira = parseInt(kod.slice(6, 11), 10);
        if (!isNaN(sira) && sira > maxSira) maxSira = sira;
      }
    });
    firmaKodu = String(maxSira + 1).padStart(5, "0");
  }

  const kaliteKodu = (String(body.kaliteKodu || "1").trim().slice(0, 1)) || "1";

  let stokKodu = onEk + firmaKodu + kaliteKodu;
  // Üretilen kod (nadiren) zaten kullanılıyorsa firma kodunu artırarak birkaç kez daha dene.
  let deneme = 0;
  while (mevcutKodlar[stokKodu] && deneme < 30) {
    firmaKodu = String(parseInt(firmaKodu, 10) + 1).padStart(5, "0");
    stokKodu = onEk + firmaKodu + kaliteKodu;
    deneme++;
  }
  if (mevcutKodlar[stokKodu]) return { ok: false, hata: "Uygun bir kod üretilemedi, lütfen elle girin" };

  return { ok: true, stokKodu: stokKodu, kaynak: faturaKoduRakam ? "fatura" : "otomatik" };
}

// ★ EKLENDİ: Stok kodu değişikliği — StokTanımları'nda kendi kodu, ve bağlı TÜM veri
// akışında (SatisKalemleri, AlisKalemleri, StokHareketleri — bu üçünde de STOK_KODU
// denormalize edilmiş halde ayrıca tutuluyor) eski kod geçen her satırı yeni koda taşır.
// Yeni kod BAŞKA açık bir stok kartında zaten kullanılıyorsa işlem reddedilir (kullanıcı
// farklı/boş bir kod seçmeli) — iki kartın aynı kodu paylaşması "stok kodu ana bağlantı"
// ilkesini bozar.
function stokKoduDegistir(body) {
  const id = String(body.id || "").trim();
  const yeniKod = String(body.yeniKod || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  if (!yeniKod) return { ok: false, hata: "Yeni stok kodu boş olamaz" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let satirIdx = -1, eskiKod = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { satirIdx = i + 1; eskiKod = String(data[i][1] || ""); break; }
  }
  if (satirIdx === -1) return { ok: false, hata: "Stok tanımı bulunamadı" };
  if (yeniKod === eskiKod) return { ok: true, degisiklikYok: true };
  for (let i = 1; i < data.length; i++) {
    if (i + 1 === satirIdx) continue;
    if (String(data[i][1] || "") === yeniKod) {
      return { ok: false, hata: `"${yeniKod}" kodu zaten "${data[i][2]}" adlı açık bir stok kartında kullanılıyor. Lütfen başka/boş bir kod seçin.` };
    }
  }
  sheet.getRange(satirIdx, 2).setValue(yeniKod); // STOK_KODU kolonu (2. sütun)

  // Bağlı veri akışlarını taşı (sadece eskiKod dolu değilse — boştan boşa taşımaya gerek yok).
  let tasinanSayisi = 0;
  if (eskiKod) {
    const guncelle = (sheetAdi, kolonBasligi) => {
      const sh = ss.getSheetByName(sheetAdi);
      if (!sh) return;
      const d = sh.getDataRange().getValues();
      if (d.length === 0) return;
      const kolIdx = d[0].indexOf(kolonBasligi);
      if (kolIdx === -1) return;
      for (let i = 1; i < d.length; i++) {
        if (String(d[i][kolIdx] || "") === eskiKod) {
          sh.getRange(i + 1, kolIdx + 1).setValue(yeniKod);
          tasinanSayisi++;
        }
      }
    };
    guncelle(SHEETS.satisKalemleri, "STOK_KODU");
    guncelle(SHEETS.alisKalemleri, "STOK_KODU");
    guncelle(SHEETS.alisIadeKalemleri, "STOK_KODU");
    guncelle(SHEETS.stokHareketleri, "STOK_KODU");
  }
  cacheTemizle(["stokTanimListesi"]);
  return { ok: true, eskiKod: eskiKod, yeniKod: yeniKod, tasinanKayitSayisi: tasinanSayisi };
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
const STOK_HAREKET_BASLIKLAR = ["ID","TARIH","STOK_TANIM_ID","STOK_KODU","STOK_ADI","BIRIM","HAREKET_TIPI","MIKTAR","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI","BELGE_NO","MALIYET_FIYATI"];

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
      parseFloat(k.birimFiyat) || 0,
    ]);
  });
  if (satirlar.length) {
    shSheet.getRange(shSheet.getLastRow() + 1, 1, satirlar.length, STOK_HAREKET_BASLIKLAR.length).setValues(satirlar);
    kdBacakNotu_({ k: "stok", tip: hareketTipi, kaynak: SHEETS.stokHareketleri, kid: String(belgeNo), tutar: satirlar.reduce((t, x) => t + (parseFloat(x[7]) || 0) * (parseFloat(x[12]) || 0), 0), tarih: tarih, ek: "" });
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
          birim: String(skData[j][4] || "adet"), stokKodu: String(skData[j][10] || ""), birimFiyat: parseFloat(skData[j][5]) || 0 });
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
          birim: String(akData[j][4] || "adet"), stokKodu: String(akData[j][7] || ""), birimFiyat: parseFloat(akData[j][5]) || 0 });
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
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisIadeKalemStokKoduColonu(aikSheet);
  const aikData = aikSheet.getDataRange().getValues();
  for (let i = 1; i < aiData.length; i++) {
    const aiId = String(aiData[i][0] || "");
    if (!aiId || islenmisBelgeNolar[aiId]) continue;
    const kalemler = [];
    for (let j = 1; j < aikData.length; j++) {
      if (String(aikData[j][1]) === aiId) {
        kalemler.push({ urunAdi: String(aikData[j][2] || ""), miktar: parseFloat(aikData[j][3]) || 0,
          birim: String(aikData[j][4] || "adet"), stokKodu: String(aikData[j][7] || "") });
      }
    }
    if (kalemler.length) {
      stokHareketOtomatikYaz(ss, kalemler, hucreTarihStr(aiData[i][1]), "Çıkış", "Alış İadesi", aiId,
        "Alış İadesi — " + String(aiData[i][3] || ""));
      eklenen++;
    }
  }

  // Satış İadeleri
  const siSheet2 = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const siData2 = siSheet2.getDataRange().getValues();
  const sikSheet2 = getOrCreateSheet(ss, SHEETS.satisIadeKalemleri,
    ["ID","IADE_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  const sikData2 = sikSheet2.getDataRange().getValues();
  for (let i = 1; i < siData2.length; i++) {
    const siId = String(siData2[i][0] || "");
    if (!siId || islenmisBelgeNolar[siId]) continue;
    const kalemler = [];
    for (let j = 1; j < sikData2.length; j++) {
      if (String(sikData2[j][1]) === siId) {
        kalemler.push({ urunAdi: String(sikData2[j][2] || ""), miktar: parseFloat(sikData2[j][3]) || 0,
          birim: String(sikData2[j][4] || "adet"), stokKodu: String(sikData2[j][7] || "") });
      }
    }
    if (kalemler.length) {
      stokHareketOtomatikYaz(ss, kalemler, hucreTarihStr(siData2[i][1]), "Giriş", "Satış İadesi", siId,
        "Satış İadesi — " + String(siData2[i][3] || ""));
      eklenen++;
    }
  }

  cacheTemizle(["stokHareketListesi"]);
  return { ok: true, eklenenBelgeSayisi: eklenen };
}

// ★ ONARIM FONKSİYONU (2 Eyl 2026'da MALIYET_FIYATI kolonu eklenirken oluşan bug için):
// stokHareketOtomatikYaz o dönemde 12 sütunluk satır yazıp 13 sütunluk aralığa yazmaya
// çalıştığından hata fırlatıyordu; bu hata Satış/Alış/Alış İade kaydı (başlık+kalemler)
// SHEET'E YAZILDIKTAN SONRA oluştuğu için o kayıtlar "hata verdi" görünmesine rağmen
// aslında kısmen kaydedilmiş olabilir: Stok Hareket satırı VE ona bağlı Cari Hareket
// (Borç/Alacak) hiç oluşmamış olabilir. stokHareketGecmisiDoldur stok tarafını onarıyordu;
// bu fonksiyon da aynı mantıkla eksik Cari Hareket (Borç/Alacak) kayıtlarını tamamlar.
// Her belge için CariHareketler'de "PREFIX:id" ile başlayan bir ACIKLAMA zaten var mı diye
// bakar, yoksa Satış/Alış/Alış İade'deki mevcut TOPLAM_TUTAR'ı kullanarak ekler.
// Tekrar çalıştırmak güvenlidir (zaten var olan hareketler atlanır).
function cariHareketGecmisiDoldur() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const hSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID","CARI_ID","TARIH","TIP","TUTAR","ACIKLAMA","KAYIT_TARIHI","VADE"]);
  const hData = hSheet.getDataRange().getValues();
  const islenmisSet = {};
  for (let i = 1; i < hData.length; i++) {
    const aciklama = String(hData[i][5] || "");
    const isaret = aciklama.split(" | ")[0]; // örn. "SATIS:st_12345"
    if (isaret) islenmisSet[isaret] = true;
  }

  let eklenen = 0;

  // Satış Faturaları (sadece belgeTipi==="Fatura", Sipariş/Teklif hariç)
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const sData = sSheet.getDataRange().getValues();
  for (let i = 1; i < sData.length; i++) {
    const sId = String(sData[i][0] || "");
    const cariId = String(sData[i][2] || "");
    const belgeTipi = String(sData[i][8] || "Fatura");
    if (!sId || !cariId || belgeTipi !== "Fatura") continue;
    if (islenmisSet["SATIS:" + sId]) continue;
    const toplamTutar = parseFloat(sData[i][4]) || 0;
    if (toplamTutar <= 0) continue;
    cariHareketEkle({
      cariId: cariId, tarih: hucreTarihStr(sData[i][1]), tip: "Borç", tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("SATIS", sId, "satis_" + belgeTipi, String(sData[i][6] || "") + " (geriye dönük onarım)"),
      vade: String(sData[i][5] || "") === "Açık Hesap" ? hucreTarihStr(sData[i][1]) : "",
    });
    eklenen++;
  }

  // Alış Faturaları
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const aData = aSheet.getDataRange().getValues();
  for (let i = 1; i < aData.length; i++) {
    const aId = String(aData[i][0] || "");
    const cariId = String(aData[i][2] || "");
    if (!aId || !cariId) continue;
    if (islenmisSet["ALIS:" + aId]) continue;
    const toplamTutar = parseFloat(aData[i][4]) || 0;
    if (toplamTutar <= 0) continue;
    cariHareketEkle({
      cariId: cariId, tarih: hucreTarihStr(aData[i][1]), tip: "Alacak", tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("ALIS", aId, "alis", String(aData[i][6] || "") + " (geriye dönük onarım)"),
    });
    eklenen++;
  }

  // Alış İadeleri
  const aiSheet = getOrCreateSheet(ss, SHEETS.alisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const aiData = aiSheet.getDataRange().getValues();
  for (let i = 1; i < aiData.length; i++) {
    const aiId = String(aiData[i][0] || "");
    const cariId = String(aiData[i][2] || "");
    if (!aiId || !cariId) continue;
    if (islenmisSet["ALISIADE:" + aiId]) continue;
    const toplamTutar = parseFloat(aiData[i][4]) || 0;
    if (toplamTutar <= 0) continue;
    cariHareketEkle({
      cariId: cariId, tarih: hucreTarihStr(aiData[i][1]), tip: "Borç", tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("ALISIADE", aiId, "alisiade", String(aiData[i][5] || "") + " (geriye dönük onarım)"),
    });
    eklenen++;
  }

  // Satış İadeleri
  const siSheet3 = getOrCreateSheet(ss, SHEETS.satisIadeler,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
  const siData3 = siSheet3.getDataRange().getValues();
  for (let i = 1; i < siData3.length; i++) {
    const siId = String(siData3[i][0] || "");
    const cariId = String(siData3[i][2] || "");
    if (!siId || !cariId) continue;
    if (islenmisSet["SATISIADE:" + siId]) continue;
    const toplamTutar = parseFloat(siData3[i][4]) || 0;
    if (toplamTutar <= 0) continue;
    cariHareketEkle({
      cariId: cariId, tarih: hucreTarihStr(siData3[i][1]), tip: "Alacak", tutar: toplamTutar,
      aciklama: cariHareketAciklamaOlustur("SATISIADE", siId, "satisiade", String(siData3[i][5] || "") + " (geriye dönük onarım)"),
    });
    eklenen++;
  }

  cacheTemizle(["cariListesi_v3"]);
  return { ok: true, eklenenHareketSayisi: eklenen };
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
  const h13 = sheet.getRange(1, 13).getValue();
  if (String(h13 || "") !== "MALIYET_FIYATI") {
    sheet.getRange(1, 13).setValue("MALIYET_FIYATI").setFontWeight("bold").setBackground("#e8edf5");
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
    maliyetFiyati: parseFloat(row[12]) || 0,
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

  const genelBelgeTipi = String(body.genelBelgeTipi || "");
  const satirlar = [];
  let eklenen = 0, atlanan = 0;
  // Devir/Stok Düzeltme girişlerinde satırda Maliyet Fiyatı verilmişse, o ürünün stok
  // tanımındaki Alış Fiyatı'nı (maliyet) da günceller — açılış/düzeltme anında maliyet
  // bazının doğru kurulması için.
  const maliyetGuncellenecek = [];
  kayitlar.forEach((k, idx) => {
    const stokAdi = String(k.stokAdi || k.urunAdi || "").trim();
    const miktar = parseFloat(k.miktar) || 0;
    if (!stokAdi || miktar <= 0) { atlanan++; return; }
    const hareketTipi = String(k.hareketTipi || "") === "Çıkış" ? "Çıkış" : "Giriş";
    const belgeTipi = String(k.belgeTipi || genelBelgeTipi || "");
    const maliyetFiyati = parseFloat(k.maliyetFiyati) || 0;
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
      belgeTipi,
      String(k.belgeNo || body.genelBelgeNo || ""),
      maliyetFiyati,
    ]);
    eklenen++;
    if (hareketTipi === "Giriş" && maliyetFiyati > 0 && k.stokTanimId && (belgeTipi === "Devir" || belgeTipi === "Stok Düzeltme")) {
      maliyetGuncellenecek.push({ id: String(k.stokTanimId), alisFiyati: maliyetFiyati });
    }
  });

  if (satirlar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, satirlar.length, STOK_HAREKET_BASLIKLAR.length).setValues(satirlar);
  }
  maliyetGuncellenecek.forEach(m => stokTanimMaliyetGuncelle(m.id, m.alisFiyati));
  cacheTemizle(["stokHareketListesi"]);
  return { ok: true, eklenen: eklenen, atlanan: atlanan };
}

// Devir/Stok Düzeltme girişinde satırda Maliyet Fiyatı belirtilmişse, saveStokTanim'i
// (tüm satırı body'den yeniden kuran, bu yüzden burada KULLANILMAMASI gereken) çağırmak
// yerine SADECE Alış Fiyatı (maliyet) hücresini günceller — diğer alanlar (kod, marka,
// birim vb.) olduğu gibi korunur.
function stokTanimMaliyetGuncelle(id, alisFiyati) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.stokTanimlari, STOK_TANIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      sheet.getRange(i + 1, 7).setValue(parseFloat(alisFiyati) || 0); // 7. sütun = ALIS_FIYATI
      cacheTemizle(["stokTanimListesi"]);
      return;
    }
  }
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
  // h.tarih artık saat de içerebiliyor (yyyy-MM-ddTHH:mm); aralık filtresi salt gün
  // bazlı olduğu için karşılaştırmadan önce sadece gün kısmını (ilk 10 karakter) alıyoruz.
  if (baslangic) sonuc = sonuc.filter(h => String(h.tarih || "").slice(0, 10) >= baslangic);
  if (bitis) sonuc = sonuc.filter(h => String(h.tarih || "").slice(0, 10) <= bitis);
  if (stokTanimId) sonuc = sonuc.filter(h => h.stokTanimId === stokTanimId);
  sonuc = sonuc.slice().sort((a, b) => a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0));

  let girisToplam = 0, cikisToplam = 0;
  sonuc.forEach(h => { if (h.hareketTipi === "Giriş") girisToplam += h.miktar; else cikisToplam += h.miktar; });

  return { ok: true, hareketler: sonuc, girisToplam: girisToplam, cikisToplam: cikisToplam };
}

// ════════════════════════════════════════════════
// SON YAPILAN İŞLEMLER (Ana Sayfa sağ paneli) — Satış, Alış, Tahsilat, Ödeme,
// Çek/Senet ve elle yapılan (Satış/Alış'tan otomatik gelmeyen) Stok Hareketlerinden
// en son kayıtları KAYIT_TARIHI'ne göre birleştirip döner. Her modülden biraz daha
// fazla satır çekilip birleştirildikten sonra son `limit` kadarı kesilir; bu yüzden
// tek bir modülde çok sayıda işlem olsa bile diğer modüllerin son işlemleri kaybolmaz.
// body: { limit (varsayılan 20) }
function getSonIslemler(body) {
  const limit = parseInt((body && body.limit) || 20) || 20;
  const parcaBasi = Math.max(limit, 20);
  return cacheOkuVeyaHesapla("sonIslemler_" + limit, 20, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const liste = [];

    function sonSatirlar(sheet, adet) {
      const sonSatir = sheet.getLastRow();
      if (sonSatir < 2) return [];
      const baslangic = Math.max(2, sonSatir - adet + 1);
      return sheet.getRange(baslangic, 1, sonSatir - baslangic + 1, sheet.getLastColumn()).getValues();
    }

    const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
    sonSatirlar(sSheet, parcaBasi).forEach(row => {
      if (!row[0]) return;
      const belgeTipi = String(row[8] || "") || "Fatura";
      liste.push({
        tip: "SATIS", ic: belgeTipi === "Sipariş" ? "📦" : (belgeTipi === "Teklif" ? "📝" : "📤"),
        baslik: "Satış " + belgeTipi, cariAd: String(row[3] || ""), tutar: parseFloat(row[4]) || 0,
        kayitTarihi: hucreTarihStr(row[7]), id: String(row[0]),
      });
    });

    const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
    sonSatirlar(aSheet, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "ALIS", ic: "📥", baslik: "Alış Faturası", cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[7]), id: String(row[0]),
      });
    });

    const tSheet = getOrCreateSheet(ss, SHEETS.tahsilatlar,
      ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID"]);
    sonSatirlar(tSheet, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "TAHSILAT", ic: "💰", baslik: "Tahsilat (" + String(row[5] || "") + ")", cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[7]), id: String(row[0]),
      });
    });

    const oSheet = getOrCreateSheet(ss, SHEETS.odemeler,
      ["ID","TARIH","CARI_ID","CARI_AD","TUTAR","YONTEM","ACIKLAMA","KAYIT_TARIHI","POS_HESAP_ID","BANKA_HESAP_ID"]);
    sonSatirlar(oSheet, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "ODEME", ic: "💳", baslik: "Ödeme (" + String(row[5] || "") + ")",
        cariAd: String(row[3] || "") || "—",
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[7]), id: String(row[0]),
      });
    });

    // Alış İadesi ve Satış İadesi — önceden burada hiç yer almıyorlardı (Alış İadesi hiç
    // gösterilmiyordu, Satış İadesi'nin ise henüz bir modülü bile yoktu).
    const aiSheet2 = getOrCreateSheet(ss, SHEETS.alisIadeler,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    sonSatirlar(aiSheet2, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "ALISIADE", ic: "↩️", baslik: "Alış İadesi", cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[6]), id: String(row[0]),
      });
    });

    const siSheet4 = getOrCreateSheet(ss, SHEETS.satisIadeler,
      ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ACIKLAMA","KAYIT_TARIHI"]);
    sonSatirlar(siSheet4, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "SATISIADE", ic: "↩️", baslik: "Satış İadesi", cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[6]), id: String(row[0]),
      });
    });

    const cSheet = getOrCreateSheet(ss, SHEETS.cekSenetler, CEK_SENET_BASLIKLAR);
    sonSatirlar(cSheet, parcaBasi).forEach(row => {
      if (!row[0]) return;
      liste.push({
        tip: "CEK", ic: "🧾", baslik: (String(row[1] || "") || "Çek/Senet") + " kaydı", cariAd: String(row[3] || ""),
        tutar: parseFloat(row[4]) || 0, kayitTarihi: hucreTarihStr(row[12]), id: String(row[0]),
      });
    });

    // Stok hareketlerinden sadece ELLE girilenler (Devir/Stok Düzeltme/Giriş/Çıkış/Toplu) —
    // Satış/Alış/Alış İadesi/Satış İadesi'nden otomatik yazılanlar zaten yukarıda o kalemler
    // üzerinden temsil ediliyor, burada tekrar göstermek mükerrer olur.
    const shSheet = getOrCreateSheet(ss, SHEETS.stokHareketleri, STOK_HAREKET_BASLIKLAR);
    const OTOMATIK_BELGE_TIPLERI = { "Satış Faturası": 1, "Alış Faturası": 1, "Alış İadesi": 1, "Satış İadesi": 1 };
    sonSatirlar(shSheet, parcaBasi * 2).forEach(row => {
      if (!row[0]) return;
      const belgeTipi = String(row[10] || "");
      if (OTOMATIK_BELGE_TIPLERI[belgeTipi]) return;
      const hareketTipi = String(row[6] || "");
      liste.push({
        tip: "STOK", ic: hareketTipi === "Giriş" ? "⬇️" : "⬆️", baslik: (belgeTipi || "Stok Hareketi"),
        cariAd: String(row[4] || ""), tutar: parseFloat(row[7]) || 0, birim: String(row[5] || ""),
        kayitTarihi: hucreTarihStr(row[9]), id: String(row[0]),
      });
    });

    liste.sort((a, b) => (a.kayitTarihi < b.kayitTarihi ? 1 : (a.kayitTarihi > b.kayitTarihi ? -1 : 0)));
    return { ok: true, islemler: liste.slice(0, limit) };
  });
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
  ambalaj: SHEETS.ambalajTanimlari,
  giderUstGrup: SHEETS.giderUstGruplari,
  giderAltGrup: SHEETS.giderAltGruplari,
  projeKodu: SHEETS.projeKodlari,
  faturaTipi: SHEETS.faturaTipleri,
  virmanTipi: SHEETS.virmanTipleri,
};
const BASIT_TANIM_CACHE_ANAHTARI = {
  urunGrubu: "urunGrubuListesi",
  altUrunGrubu: "altUrunGrubuListesi",
  ebat: "ebatListesi",
  renk: "renkListesi",
  ambalaj: "ambalajListesi",
  giderUstGrup: "giderUstGrupListesi",
  giderAltGrup: "giderAltGrupListesi",
  projeKodu: "projeKoduListesi",
  faturaTipi: "faturaTipiListesi",
  virmanTipi: "virmanTipiListesi",
};
const BASIT_TANIM_BASLIKLAR = ["ID", "AD", "UST_ID", "SIRA", "KOD"];
// Stok Kodu'nun otomatik üretimi için hangi basit tanım tiplerinin 2 haneli bir KOD'a
// sahip olması ZORUNLU — diğer tipler (Ebat, Renk, Ambalaj, Gider grupları) kod kullanmaz,
// bu alan onlarda her zaman boş kalır.
const TANIM_KOD_ZORUNLU = { urunGrubu: true, altUrunGrubu: true };

// Eski kayıtlarda KOD sütunu (5.) olmayabilir (özellik sonradan eklendi) — sheet'i
// gerektiğinde tamamlar, mevcut veriye dokunmaz.
function ensureBasitTanimKodKolonu(sheet) {
  if (sheet.getLastColumn() < 5) sheet.getRange(1, 5).setValue("KOD");
}

function getBasitTanimListesi(tip) {
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  return cacheOkuVeyaHesapla(BASIT_TANIM_CACHE_ANAHTARI[tip], 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
    ensureBasitTanimKodKolonu(sheet);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push({ id: String(data[i][0]), ad: metinOku_(data[i][1]), ustId: String(data[i][2] || ""), sira: parseFloat(data[i][3]) || 0, kod: metinOku_(data[i][4], 2) });
    }
    return { ok: true, kalemler: siraliDizile(sonuc) };
  });
}

// body: { tip, id (varsa güncelleme), ad, ustId (yalnızca altUrunGrubu için), kod (yalnızca
// urunGrubu/altUrunGrubu için ZORUNLU — 2 haneli, Stok Kodu'nun ilk/orta hanelerini oluşturur) }
function saveBasitTanim(body) {
  const tip = String(body.tip || "");
  const sheetAdi = BASIT_TANIM_SHEET_ADI[tip];
  if (!sheetAdi) return { ok: false, hata: "Geçersiz tanım tipi" };
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Ad gerekli" };
  const ustId = String(body.ustId || "");
  let kod = String(body.kod || "").trim().toUpperCase().slice(0, 2);
  if (TANIM_KOD_ZORUNLU[tip]) {
    if (kod.length !== 2) return { ok: false, hata: "Kod 2 karakter olmalı (Stok Kodu'nun otomatik üretimi için gerekli)" };
  } else {
    kod = ""; // bu tiplerde kod kullanılmaz
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, sheetAdi, BASIT_TANIM_BASLIKLAR);
  ensureBasitTanimKodKolonu(sheet);
  metinKolonuGarantiEt_(sheet, 2); // AD  — "00", "01" gibi adlar sayıya dönüşmesin
  metinKolonuGarantiEt_(sheet, 5); // KOD — "01" gibi 2 haneli kodlar sayıya dönüşmesin
  const data = sheet.getDataRange().getValues();
  let id = String(body.id || "").trim();
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        metinliSatirYaz_(sheet, i + 1, [id, ad, ustId, data[i][3], kod], [2, 5]);
        cacheTemizle([BASIT_TANIM_CACHE_ANAHTARI[tip]]);
        return { ok: true, id: id };
      }
    }
  }
  const maxSira = data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[3]) || 0), 0);
  id = tip.slice(0, 3) + "_" + Date.now();
  metinliSatirEkle_(sheet, [id, ad, ustId, maxSira + 1, kod], [2, 5]);
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
const MARKA_BASLIKLAR = ["ID", "KOD", "AD", "SIRA", "RENK"];

function getMarkaListesi() {
  return cacheOkuVeyaHesapla("markaListesi", 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
    ensureMarkaRenkKolonu(sheet);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push({ id: String(data[i][0]), kod: metinOku_(data[i][1], 2), ad: String(data[i][2] || ""), sira: parseFloat(data[i][3]) || 0, renk: String(data[i][4] || "") });
    }
    return { ok: true, markalar: siraliDizile(sonuc) };
  });
}

// Eski kayıtlarda RENK sütunu olmayabilir (özellik sonradan eklendi) — sheet'i
// gerektiğinde 5. sütun (RENK) ile tamamlar, mevcut veriye dokunmaz.
function ensureMarkaRenkKolonu(sheet) {
  if (sheet.getLastColumn() < 5) sheet.getRange(1, 5).setValue("RENK");
}

// body: { id (varsa güncelleme), kod, ad, renk (opsiyonel, #rrggbb) }
function saveMarka(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Marka adı gerekli" };
  const kod = String(body.kod || "").trim().toUpperCase().slice(0, 2);
  if (kod.length !== 2) return { ok: false, hata: "Marka kodu 2 karakter olmalı" };
  const renk = String(body.renk || "").trim();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.markalar, MARKA_BASLIKLAR);
  ensureMarkaRenkKolonu(sheet);
  metinKolonuGarantiEt_(sheet, 2); // KOD — "01" gibi 2 haneli kodlar sayıya dönüşmesin
  const data = sheet.getDataRange().getValues();
  let id = String(body.id || "").trim();
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        metinliSatirYaz_(sheet, i + 1, [id, kod, ad, data[i][3], renk], [2]);
        cacheTemizle(["markaListesi"]);
        return { ok: true, id: id };
      }
    }
  }
  const maxSira = data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[3]) || 0), 0);
  id = "mrk_" + Date.now();
  metinliSatirEkle_(sheet, [id, kod, ad, maxSira + 1, renk], [2]);
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
// PLASİYER TANIMLARI (Ayarlar > Plasiyer Tanımlama) — Cari tanımında bir
// carinin sorumlu plasiyeri buradaki listeden seçilir.
// ════════════════════════════════════════════════
const PLASIYER_BASLIKLAR = ["ID", "AD", "SIRA", "TELEFON"];

function getPlasiyerListesi() {
  return cacheOkuVeyaHesapla("plasiyerListesi", 300, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.plasiyerler, PLASIYER_BASLIKLAR);
    const data = sheet.getDataRange().getValues();
    const sonuc = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      sonuc.push({ id: String(data[i][0]), ad: String(data[i][1] || ""), sira: parseFloat(data[i][2]) || 0, telefon: String(data[i][3] || "") });
    }
    return { ok: true, plasiyerler: siraliDizile(sonuc) };
  });
}

// body: { id (varsa güncelleme), ad, telefon (opsiyonel) }
function savePlasiyer(body) {
  const ad = String(body.ad || "").trim();
  if (!ad) return { ok: false, hata: "Plasiyer adı gerekli" };
  const telefon = String(body.telefon || "").trim();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.plasiyerler, PLASIYER_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let id = String(body.id || "").trim();
  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([[id, ad, data[i][2], telefon]]);
        cacheTemizle(["plasiyerListesi"]);
        return { ok: true, id: id };
      }
    }
  }
  const maxSira = data.slice(1).reduce((m, r) => Math.max(m, parseFloat(r[2]) || 0), 0);
  id = "pls_" + Date.now();
  sheet.appendRow([id, ad, maxSira + 1, telefon]);
  cacheTemizle(["plasiyerListesi"]);
  return { ok: true, id: id };
}

function silPlasiyer(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.plasiyerler, PLASIYER_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); cacheTemizle(["plasiyerListesi"]); return { ok: true }; }
  }
  return { ok: false, hata: "Plasiyer bulunamadı" };
}

// body: { sirali: [id1, id2, ...] }
function plasiyerSiraGuncelle(body) {
  const sirali = Array.isArray(body.sirali) ? body.sirali : [];
  if (sirali.length === 0) return { ok: false, hata: "sirali gerekli" };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.plasiyerler, PLASIYER_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  sirali.forEach((id, idx) => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { sheet.getRange(i + 1, 3).setValue(idx + 1); break; }
    }
  });
  cacheTemizle(["plasiyerListesi"]);
  return { ok: true };
}

// ════════════════════════════════════════════════
// EDM E-FATURA WEB SERVİSİ (SOAP) — VKN/TCKN'ye göre GİB e-Fatura mükellefi
// sorgusu. Akış: LOGIN (USER_NAME+PASSWORD → SESSION_ID, 20 dk cache'lenir)
// → CHECK USER (IDENTIFIER=VKN/TCKN). GİB e-Fatura listesinde bulunursa
// eFatura="Evet"/eArsiv="Hayır", bulunamazsa tam tersi (e-Arşiv varsayımı).
// SADECE SORGU YAPAR — Sheets'e hiçbir yazma işlemi yoktur, bu yüzden veri
// kaybı riski taşımaz.
//
// GÜVENLİK: Kullanıcı adı/şifre koda YAZILMAZ. Apps Script projesinde
// Proje Ayarları (⚙️) > Script Özellikleri (Script Properties) kısmından
// elle girilmesi gerekir:
//   EDM_URL       → Test: https://test.edmbilisim.com.tr/EFaturaEDM21ea/EFaturaEDM.svc
//                   Canlı: https://portal2.edmbilisim.com.tr/EFaturaEDM/EFaturaEDM.svc
//   EDM_USER      → EDM'den gelen web servis kullanıcı adı
//   EDM_PASSWORD  → EDM'den gelen web servis şifresi
// (Akınsoft'ta kullanılan kullanıcıyla AYNISI kullanılmamalı — EDM'in
// önerisi budur, aksi halde biri girince diğerinden oturum düşer.)
// ════════════════════════════════════════════════

function edmAyarlariniAl_() {
  const p = PropertiesService.getScriptProperties();
  return {
    url: (p.getProperty("EDM_URL") || "").trim(),
    user: (p.getProperty("EDM_USER") || "").trim(),
    password: (p.getProperty("EDM_PASSWORD") || "").trim(),
  };
}

// EDM'e gönderilen bir faturanın yanına "EDM Portalında Aç" linki koyabilmek için: SOAP
// servis adresiyle (EDM_URL) AYNI sunucudaki web arayüzünün (EFaturaUI) giriş sayfasını
// döndürür (ör. canlıda https://portal2.edmbilisim.com.tr/EFaturaUI/Login.aspx). EDM'in
// web arayüzü oturum/giriş gerektirdiği için doğrudan İLGİLİ FATURAYA (login atlanarak)
// gidilemiyor — kullanıcı giriş yaptıktan sonra E-Fatura No/UUID ile arayabilsin diye
// bu bilgiler de linkle birlikte ayrıca gösteriliyor (bkz. frontend satisEfaturaPortalLinki).
function getEdmPortalGirisLinki() {
  const ayar = edmAyarlariniAl_();
  if (!ayar.url) return { ok: false, hata: "EDM_URL tanımlı değil." };
  const m = ayar.url.match(/^(https?:\/\/[^\/]+)/i);
  if (!m) return { ok: false, hata: "EDM_URL adresinden sunucu adı çözülemedi." };
  return { ok: true, url: m[1] + "/EFaturaUI/Login.aspx" };
}

function edmRequestHeaderBlock_(sessionId, kanal) {
  return '<REQUEST_HEADER xmlns="">' +
    '<SESSION_ID>' + sessionId + '</SESSION_ID>' +
    '<CLIENT_TXN_ID>' + Utilities.getUuid() + '</CLIENT_TXN_ID>' +
    '<ACTION_DATE>' + Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd'T'HH:mm:ss.SSS") + '</ACTION_DATE>' +
    '<REASON>Fincanlar ERP cari e-Fatura sorgulama</REASON>' +
    '<APPLICATION_NAME>Fincanlar ERP</APPLICATION_NAME>' +
    '<HOSTNAME>AppsScript</HOSTNAME>' +
    '<CHANNEL_NAME>' + kanal + '</CHANNEL_NAME>' +
    '<COMPRESSED>N</COMPRESSED>' +
    '</REQUEST_HEADER>';
}

function edmSoapCagir_(url, soapAction, bodyXml) {
  const envelope = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    bodyXml +
    '</s:Body></s:Envelope>';
  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "text/xml; charset=utf-8",
    headers: { SoapAction: soapAction },
    payload: envelope,
    muteHttpExceptions: true,
  });
  return resp.getContentText();
}

function edmXmlDegeri_(xml, etiket) {
  const m = xml.match(new RegExp("<" + etiket + "[^>]*>([\\s\\S]*?)</" + etiket + ">"));
  return m ? m[1].trim() : "";
}

// EDM yanıtlarında ID/UUID gibi bazı kritik alanlar alt etiket olarak değil,
// <INVOICE TRXID="0" UUID="..." ID="..." ...> gibi bir XML ÖZELLİĞİ (attribute)
// olarak dönüyor — edmXmlDegeri_ bunları YAKALAYAMAZ (o sadece <ETIKET>metin</ETIKET>
// arar). Bu yüzden ayrı bir attribute okuyucu gerekiyor.
function edmXmlOznitelik_(xml, etiket, oznitelik) {
  const m = xml.match(new RegExp("<" + etiket + "\\b[^>]*\\b" + oznitelik + "=\"([^\"]*)\""));
  return m ? m[1] : "";
}

// EDM/GİB'in GetInvoiceStatus'ta döndürdüğü STATUS / STATUS_DESCRIPTION / RESPONSE_DESCRIPTION
// alanları İngilizce kısa kodlar olarak geliyor (ör. "PACKAGE-PROCESSING", "PROCESSING", "SEND").
// Bu sözlük bunları Türkçe karşılığa çevirir. YENİ BİR KOD GÖRÜLÜRSE: sadece bu objeye
// "KOD": "Türkçe karşılığı" satırı eklemek yeterli — anahtar boşluk/tire farkı gözetmeden
// eşleşir (edmDurumTurkce_ normalize eder). Şu ana kadar canlıda fiilen görülenler: SEND,
// PROCESSING, SUCCEED. PACKAGE-PROCESSING kullanıcı tarafından beklenen bir diğer örnek. Geri
// kalanlar yaygın e-Fatura/GİB terimleri için önden eklenmiş makul karşılıklardır; EDM'den hiç
// gelmeseler de zararsızdır, gelirlerse otomatik çevrilmiş olur.
const EDM_DURUM_KODLARI = {
  "SEND": "Gönderildi",
  "SENT": "Gönderildi",
  "PROCESSING": "İşleniyor",
  "PACKAGE-PROCESSING": "Paket İşleniyor",
  "PACKAGEPROCESSING": "Paket İşleniyor",
  "SUCCESS": "Başarılı",
  "SUCCEED": "Başarılı",
  "SUCCEEDED": "Başarılı",
  "SUCCESSFUL": "Başarılı",
  "SUCCESFUL": "Başarılı",
  "COMPLETED": "Tamamlandı",
  "ACCEPT": "Kabul Edildi",
  "ACCEPTED": "Kabul Edildi",
  "REJECT": "Reddedildi",
  "REJECTED": "Reddedildi",
  "NACK": "Reddedildi",
  "ERROR": "Hata",
  "FAIL": "Başarısız",
  "FAILED": "Başarısız",
  "CANCEL": "İptal Edildi",
  "CANCELLED": "İptal Edildi",
  "CANCELED": "İptal Edildi",
};

// Ham bir EDM/GİB durum kodunu ("PACKAGE - PROCESSING" gibi boşluklu varyantlar dahil)
// EDM_DURUM_KODLARI'nde arar; bulursa "Türkçe (HAM_KOD)" biçiminde, bulamazsa ham kodu
// OLDUĞU GİBİ döner — bilinmeyen bir kod asla hata vermez veya gizlenmez, sadece
// çevrilmeden görünür (bu da yeni kodun ne zaman sözlüğe eklenmesi gerektiğini gösterir).
function edmDurumTurkce_(kod) {
  const ham = String(kod || "").trim();
  if (!ham) return ham;
  const anahtar = ham.toUpperCase().replace(/\s+/g, "");
  const ceviri = EDM_DURUM_KODLARI[anahtar];
  return ceviri ? (ceviri + " (" + ham + ")") : ham;
}

// SADECE ÖNİZLEME — hiçbir veriyi değiştirmez, sadece LİSTELER. 3 Eylül 2026'daki (commit
// 43a46fb) KDV düzeltmesinden ÖNCE girilmiş Alış kalemlerinde KDV_ORANI kolonu hiç yoktu;
// bu yüzden o dönemde yazılmış satırların 9. hücresi (KDV_ORANI) TAMAMEN BOŞ ("") kalır.
// Düzeltmeden SONRA girilen bir kalemde KDV %0 bile olsa hücreye açıkça 0 yazılıyor — bu
// sayede "gerçekten eski/hiç kaydedilmemiş" satırlarla "post-fix gerçek %0 KDV'li" satırlar
// güvenle ayırt edilebiliyor (ikisi de parseFloat(...)||0 ile aynı görünür, o yüzden burada
// ham hücre değerine bakılıyor). O dönemde TUTAR = Miktar × Birim Fiyat, yani KDV HARİÇ
// kaydedilmişti; bu da hem Alislar.TOPLAM_TUTAR'a hem ilgili Cari hareketine KDV'siz
// yansımış demek. Kullanıcı her fatura için doğru KDV oranını kendisi görüp gireceği için
// burada HİÇBİR ORAN VARSAYILMIYOR — sadece etkilenen faturalar/kalemler ham haliyle
// dönüyor. Gerçek düzeltmeyi (Cari bakiyeye dokunup dokunmama dahil) uygulayacak AYRI bir
// fonksiyon henüz eklenmedi; kullanıcı bu önizlemeyi gördükten sonra karar verecek.
function getAlisKdvGecmisListesi() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aSheet = getOrCreateSheet(ss, SHEETS.alislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI"]);
  const kSheet = getOrCreateSheet(ss, SHEETS.alisKalemleri,
    ["ID","ALIS_ID","URUN_ADI","MIKTAR","BIRIM","BIRIM_FIYAT","TUTAR","STOK_KODU"]);
  ensureAlisKalemKdvColonu(kSheet);

  const kData = kSheet.getDataRange().getValues();
  const kalemlerByAlisId = {};
  for (let i = 1; i < kData.length; i++) {
    const row = kData[i];
    if (!row[0]) continue;
    const kdvHucresi = row[8]; // ham hücre — "" ise kolon o satır için hiç yazılmamış (eski kayıt)
    if (kdvHucresi !== "") continue; // KDV_ORANI kayıtlı (post-fix) — bu kalem etkilenmiyor
    const alisId = String(row[1] || "");
    if (!alisId) continue;
    if (!kalemlerByAlisId[alisId]) kalemlerByAlisId[alisId] = [];
    kalemlerByAlisId[alisId].push({
      id: String(row[0]), urunAdi: String(row[2] || ""), miktar: parseFloat(row[3]) || 0,
      birim: String(row[4] || ""), birimFiyat: parseFloat(row[5]) || 0, tutar: parseFloat(row[6]) || 0,
      stokKodu: String(row[7] || ""),
    });
  }

  const etkilenenAlisIdleri = Object.keys(kalemlerByAlisId);
  if (etkilenenAlisIdleri.length === 0) {
    return { ok: true, faturalar: [], faturaSayisi: 0, kalemSayisi: 0 };
  }

  const aData = aSheet.getDataRange().getValues();
  const faturalar = [];
  let kalemSayisi = 0;
  for (let i = 1; i < aData.length; i++) {
    const row = aData[i];
    const id = String(row[0] || "");
    if (!id || !kalemlerByAlisId[id]) continue;
    const kalemler = kalemlerByAlisId[id];
    kalemSayisi += kalemler.length;
    const mevcutKalemToplami = kalemler.reduce(function (t, k) { return t + k.tutar; }, 0);
    faturalar.push({
      alisId: id, tarih: hucreTarihStr(row[1]), cariAd: String(row[3] || ""),
      mevcutKayitliToplam: parseFloat(row[4]) || 0, // Alislar.TOPLAM_TUTAR (normalde kalem toplamıyla aynı)
      mevcutKalemToplami: mevcutKalemToplami,
      kalemler: kalemler,
    });
  }
  faturalar.sort(function (a, b) { return a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : 0); });

  return { ok: true, faturalar: faturalar, faturaSayisi: faturalar.length, kalemSayisi: kalemSayisi };
}

// SESSION_ID'yi 20 dk cache'ler; her sorguda yeniden login atmayı önler.
function edmLogin_(ayar) {
  const kanal = ayar.url.indexOf("test") > -1 ? "TEST" : "PROD";
  const cache = CacheService.getScriptCache();
  const cacheKey = "edm_session_" + kanal;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const body = '<LoginRequest xmlns="http://tempuri.org/">' +
    edmRequestHeaderBlock_("0", kanal) +
    '<USER_NAME xmlns="">' + ayar.user + '</USER_NAME>' +
    '<PASSWORD xmlns="">' + ayar.password + '</PASSWORD>' +
    '</LoginRequest>';
  const xml = edmSoapCagir_(ayar.url, "LoginRequest", body);
  if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
    throw new Error("EDM Login reddetti (kullanıcı adı/şifre veya URL hatalı olabilir): " + edmXmlDegeri_(xml, "faultstring"));
  }
  const sessionId = edmXmlDegeri_(xml, "SESSION_ID");
  if (!sessionId) throw new Error("EDM Login yanıtı beklenmedik: " + xml.substring(0, 300));
  cache.put(cacheKey, sessionId, 1200); // 20 dk
  return sessionId;
}

function edmCheckUserXml_(ayar, sessionId, identifier) {
  const kanal = ayar.url.indexOf("test") > -1 ? "TEST" : "PROD";
  const body = '<CheckUserRequest xmlns="http://tempuri.org/">' +
    edmRequestHeaderBlock_(sessionId, kanal) +
    '<USER xmlns=""><IDENTIFIER>' + identifier + '</IDENTIFIER></USER>' +
    '</CheckUserRequest>';
  return edmSoapCagir_(ayar.url, "CheckUserRequest", body);
}

// body: { vergiNo }
function edmCariSorgula(body) {
  const vergiNoHam = String(body.vergiNo || "").trim();
  const vergiNo = vergiNoHam.replace(/[^0-9]/g, "");
  if (!vergiNo) return { ok: false, hata: "Vergi/Kimlik No gerekli" };
  if (vergiNo.length !== 10 && vergiNo.length !== 11) {
    return { ok: false, hata: "Vergi/Kimlik No 10 (VKN) veya 11 (TCKN) haneli olmalı." };
  }
  const ayar = edmAyarlariniAl_();
  if (!ayar.url || !ayar.user || !ayar.password) {
    return {
      ok: false,
      hata: "EDM bağlantı bilgileri tanımlı değil. Apps Script projesinde Proje Ayarları > Script Özellikleri kısmına EDM_URL, EDM_USER, EDM_PASSWORD eklenmesi gerekiyor."
    };
  }
  try {
    let sessionId = edmLogin_(ayar);
    let xml = edmCheckUserXml_(ayar, sessionId, vergiNo);
    // Oturum süresi dolmuş olabilir (fault) — cache'i temizleyip bir kez daha dene.
    if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
      const kanal = ayar.url.indexOf("test") > -1 ? "TEST" : "PROD";
      CacheService.getScriptCache().remove("edm_session_" + kanal);
      sessionId = edmLogin_(ayar);
      xml = edmCheckUserXml_(ayar, sessionId, vergiNo);
    }
    if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
      return { ok: false, hata: "EDM sorgu hatası: " + edmXmlDegeri_(xml, "faultstring") };
    }
    const alias = edmXmlDegeri_(xml, "ALIAS");
    if (alias) {
      return { ok: true, eFatura: "Evet", eArsiv: "Hayır", unvan: edmXmlDegeri_(xml, "TITLE") };
    }
    return { ok: true, eFatura: "Hayır", eArsiv: "Evet" };
  } catch (err) {
    return { ok: false, hata: "EDM sorgu hatası: " + err.message };
  }
}

// ════════════════════════════════════════════════
// EDM E-FATURA GÖNDERİMİ (SendInvoice) — DENEME/TEST amaçlı.
// Var olan bir Satış faturasının kalemlerinden GİB standardında (UBL-TR 1.2)
// bir e-Fatura XML'i oluşturup EDM'e gönderir.
//
// GÜVENLİK: Bu fonksiyon SADECE EDM_URL "test" içerdiğinde çalışır (canlı
// ortamda otomatik reddeder) — gerçek bir faturanın yanlışlıkla gerçek bir
// alıcıya değil, EDM'in test mükellefine (aşağıdaki EDM_TEST_ALICI_VKN)
// gönderilmesini garanti eder. Canlıya geçişte gerçek alıcıya gönderim için
// AYRI, bilinçli bir fonksiyon/onay akışı yazılmalı — bu fonksiyon o işe
// KULLANILMAMALI.
// ════════════════════════════════════════════════
const EDM_SELLER = {
  vkn: "3880688051",
  unvan: "Fincanlar Yapı Malz.Ltd.Şti.",
  adres: "Ovaakça Merkez Mah. Yeni Yalova Yolu Cad. No:591/1",
  ilce: "Osmangazi",
  il: "Bursa",
  vergiDairesi: "Osmangazi Vergi Dairesi",
};
const EDM_TEST_ALICI_VKN = "3230512384"; // EDM'in kendi test mükellefi — SADECE deneme gönderimleri için

function edmXmlEscape_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Serbest metin birim adlarını UN/CEFACT birim koduna çevirir (UBL-TR zorunlu alan).
function edmBirimKodu_(birim) {
  const b = String(birim || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase("tr");
  if (b.indexOf("m2") > -1 || b.indexOf("m²") > -1 || b.indexOf("metrekare") > -1) return "MTK";
  if (b.indexOf("kg") > -1) return "KGM";
  if (b === "metre" || b === "mt" || b === "m") return "MTR";
  if (b.indexOf("koli") > -1) return "XBX";
  if (b.indexOf("paket") > -1) return "XPK";
  return "C62"; // adet (varsayılan)
}

// VKN/TCKN'nin GİB e-Fatura mükellefi kaydını (varsa) döndürür: {alias, title} veya null.
// NOT: Bu sadece BAŞKALARININ (alıcının) mükellefiyetini kontrol etmek içindir.
// Kendi hesabımızın alias'ı için CheckUser DEĞİL, GetUserList kullanılmalı — çünkü
// test hesabının GİB'e kayıtlı VKN'si, firmanın gerçek VKN'sinden FARKLI olabilir.
function edmVknBilgiAl_(ayar, sessionId, vkn) {
  const xml = edmCheckUserXml_(ayar, sessionId, vkn);
  if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
    throw new Error("CheckUser hatası (" + vkn + "): " + edmXmlDegeri_(xml, "faultstring"));
  }
  const alias = edmXmlDegeri_(xml, "ALIAS");
  if (!alias) return null;
  return { alias: alias, title: edmXmlDegeri_(xml, "TITLE") };
}

// Giriş yapılan HESABIN kendi kayıtlı alias'larını döndürür (GetUserList).
// GB (Gönderici Birim) varsa onu, yoksa PK (Posta Kutusu) varsa onu, yoksa
// ilk kaydı döner: { identifier, alias, title, unit } veya null.
//
// ÖNEMLİ: EDM, GetUserList'i HESAP BAŞINA 240 DAKİKADA (4 saatte) BİR kez
// çağırmaya izin veriyor — daha sık çağrılırsa Fault döner. Bu yüzden sonuç
// ALINDIĞI ANDA Script Properties'e (EDM_OWN_IDENTIFIER/ALIAS/TITLE/UNIT)
// KALICI olarak yazılır ve bir sonraki çağrılarda API'ye hiç gidilmez —
// sadece bu üç özellik silinirse tekrar API'den çekilir. Kota anda dolu
// çıkarsa, bu üç özellik test portalından (test.edmbilisim.com.tr/EFaturaUI21ea)
// bakılıp Script Properties'e ELLE de girilebilir, GetUserList beklemeye
// gerek kalmadan.
function edmKendiBilgimiAl_(ayar, sessionId) {
  const p = PropertiesService.getScriptProperties();
  const cachedId = p.getProperty("EDM_OWN_IDENTIFIER");
  if (cachedId) {
    return {
      identifier: cachedId,
      alias: p.getProperty("EDM_OWN_ALIAS") || "",
      title: p.getProperty("EDM_OWN_TITLE") || "",
      unit: p.getProperty("EDM_OWN_UNIT") || "",
    };
  }
  const kanal = ayar.url.indexOf("test") > -1 ? "TEST" : "PROD";
  const body = '<GetUserListRequest xmlns="http://tempuri.org/">' +
    edmRequestHeaderBlock_(sessionId, kanal) +
    '</GetUserListRequest>';
  const xml = edmSoapCagir_(ayar.url, "GetUserListRequest", body);
  if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
    throw new Error("GetUserList hatası: " + edmXmlDegeri_(xml, "faultstring") +
      " — EDM bu servisi 240 dakikada bir kez çağırmaya izin veriyor. Beklemek yerine, " +
      "test portalından (test.edmbilisim.com.tr/EFaturaUI21ea) kendi VKN/alias bilginizi " +
      "bulup Script Özellikleri'ne EDM_OWN_IDENTIFIER / EDM_OWN_ALIAS / EDM_OWN_TITLE olarak " +
      "elle girebilirsiniz.");
  }
  const re = /<IDENTIFIER>([^<]*)<\/IDENTIFIER>\s*<ALIAS>([^<]*)<\/ALIAS>\s*<TITLE>([^<]*)<\/TITLE>\s*<TYPE>([^<]*)<\/TYPE>\s*<REGISTER_TIME>([^<]*)<\/REGISTER_TIME>\s*<UNIT>([^<]*)<\/UNIT>/g;
  const kayitlar = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    kayitlar.push({ identifier: m[1], alias: m[2], title: m[3], unit: m[6] });
  }
  if (kayitlar.length === 0) return null;
  const secilen = kayitlar.find(function(k){ return k.unit === "GB"; })
      || kayitlar.find(function(k){ return k.unit === "PK"; })
      || kayitlar[0];
  p.setProperties({
    EDM_OWN_IDENTIFIER: secilen.identifier,
    EDM_OWN_ALIAS: secilen.alias,
    EDM_OWN_TITLE: secilen.title,
    EDM_OWN_UNIT: secilen.unit,
  });
  return secilen;
}

// GİB formatında GERÇEK/KALICI SIRALI bir e-Fatura numarası üretir: 3 harf (seri) +
// 4 haneli yıl + 9 haneli sıra no. GİB kuralı: sıra numarasında ASLA boşluk/atlama
// olmamalı — bu yüzden LockService ile eşzamanlılık korumalı, Script Properties'te
// (EDM_FATURA_SERI, EDM_FATURA_SAYAC_<yıl>) KALICI olarak tutuluyor. Her çağrıda +1
// artar, asla geriye sarılmaz/tekrar kullanılmaz.
function edmFaturaNoUret_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = PropertiesService.getScriptProperties();
    const seri = p.getProperty("EDM_FATURA_SERI") || "FYT";
    const yil = new Date().getFullYear();
    const anahtar = "EDM_FATURA_SAYAC_" + yil;
    const oncekiSayac = parseInt(p.getProperty(anahtar) || "0", 10);
    const yeniSayac = oncekiSayac + 1;
    p.setProperty(anahtar, String(yeniSayac));
    const siraNo = String(yeniSayac).padStart(9, "0");
    return seri + yil + siraNo;
  } finally {
    lock.releaseLock();
  }
}

// Başarılı EDM gönderiminden sonra üretilen resmi e-Fatura numarasını ve GİB
// UUID'sini Satış kaydına geri yazar (ERP ile GİB kaydı arasında numara
// tutarlılığı için, ve UUID sonraki durum sorgulamalarında anahtar olarak kullanılır).
function satisEfaturaNoKaydet_(satisId, efaturaNo, uuid, ublXml, gorselVeriJson) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(satisId)) {
      sSheet.getRange(i + 1, 17).setValue(efaturaNo);
      if (uuid) sSheet.getRange(i + 1, 18).setValue(uuid);
      if (ublXml) sSheet.getRange(i + 1, 20).setValue(ublXml);
      if (gorselVeriJson) sSheet.getRange(i + 1, 21).setValue(gorselVeriJson);
      return true;
    }
  }
  return false;
}

// Bir Satış kaydının daha önce EDM'e gönderilmiş olup olmadığını, gönderilmişse
// hangi EFATURA_NO / EFATURA_UUID / EFATURA_DURUM ile kaydedildiğini döndürür.
function satisEfaturaBilgisiAl_(satisId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  ensureSatisBelgeTipiColonu(sSheet);
  const data = sSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(satisId)) {
      return {
        rowIndex: i + 1,
        efaturaNo: String(data[i][16] || ""),
        uuid: String(data[i][17] || ""),
        durum: String(data[i][18] || ""),
        ublXml: String(data[i][19] || ""),
        gorselVeriJson: String(data[i][20] || ""),
      };
    }
  }
  return null;
}

// EDM'e gönderilen bir e-Faturanın "resmi" görünümünü üretir. XML'i tekrar
// ayrıştırmak yerine, gönderim anında saklanan JSON anlık görüntüsünden
// (EFATURA_GORSEL_VERI) çiziyor — gönderilenle TAM AYNI veriyi garanti eder.
// Ham UBL-XML'i de (indirmek/incelemek isteyenler için) ayrıca döndürür.
function satisEfaturaGorselAl(body) {
  const satisId = body.satisId;
  if (!satisId) return { ok: false, hata: "satisId gerekli" };
  const bilgi = satisEfaturaBilgisiAl_(satisId);
  if (!bilgi || !bilgi.efaturaNo) return { ok: false, hata: "Bu fatura henüz EDM'e gönderilmemiş." };
  if (!bilgi.gorselVeriJson) {
    return { ok: false, hata: "Bu fatura için resmi görsel verisi kaydedilmemiş (muhtemelen bu özellik eklenmeden önce gönderilmiş). Yeni bir gönderimde görsel otomatik kaydedilecek." };
  }
  let veri;
  try { veri = JSON.parse(bilgi.gorselVeriJson); }
  catch (e) { return { ok: false, hata: "Görsel verisi okunamadı: " + e.message }; }
  return { ok: true, html: edmResmiFaturaHTMLOlustur_(veri), xml: bilgi.ublXml || "" };
}

// EDM'e gönderilen UBL-TR TEMELFATURA'nın alanlarından, o belgenin resmi
// e-Fatura görünümüne benzer bir HTML üretir. Not: Apps Script'te (V8 çalışma
// zamanı) yerleşik bir XSLT işleyici bulunmuyor; bu yüzden GİB'in TEMELFATURA
// XSLT şablonu birebir/byte-byte çalıştırılamıyor — bunun yerine AYNI alanlardan
// (satıcı/alıcı VKN-ünvan, kalemler, KDV, toplamlar, ETTN/UUID) standart e-Fatura
// görsel düzenine (üst bilgi bandı, satıcı/alıcı kutuları, kalem tablosu, toplamlar)
// sahip bir HTML üretiliyor. Ham UBL-XML de ayrıca (satisEfaturaGorselAl ile)
// döndürülüyor ki isteyen ham veriyi de görebilsin.
function edmResmiFaturaHTMLOlustur_(v) {
  const s = EDM_SELLER;
  const kalemSatirlari = (v.kalemler || []).map(function(k, idx) {
    return '<tr>' +
      '<td style="text-align:center">' + (idx + 1) + '</td>' +
      '<td>' + edmXmlEscape_(k.urunAdi) + '</td>' +
      '<td style="text-align:right">' + Number(k.miktar).toLocaleString('tr-TR') + '</td>' +
      '<td>' + edmXmlEscape_(k.birim || '') + '</td>' +
      '<td style="text-align:right">' + Number(k.birimFiyat).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}) + '</td>' +
      '<td style="text-align:right">%' + (k.kdvOrani || 0) + '</td>' +
      '<td style="text-align:right">' + Number(k.kdvTutari).toLocaleString('tr-TR', {minimumFractionDigits:2}) + '</td>' +
      '<td style="text-align:right">' + Number(k.tutar).toLocaleString('tr-TR', {minimumFractionDigits:2}) + '</td>' +
      '</tr>';
  }).join('');
  const para = function(n){ return Number(n||0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' TL'; };
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:1000px;margin:0 auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a3b6d;padding-bottom:10px;margin-bottom:14px">' +
    '<div><div style="font-size:20px;font-weight:800;color:#1a3b6d;letter-spacing:1px">e-FATURA</div>' +
    '<div style="font-size:11px;color:#555;margin-top:2px">TEMELFATURA senaryosu · UBL-TR 1.2</div></div>' +
    '<table style="font-size:11.5px;border-collapse:collapse">' +
    '<tr><td style="color:#555;padding:1px 8px 1px 0">Fatura No</td><td><b>' + edmXmlEscape_(v.faturaNo||'—') + '</b></td></tr>' +
    '<tr><td style="color:#555;padding:1px 8px 1px 0">ETTN (UUID)</td><td style="font-family:monospace">' + edmXmlEscape_(v.uuid||'—') + '</td></tr>' +
    '<tr><td style="color:#555;padding:1px 8px 1px 0">Düzenleme Tarihi</td><td>' + edmXmlEscape_(v.tarih||'—') + '</td></tr>' +
    '<tr><td style="color:#555;padding:1px 8px 1px 0">Düzenleme Saati</td><td>' + edmXmlEscape_(v.saat||'—') + '</td></tr>' +
    '</table></div>' +
    '<div style="display:flex;gap:16px;margin-bottom:14px">' +
    '<div style="flex:1;border:1px solid #ccc;border-radius:6px;padding:10px 12px">' +
    '<div style="font-size:10px;font-weight:700;color:#1a3b6d;text-transform:uppercase;margin-bottom:6px">Satıcı</div>' +
    '<div style="font-size:12.5px;font-weight:700">' + edmXmlEscape_(s.unvan) + '</div>' +
    '<div style="font-size:11.5px;color:#333;margin-top:2px">VKN: ' + edmXmlEscape_(v.saticiVkn||s.vkn) + '</div>' +
    '<div style="font-size:11.5px;color:#333">' + edmXmlEscape_(s.adres) + ', ' + edmXmlEscape_(s.ilce) + '/' + edmXmlEscape_(s.il) + '</div>' +
    '<div style="font-size:11.5px;color:#333">Vergi Dairesi: ' + edmXmlEscape_(s.vergiDairesi) + '</div></div>' +
    '<div style="flex:1;border:1px solid #ccc;border-radius:6px;padding:10px 12px">' +
    '<div style="font-size:10px;font-weight:700;color:#1a3b6d;text-transform:uppercase;margin-bottom:6px">Alıcı</div>' +
    '<div style="font-size:12.5px;font-weight:700">' + edmXmlEscape_(v.aliciUnvan||'—') + '</div>' +
    '<div style="font-size:11.5px;color:#333;margin-top:2px">VKN/TCKN: ' + edmXmlEscape_(v.aliciVkn||'—') + '</div>' +
    '</div></div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px" border="1" cellpadding="6">' +
    '<thead><tr style="background:#eef1f7">' +
    '<th>S.No</th><th>Mal/Hizmet</th><th>Miktar</th><th>Birim</th><th>Birim Fiyat</th><th>KDV Oranı</th><th>KDV Tutarı</th><th>Mal/Hizmet Tutarı</th>' +
    '</tr></thead><tbody>' + kalemSatirlari + '</tbody></table>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
    '<table style="border-collapse:collapse;font-size:12.5px;min-width:280px">' +
    '<tr><td style="color:#555;padding:2px 10px 2px 0">Mal Hizmet Toplam Tutarı</td><td style="text-align:right">' + para(v.araToplam) + '</td></tr>' +
    '<tr><td style="color:#555;padding:2px 10px 2px 0">Hesaplanan KDV</td><td style="text-align:right">' + para(v.kdvToplam) + '</td></tr>' +
    '<tr style="font-weight:800;font-size:14px;border-top:1px solid #ccc"><td style="padding:6px 10px 0 0">Vergiler Dahil Toplam Tutar</td><td style="text-align:right;padding-top:6px">' + para(v.genelToplam) + '</td></tr>' +
    '</table></div>' +
    '<div style="margin-top:18px;font-size:10.5px;color:#777;border-top:1px solid #eee;padding-top:8px">' +
    'Bu görünüm, EDM\'e gönderilen UBL-TR 1.2 TEMELFATURA belgesindeki alanlardan üretilmiştir. ' +
    'GİB portalındaki resmi görüntüleyicinin birebir aynısı değildir; belgenin hukuki geçerliliği ETTN (' + edmXmlEscape_(v.uuid||'—') + ') ile GİB nezdinde sorgulanabilir.' +
    '</div></div>';
}

// Sorgulanan portal durumunu (GetInvoiceStatus'tan gelen özet metni) Satış
// kaydına önbelleğe alır — her açılışta tekrar sorgu atmamak için.
function satisEfaturaDurumKaydet_(rowIndex, durumMetni) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sSheet = getOrCreateSheet(ss, SHEETS.satislar,
    ["ID","TARIH","CARI_ID","CARI_AD","TOPLAM_TUTAR","ODEME_TIPI","ACIKLAMA","KAYIT_TARIHI","BELGE_TIPI"]);
  sSheet.getRange(rowIndex, 19).setValue(durumMetni);
}

// body: { satisId }  — EDM'e daha önce gönderilmiş bir faturanın GİB/portal
// durumunu GetInvoiceStatus ile sorgular (zarf durumu, GİB durum kodu, ticari
// kabul/red yanıtı). Sonucu Satış kaydına özet olarak önbelleğe alır.
function edmFaturaDurumSorgula(body) {
  const ayar = edmAyarlariniAl_();
  if (!ayar.url || !ayar.user || !ayar.password) {
    return { ok: false, hata: "EDM bağlantı bilgileri tanımlı değil (Script Özellikleri)." };
  }
  const satisId = body.satisId;
  if (!satisId) return { ok: false, hata: "satisId gerekli" };
  const kayit = satisEfaturaBilgisiAl_(satisId);
  if (!kayit) return { ok: false, hata: "Satış bulunamadı." };
  if (!kayit.uuid) {
    return { ok: false, hata: "Bu fatura henüz EDM'e gönderilmemiş (kayıtlı UUID yok)." };
  }
  try {
    const sessionId = edmLogin_(ayar);
    const kanal = ayar.url.indexOf("test") > -1 ? "TEST" : "PROD";
    const soapBody = '<GetInvoiceStatusRequest xmlns="http://tempuri.org/">' +
      edmRequestHeaderBlock_(sessionId, kanal) +
      '<INVOICE TRXID="0" UUID="' + edmXmlEscape_(kayit.uuid) + '" xmlns=""/>' +
      '</GetInvoiceStatusRequest>';
    const xml = edmSoapCagir_(ayar.url, "GetInvoiceStatusRequest", soapBody);
    if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
      return { ok: false, hata: "EDM GetInvoiceStatus hatası: " + edmXmlDegeri_(xml, "faultstring") };
    }
    const sonuc = {
      ok: true,
      efaturaNo: kayit.efaturaNo,
      uuid: kayit.uuid,
      status: edmXmlDegeri_(xml, "STATUS"),
      statusAciklama: edmXmlDegeri_(xml, "STATUS_DESCRIPTION"),
      yanitKodu: edmXmlDegeri_(xml, "RESPONSE_CODE"),
      yanitAciklama: edmXmlDegeri_(xml, "RESPONSE_DESCRIPTION"),
    };
    // Ham kodları Türkçeleştir (bkz. edmDurumTurkce_) — bilinmeyen bir kod olduğu gibi kalır.
    sonuc.statusTr = edmDurumTurkce_(sonuc.status);
    sonuc.statusAciklamaTr = edmDurumTurkce_(sonuc.statusAciklama);
    sonuc.yanitAciklamaTr = edmDurumTurkce_(sonuc.yanitAciklama);
    const ozetParcalar = [sonuc.statusTr, sonuc.statusAciklamaTr, sonuc.yanitAciklamaTr].filter(function(x){ return x; });
    sonuc.ozet = ozetParcalar.length ? ozetParcalar.join(" — ") : "Durum bilgisi henüz yok";
    satisEfaturaDurumKaydet_(kayit.rowIndex, sonuc.ozet);
    return sonuc;
  } catch (err) {
    return { ok: false, hata: "EDM durum sorgusu hatası: " + err.message };
  }
}

// UBL-TR 1.2 TEMELFATURA XML'i oluşturur. p: { uuid, tarih(yyyy-MM-dd), saat(HH:mm:ss),
//   aliciVkn, aliciUnvan, kalemler:[{urunAdi,miktar,birim,birimFiyat,tutar,kdvOrani,kdvTutari}],
//   araToplam, kdvToplam, genelToplam }
function edmFaturaXmlOlustur_(p) {
  const s = EDM_SELLER;
  const saticiVkn = p.saticiVkn || s.vkn;
  const satirlarXml = p.kalemler.map(function(k, idx) {
    const birimKodu = edmBirimKodu_(k.birim);
    return '' +
      '\t<cac:InvoiceLine>\n' +
      '\t\t<cbc:ID>' + (idx + 1) + '</cbc:ID>\n' +
      '\t\t<cbc:InvoicedQuantity unitCode="' + birimKodu + '">' + k.miktar + '</cbc:InvoicedQuantity>\n' +
      '\t\t<cbc:LineExtensionAmount currencyID="TRY">' + k.tutar.toFixed(2) + '</cbc:LineExtensionAmount>\n' +
      '\t\t<cac:TaxTotal>\n' +
      '\t\t\t<cbc:TaxAmount currencyID="TRY">' + k.kdvTutari.toFixed(2) + '</cbc:TaxAmount>\n' +
      '\t\t\t<cac:TaxSubtotal>\n' +
      '\t\t\t\t<cbc:TaxableAmount currencyID="TRY">' + k.tutar.toFixed(2) + '</cbc:TaxableAmount>\n' +
      '\t\t\t\t<cbc:TaxAmount currencyID="TRY">' + k.kdvTutari.toFixed(2) + '</cbc:TaxAmount>\n' +
      '\t\t\t\t<cbc:CalculationSequenceNumeric>1</cbc:CalculationSequenceNumeric>\n' +
      '\t\t\t\t<cbc:Percent>' + k.kdvOrani + '</cbc:Percent>\n' +
      '\t\t\t\t<cac:TaxCategory>\n' +
      '\t\t\t\t\t<cac:TaxScheme>\n' +
      '\t\t\t\t\t\t<cbc:Name>GERÇEK USULDE KATMA DEĞER VERGİSİ</cbc:Name>\n' +
      '\t\t\t\t\t\t<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>\n' +
      '\t\t\t\t\t</cac:TaxScheme>\n' +
      '\t\t\t\t</cac:TaxCategory>\n' +
      '\t\t\t</cac:TaxSubtotal>\n' +
      '\t\t</cac:TaxTotal>\n' +
      '\t\t<cac:Item>\n' +
      '\t\t\t<cbc:Name>' + edmXmlEscape_(k.urunAdi) + '</cbc:Name>\n' +
      '\t\t</cac:Item>\n' +
      '\t\t<cac:Price>\n' +
      '\t\t\t<cbc:PriceAmount currencyID="TRY">' + k.birimFiyat.toFixed(4) + '</cbc:PriceAmount>\n' +
      '\t\t</cac:Price>\n' +
      '\t</cac:InvoiceLine>';
  }).join("\n");

  return '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd" xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n' +
    '\t<cbc:UBLVersionID>2.1</cbc:UBLVersionID>\n' +
    '\t<cbc:CustomizationID>TR1.2</cbc:CustomizationID>\n' +
    '\t<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>\n' +
    '\t<cbc:ID>' + p.faturaNo + '</cbc:ID>\n' +
    '\t<cbc:CopyIndicator>false</cbc:CopyIndicator>\n' +
    '\t<cbc:UUID>' + p.uuid + '</cbc:UUID>\n' +
    '\t<cbc:IssueDate>' + p.tarih + '</cbc:IssueDate>\n' +
    '\t<cbc:IssueTime>' + p.saat + '</cbc:IssueTime>\n' +
    '\t<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>\n' +
    '\t<cbc:Note>Fincanlar ERP - DENEME gönderimi</cbc:Note>\n' +
    '\t<cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>\n' +
    '\t<cbc:LineCountNumeric>' + p.kalemler.length + '</cbc:LineCountNumeric>\n' +
    '\t<cac:AccountingSupplierParty>\n' +
    '\t\t<cac:Party>\n' +
    '\t\t\t<cac:PartyIdentification><cbc:ID schemeID="VKN">' + saticiVkn + '</cbc:ID></cac:PartyIdentification>\n' +
    '\t\t\t<cac:PartyName><cbc:Name>' + edmXmlEscape_(s.unvan) + '</cbc:Name></cac:PartyName>\n' +
    '\t\t\t<cac:PostalAddress>\n' +
    '\t\t\t\t<cbc:BuildingName>' + edmXmlEscape_(s.adres) + '</cbc:BuildingName>\n' +
    '\t\t\t\t<cbc:CitySubdivisionName>' + edmXmlEscape_(s.ilce) + '</cbc:CitySubdivisionName>\n' +
    '\t\t\t\t<cbc:CityName>' + edmXmlEscape_(s.il) + '</cbc:CityName>\n' +
    '\t\t\t\t<cac:Country><cbc:IdentificationCode>TR</cbc:IdentificationCode><cbc:Name>Türkiye</cbc:Name></cac:Country>\n' +
    '\t\t\t</cac:PostalAddress>\n' +
    '\t\t\t<cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>' + edmXmlEscape_(s.vergiDairesi) + '</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>\n' +
    '\t\t</cac:Party>\n' +
    '\t</cac:AccountingSupplierParty>\n' +
    '\t<cac:AccountingCustomerParty>\n' +
    '\t\t<cac:Party>\n' +
    '\t\t\t<cac:PartyIdentification><cbc:ID schemeID="VKN">' + p.aliciVkn + '</cbc:ID></cac:PartyIdentification>\n' +
    '\t\t\t<cac:PartyName><cbc:Name>' + edmXmlEscape_(p.aliciUnvan) + '</cbc:Name></cac:PartyName>\n' +
    '\t\t\t<cac:PostalAddress>\n' +
    '\t\t\t\t<cbc:BuildingName/>\n' +
    '\t\t\t\t<cbc:CitySubdivisionName/>\n' +
    '\t\t\t\t<cbc:CityName/>\n' +
    '\t\t\t\t<cac:Country><cbc:IdentificationCode>TR</cbc:IdentificationCode><cbc:Name>Türkiye</cbc:Name></cac:Country>\n' +
    '\t\t\t</cac:PostalAddress>\n' +
    '\t\t</cac:Party>\n' +
    '\t</cac:AccountingCustomerParty>\n' +
    '\t<cac:TaxTotal>\n' +
    '\t\t<cbc:TaxAmount currencyID="TRY">' + p.kdvToplam.toFixed(2) + '</cbc:TaxAmount>\n' +
    '\t\t<cac:TaxSubtotal>\n' +
    '\t\t\t<cbc:TaxableAmount currencyID="TRY">' + p.araToplam.toFixed(2) + '</cbc:TaxableAmount>\n' +
    '\t\t\t<cbc:TaxAmount currencyID="TRY">' + p.kdvToplam.toFixed(2) + '</cbc:TaxAmount>\n' +
    '\t\t\t<cbc:CalculationSequenceNumeric>1</cbc:CalculationSequenceNumeric>\n' +
    '\t\t\t<cbc:Percent>' + (p.kalemler[0] ? p.kalemler[0].kdvOrani : 20) + '</cbc:Percent>\n' +
    '\t\t\t<cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV GERCEK</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>\n' +
    '\t\t</cac:TaxSubtotal>\n' +
    '\t</cac:TaxTotal>\n' +
    '\t<cac:LegalMonetaryTotal>\n' +
    '\t\t<cbc:LineExtensionAmount currencyID="TRY">' + p.araToplam.toFixed(2) + '</cbc:LineExtensionAmount>\n' +
    '\t\t<cbc:TaxExclusiveAmount currencyID="TRY">' + p.araToplam.toFixed(2) + '</cbc:TaxExclusiveAmount>\n' +
    '\t\t<cbc:TaxInclusiveAmount currencyID="TRY">' + p.genelToplam.toFixed(2) + '</cbc:TaxInclusiveAmount>\n' +
    '\t\t<cbc:AllowanceTotalAmount currencyID="TRY">0</cbc:AllowanceTotalAmount>\n' +
    '\t\t<cbc:PayableAmount currencyID="TRY">' + p.genelToplam.toFixed(2) + '</cbc:PayableAmount>\n' +
    '\t</cac:LegalMonetaryTotal>\n' +
    satirlarXml + '\n' +
    '</Invoice>';
}

// body: { satisId }
function edmFaturaGonderTest(body) {
  const ayar = edmAyarlariniAl_();
  if (!ayar.url || !ayar.user || !ayar.password) {
    return { ok: false, hata: "EDM bağlantı bilgileri tanımlı değil (Script Özellikleri)." };
  }
  if (ayar.url.indexOf("test") === -1) {
    return { ok: false, hata: "Güvenlik: bu deneme gönderim fonksiyonu sadece TEST ortamı EDM_URL'inde çalışır, canlı ortamda devre dışı." };
  }
  const satisId = body.satisId;
  if (!satisId) return { ok: false, hata: "satisId gerekli" };
  const detay = getSatisDetay(satisId);
  if (!detay.ok) return { ok: false, hata: "Satış bulunamadı: " + (detay.hata || "") };
  if (!detay.kalemler || detay.kalemler.length === 0) {
    return { ok: false, hata: "Bu faturada hiç kalem yok, gönderilemez." };
  }

  try {
    const sessionId = edmLogin_(ayar);
    const kendi = edmKendiBilgimiAl_(ayar, sessionId);
    if (!kendi) return { ok: false, hata: "GetUserList boş döndü — bu EDM hesabına tanımlı hiç posta kutusu/birim yok görünüyor." };
    const alici = edmVknBilgiAl_(ayar, sessionId, EDM_TEST_ALICI_VKN);
    if (!alici) return { ok: false, hata: "EDM test alıcısı (" + EDM_TEST_ALICI_VKN + ") bulunamadı." };

    const now = new Date();
    const xmlParams = {
      uuid: Utilities.getUuid(),
      faturaNo: edmFaturaNoUret_(),
      tarih: Utilities.formatDate(now, "Europe/Istanbul", "yyyy-MM-dd"),
      saat: Utilities.formatDate(now, "Europe/Istanbul", "HH:mm:ss"),
      saticiVkn: kendi.identifier,
      aliciVkn: EDM_TEST_ALICI_VKN,
      aliciUnvan: alici.title || "EDM Test Mükellefi",
      kalemler: detay.kalemler.map(function(k) {
        return {
          urunAdi: k.urunAdi, miktar: k.miktar, birim: k.birim,
          birimFiyat: k.birimFiyat, tutar: k.tutar - (k.iskontoTutari || 0),
          kdvOrani: k.kdvOrani, kdvTutari: k.kdvTutari,
        };
      }),
      araToplam: detay.satis.toplamlar.araToplam,
      kdvToplam: detay.satis.toplamlar.kdvToplam,
      genelToplam: detay.satis.toplamlar.genelToplam,
    };
    const invoiceXml = edmFaturaXmlOlustur_(xmlParams);
    const contentB64 = Utilities.base64Encode(invoiceXml, Utilities.Charset.UTF_8);

    const kanal = "TEST";
    const soapBody = '<SendInvoiceRequest xmlns="http://tempuri.org/">' +
      edmRequestHeaderBlock_(sessionId, kanal) +
      '<RECEIVER xmlns="" vkn="' + EDM_TEST_ALICI_VKN + '" alias="' + edmXmlEscape_(alici.alias) + '"/>' +
      '<INVOICE xmlns="" TRXID="0">' +
      '<HEADER>' +
      '<SENDER>' + kendi.identifier + '</SENDER>' +
      '<RECEIVER>' + EDM_TEST_ALICI_VKN + '</RECEIVER>' +
      '<FROM>' + edmXmlEscape_(kendi.alias) + '</FROM>' +
      '<TO>' + edmXmlEscape_(alici.alias) + '</TO>' +
      '<INTERNETSALES>false</INTERNETSALES>' +
      '<EARCHIVE>false</EARCHIVE>' +
      '</HEADER>' +
      '<CONTENT>' + contentB64 + '</CONTENT>' +
      '</INVOICE>' +
      '</SendInvoiceRequest>';

    const xml = edmSoapCagir_(ayar.url, "SendInvoiceRequest", soapBody);
    if (xml.indexOf("Fault") > -1 || xml.indexOf("faultstring") > -1) {
      return { ok: false, hata: "EDM SendInvoice hatası: " + edmXmlDegeri_(xml, "faultstring"), gonderilenXml: invoiceXml };
    }
    const returnCode = edmXmlDegeri_(xml, "RETURN_CODE");
    const status = edmXmlDegeri_(xml, "STATUS");
    if (returnCode !== "0") {
      return { ok: false, hata: "EDM RETURN_CODE=" + returnCode + " (başarısız). Yanıt: " + xml.substring(0, 500) };
    }
    // ÖNEMLİ: Kendi ürettiğimiz "FYT..." numarasının EDM/GİB açısından hiçbir
    // karşılığı/önemi yok — istekte ID belirtmediğimiz için EDM faturayı KENDİ
    // serisinden otomatik numaralandırıyor. Asıl geçerli/resmi numara, yanıttaki
    // <INVOICE ... ID="..." UUID="..."> özelliklerinde (attribute, alt etiket
    // DEĞİL) geliyor — bunu doğru okuyup gerçek numara olarak kaydediyoruz.
    // Yanıt beklenmedik şekilde bu bilgiyi içermezse kendi ürettiğimiz numaraya
    // (xmlParams.faturaNo/uuid) düşüyoruz ki hiç kayıt kalmasın diye.
    const edmGercekNo = edmXmlOznitelik_(xml, "INVOICE", "ID");
    const edmGercekUuid = edmXmlOznitelik_(xml, "INVOICE", "UUID");
    const gercekFaturaNo = edmGercekNo || xmlParams.faturaNo;
    const gercekUuid = edmGercekUuid || xmlParams.uuid;
    // "Resmi Görüntüle" ekranı için: hem gönderilen ham UBL-XML'i hem de o XML'in
    // üretildiği alanların JSON anlık görüntüsünü saklıyoruz — görsel her zaman
    // GERÇEKTEN GÖNDERİLEN veriden çizilsin, sonradan Sheets'te değişen veriden değil.
    const gorselVeri = {
      faturaNo: gercekFaturaNo, uuid: gercekUuid,
      tarih: xmlParams.tarih, saat: xmlParams.saat,
      saticiVkn: xmlParams.saticiVkn, aliciVkn: xmlParams.aliciVkn, aliciUnvan: xmlParams.aliciUnvan,
      kalemler: xmlParams.kalemler,
      araToplam: xmlParams.araToplam, kdvToplam: xmlParams.kdvToplam, genelToplam: xmlParams.genelToplam,
    };
    satisEfaturaNoKaydet_(satisId, gercekFaturaNo, gercekUuid, invoiceXml, JSON.stringify(gorselVeri));

    // Gönderim başarılı olur olmaz portal durumunu otomatik sorgula (best-effort —
    // GİB'in durumu işlemesi biraz zaman alabileceğinden bu sorgu başarısız ya da
    // henüz güncel olmayabilir; hata olsa bile gönderim sonucunu bozmasın).
    let otomatikDurum = null;
    try {
      otomatikDurum = edmFaturaDurumSorgula({ satisId: satisId });
    } catch (durumErr) {
      otomatikDurum = { ok: false, hata: "Otomatik durum sorgusu başarısız: " + durumErr.message };
    }

    return { ok: true, durum: edmDurumTurkce_(status) || "Gönderildi", aliciUnvan: alici.title, efaturaNo: gercekFaturaNo, uuid: gercekUuid, ozetXml: xml.substring(0, 800), otomatikDurumSorgusu: otomatikDurum };
  } catch (err) {
    return { ok: false, hata: "EDM gönderim hatası: " + err.message };
  }
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
  kdBacakNotu_({ k: "pos", tip: tip, kaynak: SHEETS.posHareketleri, kid: id, tutar: tutar, tarih: tarih, ek: posHesapId });
  return id;
}

// NOT: Bir işlem (ör. hedefi "Banka/Kredi Kartı" olan bir Ödeme) aynı öneke sahip
// birden fazla satır yazmış olabilir — bu yüzden TÜM eşleşen satırlar silinir, ilkinde durulmaz.
function posHareketSilByAciklamaOnPrefix(prefix) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posHareketleri, POS_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5] || "").indexOf(prefix) === 0) { sheet.deleteRow(i + 1); }
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
  kdBacakNotu_({ k: "banka", tip: tip, kaynak: SHEETS.bankaHesapHareketleri, kid: id, tutar: tutar, tarih: tarih, ek: bankaHesapId });
  return id;
}

// NOT: aynı gerekçeyle (bkz. posHareketSilByAciklamaOnPrefix) TÜM eşleşen satırlar silinir.
function bankaHesapHareketSilByAciklamaOnPrefix(prefix) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.bankaHesapHareketleri, BANKA_HESAP_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5] || "").indexOf(prefix) === 0) { sheet.deleteRow(i + 1); }
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
// KREDİ KARTI HAREKETLERİ — şirketin kendi kredi kartı borcu takibi.
// Önceden KrediKartlari sadece bir TANIM listesiydi (ID/Ad/Limit), hiçbir
// hareket/bakiye tutulmuyordu. Ödeme modülünde "Hedef: Banka/Kredi Kartı" ile
// bir kredi kartına borç ödemesi yapıldığında buraya "Ödeme" kaydı düşer.
// TİP: "Borç" (karta harcama/borç artışı — şu an yazan bir akış yok, ileride
// eklenebilir) veya "Ödeme" (borç azalışı). Bakiye = Borç toplamı − Ödeme toplamı.
// ODEME:<id> önekiyle geri alınabilir.
// ════════════════════════════════════════════════
const KREDI_KART_HAREKET_BASLIKLAR = ["ID", "KREDI_KART_ID", "TARIH", "TIP", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI"];

function krediKartHareketEkle(krediKartId, tarih, tip, tutar, aciklama) {
  if (!krediKartId) return null;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartHareketleri, KREDI_KART_HAREKET_BASLIKLAR);
  const id = "kh_" + Date.now();
  sheet.appendRow([id, krediKartId, tarih, tip, tutar, aciklama,
    Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm")]);
  kdBacakNotu_({ k: "kart", tip: tip, kaynak: SHEETS.krediKartHareketleri, kid: id, tutar: tutar, tarih: tarih, ek: krediKartId });
  return id;
}

// NOT: aynı gerekçeyle (bkz. posHareketSilByAciklamaOnPrefix) TÜM eşleşen satırlar silinir.
function krediKartHareketSilByAciklamaOnPrefix(prefix) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartHareketleri, KREDI_KART_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][5] || "").indexOf(prefix) === 0) { sheet.deleteRow(i + 1); }
  }
}

// Bir kredi kartının (veya tüm kartların) hareket dökümü — borç bakiyesi = Borç − Ödeme.
function getKrediKartHareketleri(krediKartId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.krediKartHareketleri, KREDI_KART_HAREKET_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  let toplam = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (krediKartId && String(row[1]) !== String(krediKartId)) continue;
    const tutar = parseFloat(row[4]) || 0;
    toplam += (String(row[3]) === "Borç") ? tutar : -tutar;
    sonuc.push({
      id: String(row[0]), krediKartId: String(row[1]), tarih: hucreTarihStr(row[2]),
      tip: String(row[3] || ""), tutar: tutar, aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, hareketler: sonuc, toplam: toplam };
}

// ════════════════════════════════════════════════
// POS → BANKA AKTARIMI (mutabakat/virman)
// Kredi kartıyla tahsil edilen tutarlar POS hesabına "Borç" olarak birikir
// (bkz. saveTahsilat) ama bu para bankaya gerçekten yattığında bunu POS'tan
// düşüp banka hesabına işleyecek bir mekanizma yoktu — POS bakiyesi sonsuza
// kadar büyüyen bir "alacak" listesi olarak kalıyordu. Bu fonksiyon o eksik
// halkayı tamamlar: POS'a "Alacak" (bakiye azalır), banka hesabına "Giriş" yazar.
// ════════════════════════════════════════════════
const POS_BANKA_AKTARIM_BASLIKLAR = ["ID", "POS_HESAP_ID", "BANKA_HESAP_ID", "TARIH", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI"];

function getPosBankaAktarimListesi(posHesapId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posBankaAktarimlari, POS_BANKA_AKTARIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  const sonuc = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (posHesapId && String(row[1]) !== String(posHesapId)) continue;
    sonuc.push({
      id: String(row[0]), posHesapId: String(row[1]), bankaHesapId: String(row[2]),
      tarih: hucreTarihStr(row[3]), tutar: parseFloat(row[4]) || 0,
      aciklama: String(row[5] || ""), kayitTarihi: hucreTarihStr(row[6]),
    });
  }
  sonuc.reverse();
  return { ok: true, aktarimlar: sonuc };
}

// body: { posHesapId, bankaHesapId, tutar, tarih, aciklama }
function savePosBankaAktarim(body) {
  const posHesapId = String(body.posHesapId || "").trim();
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  const tutar = parseFloat(body.tutar) || 0;
  if (!posHesapId) return { ok: false, hata: "POS hesabı seçimi gerekli" };
  if (!bankaHesapId) return { ok: false, hata: "Banka hesabı seçimi gerekli" };
  if (tutar <= 0) return { ok: false, hata: "Tutar sıfırdan büyük olmalı" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posBankaAktarimlari, POS_BANKA_AKTARIM_BASLIKLAR);
  const id = "pba_" + Date.now();
  const tarih = String(body.tarih || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd"));
  const kayitTarihi = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm");
  const aciklama = "POSAKTARIM:" + id + " | " + aciklamaSablonuAl("posBankaAktarim") + (body.aciklama ? " - " + body.aciklama : "");
  sheet.appendRow([id, posHesapId, bankaHesapId, tarih, tutar, String(body.aciklama || ""), kayitTarihi]);

  posHareketEkle(posHesapId, tarih, "Alacak", tutar, aciklama);
  bankaHesapHareketEkle(bankaHesapId, tarih, "Giriş", tutar, aciklama);

  return { ok: true, id: id };
}

// body: { id }
function silPosBankaAktarim(body) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, hata: "id gerekli" };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.posBankaAktarimlari, POS_BANKA_AKTARIM_BASLIKLAR);
  const data = sheet.getDataRange().getValues();
  let bulundu = false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === id) { sheet.deleteRow(i + 1); bulundu = true; break; }
  }
  if (!bulundu) return { ok: false, hata: "Aktarım bulunamadı" };

  posHareketSilByAciklamaOnPrefix("POSAKTARIM:" + id);
  bankaHesapHareketSilByAciklamaOnPrefix("POSAKTARIM:" + id);
  return { ok: true };
}

// ════════════════════════════════════════════════
// ÜRÜN FİYAT GEÇMİŞİ — Sipariş/Teklif/Fatura oluştururken bir ürünün
// geçmiş satış fiyatlarını göstermek için (SatisKalemleri'nden).
// ════════════════════════════════════════════════

function getUrunFiyatGecmisi(urunAdi) {
  const arananUrun = String(urunAdi || "").trim().replace(/[İIıi]/g,"i").toLocaleLowerCase("tr");
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
    if (!urunAdiRow.replace(/[İIıi]/g,"i").toLocaleLowerCase("tr").includes(arananUrun)) continue;
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

// ════════════════════════════════════════════════
// OTOMATİK YEDEKLEME — Ana Spreadsheet'in tamamının Drive'da ayrı bir klasöre,
// zaman damgalı isimle periyodik kopyasını alır. "Tümünü Sil ve Sıfırla" öncesi
// alınan sayfa-içi _YEDEK_ kopyalarından farklı olarak, BU yedekler ayrı birer
// Drive dosyasıdır — ana dosya tamamen silinse/bozulsa bile kurtarma imkanı verir.
// Yedekler SÜRESİZ saklanır, otomatik silinmez (elle temizlenmesi gerekir).
// ════════════════════════════════════════════════

var YEDEK_KLASOR_ADI = "Fincanlar ERP - Otomatik Yedekler";

function yedekKlasoruGetirVeyaOlustur_() {
  var klasorler = DriveApp.getFoldersByName(YEDEK_KLASOR_ADI);
  if (klasorler.hasNext()) return klasorler.next();
  return DriveApp.createFolder(YEDEK_KLASOR_ADI);
}

// Zaman tetikleyicisi bu fonksiyonu çağırır. Elle de çalıştırılabilir (Apps Script
// editöründen "Çalıştır" ile anlık yedek almak için).
function otomatikYedekAl() {
  var klasor = yedekKlasoruGetirVeyaOlustur_();
  var zamanDamgasi = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd_HH-mm");
  var orijinalDosya = DriveApp.getFileById(SHEET_ID);
  var yeniAd = "Fincanlar ERP Yedek - " + zamanDamgasi;
  orijinalDosya.makeCopy(yeniAd, klasor);
}

// TEK SEFERLİK KURULUM: Bu fonksiyonu Apps Script editöründen elle bir kez
// çalıştır (▶ Çalıştır butonuyla, "otomatikYedekAl" değil "yedekTetikleyiciKur"
// seçili olarak). Google izin isteyecektir, onayla. Bundan sonra sistem günde
// 4 kez (yaklaşık her 6 saatte bir) otomatik yedek almaya başlar — tekrar
// çalıştırmana gerek kalmaz. Fonksiyonu yanlışlıkla birden fazla kez çalıştırırsan
// da sorun olmaz; önce varsa eski tetikleyiciyi siler, sonra yenisini kurar.
function yedekTetikleyiciKur() {
  var tetikleyiciler = ScriptApp.getProjectTriggers();
  for (var i = 0; i < tetikleyiciler.length; i++) {
    if (tetikleyiciler[i].getHandlerFunction() === "otomatikYedekAl") {
      ScriptApp.deleteTrigger(tetikleyiciler[i]);
    }
  }
  ScriptApp.newTrigger("otomatikYedekAl")
    .timeBased()
    .everyHours(6)
    .create();

  // Kurulumun doğru çalıştığını görmek için hemen bir ilk yedek de al.
  otomatikYedekAl();
}

// Mevcut tetikleyicilerin durumunu görmek için (Apps Script editöründen elle
// çalıştırıp Logger çıktısına bakılabilir).
function yedekTetikleyiciDurumGoster() {
  var tetikleyiciler = ScriptApp.getProjectTriggers();
  var bulundu = false;
  for (var i = 0; i < tetikleyiciler.length; i++) {
    if (tetikleyiciler[i].getHandlerFunction() === "otomatikYedekAl") {
      bulundu = true;
      Logger.log("Yedek tetikleyicisi AKTİF — her " + tetikleyiciler[i].getTriggerSourceId());
    }
  }
  if (!bulundu) Logger.log("Yedek tetikleyicisi KURULU DEĞİL — yedekTetikleyiciKur() fonksiyonunu çalıştır.");
}
