'use strict';
/** Uji logika backend memakai tiruan Google Sheets. Jalankan: node dev/test.js */
const assert = require('assert');
const { createBackend } = require('./mock-gas');

const H = 3600e3, D = 24 * H;
let lulus = 0;
function ok(nama, fn) {
  try { fn(); lulus++; console.log('  ok   ' + nama); }
  catch (e) { console.log('  GAGAL ' + nama + '\n        ' + (e.message || e).split('\n')[0]); process.exitCode = 1; }
}

const b = createBackend({ quiet: true });
b.prepare({ 'Administrator': '111111', 'Aep Supiana': '222222', 'Alifar Ihsan Azhari': '333333' });
// pengurus tambahan berperan Pemateri
const sp = b.api.lembar_('pengurus');
sp.appendRow(['Pemateri Tamu', 'Pemateri', '', '']);
b.api.aturPinBaris_(sp.getLastRow(), '444444');

const login = (nama, pin) => b.post({ aksi: 'login', nama, pin });
const admin = login('Administrator', '111111'), ketua = login('Aep Supiana', '222222'), mub = login('Alifar Ihsan Azhari', '333333'), tamu = login('Pemateri Tamu', '444444');
const A = (tok, aksi, x) => b.post(Object.assign({ aksi, token: tok.token }, x));

console.log('Login dan peran');
ok('login benar mengembalikan token dan izin', () => { assert(admin.ok && admin.token && admin.izin.includes('hapus')); assert(!mub.izin.includes('hapus')); });
ok('PIN salah ditolak', () => assert.strictEqual(login('Administrator', '000000').kode, 'login'));
ok('terkunci setelah 5 kali salah', () => {
  for (let i = 0; i < 5; i++) login('Aep Supiana', '999999');
  assert.strictEqual(login('Aep Supiana', '222222').kode, 'terkunci');
  b.cache.delete('gagal_aep supiana');
});
ok('tanpa token ditolak', () => assert.strictEqual(b.post({ aksi: 'rekap' }).kode, 'login'));
ok('muballigh tidak boleh menghapus atau membuat sesi', () => {
  assert.strictEqual(A(mub, 'hapusHadir', { sid: 'x', nid: 'y' }).kode, 'izin');
  assert.strictEqual(A(mub, 'sesiSimpan', { judul: 'Tes', mulai: Date.now() }).kode, 'izin');
});
ok('pemateri hanya boleh materi', () => {
  assert.strictEqual(A(tamu, 'rekap', {}).kode, 'izin');
  assert.strictEqual(A(tamu, 'masukan', {}).kode, 'izin');
});

console.log('Sesi, jamaah, kutipan');
const names = ['Ahmad Fauzi', 'Siti Aisyah', 'Budi Santoso', 'Hj. Nurlaila', 'Muhammad Rizki'];
ok('administrator menambah jamaah (duplikat dilewati)', () => {
  const r = A(admin, 'jamaahTambah', { nama: names.concat(['ahmad fauzi', 'ab']) });
  assert.strictEqual(r.ditambah, 5); assert.strictEqual(r.dilewati, 1);   // 'ab' terlalu pendek dibuang, 'ahmad fauzi' dilewati
});
let sid, sidLama;
ok('membuat sesi terbuka dan sesi lama', () => {
  const r1 = A(ketua, 'sesiSimpan', { judul: 'Kajian Riyadhus Shalihin', pemateri: 'Alifar Ihsan Azhari', tempat: 'Masjid', mulai: Date.now() - 5 * H, hari: 3 });
  const r2 = A(ketua, 'sesiSimpan', { judul: 'Fiqih Ibadah', pemateri: 'Aep Supiana', tempat: 'Masjid', mulai: Date.now() - 6 * D, hari: 3 });
  assert(r1.ok && r2.ok); sid = r1.id; sidLama = r2.id;
});
let pub = b.get({ aksi: 'public' });
ok('publik hanya memuat sesi yang masih dalam jendela 3 hari', () => {
  assert.strictEqual(pub.sesi.length, 1); assert.strictEqual(pub.sesi[0].id, sid);
  assert.strictEqual(pub.nama.length, 5);
  assert.deepStrictEqual(pub.staf.map((s) => s.n).sort(), ['Administrator', 'Aep Supiana', 'Alifar Ihsan Azhari', 'Pemateri Tamu']);
});
ok('sesi baru langsung punya ayat atau hadis', () => { assert(pub.sesi[0].k && pub.sesi[0].k.arab && pub.sesi[0].k.ref); });
ok('data publik tidak memuat hash PIN atau masukan', () => { const s = JSON.stringify(pub); assert(!/PIN_Hash|garam|hash/i.test(s)); });

console.log('Absen jamaah');
const idOf = (n) => pub.nama.filter((x) => x[1] === n)[0][0];
const abs = (x) => b.post(Object.assign({ aksi: 'absen', sid, kind: 'TMM', dev: 'dev1' }, x));
ok('absen berhasil dan membawa ringkasan serta kutipan', () => {
  const r = abs({ nid: idOf('Ahmad Fauzi') });
  assert(r.ok && !r.dup && r.nama === 'Ahmad Fauzi'); assert(r.materi.k.arab);
});
ok('absen ganda dikenali, tidak menambah baris', () => {
  const sebelum = b.api.bacaMentah_('hadir').length;
  const r = abs({ nid: idOf('Ahmad Fauzi') });
  assert(r.ok && r.dup); assert.strictEqual(b.api.bacaMentah_('hadir').length, sebelum);
});
ok('SDC tercatat sebagai SDC', () => { abs({ nid: idOf('Siti Aisyah'), kind: 'SDC' }); const rows = b.api.bacaMentah_('hadir'); assert.strictEqual(rows[rows.length - 1][3], 'SDC'); });
ok('sesi yang sudah lewat 3 hari ditolak', () => assert.strictEqual(abs({ sid: sidLama, nid: idOf('Budi Santoso') }).kode, 'ditutup'));
ok('pilihan kehadiran tidak valid ditolak', () => assert.strictEqual(abs({ nid: idOf('Budi Santoso'), kind: 'XYZ' }).kode, 'data'));
ok('nama tamu baru dibuat sekali, nama sama dipakai ulang', () => {
  const r1 = abs({ nama: '  Zainal   Abidin ', dev: 'dev2' });
  const r2 = abs({ nama: 'zainal abidin', dev: 'dev2' });
  assert(r1.ok && !r1.dup); assert(r2.ok && r2.dup && r2.nid === r1.nid);
  assert.strictEqual(b.get({ aksi: 'public' }).nama.filter((x) => /zainal/i.test(x[1])).length, 1);
});
ok('nama yang diawali = tidak menjadi rumus', () => {
  const r = abs({ nama: '=1+1 Rumus', dev: 'dev3' });
  assert(r.ok); const rows = b.api.bacaMentah_('hadir'); assert(!/^[=+\-@]/.test(rows[rows.length - 1][2]));
});
ok('kolom jebakan terisi: tidak ada baris baru', () => {
  const n = b.api.bacaMentah_('hadir').length;
  assert(abs({ nid: idOf('Budi Santoso'), hp: 'http://spam', dev: 'dev4' }).ok); assert.strictEqual(b.api.bacaMentah_('hadir').length, n);
});
ok('satu perangkat dibatasi 5 absen per 10 menit', () => {
  const nm = ['Budi Santoso', 'Hj. Nurlaila', 'Muhammad Rizki'];
  nm.forEach((n) => abs({ nid: idOf(n), dev: 'devX' }));
  for (let i = 0; i < 2; i++) abs({ nama: 'Tamu Nomor ' + i + ' Baru', dev: 'devX' });
  assert.strictEqual(abs({ nama: 'Tamu Keenam Baru', dev: 'devX' }).kode, 'terlalu_banyak');
});
ok('masukan tersimpan; anonim tanpa nama', () => {
  abs({ nama: 'Pengirim Satu Nama', fb: 'Speaker kurang keras', anon: true, dev: 'devF1' });
  abs({ nama: 'Pengirim Dua Nama', fb: 'Materi bagus', anon: false, dev: 'devF2' });
  const m = A(ketua, 'masukan', {}).masukan;
  const anon = m.filter((x) => x.teks === 'Speaker kurang keras')[0], nama = m.filter((x) => x.teks === 'Materi bagus')[0];
  assert.strictEqual(anon.nama, ''); assert.strictEqual(nama.nama, 'Pengirim Dua Nama');
  assert(!JSON.stringify(m).includes('Pengirim Satu'));
});

console.log('Pengurus: input manual, rekap, hapus');
ok('muballigh menginput susulan ke sesi lama', () => {
  const r = A(mub, 'manual', { sid: sidLama, nid: idOf('Budi Santoso'), kind: 'SDC', catatan: 'lapor lewat WA' });
  assert(r.ok && !r.dup);
  assert(A(mub, 'manual', { sid: sidLama, nid: idOf('Budi Santoso'), kind: 'SDC' }).dup);
  const rows = b.api.bacaMentah_('hadir').filter((x) => x[7] === sidLama);
  assert.strictEqual(rows[0][5], 'Alifar Ihsan Azhari'); assert.strictEqual(rows[0][3], 'SDC');
});
ok('rekap per rentang dan jumlahnya sesuai', () => {
  const r = A(ketua, 'rekap', { dari: 0, sampai: Date.now() });
  assert.strictEqual(r.sesi.length, 2);
  assert.strictEqual(r.hadir.filter((x) => x[0] === sidLama).length, 1);
  const baru = A(ketua, 'rekap', { dari: Date.now() - 2 * D, sampai: Date.now() });
  assert.strictEqual(baru.sesi.length, 1); assert(baru.hadir.every((x) => x[0] === sid));
});
ok('ketua menghapus kehadiran; muballigh tidak boleh', () => {
  assert.strictEqual(A(mub, 'hapusHadir', { sid: sidLama, nid: idOf('Budi Santoso') }).kode, 'izin');
  assert.strictEqual(A(ketua, 'hapusHadir', { sid: sidLama, nid: idOf('Budi Santoso') }).terhapus, 1);
  assert.strictEqual(b.api.bacaMentah_('hadir').filter((x) => x[7] === sidLama).length, 0);
});
ok('menonaktifkan jamaah menyembunyikannya dari daftar publik', () => {
  A(admin, 'jamaahAktif', { id: idOf('Budi Santoso'), aktif: false }); b.cache.delete('pub');
  assert(!b.get({ aksi: 'public' }).nama.some((x) => x[1] === 'Budi Santoso'));
});

console.log('Materi dan kutipan');
ok('ayat tertentu diambil lewat rujukan (2:286 dan nama surah)', () => {
  const r = A(mub, 'materiSimpan', { sid, ringkasan: 'Ringkasan tes', mode: 'ayat', ref: '2:286' });
  assert(r.ok && /Al-Baqarah: 286/.test(r.k.ref));
  const r2 = A(mub, 'materiSimpan', { sid, ringkasan: 'x', mode: 'ayat', ref: 'Al-Baqarah 285-286' });
  assert(/Al-Baqarah: 285-286/.test(r2.k.ref));
});
ok('rujukan ngawur ditolak', () => assert.strictEqual(A(mub, 'materiSimpan', { sid, ringkasan: 'x', mode: 'ayat', ref: 'bla bla' }).kode, 'data'));
ok('materi manual dan pustaka', () => {
  assert(A(mub, 'materiSimpan', { sid, ringkasan: 'x', mode: 'manual', jenis: 'Hadis', ref: 'HR. Tes', arab: 'نص', tr: 'Terjemah' }).ok);
  const aw = A(mub, 'awal', {}); assert(aw.pustaka.length >= 5);
  assert(A(mub, 'materiSimpan', { sid, ringkasan: 'x', mode: 'pustaka', baris: aw.pustaka[0].baris }).ok);
});
ok('ringkasan muncul di data publik setelah cache habis', () => {
  A(mub, 'materiSimpan', { sid, ringkasan: 'Ringkasan akhir', mode: 'tetap' }); b.cache.delete('pub');
  assert.strictEqual(b.get({ aksi: 'public' }).sesi[0].ringkasan, 'Ringkasan akhir');
});
ok('pemateri hanya mengisi materi miliknya', () => assert.strictEqual(A(tamu, 'materiSimpan', { sid, ringkasan: 'x', mode: 'tetap' }).kode, 'izin'));
ok('jika API ayat mati, kutipan cadangan dari pustaka tetap dipakai', () => {
  const off = createBackend({ quiet: true, offline: true });
  off.prepare({ 'Administrator': '111111' });
  const t = off.post({ aksi: 'login', nama: 'Administrator', pin: '111111' });
  assert(off.post({ aksi: 'sesiSimpan', token: t.token, judul: 'Tes Luring', mulai: Date.now() - H }).ok);
  assert(off.get({ aksi: 'public' }).sesi[0].k.arab);
});

console.log('Ketahanan');
ok('aksi tak dikenal dan JSON rusak tidak membuat server jatuh', () => {
  assert.strictEqual(b.post({ aksi: 'ngawur', token: admin.token }).kode, 'data');
  assert.strictEqual(JSON.parse(b.api.doPost({ postData: { contents: '{rusak' } }).getContent()).ok, false);
});
ok('cadangan memerlukan izin hapus', () => assert.strictEqual(A(mub, 'cadangan', {}).kode, 'izin'));

console.log('\n' + lulus + ' pemeriksaan lulus' + (process.exitCode ? ', ada yang gagal' : ''));
