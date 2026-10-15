'use strict';
// Yerel sunucu YEDEK MOTORU (15 Eki 2026)
//  1) BULUT: veri değiştiyse her N dakikada (varsayılan 5) veri.json sıkıştırılıp Google Drive'a gönderilir
//     (bulut ucu: Yedekleme.gs > yerelYedekYukle). Hata olursa sonraki turda yeniden denenir.
//  2) FLASH: ayarlı saatlerde, takılı çıkarılabilir sürücüye (flash) veri + program kodu kopyalanır.
//     Saat geldiğinde flash takılı değilse, takılınca o günün kaçan saati için bir kez yedek alınır.
//  3) "Şimdi yedekle": Ayarlar > Yedekleme ekranından anında.
// Ayar dosyası: veri\yedek-ayar.json   Durum dosyası: veri\yedek-durum.json
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

const PARCA_BOYUT = 24 * 1024 * 1024;   // ham veri parça boyutu (her parça ayrı gzip)
const VARSAYILAN = {
  bulut: { acik: true, dakika: 5 },
  flash: { acik: true, saatler: ['13:00', '19:00'], sakla: 10, kodDa: true, harfler: [] },
  anahtar: '',
};

function istanbul(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { tarih: `${p.year}-${p.month}-${p.day}`, saat: `${p.hour}:${p.minute}`, damga: `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}` };
}
const saatGecerli = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gzipAsync = (b) => new Promise((res, red) => zlib.gzip(b, { level: 6 }, (e, x) => (e ? red(e) : res(x))));

function postla(adres, govde, kalan) {
  kalan = kalan === undefined ? 5 : kalan;
  return new Promise((coz, red) => {
    const u = new URL(adres); const mod = u.protocol === 'http:' ? http : https;
    const veri = Buffer.from(govde, 'utf8');
    const r = mod.request(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Length': veri.length }, timeout: 240000 }, (y) => {
      if (y.statusCode >= 300 && y.statusCode < 400 && y.headers.location && kalan > 0) { y.resume(); return coz(getle(new URL(y.headers.location, u).toString(), kalan - 1)); }
      oku(y, coz, red);
    });
    r.on('timeout', () => r.destroy(new Error('Bulut yanıt vermedi (zaman aşımı)')));
    r.on('error', red); r.end(veri);
  });
}
function getle(adres, kalan) {
  return new Promise((coz, red) => {
    const u = new URL(adres); const mod = u.protocol === 'http:' ? http : https;
    const r = mod.get(u, { timeout: 120000 }, (y) => {
      if (y.statusCode >= 300 && y.statusCode < 400 && y.headers.location && kalan > 0) { y.resume(); return coz(getle(new URL(y.headers.location, u).toString(), kalan - 1)); }
      oku(y, coz, red);
    });
    r.on('timeout', () => r.destroy(new Error('Bulut yanıt vermedi (zaman aşımı)')));
    r.on('error', red);
  });
}
function oku(y, coz, red) {
  const p = []; y.on('data', (c) => p.push(c));
  y.on('end', () => {
    const m = Buffer.concat(p).toString('utf8');
    try { coz(JSON.parse(m)); } catch (e) { red(new Error('Bulut yanıtı okunamadı (HTTP ' + y.statusCode + '): ' + m.slice(0, 120).replace(/\s+/g, ' '))); }
  });
  y.on('error', red);
}

function baslat(o) {
  const { depo, VERI, KOK, ONYUZ } = o;
  const VERIKL = path.dirname(VERI);
  const AYAR = path.join(VERIKL, 'yedek-ayar.json');
  const DURUM = path.join(VERIKL, 'yedek-durum.json');
  const log = o.log || ((...a) => console.log('  [yedek]', ...a));

  let ayar = JSON.parse(JSON.stringify(VARSAYILAN));
  try { const j = JSON.parse(fs.readFileSync(AYAR, 'utf8')); ayar = birlestir(j); } catch (e) { /* ilk çalıştırma */ }
  if (!ayar.anahtar) { ayar.anahtar = crypto.randomBytes(24).toString('hex'); ayarYaz(); }

  let durum = { bulut: { sonBasari: 0, sonDeneme: 0, sonHata: '', sonAd: '', sonBoyutKB: 0, sonDriveYuzde: null }, flash: { sonBasari: 0, sonSlot: '', sonHata: '', sonYol: '', sonSurucu: '' } };
  try { const j = JSON.parse(fs.readFileSync(DURUM, 'utf8')); durum.bulut = Object.assign(durum.bulut, j.bulut); durum.flash = Object.assign(durum.flash, j.flash); } catch (e) {}
  const islem = { bulut: false, flash: false };
  let sonSurum = -1;               // bellekte: başlangıçta ilk turda mutlaka gönderilir
  let flashTarama = { t: 0, liste: [] };
  let sonDurumIstegi = 0;

  function birlestir(j) {
    const a = JSON.parse(JSON.stringify(VARSAYILAN));
    j = j || {};
    if (j.bulut) { a.bulut.acik = j.bulut.acik !== false; const d = parseInt(j.bulut.dakika, 10); if (d >= 1 && d <= 60) a.bulut.dakika = d; }
    if (j.flash) {
      a.flash.acik = j.flash.acik !== false;
      if (Array.isArray(j.flash.saatler)) a.flash.saatler = [...new Set(j.flash.saatler.filter(saatGecerli))].sort().slice(0, 8);
      const s = parseInt(j.flash.sakla, 10); if (s >= 1 && s <= 100) a.flash.sakla = s;
      a.flash.kodDa = j.flash.kodDa !== false;
      if (Array.isArray(j.flash.harfler)) a.flash.harfler = j.flash.harfler.map((h) => String(h).trim().toUpperCase().replace(/[\\/]+$/, '')).filter((h) => /^[A-Z]:$/.test(h)).slice(0, 4);
    }
    a.anahtar = typeof j.anahtar === 'string' ? j.anahtar : '';
    return a;
  }
  function ayarYaz() { try { fs.mkdirSync(VERIKL, { recursive: true }); fs.writeFileSync(AYAR, JSON.stringify(ayar, null, 2)); } catch (e) { log('ayar yazılamadı:', e.message); } }
  function durumYaz() { try { fs.writeFileSync(DURUM, JSON.stringify(durum, null, 2)); } catch (e) {} }

  function bulutAdresi() {
    if (process.env.YEDEK_TEST_BULUT) return process.env.YEDEK_TEST_BULUT;
    try {
      const ham = fs.readFileSync(path.join(ONYUZ, 'index.html'), 'utf8');
      const m = /const CARI_API = "(https:\/\/script\.google\.com[^"]*)";/.exec(ham);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  // ───── BULUT ─────
  async function bulutYukle(zorla) {
    if (islem.bulut) return { ok: false, hata: 'Bulut yedeği zaten sürüyor' };
    const adres = bulutAdresi();
    if (!adres) { durum.bulut.sonHata = 'Bulut adresi bulunamadı (onyuz\\index.html)'; durumYaz(); return { ok: false, hata: durum.bulut.sonHata }; }
    if (!zorla && depo.surum === sonSurum) return { ok: true, degismedi: true };
    islem.bulut = true; durum.bulut.sonDeneme = Date.now();
    try {
      depo.diskeYaz();                       // bellekteki son hal diske (eşzamanlı, atomik)
      const surum = depo.surum;
      const ham = fs.readFileSync(VERI);
      const n = Math.max(1, Math.ceil(ham.length / PARCA_BOYUT));
      const damga = istanbul(new Date()).damga;
      let son = null;
      for (let i = 0; i < n; i++) {
        const gz = await gzipAsync(ham.subarray(i * PARCA_BOYUT, (i + 1) * PARCA_BOYUT));
        const yanit = await postla(adres, JSON.stringify({ action: 'yerelYedekYukle', anahtar: ayar.anahtar, damga, parca: i + 1, toplam: n, veri: gz.toString('base64') }));
        if (!yanit || !yanit.ok) throw new Error((yanit && yanit.hata) || 'Bulut yanıtı olumsuz');
        son = yanit;
        if (i === n - 1) durum.bulut.sonBoyutKB = Math.round(gz.length / 1024);
      }
      sonSurum = surum;
      durum.bulut.sonBasari = Date.now(); durum.bulut.sonHata = ''; durum.bulut.sonAd = son.ad || ''; if (son.driveYuzde !== undefined) durum.bulut.sonDriveYuzde = son.driveYuzde;
      durumYaz();
      return { ok: true };
    } catch (e) {
      durum.bulut.sonHata = e.message; durumYaz(); log('bulut yedeği başarısız:', e.message);
      return { ok: false, hata: e.message };
    } finally { islem.bulut = false; }
  }

  // ───── FLASH ─────
  function powershell(komut) {
    return new Promise((coz) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut], { timeout: 20000, windowsHide: true }, (e, out) => coz(e ? '' : String(out))));
  }
  async function flashTara() {
    let liste = [];
    if (process.env.YEDEK_TEST_FLASH) liste = process.env.YEDEK_TEST_FLASH.split(';').filter(Boolean).map((k) => ({ kok: k, ad: 'TEST' }));
    else if (process.platform === 'win32') {
      const cikti = await powershell("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID + '|' + $_.VolumeName }");
      liste = cikti.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Z]:\|/.test(s)).map((s) => ({ kok: s.slice(0, 2) + '\\', ad: s.slice(3) || 'Flash' }));
      for (const h of ayar.flash.harfler) { // elle belirtilen sürücü (harici disk vb.) — çıkarılabilir görünmese bile
        if (!liste.some((x) => x.kok.toUpperCase().startsWith(h)) && fs.existsSync(h + '\\')) liste.push({ kok: h + '\\', ad: 'Elle seçilen' });
      }
    }
    // sunucunun kendi sürücüsü ve veri klasörünün bulunduğu sürücü asla flash sayılmaz
    const kendi = path.parse(VERI).root.toUpperCase();
    liste = liste.filter((x) => process.env.YEDEK_TEST_FLASH || x.kok.toUpperCase() !== kendi);
    flashTarama = { t: Date.now(), liste };
    return liste;
  }

  function kodKopyala(hedefKok) {
    const kod = path.join(hedefKok, 'KOD');
    fs.mkdirSync(kod, { recursive: true });
    for (const ad of fs.readdirSync(KOK)) {
      if (ad === 'veri' || ad === 'node_modules' || ad === 'yedek') continue;
      const k = path.join(KOK, ad), h = path.join(kod, ad);
      try { fs.cpSync(k, h, { recursive: true, force: true }); } catch (e) { /* tek dosya hatası yedeği durdurmasın */ }
    }
  }

  async function flashYedekle(sebep, slot) {
    if (islem.flash) return { ok: false, hata: 'Flash yedeği zaten sürüyor' };
    islem.flash = true;
    try {
      const surucular = await flashTara();
      if (!surucular.length) { durum.flash.sonHata = 'Flash takılı değil'; durumYaz(); return { ok: false, hata: durum.flash.sonHata }; }
      depo.diskeYaz();
      const ham = fs.readFileSync(VERI); const ozet = sha(ham);
      const z = istanbul(new Date());
      let yapilan = 0, hata = '';
      for (const s of surucular) {
        try {
          const kl = path.join(s.kok, 'FincanlarERP-Yedek');
          fs.mkdirSync(kl, { recursive: true });
          const ad = `veri-${z.damga}.json`, hedef = path.join(kl, ad), gecici = hedef + '.tmp';
          await fs.promises.writeFile(gecici, ham);
          const geri = await fs.promises.readFile(gecici);
          if (sha(geri) !== ozet) { await fs.promises.unlink(gecici).catch(() => {}); throw new Error('Kopya doğrulanamadı (flash arızalı olabilir)'); }
          await fs.promises.rename(gecici, hedef);
          if (ayar.flash.kodDa) kodKopyala(kl);
          const eskiler = fs.readdirSync(kl).filter((f) => /^veri-.*\.json$/.test(f)).sort();
          while (eskiler.length > ayar.flash.sakla) await fs.promises.unlink(path.join(kl, eskiler.shift())).catch(() => {});
          durum.flash.sonYol = hedef; durum.flash.sonSurucu = s.kok; yapilan++;
        } catch (e) { hata = (e.code === 'ENOSPC' ? 'Flash\'ta yer yok' : e.message); log('flash yedeği hatası:', hata); }
      }
      if (yapilan) { durum.flash.sonBasari = Date.now(); durum.flash.sonHata = hata; if (slot) durum.flash.sonSlot = slot; durumYaz(); return { ok: true, adet: yapilan }; }
      durum.flash.sonHata = hata || 'Yazılamadı'; durumYaz(); return { ok: false, hata: durum.flash.sonHata };
    } finally { islem.flash = false; }
  }

  // Bekleyen flash saati: bugün için saati gelmiş en son slot, henüz yapılmadıysa
  function bekleyenSlot() {
    if (!ayar.flash.acik || !ayar.flash.saatler.length) return '';
    const z = istanbul(new Date());
    const gelen = ayar.flash.saatler.filter((s) => s <= z.saat);
    if (!gelen.length) return '';
    const slot = z.tarih + ' ' + gelen[gelen.length - 1];
    return durum.flash.sonSlot >= slot ? '' : slot;
  }

  // ───── Zamanlayıcı ─────
  let bulutSon = 0;
  async function tik() {
    try {
      if (ayar.bulut.acik && !islem.bulut && Date.now() - bulutSon >= ayar.bulut.dakika * 60000 - 2000) { bulutSon = Date.now(); bulutYukle(false); }
      const slot = bekleyenSlot();
      if (slot && !islem.flash) {
        const s = await flashTara();
        if (s.length) flashYedekle('zamanli', slot);
      }
    } catch (e) { log('zamanlayıcı hatası:', e.message); }
  }
  const zaman = setInterval(tik, 30000); if (zaman.unref) zaman.unref();
  const ilk = setTimeout(() => { bulutSon = Date.now(); bulutYukle(false); }, 20000); if (ilk.unref) ilk.unref();

  // ───── Ekranın (Admin) kullandığı arayüz ─────
  function ayarKaydet(yeni) {
    const a = birlestir(Object.assign({}, yeni, { anahtar: ayar.anahtar }));
    if (yeni.flash && Array.isArray(yeni.flash.saatler) && yeni.flash.saatler.length && !a.flash.saatler.length) return { ok: false, hata: 'Saat biçimi geçersiz (örnek: 13:00)' };
    ayar = a; ayarYaz();
    return { ok: true };
  }
  function simdi(hedef) {
    if (hedef === 'bulut' || hedef === 'ikisi') { bulutSon = Date.now(); bulutYukle(true); }
    if (hedef === 'flash' || hedef === 'ikisi') flashYedekle('elle', '');
    return { ok: true, baslatildi: hedef };
  }
  function durumVer() {
    sonDurumIstegi = Date.now();
    if (Date.now() - flashTarama.t > 15000 && !islem.flash) flashTara().catch(() => {});
    const bulutKalanSn = ayar.bulut.acik ? Math.max(0, Math.round((bulutSon + ayar.bulut.dakika * 60000 - Date.now()) / 1000)) : null;
    const g = JSON.parse(JSON.stringify(ayar)); delete g.anahtar;
    return {
      ayar: g, durum: JSON.parse(JSON.stringify(durum)),
      flash: { takili: flashTarama.liste.map((x) => ({ yol: x.kok, ad: x.ad })), bekleyenSlot: bekleyenSlot(), taraTarihi: flashTarama.t },
      bulutAdres: !!bulutAdresi(),
      simdi: { islem: JSON.parse(JSON.stringify(islem)), bulutKalanSn, sunucuSaati: Date.now() },
    };
  }
  return { durum: durumVer, ayarKaydet, simdi, bulutYukle, flashYedekle, flashTara, _ayar: () => ayar };
}

module.exports = { baslat };
