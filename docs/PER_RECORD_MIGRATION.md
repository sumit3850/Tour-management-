# Migration plan — from one JSON blob to per-record rows

## Why

Today every company's entire dataset lives as a **single JSON blob** in
`workspaces.data`, rewritten wholesale on every save. That one design choice is
the root of most of the serious problems this app has hit:

- **Data loss on overwrite.** Any bug (or stale device, or the login-wipe window
  we just fixed) that pushes an empty/old blob replaces *everything* at once.
- **Concurrent-edit clobbering.** Two staff in the same company editing at the
  same time → last-writer-wins on the whole blob → one person's changes vanish.
  This blocks real multi-user use.
- **Coarse recovery.** You can only restore the whole blob to a point in time,
  never a single record.
- **Big writes.** Every keystroke-level save re-uploads the entire dataset.

A `ieo_*` per-record layer already exists in the code (`pushRecordsForKey` /
`pullAllRecords`, `PER_RECORD_KEYS`, `recTable()`), but on the shared SaaS
backend it was **globally scoped with no company column** and is currently
locked off. This plan makes per-record the real, tenant-safe source of truth.

## Target schema

One table per collection, each **row = one record**, every row tagged with its
owning workspace and protected by RLS. Example for tours (repeat for bookings,
customers, accommodations, acc_bookings, leads, vehicles, drivers, ops,
external_guides, reservations, operators, quotation_log, trip_logs):

```sql
create table if not exists rec_tours (
  workspace  text not null,
  id         text not null,          -- record id (name for vehicles/drivers/operators, gid for guides)
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,            -- soft delete (see below)
  primary key (workspace, id)
);
create index if not exists rec_tours_ws on rec_tours (workspace);
alter table rec_tours enable row level security;

create policy "members rw their workspace rows" on rec_tours for all to authenticated
  using (workspace in (select o.workspace from orgs o
                         join org_members m on m.org_id = o.id
                        where m.user_id = auth.uid() and o.status = 'approved'))
  with check (workspace in (select o.workspace from orgs o
                              join org_members m on m.org_id = o.id
                             where m.user_id = auth.uid() and o.status = 'approved'));
```

Key differences from today's `ieo_*` tables: a **`workspace` column in the
primary key**, **RLS scoped to org membership** (not global), and a
**`deleted_at`** column so deletes are reversible.

The `workspaces` blob does **not** go away immediately — it stays as a
whole-state mirror/backup during the transition (belt and suspenders).

## Client changes (index.html)

1. Reuse the existing per-record plumbing, with two changes:
   - `recTable()` → the new `rec_*` names; include `workspace: cfg.ws` on every
     upsert and filter every select by `.eq("workspace", cfg.ws)`.
   - Deletes become `update ... set deleted_at = now()` (soft delete); pulls
     filter `deleted_at is null`.
2. Make the per-record layer the **primary** sync (it already overrides the blob
   for its collections when active). The blob push stays only as a periodic full
   snapshot, not the authoritative write path.
3. Concurrency: because each record is its own row, two people editing different
   records never collide. For the rare same-record collision, last-write-wins per
   *record* (tiny blast radius) — optionally add `updated_at` optimistic checks
   later.

## Rollout (safe, reversible, staged)

1. **Ship the schema** (`rec_*` tables + RLS) with no client change. Nothing uses
   them yet; zero risk.
2. **Dual-write**: client writes to BOTH the blob and `rec_*`. Reads still come
   from the blob. Run for a few days; compare counts (a small admin query).
3. **Backfill** existing data: one-time SQL copying each collection out of every
   `workspaces` blob into the matching `rec_*` table, tagged by workspace.
4. **Flip reads** to `rec_*` (blob becomes mirror-only). Keep dual-write.
5. **Verify** for a week (the blob mirror is your instant rollback: flip reads
   back if anything is off).
6. **Retire** the blob as the write path; keep a nightly blob snapshot as backup.

Each step is independently deployable and reversible; at no point is there a
window where data exists in only one place.

## Companion improvements (fit naturally here)

- **Server-side backups**: a nightly job copying `rec_*` (or the blob mirror)
  into dated snapshot tables, or enable Supabase PITR — so recovery never again
  depends on a device's local cache.
- **Audit log**: an `activity_log(workspace, user_id, table, id, action, at)`
  row written by a trigger — who changed what, and undo support via `deleted_at`.
- **Per-user roles**: add `role` checks to the RLS policies (owner / operator /
  read-only) so access is enforced in the database, not just shown in the UI.

## Effort

Roughly: schema + RLS (½ day), client dual-write + reads (1–2 days), backfill +
verification (staged over ~1–2 weeks of low-risk soak). The per-record plumbing
already existing in the client is what makes this a refactor rather than a
rewrite.
