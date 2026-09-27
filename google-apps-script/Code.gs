/**
 * DriveVault - Google Apps Script backend
 * Gắn script này với chính Google Sheet dùng làm database.
 * Sheet sẽ tự tạo tab "Vault" nếu chưa có.
 */

const SHEET_NAME = 'Vault';
const HEADERS = ['id', 'type', 'name', 'detail', 'url', 'createdAt'];

function doGet(e) {
  try {
    assertApiKey_((e && e.parameter && e.parameter.apiKey) || '');
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action !== 'list') return json_({ ok: false, error: 'Action không hợp lệ.' });
    return json_({ ok: true, items: listItems_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertApiKey_(payload.apiKey || '');
    if (payload.action !== 'create') return json_({ ok: false, error: 'Action không hợp lệ.' });
    const item = createItem_(payload.item || {});
    return json_({ ok: true, item: item });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function createItem_(input) {
  const type = String(input.type || '').trim();
  const name = String(input.name || '').trim();
  const detail = String(input.detail || '').trim();
  const url = String(input.url || '').trim();

  if (['media', 'content', 'other'].indexOf(type) === -1) throw new Error('Loại lưu trữ không hợp lệ.');
  if (!name) throw new Error('Tên không được để trống.');
  if (type === 'media' && !url) throw new Error('Ảnh / Video cần đường link.');
  if (type === 'content' && !detail) throw new Error('Nội dung chi tiết không được để trống.');
  if (type === 'other' && !detail && !url) throw new Error('Loại Khác cần nội dung hoặc đường link.');

  const item = {
    id: Utilities.getUuid(),
    type: type,
    name: name.slice(0, 120),
    detail: detail,
    url: url,
    createdAt: new Date().toISOString()
  };

  const sheet = getSheet_();
  sheet.appendRow([item.id, item.type, item.name, item.detail, item.url, item.createdAt]);
  return item;
}

function listItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      return {
        id: String(row[0] || ''),
        type: String(row[1] || 'other'),
        name: String(row[2] || ''),
        detail: String(row[3] || ''),
        url: String(row[4] || ''),
        createdAt: row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '')
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
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
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
