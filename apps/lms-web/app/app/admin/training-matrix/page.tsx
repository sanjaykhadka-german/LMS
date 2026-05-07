import Link from "next/link";
import { asc } from "drizzle-orm";
import {
  db,
  lmsDepartmentModulePolicies,
  lmsDepartments,
  lmsModules,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export const metadata = { title: "Training matrix" };

export default async function TrainingMatrixPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [departments, modules, policies] = await Promise.all([
    db
      .select({ id: lmsDepartments.id, name: lmsDepartments.name })
      .from(lmsDepartments)
      .where(tenantWhere(lmsDepartments, tid))
      .orderBy(asc(lmsDepartments.name)),
    db
      .select({ id: lmsModules.id, title: lmsModules.title })
      .from(lmsModules)
      .where(tenantWhere(lmsModules, tid))
      .orderBy(asc(lmsModules.title)),
    db
      .select({
        deptId: lmsDepartmentModulePolicies.departmentId,
        moduleId: lmsDepartmentModulePolicies.moduleId,
      })
      .from(lmsDepartmentModulePolicies)
      .where(tenantWhere(lmsDepartmentModulePolicies, tid)),
  ]);

  const policySet = new Set(policies.map((p) => `${p.deptId}|${p.moduleId}`));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Training matrix</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Which modules each department auto-assigns. Edit the mapping at{" "}
          <Link
            href="/app/admin/departments/policies"
            className="underline hover:text-[color:var(--foreground)]"
          >
            Department policies
          </Link>
          .
        </p>
      </div>

      {departments.length === 0 || modules.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--border)] p-6 text-center text-sm text-[color:var(--muted-foreground)]">
          {departments.length === 0
            ? "No departments configured yet."
            : "No modules configured yet."}
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-[color:var(--border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[color:var(--secondary)]">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-[color:var(--secondary)] px-3 py-2 text-left font-medium"
                >
                  Department
                </th>
                {modules.map((m) => (
                  <th
                    key={m.id}
                    scope="col"
                    className="px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {m.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id} className="border-t border-[color:var(--border)]">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-[color:var(--background)] px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {d.name}
                  </th>
                  {modules.map((m) => {
                    const has = policySet.has(`${d.id}|${m.id}`);
                    return (
                      <td
                        key={m.id}
                        className="px-3 py-2 text-center"
                        aria-label={
                          has ? `${d.name} auto-assigns ${m.title}` : undefined
                        }
                      >
                        {has ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ✓
                          </span>
                        ) : (
                          <span className="text-[color:var(--muted-foreground)]">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
