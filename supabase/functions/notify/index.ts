// Supabase Edge Function: notify
// ---------------------------------------------------------------------------
// Sends team notices from the ops console through real messaging providers:
//   whatsapp  -> Meta WhatsApp Cloud API (Business API)
//   sms       -> MSG91 (India, DLT) or Twilio (international), whichever is set
//   email     -> Resend
//
// Who may call it: a signed-in console user (Authorization: Bearer <session JWT>,
// checked with auth.getUser()), or a server caller carrying a workspace lead
// token (?t=...) resolved with resolve_lead_source. Provider secrets never reach
// the browser; they live in `supabase secrets`.
//
// Request (POST, JSON):
//   { channel: "whatsapp" | "sms" | "email",
//     to: [{ name, phone, email }],              // max 30
//     message: "plain text",                      // used for sms / email / WhatsApp text
//     subject: "email subject",                   // email only
//     template: { kind: "new" | "update", params: ["name","tour","dates","link"] } }  // WhatsApp template
// Response: { ok, results: [{ to, ok, id?, error? }] }
//
// Env (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected):
//   WA_TOKEN, WA_PHONE_ID            Meta Cloud API permanent token + phone number id
//   WA_TEMPLATE, WA_TEMPLATE_UPDATE  approved template names (optional; text is sent
//                                    without them, which only reaches people who
//                                    messaged you in the last 24 h)
//   WA_TEMPLATE_LANG                 default "en"
//   MSG91_AUTHKEY, MSG91_SENDER, MSG91_DLT_TE_ID      MSG91 (India)
//   TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM             Twilio (any country)
//   RESEND_API_KEY, EMAIL_FROM                        Resend ("Name <ops@yourdomain>")
// Deploy: supabase functions deploy notify --no-verify-jwt
// Setup guide: docs/MESSAGING.md
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};
const J = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

type To = { name?: string; phone?: string; email?: string };
type Result = { to: string; ok: boolean; id?: string; error?: string };

// Indian 10-digit numbers get +91; anything else is used as given (digits only).
function e164(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  return d.length === 10 ? "91" + d : d;
}

// ---- WhatsApp Cloud API -----------------------------------------------------
async function sendWhatsApp(to: To, message: string, template?: { kind?: string; params?: string[] }): Promise<Result> {
  const token = env("WA_TOKEN"), phoneId = env("WA_PHONE_ID");
  const num = e164(to.phone || "");
  if (!token || !phoneId) return { to: num, ok: false, error: "WhatsApp not configured (WA_TOKEN / WA_PHONE_ID)" };
  if (!num) return { to: "", ok: false, error: "no phone number" };
  const tplName = template?.kind === "update" ? (env("WA_TEMPLATE_UPDATE") || env("WA_TEMPLATE")) : env("WA_TEMPLATE");
  let payload: Record<string, unknown>;
  if (tplName && template?.params?.length) {
    payload = {
      messaging_product: "whatsapp", to: num, type: "template",
      template: {
        name: tplName, language: { code: env("WA_TEMPLATE_LANG") || "en" },
        components: [{ type: "body", parameters: template.params.map((p) => ({ type: "text", text: String(p).slice(0, 1024) })) }],
      },
    };
  } else {
    payload = { messaging_product: "whatsapp", to: num, type: "text", text: { preview_url: true, body: message.slice(0, 4096) } };
  }
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { to: num, ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { to: num, ok: true, id: data?.messages?.[0]?.id };
}

// ---- SMS: MSG91 (India) or Twilio ---------------------------------------------
async function sendSms(to: To, message: string): Promise<Result> {
  const num = e164(to.phone || "");
  if (!num) return { to: "", ok: false, error: "no phone number" };
  if (env("MSG91_AUTHKEY")) {
    const body: Record<string, unknown> = {
      sender: env("MSG91_SENDER") || "IEBTRS", route: "4", country: "91",
      sms: [{ message, to: [num] }],
    };
    if (env("MSG91_DLT_TE_ID")) body.DLT_TE_ID = env("MSG91_DLT_TE_ID");
    const res = await fetch("https://api.msg91.com/api/v2/sendsms", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTHKEY"), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && (data?.type === "success" || data?.type === undefined);
    return ok ? { to: num, ok: true, id: data?.message || data?.request_id } : { to: num, ok: false, error: data?.message || `HTTP ${res.status}` };
  }
  if (env("TWILIO_SID")) {
    const sid = env("TWILIO_SID"), tok = env("TWILIO_TOKEN"), from = env("TWILIO_FROM");
    const form = new URLSearchParams({ To: "+" + num, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: "Basic " + btoa(`${sid}:${tok}`), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { to: num, ok: false, error: data?.message || `HTTP ${res.status}` };
    return { to: num, ok: true, id: data?.sid };
  }
  return { to: num, ok: false, error: "SMS not configured (MSG91_AUTHKEY or TWILIO_SID)" };
}

// ---- Email: Resend ----------------------------------------------------------
async function sendEmail(to: To, subject: string, message: string): Promise<Result> {
  const key = env("RESEND_API_KEY"), from = env("EMAIL_FROM");
  const addr = String(to.email || "").trim();
  if (!addr) return { to: "", ok: false, error: "no email address" };
  if (!key || !from) return { to: addr, ok: false, error: "Email not configured (RESEND_API_KEY / EMAIL_FROM)" };
  const html = "<pre style=\"font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap\">" +
    message.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [addr], subject: subject || "Notice", text: message, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { to: addr, ok: false, error: data?.message || data?.error || `HTTP ${res.status}` };
  return { to: addr, ok: true, id: data?.id };
}

// ---- who is calling -----------------------------------------------------------
async function callerAllowed(req: Request, url: URL): Promise<{ ok: boolean; who: string }> {
  const auth = req.headers.get("authorization") || "";
  if (/^Bearer\s+\S+/i.test(auth) && ANON_KEY) {
    try {
      const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return { ok: true, who: "user:" + (data.user.email || data.user.id) };
    } catch (_) { /* fall through */ }
  }
  const token = url.searchParams.get("t") || "";
  if (token) {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: src } = await sb.rpc("resolve_lead_source", { p_token: token });
    if (src?.workspace) return { ok: true, who: "workspace:" + src.workspace };
  }
  return { ok: false, who: "" };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method === "GET") {
      return J({ ok: true, note: "notify is live", providers: {
        whatsapp: !!(env("WA_TOKEN") && env("WA_PHONE_ID")), whatsapp_template: !!env("WA_TEMPLATE"),
        sms: !!(env("MSG91_AUTHKEY") || env("TWILIO_SID")), email: !!(env("RESEND_API_KEY") && env("EMAIL_FROM")) } });
    }
    if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
    const who = await callerAllowed(req, url);
    if (!who.ok) return J({ ok: false, error: "sign in to the console first (no valid session or token)" }, 401);

    const body = await req.json().catch(() => ({}));
    const channel = String(body.channel || "").toLowerCase();
    const list: To[] = Array.isArray(body.to) ? body.to.slice(0, 30) : [];
    const message = String(body.message || "").trim();
    const subject = String(body.subject || "").trim();
    if (!["whatsapp", "sms", "email"].includes(channel)) return J({ ok: false, error: "channel must be whatsapp, sms or email" }, 400);
    if (!list.length) return J({ ok: false, error: "no recipients" }, 400);
    if (!message && channel !== "whatsapp") return J({ ok: false, error: "empty message" }, 400);

    const results: Result[] = [];
    for (const to of list) {
      try {
        if (channel === "whatsapp") results.push(await sendWhatsApp(to, message, body.template));
        else if (channel === "sms") results.push(await sendSms(to, message));
        else results.push(await sendEmail(to, subject, message));
      } catch (e) {
        results.push({ to: to.phone || to.email || "", ok: false, error: String((e as Error)?.message || e) });
      }
    }
    console.log(JSON.stringify({ by: who.who, channel, n: list.length, ok: results.filter((r) => r.ok).length }));
    return J({ ok: results.some((r) => r.ok), results });
  } catch (e) {
    return J({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
