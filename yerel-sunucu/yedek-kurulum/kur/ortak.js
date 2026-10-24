'use strict';
// Hızlı kurulum paketinin ortak yardımcıları (yalnız Node yerleşik modülleri; ek paket gerekmez).
//  - Anahtar dosyasını parolayla şifreleme/çözme (AES-256-GCM + scrypt)
//  - Yedek dosyalarını (flash: veri-*.json, bulut: yerel-veri-*.json.gz[.001...]) bulma, okuma, doğrulama
//  - Terminalden soru sorma (parola yazarken ekranda görünmez)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { execFile } = require('child_process');

// ───── Şifreleme ─────
const SIHIR = Buffer.from('FERP1');
function anahtarTuret(parola, tuz) {
  return crypto.scryptSync(String(parola), tuz, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}
// dosyalar: { 'yedek-ayar.json': '<metin>', ... }
function sifrele(dosyalar, parola) {
  const tuz = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', anahtarTuret(parola, tuz), iv);
  const govde = Buffer.from(JSON.stringify({ s: 1, t: new Date().toISOString(), d: Object.fromEntries(Object.entries(dosyalar).map(([a, v]) => [a, Buffer.from(v, 'utf8').toString('base64')])) }), 'utf8');
  const sifreli = Buffer.concat([c.update(govde), c.final()]);
  return Buffer.concat([SIHIR, tuz, iv, c.getAuthTag(), sifreli]);
}
function coz(buf, parola) {
  if (buf.length < SIHIR.length + 44 || !buf.subarray(0, SIHIR.length).equals(SIHIR)) throw new Error('Bu dosya bir Fincanlar ERP anahtar dosyası değil');
  let o = SIHIR.length;
  const tuz = buf.subarray(o, o + 16); o += 16;
  const iv = buf.subarray(o, o + 12); o += 12;
  const etiket = buf.subarray(o, o + 16); o += 16;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', anahtarTuret(parola, tuz), iv);
    d.setAuthTag(etiket);
    const j = JSON.parse(Buffer.concat([d.update(buf.subarray(o)), d.final()]).toString('utf8'));
    return { tarih: j.t, dosyalar: Object.fromEntries(Object.entries(j.d).map(([a, v]) => [a, Buffer.from(v, 'base64').toString('utf8')])) };
  } catch (e) { throw new Error('Parola yanlış (ya da dosya bozuk)'); }
}

// ───── Yedek dosyaları ─────
const FLASH_AD = /^veri-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json$/;
const FLASH_AD_YENI = /^veri-(\d{2})\.(\d{2})\.(\d{4})_(\d{2})\.(\d{2})\.json$/;   // 24 Eki 2026: veri-GG.AA.YYYY_SS.DD.json
const BULUT_AD = /^yerel-veri-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json\.gz(?:\.(\d{3}))?$/;
const damgaT = (m) => Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);   // iki biçim de İstanbul saatiyle yazılır; kendi aralarında kıyaslanır
const damgaYaz = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);

// klasorler: taranacak klasör listesi (her birinin yanı sıra "FincanlarERP-Yedek" alt klasörü de bakılır)
// Dönüş: [{ tur:'flash'|'bulut', ad, t, yollar:[...], boyut, eksik }] yeniden eskiye
function yedekleriTara(klasorler) {
  const adaylar = new Map();
  const bak = (kl) => {
    let liste; try { liste = fs.readdirSync(kl); } catch (e) { return; }
    for (const f of liste) {
      let m = FLASH_AD.exec(f), yeniAd = null;
      if (!m) { yeniAd = FLASH_AD_YENI.exec(f); if (yeniAd) m = [yeniAd[0], yeniAd[3], yeniAd[2], yeniAd[1], yeniAd[4], yeniAd[5], '00']; }   // yıl, ay, gün, saat, dk, sn sırasına çevrilir
      if (m) {
        const yol = path.join(kl, f); let st; try { st = fs.statSync(yol); } catch (e) { continue; }
        adaylar.set('f|' + yol, { tur: 'flash', ad: f, t: damgaT(m), yollar: [yol], boyut: st.size, eksik: false });
        continue;
      }
      m = BULUT_AD.exec(f);
      if (m) {
        const yol = path.join(kl, f); let st; try { st = fs.statSync(yol); } catch (e) { continue; }
        const taban = f.replace(/\.\d{3}$/, ''), anahtar = 'b|' + kl + '|' + taban;
        const a = adaylar.get(anahtar) || { tur: 'bulut', ad: taban, t: damgaT(m), yollar: [], boyut: 0, eksik: false, _parca: [] };
        a.yollar.push(yol); a.boyut += st.size; a._parca.push(m[7] ? +m[7] : 0);
        adaylar.set(anahtar, a);
      }
    }
  };
  for (const kl of klasorler) { if (!kl) continue; bak(kl); bak(path.join(kl, 'FincanlarERP-Yedek')); }
  const cikti = [...adaylar.values()];
  for (const a of cikti) {
    if (a.tur !== 'bulut') continue;
    a.yollar.sort();
    a._parca.sort((x, y) => x - y);
    const parcali = a._parca.some((n) => n > 0);
    // parçalı yedekte 1..n eksiksiz olmalı; parçasız yedek tek dosyadır
    // (bulut yedeği tek parçaysa uzantısız yazılır; yalnız .001 varsa diğer parçalar eksiktir)
    if (parcali) { if (a._parca.length < 2) a.eksik = true; for (let i = 0; i < a._parca.length; i++) if (a._parca[i] !== i + 1) a.eksik = true; }
    delete a._parca;
  }
  return cikti.sort((x, y) => y.t - x.t);
}

function yedegiOku(aday) {
  if (aday.tur === 'flash') return fs.readFileSync(aday.yollar[0]);
  return zlib.gunzipSync(Buffer.concat(aday.yollar.map((y) => fs.readFileSync(y))));   // ayrı gzip parçaları art arda eklenince geçerli gzip olur
}
// Veri yedeği gerçekten kullanılabilir mi (boş/bozuk dosyayı yüklemeyelim)
function dogrula(ham) {
  let j; try { j = JSON.parse(ham.toString('utf8')); } catch (e) { return { ok: false, neden: 'Dosya okunamadı (bozuk)' }; }
  if (!j || !Array.isArray(j.kitaplar)) return { ok: false, neden: 'Geçerli bir veri yedeği değil' };
  let sayfa = 0, satir = 0;
  for (const k of j.kitaplar) { const sy = Array.isArray(k.sayfalar) ? k.sayfalar : []; sayfa += sy.length; for (const s of sy) satir += Array.isArray(s.satirlar) ? s.satirlar.length : 0; }
  if (j.kitaplar.length === 0) return { ok: false, neden: 'Yedekte hiç e-tablo yok' };
  if (ham.length < 2000) return { ok: false, neden: 'Yedek çok küçük (' + ham.length + ' bayt)' };
  return { ok: true, kitap: j.kitaplar.length, sayfa, satir, bayt: ham.length };
}

// ───── Terminal soruları ─────
// Tek bir readline açılır; satırlar sırayla dağıtılır (borudan gelen girdide de kaybolmaz).
let rl = null; const kuyruk = []; const bekleyen = []; let bitti = false; let sessiz = false;
function girdiAc() {
  if (rl) return;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const yaz = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
  if (yaz) rl._writeToOutput = (s) => { if (!sessiz) yaz(s); };
  rl.on('line', (l) => { if (bekleyen.length) bekleyen.shift()(l); else kuyruk.push(l); });
  rl.on('close', () => { bitti = true; while (bekleyen.length) bekleyen.shift()(''); });
}
function satirAl() { return new Promise((coz2) => { if (kuyruk.length) return coz2(kuyruk.shift()); if (bitti) return coz2(''); bekleyen.push(coz2); }); }
async function soru(metin, varsayilan) {
  girdiAc();
  process.stdout.write(metin + (varsayilan !== undefined && varsayilan !== '' ? ' [' + varsayilan + ']' : '') + ' ');
  const c = (await satirAl()).trim();
  return c === '' && varsayilan !== undefined ? String(varsayilan) : c;
}
async function parolaSor(metin) {
  girdiAc();
  process.stdout.write(metin + ' ');
  sessiz = !!process.stdin.isTTY;           // ekranda görünmesin
  const c = await satirAl();
  sessiz = false; if (process.stdin.isTTY) process.stdout.write('\n');
  return c;
}
async function evetMi(metin, varsayilanEvet) {
  const c = (await soru(metin + (varsayilanEvet ? ' (E/h)' : ' (e/H)'), '')).toLowerCase();
  if (c === '') return !!varsayilanEvet;
  return c === 'e' || c === 'evet' || c === 'y' || c === 'yes';
}
function girdiKapat() { if (rl) { try { rl.close(); } catch (e) {} } }

// ───── Sistem yardımcıları ─────
function calistir(komut, args, ms) {
  return new Promise((coz2) => execFile(komut, args, { timeout: ms || 30000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => coz2({ ok: !e, kod: e ? (e.code === undefined ? 1 : e.code) : 0, out: String(out || ''), err: String(err || (e && e.message) || '') })));
}
const powershell = (komut, ms) => calistir('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + komut], ms);

// Kodu kopyala: üst düzeyde `haric` adındaki öğeler ve *.log dosyaları alınmaz
function kodKopyala(kaynak, hedef, haric) {
  fs.mkdirSync(hedef, { recursive: true });
  const yasak = new Set((haric || []).map((x) => x.toLowerCase()));
  let adet = 0;
  for (const ad of fs.readdirSync(kaynak)) {
    if (yasak.has(ad.toLowerCase()) || /\.log$/i.test(ad)) continue;
    fs.cpSync(path.join(kaynak, ad), path.join(hedef, ad), { recursive: true, force: true, preserveTimestamps: true });
    adet++;
  }
  return adet;
}

// Dosya adı damgası: yedek motoruyla aynı biçim ve aynı saat dilimi (İstanbul), böylece yedekler birbiriyle doğru kıyaslanır
const damgaSimdi = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.day}.${p.month}.${p.year}_${p.hour}.${p.minute}`;   // 24 Eki 2026: gün.ay.yıl_saat.dakika (":" dosya adında olamaz)
};
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

module.exports = { sifrele, coz, yedekleriTara, yedegiOku, dogrula, damgaYaz, soru, parolaSor, evetMi, girdiKapat, calistir, powershell, kodKopyala, damgaSimdi, mb };
