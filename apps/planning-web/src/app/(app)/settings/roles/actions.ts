"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { forTenant, plRolePermissions, plRoles } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";

type AccessLevel = "none" | "read" | "write";

function assertAdmin(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new Error("only admins can edit roles");
  }
}

function normaliseAccess(value: string): AccessLevel {
  return value === "read" || value === "write" ? value : "none";
}

export interface NewRoleInput {
  name: string;
  description?: string | null;
  sections: string[];
}

export interface CreatedRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface CreatedPermission {
  id: string;
  role_id: string;
  section: string;
  access: string;
}

export async function createRoleAction(
  input: NewRoleInput,
): Promise<{ role: CreatedRole; permissions: CreatedPermission[] }> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const name = input.name.trim();
  if (!name) throw new Error("name is required");

  return forTenant(tenant.id).run(async (tx) => {
    const existing = await tx
      .select({ count: plRoles.id })
      .from(plRoles)
      .where(eq(plRoles.traceyTenantId, tenant.id));
    const sortOrder = existing.length + 1;

    const createdRows = await tx
      .insert(plRoles)
      .values({
        traceyTenantId: tenant.id,
        name,
        description: input.description?.trim() || null,
        isSystem: false,
        sortOrder,
      })
      .returning({
        id: plRoles.id,
        name: plRoles.name,
        description: plRoles.description,
        isSystem: plRoles.isSystem,
        isActive: plRoles.isActive,
        sortOrder: plRoles.sortOrder,
      });
    const created = createdRows[0];
    if (!created) throw new Error("failed to create role");

    const seed = input.sections.map((section) => ({
      roleId: created.id,
      section,
      access: "none",
    }));
    const newPerms = seed.length
      ? await tx
          .insert(plRolePermissions)
          .values(seed)
          .returning({
            id: plRolePermissions.id,
            roleId: plRolePermissions.roleId,
            section: plRolePermissions.section,
            access: plRolePermissions.access,
          })
      : [];

    revalidatePath("/settings/roles");

    return {
      role: {
        id: created.id,
        name: created.name,
        description: created.description,
        is_system: created.isSystem,
        is_active: created.isActive,
        sort_order: created.sortOrder,
      },
      permissions: newPerms.map((p) => ({
        id: p.id,
        role_id: p.roleId,
        section: p.section,
        access: p.access,
      })),
    };
  });
}

export async function toggleRoleActiveAction(roleId: string, isActive: boolean): Promise<void> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(plRoles)
      .set({ isActive })
      .where(and(eq(plRoles.id, roleId), eq(plRoles.traceyTenantId, tenant.id))),
  );
  revalidatePath("/settings/roles");
}

export async function setPermissionAction(
  roleId: string,
  section: string,
  access: string,
): Promise<CreatedPermission> {
  const { tenant, role } = await requireTenant();
  assertAdmin(role);
  const accessLevel = normaliseAccess(access);

  return forTenant(tenant.id).run(async (tx) => {
    // Confirm the role belongs to this tenant before mutating its permissions.
    const ownerCheck = await tx
      .select({ id: plRoles.id })
      .from(plRoles)
      .where(and(eq(plRoles.id, roleId), eq(plRoles.traceyTenantId, tenant.id)))
      .limit(1);
    if (ownerCheck.length === 0) {
      throw new Error("role not found in this tenant");
    }

    const rows = await tx
      .insert(plRolePermissions)
      .values({ roleId, section, access: accessLevel })
      .onConflictDoUpdate({
        target: [plRolePermissions.roleId, plRolePermissions.section],
        set: { access: accessLevel },
      })
      .returning({
        id: plRolePermissions.id,
        roleId: plRolePermissions.roleId,
        section: plRolePermissions.section,
        access: plRolePermissions.access,
      });
    const row = rows[0];
    if (!row) throw new Error("failed to upsert permission");

    revalidatePath("/settings/roles");

    return {
      id: row.id,
      role_id: row.roleId,
      section: row.section,
      access: row.access,
    };
  });
}

// Exposed so the server page and the create-role flow stay in sync about which
// roles' permissions to load.
export async function loadPermissionsForRoles(
  tenantId: string,
  roleIds: string[],
): Promise<CreatedPermission[]> {
  if (roleIds.length === 0) return [];
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: plRolePermissions.id,
        roleId: plRolePermissions.roleId,
        section: plRolePermissions.section,
        access: plRolePermissions.access,
      })
      .from(plRolePermissions)
      .where(inArray(plRolePermissions.roleId, roleIds)),
  );
  return rows.map((r) => ({
    id: r.id,
    role_id: r.roleId,
    section: r.section,
    access: r.access,
  }));
}
