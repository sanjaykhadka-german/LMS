import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, members, tenants, type Tenant, type Role } from "@tracey/db";
import { auth } from "~/auth";

const ACTIVE_TENANT_COOKIE = "tracey.activeTenant";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface Membership {
  tenant: Tenant;
  role: Role;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    image: u.image ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/sign-in");
  return u;
}

export async function currentMembership(): Promise<Membership | null> {
  const u = await currentUser();
  if (!u) return null;

  const cookieStore = await cookies();
  const activeFromCookie = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  if (activeFromCookie) {
    const row = await fetchMembership(u.id, activeFromCookie);
    if (row) return row;
  }

  const [first] = await db
    .select({ tenant: tenants, role: members.role })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(eq(members.userId, u.id))
    .orderBy(desc(members.createdAt))
    .limit(1);
  if (!first) return null;

  try {
    cookieStore.set(ACTIVE_TENANT_COOKIE, first.tenant.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch {
    // Server Component context — cookie set will be applied via the next mutation.
  }

  return { tenant: first.tenant, role: first.role as Role };
}

export async function listUserTenants(): Promise<Membership[]> {
  const u = await currentUser();
  if (!u) return [];
  const rows = await db
    .select({ tenant: tenants, role: members.role })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(eq(members.userId, u.id))
    .orderBy(desc(members.createdAt));
  return rows.map((r) => ({ tenant: r.tenant, role: r.role as Role }));
}

async function fetchMembership(userId: string, tenantId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ tenant: tenants, role: members.role })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(and(eq(members.userId, userId), eq(members.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  return { tenant: row.tenant, role: row.role as Role };
}

export async function setActiveTenant(tenantId: string): Promise<void> {
  const u = await requireUser();
  const m = await fetchMembership(u.id, tenantId);
  if (!m) throw new Error("You are not a member of that workspace.");
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export type { Tenant } from "@tracey/db";
