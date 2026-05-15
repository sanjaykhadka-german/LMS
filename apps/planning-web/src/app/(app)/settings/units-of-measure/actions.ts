"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { forTenant, plUnitsOfMeasure } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";

type UomCategory = "weight" | "count" | "volume" | "length" | "other";

function assertAdmin(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new Error("only admins can edit units of measure");
  }
}

function normaliseCategory(value: string): UomCategory {
  if (value === "weight" || value === "count" || value === "volume" || value === "length") return value;
  return "other";
}

export interface UomInput {
  code: string;
  name: string;
  description?: string | null;
  category: string;
  is_base?: boolean;
  sort_order?: number;
}

export async function createUomAction(input: UomInput): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const code = input.code.trim().toLowerCase();
  const name = input.name.trim();
  if (!code) throw new Error("code is required");
  if (!name) throw new Error("name is required");

  await forTenant(tenant.id).run((tx) =>
    tx.insert(plUnitsOfMeasure).values({
      traceyTenantId: tenant.id,
      code,
      name,
      description: input.description?.trim() || null,
      category: normaliseCategory(input.category),
      isBase: !!input.is_base,
      sortOrder: Number(input.sort_order) || 100,
    }),
  );
  revalidatePath("/settings/units-of-measure");
}

export async function updateUomAction(id: string, input: UomInput): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const code = input.code.trim().toLowerCase();
  const name = input.name.trim();
  if (!code) throw new Error("code is required");
  if (!name) throw new Error("name is required");

  await forTenant(tenant.id).run((tx) =>
    tx
      .update(plUnitsOfMeasure)
      .set({
        code,
        name,
        description: input.description?.trim() || null,
        category: normaliseCategory(input.category),
        isBase: !!input.is_base,
        sortOrder: Number(input.sort_order) || 100,
        updatedAt: new Date(),
      })
      .where(and(eq(plUnitsOfMeasure.id, id), eq(plUnitsOfMeasure.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/units-of-measure");
}

export async function toggleUomActiveAction(id: string, isActive: boolean): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(plUnitsOfMeasure)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(plUnitsOfMeasure.id, id), eq(plUnitsOfMeasure.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/units-of-measure");
}

export async function deleteUomAction(id: string): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(plUnitsOfMeasure)
      .where(and(eq(plUnitsOfMeasure.id, id), eq(plUnitsOfMeasure.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/units-of-measure");
}
