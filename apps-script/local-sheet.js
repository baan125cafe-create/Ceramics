// Runs Code.gs on your computer against a pretend Google Sheet, so the app can be
// tested end to end without touching the real one. Nothing here talks to Google.
//
//   node apps-script/local-sheet.js     # pretend sheet on http://localhost:8787
//   python3 -m http.server 8000         # in the repo, in another terminal
//   then open http://localhost:8000/app/?local=8787 and choose Live sheet
//
// Test PINs here: owner 246810, staff 135791 (fake sheet only).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

function makeSheet(name, rows) {
  const data = rows.map(r => r.slice());
  const width = () => Math.max(0, ...data.map(r => r.length));
  const pad = () => { const w = width(); data.forEach(r => { while (r.length < w) r.push(''); }); };
  const sheet = {
    name, data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => width(),
    getDataRange: () => sheet.getRange(1, 1, Math.max(1, data.length), Math.max(1, width())),
    appendRow: r => { data.push(r.slice()); pad(); },
    deleteRow: n => { data.splice(n - 1, 1); },
    getRange: (row, col, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => { pad(); const out = []; for (let i = 0; i < nr; i++) { const r = data[row - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => r[col - 1 + j] === undefined ? '' : r[col - 1 + j])); } return out; },
        setValue: v => { while (data.length < row) data.push([]); const r = data[row - 1]; while (r.length < col) r.push(''); r[col - 1] = v; pad(); },
        setValues: vals => vals.forEach((vr, i) => vr.forEach((v, j) => sheet.getRange(row + i, col + j).setValue(v)))
      };
    }
  };
  pad();
  return sheet;
}

function makeContext(seed) {
  const sheets = {};
  Object.entries(seed).forEach(([n, rows]) => { sheets[n] = makeSheet(n, rows); });
  const props = {}, cache = {}, mails = [];
  const ss = {
    getName: () => 'Baan 125 (local test)',
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n, []))
  };
  const fmt = (d, tz, f) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
    const monthLong = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long' }).format(d);
    const monthShort = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(d);
    return f.replace('yyyy', parts.year).replace('MMMM', monthLong).replace('MMM', monthShort).replace('MM', parts.month).replace('dd', parts.day).replace(/(^|[^M])M($|[^M])/, (m, a, b) => a + String(Number(parts.month)) + b);
  };
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {}, getUi: () => { throw new Error('No sheet UI here'); } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => Object.entries(o).forEach(([k, v]) => { props[k] = String(v); }),
      deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props)
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => cache[k] || null, getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])),
      putAll: o => Object.assign(cache, o), removeAll: ks => ks.forEach(k => { delete cache[k]; })
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: fmt,
      base64Decode: b => Array.from(Buffer.from(b, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }), getScriptTimeZone: () => 'Asia/Bangkok' },
    MailApp: { sendEmail: (...a) => mails.push(typeof a[0] === 'object' ? a[0] : { to: a[0], subject: a[1], body: a[2] }) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFolderById: () => { throw new Error('none'); },
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ getId: () => 'FOLDER', createFile: () => ({ getId: () => 'FILE' + Date.now(), setSharing: () => {} }) })
    },
    ScriptApp: { getProjectTriggers: () => [] },
    Date, JSON, Math, Number, String, Object, Array, RegExp, Error, Set, isNaN
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  // Test PINs for the pretend sheet only.
  vm.runInContext("props_().setProperty('OWNER_PIN_HASH', hash_(salt_() + '246810')); props_().setProperty('STAFF_PIN_HASH', hash_(salt_() + '135791'));", ctx);
  ctx.__sheets = sheets; ctx.__props = props; ctx.__mails = mails;
  ctx.call = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  return ctx;
}

// Rows shaped like the real sheet: v5 headers, strings and Dates mixed, old labels.
function seed() {
  const P = [['id', 'name', 'size', 'costPrice', 'sellPrice', 'quantity', 'imageUrl', 'addedBy', 'createdAt'],
    ['PRD-1', 'Lotus mug', '300ml', 160, 450, 6, '', 'Milk', new Date('2026-06-12T03:00:00Z')],
    ['PRD-2', 'Bud vase', '', '', 380, 0, '', 'Milk', new Date('2026-06-12T03:00:00Z')],
    ['PRD-3', 'Ring dish', '', 60, 220, 2, '', 'Milk', new Date('2026-06-15T03:00:00Z')]];
  const S = [['id', 'productId', 'productName', 'quantity', 'sellPrice', 'total', 'paymentMethod', 'saleDate', 'soldBy', 'createdAt', 'note']];
  const pays = ['cash', 'credit', 'Cash', 'credit', ''];
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.now() - i * 86400000 * 2);
    const p = P[1 + (i % 3)];
    S.push(['SALE-' + i, p[0], p[1], 1, p[4], p[4], pays[i % pays.length], new Date(d.toISOString().slice(0, 10) + 'T17:00:00Z'), i % 2 ? 'Milk' : 'milk', d.toISOString(), '']);
  }
  return { Products: P, Sales: S };
}

module.exports = { makeContext, seed };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8787;
  const ctx = makeContext(seed());
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try { out = ctx.doPost({ postData: { contents: body || '{}' } }).content; } catch (e) { out = JSON.stringify({ error: e.message }); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out);
    });
  }).listen(port, () => console.log(`Pretend sheet running on http://localhost:${port} (owner PIN 246810, staff PIN 135791)`));
}
