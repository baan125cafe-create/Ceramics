// ============================================================
// Baan 125 Ceramic — Reports v2 (Daily + Monthly) + Sale Note support
// Paste this as a NEW file in Apps Script (+ → Script → name it "Reports_v2").
// Then DELETE the old sendDailySalesReport() and sendMonthlySalesReport()
// functions from your other files (keep createDailyTrigger / createMonthlyTrigger).
// Triggers keep working because the function names are the same.
// ============================================================

// ------------------------------------------------------------
// STEP 1 of 2 — in your existing addSale() (in Code.gs), add these 2 lines
// right AFTER the line  sheet.appendRow([...]);  and BEFORE  return ...
//
//     const noteCol = ensureColumn(sheet, 'note');
//     sheet.getRange(sheet.getLastRow(), noteCol).setValue(data.note || '');
//
// That's the only change to Code.gs. Do not touch getAll / checkPassword.
// ------------------------------------------------------------

const REPORT_BRAND = 'Ceramic';          // shows in email subject
const REPORT_TZ = 'Asia/Bangkok';           // Phuket time, always

// ---------- Note column ----------
// Adds a header to the Sales sheet only if it is missing. Returns its column number.
// Never moves or rewrites existing columns.
function ensureColumn(sheet, name) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(name);
  if (idx >= 0) return idx + 1;
  const col = headers.filter(String).length ? lastCol + 1 : 1;
  sheet.getRange(1, col).setValue(name);
  return col;
}

// Run ONCE by hand (select it in the toolbar → Run). Safe to run again — it does nothing the 2nd time.
function migrateAddNoteColumn() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales');
  if (!sheet) throw new Error('Sales sheet not found');
  const col = ensureColumn(sheet, 'note');
  Logger.log('note column = ' + col);
}

// ---------- Shared helpers ----------
function readSales_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).filter(r => r.join('') !== '').map(row => {
    const o = {}; headers.forEach((h, i) => o[h] = row[i]); return o;
  });
}
function saleDay_(s) {
  return s.saleDate instanceof Date
    ? Utilities.formatDate(s.saleDate, REPORT_TZ, 'yyyy-MM-dd')
    : String(s.saleDate || '').substring(0, 10);
}
function money_(n) { return '฿' + Math.round(Number(n) || 0).toLocaleString(); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function payName_(m) { return ({cash:'Cash', card:'Card', scan:'Scan/QR', alipay:'Alipay', credit:'Card'})[String(m || '').toLowerCase()] || String(m || ''); }
function isCash_(s) { return String(s.paymentMethod || '').toLowerCase() === 'cash'; }
function prettyDay_(ymd) { // 2026-08-11 -> 11 Aug
  const p = ymd.split('-'); return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2], 12), REPORT_TZ, 'd MMM');
}

const TH_ = 'padding:8px 12px;font-size:11px;color:#8a7968';
const TD_ = 'padding:8px 12px;border-bottom:1px solid #f0e8dc';

function header_(title, sub1, sub2) {
  return `<div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
    <div style="color:#e8a878;font-size:22px;font-weight:700">Baan 125 ${REPORT_BRAND}</div>
    <div style="color:#8a7968;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${title}</div>
    <div style="color:#faf6ef;font-size:16px;font-weight:600;margin-top:8px">${sub1}</div>
    <div style="color:#8a7968;font-size:12px;margin-top:4px">${sub2}</div></div>`;
}
function cards_(list) {
  const total = list.reduce((t, s) => t + Number(s.total || 0), 0);
  const cash = list.filter(isCash_).reduce((t, s) => t + Number(s.total || 0), 0);
  const cell = (label, val, color) => `<td style="background:white;border-radius:10px;padding:14px;text-align:center">
    <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${color}">${money_(val)}</div></td>`;
  return `<table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px"><tr>
    ${cell('Total', total, '#8b4e20')}${cell('Cash', cash, '#27ae60')}${cell('Card / QR', total - cash, '#3b5bdb')}</tr></table>`;
}
function box_(title, head, rows) {
  return `<div style="background:white;border-radius:10px;margin-bottom:16px;overflow:hidden">
    <div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">${title}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f2ebe0">${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function staffBox_(list) {
  const m = {};
  list.forEach(s => { const n = s.soldBy || 'Unknown'; m[n] = m[n] || {c: 0, t: 0}; m[n].c++; m[n].t += Number(s.total || 0); });
  const rows = Object.entries(m).sort((a, b) => b[1].t - a[1].t).map(([n, v]) =>
    `<tr><td style="${TD_}">${esc_(n)}</td><td style="${TD_};text-align:center">${v.c}</td><td style="${TD_};text-align:right;font-weight:600">${money_(v.t)}</td></tr>`).join('');
  return box_('Sales by Staff', `<th style="${TH_};text-align:left">Staff</th><th style="${TH_};text-align:center">Sales</th><th style="${TH_};text-align:right">Total</th>`, rows);
}
function wrap_(inner, footer) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#faf6ef;padding:24px;border-radius:16px">${inner}
    <div style="text-align:center;margin-top:16px;font-size:11px;color:#8a7968">${footer}</div></div>`;
}
function send_(subject, html) {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), subject, 'Please view this email in HTML format.', { htmlBody: html });
}

// ---------- DAILY (trigger: every day ~23:30) ----------
function sendDailySalesReport() {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, REPORT_TZ, 'yyyy-MM-dd');
  const dateFormatted = Utilities.formatDate(now, REPORT_TZ, 'd MMM yyyy');
  const list = readSales_().filter(s => saleDay_(s) === todayStr);
  if (!list.length) return; // no email on days with no sales

  const rows = list.map(s => `<tr>
      <td style="${TD_}">${esc_(s.productName)}${s.note ? `<div style="font-size:11px;color:#b7791f;margin-top:2px">Note: ${esc_(s.note)}</div>` : ''}</td>
      <td style="${TD_};text-align:center">${Number(s.quantity) || 1}</td>
      <td style="${TD_};text-align:center">${payName_(s.paymentMethod)}</td>
      <td style="${TD_};text-align:right;font-weight:600">${money_(s.total)}</td></tr>`).join('');

  const html = wrap_(
    header_('Daily Sales Report', dateFormatted, list.length + ' transactions') +
    cards_(list) +
    box_('Items Sold', `<th style="${TH_};text-align:left">Product</th><th style="${TH_};text-align:center">Qty</th><th style="${TH_};text-align:center">Payment</th><th style="${TH_};text-align:right">Total</th>`, rows) +
    staffBox_(list),
    'Baan 125 ' + REPORT_BRAND + ' — Daily Report');

  send_('Baan 125 ' + REPORT_BRAND + ' — Daily Report — ' + dateFormatted, html);
}

// ---------- MONTHLY (trigger: 1st of month ~10:30, reports LAST month) ----------
function sendMonthlySalesReport() {
  const now = new Date();
  const y = +Utilities.formatDate(now, REPORT_TZ, 'yyyy');
  const m = +Utilities.formatDate(now, REPORT_TZ, 'M');
  const last = new Date(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 15);
  const monthKey = Utilities.formatDate(last, REPORT_TZ, 'yyyy-MM');
  const monthName = Utilities.formatDate(last, REPORT_TZ, 'MMMM yyyy');
  const subject = 'Baan 125 ' + REPORT_BRAND + ' — Monthly Report — ' + monthName;

  const list = readSales_().filter(s => saleDay_(s).substring(0, 7) === monthKey)
    .sort((a, b) => saleDay_(a).localeCompare(saleDay_(b)));

  if (!list.length) {
    send_(subject, wrap_(header_('Monthly Sales Report', monthName, '0 transactions') +
      '<div style="text-align:center;padding:32px;color:#8a7968">No sales recorded for this month.</div>', 'Sent on the 1st of each month'));
    return;
  }

  // Every sale with its date (oldest first) + a subtotal line per day
  let rows = '', day = '', dayTotal = 0;
  const dayLine = () => `<tr style="background:#faf6ef"><td colspan="4" style="padding:6px 12px;font-size:11px;color:#8a7968;text-align:right">${prettyDay_(day)} total: <b>${money_(dayTotal)}</b></td></tr>`;
  list.forEach(s => {
    const d = saleDay_(s);
    if (day && d !== day) { rows += dayLine(); dayTotal = 0; }
    day = d; dayTotal += Number(s.total || 0);
    rows += `<tr>
      <td style="${TD_};white-space:nowrap">${prettyDay_(d)}</td>
      <td style="${TD_}">${esc_(s.productName)}<div style="font-size:11px;color:#8a7968">${esc_(s.soldBy || '')} · ${payName_(s.paymentMethod)}</div>${s.note ? `<div style="font-size:11px;color:#b7791f">Note: ${esc_(s.note)}</div>` : ''}</td>
      <td style="${TD_};text-align:center">${Number(s.quantity) || 1}</td>
      <td style="${TD_};text-align:right;font-weight:600">${money_(s.total)}</td></tr>`;
  });
  rows += dayLine();

  const html = wrap_(
    header_('Monthly Sales Report', monthName, list.length + ' transactions') +
    cards_(list) +
    box_('All Sales — by Date', `<th style="${TH_};text-align:left">Date</th><th style="${TH_};text-align:left">Product</th><th style="${TH_};text-align:center">Qty</th><th style="${TH_};text-align:right">Total</th>`, rows) +
    staffBox_(list),
    'Sent on the 1st of each month');

  send_(subject, html);
}

// Send a test right now (to your own email) without waiting for the trigger.
function testReportsNow() { sendDailySalesReport(); sendMonthlySalesReport(); }

// Run ONCE by hand. Creates the monthly trigger only if it does not exist yet (safe to re-run).
function setupMonthlyTriggerIfMissing() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sendMonthlySalesReport');
  if (exists) { Logger.log('Monthly trigger already exists — nothing to do'); return; }
  ScriptApp.newTrigger('sendMonthlySalesReport').timeBased().onMonthDay(1).atHour(10).nearMinute(30).create();
  Logger.log('Monthly trigger created (1st of every month ~10:30)');
}
