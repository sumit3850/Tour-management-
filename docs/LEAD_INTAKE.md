# Lead intake — auto-capture leads from Email & WhatsApp

Turn inbound inquiries (email from any provider, WhatsApp Business messages) into
leads in your **Leads Pipeline** automatically. Each company is scoped by a private
token that can only ever *create* a lead — it never grants read access to any data.

```
Any email provider ─┐                            per-workspace token (?t=)
Business WhatsApp  ─┼─►  lead-intake Edge Fn  ──► resolve token → workspace
Personal (forward) ─┘        (server-side)    ──► extract (Claude, else regex)
                                              ──► insert `sub_` "interest" row
                                                        │  tagged data.workspace
                                                        ▼
                                           Console auto-converts → Leads Pipeline
```

Everything lands as an ordinary submission in your inbox and is auto-converted to a
lead (stage **New**) with a **source badge** (Email / WhatsApp), de-duplicated
against existing customers/leads. The existing inbox RLS keeps each tenant's leads
private.

---

## What you deploy (once)

| Piece | Where | Purpose |
|---|---|---|
| `supabase/saas/lead-intake.sql` | Supabase SQL Editor | per-workspace token table + owner RPCs |
| `supabase/functions/lead-intake` | Supabase Edge Functions | verify token/signature, extract, write lead |
| `cloudflare/lead-email-worker.js` | Cloudflare Email Worker | relay forwarded emails → the function |
| Meta WhatsApp Cloud API app | Meta for Developers | (optional) Business WhatsApp → the function |

---

## 1. Database — run the SQL

Supabase → **SQL Editor** → paste **`supabase/saas/lead-intake.sql`** → Run. Idempotent.
This creates `lead_sources` (one unguessable token per workspace) and the owner RPCs
(`my_lead_source`, `rotate_lead_source_token`, `set_lead_source`) plus the service-role
`resolve_lead_source`. The table is **not** client-readable — owners only ever see
their own token via the RPCs.

## 2. Edge Function — deploy

```bash
supabase functions deploy lead-intake --no-verify-jwt
# Optional: AI extraction (richer leads). Without it, a regex fallback is used.
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set
them. The function URL is:

```
https://<project-ref>.supabase.co/functions/v1/lead-intake
```

> The **service-role key stays inside the function**, never in the browser. The
> extraction prompt runs server-side; the AI call never sees your Supabase keys.

## 3. Email — Cloudflare Email Worker (works for Gmail, Outlook, private domains)

1. In Cloudflare, add a domain you'll use for ingest, e.g. `ingest.yourdomain.com`,
   and enable **Email Routing**.
2. **Workers → Create** → paste `cloudflare/lead-email-worker.js`. Add a Worker
   **variable** `FUNCTION_URL` = your function URL (from step 2).
3. Email Routing → **catch-all** → *Send to Worker* → this worker.
4. In the console: **Settings → Lead capture** → set **email-ingest domain** to
   `ingest.yourdomain.com`. It shows your address: `leads-<token>@ingest.yourdomain.com`.
5. Each company adds **one forwarding rule** in their own mailbox (Gmail: Settings →
   Forwarding; Outlook: Rules) sending inquiries to that address. **No passwords, no
   inbox access** — revoke anytime by rotating the token or deleting the rule.

> Why forwarding, not IMAP/OAuth: forwarding needs zero credentials and works for
> every provider. It's the "all users, any mail" path.

## 4. WhatsApp

### Business (fully automated — recommended)
1. Create a **Meta for Developers** app → add **WhatsApp** → get a Business number
   (free Cloud API tier).
2. **Configuration → Webhook**:
   - Callback URL = **WhatsApp webhook URL** from the console's Lead-capture card
     (`…/lead-intake?channel=whatsapp&t=<token>`).
   - Verify token = the **Verify token** shown in that card.
   - Subscribe to the **messages** field.
3. (Recommended) In the console card, save your Meta **App Secret** so the function
   verifies every webhook's `X-Hub-Signature-256` HMAC.

### Personal WhatsApp
There is **no official API** to read a personal account, and unofficial libraries
violate WhatsApp's terms and risk a number ban — so this pipeline won't do that.
Compliant options:
- **Forward to email**: long-press a chat → **Forward → email** → send it to your
  `leads-<token>@…` address. Manual, zero-risk, works today.
- **Upgrade to the free WhatsApp Business app** + Cloud API → then it's automated.

## 5. Use it

Leads arrive in **Leads Pipeline → New** with an **Email/WhatsApp source badge and
the sender's address/number shown on the card**, de-duplicated. Manage the addresses
in **Settings → Lead capture** (copy, Pause/Resume, Rotate token).

**Capture filter (Leads tab → "Email & WhatsApp sources"):** choose **From anyone**
(default) or **Only listed contacts** and paste the exact emails / WhatsApp numbers to
accept. In "list" mode the Edge Function drops any message whose sender isn't on the
list, so leads are only created from the contacts you trust.

---

## Security notes

- **Token = create-only.** A token maps an ingest request to exactly one workspace
  and can only insert a lead. It cannot read tours, bookings, customers or any other
  tenant's data. Same blast radius as your public register link.
- **Tenant isolation** is enforced by the same RLS that protects the rest of your
  data: a `sub_` row is readable only by approved members of the workspace named in
  `data.workspace`. The function stamps the resolved workspace; it never trusts the
  caller for tenancy.
- **Signature verification** for WhatsApp (Meta HMAC) when you store the app secret.
- **Service role** never leaves the Edge Function. The browser only ever calls the
  owner-scoped RPCs (which return just *your* token).
- **Spam gate**: newsletters/receipts/OTPs/auto-replies are dropped (`is_lead:false`)
  before anything is written.
- **Revocation**: rotate the token (card button) or disable the source — the old
  address and webhook stop working immediately.
- **PII**: only the parsed lead fields + a short message excerpt are stored; card
  numbers / OTPs are redacted by the extractor.
