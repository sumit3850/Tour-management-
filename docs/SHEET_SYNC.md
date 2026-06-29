# Google Sheet → Supabase rate sync

Two ways to pull your per-person tour rates from a Google Sheet into the ops
console. Both write the rates into Supabase so they sync to every device.

---

## Your sheet format

The sheet (or one tab of it) should have a header row and one row per tour
category. Column names are matched flexibly (case-insensitive, partial match):

| Column        | Matched on                          | Required |
|---------------|-------------------------------------|----------|
| `id`          | `id`                                | optional |
| `category`    | `category` / `name` / `tour`        | yes (if no `id`) |
| `indian`      | `indian` / `domestic` / `ind`       | yes      |
| `foreigner`   | `foreigner` / `foreign` / `intl`    | yes      |

Example:

```
id,category,indian,foreigner
T1,5-Night South Andaman,48500,62500
T2,12-Night Great Nicobar,118500,148000
T3,7-Night South & Little Andaman,72000,92000
```

Rows are matched to a tour by `id` first, then by category/name (the sheet name
just has to contain, or be contained by, the tour's name).

---

## Option A — In-app import (no server, easiest)

1. In Google Sheets: **File → Share → Publish to web** → pick the sheet →
   **Comma-separated values (.csv)** → **Publish**. Copy the published link.
2. In the console: **Cost Calculator → Link Sheet** → paste the CSV link.
3. Rates import immediately, are saved on the device, and sync via Supabase.

> Use the **Publish to web** CSV link, not a normal "share" link — only the
> published CSV is readable directly by the browser.

---

## Option B — Automated import (Supabase Edge Function)

Runs server-side on a schedule, so rates stay in sync without anyone clicking.

### 1. Install the Supabase CLI and link the project
```bash
npm i -g supabase
supabase login
supabase link --project-ref tbxzxfjumlnciczizols
```

### 2. Deploy the function
```bash
supabase functions deploy import-rates --no-verify-jwt
```

### 3. Set the secrets
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Edge runtime — you only set these two:
```bash
supabase secrets set \
  SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/e/XXXX/pub?output=csv" \
  WORKSPACE_ID="island-explorer"
```

### 4. Test it
```bash
curl -i https://tbxzxfjumlnciczizols.supabase.co/functions/v1/import-rates
# -> {"ok":true,"workspace":"island-explorer","updated":N}
```

### 5. Schedule it (every hour)
In the Supabase Dashboard → **Database → Cron** (or **Integrations → Cron**),
create a job that invokes the function, e.g. hourly:
```sql
select cron.schedule(
  'import-rates-hourly',
  '0 * * * *',
  $$ select net.http_get('https://tbxzxfjumlnciczizols.supabase.co/functions/v1/import-rates') $$
);
```

The function reads the workspace blob, updates `data.tourCosts` from the sheet,
and writes it back. The app picks up the new rates on its next auto-pull.

> The service-role key is powerful and stays server-side inside the Edge
> Function — never put it in the browser app or commit it to the repo.

---

## Option C — Auto-push to Google Sheets (Apps Script web app)

The console can POST every new **booking** and **customer** to a Google Sheet via a tiny Apps Script web app. No service account, free.

### 1. Create the script
In your Google Sheet → **Extensions → Apps Script** → paste:

```javascript
function doPost(e){
  var body = JSON.parse(e.postData.contents);   // {kind, row, at}
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(body.kind) || ss.insertSheet(body.kind);
  var row = body.row || {};
  var keys = Object.keys(row);
  if (sheet.getLastRow() === 0) sheet.appendRow(["at"].concat(keys));   // header
  sheet.appendRow([body.at].concat(keys.map(function(k){return row[k];})));
  return ContentService.createTextOutput("ok");
}
```

### 2. Deploy
**Deploy → New deployment → type: Web app** → Execute as **Me** → Who has access **Anyone** → **Deploy** → copy the **web-app URL** (`https://script.google.com/macros/s/…/exec`).

### 3. Connect
Paste that URL in **Settings → Google Sheet auto-push → Save webhook**. Click **Push all now** to back-fill existing data. From then on, each new booking/customer is appended to a `booking` / `customer` tab automatically.
