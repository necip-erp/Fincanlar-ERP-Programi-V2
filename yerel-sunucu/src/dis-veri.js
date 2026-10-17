'use strict';
// Dış fatura köprüsü (yalnız OKUMA): yerel sunucu, FATURAFIYAT e-tablosuna ve Drive'daki fatura görsellerine erişemez.
// Bu modül ilgili işlemden ÖNCE (async) buluttan veriyi alıp `durum` içinde tutar; arka uç (senkron) bunu YerelDisVeri adıyla okur.
function baslat(o) {
  const yedek = o.yedek;
  const durum = { satirlar: null, zaman: 0, hata: '', gorsel: {} };
  const TAZE_MS = 20000, GORSEL_LIMIT = 30;
  let bekleyen = null;

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

  async function hazirla(action, body) {
    if (action === 'getAlisFaturaGorselHtml') return gorselIste(body && body.faturaNo);
    if (/^(getBekleyenAlisFaturalari|nakliye|getNakliye)/.test(String(action || ''))) return satirlariYenile();
  }
  return { durum, satirlariYenile, gorselIste, hazirla };
}
module.exports = { baslat };
