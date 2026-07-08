# One-command backend provisioning

`provision.sh` builds the complete database setup for a client's own Supabase
project and (optionally) applies it — so standing up a new backend is one
command instead of hand-pasting SQL.

It assembles, in order:
1. the base `workspaces` blob table (`00_workspaces.sql`),
2. the 14 per-record `ieo_*` tables (from `docs/DATABASE_SCHEMA.md`),
3. the RLS lockdown + the four login RPCs (`guide_login`, `driver_login`,
   `driver_trips`, `get_reservation_public`) from `docs/SECURE_ACCESS.md`,

and **substitutes this client's workspace name** into the RPCs (they read the
workspace blob by id — the one detail that must change per client). The docs
remain the single source of truth; this script never re-authors the SQL.

## Use

```bash
# 1) Set the client's workspace + backend in config.js first (see ONBOARDING.md).

# 2a) Generate a ready-to-paste setup.sql (workspace read from config.js):
./supabase/setup/provision.sh
#     -> writes supabase/setup/build/setup.sql. Paste it into the Supabase
#        dashboard -> SQL Editor -> Run.

# 2b) Or apply it directly with a connection string (Supabase dashboard ->
#     Project Settings -> Database -> Connection string / URI):
SUPABASE_DB_URL='postgresql://postgres:PW@HOST:5432/postgres' \
  ./supabase/setup/provision.sh
```

Pass an explicit workspace name to override config.js:
`./supabase/setup/provision.sh their-company`

The script is **idempotent** (`create if not exists` / `create or replace`), so
re-running it is safe.

## After provisioning

Create your team's login(s) in **Supabase → Authentication → Users** (or via the
console's Create-account screen). The RLS lockdown means only signed-in team
users can read/write data; the public registration/response pages keep working
because anon is allowed to INSERT form submissions and to call the login RPCs.

`build/` holds the generated SQL and is git-ignored.
