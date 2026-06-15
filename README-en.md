# AngioSchedule

A pure-static web app for hospital procedure scheduling. Batch-import schedules from a **shared public Google Calendar**, store them in Google Sheets through a **Google Apps Script** backend, show them in a Google Calendar-style week view, and **print** them as a paper schedule sheet.

🔗 Live demo: <https://cli1976.github.io/AngioSchedule/>

## Features

- 📅 FullCalendar week / day / month views
- 🗓️ **Import from a public Google Calendar**: shows the current year/week, pick a start week and span, then batch-fetch; event titles are auto-split into name / chart no. / phone / procedure-site / note (English → procedure/site, Chinese → note)
- ✏️ Inline editing for imported rows before committing
- 💾 Writes to the Google Sheet (with UUIDs) via Apps Script
- 🖱️ Click any event to edit / delete; the "Confirm import" button locks while submitting to avoid duplicate imports from double-clicks
- 🧹 **Clear this week**: one click batch-deletes every entry in the currently displayed week (Mon–Sun), with a confirmation prompt
- 📤 One-click `.ics` export for Google Calendar / Outlook / Apple Calendar
- 🎨 Auto color coding by site (veno / PTA / Stenting·TEVAR·EVAR / RH / M3); uncertain rows highlighted in red
- 🖨️ "Print this week" button: outputs a paper-optimized **portrait A4 weekly grid (Mon–Fri only)** (time × 5 days; empty time rows skipped, site color bars kept, header repeats per page, rows never split across pages)
- 🔑 **Password login**: no Google account sign-in required; the password lives server-side in Apps Script — the browser only holds what the user types
- 📱 Responsive — works on mobile browsers

## Architecture & security model

All reads and writes go **through a Google Apps Script Web App** that runs **as the owner**, so:

- The **Google Sheet stays private** — patient data is never publicly readable.
- **Nobody signs into Google**, and no OAuth scope is granted.
- The shared password is stored in Apps Script **Script Properties** (server-side); it **never appears in the static site**. The front end only sends what the user types for the backend to verify.

| Purpose | Tech |
| --- | --- |
| Calendar UI | [FullCalendar 6](https://fullcalendar.io/) (CDN) |
| Data backend | [Google Apps Script](https://developers.google.com/apps-script) Web App (reads/writes the private Sheet) |
| Calendar import | [Google Calendar API v3](https://developers.google.com/calendar/api) (API key on a public calendar, read-only) |
| Export | Handwritten ICS (RFC 5545) |

## File layout

```
angioschedule/
├── index.html
├── app.js
├── style.css
├── config.js            ← create yourself; gitignored (local dev)
├── config.example.js    ← template
├── apps-script/
│   └── Code.gs          ← backend deployed to Apps Script
├── README.md            ← Traditional Chinese
├── README-en.md         ← English
└── .github/
    └── workflows/
        └── deploy.yml   ← GitHub Pages auto-deploy (generates config.js from Secrets)
```

## Setup

### 1. Create the Google Sheet

Create a spreadsheet with a sheet named `schedules` and the following header row (the backend will create the sheet automatically if missing):

| id | date | time | name | chart_no | phone | site | note | uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

> The spreadsheet does **not** need to be public — all access goes through Apps Script as the owner.

### 2. Deploy the Apps Script backend

1. Open the Sheet → **Extensions → Apps Script**.
2. Paste the contents of `apps-script/Code.gs` into `Code.gs` and save.
3. **Project Settings → Script Properties** → add:
   - `APP_PASSWORD` = your shared password
4. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy → authorize → copy the **Web app URL** (ends with `/exec`).

> If you later **edit `Code.gs`**, redeploy via "Manage deployments" with a **new version**.
> To change only the password, just edit the Script Property — no redeploy needed.

### 3. (Optional) Calendar import

To use "Import from Google Calendar":

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), enable **Google Calendar API** and create an **API key** (recommended: restrict to Calendar API + your domain referrer).
2. Make the source calendar public: Calendar → Settings → **Access permissions** → "Make available to public". The calendar ID is usually the account email.

### 4. Create config.js

Copy `config.example.js` to `config.js` and fill in:

```javascript
const CONFIG = {
  APPS_SCRIPT_URL: "Apps Script Web app URL (.../exec)",
  GOOGLE_CALENDAR_ID: "public calendar id to import (optional, usually an email)",
  GOOGLE_API_KEY: "key with Calendar API access (optional)"
};
```

> ⚠️ `config.js` is gitignored — it will **not** be pushed to GitHub.

### 5. Local dev

Serve via any static server:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve -l 8080
```

Open <http://localhost:8080>.

### 6. Deploy to GitHub Pages (GitHub Actions + Secrets)

`config.js` is generated at deploy time from repo Secrets by `.github/workflows/deploy.yml`.

1. **Add repo Secrets**: repo → Settings → Secrets and variables → **Actions** → New repository secret:

   | Secret | Value |
   | --- | --- |
   | `APPS_SCRIPT_URL` | Apps Script Web app URL (required) |
   | `GOOGLE_CALENDAR_ID` | Public calendar ID (optional, for calendar import) |
   | `GOOGLE_API_KEY` | Key with Calendar API access (optional) |

2. **Set Pages source**: repo → Settings → **Pages** → Source → **"GitHub Actions"**.

3. **Push to deploy**:

   ```bash
   git add .
   git commit -m "..."
   git push origin main
   ```

> 💡 **Caching**: the deploy appends the commit SHA to `app.js` / `style.css` / `config.js` (`?v=xxxxxxxx`), so browsers re-fetch after an update. If you still see an old version, do a one-time `Ctrl + Shift + R` hard refresh.

## User flow

1. Open the page, click **"Login"** (top-right) and enter the shared password (remembered after a successful check)
2. **Import from Google Calendar**: the app shows the current year/week and the public calendar to read → enter a start week and span (e.g. current week 24, start at week 25 for 2 weeks) → click "Fetch"
3. Review rows and fix fields in the confirm modal
4. Click **"Confirm import"** → rows are written to the Google Sheet via Apps Script
5. Click any event on the calendar to edit or delete
6. If a week was imported wrong, click **"Clear this week"** to wipe that week (Mon–Sun) in one go, then re-import once
7. Go to the week you want, click **"Print this week"** → a portrait A4 weekly grid (Mon–Fri only) for paper records
8. Click **"Export .ics"** to download the calendar

> 🖨️ **Print tip**: in the print dialog set orientation to **portrait** and enable **Background graphics** so the site color bars and the "uncertain" red shading are printed. Weekends are not printed. `Ctrl + P` also works — it prints whichever week you're currently viewing.

> 📌 **Title format**: on import, the event title (everything except the time) is split in order into "name chart_no-phone procedure/note". English text (e.g. `Bil legs veno`, `PermCath insertion`, `L't IV-DSA`) goes to **procedure/site**, Chinese text (e.g. `分`, `聯`, `分院`, `拆線`) goes to **note**. E.g. `劉海倫 4750012-0985500663 分院`, `游幸春2299542拆線`, `陳人華 293005 L't IV-DSA` all parse correctly (separators optional). The split result can be edited in the confirm table.

## Color mapping

| Site (contains) | Color |
| --- | --- |
| veno | 🟢 Green #1D9E75 |
| PTA | 🔵 Blue #378ADD |
| Stenting / TEVAR / EVAR | 🟣 Purple #534AB7 |
| RH | 🟠 Orange #BA7517 |
| M3 / other | ⚪ Gray #888780 |
| `uncertain: true` | 🔴 Red #E24B4A (overrides all) |

## Security notes

- The **password** lives server-side in Apps Script (Script Properties); it is never in the front-end source. The browser only caches what the user typed in `localStorage`.
- The **Google Sheet stays private** — reads/writes always go through Apps Script as the owner; visitors without the password can neither read nor modify data.
- If you use calendar import, `GOOGLE_API_KEY` is exposed in the front end — restrict it to **Calendar API** + your domain (HTTP referrer), and keep that calendar "public read-only".
- The shared password is "good enough to keep strangers out"; for stronger per-user access control, switch to a proper per-account auth mechanism.

## License

MIT
