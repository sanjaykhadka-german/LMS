"use client";

/**
 * StocktakeDeptSignoff — per-department sign-off chips + commit modal
 * for the Mixed-stocktake flow (Phase 9.5 v1, Tino May 2026).
 *
 * Lives as a standalone component so the parent _client.tsx (~1500 lines)
 * doesn't have to absorb another 250+ lines of JSX. The parent passes in
 * the bare minimum state and a couple of callbacks; this component owns
 * the chip toggling, the commit modal, and the policy radio.
 *
 * Props:
 *   - tenantId, stocktakeId — used to write directly to
 *     stocktake_department_signoffs via the supabase client
 *   - departments — every active dept (used as the pool); the component
 *     internally narrows to "in scope" by intersecting with the depts
 *     present on the stocktake's line locations
 *   - lineDepartmentIds — Set<string> of dept IDs that have at least one
 *     line; passed in (already computed by parent) to avoid joining again
 *   - initialSignoffs — already-recorded sign-offs at page load
 *   - completedLines / totalLines / distinctItems — header stats for the
 *     commit modal
 *   - onCommit(policy) — callback fired when the operator confirms the
 *     commit modal; the parent runs the actual stock-update logic
 *   - submitting — disables the modal's buttons while the parent is busy
 *   - isSubmitted — when true, the panel renders read-only history
 */

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Signoff = {
  id: string;
  department_id: string;
  signed_off_at: string;
  signed_off_by: string | null;
  notes: string | null;
  signer: { id: string; full_name: string } | null;
};

export type UncountedPolicy = "carry_over" | "zero_set";

export function StocktakeDeptSignoff({
  tenantId,
  stocktakeId,
  departments,
  lineDepartmentIds,
  initialSignoffs,
  completedLines,
  totalLines,
  distinctItems,
  initialPolicy = "carry_over",
  onCommit,
  submitting,
  isSubmitted,
}: {
  tenantId: string | null;
  stocktakeId: string;
  departments: { id: string; name: string; code: string | null }[];
  lineDepartmentIds: Set<string>;
  initialSignoffs: Signoff[];
  completedLines: number;
  totalLines: number;
  distinctItems: number;
  initialPolicy?: UncountedPolicy;
  onCommit: (policy: UncountedPolicy) => void | Promise<void>;
  submitting: boolean;
  isSubmitted: boolean;
}) {
  const supabase = createClient();
  const [signoffs, setSignoffs] = useState<Signoff[]>(initialSignoffs);
  const [busy, setBusy] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [policy, setPolicy] = useState<UncountedPolicy>(initialPolicy);

  const inScope = useMemo(() => {
    if (lineDepartmentIds.size === 0) return departments;
    return departments.filter(d => lineDepartmentIds.has(d.id));
  }, [departments, lineDepartmentIds]);

  const allSigned = inScope.length > 0 && inScope.every(d => signoffs.some(s => s.department_id === d.id));
  const missingNames = inScope.filter(d => !signoffs.some(s => s.department_id === d.id)).map(d => d.name);

  async function toggleDept(departmentId: string) {
    if (isSubmitted || !tenantId) return;
    const existing = signoffs.find(s => s.department_id === departmentId);
    setBusy(departmentId);
    try {
      if (existing) {
        await supabase.from("stocktake_department_signoffs").delete().eq("id", existing.id);
        setSignoffs(prev => prev.filter(s => s.id !== existing.id));
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = user
          ? await supabase.from("profiles").select("full_name").eq("id", user.id).single()
          : { data: null };
        const { data: inserted, error } = await supabase
          .from("stocktake_department_signoffs")
          .insert({
            tenant_id: tenantId,
            stocktake_id: stocktakeId,
            department_id: departmentId,
            signed_off_by: user?.id ?? null,
          })
          .select("id, department_id, signed_off_at, signed_off_by, notes")
          .single();
        if (!error && inserted) {
          setSignoffs(prev => [...prev, {
            id: (inserted as { id: string }).id,
            department_id: (inserted as { department_id: string }).department_id,
            signed_off_at: (inserted as { signed_off_at: string }).signed_off_at,
            signed_off_by: (inserted as { signed_off_by: string | null }).signed_off_by,
            notes: (inserted as { notes: string | null }).notes,
            signer: user && profile ? { id: user.id, full_name: (profile as { full_name: string }).full_name } : null,
          }]);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  if (inScope.length === 0) return null;

  return (
    <>
      <div style={{ margin: "0.75rem 0", padding: "0.625rem 0.875rem", border: "1px solid #e7e5e4", background: "#fafaf9", borderRadius: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Department sign-off
          </span>
          {inScope.map(d => {
            const so = signoffs.find(s => s.department_id === d.id);
            const signed = !!so;
            const isBusy = busy === d.id;
            return (
              <button
                key={d.id}
                onClick={() => toggleDept(d.id)}
                disabled={isSubmitted || isBusy}
                title={so?.signer ? `Signed off by ${so.signer.full_name} on ${new Date(so.signed_off_at).toLocaleString("en-AU")}` : "Click to mark this department complete"}
                style={{
                  fontSize: "0.75rem",
                  padding: "0.3125rem 0.625rem",
                  borderRadius: "0.375rem",
                  border: signed ? "1px solid #15803d" : "1px solid #d6d3d1",
                  background: signed ? "#dcfce7" : "#fff",
                  color: signed ? "#166534" : "#57534e",
                  cursor: isSubmitted ? "default" : isBusy ? "wait" : "pointer",
                  fontWeight: signed ? 700 : 500,
                  display: "inline-flex", alignItems: "center", gap: "0.3125rem",
                  opacity: isSubmitted ? 0.7 : 1,
                }}
              >
                {signed ? "✓" : "○"} {d.name}
              </button>
            );
          })}
          <span style={{ fontSize: "0.75rem", color: allSigned ? "#15803d" : "#92400e", marginLeft: "auto" }}>
            {allSigned ? "All departments signed off" : `${signoffs.length} of ${inScope.length} signed off`}
          </span>
        </div>
      </div>

      {/* The parent calls openCommitModal() via this exported imperative handle */}
      {showModal && !isSubmitted && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => !submitting && setShowModal(false)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.625rem", padding: "1.25rem", width: "min(520px, 92vw)", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700, color: "#1c1917" }}>Commit stocktake?</h2>
            <p style={{ margin: "0.4rem 0 0.875rem", fontSize: "0.875rem", color: "#57534e", lineHeight: 1.5 }}>
              <strong>{completedLines}</strong> of <strong>{totalLines}</strong> entries are counted across <strong>{distinctItems}</strong> distinct items. Committing updates current stock levels and writes inventory transactions for every variance &mdash; <strong>this cannot be undone</strong>.
            </p>

            {!allSigned && missingNames.length > 0 && (
              <div style={{ marginBottom: "0.875rem", padding: "0.5rem 0.75rem", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#854d0e" }}>
                ⚠ {missingNames.length} department(s) haven&rsquo;t signed off yet: {missingNames.join(", ")}. You can commit anyway, but the audit trail will show no sign-off from those depts.
              </div>
            )}

            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>
                Uncounted items policy
              </div>
              {(["carry_over", "zero_set"] as const).map(p => {
                const checked = policy === p;
                const labels = {
                  carry_over: { title: "Carry over (default)", help: "Leave on-hand stock untouched for items nobody counted." },
                  zero_set:   { title: "Zero-set uncounted",   help: "Set on-hand to zero for any item on the sheet that wasn't counted (treats absence as proof of zero stock)." },
                };
                return (
                  <label key={p} style={{
                    display: "flex", gap: "0.5rem", alignItems: "flex-start",
                    padding: "0.5rem 0.625rem", marginBottom: "0.25rem",
                    border: checked ? "2px solid #b91c1c" : "1px solid #d6d3d1",
                    background: checked ? "#fef2f2" : "#fff",
                    borderRadius: "0.375rem", cursor: "pointer",
                  }}>
                    <input type="radio" name="uncounted_policy" value={p} checked={checked} onChange={() => setPolicy(p)} style={{ marginTop: "0.2rem" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.875rem", color: checked ? "#991b1b" : "#1c1917" }}>{labels[p].title}</div>
                      <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem", lineHeight: 1.4 }}>{labels[p].help}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)} disabled={submitting} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button
                onClick={async () => { setShowModal(false); await onCommit(policy); }}
                disabled={submitting}
                className="btn-primary"
                style={{ fontSize: "0.8125rem" }}
              >
                {submitting ? "Committing…" : "Commit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Imperative open helper — exposed via a small hidden button the
          parent renders alongside its own Commit button. The parent
          listens for clicks on its Commit button and calls
          openCommitDialog() on the ref. We render this as a hidden
          element so the button shows but its click handler routes
          through the parent. */}
      <button
        type="button"
        data-testid="stocktake-commit-modal-trigger"
        style={{ display: "none" }}
        onClick={() => setShowModal(true)}
      />
    </>
  );
}

/** Convenience: pop the modal open by clicking the hidden trigger button. */
export function openStocktakeCommitModal(root: HTMLElement | null) {
  const btn = root?.querySelector<HTMLButtonElement>('[data-testid="stocktake-commit-modal-trigger"]');
  btn?.click();
}
