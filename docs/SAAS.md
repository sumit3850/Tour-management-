# Self-serve SaaS (one shared console, per-company accounts)

One deployment, one Supabase project, one URL. Companies **sign up themselves**,
**you approve** them, and each then gets their **own branded console** with their
**own isolated data**. On return, they see their **own logo + company name** on
the sign-in page (email-first).

## The flow

1. A company opens **`signup.html`** and registers (name, company, CIN, contact,
   phone, email, password, website, address, logo upload, domain).
2. That creates a Supabase **auth user** + a **pending `orgs` row** (their profile
   + logo) + a membership link. They see "pending approval."
3. **You approve** them (below). Approval is the access gate.
4. They go to the console, type their **email** → their **logo + company name
   appear** → password → they're in **their own console**, with their branding on
   the letterhead and only **their** data.

## Build status

- **Stage 1 — registration + backend (this):** `signup.html` + `supabase/saas/schema.sql`.
  Ready to run and test.
- **Stage 2 — console wiring (next):** email-first branded login on the console,
  load each company's workspace + branding via `my_org()`, a "pending approval"
  screen, and the owner approval UI. Built after Stage 1 is verified live.

## Set up Stage 1 (~5 min, in the SaaS Supabase project)

1. **Run the schema.** SQL Editor → paste all of `supabase/saas/schema.sql` → Run.
   Creates `orgs`, `org_members`, the `brand_for_email` / `my_org` functions, the
   per-company `workspaces` isolation, and the `logos` storage bucket.
2. **Turn off email confirmation** (for the simple flow): Authentication →
   Providers → Email → **Confirm email = off**. (Approval is your real gate.)
3. **Point `signup.html` at the project.** The `SAAS` block near the bottom of
   `signup.html` (and `config.js`) is set to `tbxzxfjumlnciczizols.supabase.co`
   — the same project that already holds the Island Explorer data — change it
   only if you use a different SaaS project.
4. **Deploy** (push to main) and open `/signup.html`. Register a test company,
   attach a logo → you should see "pending approval."
5. **Confirm it landed:** Supabase → Table Editor → `orgs` shows the new row
   (status `pending`, `logo_url` filled); Storage → `logos` has the image.

## Approving a company (until the admin screen lands in Stage 2)

Supabase → SQL Editor:

```sql
-- see who's waiting
select company, email, phone, created_at from orgs where status = 'pending' order by created_at;

-- approve one
update orgs set status = 'approved' where email = 'them@company.com';

-- (reject instead)
update orgs set status = 'rejected' where email = 'them@company.com';
```

Once approved, the email-first login (Stage 2) will show their brand and let them
in.

## Notes

- **Isolation:** each company's whole dataset is one row in `workspaces`, keyed by
  their `workspace` id, with RLS tying it to that company's members — a company
  can only ever read/write its own row.
- **Logo/anon key:** the publishable/anon key in `signup.html` is browser-safe by
  design. Never put the service_role key in any page.
- **Relation to the current live console:** this SaaS path is separate from the
  existing multi-tenant `config.js` console. Island Explorer can be migrated in as
  the first approved org during Stage 2, or kept as-is — your call.
