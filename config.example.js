// config.example.js — 設定範本
// 請複製此檔為 config.js，並填入自己的 API key
const CONFIG = {
  // Gemini API Key
  // https://aistudio.google.com/app/apikey
  GEMINI_API_KEY: "YOUR_GEMINI_API_KEY",

  // Google OAuth 2.0 Client ID
  // https://console.cloud.google.com/apis/credentials
  // 需啟用 Google Sheets API，並將 GitHub Pages URL 加入 Authorized JavaScript origins
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",

  // Google Sheet ID（從網址擷取）
  // https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/edit
  // 工作表名稱必須為 "schedules"
  // 欄位順序：id | date | time | name | chart_no | phone | site | note | uncertain
  GOOGLE_SHEET_ID: "YOUR_GOOGLE_SHEET_ID",

  // 要匯入的「公開」Google 行事曆 ID（通常是該帳號的 email）
  // 行事曆需設為公開：Google Calendar → 設定 → 存取權限 → 「公開此日曆」
  GOOGLE_CALENDAR_ID: "your_shared_calendar@gmail.com",

  // 可存取 Calendar API 的 Google API key（讀公開行事曆用，非 OAuth）
  // 在 Google Cloud Console → Credentials → 建立 API key，並啟用 Calendar API
  // 若留空，會改用上面的 GEMINI_API_KEY（同專案且未限制 API 時可共用）
  GOOGLE_API_KEY: ""
};
