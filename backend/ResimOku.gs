// ════════════════════════════════════════════════
// 📷 RESİMDEN SİPARİŞ / TEKLİF / FATURA OKUMA (17 Eki 2026)
// Fotoğraf ya da ekran görüntüsündeki sipariş formu, teklif, fatura, liste vb. belgeyi okuyup düzenli veriye çevirir.
// Cari ve stok kartı EŞLEŞTİRMESİ burada yapılmaz; tarayıcıda (index.html > resimOku*) mevcut cari/stok listeleriyle yapılır,
// kullanıcı onay ekranında kontrol eder. Bu dosya yalnızca "resmi oku" kısmıdır ve hiçbir kayıt yazmaz.
//
// Ayarlar (Script Properties — yerel sunucuda da kalıcıdır):
//   RESIM_OKU_API_ANAHTARI → Claude API anahtarı (console.anthropic.com). Yalnız Admin kaydeder; istemciye ASLA geri gönderilmez.
//   RESIM_OKU_MODEL        → (isteğe bağlı) model adı, boşsa varsayılan
//   RESIM_OKU_MOTOR        → şimdilik yalnız "claude"
// ════════════════════════════════════════════════

const RESIM_OKU_VARSAYILAN_MODEL_ = "claude-sonnet-5-5";
const RESIM_OKU_MAX_BASE64_ = 9 * 1024 * 1024; // ~6.7 MB resim; tarayıcı zaten küçültüp gönderir

function resimOkuAyarlari_() {
  const p = PropertiesService.getScriptProperties();
  return {
    anahtar: (p.getProperty("RESIM_OKU_API_ANAHTARI") || "").trim(),
    model: (p.getProperty("RESIM_OKU_MODEL") || "").trim() || RESIM_OKU_VARSAYILAN_MODEL_,
    motor: (p.getProperty("RESIM_OKU_MOTOR") || "").trim() || "claude",
  };
}

// Anahtarın kendisi dönmez; yalnız var mı + son 4 hane.
function getResimOkuAyar() {
  const a = resimOkuAyarlari_();
  return {
    ok: true,
    anahtarVar: !!a.anahtar,
    anahtarSonu: a.anahtar ? a.anahtar.slice(-4) : "",
    model: a.model,
    motor: a.motor,
  };
}

// body: { anahtar?: "sk-ant-...", model?: "..." , anahtarSil?: true } — yalnız Admin (ADMIN_ACTIONLAR)
function resimOkuAyarKaydet(body) {
  const p = PropertiesService.getScriptProperties();
  if (body && body.anahtarSil) p.setProperty("RESIM_OKU_API_ANAHTARI", "");
  const anahtar = String((body && body.anahtar) || "").trim();
  if (anahtar) {
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(anahtar)) return { ok: false, hata: "Anahtar 'sk-ant-' ile başlamalı; boşluk/satır sonu olmadan yapıştırın." };
    p.setProperty("RESIM_OKU_API_ANAHTARI", anahtar);
  }
  if (body && body.model !== undefined) p.setProperty("RESIM_OKU_MODEL", String(body.model || "").trim());
  return getResimOkuAyar();
}

function resimOkuIstemi_(ipucu) {
  return [
    "Bu görüntü bir Türk ticari belgesidir (sipariş formu, teklif, irsaliye, fatura, fiyat/ürün listesi, WhatsApp/ekran görüntüsü olabilir).",
    "Görüntü yan/ters çevrilmiş, eğik ya da telefonla çekilmiş olabilir; doğru yönde oku.",
    "Yalnızca görüntüde gerçekten yazan bilgiyi çıkar. Okuyamadığın ya da yazmayan alanı null bırak, ASLA tahmin edip uydurma.",
    "Sayıları Türkçe biçimiyle yorumla (1.234,56 = binlik nokta, ondalık virgül) ve JSON'da nokta ondalıklı sayı olarak ver (1234.56).",
    "Stok kodları çoğunlukla 12 haneli rakamdır; satır başında 'KODU' sütununda olur. Rakamları birebir, boşluksuz yaz. Emin olamadığın hane varsa kalemin 'uyari' alanına yaz.",
    "Her kalem için miktar birimi (M2, KT, AD, KG, TOP vb.) ve varsa ikinci miktarı (Miktar 2) ayrı ver.",
    "Toplam satırlarını (brüt, iskonto, ara toplam, KDV, genel toplam) kalem olarak EKLEME; yalnız toplamlar alanına yaz.",
    ipucu ? ("Kullanıcının notu: " + ipucu) : "",
    "",
    "SADECE aşağıdaki biçimde geçerli bir JSON nesnesi döndür; başka hiçbir metin, açıklama ya da kod bloğu işareti yazma:",
    '{"belgeTipi": "Sipariş|Teklif|Fatura|İrsaliye|Liste|Diğer|null",',
    ' "belgeNo": null, "tarih": "gg.aa.yyyy veya null", "vadeGunu": null,',
    ' "cari": {"kod": null, "ad": null, "telefon": null, "vergiNo": null, "adres": null},',
    ' "kalemler": [{"stokKodu": null, "urunAdi": "", "miktar": 0, "birim": "M2|AD|KT|KG|...", "miktar2": null, "birim2": null, "birimFiyat": null, "iskontoYuzde": null, "kdvYuzde": null, "tutar": null, "uyari": null}],',
    ' "toplamlar": {"brut": null, "iskonto": null, "araToplam": null, "kdv": null, "genelToplam": null},',
    ' "okumaNotu": "okunamayan/şüpheli yerler varsa kısa Türkçe not, yoksa null"}',
  ].filter(function (s) { return s !== ""; }).join("\n");
}

// body: { gorsel: "<base64, data: öneki olmadan>", mime: "image/jpeg|image/png|image/webp", ipucu?: "..." }
function getResimOku(body) {
  const ayar = resimOkuAyarlari_();
  if (ayar.motor !== "claude") return { ok: false, hata: "Okuma motoru tanımsız: " + ayar.motor };
  if (!ayar.anahtar) return { ok: false, anahtarYok: true, hata: "Resim okuma için Claude API anahtarı tanımlı değil (Admin: 📷 Resimden Oluştur penceresinde ⚙ Okuma Ayarı)." };
  const b64 = String((body && body.gorsel) || "");
  const mime = String((body && body.mime) || "image/jpeg").toLowerCase();
  if (!b64) return { ok: false, hata: "Görsel gelmedi." };
  if (b64.length > RESIM_OKU_MAX_BASE64_) return { ok: false, hata: "Görsel çok büyük; daha küçük çekim/ekran görüntüsü deneyin." };
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(mime) < 0) return { ok: false, hata: "Desteklenmeyen görsel türü: " + mime };

  const istek = {
    model: ayar.model,
    max_tokens: 6000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
        { type: "text", text: resimOkuIstemi_(String((body && body.ipucu) || "").slice(0, 300)) },
      ],
    }],
  };
  let yanit, kod, metin;
  try {
    yanit = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": ayar.anahtar, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify(istek),
      muteHttpExceptions: true,
    });
    kod = yanit.getResponseCode();
    metin = yanit.getContentText();
  } catch (e) {
    return { ok: false, hata: "Okuma servisine ulaşılamadı: " + e.message };
  }
  let j;
  try { j = JSON.parse(metin); } catch (e) { return { ok: false, hata: "Okuma servisi geçersiz yanıt verdi (HTTP " + kod + ")." }; }
  if (kod !== 200) {
    const m = (j && j.error && j.error.message) ? String(j.error.message) : ("HTTP " + kod);
    if (kod === 401) return { ok: false, hata: "API anahtarı geçersiz ya da iptal edilmiş. Anahtarı yeniden girin." };
    if (kod === 402 || /credit|billing/i.test(m)) return { ok: false, hata: "API hesabında bakiye/ödeme sorunu: " + m };
    if (kod === 429) return { ok: false, hata: "Okuma servisi şu an yoğun/limit aşıldı; biraz sonra tekrar deneyin." };
    return { ok: false, hata: "Okuma hatası: " + m };
  }
  const parcalar = (j.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; });
  let ham = parcalar.join("\n").trim();
  ham = ham.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const bas = ham.indexOf("{"), son = ham.lastIndexOf("}");
  if (bas < 0 || son <= bas) return { ok: false, hata: "Belge okunamadı (yanıt JSON değil). Daha net bir görüntü deneyin." };
  let veri;
  try { veri = JSON.parse(ham.slice(bas, son + 1)); } catch (e) { return { ok: false, hata: "Okunan veri çözümlenemedi; görüntüyü yeniden deneyin." }; }
  if (!Array.isArray(veri.kalemler)) veri.kalemler = [];
  return { ok: true, veri: veri, model: ayar.model, kesildi: j.stop_reason === "max_tokens" };
}
