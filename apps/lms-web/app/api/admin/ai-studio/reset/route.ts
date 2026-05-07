import { NextResponse } from "next/server";
import { requireAdmin } from "~/lib/auth/admin";
import { resetStudioSession } from "~/lib/ai/sessions";

export const runtime = "nodejs";

export async function POST() {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  await resetStudioSession(ctx.traceyUserId, ctx.traceyTenantId);
  return NextResponse.json({ ok: true });
}
