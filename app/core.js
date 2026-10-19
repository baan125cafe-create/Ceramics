// Shared helpers and the two data sources the app can run on.
//  - demo:  made-up data in this browser tab (demo-data.js). Writes stay in the tab.
//  - sheet: the shop's existing Google Apps Script, READ-ONLY. It can only send
//           "get…" requests, so it cannot change the real sheet. Saving is turned
//           on later by the new PIN-protected script, not by this file.
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
    if (/^(qr|qr ?code|promptpay|prompt pay|พร้อมเพย์|transfer|bank transfer|โอน.*)$/.test(v)) return 'qr';
    if (v === 'credit') return 'legacy';
    return 'other';
  }
  const PAY_LABEL = { cash: 'Cash', card: 'Card', qr: 'QR code', legacy: 'Card or QR (older)', unknown: 'Not recorded', other: 'Other' };
  const PAY_ORDER = ['cash', 'card', 'qr', 'legacy', 'other', 'unknown'];

  // ---------- shape the sheet rows the same way every time ----------
  function normalize(d) {
    const products = (d.products || []).filter(p => p && p.id !== '' && p.id != null).map(p => ({
      ...p, id: String(p.id), name: String(p.name || '').trim(), size: String(p.size || '').trim(),
      costPrice: num(p.costPrice), sellPrice: num(p.sellPrice), quantity: num(p.quantity), imageUrl: String(p.imageUrl || '')
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
    id: 'demo', canWrite: true, usesPin: true,
    async load(shop) { return demoData(shop); },
    reset(shop) { delete demoCache[shop]; },
    // Mirrors the planned server rule: 5 wrong PINs in a row pause sign-in for
    // everyone (15 min, then 1 h, then 24 h). Phones already signed in keep working.
    async login(pin) {
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
      const p = d.products.find(x => x.id === productId);
      if (!p) throw new Error('That product no longer exists.');
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
      const d = demoData(shop);
      d.products = d.products.filter(x => x.id !== id);
    }
  };

  // ---------- live sheet source (read-only) ----------
  const SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const READ_ONLY = 'This is a read-only preview of the live sheet, so saving is turned off. It switches on once the new PIN-protected script is installed.';
  const Sheet = {
    id: 'sheet', canWrite: false, usesPin: false,
    link(shop) { const v = (lsGet(CFG.shops[shop].apiKey) || '').trim(); return SCRIPT_RE.test(v) ? v : ''; },
    setLink(shop, url) {
      url = String(url || '').trim();
      if (!SCRIPT_RE.test(url)) throw new Error('That doesn’t look like a script link. It should start with https://script.google.com/macros/s/ and end with /exec.');
      if (!lsSet(CFG.shops[shop].apiKey, url)) throw new Error('This browser won’t save the link (private mode?).');
    },
    forget(shop) { lsDel(CFG.shops[shop].apiKey); },
    async call(shop, action) {
      // Hard guard: only read actions ever leave this file.
      if (!/^get[A-Z]/.test(action)) throw new Error(READ_ONLY);
      const url = this.link(shop);
      if (!url) throw new Error('No sheet is connected for this shop yet.');
      // text/plain POST, same as the old pages: no CORS preflight.
      const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action }) });
      if (!r.ok) throw new Error('The sheet didn’t answer (HTTP ' + r.status + ').');
      const j = await r.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    },
    async load(shop) {
      try {
        const r = await this.call(shop, 'getAll');
        if (r && Array.isArray(r.products) && Array.isArray(r.sales)) return normalize(r);
      } catch (e) { if (/connected|preview/.test(e.message)) throw e; /* older script: fall back */ }
      const [p, s] = await Promise.all([this.call(shop, 'getProducts'), this.call(shop, 'getSales')]);
      return normalize({ products: p.products, sales: s.sales });
    }
  };
  ['addSale', 'addStock', 'addProduct', 'updateProduct', 'deleteProduct', 'login'].forEach(m => { Sheet[m] = async () => { throw new Error(READ_ONLY); }; });

  window.ShopCore = { CFG, num, bkkDate, label, lsGet, lsSet, lsDel, payKind, PAY_LABEL, PAY_ORDER, normalize, Backends: { demo: Demo, sheet: Sheet }, READ_ONLY };
})();
