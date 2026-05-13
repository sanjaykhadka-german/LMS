import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import RecipeManager from "./recipe-manager";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, { data: allMaterials }, { data: recipe }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).single(),
    supabase.from("raw_materials").select("id, name, code, unit").order("name"),
    supabase.from("recipe_ingredients").select("*, raw_material:raw_materials(id, name, code, unit)").eq("product_id", id).order("sort_order"),
  ]);

  if (!product) notFound();

  const specFields = [
    ["Weight per Unit", product.spec_weight_per_unit],
    ["Fat Content", product.spec_fat_content],
    ["Protein", product.spec_protein],
    ["Moisture", product.spec_moisture],
    ["pH", product.spec_ph],
    ["Water Activity", product.spec_water_activity],
    ["Allergens", product.spec_allergens],
    ["Storage Temperature", product.spec_storage_temp],
    ["Shelf Life", product.spec_shelf_life],
    ["Packaging", product.spec_packaging],
    ["Labelling", product.spec_labelling],
  ].filter(([, val]) => val);

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ marginBottom: "0.25rem" }}>
            <Link href="/products" style={{ color: "#78716c", textDecoration: "none", fontSize: "0.875rem" }}>← Products</Link>
          </div>
          <h1 className="page-title">{product.name}</h1>
          <p style={{ fontSize: "0.875rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            <span style={{ fontFamily: "monospace" }}>{product.code}</span>
            {product.category && <> · {product.category}</>}
            {product.description && <> · {product.description}</>}
          </p>
        </div>
        <Link href={`/products/${id}/edit`} className="btn-secondary">Edit Product</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Specification */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Finished Product Specification</h2>
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
          {product.spec_notes && (
            <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fafaf9", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#78716c" }}>
              <strong>Notes:</strong> {product.spec_notes}
            </div>
          )}
        </div>

        {/* Batch & inventory */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Batch Information</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[
                ["Standard Batch", `${product.batch_size} ${product.batch_unit}`],
                ["Unit", product.unit],
                ["Current Stock", `${product.current_stock} ${product.unit}`],
                ["Status", product.is_active ? "Active" : "Inactive"],
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#fafaf9", borderRadius: "0.5rem", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{label}</div>
                  <div style={{ fontSize: "1rem", fontWeight: "600", color: "#1c1917", marginTop: "0.125rem" }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recipe */}
      <div style={{ marginTop: "1.5rem" }}>
        <RecipeManager
          productId={product.id}
          productName={product.name}
          batchSize={product.batch_size}
          batchUnit={product.batch_unit}
          initialIngredients={recipe ?? []}
          allMaterials={allMaterials ?? []}
        />
      </div>
    </div>
  );
}
