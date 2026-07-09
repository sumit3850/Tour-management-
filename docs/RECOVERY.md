# Data recovery — "my tours / inbox are empty"

This guide restores the Island Explorer data for **explorer3850@gmail.com** after
the SaaS migration left the console showing no tours and an empty inbox.

## What actually happened (short version)

Two separate problems, both introduced on migration day (2026-07-08):

1. **Inbox (affects every company, 100% reproducible).** The new per-company
   security rules in `supabase/saas/schema.sql` removed the old "team full
   access" policy. Form submissions are stored as `sub_…` rows in the
   `workspaces` table, and no new rule allowed *anyone* to read them — so the
   inbox went blank for everybody. **No submissions were lost**: public forms
   kept writing them successfully the whole time; they were just unreadable.

2. **Tours/bookings.** Either
   - the `island-explorer` data row was overwritten with an empty dataset by a
     login-wipe bug that existed between 14:11 and 16:43 IST on 2026-07-08
     (fixed in PR #182) — recoverable from the `ieo_*` per-record mirror
     tables, which the migration locked but never deleted; **or**
   - your sign-in resolved to the wrong (empty) workspace, and the real data
     row is untouched — a pure account-linkage fix.

   The recovery script below detects which case you're in and picks the best
   surviving source automatically. It never copies another company's workspace
   row, and it snapshots everything before changing anything.

## Recovery steps

### Step 0 — before anything else

- **Do not sign in to the console on any device you haven't used since the
  migration** (an old phone, another laptop, or the app on the other domain —
  `sumit3850.github.io/Tour-management-` vs the Cloudflare `pages.dev` /
  custom domain). Such a device may hold the last local copy of your data,
  and signing in clears it. Rescue it first (see "Rescue from a device").
- If you scheduled the hourly Google-Sheet rate import (`import-rates` edge
  function / cron), pause it until recovery is confirmed.

### Step 1 — run the recovery script

1. Open **Supabase Dashboard → your project (`tbxzxfjumlnciczizols`) → SQL
   Editor**.
2. Paste the entire contents of **`supabase/saas/recover-data.sql`** and Run.
3. Read the report it prints (it is also safe to re-run):
   - `1 LINKAGE` — your login ↔ Island Explorer org link; duplicate orgs are
     reported (not deleted).
   - `2 RESTORE` — what the data blob contained and what was restored, from
     where. `NONE — … looks healthy` means the data was there all along and
     only the linkage/policies were broken.
   - `6 MY_ORG` — must say `island-explorer`.
   - `4 ORGS` / `5 MEMBERSHIP` / `7 BLOBS` / `8 INBOX` / `9 IEO MIRROR` —
     full state: org rows, memberships, record counts per data blob, number
     of submissions, and what survives in the per-record mirror tables.

Before touching anything the script snapshots the whole `workspaces` table
into `workspaces_rescue_snapshot` (locked away from the public API), so
nothing it does is irreversible.

### Step 2 — deploy the app fixes

Merge/deploy this branch. It ships console fixes that make the recovery stick
and prevent a repeat (see "What changed in the app" below). The service-worker
cache was bumped, so open devices pick the new build up on their next reload.

### Step 3 — verify

1. Reload the console (or open it fresh) and sign in as
   explorer3850@gmail.com.
2. Tours, bookings, customers etc. should be back.
3. Open **Requests** — the inbox should list your submissions again,
   including everything that arrived while it was broken.
4. If the console shows a yellow **"No cloud data found for workspace …"**
   banner: the script's `2 RESTORE` report will have told you why; follow the
   options it printed (see Step 4).

### Step 4 — if the script found no server-side source

In order of preference:

1. **Supabase backups**: Dashboard → Database → Backups. Restore/inspect a
   backup from before **2026-07-08 14:00 IST** and copy the `island-explorer`
   row of the `workspaces` table back into the live table.
2. **Rescue from a device**: on a device/browser that has NOT signed in since
   the migration, open the app's domain but **don't sign in**. In the browser
   devtools console run:

   ```js
   copy(JSON.stringify(Object.assign(
     JSON.parse(localStorage.getItem("ieo_data_v1")||"{}"),
     {trips: JSON.parse(localStorage.getItem("ieo_sync_trips")||"[]")}
   )))
   ```

   This copies the full dataset (including trip logs) to the clipboard.
   **Immediately paste it into a text file and save it** — don't rely on the
   clipboard. Then load it into the cloud via the SQL editor:

   ```sql
   insert into workspaces (id, data, updated_at)
   values ('island-explorer', $json$ PASTE_THE_SAVED_JSON_HERE $json$::jsonb, now())
   on conflict (id) do update set data = excluded.data, updated_at = now();
   ```

3. **A backup file**: any `island-explorer-backup-YYYY-MM-DD.json` exported
   earlier from Settings (Export backup) can be re-imported from the same
   screen (Import backup) after you sign in.

## What changed in the app (prevention)

- **Login/logout no longer destroy the local copy** — they stash it in a
  local backup slot first (largest copy wins, tagged with its company so it
  can't be restored into a different company). Settings → Sync status gains a
  "Restore local backup" button whenever a matching backup exists.
- **An empty cloud pull no longer auto-pushes an empty dataset**, which used
  to create a fresh empty row that masked the real problem on every later
  login. The console now shows a warning banner instead.
- **The "did my sync shrink dramatically?" guard** now counts every collection
  (it used to count 7 of 15, so a wipe could sneak under it), and failed
  syncs no longer clear the "unpushed edit" flags.
- **Inbox errors are shown** instead of silently rendering "No submissions
  yet" when the database refuses the query.
- **Submissions are tagged with the company workspace** (share links carry
  `&ws=…`), and the recovery script adds per-company read/update/delete
  policies keyed on that tag — so each company sees only its own inbox. A
  signed-in browser can also submit forms again (previously blocked by RLS).
- The Settings screens no longer offer "disable row level security" SQL
  snippets, which would have re-opened cross-company access on the shared
  backend, and the stale duplicate console at `src/island-explorer-ops.html`
  now redirects to the real app instead of running old sync code.
