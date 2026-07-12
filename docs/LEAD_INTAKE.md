# Lead intake — one agent, four channels (Email · WhatsApp · Facebook · Instagram)

Turn inbound inquiries into **Leads Pipeline** cards automatically, from four
sources at once:

- **Email** (any provider — Gmail, Outlook, Zoho, private domain, IMAP or forward)
- **WhatsApp** (Business Cloud API, or your existing number via n8n)
- **Facebook** (Page Lead Ads / Messenger)
- **Instagram** (Lead Ads / DMs)

Every company that registers on the console gets its **own** set of endpoints,
each carrying a private, unguessable token. A token can **only ever create** a
lead in the workspace it belongs to — it never grants read access to anything.
So one tenant's leads can never land in, or be seen by, another tenant.

```
Email (IMAP / forward) ─┐
WhatsApp (Cloud / n8n) ─┤   n8n         per-workspace token (?t=…)
Facebook Lead Ads      ─┼─► collector ─► lead-intake Edge Fn ─► resolve token → workspace
Instagram Lead Ads/DM  ─┘   (or CF/Meta)   (server-side)      ─► extract (Claude, else regex)
                                                              ─► spam-gate, de-dup, allowlist
                                                              ─► insert `sub_` "interest" row
                                                                    │ tagged data.workspace
                                                                    ▼
                                                   Console auto-converts → Leads Pipeline
                                                   (source badge: ✉ 💬 📘 📸)
```

Each message lands as an ordinary submission in that tenant's inbox and is
auto-converted to a lead (stage **New**) with a **channel badge**
(Email / WhatsApp / Facebook / Instagram) and the sender's address/number,
de-duplicated against existing customers/leads. The existing inbox RLS keeps
every tenant's leads private.

> **Per-user, self-serve.** Nothing here is specific to one account. Any company
> that signs up opens **Settings → Lead capture**, copies its four endpoints, and
> wires them into its own n8n (or Cloudflare / Meta). Their leads are isolated by
> the same token + RLS that isolates the rest of their data.

---

## What you deploy (once, platform-wide)

These are deployed **once** by the platform owner; every tenant then self-serves.

| Piece | Where | Purpose |
|---|---|---|
| `supabase/saas/lead-intake.sql` | Supabase SQL Editor | per-workspace token table + owner RPCs |
| `supabase/functions/lead-intake` | Supabase Edge Functions | verify token, extract, write lead (all 4 channels) |
| n8n (per tenant) | n8n Cloud or self-host | collector that watches each channel → POSTs the function |
| *(optional)* Cloudflare Email Worker | Cloudflare | forward-email path instead of IMAP |
| *(optional)* Meta WhatsApp Cloud API | Meta for Developers | official Business WhatsApp webhook |

---

## 1. Database — run the SQL

Supabase → **SQL Editor** → paste **`supabase/saas/lead-intake.sql`** → Run.
Idempotent. Creates `lead_sources` (one unguessable token per workspace) and the
owner RPCs (`my_lead_source`, `rotate_lead_source_token`, `set_lead_source`) plus
the service-role `resolve_lead_source`. The table is **not** client-readable —
owners only ever see their own token via the RPCs.

## 2. Edge Function — deploy

```bash
supabase functions deploy lead-intake --no-verify-jwt
# Optional: AI extraction (richer leads). Without it, a regex fallback is used.
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

> **Deploy it named exactly `lead-intake`.** The console calls
> `/functions/v1/lead-intake`. If Supabase created it under a random name, the
> browser test says *"Failed to fetch"* — recreate it with the name `lead-intake`
> and **Verify JWT OFF**.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The
function URL is `https://<project-ref>.supabase.co/functions/v1/lead-intake`.

The function accepts a `channel` query param (`email` default, plus `whatsapp`,
`facebook`, `instagram`, `messenger`, or any custom label). For **email** it
parses `{from,subject,body}` or raw MIME; for **whatsapp** it understands the
WAHA/Cloud payload; for **facebook / instagram / messenger** (and any other
label) it accepts a **structured lead** —
`{name?, full_name?, email?, phone?/phone_number?, text?/message?, tour?, country?, party?, id?}` —
which is exactly what n8n's Facebook/Instagram Lead Ads nodes hand over.

> The **service-role key stays inside the function**, never in the browser. The
> extraction prompt runs server-side; the AI call never sees your Supabase keys.

## 3. Wire up the channels in n8n (per tenant, recommended)

n8n is the collector: one workflow per channel, each ending in an **HTTP Request →
your endpoint**. Get the four endpoints from the console: **Settings → Lead
capture** (each already has your token baked in — just copy).

| Channel | n8n trigger | POST to |
|---|---|---|
| Email | **Email Trigger (IMAP)** — your mailbox host + app password | Email endpoint |
| WhatsApp | **WhatsApp Trigger** (Cloud API) or a WAHA webhook | WhatsApp endpoint |
| Facebook | **Facebook Lead Ads Trigger** | Facebook endpoint |
| Instagram | **Instagram / Facebook Lead Ads Trigger** | Instagram endpoint |

For email, map the IMAP fields into the body as
`{ "from": {{$json.from}}, "subject": {{$json.subject}}, "body": {{$json.text || $json.textHtml}} }`.
For Facebook/Instagram Lead Ads, the trigger already emits `{name,email,phone,…}` —
send the JSON straight through. See **docs/N8N_LEADS.md** and the ready-made
workflows in **`n8n/`**.

> **Why n8n and not per-user OAuth in the console?** Reading a *private* mailbox,
> WhatsApp, or a Facebook Page requires that account's own connection (IMAP app
> password / QR scan / Meta Page login). The console can't hold every tenant's
> mailbox password. n8n is where each tenant makes those connections **once**,
> for **their** channels — and the only thing that leaves n8n is a lead POSTed to
> their token-scoped endpoint. (Making the console itself a Meta Tech Provider so
> tenants connect Facebook/WhatsApp *inside the console* is a larger, separate
> effort; the n8n path gives the same isolation today.)

### Alternative email path — Cloudflare Email Worker (no IMAP)

1. Cloudflare → add an ingest domain, e.g. `ingest.yourdomain.com`, enable **Email Routing**.
2. **Workers → Create** → paste `cloudflare/lead-email-worker.js`. Add a Worker
   variable `FUNCTION_URL` = your function URL.
3. Email Routing → **catch-all** → *Send to Worker* → this worker.
4. Console: **Settings → Lead capture** → set **email-ingest domain**. It shows
   `leads-<token>@ingest.yourdomain.com`.
5. Each company adds **one forwarding rule** in its mailbox to that address —
   no passwords, no inbox access; revoke by rotating the token or deleting the rule.

### Alternative WhatsApp path — Meta Cloud API (official)

1. **Meta for Developers** app → add **WhatsApp** → get a Business number (free Cloud tier).
2. **Configuration → Webhook**: Callback URL = the **WhatsApp endpoint** from the
   console card; Verify token = the **Verify token** in that card; subscribe to **messages**.
3. (Recommended) Save your Meta **App Secret** in the card so the function verifies
   each webhook's `X-Hub-Signature-256` HMAC.

> **Personal WhatsApp** has no official read API; unofficial libraries violate
> WhatsApp's terms and risk a number ban. Compliant options: forward the chat to
> your `leads-<token>@…` address, or upgrade to the free WhatsApp Business app +
> Cloud API. The n8n/WAHA QR path exists (docs/N8N_LEADS.md) but carries that same
> ToS/ban risk — use low-volume, at your own risk.

## 4. Use it

Leads arrive in **Leads Pipeline → New** with a **channel badge** (✉ Email /
💬 WhatsApp / 📘 Facebook / 📸 Instagram) and the sender's address/number,
de-duplicated. Manage the endpoints in **Settings → Lead capture**
(copy, Pause/Resume, Rotate token).

**Capture filter (Leads tab → "Email & WhatsApp sources"):** choose **From
anyone** (default) or **Only listed contacts** and paste the exact emails /
numbers to accept. In "list" mode the function drops any message whose sender
(email **or** number, matched across every channel) isn't on the list.

> Tip: real customers are **unknown** senders. Keep **From anyone** unless you
> genuinely want to whitelist a fixed set of contacts — "Only listed contacts"
> filters by sender, so it will drop first-time inquiries.

---

## Security notes

- **Token = create-only, per workspace.** A token maps an ingest request to
  exactly one workspace and can only insert a lead. It cannot read tours,
  bookings, customers, or any other tenant's data. Same blast radius as your
  public register link. Each tenant has its own token; there is no shared endpoint.
- **Tenant isolation** is enforced by the same RLS that protects the rest of the
  data: a `sub_` row is readable only by approved members of the workspace named
  in `data.workspace`. The function stamps the resolved workspace server-side; it
  never trusts the caller for tenancy. This is what guarantees *"leads per user,
  visible to that user only."*
- **Signature verification** for WhatsApp (Meta HMAC) when the app secret is stored.
- **Service role** never leaves the Edge Function. The browser only ever calls
  owner-scoped RPCs (which return just *your* token).
- **Spam gate**: newsletters/receipts/OTPs/auto-replies are dropped (`is_lead:false`)
  before anything is written.
- **De-dup**: repeat messages (same provider id, or same sender+text) don't create
  duplicate leads.
- **Revocation**: rotate the token (card button) or disable the source — every
  endpoint (all four channels) stops working immediately.
- **PII**: only the parsed lead fields + a short message excerpt are stored; card
  numbers / OTPs are redacted by the extractor.
