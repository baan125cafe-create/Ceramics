// Checks the API against a throwaway local database with made-up data.
// Run: npm test   (starts the API on port 8799; nothing touches Cloudflare or the real data)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.join(root, '.wrangler', 'test-state');
const PORT = 8799, API = `http://localhost:${PORT}`;
fs.rmSync(state, { recursive: true, force: true });

// Test PINs for this throwaway database only.
const scramble = pin => { const s = crypto.randomBytes(8).toString('hex'); return s + ':' + crypto.createHash('sha256').update(s + pin).digest('hex'); };
const vars = path.join(root, '.wrangler', 'test.vars');
fs.mkdirSync(path.dirname(vars), { recursive: true });
fs.writeFileSync(vars, ['BAAN_OWNER_PIN_HASH=' + scramble('246810'), 'BAAN_STAFF_PIN_HASH=' + scramble('135791'), 'CHUD_OWNER_PIN_HASH=' + scramble('864200'), 'CHUD_STAFF_PIN_HASH=' + scramble('975310')].join('\n'));

const wr = (...a) => execFileSync('npx', ['wrangler', ...a], { cwd: root, stdio: 'pipe' });
wr('d1', 'execute', 'shop-db', '--local', '--persist-to', state, '--file', 'schema.sql');
const seed = path.join(state, 'seed.sql');
fs.writeFileSync(seed, `
INSERT INTO products (shop,id,name,size,costPrice,sellPrice,quantity,imageUrl,addedBy,createdAt) VALUES
 ('baan','PRD-1','Lotus mug','300ml',160,450,6,'','Milk','2026-06-12T03:00:00Z'),
 ('baan','PRD-2','Bud vase','',0,380,2,'','Milk','2026-06-12T03:00:00Z'),
 ('chud','PRD-9','Olive shirt','',1500,2990,1,'','PB','2026-06-17T05:00:00Z');
INSERT INTO sales (shop,id,productId,productName,quantity,sellPrice,total,paymentMethod,saleDate,soldBy,createdAt,note) VALUES
 ('baan','SALE-1','PRD-1','Lotus mug',1,450,450,'credit','2026-06-14','PB','2026-06-14T08:00:00Z',''),
 ('chud','SALE-2','PRD-9','Olive shirt',1,2990,2990,'alipay','2026-06-20','PB','2026-06-20T08:00:00Z','');
`);
wr('d1', 'execute', 'shop-db', '--local', '--persist-to', state, '--file', seed);

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', state, '--env-file', vars, '--test-scheduled'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', d => { log += d; }); dev.stderr.on('data', d => { log += d; });
// Stop wrangler and the local runtime it started (the whole process group).
const stop = code => {
  const kill = sig => { try { process.kill(-dev.pid, sig); } catch (e) { /* already gone */ } };
  kill('SIGINT');
  setTimeout(() => { kill('SIGKILL'); process.exit(code); }, 1500);
};
for (let i = 0; ; i++) {
  try { await fetch(API + '/baan', { method: 'POST', body: '{"action":"getVersion"}' }); break; }
  catch (e) { if (i > 120) { console.log(log); stop(1); } await new Promise(r => setTimeout(r, 500)); }
}

let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL:', m); } };
const C = async (shop, body) => (await fetch(`${API}/${shop}`, { method: 'POST', body: JSON.stringify(body) })).json();

try {
  const v = await C('baan', { action: 'getVersion' });
  ok(v.version === 7 && v.pinsSet && v.backend === 'cloudflare', 'version ' + JSON.stringify(v));
  ok(/Unknown action/.test((await C('baan', { action: 'dropTables' })).error), 'unknown action refused');
  ok((await (await fetch(API + '/nope', { method: 'POST', body: '{}' })).json()).error === 'Not found', 'unknown shop refused');
  ok((await C('baan', { action: 'getAll' })).code === 'auth', 'getAll needs sign-in');

  const staff = await C('baan', { action: 'login', pin: '135791' });
  const owner = await C('baan', { action: 'login', pin: '246810' });
  ok(staff.role === 'staff' && owner.role === 'owner', 'logins');
  ok((await C('chud', { action: 'getAll', token: owner.token })).code === 'auth', 'a Baan pass does not open ChudPak');
  ok((await C('chud', { action: 'login', pin: '246810' })).left === 4, 'Baan PIN is wrong for ChudPak');

  const sa = await C('baan', { action: 'getAll', token: staff.token });
  ok(sa.products.every(p => !('costPrice' in p)) && sa.sales.every(s => !('total' in s) && !('sellPrice' in s)), 'staff get no costs or money');
  const oa = await C('baan', { action: 'getAll', token: owner.token });
  ok(oa.products.length === 2 && oa.products[0].costPrice === 160 && oa.sales.length === 1 && oa.sales[0].paymentMethod === 'credit', 'owner sees everything, old labels kept');
  ok(JSON.stringify(oa.settings.payments.map(p => p.id)) === '["cash","card","qr"]', 'default payment types');
  for (const a of ['addStock', 'updateProduct', 'archiveProduct', 'saveSettings', 'signOutAll', 'previewTestData', 'clearTestData'])
    ok((await C('baan', { action: a, token: staff.token, id: 'PRD-1', productId: 'PRD-1', add: 1 })).code === 'forbidden', 'staff cannot ' + a);

  const s1 = await C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 2, paymentMethod: 'qr', soldBy: 'Lin', total: 1, sellPrice: 1 });
  ok(s1.success && s1.sale.total === 900 && s1.sale.costPrice === 160 && s1.newQuantity === 4 && s1.sale.productName === 'Lotus mug · 300ml', 'server sets price, total, cost ' + JSON.stringify(s1));
  ok(/Choose one of/.test((await C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 1, paymentMethod: 'credit' })).error), 'old label refused for new sales');
  ok(/Only 4 left/.test((await C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 9, paymentMethod: 'cash' })).error), 'cannot oversell');
  // Two phones selling the last 2 pieces at once: only enough for one of the three.
  const race = await Promise.all([0, 1, 2].map(() => C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-2', quantity: 2, paymentMethod: 'cash' })));
  ok(race.filter(r => r.success).length === 1, 'simultaneous sales cannot oversell ' + JSON.stringify(race.map(r => r.error || 'ok')));
  ok(/test product/.test((await C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 1, paymentMethod: 'cash', note: '[TEST] x' })).error), 'test sale on a real product refused');

  ok((await C('baan', { action: 'addStock', token: owner.token, productId: 'PRD-1', add: 6, costPrice: 170 })).quantity === 10, 'restock adds');

  const tp = await C('baan', { action: 'addProduct', token: staff.token, name: 'Test mug', sellPrice: 100, quantity: 5, costPrice: 40 });
  ok(tp.success && tp.product.costPrice === 0, 'staff add ignores cost');
  await C('baan', { action: 'addSale', token: staff.token, productId: tp.product.id, quantity: 1, paymentMethod: 'card' });
  await C('baan', { action: 'addProduct', token: staff.token, name: 'bowl [TEST]', sellPrice: 50, quantity: 1 });
  await C('baan', { action: 'addProduct', token: staff.token, name: 'Latest vase', sellPrice: 50, quantity: 1 });
  const prev = await C('baan', { action: 'previewTestData', token: owner.token });
  ok(prev.products.map(x => x.name).sort().join() === 'Test mug,bowl [TEST]' && prev.sales.length === 1, 'preview lists only test rows (any case, whole word) ' + JSON.stringify(prev.products.map(x => x.name)));
  const cl = await C('baan', { action: 'clearTestData', token: owner.token, productIds: prev.products.map(x => x.id).concat('PRD-1'), saleIds: prev.sales.map(x => x.id).concat('SALE-1') });
  ok(cl.removed.products === 2 && cl.removed.sales === 1, 'clear removes only test rows');
  const after = await C('baan', { action: 'getAll', token: owner.token });
  ok(after.products.some(p => p.id === 'PRD-1') && after.products.some(p => p.name === 'Latest vase') && after.sales.some(s => s.id === 'SALE-1'), 'real rows untouched ("Latest" is not a test)');

  await C('baan', { action: 'archiveProduct', token: owner.token, id: 'PRD-1' });
  ok(/removed/.test((await C('baan', { action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 1, paymentMethod: 'cash' })).error), 'cannot sell a removed product');
  ok((await C('baan', { action: 'updateProduct', token: owner.token, id: 'PRD-2', name: 'Bud vase', sellPrice: 400, quantity: 3, costPrice: 90 })).success, 'owner edits');

  // Payment types: editable, ids frozen, removed ones kept as retired.
  const ps = await C('chud', { action: 'login', pin: '864200' });
  const st = await C('chud', { action: 'saveSettings', token: ps.token, payments: [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Credit card' }, { label: 'Alipay' }], staff: ['PB', ' Lin '], lowAt: 2 });
  ok(JSON.stringify(st.settings.payments) === JSON.stringify([{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Credit card' }, { id: 'alipay', label: 'Alipay' }, { id: 'qr', label: 'QR code', retired: true }]), 'payment types saved ' + JSON.stringify(st.settings.payments));
  ok(/Choose one of: Cash, Credit card, Alipay/.test((await C('chud', { action: 'addSale', token: ps.token, productId: 'PRD-9', quantity: 1, paymentMethod: 'qr' })).error), 'retired type refused for new sales');
  const cs = await C('chud', { action: 'getAll', token: ps.token });
  ok(cs.sales[0].paymentMethod === 'alipay' && cs.settings.staff.join() === 'PB,Lin', 'old sales unchanged; staff saved');
  ok(/at least one/.test((await C('chud', { action: 'saveSettings', token: ps.token, payments: [{ id: 'cash', label: 'Cash', retired: true }] })).error), 'cannot switch every type off');

  // Photos go to R2 and are served back.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const up = await C('baan', { action: 'uploadImage', token: staff.token, mimeType: 'image/png', imageData: png });
  ok(/^\/img\/baan\/[\w.-]+\.png$/.test(up.imageUrl), 'photo saved ' + JSON.stringify(up));
  const img = await fetch(API + up.imageUrl);
  ok(img.ok && img.headers.get('content-type') === 'image/png' && (await img.arrayBuffer()).byteLength === 68, 'photo served');
  ok((await fetch(API + '/img/../secret')).status === 404, 'odd photo paths refused');
  const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  ok(/Only photos/.test((await C('baan', { action: 'uploadImage', token: staff.token, mimeType: 'image/png', imageData: html })).error || ''), 'non-image refused even when labelled as a photo');

  // Wrong PINs pause sign-in for that shop only.
  let res; for (let i = 0; i < 5; i++) res = await C('baan', { action: 'login', pin: '000000' });
  ok(res.locked === 15, 'pause after 5 wrong PINs');
  ok((await C('baan', { action: 'login', pin: '246810' })).locked, 'right PIN refused while paused');
  ok((await C('baan', { action: 'getAll', token: staff.token })).role === 'staff', 'signed-in phones keep working');
  ok((await C('chud', { action: 'login', pin: '975310' })).role === 'staff', 'other shop not paused');

  // Sign all out.
  await C('chud', { action: 'signOutAll', token: ps.token });
  ok((await C('chud', { action: 'getAll', token: ps.token })).code === 'auth', 'sign all out ends passes');
  ok((await C('baan', { action: 'getAll', token: owner.token })).role === 'owner', 'other shop still signed in');

  // CORS: the GitHub Pages site and localhost may call it; other sites get no permission.
  const o1 = await fetch(API + '/baan', { method: 'POST', body: '{"action":"getVersion"}', headers: { Origin: 'https://baan125cafe-create.github.io' } });
  const o2 = await fetch(API + '/baan', { method: 'POST', body: '{"action":"getVersion"}', headers: { Origin: 'https://evil.example' } });
  ok(o1.headers.get('access-control-allow-origin') === 'https://baan125cafe-create.github.io' && !o2.headers.get('access-control-allow-origin'), 'CORS limited to the shop site');

  // Manual report: owner only; without an email key it explains what's missing.
  ok((await C('baan', { action: 'sendReport', token: staff.token, kind: 'daily' })).code === 'forbidden', 'staff cannot send reports');
  { const sr = await C('baan', { action: 'sendReport', token: owner.token, kind: 'daily' }); ok(/isn’t set up/.test(sr.error || ''), 'send report explains missing email setup ' + JSON.stringify(sr)); }
  ok(/look like an email/.test((await C('baan', { action: 'sendReport', token: owner.token, kind: 'daily', to: 'not an email' })).error || ''), 'test address must be a valid email');
  ok(!('reportTo' in (await C('baan', { action: 'getAll', token: owner.token })).settings), 'no report addresses are stored');

  // Reports: run the daily job (no email key here, so it just must not fail).
  const cron = await fetch(API + '/__scheduled?cron=30+16+*+*+*');
  ok(cron.ok, 'daily report job runs');
} catch (e) {
  failN++; console.log('ERROR', e);
}
if (failN) fs.writeFileSync(path.join(root, '.wrangler', 'test-dev.log'), log);
console.log(`api checks: ${pass} passed, ${failN} failed`);
stop(failN ? 1 : 0);
