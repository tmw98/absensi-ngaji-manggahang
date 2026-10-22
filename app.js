/* Absensi Pengajian: tampilan web. Data disimpan di Google Sheets lewat Apps Script (lihat backend/Code.gs). */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var TZ = 'Asia/Jakarta', H = 3600e3, DAY = 24 * H;
  var KIND = { TMM: 'Tatap Muka Masjid', SDC: 'SDC (via Moomla)' };
  var TABS = [['rekap', 'Rekap'], ['manual', 'Input manual'], ['sesi', 'Sesi'], ['materi', 'Materi'], ['masukan', 'Masukan'], ['jamaah', 'Jamaah']];
  var RANGES = [['7', '7 hari'], ['30', '30 hari'], ['3m', '3 bulan'], ['6m', '6 bulan'], ['1y', '1 tahun'], ['all', 'Semua'], ['custom', 'Pilih tanggal']];
  var ST = { open: 'Terbuka', closed: 'Ditutup', soon: 'Belum mulai' };

  var S = {
    mode: location.hash === '#pengurus' ? 'pengurus' : 'jamaah',
    j: { step: 'list' }, boot: null, bootAt: 0, skew: 0, err: '', busy: false, thr: [],
    staff: null, loginErr: '', tab: 'rekap', loading: {}, loadErr: '',
    rg: '30', from: '', to: '', ft: 'all', fk: 'all', rk: null, rd: null,
    aw: null, mk: null, mn: null, mt: null, fq: 'all', del: null, mtK: null, backup: null, dev: ''
  };
  try {
    var saved = JSON.parse(sessionStorage.getItem('staff') || 'null');
    if (saved && saved.token) S.staff = saved;
    S.backup = Number(localStorage.getItem('backup')) || null;
    S.dev = localStorage.getItem('dev') || '';
    if (!S.dev) { S.dev = 'd' + Math.random().toString(36).slice(2, 12); localStorage.setItem('dev', S.dev); }
  } catch (e) { /* penyimpanan tidak tersedia: tidak masalah */ }
  if (!S.dev) S.dev = 'd' + Math.random().toString(36).slice(2, 12);

  /* ---------- utilitas ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nowMs() { return Date.now() + S.skew; }
  function fmt(t) {
    return new Date(t).toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ })
      .replace(/(\d{2})\.(\d{2})$/, '$1:$2') + ' WIB';
  }
  function fmtDay(t) { return new Date(t).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }); }
  function shortDay(t) { return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ }); }
  function wibInput(t) { return new Date(t + 7 * H).toISOString().slice(0, 16); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function mkErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 3200); }
  function selA(v, cur) { return v === cur ? ' selected' : ''; }
  function opts(list, sel, val, label) {
    return list.map(function (x) { return '<option value="' + esc(val(x)) + '"' + selA(val(x), sel) + '>' + esc(label(x)) + '</option>'; }).join('');
  }
  function left(s) {
    var h = Math.max(0, Math.floor((s.mulai + s.hari * DAY - nowMs()) / H)), d = Math.floor(h / 24);
    return d > 0 ? d + ' hari ' + (h % 24) + ' jam lagi' : h + ' jam lagi';
  }
  function status(s) {
    var n = nowMs();
    return n < s.mulai ? 'soon' : (n <= s.mulai + s.hari * DAY ? 'open' : 'closed');
  }
  function spinCard(text) { return '<div class="loading"><div class="spin" aria-hidden="true"></div><span>' + esc(text || 'Memuat...') + '</span></div>'; }
  function errCard(msg) { return '<div class="card"><p class="err">' + esc(msg) + '</p><button class="btn alt" data-act="retry">Coba lagi</button></div>'; }
  function can(k) { return !!S.staff && (S.staff.izin || []).indexOf(k) > -1; }

  /* ---------- API ---------- */
  function endpoint(query) {
    if (!CFG.API_URL || /GANTI_DENGAN/.test(CFG.API_URL)) return null;
    return CFG.API_URL + (query ? (CFG.API_URL.indexOf('?') > -1 ? '&' : '?') + query : '');
  }
  function handle(p) {
    return p.then(function (r) { return r.json(); }, function () { throw mkErr('net', 'Tidak bisa terhubung. Periksa sinyal, lalu coba lagi.'); })
      .then(function (d) {
        if (d && d.ok) return d;
        throw mkErr((d && d.kode) || 'galat', (d && d.pesan) || 'Terjadi kesalahan. Coba lagi.');
      }, function (e) {
        if (e && e.code) throw e;
        throw mkErr('galat', 'Server belum merespons dengan benar. Coba lagi sebentar.');
      });
  }
  /** Percobaan ulang hanya untuk keadaan yang aman diulang: server sibuk, atau (untuk absen) jaringan putus. */
  function post(body, opt) {
    var url = endpoint();
    if (!url) return Promise.reject(mkErr('config', 'Aplikasi belum tersambung ke Google Sheets. Isi API_URL di config.js (lihat README).'));
    var tries = (opt && opt.tries) || 1, netRetry = !!(opt && opt.netRetry), n = 0;
    function go() {
      n++;
      return handle(fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }))
        .catch(function (e) {
          if (n < tries && (e.code === 'sibuk' || (netRetry && e.code === 'net'))) return wait(1200 * n).then(go);
          throw e;
        });
    }
    return go();
  }
  function sc(aksi, extra) {
    var b = { aksi: aksi, token: S.staff ? S.staff.token : '' };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
    return post(b, { tries: 2 }).catch(function (e) {
      if (e.code === 'login' || e.code === 'terkunci') logout(e.message);
      throw e;
    });
  }
  function need(key, fn) {
    if (S.loading[key]) return;
    S.loading[key] = true;
    fn().then(function () { S.loading[key] = false; render(false); },
      function (e) { S.loading[key] = false; S.loadErr = e.message; render(false); });
  }
  function loadBoot(force) {
    if (!force && S.boot && Date.now() - S.bootAt < 45000) return;
    if (S.loading.boot) return;
    var url = endpoint('aksi=public');
    if (!url) { S.err = 'Aplikasi belum tersambung ke Google Sheets. Isi API_URL di config.js (lihat README).'; return; }
    S.loading.boot = true; S.err = '';
    handle(fetch(url)).then(function (d) {
      S.boot = d; S.bootAt = Date.now(); S.skew = d.now - Date.now(); S.loading.boot = false; render(false);
    }, function (e) { S.loading.boot = false; S.err = e.message; render(false); });
  }

  /* ---------- kutipan ayat/hadis (sudah disiapkan server) ---------- */
  function quoteInner(k) {
    return '<h3>' + esc(k.jenis || 'Kutipan') + ' hari ini</h3>' + (k.arab ? '<p class="ar" lang="ar" dir="rtl">' + esc(k.arab) + '</p>' : '') +
      (k.tr ? '<p>' + esc(k.tr) + '</p>' : '') + '<p class="src">' + esc(k.ref || '') + (k.src ? ' · ' + esc(k.src) : '') + '</p>';
  }
  function quoteCard(k) { return k && k.arab ? '<section class="card quote">' + quoteInner(k) + '</section>' : ''; }

  /* ---------- tampilan jamaah ---------- */
  function jamaahView() {
    var head = '<div class="bism" lang="ar" dir="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>';
    if (S.err && !S.boot) return head + errCard(S.err);
    if (!S.boot) { loadBoot(true); return head + spinCard('Memuat daftar pengajian...'); }
    var j = S.j;
    if (j.step === 'name') return head + nameStep();
    if (j.step === 'attend') return head + attendStep();
    if (j.step === 'done') return doneStep();
    var open = S.boot.sesi.filter(function (s) { return status(s) === 'open'; }).sort(function (a, b) { return b.mulai - a.mulai; });
    var list = open.length ? open.map(function (s) {
      return '<button class="sess" data-act="pick" data-id="' + esc(s.id) + '"><b>' + esc(s.judul) + '</b><span>' + esc(fmt(s.mulai)) + '</span><span class="muted small">Pemateri: ' + esc(s.pemateri || '-') + ' · absen ditutup ' + left(s) + '</span></button>';
    }).join('') : '<div class="card"><p>Belum ada pengajian yang absensinya terbuka.</p></div>';
    return head + '<h1>Pilih pengajian</h1><div class="stack">' + list + '</div>' +
      '<p class="muted small">Absen dibuka sampai 3 hari setelah pengajian dimulai. Jika sudah lewat dari itu, silakan lapor ke pengurus atau muballigh lewat WhatsApp untuk diinputkan.</p>';
  }
  function sessOf(id) { return S.boot.sesi.filter(function (s) { return s.id === id; })[0]; }
  function nameListHTML(q) {
    var ql = q.toLowerCase();
    var list = S.boot.nama.filter(function (n) { return n[1].toLowerCase().indexOf(ql) > -1; }).slice(0, 80);
    if (!list.length) return '<p class="muted">Nama tidak ditemukan. Buka “Nama saya belum ada” di bawah.</p>';
    return list.map(function (n) { return '<button class="name" data-act="name" data-id="' + esc(n[0]) + '"><span>' + esc(n[1]) + '</span></button>'; }).join('') +
      (S.boot.nama.length > 80 && !ql ? '<p class="muted small">Ketik sebagian nama untuk mempersempit daftar.</p>' : '');
  }
  function nameStep() {
    var s = sessOf(S.j.sid);
    if (!s) { S.j = { step: 'list' }; return jamaahView(); }
    return '<button class="back" data-act="back">← Pilih pengajian lain</button>' +
      '<div class="card"><h2>' + esc(s.judul) + '</h2><p class="muted">' + esc(fmt(s.mulai)) + '</p></div>' +
      '<div><label class="lbl" for="q">Cari nama Anda</label><input id="q" type="search" autocomplete="off" placeholder="Ketik sebagian nama"></div>' +
      '<div id="nameList" class="stack">' + nameListHTML('') + '</div>' +
      '<details class="card"><summary>Nama saya belum ada</summary><div class="stack"><div><label class="lbl" for="nn">Tulis nama lengkap</label><input id="nn" autocomplete="name" maxlength="60"></div>' +
      '<input class="hp" id="hp2" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="btn" data-act="addname">Lanjut</button></div></details>';
  }
  function attendStep() {
    var s = sessOf(S.j.sid), n = S.j.nama, dis = S.busy ? ' disabled' : '';
    if (!s) { S.j = { step: 'list' }; return jamaahView(); }
    return '<button class="back" data-act="back-name">← Bukan saya</button>' +
      '<div class="card"><h2>' + esc(n) + '</h2><p class="muted">' + esc(s.judul) + ' · ' + esc(fmt(s.mulai)) + '</p></div>' +
      '<div class="card"><div><label class="lbl" for="fb">Masukan, saran, atau kritik (boleh dikosongkan)</label><textarea id="fb" maxlength="500" placeholder="Tulis di sini jika ada"></textarea></div>' +
      '<label class="radio"><input type="checkbox" id="anon"><span>Kirim masukan tanpa nama</span></label>' +
      '<input class="hp" id="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<p class="muted small">Masukan dibaca oleh administrator, ketua kelompok, dan muballigh.</p></div>' +
      '<p class="lbl">Anda hadir lewat mana?</p>' +
      '<button class="btn"' + dis + ' data-act="submit" data-k="TMM">' + (S.busy ? 'Menyimpan...' : 'Hadir: Tatap Muka Masjid') + '</button>' +
      '<button class="btn sdc"' + dis + ' data-act="submit" data-k="SDC">' + (S.busy ? 'Menyimpan...' : 'Hadir: SDC (via Moomla)') + '</button>';
  }
  function doneStep() {
    var r = S.j.res, m = r.materi || {};
    return '<div class="card ok"><div class="okmark" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<h2>' + (r.dup ? 'Anda sudah tercatat hadir' : 'Alhamdulillah, kehadiran tercatat') + '</h2>' +
      '<p>' + esc(r.nama) + (r.dup ? '' : ' · <span class="k k-' + esc(S.j.kat) + '">' + esc(KIND[S.j.kat]) + '</span>') + '</p></div>' +
      '<section class="card"><h3>Ringkasan materi</h3>' + (m.ringkasan ? '<p class="pre">' + esc(m.ringkasan) + '</p>' : '<p class="muted">Ringkasan materi belum diisi pemateri. Silakan cek lagi nanti.</p>') + '</section>' +
      quoteCard(m.k) + '<button class="btn alt" data-act="finish">Selesai</button>';
  }

  /* ---------- tampilan pengurus ---------- */
  function loginView() {
    if (!S.boot) { loadBoot(true); return S.err ? errCard(S.err) : spinCard(); }
    var staf = S.boot.staf || [];
    if (!staf.length) return '<div class="card"><p>Belum ada pengurus yang punya PIN. Atur PIN lewat menu Absensi Pengajian di Google Sheet (lihat README).</p></div>';
    return '<h1>Masuk pengurus</h1><div class="card"><p class="lbl">Siapa Anda?</p>' +
      staf.map(function (p, i) {
        return '<label class="radio"><input type="radio" name="who" value="' + i + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + esc(p.n) + '</b><br><span class="muted small">' + esc(p.p) + '</span></span></label>';
      }).join('') +
      '<div><label class="lbl" for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off"></div>' +
      (S.loginErr ? '<p class="err">' + esc(S.loginErr) + '</p>' : '') +
      '<button class="btn" data-act="login"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Memeriksa...' : 'Masuk') + '</button></div>';
  }
  function pengurusView() {
    if (!S.staff) return loginView();
    var allowed = TABS.filter(function (t) { return can(t[0]); });
    if (!allowed.length) return '<div class="who"><b>' + esc(S.staff.nama) + '</b><button class="btn ghost sm" data-act="logout">Keluar</button></div><div class="card"><p>Peran Anda belum punya menu. Hubungi administrator.</p></div>';
    if (!allowed.some(function (t) { return t[0] === S.tab; })) S.tab = allowed[0][0];
    var unread = S.mk ? S.mk.filter(function (f) { return !f.dibaca; }).length : 0;
    var tabs = allowed.map(function (t) {
      return '<button data-act="tab" data-v="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + (t[0] === 'masukan' && unread ? '<span class="badge">' + unread + '</span>' : '') + '</button>';
    }).join('');
    var body = S.loadErr ? errCard(S.loadErr) : { rekap: rekapTab, manual: manualTab, sesi: sesiTab, materi: materiTab, masukan: masukanTab, jamaah: jamaahTab }[S.tab]();
    return '<div class="who"><div><b>' + esc(S.staff.nama) + '</b><br><span class="muted small">' + esc(S.staff.peran) + '</span></div><button class="btn ghost sm" data-act="logout">Keluar</button></div>' +
      '<div class="tabs" role="group" aria-label="Menu pengurus">' + tabs + '</div>' + body;
  }

  function delCtl(key) {
    if (!can('hapus')) return '';
    if (S.del === key) return '<span class="err small">Hapus?</span><button class="btn danger sm" data-act="del-yes" data-k="' + esc(key) + '">Ya, hapus</button><button class="btn ghost sm" data-act="del-no">Batal</button>';
    return '<button class="btn ghost sm" data-act="del-ask" data-k="' + esc(key) + '">Hapus</button>';
  }
  function loadAw() {
    return sc('awal').then(function (d) {
      S.skew = d.now - Date.now();
      S.aw = { sesi: d.sesi, jamaah: d.jamaah.map(function (r) { return { id: r[0], nama: r[1], aktif: !!r[2], tamu: !!r[3] }; }), pustaka: d.pustaka };
    });
  }
  function sessOpts(sel) { return opts(S.aw.sesi, sel, function (s) { return s.id; }, function (s) { return s.judul + ' · ' + shortDay(s.mulai) + ' (' + ST[status(s)].toLowerCase() + ')'; }); }
  function resetStaffData() { S.rk = null; S.aw = null; S.mk = null; S.mtK = null; S.loadErr = ''; }

  /* rekap */
  function rangeBounds() {
    var n = Date.now();
    if (S.rg === 'custom') return [S.from ? new Date(S.from + 'T00:00:00+07:00').getTime() : 0, S.to ? new Date(S.to + 'T23:59:59+07:00').getTime() : n];
    var days = { '7': 7, '30': 30, '3m': 91, '6m': 182, '1y': 365 }[S.rg];
    return days ? [n - days * DAY, n] : [0, n];
  }
  function rkKey() { return S.rg === 'custom' ? 'c:' + S.from + '|' + S.to : S.rg + ':' + Math.floor(Date.now() / DAY); }
  function loadRk() {
    var b = rangeBounds(), key = rkKey();
    return sc('rekap', { dari: b[0], sampai: b[1] }).then(function (d) {
      var titles = []; d.sesi.forEach(function (r) { if (titles.indexOf(r[1]) < 0) titles.push(r[1]); });
      S.rk = {
        key: key, judul: titles,
        sesi: d.sesi.map(function (r) { return { id: r[0], judul: r[1], pemateri: r[2], mulai: r[3] }; }),
        hadir: d.hadir.map(function (r) { return { sid: r[0], jid: r[1], kat: r[2], at: r[3], by: r[4], note: r[5] }; }),
        jamaah: d.jamaah.map(function (r) { return { id: r[0], nama: r[1], tamu: r[2], aktif: r[3] }; })
      };
    });
  }
  function rangeLabel() {
    var b = rangeBounds(), r = RANGES.filter(function (x) { return x[0] === S.rg; })[0][1];
    return S.rg === 'all' ? 'Semua data' : r + ' (' + (b[0] ? fmtDay(b[0]) : 'awal') + ' sampai ' + fmtDay(b[1]) + ')';
  }
  function rekapData() {
    var rk = S.rk, ids = {}, names = {};
    if (S.ft !== 'all' && rk.judul.indexOf(S.ft) < 0) S.ft = 'all';
    var ss = rk.sesi.filter(function (s) { return S.ft === 'all' || s.judul === S.ft; });
    ss.forEach(function (s) { ids[s.id] = 1; });
    rk.jamaah.forEach(function (j) { names[j.id] = j.nama; });
    var rs = rk.hadir.filter(function (a) { return ids[a.sid] && (S.fk === 'all' || a.kat === S.fk); });
    var bySess = {}, byName = {};
    rs.forEach(function (a) {
      var q = bySess[a.sid] || (bySess[a.sid] = { t: 0, m: 0, d: 0 }); q.t++; if (a.kat === 'TMM') q.m++; else q.d++;
      var p = byName[a.jid] || (byName[a.jid] = { t: 0, m: 0, d: 0 }); p.t++; if (a.kat === 'TMM') p.m++; else p.d++;
    });
    return { ss: ss, rs: rs, bySess: bySess, byName: byName, names: names };
  }
  function tableRows(d) {
    var n = d.ss.length;
    return S.rk.jamaah.filter(function (j) { return j.aktif || d.byName[j.id]; }).map(function (x) {
      var p = d.byName[x.id] || { t: 0, m: 0, d: 0 };
      return [x.nama, p.t, n ? Math.round(p.t / n * 100) + '%' : '0%', p.m, p.d];
    }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
  }
  var PER_HEAD = ['Nama', 'Hadir', 'Persen', 'Tatap Muka Masjid', 'SDC'];
  function nameSort(d) { return function (a, b) { return (d.names[a.jid] || '').localeCompare(d.names[b.jid] || ''); }; }
  function waText(d, s) {
    var rs = d.rs.filter(function (a) { return a.sid === s.id; }).sort(nameSort(d));
    var m = 0, v = 0; rs.forEach(function (r) { if (r.kat === 'TMM') m++; else v++; });
    return '*Rekap Kehadiran Pengajian*\n' + s.judul + '\n' + fmtDay(s.mulai) + '\nPemateri: ' + (s.pemateri || '-') +
      '\n\nHadir: ' + rs.length + ' (' + m + ' Tatap Muka Masjid, ' + v + ' SDC)\n\n' +
      rs.map(function (r, i) { return (i + 1) + '. ' + (d.names[r.jid] || '-') + ' (' + (r.kat === 'SDC' ? 'SDC' : 'Masjid') + ')'; }).join('\n');
  }
  function rekapFilters() {
    var titles = S.rk ? S.rk.judul : [];
    return '<div class="card"><h3>Rentang waktu</h3><div class="range" role="group" aria-label="Rentang waktu">' +
      RANGES.map(function (r) { return '<button data-act="range" data-v="' + r[0] + '" aria-pressed="' + (S.rg === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>' +
      (S.rg === 'custom' ? '<div class="grid2"><div><label class="lbl" for="rgFrom">Dari</label><input id="rgFrom" type="date" data-sel="from" value="' + esc(S.from) + '"></div><div><label class="lbl" for="rgTo">Sampai</label><input id="rgTo" type="date" data-sel="to" value="' + esc(S.to) + '"></div></div>' : '') +
      '<div class="grid2"><div><label class="lbl" for="ftSel">Pengajian</label><select id="ftSel" data-sel="ft"><option value="all">Semua judul</option>' +
      titles.map(function (t) { return '<option value="' + esc(t) + '"' + selA(t, S.ft) + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="lbl" for="fkSel">Keterangan</label><select id="fkSel" data-sel="fk"><option value="all">Semua</option><option value="TMM"' + selA('TMM', S.fk) + '>Tatap Muka Masjid</option><option value="SDC"' + selA('SDC', S.fk) + '>SDC</option></select></div></div>' +
      '<button class="btn ghost sm" data-act="reload">Muat ulang data</button></div>';
  }
  function rekapTab() {
    if (!S.rk || S.rk.key !== rkKey()) {
      need('rk:' + rkKey(), loadRk);
      return rekapFilters() + spinCard('Memuat rekap... (rentang panjang bisa memakan waktu)');
    }
    var d = rekapData(), ss = d.ss, n = ss.length, rows = tableRows(d);
    var head = rekapFilters();
    if (!n) return head + '<div class="card"><p>Tidak ada pengajian pada rentang ini.</p></div>';
    if (!ss.some(function (s) { return s.id === S.rd; })) S.rd = ss[0].id;
    var tmm = d.rs.filter(function (a) { return a.kat === 'TMM'; }).length;
    var last3 = ss.slice(0, 3).map(function (s) { return s.id; });
    var present = {}; S.rk.hadir.forEach(function (a) { if (last3.indexOf(a.sid) > -1) present[a.jid] = 1; });
    var absent = S.rk.jamaah.filter(function (j) { return j.aktif && !present[j.id]; });
    var stats = '<div class="card"><div class="grid2"><div class="stat"><b>' + n + '</b>Pengajian</div><div class="stat"><b>' + d.rs.length + '</b>Total hadir</div><div class="stat"><b>' + (d.rs.length / n).toFixed(1) + '</b>Rata-rata per pengajian</div><div class="stat"><b>' + tmm + ' · ' + (d.rs.length - tmm) + '</b>Masjid · SDC</div></div></div>';
    var perSess = '<div class="card"><h3>Per pengajian</h3><div class="scroll tall"><table><thead><tr><th>Tanggal</th><th>Judul</th><th class="num">Hadir</th><th class="num">Masjid</th><th class="num">SDC</th></tr></thead><tbody>' +
      ss.map(function (x) { var q = d.bySess[x.id] || { t: 0, m: 0, d: 0 }; return '<tr><td>' + shortDay(x.mulai) + '</td><td>' + esc(x.judul) + '</td><td class="num">' + q.t + '</td><td class="num">' + q.m + '</td><td class="num">' + q.d + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var perName = '<div class="card"><h3>Kehadiran per jamaah</h3><div class="scroll tall"><table><thead><tr><th>Nama</th><th class="num">Hadir</th><th class="num">%</th><th class="num">Masjid</th><th class="num">SDC</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td><td class="num">' + r[4] + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var abs = '<div class="card"><h3>Belum hadir di 3 pengajian terakhir</h3>' + (absent.length ? '<div class="chips">' + absent.map(function (x) { return '<span class="chip">' + esc(x.nama) + '</span>'; }).join('') + '</div><p class="muted small">Layak ditanyakan kabarnya.</p>' : '<p class="muted">Semua jamaah hadir minimal sekali.</p>') + '</div>';
    var s = ss.filter(function (x) { return x.id === S.rd; })[0];
    var rs = d.rs.filter(function (a) { return a.sid === s.id; }).sort(nameSort(d));
    var det = '<div class="card"><h3>Daftar nama per pengajian</h3><select id="rdSel" data-sel="rd" aria-label="Pilih pengajian">' +
      opts(ss.slice(0, 60), S.rd, function (x) { return x.id; }, function (x) { return x.judul + ' · ' + shortDay(x.mulai); }) + '</select>' +
      (n > 60 ? '<p class="muted small">Menampilkan 60 pengajian terbaru dalam rentang ini.</p>' : '') +
      '<div class="tall">' + (rs.length ? rs.map(function (r) {
        return '<div class="row"><span>' + esc(d.names[r.jid] || '-') + (r.by ? '<br><span class="muted small">diinput ' + esc(r.by) + (r.note ? ': ' + esc(r.note) : '') + '</span>' : '') + '</span><span class="chips"><span class="k k-' + esc(r.kat) + '">' + esc(KIND[r.kat]) + '</span>' + delCtl('at:' + r.sid + ':' + r.jid) + '</span></div>';
      }).join('') : '<p class="muted">Belum ada yang hadir.</p>') + '</div></div>' +
      '<div class="card"><h3>Teks untuk WhatsApp</h3><textarea id="wa" readonly rows="8">' + esc(waText(d, s)) + '</textarea><button class="btn" data-act="copy">Salin ke WhatsApp</button></div>';
    var bk = '<div class="card"><h3>Unduh dan cadangan</h3><p class="note">' + (S.backup ? 'Excel terakhir diunduh dari perangkat ini: ' + esc(fmtDay(S.backup)) + '.' : 'Excel belum pernah diunduh dari perangkat ini.') + '</p>' +
      '<p class="muted small">File Excel berisi rekap sesuai filter di atas: ringkasan, per jamaah, per pengajian, dan daftar hadir lengkap.</p>' +
      '<button class="btn" data-act="excel">Unduh Excel (.xlsx)</button>' +
      (can('hapus') ? '<button class="btn alt" data-act="cadangan"' + (S.busy ? ' disabled' : '') + '>Buat salinan cadangan di Google Drive</button><p class="muted small">Salinan seluruh Sheet disimpan di folder “Cadangan Absensi Pengajian” pada Drive pemilik Sheet.</p>' : '') +
      '<details><summary>Salin sebagai tabel</summary><div class="stack"><textarea id="tsv" readonly rows="5">' + esc([PER_HEAD].concat(rows).map(function (r) { return r.join('\t'); }).join('\n')) + '</textarea><button class="btn alt" data-act="tsv">Salin tabel</button><p class="muted small">Tempel di Excel atau Google Sheets.</p></div></details></div>';
    return head + stats + perSess + perName + abs + det + bk;
  }
  function saveExcel() {
    if (!window.XLSX) { toast('Pustaka Excel belum termuat. Coba lagi sebentar atau pakai Salin sebagai tabel.'); return; }
    var d = rekapData(), order = {};
    d.ss.forEach(function (s, i) { order[s.id] = i; });
    var info = [['Rekap Kehadiran Pengajian'], ['Rentang', rangeLabel()], ['Judul', S.ft === 'all' ? 'Semua' : S.ft], ['Keterangan', S.fk === 'all' ? 'Semua' : KIND[S.fk]], ['Jumlah pengajian', d.ss.length], ['Total kehadiran', d.rs.length], ['Dibuat', fmt(Date.now())]];
    var sesi = [['Tanggal', 'Judul', 'Pemateri', 'Hadir', 'Tatap Muka Masjid', 'SDC']].concat(d.ss.map(function (s) {
      var q = d.bySess[s.id] || { t: 0, m: 0, d: 0 };
      return [fmtDay(s.mulai), s.judul, s.pemateri, q.t, q.m, q.d];
    }));
    var sById = {}; d.ss.forEach(function (s) { sById[s.id] = s; });
    var det = [['Tanggal', 'Judul', 'Nama', 'Keterangan', 'Diinput oleh', 'Catatan']].concat(d.rs.slice().sort(function (a, b) {
      return order[a.sid] - order[b.sid] || (d.names[a.jid] || '').localeCompare(d.names[b.jid] || '');
    }).map(function (a) { var s = sById[a.sid]; return [fmtDay(s.mulai), s.judul, d.names[a.jid] || '-', KIND[a.kat], a.by, a.note]; }));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PER_HEAD].concat(tableRows(d))), 'Per jamaah');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sesi), 'Per pengajian');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), 'Daftar hadir');
    XLSX.writeFile(wb, 'rekap-pengajian-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    S.backup = Date.now();
    try { localStorage.setItem('backup', String(S.backup)); } catch (e) { /* abaikan */ }
    toast('File Excel diunduh.');
    render(false);
  }

  /* input manual */
  function manualTab() {
    if (!S.aw) { need('aw', loadAw); return spinCard(); }
    if (!S.mn || !S.aw.sesi.some(function (s) { return s.id === S.mn; })) S.mn = S.aw.sesi.length ? S.aw.sesi[0].id : null;
    if (!S.mn) return '<div class="card"><p>Belum ada sesi. Buat sesi di menu Sesi.</p></div>';
    return '<div class="card"><h2>Input kehadiran susulan</h2><p class="muted small">Untuk jamaah yang melapor setelah absen ditutup. Nama Anda tercatat sebagai penginput.</p>' +
      '<div><label class="lbl" for="mnSel">Pengajian</label><select id="mnSel" data-sel="mn">' + sessOpts(S.mn) + '</select></div>' +
      '<div><label class="lbl" for="mnName">Nama jamaah</label><select id="mnName"><option value="">Pilih nama</option>' + opts(S.aw.jamaah.filter(function (j) { return j.aktif; }), '', function (n) { return n.id; }, function (n) { return n.nama; }) + '</select></div>' +
      '<div><label class="lbl" for="mnNew">Atau tulis nama baru (jika belum terdaftar)</label><input id="mnNew" maxlength="60"></div>' +
      '<p class="lbl">Keterangan</p>' +
      '<label class="radio"><input type="radio" name="mk" value="TMM" checked><span>Tatap Muka Masjid</span></label>' +
      '<label class="radio"><input type="radio" name="mk" value="SDC"><span>SDC (via Moomla)</span></label>' +
      '<div><label class="lbl" for="mnNote">Catatan alasan (boleh dikosongkan)</label><input id="mnNote" maxlength="120" placeholder="Contoh: lapor lewat WA"></div>' +
      '<button class="btn" data-act="manual"' + (S.busy ? ' disabled' : '') + '>Simpan kehadiran</button></div>';
  }
  /* sesi */
  function sesiTab() {
    if (!S.aw) { need('aw', loadAw); return spinCard(); }
    return '<div class="card"><h2>Buat sesi baru</h2>' +
      '<div><label class="lbl" for="nsTitle">Judul pengajian</label><input id="nsTitle" maxlength="100" placeholder="Contoh: Kajian Tafsir Juz 29"></div>' +
      '<div><label class="lbl" for="nsBy">Pemateri</label><input id="nsBy" maxlength="80" value="Alifar Ihsan Azhari"></div>' +
      '<div><label class="lbl" for="nsPlace">Tempat</label><input id="nsPlace" maxlength="80" value="Masjid"></div>' +
      '<div><label class="lbl" for="nsStart">Mulai (waktu WIB)</label><input id="nsStart" type="datetime-local" value="' + wibInput(Date.now() + DAY) + '"></div>' +
      '<div><label class="lbl" for="nsWin">Absen dibuka sampai (hari setelah mulai, maks. 7)</label><input id="nsWin" type="number" min="1" max="7" value="3"></div>' +
      '<button class="btn" data-act="newsess"' + (S.busy ? ' disabled' : '') + '>Buat sesi</button></div>' +
      '<div class="card"><h3>Sesi terbaru</h3>' + (S.aw.sesi.length ? S.aw.sesi.map(function (s) {
        return '<div class="row"><span><b>' + esc(s.judul) + '</b><br><span class="muted small">' + esc(fmt(s.mulai)) + ' · ' + esc(s.pemateri || '-') + '</span></span><span class="k st-' + status(s) + '">' + ST[status(s)] + '</span></div>';
      }).join('') : '<p class="muted">Belum ada sesi.</p>') + '</div>';
  }
  /* materi */
  function materiTab() {
    if (!S.aw) { need('aw', loadAw); return spinCard(); }
    if (!S.aw.sesi.length) return '<div class="card"><p>Belum ada pengajian yang bisa Anda isi materinya.</p></div>';
    if (!S.mt || !S.aw.sesi.some(function (s) { return s.id === S.mt; })) S.mt = S.aw.sesi[0].id;
    var s = S.aw.sesi.filter(function (x) { return x.id === S.mt; })[0], k = s.k || {};
    var pus = S.aw.pustaka.length ? '<div data-mg="pustaka" hidden class="stack"><div><label class="lbl" for="mtPus">Pilih dari pustaka</label><select id="mtPus">' + opts(S.aw.pustaka, '', function (p) { return p.baris; }, function (p) { return p.jenis + ' · ' + p.ref; }) + '</select></div></div>' : '';
    return '<div class="card"><h2>Ringkasan materi</h2>' +
      '<div><label class="lbl" for="mtSel">Pengajian</label><select id="mtSel" data-sel="mt">' + sessOpts(S.mt) + '</select></div>' +
      '<div><label class="lbl" for="mtSum">Ringkasan dan poin penting</label><textarea id="mtSum" rows="7" maxlength="4000">' + esc(s.ringkasan) + '</textarea></div>' +
      '<p class="lbl">Ayat atau hadis yang ditampilkan</p>' +
      '<label class="radio"><input type="radio" name="mm" value="tetap" checked><span>Biarkan yang sekarang</span></label>' +
      '<label class="radio"><input type="radio" name="mm" value="otomatis"><span>Ambil yang baru secara otomatis</span></label>' +
      '<label class="radio"><input type="radio" name="mm" value="ayat"><span>Ayat Qur’an tertentu (teks diambil otomatis)</span></label>' +
      (S.aw.pustaka.length ? '<label class="radio"><input type="radio" name="mm" value="pustaka"><span>Pilih dari pustaka (hadis dan ayat tersimpan)</span></label>' : '') +
      '<label class="radio"><input type="radio" name="mm" value="manual"><span>Tulis sendiri (hadis atau lainnya)</span></label>' +
      '<div data-mg="ayat" hidden class="stack"><div><label class="lbl" for="mtRef">Rujukan</label><input id="mtRef" placeholder="Contoh: 2:286, 94:5-6, atau Al-Baqarah 285-286"></div></div>' + pus +
      '<div data-mg="manual" hidden class="stack"><div><label class="lbl" for="mtJenis">Jenis</label><select id="mtJenis"><option value="Hadis">Hadis</option><option value="Al-Qur’an">Al-Qur’an</option></select></div>' +
      '<div><label class="lbl" for="mtRef2">Rujukan (misalnya HR. Bukhari no. 1)</label><input id="mtRef2" maxlength="120"></div>' +
      '<div><label class="lbl" for="mtAr">Teks Arab</label><textarea id="mtAr" dir="rtl" lang="ar" rows="3" maxlength="1500"></textarea></div>' +
      '<div><label class="lbl" for="mtTr">Terjemahan</label><textarea id="mtTr" rows="3" maxlength="1500"></textarea></div>' +
      '<div><label class="lbl" for="mtSrc">Sumber (boleh dikosongkan)</label><input id="mtSrc" maxlength="200"></div></div>' +
      '<button class="btn" data-act="savemat"' + (S.busy ? ' disabled' : '') + '>Simpan materi</button></div>' +
      (k.arab ? '<p class="lbl">Yang akan dilihat jamaah sekarang</p>' + quoteCard(k) : '<p class="muted small">Belum ada ayat atau hadis untuk pengajian ini.</p>');
  }
  /* masukan */
  function masukanTab() {
    if (!S.mk) { need('mk', function () { return sc('masukan').then(function (d) { S.mk = d.masukan; }); }); return spinCard(); }
    var list = S.mk.filter(function (f) { return S.fq === 'all' || f.sid === S.fq; });
    var titles = []; S.mk.forEach(function (f) { if (!titles.some(function (t) { return t.id === f.sid; })) titles.push({ id: f.sid, judul: f.judul }); });
    return '<div><label class="lbl" for="fqSel">Tampilkan</label><select id="fqSel" data-sel="fq"><option value="all">Semua pengajian</option>' +
      opts(titles, S.fq, function (t) { return t.id; }, function (t) { return t.judul; }) + '</select></div>' +
      '<p class="muted small">Masukan ini hanya terlihat oleh administrator, ketua kelompok, dan muballigh.</p>' +
      (list.length ? list.map(function (f) {
        return '<div class="card"><div class="row" style="padding:0;border:0"><b>' + (f.nama ? esc(f.nama) : 'Anonim') + '</b><span class="muted small">' + esc(shortDay(f.ts)) + '</span></div>' +
          '<p class="muted small">' + esc(f.judul) + '</p><p class="pre">' + esc(f.teks) + '</p>' +
          '<div class="chips"><button class="btn ' + (f.dibaca ? 'ghost' : 'alt') + ' sm" data-act="read" data-id="' + esc(f.id) + '">' + (f.dibaca ? 'Sudah dibaca' : 'Tandai sudah dibaca') + '</button>' + delCtl('fb:' + f.id) + '</div></div>';
      }).join('') : '<div class="card"><p class="muted">Belum ada masukan.</p></div>');
  }
  /* jamaah */
  function jamaahTab() {
    if (!S.aw) { need('aw', loadAw); return spinCard(); }
    var sorted = S.aw.jamaah.slice().sort(function (a, b) { return a.nama.localeCompare(b.nama); });
    return '<div class="card"><h2>Tambah jamaah</h2><p class="muted small">Tulis satu nama per baris. Nama yang sudah ada dilewati. Anda juga bisa menempel daftar nama langsung di lembar Jamaah pada Google Sheets.</p>' +
      '<div><label class="lbl" for="jnNames">Nama</label><textarea id="jnNames" rows="5" placeholder="Satu nama per baris"></textarea></div><button class="btn" data-act="addj"' + (S.busy ? ' disabled' : '') + '>Tambah</button></div>' +
      '<div class="card"><h3>' + sorted.filter(function (j) { return j.aktif; }).length + ' nama aktif</h3><div class="tall">' + sorted.map(function (j) {
        return '<div class="row"><span>' + esc(j.nama) + (j.tamu ? ' <span class="k st-soon">tamu</span>' : '') + (j.aktif ? '' : ' <span class="k st-closed">nonaktif</span>') + '</span><button class="btn ghost sm" data-act="aktif" data-id="' + esc(j.id) + '" data-v="' + (j.aktif ? 0 : 1) + '">' + (j.aktif ? 'Nonaktifkan' : 'Aktifkan') + '</button></div>';
      }).join('') + '</div></div>';
  }

  /* ---------- aksi ---------- */
  function top() { window.scrollTo(0, 0); }
  function logout(msg) {
    S.staff = null; S.loginErr = msg || ''; resetStaffData();
    try { sessionStorage.removeItem('staff'); } catch (e) { /* abaikan */ }
    render();
  }
  function afterErr(e) { S.busy = false; toast(e.message); render(false); }
  function copyBox(id, okMsg) {
    var el = $(id);
    var fail = function () { el.focus(); el.select(); toast('Teks sudah terpilih. Salin lewat menu HP, lalu tempel.'); };
    try { navigator.clipboard.writeText(el.value).then(function () { toast(okMsg); }, fail); } catch (e) { fail(); }
  }

  var ACT = {
    retry: function () { S.err = ''; S.loadErr = ''; S.loading = {}; if (S.mode === 'jamaah' || !S.staff) S.boot = null; render(); },
    reload: function () { S.rk = null; S.loadErr = ''; render(false); },
    pick: function (b) { S.j = { step: 'name', sid: b.dataset.id }; render(); top(); },
    back: function () { S.j = { step: 'list' }; loadBoot(true); render(); top(); },
    'back-name': function () { S.j = { step: 'name', sid: S.j.sid }; render(); top(); },
    name: function (b) {
      var n = S.boot.nama.filter(function (x) { return x[0] === b.dataset.id; })[0];
      if (!n) return;
      S.j = { step: 'attend', sid: S.j.sid, nid: n[0], nama: n[1] }; render(); top();
    },
    addname: function () {
      if ($('hp2').value) { S.j = { step: 'list' }; render(); return; }
      var v = $('nn').value.trim().replace(/\s+/g, ' ');
      if (v.length < 3) { toast('Tulis nama lengkap dulu.'); return; }
      var same = S.boot.nama.filter(function (x) { return x[1].toLowerCase() === v.toLowerCase(); })[0];
      S.j = same ? { step: 'attend', sid: S.j.sid, nid: same[0], nama: same[1] } : { step: 'attend', sid: S.j.sid, baru: v, nama: v };
      render(); top();
    },
    submit: function (b) {
      if (S.busy) return;
      var j = S.j, now = Date.now(), kind = b.dataset.k;
      if ($('hp').value) { S.j = { step: 'list' }; render(); return; }
      S.thr = S.thr.filter(function (x) { return now - x < 10 * 60e3; });
      if (S.thr.length >= 5) { toast('Terlalu banyak pengisian dari HP ini. Tunggu beberapa menit, atau minta tolong pengurus.'); return; }
      var body = { aksi: 'absen', sid: j.sid, kind: kind, fb: $('fb').value.trim(), anon: $('anon').checked, dev: S.dev, hp: '' };
      if (j.nid) body.nid = j.nid; else body.nama = j.baru;
      S.busy = true; render(false);
      post(body, { tries: 4, netRetry: true }).then(function (d) {
        S.busy = false; S.thr.push(now); S.bootAt = 0;
        S.j = { step: 'done', res: d, kat: kind }; render(); top();
      }, function (e) {
        S.busy = false;
        if (e.code === 'ditutup') { S.j = { step: 'list' }; loadBoot(true); }
        toast(e.message); render(false);
      });
    },
    finish: function () { S.j = { step: 'list' }; loadBoot(true); render(); top(); },
    login: function () {
      if (S.busy) return;
      var who = document.querySelector('input[name=who]:checked'), pin = $('pin').value;
      if (!who || !pin) { S.loginErr = 'Pilih nama dan isi PIN.'; render(false); return; }
      var p = S.boot.staf[+who.value];
      S.busy = true; S.loginErr = ''; render(false);
      post({ aksi: 'login', nama: p.n, pin: pin }).then(function (d) {
        S.busy = false;
        S.staff = { nama: d.nama, peran: d.peran, izin: d.izin, token: d.token }; resetStaffData();
        var first = TABS.filter(function (t) { return can(t[0]); })[0];
        S.tab = first ? first[0] : 'rekap';
        try { sessionStorage.setItem('staff', JSON.stringify(S.staff)); } catch (e) { /* abaikan */ }
        render(); top();
      }, function (e) { S.busy = false; S.loginErr = e.message; render(false); });
    },
    logout: function () { logout(); },
    tab: function (b) { S.tab = b.dataset.v; S.loadErr = ''; S.del = null; render(); top(); },
    range: function (b) { S.rg = b.dataset.v; S.loadErr = ''; render(false); },
    excel: saveExcel,
    tsv: function () { copyBox('tsv', 'Tabel tersalin. Tempel di Excel atau Google Sheets.'); },
    copy: function () { copyBox('wa', 'Teks tersalin. Tempel di grup WhatsApp.'); },
    cadangan: function () {
      S.busy = true; render(false);
      sc('cadangan').then(function (d) { S.busy = false; toast('Cadangan dibuat: ' + d.nama); render(false); }, afterErr);
    },
    manual: function () {
      if (S.busy) return;
      var nid = $('mnName').value, nu = $('mnNew').value.trim();
      if (!nid && !nu) { toast('Pilih nama jamaah atau tulis nama baru.'); return; }
      var body = { sid: S.mn, kind: document.querySelector('input[name=mk]:checked').value, catatan: $('mnNote').value.trim() };
      if (nu) body.nama = nu; else body.nid = nid;
      S.busy = true; render(false);
      sc('manual', body).then(function (d) {
        S.busy = false; S.rk = null; S.boot = null;
        if (nu) S.aw = null;
        toast(d.dup ? 'Nama itu sudah tercatat hadir di pengajian ini.' : (d.nama + ' tercatat hadir.')); render(false);
      }, afterErr);
    },
    newsess: function () {
      if (S.busy) return;
      var title = $('nsTitle').value.trim(), start = new Date($('nsStart').value + ':00+07:00').getTime();
      if (title.length < 3 || isNaN(start)) { toast('Isi judul dan waktu mulai.'); return; }
      S.busy = true; render(false);
      sc('sesiSimpan', { judul: title, pemateri: $('nsBy').value, tempat: $('nsPlace').value, mulai: start, hari: +$('nsWin').value || 3 }).then(function () {
        S.busy = false; S.aw = null; S.rk = null; S.boot = null; toast('Sesi dibuat.'); render(false);
      }, afterErr);
    },
    savemat: function () {
      if (S.busy) return;
      var mode = document.querySelector('input[name=mm]:checked').value;
      var body = { sid: S.mt, ringkasan: $('mtSum').value, mode: mode };
      if (mode === 'ayat') body.ref = $('mtRef').value;
      if (mode === 'pustaka') body.baris = $('mtPus').value;
      if (mode === 'manual') { body.jenis = $('mtJenis').value; body.ref = $('mtRef2').value; body.arab = $('mtAr').value; body.tr = $('mtTr').value; body.src = $('mtSrc').value; }
      S.busy = true; render(false);
      sc('materiSimpan', body).then(function (d) {
        S.busy = false; S.aw = null; S.boot = null; toast('Materi tersimpan.'); render(false);
      }, afterErr);
    },
    read: function (b) {
      var f = S.mk.filter(function (x) { return x.id === b.dataset.id; })[0], v = !f.dibaca;
      sc('masukanBaca', { id: f.id, dibaca: v }).then(function () { f.dibaca = v; render(false); }, afterErr);
    },
    addj: function () {
      if (S.busy) return;
      var lines = $('jnNames').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!lines.length) { toast('Tulis minimal satu nama.'); return; }
      S.busy = true; render(false);
      sc('jamaahTambah', { nama: lines }).then(function (d) {
        S.busy = false; S.aw = null; S.boot = null; S.rk = null; toast(d.ditambah + ' nama ditambahkan, ' + d.dilewati + ' dilewati.'); render(false);
      }, afterErr);
    },
    aktif: function (b) {
      sc('jamaahAktif', { id: b.dataset.id, aktif: b.dataset.v === '1' }).then(function () { S.aw = null; S.boot = null; S.rk = null; render(false); }, afterErr);
    },
    'del-ask': function (b) { S.del = b.dataset.k; render(false); },
    'del-no': function () { S.del = null; render(false); },
    'del-yes': function (b) {
      var k = b.dataset.k.split(':'), p;
      if (k[0] === 'fb') p = sc('masukanHapus', { id: k[1] }).then(function () { S.mk = S.mk.filter(function (f) { return f.id !== k[1]; }); });
      else p = sc('hapusHadir', { sid: k[1], nid: k[2] }).then(function () { S.rk.hadir = S.rk.hadir.filter(function (a) { return !(a.sid === k[1] && a.jid === k[2]); }); });
      p.then(function () { S.del = null; toast('Dihapus.'); render(false); }, function (e) { S.del = null; afterErr(e); });
    }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q' && S.boot) $('nameList').innerHTML = nameListHTML(e.target.value);
  });
  document.addEventListener('change', function (e) {
    var t = e.target, k = t.dataset && t.dataset.sel;
    if (t.name === 'mm') {
      document.querySelectorAll('[data-mg]').forEach(function (el) { el.hidden = el.dataset.mg !== t.value; });
      return;
    }
    if (k) { S[k] = t.value; if (k === 'from' || k === 'to') S.loadErr = ''; render(false); }
  });
  window.addEventListener('hashchange', function () {
    S.mode = location.hash === '#pengurus' ? 'pengurus' : 'jamaah'; S.loadErr = ''; render(); top();
  });

  function render(keep) {
    var name = CFG.NAMA || 'Absensi Pengajian';
    $('brand').textContent = name;
    $('foot').innerHTML = '<a href="' + (S.mode === 'pengurus' ? '#' : '#pengurus') + '">' + (S.mode === 'pengurus' ? 'Kembali ke halaman absen' : 'Halaman pengurus') + '</a>';
    document.title = name + (S.mode === 'pengurus' ? ' (pengurus)' : '');
    var y = window.pageYOffset;
    $('view').innerHTML = S.mode === 'jamaah' ? jamaahView() : pengurusView();
    if (keep === false) window.scrollTo(0, y);
  }
  render();
})();
