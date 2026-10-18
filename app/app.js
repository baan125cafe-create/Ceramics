// Baan 125 shop app — demo build.
// Runs entirely on sample data (demo-data.js). It never calls Google, so it can't
// read or change the real sheet. The live build will swap DemoBackend for the
// PIN-protected Apps Script, keeping the same calls.
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = x => Number(x) || 0;
  const money = n => '฿' + Math.round(num(n)).toLocaleString('en-US');
  const moneyShort = n => { n = num(n); if (n >= 1e6) return '฿' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return '฿' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'; return '฿' + Math.round(n); };
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const bkkDate = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const bkkHour = d => Number(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false })) % 24;
  const today = () => bkkDate(new Date());
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monthKey = ymd => ymd.slice(0, 7);
  const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = ymd => Number(ymd.slice(8, 10)) + ' ' + MONTHS[Number(ymd.slice(5, 7)) - 1];
  const monthLabel = ym => MONTHS[Number(ym.slice(5, 7)) - 1];
  const saleDay = s => { const v = String(s.saleDate || ''); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bkkDate(new Date(s.saleDate || s.createdAt)); };
  // "nok", "Nok " and "NOK" are one person.
  const cleanName = n => { n = String(n || '').trim().replace(/\s+/g, ' '); return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : 'Unknown'; };
  const label = p => p.name + (p.size ? ' · ' + p.size : '');
  const SWATCHES = ['#B9825E', '#5E8A8C', '#A35F43', '#8E6B8F', '#7A6A55', '#6C6862', '#86956A', '#C48A6A', '#4F6D7A', '#9C7A4B'];
  const swatch = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SWATCHES[h % SWATCHES.length]; };
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode: fine */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const I = {
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    pot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10l-1 3a6 6 0 0 1 2 5v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5a6 6 0 0 1 2-5L7 4z"/></svg>',
    shirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/></svg>'
  };

  // ---------- back end (demo) ----------
  // Same calls the live script will answer. Every write here only changes the
  // in-memory sample data for this browser tab.
  const DemoBackend = {
    cache: {},
    load(shop) { if (!this.cache[shop]) this.cache[shop] = window.makeDemoData(shop); return this.cache[shop]; },
    reset(shop) { delete this.cache[shop]; return this.load(shop); },
    // Mirrors the live script: 5 wrong PINs in a row pause sign-in for everyone,
    // 15 minutes the first time, then 1 hour, then 24 hours. Phones that are
    // already signed in keep working.
    fails: 0, lockedUntil: 0, lockLevel: 0,
    login(pin) {
      const now = Date.now();
      if (now < this.lockedUntil) return { locked: Math.ceil((this.lockedUntil - now) / 60000) };
      const role = { '1111': 'staff', '2222': 'owner' }[pin];
      if (role) { this.fails = 0; this.lockLevel = 0; return { role }; }
      this.fails++;
      if (this.fails >= 5) {
        const mins = [15, 60, 1440][Math.min(this.lockLevel, 2)];
        this.lockLevel++; this.fails = 0; this.lockedUntil = now + mins * 60000;
        return { locked: mins };
      }
      return { left: 5 - this.fails };
    },
    addSale(shop, { productId, quantity, paymentMethod, soldBy, note }) {
      const d = this.load(shop);
      const p = d.products.find(x => x.id === productId);
      if (!p) throw new Error('That product no longer exists.');
      const q = Math.floor(num(quantity));
      if (q < 1) throw new Error('Enter a quantity of 1 or more.');
      if (q > num(p.quantity)) throw new Error('Only ' + num(p.quantity) + ' left on the shelf.');
      const now = new Date();
      // The server works out price and total, and saves today's cost with the sale.
      const sale = { id: 'SALE-' + now.getTime(), productId: p.id, productName: label(p), quantity: q, sellPrice: num(p.sellPrice), total: q * num(p.sellPrice), costPrice: num(p.costPrice) || undefined, paymentMethod, saleDate: bkkDate(now), soldBy, note, createdAt: now.toISOString() };
      d.sales.push(sale);
      p.quantity = num(p.quantity) - q;
      return sale;
    },
    addStock(shop, { productId, add, costPrice }) {
      const d = this.load(shop);
      const p = d.products.find(x => x.id === productId);
      if (!p) throw new Error('That product no longer exists.');
      const n = Math.floor(num(add));
      if (n < 1) throw new Error('Add at least 1 piece.');
      p.quantity = num(p.quantity) + n; // adds to the count, never overwrites it
      if (costPrice !== '' && costPrice != null && num(costPrice) >= 0) p.costPrice = num(costPrice);
      return p;
    },
    addProduct(shop, f) {
      const d = this.load(shop);
      const p = { id: 'PRD-' + Date.now(), name: f.name, size: f.size, costPrice: num(f.costPrice), sellPrice: num(f.sellPrice), quantity: Math.floor(num(f.quantity)), imageUrl: f.imageUrl || '', addedBy: f.addedBy || '', createdAt: new Date().toISOString() };
      d.products.push(p);
      return p;
    },
    updateProduct(shop, id, f) {
      const p = this.load(shop).products.find(x => x.id === id);
      if (!p) throw new Error('That product no longer exists.');
      Object.assign(p, { name: f.name, size: f.size, costPrice: num(f.costPrice), sellPrice: num(f.sellPrice), quantity: Math.floor(num(f.quantity)) });
      return p;
    },
    deleteProduct(shop, id) {
      const d = this.load(shop);
      d.products = d.products.filter(x => x.id !== id);
    }
  };

  // ---------- state ----------
  const SHOPS = { baan: { name: 'Baan 125', sub: 'Hangout · ceramics', icon: 'pot' }, chud: { name: 'ChudPak', sub: 'Clothing', icon: 'shirt' } };
  const S = {
    shop: store.get('b125_shop') || 'baan',
    role: store.get('b125_role'),
    route: null, pin: '', pinErr: '',
    settings: { lowAt: 2, staff: null },
    ui: { period: '30d', stockFilter: 'all', stockQ: '', staffTab: 'in', sellQ: '', salesPeriod: '30d', salesPay: 'all', salesQ: '' },
    lastSeller: store.get('b125_seller') || ''
  };
  // Appearance: 'auto' follows the device; 'light'/'dark' are saved on this device only.
  const THEME_KEY = 'b125_theme';
  const getTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } };
  function setTheme(t) {
    try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked: still apply for this visit */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  }
  const data = () => DemoBackend.load(S.shop);
  const staffNames = () => { if (!S.settings.staff) S.settings.staff = data().staff.slice(); return S.settings.staff; };
  const status = p => num(p.quantity) <= 0 ? 'out' : (num(p.quantity) <= S.settings.lowAt ? 'low' : 'ok');

  const ROUTES = {
    owner: [['dashboard', 'Dashboard', 'chart'], ['stock', 'Stock', 'box'], ['add', 'Add product', 'add'], ['sales', 'Sales', 'list'], ['settings', 'Settings', 'gear']],
    staff: [['stock', 'Stock', 'box'], ['sell', 'Sell', 'plus'], ['add', 'Add product', 'add']]
  };
  const allowed = r => ROUTES[S.role].some(x => x[0] === r);

  // ---------- numbers ----------
  function productIndex() {
    const byId = {}, byName = {};
    data().products.forEach(p => { byId[p.id] = p; byName[label(p)] = p; byName[p.name] = byName[p.name] || p; });
    return { byId, byName };
  }
  // Cost of one piece for a sale: the cost saved on the sale row if there is one,
  // otherwise today's cost price (an estimate), otherwise unknown.
  function costFor(s, idx) {
    if (num(s.costPrice) > 0) return { c: num(s.costPrice), est: false };
    const p = idx.byId[s.productId] || idx.byName[s.productName];
    if (p && num(p.costPrice) > 0) return { c: num(p.costPrice), est: true };
    return null;
  }
  function periodRange(key) {
    const t = today();
    const nowHour = bkkHour(new Date());
    switch (key) {
      case 'today': return { from: t, to: t, pFrom: addDays(t, -1), pTo: addDays(t, -1), label: 'Today', prevLabel: 'yesterday by this time', hourCap: nowHour };
      case '7d': return { from: addDays(t, -6), to: t, pFrom: addDays(t, -13), pTo: addDays(t, -7), label: 'Last 7 days', prevLabel: 'the 7 days before' };
      case '12m': { const m0 = addMonths(monthKey(t), -11) + '-01'; const p0 = addMonths(monthKey(t), -23) + '-01'; return { from: m0, to: t, pFrom: p0, pTo: addDays(m0, -1), label: 'Last 12 months', prevLabel: 'the 12 months before' }; }
      case 'all': return { from: '0000-00-00', to: t, label: 'All time' };
      default: return { from: addDays(t, -29), to: t, pFrom: addDays(t, -59), pTo: addDays(t, -30), label: 'Last 30 days', prevLabel: 'the 30 days before' };
    }
  }
  const inRange = (s, a, b) => { const d = saleDay(s); return d >= a && d <= b; };

  function stats(key) {
    const R = periodRange(key);
    const idx = productIndex();
    const sales = data().sales;
    const cur = sales.filter(s => inRange(s, R.from, R.to));
    const prev = R.pFrom ? sales.filter(s => inRange(s, R.pFrom, R.pTo) && (R.hourCap == null || bkkHour(new Date(s.createdAt)) <= R.hourCap)) : [];
    const revenue = cur.reduce((a, s) => a + num(s.total), 0);
    const prevRevenue = prev.reduce((a, s) => a + num(s.total), 0);
    let costedRev = 0, cogs = 0, unknownN = 0, unknownRev = 0, estN = 0, units = 0, cash = 0;
    const byProduct = {}, byStaff = {};
    cur.forEach(s => {
      const q = num(s.quantity) || 1;
      units += q;
      if (String(s.paymentMethod).toLowerCase() === 'cash') cash += num(s.total);
      const c = costFor(s, idx);
      if (c) { costedRev += num(s.total); cogs += c.c * q; if (c.est) estN++; } else { unknownN++; unknownRev += num(s.total); }
      const pk = s.productName || 'Unknown';
      (byProduct[pk] = byProduct[pk] || { name: pk, units: 0, rev: 0 }); byProduct[pk].units += q; byProduct[pk].rev += num(s.total);
      const sk = cleanName(s.soldBy);
      (byStaff[sk] = byStaff[sk] || { name: sk, n: 0, rev: 0 }); byStaff[sk].n++; byStaff[sk].rev += num(s.total);
    });
    const profit = costedRev - cogs;

    // chart buckets
    let buckets = [];
    if (key === 'today') {
      for (let h = 10; h <= 21; h++) buckets.push({ k: h, label: h + ':00', v: 0 });
      cur.forEach(s => { const h = bkkHour(new Date(s.createdAt)); const b = buckets.find(x => x.k === Math.min(21, Math.max(10, h))); b.v += num(s.total); });
    } else if (key === '12m') {
      for (let i = 11; i >= 0; i--) { const m = addMonths(monthKey(today()), -i); buckets.push({ k: m, label: monthLabel(m), v: 0 }); }
      cur.forEach(s => { const b = buckets.find(x => x.k === monthKey(saleDay(s))); if (b) b.v += num(s.total); });
    } else {
      const n = key === '7d' ? 7 : 30;
      for (let i = n - 1; i >= 0; i--) { const d = addDays(today(), -i); buckets.push({ k: d, label: key === '7d' ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) : dayLabel(d), v: 0 }); }
      const map = {}; buckets.forEach(b => { map[b.k] = b; });
      cur.forEach(s => { const b = map[saleDay(s)]; if (b) b.v += num(s.total); });
    }

    // shelf: what's in stock right now
    const prods = data().products;
    let atCost = 0, atSell = 0, potential = 0, noCostInStock = 0;
    prods.forEach(p => {
      const q = Math.max(0, num(p.quantity));
      atSell += q * num(p.sellPrice);
      if (num(p.costPrice) > 0) { atCost += q * num(p.costPrice); potential += q * (num(p.sellPrice) - num(p.costPrice)); } else if (q > 0) noCostInStock++;
    });
    const counts = { ok: 0, low: 0, out: 0 };
    prods.forEach(p => counts[status(p)]++);

    return {
      R, revenue, prevRevenue, n: cur.length, units, cash, credit: revenue - cash,
      profit, margin: costedRev ? profit / costedRev : 0, costedRev, unknownN, unknownRev, estN,
      top: Object.values(byProduct).sort((a, b) => b.rev - a.rev).slice(0, 5),
      staff: Object.values(byStaff).sort((a, b) => b.rev - a.rev),
      buckets, atCost, atSell, potential, noCostInStock, counts,
      noCost: prods.filter(p => num(p.costPrice) <= 0),
      low: prods.filter(p => status(p) === 'low').sort((a, b) => num(a.quantity) - num(b.quantity))
    };
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e;
    return 10 * e;
  }

  // ---------- rendering ----------
  const app = $('#app');
  function render() {
    if (!S.role) return renderSignIn();
    if (!S.route || !allowed(S.route)) S.route = ROUTES[S.role][0][0];
    const shop = SHOPS[S.shop];
    const nav = ROUTES[S.role];
    const sideLinks = nav.filter(r => r[0] !== 'sell').map(([k, t, ic]) => `<button type="button" class="side-link" data-go="${k}" ${S.route === k ? 'aria-current="page"' : ''}>${I[ic]}${esc(t)}</button>`).join('');
    const mobile = S.role === 'owner'
      ? [['dashboard', 'Dashboard', 'chart'], ['stock', 'Stock', 'box'], ['SELL'], ['sales', 'Sales', 'list'], ['settings', 'Settings', 'gear']]
      : [['stock', 'Stock', 'box'], ['SELL'], ['add', 'Add', 'add']];
    const bottom = mobile.map(r => r[0] === 'SELL'
      ? `<button type="button" class="nav-btn sell" data-act="sell"><span class="fab">${I.plus}</span>Sell</button>`
      : `<button type="button" class="nav-btn" data-go="${r[0]}" ${S.route === r[0] ? 'aria-current="page"' : ''}>${I[r[2]]}${esc(r[1])}</button>`).join('');
    app.innerHTML = `
      <div class="demo-strip">Demo mode · sample data only · nothing here touches the real shop sheet</div>
      <div class="shell">
        <aside class="sidebar" aria-label="Main">
          <div class="brand">${esc(shop.name)}</div>
          <div class="brand-sub">${S.role === 'owner' ? 'Owner' : 'Staff'} · ${esc(shop.sub)}</div>
          <button type="button" class="side-sell" data-act="sell">${I.plus}Record a sale</button>
          ${sideLinks}
          <div class="side-foot">
            <button type="button" class="side-link" data-act="signout">${I.out}Sign out</button>
          </div>
        </aside>
        <div class="content">
          <header class="topbar">
            <div><div class="brand">${esc(shop.name)}</div><div class="brand-sub">${S.role === 'owner' ? 'Owner' : 'Staff'} · ${esc(shop.sub)}</div></div>
            <button type="button" class="icon-btn" data-act="signout" aria-label="Sign out">${I.out}</button>
          </header>
          <main class="main" id="view"></main>
        </div>
      </div>
      <nav class="bottom-nav" aria-label="Main">${bottom}</nav>
      <div id="sheet-root"></div>`;
    renderView();
  }

  function renderView() {
    const v = $('#view');
    if (!v) return;
    const fn = { dashboard: viewDashboard, stock: S.role === 'owner' ? viewOwnerStock : viewStaffStock, add: viewAdd, sales: viewSales, settings: viewSettings, sell: viewSell }[S.route];
    v.innerHTML = fn();
    afterView();
  }
  function afterView() {
    if (S.route === 'stock' && S.role === 'owner') fillOwnerStock();
    if (S.route === 'stock' && S.role === 'staff') fillStaffStock();
    if (S.route === 'sell') fillSell();
    if (S.route === 'sales') fillSales();
  }

  // ----- sign in -----
  function renderSignIn() {
    const dots = [0, 1, 2, 3].map(i => `<span class="${i < S.pin.length ? 'on' : ''}"></span>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k =>
      `<button type="button" class="${k === 'C' || k === '⌫' ? 'ghost' : ''}" data-key="${k}" aria-label="${k === '⌫' ? 'Delete' : (k === 'C' ? 'Clear' : k)}">${k === 'C' ? 'Clear' : k}</button>`).join('');
    app.innerHTML = `
      <div class="signin">
        <div class="signin-box">
          <h1>${esc(SHOPS[S.shop].name)}</h1>
          <div class="seg" role="group" aria-label="Shop">
            ${Object.entries(SHOPS).map(([k, s]) => `<button type="button" data-shop="${k}" aria-pressed="${S.shop === k}">${esc(s.name)}</button>`).join('')}
          </div>
          <div style="color:var(--brand-dark-muted);font-size:14px">Enter your PIN</div>
          <div class="pin-dots" role="img" aria-label="${S.pin.length} of 4 digits entered">${dots}</div>
          <div class="pin-err" role="alert">${esc(S.pinErr)}</div>
          <div class="keypad">${keys}</div>
          <p class="signin-hint">Demo PINs: 1111 for staff, 2222 for owner. In the live app the shop's script checks the PIN, so it never sits in this page. Five wrong PINs pause sign-in.</p>
        </div>
      </div>`;
  }
  function pressKey(k) {
    if (k === '⌫') S.pin = S.pin.slice(0, -1);
    else if (k === 'C') S.pin = '';
    else if (S.pin.length < 4) S.pin += k;
    S.pinErr = '';
    if (S.pin.length === 4) {
      const r = DemoBackend.login(S.pin);
      S.pin = '';
      if (r.role) { S.role = r.role; store.set('b125_role', r.role); store.set('b125_shop', S.shop); S.route = null; return render(); }
      if (r.locked) S.pinErr = `Too many wrong PINs. Sign-in is paused for ${r.locked >= 60 ? Math.round(r.locked / 60) + (r.locked >= 120 ? ' hours' : ' hour') : r.locked + ' minutes'}.`;
      else S.pinErr = `That PIN didn’t match. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left before sign-in pauses.`;
    }
    renderSignIn();
  }

  // ----- dashboard -----
  function viewDashboard() {
    const st = stats(S.ui.period);
    const periods = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 mo']];
    let delta = '<span class="delta flat">No earlier sales</span>';
    if (st.prevRevenue > 0) {
      const d = (st.revenue - st.prevRevenue) / st.prevRevenue * 100;
      delta = `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span>`;
    }
    const max = niceMax(Math.max(...st.buckets.map(b => b.v)));
    const bars = st.buckets.map((b, i) => `<div class="bar${i === st.buckets.length - 1 ? ' hi' : ''}" style="height:${(b.v / max * 100).toFixed(1)}%" title="${esc(b.label)}: ${money(b.v)}"></div>`).join('');
    const mid = Math.floor(st.buckets.length / 2);
    const cashPct = pct(st.cash, st.revenue);
    const topMax = Math.max(1, ...st.top.map(t => t.rev));
    const missing = st.noCost.length;
    const notice = missing || st.unknownN ? `
      <div class="notice">${I.warn}<div>
        <b>${missing} product${missing === 1 ? '' : 's'} ${missing === 1 ? 'has' : 'have'} no cost price</b>
        <span>${st.unknownN ? `${st.unknownN} sale${st.unknownN === 1 ? '' : 's'} in this period (${money(st.unknownRev)}) can’t be costed, so ${st.unknownN === 1 ? 'it is' : 'they are'} left out of profit and margin.` : 'Add them so new sales can be costed.'}</span>
        <button type="button" class="link-btn" data-go="stock" data-filter="nocost">Add cost prices</button>
      </div></div>` : '';
    return `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="muted small">${esc(st.R.label)}</div></div>
        <div class="seg" role="group" aria-label="Time period" style="max-width:420px">
          ${periods.map(([k, t]) => `<button type="button" data-period="${k}" aria-pressed="${S.ui.period === k}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="dash">
        <section class="hero" aria-label="Revenue">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="display:flex;flex-direction:column;gap:4px"><span class="eyebrow">Revenue · ${esc(st.R.label.toLowerCase())}</span><span class="big">${money(st.revenue)}</span></div>
            ${delta}
          </div>
          <div class="vs">${st.prevRevenue > 0 ? `vs ${money(st.prevRevenue)} ${esc(st.R.prevLabel)}` : '&nbsp;'}</div>
          <div class="chart" role="img" aria-label="Revenue by ${S.ui.period === '12m' ? 'month' : (S.ui.period === 'today' ? 'hour' : 'day')}, highest ${money(Math.max(...st.buckets.map(b => b.v)))}">
            <div class="yaxis"><span style="top:0">${moneyShort(max)}</span><span style="top:50%">${moneyShort(max / 2)}</span><span style="top:100%">฿0</span></div>
            <div class="plot"><div class="grid-line" style="top:0"></div><div class="grid-line" style="top:50%"></div><div class="bars">${bars}</div></div>
          </div>
          <div class="xaxis"><span>${esc(st.buckets[0].label)}</span><span>${esc(st.buckets[mid].label)}</span><span>${esc(st.buckets[st.buckets.length - 1].label)}</span></div>
        </section>

        <section class="kpis" aria-label="Key numbers">
          <div class="kpi"><span class="label">Gross profit</span><span class="value good">${money(st.profit)}</span><span class="sub">${st.estN ? `${st.estN} sale${st.estN === 1 ? '' : 's'} costed at today’s price` : 'from saved cost prices'}</span></div>
          <div class="kpi"><span class="label">Margin</span><span class="value">${Math.round(st.margin * 100)}%</span><div class="meter"><i style="width:${Math.round(st.margin * 100)}%"></i></div></div>
          <div class="kpi"><span class="label">Sales</span><span class="value">${st.n.toLocaleString('en-US')}</span><span class="sub">${st.units.toLocaleString('en-US')} items</span></div>
          <div class="kpi"><span class="label">Average sale</span><span class="value">${money(st.n ? st.revenue / st.n : 0)}</span><span class="sub">per transaction</span></div>
        </section>

        <div class="side-stack">
          <section class="card">
            <h2>How people paid</h2>
            <div class="split" role="img" aria-label="Cash ${cashPct} percent, card or QR ${100 - cashPct} percent"><i style="width:${cashPct}%;background:var(--cash)"></i><i style="flex:1;background:var(--card)"></i></div>
            <div class="legend">
              <div><span class="sw" style="background:var(--cash)"></span><span class="muted">Cash · ${cashPct}%</span><b>${money(st.cash)}</b></div>
              <div><span class="sw" style="background:var(--card)"></span><span class="muted">Card / QR · ${100 - cashPct}%</span><b>${money(st.credit)}</b></div>
            </div>
          </section>
          ${notice}
        </div>

        <section class="card w4">
          <div class="card-head"><h2>Best sellers</h2><button type="button" class="link-btn" data-go="sales">All sales</button></div>
          ${st.top.length ? st.top.map(t => `<div class="rank"><div class="rank-row"><span>${esc(t.name)}</span><span class="muted">${t.units} sold · <b style="color:var(--ink)">${money(t.rev)}</b></span></div><div class="rank-bar"><i style="width:${(t.rev / topMax * 100).toFixed(1)}%"></i></div></div>`).join('') : '<p class="muted">No sales in this period yet.</p>'}
        </section>

        <section class="card w4">
          <div><h2>Stock on the shelves</h2><div class="muted small">What you hold right now. This is not money earned.</div></div>
          <div class="shelf">
            <div><span>At cost</span><b>${money(st.atCost)}</b></div>
            <div><span>At sell price</span><b>${money(st.atSell)}</b></div>
            <div class="pos"><span>Profit if all sells</span><b>+${money(st.potential)}</b></div>
          </div>
          ${st.noCostInStock ? `<div class="muted small">${st.noCostInStock} product${st.noCostInStock === 1 ? '' : 's'} in stock with no cost price ${st.noCostInStock === 1 ? 'is' : 'are'} not in "at cost" or "profit".</div>` : ''}
          <div class="counts">
            <button type="button" class="count-btn" data-go="stock" data-filter="ok"><b>${st.counts.ok}</b>in stock</button>
            <button type="button" class="count-btn low" data-go="stock" data-filter="low"><b>${st.counts.low}</b>running low</button>
            <button type="button" class="count-btn out" data-go="stock" data-filter="out"><b>${st.counts.out}</b>sold out</button>
          </div>
        </section>

        <section class="card w4">
          <h2>By staff</h2>
          ${st.staff.length ? st.staff.map(s => `<div class="staff-row"><span style="display:flex;align-items:center"><span class="avatar">${esc(s.name[0])}</span>${esc(s.name)}</span><span class="muted">${s.n} sales · <b style="color:var(--ink)">${money(s.rev)}</b></span></div>`).join('') : '<p class="muted">No sales in this period yet.</p>'}
        </section>
      </div>`;
  }

  // ----- owner stock -----
  function viewOwnerStock() {
    const prods = data().products;
    const inStock = prods.filter(p => num(p.quantity) > 0).length;
    return `
      <div class="page-head">
        <div><h1>Stock</h1><div class="muted small">${prods.length} products · ${inStock} in stock</div></div>
        <button type="button" class="btn dark" data-go="add">${I.plus}New product</button>
      </div>
      <div class="toolbar">
        <label class="search">${I.search}<span class="sr-only">Search products</span><input id="stock-q" type="search" placeholder="Search products" value="${esc(S.ui.stockQ)}" data-input="stockQ"></label>
        <div class="chips" role="group" aria-label="Filter" id="stock-chips"></div>
      </div>
      <ul class="list" id="stock-list"></ul>`;
  }
  function fillOwnerStock() {
    const prods = data().products;
    const c = { all: prods.length, ok: 0, low: 0, out: 0, nocost: 0 };
    prods.forEach(p => { c[status(p)]++; if (num(p.costPrice) <= 0) c.nocost++; });
    const defs = [['all', 'All'], ['ok', 'In stock'], ['low', 'Running low'], ['out', 'Sold out'], ['nocost', 'No cost price']];
    $('#stock-chips').innerHTML = defs.filter(d => d[0] !== 'nocost' || c.nocost).map(([k, t]) => `<button type="button" class="chip" data-filter-chip="${k}" aria-pressed="${S.ui.stockFilter === k}">${t}<span class="count">${c[k]}</span></button>`).join('');
    const q = S.ui.stockQ.trim().toLowerCase();
    const f = S.ui.stockFilter;
    const list = prods.filter(p => (f === 'all' || (f === 'nocost' ? num(p.costPrice) <= 0 : status(p) === f)) && label(p).toLowerCase().includes(q))
      .sort((a, b) => f === 'low' ? num(a.quantity) - num(b.quantity) : label(a).localeCompare(label(b)));
    const maxQ = Math.max(10, ...prods.map(p => num(p.quantity)));
    $('#stock-list').innerHTML = list.length ? list.map(p => {
      const st = status(p);
      const cost = num(p.costPrice);
      const margin = cost > 0 && num(p.sellPrice) > 0 ? Math.round((p.sellPrice - cost) / p.sellPrice * 100) + '% margin' : '<b class="tone-low">no cost price</b>';
      return `<li class="row">
        ${thumb(p)}
        <button type="button" class="row-body" data-edit="${esc(p.id)}" aria-label="Edit ${esc(label(p))}">
          <span class="row-title">${esc(label(p))}</span>
          <span class="row-sub">${money(p.sellPrice)} · cost ${cost > 0 ? money(cost) : '—'} · ${margin}</span>
          <span class="stockbar"><span class="track"><i class="fill-${st}" style="width:${Math.min(100, num(p.quantity) / maxQ * 100).toFixed(0)}%"></i></span><b class="tone-${st}">${st === 'out' ? 'Sold out' : num(p.quantity) + ' left'}</b></span>
        </button>
        <button type="button" class="btn" data-restock="${esc(p.id)}" aria-label="Add stock for ${esc(label(p))}">+ Stock</button>
      </li>`;
    }).join('') : `<li class="empty">${q ? 'No product matches that search.' : 'Nothing here.'}</li>`;
  }
  function thumb(p, cls) {
    const img = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : I[SHOPS[S.shop].icon];
    return `<div class="thumb ${cls || ''}" style="background:${swatch(p.name)}">${img}</div>`;
  }

  // ----- staff stock -----
  function viewStaffStock() {
    const prods = data().products;
    const nIn = prods.filter(p => num(p.quantity) > 0).length;
    return `
      <div class="page-head"><div><h1>Stock</h1><div class="muted small">Tap an item to sell it</div></div></div>
      <div class="seg" role="tablist" aria-label="Stock" style="max-width:420px">
        <button type="button" role="tab" data-stafftab="in" aria-pressed="${S.ui.staffTab === 'in'}" aria-selected="${S.ui.staffTab === 'in'}">In stock · ${nIn}</button>
        <button type="button" role="tab" data-stafftab="out" aria-pressed="${S.ui.staffTab === 'out'}" aria-selected="${S.ui.staffTab === 'out'}">Sold out · ${prods.length - nIn}</button>
      </div>
      <label class="search">${I.search}<span class="sr-only">Search products</span><input id="staff-q" type="search" placeholder="Search" value="${esc(S.ui.stockQ)}" data-input="stockQ"></label>
      <div class="gallery" id="staff-gallery"></div>`;
  }
  function lastSold() {
    const m = {};
    data().sales.forEach(s => { const d = saleDay(s); if (!m[s.productId] || d > m[s.productId]) m[s.productId] = d; });
    return m;
  }
  function tile(p, last) {
    const st = status(p);
    const badge = st === 'out' ? '<span class="badge out">Sold out</span>' : `<span class="badge ${st === 'low' ? 'low' : ''}">${num(p.quantity)} left</span>`;
    const sub = st === 'out' ? (last ? 'Last sold ' + dayLabel(last) : 'Sold out') : 'Tap to sell';
    const inner = `<div class="pic" style="background:${swatch(p.name)}">${p.imageUrl ? '' : I[SHOPS[S.shop].icon]}${badge}</div><div class="meta"><b>${esc(label(p))}</b><span class="price">${money(p.sellPrice)}</span><span class="muted small">${sub}</span></div>`;
    return st === 'out' ? `<div class="tile out">${inner}</div>` : `<button type="button" class="tile" data-sell="${esc(p.id)}" aria-label="Sell ${esc(label(p))}">${inner}</button>`;
  }
  function fillStaffStock() {
    const q = S.ui.stockQ.trim().toLowerCase();
    const last = lastSold();
    const list = data().products.filter(p => (S.ui.staffTab === 'in' ? num(p.quantity) > 0 : num(p.quantity) <= 0) && label(p).toLowerCase().includes(q))
      .sort((a, b) => S.ui.staffTab === 'out' ? String(last[b.id] || '').localeCompare(String(last[a.id] || '')) : label(a).localeCompare(label(b)));
    $('#staff-gallery').innerHTML = list.length ? list.map(p => tile(p, last[p.id])).join('') : `<p class="empty">${q ? 'No product matches that search.' : (S.ui.staffTab === 'in' ? 'Nothing in stock.' : 'Nothing is sold out.')}</p>`;
  }

  // ----- sell page (staff) -----
  function viewSell() {
    return `
      <div class="page-head"><div><h1>Sell</h1><div class="muted small">Pick what the customer is buying</div></div></div>
      <label class="search">${I.search}<span class="sr-only">Search products</span><input id="sell-q" type="search" placeholder="Search" value="${esc(S.ui.sellQ)}" data-input="sellQ"></label>
      <div class="gallery" id="sell-gallery"></div>`;
  }
  function fillSell() {
    const q = S.ui.sellQ.trim().toLowerCase();
    const list = data().products.filter(p => num(p.quantity) > 0 && label(p).toLowerCase().includes(q)).sort((a, b) => label(a).localeCompare(label(b)));
    $('#sell-gallery').innerHTML = list.length ? list.map(p => tile(p)).join('') : '<p class="empty">No product matches that search.</p>';
  }

  // ----- add product -----
  function viewAdd() {
    return `
      <div class="page-head"><div><h1>Add product</h1><div class="muted small">New item for ${esc(SHOPS[S.shop].name)}</div></div></div>
      <form class="card" id="add-form" style="max-width:620px" novalidate>
        <div class="pick">
          <div class="thumb" id="add-preview" style="width:84px;height:84px;background:var(--surface-2);color:var(--muted)">${I[SHOPS[S.shop].icon]}</div>
          <label class="btn" for="add-photo">Choose photo</label>
          <input id="add-photo" type="file" accept="image/*" class="sr-only">
        </div>
        <label class="field" for="add-name">Product name<input id="add-name" name="name" required placeholder="e.g. Lotus mug"></label>
        <label class="field" for="add-size">Size<input id="add-size" name="size" placeholder="e.g. 300ml"></label>
        <div class="grid-2">
          <label class="field" for="add-cost">Cost price (฿)<input id="add-cost" name="costPrice" type="number" min="0" inputmode="decimal" placeholder="150"></label>
          <label class="field" for="add-sell">Sell price (฿)<input id="add-sell" name="sellPrice" type="number" min="0" inputmode="decimal" placeholder="450" required></label>
        </div>
        <label class="field" for="add-qty">Quantity<input id="add-qty" name="quantity" type="number" min="0" inputmode="numeric" placeholder="10" required></label>
        <div class="muted small" id="add-margin" aria-live="polite"></div>
        <div class="pin-err" id="add-err" role="alert" style="color:var(--bad)"></div>
        <button type="submit" class="btn primary block">Add product</button>
      </form>`;
  }

  // ----- sales (owner) -----
  function viewSales() {
    const periods = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 mo'], ['all', 'All']];
    return `
      <div class="page-head">
        <div><h1>Sales</h1><div class="muted small" id="sales-sum"></div></div>
        <button type="button" class="btn" data-act="export">Export to Excel</button>
      </div>
      <div class="seg" role="group" aria-label="Time period" style="max-width:520px">${periods.map(([k, t]) => `<button type="button" data-salesperiod="${k}" aria-pressed="${S.ui.salesPeriod === k}">${t}</button>`).join('')}</div>
      <div class="toolbar">
        <label class="search">${I.search}<span class="sr-only">Search sales</span><input id="sales-q" type="search" placeholder="Product, staff or note" value="${esc(S.ui.salesQ)}" data-input="salesQ"></label>
        <div class="chips" role="group" aria-label="Payment">${[['all', 'All'], ['cash', 'Cash'], ['credit', 'Card / QR']].map(([k, t]) => `<button type="button" class="chip" data-pay="${k}" aria-pressed="${S.ui.salesPay === k}">${t}</button>`).join('')}</div>
      </div>
      <div class="table-wrap" id="sales-table"></div>`;
  }
  function fillSales() {
    const R = periodRange(S.ui.salesPeriod);
    const q = S.ui.salesQ.trim().toLowerCase();
    const rows = data().sales.filter(s => inRange(s, R.from, R.to)
      && (S.ui.salesPay === 'all' || String(s.paymentMethod).toLowerCase() === S.ui.salesPay)
      && (!q || [s.productName, s.soldBy, s.note].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = rows.reduce((a, s) => a + num(s.total), 0);
    const items = rows.reduce((a, s) => a + (num(s.quantity) || 1), 0);
    $('#sales-sum').textContent = `${R.label} · ${rows.length.toLocaleString('en-US')} sales · ${money(total)}`;
    const shown = rows.slice(0, 300);
    $('#sales-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>Date</th><th>Product</th><th class="num">Qty</th><th class="num">Total</th><th>Paid</th><th>Staff</th><th>Note</th></tr></thead>
        <tbody>${shown.map(s => `<tr><td>${dayLabel(saleDay(s))}</td><td>${esc(s.productName)}</td><td class="num">${num(s.quantity) || 1}</td><td class="num">${money(s.total)}</td><td><span class="pill ${String(s.paymentMethod).toLowerCase() === 'cash' ? 'cash' : 'credit'}">${String(s.paymentMethod).toLowerCase() === 'cash' ? 'Cash' : 'Card / QR'}</span></td><td>${esc(cleanName(s.soldBy))}</td><td class="muted">${esc(s.note || '')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">${rows.length > 300 ? `Showing newest 300 of ${rows.length.toLocaleString('en-US')}` : 'Total'}</td><td class="num">${items.toLocaleString('en-US')}</td><td class="num">${money(total)}</td><td colspan="3"></td></tr></tfoot>
      </table>` : '<p class="empty">No sales match.</p>';
  }

  // ----- settings (owner) -----
  function viewSettings() {
    const names = staffNames();
    return `
      <div class="page-head"><div><h1>Settings</h1><div class="muted small">Only the owner PIN opens this page</div></div></div>
      <div class="settings-grid">
        <section class="card">
          <h2>Access</h2>
          <div>
            <div class="set-row"><div><b>Owner PIN</b><small>Everything, including this page</small></div><button type="button" class="btn" data-act="demo-only">Change</button></div>
            <div class="set-row"><div><b>Staff PIN</b><small>Stock, add product and sell</small></div><button type="button" class="btn" data-act="demo-only">Change</button></div>
            <div class="set-row"><div><b>Signed-in phones</b><small>Sign every phone out, for example after a staff change</small></div><button type="button" class="btn danger" data-act="demo-only">Sign all out</button></div>
          </div>
        </section>
        <section class="card">
          <h2>Staff names</h2>
          <p class="muted small" style="margin:0">Staff tap their name when they sell, so reports don’t split one person into "Nok" and "nok".</p>
          <div class="chips">${names.map((n, i) => `<span class="name-chip">${esc(n)}<button type="button" data-rmstaff="${i}" aria-label="Remove ${esc(n)}">${I.close}</button></span>`).join('')}</div>
          <form id="staff-form" class="toolbar" novalidate>
            <label class="field" for="staff-new" style="flex:1 1 180px">Add a name<input id="staff-new" placeholder="e.g. Ploy" maxlength="30"></label>
            <button type="submit" class="btn" style="align-self:flex-end">Add</button>
          </form>
        </section>
        <section class="card">
          <h2>Shop rules</h2>
          <div>
            <div class="set-row"><div><b>"Running low" at</b><small>Flag a product on the dashboard and stock list</small></div>
              <label class="field" for="low-at" style="flex-direction:row;align-items:center"><span class="sr-only">Running low at</span><select id="low-at">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${S.settings.lowAt === n ? 'selected' : ''}>${n} or fewer</option>`).join('')}</select></label></div>
            <div class="set-row"><div><b>Payment types</b><small>Shown when recording a sale</small></div><span class="muted">Cash · Card / QR</span></div>
          </div>
        </section>
        <section class="card">
          <h2>Email reports</h2>
          <div>
            <div class="set-row"><div><b>Daily summary</b><small>Every night at 23:30</small></div><span class="pill cash">On</span></div>
            <div class="set-row"><div><b>Monthly report</b><small>1st of each month, 10:30</small></div><span class="pill cash">On</span></div>
          </div>
        </section>
        <section class="card">
          <h2>Appearance</h2>
          <div class="set-row"><div><b>Light or dark</b><small>Automatic follows this phone or laptop. Saved on this device only.</small></div></div>
          <div class="seg" role="group" aria-label="Appearance" style="max-width:360px">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, t]) => `<button type="button" data-themepick="${k}" aria-pressed="${getTheme() === k}">${t}</button>`).join('')}</div>
        </section>
        <section class="card">
          <h2>Demo</h2>
          <div class="set-row"><div><b>Reset sample data</b><small>Undo test sales and restocks in this demo</small></div><button type="button" class="btn" data-act="reset">Reset</button></div>
        </section>
      </div>`;
  }

  // ---------- sheets (sell, restock, edit) ----------
  function openSheet(html, focusSel) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="overlay" data-scrim="1"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    const f = focusSel ? $(focusSel, root) : $('.sheet button, .sheet input', root);
    if (f) f.focus();
  }
  function closeSheet() { const r = $('#sheet-root'); if (r) r.innerHTML = ''; }
  const sheetHead = (title, sub, p) => `<div class="grab" aria-hidden="true"></div><div class="sheet-head">${p ? thumb(p) : ''}<div style="flex:1 1 auto;min-width:0"><h2>${esc(title)}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button type="button" class="icon-btn" data-act="close" aria-label="Close">${I.close}</button></div>`;

  let sell = null;
  function openSell(productId) {
    const inStock = data().products.filter(p => num(p.quantity) > 0).sort((a, b) => label(a).localeCompare(label(b)));
    if (!inStock.length) return toast('Nothing is in stock to sell.');
    const names = staffNames();
    sell = { productId: productId || '', qty: 1, pay: 'cash', who: names.includes(S.lastSeller) ? S.lastSeller : (S.role === 'owner' && names.includes('Owner') ? 'Owner' : '') };
    drawSell();
  }
  function drawSell() {
    const p = data().products.find(x => x.id === sell.productId);
    const inStock = data().products.filter(x => num(x.quantity) > 0).sort((a, b) => label(a).localeCompare(label(b)));
    const max = p ? num(p.quantity) : 1;
    sell.qty = Math.min(Math.max(1, sell.qty), Math.max(1, max));
    const total = p ? sell.qty * num(p.sellPrice) : 0;
    openSheet(`
      ${sheetHead('Record a sale', p ? `${money(p.sellPrice)} each · ${num(p.quantity)} left` : 'Choose the product', p)}
      <label class="field" for="sell-product">Product
        <select id="sell-product"><option value="">Choose…</option>${inStock.map(x => `<option value="${esc(x.id)}" ${x.id === sell.productId ? 'selected' : ''}>${esc(label(x))} · ${money(x.sellPrice)} · ${num(x.quantity)} left</option>`).join('')}</select>
      </label>
      <div class="panel"><div class="sum-row" style="align-items:center"><span style="font-weight:600">Quantity</span>
        <div class="stepper" style="gap:14px"><button type="button" data-qty="-1" aria-label="One fewer" style="width:44px;height:44px">−</button><output style="font-size:30px;min-width:40px" aria-live="polite">${sell.qty}</output><button type="button" class="plus" data-qty="1" aria-label="One more" style="width:44px;height:44px" ${!p || sell.qty >= max ? 'disabled' : ''}>+</button></div></div></div>
      <div class="field">Paid by<div class="seg" role="group" aria-label="Payment">${[['cash', 'Cash'], ['credit', 'Card / QR']].map(([k, t]) => `<button type="button" data-paywith="${k}" aria-pressed="${sell.pay === k}">${t}</button>`).join('')}</div></div>
      <div class="field">Sold by<div class="chips" role="group" aria-label="Staff">${staffNames().map(n => `<button type="button" class="chip" data-who="${esc(n)}" aria-pressed="${sell.who === n}">${esc(n)}</button>`).join('')}</div></div>
      <label class="field" for="sell-note">Note (optional)<textarea id="sell-note" rows="2" maxlength="300" placeholder="Discount, gift wrap, customer request">${esc(sell.note || '')}</textarea></label>
      <div class="pin-err" id="sell-err" role="alert" style="color:var(--bad)"></div>
      <div class="sum-row"><span class="muted">${sell.qty} × ${p ? money(p.sellPrice) : '—'} · ${sell.pay === 'cash' ? 'Cash' : 'Card / QR'}</span><b>${money(total)}</b></div>
      <button type="button" class="btn primary block" data-act="save-sale">Save sale · ${money(total)}</button>`, '#sell-product');
  }
  function saveSale() {
    const err = m => { $('#sell-err').textContent = m; };
    if (!sell.productId) return err('Choose the product first.');
    if (!sell.who) return err('Tap your name under "Sold by".');
    try {
      const s = DemoBackend.addSale(S.shop, { productId: sell.productId, quantity: sell.qty, paymentMethod: sell.pay, soldBy: sell.who, note: ($('#sell-note').value || '').trim() });
      S.lastSeller = sell.who; store.set('b125_seller', sell.who);
      closeSheet(); renderView(); toast('Sale saved · ' + money(s.total));
    } catch (e) { err(e.message); }
  }

  let restock = null;
  function openRestock(id) {
    const p = data().products.find(x => x.id === id);
    if (!p) return;
    restock = { id, add: 6, cost: num(p.costPrice) > 0 ? num(p.costPrice) : '' };
    drawRestock();
  }
  function drawRestock() {
    const p = data().products.find(x => x.id === restock.id);
    openSheet(`
      ${sheetHead(label(p), `${num(p.quantity)} on the shelf · sells for ${money(p.sellPrice)}`, p)}
      <div class="panel" style="align-items:center">
        <div class="muted">How many new pieces arrived?</div>
        <div class="stepper"><button type="button" data-add="-1" aria-label="One fewer">−</button><output aria-live="polite">${restock.add}</output><button type="button" class="plus" data-add="1" aria-label="One more">+</button></div>
        <div class="chips">${[6, 12, 24].map(n => `<button type="button" class="chip" data-addset="${n}">+${n}</button>`).join('')}</div>
        <div>Shelf after saving: <b>${num(p.quantity) + restock.add}</b></div>
      </div>
      <label class="field" for="restock-cost">Cost per piece for this batch (฿)<input id="restock-cost" type="number" min="0" inputmode="decimal" value="${esc(restock.cost)}" placeholder="Cost price"><span class="hint">Saved with each sale from now on, so profit stays right if the price changes later.</span></label>
      <div class="pin-err" id="restock-err" role="alert" style="color:var(--bad)"></div>
      <button type="button" class="btn primary block" data-act="save-restock">Add ${restock.add} to stock</button>
      <p class="muted small" style="margin:0;text-align:center">This adds to the current count. It never overwrites it, so a sale made at the same moment isn’t lost.</p>`);
  }
  function saveRestock() {
    try {
      const cost = $('#restock-cost').value;
      const p = DemoBackend.addStock(S.shop, { productId: restock.id, add: restock.add, costPrice: cost });
      closeSheet(); renderView(); toast(`Added ${restock.add} · ${num(p.quantity)} on the shelf`);
    } catch (e) { $('#restock-err').textContent = e.message; }
  }

  let editing = null;
  function openEdit(id) {
    const p = data().products.find(x => x.id === id);
    if (!p) return;
    editing = { id, confirmDelete: false };
    openSheet(`
      ${sheetHead('Edit product', esc(label(p)), p)}
      <form id="edit-form" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <label class="field" for="edit-name">Product name<input id="edit-name" name="name" value="${esc(p.name)}" required></label>
        <label class="field" for="edit-size">Size<input id="edit-size" name="size" value="${esc(p.size)}"></label>
        <div class="grid-2">
          <label class="field" for="edit-cost">Cost price (฿)<input id="edit-cost" name="costPrice" type="number" min="0" value="${num(p.costPrice) || ''}" placeholder="Missing"></label>
          <label class="field" for="edit-sell">Sell price (฿)<input id="edit-sell" name="sellPrice" type="number" min="0" value="${num(p.sellPrice)}"></label>
        </div>
        <label class="field" for="edit-qty">Quantity on the shelf<input id="edit-qty" name="quantity" type="number" min="0" value="${num(p.quantity)}"><span class="hint">Use this to correct a count after a stock-take. For new deliveries, use + Stock.</span></label>
        <div class="pin-err" id="edit-err" role="alert" style="color:var(--bad)"></div>
        <button type="submit" class="btn primary block">Save changes</button>
        <button type="button" class="btn danger" data-act="delete-product" id="delete-btn">Delete product</button>
      </form>`, '#edit-name');
  }

  // ---------- events ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function go(route, filter) {
    if (!allowed(route)) return;
    S.route = route;
    if (filter) S.ui.stockFilter = filter;
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('button, [data-scrim]');
    if (!el) return;
    if (el.dataset.scrim && e.target === el) return closeSheet();
    const d = el.dataset;
    if (d.key) return pressKey(d.key);
    if (d.shop && !S.role) { S.shop = d.shop; S.settings.staff = null; return renderSignIn(); }
    if (d.go) return go(d.go, d.filter);
    if (d.period) { S.ui.period = d.period; return renderView(); }
    if (d.salesperiod) { S.ui.salesPeriod = d.salesperiod; return renderView(); }
    if (d.pay) { S.ui.salesPay = d.pay; return renderView(); }
    if (d.filterChip) { S.ui.stockFilter = d.filterChip; return fillOwnerStock(); }
    if (d.stafftab) { S.ui.staffTab = d.stafftab; return renderView(); }
    if (d.restock) return openRestock(d.restock);
    if (d.edit) return openEdit(d.edit);
    if (d.sell) return openSell(d.sell);
    if (d.qty) { sell.qty += Number(d.qty); sell.note = ($('#sell-note') || {}).value; return drawSell(); }
    if (d.paywith) { sell.pay = d.paywith; sell.note = ($('#sell-note') || {}).value; return drawSell(); }
    if (d.who) { sell.who = d.who; sell.note = ($('#sell-note') || {}).value; return drawSell(); }
    if (d.add) { restock.add = Math.max(1, restock.add + Number(d.add)); restock.cost = $('#restock-cost').value; return drawRestock(); }
    if (d.addset) { restock.add = Number(d.addset); restock.cost = $('#restock-cost').value; return drawRestock(); }
    if (d.themepick) { setTheme(d.themepick); return renderView(); }
    if (d.rmstaff) { staffNames().splice(Number(d.rmstaff), 1); return renderView(); }
    switch (d.act) {
      case 'sell': return openSell('');
      case 'close': return closeSheet();
      case 'save-sale': return saveSale();
      case 'save-restock': return saveRestock();
      case 'signout': S.role = null; store.del('b125_role'); closeSheet(); return render();
      case 'export': return toast('Excel export works once the app is connected to the sheet.');
      case 'demo-only': return toast('PIN changes happen in the live app, not in the demo.');
      case 'reset': DemoBackend.reset(S.shop); S.settings.staff = null; renderView(); return toast('Sample data reset.');
      case 'delete-product':
        if (!editing.confirmDelete) { editing.confirmDelete = true; el.textContent = 'Tap again to delete for good'; return; }
        DemoBackend.deleteProduct(S.shop, editing.id); closeSheet(); renderView(); return toast('Product deleted.');
    }
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'sell-product') { sell.productId = e.target.value; sell.qty = 1; sell.note = ($('#sell-note') || {}).value; drawSell(); }
    if (e.target.id === 'low-at') { S.settings.lowAt = Number(e.target.value); toast('Saved'); }
    if (e.target.id === 'add-photo' && e.target.files && e.target.files[0]) {
      const r = new FileReader();
      r.onload = () => { const pv = $('#add-preview'); pv.innerHTML = `<img src="${r.result}" alt="Selected photo">`; pv.dataset.img = r.result; };
      r.readAsDataURL(e.target.files[0]);
    }
  });

  document.addEventListener('input', e => {
    const key = e.target.dataset.input;
    if (key) {
      S.ui[key] = e.target.value;
      if (S.route === 'stock') (S.role === 'owner' ? fillOwnerStock : fillStaffStock)();
      if (S.route === 'sell') fillSell();
      if (S.route === 'sales') fillSales();
    }
    if (e.target.id === 'add-cost' || e.target.id === 'add-sell') {
      const c = num($('#add-cost').value), s = num($('#add-sell').value);
      $('#add-margin').textContent = c > 0 && s > 0 ? `Profit ${money(s - c)} per piece · ${Math.round((s - c) / s * 100)}% margin` : '';
    }
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'add-form') {
      const v = k => (f.elements[k].value || '').trim();
      const err = $('#add-err');
      if (!v('name')) return (err.textContent = 'Give the product a name.');
      if (!(num(v('sellPrice')) > 0)) return (err.textContent = 'Enter a sell price above 0.');
      if (v('quantity') === '' || num(v('quantity')) < 0) return (err.textContent = 'Enter how many are on the shelf (0 or more).');
      DemoBackend.addProduct(S.shop, { name: v('name'), size: v('size'), costPrice: v('costPrice'), sellPrice: v('sellPrice'), quantity: v('quantity'), imageUrl: ($('#add-preview').dataset.img || ''), addedBy: S.role === 'owner' ? 'Owner' : (S.lastSeller || 'Staff') });
      toast('Product added');
      return go('stock');
    }
    if (f.id === 'edit-form') {
      const v = k => (f.elements[k].value || '').trim();
      if (!v('name')) return ($('#edit-err').textContent = 'Give the product a name.');
      DemoBackend.updateProduct(S.shop, editing.id, { name: v('name'), size: v('size'), costPrice: v('costPrice'), sellPrice: v('sellPrice'), quantity: v('quantity') });
      closeSheet(); renderView(); return toast('Saved');
    }
    if (f.id === 'staff-form') {
      const n = cleanName($('#staff-new').value);
      if (n !== 'Unknown' && !staffNames().includes(n)) staffNames().push(n);
      return renderView();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheet-root') && $('#sheet-root').innerHTML) closeSheet();
    if (!S.role && /^[0-9]$/.test(e.key)) pressKey(e.key);
    if (!S.role && e.key === 'Backspace') pressKey('⌫');
  });

  render();
})();
