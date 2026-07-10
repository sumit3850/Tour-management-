/**
 * Cloudflare Email Worker — lead-email-worker
 * ---------------------------------------------------------------------------
 * Receives inquiry emails FORWARDED to a per-workspace ingest address and relays
 * them to the Supabase lead-intake Edge Function, which turns them into leads.
 *
 * Ingest address shape (Cloudflare catch-all route on your ingest domain):
 *     leads-<TOKEN>@ingest.yourdomain.com
 * The <TOKEN> in the local-part is the workspace's ingest token (from the
 * console's "Lead sources" card). Companies just add ONE forwarding rule in
 * their mail (Gmail/Outlook/any provider) pointing inquiries at this address —
 * no passwords, no inbox access, revocable by rotating the token.
 *
 * Deploy: see docs/LEAD_INTAKE.md. Set FUNCTION_URL as a Worker variable, e.g.
 *   https://tbxzxfjumlnciczizols.supabase.co/functions/v1/lead-intake
 * ---------------------------------------------------------------------------
 */
export default {
  async email(message, env) {
    // local-part → token:  leads-<token>@...
    const to = String(message.to || "");
    const local = to.split("@")[0] || "";
    const m = local.match(/^leads[-.]([a-z0-9]+)$/i);
    const token = m ? m[1] : "";
    if (!token) { message.setReject("Unknown ingest address"); return; }

    // Read the raw MIME (capped so a huge attachment can't blow the Worker).
    let raw = "";
    try {
      const buf = await new Response(message.raw).arrayBuffer();
      raw = new TextDecoder("utf-8").decode(buf).slice(0, 400_000);
    } catch (_) { raw = ""; }

    const url = env.FUNCTION_URL + "?channel=email&t=" + encodeURIComponent(token);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: message.from,
          subject: message.headers.get("subject") || "",
          ext_id: message.headers.get("message-id") || "",
          raw,
        }),
      });
      // If the token is invalid/disabled, bounce so the sender isn't silently dropped.
      if (res.status === 403) message.setReject("Lead ingestion is disabled for this address");
    } catch (_) {
      // Transient failure — let the mail bounce so it can be retried/forwarded.
      message.setReject("Temporary ingest failure");
    }
  },
};
