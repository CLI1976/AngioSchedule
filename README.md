# AngioSchedule 排班行事曆

純靜態網頁版的醫院排班行事曆。可從**分享的公開 Google 行事曆**批次匯入排班，透過 **Google Apps Script** 後端寫入 Google Sheet，以 Google Calendar 風格的週視圖呈現，並可**列印**為紙本排班表。

🔗 線上版：<https://cli1976.github.io/AngioSchedule/>

## 功能

- 📅 FullCalendar 週/日/月視圖
- 🗓️ **從公開 Google 行事曆匯入**：顯示目前年份/週次，選定起始週與週數即可批次抓取；標題自動拆解為姓名／病歷號／電話／術式部位／備註（英文歸「術式/部位」、中文歸「備註」）
- ✏️ 匯入結果可在「確認 Modal」內逐欄修正
- 💾 確認後經 Apps Script 寫入 Google Sheet（含 UUID）
- 🖱️ 點擊任一事件即可編輯／刪除；匯入時會鎖定「確認匯入」按鈕，避免連點造成重複匯入
- 🧹 **清除本週**：一鍵批次刪除目前顯示週（週一～週日）的所有排班（含二次確認）
- 📤 一鍵匯出 `.ics` 供匯入 Google Calendar、Outlook、Apple 行事曆
- 🎨 依部位（veno / PTA / Stenting・TEVAR・EVAR / RH / M3）自動配色，不確定的資料以紅底標示
- 🖨️ 「列印本週」按鈕：輸出為紙本最佳化的**直向 A4 週方格表（僅週一至週五）**（依時間×五天，自動略過整週無排班的時段、保留部位色條、表頭每頁重複、列不跨頁）
- 🔑 **密碼登入**：不需登入任何 Google 帳號；密碼存於 Apps Script 伺服器端，瀏覽器只保留使用者輸入值
- 📱 RWD，手機瀏覽器可正常使用

## 架構與安全模型

資料的讀取與寫入**全部經由 Google Apps Script Web App**，該 Web App 以**擁有者身分**執行，因此：

- **Google Sheet 維持「非公開」**，病人資料不會對外開放讀取。
- **沒有任何人需要登入 Google**，也不需授權任何 OAuth 權限。
- 共用密碼存放於 Apps Script 的「指令碼屬性」（伺服器端），**不會出現在靜態網站裡**；使用者只是在前端輸入、由後端比對。

| 用途 | 技術 |
| --- | --- |
| 行事曆 UI | [FullCalendar 6](https://fullcalendar.io/)（CDN） |
| 資料後端 | [Google Apps Script](https://developers.google.com/apps-script) Web App（讀寫私人 Sheet） |
| 行事曆匯入 | [Google Calendar API v3](https://developers.google.com/calendar/api)（API key 讀公開行事曆，唯讀） |
| 匯出 | 手寫 ICS（RFC 5545） |

## 檔案結構

```
angioschedule/
├── index.html
├── app.js
├── style.css
├── config.js            ← 自行建立，已加入 .gitignore（本機開發用）
├── config.example.js    ← 設定範本
├── apps-script/
│   └── Code.gs          ← 部署到 Apps Script 的後端程式
├── README.md            ← 繁體中文
├── README-en.md         ← English
└── .github/
    └── workflows/
        └── deploy.yml   ← GitHub Pages 自動部署（從 Secrets 產生 config.js）
```

## 安裝與設定

### 1. 建立 Google Sheet

新增一份試算表，工作表名稱命名為 `schedules`，第一列填入以下欄位（若沒有，後端程式會自動建立此工作表）：

| id | date | time | name | chart_no | phone | site | note | uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

> 試算表**不需要公開**。讀寫都透過 Apps Script 以擁有者身分進行。

### 2. 部署 Apps Script 後端

1. 打開上述 Google Sheet → 上方選單 **擴充功能(Extensions) → Apps Script**。
2. 把 `apps-script/Code.gs` 內容整段貼進 `Code.gs`，存檔。
3. 左側 **專案設定(Project Settings) → 指令碼屬性(Script Properties)** → 新增：
   - `APP_PASSWORD` = 你想用的共用密碼
4. 右上 **部署(Deploy) → 新增部署作業(New deployment)**：
   - 類型：**網頁應用程式(Web app)**
   - 執行身分(Execute as)：**我(Me)**
   - 具有存取權的使用者(Who has access)：**所有人(Anyone)**
   - 部署 → 授權 → 複製產生的 **Web app 網址**（`.../exec` 結尾）。

> 之後若**修改 `Code.gs`**，需到「管理部署作業」編輯，版本選「新版本」才會生效。
> 只是**改密碼**的話，改「指令碼屬性」即可，不必重新部署。

### 3.（選用）行事曆匯入設定

若要使用「從 Google 行事曆匯入」：

1. 進入 [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)，啟用 **Google Calendar API**，建立一組 **API key**（建議限制為僅 Calendar API + 你的網域 referrer）。
2. 把要匯入的 Google 行事曆設為公開：行事曆 → 設定 → **存取權限** → 勾選「**將此日曆公開**」。行事曆 ID 通常就是該帳號的 email。

### 4. 建立 config.js

複製 `config.example.js` 為 `config.js`，填入：

```javascript
const CONFIG = {
  APPS_SCRIPT_URL: "Apps Script Web app 網址（.../exec）",
  GOOGLE_CALENDAR_ID: "要匯入的公開行事曆 ID（選用，通常是 email）",
  GOOGLE_API_KEY: "可存取 Calendar API 的 key（選用）"
};
```

> ⚠️ `config.js` 已在 `.gitignore` 中，**不會**被 push 到 GitHub。

### 5. 本機測試

用任意本機伺服器啟動：

```bash
# Python
python -m http.server 8080

# Node.js
npx serve -l 8080
```

開啟 <http://localhost:8080> 即可使用。

### 6. 部署到 GitHub Pages（GitHub Actions + Secrets）

本專案用 GitHub Actions 自動部署：`config.js` 在部署時由 `.github/workflows/deploy.yml` 從 repo Secrets 動態產生。

1. **設定 Repo Secrets**：repo → Settings → Secrets and variables → **Actions** → New repository secret，依序新增：

   | Secret 名稱 | 內容 |
   | --- | --- |
   | `APPS_SCRIPT_URL` | Apps Script Web app 網址（必填） |
   | `GOOGLE_CALENDAR_ID` | 公開行事曆 ID（選用，行事曆匯入用） |
   | `GOOGLE_API_KEY` | 可存取 Calendar API 的 key（選用） |

2. **設定 Pages 來源**：repo → Settings → **Pages** → Source 選 **「GitHub Actions」**。

3. **推送即部署**：

   ```bash
   git add .
   git commit -m "..."
   git push origin main
   ```

> 💡 **快取**：部署流程會自動在 `app.js` / `style.css` / `config.js` 後面加上 commit 版本號（`?v=xxxxxxxx`），更新後瀏覽器會重抓。若偶爾仍看到舊版，按一次 `Ctrl + Shift + R` 強制重新整理即可。

## 使用流程

1. 開啟網頁，點右上角「**登入**」輸入共用密碼（驗證成功後會記住，下次免再輸入）
2. 從 **Google 行事曆匯入**：系統顯示目前年份/週次與要讀取的公開行事曆 → 輸入起始週次與週數（如目前第 24 週，從第 25 週起共 2 週）→ 按「抓取資料」
3. 在確認 Modal 內檢查資料、修正欄位
4. 按「**確認匯入**」→ 經 Apps Script 寫入 Google Sheet
5. 點擊行事曆上任何事件可編輯或刪除
6. 若該週匯錯或想重來，按「**清除本週**」可一次刪光該週（週一～週日）資料，再重新匯入一次
7. 切到要列印的那一週，按「**列印本週**」→ 輸出直向 A4 週方格表（僅週一至週五，紙本記錄用）
8. 按「**匯出 .ics**」可下載排班檔

> 🖨️ **列印提示**：列印對話框方向設為**直向(Portrait)**，並勾選「**背景圖形 / Background graphics**」，部位色條與「不確定」紅底才會印出。週六日不列印。也可直接按 `Ctrl + P`，列印內容會跟著目前所在週次。

> 📌 **行事曆標題格式**：匯入時會把事件標題（時間以外的資料）依序拆解為「姓名 病歷號-電話 術式/備註」。英文（如 `Bil legs veno`、`PermCath insertion`、`L't IV-DSA`）歸到**術式/部位**，中文（如 `分`、`聯`、`分院`、`拆線`）歸到**備註**。例：`劉海倫 4750012-0985500663 分院`、`游幸春2299542拆線`、`陳人華 293005 L't IV-DSA` 皆可正確解析（有無空白/分隔皆可）。拆解結果可在確認表格內手動修正。

## 顏色對應

| 部位（site 欄位包含） | 顏色 |
| --- | --- |
| veno | 🟢 綠 #1D9E75 |
| PTA | 🔵 藍 #378ADD |
| Stenting / TEVAR / EVAR | 🟣 紫 #534AB7 |
| RH | 🟠 橘 #BA7517 |
| M3 / 其他 | ⚪ 灰 #888780 |
| `uncertain: true` | 🔴 紅 #E24B4A（覆蓋所有顏色） |

## 安全性備註

- **密碼**存於 Apps Script 伺服器端（指令碼屬性），不會出現在前端原始碼；前端僅暫存使用者輸入值於瀏覽器 `localStorage`。
- **Google Sheet 維持非公開**，讀寫一律經 Apps Script 以擁有者身分進行；未持有密碼者無法讀取或修改資料。
- 若使用行事曆匯入，`GOOGLE_API_KEY` 會在前端明文顯示——請在 Google Cloud Console 將該 key 限制為僅允許 **Calendar API** + 你的網域（HTTP referrer），且該行事曆採「公開唯讀」。
- 共用密碼為「足夠擋住路人」等級的保護；若需更強的權限分級，建議改採每人帳號的正式驗證機制。

## 授權

MIT
