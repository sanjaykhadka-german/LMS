"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { forTenant, plDepartments } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";

function assertAdmin(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new Error("only admins can edit departments");
  }
}

export interface DepartmentInput {
  name: string;
  code?: string | null;
  description?: string | null;
  sort_order?: number;
}

export async function createDepartmentAction(input: DepartmentInput): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const name = input.name.trim();
  if (!name) throw new Error("name is required");

  await forTenant(tenant.id).run((tx) =>
    tx.insert(plDepartments).values({
      traceyTenantId: tenant.id,
      name,
      code: input.code?.trim().toUpperCase() || null,
      description: input.description?.trim() || null,
      sortOrder: Number(input.sort_order) || 0,
    }),
  );
  revalidatePath("/settings/departments");
}

export async function updateDepartmentAction(id: string, input: DepartmentInput): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const name = input.name.trim();
  if (!name) throw new Error("name is required");

  await forTenant(tenant.id).run((tx) =>
    tx
      .update(plDepartments)
      .set({
        name,
        code: input.code?.trim().toUpperCase() || null,
        description: input.description?.trim() || null,
        sortOrder: Number(input.sort_order) || 0,
        updatedAt: new Date(),
      })
      .where(and(eq(plDepartments.id, id), eq(plDepartments.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/departments");
}

export async function toggleDepartmentActiveAction(id: string, isActive: boolean): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(plDepartments)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(plDepartments.id, id), eq(plDepartments.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/departments");
}

export async function deleteDepartmentAction(id: string): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(plDepartments)
      .where(and(eq(plDepartments.id, id), eq(plDepartments.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/departments");
}
