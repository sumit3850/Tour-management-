# Practice run: onboard a test client end-to-end (~20 min)

A hands-on walkthrough to do the **whole loop once yourself** with a free
Supabase project — so the first real client is muscle memory. Uses a pretend
operator, **"Coral Coast Expeditions"** (workspace `coral-coast`). `ONBOARDING.md`
is the reference; this is the tutorial.

You'll know the loop works when the console opens as Coral Coast, on Coral
Coast's own database, with no data of yours in sight.

---

## Step 1 — Create a free Supabase project (~3 min)

1. Go to <https://supabase.com> → sign in → **New project**.
2. Name it `coral-coast-practice`, pick a strong database password (save it),
   choose a region near you → **Create new project**. Wait ~2 min for it to spin up.
3. Left sidebar → **Project Settings → API**. Copy two values:
   - **Project URL** — `https://xxxxxxxx.supabase.co`
   - **Project API keys → `anon` / publishable** — `sb_publishable_…` or `eyJ…`

   > ✅ The anon key is safe to put in `config.js` (it's browser-side by design).
   > ❌ Never copy the **service_role** key anywhere client-side.

## Step 2 — Create the tables, security and login RPCs (~3 min)

Two ways — pick one:

**A. Paste the SQL (no tools needed).**
```bash
./supabase/setup/provision.sh coral-coast
```
Open `supabase/setup/build/setup.sql`, copy all of it, and in Supabase go to
**SQL Editor → New query → paste → Run**. You should see "Success. No rows returned".

**B. Apply directly.** Project Settings → Database → **Connection string (URI)**,
then:
```bash
SUPABASE_DB_URL='postgresql://postgres:YOUR_DB_PASSWORD@HOST:5432/postgres' \
  ./supabase/setup/provision.sh coral-coast
```

> ✅ Verify in Supabase **Table Editor**: you should see `workspaces` plus 14
> `ieo_*` tables. Under **Database → Functions**: `driver_login`, `guide_login`,
> `driver_trips`, `get_reservation_public`.

## Step 3 — Create a team login (~2 min)

1. Supabase → **Authentication → Users → Add user → Create new user**.
2. Give it your email + a password → create. (This is the account you'll sign
   into the console with. RLS means only signed-in users can see the data.)

## Step 4 — Add the tenant to `config.js` (~3 min)

Copy the EXAMPLE block in `config.js` into `TENANTS` and fill it in:

```js
,"coral-coast": {
  match: ["coralcoasttours.in"],          // real domain later; not needed to preview
  supabase: {
    url:       "https://xxxxxxxx.supabase.co",     // from Step 1
    key:       "sb_publishable_…",                  // from Step 1
    workspace: "coral-coast"                        // MUST equal Step 2's name
  },
  brand: {
    company: "Coral Coast Expeditions", short: "Coral Coast", tagline: "Ops Console",
    logo: "assets/logo.png", contactPerson: "Priya Nair",
    phone: "+91 90000 12345", phoneDigits: "919000012345",
    email: "hello@coralcoasttours.in", web: "www.coralcoasttours.in",
    cin: "TEST-CIN", address: "Marine Drive, Havelock Island, Andaman, India"
  }
}
```

Commit + push (or just run locally). No other file changes.

## Step 5 — Preview it (~2 min)

- **Locally:** serve the folder (`python3 -m http.server 8080`) and open
  `http://localhost:8080/index.html?t=coral-coast`.
- **Deployed:** `your-project.pages.dev/?t=coral-coast`.

> ✅ The sidebar reads **Coral Coast Expeditions**. Sign in with the Step-3
> account. Add a tour or a booking → refresh → it's still there. Open your own
> Island Explorer console → that tour is **not** there. That's the isolation
> working: separate database, separate brand, same app.
>
> Try `?t=coral-coast&demo=1` to see the sales demo under Coral Coast branding.

## Step 6 — (Optional) give them a real domain

Cloudflare Pages → your project → **Custom domains → Set up a domain** →
`app.coralcoasttours.in` → add the CNAME to DNS. Make sure that host is in the
tenant's `match: [...]`. Now `app.coralcoasttours.in` loads Coral Coast with no
`?t=` needed. Full detail in `DEPLOY_CLOUDFLARE.md`.

---

## Verification checklist

- [ ] Supabase project created; URL + anon key copied
- [ ] `setup.sql` run — 15 tables + 4 functions present
- [ ] A team user created in Authentication
- [ ] Tenant block added to `config.js` (workspace matches Step 2)
- [ ] `?t=coral-coast` shows the Coral Coast brand and signs in
- [ ] Data added there does **not** appear in your Island Explorer console
- [ ] (optional) custom domain resolves without `?t=`

## Cleanup after practice

Delete the `coral-coast-practice` Supabase project (Project Settings → General →
Delete project) and remove the `coral-coast` block from `config.js`. For a real
client you'd keep both.

---

**For a real client, the loop is identical** — just use their real Supabase
project, workspace name, brand and domain. Steps 1–3 are backend, 4 is one
config block, 5–6 are preview + domain.
