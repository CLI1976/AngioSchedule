# AngioSchedule 排班行事曆

純靜態網頁版的醫院排班行事曆。護理師可拍照上傳手寫排班表，由 Gemini AI 自動解析後寫入 Google Sheet，並以 Google Calendar 風格的週視圖呈現。

🔗 線上版：<https://cli1976.github.io/AngioSchedule/>

## 功能

- 📅 FullCalendar 週/日/月視圖
- 📷 從手機相簿或拍照上傳排班表，由 Gemini 2.5 Flash 解析
- ✏️ 解析結果可在「確認 Modal」內逐欄修正
- 💾 確認後自動寫入 Google Sheet（含 UUID）
- 🖱️ 點擊任一事件即可編輯／刪除
- 📤 一鍵匯出 `.ics` 供匯入 Google Calendar、Outlook、Apple 行事曆
- 🎨 依部位（veno / PTA / Stenting / RH / M3）自動配色，不確定的資料以紅底標示
- 🖨️ 支援列印樣式（隱藏按鈕，輸出乾淨的表格）
- 📱 RWD，手機瀏覽器可正常使用

## 技術棧

| 用途 | 技術 |
| --- | --- |
| 行事曆 UI | [FullCalendar 6](https://fullcalendar.io/)（CDN） |
| OCR 解析 | Google [Gemini 2.5 Flash](https://ai.google.dev/) REST API |
| 資料儲存 | [Google Sheets API v4](https://developers.google.com/sheets/api) |
| 登入驗證 | [Google Identity Services](https://developers.google.com/identity/oauth2/web) |
| 匯出 | 手寫 ICS（RFC 5545） |

## 檔案結構

```
angioschedule/
├── index.html
├── app.js
├── style.css
├── config.js            ← 自行建立，已加入 .gitignore
├── config.example.js    ← 設定範本
└── README.md
```

## 安裝與設定

### 1. 建立 Google Sheet

新增一份試算表，工作表名稱命名為 `schedules`，第一列填入以下欄位：

| id | date | time | name | chart_no | phone | site | note | uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

將試算表共用設定為「**知道連結的任何人**：檢視者」（讓未登入者也能讀取行事曆）。

### 2. 申請 Gemini API Key

到 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請一組免費的 API Key。

### 3. 設定 Google OAuth 2.0

1. 進入 [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. 啟用 **Google Sheets API**
3. 建立 **OAuth 2.0 Client ID**（類型：Web application）
4. 將部署網址加入 **Authorized JavaScript origins**：
   - `https://cli1976.github.io`
   - `http://localhost:8080`（本機開發用）

### 4. 建立 config.js

複製 `config.example.js` 為 `config.js`，填入：

```javascript
const CONFIG = {
  GEMINI_API_KEY: "你的 Gemini API Key",
  GOOGLE_CLIENT_ID: "你的 OAuth Client ID.apps.googleusercontent.com",
  GOOGLE_SHEET_ID: "Sheet ID（網址 /d/ 後面那串）"
};
```

> ⚠️ `config.js` 已在 `.gitignore` 中，**不會**被 push 到 GitHub。請勿提交真實 API Key。

### 5. 本機測試

由於 OAuth callback 需要 HTTP origin，請用任意本機伺服器啟動：

```bash
# Python
python -m http.server 8080

# Node.js
npx serve -l 8080
```

開啟 <http://localhost:8080> 即可使用。

### 6. 部署到 GitHub Pages

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

在 repo 設定 → Pages → Source 選 `main` branch 根目錄，即可自動部署。

> ⚠️ **正式部署時別忘了**：手動在 GitHub Pages 上的 `config.js` 內填入真實 API key —— 因為 `config.js` 不會被 commit，所以你需要另外上傳，或改用其他方式注入（例如 GitHub Actions secret + envsubst）。

## 使用流程

1. 任何人開啟網頁即可瀏覽行事曆（公開讀取）
2. 護理師點擊「**登入 Google**」→ 完成 OAuth 授權
3. 點擊「**從相片匯入**」→ 選擇排班表照片
4. Gemini 解析 → 在確認 Modal 內檢查資料、修正紅底欄位
5. 按「**確認匯入**」→ 自動寫入 Google Sheet
6. 點擊行事曆上任何事件可編輯或刪除
7. 任何人都可按「**匯出 .ics**」下載排班檔

## 顏色對應

| 部位（site 欄位包含） | 顏色 |
| --- | --- |
| veno | 🟢 綠 #1D9E75 |
| PTA | 🔵 藍 #378ADD |
| Stenting | 🟣 紫 #534AB7 |
| RH | 🟠 橘 #BA7517 |
| M3 / 其他 | ⚪ 灰 #888780 |
| `uncertain: true` | 🔴 紅 #E24B4A（覆蓋所有顏色） |

## 安全性備註

- `GEMINI_API_KEY` 與 `GOOGLE_CLIENT_ID` 會在前端明文顯示。請務必：
  - 在 Google Cloud Console 將 OAuth Client 限制只允許特定網域
  - 在 AI Studio 設定 Gemini Key 的 HTTP referrer 限制
- 寫入 Google Sheet 需 OAuth 登入，未授權者無法新增/編輯/刪除資料

## 授權

MIT
