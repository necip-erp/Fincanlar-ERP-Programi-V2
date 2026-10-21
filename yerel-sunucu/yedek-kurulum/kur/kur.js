'use strict';
// YEDEK BİLGİSAYARDA yerel sunucuyu hızlıca ayağa kaldırır (YEDEK-KUR.bat çalıştırır).
//   1) SATIS açık mı kontrolü  2) kodu kur  3) şifreli anahtarları aç  4) en yeni veri yedeğini seç/yükle
//   5) IP / güvenlik duvarı / uyku / otomatik başlatma  6) sunucuyu aç ve doğrula
// Gizli bilgi içermez; anahtarlar yalnız "anahtarlar.sifreli" dosyasında ve parolayla açılır.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const o = require('./ortak');

const WIN = process.platform === 'win32';
const TEST = !!process.env.KUR_TEST;                       // Windows dışında deneme: ağ/güvenlik duvarı/kısayol adımları atlanır
const PAKET = path.resolve(__dirname, '..');
const HEDEF = process.env.KUR_HEDEF || 'C:\\YerelSunucu\\FincanlarERP';
const oku = (y) => { try { return JSON.parse(fs.readFileSync(y, 'utf8')); } catch (e) { return null; } };
const AYAR = oku(path.join(PAKET, 'ayar.json')) || {};
const PORT = Number(AYAR.port) || 3000;
const SATIS_IP = AYAR.satisIp || '192.168.1.103';
const log = (...a) => console.log(...a);
const baslik = (s) => log('\n── ' + s + ' ──');
const kayit = [];                                           // KURULUM-KAYIT.txt için
const not = (s) => { kayit.push(s); };
const uyarilar = [];
const uyari = (s) => { uyarilar.push(s); log('  UYARI: ' + s); };

function kodGecerli(k) { return ['src/server.js', 'src/runtime.js', 'onyuz/index.html'].every((f) => fs.existsSync(path.join(k, f))); }
function httpDene(host, port, ms) {
  return new Promise((coz) => {
    const r = http.get({ host, port, path: '/', timeout: ms || 2500 }, (y) => { y.resume(); coz(true); });
    r.on('timeout', () => { r.destroy(); coz(false); });
    r.on('error', () => coz(false));
  });
}
function bekle(ms) { return new Promise((c) => setTimeout(c, ms)); }
function istanbulSimdiT() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
function yasMetni(t) {
  const dk = Math.round((istanbulSimdiT() - t) / 60000);
  if (dk < 1) return 'az önce';
  if (dk < 90) return dk + ' dk önce';
  if (dk < 48 * 60) return Math.round(dk / 60) + ' saat önce';
  return Math.round(dk / 1440) + ' gün önce';
}
const maske = (n) => [0, 1, 2, 3].map((i) => { const b = Math.max(0, Math.min(8, n - i * 8)); return 256 - Math.pow(2, 8 - b); }).join('.');

// ───────────────────────── 1) SATIS kontrolü ─────────────────────────
async function satisKontrol() {
  baslik('1/7  SATIS bilgisayarı kontrolü');
  log('ÖNEMLİ: Aynı anda iki sunucu çalışmamalı. SATIS ya da başka bir bilgisayarda sunucu açıksa veriler ikiye ayrılır.');
  if (await httpDene('127.0.0.1', PORT, 1500)) {
    log('\n  Bu bilgisayarda ' + PORT + ' numaralı portta zaten bir sunucu çalışıyor.');
    log('  Önce DURDUR.bat ile durdurun (ya da bu bilgisayar zaten sunucuysa kurulum gerekmez).');
    throw new Error('Bu bilgisayarda sunucu zaten çalışıyor');
  }
  const bizim = Object.values(os.networkInterfaces()).flat().some((x) => x && x.address === SATIS_IP);
  if (!bizim && await httpDene(SATIS_IP, PORT, 2500)) {
    log('\n  !!! ' + SATIS_IP + ':' + PORT + ' adresinde bir sunucu CEVAP VERİYOR (SATIS çalışıyor olabilir).');
    log('  Çalışan bir sunucu varken ikincisini kurmak verileri ikiye böler.');
    const c = await o.soru('  Eminseniz tam olarak şunu yazın: SATIS KAPALI  (vazgeçmek için Enter):', '');
    if (c.toUpperCase() !== 'SATIS KAPALI') throw new Error('Vazgeçildi (SATIS çalışıyor görünüyor)');
    not('SATIS ' + SATIS_IP + ' cevap veriyordu; kullanıcı onayladı.');
  } else log('  SATIS (' + SATIS_IP + ':' + PORT + ') cevap vermiyor: devam edilebilir.');
}

// ───────────────────────── 2) Kod ─────────────────────────
async function kodKur() {
  baslik('2/7  Program kodu');
  const kopya = path.join(PAKET, 'kod');
  const rutin = path.join(PAKET, '..', 'KOD');             // flash'a günde 2 kez yazılan en güncel kod kopyası
  const adaylar = [];
  if (kodGecerli(kopya)) adaylar.push({ ad: 'Paketteki kod (' + (AYAR.hazirlanma ? new Date(AYAR.hazirlanma).toLocaleString('tr-TR') : 'tarih yok') + ' hazırlanmış)', yol: kopya, t: AYAR.hazirlanma ? Date.parse(AYAR.hazirlanma) : 0 });
  if (kodGecerli(rutin)) { let t = 0; try { t = fs.statSync(path.join(rutin, 'src', 'server.js')).mtimeMs; } catch (e) {} adaylar.push({ ad: 'Flash\'ın düzenli kod kopyası (KOD)', yol: rutin, t }); }
  if (!adaylar.length) throw new Error('Kod bulunamadı: pakette "kod" klasörü yok ya da eksik (src\\server.js, src\\runtime.js, onyuz\\index.html aranır)');
  adaylar.sort((a, b) => b.t - a.t);
  let secim = adaylar[0];
  if (adaylar.length > 1) {
    adaylar.forEach((a, i) => log('  ' + (i + 1) + ') ' + a.ad + (a.t ? '  — ' + new Date(a.t).toLocaleString('tr-TR') : '') + (i === 0 ? '   (öneri: en yeni)' : '')));
    const n = parseInt(await o.soru('  Hangisi kullanılsın?', '1'), 10);
    if (n >= 1 && n <= adaylar.length) secim = adaylar[n - 1];
  } else log('  Kullanılacak kod: ' + secim.ad);

  // Var olan hedef klasöre dokunma: adını değiştir
  if (fs.existsSync(HEDEF)) {
    const eski = HEDEF + '-eski-' + o.damgaSimdi();
    log('  ' + HEDEF + ' zaten var; adı değiştiriliyor: ' + eski);
    fs.renameSync(HEDEF, eski); not('Eski klasör: ' + eski);
  }
  fs.mkdirSync(path.dirname(HEDEF), { recursive: true });
  const adet = o.kodKopyala(secim.yol, HEDEF, ['veri', 'yedek', 'surum-yedek', 'yedek-kurulum', 'HIZLI-KURULUM']);
  fs.mkdirSync(path.join(HEDEF, 'veri'), { recursive: true });
  log('  ' + adet + ' öğe ' + HEDEF + ' içine kopyalandı.');
  not('Kod kaynağı: ' + secim.ad);

  // node (taşınabilir)
  const nodeKaynak = path.join(PAKET, 'node', WIN ? 'node.exe' : 'node');
  if (fs.existsSync(nodeKaynak)) { fs.mkdirSync(path.join(HEDEF, 'node'), { recursive: true }); fs.copyFileSync(nodeKaynak, path.join(HEDEF, 'node', WIN ? 'node.exe' : 'node')); log('  Taşınabilir node kopyalandı.'); }
  else log('  Pakette node yok; bilgisayardaki node kullanılacak.');

  // başlatma betiği: eski BASLAT.bat'ı sakla, yenisini yaz (yeniden başlatma döngülü)
  const bat = path.join(HEDEF, 'BASLAT.bat');
  if (fs.existsSync(bat)) fs.copyFileSync(bat, path.join(HEDEF, 'BASLAT-orijinal.bat'));
  fs.writeFileSync(bat, [
    '@echo off', 'title Fincanlar ERP Yerel Sunucu', 'cd /d "%~dp0"',
    'set "NODE=node"', 'if exist "%~dp0node\\node.exe" set "NODE=%~dp0node\\node.exe"',
    ':dongu', '"%NODE%" src\\server.js', 'echo Sunucu kapandi, 5 saniye sonra yeniden acilacak...', 'timeout /t 5 /nobreak >nul', 'goto dongu', '',
  ].join('\r\n'));
  for (const f of ['BASLAT-GIZLI.vbs', 'DURDUR.bat']) {
    const k = path.join(PAKET, 'araclar', f);
    if (!fs.existsSync(path.join(HEDEF, f)) && fs.existsSync(k)) fs.copyFileSync(k, path.join(HEDEF, f));
  }
}

// ───────────────────────── 3) Anahtarlar ─────────────────────────
async function anahtarlar() {
  baslik('3/7  Anahtarlar (şifreli dosya)');
  let dosya = path.join(PAKET, 'anahtarlar.sifreli');
  for (let tur = 0; tur < 3 && !fs.existsSync(dosya); tur++) {
    log('  anahtarlar.sifreli pakette bulunamadı. Mail kopyasını bu bilgisayara indirip yolunu yazabilirsiniz.');
    const y = (await o.soru('  Dosya yolu (atlamak için Enter):', '')).replace(/^"|"$/g, '');
    if (!y) break;
    dosya = y;
  }
  if (!fs.existsSync(dosya)) return anahtarsiz('Anahtar dosyası yok');
  const buf = fs.readFileSync(dosya);
  for (let d = 1; d <= 3; d++) {
    const p = await o.parolaSor('  Anahtar parolası (' + d + '/3):');
    if (!p) { log('  Boş parola.'); continue; }
    try {
      const c = o.coz(buf, p);
      fs.mkdirSync(path.join(HEDEF, 'veri'), { recursive: true });
      for (const [ad, icerik] of Object.entries(c.dosyalar)) { if (/^[\w.-]+$/.test(ad)) fs.writeFileSync(path.join(HEDEF, 'veri', ad), icerik); }
      const a = oku(path.join(HEDEF, 'veri', 'yedek-ayar.json'));
      if (!a || !a.anahtar || a.anahtar.length < 20) return anahtarsiz('Dosya açıldı ama bulut anahtarı içinde yok');
      log('  Anahtarlar açıldı ve yüklendi: ' + Object.keys(c.dosyalar).join(', '));
      not('Anahtarlar yüklendi (paket tarihi: ' + (c.tarih ? new Date(c.tarih).toLocaleString('tr-TR') : '?') + ')');
      return;
    } catch (e) { log('  ' + e.message); }
  }
  return anahtarsiz('Parola açmadı');
}
async function anahtarsiz(neden) {
  uyari('Anahtarlar yüklenemedi (' + neden + ').');
  log('  Sunucu anahtarsız da açılır ama:');
  log('   - Buluta yedek gitmez ve bulut uyarı e-postası gelmez ("Anahtar uyuşmuyor" hatası);');
  log('   - e-Fatura/e-Arşiv, Resimden Oluştur ayarları buluttan alınamaz.');
  log('  Çözüm: parolayı bulun, ya da Apps Script > Proje ayarları > Komut dosyası özellikleri içinde');
  log('  YEREL_YEDEK_ANAHTAR_OZET satırını silin; yeni sunucunun anahtarı ilk yüklemede kaydolur.');
  if (!(await o.evetMi('  Anahtarsız devam edilsin mi?', false))) throw new Error('Vazgeçildi (anahtarlar yüklenemedi)');
  not('ANAHTARSIZ kuruldu: ' + neden + ' (bulut yedek/uyarı çalışmaz; YEREL_YEDEK_ANAHTAR_OZET sıfırlanmalı)');
}

// ───────────────────────── 4) Veri ─────────────────────────
async function sabitSurucular() {
  if (!WIN) return [];
  const c = await o.powershell("Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } | ForEach-Object { $_.DeviceID }");
  return c.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Z]:$/.test(s)).map((s) => s + '\\');
}
async function veriYukle() {
  baslik('4/7  Veri yedeği');
  const ek = (process.env.KUR_VERI_KLASOR || '').split(';').filter(Boolean);
  const taranacak = () => [path.join(PAKET, 'veri'), path.dirname(PAKET), PAKET, path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), ...ek, ...surucuKokleri];
  let surucuKokleri = [];
  if (WIN) surucuKokleri = (await sabitSurucular()).filter((k) => path.resolve(k).toLowerCase() !== path.resolve(HEDEF).slice(0, 3).toLowerCase());
  for (;;) {
    const liste = o.yedekleriTara(taranacak()).slice(0, 40);
    const goster = [];
    const gorulen = new Set();
    for (const a of liste) { const k = a.tur + a.ad + a.boyut; if (gorulen.has(k)) continue; gorulen.add(k); goster.push(a); if (goster.length >= 8) break; }
    if (!goster.length) {
      log('  Hiç veri yedeği bulunamadı.');
      log('  - Flash\'taki FincanlarERP-Yedek klasörünü ya da Drive\'daki "Yerel Sunucu" klasöründen indirdiğiniz');
      log('    yerel-veri-....json.gz (parçalıysa .001, .002 ... hepsi) dosyalarını bir klasöre koyun.');
    } else {
      log('  Bulunan yedekler (en yeni üstte):');
      goster.forEach((a, i) => log('   ' + (i + 1) + ') ' + (a.tur === 'bulut' ? 'Drive yedeği ' : 'Flash yedeği  ') + o.damgaYaz(a.t) + '  (' + yasMetni(a.t) + ')  ' + o.mb(a.boyut) + (a.eksik ? '  [PARÇA EKSİK]' : '') + '   ' + path.dirname(a.yollar[0])));
    }
    const s = await o.soru('  Numara seçin (Enter = 1 / başka klasör taramak için klasör yolunu yazın / çıkmak için q):', goster.length ? '1' : '');
    if (s.toLowerCase() === 'q') throw new Error('Vazgeçildi (veri seçilmedi)');
    if (/^\d+$/.test(s) && goster[+s - 1]) {
      const a = goster[+s - 1];
      if (a.eksik) { log('  Bu yedeğin parçaları eksik; başka bir yedek seçin.'); continue; }
      let ham, d;
      try { ham = o.yedegiOku(a); d = o.dogrula(ham); } catch (e) { log('  Okunamadı: ' + e.message); continue; }
      if (!d.ok) { log('  Bu yedek kullanılamaz: ' + d.neden); continue; }
      log('  Seçilen: ' + o.damgaYaz(a.t) + '  — ' + d.kitap + ' e-tablo, ' + d.sayfa + ' sayfa' + (d.satir ? ', ' + d.satir + ' kayıt satırı' : '') + ', ' + o.mb(d.bayt));
      if (goster[0] !== a) log('  Not: daha yeni bir yedek vardı (' + o.damgaYaz(goster[0].t) + '); eski yedekle devam edince aradaki işlemler yoktur.');
      if (!(await o.evetMi('  Bu veriyle devam edilsin mi?', true))) continue;
      fs.mkdirSync(path.join(HEDEF, 'veri'), { recursive: true });
      fs.writeFileSync(path.join(HEDEF, 'veri', 'veri.json'), ham);
      not('Veri: ' + (a.tur === 'bulut' ? 'Drive' : 'Flash') + ' yedeği ' + o.damgaYaz(a.t) + ' (' + d.kitap + ' e-tablo, ' + d.sayfa + ' sayfa, ' + o.mb(d.bayt) + ')');
      log('  Veri yüklendi.');
      return;
    }
    if (s && fs.existsSync(s.replace(/^"|"$/g, ''))) { ek.push(s.replace(/^"|"$/g, '')); continue; }
    if (s) log('  Anlaşılamadı / klasör yok: ' + s);
  }
}

// ───────────────────────── 5) Ağ ─────────────────────────
async function agBilgi() {
  const c = await o.powershell("$c=Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1; if($c){ $c.InterfaceAlias + '|' + $c.IPv4Address.IPAddress + '|' + $c.IPv4Address.PrefixLength + '|' + $c.IPv4DefaultGateway.NextHop + '|' + (($c.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) -join ',') }");
  const p = c.out.trim().split('|');
  if (p.length < 4 || !p[0]) return null;
  return { alias: p[0], ip: p[1], prefix: +p[2], gw: p[3], dns: (p[4] || '').split(',').filter(Boolean) };
}
async function agKur() {
  baslik('5/7  Ağ adresi (IP), güvenlik duvarı, uyku');
  if (!WIN || TEST) { log('  (Windows dışı/deneme: atlandı)'); not('Ağ adımları atlandı (deneme)'); return { ip: '127.0.0.1' }; }
  const ag = await agBilgi();
  let ip = ag ? ag.ip : '';
  if (!ag) uyari('Ağ bilgisi okunamadı (kablo/Wi-Fi bağlı mı?). IP adımı atlanıyor.');
  else {
    log('  Şu anki adres: ' + ag.ip + '   (bağdaştırıcı: ' + ag.alias + ', ağ geçidi: ' + ag.gw + ')');
    if (ag.ip === SATIS_IP) log('  Bu bilgisayar zaten ' + SATIS_IP + ' adresinde; diğer bilgisayarların adresi değişmez.');
    else {
      log('  Diğer bilgisayarlar sunucuyu ' + SATIS_IP + ' adresinden açıyor. İki yol var:');
      log('   1) Bu bilgisayara ' + SATIS_IP + ' adresini ver (öneri; diğer bilgisayarlarda hiçbir şey değişmez)');
      log('   2) Mevcut adresi (' + ag.ip + ') kullan; diğer bilgisayarlarda adresi elle değiştirin');
      const s = await o.soru('  Seçiminiz:', '1');
      if (s === '1') {
        const ping = await o.calistir('ping', ['-n', '2', '-w', '900', SATIS_IP], 8000);
        if (/TTL=/i.test(ping.out)) {
          uyari(SATIS_IP + ' şu an ağda başka bir cihazda görünüyor (SATIS açık olabilir). Adres verilmedi; çakışma olurdu.');
          log('  SATIS\'ı kapatıp tekrar çalıştırın ya da 2. yolu seçin.');
        } else {
          const m = maske(ag.prefix || 24), dns = ag.dns.length ? ag.dns : [ag.gw];
          // Bağdaştırıcı adı boşluk içerebilir ("Ethernet 2"); komutlar bat dosyasına yazılıp öyle çalıştırılır (tırnak sorunu olmasın)
          const ipBat = path.join(HEDEF, 'IP-VER.bat');
          fs.writeFileSync(ipBat, ['@echo off', 'chcp 65001 >nul', 'rem Bu bilgisayara sabit IP verir (hizli kurulum tarafindan olusturuldu).',
            'netsh interface ip set address name="' + ag.alias + '" source=static address=' + SATIS_IP + ' mask=' + m + ' gateway=' + ag.gw + ' gwmetric=1 || exit /b 1',
            'netsh interface ip set dnsservers name="' + ag.alias + '" source=static address=' + dns[0] + ' validate=no',
            dns[1] ? 'netsh interface ip add dnsservers name="' + ag.alias + '" address=' + dns[1] + ' index=2 validate=no' : 'rem',
            'exit /b 0', ''].join('\r\n'));
          const r = await o.calistir('cmd.exe', ['/c', ipBat], 45000);
          if (!r.ok) uyari('IP verilemedi: ' + (r.out + r.err).trim().slice(0, 200));
          else {
            ip = SATIS_IP;
            fs.writeFileSync(path.join(HEDEF, 'IP-GERI-AL.bat'), ['@echo off', 'chcp 65001 >nul', 'rem Bu bilgisayarin IP adresini otomatige (DHCP) geri alir. Yonetici olarak calistirin.',
              'netsh interface ip set address name="' + ag.alias + '" source=dhcp', 'netsh interface ip set dnsservers name="' + ag.alias + '" source=dhcp', 'echo Tamam. IP otomatige alindi.', 'pause', ''].join('\r\n'));
            log('  ' + SATIS_IP + ' adresi verildi. (Geri almak için: ' + path.join(HEDEF, 'IP-GERI-AL.bat') + ')');
            not('IP: ' + ag.ip + ' -> ' + SATIS_IP + ' sabit verildi (geri alma: IP-GERI-AL.bat)');
            await bekle(2500);
          }
        }
      }
    }
    // Ağ profili özel olsun (Genel ağda Windows gelen bağlantıyı keser)
    await o.powershell("Set-NetConnectionProfile -InterfaceAlias '" + ag.alias.replace(/'/g, "''") + "' -NetworkCategory Private -ErrorAction SilentlyContinue");
  }
  // Güvenlik duvarı
  await o.calistir('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=FincanlarERP-' + PORT], 20000);
  const fw = await o.calistir('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=FincanlarERP-' + PORT, 'dir=in', 'action=allow', 'protocol=TCP', 'localport=' + PORT, 'profile=private,domain'], 20000);
  if (fw.ok) { log('  Güvenlik duvarı: ' + PORT + ' portuna özel/etki alanı ağında izin verildi.'); not('Güvenlik duvarı kuralı eklendi (' + PORT + ')'); }
  else uyari('Güvenlik duvarı kuralı eklenemedi: ' + (fw.out + fw.err).trim().slice(0, 160));
  // Uyku kapalı (sunucu bilgisayar uyursa bağlantı kopar)
  const pw = await o.calistir('powercfg', ['/change', 'standby-timeout-ac', '0'], 15000);
  await o.calistir('powercfg', ['/change', 'hibernate-timeout-ac', '0'], 15000);
  if (pw.ok) { log('  Güç ayarı: takılıyken uyku/hazırda bekletme kapatıldı.'); not('Uyku kapatıldı (prize takılıyken)'); }
  return { ip };
}

// ───────────────────────── 6) Otomatik başlatma + başlat ─────────────────────────
async function baslat(ag) {
  baslik('6/7  Otomatik başlatma');
  if (WIN && !TEST) {
    const vbs = path.join(HEDEF, 'BASLAT-GIZLI.vbs');
    if (fs.existsSync(vbs)) {
      const ps = "$d=[Environment]::GetFolderPath('Startup'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Fincanlar ERP Sunucu.lnk')); $s.TargetPath='" + vbs.replace(/'/g, "''") + "'; $s.WorkingDirectory='" + HEDEF.replace(/'/g, "''") + "'; $s.Save(); $d";
      const r = await o.powershell(ps);
      if (r.ok) { log('  Bilgisayar açılınca sunucu kendiliğinden başlayacak (Başlangıç klasörü: ' + r.out.trim() + ').'); not('Başlangıç kısayolu eklendi'); }
      else uyari('Başlangıç kısayolu eklenemedi: ' + r.err.trim().slice(0, 160));
    } else uyari('BASLAT-GIZLI.vbs bulunamadı; otomatik başlatma kurulamadı.');
  } else log('  (Deneme: atlandı)');
  baslik('7/7  Sunucuyu başlat');
  if (WIN && !TEST) spawn('wscript.exe', [path.join(HEDEF, 'BASLAT-GIZLI.vbs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.execPath, [path.join(HEDEF, 'src', 'server.js')], { cwd: HEDEF, detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }).unref();
  log('  Başlatıldı, açılması bekleniyor...');
  for (let i = 0; i < 45; i++) { await bekle(1000); if (await httpDene('127.0.0.1', PORT, 1500)) { log('  SUNUCU AÇILDI.'); return true; } if (i % 10 === 9) log('  ...hâlâ bekleniyor'); }
  uyari('Sunucu 45 saniyede açılmadı.');
  try { const l = fs.readFileSync(path.join(HEDEF, 'sunucu-kayit.log'), 'utf8').trim().split(/\r?\n/).slice(-12); log('  sunucu-kayit.log son satırlar:\n    ' + l.join('\n    ')); } catch (e) { log('  (kayıt dosyası yok; elle deneyin: klasörde cmd açıp  node\\node.exe src\\server.js)'); }
  return false;
}

async function main() {
  log('\n====================================================');
  log('  FINCANLAR ERP — YEDEK BİLGİSAYARDA HIZLI KURULUM');
  log('====================================================');
  if (!WIN && !TEST) { log('Bu kurulum Windows içindir.'); process.exit(1); }
  log('Hedef klasör: ' + HEDEF);
  not('Kurulum: ' + new Date().toLocaleString('tr-TR') + '  bilgisayar: ' + os.hostname());
  await satisKontrol();
  await kodKur();
  await anahtarlar();
  await veriYukle();
  const ag = await agKur();
  const acildi = await baslat(ag);

  const adres = 'http://' + ag.ip + ':' + PORT;
  not('Sunucu ' + (acildi ? 'açıldı' : 'AÇILMADI') + '; adres: ' + adres);
  if (uyarilar.length) { not('Uyarılar:'); uyarilar.forEach((u) => not('  - ' + u)); }
  try { fs.writeFileSync(path.join(HEDEF, 'KURULUM-KAYIT.txt'), kayit.join('\r\n') + '\r\n'); } catch (e) {}
  log('\n====================================================');
  log(acildi ? '  KURULUM TAMAM' : '  KURULUM TAMAMLANDI AMA SUNUCU AÇILMADI');
  log('====================================================');
  log('  Bu bilgisayarda   : http://localhost:' + PORT);
  log('  Diğer bilgisayarlar: ' + adres + '   (http, https değil)');
  if (ag.ip !== SATIS_IP) log('  NOT: Adres ' + SATIS_IP + ' değil; diğer bilgisayarlarda yukarıdaki adresi açın.');
  if (uyarilar.length) { log('\n  Dikkat edilecekler:'); uyarilar.forEach((u) => log('   - ' + u)); }
  log('\n  SATIS düzelince: önce BU sunucuyu durdurun (DURDUR.bat), sonra kılavuzdaki "Geri dönüş" adımlarını uygulayın.');
  log('  Kayıt: ' + path.join(HEDEF, 'KURULUM-KAYIT.txt'));
  o.girdiKapat();
}
main().catch((e) => { console.error('\nKURULUM DURDU: ' + (e && e.message ? e.message : e)); o.girdiKapat(); process.exit(1); });
