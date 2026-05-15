import { asc, eq } from "drizzle-orm";
import { forTenant, plDepartments } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";
import DepartmentsManager from "./_components/departments-manager";

export default async function DepartmentsPage() {
  const { tenant } = await requireTenant();
  const rows = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        id: plDepartments.id,
        name: plDepartments.name,
        code: plDepartments.code,
        description: plDepartments.description,
        sort_order: plDepartments.sortOrder,
        is_active: plDepartments.isActive,
      })
      .from(plDepartments)
      .where(eq(plDepartments.traceyTenantId, tenant.id))
      .orderBy(asc(plDepartments.sortOrder), asc(plDepartments.name)),
  );

  return <DepartmentsManager initialDepartments={rows} />;
}
