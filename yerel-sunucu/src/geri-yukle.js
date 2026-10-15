'use strict';
// Yedekten veri geri getirme yardımcısı (sunucu KAPALIYKEN çalıştırın).
//   node src\geri-yukle.js "<yedek dosyası>" [hedef]
// Yedek dosyası: bulut yedeği (yerel-veri-....json.gz veya parçalı ...json.gz.001) ya da flash yedeği (veri-....json).
// Hedef verilmezse veri\veri-geri.json yazılır; mevcut veri.json'a DOKUNULMAZ. Kontrol edip adını elle veri.json yapın.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const kaynak = process.argv[2];
if (!kaynak || !fs.existsSync(kaynak)) { console.error('Kullanım: node src\\geri-yukle.js "<yedek dosyası>" [hedef]'); process.exit(1); }
const hedef = process.argv[3] || path.join(__dirname, '..', 'veri', 'veri-geri.json');
let ham;
if (/\.gz(\.\d{3})?$/i.test(kaynak)) {
  const taban = kaynak.replace(/\.\d{3}$/, ''); const parcali = /\.\d{3}$/.test(kaynak);
  const dosyalar = parcali ? fs.readdirSync(path.dirname(kaynak)).filter((f) => f.startsWith(path.basename(taban) + '.')).sort().map((f) => path.join(path.dirname(kaynak), f)) : [kaynak];
  ham = zlib.gunzipSync(Buffer.concat(dosyalar.map((f) => fs.readFileSync(f))));
  console.log(dosyalar.length + ' parça açıldı');
} else ham = fs.readFileSync(kaynak);
const j = JSON.parse(ham.toString('utf8'));
if (!j || !Array.isArray(j.kitaplar)) { console.error('Bu dosya geçerli bir veri yedeği değil'); process.exit(1); }
fs.writeFileSync(hedef, ham);
console.log('Tamam: ' + hedef + '  (' + j.kitaplar.length + ' e-tablo, ' + j.kitaplar.reduce((t, k) => t + k.sayfalar.length, 0) + ' sayfa)');
console.log('Sıradaki: sunucuyu kapatın, veri.json adını veri-eski.json yapın, bu dosyanın adını veri.json yapıp sunucuyu açın.');
