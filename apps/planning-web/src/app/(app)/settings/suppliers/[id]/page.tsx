import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import SupplierForm from "../_components/supplier-form";
import SupplierItemsPanel from "../_components/supplier-items-panel";
import SupplierCertificationsPanel from "../_components/supplier-certifications-panel";
import SupplierContactsPanel from "../_components/supplier-contacts-panel";
import SupplierSpecsPanel from "../_components/supplier-specs-panel";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: supplier },
    { data: supplierItems },
    { data: certs },
    { data: contacts },
    { data: specs },
  ] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).single(),
    supabase
      .from("supplier_items")
      .select(`
        id, supplier_item_code, supplier_item_name,
        unit_price, currency, price_valid_from, price_valid_to,
        purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days,
        is_preferred, notes,
        item:item_id(id, code, name, item_type, unit)
      `)
      .eq("supplier_id", id)
      .order("supplier_item_code"),
    supabase
      .from("supplier_certifications")
      .select("*")
      .eq("supplier_id", id)
      .order("expiry_date", { ascending: true }),
    supabase
      .from("supplier_contacts")
      .select("*")
      .eq("supplier_id", id)
      .order("is_primary", { ascending: false }),
    // Spec docs uploaded for this supplier across every item — drives the
    // new "Specifications" panel below. Joins the item so the panel can
    // group + link back to item detail.
    supabase
      .from("item_spec_documents")
      .select(`
        id, document_type, title, version, effective_date, expiry_date,
        document_url, document_name, mime_type,
        item:item_id(id, code, name)
      `)
      .eq("supplier_id", id)
      .order("effective_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  if (!supplier) notFound();

  return (
    <div>
      <SupplierForm mode="edit" initial={supplier} />
      <div style={{ marginTop: "2rem" }}>
        <SupplierContactsPanel
          supplierId={id}
          tenantId={supplier.tenant_id}
          initialContacts={contacts ?? []}
        />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <SupplierCertificationsPanel
          supplierId={id}
          tenantId={supplier.tenant_id}
          initialCerts={certs ?? []}
          supplierName={supplier.name}
        />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <SupplierItemsPanel supplierId={id} initialItems={supplierItems ?? []} />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <SupplierSpecsPanel
          docs={(specs ?? []) as Parameters<typeof SupplierSpecsPanel>[0]["docs"]}
        />
      </div>
    </div>
  );
}
