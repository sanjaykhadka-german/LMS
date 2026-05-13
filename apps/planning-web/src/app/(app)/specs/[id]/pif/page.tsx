import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import PifPrintTrigger from "./_pif-print-trigger";

export default async function PifPreviewPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { id } = await params;
  const { print } = await searchParams;

  const { data: spec } = await supabase
    .from("product_specs")
    .select(`
      id, version, version_label, status, approved_at, internal_notes,
      spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
      spec_fat_content, spec_protein, spec_moisture, spec_ph,
      spec_water_activity, spec_micro, spec_packaging, spec_labelling,
      nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
      nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
      nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
      allergens, created_at, updated_at,
      item:item_id(
        id, code, name, item_type, department, unit, description,
        is_rte, ingredients_statement, item_number_upload,
        spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
        spec_fat_content, spec_protein, spec_moisture, spec_ph,
        spec_water_activity, spec_micro, spec_packaging, spec_labelling,
        nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
        allergens, target_weight_g, units_per_inner, inner_per_outer, units_per_outer,
        min_shelf_life_days
      ),
      approver:approved_by(id, full_name)
    `)
    .eq("id", id)
    .single();

  if (!spec) notFound();

  const item = spec.item as any;

  // Tenant info for header
  const { data: { user: u } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("tenant_id, full_name").eq("id", u!.id).single();
  const { data: tenant } = await supabase
    .from("tenants").select("name, country_code, abn, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postcode")
    .eq("id", profile?.tenant_id ?? "")
    .maybeSingle();

  const { data: palletConfig } = await supabase
    .from("item_pallet_config").select("*").eq("item_id", item?.id).maybeSingle();

  // Resolve override OR item master fallback
  const f = (a: any, b: any) => a ?? b ?? null;

  const storageTemp  = f(spec.spec_storage_temp, item?.spec_storage_temp);
  const shelfLife    = f(spec.spec_shelf_life,   item?.spec_shelf_life);
  const origin       = f(spec.spec_origin,       item?.spec_origin);
  const fatContent   = f(spec.spec_fat_content,  item?.spec_fat_content);
  const protein      = f(spec.spec_protein,      item?.spec_protein);
  const moisture     = f(spec.spec_moisture,     item?.spec_moisture);
  const ph           = f(spec.spec_ph,           item?.spec_ph);
  const waterActivity= f(spec.spec_water_activity,item?.spec_water_activity);
  const micro        = f(spec.spec_micro,        item?.spec_micro);
  const packaging    = f(spec.spec_packaging,    item?.spec_packaging);
  const labelling    = f(spec.spec_labelling,    item?.spec_labelling);
  const allergens    = (spec.allergens ?? item?.allergens ?? []) as string[];

  const ps = item?.nut_per_serving_g ? Number(item.nut_per_serving_g) : (spec.nut_per_serving_g ? Number(spec.nut_per_serving_g) : null);
  const nutVal = (specVal: any, itemVal: any) => f(specVal, itemVal);

  return (
    <div className="pif-page" style={{ padding: "1rem 1.5rem", maxWidth: 900, margin: "0 auto", color: "#1c1917" }}>
      <PifPrintTrigger autoPrint={print === "1"} />

      {/* Toolbar (hidden on print) */}
      <div className="pif-toolbar no-print" style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0.625rem 0", marginBottom: "1rem", borderBottom: "1px solid #e7e5e4",
      }}>
        <Link href={`/items/${item?.id}`} style={{ color: "#b91c1c", textDecoration: "none", fontSize: "0.875rem" }}>← Back to item</Link>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href={`/specs/${id}/preview`} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>View GB Spec</Link>
          <button
            onClick={undefined}
            className="btn-primary"
            style={{ fontSize: "0.8125rem" }}
            // server component can't have onClick; we'll inject a tiny client trigger via PifPrintTrigger
            data-print-trigger="true"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Document header */}
      <header style={{ borderBottom: "2px solid #1c1917", paddingBottom: "0.75rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.02em" }}>
              PRODUCT INFORMATION FORM
            </h1>
            <div style={{ fontSize: "0.8125rem", color: "#57534e", marginTop: "0.25rem" }}>
              {tenant?.name ?? "—"}
              {tenant?.abn ? ` · ABN ${tenant.abn}` : ""}
            </div>
            {(tenant?.billing_address_line1 || tenant?.billing_city) && (
              <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>
                {[tenant?.billing_address_line1, tenant?.billing_address_line2, tenant?.billing_city, tenant?.billing_state, tenant?.billing_postcode]
                  .filter(Boolean).join(", ")}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", fontSize: "0.75rem", color: "#57534e" }}>
            <div><strong>Version:</strong> v{spec.version_label}</div>
            <div><strong>Status:</strong> {spec.status === "approved" ? "Approved" : "Draft"}</div>
            <div><strong>Date:</strong> {new Date(spec.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div>
            {spec.approved_at && (
              <div style={{ marginTop: "0.25rem" }}><strong>Approved:</strong> {new Date(spec.approved_at).toLocaleDateString("en-AU")}</div>
            )}
          </div>
        </div>
      </header>

      {/* 1. Product identification */}
      <Section number="1" title="Product Identification">
        <Row label="Product name"   value={item?.name} />
        <Row label="Product code"   value={item?.code} mono />
        <Row label="Item number"    value={item?.item_number_upload} mono />
        <Row label="Description"    value={item?.description} multiline />
        <Row label="Country of origin" value={origin} />
        <Row label="Ready to eat (RTE)" value={item?.is_rte ? "Yes" : "No"} />
      </Section>

      {/* 2. Composition / ingredients */}
      <Section number="2" title="Composition / Ingredients Statement">
        <div style={{ padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem",
                      fontSize: "0.875rem", lineHeight: 1.55, whiteSpace: "pre-wrap",
                      color: item?.ingredients_statement ? "#1c1917" : "#a8a29e" }}>
          {item?.ingredients_statement || "Not declared"}
        </div>
      </Section>

      {/* 3. Allergens */}
      <Section number="3" title="Allergen Declaration">
        {(allergens?.length ?? 0) > 0 ? (
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
            {[...new Set(allergens.map((a: string) => a.replace(/^[A-Z]+_/, "")))].map(a =>
              <li key={a}><strong style={{ textTransform: "uppercase" }}>{a}</strong></li>
            )}
          </ul>
        ) : (
          <div style={{ fontSize: "0.875rem", color: "#78716c" }}>None declared</div>
        )}
      </Section>

      {/* 4. Physical / chemical specs */}
      <Section number="4" title="Physical & Chemical Specification">
        <Row label="Fat content"        value={fatContent} />
        <Row label="Protein"            value={protein} />
        <Row label="Moisture"           value={moisture} />
        <Row label="pH"                 value={ph} />
        <Row label="Water activity (aw)" value={waterActivity} />
      </Section>

      {/* 5. Microbiological */}
      <Section number="5" title="Microbiological Specification">
        {micro ? (
          <div style={{ padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem",
                        fontSize: "0.875rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{micro}</div>
        ) : (
          <div style={{ fontSize: "0.875rem", color: "#78716c" }}>No microbiological requirements specified</div>
        )}
      </Section>

      {/* 6. Nutrition */}
      <Section number="6" title="Nutrition Information">
        {nutVal(spec.nut_energy_kj, item?.nut_energy_kj) == null ? (
          <div style={{ fontSize: "0.875rem", color: "#78716c" }}>Nutrition data not provided</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid #1c1917" }}>
                <th style={{ textAlign: "left",  padding: "0.4rem 0.5rem" }}></th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>Per 100 g</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>{ps != null ? `Per serve (${ps} g)` : "Per serve"}</th>
              </tr>
            </thead>
            <tbody>
              <NutEnergyRow kj={nutVal(spec.nut_energy_kj, item?.nut_energy_kj)} kcal={nutVal(spec.nut_energy_kcal, item?.nut_energy_kcal)} ps={ps} />
              <NutRow label="Protein"                 v={nutVal(spec.nut_protein_g,       item?.nut_protein_g)}       u="g"  ps={ps} />
              <NutRow label="Fat — total"             v={nutVal(spec.nut_fat_total_g,     item?.nut_fat_total_g)}     u="g"  ps={ps} />
              <NutRow label="     Saturated"          v={nutVal(spec.nut_fat_saturated_g, item?.nut_fat_saturated_g)} u="g"  ps={ps} />
              <NutRow label="     Trans"              v={nutVal(spec.nut_fat_trans_g,     item?.nut_fat_trans_g)}     u="g"  ps={ps} />
              <NutRow label="Carbohydrate — total"    v={nutVal(spec.nut_carbs_total_g,   item?.nut_carbs_total_g)}   u="g"  ps={ps} />
              <NutRow label="     Sugars"             v={nutVal(spec.nut_carbs_sugars_g,  item?.nut_carbs_sugars_g)}  u="g"  ps={ps} />
              <NutRow label="Dietary fibre"           v={nutVal(spec.nut_fibre_g,         item?.nut_fibre_g)}         u="g"  ps={ps} />
              <NutRow label="Sodium"                  v={nutVal(spec.nut_sodium_mg,       item?.nut_sodium_mg)}       u="mg" ps={ps} />
            </tbody>
          </table>
        )}
        {(spec.nut_notes || item?.nut_notes) && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#78716c", fontStyle: "italic" }}>
            {spec.nut_notes ?? item?.nut_notes}
          </p>
        )}
      </Section>

      {/* 7. Storage & shelf life */}
      <Section number="7" title="Storage & Shelf Life">
        <Row label="Storage temperature"        value={storageTemp} />
        <Row label="Shelf life from manufacture" value={shelfLife} />
        <Row label="Min shelf life on dispatch"  value={item?.min_shelf_life_days ? `${item.min_shelf_life_days} days` : null} />
      </Section>

      {/* 8. Packaging */}
      <Section number="8" title="Packaging & Labelling">
        <Row label="Weight per unit"  value={item?.target_weight_g != null ? `${item.target_weight_g} g` : null} />
        <Row label="Units per inner"  value={item?.units_per_inner ?? null} />
        <Row label="Inner per outer"  value={item?.inner_per_outer ?? null} />
        <Row label="Units per outer"  value={item?.units_per_outer ?? null} />
        {palletConfig && (
          <>
            <Row label="TI × HI"            value={(palletConfig.ti != null && palletConfig.hi != null) ? `${palletConfig.ti} × ${palletConfig.hi}` : null} />
            <Row label="Cartons per pallet" value={(palletConfig.ti != null && palletConfig.hi != null) ? palletConfig.ti * palletConfig.hi : null} />
            <Row label="Pallet type"        value={palletConfig.pallet_type ?? null} />
          </>
        )}
        <Row label="Packaging notes" value={packaging} multiline />
        <Row label="Labelling notes" value={labelling} multiline />
      </Section>

      {/* 9. Approval */}
      <Section number="9" title="Approval">
        <Row label="Status"      value={spec.status === "approved" ? "Approved" : "Draft — not yet approved"} />
        {spec.approved_at && <Row label="Approved on" value={new Date(spec.approved_at).toLocaleDateString("en-AU")} />}
      </Section>

      <footer style={{ marginTop: "2rem", paddingTop: "0.75rem", borderTop: "1px solid #e7e5e4", fontSize: "0.7rem", color: "#a8a29e", textAlign: "center" }}>
        Generated from {tenant?.name ?? "the system"} on {new Date().toLocaleString("en-AU")} · Spec version v{spec.version_label}
      </footer>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .pif-page { padding: 0 !important; max-width: none !important; }
          @page { size: A4; margin: 18mm; }
        }
      `}</style>
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "1.25rem", breakInside: "avoid" }}>
      <h2 style={{
        fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.5rem",
        padding: "0.4rem 0.6rem", background: "#1c1917", color: "white",
        letterSpacing: "0.02em", borderRadius: "0.25rem",
      }}>
        {number}. {title.toUpperCase()}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function Row({ label, value, mono = false, multiline = false }: {
  label: string; value: any; mono?: boolean; multiline?: boolean;
}) {
  const v = value ?? "—";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "0.75rem", padding: "0.3rem 0", borderBottom: "1px solid #f5f5f4", fontSize: "0.8125rem" }}>
      <div style={{ color: "#57534e", fontWeight: 500 }}>{label}</div>
      <div style={{
        color: value == null ? "#a8a29e" : "#1c1917",
        fontFamily: mono ? "monospace" : undefined,
        whiteSpace: multiline ? "pre-wrap" : undefined,
        lineHeight: 1.4,
      }}>{v == null ? "—" : String(v)}</div>
    </div>
  );
}

function NutRow({ label, v, u, ps }: { label: string; v: any; u: string; ps: number | null }) {
  const per100 = v == null ? "—" : `${(+v).toFixed(1)} ${u}`;
  const perServe = v == null || ps == null ? "—" : `${((+v * ps) / 100).toFixed(1)} ${u}`;
  return (
    <tr style={{ borderBottom: "1px solid #f5f5f4" }}>
      <td style={{ padding: "0.35rem 0.5rem" }}>{label}</td>
      <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{per100}</td>
      <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#57534e" }}>{perServe}</td>
    </tr>
  );
}

function NutEnergyRow({ kj, kcal, ps }: { kj: any; kcal: any; ps: number | null }) {
  const per100  = (kj == null && kcal == null) ? "—"
    : `${kj != null ? `${Math.round(+kj)} kJ` : "—"} / ${kcal != null ? `${Math.round(+kcal)} kcal` : "—"}`;
  const perServe = (kj == null && kcal == null) || ps == null ? "—"
    : `${kj != null ? `${Math.round((+kj * ps) / 100)} kJ` : "—"} / ${kcal != null ? `${Math.round((+kcal * ps) / 100)} kcal` : "—"}`;
  return (
    <tr style={{ borderBottom: "1px solid #f5f5f4", fontWeight: 600 }}>
      <td style={{ padding: "0.35rem 0.5rem" }}>Energy</td>
      <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{per100}</td>
      <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#57534e" }}>{perServe}</td>
    </tr>
  );
}
