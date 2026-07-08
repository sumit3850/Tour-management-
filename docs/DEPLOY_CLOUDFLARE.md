# Deploying the shared console on Cloudflare Pages

Cloudflare Pages hosts the one shared deployment and lets you attach **many
client domains to it** — which is what makes the multi-tenant setup real. The
app resolves which client to show from the domain (see `config.js` /
`ONBOARDING.md`).

The app is fully static (no build step), so this is quick.

## One-time: create the Pages project

1. Push this repo to GitHub (already done) or GitLab.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick this repository. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`  (repo root — matches `wrangler.toml`)
4. **Save and Deploy.** You get a `*.pages.dev` URL. Confirm the console loads
   there (it will resolve to the default tenant).

From now on, every push to `main` auto-deploys. `_headers` keeps the HTML,
`config.js` and `sw.js` always-fresh, so a code/branding/tenant change reaches
clients on their next online load; `assets/*` are cached.

## Per client: attach their domain

For each operator (after adding their tenant block to `config.js` and running
`supabase/setup/provision.sh`):

1. Pages project → **Custom domains → Set up a domain**.
2. Enter their domain or a subdomain — e.g. `app.theircompany.in`
   (or a subdomain of your own: `theircompany.ops.yourbrand.app`).
3. Add the **CNAME** Cloudflare shows to that domain's DNS (if the domain is
   already on Cloudflare, it's one click).
4. Make sure that hostname is listed in the client's `match: [...]` in
   `config.js`. Opening the app on that domain now loads *their* backend and
   branding automatically.

Repeat per client — all on the **same** Pages project. One deployment, many
domains, one codebase to maintain.

> Tip: verify a client before DNS is live with the override
> `your-project.pages.dev/?t=their-key`.

## How updates reach everyone

- **Code/design/feature change** → push to `main` → Pages redeploys → every
  client gets it on their next online load (HTML is network-first in the service
  worker and `no-cache` at the edge).
- **Add/edit a client** (`config.js`) → same: `config.js` is network-first + it
  is `no-cache`, so tenant/branding/key changes propagate immediately online.
- **Offline field apps** keep working on the last cached copy until they're
  online again.

## Optional: deploy from the CLI

```bash
npx wrangler pages deploy . --project-name island-explorer-ops
```

Useful for a manual/preview deploy without going through Git.

## Alternative: deploy via GitHub Actions (`.github/workflows/deploy.yml`)

Instead of Cloudflare's built-in Git integration you can let GitHub Actions push
each deploy — you get build logs and a **preview URL commented on every PR**.
Use **one or the other, not both** (or you'll deploy twice — disconnect the
dashboard Git integration if you switch to the Action).

Set-up:
1. Create the Pages project once (dashboard **Direct Upload**, or
   `npx wrangler pages project create island-explorer-ops`).
2. Add two repo secrets under **Settings → Secrets and variables → Actions**:
   - `CLOUDFLARE_API_TOKEN` — a token with the **Cloudflare Pages: Edit** permission
     (My Profile → API Tokens → Create Token).
   - `CLOUDFLARE_ACCOUNT_ID` — from the Pages/Workers page right sidebar.
3. Push to `main` → the workflow runs `wrangler pages deploy` (project name and
   output dir come from `wrangler.toml`) → production. Open a PR → it deploys a
   **preview** with its own URL, posted back on the PR.

The workflow deploys `--branch=main` as production and any other branch as a
preview, so `?t=<tenant>` previews of a client are easy to share before their
DNS is live.

## Note on GitHub Pages

GitHub Pages allows only one custom domain per repo, so it can't host multiple
client domains. You can keep GitHub Pages for your own `sumit3850.github.io`
site and use Cloudflare Pages for the multi-client deployment — or move fully to
Cloudflare. Both serve the same files; nothing in the app depends on which host.
