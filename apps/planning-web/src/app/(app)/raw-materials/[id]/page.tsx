import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function RawMaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: material } = await supabase.from("raw_materials").select("*").eq("id", id).single();
  if (!material) notFound();

  const specFields = [
    ["Origin / Source", material.spec_origin],
    ["Fat Content", material.spec_fat_content],
    ["Protein", material.spec_protein],
    ["Moisture", material.spec_moisture],
    ["pH", material.spec_ph],
    ["Microbiological Standards", material.spec_microbiological],
    ["Allergens", material.spec_allergens],
    ["Storage Temperature", material.spec_storage_temp],
    ["Shelf Life", material.spec_shelf_life],
  ].filter(([, val]) => val);

  const isLow = material.current_stock <= material.min_stock_level && material.min_stock_level > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ marginBottom: "0.25rem" }}>
            <Link href="/raw-materials" style={{ color: "#78716c", textDecoration: "none", fontSize: "0.875rem" }}>← Raw Materials</Link>
          </div>
          <h1 className="page-title">{material.name}</h1>
          <p style={{ fontSize: "0.875rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            <span style={{ fontFamily: "monospace" }}>{material.code}</span>
            {material.category && <> · {material.category}</>}
            {material.supplier && <> · {material.supplier}</>}
          </p>
        </div>
        <Link href={`/raw-materials/${id}/edit`} className="btn-secondary">Edit</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Raw Material Specification</h2>
          {specFields.length === 0 ? (
            <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No specification data entered.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {specFields.map(([label, val]) => (
                  <tr key={label} style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "0.5rem 0", fontSize: "0.8125rem", color: "#78716c", width: "45%" }}>{label}</td>
                    <td style={{ padding: "0.5rem 0", fontSize: "0.875rem", fontWeight: "500", color: "#292524" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {material.spec_notes && (
            <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fafaf9", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#78716c" }}>
              <strong>Notes:</strong> {material.spec_notes}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Stock & Supplier</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[
                ["Current Stock", `${material.current_stock} ${material.unit}`],
                ["Min Stock Level", `${material.min_stock_level} ${material.unit}`],
                ["Supplier", material.supplier || "—"],
                ["Supplier Code", material.supplier_code || "—"],
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#fafaf9", borderRadius: "0.5rem", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{label}</div>
                  <div style={{ fontSize: "1rem", fontWeight: "600", color: "#1c1917", marginTop: "0.125rem" }}>{val}</div>
                </div>
              ))}
            </div>
            {isLow && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b" }}>
                ⚠️ Stock is below minimum level. Consider reordering.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link href="/inventory/new" className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
              Record Stock Movement
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
