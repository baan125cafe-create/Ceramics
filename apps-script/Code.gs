// ============================================================
// Shop app back end — v6 (shared by Baan 125 and ChudPak)
//
// INSTALL (in the shop's Google Sheet: Extensions → Apps Script)
//   1. Replace the code with this file and save.
//   2. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
//      This creates a NEW link. Existing links keep running their old version,
//      so the old pages keep working until you archive those deployments.
//   3. Reload the sheet. In the new "Shop app" menu, set the owner PIN and the
//      staff PIN (6 digits each). PINs are never written in this code.
//   4. Open the app, choose Live sheet → Use a different link → paste the new link.
//
// What it does
//   - Every request needs a sign-in pass from a PIN (owner or staff).
//   - 5 wrong PINs in a row pause sign-in for everyone: 15 min, then 1 h, then
//     24 h. The owner gets an email. Phones already signed in keep working.
//   - Passes expire (staff 30 days, owner 7 days). "Sign all out" ends them all.
//   - Sales: the server works out price and total and saves the cost price.
//   - "+ Stock" adds to the count. "Delete" hides (archives) a product.
//   - Rows whose product name starts with [TEST] are test data: left out of
//     reports, and the owner can clear them from the app.
// ============================================================

const VERSION = 6;
const TZ = 'Asia/Bangkok';
const PRODUCTS = 'Products';
const SALES = 'Sales';
const SETTINGS = 'Settings';
const PRODUCT_HEADERS = ['id', 'name', 'size', 'costPrice', 'sellPrice', 'quantity', 'imageUrl', 'addedBy', 'createdAt'];
const SALE_HEADERS = ['id', 'productId', 'productName', 'quantity', 'sellPrice', 'total', 'paymentMethod', 'saleDate', 'soldBy', 'createdAt'];
const PAYMENTS = ['cash', 'card', 'qr'];
const IMAGE_FOLDER_NAME = 'Baan125_Stock_Images';
const PIN_LENGTH = 6;
const MAX_TRIES = 5;
const PAUSE_MINUTES = [15, 60, 1440];
const PASS_DAYS = { staff: 30, owner: 7 };
const CACHE_SECONDS = 300;
const CHUNK = 90000;

// Who may call what. Anything not listed is refused.
const ACTIONS = {
  getVersion: null, login: null,                                         // no sign-in needed
  getAll: 'staff', addSale: 'staff', addProduct: 'staff', uploadImage: 'staff',
  addStock: 'owner', updateProduct: 'owner', archiveProduct: 'owner',
  saveSettings: 'owner', signOutAll: 'owner', previewTestData: 'owner', clearTestData: 'owner'
};

function doGet(e) { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  let data = {};
  try { data = e && e.postData ? JSON.parse(e.postData.contents) : (e && e.parameter) || {}; } catch (err) { data = (e && e.parameter) || {}; }
  let result;
  try {
    const action = String(data.action || '');
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw new Error('Unknown action: ' + action);
    const need = ACTIONS[action];
    const role = need ? checkPass_(data.token, need) : null;
    result = run_(action, data, role);
  } catch (err) {
    result = { error: err.message, code: err.code || '' };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function run_(action, d, role) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (action) {
    case 'getVersion': return { version: VERSION, shop: shopName_(), pinsSet: pinsSet_() };
    case 'login': return login_(String(d.pin || ''));
    case 'getAll': return getAll_(ss, role);
    case 'addSale': return write_(() => addSale_(ss, d));
    case 'addProduct': return write_(() => addProduct_(ss, d));
    case 'uploadImage': return uploadImage_(d);
    case 'addStock': return write_(() => addStock_(ss, d));
    case 'updateProduct': return write_(() => updateProduct_(ss, d));
    case 'archiveProduct': return write_(() => archiveProduct_(ss, d));
    case 'saveSettings': return saveSettings_(ss, d);
    case 'signOutAll': return signOutAll_();
    case 'previewTestData': return previewTestData_(ss);
    case 'clearTestData': return write_(() => clearTestData_(ss, d));
  }
  throw new Error('Unknown action: ' + action);
}

function fail_(message, code) { const e = new Error(message); e.code = code || ''; throw e; }
function shopName_() { return PropertiesService.getScriptProperties().getProperty('SHOP_NAME') || SpreadsheetApp.getActiveSpreadsheet().getName(); }

// ============================================================
// PINs and sign-in passes
// ============================================================
function props_() { return PropertiesService.getScriptProperties(); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function salt_() {
  const p = props_();
  let s = p.getProperty('PIN_SALT');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PIN_SALT', s); }
  return s;
}
function pinsSet_() { const p = props_(); return !!(p.getProperty('OWNER_PIN_HASH') && p.getProperty('STAFF_PIN_HASH')); }

function login_(pin) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = props_();
    const now = Date.now();
    const until = Number(p.getProperty('LOGIN_PAUSE_UNTIL') || 0);
    if (now < until) return { locked: Math.ceil((until - now) / 60000) };
    if (!pinsSet_()) fail_('PINs haven’t been set yet. Open the sheet and use Shop app → Set owner PIN / Set staff PIN.', 'nopins');
    const h = hash_(salt_() + pin);
    const role = h === p.getProperty('OWNER_PIN_HASH') ? 'owner' : (h === p.getProperty('STAFF_PIN_HASH') ? 'staff' : null);
    if (role) {
      p.setProperties({ LOGIN_FAILS: '0', LOGIN_PAUSE_LEVEL: '0' });
      cleanPasses_();
      const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      const exp = now + PASS_DAYS[role] * 86400000;
      p.setProperty('pass_' + hash_(token).slice(0, 40), JSON.stringify({ r: role, e: exp, g: epoch_() }));
      return { role, token, expires: new Date(exp).toISOString() };
    }
    const fails = Number(p.getProperty('LOGIN_FAILS') || 0) + 1;
    if (fails >= MAX_TRIES) {
      const level = Number(p.getProperty('LOGIN_PAUSE_LEVEL') || 0);
      const mins = PAUSE_MINUTES[Math.min(level, PAUSE_MINUTES.length - 1)];
      p.setProperties({ LOGIN_FAILS: '0', LOGIN_PAUSE_LEVEL: String(level + 1), LOGIN_PAUSE_UNTIL: String(now + mins * 60000) });
      notifyOwner_('Sign-in paused after ' + MAX_TRIES + ' wrong PINs',
        'Someone entered a wrong PIN ' + MAX_TRIES + ' times in a row, so sign-in to the ' + shopName_() + ' app is paused for ' + (mins >= 60 ? (mins / 60) + ' hour(s)' : mins + ' minutes') + '.\n\n' +
        'Phones that are already signed in keep working. If this wasn’t you or your staff, change the PINs from the Shop app menu in the sheet and use "Sign out all phones".');
      return { locked: mins };
    }
    p.setProperty('LOGIN_FAILS', String(fails));
    return { left: MAX_TRIES - fails };
  } finally { lock.releaseLock(); }
}

function epoch_() { return props_().getProperty('SESSION_EPOCH') || '1'; }

function checkPass_(token, need) {
  if (!token) fail_('Please sign in again.', 'auth');
  const raw = props_().getProperty('pass_' + hash_(String(token)).slice(0, 40));
  if (!raw) fail_('Please sign in again.', 'auth');
  const pass = JSON.parse(raw);
  if (pass.e < Date.now() || String(pass.g) !== epoch_()) fail_('Your sign-in has expired. Please sign in again.', 'auth');
  if (need === 'owner' && pass.r !== 'owner') fail_('Only the owner can do that.', 'forbidden');
  return pass.r;
}

function cleanPasses_() {
  const p = props_();
  const all = p.getProperties();
  const now = Date.now(), ep = epoch_();
  Object.keys(all).forEach(k => {
    if (k.indexOf('pass_') !== 0) return;
    try { const v = JSON.parse(all[k]); if (v.e < now || String(v.g) !== ep) p.deleteProperty(k); } catch (err) { p.deleteProperty(k); }
  });
}

function signOutAll_() {
  props_().setProperty('SESSION_EPOCH', String(Number(epoch_()) + 1));
  cleanPasses_();
  return { success: true };
}

function notifyOwner_(subject, body) {
  try {
    const to = Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, shopName_() + ' app: ' + subject, body);
  } catch (err) { /* email is best effort */ }
}

// ---------- sheet menu (owner, inside Google Sheets) ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Shop app')
    .addItem('Set owner PIN…', 'menuSetOwnerPin')
    .addItem('Set staff PIN…', 'menuSetStaffPin')
    .addSeparator()
    .addItem('Sign out all phones', 'menuSignOutAll')
    .addItem('Clear sign-in pause', 'menuClearPause')
    .addToUi();
}
function menuSetOwnerPin() { setPinFromMenu_('owner'); }
function menuSetStaffPin() { setPinFromMenu_('staff'); }
function setPinFromMenu_(role) {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Set ' + role + ' PIN', 'Enter a ' + PIN_LENGTH + '-digit PIN:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const pin = a.getResponseText().trim();
  if (!new RegExp('^\\d{' + PIN_LENGTH + '}$').test(pin)) return ui.alert('The PIN must be exactly ' + PIN_LENGTH + ' digits. Nothing was changed.');
  const b = ui.prompt('Set ' + role + ' PIN', 'Type the same PIN again:', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  if (b.getResponseText().trim() !== pin) return ui.alert('The two PINs didn’t match. Nothing was changed.');
  const p = props_();
  const h = hash_(salt_() + pin);
  const other = p.getProperty(role === 'owner' ? 'STAFF_PIN_HASH' : 'OWNER_PIN_HASH');
  if (other && other === h) return ui.alert('The owner and staff PINs must be different. Nothing was changed.');
  p.setProperty(role === 'owner' ? 'OWNER_PIN_HASH' : 'STAFF_PIN_HASH', h);
  const out = ui.alert('PIN saved', 'Sign every phone out now so everyone uses the new PIN?', ui.ButtonSet.YES_NO);
  if (out === ui.Button.YES) signOutAll_();
  ui.alert('Done. The ' + role + ' PIN is set.');
}
function menuSignOutAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Sign out all phones?', 'Every phone will need the PIN again. Sales and stock are not affected.', ui.ButtonSet.YES_NO) === ui.Button.YES) { signOutAll_(); ui.alert('All phones are signed out.'); }
}
function menuClearPause() {
  props_().setProperties({ LOGIN_FAILS: '0', LOGIN_PAUSE_LEVEL: '0', LOGIN_PAUSE_UNTIL: '0' });
  SpreadsheetApp.getUi().alert('Sign-in pause cleared.');
}

// ============================================================
// Reading
// ============================================================
function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); }
  return sh;
}
// Adds any missing column at the end. Existing columns are never moved.
function ensureColumns_(sh, names) {
  const width = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  names.forEach(n => { if (headers.indexOf(n) < 0) { headers.push(n); sh.getRange(1, headers.length).setValue(n); } });
  return headers;
}
function readRows_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(String);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row[0] === '' || row[0] == null) continue;
    const o = {};
    headers.forEach((h, j) => { if (h) o[h] = row[j] instanceof Date ? row[j].toISOString() : row[j]; });
    out.push(o);
  }
  return out;
}
function cachedRead_(key, loader) {
  const cache = CacheService.getScriptCache();
  try {
    const n = Number(cache.get(key + ':n'));
    if (n > 0) {
      const keys = []; for (let i = 0; i < n; i++) keys.push(key + ':' + i);
      const parts = cache.getAll(keys);
      if (keys.every(k => parts[k] != null)) return JSON.parse(keys.map(k => parts[k]).join(''));
    }
  } catch (err) { /* fall through */ }
  const value = loader();
  try {
    const json = JSON.stringify(value);
    const n = Math.ceil(json.length / CHUNK) || 1;
    const put = {}; for (let i = 0; i < n; i++) put[key + ':' + i] = json.substr(i * CHUNK, CHUNK);
    put[key + ':n'] = String(n);
    cache.putAll(put, CACHE_SECONDS);
  } catch (err) { /* too big: skip cache */ }
  return value;
}
function clearCache_() { CacheService.getScriptCache().removeAll(['products:n', 'sales:n']); }
const products_ = ss => cachedRead_('products', () => readRows_(sheet_(ss, PRODUCTS, PRODUCT_HEADERS)));
const sales_ = ss => cachedRead_('sales', () => readRows_(sheet_(ss, SALES, SALE_HEADERS)));

function getAll_(ss, role) {
  let products = products_(ss), sales = sales_(ss);
  if (role !== 'owner') {
    // Staff see stock and when things last sold, not costs or money totals.
    products = products.map(p => { const c = Object.assign({}, p); delete c.costPrice; return c; });
    sales = sales.map(s => ({ id: s.id, productId: s.productId, productName: s.productName, saleDate: s.saleDate, createdAt: s.createdAt, quantity: s.quantity }));
  }
  return { version: VERSION, role, products, sales, settings: readSettings_(ss) };
}

// ---------- settings (staff names, running-low level) ----------
function readSettings_(ss) {
  const sh = ss.getSheetByName(SETTINGS);
  const out = { staff: null, lowAt: null };
  if (!sh) return out;
  sh.getDataRange().getValues().forEach(r => {
    if (r[0] === 'staff') { try { out.staff = JSON.parse(r[1]); } catch (err) { /* ignore */ } }
    if (r[0] === 'lowAt') out.lowAt = Number(r[1]) || null;
  });
  return out;
}
function saveSettings_(ss, d) {
  const staff = Array.isArray(d.staff) ? d.staff.map(s => String(s).trim().slice(0, 30)).filter(Boolean).slice(0, 30) : null;
  const lowAt = d.lowAt != null ? Math.max(1, Math.min(20, Math.floor(Number(d.lowAt) || 0))) : null;
  const sh = sheet_(ss, SETTINGS, ['key', 'value']);
  const values = sh.getDataRange().getValues();
  const put = (key, val) => {
    for (let i = 1; i < values.length; i++) if (values[i][0] === key) { sh.getRange(i + 1, 2).setValue(val); return; }
    sh.appendRow([key, val]); values.push([key, val]);
  };
  if (staff) put('staff', JSON.stringify(staff));
  if (lowAt) put('lowAt', lowAt);
  return { success: true, settings: readSettings_(ss) };
}

// ============================================================
// Writing
// ============================================================
function write_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { const r = fn(); SpreadsheetApp.flush(); clearCache_(); return r; } finally { lock.releaseLock(); }
}
const isTestText_ = s => /^\s*\[test\]/i.test(String(s || ''));
const isTestProduct_ = p => isTestText_(p.name);
const isTestSale_ = s => isTestText_(s.productName) || isTestText_(s.note);
const isArchived_ = p => p.archived !== '' && p.archived != null && p.archived !== false;
const bkkDay_ = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
const int_ = x => Math.floor(Number(x));
const money_ = x => Math.round(Number(x) * 100) / 100;

function findRow_(sh, headers, id) {
  const col = headers.indexOf('id');
  const ids = sh.getRange(1, col + 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}
function rowObject_(sh, headers, rowNum) {
  const vals = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const o = {}; headers.forEach((h, j) => { o[h] = vals[j]; }); return o;
}
function setCells_(sh, headers, rowNum, fields) {
  Object.keys(fields).forEach(k => { const c = headers.indexOf(k); if (c >= 0) sh.getRange(rowNum, c + 1).setValue(fields[k]); });
}
function appendObject_(sh, headers, obj) {
  sh.appendRow(headers.map(h => (obj[h] === undefined ? '' : obj[h])));
}

function addSale_(ss, d) {
  const ps = sheet_(ss, PRODUCTS, PRODUCT_HEADERS);
  const ph = ensureColumns_(ps, []);
  const r = findRow_(ps, ph, d.productId);
  if (r < 0) fail_('That product no longer exists.');
  const p = rowObject_(ps, ph, r);
  if (isArchived_(p)) fail_('That product has been removed.');
  const q = int_(d.quantity);
  const left = Number(p.quantity) || 0;
  if (!(q >= 1)) fail_('Enter a quantity of 1 or more.');
  if (q > left) fail_('Only ' + left + ' left on the shelf.');
  const pay = String(d.paymentMethod || '').toLowerCase();
  if (PAYMENTS.indexOf(pay) < 0) fail_('Choose Cash, Card or QR code.');
  const note = String(d.note || '').trim().slice(0, 300);
  // A test sale can only use a [TEST] product, so real stock never changes in a test.
  if (isTestText_(note) && !isTestProduct_(p)) fail_('Test sales must use a [TEST] product so real stock isn’t changed.');
  const ss2 = sheet_(ss, SALES, SALE_HEADERS);
  const sh = ensureColumns_(ss2, ['note', 'costPrice']);
  const now = new Date();
  const price = money_(p.sellPrice);
  const sale = {
    id: 'SALE-' + now.getTime(), productId: String(p.id), productName: String(p.name) + (p.size ? ' · ' + p.size : ''),
    quantity: q, sellPrice: price, total: money_(price * q), paymentMethod: pay, saleDate: bkkDay_(now),
    soldBy: String(d.soldBy || '').trim().slice(0, 40), createdAt: now.toISOString(), note: note,
    costPrice: Number(p.costPrice) > 0 ? money_(p.costPrice) : ''
  };
  appendObject_(ss2, sh, sale);
  setCells_(ps, ph, r, { quantity: left - q });
  return { success: true, sale: sale, newQuantity: left - q };
}

function addStock_(ss, d) {
  const ps = sheet_(ss, PRODUCTS, PRODUCT_HEADERS);
  const ph = ensureColumns_(ps, []);
  const r = findRow_(ps, ph, d.productId);
  if (r < 0) fail_('That product no longer exists.');
  const n = int_(d.add);
  if (!(n >= 1)) fail_('Add at least 1 piece.');
  const p = rowObject_(ps, ph, r);
  const fields = { quantity: (Number(p.quantity) || 0) + n }; // adds, never overwrites
  if (d.costPrice !== '' && d.costPrice != null) {
    const c = Number(d.costPrice);
    if (!(c >= 0)) fail_('Cost price must be 0 or more.');
    fields.costPrice = money_(c);
  }
  setCells_(ps, ph, r, fields);
  return { success: true, quantity: fields.quantity };
}

function addProduct_(ss, d) {
  const name = String(d.name || '').trim().slice(0, 120);
  if (!name) fail_('Give the product a name.');
  const sell = Number(d.sellPrice), cost = d.costPrice === '' || d.costPrice == null ? 0 : Number(d.costPrice), qty = int_(d.quantity);
  if (!(sell > 0)) fail_('Enter a sell price above 0.');
  if (!(cost >= 0)) fail_('Cost price must be 0 or more.');
  if (!(qty >= 0)) fail_('Enter how many are on the shelf (0 or more).');
  const ps = sheet_(ss, PRODUCTS, PRODUCT_HEADERS);
  const ph = ensureColumns_(ps, []);
  const p = { id: 'PRD-' + Date.now(), name: name, size: String(d.size || '').trim().slice(0, 40), costPrice: money_(cost), sellPrice: money_(sell), quantity: qty, imageUrl: String(d.imageUrl || ''), addedBy: String(d.addedBy || '').slice(0, 40), createdAt: new Date().toISOString() };
  appendObject_(ps, ph, p);
  return { success: true, product: p };
}

function updateProduct_(ss, d) {
  const ps = sheet_(ss, PRODUCTS, PRODUCT_HEADERS);
  const ph = ensureColumns_(ps, []);
  const r = findRow_(ps, ph, d.id);
  if (r < 0) fail_('That product no longer exists.');
  const f = {};
  if (d.name !== undefined) { const n = String(d.name).trim().slice(0, 120); if (!n) fail_('Give the product a name.'); f.name = n; }
  if (d.size !== undefined) f.size = String(d.size).trim().slice(0, 40);
  if (d.costPrice !== undefined && d.costPrice !== '') { const c = Number(d.costPrice); if (!(c >= 0)) fail_('Cost price must be 0 or more.'); f.costPrice = money_(c); }
  if (d.sellPrice !== undefined) { const s = Number(d.sellPrice); if (!(s > 0)) fail_('Enter a sell price above 0.'); f.sellPrice = money_(s); }
  if (d.quantity !== undefined) { const q = int_(d.quantity); if (!(q >= 0)) fail_('Quantity must be 0 or more.'); f.quantity = q; }
  if (d.imageUrl) f.imageUrl = String(d.imageUrl);
  setCells_(ps, ph, r, f);
  return { success: true };
}

// "Delete" hides the product. Its row stays, so old sales keep their cost price.
function archiveProduct_(ss, d) {
  const ps = sheet_(ss, PRODUCTS, PRODUCT_HEADERS);
  const ph = ensureColumns_(ps, ['archived']);
  const r = findRow_(ps, ph, d.id);
  if (r < 0) fail_('That product no longer exists.');
  setCells_(ps, ph, r, { archived: new Date().toISOString() });
  return { success: true };
}

function uploadImage_(d) {
  const b64 = String(d.imageData || '');
  if (!b64) fail_('No photo was sent.');
  if (b64.length > 6 * 1024 * 1024) fail_('That photo is too large.');
  const mime = /^image\/(jpeg|png|webp)$/.test(d.mimeType) ? d.mimeType : 'image/jpeg';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, 'product_' + Date.now() + '.jpg');
  const p = props_();
  let folder = null;
  const saved = p.getProperty('IMAGE_FOLDER_ID');
  if (saved) { try { folder = DriveApp.getFolderById(saved); } catch (err) { folder = null; } }
  if (!folder) {
    const it = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
    folder = it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
    p.setProperty('IMAGE_FOLDER_ID', folder.getId());
  }
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true, imageUrl: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

// ---------- test data ----------
function testRows_(ss) {
  const out = { products: [], sales: [] };
  [[PRODUCTS, PRODUCT_HEADERS, isTestProduct_, 'products'], [SALES, SALE_HEADERS, isTestSale_, 'sales']].forEach(([name, hdrs, test, key]) => {
    const sh = sheet_(ss, name, hdrs);
    const values = sh.getDataRange().getValues();
    const h = values[0].map(String);
    for (let i = 1; i < values.length; i++) {
      const o = {}; h.forEach((k, j) => { o[k] = values[i][j]; });
      if (o.id !== '' && test(o)) out[key].push({ row: i + 1, id: String(o.id), name: String(o.name || o.productName || ''), total: o.total || '' });
    }
  });
  return out;
}
function previewTestData_(ss) {
  const t = testRows_(ss);
  return { products: t.products.map(x => ({ id: x.id, name: x.name })), sales: t.sales.map(x => ({ id: x.id, name: x.name, total: x.total })) };
}
// Deletes only rows that are still [TEST] rows and were in the list the owner confirmed.
function clearTestData_(ss, d) {
  const want = { products: new Set((d.productIds || []).map(String)), sales: new Set((d.saleIds || []).map(String)) };
  const t = testRows_(ss);
  let removed = { products: 0, sales: 0 };
  [['sales', SALES], ['products', PRODUCTS]].forEach(([key, name]) => {
    const sh = ss.getSheetByName(name);
    t[key].filter(x => want[key].has(x.id)).map(x => x.row).sort((a, b) => b - a).forEach(row => { sh.deleteRow(row); removed[key]++; });
  });
  return { success: true, removed: removed };
}

// ============================================================
// Email reports (same schedule as before). Test rows are left out.
// ============================================================
function dayOf_(v) {
  if (v instanceof Date) return bkkDay_(v);
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : bkkDay_(d);
}
function payKind_(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'cash') return 'Cash';
  if (s === 'card') return 'Card';
  if (s === 'qr') return 'QR code';
  if (s === 'credit') return 'Card or QR (older)';
  return s ? 'Other' : 'Not recorded';
}
function report_(fromDay, toDay, title, subtitle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sales = readRows_(sheet_(ss, SALES, SALE_HEADERS)).filter(s => !isTestSale_(s)).filter(s => { const d = dayOf_(s.saleDate || s.createdAt); return d >= fromDay && d <= toDay; });
  const total = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const group = (keyFn) => { const m = {}; sales.forEach(s => { const k = keyFn(s); m[k] = m[k] || { n: 0, qty: 0, total: 0 }; m[k].n++; m[k].qty += Number(s.quantity) || 1; m[k].total += Number(s.total || 0); }); return Object.entries(m).sort((a, b) => b[1].total - a[1].total); };
  const clean = n => { n = String(n || '').trim(); return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : 'Unknown'; };
  const b = n => '฿' + Math.round(n).toLocaleString();
  const td = 'padding:8px 12px;border-bottom:1px solid #f0e8dc';
  const table = (head, rows, cols) => `<div style="background:white;border-radius:10px;margin-bottom:16px;overflow:hidden"><div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">${head}</div><table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map(([k, v]) => `<tr><td style="${td}">${k}</td><td style="${td};text-align:center">${cols(v)}</td><td style="${td};text-align:right">${b(v.total)}</td></tr>`).join('')}</table></div>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#faf6ef;padding:24px;border-radius:16px">
    <div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px">
      <div style="color:#e8a878;font-size:22px;font-weight:700">${shopName_()}</div>
      <div style="color:#c9b8a6;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${title}</div>
      <div style="color:#faf6ef;font-size:15px;margin-top:8px">${subtitle}</div>
      <div style="color:#faf6ef;font-size:26px;font-weight:700;margin-top:10px">${b(total)}</div>
      <div style="color:#c9b8a6;font-size:12px">${sales.length} sales</div>
    </div>
    ${sales.length ? table('How people paid', group(s => payKind_(s.paymentMethod)), v => v.n + ' sales') + table('Items sold', group(s => s.productName || 'Unknown'), v => v.qty) + table('Sales by staff', group(s => clean(s.soldBy)), v => v.n + ' sales') : '<p style="text-align:center;color:#8a7968">No sales recorded.</p>'}
  </div>`;
  return { html, n: sales.length };
}
function sendDailySalesReport() {
  const today = bkkDay_(new Date());
  const r = report_(today, today, 'Daily sales report', Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy'));
  if (!r.n) return;
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: '📊 ' + shopName_() + ' daily report — ' + Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy'), htmlBody: r.html, body: 'Please view this email in HTML.' });
}
function sendMonthlySalesReport() {
  const now = new Date();
  const first = new Date(Number(Utilities.formatDate(now, TZ, 'yyyy')), Number(Utilities.formatDate(now, TZ, 'M')) - 2, 1, 12);
  const ym = Utilities.formatDate(first, TZ, 'yyyy-MM');
  const name = Utilities.formatDate(first, TZ, 'MMMM yyyy');
  const r = report_(ym + '-01', ym + '-31', 'Monthly sales report', name);
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: '📊 ' + shopName_() + ' monthly report — ' + name, htmlBody: r.html, body: 'Please view this email in HTML.' });
}
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendDailySalesReport') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailySalesReport').timeBased().everyDays(1).atHour(23).nearMinute(30).create();
}
function createMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendMonthlySalesReport') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendMonthlySalesReport').timeBased().onMonthDay(1).atHour(10).nearMinute(30).create();
}
