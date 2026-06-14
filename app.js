/* AngioSchedule - 醫院排班行事曆 */
'use strict';

// ============================================================
// State
// ============================================================
const state = {
  token: null,            // Google OAuth access token
  tokenExpireAt: 0,
  userEmail: null,
  tokenClient: null,
  sheetGid: null,         // sheet ID (gid) for delete operations
  calendar: null,
  events: [],             // [{id, date, time, name, chart_no, phone, site, note, uncertain, _rowIndex}]
  parsedRows: [],         // temp storage during import confirmation
  initialJumpDone: false, // 首次載入時若視圖內無事件，自動跳到最近一筆
  dayViewDate: null,      // 目前自訂「天」視圖顯示的日期（YYYY-MM-DD）；null 表示不在天視圖
};

const SHEET_NAME = 'schedules';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.readonly openid email profile';
const COLUMNS = ['id', 'date', 'time', 'name', 'chart_no', 'phone', 'site', 'note', 'uncertain'];

const SITE_COLORS = [
  { match: /veno/i,  color: '#1D9E75' },
  { match: /pta/i,   color: '#378ADD' },
  { match: /stent/i, color: '#534AB7' },
  { match: /^rh$/i,  color: '#BA7517' },
  { match: /^m3$/i,  color: '#888780' },
];
const DEFAULT_COLOR = '#888780';
const UNCERTAIN_COLOR = '#E24B4A';

// ============================================================
// Utilities
// ============================================================
function $(sel, parent = document) { return parent.querySelector(sel); }
function $$(sel, parent = document) { return Array.from(parent.querySelectorAll(sel)); }

function uuid() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toast(message, type = 'info', duration = 2500) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, duration);
}

function showModal(id) {
  $('#' + id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function hideModal(id) {
  $('#' + id).hidden = true;
  document.body.style.overflow = '';
}

function eventColor(site, uncertain) {
  if (uncertain) return UNCERTAIN_COLOR;
  if (!site) return DEFAULT_COLOR;
  for (const entry of SITE_COLORS) {
    if (entry.match.test(site)) return entry.color;
  }
  return DEFAULT_COLOR;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Minimal CSV parser (handles quoted fields with embedded commas/quotes/newlines)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ============================================================
// Google OAuth (Google Identity Services)
// ============================================================
function waitForGIS() {
  return new Promise((resolve) => {
    if (window.google && google.accounts && google.accounts.oauth2) return resolve();
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        clearInterval(t);
        resolve();
      }
    }, 100);
  });
}

const CONSENT_FLAG_KEY = 'angio.consented';
const TOKEN_KEY = 'angio.token';
const TOKEN_EXP_KEY = 'angio.tokenExpireAt';
const EMAIL_KEY = 'angio.userEmail';

function persistToken() {
  if (!state.token || !state.tokenExpireAt) return;
  sessionStorage.setItem(TOKEN_KEY, state.token);
  sessionStorage.setItem(TOKEN_EXP_KEY, String(state.tokenExpireAt));
  if (state.userEmail) sessionStorage.setItem(EMAIL_KEY, state.userEmail);
  localStorage.setItem(CONSENT_FLAG_KEY, '1');
}

function clearPersistedToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXP_KEY);
  sessionStorage.removeItem(EMAIL_KEY);
}

function restoreToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expStr = sessionStorage.getItem(TOKEN_EXP_KEY);
  if (!token || !expStr) return false;
  const exp = parseInt(expStr, 10);
  if (!exp || Date.now() >= exp) { clearPersistedToken(); return false; }
  state.token = token;
  state.tokenExpireAt = exp;
  state.userEmail = sessionStorage.getItem(EMAIL_KEY);
  return true;
}

async function initOAuth() {
  await waitForGIS();
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: handleTokenResponse,
    error_callback: (err) => {
      console.warn('OAuth error:', err);
    },
  });
}

async function handleTokenResponse(response) {
  if (response.error) {
    toast('登入失敗：' + response.error, 'error');
    return;
  }
  state.token = response.access_token;
  state.tokenExpireAt = Date.now() + (response.expires_in - 60) * 1000;

  try {
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + state.token },
    }).then((r) => r.json());
    state.userEmail = userInfo.email || null;
  } catch (e) {
    state.userEmail = null;
  }

  persistToken();

  if (!state.sheetGid) {
    try { await fetchSheetMeta(); } catch (e) { console.warn('sheet meta failed', e); }
  }

  updateAuthUI();
  toast('已登入' + (state.userEmail ? '：' + state.userEmail : ''));

  // 登入後重讀一次資料（試算表若為私人，未登入時讀不到，登入後才看得到）
  reloadEvents();
}

function isTokenValid() {
  return state.token && Date.now() < state.tokenExpireAt;
}

function requestLogin(forceConsent = false) {
  if (!state.tokenClient) {
    toast('Google 登入服務尚未載入', 'error');
    return;
  }
  state.tokenClient.requestAccessToken({ prompt: (forceConsent || !state.token) ? 'consent' : '' });
}

function logout() {
  if (state.token) {
    try { google.accounts.oauth2.revoke(state.token, () => {}); } catch (e) {}
  }
  state.token = null;
  state.userEmail = null;
  state.tokenExpireAt = 0;
  localStorage.removeItem(CONSENT_FLAG_KEY);
  clearPersistedToken();
  updateAuthUI();
  toast('已登出');
}

function updateAuthUI() {
  const loggedIn = isTokenValid();
  $('#btn-login').hidden = loggedIn;
  $('#btn-logout').hidden = !loggedIn;
  $('#btn-import').hidden = !loggedIn;
  $('#btn-import-calendar').hidden = !loggedIn;
  const info = $('#user-info');
  info.textContent = state.userEmail || '';
  info.hidden = !loggedIn || !state.userEmail;
}

// ============================================================
// Google Sheets — read (public via gviz CSV)
// ============================================================
function rowsToEvents(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => (h || '').toString().trim().toLowerCase());
  const idx = {};
  COLUMNS.forEach((col) => { idx[col] = header.indexOf(col); });

  const events = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const get = (col) => idx[col] >= 0 ? ((r[idx[col]] ?? '').toString().trim()) : '';
    if (!get('date') && !get('name')) continue; // skip blank rows
    const uncertainStr = get('uncertain').toLowerCase();
    events.push({
      id: get('id') || uuid(),
      date: get('date'),
      time: get('time'),
      name: get('name'),
      chart_no: get('chart_no'),
      phone: get('phone'),
      site: get('site'),
      note: get('note'),
      uncertain: uncertainStr === 'true' || uncertainStr === '1' || uncertainStr === 'yes',
      _rowIndex: i + 1,
    });
  }
  return events;
}

async function fetchEventsViaApi() {
  const data = await sheetsApi(`/values/${encodeURIComponent(SHEET_NAME)}!A:I`);
  return rowsToEvents(data.values || []);
}

async function fetchEventsViaCsv() {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CONFIG.GOOGLE_SHEET_ID)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      // Sheet 未公開 — 未登入者無法讀取
      return [];
    }
    throw new Error('讀取 Sheet 失敗：' + res.status);
  }
  const text = await res.text();
  const rows = parseCSV(text).filter((r) => r.some((c) => c && c.trim() !== ''));
  return rowsToEvents(rows);
}

async function fetchEvents() {
  if (isTokenValid()) {
    try {
      await ensureSheetReady();
      return await fetchEventsViaApi();
    } catch (e) {
      console.warn('OAuth read failed, falling back to CSV:', e);
    }
  }
  return await fetchEventsViaCsv();
}

// ============================================================
// Google Sheets — write/update/delete (OAuth)
// ============================================================
async function sheetsApi(path, options = {}) {
  if (!isTokenValid()) throw new Error('尚未登入');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CONFIG.GOOGLE_SHEET_ID)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + state.token,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Sheets API 錯誤 ' + res.status + ': ' + txt);
  }
  return res.json();
}

async function fetchSheetMeta() {
  const data = await sheetsApi('?fields=sheets.properties');
  let sheet = (data.sheets || []).find((s) => s.properties && s.properties.title === SHEET_NAME);
  if (!sheet) {
    await createSheetTab();
    const data2 = await sheetsApi('?fields=sheets.properties');
    sheet = (data2.sheets || []).find((s) => s.properties && s.properties.title === SHEET_NAME);
    if (!sheet) throw new Error(`無法建立工作表「${SHEET_NAME}」`);
  }
  state.sheetGid = sheet.properties.sheetId;
}

async function createSheetTab() {
  const addRes = await sheetsApi(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
    }),
  });
  const newGid = addRes?.replies?.[0]?.addSheet?.properties?.sheetId;

  // 寫入表頭
  await sheetsApi(
    `/values/${encodeURIComponent(SHEET_NAME)}!A1:I1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [COLUMNS] }) },
  );

  // 把 chart_no(E) 和 phone(F) 整欄設為純文字，避免前導 0 被吃掉
  if (newGid != null) {
    await sheetsApi(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          repeatCell: {
            range: {
              sheetId: newGid,
              startColumnIndex: 4, // E (chart_no)
              endColumnIndex: 6,   // 到 G 前（即 E、F）
            },
            cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        }],
      }),
    });
  }
  toast(`已自動建立工作表「${SHEET_NAME}」`);
}

async function ensureSheetReady() {
  if (state.sheetGid == null) await fetchSheetMeta();
}

function rowToValues(row) {
  return COLUMNS.map((col) => {
    if (col === 'uncertain') return row.uncertain ? 'TRUE' : 'FALSE';
    const val = row[col] != null ? String(row[col]) : '';
    // phone / chart_no 可能有前導 0，加 ' 前綴強制 Sheets 存為文字
    if ((col === 'phone' || col === 'chart_no') && /^\d/.test(val)) {
      return "'" + val;
    }
    return val;
  });
}

async function appendRows(rows) {
  if (!rows.length) return;
  await ensureSheetReady();
  const values = rows.map(rowToValues);
  await sheetsApi(
    `/values/${encodeURIComponent(SHEET_NAME)}!A:I:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) },
  );
}

async function updateRow(rowIndex, row) {
  await ensureSheetReady();
  const values = [rowToValues(row)];
  await sheetsApi(
    `/values/${encodeURIComponent(SHEET_NAME)}!A${rowIndex}:I${rowIndex}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );
}

async function deleteRow(rowIndex) {
  await ensureSheetReady();
  const body = {
    requests: [{
      deleteDimension: {
        range: {
          sheetId: state.sheetGid,
          dimension: 'ROWS',
          startIndex: rowIndex - 1, // 0-based, inclusive
          endIndex: rowIndex,        // exclusive
        },
      },
    }],
  };
  await sheetsApi(':batchUpdate', { method: 'POST', body: JSON.stringify(body) });
}

// ============================================================
// Gemini API
// ============================================================
function buildGeminiPrompt() {
  const year = new Date().getFullYear();
  return `這是一張手寫醫院排班表的照片，請解析所有病患資料，回傳 JSON array，每筆格式如下：
{
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "name": "姓名",
  "chart_no": "病歷號",
  "phone": "電話",
  "site": "部位或處置",
  "note": "其他備註",
  "uncertain": false
}
規則：
- 若照片上沒寫年份，請一律使用今年（${year}）。
- 病歷號為 4-8 碼純數字（請保留前導 0）。
- 電話為 09 開頭 10 碼數字（請保留前導 0）。
- 無法確定的欄位設 uncertain: true。
- 只回傳 JSON，不要其他文字。`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve({ base64: result.slice(comma + 1), mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function callGemini(file) {
  const { base64, mimeType } = await fileToBase64(file);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(CONFIG.GEMINI_API_KEY)}`;
  const body = {
    contents: [{
      parts: [
        { text: buildGeminiPrompt() },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Gemini API 錯誤 ' + res.status + ': ' + txt);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseGeminiJson(text);
}

function parseGeminiJson(text) {
  let cleaned = text.trim();
  // 移除可能的 markdown code fence
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  // 嘗試擷取第一個 [ 到最後一個 ]
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Gemini 回傳格式錯誤（非陣列）');
  return parsed.map((r) => ({
    date: r.date || '',
    time: r.time || '',
    name: r.name || '',
    chart_no: r.chart_no || '',
    phone: r.phone || '',
    site: r.site || '',
    note: r.note || '',
    uncertain: !!r.uncertain,
  }));
}

// ============================================================
// Calendar
// ============================================================
function eventsToCalendarItems(events) {
  return events.map((ev) => {
    let start = null;
    let end = null;
    if (ev.date && ev.time) {
      const m = ev.time.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        start = `${ev.date}T${pad2(hh)}:${pad2(mm)}:00`;
        let endHh = hh;
        let endMm = mm + 30;
        if (endMm >= 60) { endHh += 1; endMm -= 60; }
        end = `${ev.date}T${pad2(endHh)}:${pad2(endMm)}:00`;
      } else {
        start = `${ev.date}T${ev.time}`;
      }
    } else if (ev.date) {
      start = ev.date;
    }
    return {
      id: ev.id,
      title: `${ev.name || ''}${ev.site ? ' - ' + ev.site : ''}`.trim(),
      start,
      end,
      allDay: !ev.time,
      backgroundColor: eventColor(ev.site, ev.uncertain),
      borderColor: eventColor(ev.site, ev.uncertain),
      classNames: ev.uncertain ? ['event-uncertain'] : [],
      extendedProps: { record: ev },
    };
  });
}

function renderCalendar() {
  const el = $('#calendar');
  state.calendar = new FullCalendar.Calendar(el, {
    locale: 'zh-tw',
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,customDay',
    },
    customButtons: {
      customDay: {
        text: '天',
        click: () => enterDayView(formatLocalDate(state.calendar.getDate())),
      },
    },
    height: 'auto',
    nowIndicator: true,
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    slotEventOverlap: false, // 同一時段的事件並排，不要視覺壓擠
    events: eventsToCalendarItems(state.events),
    eventClick: (info) => {
      const record = info.event.extendedProps.record;
      openEditModal(record);
    },
  });
  state.calendar.render();
}

function refreshCalendarEvents() {
  if (!state.calendar) return;
  state.calendar.removeAllEvents();
  state.calendar.addEventSource(eventsToCalendarItems(state.events));
  if (state.dayViewDate) renderDayView();
}

// ============================================================
// 自訂「天」視圖
// ============================================================
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

const WEEKDAY_LABEL = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

function enterDayView(isoDate) {
  state.dayViewDate = isoDate;
  $('#calendar').hidden = true;
  $('#day-view').hidden = false;
  renderDayView();
}

function exitDayView() {
  state.dayViewDate = null;
  $('#day-view').hidden = true;
  $('#calendar').hidden = false;
  state.calendar?.updateSize();
}

function shiftDayView(days) {
  if (!state.dayViewDate) return;
  const d = new Date(state.dayViewDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  state.dayViewDate = formatLocalDate(d);
  renderDayView();
}

const DEFAULT_SLOT_MIN_MIN = 7 * 60;   // 07:00
const DEFAULT_SLOT_MAX_MIN = 21 * 60;  // 21:00（不含）
const DAY_SLOT_INTERVAL = 30;

function minToTimeStr(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}:00`;
}

// 掃描所有事件，把視圖時間範圍延伸到能涵蓋全部事件
function computeSlotRange() {
  let lo = DEFAULT_SLOT_MIN_MIN;
  let hi = DEFAULT_SLOT_MAX_MIN;
  for (const ev of state.events) {
    if (!ev.time) continue;
    const m = ev.time.match(/(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (t < lo) lo = Math.floor(t / 30) * 30;
    if (t + 30 > hi) hi = Math.ceil((t + 30) / 30) * 30;
  }
  return { lo: Math.max(0, lo), hi: Math.min(24 * 60, hi) };
}

function applySlotRangeToCalendar() {
  if (!state.calendar) return;
  const { lo, hi } = computeSlotRange();
  state.calendar.setOption('slotMinTime', minToTimeStr(lo));
  state.calendar.setOption('slotMaxTime', minToTimeStr(hi));
}

function generateDaySlots() {
  const { lo, hi } = computeSlotRange();
  const slots = [];
  for (let t = lo; t < hi; t += DAY_SLOT_INTERVAL) {
    slots.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
  }
  return slots;
}

function snapToSlot(time) {
  // 把非整 30 分鐘的時間四捨五入到最近的半小時格
  if (!time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  let mn = parseInt(m[2], 10);
  if (mn < 15) mn = 0;
  else if (mn < 45) mn = 30;
  else { mn = 0; h += 1; }
  return `${pad2(h)}:${pad2(mn)}`;
}

function renderDayView() {
  const iso = state.dayViewDate;
  if (!iso) return;
  const d = new Date(iso + 'T00:00:00');
  $('#day-view-title').textContent = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${WEEKDAY_LABEL[d.getDay()]}`;

  // 把當日事件依時間分組（同一格可能有多筆）
  const eventsBySlot = {};
  for (const ev of state.events) {
    if (ev.date !== iso) continue;
    const slot = snapToSlot(ev.time);
    if (!slot) continue;
    (eventsBySlot[slot] = eventsBySlot[slot] || []).push(ev);
  }

  const tbody = $('#day-view-table tbody');
  tbody.innerHTML = '';
  generateDaySlots().forEach((slot) => {
    const evs = eventsBySlot[slot];
    if (!evs || evs.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-slot';
      tr.innerHTML = `<td class="col-time">${slot}</td><td></td><td></td><td></td><td></td>`;
      tbody.appendChild(tr);
      return;
    }
    evs.forEach((ev) => {
      const tr = document.createElement('tr');
      if (ev.uncertain) tr.classList.add('row-uncertain');
      tr.dataset.id = ev.id;
      tr.innerHTML = `
        <td class="col-time">${slot}</td>
        <td class="col-patient">${escapeHtml(ev.name || '')}${ev.chart_no ? `<span class="patient-chart">${escapeHtml(ev.chart_no)}</span>` : ''}</td>
        <td class="col-phone">${escapeHtml(ev.phone || '')}</td>
        <td class="col-site">${escapeHtml(ev.site || '')}</td>
        <td class="col-note">${escapeHtml(ev.note || '')}</td>
      `;
      tr.addEventListener('click', () => openEditModal(ev));
      tbody.appendChild(tr);
    });
  });
}

async function reloadEvents() {
  try {
    state.events = await fetchEvents();
    applySlotRangeToCalendar();
    refreshCalendarEvents();
    maybeJumpToNearestEvent();
  } catch (e) {
    console.error(e);
    toast(e.message, 'error', 4000);
  }
}

function maybeJumpToNearestEvent() {
  if (state.initialJumpDone) return;
  if (!state.calendar || !state.events.length) return;

  const view = state.calendar.view;
  const start = view.activeStart.getTime();
  const end = view.activeEnd.getTime();

  const hasVisible = state.events.some((ev) => {
    if (!ev.date) return false;
    const ts = new Date(ev.date + 'T00:00:00').getTime();
    return !isNaN(ts) && ts >= start && ts < end;
  });
  if (hasVisible) { state.initialJumpDone = true; return; }

  const now = Date.now();
  let nearest = null;
  let nearestDiff = Infinity;
  for (const ev of state.events) {
    if (!ev.date) continue;
    const ts = new Date(ev.date + 'T00:00:00').getTime();
    if (isNaN(ts)) continue;
    const diff = Math.abs(ts - now);
    if (diff < nearestDiff) { nearestDiff = diff; nearest = ev; }
  }
  if (nearest) {
    state.calendar.gotoDate(nearest.date);
    toast(`已跳至最近一筆排班（${nearest.date}）`);
  }
  state.initialJumpDone = true;
}

// ============================================================
// Edit Modal
// ============================================================
function populateHourSelect() {
  const sel = $('#edit-time-hour');
  if (sel.options.length) return; // 只填一次
  for (let h = 1; h <= 12; h++) {
    const opt = document.createElement('option');
    opt.value = pad2(h);
    opt.textContent = String(h);
    sel.appendChild(opt);
  }
}

function time24To12Parts(t) {
  // 預設值：上午 / 08 / 00
  let period = 'AM', hour = '08', minute = '00';
  if (!t) return { period, hour, minute };
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return { period, hour, minute };
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  hour = pad2(h12);
  // 分鐘只允許 00 / 30 — 四捨五入
  minute = (mn >= 15 && mn < 45) ? '30' : '00';
  return { period, hour, minute };
}

function time12To24(period, hour, minute) {
  let h = parseInt(hour, 10);
  if (period === 'AM') {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  return `${pad2(h)}:${minute}`;
}

function openEditModal(record) {
  populateHourSelect();
  $('#edit-id').value = record.id;
  $('#edit-date').value = record.date || '';
  const t = time24To12Parts(record.time);
  $('#edit-time-period').value = t.period;
  $('#edit-time-hour').value = t.hour;
  $('#edit-time-minute').value = t.minute;
  $('#edit-name').value = record.name || '';
  $('#edit-chart_no').value = record.chart_no || '';
  $('#edit-phone').value = record.phone || '';
  $('#edit-site').value = record.site || '';
  $('#edit-note').value = record.note || '';
  $('#edit-uncertain').checked = !!record.uncertain;
  $('#btn-delete').dataset.id = record.id;
  showModal('modal-edit');
}

async function submitEdit(e) {
  e.preventDefault();
  if (!isTokenValid()) {
    toast('請先登入 Google', 'error');
    requestLogin();
    return;
  }
  const id = $('#edit-id').value;
  const record = state.events.find((ev) => ev.id === id);
  if (!record) { toast('找不到該排班', 'error'); return; }

  const updated = {
    id: id,
    date: $('#edit-date').value,
    time: time12To24($('#edit-time-period').value, $('#edit-time-hour').value, $('#edit-time-minute').value),
    name: $('#edit-name').value.trim(),
    chart_no: $('#edit-chart_no').value.trim(),
    phone: $('#edit-phone').value.trim(),
    site: $('#edit-site').value.trim(),
    note: $('#edit-note').value.trim(),
    uncertain: $('#edit-uncertain').checked,
  };

  try {
    await updateRow(record._rowIndex, updated);
    toast('已更新');
    hideModal('modal-edit');
    await reloadEvents();
  } catch (err) {
    console.error(err);
    toast(err.message, 'error', 5000);
  }
}

async function handleDelete() {
  if (!isTokenValid()) {
    toast('請先登入 Google', 'error');
    requestLogin();
    return;
  }
  const id = $('#btn-delete').dataset.id;
  const record = state.events.find((ev) => ev.id === id);
  if (!record) { toast('找不到該排班', 'error'); return; }
  if (!confirm(`確定要刪除 ${record.name || '此筆'} 的排班嗎？`)) return;
  try {
    await deleteRow(record._rowIndex);
    toast('已刪除');
    hideModal('modal-edit');
    await reloadEvents();
  } catch (err) {
    console.error(err);
    toast(err.message, 'error', 5000);
  }
}

// ============================================================
// Import flow
// ============================================================
function resetImportModal() {
  $('#import-step-upload').hidden = false;
  $('#import-step-loading').hidden = true;
  $('#import-step-confirm').hidden = true;
  $('#import-step-error').hidden = true;
  $('#preview-container').hidden = true;
  $('#photo-input').value = '';
  state.parsedRows = [];
}

function openImportModal() {
  if (!isTokenValid()) {
    toast('請先登入 Google', 'error');
    requestLogin();
    return;
  }
  resetImportModal();
  showModal('modal-import');
}

function showImportError(msg) {
  $('#import-step-upload').hidden = true;
  $('#import-step-loading').hidden = true;
  $('#import-step-confirm').hidden = true;
  $('#import-step-error').hidden = false;
  $('#import-step-error .error-msg').textContent = msg;
}

function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  $('#photo-preview').src = url;
  $('#preview-container').hidden = false;
}

async function handleAnalyze() {
  const file = $('#photo-input').files[0];
  if (!file) { toast('請先選擇相片', 'error'); return; }
  $('#import-step-upload').hidden = true;
  $('#import-step-loading').hidden = false;
  try {
    const rows = await callGemini(file);
    state.parsedRows = rows;
    renderParseResultTable();
    $('#import-step-loading').hidden = true;
    $('#import-step-confirm').hidden = false;
  } catch (err) {
    console.error(err);
    showImportError(err.message);
  }
}

function renderParseResultTable(tbody) {
  tbody = tbody || $('#parse-result-table tbody');
  tbody.innerHTML = '';
  state.parsedRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="date" data-field="date" value="${escapeHtml(row.date)}"></td>
      <td><input type="time" data-field="time" value="${escapeHtml(row.time)}"></td>
      <td><input type="text" data-field="name" value="${escapeHtml(row.name)}"></td>
      <td><input type="text" data-field="chart_no" value="${escapeHtml(row.chart_no)}"></td>
      <td><input type="text" data-field="phone" value="${escapeHtml(row.phone)}"></td>
      <td><input type="text" data-field="site" value="${escapeHtml(row.site)}"></td>
      <td><input type="text" data-field="note" value="${escapeHtml(row.note)}"></td>
      <td style="text-align:center"><input type="checkbox" data-field="uncertain" ${row.uncertain ? 'checked' : ''}></td>
      <td><button class="remove-row" title="移除此列">×</button></td>
    `;
    if (row.uncertain) {
      $$('td', tr).forEach((td) => td.classList.add('cell-uncertain'));
    }
    tr.dataset.idx = idx;
    tbody.appendChild(tr);
  });

  if (!tbody._bound) {
    tbody.addEventListener('input', onTableInput);
    tbody.addEventListener('click', onTableClick);
    tbody._bound = true;
  }
}

function onTableInput(e) {
  const target = e.target;
  const tr = target.closest('tr');
  if (!tr) return;
  const idx = Number(tr.dataset.idx);
  const field = target.dataset.field;
  if (!field) return;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  state.parsedRows[idx][field] = value;
  if (field === 'uncertain') {
    $$('td', tr).forEach((td) => td.classList.toggle('cell-uncertain', !!value));
  }
}

function onTableClick(e) {
  if (!e.target.classList.contains('remove-row')) return;
  const tr = e.target.closest('tr');
  const idx = Number(tr.dataset.idx);
  state.parsedRows.splice(idx, 1);
  renderParseResultTable(e.currentTarget);
}

async function handleConfirmImport(modalId = 'modal-import') {
  if (!state.parsedRows.length) { toast('沒有資料可匯入', 'error'); return; }
  if (!isTokenValid()) {
    toast('請先登入 Google', 'error');
    requestLogin();
    return;
  }
  const rows = state.parsedRows.map((r) => ({ ...r, id: uuid() }));
  try {
    await appendRows(rows);
    toast(`已匯入 ${rows.length} 筆`);
    hideModal(modalId);
    await reloadEvents();
  } catch (err) {
    console.error(err);
    toast(err.message, 'error', 5000);
  }
}

// ============================================================
// Google Calendar import
// ============================================================
// 取得某日期所屬的 ISO-8601 週次（週一為一週之始；含跨年修正）
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;        // 週一=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);      // 移到當週週四
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return { year: d.getUTCFullYear(), week };
}

// ISO 週次 → 該週週一（本地時間 00:00）
function isoWeekStart(isoYear, isoWeek) {
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;        // 週一=0
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + (isoWeek - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// 從行事曆事件標題拆解病患欄位（格式：姓名 病歷號-電話 備註，皆可省略/無分隔）
function parseCalendarTitle(summary) {
  const raw = (summary || '').trim();
  let name = '', chart_no = '', phone = '', note = '';
  const nameMatch = raw.match(/^[^\d]+/);
  if (nameMatch) name = nameMatch[0].trim();
  const afterName = raw.slice(nameMatch ? nameMatch[0].length : 0);

  // 電話：09 開頭共 10 碼
  let phoneIdx = -1;
  const phoneMatch = afterName.match(/09\d{8}/);
  if (phoneMatch) { phone = phoneMatch[0]; phoneIdx = phoneMatch.index; }

  // 病歷號：第一段 3-8 碼數字（跳過電話那段）
  let chartEnd = 0;
  for (const m of afterName.matchAll(/\d{3,8}/g)) {
    if (phoneIdx >= 0 && m.index === phoneIdx) continue;
    chart_no = m[0];
    chartEnd = m.index + m[0].length;
    break;
  }

  // 備註：病歷號 / 電話之後的剩餘文字
  const phoneEnd = phoneIdx >= 0 ? phoneIdx + phone.length : 0;
  const noteStart = Math.max(chartEnd, phoneEnd);
  note = afterName.slice(noteStart).replace(/^[\s\-@:、,]+/, '').trim();

  return { name, chart_no, phone, site: '', note };
}

async function calendarApi(path) {
  if (!isTokenValid()) throw new Error('尚未登入');
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: 'Bearer ' + state.token },
  });
  if (res.ok) return res.json();

  const txt = await res.text();
  // 授權範圍不足（舊 token 沒有行事曆權限）→ 觸發重新授權
  if (res.status === 401 ||
      (res.status === 403 && /insufficient|scope/i.test(txt))) {
    const err = new Error('NEED_CALENDAR_SCOPE');
    err.needScope = true;
    throw err;
  }
  // Calendar API 未在 Cloud Console 啟用
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(txt)) {
    throw new Error('Google Calendar API 尚未啟用，請到 Google Cloud Console 啟用後再試。');
  }
  throw new Error('Calendar API 錯誤 ' + res.status + ': ' + txt);
}

async function fetchCalendarList() {
  const data = await calendarApi('/users/me/calendarList?fields=items(id,summary,primary)&minAccessRole=reader');
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary || c.id,
    primary: !!c.primary,
  }));
}

// 抓取指定行事曆在 [timeMin, timeMax) 區間內的事件，轉成排班列
async function fetchCalendarEvents(calendarId, timeMin, timeMax) {
  const rows = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      fields: 'items(summary,start),nextPageToken',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await calendarApi(`/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
    for (const ev of (data.items || [])) {
      const startStr = ev.start && (ev.start.dateTime || ev.start.date);
      if (!startStr) continue;
      const d = new Date(startStr);
      if (isNaN(d.getTime())) continue;
      const date = formatLocalDate(d);
      const time = ev.start.dateTime ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
      const parsed = parseCalendarTitle(ev.summary);
      rows.push({ date, time, ...parsed, uncertain: false });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return rows;
}

function calStepShow(step) {
  ['select', 'loading', 'confirm', 'error'].forEach((s) => {
    $('#cal-step-' + s).hidden = (s !== step);
  });
}

function updateCalRangePreview() {
  const startWeek = parseInt($('#cal-start-week').value, 10);
  const count = parseInt($('#cal-week-count').value, 10);
  const year = state.calStartYear;
  if (!year || !startWeek || !count) { $('#cal-range-preview').textContent = ''; return; }
  const start = isoWeekStart(year, startWeek);
  const end = isoWeekStart(year, startWeek + count - 1);
  end.setDate(end.getDate() + 6);
  $('#cal-range-preview').textContent = `將抓取 ${formatLocalDate(start)} ～ ${formatLocalDate(end)}（第 ${startWeek}～${startWeek + count - 1} 週，共 ${count} 週）`;
}

async function openCalendarModal() {
  if (!isTokenValid()) {
    toast('請先登入 Google', 'error');
    requestLogin();
    return;
  }
  calStepShow('select');
  showModal('modal-calendar');

  // 顯示目前年份/週次，預設從下一週開始抓 2 週
  const cur = isoWeekOf(new Date());
  state.calStartYear = cur.year;
  $('#cal-current-week').textContent = `目前為 ${cur.year} 年 第 ${cur.week} 週`;
  $('#cal-start-week').value = cur.week + 1;
  $('#cal-week-count').value = 2;
  updateCalRangePreview();

  // 載入行事曆清單
  const sel = $('#cal-source');
  sel.innerHTML = '<option>載入中...</option>';
  try {
    const cals = await fetchCalendarList();
    sel.innerHTML = '';
    cals.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.summary + (c.primary ? '（主要）' : '');
      sel.appendChild(opt);
    });
    if (!cals.length) sel.innerHTML = '<option value="">（找不到行事曆）</option>';
  } catch (err) {
    if (err.needScope) {
      hideModal('modal-calendar');
      toast('需要重新登入以授權讀取 Google 行事曆', 'error', 4000);
      requestLogin(true);
      return;
    }
    showCalendarError(err.message);
  }
}

async function handleFetchCalendar() {
  const calendarId = $('#cal-source').value;
  const startWeek = parseInt($('#cal-start-week').value, 10);
  const count = parseInt($('#cal-week-count').value, 10);
  if (!calendarId) { toast('請選擇行事曆', 'error'); return; }
  if (!startWeek || startWeek < 1 || !count || count < 1) { toast('週次設定不正確', 'error'); return; }

  const timeMin = isoWeekStart(state.calStartYear, startWeek);
  const timeMax = isoWeekStart(state.calStartYear, startWeek + count);

  calStepShow('loading');
  try {
    const rows = await fetchCalendarEvents(calendarId, timeMin, timeMax);
    if (!rows.length) {
      showCalendarError('這個區間內沒有任何事件，請調整週次後重試。');
      return;
    }
    state.parsedRows = rows;
    renderParseResultTable($('#cal-result-table tbody'));
    calStepShow('confirm');
  } catch (err) {
    if (err.needScope) {
      hideModal('modal-calendar');
      toast('需要重新登入以授權讀取 Google 行事曆', 'error', 4000);
      requestLogin(true);
      return;
    }
    showCalendarError(err.message);
  }
}

function showCalendarError(msg) {
  calStepShow('error');
  $('#cal-step-error .error-msg').textContent = msg;
}

// ============================================================
// Export ICS
// ============================================================
function formatICSDate(date) {
  // 本地時間轉 UTC，格式 YYYYMMDDTHHMMSSZ
  const d = new Date(date.getTime());
  return d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) + 'Z';
}

function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AngioSchedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const now = formatICSDate(new Date());
  events.forEach((ev) => {
    if (!ev.date) return;
    const time = ev.time || '09:00';
    const start = new Date(`${ev.date}T${time}:00`);
    if (isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const title = `${ev.name || ''}${ev.site ? ' - ' + ev.site : ''}`.trim() || '排班';
    const descParts = [];
    if (ev.chart_no) descParts.push('病歷號：' + ev.chart_no);
    if (ev.phone) descParts.push('電話：' + ev.phone);
    if (ev.note) descParts.push('備註：' + ev.note);
    if (ev.uncertain) descParts.push('⚠ 不確定');

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + (ev.id || uuid()) + '@angioschedule');
    lines.push('DTSTAMP:' + now);
    lines.push('DTSTART:' + formatICSDate(start));
    lines.push('DTEND:' + formatICSDate(end));
    lines.push('SUMMARY:' + icsEscape(title));
    if (descParts.length) lines.push('DESCRIPTION:' + icsEscape(descParts.join('\n')));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadICS() {
  if (!state.events.length) { toast('沒有可匯出的排班', 'error'); return; }
  const ics = buildICS(state.events);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schedule.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已下載 schedule.ics');
}

// ============================================================
// Bootstrap
// ============================================================
function bindEvents() {
  $('#btn-login').addEventListener('click', () => requestLogin());
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-import').addEventListener('click', openImportModal);
  $('#btn-import-calendar').addEventListener('click', openCalendarModal);
  $('#btn-export').addEventListener('click', downloadICS);

  $('#btn-fetch-calendar').addEventListener('click', handleFetchCalendar);
  $('#btn-confirm-calendar').addEventListener('click', () => handleConfirmImport('modal-calendar'));
  $('#btn-calendar-back').addEventListener('click', () => calStepShow('select'));
  $('#btn-calendar-retry').addEventListener('click', () => calStepShow('select'));
  $('#cal-start-week').addEventListener('input', updateCalRangePreview);
  $('#cal-week-count').addEventListener('input', updateCalRangePreview);

  $('#day-back').addEventListener('click', exitDayView);
  $('#day-prev').addEventListener('click', () => shiftDayView(-1));
  $('#day-next').addEventListener('click', () => shiftDayView(1));
  $('#day-today').addEventListener('click', () => {
    state.dayViewDate = formatLocalDate(new Date());
    renderDayView();
  });

  $('#photo-input').addEventListener('change', handlePhotoSelect);
  $('#btn-analyze').addEventListener('click', handleAnalyze);
  $('#btn-confirm-import').addEventListener('click', handleConfirmImport);
  $('#btn-retry-import').addEventListener('click', resetImportModal);

  $('#edit-form').addEventListener('submit', submitEdit);
  $('#btn-delete').addEventListener('click', handleDelete);

  // close handlers
  $$('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });
  $$('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', () => {
      const modal = bd.closest('.modal');
      if (modal) hideModal(modal.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal:not([hidden])').forEach((m) => hideModal(m.id));
    }
  });
}

async function main() {
  if (typeof CONFIG === 'undefined' ||
      !CONFIG.GEMINI_API_KEY ||
      !CONFIG.GOOGLE_CLIENT_ID ||
      !CONFIG.GOOGLE_SHEET_ID) {
    document.body.innerHTML = `
      <div style="padding:2rem;max-width:680px;margin:auto;font-family:sans-serif">
        <h2>缺少 config.js</h2>
        <p>請複製 <code>config.example.js</code> 為 <code>config.js</code>，並填入您的 API key。</p>
      </div>`;
    return;
  }
  bindEvents();
  renderCalendar();

  // 還原上次的 token（同一個瀏覽器分頁內，reload 後不必重登）
  const restored = restoreToken();
  if (restored) updateAuthUI();

  await reloadEvents();
  initOAuth().catch((e) => console.error('OAuth init failed', e));
}

document.addEventListener('DOMContentLoaded', main);
