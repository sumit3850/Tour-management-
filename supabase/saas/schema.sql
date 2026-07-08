-- ============================================================================
-- SaaS backend — ONE Supabase project serving many companies (self-serve signup,
-- owner-approved, per-company data isolation, email-first branded login).
-- Run this ONCE in the SaaS project's SQL Editor. Idempotent (safe to re-run).
--
-- Auth note: for the simple flow, turn OFF email confirmation
--   Authentication -> Providers -> Email -> "Confirm email" = off
-- so a new signup is immediately signed in and can create its org row. Access is
-- gated by APPROVAL below, not by email confirmation.
-- ============================================================================

-- ---- Companies that sign up -------------------------------------------------
create table if not exists orgs (
  id             uuid primary key default gen_random_uuid(),
  workspace      text unique not null,          -- data-scoping id the console uses
  company        text not null,
  username       text,
  cin            text,
  contact_person text,
  phone          text,
  email          text not null,                 -- signup / owner email
  website        text,
  address        text,
  domain         text,
  logo_url       text,
  status         text not null default 'pending', -- pending | approved | rejected
  owner_id       uuid references auth.users(id) on delete set null,
  created_at     timestamptz default now()
);
create index if not exists orgs_email_idx on orgs (lower(email));

-- ---- Which auth users belong to which org -----------------------------------
create table if not exists org_members (
  org_id  uuid references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role    text default 'owner',
  primary key (org_id, user_id)
);

alter table orgs        enable row level security;
alter table org_members enable row level security;

-- A signed-in user may register their own company (always as pending) …
drop policy if exists "user creates own org" on orgs;
create policy "user creates own org" on orgs for insert to authenticated
  with check (owner_id = auth.uid() and status = 'pending');

-- … read their own org, and update its profile (but not its status).
drop policy if exists "members read own org" on orgs;
create policy "members read own org" on orgs for select to authenticated
  using (id in (select org_id from org_members where user_id = auth.uid()));

drop policy if exists "owner updates own profile" on orgs;
create policy "owner updates own profile" on orgs for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status = (select status from orgs o where o.id = orgs.id));

drop policy if exists "read own membership" on org_members;
create policy "read own membership" on org_members for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "create own membership" on org_members;
create policy "create own membership" on org_members for insert to authenticated
  with check (user_id = auth.uid());

-- ---- Auto-create the org when a user signs up -------------------------------
-- The signup page passes the company profile as user metadata; this trigger
-- creates the pending org + membership server-side at user-creation time. This
-- is race-free (no client insert, no session-timing dependency, no reliance on
-- email confirmation) — it always runs as the definer and bypasses RLS.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare md jsonb; ws text; oid uuid;
begin
  -- If an org was pre-created for this email (e.g. seeded/migrated by the owner)
  -- and has no owner yet, CLAIM it instead of creating a duplicate: link the new
  -- user as owner and keep the pre-filled company profile as-is.
  select id into oid from orgs where lower(email) = lower(new.email) and owner_id is null limit 1;
  if oid is not null then
    update orgs set owner_id = new.id where id = oid;
    insert into org_members (org_id, user_id, role) values (oid, new.id, 'owner')
      on conflict do nothing;
    return new;
  end if;

  md := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  if coalesce(md->>'company','') = '' then return new; end if;      -- non-company signups: ignore
  ws := trim(both '-' from regexp_replace(lower(md->>'company'), '[^a-z0-9]+', '-', 'g'));
  if ws = '' then ws := 'org'; end if;
  ws := left(ws, 40) || '-' || substr(md5(new.id::text), 1, 4);
  insert into orgs (workspace, company, username, cin, contact_person, phone, email,
                    website, address, domain, logo_url, status, owner_id)
    values (ws, md->>'company', md->>'username', md->>'cin', md->>'contact_person',
            md->>'phone', new.email, md->>'website', md->>'address', md->>'domain',
            md->>'logo_url', 'pending', new.id)
    returning id into oid;
  insert into org_members (org_id, user_id, role) values (oid, new.id, 'owner');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- Email-first login branding (safe pre-login lookup) ---------------------
-- Given a typed email, returns ONLY the public brand bits of that email's
-- APPROVED org — so the login page can show the company's logo + name before
-- the user enters a password. Pending/rejected orgs return null (no preview).
create or replace function public.brand_for_email(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orgs%rowtype;
begin
  select * into o from orgs
    where lower(email) = lower(trim(p_email)) and status = 'approved'
    limit 1;
  if o.id is null then return null; end if;
  return jsonb_build_object('company', o.company, 'logo', o.logo_url, 'tagline', 'Ops Console');
end; $$;
grant execute on function public.brand_for_email(text) to anon, authenticated;

-- After a successful sign-in the console calls this to load its own org context
-- (workspace to scope data + branding for the letterhead). Returns null if the
-- caller's org isn't approved yet (console then shows "pending approval").
create or replace function public.my_org()
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orgs%rowtype;
begin
  select og.* into o from orgs og
    join org_members m on m.org_id = og.id
    where m.user_id = auth.uid()
    order by og.created_at asc
    limit 1;
  if o.id is null then return null; end if;
  return jsonb_build_object(
    'workspace', o.workspace, 'status', o.status,
    'brand', jsonb_build_object(
      'company', o.company, 'short', o.company, 'tagline', 'Ops Console',
      'logo', o.logo_url, 'contactPerson', o.contact_person, 'phone', o.phone,
      'phoneDigits', regexp_replace(coalesce(o.phone,''),'\D','','g'),
      'email', o.email, 'web', o.website, 'cin', o.cin, 'address', o.address)
  );
end; $$;
grant execute on function public.my_org() to authenticated;

-- ---- Per-company data isolation --------------------------------------------
-- The console syncs its whole dataset as one JSON blob in `workspaces`, keyed by
-- the org's workspace id. RLS ties each row to that org's members, so a company
-- can only ever read/write its own row — full isolation in one database.
create table if not exists workspaces (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table workspaces enable row level security;

drop policy if exists "org members access their workspace" on workspaces;
create policy "org members access their workspace" on workspaces for all to authenticated
  using (id in (select o.workspace from orgs o join org_members m on m.org_id = o.id where m.user_id = auth.uid()))
  with check (id in (select o.workspace from orgs o join org_members m on m.org_id = o.id where m.user_id = auth.uid()));

-- Public form submissions (register/respond pages) may only INSERT a sub_ row.
grant insert on table workspaces to anon;
drop policy if exists "public can submit forms" on workspaces;
create policy "public can submit forms" on workspaces for insert to anon
  with check (id like 'sub\_%' escape '\');
grant select, insert, update, delete on table workspaces to authenticated;

-- ---- Logo storage -----------------------------------------------------------
insert into storage.buckets (id, name, public) values ('logos','logos', true)
  on conflict (id) do nothing;
drop policy if exists "logo upload" on storage.objects;
create policy "logo upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'logos');
drop policy if exists "logo public read" on storage.objects;
create policy "logo public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'logos');
