'use strict';
// Güncelleme sonrası sunucu hiç açılmıyorsa (sunucu KAPALIYKEN): node src\geri-al.js  → son sürüm yedeğini geri koyar.
//   Belirli bir yedek için: node src\geri-al.js 2026-10-15_04-30-12   (klasör adı: surum-yedek\ altındakiler)
const path = require('path');
const { geriAlDosyadan, yedekler } = require('./guncelle');
const KOK = path.join(__dirname, '..');
try {
  console.log('Mevcut yedekler:', yedekler(KOK).join(', ') || '(yok)');
  const r = geriAlDosyadan(KOK, process.argv[2]);
  console.log('Tamam: ' + r.ad + ' yedeğinden ' + r.adet + ' dosya geri konuldu. Sunucuyu yeniden başlatın.');
} catch (e) { console.error('Hata: ' + e.message); process.exit(1); }
