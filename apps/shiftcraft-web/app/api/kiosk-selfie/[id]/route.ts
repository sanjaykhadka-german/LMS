// GET /api/kiosk-selfie/<clockEventId>
//
// Streams the bytea selfie stored against a kiosk clock event. Manager+
// only, tenant-scoped via ctx.db.run so a cross-tenant id can't be probed
// (the per-tenant search_path means the lookup quietly returns nothing
// for a foreign clock-event id, rather than leaking presence).
//
// Cache-Control: private, max-age=3600 — the image is immutable once
// written, so the browser can keep it for a tab session. `private`
// prevents shared proxies from caching across users.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { forTenant, scClockEventPhotos } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return new NextResponse(null, { status: 403 });
  }
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        image: scClockEventPhotos.image,
        mimeType: scClockEventPhotos.mimeType,
      })
      .from(scClockEventPhotos)
      .where(
        and(
          eq(scClockEventPhotos.clockEventId, id),
          eq(scClockEventPhotos.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );

  if (!row || !row.image) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(row.image), {
    headers: {
      "Content-Type": row.mimeType ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
