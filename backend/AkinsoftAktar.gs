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
          cariId: cari.id, tarih: f.tarih, belgeTipi: "Fatura", odemeTipi: "Açık Hesap", aciklama: aciklama, faturaNo: String(f.no || ""),
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

// ════════════════════════════════════════════════
// 📥 AKINSOFT 2026 CARİ HAREKET AKTARIMI (28 Eki 2026) — yalnız Admin
// Nakit/Havale(Dekont)/POS/Kredi Kartı tahsilat-ödemeleri, cari virmanlar ve 31.12.2025 açılış devirleri.
// (Çek/Senet ayrı adımdır.) Her kayıt ERP'nin kendi fonksiyonuyla (saveTahsilat / saveOdeme / saveCariVirman) yazılır;
// açıklamanın sonuna "[AKH:<kaynak satır no>]" etiketi eklenir → aynı dosya tekrar yüklenirse atlanır.
// Banka / POS / Kredi Kartı hesapları Akınsoft'taki ada göre ERP'de aranır; bulunamazsa açılır (önizlemede görünür).
// ════════════════════════════════════════════════

function aksAdN_(t) {
  return String(t || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/[^A-Z0-9]/g, "");
}
function aksHareketEtiketleri_(ss) {
  const set = {};
  [SHEETS.tahsilatlar, SHEETS.odemeler, SHEETS.cariVirmanlar, SHEETS.cariHareketler].forEach(function (ad) {
    const sh = ss.getSheetByName(ad);
    if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) for (let c = 0; c < v[i].length; c++) {
      const s = v[i][c];
      if (typeof s !== "string" || s.indexOf("[AKH:") < 0) continue;
      const m = s.match(/\[AKH:[^\]]+\]/g);
      if (m) m.forEach(function (x) { set[x] = true; });
    }
  });
  return set;
}
function aksSayfa_(ss, ad, bas) { return getOrCreateSheet(ss, ad, bas).getDataRange().getValues(); }

// Banka yapısı: { bankalar:[{id,ad,n}], hesaplar:[{id,bankaId,ad,n}], poslar:[...], kartlar:[...] }
function aksBankaYapisi_(ss) {
  const b = aksSayfa_(ss, SHEETS.bankalar, ["ID","AD"]), h = aksSayfa_(ss, SHEETS.bankaHesaplari, ["ID","BANKA_ID","HESAP_ADI","IBAN"]);
  const p = aksSayfa_(ss, SHEETS.posCihazlari, ["ID","BANKA_ID","POS_ADI","ACIKLAMA"]), k = aksSayfa_(ss, SHEETS.krediKartlari, ["ID","BANKA_ID","KART_ADI","LIMIT"]);
  const y = { bankalar: [], hesaplar: [], poslar: [], kartlar: [] };
  for (let i = 1; i < b.length; i++) if (b[i][0]) y.bankalar.push({ id: String(b[i][0]), ad: String(b[i][1] || ""), n: aksAdN_(b[i][1]) });
  for (let i = 1; i < h.length; i++) if (h[i][0]) y.hesaplar.push({ id: String(h[i][0]), bankaId: String(h[i][1]), ad: String(h[i][2] || ""), n: aksAdN_(h[i][2]) });
  for (let i = 1; i < p.length; i++) if (p[i][0]) y.poslar.push({ id: String(p[i][0]), bankaId: String(p[i][1]), ad: String(p[i][2] || ""), n: aksAdN_(p[i][2]) });
  for (let i = 1; i < k.length; i++) if (k[i][0]) y.kartlar.push({ id: String(k[i][0]), bankaId: String(k[i][1]), ad: String(k[i][2] || ""), n: aksAdN_(k[i][2]) });
  return y;
}
// "VAKIFBANK - VAKIFBANK VADESİZ - TL" → { banka:"VAKIFBANK", hesap:"VAKIFBANK VADESİZ" }
function aksBankaAyir_(metin) {
  const p = String(metin || "").split(" - ").map(function (x) { return x.trim(); }).filter(String);
  return { banka: p[0] || String(metin || "").trim(), hesap: p[1] || p[0] || "" };
}
function aksBankaBul_(y, bankaAdi) {
  const n = aksAdN_(bankaAdi); if (!n) return null;
  let r = y.bankalar.find(function (b) { return b.n === n; });
  if (!r) r = y.bankalar.find(function (b) { return b.n.length >= 4 && (n.indexOf(b.n) >= 0 || b.n.indexOf(n) >= 0); });
  if (!r) r = y.bankalar.find(function (b) { return b.n.length >= 5 && n.length >= 5 && b.n.slice(0, 5) === n.slice(0, 5); });
  return r || null;
}
// Hedef hesabı çöz: kaynak = "Nakit" dışı. tur: "hesap" (Dekont) | "pos" (Pos) | "kart" (Kredi Kartı). olustur=true ise eksikleri açar.
function aksHesapCoz_(ss, y, kaynak, bankaMetni, olustur) {
  const a = aksBankaAyir_(bankaMetni), tur = kaynak === "Dekont" ? "hesap" : kaynak === "Pos" ? "pos" : "kart";
  const liste = tur === "hesap" ? y.hesaplar : tur === "pos" ? y.poslar : y.kartlar;
  let banka = aksBankaBul_(y, a.banka), yeniBanka = false;
  if (!banka) {
    if (!olustur) return { bankaAd: a.banka, hedefAd: a.hesap, yeni: true, yeniBanka: true };
    const r = saveBanka({ ad: a.banka }); Utilities.sleep(4);
    banka = { id: r.id, ad: a.banka, n: aksAdN_(a.banka) }; y.bankalar.push(banka); yeniBanka = true;
  }
  const bankaninki = liste.filter(function (x) { return x.bankaId === banka.id; });
  let hedef = null;
  if (tur === "hesap") {
    const n = aksAdN_(a.hesap);
    hedef = bankaninki.find(function (x) { return x.n === n; }) || bankaninki.find(function (x) { return x.n.length >= 4 && (n.indexOf(x.n) >= 0 || x.n.indexOf(n) >= 0); }) || (bankaninki.length === 1 ? bankaninki[0] : null);
  } else hedef = bankaninki[0] || null;
  if (hedef) return { bankaAd: banka.ad, hedefAd: hedef.ad, id: hedef.id, yeni: false };
  const yeniAd = tur === "hesap" ? a.hesap : (banka.ad + (tur === "pos" ? " POS" : " Kredi Kartı"));
  if (!olustur) return { bankaAd: banka.ad, hedefAd: yeniAd, yeni: true, yeniBanka: yeniBanka };
  const r = tur === "hesap" ? saveBankaHesap({ bankaId: banka.id, hesapAdi: yeniAd }) : tur === "pos" ? savePos({ bankaId: banka.id, posAdi: yeniAd }) : saveKrediKarti({ bankaId: banka.id, kartAdi: yeniAd });
  Utilities.sleep(4);
  if (!r || !r.ok) return { hata: (r && r.hata) || "Hesap açılamadı: " + yeniAd };
  liste.push({ id: r.id, bankaId: banka.id, ad: yeniAd, n: aksAdN_(yeniAd) });
  return { bankaAd: banka.ad, hedefAd: yeniAd, id: r.id, yeni: true };
}

// body: { cariler, devir, hareketler, virmanlar } — hiçbir şey yazmaz
function akinsoftHareketOnizle(body) {
  const ss = acikSS_(), cH = aksCariHarita_(ss), et = aksHareketEtiketleri_(ss), y = aksBankaYapisi_(ss);
  const yeniCari = (body.cariler || []).filter(function (c) { return !cH[aksKodN_(c.kod)]; });
  const yeniCariSeti = {}; yeniCari.forEach(function (c) { yeniCariSeti[aksKodN_(c.kod)] = true; });
  const cariVar = function (k) { return !!cH[aksKodN_(k)] || !!yeniCariSeti[aksKodN_(k)]; };
  const say = { tahsilat: [0, 0], odeme: [0, 0], virman: [0, 0], devir: [0, 0] }; // [yeni, mevcut]
  const eksikCari = {}, plan = {};
  (body.hareketler || []).forEach(function (h) {
    const s = say[h.tur]; if (!s) return;
    if (et["[AKH:" + h.id + "]"]) { s[1]++; return; }
    s[0]++;
    if (!cariVar(h.kod)) eksikCari[h.kod] = true;
    if (h.kaynak === "Dekont" || h.kaynak === "Pos" || h.kaynak === "Kredi Kartı") {
      const anahtar = h.kaynak + "|" + h.banka;
      if (!plan[anahtar]) { const r = aksHesapCoz_(ss, y, h.kaynak, h.banka, false); plan[anahtar] = { kaynak: h.kaynak, akinsoft: h.banka, erp: (r.bankaAd || "") + " → " + (r.hedefAd || ""), yeni: !!r.yeni, adet: 0 }; }
      plan[anahtar].adet++;
    }
  });
  (body.virmanlar || []).forEach(function (v) {
    if (et["[AKH:" + v.id + "]"]) { say.virman[1]++; return; }
    say.virman[0]++; [v.kaynakKod, v.hedefKod].forEach(function (k) { if (!cariVar(k)) eksikCari[k] = true; });
  });
  (body.devir || []).forEach(function (d) {
    if (et["[AKH:D" + d.kod + "]"]) { say.devir[1]++; return; }
    say.devir[0]++; if (!cariVar(d.kod)) eksikCari[d.kod] = true;
  });
  return { ok: true, say: say, yeniCari: yeniCari, plan: Object.keys(plan).map(function (k) { return plan[k]; }), eksikCari: Object.keys(eksikCari) };
}

// body: { devirYaz:bool, devir:[{kod,tutar,tip}], hareketler:[...], virmanlar:[...] } — parti parti çağrılır
function akinsoftHareketAktar(body) {
  const ss = acikSS_(), cH = aksCariHarita_(ss), et = aksHareketEtiketleri_(ss), y = aksBankaYapisi_(ss);
  const sonuc = [], hesapOnbellek = {};
  const bitir = function (ref, r) {
    Utilities.sleep(6);
    if (r && r.ok) { et[ref.etiket] = true; ref.durum = "ok"; } else { ref.durum = "hata"; ref.mesaj = (r && (r.hata || r.error)) || "Kaydedilemedi"; }
    sonuc.push(ref);
  };
  (body.devir || []).forEach(function (d) {
    const ref = { tur: "devir", kod: d.kod, tutar: d.tutar, etiket: "[AKH:D" + d.kod + "]" };
    try {
      if (et[ref.etiket]) { ref.durum = "mevcut"; sonuc.push(ref); return; }
      const c = cH[aksKodN_(d.kod)]; if (!c) { ref.durum = "hata"; ref.mesaj = "Cari bulunamadı"; sonuc.push(ref); return; }
      bitir(ref, cariHareketEkle({ cariId: c.id, tarih: "2026-01-01", tip: d.tip, tutar: d.tutar, aciklama: "Akınsoft 31.12.2025 devri " + ref.etiket }));
    } catch (e) { ref.durum = "hata"; ref.mesaj = e.message; sonuc.push(ref); }
  });
  (body.hareketler || []).forEach(function (h) {
    const ref = { tur: h.tur, id: h.id, kod: h.kod, tutar: h.tutar, etiket: "[AKH:" + h.id + "]" };
    try {
      if (et[ref.etiket]) { ref.durum = "mevcut"; sonuc.push(ref); return; }
      const c = cH[aksKodN_(h.kod)]; if (!c) { ref.durum = "hata"; ref.mesaj = "Cari bulunamadı (" + h.kod + ")"; sonuc.push(ref); return; }
      let hesapId = "";
      if (h.kaynak === "Dekont" || h.kaynak === "Pos" || h.kaynak === "Kredi Kartı") {
        const anahtar = h.kaynak + "|" + h.banka;
        if (!hesapOnbellek[anahtar]) hesapOnbellek[anahtar] = aksHesapCoz_(ss, y, h.kaynak, h.banka, true);
        if (hesapOnbellek[anahtar].hata) { ref.durum = "hata"; ref.mesaj = hesapOnbellek[anahtar].hata; sonuc.push(ref); return; }
        hesapId = hesapOnbellek[anahtar].id;
      }
      const acik = (String(h.aciklama || "").trim() + " " + ref.etiket).trim();
      if (h.tur === "tahsilat") {
        bitir(ref, saveTahsilat({ cariId: c.id, tarih: h.tarih, yontem: h.yontem, tutar: h.tutar, aciklama: acik,
          posHesapId: h.yontem === "Kredi Kartı" ? hesapId : "", bankaHesapId: h.yontem === "Havale/EFT" ? hesapId : "" }));
      } else {
        bitir(ref, saveOdeme({ hedefTipi: "Cari", cariId: c.id, tarih: h.tarih, yontem: h.yontem, tutar: h.tutar, aciklama: acik,
          krediKartiId: h.yontem === "Kredi Kartı" ? hesapId : "", bankaHesapId: h.yontem === "Havale/EFT" ? hesapId : "" }));
      }
    } catch (e) { ref.durum = "hata"; ref.mesaj = e.message; sonuc.push(ref); }
  });
  (body.virmanlar || []).forEach(function (v) {
    const ref = { tur: "virman", id: v.id, kod: v.kaynakKod + "→" + v.hedefKod, tutar: v.tutar, etiket: "[AKH:" + v.id + "]" };
    try {
      if (et[ref.etiket]) { ref.durum = "mevcut"; sonuc.push(ref); return; }
      const k = cH[aksKodN_(v.kaynakKod)], t = cH[aksKodN_(v.hedefKod)];
      if (!k || !t) { ref.durum = "hata"; ref.mesaj = "Cari bulunamadı (" + (!k ? v.kaynakKod : v.hedefKod) + ")"; sonuc.push(ref); return; }
      bitir(ref, saveCariVirman({ kaynakCariId: k.id, hedefCariId: t.id, kaynakCariAd: k.ad, hedefCariAd: t.ad, tutar: v.tutar, tarih: v.tarih,
        aciklama: (String(v.aciklama || "").trim() + " " + ref.etiket).trim() }));
    } catch (e) { ref.durum = "hata"; ref.mesaj = e.message; sonuc.push(ref); }
  });
  cacheTemizle(["cariListesi_v4", "tahsilatListesi", "odemeListesi", "bankaYapisi"]);
  return { ok: true, sonuc: sonuc };
}

// ════════════════════════════════════════════════
// 📥 AKINSOFT 2026 ÇEK / SENET AKTARIMI (29 Eki 2026) — yalnız Admin
// Alınan çek/senet: saveCekSenet (cari Alacak) → durumuna göre: Tahsil Edildi (Kasa'ya, vade tarihiyle) / Takasta (bankaya tahsile verildi) /
// Ciro Edildi (karşılığındaki "cirolanması" satırının carisine ciro; cari Borç ERP'nin ciro fonksiyonuyla yazılır) / Portföy (bırakılır).
// Verilen çek: saveCekSenet (cari Borç) → "Bankadan Ödendi" ise vade tarihiyle ödendi yapılır.
// Akınsoft çeklerde banka hesabı vermediği için Verilen çek + Takasta için panelde seçilen banka hesabı kullanılır.
// Eşi 2025'te kalmış ciro satırları (orphan) yalnız cari Borç hareketi olarak yazılır. Etiket: "[AKC:<kaynak satır no>]".
// ════════════════════════════════════════════════
function aksCekEtiketleri_(ss) {
  const set = {};
  [SHEETS.cekSenetler, SHEETS.cariHareketler].forEach(function (ad) {
    const sh = ss.getSheetByName(ad);
    if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) for (let c = 0; c < v[i].length; c++) {
      const s = v[i][c];
      if (typeof s !== "string" || s.indexOf("[AKC:") < 0) continue;
      const m = s.match(/\[AKC:[^\]]+\]/g);
      if (m) m.forEach(function (x) { set[x] = true; });
    }
  });
  return set;
}

// body: { cekler:[{id,orphan?,kod,ciroKod?}] }
function akinsoftCekOnizle(body) {
  const ss = acikSS_(), cH = aksCariHarita_(ss), et = aksCekEtiketleri_(ss);
  const say = { alinan: [0, 0], verilen: [0, 0], orphan: [0, 0] }, eksikCari = {};
  (body.cekler || []).forEach(function (c) {
    const s = say[c.orphan ? "orphan" : c.yon === "Verilen" ? "verilen" : "alinan"];
    if (et["[AKC:" + c.id + "]"]) { s[1]++; return; }
    s[0]++;
    [c.kod, c.ciroKod].forEach(function (k) { if (k && !cH[aksKodN_(k)]) eksikCari[k] = true; });
  });
  return { ok: true, say: say, eksikCari: Object.keys(eksikCari) };
}

// body: { bankaHesapId, cekler:[{ id, orphan, belge:"Çek|Senet", yon:"Alınan|Verilen", kod, ciroKod, tarih, vade, tutar, evrak, durum, aciklama }] }
function akinsoftCekAktar(body) {
  const ss = acikSS_(), cH = aksCariHarita_(ss), et = aksCekEtiketleri_(ss), sonuc = [];
  const bankaHesapId = String(body.bankaHesapId || "").trim();
  (body.cekler || []).forEach(function (c) {
    const ref = { id: c.id, belge: c.belge, yon: c.yon, kod: c.kod, tutar: c.tutar, evrak: c.evrak, etiket: "[AKC:" + c.id + "]" };
    const hata = function (m) { ref.durum = "hata"; ref.mesaj = m; sonuc.push(ref); };
    try {
      if (et[ref.etiket]) { ref.durum = "mevcut"; sonuc.push(ref); return; }
      const cari = cH[aksKodN_(c.kod)]; if (!cari) return hata("Cari bulunamadı (" + c.kod + ")");
      const acik = (String(c.aciklama || "").trim() + " " + ref.etiket).trim();
      if (c.orphan) {   // 2025'ten gelen çekin 2026 cirosu: yalnız cari Borç
        const r = cariHareketEkle({ cariId: cari.id, tarih: c.tarih, tip: "Borç", tutar: c.tutar, aciklama: "Çek cirosu (2025 çeki) " + c.evrak + " " + ref.etiket });
        Utilities.sleep(6);
        if (r && r.ok) { et[ref.etiket] = true; ref.durum = "ok"; sonuc.push(ref); } else hata((r && r.hata) || "Kaydedilemedi");
        return;
      }
      if (c.yon === "Verilen" && !bankaHesapId) return hata("Verilen çek için banka hesabı seçilmemiş");
      const r = saveCekSenet({ cariId: cari.id, tip: c.yon, belgeTuru: c.belge, tutar: c.tutar, seriNo: c.evrak, duzenlenmeTarihi: c.tarih, vade: c.vade,
        aciklama: acik, bankaHesapId: c.yon === "Verilen" ? bankaHesapId : "" });
      Utilities.sleep(6);
      if (!r || !r.ok) return hata((r && r.hata) || "Kaydedilemedi");
      et[ref.etiket] = true; ref.cekId = r.id; ref.notlar = [];
      let r2 = null;
      if (c.durum === "Tahsil Edildi" && c.yon === "Alınan") r2 = cekSenetIslemYap({ id: r.id, tutar: c.tutar, tarih: c.vade, hedefTipi: "Kasa", aciklama: "Akınsoft tahsil edildi" });
      else if (c.durum === "Bankadan Ödendi" && c.yon === "Verilen") r2 = cekSenetIslemYap({ id: r.id, tutar: c.tutar, tarih: c.vade, aciklama: "Akınsoft bankadan ödendi" });
      else if (c.durum === "Takasta" && c.yon === "Alınan") r2 = bankaHesapId ? cekSenetBankayaVer({ id: r.id, bankaHesapId: bankaHesapId, tarih: c.vade, aciklama: "Akınsoft takasta" }) : { ok: false, hata: "banka hesabı seçilmemiş, çek portföyde bırakıldı" };
      else if (c.durum === "Ciro Edildi" && c.yon === "Alınan") {
        const ciroCari = c.ciroKod ? cH[aksKodN_(c.ciroKod)] : null;
        r2 = ciroCari ? cekSenetDurumGuncelle({ id: r.id, durum: "Ciro Edildi", ciroCariId: ciroCari.id, tarih: c.ciroTarih || c.vade, aciklama: "Akınsoft cirosu" }) : { ok: false, hata: "ciro edilen cari bulunamadı, çek portföyde bırakıldı" };
      }
      Utilities.sleep(6);
      ref.durum = "ok";
      if (r2 && !r2.ok) { ref.durum = "kismi"; ref.mesaj = r2.hata || "Durum işlenemedi"; }
      sonuc.push(ref);
    } catch (e) { hata(e.message); }
  });
  cacheTemizle(["cariListesi_v4", "cekSenetListesi", "bankaYapisi"]);
  return { ok: true, sonuc: sonuc };
}
