import { asc, eq } from "drizzle-orm";
import { forTenant, plUnitsOfMeasure } from "@tracey/db";
import { requireTenant } from "@/lib/auth/current";
import { createClient } from "@/lib/supabase/server";
import UnitsOfMeasureManager from "./_components/units-of-measure-manager";

export default async function UnitsOfMeasurePage() {
  const { tenant } = await requireTenant();

  const uoms = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        id: plUnitsOfMeasure.id,
        code: plUnitsOfMeasure.code,
        name: plUnitsOfMeasure.name,
        description: plUnitsOfMeasure.description,
        category: plUnitsOfMeasure.category,
        is_base: plUnitsOfMeasure.isBase,
        is_active: plUnitsOfMeasure.isActive,
        sort_order: plUnitsOfMeasure.sortOrder,
      })
      .from(plUnitsOfMeasure)
      .where(eq(plUnitsOfMeasure.traceyTenantId, tenant.id))
      .orderBy(asc(plUnitsOfMeasure.sortOrder), asc(plUnitsOfMeasure.code)),
  );

  // Items still live in Supabase during Phase 4; usage counts are read from
  // there until Slice 9 ports the items module to Tracey. Once that lands,
  // swap this for a Drizzle query against plItems.
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("items")
    .select("unit, batch_unit, purchase_uom");

  const usage: Record<string, number> = {};
  for (const it of items ?? []) {
    for (const code of [it.unit, it.batch_unit, it.purchase_uom]) {
      if (!code) continue;
      const k = String(code).trim().toLowerCase();
      if (!k) continue;
      usage[k] = (usage[k] ?? 0) + 1;
    }
  }

  return <UnitsOfMeasureManager initialUoms={uoms} usage={usage} />;
}
