"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

// Phase 9.5 v1 (Tino May 8 2026): stocktake unification — every new
// stocktake is created as a single Mixed sheet covering every item type.
// The previous 4-variant flow (RM / WIP / FG / Mixed) confused operators
// who would forget to count items that fell into the wrong scope. The
// stocktake_type column stays on the table for backwards-compat with old
// rows but is always written as 'mixed' going forward — depts coordinate
// via the dept-completion gate (Phase 9.5 v2) instead of by sheet split.

export default function NewStocktakeForm({ defaultWeekCommencing }: { defaultWeekCommencing: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [week, setWeek] = useState(defaultWeekCommencing);
  const [reference, setReference] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setCreating(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not signed in"); setCreating(false); return; }
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user.id).single();
      if (!profile?.tenant_id) { setError("No tenant linked to your profile"); setCreating(false); return; }

      // Auto-generate a reference like ST-2026-W17-003 if user didn't type one.
      // No type abbreviation — Mixed is the only flow now.
      let ref = reference.trim();
      if (!ref) {
        const { count } = await supabase
          .from("stocktakes")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", profile.tenant_id)
          .eq("week_commencing", week);
        const isoYear = new Date(week).getUTCFullYear();
        const wk = isoWeekNumber(new Date(week));
        ref = `ST-${isoYear}-W${String(wk).padStart(2, "0")}-${String((count ?? 0) + 1).padStart(2, "0")}`;
      }

      const { data: created, error: err } = await supabase
        .from("stocktakes")
        .insert({
          tenant_id: profile.tenant_id,
          reference: ref,
          status: "draft",
          counted_by: user.id,
          stocktake_type: "mixed",
          week_commencing: week,
        })
        .select("id")
        .single();
      if (err) { setError(err.message); setCreating(false); return; }
      router.push(`/stocktakes/${created.id}`);
    } catch (e) {
      setError(String(e)); setCreating(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ padding: "0.625rem 0.875rem", border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#166534", lineHeight: 1.5 }}>
        <strong>Mixed scope</strong> — covers every active item (RM, WIP, FG, packaging, consumables) on one sheet.
        Each department signs off its own counts, then the operator commits the whole stocktake when every dept has finished.
        Uncounted items follow the policy you pick at commit time.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label className="form-label">Week commencing (Monday)</label>
          <input
            className="form-input"
            type="date"
            value={week}
            onChange={e => setWeek(e.target.value)}
          />
          <p style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.25rem" }}>
            Used for grouping in weekly stocktake reports.
          </p>
        </div>
        <div>
          <label className="form-label">Reference (optional)</label>
          <input
            className="form-input"
            placeholder="auto-generated if blank"
            value={reference}
            onChange={e => setReference(e.target.value)}
          />
          <p style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.25rem" }}>
            e.g. <code>ST-2026-W17-RM-001</code>
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.625rem", paddingTop: "0.5rem" }}>
        <button onClick={handleStart} disabled={creating} className="btn-primary">
          {creating ? "Creating…" : "Start Stocktake"}
        </button>
        <Link href="/stocktakes" className="btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}

// Standard ISO 8601 week number (1–53). Monday is the first day of the week.
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
