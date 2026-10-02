// ════════════════════════════════════════════════════════════════════════════
// GÜNSONU Z RAPORU — Seçilen gün için işlem TARİHİNE göre tüm kalemleri (satış, alış,
// iade, tahsilat/ödeme yöntemleri, kasa, banka, POS) tek bir "kalem kataloğu" olarak döndürür.
// Hangi kalemlerin görüneceği, sırası ve sütun düzeni FRONTEND'de kullanıcı tarafından
// ayarlanır (Rapor > Z Raporu > ⚙ Düzeni Ayarla); backend her zaman tüm kataloğu üretir.
// Salt okunur: hiçbir sayfaya yazmaz, sayfa yoksa oluşturmaz.
// ════════════════════════════════════════════════════════════════════════════

function zSayfaVeri_(ss, ad) {
  try {
    const sh = ss.getSheetByName(ad);
    if (!sh) return [];
    return sh.getDataRange().getValues();
  } catch (e) { return []; }
}

function zRaporuGetir(body) {
  const gun = String((body && body.gun) || Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy-MM-dd")).slice(0, 10);
  const ss = acikSS_();
  const gunMu = function (deger) { return String(hucreTarihStr(deger) || "").slice(0, 10) === gun; };
  const para = function (v) { return Math.round((parseFloat(v) || 0) * 100) / 100; };

  // katalog: id → {id, bolum, ad, adet, tutar}; eklenme sırası = varsayılan sıra
  const katalog = {};
  const sira = [];
  const kalem = function (id, bolum, ad) {
    if (!katalog[id]) { katalog[id] = { id: id, bolum: bolum, ad: ad, adet: 0, tutar: 0 }; sira.push(id); }
    return katalog[id];
  };
  const topla = function (k, tutar) { k.adet += 1; k.tutar = para(k.tutar + (parseFloat(tutar) || 0)); };

  // ── Varsayılan kalem tanımları (gün içinde hiç işlem olmasa da kullanıcı seçebilsin) ──
  kalem("satisToplam", "Satış", "Satış Faturaları (Toplam)");
  ["Nakit", "Peşin", "Kredi Kartı"].forEach(function (t) { kalem("satisOdeme:" + t, "Satış", "Satış — " + t); });
  kalem("satisIade", "Satış", "Satış İadeleri");
  kalem("alisToplam", "Alış", "Alış Faturaları (Toplam)");
  kalem("alisIade", "Alış", "Alış İadeleri");
  ["Nakit", "Kredi Kartı", "Havale", "Çek"].forEach(function (y) { kalem("tahsilat:" + y, "Tahsilat", "Tahsilat — " + y); });
  kalem("tahsilatToplam", "Tahsilat", "Tahsilatlar (Toplam)");
  ["Nakit", "Kredi Kartı", "Havale", "Çek"].forEach(function (y) { kalem("odeme:" + y, "Ödeme", "Ödeme — " + y); });
  kalem("odemeToplam", "Ödeme", "Ödemeler (Toplam)");
  kalem("odemeGider", "Ödeme", "Masraf / Gider Ödemeleri");
  kalem("kasaDevir", "Kasa (Nakit)", "Kasa Devir");
  kalem("kasaGiris", "Kasa (Nakit)", "Nakit Giriş");
  kalem("kasaCikis", "Kasa (Nakit)", "Nakit Çıkış");
  kalem("kasaGunSonu", "Kasa (Nakit)", "Kasa Gün Sonu Bakiyesi");
  kalem("bankaGiris", "Banka", "Banka Hesapları — Giriş");
  kalem("bankaCikis", "Banka", "Banka Hesapları — Çıkış");
  kalem("posGiris", "POS", "POS — Giriş");
  kalem("posCikis", "POS", "POS — Çıkış / Aktarım");

  // ── Satış faturaları ──
  const sData = zSayfaVeri_(ss, SHEETS.satislar);
  for (let i = 1; i < sData.length; i++) {
    const r = sData[i];
    if (!r[0] || !gunMu(r[1])) continue;
    if ((String(r[8] || "") || "Fatura") !== "Fatura") continue;
    topla(kalem("satisToplam", "Satış", "Satış Faturaları (Toplam)"), r[4]);
    const tip = String(r[5] || "").trim() || "Peşin";
    topla(kalem("satisOdeme:" + tip, "Satış", "Satış — " + tip), r[4]);
  }
  // ── İadeler ──
  const siData = zSayfaVeri_(ss, SHEETS.satisIadeler);
  for (let i = 1; i < siData.length; i++) if (siData[i][0] && gunMu(siData[i][1])) topla(katalog["satisIade"], siData[i][4]);
  const aiData = zSayfaVeri_(ss, SHEETS.alisIadeler);
  for (let i = 1; i < aiData.length; i++) if (aiData[i][0] && gunMu(aiData[i][1])) topla(katalog["alisIade"], aiData[i][4]);
  // ── Alış faturaları ──
  const aData = zSayfaVeri_(ss, SHEETS.alislar);
  for (let i = 1; i < aData.length; i++) {
    const r = aData[i];
    if (!r[0] || !gunMu(r[1])) continue;
    topla(katalog["alisToplam"], r[4]);
  }
  // ── Tahsilatlar ──
  const tData = zSayfaVeri_(ss, SHEETS.tahsilatlar);
  for (let i = 1; i < tData.length; i++) {
    const r = tData[i];
    if (!r[0] || !gunMu(r[1])) continue;
    const y = String(r[5] || "").trim() || "Diğer";
    topla(katalog["tahsilatToplam"], r[4]);
    topla(kalem("tahsilat:" + y, "Tahsilat", "Tahsilat — " + y), r[4]);
  }
  // ── Ödemeler ──
  const oData = zSayfaVeri_(ss, SHEETS.odemeler);
  for (let i = 1; i < oData.length; i++) {
    const r = oData[i];
    if (!r[0] || !gunMu(r[1])) continue;
    const y = String(r[5] || "").trim() || "Diğer";
    topla(katalog["odemeToplam"], r[4]);
    topla(kalem("odeme:" + y, "Ödeme", "Ödeme — " + y), r[4]);
    if ((String(r[10] || "") || "Cari") === "Gider") topla(katalog["odemeGider"], r[4]);
  }
  // ── Kasa (nakit) — Kasa Raporu'yla birebir aynı hesap ──
  try {
    const ham = kasaNakitHamListesiOku(ss);
    const devir = kasaAgregatOlustur(ham, "", birGunOncesi(gun)).bakiye;
    const g = kasaAgregatOlustur(ham, gun, gun);
    katalog["kasaDevir"].tutar = para(devir);
    katalog["kasaGiris"].tutar = para(g.toplamGiris);
    katalog["kasaCikis"].tutar = para(g.toplamCikis);
    katalog["kasaGunSonu"].tutar = para(devir + g.toplamGiris - g.toplamCikis);
    g.satirlar.forEach(function (h) { katalog[h.yon === "Giriş" ? "kasaGiris" : "kasaCikis"].adet += 1; });
  } catch (e) { /* kasa okunamazsa rapor yine de gelsin */ }
  // ── Banka hesap hareketleri ve POS hareketleri ──
  const hareketTopla = function (veri, girisId, cikisId) {
    for (let i = 1; i < veri.length; i++) {
      const r = veri[i];
      if (!r[0] || !gunMu(r[2])) continue;
      topla(katalog[String(r[3] || "") === "Giriş" ? girisId : cikisId], r[4]);
    }
  };
  hareketTopla(zSayfaVeri_(ss, SHEETS.bankaHesapHareketleri), "bankaGiris", "bankaCikis");
  hareketTopla(zSayfaVeri_(ss, SHEETS.posHareketleri), "posGiris", "posCikis");

  return { ok: true, gun: gun, katalog: sira.map(function (id) { return katalog[id]; }) };
}
