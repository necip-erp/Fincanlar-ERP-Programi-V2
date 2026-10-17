'use strict';
// Google Apps Script uyumluluk katmanı: Code.gs vb. dosyalar DEĞİŞTİRİLMEDEN Node'da çalışsın.
// Veri bellekte tutulur; her yazmadan sonra kısa gecikmeyle diske (atomik) yazılır.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ───────────── Veri deposu ─────────────
function tarihJson(k, v) { const ham = this && this[k]; return ham instanceof Date ? { $d: ham.getTime() } : v; }
function tarihGeri(k, v) { return v && typeof v === 'object' && v.$d !== undefined && Object.keys(v).length === 1 ? new Date(v.$d) : v; }

class Depo {
  constructor(dosya) {
    this.dosya = dosya;
    this.kitaplar = new Map();      // id -> Kitap
    this.ozellikler = {};           // PropertiesService
    this.kirli = false;
    this.surum = 0;                 // her yazmada artar (canlı bildirim için)
    this.zamanlayici = null;
    this.gunluk = [];               // bulut eşitleme için değişiklik günlüğü (bellekte)
    this.gunlukDosya = dosya ? dosya + '.gunluk.jsonl' : null;
  }
  kitapEkle(id, ad, sayfalar) { const k = new Kitap(this, id, ad, sayfalar); this.kitaplar.set(id, k); return k; }
  kitapGetir(id) {
    if (this.kitaplar.has(id)) return this.kitaplar.get(id);
    if (this.varsayilanId && this.kitaplar.has(this.varsayilanId)) return this.kitaplar.get(this.varsayilanId);
    throw new Error('Kitap bulunamadı: ' + id);
  }
  kirlet(sayfa, islem, ayrinti) {
    this.kirli = true; this.surum++;
    // İşlem günlüğü dinleyicisi (yedek.js > islemBasla/islemBitir): bu istekte hangi sayfalarda ne değiştiği toplanır. Hata verirse veri yazımı etkilenmez.
    if (this.dinleyici) { try { this.dinleyici({ s: sayfa, i: islem, a: ayrinti }); } catch (e) { /* günlük asıl işlemi bozmaz */ } }
    if (this.gunlukDosya) {
      const kayit = { t: Date.now(), s: sayfa, i: islem, a: ayrinti };
      try { fs.appendFileSync(this.gunlukDosya, JSON.stringify(kayit, tarihJson) + '\n'); } catch (e) {}
    }
    if (!this.dosya || this.zamanlayici) return;
    this.zamanlayici = setTimeout(() => { this.zamanlayici = null; this.diskeYaz(); }, 800);
  }
  diskeYaz() {
    if (!this.dosya || !this.kirli) return;
    const govde = JSON.stringify({
      surum: 1, varsayilanId: this.varsayilanId, ozellikler: this.ozellikler,
      kitaplar: [...this.kitaplar.values()].map(k => k.disaAktar()),
    }, tarihJson);
    const gecici = this.dosya + '.tmp';
    fs.writeFileSync(gecici, govde);
    // son 3 kopyayı döndür
    try {
      if (fs.existsSync(this.dosya)) {
        for (let i = 2; i >= 1; i--) { const a = this.dosya + '.yedek' + i; if (fs.existsSync(a)) fs.renameSync(a, this.dosya + '.yedek' + (i + 1)); }
        fs.copyFileSync(this.dosya, this.dosya + '.yedek1');
      }
    } catch (e) {}
    fs.renameSync(gecici, this.dosya);
    this.kirli = false;
  }
  diskten(dosya) {
    const j = JSON.parse(fs.readFileSync(dosya, 'utf8'), tarihGeri);
    this.varsayilanId = j.varsayilanId; this.ozellikler = j.ozellikler || {};
    for (const k of j.kitaplar) this.kitapEkle(k.id, k.ad, k.sayfalar);
    return this;
  }
}

class Kitap {
  constructor(depo, id, ad, sayfalar) {
    this.depo = depo; this.id = id; this.ad = ad; this.sayfalar = []; this.sonSayfaId = 1000;
    for (const s of sayfalar || []) this._ekle(s.ad, s.satirlar, s.id, s.metinKol);
  }
  _ekle(ad, satirlar, id, metinKol) {
    const s = new Sayfa(this, ad, satirlar || [], id || ++this.sonSayfaId, metinKol);
    this.sayfalar.push(s); return s;
  }
  disaAktar() { return { id: this.id, ad: this.ad, sayfalar: this.sayfalar.map(s => ({ id: s.id, ad: s.ad, satirlar: s.satirlar, metinKol: [...s.metinKol] })) }; }
  // ── SpreadsheetApp.Spreadsheet API ──
  getId() { return this.id; }
  getName() { return this.ad; }
  getUrl() { return 'yerel://' + this.id; }
  getSheetByName(ad) { return this.sayfalar.find(s => s.ad === ad) || null; }
  getSheets() { return this.sayfalar.slice(); }
  insertSheet(ad) { const s = this._ekle(ad || ('Sayfa' + (this.sayfalar.length + 1)), []); this.depo.kirlet(s.ad, 'sayfaEkle', {}); return s; }
  deleteSheet(s) { this.sayfalar = this.sayfalar.filter(x => x !== s); this.depo.kirlet(s.ad, 'sayfaSil', {}); }
  setName(ad) { this.ad = ad; }
}

const BOS = '';
function norm(v) { return v === undefined || v === null ? BOS : v; }

// Google Sheets, bir hücreye METİN yazılınca (hücre biçimi "düz metin" değilse) tarih/sayı gibi görünenleri
// kendisi tarih/sayıya çevirir. Mevcut kod bu davranışa göre yazıldığı için aynısı taklit edilir.
const TR_OFFSET_MS = 3 * 3600 * 1000; // e-tablo saat dilimi Europe/Istanbul (UTC+3, yaz saati yok)
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const RE_TR = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
function yerelTarih(y, a, g, sa, d, sn) {
  if (a < 1 || a > 12 || g < 1 || g > 31) return null;
  const t = Date.UTC(y, a - 1, g, sa || 0, d || 0, sn || 0) - TR_OFFSET_MS;
  const k = new Date(t + TR_OFFSET_MS);
  if (k.getUTCMonth() !== a - 1) return null;
  return new Date(t);
}
function sheetsDonustur(v, metinKolonu) {
  if (typeof v !== 'string' || metinKolonu || v === '') return v;
  let m;
  if ((m = RE_ISO.exec(v))) { const d = yerelTarih(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); if (d) return d; return v; }
  if ((m = RE_TR.exec(v))) { const d = yerelTarih(+m[3], +m[2], +m[1], +m[4], +m[5], +m[6]); if (d) return d; return v; }
  if (/^-?\d{1,15}$/.test(v)) return Number(v);
  if (v === 'TRUE') return true; if (v === 'FALSE') return false;
  return v;
}

class Sayfa {
  constructor(kitap, ad, satirlar, id, metinKol) { this.kitap = kitap; this.ad = ad; this.satirlar = satirlar; this.id = id; this.satirSayisi = Math.max(satirlar.length, 1000); this.metinKol = new Set(metinKol || []); }
  _d(v, kolon) { return sheetsDonustur(norm(v), this.metinKol.has(kolon)); }
  _kolonSayisi() { let m = 0; for (const r of this.satirlar) if (r.length > m) m = r.length; return m; }
  _sonSatir() {
    for (let i = this.satirlar.length - 1; i >= 0; i--) { const r = this.satirlar[i]; for (let j = 0; j < r.length; j++) if (r[j] !== BOS && r[j] !== undefined && r[j] !== null) return i + 1; }
    return 0;
  }
  _sonKolon() { let m = 0; for (const r of this.satirlar) for (let j = r.length - 1; j >= m; j--) if (r[j] !== BOS && r[j] != null) { m = j + 1; break; } return m; }
  getName() { return this.ad; }
  setName(ad) { this.ad = ad; this.kitap.depo.kirlet(ad, 'yenidenAdlandir', {}); return this; }
  getSheetId() { return this.id; }
  getParent() { return this.kitap; }
  getMaxRows() { return Math.max(this.satirSayisi, this.satirlar.length); }
  getMaxColumns() { return Math.max(26, this._kolonSayisi()); }
  getLastRow() { return this._sonSatir(); }
  getLastColumn() { return this._sonKolon(); }
  getDataRange() { return new Aralik(this, 1, 1, Math.max(this._sonSatir(), 1), Math.max(this._sonKolon(), 1)); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('A1 gösterimi desteklenmiyor: ' + r);
    return new Aralik(this, r, c || 1, nr || 1, nc || 1);
  }
  appendRow(dizi) {
    const hedef = this._sonSatir() + 1;
    while (this.satirlar.length < hedef) this.satirlar.push([]);
    this.satirlar[hedef - 1] = dizi.map((v, i) => this._d(v, i + 1));
    if (hedef > this.satirSayisi) this.satirSayisi = hedef;
    this.kitap.depo.kirlet(this.ad, 'ekle', { satir: hedef, deger: this.satirlar[hedef - 1] });
    return this;
  }
  deleteRow(n) { return this.deleteRows(n, 1); }
  deleteRows(n, adet) {
    let silinen = [];
    if (n <= this.satirlar.length) silinen = this.satirlar.splice(n - 1, adet);
    // silinen satırların kendisi de günlüğe girer (neyin silindiği sonradan görülebilsin); dinleyici yoksa ek maliyet yok
    this.kitap.depo.kirlet(this.ad, 'satirSil', { satir: n, adet: adet, silinen: this.kitap.depo.dinleyici ? silinen : undefined });
    return this;
  }
  insertRowsAfter(n, adet) { this.satirSayisi = Math.max(this.satirSayisi, this.satirlar.length) + adet; return this; }
  insertColumnsAfter() { return this; }   // taklitte sütun sınırı yok; gerçek Sheets uyumluluğu için boş yöntem
  insertRowAfter(n) { while (this.satirlar.length < n) this.satirlar.push([]); this.satirlar.splice(n, 0, []); this.kitap.depo.kirlet(this.ad, 'satirEkle', { satir: n + 1 }); return this; }
  insertRowBefore(n) { return this.insertRowAfter(n - 1); }
  clearContents() { this.satirlar = []; this.kitap.depo.kirlet(this.ad, 'temizle', {}); return this; }
  clear() { return this.clearContents(); }
  clearContent() { return this.clearContents(); }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  autoResizeColumn() { return this; }
  setRowHeight() { return this; }
  copyTo(hedefKitap) {
    const s = hedefKitap._ekle(this.ad, JSON.parse(JSON.stringify(this.satirlar, tarihJson), tarihGeri), null);
    hedefKitap.depo.kirlet(s.ad, 'kopya', {}); return s;
  }
  createTextFinder(metin) {
    const sayfa = this; let tam = false;
    const bulucu = {
      matchEntireCell(b) { tam = !!b; return bulucu; }, matchCase() { return bulucu; },
      findNext() {
        for (let i = 0; i < sayfa.satirlar.length; i++) for (let j = 0; j < sayfa.satirlar[i].length; j++) {
          const v = String(norm(sayfa.satirlar[i][j]));
          if (tam ? v === String(metin) : v.includes(String(metin))) return new Aralik(sayfa, i + 1, j + 1, 1, 1);
        }
        return null;
      },
    };
    return bulucu;
  }
}

class Aralik {
  constructor(sayfa, r, c, nr, nc) { this.s = sayfa; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getSheet() { return this.s; }
  getValues() {
    const cikti = [];
    for (let i = 0; i < this.nr; i++) {
      const kaynak = this.s.satirlar[this.r - 1 + i] || [];
      const satir = new Array(this.nc);
      for (let j = 0; j < this.nc; j++) satir[j] = norm(kaynak[this.c - 1 + j]);
      cikti.push(satir);
    }
    return cikti;
  }
  getDisplayValues() { return this.getValues().map(r => r.map(v => v instanceof Date ? v.toISOString() : String(v))); }
  getValue() { return this.getValues()[0][0]; }
  setValues(m) {
    const sa = this.s;
    for (let i = 0; i < m.length; i++) {
      const ri = this.r - 1 + i;
      while (sa.satirlar.length <= ri) sa.satirlar.push([]);
      const satir = sa.satirlar[ri];
      for (let j = 0; j < m[i].length; j++) {
        const cj = this.c - 1 + j;
        while (satir.length < cj) satir.push(BOS);
        satir[cj] = sa._d(m[i][j], cj + 1);
      }
    }
    if (this.r - 1 + m.length > sa.satirSayisi) sa.satirSayisi = this.r - 1 + m.length;
    sa.kitap.depo.kirlet(sa.ad, 'yaz', { r: this.r, c: this.c, deger: m });
    return this;
  }
  setValue(v) { return this.setValues(Array.from({ length: this.nr }, () => new Array(this.nc).fill(v))); }
  clearContent() {
    const bos = Array.from({ length: this.nr }, () => new Array(this.nc).fill(BOS));
    this.setValues(bos); return this;
  }
  clear() { return this.clearContent(); }
  setNumberFormat(f) { if (f === '@') for (let j = 0; j < this.nc; j++) this.s.metinKol.add(this.c + j); else for (let j = 0; j < this.nc; j++) this.s.metinKol.delete(this.c + j); return this; }
  setNumberFormats(m) { return this; }
  setFontWeight() { return this; } setFontColor() { return this; } setBackground() { return this; }
  setBackgrounds() { return this; } setFontSize() { return this; } setHorizontalAlignment() { return this; }
  setWrap() { return this; } setFontFamily() { return this; }
  sort(spec) {
    const sa = this.s; const kural = Array.isArray(spec) ? spec : [spec];
    const veri = this.getValues();
    veri.sort((a, b) => {
      for (const k of kural) {
        const kol = (typeof k === 'object' ? k.column : k) - this.c; const artan = typeof k === 'object' ? k.ascending !== false : true;
        const x = a[kol], y = b[kol]; if (x === y) continue;
        const d = (x < y ? -1 : 1) * (artan ? 1 : -1); if (d) return d;
      }
      return 0;
    });
    this.setValues(veri); return this;
  }
}

// ───────────── Yardımcı servisler ─────────────
function tarihBicimle(tarih, tz, kalip) {
  const d = tarih instanceof Date ? tarih : new Date(tarih);
  if (isNaN(d.getTime())) return '';
  const parcalar = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/Istanbul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const bicimli = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Europe/Istanbul', timeZoneName: 'longOffset' }).format(d);
  const m = bicimli.match(/GMT([+-]\d{2}):?(\d{2})?/); const off = m ? (m[1] + ':' + (m[2] || '00')) : '+00:00';
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const tokenler = {
    yyyy: parcalar.year, yy: parcalar.year.slice(2), MMMM: aylar[+parcalar.month - 1], MMM: aylar[+parcalar.month - 1].slice(0, 3),
    MM: parcalar.month, M: String(+parcalar.month), dd: parcalar.day, d: String(+parcalar.day),
    HH: parcalar.hour, H: String(+parcalar.hour), hh: String(((+parcalar.hour + 11) % 12) + 1).padStart(2, '0'),
    mm: parcalar.minute, ss: parcalar.second, SSS: ms, EEE: parcalar.weekday, a: +parcalar.hour < 12 ? 'AM' : 'PM',
    XXX: off, Z: off.replace(':', ''), z: 'GMT' + off,
  };
  let cikti = ''; let i = 0;
  while (i < kalip.length) {
    if (kalip[i] === "'") {
      const j = kalip.indexOf("'", i + 1);
      if (kalip[i + 1] === "'") { cikti += "'"; i += 2; continue; }
      cikti += kalip.slice(i + 1, j < 0 ? kalip.length : j); i = (j < 0 ? kalip.length : j + 1); continue;
    }
    let bulundu = false;
    for (const uz of [4, 3, 2, 1]) {
      const t = kalip.substr(i, uz);
      if (tokenler[t] !== undefined && t.split('').every(ch => ch === t[0])) { cikti += tokenler[t]; i += uz; bulundu = true; break; }
    }
    if (!bulundu) { cikti += kalip[i]; i++; }
  }
  return cikti;
}

function formatString(f, ...args) {
  let k = 0;
  return f.replace(/%(\.\d+)?([sdfx%])/g, (m, hane, tur) => {
    if (tur === '%') return '%';
    const a = args[k++];
    if (tur === 's') return String(a);
    if (tur === 'd') return String(Math.trunc(Number(a)));
    if (tur === 'x') return Number(a).toString(16);
    return Number(a).toFixed(hane ? +hane.slice(1) : 6);
  });
}

class Blob {
  constructor(bytes, tur, ad) { this.bytes = Buffer.from(bytes); this.tur = tur; this.ad = ad; }
  getBytes() { return [...this.bytes].map(b => (b > 127 ? b - 256 : b)); }
  getName() { return this.ad; } setName(a) { this.ad = a; return this; }
  getContentType() { return this.tur; }
  getDataAsString() { return this.bytes.toString('utf8'); }
}

function kurulum(depo, secenek) {
  secenek = secenek || {};
  const onbellek = new Map();
  const onbellekTutucu = {
    get(k) { const e = onbellek.get(k); if (!e) return null; if (e.b && e.b < Date.now()) { onbellek.delete(k); return null; } return e.v; },
    put(k, v, sn) { onbellek.set(k, { v: String(v), b: sn ? Date.now() + sn * 1000 : (Date.now() + 600000) }); },
    putAll(o, sn) { for (const k of Object.keys(o)) this.put(k, o[k], sn); },
    getAll(ks) { const o = {}; for (const k of ks) { const v = this.get(k); if (v !== null) o[k] = v; } return o; },
    remove(k) { onbellek.delete(k); },
    removeAll(ks) { for (const k of ks) onbellek.delete(k); },
  };
  const ozellikTutucu = {
    getProperty(k) { return k in depo.ozellikler ? depo.ozellikler[k] : null; },
    setProperty(k, v) { depo.ozellikler[k] = String(v); depo.kirlet('__ozellik', 'ozellik', { k }); return ozellikTutucu; },
    setProperties(o, sil) { if (sil) depo.ozellikler = {}; Object.assign(depo.ozellikler, o); depo.kirlet('__ozellik', 'ozellik', {}); return ozellikTutucu; },
    deleteProperty(k) { delete depo.ozellikler[k]; depo.kirlet('__ozellik', 'ozellik', { k }); return ozellikTutucu; },
    deleteAllProperties() { depo.ozellikler = {}; depo.kirlet('__ozellik', 'ozellik', {}); return ozellikTutucu; },
    getProperties() { return Object.assign({}, depo.ozellikler); },
    getKeys() { return Object.keys(depo.ozellikler); },
  };
  const yok = (ad) => () => { throw new Error('Yerel sunucuda desteklenmiyor: ' + ad); };
  const sandbox = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, escape, unescape, Symbol, TypeError, RangeError, WeakMap,
    setTimeout, clearTimeout,
    YerelGuncelle: globalThis.__YEREL_GUNCELLE__ || null,   // yalnızca yerel sunucuda var (src/guncelle.js)
    YerelYedek: globalThis.__YEREL_YEDEK__ || null,   // yalnızca yerel sunucuda var (src/yedek.js)
    Logger: { log: (...a) => { if (secenek.sessiz !== true) console.log('[GAS]', ...a); } },
    SpreadsheetApp: {
      openById: (id) => depo.kitapGetir(id),
      getActiveSpreadsheet: () => depo.kitapGetir(depo.varsayilanId),
      flush: () => {},
      create: (ad) => depo.kitapEkle('gecici-' + crypto.randomUUID(), ad, []),
    },
    CacheService: { getScriptCache: () => onbellekTutucu, getUserCache: () => onbellekTutucu, getDocumentCache: () => onbellekTutucu },
    PropertiesService: { getScriptProperties: () => ozellikTutucu, getUserProperties: () => ozellikTutucu, getDocumentProperties: () => ozellikTutucu },
    // Node tek iş parçacıklı ve her istek baştan sona eşzamanlı çalıştığı için istekler zaten sıraya girer.
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; }, hasLock() { return true; } }), getUserLock() { return this.getScriptLock(); } },
    Utilities: {
      formatDate: tarihBicimle, formatString,
      getUuid: () => crypto.randomUUID(),
      sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
      base64Encode: (x) => Buffer.from(typeof x === 'string' ? x : Buffer.from(x.map(b => (b + 256) % 256))).toString('base64'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (x) => Buffer.from(typeof x === 'string' ? x : Buffer.from(x.map(b => (b + 256) % 256))).toString('base64url'),
      base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')].map(b => (b > 127 ? b - 256 : b)),
      computeDigest: (algo, v) => [...crypto.createHash(algo === 'MD5' ? 'md5' : algo === 'SHA_1' ? 'sha1' : 'sha256').update(typeof v === 'string' ? v : Buffer.from(v.map(b => (b + 256) % 256))).digest()].map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF-8' },
      newBlob: (b, t, a) => new Blob(typeof b === 'string' ? Buffer.from(b) : Buffer.from(b.map(x => (x + 256) % 256)), t, a),
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (s) => { const o = { icerik: s, tur: 'text/plain', setMimeType(t) { o.tur = t; return o; }, getContent() { return o.icerik; } }; return o; },
    },
    ScriptApp: {
      getProjectTriggers: () => [], deleteTrigger() {}, getOAuthToken: () => '',
      newTrigger: () => { const t = { timeBased: () => t, everyMinutes: () => t, everyHours: () => t, everyDays: () => t, atHour: () => t, nearMinute: () => t, inTimezone: () => t, create: () => ({}) }; return t; },
    },
    // Drive / Mail / dış istek: yerelde yok. Çağıran kod try/catch ile hata mesajı döner; bunlar bulutta kalır.
    // Yalnızca getFileById(id).makeCopy(ad) desteklenir (yeni şirket / çalışma yılı oluşturma için): yerel kitabın kopyası yeni kitap olur.
    // Diğer Drive işlemleri (görsel, yedek vb.) yerelde yok; bulutta kalır.
    DriveApp: new Proxy({}, {
      get: (_, ad) => {
        if (ad === 'Access' || ad === 'Permission') return new Proxy({}, { get: (_, x) => x });
        if (ad === 'getFileById') return (id) => new Proxy({
          getId: () => id,
          getName: () => depo.kitapGetir(id).getName(),
          makeCopy: (yeniAd) => {
            const kaynak = depo.kitapGetir(id);
            const sayfalar = JSON.parse(JSON.stringify(kaynak.disaAktar().sayfalar, tarihJson), tarihGeri);
            const yeniId = 'yerel-' + crypto.randomUUID();
            depo.kitapEkle(yeniId, yeniAd || ('Kopya ' + kaynak.getName()), sayfalar);
            depo.kirlet('__kitap', 'kitapKopya', { id: yeniId, kaynak: kaynak.id });
            return { getId: () => yeniId, getName: () => yeniAd, getUrl: () => 'yerel://' + yeniId };
          },
        }, { get: (o, m) => (m in o ? o[m] : yok('DriveApp.File.' + String(m))) });
        return yok('DriveApp.' + String(ad));
      },
    }),
    MailApp: { sendEmail: yok('MailApp.sendEmail'), getRemainingDailyQuota: () => 0 },
    UrlFetchApp: { fetch: (u, o) => require('./senkron-istek').senkronIstek(u, o) },
    Session: { getScriptTimeZone: () => 'Europe/Istanbul', getActiveUser: () => ({ getEmail: () => '' }) },
  };
  return sandbox;
}

module.exports = { Depo, Kitap, Sayfa, Aralik, kurulum, tarihBicimle, tarihJson, tarihGeri };
