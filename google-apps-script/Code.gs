/**
 * DriveVault V1.4.0 - Search & Organization Pro
 * Google Sheets backend.
 */

const SHEET_NAME = 'Vault';
const HEADERS = ['id', 'type', 'name', 'detail', 'url', 'createdAt', 'updatedAt', 'tags', 'pinned', 'useCount', 'lastUsedAt', 'collection', 'archived'];

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
    if (payload.action === 'bulk') return json_({ ok: true, items: bulkAction_(String(payload.mode || ''), payload.ids || [], String(payload.collection || '')) });
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
      const key = tag.toLowerCase();
      if (!tag || seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .slice(0, 12);
}

function normalizeCollection_(value) {
  const name = String(value || '').trim();
  return (name || 'Chưa phân loại').slice(0, 80);
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
    lastUsedAt: String(input.lastUsedAt || ''),
    collection: normalizeCollection_(input.collection),
    archived: Boolean(input.archived)
  };

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([itemToRow_(item)]);
  return item;
}

function updateItem_(input) {
  const clean = normalizeBasic_(input, true);
  const sheet = getSheet_();
  const row = findRowById_(sheet, clean.id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần sửa.');

  const current = rowToItem_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  const updatedAt = new Date().toISOString();
  const item = {
    id: clean.id,
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: current.createdAt || updatedAt,
    updatedAt: updatedAt,
    tags: Array.isArray(input.tags) ? normalizeTags_(input.tags) : current.tags,
    pinned: typeof input.pinned === 'boolean' ? input.pinned : current.pinned,
    useCount: current.useCount,
    lastUsedAt: current.lastUsedAt,
    collection: typeof input.collection === 'string' ? normalizeCollection_(input.collection) : current.collection,
    archived: typeof input.archived === 'boolean' ? input.archived : current.archived
  };

  sheet.getRange(row, 1, 1, HEADERS.length).setValues([itemToRow_(item)]);
  return item;
}

function setPinned_(id, pinned) {
  if (!id) throw new Error('Thiếu ID dữ liệu.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) throw new Error('Không tìm thấy dữ liệu cần ghim.');
  sheet.getRange(row, 9).setValue(Boolean(pinned));
  sheet.getRange(row, 7).setValue(new Date().toISOString());
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

function bulkAction_(mode, ids, collection) {
  const allowed = ['archive', 'restore', 'pin', 'unpin', 'move', 'delete'];
  if (allowed.indexOf(mode) === -1) throw new Error('Bulk action không hợp lệ.');
  const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(function(id) { return String(id || '').trim(); }).filter(Boolean))).slice(0, 250);
  if (!cleanIds.length) return [];

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const idSet = {};
  cleanIds.forEach(function(id) { idSet[id] = true; });

  if (mode === 'delete') {
    const rowsToDelete = [];
    values.forEach(function(row, index) {
      if (idSet[String(row[0] || '')]) rowsToDelete.push(index + 2);
    });
    rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(row) { sheet.deleteRow(row); });
    return [];
  }

  const nextCollection = normalizeCollection_(collection);
  const now = new Date().toISOString();
  const changed = [];
  values.forEach(function(row, index) {
    const id = String(row[0] || '');
    if (!idSet[id]) return;
    if (mode === 'archive') row[12] = true;
    if (mode === 'restore') row[12] = false;
    if (mode === 'pin') row[8] = true;
    if (mode === 'unpin') row[8] = false;
    if (mode === 'move') row[11] = nextCollection;
    row[6] = now;
    values[index] = row;
    changed.push(rowToItem_(row));
  });

  if (values.length) sheet.getRange(2, 1, values.length, HEADERS.length).setValues(values);
  return changed;
}

function deleteItem_(id) {
  if (!id) throw new Error('Thiếu ID dữ liệu cần xóa.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) return;
  sheet.deleteRow(row);
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : 0;
}

function itemToRow_(item) {
  return [
    item.id, item.type, item.name, item.detail, item.url, item.createdAt, item.updatedAt,
    JSON.stringify(item.tags || []), Boolean(item.pinned), Math.max(0, Number(item.useCount || 0)),
    item.lastUsedAt || '', normalizeCollection_(item.collection), Boolean(item.archived)
  ];
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
    lastUsedAt: lastUsedAt,
    collection: normalizeCollection_(row[11]),
    archived: row[12] === true || String(row[12]).toLowerCase() === 'true'
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
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
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
    // V1.4 tự mở rộng schema V1.3, không xóa dữ liệu cũ.
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
