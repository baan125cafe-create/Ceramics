// Sample data for demo mode. Made-up products and sales only:
// demo mode never talks to Google, so nothing here can touch the real sheet.
// The same seed always produces the same shop, ending on today's date.
(function () {
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // [name, size, cost, sell, qty on shelf, popularity]
  const CATALOG = {
    baan: [
      ['Lotus mug', '300ml', 160, 450, 2, 9],
      ['Sea-glaze bowl', '15cm', 190, 520, 9, 7],
      ['Speckled plate', '24cm', 0, 590, 6, 6],
      ['Bud vase', 'small', 120, 380, 0, 6],
      ['Incense holder', '', 85, 290, 1, 5],
      ['Tea cup set', '4 pcs', 480, 1250, 4, 3],
      ['Ash-glaze tumbler', '350ml', 150, 420, 0, 5],
      ['Ring dish', '', 60, 220, 14, 6],
      ['Moon jar', 'mini', 320, 890, 0, 2],
      ['Leaf spoon rest', '', 0, 180, 11, 4],
      ['Rice bowl', '12cm', 110, 320, 18, 6],
      ['Pour-over dripper', '', 260, 780, 3, 3],
      ['Soy sauce dish', '8cm', 40, 150, 24, 5],
      ['Celadon teapot', '600ml', 620, 1690, 2, 2],
      ['Salt pig', '', 140, 390, 7, 2],
      ['Wave planter', 'medium', 210, 650, 5, 3],
      ['Shell trinket tray', '', 0, 260, 9, 3],
      ['Espresso cup', '90ml', 90, 280, 12, 4],
      ['Candle vessel', '', 130, 360, 0, 3],
      ['Serving platter', '36cm', 520, 1450, 1, 1],
      ['Chopstick rest pair', '', 35, 120, 30, 4],
      ['Noodle bowl', '18cm', 0, 560, 8, 3],
      ['Pitcher', '1L', 380, 980, 3, 1],
      ['Stoneware mug', '400ml', 170, 480, 10, 5]
    ],
    chud: [
      ['Linen shirt', 'M', 420, 1290, 4, 5],
      ['Linen shirt', 'L', 420, 1290, 2, 4],
      ['Batik scarf', '', 180, 590, 12, 6],
      ['Wrap skirt', 'Free size', 350, 990, 0, 4],
      ['Cotton tote', '', 90, 350, 20, 7],
      ['Fisherman pants', 'Free size', 160, 490, 9, 8],
      ['Indigo kimono jacket', '', 0, 1890, 3, 2],
      ['Beach dress', 'S', 300, 1150, 1, 3],
      ['Beach dress', 'M', 300, 1150, 0, 3],
      ['Bucket hat', '', 120, 390, 6, 4],
      ['Woven belt', '', 0, 290, 8, 3],
      ['Kids romper', '2–3y', 190, 590, 5, 2]
    ]
  };

  const STAFF = ['Nok', 'Fern', 'Owner'];
  const NAME_VARIANTS = { Nok: ['Nok', 'Nok', 'Nok', 'nok', 'Nok '], Fern: ['Fern', 'Fern', 'fern'], Owner: ['Owner'] };

  function bkkDate(d) { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }

  window.makeDemoData = function (shop) {
    const key = shop === 'chud' ? 'chud' : 'baan';
    const r = rng(key === 'baan' ? 125 : 77);
    const base = new Date(Date.UTC(2026, 0, 1));
    const products = CATALOG[key].map((p, i) => ({
      id: 'PRD-DEMO-' + (i + 1),
      name: p[0], size: p[1], costPrice: p[2], sellPrice: p[3], quantity: p[4],
      imageUrl: '', addedBy: 'Owner', createdAt: new Date(base.getTime() + i * 86400000 * 3).toISOString(),
      _pop: p[5]
    }));
    const weights = products.map(p => p._pop);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let x = r() * totalW; for (let i = 0; i < products.length; i++) { x -= weights[i]; if (x <= 0) return products[i]; } return products[products.length - 1]; };

    const sales = [];
    const now = new Date();
    const DAYS = 400;
    // New sale rows save the cost price at the moment of sale (proposed fix);
    // older rows don't have it, like the real sheet today.
    const costSnapshotFromDay = DAYS - 21;
    let n = 0;
    for (let d = DAYS; d >= 0; d--) {
      const day = new Date(now.getTime() - d * 86400000);
      const dateStr = bkkDate(day);
      const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
      const growth = 0.75 + 0.5 * ((DAYS - d) / DAYS);
      const season = 1 + 0.25 * Math.sin((DAYS - d) / 58);
      let count = Math.round((key === 'baan' ? 6 : 4) * growth * season * (dow === 0 || dow === 6 ? 1.6 : 1) * (0.55 + r() * 0.9));
      if (d === 0) count = Math.min(count, 9);
      for (let k = 0; k < count; k++) {
        const p = pick();
        const qty = r() < 0.82 ? 1 : 2;
        const hour = 10 + Math.floor(r() * 10.99);
        if (d === 0 && hour > Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }))) continue;
        const minute = Math.floor(r() * 60);
        const who = STAFF[r() < 0.45 ? 0 : (r() < 0.62 ? 1 : 2)];
        const variants = NAME_VARIANTS[who];
        const createdAt = new Date(dateStr + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00+07:00').toISOString();
        const sale = {
          id: 'SALE-DEMO-' + (++n), productId: p.id, productName: p.name + (p.size ? ' · ' + p.size : ''),
          quantity: qty, sellPrice: p.sellPrice, total: qty * p.sellPrice,
          paymentMethod: r() < 0.4 ? 'cash' : 'credit',
          saleDate: dateStr, soldBy: variants[Math.floor(r() * variants.length)],
          note: r() < 0.06 ? 'Gift wrap' : '', createdAt
        };
        if (DAYS - d >= costSnapshotFromDay && p.costPrice > 0) sale.costPrice = p.costPrice;
        sales.push(sale);
      }
    }
    products.forEach(p => { delete p._pop; });
    return { products, sales, staff: STAFF.slice() };
  };
})();
