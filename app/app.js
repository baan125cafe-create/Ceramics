// Baan 125 / ChudPak shop app. One codebase for every shop (see config.js).
// Data comes from core.js: the demo source, or the live sheet in read-only preview.
(function () {
  'use strict';
  const { CFG, num, bkkDate, label, lsGet, lsSet, payKind, PAY_LABEL, PAY_ORDER, Backends, READ_ONLY, isTestProduct, isTestSale } = window.ShopCore;

  // ---------- tiny helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '฿' + Math.round(num(n)).toLocaleString('en-US');
  const moneyShort = n => { n = num(n); if (n >= 1e6) return '฿' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return '฿' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'; return '฿' + Math.round(n); };
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`;
  const bkkHour = d => Number(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false })) % 24;
  const today = () => bkkDate(new Date());
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monthKey = ymd => ymd.slice(0, 7);
  const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = ymd => /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? Number(ymd.slice(8, 10)) + ' ' + MONTHS[Number(ymd.slice(5, 7)) - 1] + (ymd.slice(0, 4) !== today().slice(0, 4) ? ' ' + ymd.slice(0, 4) : '') : '—';
  const monthLabel = ym => MONTHS[Number(ym.slice(5, 7)) - 1];
  // Sheets returns dates as UTC timestamps; show them as Phuket (Bangkok) days.
  const saleDay = s => {
    if (s._day !== undefined) return s._day;
    const v = String(s.saleDate || '').trim();
    let d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    if (!d) { const t = new Date(s.saleDate || s.createdAt); d = isNaN(t) ? '' : bkkDate(t); }
    return (s._day = d);
  };
  const saleHour = s => { const t = new Date(s.createdAt || s.saleDate); return isNaN(t) ? 12 : bkkHour(t); };
  // "nok", "Nok " and "NOK" are one person.
  const cleanName = n => { n = String(n || '').trim().replace(/\s+/g, ' '); return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : 'Unknown'; };
  const SWATCHES = ['#B9825E', '#5E8A8C', '#A35F43', '#8E6B8F', '#7A6A55', '#6C6862', '#86956A', '#C48A6A', '#4F6D7A', '#9C7A4B'];
  const swatch = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SWATCHES[h % SWATCHES.length]; };
  // Drive photos: ask Google for a small thumbnail instead of the full original.
  const imgSrc = (url, w) => { const m = String(url || '').match(/(?:[?&]id=|\/d\/)([A-Za-z0-9_-]{20,})/); return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w${w || 300}` : String(url || ''); };
  const sess = {
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
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    pot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10l-1 3a6 6 0 0 1 2 5v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5a6 6 0 0 1 2-5L7 4z"/></svg>',
    shirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/></svg>'
  };

  // ---------- state ----------
  const SHOPS = CFG.shops;
  const S = {
    shop: SHOPS[sess.get('b125_shop')] ? sess.get('b125_shop') : Object.keys(SHOPS)[0],
    role: sess.get('b125_role'),
    mode: sess.get('b125_mode'), // 'demo' | 'sheet'
    route: null, pin: '', pinErr: '', connectErr: '',
    cache: {}, loadedAt: {}, loading: false, loadError: '',
    ui: { period: '30d', stockFilter: 'all', stockQ: '', staffTab: 'in', sellQ: '', salesPeriod: '30d', salesPay: 'all', salesQ: '' },
    lastSeller: lsGet('b125_seller') || ''
  };
  if (S.mode !== 'demo' && S.mode !== 'sheet') S.mode = Backends.sheet.link(S.shop) ? 'sheet' : 'demo';
  const backend = () => Backends[S.mode];
  const live = () => S.mode === 'sheet';
  const data = () => S.cache[S.mode + ':' + S.shop] || { products: [], sales: [] };
  // Products people work with. Removed (archived) ones stay in the data only for costing old sales.
  const shown = () => data().products.filter(p => !p.archived);
  const readOnly = () => !backend().canWrite(S.shop);
  const isV6 = () => live() && Backends.sheet.isV6(S.shop);
  const testBadge = p => isTestProduct(p) ? '<span class="pill test">TEST</span> ' : '';

  // Per-shop settings, kept on this device until the new script stores them in the sheet.
  const settingsKey = () => 'b125_settings_' + S.shop;
  function settings() {
    if (!S._settings || S._settings.shop !== S.shop) {
      let saved = {};
      try { saved = JSON.parse(lsGet(settingsKey()) || '{}') || {}; } catch (e) { saved = {}; }
      const c = SHOPS[S.shop];
      const srv = isV6() && data().settings ? data().settings : {};
      S._settings = { shop: S.shop, lowAt: num(srv.lowAt) || num(saved.lowAt) || c.lowAtDefault, staff: Array.isArray(srv.staff) ? srv.staff : (Array.isArray(saved.staff) ? saved.staff : c.staffDefault.slice()) };
    }
    return S._settings;
  }
  // On the new script the staff list and "running low" level live in the sheet (owner only).
  const saveSettings = () => {
    const s = settings();
    lsSet(settingsKey(), JSON.stringify({ lowAt: s.lowAt, staff: s.staff }));
    if (isV6() && S.role === 'owner') backend().saveSettings(S.shop, { lowAt: s.lowAt, staff: s.staff }).catch(e => toast(e.message));
  };
  const staffNames = () => settings().staff;
  const status = p => num(p.quantity) <= 0 ? 'out' : (num(p.quantity) <= settings().lowAt ? 'low' : 'ok');

  // Appearance: 'auto' follows the device; 'light'/'dark' are saved on this device only.
  const THEME_KEY = 'b125_theme';
  const getTheme = () => { const t = lsGet(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; };
  function setTheme(t) {
    if (t === 'auto') { try { localStorage.removeItem(THEME_KEY); } catch (e) { /* ignore */ } } else lsSet(THEME_KEY, t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  }

  const ROUTES = {
    owner: [['dashboard', 'Dashboard', 'chart'], ['stock', 'Stock', 'box'], ['add', 'Add product', 'add'], ['sales', 'Sales', 'list'], ['settings', 'Settings', 'gear']],
    staff: [['stock', 'Stock', 'box'], ['sell', 'Sell', 'plus'], ['add', 'Add product', 'add']]
  };
  const allowed = r => ROUTES[S.role].some(x => x[0] === r);

  // ---------- loading ----------
  async function loadData(force) {
    const key = S.mode + ':' + S.shop;
    if (S.cache[key] && !force) return;
    S.loading = true; S.loadError = '';
    if (S.role) render();
    try {
      S.cache[key] = await backend().load(S.shop);
      S.loadedAt[key] = Date.now();
      S._settings = null;
    } catch (e) {
      if (e.code === 'auth') { S.loading = false; S.pinErr = e.message; return signOut(); }
      S.loadError = e.message || 'Couldn’t load the data.';
    }
    S.loading = false;
    render();
  }
  const updatedLabel = () => {
    const t = S.loadedAt[S.mode + ':' + S.shop];
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'Updated just now' : `Updated ${m} min ago`;
  };

  // ---------- numbers ----------
  function productIndex() {
    const byId = {}, byName = {};
    data().products.forEach(p => { byId[p.id] = p; byName[label(p)] = p; if (!byName[p.name]) byName[p.name] = p; });
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
    switch (key) {
      case 'today': return { from: t, to: t, pFrom: addDays(t, -1), pTo: addDays(t, -1), label: 'Today', prevLabel: 'yesterday by this time', hourCap: bkkHour(new Date()) };
      case '7d': return { from: addDays(t, -6), to: t, pFrom: addDays(t, -13), pTo: addDays(t, -7), label: 'Last 7 days', prevLabel: 'the 7 days before' };
      case '12m': { const m0 = addMonths(monthKey(t), -11) + '-01'; const p0 = addMonths(monthKey(t), -23) + '-01'; return { from: m0, to: t, pFrom: p0, pTo: addDays(m0, -1), label: 'Last 12 months', prevLabel: 'the 12 months before' }; }
      case 'all': return { from: '0000-00-00', to: '9999-99-99', label: 'All time' };
      default: return { from: addDays(t, -29), to: t, pFrom: addDays(t, -59), pTo: addDays(t, -30), label: 'Last 30 days', prevLabel: 'the 30 days before' };
    }
  }
  const inRange = (s, a, b) => { const d = saleDay(s); return !!d && d >= a && d <= b; };

  function stats(key) {
    const R = periodRange(key);
    const idx = productIndex();
    const sales = data().sales.filter(s => !isTestSale(s));
    const cur = sales.filter(s => inRange(s, R.from, R.to));
    const prev = R.pFrom ? sales.filter(s => inRange(s, R.pFrom, R.pTo) && (R.hourCap == null || saleHour(s) <= R.hourCap)) : [];
    const revenue = cur.reduce((a, s) => a + s.total, 0);
    const prevRevenue = prev.reduce((a, s) => a + s.total, 0);
    let costedRev = 0, cogs = 0, unknownN = 0, unknownRev = 0, estN = 0, units = 0;
    const pay = {}, byProduct = {}, byStaff = {};
    cur.forEach(s => {
      const q = s.quantity || 1;
      units += q;
      const k = payKind(s.paymentMethod);
      pay[k] = (pay[k] || 0) + s.total;
      const c = costFor(s, idx);
      if (c) { costedRev += s.total; cogs += c.c * q; if (c.est) estN++; } else { unknownN++; unknownRev += s.total; }
      const pk = s.productName || 'Unknown';
      (byProduct[pk] = byProduct[pk] || { name: pk, units: 0, rev: 0 }); byProduct[pk].units += q; byProduct[pk].rev += s.total;
      const sk = cleanName(s.soldBy);
      (byStaff[sk] = byStaff[sk] || { name: sk, n: 0, rev: 0 }); byStaff[sk].n++; byStaff[sk].rev += s.total;
    });

    let buckets = [];
    if (key === 'today') {
      for (let h = 10; h <= 21; h++) buckets.push({ k: h, label: h + ':00', v: 0 });
      cur.forEach(s => { const h = Math.min(21, Math.max(10, saleHour(s))); buckets[h - 10].v += s.total; });
    } else if (key === '12m') {
      for (let i = 11; i >= 0; i--) { const m = addMonths(monthKey(today()), -i); buckets.push({ k: m, label: monthLabel(m), v: 0 }); }
      const map = {}; buckets.forEach(b => { map[b.k] = b; });
      cur.forEach(s => { const b = map[monthKey(saleDay(s))]; if (b) b.v += s.total; });
    } else {
      const n = key === '7d' ? 7 : 30;
      for (let i = n - 1; i >= 0; i--) { const d = addDays(today(), -i); buckets.push({ k: d, label: key === '7d' ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) : dayLabel(d), v: 0 }); }
      const map = {}; buckets.forEach(b => { map[b.k] = b; });
      cur.forEach(s => { const b = map[saleDay(s)]; if (b) b.v += s.total; });
    }

    const prods = shown().filter(p => !isTestProduct(p));
    let atCost = 0, atSell = 0, potential = 0, noCostInStock = 0;
    prods.forEach(p => {
      const q = Math.max(0, p.quantity);
      atSell += q * p.sellPrice;
      if (p.costPrice > 0) { atCost += q * p.costPrice; potential += q * (p.sellPrice - p.costPrice); } else if (q > 0) noCostInStock++;
    });
    const counts = { ok: 0, low: 0, out: 0 };
    prods.forEach(p => counts[status(p)]++);
    const profit = costedRev - cogs;
    return {
      R, revenue, prevRevenue, n: cur.length, units, pay,
      profit, margin: costedRev ? profit / costedRev : 0, unknownN, unknownRev, estN,
      top: Object.values(byProduct).sort((a, b) => b.rev - a.rev).slice(0, 5),
      staff: Object.values(byStaff).sort((a, b) => b.rev - a.rev),
      buckets, atCost, atSell, potential, noCostInStock, counts,
      noCost: prods.filter(p => p.costPrice <= 0),
      // Only products that have sold need a cost; unsold collection pieces don't affect profit.
      soldNoCost: prods.filter(p => p.costPrice <= 0 && sales.some(s => s.productId === p.id))
    };
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e;
    return 10 * e;
  }
  // What the data looks like: labels to tidy, names spelled several ways, gaps.
  function dataCheck() {
    const { products, sales } = data();
    const idx = productIndex();
    const pays = {}, names = {};
    let badDate = 0, orphan = 0, noCostSale = 0;
    sales.forEach(s => {
      const raw = String(s.paymentMethod == null ? '' : s.paymentMethod).trim();
      const k = raw.toLowerCase() || '(blank)';
      (pays[k] = pays[k] || { raws: new Set(), kind: payKind(raw), n: 0, total: 0 }); pays[k].raws.add(raw || '(blank)'); pays[k].n++; pays[k].total += s.total;
      const clean = cleanName(s.soldBy);
      ((names[clean] = names[clean] || {})[String(s.soldBy == null ? '' : s.soldBy)] = ((names[clean] || {})[String(s.soldBy == null ? '' : s.soldBy)] || 0) + 1);
      if (!saleDay(s)) badDate++;
      if (!idx.byId[s.productId] && !idx.byName[s.productName]) orphan++;
      if (!costFor(s, idx)) noCostSale++;
    });
    const spellings = Object.entries(names).map(([clean, v]) => ({ clean, variants: Object.entries(v).sort((a, b) => b[1] - a[1]) })).filter(x => x.variants.length > 1);
    return {
      pays: Object.values(pays).map(x => ({ ...x, raw: [...x.raws].join(' / ') })).sort((a, b) => PAY_ORDER.indexOf(a.kind) - PAY_ORDER.indexOf(b.kind) || b.n - a.n),
      spellings, badDate, orphan, noCostSale,
      noCost: products.filter(p => p.costPrice <= 0).length,
      negative: products.filter(p => p.quantity < 0).length,
      tests: products.filter(isTestProduct).length + sales.filter(isTestSale).length,
      nSales: sales.length, nProducts: products.length
    };
  }

  // ---------- rendering ----------
  const app = $('#app');
  function strip() {
    if (!live()) return `<div class="demo-strip">Demo mode · sample data only · nothing here touches the real shop sheet</div>`;
    if (Backends.sheet.local) return `<div class="demo-strip">Local test · pretend sheet on this computer · nothing here touches Google</div>`;
    return readOnly()
      ? `<div class="demo-strip live">Live sheet · read-only preview · saving is off until the new PIN-protected script is installed</div>`
      : `<div class="demo-strip real">Live sheet · changes save to the real ${esc(SHOPS[S.shop].name)} sheet · to try things out, start a product name with [TEST]</div>`;
  }
  function render() {
    if (!S.role) return renderSignIn();
    if (!S.route || !allowed(S.route)) S.route = ROUTES[S.role][0][0];
    const shop = SHOPS[S.shop];
    const nav = ROUTES[S.role];
    const roleName = S.role === 'owner' ? 'Owner' : 'Staff';
    const sideLinks = nav.filter(r => r[0] !== 'sell').map(([k, t, ic]) => `<button type="button" class="side-link" data-go="${k}" ${S.route === k ? 'aria-current="page"' : ''}>${I[ic]}${esc(t)}</button>`).join('');
    const mobile = S.role === 'owner'
      ? [['dashboard', 'Dashboard', 'chart'], ['stock', 'Stock', 'box'], ['SELL'], ['sales', 'Sales', 'list'], ['settings', 'Settings', 'gear']]
      : [['stock', 'Stock', 'box'], ['SELL'], ['add', 'Add', 'add']];
    const bottom = mobile.map(r => r[0] === 'SELL'
      ? `<button type="button" class="nav-btn sell" data-act="sell"><span class="fab">${I.plus}</span>Sell</button>`
      : `<button type="button" class="nav-btn" data-go="${r[0]}" ${S.route === r[0] ? 'aria-current="page"' : ''}>${I[r[2]]}${esc(r[1])}</button>`).join('');
    app.innerHTML = `
      ${strip()}
      <div class="shell">
        <aside class="sidebar" aria-label="Main">
          <div class="brand">${esc(shop.name)}</div>
          <div class="brand-sub">${roleName} · ${esc(shop.sub)}</div>
          <button type="button" class="side-sell" data-act="sell">${I.plus}Record a sale</button>
          ${sideLinks}
          <div class="side-foot">
            <button type="button" class="side-link" data-act="refresh">${I.refresh}Refresh data</button>
            <span class="updated" style="padding:0 12px 4px 44px">${esc(updatedLabel())}</span>
            <button type="button" class="side-link" data-act="signout">${I.out}Sign out</button>
          </div>
        </aside>
        <div class="content">
          <header class="topbar">
            <div><div class="brand">${esc(shop.name)}</div><div class="brand-sub">${roleName} · ${esc(shop.sub)}</div></div>
            <div style="display:flex">
              <button type="button" class="icon-btn" data-act="refresh" aria-label="Refresh data">${I.refresh}</button>
              <button type="button" class="icon-btn" data-act="signout" aria-label="Sign out">${I.out}</button>
            </div>
          </header>
          <main class="main" id="view"></main>
        </div>
      </div>
      <nav class="bottom-nav" aria-label="Main">${bottom}</nav>
      <div id="sheet-root"></div>
      <div id="confirm-root"></div>`;
    renderView();
  }

  function renderView() {
    const v = $('#view');
    if (!v) return;
    if (S.loading && !S.cache[S.mode + ':' + S.shop]) { v.innerHTML = `<div class="state"><div class="spinner" aria-hidden="true"></div><p>Loading ${esc(SHOPS[S.shop].name)} data…</p></div>`; return; }
    if (S.loadError && !S.cache[S.mode + ':' + S.shop]) {
      v.innerHTML = `<div class="state"><h2 class="display">Couldn’t load the data</h2><p class="muted">${esc(S.loadError)}</p><div class="toolbar" style="justify-content:center"><button type="button" class="btn primary" data-act="refresh">Try again</button><button type="button" class="btn" data-act="signout-now">Back to sign-in</button></div></div>`;
      return;
    }
    const fn = { dashboard: viewDashboard, stock: S.role === 'owner' ? viewOwnerStock : viewStaffStock, add: viewAdd, sales: viewSales, settings: viewSettings, sell: viewSell }[S.route];
    v.innerHTML = fn();
    if (S.route === 'stock') (S.role === 'owner' ? fillOwnerStock : fillStaffStock)();
    if (S.route === 'sell') fillSell();
    if (S.route === 'sales') fillSales();
  }

  // ----- sign in -----
  function renderSignIn() {
    const L = CFG.pinLength;
    const link = Backends.sheet.link(S.shop);
    const sources = `<div class="seg" role="group" aria-label="Data">
        <button type="button" data-mode="demo" aria-pressed="${S.mode === 'demo'}">Sample data</button>
        <button type="button" data-mode="sheet" aria-pressed="${S.mode === 'sheet'}">Live sheet</button>
      </div>`;
    let body;
    if (S.mode === 'sheet' && !link) {
      body = `<form id="connect-form" class="connect" novalidate>
          <p class="signin-hint" style="max-width:none">Paste ${esc(SHOPS[S.shop].name)}’s Apps Script link (the same one the current owner page uses). It’s saved in this browser only and is never added to the code.</p>
          <label class="sr-only" for="connect-url">Script link</label>
          <input id="connect-url" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec">
          <div class="pin-err" role="alert">${esc(S.connectErr)}</div>
          <button type="submit" class="btn primary block">Connect (read-only)</button>
        </form>`;
    } else if (S.mode === 'sheet' && !Backends.sheet.info[S.shop]) {
      body = `<div class="connect"><p class="signin-hint" style="max-width:none">Checking the sheet…</p></div>`;
      Backends.sheet.detect(S.shop).then(() => { if (!S.role) renderSignIn(); }, e => { S.connectErr = e.message; Backends.sheet.info[S.shop] = { version: 0, error: e.message }; if (!S.role) renderSignIn(); });
    } else if (S.mode === 'sheet' && Backends.sheet.info[S.shop].error) {
      body = `<div class="connect"><div class="pin-err" role="alert">${esc(Backends.sheet.info[S.shop].error)}</div>
          <button type="button" class="btn block" data-act="retry-detect">Try again</button>
          <button type="button" class="link-btn" data-act="change-link" style="color:var(--brand-dark-muted)">Use a different link</button></div>`;
    } else if (S.mode === 'sheet' && Backends.sheet.isV6(S.shop) && !Backends.sheet.info[S.shop].pinsSet) {
      body = `<div class="connect"><p class="signin-hint" style="max-width:none">The new script is installed, but no PINs are set yet. In the Google Sheet, open the <b>Shop app</b> menu and choose <b>Set owner PIN</b> and <b>Set staff PIN</b>, then come back here.</p>
          <button type="button" class="btn block" data-act="retry-detect">I’ve set them</button></div>`;
    } else if (S.mode === 'sheet' && !Backends.sheet.isV6(S.shop)) {
      body = `<div class="connect">
          <p class="signin-hint" style="max-width:none">Connected to the live sheet. This preview only reads data: nothing can be saved, so the shop’s numbers can’t change. PIN sign-in arrives with the new script.</p>
          <div class="grid-2"><button type="button" class="btn primary block" data-preview="owner">View as owner</button><button type="button" class="btn block preview-staff" data-preview="staff">View as staff</button></div>
          <button type="button" class="link-btn" data-act="change-link" style="color:var(--brand-dark-muted)">Use a different link</button>
        </div>`;
    } else {
      const isLive = S.mode === 'sheet';
      const dots = Array.from({ length: L }, (_, i) => `<span class="${i < S.pin.length ? 'on' : ''}"></span>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k =>
        `<button type="button" class="${k === 'C' || k === '⌫' ? 'ghost' : ''}" data-key="${k}" aria-label="${k === '⌫' ? 'Delete' : (k === 'C' ? 'Clear' : k)}">${k === 'C' ? 'Clear' : k}</button>`).join('');
      body = `<div style="color:var(--brand-dark-muted);font-size:14px">Enter your PIN</div>
          <div class="pin-dots" role="img" aria-label="${S.pin.length} of ${L} digits entered">${dots}</div>
          <div class="pin-err" role="alert">${esc(S.pinErr)}</div>
          <div class="keypad">${keys}</div>
          <p class="signin-hint">${isLive ? 'Enter the owner or staff PIN for this shop. Five wrong PINs pause sign-in for everyone.' : 'Sample PINs: 111111 for staff, 222222 for owner. Five wrong PINs pause sign-in.'}</p>
          ${isLive ? '<button type="button" class="link-btn" data-act="change-link" style="color:var(--brand-dark-muted)">Use a different link</button>' : ''}`;
    }
    app.innerHTML = `
      <div class="signin">
        <div class="signin-box">
          <h1>${esc(SHOPS[S.shop].name)}</h1>
          <div class="seg" role="group" aria-label="Shop">
            ${Object.entries(SHOPS).map(([k, s]) => `<button type="button" data-shop="${k}" aria-pressed="${S.shop === k}">${esc(s.name)}</button>`).join('')}
          </div>
          ${sources}
          ${body}
        </div>
      </div>`;
  }
  function enter(role) {
    S.role = role; sess.set('b125_role', role); sess.set('b125_shop', S.shop); sess.set('b125_mode', S.mode);
    S.route = null;
    // Each role gets its own view of the data (staff never receive costs), so always reload.
    delete S.cache[S.mode + ':' + S.shop];
    loadData(true);
    render();
  }
  async function pressKey(k) {
    const L = CFG.pinLength;
    if (k === '⌫') S.pin = S.pin.slice(0, -1);
    else if (k === 'C') S.pin = '';
    else if (S.pin.length < L) S.pin += k;
    S.pinErr = '';
    if (S.pin.length === L) {
      let r;
      try { r = await backend().login(S.shop, S.pin); } catch (e) { S.pin = ''; S.pinErr = e.message; return renderSignIn(); }
      S.pin = '';
      if (r.role) return enter(r.role);
      if (r.locked) S.pinErr = `Too many wrong PINs. Sign-in is paused for ${r.locked >= 60 ? Math.round(r.locked / 60) + (r.locked >= 120 ? ' hours' : ' hour') : r.locked + ' minutes'}.`;
      else S.pinErr = `That PIN didn’t match. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left before sign-in pauses.`;
    }
    renderSignIn();
  }

  // ----- dashboard -----
  function payColor(k) { return { cash: 'var(--cash)', card: 'var(--card)', qr: 'var(--qr)', legacy: 'var(--legacy)', other: 'var(--muted)', unknown: 'var(--line)' }[k]; }
  function viewDashboard() {
    const st = stats(S.ui.period);
    const periods = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 mo']];
    let delta = '<span class="delta flat">No earlier sales</span>';
    if (st.prevRevenue > 0) {
      const d = (st.revenue - st.prevRevenue) / st.prevRevenue * 100;
      delta = `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span>`;
    }
    const peak = Math.max(...st.buckets.map(b => b.v));
    const max = niceMax(peak);
    const bars = st.buckets.map((b, i) => `<div class="bar${i === st.buckets.length - 1 ? ' hi' : ''}" style="height:${(b.v / max * 100).toFixed(1)}%" title="${esc(b.label)}: ${money(b.v)}"></div>`).join('');
    const mid = Math.floor(st.buckets.length / 2);
    const pays = PAY_ORDER.filter(k => st.pay[k] > 0).map(k => ({ k, v: st.pay[k], p: pct(st.pay[k], st.revenue) }));
    const topMax = Math.max(1, ...st.top.map(t => t.rev));
    const missing = st.soldNoCost.length;
    const notice = missing || st.unknownN ? `
      <div class="notice">${I.warn}<div>
        <b>${plural(missing, 'product')} sold without a cost price</b>
        <span>${st.unknownN ? `${plural(st.unknownN, 'sale')} in this period (${money(st.unknownRev)}) can’t be costed, so ${st.unknownN === 1 ? 'it is' : 'they are'} left out of profit and margin.` : 'Add them so new sales can be costed.'}</span>
        ${missing ? '<button type="button" class="link-btn" data-go="stock" data-filter="nocost">Add cost prices</button>' : ''}
      </div></div>` : '';
    return `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="muted small">${esc(st.R.label)} · ${esc(updatedLabel())}</div></div>
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
          <div class="chart" role="img" aria-label="Revenue by ${S.ui.period === '12m' ? 'month' : (S.ui.period === 'today' ? 'hour' : 'day')}, highest ${money(peak)}">
            <div class="yaxis"><span style="top:0">${moneyShort(max)}</span><span style="top:50%">${moneyShort(max / 2)}</span><span style="top:100%">฿0</span></div>
            <div class="plot"><div class="grid-line" style="top:0"></div><div class="grid-line" style="top:50%"></div><div class="bars">${bars}</div></div>
          </div>
          <div class="xaxis"><span>${esc(st.buckets[0].label)}</span><span>${esc(st.buckets[mid].label)}</span><span>${esc(st.buckets[st.buckets.length - 1].label)}</span></div>
        </section>

        <section class="kpis" aria-label="Key numbers">
          <div class="kpi"><span class="label">Gross profit</span><span class="value good">${money(st.profit)}</span><span class="sub">${st.estN ? `${plural(st.estN, 'sale')} costed at today’s price` : 'from saved cost prices'}</span></div>
          <div class="kpi"><span class="label">Margin</span><span class="value">${Math.round(st.margin * 100)}%</span><div class="meter"><i style="width:${Math.max(0, Math.min(100, Math.round(st.margin * 100)))}%"></i></div></div>
          <div class="kpi"><span class="label">Sales</span><span class="value">${st.n.toLocaleString('en-US')}</span><span class="sub">${plural(st.units, 'item')}</span></div>
          <div class="kpi"><span class="label">Average sale</span><span class="value">${money(st.n ? st.revenue / st.n : 0)}</span><span class="sub">per transaction</span></div>
        </section>

        <div class="side-stack">
          <section class="card">
            <h2>How people paid</h2>
            ${pays.length ? `<div class="split" role="img" aria-label="${esc(pays.map(x => PAY_LABEL[x.k] + ' ' + x.p + ' percent').join(', '))}">${pays.map(x => `<i style="flex:${x.v} 1 0;background:${payColor(x.k)}"></i>`).join('')}</div>
            <div class="legend">${pays.map(x => `<div><span class="sw" style="background:${payColor(x.k)}"></span><span class="muted">${esc(PAY_LABEL[x.k])} · ${x.p}%</span><b>${money(x.v)}</b></div>`).join('')}</div>` : '<p class="muted">No sales in this period yet.</p>'}
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
          ${st.noCostInStock ? `<div class="muted small">${plural(st.noCostInStock, 'product')} in stock with no cost price ${st.noCostInStock === 1 ? 'is' : 'are'} not in "at cost" or "profit".</div>` : ''}
          <div class="counts">
            <button type="button" class="count-btn" data-go="stock" data-filter="ok"><b>${st.counts.ok}</b>in stock</button>
            <button type="button" class="count-btn low" data-go="stock" data-filter="low"><b>${st.counts.low}</b>running low</button>
            <button type="button" class="count-btn out" data-go="stock" data-filter="out"><b>${st.counts.out}</b>sold out</button>
          </div>
        </section>

        <section class="card w4">
          <h2>By staff</h2>
          ${st.staff.length ? st.staff.map(s => `<div class="staff-row"><span style="display:flex;align-items:center;min-width:0"><span class="avatar">${esc(s.name[0])}</span>${esc(s.name)}</span><span class="muted">${s.n} sales · <b style="color:var(--ink)">${money(s.rev)}</b></span></div>`).join('') : '<p class="muted">No sales in this period yet.</p>'}
        </section>
      </div>`;
  }

  // ----- owner stock -----
  function viewOwnerStock() {
    const prods = shown();
    const inStock = prods.filter(p => p.quantity > 0).length;
    return `
      <div class="page-head">
        <div><h1>Stock</h1><div class="muted small">${plural(prods.length, 'product')} · ${inStock} in stock</div></div>
        <button type="button" class="btn dark" data-go="add">${I.plus}New product</button>
      </div>
      <div class="toolbar">
        <label class="search">${I.search}<span class="sr-only">Search products</span><input id="stock-q" type="search" placeholder="Search products" value="${esc(S.ui.stockQ)}" data-input="stockQ"></label>
        <div class="chips" role="group" aria-label="Filter" id="stock-chips"></div>
      </div>
      <ul class="list" id="stock-list"></ul>`;
  }
  function fillOwnerStock() {
    const prods = shown();
    const c = { all: prods.length, ok: 0, low: 0, out: 0, nocost: 0 };
    prods.forEach(p => { c[status(p)]++; if (p.costPrice <= 0) c.nocost++; });
    const defs = [['all', 'All'], ['ok', 'In stock'], ['low', 'Running low'], ['out', 'Sold out'], ['nocost', 'No cost price']];
    $('#stock-chips').innerHTML = defs.filter(d => d[0] !== 'nocost' || c.nocost).map(([k, t]) => `<button type="button" class="chip" data-filter-chip="${k}" aria-pressed="${S.ui.stockFilter === k}">${t}<span class="count">${c[k]}</span></button>`).join('');
    const q = S.ui.stockQ.trim().toLowerCase();
    const f = S.ui.stockFilter;
    const list = prods.filter(p => (f === 'all' || (f === 'nocost' ? p.costPrice <= 0 : status(p) === f)) && label(p).toLowerCase().includes(q))
      .sort((a, b) => f === 'low' ? a.quantity - b.quantity : label(a).localeCompare(label(b)));
    const maxQ = Math.max(10, ...prods.map(p => p.quantity));
    $('#stock-list').innerHTML = list.length ? list.map(p => {
      const st = status(p);
      const margin = p.costPrice > 0 && p.sellPrice > 0 ? Math.round((p.sellPrice - p.costPrice) / p.sellPrice * 100) + '% margin' : '<b class="tone-low">no cost price</b>';
      return `<li class="row">
        ${thumb(p)}
        <button type="button" class="row-body" data-edit="${esc(p.id)}" aria-label="Edit ${esc(label(p))}">
          <span class="row-title">${testBadge(p)}${esc(label(p))}</span>
          <span class="row-sub">${money(p.sellPrice)} · cost ${p.costPrice > 0 ? money(p.costPrice) : '—'} · ${margin}</span>
          <span class="stockbar"><span class="track"><i class="fill-${st}" style="width:${Math.max(0, Math.min(100, p.quantity / maxQ * 100)).toFixed(0)}%"></i></span><b class="tone-${st}">${st === 'out' ? 'Sold out' : p.quantity + ' left'}</b></span>
        </button>
        <button type="button" class="btn" data-restock="${esc(p.id)}" aria-label="Add stock for ${esc(label(p))}">+ Stock</button>
      </li>`;
    }).join('') : `<li class="empty">${q ? 'No product matches that search.' : 'Nothing here.'}</li>`;
  }
  function photo(p, w) {
    return p.imageUrl ? `<img src="${esc(imgSrc(p.imageUrl, w))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  }
  function thumb(p) {
    return `<div class="thumb" style="background:${swatch(p.name)}">${I[SHOPS[S.shop].icon]}${photo(p, 160)}</div>`;
  }

  // ----- staff stock -----
  function viewStaffStock() {
    const prods = shown();
    const nIn = prods.filter(p => p.quantity > 0).length;
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
    data().sales.forEach(s => { const d = saleDay(s); if (d && (!m[s.productId] || d > m[s.productId])) m[s.productId] = d; });
    return m;
  }
  function tile(p, last) {
    const st = status(p);
    const badge = st === 'out' ? '<span class="badge out">Sold out</span>' : `<span class="badge ${st === 'low' ? 'low' : ''}">${p.quantity} left</span>`;
    const sub = st === 'out' ? (last ? 'Last sold ' + dayLabel(last) : 'Sold out') : 'Tap to sell';
    const inner = `<div class="pic" style="background:${swatch(p.name)}">${I[SHOPS[S.shop].icon]}${photo(p, 400)}${badge}</div><div class="meta"><b>${testBadge(p)}${esc(label(p))}</b><span class="price">${money(p.sellPrice)}</span><span class="muted small">${sub}</span></div>`;
    return st === 'out' ? `<div class="tile out">${inner}</div>` : `<button type="button" class="tile" data-sell="${esc(p.id)}" aria-label="Sell ${esc(label(p))}">${inner}</button>`;
  }
  function fillStaffStock() {
    const q = S.ui.stockQ.trim().toLowerCase();
    const last = lastSold();
    const list = shown().filter(p => (S.ui.staffTab === 'in' ? p.quantity > 0 : p.quantity <= 0) && label(p).toLowerCase().includes(q))
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
    const list = shown().filter(p => p.quantity > 0 && label(p).toLowerCase().includes(q)).sort((a, b) => label(a).localeCompare(label(b)));
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
        ${S.role === 'owner' ? `<div class="grid-2">
          <label class="field" for="add-cost">Cost price (฿)<input id="add-cost" name="costPrice" type="number" min="0" inputmode="decimal" placeholder="150"></label>
          <label class="field" for="add-sell">Sell price (฿)<input id="add-sell" name="sellPrice" type="number" min="0" inputmode="decimal" placeholder="450" required></label>
        </div>` : `<label class="field" for="add-sell">Sell price (฿)<input id="add-sell" name="sellPrice" type="number" min="0" inputmode="decimal" placeholder="450" required><span class="hint">The owner adds the cost price. Once saved, only the owner can change it.</span></label>`}
        <label class="field" for="add-qty">Quantity<input id="add-qty" name="quantity" type="number" min="0" inputmode="numeric" placeholder="10" required></label>
        <div class="muted small" id="add-margin" aria-live="polite"></div>
        <div class="pin-err" id="add-err" role="alert" style="color:var(--bad)"></div>
        <button type="submit" class="btn primary block">${readOnly() ? 'Saving is off in this preview' : 'Add product'}</button>
      </form>`;
  }

  // ----- sales (owner) -----
  function viewSales() {
    const periods = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 mo'], ['all', 'All']];
    const present = new Set(data().sales.map(s => payKind(s.paymentMethod)));
    const chips = [['all', 'All'], ...PAY_ORDER.filter(k => ['cash', 'card', 'qr'].includes(k) || present.has(k)).map(k => [k, PAY_LABEL[k]])];
    return `
      <div class="page-head">
        <div><h1>Sales</h1><div class="muted small" id="sales-sum"></div></div>
        <button type="button" class="btn" data-act="export">Download CSV</button>
      </div>
      <div class="seg" role="group" aria-label="Time period" style="max-width:520px">${periods.map(([k, t]) => `<button type="button" data-salesperiod="${k}" aria-pressed="${S.ui.salesPeriod === k}">${t}</button>`).join('')}</div>
      <div class="toolbar">
        <label class="search">${I.search}<span class="sr-only">Search sales</span><input id="sales-q" type="search" placeholder="Product, staff or note" value="${esc(S.ui.salesQ)}" data-input="salesQ"></label>
        <div class="chips" role="group" aria-label="Payment">${chips.map(([k, t]) => `<button type="button" class="chip" data-pay="${k}" aria-pressed="${S.ui.salesPay === k}">${esc(t)}</button>`).join('')}</div>
      </div>
      <div class="table-wrap" id="sales-table"></div>`;
  }
  function salesRows() {
    const R = periodRange(S.ui.salesPeriod);
    const q = S.ui.salesQ.trim().toLowerCase();
    return { R, rows: data().sales.filter(s => inRange(s, R.from, R.to)
      && (S.ui.salesPay === 'all' || payKind(s.paymentMethod) === S.ui.salesPay)
      && (!q || [s.productName, s.soldBy, s.note].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (saleDay(b) + String(b.createdAt || '')).localeCompare(saleDay(a) + String(a.createdAt || ''))) };
  }
  function fillSales() {
    const { R, rows } = salesRows();
    const real = rows.filter(s => !isTestSale(s));
    const total = real.reduce((a, s) => a + s.total, 0);
    const items = real.reduce((a, s) => a + (s.quantity || 1), 0);
    const tests = rows.length - real.length;
    $('#sales-sum').textContent = `${R.label} · ${plural(real.length, 'sale')} · ${money(total)}${tests ? ` · ${plural(tests, 'test sale')} not counted` : ''}`;
    const page = rows.slice(0, 300);
    $('#sales-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>Date</th><th>Product</th><th class="num">Qty</th><th class="num">Total</th><th>Paid</th><th>Staff</th><th>Note</th></tr></thead>
        <tbody>${page.map(s => { const k = payKind(s.paymentMethod); return `<tr><td>${dayLabel(saleDay(s))}</td><td>${isTestSale(s) ? '<span class="pill test">TEST</span> ' : ''}${esc(s.productName)}</td><td class="num">${s.quantity || 1}</td><td class="num">${money(s.total)}</td><td><span class="pill pay-${k}">${esc(k === 'other' ? String(s.paymentMethod) : PAY_LABEL[k])}</span></td><td>${esc(cleanName(s.soldBy))}</td><td class="muted">${esc(s.note || '')}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td colspan="2">${rows.length > 300 ? `Showing newest 300 of ${rows.length.toLocaleString('en-US')}` : 'Total'}</td><td class="num">${items.toLocaleString('en-US')}</td><td class="num">${money(total)}</td><td colspan="3"></td></tr></tfoot>
      </table>` : '<p class="empty">No sales match.</p>';
  }
  // A local file download: works in the browser, sends nothing anywhere.
  function exportCsv() {
    const { R, rows } = salesRows();
    const cell = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['Date', 'Product', 'Qty', 'Price', 'Total', 'Paid', 'Paid (as saved)', 'Staff', 'Note'].join(',')]
      .concat(rows.map(s => [saleDay(s), s.productName, s.quantity || 1, s.sellPrice, s.total, PAY_LABEL[payKind(s.paymentMethod)], s.paymentMethod, cleanName(s.soldBy), s.note || ''].map(cell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${SHOPS[S.shop].name.replace(/\s+/g, '-')}-sales-${R.label.toLowerCase().replace(/\s+/g, '-')}-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Downloaded ${plural(rows.length, 'sale')}`);
  }

  // ----- settings (owner) -----
  function viewSettings() {
    const names = staffNames();
    const chk = dataCheck();
    const link = Backends.sheet.link(S.shop);
    const masked = link ? link.replace(/\/s\/(.{6}).*(.{4})\/exec$/, '/s/$1…$2/exec') : '';
    return `
      <div class="page-head"><div><h1>Settings</h1><div class="muted small">${esc(SHOPS[S.shop].name)} · only the owner can open this page</div></div></div>
      <div class="settings-grid">
        <section class="card">
          <h2>Access</h2>
          ${live() && readOnly() ? '<p class="muted small" style="margin:0">PINs, lockouts and "sign all out" start working with the new PIN-protected script.</p>' : ''}
          ${isV6() ? '<p class="muted small" style="margin:0">PINs are changed inside the Google Sheet (Shop app menu), so they never pass through this app.</p>' : ''}
          <div>
            <div class="set-row"><div><b>Owner PIN</b><small>Everything, including this page</small></div><button type="button" class="btn" data-act="pin-later">Change</button></div>
            <div class="set-row"><div><b>Staff PIN</b><small>Stock, add product and sell</small></div><button type="button" class="btn" data-act="pin-later">Change</button></div>
            <div class="set-row"><div><b>Signed-in phones</b><small>Sign every phone out, for example after a staff change</small></div><button type="button" class="btn danger" data-act="signout-all">Sign all out</button></div>
          </div>
        </section>
        <section class="card">
          <h2>Staff names</h2>
          <p class="muted small" style="margin:0">Staff tap their name when they sell, so reports don’t split one person into "Nok" and "nok". ${isV6() ? 'Saved in the sheet, so every phone gets the same list.' : 'Saved on this device for now.'}</p>
          <div class="chips">${names.length ? names.map((n, i) => `<span class="name-chip">${esc(n)}<button type="button" data-rmstaff="${i}" aria-label="Remove ${esc(n)}">${I.close}</button></span>`).join('') : '<span class="muted small">No names yet.</span>'}</div>
          <form id="staff-form" class="toolbar" novalidate>
            <label class="field" for="staff-new" style="flex:1 1 180px">Add a name<input id="staff-new" placeholder="e.g. Ploy" maxlength="30"></label>
            <button type="submit" class="btn" style="align-self:flex-end">Add</button>
          </form>
        </section>
        <section class="card">
          <h2>Shop rules</h2>
          <div>
            <div class="set-row"><div><b>"Running low" at</b><small>Flag a product on the dashboard and stock list</small></div>
              <label class="field" for="low-at" style="flex-direction:row;align-items:center"><span class="sr-only">Running low at</span><select id="low-at">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${settings().lowAt === n ? 'selected' : ''}>${n} or fewer</option>`).join('')}</select></label></div>
            <div class="set-row"><div><b>Payment types</b><small>Shown when recording a sale</small></div><span class="muted">${CFG.payments.map(p => esc(p.label)).join(' · ')}</span></div>
          </div>
        </section>
        <section class="card">
          <h2>Data check</h2>
          <p class="muted small" style="margin:0">How the ${plural(chk.nSales, 'sale')} and ${plural(chk.nProducts, 'product')} ${live() ? 'in the sheet' : 'in this sample'} line up with the new labels. Nothing here changes data.</p>
          <div class="table-wrap" style="background:var(--surface-2)"><table>
            <thead><tr><th>Saved as</th><th>Shown as</th><th class="num">Sales</th><th class="num">Total</th></tr></thead>
            <tbody>${chk.pays.map(x => `<tr><td>${esc(x.raw)}</td><td><span class="pill pay-${x.kind}">${esc(x.kind === 'other' ? 'Other (' + x.raw + ')' : PAY_LABEL[x.kind])}</span></td><td class="num">${x.n.toLocaleString('en-US')}</td><td class="num">${money(x.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sales yet.</td></tr>'}</tbody>
          </table></div>
          <ul class="check-list">
            ${chk.spellings.length ? `<li>Staff names saved in more than one spelling (reports already merge them): ${chk.spellings.map(x => `<b>${esc(x.clean)}</b> (${x.variants.map(v => `"${esc(v[0])}" ×${v[1]}`).join(', ')})`).join('; ')}</li>` : '<li>Staff names are spelled consistently.</li>'}
            <li>${plural(chk.noCost, 'product')} without a cost price; ${plural(chk.noCostSale, 'sale')} can’t be costed.</li>
            ${chk.orphan ? `<li>${plural(chk.orphan, 'sale')} ${chk.orphan === 1 ? 'points' : 'point'} to a product that no longer exists (still counted in revenue).</li>` : ''}
            ${chk.badDate ? `<li>${plural(chk.badDate, 'sale')} ${chk.badDate === 1 ? 'has a date the app can’t read, so it doesn’t' : 'have a date the app can’t read, so they don’t'} show in any period.</li>` : ''}
            ${chk.tests ? `<li>${plural(chk.tests, 'test row')} ([TEST]) are left out of every total.</li>` : ''}
            ${chk.negative ? `<li>${plural(chk.negative, 'product')} ${chk.negative === 1 ? 'shows' : 'show'} a stock count below zero.</li>` : ''}
          </ul>
        </section>
        <section class="card">
          <h2>Test data</h2>
          ${testCard()}
        </section>
        <section class="card">
          <h2>Appearance</h2>
          <div class="set-row"><div><b>Light or dark</b><small>Automatic follows this phone or laptop. Saved on this device only.</small></div></div>
          <div class="seg" role="group" aria-label="Appearance" style="max-width:360px">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, t]) => `<button type="button" data-themepick="${k}" aria-pressed="${getTheme() === k}">${t}</button>`).join('')}</div>
        </section>
        <section class="card">
          <h2>${live() ? 'Live sheet' : 'Sample data'}</h2>
          ${live() ? `<div class="set-row"><div><b>Connected</b><small style="word-break:break-all">${esc(masked)}</small></div><button type="button" class="btn" data-act="forget-link">Disconnect</button></div>`
            : '<div class="set-row"><div><b>Reset sample data</b><small>Undo test sales and restocks in this demo</small></div><button type="button" class="btn" data-act="reset">Reset</button></div>'}
        </section>
      </div>`;
  }

  function testCard() {
    const tp = data().products.filter(isTestProduct), ts = data().sales.filter(isTestSale);
    const names = tp.map(p => label(p)).slice(0, 6);
    return `<p class="muted small" style="margin:0">To try things out, add a product whose name starts with <b>[TEST]</b> and sell it. Test rows are left out of every total and report.</p>
      <div class="set-row"><div><b>${plural(tp.length, 'test product')} · ${plural(ts.length, 'test sale')}</b><small>${names.length ? esc(names.join(', ')) + (tp.length > names.length ? '…' : '') : 'Nothing to clear.'}</small></div>
      <button type="button" class="btn danger" data-act="clear-tests" ${!tp.length && !ts.length || readOnly() || (live() && S.role !== 'owner') ? 'disabled' : ''}>Clear…</button></div>`;
  }

  // ---------- sheets (sell, restock, edit) ----------
  // First open: focus the sheet itself (not a field), so phones don't pop up a
  // picker or keyboard. Redraws swap the content in place and keep focus on the
  // same control.
  function openSheet(html, title) {
    const root = $('#sheet-root');
    const existing = $('.sheet', root);
    if (existing) {
      const a = document.activeElement;
      const key = a && existing.contains(a) ? keyOf(a) : null;
      const top = existing.scrollTop;
      existing.innerHTML = html;
      existing.scrollTop = top;
      const found = key && existing.querySelector(key);
      (found && found.tagName !== 'SELECT' ? found : existing).focus({ preventScroll: true });
      return;
    }
    root.innerHTML = `<div class="overlay" data-scrim="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || '')}" tabindex="-1">${html}</div></div>`;
    $('.sheet', root).focus({ preventScroll: true });
  }
  function keyOf(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    for (const k of ['qty', 'paywith', 'who', 'add', 'addset', 'act']) if (el.dataset[k] != null) return `[data-${k}="${CSS.escape(el.dataset[k])}"]`;
    return null;
  }
  function closeSheet() { const r = $('#sheet-root'); if (r) r.innerHTML = ''; }
  const sheetHead = (title, sub, p) => `<div class="grab" aria-hidden="true"></div><div class="sheet-head">${p ? thumb(p) : ''}<div style="flex:1 1 auto;min-width:0"><h2>${esc(title)}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button type="button" class="icon-btn" data-act="close" aria-label="Close">${I.close}</button></div>`;
  const previewNote = () => readOnly() ? `<p class="preview-note">${esc(READ_ONLY)}</p>` : '';

  // ---------- confirm step for anything destructive ----------
  let pendingConfirm = null;
  function confirmAction({ title, body, keep, confirm, danger = true, onConfirm }) {
    pendingConfirm = onConfirm;
    const root = $('#confirm-root');
    root.innerHTML = `<div class="overlay confirm" data-confirm-scrim="1"><div class="sheet confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" tabindex="-1">
      <div class="confirm-icon ${danger ? 'danger' : ''}" aria-hidden="true">${I.warn}</div>
      <h2 id="confirm-title">${esc(title)}</h2>
      <div id="confirm-body" class="confirm-text"><p>${esc(body)}</p>${keep ? `<p class="keep">${esc(keep)}</p>` : ''}</div>
      <div class="confirm-actions">
        <button type="button" class="btn" data-confirm="no">Cancel</button>
        <button type="button" class="btn ${danger ? 'danger-solid' : 'dark'}" data-confirm="yes">${esc(confirm)}</button>
      </div></div></div>`;
    $('[data-confirm="no"]', root).focus();
  }
  function closeConfirm() { $('#confirm-root').innerHTML = ''; pendingConfirm = null; }

  // Every save goes through here: one place that refuses writes in preview.
  async function write(fn, onDone, errSel) {
    if (readOnly()) { toast('Saving is off in this read-only preview.'); return; }
    if (write.busy) return;
    write.busy = true;
    try { const r = await fn(); onDone(r); if (live()) loadData(true); }
    catch (e) { if (e.code === 'auth') { toast(e.message); return signOut(); } const el = errSel && $(errSel); if (el) el.textContent = e.message; else toast(e.message); }
    finally { write.busy = false; }
  }

  let sell = null;
  function openSell(productId) {
    if (!shown().some(p => p.quantity > 0)) return toast('Nothing is in stock to sell.');
    const names = staffNames();
    sell = { productId: productId || '', qty: 1, pay: CFG.payments[0].id, who: names.includes(S.lastSeller) ? S.lastSeller : (names.length === 1 ? names[0] : ''), note: '' };
    drawSell();
  }
  function drawSell() {
    const prods = shown();
    const p = prods.find(x => x.id === sell.productId);
    const inStock = prods.filter(x => x.quantity > 0).sort((a, b) => label(a).localeCompare(label(b)));
    const max = p ? p.quantity : 1;
    sell.qty = Math.min(Math.max(1, sell.qty), Math.max(1, max));
    const total = p ? sell.qty * p.sellPrice : 0;
    const payLabel = (CFG.payments.find(x => x.id === sell.pay) || {}).label || '';
    openSheet(`
      ${sheetHead('Record a sale', p ? `${money(p.sellPrice)} each · ${p.quantity} left` : 'Choose the product', p)}
      <label class="field" for="sell-product">Product
        <select id="sell-product"><option value="">Choose…</option>${inStock.map(x => `<option value="${esc(x.id)}" ${x.id === sell.productId ? 'selected' : ''}>${esc(label(x))} · ${money(x.sellPrice)} · ${x.quantity} left</option>`).join('')}</select>
      </label>
      <div class="panel"><div class="sum-row" style="align-items:center"><span style="font-weight:600">Quantity</span>
        <div class="stepper" style="gap:14px"><button type="button" data-qty="-1" aria-label="One fewer" style="width:44px;height:44px">−</button><output style="font-size:30px;min-width:40px" aria-live="polite">${sell.qty}</output><button type="button" class="plus" data-qty="1" aria-label="One more" style="width:44px;height:44px" ${!p || sell.qty >= max ? 'disabled' : ''}>+</button></div></div></div>
      <div class="field">Paid by<div class="seg" role="group" aria-label="Payment">${CFG.payments.map(x => `<button type="button" data-paywith="${esc(x.id)}" aria-pressed="${sell.pay === x.id}">${esc(x.label)}</button>`).join('')}</div></div>
      <div class="field">Sold by<div class="chips" role="group" aria-label="Staff">${staffNames().map(n => `<button type="button" class="chip" data-who="${esc(n)}" aria-pressed="${sell.who === n}">${esc(n)}</button>`).join('') || '<span class="muted small">Add staff names in Settings.</span>'}</div></div>
      <label class="field" for="sell-note">Note (optional)<textarea id="sell-note" rows="2" maxlength="300" placeholder="Discount, gift wrap, customer request">${esc(sell.note)}</textarea></label>
      <div class="pin-err" id="sell-err" role="alert" style="color:var(--bad)"></div>
      <div class="sum-row"><span class="muted">${sell.qty} × ${p ? money(p.sellPrice) : '—'} · ${esc(payLabel)}</span><b>${money(total)}</b></div>
      ${previewNote()}
      <button type="button" class="btn primary block" data-act="save-sale" ${readOnly() ? 'disabled' : ''}>${readOnly() ? 'Saving is off in this preview' : 'Save sale · ' + money(total)}</button>`, 'Record a sale');
  }
  function saveSale() {
    const err = m => { $('#sell-err').textContent = m; };
    if (!sell.productId) return err('Choose the product first.');
    if (!sell.who) return err('Tap your name under "Sold by".');
    write(() => backend().addSale(S.shop, { productId: sell.productId, quantity: sell.qty, paymentMethod: sell.pay, soldBy: sell.who, note: ($('#sell-note').value || '').trim() }),
      s => { S.lastSeller = sell.who; lsSet('b125_seller', sell.who); closeSheet(); renderView(); toast('Sale saved · ' + money(s.total)); }, '#sell-err');
  }

  let restock = null;
  function openRestock(id) {
    const p = shown().find(x => x.id === id);
    if (!p) return;
    restock = { id, add: 6, cost: p.costPrice > 0 ? p.costPrice : '' };
    drawRestock();
  }
  function drawRestock() {
    const p = shown().find(x => x.id === restock.id);
    openSheet(`
      ${sheetHead(label(p), `${p.quantity} on the shelf · sells for ${money(p.sellPrice)}`, p)}
      <div class="panel" style="align-items:center">
        <div class="muted">How many new pieces arrived?</div>
        <div class="stepper"><button type="button" data-add="-1" aria-label="One fewer">−</button><output aria-live="polite">${restock.add}</output><button type="button" class="plus" data-add="1" aria-label="One more">+</button></div>
        <div class="chips">${[6, 12, 24].map(n => `<button type="button" class="chip" data-addset="${n}">+${n}</button>`).join('')}</div>
        <div>Shelf after saving: <b>${p.quantity + restock.add}</b></div>
      </div>
      <label class="field" for="restock-cost">Cost per piece for this batch (฿)<input id="restock-cost" type="number" min="0" inputmode="decimal" value="${esc(restock.cost)}" placeholder="Cost price"><span class="hint">Saved with each sale from now on, so profit stays right if the price changes later.</span></label>
      <div class="pin-err" id="restock-err" role="alert" style="color:var(--bad)"></div>
      ${previewNote()}
      <button type="button" class="btn primary block" data-act="save-restock" ${readOnly() ? 'disabled' : ''}>${readOnly() ? 'Saving is off in this preview' : `Add ${restock.add} to stock`}</button>
      <p class="muted small" style="margin:0;text-align:center">This adds to the current count. It never overwrites it, so a sale made at the same moment isn’t lost.</p>`, 'Add stock');
  }
  function saveRestock() {
    write(() => backend().addStock(S.shop, { productId: restock.id, add: restock.add, costPrice: $('#restock-cost').value }),
      p => { closeSheet(); renderView(); toast(`Added ${restock.add} · ${p.quantity} on the shelf`); }, '#restock-err');
  }

  let editing = null;
  function openEdit(id) {
    const p = shown().find(x => x.id === id);
    if (!p) return;
    editing = { id };
    openSheet(`
      ${sheetHead('Edit product', esc(label(p)), p)}
      <form id="edit-form" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <label class="field" for="edit-name">Product name<input id="edit-name" name="name" value="${esc(p.name)}" required></label>
        <label class="field" for="edit-size">Size<input id="edit-size" name="size" value="${esc(p.size)}"></label>
        <div class="grid-2">
          <label class="field" for="edit-cost">Cost price (฿)<input id="edit-cost" name="costPrice" type="number" min="0" value="${p.costPrice || ''}" placeholder="Missing"></label>
          <label class="field" for="edit-sell">Sell price (฿)<input id="edit-sell" name="sellPrice" type="number" min="0" value="${p.sellPrice}"></label>
        </div>
        <label class="field" for="edit-qty">Quantity on the shelf<input id="edit-qty" name="quantity" type="number" min="0" value="${p.quantity}"><span class="hint">Use this to correct a count after a stock-take. For new deliveries, use + Stock.</span></label>
        <div class="pin-err" id="edit-err" role="alert" style="color:var(--bad)"></div>
        ${previewNote()}
        <button type="submit" class="btn primary block" ${readOnly() ? 'disabled' : ''}>${readOnly() ? 'Saving is off in this preview' : 'Save changes'}</button>
        <button type="button" class="btn danger" data-act="delete-product" ${readOnly() ? 'disabled' : ''}>Remove product…</button>
      </form>`, 'Edit product');
  }

  // ---------- events ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function go(route, filter) {
    if (!allowed(route)) return;
    S.route = route;
    if (filter) S.ui.stockFilter = filter;
    render();
    window.scrollTo(0, 0);
  }
  function signOut() { if (live()) { Backends.sheet.dropPass(S.shop); delete S.cache['sheet:' + S.shop]; } S.role = null; sess.del('b125_role'); closeSheet(); render(); }
  const noteNow = () => { const n = $('#sell-note'); if (n && sell) sell.note = n.value; };

  document.addEventListener('click', e => {
    const el = e.target.closest('button, [data-scrim], [data-confirm-scrim]');
    if (!el) return;
    if (el.dataset.confirmScrim && e.target === el) return closeConfirm();
    if (el.dataset.scrim && e.target === el) return closeSheet();
    const d = el.dataset;
    if (d.confirm) { const fn = pendingConfirm; closeConfirm(); if (d.confirm === 'yes' && fn) fn(); return; }
    if (d.key) return pressKey(d.key);
    if (d.shop && !S.role) { S.shop = d.shop; S._settings = null; S.connectErr = ''; return renderSignIn(); }
    if (d.mode && !S.role) { S.mode = d.mode; S.connectErr = ''; S.pin = ''; return renderSignIn(); }
    if (d.preview && !S.role) return enter(d.preview);
    if (d.go) return go(d.go, d.filter);
    if (d.period) { S.ui.period = d.period; return renderView(); }
    if (d.salesperiod) { S.ui.salesPeriod = d.salesperiod; return renderView(); }
    if (d.pay) { S.ui.salesPay = d.pay; return renderView(); }
    if (d.filterChip) { S.ui.stockFilter = d.filterChip; return fillOwnerStock(); }
    if (d.stafftab) { S.ui.staffTab = d.stafftab; return renderView(); }
    if (d.restock) return openRestock(d.restock);
    if (d.edit) return openEdit(d.edit);
    if (d.sell) return openSell(d.sell);
    if (d.qty) { noteNow(); sell.qty += Number(d.qty); return drawSell(); }
    if (d.paywith) { noteNow(); sell.pay = d.paywith; return drawSell(); }
    if (d.who) { noteNow(); sell.who = d.who; return drawSell(); }
    if (d.add) { restock.cost = $('#restock-cost').value; restock.add = Math.max(1, restock.add + Number(d.add)); return drawRestock(); }
    if (d.addset) { restock.cost = $('#restock-cost').value; restock.add = Number(d.addset); return drawRestock(); }
    if (d.themepick) { setTheme(d.themepick); return renderView(); }
    if (d.rmstaff) {
      const i = Number(d.rmstaff), n = staffNames()[i];
      return confirmAction({
        title: `Remove ${n} from staff names?`,
        body: `${n} won't appear under "Sold by" when recording a sale anymore.`,
        keep: `Their past sales stay in your reports under "${n}". You can add the name back any time.`,
        confirm: 'Remove name',
        onConfirm: () => { staffNames().splice(i, 1); saveSettings(); renderView(); toast(`${n} removed from staff names`); }
      });
    }
    switch (d.act) {
      case 'sell': return openSell('');
      case 'close': return closeSheet();
      case 'save-sale': return saveSale();
      case 'save-restock': return saveRestock();
      case 'refresh': return loadData(true).then(() => toast('Data refreshed'));
      case 'export': return exportCsv();
      case 'pin-later': return toast(isV6() ? 'Change PINs in the Google Sheet: Shop app menu → Set owner PIN / Set staff PIN.' : 'PINs are set up with the new script.');
      case 'retry-detect': delete Backends.sheet.info[S.shop]; S.connectErr = ''; return renderSignIn();
      case 'clear-tests': return (async () => {
        let t;
        try { t = await backend().previewTestData(S.shop); } catch (e) { return toast(e.message); }
        const n = t.products.length + t.sales.length;
        if (!n) return toast('There is no test data to clear.');
        const list = t.products.map(p => p.name).concat(t.sales.map(x => 'sale: ' + x.name)).slice(0, 8);
        return confirmAction({
          title: `Clear ${plural(n, 'test row')}?`,
          body: `This permanently removes ${plural(t.products.length, 'product')} and ${plural(t.sales.length, 'sale')} whose name starts with [TEST]: ${list.join('; ')}${n > list.length ? '…' : ''}`,
          keep: 'Only [TEST] rows are removed. Real products and sales are never touched.',
          confirm: 'Clear test data',
          onConfirm: () => write(() => backend().clearTestData(S.shop, { productIds: t.products.map(p => p.id), saleIds: t.sales.map(x => x.id) }),
            r => { renderView(); toast(`Removed ${plural(r.removed.products, 'product')} and ${plural(r.removed.sales, 'sale')}`); if (!live()) loadData(true); })
        });
      })();
      case 'signout-now': return signOut();
      case 'change-link': return confirmAction({
        title: 'Use a different script link?', danger: false,
        body: `This browser forgets the saved link for ${SHOPS[S.shop].name}, then asks for a new one.`,
        keep: 'Nothing in the sheet changes. The old owner and staff pages on this browser use the same saved link, so paste the right one back afterwards.',
        confirm: 'Forget link',
        onConfirm: () => { Backends.sheet.forget(S.shop); renderSignIn(); }
      });
      case 'forget-link': return confirmAction({
        title: 'Disconnect the live sheet?', danger: false,
        body: `This browser forgets the saved link for ${SHOPS[S.shop].name} and signs you out.`,
        keep: 'Nothing in the sheet changes. The old owner and staff pages on this browser use the same saved link, so they’ll ask for it again too.',
        confirm: 'Disconnect',
        onConfirm: () => { Backends.sheet.forget(S.shop); delete S.cache['sheet:' + S.shop]; S.mode = 'sheet'; signOut(); }
      });
      case 'signout': return confirmAction({
        title: 'Sign out of this phone?', danger: false,
        body: live() && readOnly() ? 'You’ll come back to the sign-in screen.' : `You'll need the ${S.role === 'owner' ? 'owner' : 'staff'} PIN to get back in.`,
        keep: 'Nothing in the shop data changes.',
        confirm: 'Sign out',
        onConfirm: signOut
      });
      case 'signout-all': return confirmAction({
        title: 'Sign every phone out?',
        body: 'All staff phones and this one will need the PIN again. Anyone mid-sale has to sign back in first.',
        keep: 'Sales and stock are not affected. Use this after a staff member leaves or a PIN is shared.',
        confirm: 'Sign all out',
        onConfirm: () => {
          if (isV6()) return write(() => backend().signOutAll(S.shop), () => { toast('Every phone is signed out.'); signOut(); });
          toast(live() ? 'This starts working with the new script.' : 'In the live app, every phone is now signed out.');
        }
      });
      case 'reset': return confirmAction({
        title: 'Reset the sample data?',
        body: 'Test sales, restocks and product changes you made in this demo will be undone.',
        keep: 'This only affects the demo. The real shop is never touched.',
        confirm: 'Reset demo',
        onConfirm: () => { Backends.demo.reset(S.shop); delete S.cache['demo:' + S.shop]; loadData(true).then(() => toast('Sample data reset.')); }
      });
      case 'delete-product': {
        const p = shown().find(x => x.id === editing.id);
        if (!p) return;
        const sold = data().sales.filter(x => x.productId === p.id).length;
        return confirmAction({
          title: `Remove ${label(p)}?`,
          body: `It disappears from the stock lists${p.quantity > 0 ? `, including the ${p.quantity} still counted on the shelf` : ''}. Its row stays in the sheet, marked as removed.`,
          keep: sold ? `Its ${plural(sold, 'past sale')} stay in your sales list and reports, with their cost. If it's only sold out, you can keep it and restock later instead.` : 'It has no sales yet.',
          confirm: 'Remove product',
          onConfirm: () => write(() => backend().deleteProduct(S.shop, p.id), () => { closeSheet(); renderView(); toast(`${label(p)} removed`); })
        });
      }
    }
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'sell-product') { noteNow(); sell.productId = e.target.value; sell.qty = 1; drawSell(); }
    if (e.target.id === 'low-at') { settings().lowAt = Number(e.target.value); saveSettings(); toast('Saved on this device'); }
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
    if ((e.target.id === 'add-cost' || e.target.id === 'add-sell') && $('#add-cost')) {
      const c = num($('#add-cost').value), s = num($('#add-sell').value);
      $('#add-margin').textContent = c > 0 && s > 0 ? `Profit ${money(s - c)} per piece · ${Math.round((s - c) / s * 100)}% margin` : '';
    }
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const v = k => (f.elements[k] && f.elements[k].value || '').trim();
    if (f.id === 'connect-form') {
      try { Backends.sheet.setLink(S.shop, $('#connect-url').value); S.connectErr = ''; } catch (err) { S.connectErr = err.message; }
      return renderSignIn();
    }
    if (f.id === 'add-form') {
      const err = $('#add-err');
      if (!v('name')) return (err.textContent = 'Give the product a name.');
      if (!(num(v('sellPrice')) > 0)) return (err.textContent = 'Enter a sell price above 0.');
      if (v('quantity') === '' || num(v('quantity')) < 0) return (err.textContent = 'Enter how many are on the shelf (0 or more).');
      return write(() => backend().addProduct(S.shop, { name: v('name'), size: v('size'), costPrice: S.role === 'owner' ? v('costPrice') : '', sellPrice: v('sellPrice'), quantity: v('quantity'), imageUrl: ($('#add-preview').dataset.img || ''), addedBy: S.role === 'owner' ? 'Owner' : (S.lastSeller || 'Staff') }),
        () => { toast('Product added'); go('stock'); }, '#add-err');
    }
    if (f.id === 'edit-form') {
      if (!v('name')) return ($('#edit-err').textContent = 'Give the product a name.');
      return write(() => backend().updateProduct(S.shop, editing.id, { name: v('name'), size: v('size'), costPrice: v('costPrice'), sellPrice: v('sellPrice'), quantity: v('quantity') }),
        () => { closeSheet(); renderView(); toast('Saved'); }, '#edit-err');
    }
    if (f.id === 'staff-form') {
      const n = cleanName($('#staff-new').value);
      if (n !== 'Unknown' && !staffNames().includes(n)) { staffNames().push(n); saveSettings(); }
      return renderView();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#confirm-root') && $('#confirm-root').innerHTML) return closeConfirm(); if ($('#sheet-root') && $('#sheet-root').innerHTML) closeSheet(); }
    if (!S.role && S.mode === 'demo' && !(e.target && e.target.tagName === 'INPUT')) {
      if (/^[0-9]$/.test(e.key)) pressKey(e.key);
      if (e.key === 'Backspace') pressKey('⌫');
    }
  });

  if (!S.role && S.mode === 'sheet') {
    const pass = Backends.sheet.pass(S.shop);
    if (pass) { S.role = pass.role; sess.set('b125_role', pass.role); }
  }
  if (S.role) loadData(false);
  render();
})();
