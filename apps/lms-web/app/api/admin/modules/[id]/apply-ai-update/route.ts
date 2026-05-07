import { NextResponse } from "next/server";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import {
  ApplyModuleError,
  applyModuleJsonToExisting,
} from "~/lib/ai/apply-module";
import { getStudioSession } from "~/lib/ai/sessions";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Bad module id" }, { status: 400 });
  }
  const tid = ctx.traceyTenantId;
  const state = await getStudioSession(ctx.traceyUserId, tid);
  const raw = (state.currentModuleJson ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      {
        error:
          "No AI module update available. Ask the AI to refine the module first.",
      },
      { status: 400 },
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
    if (Array.isArray(data)) data = data[0];
  } catch (err) {
    return NextResponse.json(
      { error: `AI output could not be parsed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  try {
    await applyModuleJsonToExisting({ data, moduleId, tenantId: tid });
  } catch (err) {
    if (err instanceof ApplyModuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.ai_updated",
    targetKind: "module",
    targetId: String(moduleId),
    details: {},
  });

  return NextResponse.json({ ok: true });
}
