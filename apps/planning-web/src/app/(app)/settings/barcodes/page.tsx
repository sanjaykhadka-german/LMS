import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BarcodePoolManager from "./_components/barcode-pool-manager";
import { TENANT_FULL_FETCH } from "@/lib/limits";

export default async function BarcodePoolPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("role, tenant_id").eq("id", user!.id).single();

  if (!profile || !["admin","manager","super_admin"].includes(profile.role)) redirect("/settings");

  const [{ data: pool }, { data: items }] = await Promise.all([
    supabase
      .from("tenant_barcode_pool")
      .select("*, item:assigned_item_id(id, code, name)")
      .eq("tenant_id", profile.tenant_id)
      .order("barcode_value"),
    supabase
      .from("items")
      .select("id, code, name, item_type")
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true)
      .order("code")
      .limit(TENANT_FULL_FETCH),
  ]);

  const available = (pool ?? []).filter(b => b.status === "available").length;
  const assigned  = (pool ?? []).filter(b => b.status === "assigned").length;
  const reserved  = (pool ?? []).filter(b => b.status === "reserved").length;

  return (
    <BarcodePoolManager
      pool={pool ?? []}
      items={items ?? []}
      tenantId={profile.tenant_id}
      stats={{ available, assigned, reserved, total: (pool ?? []).length }}
    />
  );
}
