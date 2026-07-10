# Funnel leads with n8n (email + WhatsApp)

n8n is a visual automation tool — you drag nodes instead of writing code. Here it
acts as the **collector**: it watches your email and WhatsApp and hands each message
to your existing **`lead-intake`** function, which does the parsing, de-dup, workspace
tagging and your allowlist. So n8n replaces the Cloudflare/Meta plumbing — nothing
else changes, and it can read your **existing WhatsApp number** without the Meta
migration.

```
Email (IMAP/Gmail)  ─┐   n8n            HTTP POST      lead-intake
WhatsApp (WAHA/QR)  ─┴─►  trigger  ────────────────►   Edge Function  ──► CRM lead
```

Ready-to-import workflows live in **`n8n/email-to-leads.json`** and
**`n8n/whatsapp-to-leads.json`**.

---

## Prerequisites
1. **`lead-intake` function deployed** and **`lead-intake.sql`** run (see
   docs/LEAD_INTAKE.md). Open `…/functions/v1/lead-intake?t=YOUR_TOKEN` in a browser
   → it should say `{"ok":true,"note":"lead-intake is live"}`.
2. Your **token** — console → **Settings → Lead capture** (it's in the WhatsApp
   webhook URL). You'll paste it into both workflows.

## Get n8n running (pick one)
- **n8n Cloud** — sign up at n8n.io, nothing to host. Easiest. (~free trial, then paid.)
- **Self-host (free)** — one Docker command on any small VPS / Railway / Render:
  ```bash
  docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
  ```
  Open `http://localhost:5678` (or your server URL).

---

## Email → Leads
1. In n8n: **Workflows → Import from File** → pick `n8n/email-to-leads.json`.
2. Open the **Email Trigger (IMAP)** node → **Create new credential** → enter your
   mailbox IMAP details:
   - Gmail: host `imap.gmail.com`, port `993`, SSL on, user = your address, password
     = a **Google App Password** (not your login).
   - Outlook/other: use that provider's IMAP host/port.
3. Open **POST to lead-intake** → in the URL replace **`YOUR_TOKEN`** with your token.
4. Toggle the workflow **Active** (top-right).

Now every new email creates a lead. Tip: point it at a mailbox/label that only
receives inquiries, or forward inquiries there, so it doesn't parse every email.

## WhatsApp → Leads (your existing number, no Meta)
This uses **WAHA** (WhatsApp HTTP API) — it connects your number as a **linked
device** (a QR scan, exactly like WhatsApp Web), so your phone app keeps working.

> ⚠️ **Important:** WAHA/Evolution are *unofficial*. Automating a personal/Business-app
> number is against WhatsApp's Terms and **can get the number banned**, especially at
> volume. Keep it low-volume and read-only, and don't use it for a number you can't
> risk. The official, guaranteed route is the Meta Cloud API (docs/LEAD_INTAKE.md).

1. Run WAHA (Docker):
   ```bash
   docker run -it --rm -p 3000:3000 devlikeapro/waha
   ```
   Open `http://localhost:3000`, start a session, and **scan the QR** with
   WhatsApp → Linked devices, on the number you want to capture from.
2. In n8n: **Import from File** → `n8n/whatsapp-to-leads.json`.
3. Toggle it **Active**, then open the **WhatsApp Webhook** node and copy its
   **Production URL**.
4. In WAHA, set that URL as the session **webhook** and subscribe to the **message**
   event (WAHA dashboard → session → webhooks, or `WHATSAPP_HOOK_URL` env).
5. In **POST to lead-intake**, replace **`YOUR_TOKEN`** with your token.

The workflow forwards WAHA's message payload as-is; the function understands WAHA's
shape (`payload.body`, `payload.notifyName`, `payload.from`). For **Evolution API**
or another provider, just make the HTTP node send `{ "from": "...", "name": "...",
"text": "..." }` mapped from that provider's fields.

---

## Test it
- Email: send an inquiry to the watched mailbox → it appears in **Leads (CRM) → New**.
- WhatsApp: message your connected number from another phone → same.
- Remember the **capture filter**: if you set **Only listed contacts** in the Leads
  tab, add the sender's email/number to the allowlist (or switch to *From anyone*),
  or the message is ignored.

## Why this is simpler
- **Email:** an IMAP node + your app password — no Cloudflare, no DNS.
- **WhatsApp:** a QR scan on your existing number — no Meta app, no OTP migration, the
  Business app keeps working (at the ToS/ban risk noted above).
- **Security is unchanged:** n8n only ever calls your token-gated `lead-intake`
  function; the Supabase service key and tenant isolation stay inside that function.
