# Per-record database

> **Security note:** the SQL below (and the `workspaces` table before it) grants
> full read/write to the public `anon` key — fine while you're only your own
> tester, not once real client data is in there. After running this setup,
> also run `docs/SECURE_ACCESS.md` once to lock every table to your signed-in
> team and close that off.

The app has always synced through a single Supabase table (`workspaces`): one row
per device-group, holding the **entire dataset as one JSON blob**, replaced
wholesale on every push. That's simple, but it means a sync bug (or a device with
stale local data) can, in the worst case, overwrite *everything* in one write.

This adds a second layer on top: **every tour, booking, customer, vehicle,
driver, guide, operation, reservation, quotation and trip log gets its own row in
its own table**, keyed by that record's own id (or name, for a few older
collections that use name as their identity). A sync now only ever touches the
specific rows that actually changed on that device since its last sync — it
can't wipe a table, because it never rewrites a whole table, only upserts or
deletes individual rows.

## How it activates

Nothing to configure in the app. Run the SQL below **once** in the Supabase SQL
editor (or via **Settings → Per-record database → Show one-time table setup
SQL**, which prints the exact same script). The app checks for these tables on
every load; if they exist, it automatically starts using them going forward. If
they don't exist yet, everything keeps working exactly as before — the `workspaces`
blob sync (already the safe, timestamp-fixed version) remains the fallback.

The `workspaces` blob is **not removed** — it keeps working as a full-state
mirror/backup, and still carries the few small config values (cost-calculator
rates, the Google Sheet webhook, etc.) that aren't naturally "many records."

## Setup

```sql
-- Run this ONCE in the Supabase SQL editor. Creates one table per collection,
-- each row = one record (id/name as primary key). Same permissive setup as the
-- existing 'workspaces' table, so it works with the publishable key already in the app.

create table if not exists ieo_tours (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_tours disable row level security;
grant all on table ieo_tours to anon, authenticated;

create table if not exists ieo_bookings (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_bookings disable row level security;
grant all on table ieo_bookings to anon, authenticated;

create table if not exists ieo_customers (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_customers disable row level security;
grant all on table ieo_customers to anon, authenticated;

create table if not exists ieo_accommodations (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_accommodations disable row level security;
grant all on table ieo_accommodations to anon, authenticated;

create table if not exists ieo_acc_bookings (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_acc_bookings disable row level security;
grant all on table ieo_acc_bookings to anon, authenticated;

create table if not exists ieo_leads (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_leads disable row level security;
grant all on table ieo_leads to anon, authenticated;

create table if not exists ieo_vehicles (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_vehicles disable row level security;
grant all on table ieo_vehicles to anon, authenticated;

create table if not exists ieo_drivers (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_drivers disable row level security;
grant all on table ieo_drivers to anon, authenticated;

create table if not exists ieo_ops (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_ops disable row level security;
grant all on table ieo_ops to anon, authenticated;

create table if not exists ieo_external_guides (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_external_guides disable row level security;
grant all on table ieo_external_guides to anon, authenticated;

create table if not exists ieo_reservations (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_reservations disable row level security;
grant all on table ieo_reservations to anon, authenticated;

create table if not exists ieo_operators (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_operators disable row level security;
grant all on table ieo_operators to anon, authenticated;

create table if not exists ieo_quotation_log (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_quotation_log disable row level security;
grant all on table ieo_quotation_log to anon, authenticated;

create table if not exists ieo_trip_logs (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table ieo_trip_logs disable row level security;
grant all on table ieo_trip_logs to anon, authenticated;
```

## What's in each table

| Table | Record = | Keyed by |
|---|---|---|
| `ieo_tours` | one tour | `id` (auto Tour ID, e.g. `T7`'s underlying id) |
| `ieo_bookings` | one booking | `id` |
| `ieo_customers` | one customer / client | `id` |
| `ieo_accommodations` | one property | `id` |
| `ieo_acc_bookings` | one accommodation booking | `id` |
| `ieo_leads` | one CRM lead | `id` |
| `ieo_vehicles` | one vehicle | `name` |
| `ieo_drivers` | one driver | `name` |
| `ieo_ops` | one operation (Operations Board) | `id` |
| `ieo_external_guides` | one external guide | `gid` (Guide ID) |
| `ieo_reservations` | one guide-service reservation | `id` |
| `ieo_operators` | one Settings → User roles entry | `name` |
| `ieo_quotation_log` | one generated quotation | its quotation number |
| `ieo_trip_logs` | one Daily Activity trip entry | `id` |

Each row's `data` column holds the full record as JSON (same shape the app
already uses in memory) — so the profit-calculator numbers on a tour, or a guide's
feedback/timestamp on an operation, travel with that record automatically; there's
no separate table needed for those.

## Manual controls

**Settings → Per-record database**:
- **Push all records ↑** — force-write this device's current data into every table.
- **Pull all records ↓** — force-read every table into this device (and flips
  per-record sync on if the tables are found).

Normal use needs neither — sync happens automatically in the background once the
tables exist.
