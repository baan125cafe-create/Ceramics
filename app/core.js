// Shared helpers and the two data sources the app can run on.
//  - demo: made-up data in this browser tab (demo-data.js). Writes stay in the tab.
//  - live: the shop API on Cloudflare (../worker). Sign-in with a PIN; the API
//          checks the role on every request.
(function () {
  'use strict';
  const CFG = window.SHOP_CONFIG;

  // ---------- helpers ----------
  const num = x => { const n = Number(String(x == null ? '' : x).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const bkkDate = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const label = p => (p.name || 'Unnamed') + (p.size ? ' · ' + p.size : '');
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  // ---------- payments ----------
  // Map whatever was typed or saved over time onto the three current types.
  function payKind(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return 'unknown';
    if (/^(cash|เงินสด)$/.test(v)) return 'cash';
    if (/^(card|credit card|debit card|debit|visa|master ?card|amex|บัตร.*)$/.test(v)) return 'card';
    if (/^(qr|qr ?code|scan|alipay|wechat ?pay|promptpay|prompt pay|พร้อมเพย์|สแกน.*|transfer|bank transfer|โอน.*)$/.test(v)) return 'qr';
    if (v === 'credit') return 'legacy';
    return 'other';
  }
  const PAY_LABEL = { cash: 'Cash', card: 'Card', qr: 'QR code', legacy: 'Card or QR (older)', unknown: 'Not recorded', other: 'Other' };
  const PAY_ORDER = ['cash', 'card', 'qr', 'legacy', 'other', 'unknown'];

  // ---------- shape the sheet rows the same way every time ----------
  function normalize(d) {
    const products = (d.products || []).filter(p => p && p.id !== '' && p.id != null).map(p => ({
      ...p, id: String(p.id), name: String(p.name || '').trim(), size: String(p.size || '').trim(),
      costPrice: num(p.costPrice), sellPrice: num(p.sellPrice), quantity: num(p.quantity), imageUrl: String(p.imageUrl || ''),
      archived: !(p.archived === '' || p.archived == null || p.archived === false)
    }));
    const sales = (d.sales || []).filter(s => s && s.id !== '' && s.id != null).map(s => ({
      ...s, id: String(s.id), productId: String(s.productId == null ? '' : s.productId), productName: String(s.productName || '').trim(),
      quantity: num(s.quantity) || 1, sellPrice: num(s.sellPrice), total: num(s.total), costPrice: s.costPrice === '' || s.costPrice == null ? undefined : num(s.costPrice)
    }));
    return { products, sales };
  }

  // ---------- demo source ----------
  const demoCache = {};
  const demoData = shop => { if (!demoCache[shop]) demoCache[shop] = normalize(window.makeDemoData(shop)); return demoCache[shop]; };
  const lock = { fails: 0, until: 0, level: 0 };
  const Demo = {
    id: 'demo',
    canWrite() { return true; },
    async load(shop) { return demoData(shop); },
    reset(shop) { delete demoCache[shop]; },
    // Mirrors the planned server rule: 5 wrong PINs in a row pause sign-in for
    // everyone (15 min, then 1 h, then 24 h). Phones already signed in keep working.
    async login(shop, pin) {
      const now = Date.now();
      if (now < lock.until) return { locked: Math.ceil((lock.until - now) / 60000) };
      const role = { '111111': 'staff', '222222': 'owner' }[pin];
      if (role) { lock.fails = 0; lock.level = 0; return { role }; }
      if (++lock.fails >= 5) {
        const mins = [15, 60, 1440][Math.min(lock.level, 2)];
        lock.level++; lock.fails = 0; lock.until = now + mins * 60000;
        return { locked: mins };
      }
      return { left: 5 - lock.fails };
    },
    async addSale(shop, { productId, quantity, paymentMethod, soldBy, note }) {
      const d = demoData(shop);
      const p = d.products.find(x => x.id === productId && !x.archived);
      if (!p) throw new Error('That product no longer exists.');
      if (isTestText(note) && !isTestProduct(p)) throw new Error('Test sales must use a test product (with \u201ctest\u201d in its name) so real inventory isn\u2019t changed.');
      const q = Math.floor(num(quantity));
      if (q < 1) throw new Error('Enter a quantity of 1 or more.');
      if (q > p.quantity) throw new Error('Only ' + p.quantity + ' left on the shelf.');
      const now = new Date();
      // The server works out price and total, and saves today's cost with the sale.
      const sale = { id: 'SALE-' + now.getTime(), productId: p.id, productName: label(p), quantity: q, sellPrice: p.sellPrice, total: q * p.sellPrice, costPrice: p.costPrice || undefined, paymentMethod, saleDate: bkkDate(now), soldBy, note, createdAt: now.toISOString() };
      d.sales.push(sale);
      p.quantity -= q;
      return sale;
    },
    async addStock(shop, { productId, add, costPrice }) {
      const p = demoData(shop).products.find(x => x.id === productId);
      if (!p) throw new Error('That product no longer exists.');
      const n = Math.floor(num(add));
      if (n < 1) throw new Error('Add at least 1 piece.');
      p.quantity += n; // adds to the count, never overwrites it
      if (costPrice !== '' && costPrice != null && num(costPrice) >= 0) p.costPrice = num(costPrice);
      return p;
    },
    async addProduct(shop, f) {
      const p = { id: 'PRD-' + Date.now(), name: f.name, size: f.size, costPrice: num(f.costPrice), sellPrice: num(f.sellPrice), quantity: Math.floor(num(f.quantity)), imageUrl: f.imageUrl || '', addedBy: f.addedBy || '', createdAt: new Date().toISOString() };
      demoData(shop).products.push(p);
      return p;
    },
    async updateProduct(shop, id, f) {
      const p = demoData(shop).products.find(x => x.id === id);
      if (!p) throw new Error('That product no longer exists.');
      Object.assign(p, { name: f.name, size: f.size, costPrice: num(f.costPrice), sellPrice: num(f.sellPrice), quantity: Math.floor(num(f.quantity)) });
      return p;
    },
    async deleteProduct(shop, id) {
      const p = demoData(shop).products.find(x => x.id === id);
      if (p) p.archived = true; // hidden, like the live script: old sales keep their cost
    },
    async saveSettings() { return { success: true }; },
    async signOutAll() { return { success: true }; },
    async previewTestData(shop) {
      const d = demoData(shop);
      return { products: d.products.filter(isTestProduct).map(p => ({ id: p.id, name: p.name })), sales: d.sales.filter(isTestSale).map(s => ({ id: s.id, name: s.productName, total: s.total })) };
    },
    async clearTestData(shop, ids) {
      const d = demoData(shop);
      const ps = new Set(ids.productIds || []), ss = new Set(ids.saleIds || []);
      const before = [d.products.length, d.sales.length];
      d.products = d.products.filter(p => !(ps.has(p.id) && isTestProduct(p)));
      d.sales = d.sales.filter(s => !(ss.has(s.id) && isTestSale(s)));
      return { success: true, removed: { products: before[0] - d.products.length, sales: before[1] - d.sales.length } };
    }
  };

  // ---------- live source: the shop API on Cloudflare (worker/) ----------
  // Every request after sign-in carries the pass from the PIN. The API decides what
  // each role may see and do; the app only hides what the role can't use.
  // On this computer (localhost) the app uses the local API from `npm run dev` in
  // worker/ (port 8787, or ?local=PORT), never the real shop data, unless the address
  // ends in ?live=1: that tests the deployed API from this computer before merging.
  const LOCAL = (() => {
    try {
      if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return '';
      if (new URL(location.href).searchParams.get('live') === '1') return '';
      const port = new URL(location.href).searchParams.get('local');
      return 'http://localhost:' + (/^\d{2,5}$/.test(port || '') ? port : '8787');
    } catch (e) { return ''; }
  })();
  // The main address first, then the backup (workers.dev). If a phone's network can't
  // reach one (e.g. a new domain its DNS hasn't picked up yet), the next is tried and kept.
  const APIS = LOCAL ? [LOCAL] : [CFG.api, CFG.apiBackup].map(u => String(u || '').replace(/\/+$/, '')).filter(Boolean);
  let apiAt = 0;
  const apiBase = () => APIS[apiAt] || '';
  const API = APIS[0] || '';
  const READ_ONLY = 'Please sign in again to save.';
  const ACTIONS = ['getVersion', 'login', 'getAll', 'addSale', 'addStock', 'addProduct', 'updateProduct', 'archiveProduct', 'uploadImage', 'saveSettings', 'signOutAll', 'sendReport', 'previewTestData', 'clearTestData'];
  const passKey = shop => 'b125_pass_' + shop + (LOCAL ? '_local' : '');
  // Photos saved in R2 are stored as "/img/…" paths on the API.
  const photoUrl = u => (/^\/img\//.test(String(u || '')) && apiBase() ? apiBase() + u : String(u || ''));
  const Live = {
    id: 'live', info: {},
    local: LOCAL, get api() { return apiBase(); },
    configured() { return !!API; },
    pass(shop) {
      try { const p = JSON.parse(lsGet(passKey(shop)) || 'null'); if (p && p.token && new Date(p.expires) > new Date()) return p; } catch (e) { /* ignore */ }
      return null;
    },
    dropPass(shop) { lsDel(passKey(shop)); },
    canWrite(shop) { return !!this.pass(shop); },
    async call(shop, action, payload) {
      if (!ACTIONS.includes(action)) throw new Error('Unknown action: ' + action);
      if (!API) throw new Error('The live shop data isn’t set up yet (no API address in config.js).');
      const pass = this.pass(shop);
      const body = Object.assign({}, payload || {}, { action });
      if (pass && action !== 'login' && action !== 'getVersion') body.token = pass.token;
      let r;
      // text/plain POST: no CORS preflight. Try the address that worked last, then the others.
      for (let i = 0; i < APIS.length && !r; i++) {
        const at = (apiAt + i) % APIS.length;
        try { r = await fetch(APIS[at] + '/' + shop, { method: 'POST', body: JSON.stringify(body) }); apiAt = at; }
        catch (e) { /* network or DNS failure: try the next address */ }
      }
      if (!r) throw new Error('Couldn’t reach the shop data. Check the internet connection and try again.');
      const j = await r.json().catch(() => null);
      if (!j) throw new Error('The shop data didn’t answer (HTTP ' + r.status + ').');
      if (j.error) {
        if (j.code === 'auth') this.dropPass(shop);
        const e = new Error(j.error); e.code = j.code || ''; throw e;
      }
      return j;
    },
    async detect(shop) {
      if (!this.info[shop]) this.info[shop] = await this.call(shop, 'getVersion');
      return this.info[shop];
    },
    async login(shop, pin) {
      const r = await this.call(shop, 'login', { pin });
      if (r.token) lsSet(passKey(shop), JSON.stringify({ token: r.token, role: r.role, expires: r.expires }));
      return r;
    },
    async load(shop) {
      const r = await this.call(shop, 'getAll');
      const d = normalize(r);
      d.products.forEach(p => { p.imageUrl = photoUrl(p.imageUrl); });
      return Object.assign(d, { settings: r.settings || null, role: r.role });
    },
    async addSale(shop, f) { const r = await this.call(shop, 'addSale', f); return r.sale; },
    async addStock(shop, f) { return this.call(shop, 'addStock', f); },
    async addProduct(shop, f) {
      let imageUrl = f.imageUrl || '';
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(imageUrl);
      if (m) imageUrl = (await this.call(shop, 'uploadImage', { mimeType: m[1], imageData: m[2] })).imageUrl;
      return (await this.call(shop, 'addProduct', Object.assign({}, f, { imageUrl }))).product;
    },
    async updateProduct(shop, id, f) { return this.call(shop, 'updateProduct', Object.assign({ id }, f)); },
    async deleteProduct(shop, id) { return this.call(shop, 'archiveProduct', { id }); },
    async saveSettings(shop, f) { return this.call(shop, 'saveSettings', f); },
    async signOutAll(shop) { const r = await this.call(shop, 'signOutAll'); this.dropPass(shop); return r; },
    async sendReport(shop, kind, to) { return this.call(shop, 'sendReport', to ? { kind, to } : { kind }); },
    async previewTestData(shop) { return this.call(shop, 'previewTestData'); },
    async clearTestData(shop, ids) { return this.call(shop, 'clearTestData', ids); }
  };

  // Test rows: left out of every total, and clearable from Settings. A product is a test product
  // when its name has "test" as a word, in any case ("[TEST] Mug", "test mug"), not "Latest".
  // Must match isTestName / isTestSale in worker/src/index.js.
  const isTestName = v => /\btest\b/i.test(String(v || ''));
  const isTestText = v => /^\s*\[test\]/i.test(String(v || ''));
  const isTestProduct = p => isTestName(p.name);
  const isTestSale = s => isTestName(s.productName) || isTestText(s.note);

  window.ShopCore = { CFG, num, bkkDate, label, lsGet, lsSet, lsDel, payKind, PAY_LABEL, PAY_ORDER, normalize, isTestProduct, isTestSale, Backends: { demo: Demo, live: Live }, READ_ONLY };
})();
