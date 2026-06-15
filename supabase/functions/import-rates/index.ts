// Supabase Edge Function: import-rates
// ---------------------------------------------------------------------------
// Fetches a *published* Google Sheet CSV and merges the per-person tour rates
// into the `workspaces` row that the Island Explorer ops console reads from.
//
// The console stores all data as one JSON blob in `workspaces.data`. This
// function reads that blob, updates `data.tourCosts` from the sheet, and writes
// it back. The app then picks up the new rates on its next pull / auto-sync.
//
// Env vars (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Supabase Edge runtime; you only need to set the two below):
//   SHEET_CSV_URL  - the "Publish to web -> CSV" link for your rate sheet
//   WORKSPACE_ID   - the workspace name used in the app (default: island-explorer)
//
// Deploy + schedule instructions: see docs/SHEET_SYNC.md
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEET_CSV_URL = Deno.env.get("SHEET_CSV_URL") ?? "";
const WORKSPACE_ID = Deno.env.get("WORKSPACE_ID") ?? "island-explorer";

function parseCSV(text: string): string[][] {
  return text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length).map((line) => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  });
}

const num = (v: string) => parseFloat(String(v || "").replace(/[^0-9.]/g, "")) || 0;

Deno.serve(async () => {
  try {
    if (!SHEET_CSV_URL) throw new Error("SHEET_CSV_URL secret is not set");
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const csv = await (await fetch(SHEET_CSV_URL)).text();
    const rows = parseCSV(csv);
    if (rows.length < 2) throw new Error("Sheet has no data rows");
    const head = rows[0].map((h) => h.toLowerCase());
    const col = (names: string[]) => {
      for (let i = 0; i < head.length; i++) for (const n of names) if (head[i].includes(n)) return i;
      return -1;
    };
    const idIdx = col(["id"]);
    const catIdx = col(["category", "name", "tour"]);
    const inIdx = col(["indian", "domestic", "ind"]);
    const foIdx = col(["foreigner", "foreign", "international", "intl"]);

    // Load the current workspace blob so we can map rows to tour ids by name.
    const { data: ws } = await sb.from("workspaces").select("data").eq("id", WORKSPACE_ID).maybeSingle();
    const blob: Record<string, any> = (ws && ws.data) ? ws.data : {};
    const tours: any[] = Array.isArray(blob.tours) ? blob.tours : [];
    const tourCosts: Record<string, { indian: number; foreigner: number }> = blob.tourCosts ?? {};

    let count = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      let tour: any = null;
      if (idIdx >= 0 && row[idIdx]) {
        const idv = row[idIdx].toUpperCase();
        tour = tours.find((t) => String(t.id).toUpperCase() === idv);
      }
      if (!tour && catIdx >= 0 && row[catIdx]) {
        const nm = row[catIdx].toLowerCase();
        tour = tours.find((t) => String(t.name).toLowerCase().includes(nm) || nm.includes(String(t.name).toLowerCase()));
      }
      // Fall back to the raw id/category string as the key when no tour matches.
      const key = tour ? tour.id : (idIdx >= 0 && row[idIdx] ? row[idIdx] : (catIdx >= 0 ? row[catIdx] : null));
      if (!key) continue;
      tourCosts[key] = tourCosts[key] ?? { indian: 0, foreigner: 0 };
      if (inIdx >= 0 && row[inIdx]) tourCosts[key].indian = num(row[inIdx]);
      if (foIdx >= 0 && row[foIdx]) tourCosts[key].foreigner = num(row[foIdx]);
      count++;
    }

    blob.tourCosts = tourCosts;
    const { error } = await sb.from("workspaces").upsert({
      id: WORKSPACE_ID,
      data: blob,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, workspace: WORKSPACE_ID, updated: count }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
