# AngioSchedule

A pure-static web app for hospital procedure scheduling. Nurses upload a photo of a handwritten schedule, Gemini AI parses it automatically, results are stored in Google Sheets, and everything is displayed as a Google Calendar-style week view.

🔗 Live demo: <https://cli1976.github.io/AngioSchedule/>

## Features

- 📅 FullCalendar week / day / month views
- 🗓️ **Import from a public Google Calendar**: shows the current year/week, pick a start week and span, then batch-fetch; event titles are auto-split into name / chart no. / phone / procedure-site / note (English → procedure/site, Chinese → note). Reads only the one calendar set in config, and **login requests no calendar permission at all**
- 📷 Upload handwritten schedule photos (mobile camera supported), parsed by Gemini 2.5 Flash (kept as fallback)
- ✏️ Inline editing for parsed rows before importing
- 💾 Auto-write to Google Sheet with UUIDs
- 🖱️ Click any event to edit / delete
- 📤 One-click `.ics` export for Google Calendar / Outlook / Apple Calendar
- 🎨 Auto color coding by site (veno / PTA / Stenting / RH / M3); uncertain rows highlighted in red
- 🖨️ Print-friendly stylesheet (buttons hidden, clean table layout)
- 📱 Responsive — works on mobile browsers

## Stack

| Purpose | Tech |
| --- | --- |
| Calendar UI | [FullCalendar 6](https://fullcalendar.io/) (CDN) |
| OCR | Google [Gemini 2.5 Flash](https://ai.google.dev/) REST API |
| Calendar import | [Google Calendar API v3](https://developers.google.com/calendar/api) (API key on a public calendar, no OAuth) |
| Data store | [Google Sheets API v4](https://developers.google.com/sheets/api) |
| Auth | [Google Identity Services](https://developers.google.com/identity/oauth2/web) |
| Export | Handwritten ICS (RFC 5545) |

## File layout

```
angioschedule/
├── index.html
├── app.js
├── style.css
├── config.js            ← create yourself; gitignored
├── config.example.js    ← template
└── README.md
```

## Setup

### 1. Create the Google Sheet

Create a spreadsheet with a sheet named `schedules` and the following header row:

| id | date | time | name | chart_no | phone | site | note | uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Share with **"Anyone with the link: Viewer"** so unauthenticated visitors can read the calendar.

### 2. Get a Gemini API key

Grab a free one from [Google AI Studio](https://aistudio.google.com/app/apikey).

### 3. Set up Google OAuth 2.0

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Enable **Google Sheets API** and **Google Calendar API** (required for calendar import)
3. Create an **OAuth 2.0 Client ID** (type: Web application) — used only to write to the Sheet, **no** calendar permission
4. Add your deployment URLs to **Authorized JavaScript origins**:
   - `https://cli1976.github.io`
   - `http://localhost:8080` (for local dev)
5. Create an **API key** (Credentials → Create credentials → API key) to read the public calendar.
   Recommended: restrict it to **Calendar API** + your domain (HTTP referrer).

### 3-1. Make the calendar public

In the Google Calendar you want to import → Settings → **Access permissions** → check "**Make available to public** (See all event details)".
The calendar ID is usually the account email.

### 4. Create config.js

Copy `config.example.js` to `config.js` and fill in your keys:

```javascript
const CONFIG = {
  GEMINI_API_KEY: "your gemini key",
  GOOGLE_CLIENT_ID: "your oauth client id.apps.googleusercontent.com",
  GOOGLE_SHEET_ID: "sheet id from the URL",
  GOOGLE_CALENDAR_ID: "public calendar id to import (usually an email)",
  GOOGLE_API_KEY: "" // key with Calendar API access; falls back to GEMINI_API_KEY if empty
};
```

> ⚠️ `config.js` is gitignored — it will **not** be pushed to GitHub. Never commit real API keys.

### 5. Local dev

OAuth callback requires an HTTP origin, so serve via any static server:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve -l 8080
```

Open <http://localhost:8080>.

### 6. Deploy to GitHub Pages

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

In the repo settings → Pages → Source, pick `main` branch / root. Auto-deploy is enabled.

> ⚠️ **For production**: you'll need to populate `config.js` on the deployed site separately — since `config.js` is not committed, either upload it manually or inject it via a GitHub Actions secret + `envsubst` flow.

## User flow

1. Anyone can open the page and see the calendar (public read)
2. Nurse clicks **"Sign in with Google"** to authorize (**only asks for "edit spreadsheets"**, needed to write to the Sheet; no calendar permission)
3. Import schedules (either option):
   - **Import from Google Calendar** (recommended): the app shows the current year/week and the public calendar to read → enter a start week and span (e.g. current week 24, start at week 25 for 2 weeks) → click "Fetch"
   - **Import from photo** (fallback): pick a schedule photo → Gemini parses
4. Review rows and fix fields in the confirm modal
5. Click **"Confirm import"** → rows are appended to the Google Sheet
6. Click any event on the calendar to edit or delete
7. Anyone can click **"Export .ics"** to download the calendar

> 📌 **Title format**: on import, the event title (everything except the time) is split in order into "name chart_no-phone procedure/note". English text (e.g. `Bil legs veno`, `PermCath insertion`, `L't IV-DSA`) goes to **procedure/site**, Chinese text (e.g. `分`, `聯`, `分院`, `拆線`) goes to **note**. E.g. `劉海倫 4750012-0985500663 分院`, `游幸春2299542拆線`, `陳人華 293005 L't IV-DSA` all parse correctly (separators optional). The split result can be edited in the confirm table.

## Color mapping

| Site (contains) | Color |
| --- | --- |
| veno | 🟢 Green #1D9E75 |
| PTA | 🔵 Blue #378ADD |
| Stenting | 🟣 Purple #534AB7 |
| RH | 🟠 Orange #BA7517 |
| M3 / other | ⚪ Gray #888780 |
| `uncertain: true` | 🔴 Red #E24B4A (overrides all) |

## Security notes

- `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `GOOGLE_CLIENT_ID` are exposed in the front end. Make sure to:
  - Restrict the OAuth client to your domain in Google Cloud Console
  - Set an HTTP referrer restriction on the Gemini key in AI Studio
  - Restrict `GOOGLE_API_KEY` to Calendar API only + your domain (HTTP referrer)
- The calendar is read as "public, read-only"; login requests **no** calendar permission
- Write access to the Sheet requires OAuth login — unauthenticated visitors cannot add / edit / delete data

## License

MIT
