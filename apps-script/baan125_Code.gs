// ============================================================
// BAAN 125 HANGOUT — Google Apps Script Backend v5
// Paste this into Google Apps Script, replacing everything, then:
//   Deploy → Manage deployments → ✏️ (edit the EXISTING deployment)
//   → Version: "New version" → Deploy.
// (Do NOT pick "New deployment" — that would change the /exec URL.)
//
// What's new vs v4:
//  - getProducts / getSales are cached for 5 minutes (CacheService) and the
//    cache is cleared on every change, so reads are near-instant.
//  - New 'getAll' action returns products + sales in one call.
//  - addSale works out the new stock on the server (not trusting the phone)
//    and refuses a sale if there isn't enough stock left.
//  - A lock stops two phones saving at the same moment from clobbering each other.
//  - updateProduct writes the whole row at once instead of cell by cell.
//  - The image folder is looked up once and remembered.
//  - Empty rows in the Products/Sales sheets are skipped.
// Daily and monthly email reports are unchanged.
// ============================================================

const PRODUCT_HEADERS = ['id','name','size','costPrice','sellPrice','quantity','imageUrl','addedBy','createdAt'];
const SALE_HEADERS = ['id','productId','productName','quantity','sellPrice','total','paymentMethod','saleDate','soldBy','createdAt'];
const IMAGE_FOLDER_NAME = 'Baan125_Stock_Images';
const CACHE_SECONDS = 300;

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let data = {};
  try {
    if (e.postData) data = JSON.parse(e.postData.contents);
    else data = e.parameter || {};
  } catch(err) { data = e.parameter || {}; }

  let result;
  try {
    switch(data.action) {
      case 'getProducts': result = { products: cachedRead('products', () => readProducts(ss)) }; break;
      case 'getSales':    result = { sales: cachedRead('sales', () => readSales(ss)) }; break;
      case 'getAll':      result = { products: cachedRead('products', () => readProducts(ss)),
                                     sales: cachedRead('sales', () => readSales(ss)) }; break;
      case 'addProduct':    result = write(() => addProduct(ss, data)); break;
      case 'updateProduct': result = write(() => updateProduct(ss, data)); break;
      case 'deleteProduct': result = write(() => deleteProduct(ss, data)); break;
      case 'addSale':       result = write(() => addSale(ss, data)); break;
      case 'uploadImage':   result = uploadImage(data); break;
      default: result = { error: 'Unknown action: ' + data.action };
    }
  } catch(err) { result = { error: err.message }; }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- caching ----------
// Script cache values max out at 100 KB each, so big lists are split into chunks.
const CHUNK = 90000;

function cachedRead(key, loader) {
  const cache = CacheService.getScriptCache();
  try {
    const n = Number(cache.get(key + ':n'));
    if (n > 0) {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(key + ':' + i);
      const parts = cache.getAll(keys);
      if (keys.every(k => parts[k] != null)) return JSON.parse(keys.map(k => parts[k]).join(''));
    }
  } catch(err) { /* fall through to a fresh read */ }

  const value = loader();
  try {
    const json = JSON.stringify(value);
    const n = Math.ceil(json.length / CHUNK) || 1;
    const put = {};
    for (let i = 0; i < n; i++) put[key + ':' + i] = json.substr(i * CHUNK, CHUNK);
    put[key + ':n'] = String(n);
    cache.putAll(put, CACHE_SECONDS);
  } catch(err) { /* too big or cache unavailable: just skip caching */ }
  // Return exactly what a cache hit would return (dates as text).
  return JSON.parse(JSON.stringify(value));
}

function clearCache() {
  const cache = CacheService.getScriptCache();
  cache.removeAll(['products:n', 'sales:n']);
}

// Runs a change while holding a lock, then clears the cache.
function write(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = fn();
    SpreadsheetApp.flush();
    clearCache();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ---------- sheets ----------
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.appendRow(headers); }
  return sheet;
}

function readRows(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter(r => r[0] !== '' && r[0] != null).map(row => {
    const obj = {}; headers.forEach((h, i) => obj[h] = row[i]); return obj;
  });
}

function readProducts(ss) { return readRows(getOrCreateSheet(ss, 'Products', PRODUCT_HEADERS)); }
function readSales(ss) { return readRows(getOrCreateSheet(ss, 'Sales', SALE_HEADERS)); }

// Kept for anything that still calls the old functions directly.
function getProducts(ss) { return { products: readProducts(ss) }; }
function getSales(ss) { return { sales: readSales(ss) }; }

function findRow(values, id) {
  for (let i = 1; i < values.length; i++) if (values[i][0] === id) return i;
  return -1;
}

function addProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', PRODUCT_HEADERS);
  const id = 'PRD-' + Date.now();
  sheet.appendRow([id, data.name||'', data.size||'', data.costPrice||0, data.sellPrice||0, data.quantity||0, data.imageUrl||'', data.addedBy||'', new Date().toISOString()]);
  return { success: true, id };
}

function updateProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', PRODUCT_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const i = findRow(values, data.id);
  if (i < 0) return { error: 'Product not found' };
  const row = values[i].slice();
  ['name','size','costPrice','sellPrice','quantity','imageUrl'].forEach(field => {
    const col = headers.indexOf(field);
    if (data[field] !== undefined && col >= 0) row[col] = data[field];
  });
  sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
  return { success: true };
}

function deleteProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', PRODUCT_HEADERS);
  const values = sheet.getDataRange().getValues();
  const i = findRow(values, data.id);
  if (i < 0) return { error: 'Product not found' };
  sheet.deleteRow(i + 1);
  return { success: true };
}

function addSale(ss, data) {
  const products = getOrCreateSheet(ss, 'Products', PRODUCT_HEADERS);
  const values = products.getDataRange().getValues();
  const headers = values[0];
  const qtyCol = headers.indexOf('quantity');
  const i = findRow(values, data.productId);
  if (i < 0) return { error: 'Product not found' };

  const sold = Number(data.quantity) || 0;
  const inStock = Number(values[i][qtyCol]) || 0;
  if (sold < 1) return { error: 'Enter a valid quantity' };
  if (sold > inStock) return { error: 'Not enough stock — only ' + inStock + ' left' };

  const sales = getOrCreateSheet(ss, 'Sales', SALE_HEADERS);
  const id = 'SALE-' + Date.now();
  sales.appendRow([id, data.productId, data.productName, sold, data.sellPrice, data.total, data.paymentMethod, data.saleDate, data.soldBy||'', new Date().toISOString()]);
  products.getRange(i + 1, qtyCol + 1).setValue(inStock - sold);
  return { success: true, id, newQuantity: inStock - sold };
}

// ---------- images ----------
function getImageFolder() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('IMAGE_FOLDER_ID');
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch(err) { /* folder gone; look it up again */ }
  }
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

function uploadImage(data) {
  try {
    const mimeType = data.mimeType || 'image/jpeg';
    const fileName = data.fileName || ('product_' + Date.now() + '.jpg');
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(data.imageData), mimeType, fileName);
    const file = getImageFolder().createFile(imageBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const imageUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
    return { success: true, imageUrl };
  } catch(err) { return { error: 'Upload failed: ' + err.message }; }
}

// ============================================================
// DAILY SALES REPORT — runs every night at 23:30 (unchanged)
// ============================================================

function sendDailySalesReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = new Date();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const sheet = ss.getSheetByName('Sales');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0];
  const sales = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  const todaySales = sales.filter(s => {
    const saleDate = s.saleDate instanceof Date
      ? Utilities.formatDate(s.saleDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(s.saleDate).substring(0, 10);
    return saleDate === todayStr;
  });

  if (todaySales.length === 0) return;

  const totalRevenue = todaySales.reduce((sum, s) => sum + Number(s.total), 0);
  const cashTotal = todaySales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + Number(s.total), 0);
  const creditTotal = todaySales.filter(s => s.paymentMethod === 'credit').reduce((sum, s) => sum + Number(s.total), 0);

  const productMap = {};
  todaySales.forEach(s => {
    if (!productMap[s.productName]) productMap[s.productName] = { qty: 0, total: 0 };
    productMap[s.productName].qty += Number(s.quantity);
    productMap[s.productName].total += Number(s.total);
  });

  const staffMap = {};
  todaySales.forEach(s => {
    const name = s.soldBy || 'Unknown';
    if (!staffMap[name]) staffMap[name] = { count: 0, total: 0 };
    staffMap[name].count += 1;
    staffMap[name].total += Number(s.total);
  });

  const dateFormatted = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd MMM yyyy');

  let productRows = '';
  Object.entries(productMap).forEach(([name, info]) => {
    productRows += `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc">${name}</td><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:center">${info.qty}</td><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:right">฿${info.total.toLocaleString()}</td></tr>`;
  });

  let staffRows = '';
  Object.entries(staffMap).forEach(([name, info]) => {
    staffRows += `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc">${name}</td><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:center">${info.count}</td><td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:right">฿${info.total.toLocaleString()}</td></tr>`;
  });

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#faf6ef;padding:24px;border-radius:16px">
    <div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <div style="color:#e8a878;font-size:22px;font-weight:700">Baan 125 Hangout</div>
      <div style="color:#8a7968;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Daily Sales Report</div>
      <div style="color:#faf6ef;font-size:14px;margin-top:8px">${dateFormatted}</div>
    </div>
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px">
      <tr>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Total Revenue</div>
          <div style="font-size:20px;font-weight:700;color:#8b4e20">฿${totalRevenue.toLocaleString()}</div>
        </td>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Cash</div>
          <div style="font-size:20px;font-weight:700;color:#27ae60">฿${cashTotal.toLocaleString()}</div>
        </td>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Credit</div>
          <div style="font-size:20px;font-weight:700;color:#3b5bdb">฿${creditTotal.toLocaleString()}</div>
        </td>
      </tr>
    </table>
    <div style="background:white;border-radius:10px;margin-bottom:16px;overflow:hidden">
      <div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Items Sold</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f2ebe0">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#8a7968">Product</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#8a7968">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#8a7968">Total</th>
        </tr></thead>
        <tbody>${productRows}</tbody>
      </table>
    </div>
    <div style="background:white;border-radius:10px;overflow:hidden">
      <div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Sales by Staff</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f2ebe0">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#8a7968">Staff</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#8a7968">Transactions</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#8a7968">Total</th>
        </tr></thead>
        <tbody>${staffRows}</tbody>
      </table>
    </div>
    <div style="text-align:center;margin-top:16px;font-size:11px;color:#8a7968">Baan 125 Hangout — Auto Report 23:30</div>
  </div>`;

  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    '📊 Baan 125 Daily Report — ' + dateFormatted,
    'Please view this email in HTML format.',
    { htmlBody: html }
  );
}

// ============================================================
// SET UP TRIGGER — run this function ONCE manually (unchanged)
// ============================================================
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailySalesReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailySalesReport')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .nearMinute(30)
    .create();
}

// ============================================================
// MONTHLY SALES REPORT — runs on 1st of every month at 10:30 AM (unchanged)
// ============================================================

function sendMonthlySalesReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = new Date();

  // Get last month
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthStr = Utilities.formatDate(lastMonth, Session.getScriptTimeZone(), 'yyyy-MM');
  const monthName = Utilities.formatDate(lastMonth, Session.getScriptTimeZone(), 'MMMM yyyy');

  const sheet = ss.getSheetByName('Sales');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0];
  const sales = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  // Filter last month's sales
  const monthSales = sales.filter(s => {
    const saleDate = s.saleDate instanceof Date
      ? Utilities.formatDate(s.saleDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(s.saleDate).substring(0, 10);
    return saleDate.substring(0, 7) === lastMonthStr;
  });

  if (monthSales.length === 0) {
    // Send even if no sales — notify that month was empty
    GmailApp.sendEmail(
      Session.getActiveUser().getEmail(),
      '📊 Baan 125 Monthly Report — ' + monthName,
      'No sales recorded for ' + monthName,
      { htmlBody: `<div style="font-family:Arial,sans-serif;padding:24px;max-width:520px;margin:0 auto;background:#faf6ef;border-radius:16px"><div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center"><div style="color:#e8a878;font-size:22px;font-weight:700">Baan 125 Hangout</div><div style="color:#8a7968;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Monthly Report — ${monthName}</div></div><div style="text-align:center;padding:32px;color:#8a7968">No sales recorded for this month.</div></div>` }
    );
    return;
  }

  const totalRevenue = monthSales.reduce((sum, s) => sum + Number(s.total), 0);
  const cashTotal = monthSales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'Cash').reduce((sum, s) => sum + Number(s.total), 0);
  const creditTotal = monthSales.filter(s => s.paymentMethod !== 'cash' && s.paymentMethod !== 'Cash').reduce((sum, s) => sum + Number(s.total), 0);

  // Group by product
  const productMap = {};
  monthSales.forEach(s => {
    const key = s.productName;
    if (!productMap[key]) productMap[key] = { qty: 0, total: 0 };
    productMap[key].qty += Number(s.quantity) || 1;
    productMap[key].total += Number(s.total);
  });

  // Group by staff
  const staffMap = {};
  monthSales.forEach(s => {
    const name = s.soldBy || s.soldby || 'Unknown';
    if (!staffMap[name]) staffMap[name] = { count: 0, total: 0 };
    staffMap[name].count += 1;
    staffMap[name].total += Number(s.total);
  });

  // Sort products by total desc
  const sortedProducts = Object.entries(productMap).sort((a,b) => b[1].total - a[1].total);
  const sortedStaff = Object.entries(staffMap).sort((a,b) => b[1].total - a[1].total);

  let productRows = '';
  sortedProducts.forEach(([name, info]) => {
    productRows += `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc">${name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:center">${info.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:right;font-weight:600">฿${info.total.toLocaleString()}</td>
    </tr>`;
  });

  let staffRows = '';
  sortedStaff.forEach(([name, info]) => {
    staffRows += `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc">${name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:center">${info.count}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0e8dc;text-align:right;font-weight:600">฿${info.total.toLocaleString()}</td>
    </tr>`;
  });

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#faf6ef;padding:24px;border-radius:16px">
    <div style="background:#1a1008;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <div style="color:#e8a878;font-size:22px;font-weight:700">Baan 125 Hangout</div>
      <div style="color:#8a7968;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Monthly Sales Report</div>
      <div style="color:#faf6ef;font-size:16px;font-weight:600;margin-top:8px">${monthName}</div>
      <div style="color:#8a7968;font-size:12px;margin-top:4px">${monthSales.length} transactions</div>
    </div>

    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px">
      <tr>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Total Revenue</div>
          <div style="font-size:22px;font-weight:700;color:#8b4e20">฿${totalRevenue.toLocaleString()}</div>
        </td>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Cash</div>
          <div style="font-size:22px;font-weight:700;color:#27ae60">฿${cashTotal.toLocaleString()}</div>
        </td>
        <td style="background:white;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#8a7968;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Card/QR</div>
          <div style="font-size:22px;font-weight:700;color:#3b5bdb">฿${creditTotal.toLocaleString()}</div>
        </td>
      </tr>
    </table>

    <div style="background:white;border-radius:10px;margin-bottom:16px;overflow:hidden">
      <div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Items Sold — ${sortedProducts.length} products</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f2ebe0">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#8a7968">Product</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#8a7968">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#8a7968">Total</th>
        </tr></thead>
        <tbody>${productRows}</tbody>
        <tr style="background:#f2ebe0">
          <td colspan="2" style="padding:8px 12px;font-weight:700;font-size:13px">Total</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700;font-size:14px;color:#8b4e20">฿${totalRevenue.toLocaleString()}</td>
        </tr>
      </table>
    </div>

    <div style="background:white;border-radius:10px;overflow:hidden">
      <div style="background:#3E2723;padding:10px 12px;color:white;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Sales by Staff</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f2ebe0">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#8a7968">Staff</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#8a7968">Transactions</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#8a7968">Total</th>
        </tr></thead>
        <tbody>${staffRows}</tbody>
      </table>
    </div>

    <div style="text-align:center;margin-top:16px;font-size:11px;color:#8a7968">Baan 125 Hangout — Monthly Report sent on 1st of each month</div>
  </div>`;

  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    '📊 Baan 125 Monthly Report — ' + monthName,
    'Please view this email in HTML format.',
    { htmlBody: html }
  );
}

function createMonthlyTrigger() {
  // Delete existing monthly triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendMonthlySalesReport') ScriptApp.deleteTrigger(t);
  });
  // Create trigger: 1st of every month at 10:30 AM
  ScriptApp.newTrigger('sendMonthlySalesReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(10)
    .nearMinute(30)
    .create();
}
