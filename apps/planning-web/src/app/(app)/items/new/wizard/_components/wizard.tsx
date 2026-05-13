"use client";

/**
 * Guided wizard for adding a new product.
 *
 * Five steps, plain language, no jargon. State is held in this component;
 * the item is created in a single insert at the end. After save the user
 * lands on /items/[id] where the existing UI lets them add a BOM,
 * suppliers, spec docs, etc.
 *
 * For the multi-step recipe archetype, the user will (in a follow-up
 * iteration) get a chain builder that auto-creates the upstream cascade.
 * For now they create the FG and add the BOM manually on the next page.
 */

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type Archetype = "resold" | "1step" | "multistep";

type Department = { id: string; name: string; code: string | null };

type SoldAs = "piece-fixed" | "piece-random" | "by-weight" | "by-pack";

const STEPS = [
  { id: "basics",     label: "Basics" },
  { id: "sold",       label: "How sold?" },
  { id: "pack",       label: "Pack hierarchy" },
  { id: "production", label: "Production" },
  { id: "review",     label: "Review & save" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export default function Wizard({
  archetype, tenantId, departments,
}: {
  archetype: Archetype;
  tenantId: string;
  departments: Department[];
}) {
  const router   = useRouter();
  const supabase = createClient();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  // Form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [soldAs, setSoldAs] = useState<SoldAs>("piece-fixed");
  const [targetWeightG, setTargetWeightG] = useState<string>("");
  const [unitsPerInner,    setUpi] = useState<string>("");
  const [innerPerOuter,    setIpo] = useState<string>("");
  const [outersPerPallet,  setOpp] = useState<string>("");
  const [departmentName, setDepartmentName] = useState<string>("");
  const [procurement, setProcurement] = useState<"produce" | "purchase">(
    archetype === "resold" ? "purchase" : "produce"
  );

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Auto-suggest a code from the name (rough — user can override)
  useEffect(() => {
    if (code) return;
    const slug = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.slice(0, 4))
      .slice(0, 3)
      .join("-");
    if (slug) setCode(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Step validation
  const canProceed = useMemo(() => {
    if (step === "basics")     return name.trim().length > 0 && code.trim().length > 0;
    if (step === "sold")       return soldAs === "by-weight" || (targetWeightG && parseFloat(targetWeightG) > 0);
    if (step === "pack")       return true;  // pack hierarchy is optional
    if (step === "production") return procurement === "purchase" || departmentName.trim().length > 0;
    if (step === "review")     return !saving;
    return false;
  }, [step, name, code, soldAs, targetWeightG, departmentName, procurement, saving]);

  function next() {
    setError(null);
    if (!canProceed) return;
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  }

  function prev() {
    setError(null);
    setStepIdx(i => Math.max(i - 1, 0));
  }

  function goTo(s: StepId) {
    const i = STEPS.findIndex(x => x.id === s);
    if (i >= 0) setStepIdx(i);
  }

  async function save() {
    setSaving(true);
    setError(null);

    const itemTypeForArchetype: Record<Archetype, string> =
      archetype === "resold" ? { resold: "raw_material",   "1step": "finished_good", multistep: "finished_good" }
                              : { resold: "raw_material",   "1step": "finished_good", multistep: "finished_good" };

    const upi = unitsPerInner   ? parseInt(unitsPerInner)   : null;
    const ipo = innerPerOuter   ? parseInt(innerPerOuter)   : null;
    const opp = outersPerPallet ? parseInt(outersPerPallet) : null;
    const upo = upi != null && ipo != null ? upi * ipo : null;
    const upp = upo != null && opp != null ? upo * opp : null;
    const tg  = targetWeightG ? parseFloat(targetWeightG) : null;

    const weightMode =
      soldAs === "piece-fixed"  ? "fixed"  :
      soldAs === "piece-random" ? "random" :
      null;

    const unit =
      soldAs === "by-weight" ? "kg" :
      soldAs === "by-pack"   ? "ea" :
      tg != null              ? "ea" :
      "kg";

    const payload = {
      tenant_id:         tenantId,
      code:              code.trim(),
      name:              name.trim(),
      item_type:         itemTypeForArchetype[archetype],
      unit,
      weight_mode:       weightMode,
      target_weight_g:   tg,
      units_per_inner:   upi,
      inner_per_outer:   ipo,
      outers_per_pallet: opp,
      units_per_outer:   upo,
      units_per_pallet:  upp,
      department:        departmentName.trim() || null,
      procurement_type:  procurement,
      is_active:         true,
      current_stock:     0,
      min_stock:         0,
      max_stock:         0,
      priority:          5,
    };

    const { data, error: err } = await supabase.from("items").insert(payload).select("id").single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Land on the item detail page with a "next step" hint
    router.push(`/items/${(data as { id: string }).id}?just_created=1`);
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "780px" }}>
      <BackButton href="/items/new/start" label="Pick type" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Add a new product</h1>
          <p className="page-subtitle">
            {archetype === "resold"    && "Resold item — you buy and resell as-is."}
            {archetype === "1step"     && "1-step recipe — single mix, then sell."}
            {archetype === "multistep" && "Multi-step recipe — multiple production stages."}
            {" "}
            <Link href="/items/new/start" style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 600 }}>
              Change type ↺
            </Link>
          </p>
        </div>
        <Link href="/items/new" className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          Skip — open classic form
        </Link>
      </div>

      {/* ─── Step indicator ─── */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.5rem" }}>
        {STEPS.map((s, i) => {
          const active = i === stepIdx;
          const done   = i < stepIdx;
          return (
            <div
              key={s.id}
              onClick={() => i <= stepIdx && goTo(s.id)}  // can click backward only
              style={{
                flex: 1,
                padding: "0.625rem 0.75rem",
                background: active ? "#1c1917" : "#ffffff",
                color:      active ? "#ffffff" : (done ? "#0f6e56" : "#a8a29e"),
                border:     "1px solid",
                borderColor: active ? "#1c1917" : "#e7e5e4",
                borderRightWidth: i === STEPS.length - 1 ? 1 : 0,
                fontSize: "0.75rem",
                fontWeight: active ? 600 : 500,
                textAlign: "center",
                cursor: i <= stepIdx ? "pointer" : "default",
                borderRadius:
                  i === 0 ? "0.375rem 0 0 0.375rem" :
                  i === STEPS.length - 1 ? "0 0.375rem 0.375rem 0" :
                  0,
              }}
            >
              <span style={{ marginRight: "0.4rem" }}>
                {done ? "✓" : `${i + 1}.`}
              </span>
              {s.label}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: "1.5rem" }}>
        {/* ─── Step 1: Basics ─── */}
        {step === "basics" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>What is it called?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              Use the name your team and customers know it by.
            </p>
            <label className="form-label">Product name *</label>
            <input
              className="form-input"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Tasty Juicy Hot Dogs Domestic"
            />
            <label className="form-label" style={{ marginTop: "1rem" }}>Item code *</label>
            <input
              className="form-input"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="auto-suggested from name"
              style={{ fontFamily: "monospace" }}
            />
            <p style={{ fontSize: "0.75rem", color: "#a8a29e", margin: "0.4rem 0 0" }}>
              Must be unique. Tracey suggests one from the name — feel free to override.
            </p>
          </>
        )}

        {/* ─── Step 2: How is it sold? ─── */}
        {step === "sold" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>How is it sold?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              This determines whether we track it by piece, by weight, or by pack.
            </p>

            {[
              { val: "piece-fixed",  title: "Per piece, fixed weight",   sub: "Each piece is a fixed weight (e.g. 50 g hot dog, 750 g sourdough)." },
              { val: "piece-random", title: "Per piece, random weight",  sub: "Each piece varies — usually weighed at packing (e.g. a sirloin steak)." },
              { val: "by-weight",    title: "Sold by weight only",       sub: "Loose by the kg — no fixed pieces (e.g. mince, dough)." },
              { val: "by-pack",      title: "Pre-packed in groups",      sub: "Sold in fixed-count packs of N (e.g. 6-pack of bottles)." },
            ].map(opt => (
              <label
                key={opt.val}
                style={{
                  display: "flex", gap: "0.625rem", alignItems: "flex-start",
                  padding: "0.75rem 0.875rem",
                  border: `1px solid ${soldAs === opt.val ? "#b91c1c" : "#e7e5e4"}`,
                  background: soldAs === opt.val ? "#fef2f2" : "white",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="soldAs"
                  value={opt.val}
                  checked={soldAs === opt.val}
                  onChange={() => setSoldAs(opt.val as SoldAs)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{opt.title}</div>
                  <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{opt.sub}</div>
                </div>
              </label>
            ))}

            {(soldAs === "piece-fixed" || soldAs === "piece-random" || soldAs === "by-pack") && (
              <div style={{ marginTop: "1rem" }}>
                <label className="form-label">
                  {soldAs === "piece-random" ? "Approximate target weight per piece (g)" : "Weight per piece (g) *"}
                </label>
                <input
                  className="form-input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={targetWeightG}
                  onChange={e => setTargetWeightG(e.target.value)}
                  placeholder="e.g. 50"
                  style={{ maxWidth: "200px" }}
                />
              </div>
            )}
          </>
        )}

        {/* ─── Step 3: Pack hierarchy ─── */}
        {step === "pack" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>How is it packaged?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              All optional — fill in what you know. We can add or change these later.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <label className="form-label">Pieces per inner</label>
                <input
                  className="form-input" type="number" min="0"
                  value={unitsPerInner}
                  onChange={e => setUpi(e.target.value)}
                  placeholder="e.g. 20"
                />
                <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>
                  Pieces inside a single inner pack / vacuum bag / tray.
                </p>
              </div>
              <div>
                <label className="form-label">Inners per outer</label>
                <input
                  className="form-input" type="number" min="0"
                  value={innerPerOuter}
                  onChange={e => setIpo(e.target.value)}
                  placeholder="e.g. 7"
                />
                <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>
                  Inners in one outer carton / box / crate.
                </p>
              </div>
              <div>
                <label className="form-label">Outers per pallet</label>
                <input
                  className="form-input" type="number" min="0"
                  value={outersPerPallet}
                  onChange={e => setOpp(e.target.value)}
                  placeholder="e.g. 72"
                />
                <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>
                  Outers stacked on a pallet.
                </p>
              </div>
            </div>

            {unitsPerInner && innerPerOuter && outersPerPallet && (
              <div style={{
                marginTop: "1rem", padding: "0.75rem 1rem",
                background: "#dcfce7", border: "1px solid #86efac",
                borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#166534",
              }}>
                ✓ Pack hierarchy looks complete. That works out to{" "}
                <strong>{parseInt(unitsPerInner) * parseInt(innerPerOuter)} pieces / outer</strong>{" "}
                and{" "}
                <strong>
                  {parseInt(unitsPerInner) * parseInt(innerPerOuter) * parseInt(outersPerPallet)} pieces / pallet
                </strong>.
              </div>
            )}
          </>
        )}

        {/* ─── Step 4: Production ─── */}
        {step === "production" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Where do you make it?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              This drives MRP, scheduling and the floor screens.
            </p>

            <label className="form-label">Procurement *</label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              {[
                { val: "produce",  title: "Produce in-house" },
                { val: "purchase", title: "Buy from supplier" },
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setProcurement(opt.val as "produce" | "purchase")}
                  style={{
                    flex: 1, padding: "0.75rem 1rem",
                    border: `1px solid ${procurement === opt.val ? "#b91c1c" : "#e7e5e4"}`,
                    background: procurement === opt.val ? "#fef2f2" : "white",
                    borderRadius: "0.5rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: procurement === opt.val ? 600 : 500,
                    fontSize: "0.875rem",
                  }}
                >{opt.title}</button>
              ))}
            </div>

            {procurement === "produce" && (
              <>
                <label className="form-label">Department *</label>
                <select
                  className="form-input"
                  value={departmentName}
                  onChange={e => setDepartmentName(e.target.value)}
                >
                  <option value="">— pick a department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>{d.name}{d.code ? ` (${d.code})` : ""}</option>
                  ))}
                </select>
                <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0.25rem 0 0" }}>
                  Don't see the right department? Settings → Departments to add one.
                </p>
              </>
            )}
          </>
        )}

        {/* ─── Step 5: Review ─── */}
        {step === "review" && (
          <>
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.4rem" }}>Looks right?</h2>
            <p className="subtle" style={{ margin: "0 0 1.25rem" }}>
              Quick check before saving. Any field can be tweaked later from the item detail page.
            </p>

            <table className="data-table" style={{ fontSize: "0.875rem" }}>
              <tbody>
                <tr><td style={{ width: "180px", color: "#78716c" }}>Name</td><td><strong>{name}</strong></td></tr>
                <tr><td style={{ color: "#78716c" }}>Code</td><td style={{ fontFamily: "monospace" }}>{code}</td></tr>
                <tr>
                  <td style={{ color: "#78716c" }}>Sold as</td>
                  <td>
                    {soldAs === "piece-fixed"  && `Per piece, fixed weight (${targetWeightG} g)`}
                    {soldAs === "piece-random" && `Per piece, random weight (~${targetWeightG} g)`}
                    {soldAs === "by-weight"    && "By weight only"}
                    {soldAs === "by-pack"      && `Pre-packed (${targetWeightG} g per piece)`}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "#78716c" }}>Pack hierarchy</td>
                  <td>
                    {(unitsPerInner || innerPerOuter || outersPerPallet)
                      ? `${unitsPerInner || "?"} per inner · ${innerPerOuter || "?"} inners per outer · ${outersPerPallet || "?"} outers per pallet`
                      : <span style={{ color: "#a8a29e" }}>Not set — can be added later</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "#78716c" }}>Procurement</td>
                  <td>{procurement === "produce" ? "Produced in-house" : "Bought from supplier"}</td>
                </tr>
                {procurement === "produce" && (
                  <tr><td style={{ color: "#78716c" }}>Department</td><td>{departmentName || "—"}</td></tr>
                )}
              </tbody>
            </table>

            <div style={{
              marginTop: "1.25rem", padding: "0.875rem 1rem",
              background: "#fef9c3", border: "1px solid #fde68a",
              borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#713f12",
            }}>
              <strong>Next after save:</strong>{" "}
              {archetype === "resold"
                ? "Add a supplier link with price + lead time."
                : "Click '+ Create BOM' on the detail page to define the recipe, then '▷ Test this product' to verify the cascade."}
            </div>

            {error && (
              <div style={{
                marginTop: "1rem", padding: "0.75rem 1rem",
                background: "#fef2f2", border: "1px solid #fca5a5",
                borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b",
              }}>{error}</div>
            )}
          </>
        )}
      </div>

      {/* ─── Step nav ─── */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={prev}
          disabled={stepIdx === 0}
          className="btn-secondary"
          style={{ visibility: stepIdx === 0 ? "hidden" : "visible" }}
        >← Back</button>

        {step !== "review" ? (
          <button
            type="button"
            onClick={next}
            disabled={!canProceed}
            className="btn-primary"
          >Next →</button>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ minWidth: "180px" }}
          >
            {saving ? "Saving…" : "✓ Create item"}
          </button>
        )}
      </div>
    </div>
  );
}
