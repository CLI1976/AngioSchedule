# AngioSchedule 排班行事曆

純靜態網頁版的醫院排班行事曆。護理師可拍照上傳手寫排班表，由 Gemini AI 自動解析後寫入 Google Sheet，並以 Google Calendar 風格的週視圖呈現。

🔗 線上版：<https://cli1976.github.io/AngioSchedule/>

## 功能

- 📅 FullCalendar 週/日/月視圖
- 🗓️ **從公開 Google 行事曆匯入**：顯示目前年份/週次，選定起始週與週數即可批次抓取；標題自動拆解為姓名／病歷號／電話／術式部位／備註（英文歸「術式/部位」、中文歸「備註」）。只讀 config 指定的那一個公開行事曆，**登入不需要任何行事曆權限**
- 📷 從手機相簿或拍照上傳排班表，由 Gemini 2.5 Flash 解析（保留為備援）
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
| 行事曆匯入 | [Google Calendar API v3](https://developers.google.com/calendar/api)（API key 讀公開行事曆，非 OAuth） |
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
2. 啟用 **Google Sheets API** 與 **Google Calendar API**（行事曆匯入功能需要）
3. 建立 **OAuth 2.0 Client ID**（類型：Web application）——僅用於寫入試算表，**不含**任何行事曆權限
4. 將部署網址加入 **Authorized JavaScript origins**：
   - `https://cli1976.github.io`
   - `http://localhost:8080`（本機開發用）
5. 建立一組 **API key**（Credentials → Create credentials → API key），用來讀取公開行事曆。
   建議將該 key 限制為僅允許 **Calendar API** + 你的網域（HTTP referrer）。

### 3-1. 把行事曆設為公開

到要匯入的 Google 行事曆 → 設定 → **存取權限** → 勾選「**將此日曆公開**（查看所有活動詳細資訊）」。
行事曆 ID 通常就是該帳號的 email。

### 4. 建立 config.js

複製 `config.example.js` 為 `config.js`，填入：

```javascript
const CONFIG = {
  GEMINI_API_KEY: "你的 Gemini API Key",
  GOOGLE_CLIENT_ID: "你的 OAuth Client ID.apps.googleusercontent.com",
  GOOGLE_SHEET_ID: "Sheet ID（網址 /d/ 後面那串）",
  GOOGLE_CALENDAR_ID: "要匯入的公開行事曆 ID（通常是 email）",
  GOOGLE_API_KEY: "" // 可存取 Calendar API 的 key；留空則沿用 GEMINI_API_KEY
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

### 6. 部署到 GitHub Pages（GitHub Actions + Secrets）

本專案用 GitHub Actions 自動部署，**金鑰不進原始碼**：`config.js` 在部署時由 `.github/workflows/deploy.yml` 從 repo Secrets 動態產生。

1. **設定 Repo Secrets**：repo → Settings → Secrets and variables → **Actions** → New repository secret，依序新增：

   | Secret 名稱 | 內容 |
   | --- | --- |
   | `GEMINI_API_KEY` | Gemini API Key |
   | `GOOGLE_CLIENT_ID` | OAuth Client ID |
   | `GOOGLE_SHEET_ID` | Google Sheet ID |
   | `GOOGLE_CALENDAR_ID` | 公開行事曆 ID（選用，行事曆匯入用） |
   | `GOOGLE_API_KEY` | 可存取 Calendar API 的 key（選用） |

2. **設定 Pages 來源**：repo → Settings → **Pages** → Build and deployment → Source 選 **「GitHub Actions」**（不是 Deploy from a branch）。

3. **推送即部署**：

   ```bash
   git add .
   git commit -m "..."
   git push origin main
   ```

   push 到 `main` 後 Actions 會自動建置並部署；更新金鑰只需改 Secret，不必動原始碼。

> ⚠️ 注意：這是純前端靜態網站，產生的 `config.js` 仍會被瀏覽器讀取（金鑰對網站訪客而言是可見的）。Secrets 的好處是**金鑰不會進入 git 歷史**、可隨時更換。務必替每把 key 設好網域 / referrer 限制。

## 使用流程

1. 任何人開啟網頁即可瀏覽行事曆（公開讀取）
2. 護理師點擊「**登入 Google**」→ 完成 OAuth 授權（**只會要求「編輯試算表」一項**，因為要把資料寫進 Sheet；不含任何行事曆權限）
3. 匯入排班（擇一）：
   - **從 Google 行事曆匯入**（建議）：系統顯示目前年份/週次與要讀取的公開行事曆 → 輸入起始週次與週數（如目前第 24 週，從第 25 週起共 2 週）→ 按「抓取資料」
   - **從相片匯入**（備援）：選擇排班表照片 → Gemini 解析
4. 在確認 Modal 內檢查資料、修正欄位
5. 按「**確認匯入**」→ 自動寫入 Google Sheet
6. 點擊行事曆上任何事件可編輯或刪除
7. 任何人都可按「**匯出 .ics**」下載排班檔

> 📌 **行事曆標題格式**：匯入時會把事件標題（時間以外的資料）依序拆解為「姓名 病歷號-電話 術式/備註」。英文（如 `Bil legs veno`、`PermCath insertion`、`L't IV-DSA`）歸到**術式/部位**，中文（如 `分`、`聯`、`分院`、`拆線`）歸到**備註**。例：`劉海倫 4750012-0985500663 分院`、`游幸春2299542拆線`、`陳人華 293005 L't IV-DSA` 皆可正確解析（有無空白/分隔皆可）。拆解結果可在確認表格內手動修正。

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

- `GEMINI_API_KEY`、`GOOGLE_API_KEY` 與 `GOOGLE_CLIENT_ID` 會在前端明文顯示。請務必：
  - 在 Google Cloud Console 將 OAuth Client 限制只允許特定網域
  - 在 AI Studio 設定 Gemini Key 的 HTTP referrer 限制
  - 將 `GOOGLE_API_KEY` 限制為僅允許 Calendar API + 你的網域（HTTP referrer）
- 行事曆採「公開唯讀」方式讀取，登入**不索取**任何行事曆權限
- 寫入 Google Sheet 需 OAuth 登入，未授權者無法新增/編輯/刪除資料

## 授權

MIT
