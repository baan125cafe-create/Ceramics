// Checks Code.gs against the pretend sheet. Run: node apps-script/test.js
// Nothing here talks to Google.
'use strict';
const vm = require('vm');
const { makeContext, seed } = require('./local-sheet.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const ctx = makeContext(seed());
const C = b => ctx.call(b);
const rows = n => ctx.__sheets[n].data;

const v = C({ action: 'getVersion' });
ok(v.version === 6 && v.pinsSet === true, 'version ' + JSON.stringify(v));
ok(/Unknown action/.test(C({ action: 'deleteEverything' }).error), 'unknown action refused');
ok(C({ action: 'getAll' }).code === 'auth', 'getAll needs sign-in');
ok(C({ action: 'addSale', productId: 'PRD-1', quantity: 1, paymentMethod: 'cash' }).code === 'auth', 'write needs sign-in');

const staff = C({ action: 'login', pin: '135791' });
ok(staff.role === 'staff' && staff.token, 'staff login');
const owner = C({ action: 'login', pin: '246810' });
ok(owner.role === 'owner', 'owner login');
const sa = C({ action: 'getAll', token: staff.token });
ok(sa.products.every(p => !('costPrice' in p)) && sa.sales.every(s => !('total' in s)), 'staff sees no costs or totals');
const oa = C({ action: 'getAll', token: owner.token });
ok(oa.products[0].costPrice === 160 && oa.sales.length === 40, 'owner sees everything');
ok(C({ action: 'addStock', token: staff.token, productId: 'PRD-1', add: 3 }).code === 'forbidden', 'staff cannot restock');
ok(C({ action: 'archiveProduct', token: staff.token, id: 'PRD-1' }).code === 'forbidden', 'staff cannot remove');
ok(C({ action: 'clearTestData', token: staff.token }).code === 'forbidden', 'staff cannot clear test data');

// Sales: the server sets price, total and cost, whatever the phone sends.
const s1 = C({ action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 2, paymentMethod: 'qr', soldBy: 'Milk', total: 1, sellPrice: 1 });
ok(s1.success && s1.sale.total === 900 && s1.sale.costPrice === 160 && s1.newQuantity === 4, 'sale computed on server ' + JSON.stringify(s1));
const hdr = rows('Sales')[0];
ok(hdr.includes('costPrice') && hdr.indexOf('note') === 10, 'costPrice column added, existing note column kept in place');
const last = rows('Sales')[rows('Sales').length - 1];
ok(last[hdr.indexOf('paymentMethod')] === 'qr' && last[hdr.indexOf('costPrice')] === 160, 'row written by column name');
ok(/Cash, Card or QR/.test(C({ action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 1, paymentMethod: 'credit' }).error), 'old label refused for new sales');
ok(/Only 4 left/.test(C({ action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 9, paymentMethod: 'cash' }).error), 'cannot sell more than the shelf holds');
ok(/\[TEST\] product/.test(C({ action: 'addSale', token: staff.token, productId: 'PRD-1', quantity: 1, paymentMethod: 'cash', note: '[TEST] try' }).error), 'test sale on a real product refused');

// Restock adds to the count.
ok(C({ action: 'addStock', token: owner.token, productId: 'PRD-1', add: 6, costPrice: 170 }).quantity === 10, 'restock adds');

// Test data: only [TEST] rows can ever be cleared.
const tp = C({ action: 'addProduct', token: staff.token, name: '[TEST] mug', sellPrice: 100, quantity: 5, costPrice: 40 });
ok(tp.success, 'staff adds a test product');
ok(C({ action: 'addSale', token: staff.token, productId: tp.product.id, quantity: 1, paymentMethod: 'card', soldBy: 'Milk' }).success, 'test sale on a test product');
const prev = C({ action: 'previewTestData', token: owner.token });
ok(prev.products.length === 1 && prev.sales.length === 1, 'preview lists only test rows');
const pBefore = rows('Products').length, sBefore = rows('Sales').length;
const cl = C({ action: 'clearTestData', token: owner.token, productIds: prev.products.map(x => x.id).concat(['PRD-1']), saleIds: prev.sales.map(x => x.id).concat(['SALE-0']) });
ok(cl.removed.products === 1 && cl.removed.sales === 1, 'clear removes only test rows, even if real ids are sent');
ok(rows('Products').length === pBefore - 1 && rows('Sales').length === sBefore - 1, 'real rows untouched');

// Remove = archive: the row stays.
C({ action: 'archiveProduct', token: owner.token, id: 'PRD-2' });
const ah = rows('Products')[0];
ok(ah.includes('archived') && rows('Products').find(r => r[0] === 'PRD-2')[ah.indexOf('archived')], 'remove marks the row and keeps it');
ok(/removed/.test(C({ action: 'addSale', token: staff.token, productId: 'PRD-2', quantity: 1, paymentMethod: 'cash' }).error), 'cannot sell a removed product');

// Settings live in the sheet.
const st = C({ action: 'saveSettings', token: owner.token, staff: ['Milk', ' Nok '], lowAt: 2 });
ok(JSON.stringify(st.settings) === JSON.stringify({ staff: ['Milk', 'Nok'], lowAt: 2 }), 'settings saved');
ok(C({ action: 'getAll', token: staff.token }).settings.staff.length === 2, 'staff phones get the same list');

// Wrong PINs pause sign-in for everyone and email the owner.
let res; for (let i = 0; i < 5; i++) res = C({ action: 'login', pin: '000000' });
ok(res.locked === 15 && ctx.__mails.length === 1, 'pause after 5 wrong PINs, owner emailed');
ok(C({ action: 'login', pin: '246810' }).locked, 'right PIN refused while paused');
ok(C({ action: 'getAll', token: staff.token }).role === 'staff', 'signed-in phones keep working during a pause');
ctx.__props.LOGIN_PAUSE_UNTIL = '0';
for (let i = 0; i < 5; i++) res = C({ action: 'login', pin: '000000' });
ok(res.locked === 60, 'second pause is 1 hour');
ctx.__props.LOGIN_PAUSE_UNTIL = '0';

// Sign all out, and expiry.
const o2 = C({ action: 'login', pin: '246810' });
ok(o2.token, 'owner signs in after the pause');
C({ action: 'signOutAll', token: o2.token });
ok(C({ action: 'getAll', token: staff.token }).code === 'auth' && C({ action: 'getAll', token: o2.token }).code === 'auth', 'sign all out ends every pass');
const o3 = C({ action: 'login', pin: '246810' });
const key = Object.keys(ctx.__props).find(k => k.startsWith('pass_') && JSON.parse(ctx.__props[k]).r === 'owner');
const pv = JSON.parse(ctx.__props[key]); pv.e = Date.now() - 1; ctx.__props[key] = JSON.stringify(pv);
ok(C({ action: 'getAll', token: o3.token }).code === 'auth', 'expired pass refused');
ok(!Object.values(ctx.__props).some(x => /246810|135791/.test(x)), 'PINs stored only as scrambled values');

// Reports leave test sales out and use the new labels.
const o4 = C({ action: 'login', pin: '246810' });
C({ action: 'addProduct', token: o4.token, name: '[TEST] plate', sellPrice: 999, quantity: 3 });
const tp2 = C({ action: 'getAll', token: o4.token }).products.find(p => p.name === '[TEST] plate');
C({ action: 'addSale', token: o4.token, productId: tp2.id, quantity: 1, paymentMethod: 'cash', soldBy: 'Milk' });
const today = vm.runInContext('bkkDay_(new Date())', ctx);
const rep = vm.runInContext(`report_('${today}', '${today}', 'Daily', 'x')`, ctx);
ok(!/999/.test(rep.html) && /QR code/.test(rep.html), 'report leaves out the test sale and shows QR code');

console.log(`script checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
