// Supabase Edge Function: lead-intake
// ---------------------------------------------------------------------------
// Turns an inbound EMAIL (relayed by the Cloudflare Email Worker) or a WhatsApp
// Business message (Meta Cloud API webhook) into a lead in the ops console.
//
// It resolves the per-workspace ingest TOKEN (?t=...) to a tenant, extracts the
// lead fields (Claude if ANTHROPIC_API_KEY is set, else a regex fallback), and
// inserts a `sub_` "interest" submission tagged with data.workspace. The console's
// existing auto-convert turns it into a lead, and the inbox RLS keeps it private
// to that tenant. The token only ever CREATES a lead — it grants no read access.
//
// Env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the runtime):
//   ANTHROPIC_API_KEY  - optional; enables AI extraction (else regex-only)
// Deploy: supabase functions deploy lead-intake --no-verify-jwt
// Full setup + security notes: docs/LEAD_INTAKE.md
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// Allow browser calls (the console's "Send test lead" button, or a future in-app
// integration). The URL token still gates access; server callers ignore CORS.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-hub-signature-256",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};
const J = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

type Msg = { channel: string; from_name: string; from_handle: string; subject: string; body: string; ext_id?: string };
type Lead = {
  is_lead: boolean; reason?: string; confidence?: string;
  name: string | null; email: string | null; phone: string | null; country: string | null;
  tour_interest: string | null; party_size: number | null;
  start_date: string | null; end_date: string | null; budget: string | null;
  message_excerpt: string; source: string;
};

const EXTRACT_PROMPT =
`You are a lead-intake parser for a tour operator's CRM. You receive ONE raw inbound
message (email or WhatsApp) and return a single JSON object describing the sales lead
it contains — or marking it as "not a lead".

RULES:
- Extract ONLY what is present. Never invent names, dates, numbers or interest.
  Unknown fields -> null. Do not guess a country from a phone code unless no country
  is stated.
- Ignore quoted/forwarded history, signatures, disclaimers and auto-replies — parse
  the newest human message only.
- Normalize: phone to E.164 if a country is inferable (else keep digits); email
  lowercase; dates to ISO yyyy-mm-dd when a real date is given.
- is_lead=false for newsletters, receipts, OTPs, spam, delivery notices,
  out-of-office, or anything with no travel intent. Give a one-line reason.
- Summarize the ask in message_excerpt (<=200 chars). Redact any card numbers,
  passwords or OTPs.
- Output ONLY the JSON, no prose, matching exactly:
{"is_lead":bool,"reason":str,"confidence":"high"|"medium"|"low","name":str|null,
"email":str|null,"phone":str|null,"country":str|null,"tour_interest":str|null,
"party_size":num|null,"start_date":str|null,"end_date":str|null,"budget":str|null,
"message_excerpt":str,"source":str}`;

// ---- AI extraction (Claude Haiku — cheap, fast) ----------------------------
async function claudeExtract(m: Msg): Promise<Lead> {
  const user =
    `channel: ${m.channel}\nfrom_name: ${m.from_name}\nfrom_handle: ${m.from_handle}\n` +
    `subject: ${m.subject}\nbody:\n${(m.body || "").slice(0, 6000)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: EXTRACT_PROMPT,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status);
  const data = await res.json();
  const text = (data?.content?.[0]?.text ?? "").trim();
  const jstr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const out = JSON.parse(jstr) as Lead;
  out.source = m.channel;
  return out;
}

// ---- Regex fallback (no API key / AI failure) ------------------------------
function regexExtract(m: Msg): Lead {
  const body = `${m.subject}\n${m.body || ""}`;
  const email = (body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] ||
    (/@/.test(m.from_handle) ? m.from_handle : null);
  const phoneRaw = (body.match(/\+?\d[\d ()\-]{7,}\d/) || [])[0] ||
    (/^\+?\d[\d ]+$/.test(m.from_handle) ? m.from_handle : null);
  const phone = phoneRaw ? phoneRaw.replace(/[()\-\s]/g, "") : null;
  const party = ((body.match(/(\d+)\s*(?:pax|people|persons?|adults?|guests?|travell?ers?)/i) || [])[1]) || null;
  const junk = /\b(unsubscribe|newsletter|no-?reply|out of office|delivery status|verification code|otp)\b/i.test(body);
  return {
    is_lead: !junk,
    reason: junk ? "looks automated/non-lead" : "regex fallback",
    confidence: "low",
    name: (m.from_name || "").trim() || (email ? email.split("@")[0] : null),
    email: email ? email.toLowerCase() : null,
    phone,
    country: null,
    tour_interest: null,
    party_size: party ? parseInt(party, 10) : null,
    start_date: null, end_date: null, budget: null,
    message_excerpt: (m.body || m.subject || "").replace(/\s+/g, " ").trim().slice(0, 200),
    source: m.channel,
  };
}

async function extract(m: Msg): Promise<Lead> {
  if (ANTHROPIC_API_KEY) { try { return await claudeExtract(m); } catch (_) { /* fall through */ } }
  return regexExtract(m);
}

// ---- WhatsApp HMAC signature check (when the app secret is stored) ---------
async function validSignature(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!secret) return true;                       // no secret configured -> skip (token still gates)
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return ("sha256=" + hex) === header;
}

// ---- best-effort plain text from a raw MIME email --------------------------
function emailText(raw: string): { subject: string; from: string; body: string } {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const head = headerEnd > -1 ? raw.slice(0, headerEnd) : raw;
  const subject = (head.match(/^subject:\s*(.*)$/im) || [])[1]?.trim() || "";
  const from = (head.match(/^from:\s*(.*)$/im) || [])[1]?.trim() || "";
  let body = headerEnd > -1 ? raw.slice(headerEnd) : "";
  // Prefer a text/plain part; else strip HTML tags from whatever is there.
  const tp = body.split(/content-type:\s*text\/plain/i)[1];
  if (tp) { const s = tp.search(/\r?\n\r?\n/); if (s > -1) body = tp.slice(s); }
  body = body.replace(/=\r?\n/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return { subject, from, body: body.trim().slice(0, 8000) };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const token = url.searchParams.get("t") || "";
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve token -> workspace (service role; never trusts the client for tenancy).
    const { data: src } = await sb.rpc("resolve_lead_source", { p_token: token });
    // For the WhatsApp GET verification handshake we still need wa_verify even
    // before a POST, so resolve first and 404 unknown tokens.
    if (!src || !src.workspace) return J({ ok: false, error: "invalid or disabled token" }, 403);
    const workspace: string = src.workspace;

    // --- WhatsApp webhook verification (Meta calls GET once on setup) --------
    if (req.method === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
      if (url.searchParams.get("hub.verify_token") === src.wa_verify) {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      return J({ ok: false, error: "verify_token mismatch" }, 403);
    }

    if (req.method !== "POST") return J({ ok: true, note: "lead-intake is live" });

    // email | whatsapp | facebook | instagram | messenger | any custom label
    const channel = (url.searchParams.get("channel") || "email").toLowerCase();
    const raw = await req.text();

    const msgs: Msg[] = [];
    if (channel === "whatsapp") {
      if (!(await validSignature(src.wa_app_secret || "", raw, req.headers.get("x-hub-signature-256"))))
        return J({ ok: false, error: "bad signature" }, 403);
      const payload = JSON.parse(raw || "{}");
      if (Array.isArray(payload.entry)) {
        // Meta WhatsApp Cloud API webhook shape.
        for (const entry of payload.entry) {
          for (const ch of entry.changes ?? []) {
            const v = ch.value ?? {};
            const names: Record<string, string> = {};
            for (const c of v.contacts ?? []) names[c.wa_id] = c.profile?.name ?? "";
            for (const mm of v.messages ?? []) {
              const text = mm.text?.body ?? mm.button?.text ?? mm.interactive?.list_reply?.title ?? "";
              if (!text) continue;
              msgs.push({ channel, from_name: names[mm.from] ?? "", from_handle: mm.from ?? "",
                subject: "", body: text, ext_id: mm.id });
            }
          }
        }
      } else {
        // Simple/direct shape — for n8n, WAHA, Evolution API, Twilio, or any custom
        // connector: {from, name?, text, id?}. Nested WAHA payloads (payload.body)
        // are supported too. The URL token gates access (no Meta signature here).
        const p = payload.payload ?? payload;
        const text = p.text ?? p.body ?? p.message ?? p.Body ?? "";
        const from = p.from ?? p.phone ?? p.From ?? "";
        if (text && from) {
          msgs.push({ channel, from_name: p.name ?? p.notifyName ?? p._data?.notifyName ?? "",
            from_handle: String(from).replace(/^whatsapp:/i, "").replace(/@.*$/, "").trim(),
            subject: "", body: String(text), ext_id: p.id ?? p.ext_id ?? p.messageId ?? "" });
        }
      }
    } else if (channel === "email") {
      // Email: the CF worker may POST JSON {from,subject,body} or the raw MIME.
      let e: { from?: string; subject?: string; body?: string; raw?: string; ext_id?: string } = {};
      try { e = JSON.parse(raw); } catch (_) { e = { raw }; }
      const parsed = e.raw ? emailText(e.raw) : { subject: e.subject ?? "", from: e.from ?? "", body: e.body ?? "" };
      const fromName = (parsed.from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1]?.trim() || "";
      const fromAddr = (parsed.from.match(/<([^>]+)>/) || [])[1] || parsed.from;
      msgs.push({ channel, from_name: fromName, from_handle: fromAddr,
        subject: parsed.subject, body: parsed.body, ext_id: e.ext_id });
    } else {
      // Structured lead from a form or social channel — Facebook / Instagram Lead
      // Ads, Messenger DMs, or any custom connector. n8n's Facebook Lead Ads node
      // hands over clean fields, so accept them directly:
      //   {name?, full_name?, email?, phone?/phone_number?, text?/message?, tour?, country?, party?, id?}
      let p: any = {}; try { p = JSON.parse(raw || "{}"); } catch (_) { p = {}; }
      p = p.payload ?? p;
      const nm = p.name ?? p.full_name ?? p.fullName ?? p.first_name ?? "";
      const email = String(p.email ?? p.Email ?? "").trim();
      const phone = String(p.phone ?? p.phone_number ?? p.Phone ?? p.whatsapp ?? "").trim();
      const msg = p.text ?? p.message ?? p.enquiry ?? p.body ?? p.comment ?? "";
      // Fold the structured fields into the body so the extractor keeps them.
      const bodyParts = [msg, nm && ("Name: " + nm), phone && ("Phone: " + phone),
        p.tour && ("Tour: " + p.tour), p.country && ("Country: " + p.country),
        p.party && ("Party: " + p.party)].filter(Boolean).join("\n");
      const handle = email || phone || p.from || "";
      if (bodyParts || handle) {
        msgs.push({ channel, from_name: nm, from_handle: String(handle),
          subject: "", body: bodyParts || ("New enquiry via " + channel),
          ext_id: p.id ?? p.lead_id ?? p.ext_id ?? "" });
      }
    }

    let created = 0, skipped = 0;
    for (const m of msgs) {
      // idempotency: skip if we already ingested this provider message id
      if (m.ext_id) {
        const { data: dup } = await sb.from("workspaces").select("id")
          .like("id", "sub_%").contains("data", { data: { extMsgId: m.ext_id } } as any).limit(1);
        if (dup && dup.length) { skipped++; continue; }
      }
      // Capture filter: when the owner set "only listed contacts", accept a
      // message only if its sender email/number is on the allow list.
      if (src.allow_mode === "list") {
        const emails: string[] = (src.email_allow ?? []).map((s: string) => s.toLowerCase());
        const nums: string[] = (src.wa_allow ?? []).map((s: string) => String(s).replace(/\D/g, ""));
        // match on email OR number, so the filter works for every channel
        const hay = m.from_handle + " " + m.body;
        const senderEmail = (hay.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0]?.toLowerCase() || "";
        const senderNum = (hay.match(/\+?\d[\d ()\-]{7,}\d/) || [])[0]?.replace(/\D/g, "") || m.from_handle.replace(/\D/g, "");
        const emailOk = senderEmail && emails.includes(senderEmail);
        const numOk = senderNum && nums.some((n) => n && (senderNum === n || senderNum.endsWith(n) || n.endsWith(senderNum)));
        if (!emailOk && !numOk) { skipped++; continue; }
      }
      const lead = await extract(m);
      if (!lead.is_lead) { skipped++; continue; }

      const id = "S" + Date.now() + Math.floor(Math.random() * 100000);
      const created_at = new Date().toISOString();
      const rec = {
        type: "interest", status: "new",
        name: lead.name || m.from_name || "—",
        phone: lead.phone || (channel === "whatsapp" ? m.from_handle : ""),
        email: lead.email || (channel === "email" ? m.from_handle : ""),
        country: lead.country || "",
        tour: lead.tour_interest || "",
        start_date: lead.start_date || null,
        end_date: lead.end_date || null,
        party: lead.party_size || null,
        id, created_at, workspace, source: channel,
        data: {
          message: lead.message_excerpt || m.body || "",
          clientType: null, source: channel, confidence: lead.confidence || "low",
          budget: lead.budget || "", extMsgId: m.ext_id || "",
        },
      };
      const { error } = await sb.from("workspaces").insert({ id: "sub_" + id, data: rec, updated_at: created_at });
      if (error) throw error;
      created++;
    }

    return J({ ok: true, workspace, created, skipped });
  } catch (e) {
    return J({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
