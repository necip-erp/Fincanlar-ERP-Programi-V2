// ════════════════════════════════════════════════════════════════════════════
// STOK HAREKET PENCERESİ (Ctrl+A mini ekranı) — bir stoğun ALIŞ (giriş) ve SATIŞ (çıkış)
// hareketleri; isteğe bağlı olarak tek bir cariye göre süzülür. Kaynak: Fatura kalemleri
// (Satış Faturası, Alış Faturası) + İade kalemleri (Alış İadesi çıkış, Satış İadesi giriş).
// Sipariş ve Teklif kalemleri stok hareketi olmadığı için dahil değildir.
// body: { stokKodu, yon: "alis" | "satis", cariId (opsiyonel), limit (varsayılan 150) }
// ════════════════════════════════════════════════════════════════════════════
function getStokHareketPenceresi(body) {
  body = body || {};
  const kod = String(body.stokKodu || "").trim();
  const yon = String(body.yon || "") === "alis" ? "alis" : "satis";
  const cariId = String(body.cariId || "").trim();
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 150, 1), 500);
  if (!kod) return { ok: true, satirlar: [], ozet: shpOzet_([]), yon: yon };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const oku = (ad) => {
    const s = ss.getSheetByName(ad);
    if (!s || s.getLastRow() < 2) return [];
    const v = s.getDataRange().getValues(); v.shift();
    return v.filter(r => r[0]);
  };
  // Belge başlıkları: id → {tarih, cariId, cariAd, belgeTipi}
  const belgeHaritasi = (sheetAdi, belgeTipiKolonu) => {
    const m = {};
    oku(sheetAdi).forEach(r => {
      m[String(r[0])] = { tarih: hucreTarihStr(r[1]), cariId: String(r[2] || ""), cariAd: String(r[3] || ""), belgeTipi: belgeTipiKolonu === null ? "" : String(r[belgeTipiKolonu] || "Fatura") };
    });
    return m;
  };
  const satirlar = [];
  const ekle = (belge, belgeAdi, iade, kalem) => {
    if (!belge) return;
    if (cariId && belge.cariId !== cariId) return;
    const miktar = parseFloat(kalem.miktar) || 0;
    if (miktar <= 0) return;
    const net = parseFloat(kalem.net) || 0;
    satirlar.push({
      tarih: belge.tarih, cariId: belge.cariId, cariAd: belge.cariAd, belgeTipi: belgeAdi, iade: iade,
      yon: (yon === "alis") === !iade ? "giris" : "cikis",
      miktar: miktar, birim: kalem.birim, brutFiyat: parseFloat(kalem.brut) || net, iskontoYuzde: parseFloat(kalem.isk) || 0,
      netFiyat: net, kdvOrani: kalem.kdv === "" || kalem.kdv === undefined ? null : (parseFloat(kalem.kdv) || 0), tutar: miktar * net,
    });
  };

  if (yon === "satis") {
    const belgeler = belgeHaritasi(SHEETS.satislar, 8);
    oku(SHEETS.satisKalemleri).forEach(r => {
      if (String(r[10] || "").trim() !== kod) return;
      const b = belgeler[String(r[1])];
      if (!b || b.belgeTipi !== "Fatura") return; // Sipariş/Teklif stok hareketi değildir
      const brut = parseFloat(r[5]) || 0, isk = parseFloat(r[7]) || 0;
      ekle(b, "Satış Faturası", false, { miktar: r[3], birim: String(r[4] || ""), brut: brut, isk: isk, net: brut * (1 - isk / 100), kdv: r[8] });
    });
    const iadeler = belgeHaritasi(SHEETS.satisIadeler, null);
    oku(SHEETS.satisIadeKalemleri).forEach(r => {
      if (String(r[7] || "").trim() !== kod) return;
      ekle(iadeler[String(r[1])], "Satış İadesi", true, { miktar: r[3], birim: String(r[4] || ""), brut: r[5], isk: 0, net: r[5], kdv: "" });
    });
  } else {
    const belgeler = belgeHaritasi(SHEETS.alislar, null);
    oku(SHEETS.alisKalemleri).forEach(r => {
      if (String(r[7] || "").trim() !== kod) return;
      ekle(belgeler[String(r[1])], "Alış Faturası", false, { miktar: r[3], birim: String(r[4] || ""), brut: r[9], isk: r[10], net: r[5], kdv: r[8] });
    });
    const iadeler = belgeHaritasi(SHEETS.alisIadeler, null);
    oku(SHEETS.alisIadeKalemleri).forEach(r => {
      if (String(r[7] || "").trim() !== kod) return;
      ekle(iadeler[String(r[1])], "Alış İadesi", true, { miktar: r[3], birim: String(r[4] || ""), brut: r[9] || r[5], isk: r[10] || 0, net: r[5], kdv: r[8] });
    });
  }
  satirlar.sort((a, b) => kdZamanSayisi_(b.tarih) - kdZamanSayisi_(a.tarih));
  return { ok: true, yon: yon, toplam: satirlar.length, satirlar: satirlar.slice(0, limit), ozet: shpOzet_(satirlar) };
}

// İade olmayan (gerçek alış/satış) satırlardan özet: son fiyat, ağırlıklı ortalama, en düşük/yüksek, toplam miktar.
function shpOzet_(satirlar) {
  const f = satirlar.filter(s => !s.iade);
  const iade = satirlar.filter(s => s.iade);
  let toplamMiktar = 0, toplamTutar = 0, min = null, max = null;
  f.forEach(s => {
    toplamMiktar += s.miktar; toplamTutar += s.tutar;
    if (s.netFiyat > 0) { min = min === null ? s.netFiyat : Math.min(min, s.netFiyat); max = max === null ? s.netFiyat : Math.max(max, s.netFiyat); }
  });
  return {
    sayi: f.length, iadeSayisi: iade.length, iadeMiktar: iade.reduce((t, s) => t + s.miktar, 0),
    toplamMiktar: toplamMiktar, toplamTutar: toplamTutar,
    sonFiyat: f.length ? f[0].netFiyat : null, sonTarih: f.length ? f[0].tarih : "", sonCari: f.length ? f[0].cariAd : "",
    ortFiyat: toplamMiktar > 0 ? toplamTutar / toplamMiktar : null, enDusuk: min, enYuksek: max,
  };
}
