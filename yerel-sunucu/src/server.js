'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Depo, calistir } = require('./runtime');

const KOK = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const VERI = process.env.VERI || path.join(KOK, 'veri', 'veri.json');
const ARKA = process.env.ARKA_PLAN || path.join(KOK, 'arka-plan');
const ONYUZ = path.join(KOK, 'onyuz');

if (!fs.existsSync(VERI)) { console.error('Veri dosyası yok: ' + VERI + '\nÖnce BASLANGIC-VERISI-YUKLE.bat çalıştırın.'); process.exit(1); }
const depo = new Depo(VERI).diskten(VERI);
// Gizli bilgiler (EDM_URL, EDM_USER, EDM_PASSWORD...) veri/ozellikler.json dosyasından okunur.
try {
  const oz = path.join(path.dirname(VERI), 'ozellikler.json');
  if (fs.existsSync(oz)) { Object.assign(depo.ozellikler, JSON.parse(fs.readFileSync(oz, 'utf8'))); console.log('  ozellikler.json yüklendi'); }
} catch (e) { console.error('ozellikler.json okunamadı:', e.message); }
// Yedek motoru (bulut 5 dk + flash + Şimdi yedekle): Yedekleme ekranı bunu 'YerelYedek' adıyla görür.
const yedek = require('./yedek').baslat({ depo, VERI, KOK, ONYUZ });
globalThis.__YEREL_YEDEK__ = yedek;
// Güncelleme motoru (GitHub'dan program güncelleme + önceki sürüme dönüş): Ayarlar ekranı bunu 'YerelGuncelle' adıyla görür.
globalThis.__YEREL_GUNCELLE__ = require('./guncelle').baslat({ depo, VERI, KOK, ONYUZ, ARKA });
const rt = calistir(depo, ARKA, { sessiz: true });
let istekSayisi = 0, yazmaSayisi = 0;
// Canlı bildirim (SSE): bir bilgisayar veri yazınca bağlı tüm ekranlara haber verilir.
const dinleyenler = new Set();
function yayinla(istemci) {
  const m = 'data: ' + JSON.stringify({ k: istemci || '', t: Date.now() }) + '\n\n';
  for (const r of dinleyenler) { try { r.write(m); } catch (e) { dinleyenler.delete(r); } }
}
setInterval(() => { for (const r of dinleyenler) { try { r.write(': canli\n\n'); } catch (e) { dinleyenler.delete(r); } } }, 25000);
const baslangic = Date.now();

const TURLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function onyuzIndex() {
  // Ön yüzdeki bulut adresi (script.google.com) bu sunucunun kendi adresiyle değiştirilir; dosyanın kendisi bozulmaz.
  const ham = fs.readFileSync(path.join(ONYUZ, 'index.html'), 'utf8');
  return ham.replace(/const CARI_API = "https:\/\/script\.google\.com[^"]*";/, 'const CARI_API = location.origin + "/exec";');
}
let indexOnbellek = null;

function govdeOku(req, sinir) {
  return new Promise((coz, red) => {
    const parcalar = []; let boyut = 0;
    req.on('data', c => { boyut += c.length; if (boyut > sinir) { red(new Error('İstek çok büyük')); req.destroy(); } else parcalar.push(c); });
    req.on('end', () => coz(Buffer.concat(parcalar).toString('utf8')));
    req.on('error', red);
  });
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname === '/olaylar') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      dinleyenler.add(res);
      req.on('close', () => dinleyenler.delete(res));
      return;
    }
    if (url.pathname === '/exec') {
      istekSayisi++;
      const surum0 = depo.surum, istemci = String(req.headers['x-istemci'] || '').slice(0, 40);
      let cikti;
      if (req.method === 'POST') {
        const govde = await govdeOku(req, 60 * 1024 * 1024);
        cikti = rt.istek('POST', Object.fromEntries(url.searchParams), govde);
      } else {
        cikti = rt.istek('GET', Object.fromEntries(url.searchParams));
      }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors));
      res.end(cikti);
      if (depo.surum !== surum0) yayinla(istemci);
      return;
    }
    if (url.pathname === '/durum') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
      return res.end(JSON.stringify({ ok: true, ekranSayisi: dinleyenler.size, calismaSuresiSn: Math.round((Date.now() - baslangic) / 1000), istek: istekSayisi, bellekMB: Math.round(process.memoryUsage().rss / 1048576) }));
    }
    // ön yüz dosyaları
    let ad = url.pathname === '/' ? '/index.html' : url.pathname;
    ad = path.normalize(ad).replace(/^(\.\.[\/\\])+/, '');
    if (ad === '/index.html' || ad === '\\index.html') {
      if (!indexOnbellek) indexOnbellek = onyuzIndex();
      res.writeHead(200, { 'Content-Type': TURLER['.html'], 'Cache-Control': 'no-cache' });
      return res.end(indexOnbellek);
    }
    if (ad === '/sw.js') { res.writeHead(404); return res.end(); } // servis çalışanı kapalı: eski önbellek yerel sunucuyu gölgelemesin
    const dosya = path.join(ONYUZ, ad);
    if (dosya.startsWith(ONYUZ) && fs.existsSync(dosya) && fs.statSync(dosya).isFile()) {
      res.writeHead(200, { 'Content-Type': TURLER[path.extname(dosya)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(dosya).pipe(res);
    }
    res.writeHead(404); res.end('Bulunamadı');
  } catch (e) {
    console.error('İstek hatası:', e.message);
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify({ ok: false, hata: 'Yerel sunucu hatası: ' + e.message }));
  }
});

// Günlük tam yedek: veri/yedek/ klasörüne (son 30 kopya)
function gunlukYedek() {
  try {
    const kl = path.join(path.dirname(VERI), 'yedek'); fs.mkdirSync(kl, { recursive: true });
    const damga = new Date().toISOString().slice(0, 10);
    const hedef = path.join(kl, 'veri-' + damga + '.json');
    if (!fs.existsSync(hedef)) { depo.diskeYaz(); fs.copyFileSync(VERI, hedef); console.log('  Günlük yedek alındı: ' + hedef); }
    const eskiler = fs.readdirSync(kl).filter(f => /^veri-.*\.json$/.test(f)).sort();
    while (eskiler.length > 30) fs.unlinkSync(path.join(kl, eskiler.shift()));
  } catch (e) { console.error('Yedek hatası:', e.message); }
}
gunlukYedek(); setInterval(gunlukYedek, 3600 * 1000);

function kapat() { try { depo.diskeYaz(); } catch (e) { console.error(e); } process.exit(0); }
process.on('SIGINT', kapat); process.on('SIGTERM', kapat);
setInterval(() => { try { depo.diskeYaz(); } catch (e) {} }, 5000);

sunucu.listen(PORT, '0.0.0.0', () => {
  console.log('\n  FİNCANLAR ERP — YEREL SUNUCU ÇALIŞIYOR\n');
  console.log('  Bu bilgisayardan : http://localhost:' + PORT);
  for (const [ad, liste] of Object.entries(os.networkInterfaces())) for (const a of liste) if (a.family === 'IPv4' && !a.internal) console.log('  Diğer bilgisayar : http://' + a.address + ':' + PORT + '   (' + ad + ')');
  console.log('\n  Bu pencereyi KAPATMAYIN. Veri: ' + VERI + '\n');
});
