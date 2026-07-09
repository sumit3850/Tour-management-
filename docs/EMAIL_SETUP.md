# Email delivery setup (custom SMTP)

This makes **password-reset** and **email-confirmation** messages actually reach
your users. Supabase's *built-in* email sender is rate-limited (a few messages
per hour) and is meant for testing only — it frequently doesn't deliver to Gmail
and similar inboxes. Configure your own SMTP once and those emails work reliably.

Project: **`tbxzxfjumlnciczizols`** (Supabase → your project).

---

## Do you even need it?

| You want… | What to do |
|---|---|
| New signups to work without waiting on email | **Turn OFF "Confirm email"** (approval in `admin.html` is your real gate). No SMTP needed for this. |
| Self-serve **"Forgot password?"** to email a reset link | You **need custom SMTP** (below). |
| A polished, on-brand experience | Custom SMTP + verified sending domain. |

**Turning off email confirmation** (recommended regardless):
Supabase → **Authentication → Providers → Email → "Confirm email" = OFF → Save.**
A new signup is then immediately usable; you approve it in `admin.html`.

Even with confirmation off, you still want SMTP so **password resets** deliver.

---

## Step 1 — pick an SMTP provider

Any SMTP provider works. Easiest free options:

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** | 3,000/mo, 100/day | Simplest; modern; quick domain verify. Recommended. |
| **Brevo** (Sendinblue) | 300/day | No card needed; good for India. |
| **SendGrid** | 100/day | Reliable; a bit more setup. |
| **Amazon SES** | ~62k/mo (from EC2) | Cheapest at scale; more setup. |
| **Gmail / Google Workspace** | ~500/day | Quick for low volume; use an **App Password**, not your login password. |

You'll end up with **five values**: host, port, username, password, and a
**"from" email**.

Example (Resend): host `smtp.resend.com`, port `465`, user `resend`,
password `re_xxx` (an API key), from `noreply@yourdomain.com`.

Example (Brevo): host `smtp-relay.brevo.com`, port `587`, user is your Brevo
login email, password is the **SMTP key** from Brevo → SMTP & API.

Example (Gmail): host `smtp.gmail.com`, port `465`, user your full Gmail
address, password a **Google App Password** (Google Account → Security →
2-Step Verification → App passwords), from your Gmail address.

---

## Step 2 — verify your sending domain (recommended)

So your mail lands in inboxes, not spam. In your provider's dashboard, add your
domain (e.g. `islandexplorer.in`) and add the **SPF / DKIM DNS records** they
give you to your domain's DNS. Verification usually completes in minutes.

- Using a subdomain like `mail.islandexplorer.in` or `noreply@islandexplorer.in`
  as the "from" address is fine.
- Skipping this and using the provider's shared domain works for testing but
  deliverability is worse. Gmail-SMTP users can skip (send as their Gmail).

---

## Step 3 — enter the SMTP settings in Supabase

Supabase → **Project Settings → Authentication → SMTP Settings**
(newer UI: **Authentication → Emails → SMTP**).

1. Toggle **"Enable Custom SMTP" = ON**.
2. Fill in:
   - **Sender email**: your "from" address (e.g. `noreply@islandexplorer.in`)
   - **Sender name**: `Operation Console` (or `Island Explorer`)
   - **Host**: e.g. `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (STARTTLS) — use what your provider says
   - **Username** / **Password**: from your provider
3. **Save.**

> The "from" address must match a domain/address your provider is allowed to
> send from (that's what Step 2 verifies).

---

## Step 4 — set the redirect URL (so reset links land on your app)

Supabase → **Authentication → URL Configuration**:

- **Site URL**: your live app, e.g. `https://sumit3850.github.io/Tour-management-/`
  (or your custom domain / the Cloudflare Pages URL — whichever your users open).
- **Redirect URLs**: add the same URL. The app already calls
  `resetPasswordForEmail(email, { redirectTo: <current page> })`, so the reset
  link brings the user back to the sign-in screen to set a new password.

---

## Step 5 — (optional) brand the email templates

Supabase → **Authentication → Email Templates**. Edit **"Reset Password"** and
**"Confirm signup"** — set a friendly subject and body, e.g.:

> Subject: `Reset your Operation Console password`
> Body: keep the `{{ .ConfirmationURL }}` link; add a line like
> "You (or your admin) requested a password reset for Operation Console. Click
> below to choose a new password. If you didn't request this, ignore this email."

---

## Step 6 — test

1. **Password reset**: on the app's sign-in screen, enter a real address and tap
   **Forgot password?** → the email should arrive within a minute. Follow the
   link, set a new password, sign in.
2. Check the provider's dashboard **logs** if nothing arrives (bounce / spam /
   auth error will show there).

---

## Meanwhile — resetting a password without email

You can always reset a user's password yourself, no email needed:

**Supabase → Authentication → Users → click the user → "Send recovery"** (uses
SMTP) **or "Reset password" / set a new password directly**, then tell the user
the new password. This is the fallback until SMTP is live, and handy for users
who've lost access to their email.

---

## Quick reference — the two toggles that matter

1. **Authentication → Providers → Email → Confirm email** → **OFF** (so signups
   are immediately usable; approval is your gate).
2. **Authentication → SMTP Settings → Enable Custom SMTP** → **ON** (so
   password-reset emails actually deliver).
