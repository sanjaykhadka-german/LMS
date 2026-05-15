import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/current";
import { getTenantLabels } from "@/lib/labels/server";

export const runtime = "nodejs";

// GET /api/labels — used by the useTenantLabels() browser hook to refresh the
// merged label set after admin edits. Returns the same shape as the prior
// Supabase RPC `get_tenant_labels()` so the hook doesn't need to remap.
export async function GET() {
  try {
    const { tenant } = await requireTenant();
    const rows = await getTenantLabels(tenant.id);
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
