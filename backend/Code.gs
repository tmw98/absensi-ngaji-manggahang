/**
 * ABSENSI PENGAJIAN: backend Google Apps Script.
 *
 * Tempel seluruh file ini di Google Sheet: Ekstensi > Apps Script.
 * Data disimpan di lembar-lembar Sheet itu sendiri (Pengurus, Jamaah, Sesi,
 * Kehadiran, Masukan, Pustaka). Panduan lengkap ada di README.md.
 */

const CFG = {
  TZ: 'Asia/Jakarta',
  HARI_BUKA: 3,               // jendela absen default (hari sejak pengajian dimulai)
  TOKEN_TTL: 21600,           // sesi login pengurus: 6 jam
  PUBLIC_CACHE: 90,           // detik, cache daftar sesi dan nama untuk jamaah
  MAX_NAMA: 60,
  MAX_MASUKAN: 500,
  MAX_CATATAN: 120,
  THROTTLE_MAX: 5,            // maksimal absen per perangkat
  THROTTLE_DETIK: 600,        // dalam jendela waktu ini
  LOGIN_MAX_GAGAL: 5,
  LOGIN_KUNCI_DETIK: 600,
  FOLDER_CADANGAN: 'Cadangan Absensi Pengajian',
  CADANGAN_SIMPAN: 24         // jumlah salinan cadangan yang disimpan
};

const NAMA_LEMBAR = { pengurus: 'Pengurus', jamaah: 'Jamaah', sesi: 'Sesi', hadir: 'Kehadiran', masukan: 'Masukan', pustaka: 'Pustaka' };
const KOLOM = {
  pengurus: ['Nama', 'Peran', 'PIN_Hash', 'Garam'],
  jamaah: ['Nama', 'Aktif', 'Tamu', 'ID'],
  sesi: ['Judul', 'Pemateri', 'Tempat', 'Mulai', 'HariBuka', 'Ringkasan', 'KutipanJenis', 'KutipanRujukan', 'KutipanArab', 'KutipanTerjemah', 'KutipanSumber', 'ID'],
  hadir: ['Tanggal', 'Judul', 'Nama', 'Keterangan', 'Waktu', 'DiinputOleh', 'Catatan', 'SesiID', 'JamaahID'],
  masukan: ['Waktu', 'Judul', 'Nama', 'Teks', 'Dibaca', 'ID', 'SesiID', 'JamaahID'],
  pustaka: ['Jenis', 'Rujukan', 'Arab', 'Terjemah', 'Sumber', 'Derajat']
};
const KETERANGAN = { TMM: 'Tatap Muka Masjid', SDC: 'SDC' };
const IZIN_PENUH = ['rekap', 'manual', 'sesi', 'materi', 'masukan', 'hapus', 'jamaah'];
const PERAN = {
  'Administrator': IZIN_PENUH,
  'Ketua Kelompok': IZIN_PENUH,
  'Muballigh': ['rekap', 'manual', 'materi', 'masukan'],
  'Pemateri': ['materi']
};
const SUMBER_AYAT = 'Teks Arab dan terjemahan Indonesia dari alquran.cloud';
const NAMA_SURAH = ['Al-Fatihah', 'Al-Baqarah', 'Ali ’Imran', 'An-Nisa’', 'Al-Ma’idah', 'Al-An’am', 'Al-A’raf', 'Al-Anfal', 'At-Taubah', 'Yunus', 'Hud', 'Yusuf', 'Ar-Ra’d', 'Ibrahim', 'Al-Hijr', 'An-Nahl', 'Al-Isra’', 'Al-Kahfi', 'Maryam', 'Thaha', 'Al-Anbiya’', 'Al-Hajj', 'Al-Mu’minun', 'An-Nur', 'Al-Furqan', 'Asy-Syu’ara’', 'An-Naml', 'Al-Qashash', 'Al-’Ankabut', 'Ar-Rum', 'Luqman', 'As-Sajdah', 'Al-Ahzab', 'Saba’', 'Fathir', 'Yasin', 'Ash-Shaffat', 'Shad', 'Az-Zumar', 'Ghafir', 'Fushshilat', 'Asy-Syura', 'Az-Zukhruf', 'Ad-Dukhan', 'Al-Jatsiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf', 'Adz-Dzariyat', 'Ath-Thur', 'An-Najm', 'Al-Qamar', 'Ar-Rahman', 'Al-Waqi’ah', 'Al-Hadid', 'Al-Mujadilah', 'Al-Hasyr', 'Al-Mumtahanah', 'Ash-Shaff', 'Al-Jumu’ah', 'Al-Munafiqun', 'At-Taghabun', 'Ath-Thalaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', 'Al-Ma’arij', 'Nuh', 'Al-Jinn', 'Al-Muzzammil', 'Al-Muddatstsir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat', 'An-Naba’', 'An-Nazi’at', '’Abasa', 'At-Takwir', 'Al-Infithar', 'Al-Muthaffifin', 'Al-Insyiqaq', 'Al-Buruj', 'Ath-Thariq', 'Al-A’la', 'Al-Ghasyiyah', 'Al-Fajr', 'Al-Balad', 'Asy-Syams', 'Al-Lail', 'Adh-Dhuha', 'Al-Insyirah', 'At-Tin', 'Al-’Alaq', 'Al-Qadr', 'Al-Bayyinah', 'Az-Zalzalah', 'Al-’Adiyat', 'Al-Qari’ah', 'At-Takatsur', 'Al-’Ashr', 'Al-Humazah', 'Al-Fil', 'Quraisy', 'Al-Ma’un', 'Al-Kautsar', 'Al-Kafirun', 'An-Nashr', 'Al-Lahab', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas'];

class AppError extends Error {
  constructor(kode, pesan) { super(pesan); this.kode = kode; }
}

/* ===================== pintu masuk web app ===================== */

function doGet(e) {
  try {
    const aksi = (e && e.parameter && e.parameter.aksi) || 'public';
    if (aksi === 'public') return json_(publik_());
    if (aksi === 'ping') return json_({ ok: true, now: Date.now() });
    throw new AppError('data', 'Aksi tidak dikenali.');
  } catch (err) { return json_(galat_(err)); }
}

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(rute_(d));
  } catch (err) { return json_(galat_(err)); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function galat_(err) {
  if (err instanceof AppError) return { ok: false, kode: err.kode, pesan: err.message };
  console.error((err && err.stack) || err);
  return { ok: false, kode: 'galat', pesan: 'Terjadi gangguan di server. Coba lagi sebentar.' };
}

function rute_(d) {
  switch (d.aksi) {
    case 'absen': return absen_(d);
    case 'login': return login_(d);
  }
  const u = otentikasi_(d.token);
  switch (d.aksi) {
    case 'awal': return awal_(u);
    case 'rekap': izin_(u, 'rekap'); return rekap_(d);
    case 'manual': izin_(u, 'manual'); return manual_(d, u);
    case 'hapusHadir': izin_(u, 'hapus'); return hapusHadir_(d);
    case 'sesiSimpan': izin_(u, 'sesi'); return sesiSimpan_(d);
    case 'materiSimpan': izin_(u, 'materi'); return materiSimpan_(d, u);
    case 'masukan': izin_(u, 'masukan'); return masukanDaftar_();
    case 'masukanBaca': izin_(u, 'masukan'); return masukanBaca_(d);
    case 'masukanHapus': izin_(u, 'hapus'); return masukanHapus_(d);
    case 'jamaahTambah': izin_(u, 'jamaah'); return jamaahTambah_(d);
    case 'jamaahAktif': izin_(u, 'jamaah'); return jamaahAktif_(d);
    case 'cadangan': izin_(u, 'hapus'); return Object.assign({ ok: true }, cadangan_());
  }
  throw new AppError('data', 'Aksi tidak dikenali.');
}

/* ===================== utilitas ===================== */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function lembar_(kunci) {
  const s = ss_().getSheetByName(NAMA_LEMBAR[kunci]);
  if (!s) throw new AppError('belum_siap', 'Lembar "' + NAMA_LEMBAR[kunci] + '" belum ada. Jalankan menu Absensi Pengajian > Siapkan lembar.');
  return s;
}

function bacaMentah_(kunci, ekor) {
  const s = lembar_(kunci), akhir = s.getLastRow(), kol = KOLOM[kunci].length;
  if (akhir < 2) return [];
  let mulai = 2, n = akhir - 1;
  if (ekor && n > ekor) { mulai = akhir - ekor + 1; n = ekor; }
  return s.getRange(mulai, 1, n, kol).getValues();
}

function bacaBaris_(kunci) {
  return bacaMentah_(kunci).map(function (v, i) {
    const o = { baris: i + 2 };
    KOLOM[kunci].forEach(function (h, j) { o[h] = v[j]; });
    return o;
  });
}

function ms_(v) {
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (n > 1e11) return n;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function bool_(v, bawaan) {
  if (v === '' || v === null || v === undefined) return bawaan;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  return !(s === 'FALSE' || s === 'TIDAK' || s === 'NO' || s === '0' || s === 'N');
}

function id8_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

function rapikanTeks_(t) {
  return String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim();
}

/** Cegah rumus Sheets: teks yang diawali = + - @ diberi spasi di depan. */
function aman_(t) {
  const s = String(t === undefined || t === null ? '' : t);
  return /^[=+\-@\t\r]/.test(s) ? ' ' + s : s;
}

function bersih_() { CacheService.getScriptCache().remove('pub'); }

function kunci_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw new AppError('sibuk', 'Server sedang sibuk. Coba lagi sebentar.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function acak_(n) { return Math.floor(Math.random() * n); }

/* ===================== daftar data ===================== */

function jamaahDaftar_() {
  return bacaBaris_('jamaah').filter(function (o) { return rapikanTeks_(o.Nama); }).map(function (o) {
    return { baris: o.baris, id: String(o.ID || ''), nama: rapikanTeks_(o.Nama), aktif: bool_(o.Aktif, true), tamu: bool_(o.Tamu, false) };
  });
}

function kutipanDari_(o) {
  return o.KutipanArab ? {
    jenis: String(o.KutipanJenis || ''), ref: String(o.KutipanRujukan || ''), arab: String(o.KutipanArab),
    tr: String(o.KutipanTerjemah || ''), src: String(o.KutipanSumber || '')
  } : null;
}

function hari_(v) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 7 ? n : CFG.HARI_BUKA;
}

function sesiDaftar_() {
  return bacaBaris_('sesi').filter(function (o) { return o.ID && rapikanTeks_(o.Judul) && ms_(o.Mulai); }).map(function (o) {
    return {
      baris: o.baris, id: String(o.ID), judul: rapikanTeks_(o.Judul), pemateri: rapikanTeks_(o.Pemateri), tempat: rapikanTeks_(o.Tempat),
      mulai: ms_(o.Mulai), hari: hari_(o.HariBuka), ringkasan: String(o.Ringkasan || ''), k: kutipanDari_(o)
    };
  });
}

function pengurusDaftar_() {
  return bacaBaris_('pengurus').filter(function (o) { return rapikanTeks_(o.Nama); }).map(function (o) {
    return { baris: o.baris, nama: rapikanTeks_(o.Nama), peran: rapikanTeks_(o.Peran), hash: String(o.PIN_Hash || ''), garam: String(o.Garam || '') };
  });
}

function terbuka_(s, now) { return s.mulai <= now && now <= s.mulai + s.hari * 864e5; }

/** Beri ID pada baris yang ditambahkan langsung di Sheet. */
function rapikan_() {
  const sj = lembar_('jamaah'), nj = sj.getLastRow() - 1;
  if (nj > 0) {
    const rg = sj.getRange(2, 1, nj, 4), v = rg.getValues();
    let ubah = false;
    v.forEach(function (r) {
      if (!rapikanTeks_(r[0])) return;
      if (r[1] === '') { r[1] = true; ubah = true; }
      if (r[2] === '') { r[2] = false; ubah = true; }
      if (!r[3]) { r[3] = 'j' + id8_(); ubah = true; }
    });
    if (ubah) rg.setValues(v);
  }
  const ssi = lembar_('sesi'), ns = ssi.getLastRow() - 1;
  if (ns > 0) {
    const rg = ssi.getRange(2, 1, ns, KOLOM.sesi.length), v = rg.getValues();
    const ids = []; let ubah = false;
    v.forEach(function (r) {
      let id = r[11];
      if (!id && rapikanTeks_(r[0]) && ms_(r[3])) { id = 's' + id8_(); ubah = true; }
      ids.push([id]);
    });
    if (ubah) ssi.getRange(2, 12, ns, 1).setValues(ids);
  }
}

/* ===================== data publik untuk jamaah ===================== */

function publik_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('pub');
  if (hit) { const o = JSON.parse(hit); o.now = Date.now(); return o; }
  kunci_(function () { rapikan_(); lengkapiKutipan_(); });
  const now = Date.now();
  const sesi = sesiDaftar_().filter(function (s) { return terbuka_(s, now); })
    .sort(function (a, b) { return b.mulai - a.mulai; })
    .map(function (s) { return { id: s.id, judul: s.judul, pemateri: s.pemateri, tempat: s.tempat, mulai: s.mulai, hari: s.hari, ringkasan: s.ringkasan, k: s.k }; });
  const nama = jamaahDaftar_().filter(function (j) { return j.aktif && j.id; })
    .sort(function (a, b) { return a.nama.localeCompare(b.nama); })
    .map(function (j) { return [j.id, j.nama]; });
  const staf = pengurusDaftar_().filter(function (p) { return p.hash; }).map(function (p) { return { n: p.nama, p: p.peran }; });
  const out = { ok: true, now: now, sesi: sesi, nama: nama, staf: staf };
  try { cache.put('pub', JSON.stringify(out), CFG.PUBLIC_CACHE); } catch (e) { /* terlalu besar: abaikan */ }
  return out;
}

/* ===================== absen jamaah ===================== */

function tentukanJamaah_(d, daftar) {
  if (d.nid) {
    const j = daftar.filter(function (x) { return x.id === d.nid && x.aktif; })[0];
    if (!j) throw new AppError('data', 'Nama tidak ditemukan.');
    return { id: j.id, nama: j.nama };
  }
  const nama = rapikanTeks_(d.nama);
  if (nama.length < 3 || nama.length > CFG.MAX_NAMA) throw new AppError('data', 'Tulis nama lengkap (3 sampai ' + CFG.MAX_NAMA + ' huruf).');
  const sama = daftar.filter(function (x) { return x.nama.toLowerCase() === nama.toLowerCase(); })[0];
  if (sama) {
    if (!sama.aktif) lembar_('jamaah').getRange(sama.baris, 2).setValue(true);
    return { id: sama.id, nama: sama.nama };
  }
  const id = 'j' + id8_();
  lembar_('jamaah').appendRow([aman_(nama), true, true, id]);
  bersih_();
  return { id: id, nama: nama };
}

function sudahHadir_(sid, nid, ekor) {
  const s = lembar_('hadir'), akhir = s.getLastRow();
  if (akhir < 2) return false;
  let mulai = 2, n = akhir - 1;
  if (ekor && n > ekor) { mulai = akhir - ekor + 1; n = ekor; }
  return s.getRange(mulai, 8, n, 2).getValues().some(function (r) { return r[0] === sid && r[1] === nid; });
}

function absen_(d) {
  if (d.hp) return { ok: true };   // kolom jebakan terisi: kemungkinan bot
  if (d.kind !== 'TMM' && d.kind !== 'SDC') throw new AppError('data', 'Pilihan kehadiran tidak dikenali.');
  const dev = String(d.dev || '').slice(0, 40), cache = CacheService.getScriptCache(), tk = 'thr_' + dev;
  if (dev && Number(cache.get(tk) || 0) >= CFG.THROTTLE_MAX) {
    throw new AppError('terlalu_banyak', 'Terlalu banyak pengisian dari HP ini. Tunggu beberapa menit, atau minta tolong pengurus.');
  }
  const pub = publik_();
  const s = pub.sesi.filter(function (x) { return x.id === d.sid; })[0];
  if (!s || !terbuka_(s, pub.now)) {
    throw new AppError('ditutup', 'Absen untuk pengajian ini sudah ditutup. Silakan lapor ke pengurus atau muballigh.');
  }
  return kunci_(function () {
    const j = tentukanJamaah_(d, jamaahDaftar_());
    const materi = { ringkasan: s.ringkasan, k: s.k };
    if (sudahHadir_(s.id, j.id, 3000)) return { ok: true, dup: true, nid: j.id, nama: j.nama, materi: materi };
    const sekarang = new Date();
    lembar_('hadir').appendRow([new Date(s.mulai), aman_(s.judul), aman_(j.nama), KETERANGAN[d.kind], sekarang, '', '', s.id, j.id]);
    const fb = rapikanTeks_(d.fb).slice(0, CFG.MAX_MASUKAN);
    if (fb) lembar_('masukan').appendRow([sekarang, aman_(s.judul), d.anon ? '' : aman_(j.nama), aman_(fb), false, 'm' + id8_(), s.id, d.anon ? '' : j.id]);
    if (dev) cache.put(tk, String(Number(cache.get(tk) || 0) + 1), CFG.THROTTLE_DETIK);
    return { ok: true, dup: false, nid: j.id, nama: j.nama, materi: materi };
  });
}

/* ===================== login pengurus ===================== */

function hash_(garam, pin) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, garam + ':' + pin, Utilities.Charset.UTF_8);
  return b.map(function (x) { return (x < 0 ? x + 256 : x).toString(16).padStart(2, '0'); }).join('');
}

function aturPinBaris_(baris, pin) {
  const garam = Utilities.getUuid();
  lembar_('pengurus').getRange(baris, 3, 1, 2).setValues([[hash_(garam, pin), garam]]);
  bersih_();
}

function login_(d) {
  const nama = rapikanTeks_(d.nama), pin = String(d.pin || ''), cache = CacheService.getScriptCache();
  const fk = 'gagal_' + nama.toLowerCase();
  if (Number(cache.get(fk) || 0) >= CFG.LOGIN_MAX_GAGAL) {
    throw new AppError('terkunci', 'Terlalu banyak salah PIN. Coba lagi sekitar 10 menit lagi.');
  }
  const p = pengurusDaftar_().filter(function (x) { return x.nama.toLowerCase() === nama.toLowerCase(); })[0];
  if (!p || !p.hash || hash_(p.garam, pin) !== p.hash) {
    cache.put(fk, String(Number(cache.get(fk) || 0) + 1), CFG.LOGIN_KUNCI_DETIK);
    throw new AppError('login', 'Nama atau PIN belum tepat.');
  }
  cache.remove(fk);
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, JSON.stringify({ nama: p.nama, peran: p.peran }), CFG.TOKEN_TTL);
  return { ok: true, token: token, nama: p.nama, peran: p.peran, izin: PERAN[p.peran] || [] };
}

function otentikasi_(token) {
  const raw = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  if (!raw) throw new AppError('login', 'Sesi habis. Silakan masuk lagi.');
  return JSON.parse(raw);
}

function izin_(u, nama) {
  if ((PERAN[u.peran] || []).indexOf(nama) < 0) throw new AppError('izin', 'Peran Anda tidak punya akses ke fitur ini.');
}

/* ===================== layar pengurus ===================== */

function sesiRingkas_(s) {
  return { id: s.id, judul: s.judul, pemateri: s.pemateri, tempat: s.tempat, mulai: s.mulai, hari: s.hari, ringkasan: s.ringkasan, k: s.k };
}

function awal_(u) {
  let sesi = sesiDaftar_().sort(function (a, b) { return b.mulai - a.mulai; });
  if (u.peran === 'Pemateri') sesi = sesi.filter(function (s) { return s.pemateri.toLowerCase() === u.nama.toLowerCase(); });
  const pustaka = bacaBaris_('pustaka').filter(function (o) { return o.Arab; })
    .map(function (o) { return { baris: o.baris, jenis: String(o.Jenis), ref: String(o.Rujukan) }; });
  return {
    ok: true, now: Date.now(),
    sesi: sesi.slice(0, 40).map(sesiRingkas_),
    jamaah: jamaahDaftar_().map(function (j) { return [j.id, j.nama, j.aktif ? 1 : 0, j.tamu ? 1 : 0]; }),
    pustaka: pustaka,
    staf: pengurusDaftar_().map(function (p) { return p.nama; })
  };
}

function rekap_(d) {
  const dari = Number(d.dari) || 0, sampai = Number(d.sampai) || (Date.now() + 864e5);
  const sesi = sesiDaftar_().filter(function (s) { return s.mulai >= dari && s.mulai <= sampai; })
    .sort(function (a, b) { return b.mulai - a.mulai; });
  const ada = {};
  sesi.forEach(function (s) { ada[s.id] = 1; });
  const hadir = bacaMentah_('hadir').filter(function (r) { return ada[r[7]]; })
    .map(function (r) { return [r[7], r[8], r[3] === 'SDC' ? 'SDC' : 'TMM', ms_(r[4]), r[5] || '', r[6] || '']; });
  return {
    ok: true, now: Date.now(),
    sesi: sesi.map(function (s) { return [s.id, s.judul, s.pemateri, s.mulai]; }),
    hadir: hadir,
    jamaah: jamaahDaftar_().map(function (j) { return [j.id, j.nama, j.tamu ? 1 : 0, j.aktif ? 1 : 0]; })
  };
}

function manual_(d, u) {
  if (d.kind !== 'TMM' && d.kind !== 'SDC') throw new AppError('data', 'Pilih Tatap Muka Masjid atau SDC.');
  return kunci_(function () {
    const s = sesiDaftar_().filter(function (x) { return x.id === d.sid; })[0];
    if (!s) throw new AppError('data', 'Pengajian tidak ditemukan.');
    const j = tentukanJamaah_(d, jamaahDaftar_());
    if (sudahHadir_(s.id, j.id, 0)) return { ok: true, dup: true };
    lembar_('hadir').appendRow([new Date(s.mulai), aman_(s.judul), aman_(j.nama), KETERANGAN[d.kind], new Date(), aman_(u.nama), aman_(rapikanTeks_(d.catatan).slice(0, CFG.MAX_CATATAN)), s.id, j.id]);
    return { ok: true, dup: false, nid: j.id, nama: j.nama };
  });
}

function hapusHadir_(d) {
  return kunci_(function () {
    const s = lembar_('hadir'), akhir = s.getLastRow();
    if (akhir < 2) return { ok: true, terhapus: 0 };
    const v = s.getRange(2, 8, akhir - 1, 2).getValues();
    for (let i = v.length - 1; i >= 0; i--) {
      if (v[i][0] === d.sid && v[i][1] === d.nid) { s.deleteRow(i + 2); return { ok: true, terhapus: 1 }; }
    }
    return { ok: true, terhapus: 0 };
  });
}

function sesiSimpan_(d) {
  const judul = rapikanTeks_(d.judul), pemateri = rapikanTeks_(d.pemateri), tempat = rapikanTeks_(d.tempat);
  const mulai = Number(d.mulai), hr = hari_(d.hari);
  if (judul.length < 3 || judul.length > 100) throw new AppError('data', 'Judul pengajian 3 sampai 100 huruf.');
  if (!(mulai > 1e11)) throw new AppError('data', 'Waktu mulai belum diisi.');
  if (d.id) {
    return kunci_(function () {
      const s = sesiDaftar_().filter(function (x) { return x.id === d.id; })[0];
      if (!s) throw new AppError('data', 'Pengajian tidak ditemukan.');
      lembar_('sesi').getRange(s.baris, 1, 1, 5).setValues([[aman_(judul), aman_(pemateri), aman_(tempat), new Date(mulai), hr]]);
      bersih_();
      return { ok: true, id: s.id };
    });
  }
  const k = kutipanOtomatis_(judul + mulai);   // diambil di luar kunci karena bisa memakan waktu
  return kunci_(function () {
    const id = 's' + id8_();
    lembar_('sesi').appendRow([aman_(judul), aman_(pemateri), aman_(tempat), new Date(mulai), hr, '', '', '', '', '', '', id]);
    if (k) tulisKutipan_(lembar_('sesi').getLastRow(), k);
    bersih_();
    return { ok: true, id: id };
  });
}

/* ===================== materi dan kutipan ===================== */

function tulisKutipan_(baris, k) {
  lembar_('sesi').getRange(baris, 7, 1, 5).setValues([[
    k ? aman_(k.jenis) : '', k ? aman_(k.ref) : '', k ? aman_(k.arab) : '', k ? aman_(k.tr) : '', k ? aman_(k.src) : ''
  ]]);
}

function lengkapiKutipan_() {
  const now = Date.now();
  sesiDaftar_().filter(function (s) { return !s.k && terbuka_(s, now); }).forEach(function (s) {
    const k = kutipanOtomatis_(s.id);
    if (k) tulisKutipan_(s.baris, k);
  });
}

function dariPustaka_(o) {
  return {
    jenis: String(o.Jenis || ''), ref: String(o.Rujukan || ''), arab: String(o.Arab || ''), tr: String(o.Terjemah || ''),
    src: String(o.Sumber || '') + (o.Derajat ? ' · ' + o.Derajat : '')
  };
}

function pustakaAcak_(jenis) {
  let baris = bacaBaris_('pustaka').filter(function (o) { return o.Arab && o.Terjemah; });
  if (jenis) {
    const f = baris.filter(function (o) { return String(o.Jenis).toLowerCase() === jenis.toLowerCase(); });
    if (f.length) baris = f;
  }
  if (!baris.length) return null;
  const pakai = {};
  sesiDaftar_().sort(function (a, b) { return b.mulai - a.mulai; }).slice(0, 10).forEach(function (s) { if (s.k) pakai[s.k.ref] = 1; });
  const segar = baris.filter(function (o) { return !pakai[String(o.Rujukan)]; });
  const kolam = segar.length ? segar : baris;
  return dariPustaka_(kolam[acak_(kolam.length)]);
}

function ayat1_(ref) {
  try {
    const res = UrlFetchApp.fetch('https://api.alquran.cloud/v1/ayah/' + ref + '/editions/quran-uthmani,id.indonesian', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText());
    if (!j || j.code !== 200 || !j.data || j.data.length < 2) return null;
    const ar = j.data.filter(function (x) { return x.edition && x.edition.identifier === 'quran-uthmani'; })[0];
    const id = j.data.filter(function (x) { return x.edition && x.edition.identifier === 'id.indonesian'; })[0];
    if (!ar || !id || !ar.text || !id.text || !ar.surah) return null;
    let arab = String(ar.text);
    if (ar.numberInSurah === 1 && ar.surah.number !== 1 && ar.surah.number !== 9) {   // buang basmalah di awal surah
      const w = arab.split(' ');
      if (w.length > 4 && w[0].replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '') === 'بسم') arab = w.slice(4).join(' ');
    }
    return { arab: arab, tr: String(id.text), sur: ar.surah.number, ayat: ar.numberInSurah };
  } catch (e) {
    console.warn('Gagal mengambil ayat: ' + e);
    return null;
  }
}

function ayatAcak_() {
  let gagal = 0;
  for (let i = 0; i < 8 && gagal < 2; i++) {
    const x = ayat1_(String(1 + acak_(6236)));
    if (!x) { gagal++; continue; }
    if (x.arab.length <= 320 && x.tr.length <= 420 && x.sur >= 1 && x.sur <= 114) {
      return { jenis: 'Al-Qur’an', ref: 'QS. ' + NAMA_SURAH[x.sur - 1] + ': ' + x.ayat, arab: x.arab, tr: x.tr, src: SUMBER_AYAT };
    }
  }
  return null;
}

function kutipanOtomatis_(benih) {
  let h = 0;
  String(benih).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 1000003; });
  const quran = h % 2 === 0;
  let k = quran ? ayatAcak_() : null;
  if (!k) k = pustakaAcak_(quran ? null : 'Hadis');
  return k;
}

function normSurah_(t) { return String(t).toLowerCase().replace(/[^a-z]/g, ''); }

function surahDariNama_(t) {
  const q = normSurah_(t);
  if (q.length < 3) return 0;
  const semua = NAMA_SURAH.map(normSurah_);
  const tepat = semua.indexOf(q);
  if (tepat >= 0) return tepat + 1;
  const cocok = [];
  semua.forEach(function (n, i) { if (q.length >= 4 && n.indexOf(q) >= 0) cocok.push(i + 1); });
  return cocok.length === 1 ? cocok[0] : 0;
}

function parseAyat_(teks) {
  const s = rapikanTeks_(teks);
  let sur = 0, a1 = 0, a2 = 0;
  let m = s.match(/(\d{1,3})\s*[:.,]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/);
  if (m) { sur = +m[1]; a1 = +m[2]; a2 = m[3] ? +m[3] : a1; }
  else {
    m = s.match(/^(?:QS\.?\s*)?(.+?)[\s:]+(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/i);
    if (m) { sur = surahDariNama_(m[1]); a1 = +m[2]; a2 = m[3] ? +m[3] : a1; }
  }
  if (!(sur >= 1 && sur <= 114) || !(a1 >= 1) || a2 < a1 || a2 - a1 > 4) {
    throw new AppError('data', 'Rujukan tidak dikenali atau lebih dari 5 ayat. Contoh: 2:286 atau Al-Baqarah 285-286.');
  }
  return { sur: sur, a1: a1, a2: a2 };
}

function ayatDariApi_(p) {
  const arab = [], tr = [];
  for (let a = p.a1; a <= p.a2; a++) {
    const x = ayat1_(p.sur + ':' + a);
    if (!x) return null;
    arab.push(x.arab); tr.push(x.tr);
  }
  const rentang = p.a1 === p.a2 ? String(p.a1) : p.a1 + '-' + p.a2;
  return { jenis: 'Al-Qur’an', ref: 'QS. ' + NAMA_SURAH[p.sur - 1] + ': ' + rentang, arab: arab.join(' '), tr: tr.join(' '), src: SUMBER_AYAT };
}

function materiSimpan_(d, u) {
  const s = sesiDaftar_().filter(function (x) { return x.id === d.sid; })[0];
  if (!s) throw new AppError('data', 'Pengajian tidak ditemukan.');
  if (u.peran === 'Pemateri' && s.pemateri.toLowerCase() !== u.nama.toLowerCase()) {
    throw new AppError('izin', 'Anda hanya bisa mengisi materi pengajian Anda sendiri.');
  }
  const ringkasan = String(d.ringkasan || '').replace(/\r/g, '').trim().slice(0, 4000);
  const mode = d.mode || 'tetap';
  let k;   // undefined berarti kutipan tidak diubah
  if (mode === 'otomatis') {
    k = kutipanOtomatis_(s.id + Date.now());
    if (!k) throw new AppError('luring', 'Kutipan otomatis belum bisa diambil sekarang. Coba lagi nanti.');
  } else if (mode === 'ayat') {
    k = ayatDariApi_(parseAyat_(d.ref));
    if (!k) throw new AppError('luring', 'Ayat belum bisa diambil sekarang. Coba lagi, atau pakai Tulis sendiri.');
  } else if (mode === 'pustaka') {
    const o = bacaBaris_('pustaka').filter(function (x) { return x.baris === Number(d.baris) && x.Arab; })[0];
    if (!o) throw new AppError('data', 'Pilihan pustaka tidak ditemukan.');
    k = dariPustaka_(o);
  } else if (mode === 'manual') {
    k = {
      jenis: d.jenis === 'Hadis' ? 'Hadis' : 'Al-Qur’an', ref: rapikanTeks_(d.ref).slice(0, 120),
      arab: String(d.arab || '').trim().slice(0, 1500), tr: String(d.tr || '').trim().slice(0, 1500), src: rapikanTeks_(d.src).slice(0, 200)
    };
    if (!k.arab) throw new AppError('data', 'Teks Arab belum diisi.');
  }
  return kunci_(function () {
    lembar_('sesi').getRange(s.baris, 6).setValue(aman_(ringkasan));
    if (k !== undefined) tulisKutipan_(s.baris, k);
    bersih_();
    return { ok: true, k: k === undefined ? s.k : k };
  });
}

/* ===================== masukan ===================== */

function masukanDaftar_() {
  const daftar = bacaMentah_('masukan').map(function (r) {
    return { id: String(r[5]), sid: String(r[6]), judul: String(r[1]), nama: String(r[2] || ''), teks: String(r[3]), ts: ms_(r[0]), dibaca: bool_(r[4], false) };
  });
  daftar.sort(function (a, b) { return b.ts - a.ts; });
  return { ok: true, masukan: daftar.slice(0, 300) };
}

function masukanBaca_(d) {
  return kunci_(function () {
    const s = lembar_('masukan'), akhir = s.getLastRow();
    if (akhir < 2) return { ok: true };
    const v = s.getRange(2, 6, akhir - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) {
      if (v[i][0] === d.id) { s.getRange(i + 2, 5).setValue(!!d.dibaca); break; }
    }
    return { ok: true };
  });
}

function masukanHapus_(d) {
  return kunci_(function () {
    const s = lembar_('masukan'), akhir = s.getLastRow();
    if (akhir < 2) return { ok: true };
    const v = s.getRange(2, 6, akhir - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) {
      if (v[i][0] === d.id) { s.deleteRow(i + 2); break; }
    }
    return { ok: true };
  });
}

/* ===================== jamaah ===================== */

function jamaahTambah_(d) {
  const masuk = (Array.isArray(d.nama) ? d.nama : [d.nama]).map(rapikanTeks_).filter(function (n) { return n.length >= 3 && n.length <= CFG.MAX_NAMA; });
  if (!masuk.length) throw new AppError('data', 'Tulis minimal satu nama (3 huruf atau lebih).');
  if (masuk.length > 500) throw new AppError('data', 'Maksimal 500 nama sekali tambah.');
  return kunci_(function () {
    const ada = {};
    jamaahDaftar_().forEach(function (j) { ada[j.nama.toLowerCase()] = 1; });
    const baru = [];
    masuk.forEach(function (n) {
      if (ada[n.toLowerCase()]) return;
      ada[n.toLowerCase()] = 1;
      baru.push([aman_(n), true, false, 'j' + id8_()]);
    });
    if (baru.length) {
      const s = lembar_('jamaah');
      s.getRange(s.getLastRow() + 1, 1, baru.length, 4).setValues(baru);
      bersih_();
    }
    return { ok: true, ditambah: baru.length, dilewati: masuk.length - baru.length };
  });
}

function jamaahAktif_(d) {
  return kunci_(function () {
    const j = jamaahDaftar_().filter(function (x) { return x.id === d.id; })[0];
    if (!j) throw new AppError('data', 'Nama tidak ditemukan.');
    lembar_('jamaah').getRange(j.baris, 2).setValue(!!d.aktif);
    bersih_();
    return { ok: true };
  });
}

/* ===================== cadangan ke Google Drive ===================== */

function cadangan_() {
  const berkas = DriveApp.getFileById(ss_().getId());
  const it = DriveApp.getFoldersByName(CFG.FOLDER_CADANGAN);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(CFG.FOLDER_CADANGAN);
  const nama = 'Absensi Pengajian ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HHmm');
  const salinan = berkas.makeCopy(nama, folder);
  const semua = [], fi = folder.getFiles();
  while (fi.hasNext()) semua.push(fi.next());
  semua.sort(function (a, b) { return a.getDateCreated().getTime() - b.getDateCreated().getTime(); });
  while (semua.length > CFG.CADANGAN_SIMPAN) semua.shift().setTrashed(true);
  return { nama: nama, url: salinan.getUrl() };
}

function cadanganBulanan() { cadangan_(); }

/* ===================== menu di Google Sheet ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Absensi Pengajian')
    .addItem('1. Siapkan lembar', 'siapkan')
    .addItem('2. Atur PIN pengurus', 'aturPin')
    .addItem('3. Pasang cadangan otomatis tiap bulan', 'pasangCadanganBulanan')
    .addItem('Buat cadangan sekarang', 'cadanganSekarang')
    .addToUi();
}

function beritahu_(judul, isi) {
  try { SpreadsheetApp.getUi().alert(judul, isi, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(judul + ': ' + isi); }
}

function siapkan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  ss.setSpreadsheetTimeZone(CFG.TZ);
  Object.keys(NAMA_LEMBAR).forEach(function (k) {
    let s = ss.getSheetByName(NAMA_LEMBAR[k]);
    const baru = !s;
    if (!s) s = ss.insertSheet(NAMA_LEMBAR[k]);
    const kop = KOLOM[k];
    s.getRange(1, 1, 1, kop.length).setValues([kop]).setFontWeight('bold').setBackground('#DCEEE4');
    s.setFrozenRows(1);
    if (baru) seed_(k, s);
  });
  const lama = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1') || ss.getSheetByName('Lembar1');
  if (lama && ss.getSheets().length > 1 && lama.getLastRow() === 0) ss.deleteSheet(lama);
  beritahu_('Siap', 'Lembar sudah disiapkan. Langkah berikutnya: menu Absensi Pengajian > Atur PIN pengurus.');
}

function seed_(k, s) {
  if (k === 'pengurus') {
    s.getRange(2, 1, 3, 2).setValues([['Administrator', 'Administrator'], ['Aep Supiana', 'Ketua Kelompok'], ['Alifar Ihsan Azhari', 'Muballigh']]);
  } else if (k === 'pustaka') {
    const bm = 'HR. Bukhari dan Muslim';
    s.getRange(2, 1, 7, 6).setValues([
      ['Hadis', bm + ' (niat)', 'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى', 'Sesungguhnya setiap amal tergantung pada niatnya, dan setiap orang mendapatkan sesuai dengan apa yang diniatkannya.', bm, 'Sahih (muttafaq ’alaih)'],
      ['Hadis', 'HR. Bukhari (belajar Al-Qur’an)', 'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', 'Sebaik-baik kalian adalah orang yang belajar Al-Qur’an dan mengajarkannya.', 'HR. Bukhari', 'Sahih'],
      ['Hadis', 'HR. Muslim (menuntut ilmu)', 'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ', 'Barang siapa menempuh suatu jalan untuk mencari ilmu, Allah mudahkan baginya jalan menuju surga.', 'HR. Muslim', 'Sahih'],
      ['Hadis', 'HR. Muslim (nasihat)', 'الدِّينُ النَّصِيحَةُ', 'Agama itu adalah nasihat.', 'HR. Muslim', 'Sahih'],
      ['Hadis', bm + ' (mencintai saudara)', 'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ', 'Tidaklah beriman salah seorang di antara kalian hingga ia mencintai untuk saudaranya apa yang ia cintai untuk dirinya sendiri.', bm, 'Sahih (muttafaq ’alaih)'],
      ['Al-Qur’an', 'QS. Al-Insyirah: 5-6', 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ۝ إِنَّ مَعَ الْعُسْرِ يُسْرًا', 'Maka sesungguhnya beserta kesulitan ada kemudahan. Sesungguhnya beserta kesulitan ada kemudahan.', 'Terjemahan Kemenag RI', ''],
      ['Al-Qur’an', 'QS. Al-Ikhlas: 1-4', 'قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ', 'Katakanlah, “Dialah Allah, Yang Maha Esa. Allah tempat meminta segala sesuatu. (Allah) tidak beranak dan tidak pula diperanakkan. Dan tidak ada sesuatu yang setara dengan Dia.”', 'Terjemahan Kemenag RI', '']
    ]);
  }
}

function aturPin() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Atur PIN pengurus', 'Ketik nama pengurus persis seperti di lembar Pengurus:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const nama = rapikanTeks_(r1.getResponseText());
  const p = pengurusDaftar_().filter(function (x) { return x.nama.toLowerCase() === nama.toLowerCase(); })[0];
  if (!p) { ui.alert('Nama tidak ditemukan', 'Periksa penulisan nama di lembar Pengurus.', ui.ButtonSet.OK); return; }
  const r2 = ui.prompt('PIN baru untuk ' + p.nama, 'Gunakan 6 angka (minimal 4). PIN disimpan sebagai sidik digital, bukan teks.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const pin = r2.getResponseText().trim();
  if (!/^\d{4,8}$/.test(pin)) { ui.alert('PIN tidak valid', 'PIN harus 4 sampai 8 angka.', ui.ButtonSet.OK); return; }
  aturPinBaris_(p.baris, pin);
  ui.alert('Selesai', 'PIN untuk ' + p.nama + ' sudah diatur.', ui.ButtonSet.OK);
}

function pasangCadanganBulanan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cadanganBulanan') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cadanganBulanan').timeBased().onMonthDay(1).atHour(3).create();
  beritahu_('Selesai', 'Cadangan otomatis akan dibuat tiap tanggal 1 di folder "' + CFG.FOLDER_CADANGAN + '" pada Google Drive Anda.');
}

function cadanganSekarang() {
  const c = cadangan_();
  beritahu_('Cadangan dibuat', c.nama + '\n' + c.url);
}
