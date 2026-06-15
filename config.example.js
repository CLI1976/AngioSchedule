// config.example.js — 設定範本
// 請複製此檔為 config.js，並填入自己的設定
const CONFIG = {
  // Google Apps Script Web App 的網址（資料讀寫的後端，以擁有者身分存取私人 Sheet）
  // 部署方式見 apps-script/Code.gs 檔頭說明；密碼存放於 Apps Script 的「指令碼屬性」APP_PASSWORD
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",

  // 要匯入的「公開」Google 行事曆 ID（通常是該帳號的 email）
  // 行事曆需設為公開：Google Calendar → 設定 → 存取權限 → 「公開此日曆」
  // 若不使用「從 Google 行事曆匯入」功能，可留空字串
  GOOGLE_CALENDAR_ID: "your_shared_calendar@gmail.com",

  // 可存取 Calendar API 的 Google API key（讀公開行事曆用，唯讀）
  // 在 Google Cloud Console → Credentials → 建立 API key，並啟用 Calendar API
  // 若不使用行事曆匯入功能，可留空字串
  GOOGLE_API_KEY: ""
};
