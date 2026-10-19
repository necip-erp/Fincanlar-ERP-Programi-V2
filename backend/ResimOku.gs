// ════════════════════════════════════════════════
// 📷 RESİMDEN SİPARİŞ / TEKLİF / FATURA OKUMA (17 Eki 2026)
// Fotoğraf ya da ekran görüntüsündeki sipariş formu, teklif, fatura, liste vb. belgeyi okuyup düzenli veriye çevirir.
// Cari ve stok kartı EŞLEŞTİRMESİ burada yapılmaz; tarayıcıda (index.html > resimOku*) mevcut cari/stok listeleriyle yapılır,
// kullanıcı onay ekranında kontrol eder. Bu dosya yalnızca "resmi oku" kısmıdır ve hiçbir kayıt yazmaz.
//
// Ayarlar (Script Properties — yerel sunucuda da kalıcıdır):
//   RESIM_OKU_MOTOR              → "gemini" (ücretsiz katman var) ya da "claude" (ücretli). Boşsa: Gemini anahtarı varsa gemini, yoksa claude.
//   RESIM_OKU_GEMINI_ANAHTARI    → Google AI Studio API anahtarı (AIza...). Yalnız Admin kaydeder; istemciye ASLA geri gönderilmez.
//   RESIM_OKU_GEMINI_MODEL       → (isteğe bağlı) boşsa varsayılan
//   RESIM_OKU_API_ANAHTARI       → Claude API anahtarı (console.anthropic.com), RESIM_OKU_MODEL → Claude model adı
// UYARI: Gemini ÜCRETSİZ katmanında gönderilen içerik Google tarafından ürün geliştirmede kullanılabilir (Google fiyat/şart sayfasında "Used to improve our products: Yes");
// ücretli katmanda kullanılmaz. Cari adı/telefon/fiyat bilgisi gönderildiğinden bu bilinerek seçilmelidir.
// ════════════════════════════════════════════════

const RESIM_OKU_VARSAYILAN_MODEL_ = "claude-sonnet-5-5";
const RESIM_OKU_GEMINI_VARSAYILAN_MODEL_ = "gemini-3.6-flash";   // Google'ın kararlı (preview olmayan) çok kipli Flash modeli; ücretsiz katmanı var
const RESIM_OKU_MAX_BASE64_ = 9 * 1024 * 1024; // ~6.7 MB resim; tarayıcı zaten küçültüp gönderir

function resimOkuAyarlari_() {
  const p = PropertiesService.getScriptProperties();
  let claudeAnahtar = (p.getProperty("RESIM_OKU_API_ANAHTARI") || "").trim();
  let geminiAnahtar = (p.getProperty("RESIM_OKU_GEMINI_ANAHTARI") || "").trim();
  let motor = (p.getProperty("RESIM_OKU_MOTOR") || "").trim();
  let claudeModel = (p.getProperty("RESIM_OKU_MODEL") || "").trim();
  let geminiModel = (p.getProperty("RESIM_OKU_GEMINI_MODEL") || "").trim();
  // ★ 19 Eki 2026: yerel sunucuda boş kalan alanlar buluttaki ayardan tamamlanır (yerelde ayrıca girilen değer öncelikli).
  let buluttan = false;
  if (typeof yerelMi_ === "function" && yerelMi_()) {
    const d = (typeof YerelDisVeri !== "undefined" && YerelDisVeri) ? YerelDisVeri : null;
    const b = d && d.resimOku;
    if (b) {
      if (!claudeAnahtar && b.claudeAnahtar) { claudeAnahtar = b.claudeAnahtar; buluttan = true; }
      if (!geminiAnahtar && b.geminiAnahtar) { geminiAnahtar = b.geminiAnahtar; buluttan = true; }
      if (!motor && b.motor) motor = b.motor;
      if (!claudeModel && b.claudeModel) claudeModel = b.claudeModel;
      if (!geminiModel && b.geminiModel) geminiModel = b.geminiModel;
    }
  }
  if (motor !== "gemini" && motor !== "claude") motor = geminiAnahtar ? "gemini" : "claude";
  return {
    motor: motor,
    claudeAnahtar: claudeAnahtar,
    claudeModel: claudeModel || RESIM_OKU_VARSAYILAN_MODEL_,
    geminiAnahtar: geminiAnahtar,
    geminiModel: geminiModel || RESIM_OKU_GEMINI_VARSAYILAN_MODEL_,
    buluttan: buluttan,
  };
}

// Anahtarların kendisi dönmez; yalnız var mı + son 4 hane. anahtarVar/model = SEÇİLİ motor için.
function getResimOkuAyar() {
  const a = resimOkuAyarlari_();
  const sec = a.motor === "gemini" ? { anahtar: a.geminiAnahtar, model: a.geminiModel } : { anahtar: a.claudeAnahtar, model: a.claudeModel };
  return {
    ok: true,
    motor: a.motor,
    anahtarVar: !!sec.anahtar,
    anahtarSonu: sec.anahtar ? sec.anahtar.slice(-4) : "",
    model: sec.model,
    claudeVar: !!a.claudeAnahtar, claudeSonu: a.claudeAnahtar ? a.claudeAnahtar.slice(-4) : "", claudeModel: a.claudeModel,
    geminiVar: !!a.geminiAnahtar, geminiSonu: a.geminiAnahtar ? a.geminiAnahtar.slice(-4) : "", geminiModel: a.geminiModel,
    buluttan: !!a.buluttan,
  };
}

// body: { motor?: "gemini"|"claude", geminiAnahtar?, geminiModel?, anahtar? (Claude), model? (Claude), anahtarSil?: "gemini"|"claude" } — yalnız Admin (ADMIN_ACTIONLAR)
function resimOkuAyarKaydet(body) {
  const p = PropertiesService.getScriptProperties();
  body = body || {};
  if (body.anahtarSil === "claude" || body.anahtarSil === true) p.setProperty("RESIM_OKU_API_ANAHTARI", "");
  if (body.anahtarSil === "gemini") p.setProperty("RESIM_OKU_GEMINI_ANAHTARI", "");
  const claude = String(body.anahtar || "").trim();
  if (claude) {
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(claude)) return { ok: false, hata: "Claude anahtarı 'sk-ant-' ile başlamalı; boşluk/satır sonu olmadan yapıştırın." };
    p.setProperty("RESIM_OKU_API_ANAHTARI", claude);
  }
  const gemini = String(body.geminiAnahtar || "").trim();
  if (gemini) {
    if (!/^[A-Za-z0-9_\-.]{20,}$/.test(gemini)) return { ok: false, hata: "Gemini anahtarı geçersiz görünüyor (eski anahtarlar 'AIza', yenileri 'AQ.' ile başlar); boşluk/satır sonu olmadan yapıştırın." };
    p.setProperty("RESIM_OKU_GEMINI_ANAHTARI", gemini);
  }
  if (body.model !== undefined) p.setProperty("RESIM_OKU_MODEL", String(body.model || "").trim());
  if (body.geminiModel !== undefined) p.setProperty("RESIM_OKU_GEMINI_MODEL", String(body.geminiModel || "").trim());
  if (body.motor === "gemini" || body.motor === "claude") p.setProperty("RESIM_OKU_MOTOR", body.motor);
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

// Modelin döndürdüğü metinden JSON nesnesini ayıklar.
function resimOkuJsonAyikla_(ham) {
  ham = String(ham || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const bas = ham.indexOf("{"), son = ham.lastIndexOf("}");
  if (bas < 0 || son <= bas) return { hata: "Belge okunamadı (yanıt JSON değil). Daha net bir görüntü deneyin." };
  try { return { veri: JSON.parse(ham.slice(bas, son + 1)) }; } catch (e) { return { hata: "Okunan veri çözümlenemedi; görüntüyü yeniden deneyin." }; }
}

function resimOkuClaude_(ayar, b64, mime, ipucu) {
  if (!ayar.claudeAnahtar) return { ok: false, anahtarYok: true, hata: "Resim okuma için Claude API anahtarı tanımlı değil (Admin: 📷 Resimden Oluştur penceresinde ⚙ Okuma Ayarı)." };
  const istek = {
    model: ayar.claudeModel,
    max_tokens: 6000,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
      { type: "text", text: resimOkuIstemi_(ipucu) },
    ] }],
  };
  let yanit, kod, metin;
  try {
    yanit = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post", contentType: "application/json",
      headers: { "x-api-key": ayar.claudeAnahtar, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify(istek), muteHttpExceptions: true,
    });
    kod = yanit.getResponseCode(); metin = yanit.getContentText();
  } catch (e) { return { ok: false, hata: "Okuma servisine ulaşılamadı: " + e.message }; }
  let j;
  try { j = JSON.parse(metin); } catch (e) { return { ok: false, hata: "Okuma servisi geçersiz yanıt verdi (HTTP " + kod + ")." }; }
  if (kod !== 200) {
    const m = (j && j.error && j.error.message) ? String(j.error.message) : ("HTTP " + kod);
    if (kod === 401) return { ok: false, hata: "Claude API anahtarı geçersiz ya da iptal edilmiş. Anahtarı yeniden girin." };
    if (kod === 402 || /credit|billing/i.test(m)) return { ok: false, hata: "Claude API hesabında bakiye/ödeme sorunu: " + m };
    if (kod === 429) return { ok: false, hata: "Okuma servisi şu an yoğun/limit aşıldı; biraz sonra tekrar deneyin." };
    return { ok: false, hata: "Okuma hatası: " + m };
  }
  const ham = (j.content || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join("\n");
  const a = resimOkuJsonAyikla_(ham);
  if (a.hata) return { ok: false, hata: a.hata };
  if (!Array.isArray(a.veri.kalemler)) a.veri.kalemler = [];
  return { ok: true, veri: a.veri, motor: "claude", model: ayar.claudeModel, kesildi: j.stop_reason === "max_tokens" };
}

function resimOkuGemini_(ayar, b64, mime, ipucu) {
  if (!ayar.geminiAnahtar) return { ok: false, anahtarYok: true, hata: "Resim okuma için Gemini API anahtarı tanımlı değil (Admin: 📷 Resimden Oluştur penceresinde ⚙ Okuma Ayarı)." };
  const istek = {
    contents: [{ role: "user", parts: [
      { inline_data: { mime_type: mime, data: b64 } },
      { text: resimOkuIstemi_(ipucu) },
    ] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 16384 },
  };
  let yanit, kod, metin;
  try {
    yanit = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(ayar.geminiModel) + ":generateContent", {
      method: "post", contentType: "application/json",
      headers: { "x-goog-api-key": ayar.geminiAnahtar },
      payload: JSON.stringify(istek), muteHttpExceptions: true,
    });
    kod = yanit.getResponseCode(); metin = yanit.getContentText();
  } catch (e) { return { ok: false, hata: "Okuma servisine ulaşılamadı: " + e.message }; }
  let j;
  try { j = JSON.parse(metin); } catch (e) { return { ok: false, hata: "Okuma servisi geçersiz yanıt verdi (HTTP " + kod + ")." }; }
  if (kod !== 200) {
    const m = (j && j.error && j.error.message) ? String(j.error.message) : ("HTTP " + kod);
    if (kod === 400 && /API key/i.test(m)) return { ok: false, hata: "Gemini API anahtarı geçersiz. Anahtarı yeniden girin." };
    if (kod === 403) return { ok: false, hata: "Gemini anahtarı bu modele/bölgeye erişemiyor ya da yetkisiz: " + m };
    if (kod === 404) return { ok: false, hata: "Gemini modeli bulunamadı (" + ayar.geminiModel + "). Okuma Ayarı'ndan model adını değiştirin: " + m };
    if (kod === 429) return { ok: false, hata: "Gemini ücretsiz kullanım sınırı doldu (dakikalık/günlük); biraz sonra tekrar deneyin ya da Claude'a geçin." };
    return { ok: false, hata: "Gemini okuma hatası: " + m };
  }
  const cand = (j.candidates || [])[0];
  if (!cand) return { ok: false, hata: "Gemini yanıt vermedi" + (j.promptFeedback && j.promptFeedback.blockReason ? " (engellendi: " + j.promptFeedback.blockReason + ")" : "") + "." };
  const ham = ((cand.content && cand.content.parts) || []).map(function (x) { return x.text || ""; }).join("\n");
  const a = resimOkuJsonAyikla_(ham);
  if (a.hata) return { ok: false, hata: a.hata };
  if (!Array.isArray(a.veri.kalemler)) a.veri.kalemler = [];
  return { ok: true, veri: a.veri, motor: "gemini", model: ayar.geminiModel, kesildi: cand.finishReason === "MAX_TOKENS" };
}

// body: { gorsel: "<base64, data: öneki olmadan>", mime: "image/jpeg|image/png|image/webp", ipucu?: "...", motor?: "gemini"|"claude" (verilmezse ayardaki) }
function getResimOku(body) {
  const ayar = resimOkuAyarlari_();
  const b64 = String((body && body.gorsel) || "");
  const mime = String((body && body.mime) || "image/jpeg").toLowerCase();
  if (!b64) return { ok: false, hata: "Görsel gelmedi." };
  if (b64.length > RESIM_OKU_MAX_BASE64_) return { ok: false, hata: "Görsel çok büyük; daha küçük çekim/ekran görüntüsü deneyin." };
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(mime) < 0) return { ok: false, hata: "Desteklenmeyen görsel türü: " + mime };
  const motor = (body && (body.motor === "gemini" || body.motor === "claude")) ? body.motor : ayar.motor;
  const ipucu = String((body && body.ipucu) || "").slice(0, 300);
  return motor === "gemini" ? resimOkuGemini_(ayar, b64, mime, ipucu) : resimOkuClaude_(ayar, b64, mime, ipucu);
}
