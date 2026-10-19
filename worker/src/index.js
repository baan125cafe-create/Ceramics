// Shop API on Cloudflare (Worker + D1 database + R2 photos).
// Replaces the Google Apps Script. Same requests and answers as the v6 script,
// so the app talks to it the same way. One API serves both shops:
//   POST https://<api>/baan   POST https://<api>/chud
//   GET  https://<api>/img/<key>   (product photos stored in R2)
//
// Rules (same as v6):
//   - Every request except getVersion/login needs a sign-in pass from a PIN.
//   - 5 wrong PINs in a row pause that shop's sign-in: 15 min, 1 h, then 24 h,
//     and the owner is emailed. Devices already signed in keep working.
//   - Passes expire (staff 30 days, owner 7 days). "Sign all out" ends them all.
//   - Staff never receive cost prices or money totals.
//   - Sales: the server sets price, total and today's cost. Stock can't go below 0.
//   - "Remove" archives a product; its row stays so old sales keep their cost.
//   - [TEST] rows are left out of reports and are the only rows that can be cleared.
//
// Secrets (set with `npm run set-pin`, or `wrangler secret put`; never in this repo):
//   BAAN_OWNER_PIN_HASH, BAAN_STAFF_PIN_HASH, CHUD_OWNER_PIN_HASH, CHUD_STAFF_PIN_HASH
// Optional, for emails: RESEND_API_KEY, REPORT_TO (comma-separated), REPORT_FROM

const VERSION = 7;
const SHOPS = { baan: 'Baan 125', chud: 'ChudPak' };
// Payment types the owner can edit in Settings. Each sale saves the type's id as
// plain text, so renaming or retiring a type never changes past sales.
const DEFAULT_PAYMENTS = [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }, { id: 'qr', label: 'QR code' }];
const MAX_TRIES = 5;
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const PAUSE_MINUTES = [15, 60, 1440];
const PASS_DAYS = { staff: 30, owner: 7 };
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const ACTIONS = {
  getVersion: null, login: null,
  getAll: 'staff', addSale: 'staff', addProduct: 'staff', uploadImage: 'staff',
  addStock: 'owner', updateProduct: 'owner', archiveProduct: 'owner',
  saveSettings: 'owner', signOutAll: 'owner', sendReport: 'owner', previewTestData: 'owner', clearTestData: 'owner'
};

class Fail extends Error { constructor(message, code) { super(message); this.code = code || ''; } }
const fail = (m, c) => { throw new Fail(m, c); };

// ---------- small helpers ----------
const enc = new TextEncoder();
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const bkkDay = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const int = x => Math.floor(Number(x));
const money = x => Math.round(Number(x) * 100) / 100;
const isTestText = s => /^\s*\[test\]/i.test(String(s || ''));
const isTestProduct = p => isTestText(p.name);
const isTestSale = s => isTestText(s.productName) || isTestText(s.note);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
}
const json = (obj, headers, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers) });

// ---------- request handling ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, h) });
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) return photo(env, decodeURIComponent(url.pathname.slice(5)));
    const shop = url.pathname.replace(/^\/+|\/+$/g, '');
    if (req.method !== 'POST' || !SHOPS[shop]) return json({ error: 'Not found' }, h, 404);
    let data = {};
    try { data = JSON.parse(await req.text() || '{}'); } catch (e) { data = {}; }
    let out;
    try {
      const action = String(data.action || '');
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) fail('Unknown action: ' + action);
      const need = ACTIONS[action];
      const role = need ? await checkPass(env, shop, data.token, need) : null;
      out = await run(env, shop, action, data, role, url.origin);
    } catch (e) {
      if (!(e instanceof Fail)) console.error(e);
      out = { error: e instanceof Fail ? e.message : 'Something went wrong on the server. Please try again.', code: e.code || '' };
    }
    return json(out, h);
  },

  // Email reports, same times as the old script (Bangkok): daily 23:30, monthly on the 1st at 10:30.
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    for (const shop of Object.keys(SHOPS)) {
      if (event.cron === '30 16 * * *') ctx.waitUntil(sendDaily(env, shop, now));
      if (event.cron === '30 3 1 * *') ctx.waitUntil(sendMonthly(env, shop, now));
    }
  }
};

async function run(env, shop, action, d, role, origin) {
  switch (action) {
    case 'getVersion': return { version: VERSION, backend: 'cloudflare', shop: SHOPS[shop], pinsSet: pinsSet(env, shop) };
    case 'login': return login(env, shop, String(d.pin || ''));
    case 'getAll': return getAll(env, shop, role);
    case 'addSale': return addSale(env, shop, d);
    case 'addProduct': return addProduct(env, shop, d, role);
    case 'uploadImage': return uploadImage(env, shop, d, origin);
    case 'addStock': return addStock(env, shop, d);
    case 'updateProduct': return updateProduct(env, shop, d);
    case 'archiveProduct': return archiveProduct(env, shop, d);
    case 'saveSettings': return saveSettings(env, shop, d);
    case 'signOutAll': return signOutAll(env, shop);
    case 'sendReport': return sendReportNow(env, shop, d);
    case 'previewTestData': return previewTestData(env, shop);
    case 'clearTestData': return clearTestData(env, shop, d);
  }
  fail('Unknown action: ' + action);
}

// ---------- PINs and passes ----------
const pinHash = (env, shop, role) => env[shop.toUpperCase() + '_' + role.toUpperCase() + '_PIN_HASH'] || '';
const pinsSet = (env, shop) => !!(pinHash(env, shop, 'owner') && pinHash(env, shop, 'staff'));
// Each stored PIN is "salt:sha256(salt + pin)".
async function pinMatches(stored, pin) {
  const i = stored.indexOf(':');
  if (i < 1) return false;
  return await sha256(stored.slice(0, i) + pin) === stored.slice(i + 1);
}

async function getSetting(env, shop, key) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE shop = ? AND key = ?').bind(shop, key).first();
  return r ? r.value : null;
}
const putSetting = (env, shop, key, value) =>
  env.DB.prepare('INSERT INTO settings (shop, key, value) VALUES (?, ?, ?) ON CONFLICT (shop, key) DO UPDATE SET value = excluded.value').bind(shop, key, String(value));
const epoch = async (env, shop) => Number(await getSetting(env, shop, 'epoch')) || 1;

async function login(env, shop, pin) {
  const now = Date.now();
  const st = await env.DB.prepare('SELECT fails, level, until FROM login_state WHERE shop = ?').bind(shop).first() || { fails: 0, level: 0, until: 0 };
  if (now < st.until) return { locked: Math.ceil((st.until - now) / 60000) };
  if (!pinsSet(env, shop)) fail('PINs haven’t been set yet. Run `npm run set-pin` in the worker folder.', 'nopins');
  const role = await pinMatches(pinHash(env, shop, 'owner'), pin) ? 'owner' : (await pinMatches(pinHash(env, shop, 'staff'), pin) ? 'staff' : null);
  const save = (f, l, u) => env.DB.prepare('INSERT INTO login_state (shop, fails, level, until) VALUES (?, ?, ?, ?) ON CONFLICT (shop) DO UPDATE SET fails = excluded.fails, level = excluded.level, until = excluded.until').bind(shop, f, l, u);
  if (role) {
    const token = randomHex(32);
    const exp = now + PASS_DAYS[role] * 86400000;
    const ep = await epoch(env, shop);
    await env.DB.batch([
      save(0, 0, 0),
      env.DB.prepare('DELETE FROM passes WHERE expires < ? OR (shop = ? AND epoch <> ?)').bind(now, shop, ep),
      env.DB.prepare('INSERT INTO passes (tokenHash, shop, role, expires, epoch) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), shop, role, exp, ep)
    ]);
    return { role, token, expires: new Date(exp).toISOString() };
  }
  const fails = st.fails + 1;
  if (fails >= MAX_TRIES) {
    const mins = PAUSE_MINUTES[Math.min(st.level, PAUSE_MINUTES.length - 1)];
    await save(0, st.level + 1, now + mins * 60000).run();
    await email(env, SHOPS[shop] + ' app: sign-in paused after ' + MAX_TRIES + ' wrong PINs',
      `<p>Someone entered a wrong PIN ${MAX_TRIES} times in a row, so sign-in to the ${SHOPS[shop]} app is paused for ${mins >= 60 ? mins / 60 + ' hour(s)' : mins + ' minutes'}.</p><p>Phones and computers that are already signed in keep working. If this wasn’t you or your staff, change the PINs and use “Sign all out” in Settings.</p>`, recipients(env));
    return { locked: mins };
  }
  await save(fails, st.level, 0).run();
  return { left: MAX_TRIES - fails };
}

async function checkPass(env, shop, token, need) {
  if (!token) fail('Please sign in again.', 'auth');
  const p = await env.DB.prepare('SELECT role, expires, epoch FROM passes WHERE tokenHash = ? AND shop = ?').bind(await sha256(String(token)), shop).first();
  if (!p) fail('Please sign in again.', 'auth');
  if (p.expires < Date.now() || p.epoch !== await epoch(env, shop)) fail('Your sign-in has expired. Please sign in again.', 'auth');
  if (need === 'owner' && p.role !== 'owner') fail('Only the owner can do that.', 'forbidden');
  return p.role;
}

async function signOutAll(env, shop) {
  const ep = await epoch(env, shop) + 1;
  await env.DB.batch([putSetting(env, shop, 'epoch', ep), env.DB.prepare('DELETE FROM passes WHERE shop = ?').bind(shop)]);
  return { success: true };
}

// ---------- reading ----------
async function readSettings(env, shop) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE shop = ? AND key IN ('staff', 'lowAt', 'payments')").bind(shop).all();
  const out = { staff: null, lowAt: null, payments: DEFAULT_PAYMENTS };
  for (const r of results) {
    if (r.key === 'staff') { try { out.staff = JSON.parse(r.value); } catch (e) { /* ignore */ } }
    if (r.key === 'lowAt') out.lowAt = Number(r.value) || null;
    if (r.key === 'payments') { try { const v = JSON.parse(r.value); if (Array.isArray(v) && v.length) out.payments = v; } catch (e) { /* ignore */ } }
  }
  return out;
}

async function getAll(env, shop, role) {
  const [p, s, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM products WHERE shop = ? ORDER BY createdAt').bind(shop).all(),
    role === 'owner'
      ? env.DB.prepare('SELECT * FROM sales WHERE shop = ? ORDER BY createdAt').bind(shop).all()
      // Staff see what sold and when, not money.
      : env.DB.prepare('SELECT id, productId, productName, saleDate, createdAt, quantity FROM sales WHERE shop = ? ORDER BY createdAt').bind(shop).all(),
    readSettings(env, shop)
  ]);
  const products = p.results.map(r => { const o = Object.assign({}, r); delete o.shop; if (o.archived == null) o.archived = ''; if (role !== 'owner') delete o.costPrice; return o; });
  const sales = s.results.map(r => { const o = Object.assign({}, r); delete o.shop; if (o.costPrice == null) o.costPrice = ''; return o; });
  return { version: VERSION, role, products, sales, settings };
}

const getProduct = (env, shop, id) => env.DB.prepare('SELECT * FROM products WHERE shop = ? AND id = ?').bind(shop, String(id || '')).first();

// ---------- writing ----------
async function addSale(env, shop, d) {
  const p = await getProduct(env, shop, d.productId);
  if (!p) fail('That product no longer exists.');
  if (p.archived) fail('That product has been removed.');
  const q = int(d.quantity);
  if (!(q >= 1)) fail('Enter a quantity of 1 or more.');
  if (q > p.quantity) fail('Only ' + p.quantity + ' left on the shelf.');
  const pay = String(d.paymentMethod || '').toLowerCase();
  const types = (await readSettings(env, shop)).payments.filter(t => !t.retired);
  if (!types.some(t => t.id === pay)) fail('Choose one of: ' + types.map(t => t.label).join(', ') + '.');
  const note = str(d.note, 300);
  if (isTestText(note) && !isTestProduct(p)) fail('Test sales must use a [TEST] product so real stock isn’t changed.');
  const now = new Date();
  const price = money(p.sellPrice);
  const sale = {
    id: 'SALE-' + now.getTime(), productId: p.id, productName: p.name + (p.size ? ' · ' + p.size : ''),
    quantity: q, sellPrice: price, total: money(price * q), paymentMethod: pay, saleDate: bkkDay(now),
    soldBy: str(d.soldBy, 40), createdAt: now.toISOString(), note, costPrice: p.costPrice > 0 ? money(p.costPrice) : ''
  };
  // One transaction: take the pieces off the shelf only if they're still there,
  // and write the sale only if that worked. Two phones can't oversell.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [upd] = await env.DB.batch([
        env.DB.prepare('UPDATE products SET quantity = quantity - ? WHERE shop = ? AND id = ? AND quantity >= ? AND archived IS NULL').bind(q, shop, p.id, q),
        env.DB.prepare(`INSERT INTO sales (shop, id, productId, productName, quantity, sellPrice, total, costPrice, paymentMethod, saleDate, soldBy, createdAt, note)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
          .bind(shop, sale.id, sale.productId, sale.productName, q, price, sale.total, sale.costPrice === '' ? null : sale.costPrice, pay, sale.saleDate, sale.soldBy, sale.createdAt, note)
      ]);
      if (upd.meta.changes !== 1) {
        const now2 = await getProduct(env, shop, p.id);
        fail('Only ' + (now2 ? now2.quantity : 0) + ' left on the shelf.');
      }
      return { success: true, sale, newQuantity: p.quantity - q };
    } catch (e) {
      // Two sales in the same millisecond: give this one the next id and try again.
      if (e instanceof Fail || !/UNIQUE/i.test(String(e.message))) throw e;
      sale.id = 'SALE-' + (Number(sale.id.slice(5)) + 1);
    }
  }
  fail('Couldn’t save the sale. Please try again.');
}

async function addStock(env, shop, d) {
  const p = await getProduct(env, shop, d.productId);
  if (!p) fail('That product no longer exists.');
  const n = int(d.add);
  if (!(n >= 1)) fail('Add at least 1 piece.');
  let cost = null;
  if (d.costPrice !== '' && d.costPrice != null) { cost = Number(d.costPrice); if (!(cost >= 0)) fail('Cost price must be 0 or more.'); cost = money(cost); }
  const r = await env.DB.prepare('UPDATE products SET quantity = quantity + ?, costPrice = COALESCE(?, costPrice) WHERE shop = ? AND id = ? RETURNING quantity').bind(n, cost, shop, p.id).first();
  return { success: true, quantity: r.quantity };
}

// Staff add photo, name, quantity and sell price. Only the owner sets cost.
async function addProduct(env, shop, d, role) {
  const name = str(d.name, 120);
  if (!name) fail('Give the product a name.');
  const sell = Number(d.sellPrice), qty = int(d.quantity);
  const cost = role !== 'owner' || d.costPrice === '' || d.costPrice == null ? 0 : Number(d.costPrice);
  if (!(sell > 0)) fail('Enter a sell price above 0.');
  if (!(cost >= 0)) fail('Cost price must be 0 or more.');
  if (!(qty >= 0)) fail('Enter how many are on the shelf (0 or more).');
  const p = { id: 'PRD-' + Date.now(), name, size: str(d.size, 40), costPrice: money(cost), sellPrice: money(sell), quantity: qty, imageUrl: str(d.imageUrl, 500), addedBy: str(d.addedBy, 40), createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await env.DB.prepare('INSERT INTO products (shop, id, name, size, costPrice, sellPrice, quantity, imageUrl, addedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(shop, p.id, p.name, p.size, p.costPrice, p.sellPrice, p.quantity, p.imageUrl, p.addedBy, p.createdAt).run();
      return { success: true, product: p };
    } catch (e) {
      if (!/UNIQUE/i.test(String(e.message))) throw e;
      p.id = 'PRD-' + (Number(p.id.slice(4)) + 1);
    }
  }
  fail('Couldn’t save the product. Please try again.');
}

async function updateProduct(env, shop, d) {
  if (!await getProduct(env, shop, d.id)) fail('That product no longer exists.');
  const f = {};
  if (d.name !== undefined) { const n = str(d.name, 120); if (!n) fail('Give the product a name.'); f.name = n; }
  if (d.size !== undefined) f.size = str(d.size, 40);
  if (d.costPrice !== undefined && d.costPrice !== '') { const c = Number(d.costPrice); if (!(c >= 0)) fail('Cost price must be 0 or more.'); f.costPrice = money(c); }
  if (d.sellPrice !== undefined) { const s = Number(d.sellPrice); if (!(s > 0)) fail('Enter a sell price above 0.'); f.sellPrice = money(s); }
  if (d.quantity !== undefined) { const q = int(d.quantity); if (!(q >= 0)) fail('Quantity must be 0 or more.'); f.quantity = q; }
  if (d.imageUrl) f.imageUrl = str(d.imageUrl, 500);
  const keys = Object.keys(f); // fixed list above, never taken from the request
  if (keys.length) await env.DB.prepare(`UPDATE products SET ${keys.map(k => k + ' = ?').join(', ')} WHERE shop = ? AND id = ?`).bind(...keys.map(k => f[k]), shop, String(d.id)).run();
  return { success: true };
}

async function archiveProduct(env, shop, d) {
  const r = await env.DB.prepare('UPDATE products SET archived = ? WHERE shop = ? AND id = ?').bind(new Date().toISOString(), shop, String(d.id || '')).run();
  if (!r.meta.changes) fail('That product no longer exists.');
  return { success: true };
}

async function saveSettings(env, shop, d) {
  const staff = Array.isArray(d.staff) ? d.staff.map(s => str(s, 30)).filter(Boolean).slice(0, 30) : null;
  const lowAt = d.lowAt != null ? Math.max(1, Math.min(20, int(d.lowAt) || 0)) : null;
  let payments = null;
  if (Array.isArray(d.payments)) {
    // Ids are kept for good once used: a type can be renamed or retired, never re-pointed.
    const before = (await readSettings(env, shop)).payments;
    const seen = new Set();
    payments = d.payments.slice(0, 20).map(t => {
      const label = str(t && t.label, 30);
      let id = str(t && t.id, 30).toLowerCase() || label.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, '-').replace(/^-|-$/g, '');
      return { id, label, retired: !!(t && t.retired) };
    }).filter(t => t.id && t.label && !seen.has(t.id) && seen.add(t.id));
    // A type that was in the list before can't silently disappear: it's kept as retired.
    before.forEach(t => { if (!seen.has(t.id)) payments.push(Object.assign({}, t, { retired: true })); });
    payments = payments.map(t => t.retired ? t : { id: t.id, label: t.label });
    if (!payments.some(t => !t.retired)) fail('Keep at least one payment type switched on.');
  }
  const ops = [];
  if (payments) ops.push(putSetting(env, shop, 'payments', JSON.stringify(payments)));
  if (staff) ops.push(putSetting(env, shop, 'staff', JSON.stringify(staff)));
  if (lowAt) ops.push(putSetting(env, shop, 'lowAt', lowAt));
  if (ops.length) await env.DB.batch(ops);
  return { success: true, settings: await readSettings(env, shop) };
}

// ---------- photos (R2) ----------
async function uploadImage(env, shop, d, origin) {
  const b64 = String(d.imageData || '');
  if (!b64) fail('No photo was sent.');
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch (e) { fail('That photo couldn’t be read.'); }
  if (bytes.length > MAX_PHOTO_BYTES) fail('That photo is too large.');
  // Trust the file's own bytes, not the name or label it came with: only real
  // JPEG, PNG and WebP images are stored.
  const mime = imageType(bytes);
  if (!mime) fail('Only photos can be added (JPEG, PNG or WebP).');
  const key = `${shop}/${Date.now()}-${randomHex(4)}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: mime } });
  // Saved as a path on this API ("/img/…"), so the rows stay valid if the API's address changes.
  return { success: true, imageUrl: `/img/${key}` };
}

function imageType(b) {
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
}

async function photo(env, key) {
  if (!/^(baan|chud)\/[\w.-]+$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const type = /^image\/(jpeg|png|webp|gif|heic)$/.test(obj.httpMetadata?.contentType || '') ? obj.httpMetadata.contentType : 'image/jpeg';
  return new Response(obj.body, { headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': obj.httpEtag } });
}

// ---------- test data ----------
async function testRows(env, shop) {
  const [p, s] = await Promise.all([
    env.DB.prepare("SELECT id, name FROM products WHERE shop = ? AND name LIKE '%[TEST]%'").bind(shop).all(),
    env.DB.prepare("SELECT id, productName, note, total FROM sales WHERE shop = ? AND (productName LIKE '%[TEST]%' OR note LIKE '%[TEST]%')").bind(shop).all()
  ]);
  return { products: p.results.filter(isTestProduct), sales: s.results.filter(isTestSale) };
}
async function previewTestData(env, shop) {
  const t = await testRows(env, shop);
  return { products: t.products.map(x => ({ id: x.id, name: x.name })), sales: t.sales.map(x => ({ id: x.id, name: x.productName, total: x.total })) };
}
// Deletes only rows that are still [TEST] rows and were in the list the owner confirmed.
async function clearTestData(env, shop, d) {
  const want = { products: new Set((d.productIds || []).map(String)), sales: new Set((d.saleIds || []).map(String)) };
  const t = await testRows(env, shop);
  const ps = t.products.filter(x => want.products.has(x.id)).map(x => x.id);
  const ss = t.sales.filter(x => want.sales.has(x.id)).map(x => x.id);
  const ops = [
    ...ss.map(id => env.DB.prepare('DELETE FROM sales WHERE shop = ? AND id = ?').bind(shop, id)),
    ...ps.map(id => env.DB.prepare('DELETE FROM products WHERE shop = ? AND id = ?').bind(shop, id))
  ];
  if (ops.length) await env.DB.batch(ops);
  return { success: true, removed: { products: ps.length, sales: ss.length } };
}

// ---------- email (optional; needs RESEND_API_KEY and REPORT_TO) ----------
// Who gets emails: the REPORT_TO secret on Cloudflare (comma-separated).
function recipients(env) {
  return String(env.REPORT_TO || '').split(',').map(x => x.trim()).filter(Boolean);
}
async function email(env, subject, html, to) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'Email isn’t set up yet: the Resend key (RESEND_API_KEY) is missing on Cloudflare.' };
  if (!to || !to.length) return { ok: false, error: 'No one to send to: set REPORT_TO on Cloudflare, or type an address to send a test.' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.REPORT_FROM || 'Shop app <onboarding@resend.dev>', to, subject, html })
    });
    if (r.ok) return { ok: true };
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch (e) { /* not JSON */ }
    return { ok: false, error: 'Resend refused the email: ' + (msg || 'HTTP ' + r.status) };
  } catch (e) { return { ok: false, error: 'Couldn’t reach Resend: ' + e.message }; } // scheduled sends are best effort
}
function payLabel(v, types) {
  const s = String(v || '').trim().toLowerCase();
  const t = (types || []).find(x => x.id === s);
  if (t) return t.label;
  if (s === 'cash') return 'Cash';
  if (s === 'card') return 'Card';
  if (['qr', 'scan', 'alipay', 'promptpay'].includes(s)) return 'QR code';
  if (s === 'credit') return 'Card or QR (older)';
  return s ? 'Other' : 'Not recorded';
}

async function report(env, shop, fromDay, toDay, title, subtitle) {
  const { results } = await env.DB.prepare('SELECT productName, quantity, total, paymentMethod, soldBy, note FROM sales WHERE shop = ? AND saleDate BETWEEN ? AND ?').bind(shop, fromDay, toDay).all();
  const types = (await readSettings(env, shop)).payments;
  const sales = results.filter(s => !isTestSale(s));
  const total = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const group = keyFn => { const m = {}; sales.forEach(s => { const k = keyFn(s); m[k] = m[k] || { n: 0, qty: 0, total: 0 }; m[k].n++; m[k].qty += Number(s.quantity) || 1; m[k].total += Number(s.total || 0); }); return Object.entries(m).sort((a, b) => b[1].total - a[1].total); };
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = n => { n = String(n || '').trim(); return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : 'Unknown'; };
  const b = n => '฿' + Math.round(n).toLocaleString('en-US');
  const td = 'padding:8px 12px;border-bottom:1px solid #f0e8dc';
  const table = (head, rows, cols) => `<div style="background:white;border-radius:10px;margin-bottom:16px;overflow:hidden"><div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">${head}</div><table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map(([k, v]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td};text-align:center">${cols(v)}</td><td style="${td};text-align:right">${b(v.total)}</td></tr>`).join('')}</table></div>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#faf6ef;padding:24px;border-radius:16px">
    <div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px">
      <div style="color:#e8a878;font-size:22px;font-weight:700">${SHOPS[shop]}</div>
      <div style="color:#c9b8a6;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${title}</div>
      <div style="color:#faf6ef;font-size:15px;margin-top:8px">${subtitle}</div>
      <div style="color:#faf6ef;font-size:26px;font-weight:700;margin-top:10px">${b(total)}</div>
      <div style="color:#c9b8a6;font-size:12px">${sales.length} sales</div>
    </div>
    ${sales.length ? table('How people paid', group(s => payLabel(s.paymentMethod, types)), v => v.n + ' sales') + table('Items sold', group(s => s.productName || 'Unknown'), v => v.qty) + table('Sales by staff', group(s => clean(s.soldBy)), v => v.n + ' sales') : '<p style="text-align:center;color:#8a7968">No sales recorded.</p>'}
  </div>`;
  return { html, n: sales.length };
}

const fmtDay = (day, opts) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));
// Today's report (daily) or last month's (monthly), Bangkok dates.
async function buildReport(env, shop, kind, now) {
  if (kind === 'monthly') {
    const d = new Date(bkkDay(now) + 'T12:00:00Z');
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    const ym = d.toISOString().slice(0, 7);
    const name = fmtDay(ym + '-01', { month: 'long', year: 'numeric' });
    const r = await report(env, shop, ym + '-01', ym + '-31', 'Monthly sales report', name);
    return Object.assign(r, { subject: `📊 ${SHOPS[shop]} monthly report — ${name}`, period: name });
  }
  const today = bkkDay(now);
  const label = fmtDay(today, { day: '2-digit', month: 'short', year: 'numeric' });
  const r = await report(env, shop, today, today, 'Daily sales report', label);
  return Object.assign(r, { subject: `📊 ${SHOPS[shop]} daily report — ${label}`, period: label });
}
async function sendDaily(env, shop, now) {
  const r = await buildReport(env, shop, 'daily', now);
  if (r.n) await email(env, r.subject, r.html, recipients(env)); // no email on a day with no sales
}
async function sendMonthly(env, shop, now) {
  const r = await buildReport(env, shop, 'monthly', now);
  await email(env, r.subject, r.html, recipients(env));
}
// Owner's "Send now" button in Settings: sends even on a day with no sales, to the
// address typed there (if any) or the usual recipients, and
// reports Resend's answer, so it doubles as a test of the email setup.
async function sendReportNow(env, shop, d) {
  const kind = d.kind === 'monthly' ? 'monthly' : 'daily';
  const r = await buildReport(env, shop, kind, new Date());
  // A test address typed in Settings gets this one email; it isn't saved anywhere.
  const test = String(d.to || '').trim().toLowerCase();
  if (test && (!EMAIL_RE.test(test) || test.length > 120)) fail('That doesn’t look like an email address (like name@gmail.com).');
  const to = test ? [test] : recipients(env);
  const sent = await email(env, r.subject, r.html, to);
  if (!sent.ok) fail(sent.error);
  return { success: true, kind, period: r.period, sales: r.n, recipients: to.length, to: test || '' };
}
