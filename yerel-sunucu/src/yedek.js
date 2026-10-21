'use strict';
// Yerel sunucu YEDEK MOTORU (15 Eki 2026)
//  1) BULUT: veri değiştiyse her N dakikada (varsayılan 5) veri.json sıkıştırılıp Google Drive'a gönderilir
//     (bulut ucu: Yedekleme.gs > yerelYedekYukle). Hata olursa sonraki turda yeniden denenir.
//  2) FLASH: ayarlı saatlerde, takılı çıkarılabilir sürücüye (flash) veri + program kodu kopyalanır.
//     Saat geldiğinde flash takılı değilse, takılınca o günün kaçan saati için bir kez yedek alınır.
//  3) "Şimdi yedekle": Ayarlar > Yedekleme ekranından anında.
//  4) KORUMA (16 Eki 2026): veri boş/eksik görünüyorsa (kayıt sayısı veya dosya boyutu yarıdan fazla düştüyse) bulut ve flash yedeği DURDURULUR,
//     sağlam kopyaların üzerine yazılmaz; ekranda kırmızı uyarı çıkar. Kullanıcı "Yine de gönder" derse (simdi 'bulut-onay') geçer.
//  6) UYARI (16 Eki 2026): sorun olunca sistem kendisi uyarır — ekranda kırmızı bant + buluttan e-posta (bkz. sorunlar / nabizGonder).
//     Her 5 dk'da buluta nabız gider; bulut 15 dk nabız alamazsa e-posta atar. 3 ardışık yedek gönderilemezse de e-posta gider.
//  5) İŞLEM GÜNLÜĞÜ: her veri değiştiren işlem veri\aktivite\ günlüğüne yazılır; "yedeğe gitti / bekliyor" durumu son bulut yedeğinin
//     zamanından hesaplanır. Sağ üst bildirim zili ve Yedekleme modülündeki günlük rapor bunu gösterir (aktiviteOzet / aktiviteListe).
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

  // sonSatir/sonHamBayt: son BAŞARILI bulut yedeğindeki kayıt satırı sayısı ve dosya boyutu (boş/eksik veri koruması bunlarla kıyaslar)
  // sonSnapshotT: son başarılı bulut yedeğinin veriyi okuduğu an; bundan önceki işlemler "yedeğe gitti" sayılır
  // durduruldu: koruma yedeği durdurduysa nedeni (ekranda kırmızı uyarı olarak görünür)
  let durum = { bulut: { sonBasari: 0, sonDeneme: 0, sonHata: '', sonAd: '', sonBoyutKB: 0, sonDriveYuzde: null, sonSatir: 0, sonHamBayt: 0, sonSnapshotT: 0, durduruldu: '', ardisik: 0 }, nabiz: { sonBasari: 0, sonHata: '' }, flash: { sonBasari: 0, sonSlot: '', sonHata: '', sonYol: '', sonSurucu: '' } };
  try { const j = JSON.parse(fs.readFileSync(DURUM, 'utf8')); durum.bulut = Object.assign(durum.bulut, j.bulut); durum.flash = Object.assign(durum.flash, j.flash); durum.nabiz = Object.assign(durum.nabiz, j.nabiz); } catch (e) {}
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
  // onay=true: boş/eksik veri koruması atlanır (yalnızca kullanıcı ekrandan "Yine de gönder" derse)
  async function bulutYukle(zorla, onay) {
    if (islem.bulut) return { ok: false, hata: 'Bulut yedeği zaten sürüyor' };
    const adres = bulutAdresi();
    if (!adres) { durum.bulut.sonHata = 'Bulut adresi bulunamadı (onyuz\\index.html)'; durumYaz(); return { ok: false, hata: durum.bulut.sonHata }; }
    if (!zorla && depo.surum === sonSurum) return { ok: true, degismedi: true };
    islem.bulut = true; durum.bulut.sonDeneme = Date.now();
    try {
      const snapT = Date.now();              // bu andan önceki tüm işlemler gönderilecek dosyada olur
      // Veri dosyası diskten silinmişse bellek (gerçek kaynak) yeniden yazılır; böylece boş/eksik dosya buluta gitmez.
      if (!fs.existsSync(VERI)) { depo.kirli = true; log('veri dosyası diskte yoktu, bellekten yeniden yazılıyor'); aktiviteUyari('Veri dosyası diskte yoktu; bellekteki veriden yeniden yazıldı'); }
      depo.diskeYaz();                       // bellekteki son hal diske (eşzamanlı, atomik)
      const surum = depo.surum;
      const ham = fs.readFileSync(VERI);
      const ozet = veriOzeti();
      const neden = onay ? '' : guvenlikKontrol(ozet, ham);
      if (neden) {                           // BOŞ/EKSİK VERİ KORUMASI: buluta (ve aynaya) gönderilmez, ekranda kırmızı uyarı çıkar
        durum.bulut.ardisik = (durum.bulut.ardisik || 0) + 1;
        durum.bulut.durduruldu = neden; durum.bulut.sonHata = 'Yedek DURDURULDU (veri boş/eksik görünüyor): ' + neden;
        durumYaz(); log('bulut yedeği durduruldu:', neden);
        aktiviteUyari('Buluta yedek DURDURULDU: ' + neden);
        return { ok: false, hata: durum.bulut.sonHata, durduruldu: true };
      }
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
      durum.bulut.sonSatir = ozet.satir; durum.bulut.sonHamBayt = ham.length; durum.bulut.sonSnapshotT = snapT; durum.bulut.durduruldu = ''; durum.bulut.ardisik = 0;
      durumYaz();
      return { ok: true };
    } catch (e) {
      durum.bulut.ardisik = (durum.bulut.ardisik || 0) + 1;
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
      if (!fs.existsSync(VERI)) depo.kirli = true;   // dosya silinmişse bellekten yeniden yazılsın
      depo.diskeYaz();
      const ham = fs.readFileSync(VERI); const ozet = sha(ham);
      // Boş/eksik veri flash'taki sağlam kopyaların yerine geçmesin (sakla sayısı dolunca en eskiler silinir)
      const neden = guvenlikKontrol(veriOzeti(), ham);
      if (neden) {
        durum.flash.sonHata = 'Flash yedeği DURDURULDU (veri boş/eksik görünüyor): ' + neden; durumYaz();
        aktiviteUyari('Flash yedeği DURDURULDU: ' + neden);
        return { ok: false, hata: durum.flash.sonHata, durduruldu: true };
      }
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

  // ───── BOŞ / EKSİK VERİ KORUMASI ─────
  // Bellekteki veri (gerçek kaynak) ve disk dosyası, son BAŞARILI bulut yedeğiyle kıyaslanır; veri boşsa ya da yarıdan fazla
  // küçülmüşse yedek (bulut ve flash) DURDURULUR — sağlam kopyaların üzerine boş veri gitmesin diye. Ekranda kırmızı uyarı çıkar.
  function veriOzeti() {
    let kitap = 0, satir = 0;
    for (const k of depo.kitaplar.values()) { kitap++; for (const s of k.sayfalar) satir += s.satirlar.length; }
    return { kitap, satir };
  }
  function guvenlikKontrol(ozet, ham) {
    const son = durum.bulut;
    if (ozet.kitap === 0) return 'Bellekte hiç şirket (e-tablo) yok';
    if (ozet.satir === 0) return 'Veride hiç kayıt satırı yok';
    if (son.sonSatir >= 200 && ozet.satir < son.sonSatir * 0.5) return 'Kayıt satırı sayısı yarıdan fazla azaldı (' + son.sonSatir + ' → ' + ozet.satir + ')';
    if (ham) {
      if (ham.length < 2000) return 'Veri dosyası çok küçük (' + ham.length + ' bayt)';
      if (son.sonHamBayt >= 200000 && ham.length < son.sonHamBayt * 0.5) return 'Veri dosyası yarıdan fazla küçüldü (' + Math.round(son.sonHamBayt / 1024) + ' KB → ' + Math.round(ham.length / 1024) + ' KB)';
    }
    return '';
  }

  // ───── İŞLEM GÜNLÜĞÜ: hangi işlem ne zaman yapıldı, buluta yedeklendi mi ─────
  // Her veri değiştiren istek (Code.gs handleRequest) tek satır olarak veri\aktivite\aktivite-<gün>.jsonl dosyasına yazılır (90 gün saklanır).
  // "Yedeğe gitti" bilgisi ayrıca tutulmaz: işlemin saati ≤ son başarılı bulut yedeğinin veriyi okuduğu an (durum.bulut.sonSnapshotT) ise gitmiştir.
  const AKT_KL = path.join(VERIKL, 'aktivite');
  try { fs.mkdirSync(AKT_KL, { recursive: true }); } catch (e) { /* günlük açılamazsa yedek yine çalışır */ }
  const aktDosya = (tarih) => path.join(AKT_KL, 'aktivite-' + tarih + '.jsonl');
  const esTarih = (v) => Object.prototype.toString.call(v) === '[object Date]';
  const GURULTU = /^(Oturumlar|KayitDefteriV2|__ozellik)$/;   // oturum/ayar/defter yazımları işlem sayılmaz
  const ISIM = { Tahsilat: 'Tahsilat', Odeme: 'Ödeme', Satis: 'Satış', Alis: 'Alış', AlisIade: 'Alış iadesi', SatisIade: 'Satış iadesi', CekSenet: 'Çek/Senet',
    Cari: 'Cari', CariVirman: 'Cari virman', StokTanim: 'Stok kartı', StokHareket: 'Stok hareketi', Banka: 'Banka', BankaHesap: 'Banka hesabı', Pos: 'POS',
    KrediKarti: 'Kredi kartı', Birim: 'Birim', Marka: 'Marka', Plasiyer: 'Plasiyer', SeriTanim: 'Seri tanımı', BasitTanim: 'Tanım', PosBankaAktarim: 'POS-banka aktarımı',
    BankaTransfer: 'Banka transferi', CekYaprak: 'Çek yaprağı', CekSenetGorseli: 'Çek/senet görseli', Siparis: 'Sipariş' };
  const ANA_SAYFA = { Tahsilat: 'Tahsilatlar', Odeme: 'Odemeler', Satis: 'Satislar', Alis: 'Alislar', AlisIade: 'AlisIadeler', SatisIade: 'SatisIadeler', CekSenet: 'CekSenetler', CariVirman: 'CariVirmanlar' };
  const aktSon = [];          // bellekte son kayıtlar (bildirim zili için)
  let aktTampon = null;       // devam eden isteğin sayfa olayları
  let uyariSon = { m: '', t: 0 };
  let cariOn = { t: 0, idx: null, ad: null };

  function etiket(a) {
    a = String(a || ''); let m;
    if (a === 'silinenGeriAl') return 'Silinen kayıt geri alındı';
    if (a === 'islemHatasi') return 'İşlem yarıda hata verdi (kısmen kaydedilmiş olabilir)';
    if (a === 'siparisDurumGuncelle') return 'Sipariş durumu değişti';
    if (a === 'siparistenFaturaOlustur') return 'Siparişten fatura oluşturuldu';
    if ((m = /^sil(.+)$/.exec(a)) || (m = /^(.+?)Sil$/.exec(a))) return (ISIM[m[1]] || m[1]) + ' silindi';
    if ((m = /^update(.+)$/.exec(a))) return (ISIM[m[1]] || m[1]) + ' düzeltildi';
    if ((m = /^save(.+)$/.exec(a))) return (ISIM[m[1]] || m[1]) + ' kaydedildi';
    if ((m = /^iptal(.+)$/.exec(a))) return (ISIM[m[1]] || m[1]) + ' iptal edildi';
    return a.replace(/([a-zçğıöşü])([A-Z])/g, '$1 $2');
  }
  function konuAl(a) { const m = /^(?:sil|save|update|iptal)([A-Z].*)$/.exec(a) || /^(.+?)Sil$/.exec(a); return m ? m[1] : ''; }
  function gunStr(v) {
    if (v === undefined || v === null || v === '') return '';
    if (esTarih(v)) return isNaN(v.getTime()) ? '' : istanbul(v).tarih;
    if (typeof v === 'object' && v.$d) return istanbul(new Date(v.$d)).tarih;
    const s = String(v).trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(s))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }
  function hucreMetin(v) { if (esTarih(v)) return gunStr(v); if (v === undefined || v === null) return ''; return String(v).slice(0, 60); }

  function cariIndeks() {
    if (cariOn.idx && Date.now() - cariOn.t < 20000) return cariOn;
    const idx = new Map(), ad = new Map();
    for (const k of depo.kitaplar.values()) {
      const s = k.sayfalar.find((x) => x.ad === 'CariHesaplar'); if (!s) continue;
      for (let i = 1; i < s.satirlar.length; i++) {
        const r = s.satirlar[i]; if (!r || !r[0]) continue;
        const c = { ad: String(r[2] || ''), kod: String(r[8] || '') };
        idx.set(String(r[0]), c);
        const an = c.ad.toLowerCase(); if (an) { const l = ad.get(an) || []; l.push(c); ad.set(an, l); }
      }
    }
    cariOn = { t: Date.now(), idx, ad };
    return cariOn;
  }

  function aktOku(tarih) {
    try {
      return fs.readFileSync(aktDosya(tarih), 'utf8').split('\n').filter(Boolean).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }
  function aktTemizle() {
    try {
      const sinir = Date.now() - 90 * 86400000;
      for (const f of fs.readdirSync(AKT_KL)) { const m = /^aktivite-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f); if (m && Date.parse(m[1]) < sinir) fs.unlinkSync(path.join(AKT_KL, f)); }
    } catch (e) { /* temizlik hatası önemsiz */ }
  }
  aktTemizle();
  { // açılışta son günlerin kayıtlarını belleğe al
    const bu = istanbul(new Date()).tarih, dun = istanbul(new Date(Date.now() - 86400000)).tarih;
    for (const e of aktOku(dun).concat(aktOku(bu))) aktSon.push(e);
    while (aktSon.length > 300) aktSon.shift();
  }
  const aktZaman = setInterval(aktTemizle, 6 * 3600 * 1000); if (aktZaman.unref) aktZaman.unref();

  function aktiviteEkle(kayit) {
    aktSon.push(kayit); while (aktSon.length > 300) aktSon.shift();
    try { fs.appendFileSync(aktDosya(istanbul(new Date(kayit.t)).tarih), JSON.stringify(kayit) + '\n'); } catch (e) { log('işlem günlüğü yazılamadı:', e.message); }
  }
  // Sistem uyarısı (ör. yedek durduruldu): aynı uyarı 30 dakikada bir kez günlüğe girer, zilde kırmızı görünür
  function aktiviteUyari(metin) {
    if (uyariSon.m === metin && Date.now() - uyariSon.t < 30 * 60000) return;
    uyariSon = { m: metin, t: Date.now() };
    aktiviteEkle({ id: 'u' + Date.now().toString(36), t: Date.now(), k: 'Sistem', a: '__uyari', e: metin, kr: true, gd: false, u: true, ok: false });
  }

  // Veri değiştiren istek başlarken çağrılır: bu istekte hangi sayfalarda ne değiştiğini toplamaya başlar.
  function islemBasla() {
    aktTampon = [];
    depo.dinleyici = (e) => { if (aktTampon) aktTampon.push(e); };
  }
  // İstek bitince çağrılır; bilgiJson: { action, kullanici, govde:{...}, sonuc:{...} } (Code.gs seçili alanları JSON olarak verir)
  function islemBitir(bilgiJson) {
    const olaylar = aktTampon || []; aktTampon = null; depo.dinleyici = null;
    try {
      let bilgi = {}; try { bilgi = typeof bilgiJson === 'string' ? JSON.parse(bilgiJson) : (bilgiJson || {}); } catch (e) { bilgi = {}; }
      const gercek = olaylar.filter((o) => !GURULTU.test(String(o.s)));
      if (!gercek.length) return { ok: true, kayit: false };
      const g = bilgi.govde || {}, sn = bilgi.sonuc || {}, action = String(bilgi.action || '');
      const konu = konuAl(action), anaSayfa = ANA_SAYFA[konu] || '';
      const bugun = istanbul(new Date()).tarih;

      // silinen satırlar (neyin silindiği sonradan görülebilsin) + ana belge satırı (tutar/tarih için)
      const silinenler = []; let anaHam = null;
      for (const o of gercek) {
        const a = o.a || {};
        if (o.i !== 'satirSil' || !Array.isArray(a.silinen) || !a.silinen.length) continue;
        silinenler.push({ s: o.s, n: a.silinen.length, r: a.silinen.slice(0, 5).map((r) => (Array.isArray(r) ? r : []).slice(0, 14).map(hucreMetin)) });
        if (!anaHam && o.s === anaSayfa && Array.isArray(a.silinen[0])) anaHam = a.silinen[0];
      }

      // CARİ: önce istekteki cari kimliği, sonra olaylardaki satırlarda cari kimliği, en son cari adı. Cari her zaman KODUYLA birlikte gösterilir.
      const ci = cariIndeks(), bulunan = [];
      const ekle = (id) => { const c = id ? ci.idx.get(String(id)) : null; if (c && !bulunan.some((x) => x.kod === c.kod && x.ad === c.ad)) bulunan.push(c); };
      ['cariId', 'kaynakCariId', 'hedefCariId'].forEach((a) => ekle(g[a]));
      if (!bulunan.length) {
        const satirlar = [];
        for (const o of gercek) {
          const a = o.a || {};
          if (o.i === 'ekle' && Array.isArray(a.deger)) satirlar.push(a.deger);
          else if (o.i === 'yaz' && Array.isArray(a.deger)) a.deger.slice(0, 40).forEach((r) => { if (Array.isArray(r)) satirlar.push(r); });
          else if (o.i === 'satirSil' && Array.isArray(a.silinen)) a.silinen.slice(0, 40).forEach((r) => { if (Array.isArray(r)) satirlar.push(r); });
          if (satirlar.length > 120) break;
        }
        for (const r of satirlar) {
          for (let j = 0; j < Math.min(r.length, 8); j++) if (typeof r[j] === 'string' && r[j].length > 3) ekle(r[j]);
          if (bulunan.length >= 2) break;
        }
      }
      if (!bulunan.length && g.cariAd) { const l = ci.ad.get(String(g.cariAd).toLowerCase()); bulunan.push(l && l.length === 1 ? l[0] : { ad: String(g.cariAd), kod: '' }); }
      if (!bulunan.length && anaHam && typeof anaHam[3] === 'string' && anaHam[3]) { const l = ci.ad.get(anaHam[3].toLowerCase()); bulunan.push(l && l.length === 1 ? l[0] : { ad: anaHam[3], kod: '' }); }

      const sayi = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
      let tutar = null;
      for (const a of ['tutar', 'toplam', 'genelToplam', 'netTutar']) if (tutar === null) tutar = sayi(g[a]);
      if (tutar === null && anaHam) tutar = sayi(anaHam[4]);

      let belgeTarih = '';
      for (const a of ['tarih', 'belgeTarihi', 'islemTarihi', 'siparisTarihi', 'faturaTarihi']) if (!belgeTarih) belgeTarih = gunStr(g[a]);
      if (!belgeTarih && anaHam) for (let j = 0; j < Math.min(anaHam.length, 8) && !belgeTarih; j++) if (esTarih(anaHam[j]) || (typeof anaHam[j] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(anaHam[j]))) belgeTarih = gunStr(anaHam[j]);

      const silme = /^sil|Sil$|^iptal|GeriAl$/.test(action) || silinenler.length > 0;
      const duzeltme = /^update/.test(action);
      const gd = !!belgeTarih && belgeTarih < bugun && (silme || duzeltme || /^save/.test(action));   // belge tarihi bugünden eski: geriye dönük işlem
      const kr = silme || (duzeltme && gd) || action === 'islemHatasi';
      let ad = etiket(action);
      if (g.belgeTipi && /^(save|update)(Satis|Alis)$/.test(action)) ad = String(g.belgeTipi) + (duzeltme ? ' düzeltildi' : ' kaydedildi');
      const belge = String(g.belgeNo || g.faturaNo || g.siparisNo || sn.belgeNo || sn.faturaNo || sn.siparisNo || g.id || sn.id || '').slice(0, 40);
      const sayfalar = [...new Set(gercek.map((o) => String(o.s)))].filter((x) => x !== 'SilinenIslemler').slice(0, 4);
      const ok = !(sn.ok === false || sn.error || sn.hata);
      const kayit = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), k: String(bilgi.kullanici || ''), a: action, e: ad, kr, gd, bt: belgeTarih,
        c: bulunan.slice(0, 2), b: belge, tt: tutar, sy: sayfalar, sil: silinenler.slice(0, 6), n: gercek.length, ok };
      aktiviteEkle(kayit);
      return { ok: true, kayit: true };
    } catch (e) { log('işlem günlüğü hatası:', e.message); return { ok: false }; }
  }

  const yedekDurumu = (e) => (e.u ? 'uyari' : (e.t <= (durum.bulut.sonSnapshotT || 0) ? 'gitti' : 'bekliyor'));
  const zengin = (e) => Object.assign({}, e, { yedek: yedekDurumu(e) });

  // Günlük rapor: tarih = 'YYYY-MM-DD'; filtre = tum | kritik | silme | bekleyen
  function aktiviteListe(o) {
    o = o || {};
    const tarih = /^\d{4}-\d{2}-\d{2}$/.test(String(o.tarih || '')) ? String(o.tarih) : istanbul(new Date()).tarih;
    const hepsi = aktOku(tarih).map(zengin);
    const ozet = { toplam: 0, kritik: 0, silme: 0, geriye: 0, bekleyen: 0, hata: 0, uyari: 0, kullanicilar: {}, islemler: {} };
    for (const e of hepsi) {
      if (e.u) { ozet.uyari++; continue; }
      ozet.toplam++; if (e.kr) ozet.kritik++; if (e.gd) ozet.geriye++; if (e.yedek === 'bekliyor') ozet.bekleyen++; if (e.ok === false) ozet.hata++;
      if (/^sil|Sil$|^iptal|GeriAl$/.test(e.a) || (e.sil && e.sil.length)) ozet.silme++;
      ozet.kullanicilar[e.k || '—'] = (ozet.kullanicilar[e.k || '—'] || 0) + 1;
      ozet.islemler[e.e] = (ozet.islemler[e.e] || 0) + 1;
    }
    const f = String(o.filtre || 'tum');
    let liste = hepsi;
    if (f === 'kritik') liste = hepsi.filter((e) => e.kr || e.gd || e.u);
    else if (f === 'silme') liste = hepsi.filter((e) => /^sil|Sil$|^iptal|GeriAl$/.test(e.a) || (e.sil && e.sil.length));
    else if (f === 'bekleyen') liste = hepsi.filter((e) => e.yedek === 'bekliyor');
    return { ok: true, tarih, filtre: f, liste: liste.slice(-3000).reverse(), ozet,
      yedek: { sonBasari: durum.bulut.sonBasari, sonSnapshotT: durum.bulut.sonSnapshotT, durduruldu: durum.bulut.durduruldu, sonHata: durum.bulut.sonHata }, sunucuSaati: Date.now() };
  }

  // Sağ üstteki bildirim zili: yeşil = hepsi yedekte, sarı = bekleyen işlem var, kırmızı = yedek durdu/hatalı
  function aktiviteOzet() {
    const sn = durum.bulut.sonSnapshotT || 0;
    const bekleyen = aktSon.filter((e) => !e.u && e.t > sn);
    let renk = 'yesil', mesaj = 'Tüm işlemler buluta yedeklendi';
    if (!bulutAdresi()) { renk = 'kirmizi'; mesaj = 'Bulut adresi bulunamadı'; }
    else if (durum.bulut.durduruldu) { renk = 'kirmizi'; mesaj = 'Yedek DURDURULDU: ' + durum.bulut.durduruldu; }
    else if (durum.bulut.sonHata) { renk = 'kirmizi'; mesaj = 'Bulut yedeği hatası: ' + durum.bulut.sonHata; }
    else if (!ayar.bulut.acik && bekleyen.length) { renk = 'sari'; mesaj = 'Otomatik bulut yedeği KAPALI — ' + bekleyen.length + ' işlem yedeğe gitmedi'; }
    else if (bekleyen.length) { renk = 'sari'; mesaj = bekleyen.length + ' işlem buluta gitmeyi bekliyor (en geç ' + ayar.bulut.dakika + ' dk içinde)'; }
    return { ok: true, renk, mesaj, bekleyen: bekleyen.length, kritikBekleyen: bekleyen.filter((e) => e.kr).length, sonBasari: durum.bulut.sonBasari,
      islemde: !!islem.bulut, son: aktSon.slice(-30).reverse().map(zengin), sunucuSaati: Date.now() };
  }

  // ───── SAĞLIK UYARILARI + NABIZ (16 Eki 2026) ─────
  // Normal işleyişte olmaması gereken sorunlar her gün elle kontrol edilmesin diye sistem kendisi uyarır:
  //  • sorunlar(): şu an var olan sorunların listesi. e:true olanlar buluttan e-postayla da bildirilir.
  //  • nabizGonder(): her 5 dk'da buluta küçük bir "yaşıyorum" mesajı + sorun listesi gider. Bulut 15 dk nabız alamazsa (sunucu kapandı,
  //    bilgisayar bozuldu, internet gitti) e-posta atar; yerel sunucu ölünce kendi uyaramayacağı için bu kontrol bulutta yapılır.
  //  • saglik(): ekrandaki kırmızı uyarı bandı için (her kullanıcıya açık, ayrıntı yalnız Admin ekranında gösterilir).
  const NABIZ_DK = 5;
  function sorunlar() {
    const l = [], b = durum.bulut, simdi = Date.now();
    if (b.durduruldu) l.push({ k: 'durduruldu', e: true, m: 'Buluta yedek DURDURULDU (veri boş/eksik görünüyor): ' + b.durduruldu });
    else if ((b.ardisik || 0) >= 3) l.push({ k: 'yedek', e: true, m: 'Buluta son ' + b.ardisik + ' yedek gönderilemedi: ' + (b.sonHata || 'bilinmeyen hata') });
    if (b.sonDriveYuzde !== null && b.sonDriveYuzde !== undefined && b.sonDriveYuzde >= 90) l.push({ k: 'drive', e: true, m: 'Google Drive %' + b.sonDriveYuzde + ' dolu; yer azalıyor, eski yedekler budanacak' });
    try {
      if (typeof fs.statfsSync === 'function') {
        const st = fs.statfsSync(VERIKL), bos = st.bavail * st.bsize;
        if (bos < 1.5 * 1024 * 1024 * 1024) l.push({ k: 'disk', e: true, m: 'Sunucu bilgisayarın diskinde yer azaldı (' + (bos / 1073741824).toFixed(1) + ' GB kaldı)' });
      }
    } catch (e) { /* eski Node sürümünde disk denetimi yok; diğer denetimler sürer */ }
    const hatalar = aktSon.filter((x) => x.a === 'islemHatasi' && simdi - x.t < 30 * 60000).length;
    if (hatalar) l.push({ k: 'islemhata', e: true, m: 'Son 30 dakikada ' + hatalar + ' işlem yarıda hata verdi (kısmen kaydedilmiş olabilir); Yedekleme > Günlük Rapor\'a bakın' });
    // flash: yalnız ekranda uyarır (çekmeceye koyulan flash bilerek çıkarılmış olabilir, e-posta atılmaz)
    try {
      const slot = bekleyenSlot();
      if (slot && durum.flash.sonBasari) {
        const sl = new Date(slot.replace(' ', 'T') + ':00+03:00').getTime();
        if (simdi - sl > 2 * 3600000) l.push({ k: 'flash', e: false, m: 'Flash yedeği ' + slot.slice(11) + ' saatinden beri alınamadı (flash takılı değil mi?)' });
      }
    } catch (e) { /* tarih çözülemezse flash uyarısı atlanır */ }
    return l;
  }
  function saglik() {
    const l = sorunlar();
    // bulutSon: son BAŞARILI bulut yedeği (ms; 0 = hiç) — ekranda "YEREL SUNUCU" yazısının altında gösterilir
    return { ok: true, yerel: true, sorun: l.length > 0, sayi: l.length, mesajlar: l.map((x) => x.m), bulutSon: durum.bulut.sonBasari || 0, bulutArdisik: durum.bulut.ardisik || 0, bulutHata: durum.bulut.ardisik ? (durum.bulut.sonHata || '') : '' };
  }
  async function nabizGonder(test) {
    const adres = bulutAdresi();
    if (!adres) return { ok: false, hata: 'Bulut adresi bulunamadı' };
    try {
      const y = await postla(adres, JSON.stringify({ action: 'yerelNabiz', anahtar: ayar.anahtar, uyarilar: sorunlar(), yedekT: durum.bulut.sonBasari, test: !!test }));
      if (!y || !y.ok) throw new Error((y && y.hata) || 'Bulut nabzı kabul etmedi');
      durum.nabiz.sonBasari = Date.now(); durum.nabiz.sonHata = '';
      if (test) durum.nabiz.sonTest = { t: Date.now(), ok: true, eposta: y.eposta || '' };
      durumYaz();
      return y;
    } catch (e) {
      durum.nabiz.sonHata = e.message;
      if (test) durum.nabiz.sonTest = { t: Date.now(), ok: false, hata: e.message };
      durumYaz();
      return { ok: false, hata: e.message };
    }
  }
  // Dış fatura köprüsü: buluta ortak anahtarla tek seferlik soru (UrlFetchApp yerine Node'da, yönlendirmeleri postla izler).
  async function bulutaSor(obj) {
    const adres = bulutAdresi();
    if (!adres) return { ok: false, hata: 'Bulut adresi bulunamadı' };
    try { return await postla(adres, JSON.stringify(Object.assign({ anahtar: ayar.anahtar }, obj))); }
    catch (e) { return { ok: false, hata: e.message }; }
  }
  const nabizIlk = setTimeout(() => { nabizGonder(false); }, 25000); if (nabizIlk.unref) nabizIlk.unref();
  const nabizZaman = setInterval(() => { nabizGonder(false); }, NABIZ_DK * 60000); if (nabizZaman.unref) nabizZaman.unref();

  // ───── Ekranın (Admin) kullandığı arayüz ─────
  function ayarKaydet(yeni) {
    const a = birlestir(Object.assign({}, yeni, { anahtar: ayar.anahtar }));
    if (yeni.flash && Array.isArray(yeni.flash.saatler) && yeni.flash.saatler.length && !a.flash.saatler.length) return { ok: false, hata: 'Saat biçimi geçersiz (örnek: 13:00)' };
    ayar = a; ayarYaz();
    return { ok: true };
  }
  function simdi(hedef) {
    if (hedef === 'bulut' || hedef === 'ikisi') { bulutSon = Date.now(); bulutYukle(true); }
    // "Yine de gönder": boş/eksik veri koruması durdurduysa ve kullanıcı verinin doğru olduğunu onayladıysa
    if (hedef === 'bulut-onay') { bulutSon = Date.now(); bulutYukle(true, true); }
    if (hedef === 'nabiz-test') return { ok: true, baslatildi: hedef, tamam: nabizGonder(true) };
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
  return { durum: durumVer, ayarKaydet, simdi, bulutYukle, flashYedekle, flashTara, islemBasla, islemBitir, aktiviteListe, aktiviteOzet, saglik, sorunlar, nabizGonder, bulutaSor, _ayar: () => ayar };
}

module.exports = { baslat };
