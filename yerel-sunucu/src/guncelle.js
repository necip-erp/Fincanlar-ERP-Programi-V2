'use strict';
// Yerel sunucu GÜNCELLEME motoru (15 Eki 2026) — GitHub'daki güncel programı yerel sunucuya alır.
//   Ekranlar        : GitHub index.html (+ manifest, simgeler)       → onyuz\
//   Arka plan kodu  : GitHub backend\*.gs                            → arka-plan\
//   Sunucu dosyaları: GitHub yerel-sunucu\src\*.js                   → src\   (runtime.js / senkron-istek.js GitHub'da YOK, dokunulmaz)
// Güvenlik: yalnız DEĞİŞEN dosyalar indirilir; her dosya GitHub'ın özetiyle doğrulanır; .js/.gs sözdizimi denenir;
// eski dosyalar surum-yedek\<tarih>\ içine alınır (son 8 tutulur); veri.json kopyası veri\yedek\ içine alınır;
// uygulama sonunda sunucu kendini kapatır (otomatik yeniden açılır). "Önceki sürüme dön" ile geri alınır.
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const vm = require('vm');

const SAHIP = 'necip-erp', DEPO = 'Fincanlar-ERP-Programi-V2', DAL = 'main';
const ONYUZ_DOSYALARI = new Set(['index.html', 'manifest.json', 'fincanlar-logo.png', 'icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png']);
const YEDEK_SAKLA = 8;

function damga() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
}
const blobSha = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + '\0'), b])).digest('hex');

function indir(adres, ham, kalan) {
  kalan = kalan === undefined ? 5 : kalan;
  const taban = process.env.GUNCELLE_TEST_TABAN;   // yalnız deneme için
  if (taban) adres = adres.replace(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)/, taban + '/$1');
  return new Promise((coz, red) => {
    const u = new URL(adres); const mod = u.protocol === 'http:' ? require('http') : https;
    const r = mod.get(u, { headers: { 'User-Agent': 'FincanlarERP-YerelSunucu', 'Accept': ham ? '*/*' : 'application/vnd.github+json', 'Accept-Encoding': 'gzip' }, timeout: 120000 }, (y) => {
      if (y.statusCode >= 300 && y.statusCode < 400 && y.headers.location && kalan > 0) { y.resume(); return coz(indir(new URL(y.headers.location, u).toString(), ham, kalan - 1)); }
      const p = []; y.on('data', (c) => p.push(c));
      y.on('end', () => {
        let b = Buffer.concat(p);
        try { if (y.headers['content-encoding'] === 'gzip') b = zlib.gunzipSync(b); } catch (e) { return red(new Error('GitHub yanıtı açılamadı')); }
        if (y.statusCode === 403 && /rate limit/i.test(b.toString('utf8'))) return red(new Error('GitHub kısa süreli istek sınırına takıldı; birkaç dakika sonra tekrar deneyin'));
        if (y.statusCode !== 200) return red(new Error('GitHub yanıtı HTTP ' + y.statusCode));
        if (ham) return coz(b);
        try { coz(JSON.parse(b.toString('utf8'))); } catch (e) { red(new Error('GitHub yanıtı okunamadı')); }
      });
      y.on('error', red);
    });
    r.on('timeout', () => r.destroy(new Error('GitHub yanıt vermedi (internet bağlantısını kontrol edin)')));
    r.on('error', (e) => red(new Error(/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(e.code || '') ? 'İnternet bağlantısı yok (GitHub\'a ulaşılamadı)' : e.message)));
  });
}

// Geri alma (sunucu kapalıyken de çalışabilsin diye bağımsız): surum-yedek\<ad> içindekileri yerine koyar.
function yedekler(KOK) {
  const kl = path.join(KOK, 'surum-yedek');
  try { return fs.readdirSync(kl).filter((a) => fs.statSync(path.join(kl, a)).isDirectory()).sort().reverse(); } catch (e) { return []; }
}
function geriAlDosyadan(KOK, ad) {
  const liste = yedekler(KOK); ad = ad || liste[0];
  if (!ad || !liste.includes(ad)) throw new Error('Geri alınacak yedek bulunamadı');
  const kok = path.join(KOK, 'surum-yedek', ad); let adet = 0;
  (function yuru(d, goreli) {
    for (const f of fs.readdirSync(d)) {
      const k = path.join(d, f), g = goreli ? goreli + '/' + f : f;
      if (fs.statSync(k).isDirectory()) { yuru(k, g); continue; }
      if (g === '_surum.json') { try { fs.copyFileSync(k, path.join(KOK, 'veri', 'surum.json')); } catch (e) {} continue; }
      if (g === '_yeni.json') continue;
      const hedef = path.join(KOK, g); fs.mkdirSync(path.dirname(hedef), { recursive: true });
      fs.copyFileSync(k, hedef + '.geri'); fs.renameSync(hedef + '.geri', hedef); adet++;
    }
  })(kok, '');
  // güncellemenin YENİ eklediği dosyalar (eskisi yoktu) geri almada silinir; yalnız KOK içindeki yollar
  try { for (const g of JSON.parse(fs.readFileSync(path.join(kok, '_yeni.json'), 'utf8'))) { const h = path.join(KOK, g); if (h.startsWith(KOK + path.sep)) { try { fs.unlinkSync(h); adet++; } catch (e) {} } } } catch (e) {}
  if (!fs.existsSync(path.join(kok, '_surum.json'))) { try { fs.unlinkSync(path.join(KOK, 'veri', 'surum.json')); } catch (e) {} }
  return { ad, adet };
}

function baslat(o) {
  const { KOK, ONYUZ, ARKA, VERI, depo } = o;
  const log = o.log || ((...a) => console.log('  [güncelle]', ...a));
  const SURUM = path.join(path.dirname(VERI), 'surum.json');
  const durum = { islem: false, asama: '', ilerleme: 0, toplam: 0, hata: '', bitti: false, mesaj: '', sonKontrol: 0, uzak: null, degisen: [], yeniden: false };
  let yerel = null; try { yerel = JSON.parse(fs.readFileSync(SURUM, 'utf8')); } catch (e) {}

  function hedefYolu(yol) {
    if (ONYUZ_DOSYALARI.has(yol)) return path.join(ONYUZ, yol);
    let m = /^backend\/([^\/]+\.gs)$/.exec(yol); if (m) return path.join(ARKA, m[1]);
    m = /^yerel-sunucu\/src\/([^\/]+\.js)$/.exec(yol); if (m) return path.join(KOK, 'src', m[1]);
    return null;
  }
  function goreliYol(hedef) { return path.relative(KOK, hedef).split(path.sep).join('/'); }

  async function kontrol() {
    const c = await indir(`https://api.github.com/repos/${SAHIP}/${DEPO}/commits/${DAL}`);
    const sha = c.sha;
    const agac = await indir(`https://api.github.com/repos/${SAHIP}/${DEPO}/git/trees/${c.commit.tree.sha}?recursive=1`);
    if (agac.truncated) throw new Error('GitHub dosya listesi eksik geldi');
    const degisen = [];
    for (const d of agac.tree) {
      if (d.type !== 'blob') continue;
      const h = hedefYolu(d.path); if (!h) continue;
      let yerelSha = null; try { yerelSha = blobSha(fs.readFileSync(h)); } catch (e) {}
      if (yerelSha !== d.sha) degisen.push({ yol: d.path, hedef: h, sha: d.sha, boyut: d.size, yeni: yerelSha === null });
    }
    durum.uzak = { sha, tarih: c.commit.committer && c.commit.committer.date, mesaj: String(c.commit.message || '').split('\n')[0].slice(0, 200) };
    durum.degisen = degisen; durum.sonKontrol = Date.now();
    return degisen;
  }

  function sozdizimiDene(yol, buf) {
    const s = buf.toString('utf8');
    if (/\.(js|gs)$/.test(yol)) { try { new vm.Script(s, { filename: yol }); } catch (e) { throw new Error(yol + ' dosyasında sözdizimi hatası: ' + e.message); } }
    if (yol === 'index.html' && (buf.length < 500000 || !/const CARI_API = "https:\/\/script\.google\.com/.test(s))) throw new Error('index.html beklenen biçimde değil');
    if (yol === 'manifest.json') JSON.parse(s);
  }

  async function uygula() {
    if (durum.islem) return { ok: false, hata: 'Güncelleme zaten sürüyor' };
    Object.assign(durum, { islem: true, hata: '', bitti: false, mesaj: '', asama: 'Kontrol ediliyor...', ilerleme: 0, toplam: 0 });
    try {
      // arka-plan klasörü beklenen düzende değilse (ör. dosyalar farklı adlarla/uzantıyla duruyorsa) çift tanım olmasın diye hiçbir şey yapılmaz
      if (!fs.existsSync(path.join(ARKA, 'Code.gs'))) throw new Error('arka-plan klasöründe Code.gs yok — klasör düzeni beklenenden farklı, güncelleme yapılmadı');
      const degisen = await kontrol();
      if (!degisen.length) {
        yerel = { sha: durum.uzak.sha, tarih: durum.uzak.tarih, mesaj: durum.uzak.mesaj, uygulama: Date.now() }; fs.writeFileSync(SURUM, JSON.stringify(yerel));
        Object.assign(durum, { islem: false, bitti: false, asama: '', mesaj: 'Zaten güncel — değişen dosya yok' }); return { ok: true, guncel: true };
      }
      durum.toplam = degisen.length; const alinan = [];
      for (const d of degisen) {                                    // 1) hepsini indir + doğrula (henüz hiçbir şeye dokunulmadı)
        durum.asama = 'İndiriliyor: ' + d.yol;
        const buf = await indir(`https://raw.githubusercontent.com/${SAHIP}/${DEPO}/${durum.uzak.sha}/${d.yol.split('/').map(encodeURIComponent).join('/')}`, true);
        if (blobSha(buf) !== d.sha) throw new Error(d.yol + ' indirilirken bozuldu (özet uyuşmadı), tekrar deneyin');
        sozdizimiDene(d.yol, buf); alinan.push({ d, buf }); durum.ilerleme++;
      }
      durum.asama = 'Eski sürüm yedekleniyor...';                   // 2) yedekle
      const ad = damga(), yk = path.join(KOK, 'surum-yedek', ad);
      const yeniler = [];
      for (const { d } of alinan) { const g = goreliYol(d.hedef); if (!fs.existsSync(d.hedef)) { yeniler.push(g); continue; } try { const k = path.join(yk, g); fs.mkdirSync(path.dirname(k), { recursive: true }); fs.copyFileSync(d.hedef, k); } catch (e) { throw new Error('Eski dosya yedeklenemedi (' + g + '): ' + e.message); } }
      try { fs.mkdirSync(yk, { recursive: true }); if (yerel && yerel.sha) fs.writeFileSync(path.join(yk, '_surum.json'), JSON.stringify(yerel)); fs.writeFileSync(path.join(yk, '_yeni.json'), JSON.stringify(yeniler)); } catch (e) {}
      try {
        depo.diskeYaz(); const kl = path.join(path.dirname(VERI), 'yedek'); fs.mkdirSync(kl, { recursive: true });
        fs.copyFileSync(VERI, path.join(kl, 'guncelleme-oncesi-' + ad + '.json'));
        const eski = fs.readdirSync(kl).filter((f) => /^guncelleme-oncesi-/.test(f)).sort(); while (eski.length > 3) fs.unlinkSync(path.join(kl, eski.shift()));
      } catch (e) { log('veri kopyası alınamadı:', e.message); }
      const yed = yedekler(KOK); for (const eski of yed.slice(YEDEK_SAKLA)) { try { fs.rmSync(path.join(KOK, 'surum-yedek', eski), { recursive: true, force: true }); } catch (e) {} }
      durum.asama = 'Dosyalar yerleştiriliyor...';                  // 3) yerleştir (her dosya önce geçiciye, sonra yeniden adlandırma)
      for (const { d, buf } of alinan) { fs.mkdirSync(path.dirname(d.hedef), { recursive: true }); fs.writeFileSync(d.hedef + '.yeni', buf); fs.renameSync(d.hedef + '.yeni', d.hedef); }
      yerel = { sha: durum.uzak.sha, tarih: durum.uzak.tarih, mesaj: durum.uzak.mesaj, uygulama: Date.now() }; fs.writeFileSync(SURUM, JSON.stringify(yerel));
      durum.degisen = []; durum.bitti = true; durum.yeniden = true; durum.islem = false; durum.asama = '';
      durum.mesaj = alinan.length + ' dosya güncellendi — sunucu yeniden başlıyor';
      log(durum.mesaj); yenidenBaslat();
      return { ok: true };
    } catch (e) {
      Object.assign(durum, { islem: false, asama: '', hata: e.message }); log('güncelleme başarısız:', e.message);
      return { ok: false, hata: e.message };
    }
  }
  function yenidenBaslat() { const t = setTimeout(() => { try { depo.diskeYaz(); } catch (e) {} process.exit(0); }, 2500); if (t.unref) t.unref(); }

  function geriAl(ad) {
    if (durum.islem) return { ok: false, hata: 'Güncelleme sürüyor' };
    try {
      depo.diskeYaz(); const r = geriAlDosyadan(KOK, ad);
      try { yerel = JSON.parse(fs.readFileSync(SURUM, 'utf8')); } catch (e) { yerel = null; } if (yerel && !yerel.sha) yerel = null;
      Object.assign(durum, { bitti: true, yeniden: true, hata: '', degisen: [], mesaj: r.adet + ' dosya önceki sürüme döndü — sunucu yeniden başlıyor' }); yenidenBaslat();
      return { ok: true, adet: r.adet };
    } catch (e) { return { ok: false, hata: e.message }; }
  }

  // Ekranın (Admin) kullandığı arayüz
  function durumVer() {
    return JSON.parse(JSON.stringify({
      yerel, uzak: durum.uzak, sonKontrol: durum.sonKontrol,
      degisen: durum.degisen.map((d) => ({ yol: d.yol, yeni: d.yeni })),
      islem: durum.islem, asama: durum.asama, ilerleme: durum.ilerleme, toplam: durum.toplam, hata: durum.hata, bitti: durum.bitti, mesaj: durum.mesaj, yeniden: durum.yeniden,
      yedekler: yedekler(KOK).slice(0, YEDEK_SAKLA),
    }));
  }
  function kontrolBaslat() {
    if (durum.islem) return { ok: true };
    durum.hata = ''; durum.mesaj = ''; durum.islem = true; durum.asama = 'GitHub kontrol ediliyor...';
    kontrol().then(() => { durum.mesaj = durum.degisen.length ? '' : 'Program güncel — değişen dosya yok'; })
      .catch((e) => { durum.hata = e.message; }).finally(() => { durum.islem = false; durum.asama = ''; });
    return { ok: true };
  }
  function uygulaBaslat() { uygula(); return { ok: true }; }
  return { durum: durumVer, kontrol: kontrolBaslat, uygula: uygulaBaslat, geriAl };
}

module.exports = { baslat, geriAlDosyadan, yedekler };
