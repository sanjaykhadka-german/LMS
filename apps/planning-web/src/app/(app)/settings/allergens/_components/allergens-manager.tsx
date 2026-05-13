"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type AllergenDef = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  regulatory_standard: string;
  sort_order: number;
  is_active: boolean;
};

type TenantSettings = {
  id: string;
  active_standards: string[];
} | null;

const STANDARDS = ["FSANZ", "EU", "FDA", "CUSTOM"] as const;
const STANDARD_LABELS: Record<string, string> = {
  FSANZ: "FSANZ (Australia & NZ)",
  EU:    "EU (Europe)",
  FDA:   "FDA (United States)",
  CUSTOM: "Custom",
};

export default function AllergensManager({
  allDefinitions,
  tenantSettings,
}: {
  allDefinitions: AllergenDef[];
  tenantSettings: TenantSettings;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [activeStandards, setActiveStandards] = useState<string[]>(
    tenantSettings?.active_standards ?? ["FSANZ"]
  );
  const [savingStandards, setSavingStandards] = useState(false);

  // Custom allergen form
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ code: "", name: "", description: "" });
  const [savingCustom, setSavingCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byStandard = STANDARDS.reduce(
    (acc, s) => ({ ...acc, [s]: allDefinitions.filter(d => d.regulatory_standard === s) }),
    {} as Record<string, AllergenDef[]>
  );

  async function saveStandards(standards: string[]) {
    setSavingStandards(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    await supabase.from("tenant_allergen_settings").upsert(
      { tenant_id: profile!.tenant_id, active_standards: standards },
      { onConflict: "tenant_id" }
    );
    setSavingStandards(false);
    router.refresh();
  }

  function toggleStandard(std: string) {
    const next = activeStandards.includes(std)
      ? activeStandards.filter(s => s !== std)
      : [...activeStandards, std];
    setActiveStandards(next);
    saveStandards(next);
  }

  async function addCustomAllergen() {
    const code = customForm.code.trim().toUpperCase();
    const name = customForm.name.trim();
    if (!code || !name) { setError("Code and name are required"); return; }
    setSavingCustom(true);
    setError(null);
    const { error: err } = await supabase.from("allergen_definitions").insert({
      code: `CUSTOM_${code}`,
      name,
      description: customForm.description || null,
      regulatory_standard: "CUSTOM",
      sort_order: 99,
    });
    if (err) { setError(err.message); } else {
      setCustomForm({ code: "", name: "", description: "" });
      setShowAddCustom(false);
      router.refresh();
    }
    setSavingCustom(false);
  }

  async function toggleAllergenActive(def: AllergenDef) {
    await supabase.from("allergen_definitions").update({ is_active: !def.is_active }).eq("id", def.id);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Allergen Register</h1>
          <p className="page-subtitle">
            Configure which regulatory standards apply to your products and manage your allergen list
          </p>
        </div>
      </div>

      {/* Active Standards */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Active Regulatory Standards</h2>
        <p style={{ fontSize: "0.875rem", color: "#78716c", margin: "0 0 1rem" }}>
          Select which standards your business follows. Allergens from active standards appear on items and exports.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {STANDARDS.filter(s => s !== "CUSTOM").map(std => (
            <label key={std} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer",
              padding: "0.5rem 0.875rem", border: `1px solid ${activeStandards.includes(std) ? "#b91c1c" : "#e7e5e4"}`,
              borderRadius: "0.5rem", background: activeStandards.includes(std) ? "#fef2f2" : "#fff",
              fontSize: "0.875rem", fontWeight: activeStandards.includes(std) ? 600 : 400 }}>
              <input
                type="checkbox"
                checked={activeStandards.includes(std)}
                onChange={() => toggleStandard(std)}
                disabled={savingStandards}
              />
              {STANDARD_LABELS[std]}
              <span style={{ color: "#78716c", fontSize: "0.75rem", fontWeight: 400 }}>
                ({byStandard[std]?.length ?? 0} allergens)
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Allergen lists per standard */}
      {STANDARDS.map(std => {
        const defs = byStandard[std] ?? [];
        if (std !== "CUSTOM" && defs.length === 0) return null;
        const isActive = activeStandards.includes(std) || std === "CUSTOM";
        return (
          <div key={std} className="card" style={{ marginBottom: "1.5rem", opacity: isActive ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <div>
                <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>{STANDARD_LABELS[std]}</h2>
                {!isActive && std !== "CUSTOM" && (
                  <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.125rem 0 0" }}>
                    Not active for your tenant — enable above to use these allergens
                  </p>
                )}
              </div>
              {std === "CUSTOM" && (
                <button onClick={() => setShowAddCustom(true)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
                  + Add Custom
                </button>
              )}
            </div>

            {showAddCustom && std === "CUSTOM" && (
              <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <div>
                    <label className="form-label">Code *</label>
                    <input className="form-input" value={customForm.code}
                      onChange={e => setCustomForm(f => ({ ...f, code: e.target.value }))}
                      placeholder="e.g. MUSTARD" style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
                    <span style={{ fontSize: "0.7rem", color: "#78716c" }}>Stored as CUSTOM_CODE</span>
                  </div>
                  <div>
                    <label className="form-label">Name *</label>
                    <input className="form-input" value={customForm.name}
                      onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Mustard and mustard products" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="form-label">Description</label>
                    <input className="form-input" value={customForm.description}
                      onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Optional detail" />
                  </div>
                </div>
                {error && <p style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0 0 0.5rem" }}>{error}</p>}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={addCustomAllergen} className="btn-primary" disabled={savingCustom} style={{ fontSize: "0.8125rem" }}>
                    {savingCustom ? "Saving…" : "Add Allergen"}
                  </button>
                  <button onClick={() => setShowAddCustom(false)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
                </div>
              </div>
            )}

            {defs.length === 0 ? (
              <p style={{ color: "#78716c", fontSize: "0.875rem" }}>No custom allergens yet. Click &ldquo;+ Add Custom&rdquo; to create one.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "160px" }}>Code</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th style={{ width: "80px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {defs.map(d => (
                    <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.5 }}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{d.code}</td>
                      <td style={{ fontWeight: 500 }}>{d.name}</td>
                      <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{d.description ?? "—"}</td>
                      <td>
                        <button
                          onClick={() => toggleAllergenActive(d)}
                          className={d.is_active ? "badge badge-green" : "badge badge-gray"}
                          style={{ border: "none", cursor: "pointer", fontSize: "0.6875rem" }}
                        >
                          {d.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
