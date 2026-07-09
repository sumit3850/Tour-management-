-- ============================================================================
-- DATA RECOVERY + INBOX FIX — run on the SaaS project (tbxzxfjumlnciczizols).
--
-- Paste this WHOLE file into Supabase Studio > SQL Editor and Run it once.
-- It is idempotent (safe to re-run) and it never deletes real data:
--   0. Snapshots the entire `workspaces` table first (workspaces_rescue_snapshot,
--      locked so it is NOT readable through the public API).
--   1. Repairs the explorer3850@gmail.com <-> island-explorer org linkage
--      (owner, membership, approval; duplicate orgs are reported, not deleted).
--   2. If the island-explorer data blob is empty/near-empty, restores it from
--      the best surviving source: a legacy blob row that belongs to NO org
--      (e.g. 'default'), or the ieo_* per-record mirror tables (which the SaaS
--      migration locked but never deleted). It never copies another company's
--      workspace row.
--   3. Fixes the Inbox: submissions (`sub_%` rows) became invisible to EVERYONE
--      when the migration replaced the old "team full access" policy — the rows
--      are all still here. Adds read/update/delete/insert policies scoped per
--      company and tags the existing rows with their workspace.
--   4. Prints a full diagnostic report as the query result — read it.
--
-- BEFORE RUNNING, read docs/RECOVERY.md. Most important rule:
--   Do NOT sign in to the console on any device that might still hold an
--   offline copy of your data (an old phone/laptop, or the app served from the
--   other domain) until recovery is done — signing in clears that device's
--   local copy.
-- If the hourly Google-Sheet import (import-rates edge function) is scheduled,
-- pause it until you've confirmed the data is back.
-- ============================================================================

-- ---- Preconditions ----------------------------------------------------------
do $$
begin
  if to_regclass('public.workspaces') is null then
    raise exception 'Table "workspaces" not found — this does not look like the app''s Supabase project.';
  end if;
  if to_regclass('public.orgs') is null or to_regclass('public.org_members') is null then
    raise exception 'SaaS tables missing — run supabase/saas/schema.sql first, then re-run this file.';
  end if;
end $$;

-- ---- 0) Safety snapshot (kept from the FIRST run; re-runs never overwrite) ---
-- Locked immediately: without this, a table created here would be readable
-- through the project's public REST API with the anon key.
create table if not exists workspaces_rescue_snapshot as
  select now() as snapped_at, * from workspaces;
alter table workspaces_rescue_snapshot enable row level security;
revoke all on table workspaces_rescue_snapshot from anon, authenticated;

-- ---- Helpers + report table (session-local) ----------------------------------
drop table if exists _report;
create temp table _report(seq serial, section text, item text, detail text);

create or replace function pg_temp.jarr(j jsonb) returns int language sql immutable as
$f$ select case when jsonb_typeof(j) = 'array' then jsonb_array_length(j) else 0 end $f$;

-- Total record count inside a console data blob (the collections the app syncs).
create or replace function pg_temp.blob_count(d jsonb) returns int language sql immutable as
$f$ select pg_temp.jarr(d->'tours') + pg_temp.jarr(d->'bookings') + pg_temp.jarr(d->'customers')
  + pg_temp.jarr(d->'accommodations') + pg_temp.jarr(d->'accBookings') + pg_temp.jarr(d->'leads')
  + pg_temp.jarr(d->'vehicles') + pg_temp.jarr(d->'drivers') + pg_temp.jarr(d->'ops')
  + pg_temp.jarr(d->'externalGuides') + pg_temp.jarr(d->'reservations') + pg_temp.jarr(d->'operators')
  + pg_temp.jarr(d->'quotationLog') + pg_temp.jarr(d->'trips') + pg_temp.jarr(d->'posts') $f$;

-- ---- 1) Account <-> org linkage repair ---------------------------------------
do $$
declare
  u uuid; oid uuid; dup record; dupdata int;
begin
  -- The pre-approved Island Explorer org (same shape as seed-island-explorer.sql).
  insert into orgs (workspace, company, username, cin, contact_person, phone, email,
                    website, address, logo_url, status)
  values ('island-explorer', 'Island Explorer Birding Tours', 'Sumit Kumar',
          'U79120AN2026PTC006196', 'Sumit Kumar', '+91 99332 02175',
          'explorer3850@gmail.com', 'www.islandexplorer.in',
          'Sri Ram Nagar, Attam Pahad, Garacharma, Opp. Shiv Mandir, Sri Vijaya Puram, South Andaman, Andaman and Nicobar Islands - 744105, India',
          'https://sumit3850.github.io/Tour-management-/assets/logo.png', 'approved')
  on conflict (workspace) do update set status = 'approved', email = 'explorer3850@gmail.com';
  select id into oid from orgs where workspace = 'island-explorer';

  select id into u from auth.users where lower(email) = 'explorer3850@gmail.com' limit 1;
  if u is null then
    insert into _report(section, item, detail) values ('1 LINKAGE', 'auth user',
      'MISSING — no explorer3850@gmail.com in Authentication > Users. Create it (or sign up once at signup.html), then RE-RUN this file.');
  else
    update orgs set owner_id = u where id = oid;
    insert into org_members (org_id, user_id, role) values (oid, u, 'owner') on conflict do nothing;
    insert into _report(section, item, detail) values ('1 LINKAGE', 'auth user',
      'linked as owner+member of island-explorer (user ' || u || ')');

    -- my_org() picks the user's OLDEST org — make sure island-explorer wins.
    update orgs set created_at = least(
        created_at,
        (select coalesce(min(o2.created_at), now()) from orgs o2
           join org_members m2 on m2.org_id = o2.id
          where m2.user_id = u and o2.id <> oid) - interval '1 second')
      where id = oid;

    -- Duplicate orgs for the same email (test signups) are REPORTED, never
    -- deleted — the created_at nudge above already guarantees my_org() resolves
    -- island-explorer, and deleting an org here could destroy a real company
    -- registered later under the same email.
    for dup in select o.* from orgs o
                where lower(o.email) = 'explorer3850@gmail.com' and o.id <> oid loop
      select coalesce(pg_temp.blob_count(w.data), 0) into dupdata
        from workspaces w where w.id = dup.workspace;
      insert into _report(section, item, detail) values ('1 LINKAGE', 'duplicate org (left in place)',
        dup.workspace || ' (status ' || dup.status || ', ' || coalesce(dupdata, 0) ||
        ' records in its workspace row) — harmless for sign-in; delete manually only if you are sure it''s a test leftover.');
    end loop;
  end if;
end $$;

-- ---- 2) Restore the island-explorer data blob if it is empty ------------------
do $$
declare
  cur jsonb; curn int := 0;
  alt record; altn int := 0;
  ieo_total int := 0; n int; j jsonb;
  rebuilt jsonb; applied text := '';
  i int;
  -- blob key -> per-record mirror table (exactly the app's recTable() mapping)
  map text[][] := array[
    ['tours','ieo_tours'], ['bookings','ieo_bookings'], ['customers','ieo_customers'],
    ['accommodations','ieo_accommodations'], ['accBookings','ieo_acc_bookings'],
    ['leads','ieo_leads'], ['vehicles','ieo_vehicles'], ['drivers','ieo_drivers'],
    ['ops','ieo_ops'], ['externalGuides','ieo_external_guides'],
    ['reservations','ieo_reservations'], ['operators','ieo_operators'],
    ['quotationLog','ieo_quotation_log'], ['trips','ieo_trip_logs']];
begin
  select data into cur from workspaces where id = 'island-explorer';
  curn := coalesce(pg_temp.blob_count(cur), 0);
  insert into _report(section, item, detail) values ('2 RESTORE', 'island-explorer blob (before)',
    case when cur is null then 'row missing' else curn || ' records' end);

  -- Best alternative LEGACY blob row: a drifted id like 'default' or an old test
  -- slug. A row registered to ANY org is another company's live data and must
  -- never be considered — copying it here would leak that tenant's dataset.
  select w.id as id, coalesce(pg_temp.blob_count(w.data), 0) as n into alt
    from workspaces w
   where w.id not like 'sub\_%' escape '\'
     and w.id not in ('island-explorer', 'ieo_submissions')
     and not exists (select 1 from orgs o where o.workspace = w.id)
   order by 2 desc limit 1;
  altn := coalesce(alt.n, 0);
  if alt.id is not null then
    insert into _report(section, item, detail) values ('2 RESTORE', 'best unowned legacy blob row',
      alt.id || ' (' || altn || ' records)');
  end if;

  -- How much survives in the ieo_* per-record mirror?
  for i in 1..array_length(map, 1) loop
    if to_regclass('public.' || map[i][2]) is not null then
      execute format('select count(*) from %I', map[i][2]) into n;
      ieo_total := ieo_total + n;
    end if;
  end loop;
  insert into _report(section, item, detail) values ('2 RESTORE', 'ieo_* mirror total',
    ieo_total || ' records' || case when ieo_total = 0 then ' (tables missing or empty)' else '' end);

  if curn >= 20 then
    insert into _report(section, item, detail) values ('2 RESTORE', 'action',
      'NONE — island-explorer blob looks healthy. The console just needed the linkage/policy fixes.');
  elsif altn > greatest(curn, 4) and altn >= ieo_total then
    update workspaces set data = (select w2.data from workspaces w2 where w2.id = alt.id),
                          updated_at = now()
      where id = 'island-explorer';
    if not found then
      insert into workspaces (id, data, updated_at)
        select 'island-explorer', w2.data, now() from workspaces w2 where w2.id = alt.id;
    end if;
    insert into _report(section, item, detail) values ('2 RESTORE', 'action',
      'RESTORED island-explorer from legacy blob row "' || alt.id || '" (' || altn ||
      ' records). The source row was left untouched; the pre-restore blob is preserved in workspaces_rescue_snapshot.');
  elsif ieo_total > greatest(curn, 4) then
    rebuilt := coalesce(cur, '{}'::jsonb);
    for i in 1..array_length(map, 1) loop
      if to_regclass('public.' || map[i][2]) is not null then
        execute format('select coalesce(jsonb_agg(data order by updated_at), ''[]''::jsonb) from %I', map[i][2]) into j;
        if pg_temp.jarr(j) > 0 then
          rebuilt := rebuilt || jsonb_build_object(map[i][1], j);
          applied := applied || map[i][1] || '(' || pg_temp.jarr(j) || ') ';
        end if;
      end if;
    end loop;
    insert into workspaces (id, data, updated_at) values ('island-explorer', rebuilt, now())
      on conflict (id) do update set data = excluded.data, updated_at = now();
    insert into _report(section, item, detail) values ('2 RESTORE', 'action',
      'REBUILT island-explorer from the ieo_* mirror tables: ' || applied ||
      '— the pre-restore blob is preserved in workspaces_rescue_snapshot. Note: quotation counter, tour costs, posts and sheet settings are not mirrored per-record; restore those from a backup file if they matter.');
  else
    insert into _report(section, item, detail) values ('2 RESTORE', 'action',
      case when curn > 0 then
        'NONE — kept the existing island-explorer blob (' || curn || ' records); no richer server-side source exists. If records are missing, use: '
      else
        'NO SERVER-SIDE SOURCE FOUND. Next options, in order: ' end ||
      '(a) Supabase Dashboard > Database > Backups — restore/inspect a backup from before 2026-07-08 14:00 IST and copy the island-explorer row back; (b) a device that has NOT signed in since then still has the data locally — see docs/RECOVERY.md "Rescue from a device"; (c) an island-explorer-backup-*.json export file.');
  end if;
end $$;

-- ---- 3) Inbox: make submissions readable again, scoped per company ------------
-- Tag every existing untagged submission as island-explorer's (the only company
-- that existed before the migration), so the scoped policies below apply cleanly.
update workspaces
   set data = jsonb_set(data, '{workspace}', to_jsonb('island-explorer'::text), true)
 where id like 'sub\_%' escape '\'
   and jsonb_typeof(data) = 'object'
   and (data ->> 'workspace') is null;

-- A signed-in member of an APPROVED org may read/manage the submissions tagged
-- with their org's workspace. Untagged rows (written by an old cached app
-- version) and the legacy 'ieo_submissions' archive default to island-explorer.
drop policy if exists "org members read submissions" on workspaces;
create policy "org members read submissions" on workspaces
  for select to authenticated
  using (
    (id like 'sub\_%' escape '\' or id = 'ieo_submissions')
    and coalesce(data ->> 'workspace', 'island-explorer') in (
      select o.workspace from orgs o
        join org_members m on m.org_id = o.id
       where m.user_id = auth.uid() and o.status = 'approved')
  );

drop policy if exists "org members update submissions" on workspaces;
create policy "org members update submissions" on workspaces
  for update to authenticated
  using (
    (id like 'sub\_%' escape '\' or id = 'ieo_submissions')
    and coalesce(data ->> 'workspace', 'island-explorer') in (
      select o.workspace from orgs o
        join org_members m on m.org_id = o.id
       where m.user_id = auth.uid() and o.status = 'approved')
  )
  with check (
    (id like 'sub\_%' escape '\' or id = 'ieo_submissions')
    and coalesce(data ->> 'workspace', 'island-explorer') in (
      select o.workspace from orgs o
        join org_members m on m.org_id = o.id
       where m.user_id = auth.uid() and o.status = 'approved')
  );

drop policy if exists "org members delete submissions" on workspaces;
create policy "org members delete submissions" on workspaces
  for delete to authenticated
  using (
    id like 'sub\_%' escape '\'
    and coalesce(data ->> 'workspace', 'island-explorer') in (
      select o.workspace from orgs o
        join org_members m on m.org_id = o.id
       where m.user_id = auth.uid() and o.status = 'approved')
  );

-- The public form pages create their own client, but a browser that is ALSO
-- signed in to the console shares the auth session — the form then submits as
-- 'authenticated', which the anon-only insert policy doesn't cover. Mirror it.
drop policy if exists "signed-in users can submit forms" on workspaces;
create policy "signed-in users can submit forms" on workspaces
  for insert to authenticated
  with check (id like 'sub\_%' escape '\');

-- ---- 4) Diagnostic report ------------------------------------------------------
insert into _report(section, item, detail)
select '4 ORGS', o.workspace,
       'status=' || o.status || ', email=' || o.email ||
       ', owner=' || coalesce(o.owner_id::text, 'NONE') || ', created=' || o.created_at
  from orgs o order by o.created_at;

insert into _report(section, item, detail)
select '5 MEMBERSHIP', o.workspace, 'user ' || m.user_id || ' role ' || m.role
  from org_members m join orgs o on o.id = m.org_id;

insert into _report(section, item, detail)
select '6 MY_ORG', 'resolves to',
       coalesce((select o.workspace from orgs o
                   join org_members m on m.org_id = o.id
                  where m.user_id = u.id
                  order by o.created_at asc limit 1), 'NOTHING — pending screen')
  from auth.users u where lower(u.email) = 'explorer3850@gmail.com';

insert into _report(section, item, detail)
select '7 BLOBS', w.id,
       coalesce(pg_temp.blob_count(w.data), 0) || ' records (tours ' || pg_temp.jarr(w.data->'tours')
       || ', bookings ' || pg_temp.jarr(w.data->'bookings') || ', customers ' || pg_temp.jarr(w.data->'customers')
       || '), updated ' || w.updated_at
  from workspaces w
 where w.id not like 'sub\_%' escape '\' and w.id <> 'ieo_submissions'
 order by w.id;

insert into _report(section, item, detail)
select '8 INBOX', 'sub_ rows',
       count(*) || ' submissions, ' || coalesce(min(updated_at)::text, '-') || ' .. ' || coalesce(max(updated_at)::text, '-')
  from workspaces where id like 'sub\_%' escape '\';

do $$
declare t text; n int;
begin
  foreach t in array array['ieo_tours','ieo_bookings','ieo_customers','ieo_accommodations',
    'ieo_acc_bookings','ieo_leads','ieo_vehicles','ieo_drivers','ieo_ops','ieo_external_guides',
    'ieo_reservations','ieo_operators','ieo_quotation_log','ieo_trip_logs'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from %I', t) into n;
      insert into _report(section, item, detail) values ('9 IEO MIRROR', t, n || ' rows');
    end if;
  end loop;
end $$;

select section, item, detail from _report order by seq;
