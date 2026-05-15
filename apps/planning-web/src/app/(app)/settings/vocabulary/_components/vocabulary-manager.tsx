"use client";

/**
 * Vocabulary manager — admin-only page where the tenant renames system
 * labels to match the words their team actually uses. The engine continues
 * to use the canonical_key behind the scenes; only the display label changes.
 *
 * Edits go through the setLabelAction / resetLabelAction server actions,
 * both of which re-check the caller's role on the server before writing.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { invalidateTenantLabels, type LabelRow } from "@/lib/hooks/use-tenant-labels";
import { setLabelAction, resetLabelAction } from "../actions";

export default function VocabularyManager({ initialLabels }: { initialLabels: LabelRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<LabelRow[]>(initialLabels);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function saveRow(key: string, newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      setError("Display label cannot be empty.");
      return;
    }
    setSavingKey(key);
    setError(null);
    try {
      await setLabelAction(key, trimmed);
    } catch (err) {
      setSavingKey(null);
      setError(err instanceof Error ? err.message : "Save failed");
      return;
    }
    setSavingKey(null);
    invalidateTenantLabels();
    setRows(rows.map(r => r.canonical_key === key
      ? { ...r, display_label: trimmed, is_overridden: trimmed !== r.default_label }
      : r));
    startTransition(() => router.refresh());
  }

  async function resetRow(key: string) {
    const row = rows.find(r => r.canonical_key === key);
    if (!row) return;
    if (!confirm(`Reset "${row.display_label}" back to the default "${row.default_label}"?`)) return;
    setSavingKey(key);
    setError(null);
    try {
      await resetLabelAction(key);
    } catch (err) {
      setSavingKey(null);
      setError(err instanceof Error ? err.message : "Reset failed");
      return;
    }
    setSavingKey(null);
    invalidateTenantLabels();
    setRows(rows.map(r => r.canonical_key === key
      ? { ...r, display_label: r.default_label, is_overridden: false }
      : r));
    startTransition(() => router.refresh());
  }

  function setLocal(key: string, value: string) {
    setRows(rows.map(r => r.canonical_key === key ? { ...r, display_label: value } : r));
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Vocabulary</h1>
          <p className="page-subtitle">
            Rename system labels to match how your team actually talks. Engine and reports keep
            working — they reference the canonical key behind the scenes.
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "0.75rem 1rem", marginBottom: "1rem",
          background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem",
          fontSize: "0.875rem", color: "#991b1b",
        }}>{error}</div>
      )}

      <div style={{
        marginBottom: "1.5rem", padding: "0.875rem 1rem",
        background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.5rem",
        fontSize: "0.8125rem", color: "#713f12",
      }}>
        <strong>Tip:</strong> these are tenant-wide labels. Renaming &ldquo;Stage&rdquo; to &ldquo;Phase&rdquo;
        applies for every user in your tenant, on every page where the label appears. Engine,
        reports, and integrations are unaffected.
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "180px" }}>Canonical key</th>
              <th>Display label</th>
              <th>Where it appears</th>
              <th style={{ width: "120px" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                No labels loaded.
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.canonical_key}>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
                  {r.canonical_key}
                  {r.is_overridden && (
                    <span className="badge badge-yellow" style={{
                      fontSize: "0.625rem", marginLeft: "0.4rem",
                    }}>customised</span>
                  )}
                </td>
                <td>
                  <input
                    className="form-input"
                    style={{ maxWidth: "260px" }}
                    value={r.display_label}
                    onChange={e => setLocal(r.canonical_key, e.target.value)}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && v !== (r.is_overridden ? r.display_label : r.default_label)) {
                        saveRow(r.canonical_key, v);
                      } else if (!v) {
                        setLocal(r.canonical_key, r.is_overridden ? r.display_label : r.default_label);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") {
                        setLocal(r.canonical_key, r.is_overridden ? r.display_label : r.default_label);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    disabled={savingKey === r.canonical_key}
                  />
                  {r.is_overridden && (
                    <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                      Default: {r.default_label}
                    </div>
                  )}
                </td>
                <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>
                  {r.example_locations || r.description || "—"}
                </td>
                <td>
                  {r.is_overridden && (
                    <button
                      onClick={() => resetRow(r.canonical_key)}
                      disabled={savingKey === r.canonical_key}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    >Reset</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "1rem" }}>
        Changes save when you tab away from a field or press <kbd>Enter</kbd>. Press
        <kbd> Esc</kbd> to revert your edit before saving.
      </p>
    </div>
  );
}
