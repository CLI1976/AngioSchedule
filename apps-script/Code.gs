/**
 * AngioSchedule 後端 — Google Apps Script Web App
 * ----------------------------------------------------------------
 * 作用：以「擁有者身分」讀寫排班 Google Sheet，讓前端不需任何人登入 Google，
 *       改用一組共用密碼（存於伺服器端）即可存取。Sheet 維持「非公開」。
 *
 * 一次性部署步驟：
 *   1. 打開你的排班 Google Sheet（工作表名稱需為 "schedules"，沒有的話程式會自動建立）。
 *   2. 上方選單 擴充功能(Extensions) → Apps Script。
 *   3. 把本檔內容整段貼進 Code.gs，存檔。
 *   4. 左側「專案設定(Project Settings)」→「指令碼屬性(Script Properties)」
 *      → 新增屬性： APP_PASSWORD = 你想用的密碼
 *   5. 右上「部署(Deploy)」→「新增部署作業(New deployment)」
 *      → 類型選「網頁應用程式(Web app)」
 *      → 執行身分(Execute as)：我(Me)
 *      → 具有存取權的使用者(Who has access)：所有人(Anyone)
 *      → 部署，授權，複製產生的 Web app 網址（.../exec 結尾）。
 *   6. 把該網址填入前端 config.js 的 APPS_SCRIPT_URL
 *      （或設成 GitHub Secret：APPS_SCRIPT_URL）。
 *
 * 變更密碼：回到「指令碼屬性」改 APP_PASSWORD 即可，不必重新部署。
 * 修改程式後：要「管理部署作業」→ 編輯 → 版本選「新版本」才會生效。
 */

const SHEET_NAME = 'schedules';
const COLUMNS = ['id', 'date', 'time', 'name', 'chart_no', 'phone', 'site', 'note', 'uncertain'];

function doGet() {
  return json({ ok: true, result: 'AngioSchedule backend is running' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkPassword(req.password)) return json({ ok: false, error: 'unauthorized' });
    return json({ ok: true, result: dispatch(req.action, req) });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function checkPassword(pw) {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  return !!expected && pw === expected;
}

function dispatch(action, req) {
  switch (action) {
    case 'auth':   return true;
    case 'list':   return listRows();
    case 'append': return appendRows(req.rows || []);
    case 'update': return updateRow(req.row || {});
    case 'delete': return deleteRow(req.id);
    case 'deleteIds': return deleteIds(req.ids || []);
    default: throw new Error('未知操作：' + action);
  }
}

// ----------------------------------------------------------------
// Sheet 存取
// ----------------------------------------------------------------
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  }
  // 把 date(B)、time(C)、chart_no(E)、phone(F) 設為純文字，避免日期/前導 0 被自動轉型
  const maxRows = sh.getMaxRows();
  sh.getRange(1, 2, maxRows, 2).setNumberFormat('@'); // B:C
  sh.getRange(1, 5, maxRows, 2).setNumberFormat('@'); // E:F
  return sh;
}

function cellToStr(col, v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const tz = Session.getScriptTimeZone();
    if (col === 'date') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (col === 'time') return Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  return String(v).trim();
}

function listRows() {
  const sh = getSheet();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const idx = {};
  COLUMNS.forEach(function (c) { idx[c] = header.indexOf(c); });

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const get = function (c) { return idx[c] >= 0 ? cellToStr(c, r[idx[c]]) : ''; };
    if (!get('date') && !get('name')) continue;
    const u = get('uncertain').toLowerCase();
    out.push({
      id: get('id'),
      date: get('date'),
      time: get('time'),
      name: get('name'),
      chart_no: get('chart_no'),
      phone: get('phone'),
      site: get('site'),
      note: get('note'),
      uncertain: u === 'true' || u === '1' || u === 'yes',
    });
  }
  return out;
}

function rowToValues(row) {
  return COLUMNS.map(function (c) {
    if (c === 'uncertain') return row.uncertain ? 'TRUE' : 'FALSE';
    return row[c] != null ? String(row[c]) : '';
  });
}

function appendRows(rows) {
  if (!rows.length) return { added: 0 };
  const sh = getSheet();
  const values = rows.map(rowToValues);
  sh.getRange(sh.getLastRow() + 1, 1, values.length, COLUMNS.length).setValues(values);
  return { added: values.length };
}

function updateRow(row) {
  const sh = getSheet();
  const i = findRowById(sh, row.id);
  if (i < 0) throw new Error('找不到資料：' + row.id);
  sh.getRange(i, 1, 1, COLUMNS.length).setValues([rowToValues(row)]);
  return { updated: row.id };
}

function deleteRow(id) {
  const sh = getSheet();
  const i = findRowById(sh, id);
  if (i < 0) throw new Error('找不到資料：' + id);
  sh.deleteRow(i);
  return { deleted: id };
}

// 一次刪除多個 id（由下往上刪，避免列號位移）
function deleteIds(ids) {
  if (!ids.length) return { deleted: 0 };
  const sh = getSheet();
  const last = sh.getLastRow();
  if (last < 2) return { deleted: 0 };
  const want = {};
  ids.forEach(function (id) { want[String(id).trim()] = true; });
  const idCol = sh.getRange(1, 1, last, 1).getValues();
  let n = 0;
  for (let i = idCol.length - 1; i >= 1; i--) { // 跳過表頭、由下往上
    if (want[String(idCol[i][0]).trim()]) { sh.deleteRow(i + 1); n++; }
  }
  return { deleted: n };
}

// 依 id 找出列號（1-based 工作表列號）；找不到回 -1
function findRowById(sh, id) {
  if (!id) return -1;
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(1, 1, last, 1).getValues();
  for (let i = 1; i < ids.length; i++) { // 從第 2 列開始（跳過表頭）
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 1;
  }
  return -1;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
