"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function NewSchedulePage() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get nearest Monday
  function getThisMonday() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split("T")[0];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("production_schedules")
      .insert({ week_start: weekStart, notes: notes || null, status: "draft" })
      .select()
      .single();

    if (error) {
      setError(error.message);
      setSaving(false);
    } else {
      router.push(`/schedules/${data.id}`);
    }
  }

  return (
    <div style={{ maxWidth: "560px" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Production Schedule</h1>
          <p className="page-subtitle">Create a weekly production plan</p>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label className="form-label" htmlFor="weekStart">Week starting (Monday)</label>
            <input
              id="weekStart"
              type="date"
              className="form-input"
              value={weekStart}
              onChange={e => setWeekStart(e.target.value)}
              defaultValue={getThisMonday()}
              required
            />
            <p style={{ fontSize: "0.8125rem", color: "#78716c", marginTop: "0.25rem" }}>
              Select the Monday of the production week
            </p>
          </div>

          <div>
            <label className="form-label" htmlFor="notes">Notes (optional)</label>
            <textarea
              id="notes"
              className="form-input"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Any notes about this week's production…"
              style={{ resize: "vertical" }}
            />
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Creating…" : "Create Schedule"}
            </button>
            <Link href="/schedules" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
