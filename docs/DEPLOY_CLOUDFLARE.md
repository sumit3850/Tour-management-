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

## Note on GitHub Pages

GitHub Pages allows only one custom domain per repo, so it can't host multiple
client domains. You can keep GitHub Pages for your own `sumit3850.github.io`
site and use Cloudflare Pages for the multi-client deployment — or move fully to
Cloudflare. Both serve the same files; nothing in the app depends on which host.
