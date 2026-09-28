/**
 * DriveVault V2.0.0 - Personal Vault Pro & Quick Capture
 * Google Sheets backend.
 */

const SHEET_NAME = 'Vault';
const BACKUP_SHEET_NAME = 'Backups';
const BACKUP_DATA_SHEET_NAME = 'BackupData';
const CLASSIFICATION_SHEET_NAME = 'Classifications';
const HEADERS = ['id', 'type', 'name', 'detail', 'url', 'createdAt', 'updatedAt', 'tags', 'pinned', 'useCount', 'lastUsedAt', 'collection', 'archived', 'deleted', 'deletedAt', 'thumbnail', 'protected'];
const BACKUP_HEADERS = ['id', 'createdAt', 'itemCount', 'note'];
const BACKUP_DATA_HEADERS = ['backupId'].concat(HEADERS);
const CLASSIFICATION_HEADERS = ['name', 'createdAt'];

function doGet(e) {
  try {
    assertApiKey_((e && e.parameter && e.parameter.apiKey) || '');
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'list') return json_({ ok: true, items: listItems_() });
    if (action === 'listBackups') return json_({ ok: true, backups: listBackups_() });
    if (action === 'listClassifications') return json_({ ok: true, classifications: listClassifications_() });
    return json_({ ok: false, error: 'Action không hợp lệ.' });
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
    if (payload.action === 'delete') return json_({ ok: true, item: softDeleteItem_(String(payload.id || '')) });
    if (payload.action === 'backup') return json_({ ok: true, backup: createBackup_(String(payload.note || '')) });
    if (payload.action === 'restoreBackup') return json_({ ok: true, report: restoreBackup_(String(payload.backupId || '')) });
    if (payload.action === 'deleteBackup') { deleteBackup_(String(payload.backupId || '')); return json_({ ok: true }); }
    if (payload.action === 'import') return json_({ ok: true, report: importItems_(payload.items || [], String(payload.mode || 'skip')) });
    if (payload.action === 'emptyTrash') return json_({ ok: true, removed: emptyTrash_() });
    if (payload.action === 'createClassification') return json_({ ok: true, classification: createClassification_(String(payload.name || '')) });
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

function normalizeImportedItem_(input) {
  const clean = normalizeBasic_(input || {}, false);
  const now = new Date().toISOString();
  return {
    id: String((input && input.id) || Utilities.getUuid()).trim() || Utilities.getUuid(),
    type: clean.type,
    name: clean.name,
    detail: clean.detail,
    url: clean.url,
    createdAt: String((input && input.createdAt) || now),
    updatedAt: String((input && input.updatedAt) || now),
    tags: normalizeTags_(input && input.tags),
    pinned: Boolean(input && input.pinned),
    useCount: Math.max(0, Number((input && input.useCount) || 0)),
    lastUsedAt: String((input && input.lastUsedAt) || ''),
    collection: normalizeCollection_(input && input.collection),
    archived: Boolean(input && input.archived),
    deleted: Boolean(input && input.deleted),
    deletedAt: String((input && input.deletedAt) || ''),
    thumbnail: String((input && input.thumbnail) || '').slice(0, 48000),
    protected: Boolean(input && input.protected)
  };
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
    archived: Boolean(input.archived),
    deleted: Boolean(input.deleted),
    deletedAt: String(input.deletedAt || ''),
    thumbnail: String(input.thumbnail || '').slice(0, 48000),
    protected: Boolean(input.protected)
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
    archived: typeof input.archived === 'boolean' ? input.archived : current.archived,
    deleted: current.deleted,
    deletedAt: current.deletedAt,
    thumbnail: typeof input.thumbnail === 'string' ? String(input.thumbnail).slice(0, 48000) : current.thumbnail,
    protected: typeof input.protected === 'boolean' ? input.protected : current.protected
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

function softDeleteItem_(id) {
  if (!id) throw new Error('Thiếu ID dữ liệu cần xóa.');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) return null;
  const now = new Date().toISOString();
  sheet.getRange(row, 13, 1, 3).setValues([[false, true, now]]);
  sheet.getRange(row, 7).setValue(now);
  return rowToItem_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
}

function bulkAction_(mode, ids, collection) {
  const allowed = ['archive', 'restore', 'pin', 'unpin', 'move', 'delete', 'restoreTrash', 'purge'];
  if (allowed.indexOf(mode) === -1) throw new Error('Bulk action không hợp lệ.');
  const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(function(id) { return String(id || '').trim(); }).filter(Boolean))).slice(0, 250);
  if (!cleanIds.length) return [];

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const idSet = {};
  cleanIds.forEach(function(id) { idSet[id] = true; });

  if (mode === 'purge') {
    const rowsToDelete = [];
    values.forEach(function(row, index) {
      if (idSet[String(row[0] || '')] && (row[13] === true || String(row[13]).toLowerCase() === 'true')) rowsToDelete.push(index + 2);
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
    if (mode === 'delete') { row[12] = false; row[13] = true; row[14] = now; }
    if (mode === 'restoreTrash') { row[13] = false; row[14] = ''; }
    row[6] = now;
    values[index] = row;
    changed.push(rowToItem_(row));
  });
  if (values.length) sheet.getRange(2, 1, values.length, HEADERS.length).setValues(values);
  return changed;
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
    item.lastUsedAt || '', normalizeCollection_(item.collection), Boolean(item.archived), Boolean(item.deleted), item.deletedAt || '',
    String(item.thumbnail || '').slice(0, 48000), Boolean(item.protected)
  ];
}

function rowToItem_(row) {
  const createdAt = row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '');
  const updatedAt = row[6] instanceof Date ? row[6].toISOString() : String(row[6] || createdAt);
  const lastUsedAt = row[10] instanceof Date ? row[10].toISOString() : String(row[10] || '');
  const deletedAt = row[14] instanceof Date ? row[14].toISOString() : String(row[14] || '');
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
    archived: row[12] === true || String(row[12]).toLowerCase() === 'true',
    deleted: row[13] === true || String(row[13]).toLowerCase() === 'true',
    deletedAt: deletedAt,
    thumbnail: String(row[15] || ''),
    protected: row[16] === true || String(row[16]).toLowerCase() === 'true'
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
      if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

function normalizeTextKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function duplicateKey_(item) {
  const url = normalizeTextKey_(item.url);
  if (url) return 'url:' + url;
  return 'text:' + normalizeTextKey_(item.name) + '|' + normalizeTextKey_(item.detail);
}

function importItems_(incoming, mode) {
  if (['skip', 'merge', 'replace'].indexOf(mode) === -1) throw new Error('Chế độ import không hợp lệ.');
  if (!Array.isArray(incoming)) throw new Error('File import không có danh sách dữ liệu hợp lệ.');
  if (incoming.length > 5000) throw new Error('Mỗi lần chỉ import tối đa 5.000 mục.');

  const normalized = incoming.map(normalizeImportedItem_);
  const current = listItems_();
  const report = { received: normalized.length, added: 0, updated: 0, skipped: 0, total: 0 };
  let output = [];

  if (mode === 'replace') {
    if (current.length) createBackup_('Tự động trước khi Replace import');
    output = normalized;
    report.added = normalized.length;
  } else {
    output = current.slice();
    const indexById = {};
    const indexByKey = {};
    output.forEach(function(item, index) {
      indexById[item.id] = index;
      indexByKey[duplicateKey_(item)] = index;
    });

    normalized.forEach(function(item) {
      const idIndex = Object.prototype.hasOwnProperty.call(indexById, item.id) ? indexById[item.id] : -1;
      const key = duplicateKey_(item);
      const keyIndex = Object.prototype.hasOwnProperty.call(indexByKey, key) ? indexByKey[key] : -1;
      const matchIndex = idIndex >= 0 ? idIndex : keyIndex;
      if (matchIndex < 0) {
        output.push(item);
        const newIndex = output.length - 1;
        indexById[item.id] = newIndex;
        indexByKey[key] = newIndex;
        report.added += 1;
        return;
      }
      if (mode === 'skip') {
        report.skipped += 1;
        return;
      }
      const old = output[matchIndex];
      const mergedTags = normalizeTags_((old.tags || []).concat(item.tags || []));
      const merged = {
        id: old.id,
        type: item.type || old.type,
        name: item.name || old.name,
        detail: item.detail || old.detail,
        url: item.url || old.url,
        createdAt: old.createdAt || item.createdAt,
        updatedAt: new Date().toISOString(),
        tags: mergedTags,
        pinned: Boolean(old.pinned || item.pinned),
        useCount: Math.max(Number(old.useCount || 0), Number(item.useCount || 0)),
        lastUsedAt: String(item.lastUsedAt || old.lastUsedAt || ''),
        collection: item.collection || old.collection,
        archived: Boolean(item.archived),
        deleted: Boolean(item.deleted),
        deletedAt: String(item.deletedAt || ''),
        thumbnail: String(item.thumbnail || old.thumbnail || '').slice(0, 48000),
        protected: Boolean(item.protected || old.protected)
      };
      output[matchIndex] = merged;
      report.updated += 1;
    });
  }

  replaceVaultData_(output);
  report.total = output.length;
  return report;
}

function createBackup_(note) {
  const items = listItems_();
  const sheet = getBackupSheet_();
  const dataSheet = getBackupDataSheet_();
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, BACKUP_HEADERS.length).setValues([[id, now, items.length, String(note || '').trim().slice(0, 160)]]);
  if (items.length) {
    const rows = items.map(function(item) { return [id].concat(itemToRow_(item)); });
    dataSheet.getRange(dataSheet.getLastRow() + 1, 1, rows.length, BACKUP_DATA_HEADERS.length).setValues(rows);
  }
  return { id: id, createdAt: now, itemCount: items.length, note: String(note || '').trim().slice(0, 160) };
}

function listBackups_() {
  const sheet = getBackupSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, BACKUP_HEADERS.length).getValues()
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      return {
        id: String(row[0] || ''),
        createdAt: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
        itemCount: Math.max(0, Number(row[2] || 0)),
        note: String(row[3] || '')
      };
    })
    .sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}

function findBackupRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : 0;
}

function restoreBackup_(backupId) {
  if (!backupId) throw new Error('Thiếu Backup ID.');
  const backupSheet = getBackupSheet_();
  const row = findBackupRow_(backupSheet, backupId);
  if (!row) throw new Error('Không tìm thấy snapshot backup.');
  const dataSheet = getBackupDataSheet_();
  const lastRow = dataSheet.getLastRow();
  const items = lastRow <= 1 ? [] : dataSheet.getRange(2, 1, lastRow - 1, BACKUP_DATA_HEADERS.length).getValues()
    .filter(function(dataRow) { return String(dataRow[0] || '') === backupId; })
    .map(function(dataRow) { return rowToItem_(dataRow.slice(1)); });
  const currentCount = listItems_().length;
  if (currentCount) createBackup_('Tự động trước khi Restore snapshot');
  replaceVaultData_(items);
  return { restored: items.length };
}

function deleteBackup_(backupId) {
  if (!backupId) throw new Error('Thiếu Backup ID.');
  const sheet = getBackupSheet_();
  const row = findBackupRow_(sheet, backupId);
  if (row) sheet.deleteRow(row);

  const dataSheet = getBackupDataSheet_();
  const lastRow = dataSheet.getLastRow();
  if (lastRow <= 1) return;
  const ids = dataSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const rows = [];
  ids.forEach(function(value, index) { if (String(value[0] || '') === backupId) rows.push(index + 2); });
  rows.sort(function(a, b) { return b - a; }).forEach(function(dataRow) { dataSheet.deleteRow(dataRow); });
}

function replaceVaultData_(items) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  if (items.length) sheet.getRange(2, 1, items.length, HEADERS.length).setValues(items.map(itemToRow_));
}

function emptyTrash_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const rows = [];
  values.forEach(function(row, index) {
    const deleted = row[13] === true || String(row[13]).toLowerCase() === 'true';
    if (deleted) rows.push(index + 2);
  });
  rows.sort(function(a, b) { return b - a; }).forEach(function(row) { sheet.deleteRow(row); });
  return rows.length;
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
    // V2.0 giữ nguyên schema V1.7; dữ liệu cũ được giữ nguyên, frontend bổ sung Quick Capture/PWA cục bộ.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function getBackupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy gắn Apps Script vào Google Sheet dùng làm database.');
  let sheet = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(BACKUP_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, BACKUP_HEADERS.length).setValues([BACKUP_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    sheet.getRange(1, 1, 1, BACKUP_HEADERS.length).setValues([BACKUP_HEADERS]);
  }
  return sheet;
}

function getBackupDataSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy gắn Apps Script vào Google Sheet dùng làm database.');
  let sheet = ss.getSheetByName(BACKUP_DATA_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(BACKUP_DATA_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, BACKUP_DATA_HEADERS.length).setValues([BACKUP_DATA_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    sheet.getRange(1, 1, 1, BACKUP_DATA_HEADERS.length).setValues([BACKUP_DATA_HEADERS]);
  }
  return sheet;
}

function normalizeClassificationName_(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Tên phân loại không được để trống.');
  return name.slice(0, 80);
}

function listClassifications_() {
  const sheet = getClassificationSheet_();
  const names = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      const name = String(row[0] || '').trim();
      if (name) names[name.toLowerCase()] = name;
    });
  }
  // Giữ tương thích với dữ liệu collection cũ: tự đưa các phân loại đang được dùng vào danh sách.
  listItems_().forEach(function(item) {
    const name = normalizeCollection_(item.collection);
    if (name && name !== 'Chưa phân loại') names[name.toLowerCase()] = name;
  });
  return Object.keys(names).map(function(key) { return names[key]; }).sort(function(a, b) { return a.localeCompare(b); });
}

function createClassification_(value) {
  const name = normalizeClassificationName_(value);
  const sheet = getClassificationSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i += 1) {
      if (String(values[i][0] || '').trim().toLowerCase() === name.toLowerCase()) return name;
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, CLASSIFICATION_HEADERS.length).setValues([[name, new Date().toISOString()]]);
  return name;
}

function getClassificationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Hãy gắn Apps Script vào Google Sheet dùng làm database.');
  let sheet = ss.getSheetByName(CLASSIFICATION_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CLASSIFICATION_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CLASSIFICATION_HEADERS.length).setValues([CLASSIFICATION_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    sheet.getRange(1, 1, 1, CLASSIFICATION_HEADERS.length).setValues([CLASSIFICATION_HEADERS]);
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
