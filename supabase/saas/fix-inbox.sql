-- ============================================================================
-- FIX INBOX: "permission denied for table workspaces"
-- ----------------------------------------------------------------------------
-- The console reads form submissions from the `workspaces` table (rows keyed
-- sub_<id>). After the SaaS migration the row-level-security policy only let a
-- signed-in user read the ONE row that equals their workspace tag — so the
-- sub_ submission rows became unreadable and the Inbox shows
-- "permission denied for table workspaces".
--
-- This script adds the scoped policies that let a signed-in, APPROVED company
-- read / update / delete the submissions tagged to its own workspace. It is
-- safe to run more than once (every policy is dropped-then-created) and it does
-- NOT touch or delete any data — it only tags legacy untagged rows and sets
-- permissions.
--
-- HOW TO RUN:
--   1. Supabase dashboard  ->  your project  ->  SQL Editor  ->  New query
--   2. Paste this whole file  ->  Run
--   3. Reload the console Inbox — submissions appear.
-- ============================================================================

-- Tag any legacy untagged submission as island-explorer's, so the scoped
-- policies below apply cleanly (older cached app versions wrote no workspace).
update workspaces
   set data = jsonb_set(data, '{workspace}', to_jsonb('island-explorer'::text), true)
 where id like 'sub\_%' escape '\'
   and jsonb_typeof(data) = 'object'
   and (data ->> 'workspace') is null;

-- Read: a signed-in member of an approved org may read the submissions tagged
-- with their workspace (and the legacy 'ieo_submissions' archive).
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

-- Update: same scope (used when marking a submission processed / booked).
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

-- Delete: same scope (used when removing a submission from the Inbox).
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

-- A browser signed in to the console shares its auth session with the public
-- form page, so that form submits as 'authenticated' — mirror the anon insert
-- policy so those submissions still land.
drop policy if exists "signed-in users can submit forms" on workspaces;
create policy "signed-in users can submit forms" on workspaces
  for insert to authenticated
  with check (id like 'sub\_%' escape '\');
