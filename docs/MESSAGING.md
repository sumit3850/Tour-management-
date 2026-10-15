# Team messaging — WhatsApp Business API, SMS and email

The **Notify team** button on every operation can send automatically through
real providers once the `notify` Edge Function is deployed and the gateway is
switched on in **Settings → Messaging gateway**. Until then (or if sending
fails) the same buttons open WhatsApp / your SMS app / your mail app with the
message ready, exactly as before.

```
console ──(Bearer session JWT)──► notify Edge Function ──► WhatsApp Cloud API
                                                         ├─► MSG91 or Twilio (SMS)
                                                         └─► Resend (email)
```

Provider keys stay in Supabase secrets; the browser never sees them. Only a
signed-in console user (or a server carrying your workspace lead token) can
call the function.

---

## 1. Deploy the function (once)

```bash
supabase functions deploy notify --no-verify-jwt
```

Deploy it named exactly `notify` — the console calls `/functions/v1/notify`.
Open `https://<project>.supabase.co/functions/v1/notify` in a browser: it answers
`{"ok":true,"note":"notify is live","providers":{…}}` and shows which providers are configured.

## 2. WhatsApp Business API (Meta Cloud API)

What you need: a **Meta Business** account, a phone number that is **not** already
on the WhatsApp app (a new SIM or a landline that can receive a call), and about
an hour.

1. Go to **developers.facebook.com → My Apps → Create app → Business**. Add the
   **WhatsApp** product.
2. **WhatsApp → API Setup**: add your phone number and verify it. Note the
   **Phone number ID** (not the number itself).
3. Permanent token: **Business Settings → Users → System users → Add** (Admin),
   **Add assets → Apps → your app (Full control)**, then **Generate token** with
   the permissions `whatsapp_business_messaging` and `whatsapp_business_management`.
   Copy the token — it is shown once.
4. **Business verification** (Business Settings → Security Centre) lifts the
   250-conversations/day starter limit and lets your display name show.
5. **Message templates** (WhatsApp Manager → Message templates → Create):
   a message to someone who has not written to you in the last 24 hours must use
   an approved template. Create two, category **Utility**, language English:

   Name `new_tour_notice`, body:
   ```
   Dear {{1}}, you have been assigned to a new tour with Island Explorer Birding Tours: {{2}} ({{3}}). Please open your console for the full plan and details: {{4}}
   ```
   Name `tour_update_notice`, body:
   ```
   Dear {{1}}, your existing tour with Island Explorer Birding Tours has been updated: {{2}} ({{3}}). Please open your console for the latest details: {{4}}
   ```
   Approval usually takes minutes to a day. The console fills the four
   placeholders (name, tour, dates, console link) automatically.
6. Set the secrets:
   ```bash
   supabase secrets set WA_TOKEN=EAAB... WA_PHONE_ID=1234567890 \
     WA_TEMPLATE=new_tour_notice WA_TEMPLATE_UPDATE=tour_update_notice WA_TEMPLATE_LANG=en
   ```

Cost: Meta bills per conversation (utility conversations in India are a few
rupees each); the first 1,000 service conversations a month are free.

> Without `WA_TEMPLATE` the function sends plain text, which WhatsApp only
> delivers to people who messaged your business number in the last 24 hours.

## 3. SMS provider

**India (guides and drivers with Indian numbers): MSG91.** Indian SMS needs DLT
registration, which MSG91 walks you through.

1. Sign up at msg91.com. In **DLT**, register your company (PAN, GST, CIN) on a
   DLT portal (Jio / Vodafone-Idea / Airtel — any one), then register a
   **Sender ID** (6 letters, e.g. `IEBTRS`) and a **content template**, e.g.
   ```
   Dear {#var#}, you have been assigned to a new tour with Island Explorer Birding Tours: {#var#} ({#var#}). Please check your console: {#var#} - IEBT
   ```
   Approval of the DLT template takes 1–3 days. Note its **Template ID**.
2. MSG91 → **Authkey** (top right).
3. Secrets:
   ```bash
   supabase secrets set MSG91_AUTHKEY=... MSG91_SENDER=IEBTRS MSG91_DLT_TE_ID=1107...
   ```
   Cost is roughly ₹0.20–0.30 per SMS.

**International numbers: Twilio.** Buy a number at twilio.com and set
```bash
supabase secrets set TWILIO_SID=AC... TWILIO_TOKEN=... TWILIO_FROM=+1...
```
If both are configured, MSG91 is used.

## 4. Email: Resend

Resend is already recommended in `docs/EMAIL_SETUP.md`. Verify your sending
domain, create an API key and set:
```bash
supabase secrets set RESEND_API_KEY=re_... "EMAIL_FROM=Island Explorer Birding Tours <ops@islandexplorer.in>"
```

## 5. Switch it on in the console

**Settings → Messaging gateway**: turn **Automatic sending** on, press **Check
gateway** (shows which providers answer) and **Send test** to your own number /
email. From then on the Notify team buttons send directly and show a Sent mark
with the provider's reply; anything the gateway refuses falls back to opening
your phone's app.

## 6. Tour updates

When a tour or its operation is edited after the team has been notified, the
console sends "your existing tour has been updated, please check your console"
to everyone who was told about it, on the channel each person was last reached
on (automatic when the gateway is on; otherwise it opens the Notify team dialog
with the update message ready).
