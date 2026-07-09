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
// Visiting the URL in a browser (a GET) or pressing "Run" in the editor is fine —
// you'll just see this message. Real data arrives via POST from the app.
function doGet(e){ return ContentService.createTextOutput("Island Explorer sheet webhook is live."); }

function doPost(e){
  // Guard so a manual "Run" (no request) doesn't throw "Cannot read properties of undefined".
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("ready — send data from the app, don't press Run here.");
  }
  var body = JSON.parse(e.postData.contents);          // {kind, mode, header, rows} or {kind, row, keyField}
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Delete mode: remove a tab the app no longer uses (e.g. old Referral tabs) ---
  if (body.mode === "delete") {
    var toDelete = ss.getSheetByName(body.kind);
    if (toDelete && ss.getSheets().length > 1) ss.deleteSheet(toDelete);
    return ContentService.createTextOutput("ok-delete");
  }

  var sheet = ss.getSheetByName(body.kind) || ss.insertSheet(body.kind);

  // --- Mirror mode: replace the whole tab with the console's current list ----
  // The app sends every row it currently has (bookings = POC rows only), so the tab
  // exactly matches the console: deletions disappear, edits update, old rows are wiped.
  // The whole tab is then formatted to the standard house style (Arial 10, a bold,
  // centred, frozen header row, and auto-fitted columns) so every user's sheet looks
  // identical regardless of which tab or how many rows.
  if (body.mode === "replace") {
    var rHeader = body.header || [];
    var rRows = body.rows || [];
    sheet.clear();
    var out = [rHeader];
    rRows.forEach(function(r){ out.push(rHeader.map(function(h){ return r[h] != null ? r[h] : ""; })); });
    if (rHeader.length) {
      var rng = sheet.getRange(1, 1, out.length, rHeader.length);
      rng.setValues(out);
      // House style — matches IEBT_Live_Data.xlsx
      rng.setFontFamily("Arial").setFontSize(10).setVerticalAlignment("middle");
      var head = sheet.getRange(1, 1, 1, rHeader.length);
      head.setFontWeight("bold").setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, rHeader.length);
    }
    return ContentService.createTextOutput("ok-replace " + rRows.length);
  }

  var row = body.row || {};
  var keys = Object.keys(row);                          // app-defined column order

  // --- Self-healing header order ---------------------------------------------
  // The columns should follow the order the app sends (the "customer" tab then
  // matches Customer_Database.xlsx exactly). Desired = sent columns first, then any
  // extra columns that already exist but the app no longer sends, appended at the end.
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  var existing = lastRow ? sheet.getRange(1,1,1,lastCol).getValues()[0] : [];
  var header = keys.slice();
  existing.forEach(function(h){ if (h !== "" && header.indexOf(h) === -1) header.push(h); });

  // If the current header doesn't already match, rewrite the whole sheet into the
  // new column order (data is matched by column name, so nothing is lost).
  var sameOrder = existing.length === header.length && existing.every(function(h,i){ return h === header[i]; });
  if (!sameOrder) {
    var newRows = [header];
    if (lastRow > 1) {
      var data = sheet.getRange(2,1,lastRow-1,lastCol).getValues();
      data.forEach(function(r){
        newRows.push(header.map(function(h){ var ci = existing.indexOf(h); return ci > -1 ? r[ci] : ""; }));
      });
    }
    sheet.clear();
    sheet.getRange(1,1,newRows.length,header.length).setValues(newRows);
  }

  var line = header.map(function(h){ return row[h] != null ? row[h] : ""; });
  // Upsert (no duplicates) on the key column — defaults to the first column sent.
  var keyField = body.keyField || keys[0];
  var keyVal = row[keyField];
  var updated = false;
  if (keyVal && sheet.getLastRow() > 1){
    var kc = header.indexOf(keyField);
    if (kc > -1){
      var col = sheet.getRange(2,kc+1,sheet.getLastRow()-1,1).getValues();
      for (var i=0;i<col.length;i++){ if (String(col[i][0]) === String(keyVal)){ sheet.getRange(i+2,1,1,line.length).setValues([line]); updated = true; break; } }
    }
  }
  if (!updated) sheet.appendRow(line);
  return ContentService.createTextOutput("ok");
}
```

> **Already deployed the older script?** Replace it with the code above, then
> **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy** (re-using
> the same URL). This version **re-orders the columns automatically** and **formats
> each tab** (Arial 10, a bold, centred, frozen header row, auto-fitted columns) on the
> next push — you do **not** need to delete the tab. After re-deploying, click **Push
> all now** once and every tab is rebuilt to the standard layout below.
>
> **The workbook has 12 tabs, in this order** (rows are ordered newest-tour-first —
> T3, T2, T1 — for every tour-based tab):
>
> 1. **`Booking`** — Booking ID · Tour ID · Tour · BookingDate · Point of Contact (POC) ·
>    Tour Start_Date · Tour End_Date · Member (s) · Party Size · Country · Email · Phone ·
>    Status · Total Tour Cost · Deposit · Pending Amount · Due Date · Payment Status ·
>    Additional Notes
> 2. **`Accommodations`** — Booking ID · Tour ID · Tour · Guest (POC) · Guide · Property
>    Name · Rooms · Guests · Check-in · Check-out · No. of Nights · Status
> 3. **`Customer DB`** — Client ID · Type · Client Name (Full name) · Tour ID · Tour
>    Category · Tour Start_Date · Tour End_Date · Phone / WhatsApp · Email · Address ·
>    Nationality · Date of birth · Gender · ID type · ID / passport number · Arrival
>    Flight and time · Departure Flight and time · Dietary needs · Room preference ·
>    Emergency contact name · Emergency contact phone · Medical notes / mobility ·
>    Upload documents link
> 4. **`Operations`** — Tour ID · Tour · Date · Start · End · Pax · POC · POC Phone ·
>    Vehicle · Reg. No. · Driver · Driver No. · Guide · Guide ID · Guide phone · Pickup
>    Date · Pickup Location · Drop Date · Drop Location · Stay · Legs · Status · Remarks ·
>    Guide/Driver Feedback
> 5. **`Guide_Roster`** — Tour ID · Tour · Tour Start_Date · Tour End_Date · Tour Leader ·
>    External Guides · Pax · Capacity · Status · Session Type · Total Guide Fee
> 6. **`Quotation Log`** — Quotation # · Quotation To · Address · GST No. · Tour · Start
>    Date · End Date · Total No. of Participants · Total Tour price · Cost per person ·
>    Deposit to confirm (%) · Pending amount
> 7. **`Invoice`** — Invoice # · Invoice To · Address · GST No. · Tour · Start Date · End
>    Date · Total No. of Participants · Accommodation · Travel and Logistics · Food ·
>    Entry tickets · Ship tickets · Guide Fee · Referral amount · Total Amount
> 8. **`Activities Log`** — Tour ID · Date · Vehicle · Reg. No. · Driver · Start km ·
>    End km · Total km · Location · Time · Total Amount (Paid) · Entry
> 9. **`Profit`** — Tour ID · Tour · Total Tour Cost · Accommodation · Travel and
>    Logistics · Food · Entry tickets · Ship tickets · External guide · Referral amount ·
>    Total Expenses · Profit
> 10. **`Guides`** — Guide ID · Name · Expertise · Phone · Email · Login Code · ID Number ·
>     ID Document · Address
> 11. **`Drivers`** — Driver · Phone · Code · Assigned Vehicle · Reg. No. · Licence ·
>     Licence Document · Address
> 12. **`Vehicles`** — Vehicle · Reg. No. · Type · Seats · Driver · Login Code · Status
>
> Earlier builds used the tab names `Customer Database`, `Roster`, `Logistics &
> Operations`, `Profit Calculator`, `Accommodation Bookings` and `External Guides`;
> the app now renames them (and deletes the old tabs) automatically on the next push.
> Prefer the same layout offline? Use **Settings → Download workbook (.xlsx)** — it
> produces this exact workbook from your live data.
>
> (If you'd rather start clean, deleting the tabs before pushing also works.)

### 2. Deploy
**Deploy → New deployment → type: Web app** → Execute as **Me** → Who has access **Anyone** → **Deploy** → copy the **web-app URL** (`https://script.google.com/macros/s/…/exec`).

### 3. Connect
Paste that URL in **Settings → Google Sheet auto-push → Save webhook**. Click **Push all now** once. From then on the **`Booking`** and **`Customer Database`** tabs are kept **in mirror-sync with the console**: whenever you add, edit or delete a booking/customer, the whole tab is rebuilt to match — so deletions disappear, edits update, and old/stale rows are wiped. The `Booking` tab lists **one row per tour (the POC)**; the other party members are summarised in the **Member (s)** column. (No duplicate lowercase tabs are created.)
