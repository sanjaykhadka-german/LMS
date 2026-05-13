import { createClient } from "@/lib/supabase/server";
import RolesManager from "./_components/roles-manager";

export default async function RolesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user!.id)
    .single();

  const tenantId = profile!.tenant_id as string;

  const [{ data: roles }, { data: permissions }] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, description, is_system, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order"),
    supabase
      .from("role_permissions")
      .select("id, role_id, section, access")
      .in("role_id", (roles ?? []).map(r => r.id)),
  ]);

  // Re-fetch permissions with proper role filter after roles are loaded
  const roleIds = (roles ?? []).map(r => r.id);
  const { data: perms } = roleIds.length
    ? await supabase.from("role_permissions").select("id, role_id, section, access").in("role_id", roleIds)
    : { data: [] };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles & Permissions</h1>
          <p className="page-subtitle">Define roles and control which sections each role can access</p>
        </div>
      </div>
      <RolesManager
        initialRoles={roles ?? []}
        initialPermissions={perms ?? []}
        tenantId={tenantId}
      />
    </div>
  );
}
