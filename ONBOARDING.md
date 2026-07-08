# Onboarding a new client (multi-tenant / SaaS)

The platform runs as **one shared deployment** that serves many operators. The
app code is shared — so a fix or new feature you ship reaches **every** client at
once — while each client keeps their **own data** (a separate Supabase project)
and **own branding**. Which client a visitor sees is decided at load time from
the **domain** they open the app on.

Adding a client is: **one config block + one command + one DNS entry.** No new
repo, no separate copy of the app.

> **First time? Do the hands-on practice run:** `docs/FIRST_CLIENT_WALKTHROUGH.md`
> walks the whole loop end-to-end with a free throwaway Supabase project (~20 min).

---

## 1. Give them their own backend (data isolation)

Each client must have their **own Supabase project** so their data never mixes
with another operator's.

1. Create a new Supabase project for the client.
2. Provision the whole schema with one command (creates every table, the RLS
   lockdown, and the login RPCs bound to this client's workspace):

   ```bash
   # writes supabase/setup/build/setup.sql to paste into the SQL editor…
   ./supabase/setup/provision.sh their-workspace
   # …or apply directly (connection string: Supabase → Settings → Database):
   SUPABASE_DB_URL='postgresql://postgres:PW@HOST:5432/postgres' \
     ./supabase/setup/provision.sh their-workspace
   ```

   (Deploy the `import-rates` edge function under `supabase/functions/` too if
   they'll bulk-import a rate sheet.) See `supabase/setup/README.md`.
3. Create the team's login(s) in **Supabase → Authentication → Users**. Only
   signed-in team users can read/write; the public registration/response pages
   still work (anon may submit forms + call the login RPCs).
4. Copy the project **URL** and **publishable (anon) key** for the next step.

## 2. Add the client to `config.js`

Copy the EXAMPLE block in `config.js` into `TENANTS` and fill it in:

```js
"their-key": {
  match: ["theircompany.in"],            // the domain(s) they'll open the app on
  supabase: {
    url:       "https://THEIR-PROJECT.supabase.co",
    key:       "sb_publishable_THEIR_ANON_KEY",
    workspace: "their-workspace"          // must match provision.sh above
  },
  brand: {
    company: "Their Company Pvt Ltd", short: "Their Company", tagline: "Ops Console",
    logo: "assets/their-logo.png", contactPerson: "Owner Name",
    phone: "+91 ...", phoneDigits: "91...", email: "info@theircompany.in",
    web: "www.theircompany.in", cin: "THEIR-CIN", address: "Their registered office, one line"
  }
}
```

When someone opens the app on `theircompany.in` (or any subdomain of it), the
app automatically loads that client's backend + branding — including the
quotation letterhead (logo, CIN, address, contact line). Everything else in the
app is shared code.

Drop their logo into `assets/` and point `brand.logo` at it (e.g.
`assets/their-logo.png`) so clients don't overwrite each other's logo.

Test any client on any URL with `?t=their-key` (e.g. `index.html?t=their-key`).

## 3. Point their domain at the deployment (DNS)

The client opens the app on their own domain, which must serve this same
deployment:

- **Recommended host:** Cloudflare Pages — supports **many custom domains on one
  site**. Add each client's domain (or a subdomain like `app.theircompany.in`)
  as a custom domain on the one project and point their DNS (CNAME) at it.
  Full step-by-step in **`docs/DEPLOY_CLOUDFLARE.md`**. (Netlify / Vercel work
  the same way.)
- **Subdomain-only, simplest:** give every client a subdomain of one domain you
  own — `theircompany.ops.yourbrand.app` — via a wildcard DNS record.
- **GitHub Pages caveat:** GitHub Pages allows only **one** custom domain per
  repo, so it can't host many client domains directly. Keep it for your own
  site, or move the shared deployment to one of the hosts above for
  multi-client.
- **No-DNS fallback:** clients can always use `one-domain/?t=their-key` — works
  on any host, just not a vanity URL.

## 4. Load their operation (in-app, no code)

1. Create their **operators** and hand out 4-digit login codes (Settings).
2. Enter their **tours** and their **Cost Sheet** (per-tour, per-pax,
   Indian/Foreign rates) — quotations and the cost calculator depend on it.
3. Add **vehicles, drivers, guides and guide fees**.
4. Share the **driver / guide / registration links** so field staff self-register
   and install the offline apps.
5. Migrating from elsewhere? Import via **Settings → Backup / Restore** (JSON).

## 5. Handover

A 30-minute walkthrough: sign in, take a booking, generate a quotation, install
the offline driver/guide apps.

---

## What is shared vs isolated

| | Shared across all clients | Isolated per client |
|---|---|---|
| **App code** (screens, features, fixes) | ✅ one deployment — ship once, everyone gets it | |
| **Branding** (logo, name, letterhead) | | ✅ from their `config.js` tenant block |
| **Backend / data** (bookings, guests, rates) | | ✅ their own Supabase project |

Changing the **console** (structure, design, functions) updates every client at
once. Changing **data** never crosses between clients — different Supabase
projects entirely.

---

## Sales demo sandbox

Open the console with **`?demo=1`** for a self-contained demo: realistic sample
data, no login, no cloud, nothing saved (fresh every reload), with a "LIVE DEMO"
ribbon. It uses whichever tenant the domain resolves to, so a client's own site
can hand *their* prospects a `?demo=1` link with their branding. Combine with a
tenant override for previews: `?t=their-key&demo=1`.
