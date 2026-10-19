'use strict';
// Dış fatura köprüsü (yalnız OKUMA): yerel sunucu, FATURAFIYAT e-tablosuna ve Drive'daki fatura görsellerine erişemez.
// Bu modül ilgili işlemden ÖNCE (async) buluttan veriyi alıp `durum` içinde tutar; arka uç (senkron) bunu YerelDisVeri adıyla okur.
function baslat(o) {
  const yedek = o.yedek;
  const durum = { satirlar: null, zaman: 0, hata: '', gorsel: {}, resimOku: null, resimOkuZaman: 0, resimOkuHata: '', hsYapi: null, hsYapiZaman: 0, edm: null, edmZaman: 0, edmHata: '' };
  const TAZE_MS = 20000, GORSEL_LIMIT = 30;
  let bekleyen = null, bekleyenResim = null;

  function satirlariYenile() {
    if (durum.satirlar && Date.now() - durum.zaman < TAZE_MS) return Promise.resolve();
    if (bekleyen) return bekleyen;
    bekleyen = (async () => {
      try {
        const y = await yedek.bulutaSor({ action: 'yerelDisFatura', islem: 'satirlar' });
        if (!y || !y.ok || !Array.isArray(y.satirlar)) throw new Error((y && y.hata) || 'Bulut yanıt vermedi');
        durum.satirlar = y.satirlar; durum.zaman = Date.now(); durum.hata = '';
      } catch (e) { durum.hata = e.message; }
      finally { bekleyen = null; }
    })();
    return bekleyen;
  }

  async function gorselIste(faturaNo) {
    const fn = String(faturaNo || '').trim();
    if (!fn || durum.gorsel[fn]) return;
    try {
      const y = await yedek.bulutaSor({ action: 'yerelDisFatura', islem: 'gorsel', faturaNo: fn });
      if (!y) throw new Error('Bulut yanıt vermedi');
      if (y.ok) {
        const an = Object.keys(durum.gorsel);
        if (an.length >= GORSEL_LIMIT) delete durum.gorsel[an[0]];
        durum.gorsel[fn] = y; durum.hata = '';
      } else durum.hata = y.hata || 'Görsel alınamadı';
    } catch (e) { durum.hata = e.message; }
  }

  // Resimden Oluştur okuma ayarı (anahtar dahil) buluttan alınır; 60 sn önbellek. Yerelde ayrıca girilmiş anahtar varsa o öncelikli (ResimOku.gs).
  function resimAyariYenile() {
    if (durum.resimOku && Date.now() - durum.resimOkuZaman < 60000) return Promise.resolve();
    if (bekleyenResim) return bekleyenResim;
    bekleyenResim = (async () => {
      try {
        const y = await yedek.bulutaSor({ action: 'yerelDisFatura', islem: 'resimOkuAyar' });
        if (!y || !y.ok || !y.ayar) throw new Error((y && y.hata) || 'Bulut yanıt vermedi');
        durum.resimOku = y.ayar; durum.resimOkuZaman = Date.now(); durum.resimOkuHata = '';
      } catch (e) { durum.resimOkuHata = e.message; }
      finally { bekleyenResim = null; }
    })();
    return bekleyenResim;
  }

  // Hızlı Satış düzeni (alt/ara gruplar): yerelde boşsa buluttaki düzen bir kez alınır (backend/HizliSatisAyar.gs getHsYapi). 60 sn önbellek.
  async function hsYapiYenile() {
    if (Date.now() - durum.hsYapiZaman < 60000) return;
    try {
      const y = await yedek.bulutaSor({ action: 'yerelDisFatura', islem: 'hsYapi' });
      if (y && y.ok) { durum.hsYapi = y.hsYapi || null; durum.hsYapiZaman = Date.now(); }
    } catch (e) {}
  }

  // EDM bağlantı ayarı buluttan (yalnız bellekte tutulur, diske yazılmaz); 5 dk önbellek. Yerelde ozellikler.json'daki değer öncelikli (shim.js).
  async function edmAyariYenile() {
    if (durum.edm && Date.now() - durum.edmZaman < 300000) return;
    if (!durum.edm && durum.edmDeneme && Date.now() - durum.edmDeneme < 30000) return;   // bulut yanıt vermediyse 30 sn içinde tekrar sorma
    durum.edmDeneme = Date.now();
    try {
      const y = await yedek.bulutaSor({ action: 'yerelDisFatura', islem: 'edmAyar' });
      if (!y || !y.ok || !y.edm) throw new Error((y && y.hata) || 'Bulut yanıt vermedi');
      durum.edm = y.edm; durum.edmZaman = Date.now(); durum.edmHata = '';
    } catch (e) { durum.edmHata = e.message; }
  }

  async function hazirla(action, body) {
    if (/edm/i.test(String(action || ''))) return edmAyariYenile();
    if (action === 'getHsYapi') return hsYapiYenile();
    if (/^(getResimOku|resimOku)/.test(String(action || ''))) return resimAyariYenile();
    if (action === 'getAlisFaturaGorselHtml') return gorselIste(body && body.faturaNo);
    if (/^(getBekleyenAlisFaturalari|nakliye|getNakliye)/.test(String(action || ''))) return satirlariYenile();
  }
  return { durum, satirlariYenile, gorselIste, resimAyariYenile, hazirla };
}
module.exports = { baslat };
