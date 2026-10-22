'use strict';
/**
 * Server uji coba lokal: menyajikan tampilan dan meniru backend Google Apps Script di memori.
 * Berguna untuk mencoba aplikasi tanpa Google. Data hilang saat server dimatikan.
 *
 *   node dev/server.js            lalu buka http://localhost:8080
 *   PIN contoh: Administrator 111111, Aep Supiana 222222, Alifar Ihsan Azhari 333333
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createBackend } = require('./mock-gas');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const H = 3600e3, D = 24 * H;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

const b = createBackend({ quiet: true });
b.prepare({ 'Administrator': '111111', 'Aep Supiana': '222222', 'Alifar Ihsan Azhari': '333333' });

function seed() {
  const names = ['Ahmad Fauzi', 'Siti Aisyah', 'Budi Santoso', 'Hj. Nurlaila', 'Muhammad Rizki', 'Dewi Lestari', 'Ibu Ratna', 'Pak Hasan', 'Yusuf Maulana', 'Fatimah Zahra', 'Hendra Gunawan', 'Rina Marlina', 'Abdul Karim', 'Tini Suryani'];
  b.api.jamaahTambah_({ nama: names });
  const jam = b.api.bacaMentah_('jamaah');   // [Nama, Aktif, Tamu, ID]
  const titles = ['Kajian Kitab Riyadhus Shalihin', 'Tadabbur Al-Qur’an', 'Fiqih Ibadah Harian', 'Kajian Akhlak'];
  const hadir = b.api.lembar_('hadir');
  const mk = (judul, by, mulai) => {
    const r = b.api.sesiSimpan_({ judul, pemateri: by, tempat: 'Masjid', mulai, hari: 3 });
    jam.forEach((j, ni) => {
      const si = Math.round((Date.now() - mulai) / D);
      if ((ni * 7 + si * 3) % 5 === 0 || (ni % 6 === 5 && si % 4 !== 0)) return;
      hadir.appendRow([new Date(mulai), judul, j[0], (ni + si) % 4 === 0 ? 'SDC' : 'Tatap Muka Masjid', new Date(mulai + (ni + 1) * 4 * 60e3), '', '', r.id, j[3]]);
    });
    return r.id;
  };
  mk(titles[0], 'Alifar Ihsan Azhari', Date.now() - 5 * H);
  mk(titles[1], 'Aep Supiana', Date.now() - 50 * H);
  for (let i = 0; i < 40; i++) mk(titles[i % 4], i % 2 ? 'Alifar Ihsan Azhari' : 'Aep Supiana', Date.now() - (4 + i * 3.5) * D);
}
seed();

function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, extra));
  res.end(body);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (u.pathname === '/api') {
    if (req.method === 'GET') return send(res, 200, b.api.doGet({ parameter: Object.fromEntries(u.searchParams) }).getContent());
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => send(res, 200, b.api.doPost({ postData: { contents: body } }).getContent()));
    return;
  }
  if (u.pathname === '/config.js') {
    return send(res, 200, "window.APP_CONFIG = { API_URL: 'http://localhost:" + PORT + "/api', NAMA: 'Absensi Pengajian (uji lokal)' };", TYPES['.js']);
  }
  const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!file.startsWith(ROOT) || /\/(backend|dev)\//.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Tidak ditemukan', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log('Uji lokal: http://localhost:' + PORT + '  (halaman pengurus: /#pengurus)'));
