import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PalletConfigManager from "./_components/pallet-config-manager";

export default async function PalletConfigsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles").select("role, tenant_id").eq("id", user.id).single();

  if (!profile || !["admin", "manager", "super_admin"].includes(profile.role)) redirect("/settings");

  const { data: templates } = await supabase
    .from("pallet_config_templates")
    .select("*")
    .eq("tenant_id", profile.tenant_id)
    .order("sort_order")
    .order("name")
    .limit(500);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pallet Config Templates</h1>
          <p className="page-subtitle">Reusable pallet configuration templates for product spec sheets</p>
        </div>
      </div>
      <PalletConfigManager
        initialTemplates={templates ?? []}
        tenantId={profile.tenant_id}
      />
    </div>
  );
}
