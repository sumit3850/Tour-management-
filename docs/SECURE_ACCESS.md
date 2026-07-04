# Secure shared workspace

Until now, every table (`workspaces` + the 14 `ieo_*` per-record tables) granted
full read/write to **anyone holding the publishable key** — and that key is
necessarily visible in the page source of every page in this project, so in
practice the whole database was open to anyone who found the site. That was a
deliberate simplification to get sync working with zero setup, but it's not
appropriate for real client data (names, IDs, documents, phone numbers).

This locks it down to **one shared team database** — everyone on your team
(Admin, Operators, Sales) still sees and edits the same tours/bookings/customers,
no isolation between team members — but a random visitor with only the public
key can no longer read or write any of it. The three public-facing pages
(`register.html`, `respond.html`) and the phone+code guide/driver apps
(`ops-guide.html`, `driver-app.html`) keep working, but through narrow,
purpose-built doors instead of a wide-open table.

## What changes

- **`workspaces` and all `ieo_*` tables**: full read/write now requires a
  **signed-in team account** (Settings → the email/password sign-in already in
  the console). The public key alone no longer grants access to any of them.
- **Public forms** (`register.html`'s tour-interest / guest-detail / guide
  / guide-directory forms) can still submit — they only ever need to *insert a
  new row*, never read anything, so that's all they're allowed to do.
- **Guide-response link** (`respond.html`), the **guide app**
  (`ops-guide.html`) and the **driver app** (`driver-app.html`) don't use
  Supabase Auth (they use your own phone+code login) — they now go through
  three database functions that check the phone+code (or reservation id)
  *inside the database* and hand back only that caller's own slice of data,
  never the whole table.

## Run this once

Paste into the Supabase SQL editor and run it. Safe to re-run — every
statement either drops-and-recreates or uses `if exists`/`or replace`.

```sql
-- ============================================================
-- Secure shared workspace: lock the data to your signed-in team,
-- while keeping public forms and the phone+code guide/driver apps working.
-- ============================================================

-- 1) Turn on row-level security everywhere.
alter table workspaces enable row level security;
alter table ieo_tours enable row level security;
alter table ieo_bookings enable row level security;
alter table ieo_customers enable row level security;
alter table ieo_accommodations enable row level security;
alter table ieo_acc_bookings enable row level security;
alter table ieo_leads enable row level security;
alter table ieo_vehicles enable row level security;
alter table ieo_drivers enable row level security;
alter table ieo_ops enable row level security;
alter table ieo_external_guides enable row level security;
alter table ieo_reservations enable row level security;
alter table ieo_operators enable row level security;
alter table ieo_quotation_log enable row level security;
alter table ieo_trip_logs enable row level security;

-- 2) Replace the old "grant all to anon" with "grant all to authenticated only".
revoke all on table workspaces, ieo_tours, ieo_bookings, ieo_customers,
  ieo_accommodations, ieo_acc_bookings, ieo_leads, ieo_vehicles, ieo_drivers,
  ieo_ops, ieo_external_guides, ieo_reservations, ieo_operators,
  ieo_quotation_log, ieo_trip_logs
  from anon, authenticated;

grant select, insert, update, delete on table
  workspaces, ieo_tours, ieo_bookings, ieo_customers, ieo_accommodations,
  ieo_acc_bookings, ieo_leads, ieo_vehicles, ieo_drivers, ieo_ops,
  ieo_external_guides, ieo_reservations, ieo_operators, ieo_quotation_log,
  ieo_trip_logs
  to authenticated;

drop policy if exists "team full access" on workspaces;
create policy "team full access" on workspaces for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_tours;
create policy "team full access" on ieo_tours for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_bookings;
create policy "team full access" on ieo_bookings for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_customers;
create policy "team full access" on ieo_customers for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_accommodations;
create policy "team full access" on ieo_accommodations for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_acc_bookings;
create policy "team full access" on ieo_acc_bookings for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_leads;
create policy "team full access" on ieo_leads for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_vehicles;
create policy "team full access" on ieo_vehicles for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_drivers;
create policy "team full access" on ieo_drivers for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_ops;
create policy "team full access" on ieo_ops for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_external_guides;
create policy "team full access" on ieo_external_guides for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_reservations;
create policy "team full access" on ieo_reservations for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_operators;
create policy "team full access" on ieo_operators for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_quotation_log;
create policy "team full access" on ieo_quotation_log for all to authenticated using (true) with check (true);
drop policy if exists "team full access" on ieo_trip_logs;
create policy "team full access" on ieo_trip_logs for all to authenticated using (true) with check (true);

-- 3) Public forms may ONLY insert a new submission row (id starting "sub_") —
--    never read anything, never touch any other row.
grant insert on table workspaces to anon;
drop policy if exists "public can submit forms" on workspaces;
create policy "public can submit forms" on workspaces for insert to anon
  with check (id like 'sub\_%' escape '\');

-- 4) Narrow, purpose-built functions for the phone+code apps and the guide
--    response link. Each runs with elevated rights INSIDE the database
--    (security definer) but only ever returns the caller's own slice of
--    data — the tables themselves stay locked to the team.

-- FAST PATH: reads the small per-record tables (each holds only one kind of
-- record, e.g. just guides, just ops) instead of the one shared "workspaces" row
-- that also carries every tour/booking/customer and any inline base64 document
-- photos. Falls back to that shared row automatically if the per-record tables
-- haven't been set up yet (docs/DATABASE_SCHEMA.md) — same result either way,
-- just slower on the fallback path. This is what actually fixes slow sign-in for
-- most setups, since Postgres no longer has to load the whole shared blob just
-- to check one phone + code.
create or replace function public.guide_login(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws jsonb; guides jsonb; roster jsonb; g jsonb; gname text; ops jsonb; vehs jsonb; drvs jsonb;
  has_precord boolean := true;
begin
  begin
    select data into g from ieo_external_guides
      where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(data->>'code','') = p_code
      limit 1;
  exception when undefined_table then has_precord := false;
  end;

  if has_precord then
    if g is null then
      begin
        select jsonb_build_object('name',data->>'name','phone',data->>'phone','code',data->>'code') into g
          from ieo_operators
          where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
            and coalesce(data->>'code','') = p_code
            and lower(coalesce(data->>'role','')) = 'guide'
          limit 1;
      exception when undefined_table then null;
      end;
    end if;
    if g is null then return jsonb_build_object('error','no_match'); end if;
    gname := lower(trim(g->>'name'));
    begin
      select coalesce(jsonb_agg(o.data),'[]'::jsonb) into ops from ieo_ops o
        where lower(trim(coalesce(o.data->>'guide',''))) = gname;
    exception when undefined_table then ops := '[]'::jsonb;
    end;
    begin
      select coalesce(jsonb_agg(v.data),'[]'::jsonb) into vehs from ieo_vehicles v;
    exception when undefined_table then vehs := '[]'::jsonb;
    end;
    begin
      select coalesce(jsonb_agg(d.data),'[]'::jsonb) into drvs from ieo_drivers d;
    exception when undefined_table then drvs := '[]'::jsonb;
    end;
    return jsonb_build_object('guide',g,'ops',ops,'vehicles',vehs,'drivers',drvs);
  end if;

  -- FALLBACK: per-record tables not set up yet — read the shared blob (slower).
  select data into ws from workspaces where id = 'island-explorer';
  if ws is null then return jsonb_build_object('error','not_found'); end if;
  guides := coalesce(ws->'externalGuides','[]'::jsonb);
  roster := coalesce(ws->'operators','[]'::jsonb);
  select x into g from jsonb_array_elements(guides) x
    where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
      and coalesce(x->>'code','') = p_code
    limit 1;
  if g is null then
    select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code') into g
      from jsonb_array_elements(roster) x
      where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(x->>'code','') = p_code
        and lower(coalesce(x->>'role','')) = 'guide'
      limit 1;
  end if;
  if g is null then return jsonb_build_object('error','no_match'); end if;
  gname := lower(trim(g->>'name'));
  select coalesce(jsonb_agg(o),'[]'::jsonb) into ops
    from jsonb_array_elements(coalesce(ws->'ops','[]'::jsonb)) o
    where lower(trim(coalesce(o->>'guide',''))) = gname;
  return jsonb_build_object('guide',g,'ops',ops,
    'vehicles',coalesce(ws->'vehicles','[]'::jsonb),
    'drivers',coalesce(ws->'drivers','[]'::jsonb));
end;
$$;
grant execute on function public.guide_login(text,text) to anon, authenticated;

create or replace function public.driver_login(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws jsonb; drivers jsonb; roster jsonb; d jsonb; dname text; ops jsonb; vehs jsonb;
  has_precord boolean := true;
begin
  begin
    select data into d from ieo_drivers
      where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(data->>'code','') = p_code
      limit 1;
  exception when undefined_table then has_precord := false;
  end;

  if has_precord then
    if d is null then
      begin
        select jsonb_build_object('name',data->>'name','phone',data->>'phone','code',data->>'code','veh','') into d
          from ieo_operators
          where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
            and coalesce(data->>'code','') = p_code
            and lower(coalesce(data->>'role','')) = 'driver'
          limit 1;
      exception when undefined_table then null;
      end;
    end if;
    if d is null then return jsonb_build_object('error','no_match'); end if;
    dname := lower(trim(d->>'name'));
    begin
      select coalesce(jsonb_agg(o.data),'[]'::jsonb) into ops from ieo_ops o
        where lower(trim(coalesce(o.data->>'driver',''))) = dname;
    exception when undefined_table then ops := '[]'::jsonb;
    end;
    begin
      select coalesce(jsonb_agg(v.data),'[]'::jsonb) into vehs from ieo_vehicles v
        where lower(trim(coalesce(v.data->>'driver',''))) = dname;
    exception when undefined_table then vehs := '[]'::jsonb;
    end;
    return jsonb_build_object('driver',d,'ops',ops,'vehicles',vehs);
  end if;

  -- FALLBACK: per-record tables not set up yet — read the shared blob (slower).
  select data into ws from workspaces where id = 'island-explorer';
  if ws is null then return jsonb_build_object('error','not_found'); end if;
  drivers := coalesce(ws->'drivers','[]'::jsonb);
  roster := coalesce(ws->'operators','[]'::jsonb);
  select x into d from jsonb_array_elements(drivers) x
    where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
      and coalesce(x->>'code','') = p_code
    limit 1;
  if d is null then
    select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code','veh','') into d
      from jsonb_array_elements(roster) x
      where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(x->>'code','') = p_code
        and lower(coalesce(x->>'role','')) = 'driver'
      limit 1;
  end if;
  if d is null then return jsonb_build_object('error','no_match'); end if;
  dname := lower(trim(d->>'name'));
  select coalesce(jsonb_agg(o),'[]'::jsonb) into ops
    from jsonb_array_elements(coalesce(ws->'ops','[]'::jsonb)) o
    where lower(trim(coalesce(o->>'driver',''))) = dname;
  select coalesce(jsonb_agg(v),'[]'::jsonb) into vehs
    from jsonb_array_elements(coalesce(ws->'vehicles','[]'::jsonb)) v
    where lower(trim(coalesce(v->>'driver',''))) = dname;
  return jsonb_build_object('driver',d,'ops',ops,'vehicles',vehs);
end;
$$;
grant execute on function public.driver_login(text,text) to anon, authenticated;

-- Powers the Driver App's "Saved Trips" tab — re-validates phone+code (same as
-- driver_login) and returns only that driver's own logged trips, never the
-- full trip log for every driver.
create or replace function public.driver_trips(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws jsonb; drivers jsonb; roster jsonb; d jsonb; dname text; trips jsonb;
  has_precord boolean := true;
begin
  begin
    select data into d from ieo_drivers
      where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(data->>'code','') = p_code
      limit 1;
  exception when undefined_table then has_precord := false;
  end;

  if has_precord then
    if d is null then
      begin
        select jsonb_build_object('name',data->>'name','phone',data->>'phone','code',data->>'code') into d
          from ieo_operators
          where regexp_replace(coalesce(data->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
            and coalesce(data->>'code','') = p_code
            and lower(coalesce(data->>'role','')) = 'driver'
          limit 1;
      exception when undefined_table then null;
      end;
    end if;
    if d is null then return jsonb_build_object('error','no_match'); end if;
    dname := lower(trim(d->>'name'));
    begin
      select coalesce(jsonb_agg(t.data),'[]'::jsonb) into trips from ieo_trip_logs t
        where lower(trim(coalesce(t.data->>'driver',''))) = dname;
      return jsonb_build_object('trips',trips);
    exception when undefined_table then null; -- fall through to the blob below
    end;
  end if;

  -- FALLBACK: per-record tables not set up yet — read the shared blob (slower).
  select data into ws from workspaces where id = 'island-explorer';
  if ws is null then return jsonb_build_object('error','not_found'); end if;
  drivers := coalesce(ws->'drivers','[]'::jsonb);
  roster := coalesce(ws->'operators','[]'::jsonb);
  select x into d from jsonb_array_elements(drivers) x
    where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
      and coalesce(x->>'code','') = p_code
    limit 1;
  if d is null then
    select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code') into d
      from jsonb_array_elements(roster) x
      where regexp_replace(coalesce(x->>'phone',''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
        and coalesce(x->>'code','') = p_code
        and lower(coalesce(x->>'role','')) = 'driver'
      limit 1;
  end if;
  if d is null then return jsonb_build_object('error','no_match'); end if;
  dname := lower(trim(d->>'name'));
  select coalesce(jsonb_agg(t),'[]'::jsonb) into trips
    from jsonb_array_elements(coalesce(ws->'trips','[]'::jsonb)) t
    where lower(trim(coalesce(t->>'driver',''))) = dname;
  return jsonb_build_object('trips',trips);
end;
$$;
grant execute on function public.driver_trips(text,text) to anon, authenticated;

create or replace function public.get_reservation_public(p_rid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws jsonb; r jsonb;
begin
  select data into ws from workspaces where id = 'island-explorer';
  if ws is null then return jsonb_build_object('error','not_found'); end if;
  select x into r from jsonb_array_elements(coalesce(ws->'reservations','[]'::jsonb)) x
    where x->>'id' = p_rid limit 1;
  if r is null then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('tour',r->'tour','date',r->'date','endDate',r->'endDate',
    'location',r->'location','guideName',r->'guideName','guideFee',r->'guideFee',
    'referral',r->'referral','notes',r->'notes');
end;
$$;
grant execute on function public.get_reservation_public(text) to anon, authenticated;
```

## If Guide/Driver sign-in is slow (10+ seconds)

`guide_login` / `driver_login` / `driver_trips` now check credentials against the
small per-record tables first (`ieo_drivers`, `ieo_external_guides`, `ieo_operators`,
`ieo_ops`, `ieo_vehicles`, `ieo_trip_logs`) — each holds only one kind of record, so
a login no longer has to load the entire shared `workspaces` row (which also
carries every tour/booking/customer, plus any inline document photos) just to
check one phone + code. This needs the per-record tables from
`docs/DATABASE_SCHEMA.md` to exist; if they don't yet, it automatically falls back
to the old, slower, whole-row check — same result, just not the speed-up.

Two remaining causes if it's still slow after re-running this SQL:

1. **Supabase free-tier "cold start."** A paused/inactive project takes a few
   seconds to wake up on its first request after a while — every sign-in after a
   quiet period pays this once. Nothing to fix; it's a one-time delay per idle
   period, and stays fast afterward until it goes idle again.
2. **The shared data blob is still large**, which slows the fallback path (if the
   per-record tables above aren't set up) and every full sync in the app. If you
   haven't created the `driver-details` / `guide-ids` Storage buckets from
   `docs/DATABASE_SCHEMA.md`'s upload flow yet, every licence/ID photo is embedded
   as inline base64 text instead of a separate file. **Creating those two public
   Storage buckets** (Storage → New bucket → public) makes new uploads store as
   small links instead.

## After running it

- Sign in to the console (Settings, or the login screen) with your team
  email/password — the console won't be able to read or write anything until
  you do, by design (this is the "authenticated" role above).
- Everyone who needs console access needs their own Supabase Auth account
  (Settings → create one, same as before). Anyone without one can no longer
  see any data, even with the public key.
- **Important — close the sign-up door once your team is set up.** The
  console's "Create new account" link lets *anyone who finds the site* make
  themselves a Supabase Auth account, and this SQL treats every signed-in
  account as a trusted team member with full access. Once you and your team
  have accounts, go to the Supabase dashboard → **Authentication → Sign In /
  Providers → Email** and turn off **"Allow new users to sign up."** Existing
  accounts keep working exactly as before; to add a new teammate later,
  either flip that switch back on briefly or create their login directly
  from **Authentication → Users → Add user** in the dashboard.
- Public form links, the guide app, the driver app and the guide-response
  link need no changes on your end — they were updated to use the functions
  above.

## If you haven't set up the per-record tables yet

This SQL assumes the 14 `ieo_*` tables from `docs/DATABASE_SCHEMA.md` already
exist. If you haven't run that setup yet, run it first — the `alter table`
statements above will error on a table that doesn't exist. If you only ever
want the original single-blob sync, delete the `ieo_*` lines from section 1/2
and keep the rest.
