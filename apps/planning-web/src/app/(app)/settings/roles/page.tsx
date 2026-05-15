import { asc, eq } from "drizzle-orm";
import { forTenant, plRoles } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";
import RolesManager from "./_components/roles-manager";
import { loadPermissionsForRoles } from "./actions";

export default async function RolesPage() {
  const { tenant } = await requireTenant();

  const roles = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        id: plRoles.id,
        name: plRoles.name,
        description: plRoles.description,
        is_system: plRoles.isSystem,
        is_active: plRoles.isActive,
        sort_order: plRoles.sortOrder,
      })
      .from(plRoles)
      .where(eq(plRoles.traceyTenantId, tenant.id))
      .orderBy(asc(plRoles.sortOrder)),
  );

  const permissions = await loadPermissionsForRoles(tenant.id, roles.map((r) => r.id));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles &amp; Permissions</h1>
          <p className="page-subtitle">Define roles and control which sections each role can access</p>
        </div>
      </div>
      <RolesManager initialRoles={roles} initialPermissions={permissions} />
    </div>
  );
}
