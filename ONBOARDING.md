# Onboarding a new client (white-label checklist)

The whole platform — the console plus the driver, guide, registration and
response pages — reads its per-client settings from **one file: `config.js`**.
A new operator is stood up by editing that file, swapping the logo, giving them
their own backend, and deploying. Budget roughly half a day of setup, then data
entry.

---

## 1. Give them their own backend (data isolation)

Each client must have their **own Supabase project** so their bookings, guests
and payments never mix with another operator's.

1. Create a new Supabase project for the client.
2. Recreate the schema: the tables used by the app (`workspaces`, per-record
   tables, plus the `driver_login` / `guide_login` RPCs and the
   `import-rates` edge function under `supabase/functions/`). Keep a schema
   export so this is one step, not a hand-rebuild.
3. Apply the RLS lockdown described in `docs/SECURE_ACCESS.md` so only a
   signed-in team account can read/write.
4. Copy the project **URL** and the **publishable (anon) key**.

> The anon/publishable key is browser-safe and is meant to ship in `config.js`.
> **Never** put the Supabase `service_role` key in any of these files.

## 2. Point the app at their backend + brand — edit `config.js` only

```js
window.APP_CONFIG = {
  supabase: {
    url:       "https://THEIR-PROJECT.supabase.co",
    key:       "sb_publishable_THEIR_ANON_KEY",
    workspace: "their-company"
  },
  brand: {
    company:     "Their Company Pvt Ltd",
    short:       "Their Company",
    tagline:     "Ops Console",
    logo:        "assets/logo.png",
    contactPerson: "Owner Name",
    phone:       "+91 ...",
    phoneDigits: "91...",
    email:       "info@theircompany.in",
    web:         "www.theircompany.in",
    cin:         "THEIR-CIN",
    address:     "Their registered office address, one line"
  }
};
```

This one file drives: the login screen, sidebar, page titles, and the
**quotation letterhead** (logo, CIN, address, contact line), plus which
Supabase backend every page (console + all four satellite apps) talks to.

## 3. Swap the visual assets

- `assets/logo.png` (and `assets/logo.jpg` fallback) → their logo.
- `assets/icon-192.png`, `assets/icon-512.png`, `assets/icon.svg` → their app icons.
- PWA names in `manifest.json`, `driver-manifest.json`, `guide-manifest.json`.

## 4. Deploy under their name

Put the repo on their own hosting / GitHub Pages, ideally a custom domain
such as `app.theircompany.in`. Keep each client in their **own repo** so
branding and updates never collide.

## 5. Load their operation (in-app, no code)

1. Create their **operators** and hand out 4-digit login codes (Settings).
2. Enter their **tours** and — most importantly — their **Cost Sheet**
   (per-tour, per-pax, Indian/Foreign rates). Quotations and the cost
   calculator are only as accurate as this rate sheet.
3. Add **vehicles, drivers, guides and guide fees**.
4. Share the **driver / guide / registration links** so field staff
   self-register and install the offline apps.
5. Migrating from elsewhere? Import via **Settings → Backup / Restore** (JSON).

## 6. Handover

A 30-minute walkthrough: sign in, take a booking, generate a quotation, and
install the offline driver/guide apps.

---

## Sales demo sandbox

Open the console with **`?demo=1`** (e.g. `index.html?demo=1`) for a
self-contained demo: it loads realistic Andaman sample data, skips the login
and cloud entirely, and **never saves anything** — every reload starts fresh, so
a prospect can click around freely without touching any real installation. A
"LIVE DEMO" ribbon is shown at the bottom. Give prospects this link to try it
on their own phone after the call.
