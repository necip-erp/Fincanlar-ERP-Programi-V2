// ════════════════════════════════════════════════
// 📥 AKINSOFT 2026 AKTARIMI (27 Eki 2026) — yalnız Admin
// Akınsoft'tan alınan 2026 tarihli Satış / Satış İade / Alış faturaları, mevcut kayıtların ÜZERİNE EKLENİR (silme yok).
// Her fatura ERP'nin kendi kayıt fonksiyonlarıyla (saveSatis / saveSatisIade / saveAlis) işlenir; böylece stok hareketi,
// cari borç/alacak ve Kayıt Defteri aynen elle girilmiş gibi oluşur. Faturanın Açıklama alanının sonuna "[AKS:no|cariKodu|yyyymmdd]"
// etiketi yazılır; aynı dosya tekrar yüklenirse etiketi olan faturalar atlanır (çift kayıt olmaz).
// Üç adım: akinsoftOnizle (hiçbir şey yazmaz) → akinsoftKartAc (eksik cari/stok kartları) → akinsoftFaturaAktar (parti parti).
// Ödeme tipi "Açık Hesap" yazılır (Akınsoft fatura raporunda ödeme bilgisi yok); tahsilat/ödeme/virman cari hareket raporuyla ayrıca gelir.
// ════════════════════════════════════════════════

function aksKodN_(t) { return String(t || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase(); }
function aksEtiket_(f) { return "[AKS:" + String(f.no || "") + "|" + String(f.cariKodu || "") + "|" + String(f.tarih || "").replace(/-/g, "") + "]"; }

// Cari kodu (boşluk/tire yok sayılarak) → { id, ad, tip }
function aksCariHarita_(ss) {
  const sh = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID","TIP","AD","TELEFON","ADRES","VERGI_NO","NOT","TARIH","CARI_KODU","ISKONTO_ORANI"]);
  const v = sh.getDataRange().getValues(), h = {};
  for (let i = 1; i < v.length; i++) {
    const kod = aksKodN_(v[i][8]);
    if (kod && v[i][0] && !h[kod]) h[kod] = { id: String(v[i][0]), ad: String(v[i][2] || ""), tip: String(v[i][1] || "") };
  }
  return h;
}

// Daha önce aktarılmış faturaların etiketleri (Satış, Alış ve iade sayfalarının tüm hücrelerinde aranır)
function aksMevcutEtiketler_(ss) {
  const set = {};
  [SHEETS.satislar, SHEETS.alislar, SHEETS.satisIadeler, SHEETS.alisIadeler].forEach(function (ad) {
    const sh = ss.getSheetByName(ad);
    if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) {
      for (let c = 0; c < v[i].length; c++) {
        const s = v[i][c];
        if (typeof s !== "string" || s.indexOf("[AKS:") < 0) continue;
        const m = s.match(/\[AKS:[^\]]+\]/g);
        if (m) m.forEach(function (x) { set[x] = true; });
      }
    }
  });
  return set;
}

// body: { cariler:[{kod,unvan,tip}], stoklar:[{kod,ad,birim}], faturalar:[{tur,no,cariKodu,tarih,atla?}] } — kalem göndermek gerekmez
function akinsoftOnizle(body) {
  const ss = acikSS_();
  const cH = aksCariHarita_(ss), sH = stokKoduHaritasiOlustur(ss), et = aksMevcutEtiketler_(ss);
  const yeniCari = [], yeniStok = [];
  let mevcutCari = 0, mevcutStok = 0;
  (body.cariler || []).forEach(function (c) { if (cH[aksKodN_(c.kod)]) mevcutCari++; else yeniCari.push({ kod: c.kod, unvan: c.unvan, tip: c.tip }); });
  (body.stoklar || []).forEach(function (s) { if (sH[String(s.kod || "").trim()]) mevcutStok++; else yeniStok.push({ kod: s.kod, ad: s.ad, birim: s.birim }); });
  const say = { satis: { yeni: 0, mevcut: 0 }, satis_iade: { yeni: 0, mevcut: 0 }, alis: { yeni: 0, mevcut: 0 } };
  const atlanan = [], cariYok = [];
  const yeniCariSeti = {}; yeniCari.forEach(function (c) { yeniCariSeti[aksKodN_(c.kod)] = true; });
  (body.faturalar || []).forEach(function (f) {
    const s = say[f.tur]; if (!s) return;
    if (et[aksEtiket_(f)]) { s.mevcut++; return; }
    if (f.atla) { atlanan.push({ tur: f.tur, no: f.no, cariKodu: f.cariKodu, tarih: f.tarih, neden: f.atla }); return; }
    s.yeni++;
  });
  return { ok: true, yeniCari: yeniCari, mevcutCari: mevcutCari, yeniStok: yeniStok, mevcutStok: mevcutStok, say: say, atlanan: atlanan };
}

// body: { cariler:[{kod,unvan,tip}], stoklar:[{kod,ad,birim}] } — yalnız ERP'de olmayanları açar (kod eşleşmesi)
function akinsoftKartAc(body) {
  const ss = acikSS_();
  const cH = aksCariHarita_(ss), sH = stokKoduHaritasiOlustur(ss);
  const acilanCari = [], acilanStok = [], hata = [];
  (body.cariler || []).forEach(function (c) {
    const kn = aksKodN_(c.kod);
    if (!kn || cH[kn]) return;
    try {
      const r = saveCari({ ad: String(c.unvan || "").trim() || String(c.kod), tip: c.tip === "Tedarikçi" ? "Tedarikçi" : "Müşteri", cariKodu: String(c.kod).trim(), not: "Akınsoft'tan aktarıldı (2026)" });
      Utilities.sleep(4); // kayıt kimlikleri zaman damgası: aynı milisaniyede iki cari açılmasın
      if (r && r.ok) { cH[kn] = { id: r.id, ad: c.unvan, tip: c.tip }; acilanCari.push({ kod: c.kod, unvan: c.unvan, tip: c.tip }); }
      else hata.push("Cari " + c.kod + ": " + ((r && r.hata) || "açılamadı"));
    } catch (e) { hata.push("Cari " + c.kod + ": " + e.message); }
  });
  const yeniStok = (body.stoklar || []).filter(function (s) { const k = String(s.kod || "").trim(); return k && !sH[k]; })
    .map(function (s) { return { stokKodu: String(s.kod).trim(), stokAdi: String(s.ad || "").trim() || String(s.kod), birim1: s.birim || "adet" }; });
  if (yeniStok.length) {
    try {
      const r = saveStokTanimTopluce({ kayitlar: yeniStok, mevcutlaraDokunma: true });
      if (r && r.ok) yeniStok.forEach(function (s) { acilanStok.push({ kod: s.stokKodu, ad: s.stokAdi, birim: s.birim1 }); });
      else hata.push("Stok kartları: " + ((r && r.hata) || "açılamadı"));
      if (typeof _STOK_KOD_HARITASI_ISTEK_ !== "undefined") _STOK_KOD_HARITASI_ISTEK_ = null;
    } catch (e) { hata.push("Stok kartları: " + e.message); }
  }
  cacheTemizle(["cariListesi_v4", "stokTanimListesi"]);
  return { ok: true, acilanCari: acilanCari, acilanStok: acilanStok, hata: hata };
}

// body: { faturalar:[{ tur:"satis|satis_iade|alis", no, cariKodu, unvan, tarih:"yyyy-MM-dd", genelToplam, tutarIskontosu?, atla?,
//                      kalemler:[{ stokKodu, ad, miktar, birim, birimFiyat, iskontoYuzde, kdvOrani, hizmet }] }] }  — parti başına ~10 fatura
function akinsoftFaturaAktar(body) {
  const ss = acikSS_();
  const cH = aksCariHarita_(ss), et = aksMevcutEtiketler_(ss);
  const sonuc = [];
  (body.faturalar || []).forEach(function (f) {
    const ref = { tur: f.tur, no: f.no, cariKodu: f.cariKodu, tarih: f.tarih, akinsoftToplam: f.genelToplam };
    try {
      const etiket = aksEtiket_(f);
      if (et[etiket]) { sonuc.push(Object.assign(ref, { durum: "mevcut" })); return; }
      if (f.atla) { sonuc.push(Object.assign(ref, { durum: "atlandi", mesaj: f.atla })); return; }
      const cari = cH[aksKodN_(f.cariKodu)];
      if (!cari) { sonuc.push(Object.assign(ref, { durum: "hata", mesaj: "Cari bulunamadı (" + f.cariKodu + ") — önce kartları açın" })); return; }
      const net = function (k) { return Math.round((parseFloat(k.birimFiyat) || 0) * (1 - (parseFloat(k.iskontoYuzde) || 0) / 100) * 1e6) / 1e6; };
      const adNotu = (String(f.unvan || "").trim() && String(f.unvan).trim() !== cari.ad) ? " · Akınsoft unvan: " + String(f.unvan).trim() : "";
      const aciklama = "Akınsoft " + f.no + adNotu + " " + etiket;
      let r;
      if (f.tur === "satis") {
        r = saveSatis({
          cariId: cari.id, tarih: f.tarih, belgeTipi: "Fatura", odemeTipi: "Açık Hesap", aciklama: aciklama,
          tutarIskontosu: f.tutarIskontosu || 0, tutarIskontoKdvSonra: true,
          kalemler: (f.kalemler || []).map(function (k) { return { urunAdi: k.ad, miktar: k.miktar, birim: k.birim, birimFiyat: k.birimFiyat, iskontoYuzde: k.iskontoYuzde, kdvOrani: k.kdvOrani, stokKodu: k.stokKodu || "", stoksuz: !!k.hizmet }; }),
        });
      } else if (f.tur === "satis_iade") {
        r = saveSatisIade({
          cariId: cari.id, tarih: f.tarih, aciklama: aciklama, iadeFaturaNo: f.no, iadeFaturaTarihi: f.tarih,
          kalemler: (f.kalemler || []).map(function (k) { return { urunAdi: k.ad, miktar: k.miktar, birim: k.birim, birimFiyat: net(k), kdvOrani: k.kdvOrani, stokKodu: k.stokKodu || "", stoksuz: !!k.hizmet }; }),
        });
      } else if (f.tur === "alis") {
        r = saveAlis({
          cariId: cari.id, tarih: f.tarih, odemeTipi: "Açık Hesap", aciklama: aciklama, faturaNumarasi: f.no,
          tutarIskontosu: f.tutarIskontosu || 0,
          kalemler: (f.kalemler || []).map(function (k) { return { urunAdi: k.ad, miktar: k.miktar, birim: k.birim, birimFiyat: net(k), brutFiyat: k.birimFiyat, iskontoYuzde: k.iskontoYuzde, kdvOrani: k.kdvOrani, stokKodu: k.stokKodu || "", stoksuz: !!k.hizmet }; }),
        });
      } else { sonuc.push(Object.assign(ref, { durum: "hata", mesaj: "Bilinmeyen tür: " + f.tur })); return; }
      Utilities.sleep(6); // sonraki faturanın zaman damgalı kimlikleri çakışmasın
      if (r && r.ok) {
        et[etiket] = true;
        const t = parseFloat(r.toplamTutar) || 0;
        sonuc.push(Object.assign(ref, { durum: "ok", erpToplam: Math.round(t * 100) / 100, fark: Math.round((t - (parseFloat(f.genelToplam) || 0)) * 100) / 100 }));
      } else sonuc.push(Object.assign(ref, { durum: "hata", mesaj: (r && (r.hata || r.error)) || "Kaydedilemedi" }));
    } catch (e) { sonuc.push(Object.assign(ref, { durum: "hata", mesaj: e.message })); }
  });
  cacheTemizle(["cariListesi_v4", "satisListesi", "alisListesi", "stokTanimListesi"]);
  return { ok: true, sonuc: sonuc };
}
