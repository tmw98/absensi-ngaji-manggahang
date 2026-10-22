'use strict';
/**
 * Tiruan sederhana lingkungan Google Apps Script, hanya untuk uji coba lokal.
 * Menjalankan backend/Code.gs apa adanya di Node, dengan Google Sheet diganti memori.
 * Tidak dipakai di produksi.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.rows[this.r - 1 + i] || [], o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((rowVals, i) => {
      while (this.sheet.rows.length < this.r + i) this.sheet.rows.push([]);
      rowVals.forEach((v, j) => { this.sheet.rows[this.r - 1 + i][this.c - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  appendRow(a) { this.rows.push(a.slice()); }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  setFrozenRows() {}
}

function createBackend(opts = {}) {
  const sheets = {};
  const ss = {
    getId: () => 'SS_TEST',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.name]; },
    setSpreadsheetTimeZone() {}
  };
  const props = {}, cache = new Map();
  const fetchLog = [];
  const sandbox = {
    Date,
    console: opts.quiet ? { log() {}, warn() {}, error() {} } : console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss,
      getUi() { throw new Error('tanpa UI'); }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: {
      getScriptCache: () => ({
        get(k) { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
        put(k, v, ttl) { cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
        remove(k) { cache.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map((x) => (x > 127 ? x - 256 : x)),
      formatDate: (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ')
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } })
    },
    UrlFetchApp: {
      fetch(url) {
        fetchLog.push(url);
        const m = /\/ayah\/(?:(\d+):(\d+)|(\d+))\//.exec(url);
        if (opts.offline || !m) return { getResponseCode: () => 503, getContentText: () => '' };
        const sur = m[1] ? +m[1] : 2, ayat = m[2] ? +m[2] : (+m[3] % 286) + 2;
        const mk = (id, text) => ({ text, numberInSurah: ayat, surah: { number: sur }, edition: { identifier: id } });
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ code: 200, data: [mk('quran-uthmani', 'نص تجريبي قصير'), mk('id.indonesian', 'Terjemahan contoh ayat ' + sur + ':' + ayat)] })
        };
      }
    },
    DriveApp: {}, ScriptApp: {}
  };
  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;__api = { doGet, doPost, siapkan, aturPinBaris_, pengurusDaftar_, sesiSimpan_, jamaahTambah_, lembar_, bacaMentah_ };', ctx, { filename: 'Code.gs' });
  const api = ctx.__api;

  return {
    sheets, api, fetchLog, cache,
    get(params) { return JSON.parse(api.doGet({ parameter: params }).getContent()); },
    post(body) { return JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()); },
    /** Siapkan lembar, beri PIN, dan tambah beberapa data awal. */
    prepare(pins) {
      api.siapkan();
      api.pengurusDaftar_().forEach((p) => { if (pins[p.nama]) api.aturPinBaris_(p.baris, pins[p.nama]); });
    }
  };
}

module.exports = { createBackend };
