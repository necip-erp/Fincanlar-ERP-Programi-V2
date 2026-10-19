// ════════════════════════════════════════════════
// ⚡ HIZLI SATIŞ DÜZENİ (ALT / ARA GRUPLAR) — SUNUCUDA ORTAK (19 Eki 2026)
// Alt grup, ara grup, ürün-alt grup eşleşmesi, kısayollar (uye), sütun sırası ve ürün sırası daha önce yalnız tarayıcıda (localStorage hs_ayar)
// tutuluyordu; bu yüzden başka tarayıcıda / yerel sunucuda görünmüyordu. Artık bu "yapı" sunucuda tek yerde durur; boyut/yükseklik/renk gibi
// kasa-bilgisayar başına ayarlar tarayıcıda kalır (bkz. index.html hsYapi*).
// Saklama: Script Properties, 8000 karakterlik parçalar (HS_YAPI_0..n, HS_YAPI_N = parça sayısı). Yerel sunucuda boşsa buluttaki düzen
// (yerelDisFatura "hsYapi" köprüsüyle) bir kez alınır ve yerele yazılır.
// ════════════════════════════════════════════════
const HS_YAPI_PARCA_ = 8000, HS_YAPI_EN_FAZLA_ = 400000;

function hsYapiOku_() {
  const p = PropertiesService.getScriptProperties();
  const n = parseInt(p.getProperty("HS_YAPI_N") || "0", 10) || 0;
  if (!n) return null;
  let metin = "";
  for (let i = 0; i < n; i++) metin += (p.getProperty("HS_YAPI_" + i) || "");
  try { const o = JSON.parse(metin); return (o && typeof o === "object") ? o : null; } catch (e) { return null; }
}

function hsYapiBos_(y) {
  if (!y || !y.yapi || typeof y.yapi !== "object") return true;
  return !Object.keys(y.yapi).some(function (k) {
    const v = y.yapi[k];
    return Array.isArray(v) ? v.length > 0 : (v && typeof v === "object" ? Object.keys(v).length > 0 : !!v);
  });
}

// → { ok, yapi, ts, buluttan? }
function getHsYapi() {
  let y = hsYapiOku_();
  if (hsYapiBos_(y) && typeof yerelMi_ === "function" && yerelMi_()) {
    const d = (typeof YerelDisVeri !== "undefined" && YerelDisVeri) ? YerelDisVeri : null;
    const b = d && d.hsYapi;
    if (b && !hsYapiBos_(b)) return { ok: true, yapi: b.yapi, ts: b.ts || 0, buluttan: true };
  }
  if (!y) return { ok: true, yapi: null, ts: 0 };
  return { ok: true, yapi: y.yapi || null, ts: y.ts || 0 };
}

// body: { yapi: {...}, ts?: ms } — ts verilmezse şimdi
function hsYapiKaydet(body) {
  body = body || {};
  if (!body.yapi || typeof body.yapi !== "object") return { ok: false, hata: "Düzen verisi yok" };
  const ts = Number(body.ts) > 0 ? Number(body.ts) : Date.now();
  const metin = JSON.stringify({ ts: ts, yapi: body.yapi });
  if (metin.length > HS_YAPI_EN_FAZLA_) return { ok: false, hata: "Hızlı Satış düzeni çok büyük (" + Math.round(metin.length / 1000) + " KB)" };
  const p = PropertiesService.getScriptProperties();
  const eskiN = parseInt(p.getProperty("HS_YAPI_N") || "0", 10) || 0;
  const n = Math.ceil(metin.length / HS_YAPI_PARCA_);
  for (let i = 0; i < n; i++) p.setProperty("HS_YAPI_" + i, metin.substr(i * HS_YAPI_PARCA_, HS_YAPI_PARCA_));
  p.setProperty("HS_YAPI_N", String(n));
  for (let i = n; i < eskiN; i++) p.deleteProperty("HS_YAPI_" + i);
  return { ok: true, ts: ts };
}
