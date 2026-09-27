/**
 * DriveVault V1.3.0 - Smart Library & Reliability
 * Google Sheets backend.
 */

const SHEET_NAME = 'Vault';
const HEADERS = ['id', 'type', 'name', 'detail', 'url', 'createdAt', 'updatedAt', 'tags', 'pinned', 'useCount', 'lastUsedAt'];

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
    if (payload.action === 'pin') return json_({ ok: true, item: setPinned_(String(payload.id || ''), Boolean(payload.pinned)) });
    if (payload.action === 'use') return json_({ ok: true, item: markUsed_(String(payload.id || ''), Number(payload.useCount || 0), String(payload.lastUsedAt || '')) });
    if (payload.action === 'delete') {
      deleteItem_(String(payload.id || ''));
      return json_({ ok: true, id: String(payload.id || '') });
    }
    return json_({ ok: false, error: 'Action không hợp lệ.' });
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

function normalizeTags_(value) {
  let tags = [];
  if (Array.isArray(value)) tags = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      tags = Array.isArray(parsed) ? parsed : value.split(',');
    } catch (e) {
      tags = value.split(',');
    }
  }
  const seen = {};
  return tags
    .map(function(tag) { return String(tag || '').trim(); })
    .filter(function(tag) {
      if (!tag || seen[tag]) return false;
      seen[tag] = true;
      return true;
    })
    .slice(0, 12);
}

function normalizeBasic_(input, requireId) {
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
  const clean = normalizeBasic_(input, false);
  const sheet = getSheet_();
  const id = clean.id || Utilities.getUuid();
  const existingRow = clean.id ? findRowById_(sheet, clean.id) : 0;
  if (existingRow) return rowToItem_(sheet.getRange(existingRow, 1, 1, HEADERS.length).getValues()[0]);

  const now = new Date().toISOString();
  const item = {
    id: id,
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now),
    tags: normalizeTags_(input.tags),
    pinned: Boolean(input.pinned),
    useCount: Math.max(0, Number(input.useCount || 0)),
    lastUsedAt: String(input.lastUsedAt || '')
  };

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([[
    item.id, item.type, item.name, item.detail, item.url, item.createdAt, item.updatedAt,
    JSON.stringify(item.tags), item.pinned, item.useCount, item.lastUsedAt
  ]]);
  return item;
}

function updateItem_(input) {
  const clean = normalizeBasic_(input, true);
  const sheet = getSheet_();
  const row = findRowById_(sheet, clean.id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần sửa.');

  const current = rowToItem_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  const updatedAt = new Date().toISOString();
  const tags = Array.isArray(input.tags) ? normalizeTags_(input.tags) : current.tags;
  const pinned = typeof input.pinned === 'boolean' ? input.pinned : current.pinned;

  const item = {
    id: clean.id,
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: current.createdAt || updatedAt,
    updatedAt: updatedAt,
    tags: tags,
    pinned: pinned,
    useCount: current.useCount,
    lastUsedAt: current.lastUsedAt
  };

  sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
    item.id, item.type, item.name, item.detail, item.url, item.createdAt, item.updatedAt,
    JSON.stringify(item.tags), item.pinned, item.useCount, item.lastUsedAt
  ]]);
  return item;
}

function setPinned_(id, pinned) {
  if (!id) throw new Error('Thiếu ID dữ liệu.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần ghim.');
  sheet.getRange(row, 9).setValue(Boolean(pinned));
  return rowToItem_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
}

function markUsed_(id, requestedUseCount, lastUsedAt) {
  if (!id) throw new Error('Thiếu ID dữ liệu.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần cập nhật lượt dùng.');

  const currentCount = Number(sheet.getRange(row, 10).getValue() || 0);
  const nextCount = Math.max(currentCount, Math.max(0, Number(requestedUseCount || 0)));
  const nextLastUsedAt = lastUsedAt || new Date().toISOString();
  sheet.getRange(row, 10, 1, 2).setValues([[nextCount, nextLastUsedAt]]);
  return rowToItem_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
}

function deleteItem_(id) {
  if (!id) throw new Error('Thiếu ID dữ liệu cần xóa.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) return; // Idempotent: retry/delete mục chưa từng sync vẫn được xem là thành công.
  sheet.deleteRow(row);
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : 0;
}

function rowToItem_(row) {
  const createdAt = row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '');
  const updatedAt = row[6] instanceof Date ? row[6].toISOString() : String(row[6] || createdAt);
  const lastUsedAt = row[10] instanceof Date ? row[10].toISOString() : String(row[10] || '');
  return {
    id: String(row[0] || ''),
    type: String(row[1] || 'other'),
    name: String(row[2] || ''),
    detail: String(row[3] || ''),
    url: String(row[4] || ''),
    createdAt: createdAt,
    updatedAt: updatedAt,
    tags: normalizeTags_(row[7]),
    pinned: row[8] === true || String(row[8]).toLowerCase() === 'true',
    useCount: Math.max(0, Number(row[9] || 0)),
    lastUsedAt: lastUsedAt
  };
}

function listItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(rowToItem_)
    .sort(function(a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy gắn Apps Script vào Google Sheet dùng làm database.');
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    // V1.3 tự mở rộng schema cũ V1.2, không xóa dữ liệu hiện có.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function assertApiKey_(provided) {
  const expected = (PropertiesService.getScriptProperties().getProperty('DRIVEVAULT_API_KEY') || '').trim();
  const actual = String(provided || '').trim();
  if (!expected) throw new Error('Chưa cấu hình DRIVEVAULT_API_KEY trong Script Properties.');
  if (actual !== expected) throw new Error('API key không hợp lệ. Kiểm tra DRIVEVAULT_API_KEY ở Vercel và Apps Script Script Properties.');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function errorText_(err) {
  return String(err && err.message ? err.message : err);
}
