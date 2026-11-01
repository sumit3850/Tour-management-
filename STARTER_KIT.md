# Ops Console — starter kit

A portable copy of the console's core so it can be stood up for another
company or project: the **front end** (static pages, no build step), the
**database** (Supabase SQL, run once in order) and the **backend** (Supabase
edge functions, the Cloudflare email worker and the n8n lead flows).

Build it with:

```bash
python3 tools/make-starter-kit.py            # → build/ops-console-starter-kit.zip
```

The zip keeps the repository layout, so unzipping it into an empty folder
gives a deployable project. Brand data (logo, company name, CIN, phone,
Supabase project) is **not** baked in: everything is read from `config.js`
and from the company's org record after sign-in.

---

## What is inside

| Folder / file | Layer | Purpose |
|---|---|---|
| `index.html`, `sw.js`, `manifest.json` | Front end | The console itself (single file) and its service worker / PWA manifest |
| `ops-guide.html`, `guide-manifest.json` | Front end | Guide app (operations, dates, payments) |
| `driver-app.html`, `drive-app.html`, `driver-manifest.json` | Front end | Driver app and trip log |
| `register.html`, `feedback.html`, `respond.html`, `signup.html`, `admin.html` | Front end | Public forms: tour / session registration, feedback, guide reservation reply, company sign-up, approval screen |
| `departures.html`, `calendar.html` | Front end | Public departures board and the shareable read-only calendar |
| `config.js` | Front end | **Edit first.** Supabase URL + publishable key, default brand |
| `assets/` | Front end | Icons and a placeholder logo — replace `logo.png` / `logo.jpg` |
| `_headers`, `_redirects`, `wrangler.toml`, `.github/workflows/` | Front end | Static hosting on Cloudflare Pages or GitHub Pages; CI test |
| `tests/`, `package.json` | Front end | `npm test` runs the money-math regression tests |
| `supabase/setup/` | Database | `provision.sh` builds one `setup.sql` for a new project (tables, RLS, login RPCs) |
| `supabase/saas/schema.sql` | Database | Multi-company model: orgs, members, approval, `my_org()` |
| `supabase/saas/*.sql` (others) | Database | Feature RPCs, each run once: inbox fix, form tour sync, guide/driver login, lead intake tokens, public departures, public calendar, recovery |
| `supabase/functions/notify` | Backend | WhatsApp / SMS / email gateway (edge function) |
| `supabase/functions/lead-intake` | Backend | Inbound email / WhatsApp → lead in the inbox |
| `supabase/functions/import-rates` | Backend | Rate-sheet import from a published Google Sheet CSV |
| `cloudflare/lead-email-worker.js` | Backend | Email Routing worker that forwards mail to `lead-intake` |
| `n8n/*.json` | Backend | Ready-made n8n flows: email, WhatsApp and Facebook/Instagram → leads |
| `docs/` | All | Schema, secure access, deploy, messaging, lead intake, recovery, sheet sync, first-client walkthrough |

Not included: the Island Explorer seed data, marketing videos, the custom
domain file (`CNAME`) and the live `config.js` values.

---

## New project in nine steps

1. **Supabase project.** Create one at supabase.com. Copy the project URL and
   the publishable (anon) key.
2. **config.js.** Put the URL and key in `supabase.url` / `supabase.key`. Set
   `brand.company`, `brand.short`, `brand.logo` and the contact fields. Never
   put a service-role key here.
3. **Database, step one.** In the SQL editor run `supabase/saas/schema.sql`
   (companies, members, approval, `my_org`).
4. **Database, step two.** Run `supabase/setup/provision.sh` (or paste the
   generated `supabase/setup/build/setup.sql`) for the workspace tables, RLS
   lockdown and login RPCs.
5. **Database, step three.** Run, once each: `fix-inbox.sql`,
   `form-tour-sync.sql`, `guide-ops-fix.sql`, `lead-intake.sql`,
   `public-departures.sql`, `public-calendar.sql`. All are idempotent.
6. **Edge functions.** `supabase functions deploy notify lead-intake import-rates`.
   Secrets (Project Settings → Edge Functions): `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKSPACE_ID`,
   `SHEET_CSV_URL` (import-rates), `ANTHROPIC_API_KEY` (lead-intake parsing),
   plus the provider keys listed in `docs/MESSAGING.md` for `notify`.
7. **Hosting.** Any static host. Cloudflare Pages: `.github/workflows/deploy.yml`
   with the two secrets it names, or connect the repo in the dashboard.
   GitHub Pages: serve the repository root. Both need no build step.
8. **First company.** Open `signup.html`, register, then approve the company
   in `admin.html` (or set `status = 'approved'` on the org row). Sign in to
   the console, upload the logo and letterhead details under Settings →
   Brand, and the payment / GST details under Tour costing → Billing &
   instructions.
9. **Optional.** Email Routing worker (`cloudflare/lead-email-worker.js`,
   `docs/LEAD_INTAKE.md`), n8n flows (`docs/N8N_LEADS.md`), Google Sheet sync
   (`docs/SHEET_SYNC.md`).

---

## Where the brand lives

| Shown as | Comes from |
|---|---|
| Sign-in page name and logo | `config.js` → `brand` (before login), the org record after |
| Letterhead on quotations / invoices | Settings → Brand (company, CIN, address, phone, logo) |
| GSTIN, platform fee, bank accounts, UPI QR | Tour costing → Billing & instructions (synced per workspace) |
| Public form links | Carry the workspace slug, so each company's submissions land in its own inbox |

Each company's data is one JSON workspace blob plus per-record tables, all
protected by row-level security. Nothing in the kit is shared between
companies except the code.
