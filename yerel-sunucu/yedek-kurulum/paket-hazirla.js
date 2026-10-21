'use strict';
// SATIS bilgisayarında (çalışan sunucuda) çalıştırılır: "hızlı kurulum paketini" flash belleğe hazırlar.
//   node paket-hazirla.js [--kok C:\YerelSunucu\FincanlarERP] [--hedef E:\] [--cikis <klasör>] [--parola <parola>]
// Paket: <flash>\FincanlarERP-Yedek\HIZLI-KURULUM\  (kod + taşınabilir node + şifreli anahtarlar + kurulum betiği + son veri)
// Sunucuya DOKUNMAZ: yalnız okur ve kopyalar. Sunucu çalışırken de çalıştırılabilir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const o = require('./kur/ortak');

function arg(ad) { const i = process.argv.indexOf('--' + ad); return i > -1 ? process.argv[i + 1] : undefined; }
const log = (...a) => console.log(...a);
const WIN = process.platform === 'win32';

function kokBul() {
  const adaylar = [arg('kok'), process.env.FERP_KOK, path.join(__dirname, '..'), WIN ? 'C:\\YerelSunucu\\FincanlarERP' : ''].filter(Boolean);
  for (const k of adaylar) if (fs.existsSync(path.join(k, 'src', 'server.js'))) return path.resolve(k);
  return '';
}

async function flashListe() {
  if (!WIN) return [];
  const c = await o.powershell("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID + '|' + $_.VolumeName + '|' + $_.FreeSpace }");
  return c.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Z]:\|/.test(s)).map((s) => { const p = s.split('|'); return { harf: p[0], ad: p[1] || 'Flash', bos: Number(p[2]) || 0 }; });
}

async function main() {
  log('\n=== Fincanlar ERP: HIZLI KURULUM PAKETİ HAZIRLA ===\n');
  const KOK = kokBul();
  if (!KOK) { log('HATA: Sunucu klasörü bulunamadı. Şöyle deneyin: node paket-hazirla.js --kok "C:\\YerelSunucu\\FincanlarERP"'); process.exit(1); }
  const VERIKL = path.join(KOK, 'veri');
  log('Sunucu klasörü :', KOK);

  // ── Hedef (flash) ──
  let hedefKok = arg('hedef');
  if (!hedefKok) {
    const liste = await flashListe();
    if (liste.length) {
      log('Takılı flash/çıkarılabilir sürücüler:');
      liste.forEach((x, i) => log(`  ${i + 1}) ${x.harf}  ${x.ad}  (boş: ${o.mb(x.bos)})`));
      const s = await o.soru('Hangisine hazırlansın? Numarayı ya da sürücü harfini/yolu yazın:', liste.length === 1 ? '1' : '');
      const n = parseInt(s, 10);
      hedefKok = n >= 1 && n <= liste.length ? liste[n - 1].harf + '\\' : s;
    } else {
      hedefKok = await o.soru('Flash takılı görünmüyor. Paketin yazılacağı sürücü/klasör (örnek E:\\):', '');
    }
  }
  hedefKok = (hedefKok || '').trim().replace(/^"|"$/g, '');
  if (!hedefKok || !fs.existsSync(hedefKok)) { log('HATA: Hedef bulunamadı:', hedefKok || '(boş)'); process.exit(1); }
  if (path.resolve(hedefKok).toLowerCase().startsWith(KOK.toLowerCase())) { log('HATA: Hedef sunucu klasörünün içinde olamaz.'); process.exit(1); }
  const PAKET = path.join(hedefKok, 'FincanlarERP-Yedek', 'HIZLI-KURULUM');
  log('Paket yeri     :', PAKET, '\n');

  // ── Anahtarlar (şifreli) ──
  const gizli = {};
  for (const ad of ['yedek-ayar.json', 'ozellikler.json']) {
    try { gizli[ad] = fs.readFileSync(path.join(VERIKL, ad), 'utf8'); } catch (e) { /* yoksa atlanır */ }
  }
  if (!gizli['yedek-ayar.json']) log('UYARI: veri\\yedek-ayar.json yok. Bulut yedek anahtarı paketlenemiyor (sunucu hiç açılmamış olabilir).');
  else { try { const a = JSON.parse(gizli['yedek-ayar.json']); if (!a.anahtar || a.anahtar.length < 20) log('UYARI: yedek-ayar.json içinde anahtar bulunamadı.'); } catch (e) { log('UYARI: yedek-ayar.json okunamadı.'); } }
  let parola = arg('parola');
  let sifreliDosya = null;
  if (Object.keys(gizli).length) {
    log('Anahtar dosyası parolayla şifrelenecek. Bu parolayı SİZ belirlersiniz; kurulumda sorulur.');
    log('Parolayı flash\'ın ya da mailin YANINDA saklamayın (ör. evde kâğıtta, ayrı yerde).\n');
    while (!parola) {
      const p1 = await o.parolaSor('Parola (en az 8 karakter):');
      if (p1.length < 8) { log('  Çok kısa, tekrar deneyin.'); continue; }
      const p2 = await o.parolaSor('Parola (tekrar):');
      if (p1 !== p2) { log('  Parolalar aynı değil, tekrar deneyin.'); continue; }
      parola = p1;
    }
    sifreliDosya = o.sifrele(gizli, parola);
    // doğrulama: şifreli dosya gerçekten açılıyor mu
    const geri = o.coz(sifreliDosya, parola);
    if (Object.keys(geri.dosyalar).length !== Object.keys(gizli).length) throw new Error('Şifreleme doğrulanamadı');
    log('Anahtar dosyası şifrelendi ve açılabildiği doğrulandı.');
  }

  // ── Paketi yaz ──
  fs.mkdirSync(PAKET, { recursive: true });
  for (const eski of ['kod', 'kur', 'araclar', 'node']) fs.rmSync(path.join(PAKET, eski), { recursive: true, force: true });

  const HARIC = ['veri', 'yedek', 'surum-yedek', 'yedek-kurulum', 'HIZLI-KURULUM'];
  const nm = path.join(KOK, 'node_modules');
  if (!fs.existsSync(nm)) HARIC.push('node_modules');
  log('\nKod kopyalanıyor...');
  const adet = o.kodKopyala(KOK, path.join(PAKET, 'kod'), HARIC);
  log('  ' + adet + ' öğe kopyalandı (veri ve yedekler alınmadı)');

  log('Kurulum betikleri kopyalanıyor...');
  fs.mkdirSync(path.join(PAKET, 'kur'), { recursive: true });
  for (const f of ['kur.js', 'ortak.js']) fs.copyFileSync(path.join(__dirname, 'kur', f), path.join(PAKET, 'kur', f));
  fs.copyFileSync(path.join(__dirname, 'YEDEK-KUR.bat'), path.join(PAKET, 'YEDEK-KUR.bat'));
  // başlatma araçları: önce paketle gelen, yoksa sunucu klasöründeki
  fs.mkdirSync(path.join(PAKET, 'araclar'), { recursive: true });
  for (const f of ['BASLAT-GIZLI.vbs', 'DURDUR.bat']) {
    for (const k of [path.join(__dirname, 'araclar', f), path.join(__dirname, '..', 'araclar', f), path.join(KOK, f)]) {
      if (fs.existsSync(k)) { fs.copyFileSync(k, path.join(PAKET, 'araclar', f)); break; }
    }
  }

  log('Node kopyalanıyor...');
  fs.mkdirSync(path.join(PAKET, 'node'), { recursive: true });
  const nodeExe = fs.existsSync(path.join(KOK, 'node', 'node.exe')) ? path.join(KOK, 'node', 'node.exe') : process.execPath;
  fs.copyFileSync(nodeExe, path.join(PAKET, 'node', WIN ? 'node.exe' : 'node'));
  log('  ' + nodeExe + '  (' + o.mb(fs.statSync(nodeExe).size) + ')');

  if (sifreliDosya) fs.writeFileSync(path.join(PAKET, 'anahtarlar.sifreli'), sifreliDosya);

  // ── Son veri anlık görüntüsü (flash'ta başka yedek yoksa da veri bulunsun) ──
  const veriDosya = path.join(VERIKL, 'veri.json');
  fs.rmSync(path.join(PAKET, 'veri'), { recursive: true, force: true });
  if (fs.existsSync(veriDosya)) {
    const ham = fs.readFileSync(veriDosya), d = o.dogrula(ham);
    if (d.ok) {
      fs.mkdirSync(path.join(PAKET, 'veri'), { recursive: true });
      fs.writeFileSync(path.join(PAKET, 'veri', 'veri-' + o.damgaSimdi() + '.json'), ham);
      log('Veri anlık görüntüsü: ' + d.kitap + ' e-tablo, ' + d.sayfa + ' sayfa, ' + o.mb(d.bayt));
    } else log('UYARI: Veri anlık görüntüsü alınmadı (' + d.neden + ').');
  } else log('UYARI: veri\\veri.json bulunamadı; paket verisiz hazırlandı (kurulumda yedekten yüklenir).');

  // ── Ayar (gizli bilgi içermez) + okuma dosyası ──
  const ipler = [];
  const ni = os.networkInterfaces();
  for (const ad of Object.keys(ni)) for (const x of ni[ad]) if (x.family === 'IPv4' && !x.internal) ipler.push(x.address);
  const ayar = { surum: 1, hazirlanma: new Date().toISOString(), satisBilgisayar: os.hostname(), satisIp: ipler[0] || '192.168.1.103', port: 3000, kokYol: KOK };
  fs.writeFileSync(path.join(PAKET, 'ayar.json'), JSON.stringify(ayar, null, 2));
  fs.writeFileSync(path.join(PAKET, 'OKU-BENI.txt'), [
    'FINCANLAR ERP - HIZLI KURULUM (yedek bilgisayarda yerel sunucuyu ayağa kaldırır)',
    '',
    'NE ZAMAN: SATIS bilgisayarı bozuldu / açılmıyor ve sunucu başka bir bilgisayarda çalıştırılacaksa.',
    'ÖNCE: SATIS gerçekten kapalı mı? Aynı anda iki sunucu çalışmamalı.',
    '',
    'NASIL:',
    '  1) Bu flash\'ı yedek bilgisayara takın.',
    '  2) HIZLI-KURULUM klasöründeki YEDEK-KUR.bat dosyasına çift tıklayın (yönetici izni isterse "Evet").',
    '  3) Ekrandaki soruları yanıtlayın: anahtar parolası, veri yedeği (en yenisi önerilir), IP adresi.',
    '  4) En sonda yazan adresi (http://...:3000) diğer bilgisayarlarda açın.',
    '',
    'Parola: anahtarlar.sifreli dosyasının parolası. Bu dosya farklı bir mail hesabında da saklanmalıdır.',
    'Ayrıntılı kılavuz: GitHub > yerel-sunucu/protokoller/YEDEK-SUNUCU-KURULUM.md',
    '',
    'Hazırlanma: ' + ayar.hazirlanma + '   (SATIS: ' + ayar.satisBilgisayar + ')',
  ].join('\r\n'));

  // ── Flash dışı kopyalar: şifreli anahtar dosyası (mail için) + tüm paketin ZIP'i (Drive için) ──
  let cikis = arg('cikis');
  if (!cikis) {
    const masa = path.join(os.homedir(), 'Desktop');
    cikis = await o.soru('Mail/Drive için kopyalar nereye konsun?', fs.existsSync(masa) ? path.join(masa, 'FincanlarERP-Yedek-Kopya') : path.join(hedefKok, 'FincanlarERP-Yedek-Kopya'));
  }
  fs.mkdirSync(cikis, { recursive: true });
  if (sifreliDosya) {
    fs.writeFileSync(path.join(cikis, 'anahtarlar.sifreli'), sifreliDosya);
    log('\nMail kopyası (yalnız şifreli anahtarlar):', path.join(cikis, 'anahtarlar.sifreli'));
  }
  const zipIste = arg('zip') !== undefined ? arg('zip') !== 'hayir' : await o.evetMi('Flash olmadan da kurulabilmesi için tüm paketin ZIP\'i (Drive\'a koymak için) hazırlansın mı? (veri hariç, anahtarlar şifreli)', true);
  if (zipIste) {
    const zip = path.join(cikis, 'FincanlarERP-HizliKurulum.zip');
    fs.rmSync(zip, { force: true });
    log('ZIP hazırlanıyor (bir-iki dakika sürebilir)...');
    let r;
    if (WIN) {
      r = await o.powershell("$p='" + PAKET.replace(/'/g, "''") + "'; $z='" + zip.replace(/'/g, "''") + "'; $i = Get-ChildItem -LiteralPath $p | Where-Object { $_.Name -ne 'veri' }; Compress-Archive -LiteralPath $i.FullName -DestinationPath $z -Force", 900000);
    } else {
      r = await o.calistir('sh', ['-c', 'cd "' + PAKET + '" && zip -r -q "' + zip + '" . -x "veri/*"'], 600000);
    }
    if (r.ok && fs.existsSync(zip)) log('ZIP hazır:', zip, '(' + o.mb(fs.statSync(zip).size) + ')');
    else log('UYARI: ZIP hazırlanamadı: ' + (r.err || r.out || '').trim().slice(0, 200));
  }

  log('\n=== TAMAM ===');
  log('Paket          :', PAKET);
  log('Sonraki adımlar:');
  log('  1) Kopya klasöründeki dosyaları FARKLI bir hesaba koyun: anahtarlar.sifreli (mail eki) ve ZIP (Drive). Parola dosyayla aynı yerde olmasın.');
  log('  2) Parolayı bir yere (kâğıt) yazın. Parola kaybolursa dosya açılmaz.');
  log('  3) Büyük güncellemelerden sonra bu betiği yeniden çalıştırın (paket yenilenir).');
  o.girdiKapat();
}
main().catch((e) => { console.error('\nHATA:', e && e.stack ? e.stack : e); process.exit(1); });
