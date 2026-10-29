// ════════════════════════════════════════════════
// 💼 CARİ DEVİR BAKİYESİ (29 Eki 2026)
// Devir bakiyesi, carinin CariHareketler sayfasında "DEVIR:" ile başlayan açıklamalı TEK bir hareket olarak tutulur
// (Akınsoft'tan gelen "… devri [AKH:D…]" hareketleri de devir sayılır) — böylece bakiye/ekstre/raporlar kendiliğinden doğru çalışır.
// Düzenleme yalnız Admin'dir; her düzeltme "CariDevirDuzeltmeleri" sayfasına (kim, ne zaman, eski → yeni) yazılır
// ve Cari Tanımlama ekranında listelenir.
// ════════════════════════════════════════════════
const CARI_DEVIR_LOG_SAYFA_ = "CariDevirDuzeltmeleri";
const CARI_DEVIR_LOG_BASLIK_ = ["ID", "CARI_ID", "CARI_KODU", "CARI_AD", "TARIH", "KULLANICI", "ESKI_TIP", "ESKI_TUTAR", "YENI_TIP", "YENI_TUTAR"];

function cariDevirHareketiMi_(aciklama) {
  const a = String(aciklama || "");
  return a.indexOf("DEVIR:") === 0 || /devri\s*\[AKH:D/.test(a);
}

// hkData: CariHareketler getValues() (1. satır başlık). Cari için devir hareketini bulur.
function cariDevirBul_(hkData, cariId) {
  for (let i = 1; i < hkData.length; i++) {
    const r = hkData[i];
    if (String(r[1]) !== String(cariId)) continue;
    if (!cariDevirHareketiMi_(r[5])) continue;
    return { satir: i + 1, id: String(r[0]), tarih: hucreTarihStr(r[2]), tip: String(r[3] || ""), tutar: parseFloat(r[4]) || 0 };
  }
  return null;
}

// body: { cariId } → { devir: {tip, tutar, tarih}|null, duzeltmeler: [...son kayıtlar, yeniden eskiye] }
function getCariDevir(body) {
  const cariId = String((body && body.cariId) || "").trim();
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  const ss = acikSS_();
  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID", "CARI_ID", "TARIH", "TIP", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI", "VADE"]);
  const d = cariDevirBul_(hkSheet.getDataRange().getValues(), cariId);
  const logSheet = ss.getSheetByName(CARI_DEVIR_LOG_SAYFA_);
  const duzeltmeler = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    const v = logSheet.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) {
      if (String(v[i][1]) !== cariId) continue;
      duzeltmeler.push(cariDevirLogSatiri_(v[i]));
      if (duzeltmeler.length >= 10) break;
    }
  }
  return { ok: true, devir: d ? { tip: d.tip, tutar: d.tutar, tarih: d.tarih } : null, duzeltmeler: duzeltmeler };
}

function cariDevirLogSatiri_(r) {
  return { cariId: String(r[1]), cariKodu: String(r[2] || ""), cariAd: String(r[3] || ""), tarih: String(r[4] || ""), kullanici: String(r[5] || ""),
    eskiTip: String(r[6] || ""), eskiTutar: parseFloat(r[7]) || 0, yeniTip: String(r[8] || ""), yeniTutar: parseFloat(r[9]) || 0 };
}

// Cari Tanımlama ekranındaki "Devir bakiyesi düzeltmeleri" listesi (herkes görebilir, yalnız okuma).
function getCariDevirDuzeltmeleri() {
  const ss = acikSS_();
  const logSheet = ss.getSheetByName(CARI_DEVIR_LOG_SAYFA_);
  const liste = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    const v = logSheet.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) { liste.push(cariDevirLogSatiri_(v[i])); if (liste.length >= 500) break; }
  }
  return { ok: true, duzeltmeler: liste };
}

// body: { cariId, tip: "Borç"|"Alacak", tutar } — yalnız Admin (ADMIN_ACTIONLAR). tutar 0 = devri kaldır.
function cariDevirKaydet(body, oturum) {
  const cariId = String((body && body.cariId) || "").trim();
  const tip = String((body && body.tip) || "").trim();
  const tutar = Math.round((parseFloat(body && body.tutar) || 0) * 100) / 100;
  if (!cariId) return { ok: false, hata: "cariId gerekli" };
  if (tutar < 0) return { ok: false, hata: "Tutar negatif olamaz (Borç/Alacak seçin)" };
  if (tutar > 0 && tip !== "Borç" && tip !== "Alacak") return { ok: false, hata: "Devir tipi Borç veya Alacak olmalı" };

  const ss = acikSS_();
  const cSheet = getOrCreateSheet(ss, SHEETS.cariHesaplar, ["ID", "TIP", "AD", "TELEFON", "ADRES", "VERGI_NO", "NOT", "TARIH", "CARI_KODU", "ISKONTO_ORANI"]);
  const cData = cSheet.getDataRange().getValues();
  let cari = null;
  for (let i = 1; i < cData.length; i++) if (String(cData[i][0]) === cariId) { cari = { kod: String(cData[i][8] || ""), ad: String(cData[i][2] || "") }; break; }
  if (!cari) return { ok: false, hata: "Cari bulunamadı" };

  const hkSheet = getOrCreateSheet(ss, SHEETS.cariHareketler, ["ID", "CARI_ID", "TARIH", "TIP", "TUTAR", "ACIKLAMA", "KAYIT_TARIHI", "VADE"]);
  ensureCariHareketVadeColonu(hkSheet);
  ensureCariHareketProjeKoduColonu(hkSheet);
  const mevcut = cariDevirBul_(hkSheet.getDataRange().getValues(), cariId);
  const eskiTip = mevcut ? mevcut.tip : "", eskiTutar = mevcut ? mevcut.tutar : 0;
  const yeniTip = tutar > 0 ? tip : "";
  if (eskiTip === yeniTip && Math.abs(eskiTutar - tutar) < 0.005) return { ok: true, degismedi: true };

  if (mevcut) {
    if (tutar <= 0) hkSheet.deleteRow(mevcut.satir);
    else hkSheet.getRange(mevcut.satir, 4, 1, 2).setValues([[tip, tutar]]);
  } else if (tutar > 0) {
    const yil = Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyy");
    const r = cariHareketEkle({ cariId: cariId, tarih: yil + "-01-01", tip: tip, tutar: tutar, aciklama: "DEVIR: Devir bakiyesi" });
    if (!r || !r.ok) return r || { ok: false, hata: "Devir hareketi yazılamadı" };
  }

  const logSheet = getOrCreateSheet(ss, CARI_DEVIR_LOG_SAYFA_, CARI_DEVIR_LOG_BASLIK_);
  logSheet.appendRow(["dv_" + Date.now(), cariId, cari.kod, cari.ad, Utilities.formatDate(new Date(), "Europe/Istanbul", "dd/MM/yyyy HH:mm"),
    String((oturum && oturum.kullaniciAdi) || "Admin"), eskiTip, eskiTutar, yeniTip, tutar]);
  cacheTemizle(["cariListesi_v4"]);
  return { ok: true };
}
