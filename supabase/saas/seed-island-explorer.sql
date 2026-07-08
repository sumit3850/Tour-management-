-- ============================================================================
-- Seed Island Explorer Birding Tours into the SaaS backend, pre-approved and
-- fully pre-filled — so no signup form is needed for your own company.
-- Run AFTER schema.sql, in the SaaS project's SQL editor. Idempotent.
--
-- How the login gets attached:
--   * If explorer3850@gmail.com already exists in Authentication, it is linked
--     as owner immediately (block 2 below).
--   * If not, simply create the account: either sign up at signup.html with
--     this email (the trigger claims this org — no duplicate is created), or
--     add the user in Supabase -> Authentication -> Users. Either way it lands
--     on THIS pre-approved org, branding already filled.
-- ============================================================================

-- 1) The pre-approved org with the full company profile.
insert into orgs (workspace, company, username, cin, contact_person, phone, email,
                  website, address, logo_url, status)
values (
  'island-explorer',
  'Island Explorer Birding Tours',
  'Sumit Kumar',
  'U79120AN2026PTC006196',
  'Sumit Kumar',
  '+91 99332 02175',
  'explorer3850@gmail.com',
  'www.islandexplorer.in',
  'Sri Ram Nagar, Attam Pahad, Garacharma, Opp. Shiv Mandir, Sri Vijaya Puram, South Andaman, Andaman and Nicobar Islands - 744105, India',
  'https://sumit3850.github.io/Tour-management-/assets/logo.png',
  'approved'
)
on conflict (workspace) do update set
  company = excluded.company, username = excluded.username, cin = excluded.cin,
  contact_person = excluded.contact_person, phone = excluded.phone,
  email = excluded.email, website = excluded.website, address = excluded.address,
  logo_url = excluded.logo_url, status = 'approved';

-- 2) If the login already exists in Authentication, attach it as owner now.
do $$
declare u uuid; o uuid;
begin
  select id into o from orgs where workspace = 'island-explorer';
  select id into u from auth.users where lower(email) = 'explorer3850@gmail.com' limit 1;
  if u is not null and o is not null then
    update orgs set owner_id = u where id = o;
    insert into org_members (org_id, user_id, role) values (o, u, 'owner')
      on conflict do nothing;
  end if;
end $$;

-- ============================================================================
-- 3) DATA — when running on tbxzxfjumlnciczizols (the original project), the
--    'island-explorer' row in workspaces already holds all the real data, so
--    there is nothing to migrate: signing in shows it immediately.
--
--    Only if seeding a DIFFERENT project, copy the data across:
--    a) source project:  select data from workspaces where id = 'island-explorer';
--    b) target project:
-- insert into workspaces (id, data, updated_at)
-- values ('island-explorer', $json$ PASTE_THE_JSON_HERE $json$::jsonb, now())
-- on conflict (id) do update set data = excluded.data, updated_at = now();
-- ============================================================================
