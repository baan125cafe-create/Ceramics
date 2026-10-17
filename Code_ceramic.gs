// ============================================================
// BAAN 125 HANGOUT — Google Apps Script Backend v3.1 (sale note)
// Paste this into Google Apps Script and deploy as Web App
// ============================================================

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
      case 'getProducts': result = getProducts(ss); break;
      case 'addProduct': result = addProduct(ss, data); break;
      case 'updateProduct': result = updateProduct(ss, data); break;
      case 'deleteProduct': result = deleteProduct(ss, data); break;
      case 'addSale': result = addSale(ss, data); break;
      case 'getSales': result = getSales(ss); break;
      case 'uploadImage': result = uploadImage(data); break;
      default: result = { error: 'Unknown action: ' + data.action };
    }
  } catch(err) { result = { error: err.message }; }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.appendRow(headers); }
  return sheet;
}

function getProducts(ss) {
  const sheet = getOrCreateSheet(ss, 'Products', ['id','name','size','costPrice','sellPrice','quantity','imageUrl','addedBy','createdAt']);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { products: [] };
  const headers = data[0];
  return { products: data.slice(1).map(row => { const obj = {}; headers.forEach((h,i) => obj[h] = row[i]); return obj; }) };
}

function addProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', ['id','name','size','costPrice','sellPrice','quantity','imageUrl','addedBy','createdAt']);
  const id = 'PRD-' + Date.now();
  sheet.appendRow([id, data.name||'', data.size||'', data.costPrice||0, data.sellPrice||0, data.quantity||0, data.imageUrl||'', data.addedBy||'', new Date().toISOString()]);
  return { success: true, id };
}

function updateProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', ['id','name','size','costPrice','sellPrice','quantity','imageUrl','addedBy','createdAt']);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === data.id) {
      if (data.name !== undefined) sheet.getRange(i+1, headers.indexOf('name')+1).setValue(data.name);
      if (data.size !== undefined) sheet.getRange(i+1, headers.indexOf('size')+1).setValue(data.size);
      if (data.costPrice !== undefined) sheet.getRange(i+1, headers.indexOf('costPrice')+1).setValue(data.costPrice);
      if (data.sellPrice !== undefined) sheet.getRange(i+1, headers.indexOf('sellPrice')+1).setValue(data.sellPrice);
      if (data.quantity !== undefined) sheet.getRange(i+1, headers.indexOf('quantity')+1).setValue(data.quantity);
      if (data.imageUrl !== undefined) sheet.getRange(i+1, headers.indexOf('imageUrl')+1).setValue(data.imageUrl);
      return { success: true };
    }
  }
  return { error: 'Product not found' };
}

function deleteProduct(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Products', ['id','name','size','costPrice','sellPrice','quantity','imageUrl','addedBy','createdAt']);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === data.id) { sheet.deleteRow(i+1); return { success: true }; }
  }
  return { error: 'Product not found' };
}

function addSale(ss, data) {
  const sheet = getOrCreateSheet(ss, 'Sales', ['id','productId','productName','quantity','sellPrice','total','paymentMethod','saleDate','soldBy','createdAt']);
  const id = 'SALE-' + Date.now();
  sheet.appendRow([id, data.productId, data.productName, data.quantity, data.sellPrice, data.total, data.paymentMethod, data.saleDate, data.soldBy||'', new Date().toISOString()]);
  const noteCol = ensureColumn(sheet, 'note');                       // v2: sale note (ensureColumn lives in Reports_v2)
  sheet.getRange(sheet.getLastRow(), noteCol).setValue(data.note || '');
  updateProduct(ss, { id: data.productId, quantity: data.newQuantity });
  return { success: true, id };
}

function getSales(ss) {
  const sheet = getOrCreateSheet(ss, 'Sales', ['id','productId','productName','quantity','sellPrice','total','paymentMethod','saleDate','soldBy','createdAt']);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { sales: [] };
  const headers = data[0];
  return { sales: data.slice(1).map(row => { const obj = {}; headers.forEach((h,i) => obj[h] = row[i]); return obj; }) };
}

function uploadImage(data) {
  try {
    const base64Data = data.imageData;
    const mimeType = data.mimeType || 'image/jpeg';
    const fileName = data.fileName || ('product_' + Date.now() + '.jpg');
    let folder;
    const folders = DriveApp.getFoldersByName('Baan125_Stock_Images');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Baan125_Stock_Images');
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = folder.createFile(imageBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const imageUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
    return { success: true, imageUrl };
  } catch(err) { return { error: 'Upload failed: ' + err.message }; }
}
