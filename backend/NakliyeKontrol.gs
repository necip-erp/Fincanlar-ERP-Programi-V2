// ════════════════════════════════════════════════════════════════════════════
// NAKLİYE DAĞITIMI KONTROLÜ (21 Eyl 2026)
// fatura-okuma-otomasyonu, faturadaki nakliye/palet bedelini sadece "m² ürünü" sayılan kalemlere (stok kodu 33/66 +
// belirli ölçüler) toplam m²'ye göre böler ve FATURAFIYAT.NAKLIYE_PAYI sütununa yazar. Bir faturada nakliye payı
// dağıtılmış (>0) olduğu HÂLDE m² kuralına uyan başka bir kalem pay almamışsa (örn. CNY2026000002602: 20x90 ve 30x75
// ürünler hiç pay almadı, tüm nakliye tek ürüne yüklendi) fatura "tutarsız" sayılır.
//   • nakliyeSorunluFaturalar        → (Admin) sorunlu faturaları LİSTELER, hiçbir şey değiştirmez.
//   • nakliyeSorunluFaturalariSil    → (Admin) bulunanları siler: Onaylanmışsa bağlı Alış kaydı (Silinenler'e, geri alınabilir),
//                                       durum kaydı ve FATURAFIYAT satırları. Bekleyen faturalar listeden kalkar.
//   • nkSupheliAlisHaritasi_         → Kayıt Defteri'nde ünlem (❗) göstermek için: onaylanmış + tutarsız faturaların Alış ID'leri.
// UYARI: m² kuralı fatura-okuma-otomasyonu/Kod.js içindeki isM2Urunu() ile AYNI olmalı (kural değişirse ikisi birlikte).
// ════════════════════════════════════════════════════════════════════════════

function nkM2Urunu_(stokKodu, adUpper) {
  const kod = String(stokKodu || "").trim();
  const m = String(adUpper || "").match(/(\d{1,3}(?:,\d)?)\s*X\s*(\d{1,3}(?:,\d)?)/);
  if (!m) return false;
  const en = parseFloat(m[1].replace(",", "."));
  const boy = parseFloat(m[2].replace(",", "."));
  const yak = (a, b) => Math.abs(a - b) < 0.01;
  if (kod.indexOf("33") === 0) {
    if (yak(en, 42.5) && yak(boy, 42.5)) return true;
    if (yak(en, 45) && yak(boy, 45)) return true;
    if (en >= 58 && en <= 62 && boy >= 58 && boy <= 62) return true;
    if (yak(en, 60) && yak(boy, 120)) return true;
    if ((yak(en, 20) && yak(boy, 90)) || (yak(en, 90) && yak(boy, 20))) return true;
    if ((yak(en, 30) && yak(boy, 75)) || (yak(en, 75) && yak(boy, 30))) return true;
    return false;
  }
  if (kod.indexOf("66") === 0) return yak(en, 50) && yak(boy, 50);
  return false;
}

// FATURAFIYAT'ı fatura no bazında tarar. {ok, faturalar:[{faturaNo, tedarikci, satirlar:[1-tabanlı satır no], toplamNakliye,
// sorunluKalemler:[{kod, ad, miktar}], durum, alisId, alisVar}]}
function nkSorunluFaturalariBul_() {
  let disSh;
  try {
    disSh = SpreadsheetApp.openById(DIS_FIYAT_SHEET_ID).getSheetByName(DIS_FIYAT_SHEET_ADI);
  } catch (e) { return { ok: false, hata: "Fatura kaynağına erişilemedi: " + e.message }; }
  if (!disSh) return { ok: false, hata: "FATURAFIYAT sayfası bulunamadı" };
  if (disSh.getLastRow() < 2) return { ok: true, faturalar: [] };
  const veri = disSh.getDataRange().getValues();
  const h = veri[0];
  const c = { kod: h.indexOf("STOK_KODU"), ad: h.indexOf("STOK_ADI"), mik: h.indexOf("MIKTAR"), nak: h.indexOf("NAKLIYE_PAYI"),
              fno: h.indexOf("FATURA_NO"), ted: h.indexOf("TEDARIKCI") };
  if (c.kod < 0 || c.ad < 0 || c.nak < 0 || c.fno < 0) return { ok: false, hata: "FATURAFIYAT sütunları bulunamadı" };

  const gruplar = {};
  for (let i = 1; i < veri.length; i++) {
    const fno = String(veri[i][c.fno] || "").trim();
    if (!fno) continue;
    (gruplar[fno] = gruplar[fno] || []).push({ sat: i + 1, r: veri[i] });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const durumMap = {};
  const durumData = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR).getDataRange().getValues();
  for (let i = 1; i < durumData.length; i++) {
    const f = String(durumData[i][0] || "").trim();
    if (f) durumMap[f] = { durum: String(durumData[i][1] || ""), alisId: String(durumData[i][2] || "") };
  }
  const alisIdSeti = {};
  kdSayfaOku_(ss, SHEETS.alislar).forEach(r => { alisIdSeti[String(r[0])] = true; });

  const faturalar = [];
  Object.keys(gruplar).forEach(fno => {
    const satirlar = gruplar[fno];
    let toplamNakliye = 0;
    satirlar.forEach(x => {
      const mik = c.mik >= 0 ? (parseFloat(x.r[c.mik]) || 0) : 1;
      toplamNakliye += (parseFloat(x.r[c.nak]) || 0) * (mik > 0 ? mik : 0);
    });
    if (toplamNakliye < 0.005) return; // nakliye dağıtılmamış fatura: kontrol edilemez
    const sorunlu = [];
    satirlar.forEach(x => {
      const mik = c.mik >= 0 ? (parseFloat(x.r[c.mik]) || 0) : 1;
      const nak = parseFloat(x.r[c.nak]) || 0;
      if (mik > 0 && nak <= 0 && nkM2Urunu_(x.r[c.kod], String(x.r[c.ad] || "").toUpperCase())) {
        sorunlu.push({ kod: String(x.r[c.kod] || "").trim(), ad: String(x.r[c.ad] || ""), miktar: mik });
      }
    });
    if (!sorunlu.length) return;
    const d = durumMap[fno] || { durum: "Bekliyor", alisId: "" };
    faturalar.push({
      faturaNo: fno, tedarikci: c.ted >= 0 ? String(satirlar[0].r[c.ted] || "") : "",
      satirlar: satirlar.map(x => x.sat), toplamNakliye: Math.round(toplamNakliye * 100) / 100,
      sorunluKalemler: sorunlu, durum: d.durum, alisId: d.alisId, alisVar: !!(d.alisId && alisIdSeti[d.alisId]),
    });
  });
  return { ok: true, faturalar: faturalar };
}

// Sadece listeler (Ayarlar > Nakliye Dağıtımı Kontrolü).
function nakliyeSorunluFaturalar() {
  const b = nkSorunluFaturalariBul_();
  if (!b.ok) return b;
  return { ok: true, faturalar: b.faturalar.map(f => ({
    faturaNo: f.faturaNo, tedarikci: f.tedarikci, kalemSayisi: f.satirlar.length, toplamNakliye: f.toplamNakliye,
    sorunluKalemler: f.sorunluKalemler, durum: f.durum, alisId: f.alisId, alisVar: f.alisVar })) };
}

// body: { faturaNolar?: [..] }  (verilmezse bulunan TÜM sorunlu faturalar). Silme sırası: Alış (varsa) → durum kaydı → FATURAFIYAT satırları.
function nakliyeSorunluFaturalariSil(body) {
  body = body || {};
  const b = nkSorunluFaturalariBul_();
  if (!b.ok) return b;
  const secili = Array.isArray(body.faturaNolar) ? new Set(body.faturaNolar.map(x => String(x).trim())) : null;
  const hedefler = b.faturalar.filter(f => !secili || secili.has(f.faturaNo));
  const sonuc = { ok: true, silinenFatura: 0, silinenAlis: 0, atlanan: [] };
  if (!hedefler.length) return sonuc;

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const silinecekSatirlar = [];
  const durumSilinecek = new Set();
  hedefler.forEach(f => {
    if (f.durum === "Onaylandı" && f.alisId && f.alisVar) {
      const r = silAlis({ id: f.alisId }); // Silinenler'e düşer (geri alınabilir); stok/cari hareketleri geri alınır
      if (!r || r.ok === false || r.error) { sonuc.atlanan.push({ faturaNo: f.faturaNo, neden: "Alış silinemedi: " + ((r && (r.hata || r.error)) || "bilinmiyor") }); return; }
      try { kdIsle_("silAlis", { id: f.alisId }, { ok: true }, null); } catch (e) { logError(e); } // Kayıt Defteri'nde "Silindi"
      sonuc.silinenAlis++;
    }
    durumSilinecek.add(f.faturaNo);
    f.satirlar.forEach(s => silinecekSatirlar.push(s));
    sonuc.silinenFatura++;
  });

  // Durum kayıtları (aşağıdan yukarı)
  const durumSheet = getOrCreateSheet(ss, SHEETS.alisFaturaDurum, ALIS_FATURA_DURUM_BASLIKLAR);
  const durumData = durumSheet.getDataRange().getValues();
  for (let i = durumData.length - 1; i >= 1; i--) if (durumSilinecek.has(String(durumData[i][0] || "").trim())) durumSheet.deleteRow(i + 1);
  // FATURAFIYAT satırları (aşağıdan yukarı)
  const disSh = SpreadsheetApp.openById(DIS_FIYAT_SHEET_ID).getSheetByName(DIS_FIYAT_SHEET_ADI);
  silinecekSatirlar.sort((a, b2) => b2 - a).forEach(s => disSh.deleteRow(s));

  cacheTemizle(["bekleyenAlisFaturalari", "alisListesi", "cariListesi_v3", "stokTanimListesi", "stokGuncelMiktarHaritasi",
                "stokHareketListesi", "stokPanelSnapshot", "silinenlerListesi", "bugunOzet", "finansOzet", "nakliyeSupheliAlislar"]);
  return sonuc;
}

// Kayıt Defteri ünlemi için: { alisId: {faturaNo, not} } — yalnızca ONAYLANMIŞ + tutarsız faturalar. 2 dk önbellekli.
function nkSupheliAlisHaritasi_() {
  const s = cacheOkuVeyaHesapla("nakliyeSupheliAlislar", 120, function () {
    const b = nkSorunluFaturalariBul_();
    if (!b.ok) return { ok: false, hata: b.hata };
    const harita = {};
    b.faturalar.forEach(f => {
      if (f.durum === "Onaylandı" && f.alisId) {
        harita[f.alisId] = { faturaNo: f.faturaNo,
          not: "Nakliye dağıtımı tutarsız (" + f.faturaNo + "): " + f.sorunluKalemler.map(k => k.kod + " " + k.ad).slice(0, 3).join(", ") + " nakliye payı almamış" };
      }
    });
    return { ok: true, harita: harita };
  });
  return (s && s.ok) ? s.harita : {};
}
