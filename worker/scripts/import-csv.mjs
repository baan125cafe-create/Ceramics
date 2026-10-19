// Copies a shop's Google Sheet (exported as CSV) into the database, unchanged.
//
//   npm run import -- --shop baan --products "Products.csv" --sales "Sales.csv" --local
//   npm run import -- --shop chud --products ... --sales ... --remote
//
// In Google Sheets: File → Download → Comma-separated values (.csv), once for the
// Products tab and once for the Sales tab. Keep the files outside the repo, or in
// worker/.data/ (ignored by git). They hold real sales.
//
// Safety:
//   - Refuses if the shop already has rows in the database, unless you add --replace
//     (which replaces only that shop's products and sales with the CSV contents).
//   - Values are copied as they are. Nothing is cleaned up or renamed; the app's
//     Data check lists anything odd so the owner can decide.
//   - After loading, it reads the counts and totals back and compares them with the CSVs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const flag = n => args.includes('--' + n);

const shop = opt('shop');
const target = flag('remote') ? '--remote' : '--local';
if (!['baan', 'chud'].includes(shop) || !opt('products') || !opt('sales')) {
  console.error('Usage: npm run import -- --shop baan|chud --products <Products.csv> --sales <Sales.csv> [--local|--remote] [--replace]');
  process.exit(1);
}
if (flag('remote') && flag('local')) { console.error('Choose --local or --remote, not both.'); process.exit(1); }

// ---------- CSV (handles quotes, commas and line breaks inside cells) ----------
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim() !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

const read = f => parseCsv(fs.readFileSync(f, 'utf8'));
const products = read(opt('products'));
const sales = read(opt('sales'));
const need = (rows, cols, what) => { const miss = cols.filter(c => !(c in (rows[0] || {}))); if (miss.length) { console.error(`${what} CSV is missing columns: ${miss.join(', ')}`); process.exit(1); } };
need(products, ['id', 'name', 'costPrice', 'sellPrice', 'quantity'], 'Products');
need(sales, ['id', 'productId', 'productName', 'quantity', 'sellPrice', 'total', 'paymentMethod', 'saleDate'], 'Sales');

const n = v => { const x = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(x) ? x : 0; };
const s = v => String(v == null ? '' : v);
const sql = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${s(v).replace(/'/g, "''")}'`;

// ---------- build the SQL ----------
const lines = [];
const P = products.filter(p => s(p.id).trim());
const S = sales.filter(x => s(x.id).trim());
for (const p of P) {
  lines.push(`INSERT INTO products (shop, id, name, size, note, costPrice, sellPrice, quantity, imageUrl, addedBy, createdAt, archived) VALUES (${[
    shop, s(p.id).trim(), s(p.name), s(p.size), s(p.note), n(p.costPrice), n(p.sellPrice), Math.trunc(n(p.quantity)), s(p.imageUrl).trim(), s(p.addedBy), s(p.createdAt), s(p.archived).trim() ? s(p.archived) : null
  ].map(sql).join(', ')});`);
}
for (const x of S) {
  lines.push(`INSERT INTO sales (shop, id, productId, productName, quantity, sellPrice, total, costPrice, paymentMethod, saleDate, soldBy, createdAt, note) VALUES (${[
    shop, s(x.id).trim(), s(x.productId).trim(), s(x.productName), Math.trunc(n(x.quantity)) || 1, n(x.sellPrice), n(x.total), s(x.costPrice).trim() === '' ? null : n(x.costPrice), s(x.paymentMethod), s(x.saleDate).trim(), s(x.soldBy), s(x.createdAt), s(x.note)
  ].map(sql).join(', ')});`);
}

// ---------- run ----------
// Cloudflare's API sometimes refuses a request for a moment (e.g. code 7403 or a dropped
// connection). Wait and try again a few times before giving up.
const TRANSIENT = /7403|7500|10000|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|Internal error|503|502/i;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wr = (...a) => {
  for (let attempt = 1; ; attempt++) {
    try { return execFileSync('npx', ['wrangler', ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) {
      const out = String(e.stdout || '') + String(e.stderr || '');
      if (attempt >= 4 || !TRANSIENT.test(out)) { console.error(out.trim() || e.message); process.exit(1); }
      console.log(`  Cloudflare didn't answer properly (try ${attempt} of 4). Trying again in ${attempt * 5} s…`);
      pause(attempt * 5000);
    }
  }
};
// wrangler can print notices before its JSON; read from the first line that starts with "[".
const fromJson = out => JSON.parse(out.slice(Math.max(0, out.search(/^\[/m))));
const query = q => fromJson(wr('d1', 'execute', 'shop-db', target, '--json', '--command', q))[0].results;

const existing = query(`SELECT (SELECT COUNT(*) FROM products WHERE shop = '${shop}') AS p, (SELECT COUNT(*) FROM sales WHERE shop = '${shop}') AS s`)[0];
if ((existing.p || existing.s) && !flag('replace')) {
  console.error(`The ${target.slice(2)} database already has ${existing.p} products and ${existing.s} sales for "${shop}". Nothing was changed.\nAdd --replace to replace them with the CSV contents.`);
  process.exit(1);
}
if (existing.p || existing.s) lines.unshift(`DELETE FROM sales WHERE shop = '${shop}';`, `DELETE FROM products WHERE shop = '${shop}';`);

fs.mkdirSync(path.join(root, '.data'), { recursive: true });
const file = path.join(root, '.data', `import-${shop}.sql`);
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(`Loading ${P.length} products and ${S.length} sales for ${shop} into the ${target.slice(2)} database…`);
wr('d1', 'execute', 'shop-db', target, '--yes', '--file', file);
fs.unlinkSync(file);

// ---------- check ----------
const want = {
  products: P.length, sales: S.length,
  quantity: P.reduce((a, p) => a + Math.trunc(n(p.quantity)), 0),
  salesTotal: Math.round(S.reduce((a, x) => a + n(x.total), 0) * 100) / 100,
  stockAtSell: Math.round(P.reduce((a, p) => a + n(p.sellPrice) * Math.trunc(n(p.quantity)), 0) * 100) / 100
};
const got = query(`SELECT
  (SELECT COUNT(*) FROM products WHERE shop = '${shop}') AS products,
  (SELECT COUNT(*) FROM sales WHERE shop = '${shop}') AS sales,
  (SELECT COALESCE(SUM(quantity), 0) FROM products WHERE shop = '${shop}') AS quantity,
  (SELECT ROUND(COALESCE(SUM(total), 0), 2) FROM sales WHERE shop = '${shop}') AS salesTotal,
  (SELECT ROUND(COALESCE(SUM(sellPrice * quantity), 0), 2) FROM products WHERE shop = '${shop}') AS stockAtSell`)[0];
let ok = true;
for (const k of Object.keys(want)) {
  const same = Number(got[k]) === want[k];
  ok = ok && same;
  console.log(`  ${same ? '✓' : '✗'} ${k.padEnd(12)} sheet ${want[k]}   database ${got[k]}`);
}

// Things worth a look (not changed, just listed).
const ids = new Set(P.map(p => s(p.id).trim()));
const orphans = S.filter(x => !ids.has(s(x.productId).trim())).length;
const pays = [...new Set(S.map(x => s(x.paymentMethod).trim().toLowerCase()))].sort();
const google = P.filter(p => /googleusercontent|drive\.google/.test(s(p.imageUrl))).length;
console.log(`  Sales whose product isn't in Products: ${orphans}`);
console.log(`  Payment labels: ${pays.map(p => p || '(blank)').join(', ')}`);
console.log(`  Photos still on Google Drive: ${google} (copy them with: npm run copy-photos -- --shop ${shop} ${target})`);
console.log(ok ? 'Done. Counts and totals match the sheet.' : 'Counts or totals do NOT match. Check the CSVs before going further.');
process.exit(ok ? 0 : 1);
