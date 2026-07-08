-- Base blob-sync table. One row per workspace holds the entire dataset as a
-- JSON blob; public form submissions are also stored here as rows keyed
-- sub_<id>. Created permissive so the app works immediately; the block from
-- docs/SECURE_ACCESS.md (appended by provision.sh) then locks it down to your
-- signed-in team and re-opens only anon INSERT for public form submissions.
create table if not exists workspaces (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table workspaces disable row level security;
grant all on table workspaces to anon, authenticated;
