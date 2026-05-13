"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Suspense } from "react";

function NewPlanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Default to next Monday if no week param
  const defaultWeek = (() => {
    const param = searchParams.get("week");
    if (param) return param;
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    const next = new Date(today);
    next.setDate(today.getDate() + diff);
    return next.toISOString().split("T")[0];
  })();

  const [weekStart, setWeekStart] = useState(defaultWeek);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!weekStart) { setError("Please select a week start date"); return; }
    setSaving(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("demand_plans")
      .insert({ week_start: weekStart, notes: notes || null, status: "draft" })
      .select("id")
      .single();

    if (err) {
      setError(err.message.includes("unique") ? "A plan for this week already exists." : err.message);
      setSaving(false);
      return;
    }

    router.push(`/plans/${data.id}`);
  };

  // Find Monday of the selected week (for display)
  const weekLabel = (() => {
    if (!weekStart) return "";
    const d = new Date(weekStart);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    return `${d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} – ${end.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  })();

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/plans" style={{ color: "#78716c", textDecoration: "none", fontSize: "0.875rem" }}>← Demand Plans</Link>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>New Demand Plan</h1>
          <p className="page-subtitle">Set the production week and add notes before entering demand lines</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: "500px" }}>
        {error && (
          <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label className="form-label">Production Week Start (Monday) *</label>
            <input
              type="date"
              className="form-input"
              value={weekStart}
              onChange={e => setWeekStart(e.target.value)}
            />
            {weekLabel && (
              <div style={{ marginTop: "0.375rem", fontSize: "0.8125rem", color: "#78716c" }}>
                {weekLabel}
              </div>
            )}
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="e.g. Christmas week — double Chorizo and Bratwurst runs…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button onClick={handleCreate} disabled={saving} className="btn-primary">
              {saving ? "Creating…" : "Create Plan →"}
            </button>
            <Link href="/plans" className="btn-secondary">Cancel</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewPlanPage() {
  return (
    <Suspense>
      <NewPlanForm />
    </Suspense>
  );
}
