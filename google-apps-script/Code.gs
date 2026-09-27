/**
 * DriveVault V1.1.0 - Google Apps Script backend
 * Gắn script này với Google Sheet dùng làm database.
 */

const SHEET_NAME = 'Vault';
const HEADERS = ['id', 'type', 'name', 'detail', 'url', 'createdAt', 'updatedAt'];

function doGet(e) {
  try {
    assertApiKey_((e && e.parameter && e.parameter.apiKey) || '');
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action !== 'list') return json_({ ok: false, error: 'Action không hợp lệ.' });
    return json_({ ok: true, items: listItems_() });
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertApiKey_(payload.apiKey || '');

    if (payload.action === 'create') return json_({ ok: true, item: createItem_(payload.item || {}) });
    if (payload.action === 'update') return json_({ ok: true, item: updateItem_(payload.item || {}) });
    if (payload.action === 'delete') {
      deleteItem_(String(payload.id || ''));
      return json_({ ok: true, id: String(payload.id || '') });
    }
    return json_({ ok: false, error: 'Action không hợp lệ.' });
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

function normalizeItem_(input, requireId) {
  const id = String(input.id || '').trim();
  const type = String(input.type || '').trim();
  const name = String(input.name || '').trim();
  const detail = String(input.detail || '').trim();
  const url = String(input.url || '').trim();

  if (requireId && !id) throw new Error('Thiếu ID dữ liệu.');
  if (['media', 'content', 'other'].indexOf(type) === -1) throw new Error('Loại lưu trữ không hợp lệ.');
  if (!name) throw new Error('Tên không được để trống.');
  if (type === 'media' && !url) throw new Error('Ảnh / Video cần đường link.');
  if (type === 'content' && !detail) throw new Error('Nội dung chi tiết không được để trống.');
  if (type === 'other' && !detail && !url) throw new Error('Loại Khác cần nội dung hoặc đường link.');

  return { id: id, type: type, name: name.slice(0, 120), detail: detail, url: url };
}

function createItem_(input) {
  const clean = normalizeItem_(input, false);
  const now = new Date().toISOString();
  const item = {
    id: Utilities.getUuid(),
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: now,
    updatedAt: now
  };

  const sheet = getSheet_();
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
    item.id, item.type, item.name, item.detail, item.url, item.createdAt, item.updatedAt
  ]]);
  return item;
}

function updateItem_(input) {
  const clean = normalizeItem_(input, true);
  const sheet = getSheet_();
  const row = findRowById_(sheet, clean.id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần sửa.');

  const current = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  const createdAt = current[5] instanceof Date ? current[5].toISOString() : String(current[5] || new Date().toISOString());
  const updatedAt = new Date().toISOString();
  sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
    clean.id, clean.type, clean.name, clean.detail, clean.url, createdAt, updatedAt
  ]]);

  return {
    id: clean.id,
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: createdAt,
    updatedAt: updatedAt
  };
}

function deleteItem_(id) {
  if (!id) throw new Error('Thiếu ID dữ liệu cần xóa.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần xóa.');
  sheet.deleteRow(row);
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : 0;
}

function listItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      const createdAt = row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '');
      const updatedAt = row[6] instanceof Date ? row[6].toISOString() : String(row[6] || createdAt);
      return {
        id: String(row[0] || ''),
        type: String(row[1] || 'other'),
        name: String(row[2] || ''),
        detail: String(row[3] || ''),
        url: String(row[4] || ''),
        createdAt: createdAt,
        updatedAt: updatedAt
      };
    })
    .sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy gắn Apps Script vào Google Sheet dùng làm database.');
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function assertApiKey_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('DRIVEVAULT_API_KEY') || '';
  if (!expected) throw new Error('Chưa cấu hình DRIVEVAULT_API_KEY trong Script Properties.');
  if (provided !== expected) throw new Error('API key không hợp lệ.');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function errorText_(err) {
  return String(err && err.message ? err.message : err);
}
